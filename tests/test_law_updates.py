from rulecraft.graph import GraphStore
from rulecraft.law_updates import change_impacts
from tests.support import VaultTestCase, article


class CollectedLawChangeImpactTests(VaultTestCase):
    def test_plain_citation_transitive_links_and_forms_are_candidates_not_legal_findings(self):
        self.write("rules/main.md", article("MAIN", 7, body="# 제7조\n「검토용공식법」 제15조에 따른다.", uses_form=["[[FORM]]"]))
        self.write("rules/dependent.md", article("DEPENDENT", 8, cites=["[[MAIN]]"]))
        self.write("forms/form.md", article("FORM", 1, kind="form", cites=["[[MAIN]]"]))
        changes = [{"law_id": "law:test", "title": "검토용공식법", "source": "law",
                    "change_type": "updated", "before_version_id": "fixture1", "after_version_id": "fixture2"}]
        result = change_impacts(GraphStore(self.vault), changes)[0]
        self.assertEqual({node["id"] for node in result["impact"]["impacted_nodes"]}, {"MAIN", "DEPENDENT", "FORM"})
        self.assertFalse(result["impact"]["applicability_verified"])
        self.assertEqual(result["impact"]["scope"], "declared_local_references")
        self.assertEqual(result["change_type"], "updated")

    def test_no_declared_reference_and_catalogue_removal_do_not_assert_repeal(self):
        self.write("rules/main.md", article("MAIN", 7))
        change = {"law_id": "law:fixture", "title": "관련없는테스트법", "change_type": "removed_from_catalogue"}
        result = change_impacts(GraphStore(self.vault), [change])[0]
        self.assertEqual(result["impact"]["count"], 0)
        self.assertEqual(result["change_type"], "removed_from_catalogue")
        self.assertFalse(result["impact"]["applicability_verified"])
