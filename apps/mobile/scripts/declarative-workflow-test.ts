import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  ExtensionDeviceWorkflowDefinition,
  ExtensionManifest,
  ExtensionWorkflowDefinition,
} from '@tomeio/extension-protocol';
import {
  ExtensionLoader,
  parseDeviceWorkflowDefinition,
} from '@tomeio/extension-runtime';

const manifest: ExtensionManifest = {
  manifestVersion: 1,
  id: 'community.example.declarative',
  version: '1.0.0',
  name: 'Declarative example',
  description: 'Exercises the safe workflow runtime.',
  types: ['book'],
  resources: [{ name: 'search' }],
  transport: {
    kind: 'declarative',
    definitionUrl: 'https://raw.githubusercontent.com/example/addon/main/workflow.json',
  },
  permissions: {
    hosts: ['https://raw.githubusercontent.com', 'https://books.example.com'],
  },
};

const definition: ExtensionWorkflowDefinition = {
  workflowVersion: 1,
  resources: {
    search: {
      steps: [
        {
          id: 'search',
          request: {
            urls: 'https://books.example.com/search',
            query: { q: { $op: 'path', path: 'input.query' } },
            headers: { Authorization: { $op: 'path', path: 'config.token' } },
          },
        },
      ],
      output: {
        items: {
          $op: 'map',
          value: { $op: 'path', path: 'steps.search.body.items' },
          as: 'item',
          values: [
            {
              id: { $op: 'string', value: { $op: 'path', path: 'item.id' } },
              title: { $op: 'path', path: 'item.title' },
              authors: [],
              subjects: [],
              identifiers: {},
            },
          ],
        },
      },
    },
  },
};

test('executes an allowlisted declarative search without loading code', async () => {
  const requests: Request[] = [];
  const loader = new ExtensionLoader({
    bundled: new Map(),
    fetchFn: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.includes('raw.githubusercontent.com')) {
        return Response.json(definition);
      }
      return Response.json({ items: [{ id: 7, title: 'Dune' }] });
    },
  });
  const extension = await loader.load(manifest, { token: 'scoped-secret' });
  const page = await extension.search?.({ query: 'dune' });

  assert.equal(page?.items[0]?.id, '7');
  assert.equal(requests[1]?.headers.get('Authorization'), 'scoped-secret');
  assert.match(requests[1]?.url ?? '', /q=dune/);
});

test('rejects workflow requests to undeclared origins', async () => {
  const unsafeDefinition: ExtensionWorkflowDefinition = {
    workflowVersion: 1,
    resources: {
      search: {
        steps: [{ id: 'search', request: { urls: 'https://evil.example/search' } }],
        output: { items: [] },
      },
    },
  };
  const loader = new ExtensionLoader({
    bundled: new Map(),
    fetchFn: async (input) =>
      String(input).includes('raw.githubusercontent.com')
        ? Response.json(unsafeDefinition)
        : Response.json({ items: [] }),
  });
  const extension = await loader.load(manifest);

  await assert.rejects(() => extension.search!({ query: 'dune' }), /undeclared origin/);
});

test('surfaces a declarative provider error message without exposing request details', async () => {
  const loader = new ExtensionLoader({
    bundled: new Map(),
    fetchFn: async (input) =>
      String(input).includes('raw.githubusercontent.com')
        ? Response.json(definition)
        : Response.json(
            { error: { message: 'The configured API key cannot use this service.' } },
            { status: 403 }
          ),
  });
  const extension = await loader.load(manifest, { token: 'scoped-secret' });

  await assert.rejects(
    () => extension.search!({ query: 'dune' }),
    /HTTP 403: The configured API key cannot use this service\./
  );
});

test('preserves the useful provider error when later mirrors return invalid responses', async () => {
  const mirrorManifest: ExtensionManifest = {
    ...manifest,
    permissions: {
      hosts: [
        'https://raw.githubusercontent.com',
        'https://primary.example.com',
        'https://mirror-one.example.com',
        'https://mirror-two.example.com',
        'https://mirror-three.example.com',
      ],
    },
  };
  const mirrorDefinition: ExtensionWorkflowDefinition = {
    workflowVersion: 1,
    resources: {
      search: {
        steps: [
          {
            id: 'search',
            request: {
              urls: [
                'https://primary.example.com/search',
                'https://mirror-one.example.com/search',
                'https://mirror-two.example.com/search',
                'https://mirror-three.example.com/search',
              ],
            },
          },
        ],
        output: { items: [] },
      },
    },
  };
  const loader = new ExtensionLoader({
    bundled: new Map(),
    fetchFn: async (input) => {
      const url = String(input);
      if (url.includes('raw.githubusercontent.com')) {
        return Response.json(mirrorDefinition);
      }
      if (url.includes('primary.example.com')) {
        return Response.json(
          { error: 'Incorrect email or password' },
          { status: 400 }
        );
      }
      return new Response('<html>Unavailable</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    },
  });
  const extension = await loader.load(mirrorManifest);

  await assert.rejects(
    () => extension.search!({ query: 'dune' }),
    /HTTP 400: Incorrect email or password/
  );
});

test('retries a transient declarative GET failure', async () => {
  let providerAttempts = 0;
  const loader = new ExtensionLoader({
    bundled: new Map(),
    fetchFn: async (input) => {
      if (String(input).includes('raw.githubusercontent.com')) return Response.json(definition);
      providerAttempts += 1;
      return providerAttempts === 1
        ? Response.json({ error: { message: 'Temporarily unavailable.' } }, { status: 503 })
        : Response.json({ items: [{ id: 7, title: 'Dune' }] });
    },
  });
  const extension = await loader.load(manifest, { token: 'scoped-secret' });

  const page = await extension.search?.({ query: 'dune' });

  assert.equal(page?.items[0]?.title, 'Dune');
  assert.equal(providerAttempts, 2);
});

test('limits declarative requests to two concurrent calls per origin', async () => {
  let active = 0;
  let maximumActive = 0;
  const loader = new ExtensionLoader({
    bundled: new Map(),
    fetchFn: async (input) => {
      if (String(input).includes('raw.githubusercontent.com')) return Response.json(definition);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return Response.json({ items: [{ id: 7, title: 'Dune' }] });
    },
  });
  const extension = await loader.load(manifest, { token: 'scoped-secret' });

  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      extension.search?.({ query: `dune ${index}` })
    )
  );

  assert.equal(maximumActive, 2);
});

