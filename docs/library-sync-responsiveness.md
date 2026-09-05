# Library sync responsiveness

Code inspection found automatic initial/configuration/foreground sync running
while onboarding was visible, plus a forced library refresh after onboarding
sign-in. Hiding the activity toast did not stop that work.

The root now disables automatic scans and mirror triggers on the entry route and
throughout onboarding (including extensions). Successful sign-in updates account
state; leaving onboarding starts the normal library refresh. Existing background
work parks at a checkpoint and resumes when onboarding closes. Already-running
native requests or parser chunks can finish; this is cooperative pausing, not
transaction cancellation. No checkpoints are added inside SQLite transactions.

Promises do not move JavaScript to a worker. Two concrete blocking paths were
removed: whole-book base64 decoding before EPUB/PDF parsing, and synchronous
FileHandle seeks/reads while calculating KOReader's partial MD5. Metadata now
uses the installed Expo native asynchronous binary-file API. Hashing uses native
asynchronous range reads at the same KOReader sample offsets; only up to 1 KiB is
decoded per sample. PDF parsing yields every 20 objects. Scanning, mirroring,
metadata batches and full hosted-sync loops yield through a timer rather than
merely adding more promise microtasks.

This does not put the entire sync pipeline on a separate JS runtime. ZIP directory
parsing, decompression, PDF object parsing and record merges still involve JS.
Remaining long frames need device profiling before choosing a native parser or a
worker runtime. No freeze duration or improvement was measured in this change.

Validation: mobile typecheck, scoped ESLint and diff checks passed. Scheduler
regression coverage was added but tests were not run. No builds, simulator/app
execution or runtime profiling ran. No native rebuild is needed.

Device review: launch onboarding with an existing large library; change folders,
visit extensions, background/foreground the app, sign in and finish. Confirm no
new automatic passes start during setup and refresh resumes after exit. Outside
setup, scroll/navigate while syncing large EPUBs and PDFs, and compare KOReader
fingerprints/progress against existing files. Run the scheduler and existing
KOReader fingerprint regression tests.

## Timing diagnostics and refresh cost

Development builds emit `[sync-timing]` start/done/failed events with `stageId`, duration, and a `waiting` heartbeat every ten seconds. Refresh phases include `runId`. No tokens, book titles, local paths or request payloads are included.

- `local.load-catalogs`, `local.index`, `local.scan-files`, `local.reconcile`: disk/database work.
- `reader-addon.sync`: reader extension communication.
- `hosted.serial-queue` and `hosted.dequeued.queueMs`: time behind another sync operation.
- `hosted.request`: authenticated request duration by route family and method, including session refresh if needed.
- `hosted.local-identifiers`, `hosted.hash-file`, `hosted.hash-summary`: file materialization/hashing versus cached hashes.
- `hosted.reading-sessions`: interval backlog count and upload concurrency.
- `refresh.foreground-finished`: foreground refresh duration. Background metadata continues independently.
- `refresh.enrichment`, `enrichment.dequeued.queueMs`, `local.candidates`, `reader.candidates`, `local.epub-parse`, `local.provider-only`, `local.persist`: enrichment queue, candidate counts and work timings.
- `[source-timing]`: upstream queue wait, rate-limit pacing, network time and response status. Open Library remains limited to one anonymous request start per 1.1 seconds. Start slots release independently of responses, allowing slow in-flight requests to overlap rather than serializing them.

Ordinary pull-to-refresh now uses hosted cursors/version checks, rather than forcing a full progress download. The explicit full-pull option remains available to existing repair callers. The native refresh indicator follows the foreground scanning state.

Provider-only refreshes no longer reparse EPUBs or rerun catalog enrichment for fresh metadata. Result replacement uses a map and one final array pass, avoiding quadratic array rebuilding. Superseded enrichment stops between batches, rather than delaying the next refresh through the entire previous library.

File hashes are reused within the app session only when URI, size and a positive modification timestamp match; unknown timestamps force rehashing. Cache entries are bounded to 256 and rejected hashes are evicted. Reading-session uploads use the existing concurrency limit of four instead of serial round trips (up to 100 pending intervals per pass).

Network writes still scale with changed records because the current service API accepts individual records. First-time metadata enrichment also scales with books missing metadata. This change does not claim constant-time full-library synchronization; the timings distinguish those expected costs from redundant work. No new device trace was captured during implementation: use the next development refresh's timing output to measure the actual bottleneck on-device.

## Unchanged writes and reader-only sync

The supplied September 5 trace spent 21.082 seconds in hosted sync versus 334 ms indexing and 87 ms enrichment. Reader close sent one targeted progress record; the subsequent full-library pass began after the development-client reload, not reader disposal.

Upload fingerprints now compare canonical content: object/alias order, top-level event timestamps, local sync identity bookkeeping and an implicit automatic-cover default cannot independently dirty a record. Actual progress, locators, reading statistics, explicit cover choices, removals and publication aliases remain significant. Checkpoint payload version 2 performs one full remote metadata read when upgrading old acknowledgements, allowing equivalent remote records to be acknowledged rather than blindly reuploaded. This does not change targeted reader entry/exit into a full-library sync.

When chapter locators exist on both sides, reader exit compares those rather than mixing furthest-read or rendition-dependent percentages with the current position. Without a known remote state, an unchanged first observed location also skips the write. New session intervals still upload independently. A valid saved locator is used at startup instead of first navigating to the catalog's furthest percentage and then back to the remote locator.
