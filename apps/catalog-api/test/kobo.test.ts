import { describe, expect, test } from 'bun:test';

import { createKoboAddon } from '../src/kobo';

const environment = {
  RAKUTEN_APPLICATION_ID: 'test-app',
  RAKUTEN_ACCESS_KEY: 'test-key',
  RAKUTEN_AFFILIATE_ID: 'test-affiliate',
};

describe('Kobo catalog adapter', () => {
  test('normalizes search results and keeps credentials server-side', async () => {
    let requestedUrl = '';
    let requestedAccessKey = '';
    const addon = createKoboAddon(environment, async (input, init) => {
      requestedUrl = String(input);
      requestedAccessKey = new Headers(init?.headers).get('accessKey') ?? '';
      return Response.json({
        page: 1,
        pageCount: 2,
        items: [
          {
            title: 'Example Book',
            author: 'Example Author',
            itemNumber: 'example-1',
            itemCaption: 'Description',
            salesDate: '2026年08月31日',
            itemPrice: 1200,
            itemUrl: 'https://books.rakuten.co.jp/example',
            affiliateUrl: 'https://affiliate.example/book',
            largeImageUrl: 'https://thumbnail.image.rakuten.co.jp/example.jpg',
            reviewCount: 12,
            reviewAverage: 4.5,
            salesType: 0,
          },
        ],
      });
    });

    const result = await addon.search?.({ query: 'Example', page: 1, limit: 20 });

    expect(result).toEqual({
      items: [
        {
          id: 'example-1',
          title: 'Example Book',
          authors: ['Example Author'],
          description: 'Description',
          coverUrl: 'https://thumbnail.image.rakuten.co.jp/example.jpg',
          publishedYear: 2026,
          subjects: [],
          identifiers: { kobo: 'example-1' },
          rating: 4.5,
          ratingsCount: 12,
          infoUrl: 'https://books.rakuten.co.jp/example',
          offers: [
            {
              provider: 'Rakuten Kobo',
              availability: 'for-sale',
              country: 'JP',
              price: { amount: 1200, currency: 'JPY' },
              url: 'https://affiliate.example/book',
            },
          ],
        },
      ],
      nextPage: 2,
    });
    expect(requestedUrl).toContain('applicationId=test-app');
    expect(requestedUrl).toContain('affiliateId=test-affiliate');
    expect(requestedUrl).not.toContain('test-key');
    expect(requestedAccessKey).toBe('test-key');
  });

  test('fails clearly until Rakuten credentials are configured', async () => {
    const addon = createKoboAddon({});
    await expect(addon.search?.({ query: 'Example' })).rejects.toThrow(
      'Rakuten credentials have not been configured'
    );
  });

  test('accepts Rakuten legacy-capitalized item envelopes', async () => {
    const addon = createKoboAddon(environment, async () =>
      Response.json({
        page: 1,
        pageCount: 1,
        Items: [
          {
            Item: {
              title: 'Legacy Envelope',
              author: 'Example Author',
              itemNumber: 'legacy-1',
              itemPrice: 500,
              itemUrl: 'https://books.rakuten.co.jp/legacy',
            },
          },
        ],
      })
    );

    const result = await addon.search?.({ query: 'Legacy' });

    expect(result?.items[0]?.title).toBe('Legacy Envelope');
  });
});
