import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { clearZlibSession, useSettings } from '@/context/settings-context';
import { useExtensions } from '@/context/extensions-context';
import { useLibrary } from '@/context/library-context';
import { isSafLocation, pickDownloadFolder } from '@/lib/download';
import { beginFolderPicker, endFolderPicker } from '@/lib/folder-picker-lock';
import { validateProgressFolder } from '@/lib/progress-folder-provider';
import { forgetProgressSyncFolder } from '@/lib/progress-sync';

const DOMAINS = [
  { label: 'Auto (recommended)', value: '' },
  { label: 'librella.fi', value: 'https://librella.fi' },
  { label: 'lexlib.fi', value: 'https://lexlib.fi' },
  { label: 'bookabooki.fi', value: 'https://bookabooki.fi' },
  { label: 'article.sk', value: 'https://article.sk' },
  { label: '1lib.sk', value: 'https://1lib.sk' },
  { label: 'zlibrary-global.se', value: 'https://zlibrary-global.se' },
];

const FORMATS = [
  { label: 'Any', value: '' },
  { label: 'EPUB', value: 'epub' },
  { label: 'PDF', value: 'pdf' },
  { label: 'MOBI', value: 'mobi' },
  { label: 'AZW3', value: 'azw3' },
];

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
  const extensions = useExtensions();
  const { cloudLastSyncedAt, cloudSyncing, syncCloudProgress } = useLibrary();

  const [email, setEmail] = useState(settings.email);
  const [password, setPassword] = useState(settings.password);
  const [remixUserId, setRemixUserId] = useState(settings.remixUserId);
  const [remixUserKey, setRemixUserKey] = useState(settings.remixUserKey);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [extensionUrl, setExtensionUrl] = useState('');
  const [installingExtension, setInstallingExtension] = useState(false);

  const installExtension = async () => {
    if (!extensionUrl.trim()) return;
    setInstallingExtension(true);
    try {
      const installed = await extensions.install(extensionUrl);
      setExtensionUrl('');
      Alert.alert('Extension installed', `${installed.manifest.name} is now installed.`);
    } catch (err: any) {
      Alert.alert('Extension install failed', err.message || String(err));
    } finally {
      setInstallingExtension(false);
    }
  };

  const updateInstalledExtension = async (operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (err: any) {
      Alert.alert('Extension update failed', err.message || String(err));
    }
  };

  const saveAccount = async () => {
    setSaving(true);
    try {
      // Credentials changed -> drop cached session so next request re-logins
      await clearZlibSession();
      await update({ email: email.trim(), password, remixUserId: remixUserId.trim(), remixUserKey: remixUserKey.trim() });
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } finally {
      setSaving(false);
    }
  };

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
          <Text className="text-sm text-neutral-300">
            Official: {extensions.bundled.map((extension) => extension.name).join(', ')}
          </Text>
          <Text className="text-xs text-neutral-400 leading-4">
            Third-party extensions are installed explicitly from their repository or manifest
            URL. Readio does not include a community extension browser.
          </Text>
          {extensions.error ? (
            <Text className="text-xs text-red-400">{extensions.error}</Text>
          ) : null}
          <TextInput
            value={extensionUrl}
            onChangeText={setExtensionUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://github.com/owner/repository"
            placeholderTextColor="#737373"
            className="h-11 px-3.5 rounded-xl text-white border border-neutral-800"
            style={{ backgroundColor: '#17171c' }}
          />
          <Pressable
            onPress={installExtension}
            disabled={installingExtension || !extensionUrl.trim()}
            className="h-11 rounded-xl items-center justify-center active:opacity-80 disabled:opacity-60"
            style={{ backgroundColor: '#8b7cf6' }}
          >
            {installingExtension ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="font-semibold text-white">Install third-party extension</Text>
            )}
          </Pressable>
          {extensions.thirdParty.map((extension) => (
            <View
              key={extension.manifest.id}
              className="flex-row items-center gap-3 border-t border-neutral-800 pt-3"
            >
              <View className="flex-1">
                <Text className="font-medium text-white">{extension.manifest.name}</Text>
                <Text className="text-xs text-neutral-500" numberOfLines={1}>
                  {extension.repositoryUrl}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  updateInstalledExtension(() =>
                    extensions.setEnabled(extension.manifest.id, !extension.enabled)
                  )
                }
                className="rounded-full border border-neutral-700 px-3 py-2"
              >
                <Text className="text-xs text-neutral-300">
                  {extension.enabled ? 'Enabled' : 'Disabled'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  updateInstalledExtension(() => extensions.remove(extension.manifest.id))
                }
                className="rounded-full border border-red-950 px-3 py-2"
              >
                <Text className="text-xs text-red-400">Remove</Text>
              </Pressable>
            </View>
          ))}
        </Section>

        <Section title="Z-Library Account">
          <View>
            <Text className="text-sm text-neutral-500 mb-1.5">Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor="#a3a3a3"
              className="h-11 px-3.5 rounded-xl text-white border border-neutral-800" style={{ backgroundColor: '#17171c' }}
            />
          </View>
          <View>
            <Text className="text-sm text-neutral-500 mb-1.5">Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Your password"
              placeholderTextColor="#a3a3a3"
              className="h-11 px-3.5 rounded-xl text-white border border-neutral-800" style={{ backgroundColor: '#17171c' }}
            />
          </View>
          <Text className="text-xs text-neutral-400 leading-4">
            Stored in the device Keychain and used only to obtain a session. Advanced alternative:
            paste remix_userid / remix_userkey from your browser cookies instead. Expo Go and an
            installed Reader build have separate encrypted storage, so credentials must be saved
            again after installing Reader for the first time.
          </Text>

          <View className="gap-2">
            <Text className="text-sm text-neutral-500">Remix User ID (optional)</Text>
            <TextInput
              value={remixUserId}
              onChangeText={setRemixUserId}
              autoCapitalize="none"
              placeholder="e.g. 1234567"
              placeholderTextColor="#a3a3a3"
              className="h-11 px-3.5 rounded-xl text-white border border-neutral-800" style={{ backgroundColor: '#17171c' }}
            />
            <Text className="text-sm text-neutral-500">Remix User Key (optional)</Text>
            <TextInput
              value={remixUserKey}
              onChangeText={setRemixUserKey}
              secureTextEntry
              autoCapitalize="none"
              placeholder="remix_userkey cookie value"
              placeholderTextColor="#a3a3a3"
              className="h-11 px-3.5 rounded-xl text-white border border-neutral-800" style={{ backgroundColor: '#17171c' }}
            />
          </View>

          <Pressable
            onPress={saveAccount}
            disabled={saving}
            className="h-11 rounded-xl items-center justify-center active:opacity-80 disabled:opacity-60" style={{ backgroundColor: '#8b7cf6' }}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-semibold">
                {savedAt ? 'Saved ✓' : 'Save account'}
              </Text>
            )}
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
            Local EPUB, PDF and ebook files are indexed from this folder. New Z-Library
            downloads are saved here too.
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

        <Section title="API Domain">
          <View className="flex-row flex-wrap gap-2">
            {DOMAINS.map((d) => {
              const active = d.value === settings.domain;
              return (
                <Pressable
                  key={d.label}
                  onPress={() => update({ domain: d.value })}
                  className={
                    active
                      ? 'px-3 py-2 rounded-full'
                      : 'px-3 py-2 rounded-full border border-neutral-800'
                  }
                  style={active ? { backgroundColor: '#8b7cf6' } : undefined}
                >
                  <Text className={active ? 'text-xs font-semibold text-white' : 'text-xs font-medium text-neutral-400'}>
                    {d.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="text-xs text-neutral-400 leading-4">
            Auto tries community mirrors until one answers and remembers it. A pinned mirror skips failover.
          </Text>
        </Section>

        <Section title="Preferred Format">
          <View className="flex-row flex-wrap gap-2">
            {FORMATS.map((f) => {
              const active = f.value === settings.preferredFormat;
              return (
                <Pressable
                  key={f.label}
                  onPress={() => update({ preferredFormat: f.value })}
                  className={
                    active
                      ? 'px-3 py-2 rounded-full'
                      : 'px-3 py-2 rounded-full border border-neutral-800'
                  }
                  style={active ? { backgroundColor: '#8b7cf6' } : undefined}
                >
                  <Text className={active ? 'text-xs font-semibold text-white' : 'text-xs font-medium text-neutral-400'}>
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="text-xs text-neutral-400 leading-4">
            Filters search results when set.
          </Text>
        </Section>

        <Text onPress={() => router.replace('/home')} className="text-center text-xs text-neutral-400 mt-2 mb-8">
          Reader · powered by Z-Library eapi
        </Text>
      </ScrollView>
    </View>
  );
}
