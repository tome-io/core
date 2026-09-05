# Provider metadata and synced cover choices

Local enrichment reads EPUB/PDF metadata before querying Open Library for missing details. Embedded title, author, description, year, genre and artwork take precedence. Extension cover fallback runs only when neither local nor catalog artwork is available. Explicit provider cover choices are resolved separately; unrelated cover providers are not queried to enrich every file.

Cover preference and its own timestamp travel with collection sync records. Membership timestamps do not overwrite newer cover choices. Explicit `auto` resets synchronize too. Devices retain unavailable provider preferences and use available artwork until the provider is enabled. Cover URLs and local paths are not synchronized. Logical-book merges preserve the newest preference while each file keeps its own embedded cover.

The service requires `0010_cover_preferences.sql` before deploying the corresponding service code. This is additional to the previously deployed migrations 0008/0009.

## Series audit

- Hardcover's installed resolving workflow exposes `seriesPosition`; automatic enrichment asks it when that field is missing, even when artwork already exists. Its incidental cover is ignored unless it is the selected provider.
- EPUB metadata can supply calibre `series_index`, or EPUB 3 `group-position` refining a collection explicitly marked `series`. Zero and decimal positions are supported. Hierarchical positions such as `2.2.1` cannot be represented by the current numeric model and are not guessed.
- Open Library editions may carry free-text series labels; the current search/work resolver has no structured numeric series position mapping.
- Gutenberg bookshelves represent categories, not series sequence. The current Z-Library workflow has no series-position mapping.
- Google Books exposes `seriesInfo.volumeSeries[].orderNumber`, but the installed Google extension only supports catalog/search/library actions. Adding metadata resolution there is separate extension work; do not query it as though that capability already exists.

Provider results are cached for seven days, with a fifteen-minute retry delay on failure. Changes to installed provider versions or selected cover preference invalidate the cache. The explicit series-capability allowlist currently contains Hardcover only.

## Open Library transport

Discovery and local enrichment share anonymous request pacing (1.1 seconds between starts), a 20-second request timeout, and one retry for network errors, 429, and transient server errors. Long Retry-After responses are surfaced rather than retried early. Feed requests omit bulky search fields; weekly trending uses the positive weekly z-score filter and trending sort.

References: [Open Library limits](https://openlibrary.org/developers/api), [weekly trending query](https://blog.openlibrary.org/2025/08/06/whats-trending-on-open-library/), [EPUB collection metadata](https://www.w3.org/TR/epub-33/), [Google Books volume fields](https://developers.google.com/resources/api-libraries/documentation/books/v1/python/latest/books_v1.volumes.html).
