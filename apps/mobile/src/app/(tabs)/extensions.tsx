import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type {
  ExtensionConfigValue,
  ExtensionManifest,
  ExtensionResourceName,
} from '@tomeio/extension-protocol';
import type { InstalledExtension } from '@tomeio/extension-runtime';
import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  AppDialog,
  colors,
  FilterChip,
  MOBILE_PAGE_GUTTER,
  PillButton,
  SearchField,
  SelectField,
  usePageBottomPadding,
} from '@/components/app-ui';
import { useExtensions } from '@/context/extensions-context';

type FeatherName = ComponentProps<typeof Feather>['name'];
type ScopeFilter = 'all' | 'enabled';
type ResourceFilter = 'all' | ExtensionResourceName;
type FilterPicker = 'scope' | 'resource';

const SCOPE_FILTERS: { label: string; value: ScopeFilter }[] = [
  { label: 'Installed', value: 'all' },
  { label: 'Enabled', value: 'enabled' },
];

const RESOURCE_FILTERS: { label: string; value: ResourceFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Catalogs', value: 'catalog' },
  { label: 'Search', value: 'search' },
  { label: 'Metadata', value: 'meta' },
  { label: 'Downloads', value: 'acquisition' },
];

const RESOURCE_LABELS: Record<ExtensionResourceName, string> = {
  catalog: 'Catalogs',
  search: 'Search',
  meta: 'Metadata',
  acquisition: 'Downloads',
};

type ExtensionBranding = {
  color: string;
  icon: FeatherName;
  mark: string;
  logo?: number;
  logoScale?: number;
};

const BRANDING: Record<string, ExtensionBranding> = {
  'org.tomeio.open-library': {
    color: '#f4f1e8',
    icon: 'book-open',
    mark: 'OL',
    logo: require('../../../assets/images/extensions/open-library.png'),
    logoScale: 0.88,
  },
  'org.tomeio.internet-archive': {
    color: '#f2f2f2',
    icon: 'archive',
    mark: 'IA',
    logo: require('../../../assets/images/extensions/internet-archive.png'),
    logoScale: 0.68,
  },
  'org.tomeio.project-gutenberg': {
    color: '#dce8ec',
    icon: 'feather',
    mark: 'PG',
    logo: require('../../../assets/images/extensions/project-gutenberg.jpg'),
    logoScale: 0.94,
  },
  'community.tomeio.zlibrary': { color: '#8a3945', icon: 'book', mark: 'Z' },
};

function brandingFor(manifest: ExtensionManifest): ExtensionBranding {
  return BRANDING[manifest.id] ?? { color: '#3d375c', icon: 'package' as const, mark: 'R' };
}

function ExtensionLogo({
  manifest,
  size = 72,
  radius,
}: {
  manifest: ExtensionManifest;
  size?: number;
  radius?: number;
}) {
  const branding = brandingFor(manifest);
  const logoSize = Math.round(size * (branding.logoScale ?? 0.82));
  const remoteLogo = branding.logo ? undefined : manifest.icon;
  const [remoteLogoFailed, setRemoteLogoFailed] = useState(false);

  useEffect(() => setRemoteLogoFailed(false), [remoteLogo]);

  const logoSource = branding.logo ??
    (remoteLogo && !remoteLogoFailed ? { uri: remoteLogo } : undefined);

  return (
    <View
      className="items-center justify-center overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? Math.round(size * 0.24),
        backgroundColor: logoSource ? '#f4f4f5' : branding.color,
      }}
    >
      {logoSource ? (
        <Image
          source={logoSource}
          contentFit="contain"
          onError={() => setRemoteLogoFailed(true)}
          accessibilityLabel={`${manifest.name} logo`}
          style={{ width: logoSize, height: logoSize }}
        />
      ) : (
        <>
          <Feather name={branding.icon} size={Math.round(size * 0.34)} color="white" />
          <Text className="mt-0.5 text-[9px] font-extrabold text-white/90">{branding.mark}</Text>
        </>
      )}
    </View>
  );
}

