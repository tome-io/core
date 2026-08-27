# Tomeio extensions

`extensions/official` contains the book-source extensions bundled with Tomeio. Each extension owns
its provider-specific API code and exposes a common set of book resources to the rest of the app.

## Resources

- `catalog(query)` returns discovery rows or paged catalogs.
- `search(query)` returns books matching a query.
- `meta(id)` returns details for a provider book ID.
- `acquisition(id)` returns downloadable formats or external open actions.

An extension implements only the resources it supports. The declared resources and catalogs live
in its versioned `tomeio-extension.json` manifest.

## Official extensions

| Extension | Resources | Purpose |
| --- | --- | --- |
| [Open Library](official/open-library) | `catalog`, `search`, `meta` | Discovery and metadata |
| [Project Gutenberg](official/project-gutenberg) | `catalog`, `search`, `acquisition` | Public-domain catalog and downloads |
| [Internet Archive — Open Books](official/internet-archive) | `catalog`, `search`, `meta`, `acquisition` | Open-book records and available formats |

## Structure

```text
official/provider-name/
├── package.json
├── tomeio-extension.json
├── src/index.ts
└── test/
```

Each package exports:

- an `ExtensionManifest` describing its resources, catalogs, transport, and network hosts;
- a factory that accepts its HTTP dependencies for testing;
- a default `BookExtension` instance for the application registry.

`packages/official-extensions` imports the default instances and exposes the bundled registry to
the mobile and desktop clients.

## How extension loading works

1. `@tomeio/extension-protocol` validates the manifest.
2. `@tomeio/extension-runtime` selects a loader from the manifest transport.
3. The loader calls the requested `catalog`, `search`, `meta`, or `acquisition` resource.
4. The extension maps provider responses to the models in `@tomeio/domain`.

Supported transports are:

- `bundled` for extensions compiled into Tomeio;
- `http` for servers implementing the resource routes;
- `declarative` for manifest-defined endpoint templates;
- `script` for SHA-256-pinned JavaScript bundles executed by a platform sandbox.

## Adding an official extension

1. Create a workspace under `extensions/official/<provider>`.
2. Add a valid `tomeio-extension.json` and matching exported manifest.
3. Implement a `BookExtension` using the shared domain types.
4. Add focused tests for mapping, pagination, empty responses, and provider failures.
5. Register the default instance in `packages/official-extensions`.

Use `@tomeio/sources` for the shared JSON client and cache primitives. Keep raw provider response
types inside the extension package rather than exposing them to application code.

## Testing

From the repository root:

```bash
bun test
bun typecheck
```

Providers with live integration tests expose a `test:live` script in their package. These tests
contact the provider API and are separate from the normal workspace test command.
