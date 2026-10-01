"""Read-only, bounded clients for the Korean official legal-information API.

Raw responses remain intact for provenance storage. Successful parsing establishes
the response structure, not legal applicability or completeness of a corpus.
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
import time
from datetime import date
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from xml.etree import ElementTree as ET

import httpx


DEFAULT_BASE_URL = "https://www.law.go.kr/DRF"
MAX_RESPONSE_BYTES = 25 * 1024 * 1024
SOURCES = {
    "law": {"target": "law", "search_root": "LawSearch", "items": {"law"},
            "full_roots": {"법령", "LawService", "law"}},
    "administrative": {"target": "admrul", "search_root": "AdmRulSearch", "items": {"admrul"},
                       "full_roots": {"행정규칙", "AdmRulService", "admrul"}},
    "ordinance": {"target": "ordin", "search_root": "OrdinSearch", "items": {"ordin", "law"},
                  "full_roots": {"자치법규", "OrdinService", "LawService", "ordin"}},
}
ALIASES = {"law": "law", "laws": "law", "statute": "law", "statutes": "law",
           "administrative": "administrative", "admrul": "administrative", "administrative_rule": "administrative",
           "ordinance": "ordinance", "ordin": "ordinance", "ordinances": "ordinance"}


class LawSourceError(RuntimeError):
    """A public error whose message never includes response bodies or request URLs."""

    def __init__(self, code: str, message: str, source: str | None = None,
                 retriable: bool = False, status_code: int | None = None) -> None:
        self.code = code
        self.message = re.sub(r"https?://[^\s]+", "[redacted URL]", str(message))
        self.message = re.sub(r"(?i)\bOC\s*=\s*[^\s&]+", "OC=[redacted]", self.message)
        self.source = source
        self.retriable = retriable
        self.status_code = status_code
        super().__init__(self.message)

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "source": self.source,
                "retriable": self.retriable, "status_code": self.status_code}

    to_dict = as_dict


def canonical_source(source: str) -> str:
    normalized = ALIASES.get(str(source).strip().lower())
    if normalized is None:
        raise LawSourceError("unsupported_source", "지원하지 않는 법령 자료 범위입니다.")
    return normalized


def _tag(element: ET.Element) -> str:
    return str(element.tag).rsplit("}", 1)[-1]


def _value(element: ET.Element, *names: str) -> str | None:
    for name in names:
        for child in element.iter():
            if _tag(child) == name:
                value = "".join(child.itertext()).strip()
                if value:
                    return value
    return None


def _children(element: ET.Element, names: set[str]) -> list[ET.Element]:
    return [child for child in element if _tag(child) in names]


def _metadata_headers(element: ET.Element, source: str | None = None) -> list[ET.Element]:
    headers = _children(element, {"기본정보"})
    source_header = {"administrative": "행정규칙기본정보", "ordinance": "자치법규기본정보"}.get(source)
    if source_header:
        headers = _children(element, {source_header}) + headers
    return [*headers, element]


def _metadata_value(element: ET.Element, *names: str, source: str | None = None) -> str | None:
    """Read document headers without borrowing another provision's metadata."""
    for header in _metadata_headers(element, source):
        for name in names:
            for child in header:
                if _tag(child) == name:
                    value = "".join(child.itertext()).strip()
                    if value:
                        return value
    return None


def _iso_date(value: str | None, field: str, warnings: list[str]) -> str | None:
    if not value:
        warnings.append(f"missing_{field}")
        return None
    compact = re.sub(r"[.\-/\s]", "", value)
    try:
        if not re.fullmatch(r"\d{8}", compact):
            raise ValueError
        return date(int(compact[:4]), int(compact[4:6]), int(compact[6:])).isoformat()
    except ValueError:
        warnings.append(f"invalid_{field}")
        return None


