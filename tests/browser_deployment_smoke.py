"""Exercise the production login/proxy/backend/MCP chain over real HTTPS.

Build first: VITE_REQUIRE_LOGIN=true npm run build --prefix frontend
Run with the Playwright interpreter: python tests/browser_deployment_smoke.py
The test copies the real demo vault, uses an empty official corpus, and starts
only temporary local processes. It creates no screenshots or API fixtures.
"""

from __future__ import annotations

from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import ssl
import subprocess
import tempfile
import time
import zipfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
CHROMIUM = os.getenv("RULECRAFT_CHROMIUM_PATH", "/usr/bin/chromium")
EVIDENCE = Path(os.getenv("RULECRAFT_DEPLOYMENT_EVIDENCE", str(ROOT / ".rulecraft" / "deployment-evidence.json")))


def port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def snapshot(vault: Path) -> dict[str, str]:
    return {path.relative_to(vault).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(vault.rglob("*.md"))}


def stop(processes: list[subprocess.Popen]) -> None:
    for process in processes:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 8
    while any(process.poll() is None for process in processes) and time.monotonic() < deadline:
        time.sleep(.1)
    for process in processes:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait(timeout=3)


def healthy(base: str, context: ssl.SSLContext, processes: list[subprocess.Popen]) -> None:
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            raise RuntimeError("A temporary deployment process exited before becoming ready.")
        try:
            with urlopen(base + "/api/health", context=context, timeout=1) as response:
                if response.status == 200 and json.load(response).get("service") == "rulecraft":
                    return
        except (OSError, URLError, ValueError):
            pass
        time.sleep(.2)
    raise RuntimeError("Temporary HTTPS deployment readiness timed out.")


def gateway_script(cert: Path, key: Path, gateway_port: int) -> str:
    config = json.dumps({"cert": str(cert), "key": str(key), "port": gateway_port,
                         "dist": str(ROOT / "frontend/dist"), "proxy": (ROOT / "api/proxy.mjs").as_uri()})
    return f"""import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
const config = {config};
const {{ default: proxy }} = await import(config.proxy);
const mime = {{'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml',
               '.woff2':'font/woff2','.json':'application/json','.png':'image/png'}};
https.createServer({{cert:fs.readFileSync(config.cert),key:fs.readFileSync(config.key)}}, async (req,res) => {{
  try {{
    const url = new URL(req.url, 'https://localhost');
    if (url.pathname.startsWith('/api/')) {{
      req.query = {{path:url.pathname.slice(5)}};
      if (!['GET','HEAD'].includes(req.method)) {{
        const parts=[]; let size=0;
        for await (const chunk of req) {{size+=chunk.length; if(size>4_000_000){{res.statusCode=413;res.end();return;}}parts.push(chunk);}}
        const bytes=Buffer.concat(parts);
        try {{req.body=bytes.length?JSON.parse(bytes.toString('utf8')):undefined;}}
        catch {{req.body=bytes;}}
      }}
      await proxy(req,res);
      return;
    }}
    let requested = path.resolve(config.dist, '.'+decodeURIComponent(url.pathname));
    if (!requested.startsWith(config.dist+path.sep) && requested!==config.dist) {{res.statusCode=404;res.end();return;}}
    if (!fs.existsSync(requested) || !fs.statSync(requested).isFile()) requested=path.join(config.dist,'index.html');
    res.setHeader('Content-Type',mime[path.extname(requested)]||'application/octet-stream');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.end(fs.readFileSync(requested));
  }} catch {{res.statusCode=500;res.end('Temporary deployment gateway error');}}
}}).listen(config.port,'127.0.0.1');
"""


def login(page, password: str, expected_status: int = 200) -> None:
    expect(page.get_by_role("heading", name="워크스페이스에 로그인")).to_be_visible()
    page.get_by_label("워크스페이스 비밀번호").fill(password)
    with page.expect_response(lambda response: urlparse(response.url).path == "/api/session"
                              and response.request.method == "POST") as result:
        page.get_by_role("button", name="로그인", exact=True).click()
    assert result.value.status == expected_status, "Unexpected login HTTP status."


