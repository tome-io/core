import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExtensionManifest, ExtensionWorkflowDefinition, ExtensionWorkflowResource } from '@tomeio/extension-protocol';
import { ExtensionLoader, ExtensionSessionManager, parseWorkflowDefinition, type ExtensionSession, type ExtensionSessionStore } from '@tomeio/extension-runtime';

const manifest: ExtensionManifest = {
  manifestVersion: 1, id: 'community.example.sessions', version: '1.0.0',
  name: 'Sessions', description: 'Session test provider', types: ['book'],
  resources: [{ name: 'catalog' }, { name: 'reviews' }],
  transport: { kind: 'declarative', definitionUrl: 'https://example.com/workflow.json' },
  permissions: { hosts: ['https://example.com'] },
};
const resource: ExtensionWorkflowResource = {
  session: {
    steps: ['login'],
    output: { login: { body: { token: { $op: 'path', path: 'steps.login.body.token' } } } },
    expiresAt: { $op: 'path', path: 'steps.login.body.expiresAt' },
  },
  steps: [
    { id: 'login', request: { urls: 'https://example.com/login', method: 'POST', json: { password: { $op: 'path', path: 'config.password' } } } },
    { id: 'data', authenticated: true, request: { urls: 'https://example.com/data', headers: { Authorization: { $op: 'path', path: 'steps.login.body.token' } } } },
  ],
  output: { items: [] },
};
const definition: ExtensionWorkflowDefinition = { workflowVersion: 1, resources: { catalog: resource, reviews: resource } };
const review = { book: { title: 'Book', authors: [], identifiers: {} }, page: 1 };

function fixture(workflow = definition) {
  let logins = 0;
  let reads = 0;
  let checks = 0;
  let reject = (token: string) => 200;
  let validationStatus = 200;
  const saved = new Map<string, { scope: string; session: ExtensionSession }>();
  const store: ExtensionSessionStore = {
    async read(id, scope) { const entry = saved.get(id); return entry?.scope === scope ? entry.session : null; },
    async write(id, scope, session) { saved.set(id, { scope, session }); },
    async remove(id) { saved.delete(id); },
  };
  const fetchFn: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/workflow.json') return Response.json(workflow);
    if (path === '/login') return Response.json({ token: `token-${++logins}`, expiresAt: Date.now() + 3600000 });
    if (path === '/check') { checks++; return new Response('', { status: validationStatus }); }
    reads++;
    const status = reject(new Headers(init?.headers).get('Authorization') ?? '');
    return status === 401 ? new Response('Unauthorized', { status }) : Response.json({}, { status });
  };
  const loader = () => new ExtensionLoader({ bundled: new Map(), fetchFn, sessionStore: store });
  return { loader, saved, stats: () => ({ logins, reads, checks }), reject: (fn: typeof reject) => { reject = fn; }, validation: (status: number) => { validationStatus = status; } };
}

test('shares one login across simultaneous resources and fresh extension wrappers', async () => {
  const f = fixture(); const loader = f.loader();
  const a = await loader.load(manifest, { password: 'first' });
  const b = await loader.load(manifest, { password: 'first' });
  await Promise.all([a.catalog!({}), b.reviews!(review), a.catalog!({})]);
  assert.deepEqual(f.stats(), { logins: 1, reads: 3, checks: 0 });
  await (await f.loader().load(manifest, { password: 'first' })).catalog!({});
  assert.equal(f.stats().logins, 1, 'secure store survives loader restart');
  assert.deepEqual(Object.keys(f.saved.get(manifest.id)!.session.steps), ['login']);
});

test('expiry, changed credentials, and provider version changes require new sessions', async () => {
  const f = fixture(); const loader = f.loader();
  await (await loader.load(manifest, { password: 'first' })).catalog!({});
  f.saved.get(manifest.id)!.session.expiresAt = Date.now() - 1;
  await (await loader.load(manifest, { password: 'first' })).catalog!({});
  await (await loader.load(manifest, { password: 'second' })).catalog!({});
  await (await loader.load({ ...manifest, version: '2.0.0' }, { password: 'second' })).catalog!({});
  assert.equal(f.stats().logins, 4);
});

test('simultaneous 401 responses renew once and replay only the failed reads', async () => {
  const f = fixture(); const provider = await f.loader().load(manifest);
  await provider.catalog!({});
  f.reject(token => token === 'token-1' ? 401 : 200);
  await Promise.all([provider.catalog!({}), provider.reviews!(review)]);
  assert.equal(f.stats().logins, 2);
  assert.equal(f.stats().reads, 5);
});

test('a second 401 surfaces an error and discards the rejected token', async () => {
  const f = fixture(); f.reject(() => 401);
  const provider = await f.loader().load(manifest);
  await assert.rejects(provider.catalog!({}), /401/);
  assert.equal(f.stats().logins, 2);
  assert.equal(f.stats().reads, 2);
  assert.equal(f.saved.size, 0);
});

test('permission failures do not trigger login again', async () => {
  const f = fixture(); f.reject(() => 403);
  const provider = await f.loader().load(manifest);
  await assert.rejects(provider.catalog!({}), /403/);
  assert.equal(f.stats().logins, 1);
});

