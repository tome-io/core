import { Feather } from '@expo/vector-icons';
import type { BookAcquisition, BookMetadata } from '@readoi/domain';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  LibraryBookActions,
  type LibraryAction,
} from '@/components/library-book-actions';
import { RatingChip } from '@/components/rating-chip';
import { useExtensions } from '@/context/extensions-context';
import { useLibrary } from '@/context/library-context';
import { useSettings } from '@/context/settings-context';
import { bookFilename, downloadBook, type DownloadProgress } from '@/lib/download';
import {
  fromDiscoveryBook,
  fromExtensionBook,
  type LibraryBook,
} from '@/lib/library';
import { loadLocalCatalogBook } from '@/lib/library-db';
import { openInMoonReader } from '@/lib/moon-reader-launcher';
import { getWorkDetails, type DiscoveryBook } from '@/lib/openlibrary';

type Phase =
  | { kind: 'idle' }
  | { kind: 'resolving' }
  | { kind: 'downloading'; progress: DownloadProgress }
  | { kind: 'done'; uri: string }
  | { kind: 'error'; message: string };

interface AcquisitionOption {
  key: string;
  extensionId: string;
  providerName: string;
  book: BookMetadata;
  acquisition: BookAcquisition;
}

const IDLE: Phase = { kind: 'idle' };

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
  const extensions = useExtensions();
  const { acquisitionExtensionId, load: loadExtension } = extensions;
  const { width } = useWindowDimensions();
  const compactLayout = width < 700;
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
  const {
    deleteLocalBook,
    downloaded,
    isOnReadingList,
    markAsRead,
    recordDownload,
    refreshBookMetadata,
    toggleReadingList,
  } = useLibrary();

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
  const [localCatalogError, setLocalCatalogError] = useState<string | null>(null);
  useEffect(() => {
    if (!localParam && !params.localUri) {
      setPersistedLocalBook(null);
      setLocalCatalogError(null);
      return;
    }
    let active = true;
    setLocalCatalogError(null);
    void loadLocalCatalogBook(
      localParam?.key ?? params.id ?? null,
      params.localUri ?? localParam?.local?.uri ?? null
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
      });
    return () => {
      active = false;
    };
  }, [localParam, params.id, params.localUri]);

  const localBook = useMemo(() => {
    if (!localParam && !params.localUri) return null;
    const liveBook = downloaded.find(
      (book) =>
        !!book.local &&
        (book.key === params.id ||
          book.id === params.id ||
          book.key === localParam?.key ||
          book.local.uri === params.localUri ||
          book.local.uri === localParam?.local?.uri)
    );
    if (!persistedLocalBook) return liveBook ?? localParam;
    return {
      ...localParam,
      ...liveBook,
      ...persistedLocalBook,
      cover: persistedLocalBook.cover || liveBook?.cover || localParam?.cover || '',
      description:
        persistedLocalBook.description || liveBook?.description || localParam?.description || '',
      progress: persistedLocalBook.progress ?? liveBook?.progress ?? localParam?.progress,
      isRead: persistedLocalBook.isRead ?? liveBook?.isRead ?? localParam?.isRead,
    };
  }, [downloaded, localParam, params.id, params.localUri, persistedLocalBook]);

  const [remoteDescription, setRemoteDescription] = useState('');
  const [genreLabel, setGenreLabel] = useState('');
  const [metadataError, setMetadataError] = useState<string | null>(null);
  useEffect(() => {
    if (!discoveryBook) return;
    let cancelled = false;
    const suppliedDescription = plainText(discoveryBook.description);
    setRemoteDescription(suppliedDescription);
    setGenreLabel(discoveryBook.genre);
    setMetadataError(null);
    if (
      (!suppliedDescription || !discoveryBook.genre || discoveryBook.genre === 'Open Library') &&
      discoveryBook.id.startsWith('/works/')
    ) {
      getWorkDetails(discoveryBook.id)
        .then((details) => {
          if (cancelled) return;
          if (details.description) setRemoteDescription(plainText(details.description));
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
  }, [discoveryBook]);

  const currentDiscovery = useMemo<DiscoveryBook | null>(() => {
    if (!discoveryBook) return null;
    return {
      ...discoveryBook,
      description: remoteDescription || discoveryBook.description,
      genre: genreLabel || discoveryBook.genre || 'Other',
    };
  }, [discoveryBook, genreLabel, remoteDescription]);

  const [options, setOptions] = useState<AcquisitionOption[] | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  useEffect(() => {
    if (!extensionBook && !currentDiscovery) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setOptions(null);
    setOptionsError(null);

    const loadOptions = async () => {
      if (!acquisitionExtensionId) return [];
      const provider = await loadExtension(acquisitionExtensionId);
      if (!provider.acquisition) {
        throw new Error(`${provider.manifest.name} does not provide downloads.`);
      }
      if (extensionBook && extensionId === acquisitionExtensionId) {
        const acquisitions = await provider.acquisition(extensionBook.id);
        return acquisitions.map((acquisition) => ({
          key: `${acquisitionExtensionId}:${extensionBook.id}:${acquisition.id}`,
          extensionId: acquisitionExtensionId,
          providerName: provider.manifest.name,
          book: extensionBook,
          acquisition,
        }));
      }
      const lookupBook = extensionBook ?? currentDiscovery;
      if (!lookupBook) return [];
      if (!provider.search) {
        throw new Error(
          `${provider.manifest.name} cannot resolve books from another search provider.`
        );
      }
      const page = await provider.search({
        query: `${lookupBook.title} ${
          'authors' in lookupBook ? lookupBook.authors[0] ?? '' : lookupBook.author
        }`.trim(),
        page: 1,
        limit: 8,
      });
      const results = await Promise.all(
        page.items.map(async (book) => ({
          book,
          acquisitions: await provider.acquisition!(book.id),
        }))
      );
      return results.flatMap((result) =>
        result.acquisitions.map((acquisition) => ({
          key: `${acquisitionExtensionId}:${result.book.id}:${acquisition.id}`,
          extensionId: acquisitionExtensionId,
          providerName: provider.manifest.name,
          book: result.book,
          acquisition,
        }))
      );
    };

    loadOptions()
      .then((loaded) => {
        if (!cancelled) setOptions(loaded);
      })
      .catch((cause) => {
        if (!cancelled) {
          setOptionsError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [acquisitionExtensionId, currentDiscovery, extensionBook, extensionId, loadExtension]);

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
    if (currentDiscovery) return fromDiscoveryBook(currentDiscovery);
    return localBook;
  }, [currentDiscovery, extensionBook, extensionId, localBook, moonBook]);

  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<LibraryAction | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [failedCovers, setFailedCovers] = useState<string[]>([]);
  const [phases, setPhases] = useState<Record<string, Phase>>({});
  const onReadingList = readingListBook ? isOnReadingList(readingListBook.key) : false;

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
      const { acquisition, book } = option;
      if (!acquisition.downloadUrl) {
        if (acquisition.openUrl) await Linking.openURL(acquisition.openUrl);
        else {
          setPhases((current) => ({
            ...current,
            [option.key]: {
              kind: 'error',
              message: 'This acquisition has no downloadable or openable URL.',
            },
          }));
        }
        return;
      }
      setPhases((current) => ({ ...current, [option.key]: { kind: 'resolving' } }));
      try {
        const filename = bookFilename({
          title: book.title,
          authors: book.authors,
          format: acquisition.format,
        });
        setPhases((current) => ({
          ...current,
          [option.key]: { kind: 'downloading', progress: { bytesWritten: 0, totalBytes: 0 } },
        }));
        const uri = await downloadBook(
          acquisition.downloadUrl,
          filename,
          acquisition.headers ?? {},
          settings.localLibraryLocation,
          (progress) =>
            setPhases((current) => ({
              ...current,
              [option.key]: { kind: 'downloading', progress },
            }))
        );
        setPhases((current) => ({ ...current, [option.key]: { kind: 'done', uri } }));
        await recordDownload(
          fromExtensionBook(option.extensionId, book, {
            format: acquisition.format,
            size: acquisition.sizeBytes,
            extension: { extensionId: option.extensionId, book, acquisition },
          }),
          uri
        );
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
    [recordDownload, settings.localLibraryLocation]
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

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

  if (!extensionBook && !currentDiscovery && !localBook) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-[#0b0b0f]">
        <Text className="text-sm text-neutral-400">Book details unavailable.</Text>
        <Pressable onPress={goBack}>
          <Text className="text-sm font-semibold text-[#8b7cf6]">Go back</Text>
        </Pressable>
      </View>
    );
  }

  const title = extensionBook?.title || currentDiscovery?.title || localBook?.title || 'Untitled';
  const author =
    extensionBook?.authors[0] || currentDiscovery?.author || localBook?.author || 'Unknown';
  const coverUrl =
    extensionBook?.coverUrl ||
    currentDiscovery?.cover ||
    localBook?.cover ||
    localBook?.fallbackCover ||
    '';
  const description = extensionBook?.description
    ? plainText(extensionBook.description)
    : currentDiscovery?.description
      ? plainText(currentDiscovery.description)
      : localBook?.description
        ? plainText(localBook.description)
        : '';
  const rating = extensionBook?.rating ?? currentDiscovery?.rating ?? localBook?.rating;
  const trackedBook = localBook ?? moonBook;
  const progress = trackedBook?.isRead ? 100 : trackedBook?.progress;
  const meta = extensionBook
    ? [extensionBook.publishedYear, extensionBook.subjects.slice(0, 2).join(', ')].filter(Boolean)
    : currentDiscovery
      ? [genreLabel || currentDiscovery.genre, currentDiscovery.year].filter(Boolean)
      : [
          localBook?.format?.toUpperCase(),
          formatSize(localBook?.size),
          localBook?.year,
          localBook?.isRead
            ? 'Read'
            : localBook?.progress
              ? `${Math.round(localBook.progress)}% read`
              : '',
          'Local file',
        ].filter(Boolean);
  const activeCover = coverUrl && !failedCovers.includes(coverUrl) ? coverUrl : null;
  const coverWidth = compactLayout ? Math.min(180, Math.max(144, width * 0.42)) : 128;
  const coverHeight = Math.round(coverWidth * 1.5);

  const cover = (
    <View
      style={{ width: coverWidth, height: coverHeight }}
      className="rounded-xl overflow-hidden bg-[#232329]"
    >
      {activeCover ? (
        <Image
          source={{ uri: activeCover }}
          style={{ width: '100%', height: '100%' }}
          contentFit="contain"
          cachePolicy="memory-disk"
          onError={() => setFailedCovers((current) => [...current, activeCover])}
        />
      ) : (
        <View className="flex-1 items-center justify-center">
          <Text className="text-3xl">📚</Text>
        </View>
      )}
      <RatingChip rating={rating} />
      {typeof progress === 'number' && progress > 0 ? (
        <View className="absolute left-2 right-2 bottom-2 h-1.5 overflow-hidden rounded-full bg-black/70">
          <View
            className="h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(100, progress))}%`,
              backgroundColor: trackedBook?.isRead ? '#059669' : '#8b7cf6',
            }}
          />
        </View>
      ) : null}
    </View>
  );

  const readingListButton = (
    <Pressable
      onPress={toggleSaved}
      disabled={libraryBusy}
      className={`${compactLayout ? 'h-11 mt-4 self-stretch' : 'h-9 px-3'} rounded-lg flex-row items-center justify-center gap-2 border disabled:opacity-60`}
      style={{
        backgroundColor: onReadingList ? 'rgba(139,124,246,0.16)' : 'transparent',
        borderColor: onReadingList ? '#8b7cf6' : '#34343d',
      }}
    >
      {libraryBusy ? (
        <ActivityIndicator color="#8b7cf6" size="small" />
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
      className={compactLayout ? 'mt-5' : 'flex-1 mt-3 overflow-hidden'}
    >
      <Text numberOfLines={compactLayout ? 6 : 5} className="text-sm text-neutral-300 leading-5">
        {description}
      </Text>
    </Pressable>
  ) : null;

  const libraryActionBook = localBook ?? moonBook;
  return (
    <>
      <ScrollView className="flex-1 bg-[#0b0b0f]" contentContainerClassName="pb-12">
        <View className="h-16 px-4 flex-row items-center gap-3">
          <Pressable
            onPress={goBack}
            className="h-10 w-10 rounded-full bg-[#17171c] items-center justify-center"
          >
            <Feather name="chevron-left" color="#d4d4d8" size={21} />
          </Pressable>
          <Text numberOfLines={1} className="flex-1 text-lg font-semibold text-neutral-100">
            {title}
          </Text>
        </View>

        {compactLayout ? (
          <View className="px-5 pt-2">
            <View className="items-center">{cover}</View>
            <Text className="mt-5 text-center text-sm text-neutral-400">{author}</Text>
            {meta.length ? (
              <Text className="mt-2 text-center text-xs uppercase tracking-wide text-neutral-400">
                {meta.join(' · ')}
              </Text>
            ) : null}
            {readingListButton}
            {descriptionPreview}
          </View>
        ) : (
          <View className="px-6 pt-2 flex-row gap-5">
            {cover}
            <View className="flex-1 pt-1" style={{ height: coverHeight }}>
              <View className="flex-row items-center justify-between gap-4">
                <View className="flex-1">
                  <Text className="text-sm text-neutral-400">{author}</Text>
                  {meta.length ? (
                    <Text className="text-xs uppercase tracking-wide text-neutral-400 mt-2">
                      {meta.join(' · ')}
                    </Text>
                  ) : null}
                </View>
                {readingListButton}
              </View>
              {descriptionPreview}
            </View>
          </View>
        )}

        {metadataError || libraryError || localCatalogError ? (
          <View className="px-6 mt-3 gap-1">
            {metadataError ? <Text className="text-xs text-red-400">{metadataError}</Text> : null}
            {libraryError ? <Text className="text-xs text-red-400">{libraryError}</Text> : null}
            {localCatalogError ? <Text className="text-xs text-red-400">{localCatalogError}</Text> : null}
          </View>
        ) : null}

        {extensionBook || currentDiscovery ? (
          <View className="px-6 mt-8 gap-3">
            <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400">
              Download options
            </Text>
            {options === null && !optionsError ? (
              <View className="flex-row items-center gap-3 py-4">
                <ActivityIndicator color="#8b7cf6" size="small" />
                <Text className="text-sm text-neutral-400">Loading provider options…</Text>
              </View>
            ) : null}
            {optionsError ? <Text className="text-sm text-red-400">{optionsError}</Text> : null}
            {options?.length === 0 ? (
              <Text className="text-sm text-neutral-500">
                No acquisitions were returned by the selected provider.
              </Text>
            ) : null}
            {options?.map((option) => (
              <AcquisitionRow
                key={option.key}
                option={option}
                phase={phases[option.key] ?? IDLE}
                onDownload={() => void downloadOption(option)}
              />
            ))}
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
              onOpen={() => void runLibraryAction('open', () => openInMoonReader(libraryActionBook))}
              onDelete={() => {
                if (!localBook) return;
                Alert.alert('Delete local file?', `This permanently deletes “${localBook.title}”.`, [
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
                ]);
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
              Stored locally
            </Text>
            <Text numberOfLines={2} className="text-xs leading-4 text-neutral-500">
              {localBook.fileUri}
            </Text>
          </View>
        ) : null}
      </ScrollView>

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
            className="w-full rounded-2xl overflow-hidden border border-[#2a2a32] bg-[#141419]"
            style={{ maxWidth: 720, maxHeight: '80%' }}
          >
            <View className="h-14 px-5 flex-row items-center justify-between border-b border-[#2a2a32]">
              <Text numberOfLines={1} className="flex-1 text-base font-semibold text-neutral-100">
                {title}
              </Text>
              <Pressable onPress={() => setDescriptionOpen(false)} className="h-9 w-9 items-center justify-center">
                <Feather name="x" size={18} color="#d4d4d8" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text className="text-sm leading-6 text-neutral-300">{description}</Text>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function AcquisitionRow({
  option,
  phase,
  onDownload,
}: {
  option: AcquisitionOption;
  phase: Phase;
  onDownload: () => void;
}) {
  const { acquisition, book } = option;
  const [coverFailed, setCoverFailed] = useState(false);
  const metadata = [
    acquisition.format?.toUpperCase(),
    formatSize(acquisition.sizeBytes),
    acquisition.language,
    book.publishedYear ? String(book.publishedYear) : '',
    option.providerName,
  ].filter(Boolean);
  const description = book.description ? plainText(book.description) : '';
  const progress =
    phase.kind === 'downloading' && phase.progress.totalBytes > 0
      ? Math.min(100, Math.round((phase.progress.bytesWritten / phase.progress.totalBytes) * 100))
      : null;
  return (
    <View className="rounded-2xl border border-[#292932] p-3 flex-row items-center gap-3 bg-[#111116]">
      <View className="h-[78px] w-[54px] overflow-hidden rounded-lg bg-[#202029] items-center justify-center">
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
        {acquisition.label && acquisition.label.toLocaleLowerCase() !== `download ${acquisition.format}`.toLocaleLowerCase() ? (
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
          <ActivityIndicator color="#8b7cf6" size="small" />
          {progress !== null ? <Text className="text-[10px] text-neutral-400">{progress}%</Text> : null}
        </View>
      ) : (
        <Pressable
          onPress={onDownload}
          className="h-10 rounded-xl bg-[#8b7cf6] px-4 flex-row items-center justify-center gap-2 active:opacity-80"
        >
          <Feather name={acquisition.downloadUrl ? 'download' : 'external-link'} size={15} color="white" />
          <Text className="text-xs font-semibold text-white">
            {acquisition.downloadUrl ? 'Download' : 'Open'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
