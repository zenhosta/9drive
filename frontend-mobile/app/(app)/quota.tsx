import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, Alert, RefreshControl } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { apiFetch, formatBytes } from '@/lib/api'

type StorageSummary = {
  totalLimit: number
  totalUsed: number
  totalFree: number
  accounts: {
    id: string
    email: string
    quotaLimit: number
    quotaUsed: number
    freeSpace: number
  }[]
}

export default function QuotaPage() {
  const [data, setData] = useState<StorageSummary | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchQuota() {
    setLoading(true)
    try {
      const res = await apiFetch<StorageSummary>('/storage/summary')
      setData(res)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchQuota() }, [])

  function usagePercent(used: number, limit: number) {
    if (!limit) return 0
    return Math.min((used / limit) * 100, 100)
  }

  function barColor(percent: number) {
    if (percent > 85) return '#ef4444'
    if (percent > 60) return '#f59e0b'
    return '#6366f1'
  }

  return (
    <ScrollView
      style={s.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchQuota} tintColor="#6366f1" />}
    >
      <Text style={s.title}>Quota</Text>

      {data && (
        <>
          <View style={s.card}>
            <Text style={s.cardLabel}>Total Storage</Text>
            <Text style={s.cardValue}>{formatBytes(data.totalFree)} <Text style={s.cardSub}>tersisa</Text></Text>
            <View style={s.barBg}>
              <View style={[s.barFill, {
                width: `${usagePercent(data.totalUsed, data.totalLimit)}%` as any,
                backgroundColor: barColor(usagePercent(data.totalUsed, data.totalLimit))
              }]} />
            </View>
            <Text style={s.barMeta}>{formatBytes(data.totalUsed)} dipakai dari {formatBytes(data.totalLimit)}</Text>
          </View>

          <Text style={s.sectionTitle}>Per Akun</Text>

          {data.accounts.map(acc => {
            const pct = usagePercent(acc.quotaUsed, acc.quotaLimit)
            return (
              <View key={acc.id} style={s.accountCard}>
                <View style={s.accountHeader}>
                  <View style={s.accountIcon}>
                    <Ionicons name="logo-google" size={18} color="#6366f1" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.accountEmail} numberOfLines={1}>{acc.email}</Text>
                    <Text style={s.accountMeta}>{formatBytes(acc.freeSpace)} tersisa</Text>
                  </View>
                  <Text style={s.accountPct}>{pct.toFixed(0)}%</Text>
                </View>
                <View style={s.barBg}>
                  <View style={[s.barFill, { width: `${pct}%` as any, backgroundColor: barColor(pct) }]} />
                </View>
                <Text style={s.barMeta}>{formatBytes(acc.quotaUsed)} / {formatBytes(acc.quotaLimit)}</Text>
              </View>
            )
          })}
        </>
      )}
    </ScrollView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f', paddingTop: 52 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', paddingHorizontal: 20, marginBottom: 20 },
  card: { backgroundColor: '#1a1a1a', borderRadius: 14, padding: 20, marginHorizontal: 20, marginBottom: 24, borderWidth: 1, borderColor: '#2a2a2a' },
  cardLabel: { color: '#666', fontSize: 13, marginBottom: 4 },
  cardValue: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 12 },
  cardSub: { color: '#666', fontSize: 16, fontWeight: '400' },
  barBg: { height: 8, backgroundColor: '#2a2a2a', borderRadius: 4, marginBottom: 8, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  barMeta: { color: '#555', fontSize: 12 },
  sectionTitle: { color: '#666', fontSize: 13, fontWeight: '600', paddingHorizontal: 20, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },
  accountCard: { backgroundColor: '#1a1a1a', borderRadius: 14, padding: 16, marginHorizontal: 20, marginBottom: 12, borderWidth: 1, borderColor: '#2a2a2a' },
  accountHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  accountIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#0f0f0f', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  accountEmail: { color: '#fff', fontSize: 14, fontWeight: '500' },
  accountMeta: { color: '#555', fontSize: 12, marginTop: 2 },
  accountPct: { color: '#666', fontSize: 13 },
})