function ExtensionCard({
  manifest,
  installed,
  wide,
  onConfigure,
  onRemove,
  onShare,
}: {
  manifest: ExtensionManifest;
  installed?: InstalledExtension;
  wide: boolean;
  onConfigure: () => void;
  onRemove: () => void;
  onShare: () => void;
}) {
  const enabled = installed?.enabled ?? true;
  const resources = Array.from(
    new Set(manifest.resources.map((resource) => RESOURCE_LABELS[resource.name]))
  );
  const cardPadding = wide ? 24 : 16;
  const cardRadius = wide ? 36 : 28;
  const logoRadius = cardRadius - cardPadding;

  return (
    <View
      className={wide ? 'min-h-[172px] border flex-row items-center' : 'border'}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderRadius: cardRadius,
        padding: cardPadding,
        gap: cardPadding,
        opacity: enabled ? 1 : 0.62,
      }}
    >
      <View className="flex-row flex-1 items-center" style={{ gap: cardPadding }}>
        <ExtensionLogo manifest={manifest} size={wide ? 104 : 60} radius={logoRadius} />
        <View className="flex-1">
          <View className="flex-row flex-wrap items-baseline gap-x-2">
            <Text
              numberOfLines={2}
              className={
                wide ? 'text-2xl font-light text-white' : 'text-lg font-medium text-white'
              }
            >
              {manifest.name}
            </Text>
            <Text className="text-xs text-neutral-500">v{manifest.version}</Text>
          </View>
          <Text className="mt-1 text-[11px] text-neutral-500">
            Book · {resources.join(' · ')}
          </Text>
          <Text numberOfLines={wide ? 2 : 3} className="mt-2 text-sm leading-5 text-neutral-300">
            {manifest.description}
          </Text>
          <Text className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            {installed ? 'Third party' : 'Official'}
            {manifest.author ? ` · ${manifest.author}` : ''}
          </Text>
        </View>
      </View>

      <View className={wide ? 'w-72 gap-2' : 'flex-row flex-wrap items-center gap-2'}>
        <View className={wide ? 'flex-row gap-3' : 'flex-row gap-2'}>
          {!!manifest.config?.length ? (
            <Pressable
              onPress={onConfigure}
              accessibilityLabel={`Configure ${manifest.name}`}
              className="h-12 w-12 items-center justify-center active:opacity-75"
              style={{ backgroundColor: colors.success, borderRadius: 24 }}
            >
              <Feather name="settings" size={21} color="white" />
            </Pressable>
          ) : null}
          <Pressable
            onPress={onRemove}
            disabled={!installed}
            className="h-12 min-w-[156px] flex-1 items-center justify-center border-2 px-6 active:opacity-75 disabled:opacity-45"
            style={{ borderColor: colors.textMuted, borderRadius: 24 }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.textMuted }}>
              Uninstall
            </Text>
          </Pressable>
        </View>
        {installed ? (
          <Pressable
            onPress={onShare}
            className="h-11 flex-row items-center justify-center gap-3 active:opacity-70"
          >
            <Feather name="share-2" size={19} color={colors.text} />
            <Text className="text-sm font-bold" style={{ color: colors.text }}>
              Share add-on
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ConfigurationSheet({
  manifest,
  onClose,
}: {
  manifest: ExtensionManifest | null;
  onClose: () => void;
}) {
  const extensions = useExtensions();
  const [values, setValues] = useState<Record<string, ExtensionConfigValue>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!manifest) return;
    let active = true;
    setValues({});
    setLoading(true);
    extensions
      .configuration(manifest)
      .then((configuration) => active && setValues(configuration))
      .catch((cause) => {
        if (active) {
          Alert.alert(
            'Could not load configuration',
            cause instanceof Error ? cause.message : String(cause)
          );
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [extensions.configuration, manifest]);

  const save = async () => {
    if (!manifest) return;
    setSaving(true);
    try {
      await extensions.configure(manifest, values);
      onClose();
    } catch (cause) {
      Alert.alert(
        'Could not save configuration',
        cause instanceof Error ? cause.message : String(cause)
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppDialog
      visible={!!manifest}
      title={manifest ? `Configure ${manifest.name}` : 'Configure add-on'}
      onClose={onClose}
    >
      {loading ? (
        <View className="h-32 items-center justify-center">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          className="max-h-[560px]"
          contentContainerClassName="gap-4"
          keyboardShouldPersistTaps="handled"
        >
          {manifest?.config?.map((field) => {
            const value = values[field.key] ?? field.default ?? '';
            if (field.type === 'checkbox') {
              return (
                <Pressable
                  key={field.key}
                  onPress={() =>
                    setValues((current) => ({ ...current, [field.key]: !Boolean(value) }))
                  }
                  className="h-12 rounded-xl border border-[#30303a] px-4 flex-row items-center justify-between"
                >
                  <Text className="text-sm text-neutral-200">{field.title}</Text>
                  <Feather
                    name={value ? 'check-circle' : 'circle'}
                    size={20}
                    color={value ? colors.accent : '#666674'}
                  />
                </Pressable>
              );
            }
            if (field.type === 'select') {
              return (
                <View key={field.key} className="gap-2">
                  <Text className="text-xs text-neutral-400">
                    {field.title}
                    {field.required ? ' *' : ''}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {field.options.map((option) => (
                      <FilterChip
                        key={option.value}
                        label={option.label}
                        selected={value === option.value}
                        onPress={() =>
                          setValues((current) => ({
                            ...current,
                            [field.key]: option.value,
                          }))
                        }
                      />
                    ))}
                  </View>
                </View>
              );
            }
            return (
              <View key={field.key} className="gap-2">
                <Text className="text-xs text-neutral-400">
                  {field.title}
                  {field.required ? ' *' : ''}
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
                  className="h-12 rounded-xl border border-[#30303a] bg-[#202029] px-4 text-white"
                />
              </View>
            );
          })}
          <Pressable
            onPress={save}
            disabled={saving}
            className="mt-1 h-12 rounded-xl items-center justify-center disabled:opacity-50"
            style={{ backgroundColor: colors.accent }}
          >
            {saving ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text className="font-semibold" style={{ color: colors.onAccent }}>Save configuration</Text>
            )}
          </Pressable>
        </ScrollView>
      )}
    </AppDialog>
  );
}

function FilterDialog({
  picker,
  scope,
  resource,
  onScope,
  onResource,
  onClose,
}: {
  picker: FilterPicker | null;
  scope: ScopeFilter;
  resource: ResourceFilter;
  onScope: (value: ScopeFilter) => void;
  onResource: (value: ResourceFilter) => void;
  onClose: () => void;
}) {
  const options: { label: string; value: string }[] =
    picker === 'scope' ? SCOPE_FILTERS : RESOURCE_FILTERS;
  const selectedValue = picker === 'scope' ? scope : resource;

  return (
    <AppDialog
      visible={picker !== null}
      title={picker === 'scope' ? 'Add-ons' : 'Capability'}
      onClose={onClose}
    >
      <View className="gap-2">
        {options.map((option) => {
          const selected = option.value === selectedValue;
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                if (picker === 'scope') onScope(option.value as ScopeFilter);
                else onResource(option.value as ResourceFilter);
                onClose();
              }}
              className="h-14 flex-row items-center gap-3 border px-4 active:opacity-80"
              style={{
                borderRadius: 14,
                borderColor: selected ? colors.accent : colors.border,
                backgroundColor: selected ? colors.accentMuted : colors.surfaceRaised,
              }}
            >
              <Feather
                name={selected ? 'check-circle' : 'circle'}
                size={19}
                color={selected ? colors.accent : colors.textMuted}
              />
              <Text className="text-sm font-medium" style={{ color: colors.text }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </AppDialog>
  );
}

export default function ExtensionsScreen() {
  const extensions = useExtensions();
  const { width } = useWindowDimensions();
  const bottomPadding = usePageBottomPadding(42);
  const wide = width >= 1050;
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [resource, setResource] = useState<ResourceFilter>('all');
  const [query, setQuery] = useState('');
  const [filterPicker, setFilterPicker] = useState<FilterPicker | null>(null);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [configurationManifest, setConfigurationManifest] =
    useState<ExtensionManifest | null>(null);

  const entries = useMemo(() => {
    const bundled = extensions.bundled.map((manifest) => ({
      manifest,
      installed: undefined,
    }));
    const thirdParty = extensions.thirdParty.map((installed) => ({
      manifest: installed.manifest,
      installed,
    }));
    const needle = query.trim().toLocaleLowerCase();
    return [...bundled, ...thirdParty].filter(({ manifest, installed }) => {
      if (scope === 'enabled' && installed && !installed.enabled) return false;
      if (
        resource !== 'all' &&
        !manifest.resources.some((candidate) => candidate.name === resource)
      ) {
        return false;
      }
      if (!needle) return true;
      return `${manifest.name} ${manifest.description} ${manifest.author ?? ''}`
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [extensions.bundled, extensions.thirdParty, query, resource, scope]);

  const install = async () => {
    const url = repositoryUrl.trim();
    if (!url) return;
    setInstalling(true);
    try {
      const installed = await extensions.install(url);
      setRepositoryUrl('');
      setAddOpen(false);
      if (installed.manifest.behaviorHints?.configurationRequired) {
        setConfigurationManifest(installed.manifest);
      }
    } catch (cause) {
      Alert.alert(
        'Add-on install failed',
        cause instanceof Error ? cause.message : String(cause)
      );
    } finally {
      setInstalling(false);
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: wide ? 24 : MOBILE_PAGE_GUTTER,
          paddingTop: wide ? 32 : 12,
          paddingBottom: bottomPadding,
        }}
      >
        <View
          className={wide ? 'mb-7 flex-row items-center gap-3' : 'mb-6 flex-row flex-wrap gap-3'}
        >
          <View style={{ width: wide ? 210 : undefined, flex: wide ? undefined : 1 }}>
            <SelectField
              dense
              label={
                SCOPE_FILTERS.find((option) => option.value === scope)?.label ?? 'Installed'
              }
              onPress={() => setFilterPicker('scope')}
            />
          </View>
          <View style={{ width: wide ? 210 : undefined, flex: wide ? undefined : 1 }}>
            <SelectField
              dense
              label={
                RESOURCE_FILTERS.find((option) => option.value === resource)?.label ?? 'All'
              }
              onPress={() => setFilterPicker('resource')}
            />
          </View>
          <PillButton
            label="Add add-on"
            icon="plus"
            variant="success"
            onPress={() => setAddOpen(true)}
          />
          {wide ? <View className="flex-1" /> : null}
          <View style={{ width: wide ? 280 : '100%' }}>
            <SearchField value={query} onChangeText={setQuery} placeholder="Search add-ons" />
          </View>
        </View>

        {extensions.error ? (
          <Text className="mb-4 text-xs text-red-400">{extensions.error}</Text>
        ) : null}
        {!extensions.ready ? (
          <View className="h-48 items-center justify-center">
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : entries.length ? (
          <View className="gap-4">
            {entries.map(({ manifest, installed }) => (
              <ExtensionCard
                key={manifest.id}
                manifest={manifest}
                installed={installed}
                wide={wide}
                onConfigure={() => setConfigurationManifest(manifest)}
                onShare={() => {
                  if (!installed) return;
                  void Share.share({
                    title: manifest.name,
                    message: installed.repositoryUrl,
                    url: installed.repositoryUrl,
                  }).catch((cause) =>
                    Alert.alert(
                      'Could not share add-on',
                      cause instanceof Error ? cause.message : String(cause)
                    )
                  );
                }}
                onRemove={() =>
                  Alert.alert('Remove add-on?', manifest.name, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () =>
                        void extensions.remove(manifest.id).catch((cause) =>
                          Alert.alert(
                            'Could not remove add-on',
                            cause instanceof Error ? cause.message : String(cause)
                          )
                        ),
                    },
                  ])
                }
              />
            ))}
          </View>
        ) : (
          <View className="h-52 items-center justify-center gap-3">
            <Feather name="package" size={34} color="#555560" />
            <Text className="text-sm text-neutral-500">No add-ons match these filters.</Text>
          </View>
        )}
      </ScrollView>

      <AppDialog
        visible={addOpen}
        title="Add add-on"
        onClose={() => !installing && setAddOpen(false)}
      >
        <Text className="mb-4 text-sm leading-5 text-neutral-400">
          Paste a trusted GitHub repository or manifest URL. Third-party add-ons are not reviewed
          or browsable inside Tomeio.
        </Text>
        <TextInput
          value={repositoryUrl}
          onChangeText={setRepositoryUrl}
          onSubmitEditing={() => void install()}
          editable={!installing}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          placeholder="https://github.com/owner/repository"
          placeholderTextColor="#6f6f7a"
          className="h-12 rounded-xl border border-[#30303a] bg-[#202029] px-4 text-white"
        />
        <View className="mt-4 flex-row justify-end gap-3">
          <Pressable
            onPress={() => setAddOpen(false)}
            disabled={installing}
            className="h-11 rounded-xl px-5 items-center justify-center"
          >
            <Text className="font-semibold text-neutral-300">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => void install()}
            disabled={installing || !repositoryUrl.trim()}
            className="h-11 min-w-[104px] rounded-xl bg-[#25ba73] px-5 items-center justify-center disabled:opacity-50"
          >
            {installing ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="font-bold text-white">Install</Text>
            )}
          </Pressable>
        </View>
      </AppDialog>

      <FilterDialog
        picker={filterPicker}
        scope={scope}
        resource={resource}
        onScope={setScope}
        onResource={setResource}
        onClose={() => setFilterPicker(null)}
      />

      <ConfigurationSheet
        manifest={configurationManifest}
        onClose={() => setConfigurationManifest(null)}
      />
    </View>
  );
}
