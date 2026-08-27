import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/components/app-ui';

export function RatingChip({ rating }: { rating?: number }) {
  if (!rating) return null;

  return (
    <View pointerEvents="none" style={styles.container}>
      <Text style={styles.text}>★ {rating.toFixed(1)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(10, 10, 14, 0.88)',
  },
  text: {
    color: colors.rating,
    fontSize: 9,
    fontWeight: '700',
  },
});
