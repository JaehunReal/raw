"""Decode ordinance article identifiers without changing preserved source evidence."""
from copy import deepcopy
import re


def ordinance_article_number(value):
    # The ordinance API packs a four-digit article and two-digit branch.
    value = str(value or "")
    if not re.fullmatch(r"[0-9]{6}", value) or int(value[:4]) == 0:
        return None
    article, branch = int(value[:4]), int(value[4:])
    return f"제{article}조" + (f"의{branch}" if branch else "")


def normalize_provisions(source, provisions):
    result = deepcopy(provisions)
    if source != "ordinance":
        return result
    for provision in result:
        metadata = provision.get("metadata") or {}
        number = ordinance_article_number(metadata.get("original_article_no"))
        if number and number != provision.get("article_no"):
            provision["metadata"] = {**metadata, "stored_article_no": provision.get("article_no"),
                                     "article_number_normalization": "ordinance-packed-v1"}
            provision["article_no"] = number
    return result
