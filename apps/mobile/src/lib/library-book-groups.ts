import { identityGroups, publicationAliases } from '@tomeio/domain';
import type { LibraryBook } from './library';

export function sameLibraryBook(left: LibraryBook, right: LibraryBook): boolean {
  const aliases = (book: LibraryBook) => [book.key, ...(book.linkedBookKeys ?? []),
    ...publicationAliases(book.title, [book.author], { ...book.extension?.book.identifiers, ...book.identifiers })];
  const leftAliases = new Set(aliases(left));
  return aliases(right).some((alias) => leftAliases.has(alias));
}

export function groupLibraryBooks(books: LibraryBook[]): LibraryBook[] {
  return identityGroups(books.map((book) => ({
    identity: book.key,
    aliases: [...(book.linkedBookKeys ?? []), ...publicationAliases(book.title, [book.author],
      { ...book.extension?.book.identifiers, ...book.identifiers })],
    book,
  }))).map((group) => {
    const candidates = group.map(({ book }) => book);
    const local = candidates.filter((book) => book.availableLocally !== false && (book.local || book.fileUri));
    const preferred = [...(local.length ? local : candidates)].sort((a, b) => a.key.localeCompare(b.key))[0];
    const files = new Map(candidates.flatMap((book) => [
      ...(book.localFiles ?? []), ...(book.local ? [{ bookKey: book.key, file: book.local }] : []),
    ]).map((file) => [file.file.uri, file]));
    return {
      ...preferred,
      identifiers: Object.assign({}, ...candidates.map((book) => ({ ...book.extension?.book.identifiers, ...book.identifiers }))),
      linkedBookKeys: [...new Set(candidates.flatMap((book) => [book.key, ...(book.linkedBookKeys ?? [])]))],
      localFiles: [...files.values()],
      progress: Math.max(...candidates.map((book) => book.isRead ? 100 : book.progress ?? 0)),
      isRead: candidates.some((book) => book.isRead),
      readingTimeMs: Math.max(...candidates.map((book) => book.readingTimeMs ?? 0)),
      lastReadAt: Math.max(...candidates.map((book) => book.lastReadAt ?? 0)) || undefined,
    };
  });
}
