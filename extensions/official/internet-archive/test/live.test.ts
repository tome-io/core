import { expect, test } from 'bun:test';

import { createInternetArchiveExtension } from '../src';

const extension = createInternetArchiveExtension({ timeoutMs: 20_000 });

test('live policy permits an open licensed item from a trusted collection', async () => {
  const acquisitions = await extension.acquisition!('modernanalyseso368amor');
  expect(acquisitions.some((item) => item.format === 'pdf' && item.downloadUrl)).toBe(true);
});

test('live policy does not trust a Community Texts license declaration by itself', async () => {
  const acquisitions = await extension.acquisition!('model-stories-book-one');
  expect(acquisitions).toHaveLength(1);
  expect(acquisitions[0]?.label).toBe('View on Internet Archive');
  expect(acquisitions[0]?.downloadUrl).toBeUndefined();
  expect(acquisitions[0]?.openUrl).toBe(
    'https://archive.org/details/model-stories-book-one'
  );
});
