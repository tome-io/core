# TestFlight release notes

## Writing rules

- Keep **What's new** consumer-facing and limited to visible changes.
- Give testers two to four specific, reproducible things to test.
- Use plain language and short bullets; avoid implementation details and issue numbers.
- Mention known issues only when they affect testing.
- Update both sections for every uploaded build.

## What's new

- A fresh welcome with guided setup for book sources, folders, and optional sync.
- Keep one library entry for matching editions, with reading progress and cover choices shared across devices.
- Read with steadier time-left estimates, clearer page counts, and a screen that stays awake.
- Browse by genre with supported sources and discover improved series details.
- Enjoy smoother library refreshes with fewer unnecessary syncs.
- Connect the Pagebound community extension to browse your shelves and discover books, ratings, and reviews with reader avatars.
- Book lists appear before missing ratings finish loading, and reviews avoid repeated loading as book details arrive.
- Stay signed in to Pagebound between visits, with automatic sign-in recovery when your saved session is no longer valid.
- Download and review sections stay hidden when a source has no results.

## What to test

- Install or update Pagebound to 0.1.4, enter your Pagebound email and password, and select it for discovery. Browse a populated shelf and open a book with written reviews. Check that books appear before ratings finish loading, review avatars appear, and reviews stay visible as book details arrive.
- Close and reopen Tomeio, then browse Pagebound shelves and reviews again. Confirm your account still works without re-entering credentials. Disable and re-enable the extension, then verify it can sign in again. If you have another Pagebound account, switch credentials and confirm only that account's shelves appear.
- Try Hardcover and Pagebound separately, then enable both and open a book from each source. Check the review attribution. For a book with no downloads or reviews, confirm the empty section is hidden; a failed request should still show an error and retry option.
- Check the earlier reader and sync changes: on a fresh install complete or skip setup; on two signed-in devices add matching EPUBs and verify one library entry, shared progress, and cover preference. Reopen a book after reading several chapters and check saved position, page counts, time-left estimates, and that the screen stays awake.
