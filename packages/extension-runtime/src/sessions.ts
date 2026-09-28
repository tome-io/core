export interface ExtensionSession {
  steps: Record<string, unknown>;
  expiresAt?: number;
}

/** Implementations must protect tokens and must not persist the raw scope. */
export interface ExtensionSessionStore {
  read(extensionId: string, scope: string): Promise<ExtensionSession | null>;
  write(extensionId: string, scope: string, session: ExtensionSession): Promise<void>;
  remove(extensionId: string): Promise<void>;
}

interface SessionState {
  scope: string;
  loaded: boolean;
  value?: ExtensionSession;
  pending?: Promise<ExtensionSession>;
}

export interface ExtensionSessionAccess {
  get(
    create: () => Promise<ExtensionSession>,
    validate?: (session: ExtensionSession) => Promise<boolean>,
  ): Promise<ExtensionSession>;
  invalidate(session: ExtensionSession): Promise<void>;
}

/** One session per configured extension, shared across resource invocations. */
export class ExtensionSessionManager {
  private readonly states = new Map<string, SessionState>();
  private readonly storage = new Map<string, Promise<unknown>>();

  constructor(private readonly store?: ExtensionSessionStore) {}

  private stored<T>(id: string, action: () => Promise<T>): Promise<T> {
    const operation = (this.storage.get(id) ?? Promise.resolve()).then(action);
    const tail = operation.catch(() => undefined);
    this.storage.set(id, tail);
    void tail.then(() => {
      if (this.storage.get(id) === tail) this.storage.delete(id);
    });
    return operation;
  }

  async clear(id: string): Promise<void> {
    this.states.delete(id);
    await this.stored(id, async () => { await this.store?.remove(id); });
  }

  bind(id: string, scope: string): ExtensionSessionAccess {
    let state = this.states.get(id);
    if (!state || state.scope !== scope) {
      state = { scope, loaded: false };
      this.states.set(id, state);
    }
    const current = state;
    const assertCurrent = () => {
      if (this.states.get(id) !== current) throw new Error('Extension session configuration changed. Retry the request.');
    };
    const discard = async () => {
      assertCurrent();
      current.value = undefined;
      await this.stored(id, async () => {
        assertCurrent();
        await this.store?.remove(id);
      });
    };
    return {
      get: async (create, validate) => {
        assertCurrent();
        if (current.pending) return current.pending;
        const request = Promise.resolve().then(async () => {
          if (!current.loaded) {
            const saved = await this.stored(id, async () => this.store?.read(id, scope) ?? null);
            assertCurrent();
            current.value = saved ?? undefined;
            current.loaded = true;
          }
          const saved = current.value;
          if (saved) {
            const validTime = saved.expiresAt == null || saved.expiresAt > Date.now();
            const valid = validTime && (!validate || await validate(saved));
            assertCurrent();
            if (valid && current.value === saved) return saved;
            if (current.value === saved) await discard();
          }
          const session = await create();
          assertCurrent();
          if (session.expiresAt != null && (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now())) {
            throw new Error('Extension login returned an expired or invalid session.');
          }
          await this.stored(id, async () => {
            assertCurrent();
            await this.store?.write(id, scope, session);
          });
          assertCurrent();
          current.value = session;
          return session;
        });
        current.pending = request;
        try {
          return await request;
        } finally {
          if (current.pending === request) current.pending = undefined;
        }
      },
      invalidate: async (session) => {
        assertCurrent();
        // A late 401 from an old token must not discard a newer session.
        if (current.value === session) await discard();
      },
    };
  }
}
