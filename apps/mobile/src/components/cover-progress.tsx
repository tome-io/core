import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/components/app-ui';

export function CoverProgress({
  progress,
  isRead = false,
}: {
  progress?: number;
  isRead?: boolean;
}) {
  const normalizedProgress = isRead
    ? 100
    : typeof progress === 'number'
      ? Math.max(0, Math.min(100, progress))
      : 0;

  if (normalizedProgress <= 0) return null;

  return (
    <>
      <View pointerEvents="none" style={styles.track}>
        <View
          style={{
            height: '100%',
            width: `${normalizedProgress}%`,
            backgroundColor: colors.accent,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.badge,
          { backgroundColor: isRead ? colors.success : colors.accentMuted },
        ]}
      >
        <Text style={styles.text}>
          {isRead ? 'Read' : `${Math.max(1, Math.round(normalizedProgress))}%`}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: 6,
    overflow: 'hidden',
    borderBottomRightRadius: 8,
    borderBottomLeftRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  badge: {
    position: 'absolute',
    bottom: 12,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },
  text: {
    color: colors.text,
    fontSize: 9,
    fontWeight: '700',
  },
});