def mcp_graph(page) -> dict:
    page.locator("nav").get_by_role("button", name="MCP 도구", exact=True).click()
    expect(page.get_by_test_id("mcp-connection")).to_contain_text("RuleCraft MCP 서버", timeout=20000)
    page.get_by_test_id("mcp-tool-query_markdown_graph").click()
    with page.expect_response(lambda response: urlparse(response.url).path == "/api/mcp/call"
                              and response.request.method == "POST", timeout=35000) as result:
        page.get_by_test_id("mcp-run").click()
    assert result.value.status == 200
    payload = result.value.json()
    assert payload["transport"] == "stdio" and payload["server"]["name"] == "RuleCraft"
    assert not payload["is_error"]
    assert {node["id"] for node in payload["result"]["nodes"]} == {
        "KIPA-RULE-DAT-007", "LAW-PRIV-015", "LAW-DATA-012"}
    expect(page.get_by_test_id("mcp-result").locator(".mcp-node-list > button")).to_have_count(3)
    return payload


def authenticated_download(page, context) -> dict:
    """Create a real package through the UI, then expire its browser session."""
    page.locator("nav").get_by_role("button", name="워크스페이스", exact=True).click()
    page.get_by_role("button", name="새 개정 프로젝트", exact=True).click()
    page.get_by_role("button", name="대상 조문 선택", exact=True).click()
    expect(page.get_by_label("개정 대상 조문")).to_have_value("KIPA-RULE-DAT-007")
    page.get_by_role("button", name="문서 구성 확인", exact=True).click()
    with page.expect_response(lambda response: urlparse(response.url).path == "/api/packages"
                              and response.request.method == "POST") as generated:
        page.get_by_role("button", name="문서 패키지 생성", exact=True).click()
    assert generated.value.status == 201
    package = generated.value.json()
    assert package["status"] == "draft" and package["verification"]["valid"]
    assert len(package["documents"]) == 7
    download_path = f"/api/packages/{package['id']}/download"
    downloads = []
    page.on("download", lambda download: downloads.append(download))
    with page.expect_response(lambda response: urlparse(response.url).path == download_path) as response, \
            page.expect_download() as downloaded:
        page.get_by_role("button", name="전체 문서 다운로드", exact=True).click()
    assert response.value.status == 200
    assert response.value.headers["content-type"].startswith("application/zip")
    assert downloaded.value.failure() is None
    assert downloaded.value.suggested_filename == f"rulecraft-{package['id']}.zip"
    with zipfile.ZipFile(downloaded.value.path()) as archive:
        assert archive.testzip() is None
        names = set(archive.namelist())
        assert names == {document["name"] for document in package["documents"]} | {"manifest.json"}
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["id"] == package["id"] and manifest["verification"]["valid"]
        for document in package["documents"]:
            assert archive.read(document["name"]).decode("utf-8") == document["content"]
    expect(page.get_by_role("status")).to_contain_text("문서 패키지 다운로드를 시작했습니다.")
    assert len(downloads) == 1
    # Keep the existing document screen while clearing only the browser session.
    # Its next protected download must trigger LoginGate, not save an error JSON.
    context.clear_cookies()
    with page.expect_response(lambda response: urlparse(response.url).path == download_path) as expired:
        page.get_by_role("button", name="전체 문서 다운로드", exact=True).click()
    assert expired.value.status == 401
    expect(page.get_by_role("heading", name="워크스페이스에 로그인")).to_be_visible()
    expect(page.get_by_role("alert")).to_contain_text("로그인 시간이 만료되었습니다.")
    assert len(downloads) == 1, "Session errors must not become downloaded ZIP files"
    return {"package_create_http_status": 201, "download_http_status": 200,
            "zip_entries": len(names), "zip_content_verified": True,
            "expired_download_http_status": 401, "expired_download_returned_to_login": True,
            "error_response_downloaded": False}


