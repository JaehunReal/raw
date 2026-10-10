export type Provision = {
  article_no: string;
  title?: string;
  text: string;
  deleted?: boolean;
  paragraphs?: {
    paragraph_no: string | null;
    text: string;
    items?: {
      item_no: string;
      text: string;
      subitems?: { subitem_no: string; text: string }[];
    }[];
  }[];
};

export type Unit = {
  id: string;
  label: string;
  fullLabel: string;
  article: string;
  articleTitle: string;
  paragraph: string | null;
  item: string | null;
  subitem: string | null;
  text: string;
  deleted: boolean;
  depth: number;
};

export function makeUnits(provisions: Provision[]): Unit[] {
  const units: Unit[] = [];
  function add(
    a: string,
    title: string,
    p: string | null,
    i: string | null,
    s: string | null,
    text: string,
    deleted: boolean
  ) {
    const rawLabel = a + (p ? `제${p}항` : '') + (i ? `제${i}호` : '') + (s ? `${s}목` : '');
    const cleanTitle = title.replace(/[()]/g, '').trim();
    const titleSuffix = cleanTitle ? `(${cleanTitle})` : '';
    const fullLabel = a + titleSuffix + (p ? ` 제${p}항` : '') + (i ? ` 제${i}호` : '') + (s ? ` ${s}목` : '');

    units.push({
      id: 'provision-' + encodeURIComponent(JSON.stringify([a, p, i, s])),
      label: rawLabel,
      fullLabel,
      article: a,
      articleTitle: cleanTitle,
      paragraph: p,
      item: i,
      subitem: s,
      text,
      deleted,
      depth: s ? 3 : i ? 2 : p ? 1 : 0,
    });
  }

  for (const a of provisions) {
    if (!a.article_no) continue;
    const titleMatch = a.text.match(/^제\s*\d+\s*조(?:의\s*\d+)?\s*\(([^)]+)\)/);
    const title = (a.title || (titleMatch ? titleMatch[1] : '')).trim();

    add(a.article_no, title, null, null, null, a.text, !!a.deleted);
    for (const p of a.paragraphs || []) {
      if (p.paragraph_no) add(a.article_no, title, p.paragraph_no, null, null, p.text, !!a.deleted);
      for (const item of p.items || []) {
        if (!item.item_no) continue;
        add(a.article_no, title, p.paragraph_no, item.item_no, null, item.text, !!a.deleted);
        for (const s of item.subitems || []) {
          const sn = s.subitem_no?.replace(/[.목\s]/g, '');
          if (sn) add(a.article_no, title, p.paragraph_no, item.item_no, sn, s.text, !!a.deleted);
        }
      }
    }
  }
  return units;
}

export type Reference = {
  text: string;
  start: number;
  end: number;
  target?: string;
  reason?: string;
};

export function references(unit: Unit, units: Unit[]): Reference[] {
  const result: Reference[] = [];
  const pattern =
    /(?:제\s*\d+\s*조(?:의\s*\d+)?)(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?(?:\s*[가-힣]목)?|제\s*\d+\s*항(?:\s*제\s*\d+\s*호)?(?:\s*[가-힣]목)?|제\s*\d+\s*호(?:\s*[가-힣]목)?/g;
  for (const m of unit.text.matchAll(pattern)) {
    const t = m[0].replace(/\s/g, ''),
      a = t.match(/^제\d+조(?:의\d+)?/)?.[0];
    const p = t.match(/제(\d+)항/)?.[1] ?? (a ? null : unit.paragraph);
    const i = t.match(/제(\d+)호/)?.[1] ?? null;
    const s = t.match(/([가-힣])목$/)?.[1] ?? null;
    const prefix = unit.text.slice(0, m.index);
    // A complete unit can refer to another law or anaphoric context. Keep these
    // visible but do not turn a matching local number into a misleading link.
    const external =
      /[「『]|법|시행령|규칙|같은\s*(법|영|규칙|조|항)|전항|전조|이하|부터|내지|각\s*호/.test(
        unit.text
      );
    const matches = units.filter(
      (n) =>
        n.article === (a || unit.article) &&
        n.paragraph === p &&
        n.item === i &&
        n.subitem === s
    );
    const ownHeading = prefix.trim() === '' && matches.some((n) => n.id === unit.id);
    if (ownHeading) continue;
    const unsupportedBranch = /^\s*의\s*\d/.test(
      unit.text.slice(m.index! + m[0].length)
    );
    const reason =
      external || unsupportedBranch
        ? '문맥 확인 필요'
        : matches.length > 1
        ? '대상 중복'
        : !matches.length
        ? '대상 미확인'
        : matches[0].deleted
        ? '삭제된 조문'
        : undefined;
    result.push({
      text: m[0],
      start: m.index!,
      end: m.index! + m[0].length,
      ...(reason ? { reason } : { target: matches[0].id }),
    });
  }
  return result;
}
