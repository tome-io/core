import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { supportsExtensionProviderRole } from '@tomeio/extension-protocol';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Platform, ScrollView, StyleSheet, Text, useAnimatedValue, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OnboardingBrand, StepArtwork, WelcomeArtwork, useOnboardingMotion } from '@/components/onboarding-artwork';
import { onboardingPreview } from '@/lib/onboarding-preview';
import { AppDialog, colors, PillButton, SelectField } from '@/components/app-ui';
import { HostedSyncDialog } from '@/components/hosted-sync-dialog';
import { useExtensions } from '@/context/extensions-context';
import { useLibraryActions } from '@/context/library-context';
import { useSettings } from '@/context/settings-context';
import { describeFolderLocation, folderLocationLabel, isExternalFolderLocation, pickDownloadFolder } from '@/lib/download';
import { beginFolderPicker, endFolderPicker } from '@/lib/folder-picker-lock';
import { getHostedSyncAccount, type HostedSyncAccount } from '@/lib/hosted-sync';

const STEPS = [
  { title: 'A little more time for stories.', detail: 'Your books. Your pace. Your place to read.' },
  { title: 'Find your next favourite.', detail: 'Choose where you browse and find books.' },
  { title: 'Your books, at home.', detail: 'Keep them here, or connect a folder of your own.' },
  { title: 'Same story. Any device.', detail: 'Keep your library and reading progress together.' },
];
const ROLES = [
  { id: 'discovery', title: 'Browse' },
  { id: 'search', title: 'Search' },
  { id: 'acquisition', title: 'Download' },
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
  const [previewStep, setPreviewStep] = useState(0);
  const step = onboardingPreview ? previewStep : settings.onboardingStep;
  const insets = useSafeAreaInsets();
  const motion = useOnboardingMotion();
  const entrance = useAnimatedValue(1);
  useEffect(() => {
    entrance.setValue(motion ? 0 : 1);
    if (!motion) return;
    const transition = Animated.timing(entrance, { toValue: 1, duration: 320, useNativeDriver: true });
    transition.start();
    return () => transition.stop();
  }, [entrance, motion, step]);
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
    if (!onboardingPreview) await update({ onboardingCompleted: true, onboardingStep: 0 });
    router.replace('/home');
  });
  const goToStep = (next: number) => perform(async () => {
    if (onboardingPreview) setPreviewStep(next);
    else await update({ onboardingStep: next });
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

  if (!ready || !extensions.ready) return <View style={styles.loading}><ActivityIndicator accessibilityLabel="Loading onboarding" /></View>;
  const advance = () => {
    if (step < 3) void goToStep(step + 1);
    else if (!account && Platform.OS !== 'web') setShowAccount(true);
    else void finish();
  };
  return <View style={styles.screen}>
    <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
    {step === 0 ? <>
      <WelcomeArtwork />
      <ScrollView bounces={false} contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 24, paddingHorizontal: 28, paddingBottom: 24 }}>
        <View style={{ flex: 1, minHeight: 240, justifyContent: 'center' }}><OnboardingBrand /></View>
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 32 }}>
          <Text style={[styles.title, { maxWidth: 330, fontSize: 36 }]}>{STEPS[0].title}</Text>
          <Text style={styles.subtitle}>{STEPS[0].detail}</Text>
        </View>
      </ScrollView>
    </> : <>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.wordmark}>Tomeio</Text>
        <View style={{ flexDirection: 'row', gap: 6 }} accessible accessibilityLabel={`Step ${step} of 3`}>
          {[1, 2, 3].map((index) => <View key={index} style={{ width: index === step ? 22 : 6, height: 6, borderRadius: 3, backgroundColor: index <= step ? colors.accent : colors.border }} />)}
        </View>
        <PillButton label={step === 3 && !account ? 'Not now' : 'Skip'} compact disabled={busy} onPress={() => void finish()} />
      </View>
      <ScrollView key={step} bounces={false} contentContainerStyle={styles.body}>
        <Animated.View style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
          <StepArtwork step={step} />
          <Text accessibilityRole="header" style={styles.title}>{STEPS[step].title}</Text>
          <Text style={[styles.subtitle, { marginTop: 10, marginBottom: 28 }]}>{STEPS[step].detail}</Text>
          {step === 1 ? <View style={{ gap: 14 }}>
            <View style={styles.card}>
              {ROLES.map((role) => {
                const options = manifests.filter((manifest) => supportsExtensionProviderRole(manifest, role.id));
                const provider = options.find((manifest) => manifest.id === selected[role.id]);
                return <View key={role.id} style={styles.providerRow}>
                  <Text style={{ color: colors.textMuted, fontSize: 14, flex: 1 }}>{role.title}</Text>
                  <View style={{ flex: 2 }} accessibilityLabel={`${role.title} provider`}>
                    <SelectField label={provider?.name ?? 'Choose provider'} dense
                      options={options.map((manifest) => ({ label: manifest.name, value: manifest.id }))}
                      selectedValue={selected[role.id] ?? ''} onSelect={(id) => { if (!busy) void selectProvider(role.id, id); }}
                      onPress={() => { if (!busy) setPicker(role.id); }} />
                  </View>
                </View>;
              })}
            </View>
            <PillButton label="Explore extensions" icon="plus" fullWidth onPress={() => router.push('/onboarding/extensions')} />
            <Text style={styles.caption}>More sources, more possibilities. Add them anytime.</Text>
          </View> : null}
          {step === 2 ? <View style={{ gap: 18 }}>
            <View style={[styles.card, { padding: 20, gap: 20 }]}>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1.2 }}>YOUR LIBRARY FOLDER</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="folder" size={22} color={colors.accent} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.label, { fontSize: 18 }]}>{settings.localLibraryLocation && isExternalFolderLocation(settings.localLibraryLocation)
                    ? folderLocationLabel(settings.localLibraryLocation) : 'Tomeio storage'}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>{isExternalFolderLocation(settings.localLibraryLocation) ? 'Selected for your books' : 'Ready when you are'}</Text>
                </View>
                <Feather name="check-circle" size={18} color={colors.success} />
              </View>
              <PillButton label={isExternalFolderLocation(settings.localLibraryLocation) ? 'Change folder' : 'Choose my own folder'} fullWidth onPress={() => void chooseFolder()} disabled={busy || Platform.OS === 'web'} />
            </View>
            <Text style={styles.caption}>EPUBs & PDFs. Your files stay in your storage.</Text>
          </View> : null}
          {step === 3 ? <View style={{ gap: 20 }}>
            <View style={[styles.card, { padding: 20, gap: 18 }]}>
              {account ? <View style={{ alignItems: 'center', gap: 10 }}>
                <Feather name="check-circle" size={26} color={colors.success} />
                <Text style={styles.label}>You’re connected</Text>
                <Text selectable style={styles.caption}>{account.email}</Text>
              </View> : <>
                <View style={styles.benefit}><Feather name="bookmark" size={20} color={colors.accent} /><Text style={styles.label}>Pick up where you left off</Text></View>
                <View style={styles.benefit}><Feather name="book-open" size={20} color={colors.accent} /><Text style={styles.label}>One library across your devices</Text></View>
              </>}
            </View>
            <Text style={styles.caption}>{account ? 'All set for your next chapter.' : 'No account needed to read. Join whenever you’re ready.'}</Text>
          </View> : null}
        </Animated.View>
      </ScrollView>
    </>}
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: step === 0 ? colors.background : colors.surface }]}>
      <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', gap: 12 }}>
        {error || extensions.error ? <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13 }}>{error ?? extensions.error}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {step > 0 ? <View style={{ flex: 1 }}><PillButton label="Back" fullWidth disabled={busy} onPress={() => void goToStep(step - 1)} /></View> : null}
          <View style={{ flex: step === 0 ? 1 : 2 }}><PillButton label={busy ? 'Saving…' : step === 0 ? 'Get started' : step === 3 ? (account || Platform.OS === 'web' ? 'Start reading' : 'Sign in') : 'Continue'}
            variant="accent" fullWidth disabled={busy} onPress={advance} /></View>
        </View>
        {step === 0 ? <Text style={styles.caption}>Make yourself at home.</Text> : null}
      </View>
    </View>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 8, width: '100%', maxWidth: 528, alignSelf: 'center' },
  wordmark: { fontSize: 18, fontWeight: '700', letterSpacing: -0.5, color: colors.text },
  body: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 8, width: '100%', maxWidth: 528, alignSelf: 'center' },
  title: { color: colors.text, fontSize: 30, lineHeight: 36, fontWeight: '600', letterSpacing: -1, textAlign: 'center' },
  subtitle: { color: colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  label: { color: colors.text, fontSize: 15, fontWeight: '500', flexShrink: 1 },
  card: { backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 10 },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dock: { paddingTop: 20, paddingHorizontal: 24, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
});
