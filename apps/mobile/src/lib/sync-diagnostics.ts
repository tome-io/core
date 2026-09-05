type Details = Record<string, string | number | boolean>;
let nextStageId = 0;

export function syncDiagnostic(event: string, details: Details = {}): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[sync-timing]', event, details);
  }
}

// Only structural details belong here: never tokens, paths, book names or payloads.
export async function traceSyncStage<T>(
  stage: string,
  operation: () => Promise<T>,
  details: Details = {},
  minimumDurationMs = 0,
): Promise<T> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return operation();
  const stageId = ++nextStageId;
  const started = performance.now();
  const elapsedMs = () => Math.round(performance.now() - started);
  if (minimumDurationMs === 0) syncDiagnostic('start', { ...details, stage, stageId });
  const timer = setInterval(() => {
    syncDiagnostic('waiting', { ...details, stage, stageId, elapsedMs: elapsedMs() });
  }, 10_000);
  try {
    const result = await operation();
    if (elapsedMs() >= minimumDurationMs) syncDiagnostic('done', { ...details, stage, stageId, elapsedMs: elapsedMs() });
    return result;
  } catch (cause) {
    syncDiagnostic('failed', { ...details, stage, stageId, elapsedMs: elapsedMs() });
    throw cause;
  } finally {
    clearInterval(timer);
  }
}
