import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import * as SecureStore from 'expo-secure-store'

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  )
}
