import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, RefreshControl, Linking } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { apiFetch, formatBytes, clearSession } from '@/lib/api'

type Account = {
  id: string
  email: string
  provider: string
  quotaLimit: number
  quotaUsed: number
  freeSpace: number
}

type Me = {
  id: string
  name: string
  email: string
}

export default function SettingsPage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  async function fetchData() {
    setLoading(true)
    try {
      const [meData, accountsData] = await Promise.all([
        apiFetch<Me>('/auth/me'),
        apiFetch<Account[]>('/connected-accounts'),
      ])
      setMe(meData)
      setAccounts(accountsData)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setLoading(false)
    }
  }

  async function connectDrive() {
    try {
      const data = await apiFetch<{ url: string }>('/connected-accounts/google/connect-url')
      Linking.openURL(data.url)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    }
  }

  async function disconnectAccount(id: string, email: string) {
    Alert.alert('Disconnect', `Disconnect "${email}"?`, [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          try {
            await apiFetch(`/connected-accounts/${id}`, { method: 'DELETE' })
            setAccounts(prev => prev.filter(a => a.id !== id))
          } catch (e: any) {
            Alert.alert('Error', e.message)
          }
        }
      }
    ])
  }

  async function logout() {
    Alert.alert('Logout', 'Yakin mau logout?', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Logout', style: 'destructive', onPress: async () => {
          await clearSession()
          router.replace('/(auth)/login')
        }
      }
    ])
  }

  useEffect(() => { fetchData() }, [])

  return (
    <ScrollView
      style={s.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchData} tintColor="#6366f1" />}
    >
      <Text style={s.title}>Settings</Text>

      {me && (
        <View style={s.card}>
          <View style={s.userIcon}>
            <Text style={s.userInitial}>{me.name[0].toUpperCase()}</Text>
          </View>
          <Text style={s.userName}>{me.name}</Text>
          <Text style={s.userEmail}>{me.email}</Text>
        </View>
      )}

      <Text style={s.sectionTitle}>Google Drive</Text>

      {accounts.map(acc => (
        <View key={acc.id} style={s.accountCard}>
          <View style={s.accountRow}>
            <View style={s.accountIcon}>
              <Ionicons name="logo-google" size={18} color="#6366f1" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.accountEmail} numberOfLines={1}>{acc.email}</Text>
              <Text style={s.accountMeta}>{formatBytes(acc.freeSpace)} tersisa dari {formatBytes(acc.quotaLimit)}</Text>
            </View>
            <TouchableOpacity onPress={() => disconnectAccount(acc.id, acc.email)}>
              <Ionicons name="unlink-outline" size={20} color="#e55" />
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <TouchableOpacity style={s.connectBtn} onPress={connectDrive}>
        <Ionicons name="add-circle-outline" size={20} color="#6366f1" />
        <Text style={s.connectBtnText}>Connect Google Drive</Text>
      </TouchableOpacity>

      <View style={{ height: 24 }} />

      <TouchableOpacity style={s.logoutBtn} onPress={logout}>
        <Ionicons name="log-out-outline" size={20} color="#e55" />
        <Text style={s.logoutText}>Logout</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f', paddingTop: 52 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', paddingHorizontal: 20, marginBottom: 20 },
  card: { backgroundColor: '#1a1a1a', borderRadius: 14, padding: 20, marginHorizontal: 20, marginBottom: 24, alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a' },
  userIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#6366f1', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  userInitial: { color: '#fff', fontSize: 28, fontWeight: '700' },
  userName: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 4 },
  userEmail: { color: '#666', fontSize: 14 },
  sectionTitle: { color: '#666', fontSize: 13, fontWeight: '600', paddingHorizontal: 20, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },
  accountCard: { backgroundColor: '#1a1a1a', borderRadius: 14, padding: 16, marginHorizontal: 20, marginBottom: 10, borderWidth: 1, borderColor: '#2a2a2a' },
  accountRow: { flexDirection: 'row', alignItems: 'center' },
  accountIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#0f0f0f', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  accountEmail: { color: '#fff', fontSize: 14, fontWeight: '500' },
  accountMeta: { color: '#555', fontSize: 12, marginTop: 2 },
  connectBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#6366f1', borderStyle: 'dashed' },
  connectBtnText: { color: '#6366f1', fontSize: 15, fontWeight: '500' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, padding: 16, borderRadius: 14, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  logoutText: { color: '#e55', fontSize: 15, fontWeight: '500' },
})