test('validates reused sessions, renews invalid ones, and surfaces validation outages', async () => {
  const workflow = structuredClone(definition);
  workflow.resources.catalog!.session!.validate = {
    request: { urls: 'https://example.com/check', response: 'text' },
    accept: { $op: 'path', path: 'response.ok' },
    invalidWhen: { $op: 'equals', values: [{ $op: 'path', path: 'response.status' }, 401] },
  };
  const f = fixture(workflow); const provider = await f.loader().load(manifest);
  await provider.catalog!({}); await provider.catalog!({});
  assert.equal(f.stats().logins, 1);
  f.validation(401); await provider.catalog!({});
  assert.equal(f.stats().logins, 2);
  f.validation(503); await assert.rejects(provider.catalog!({}), /Session validation failed/);
  assert.equal(f.stats().logins, 2);
  assert.equal(f.stats().reads, 3);
});

test('clearing a session prevents an in-flight login from restoring it', async () => {
  const writes: ExtensionSession[] = [];
  const manager = new ExtensionSessionManager({
    async read() { return null; }, async write(_id, _scope, value) { writes.push(value); }, async remove() {},
  });
  const access = manager.bind('provider', 'scope');
  let finish!: (value: ExtensionSession) => void;
  let begun!: () => void;
  const started = new Promise<void>(resolve => { begun = resolve; });
  const request = access.get(() => { begun(); return new Promise(resolve => { finish = resolve; }); });
  await started;
  await manager.clear('provider');
  finish({ steps: { login: { token: 'secret' } } });
  await assert.rejects(request, /configuration changed/);
  assert.equal(writes.length, 0);
});

test('configuration scopes and extension IDs never share sessions', async () => {
  const f = fixture(); const loader = f.loader();
  await (await loader.load(manifest)).catalog!({});
  await (await loader.load({ ...manifest, id: 'community.other.sessions' })).catalog!({});
  await loader.clearSessions(manifest.id);
  assert.equal(f.saved.has(manifest.id), false);
  await (await loader.load(manifest)).catalog!({});
  assert.equal(f.stats().logins, 3);
});

test('rejects malformed login groups and unsafe authenticated replays', () => {
  const malformed = structuredClone(definition);
  malformed.resources.catalog!.session!.steps = ['missing'];
  assert.throws(() => parseWorkflowDefinition(malformed, manifest), /existing login steps/);
  const post = structuredClone(definition);
  post.resources.catalog!.steps[1].request.method = 'POST';
  assert.throws(() => parseWorkflowDefinition(post, manifest), /GET and HEAD/);
  const inputDependent = structuredClone(definition);
  inputDependent.resources.catalog!.steps[0].request.json = { tenant: { $op: 'path', path: 'input.tenant' } };
  assert.throws(() => parseWorkflowDefinition(inputDependent, manifest), /only read configuration/);
});

test('failed login is shared by concurrent callers and can be retried', async () => {
  const manager = new ExtensionSessionManager();
  const access = manager.bind('provider', 'scope');
  let attempts = 0;
  const login = async () => { if (++attempts === 1) throw new Error('Login failed'); return { steps: { login: {} } }; };
  const results = await Promise.allSettled([access.get(login), access.get(login)]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(attempts, 1);
  await access.get(login);
  assert.equal(attempts, 2);
});

test('retained login steps work when an older host ignores session annotations', async () => {
  const legacy = structuredClone(definition);
  for (const workflow of Object.values(legacy.resources)) {
    delete workflow!.session;
    workflow!.steps.forEach(step => { delete step.authenticated; });
  }
  const f = fixture(legacy); const provider = await f.loader().load(manifest);
  await provider.catalog!({}); await provider.reviews!(review);
  assert.equal(f.stats().logins, 2);
  assert.equal(f.stats().reads, 2);
});

test('clearing waits for an active secure write and removes its result', async () => {
  let stored: ExtensionSession | undefined;
  let release!: () => void;
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const manager = new ExtensionSessionManager({
    async read() { return null; },
    async write(_id, _scope, session) {
      started();
      await new Promise<void>(resolve => { release = resolve; });
      stored = session;
    },
    async remove() { stored = undefined; },
  });
  const login = manager.bind('provider', 'scope').get(async () => ({ steps: { login: {} } }));
  const rejected = assert.rejects(login, /configuration changed/);
  await writing;
  const cleared = manager.clear('provider');
  release();
  await Promise.all([rejected, cleared]);
  assert.equal(stored, undefined);
});

test('relative expiry is persisted as an absolute deadline', async () => {
  const workflow = structuredClone(definition);
  for (const value of Object.values(workflow.resources)) {
    delete value!.session!.expiresAt;
    value!.session!.expiresIn = 60;
  }
  const f = fixture(workflow);
  const before = Date.now();
  await (await f.loader().load(manifest)).catalog!({});
  const expiresAt = f.saved.get(manifest.id)!.session.expiresAt!;
  assert.ok(expiresAt >= before + 60000 && expiresAt <= Date.now() + 60000);
});

test('a late successful validation cannot restore an invalidated token', async () => {
  const manager = new ExtensionSessionManager();
  const access = manager.bind('provider', 'scope');
  const first = await access.get(async () => ({ steps: { login: { token: 'first' } } }));
  let finish!: (valid: boolean) => void;
  let started!: () => void;
  const begun = new Promise<void>(resolve => { started = resolve; });
  const request = access.get(async () => ({ steps: { login: { token: 'second' } } }), () => {
    started(); return new Promise(resolve => { finish = resolve; });
  });
  await begun;
  await access.invalidate(first);
  finish(true);
  assert.deepEqual((await request).steps, { login: { token: 'second' } });
});
