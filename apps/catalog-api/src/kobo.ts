import {
  AddonProtocolError,
  defineAddon,
  type BookMetadata,
  type ExtensionPage,
  type ExtensionQuery,
} from '@tomeio/addon-sdk';

const EBOOK_SEARCH_URL =
  'https://openapi.rakuten.co.jp/services/api/Kobo/EbookSearch/20170426';
const MAX_HITS = 30;

export interface KoboEnvironment {
  RAKUTEN_APPLICATION_ID?: string;
  RAKUTEN_ACCESS_KEY?: string;
  RAKUTEN_AFFILIATE_ID?: string;
}

export type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

interface KoboItem {
  title?: string;
  subTitle?: string;
  seriesName?: string;
  author?: string;
  publisherName?: string;
  itemNumber?: string;
  itemCaption?: string;
  salesDate?: string;
  itemPrice?: number;
  itemUrl?: string;
  affiliateUrl?: string;
  largeImageUrl?: string;
  mediumImageUrl?: string;
  reviewCount?: number;
  reviewAverage?: number;
  koboGenreId?: string;
  salesType?: number;
}

interface KoboSearchResponse {
  page?: number;
  pageCount?: number;
  items?: KoboItem[];
  Items?: Array<KoboItem | { Item?: KoboItem; item?: KoboItem }>;
}

const CATALOG_SORTS: Record<string, string> = {
  recommended: 'standard',
  'new-releases': '-releaseDate',
  popular: 'reviewCount',
  'top-rated': 'reviewAverage',
};

function configuredCredentials(environment: KoboEnvironment): {
  applicationId: string;
  accessKey: string;
  affiliateId?: string;
} {
  const applicationId = environment.RAKUTEN_APPLICATION_ID?.trim();
  const accessKey = environment.RAKUTEN_ACCESS_KEY?.trim();
  if (!applicationId || !accessKey) {
    throw new AddonProtocolError(
      'Rakuten credentials have not been configured for the catalog service.',
      503
    );
  }
  const affiliateId = environment.RAKUTEN_AFFILIATE_ID?.trim();
  return { applicationId, accessKey, ...(affiliateId ? { affiliateId } : {}) };
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function publishedYear(value: string | undefined): number | undefined {
  const match = value?.match(/^(\d{4})/);
  return match ? Number(match[1]) : undefined;
}

function mapItem(item: KoboItem): BookMetadata | null {
  const id = item.itemNumber?.trim();
  const title = item.title?.trim();
  if (!id || !title) return null;

  const author = item.author?.trim();
  const price = finiteNumber(item.itemPrice);
  const rating = finiteNumber(item.reviewAverage);
  const ratingsCount = finiteNumber(item.reviewCount);
  const purchaseUrl = item.affiliateUrl?.trim() || item.itemUrl?.trim();

  return {
    id,
    title,
    authors: author ? [author] : [],
    description: item.itemCaption?.trim() || undefined,
    coverUrl: item.largeImageUrl?.trim() || item.mediumImageUrl?.trim() || undefined,
    publishedYear: publishedYear(item.salesDate),
    subjects: [],
    identifiers: { kobo: id },
    rating: rating != null && rating >= 0 && rating <= 5 ? rating : undefined,
    ratingsCount:
      ratingsCount != null && ratingsCount >= 0 ? Math.trunc(ratingsCount) : undefined,
    infoUrl: item.itemUrl?.trim() || undefined,
    offers: purchaseUrl
      ? [
          {
            provider: 'Rakuten Kobo',
            availability:
              item.salesType === 1 ? 'preorder' : price === 0 ? 'free' : 'for-sale',
            country: 'JP',
            price: price != null && price >= 0 ? { amount: price, currency: 'JPY' } : undefined,
            url: purchaseUrl,
          },
        ]
      : undefined,
  };
}

function errorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const description = (value as { error_description?: unknown }).error_description;
  return typeof description === 'string' && description.trim() ? description : undefined;
}

