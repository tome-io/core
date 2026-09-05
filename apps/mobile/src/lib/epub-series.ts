// Read declared positions only; numbers in titles/subjects are not series data.
export function epubSeriesPosition(xml: string): number | undefined {
  const metas = [...xml.matchAll(/<(?:\w+:)?meta\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:\w+:)?meta\s*>)/gi)].map((match) => {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map((attribute) => [attribute[1], attribute[3]]));
    return { attributes, value: (match[2] ?? '').trim() };
  });
  const number = (value: string | undefined) => value && /^\d+(?:\.\d+)?$/.test(value.trim()) && Number.isFinite(Number(value)) ? Number(value) : undefined;
  const calibre = metas.find((meta) => meta.attributes.name === 'calibre:series_index');
  if (metas.some((meta) => meta.attributes.name === 'calibre:series' && meta.attributes.content)) {
    const position = number(calibre?.attributes.content);
    if (position != null) return position;
  }
  for (const collection of metas.filter((meta) => meta.attributes.property === 'belongs-to-collection' && meta.attributes.id)) {
    const refinements = metas.filter((meta) => meta.attributes.refines === `#${collection.attributes.id}`);
    if (!refinements.some((meta) => meta.attributes.property === 'collection-type' && meta.value === 'series')) continue;
    const position = number(refinements.find((meta) => meta.attributes.property === 'group-position')?.value);
    if (position != null) return position;
  }
  return undefined;
}
