import { Feather } from "@expo/vector-icons";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { Image } from "expo-image";
import {
  supportsExtensionProviderRole,
  type ExtensionReaderSetupResult,
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
  Share,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { AppErrorDialog } from "@/components/app-error-dialog";
import { AppBottomSheet } from "@/components/app-bottom-sheet";
import { AppTextSheet } from "@/components/app-text-sheet";
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
  type AvailableReaderSetup,
} from "@/context/extensions-context";
import {
  useLibraryActions,
  useLibraryCatalog,
  useLibraryUiStatus,
} from "@/context/library-context";
import { useSettings } from "@/context/settings-context";
import { useLibraryFileMirror } from "@/context/library-file-mirror-context";
import {
  describeFolderLocation,
  folderLocationLabel,
  isExternalFolderLocation,
  isSafLocation,
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
type SettingsSectionId =
  | "appearance"
  | "providers"
  | "library"
  | "sync"
  | "import-export";
const BASE_SECTIONS: { id: SettingsSectionId; label: string }[] = [
  ...(Platform.OS === "android"
    ? [{ id: "appearance" as const, label: "Appearance" }]
    : []),
  { id: "providers", label: "Providers" },
  { id: "library", label: "Library" },
  { id: "sync", label: "Sync" },
];

const APP_VERSION =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;

const LIBRARY_MIRROR_INFORMATION =
  "Tomeio keeps supported ebook files matched between the primary library and the on-device mirror. It checks immediately when mirroring is enabled, after provider downloads, and whenever Tomeio returns to the foreground. Files added, updated, or deleted in either folder are applied to the other. The first match combines both folders and uses the newer file when the same path differs. On later matches, the primary library resolves simultaneous changes. Tomeio never mirrors metadata, covers, saved-book records, reading progress, hidden files, or MoonReader data folders.";

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
  sections,
  selected,
  onSelect,
}: {
  sections: { id: SettingsSectionId; label: string }[];
  selected: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
}) {
  return (
    <View className="h-full w-72 px-6 py-12">
      {sections.map((section) => {
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
      <ScrollView
        className="max-h-[500px]"
        contentContainerClassName="gap-2"
        showsVerticalScrollIndicator={false}
      >
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
  emptyDetail,
  onInspectionError,
}: {
  location: string | null;
  emptyLabel: string;
  onChoose: () => void;
  onReset?: () => void;
  resetLabel: string;
  resetIcon: ComponentProps<typeof Feather>["name"];
  emptyDetail: string;
  onInspectionError: (cause: unknown) => void;
}) {
  const [description, setDescription] = useState<{
    location: string;
    label: string;
    detail: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    if (!location) return;
    describeFolderLocation(location)
      .then((value) => {
        if (active) setDescription({ location, ...value });
      })
      .catch((cause) => {
        if (!active) return;
        setDescription({
          location,
          label: folderLocationLabel(location),
          detail: "Folder access needs attention",
        });
        onInspectionError(cause);
      });
    return () => {
      active = false;
    };
  }, [location, onInspectionError]);
  const currentDescription = description?.location === location ? description : null;
  const label = !location ? emptyLabel : (currentDescription?.label ?? folderLocationLabel(location));
  const detail = !location ? emptyDetail : (currentDescription?.detail ?? "Inspecting storage provider…");
  return (
    <View className="w-full gap-2">
      <SelectField label={label} icon="folder" onPress={onChoose} />
      <Text className="px-2 text-xs leading-[18px]" style={{ color: colors.textMuted }}>
        {detail}
      </Text>
      {onReset ? (
        <PillButton
          label={resetLabel}
          icon={resetIcon}
          variant="overlay"
          onPress={onReset}
          fullWidth
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
          <Text className="text-sm leading-5" style={{ color: colors.danger }}>{error}</Text>
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

function ReaderSetupDialog({
  setup,
  result,
  busy,
  onAction,
  onClose,
}: {
  setup: AvailableReaderSetup | null;
  result: ExtensionReaderSetupResult | null;
  busy: boolean;
  onAction: (action: "connect" | "disconnect") => void;
  onClose: () => void;
}) {
  return (
    <AppDialog
      visible={setup != null}
      title={setup?.title ?? "Reader setup"}
      onClose={onClose}
    >
      {setup ? (
        <View className="gap-5">
          <Text className="text-sm leading-6" style={{ color: colors.textMuted }}>
            {setup.description ?? `Connect ${setup.extensionName} to Tomeio Sync.`}
          </Text>
          {result ? (
            <>
              <View
                className="gap-3 rounded-2xl border p-4"
                style={{ borderColor: colors.border, backgroundColor: colors.surfaceRaised }}
              >
                <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                  {result.connected ? "Kobo connection active" : "Kobo is not connected"}
                </Text>
                {result.endpoint ? (
                  <Text selectable className="text-xs leading-5" style={{ color: colors.text }}>
                    {result.endpoint}
                  </Text>
                ) : result.connected ? (
                  <Text className="text-xs leading-5" style={{ color: colors.textMuted }}>
                    This account already has a Kobo endpoint. Generate a new one to view it; the old endpoint will stop working.
                  </Text>
                ) : null}
                {result.lastUsedAt ? (
                  <Text className="text-xs" style={{ color: colors.textMuted }}>
                    Last used {new Date(result.lastUsedAt).toLocaleString()}
                  </Text>
                ) : null}
              </View>
              <View className="gap-2 px-1">
                {result.instructions.map((instruction, index) => (
                  <Text key={instruction} className="text-xs leading-5" style={{ color: colors.textMuted }}>
                    {index + 1}. {instruction}
                  </Text>
                ))}
              </View>
              {result.warnings?.length ? (
                <View
                  className="gap-2 rounded-2xl border p-4"
                  style={{ borderColor: colors.border, backgroundColor: colors.surfaceRaised }}
                >
                  {result.warnings.map((warning) => (
                    <Text key={warning} className="text-xs leading-5" style={{ color: colors.textMuted }}>
                      {warning}
                    </Text>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <View className="items-center py-4">
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          )}
          <View className="gap-3">
            {result?.endpoint ? (
              <PillButton
                label="Share private endpoint"
                icon="share-2"
                variant="overlay"
                disabled={busy}
                onPress={() => {
                  void Share.share({ message: result.endpoint! });
                }}
              />
            ) : null}
            <PillButton
              label={
                busy
                  ? "Updating…"
                  : result?.connected
                    ? "Generate new endpoint"
                    : "Connect Kobo"
              }
              icon={busy ? undefined : "link"}
              variant="accent"
              disabled={busy || result == null}
              onPress={() => onAction("connect")}
            />
            {result?.connected ? (
              <PillButton
                label="Disconnect Kobo"
                icon="x"
                variant="danger"
                disabled={busy}
                onPress={() => onAction("disconnect")}
              />
            ) : null}
            <PillButton label="Close" variant="overlay" disabled={busy} onPress={onClose} />
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
    BASE_SECTIONS[0].id,
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
  const [hostedAuthBusy, setHostedAuthBusy] = useState(false);
  const [libraryImport, setLibraryImport] =
    useState<LibraryImportPreview | null>(null);
  const [libraryImportBusy, setLibraryImportBusy] = useState(false);
  const [readerSetup, setReaderSetup] = useState<AvailableReaderSetup | null>(null);
  const [readerSetupResult, setReaderSetupResult] =
    useState<ExtensionReaderSetupResult | null>(null);
  const [readerSetupBusy, setReaderSetupBusy] = useState(false);
  const [libraryMirrorInformation, setLibraryMirrorInformation] = useState(false);
  const [libraryMirrorProgress, setLibraryMirrorProgress] = useState(false);
  const [libraryImportSummaries, setLibraryImportSummaries] = useState<
    Record<string, string>
  >({});
  const extensions = useExtensions();
  const { settings, update } = useSettings();
  const libraryMirror = useLibraryFileMirror();
  const { downloaded } = useLibraryCatalog();
  const { refreshLocalBooks, synchronizeLibrary } = useLibraryActions();
  const { scanning, activity, lastSyncedAt } = useLibraryUiStatus();
  const hostedSyncBusy =
    scanning ||
    (activity?.state === "running" &&
      (activity.title.includes("Synchron") ||
        activity.title.includes("Updating library")));

  const showError = useCallback((title: string, cause: unknown) => {
    setSettingsError({
      title,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }, []);
  const showFolderInspectionError = useCallback(
    (cause: unknown) => showError("Could not inspect folder", cause),
    [showError],
  );
  const shownMirrorError = useRef<string | null>(null);

  useEffect(() => {
    if (
      libraryMirrorProgress ||
      !libraryMirror.error ||
      shownMirrorError.current === libraryMirror.error
    ) return;
    shownMirrorError.current = libraryMirror.error;
    showError("Book folder mirror failed", new Error(libraryMirror.error));
  }, [libraryMirror.error, libraryMirrorProgress, showError]);

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
  const readerSetups = useMemo(
    () => extensions.readerSetups(),
    [extensions],
  );
  const sections = useMemo(
    () =>
      libraryImports.length
        ? [
            ...BASE_SECTIONS,
            { id: "import-export" as const, label: "Import / Export" },
          ]
        : BASE_SECTIONS,
    [libraryImports.length],
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
    const active = sections.reduce<SettingsSectionId>((current, section) => {
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
      const otherSetting: FolderLocationSetting =
        setting === "localLibraryLocation"
          ? "libraryMirrorLocation"
          : "localLibraryLocation";
      if (picked.uri === settings[otherSetting]) {
        throw new Error("Choose two different folders for the primary library and device mirror.");
      }
      if (setting === "libraryMirrorLocation") {
        const description = await describeFolderLocation(picked.uri);
        if (description.kind === "cloud") {
          throw new Error(
            "The mirror folder must be on this device. Choose the /Books folder or another folder in on-device storage.",
          );
        }
      }
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
    await update({ [setting]: null, libraryMirrorEnabled: false });
  };

  const setLibraryMirrorEnabled = async (enabled: boolean) => {
    if (
      enabled &&
      (!isSafLocation(settings.localLibraryLocation) ||
        !isSafLocation(settings.libraryMirrorLocation))
    ) {
      showError(
        "Choose both book folders",
        new Error(
          "Select an Android document-provider folder for both the primary library and the on-device mirror first.",
        ),
      );
      return;
    }
    try {
      if (enabled && settings.libraryMirrorLocation) {
        const description = await describeFolderLocation(settings.libraryMirrorLocation);
        if (description.kind === "cloud") {
          showError(
            "Choose an on-device mirror",
            new Error(
              "The selected mirror is cloud storage. Choose the /Books folder or another folder stored on this device.",
            ),
          );
          return;
        }
      }
      await update({ libraryMirrorEnabled: enabled });
      setLibraryMirrorProgress(enabled);
    } catch (cause) {
      showError("Could not update book folder mirror", cause);
    }
  };

  const syncLibraryMirrorNow = async () => {
    setLibraryMirrorProgress(true);
    try {
      await libraryMirror.syncNow();
    } catch {
      // The progress sheet presents the mirror failure with its current context.
    }
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
    try {
      await synchronizeLibrary();
    } catch (cause) {
      showError("Tomeio Sync failed", cause);
    }
  };

  const openReaderSetup = async (setup: AvailableReaderSetup) => {
    setReaderSetup(setup);
    setReaderSetupResult(null);
    try {
      setReaderSetupResult(
        await extensions.runReaderSetup(setup.extensionId, {
          setupId: setup.id,
          action: "status",
        }),
      );
    } catch (cause) {
      setReaderSetup(null);
      showError("Could not load reader setup", cause);
    }
  };

  const updateReaderSetup = async (action: "connect" | "disconnect") => {
    if (!readerSetup) return;
    setReaderSetupBusy(true);
    try {
      const result = await extensions.runReaderSetup(readerSetup.extensionId, {
        setupId: readerSetup.id,
        action,
      });
      setReaderSetupResult(result);
      if (action === "connect") await syncHostedNow();
    } catch (cause) {
      showError("Could not update Kobo connection", cause);
    } finally {
      setReaderSetupBusy(false);
    }
  };

  const signOutHostedSync = async () => {
    setHostedAuthBusy(true);
    try {
      await logoutHostedSync();
      setHostedSyncAccount(null);
    } catch (cause) {
      showError("Could not sign out", cause);
    } finally {
      setHostedAuthBusy(false);
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
        <SettingsMenu
          sections={sections}
          selected={selectedSection}
          onSelect={scrollToSection}
        />
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
              options={discoveryProviders.map((manifest) => ({
                label: manifest.name,
                value: manifest.id,
              }))}
              selectedValue={extensions.discoveryExtensionId ?? ""}
              onSelect={(id) => void setProvider("discovery", id)}
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
              options={searchProviders.map((manifest) => ({
                label: manifest.name,
                value: manifest.id,
              }))}
              selectedValue={extensions.searchExtensionId ?? ""}
              onSelect={(id) => void setProvider("search", id)}
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
              options={acquisitionProviders.map((manifest) => ({
                label: manifest.name,
                value: manifest.id,
              }))}
              selectedValue={extensions.acquisitionExtensionId ?? ""}
              onSelect={(id) => void setProvider("acquisition", id)}
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
            label="Primary library folder"
            detail="The authoritative library Tomeio indexes and uses for provider downloads. This can be Google Drive or an on-device folder."
          >
            <FolderField
              location={settings.localLibraryLocation}
              emptyLabel="Choose a primary library folder"
              emptyDetail="Not configured · Select the folder Tomeio should index"
              onChoose={() => void chooseFolder("localLibraryLocation")}
              onReset={
                settings.localLibraryLocation
                  ? () => void resetFolder("localLibraryLocation")
                  : undefined
              }
              resetLabel="Remove library folder"
              resetIcon="x"
              onInspectionError={showFolderInspectionError}
            />
          </SettingsOption>
          {Platform.OS === "android" ? (
            <>
              <SettingsOption
                compact={compactOptions}
                label="On-device mirror folder"
                detail="Choose the device folder scanned by Moon+ Reader, such as /Books. Tomeio stores only mirrored ebook files here."
              >
                <FolderField
                  location={settings.libraryMirrorLocation}
                  emptyLabel="Choose an on-device folder"
                  emptyDetail="Not configured · Select the folder Moon+ Reader scans"
                  onChoose={() => void chooseFolder("libraryMirrorLocation")}
                  onReset={
                    settings.libraryMirrorLocation
                      ? () => void resetFolder("libraryMirrorLocation")
                      : undefined
                  }
                  resetLabel="Remove mirror folder"
                  resetIcon="x"
                  onInspectionError={showFolderInspectionError}
                />
              </SettingsOption>
              <SettingsOption
                compact={compactOptions}
                label="Keep book folders matched"
                detail="Optional two-way mirror for supported ebook files."
                headerAction={
                  <Pressable
                    onPress={() => setLibraryMirrorInformation(true)}
                    accessibilityRole="button"
                    accessibilityLabel="About book folder mirroring"
                    className="h-10 w-10 items-center justify-center rounded-full active:opacity-75"
                    style={{ backgroundColor: colors.surfaceRaised }}
                  >
                    <Feather name="info" size={20} color={colors.textMuted} />
                  </Pressable>
                }
              >
                <View className="w-full gap-3">
                  <View
                    className="min-h-14 flex-row items-center justify-between rounded-full border px-5"
                    style={{
                      borderColor: settings.libraryMirrorEnabled
                        ? colors.accent
                        : colors.border,
                      backgroundColor: settings.libraryMirrorEnabled
                        ? colors.accentMuted
                        : colors.surfaceRaised,
                    }}
                  >
                    <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                      {settings.libraryMirrorEnabled ? "Mirroring on" : "Mirroring off"}
                    </Text>
                    <Switch
                      value={settings.libraryMirrorEnabled}
                      disabled={libraryMirror.state === "running"}
                      onValueChange={(value) => void setLibraryMirrorEnabled(value)}
                      trackColor={{ false: colors.border, true: colors.accent }}
                      thumbColor={colors.text}
                      accessibilityLabel="Keep primary and on-device book folders matched"
                    />
                  </View>
                  {settings.libraryMirrorEnabled ? (
                    <PillButton
                      label={libraryMirror.state === "running" ? "View matching progress" : "Match now"}
                      icon={libraryMirror.state === "running" ? "activity" : "refresh-cw"}
                      variant="overlay"
                      onPress={() => {
                        if (libraryMirror.state === "running") setLibraryMirrorProgress(true);
                        else void syncLibraryMirrorNow();
                      }}
                      fullWidth
                    />
                  ) : null}
                </View>
              </SettingsOption>
            </>
          ) : null}
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
                label={hostedAuthBusy ? "Signing out…" : "Sign out"}
                icon="log-out"
                variant="overlay"
                disabled={hostedAuthBusy}
                onPress={() => void signOutHostedSync()}
                fullWidth
              />
            ) : (
              <PillButton
                label="Sign in"
                icon="log-in"
                variant="accent"
                disabled={Platform.OS === "web"}
                onPress={() => setHostedSyncDialog(true)}
                fullWidth
              />
            )}
          </SettingsOption>
          {hostedSyncAccount ? (
            <SettingsOption
              compact={compactOptions}
              label="Synchronize Tomeio"
              detail={
                lastSyncedAt
                  ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}`
                  : "Sync your library and saved books across Tomeio devices, with shared progress from KOReader, Moon+ Reader, and Kobo."
              }
            >
              <PillButton
                label={hostedSyncBusy ? "Syncing…" : "Sync now"}
                icon={hostedSyncBusy ? undefined : "refresh-cw"}
                variant="accent"
                disabled={hostedSyncBusy || hostedAuthBusy}
                onPress={() => void syncHostedNow()}
                fullWidth
              />
            </SettingsOption>
          ) : null}
          {readerSetups.map((setup) => (
            <SettingsOption
              key={`${setup.extensionId}:${setup.id}`}
              compact={compactOptions}
              label={setup.title}
              detail={
                hostedSyncAccount
                  ? (setup.description ?? `Configure ${setup.extensionName}.`)
                  : "Sign in to Tomeio Sync before connecting this reader."
              }
            >
              <PillButton
                label="Set up"
                icon="link"
                variant="overlay"
                disabled={!hostedSyncAccount || hostedSyncBusy}
                onPress={() => void openReaderSetup(setup)}
                fullWidth
              />
            </SettingsOption>
          ))}
        </SettingsSection>

        {libraryImports.length ? (
          <SettingsSection
            title="Import / Export"
            compact={compactOptions}
            onLayout={(event) => {
              sectionOffsets.current["import-export"] =
                event.nativeEvent.layout.y;
            }}
          >
            {libraryImports.map((available) => (
              <SettingsOption
                key={`${available.extensionId}:${available.id}`}
                compact={compactOptions}
                label={available.title}
                detail={
                  libraryImportSummaries[
                    `${available.extensionId}:${available.id}`
                  ] ??
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
                  fullWidth
                />
              </SettingsOption>
            ))}
          </SettingsSection>
        ) : null}
      </ScrollView>

      <AppTextSheet
        visible={libraryMirrorInformation}
        title="Book folder mirroring"
        text={LIBRARY_MIRROR_INFORMATION}
        onClose={() => setLibraryMirrorInformation(false)}
      />
      <AppBottomSheet
        visible={libraryMirrorProgress}
        title="Matching book folders"
        onClose={() => setLibraryMirrorProgress(false)}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerClassName="gap-5 px-5 pb-10"
        >
          <View
            className="gap-2 rounded-2xl border p-4"
            style={{ borderColor: colors.border, backgroundColor: colors.surfaceRaised }}
          >
            <View className="flex-row items-center gap-3">
              <View
                className="h-11 w-11 items-center justify-center rounded-full"
                style={{ backgroundColor: colors.accentMuted }}
              >
                {libraryMirror.state === "running" ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Feather
                    name={libraryMirror.state === "error" ? "alert-circle" : "check"}
                    size={21}
                    color={libraryMirror.state === "error" ? colors.danger : colors.accent}
                  />
                )}
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-base font-semibold" style={{ color: colors.text }}>
                  {libraryMirror.state === "running"
                    ? libraryMirror.progress?.phase === "scanning"
                      ? "Reading both folders"
                      : libraryMirror.progress?.phase === "finalizing"
                        ? "Verifying the result"
                        : "Matching ebook files"
                    : libraryMirror.state === "error"
                      ? "Matching stopped"
                      : "Folders matched"}
                </Text>
                <Text className="text-xs leading-[18px]" style={{ color: colors.textMuted }}>
                  Primary library ↔ On-device mirror
                </Text>
              </View>
            </View>

            {libraryMirror.state === "running" && libraryMirror.progress?.total ? (
              <View className="mt-2 gap-2">
                <View
                  className="h-2 overflow-hidden rounded-full"
                  style={{ backgroundColor: colors.border }}
                >
                  <View
                    className="h-full rounded-full"
                    style={{
                      backgroundColor: colors.accent,
                      width: `${Math.round(
                        (libraryMirror.progress.completed / libraryMirror.progress.total) * 100,
                      )}%`,
                    }}
                  />
                </View>
                <Text className="text-xs" style={{ color: colors.textMuted }}>
                  {libraryMirror.progress.completed} of {libraryMirror.progress.total} checked
                </Text>
              </View>
            ) : null}
          </View>

          <View className="gap-2 px-1">
            <Text className="text-sm leading-5" style={{ color: colors.text }}>
              {libraryMirror.state === "running"
                ? (libraryMirror.progress?.detail ?? "Preparing the folder comparison…")
                : libraryMirror.state === "error"
                  ? (libraryMirror.error ?? "The folders could not be matched.")
                  : (libraryMirror.detail ?? "Both folders contain the same ebook files.")}
            </Text>
            {libraryMirror.state === "running" && libraryMirror.progress?.currentFile ? (
              <Text numberOfLines={3} className="text-xs leading-[18px]" style={{ color: colors.textMuted }}>
                {libraryMirror.progress.currentFile}
              </Text>
            ) : null}
            <Text className="text-xs leading-[18px]" style={{ color: colors.textMuted }}>
              Hidden files, MoonReader data, metadata, covers, and reading progress are excluded.
            </Text>
          </View>

          <PillButton
            label={libraryMirror.state === "running" ? "Continue in background" : "Done"}
            icon={libraryMirror.state === "running" ? "minimize-2" : "check"}
            variant={libraryMirror.state === "error" ? "overlay" : "accent"}
            onPress={() => setLibraryMirrorProgress(false)}
            fullWidth
          />
        </ScrollView>
      </AppBottomSheet>

      <ProviderPicker
        role={Platform.OS === "ios" ? null : providerPicker}
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
          onClose={() => setHostedSyncDialog(false)}
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
      <ReaderSetupDialog
        setup={readerSetup}
        result={readerSetupResult}
        busy={readerSetupBusy}
        onAction={(action) => void updateReaderSetup(action)}
        onClose={() => {
          if (!readerSetupBusy) {
            setReaderSetup(null);
            setReaderSetupResult(null);
          }
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
