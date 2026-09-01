const DEFAULT_READING_TIME_PER_POSITION_MS = 60_000;
const MIN_READING_TIME_PER_POSITION_MS = 15_000;
const MAX_READING_TIME_PER_POSITION_MS = 5 * 60_000;

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
  if (remainingPositions < 1) return 'Estimating time left';

  const sampledTimePerPosition =
    sampledPositions >= 2 && sampledReadingTimeMs >= 60_000
      ? sampledReadingTimeMs / sampledPositions
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
