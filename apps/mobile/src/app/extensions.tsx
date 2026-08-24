import { Feather } from '@expo/vector-icons';
import type {
  ExtensionConfigValue,
  ExtensionManifest,
} from '@readoi/extension-protocol';
import type { InstalledExtension } from '@readoi/extension-runtime';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useExtensions } from '@/context/extensions-context';

function ExtensionCard({
  manifest,
  installed,
}: {
  manifest: ExtensionManifest;
  installed?: InstalledExtension;
}) {
  const extensions = useExtensions();
  const [configuring, setConfiguring] = useState(false);
  const [values, setValues] = useState<Record<string, ExtensionConfigValue>>({});
  const [saving, setSaving] = useState(false);
  const providesSearch = manifest.resources.some((resource) => resource.name === 'search');
  const enabled = installed?.enabled ?? true;

  useEffect(() => {
    extensions.configuration(manifest).then(setValues).catch((cause) => {
      Alert.alert(
        'Could not load extension configuration',
        cause instanceof Error ? cause.message : String(cause)
      );
    });
  }, [extensions, manifest]);

  const save = async () => {
    setSaving(true);
    try {
      await extensions.configure(manifest, values);
      setConfiguring(false);
    } catch (cause) {
      Alert.alert(
        'Could not save extension configuration',
        cause instanceof Error ? cause.message : String(cause)
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="rounded-2xl border border-neutral-800 bg-[#141419] p-4 gap-3">
      <View className="flex-row gap-3 items-start">
        <View className="h-11 w-11 rounded-xl bg-[#252332] items-center justify-center">
          <Feather name="package" size={21} color="#9d91ff" />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-base font-semibold text-white">{manifest.name}</Text>
            <Text className="text-[10px] text-neutral-500">v{manifest.version}</Text>
          </View>
          <Text className="text-xs text-neutral-400 mt-1 leading-4">
            {manifest.description}
          </Text>
          <Text className="text-[10px] text-neutral-600 mt-1">
            {installed ? 'Third party' : 'Official'}
            {manifest.author ? ` · ${manifest.author}` : ''}
          </Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {providesSearch && enabled ? (
          <Pressable
            onPress={() => extensions.setSearchExtension(manifest.id)}
            className="rounded-full border px-3 py-2"
            style={{
              borderColor:
                extensions.searchExtensionId === manifest.id ? '#8b7cf6' : '#34343d',
              backgroundColor:
                extensions.searchExtensionId === manifest.id ? '#27233f' : 'transparent',
            }}
          >
            <Text className="text-xs font-medium text-neutral-200">
              {extensions.searchExtensionId === manifest.id ? 'Search provider' : 'Use for search'}
            </Text>
          </Pressable>
        ) : null}
        {!!manifest.config?.length && (
          <Pressable
            onPress={() => setConfiguring((current) => !current)}
            className="rounded-full border border-neutral-700 px-3 py-2"
          >
            <Text className="text-xs font-medium text-neutral-200">
              {configuring ? 'Close configuration' : 'Configure'}
            </Text>
          </Pressable>
        )}
        {installed ? (
          <>
            <Pressable
              onPress={() => extensions.setEnabled(manifest.id, !installed.enabled)}
              className="rounded-full border border-neutral-700 px-3 py-2"
            >
              <Text className="text-xs font-medium text-neutral-300">
                {installed.enabled ? 'Disable' : 'Enable'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                Alert.alert('Remove extension?', manifest.name, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => void extensions.remove(manifest.id),
                  },
                ])
              }
              className="rounded-full border border-red-950 px-3 py-2"
            >
              <Text className="text-xs font-medium text-red-400">Remove</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {configuring ? (
        <View className="border-t border-neutral-800 pt-3 gap-3">
          {manifest.config?.map((field) => {
            const value = values[field.key] ?? field.default ?? '';
            if (field.type === 'checkbox') {
              return (
                <Pressable
                  key={field.key}
                  onPress={() =>
                    setValues((current) => ({ ...current, [field.key]: !Boolean(value) }))
                  }
                  className="flex-row items-center justify-between rounded-xl border border-neutral-800 px-3.5 h-11"
                >
                  <Text className="text-sm text-neutral-300">{field.title}</Text>
                  <Feather
                    name={value ? 'check-circle' : 'circle'}
                    size={19}
                    color={value ? '#8b7cf6' : '#666674'}
                  />
                </Pressable>
              );
            }
            if (field.type === 'select') {
              return (
                <View key={field.key} className="gap-2">
                  <Text className="text-xs text-neutral-400">
                    {field.title}{field.required ? ' *' : ''}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {field.options.map((option) => (
                      <Pressable
                        key={option.value}
                        onPress={() =>
                          setValues((current) => ({ ...current, [field.key]: option.value }))
                        }
                        className="rounded-full px-3 py-2"
                        style={{
                          backgroundColor: value === option.value ? '#8b7cf6' : '#202027',
                        }}
                      >
                        <Text className="text-xs text-neutral-200">{option.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            }
            return (
              <View key={field.key} className="gap-1.5">
                <Text className="text-xs text-neutral-400">
                  {field.title}{field.required ? ' *' : ''}
                </Text>
                <TextInput
                  value={String(value)}
                  onChangeText={(next) =>
                    setValues((current) => ({
                      ...current,
                      [field.key]: field.type === 'number' ? Number(next) : next,
                    }))
                  }
                  secureTextEntry={field.type === 'password'}
                  keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="h-11 rounded-xl border border-neutral-800 bg-[#17171c] px-3.5 text-white"
                />
              </View>
            );
          })}
          <Pressable
            onPress={save}
            disabled={saving}
            className="h-11 rounded-xl bg-[#8b7cf6] items-center justify-center disabled:opacity-60"
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="font-semibold text-white">Save configuration</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function ExtensionsScreen() {
  const router = useRouter();
  const extensions = useExtensions();
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [installing, setInstalling] = useState(false);

  const install = async () => {
    if (!repositoryUrl.trim()) return;
    setInstalling(true);
    try {
      const installed = await extensions.install(repositoryUrl);
      setRepositoryUrl('');
      Alert.alert(
        'Extension installed',
        installed.manifest.behaviorHints?.configurationRequired
          ? `Configure ${installed.manifest.name} before enabling it.`
          : `${installed.manifest.name} is ready.`
      );
    } catch (cause) {
      Alert.alert(
        'Extension install failed',
        cause instanceof Error ? cause.message : String(cause)
      );
    } finally {
      setInstalling(false);
    }
  };

  return (
    <View className="flex-1 bg-[#0b0b0f]">
      <View className="h-16 flex-row items-center gap-3 px-5">
        <Pressable
          onPress={() => router.back()}
          className="h-10 w-10 rounded-full bg-[#17171c] items-center justify-center"
        >
          <Feather name="chevron-left" size={23} color="#dddde5" />
        </Pressable>
        <Text className="text-xl font-semibold text-white">Extensions</Text>
      </View>
      <ScrollView contentContainerClassName="px-5 pb-10 gap-5">
        <View className="rounded-2xl bg-[#141419] p-4 gap-3">
          <Text className="text-sm font-semibold text-white">Install from repository</Text>
          <Text className="text-xs leading-4 text-neutral-400">
            Paste a repository or manifest URL. Third-party extensions are not reviewed or
            browsable inside Readio.
          </Text>
          <View className="flex-row gap-2">
            <TextInput
              value={repositoryUrl}
              onChangeText={setRepositoryUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://github.com/owner/repository"
              placeholderTextColor="#6f6f7a"
              className="flex-1 h-11 rounded-xl border border-neutral-800 bg-[#17171c] px-3.5 text-white"
            />
            <Pressable
              onPress={install}
              disabled={installing || !repositoryUrl.trim()}
              className="h-11 px-5 rounded-xl bg-[#8b7cf6] items-center justify-center disabled:opacity-50"
            >
              {installing ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="font-semibold text-white">Install</Text>
              )}
            </Pressable>
          </View>
          {extensions.error ? <Text className="text-xs text-red-400">{extensions.error}</Text> : null}
        </View>

        <View className="gap-3">
          <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400">
            Installed
          </Text>
          {extensions.thirdParty.map((extension) => (
            <ExtensionCard
              key={extension.manifest.id}
              manifest={extension.manifest}
              installed={extension}
            />
          ))}
          {!extensions.thirdParty.length ? (
            <Text className="text-sm text-neutral-500">No third-party extensions installed.</Text>
          ) : null}
        </View>

        <View className="gap-3">
          <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400">
            Official
          </Text>
          {extensions.bundled.map((manifest) => (
            <ExtensionCard key={manifest.id} manifest={manifest} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
