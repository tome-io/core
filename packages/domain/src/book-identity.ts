export function normalizeIsbn(value: string): string | null {
  let isbn = value.replace(/^(?:urn:)?isbn(?:-1[03])?:?\s*/i, '').replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce((total, digit, index) => total + (10 - index) * (digit === 'X' ? 10 : Number(digit)), 0);
    if (sum % 11) return null;
    isbn = `978${isbn.slice(0, 9)}`;
    const checksum = (10 - [...isbn].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0) % 10) % 10;
    return `${isbn}${checksum}`;
  }
  if (!/^97[89]\d{10}$/.test(isbn)) return null;
  return [...isbn].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === 0 ? isbn : null;
}

export function publicationAliases(title: string, authors: string[], identifiers: Record<string, string> = {}): string[] {
  const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const isbns = Object.entries(identifiers).flatMap(([scheme, value]) => {
    if (!scheme.toLowerCase().includes('isbn') && !/^urn:isbn:/i.test(value)) return [];
    const isbn = normalizeIsbn(value);
    return isbn ? [`isbn:${isbn}`] : [];
  });
  const names = authors.map(normalize).filter((name) => name && name !== 'unknown' && name !== 'unknown author').sort();
  const normalizedTitle = normalize(title);
  return [...new Set([...isbns, ...(normalizedTitle && names.length
    ? [`publication:${JSON.stringify([normalizedTitle, names])}`] : [])])];
}

// A later record may bridge several previously separate identity groups.
export function identityGroups<T extends { identity: string; aliases: string[] }>(records: T[]): T[][] {
  const groups = new Map<number, T[]>();
  const indexes = new Map<string, number>();
  let nextIndex = 0;
  for (const record of records) {
    const aliases = [record.identity, ...record.aliases];
    const matches = [...new Set(aliases.flatMap((alias) => indexes.has(alias) ? [indexes.get(alias)!] : []))];
    const index = matches[0] ?? nextIndex++;
    const group = [...matches.flatMap((match) => groups.get(match) ?? []), record];
    for (const match of matches) groups.delete(match);
    groups.set(index, group);
    for (const member of group) for (const alias of [member.identity, ...member.aliases]) indexes.set(alias, index);
  }
  return [...groups.values()];
}
