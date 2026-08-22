/**
 * Client-side ranking for Z-Library string-search results. The eapi has no
 * ISBN/work-id lookup, so we rank by title/author overlap and bury the
 * workbook/summary spam.
 */
export function rankZlibMatches<T extends { title: string; author?: string }>(
  books: T[],
  title: string,
  author: string
): T[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const core = norm(title.split(/[:(-]/)[0]).trim();
  const words = core
    .split(/\s+/)
    .filter((w) => w.length > 1 && !['the', 'a', 'an', 'of', 'and'].includes(w));
  const authorTokens = norm(author).split(/\s+/).filter(Boolean);

  const score = (b: T): number => {
    const t = norm(b.title);
    const a = norm(b.author || '');
    let sc = 0;
    if (t === core) sc += 6;
    else if (t.includes(core)) sc += 4;
    for (const w of words) if (t.includes(w)) sc += 1;
    for (const at of authorTokens) if (at && a.includes(at)) sc += 2;
    if (/workbook|summary|study guide|solutions|answer key|coloring book/.test(t)) sc -= 5;
    return sc;
  };

  return [...books].sort((a, b) => score(b) - score(a));
}
