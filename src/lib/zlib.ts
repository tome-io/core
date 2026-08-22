import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { secureDelete, secureGet, secureSet } from './secure';
import { createZlibClient } from './zlib-core';

export type { Book, SearchOrder, Session, ZlibClient } from './zlib-core';

export const zlib = createZlibClient({
  storeGet: (k) => AsyncStorage.getItem(k),
  storeSet: (k, v) => AsyncStorage.setItem(k, v),
  secureGet: secureGet,
  secureSet: secureSet,
  secureDelete: secureDelete,
  isWeb: Platform.OS === 'web',
});

export const searchBooks = zlib.searchBooks;
export const resolveDownload = zlib.resolveDownload;
export const downloadHeaders = zlib.downloadHeaders;
export const acquireSession = zlib.acquireSession;
export const clearSession = zlib.clearSession;
export const getSession = zlib.getSession;
