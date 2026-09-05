import { Stack } from 'expo-router';
import { View } from 'react-native';
import ExtensionsScreen from '@/components/extensions-screen';

export default function SetupExtensionsScreen() {
  return <View style={{ flex: 1, paddingTop: 16 }}>
    <Stack.Screen options={{ headerShown: true, title: 'Add-ons', headerBackTitle: 'Setup' }} />
    <ExtensionsScreen />
  </View>;
}
