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
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearZlibSession, useSettings } from '@/context/settings-context';
import { isSafLocation, pickDownloadFolder } from '@/lib/download';
import type { Settings } from '@/lib/settings';

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
      <View className="rounded-2xl bg-neutral-100 dark:bg-neutral-900 px-4 py-4 gap-4">{children}</View>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { settings, update } = useSettings();

  const [email, setEmail] = useState(settings.email);
  const [password, setPassword] = useState(settings.password);
  const [remixUserId, setRemixUserId] = useState(settings.remixUserId);
  const [remixUserKey, setRemixUserKey] = useState(settings.remixUserKey);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

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

  const chooseFolder = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert(
        'Not supported here',
        'Choosing a custom folder needs Android Storage Access Framework. On iOS, files are saved to the app’s Documents/downloads folder (visible in the Files app).'
      );
      return;
    }
    try {
      const picked = await pickDownloadFolder();
      if (!picked) return; // cancelled
      await update({ downloadLocation: picked.uri });
    } catch (err: any) {
      Alert.alert('Folder picker failed', err.message || String(err));
    }
  };

  const resetFolder = async () => {
    await update({ downloadLocation: null });
  };

  const locationLabel =
    !settings.downloadLocation
      ? 'App documents / downloads'
      : isSafLocation(settings.downloadLocation)
        ? decodeURIComponent(settings.downloadLocation.split('/').pop() || settings.downloadLocation)
        : settings.downloadLocation;

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950" edges={['top']}>
      <ScrollView contentContainerClassName="px-4 py-5">
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
              className="h-11 px-3.5 rounded-xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700"
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
              className="h-11 px-3.5 rounded-xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700"
            />
          </View>
          <Text className="text-xs text-neutral-400 leading-4">
            Stored in the device Keychain and used only to obtain a session. Advanced alternative:
            paste remix_userid / remix_userkey from your browser cookies instead.
          </Text>

          <View className="gap-2">
            <Text className="text-sm text-neutral-500">Remix User ID (optional)</Text>
            <TextInput
              value={remixUserId}
              onChangeText={setRemixUserId}
              autoCapitalize="none"
              placeholder="e.g. 1234567"
              placeholderTextColor="#a3a3a3"
              className="h-11 px-3.5 rounded-xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700"
            />
            <Text className="text-sm text-neutral-500">Remix User Key (optional)</Text>
            <TextInput
              value={remixUserKey}
              onChangeText={setRemixUserKey}
              secureTextEntry
              autoCapitalize="none"
              placeholder="remix_userkey cookie value"
              placeholderTextColor="#a3a3a3"
              className="h-11 px-3.5 rounded-xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700"
            />
          </View>

          <Pressable
            onPress={saveAccount}
            disabled={saving}
            className="h-11 rounded-xl bg-rose-600 items-center justify-center active:bg-rose-700 disabled:opacity-60"
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

        <Section title="Download Location">
          <Text numberOfLines={2} className="text-sm text-neutral-700 dark:text-neutral-200">
            {locationLabel}
          </Text>
          <View className="flex-row gap-2">
            <Pressable
              onPress={chooseFolder}
              className="flex-1 h-11 rounded-xl bg-neutral-900 dark:bg-white items-center justify-center active:opacity-80"
            >
              <Text className="font-semibold text-white dark:text-neutral-900">Choose folder…</Text>
            </Pressable>
            {settings.downloadLocation && (
              <Pressable
                onPress={resetFolder}
                className="h-11 px-4 rounded-xl bg-neutral-200 dark:bg-neutral-800 items-center justify-center active:opacity-80"
              >
                <Text className="font-medium text-neutral-600 dark:text-neutral-300">Reset</Text>
              </Pressable>
            )}
          </View>
          <Text className="text-xs text-neutral-400 leading-4">
            Books are downloaded to this folder without being opened in-app.
          </Text>
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
                      ? 'px-3 py-2 rounded-full bg-rose-600'
                      : 'px-3 py-2 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700'
                  }
                >
                  <Text className={active ? 'text-xs font-semibold text-white' : 'text-xs font-medium text-neutral-600 dark:text-neutral-300'}>
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
                      ? 'px-3 py-2 rounded-full bg-rose-600'
                      : 'px-3 py-2 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700'
                  }
                >
                  <Text className={active ? 'text-xs font-semibold text-white' : 'text-xs font-medium text-neutral-600 dark:text-neutral-300'}>
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

        <Text onPress={() => router.push('/')} className="text-center text-xs text-neutral-400 mt-2 mb-8">
          Reader · powered by Z-Library eapi
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
