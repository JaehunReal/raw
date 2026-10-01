"""Legacy remote search must validate provider success and conceal account IDs."""
from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

import httpx

from rulecraft import adapters


class NationalLawSearchAdapterTests(unittest.TestCase):
    def search(self, payload):
        response = httpx.Response(200, json=payload)
        with patch.dict(os.environ, {"RULECRAFT_LAW_OC": "synthetic-account", "RULECRAFT_LAW_BASE_URL": "https://example.test/DRF"}), patch.object(adapters, "_request", return_value=response):
            return adapters.search_national_law("합성 조회")

    def test_success_and_empty_search_are_validated(self):
        one = self.search({"LawSearch": {"totalCnt": 1, "law": {"법령ID": "42", "법령명한글": "합성"}}})
        self.assertEqual(one["status"], "available")
        self.assertEqual(self.search({"LawSearch": {"totalCnt": 0}})["data"]["LawSearch"]["totalCnt"], 0)

    def test_http_200_error_missing_count_and_incomplete_results_are_unavailable(self):
        invalid = [{"Error": {"message": "synthetic-account"}}, {"LawSearch": {"errorCode": "401", "totalCnt": 0}},
                   {"Login": {}}, {"LawSearch": {}}, {"LawSearch": {"totalCnt": 1}},
                   {"LawSearch": {"totalCnt": "invalid"}}, {"LawSearch": {"totalCnt": 0, "law": {"id": "unexpected"}}}]
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(adapters.AdapterUnavailable) as error:
                self.search(payload)
            self.assertNotIn("synthetic-account", str(error.exception))

    def test_echoed_oc_and_link_queries_are_removed_from_public_payload(self):
        result = self.search({"LawSearch": {"totalCnt": 1, "OC": "synthetic-account", "law": {
            "법령ID": "42", "법령명한글": "합성", "법령상세링크": "https://example.test/full?OC=synthetic-account&ID=42",
            "nested": [{"oc": "synthetic-account", "note": "echo synthetic-account"}]}}})
        encoded = json.dumps(result)
        self.assertNotIn("synthetic-account", encoded)
        self.assertNotIn("OC=", encoded)
        self.assertEqual(result["data"]["LawSearch"]["law"]["법령상세링크"], "https://example.test/full?ID=42")

    def test_invalid_json_and_fragment_base_url_are_rejected(self):
        with patch.dict(os.environ, {"RULECRAFT_LAW_OC": "synthetic-account", "RULECRAFT_LAW_BASE_URL": "https://example.test/DRF"}), patch.object(adapters, "_request", return_value=httpx.Response(200, content=b"not JSON")):
            with self.assertRaises(adapters.AdapterUnavailable):
                adapters.search_national_law("합성")
        with patch.dict(os.environ, {"RULECRAFT_LAW_OC": "synthetic-account", "RULECRAFT_LAW_BASE_URL": "https://example.test/DRF#private"}), patch.object(adapters, "_request") as request:
            with self.assertRaises(adapters.AdapterUnavailable):
                adapters.search_national_law("합성")
            request.assert_not_called()
