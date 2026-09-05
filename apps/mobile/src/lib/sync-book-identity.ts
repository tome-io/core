import { bookIdentity, publicationAliases } from '@tomeio/domain';
import type { LibraryBook } from './library';

export function syncBookIdentity(book: LibraryBook): string {
  const aliases = publicationAliases(book.title, [book.author], { ...book.extension?.book.identifiers, ...book.identifiers });
  if (aliases.some((alias) => alias.startsWith('publication:'))) return bookIdentity(book.title, book.author);
  return aliases[0] ?? `key:${book.key}`;
}

export function syncAliases(book: LibraryBook): string[] {
  const format = book.format || book.local?.format || "";
  return [
    `key:${book.key}`,
    ...(book.syncAliases ?? []),
    ...(book.linkedBookKeys ?? []).map((key) => `key:${key}`),
    ...publicationAliases(book.title, [book.author], { ...book.extension?.book.identifiers, ...book.identifiers }),
    ...(/^(?:unknown(?: author)?)?$/i.test(book.author.trim()) ? [] : [`identity:${bookIdentity(book.title, book.author, format)}`]),
    book.discovery?.id ? `discovery:${book.discovery.id}` : "",
    book.local?.filename ? `filename:${book.local.filename.toLowerCase()}` : "",
    book.moonReader?.sourceFilename
      ? `filename:${book.moonReader.sourceFilename.toLowerCase()}`
      : "",
  ].filter(Boolean);
}

export function withBookSyncAliases<T extends { syncAliases?: string[] }>(
  book: T,
  aliases: readonly string[],
): T {
  const known = new Set(book.syncAliases ?? []);
  for (const alias of aliases) if (alias) known.add(alias);
  if (known.size === (book.syncAliases?.length ?? 0)) return book;
  return { ...book, syncAliases: [...known].sort() };
}
