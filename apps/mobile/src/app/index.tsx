import { onboardingPreview } from '@/lib/onboarding-preview';
import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useSettings } from '@/context/settings-context';

export default function IndexScreen() {
  const { settings, ready } = useSettings();
  if (!ready) return <ActivityIndicator accessibilityLabel="Loading your setup" />;
  return <Redirect href={!onboardingPreview && settings.onboardingCompleted ? '/home' : '/onboarding'} />;
}
