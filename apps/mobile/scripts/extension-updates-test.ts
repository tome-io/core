import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ExtensionManifest } from '@tomeio/extension-protocol';
import {
  compareExtensionVersions,
  ExtensionRegistry,
  type ExtensionRegistryStore,
  type InstalledExtension,
} from '@tomeio/extension-runtime';

function manifest(version: string): ExtensionManifest {
  return {
    manifestVersion: 1,
    id: 'community.example.books',
    version,
    name: 'Example Books',
    description: 'Example extension',
    types: ['book'],
    resources: [{ name: 'search' }],
    transport: { kind: 'http', baseUrl: 'https://example.com' },
    permissions: { hosts: ['https://example.com'] },
  };
}

class MemoryStore implements ExtensionRegistryStore {
  constructor(public extensions: InstalledExtension[]) {}

  async read() {
    return this.extensions;
  }

  async write(extensions: InstalledExtension[]) {
    this.extensions = extensions;
  }
}

function installed(version: string): InstalledExtension {
  return {
    manifest: manifest(version),
    manifestUrl: 'https://example.com/tomeio-extension.json',
    repositoryUrl: 'https://example.com',
    enabled: true,
    installedAt: 100,
    updatedAt: 100,
  };
}

describe('extension updates', () => {
  test('compares semantic versions including prereleases', () => {
    assert.equal(compareExtensionVersions('2.1.0', '2.0.0'), 1);
    assert.equal(compareExtensionVersions('2.1.0-beta.2', '2.1.0-beta.1'), 1);
    assert.equal(compareExtensionVersions('2.1.0-beta.1', '2.1.0'), -1);
    assert.equal(compareExtensionVersions('latest', '2.1.0'), null);
  });

  test('updates an enabled extension only after validation', async () => {
    const store = new MemoryStore([installed('2.0.0')]);
    const registry = new ExtensionRegistry(
      store,
      [],
      async () => new Response(JSON.stringify(manifest('2.1.0')), { status: 200 })
    );
    const validated: string[] = [];

    const result = await registry.updateEnabled(async (candidate) => {
      validated.push(candidate.version);
    });

    assert.deepEqual(validated, ['2.1.0']);
    assert.equal(result.updated[0]?.manifest.version, '2.1.0');
    assert.equal(result.failures.length, 0);
    assert.equal(store.extensions[0]?.manifest.version, '2.1.0');
    assert.equal(store.extensions[0]?.installedAt, 100);
  });

  test('keeps the installed version when validation fails', async () => {
    const store = new MemoryStore([installed('2.0.0')]);
    const registry = new ExtensionRegistry(
      store,
      [],
      async () => new Response(JSON.stringify(manifest('2.1.0')), { status: 200 })
    );

    const result = await registry.updateEnabled(async () => {
      throw new Error('protocol validation failed');
    });

    assert.equal(result.updated.length, 0);
    assert.match(result.failures[0]?.message ?? '', /protocol validation/);
    assert.equal(store.extensions[0]?.manifest.version, '2.0.0');
  });
});
