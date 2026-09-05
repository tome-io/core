// Metro inlines this flag only for the dedicated onboarding development command.
// Completion and step changes stay in memory so previews do not reset real setup.
export const onboardingPreview = __DEV__ && process.env.EXPO_PUBLIC_ONBOARDING_PREVIEW === '1';
