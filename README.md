# RuleCraft (규정 관리 워크스페이스)

공식 법령 원문과 기관 Markdown 규정집에서 근거를 조회하고, 개정 초안의 인용과 변경 영향도를 검사하여 검토 문서 패키지를 제작하는 웹 기반 규정 관리 워크스페이스입니다.

대한민국 공공 디지털 서비스 UI/UX 가이드라인(**KR-DS**)을 준수하며, 법령 조·항·호 즉시 이동, 실시간 검색, 지식그래프 시각화, 신구조문대비표 자동 생성, 그리고 MCP(Model Context Protocol) 연동을 지원합니다.

---

## 🌐 배포 및 저장소 현황

| 구분 | 플랫폼 / 저장소 | 링크 | 상태 |
| :--- | :--- | :--- | :--- |
| **공개 웹 서비스** | Vercel Production | [https://raw-ecru.vercel.app](https://raw-ecru.vercel.app) | **배포 완료 (HTTP 200)** |
| **GitHub** | JaehunReal/raw | [github.com/JaehunReal/raw](https://github.com/JaehunReal/raw) | **최신 동기화 (`main`)** |
| **공공망 GitLab** | ryujh20/rulecraft | [gitlab.aigov.go.kr/ryujh20/rulecraft](https://gitlab.aigov.go.kr/ryujh20/rulecraft) | **보안 검사 통과 (`main`)** |

---

## ✨ 주요 기능 및 특징

### 1. KR-DS (대한민국 전자정부 디자인 시스템) 공공 UI/UX 적용
- **공식 정부 식별 배너**: 대한민국 공공 표준 상단 식별 배너 및 전용 헤더 레이아웃
- **고대비 가독성 및 반응형 레이아웃**: 공공기관 표준 색상 체계(Government Deep Blue, Slate Gray), 명확한 상태 배지, 모바일/데스크톱 최적화
- **접근성 최적화**: 스크린 리더 친화적 마크업, 명확한 키보드 포커스 및 탭 내비게이션 지원

### 2. 법령·규정 실시간 검색 & 조·항·호 즉시 이동 (Direct Provision Jump)
- **통합 검색**: 법령, 행정규칙, 자치법규 실시간 검색(디바운스 적용) 및 분류별 필터링
- **조·항·호 원클릭 즉시 이동**:
  - 인용 관계 카드 및 본문 내 `제○조`, `제○항`, `제○호` 링크 클릭 시 해당 조항으로 즉시 부드럽게 스크롤
  - 이동 후 대상 조문에 포커스 펄스 애니메이션(하이라이트)을 적용하여 신속한 조문 파악 지원
- **3단계 탭 뷰어**: 조문 본문, 인용/피인용 관계, 연관 관계 그래프를 탭 간 원클릭 전환

### 3. 규정 입안 위저드 & 신구조문대비표 자동 생성
- 개정 목적, 개정 유형, 시행 예정일 입력 기반 단계별 초안 작성
- 편집 조문의 실시간 인용 유효성 검사, 역링크 영향도 추적, 조 번호 충돌 감지
- 검증 통과 시 3열 신구조문대비표(현행 / 개정안 / 개정이유), 제안이유서, 부칙안, 규제영향보고서 등을 패키지(Markdown/ZIP)로 일괄 생성

### 4. 법령·규정 지식그래프 (Knowledge Graph)
- 법령 상위법-기관 지침-별지 서식 간 위임·근거 연결 구조 시각화
- YAML frontmatter와 `[[경로#제N조]]` 기반 경량 마크다운 그래프 파싱 (전용 DB 불필요)

### 5. MCP (Model Context Protocol) 연동
- 표준 stdio 프로토콜 기반 MCP 서버 (`rulecraft-mcp`)
- Claude Desktop, Cursor 등 AI 도구에서 조문 관계 탐색, 변경 영향 분석, 대조표 생성 도구 직접 호출 지원

| 예제 | 브라우저 확인 결과 |
| :--- | :--- |
| **공공데이터제공지침 제7조 상위법 조회** | 대상 조문과 상위법 2개, 총 3개 노드 |
| **개인정보보호법 제15조에 AI 학습 요건 추가** | 직접·간접 영향 문서 7개 분석 |
| **데이터 반출 조문 개정안 비교** | 현행 / 개정안 / 개정이유 3열 대비표 |
| **이미지 서식 분석** | Vision 미연결 상태를 실제 `unavailable` 응답으로 안전 표시 |

![실제 MCP 조문 관계 조회 결과](docs/screenshots/mcp-graph.png)

![상위법 변경으로 인한 7개 문서 영향 분석](docs/screenshots/mcp-impact.png)

![MCP로 생성한 신구조문대비표](docs/screenshots/mcp-diff.png)

---

## 🔒 공공망 보안 준수 체계 (GitLab Pre-receive Security Scan)

공공망(`gitlab.aigov.go.kr`) 배포를 위한 5대 사전 수신 보안 스캔을 100% 통과했습니다:

1. **Gitleaks (PASS)**: 소스코드 내 비인가 시크릿/토큰 유출 차단 (`.gitleaks.toml`, `.gitleaksignore` 정책 적용)
2. **Semgrep (PASS)**: 안전한 파서 사용 및 정적 취약점 규칙 충족 (`law_sources.py` XML 보안 규칙 준수)
3. **OSV-Scanner (PASS)**: 오픈소스 라이브러리 취약점 패치 (`source-map-js` 1.2.2 등)
4. **Trivy (PASS)**: 컨테이너 이미지 보안 (`Dockerfile` 내 non-root 계정 `rulecraft` 적용)
5. **Syft (PASS)**: 소프트웨어 자재명세서(SBOM) 무결성 검증

---

## 🚀 빠른 시작 (Local Development)

### 요구사항
- Node.js 22.12 이상 (또는 24.x)
- Python 3.12 이상, `uv`

### 1. 의존성 설치
```bash
# 백엔드 의존성
uv sync --project backend --frozen

# 프런트엔드 의존성
npm ci
npm ci --prefix frontend
```

### 2. 개발 서버 실행
한 번에 실행하려면:
```bash
bash scripts/dev.sh
```

또는 각각 실행:
```bash
# 터미널 1: Python 백엔드 API (포트 8000)
uv run --env-file .env --project backend uvicorn rulecraft.api:app --host 127.0.0.1 --port 8000

# 터미널 2: React 프런트엔드 (포트 5173)
npm run dev --prefix frontend -- --host 0.0.0.0 --port 5173
```

- 웹 브라우저 접속: `http://localhost:5173`
- Swagger API 문서: `http://localhost:8000/docs`

---

## 🧪 테스트 및 빌드 검증

```bash
# 백엔드 단위/통합 테스트
uv run --project backend python -m unittest discover -s tests -v

# 프런트엔드 프로덕션 빌드 검증
npm run build --prefix frontend

# 배포 프록시/법령 통합 테스트
npm run test:proxy
npm run test:official
```

---

## 📚 관련 기술 문서

- [PostgreSQL Vercel 연동 가이드](docs/postgresql-vercel.md)
- [MCP 클라이언트 연결 가이드](docs/mcp.md)
- [국가법령정보 API 연동 및 수집](docs/official-laws.md)
- [배포 및 인증 설정 안내](docs/deployment.md)
- [사용자 경험 및 기능 점검](docs/user-experience-review.md)
- [유효성 검증 규칙](docs/validation.md)
- [공개 시연 안내](docs/public-preview.md)

---

## ⚖️ 안내 및 유의사항

- 본 시스템에서 제공하는 샘플 규정은 시연용 합성 데이터입니다.
- 자동 검사는 로컬 문서의 인용 존재 여부와 조·항·호 정합성을 기술적으로 점검하며, 법률적 유권해석이나 적법성을 보증하지 않으므로 최종 문안은 반드시 법제 심사자와 담당자의 검토를 거쳐야 합니다.
- 산출물은 Markdown 기반 검토 초안 패키지입니다.
