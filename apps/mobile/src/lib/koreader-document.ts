import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import { collectKoreaderPartialMd5Samples, koreaderPartialMd5Offsets, KOREADER_PARTIAL_MD5_SAMPLE_SIZE } from './progress-sync-model';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function koreaderPartialMd5(uri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory) throw new Error(`KOReader document hashing could not read ${uri}`);
  const samples = new Map<number, Uint8Array>();
  for (const offset of koreaderPartialMd5Offsets()) {
    if (offset >= info.size) break;
    // Native asynchronous range reads avoid blocking JS on FileHandle seek/read.
    // Decode at most 1 KiB per sample, never the entire book.
    const encoded = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: offset,
      length: Math.min(KOREADER_PARTIAL_MD5_SAMPLE_SIZE, info.size - offset),
    });
    const sample = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    if (!sample.length) break;
    samples.set(offset, sample);
  }
  const input = collectKoreaderPartialMd5Samples((offset) => samples.get(offset) ?? new Uint8Array());
  if (!input.byteLength) throw new Error(`KOReader document hashing could not read ${uri}`);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.MD5, new Uint8Array(input));
  return hex(new Uint8Array(digest));
}
