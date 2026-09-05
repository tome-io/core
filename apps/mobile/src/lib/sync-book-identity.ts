import { bookIdentity, publicationAliases } from '@tomeio/domain';
import type { LibraryBook } from './library';

export function syncBookIdentity(book: LibraryBook): string {
  const aliases = publicationAliases(book.title, [book.author], { ...book.extension?.book.identifiers, ...book.identifiers });
  if (aliases.some((alias) => alias.startsWith('publication:'))) return bookIdentity(book.title, book.author);
  return aliases[0] ?? `key:${book.key}`;
}
