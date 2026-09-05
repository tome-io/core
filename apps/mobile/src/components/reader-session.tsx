import { randomUUID } from 'expo-crypto';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { LibraryBook } from '@/lib/library';
import { saveReadingIntervals } from '@/lib/library-db';
import { getHostedSyncAccount, hostedDocumentAliasForBook, synchronizeReadingSessionsIfEnabled } from '@/lib/hosted-sync';
import { readingIntervals } from '@/lib/reading-session-model';

export function ReaderSession({ book, onError }: { book: LibraryBook; onError: (error: unknown) => void }) {
  const bookRef = useRef(book);
  useEffect(() => {
    let disposed = false;
    let recording = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let flush: (() => void) | undefined;
    let writes = Promise.resolve();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        flush?.();
        recording = false;
      }
    });
    void (async () => {
      const currentBook = bookRef.current;
      const [account, alias] = await Promise.all([getHostedSyncAccount(), hostedDocumentAliasForBook(currentBook)]);
      if (disposed) return;
      if (!alias) throw new Error('Cannot associate the reading session with its local book.');
      const session = { sessionId: randomUUID(), accountId: account?.id ?? null,
        bookKey: currentBook.key, document: alias.split(':').at(-1)! };
      let startedAt = Date.now();
      let offset = new Date(startedAt).getTimezoneOffset();
      flush = () => {
        if (!recording) return;
        const now = Date.now();
        const intervals = readingIntervals(session, startedAt, now, offset);
        startedAt = now;
        offset = new Date(now).getTimezoneOffset();
        writes = writes.then(() => saveReadingIntervals(intervals)).catch(onError);
      };
      timer = setInterval(flush, 30_000);
    })().catch(onError);
    return () => {
      disposed = true;
      subscription.remove();
      if (timer) clearInterval(timer);
      flush?.();
      void writes.then(synchronizeReadingSessionsIfEnabled).catch((error) => {
        console.warn('Reading session upload deferred:', error);
      });
    };
  }, [onError]);
  return null;
}
