import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, StyleSheet, Text, useAnimatedValue, View, useWindowDimensions } from 'react-native';
import { colors } from '@/components/app-ui';

const COVERS = [
  require('../../assets/images/onboarding/pride-and-prejudice.jpg'),
  require('../../assets/images/onboarding/frankenstein.jpg'),
  require('../../assets/images/onboarding/the-secret-garden.jpg'),
  require('../../assets/images/onboarding/dracula.jpg'),
  require('../../assets/images/onboarding/the-time-machine.jpg'),
  require('../../assets/images/onboarding/the-great-gatsby.jpg'),
  require('../../assets/images/onboarding/little-women.jpg'),
  require('../../assets/images/onboarding/moby-dick.jpg'),
  require('../../assets/images/onboarding/alice.jpg'),
];

export function useOnboardingMotion() {
  const [reduced, setReduced] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    const app = AppState.addEventListener('change', (value) => setActive(value === 'active'));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);
  return !reduced && active && focused;
}

function CoverColumn({ column, width, animate, viewportHeight }: { column: number; width: number; animate: boolean; viewportHeight: number }) {
  const progress = useAnimatedValue(0);
  const height = width * 1.5;
  const stride = (height + 12) * 3;
  useEffect(() => {
    progress.setValue(0);
    if (!animate) return;
    const loop = Animated.loop(Animated.timing(progress, {
      toValue: 1, duration: 32000 + column * 6500, easing: Easing.linear, useNativeDriver: true,
      isInteraction: false,
    }));
    loop.start();
    return () => loop.stop();
  }, [animate, column, progress]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: column % 2 ? [-stride, 0] : [0, -stride] });
  return <Animated.View style={{ width, gap: 12, marginTop: -column * 35, transform: [{ translateY }] }}>
    {Array.from({ length: Math.ceil((viewportHeight + stride + column * 35) / (height + 12) / 3) * 3 }, (_, index) => <Image key={index} source={COVERS[(column * 2 + index % 3) % COVERS.length]}
      contentFit="cover" style={{ width, height, borderRadius: 10, backgroundColor: colors.surfaceRaised }} />)}
  </Animated.View>;
}

export function WelcomeArtwork() {
  const { width, height } = useWindowDimensions();
  const animate = useOnboardingMotion();
  const columnWidth = Math.min(140, Math.max(90, (width - 24) / 4));
  const wallHeight = height * 0.88 + 40;
  // Rotate a viewport-sized wall, not the much taller repeating column content.
  // Overscan covers the corners exposed by rotation at every screen size.
  const overscan = Math.ceil(Math.max(width, wallHeight) * Math.sin(7 * Math.PI / 180)) + 48;
  const wallWidth = width + overscan * 2;
  const columnCount = Math.ceil(wallWidth / (columnWidth + 12)) + 1;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    <View style={{ position: 'absolute', top: -40, left: 0, right: 0, bottom: '12%', overflow: 'hidden', alignItems: 'center' }}>
      <View style={{ position: 'absolute', top: -overscan, left: -overscan, width: wallWidth, height: wallHeight + overscan * 2,
        flexDirection: 'row', justifyContent: 'center', gap: 12, transform: [{ rotate: '-7deg' }] }}>
        {Array.from({ length: columnCount }, (_, column) => <CoverColumn key={column} column={column} width={columnWidth} animate={animate} viewportHeight={wallHeight + overscan * 2} />)}
      </View>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(16, 11, 8, 0.24)' }]} />
      <View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: `linear-gradient(to bottom, rgba(16, 11, 8, 0.1) 0%, rgba(16, 11, 8, 0.12) 38%, rgba(16, 11, 8, 0.68) 68%, ${colors.background} 100%)` }]} />
    </View>
  </View>;
}

export function OnboardingBrand() {
  return <View style={{ alignItems: 'center', gap: 16 }}>
    <Image source={require('../../assets/images/icon.png')} style={{ width: 96, height: 96, borderRadius: 25, borderWidth: 1, borderColor: 'rgba(255, 242, 207, 0.25)' }} />
    <Text style={{ color: colors.text, fontSize: 42, fontWeight: '700', letterSpacing: -1.5, textShadowColor: '#100b08', textShadowRadius: 24, textShadowOffset: { width: 0, height: 2 } }}>Tomeio</Text>
  </View>;
}

export function StepArtwork({ step }: { step: number }) {
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ height: 158, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
    <View style={{ position: 'absolute', width: 210, height: 140, borderRadius: 100,
      experimental_backgroundImage: `radial-gradient(ellipse at center, ${colors.accentMuted} 0%, ${colors.background} 72%)` }} />
    {step === 1 ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {[0, 2, 5].map((cover, index) => <Image key={cover} source={COVERS[cover]} style={{ width: index === 1 ? 84 : 70, height: index === 1 ? 126 : 105, borderRadius: 8,
        transform: [{ rotate: `${(index - 1) * 12}deg` }, { translateY: index === 1 ? -5 : 8 }] }} />)}
    </View> : step === 2 ? <View style={{ width: 168, height: 130, justifyContent: 'flex-end', transform: [{ rotate: '-4deg' }] }}>
      <View style={{ position: 'absolute', top: 24, left: 0, width: 66, height: 28, backgroundColor: '#965028', borderTopLeftRadius: 10, borderTopRightRadius: 10 }} />
      <View style={{ position: 'absolute', top: 40, bottom: 0, width: 168, backgroundColor: '#965028', borderRadius: 12 }} />
      <Image source={COVERS[2]} style={{ position: 'absolute', top: 8, left: 17, width: 56, height: 84, borderRadius: 5, transform: [{ rotate: '-10deg' }] }} />
      <Image source={COVERS[5]} style={{ position: 'absolute', top: 0, left: 57, width: 56, height: 84, borderRadius: 5 }} />
      <Image source={COVERS[0]} style={{ position: 'absolute', top: 10, right: 10, width: 56, height: 84, borderRadius: 5, transform: [{ rotate: '12deg' }] }} />
      <View style={{ height: 66, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#bb692f',
        experimental_backgroundImage: 'linear-gradient(to bottom, #e8954d 0%, #bb692f 100%)',
        borderWidth: 1, borderColor: '#f1b17b', boxShadow: '0px 8px 20px rgba(0, 0, 0, 0.25)' }}>
        <Feather name="book-open" size={23} color={colors.text} />
      </View>
    </View> : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 17 }}>
      <View style={[styles.device, { width: 71, height: 116, transform: [{ rotate: '-8deg' }] }]}>
        <Image source={COVERS[0]} style={{ width: 51, height: 77, borderRadius: 4 }} />
        <View style={styles.progress}><View style={styles.progressFill} /></View>
      </View>
      <Feather name="refresh-cw" size={23} color={colors.accent} />
      <View style={[styles.device, { width: 97, height: 135, transform: [{ rotate: '8deg' }] }]}>
        <Image source={COVERS[0]} style={{ width: 63, height: 94, borderRadius: 4 }} />
        <View style={styles.progress}><View style={styles.progressFill} /></View>
      </View>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  device: { borderRadius: 15, borderWidth: 2, borderColor: '#70523b', backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', gap: 9 },
  progress: { height: 3, width: '65%', borderRadius: 2, backgroundColor: colors.border },
  progressFill: { width: '62%', height: 3, borderRadius: 2, backgroundColor: colors.accent },
});
