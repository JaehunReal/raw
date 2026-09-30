# 검증 범위

RuleCraft의 자동 검증은 마크다운 지식 저장소 안에서 확인할 수 있는 구조적 정합성을 대상으로 합니다. 법률 해석, 상위법의 최신성, 위임 범위의 적법성, 실제 기관의 절차 준수 여부는 담당자가 검토해야 합니다.

회귀 테스트는 다음 업무 위험을 확인합니다.

- 상대 경로 및 `규정 폴더#제N조` 인용이 실제 조문에 연결되는지, 중복되거나 존재하지 않는 인용을 통과시키지 않는지
- 역링크 영향도 탐색이 간접 의존 문서까지 찾고 순환 관계에서도 종료되는지
- 조 번호 변경 제안이 기존 인용을 찾으며 `제7조의2` 신설을 기존 `제8조` 이동으로 해석하지 않는지
- Unified Diff의 문맥과 범위가 원문에 맞는지, 잘못된 패치와 저장소 밖 경로를 거부하는지
- 유효한 초안의 검토 문서 패키지를 만들고 깨진 인용을 포함한 초안은 차단하는지
- MCP 클라이언트가 초기화, 도구 탐색, 실제 도구 호출을 수행할 수 있는지

웹 MCP 연동 테스트는 HTTP 요청을 통해 공식 MCP SDK의 실제 stdio 서버 프로세스를 시작하고 초기화·도구 조회·호출을 수행합니다. 그래프의 상위법 2개, 7개 의존 문서의 영향도, 3단 대비표 및 Vision 미연결 결과를 확인하며, 연결 시간 초과와 요청 취소 이후의 재연결도 검증합니다. 일반 REST 기능을 MCP 호출로 간주하거나 도구 응답을 모의 데이터로 대체하지 않습니다.

샘플 저장소의 법령과 기관명은 시연용 데이터입니다. 테스트 통과는 해당 데이터와 기능의 동작 확인이며 실제 법령의 정확성 또는 공포 가능성을 보증하지 않습니다.

공식 수집 관련 테스트는 합성 응답과 임시 원문 저장소를 사용합니다. 전체 페이지·개수·중복 대조, 실패 재개, 버전·해시 보존, 별도 색인, 날짜 불확실성, 추가·변경·목록 제외 이력과 영향 후보, 실제 HTTP→MCP의 공식 색인 조회, 원문을 입안 모델에 전달하는 흐름을 확인합니다. 조·항·호 인용은 구조화 원문이 있을 때 검사하고 파싱·시행 시점이 불확실할 때 존재나 부재를 확정하지 않습니다. 이 테스트는 공식 제공자의 실제 접근·원문 정확성·법적 적용성 검증과 구분합니다.

브라우저 검증은 실행 중인 개발 서버를 대상으로 별도로 수행합니다. 기본 주소는 `http://127.0.0.1:5173`이며 `RULECRAFT_BROWSER_URL`로 변경할 수 있습니다. Playwright와 Chromium이 있는 환경에서 다음 명령을 실행하세요.

```bash
# Playwright는 기본 백엔드 의존성이 아닌 선택적 검증 도구입니다.
RULECRAFT_CHROMIUM_PATH=/usr/bin/chromium \
  uv run --with playwright --project backend python tests/browser_smoke.py

# 웹에서 실제 MCP 예제를 실행하고 화면 및 응답 요약을 저장
RULECRAFT_CHROMIUM_PATH=/usr/bin/chromium \
  uv run --with playwright --project backend python tests/browser_mcp_smoke.py

# 실제 빈 공식 색인·수집 미완료 상태와 웹 조회·변경 이력·시연 구분 검증
RULECRAFT_CHROMIUM_PATH=/usr/bin/chromium \
  uv run --with playwright --project backend python tests/browser_laws_smoke.py

# 전문 읽기·수집 중/취소·실패 화면은 별도 메모리 합성 응답으로 검증
RULECRAFT_CHROMIUM_PATH=/usr/bin/chromium \
  uv run --with playwright --project backend python tests/browser_laws_smoke.py --ui-fixtures
```

다른 위치에 설치한 Chromium은 `RULECRAFT_CHROMIUM_PATH`로 지정합니다. 시연 저장소의 대시보드, 검색·편집 검증, 상위법 관계도, 7개 문서 영향 분석, 유효/차단 위저드, 미리보기, ZIP 다운로드와 390px 화면 탐색을 확인합니다. 원본 조문을 저장하지 않으며 이번 실행에서 만든 패키지 JSON만 정리합니다. 기본 패키지 폴더를 바꾼 서버에서는 같은 경로를 `RULECRAFT_BROWSER_PACKAGE_DIR`로 지정하세요.

MCP 브라우저 검증은 웹의 `MCP 도구` 화면에서 실제 도구 목록을 조회하고 4개 도구를 실행합니다. 상위법 2개를 포함한 조문 3개, 영향 문서 7개, 신구조문대비표와 Vision 미연결 상태를 API 응답 및 화면에서 함께 확인합니다. 인자 오류, 잘못된 JSON, 모바일 그래프·대비표도 검사합니다. 화면과 응답 요약은 `.rulecraft/demo/`에 저장하며 `RULECRAFT_MCP_ARTIFACTS`로 출력 폴더를 바꿀 수 있습니다. 원본 규정은 변경하지 않습니다.

운영 API 테스트는 미인증 조회·편집·수집·MCP가 처리 전에 차단되는지, 토큰 미설정 시 운영 API가 닫히는지, 인증 후 실제 MCP가 실행되는지 확인합니다. 패키지의 영구 경로 설정과 MCP 자식 프로세스에 웹·배포 토큰이 전달되지 않는지도 확인합니다. 개발 환경은 토큰을 설정하지 않으면 기존 동작을 유지합니다.

`npm run test:proxy`는 Node의 실제 HTTP 요청으로 로그인·서명 쿠키·만료·로그아웃·원점 검사·API 요청과 다운로드 전달을 검증합니다. 이 테스트의 외부 백엔드 요청은 모의 응답이며 공급자 배포를 검증하지 않습니다. 별도 `tests/browser_deployment_smoke.py`는 임시 HTTPS 게이트웨이와 운영 API를 함께 실행하고 실제 브라우저 로그인부터 실제 MCP 호출까지 확인합니다. 사용법과 외부 배포 요건은 [배포 문서](deployment.md)에 있습니다.
