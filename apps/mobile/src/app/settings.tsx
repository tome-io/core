import { Feather } from '@expo/vector-icons';
import type { ExtensionManifest } from '@readoi/extension-protocol';
import { useMemo, useRef, useState } from 'react';
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
} from '@/components/app-ui';
import { useExtensions } from '@/context/extensions-context';
import { useLibrary } from '@/context/library-context';
import { useSettings } from '@/context/settings-context';
import { isSafLocation, pickDownloadFolder } from '@/lib/download';
import { beginFolderPicker, endFolderPicker } from '@/lib/folder-picker-lock';
import { validateProgressFolder } from '@/lib/progress-folder-provider';
import { forgetProgressSyncFolder } from '@/lib/progress-sync';

type ProviderRole = 'search' | 'acquisition';
type SettingsSectionId = 'providers' | 'library' | 'sync';
type LocationSetting =
  | 'localLibraryLocation'
  | 'moonReaderBackupLocation'
  | 'progressSyncLocation';

const SECTIONS: { id: SettingsSectionId; label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'library', label: 'Library' },
  { id: 'sync', label: 'Progress sync' },
];

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
        Readio
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
      title={role === 'search' ? 'Search provider' : 'Download provider'}
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

function FolderField({
  location,
  emptyLabel,
  onChoose,
  onReset,
  resetLabel,
}: {
  location: string | null;
  emptyLabel: string;
  onChoose: () => void;
  onReset?: () => void;
  resetLabel: string;
}) {
  const label = !location
    ? emptyLabel
    : isSafLocation(location)
      ? decodeURIComponent(location.split('/').pop() || location)
      : location;
  return (
    <View className="gap-1.5">
      <SelectField label={label} icon="folder" onPress={onChoose} />
      {onReset ? (
        <Pressable onPress={onReset} className="self-end px-3 py-1.5 active:opacity-70">
          <Text className="text-xs font-medium" style={{ color: colors.accent }}>
            {resetLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function SettingsScreen() {
  const { width } = useWindowDimensions();
  const showMenu = width >= 800;
  const availableSectionWidth = width - (width >= 700 ? 76 : 0) - (showMenu ? 360 : 48);
  const compactOptions = availableSectionWidth < 560;
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Partial<Record<SettingsSectionId, number>>>({});
  const [selectedSection, setSelectedSection] = useState<SettingsSectionId>('providers');
  const [providerPicker, setProviderPicker] = useState<ProviderRole | null>(null);
  const extensions = useExtensions();
  const { settings, update } = useSettings();
  const { cloudLastSyncedAt, cloudSyncing, syncCloudProgress } = useLibrary();

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
        manifest.resources.some((resource) => resource.name === 'search')
      ),
    [enabledManifests]
  );
  const acquisitionProviders = useMemo(
    () =>
      enabledManifests.filter(
        (manifest) =>
          manifest.resources.some((resource) => resource.name === 'search') &&
          manifest.resources.some((resource) => resource.name === 'acquisition')
      ),
    [enabledManifests]
  );
  const selectedSearch = searchProviders.find(
    (manifest) => manifest.id === extensions.searchExtensionId
  );
  const selectedAcquisition = acquisitionProviders.find(
    (manifest) => manifest.id === extensions.acquisitionExtensionId
  );

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

  const chooseFolder = async (setting: LocationSetting) => {
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
        isSafLocation(settings[setting]) ? settings[setting] : null
      );
      if (!picked) return;
      if (setting === 'progressSyncLocation') await validateProgressFolder(picked.uri);
      await update({ [setting]: picked.uri });
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

  const resetFolder = async (setting: LocationSetting) => {
    if (setting === 'progressSyncLocation' && settings.progressSyncLocation) {
      await forgetProgressSyncFolder(settings.progressSyncLocation);
    }
    await update({ [setting]: null });
  };

  const setProvider = async (role: ProviderRole, id: string) => {
    try {
      if (role === 'search') await extensions.setSearchExtension(id);
      else await extensions.setAcquisitionExtension(id);
      setProviderPicker(null);
    } catch (cause) {
      Alert.alert(
        'Could not change provider',
        cause instanceof Error ? cause.message : String(cause)
      );
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
          paddingLeft: showMenu ? 48 : 24,
          paddingRight: 24,
          paddingBottom: 54,
        }}
      >
        <SettingsSection
          title="Providers"
          onLayout={(event) => {
            sectionOffsets.current.providers = event.nativeEvent.layout.y;
          }}
        >
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
            />
          </SettingsOption>
          <SettingsOption
            compact={compactOptions}
            label="Moon+ Reader backup folder"
            detail="Imports Moon+ catalog, reading progress and history."
          >
            <FolderField
              location={settings.moonReaderBackupLocation}
              emptyLabel="Not configured"
              onChoose={() => void chooseFolder('moonReaderBackupLocation')}
              onReset={
                settings.moonReaderBackupLocation
                  ? () => void resetFolder('moonReaderBackupLocation')
                  : undefined
              }
              resetLabel="Disconnect"
            />
          </SettingsOption>
        </SettingsSection>

        <SettingsSection
          title="Progress sync"
          onLayout={(event) => {
            sectionOffsets.current.sync = event.nativeEvent.layout.y;
          }}
        >
          <SettingsOption
            compact={compactOptions}
            label="Sync folder"
            detail="Use Google Drive directly or a local folder mirrored by FolderSync. Readio keeps the furthest progress from each device."
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
        options={providerPicker === 'search' ? searchProviders : acquisitionProviders}
        selectedId={
          providerPicker === 'search'
            ? extensions.searchExtensionId
            : extensions.acquisitionExtensionId
        }
        onSelect={(id) => providerPicker && void setProvider(providerPicker, id)}
        onClose={() => setProviderPicker(null)}
      />
    </View>
  );
}
