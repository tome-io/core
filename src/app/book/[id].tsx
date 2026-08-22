import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { useSettings } from '@/context/settings-context';
import { bookFilename, downloadBook, type DownloadProgress } from '@/lib/download';
import type { ExternalBook } from '@/lib/books-api';
import { getGoogleRating } from '@/lib/books-api';
import { getWorkDetails } from '@/lib/openlibrary';
import { rankZlibMatches } from '@/lib/match';
import { fetchEbooks } from '@/lib/books-api';
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

function parseParam(json?: string): any | null {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

export default function BookDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; item?: string; ext?: string }>();
  const { settings } = useSettings();

  // Two modes:
  //  - zlib: came from the in-app Z-Library search (single known download)
  //  - ext:  came from an external recommendation (Apple Books) — we look up
  //          matching Z-Library downloads and offer one button per option.
  const zlibBook: Book | null = parseParam(params.item);
  const extBook: ExternalBook | null = parseParam(params.ext);
  const isExt = !!extBook && !zlibBook;

  // ── external mode: find download options on Z-Library ──
  const [options, setOptions] = useState<Book[] | null>(null);
  const [optError, setOptError] = useState<string | null>(null);
  const [phases, setPhases] = useState<Record<string, Phase>>({});
  const [description, setDescription] = useState('');
  const [genreLabel, setGenreLabel] = useState('');
  const [rating, setRating] = useState<{ averageRating?: number; ratingsCount?: number } | null>(null);
  const descRef = useRef(false);

  useEffect(() => {
    if (!isExt || !extBook) return;
    let cancelled = false;

    // Z-Library is a string search engine (no ISBN lookup in eapi), so we
    // query with a quoted core title + author and rank client-side.
    const coreTitle = extBook.title.split(/[:(\u2014]/)[0].trim();
    const lastName = extBook.author.split(' ').slice(-1)[0];
    const query = `"${coreTitle}" ${lastName}`;

    searchBooks(query, 1)
      .then(async (r) => {
        if (cancelled) return;
        setOptions(rankZlibMatches(r, extBook.title, extBook.author));
        if (settings.googleBooksKey) {
          const rating = await getGoogleRating(coreTitle, extBook.author, settings.googleBooksKey);
          if (!cancelled && rating) setRating(rating);
        }
      })
      .catch((err) => !cancelled && setOptError(err.message || String(err)));

    // Description from Open Library work record (we came from an OL work key)
    if (extBook.id.startsWith('/works/')) {
      getWorkDetails(extBook.id).then((d) => {
        if (!cancelled && d?.description) {
          setDescription(d.description.trim());
          if (!extBook.genre || extBook.genre === 'Open Library') {
            setGenreLabel(d.subjects.slice(0, 3).join(', '));
          }
        }
      });
    }
    // Better description fallback via Apple, plus ratings when a key is set
    fetchEbooks(`${coreTitle} ${extBook.author}`, 1).then((appleHits) => {
      if (cancelled) return;
      if (appleHits.length && appleHits[0].description && !descRef.current) {
        descRef.current = true;
        setDescription((prev) => prev || appleHits[0].description);
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExt]);

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
      } catch (err: any) {
        setPhase(key, { kind: 'error', message: err.message || String(err) });
      }
    },
    [setPhase, settings.downloadLocation]
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
    } catch (err: any) {
      setSinglePhase({ kind: 'error', message: err.message || String(err) });
    }
  }, [zlibBook, settings.downloadLocation]);

  if (!zlibBook && !extBook) {
    return (
      <View className="flex-1 items-center justify-center gap-3" style={{ backgroundColor: '#0b0b0f' }}>
        <Text className="text-sm text-neutral-400">Book details unavailable.</Text>
        <Pressable onPress={() => router.back()}>
          <Text className="text-sm font-semibold text-[#8b7cf6]">Go back</Text>
        </Pressable>
      </View>
    );
  }

  const header = zlibBook ?? extBook!;
  const meta =
    zlibBook
      ? [zlibBook.format?.toUpperCase(), formatSize(zlibBook.size), zlibBook.year, zlibBook.language, zlibBook.publisher].filter(Boolean)
      : [extBook!.genre, extBook!.year].filter(Boolean);

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: '#0b0b0f' }} contentContainerClassName="pb-12">
      <Pressable
        onPress={() => router.back()}
        className="mx-4 mt-4 h-10 w-10 rounded-full items-center justify-center"
        style={{ backgroundColor: '#17171c' }}
      >
        <Text className="text-neutral-300 text-xl leading-9">‹</Text>
      </Pressable>
      <View className="px-6 pt-6 flex-row gap-5">
        <View style={{ width: 128, height: 192 }} className="rounded-xl overflow-hidden bg-[#232329]">
          {header.cover ? (
            <Image source={{ uri: header.cover }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text className="text-3xl">📚</Text>
            </View>
          )}
        </View>
        <View className="flex-1 pt-1">
          <Text className="text-lg font-bold text-neutral-900 dark:text-neutral-50 leading-6">
            {header.title || 'Untitled'}
          </Text>
          <Text className="text-sm text-neutral-500 mt-1">{header.author}</Text>
          {meta.length > 0 && (
            <Text className="text-xs uppercase tracking-wide text-neutral-400 mt-2 leading-4">
              {meta.join(' · ')}
            </Text>
          )}
        </View>
      </View>

      {/* Single Z-Library download */}
      {!isExt && (
        <View className="px-6 mt-8 gap-3">
          {renderSingleButton()}
          {phase.kind === 'error' && (
            <Text className="text-sm text-red-500 text-center px-4">{phase.message}</Text>
          )}
        </View>
      )}

      {/* External recommendation: list of Z-Library download options */}
      {isExt && (
        <View className="px-6 mt-6 gap-3">
          {(description || rating) && (
            <View className="rounded-2xl px-4 py-4 gap-3" style={{ backgroundColor: '#141419' }}>
              {!!rating && (
                <Text className="text-sm text-amber-400">
                  {'★'.repeat(Math.round(rating.averageRating ?? 0))}
                  <Text className="text-neutral-400">
                    {' '}{rating.averageRating} · {rating.ratingsCount} ratings
                  </Text>
                </Text>
              )}
              {!!description && (
                <Text className="text-sm text-neutral-300 leading-5">{description}</Text>
              )}
            </View>
          )}
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
                onCancel={() => setPhase(key, IDLE)}
              />
            );
          })}
        </View>
      )}

      {header.description ? (
        <View className="px-6 mt-8">
          <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2">
            Description
          </Text>
          <Text className="text-sm text-neutral-300 leading-5" numberOfLines={14}>
            {header.description.replace(/<[^>]*>/g, '').trim()}
          </Text>
        </View>
      ) : null}
    </ScrollView>
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
  onCancel: () => void;
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
