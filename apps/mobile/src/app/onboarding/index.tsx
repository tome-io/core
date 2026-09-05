import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { supportsExtensionProviderRole } from '@tomeio/extension-protocol';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, View } from 'react-native';
import { AppDialog, colors, PillButton, SelectField } from '@/components/app-ui';
import { HostedSyncDialog } from '@/components/hosted-sync-dialog';
import { useExtensions } from '@/context/extensions-context';
import { useLibraryActions } from '@/context/library-context';
import { useSettings } from '@/context/settings-context';
import { describeFolderLocation, folderLocationLabel, isExternalFolderLocation, pickDownloadFolder } from '@/lib/download';
import { beginFolderPicker, endFolderPicker } from '@/lib/folder-picker-lock';
import { getHostedSyncAccount, type HostedSyncAccount } from '@/lib/hosted-sync';

const STEPS = [
  { title: 'Make room for a good book', detail: 'A few choices will make Tomeio yours. Read your own books, find something new, and pick up where you left off.' },
  { title: 'Choose where books come from', detail: 'Providers help you browse, search, and find downloads. You can use different providers for each job and change them later.' },
  { title: 'Give your books a home', detail: 'Choose the folder Tomeio scans for EPUBs and PDFs and uses for downloads. Your book files stay in your storage.' },
  { title: 'Pick up on another device', detail: 'A free Tomeio Sync account keeps your library, reading progress, and reading sessions together. Your book files are not uploaded.' },
];
const ROLES = [
  { id: 'discovery', title: 'Discover', detail: 'Browse recommendations and categories on your home screen.' },
  { id: 'search', title: 'Search', detail: 'Look up a title or author when you know what you want.' },
  { id: 'acquisition', title: 'Downloads', detail: 'Find available ways to obtain a book. Availability depends on the provider.' },
] as const;
type Role = typeof ROLES[number]['id'];

