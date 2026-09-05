import assert from 'node:assert/strict';
import { test } from 'node:test';
import { libraryWorkCheckpoint, setLibraryWorkPaused } from '../src/lib/library-work-scheduler';

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

test('background work yields, parks during onboarding, and rechecks a rapid pause after resume', async () => {
  let completed = 0;
  setLibraryWorkPaused(true);
  const jobs = [libraryWorkCheckpoint(), libraryWorkCheckpoint()].map((job) => job.then(() => { completed += 1; }));
  try {
    await nextTurn();
    assert.equal(completed, 0);
    setLibraryWorkPaused(false);
    setLibraryWorkPaused(true);
    await nextTurn();
    assert.equal(completed, 0);
  } finally {
    setLibraryWorkPaused(false);
  }
  await Promise.all(jobs);
  assert.equal(completed, 2);
  let yielded = false;
  const ready = libraryWorkCheckpoint().then(() => { yielded = true; });
  await Promise.resolve();
  assert.equal(yielded, false, 'a microtask is insufficient to yield to rendering');
  await ready;
  assert.equal(yielded, true);
});
