import { useEffect, useState } from "react";
import { ArrowUpRight, FileText, Search } from "lucide-react";

type Attachment = {
  id: string; title: string; name: string; source: string; version_id: string;
  role: "body" | "body_candidate" | "annex" | "attachment"; format: string;
  original_url: string; sha256: string | null;
  conversion: { markdown: string; json: string; bundle: string } | null;
};
type Catalog = { generated_at: string; scope: string; items: Attachment[] };

function originalUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["law.go.kr", "www.law.go.kr"].includes(url.hostname)
      && !url.username && !url.password && !url.port
      && ![...url.searchParams.keys()].some((k) => ["oc", "token", "key"].includes(k.toLowerCase()));
  } catch { return false; }
}
const conversionUrl = (value: string) => /^\/official-attachments\/[a-f0-9]{64}\/(document\.(md|json)|bundle\.zip)$/.test(value);

export default function AttachmentLibrary() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/official-attachments/catalog.json", { signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: Catalog) => {
        if (!Array.isArray(data.items) || !Number.isFinite(Date.parse(data.generated_at))) throw new Error();
        const items = data.items.filter((a) => typeof a.title === "string" && typeof a.name === "string"
          && originalUrl(a.original_url) && ["body", "body_candidate", "annex", "attachment"].includes(a.role)
          && (!a.conversion || (conversionUrl(a.conversion.markdown) && conversionUrl(a.conversion.json) && conversionUrl(a.conversion.bundle))));
        if (!controller.signal.aborted) setCatalog({ ...data, items });
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  const matches = catalog?.items.filter((a) => `${a.title} ${a.name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) || [];
  const visible = matches.slice(page * 12, (page + 1) * 12);
  return <section className="panel attachment-library" data-testid="attachment-library">
    <div className="panel-heading"><div><span className="pill sage">원본 우선 제공</span><h2>첨부 원본과 변환본</h2><p>PDF·한글 파일은 공식 출처에서 바로 열어보세요. 품질을 확인한 변환본은 MD·JSON으로 함께 제공합니다.</p></div></div>
    <div className="attachment-policy"><FileText size={22} /><p><strong>본문 파일과 별표·서식을 구분합니다.</strong><br />본문 여부가 확인되지 않은 파일은 첨부 원본으로 표시합니다. 변환본은 검색·열람 편의를 위한 자료이며 정확한 내용은 원문을 확인하세요.</p></div>
    {failed ? <p role="alert">첨부 목록을 불러오지 못했습니다. 페이지를 새로고침해 주세요.</p> : !catalog ? <p role="status">첨부 목록을 불러오는 중입니다.</p> : <>
      <p className="attachment-scope">{catalog.scope} · 목록 기준 {new Date(catalog.generated_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })} (한국 시간)</p>
      <label className="attachment-search"><Search size={18} /><input aria-label="첨부 자료 검색" value={query} placeholder="문서명 또는 첨부파일명 검색" onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></label>
      <p>첨부 링크 {matches.length.toLocaleString("ko-KR")}건{query && " 검색됨"}</p>
      <div className="attachment-cards">{visible.map((item) => <article key={item.id}>
        <div><span className="pill">{item.format === "attachment" ? "첨부" : item.format.toUpperCase()}</span> <span className="attachment-role">{item.role === "body" ? "본문 파일" : item.role === "annex" ? "별표·서식" : "첨부 원본"}</span></div>
        <h3>{item.title}</h3><p className="attachment-name">{item.name}</p>
        <p>{item.role === "body" && item.format === "pdf" ? "이 문서의 본문은 PDF로 제공됩니다." : item.role === "annex" ? "관련 붙임 자료입니다." : "첨부 원본에서 내용을 확인하세요. 본문 전체인지 여부는 확인 중입니다."}</p>
        <div className="attachment-actions"><a className="button secondary" href={item.original_url} target="_blank" rel="noreferrer">{item.format === "pdf" ? "원본 PDF 보기" : "붙임 파일 보기"}<ArrowUpRight size={14} /></a>
          {item.conversion && <><a className="text-button" href={item.conversion.bundle} download>MD·JSON·이미지 묶음 받기</a><a className="text-button" href={item.conversion.markdown} download>MD</a><a className="text-button" href={item.conversion.json} download>JSON</a></>}
        </div>
        {!item.conversion && <small>변환본은 품질 확인 후 제공합니다.</small>}
        <details><summary>버전·원본 해시</summary><p>버전 {item.version_id}</p><code>{item.sha256 || "파일 해시 확인 전"}</code></details>
      </article>)}</div>
      {matches.length === 0 && <p>조건에 맞는 첨부 자료가 없습니다.</p>}
      <div className="official-pagination"><button disabled={page === 0} onClick={() => setPage(page - 1)}>이전</button><span>{matches.length ? page * 12 + 1 : 0}–{Math.min((page + 1) * 12, matches.length)} / {matches.length.toLocaleString("ko-KR")}</span><button disabled={(page + 1) * 12 >= matches.length} onClick={() => setPage(page + 1)}>다음</button></div>
    </>}
  </section>;
}
