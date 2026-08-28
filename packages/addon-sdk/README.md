# Tomeio Add-on SDK

The public TypeScript authoring layer for Tomeio's capability-based add-on protocol.
Add-ons return book metadata, resolution candidates, acquisitions, progress, and
host-rendered library actions. They do not inject UI or application code.

```ts
import { createAddonHandler, defineAddon } from '@tomeio/addon-sdk';

const addon = defineAddon(
  {
    manifestVersion: 1,
    id: 'dev.example.books',
    version: '1.0.0',
    name: 'Example Books',
    description: 'An example metadata provider.',
    types: ['book'],
    resources: [{ name: 'search', supportsPagination: true }],
    transport: { kind: 'http', baseUrl: 'https://example.com/tomeio' },
    permissions: { hosts: ['https://example.com'] },
  },
  {
    search: async ({ query }) => ({
      items: query
        ? [{ id: '1', title: query, authors: [], subjects: [], identifiers: {} }]
        : [],
    }),
  }
);

export default createAddonHandler(addon);
```

The package deliberately uses the Web `Request`/`Response` API so the same add-on
can run on Bun, Node 22, or serverless platforms without framework coupling.

GitHub-only add-ons use `defineWorkflow` instead. TypeScript is the authoring format;
the checked-in artifact is JSON interpreted by Tomeio's bounded, origin-allowlisted
request and mapping runtime, so the app never downloads executable extension code.

Reviewed reader integrations use `defineDeviceWorkflow`. They publish JSON that combines
fixed capabilities for selected-directory scanning, bounded file/ZIP reads, read-only
SQLite, Android preferences, and allow-listed file-open intents. Reader-specific parsing,
queries, mappings, package ids, and action declarations stay in the extension repository;
Tomeio core provides only the capability interpreter.
