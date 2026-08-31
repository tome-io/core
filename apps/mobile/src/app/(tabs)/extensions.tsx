import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import type {
  ExtensionConfigValue,
  ExtensionManifest,
  ExtensionResourceName,
} from '@tomeio/extension-protocol';
import type { InstalledExtension } from '@tomeio/extension-runtime';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
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
import { AppBottomSheet } from '@/components/app-bottom-sheet';
import { AppErrorDialog } from '@/components/app-error-dialog';
import { useExtensions } from '@/context/extensions-context';
import { isSafLocation, pickDownloadFolder } from '@/lib/download';
import { beginFolderPicker, endFolderPicker } from '@/lib/folder-picker-lock';

type FeatherName = ComponentProps<typeof Feather>['name'];
type ScopeFilter = 'installed' | 'community' | 'enabled';
type ResourceFilter = 'all' | ExtensionResourceName;
type FilterPicker = 'scope' | 'resource';

const EXTENSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
let lastExtensionRefreshAt = 0;

const SCOPE_FILTERS: { label: string; value: ScopeFilter }[] = [
  { label: 'Installed', value: 'installed' },
  { label: 'Community', value: 'community' },
  { label: 'Enabled', value: 'enabled' },
];

const RESOURCE_FILTERS: { label: string; value: ResourceFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Catalogs', value: 'catalog' },
  { label: 'Search', value: 'search' },
  { label: 'Metadata', value: 'meta' },
  { label: 'Resolution', value: 'resolve' },
  { label: 'Reviews', value: 'reviews' },
  { label: 'Downloads', value: 'acquisition' },
  { label: 'Readers', value: 'reader' },
  { label: 'Library actions', value: 'libraryAction' },
  { label: 'Library imports', value: 'libraryImport' },
];

const RESOURCE_LABELS: Record<ExtensionResourceName, string> = {
  catalog: 'Catalogs',
  search: 'Search',
  meta: 'Metadata',
  resolve: 'Resolution',
  reviews: 'Reviews',
  acquisition: 'Downloads',
  reader: 'Reader sync',
  libraryAction: 'Library actions',
  libraryImport: 'Library imports',
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
  'org.tomeio.project-gutenberg': {
    color: '#dce8ec',
    icon: 'feather',
    mark: 'PG',
    logo: require('../../../assets/images/extensions/project-gutenberg.jpg'),
    logoScale: 0.94,
  },
  'community.tomeio.google-books': {
    color: '#43526b',
    icon: 'book-open',
    mark: 'B',
  },
  'community.tomeio.zlibrary': { color: '#8a3945', icon: 'book', mark: 'Z' },
  'community.tomeio.moon-reader': {
    color: '#2f6fb0',
    icon: 'moon',
    mark: 'M+',
    logoScale: 1,
  },
  'community.tomeio.kobo': {
    color: '#bf0000',
    icon: 'book-open',
    mark: 'K',
  },
};

function brandingFor(manifest: ExtensionManifest): ExtensionBranding {
  return BRANDING[manifest.id] ?? { color: '#3d375c', icon: 'package' as const, mark: 'R' };
}

