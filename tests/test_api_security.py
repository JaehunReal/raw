from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from rulecraft.api import create_app
from rulecraft.mcp_bridge import MCPBridge

from tests.support import VaultTestCase, article


TOKEN = "synthetic-test-api-token"


class DeploymentApiSecurityTests(VaultTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.original = article("RULE", 7)
        self.write("rules/article.md", self.original)

    def client(self, deployment: str = "development", token: str = "", package_dir: Path | None = None) -> TestClient:
        environment = {"RULECRAFT_DEPLOYMENT": deployment, "RULECRAFT_API_TOKEN": token,
                       "RULECRAFT_PACKAGE_DIR": ""}
        with patch.dict(os.environ, environment):
            app = create_app(self.vault, package_dir or self.vault / "packages", law_dir=self.vault / "official")
        client = TestClient(app)
        self.addCleanup(client.close)
        self.addCleanup(app.state.law_jobs.close)
        return client

    def test_default_local_development_keeps_existing_workspace_behavior(self) -> None:
        client = self.client()
        self.assertEqual(client.get("/api/health").status_code, 200)
        self.assertEqual(client.get("/api/articles").status_code, 200)
        self.assertEqual(client.put("/api/articles/RULE", json={"markdown": self.original + "\n① 담당자를 확인한다.\n"}).status_code, 200)
        self.assertEqual(client.get("/openapi.json").status_code, 200)

    def test_missing_production_secret_fails_closed_without_exposing_routes(self) -> None:
        client = self.client("production")
        self.assertEqual(client.get("/api/health").status_code, 200)
        for path in ("/api/overview", "/api/articles", "/api/packages", "/api/laws/status", "/api/mcp/tools", "/api/unknown"):
            with self.subTest(path=path):
                response = client.get(path)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json(), {"detail": "RULECRAFT_API_TOKEN 설정이 필요합니다."})
        self.assertEqual(client.post("/api/laws/sync", json={}).status_code, 503)
        self.assertEqual(client.get("/api/health/").status_code, 503)

    def test_configured_guard_rejects_missing_wrong_duplicate_and_query_tokens(self) -> None:
        client = self.client("production", TOKEN)
        bad_requests = [
            {},
            {"headers": {"Authorization": "Bearer wrong-synthetic-token"}},
            {"headers": {"Authorization": "Basic " + TOKEN}},
            {"headers": {"Authorization": "Bearer "}},
            {"headers": [("Authorization", "Bearer " + TOKEN), ("Authorization", "Bearer wrong-synthetic-token")]},
            {"params": {"token": TOKEN}},
        ]
        for arguments in bad_requests:
            with self.subTest(arguments=list(arguments)):
                response = client.get("/api/articles", **arguments)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers["www-authenticate"], "Bearer")
                self.assertNotIn(TOKEN, response.text)
        self.assertEqual(client.get("/api/articles", headers={"Authorization": "bearer " + TOKEN}).status_code, 200)
        self.assertEqual(client.get("/api/health", headers={"Authorization": "Bearer wrong-synthetic-token"}).status_code, 200)

    def test_guard_runs_before_mutations_background_jobs_and_mcp_process_start(self) -> None:
        client = self.client("development", TOKEN)
        with patch.object(client.app.state.law_jobs, "start") as start, patch.object(client.app.state.mcp_bridge, "tools", new_callable=AsyncMock) as tools:
            self.assertEqual(client.post("/api/laws/sync", json={"sources": ["law"]}).status_code, 401)
            self.assertEqual(client.get("/api/mcp/tools").status_code, 401)
            start.assert_not_called()
            tools.assert_not_awaited()
        modified = self.original + "\n① 무단 수정한 합성 데이터\n"
        self.assertEqual(client.put("/api/articles/RULE", json={"markdown": modified}).status_code, 401)
        self.assertEqual(self.vault.joinpath("rules/article.md").read_text(encoding="utf-8"), self.original)
        allowed = client.put("/api/articles/RULE", json={"markdown": modified}, headers={"Authorization": "Bearer " + TOKEN})
        self.assertEqual(allowed.status_code, 200)

    def test_production_hides_api_docs_but_authenticated_real_mcp_still_works(self) -> None:
        client = self.client("production", TOKEN)
        for path in ("/docs", "/redoc", "/openapi.json"):
            self.assertEqual(client.get(path).status_code, 404)
        response = client.get("/api/mcp/tools", headers={"Authorization": "Bearer " + TOKEN})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["server"]["name"], "RuleCraft")
        self.assertNotIn(TOKEN, response.text)

    def test_persistent_package_directory_environment_is_honored(self) -> None:
        packages = self.vault / "persistent-packages"
        with patch.dict(os.environ, {"RULECRAFT_PACKAGE_DIR": str(packages), "RULECRAFT_API_TOKEN": "",
                                     "RULECRAFT_DEPLOYMENT": "development"}):
            app = create_app(self.vault, law_dir=self.vault / "official")
        self.addCleanup(app.state.law_jobs.close)
        client = TestClient(app)
        self.addCleanup(client.close)
        self.assertEqual(app.state.workflow.package_dir, packages)
        result = client.post("/api/packages", json={
            "agency": "테스트기관", "rule_name": "공공데이터지침", "article_id": "RULE",
            "objective": "합성 테스트 목적 정비", "amendment_type": "partial", "effective_date": "2026-11-01",
            "revised_markdown": self.original + "\n① 처리 목적을 확인하여야 한다.\n",
        })
        self.assertEqual(result.status_code, 201, result.text)
        self.assertTrue(packages.joinpath(result.json()["id"] + ".json").is_file())

    def test_mcp_worker_does_not_inherit_gateway_secret(self) -> None:
        with patch.dict(os.environ, {"RULECRAFT_API_TOKEN": TOKEN, "RULECRAFT_DEPLOYMENT": "production",
                                     "RULECRAFT_WEB_PASSWORD": "synthetic-web-password",
                                     "VERCEL_TOKEN": "synthetic-deploy-token", "RENDER_API_KEY": "synthetic-render-key",
                                     "RULECRAFT_LAW_OC": "synthetic-law-account",
                                     "RULECRAFT_LLM_API_KEY": "synthetic-model-key"}):
            environment = MCPBridge(self.vault)._parameters().env
        for name in ("RULECRAFT_API_TOKEN", "RULECRAFT_DEPLOYMENT", "RULECRAFT_WEB_PASSWORD",
                     "VERCEL_TOKEN", "RENDER_API_KEY"):
            self.assertFalse(name in environment)
        self.assertEqual(environment["RULECRAFT_LAW_OC"], "synthetic-law-account")
        self.assertEqual(environment["RULECRAFT_LLM_API_KEY"], "synthetic-model-key")
