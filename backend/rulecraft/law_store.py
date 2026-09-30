"""Persistent official-law corpus, separate from the editable Markdown graph.

Original responses are content-addressed and never replaced.  A synchronization
snapshot chooses precise versions from its manifest; an older successful run is
not silently counted as evidence that a newer run completed.  Retrieval of a
past effective version is useful, but does not by itself prove historical
coverage, so temporal verification is reported separately.
"""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import tempfile
from typing import Any, Iterator
import unicodedata
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


SOURCES = ("law", "administrative", "ordinance")
_SECRET_KEYS = {"oc", "token", "access_token", "api_key", "apikey", "authorization", "password", "secret"}
_LIMITATIONS = [
    "완료는 선택한 공식 API 목록의 이번 수집 스냅샷과 본문 수량 일치만 의미합니다.",
    "과거 연혁 전수 수집과 특정 시점의 법적 효력·적용성은 보증하지 않습니다.",
    "별표·별지 첨부파일 원본은 별도로 내려받지 않으며 원문 응답의 첨부 메타데이터만 보존합니다.",
]
_ARTICLE = re.compile(r"^(?:제\s*)?(\d+)\s*(?:조)?\s*(?:의\s*(\d+))?$")


def default_corpus_root() -> Path:
    """Use the supported local override; never mix official data into the vault."""
    configured = os.environ.get("RULECRAFT_LAW_DIR") or os.environ.get("RULECRAFT_LAW_CORPUS")
    return Path(configured).expanduser() if configured else Path(__file__).resolve().parents[2] / ".rulecraft" / "national-law"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _date(value: Any, *, optional: bool = False) -> str:
    if value is None or value == "":
        if optional:
            return ""
        return datetime.now(timezone.utc).date().isoformat()
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if re.fullmatch(r"\d{8}", text):
        text = f"{text[:4]}-{text[4:6]}-{text[6:]}"
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise ValueError("Dates must be valid ISO dates (YYYY-MM-DD).")
    return date.fromisoformat(text).isoformat()


