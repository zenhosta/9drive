import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(key)
  return SecureStore.getItemAsync(key)
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') { localStorage.setItem(key, value); return }
  await SecureStore.setItemAsync(key, value)
}

export async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') { localStorage.removeItem(key); return }
  await SecureStore.deleteItemAsync(key)
}
