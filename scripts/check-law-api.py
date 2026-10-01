"""Verify small real official-API samples without starting or populating a server.

Run from the repository root:
  uv run --env-file .env --project backend python scripts/check-law-api.py
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sys

from rulecraft.law_sources import LawClient, LawSourceError, SOURCES


def check_sources(client: LawClient, sources: list[str]) -> dict:
    report = {
        "checked_at": datetime.now(timezone(timedelta(hours=9))).isoformat(),
        "configured": client.configured,
        "scope": "one catalogue page and at most one full document per selected source",
        "provider_access_verified": False,
        "full_collection_verified": False,
        "writes_corpus": False,
        "sources": [],
    }
    for source in sources:
        result = {"source": source, "target": SOURCES[source]["target"],
                  "catalogue_verified": False, "full_document_verified": False}
        try:
            catalogue = client.catalog(source, page=1, page_size=1)
            result.update({"catalogue_verified": True, "catalogue_total": catalogue["total"],
                           "catalogue_sample_count": len(catalogue["items"])})
            if not catalogue["items"]:
                result["error"] = {"code": "empty_catalogue", "message": "목록이 비어 있어 본문 연결을 확인하지 못했습니다."}
            else:
                document = client.fetch_full(catalogue["items"][0])
                result.update({"full_document_verified": True,
                               "sample_title": document["title"],
                               "article_count": len(document["provisions"]),
                               "raw_bytes": len(document["raw"]),
                               "raw_sha256": hashlib.sha256(document["raw"]).hexdigest(),
                               "response_identity_verified": document["metadata"]["response_identity_verified"],
                               "response_version_verified": document["metadata"]["response_version_verified"],
                               "parse_warnings": document["metadata"]["parse_warnings"]})
        except LawSourceError as error:
            result["error"] = error.as_dict()
        report["sources"].append(result)
    report["provider_access_verified"] = bool(report["sources"]) and all(
        item["catalogue_verified"] and item["full_document_verified"] for item in report["sources"])
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="실제 법령 API의 소량 목록·본문 조회 확인. 수집 저장소를 변경하지 않습니다.")
    parser.add_argument("--sources", nargs="+", choices=list(SOURCES), default=list(SOURCES))
    parser.add_argument("--output", type=Path, help="인증값·본문을 제외한 JSON 결과 저장 경로")
    args = parser.parse_args()
    with LawClient(retries=0, timeout=15) as client:
        report = check_sources(client, list(dict.fromkeys(args.sources)))
        # Raw provider content or private request URLs never enter this report.
        encoded = json.dumps(report, ensure_ascii=False, indent=2)
        if client.oc and client.oc in encoded:
            encoded = encoded.replace(client.oc, "[redacted]")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0 if report["provider_access_verified"] else 2


if __name__ == "__main__":
    sys.exit(main())
