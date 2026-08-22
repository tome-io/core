import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { bookFilename, downloadBook, type DownloadProgress } from '@/lib/download';
import { useSettings } from '@/context/settings-context';
import { downloadHeaders, resolveDownload, type Book } from '@/lib/zlib';

type Phase =
  | { kind: 'idle' }
  | { kind: 'resolving' }
  | { kind: 'downloading'; progress: DownloadProgress }
  | { kind: 'done'; uri: string }
  | { kind: 'error'; message: string };

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

export default function BookDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; item: string }>();
  const { settings } = useSettings();

  const book: Book | null = (() => {
    try {
      return JSON.parse(params.item ?? '') as Book;
    } catch {
      return null;
    }
  })();

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const download = useCallback(async () => {
    if (!book) return;
    setPhase({ kind: 'resolving' });
    try {
      const url = await resolveDownload(book.id, book.hash);
      const headers = await downloadHeaders();
      setPhase({ kind: 'downloading', progress: { bytesWritten: 0, totalBytes: 0 } });
      const uri = await downloadBook(
        url,
        bookFilename(book),
        headers,
        settings.downloadLocation,
        (progress) => setPhase({ kind: 'downloading', progress })
      );
      setPhase({ kind: 'done', uri });
    } catch (err: any) {
      setPhase({ kind: 'error', message: err.message || String(err) });
    }
  }, [book, settings.downloadLocation]);

  if (!book) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950 items-center justify-center gap-3">
        <Text className="text-sm text-neutral-400">Book details unavailable.</Text>
        <Pressable onPress={() => router.back()}>
          <Text className="text-sm font-semibold text-rose-600">Go back</Text>
        </Pressable>
      </View>
    );
  }

  const pct =
    phase.kind === 'downloading' && phase.progress.totalBytes > 0
      ? Math.min(100, Math.round((phase.progress.bytesWritten / phase.progress.totalBytes) * 100))
      : null;

  const meta = [
    book.format?.toUpperCase(),
    formatSize(book.size),
    book.year,
    book.language,
    book.publisher,
  ].filter(Boolean);

  return (
    <ScrollView className="flex-1 bg-white dark:bg-neutral-950" contentContainerClassName="pb-12">
      <View className="px-6 pt-24 flex-row gap-5">
        <View style={{ width: 128, height: 192 }} className="rounded-xl overflow-hidden bg-neutral-200 dark:bg-neutral-800">
          {book.cover ? (
            <Image source={{ uri: book.cover }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text className="text-3xl">📚</Text>
            </View>
          )}
        </View>
        <View className="flex-1 pt-1">
          <Text className="text-lg font-bold text-neutral-900 dark:text-neutral-50 leading-6">
            {book.title || 'Untitled'}
          </Text>
          <Text className="text-sm text-neutral-500 mt-1">{book.author}</Text>
          {meta.length > 0 && (
            <Text className="text-xs uppercase tracking-wide text-neutral-400 mt-2 leading-4">
              {meta.join(' · ')}
            </Text>
          )}
        </View>
      </View>

      {/* Download button */}
      <View className="px-6 mt-8 gap-3">
        {phase.kind === 'done' ? (
          <View className="h-12 rounded-xl bg-emerald-600 items-center justify-center">
            <Text className="text-white font-semibold">Saved ✓</Text>
          </View>
        ) : phase.kind === 'downloading' ? (
          <View className="gap-2">
            <View className="h-12 rounded-xl bg-neutral-100 dark:bg-neutral-800 items-center justify-center overflow-hidden">
              <View
                className="absolute left-0 top-0 bottom-0 bg-rose-600/30"
                style={{ width: pct != null ? `${pct}%` : '40%' }}
              />
              <Text className="text-sm font-semibold text-rose-600 dark:text-rose-300">
                {pct != null ? `${pct}%` : 'Downloading…'}
              </Text>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={download}
            disabled={phase.kind === 'resolving'}
            className="h-12 rounded-xl bg-rose-600 items-center justify-center flex-row gap-2 active:bg-rose-700 disabled:opacity-60"
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
        )}

        {phase.kind === 'error' && (
          <Text className="text-sm text-red-500 text-center px-4">{phase.message}</Text>
        )}
      </View>

      {book.description ? (
        <View className="px-6 mt-8">
          <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2">
            Description
          </Text>
          <Text className="text-sm text-neutral-700 dark:text-neutral-300 leading-5">
            {book.description.replace(/<[^>]*>/g, '').trim()}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
