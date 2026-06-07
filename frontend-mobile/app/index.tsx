import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { getItem } from '@/lib/storage'
import { View, ActivityIndicator } from 'react-native'

export default function Index() {
  const router = useRouter()
  useEffect(() => {
    getItem('accessToken').then(token => {
      if (token) router.replace('/(app)/main')
      else router.replace('/(auth)/login')
    })
  }, [])
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#080810' }}>
      <ActivityIndicator color="#7c6cf8" size="large" />
    </View>
  )
}
