import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { RatingChip } from '@/components/rating-chip';
import {
  LibraryBookActions,
  type LibraryAction,
} from '@/components/library-book-actions';
import { useLibrary } from '@/context/library-context';
import { useSettings } from '@/context/settings-context';
import { bookFilename, downloadBook, type DownloadProgress } from '@/lib/download';
import {
  fromDiscoveryBook,
  fromZlibBook,
  type LibraryBook,
} from '@/lib/library';
import { loadLocalCatalogBook } from '@/lib/library-db';
import { openInMoonReader } from '@/lib/moon-reader-launcher';
import { getWorkDetails, type DiscoveryBook } from '@/lib/openlibrary';
import { rankZlibMatches } from '@/lib/match';
import { downloadHeaders, resolveDownload, searchBooks, type Book } from '@/lib/zlib';

type Phase =
  | { kind: 'idle' }
  | { kind: 'resolving' }
  | { kind: 'downloading'; progress: DownloadProgress }
  | { kind: 'done'; uri: string }
  | { kind: 'error'; message: string };

const IDLE: Phase = { kind: 'idle' };

function formatSize(bytes: number): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function parseParam<T>(json?: string): T | null {
  try {
    return json ? (JSON.parse(json) as T) : null;
  } catch {
    return null;
  }
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export default function BookDetailScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compactLayout = width < 700;
  const params = useLocalSearchParams<{
    id: string;
    item?: string;
    ext?: string;
    local?: string;
    localUri?: string;
    moon?: string;
  }>();
  const { settings } = useSettings();
  const {
    deleteLocalBook,
    downloaded,
    isOnReadingList,
    markAsRead,
    recordDownload,
    refreshBookMetadata,
    toggleReadingList,
  } = useLibrary();

  // Three modes:
  //  - zlib: came from the in-app Z-Library search (single known download)
  //  - ext:  came from an external recommendation (Open Library) — we look up
  //          matching Z-Library downloads and offer one button per option.
  //  - local: indexed from the user-selected library folder.
  //  - moon:  known by Moon+ Reader but not necessarily stored in the local folder.
  const zlibBook = useMemo(() => parseParam<Book>(params.item), [params.item]);
  const parsedMoonBook = useMemo(() => parseParam<LibraryBook>(params.moon), [params.moon]);
  const moonBookParam = useMemo(() => {
    if (!parsedMoonBook) return null;
    const liveBook = downloaded.find((book) => book.key === parsedMoonBook.key);
    return liveBook
      ? {
          ...parsedMoonBook,
          ...liveBook,
          moonReader: {
            ...parsedMoonBook.moonReader,
            ...liveBook.moonReader,
            syncedAt:
              liveBook.moonReader?.syncedAt ?? parsedMoonBook.moonReader?.syncedAt ?? Date.now(),
          },
        }
      : parsedMoonBook;
  }, [downloaded, parsedMoonBook]);
  const extBookParam = useMemo(() => parseParam<DiscoveryBook>(params.ext), [params.ext]);
  const extBook = useMemo<DiscoveryBook | null>(() => {
    if (extBookParam) return extBookParam;
    if (!moonBookParam) return null;
    return {
      id: moonBookParam.discovery?.id ?? moonBookParam.id,
      title: moonBookParam.title,
      author: moonBookParam.author,
      cover: moonBookParam.cover,
      description: moonBookParam.description,
      year: String(moonBookParam.year ?? ''),
      genre: moonBookParam.genre,
      rating: moonBookParam.rating,
      ratingsCount: moonBookParam.ratingsCount,
    };
  }, [extBookParam, moonBookParam]);
  const localBookParam = useMemo(() => parseParam<LibraryBook>(params.local), [params.local]);
  const [persistedLocalBook, setPersistedLocalBook] = useState<LibraryBook | null>(null);
  const [localCatalogError, setLocalCatalogError] = useState<string | null>(null);
  useEffect(() => {
    if (!localBookParam && !params.localUri) {
      setPersistedLocalBook(null);
      setLocalCatalogError(null);
      return;
    }
    let active = true;
    setLocalCatalogError(null);
    void loadLocalCatalogBook(
      localBookParam?.key ?? params.id ?? null,
      params.localUri ?? localBookParam?.local?.uri ?? null
    )
      .then((book) => {
        if (active) setPersistedLocalBook(book);
      })
      .catch((err) => {
        if (active) {
          setLocalCatalogError(
            `Local catalog lookup failed: ${err.message || String(err)}`
          );
        }
      });
    return () => {
      active = false;
    };
  }, [localBookParam, params.id, params.localUri]);
  const localBook = useMemo(() => {
    if (!localBookParam && !params.localUri) return null;
    const liveBook = downloaded.find(
      (book) =>
        !!book.local &&
        (book.key === params.id ||
          book.id === params.id ||
          book.key === localBookParam?.key ||
          book.local.uri === params.localUri ||
          book.local.uri === localBookParam?.local?.uri)
    );
    if (!persistedLocalBook) return liveBook ?? localBookParam;
    const moonReader =
      persistedLocalBook.moonReader ?? liveBook?.moonReader ?? localBookParam?.moonReader;
    return {
      ...localBookParam,
      ...liveBook,
      ...persistedLocalBook,
      cover: persistedLocalBook.cover || liveBook?.cover || localBookParam?.cover || '',
      description:
        persistedLocalBook.description ||
        liveBook?.description ||
        localBookParam?.description ||
        '',
      progress:
        persistedLocalBook.progress ?? liveBook?.progress ?? localBookParam?.progress,
      isRead: persistedLocalBook.isRead ?? liveBook?.isRead ?? localBookParam?.isRead,
      moonReader: moonReader
        ? {
            ...localBookParam?.moonReader,
            ...liveBook?.moonReader,
            ...persistedLocalBook.moonReader,
            syncedAt: moonReader.syncedAt,
          }
        : undefined,
    };
  }, [downloaded, localBookParam, params.id, params.localUri, persistedLocalBook]);
  const isExt = !!extBook && !zlibBook;

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

  // ── external mode: find download options on Z-Library ──
  const [options, setOptions] = useState<Book[] | null>(null);
  const [optError, setOptError] = useState<string | null>(null);
  const [phases, setPhases] = useState<Record<string, Phase>>({});
  const [remoteDescription, setRemoteDescription] = useState('');
  const [failedHeaderCovers, setFailedHeaderCovers] = useState<string[]>([]);
  const [genreLabel, setGenreLabel] = useState('');
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<LibraryAction | null>(null);

  useEffect(() => {
    if (!isExt || !extBook) return;
    let cancelled = false;
    setOptions(null);
    setOptError(null);

    // Z-Library is a string search engine (no ISBN lookup in eapi), so we
    // query with a quoted core title + author and rank client-side.
    const coreTitle = extBook.title.split(/[:(\u2014]/)[0].trim();
    const lastName = extBook.author.split(' ').slice(-1)[0];
    const query = `"${coreTitle}" ${lastName}`;

    searchBooks(query, 1)
      .then((r) => {
        if (cancelled) return;
        setOptions(rankZlibMatches(r, extBook.title, extBook.author));
      })
      .catch((err) => !cancelled && setOptError(err.message || String(err)));

    return () => {
      cancelled = true;
    };
  }, [extBook, isExt]);

  useEffect(() => {
    if (!isExt || !extBook) return;
    let cancelled = false;

    const suppliedDescription = plainText(extBook.description);
    setRemoteDescription(suppliedDescription);
    setGenreLabel(extBook.genre);
    setMetadataError(null);

    const loadMetadata = async () => {
      const needsDetails =
        !suppliedDescription || !extBook.genre || extBook.genre === 'Open Library';
      if (needsDetails && extBook.id.startsWith('/works/')) {
        const details = await getWorkDetails(extBook.id);
        if (cancelled) return;
        if (details.description) setRemoteDescription(plainText(details.description));
        if ((!extBook.genre || extBook.genre === 'Open Library') && details.subjects.length) {
          setGenreLabel(details.subjects.slice(0, 3).join(', '));
        }
      }
    };

    loadMetadata().catch((err) => {
      if (!cancelled) setMetadataError(err.message || String(err));
    });

    return () => {
      cancelled = true;
    };
  }, [extBook, isExt]);

  const currentDiscovery = useMemo<DiscoveryBook | null>(() => {
    if (!extBook) return null;
    return {
      ...extBook,
      description: remoteDescription || extBook.description,
      genre: genreLabel || extBook.genre || 'Other',
    };
  }, [extBook, genreLabel, remoteDescription]);

  const readingListBook = useMemo<LibraryBook | null>(() => {
    if (moonBookParam) {
      return {
        ...moonBookParam,
        ...(currentDiscovery
          ? {
              title: currentDiscovery.title,
              author: currentDiscovery.author,
              cover: currentDiscovery.cover,
              description: currentDiscovery.description,
              year: currentDiscovery.year,
              genre: currentDiscovery.genre,
              rating: currentDiscovery.rating,
              ratingsCount: currentDiscovery.ratingsCount,
              discovery: currentDiscovery,
            }
          : {}),
      };
    }
    if (currentDiscovery) return fromDiscoveryBook(currentDiscovery);
    if (zlibBook) return fromZlibBook(zlibBook);
    if (localBook) return localBook;
    return null;
  }, [currentDiscovery, localBook, moonBookParam, zlibBook]);

  const onReadingList = readingListBook
    ? isOnReadingList(readingListBook.key)
    : false;

  const toggleSaved = useCallback(async () => {
    if (!readingListBook || libraryBusy) return;
    setLibraryBusy(true);
    setLibraryError(null);
    try {
      await toggleReadingList(readingListBook);
    } catch (err: any) {
      setLibraryError(err.message || String(err));
    } finally {
      setLibraryBusy(false);
    }
  }, [libraryBusy, readingListBook, toggleReadingList]);

  const downloadedLibraryBook = useCallback(
    (book: Book): LibraryBook =>
      fromZlibBook(
        book,
        moonBookParam
          ? {
              ...moonBookParam,
              zlib: book,
              discovery: currentDiscovery ?? moonBookParam.discovery,
            }
          : currentDiscovery
          ? {
              title: currentDiscovery.title,
              author: currentDiscovery.author,
              cover: currentDiscovery.cover,
              description: currentDiscovery.description,
              year: currentDiscovery.year,
              genre: currentDiscovery.genre,
              rating: currentDiscovery.rating,
              ratingsCount: currentDiscovery.ratingsCount,
              discovery: currentDiscovery,
            }
          : undefined
      ),
    [currentDiscovery, moonBookParam]
  );

  const downloadFilename = useCallback(
    (book: Book) => {
      const sourceFilename = moonBookParam?.moonReader?.sourceFilename;
      const sourceFormat = sourceFilename?.split('.').pop()?.toLowerCase();
      return sourceFilename && sourceFormat === book.format?.toLowerCase()
        ? sourceFilename
        : bookFilename(book);
    },
    [moonBookParam]
  );

  const setPhase = useCallback((key: string, phase: Phase) => {
    setPhases((prev) => ({ ...prev, [key]: phase }));
  }, []);

  const downloadOption = useCallback(
    async (book: Book) => {
      const key = `${book.id}-${book.hash}`;
      setPhase(key, { kind: 'resolving' });
      try {
        const url = await resolveDownload(book.id, book.hash);
        const headers = await downloadHeaders();
        setPhase(key, { kind: 'downloading', progress: { bytesWritten: 0, totalBytes: 0 } });
        const uri = await downloadBook(
          url,
          downloadFilename(book),
          headers,
          settings.localLibraryLocation,
          (progress) => setPhase(key, { kind: 'downloading', progress })
        );
        setPhase(key, { kind: 'done', uri });
        try {
          await recordDownload(downloadedLibraryBook(book), uri);
        } catch (err: any) {
          setLibraryError(`Downloaded, but Library could not be updated: ${err.message || String(err)}`);
        }
      } catch (err: any) {
        setPhase(key, { kind: 'error', message: err.message || String(err) });
      }
    },
    [
      downloadFilename,
      downloadedLibraryBook,
      recordDownload,
      setPhase,
      settings.localLibraryLocation,
    ]
  );

  // ── single zlib mode ──
  const [phase, setSinglePhase] = useState<Phase>(IDLE);
  const download = useCallback(async () => {
    if (!zlibBook) return;
    setSinglePhase({ kind: 'resolving' });
    try {
      const url = await resolveDownload(zlibBook.id, zlibBook.hash);
      const headers = await downloadHeaders();
      setSinglePhase({ kind: 'downloading', progress: { bytesWritten: 0, totalBytes: 0 } });
      const uri = await downloadBook(
        url,
        bookFilename(zlibBook),
        headers,
        settings.localLibraryLocation,
        (progress) => setSinglePhase({ kind: 'downloading', progress })
      );
      setSinglePhase({ kind: 'done', uri });
      try {
        await recordDownload(downloadedLibraryBook(zlibBook), uri);
      } catch (err: any) {
        setLibraryError(`Downloaded, but Library could not be updated: ${err.message || String(err)}`);
      }
    } catch (err: any) {
      setSinglePhase({ kind: 'error', message: err.message || String(err) });
    }
  }, [downloadedLibraryBook, recordDownload, settings.localLibraryLocation, zlibBook]);

  const runLibraryAction = useCallback(
    async (action: LibraryAction, operation: () => Promise<void>) => {
      setBusyAction(action);
      setLibraryError(null);
      try {
        await operation();
      } catch (err: any) {
        setLibraryError(err.message || String(err));
      } finally {
        setBusyAction(null);
      }
    },
    []
  );

  if (!zlibBook && !extBook && !localBook) {
    return (
      <View className="flex-1 items-center justify-center gap-3" style={{ backgroundColor: '#0b0b0f' }}>
        <Text className="text-sm text-neutral-400">Book details unavailable.</Text>
        <Pressable onPress={goBack}>
          <Text className="text-sm font-semibold text-[#8b7cf6]">Go back</Text>
        </Pressable>
      </View>
    );
  }

  const header = zlibBook ?? extBook ?? localBook!;
  const meta =
    zlibBook
      ? [zlibBook.format?.toUpperCase(), formatSize(zlibBook.size), zlibBook.year, zlibBook.language, zlibBook.publisher].filter(Boolean)
      : extBook
        ? [
            genreLabel || extBook.genre,
            extBook.year,
            moonBookParam
              ? moonBookParam.moonReader?.availableLocally
                ? 'Local file'
                : 'Not stored locally'
              : '',
          ].filter(Boolean)
        : [
            localBook?.format?.toUpperCase(),
            formatSize(localBook?.size ?? 0),
            localBook?.genre !== 'Local' ? localBook?.genre : '',
            localBook?.year,
            typeof localBook?.progress === 'number'
              ? localBook.isRead
                ? 'Read'
                : `${Math.round(localBook.progress)}% read`
              : '',
            'Local file',
          ].filter(Boolean);
  const headerDescription = isExt
    ? remoteDescription
    : zlibBook?.description
      ? plainText(zlibBook.description)
      : localBook?.description
        ? plainText(localBook.description)
        : '';
  const trackedBook = localBook ?? moonBookParam;
  const libraryActionBook = localBook ?? moonBookParam;
  const headerProgress = trackedBook?.isRead ? 100 : trackedBook?.progress;
  const headerCover =
    localBook?.moonReader?.coverUri === header.cover
      ? localBook.moonReader.detailCoverUri || header.cover
      : header.cover || localBook?.moonReader?.detailCoverUri;
  const headerCoverCandidates = [
    headerCover,
    localBook?.fallbackCover,
    localBook?.moonReader?.detailCoverUri,
    localBook?.moonReader?.coverUri,
  ].filter(
    (cover, index, covers): cover is string => !!cover && covers.indexOf(cover) === index
  );
  const activeHeaderCover = headerCoverCandidates.find(
    (cover) => !failedHeaderCovers.includes(cover)
  );
  const coverWidth = compactLayout ? Math.min(180, Math.max(144, width * 0.42)) : 128;
  const coverHeight = Math.round(coverWidth * 1.5);

  const cover = (
    <View
      style={{ width: coverWidth, height: coverHeight }}
      className="rounded-xl overflow-hidden bg-[#232329]"
    >
      {activeHeaderCover ? (
        <Image
          source={{ uri: activeHeaderCover }}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          cachePolicy="memory-disk"
          recyclingKey={activeHeaderCover}
          onError={() =>
            setFailedHeaderCovers((current) =>
              current.includes(activeHeaderCover)
                ? current
                : [...current, activeHeaderCover]
            )
          }
        />
      ) : (
        <View className="flex-1 items-center justify-center">
          <Text className="text-3xl">📚</Text>
        </View>
      )}
      <RatingChip rating={extBook?.rating ?? trackedBook?.rating} />
      {typeof headerProgress === 'number' && headerProgress > 0 && (
        <View className="absolute left-2 right-2 bottom-2 h-1.5 overflow-hidden rounded-full bg-black/70">
          <View
            className="h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(100, headerProgress))}%`,
              backgroundColor: trackedBook?.isRead ? '#059669' : '#8b7cf6',
            }}
          />
        </View>
      )}
    </View>
  );

  const readingListButton = (
    <Pressable
      onPress={toggleSaved}
      disabled={libraryBusy}
      accessibilityRole="button"
      accessibilityLabel={onReadingList ? 'Remove from reading list' : 'Add to reading list'}
      className={
        compactLayout
          ? 'h-11 mt-4 self-stretch rounded-lg flex-row items-center justify-center gap-2 border active:opacity-75 disabled:opacity-60'
          : 'h-9 px-3 rounded-lg flex-row items-center justify-center gap-2 border active:opacity-75 disabled:opacity-60'
      }
      style={{
        backgroundColor: onReadingList ? 'rgba(139,124,246,0.16)' : 'transparent',
        borderColor: onReadingList ? '#8b7cf6' : '#34343d',
      }}
    >
      {libraryBusy ? (
        <ActivityIndicator color="#8b7cf6" size="small" />
      ) : (
        <Feather
          name={onReadingList ? 'bookmark' : 'plus'}
          color={onReadingList ? '#8b7cf6' : '#b4b4bf'}
          size={15}
        />
      )}
      <Text
        className="text-xs font-semibold"
        style={{ color: onReadingList ? '#8b7cf6' : '#d4d4d8' }}
      >
        {onReadingList ? 'In reading list' : 'Add to reading list'}
      </Text>
    </Pressable>
  );

  const descriptionPreview = !!headerDescription ? (
    <Pressable
      onPress={() => setDescriptionOpen(true)}
      accessibilityRole="button"
      accessibilityLabel="Read full description"
      className={
        compactLayout
          ? 'mt-5 active:opacity-75'
          : 'flex-1 mt-3 overflow-hidden active:opacity-75'
      }
    >
      <Text numberOfLines={compactLayout ? 6 : 5} className="text-sm text-neutral-300 leading-5">
        {headerDescription}
      </Text>
    </Pressable>
  ) : isExt && !metadataError ? (
    <View className={compactLayout ? 'mt-5 gap-2' : 'flex-1 mt-4 overflow-hidden gap-2'}>
      <View className="h-2.5 w-full rounded-full bg-[#1b1b22]" />
      <View className="h-2.5 w-[92%] rounded-full bg-[#1b1b22]" />
      <View className="h-2.5 w-[68%] rounded-full bg-[#1b1b22]" />
    </View>
  ) : null;

  return (
    <>
      <ScrollView className="flex-1" style={{ backgroundColor: '#0b0b0f' }} contentContainerClassName="pb-12">
        <View className="h-16 px-4 flex-row items-center gap-3">
          <Pressable
            onPress={goBack}
            accessibilityLabel="Go back"
            accessibilityRole="button"
            className="h-10 w-10 rounded-full items-center justify-center"
            style={{ backgroundColor: '#17171c' }}
          >
            <Feather name="chevron-left" color="#d4d4d8" size={21} />
          </Pressable>
          <Text numberOfLines={1} className="flex-1 text-lg font-semibold text-neutral-100">
            {header.title || 'Untitled'}
          </Text>
        </View>

        {compactLayout ? (
          <View className="px-5 pt-2">
            <View className="items-center">{cover}</View>
            <View className="mt-5">
              {!!header.author && (
                <Text className="text-center text-sm text-neutral-400">{header.author}</Text>
              )}
              {meta.length > 0 && (
                <Text className="mt-2 text-center text-xs uppercase tracking-wide text-neutral-400 leading-4">
                  {meta.join(' · ')}
                </Text>
              )}
              {readingListButton}
              {descriptionPreview}
            </View>
          </View>
        ) : (
          <View className="px-6 pt-2 flex-row gap-5">
            {cover}
            <View className="flex-1 pt-1" style={{ height: coverHeight }}>
              <View className="flex-row items-center justify-between gap-4">
                <View className="flex-1">
                  <Text className="text-sm text-neutral-400">{header.author}</Text>
                  {meta.length > 0 && (
                    <Text className="text-xs uppercase tracking-wide text-neutral-400 mt-2 leading-4">
                      {meta.join(' · ')}
                    </Text>
                  )}
                </View>
                {readingListButton}
              </View>
              {descriptionPreview}
            </View>
          </View>
        )}

      {(metadataError || libraryError || localCatalogError) && (
        <View className="px-6 mt-3 gap-1">
          {!!metadataError && (
            <Text className="text-xs text-red-400 leading-4">
              Open Library metadata failed: {metadataError}
            </Text>
          )}
          {!!libraryError && (
            <Text className="text-xs text-red-400 leading-4">{libraryError}</Text>
          )}
          {!!localCatalogError && (
            <Text className="text-xs text-red-400 leading-4">{localCatalogError}</Text>
          )}
        </View>
      )}

      {/* Single Z-Library download */}
      {!!zlibBook && !isExt && (
        <View className="px-6 mt-8 gap-3">
          {renderSingleButton()}
          {phase.kind === 'error' && (
            <Text className="text-sm text-red-500 text-center px-4">{phase.message}</Text>
          )}
        </View>
      )}

      {!!trackedBook?.moonReader && typeof trackedBook.progress === 'number' && (
        <View className="px-6 mt-8 gap-2">
          <View className="flex-row items-center justify-between gap-4">
            <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400">
              Moon+ Reader progress
            </Text>
            <Text className="text-xs font-semibold text-neutral-300">
              {trackedBook.isRead ? 'Read' : `${Math.round(trackedBook.progress)}%`}
            </Text>
          </View>
          <View className="h-1.5 overflow-hidden rounded-full bg-[#232329]">
            <View
              className="h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, trackedBook.progress))}%`,
                backgroundColor: trackedBook.isRead ? '#059669' : '#8b7cf6',
              }}
            />
          </View>
          <Text className="text-xs text-neutral-500">
            {[
              trackedBook.readingTimeMs
                ? `${Math.round(trackedBook.readingTimeMs / 360000) / 10} hours read`
                : '',
              trackedBook.wordsRead
                ? `${trackedBook.wordsRead.toLocaleString()} words`
                : '',
              trackedBook.lastReadAt
                ? `Last read ${new Date(trackedBook.lastReadAt).toLocaleDateString()}`
                : '',
              `Backup ${new Date(trackedBook.moonReader.syncedAt).toLocaleDateString()}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      )}

      {!!libraryActionBook && (
        <View className="px-6 mt-8 gap-3">
          <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400">
            Library actions
          </Text>
          <LibraryBookActions
            compact
            book={libraryActionBook}
            busyAction={busyAction}
            onOpen={() =>
              void runLibraryAction('open', () => openInMoonReader(libraryActionBook))
            }
            onDelete={() => {
              if (!localBook) return;
              Alert.alert(
                'Delete local file?',
                `This permanently deletes “${localBook.title}” from the selected storage folder.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () =>
                      void runLibraryAction('delete', async () => {
                        await deleteLocalBook(localBook);
                        router.replace('/library');
                      }),
                  },
                ]
              );
            }}
            onMarkRead={() =>
              void runLibraryAction('read', () => markAsRead(libraryActionBook))
            }
            onRefreshMetadata={() =>
              void runLibraryAction('metadata', () => refreshBookMetadata(libraryActionBook))
            }
          />
        </View>
      )}

      {!!localBook?.fileUri && (
        <View className="px-6 mt-8 gap-5">
          <View className="gap-2">
            <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400">
              Stored locally
            </Text>
            <Text numberOfLines={2} className="text-xs leading-4 text-neutral-500">
              {localBook.fileUri}
            </Text>
          </View>
        </View>
      )}

      {/* External recommendation: list of Z-Library download options */}
      {isExt && (
        <View className="px-6 mt-6 gap-3">
          <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400 mt-2">
            Download options on Z-Library
          </Text>

          {options === null && !optError && (
            <View className="flex-row items-center gap-3 py-4">
              <ActivityIndicator color="#8b7cf6" size="small" />
              <Text className="text-sm text-neutral-400">Searching Z-Library…</Text>
            </View>
          )}

          {!!optError && (
            <View className="gap-1">
              <Text className="text-sm text-red-500">{optError}</Text>
              <Text className="text-xs text-neutral-400 leading-4">
                {!settings.email && !settings.remixUserId
                  ? 'Add your Z-Library account in Settings to fetch download options.'
                  : optError.includes('temporarily blocked')
                    ? 'Z-Library has rate-limited new sessions. Wait before retrying, or save current remix keys in Settings.'
                    : 'Check the account and API domain in Settings, then try again.'}
              </Text>
            </View>
          )}

          {options?.length === 0 && (
            <Text className="text-sm text-neutral-400 py-2">
              No matching files found on Z-Library.
            </Text>
          )}

          {options?.map((b) => {
            const key = `${b.id}-${b.hash}`;
            const p = phases[key] ?? IDLE;
            return (
              <OptionRow
                key={key}
                book={b}
                phase={p}
                onDownload={() => downloadOption(b)}
              />
            );
          })}
        </View>
      )}

      </ScrollView>

      <Modal
        visible={descriptionOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDescriptionOpen(false)}
      >
        <Pressable
          onPress={() => setDescriptionOpen(false)}
          className="flex-1 items-center justify-center px-8 py-12"
          style={{ backgroundColor: 'rgba(0,0,0,0.76)' }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            className="w-full rounded-2xl overflow-hidden border border-[#2a2a32]"
            style={{ backgroundColor: '#141419', maxWidth: 720, maxHeight: '80%' }}
          >
            <View className="h-14 px-5 flex-row items-center justify-between border-b border-[#2a2a32]">
              <Text numberOfLines={1} className="flex-1 pr-4 text-base font-semibold text-neutral-100">
                {header.title || 'Description'}
              </Text>
              <Pressable
                onPress={() => setDescriptionOpen(false)}
                accessibilityLabel="Close description"
                accessibilityRole="button"
                className="h-9 w-9 rounded-full items-center justify-center bg-[#202027]"
              >
                <Feather name="x" size={18} color="#d4d4d8" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text className="text-sm leading-6 text-neutral-300">{headerDescription}</Text>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );

  function renderSingleButton() {
    if (phase.kind === 'done') {
      return (
        <View className="h-12 rounded-xl bg-emerald-600 items-center justify-center">
          <Text className="text-white font-semibold">Saved ✓</Text>
        </View>
      );
    }
    if (phase.kind === 'downloading') {
      const pct =
        phase.progress.totalBytes > 0
          ? Math.min(100, Math.round((phase.progress.bytesWritten / phase.progress.totalBytes) * 100))
          : null;
      return (
        <View
        className="h-12 rounded-xl items-center justify-center overflow-hidden"
        style={{ backgroundColor: '#17171c' }}>
          <View
            className="absolute left-0 top-0 bottom-0 bg-[#8b7cf6]/30"
            style={{ width: pct != null ? `${pct}%` : '40%' }}
          />
          <Text className="text-sm font-semibold text-[#8b7cf6] dark:text-rose-300">
            {pct != null ? `${pct}%` : 'Downloading…'}
          </Text>
        </View>
      );
    }
    return (
      <Pressable
        onPress={download}
        disabled={phase.kind === 'resolving'}
        style={{ backgroundColor: '#8b7cf6' }}
        className="h-12 rounded-xl items-center justify-center flex-row gap-2 active:opacity-80 disabled:opacity-60"
      >
        {phase.kind === 'resolving' ? (
          <>
            <ActivityIndicator color="#fff" size="small" />
            <Text className="text-white font-semibold">Resolving link…</Text>
          </>
        ) : (
          <Text className="text-white font-semibold text-base">Download</Text>
        )}
      </Pressable>
    );
  }
}

