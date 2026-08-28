import * as Crypto from 'expo-crypto';
import { File, FileMode } from 'expo-file-system';

import { collectKoreaderPartialMd5Samples } from './progress-sync-model';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function koreaderPartialMd5(uri: string): Promise<string> {
  const file = new File(uri);
  const handle = file.open(FileMode.ReadOnly);
  let input: Uint8Array;
  try {
    input = collectKoreaderPartialMd5Samples((offset, length) => {
      handle.offset = offset;
      return handle.readBytes(length);
    });
  } finally {
    handle.close();
  }
  if (input.byteLength === 0) {
    throw new Error(`KOReader document hashing could not read ${uri}`);
  }
  // Expo's digest API requires an ArrayBuffer-backed view. The shared helper's
  // public type may also represent SharedArrayBuffer-backed views, so copy it.
  const digestInput = new Uint8Array(input.byteLength);
  digestInput.set(input);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.MD5, digestInput);
  return hex(new Uint8Array(digest));
}
