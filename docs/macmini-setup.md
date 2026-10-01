# 집에서 Mac mini 백엔드 준비하기

아래 명령은 Mac mini를 준비한 뒤 해당 기기의 터미널에서 직접 실행합니다. 현재 백엔드와 공개 HTTPS 연결은 아직 배포하지 않았습니다. 백엔드에는 **Git, Python 3.12 이상, uv**가 필요합니다. Node.js는 백엔드에 필요하지 않습니다.

## 1. 도구와 저장소 준비

Homebrew가 이미 있다면 다음 명령으로 준비할 수 있습니다. 없으면 [Homebrew](https://brew.sh/)와 [uv 설치 안내](https://docs.astral.sh/uv/getting-started/installation/)를 참고하세요. 이미 도구를 설치했다면 설치 단계를 건너뜁니다.

```bash
brew install git uv python@3.12
mkdir -p "$HOME/Projects"
cd "$HOME/Projects"
git clone https://github.com/JaehunReal/raw.git
cd raw
uv sync --project backend --python 3.12 --frozen
```

이미 복제한 저장소가 있으면 해당 폴더로 이동합니다. 이후 명령은 모두 저장소 루트에서 실행합니다.

## 2. 비공개 설정과 영구 저장 위치 만들기

다음 명령은 공식 API에 등록한 OC를 화면에 표시하지 않고 입력받고, 백엔드 인증 토큰을 Mac mini에서 생성합니다. 아직 OC를 등록하지 않았다면 Enter로 비워 둘 수 있습니다. 기존 `.env`가 있으면 덮어쓰지 않고 중단합니다.

```bash
uv run --project backend --frozen python - <<'PY'
from getpass import getpass
import json
import os
from pathlib import Path
import secrets
import shutil

settings = Path(".env")
if settings.exists():
    raise SystemExit("기존 .env가 있습니다. 덮어쓰지 않았습니다.")
oc = getpass("공식 API에 등록한 OC (미설정이면 Enter): ").strip()
if any(character in oc for character in "\r\n\0"):
    raise SystemExit("OC에 줄바꿈이나 제어 문자를 넣을 수 없습니다.")
data = Path.home() / "Library" / "Application Support" / "RuleCraft"
vault = data / "vault"
data.mkdir(parents=True, exist_ok=True)
if not vault.exists():
    shutil.copytree("legal-knowledge-vault", vault)
for name in ("national-law", "packages"):
    (data / name).mkdir(exist_ok=True)
values = {
    "RULECRAFT_DEPLOYMENT": "production",
    "RULECRAFT_API_TOKEN": secrets.token_urlsafe(48),
    "RULECRAFT_LAW_OC": oc,
    "RULECRAFT_VAULT": str(vault),
    "RULECRAFT_LAW_DIR": str(data / "national-law"),
    "RULECRAFT_PACKAGE_DIR": str(data / "packages"),
}
descriptor = os.open(settings, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
    for key, value in values.items():
        stream.write(key + "=" + json.dumps(value, ensure_ascii=False) + "\n")
print("비공개 .env를 생성했습니다. OC와 토큰은 출력하지 않았습니다.")
print("영구 저장 위치:", data)
PY
git check-ignore .env
```

마지막 명령은 `.env`라는 파일명만 출력해야 합니다. `.env`는 현재 사용자만 읽고 쓸 수 있는 권한으로 만들며 Git에서 제외됩니다. 파일 내용이나 토큰을 채팅·저장소·로그에 올리지 마세요. OC는 Mac mini 백엔드에만 설정하고 Vercel이나 브라우저에 넣지 않습니다. 저장 경로에 포함된 공백은 `.env`의 따옴표로 처리됩니다.

규정집은 처음에만 복사하고 기존 규정 폴더를 덮어쓰지 않습니다. 공식 원문은 `national-law`, 생성 패키지는 `packages`에 따로 저장합니다. 이 폴더의 백업과 복구도 운영 전에 확인해야 합니다.

## 3. 공식 API 연결부터 확인

서버를 시작하기 전에 세 자료 범위에서 목록 1건과 본문 최대 1건씩만 요청합니다. 다음 명령은 원문 저장소에 자료를 넣거나 전체 수집을 시작하지 않습니다.

```bash
uv run --env-file .env --project backend --frozen \
  python scripts/check-law-api.py
```

`provider_access_verified: true`와 종료 코드 0이면 선택한 범위의 소량 목록·본문 응답을 확인한 것입니다. 종료 코드 2이면 각 자료 범위의 `error`를 확인합니다. `proxy_access_denied`는 실행 환경 프록시 차단이고, 계정이 승인되었다는 증거가 아닙니다. HTTP 오류·오류 본문·파싱 실패도 따로 확인해야 합니다. 성공하더라도 전국 수집량, 전체 과거 버전이나 기관 적용성이 검증된 것은 아닙니다.

## 4. 로컬에서 실행하고 확인

```bash
uv run --env-file .env --project backend --frozen \
  uvicorn rulecraft.api:app --host 127.0.0.1 --port 8000 --workers 1
```

이 터미널을 유지합니다. 종료는 Ctrl+C입니다. 자동 시작 서비스나 공개 네트워크 노출은 아직 설정하지 않습니다.

새 터미널에서 같은 저장소로 이동한 뒤 확인합니다.

```bash
cd "$HOME/Projects/raw"
curl --fail --silent --write-out '\n' http://127.0.0.1:8000/api/health
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  http://127.0.0.1:8000/api/overview
```

첫 요청은 `status: ok`를 반환하고, 두 번째 미인증 요청은 `401`이어야 합니다. 아래는 토큰을 명령줄이나 출력에 노출하지 않는 인증 확인입니다.

```bash
uv run --env-file .env --project backend --frozen python - <<'PY'
import json
import os
from urllib.request import Request, urlopen

headers = {"Authorization": "Bearer " + os.environ["RULECRAFT_API_TOKEN"]}
for path in ("/api/overview", "/api/laws/status", "/api/mcp/tools"):
    request = Request("http://127.0.0.1:8000" + path, headers=headers)
    with urlopen(request, timeout=45) as response:
        payload = json.load(response)
        print(path, "HTTP", response.status)
        if path == "/api/overview":
            print("저장소 통계:", payload["stats"])
        if path == "/api/mcp/tools":
            print("실제 MCP 도구 수:", len(payload["tools"]))
PY
```

세 요청이 모두 `200`이면 로컬 인증과 조회 경로를 확인한 것입니다. MCP 요청은 백엔드 가상환경의 Python으로 실제 자식 프로세스를 실행하므로 별도 Node 서버가 필요하지 않습니다. OC 설정 상태가 정상이어도 공식 API 접근 성공을 뜻하지 않습니다. 등록을 마친 뒤 [공식 수집 안내](official-laws.md)에 따라 소량 조회와 실제 수집 응답을 확인하세요. 이 명령은 전국 법령 수집을 자동 시작하지 않습니다.

## 5. Vercel 연결은 HTTPS 주소를 준비한 뒤

Vercel 함수는 집의 Mac mini `localhost`나 사설 IP에 직접 연결할 수 없습니다. 외부에서 접근 가능한 실제 HTTPS 주소가 필요하며, 터널·리버스 프록시·공유기 및 CGNAT 조건은 서버 준비 후 선택·확인합니다. 아직 호스트 이름이나 공개 연결 방식을 정하지 않습니다.

나중에 Vercel의 서버 전용 `RULECRAFT_BACKEND_URL`에 실제 HTTPS 원점을, `RULECRAFT_API_TOKEN`에 Mac mini `.env`의 동일한 토큰을 등록합니다. 토큰을 `VITE_` 변수나 브라우저에 넣지 않습니다. 현재 연결은 대기 상태이며 [배포 문서](deployment.md)에 요건을 정리했습니다.
