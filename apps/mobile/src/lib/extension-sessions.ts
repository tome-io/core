import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { ExtensionSessionStore } from '@tomeio/extension-runtime';

const key = (id: string) => `extension_session_v1.${id}`;
const fingerprint = (scope: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope);
const available = () => Platform.OS === 'web' ? Promise.resolve(false) : SecureStore.isAvailableAsync();

/** On platforms without secure storage, sessions remain in runtime memory only. */
export const extensionSessionStore: ExtensionSessionStore = {
  async read(id, scope) {
    if (!await available()) return null;
    const raw = await SecureStore.getItemAsync(key(id));
    if (!raw) return null;
    let saved;
    try { saved = JSON.parse(raw); } catch {
      throw new Error('Saved extension session is invalid. Re-save the extension configuration.');
    }
    if (!saved || typeof saved !== 'object') throw new Error('Saved extension session is invalid.');
    if (saved.scope !== await fingerprint(scope)) return null;
    const session = saved.session;
    if (!session || typeof session.steps !== 'object' || session.steps === null || Array.isArray(session.steps) ||
        (session.expiresAt != null && (typeof session.expiresAt !== 'number' || !Number.isFinite(session.expiresAt)))) {
      throw new Error('Saved extension session is invalid. Re-save the extension configuration.');
    }
    return session;
  },
  async write(id, scope, session) {
    if (!await available()) return;
    await SecureStore.setItemAsync(key(id), JSON.stringify({ scope: await fingerprint(scope), session }));
  },
  async remove(id) {
    if (await available()) await SecureStore.deleteItemAsync(key(id));
  },
};