function directoryLabel(value: string): string {
  const segment = value.split('/').pop() || value;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
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
  const [failedRemoteLogo, setFailedRemoteLogo] = useState<string | null>(null);

  const logoSource = branding.logo ??
    (remoteLogo && failedRemoteLogo !== remoteLogo ? { uri: remoteLogo } : undefined);

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
          onError={() => remoteLogo && setFailedRemoteLogo(remoteLogo)}
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
  onInstall,
  onRemove,
  onShare,
}: {
  manifest: ExtensionManifest;
  installed?: InstalledExtension;
  wide: boolean;
  onConfigure: () => void;
  onInstall?: () => void;
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
  const canConfigure = !!manifest.config?.length && (installed || !onInstall);
  const hasActions = canConfigure || !!installed || !!onInstall;

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
      <View
        className={wide ? 'flex-row flex-1 items-start' : 'flex-row items-start'}
        style={{ gap: cardPadding }}
      >
        <ExtensionLogo manifest={manifest} size={wide ? 104 : 60} radius={logoRadius} />
        <View className="flex-1">
          <View className="flex-row flex-wrap items-baseline gap-x-2">
            <Text
              numberOfLines={2}
              className={wide ? 'text-2xl font-light' : 'text-lg font-medium'}
              style={{ color: colors.text }}
            >
              {manifest.name}
            </Text>
            <Text className="text-xs" style={{ color: colors.textMuted }}>
              v{manifest.version}
            </Text>
          </View>
          <Text className="mt-1 text-[11px]" style={{ color: colors.textMuted }}>
            Book · {resources.join(' · ')}
          </Text>
          <Text
            numberOfLines={wide ? 2 : 3}
            className="mt-2 text-sm leading-5"
            style={{ color: colors.text }}
          >
            {manifest.description}
          </Text>
          <Text
            className="mt-2 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: colors.textMuted }}
          >
            {installed?.source === 'community'
              ? 'Community'
              : installed
                ? 'Third party'
                : onInstall
                  ? 'Community'
                  : 'Official'}
            {manifest.author ? ` · ${manifest.author}` : ''}
          </Text>
        </View>
      </View>

      {hasActions ? (
        <View className={`${wide ? 'w-72' : 'w-full'} gap-2`}>
          {canConfigure ? (
            <PillButton
              label="Configure"
              icon="settings"
              variant="accent"
              onPress={onConfigure}
              fullWidth
            />
          ) : null}
          {installed ? (
            <>
              <PillButton
                label="Uninstall"
                icon="trash-2"
                variant="danger"
                onPress={onRemove}
                fullWidth
              />
              <PillButton
                label="Share add-on"
                icon="share-2"
                variant="outline"
                onPress={onShare}
                fullWidth
              />
            </>
          ) : onInstall ? (
            <PillButton
              label="Install"
              icon="download"
              variant="accent"
              onPress={onInstall}
              fullWidth
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ConfigurationSheet({
  manifest,
  onClose,
  onError,
}: {
  manifest: ExtensionManifest | null;
  onClose: () => void;
  onError: (title: string, cause: unknown) => void;
}) {
  const extensions = useExtensions();
  const [values, setValues] = useState<Record<string, ExtensionConfigValue>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!manifest) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setValues({});
      setLoading(true);
      try {
        const configuration = await extensions.configuration(manifest);
        if (active) setValues(configuration);
      } catch (cause) {
        if (active) onError('Could not load configuration', cause);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [extensions, manifest, onError]);

  const save = async () => {
    if (!manifest) return;
    setSaving(true);
    try {
      await extensions.configure(manifest, values);
      onClose();
    } catch (cause) {
      onError('Could not save configuration', cause);
    } finally {
      setSaving(false);
    }
  };

  const chooseDirectory = async (fieldKey: string, current: unknown) => {
    if (Platform.OS !== 'android') {
      Alert.alert(
        'Not supported here',
        'Reader add-on folders currently use Android Storage Access Framework.'
      );
      return;
    }
    beginFolderPicker();
    try {
      const picked = await pickDownloadFolder(
        typeof current === 'string' && isSafLocation(current) ? current : null
      );
      if (picked) {
        setValues((existing) => ({ ...existing, [fieldKey]: picked.uri }));
      }
    } catch (cause) {
      onError('Folder picker failed', cause);
    } finally {
      endFolderPicker();
    }
  };

  return (
    <AppBottomSheet
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
          className="flex-1 px-5"
          contentContainerClassName="gap-4 pb-10"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {manifest?.config?.map((field) => {
            const value = values[field.key] ?? field.default ?? '';
            if (field.type === 'directory') {
              const label =
                typeof value === 'string' && value
                  ? directoryLabel(value)
                  : 'Choose folder';
              return (
                <View key={field.key} className="gap-2">
                  <Text className="text-xs" style={{ color: colors.textMuted }}>
                    {field.title}
                    {field.required ? ' *' : ''}
                  </Text>
                  <SelectField
                    label={label}
                    icon="folder"
                    onPress={() => void chooseDirectory(field.key, value)}
                  />
                </View>
              );
            }
            if (field.type === 'checkbox') {
              return (
                <Pressable
                  key={field.key}
                  onPress={() =>
                    setValues((current) => ({ ...current, [field.key]: !Boolean(value) }))
                  }
                  className="h-12 rounded-xl border px-4 flex-row items-center justify-between"
                  style={{ borderColor: colors.border }}
                >
                  <Text className="text-sm" style={{ color: colors.text }}>{field.title}</Text>
                  <Feather
                    name={value ? 'check-circle' : 'circle'}
                    size={20}
                    color={value ? colors.accent : colors.textMuted}
                  />
                </Pressable>
              );
            }
            if (field.type === 'select') {
              return (
                <View key={field.key} className="gap-2">
                  <Text className="text-xs" style={{ color: colors.textMuted }}>
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
                <Text className="text-xs" style={{ color: colors.textMuted }}>
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
                  selectTextOnFocus={field.type === 'password'}
                  keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="h-12 rounded-xl border px-4"
                  style={{
                    backgroundColor: colors.surfaceRaised,
                    borderColor: colors.border,
                    color: colors.text,
                  }}
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
    </AppBottomSheet>
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
  const [scope, setScope] = useState<ScopeFilter>('installed');
  const [resource, setResource] = useState<ResourceFilter>('all');
  const [query, setQuery] = useState('');
  const [filterPicker, setFilterPicker] = useState<FilterPicker | null>(null);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [configurationManifest, setConfigurationManifest] =
    useState<ExtensionManifest | null>(null);
  const [errorDialog, setErrorDialog] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const showError = useCallback((title: string, cause: unknown) => {
    setErrorDialog({
      title,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastExtensionRefreshAt < EXTENSION_REFRESH_INTERVAL_MS) return;
      lastExtensionRefreshAt = now;
      void extensions.refreshCommunity().catch((cause) =>
        showError('Could not refresh add-ons', cause)
      );
    }, [extensions, showError])
  );

  useEffect(() => {
    const messages = [
      extensions.error,
      extensions.updateError
        ? `Add-on update check failed: ${extensions.updateError}`
        : null,
    ].filter((message): message is string => !!message);
    if (!messages.length) return;
    const timeout = setTimeout(() => {
      setErrorDialog({
        title: 'Add-ons need attention',
        message: messages.join('\n\n'),
      });
    }, 0);
    return () => clearTimeout(timeout);
  }, [extensions.error, extensions.updateError]);

  const entries = useMemo(() => {
    const bundled = extensions.bundled.map((manifest) => ({
      manifest,
      installed: undefined,
      community: false,
    }));
    const thirdParty = extensions.thirdParty.map((installed) => ({
      manifest: installed.manifest,
      installed,
      community: installed.source === 'community',
    }));
    const community = extensions.community.map((definition) => ({
      manifest: definition.manifest,
      installed: extensions.thirdParty.find(
        (candidate) => candidate.manifest.id === definition.manifest.id
      ),
      community: true,
    }));
    const source = scope === 'community' ? community : [...bundled, ...thirdParty];
    const needle = query.trim().toLocaleLowerCase();
    return source.filter(({ manifest, installed }) => {
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
  }, [extensions.bundled, extensions.community, extensions.thirdParty, query, resource, scope]);

  const installCommunity = async (manifest: ExtensionManifest) => {
    setInstalling(true);
    try {
      const installed = await extensions.installCommunity(manifest.id);
      if (installed.manifest.behaviorHints?.configurationRequired) {
        setConfigurationManifest(installed.manifest);
      }
    } catch (cause) {
      showError('Add-on install failed', cause);
    } finally {
      setInstalling(false);
    }
  };

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
      showError('Add-on install failed', cause);
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
              options={SCOPE_FILTERS}
              selectedValue={scope}
              onSelect={(value) => setScope(value as ScopeFilter)}
            />
          </View>
          <View style={{ width: wide ? 210 : undefined, flex: wide ? undefined : 1 }}>
            <SelectField
              dense
              label={
                RESOURCE_FILTERS.find((option) => option.value === resource)?.label ?? 'All'
              }
              onPress={() => setFilterPicker('resource')}
              options={RESOURCE_FILTERS}
              selectedValue={resource}
              onSelect={(value) => setResource(value as ResourceFilter)}
            />
          </View>
          <PillButton
            label="Add add-on"
            icon="plus"
            variant="success"
            onPress={() => setAddOpen(true)}
            compact
          />
          {wide ? <View className="flex-1" /> : null}
          <View style={{ width: wide ? 280 : '100%' }}>
            <SearchField value={query} onChangeText={setQuery} placeholder="Search add-ons" />
          </View>
        </View>

        {!extensions.ready ? (
          <View className="h-48 items-center justify-center">
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : entries.length ? (
          <View className="gap-4">
            {entries.map(({ manifest, installed, community }) => (
              <ExtensionCard
                key={manifest.id}
                manifest={manifest}
                installed={installed}
                wide={wide}
                onConfigure={() => setConfigurationManifest(manifest)}
                onInstall={
                  community && !installed
                    ? () => void installCommunity(manifest)
                    : undefined
                }
                onShare={() => {
                  if (!installed) return;
                  void Share.share({
                    title: manifest.name,
                    message: installed.repositoryUrl,
                    url: installed.repositoryUrl,
                  }).catch((cause) => showError('Could not share add-on', cause));
                }}
                onRemove={() =>
                  Alert.alert('Remove add-on?', manifest.name, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () =>
                        void extensions.remove(manifest.id).catch((cause) =>
                          showError('Could not remove add-on', cause)
                        ),
                    },
                  ])
                }
              />
            ))}
          </View>
        ) : (
          <View className="h-52 items-center justify-center gap-3">
            <Feather name="package" size={34} color={colors.textMuted} />
            <Text className="text-sm" style={{ color: colors.textMuted }}>
              No add-ons match these filters.
            </Text>
          </View>
        )}
      </ScrollView>

      <AppDialog
        visible={addOpen}
        title="Add add-on"
        onClose={() => !installing && setAddOpen(false)}
      >
        <Text className="mb-4 text-sm leading-5" style={{ color: colors.textMuted }}>
          Paste a trusted GitHub repository or manifest URL. These third-party add-ons are not
          reviewed. Reviewed add-ons are available under the Community filter.
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
          placeholderTextColor={colors.textMuted}
          className="h-12 rounded-xl border px-4"
          style={{
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
            color: colors.text,
          }}
        />
        <View className="mt-4 flex-row justify-end gap-3">
          <Pressable
            onPress={() => setAddOpen(false)}
            disabled={installing}
            className="h-11 rounded-xl px-5 items-center justify-center"
          >
            <Text className="font-semibold" style={{ color: colors.text }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => void install()}
            disabled={installing || !repositoryUrl.trim()}
            className="h-11 min-w-[104px] rounded-xl px-5 items-center justify-center disabled:opacity-50"
            style={{ backgroundColor: colors.accent }}
          >
            {installing ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text className="font-bold" style={{ color: colors.onAccent }}>Install</Text>
            )}
          </Pressable>
        </View>
      </AppDialog>

      <FilterDialog
        picker={Platform.OS === 'ios' ? null : filterPicker}
        scope={scope}
        resource={resource}
        onScope={setScope}
        onResource={setResource}
        onClose={() => setFilterPicker(null)}
      />

      <ConfigurationSheet
        key={configurationManifest?.id ?? 'closed'}
        manifest={configurationManifest}
        onClose={() => setConfigurationManifest(null)}
        onError={showError}
      />
      <AppErrorDialog
        title={errorDialog?.title ?? 'Add-on error'}
        message={errorDialog?.message ?? null}
        onClose={() => setErrorDialog(null)}
      />
    </View>
  );
}