def main() -> None:
    if not (ROOT / "frontend/dist/index.html").is_file() or not (ROOT / "api/proxy.mjs").is_file():
        raise RuntimeError("Build the login-enabled frontend and provide api/proxy.mjs first.")
    original_source = snapshot(ROOT / "legal-knowledge-vault")
    token, password = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    for asset in (ROOT / "frontend/dist").rglob("*"):
        if asset.is_file():
            content = asset.read_bytes()
            assert token.encode() not in content and password.encode() not in content
            assert b"RULECRAFT_API_TOKEN" not in content and b"RULECRAFT_WEB_PASSWORD" not in content
    processes: list[subprocess.Popen] = []
    evidence: dict = {}
    with tempfile.TemporaryDirectory(prefix="rulecraft-deployment-smoke-") as directory, ExitStack() as stack:
        temporary = Path(directory)
        vault = temporary / "vault"
        shutil.copytree(ROOT / "legal-knowledge-vault", vault)
        copied_source = snapshot(vault)
        cert, key = temporary / "localhost.crt", temporary / "localhost.key"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
                        "-keyout", str(key), "-out", str(cert)], check=True, capture_output=True)
        trust = ssl.create_default_context(cafile=str(cert))
        backend_port, gateway_port = port(), port()
        backend = f"https://127.0.0.1:{backend_port}"
        gateway = f"https://127.0.0.1:{gateway_port}"
        inherited = {name: os.environ[name] for name in os.environ
                     if not name.startswith("RULECRAFT_") and name not in {"VERCEL_TOKEN", "RENDER_API_KEY", "NODE_TLS_REJECT_UNAUTHORIZED"}}
        backend_env = {**inherited, "RULECRAFT_DEPLOYMENT": "production", "RULECRAFT_API_TOKEN": token,
                       "RULECRAFT_VAULT": str(vault), "RULECRAFT_PACKAGE_DIR": str(temporary / "packages"),
                       "RULECRAFT_LAW_DIR": str(temporary / "official-laws")}
        gateway_env = {**inherited, "RULECRAFT_API_TOKEN": token, "RULECRAFT_WEB_PASSWORD": password,
                       "RULECRAFT_BACKEND_URL": backend, "NODE_EXTRA_CA_CERTS": str(cert)}
        gateway_file = temporary / "gateway.mjs"
        gateway_file.write_text(gateway_script(cert, key, gateway_port), encoding="utf-8")
        backend_log = stack.enter_context((temporary / "backend.log").open("w"))
        gateway_log = stack.enter_context((temporary / "gateway.log").open("w"))
        try:
            processes.append(subprocess.Popen(
                [str(ROOT / "backend/.venv/bin/python"), "-m", "uvicorn", "rulecraft.api:app", "--host", "127.0.0.1",
                 "--port", str(backend_port), "--ssl-certfile", str(cert), "--ssl-keyfile", str(key)],
                cwd=ROOT, env=backend_env, stdout=backend_log, stderr=subprocess.STDOUT, start_new_session=True))
            healthy(backend, trust, processes)
            processes.append(subprocess.Popen(["node", str(gateway_file)], cwd=ROOT, env=gateway_env,
                                               stdout=gateway_log, stderr=subprocess.STDOUT, start_new_session=True))
            healthy(gateway, trust, processes)
            try:
                urlopen(backend + "/api/graph", context=trust, timeout=5)
                raise AssertionError("Production backend accepted a request without its bearer token.")
            except HTTPError as response:
                assert response.code == 401
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=CHROMIUM, headless=True, args=["--no-sandbox"])
                context = browser.new_context(viewport={"width": 1540, "height": 1100}, ignore_https_errors=True)
                page = context.new_page()
                runtime_errors, request_errors, exposed_bearers = [], [], []
                page.on("pageerror", lambda error: runtime_errors.append(str(error)))
                page.on("requestfailed", lambda request: request_errors.append(request.url))
                page.on("request", lambda request: exposed_bearers.append(request.url)
                        if urlparse(request.url).path.startswith("/api/") and "authorization" in request.headers else None)
                page.goto(gateway)
                anonymous = context.request.get(gateway + "/api/graph")
                assert anonymous.status == 401
                login(page, "wrong-synthetic-password", 401)
                expect(page.get_by_role("alert")).to_contain_text("비밀번호를 확인해 주세요.")
                login(page, password)
                expect(page.locator(".stat-card").nth(0).locator(".stat-value")).to_contain_text("12")
                cookie = next(item for item in context.cookies() if item["name"] == "__Secure-rulecraft_session")
                assert cookie["httpOnly"] and cookie["secure"] and cookie["sameSite"] == "Strict" and cookie["path"] == "/api"
                assert token not in cookie["value"] and password not in cookie["value"]
                assert "__Secure-rulecraft_session" not in page.evaluate("document.cookie")
                graph_response = context.request.get(gateway + "/api/graph")
                assert graph_response.status == 200 and len(graph_response.json()["nodes"]) == 12
                laws = context.request.get(gateway + "/api/laws/status")
                assert laws.status == 200
                status = laws.json()
                assert status["configured"] is False and status["coverage"]["complete"] is False
                assert all(state["collected"] == 0 for state in status["coverage"]["sources"].values())
                page.locator("nav").get_by_role("button", name="공식 법령", exact=True).click()
                expect(page.get_by_test_id("laws-count")).to_have_text("공식 전문 0건 수집")
                expect(page.get_by_test_id("laws-status")).to_have_attribute("data-complete", "false")
                assert page.get_by_test_id("laws-sync").is_disabled()
                mcp = mcp_graph(page)
                download_evidence = authenticated_download(page, context)
                login(page, password)
                expect(page.locator(".stat-card").nth(0).locator(".stat-value")).to_contain_text("12")
                with page.expect_response(lambda response: urlparse(response.url).path == "/api/session"
                                          and response.request.method == "DELETE") as result:
                    page.get_by_role("button", name="로그아웃", exact=True).click()
                assert result.value.status == 200
                expect(page.get_by_role("heading", name="워크스페이스에 로그인")).to_be_visible()
                assert context.request.get(gateway + "/api/graph").status == 401
                assert not any(item["name"] == "__Secure-rulecraft_session" for item in context.cookies())
                assert runtime_errors == [] and request_errors == [] and exposed_bearers == []
                context.close()

                mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                             has_touch=True, ignore_https_errors=True)
                mobile_page = mobile.new_page()
                mobile_page.on("pageerror", lambda error: runtime_errors.append(str(error)))
                mobile_page.goto(gateway)
                expect(mobile_page.get_by_role("heading", name="워크스페이스에 로그인")).to_be_visible()
                assert mobile_page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
                login(mobile_page, password)
                expect(mobile_page.locator(".stat-card").nth(0).locator(".stat-value")).to_contain_text("12")
                mcp_graph(mobile_page)
                assert mobile_page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
                assert runtime_errors == []
                mobile.close()
                browser.close()
                evidence = {"topology": "LoginGate → HTTPS Node api/proxy.mjs → bearer-auth HTTPS FastAPI → real MCP stdio",
                            "test_environment": "temporary local deployment; not a hosted publication",
                            "upstream_tls_verified": True, "test_certificate": "temporary self-signed localhost SAN",
                            "anonymous_http_status": 401, "wrong_password_http_status": 401,
                            "login_http_status": 200, "logout_http_status": 200, "after_logout_http_status": 401,
                            "workspace_nodes": 12, "official_documents": 0, "official_complete": False,
                            "mcp_server": mcp["server"], "mcp_transport": mcp["transport"], "mcp_nodes": 3,
                            "cookie": {"http_only": True, "secure": True, "same_site": "Strict", "path": "/api"},
                            "browser_bearer_exposed": False, "asset_secrets_exposed": False,
                            "mobile_width": 390, "mobile_overflow": False, "runtime_errors": 0,
                            "authenticated_download": download_evidence,
                            "copied_source_unchanged": copied_source == snapshot(vault)}
            assert evidence["copied_source_unchanged"]
        finally:
            stop(processes)
    assert original_source == snapshot(ROOT / "legal-knowledge-vault")
    evidence.update({"repository_source_unchanged": True, "owned_processes_stopped": True})
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