def _json_element(name: str, value: Any) -> ET.Element:
    element = ET.Element(name)
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).startswith("@"):
                element.set(str(key)[1:], str(child))
            elif key in {"#text", "#content"}:
                element.text = str(child)
            elif isinstance(child, list):
                for item in child:
                    element.append(_json_element(str(key), item))
            else:
                element.append(_json_element(str(key), child))
    elif value is not None:
        element.text = str(value)
    return element


def _parse_response(raw: bytes, source: str) -> tuple[ET.Element, str]:
    if len(raw) > MAX_RESPONSE_BYTES:
        raise LawSourceError("response_too_large", "법령 API 응답 크기 제한을 초과했습니다.", source)
    # Remove NULs only for the security scan so UTF-16/32 declarations are caught.
    scanned = raw.replace(b"\x00", b"").lower()
    if b"<!doctype" in scanned or b"<!entity" in scanned:
        raise LawSourceError("unsafe_xml", "DTD 및 엔터티가 포함된 XML은 허용하지 않습니다.", source)
    try:
        if raw.lstrip().startswith(b"{"):
            payload = json.loads(raw)
            if not isinstance(payload, dict) or len(payload) != 1:
                raise ValueError
            name, value = next(iter(payload.items()))
            return _json_element(name, value), "json"
        return ET.fromstring(raw), "xml"
    except (ET.ParseError, ValueError, TypeError, RecursionError):
        raise LawSourceError("invalid_response", "법령 API 응답 형식을 읽을 수 없습니다.", source) from None


def _check_api_error(root: ET.Element, source: str) -> None:
    name = _tag(root).lower()
    body = " ".join(root.itertext()).lower()
    markers = {"error", "errors", "errorcode", "errcode", "오류코드", "에러코드"}
    has_error = name in {"error", "errors", "html", "login", "에러", "오류"}
    for element in root.iter():
        if _tag(element).lower() in markers and "".join(element.itertext()).strip() not in {"", "0", "00"}:
            has_error = True
    if has_error:
        if any(marker in body for marker in ("invalid target", "unsupported target", "지원하지", "미지원")):
            raise LawSourceError("unsupported_source", "법령 API가 요청한 자료 범위를 지원하지 않습니다.", source)
        raise LawSourceError("api_error", "법령 API가 오류 또는 로그인 응답을 반환했습니다.", source)


def _identity(element: ET.Element, source: str) -> tuple[str | None, str | None, str | None]:
    if source == "law":
        stable = _metadata_value(element, "법령ID", "법령아이디", "lawId", source=source)
        # 법령키 is a compound official key, not the MST sequence identifier.
        version = _metadata_value(element, "법령일련번호", "MST", source=source)
        title = _metadata_value(element, "법령명한글", "법령명", "법령명_한글", "lawName", source=source)
    elif source == "administrative":
        stable = _metadata_value(element, "행정규칙ID", "행정규칙아이디", source=source)
        version = _metadata_value(element, "행정규칙일련번호", source=source)
        title = _metadata_value(element, "행정규칙명", "행정규칙명한글", source=source)
    else:
        stable = _metadata_value(element, "자치법규ID", "자치법규아이디", source=source)
        version = _metadata_value(element, "자치법규일련번호", source=source)
        title = _metadata_value(element, "자치법규명", "자치법규명한글", source=source)
    id_names = {"law": "법령ID", "administrative": "행정규칙ID", "ordinance": "자치법규ID"}
    version_names = {"law": "법령일련번호", "administrative": "행정규칙일련번호", "ordinance": "자치법규일련번호"}
    for header in _metadata_headers(element, source):
        stable = stable or header.get(id_names[source])
        version = version or header.get(version_names[source])
    return stable or version, version, title


