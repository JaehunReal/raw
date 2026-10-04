# Mac PostgreSQL 조회 연결

GitHub는 코드 배포, Vercel은 웹 화면과 서버 프록시, Mac은 수집 데이터와 PostgreSQL을 담당한다. 별도 클라우드 DB는 만들지 않는다.

`deploy/mac-gateway.mjs`는 127.0.0.1:8766에서만 대기한다. 길이가 충분한 서버 토큰을 요구하며 status/laws/document GET 조회만 허용한다. 데이터베이스는 공식 공개 뷰만 읽는 전용 계정을 사용한다. 로컬 DB 연결만 TLS를 생략하고 외부 HTTPS에서는 인증서를 검증한다.

Vercel Production에 `RULECRAFT_OFFICIAL_GATEWAY_URL`(HTTPS 원점 주소)과 `RULECRAFT_GATEWAY_TOKEN`(비공개)을 설정하면 공식 API가 Mac으로 조회를 전달한다. 토큰은 브라우저·Git·로그에 넣지 않는다. 환경 변수 변경 후 재배포한다. 주소가 없으면 기존 PostgreSQL 직접 연결 설정을 사용한다.

`deploy/official_mcp.py`는 공식 MCP SDK stdio 서버다. `official_status`, `official_search`, `official_document`를 제공한다. `RULECRAFT_GATEWAY_ENV`로 비공개 설정 파일을 지정한다. 원본 해시와 버전 식별자를 유지하며 수집·쓰기 도구는 제공하지 않는다.

Mac의 LaunchAgent로 API를 유지한다. 로그인 전 부팅 상태에서는 사용자 LaunchAgent가 실행되지 않으므로 재부팅 후 로그인 및 HTTPS 경로 상태를 확인한다. Tailscale Funnel은 계정에서 활성화해야 하며 설정 완료 전에는 외부 접속이 되지 않는다.

검증: 공식 API 23개 회귀 테스트, 프록시 테스트, 실제 PostgreSQL 검색 및 본문 조회, MCP 초기화·도구 목록·검색·본문 호출. 저장 건수는 수집 완전성이나 현재 법적 효력을 보증하지 않는다.
