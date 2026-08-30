import { StyleSheet, Text, View } from 'react-native';

const HARDCOVER_BRAND = '#5b4be1';

export function SeriesPositionChip({ position }: { position?: number }) {
  if (position == null || !Number.isFinite(position) || position <= 0) return null;
  const rounded = Math.round(position * 100) / 100;

  return (
    <View pointerEvents="none" style={styles.container}>
      <Text style={styles.text}>#{rounded}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    minWidth: 25,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: HARDCOVER_BRAND,
  },
  text: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
  },
});
