import { Feather } from '@expo/vector-icons';
import type { BookAcquisition, BookMetadata } from '@tomeio/domain';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  LibraryBookActions,
  type LibraryAction,
} from '@/components/library-book-actions';
import { AppErrorDialog } from '@/components/app-error-dialog';
import {
  DescriptionText,
  descriptionPlainText,
  normalizeDescription,
} from '@/components/description-text';
import {
  BookStatusChips,
  colors,
  usePageBottomPadding,
} from '@/components/app-ui';
import { useDownloads, type BookDownloadJob } from '@/context/download-context';
import { useExtensions } from '@/context/extensions-context';
import type { AvailableCoverProvider } from '@/context/extensions-context';
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
import { openBookWithAnotherApp, showBookInFiles } from '@/lib/book-file-actions';
import { formatBookOffer, primaryBookOffer } from '@/lib/book-offers';
import type { BookCoverPreference, BookCoverSources } from '@/lib/book-cover';
import { bookFilename } from '@/lib/download';
import {
  fromDiscoveryBook,
  fromExtensionBook,
  toExtensionLibraryBook,
  type LibraryBook,
} from '@/lib/library';
import { loadLocalCatalogBook } from '@/lib/library-db';
import { getWorkDetails, type DiscoveryBook } from '@/lib/openlibrary';

type Phase =
  | { kind: 'idle' }
  | { kind: 'resolving' }
  | { kind: 'downloading'; progress: { bytesWritten: number; totalBytes: number } }
  | { kind: 'done'; uri: string }
  | { kind: 'error'; message: string };

interface AcquisitionCandidate {
  kind: 'candidate';
  matchesCurrentBook: boolean;
  key: string;
  extensionId: string;
  providerName: string;
  book: BookMetadata;
}

interface AcquisitionOption {
  kind: 'option';
  matchesCurrentBook: boolean;
  key: string;
  extensionId: string;
  providerName: string;
  book: BookMetadata;
  acquisition: BookAcquisition;
}

type AcquisitionEntry = AcquisitionCandidate | AcquisitionOption;

interface AcquisitionOptionPage {
  items: AcquisitionEntry[];
  nextPage: number | null;
}

