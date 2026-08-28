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

  await assert.rejects(() => extension.search?.({ query: 'dune' }), /undeclared origin/);
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
