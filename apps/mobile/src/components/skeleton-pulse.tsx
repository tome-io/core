import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

export function SkeletonPulse({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const reduceMotion = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(reduceMotion ? 0.72 : 0.48));

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.72);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.88,
          duration: 850,
          isInteraction: false,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.48,
          duration: 850,
          isInteraction: false,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion]);

  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}
