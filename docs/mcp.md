# RuleCraft MCP 연결과 기능 확인

RuleCraft MCP는 사용자의 컴퓨터에서 실행하는 **stdio 서버**입니다. 로컬 규정 관계 조회, 변경 영향 분석, 신구조문대비표 작성에 사용할 수 있습니다. 공개 페이지 `https://raw-ecru.vercel.app`는 예제와 검증 기록을 보여주는 화면이며, MCP 클라이언트에 붙이는 원격 서버 주소가 아닙니다. 현재 공유 가능한 HTTP MCP 주소나 OAuth 로그인은 제공하지 않습니다.

## 처음 연결하기

Python 3.12 이상, Git, [uv](https://docs.astral.sh/uv/getting-started/installation/)를 준비합니다. 프런트엔드나 운영 API 서버를 실행할 필요는 없습니다. 기본 예제의 조회·분석·대비표 작성에는 법령 API 계정과 모델 키도 필요하지 않습니다.

```bash
git clone https://github.com/JaehunReal/raw.git
cd raw
uv sync --project backend --frozen
```

MCP 클라이언트의 로컬 서버 설정에 다음 객체를 추가합니다. `/absolute/path/to/raw`를 실제로 복제한 폴더의 **절대경로**로 바꾸세요. 기존 `mcpServers`가 있으면 그 안에 `rulecraft` 항목만 추가합니다.

```json
{
  "mcpServers": {
    "rulecraft": {
      "command": "uv",
      "args": [
        "run",
        "--frozen",
        "--project",
        "/absolute/path/to/raw/backend",
        "rulecraft-mcp"
      ],
      "env": {
        "RULECRAFT_VAULT": "/absolute/path/to/raw/legal-knowledge-vault",
        "RULECRAFT_LAW_DIR": "/absolute/path/to/raw/.rulecraft/national-law"
      }
    }
  }
}
```

`mcpServers` 설정을 받는 클라이언트에서 사용하는 예입니다. 다른 설정 형식을 쓰는 클라이언트에서는 `command`, `args`, `env` 값을 해당 서버 등록 항목에 넣습니다. 클라이언트를 다시 시작한 뒤 서버 이름 `RuleCraft`와 아래 네 도구가 검색되면 연결되었습니다. 예제 규정은 합성 자료이므로 실제 공식 법령으로 사용하지 마세요.

다른 폴더에서 실행해도 절대경로 설정으로 작동하는지 공식 MCP SDK 클라이언트로 확인했습니다. 기본 셸이 아닌 데스크톱 앱에서 `uv`를 찾지 못하면 `command`에 `uv` 실행 파일의 절대경로를 넣으세요. 셸에서 `command -v uv`, Windows에서는 `where uv`로 경로를 찾을 수 있습니다.

## 요청 예제와 확인할 결과

| 도구 | 하는 일 | 현재 범위 |
| --- | --- | --- |
| `query_markdown_graph` | 조문과 상위 근거·위임·역참조 관계 조회 | `local`은 규정집, `official`은 이미 저장한 공식 원문 조회. 공식 API를 실시간으로 호출하거나 전국 자료를 자동 수집하지 않음 |
| `analyze_git_delta_impact` | 개정안에 영향받는 문서와 인용 정비 후보 조회 | 전체 Markdown 또는 Unified Diff 입력. 원문을 저장하거나 Git에 커밋하지 않음 |
| `generate_statutory_diff` | 현행·개정안·개정이유 3단 대비표 작성 | Markdown 검토 초안. HWP/PDF 출력이나 법률 해석은 수행하지 않음 |
| `parse_form_with_vision` | 이미지의 서식·표를 Markdown으로 읽기 | Ollama Vision 모델 연결 필요. 미연결 시 `status: "unavailable"`, `markdown: null` 반환 |

클라이언트에서 다음과 같이 요청할 수 있습니다.

> RuleCraft로 한국행정연구원 공공데이터제공지침 제7조의 상위 근거 관계를 조회해 줘. 합성 예제임을 표시해 줘.

직접 호출하는 경우:

```json
{
  "agency_name": "한국행정연구원",
  "rule_name": "공공데이터제공지침",
  "article_no": 7,
  "traverse_direction": "UPWARD_PARENT",
  "source_scope": "local"
}
```

기본 예제에서는 대상 조문과 상위 근거를 합해 **3개 노드**가 나옵니다. `BACKLINKS`는 역참조, `DOWNWARD_DELEGATION`은 위임 방향, `ALL`은 연결 전체를 조회합니다. `article_no`에는 `"제7조의2"`도 사용할 수 있습니다.

변경 영향 분석 예제:

```json
{
  "target_file_path": "statutes/개인정보보호법/제15조_수집이용.md",
  "proposed_diff": "--- a/statutes/개인정보보호법/제15조_수집이용.md\n+++ b/statutes/개인정보보호법/제15조_수집이용.md\n@@ -20,1 +20,1 @@\n-개인정보가 포함된 연구데이터의 수집·이용 목적과 처리 근거를 사전에 확인하여야 한다.\n+개인정보가 포함된 연구데이터의 수집·이용 목적과 처리 근거 및 AI 학습 목적의 안전성 요건을 사전에 확인하여야 한다.\n"
}
```

현재 합성 예제에 위 변경안을 보내면 영향 후보 **7개**가 나옵니다. `proposed_diff`에는 **현재 파일과 일치하는 Diff** 또는 YAML frontmatter를 포함한 개정 파일 전체를 넣습니다. 파일을 수정한 뒤에는 실제 내용으로 Diff를 다시 작성하세요. 일치하지 않는 Diff는 오류로 보고합니다. `target_file_path`는 설정한 규정집 안의 상대경로입니다. 이 도구로 원문 파일이 수정되지는 않습니다.

대비표 작성 예제:

```json
{
  "current_markdown": "# 제7조\n① 신청서를 제출하여야 한다.",
  "revised_markdown": "# 제7조\n① 신청서에 처리 목적을 기재하여야 한다.",
  "amendment_reason": "신청 목적을 명확히 확인하기 위함"
}
```

`status: "draft"`, `requires_human_review: true`와 Markdown 표를 확인합니다. 이미지 도구는 `image_data_base64`에 실제 PNG/JPEG/WebP의 Base64 문자열을 넣고 `output_format`을 `markdown_table` 또는 `interactive_form`으로 지정합니다. 현재 모델이 연결되어 있지 않으므로 OCR 성공을 보여주는 예제 결과는 없습니다. 모델 설치와 환경 변수는 [선택적 서비스 설정](adapters.md)을 참고하세요.

공식 자료 조회는 다음처럼 요청합니다.

```json
{
  "agency_name": "국가법령",
  "rule_name": "개인정보 보호법",
  "article_no": 15,
  "source_scope": "official",
  "as_of": "2026-10-01"
}
```

저장된 원문이 없거나 해당 기준일의 조문을 확정할 수 없으면 빈 노드와 `official_citation_unavailable`을 반환합니다. `RULECRAFT_LAW_OC`를 넣는 것만으로 원문이 저장되지는 않습니다. 공식 수집·저장·기준일의 범위는 [공식 법령 문서](official-laws.md)를 확인하세요. 법령 이름은 저장된 공식 문서의 제목을 사용합니다.

## 화면의 봇 다섯 단계가 하는 일

웹 문서 위저드의 다섯 항목은 `PackageWorkflow`의 처리 단계입니다. 독립된 다섯 LLM 에이전트가 서로 토론하는 구조는 구현되어 있지 않습니다. 이 위저드 전체를 실행하는 MCP 도구도 현재 네 도구 목록에는 없습니다.

| 단계 | 실제 동작 | 확인한 제약 |
| --- | --- | --- |
| 절차 총괄 | 입안·협의·예고·심사·공포의 검토 순서 구성 | 실제 부서 협의·전자결재·공포를 실행하지 않음 |
| 지식그래프 조사 | 규정 관계와 저장된 공식 근거 조회 | 원문 저장 0건이면 공식 근거를 확보했다고 표시할 수 없음. 전체 적용법·위임 범위 판단은 별도 심사 필요 |
| 비전 서식 분석 | 이번 위저드에서는 기존 Markdown 서식 재사용 | 스캔 이미지 입력 경로가 없어 `skipped`; OCR은 별도 도구와 모델 연결 필요 |
| 조문 입안 | 사용자 개정안, 템플릿 또는 설정한 모델의 초안 사용 | 현재 모델 미연결이므로 `provenance: "template"`. LLM 추론을 수행하지 않음 |
| 정합성 검증 | 스키마·조문 번호·링크·확보한 원문의 인용 존재 검사 | 구조 검사 통과가 적법성 보증은 아님. `legal_authority_verified: false` 유지 |

유효한 초안에서는 검토 문서 7개를 생성합니다. 잘못된 인용·문서 구조는 생성과 다운로드를 차단합니다. 모델을 설정했는데 연결이 실패하면 성공한 템플릿으로 위장하지 않고 입안 오류를 반환합니다.

## 연결 문제와 검증 기록

| 증상 | 확인할 내용 |
| --- | --- |
| 서버를 시작하지 못함 | Python 3.12 이상, `uv` 경로, 저장소 절대경로, `uv sync --project backend --frozen` 실행 여부 |
| 쓰기 불가능한 uv 캐시 | 클라이언트 `env`에 쓰기 가능한 `UV_CACHE_DIR` 추가. 규정집을 캐시 폴더로 사용하지 않음 |
| `rulecraft-mcp`를 셸에서 실행했는데 아무 화면도 없음 | stdio 프로토콜의 정상 대기 상태. 브라우저에서 여는 서버가 아니며 MCP 클라이언트가 초기화 메시지를 보내야 함 |
| 조회 결과가 비어 있음 | 설정한 `RULECRAFT_VAULT`, 정확한 기관·규정명·조 번호, 문서 YAML frontmatter와 관계 링크 확인 |
| 공식 자료가 비어 있음 | 공식 저장소의 자료·버전·기준일 확인. API 계정 설정과 원문 저장은 별도 단계 |
| Vision `unavailable` | Ollama 주소와 설치된 Vision 모델 확인. 설정했다는 표시만으로 실제 모델 연결을 보증하지 않음 |
| Vercel 주소로 MCP 연결이 안 됨 | 현재 공개 주소는 읽기 전용 예제 페이지. 타인은 저장소를 복제해 로컬 stdio로 연결해야 함 |

인증 값은 공유 JSON이나 Git에 적지 않고 클라이언트의 비공개 환경 설정으로 전달합니다. 웹 로그인·Vercel 토큰은 로컬 MCP의 필수 설정이 아닙니다.

2026-10-01 한국 시간, 실제 MCP 초기화·도구 탐색·네 도구 호출과 임시 문서 워크플로를 확인했습니다. 로컬 MCP·브리지·워크플로·법령 검색 어댑터 관련 **20개 테스트**가 통과했습니다. 실제 OCR 모델과 외부 LLM을 연결한 검증, 공개 원격 MCP 서비스 검증은 수행하지 않았습니다. [기능·사용성 검증 기록](mcp-usability-evidence.json)에 결과와 범위를 저장합니다.

```bash
uv run --project backend --frozen python -m unittest tests.test_mcp tests.test_mcp_bridge tests.test_workflow tests.test_law_adapter -v
```
