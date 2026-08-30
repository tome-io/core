import { Feather } from "@expo/vector-icons";
import { usePathname } from "expo-router";
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

const STATUS_BADGE_WIDTH = 160;
const STATUS_BADGE_HEIGHT = 40;

function conciseStatus(
  state: "running" | "success" | "error" | undefined,
  title: string,
  detail: string | undefined,
): string {
  const value = `${title} ${detail ?? ""}`.toLowerCase();
  if (state === "error") return "Needs attention";
  if (value.includes("remov")) {
    return state === "success" ? "Book removed" : "Removing book";
  }
  if (state === "success") return "Up to date";
  if (value.includes("index") || value.includes("scann")) return "Scanning files";
  if (value.includes("reader add-on")) return "Checking reader";
  if (value.includes("upload")) return "Uploading";
  if (value.includes("updating this device") || value.includes("apply")) {
    return "Applying";
  }
  if (
    value.includes("cover") ||
    value.includes("metadata") ||
    value.includes("book details")
  ) {
    return "Updating details";
  }
  if (value.includes("sync") || value.includes("checking")) return "Checking sync";
  return "Updating";
}

export function LibraryActivityToast() {
  const pathname = usePathname();
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
  const status = conciseStatus(
    activity?.state ?? (fallbackMessage ? "error" : undefined),
    title,
    detail,
  );

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
  return (
    <>
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          right: compact ? 12 : 24,
          bottom: compact && !pathname.startsWith("/book/") ? 108 : 32,
          left: compact ? 12 : undefined,
          alignItems: compact ? "center" : undefined,
          zIndex: 50,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${detail ?? ""}`}
          onPress={() => setDetailsVisible(true)}
          style={({ pressed }) => ({
            width: STATUS_BADGE_WIDTH,
            height: STATUS_BADGE_HEIGHT,
            justifyContent: "center",
            borderRadius: radii.pill,
            opacity: pressed ? 0.9 : 1,
            shadowColor: "#000",
            shadowOpacity: 0.35,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 10,
          })}
        >
          <View
            style={{
              width: STATUS_BADGE_WIDTH,
              height: STATUS_BADGE_HEIGHT,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              paddingHorizontal: 10,
              borderRadius: radii.pill,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surfaceRaised,
            }}
          >
            {activity?.state === "running" ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Feather
                name={activity?.state === "success" ? "check-circle" : "alert-circle"}
                size={18}
                color={colors.text}
              />
            )}
            <Text
              numberOfLines={1}
              className="text-[13px] font-medium"
              style={{ color: colors.text }}
            >
              {status}
            </Text>
          </View>
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
