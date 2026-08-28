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
