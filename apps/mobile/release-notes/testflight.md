# TestFlight release notes

## Writing rules

- Keep **What's new** consumer-facing and limited to visible changes.
- Give testers two to four specific, reproducible things to test.
- Use plain language and short bullets; avoid implementation details and issue numbers.
- Mention known issues only when they affect testing.
- Update both sections for every uploaded build.

## What's new

- Read EPUB and PDF books directly inside Tomeio.
- Synchronize library state and reading progress across signed-in devices.
- Choose Tomeio or Moon+ Reader as the reading engine on Android.
- Improved tablet layouts, search, downloads, and local library reliability.

## What to test

- Open an EPUB or PDF, change pages, leave the reader, and confirm it resumes correctly.
- Read the same book on two signed-in devices and confirm the furthest position wins.
- On Android, switch between Tomeio and Moon+ Reader in Settings.
- Check the book overview and two-page reader layout on a tablet in landscape.
