import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AppDialog, colors, PillButton } from '@/components/app-ui';
import { HostedSyncError, loginHostedSync, registerHostedSync, requestHostedSyncCode,
  resetHostedSyncPassword, verifyHostedSyncEmail, verifyHostedSyncRecoveryCode,
  type HostedSyncAccount } from '@/lib/hosted-sync';

export function HostedSyncDialog({
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