export default function OnboardingScreen() {
  const router = useRouter();
  const { settings, ready, update } = useSettings();
  const extensions = useExtensions();
  const { refreshLocalBooks } = useLibraryActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Role | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [account, setAccount] = useState<HostedSyncAccount | null>(null);
  const step = settings.onboardingStep;
  const manifests = [...extensions.bundled, ...extensions.thirdParty.filter((item) => item.enabled).map((item) => item.manifest)];
  const selected = { discovery: extensions.discoveryExtensionId, search: extensions.searchExtensionId, acquisition: extensions.acquisitionExtensionId };
  const reportError = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
  useFocusEffect(useCallback(() => {
    let active = true;
    void getHostedSyncAccount().then((value) => { if (active) setAccount(value); }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, []));

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await action(); } catch (cause) { reportError(cause); } finally { setBusy(false); }
  };
  const finish = () => perform(async () => {
    await update({ onboardingCompleted: true, onboardingStep: 0 });
    router.replace('/home');
  });
  const selectProvider = (role: Role, id: string) => perform(async () => {
    if (role === 'discovery') await extensions.setDiscoveryExtension(id);
    else if (role === 'search') await extensions.setSearchExtension(id);
    else await extensions.setAcquisitionExtension(id);
    setPicker(null);
  });
  const chooseFolder = () => perform(async () => {
    beginFolderPicker();
    try {
      const picked = await pickDownloadFolder(isExternalFolderLocation(settings.localLibraryLocation)
        ? settings.localLibraryLocation : settings.folderPickerLocations.localLibraryLocation);
      if (!picked) return;
      if (picked.uri === settings.libraryMirrorLocation) throw new Error('Choose a different folder from your device mirror.');
      await describeFolderLocation(picked.uri);
      await update({ localLibraryLocation: picked.uri,
        folderPickerLocations: { ...settings.folderPickerLocations, localLibraryLocation: picked.uri } });
    } finally { endFolderPicker(); }
  });

  if (!ready || !extensions.ready) return <ActivityIndicator accessibilityLabel="Loading setup" />;
  return <View className="flex-1" style={{ backgroundColor: colors.background }}>
    <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
    <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1, width: '100%', maxWidth: 600, alignSelf: 'center' }}>
      <Text className="mb-6 text-sm font-semibold" style={{ color: colors.accent }}>TOMEIO · {step + 1} OF {STEPS.length}</Text>
      <View className="mb-8 flex-row gap-2" accessibilityLabel={`Setup step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((_, index) => <View key={index} className="h-1 flex-1 rounded-full" style={{ backgroundColor: index <= step ? colors.accent : colors.border }} />)}
      </View>
      <Text className="text-3xl font-semibold" style={{ color: colors.text }}>{STEPS[step].title}</Text>
      <Text className="mb-8 mt-4 text-base leading-6" style={{ color: colors.textMuted }}>{STEPS[step].detail}</Text>
      {step === 0 ? <View className="gap-5">
        <Text className="text-base leading-6" style={{ color: colors.text }}>Start with your own books or explore a catalog. No account is needed to read.</Text>
        <Text className="text-sm leading-5" style={{ color: colors.textMuted }}>Setup is optional. You can return to this guide from Settings whenever you like.</Text>
      </View> : null}
      {step === 1 ? <View className="gap-6">
        {ROLES.map((role) => {
          const options = manifests.filter((manifest) => supportsExtensionProviderRole(manifest, role.id));
          const provider = options.find((manifest) => manifest.id === selected[role.id]);
          return <View key={role.id} className="gap-2">
            <Text className="text-base font-semibold" style={{ color: colors.text }}>{role.title}</Text>
            <Text className="text-sm leading-5" style={{ color: colors.textMuted }}>{role.detail}</Text>
            <SelectField label={provider?.name ?? 'Choose a provider'} icon="book-open"
              options={options.map((manifest) => ({ label: manifest.name, value: manifest.id }))}
              selectedValue={selected[role.id] ?? ''} onSelect={(id) => { if (!busy) void selectProvider(role.id, id); }}
              onPress={() => setPicker(role.id)} />
            {provider ? <Text className="text-xs leading-5" style={{ color: colors.textMuted }}>{provider.description}</Text> : null}
          </View>;
        })}
        <PillButton label="Explore and add extensions" icon="plus" onPress={() => router.push('/onboarding/extensions')} />
        <Text className="text-xs leading-5" style={{ color: colors.textMuted }}>Add-ons can supply more providers and connect other readers. Install and configure only the ones you want.</Text>
      </View> : null}
      {step === 2 ? <View className="gap-4">
        <Text className="text-base font-medium" style={{ color: colors.text }}>{settings.localLibraryLocation ? folderLocationLabel(settings.localLibraryLocation) : 'Tomeio app storage'}</Text>
        <Text className="text-sm leading-5" style={{ color: colors.textMuted }}>App storage works immediately. A folder in Files or on your device lets you manage the same books outside Tomeio. Cloud folders may need a connection to download files.</Text>
        <PillButton label="Choose book folder" icon="folder" onPress={() => void chooseFolder()} disabled={busy || Platform.OS === 'web'} />
        <Text className="text-xs leading-5" style={{ color: colors.textMuted }}>Optional device mirroring and additional reader integrations are available in Settings after setup.</Text>
      </View> : null}
      {step === 3 ? <View className="gap-4">
        {account ? <Text className="text-base" style={{ color: colors.text }}>Signed in as {account.email}</Text>
          : <PillButton label="Sign in or create an account" icon="log-in" onPress={() => setShowAccount(true)} disabled={Platform.OS === 'web'} />}
        <Text className="text-sm leading-5" style={{ color: colors.textMuted }}>Prefer to stay on this device? Continue without an account. Your reading sessions stay local; creating an account later does not silently upload your earlier history.</Text>
      </View> : null}
      {error || extensions.error ? <Text accessibilityRole="alert" className="mt-5 text-sm" style={{ color: colors.danger }}>{error ?? extensions.error}</Text> : null}
      <View className="mt-10 gap-3">
        <PillButton label={busy ? 'Saving…' : step === 3 ? (account ? 'Start reading' : 'Continue without an account') : 'Continue'}
          variant="accent" fullWidth disabled={busy} onPress={() => void (step === 3 ? finish() : perform(() => update({ onboardingStep: step + 1 })))} />
        {step > 0 ? <PillButton label="Back" fullWidth disabled={busy} onPress={() => void perform(() => update({ onboardingStep: step - 1 }))} /> : null}
        {step < 3 ? <PillButton label="Skip setup" fullWidth disabled={busy} onPress={() => void finish()} /> : null}
      </View>
    </ScrollView>
    {Platform.OS !== 'ios' ? <AppDialog visible={picker != null} title="Choose a provider" onClose={() => setPicker(null)}>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        {manifests.filter((manifest) => picker && supportsExtensionProviderRole(manifest, picker)).map((manifest) =>
          <PillButton key={manifest.id} label={manifest.name} fullWidth disabled={busy}
            onPress={() => { if (picker) void selectProvider(picker, manifest.id); }} />)}
        {picker && !manifests.some((manifest) => supportsExtensionProviderRole(manifest, picker))
          ? <Text style={{ color: colors.textMuted }}>Add an extension that provides this feature, or continue and choose later.</Text> : null}
      </ScrollView>
    </AppDialog> : null}
    {showAccount ? <HostedSyncDialog onClose={() => setShowAccount(false)} onAuthenticated={(value) => {
      setAccount(value); setShowAccount(false);
      void refreshLocalBooks(true).catch(reportError);
    }} /> : null}
  </View>;
}
