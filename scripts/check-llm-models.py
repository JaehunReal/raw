"""Run the real drafting workflow against one or more OpenAI-compatible models.

Example (Ollama on this computer):
    uv run --project backend --frozen python scripts/check-llm-models.py \
        --base-url http://127.0.0.1:11434/v1 gemma3:4b exaone3.5:2.4b

The API key, if needed, is read only from RULECRAFT_LLM_API_KEY and is never printed
or written. The bundled synthetic vault is copied to a temporary folder, so the
original files are not modified. Results are written to --out as JSON evidence.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from rulecraft.graph import GraphStore  # noqa: E402
from rulecraft.law_store import LawStore  # noqa: E402
from rulecraft.workflow import PackageWorkflow  # noqa: E402

REQUEST = {
    "agency": "한국행정연구원",
    "rule_name": "공공데이터제공지침",
    "article_id": "KIPA-RULE-DAT-007",
    "objective": "개인정보가 포함된 연구데이터를 반출할 때 AI 학습 목적 여부를 신청서에 기재하도록 정비",
    "amendment_reason": "AI 학습 목적의 데이터 반출에 대한 사전 확인 강화",
    "amendment_type": "partial",
    "effective_date": "2027-01-01",
}


def tree_digest(folder: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(p for p in folder.rglob("*") if p.is_file()):
        digest.update(path.relative_to(folder).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def check(model: str, base_url: str, vault: Path, law_dir: Path, packages: Path) -> dict:
    os.environ["RULECRAFT_LLM_BASE_URL"] = base_url
    os.environ["RULECRAFT_LLM_MODEL"] = model
    started = time.monotonic()
    try:
        result = PackageWorkflow(GraphStore(vault), packages, LawStore(law_dir)).run(dict(REQUEST))
    except Exception as error:  # report, never crash the whole comparison
        return {"model": model, "model_call_ok": False, "status": "error",
                "error": f"{type(error).__name__}: {error}"[:300],
                "seconds": round(time.monotonic() - started, 1)}
    issues = result["verification"]["issues"]
    codes = sorted({issue.get("code", "") for issue in issues if issue.get("severity", "error") == "error"})
    call_ok = result["provenance"] == "openai_compatible" and "drafting_unavailable" not in codes
    article = next((d for d in result["documents"] if d["name"].startswith("01_")), None)
    return {
        "model": model,
        "model_call_ok": call_ok,
        "provenance": result["provenance"],
        "status": result["status"],
        "documents": len(result["documents"]),
        "blocking_issue_codes": codes,
        "seconds": round(time.monotonic() - started, 1),
        "draft_excerpt": (article["content"][-400:] if article else None),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("models", nargs="+", help="model identifiers, e.g. gemma3:4b exaone3.5:2.4b")
    parser.add_argument("--base-url", required=True, help="OpenAI-compatible base URL ending in /v1")
    parser.add_argument("--vault", default=str(ROOT / "legal-knowledge-vault"))
    parser.add_argument("--out", default="llm-model-check.json")
    args = parser.parse_args()

    source = Path(args.vault).resolve()
    before = tree_digest(source)
    rows = []
    with tempfile.TemporaryDirectory(prefix="rulecraft-llm-") as temp:
        work = Path(temp)
        vault = work / "vault"
        shutil.copytree(source, vault)
        for model in args.models:
            print(f"[{model}] 초안 생성 중...", flush=True)
            rows.append(check(model, args.base_url.rstrip("/"), vault, work / "laws", work / "packages"))
    unchanged = tree_digest(source) == before

    print()
    print(f"{'모델':<24}{'모델 호출':<10}{'판정':<10}{'문서':<6}{'소요(초)':<9}차단 사유")
    for row in rows:
        print(f"{row['model']:<24}{'성공' if row['model_call_ok'] else '실패':<10}{row['status']:<10}"
              f"{row.get('documents', 0):<6}{row['seconds']:<9}{', '.join(row.get('blocking_issue_codes', [])) or row.get('error', '-')}")
    print(f"\n원본 규정집 변경 없음: {unchanged}")

    evidence = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": args.base_url.split("//")[-1].split("/")[0],
        "request": REQUEST, "results": rows, "source_vault_unchanged": unchanged,
        "note": "검토용 초안 생성 검증. 초안의 법적 적합성은 담당자 확인 대상이며 정확도 측정이 아님.",
    }
    Path(args.out).write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"검증 기록 저장: {Path(args.out).resolve()}")
    return 0 if all(row["model_call_ok"] for row in rows) and unchanged else 1


if __name__ == "__main__":
    raise SystemExit(main())
