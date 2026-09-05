export interface ReadingInterval {
  id: string;
  sessionId: string;
  accountId: string | null;
  bookKey: string;
  document: string;
  startedAt: number;
  endedAt: number;
  timezoneOffsetMinutes: number;
}

export function readingIntervals(
  session: Pick<ReadingInterval, 'sessionId' | 'accountId' | 'bookKey' | 'document'>,
  startedAt: number,
  endedAt: number,
  timezoneOffsetMinutes: number,
): ReadingInterval[] {
  // A delayed heartbeat cannot establish whether the reader stayed active.
  if (endedAt <= startedAt || endedAt - startedAt > 60_000) return [];
  const intervals: ReadingInterval[] = [];
  let start = startedAt;
  while (start < endedAt) {
    const nextMidnight = (Math.floor((start - timezoneOffsetMinutes * 60_000) / 86_400_000) + 1) *
      86_400_000 + timezoneOffsetMinutes * 60_000;
    const end = Math.min(endedAt, nextMidnight);
    intervals.push({ ...session, id: `${session.sessionId}-${start}`, startedAt: start,
      endedAt: end, timezoneOffsetMinutes });
    start = end;
  }
  return intervals;
}
