import * as Crypto from 'expo-crypto';
import { File, FileMode } from 'expo-file-system';

const SAMPLE_SIZE = 1_024;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function koreaderPartialMd5(uri: string): Promise<string> {
  const file = new File(uri);
  const handle = file.open(FileMode.ReadOnly);
  const samples: Uint8Array[] = [];
  let totalLength = 0;
  try {
    for (let exponent = -1; exponent <= 10; exponent += 1) {
      handle.offset = SAMPLE_SIZE * 2 ** (2 * exponent);
      const sample = handle.readBytes(SAMPLE_SIZE);
      if (sample.byteLength === 0) break;
      samples.push(sample);
      totalLength += sample.byteLength;
    }
  } finally {
    handle.close();
  }
  if (samples.length === 0) {
    throw new Error(`KOReader document hashing could not read ${uri}`);
  }
  const input = new Uint8Array(totalLength);
  let offset = 0;
  for (const sample of samples) {
    input.set(sample, offset);
    offset += sample.byteLength;
  }
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.MD5, input);
  return hex(new Uint8Array(digest));
}
