import type { BookAcquisition, BookMetadata } from '@tomeio/domain';
import type { ExtensionPage, ExtensionQuery } from '@tomeio/extension-protocol';

export const ACQUISITION_CANDIDATE_PAGE_SIZE = 3;

export interface AcquisitionSearchProvider {
  search(query: ExtensionQuery): Promise<ExtensionPage<BookMetadata>>;
}

export interface AcquisitionCandidatePage {
  items: BookMetadata[];
  nextPage: number | null;
}

export function acquisitionActionKind(
  acquisition: Pick<BookAcquisition, 'downloadUrl' | 'openUrl'>
): 'download' | 'open' {
  return acquisition.openUrl && !acquisition.downloadUrl ? 'open' : 'download';
}

const DOWNLOAD_FORMAT_PRIORITY: Record<string, number> = {
  epub: 4,
  pdf: 3,
  mobi: 2,
  azw3: 1,
};

export function primaryAcquisition(
  acquisitions: readonly BookAcquisition[]
): BookAcquisition | null {
  return (
    acquisitions
      .filter((acquisition) => acquisition.downloadUrl || acquisition.openUrl)
      .sort((left, right) => {
        const leftDownload = left.downloadUrl ? 1 : 0;
        const rightDownload = right.downloadUrl ? 1 : 0;
        if (leftDownload !== rightDownload) return rightDownload - leftDownload;

        const leftFormat = DOWNLOAD_FORMAT_PRIORITY[left.format.toLocaleLowerCase()] ?? 0;
        const rightFormat = DOWNLOAD_FORMAT_PRIORITY[right.format.toLocaleLowerCase()] ?? 0;
        return rightFormat - leftFormat;
      })[0] ?? null
  );
}

export async function searchAcquisitionCandidatePage(
  provider: AcquisitionSearchProvider,
  query: string,
  page: number
): Promise<AcquisitionCandidatePage> {
  const result = await provider.search({
    query,
    page,
    limit: ACQUISITION_CANDIDATE_PAGE_SIZE,
  });
  return {
    // Extensions are expected to honour the requested limit, but cap locally
    // so a provider cannot return an unbounded candidate page.
    items: result.items.slice(0, ACQUISITION_CANDIDATE_PAGE_SIZE),
    nextPage: result.nextPage ?? null,
  };
}
