# Hosted sync

Hosted sync is optional and is Tomeio's cross-device library, reading-list, and
reading-progress mechanism. The
service implementation lives in `tome-io/sync`; this repository owns the app client,
local merge, secure session storage, and KOReader-compatible book hashing.

## App behavior

- Users can use Tomeio without creating an account.
- New sync accounts confirm their email with a six-digit code before a session is
  created. The same dialog can resend confirmation codes and reset a forgotten password.
- Android and iOS store only access and refresh tokens in Expo SecureStore.
- Web does not offer account sync because this client does not downgrade secrets to
  unencrypted browser storage.
- Drive, iCloud, and user-selected folders remain book-file storage and import locations.
  They are not parallel library or progress-sync transports.
- Signed-in devices synchronize during library refresh, when the app returns to the
  foreground, and after progress-changing library actions. Manual **Sync now** remains
  available for explicit control and troubleshooting.

The service origin defaults to `https://sync.tomeio.app`. A development build can set
`EXPO_PUBLIC_SYNC_URL` to a staging Worker origin.

## Book matching

For local files, Tomeio reproduces KOReader's partial-MD5 sampling algorithm and sends
that digest as the primary document identifier. It also sends a hash of Tomeio's logical
book identity as an alias. A device without the local file can therefore resolve the
same account-scoped book after another Tomeio device registers the file digest.

The service stores no book file bytes. It deduplicates shared title, author, and format
metadata in a global row keyed by the fingerprint. Per-account library membership,
reading-list membership, and reading progress remain private. Every Tomeio library item
is synchronized, including unread books with no progress. A device without the file gets
an unavailable-local entry and must still obtain the file before opening it.

The current client maps an incoming KOReader update by percentage. Exact CREngine
XPointer-to-EPUB-locator conversion remains a later interoperability stage.

## Kindle setup

After the Worker is deployed and registration is enabled:

1. Create and verify a Tomeio Sync account in the app.
2. In KOReader, open **Progress sync** and set the custom server to
   `https://sync.tomeio.app`.
3. Sign in with the same email and password.
4. Keep KOReader's binary checksum mode enabled.
5. Enable **Send document metadata** so books first seen in KOReader can appear in
   Tomeio's library.

No Tomeio KOReader plugin is required for progress sync.

## Kobo setup

Install the **Kobo eReader** community add-on, sign in to Tomeio Sync, and open its
setup action under **Settings → Sync**. Tomeio generates a private endpoint. Connect
the Kobo to a computer, edit `.kobo/Kobo/Kobo eReader.conf`, and set
`[OneStoreServices] api_endpoint` to that endpoint before restarting the reader.

The adapter synchronizes EPUB library metadata and reading progress through Kobo's
built-in sync client. It does not upload EPUBs, PDFs, or covers. Because Kobo models
custom-library entries as downloadable entitlements, metadata-only titles may appear
unavailable on the reader. Official Kobo Store requests continue through the proxy by
default.

## Moon+ Reader setup

Moon+ Reader uses the same Tomeio Sync account through its built-in WebDAV support:

1. In Moon+ Reader, enable WebDAV reading-position sync.
2. Enter `https://sync.tomeio.app` as the WebDAV server.
3. Enter the same Tomeio email and password.
4. Keep Moon+'s book-file/shelf upload disabled; Tomeio's endpoint accepts position
   `.po` files only and never stores EPUB or PDF bytes.

Moon+ filenames are private, account-scoped aliases. Tomeio sends the local filename
alongside its content fingerprint so identical filenames link automatically. Exact
title/author matches may link renamed files; ambiguous matches remain unlinked rather
than creating a false merge. ISBNs are supporting publication metadata, not file keys.

Existing Moon+ users who install and enable the Moon+ Reader add-on can select a local
`.mrpro` backup from **Settings → Sync → Import Moon+ Reader backup**. The reviewed add-on
workflow reads the backup locally, and Tomeio previews matched
and unmatched books, imports the complete backup catalog plus any normalized progress
and reading statistics, and then uses the same hosted-sync reconciliation path. The
backup and book files are never uploaded.
