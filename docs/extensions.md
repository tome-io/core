# Extensions

Tomeio extensions expose Stremio-style resources specialized for books:

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
repository URL or a direct manifest URL on the Add-ons page. For example:

```text
https://github.com/owner/repository
https://raw.githubusercontent.com/owner/repository/v1.2.0/reado-extension.json
```

A GitHub repository resolves to `reado-extension.json` at its root. Tomeio stores the
manifest snapshot, source URL, enabled state, and install/update timestamps locally.
Official ids cannot be replaced by third-party manifests.

Third-party extensions can be declarative, expose the HTTP resource protocol, or provide an
integrity-checked JavaScript bundle. Script extensions execute in an isolated WebView/iframe with
direct network access disabled. The host exposes scoped configuration, normal storage, secure
storage, and network requests restricted to the HTTPS origins declared by the manifest.

Extension configuration is described by the manifest. Password fields are stored through the
platform secure store; provider credentials and mirror preferences are never application-level
settings. Tomeio selects providers by role in application Settings: one search provider supplies
search results and one download provider resolves those books into available files. Installing an
extension does not automatically assign either role, and results are not combined across multiple
search providers. A download provider must expose both `search` and `acquisition` so it can resolve
books discovered by a different extension.

The public extension collection at [`tomeio/extensions`](https://github.com/tomeio/extensions) is
reserved for reviewed community extensions. The app still requires explicit URL installation;
there is no in-app third-party catalog.

## Third-party Z-Library provider

The Z-Library adapter is not built into Tomeio. It is a manually installed script extension at:

```text
https://github.com/imprisonedmind/tomeio-zlibrary
```

Its account, session, domain, and preferred format are owned by that extension. It can be selected
as the download provider while Open Library remains the search provider. Removing the extension
removes its declared configuration and disconnects it from any assigned provider role.