def _title_key(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    return re.sub(r"[\s「」『』\[\]{}\"'“”‘’]", "", value).casefold()


def _article_key(value: Any) -> str:
    match = _ARTICLE.fullmatch(str(value or "").strip())
    if not match or int(match[1]) < 1 or (match[2] and int(match[2]) < 1):
        return ""
    return f"제{int(match[1])}조" + (f"의{int(match[2])}" if match[2] else "")


def _source(value: Any) -> str:
    if value not in SOURCES:
        raise ValueError(f"Unsupported law source; expected one of {', '.join(SOURCES)}.")
    return str(value)


def _identifier(value: Any, label: str) -> str:
    if value is None or isinstance(value, bool):
        raise ValueError(f"{label} must be a nonempty identifier.")
    text = str(value).strip()
    if not text or "\x00" in text or len(text) > 1024:
        raise ValueError(f"{label} must be a nonempty identifier of at most 1024 characters.")
    return text


def _safe_url(value: str) -> str:
    """Persist source provenance without API account identifiers or credentials."""
    try:
        parts = urlsplit(value)
        if parts.scheme not in {"http", "https"}:
            return ""
        hostname = parts.hostname or ""
        netloc = hostname
        if ":" in hostname:
            netloc = f"[{hostname}]"
        if parts.port:
            netloc += f":{parts.port}"
        query = [(key, val) for key, val in parse_qsl(parts.query, keep_blank_values=True)
                 if key.casefold() not in _SECRET_KEYS]
        return urlunsplit((parts.scheme, netloc, parts.path, urlencode(query), ""))
    except (TypeError, ValueError):
        return ""


def _safe_metadata(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _safe_metadata(item) for key, item in value.items()
                if str(key).casefold() not in _SECRET_KEYS}
    if isinstance(value, (list, tuple)):
        return [_safe_metadata(item) for item in value]
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        return _safe_url(value)
    return value


class LawStore:
    """SQLite-backed, immutable official-document store with per-call connections."""

    def __init__(self, root: Path | str | None = None):
        self.root = Path(root) if root is not None else default_corpus_root()
        self.root = self.root.expanduser().absolute()
        self._check_path(self.root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._check_path(self.root)
        if not self.root.is_dir():
            raise ValueError("The official-law corpus root must be a directory.")
        root_stat = self.root.stat()
        self._root_identity = (root_stat.st_dev, root_stat.st_ino)
        self.database = self.root / "index.sqlite3"
        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS documents (
                    law_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
                    version_id TEXT NOT NULL, upstream_version_id TEXT NOT NULL,
                    title TEXT NOT NULL, title_key TEXT NOT NULL,
                    publication_date TEXT NOT NULL, effective_date TEXT NOT NULL,
                    publication_no TEXT NOT NULL, source_url TEXT NOT NULL,
                    raw_sha256 TEXT NOT NULL, raw_path TEXT NOT NULL, raw_format TEXT NOT NULL,
                    text TEXT NOT NULL, search_text TEXT NOT NULL,
                    provisions_json TEXT NOT NULL, metadata_json TEXT NOT NULL,
                    document_sha256 TEXT NOT NULL, fetched_at TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    PRIMARY KEY (law_id, version_id)
                );
                CREATE INDEX IF NOT EXISTS documents_source_version
                    ON documents (source, source_id, upstream_version_id);
                CREATE INDEX IF NOT EXISTS documents_current_date
                    ON documents (active, source, effective_date, publication_date);
                CREATE INDEX IF NOT EXISTS documents_title ON documents (title_key);
                CREATE TABLE IF NOT EXISTS sync_states (
                    source TEXT PRIMARY KEY, state_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS manifests (
                    source TEXT NOT NULL, run_id TEXT NOT NULL, source_id TEXT NOT NULL,
                    version_id TEXT NOT NULL, item_json TEXT NOT NULL,
                    PRIMARY KEY (source, run_id, source_id, version_id)
                );
                CREATE TABLE IF NOT EXISTS snapshots (
                    source TEXT NOT NULL, run_id TEXT NOT NULL, captured_at TEXT NOT NULL,
                    PRIMARY KEY (source, run_id)
                );
                CREATE TABLE IF NOT EXISTS snapshot_documents (
                    source TEXT NOT NULL, run_id TEXT NOT NULL, law_id TEXT NOT NULL,
                    version_id TEXT NOT NULL,
                    PRIMARY KEY (source, run_id, law_id, version_id),
                    FOREIGN KEY (law_id, version_id) REFERENCES documents(law_id, version_id)
                );
                CREATE TABLE IF NOT EXISTS current_snapshots (
                    source TEXT PRIMARY KEY, run_id TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY, value_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sync_changes (
                    source TEXT NOT NULL, run_id TEXT NOT NULL, sequence INTEGER NOT NULL,
                    change_json TEXT NOT NULL,
                    PRIMARY KEY (source,run_id,sequence)
                );
            """)

    @staticmethod
    def _check_path(path: Path) -> None:
        """Reject symlinks in any existing ancestor, including SQLite sidecars."""
        for component in (*reversed(path.parents), path):
            try:
                mode = component.lstat().st_mode
            except FileNotFoundError:
                continue
            if stat.S_ISLNK(mode):
                raise ValueError("Official-law corpus paths must not contain symlinks.")

    def _check_root(self) -> None:
        self._check_path(self.root)
        current = self.root.stat()
        if (current.st_dev, current.st_ino) != self._root_identity:
            raise ValueError("The official-law corpus root changed during operation.")

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        self._check_root()
        for suffix in ("", "-wal", "-shm", "-journal"):
            self._check_path(self.root / f"index.sqlite3{suffix}")
        connection = sqlite3.connect(self.database, timeout=15)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=15000")
            with connection:
                yield connection
        finally:
            connection.close()

    def _save_raw(self, source: str, raw: bytes, raw_format: str) -> tuple[str, str]:
        digest = hashlib.sha256(raw).hexdigest()
        directory = self.root / "raw" / source
        self._check_root()
        self._check_path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        self._check_path(directory)
        path = directory / f"{digest}.{raw_format}"
        # Publishing a completely written file with a hard link avoids exposing a
        # partial original response to simultaneous readers or interrupted writes.
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{digest}-", dir=directory)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, path, follow_symlinks=False)
            except FileExistsError:
                self._check_path(path)
                if not stat.S_ISREG(path.stat().st_mode):
                    raise ValueError("Stored original response must be a regular file.")
                descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                with os.fdopen(descriptor, "rb") as stream:
                    if stream.read() != raw:
                        raise ValueError("Stored original response failed its content-address integrity check.")
        finally:
            temporary.unlink(missing_ok=True)
        return digest, path.relative_to(self.root).as_posix()

    def save_document(self, doc: dict) -> dict:
        """Keep conflicting responses as distinct immutable versions, never overwrite."""
        if not isinstance(doc, dict):
            raise ValueError("An official document must be a mapping.")
        source = _source(doc.get("source"))
        source_id = _identifier(doc.get("source_id"), "source_id")
        upstream_version = _identifier(doc.get("version_id"), "version_id")
        law_id = f"{source}:{source_id}"
        title = _identifier(doc.get("title"), "title")
        raw = doc.get("raw")
        if not isinstance(raw, bytes) or not raw:
            raise ValueError("Official evidence must include nonempty original response bytes.")
        raw_format = str(doc.get("raw_format", "xml")).lower()
        if raw_format not in {"xml", "json"}:
            raise ValueError("Original response format must be xml or json.")
        provisions = deepcopy(doc.get("provisions", []))
        if not isinstance(provisions, list) or not all(isinstance(item, dict) for item in provisions):
            raise ValueError("Document provisions must be a list of mappings.")
        for provision in provisions:
            if provision.get("article_no"):
                canonical = _article_key(provision["article_no"])
                if not canonical:
                    raise ValueError("Official provisions must use valid article numbers.")
                provision["article_no"] = canonical
        metadata = _safe_metadata(deepcopy(doc.get("metadata", {})))
        if not isinstance(metadata, dict):
            raise ValueError("Document metadata must be a mapping.")
        raw_sha, raw_path = self._save_raw(source, raw, raw_format)
        evidence = {
            "source": source, "source_id": source_id, "upstream_version_id": upstream_version,
            "title": title, "publication_date": _date(doc.get("publication_date"), optional=True),
            "effective_date": _date(doc.get("effective_date"), optional=True),
            "publication_no": str(doc.get("publication_no") or ""),
            "source_url": _safe_url(str(doc.get("source_url") or "")),
            "raw_sha256": raw_sha, "raw_path": raw_path, "raw_format": raw_format,
            "text": str(doc.get("text") or ""), "provisions": provisions, "metadata": metadata,
        }
        document_sha = hashlib.sha256(_json(evidence).encode("utf-8")).hexdigest()
        with self._connection() as connection:
            # The write lock also serializes a duplicate ingest from another worker.
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                "SELECT version_id FROM documents WHERE law_id=? AND upstream_version_id=? AND document_sha256=?",
                (law_id, upstream_version, document_sha),
            ).fetchone()
            if existing:
                return {"law_id": law_id, "version_id": existing["version_id"], "inserted": False}
            conflict = connection.execute(
                "SELECT 1 FROM documents WHERE law_id=? AND version_id=?", (law_id, upstream_version),
            ).fetchone()
            version_id = f"{upstream_version}@{document_sha}" if conflict else upstream_version
            # New rows do not belong to an established current snapshot until committed
            # by mark_snapshot. A standalone first ingest remains locally inspectable.
            active = not connection.execute(
                "SELECT 1 FROM current_snapshots WHERE source=?", (source,),
            ).fetchone()
            search_text = title + "\n" + evidence["text"] + "\n" + _json(provisions)
            connection.execute("""
                INSERT INTO documents (
                    law_id,source,source_id,version_id,upstream_version_id,title,title_key,
                    publication_date,effective_date,publication_no,source_url,raw_sha256,raw_path,
                    raw_format,text,search_text,provisions_json,metadata_json,document_sha256,fetched_at,active
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                law_id, source, source_id, version_id, upstream_version, title, _title_key(title),
                evidence["publication_date"], evidence["effective_date"], evidence["publication_no"],
                evidence["source_url"], raw_sha, raw_path, raw_format, evidence["text"], search_text,
                _json(provisions), _json(metadata), document_sha, _now(), int(active),
            ))
        return {"law_id": law_id, "version_id": version_id, "inserted": True}

    def _raw_integrity(self, row: sqlite3.Row) -> bool:
        digest = row["raw_sha256"]
        if not re.fullmatch(r"[0-9a-f]{64}", digest) or row["source"] not in SOURCES or row["raw_format"] not in {"xml", "json"}:
            return False
        relative = f"raw/{row['source']}/{digest}.{row['raw_format']}"
        if relative != row["raw_path"]:
            return False
        path = self.root / relative
        try:
            self._check_root()
            self._check_path(path)
            if not stat.S_ISREG(path.stat().st_mode):
                return False
            descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(descriptor, "rb") as stream:
                actual = hashlib.file_digest(stream, "sha256").hexdigest()
            return actual == digest
        except (OSError, ValueError):
            return False

    def has_document(self, source: str, source_id: str, version_id: str) -> bool:
        source = _source(source)
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM documents WHERE source=? AND source_id=? AND (upstream_version_id=? OR version_id=?) "
                "ORDER BY fetched_at DESC,version_id DESC LIMIT 1",
                (source, str(source_id), str(version_id), str(version_id)),
            ).fetchone()
        return bool(row and self._raw_integrity(row))

    def get_sync_state(self, source: str) -> dict | None:
        source = _identifier(source, "source")
        with self._connection() as connection:
            row = connection.execute("SELECT state_json FROM sync_states WHERE source=?", (source,)).fetchone()
        return json.loads(row[0]) if row else None

    def set_sync_state(self, source: str, state: dict) -> None:
        source = _identifier(source, "source")
        if not isinstance(state, dict):
            raise ValueError("Synchronization state must be a mapping.")
        with self._connection() as connection:
            connection.execute(
                "INSERT INTO sync_states(source,state_json) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET state_json=excluded.state_json",
                (source, _json(_safe_metadata(state))),
            )

    @staticmethod
    def _manifest_identity(source: str, item: dict) -> tuple[str, str]:
        source_id = item.get("source_id", item.get("id", item.get("law_id")))
        if isinstance(source_id, str) and source_id.startswith(f"{source}:"):
            source_id = source_id[len(source) + 1:]
        return _identifier(source_id, "manifest source_id"), str(item.get("version_id", item.get("version", "")) or "")

    def save_manifest(self, source: str, items: list[dict], run_id: str) -> None:
        """Append catalogue pages idempotently; preserve precise stable-ID/version pairs."""
        source, run_id = _source(source), _identifier(run_id, "run_id")
        if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
            raise ValueError("Catalogue items must be a list of mappings.")
        values = []
        for item in items:
            source_id, version_id = self._manifest_identity(source, item)
            values.append((source, run_id, source_id, version_id, _json(_safe_metadata(item))))
        with self._connection() as connection:
            connection.executemany(
                "INSERT INTO manifests(source,run_id,source_id,version_id,item_json) VALUES (?,?,?,?,?) "
                "ON CONFLICT(source,run_id,source_id,version_id) DO UPDATE SET item_json=excluded.item_json",
                values,
            )

    def catalog_items(self, source: str, run_id: str) -> list[dict]:
        source = _source(source)
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT item_json FROM manifests WHERE source=? AND run_id=? ORDER BY source_id,version_id",
                (source, str(run_id)),
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def mark_snapshot(self, source: str, run_id: str, successful_ids: list[Any]) -> None:
        """Activate only the manifest's successfully retrieved, precise versions."""
        source, run_id = _source(source), _identifier(run_id, "run_id")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            selected: set[tuple[str, str]] = set()
            for success in successful_ids:
                if isinstance(success, dict):
                    source_id, requested_version = self._manifest_identity(source, success)
                    pairs = [(source_id, requested_version)]
                elif isinstance(success, (tuple, list)) and len(success) == 2:
                    pairs = [(str(success[0]).removeprefix(f"{source}:"), str(success[1]))]
                else:
                    source_id = str(success).removeprefix(f"{source}:")
                    rows = connection.execute(
                        "SELECT source_id,version_id FROM manifests WHERE source=? AND run_id=? AND source_id=?",
                        (source, run_id, source_id),
                    ).fetchall()
                    pairs = [(row[0], row[1]) for row in rows]
                    # Standalone ingestion is useful even without a catalogue manifest.
                    if not pairs:
                        pairs = [(source_id, "")]
                for source_id, version_id in pairs:
                    query = "SELECT law_id,version_id FROM documents WHERE source=? AND source_id=?"
                    parameters: list[Any] = [source, source_id]
                    if version_id:
                        query += " AND (upstream_version_id=? OR version_id=?)"
                        parameters.extend((version_id, version_id))
                    query += " ORDER BY fetched_at DESC,version_id DESC LIMIT 1"
                    row = connection.execute(query, parameters).fetchone()
                    if row:
                        selected.add((row[0], row[1]))
            connection.execute("UPDATE documents SET active=0 WHERE source=?", (source,))
            connection.execute("DELETE FROM snapshot_documents WHERE source=? AND run_id=?", (source, run_id))
            connection.executemany(
                "INSERT INTO snapshot_documents(source,run_id,law_id,version_id) VALUES (?,?,?,?)",
                [(source, run_id, law_id, version_id) for law_id, version_id in selected],
            )
            connection.executemany(
                "UPDATE documents SET active=1 WHERE law_id=? AND version_id=?", selected,
            )
            connection.execute(
                "INSERT INTO snapshots(source,run_id,captured_at) VALUES (?,?,?) "
                "ON CONFLICT(source,run_id) DO UPDATE SET captured_at=excluded.captured_at",
                (source, run_id, _now()),
            )
            connection.execute(
                "INSERT INTO current_snapshots(source,run_id) VALUES (?,?) "
                "ON CONFLICT(source) DO UPDATE SET run_id=excluded.run_id", (source, run_id),
            )

    def set_coverage(self, value: dict) -> None:
        if not isinstance(value, dict):
            raise ValueError("Coverage must be a mapping.")
        with self._connection() as connection:
            connection.execute(
                "INSERT INTO settings(key,value_json) VALUES ('coverage',?) "
                "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
                (_json(_safe_metadata(value)),),
            )

    def current_documents(self, source: str) -> list[dict]:
        """Read snapshot evidence summaries without loading every original body."""
        source = _source(source)
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT law_id,source,source_id,version_id,upstream_version_id,title,raw_sha256,"
                "publication_date,effective_date FROM documents WHERE active=1 AND source=? "
                "ORDER BY effective_date,publication_date,fetched_at,version_id", (source,),
            ).fetchall()
        return [{**dict(row), "sha256": row["raw_sha256"]} for row in rows]

    def version_evidence(self, source: str, source_id: str, version_id: str) -> dict | None:
        """Return an archived version summary when a resume activates it later."""
        source = _source(source)
        with self._connection() as connection:
            row = connection.execute(
                "SELECT law_id,source_id,version_id,upstream_version_id,title,raw_sha256 FROM documents "
                "WHERE source=? AND source_id=? AND (upstream_version_id=? OR version_id=?) "
                "ORDER BY fetched_at DESC,version_id DESC LIMIT 1",
                (source, str(source_id), str(version_id), str(version_id)),
            ).fetchone()
        return {**dict(row), "sha256": row["raw_sha256"]} if row else None

    def save_changes(self, source: str, run_id: str, changes: list[dict]) -> None:
        """Store the entire run report separately from bounded status previews."""
        source, run_id = _source(source), _identifier(run_id, "run_id")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM sync_changes WHERE source=? AND run_id=?", (source, run_id))
            connection.executemany(
                "INSERT INTO sync_changes(source,run_id,sequence,change_json) VALUES (?,?,?,?)",
                [(source, run_id, sequence, _json(_safe_metadata(change)))
                 for sequence, change in enumerate(changes)],
            )

    def get_changes(self, run_id: str | None = None, source: str | None = None,
                    limit: int = 20, offset: int = 0) -> dict:
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 1000:
            raise ValueError("Change report limit must be between 1 and 1000.")
        if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
            raise ValueError("Change report offset must be nonnegative.")
        selected_run = run_id or self.coverage().get("run_id")
        if not selected_run:
            return {"items": [], "total": 0, "limit": limit, "offset": offset, "run_id": None}
        clauses, values = ["run_id=?"], [str(selected_run)]
        if source is not None:
            clauses.append("source=?")
            values.append(_source(source))
        where = " AND ".join(clauses)
        with self._connection() as connection:
            total = connection.execute("SELECT COUNT(*) FROM sync_changes WHERE " + where, values).fetchone()[0]
            rows = connection.execute(
                "SELECT change_json FROM sync_changes WHERE " + where + " ORDER BY source,sequence LIMIT ? OFFSET ?",
                [*values, limit, offset],
            ).fetchall()
        return {"items": [json.loads(row[0]) for row in rows], "total": total,
                "limit": limit, "offset": offset, "run_id": selected_run}

    def coverage(self) -> dict:
        """Reconcile readiness with the current run, rather than trusting old counts."""
        with self._connection() as connection:
            saved = connection.execute("SELECT value_json FROM settings WHERE key='coverage'").fetchone()
            coverage = json.loads(saved[0]) if saved else {"complete": False, "scope": list(SOURCES), "sources": {}}
            sources = coverage.setdefault("sources", {})
            scope = coverage.get("scope", list(sources) or list(SOURCES))
            if isinstance(scope, dict):
                scope = scope.get("sources", [])
            if not isinstance(scope, list):
                scope = []
            coverage["scope"] = scope
            complete = bool(scope)
            for source in scope:
                details = sources.setdefault(source, {})
                details.setdefault("expected", None)
                details.setdefault("collected", 0)
                details.setdefault("failed", 0)
                details.setdefault("status", "not_synced")
                details.setdefault("errors", [])
                details.setdefault("pages", 0)
                current = connection.execute(
                    "SELECT c.run_id,s.captured_at FROM current_snapshots c "
                    "JOIN snapshots s ON c.source=s.source AND c.run_id=s.run_id WHERE c.source=?", (source,),
                ).fetchone()
                count = 0
                if current:
                    count = connection.execute(
                        "SELECT COUNT(*) FROM snapshot_documents WHERE source=? AND run_id=?", (source, current[0]),
                    ).fetchone()[0]
                    details.setdefault("last_synced_at", current[1])
                details["snapshot_collected"] = count
                run_matches = bool(current and details.get("run_id") == current[0])
                details["snapshot_current"] = run_matches
                try:
                    counts_match = details["expected"] is not None and int(details["expected"]) == int(details["collected"]) == count
                    failed = int(details["failed"])
                except (TypeError, ValueError):
                    counts_match, failed = False, 1
                ready = (
                    source in SOURCES and details.get("supported", True) is not False
                    and details["status"] in {"complete", "completed", "success"}
                    and run_matches and counts_match and failed == 0 and not details["errors"]
                )
                details["complete"] = ready
                complete = complete and ready
            coverage["complete"] = complete
            coverage["limitations"] = list(dict.fromkeys([*coverage.get("limitations", []), *_LIMITATIONS]))
            coverage["historical_complete"] = False
            coverage["annexes_verified"] = False
        return coverage

    def _temporal_verified(self, connection: sqlite3.Connection, row: sqlite3.Row, as_of: str) -> bool:
        # A publication/effective date is necessary, but not sufficient: a recorded
        # successful catalogue snapshot must also contain this version at that date.
        if (not row["publication_date"] or not row["effective_date"]
                or row["publication_date"] > as_of or row["effective_date"] > as_of):
            return False
        snapshot = connection.execute(
            "SELECT run_id FROM snapshots WHERE source=? AND substr(captured_at,1,10)<=? "
            "ORDER BY captured_at DESC LIMIT 1", (row["source"], as_of),
        ).fetchone()
        if not snapshot:
            return False
        return connection.execute(
            "SELECT 1 FROM snapshot_documents WHERE source=? AND run_id=? AND law_id=? AND version_id=?",
            (row["source"], snapshot[0], row["law_id"], row["version_id"]),
        ).fetchone() is not None

    def _document(self, connection: sqlite3.Connection, row: sqlite3.Row, as_of: str, *, summary: bool = False) -> dict:
        verified = self._temporal_verified(connection, row, as_of)
        document = {key: row[key] for key in (
            "law_id", "source", "source_id", "version_id", "upstream_version_id", "title",
            "publication_date", "effective_date", "publication_no", "source_url", "raw_sha256",
            "raw_path", "raw_format", "fetched_at",
        )}
        document.update({"id": row["law_id"], "sha256": row["raw_sha256"], "as_of": as_of, "temporal_verified": verified,
                         "historical_complete": False, "legal_authority_verified": False,
                         "active": bool(row["active"])})
        if not summary:
            evidence_verified = self._raw_integrity(row)
            metadata = json.loads(row["metadata_json"])
            document.update({"text": row["text"], "provisions": json.loads(row["provisions_json"]),
                             "metadata": metadata,
                             "evidence_verified": evidence_verified,
                             "raw_integrity_verified": evidence_verified,
                             "integrity_verified": evidence_verified,
                             "supplementary_provisions": metadata.get("supplementary_provisions", []),
                             "attachments": metadata.get("attachments", []),
                             "attachment_count": metadata.get("attachment_count", len(metadata.get("attachments", [])))})
            if not evidence_verified:
                document["temporal_verified"] = False
        return document

    @staticmethod
    def _selection(as_of: str, historical: bool, source: str | None = None) -> tuple[str, list[Any]]:
        clauses: list[str] = []
        parameters: list[Any] = []
        if not historical:
            clauses.append("active=1")
        else:
            clauses.extend(["publication_date<>''", "effective_date<>''", "publication_date<=?", "effective_date<=?"])
            parameters.extend((as_of, as_of))
            # Explicit dates, including today's date, use the latest recorded
            # snapshot at that date. Only a date before the first snapshot may
            # inspect archival versions without asserting temporal verification.
            clauses.append("""(
                NOT EXISTS (
                    SELECT 1 FROM snapshots prior_snapshot
                    WHERE prior_snapshot.source=documents.source
                        AND substr(prior_snapshot.captured_at,1,10)<=?
                ) OR EXISTS (
                    SELECT 1 FROM snapshot_documents membership
                    WHERE membership.source=documents.source
                        AND membership.law_id=documents.law_id
                        AND membership.version_id=documents.version_id
                        AND membership.run_id=(
                            SELECT chosen_snapshot.run_id FROM snapshots chosen_snapshot
                            WHERE chosen_snapshot.source=documents.source
                                AND substr(chosen_snapshot.captured_at,1,10)<=?
                            ORDER BY chosen_snapshot.captured_at DESC LIMIT 1
                        )
                )
            )""")
            parameters.extend((as_of, as_of))
        if source is not None:
            clauses.append("source=?")
            parameters.append(_source(source))
        return " AND ".join(clauses), parameters

    def search(self, query: str = "", as_of: str | None = None, source: str | None = None,
               limit: int = 20, offset: int = 0) -> dict:
        as_of_date = _date(as_of)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 500:
            raise ValueError("Search limit must be between 1 and 500.")
        if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
            raise ValueError("Search offset must be nonnegative.")
        where, parameters = self._selection(as_of_date, as_of is not None, source)
        prefix = f"""WITH ranked AS (
            SELECT *,ROW_NUMBER() OVER (
                PARTITION BY law_id ORDER BY effective_date DESC,publication_date DESC,fetched_at DESC,version_id DESC
            ) AS rank FROM documents WHERE {where}
        ) """
        condition = "rank=1"
        if query:
            escaped = str(query).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            title_query = _title_key(str(query)).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            condition += " AND (search_text LIKE ? ESCAPE '\\' OR title_key LIKE ? ESCAPE '\\')"
            parameters.extend((f"%{escaped}%", f"%{title_query}%"))
        with self._connection() as connection:
            total = connection.execute(prefix + "SELECT COUNT(*) FROM ranked WHERE " + condition, parameters).fetchone()[0]
            rows = connection.execute(
                prefix + "SELECT * FROM ranked WHERE " + condition + " ORDER BY title,law_id LIMIT ? OFFSET ?",
                [*parameters, limit, offset],
            ).fetchall()
            items = [self._document(connection, row, as_of_date, summary=True) for row in rows]
        return {"items": items, "total": total, "limit": limit, "offset": offset,
                "as_of": as_of_date, "coverage": self.coverage()}

    def get(self, law_id: str, as_of: str | None = None) -> dict | None:
        as_of_date = _date(as_of)
        where, parameters = self._selection(as_of_date, as_of is not None)
        with self._connection() as connection:
            row = connection.execute(
                f"SELECT * FROM documents WHERE {where} AND law_id=? "
                "ORDER BY effective_date DESC,publication_date DESC,fetched_at DESC,version_id DESC LIMIT 1",
                [*parameters, str(law_id)],
            ).fetchone()
            return self._document(connection, row, as_of_date) if row else None

    def resolve_citation(self, law_name: str, article_no: str, as_of: str | None = None) -> dict:
        coverage = self.coverage()
        try:
            as_of_date = _date(as_of)
        except ValueError:
            return {"law": None, "article": None, "found": False, "ambiguous": False,
                    "as_of": as_of, "coverage": coverage, "temporal_verified": False,
                    "reason": "invalid_as_of"}
        result: dict[str, Any] = {"law": None, "article": None, "found": False, "ambiguous": False,
                                  "as_of": as_of_date, "coverage": coverage, "temporal_verified": False}
        article = _article_key(article_no)
        if not article or not str(law_name).strip():
            result["reason"] = "invalid_citation"
            return result
        # Citation resolution always needs a known, in-force date selection;
        # catalogue browsing without a date may also expose future versions.
        where, parameters = self._selection(as_of_date, True)
        with self._connection() as connection:
            rows = connection.execute(f"""
                WITH ranked AS (
                    SELECT *,ROW_NUMBER() OVER (
                        PARTITION BY law_id ORDER BY effective_date DESC,publication_date DESC,fetched_at DESC,version_id DESC
                    ) AS rank FROM documents WHERE {where}
                ) SELECT * FROM ranked WHERE rank=1 AND (title_key=? OR law_id=?) ORDER BY law_id
            """, [*parameters, _title_key(str(law_name)), str(law_name)]).fetchall()
            if len(rows) > 1:
                result.update({"ambiguous": True, "reason": "ambiguous_law_title",
                               "candidates": [self._document(connection, row, as_of_date, summary=True) for row in rows]})
                return result
            if not rows:
                result["reason"] = "law_not_collected"
                return result
            law = self._document(connection, rows[0], as_of_date)
        result["law"] = law
        matching = [item for item in law["provisions"] if _article_key(item.get("article_no")) == article]
        if len(matching) > 1:
            result.update({"ambiguous": True, "reason": "ambiguous_article"})
            return result
        if not matching:
            result["reason"] = "article_not_collected"
            return result
        result["article"] = matching[0]
        if not law.get("evidence_verified", False):
            result["reason"] = "original_evidence_integrity_failure"
            return result
        if not law["temporal_verified"]:
            result["reason"] = "historical_snapshot_unverified"
            return result
        if matching[0].get("deleted") or str(matching[0].get("text", "")).strip() in {"삭제", "(삭제)", "[삭제]"}:
            result["reason"] = "article_deleted"
            return result
        result.update({"found": True, "temporal_verified": True})
        return result
