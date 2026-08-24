# Extensions

Readio extensions expose Stremio-style resources specialized for books:

- `catalog` for discovery rows and paged catalogs;
- `search` for provider search;
- `meta` for book details and enrichment;
- `acquisition` for available downloads or external open actions.

Every extension has a versioned `reado-extension.json`. Official extensions implement
the same contract as third-party extensions but use a `bundled` transport and ship with
the application.

## Official extensions

The initial bundled sources are:

- Open Library for modern discovery and metadata;
- Internet Archive for public records and available files;
- Project Gutenberg for public-domain catalog and downloads.

ManyBooks is not included because it does not currently expose a documented public API
appropriate for a bundled client.

## Third-party installation

There is deliberately no in-app community catalog. A user pastes an HTTPS GitHub
repository URL or a direct manifest URL in Settings. For example:

```text
https://github.com/owner/repository
https://raw.githubusercontent.com/owner/repository/v1.2.0/reado-extension.json
```

A GitHub repository resolves to `reado-extension.json` at its root. Readio stores the
manifest snapshot, source URL, enabled state, and install/update timestamps locally.
Official ids cannot be replaced by third-party manifests.

Third-party extensions can be declarative or expose the HTTP resource protocol. A
script manifest must contain an immutable bundle URL and SHA-256 digest. It is accepted
only on platforms with an explicit sandbox executor; raw TypeScript and unverified
branch-head JavaScript are never executed.

The planned public extension collection should be a separate repository in the
[`readoi`](https://github.com/readoi) organization. It may accept community pull
requests, but the app will still require explicit URL installation unless a catalog is
introduced later.

## Z-Library transition

The current Expo client still contains its established Z-Library adapter so existing
search and downloads are not removed before an integrity-checked mobile script sandbox
exists. It remains the sole provider for the existing search screen. The adapter should
move to a separately installed third-party repository once that sandbox is implemented;
it must not become an official bundled discovery source.
