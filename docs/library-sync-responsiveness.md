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
