import { Feather } from '@expo/vector-icons';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import {
  supportsExtensionProviderRole,
  type ExtensionManifest,
} from '@tomeio/extension-protocol';
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import {
  AppDialog,
  colors,
  PillButton,
  SelectField,
  SettingsOption,
  SettingsSection,
  usePageBottomPadding,
  usePageGutter,
} from '@/components/app-ui';
import { useExtensions } from '@/context/extensions-context';
import {
  useLibraryActions,
  useLibrarySyncStatus,
} from '@/context/library-context';
import { useSettings } from '@/context/settings-context';
import { isSafLocation, pickDownloadFolder } from '@/lib/download';
import { beginFolderPicker, endFolderPicker } from '@/lib/folder-picker-lock';
import {
  getNativeLauncherIcon,
  hasNativeLauncherIcon,
  setNativeLauncherIcon,
  type LauncherIcon,
} from '@/lib/launcher-icon';
import { validateProgressFolder } from '@/lib/progress-folder-provider';
import { forgetProgressSyncFolder } from '@/lib/progress-sync';
import type { FolderLocationSetting } from '@/lib/settings';

type ProviderRole = 'discovery' | 'search' | 'acquisition';
type SettingsSectionId = 'appearance' | 'providers' | 'library' | 'sync';
const SECTIONS: { id: SettingsSectionId; label: string }[] = [
  ...(Platform.OS === 'android'
    ? [{ id: 'appearance' as const, label: 'Appearance' }]
    : []),
  { id: 'providers', label: 'Providers' },
  { id: 'library', label: 'Library' },
  { id: 'sync', label: 'Progress sync' },
];

const APP_VERSION =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;

const LAUNCHER_ICONS: {
  id: LauncherIcon;
  label: string;
  detail: string;
  source: number;
}[] = [
  {
    id: 'full',
    label: 'Full colour',
    detail: 'The complete orange Tomeio artwork.',
    source: require('../../../assets/images/icon.png'),
  },
  {
    id: 'monochrome',
    label: 'Monochrome',
    detail: 'The simplified book mark on a golden background.',
    source: require('../../../assets/images/android-icon-monochrome.png'),
  },
];

function providerRoleLabel(role: ProviderRole | null): string {
  if (role === 'discovery') return 'Discovery provider';
  if (role === 'search') return 'Search provider';
  return 'Download provider';
}

function SettingsMenu({
  selected,
  onSelect,
}: {
  selected: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
}) {
  return (
    <View className="h-full w-72 px-6 py-12">
      {SECTIONS.map((section) => {
        const active = section.id === selected;
        return (
          <Pressable
            key={section.id}
            onPress={() => onSelect(section.id)}
            className="mb-2 h-14 w-full justify-center px-6 active:opacity-75"
            style={{
              borderRadius: 999,
              backgroundColor: active ? colors.surfaceRaised : 'transparent',
              opacity: active ? 1 : 0.45,
            }}
          >
            <Text className={active ? 'text-base font-semibold' : 'text-base font-medium'} style={{ color: colors.text }}>
              {section.label}
            </Text>
          </Pressable>
        );
      })}
      <View className="flex-1" />
      <Text className="px-6 text-xs" style={{ color: colors.textMuted, opacity: 0.45 }}>
        {APP_VERSION ? `Tomeio · v${APP_VERSION}` : 'Tomeio · Version unavailable'}
      </Text>
    </View>
  );
}

