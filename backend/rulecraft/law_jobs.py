"""Bounded, cancellable background jobs for national-law collection."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
import threading
from typing import Any, Callable
from uuid import uuid4


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LawJobConflict(RuntimeError):
    pass


class LawJobs:
    def __init__(self, store: Any, synchronizer: Callable[[], Any]):
        self.store = store
        self.synchronizer = synchronizer
        self._lock = threading.RLock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rulecraft-law-sync")
        self._cancel = threading.Event()
        self._job: dict[str, Any] | None = None
        self._closed = False

    def status(self) -> dict[str, Any] | None:
        with self._lock:
            return deepcopy(self._job)

    def start(self, sources: list[str], page_size: int = 100) -> dict[str, Any]:
        with self._lock:
            if self._closed:
                raise LawJobConflict("법령 수집 서비스가 종료 중입니다.")
            if self._job and self._job["status"] in {"queued", "running", "cancelling"}:
                raise LawJobConflict("법령 수집이 이미 실행 중입니다.")
            self._cancel = threading.Event()
            self._job = {"id": uuid4().hex, "status": "queued", "sources": sources,
                         "started_at": _now(), "finished_at": None, "progress": {}}
            response = deepcopy(self._job)
            self._executor.submit(self._run, tuple(sources), page_size, self._cancel)
            return response

    def _progress(self, update: dict[str, Any]) -> None:
        with self._lock:
            if self._job:
                self._job["progress"] = deepcopy(update)

    def _run(self, sources: tuple[str, ...], page_size: int, cancel: threading.Event) -> None:
        with self._lock:
            if self._job:
                self._job["status"] = "running"
        try:
            coverage = self.synchronizer().run(sources=sources, page_size=page_size,
                                              progress=self._progress, cancel_event=cancel)
            status = "cancelled" if cancel.is_set() else "completed" if coverage.get("complete") else "incomplete"
            with self._lock:
                if self._job:
                    self._job.update(status=status, coverage=coverage, finished_at=_now())
        except Exception:
            # Exceptions can include requests with OC credentials. Never return them.
            with self._lock:
                if self._job:
                    self._job.update(status="failed", finished_at=_now(),
                                     error="법령 수집을 완료하지 못했습니다. 수집 현황과 서비스 설정을 확인하세요.")

    def cancel(self) -> dict[str, Any] | None:
        with self._lock:
            if self._job and self._job["status"] in {"queued", "running", "cancelling"}:
                self._cancel.set()
                self._job["status"] = "cancelling"
            return deepcopy(self._job)

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._cancel.set()
        self._executor.shutdown(wait=False, cancel_futures=True)
