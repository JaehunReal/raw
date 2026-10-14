type RecordType = { source: string; title: string };

export function lawFamilyBase(record?: RecordType | null): string | null {
  if (!record || record.source !== 'law') return null;
  const base = record.title.replace(/\s+시행(?:령|규칙)$/, '').trim();
  return /법$/.test(base) ? base : null;
}

export function documentType(record: RecordType): string {
  if (record.source === 'ordinance') return /규칙$/.test(record.title) ? '자치법규 · 규칙' : /조례$/.test(record.title) ? '자치법규 · 조례' : '자치법규';
  if (record.source === 'administrative') return '행정규칙';
  return /시행령$/.test(record.title) ? '시행령' : /시행규칙$/.test(record.title) ? '시행규칙' : /법$/.test(record.title) ? '법률' : '법령';
}

export function familyRecords<T extends RecordType>(items: T[], base: string) {
  const exact = (title: string) => items.find(x => x.source === 'law' && x.title === title);
  return { act: exact(base), decree: exact(`${base} 시행령`), rule: exact(`${base} 시행규칙`) };
}
