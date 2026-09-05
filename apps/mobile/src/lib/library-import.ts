import { publicationAliases } from '@tomeio/domain';
import * as DocumentPicker from "expo-document-picker";
import type {
  ExtensionLibraryImport,
  ExtensionReaderBook,
  ExtensionReaderSyncResult,
} from "@tomeio/extension-protocol";

import { bookIdentity } from "./book-metadata";
import {
  applyCollectionSyncRecords,
  applyProgressSyncRecords,
  loadCollectionSyncRecords,
  loadProgressSyncRecords,
} from "./library-db";
import {
  mergeCollectionSyncRecords,
  type CollectionSyncRecord,
} from "./library-sync-model";
import {
  mergeProgressRecords,
  type ProgressSyncRecord,
} from "./progress-sync-model";

export interface LibraryImportFile {
  uri: string;
  name: string;
  updatedAt: number;
}

export interface LibraryImportPreview {
  extensionId: string;
  extensionName: string;
  importId: string;
  importTitle: string;
  name: string;
  libraryRecords: CollectionSyncRecord[];
  records: ProgressSyncRecord[];
  warnings: string[];
}

export interface LibraryImportResult {
  books: number;
  progressRecords: number;
  updated: number;
}

function normalizedFilename(value: string | undefined): string {
  if (!value) return "";
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Reader backups may contain opaque document-provider paths.
  }
  return decoded.replaceAll("\\", "/").split("/").filter(Boolean).at(-1)?.trim().toLowerCase() ?? "";
}

function records(result: ExtensionReaderSyncResult): ExtensionReaderBook[] {
  if (result.books) return result.books;
  return result.progress.map((progress, index) => ({
    ...progress.book,
    sourceId: progress.book.id ?? `${progress.book.title}:${index}`,
    progress: progress.progress,
    isRead: progress.isRead,
    readingTimeMs: progress.readingTimeMs,
    wordsRead: progress.wordsRead,
    lastReadAt: progress.lastReadAt,
  }));
}

function syncAliases(book: ExtensionReaderBook, author: string, format: string): string[] {
  const filename = normalizedFilename(book.sourceFilename || book.sourcePath || book.sourceId);
  return [
    `identity:${bookIdentity(book.title, author, format)}`,
    ...publicationAliases(book.title, book.authors, book.identifiers),
    filename ? `filename:${filename}` : "",
    ...Object.entries(book.identifiers).map(
      ([kind, value]) => `identifier:${kind.toLowerCase()}:${value.toLowerCase()}`,
    ),
  ].filter(Boolean);
}

function collectionRecord(
  book: ExtensionReaderBook,
  fallbackUpdatedAt: number,
): CollectionSyncRecord {
  const author = book.authors[0]?.trim() || "Unknown";
  const filename = normalizedFilename(book.sourceFilename || book.sourcePath || book.sourceId);
  const format = (book.format || filename.split(".").at(-1) || "").toUpperCase();
  const updatedAt = book.lastReadAt ?? book.addedAt ?? fallbackUpdatedAt;
  return {
    identity: bookIdentity(book.title, author),
    aliases: syncAliases(book, author, format),
    title: book.title,
    author,
    format,
    addedAt: book.addedAt ?? fallbackUpdatedAt,
    sortAt: updatedAt,
    updatedAt,
  };
}

function progressRecord(
  book: ExtensionReaderBook,
  fallbackUpdatedAt: number,
): ProgressSyncRecord | null {
  if (
    book.progress == null &&
    book.isRead !== true &&
    (book.readingTimeMs ?? 0) <= 0 &&
    (book.wordsRead ?? 0) <= 0
  ) {
    return null;
  }
  const collection = collectionRecord(book, fallbackUpdatedAt);
  const isRead = book.isRead ?? (book.progress ?? 0) >= 99.5;
  return {
    identity: collection.identity,
    aliases: collection.aliases,
    title: collection.title,
    author: collection.author,
    format: collection.format,
    progress: isRead ? 100 : Math.max(0, Math.min(100, book.progress ?? 0)),
    isRead,
    ...(book.readingTimeMs == null ? {} : { readingTimeMs: Math.max(0, book.readingTimeMs) }),
    ...(book.wordsRead == null ? {} : { wordsRead: Math.max(0, book.wordsRead) }),
    ...(book.lastReadAt == null ? {} : { lastReadAt: book.lastReadAt }),
    updatedAt: book.lastReadAt ?? book.addedAt ?? fallbackUpdatedAt,
  };
}

export async function pickLibraryImportFile(
  libraryImport: ExtensionLibraryImport,
): Promise<LibraryImportFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: libraryImport.mimeTypes?.length ? libraryImport.mimeTypes : "*/*",
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) throw new Error("The file picker returned no backup file.");
  const extension = asset.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (!libraryImport.fileExtensions.includes(extension)) {
    throw new Error(
      `Choose a ${libraryImport.fileExtensions.map((value) => `.${value}`).join(" or ")} file.`,
    );
  }
  return {
    uri: asset.uri,
    name: asset.name,
    updatedAt: asset.lastModified || Date.now(),
  };
}

export function createLibraryImportPreview(
  extensionId: string,
  extensionName: string,
  importId: string,
  importTitle: string,
  file: LibraryImportFile,
  result: ExtensionReaderSyncResult,
): LibraryImportPreview {
  const importedBooks = records(result);
  if (!importedBooks.length) {
    throw new Error(`No books were found in ${file.name}.`);
  }
  return {
    extensionId,
    extensionName,
    importId,
    importTitle,
    name: file.name,
    libraryRecords: mergeCollectionSyncRecords(
      importedBooks.map((book) => collectionRecord(book, file.updatedAt)),
    ),
    records: mergeProgressRecords(
      importedBooks.flatMap((book) => {
        const record = progressRecord(book, file.updatedAt);
        return record ? [record] : [];
      }),
    ),
    warnings: result.warnings ?? [],
  };
}

export async function importLibraryBackup(
  preview: LibraryImportPreview,
): Promise<LibraryImportResult> {
  const [libraryRecords, progressRecords] = await Promise.all([
    loadCollectionSyncRecords("library"),
    loadProgressSyncRecords(),
  ]);
  const libraryUpdated = await applyCollectionSyncRecords(
    "library",
    mergeCollectionSyncRecords(libraryRecords, preview.libraryRecords),
  );
  const progressUpdated = await applyProgressSyncRecords(
    mergeProgressRecords(progressRecords, preview.records),
  );
  return {
    books: preview.libraryRecords.length,
    progressRecords: preview.records.length,
    updated: libraryUpdated + progressUpdated,
  };
}
