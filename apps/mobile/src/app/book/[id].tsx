import { Feather, Ionicons } from '@expo/vector-icons';
import {
  Button as SwiftUIButton,
  Host as SwiftUIHost,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel as swiftUIAccessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as swiftUIDisabled,
  frame as swiftUIFrame,
  foregroundStyle as swiftUIForegroundStyle,
  glassEffect,
  labelStyle,
  padding as swiftUIPadding,
} from '@expo/ui/swift-ui/modifiers';
import type { BookAcquisition, BookMetadata, BookReview } from '@tomeio/domain';
import type { ExtensionBookReference } from '@tomeio/extension-protocol';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  LibraryActionsSheet,
  ReadBookSheet,
  type LibraryAction,
} from '@/components/library-book-actions';
import { AppErrorDialog } from '@/components/app-error-dialog';
import { AppTextSheet } from '@/components/app-text-sheet';
import { CoverProgress } from '@/components/cover-progress';
import {
  DescriptionText,
  descriptionPlainText,
  normalizeDescription,
} from '@/components/description-text';
import { Rail } from '@/components/poster';
import { SeriesPositionChip } from '@/components/series-position-chip';
import { SkeletonPulse } from '@/components/skeleton-pulse';
import { BookStatusChips, colors, SectionHeader } from '@/components/app-ui';
import { useDownloads, type BookDownloadJob } from '@/context/download-context';
import { useExtensions } from '@/context/extensions-context';
import type {
  AvailableCoverProvider,
  AvailableReviewProvider,
} from '@/context/extensions-context';
import {
  useLibraryActions,
  useLibraryCatalog,
  useLibraryReadingList,
  useLibraryUiStatus,
} from '@/context/library-context';
import { useSettings } from '@/context/settings-context';
import {
  acquisitionActionKind,
  searchAcquisitionCandidatePage,
} from '@/lib/acquisition-options';
import {
  canShowBookInFiles,
  openBookWithAnotherApp,
  showBookInFiles,
} from '@/lib/book-file-actions';
import { bookPriceLabel, bookSourceUrl } from '@/lib/book-offers';
import type { BookCoverPreference, BookCoverSources } from '@/lib/book-cover';
import { bookIdentity } from '@/lib/book-metadata';
import { bookFilename } from '@/lib/download';
import { cachedExtensionResult } from '@/lib/extension-result-cache';
import {
  fromDiscoveryBook,
  fromExtensionBook,
  toExtensionLibraryBook,
  type LibraryBook,
} from '@/lib/library';
import { loadLocalCatalogBook } from '@/lib/library-db';
import { canReadInTomeio } from '@/lib/readium-engine';
import {
  getWorkDetails,
  type DiscoveryBook,
  type FeedBook,
} from '@/lib/openlibrary';

type Phase =
  | { kind: 'idle' }
  | { kind: 'resolving' }
  | { kind: 'downloading'; progress: { bytesWritten: number; totalBytes: number } }
  | { kind: 'done'; uri: string }
  | { kind: 'error'; message: string };

interface AcquisitionOption {
  kind: 'option';
  matchesCurrentBook: boolean;
  key: string;
  extensionId: string;
  providerName: string;
  book: BookMetadata;
  acquisition: BookAcquisition;
}

interface OverviewAction {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  iosIcon: SFSymbol;
  destructive?: boolean;
  onPress: () => void;
}

type AcquisitionEntry = AcquisitionOption;

interface AcquisitionOptionPage {
  items: AcquisitionEntry[];
  nextPage: number | null;
}

interface AuthorFeedBook extends FeedBook {
  extensionId: string;
  metadata: BookMetadata;
}

const IDLE: Phase = { kind: 'idle' };

function normalizeMatchValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function authorMatches(candidate: string, author: string): boolean {
  const normalizedCandidate = normalizeMatchValue(candidate);
  const normalizedAuthor = normalizeMatchValue(author);
  return (
    !!normalizedCandidate &&
    !!normalizedAuthor &&
    (normalizedCandidate === normalizedAuthor ||
      normalizedCandidate.includes(normalizedAuthor) ||
      normalizedAuthor.includes(normalizedCandidate))
  );
}

function toAuthorFeedBook(book: BookMetadata, extensionId: string): AuthorFeedBook {
  return {
    id: `${extensionId}:${book.id}`,
    title: book.title,
    author: book.authors[0] || 'Unknown',
    cover: book.coverUrl || '',
    year: book.publishedYear ?? '',
    description: book.description || '',
    rating: book.rating,
    ratingsCount: book.ratingsCount,
    seriesPosition: book.seriesPosition,
    priceLabel: bookPriceLabel(book),
    sourceUrl: bookSourceUrl(book),
    extensionId,
    metadata: book,
  };
}

