# RuleCraft

마크다운 규정집에서 상위법·지침·서식의 관계를 탐색하고, 개정 초안의 인용과 변경 영향도를 검사하여 검토 문서 패키지를 만드는 웹 작업 공간입니다. 첨부 PDR의 핵심 흐름을 로컬 파일 기반으로 구현합니다.

## 웹에서 실제 MCP 실행

왼쪽 메뉴의 **MCP 도구**에서 예제를 선택하고 **실제 MCP 실행**을 누르세요. API 호스트가 공식 MCP SDK로 stdio 서버를 초기화하고 `tools/call`을 실행합니다. 각 요청이 끝나면 MCP 작업 프로세스를 정리합니다. 기존 규정 편집·문서 위저드는 REST API를 사용하며 같은 그래프·문서 엔진을 공유합니다.

| 예제 | 브라우저에서 확인한 결과 |
| --- | --- |
| 공공데이터제공지침 제7조 상위법 조회 | 대상 조문과 상위법 2개, 총 3개 노드 |
| 개인정보보호법 제15조에 AI 학습 요건 추가 | 직접·간접 영향 문서 7개 |
| 데이터 반출 조문 개정안 비교 | 현행 / 개정안 / 개정이유 3열 대비표 |
| 이미지 서식 분석 | Vision 미연결 상태를 실제 `unavailable` 응답으로 표시 |

아래 화면은 브라우저에서 실제 MCP 호출을 마친 뒤 캡처했습니다. [실행 증거](docs/mcp-evidence.json)와 [추가 화면](docs/screenshots)을 함께 저장합니다.

![실제 MCP 조문 관계 조회 결과](docs/screenshots/mcp-graph.png)

![상위법 변경으로 인한 7개 문서 영향 분석](docs/screenshots/mcp-impact.png)

![MCP로 생성한 신구조문대비표](docs/screenshots/mcp-diff.png)

## 실행

Python 3.12 이상, `uv`, Node.js 22.12 이상, npm이 필요합니다. 저장소 루트에서 실행하세요. 현재 클라우드 환경에서는 Python 3.12.14와 Node.js 24.19.0으로 검증했습니다.

```bash
# 클라우드 환경의 쓰기 가능한 캐시 경로
export UV_CACHE_DIR=/workspace/.cache/uv
export npm_config_cache=/workspace/.cache/npm

uv sync --project backend --frozen
npm ci --prefix frontend
```

서로 다른 터미널에서 백엔드와 프런트엔드를 실행합니다.

설치·빌드·테스트를 한 번에 실행하려면 `bash scripts/setup.sh`, 두 서버를 함께 시작하려면 `bash scripts/dev.sh`를 사용하세요. 시작 스크립트는 API와 지식그래프 응답을 확인하고, 종료 시 자신이 시작한 서버를 정리합니다.

```bash
uv run --project backend uvicorn rulecraft.api:app --host 127.0.0.1 --port 8000
```

```bash
npm run dev --prefix frontend -- --host 0.0.0.0 --port 5173
```

브라우저에서 `http://localhost:5173`에 접속합니다. 개발 서버가 `/api` 요청을 백엔드에 전달합니다. API 문서는 `http://localhost:8000/docs`에서 확인할 수 있습니다. 각 클라우드 작업은 이미 격리된 환경에서 실행되므로 기존 체크아웃을 사용하며 별도 Git worktree가 필요하지 않습니다.

외부 접근이 필요한 개발 환경에서는 접근 범위를 확인하고 백엔드의 `--host`를 `0.0.0.0`으로 지정할 수 있습니다.

## 시연 흐름

1. 지식그래프에서 상위법·기관 지침·별지 서식의 연결과 조문 원문을 확인합니다.
2. 개정 목적, 개정 유형, 시행 예정일을 입력하고 초안을 작성합니다.
3. 편집한 조문의 인용 검사, 역링크 영향도, 조 번호 변경 제안을 확인합니다.
4. 검증을 통과한 초안으로 신구조문대비표, 이유서, 부칙안, 예고문안, 서식 정비안, 영향도 보고서를 검토하고 Markdown ZIP을 내려받습니다.

존재하지 않는 인용, 중복된 조문 번호와 식별자는 검토 패키지 생성을 차단합니다. `제7조의2`는 독립된 조문으로 처리하므로 신설만으로 기존 제8조 이후 번호를 밀지 않습니다. 인용 정비는 검토 제안이며 자동 공포나 Git 병합을 수행하지 않습니다.

## 지식 저장소와 MCP

지식 저장소는 YAML frontmatter와 `[[경로#제N조]]` 링크를 포함한 Markdown 파일입니다. 전용 그래프 DB가 필요하지 않습니다. 기본 샘플 저장소 대신 `RULECRAFT_VAULT` 환경 변수로 기관 규정 폴더를 지정할 수 있습니다.

```bash
export RULECRAFT_VAULT=/absolute/path/to/legal-knowledge-vault
uv run --project backend rulecraft-mcp
```

MCP 서버는 표준 stdio 프로토콜을 사용하며 그래프 조회, 변경 영향도 분석, 신구조문대비표 생성과 선택적 Vision 도구를 제공합니다. MCP 클라이언트의 실행 명령을 `uv`, 인수를 `run --project /absolute/path/to/raw/backend rulecraft-mcp`로 설정하고 같은 저장소 환경 변수를 전달하세요.

외부 모델, LLaVA OCR, 국가법령 API는 기본 연결되어 있지 않습니다. 기본 입안은 검토용 템플릿을 사용합니다. 필요한 경우 [선택적 서비스 설정](docs/adapters.md)을 따라 연결할 수 있습니다.

## 검증

```bash
uv run --project backend python -m unittest discover -s tests -v
npm run build --prefix frontend
```

[검증 범위](docs/validation.md)는 인용 해석, 순환 역링크, 조 번호 변경, 잘못된 Diff, 경로 이탈, 패키지 차단 및 MCP 호출을 설명합니다.

## 적용 범위

샘플 법령·기관 규정은 시연 데이터이며 실제 법령의 공식 원문이 아닙니다. 실무 적용 시 최신 공식 자료로 지식 저장소를 구축하고 기관별 절차·서식을 확인해야 합니다. 자동 검사는 로컬 문서의 구조와 인용 존재 여부를 확인하며, 법률 해석이나 상위법 위임 범위의 적법성을 보증하지 않습니다. 법제 심사자와 담당자의 검토를 거쳐 문안을 확정하세요.

산출물은 Markdown 검토 초안입니다. HWP/PDF 렌더링, 전자결재·공포 연계, 실제 다중 LLM 에이전트 운영과 OCR 모델 설치는 별도 확장 사항입니다.

현재 위저드는 선택한 한 조문을 중심으로 검토합니다. 제정·전부개정 유형을 선택해도 규정 전체를 새로 작성하거나 전면 개정하지 않으며, 문서 전체의 정합성은 별도 검토가 필요합니다.
