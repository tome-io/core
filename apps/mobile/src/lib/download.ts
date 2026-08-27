import * as FileSystem from 'expo-file-system/legacy';

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150);
}

export function bookFilename(book: {
  title: string;
  author?: string;
  authors?: string[];
  format?: string;
}): string {
  const base = [book.title, book.author || book.authors?.[0]].filter(Boolean).join(' - ');
  const ext = book.format ? `.${book.format.toLowerCase()}` : '.bin';
  return sanitize(base || 'book') + ext;
}

export interface DownloadProgress {
  bytesWritten: number;
  totalBytes: number;
}

/**
 * Downloads a resolved URL to the configured location.
 * - If `safDirectoryUri` is set (Android folder picker), downloads to cache then
 *   copies into that folder via the Storage Access Framework.
 * - Otherwise saves into the app's documents/downloads directory.
 * Returns the final file URI.
 */
export async function downloadBook(
  url: string,
  filename: string,
  headers: Record<string, string>,
  safDirectoryUri: string | null,
  onProgress?: (p: DownloadProgress) => void
): Promise<string> {
  const tmpUri = FileSystem.cacheDirectory + filename;

  const resumable = FileSystem.createDownloadResumable(
    url,
    tmpUri,
    { headers },
    (progress) =>
      onProgress?.({
        bytesWritten: progress.totalBytesWritten,
        totalBytes: progress.totalBytesExpectedToWrite ?? 0,
      })
  );

  const result = await resumable.downloadAsync();
  if (!result) throw new Error('Download failed.');

  if (result.status !== 200 && result.status !== 206) {
    await FileSystem.deleteAsync(tmpUri, { idempotent: true });
    throw new Error(`Download failed with status ${result.status}.`);
  }

  // Plain filesystem target: app documents/downloads
  if (!safDirectoryUri) {
    const dir = `${FileSystem.documentDirectory}downloads`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const finalUri = `${dir}/${filename}`;
    if (finalUri !== tmpUri) {
      await FileSystem.moveAsync({ from: tmpUri, to: finalUri });
    }
    return finalUri;
  }

  // Android SAF: create the document inside the user-chosen tree
  const { StorageAccessFramework } = FileSystem;
  const mimeType =
    filename.endsWith('.epub') ? 'application/epub+zip'
    : filename.endsWith('.pdf') ? 'application/pdf'
    : filename.endsWith('.mobi') ? 'application/x-mobipocket-ebook'
    : filename.endsWith('.azw3') ? 'application/vnd.amazon.ebook'
    : 'application/octet-stream';

  let docUri: string | null = null;
  try {
    docUri = await StorageAccessFramework.createFileAsync(safDirectoryUri, filename, mimeType);
    const contents = await FileSystem.readAsStringAsync(tmpUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(docUri, contents, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.deleteAsync(tmpUri, { idempotent: true });
    return docUri;
  } catch (err) {
    await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
    throw err;
  }
}

/** True when the chosen location is an Android SAF content:// tree. */
export function isSafLocation(location: string | null | undefined): boolean {
  return !!location && location.startsWith('content:');
}

export async function pickDownloadFolder(
  initialDirectoryUri?: string | null
): Promise<{ uri: string } | null> {
  const { StorageAccessFramework } = FileSystem;
  const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync(
    initialDirectoryUri ?? null
  );
  if (!permissions.granted) return null;
  return { uri: permissions.directoryUri };
}
