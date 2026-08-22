import * as FileSystem from 'expo-file-system/legacy';
import { deserializeDatabaseAsync } from 'expo-sqlite';
import JSZip from 'jszip';

import type { LibraryBook } from './library';
import type { MoonReaderBackupFile } from './local-library';

interface MoonBookRow {
  book: string | null;
  filename: string;
  author: string | null;
  description: string | null;
  category: string | null;
}

interface MoonStatisticsRow {
  filename: string;
  usedTime: number | null;
  readWords: number | null;
  dates: string | null;
}

interface MoonProgress {
  progress: number;
  lastReadAt?: number;
}

export interface MoonReaderSyncResult {
  books: LibraryBook[];
  warning?: string;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function basename(value: string): string {
  return decodeXml(value).replaceAll('\\', '/').split('/').pop()?.trim().toLowerCase() ?? '';
}

function parseProgress(value: string): number | null {
  const matches = [...value.matchAll(/(-?\d+(?:\.\d+)?)%/g)];
  const raw = matches.at(-1)?.[1];
  if (raw == null) return null;
  return Math.max(0, Math.min(100, Number(raw)));
}

function parsePositions(xml: string): Map<string, MoonProgress> {
  const positions = new Map<string, MoonProgress>();
  for (const match of xml.matchAll(/<string\s+name="([^"]+)">([\s\S]*?)<\/string>/gi)) {
    const progress = parseProgress(decodeXml(match[2]));
    if (progress != null) positions.set(basename(match[1]), { progress });
  }
  return positions;
}

function progressFromStatistics(dates: string | null): MoonProgress | null {
  if (!dates) return null;
  const progress = parseProgress(dates);
  if (progress == null) return null;
  const days = [...dates.matchAll(/(?:^|\n)(\d+)\|/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  const latestDay = days.length ? Math.max(...days) : null;
  return {
    progress,
    lastReadAt: latestDay != null ? latestDay * 24 * 60 * 60 * 1000 : undefined,
  };
}

function cleanCategory(category: string | null): string {
  if (!category) return '';
  return category
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value && value !== '#1#')
    .slice(0, 3)
    .join(', ');
}

function cleanAuthor(author: string | null): string {
  return author?.replace(/;+\s*$/, '').trim() ?? '';
}

function tagForName(zip: JSZip, namesEntry: JSZip.JSZipObject, names: string[], suffix: string) {
  const index = names.findIndex((name) => name.toLowerCase().endsWith(suffix.toLowerCase()));
  if (index < 0) return null;
  const parent = namesEntry.name.split('/').slice(0, -1).join('/');
  return zip.file(`${parent ? `${parent}/` : ''}${index + 1}.tag`);
}

export async function syncMoonReaderLibrary(
  books: LibraryBook[],
  backup: MoonReaderBackupFile
): Promise<MoonReaderSyncResult> {
  const base64 = await FileSystem.readAsStringAsync(backup.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const zip = await JSZip.loadAsync(base64, { base64: true });
  const namesEntry = Object.values(zip.files).find((entry) => entry.name.endsWith('/_names.list'));
  if (!namesEntry) throw new Error('Moon+ Reader backup index is missing.');
  const names = (await namesEntry.async('string')).split(/\r?\n/).filter(Boolean);

  const positionsEntry = tagForName(zip, namesEntry, names, '/shared_prefs/positions10.xml');
  const positions = positionsEntry
    ? parsePositions(await positionsEntry.async('string'))
    : new Map<string, MoonProgress>();

  const databaseEntry = tagForName(zip, namesEntry, names, '/databases/mrbooks.db');
  const bookRows: MoonBookRow[] = [];
  const statisticRows: MoonStatisticsRow[] = [];
  let warning = '';
  if (databaseEntry) {
    try {
      const database = await deserializeDatabaseAsync(await databaseEntry.async('uint8array'), {
        useNewConnection: true,
      });
      try {
        bookRows.push(
          ...(await database.getAllAsync<MoonBookRow>(
            'SELECT book, filename, author, description, category FROM books'
          ))
        );
        statisticRows.push(
          ...(await database.getAllAsync<MoonStatisticsRow>(
            'SELECT filename, usedTime, readWords, dates FROM statistics'
          ))
        );
      } finally {
        await database.closeAsync();
      }
    } catch (err: any) {
      warning = `Moon+ Reader metadata database could not be read: ${err.message || String(err)}`;
    }
  } else {
    warning = 'Moon+ Reader metadata database is missing from its backup.';
  }

  const metadataByFilename = new Map(bookRows.map((row) => [basename(row.filename), row]));
  const statisticsByFilename = new Map(
    statisticRows.map((row) => [basename(row.filename), row])
  );

  const syncedBooks = books.map((book) => {
    if (!book.local) return book;
    const key = book.local.filename.toLowerCase();
    const metadata = metadataByFilename.get(key);
    const statistics = statisticsByFilename.get(key);
    const statisticalProgress = progressFromStatistics(statistics?.dates ?? null);
    const reading = positions.get(key) ?? statisticalProgress;
    const category = cleanCategory(metadata?.category ?? null);
    const author = cleanAuthor(metadata?.author ?? null);
    const title = metadata?.book?.trim() ?? '';
    const description = metadata?.description?.trim() ?? '';

    return {
      ...book,
      title: title || book.title,
      author: author && author !== '(PDF)' ? author : book.author,
      description: description || book.description,
      genre: category || book.genre,
      progress: reading?.progress,
      isRead: reading ? reading.progress >= 99.5 : false,
      readingTimeMs: statistics?.usedTime ?? undefined,
      wordsRead: statistics?.readWords ?? undefined,
      lastReadAt: statisticalProgress?.lastReadAt,
      moonReader: {
        ...book.moonReader,
        syncedAt: backup.modificationTime,
      },
    };
  });

  return { books: syncedBooks, warning: warning || undefined };
}
