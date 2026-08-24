import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { secureDelete, secureGet, secureSet } from './secure';
import { createZlibClient, type Book, type SearchOrder } from './zlib-core';

export type { Book, SearchOrder, Session, ZlibClient } from './zlib-core';

export const zlib = createZlibClient({
  storeGet: (k) => AsyncStorage.getItem(k),
  storeSet: (k, v) => AsyncStorage.setItem(k, v),
  secureGet: secureGet,
  secureSet: secureSet,
  secureDelete: secureDelete,
  isWeb: Platform.OS === 'web',
});

const pendingSearches = new Map<string, Promise<Book[]>>();

export function searchBooks(
  query: string,
  page = 1,
  format = '',
  order: SearchOrder = 'bestmatch'
): Promise<Book[]> {
  const key = JSON.stringify([query, page, format, order]);
  const pending = pendingSearches.get(key);
  if (pending) return pending;

  const request = zlib
    .searchBooks(query, page, format, order)
    .finally(() => pendingSearches.delete(key));
  pendingSearches.set(key, request);
  return request;
}

export const resolveDownload = zlib.resolveDownload;
export const downloadHeaders = zlib.downloadHeaders;
export const acquireSession = zlib.acquireSession;
export const clearSession = zlib.clearSession;
export const getSession = zlib.getSession;
