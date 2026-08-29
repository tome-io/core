import { Feather } from "@expo/vector-icons";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { Image } from "expo-image";
import {
  supportsExtensionProviderRole,
  type ExtensionManifest,
} from "@tomeio/extension-protocol";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { AppErrorDialog } from "@/components/app-error-dialog";
import {
  AppDialog,
  colors,
  PillButton,
  SelectField,
  SettingsOption,
  SettingsSection,
  usePageBottomPadding,
  usePageGutter,
} from "@/components/app-ui";
import {
  useExtensions,
  type AvailableLibraryImport,
} from "@/context/extensions-context";
import {
  useLibraryActions,
  useLibraryCatalog,
} from "@/context/library-context";
import { useSettings } from "@/context/settings-context";
import {
  folderLocationLabel,
  isExternalFolderLocation,
  pickDownloadFolder,
} from "@/lib/download";
import { beginFolderPicker, endFolderPicker } from "@/lib/folder-picker-lock";
import {
  getNativeLauncherIcon,
  hasNativeLauncherIcon,
  setNativeLauncherIcon,
  type LauncherIcon,
} from "@/lib/launcher-icon";
import {
  getHostedSyncAccount,
  HostedSyncError,
  loginHostedSync,
  logoutHostedSync,
  registerHostedSync,
  requestHostedSyncCode,
  resetHostedSyncPassword,
  synchronizeHostedProgress,
  verifyHostedSyncEmail,
  verifyHostedSyncRecoveryCode,
  type HostedSyncAccount,
} from "@/lib/hosted-sync";
import {
  createLibraryImportPreview,
  importLibraryBackup,
  pickLibraryImportFile,
  type LibraryImportPreview,
} from "@/lib/library-import";
import { bookIdentity } from "@/lib/book-metadata";
import type { LibraryBook } from "@/lib/library";
import type { FolderLocationSetting } from "@/lib/settings";
import { forgetNativeDirectory } from "../../../modules/expo-progress-folder/src";

type ProviderRole = "discovery" | "search" | "acquisition";
type SettingsSectionId = "appearance" | "providers" | "library" | "sync";
const SECTIONS: { id: SettingsSectionId; label: string }[] = [
  ...(Platform.OS === "android"
    ? [{ id: "appearance" as const, label: "Appearance" }]
    : []),
  { id: "providers", label: "Providers" },
  { id: "library", label: "Library" },
  { id: "sync", label: "Sync" },
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
    id: "full",
    label: "Full colour",
    detail: "The complete orange Tomeio artwork.",
    source: require("../../../assets/images/icon.png"),
  },
  {
    id: "monochrome",
    label: "Monochrome",
    detail: "The simplified book mark on a golden background.",
    source: require("../../../assets/images/android-icon-monochrome.png"),
  },
];

