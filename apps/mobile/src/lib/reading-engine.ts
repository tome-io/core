import type { PreferredReadingEngine } from './settings';

export const MOON_READER_EXTENSION_ID = 'community.tomeio.moon-reader';

export type ReadingEngineTarget = PreferredReadingEngine | 'system';

export function chooseReadingEngine({
  preferred,
  tomeioAvailable,
  moonReaderAvailable,
}: {
  preferred: PreferredReadingEngine;
  tomeioAvailable: boolean;
  moonReaderAvailable: boolean;
}): ReadingEngineTarget {
  if (preferred === 'moon-reader' && moonReaderAvailable) return 'moon-reader';
  if (preferred === 'tomeio' && tomeioAvailable) return 'tomeio';
  if (tomeioAvailable) return 'tomeio';
  if (moonReaderAvailable) return 'moon-reader';
  return 'system';
}
