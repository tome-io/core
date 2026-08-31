import type { ExtensionHostAdapter } from '@tomeio/extension-runtime';
import type {
  ExtensionReaderSetupRequest,
  ExtensionReaderSetupResult,
} from '@tomeio/extension-protocol';

import {
  connectHostedKobo,
  disconnectHostedKobo,
  getHostedKoboConnection,
  type HostedKoboConnection,
} from './hosted-sync';

const INSTRUCTIONS = [
  'Connect the Kobo to a computer and open .kobo/Kobo/Kobo eReader.conf.',
  'Under [OneStoreServices], replace api_endpoint with the private Tomeio endpoint below.',
  'Safely eject and restart the Kobo, then run Sync on the reader.',
];

function setupResult(connection: HostedKoboConnection): ExtensionReaderSetupResult {
  return {
    connected: connection.connected,
    ...(connection.endpoint ? { endpoint: connection.endpoint } : {}),
    ...(connection.createdAt ? { createdAt: connection.createdAt } : {}),
    ...(connection.lastUsedAt ? { lastUsedAt: connection.lastUsedAt } : {}),
    instructions: INSTRUCTIONS,
    warnings: [
      'The endpoint is a private account credential. Do not post or share it publicly.',
      'Tomeio syncs EPUB library metadata and reading progress only. It does not send book files, covers, or PDFs to Kobo.',
      'Kobo treats custom-library records as entitlements, so metadata-only titles may appear unavailable on the reader.',
    ],
  };
}

async function readerSetup(
  request: ExtensionReaderSetupRequest,
): Promise<ExtensionReaderSetupResult> {
  if (request.setupId !== 'hosted-sync') {
    throw new Error(`Unknown Kobo setup "${request.setupId}".`);
  }
  if (request.action === 'status') return setupResult(await getHostedKoboConnection());
  if (request.action === 'connect') return setupResult(await connectHostedKobo());
  if (request.action === 'disconnect') return setupResult(await disconnectHostedKobo());
  throw new Error('Unsupported Kobo setup action.');
}

export const koboExtensionHost: ExtensionHostAdapter = {
  extensionId: 'community.tomeio.kobo',
  readerSetup,
};