function OptionRow({
  book,
  phase,
  onDownload,
}: {
  book: Book;
  phase: Phase;
  onDownload: () => void;
}) {
  const meta = [
    book.format?.toUpperCase(),
    formatSize(book.size),
    book.year,
    book.language,
  ].filter(Boolean);

  return (
    <View className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-4 py-3 flex-row items-center gap-3">
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={1} className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {book.title || book.author}
        </Text>
        {meta.length > 0 && (
          <Text className="text-[11px] uppercase tracking-wide text-neutral-400">{meta.join(' · ')}</Text>
        )}
        {phase.kind === 'downloading' && phase.progress.totalBytes > 0 && (
          <Text className="text-[11px] text-rose-500">
            {Math.round((phase.progress.bytesWritten / phase.progress.totalBytes) * 100)}%
          </Text>
        )}
        {phase.kind === 'error' && (
          <Text numberOfLines={2} className="text-[11px] text-red-500">{phase.message}</Text>
        )}
      </View>

      {phase.kind === 'done' ? (
        <Text className="text-emerald-600 dark:text-emerald-400 font-semibold text-sm px-2">✓</Text>
      ) : phase.kind === 'downloading' ? (
        <ActivityIndicator color="#8b7cf6" size="small" />
      ) : phase.kind === 'resolving' ? (
        <ActivityIndicator color="#9ca3af" size="small" />
      ) : (
        <Pressable
          onPress={onDownload}
          className="px-3.5 h-9 rounded-lg items-center justify-center active:opacity-80"
        >
          <Text className="text-white text-xs font-semibold">Get</Text>
        </Pressable>
      )}
    </View>
  );
}
