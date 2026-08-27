import { Feather } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

export function DismissibleToast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 10000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <View
      className="absolute bottom-6 right-6 z-50 flex-row items-start gap-3 rounded-xl border border-amber-900/70 px-4 py-3"
      style={{ backgroundColor: '#201a12', width: '80%', maxWidth: 520 }}
      accessibilityLiveRegion="polite"
    >
      <Feather name="alert-triangle" size={16} color="#fbbf24" />
      <Text numberOfLines={3} className="flex-1 text-xs leading-4 text-amber-100">
        {message}
      </Text>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification"
        hitSlop={10}
        className="active:opacity-60"
      >
        <Feather name="x" size={17} color="#d4d4d8" />
      </Pressable>
    </View>
  );
}
