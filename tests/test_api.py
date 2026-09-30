from __future__ import annotations

import io
import os
from unittest.mock import patch
import zipfile

from fastapi.testclient import TestClient

from rulecraft.api import create_app

from tests.support import VaultTestCase, article


class WorkspaceApiTests(VaultTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.original = article("RULE", 7)
        self.write("rules/article.md", self.original)
        self.client = TestClient(create_app(self.vault, self.vault / "packages"))
        self.addCleanup(self.client.close)
        self.request = {
            "agency": "테스트기관", "rule_name": "공공데이터지침", "article_id": "RULE",
            "objective": "검토 절차를 명확하게 정비", "amendment_type": "partial",
            "effective_date": "2026-11-01", "revised_markdown": self.original + "\n① 목적을 확인하여야 한다.\n",
        }

    def test_package_create_retrieve_list_download_round_trip(self) -> None:
        response = self.client.post("/api/packages", json=self.request)
        self.assertEqual(response.status_code, 201)
        package = response.json()
        self.assertEqual(package["status"], "draft")
        self.assertEqual(self.client.get(f"/api/packages/{package['id']}").json(), package)
        self.assertEqual([item["id"] for item in self.client.get("/api/packages").json()["packages"]], [package["id"]])
        download = self.client.get(f"/api/packages/{package['id']}/download")
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.headers["content-type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            self.assertEqual(len(archive.namelist()), 8)
            self.assertIn("manifest.json", archive.namelist())
        self.assertEqual(self.client.get("/api/articles/RULE").json()["markdown"], self.original)

    def test_blocked_package_is_reviewable_but_cannot_be_downloaded(self) -> None:
        bad = {**self.request, "revised_markdown": self.original + "\n[[허위법#제99조]]에 따른다.\n"}
        response = self.client.post("/api/packages", json=bad)
        self.assertEqual(response.status_code, 201)
        package = response.json()
        self.assertEqual(package["status"], "blocked")
        self.assertEqual(package["documents"], [])
        self.assertFalse(package["verification"]["valid"])
        self.assertEqual(self.client.get(f"/api/packages/{package['id']}/download").status_code, 409)
        self.assertEqual(self.client.get(f"/api/packages/{package['id']}").json()["status"], "blocked")

    def test_editor_rejects_invalid_citation_then_saves_valid_revision(self) -> None:
        rejected = self.client.put("/api/articles/RULE", json={"markdown": self.original + "\n[[missing]]\n"})
        self.assertEqual(rejected.status_code, 422)
        self.assertFalse(rejected.json()["detail"]["verification"]["valid"])
        self.assertEqual(self.client.get("/api/articles/RULE").json()["markdown"], self.original)
        revised = self.original + "\n① 담당자는 신청 목적을 확인하여야 한다.\n"
        saved = self.client.put("/api/articles/RULE", json={"markdown": revised})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(self.client.get("/api/articles/RULE").json()["markdown"], revised)

    def test_schema_rejects_invalid_dates_extra_fields_and_identity_mismatch(self) -> None:
        self.assertEqual(self.client.post("/api/packages", json={**self.request, "effective_date": "2026-13-01"}).status_code, 422)
        self.assertEqual(self.client.post("/api/packages", json={**self.request, "auto_publish": True}).status_code, 422)
        self.assertEqual(self.client.post("/api/packages", json={**self.request, "agency": "다른기관"}).status_code, 400)
        self.assertEqual(self.client.get("/api/packages").json()["packages"], [])

    def test_unsafe_vault_path_and_malformed_diff_are_returned_as_errors(self) -> None:
        validation = self.client.post("/api/validate", json={"source_path": "../../outside.md", "markdown": self.original})
        self.assertEqual(validation.status_code, 400)
        impact = self.client.post("/api/impact", json={"target_file_path": "../../outside.md", "proposed_diff": self.original})
        self.assertEqual([issue["code"] for issue in impact.json()["issues"]], ["unsafe_path"])
        bad_patch = "--- a/rules/article.md\n+++ b/rules/article.md\n@@ -1 +1 @@\n-not original\n+new\n"
        malformed = self.client.post("/api/impact", json={"target_file_path": "rules/article.md", "proposed_diff": bad_patch})
        self.assertEqual([issue["code"] for issue in malformed.json()["issues"]], ["invalid_diff"])
        self.assertEqual(self.vault.joinpath("rules/article.md").read_text(encoding="utf-8"), self.original)

    def test_optional_vision_without_service_returns_unavailable(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            response = self.client.post("/api/vision", json={"image_data_base64": "aGVsbG8="})
        self.assertEqual(response.status_code, 503)
        self.assertIn("RULECRAFT_OLLAMA_BASE_URL", response.json()["detail"])
