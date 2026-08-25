import { Text, View } from 'react-native';

import { colors } from '@/components/app-ui';

export function RatingChip({ rating }: { rating?: number }) {
  if (!rating) return null;

  return (
    <View
      pointerEvents="none"
      className="absolute top-0 right-0 h-6 px-2 items-center justify-center rounded-bl-lg"
      style={{ backgroundColor: 'rgba(10, 10, 14, 0.88)' }}
    >
      <Text className="text-[10px] font-semibold" style={{ color: colors.rating }}>
        ★ {rating.toFixed(1)}
      </Text>
    </View>
  );
}