function providerRoleLabel(role: ProviderRole | null): string {
  if (role === "discovery") return "Discovery provider";
  if (role === "search") return "Search provider";
  return "Download provider";
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
              backgroundColor: active ? colors.surfaceRaised : "transparent",
              opacity: active ? 1 : 0.45,
            }}
          >
            <Text
              className={
                active ? "text-base font-semibold" : "text-base font-medium"
              }
              style={{ color: colors.text }}
            >
              {section.label}
            </Text>
          </Pressable>
        );
      })}
      <View className="flex-1" />
      <Text
        className="px-6 text-xs"
        style={{ color: colors.textMuted, opacity: 0.45 }}
      >
        {APP_VERSION
          ? `Tomeio · v${APP_VERSION}`
          : "Tomeio · Version unavailable"}
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
        Choose one active provider. Add-ons are installed and configured from
        the Add-ons page.
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
                backgroundColor: selected
                  ? colors.accentMuted
                  : colors.surfaceRaised,
              }}
            >
              <Feather
                name={selected ? "check-circle" : "circle"}
                size={19}
                color={selected ? colors.accent : colors.textMuted}
              />
              <View className="flex-1 py-2">
                <Text
                  className="text-sm font-medium"
                  style={{ color: colors.text }}
                >
                  {manifest.name}
                </Text>
                <Text
                  numberOfLines={1}
                  className="mt-0.5 text-xs"
                  style={{ color: colors.textMuted }}
                >
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
                backgroundColor: active
                  ? colors.accentMuted
                  : colors.surfaceRaised,
              }}
            >
              <View
                className="h-14 w-14 overflow-hidden rounded-2xl"
                style={{
                  backgroundColor:
                    option.id === "monochrome" ? "#FFB511" : colors.surface,
                }}
              >
                <Image
                  source={option.source}
                  contentFit={option.id === "monochrome" ? "contain" : "cover"}
                  style={{ width: "100%", height: "100%" }}
                />
              </View>
              <View className="flex-1">
                <Text
                  className="text-sm font-semibold"
                  style={{ color: colors.text }}
                >
                  {option.label}
                </Text>
                <Text
                  className="mt-1 text-xs"
                  style={{ color: colors.textMuted }}
                >
                  {option.detail}
                </Text>
              </View>
              {busy && active ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Feather
                  name={active ? "check-circle" : "circle"}
                  size={20}
                  color={active ? colors.accent : colors.textMuted}
                />
              )}
            </Pressable>
          );
        })}
      </View>
      <Text
        className="mt-4 text-xs leading-5"
        style={{ color: colors.textMuted }}
      >
        Android launchers can take a few seconds to refresh the home-screen
        icon. System themed icons may still apply the wallpaper palette.
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
  resetIcon: ComponentProps<typeof Feather>["name"];
}) {
  const label = !location ? emptyLabel : folderLocationLabel(location);
  return (
    <View className="gap-2">
      <SelectField label={label} icon="folder" onPress={onChoose} />
      {onReset ? (
        <PillButton
          label={resetLabel}
          icon={resetIcon}
          variant="overlay"
          onPress={onReset}
        />
      ) : null}
    </View>
  );
}