function ProviderPicker({
  role,
  options,
  selectedId,
  onSelect,
  onClose,
}: {
  role: ProviderRole | null;
  options: ExtensionManifest[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <AppDialog
      visible={role !== null}
      title={providerRoleLabel(role)}
      onClose={onClose}
    >
      <Text className="mb-4 text-sm" style={{ color: colors.textMuted }}>
        Choose one active provider. Add-ons are installed and configured from the Add-ons page.
      </Text>
      <ScrollView className="max-h-[500px]" contentContainerClassName="gap-2">
        {options.map((manifest) => {
          const selected = manifest.id === selectedId;
          return (
            <Pressable
              key={manifest.id}
              onPress={() => onSelect(manifest.id)}
              className="min-h-16 flex-row items-center gap-3 border px-4 active:opacity-80"
              style={{
                borderRadius: 16,
                borderColor: selected ? colors.accent : colors.border,
                backgroundColor: selected ? colors.accentMuted : colors.surfaceRaised,
              }}
            >
              <Feather
                name={selected ? 'check-circle' : 'circle'}
                size={19}
                color={selected ? colors.accent : colors.textMuted}
              />
              <View className="flex-1 py-2">
                <Text className="text-sm font-medium" style={{ color: colors.text }}>
                  {manifest.name}
                </Text>
                <Text numberOfLines={1} className="mt-0.5 text-xs" style={{ color: colors.textMuted }}>
                  {manifest.description}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </AppDialog>
  );
}

function LauncherIconPicker({
  visible,
  selected,
  busy,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: LauncherIcon;
  busy: boolean;
  onSelect: (icon: LauncherIcon) => void;
  onClose: () => void;
}) {
  return (
    <AppDialog visible={visible} title="App icon" onClose={onClose}>
      <View className="gap-2">
        {LAUNCHER_ICONS.map((option) => {
          const active = option.id === selected;
          return (
            <Pressable
              key={option.id}
              onPress={() => onSelect(option.id)}
              disabled={busy}
              accessibilityRole="radio"
              accessibilityState={{ checked: active, disabled: busy }}
              className="min-h-20 flex-row items-center gap-4 border px-4 py-3 active:opacity-75 disabled:opacity-50"
              style={{
                borderRadius: 16,
                borderColor: active ? colors.accent : colors.border,
                backgroundColor: active ? colors.accentMuted : colors.surfaceRaised,
              }}
            >
              <View
                className="h-14 w-14 overflow-hidden rounded-2xl"
                style={{
                  backgroundColor: option.id === 'monochrome' ? '#FFB511' : colors.surface,
                }}
              >
                <Image
                  source={option.source}
                  contentFit={option.id === 'monochrome' ? 'contain' : 'cover'}
                  style={{ width: '100%', height: '100%' }}
                />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                  {option.label}
                </Text>
                <Text className="mt-1 text-xs" style={{ color: colors.textMuted }}>
                  {option.detail}
                </Text>
              </View>
              {busy && active ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Feather
                  name={active ? 'check-circle' : 'circle'}
                  size={20}
                  color={active ? colors.accent : colors.textMuted}
                />
              )}
            </Pressable>
          );
        })}
      </View>
      <Text className="mt-4 text-xs leading-5" style={{ color: colors.textMuted }}>
        Android launchers can take a few seconds to refresh the home-screen icon. System themed
        icons may still apply the wallpaper palette.
      </Text>
    </AppDialog>
  );
}

function FolderField({
  location,
  emptyLabel,
  onChoose,
  onReset,
  resetLabel,
  resetIcon,
}: {
  location: string | null;
  emptyLabel: string;
  onChoose: () => void;
  onReset?: () => void;
  resetLabel: string;
  resetIcon: ComponentProps<typeof Feather>['name'];
}) {
  const label = !location
    ? emptyLabel
    : isSafLocation(location)
      ? decodeURIComponent(location.split('/').pop() || location)
      : location;
  return (
    <View className="gap-2">
      <SelectField label={label} icon="folder" onPress={onChoose} />
      {onReset ? (
        <PillButton label={resetLabel} icon={resetIcon} variant="overlay" onPress={onReset} />
      ) : null}
    </View>
  );
}

export default function SettingsScreen() {
  const { width } = useWindowDimensions();
  const gutter = usePageGutter();
  const bottomPadding = usePageBottomPadding(54);
  const showMenu = width >= 800;
  const availableSectionWidth = width - (width >= 700 ? 76 : 0) - (showMenu ? 360 : 48);
  const compactOptions = availableSectionWidth < 560;
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Partial<Record<SettingsSectionId, number>>>({});
  const [selectedSection, setSelectedSection] = useState<SettingsSectionId>(SECTIONS[0].id);
  const [providerPicker, setProviderPicker] = useState<ProviderRole | null>(null);
  const [launcherIconPicker, setLauncherIconPicker] = useState(false);
  const [launcherIcon, setLauncherIcon] = useState<LauncherIcon>('full');
  const [launcherIconBusy, setLauncherIconBusy] = useState(false);
  const [launcherIconError, setLauncherIconError] = useState<string | null>(null);
  const extensions = useExtensions();
  const { settings, update } = useSettings();
  const { cloudLastSyncedAt, cloudSyncing } = useLibrarySyncStatus();
  const { syncCloudProgress } = useLibraryActions();

  const enabledManifests = useMemo(
    () => [
      ...extensions.thirdParty
        .filter((extension) => extension.enabled)
        .map((extension) => extension.manifest),
      ...extensions.bundled,
    ],
    [extensions.bundled, extensions.thirdParty]
  );
  const searchProviders = useMemo(
    () =>
      enabledManifests.filter((manifest) =>
        supportsExtensionProviderRole(manifest, 'search')
      ),
    [enabledManifests]
  );
  const discoveryProviders = useMemo(
    () =>
      enabledManifests.filter((manifest) =>
        supportsExtensionProviderRole(manifest, 'discovery')
      ),
    [enabledManifests]
  );
  const acquisitionProviders = useMemo(
    () =>
      enabledManifests.filter((manifest) =>
        supportsExtensionProviderRole(manifest, 'acquisition')
      ),
    [enabledManifests]
  );
  const selectedSearch = searchProviders.find(
    (manifest) => manifest.id === extensions.searchExtensionId
  );
  const selectedDiscovery = discoveryProviders.find(
    (manifest) => manifest.id === extensions.discoveryExtensionId
  );
  const selectedAcquisition = acquisitionProviders.find(
    (manifest) => manifest.id === extensions.acquisitionExtensionId
  );

  useEffect(() => {
    if (Platform.OS !== 'android' || !hasNativeLauncherIcon()) return;
    getNativeLauncherIcon()
      .then((icon) => {
        setLauncherIcon(icon);
        setLauncherIconError(null);
      })
      .catch((cause) => {
        setLauncherIconError(cause instanceof Error ? cause.message : String(cause));
      });
  }, []);

  const scrollToSection = (section: SettingsSectionId) => {
    setSelectedSection(section);
    scrollRef.current?.scrollTo({ y: sectionOffsets.current[section] ?? 0, animated: true });
  };

  const updateSelectedSection = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const marker = event.nativeEvent.contentOffset.y + 60;
    const active = SECTIONS.reduce<SettingsSectionId>((current, section) => {
      const offset = sectionOffsets.current[section.id];
      return typeof offset === 'number' && offset <= marker ? section.id : current;
    }, 'providers');
    if (active !== selectedSection) setSelectedSection(active);
  };

  const chooseFolder = async (setting: FolderLocationSetting) => {
    if (Platform.OS !== 'android') {
      Alert.alert(
        'Not supported here',
        setting === 'progressSyncLocation'
          ? 'Choosing a shared progress folder is currently available on Android.'
          : 'Choosing a custom folder needs Android Storage Access Framework. On iOS, files are saved to the app Documents folder.'
      );
      return;
    }
    beginFolderPicker();
    try {
      const picked = await pickDownloadFolder(
        isSafLocation(settings[setting])
          ? settings[setting]
          : settings.folderPickerLocations[setting]
      );
      if (!picked) return;
      if (setting === 'progressSyncLocation') await validateProgressFolder(picked.uri);
      await update({
        [setting]: picked.uri,
        folderPickerLocations: {
          ...settings.folderPickerLocations,
          [setting]: picked.uri,
        },
      });
    } catch (cause) {
      Alert.alert(
        setting === 'progressSyncLocation'
          ? 'Progress sync folder unavailable'
          : 'Folder picker failed',
        cause instanceof Error ? cause.message : String(cause)
      );
    } finally {
      endFolderPicker();
    }
  };

  const resetFolder = async (setting: FolderLocationSetting) => {
    if (setting === 'progressSyncLocation' && settings.progressSyncLocation) {
      await forgetProgressSyncFolder(settings.progressSyncLocation);
    }
    await update({ [setting]: null });
  };

  const setProvider = async (role: ProviderRole, id: string) => {
    try {
      if (role === 'discovery') await extensions.setDiscoveryExtension(id);
      else if (role === 'search') await extensions.setSearchExtension(id);
      else await extensions.setAcquisitionExtension(id);
      setProviderPicker(null);
    } catch (cause) {
      Alert.alert(
        'Could not change provider',
        cause instanceof Error ? cause.message : String(cause)
      );
    }
  };

  const chooseLauncherIcon = async (icon: LauncherIcon) => {
    if (icon === launcherIcon) {
      setLauncherIconPicker(false);
      return;
    }
    setLauncherIconBusy(true);
    try {
      const selected = await setNativeLauncherIcon(icon);
      setLauncherIcon(selected);
      setLauncherIconError(null);
      setLauncherIconPicker(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setLauncherIconError(message);
      Alert.alert(
        'Could not change app icon',
        message
      );
    } finally {
      setLauncherIconBusy(false);
    }
  };

  const syncProgressNow = async () => {
    try {
      await syncCloudProgress();
    } catch (cause) {
      Alert.alert('Progress sync failed', cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <View className="flex-1 flex-row" style={{ backgroundColor: colors.background }}>
      {showMenu ? <SettingsMenu selected={selectedSection} onSelect={scrollToSection} /> : null}
      <ScrollView
        ref={scrollRef}
        onScroll={updateSelectedSection}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{
          paddingLeft: showMenu ? 48 : gutter,
          paddingRight: gutter,
          paddingBottom: bottomPadding,
        }}
      >
        {Platform.OS === 'android' ? (
          <SettingsSection
            title="Appearance"
            compact={compactOptions}
            onLayout={(event) => {
              sectionOffsets.current.appearance = event.nativeEvent.layout.y;
            }}
          >
            <SettingsOption
              compact={compactOptions}
              label="App icon"
              detail={
                launcherIconError ?? 'Choose the Tomeio icon shown by the Android launcher.'
              }
            >
              <SelectField
                label={
                  LAUNCHER_ICONS.find((option) => option.id === launcherIcon)?.label ??
                  'Full colour'
                }
                icon="book-open"
                onPress={() => setLauncherIconPicker(true)}
              />
            </SettingsOption>
          </SettingsSection>
        ) : null}

        <SettingsSection
          title="Providers"
          compact={compactOptions}
          onLayout={(event) => {
            sectionOffsets.current.providers = event.nativeEvent.layout.y;
          }}
        >
          <SettingsOption
            compact={compactOptions}
            label="Discovery provider"
            detail="Supplies the catalog rows shown on Home."
          >
            <SelectField
              label={selectedDiscovery?.name ?? 'No provider available'}
              onPress={() => setProviderPicker('discovery')}
            />
          </SettingsOption>
          <SettingsOption
            compact={compactOptions}
            label="Search provider"
            detail="Supplies searches across titles, authors and ISBNs."
          >
            <SelectField
              label={selectedSearch?.name ?? 'No provider available'}
              onPress={() => setProviderPicker('search')}
            />
          </SettingsOption>
          <SettingsOption
            compact={compactOptions}
            label="Download provider"
            detail="Resolves a selected book into downloadable editions and formats."
          >
            <SelectField
              label={selectedAcquisition?.name ?? 'No provider available'}
              onPress={() => setProviderPicker('acquisition')}
            />
          </SettingsOption>
        </SettingsSection>

        <SettingsSection
          title="Library"
          compact={compactOptions}
          onLayout={(event) => {
            sectionOffsets.current.library = event.nativeEvent.layout.y;
          }}
        >
          <SettingsOption
            compact={compactOptions}
            label="Book library folder"
            detail="Indexes local ebooks and stores provider downloads."
          >
            <FolderField
              location={settings.localLibraryLocation}
              emptyLabel="App-private Documents/downloads"
              onChoose={() => void chooseFolder('localLibraryLocation')}
              onReset={
                settings.localLibraryLocation
                  ? () => void resetFolder('localLibraryLocation')
                  : undefined
              }
              resetLabel="Use app folder"
              resetIcon="home"
            />
          </SettingsOption>
        </SettingsSection>

        <SettingsSection
          title="Progress sync"
          compact={compactOptions}
          onLayout={(event) => {
            sectionOffsets.current.sync = event.nativeEvent.layout.y;
          }}
        >
          <SettingsOption
            compact={compactOptions}
            label="Sync folder"
            detail="Use Google Drive directly or a local folder mirrored by FolderSync. Tomeio keeps the furthest progress from each device."
          >
            <FolderField
              location={settings.progressSyncLocation}
              emptyLabel="Not configured"
              onChoose={() => void chooseFolder('progressSyncLocation')}
              onReset={
                settings.progressSyncLocation
                  ? () => void resetFolder('progressSyncLocation')
                  : undefined
              }
              resetLabel="Disable sync"
              resetIcon="slash"
            />
          </SettingsOption>
          {settings.progressSyncLocation ? (
            <SettingsOption
              compact={compactOptions}
              label="Synchronize now"
              detail={
                cloudLastSyncedAt
                  ? `Last synced ${new Date(cloudLastSyncedAt).toLocaleString()}`
                  : 'Not synced yet'
              }
            >
              <View>
                <PillButton
                  label={cloudSyncing ? 'Syncing…' : 'Sync now'}
                  icon={cloudSyncing ? undefined : 'refresh-cw'}
                  variant="accent"
                  disabled={cloudSyncing}
                  onPress={() => void syncProgressNow()}
                />
                {cloudSyncing ? (
                  <ActivityIndicator
                    className="absolute left-5 top-[14px]"
                    size="small"
                    color={colors.text}
                  />
                ) : null}
              </View>
            </SettingsOption>
          ) : null}
        </SettingsSection>
      </ScrollView>

      <ProviderPicker
        role={providerPicker}
        options={
          providerPicker === 'discovery'
            ? discoveryProviders
            : providerPicker === 'search'
              ? searchProviders
              : acquisitionProviders
        }
        selectedId={
          providerPicker === 'discovery'
            ? extensions.discoveryExtensionId
            : providerPicker === 'search'
              ? extensions.searchExtensionId
              : extensions.acquisitionExtensionId
        }
        onSelect={(id) => providerPicker && void setProvider(providerPicker, id)}
        onClose={() => setProviderPicker(null)}
      />
      <LauncherIconPicker
        visible={launcherIconPicker}
        selected={launcherIcon}
        busy={launcherIconBusy}
        onSelect={(icon) => void chooseLauncherIcon(icon)}
        onClose={() => {
          if (!launcherIconBusy) setLauncherIconPicker(false);
        }}
      />
    </View>
  );
}
