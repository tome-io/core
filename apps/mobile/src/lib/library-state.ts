import type { LibraryBook, LibraryState } from './library';

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
  const withAvailability = (book: LibraryBook) => {
    const uri = book.local?.uri ?? book.fileUri;
    if (!uri) return book;
    const availableLocally = availableUris.has(comparableFileUri(uri));
    if (availableLocally) {
      return book.availableLocally === false
        ? { ...book, availableLocally: true }
        : book;
    }
    return book.availableLocally === false
      ? book
      : { ...book, availableLocally: false };
  };

  const downloaded = state.downloaded.map(withAvailability);
  const readingList = state.readingList.map(withAvailability);
  if (
    downloaded.every((book, index) => book === state.downloaded[index]) &&
    readingList.every((book, index) => book === state.readingList[index])
  ) {
    return state;
  }
  return { ...state, downloaded, readingList };
}