def _number(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    circled = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿"
    if value in circled:
        return str(circled.index(value) + 1)
    match = re.fullmatch(r"(?:제|\()?\s*(\d+)(?:[.항호)]|\s)*", value)
    return str(int(match[1])) if match else value


def _article_number(unit: ET.Element) -> str | None:
    value = _value(unit, "조문번호", "조번호", "article_no")
    if value:
        match = re.fullmatch(r"(?:제)?(\d+)(?:조)?(?:의(\d+))?", value.strip())
        if match:
            branch = match[2] or _value(unit, "조문가지번호", "조가지번호")
            return f"제{int(match[1])}조" + (f"의{int(branch)}" if branch and branch.isdigit() and int(branch) else "")
    content = _value(unit, "조문내용", "조내용", "text") or ""
    match = re.match(r"\s*(제\d+조(?:의\d+)?)", content)
    return match[1] if match else None


def is_deleted_article(text: str) -> bool:
    """Recognize a whole deleted-article marker, never mentions of deletion."""
    value = str(text).strip()
    # Official deletion markers can retain a dated amendment annotation.
    value = re.sub(r"(?:\s*(?:<\s*\d{4}[\d\s.,/-]*>|\[\s*\d{4}[\d\s.,/-]*\]))+\s*$", "", value).strip()
    if value in {"삭제", "(삭제)", "[삭제]"}:
        return True
    match = re.fullmatch(r"제[1-9]\d*조(?:의[1-9]\d*)?\s*(?:\(([^()]*)\))?\s*(.*)", value, re.DOTALL)
    if not match:
        return False
    title, body = match.groups()
    return body.strip() == "삭제" or (title == "삭제" and not body.strip())


def _plain_content(element: ET.Element, names: set[str]) -> str:
    parts = []
    for child in element:
        if _tag(child) in names:
            value = "".join(child.itertext()).strip()
            if value:
                parts.append(value)
    return "\n".join(parts)


def _unstructured_content(root: ET.Element) -> str:
    # Administrative responses can split one article across repeated direct
    # 조문내용 siblings. Keep every fragment in its original document order.
    direct = _plain_content(root, {"조문내용", "행정규칙내용", "자치법규내용", "본문내용"})
    return direct or _value(root, "조문내용", "행정규칙내용", "자치법규내용", "본문내용") or ""


def _item(item: ET.Element) -> dict[str, Any]:
    text = _plain_content(item, {"호내용", "호본문", "text"})
    subitems = [_plain_content(sub, {"목내용", "text"})
                for sub in _children(item, {"목", "목단위"})]
    original = _value(item, "호번호", "item_no")
    return {"item_no": _number(original), "original_no": original,
            "text": "\n".join(part for part in [text, *subitems] if part)}


def _paragraphs(unit: ET.Element) -> list[dict[str, Any]]:
    paragraphs = []
    for paragraph in _children(unit, {"항", "항단위", "paragraph"}):
        items = [_item(item) for item in _children(paragraph, {"호", "호단위", "item"})]
        original = _value(paragraph, "항번호", "paragraph_no")
        paragraphs.append({"paragraph_no": _number(original), "original_no": original,
                           "text": _plain_content(paragraph, {"항내용", "항본문", "text"}), "items": items})
    # Some official schemas put items directly beneath an article without an 항.
    direct = _children(unit, {"호", "호단위"})
    if direct:
        paragraphs.append({"paragraph_no": None, "text": "", "items": [_item(item) for item in direct]})
    return paragraphs


def _provisions(root: ET.Element, warnings: list[str], source: str | None = None) -> list[dict[str, Any]]:
    result = []
    for unit in root.iter():
        if _tag(unit) not in {"조문단위", "조", "article"}:
            continue
        # Chapter/section headings can share a numeric 조문번호 with an
        # actual article. Their explicit 전문 marker takes precedence.
        marker = _value(unit, "조문여부")
        if marker == "전문" or (source == "ordinance" and marker == "N"):
            continue
        article_no = _article_number(unit)
        if not article_no:
            warnings.append("unparsed_article_number")
            continue
        paragraphs = _paragraphs(unit)
        content = _plain_content(unit, {"조문내용", "조내용", "text"})
        flattened = [content]
        for paragraph in paragraphs:
            flattened.append(paragraph["text"])
            flattened.extend(item["text"] for item in paragraph["items"])
        article_text = "\n".join(part for part in flattened if part)
        result.append({"article_no": article_no, "title": _value(unit, "조문제목", "조제목", "title"),
                       "text": article_text, "deleted": is_deleted_article(article_text), "paragraphs": paragraphs,
                       "metadata": {"original_article_no": _value(unit, "조문번호", "조번호", "article_no"),
                                    "branch_no": _value(unit, "조문가지번호", "조가지번호")}})
    if result:
        return result
    # Administrative instruments can expose repeated unstructured text fields.
    text = _unstructured_content(root)
    matches = list(re.finditer(r"(?m)^\s*(제\d+조(?:의\d+)?)(?:\(([^\n)]*)\))?", text))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        article_text = text[match.start():end].strip()
        result.append({"article_no": match[1], "title": match[2] or None,
                       "text": article_text, "deleted": is_deleted_article(article_text), "paragraphs": []})
    if result:
        warnings.append("unstructured_paragraphs")
    return result


def _sections(root: ET.Element) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    supplementary = []
    attachments = []
    supplementary_units = {"부칙단위", "부칙내용"}
    attachment_units = {"별표단위", "별지단위", "별표", "별지"}
    for element in root.iter():
        tag = _tag(element)
        if tag not in supplementary_units | attachment_units:
            continue
        # Container 부칙/별표 can nest units; record only the units to avoid duplicates.
        if tag in {"별표", "별지"} and any(_tag(child) in attachment_units for child in element):
            continue
        if tag == "부칙내용" and any(element in list(parent) and _tag(parent) == "부칙단위" for parent in root.iter()):
            continue
        fields = {_tag(child): "".join(child.itertext()).strip() for child in element}
        text = "\n".join(value.strip() for value in element.itertext() if value.strip())
        if tag in supplementary_units:
            supplementary.append({"text": text, "fields": fields})
        else:
            urls = []
            for child in element.iter():
                child_tag = _tag(child).lower()
                value = "".join(child.itertext()).strip()
                if "링크" in child_tag or "url" in child_tag:
                    parsed = urlsplit(value)
                    if parsed.scheme in {"http", "https"} and parsed.hostname and not parsed.username and not parsed.password:
                        urls.append(value)
            attachments.append({"title": _value(element, "별표제목", "별지제목", "제목"),
                                "id": _value(element, "별표번호", "별지번호", "번호") or element.get("id"),
                                "kind": "별지" if "별지" in tag else "별표", "text": text,
                                "urls": urls, "fields": fields, "downloaded": False})
    return supplementary, attachments


class LawClient:
    def __init__(self, oc: str | None = None, base_url: str = DEFAULT_BASE_URL,
                 transport: httpx.BaseTransport | None = None, minimum_interval: float = .2,
                 retries: int = 3, timeout: float = 30) -> None:
        self.oc = (oc if oc is not None else os.getenv("RULECRAFT_LAW_OC", "")).strip()
        if base_url == DEFAULT_BASE_URL:
            base_url = os.getenv("RULECRAFT_LAW_BASE_URL", base_url)
        parsed = urlsplit(base_url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment):
            raise LawSourceError("invalid_configuration", "법령 API 주소는 인증 정보와 쿼리 없는 HTTPS 주소여야 합니다.")
        if not 0 <= minimum_interval <= 60 or not isinstance(retries, int) or not 0 <= retries <= 5 or timeout <= 0:
            raise LawSourceError("invalid_configuration", "법령 API 요청 제한 설정이 올바르지 않습니다.")
        self.base_url = base_url.rstrip("/")
        self.minimum_interval = minimum_interval
        self.retries = retries
        self._last_request = 0.0
        self._lock = threading.Lock()
        self._client = httpx.Client(transport=transport, timeout=timeout, verify=True,
                                    trust_env=True, follow_redirects=False)

    @property
    def configured(self) -> bool:
        return bool(self.oc)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> LawClient:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def _request(self, endpoint: str, params: dict[str, Any], source: str) -> bytes:
        if not self.oc:
            raise LawSourceError("missing_credentials", "국가법령 API 이용에 필요한 RULECRAFT_LAW_OC가 설정되지 않았습니다.", source)
        for attempt in range(self.retries + 1):
            try:
                with self._lock:
                    delay = self.minimum_interval - (time.monotonic() - self._last_request)
                    if delay > 0:
                        time.sleep(delay)
                    self._last_request = time.monotonic()
                    with self._client.stream("GET", f"{self.base_url}/{endpoint}",
                                             params={"OC": self.oc, **params}) as response:
                        status = response.status_code
                        if status != 200:
                            retry = status in {408, 429} or 500 <= status <= 599
                            error = LawSourceError("access_denied" if status == 403 else "http_error",
                                                   "법령 API HTTP 요청이 실패했습니다.", source, retry, status)
                            if not retry or attempt == self.retries:
                                raise error
                            retry_after = response.headers.get("Retry-After", "")
                            wait = min(5.0, float(retry_after)) if re.fullmatch(r"\d+(?:\.\d+)?", retry_after) else min(4.0, .25 * 2 ** attempt)
                        else:
                            chunks: list[bytes] = []
                            size = 0
                            for chunk in response.iter_bytes():
                                size += len(chunk)
                                if size > MAX_RESPONSE_BYTES:
                                    raise LawSourceError("response_too_large", "법령 API 응답 크기 제한을 초과했습니다.", source)
                                chunks.append(chunk)
                            return b"".join(chunks)
                time.sleep(wait)
            except httpx.ProxyError as error:
                # CONNECT failures do not produce an HTTP response. Inspect only
                # the status marker and never publish exception URLs or OC values.
                if re.search(r"\b403\b", str(error)):
                    raise LawSourceError("proxy_access_denied", "환경 프록시가 법령 API 연결을 차단했습니다. 네트워크 허용 설정을 확인하세요.",
                                         source, False, 403) from None
                if attempt == self.retries:
                    raise LawSourceError("network_error", "법령 API 네트워크 요청이 실패했습니다.", source, True) from None
                time.sleep(min(4.0, .25 * 2 ** attempt))
            except httpx.HTTPError:
                if attempt == self.retries:
                    raise LawSourceError("network_error", "법령 API 네트워크 요청이 실패했습니다.", source, True) from None
                time.sleep(min(4.0, .25 * 2 ** attempt))
        raise AssertionError("unreachable")

    def _source_url(self, source: str, source_id: str, version_id: str, identifier_type: str | None = None) -> str:
        params = self._full_params(source, source_id, version_id, identifier_type)
        return f"{self.base_url}/lawService.do?{urlencode(params)}"

    def _check_credentials_in_response(self, raw: bytes, source: str) -> None:
        # Persisting exact official bytes must never persist an echoed API secret.
        candidates = {self.oc.encode(), quote(self.oc, safe="").encode()}
        scanned = raw.replace(b"\x00", b"")
        if (any(candidate and candidate in scanned for candidate in candidates)
                or re.search(rb"(?i)(?:[?&]|&amp;)OC\s*=\s*[^&\s\"<>]+", scanned)):
            raise LawSourceError("credential_in_response", "법령 API 응답에 인증 정보가 포함되어 저장할 수 없습니다.", source)

    def _public_field(self, value: str) -> str:
        try:
            parsed = urlsplit(value)
        except ValueError:
            return "[invalid link]"
        if parsed.scheme in {"http", "https"} and parsed.hostname:
            filtered = [(key, val) for key, val in parse_qsl(parsed.query) if key.lower() != "oc"]
            value = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(filtered), ""))
        value = re.sub(r"(?i)\bOC\s*=\s*[^\s&<>]+", "OC=[redacted]", value)
        return value.replace(self.oc, "[redacted]") if self.oc else value

    @staticmethod
    def _full_params(source: str, source_id: str, version_id: str, identifier_type: str | None = None) -> dict[str, str]:
        key = "MST" if source in {"law", "ordinance"} and (identifier_type == "MST" or version_id != source_id) else "ID"
        value = version_id if key == "MST" or source == "administrative" else source_id
        return {"target": SOURCES[source]["target"], "type": "XML", key: value}

    def catalog(self, source: str, page: int = 1, page_size: int = 100) -> dict[str, Any]:
        source = canonical_source(source)
        if isinstance(page, bool) or not isinstance(page, int) or page < 1 or isinstance(page_size, bool) or not isinstance(page_size, int) or not 1 <= page_size <= 100:
            raise LawSourceError("invalid_pagination", "페이지는 양의 정수, 페이지 크기는 1~100이어야 합니다.", source)
        raw = self._request("lawSearch.do", {"target": SOURCES[source]["target"], "type": "XML", "page": page, "display": page_size}, source)
        root, _ = _parse_response(raw, source)
        _check_api_error(root, source)
        if _tag(root) != SOURCES[source]["search_root"]:
            raise LawSourceError("unexpected_schema", "요청한 자료 범위의 법령 목록 응답이 아닙니다.", source)
        declared = _value(root, "totalCnt")
        if declared is None or not re.fullmatch(r"\d+", declared):
            raise LawSourceError("unknown_total", "법령 목록의 전체 개수를 확인할 수 없습니다.", source)
        total = int(declared)
        nodes = _children(root, SOURCES[source]["items"])
        expected = min(page_size, max(0, total - (page - 1) * page_size))
        if len(nodes) != expected:
            raise LawSourceError("incomplete_page", "법령 목록 개수와 선언된 전체 개수가 일치하지 않습니다.", source)
        items = []
        seen = set()
        for node in nodes:
            source_id, version_id, title = _identity(node, source)
            version_identifier_available = bool(version_id)
            identifier_type = "MST" if source in {"law", "ordinance"} and version_id else "ID"
            version_id = version_id or source_id
            if not source_id or not version_id or not title:
                raise LawSourceError("missing_identity", "법령 목록에 식별자 또는 명칭이 누락되었습니다.", source)
            if self.oc in source_id or self.oc in version_id:
                raise LawSourceError("credential_in_response", "법령 목록의 식별자에 인증 정보가 포함되어 있습니다.", source)
            if version_id in seen:
                raise LawSourceError("duplicate_identity", "법령 목록에 중복 버전 식별자가 있습니다.", source)
            seen.add(version_id)
            warnings: list[str] = []
            publication_date = _iso_date(_metadata_value(node, "공포일자", "발령일자", "제정일자", source=source), "publication_date", warnings)
            effective_date = _iso_date(_metadata_value(node, "시행일자", "시행일", source=source), "effective_date", warnings)
            items.append({"source": source, "source_id": source_id, "version_id": version_id, "title": self._public_field(title),
                          "publication_date": publication_date, "effective_date": effective_date,
                          "publication_no": self._public_field(number) if (number := _metadata_value(node, "공포번호", "발령번호", source=source)) else None,
                          "source_url": self._source_url(source, source_id, version_id, identifier_type),
                          "metadata": {"parse_warnings": warnings, "version_identifier_type": identifier_type,
                                       "version_identifier_available": version_identifier_available,
                                       "provider_contract_verified": False,
                                       "fields": {_tag(child): self._public_field("".join(child.itertext()).strip()) for child in node}}})
        return {"source": source, "page": page, "total": total, "total_pages": math.ceil(total / page_size),
                "items": items, "supported": True}

    def fetch_full(self, item: dict[str, Any]) -> dict[str, Any]:
        source = canonical_source(item.get("source", ""))
        source_id, version_id = str(item.get("source_id") or ""), str(item.get("version_id") or "")
        if not source_id or not version_id:
            raise LawSourceError("missing_identity", "법령 본문 조회에는 자료와 버전 식별자가 필요합니다.", source)
        identifier_type = item.get("metadata", {}).get("version_identifier_type")
        raw = self._request("lawService.do", self._full_params(source, source_id, version_id, identifier_type), source)
        self._check_credentials_in_response(raw, source)
        root, raw_format = _parse_response(raw, source)
        _check_api_error(root, source)
        if _tag(root) not in SOURCES[source]["full_roots"]:
            raise LawSourceError("unexpected_schema", "요청한 자료 범위의 법령 본문 응답이 아닙니다.", source)
        if source == "ordinance" and _tag(root) == "LawService" and not _children(root, {"자치법규기본정보"}):
            raise LawSourceError("unexpected_schema", "자치법규 본문 응답의 기본정보를 확인할 수 없습니다.", source)
        actual_id, actual_version, title = _identity(root, source)
        if not actual_id and not actual_version:
            raise LawSourceError("identity_unverifiable", "법령 본문 응답의 자료 식별자를 확인할 수 없습니다.", source)
        if actual_id and actual_id != source_id and actual_id != version_id:
            raise LawSourceError("identity_mismatch", "요청한 법령과 본문 응답의 식별자가 일치하지 않습니다.", source)
        requested_version_known = identifier_type == "MST" or version_id != source_id or source == "administrative"
        if actual_version and requested_version_known and actual_version != version_id:
            raise LawSourceError("version_mismatch", "요청한 버전과 법령 본문 응답의 버전이 일치하지 않습니다.", source)
        if not title:
            raise LawSourceError("missing_identity", "법령 본문 응답에 명칭이 누락되었습니다.", source)
        warnings: list[str] = []
        publication_date = _iso_date(_metadata_value(root, "공포일자", "발령일자", "제정일자", source=source), "publication_date", warnings)
        effective_date = _iso_date(_metadata_value(root, "시행일자", "시행일", source=source), "effective_date", warnings)
        provisions = _provisions(root, warnings, source)
        supplementary, attachments = _sections(root)
        # Preserve unstructured preambles as well as article fragments. For
        # structured responses, keep the article-only flattening without adding
        # a second copy of the same body from a summary text field.
        text = (_unstructured_content(root) if "unstructured_paragraphs" in warnings else
                "\n\n".join(provision["text"] for provision in provisions if provision["text"]))
        if not text:
            text = _unstructured_content(root)
        if not text.strip():
            raise LawSourceError("missing_content", "법령 본문 응답에 조문 내용이 없습니다.", source)
        if not provisions:
            warnings.append("unparsed_provisions")
        if attachments:
            warnings.append("attachment_files_not_downloaded")
        if not actual_id:
            warnings.append("missing_document_identity")
        if not actual_version:
            warnings.append("missing_document_version")
        if not requested_version_known:
            warnings.append("requested_version_unverified")
        return {"source": source, "source_id": source_id, "version_id": version_id, "title": title,
                "publication_date": publication_date, "effective_date": effective_date,
                "publication_no": _metadata_value(root, "공포번호", "발령번호", source=source),
                "source_url": self._source_url(source, source_id, version_id, identifier_type), "raw": raw,
                "raw_format": raw_format, "text": text, "provisions": provisions,
                "metadata": {"parse_warnings": sorted(set(warnings)), "official_response": True,
                             "response_identity_verified": bool(actual_id),
                             "response_version_verified": bool(actual_version and requested_version_known and actual_version == version_id),
                             "response_version_id": actual_version,
                             "supplementary_provisions": supplementary, "attachments": attachments,
                             "attachment_count": len(attachments), "attachments_downloaded": False,
                             "full_legal_coverage_verified": False, "provider_contract_verified": False,
                             "unit_coverage": {"articles": bool(provisions),
                                               "paragraphs": any(p["paragraphs"] for p in provisions),
                                               "items": any(paragraph["items"] for p in provisions for paragraph in p["paragraphs"]),
                                               "subitems": False}}}
