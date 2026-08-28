# Tomeio extensions

`extensions/official` contains the book-source extensions bundled with Tomeio. Each extension owns
its provider-specific API code and exposes a common set of book resources to the rest of the app.

## Resources

- `catalog(query)` returns discovery rows or paged catalogs.
- `search(query)` returns books matching a query.
- `meta(id)` returns details for a provider book ID.
- `resolve(book)` maps a provider-neutral book reference to provider candidates.
- `acquisition(id)` returns downloadable formats or external open actions.
- `readerSync(request)` imports progress from a reader integration.
- `libraryAction(request)` handles a host-rendered library action.

Search results may include `BookMetadata.acquisitions` when the provider already returned usable
download metadata. Clients use those inline acquisitions directly and call `acquisition(id)` only
when a search result does not include them.

Catalog and search results may also include normalized `BookMetadata.offers`. Tomeio formats and
renders prices, while the provider supplies the seller, regional currency, availability, and HTTPS
purchase link. Provider attribution belongs in the manifest so every client can render it.
Attribution may include an HTTPS `imageUrl` when a provider requires an approved brand asset.

An extension implements only the resources it supports. The declared resources and catalogs live
in its versioned `tomeio-extension.json` manifest.
Provider settings are opt-in through `providerRoles`; exposing a catalog does not automatically
make an add-on a Home discovery provider.

## Official extensions

| Extension | Resources | Purpose |
| --- | --- | --- |
| [Open Library](official/open-library) | `catalog`, `search`, `meta` | Discovery and metadata |
| [Project Gutenberg](official/project-gutenberg) | `catalog`, `search`, `resolve`, `acquisition` | Public-domain catalog and downloads |
| [Internet Archive — Open Books](official/internet-archive) | `catalog`, `search`, `meta`, `resolve`, `acquisition` | Open-book records and available formats |

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
3. The loader calls only the resource requested by the application.
4. The extension maps provider responses to the models in `@tomeio/domain`.

Supported transports are:

- `bundled` for extensions compiled into Tomeio;
- `http` for servers implementing the resource routes;
- `declarative` for GitHub-hosted request and mapping workflows;
- `device` for reviewed GitHub-hosted reader workflows using fixed local capabilities;
- `host` for a reviewed native capability already registered by the client.

Third-party executable scripts are not supported. GitHub-only add-ons should use
`@tomeio/addon-sdk` and the declarative workflow transport; hosted services may use HTTP.

Reviewed community manifests live in `tome-io/extensions`. Unlike official providers,
they are discovered from the published registry and are not installed or enabled by default.
Core contains the generic device-capability interpreter, not reader-specific adapters.

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