const deviceManifest: ExtensionManifest = {
  manifestVersion: 1,
  id: 'community.example.reader',
  version: '1.0.0',
  name: 'Example reader',
  description: 'Exercises reviewed device workflows.',
  types: ['book'],
  resources: [{ name: 'reader' }],
  config: [
    {
      key: 'backup_directory',
      type: 'directory',
      title: 'Backup directory',
      required: true,
    },
  ],
  transport: {
    kind: 'device',
    definitionUrl: 'https://raw.githubusercontent.com/example/reader/main/device-workflow.json',
  },
  permissions: {
    hosts: ['https://raw.githubusercontent.com'],
    device: ['directory.read', 'file.read'],
  },
};

const deviceDefinition: ExtensionDeviceWorkflowDefinition = {
  deviceWorkflowVersion: 1,
  resources: {
    reader: {
      steps: [
        {
          id: 'backups',
          operation: {
            kind: 'directory.scan',
            directory: { $op: 'path', path: 'config.backup_directory' },
            extensions: ['json'],
            limit: 1,
          },
        },
        {
          id: 'backup',
          operation: {
            kind: 'file.read',
            file: { $op: 'path', path: 'steps.backups.files.0.uri' },
            response: 'json',
          },
        },
      ],
      output: {
        books: { $op: 'path', path: 'steps.backup.json.books' },
      },
    },
  },
};

test('maps a reviewed device workflow to normalized reader books', async () => {
  const operations: string[] = [];
  const loader = new ExtensionLoader({
    bundled: new Map(),
    fetchFn: async () => Response.json(deviceDefinition),
    device: {
      async execute(operation) {
        operations.push(operation.kind);
        if (operation.kind === 'directory.scan') {
          return { files: [{ uri: 'content://backup/reader.json' }] };
        }
        if (operation.kind === 'file.read') {
          return {
            json: {
              books: [
                {
                  sourceId: 'book-1',
                  title: 'Dune',
                  authors: ['Frank Herbert'],
                  identifiers: {},
                  sourceFilename: 'Dune.epub',
                  progress: 42,
                },
              ],
            },
          };
        }
        throw new Error(`Unexpected operation ${operation.kind}`);
      },
    },
  });
  const extension = await loader.load(deviceManifest, {
    backup_directory: 'content://backup',
  });
  const result = await extension.readerSync?.({ books: [] });

  assert.deepEqual(operations, ['directory.scan', 'file.read']);
  assert.equal(result?.books?.[0]?.title, 'Dune');
  assert.equal(result?.progress[0]?.progress, 42);
});

test('runs a host-selected backup through a reviewed library import workflow', async () => {
  const importManifest: ExtensionManifest = {
    ...deviceManifest,
    resources: [{ name: 'libraryImport' }],
    config: undefined,
    libraryImports: [
      {
        id: 'backup',
        title: 'Import reader backup',
        fileExtensions: ['reader-backup'],
        platforms: ['android'],
      },
    ],
    permissions: {
      hosts: ['https://raw.githubusercontent.com'],
      device: ['file.read'],
    },
  };
  const importDefinition: ExtensionDeviceWorkflowDefinition = {
    deviceWorkflowVersion: 1,
    resources: {
      libraryImport: {
        steps: [
          {
            id: 'backup',
            operation: {
              kind: 'file.read',
              file: { $op: 'path', path: 'input.sourceUri' },
              response: 'json',
            },
          },
        ],
        output: { books: { $op: 'path', path: 'steps.backup.json.books' } },
      },
    },
  };
  const loader = new ExtensionLoader({
    bundled: new Map(),
    fetchFn: async () => Response.json(importDefinition),
    device: {
      async execute(operation, context) {
        if (operation.kind !== 'file.read') {
          throw new Error(`Unexpected operation ${operation.kind}`);
        }
        assert.equal(context.evaluate(operation.file), 'content://backup/reader.reader-backup');
        return {
          json: {
            books: [
              {
                sourceId: 'book-1',
                title: 'Dune',
                authors: ['Frank Herbert'],
                identifiers: {},
                progress: 21,
              },
            ],
          },
        };
      },
    },
  });
  const extension = await loader.load(importManifest);
  const result = await extension.libraryImport?.({
    importId: 'backup',
    sourceUri: 'content://backup/reader.reader-backup',
    filename: 'reader.reader-backup',
    platform: 'android',
  });

  assert.equal(result?.books?.[0]?.title, 'Dune');
  assert.equal(result?.progress[0]?.progress, 21);
});

test('rejects device operations without a declared capability', () => {
  const restrictedManifest: ExtensionManifest = {
    ...deviceManifest,
    permissions: {
      hosts: ['https://raw.githubusercontent.com'],
      device: ['directory.read'],
    },
  };

  assert.throws(
    () => parseDeviceWorkflowDefinition(deviceDefinition, restrictedManifest),
    /undeclared device capability "file.read"/
  );
});
