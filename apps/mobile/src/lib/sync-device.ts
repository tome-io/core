import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = 'reader_progress_device_id_v1';

function createDeviceId(): string {
  const random = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random()}-${random()}`;
}

export async function getSyncDeviceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;
  const deviceId = createDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}
