// Ordinance API: four digits for the article, two for its branch.
// Normalize the read projection; retain original source and stored identifiers.
export function normalizeDocumentNumbers(document) {
  if (!document || document.source !== 'ordinance' || !Array.isArray(document.provisions)) return document;
  return {...document, provisions: document.provisions.map(p => {
    const raw = String(p.metadata?.original_article_no ?? '');
    if (!/^[0-9]{6}$/.test(raw) || Number(raw.slice(0, 4)) === 0) return p;
    const branch = Number(raw.slice(4));
    const number = `제${Number(raw.slice(0, 4))}조${branch ? `의${branch}` : ''}`;
    if (number === p.article_no) return p;
    return {...p, article_no: number, metadata: {...p.metadata,
      stored_article_no: p.article_no, article_number_normalization: 'ordinance-packed-v1'}};
  })};
}