function phaseFromJob(job?: BookDownloadJob): Phase | null {
  if (!job) return null;
  if (job.status === 'done') return { kind: 'done', uri: job.uri ?? '' };
  if (job.status === 'error') {
    return { kind: 'error', message: job.error ?? 'Download failed.' };
  }
  return {
    kind: 'downloading',
    progress: { bytesWritten: job.bytesWritten, totalBytes: job.totalBytes },
  };
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function parseParam<T>(json?: string): T | null {
  try {
    return json ? (JSON.parse(json) as T) : null;
  } catch {
    return null;
  }
}

function sameRouteValue(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  const comparable = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return comparable(left) === comparable(right);
}

export default function BookDetailScreen() {
  const router = useRouter();
  const extensions = useExtensions();
  const { acquisitionExtensionId, load: loadExtension } = extensions;
  const { width } = useWindowDimensions();
  const screenInsets = useSafeAreaInsets();
  const compactLayout = width < 700;
  const params = useLocalSearchParams<{
    id: string;
    extensionId?: string;
    extensionBook?: string;
    sourceCover?: string;
    ext?: string;
    local?: string;
    localUri?: string;
    moon?: string;
  }>();
  const { settings } = useSettings();
  const { downloaded } = useLibraryCatalog();
  const { readingList } = useLibraryReadingList();
  const { scanning: libraryScanning } = useLibraryUiStatus();
  const {
    cacheBookCoverSource,
    markAsRead,
    removeLibraryBook,
    removeLocalFile,
    refreshBookCoverSources,
    refreshBookMetadata,
    setBookCoverPreference,
    toggleReadingList,
  } = useLibraryActions();
  const { jobs: downloadJobs, startBookDownload } = useDownloads();

  const extensionBook = useMemo(
    () => parseParam<BookMetadata>(params.extensionBook),
    [params.extensionBook]
  );
  const extensionId = params.extensionId || null;
  const parsedMoonBook = useMemo(
    () => parseParam<LibraryBook>(params.moon),
    [params.moon]
  );
  const moonBook = useMemo(() => {
    if (!parsedMoonBook) return null;
    const liveBook = downloaded.find((book) => book.key === parsedMoonBook.key);
    return liveBook ? { ...parsedMoonBook, ...liveBook } : parsedMoonBook;
  }, [downloaded, parsedMoonBook]);
  const discoveryParam = useMemo(
    () => parseParam<DiscoveryBook>(params.ext),
    [params.ext]
  );
  const discoveryBook = useMemo<DiscoveryBook | null>(() => {
    if (discoveryParam) return discoveryParam;
    if (!moonBook) return null;
    return {
      id: moonBook.discovery?.id ?? moonBook.id,
      title: moonBook.title,
      author: moonBook.author,
      cover: moonBook.cover,
      description: moonBook.description,
      year: String(moonBook.year ?? ''),
      genre: moonBook.genre,
      rating: moonBook.rating,
      ratingsCount: moonBook.ratingsCount,
      seriesPosition: moonBook.seriesPosition,
    };
  }, [discoveryParam, moonBook]);

  const localParam = useMemo(() => parseParam<LibraryBook>(params.local), [params.local]);
  const [persistedLocalBook, setPersistedLocalBook] = useState<LibraryBook | null>(null);
  const [localCatalogResolved, setLocalCatalogResolved] = useState(false);
  const [localCatalogError, setLocalCatalogError] = useState<string | null>(null);
  useEffect(() => {
    if (!localParam && !params.localUri) {
      setPersistedLocalBook(null);
      setLocalCatalogResolved(true);
      setLocalCatalogError(null);
      return;
    }
    if (libraryScanning) return;
    let active = true;
    setPersistedLocalBook(null);
    setLocalCatalogResolved(false);
    setLocalCatalogError(null);
    void loadLocalCatalogBook(
      localParam?.key ?? params.id ?? null,
      localParam?.local?.uri ?? params.localUri ?? null
    )
      .then((book) => {
        if (active) setPersistedLocalBook(book);
      })
      .catch((cause) => {
        if (active) {
          setLocalCatalogError(
            `Local catalog lookup failed: ${cause instanceof Error ? cause.message : String(cause)}`
          );
        }
      })
      .finally(() => {
        if (active) setLocalCatalogResolved(true);
      });
    return () => {
      active = false;
    };
  }, [libraryScanning, localParam, params.id, params.localUri]);

  const localBook = useMemo<LibraryBook | null>(() => {
    if (!localParam && !params.localUri) return null;
    const liveBook = [...downloaded, ...readingList].find(
      (book) =>
        !!book.local &&
        (sameRouteValue(book.key, params.id) ||
          sameRouteValue(book.id, params.id) ||
          sameRouteValue(book.key, localParam?.key) ||
          sameRouteValue(book.local.uri, params.localUri) ||
          sameRouteValue(book.local.uri, localParam?.local?.uri))
    );
    if (!persistedLocalBook) {
      if (liveBook) return liveBook;
      if (localParam && localCatalogResolved && !localCatalogError) {
        return { ...localParam, availableLocally: false };
      }
      return localParam;
    }
    const baseMoonReader =
      persistedLocalBook.moonReader ?? liveBook?.moonReader ?? localParam?.moonReader;
    return {
      ...localParam,
      ...persistedLocalBook,
      ...liveBook,
      availableLocally: true,
      moonReader: baseMoonReader
        ? {
              ...baseMoonReader,
              ...localParam?.moonReader,
              ...persistedLocalBook.moonReader,
              ...liveBook?.moonReader,
              availableLocally: true,
            }
        : undefined,
      cover: liveBook?.cover || persistedLocalBook.cover || localParam?.cover || '',
      description:
        persistedLocalBook.description || liveBook?.description || localParam?.description || '',
      progress: persistedLocalBook.progress ?? liveBook?.progress ?? localParam?.progress,
      isRead: persistedLocalBook.isRead ?? liveBook?.isRead ?? localParam?.isRead,
    };
  }, [
    downloaded,
    localCatalogError,
    localCatalogResolved,
    localParam,
    params.id,
    params.localUri,
    persistedLocalBook,
    readingList,
  ]);

  const localCopyUnavailable =
    !!localBook &&
    (localBook.availableLocally === false ||
      localBook.moonReader?.availableLocally === false);
  const sourceDiscoveryBook =
    discoveryBook ?? (localCopyUnavailable ? localBook?.discovery ?? null : null);
  const acquisitionExtension = useMemo(() => {
    if (extensionBook) {
      return { extensionId, book: extensionBook };
    }
    if (!localCopyUnavailable || !localBook?.extension) return null;

    const { acquisition, book, extensionId: storedExtensionId } = localBook.extension;
    if (
      !acquisition ||
      book.acquisitions?.some((candidate) => candidate.id === acquisition.id)
    ) {
      return { extensionId: storedExtensionId, book };
    }
    return {
      extensionId: storedExtensionId,
      book: {
        ...book,
        acquisitions: [...(book.acquisitions ?? []), acquisition],
      },
    };
  }, [extensionBook, extensionId, localBook, localCopyUnavailable]);

  const [remoteDescription, setRemoteDescription] = useState('');
  const [genreLabel, setGenreLabel] = useState('');
  const [metadataError, setMetadataError] = useState<string | null>(null);
  useEffect(() => {
    if (!sourceDiscoveryBook) return;
    let cancelled = false;
    const suppliedDescription = normalizeDescription(sourceDiscoveryBook.description);
    setRemoteDescription(suppliedDescription);
    setGenreLabel(sourceDiscoveryBook.genre);
    setMetadataError(null);
    if (
      (!suppliedDescription ||
        !sourceDiscoveryBook.genre ||
        sourceDiscoveryBook.genre === 'Open Library') &&
      sourceDiscoveryBook.id.startsWith('/works/')
    ) {
      getWorkDetails(sourceDiscoveryBook.id)
        .then((details) => {
          if (cancelled) return;
          if (details.description) setRemoteDescription(normalizeDescription(details.description));
          if (details.subjects.length) setGenreLabel(details.subjects.slice(0, 3).join(', '));
        })
        .catch((cause) => {
          if (!cancelled) {
            setMetadataError(cause instanceof Error ? cause.message : String(cause));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [sourceDiscoveryBook]);

  const currentDiscovery = useMemo<DiscoveryBook | null>(() => {
    if (!sourceDiscoveryBook) return null;
    return {
      ...sourceDiscoveryBook,
      description: remoteDescription || sourceDiscoveryBook.description,
      genre: genreLabel || sourceDiscoveryBook.genre || 'Other',
    };
  }, [genreLabel, remoteDescription, sourceDiscoveryBook]);

  const relatedAuthor = (
    extensionBook?.authors[0] ??
    currentDiscovery?.author ??
    localBook?.author ??
    ''
  )
    .trim()
    .replace(/[;,]\s*$/, '');
  const relatedTitle =
    extensionBook?.title ?? currentDiscovery?.title ?? localBook?.title ?? '';
  const relatedBookId =
    extensionBook?.id ?? currentDiscovery?.id ?? localBook?.id ?? '';
  const reviewBookReference = useMemo<ExtensionBookReference>(() => {
    const extensionMetadata = extensionBook ?? localBook?.extension?.book;
    const referenceId = extensionMetadata?.id ?? relatedBookId;
    const year =
      extensionMetadata?.publishedYear ??
      (Number(currentDiscovery?.year ?? localBook?.year) || undefined);
    return {
      ...(referenceId ? { id: referenceId } : {}),
      title: relatedTitle,
      authors:
        relatedAuthor && relatedAuthor.toLowerCase() !== 'unknown'
          ? [relatedAuthor]
          : [],
      ...(year != null ? { publishedYear: year } : {}),
      identifiers: extensionMetadata?.identifiers ?? {},
    };
  }, [
    currentDiscovery?.year,
    extensionBook,
    localBook?.extension?.book,
    localBook?.year,
    relatedAuthor,
    relatedBookId,
    relatedTitle,
  ]);
  const reviewProviders = useMemo(
    () => extensions.reviewProviders(),
    [extensions]
  );
  const reviewProvider = reviewProviders[0] ?? null;
  const reviewsGeneration = useRef(0);
  const [reviews, setReviews] = useState<BookReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState<string | null>(null);

  const loadReviews = useCallback(async () => {
    const generation = ++reviewsGeneration.current;
    setReviews([]);
    setReviewsError(null);
    if (
      !reviewProvider ||
      !reviewBookReference.title ||
      (Platform.OS === 'web' && reviewProvider.id === 'community.tomeio.hardcover')
    ) {
      setReviewsLoading(false);
      return;
    }
    setReviewsLoading(true);
    try {
      const result = await extensions.reviews(reviewProvider.id, {
        book: reviewBookReference,
        page: 1,
        limit: 10,
      });
      if (reviewsGeneration.current === generation) setReviews(result.items);
    } catch (cause) {
      if (reviewsGeneration.current === generation) {
        setReviewsError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (reviewsGeneration.current === generation) setReviewsLoading(false);
    }
  }, [extensions, reviewBookReference, reviewProvider]);

  useEffect(() => {
    void loadReviews();
    return () => {
      reviewsGeneration.current += 1;
    };
  }, [loadReviews]);

  const authorBooksGeneration = useRef(0);
  const [authorBooks, setAuthorBooks] = useState<AuthorFeedBook[]>([]);
  const [authorSourceUrl, setAuthorSourceUrl] = useState<string | null>(null);
  const [authorBooksLoading, setAuthorBooksLoading] = useState(false);
  const [authorBooksError, setAuthorBooksError] = useState<string | null>(null);

  const loadAuthorBooks = useCallback(async () => {
    const generation = ++authorBooksGeneration.current;
    setAuthorBooks([]);
    setAuthorSourceUrl(null);
    setAuthorBooksError(null);

    if (!relatedAuthor || relatedAuthor.toLowerCase() === 'unknown') {
      setAuthorBooksLoading(false);
      return;
    }

    setAuthorBooksLoading(true);
    try {
      const providerId = extensions.searchExtensionId;
      if (!providerId) {
        throw new Error('Choose an enabled search provider in Add-ons first.');
      }

      const result = await extensions.search(providerId, {
        query: relatedAuthor,
        page: 1,
        limit: 10,
        language: 'en',
      });
      if (authorBooksGeneration.current !== generation) return;

      const currentTitle = normalizeMatchValue(relatedTitle);
      const currentBook = result.items.find(
        (book) =>
          normalizeMatchValue(book.title) === currentTitle &&
          book.authors.some((candidate) => authorMatches(candidate, relatedAuthor))
      );
      setAuthorSourceUrl(currentBook ? (bookSourceUrl(currentBook) ?? null) : null);
      const seen = new Set<string>();
      const books = result.items
        .filter((book) => book.authors.some((candidate) => authorMatches(candidate, relatedAuthor)))
        .filter((book) => {
          if (book.id === relatedBookId) return false;
          const title = normalizeMatchValue(book.title);
          if (title && title === currentTitle) return false;
          const key = `${title}:${book.publishedYear ?? ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 10)
        .map((book) => toAuthorFeedBook(book, providerId));

      setAuthorBooks(books);
    } catch (cause) {
      if (authorBooksGeneration.current === generation) {
        setAuthorBooksError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (authorBooksGeneration.current === generation) setAuthorBooksLoading(false);
    }
  }, [
    extensions,
    relatedAuthor,
    relatedBookId,
    relatedTitle,
  ]);

  useEffect(() => {
    void loadAuthorBooks();
    return () => {
      authorBooksGeneration.current += 1;
    };
  }, [loadAuthorBooks]);

  const openAuthorBook = useCallback(
    (book: AuthorFeedBook) => {
      router.push({
        pathname: '/book/[id]',
        params: {
          id: book.metadata.id,
          extensionId: book.extensionId,
          extensionBook: JSON.stringify(book.metadata),
          sourceCover: book.cover,
        },
      });
    },
    [router]
  );

  const [options, setOptions] = useState<AcquisitionEntry[] | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsErrorVisible, setOptionsErrorVisible] = useState(false);
  const [nextOptionsPage, setNextOptionsPage] = useState<number | null>(null);
  const [loadingMoreOptions, setLoadingMoreOptions] = useState(false);
  const [removalRequested, setRemovalRequested] = useState(false);
  const optionsGeneration = useRef(0);
  const acquisitionExtensionBook = acquisitionExtension?.book ?? null;
  const acquisitionSourceExtensionId = acquisitionExtension?.extensionId ?? null;
  const missingReadingListBook =
    localCopyUnavailable &&
    localBook &&
    readingList.some(
      (book) =>
        bookIdentity(book.title, book.author) ===
        bookIdentity(localBook.title, localBook.author),
    )
      ? localBook
      : null;
  const lookupTitle =
    acquisitionExtensionBook?.title ??
    currentDiscovery?.title ??
    missingReadingListBook?.title ??
    '';
  const lookupAuthor =
    acquisitionExtensionBook?.authors[0] ??
    currentDiscovery?.author ??
    missingReadingListBook?.author ??
    '';
  const hasAcquisitionLookup =
    !removalRequested &&
    (!!acquisitionExtensionBook || !!currentDiscovery || !!missingReadingListBook);
  const acquisitionProviderVersion = acquisitionExtensionId
    ? [
        ...extensions.thirdParty.map((extension) => extension.manifest),
        ...extensions.bundled,
      ].find((manifest) => manifest.id === acquisitionExtensionId)?.version ?? ''
    : '';
  const acquisitionOptionsRequestKey = hasAcquisitionLookup
    ? JSON.stringify({
        extensionId: acquisitionExtensionId,
        extensionVersion: acquisitionProviderVersion,
        sourceExtensionId: acquisitionSourceExtensionId,
        bookId:
          acquisitionExtensionBook?.id ??
          currentDiscovery?.id ??
          missingReadingListBook?.id,
        title: lookupTitle,
        author: lookupAuthor,
        publishedYear:
          acquisitionExtensionBook?.publishedYear ??
          (currentDiscovery?.year
            ? Number(currentDiscovery.year) || undefined
            : undefined),
        identifiers: Object.entries(
          acquisitionExtensionBook?.identifiers ?? {},
        ).sort(([left], [right]) => left.localeCompare(right)),
        acquisitions: acquisitionExtensionBook?.acquisitions?.map(
          (acquisition) => acquisition.id,
        ),
      })
    : null;

  const loadAcquisitions = useCallback(
    async (extensionId: string, bookId: string) => {
      const provider = await loadExtension(extensionId);
      if (!provider.acquisition) {
        throw new Error(`${provider.manifest.name} does not provide downloads.`);
      }
      const acquisitions = await cachedExtensionResult(
        `acquisition:${extensionId}@${provider.manifest.version}:${bookId}`,
        () => provider.acquisition!(bookId)
      );
      return { acquisitions, provider };
    },
    [loadExtension]
  );

  const loadOptionsPage = useCallback(
    async (page: number): Promise<AcquisitionOptionPage> => {
      if (!acquisitionExtensionId) return { items: [], nextPage: null };
      const provider = await loadExtension(acquisitionExtensionId);
      if (!provider.acquisition) {
        throw new Error(`${provider.manifest.name} does not provide acquisition options.`);
      }
      const acquisitionsFor = async (book: BookMetadata): Promise<BookAcquisition[]> =>
        book.acquisitions?.length
          ? book.acquisitions
          : cachedExtensionResult(
              `acquisition:${acquisitionExtensionId}@${provider.manifest.version}:${book.id}`,
              () => provider.acquisition!(book.id)
            );
      if (
        acquisitionExtensionBook &&
        acquisitionSourceExtensionId === acquisitionExtensionId
      ) {
        if (page !== 1) return { items: [], nextPage: null };
        const acquisitions = await acquisitionsFor(acquisitionExtensionBook);
        return {
          items: acquisitions.map((acquisition) => ({
            kind: 'option' as const,
            matchesCurrentBook: true,
            key: `${acquisitionExtensionId}:${acquisitionExtensionBook.id}:${acquisition.id}`,
            extensionId: acquisitionExtensionId,
            providerName: provider.manifest.name,
            book: acquisitionExtensionBook,
            acquisition,
          })),
          nextPage: null,
        };
      }
      if (!lookupTitle) return { items: [], nextPage: null };
      if (!provider.resolve && !provider.search) {
        throw new Error(
          `${provider.manifest.name} cannot resolve books from another search provider.`
        );
      }
      const reference = {
        id:
          acquisitionExtensionBook?.id ??
          currentDiscovery?.id ??
          missingReadingListBook?.id,
        title: lookupTitle,
        authors: lookupAuthor ? [lookupAuthor] : [],
        publishedYear:
          acquisitionExtensionBook?.publishedYear ??
          (currentDiscovery?.year
            ? Number(currentDiscovery.year) || undefined
            : undefined),
        identifiers: acquisitionExtensionBook?.identifiers ?? {},
      };
      const resolved = await cachedExtensionResult<{
        items: BookMetadata[];
        nextPage?: number | null;
      }>(
        `acquisition-page:${acquisitionExtensionId}@${provider.manifest.version}:${page}:${JSON.stringify(reference)}`,
        () => provider.resolve
          ? provider.resolve({ book: reference, page, limit: 3 })
          : searchAcquisitionCandidatePage(
              { search: provider.search! },
              `${lookupTitle} ${lookupAuthor}`.trim(),
              page
            )
      );
      const items: AcquisitionEntry[] = [];
      for (const book of resolved.items.slice(0, 3)) {
        const acquisitions = await acquisitionsFor(book);
        items.push(
          ...acquisitions.map((acquisition) => ({
            kind: 'option' as const,
            matchesCurrentBook: false,
            key: `${acquisitionExtensionId}:${book.id}:${acquisition.id}`,
            extensionId: acquisitionExtensionId,
            providerName: provider.manifest.name,
            book,
            acquisition,
          }))
        );
      }
      return {
        items,
        nextPage: resolved.nextPage ?? null,
      };
    },
    [
      acquisitionExtensionId,
      acquisitionExtensionBook,
      acquisitionSourceExtensionId,
      loadExtension,
      lookupAuthor,
      lookupTitle,
      currentDiscovery,
      missingReadingListBook,
    ]
  );
  const loadOptionsPageRef = useRef(loadOptionsPage);
  loadOptionsPageRef.current = loadOptionsPage;

  useEffect(() => {
    if (!acquisitionOptionsRequestKey) {
      optionsGeneration.current += 1;
      setOptions([]);
      setNextOptionsPage(null);
      return;
    }
    let cancelled = false;
    const generation = ++optionsGeneration.current;
    setOptions(null);
    setOptionsError(null);
    setOptionsErrorVisible(false);
    setNextOptionsPage(null);
    setLoadingMoreOptions(false);

    loadOptionsPageRef.current(1)
      .then((loaded) => {
        if (!cancelled && optionsGeneration.current === generation) {
          setOptions(loaded.items);
          setNextOptionsPage(loaded.nextPage);
        }
      })
      .catch((cause) => {
        if (!cancelled && optionsGeneration.current === generation) {
          setOptions([]);
          setOptionsError(cause instanceof Error ? cause.message : String(cause));
          setOptionsErrorVisible(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [acquisitionOptionsRequestKey]);

  const loadMoreOptions = useCallback(async () => {
    if (nextOptionsPage == null || loadingMoreOptions) return;
    const generation = optionsGeneration.current;
    setLoadingMoreOptions(true);
    setOptionsError(null);
    setOptionsErrorVisible(false);
    try {
      const loaded = await loadOptionsPage(nextOptionsPage);
      if (optionsGeneration.current !== generation) return;
      setOptions((current) => {
        const byKey = new Map((current ?? []).map((option) => [option.key, option]));
        for (const option of loaded.items) byKey.set(option.key, option);
        return [...byKey.values()];
      });
      setNextOptionsPage(loaded.nextPage);
    } catch (cause) {
      if (optionsGeneration.current === generation) {
        setOptionsError(cause instanceof Error ? cause.message : String(cause));
        setOptionsErrorVisible(true);
      }
    } finally {
      if (optionsGeneration.current === generation) setLoadingMoreOptions(false);
    }
  }, [loadOptionsPage, loadingMoreOptions, nextOptionsPage]);

  const readingListBook = useMemo<LibraryBook | null>(() => {
    if (extensionBook && extensionId) return fromExtensionBook(extensionId, extensionBook);
    if (moonBook) {
      return currentDiscovery
        ? {
            ...moonBook,
            title: currentDiscovery.title,
            author: currentDiscovery.author,
            cover: currentDiscovery.cover,
            description: currentDiscovery.description,
            discovery: currentDiscovery,
          }
        : moonBook;
    }
    if (localBook) return localBook;
    if (currentDiscovery) return fromDiscoveryBook(currentDiscovery);
    return null;
  }, [currentDiscovery, extensionBook, extensionId, localBook, moonBook]);
  const savedLibraryBook = useMemo(() => {
    if (!readingListBook) return null;
    const identity = bookIdentity(
      readingListBook.title,
      readingListBook.author,
    );
    return (
      readingList.find(
        (book) => bookIdentity(book.title, book.author) === identity,
      ) ?? null
    );
  }, [readingList, readingListBook]);

  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<LibraryAction | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [deleteActionsOpen, setDeleteActionsOpen] = useState(false);
  const [libraryActionsOpen, setLibraryActionsOpen] = useState(false);
  const [readOptionsOpen, setReadOptionsOpen] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [unavailableCoverProviders, setUnavailableCoverProviders] = useState<
    string[]
  >([]);
  const [failedCovers, setFailedCovers] = useState<string[]>([]);
  const [phases, setPhases] = useState<Record<string, Phase>>({});
  const onReadingList = readingListBook
    ? readingList.some(
        (book) =>
          bookIdentity(book.title, book.author) ===
          bookIdentity(readingListBook.title, readingListBook.author),
      )
    : false;

  const toggleSaved = useCallback(async () => {
    if (!readingListBook || libraryBusy) return;
    setLibraryBusy(true);
    setLibraryError(null);
    try {
      await toggleReadingList(readingListBook);
    } catch (cause) {
      setLibraryError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLibraryBusy(false);
    }
  }, [libraryBusy, readingListBook, toggleReadingList]);

  const downloadOption = useCallback(
    async (option: AcquisitionOption) => {
      const { book } = option;
      setPhases((current) => ({ ...current, [option.key]: { kind: 'resolving' } }));
      try {
        let acquisition = option.acquisition;
        if (!acquisition.downloadUrl && !acquisition.openUrl) {
          const { acquisitions: resolved, provider } = await loadAcquisitions(
            option.extensionId,
            book.id
          );
          const matching =
            resolved.find((candidate) => candidate.id === acquisition.id) ??
            resolved.find((candidate) => candidate.format === acquisition.format) ??
            resolved[0];
          if (!matching) {
            throw new Error(`${provider.manifest.name} returned no files for this book.`);
          }
          acquisition = matching;
          setOptions((current) =>
            current?.map((entry) =>
              entry.key === option.key
                ? { ...entry, acquisition: matching }
                : entry
            ) ?? null
          );
        }
        if (!acquisition.downloadUrl) {
          if (acquisition.openUrl) {
            await Linking.openURL(acquisition.openUrl);
            setPhases((current) => {
              const next = { ...current };
              delete next[option.key];
              return next;
            });
            return;
          }
          throw new Error('This acquisition has no downloadable or openable URL.');
        }
        const filename = bookFilename({
          title: book.title,
          authors: book.authors,
          format: acquisition.format,
        });
        setPhases((current) => ({
          ...current,
          [option.key]: { kind: 'downloading', progress: { bytesWritten: 0, totalBytes: 0 } },
        }));
        await startBookDownload({
          requestKey: option.key,
          url: acquisition.downloadUrl,
          filename,
          headers: acquisition.headers ?? {},
          destinationDirectoryUri: settings.localLibraryLocation,
          book: fromExtensionBook(option.extensionId, book, {
            format: acquisition.format,
            size: acquisition.sizeBytes,
            extension: { extensionId: option.extensionId, book, acquisition },
          }),
        });
        setPhases((current) => {
          const next = { ...current };
          delete next[option.key];
          return next;
        });
      } catch (cause) {
        setPhases((current) => ({
          ...current,
          [option.key]: {
            kind: 'error',
            message: cause instanceof Error ? cause.message : String(cause),
          },
        }));
      }
    },
    [loadAcquisitions, settings.localLibraryLocation, startBookDownload]
  );

  const runLibraryAction = useCallback(
    async (action: LibraryAction, operation: () => Promise<void>) => {
      setBusyAction(action);
      setLibraryError(null);
      try {
        await operation();
      } catch (cause) {
        setLibraryError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyAction(null);
      }
    },
    []
  );

  const libraryActionBook = localBook ?? moonBook ?? savedLibraryBook;
  const savedOnly = !!savedLibraryBook && !localBook && !moonBook;
  const coverProviders = useMemo(
    () => extensions.coverProviders(),
    [extensions]
  );
  const acquisitionCoverSource = useMemo(() => {
    if (
      !acquisitionExtensionId ||
      !coverProviders.some((provider) => provider.id === acquisitionExtensionId)
    ) {
      return null;
    }
    const uri = options?.find((entry) => !!entry.book.coverUrl)?.book.coverUrl;
    return uri ? { providerId: acquisitionExtensionId, uri } : null;
  }, [acquisitionExtensionId, coverProviders, options]);
  useEffect(() => {
    if (!libraryActionBook || !acquisitionCoverSource) return;
    if (
      libraryActionBook.coverSources?.providers?.[
        acquisitionCoverSource.providerId
      ] === acquisitionCoverSource.uri
    ) {
      return;
    }
    void cacheBookCoverSource(
      libraryActionBook,
      acquisitionCoverSource.providerId,
      acquisitionCoverSource.uri
    ).catch((cause) => {
      console.info(
        `Could not cache ${acquisitionCoverSource.providerId} cover:`,
        cause instanceof Error ? cause.message : String(cause)
      );
    });
  }, [acquisitionCoverSource, cacheBookCoverSource, libraryActionBook]);
  const chooseCover = useCallback(
    async (preference: BookCoverPreference) => {
      if (!libraryActionBook || coverBusy) return;
      setCoverBusy(true);
      setLibraryError(null);
      try {
        await setBookCoverPreference(libraryActionBook, preference);
        setFailedCovers([]);
        setCoverPickerOpen(false);
      } catch (cause) {
        setLibraryError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setCoverBusy(false);
      }
    },
    [coverBusy, libraryActionBook, setBookCoverPreference]
  );
  const loadCoverSources = useCallback(async (force = false) => {
    if (!libraryActionBook || coverBusy) return;
    setCoverBusy(true);
    setLibraryError(null);
    try {
      setUnavailableCoverProviders(
        await refreshBookCoverSources(libraryActionBook, force)
      );
      setFailedCovers([]);
    } catch (cause) {
      setLibraryError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCoverBusy(false);
    }
  }, [coverBusy, libraryActionBook, refreshBookCoverSources]);
  const openCoverPicker = useCallback(() => {
    setCoverPickerOpen(true);
    void loadCoverSources();
  }, [loadCoverSources]);
  const addonActions = useMemo(() => {
    if (!libraryActionBook) return [];
    const book = toExtensionLibraryBook(libraryActionBook);
    const platform =
      Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web'
        ? Platform.OS
        : 'desktop';
    return extensions.libraryActions(book, 'details', platform).map((action) => ({
      key: `addon:${action.extensionId}:${action.id}` as const,
      label: action.title,
      icon: (action.icon && action.icon in Feather.glyphMap
        ? action.icon
        : 'external-link') as 'external-link',
      onPress: () =>
        void runLibraryAction(`addon:${action.extensionId}:${action.id}`, () =>
          extensions.runLibraryAction(action.extensionId, action.id, book)
        ),
    }));
  }, [extensions, libraryActionBook, runLibraryAction]);
  const readerAddonActions = useMemo(
    () =>
      addonActions.filter(
        (action) =>
          action.key.startsWith('addon:community.tomeio.moon-reader:') ||
          action.key.startsWith('addon:community.tomeio.google-books:')
      ),
    [addonActions]
  );
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

  if (!extensionBook && !currentDiscovery && !localBook) {
    return (
      <View
        className="flex-1 items-center justify-center gap-3"
        style={{ backgroundColor: colors.background }}
      >
        <Text className="text-sm" style={{ color: colors.textMuted }}>
          Book details unavailable.
        </Text>
        <Pressable onPress={goBack}>
          <Text className="text-sm font-semibold" style={{ color: colors.accent }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const title =
    libraryActionBook?.title ||
    extensionBook?.title ||
    currentDiscovery?.title ||
    localBook?.title ||
    'Untitled';
  const author =
    libraryActionBook?.author ||
    extensionBook?.authors[0] ||
    currentDiscovery?.author ||
    localBook?.author ||
    'Unknown';
  const coverCandidates = [
    libraryActionBook?.cover,
    libraryActionBook?.fallbackCover,
    params.sourceCover,
    localBook?.cover,
    localBook?.fallbackCover,
    extensionBook?.coverUrl,
    currentDiscovery?.cover,
  ].filter(
    (cover, index, covers): cover is string => !!cover && covers.indexOf(cover) === index
  );
  const description = libraryActionBook?.description
    ? normalizeDescription(libraryActionBook.description)
    : extensionBook?.description
      ? normalizeDescription(extensionBook.description)
      : currentDiscovery?.description
        ? normalizeDescription(currentDiscovery.description)
        : localBook?.description
          ? normalizeDescription(localBook.description)
          : '';
  const rating =
    libraryActionBook?.rating ??
    extensionBook?.rating ??
    currentDiscovery?.rating ??
    localBook?.rating;
  const seriesPosition =
    libraryActionBook?.seriesPosition ??
    extensionBook?.seriesPosition ??
    currentDiscovery?.seriesPosition ??
    localBook?.seriesPosition;
  const trackedBook = libraryActionBook ?? localBook ?? moonBook;
  const progress = trackedBook?.isRead ? 100 : trackedBook?.progress;
  const actionFileUri =
    libraryActionBook?.local?.uri ?? libraryActionBook?.fileUri ?? params.localUri;
  const localFileAvailable =
    !!actionFileUri &&
    libraryActionBook?.availableLocally !== false &&
    libraryActionBook?.moonReader?.availableLocally !== false;
  const openableLibraryBook = libraryActionBook && localFileAvailable
    ? {
        ...libraryActionBook,
        fileUri: libraryActionBook.fileUri ?? actionFileUri,
        availableLocally: true,
        moonReader: libraryActionBook.moonReader
          ? { ...libraryActionBook.moonReader, availableLocally: true }
          : undefined,
      }
    : libraryActionBook;
  const hasOpenAction =
    Platform.OS !== 'web' && !!openableLibraryBook && localFileAvailable;
  const opensInTomeio = !!openableLibraryBook && canReadInTomeio(openableLibraryBook);
  const openInTomeio = () => {
    if (!openableLibraryBook || !canReadInTomeio(openableLibraryBook)) return;
    setReadOptionsOpen(false);
    router.push({
      pathname: '/read/[id]',
      params: {
        id: openableLibraryBook.key,
        book: JSON.stringify(openableLibraryBook),
      },
    } as any);
  };
  const openReadOptions = () => {
    if (Platform.OS === 'ios' && opensInTomeio) {
      openInTomeio();
      return;
    }
    setReadOptionsOpen(true);
  };
  const viewUrl = !localFileAvailable
    ? (extensionBook ? bookSourceUrl(extensionBook) : undefined) ??
      (libraryActionBook?.extension?.book
        ? bookSourceUrl(libraryActionBook.extension.book)
        : undefined) ??
      libraryActionBook?.sourceUrl ??
      libraryActionBook?.discovery?.sourceUrl ??
      currentDiscovery?.sourceUrl ??
      authorSourceUrl
    : undefined;
  const externalAcquisitionsOnly =
    !!options?.length &&
    options.every(
      (entry) => acquisitionActionKind(entry.acquisition) === 'open'
    );
  const bottomPadding = Math.max(48, screenInsets.bottom + 24);
  const meta = [
    ...(libraryActionBook
      ? libraryActionBook.local || libraryActionBook.fileUri
        ? [
            libraryActionBook.format?.toUpperCase(),
            formatSize(libraryActionBook.size),
            libraryActionBook.year,
          ]
        : [
            libraryActionBook.genre !== 'Other'
              ? libraryActionBook.genre
              : undefined,
            libraryActionBook.year,
          ]
      : extensionBook
        ? [extensionBook.publishedYear, extensionBook.subjects.slice(0, 2).join(', ')]
        : currentDiscovery
          ? [genreLabel || currentDiscovery.genre, currentDiscovery.year]
          : [localBook?.format?.toUpperCase(), formatSize(localBook?.size), localBook?.year]),
    ...(libraryActionBook ? [localFileAvailable ? 'Local file' : 'Not downloaded'] : []),
  ].filter(Boolean);
  const activeCover = coverCandidates.find((cover) => !failedCovers.includes(cover)) ?? null;
  const mobileOverview = Platform.OS === 'ios' || Platform.OS === 'android';
  const baseHeroHeight = mobileOverview
    ? Math.min(600, Math.max(530, Math.round(width * 1.3)))
    : compactLayout
      ? Math.min(620, Math.max(480, Math.round(width * 1.24)))
      : 420;
  const titleLineCapacity = Math.max(
    18,
    Math.floor((width - 40) / (compactLayout ? 15 : 17))
  );
  const estimatedTitleLines = Math.min(
    3,
    Math.max(1, Math.ceil(title.length / titleLineCapacity))
  );
  const showInlineProgress = !mobileOverview || !activeCover;
  const heroHeight =
    baseHeroHeight +
    (mobileOverview ? (estimatedTitleLines - 1) * 32 : 0) +
    (mobileOverview && showInlineProgress && (progress != null || trackedBook?.isRead) ? 48 : 0);
  const foregroundCoverWidth = Math.min(220, Math.max(168, Math.round(width * 0.48)));
  const foregroundCoverHeight = Math.round(foregroundCoverWidth * 1.5);
  const foregroundCoverTop = screenInsets.top + 78;
  const acquisitionCardWidth = Math.min(420, width - 48);

  const descriptionPreview = description ? (
    <Pressable
      onPress={() => setDescriptionOpen(true)}
      className="mt-5 overflow-hidden"
      accessibilityRole="button"
      accessibilityLabel={`Read the full description of ${title}`}
    >
      <DescriptionText
        value={description}
        numberOfLines={4}
        className="text-sm leading-5"
        style={{ color: colors.text, textAlign: 'center' }}
      />
    </Pressable>
  ) : null;
  const overviewActions: OverviewAction[] = libraryActionBook
    ? [
        ...(canShowBookInFiles(libraryActionBook)
          ? [
              {
                key: 'files',
                label: 'Files',
                icon: 'folder' as const,
                iosIcon: 'folder' as const,
                onPress: () =>
                  void runLibraryAction('files', () =>
                    showBookInFiles(libraryActionBook, settings.localLibraryLocation)
                  ),
              },
            ]
          : []),
        {
          key: 'cover',
          label: 'Cover',
          icon: 'image' as const,
          iosIcon: 'photo' as const,
          onPress: openCoverPicker,
        },
        ...addonActions.map((action) => ({
          key: action.key,
          label: action.label,
          icon: action.icon,
          iosIcon: 'puzzlepiece.extension' as const,
          onPress: action.onPress,
        })),
        ...(!savedOnly
          ? [{
              key: 'read',
              label: libraryActionBook.isRead ? 'Finished' : 'Finish',
              icon: 'check-circle' as const,
              iosIcon: 'checkmark.circle' as const,
              onPress: () =>
                void runLibraryAction('read', () =>
                  markAsRead(libraryActionBook)
                ),
            } satisfies OverviewAction]
          : []),
        {
          key: 'metadata',
          label: 'Refresh',
          icon: 'refresh-cw' as const,
          iosIcon: 'arrow.clockwise' as const,
          onPress: () =>
            void runLibraryAction('metadata', () =>
              refreshBookMetadata(libraryActionBook)
            ),
        },
        ...(!savedOnly
          ? [{
              key: 'delete-options',
              label: 'Remove',
              icon: 'trash-2' as const,
              iosIcon: 'trash' as const,
              destructive: true,
              onPress: () => setDeleteActionsOpen(true),
            } satisfies OverviewAction]
          : []),
      ]
    : [];

  return (
    <>
      <Stack.Screen
        options={
          Platform.OS === 'ios'
            ? {
                headerShown: true,
                headerTransparent: true,
                headerTitle: '',
                headerShadowVisible: false,
                headerBackVisible: false,
                scrollEdgeEffects: {
                  top: 'hidden',
                  bottom: 'hidden',
                },
              }
            : { headerShown: false }
        }
      />
      {Platform.OS === 'ios' ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button
              icon="chevron.left"
              accessibilityLabel="Back"
              separateBackground
              onPress={goBack}
            />
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            {libraryActionBook ? (
              <Stack.Toolbar.Menu
                icon="ellipsis"
                accessibilityLabel="Book actions"
                separateBackground
              >
                {overviewActions
                  .filter((action) => action.key !== 'files')
                  .map((action) => (
                    <Stack.Toolbar.MenuAction
                      key={action.key}
                      icon={action.iosIcon}
                      destructive={action.destructive}
                      disabled={
                        !!busyAction ||
                        (action.key === 'read' && libraryActionBook.isRead === true)
                      }
                      isOn={action.key === 'read' && libraryActionBook.isRead === true}
                      onPress={action.onPress}
                    >
                      {action.label}
                    </Stack.Toolbar.MenuAction>
                  ))}
              </Stack.Toolbar.Menu>
            ) : rating != null ? (
              <Stack.Toolbar.View hidesSharedBackground>
                <HeaderStarRating rating={rating} />
              </Stack.Toolbar.View>
            ) : null}
          </Stack.Toolbar>
          {rating != null && libraryActionBook ? (
            <Stack.Title asChild>
              <HeaderStarRating rating={rating} />
            </Stack.Title>
          ) : null}
        </>
      ) : null}

      <ScrollView
        className="flex-1"
        style={{ backgroundColor: colors.background }}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPadding }}
      >
        <View className="relative overflow-hidden" style={{ height: heroHeight }}>
          {activeCover ? (
            <>
              <Image
                source={{ uri: activeCover }}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                contentFit="cover"
                contentPosition="center"
                blurRadius={Platform.OS === 'android' ? 12 : mobileOverview ? 18 : 0}
                cachePolicy="memory-disk"
                onError={() =>
                  setFailedCovers((current) =>
                    current.includes(activeCover) ? current : [...current, activeCover]
                  )
                }
              />
              {mobileOverview ? (
                <>
                  <View
                    pointerEvents="none"
                    className="absolute inset-0"
                    style={{ backgroundColor: 'rgba(5, 4, 3, 0.34)' }}
                  />
                  <View
                    style={{
                      position: 'absolute',
                      top: foregroundCoverTop,
                      alignSelf: 'center',
                      width: foregroundCoverWidth,
                      height: foregroundCoverHeight,
                      borderRadius: 16,
                      shadowColor: '#000000',
                      shadowOffset: { width: 0, height: 12 },
                      shadowOpacity: 0.34,
                      shadowRadius: 20,
                      zIndex: 2,
                    }}
                  >
                    <View
                      style={{
                        width: '100%',
                        height: '100%',
                        overflow: 'hidden',
                        borderRadius: 16,
                      }}
                    >
                      <Image
                        source={{ uri: activeCover }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                      <SeriesPositionChip position={seriesPosition} />
                      <CoverProgress progress={progress} isRead={trackedBook?.isRead} />
                    </View>
                  </View>
                </>
              ) : null}
            </>
          ) : (
            <View
              className="absolute inset-0 items-center justify-center"
              style={{ backgroundColor: colors.surfaceRaised }}
            >
              <Text className="text-5xl">📚</Text>
            </View>
          )}
          <View
            pointerEvents="none"
            className="absolute right-0 bottom-0 left-0"
            style={{
              height: mobileOverview ? '68%' : '54%',
              experimental_backgroundImage: `linear-gradient(to bottom, rgba(16, 11, 8, 0) 0%, rgba(16, 11, 8, ${mobileOverview ? '0.62' : '0.68'}) 55%, ${colors.background} 100%)`,
            }}
          />
          <View
            className="absolute right-0 bottom-0 left-0 px-5 pb-2"
            style={mobileOverview ? { alignItems: 'center', zIndex: 3 } : undefined}
          >
            <Text
              numberOfLines={3}
              className={`${compactLayout ? 'text-[28px] leading-8' : 'text-3xl leading-9'} font-semibold`}
              style={{
                color: colors.text,
                textAlign: mobileOverview ? 'center' : 'left',
                textShadowColor: 'rgba(0,0,0,0.55)',
                textShadowRadius: 8,
              }}
            >
              {title}
            </Text>
            <Text
              className="mt-2 text-[15px]"
              style={{ color: colors.text, textAlign: mobileOverview ? 'center' : 'left' }}
            >
              {author}
            </Text>
            {!mobileOverview && rating != null ? <StarRating rating={rating} /> : null}
            {meta.length ? (
              <Text
                className="mt-2 text-xs uppercase tracking-wide"
                style={{
                  color: colors.textMuted,
                  textAlign: mobileOverview ? 'center' : 'left',
                }}
              >
                {meta.join(' · ')}
              </Text>
            ) : null}
            {showInlineProgress ? (
              <BookStatusChips progress={progress} isRead={trackedBook?.isRead} />
            ) : null}
          </View>
        </View>

        <View className="px-5">
          {Platform.OS === 'ios' &&
          (hasOpenAction || readingListBook || viewUrl) ? (
            <View className="mt-2 flex-row items-center justify-center gap-3">
              {hasOpenAction && openableLibraryBook ? (
                <IosGlassActionButton
                  label="Read"
                  systemImage="book.fill"
                  onPress={openReadOptions}
                  disabled={!!busyAction}
                />
              ) : null}
              {readingListBook ? (
                <IosGlassActionButton
                  label={onReadingList ? 'Saved' : 'Save'}
                  systemImage={onReadingList ? 'bookmark.fill' : 'bookmark'}
                  onPress={() => void toggleSaved()}
                  disabled={libraryBusy}
                />
              ) : null}
              {viewUrl ? (
                <IosGlassActionButton
                  label="View"
                  systemImage="arrow.up.right.square"
                  onPress={() => void Linking.openURL(viewUrl)}
                />
              ) : null}
            </View>
          ) : Platform.OS !== 'ios' &&
            (hasOpenAction || readingListBook || viewUrl) ? (
            <View className="mt-2 flex-row items-center justify-center gap-3">
              {hasOpenAction && openableLibraryBook ? (
                <Pressable
                  onPress={openReadOptions}
                  disabled={!!busyAction}
                  accessibilityRole="button"
                  accessibilityLabel="Read book"
                  className="h-[52px] flex-row items-center justify-center gap-2 rounded-full border px-6 active:opacity-80 disabled:opacity-50"
                  style={{ borderColor: colors.border, backgroundColor: colors.surface }}
                >
                  <Feather name="book-open" size={17} color={colors.text} />
                  <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                    Read
                  </Text>
                </Pressable>
              ) : null}
              {readingListBook ? (
                <Pressable
                  onPress={() => void toggleSaved()}
                  disabled={libraryBusy}
                  accessibilityRole="button"
                  accessibilityLabel={
                    onReadingList ? 'Remove from saved' : 'Save book'
                  }
                  className="h-[52px] flex-row items-center justify-center gap-2 rounded-full border px-6 active:opacity-80 disabled:opacity-50"
                  style={{
                    borderColor: onReadingList ? colors.accent : colors.border,
                    backgroundColor: onReadingList
                      ? colors.accentMuted
                      : colors.surface,
                  }}
                >
                  {libraryBusy ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Feather
                      name="bookmark"
                      size={17}
                      color={onReadingList ? colors.accent : colors.text}
                    />
                  )}
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: onReadingList ? colors.accent : colors.text }}
                  >
                    {onReadingList ? 'Saved' : 'Save'}
                  </Text>
                </Pressable>
              ) : null}
              {viewUrl ? (
                <Pressable
                  onPress={() => void Linking.openURL(viewUrl)}
                  accessibilityRole="link"
                  accessibilityLabel="View at source"
                  className="h-[52px] flex-row items-center justify-center gap-2 rounded-full border px-6 active:opacity-80"
                  style={{ borderColor: colors.border, backgroundColor: colors.surface }}
                >
                  <Feather name="external-link" size={17} color={colors.text} />
                  <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                    View
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {descriptionPreview}
          {Platform.OS !== 'ios' && Platform.OS !== 'android' && overviewActions.length ? (
            <View
              className="mt-5 overflow-hidden rounded-2xl border"
              style={{ borderColor: colors.border, backgroundColor: colors.surface }}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ padding: 8, gap: 4 }}
              >
                {overviewActions.map((action) => {
                  const actionBusy = busyAction === action.key;
                  const actionColor = action.destructive ? colors.danger : colors.text;
                  return (
                    <Pressable
                      key={action.key}
                      onPress={action.onPress}
                      disabled={
                        !!busyAction ||
                        (action.key === 'read' && libraryActionBook?.isRead === true)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={action.label}
                      className="h-14 min-w-[72px] items-center justify-center gap-1 rounded-xl px-3 active:opacity-70 disabled:opacity-40"
                      style={{
                        backgroundColor: actionBusy
                          ? colors.accentMuted
                          : 'transparent',
                      }}
                    >
                      {actionBusy ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                      ) : (
                        <Feather name={action.icon} size={18} color={actionColor} />
                      )}
                      <Text
                        numberOfLines={1}
                        className="text-[10px] font-semibold"
                        style={{ color: actionColor }}
                      >
                        {action.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>

        {metadataError || libraryError || localCatalogError ? (
          <View className="px-6 mt-3 gap-1">
            {metadataError ? <Text className="text-xs" style={{ color: colors.danger }}>{metadataError}</Text> : null}
            {libraryError ? <Text className="text-xs" style={{ color: colors.danger }}>{libraryError}</Text> : null}
            {localCatalogError ? <Text className="text-xs" style={{ color: colors.danger }}>{localCatalogError}</Text> : null}
          </View>
        ) : null}

        {hasAcquisitionLookup ? (
          <View className="mt-8">
            <SectionHeader
              title={externalAcquisitionsOnly ? 'Open in browser' : 'Download options'}
            />
            <View>
              {options === null && !optionsError ? (
                <AcquisitionRowsSkeleton width={acquisitionCardWidth} />
              ) : null}
              {optionsError ? (
                <Pressable
                  onPress={() => setOptionsErrorVisible(true)}
                  className="mx-5 rounded-xl border px-4 py-3 active:opacity-75"
                  style={{
                    borderColor: colors.danger,
                    backgroundColor: colors.surface,
                  }}
                >
                  <Text className="text-sm font-semibold" style={{ color: colors.danger }}>
                    Provider unavailable · Show details
                  </Text>
                </Pressable>
              ) : null}
              {options?.length === 0 && !optionsError ? (
                <Text className="px-5 text-sm" style={{ color: colors.textMuted }}>
                  No acquisitions were returned by the selected provider.
                </Text>
              ) : null}
              {options?.length || nextOptionsPage != null ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  snapToInterval={acquisitionCardWidth + 12}
                  snapToAlignment="start"
                  decelerationRate="fast"
                  disableIntervalMomentum
                  contentContainerStyle={{ paddingHorizontal: 20, gap: 12, alignItems: 'flex-start' }}
                >
                  {options?.map((entry) => {
                    const phase =
                      phaseFromJob(downloadJobs[entry.key]) ??
                      phases[entry.key] ??
                      IDLE;
                    return (
                      <AcquisitionRow
                        key={entry.key}
                        entry={entry}
                        phase={phase}
                        width={acquisitionCardWidth}
                        onAction={() => void downloadOption(entry)}
                      />
                    );
                  })}
                  {nextOptionsPage != null ? (
                    <Pressable
                      onPress={() => void loadMoreOptions()}
                      disabled={loadingMoreOptions}
                      accessibilityRole="button"
                      accessibilityLabel="Find more download options"
                      className="border items-center justify-center gap-3 disabled:opacity-50"
                      style={{
                        width: Math.min(180, acquisitionCardWidth),
                        minHeight: 162,
                        borderColor: colors.border,
                        backgroundColor: colors.surface,
                        borderRadius: Platform.OS === 'ios' ? 38 : 24,
                      }}
                    >
                      {loadingMoreOptions ? (
                        <ActivityIndicator color={colors.accent} />
                      ) : (
                        <>
                          <Feather name="search" size={26} color={colors.textMuted} />
                          <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                            Find more options
                          </Text>
                        </>
                      )}
                    </Pressable>
                  ) : null}
                </ScrollView>
              ) : null}
            </View>
          </View>
        ) : null}

        {reviewProvider && (reviewsLoading || !!reviewsError || reviews.length > 0) ? (
          <BookReviewsRail
            provider={reviewProvider}
            reviews={reviews}
            loading={reviewsLoading}
            error={reviewsError}
            onRetry={() => void loadReviews()}
          />
        ) : null}

        {relatedAuthor && relatedAuthor.toLowerCase() !== 'unknown' ? (
          <View className="mt-8">
            <Rail
              title={`More from ${relatedAuthor}`}
              books={authorBooks}
              loading={authorBooksLoading}
              error={authorBooksError}
              onPressBook={openAuthorBook}
              onRetry={() => void loadAuthorBooks()}
              emptyLabel={`No other books by ${relatedAuthor} found.`}
            />
          </View>
        ) : null}

      </ScrollView>

      {Platform.OS !== 'ios' ? (
        <View
          pointerEvents="box-none"
          className="absolute left-4 right-4 z-30 flex-row items-center"
          style={{ top: screenInsets.top + 14 }}
        >
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: 'rgba(10, 10, 14, 0.78)' }}
          >
            <Feather name="chevron-left" color={colors.text} size={23} />
          </Pressable>
          {libraryActionBook && rating != null ? (
            <View
              className="absolute left-1/2 flex-row items-center rounded-full border px-3 py-2"
              style={{
                transform: [{ translateX: -58 }],
                borderColor: 'rgba(255,255,255,0.18)',
                backgroundColor: 'rgba(10, 10, 14, 0.72)',
              }}
            >
              <StarRating rating={rating} compact />
            </View>
          ) : null}
          <View className="flex-1" />
          {libraryActionBook ? (
            <Pressable
              onPress={() => setLibraryActionsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Book actions"
              className="h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: 'rgba(10, 10, 14, 0.78)' }}
            >
              <Feather name="more-horizontal" color={colors.text} size={23} />
            </Pressable>
          ) : rating != null ? (
            <View
              className="flex-row items-center rounded-full border px-3 py-2"
              style={{
                borderColor: 'rgba(255,255,255,0.18)',
                backgroundColor: 'rgba(10, 10, 14, 0.72)',
              }}
            >
              <StarRating rating={rating} compact />
            </View>
          ) : null}
        </View>
      ) : null}

      {Platform.OS === 'android' && libraryActionBook ? (
        <LibraryActionsSheet
          book={openableLibraryBook ?? libraryActionBook}
          visible={libraryActionsOpen}
          busyAction={busyAction}
          addonActions={addonActions}
          onClose={() => setLibraryActionsOpen(false)}
          onOpenWith={() => {
            setLibraryActionsOpen(false);
            if (openableLibraryBook) {
              void runLibraryAction('openWith', () =>
                openBookWithAnotherApp(openableLibraryBook)
              );
            }
          }}
          onShowInFiles={() => {
            setLibraryActionsOpen(false);
            void runLibraryAction('files', () =>
              showBookInFiles(libraryActionBook, settings.localLibraryLocation)
            );
          }}
          onCover={() => {
            setLibraryActionsOpen(false);
            openCoverPicker();
          }}
          onDelete={() => {
            setLibraryActionsOpen(false);
            setDeleteActionsOpen(true);
          }}
          onRemove={() => {
            setLibraryActionsOpen(false);
            setDeleteActionsOpen(true);
          }}
          onMarkRead={savedOnly
            ? undefined
            : () => {
                setLibraryActionsOpen(false);
                void runLibraryAction('read', () =>
                  markAsRead(libraryActionBook)
                );
              }}
          onRefreshMetadata={() => {
            setLibraryActionsOpen(false);
            void runLibraryAction('metadata', () => refreshBookMetadata(libraryActionBook));
          }}
        />
      ) : null}

      {hasOpenAction && openableLibraryBook ? (
        <ReadBookSheet
          book={openableLibraryBook}
          visible={readOptionsOpen}
          onReadInTomeio={opensInTomeio ? openInTomeio : undefined}
          readerActions={readerAddonActions.map((action) => ({
            ...action,
            label: action.label.replace(/^Open in /, 'Read in '),
            onPress: () => {
              setReadOptionsOpen(false);
              action.onPress();
            },
          }))}
          onClose={() => setReadOptionsOpen(false)}
          onOpenWith={() => {
            setReadOptionsOpen(false);
            void runLibraryAction('openWith', () =>
              openBookWithAnotherApp(openableLibraryBook)
            );
          }}
        />
      ) : null}

      {libraryActionBook ? (
        <BookDeleteSheet
          visible={deleteActionsOpen}
          book={libraryActionBook}
          canRemoveLocalFile={
            localFileAvailable && !!libraryActionBook.local?.uri
          }
          onClose={() => setDeleteActionsOpen(false)}
          onRemoveLocalFile={() => {
            setDeleteActionsOpen(false);
            Alert.alert(
              'Remove local file?',
              `The file for “${libraryActionBook.title}” will be deleted, but its library and sync record will be kept.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () =>
                    void runLibraryAction('delete', async () => {
                      await removeLocalFile(libraryActionBook);
                    }),
                },
              ]
            );
          }}
          onRemoveFromTomeio={() => {
            setDeleteActionsOpen(false);
            const localRecord = !!(
              libraryActionBook.local?.uri ?? libraryActionBook.fileUri
            );
            const fileAvailable =
              localRecord && libraryActionBook.availableLocally !== false;
            Alert.alert(
              localRecord ? 'Remove from Tomeio?' : 'Remove synced book?',
              localRecord
                ? fileAvailable
                  ? `Permanently delete “${libraryActionBook.title}” and remove it from Tomeio?`
                  : `Remove “${libraryActionBook.title}” from your library? The missing file will not be deleted again.`
                : `Remove “${libraryActionBook.title}” from Tomeio on every synced device? Newer Moon+ Reader activity can add it again.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => {
                    let removed = false;
                    setRemovalRequested(true);
                    void runLibraryAction('remove', async () => {
                      await removeLibraryBook(libraryActionBook);
                      removed = true;
                      router.replace('/library');
                    }).finally(() => {
                      if (!removed) setRemovalRequested(false);
                    });
                  },
                },
              ]
            );
          }}
        />
      ) : null}

      <CoverPicker
        visible={coverPickerOpen}
        title={title}
        sources={libraryActionBook?.coverSources}
        providers={coverProviders}
        unavailableProviders={unavailableCoverProviders}
        preference={libraryActionBook?.coverPreference ?? 'auto'}
        busy={coverBusy}
        onClose={() => setCoverPickerOpen(false)}
        onChoose={(preference) => void chooseCover(preference)}
        onRefresh={() => void loadCoverSources(true)}
      />

      <AppErrorDialog
        title="Download options unavailable"
        message={optionsErrorVisible ? optionsError : null}
        onClose={() => setOptionsErrorVisible(false)}
      />

      <AppTextSheet
        visible={descriptionOpen}
        title={title}
        text={descriptionPlainText(description)}
        onClose={() => setDescriptionOpen(false)}
      />
    </>
  );
}

function reviewDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function BookReviewsRail({
  provider,
  reviews,
  loading,
  error,
  onRetry,
}: {
  provider: AvailableReviewProvider;
  reviews: BookReview[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(340, width - 48);
  const cardGap = 12;
  const [selectedReview, setSelectedReview] = useState<BookReview | null>(null);

  return (
    <View className="mt-8">
      <SectionHeader title={`Reviews from ${provider.name}`} />
      {loading ? (
        <ReviewCardsSkeleton width={cardWidth} gap={cardGap} />
      ) : null}
      {error ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          className="mx-5 rounded-2xl border px-4 py-4 active:opacity-75"
          style={{ borderColor: colors.danger, backgroundColor: colors.surface }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.danger }}>
            {provider.name} reviews unavailable · Retry
          </Text>
          <Text numberOfLines={3} className="mt-2 text-xs leading-5" style={{ color: colors.textMuted }}>
            {error}
          </Text>
        </Pressable>
      ) : null}
      {reviews.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + cardGap}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          contentContainerStyle={{ paddingHorizontal: 20, gap: cardGap }}
        >
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              width={cardWidth}
              onOpen={() => setSelectedReview(review)}
            />
          ))}
        </ScrollView>
      ) : null}
      <AppTextSheet
        visible={selectedReview != null}
        title={selectedReview?.author ?? 'Review'}
        text={descriptionPlainText(selectedReview?.text ?? '')}
        avatarUrl={selectedReview?.authorAvatarUrl}
        rating={selectedReview?.rating}
        onClose={() => setSelectedReview(null)}
      />
    </View>
  );
}

function ReviewCardsSkeleton({ width, gap }: { width: number; gap: number }) {
  return (
    <SkeletonPulse>
      <ScrollView
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap }}
      >
        {Array.from({ length: 3 }, (_, index) => (
          <View
            key={index}
            className="rounded-[22px] border p-4"
            style={{
              width,
              height: 260,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <View className="flex-row items-center gap-3">
              <View
                className="h-10 w-10 rounded-full"
                style={{ backgroundColor: colors.surfaceRaised }}
              />
              <View className="flex-1 gap-2">
                <View
                  className="h-3 w-28 rounded-full"
                  style={{ backgroundColor: colors.surfaceRaised }}
                />
                <View
                  className="h-2.5 w-16 rounded-full"
                  style={{ backgroundColor: colors.surfaceRaised }}
                />
              </View>
              <View
                className="h-4 w-24 rounded-full"
                style={{ backgroundColor: colors.surfaceRaised }}
              />
            </View>
            <View className="mt-5 gap-3">
              {[100, 92, 96, 68].map((lineWidth, line) => (
                <View
                  key={line}
                  className="h-3 rounded-full"
                  style={{
                    width: `${lineWidth}%`,
                    backgroundColor: colors.surfaceRaised,
                  }}
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SkeletonPulse>
  );
}

function ReviewCard({
  review,
  width,
  onOpen,
}: {
  review: BookReview;
  width: number;
  onOpen: () => void;
}) {
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);
  const date = reviewDate(review.reviewedAt);
  const showReview = !review.containsSpoilers || spoilerRevealed;
  const initials = review.author
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <View
      className="overflow-hidden rounded-[22px] border p-4"
      style={{ width, height: 260, borderColor: colors.border, backgroundColor: colors.surface }}
    >
      <View className="flex-row items-center gap-3">
        <View
          className="h-10 w-10 overflow-hidden rounded-full items-center justify-center"
          style={{ backgroundColor: colors.surfaceRaised }}
        >
          {review.authorAvatarUrl ? (
            <Image
              source={{ uri: review.authorAvatarUrl }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : (
            <Text className="text-xs font-semibold" style={{ color: colors.textMuted }}>
              {initials || 'H'}
            </Text>
          )}
        </View>
        <Pressable
          disabled={!review.authorUrl}
          onPress={() => review.authorUrl && void Linking.openURL(review.authorUrl)}
          className="min-w-0 flex-1 active:opacity-70"
        >
          <Text numberOfLines={1} className="text-sm font-semibold" style={{ color: colors.text }}>
            {review.author}
          </Text>
          {date ? (
            <Text className="mt-0.5 text-xs" style={{ color: colors.textMuted }}>
              {date}
            </Text>
          ) : null}
        </Pressable>
        {review.rating != null ? <StarRating rating={review.rating} compact /> : null}
      </View>

      {showReview ? (
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`Read full review by ${review.author}`}
          className="mt-4 flex-1 active:opacity-75"
        >
          <DescriptionText
            value={review.text}
            numberOfLines={4}
            className="text-sm leading-[22px]"
            style={{ color: colors.text }}
          />
        </Pressable>
      ) : (
        <Pressable
          onPress={() => setSpoilerRevealed(true)}
          accessibilityRole="button"
          className="mt-4 flex-1 items-center justify-center rounded-2xl px-4 py-5 active:opacity-75"
          style={{ backgroundColor: colors.surfaceRaised }}
        >
          <Feather name="eye-off" size={20} color={colors.textMuted} />
          <Text className="mt-2 text-sm font-semibold" style={{ color: colors.text }}>
            Review contains spoilers
          </Text>
          <Text className="mt-1 text-xs" style={{ color: colors.textMuted }}>
            Tap to reveal
          </Text>
        </Pressable>
      )}

      {review.likesCount ? (
        <View className="flex-row items-center gap-1 pt-4">
          <Feather name="heart" size={14} color={colors.textMuted} />
          <Text className="text-xs" style={{ color: colors.textMuted }}>
            {review.likesCount}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function IosGlassActionButton({
  label,
  systemImage,
  onPress,
  disabled = false,
  fullWidth = false,
}: {
  label: string;
  systemImage: SFSymbol;
  onPress: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <SwiftUIHost
      matchContents={fullWidth ? { vertical: true } : true}
      colorScheme="dark"
      ignoreSafeArea="all"
      style={fullWidth ? { width: '100%' } : undefined}
    >
      <SwiftUIButton
        onPress={onPress}
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('capsule'),
          controlSize('large'),
          swiftUIForegroundStyle(colors.text),
          swiftUIDisabled(disabled),
          swiftUIAccessibilityLabel(label),
        ]}
      >
        <SwiftUIHStack
          spacing={8}
          modifiers={fullWidth ? [swiftUIFrame({ maxWidth: Infinity })] : undefined}
        >
          <SwiftUIImage systemName={systemImage} size={19} />
          <SwiftUIText>{label}</SwiftUIText>
        </SwiftUIHStack>
      </SwiftUIButton>
    </SwiftUIHost>
  );
}

function StarRating({ rating, compact = false }: { rating: number; compact?: boolean }) {
  const normalized = Math.max(0, Math.min(5, rating));

  return (
    <View
      className={`${compact ? '' : 'mt-2'} flex-row items-center gap-1`}
      accessibilityRole="text"
      accessibilityLabel={`${rating.toFixed(1)} out of 5 stars`}
    >
      {Array.from({ length: 5 }, (_, index) => {
        const fill = normalized - index;
        const icon = fill >= 0.75 ? 'star' : fill >= 0.25 ? 'star-half' : 'star-outline';
        return (
          <Ionicons
            key={index}
            name={icon}
            size={16}
            color={compact || fill >= 0.25 ? colors.rating : colors.textMuted}
          />
        );
      })}
      {!compact ? (
        <Text className="ml-1 text-xs font-semibold" style={{ color: colors.rating }}>
          {rating.toFixed(1)}
        </Text>
      ) : null}
    </View>
  );
}

function HeaderStarRating({ rating }: { rating: number }) {
  const normalized = Math.max(0, Math.min(5, rating));

  return (
    <SwiftUIHost colorScheme="dark" style={{ width: 136, height: 44 }}>
      <SwiftUIHStack
        spacing={5}
        modifiers={[
          swiftUIPadding({ horizontal: 12, vertical: 9 }),
          glassEffect({
            glass: { variant: 'regular' },
            shape: 'capsule',
          }),
        ]}
      >
        {Array.from({ length: 5 }, (_, index) => {
          const fill = normalized - index;
          const systemName: SFSymbol =
            fill >= 0.75
              ? 'star.fill'
              : fill >= 0.25
                ? 'star.leadinghalf.filled'
                : 'star';
          return (
            <SwiftUIImage
              key={index}
              systemName={systemName}
              size={18}
              color={colors.rating}
            />
          );
        })}
      </SwiftUIHStack>
    </SwiftUIHost>
  );
}

function SheetCloseButton({
  onPress,
  accessibilityLabel = 'Close',
}: {
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  if (Platform.OS === 'ios') {
    return (
      <SwiftUIHost matchContents colorScheme="dark">
        <SwiftUIButton
          label="Close"
          systemImage="xmark"
          onPress={onPress}
          modifiers={[
            buttonStyle('glass'),
            buttonBorderShape('circle'),
            controlSize('large'),
            labelStyle('iconOnly'),
            swiftUIAccessibilityLabel(accessibilityLabel),
          ]}
        />
      </SwiftUIHost>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="h-9 w-9 items-center justify-center rounded-full"
      style={{ backgroundColor: colors.surfaceRaised }}
    >
      <Feather name="x" size={18} color={colors.text} />
    </Pressable>
  );
}

function BookDeleteSheet({
  visible,
  book,
  canRemoveLocalFile,
  onClose,
  onRemoveLocalFile,
  onRemoveFromTomeio,
}: {
  visible: boolean;
  book: LibraryBook;
  canRemoveLocalFile: boolean;
  onClose: () => void;
  onRemoveLocalFile: () => void;
  onRemoveFromTomeio: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.64)' }}>
        <Pressable
          className="absolute inset-0"
          onPress={onClose}
          accessibilityLabel="Close removal options"
        />
        <SafeAreaView
          edges={[]}
          className="rounded-t-3xl border-t px-5 pt-5"
          style={{
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
            paddingBottom: Math.max(20, insets.bottom),
          }}
        >
          <View className="mb-5 flex-row items-center gap-3">
            <View
              className="h-16 w-11 overflow-hidden rounded-md"
              style={{ backgroundColor: colors.surfaceRaised }}
            >
              {book.cover ? (
                <Image
                  source={{ uri: book.cover }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
              ) : null}
            </View>
            <View className="min-w-0 flex-1">
              <Text
                numberOfLines={1}
                className="text-base font-semibold"
                style={{ color: colors.text }}
              >
                Remove book
              </Text>
              <Text
                numberOfLines={1}
                className="mt-1 text-xs"
                style={{ color: colors.textMuted }}
              >
                {book.title}
              </Text>
            </View>
            <SheetCloseButton onPress={onClose} />
          </View>

          <View className="gap-2">
            <Pressable
              onPress={onRemoveLocalFile}
              disabled={!canRemoveLocalFile}
              className="min-h-20 flex-row items-center gap-4 rounded-2xl border px-4 py-3 active:opacity-70 disabled:opacity-35"
              style={{ borderColor: colors.border }}
            >
              <Feather name="file-minus" size={20} color={colors.danger} />
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-semibold" style={{ color: colors.danger }}>
                  Remove local file
                </Text>
                <Text className="mt-1 text-xs leading-4" style={{ color: colors.textMuted }}>
                  Keep the book in Tomeio and retain its sync record.
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={onRemoveFromTomeio}
              className="min-h-20 flex-row items-center gap-4 rounded-2xl border px-4 py-3 active:opacity-70"
              style={{ borderColor: colors.border }}
            >
              <Feather name="trash-2" size={20} color={colors.danger} />
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-semibold" style={{ color: colors.danger }}>
                  Remove from Tomeio
                </Text>
                <Text className="mt-1 text-xs leading-4" style={{ color: colors.textMuted }}>
                  Remove the library record and its local file from Tomeio.
                </Text>
              </View>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function CoverPicker({
  visible,
  title,
  sources,
  providers,
  unavailableProviders,
  preference,
  busy,
  onClose,
  onChoose,
  onRefresh,
}: {
  visible: boolean;
  title: string;
  sources?: BookCoverSources;
  providers: AvailableCoverProvider[];
  unavailableProviders: string[];
  preference: BookCoverPreference;
  busy: boolean;
  onClose: () => void;
  onChoose: (preference: BookCoverPreference) => void;
  onRefresh: () => void;
}) {
  const choices: {
    preference: BookCoverPreference;
    label: string;
    detail: string;
    uri?: string;
  }[] = [
    {
      preference: 'auto',
      label: 'Automatic',
      detail: 'Prefer local, then Open Library, then installed cover providers.',
      uri:
        sources?.local ||
        sources?.catalog ||
        Object.values(sources?.providers ?? {})[0],
    },
    ...(sources?.local
      ? [{
          preference: 'local' as const,
          label: 'Local file',
          detail: 'Use the cover embedded in this book file.',
          uri: sources.local,
        }]
      : []),
    ...(sources?.catalog
      ? [{
          preference: 'catalog' as const,
          label: 'Open Library',
          detail: 'Use the matched catalog cover.',
          uri: sources.catalog,
        }]
      : []),
    ...providers
      .filter((provider) => provider.id !== 'org.tomeio.open-library')
      .map((provider) => ({
        preference: `provider:${provider.id}` as BookCoverPreference,
        label: provider.name,
        detail: sources?.providers?.[provider.id]
          ? 'Use the cover found by this add-on.'
          : 'No matching cover is available yet.',
        uri: sources?.providers?.[provider.id],
      })),
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.64)' }}>
        <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close cover settings" />
        <SafeAreaView
          edges={['bottom']}
          className="rounded-t-3xl border-t px-5 pb-5 pt-5"
          style={{
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <View className="mb-5 flex-row items-center justify-between gap-4">
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: colors.text }}>
                Choose cover
              </Text>
              <Text
                numberOfLines={1}
                className="mt-1 text-xs"
                style={{ color: colors.textMuted }}
              >
                {title}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close cover settings"
              className="h-9 w-9 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.surfaceRaised }}
            >
              <Feather name="x" size={18} color={colors.text} />
            </Pressable>
          </View>

          <View className="gap-2">
            {choices.map((choice) => {
              const selected = preference === choice.preference;
              return (
                <Pressable
                  key={choice.preference}
                  onPress={() => onChoose(choice.preference)}
                  disabled={busy || !choice.uri}
                  className="min-h-20 flex-row items-center gap-4 rounded-2xl border px-3 py-3 disabled:opacity-40"
                  style={{
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: selected ? colors.accentMuted : colors.surface,
                  }}
                >
                  <View
                    className="h-16 w-11 overflow-hidden rounded-md"
                    style={{ backgroundColor: colors.surfaceRaised }}
                  >
                    {choice.uri ? (
                      <Image
                        source={{ uri: choice.uri }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                      />
                    ) : null}
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                      {choice.label}
                    </Text>
                    <Text
                      className="mt-1 text-xs leading-4"
                      style={{ color: colors.textMuted }}
                    >
                      {choice.detail}
                    </Text>
                  </View>
                  <Feather
                    name={selected ? 'check-circle' : 'circle'}
                    size={19}
                    color={selected ? colors.accent : colors.textMuted}
                  />
                </Pressable>
              );
            })}
          </View>

          {busy ? (
            <View className="mt-3 flex-row items-center gap-2">
              <ActivityIndicator size="small" color={colors.accent} />
              <Text className="text-xs" style={{ color: colors.textMuted }}>
                Checking installed cover providers…
              </Text>
            </View>
          ) : null}

          {!busy && unavailableProviders.length ? (
            <Text className="mt-3 text-xs leading-4" style={{ color: colors.textMuted }}>
              Unavailable right now: {unavailableProviders.join(', ')}.
            </Text>
          ) : null}

          {!sources?.local ? (
            <Text className="mt-3 text-xs leading-4" style={{ color: colors.textMuted }}>
              No usable embedded cover was found. Automatic mode will try Open Library,
              then your installed cover-provider add-ons.
            </Text>
          ) : null}
          <Pressable
            onPress={onRefresh}
            disabled={busy}
            className="mt-4 h-11 flex-row items-center justify-center gap-2 rounded-xl border disabled:opacity-40"
            style={{ borderColor: colors.border }}
          >
            <Feather name="refresh-cw" size={16} color={colors.accent} />
            <Text className="text-xs font-semibold" style={{ color: colors.accent }}>
              Refresh cover sources
            </Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function AcquisitionRowsSkeleton({ width }: { width: number }) {
  return (
    <SkeletonPulse>
      <ScrollView
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
      >
        {Array.from({ length: 2 }, (_, index) => (
          <View
            key={index}
            className="flex-row gap-3 border p-3"
            style={{
              width,
              minHeight: 162,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              borderRadius: Platform.OS === 'ios' ? 38 : 24,
            }}
          >
            <View
              className="w-[92px]"
              style={{
                minHeight: 138,
                borderRadius: Platform.OS === 'ios' ? 26 : 12,
                backgroundColor: colors.surfaceRaised,
              }}
            />
            <View className="min-w-0 flex-1 justify-between py-1">
              <View className="gap-3">
                <View
                  className="h-3.5 w-4/5 rounded-full"
                  style={{ backgroundColor: colors.surfaceRaised }}
                />
                <View
                  className="h-3 w-2/5 rounded-full"
                  style={{ backgroundColor: colors.surfaceRaised }}
                />
                <View
                  className="h-2.5 w-3/5 rounded-full"
                  style={{ backgroundColor: colors.surfaceRaised }}
                />
                <View
                  className="h-2.5 w-full rounded-full"
                  style={{ backgroundColor: colors.surfaceRaised }}
                />
              </View>
              <View
                className="h-11 w-full rounded-xl"
                style={{ backgroundColor: colors.surfaceRaised }}
              />
            </View>
          </View>
        ))}
      </ScrollView>
    </SkeletonPulse>
  );
}

function AcquisitionRow({
  entry,
  phase,
  width,
  onAction,
}: {
  entry: AcquisitionEntry;
  phase: Phase;
  width: number;
  onAction: () => void;
}) {
  const { book } = entry;
  const { acquisition } = entry;
  const actionKind = acquisitionActionKind(acquisition);
  const [coverFailed, setCoverFailed] = useState(false);
  const metadata = [
    acquisition.format?.toUpperCase(),
    formatSize(acquisition.sizeBytes),
    acquisition.language,
    book.publishedYear ? String(book.publishedYear) : '',
    entry.providerName,
  ].filter(Boolean);
  const description = book.description ? descriptionPlainText(book.description) : '';
  const progress =
    phase.kind === 'downloading' && phase.progress.totalBytes > 0
      ? Math.min(100, Math.round((phase.progress.bytesWritten / phase.progress.totalBytes) * 100))
      : null;
  const actionLabel =
    actionKind === 'download' ? 'Download' : 'Open in browser';
  const actionIcon =
    actionKind === 'download' ? 'download' : 'external-link';
  const actionSystemImage: SFSymbol =
    actionKind === 'download' ? 'arrow.down.circle' : 'square.and.arrow.up';
  const cardRadius = Platform.OS === 'ios' ? 38 : 24;
  const coverRadius = cardRadius - 12;

  return (
    <View
      className="border p-3"
      style={{
        width,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        borderRadius: cardRadius,
      }}
    >
      <View className="flex-row items-stretch gap-3">
        <View
          className="w-[92px] overflow-hidden items-center justify-center"
          style={{
            minHeight: 138,
            backgroundColor: colors.surfaceRaised,
            borderRadius: coverRadius,
          }}
        >
          {book.coverUrl && !coverFailed ? (
            <Image
              source={{ uri: book.coverUrl }}
              contentFit="cover"
              onError={() => setCoverFailed(true)}
              accessibilityLabel={`${book.title} cover`}
              style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
            />
          ) : (
            <Feather name="book-open" size={20} color={colors.textMuted} />
          )}
          <SeriesPositionChip position={book.seriesPosition} />
        </View>
        <View className="min-w-0 flex-1 justify-between gap-3">
          <View className="gap-1">
            <Text numberOfLines={1} className="text-sm font-semibold" style={{ color: colors.text }}>
              {book.title}
            </Text>
            {book.authors.length ? (
              <Text numberOfLines={1} className="text-xs" style={{ color: colors.textMuted }}>
                {book.authors.join(', ')}
              </Text>
            ) : null}
            {metadata.length ? (
              <Text
                numberOfLines={1}
                className="text-[10px] uppercase tracking-wide"
                style={{ color: colors.textMuted }}
              >
                {metadata.join(' · ')}
              </Text>
            ) : null}
            {acquisition.label && acquisition.label.toLocaleLowerCase() !== `download ${acquisition.format}`.toLocaleLowerCase() ? (
              <Text numberOfLines={1} className="text-[11px]" style={{ color: colors.textMuted }}>
                {acquisition.label}
              </Text>
            ) : null}
            {description ? (
              <Text
                numberOfLines={2}
                className="text-[11px] leading-4"
                style={{ color: colors.textMuted }}
              >
                {description}
              </Text>
            ) : null}
            {phase.kind === 'error' ? (
              <Text numberOfLines={2} className="text-[11px]" style={{ color: colors.danger }}>
                {phase.message}
              </Text>
            ) : null}
          </View>
          {phase.kind === 'done' ? (
            <View
              className="h-11 w-full rounded-xl px-4 flex-row items-center justify-center gap-2"
              style={{ backgroundColor: colors.accentMuted }}
            >
              <Feather name="check" size={15} color={colors.success} />
              <Text className="self-center text-xs font-semibold" style={{ color: colors.text }}>
                Saved
              </Text>
            </View>
          ) : phase.kind === 'downloading' || phase.kind === 'resolving' ? (
            <View
              className="h-11 w-full flex-row items-center justify-center gap-2 rounded-xl"
              style={{ backgroundColor: colors.accentMuted }}
            >
              <ActivityIndicator color={colors.accent} size="small" />
              <Text className="text-xs font-semibold" style={{ color: colors.text }}>
                {progress !== null
                  ? `Downloading ${progress}%`
                  : actionKind === 'open'
                    ? 'Opening browser'
                    : 'Preparing download'}
              </Text>
            </View>
          ) : Platform.OS === 'ios' ? (
            <IosGlassActionButton
              label={actionLabel}
              systemImage={actionSystemImage}
              onPress={onAction}
              fullWidth
            />
          ) : (
            <Pressable
              onPress={onAction}
              className="h-11 w-full rounded-xl px-4 flex-row items-center justify-center gap-2 active:opacity-80"
              style={{ backgroundColor: colors.accent }}
            >
              <Feather name={actionIcon} size={15} color={colors.onAccent} />
              <Text className="text-xs font-semibold" style={{ color: colors.onAccent }}>
                {actionLabel}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
