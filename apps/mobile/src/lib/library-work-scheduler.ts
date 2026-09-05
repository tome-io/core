// Background library work shares the JS runtime with navigation. Yield to the
// event loop between units of work, and park queued work while setup is visible.
let paused = false;
const waiters = new Set<() => void>();

export function setLibraryWorkPaused(value: boolean): void {
  paused = value;
  if (!paused) {
    for (const resume of waiters) resume();
    waiters.clear();
  }
}

export async function libraryWorkCheckpoint(): Promise<void> {
  // Promise.resolve() only yields to microtasks and can still starve rendering.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  while (paused) await new Promise<void>((resolve) => waiters.add(resolve));
}
