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
  View,
} from 'react-native';

import { RatingChip } from '@/components/rating-chip';
import { useLibrary } from '@/context/library-context';
import { useSettings } from '@/context/settings-context';
import { bookFilename, downloadBook, type DownloadProgress } from '@/lib/download';
import {
  fromDiscoveryBook,
  fromZlibBook,
  type LibraryBook,
} from '@/lib/library';
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
  const params = useLocalSearchParams<{ id: string; item?: string; ext?: string; local?: string }>();
  const { settings } = useSettings();
  const {
    deleteLocalBook,
    downloaded,
    isOnReadingList,
    recordDownload,
    toggleReadingList,
  } = useLibrary();

  // Three modes:
  //  - zlib: came from the in-app Z-Library search (single known download)
  //  - ext:  came from an external recommendation (Open Library) — we look up
  //          matching Z-Library downloads and offer one button per option.
  //  - local: indexed from the user-selected library folder.
  const zlibBook = useMemo(() => parseParam<Book>(params.item), [params.item]);
  const extBook = useMemo(() => parseParam<DiscoveryBook>(params.ext), [params.ext]);
  const localBookParam = useMemo(() => parseParam<LibraryBook>(params.local), [params.local]);
  const localBook = useMemo(() => {
    if (!localBookParam) return null;
    return (
      downloaded.find(
        (book) =>
          !!book.local &&
          (book.key === params.id ||
            book.id === params.id ||
            book.key === localBookParam.key ||
            book.local.uri === localBookParam.local?.uri)
      ) ?? localBookParam
    );
  }, [downloaded, localBookParam, params.id]);
  const isExt = !!extBook && !zlibBook;

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

  // ── external mode: find download options on Z-Library ──
  const [options, setOptions] = useState<Book[] | null>(null);
  const [optError, setOptError] = useState<string | null>(null);
  const [phases, setPhases] = useState<Record<string, Phase>>({});
  const [description, setDescription] = useState('');
  const [genreLabel, setGenreLabel] = useState('');
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    setDescription(suppliedDescription);
    setGenreLabel(extBook.genre);
    setMetadataError(null);

    const loadMetadata = async () => {
      const needsDetails =
        !suppliedDescription || !extBook.genre || extBook.genre === 'Open Library';
      if (needsDetails && extBook.id.startsWith('/works/')) {
        const details = await getWorkDetails(extBook.id);
        if (cancelled) return;
        if (details.description) setDescription(plainText(details.description));
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
      description: description || extBook.description,
      genre: genreLabel || extBook.genre || 'Other',
    };
  }, [description, extBook, genreLabel]);

  const readingListBook = useMemo<LibraryBook | null>(() => {
    if (currentDiscovery) return fromDiscoveryBook(currentDiscovery);
    if (zlibBook) return fromZlibBook(zlibBook);
    if (localBook) return localBook;
    return null;
  }, [currentDiscovery, localBook, zlibBook]);

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
        currentDiscovery
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
    [currentDiscovery]
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
          bookFilename(book),
          headers,
          settings.downloadLocation,
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
    [downloadedLibraryBook, recordDownload, setPhase, settings.downloadLocation]
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
        settings.downloadLocation,
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
  }, [downloadedLibraryBook, recordDownload, settings.downloadLocation, zlibBook]);

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
        ? [genreLabel || extBook.genre, extBook.year].filter(Boolean)
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
    ? description
    : zlibBook?.description
      ? plainText(zlibBook.description)
      : localBook?.description
        ? plainText(localBook.description)
        : '';
  const headerProgress = localBook?.isRead ? 100 : localBook?.progress;

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

        <View className="px-6 pt-2 flex-row gap-5">
        <View style={{ width: 128, height: 192 }} className="rounded-xl overflow-hidden bg-[#232329]">
          {header.cover ? (
            <Image
              source={{ uri: header.cover }}
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
              recyclingKey={header.cover}
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text className="text-3xl">📚</Text>
            </View>
          )}
          <RatingChip rating={extBook?.rating ?? localBook?.rating} />
          {typeof headerProgress === 'number' && headerProgress > 0 && (
            <View className="absolute left-2 right-2 bottom-2 h-1.5 overflow-hidden rounded-full bg-black/70">
              <View
                className="h-full rounded-full bg-[#8b7cf6]"
                style={{ width: `${Math.max(0, Math.min(100, headerProgress))}%` }}
              />
            </View>
          )}
        </View>
        <View className="flex-1 pt-1" style={{ height: 192 }}>
          <View className="flex-row items-center justify-between gap-4">
            <View className="flex-1">
              <Text className="text-sm text-neutral-400">{header.author}</Text>
              {meta.length > 0 && (
                <Text className="text-xs uppercase tracking-wide text-neutral-400 mt-2 leading-4">
                  {meta.join(' · ')}
                </Text>
              )}
            </View>
            <Pressable
              onPress={toggleSaved}
              disabled={libraryBusy}
              accessibilityRole="button"
              accessibilityLabel={onReadingList ? 'Remove from reading list' : 'Add to reading list'}
              className="h-9 px-3 rounded-lg flex-row items-center justify-center gap-2 border active:opacity-75 disabled:opacity-60"
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
          </View>
          {!!headerDescription && (
            <Pressable
              onPress={() => setDescriptionOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Read full description"
              className="flex-1 mt-3 overflow-hidden active:opacity-75"
            >
              <Text numberOfLines={5} className="text-sm text-neutral-300 leading-5">
                {headerDescription}
              </Text>
            </Pressable>
          )}
          {isExt && !headerDescription && !metadataError && (
            <View className="flex-1 mt-4 gap-2 overflow-hidden">
              <View className="h-2.5 w-full rounded-full bg-[#1b1b22]" />
              <View className="h-2.5 w-[92%] rounded-full bg-[#1b1b22]" />
              <View className="h-2.5 w-[68%] rounded-full bg-[#1b1b22]" />
            </View>
          )}
        </View>
      </View>

      {(metadataError || libraryError) && (
        <View className="px-6 mt-3 gap-1">
          {!!metadataError && (
            <Text className="text-xs text-red-400 leading-4">
              Open Library metadata failed: {metadataError}
            </Text>
          )}
          {!!libraryError && (
            <Text className="text-xs text-red-400 leading-4">{libraryError}</Text>
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

      {!!localBook?.fileUri && (
        <View className="px-6 mt-8 gap-5">
          {localBook.moonReader && typeof localBook.progress === 'number' && (
            <View className="gap-2">
              <View className="flex-row items-center justify-between gap-4">
                <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                  Moon+ Reader progress
                </Text>
                <Text className="text-xs font-semibold text-neutral-300">
                  {localBook.isRead ? 'Read' : `${Math.round(localBook.progress)}%`}
                </Text>
              </View>
              <View className="h-1.5 overflow-hidden rounded-full bg-[#232329]">
                <View
                  className="h-full rounded-full bg-[#8b7cf6]"
                  style={{ width: `${Math.max(0, Math.min(100, localBook.progress))}%` }}
                />
              </View>
              <Text className="text-xs text-neutral-500">
                {[
                  localBook.readingTimeMs
                    ? `${Math.round(localBook.readingTimeMs / 360000) / 10} hours read`
                    : '',
                  localBook.wordsRead ? `${localBook.wordsRead.toLocaleString()} words` : '',
                  localBook.lastReadAt
                    ? `Last read ${new Date(localBook.lastReadAt).toLocaleDateString()}`
                    : '',
                  `Backup ${new Date(localBook.moonReader.syncedAt).toLocaleDateString()}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          )}

          <View className="gap-2">
            <View className="flex-row items-center justify-between gap-4">
              <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                Stored locally
              </Text>
              <Pressable
                onPress={() => {
                  Alert.alert(
                    'Delete source file?',
                    `This permanently deletes “${localBook.title}” from the selected storage folder.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                          setDeleting(true);
                          setLibraryError(null);
                          try {
                            await deleteLocalBook(localBook);
                            router.replace('/library');
                          } catch (err: any) {
                            setLibraryError(err.message || String(err));
                          } finally {
                            setDeleting(false);
                          }
                        },
                      },
                    ]
                  );
                }}
                disabled={deleting}
                accessibilityRole="button"
                accessibilityLabel="Delete source file"
                className="h-9 px-3 rounded-lg flex-row items-center gap-2 border border-red-900/70 active:opacity-75 disabled:opacity-50"
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#f87171" />
                ) : (
                  <Feather name="trash-2" size={14} color="#f87171" />
                )}
                <Text className="text-xs font-semibold text-red-400">Delete file</Text>
              </Pressable>
            </View>
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
                Add your Z-Library account in Settings to fetch download options.
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