export function createKoboAddon(
  environment: KoboEnvironment,
  fetchFn: FetchFunction = (input, init) => fetch(input, init)
) {
  const requestPage = async (
    query: ExtensionQuery,
    providerParameters: Record<string, string>
  ): Promise<ExtensionPage<BookMetadata>> => {
    const credentials = configuredCredentials(environment);
    const page = Math.min(100, Math.max(1, query.page ?? 1));
    const hits = Math.min(MAX_HITS, Math.max(1, query.limit ?? MAX_HITS));
    const parameters = new URLSearchParams({
      applicationId: credentials.applicationId,
      format: 'json',
      formatVersion: '2',
      hits: String(hits),
      page: String(page),
      ...providerParameters,
    });
    if (credentials.affiliateId) parameters.set('affiliateId', credentials.affiliateId);
    if (query.language?.trim()) parameters.set('language', query.language.trim());

    const response = await fetchFn(`${EBOOK_SEARCH_URL}?${parameters}`, {
      headers: {
        Accept: 'application/json',
        accessKey: credentials.accessKey,
      },
      redirect: 'error',
    });
    if (response.status === 404) return { items: [] };

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = errorMessage(body);
      const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
      throw new AddonProtocolError(
        `Rakuten Kobo request failed (${response.status})${detail ? `: ${detail}` : '.'}`,
        status
      );
    }

    if (!body || typeof body !== 'object') {
      throw new AddonProtocolError('Rakuten Kobo returned an invalid response.', 502);
    }
    const result = body as KoboSearchResponse;
    const rawItems = Array.isArray(result.items)
      ? result.items
      : Array.isArray(result.Items)
        ? result.Items.map((candidate): KoboItem => {
            const wrapped = candidate as { Item?: KoboItem; item?: KoboItem };
            return wrapped.Item ?? wrapped.item ?? (candidate as KoboItem);
          })
        : [];
    const items = rawItems
      .map(mapItem)
      .filter((item): item is BookMetadata => item != null);
    const currentPage = finiteNumber(result.page) ?? page;
    const pageCount = finiteNumber(result.pageCount);
    const hasMore = pageCount != null ? currentPage < pageCount : items.length >= hits;
    return {
      items,
      nextPage: hasMore && page < 100 ? page + 1 : undefined,
    };
  };

  return defineAddon(
    {
      manifestVersion: 1,
      id: 'org.tomeio.kobo-store',
      version: '0.1.0',
      name: 'Rakuten Kobo',
      description: 'Search and discover ebooks available from Rakuten Kobo.',
      author: 'Tomeio',
      homepage: 'https://tomeio.app',
      types: ['book'],
      resources: [
        { name: 'catalog', supportsPagination: true },
        { name: 'search', supportsPagination: true },
        { name: 'meta' },
      ],
      providerRoles: ['discovery', 'search'],
      catalogs: [
        { id: 'recommended', name: 'Recommended', resource: 'catalog' },
        { id: 'new-releases', name: 'New releases', resource: 'catalog' },
        { id: 'popular', name: 'Popular', resource: 'catalog' },
        { id: 'top-rated', name: 'Top rated', resource: 'catalog' },
      ],
      attribution: {
        label: 'Book data supplied by Rakuten Kobo',
        url: 'https://books.rakuten.co.jp/e-book/',
      },
      transport: { kind: 'http', baseUrl: 'https://catalog.tomeio.app' },
      permissions: { hosts: ['https://catalog.tomeio.app'] },
    },
    {
      search: (query) => {
        const keyword = query.query?.trim() ?? '';
        if (!keyword) return Promise.resolve({ items: [] });
        if ([...keyword].length < 2) {
          throw new AddonProtocolError('Search queries must contain at least two characters.');
        }
        return requestPage(query, { keyword });
      },
      catalog: (query) => {
        const catalogId = query.catalogId ?? 'recommended';
        const sort = CATALOG_SORTS[catalogId];
        if (!sort) throw new AddonProtocolError(`Unknown catalog "${catalogId}".`, 404);
        return requestPage(query, { koboGenreId: '101', sort });
      },
      meta: async (id) => {
        const normalizedId = id.trim();
        if (!normalizedId) throw new AddonProtocolError('A Kobo item number is required.');
        const result = await requestPage({ page: 1, limit: 1 }, { itemNumber: normalizedId });
        return result.items.find((item) => item.id === normalizedId) ?? result.items[0] ?? null;
      },
    }
  );
}
