import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  locatorAtProgress,
  sameReaderLocator,
  sampleReadingSpeed,
  shouldApplyRemoteProgress,
  shouldUploadReaderProgress,
  timeLeftLabel,
} from '../src/lib/reader-metrics';

test('estimates remaining time from publication positions before a reading sample exists', () => {
  assert.equal(timeLeftLabel(0, 0, 227, 0), '3h 47m left');
});

test('formats long estimates as days, hours, and minutes', () => {
  assert.equal(timeLeftLabel(0, 0, 2_000, 12), '1d 9h 20m left');
});

test('blends measured speed without an abrupt threshold change', () => {
  assert.equal(timeLeftLabel(240_000, 2, 10, 25), '11 min left');
});

test('only estimates when publication positions are unavailable', () => {
  assert.equal(timeLeftLabel(120_000, 2, 0, 25), 'Time unavailable');
  assert.equal(timeLeftLabel(120_000, 2, 10, 100), 'Finished');
});

test('maps synced progress to the nearest Readium position', () => {
  const positions = [0, 0.25, 0.5, 0.75, 1].map((totalProgression, index) => ({
    href: `chapter-${index}.xhtml`,
    locations: { totalProgression },
  }));

  assert.equal(locatorAtProgress(positions, 61)?.href, 'chapter-2.xhtml');
  assert.equal(locatorAtProgress(positions, 90)?.href, 'chapter-4.xhtml');
  assert.equal(locatorAtProgress(positions, -10)?.href, 'chapter-0.xhtml');
  assert.equal(locatorAtProgress([], 50), null);
});

test('compares remote progress with the actual reader locator', () => {
  assert.equal(shouldApplyRemoteProgress(6.61, 3.96), true);
  assert.equal(shouldApplyRemoteProgress(6.61, 6.61), false);
  assert.equal(shouldApplyRemoteProgress(6.61, 7), false);
});

test('compares synchronized locators without requiring a local position number', () => {
  const remote = {
    href: 'chapter-2.xhtml',
    locations: { progression: 0.42, totalProgression: 0.0661 },
  };
  const local = {
    ...remote,
    locations: {
      ...remote.locations,
      position: 16,
      totalProgression: 0.06607929515418502,
    },
  };

  assert.equal(sameReaderLocator(remote, local), true);
  assert.equal(
    sameReaderLocator(remote, {
      ...local,
      locations: { ...local.locations, progression: 0.5 },
    }),
    false,
  );
});

test('does not upload an unchanged remote reader position', () => {
  const locator = {
    href: 'chapter-2.xhtml',
    locations: { progression: 0.42, totalProgression: 0.0661 },
  };
  assert.equal(
    shouldUploadReaderProgress({
      remoteKnown: true,
      remoteProgress: 6.61,
      remoteLocator: locator,
      currentProgress: 6.61,
      currentLocator: {
        ...locator,
        locations: { ...locator.locations, position: 16 },
      },
    }),
    false,
  );
  assert.equal(
    shouldUploadReaderProgress({
      remoteKnown: true,
      remoteProgress: 6.61,
      remoteLocator: locator,
      currentProgress: 7.05,
      currentLocator: {
        href: 'chapter-2.xhtml',
        locations: { progression: 0.5, totalProgression: 0.0705 },
      },
    }),
    true,
  );
});


test('backtracking and seeks preserve completed reading samples', () => {
  let sample = sampleReadingSpeed({ readingTimeMs: 0, positions: 0 }, 20, 0);
  sample = sampleReadingSpeed(sample, 21, 60_000);
  sample = sampleReadingSpeed(sample, 20, 120_000);
  sample = sampleReadingSpeed(sample, 200, 180_000);
  assert.equal(sample.positions, 1);
  assert.equal(sample.readingTimeMs, 60_000);
});

test('duplicate locators retain elapsed time while idle and rapid navigation do not teach speed', () => {
  let sample = sampleReadingSpeed({ readingTimeMs: 0, positions: 0 }, 1, 0);
  sample = sampleReadingSpeed(sample, 1, 30_000);
  sample = sampleReadingSpeed(sample, 2, 60_000);
  assert.equal(sample.readingTimeMs, 60_000);
  sample = sampleReadingSpeed(sample, 3, 60_100);
  sample = sampleReadingSpeed(sample, 4, 900_000);
  assert.equal(sample.positions, 1);
});

test('last partial position has an estimate, unavailable data has a terminal label', () => {
  assert.equal(timeLeftLabel(0, 0, 0.2, 99), '1 min left');
  assert.equal(timeLeftLabel(0, 0, Number.NaN, 50), 'Time unavailable');
});