function HostedSyncDialog({
  onClose,
  onAuthenticated,
}: {
  onClose: () => void;
  onAuthenticated: (account: HostedSyncAccount) => void;
}) {
  type Step =
    | "login"
    | "register"
    | "verify"
    | "forgot"
    | "recovery-code"
    | "reset";
  const [step, setStep] = useState<Step>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);

  const fail = (cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  };

  const acceptChallenge = (challenge: { debugCode?: string }) => {
    const developmentCode = challenge.debugCode ?? null;
    setDebugCode(developmentCode);
    setCode(developmentCode ?? "");
  };

  const submitCredentials = async () => {
    const normalizedEmail = email.trim();
    setBusy(true);
    setError(null);
    try {
      if (step === "register") {
        const challenge = await registerHostedSync(normalizedEmail, password);
        acceptChallenge(challenge);
        setStep("verify");
        return;
      }
      const account = await loginHostedSync(normalizedEmail, password);
      onAuthenticated(account);
    } catch (cause) {
      if (
        cause instanceof HostedSyncError &&
        cause.code === "email_unverified"
      ) {
        try {
          const challenge = await requestHostedSyncCode(
            normalizedEmail,
            "confirm",
          );
          acceptChallenge(challenge);
          setStep("verify");
        } catch (verificationCause) {
          fail(verificationCause);
        }
      } else {
        fail(cause);
      }
    } finally {
      setBusy(false);
    }
  };

  const requestRecovery = async () => {
    const normalizedEmail = email.trim();
    setBusy(true);
    setError(null);
    try {
      const challenge = await requestHostedSyncCode(
        normalizedEmail,
        "recovery",
      );
      acceptChallenge(challenge);
      setStep("recovery-code");
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      if (step === "verify") {
        const account = await verifyHostedSyncEmail(email.trim(), code);
        onAuthenticated(account);
        return;
      }
      const recovery = await verifyHostedSyncRecoveryCode(email.trim(), code);
      setRecoveryToken(recovery.recoveryToken);
      setPassword("");
      setPasswordConfirmation("");
      setStep("reset");
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    const action = step === "verify" ? "confirm" : "recovery";
    setBusy(true);
    setError(null);
    try {
      const challenge = await requestHostedSyncCode(email.trim(), action);
      if (action === "confirm" && challenge.state === "verified") {
        setStep("login");
        setCode("");
        setDebugCode(null);
        setError("This email is already verified. Sign in with your password.");
        return;
      }
      acceptChallenge(challenge);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (recoveryToken == null) {
      setError("Request a new password-reset code.");
      setStep("forgot");
      return;
    }
    if (password !== passwordConfirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const account = await resetHostedSyncPassword(recoveryToken, password);
      onAuthenticated(account);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const title =
    step === "register"
      ? "Create sync account"
      : step === "verify"
        ? "Confirm your email"
        : step === "forgot"
          ? "Reset password"
          : step === "recovery-code"
            ? "Enter reset code"
            : step === "reset"
              ? "Choose a new password"
              : "Tomeio Sync";

  const codeStep = step === "verify" || step === "recovery-code";
  const credentialStep = step === "login" || step === "register";

  return (
    <AppDialog
      visible
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Text
        className="mb-4 text-sm leading-5"
        style={{ color: colors.textMuted }}
      >
        {step === "verify"
          ? `Enter the six-digit code sent to ${email.trim()}.`
          : step === "forgot"
            ? "Enter your account email and we’ll send a six-digit reset code."
            : step === "recovery-code"
              ? `Enter the six-digit reset code sent to ${email.trim()}.`
              : step === "reset"
                ? "Your new password will also become the password used by KOReader and Moon+ Reader."
                : "Sync is optional. Your library remains available on this device without an account."}
      </Text>
      <View className="gap-3">
        {credentialStep || step === "forgot" ? (
          <TextInput
            value={email}
            onChangeText={setEmail}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            className="h-14 px-5 text-[15px]"
            style={{
              color: colors.text,
              backgroundColor: colors.surfaceRaised,
              borderRadius: 999,
            }}
          />
        ) : null}
        {credentialStep || step === "reset" ? (
          <TextInput
            value={password}
            onChangeText={setPassword}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={
              step === "reset" || step === "register"
                ? "new-password"
                : "current-password"
            }
            secureTextEntry
            placeholder={step === "reset" ? "New password" : "Password"}
            placeholderTextColor={colors.textMuted}
            className="h-14 px-5 text-[15px]"
            style={{
              color: colors.text,
              backgroundColor: colors.surfaceRaised,
              borderRadius: 999,
            }}
          />
        ) : null}
        {step === "reset" ? (
          <TextInput
            value={passwordConfirmation}
            onChangeText={setPasswordConfirmation}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            secureTextEntry
            placeholder="Confirm new password"
            placeholderTextColor={colors.textMuted}
            className="h-14 px-5 text-[15px]"
            style={{
              color: colors.text,
              backgroundColor: colors.surfaceRaised,
              borderRadius: 999,
            }}
          />
        ) : null}
        {codeStep ? (
          <TextInput
            value={code}
            onChangeText={(value) =>
              setCode(value.replace(/\D/gu, "").slice(0, 6))
            }
            editable={!busy}
            autoComplete="one-time-code"
            keyboardType="number-pad"
            maxLength={6}
            placeholder="000000"
            placeholderTextColor={colors.textMuted}
            className="h-16 px-5 text-center text-2xl tracking-[10px]"
            style={{
              color: colors.text,
              backgroundColor: colors.surfaceRaised,
              borderRadius: 999,
            }}
          />
        ) : null}
        {debugCode ? (
          <Text
            className="text-center text-xs"
            style={{ color: colors.textMuted }}
          >
            Development code: {debugCode}
          </Text>
        ) : null}
        {error ? (
          <Text className="text-sm leading-5 text-red-400">{error}</Text>
        ) : null}
        {credentialStep ? (
          <PillButton
            label={
              busy
                ? "Please wait…"
                : step === "login"
                  ? "Sign in"
                  : "Create account"
            }
            variant="accent"
            disabled={busy || !email.trim() || password.length < 10}
            onPress={() => void submitCredentials()}
          />
        ) : step === "forgot" ? (
          <PillButton
            label={busy ? "Sending…" : "Send reset code"}
            variant="accent"
            disabled={busy || !email.trim()}
            onPress={() => void requestRecovery()}
          />
        ) : codeStep ? (
          <PillButton
            label={
              busy
                ? "Checking…"
                : step === "verify"
                  ? "Confirm email"
                  : "Continue"
            }
            variant="accent"
            disabled={busy || code.length !== 6}
            onPress={() => void submitCode()}
          />
        ) : (
          <PillButton
            label={busy ? "Saving…" : "Save new password"}
            variant="accent"
            disabled={
              busy || password.length < 10 || passwordConfirmation.length < 10
            }
            onPress={() => void resetPassword()}
          />
        )}
        {codeStep ? (
          <PillButton
            label="Send another code"
            variant="overlay"
            disabled={busy}
            onPress={() => void resendCode()}
          />
        ) : null}
        {step === "login" ? (
          <PillButton
            label="Forgot password?"
            variant="overlay"
            disabled={busy}
            onPress={() => {
              setError(null);
              setPassword("");
              setStep("forgot");
            }}
          />
        ) : null}
        <PillButton
          label={
            step === "register"
              ? "I already have an account"
              : step === "login"
                ? "Create an account"
                : "Back to sign in"
          }
          variant="overlay"
          disabled={busy}
          onPress={() => {
            setError(null);
            setCode("");
            setDebugCode(null);
            setRecoveryToken(null);
            setPassword("");
            setPasswordConfirmation("");
            setStep(step === "login" ? "register" : "login");
          }}
        />
      </View>
    </AppDialog>
  );
}

function LibraryImportDialog({
  preview,
  books,
  busy,
  onImport,
  onClose,
}: {
  preview: LibraryImportPreview | null;
  books: LibraryBook[];
  busy: boolean;
  onImport: () => void;
  onClose: () => void;
}) {
  const localAliases = useMemo(() => {
    const aliases = new Set<string>();
    for (const book of books) {
      aliases.add(bookIdentity(book.title, book.author));
      if (book.local?.filename) {
        aliases.add(`filename:${book.local.filename.toLowerCase()}`);
      }
    }
    return aliases;
  }, [books]);
  const matched =
    preview?.libraryRecords.filter((record) =>
      [record.identity, ...record.aliases].some((alias) =>
        localAliases.has(alias),
      ),
    ).length ?? 0;

  return (
    <AppDialog
      visible={preview != null}
      title={preview?.importTitle ?? "Import reader backup"}
      onClose={onClose}
    >
      {preview ? (
        <View className="gap-5">
          <Text className="text-sm leading-6" style={{ color: colors.textMuted }}>
            {preview.name} contains {preview.libraryRecords.length} book
            {preview.libraryRecords.length === 1 ? "" : "s"} and {preview.records.length}{" "}
            progress record{preview.records.length === 1 ? "" : "s"}.
          </Text>
          <View
            className="gap-2 rounded-2xl border p-4"
            style={{ borderColor: colors.border, backgroundColor: colors.surfaceRaised }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.text }}>
              {matched} matched on this device
            </Text>
            <Text className="text-xs leading-5" style={{ color: colors.textMuted }}>
              {preview.libraryRecords.length - matched} unmatched book
              {preview.libraryRecords.length - matched === 1 ? "" : "s"} will appear as not local.
              The backup and book files stay on this device; normalized library metadata and progress are synced.
            </Text>
            {preview.warnings.length ? (
              <Text className="text-xs leading-5" style={{ color: colors.textMuted }}>
                {preview.warnings.join("\n")}
              </Text>
            ) : null}
          </View>
          <View className="gap-3">
            <PillButton
              label={busy ? "Importing…" : "Import and sync"}
              icon={busy ? undefined : "upload-cloud"}
              variant="accent"
              disabled={busy}
              onPress={onImport}
            />
            <PillButton
              label="Cancel"
              variant="overlay"
              disabled={busy}
              onPress={onClose}
            />
          </View>
        </View>
      ) : null}
    </AppDialog>
  );
}

export default function SettingsScreen() {
  const { width } = useWindowDimensions();
  const gutter = usePageGutter();
  const bottomPadding = usePageBottomPadding(54);
  const showMenu = width >= 800;
  const availableSectionWidth =
    width - (width >= 700 ? 76 : 0) - (showMenu ? 360 : 48);
  const compactOptions = availableSectionWidth < 560;
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Partial<Record<SettingsSectionId, number>>>({});
  const [selectedSection, setSelectedSection] = useState<SettingsSectionId>(
    SECTIONS[0].id,
  );
  const [providerPicker, setProviderPicker] = useState<ProviderRole | null>(
    null,
  );
  const [launcherIconPicker, setLauncherIconPicker] = useState(false);
  const [launcherIcon, setLauncherIcon] = useState<LauncherIcon>("full");
  const [launcherIconBusy, setLauncherIconBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [hostedSyncAccount, setHostedSyncAccount] =
    useState<HostedSyncAccount | null>(null);
  const [hostedSyncDialog, setHostedSyncDialog] = useState(false);
  const [hostedSyncBusy, setHostedSyncBusy] = useState(false);
  const [hostedSyncLastSyncedAt, setHostedSyncLastSyncedAt] = useState<
    number | null
  >(null);
  const [libraryImport, setLibraryImport] =
    useState<LibraryImportPreview | null>(null);
  const [libraryImportBusy, setLibraryImportBusy] = useState(false);
  const [libraryImportSummaries, setLibraryImportSummaries] = useState<
    Record<string, string>
  >({});
  const extensions = useExtensions();
  const { settings, update } = useSettings();
  const { downloaded } = useLibraryCatalog();
  const { refreshLocalBooks } = useLibraryActions();

  const showError = useCallback((title: string, cause: unknown) => {
    setSettingsError({
      title,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }, []);

  const enabledManifests = useMemo(
    () => [
      ...extensions.thirdParty
        .filter((extension) => extension.enabled)
        .map((extension) => extension.manifest),
      ...extensions.bundled,
    ],
    [extensions.bundled, extensions.thirdParty],
  );
  const searchProviders = useMemo(
    () =>
      enabledManifests.filter((manifest) =>
        supportsExtensionProviderRole(manifest, "search"),
      ),
    [enabledManifests],
  );
  const discoveryProviders = useMemo(
    () =>
      enabledManifests.filter((manifest) =>
        supportsExtensionProviderRole(manifest, "discovery"),
      ),
    [enabledManifests],
  );
  const acquisitionProviders = useMemo(
    () =>
      enabledManifests.filter((manifest) =>
        supportsExtensionProviderRole(manifest, "acquisition"),
      ),
    [enabledManifests],
  );
  const libraryImports = useMemo(
    () => extensions.libraryImports(),
    [extensions],
  );
  const selectedSearch = searchProviders.find(
    (manifest) => manifest.id === extensions.searchExtensionId,
  );
  const selectedDiscovery = discoveryProviders.find(
    (manifest) => manifest.id === extensions.discoveryExtensionId,
  );
  const selectedAcquisition = acquisitionProviders.find(
    (manifest) => manifest.id === extensions.acquisitionExtensionId,
  );

  useEffect(() => {
    if (Platform.OS !== "android" || !hasNativeLauncherIcon()) return;
    getNativeLauncherIcon()
      .then((icon) => {
        setLauncherIcon(icon);
      })
      .catch((cause) => {
        showError("Could not load app icon", cause);
      });
  }, [showError]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    getHostedSyncAccount()
      .then((account) => {
        setHostedSyncAccount(account);
      })
      .catch((cause) => {
        showError("Could not load Tomeio Sync", cause);
      });
  }, [showError]);

  const scrollToSection = (section: SettingsSectionId) => {
    setSelectedSection(section);
    scrollRef.current?.scrollTo({
      y: sectionOffsets.current[section] ?? 0,
      animated: true,
    });
  };

  const updateSelectedSection = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    const marker = event.nativeEvent.contentOffset.y + 60;
    const active = SECTIONS.reduce<SettingsSectionId>((current, section) => {
      const offset = sectionOffsets.current[section.id];
      return typeof offset === "number" && offset <= marker
        ? section.id
        : current;
    }, "providers");
    if (active !== selectedSection) setSelectedSection(active);
  };

  const chooseFolder = async (setting: FolderLocationSetting) => {
    beginFolderPicker();
    try {
      const picked = await pickDownloadFolder(
        isExternalFolderLocation(settings[setting])
          ? settings[setting]
          : settings.folderPickerLocations[setting],
      );
      if (!picked) return;
      await update({
        [setting]: picked.uri,
        folderPickerLocations: {
          ...settings.folderPickerLocations,
          [setting]: picked.uri,
        },
      });
    } catch (cause) {
      showError("Folder picker failed", cause);
    } finally {
      endFolderPicker();
    }
  };

  const resetFolder = async (setting: FolderLocationSetting) => {
    if (settings[setting]) await forgetNativeDirectory(settings[setting]);
    await update({ [setting]: null });
  };

  const setProvider = async (role: ProviderRole, id: string) => {
    try {
      if (role === "discovery") await extensions.setDiscoveryExtension(id);
      else if (role === "search") await extensions.setSearchExtension(id);
      else await extensions.setAcquisitionExtension(id);
      setProviderPicker(null);
    } catch (cause) {
      showError("Could not change provider", cause);
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
      setLauncherIconPicker(false);
    } catch (cause) {
      showError("Could not change app icon", cause);
    } finally {
      setLauncherIconBusy(false);
    }
  };

  const syncHostedNow = async () => {
    setHostedSyncBusy(true);
    try {
      const result = await synchronizeHostedProgress();
      await refreshLocalBooks();
      setHostedSyncLastSyncedAt(result.syncedAt);
      if (result.unmatchedRecords > 0) {
        setSettingsError({
          title: "Sync incomplete",
          message: `${result.unmatchedRecords} remote book${result.unmatchedRecords === 1 ? "" : "s"} could not be matched on this device.`,
        });
      }
    } catch (cause) {
      showError("Tomeio Sync failed", cause);
    } finally {
      setHostedSyncBusy(false);
    }
  };

  const signOutHostedSync = async () => {
    setHostedSyncBusy(true);
    try {
      await logoutHostedSync();
      setHostedSyncAccount(null);
      setHostedSyncLastSyncedAt(null);
    } catch (cause) {
      showError("Could not sign out", cause);
    } finally {
      setHostedSyncBusy(false);
    }
  };

  const chooseLibraryBackup = async (available: AvailableLibraryImport) => {
    setLibraryImportBusy(true);
    try {
      const file = await pickLibraryImportFile(available);
      if (!file) return;
      const result = await extensions.runLibraryImport(
        available.extensionId,
        available.id,
        file.uri,
        file.name,
      );
      setLibraryImport(
        createLibraryImportPreview(
          available.extensionId,
          available.extensionName,
          available.id,
          available.title,
          file,
          result,
        ),
      );
    } catch (cause) {
      showError("Could not read reader backup", cause);
    } finally {
      setLibraryImportBusy(false);
    }
  };

  const confirmLibraryImport = async () => {
    if (!libraryImport) return;
    setLibraryImportBusy(true);
    try {
      const result = await importLibraryBackup(libraryImport);
      await refreshLocalBooks();
      setLibraryImportSummaries((current) => ({
        ...current,
        [`${libraryImport.extensionId}:${libraryImport.importId}`]:
          `${result.books} book${result.books === 1 ? "" : "s"} and ${result.progressRecords} progress record${result.progressRecords === 1 ? "" : "s"} imported from ${libraryImport.name}.`,
      }));
      setLibraryImport(null);
    } catch (cause) {
      showError("Reader backup import failed", cause);
    } finally {
      setLibraryImportBusy(false);
    }
  };

  return (
    <View
      className="flex-1 flex-row"
      style={{ backgroundColor: colors.background }}
    >
      {showMenu ? (
        <SettingsMenu selected={selectedSection} onSelect={scrollToSection} />
      ) : null}
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
        {Platform.OS === "android" ? (
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
              detail={"Choose the Tomeio icon shown by the Android launcher."}
            >
              <SelectField
                label={
                  LAUNCHER_ICONS.find((option) => option.id === launcherIcon)
                    ?.label ?? "Full colour"
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
              label={selectedDiscovery?.name ?? "No provider available"}
              onPress={() => setProviderPicker("discovery")}
            />
          </SettingsOption>
          <SettingsOption
            compact={compactOptions}
            label="Search provider"
            detail="Supplies searches across titles, authors and ISBNs."
          >
            <SelectField
              label={selectedSearch?.name ?? "No provider available"}
              onPress={() => setProviderPicker("search")}
            />
          </SettingsOption>
          <SettingsOption
            compact={compactOptions}
            label="Download provider"
            detail="Resolves a selected book into downloadable editions and formats."
          >
            <SelectField
              label={selectedAcquisition?.name ?? "No provider available"}
              onPress={() => setProviderPicker("acquisition")}
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
              onChoose={() => void chooseFolder("localLibraryLocation")}
              onReset={
                settings.localLibraryLocation
                  ? () => void resetFolder("localLibraryLocation")
                  : undefined
              }
              resetLabel="Use app folder"
              resetIcon="home"
            />
          </SettingsOption>
        </SettingsSection>

        <SettingsSection
          title="Sync"
          compact={compactOptions}
          onLayout={(event) => {
            sectionOffsets.current.sync = event.nativeEvent.layout.y;
          }}
        >
          <SettingsOption
            compact={compactOptions}
            label="Tomeio Sync"
            detail={
              Platform.OS === "web"
                ? "Secure account sync is available in the Android and iOS apps."
                : (hostedSyncAccount?.email ??
                  "Optional sync for Tomeio, KOReader, and Moon+ Reader.")
            }
          >
            {hostedSyncAccount ? (
              <PillButton
                label={hostedSyncBusy ? "Please wait…" : "Sign out"}
                icon="log-out"
                variant="overlay"
                disabled={hostedSyncBusy}
                onPress={() => void signOutHostedSync()}
              />
            ) : (
              <PillButton
                label="Sign in"
                icon="log-in"
                variant="accent"
                disabled={Platform.OS === "web"}
                onPress={() => setHostedSyncDialog(true)}
              />
            )}
          </SettingsOption>
          {hostedSyncAccount ? (
            <SettingsOption
              compact={compactOptions}
              label="Synchronize Tomeio"
              detail={
                hostedSyncLastSyncedAt
                  ? `Last synced ${new Date(hostedSyncLastSyncedAt).toLocaleString()}`
                  : "Sync your library and reading list across Tomeio devices, with shared progress from KOReader and Moon+ Reader."
              }
            >
              <PillButton
                label={hostedSyncBusy ? "Syncing…" : "Sync now"}
                icon={hostedSyncBusy ? undefined : "refresh-cw"}
                variant="accent"
                disabled={hostedSyncBusy}
                onPress={() => void syncHostedNow()}
              />
            </SettingsOption>
          ) : null}
          {libraryImports.map((available) => (
            <SettingsOption
              key={`${available.extensionId}:${available.id}`}
              compact={compactOptions}
              label={available.title}
              detail={
                libraryImportSummaries[`${available.extensionId}:${available.id}`] ??
                available.description ??
                `Import books and progress using ${available.extensionName}.`
              }
            >
              <PillButton
                label={libraryImportBusy ? "Reading…" : "Choose backup"}
                icon={libraryImportBusy ? undefined : "file-plus"}
                variant="overlay"
                disabled={libraryImportBusy || Platform.OS === "web"}
                onPress={() => void chooseLibraryBackup(available)}
              />
            </SettingsOption>
          ))}
        </SettingsSection>
      </ScrollView>

      <ProviderPicker
        role={providerPicker}
        options={
          providerPicker === "discovery"
            ? discoveryProviders
            : providerPicker === "search"
              ? searchProviders
              : acquisitionProviders
        }
        selectedId={
          providerPicker === "discovery"
            ? extensions.discoveryExtensionId
            : providerPicker === "search"
              ? extensions.searchExtensionId
              : extensions.acquisitionExtensionId
        }
        onSelect={(id) =>
          providerPicker && void setProvider(providerPicker, id)
        }
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
      {hostedSyncDialog ? (
        <HostedSyncDialog
          onAuthenticated={(account) => {
            setHostedSyncAccount(account);
            setHostedSyncDialog(false);
            void syncHostedNow();
          }}
          onClose={() => {
            if (!hostedSyncBusy) setHostedSyncDialog(false);
          }}
        />
      ) : null}
      <LibraryImportDialog
        preview={libraryImport}
        books={downloaded}
        busy={libraryImportBusy}
        onImport={() => void confirmLibraryImport()}
        onClose={() => {
          if (!libraryImportBusy) setLibraryImport(null);
        }}
      />
      <AppErrorDialog
        title={settingsError?.title ?? "Something went wrong"}
        message={settingsError?.message ?? null}
        onClose={() => setSettingsError(null)}
      />
    </View>
  );
}
