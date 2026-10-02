# Vercel 공개 대시보드

공개 주소는 **[https://raw-ecru.vercel.app](https://raw-ecru.vercel.app)**입니다. 기존 Vercel `raw` 프로젝트가 GitHub `JaehunReal/raw`의 `main` 변경을 자동 배포합니다.

## 공식 법령 조회

공식 법령 현황은 Vercel 서버 함수가 PostgreSQL의 공개 법령 전용 뷰를 읽습니다. 연결 상태, 자료 종류별 저장 문서·버전 건수, 확인 시각, 법령명 검색, 종류별 필터, 저장된 본문·출처·원문 해시를 확인할 수 있습니다. 별도의 API 서버를 만들 필요는 없습니다.

실제 데이터베이스가 연결되지 않으면 저장 건수는 **미확인**으로 표시합니다. 연결 실패나 스키마 불일치를 실제 0건과 구분합니다. 기관 규정 예제와 과거 API 검사 기록을 실제 저장 데이터로 사용하지 않습니다. [PostgreSQL 연결 안내](postgresql-vercel.md)에 외부 접속·TLS·읽기 전용 권한·뷰·Vercel 환경 설정을 설명합니다.

본문은 저장소의 추출 법령 텍스트입니다. 원본 XML/JSON 파일을 내려받는 기능은 제공하지 않습니다. 저장 건수는 수집 완료율이나 전체 연혁·첨부파일·법적 적용성 검증을 뜻하지 않습니다. 공개 페이지에서 편집 저장, 수집 시작·중단, 새 문서 생성, 실시간 MCP 실행은 제공하지 않습니다.

## 기관 규정 예제와 검사 기록

합성 규정 예제 12개·관계 31개·검토 문서 7개는 저장소에 포함된 고정 자료입니다. 규정 원문 검색, 관계 탐색, 변경 영향 후보와 검토 문서 열람은 브라우저 안에서 동작합니다. 이 예제의 그래프는 연결된 PostgreSQL 법령 전체에서 자동 생성된 그래프가 아닙니다.

2026-10-01 15:19 한국 시간의 법령·행정규칙·자치법규 API 검사 기록은 자료별 목록·전문 1건을 조회한 결과입니다. 검사 자체는 원문을 저장하지 않았습니다. 법령의 응답 버전 식별자와 행정규칙의 항·호 구조·첨부파일 한계도 표시합니다. 당시 개발 환경의 저장 건수는 별도 수집 서버의 현재 건수가 아닙니다.

MCP 검증 기록은 도구 4개와 관계 조회 3개 노드 등 이전 실행 결과를 보여줍니다. 공개 주소가 외부 MCP 클라이언트의 접속 주소가 되지는 않습니다. [MCP 연결 안내](mcp.md)를 참고하세요.

## 설치·빌드

기존 프로젝트의 Root Directory는 저장소 루트(`.`)입니다. Node.js 24와 루트 `vercel.json`이 서버 함수 의존성, 프런트 빌드, `frontend/dist` 출력을 설정합니다. 데이터베이스 비밀번호나 법령 API 계정은 프런트엔드 변수에 넣지 않습니다.

```bash
npm ci --no-audit --no-fund
npm ci --prefix frontend --no-audit --no-fund
VITE_PUBLIC_PREVIEW=true VITE_REQUIRE_LOGIN=true npm run build --prefix frontend
```

기본 공개 화면은 `/api/official/*`의 GET 요청만 사용합니다. PostgreSQL 설정이 없어도 기관 규정 예제를 열 수 있으며 데이터 저장소는 연결 대기로 표시합니다. PostgreSQL 연결만을 위해 `VITE_PUBLIC_PREVIEW=false`로 바꾸지 않습니다.

Python API를 통한 규정 편집·문서 생성·MCP 실행이 필요하면 실제 HTTPS 서버와 운영 인증을 준비한 뒤 `VITE_PUBLIC_PREVIEW=false`로 전환합니다. 해당 경로는 [운영 API 연결 안내](deployment.md)에 설명합니다.

개발 중 기관 규정 예제를 갱신하려면 `uv run --project backend --frozen python scripts/build-public-preview.py`를 실행합니다. 이 명령은 `.env`나 실제 PostgreSQL을 읽지 않고 명시적인 시연 자료와 검사 기록만 처리합니다.

## 검증 범위

`tests/browser_public_preview_smoke.py`는 실제 Chromium에서 7개 메뉴, 원본 예제 문서·관계·패키지, PostgreSQL 연결 대기와 조회 상태, 390px 모바일 화면을 확인합니다. PostgreSQL 테스트 자료로 확인한 조회 동작은 사용자의 실제 데이터베이스 연결 증거와 구분합니다. 브라우저 검증은 캡처를 생성하지 않습니다.

실제 배포 확인은 Vercel의 READY 상태·Git 커밋, 공개 주소의 응답, 배포된 자산과 브라우저 동작으로 진행합니다. 클라우드 Chromium이 세션 프록시 인증서를 신뢰하지 못하면 실제 원격 응답을 TLS 검증을 유지한 Python HTTPS 요청으로 가져와 브라우저에 전달합니다. 로컬 자산으로 대체하거나 TLS 검증을 해제하지 않습니다.
