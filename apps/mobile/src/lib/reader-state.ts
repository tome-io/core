import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ReaderLocator {
  href: string;
  type: string;
  target?: number;
  title?: string;
  locations?: {
    progression?: number;
    position?: number;
    totalProgression?: number;
  };
  text?: {
    before?: string;
    highlight?: string;
    after?: string;
  };
}

export type ReaderTheme = 'light' | 'dark' | 'sepia';
export type ReaderFontFamily =
  | 'serif'
  | 'sans-serif'
  | 'IA Writer Duospace'
  | 'OpenDyslexic';

export interface ReaderPreferences {
  theme: ReaderTheme;
  fontFamily: ReaderFontFamily;
  fontSize: number;
  lineHeight: number;
  pageMargins: number;
  textAlign: 'start' | 'justify';
  scroll: boolean;
  publisherStyles: boolean;
}

export interface ReaderHighlight {
  id: string;
  locator: ReaderLocator;
  color: string;
  selectedText: string;
  createdAt: number;
}

export interface BookReaderState {
  locator?: ReaderLocator;
  highlights: ReaderHighlight[];
  readingTimeMs: number;
  lastOpenedAt?: number;
}

interface ReaderStateStore {
  version: 1;
  preferences: ReaderPreferences;
  books: Record<string, BookReaderState>;
}

const READER_STATE_KEY = 'tomeio_reader_state_v1';

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: 'light',
  fontFamily: 'serif',
  fontSize: 1,
  lineHeight: 1.5,
  pageMargins: 1,
  textAlign: 'start',
  scroll: false,
  publisherStyles: true,
};

const EMPTY_BOOK_STATE: BookReaderState = {
  highlights: [],
  readingTimeMs: 0,
};

interface ReaderStateGlobal {
  __tomeioReaderStateWriteQueue?: Promise<void>;
}

const readerStateGlobal = globalThis as unknown as ReaderStateGlobal;
readerStateGlobal.__tomeioReaderStateWriteQueue ??= Promise.resolve();

function parseStore(raw: string): ReaderStateStore {
  const parsed = JSON.parse(raw) as Partial<ReaderStateStore>;
  if (
    parsed.version !== 1 ||
    !parsed.preferences ||
    typeof parsed.preferences !== 'object' ||
    !parsed.books ||
    typeof parsed.books !== 'object' ||
    Array.isArray(parsed.books)
  ) {
    throw new Error('Stored Tomeio reader state is invalid.');
  }
  return parsed as ReaderStateStore;
}

async function loadStore(): Promise<ReaderStateStore> {
  const raw = await AsyncStorage.getItem(READER_STATE_KEY);
  if (!raw) {
    return {
      version: 1,
      preferences: DEFAULT_READER_PREFERENCES,
      books: {},
    };
  }
  return parseStore(raw);
}

function normalizeBookState(state?: Partial<BookReaderState>): BookReaderState {
  return {
    ...(state?.locator ? { locator: state.locator } : {}),
    highlights: Array.isArray(state?.highlights) ? state.highlights : [],
    readingTimeMs:
      typeof state?.readingTimeMs === 'number' && state.readingTimeMs >= 0
        ? state.readingTimeMs
        : 0,
    ...(typeof state?.lastOpenedAt === 'number'
      ? { lastOpenedAt: state.lastOpenedAt }
      : {}),
  };
}

export function canonicalReaderBookKey(bookKey: string): string {
  try {
    return decodeURIComponent(bookKey);
  } catch {
    return bookKey;
  }
}

function bookStateForKey(
  store: ReaderStateStore,
  bookKey: string,
): BookReaderState {
  const canonicalKey = canonicalReaderBookKey(bookKey);
  const matches = Object.entries(store.books).filter(
    ([candidate]) => canonicalReaderBookKey(candidate) === canonicalKey,
  );
  if (matches.length === 0) return normalizeBookState(EMPTY_BOOK_STATE);

  const highlights = new Map<string, ReaderHighlight>();
  let locator: ReaderLocator | undefined;
  let locatorProgress = -1;
  let readingTimeMs = 0;
  let lastOpenedAt: number | undefined;
  for (const [, value] of matches) {
    const state = normalizeBookState(value);
    for (const highlight of state.highlights) {
      highlights.set(highlight.id, highlight);
    }
    const progress = state.locator?.locations?.totalProgression ?? -1;
    if (state.locator && progress >= locatorProgress) {
      locator = state.locator;
      locatorProgress = progress;
    }
    readingTimeMs = Math.max(readingTimeMs, state.readingTimeMs);
    if (state.lastOpenedAt != null) {
      lastOpenedAt = Math.max(lastOpenedAt ?? 0, state.lastOpenedAt);
    }
  }
  return normalizeBookState({
    ...(locator ? { locator } : {}),
    highlights: [...highlights.values()],
    readingTimeMs,
    ...(lastOpenedAt == null ? {} : { lastOpenedAt }),
  });
}

async function updateStore(
  update: (current: ReaderStateStore) => ReaderStateStore,
): Promise<void> {
  const operation = readerStateGlobal.__tomeioReaderStateWriteQueue!.then(
    async () => {
      const next = update(await loadStore());
      await AsyncStorage.setItem(READER_STATE_KEY, JSON.stringify(next));
    },
  );
  readerStateGlobal.__tomeioReaderStateWriteQueue = operation.catch(() => {});
  return operation;
}

export async function loadReaderState(bookKey: string): Promise<{
  preferences: ReaderPreferences;
  book: BookReaderState;
}> {
  const store = await loadStore();
  return {
    preferences: { ...DEFAULT_READER_PREFERENCES, ...store.preferences },
    book: bookStateForKey(store, bookKey),
  };
}

export async function loadReaderLocators(
  bookKeys: string[],
): Promise<Map<string, ReaderLocator>> {
  const store = await loadStore();
  const locators = new Map<string, ReaderLocator>();
  for (const bookKey of bookKeys) {
    const locator = bookStateForKey(store, bookKey).locator;
    if (locator) locators.set(bookKey, locator);
  }
  return locators;
}

export async function saveReaderPreferences(
  preferences: ReaderPreferences,
): Promise<void> {
  await updateStore((current) => ({ ...current, preferences }));
}

export async function saveBookReaderState(
  bookKey: string,
  update: Partial<BookReaderState>,
): Promise<void> {
  await updateStore((current) => {
    const canonicalKey = canonicalReaderBookKey(bookKey);
    const books = Object.fromEntries(
      Object.entries(current.books).filter(
        ([candidate]) => canonicalReaderBookKey(candidate) !== canonicalKey,
      ),
    );
    return {
      ...current,
      books: {
        ...books,
        [canonicalKey]: normalizeBookState({
          ...bookStateForKey(current, bookKey),
          ...update,
        }),
      },
    };
  });
}

export function readerProgress(locator?: ReaderLocator): number | undefined {
  const total = locator?.locations?.totalProgression;
  if (typeof total !== 'number' || !Number.isFinite(total)) return undefined;
  return Math.round(Math.max(0, Math.min(1, total)) * 10_000) / 100;
}
