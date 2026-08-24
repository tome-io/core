import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { useSettings } from '@/context/settings-context';
import { useLibrary } from '@/context/library-context';
import { isSafLocation, pickDownloadFolder } from '@/lib/download';
import { beginFolderPicker, endFolderPicker } from '@/lib/folder-picker-lock';
import { validateProgressFolder } from '@/lib/progress-folder-provider';
import { forgetProgressSyncFolder } from '@/lib/progress-sync';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2">{title}</Text>
      <View
        className="rounded-2xl px-4 py-4 gap-4"
        style={{ backgroundColor: '#141419' }}
      >
        {children}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { settings, update } = useSettings();
  const { cloudLastSyncedAt, cloudSyncing, syncCloudProgress } = useLibrary();

  const chooseFolder = async (
    setting:
      | 'localLibraryLocation'
      | 'moonReaderBackupLocation'
      | 'progressSyncLocation'
  ) => {
    if (Platform.OS !== 'android') {
      Alert.alert(
        'Not supported here',
        setting === 'progressSyncLocation'
          ? 'Choosing a shared progress folder is currently available on Android.'
          : 'Choosing a custom folder needs Android Storage Access Framework. On iOS, files are saved to the app’s Documents/downloads folder (visible in the Files app).'
      );
      return;
    }
    beginFolderPicker();
    try {
      const picked = await pickDownloadFolder(
        isSafLocation(settings[setting]) ? settings[setting] : null
      );
      if (!picked) return; // cancelled
      if (setting === 'progressSyncLocation') {
        await validateProgressFolder(picked.uri);
      }
      await update({ [setting]: picked.uri });
    } catch (err: any) {
      Alert.alert('Folder picker failed', err.message || String(err));
    } finally {
      endFolderPicker();
    }
  };

  const resetFolder = async (
    setting:
      | 'localLibraryLocation'
      | 'moonReaderBackupLocation'
      | 'progressSyncLocation'
  ) => {
    if (setting === 'progressSyncLocation' && settings.progressSyncLocation) {
      await forgetProgressSyncFolder(settings.progressSyncLocation);
    }
    await update({ [setting]: null });
  };

  const locationLabel = (location: string | null, fallback: string) =>
    !location
      ? fallback
      : isSafLocation(location)
        ? decodeURIComponent(location.split('/').pop() || location)
        : location;
  const localLibraryLabel = locationLabel(
    settings.localLibraryLocation,
    'App-private Documents/downloads'
  );
  const moonReaderLabel = locationLabel(
    settings.moonReaderBackupLocation,
    'Not configured'
  );
  const progressSyncLabel = locationLabel(
    settings.progressSyncLocation,
    'Not configured'
  );

  const syncProgressNow = async () => {
    try {
      await syncCloudProgress();
    } catch (err: any) {
      Alert.alert('Progress sync failed', err.message || String(err));
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: '#0b0b0f' }}>
      <ScrollView contentContainerClassName="px-4 py-5">
        <Section title="Extensions">
          <Text className="text-xs text-neutral-400 leading-4">
            Install providers from a repository URL and configure each provider independently.
            Readio does not include a third-party extension catalog.
          </Text>
          <Pressable
            onPress={() => router.push('/extensions')}
            className="h-11 rounded-xl items-center justify-center active:opacity-80 disabled:opacity-60"
            style={{ backgroundColor: '#8b7cf6' }}
          >
            <Text className="font-semibold text-white">Manage extensions</Text>
          </Pressable>
        </Section>

        <Section title="Book Library Folder">
          <Text numberOfLines={2} className="text-sm text-neutral-700 dark:text-neutral-200">
            {localLibraryLabel}
          </Text>
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => chooseFolder('localLibraryLocation')}
              className="flex-1 h-11 rounded-xl items-center justify-center active:opacity-80" style={{ backgroundColor: '#8b7cf6' }}
            >
              <Text className="font-semibold text-white">Choose shared folder…</Text>
            </Pressable>
            {settings.localLibraryLocation && (
              <Pressable
                onPress={() => resetFolder('localLibraryLocation')}
                className="h-11 px-4 rounded-xl items-center justify-center active:opacity-80" style={{ backgroundColor: '#17171c' }}
              >
                <Text className="font-medium text-neutral-300">Reset</Text>
              </Pressable>
            )}
          </View>
          <Text className="text-xs text-neutral-400 leading-4">
            Local EPUB, PDF and ebook files are indexed from this folder. Provider downloads are
            saved here too.
          </Text>
        </Section>

        <Section title="Moon+ Reader Backup Folder">
          <Text numberOfLines={2} className="text-sm text-neutral-700 dark:text-neutral-200">
            {moonReaderLabel}
          </Text>
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => chooseFolder('moonReaderBackupLocation')}
              className="flex-1 h-11 rounded-xl items-center justify-center active:opacity-80"
              style={{ backgroundColor: '#8b7cf6' }}
            >
              <Text className="font-semibold text-white">Choose backup folder…</Text>
            </Pressable>
            {settings.moonReaderBackupLocation && (
              <Pressable
                onPress={() => resetFolder('moonReaderBackupLocation')}
                className="h-11 px-4 rounded-xl items-center justify-center active:opacity-80"
                style={{ backgroundColor: '#17171c' }}
              >
                <Text className="font-medium text-neutral-300">Reset</Text>
              </Pressable>
            )}
          </View>
          <Text className="text-xs text-neutral-400 leading-4">
            Select Moon+ Reader&apos;s backup folder, commonly Books/.Moon+/Backup. The newest
            .mrpro or cloud.backup file supplies its catalog, reading progress and history;
            ebook files are never indexed from this setting.
          </Text>
        </Section>

        <Section title="Progress Sync Folder">
          <Text numberOfLines={2} className="text-sm text-neutral-700 dark:text-neutral-200">
            {progressSyncLabel}
          </Text>
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => chooseFolder('progressSyncLocation')}
              className="flex-1 h-11 rounded-xl items-center justify-center active:opacity-80"
              style={{ backgroundColor: '#8b7cf6' }}
            >
              <Text className="font-semibold text-white">Choose sync folder…</Text>
            </Pressable>
            {settings.progressSyncLocation && (
              <Pressable
                onPress={() => resetFolder('progressSyncLocation')}
                className="h-11 px-4 rounded-xl items-center justify-center active:opacity-80"
                style={{ backgroundColor: '#17171c' }}
              >
                <Text className="font-medium text-neutral-300">Disable</Text>
              </Pressable>
            )}
          </View>
          {settings.progressSyncLocation && (
            <Pressable
              onPress={syncProgressNow}
              disabled={cloudSyncing}
              className="h-11 rounded-xl flex-row gap-2 items-center justify-center border border-neutral-800 active:opacity-80 disabled:opacity-60"
            >
              {cloudSyncing && <ActivityIndicator size="small" color="#8b7cf6" />}
              <Text className="font-medium text-neutral-300">
                {cloudSyncing ? 'Syncing…' : 'Sync now'}
              </Text>
            </Pressable>
          )}
          <Text className="text-xs text-neutral-400 leading-4">
            Choose a Google Drive folder directly, or a local folder mirrored by FolderSync.
            Reader writes one file per device and keeps the furthest reading progress when the app
            starts, returns to the foreground, or progress changes. Direct Drive access requires
            an installed Reader build and is unavailable in Expo Go.
          </Text>
          {!!cloudLastSyncedAt && (
            <Text className="text-xs text-neutral-500">
              Last synced {new Date(cloudLastSyncedAt).toLocaleString()}
            </Text>
          )}
        </Section>

        <Text onPress={() => router.replace('/home')} className="text-center text-xs text-neutral-400 mt-2 mb-8">
          Readio
        </Text>
      </ScrollView>
    </View>
  );
}
