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
  displayLabel?: string;
  reason?: string;
};

export function references(unit: Unit, units: Unit[]): Reference[] {
  const result: Reference[] = [];
  const text = unit.text;

  const pattern =
    /(?:제\s*\d+\s*조(?:의\s*\d+)?)(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?(?:\s*[가-힣]목)?|제\s*\d+\s*항(?:\s*제\s*\d+\s*호)?(?:\s*[가-힣]목)?|제\s*\d+\s*호(?:\s*[가-힣]목)?|(?:다음(?:의)?\s*)?각\s*호/g;

  for (const m of text.matchAll(pattern)) {
    const matchedStr = m[0];
    const cleanStr = matchedStr.replace(/\s/g, '');
    const prefix = text.slice(0, m.index!);
    const suffix = text.slice(m.index! + m[0].length);

    // Case A: 각 호 / 다음 각 호
    if (cleanStr.includes('각호')) {
      const firstItem =
        units.find(
          (n) =>
            n.article === unit.article &&
            (unit.paragraph ? n.paragraph === unit.paragraph : true) &&
            n.item === '1'
        ) ||
        units.find((n) => n.article === unit.article && n.item === '1');
      if (firstItem && firstItem.id !== unit.id) {
        if (!result.some((r) => r.target === firstItem.id)) {
          result.push({
            text: matchedStr.trim(),
            displayLabel: `${matchedStr.trim()} (${firstItem.article} 제1호~)`,
            target: firstItem.id,
            start: m.index!,
            end: m.index! + m[0].length,
          });
        }
      }
      continue;
    }

    const a = cleanStr.match(/^제\d+조(?:의\d+)?/)?.[0];
    const p = cleanStr.match(/제(\d+)항/)?.[1] ?? (a ? null : unit.paragraph);
    const i = cleanStr.match(/제(\d+)호/)?.[1] ?? null;
    const s = cleanStr.match(/([가-힣])목$/)?.[1] ?? null;

    // A complete unit can refer to another law or anaphoric context.
    const external =
      /[「『][^」』\n]{2,180}[」』]\s*$/.test(prefix) ||
      /[가-힣]+법\s*$/.test(prefix) ||
      /같은\s*(?:법|영|규칙|조|항)\s*$/.test(prefix) ||
      /^\s*(?:부터|내지)/.test(suffix) ||
      /전항|전조|이하|내지/.test(prefix.slice(-6));

    const matches = units.filter(
      (n) =>
        n.article === (a || unit.article) &&
        n.paragraph === p &&
        n.item === i &&
        n.subitem === s
    );

    const ownHeading = prefix.trim() === '' && matches.some((n) => n.id === unit.id);
    if (ownHeading) continue;

    const unsupportedBranch = /^\s*의\s*\d/.test(suffix);

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

    const targetId = matches.length === 1 && !reason ? matches[0].id : undefined;

    // Deduplicate identical targets within the same unit
    if (targetId && result.some((r) => r.target === targetId)) {
      continue;
    }

    result.push({
      text: m[0],
      start: m.index!,
      end: m.index! + m[0].length,
      displayLabel: matches[0]?.fullLabel,
      ...(reason ? { reason } : { target: targetId }),
    });
  }

  return result;
}
