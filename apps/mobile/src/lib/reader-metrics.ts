const DEFAULT_READING_TIME_PER_POSITION_MS = 60_000;
const MIN_READING_TIME_PER_POSITION_MS = 15_000;
const MAX_READING_TIME_PER_POSITION_MS = 5 * 60_000;

export interface ReadingSpeedSample {
  readingTimeMs: number;
  positions: number;
  anchor?: { position: number; time: number };
}

// Only completed, consecutive forward intervals teach the estimator. Navigation,
// duplicate events, and time spent away must never shrink the sample denominator.
export function sampleReadingSpeed(
  sample: ReadingSpeedSample,
  position: number | null,
  time: number,
): ReadingSpeedSample {
  if (position == null || !Number.isFinite(position)) {
    return { ...sample, anchor: undefined };
  }
  const anchor = { position, time };
  if (!sample.anchor) return { ...sample, anchor };
  const delta = position - sample.anchor.position;
  const elapsed = time - sample.anchor.time;
  if (delta === 0 && elapsed <= MAX_READING_TIME_PER_POSITION_MS) return sample;
  if (delta <= 0 || delta > 10 || elapsed < 2_000 || elapsed > MAX_READING_TIME_PER_POSITION_MS) {
    return { ...sample, anchor };
  }
  return {
    readingTimeMs: sample.readingTimeMs + elapsed,
    positions: sample.positions + delta,
    anchor,
  };
}

type PositionedLocator = {
  locations?: {
    totalProgression?: number;
  };
};

type SyncLocator = {
  href: string;
  locations?: {
    position?: number;
    progression?: number;
    totalProgression?: number;
  };
};

function sameOptionalLocatorNumber(
  left: number | undefined,
  right: number | undefined,
): boolean {
  if (left == null || right == null) return left == null && right == null;
  return Math.abs(left - right) < 0.000001;
}

export function sameReaderLocator(
  left?: SyncLocator | null,
  right?: SyncLocator | null,
): boolean {
  if (!left || !right) return !left && !right;
  return (
    left.href === right.href &&
    sameOptionalLocatorNumber(
      left.locations?.progression,
      right.locations?.progression,
    )
  );
}

// A saved text offset is laid out at the start of its containing viewport page.
// Keep this tolerance separate from sync equality, which must remain precise.
export function restoredReaderLocator(target: SyncLocator, actual: SyncLocator & {
  locations?: SyncLocator['locations'] & { viewportPosition?: number; viewportPositionCount?: number };
}): boolean {
  if (sameReaderLocator(target, actual)) return true;
  if (target.href !== actual.href) return false;
  const progression = target.locations?.progression;
  const page = actual.locations?.viewportPosition;
  const count = actual.locations?.viewportPositionCount;
  if (progression == null || !page || !count || page > count) return false;
  return progression >= (page - 1) / count - 0.000001 && progression < page / count + 0.000001;
}

export function shouldUploadReaderProgress({
  remoteKnown,
  remoteProgress,
  remoteLocator,
  currentProgress,
  currentLocator,
}: {
  remoteKnown: boolean;
  remoteProgress: number | null;
  remoteLocator?: SyncLocator | null;
  currentProgress: number;
  currentLocator?: SyncLocator | null;
}): boolean {
  if (!remoteKnown || remoteProgress == null) return true;
  return (
    Math.abs(remoteProgress - currentProgress) >= 0.01 ||
    !sameReaderLocator(remoteLocator, currentLocator)
  );
}

export function timeLeftLabel(
  sampledReadingTimeMs: number,
  sampledPositions: number,
  remainingPositions: number,
  progress: number,
): string {
  if (progress >= 100) return 'Finished';
  if (!Number.isFinite(remainingPositions) || remainingPositions <= 0) return 'Time unavailable';

  const sampledTimePerPosition =
    // Blend the existing one-minute baseline with completed samples rather than
    // abruptly switching rates at two positions or resetting after navigation.
    Number.isFinite(sampledPositions) && sampledPositions > 0 &&
    Number.isFinite(sampledReadingTimeMs) && sampledReadingTimeMs > 0
      ? (sampledReadingTimeMs + 20 * DEFAULT_READING_TIME_PER_POSITION_MS) /
        (sampledPositions + 20)
      : DEFAULT_READING_TIME_PER_POSITION_MS;
  const readingTimePerPosition = Math.max(
    MIN_READING_TIME_PER_POSITION_MS,
    Math.min(MAX_READING_TIME_PER_POSITION_MS, sampledTimePerPosition),
  );
  const remainingMinutes = Math.max(
    1,
    Math.ceil((readingTimePerPosition * remainingPositions) / 60_000),
  );
  if (remainingMinutes < 60) return `${remainingMinutes} min left`;

  const days = Math.floor(remainingMinutes / (24 * 60));
  const hours = Math.floor((remainingMinutes % (24 * 60)) / 60);
  const minutes = remainingMinutes % 60;
  if (days) {
    return `${days}d${hours ? ` ${hours}h` : ''}${minutes ? ` ${minutes}m` : ''} left`;
  }
  return `${hours}h${minutes ? ` ${minutes}m` : ''} left`;
}

export function locatorAtProgress<T extends PositionedLocator>(
  positions: T[],
  progress: number,
): T | null {
  if (positions.length === 0) return null;

  const targetProgression = Math.max(0, Math.min(1, progress / 100));
  return positions.reduce((closest, candidate) => {
    const closestProgression = closest.locations?.totalProgression;
    const candidateProgression = candidate.locations?.totalProgression;
    if (candidateProgression == null) return closest;
    if (closestProgression == null) return candidate;
    return Math.abs(candidateProgression - targetProgression) <
      Math.abs(closestProgression - targetProgression)
      ? candidate
      : closest;
  }, positions[0]);
}

export function shouldApplyRemoteProgress(
  remoteProgress: number,
  readerProgress: number | undefined,
): boolean {
  return remoteProgress > (readerProgress ?? 0) + 0.01;
}
