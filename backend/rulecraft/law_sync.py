"""Repeatable official-law catalogue and full-text synchronization.

Every run verifies the catalogue from page one; resume reuses immutable full
texts whose official version identifiers still occur in that catalogue. It
never treats a successful search request as proof of corpus completeness.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import threading
from typing import Any, Callable, Iterable
from uuid import uuid4

from .law_sources import LawClient, LawSourceError
from .law_store import LawStore


DEFAULT_SOURCES = ("law", "administrative", "ordinance")
DEFAULT_ROOT = Path(__file__).resolve().parents[2] / ".rulecraft" / "national-law"
LIMITATIONS = [
    "완료는 선택한 공식 API 목록의 이번 수집 스냅샷과 본문 수량 일치만 의미합니다.",
    "법률·명령, 행정규칙, 자치법규의 지원 목록 외 판례·조약 등은 수집 범위에 포함하지 않습니다.",
    "과거 연혁 전수 수집과 특정 시점의 법적 효력·적용성은 보증하지 않습니다.",
    "별표·별지 첨부파일 원본은 별도로 내려받지 않으며 원문 응답의 첨부 메타데이터만 보존합니다.",
    "목(가·나 등) 단위의 구조화와 모든 인용의 법적 해석은 지원 범위에 포함하지 않습니다.",
    "목록의 공식 버전 ID가 같으면 기존 본문을 재사용합니다. 버전 식별자 없는 항목은 매번 원문을 확인하며 그 밖의 원문 재확인은 reset 모드로 실행하세요.",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _error(code: str, message: str, source: str | None = None, **extra: Any) -> dict[str, Any]:
    return {"code": code, "message": message, **({"source": source} if source else {}), **extra}


def _source_error(error: LawSourceError, source: str) -> dict[str, Any]:
    # LawSourceError messages are deliberately safe and omit HTTP URLs / OC.
    status = getattr(error, "status_code", None)
    return _error(error.code, str(error), source, retriable=bool(getattr(error, "retriable", False)),
                  **({"status_code": status} if isinstance(status, int) else {}))


class LawSync:
    def __init__(self, store: LawStore, client: LawClient | None = None):
        self.store = store
        self.client = client

    def run(self, sources: Iterable[str] = DEFAULT_SOURCES, reset: bool = False,
            page_size: int = 100, progress: Callable[[dict[str, Any]], None] | None = None,
            cancel_event: threading.Event | None = None, resume: bool = True) -> dict[str, Any]:
        selected = list(dict.fromkeys([sources] if isinstance(sources, str) else sources))
        if not selected:
            raise ValueError("수집할 법령 종류를 하나 이상 선택하세요.")
        if not isinstance(page_size, int) or isinstance(page_size, bool) or not 1 <= page_size <= 100:
            raise ValueError("page_size는 1~100의 정수여야 합니다.")
        root = self.store.root
        root.mkdir(parents=True, exist_ok=True)
        flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(root / "sync.lock", flags, 0o600)
        try:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return {**self.store.coverage(), "complete": False, "status": "blocked",
                        "errors": [_error("sync_in_progress", "다른 공식 법령 수집 작업이 진행 중입니다.")]}
            return self._run(selected, reset, page_size, progress, cancel_event, resume)
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    def _run(self, sources: list[str], reset: bool, page_size: int,
             progress: Callable[[dict[str, Any]], None] | None, cancel_event: threading.Event | None,
             resume: bool) -> dict[str, Any]:
        run_id = uuid4().hex
        started_at = _now()
        coverage: dict[str, Any] = {
            "run_id": run_id, "complete": False, "status": "running", "scope": sources,
            "started_at": started_at, "last_attempt_at": started_at, "last_synced_at": None,
            "limitations": list(LIMITATIONS),
            "completeness_scope": "selected_source_catalogue_snapshot_and_full_text",
            "scope_description": "선택한 국가 법령·명령(law), 행정규칙(administrative), 자치법규(ordinance)의 현재 공식 API 목록과 전문 수집 스냅샷",
            "provider_contract_verified": False,
            "historical_complete": False, "attachments_complete": False,
            "sources": {source: {"source": source, "run_id": run_id, "status": "pending",
                                 "phase": "pending", "expected": None, "catalogued": 0,
                                 "collected": 0, "downloaded": 0, "reused": 0, "failed": 0,
                                 "pages": 0, "next_page": 1, "errors": [], "complete": False,
                                 "last_synced_at": None, "attachment_count": 0,
                                 "changes": [], "changes_total": 0, "changes_truncated": False}
                        for source in sources},
        }

        def persist(source: str | None = None) -> None:
            if source in DEFAULT_SOURCES:
                self.store.set_sync_state(source, coverage["sources"][source])
            self.store.set_coverage(coverage)
            if progress:
                state = coverage["sources"].get(source, {})
                progress({"run_id": run_id, "source": source, "phase": state.get("phase", "starting"),
                          "status": state.get("status", coverage["status"]),
                          "expected": state.get("expected"), "collected": state.get("collected", 0),
                          "failed": state.get("failed", 0), "page": state.get("pages", 0),
                          "coverage": deepcopy(coverage)})

        persist()
        client = self.client
        if client is None:
            try:
                client = LawClient()
            except LawSourceError as error:
                for source, state in coverage["sources"].items():
                    state.update(status="blocked", phase="blocked", errors=[_source_error(error, source)])
                    persist(source)
                coverage.update(status="blocked", finished_at=_now())
                persist()
                return coverage
        try:
            for source in sources:
                state = coverage["sources"][source]
                if cancel_event is not None and cancel_event.is_set():
                    state.update(status="cancelled", phase="cancelled")
                    persist(source)
                    continue
                if source not in DEFAULT_SOURCES:
                    state.update(status="blocked", phase="blocked", errors=[
                        _error("unsupported_source", "지원하지 않는 공식 법령 종류입니다.", source)])
                    persist(source)
                    continue
                state.update(status="running", phase="catalogue")
                persist(source)
                items = self._catalogue(client, source, page_size, state, persist, cancel_event)
                if items is None:
                    continue
                self.store.save_manifest(source, items, run_id)
                state["phase"] = "full_text"
                persist(source)
                baseline = self.store.current_documents(source)
                before_by_id = {row["law_id"]: row for row in baseline}
                before_versions = {(row["source_id"], row["upstream_version_id"]): row for row in baseline}
                changes: list[dict[str, Any]] = []
                successful: list[dict[str, Any]] = []
                for item in items:
                    if cancel_event is not None and cancel_event.is_set():
                        state.update(status="cancelled", phase="cancelled")
                        break
                    try:
                        source_id, version_id = item["source_id"], item["version_id"]
                        metadata = item.get("metadata", {})
                        immutable_version = metadata.get("version_identifier_available",
                            metadata.get("version_identifier_type") == "MST" or str(version_id) != str(source_id)) is True
                        if resume and not reset and immutable_version and self.store.has_document(source, source_id, version_id):
                            state["reused"] += 1
                            if (str(source_id), str(version_id)) not in before_versions:
                                # A body downloaded before an interrupted run can
                                # be new to the current snapshot despite reuse.
                                after = self.store.version_evidence(source, source_id, version_id)
                                before = before_by_id.get(f"{source}:{source_id}")
                                if after:
                                    changes.append({"law_id": after["law_id"], "title": after["title"],
                                                    "change_type": "added" if before is None else "updated",
                                                    "before_version_id": before["version_id"] if before else None,
                                                    "after_version_id": after["version_id"],
                                                    "before_sha256": before["sha256"] if before else None,
                                                    "after_sha256": after["sha256"]})
                        else:
                            document = client.fetch_full(item)
                            if (document.get("source") != source or str(document.get("source_id")) != str(source_id)
                                    or str(document.get("version_id")) != str(version_id)):
                                raise LawSourceError("identity_mismatch", "원문 응답의 법령 식별자가 목록과 일치하지 않습니다.", source=source)
                            saved = self.store.save_document(document)
                            state["downloaded"] += 1
                            metadata = document.get("metadata", {})
                            state["attachment_count"] += int(metadata.get("attachment_count", len(metadata.get("attachments", []))))
                            law_id = f"{source}:{source_id}"
                            before = before_versions.get((str(source_id), str(version_id))) or before_by_id.get(law_id)
                            after_hash = hashlib.sha256(document["raw"]).hexdigest()
                            if (before is None or before["sha256"] != after_hash
                                    or before["upstream_version_id"] != str(version_id)):
                                changes.append({"law_id": law_id, "title": document["title"],
                                                "change_type": "added" if before is None else "updated",
                                                "before_version_id": before["version_id"] if before else None,
                                                "after_version_id": saved["version_id"],
                                                "before_sha256": before["sha256"] if before else None,
                                                "after_sha256": after_hash})
                        successful.append(item)
                        state["collected"] += 1
                    except LawSourceError as error:
                        state["failed"] += 1
                        state["errors"].append({**_source_error(error, source), "source_id": item["source_id"],
                                                "version_id": item["version_id"]})
                    except (ValueError, OSError, KeyError, TypeError):
                        state["failed"] += 1
                        state["errors"].append(_error("document_storage_error", "법령 원문을 검증하거나 저장하지 못했습니다.", source,
                                                       source_id=item.get("source_id"), version_id=item.get("version_id")))
                    persist(source)
                # The verified catalogue is authoritative for current membership,
                # even when some full texts failed. Old removed IDs stay archived.
                if cancel_event is not None and cancel_event.is_set():
                    state.update(status="cancelled", phase="cancelled")
                if state["status"] != "cancelled":
                    self.store.mark_snapshot(source, run_id, successful)
                    catalogue_ids = {f"{source}:{item['source_id']}" for item in items}
                    for law_id, before in before_by_id.items():
                        if law_id not in catalogue_ids:
                            changes.append({"law_id": law_id, "title": before["title"],
                                            "change_type": "removed_from_catalogue",
                                            "before_version_id": before["version_id"], "after_version_id": None,
                                            "before_sha256": before["sha256"], "after_sha256": None,
                                            "notice": "공식 목록에서 제외됨 · 폐지 여부는 별도 확인 필요"})
                    self.store.save_changes(source, run_id, changes)
                    state["changes"] = changes[:500]
                    state["changes_total"] = len(changes)
                    state["changes_truncated"] = len(changes) > 500
                else:
                    state["snapshot_retained"] = True
                if state["status"] != "cancelled":
                    state["complete"] = not state["errors"] and state["collected"] == state["expected"]
                    state["status"] = "completed" if state["complete"] else "failed"
                    state["phase"] = state["status"]
                    if state["complete"]:
                        state["last_synced_at"] = _now()
                    if not state["errors"] and state["collected"] != state["expected"]:
                        state["errors"].append(_error("count_mismatch", "목록 총수와 성공적으로 수집한 원문 수가 다릅니다.", source))
                persist(source)
            coverage["complete"] = all(state["complete"] for state in coverage["sources"].values())
            statuses = {state["status"] for state in coverage["sources"].values()}
            coverage["status"] = "completed" if coverage["complete"] else "cancelled" if "cancelled" in statuses else "blocked" if statuses == {"blocked"} else "failed"
            coverage["finished_at"] = _now()
            synchronized = [state["last_synced_at"] for state in coverage["sources"].values() if state["last_synced_at"]]
            coverage["last_synced_at"] = max(synchronized) if synchronized else None
            persist()
            return coverage
        finally:
            # A supplied client belongs to its caller (e.g. MockTransport tests).
            if self.client is None and hasattr(client, "close"):
                client.close()

    def _catalogue(self, client: LawClient, source: str, page_size: int, state: dict[str, Any],
                   persist: Callable[[str | None], None], cancel_event: threading.Event | None) -> list[dict[str, Any]] | None:
        items: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        page = 1
        last_page: int | None = None
        try:
            while last_page is None or page <= last_page:
                if cancel_event is not None and cancel_event.is_set():
                    state.update(status="cancelled", phase="cancelled")
                    persist(source)
                    return None
                response = client.catalog(source, page=page, page_size=page_size)
                if response.get("source") != source or response.get("supported", True) is not True:
                    raise LawSourceError("unsupported_response", "목록 응답의 법령 종류를 확인할 수 없습니다.", source=source)
                if response.get("page") != page:
                    raise LawSourceError("page_mismatch", "요청한 페이지와 응답 페이지가 다릅니다.", source=source)
                total = response.get("total")
                if not isinstance(total, int) or isinstance(total, bool) or total < 0:
                    raise LawSourceError("unknown_total", "공식 목록의 총수를 확인할 수 없습니다.", source=source)
                if state["expected"] is None:
                    state["expected"] = total
                    last_page = max(1, (total + page_size - 1) // page_size)
                    if last_page > 100_000:
                        raise LawSourceError("catalogue_limit", "공식 목록 페이지 수가 안전한 수집 범위를 초과했습니다.", source=source)
                elif total != state["expected"]:
                    raise LawSourceError("catalogue_drift", "수집 도중 공식 목록의 총수가 변경되었습니다. 다시 수집하세요.", source=source)
                current = response.get("items")
                if not isinstance(current, list) or len(current) > page_size:
                    raise LawSourceError("invalid_page", "공식 목록 페이지의 항목 수가 요청 범위와 다릅니다.", source=source)
                if not current and state["expected"] > 0:
                    raise LawSourceError("empty_page", "완료 전에 빈 공식 목록 페이지가 반환되었습니다.", source=source)
                for item in current:
                    if not isinstance(item, dict) or item.get("source") != source or not item.get("source_id") or not item.get("version_id"):
                        raise LawSourceError("invalid_catalogue_item", "공식 목록 항목의 종류 또는 식별자가 없습니다.", source=source)
                    identity = (str(item["source_id"]), str(item["version_id"]))
                    if identity in seen:
                        raise LawSourceError("duplicate_catalogue_item", "공식 목록에 동일 항목이 중복되거나 이전 페이지가 반복되었습니다.", source=source)
                    seen.add(identity)
                    items.append(item)
                state["catalogued"] = len(items)
                state["pages"] = page
                state["next_page"] = page + 1
                persist(source)
                page += 1
            if len(items) != state["expected"]:
                raise LawSourceError("catalogue_count_mismatch", "공식 목록 총수와 중복을 제외한 실제 목록 수가 다릅니다.", source=source)
            return items
        except LawSourceError as error:
            state.update(status="blocked" if error.code in {"missing_credentials", "access_denied", "proxy_access_denied", "unsupported_source"} else "failed", phase="catalogue_failed")
            state["errors"].append(_source_error(error, source))
            persist(source)
            return None


def main() -> None:
    parser = argparse.ArgumentParser(description="공식 법령 목록과 전문을 검증하여 별도 SQLite 저장소에 수집합니다.")
    parser.add_argument("--root", type=Path, default=Path(os.getenv("RULECRAFT_LAW_DIR", os.getenv("RULECRAFT_LAW_CORPUS", str(DEFAULT_ROOT)))))
    parser.add_argument("--sources", nargs="+", default=list(DEFAULT_SOURCES), choices=DEFAULT_SOURCES)
    parser.add_argument("--reset", action="store_true", help="이미 저장한 공식 버전의 원문도 다시 확인합니다.")
    parser.add_argument("--page-size", type=int, default=100)
    arguments = parser.parse_args()
    cancel = threading.Event()
    import signal
    signal.signal(signal.SIGINT, lambda signum, frame: cancel.set())
    signal.signal(signal.SIGTERM, lambda signum, frame: cancel.set())
    result = LawSync(LawStore(arguments.root)).run(arguments.sources, reset=arguments.reset,
                                                 page_size=arguments.page_size, cancel_event=cancel)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["complete"] else 2)


if __name__ == "__main__":
    main()
