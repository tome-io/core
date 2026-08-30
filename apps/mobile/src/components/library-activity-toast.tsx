import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { useLibraryUiStatus } from "@/context/library-context";

import { AppErrorDialog } from "./app-error-dialog";
import { colors, radii } from "./app-ui";

export function LibraryActivityToast() {
  const { width } = useWindowDimensions();
  const {
    activity,
    error,
    warning,
    dismissActivity,
    dismissError,
    dismissWarning,
  } = useLibraryUiStatus();
  const [detailsVisible, setDetailsVisible] = useState(false);
  const fallbackMessage = error ?? warning;
  const title =
    activity?.title ?? (error ? "Library error" : "Library needs attention");
  const detail = activity?.detail ?? fallbackMessage ?? undefined;
  const visible = activity != null || fallbackMessage != null;

  useEffect(() => {
    if (activity?.state !== "success") return;
    const timer = setTimeout(dismissActivity, 3_500);
    return () => clearTimeout(timer);
  }, [activity, dismissActivity]);

  const dismiss = () => {
    setDetailsVisible(false);
    if (activity) dismissActivity();
    if (error) dismissError();
    if (warning) dismissWarning();
  };

  if (!visible) return null;
  const compact = width < 700;
  const determinate =
    activity?.state === "running" &&
    typeof activity.completed === "number" &&
    typeof activity.total === "number" &&
    activity.total > 0;
  const progress = determinate
    ? Math.max(0, Math.min(1, activity.completed! / activity.total!))
    : 0;

  return (
    <>
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          right: compact ? 12 : 24,
          bottom: compact ? 92 : 24,
          left: compact ? 12 : undefined,
          width: compact ? undefined : 360,
          zIndex: 50,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${detail ?? ""}`}
          onPress={() => setDetailsVisible(true)}
          style={({ pressed }) => ({
            overflow: "hidden",
            borderRadius: radii.large,
            borderWidth: 1,
            borderColor: colors.accentMuted,
            backgroundColor: '#2b1d14',
            opacity: pressed ? 0.9 : 1,
            shadowColor: "#000",
            shadowOpacity: 0.35,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 10,
          })}
        >
          <View className="flex-row items-center gap-3 px-4 py-3.5">
            {activity?.state === "running" ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Feather
                name={activity?.state === "success" ? "check-circle" : "alert-circle"}
                size={20}
                color={
                  activity?.state === "success" ? colors.success : colors.accent
                }
              />
            )}
            <View className="min-w-0 flex-1">
              <Text
                numberOfLines={1}
                className="text-sm font-semibold"
                style={{ color: colors.text }}
              >
                {title}
              </Text>
              {detail ? (
                <Text
                  numberOfLines={1}
                  className="mt-0.5 text-xs"
                  style={{ color: colors.textMuted }}
                >
                  {detail}
                </Text>
              ) : null}
            </View>
            <Feather name="chevron-up" size={17} color={colors.textMuted} />
          </View>
          {activity?.state === "running" ? (
            <View style={{ height: 3, backgroundColor: colors.border }}>
              <View
                style={{
                  height: 3,
                  width: determinate ? `${Math.max(4, progress * 100)}%` : "28%",
                  backgroundColor: colors.accent,
                }}
              />
            </View>
          ) : null}
        </Pressable>
      </View>
      <AppErrorDialog
        title={title}
        message={detailsVisible ? (detail ?? title) : null}
        onClose={dismiss}
      />
    </>
  );
}
