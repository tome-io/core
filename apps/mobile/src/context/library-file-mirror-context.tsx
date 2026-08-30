import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';

import { useLibraryActions } from '@/context/library-context';
import { useSettings } from '@/context/settings-context';
import { isFolderPickerActive } from '@/lib/folder-picker-lock';
import {
  libraryFileMirrorSummary,
  synchronizeLibraryBookFiles,
  type LibraryFileMirrorProgress,
  type LibraryFileMirrorResult,
} from '@/lib/library-file-mirror';

export type LibraryFileMirrorState = 'idle' | 'running' | 'success' | 'error';

interface LibraryFileMirrorContextValue {
  enabled: boolean;
  state: LibraryFileMirrorState;
  detail: string | null;
  error: string | null;
  progress: LibraryFileMirrorProgress | null;
  lastSyncedAt: number | null;
  syncNow(): Promise<LibraryFileMirrorResult>;
}

const LibraryFileMirrorContext = createContext<LibraryFileMirrorContextValue | null>(null);

export function LibraryFileMirrorProvider({ children }: { children: ReactNode }) {
  const { settings, ready } = useSettings();
  const { refreshLocalBooks } = useLibraryActions();
  const [state, setState] = useState<LibraryFileMirrorState>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LibraryFileMirrorProgress | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const pending = useRef<Promise<LibraryFileMirrorResult> | null>(null);
  const initialConfiguration = useRef<string | null>(null);

  const syncNow = useCallback((): Promise<LibraryFileMirrorResult> => {
    if (pending.current) return pending.current;
    if (Platform.OS !== 'android') {
      return Promise.reject(new Error('Book folder mirroring is currently available on Android.'));
    }
    if (!settings.libraryMirrorEnabled) {
      return Promise.reject(new Error('Turn on book folder mirroring before synchronizing.'));
    }
    if (!settings.localLibraryLocation || !settings.libraryMirrorLocation) {
      return Promise.reject(
        new Error('Choose both the primary library folder and the on-device mirror folder.'),
      );
    }

    setState('running');
    setDetail('Comparing book files in both folders…');
    setError(null);
    setProgress({
      phase: 'scanning',
      completed: 0,
      total: 0,
      detail: 'Reading both folders…',
    });
    let operation: Promise<LibraryFileMirrorResult>;
    operation = synchronizeLibraryBookFiles(
      settings.localLibraryLocation,
      settings.libraryMirrorLocation,
      { onProgress: setProgress },
    )
      .then(async (result) => {
        if (result.primaryChanged) {
          // A normal foreground library scan may already be running. The second
          // call guarantees the newly mirrored primary files receive a fresh pass.
          await refreshLocalBooks();
          await refreshLocalBooks();
        }
        setLastSyncedAt(Date.now());
        setDetail(libraryFileMirrorSummary(result));
        setProgress(null);
        setState('success');
        return result;
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        setDetail(null);
        setProgress(null);
        setState('error');
        throw cause;
      })
      .finally(() => {
        if (pending.current === operation) pending.current = null;
      });
    pending.current = operation;
    return operation;
  }, [refreshLocalBooks, settings]);

  useEffect(() => {
    if (!ready || !settings.libraryMirrorEnabled) {
      initialConfiguration.current = null;
      if (!settings.libraryMirrorEnabled) {
        const timeout = setTimeout(() => {
          setState('idle');
          setDetail(null);
          setError(null);
          setProgress(null);
        }, 0);
        return () => clearTimeout(timeout);
      }
      return;
    }
    if (!settings.localLibraryLocation || !settings.libraryMirrorLocation) return;
    const configuration = `${settings.localLibraryLocation}|${settings.libraryMirrorLocation}`;
    if (initialConfiguration.current === configuration) return;
    initialConfiguration.current = configuration;
    void syncNow().catch(() => {});
  }, [ready, settings, syncNow]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returningToApp = /inactive|background/.test(previousState) && nextState === 'active';
      previousState = nextState;
      if (
        returningToApp &&
        settings.libraryMirrorEnabled &&
        settings.localLibraryLocation &&
        settings.libraryMirrorLocation &&
        !isFolderPickerActive()
      ) {
        void syncNow().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [settings, syncNow]);

  const value = useMemo(
    () => ({
      enabled: settings.libraryMirrorEnabled,
      state,
      detail,
      error,
      progress,
      lastSyncedAt,
      syncNow,
    }),
    [detail, error, lastSyncedAt, progress, settings.libraryMirrorEnabled, state, syncNow],
  );

  return (
    <LibraryFileMirrorContext.Provider value={value}>
      {children}
    </LibraryFileMirrorContext.Provider>
  );
}

export function useLibraryFileMirror(): LibraryFileMirrorContextValue {
  const value = useContext(LibraryFileMirrorContext);
  if (!value) throw new Error('useLibraryFileMirror must be used inside LibraryFileMirrorProvider.');
  return value;
}