const IDLE: Phase = { kind: 'idle' };

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
  const compactLayout = width < 700;
  const bottomPadding = usePageBottomPadding(48);
  const params = useLocalSearchParams<{
    id: string;
    extensionId?: string;
    extensionBook?: string;
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

  const [options, setOptions] = useState<AcquisitionEntry[] | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsErrorVisible, setOptionsErrorVisible] = useState(false);
  const [nextOptionsPage, setNextOptionsPage] = useState<number | null>(null);
  const [loadingMoreOptions, setLoadingMoreOptions] = useState(false);
  const optionsGeneration = useRef(0);
  const acquisitionExtensionBook = acquisitionExtension?.book ?? null;
  const acquisitionSourceExtensionId = acquisitionExtension?.extensionId ?? null;
  const missingReadingListBook =
    localCopyUnavailable &&
    localBook &&
    readingList.some((book) => book.key === localBook.key)
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
    !!acquisitionExtensionBook || !!currentDiscovery || !!missingReadingListBook;

  const loadOptionsPage = useCallback(
    async (page: number): Promise<AcquisitionOptionPage> => {
      if (!acquisitionExtensionId) return { items: [], nextPage: null };
      const provider = await loadExtension(acquisitionExtensionId);
      if (!provider.acquisition) {
        throw new Error(`${provider.manifest.name} does not provide downloads.`);
      }
      if (
        acquisitionExtensionBook &&
        acquisitionSourceExtensionId === acquisitionExtensionId
      ) {
        if (page !== 1) return { items: [], nextPage: null };
        if (acquisitionExtensionBook.acquisitions?.length) {
          return {
            items: acquisitionExtensionBook.acquisitions.map((acquisition) => ({
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
        return {
          items: [{
            kind: 'candidate' as const,
            matchesCurrentBook: true,
            key: `${acquisitionExtensionId}:${acquisitionExtensionBook.id}`,
            extensionId: acquisitionExtensionId,
            providerName: provider.manifest.name,
            book: acquisitionExtensionBook,
          }],
          nextPage: null,
        };
      }
      if (!lookupTitle) return { items: [], nextPage: null };
      if (!provider.resolve && !provider.search) {
        throw new Error(
          `${provider.manifest.name} cannot resolve books from another search provider.`
        );
      }
      const resolved = provider.resolve
        ? await provider.resolve({
            book: {
              id: acquisitionExtensionBook?.id ?? currentDiscovery?.id ?? missingReadingListBook?.id,
              title: lookupTitle,
              authors: lookupAuthor ? [lookupAuthor] : [],
              publishedYear:
                acquisitionExtensionBook?.publishedYear ??
                (currentDiscovery?.year ? Number(currentDiscovery.year) || undefined : undefined),
              identifiers: acquisitionExtensionBook?.identifiers ?? {},
            },
            page,
            limit: 3,
          })
        : await searchAcquisitionCandidatePage(
            { search: provider.search! },
            `${lookupTitle} ${lookupAuthor}`.trim(),
            page
          );
      return {
        items: resolved.items.slice(0, 3).flatMap((book): AcquisitionEntry[] =>
          book.acquisitions?.length
            ? book.acquisitions.map((acquisition) => ({
                kind: 'option',
                matchesCurrentBook: false,
                key: `${acquisitionExtensionId}:${book.id}:${acquisition.id}`,
                extensionId: acquisitionExtensionId,
                providerName: provider.manifest.name,
                book,
                acquisition,
              }))
            : [{
                kind: 'candidate',
                matchesCurrentBook: false,
                key: `${acquisitionExtensionId}:${book.id}`,
                extensionId: acquisitionExtensionId,
                providerName: provider.manifest.name,
                book,
              }]
        ),
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

  useEffect(() => {
    if (!hasAcquisitionLookup) {
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

    loadOptionsPage(1)
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
  }, [hasAcquisitionLookup, loadOptionsPage]);

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

  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<LibraryAction | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [failedCovers, setFailedCovers] = useState<string[]>([]);
  const [phases, setPhases] = useState<Record<string, Phase>>({});
  const onReadingList = readingListBook
    ? readingList.some((book) => book.key === readingListBook.key)
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
          const provider = await loadExtension(option.extensionId);
          if (!provider.acquisition) {
            throw new Error(`${provider.manifest.name} does not provide downloads.`);
          }
          const resolved = await provider.acquisition(book.id);
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
              entry.key === option.key && entry.kind === 'option'
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
    [loadExtension, settings.localLibraryLocation, startBookDownload]
  );

  const resolveCandidate = useCallback(
    async (candidate: AcquisitionCandidate) => {
      setPhases((current) => ({ ...current, [candidate.key]: { kind: 'resolving' } }));
      try {
        const provider = await loadExtension(candidate.extensionId);
        if (!provider.acquisition) {
          throw new Error(`${provider.manifest.name} does not provide downloads.`);
        }
        const acquisitions = await provider.acquisition(candidate.book.id);
        if (!acquisitions.length) {
          throw new Error(`${provider.manifest.name} returned no files for this candidate.`);
        }
        const resolved: AcquisitionOption[] = acquisitions.map((acquisition) => ({
          kind: 'option',
          matchesCurrentBook: candidate.matchesCurrentBook,
          key: `${candidate.extensionId}:${candidate.book.id}:${acquisition.id}`,
          extensionId: candidate.extensionId,
          providerName: provider.manifest.name,
          book: candidate.book,
          acquisition,
        }));
        setOptions((current) =>
          current?.flatMap((entry) => (entry.key === candidate.key ? resolved : [entry])) ?? null
        );
        setPhases((current) => {
          const next = { ...current };
          delete next[candidate.key];
          return next;
        });
        if (candidate.matchesCurrentBook && resolved.length === 1 && resolved[0]) {
          await downloadOption(resolved[0]);
        }
      } catch (cause) {
        setPhases((current) => ({
          ...current,
          [candidate.key]: {
            kind: 'error',
            message: cause instanceof Error ? cause.message : String(cause),
          },
        }));
      }
    },
    [downloadOption, loadExtension]
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

  const libraryActionBook = localBook ?? moonBook;
  const coverProviders = useMemo(
    () => extensions.coverProviders(),
    [extensions]
  );
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
      await refreshBookCoverSources(libraryActionBook, force);
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
        <Text className="text-sm text-neutral-400">Book details unavailable.</Text>
        <Pressable onPress={goBack}>
          <Text className="text-sm font-semibold" style={{ color: colors.accent }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const title = extensionBook?.title || currentDiscovery?.title || localBook?.title || 'Untitled';
  const author =
    extensionBook?.authors[0] || currentDiscovery?.author || localBook?.author || 'Unknown';
  const coverCandidates = [
    localBook?.cover,
    localBook?.fallbackCover,
    extensionBook?.coverUrl,
    currentDiscovery?.cover,
  ].filter(
    (cover, index, covers): cover is string => !!cover && covers.indexOf(cover) === index
  );
  const description = extensionBook?.description
    ? normalizeDescription(extensionBook.description)
    : currentDiscovery?.description
      ? normalizeDescription(currentDiscovery.description)
      : localBook?.description
        ? normalizeDescription(localBook.description)
        : '';
  const rating = extensionBook?.rating ?? currentDiscovery?.rating ?? localBook?.rating;
  const purchaseOffer = extensionBook ? primaryBookOffer(extensionBook) : undefined;
  const purchaseUrl = purchaseOffer?.url ?? extensionBook?.infoUrl;
  const purchasePrice = formatBookOffer(purchaseOffer);
  const purchaseLabel = purchaseOffer
    ? purchaseOffer.availability === 'free'
      ? `Get free on ${purchaseOffer.provider}`
      : `${purchaseOffer.availability === 'preorder' ? 'Pre-order' : 'Buy'}${
          purchasePrice ? ` for ${purchasePrice}` : ''
        } on ${purchaseOffer.provider}`
    : purchaseUrl
      ? 'View at source'
      : null;
  const trackedBook = localBook ?? moonBook;
  const progress = trackedBook?.isRead ? 100 : trackedBook?.progress;
  const localFileAvailable =
    localBook?.availableLocally !== false &&
    localBook?.moonReader?.availableLocally !== false &&
    !!(localBook?.local?.uri || localBook?.fileUri);
  const meta = extensionBook
    ? [extensionBook.publishedYear, extensionBook.subjects.slice(0, 2).join(', ')].filter(Boolean)
    : currentDiscovery
      ? [genreLabel || currentDiscovery.genre, currentDiscovery.year].filter(Boolean)
      : [
          localBook?.format?.toUpperCase(),
          formatSize(localBook?.size),
          localBook?.year,
          localFileAvailable ? 'Local file' : 'Not downloaded',
        ].filter(Boolean);
  const activeCover = coverCandidates.find((cover) => !failedCovers.includes(cover)) ?? null;
  const heroHeight = compactLayout
    ? Math.min(620, Math.max(480, Math.round(width * 1.24)))
    : 420;

  const readingListButton = (
    <Pressable
      onPress={toggleSaved}
      disabled={libraryBusy}
      className="h-11 self-stretch rounded-lg border flex-row items-center justify-center gap-2 disabled:opacity-60"
      style={{
        backgroundColor: onReadingList ? colors.accentMuted : 'transparent',
        borderColor: onReadingList ? colors.accent : colors.border,
      }}
    >
      {libraryBusy ? (
        <ActivityIndicator color={colors.accent} size="small" />
      ) : (
        <Feather name={onReadingList ? 'bookmark' : 'plus'} color="#b4b4bf" size={15} />
      )}
      <Text className="text-xs font-semibold text-neutral-300">
        {onReadingList ? 'In reading list' : 'Add to reading list'}
      </Text>
    </Pressable>
  );

  const descriptionPreview = description ? (
    <Pressable
      onPress={() => setDescriptionOpen(true)}
      className="mt-5 overflow-hidden"
    >
      <DescriptionText
        value={description}
        numberOfLines={compactLayout ? 6 : 5}
        className="text-sm text-neutral-300 leading-5"
      />
    </Pressable>
  ) : null;

  return (
    <>
      <ScrollView
        className="flex-1"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ paddingBottom: bottomPadding }}
      >
        <View className="relative overflow-hidden" style={{ height: heroHeight }}>
          {activeCover ? (
            <Image
              source={{ uri: activeCover }}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              contentFit="cover"
              contentPosition="top"
              cachePolicy="memory-disk"
              onError={() =>
                setFailedCovers((current) =>
                  current.includes(activeCover) ? current : [...current, activeCover]
                )
              }
            />
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
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.12)' }}
          />
          <View
            pointerEvents="none"
            className="absolute inset-0"
            style={{
              experimental_backgroundImage: `linear-gradient(to bottom, rgba(16, 11, 8, 0.02) 0%, rgba(16, 11, 8, 0.08) 34%, rgba(16, 11, 8, 0.68) 70%, ${colors.background} 100%)`,
            }}
          />
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="absolute left-4 top-4 h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: 'rgba(10, 10, 14, 0.72)' }}
          >
            <Feather name="chevron-left" color="#f4f4f5" size={23} />
          </Pressable>
          {libraryActionBook ? (
            <Pressable
              onPress={openCoverPicker}
              accessibilityRole="button"
              accessibilityLabel="Cover settings"
              className="absolute right-4 top-4 h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: 'rgba(10, 10, 14, 0.72)' }}
            >
              <Feather name="more-vertical" color="#f4f4f5" size={22} />
            </Pressable>
          ) : null}
          <View className="absolute right-0 bottom-0 left-0 px-5 pb-5">
            <Text
              numberOfLines={3}
              className={`${compactLayout ? 'text-[28px] leading-8' : 'text-3xl leading-9'} font-semibold text-white`}
              style={{ textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 8 }}
            >
              {title}
            </Text>
            <Text className="mt-2 text-[15px] text-neutral-200">{author}</Text>
            {meta.length ? (
              <Text className="mt-2 text-xs uppercase tracking-wide text-neutral-300">
                {meta.join(' · ')}
              </Text>
            ) : null}
            <BookStatusChips
              rating={rating}
              progress={progress}
              isRead={trackedBook?.isRead}
            />
          </View>
        </View>

        <View className="px-5 pt-2">
          {readingListButton}
          {descriptionPreview}
          {purchaseUrl && purchaseLabel ? (
            <Pressable
              onPress={() => void Linking.openURL(purchaseUrl)}
              accessibilityRole="link"
              className="mt-5 h-12 flex-row items-center justify-center gap-2 rounded-xl"
              style={{ backgroundColor: colors.accent }}
            >
              <Feather name="external-link" size={17} color={colors.onAccent} />
              <Text className="text-sm font-semibold" style={{ color: colors.onAccent }}>
                {purchaseLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {metadataError || libraryError || localCatalogError ? (
          <View className="px-6 mt-3 gap-1">
            {metadataError ? <Text className="text-xs text-red-400">{metadataError}</Text> : null}
            {libraryError ? <Text className="text-xs text-red-400">{libraryError}</Text> : null}
            {localCatalogError ? <Text className="text-xs text-red-400">{localCatalogError}</Text> : null}
          </View>
        ) : null}

        {hasAcquisitionLookup ? (
          <View className="px-6 mt-8 gap-3">
            <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400">
              Download options
            </Text>
            {options === null && !optionsError ? (
              <View className="flex-row items-center gap-3 py-4">
                <ActivityIndicator color={colors.accent} size="small" />
                <Text className="text-sm text-neutral-400">Loading provider options…</Text>
              </View>
            ) : null}
            {optionsError ? (
              <Pressable
                onPress={() => setOptionsErrorVisible(true)}
                className="rounded-xl border px-4 py-3 active:opacity-75"
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
              <Text className="text-sm text-neutral-500">
                No acquisitions were returned by the selected provider.
              </Text>
            ) : null}
            {options?.map((entry) => {
              const phase =
                (entry.kind === 'option' ? phaseFromJob(downloadJobs[entry.key]) : null) ??
                phases[entry.key] ??
                IDLE;
              const onAction = () =>
                void (entry.kind === 'candidate'
                  ? resolveCandidate(entry)
                  : downloadOption(entry));
              return entry.matchesCurrentBook && entry.kind === 'candidate' ? (
                <CurrentBookAcquisitionRow
                  key={entry.key}
                  entry={entry}
                  phase={phase}
                  onAction={onAction}
                />
              ) : (
                <AcquisitionRow
                  key={entry.key}
                  entry={entry}
                  phase={phase}
                  onAction={onAction}
                />
              );
            })}
            {nextOptionsPage != null ? (
              <Pressable
                onPress={() => void loadMoreOptions()}
                disabled={loadingMoreOptions}
                accessibilityRole="button"
                accessibilityLabel="Find more download options"
                className="h-11 items-center justify-center rounded-xl border disabled:opacity-50"
                style={{ borderColor: colors.border }}
              >
                {loadingMoreOptions ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Text className="text-xs font-semibold" style={{ color: colors.accent }}>
                    Find more options
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {libraryActionBook ? (
          <View className="px-6 mt-8 gap-3">
            <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400">
              Library actions
            </Text>
            <LibraryBookActions
              compact
              book={libraryActionBook}
              busyAction={busyAction}
              addonActions={addonActions}
              onOpenWith={() =>
                void runLibraryAction('openWith', () => openBookWithAnotherApp(libraryActionBook))
              }
              onShowInFiles={() =>
                void runLibraryAction('files', () =>
                  showBookInFiles(libraryActionBook, settings.localLibraryLocation)
                )
              }
              onDelete={() => {
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
              onRemove={() => {
                const localRecord = !!(
                  libraryActionBook.local?.uri ?? libraryActionBook.fileUri
                );
                const localFileAvailable =
                  localRecord && libraryActionBook.availableLocally !== false;
                Alert.alert(
                  localRecord ? 'Remove from Tomeio?' : 'Remove synced book?',
                  localRecord
                    ? localFileAvailable
                      ? `Permanently delete “${libraryActionBook.title}” and remove it from Tomeio?`
                      : `Remove “${libraryActionBook.title}” from your library? The missing file will not be deleted again.`
                    : `Remove “${libraryActionBook.title}” from Tomeio on every synced device? Newer Moon+ Reader activity can add it again.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () =>
                        void runLibraryAction('remove', async () => {
                          await removeLibraryBook(libraryActionBook);
                          router.replace('/library');
                        }),
                    },
                  ]
                );
              }}
              onMarkRead={() => void runLibraryAction('read', () => markAsRead(libraryActionBook))}
              onRefreshMetadata={() =>
                void runLibraryAction('metadata', () => refreshBookMetadata(libraryActionBook))
              }
            />
          </View>
        ) : null}

        {localBook?.fileUri ? (
          <View className="px-6 mt-8 gap-2">
            <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400">
              {localFileAvailable ? 'Stored locally' : 'Last local location'}
            </Text>
            <Text numberOfLines={2} className="text-xs leading-4 text-neutral-500">
              {localBook.fileUri}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <CoverPicker
        visible={coverPickerOpen}
        title={title}
        sources={libraryActionBook?.coverSources}
        providers={coverProviders}
        preference={libraryActionBook?.coverPreference ?? 'auto'}
        busy={coverBusy}
        onClose={() => {
          if (!coverBusy) setCoverPickerOpen(false);
        }}
        onChoose={(preference) => void chooseCover(preference)}
        onRefresh={() => void loadCoverSources(true)}
      />

      <AppErrorDialog
        title="Download options unavailable"
        message={optionsErrorVisible ? optionsError : null}
        onClose={() => setOptionsErrorVisible(false)}
      />

      <Modal
        visible={descriptionOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDescriptionOpen(false)}
      >
        <Pressable
          onPress={() => setDescriptionOpen(false)}
          className="flex-1 items-center justify-center px-8 py-12 bg-black/80"
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            className="w-full rounded-2xl overflow-hidden border"
            style={{
              maxWidth: 720,
              maxHeight: '80%',
              borderColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <View
              className="h-14 px-5 flex-row items-center justify-between border-b"
              style={{ borderBottomColor: colors.border }}
            >
              <Text numberOfLines={1} className="flex-1 text-base font-semibold text-neutral-100">
                {title}
              </Text>
              <Pressable onPress={() => setDescriptionOpen(false)} className="h-9 w-9 items-center justify-center">
                <Feather name="x" size={18} color="#d4d4d8" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <DescriptionText
                value={description}
                className="text-sm leading-6 text-neutral-300"
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function CoverPicker({
  visible,
  title,
  sources,
  providers,
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
      .filter((provider) => !!sources?.providers?.[provider.id])
      .map((provider) => ({
        preference: `provider:${provider.id}` as BookCoverPreference,
        label: provider.name,
        detail: 'Use the cover found by this add-on.',
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
              <Text className="text-base font-semibold text-neutral-100">Choose cover</Text>
              <Text numberOfLines={1} className="mt-1 text-xs text-neutral-500">{title}</Text>
            </View>
            <Pressable
              onPress={onClose}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Close cover settings"
              className="h-9 w-9 items-center justify-center rounded-full disabled:opacity-40"
              style={{ backgroundColor: colors.surfaceRaised }}
            >
              <Feather name="x" size={18} color="#d4d4d8" />
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
                    <Text className="text-sm font-semibold text-neutral-100">{choice.label}</Text>
                    <Text className="mt-1 text-xs leading-4 text-neutral-500">{choice.detail}</Text>
                  </View>
                  {busy && selected ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Feather
                      name={selected ? 'check-circle' : 'circle'}
                      size={19}
                      color={selected ? colors.accent : colors.textMuted}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>

          {busy ? (
            <View className="mt-3 flex-row items-center gap-2">
              <ActivityIndicator size="small" color={colors.accent} />
              <Text className="text-xs text-neutral-400">
                Checking installed cover providers…
              </Text>
            </View>
          ) : null}

          {!sources?.local ? (
            <Text className="mt-3 text-xs leading-4 text-neutral-500">
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
            {busy ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Feather name="refresh-cw" size={16} color={colors.accent} />
            )}
            <Text className="text-xs font-semibold" style={{ color: colors.accent }}>
              Refresh cover sources
            </Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function CurrentBookAcquisitionRow({
  entry,
  phase,
  onAction,
}: {
  entry: AcquisitionEntry;
  phase: Phase;
  onAction: () => void;
}) {
  const acquisition = entry.kind === 'option' ? entry.acquisition : null;
  const metadata = acquisition
    ? [
        acquisition.format?.toUpperCase(),
        formatSize(acquisition.sizeBytes),
        acquisition.language,
      ].filter(Boolean)
    : [];
  const progress =
    phase.kind === 'downloading' && phase.progress.totalBytes > 0
      ? Math.min(100, Math.round((phase.progress.bytesWritten / phase.progress.totalBytes) * 100))
      : null;

  return (
    <View
      className="rounded-2xl border p-4 flex-row items-center gap-3"
      style={{ borderColor: colors.border, backgroundColor: colors.surface }}
    >
      <View
        className="h-10 w-10 rounded-xl items-center justify-center"
        style={{ backgroundColor: colors.surfaceRaised }}
      >
        <Feather
          name={acquisition ? 'file-text' : 'download'}
          size={18}
          color={colors.textMuted}
        />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text numberOfLines={1} className="text-sm font-semibold text-neutral-100">
          {acquisition?.label || 'Download this book'}
        </Text>
        <Text numberOfLines={1} className="text-[10px] uppercase tracking-wide text-neutral-500">
          {metadata.length ? metadata.join(' · ') : entry.providerName}
        </Text>
        {phase.kind === 'error' ? (
          <Text numberOfLines={3} className="text-[11px] text-red-500">
            {phase.message}
          </Text>
        ) : null}
      </View>
      {phase.kind === 'done' ? (
        <View className="h-10 rounded-xl bg-emerald-950 px-4 flex-row items-center gap-2">
          <Feather name="check" size={15} color="#5ee0a0" />
          <Text className="text-xs font-semibold text-emerald-300">Saved</Text>
        </View>
      ) : phase.kind === 'downloading' || phase.kind === 'resolving' ? (
        <View className="min-w-[76px] items-center gap-1">
          <ActivityIndicator color={colors.accent} size="small" />
          {progress !== null ? (
            <Text className="text-[10px] text-neutral-400">{progress}%</Text>
          ) : null}
        </View>
      ) : (
        <Pressable
          onPress={onAction}
          className="h-10 rounded-xl px-4 flex-row items-center justify-center gap-2 active:opacity-80"
          style={{ backgroundColor: colors.accent }}
        >
          <Feather name="download" size={15} color={colors.onAccent} />
          <Text className="text-xs font-semibold" style={{ color: colors.onAccent }}>
            Download
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function AcquisitionRow({
  entry,
  phase,
  onAction,
}: {
  entry: AcquisitionEntry;
  phase: Phase;
  onAction: () => void;
}) {
  const { book } = entry;
  const acquisition = entry.kind === 'option' ? entry.acquisition : null;
  const actionKind = acquisition ? acquisitionActionKind(acquisition) : null;
  const [coverFailed, setCoverFailed] = useState(false);
  const metadata = [
    acquisition?.format?.toUpperCase(),
    formatSize(acquisition?.sizeBytes),
    acquisition?.language,
    book.publishedYear ? String(book.publishedYear) : '',
    entry.providerName,
  ].filter(Boolean);
  const description = book.description ? descriptionPlainText(book.description) : '';
  const progress =
    phase.kind === 'downloading' && phase.progress.totalBytes > 0
      ? Math.min(100, Math.round((phase.progress.bytesWritten / phase.progress.totalBytes) * 100))
      : null;
  return (
    <View
      className="rounded-2xl border p-3 flex-row items-center gap-3"
      style={{ borderColor: colors.border, backgroundColor: colors.surface }}
    >
      <View
        className="h-[78px] w-[54px] overflow-hidden rounded-lg items-center justify-center"
        style={{ backgroundColor: colors.surfaceRaised }}
      >
        {book.coverUrl && !coverFailed ? (
          <Image
            source={{ uri: book.coverUrl }}
            contentFit="cover"
            onError={() => setCoverFailed(true)}
            accessibilityLabel={`${book.title} cover`}
            style={{ width: 54, height: 78 }}
          />
        ) : (
          <Feather name="book-open" size={20} color="#6f6f7a" />
        )}
      </View>
      <View className="flex-1 gap-1">
        <Text numberOfLines={1} className="text-sm font-semibold text-neutral-100">
          {book.title}
        </Text>
        {book.authors.length ? (
          <Text numberOfLines={1} className="text-xs text-neutral-400">
            {book.authors.join(', ')}
          </Text>
        ) : null}
        {metadata.length ? (
          <Text numberOfLines={1} className="text-[10px] uppercase tracking-wide text-neutral-500">
            {metadata.join(' · ')}
          </Text>
        ) : null}
        {acquisition?.label && acquisition.label.toLocaleLowerCase() !== `download ${acquisition.format}`.toLocaleLowerCase() ? (
          <Text numberOfLines={1} className="text-[11px] text-neutral-400">{acquisition.label}</Text>
        ) : null}
        {description ? (
          <Text numberOfLines={2} className="text-[11px] leading-4 text-neutral-500">
            {description}
          </Text>
        ) : null}
        {phase.kind === 'error' ? (
          <Text numberOfLines={2} className="text-[11px] text-red-500">{phase.message}</Text>
        ) : null}
      </View>
      {phase.kind === 'done' ? (
        <View className="h-10 rounded-xl bg-emerald-950 px-4 flex-row items-center gap-2">
          <Feather name="check" size={15} color="#5ee0a0" />
          <Text className="self-center text-xs font-semibold text-emerald-300">Saved</Text>
        </View>
      ) : phase.kind === 'downloading' || phase.kind === 'resolving' ? (
        <View className="min-w-[76px] items-center gap-1">
          <ActivityIndicator color={colors.accent} size="small" />
          {progress !== null ? <Text className="text-[10px] text-neutral-400">{progress}%</Text> : null}
        </View>
      ) : (
        <Pressable
          onPress={onAction}
          className="h-10 rounded-xl px-4 flex-row items-center justify-center gap-2 active:opacity-80"
          style={{ backgroundColor: colors.accent }}
        >
          <Feather
            name={
              entry.kind === 'candidate'
                ? 'search'
                : actionKind === 'download'
                  ? 'download'
                  : 'external-link'
            }
            size={15}
            color={colors.onAccent}
          />
          <Text className="text-xs font-semibold" style={{ color: colors.onAccent }}>
            {entry.kind === 'candidate'
              ? 'View files'
              : actionKind === 'download'
                ? 'Download'
                : 'Open'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
