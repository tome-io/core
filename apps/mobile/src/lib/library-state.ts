import type { LibraryBook, LibraryState } from './library';
import { bookIdentity } from './book-metadata';

function comparableFileUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function reconcileLibraryStateWithLocalCatalog(
  state: LibraryState,
  localBooks: LibraryBook[]
): LibraryState {
  const availableUris = new Set(
    localBooks
      .map((book) => book.local?.uri ?? book.fileUri)
      .filter((uri): uri is string => !!uri)
      .map(comparableFileUri)
  );
  const localByIdentity = new Map(
    localBooks.map((book) => [bookIdentity(book.title, book.author), book] as const)
  );
  const withAvailability = (book: LibraryBook) => {
    const uri = book.local?.uri ?? book.fileUri;
    const matchingLocal = localByIdentity.get(bookIdentity(book.title, book.author));
    if (matchingLocal) {
      const localUri = matchingLocal.local?.uri ?? matchingLocal.fileUri;
      const alreadyLinked =
        book.availableLocally === true &&
        book.local?.uri === matchingLocal.local?.uri &&
        book.fileUri === localUri;
      if (alreadyLinked) return book;
      return {
        ...book,
        fileUri: localUri,
        local: matchingLocal.local,
        format: book.format || matchingLocal.format,
        size: book.size ?? matchingLocal.size,
        availableLocally: true,
        ...(book.moonReader
          ? {
              moonReader: {
                ...book.moonReader,
                availableLocally: true,
              },
            }
          : {}),
      };
    }
    const availableLocally =
      (uri ? availableUris.has(comparableFileUri(uri)) : false) ||
      book.moonReader?.availableLocally === true;
    if (availableLocally) {
      return book.availableLocally !== true
        ? { ...book, availableLocally: true }
        : book;
    }
    return book.availableLocally === false
      ? book
      : { ...book, availableLocally: false };
  };

  // A scanned local file is the canonical library entry. Keeping the earlier
  // download/import record alongside it creates a second card for the same
  // document (often with a provider key or the mirror folder URI).
  const downloaded = state.downloaded.flatMap((book) =>
    localByIdentity.has(bookIdentity(book.title, book.author))
      ? []
      : [withAvailability(book)],
  );
  const readingList = state.readingList.map(withAvailability);
  if (
    downloaded.length === state.downloaded.length &&
    readingList.length === state.readingList.length &&
    downloaded.every((book, index) => book === state.downloaded[index]) &&
    readingList.every((book, index) => book === state.readingList[index])
  ) {
    return state;
  }
  return { ...state, downloaded, readingList };
}
