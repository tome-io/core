import type {
  DecorationGroup,
  Locator,
  Preferences,
  ReadiumFile,
} from 'react-native-readium';

import type { LibraryBook } from './library';
import { materializeNativeFolderFile } from './native-folder-file';
import type {
  ReaderHighlight,
  ReaderLocator,
  ReaderPreferences,
  ReaderTheme,
} from './reader-state';

const THEME_COLORS: Record<
  ReaderTheme,
  { backgroundColor: string; textColor: string }
> = {
  light: { backgroundColor: '#FAF8F2', textColor: '#1F1A17' },
  sepia: { backgroundColor: '#F2E5C4', textColor: '#382D22' },
  dark: { backgroundColor: '#100B08', textColor: '#F4EDE7' },
};

function bookFormat(book: LibraryBook): string {
  return (book.local?.format ?? book.format ?? '').toLowerCase();
}

function isSupportedFormat(format: string): boolean {
  return format === 'epub' || format === 'pdf';
}

export function canReadInTomeio(book: LibraryBook): boolean {
  return (
    isSupportedFormat(bookFormat(book)) &&
    book.availableLocally !== false &&
    book.moonReader?.availableLocally !== false &&
    !!(book.local?.uri ?? book.fileUri)
  );
}

export async function prepareReadiumFile(
  book: LibraryBook,
  initialLocation?: ReaderLocator,
): Promise<ReadiumFile> {
  const format = bookFormat(book);
  if (!isSupportedFormat(format)) {
    throw new Error('The Tomeio reader currently supports EPUB and PDF books only.');
  }
  const source = book.local?.uri ?? book.fileUri;
  if (!source || book.availableLocally === false) {
    throw new Error('Download this book before reading it in Tomeio.');
  }
  const url = await materializeNativeFolderFile(
    source,
    book.local?.filename ?? `${book.title}.${format}`,
  );
  return {
    url,
    ...(initialLocation ? { initialLocation: toReadiumLocator(initialLocation) } : {}),
  };
}

export function toReadiumLocator(locator: ReaderLocator): Locator {
  return {
    ...locator,
    locations: {
      progression: locator.locations?.progression ?? 0,
      ...(locator.locations?.position == null
        ? {}
        : { position: locator.locations.position }),
      ...(locator.locations?.totalProgression == null
        ? {}
        : { totalProgression: locator.locations.totalProgression }),
    },
  };
}

export function readiumPreferences(
  preferences: ReaderPreferences,
  isLandscape = false,
): Preferences {
  const colors = THEME_COLORS[preferences.theme];
  const usesTwoPageSpread = isLandscape && !preferences.scroll;
  return {
    ...preferences,
    ...colors,
    typeScale: preferences.fontSize,
    columnCount: usesTwoPageSpread ? '2' : '1',
    spread: usesTwoPageSpread ? 'always' : 'never',
  };
}

export function readerThemeColors(theme: ReaderTheme) {
  return THEME_COLORS[theme];
}

export function readiumDecorations(
  highlights: ReaderHighlight[],
): DecorationGroup[] {
  return [
    {
      name: 'highlights',
      decorations: highlights.map((highlight) => ({
        id: highlight.id,
        locator: toReadiumLocator(highlight.locator),
        style: { type: 'highlight', tint: highlight.color },
        extras: {
          selectedText: highlight.selectedText,
          createdAt: String(highlight.createdAt),
        },
      })),
    },
  ];
}
