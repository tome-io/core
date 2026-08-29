import { Text, View } from "react-native";

import { AppDialog, colors, PillButton } from "./app-ui";

export function AppErrorDialog({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string | null;
  onClose: () => void;
}) {
  return (
    <AppDialog visible={message != null} title={title} onClose={onClose}>
      <View className="gap-5">
        <Text className="text-sm leading-6" style={{ color: colors.textMuted }}>
          {message}
        </Text>
        <PillButton label="Dismiss" variant="accent" onPress={onClose} />
      </View>
    </AppDialog>
  );
}
