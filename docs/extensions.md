# Add-ons

Tomeio add-ons are capability providers. The app owns navigation, UI, downloads,
storage, credentials, permissions, and native APIs; an add-on can only return data
or request one of the host operations described by the protocol.

The TypeScript authoring package is `@tomeio/addon-sdk`. Its independent source is
`tome-io/addon-sdk`; `packages/addon-sdk` is the in-tree compatibility copy used by
Tomeio itself.

## Resources

- `catalog`: browsable and paginated collections;
- `search`: title, author, and identifier search;
- `meta`: details for a provider-owned id;
- `resolve`: provider-neutral handoff from a discovered book to provider candidates;
- `acquisition`: downloadable or externally openable editions for a provider-owned id;
- `reader`: imported reading progress from a reader integration;
- `libraryAction`: host-rendered actions on library and detail screens.

`resolve` receives a book reference containing title, authors, year, and all known
identifiers. Download providers should implement it instead of making Tomeio guess a
search string. `search` remains a compatibility fallback during migration.

Acquisition responses are data only. Tomeio decides how to present an option and owns
the download. Add-ons cannot render download links, buttons, or dialogs.

## Library actions

An add-on declares its action title, icon, placements, supported platforms, formats,
and whether a local file is required. Tomeio filters and renders those actions. When
selected, the host calls the add-on's `libraryAction` handler.

Remote add-ons receive book metadata, the active platform, and local-file availability/format,
but never a local file URI or filename. They may return `openLocalFile` with a package declared
in `permissions.androidPackages`; Tomeio validates the package and performs the handoff itself.
Reviewed device workflows may additionally receive the selected local file and invoke a narrowly
registered device capability. This is how the Moon+ Reader add-on contributes “Open in Moon+
Reader”, while the Google Books add-on can hand EPUB/PDF files to Google Play Books and fall back
to an HTTPS Google Books page when no compatible local file exists.

## Transports and trust

- `declarative`: a GitHub-hosted, JSON-only request and mapping workflow interpreted by Tomeio;
- `device`: a reviewed GitHub-hosted JSON workflow using fixed local-device primitives;
- `http`: an optional hosted TypeScript (or any-language) implementation of the protocol;
- `host`: a reviewed, named native capability shipped by a Tomeio client;
- `bundled`: first-party providers shipped and always available in a client.

Executable `script` add-ons are rejected. SHA-256 verification proves which script was
downloaded but does not make arbitrary code an appropriate application boundary. GitHub-only
add-ons use `@tomeio/addon-sdk` to author a declarative `workflow.json`; Tomeio permits only
bounded requests to manifest-approved HTTPS origins and fixed response transformations.

Remote manifests must declare every permitted HTTPS origin. Configuration is scoped to
the add-on; password values remain in secure storage and are sent only to the add-on's
protocol endpoint. The host never silently replaces a failed response with fabricated
metadata or acquisitions.

## Official, community, and third-party

Official add-ons are bundled sources such as Open Library, Internet Archive, and Project
Gutenberg. They implement the same handlers as external add-ons.

Community add-ons are reviewed entries shown under the Community filter. Installing an
entry creates a normal local installation and may require configuration before it can be
enabled. Moon+ Reader is the first community entry. Its manifest and full parsing/action
workflow live in `tome-io/extensions`; core provides only the generic reviewed operations.
Those operations are inactive until the user installs and configures the add-on.

Third-party add-ons are installed from a trusted HTTPS GitHub repository or direct
manifest URL and are not listed in community discovery. A repository resolves to
`tomeio-extension.json` at its root. Third-party manifests may use only HTTP or
declarative transports; installing one does not assign it as a search or download
provider.

Device workflows are community-only because local storage and Android package access
need capability review. Adding a reader integration consists of:

1. declaring `reader` and, optionally, `libraryAction` resources;
2. defining required directory settings, device capabilities, and Android packages;
3. publishing a `device-workflow.json` built with `defineDeviceWorkflow`;
4. mapping the reader's data into normalized books and progress;
5. submitting the manifest and requested capabilities to `tome-io/extensions`.

## Z-Library migration

`imprisonedmind/tomeio-zlibrary` publishes a TypeScript-authored declarative workflow:

1. use `defineWorkflow` from `@tomeio/addon-sdk`;
2. expose `search`, `resolve`, and `acquisition` through bounded request graphs;
3. substitute scoped account configuration only into approved Z-Library requests;
4. return normalized book and acquisition objects only;
5. publish `workflow.json` beside its manifest on GitHub.

This keeps authentication, mirror fallback, and provider parsing inside the constrained
host runtime while keeping credentials scoped to the installed add-on.
