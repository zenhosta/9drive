import { useEffect, useState, useRef } from 'react'
import {
  View, Text, ScrollView, FlatList, TouchableOpacity,
  StyleSheet, Alert, RefreshControl, TextInput, Platform,
  Modal, Animated, Dimensions, StatusBar, Linking,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import { useRouter } from 'expo-router'
import { apiFetch, formatBytes, API_URL, clearSession } from '@/lib/api'
import { getItem } from '@/lib/storage'

const { width: SW, height: SH } = Dimensions.get('window')

// ─── Types ────────────────────────────────────────────────────────────────────

type DriveFile = {
  id: string; name: string; mimeType: string
  sizeBytes: string; createdAt: string; folderId: string | null
  connectedAccount: { email: string; provider: string } | null
}
type StorageSummary = {
  totalLimit: number; totalUsed: number; totalFree: number
  accounts: { id: string; email: string; quotaLimit: number; quotaUsed: number; freeSpace: number }[]
}
type Me = { id: string; name: string; email: string }
type ConnectedAccount = {
  id: string; email: string; provider: string
  quotaLimit: number; quotaUsed: number; freeSpace: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function usagePercent(used: number, limit: number) {
  if (!limit) return 0
  return Math.min((used / limit) * 100, 100)
}

function getFileIcon(mimeType: string): { name: any; color: string } {
  if (mimeType.startsWith('image/'))  return { name: 'image',          color: '#f472b6' }
  if (mimeType.startsWith('video/'))  return { name: 'videocam',       color: '#34d399' }
  if (mimeType.startsWith('audio/'))  return { name: 'musical-notes',  color: '#fb923c' }
  if (mimeType.includes('pdf'))       return { name: 'document-text',  color: '#f87171' }
  if (mimeType.includes('zip') || mimeType.includes('rar'))
                                      return { name: 'archive',        color: '#fbbf24' }
  if (mimeType.includes('sheet') || mimeType.includes('excel'))
                                      return { name: 'grid',           color: '#4ade80' }
  if (mimeType.includes('doc'))       return { name: 'document',       color: '#60a5fa' }
  return                                     { name: 'document',       color: '#94a3b8' }
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)   return 'baru saja'
  if (m < 60)  return `${m}m lalu`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}j lalu`
  return `${Math.floor(h / 24)}h lalu`
}

// ─── Skeleton Hero Card ───────────────────────────────────────────────────────

function SkeletonHeroCard() {
  const shimmer = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    ).start()
  }, [])
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] })
  return (
    <Animated.View style={[sk.card, { opacity }]}>
      <View style={sk.line} />
      <View style={[sk.line, { width: '55%', height: 36, marginBottom: 10 }]} />
      <View style={[sk.line, { width: '40%', height: 12 }]} />
      <View style={[sk.bar, { marginTop: 20 }]} />
      <View style={[sk.line, { width: '60%', height: 10, marginTop: 10 }]} />
    </Animated.View>
  )
}

const sk = StyleSheet.create({
  card: {
    marginHorizontal: 20, marginBottom: 20, borderRadius: 20,
    backgroundColor: '#1a1a2e', padding: 22,
  },
  line: { height: 14, backgroundColor: '#2a2a4a', borderRadius: 7, marginBottom: 8, width: '70%' },
  bar:  { height: 6,  backgroundColor: '#2a2a4a', borderRadius: 3 },
})

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MainScreen() {
  const router = useRouter()
  const [mode, setMode] = useState<'home' | 'files' | 'settings'>('home')

  // shared data
  const [me, setMe]           = useState<Me | null>(null)
  const [quota, setQuota]     = useState<StorageSummary | null>(null)
  const [files, setFiles]     = useState<DriveFile[]>([])
  const [loadingHome, setLoadingHome] = useState(true)
  const [loadingFiles, setLoadingFiles] = useState(true)

  // settings state
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([])
  const [loadingSettings, setLoadingSettings] = useState(false)

  // files state
  const [search, setSearch]   = useState('')
  const [uploading, setUploading] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')

  // rename modal
  const [renameModal, setRenameModal]   = useState(false)
  const [renameTarget, setRenameTarget] = useState<DriveFile | null>(null)
  const [renameValue, setRenameValue]   = useState('')
  const [renaming, setRenaming]         = useState(false)

  // FAB animation
  const fabScale  = useRef(new Animated.Value(1)).current
  const slideAnim = useRef(new Animated.Value(0)).current

  useEffect(() => { fetchHome(); fetchFiles() }, [])

  // debounced search
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleSearchChange(text: string) {
    setSearch(text)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => fetchFiles(text), 400)
  }

  async function fetchSettings() {
    setLoadingSettings(true)
    try {
      const [meData, accountsData] = await Promise.all([
        apiFetch<Me>('/auth/me'),
        apiFetch<ConnectedAccount[]>('/connected-accounts'),
      ])
      setMe(meData)
      setConnectedAccounts(accountsData)
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setLoadingSettings(false) }
  }

  async function connectDrive() {
    try {
      const data = await apiFetch<{ url: string }>('/connected-accounts/google/connect-url')
      await Linking.openURL(data.url)
    } catch (e: any) { Alert.alert('Error', e.message) }
  }

  async function disconnectAccount(id: string, email: string) {
    Alert.alert('Disconnect', `Disconnect "${email}"?`, [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          try {
            await apiFetch(`/connected-accounts/${id}`, { method: 'DELETE' })
            setConnectedAccounts(prev => prev.filter(a => a.id !== id))
          } catch (e: any) { Alert.alert('Error', e.message) }
        }
      }
    ])
  }

  async function fetchHome() {
    setLoadingHome(true)
    try {
      const [meData, quotaData] = await Promise.all([
        apiFetch<Me>('/auth/me'),
        apiFetch<StorageSummary>('/storage/summary'),
      ])
      setMe(meData); setQuota(quotaData)
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setLoadingHome(false) }
  }

  async function fetchFiles(q?: string) {
    setLoadingFiles(true)
    try {
      const url = q ? `/files?q=${encodeURIComponent(q)}` : '/files'
      const data = await apiFetch<DriveFile[]>(url)
      setFiles(data)
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setLoadingFiles(false) }
  }

  function switchMode(next: 'home' | 'files' | 'settings') {
    Animated.sequence([
      Animated.timing(fabScale, { toValue: 0.85, duration: 100, useNativeDriver: true }),
      Animated.timing(fabScale, { toValue: 1,    duration: 150, useNativeDriver: true }),
    ]).start()
    if (next === 'settings') fetchSettings()
    setMode(next)
  }

  async function pickAndUpload() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
      if (result.canceled || !result.assets?.length) return
      const file = result.assets[0]
      setUploading(true)
      const token = await getItem('accessToken')
      const form = new FormData()
      if (Platform.OS === 'web') {
        const res = await fetch(file.uri); const blob = await res.blob()
        form.append('file', blob, file.name)
      } else {
        form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as any)
      }
      form.append('fileName', file.name)
      form.append('sizeBytes', String(file.size ?? 0))
      form.append('mimeType', file.mimeType ?? 'application/octet-stream')
      const uploadRes = await fetch(`${API_URL}/files`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      })
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ detail: 'Upload gagal' }))
        throw new Error(err.detail)
      }
      Alert.alert('Sukses', 'File berhasil diupload')
      fetchFiles()
    } catch (e: any) { Alert.alert('Upload gagal', e.message) }
    finally { setUploading(false) }
  }

  async function deleteFile(id: string, name: string) {
    const doDelete = async () => {
      try {
        await apiFetch(`/files/${id}`, { method: 'DELETE' })
        setFiles(prev => prev.filter(f => f.id !== id))
      } catch (e: any) { Alert.alert('Error', e.message) }
    }
    if (Platform.OS === 'web') {
      if (window.confirm(`Hapus "${name}"?`)) await doDelete()
    } else {
      Alert.alert('Hapus', `Hapus "${name}"?`, [
        { text: 'Batal', style: 'cancel' },
        { text: 'Hapus', style: 'destructive', onPress: doDelete },
      ])
    }
  }

  function openRename(file: DriveFile) {
    setRenameTarget(file); setRenameValue(file.name); setRenameModal(true)
  }

  async function submitRename() {
    if (!renameTarget || !renameValue.trim()) return
    setRenaming(true)
    try {
      const updated = await apiFetch<{ id: string; name: string }>(`/files/${renameTarget.id}`, {
        method: 'PATCH', body: JSON.stringify({ name: renameValue.trim() }),
      })
      setFiles(prev => prev.map(f => f.id === updated.id ? { ...f, name: updated.name } : f))
      setRenameModal(false)
    } catch (e: any) { Alert.alert('Error', e.message) }
    finally { setRenaming(false) }
  }

  async function previewFile(file: DriveFile) {
    const token = await getItem('accessToken')
    const url = `${API_URL}/files/${file.id}/download`
    if (Platform.OS === 'web') {
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error('Gagal memuat file')
        const blob = await res.blob()
        const blobUrl = URL.createObjectURL(blob)
        window.open(blobUrl, '_blank')
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
      } catch (e: any) { Alert.alert('Preview gagal', e.message) }
    } else {
      Alert.alert('Preview', `File: ${file.name}\n\nBuka di browser untuk preview.`, [{ text: 'OK' }])
    }
  }

  async function logout() {
    const doLogout = async () => { await clearSession(); router.replace('/(auth)/login') }
    if (Platform.OS === 'web') {
      if (window.confirm('Logout?')) await doLogout()
    } else {
      Alert.alert('Logout', 'Yakin mau logout?', [
        { text: 'Batal', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: doLogout },
      ])
    }
  }

  // ── Render mode Home ────────────────────────────────────────────────────────

  function renderHome() {
    const pct = quota ? usagePercent(quota.totalUsed, quota.totalLimit) : 0
    const barColor = pct > 85 ? '#f87171' : pct > 60 ? '#fbbf24' : '#7c6cf8'

    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loadingHome} onRefresh={fetchHome} tintColor="#7c6cf8" />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Top bar ── */}
        <View style={h.topBar}>
          <View>
            <Text style={h.greeting}>Selamat datang,</Text>
            <Text style={h.userName}>{me?.name ?? '—'}</Text>
          </View>
          <TouchableOpacity onPress={() => switchMode('settings')} style={h.avatarBtn}>
            <Text style={h.avatarLetter}>{me?.name?.[0]?.toUpperCase() ?? '?'}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Storage hero card ── */}
        {loadingHome && !quota && (
          <SkeletonHeroCard />
        )}
        {!loadingHome && quota && (
          <View style={h.heroCard}>
            <View style={h.heroInner}>
              <View style={{ flex: 1 }}>
                <Text style={h.heroLabel}>Total Storage</Text>
                <Text style={h.heroFree}>{formatBytes(quota.totalFree)}</Text>
                <Text style={h.heroSub}>tersisa dari {formatBytes(quota.totalLimit)}</Text>
              </View>
              {/* Donut visual */}
              <View style={h.donutWrap}>
                <View style={h.donutOuter}>
                  <View style={h.donutInner}>
                    <Text style={h.donutPct}>{pct.toFixed(0)}<Text style={h.donutSymbol}>%</Text></Text>
                    <Text style={h.donutUsed}>pakai</Text>
                  </View>
                </View>
              </View>
            </View>
            {/* Bar */}
            <View style={h.bar}>
              <View style={[h.barFill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
            </View>
            <Text style={h.barMeta}>
              {formatBytes(quota.totalUsed)} dipakai · {quota.accounts.length} akun terhubung
            </Text>
          </View>
        )}

        {/* ── Metric strip ── */}
        <View style={h.metricRow}>
          <View style={h.metricCard}>
            <Ionicons name="documents-outline" size={22} color="#7c6cf8" />
            <Text style={h.metricVal}>{files.length}</Text>
            <Text style={h.metricLbl}>File</Text>
          </View>
          <View style={h.metricCard}>
            <Ionicons name="cloud-outline" size={22} color="#34d399" />
            <Text style={[h.metricVal, { color: '#34d399' }]}>
              {quota ? quota.accounts.length : '—'}
            </Text>
            <Text style={h.metricLbl}>Akun Drive</Text>
          </View>
          <View style={h.metricCard}>
            <Ionicons name="save-outline" size={22} color="#fbbf24" />
            <Text style={[h.metricVal, { color: '#fbbf24' }]}>
              {quota ? formatBytes(quota.totalUsed) : '—'}
            </Text>
            <Text style={h.metricLbl}>Terpakai</Text>
          </View>
        </View>

        {/* ── Per-account cards ── */}
        {quota && quota.accounts.length > 0 && (
          <>
            <Text style={h.sectionTitle}>Akun Terhubung</Text>
            {quota.accounts.map(acc => {
              const p = usagePercent(acc.quotaUsed, acc.quotaLimit)
              const c = p > 85 ? '#f87171' : p > 60 ? '#fbbf24' : '#7c6cf8'
              return (
                <View key={acc.id} style={h.accCard}>
                  <View style={h.accRow}>
                    <View style={h.accIcon}>
                      <Ionicons name="logo-google" size={16} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={h.accEmail} numberOfLines={1}>{acc.email}</Text>
                      <Text style={h.accMeta}>{formatBytes(acc.freeSpace)} tersisa</Text>
                    </View>
                    <Text style={[h.accPct, { color: c }]}>{p.toFixed(0)}%</Text>
                  </View>
                  <View style={h.bar}>
                    <View style={[h.barFill, { width: `${p}%` as any, backgroundColor: c }]} />
                  </View>
                  <Text style={h.barMeta}>{formatBytes(acc.quotaUsed)} / {formatBytes(acc.quotaLimit)}</Text>
                </View>
              )
            })}
          </>
        )}

        {/* ── Recent files ── */}
        {files.length > 0 && (
          <>
            <Text style={h.sectionTitle}>File Terbaru</Text>
            {files.slice(0, 5).map(f => {
              const ic = getFileIcon(f.mimeType)
              return (
                <View key={f.id} style={h.recentRow}>
                  <View style={[h.recentIcon, { backgroundColor: ic.color + '20' }]}>
                    <Ionicons name={ic.name} size={18} color={ic.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={h.recentName} numberOfLines={1}>{f.name}</Text>
                    <Text style={h.recentMeta}>{formatBytes(Number(f.sizeBytes))} · {timeAgo(f.createdAt)}</Text>
                  </View>
                </View>
              )
            })}
          </>
        )}
      </ScrollView>
    )
  }

  // ── Render mode Files ────────────────────────────────────────────────────────

  function renderFiles() {
    return (
      <View style={{ flex: 1 }}>
        {/* Files header */}
        <View style={f.header}>
          <View style={{ flex: 1 }}>
            <Text style={f.title}>Files</Text>
            <Text style={f.subtitle}>{files.length} item</Text>
          </View>
          <View style={f.headerActions}>
            <TouchableOpacity
              style={[f.iconBtn, viewMode === 'grid' && f.iconBtnActive]}
              onPress={() => setViewMode(v => v === 'list' ? 'grid' : 'list')}
            >
              <Ionicons name={viewMode === 'list' ? 'grid-outline' : 'list-outline'} size={18} color={viewMode === 'grid' ? '#7c6cf8' : '#888'} />
            </TouchableOpacity>
            <TouchableOpacity style={f.uploadBtn} onPress={pickAndUpload} disabled={uploading}>
              <Ionicons name="cloud-upload-outline" size={16} color={uploading ? '#555' : '#fff'} />
              <Text style={[f.uploadText, uploading && { color: '#555' }]}>{uploading ? '...' : 'Upload'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <View style={f.searchWrap}>
          <Ionicons name="search" size={15} color="#555" style={{ marginRight: 8 }} />
          <TextInput
            style={f.searchInput}
            placeholder="Cari file..."
            placeholderTextColor="#444"
            value={search}
            onChangeText={handleSearchChange}
            returnKeyType="search"
          />
          {search ? (
            <TouchableOpacity onPress={() => { setSearch(''); fetchFiles() }}>
              <Ionicons name="close-circle" size={15} color="#555" />
            </TouchableOpacity>
          ) : null}
        </View>

        {viewMode === 'list' ? renderFileList() : renderFileGrid()}
      </View>
    )
  }

  function renderFileList() {
    return (
      <FlatList
        key="list"
        data={files}
        keyExtractor={f => f.id}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loadingFiles} onRefresh={() => fetchFiles(search)} tintColor="#7c6cf8" />}
        ListEmptyComponent={
          !loadingFiles ? (
            <View style={f.empty}>
              <Ionicons name="folder-open-outline" size={52} color="#222" />
              <Text style={f.emptyText}>Tidak ada file</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const ic = getFileIcon(item.mimeType)
          return (
            <View style={f.row}>
              <View style={[f.rowIcon, { backgroundColor: ic.color + '18' }]}>
                <Ionicons name={ic.name} size={22} color={ic.color} />
              </View>
              <View style={f.rowInfo}>
                <Text style={f.rowName} numberOfLines={1}>{item.name}</Text>
                <Text style={f.rowMeta}>{formatBytes(Number(item.sizeBytes))} · {timeAgo(item.createdAt)}</Text>
              </View>
              <View style={f.rowActions}>
                <TouchableOpacity onPress={() => previewFile(item)} style={f.act}>
                  <Ionicons name="eye-outline" size={17} color="#555" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => openRename(item)} style={f.act}>
                  <Ionicons name="pencil-outline" size={17} color="#7c6cf8" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteFile(item.id, item.name)} style={f.act}>
                  <Ionicons name="trash-outline" size={17} color="#f87171" />
                </TouchableOpacity>
              </View>
            </View>
          )
        }}
      />
    )
  }

  function renderFileGrid() {
    return (
      <FlatList
        key="grid"
        data={files}
        keyExtractor={f => f.id}
        numColumns={2}
        columnWrapperStyle={{ paddingHorizontal: 16, gap: 12 }}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 120, gap: 12 }}
        refreshControl={<RefreshControl refreshing={loadingFiles} onRefresh={() => fetchFiles(search)} tintColor="#7c6cf8" />}
        ListEmptyComponent={
          !loadingFiles ? (
            <View style={f.empty}>
              <Ionicons name="folder-open-outline" size={52} color="#222" />
              <Text style={f.emptyText}>Tidak ada file</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const ic = getFileIcon(item.mimeType)
          return (
            <View style={f.gridCard}>
              <View style={[f.gridIcon, { backgroundColor: ic.color + '18' }]}>
                <Ionicons name={ic.name} size={32} color={ic.color} />
              </View>
              <Text style={f.gridName} numberOfLines={2}>{item.name}</Text>
              <Text style={f.gridMeta}>{formatBytes(Number(item.sizeBytes))}</Text>
              <View style={f.gridActions}>
                <TouchableOpacity onPress={() => previewFile(item)} style={f.act}>
                  <Ionicons name="eye-outline" size={15} color="#555" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => openRename(item)} style={f.act}>
                  <Ionicons name="pencil-outline" size={15} color="#7c6cf8" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteFile(item.id, item.name)} style={f.act}>
                  <Ionicons name="trash-outline" size={15} color="#f87171" />
                </TouchableOpacity>
              </View>
            </View>
          )
        }}
      />
    )
  }

  // ── Render mode Settings ────────────────────────────────────────────────────

  function renderSettings() {
    const totalLimit = connectedAccounts.reduce((s, a) => s + a.quotaLimit, 0)
    const totalUsed  = connectedAccounts.reduce((s, a) => s + a.quotaUsed, 0)
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loadingSettings} onRefresh={fetchSettings} tintColor="#7c6cf8" />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={st.topBar}>
          <View>
            <Text style={st.title}>Settings</Text>
            <Text style={st.sub}>Kelola akun & storage</Text>
          </View>
          <TouchableOpacity onPress={logout} style={st.logoutBtn}>
            <Ionicons name="log-out-outline" size={18} color="#f87171" />
          </TouchableOpacity>
        </View>

        {/* Profile card */}
        {me && (
          <View style={st.profileCard}>
            <View style={st.avatar}>
              <Text style={st.avatarLetter}>{me.name[0]?.toUpperCase() ?? '?'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.profileName}>{me.name}</Text>
              <Text style={st.profileEmail}>{me.email}</Text>
            </View>
          </View>
        )}

        {/* Total storage summary */}
        {connectedAccounts.length > 0 && (
          <View style={st.summaryCard}>
            <Text style={st.summaryLabel}>Total Storage Gabungan</Text>
            <Text style={st.summaryVal}>{formatBytes(totalLimit - totalUsed)} <Text style={st.summarySub}>tersisa</Text></Text>
            <View style={st.bar}>
              <View style={[st.barFill, { width: `${Math.min((totalUsed/totalLimit)*100,100)}%` as any }]} />
            </View>
            <Text style={st.summaryMeta}>{formatBytes(totalUsed)} dipakai dari {formatBytes(totalLimit)} · {connectedAccounts.length} akun</Text>
          </View>
        )}

        {/* Connected accounts */}
        <Text style={st.sectionTitle}>Google Drive Terhubung</Text>

        {connectedAccounts.length === 0 && !loadingSettings && (
          <View style={st.emptyAccounts}>
            <Ionicons name="cloud-offline-outline" size={40} color="#333" />
            <Text style={st.emptyAccountsTxt}>Belum ada akun terhubung</Text>
          </View>
        )}

        {connectedAccounts.map(acc => {
          const pct = acc.quotaLimit ? Math.min((acc.quotaUsed / acc.quotaLimit) * 100, 100) : 0
          const c   = pct > 85 ? '#f87171' : pct > 60 ? '#fbbf24' : '#7c6cf8'
          return (
            <View key={acc.id} style={st.accCard}>
              <View style={st.accRow}>
                <View style={st.accIcon}>
                  <Ionicons name="logo-google" size={16} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.accEmail} numberOfLines={1}>{acc.email}</Text>
                  <Text style={st.accMeta}>{formatBytes(acc.freeSpace)} tersisa</Text>
                </View>
                <Text style={[st.accPct, { color: c }]}>{pct.toFixed(0)}%</Text>
                <TouchableOpacity onPress={() => disconnectAccount(acc.id, acc.email)} style={{ marginLeft: 12 }}>
                  <Ionicons name="unlink-outline" size={18} color="#f87171" />
                </TouchableOpacity>
              </View>
              <View style={st.bar}>
                <View style={[st.barFill, { width: `${pct}%` as any, backgroundColor: c }]} />
              </View>
              <Text style={st.accStorage}>{formatBytes(acc.quotaUsed)} / {formatBytes(acc.quotaLimit)}</Text>
            </View>
          )
        })}

        {/* Add Drive button */}
        <TouchableOpacity style={st.addBtn} onPress={connectDrive}>
          <Ionicons name="add-circle-outline" size={20} color="#7c6cf8" />
          <Text style={st.addBtnTxt}>Tambah Google Drive</Text>
        </TouchableOpacity>
      </ScrollView>
    )
  }

  // ── Root render ─────────────────────────────────────────────────────────────

  return (
    <View style={g.root}>
      <StatusBar barStyle="light-content" backgroundColor="#080810" />

      {/* Content */}
      <View style={g.content}>
        {mode === 'home' ? renderHome() : mode === 'files' ? renderFiles() : renderSettings()}
      </View>

      {/* Bottom nav bar */}
      <View style={g.navbar}>
        {/* Home */}
        <TouchableOpacity
          style={[g.navItem, mode === 'home' && g.navItemActive]}
          onPress={() => switchMode('home')}
        >
          <Ionicons name={mode === 'home' ? 'home' : 'home-outline'} size={20} color={mode === 'home' ? '#7c6cf8' : '#444'} />
          <Text style={[g.navLabel, mode === 'home' && g.navLabelActive]}>Home</Text>
        </TouchableOpacity>

        {/* FAB center — Files */}
        <Animated.View style={[g.fabWrap, { transform: [{ scale: fabScale }] }]}>
          <TouchableOpacity
            style={[g.fab, mode === 'files' && g.fabActive]}
            onPress={() => switchMode(mode === 'files' ? 'home' : 'files')}
            activeOpacity={0.85}
          >
            <Ionicons name="folder-open" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={[g.navLabel, g.fabLabel, mode === 'files' && g.navLabelActive]}>Files</Text>
        </Animated.View>

        {/* Settings */}
        <TouchableOpacity
          style={[g.navItem, mode === 'settings' && g.navItemActive]}
          onPress={() => switchMode('settings')}
        >
          <Ionicons name={mode === 'settings' ? 'settings' : 'settings-outline'} size={20} color={mode === 'settings' ? '#7c6cf8' : '#444'} />
          <Text style={[g.navLabel, mode === 'settings' && g.navLabelActive]}>Settings</Text>
        </TouchableOpacity>
      </View>

      {/* Rename Modal */}
      <Modal visible={renameModal} transparent animationType="fade" onRequestClose={() => setRenameModal(false)}>
        <View style={m.overlay}>
          <View style={m.box}>
            <Text style={m.title}>Ganti nama</Text>
            <TextInput
              style={m.input}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus selectTextOnFocus
              placeholderTextColor="#444"
            />
            <View style={m.btns}>
              <TouchableOpacity style={[m.btn, m.btnCancel]} onPress={() => setRenameModal(false)} disabled={renaming}>
                <Text style={m.btnCancelTxt}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[m.btn, m.btnSave, renaming && { opacity: 0.5 }]} onPress={submitRename} disabled={renaming}>
                <Text style={m.btnSaveTxt}>{renaming ? 'Menyimpan...' : 'Simpan'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ACCENT  = '#7c6cf8'
const BG      = '#080810'
const SURFACE = '#0f0f1a'
const BORDER  = '#1a1a2e'
const TEXT    = '#f0f0ff'
const MUTED   = '#4a4a6a'

// Global
const g = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },
  content: { flex: 1, paddingTop: Platform.OS === 'ios' ? 56 : 40 },
  navbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 32, paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    paddingTop: 12,
    backgroundColor: SURFACE,
    borderTopWidth: 1, borderTopColor: BORDER,
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  navItem: {
    alignItems: 'center', gap: 3, paddingHorizontal: 16, paddingVertical: 6,
    borderRadius: 20,
  },
  navItemActive: { backgroundColor: ACCENT + '15' },
  navLabel:       { fontSize: 11, color: '#444', fontWeight: '500' },
  navLabelActive: { color: ACCENT },
  fabWrap: { marginBottom: 8, alignItems: 'center' },
  fab: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: ACCENT,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: ACCENT, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  fabActive: {
    backgroundColor: '#5a4ee8',
  },
  fabLabel: { marginTop: 4 },
})

// Home screen
const h = StyleSheet.create({
  topBar:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 24 },
  greeting:   { fontSize: 13, color: MUTED, fontWeight: '500' },
  userName:   { fontSize: 22, color: TEXT, fontWeight: '700', marginTop: 2 },
  avatarBtn:  { width: 42, height: 42, borderRadius: 21, backgroundColor: ACCENT, justifyContent: 'center', alignItems: 'center' },
  avatarLetter: { color: '#fff', fontSize: 18, fontWeight: '700' },

  heroCard:   {
    marginHorizontal: 20, marginBottom: 20, borderRadius: 20,
    backgroundColor: ACCENT,
    padding: 22, overflow: 'hidden',
  },
  heroInner:  { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  heroLabel:  { fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: '600', letterSpacing: 0.5, marginBottom: 6 },
  heroFree:   { fontSize: 32, color: '#fff', fontWeight: '800', letterSpacing: -1 },
  heroSub:    { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  donutWrap:  { alignItems: 'center', justifyContent: 'center' },
  donutOuter: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 6, borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  donutInner:  { alignItems: 'center' },
  donutPct:    { fontSize: 20, color: '#fff', fontWeight: '800' },
  donutSymbol: { fontSize: 11, fontWeight: '600' },
  donutUsed:   { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: -2 },

  bar:     { height: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 3, marginBottom: 8, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  barMeta: { fontSize: 12, color: 'rgba(255,255,255,0.55)' },

  metricRow:  { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 28 },
  metricCard: {
    flex: 1, backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    alignItems: 'center', gap: 6, borderWidth: 1, borderColor: BORDER,
  },
  metricVal: { fontSize: 18, color: TEXT, fontWeight: '700' },
  metricLbl: { fontSize: 11, color: MUTED, fontWeight: '500' },

  sectionTitle: { fontSize: 12, color: MUTED, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: 20, marginBottom: 12 },

  accCard:   { backgroundColor: SURFACE, borderRadius: 14, padding: 16, marginHorizontal: 20, marginBottom: 10, borderWidth: 1, borderColor: BORDER },
  accRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  accIcon:   { width: 34, height: 34, borderRadius: 10, backgroundColor: '#2a1a6a', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  accEmail:  { fontSize: 14, color: TEXT, fontWeight: '500' },
  accMeta:   { fontSize: 12, color: MUTED, marginTop: 2 },
  accPct:    { fontSize: 14, fontWeight: '700' },

  recentRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 14 },
  recentIcon: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  recentName: { fontSize: 14, color: TEXT, fontWeight: '500' },
  recentMeta: { fontSize: 12, color: MUTED, marginTop: 2 },
})

// Files screen
const f = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 16 },
  title:  { fontSize: 28, color: TEXT, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: MUTED, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, justifyContent: 'center', alignItems: 'center' },
  iconBtnActive: { borderColor: ACCENT },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ACCENT, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  uploadText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE, marginHorizontal: 20, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 8, borderWidth: 1, borderColor: BORDER },
  searchInput: { flex: 1, color: TEXT, fontSize: 14 },

  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#0e0e1c' },
  rowIcon: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  rowInfo: { flex: 1, marginRight: 4 },
  rowName: { fontSize: 14, color: TEXT, fontWeight: '500' },
  rowMeta: { fontSize: 12, color: MUTED, marginTop: 2 },
  rowActions: { flexDirection: 'row', gap: 4 },

  gridCard: {
    flex: 1, backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER, gap: 8,
  },
  gridIcon: { width: 52, height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  gridName: { fontSize: 13, color: TEXT, fontWeight: '500', lineHeight: 18 },
  gridMeta: { fontSize: 11, color: MUTED },
  gridActions: { flexDirection: 'row', gap: 4, marginTop: 2 },

  act:  { padding: 12, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyText: { color: MUTED, fontSize: 14 },
})

// Modal
const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  box:     { backgroundColor: SURFACE, borderRadius: 20, padding: 24, width: '100%', borderWidth: 1, borderColor: BORDER },
  title:   { color: TEXT, fontSize: 17, fontWeight: '700', marginBottom: 16 },
  input:   { backgroundColor: BG, color: TEXT, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: BORDER, marginBottom: 20 },
  btns:    { flexDirection: 'row', gap: 10 },
  btn:     { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  btnCancel:    { backgroundColor: BG, borderWidth: 1, borderColor: BORDER },
  btnCancelTxt: { color: MUTED, fontWeight: '600', fontSize: 15 },
  btnSave:      { backgroundColor: ACCENT },
  btnSaveTxt:   { color: '#fff', fontWeight: '700', fontSize: 15 },
})

// Settings screen
const st = StyleSheet.create({
  topBar:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 24 },
  title:     { fontSize: 26, color: TEXT, fontWeight: '800', letterSpacing: -0.5 },
  sub:       { fontSize: 13, color: MUTED, marginTop: 2 },
  logoutBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#2a0a0a', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#3a1010' },

  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE, marginHorizontal: 20, borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: BORDER, gap: 14 },
  avatar:      { width: 50, height: 50, borderRadius: 25, backgroundColor: ACCENT, justifyContent: 'center', alignItems: 'center' },
  avatarLetter:{ color: '#fff', fontSize: 22, fontWeight: '700' },
  profileName: { color: TEXT, fontSize: 16, fontWeight: '600' },
  profileEmail:{ color: MUTED, fontSize: 13, marginTop: 2 },

  summaryCard:  { backgroundColor: ACCENT, marginHorizontal: 20, borderRadius: 18, padding: 20, marginBottom: 28 },
  summaryLabel: { fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: '600', letterSpacing: 0.5, marginBottom: 6 },
  summaryVal:   { fontSize: 28, color: '#fff', fontWeight: '800', letterSpacing: -0.5, marginBottom: 12 },
  summarySub:   { fontSize: 16, fontWeight: '500' },
  summaryMeta:  { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 8 },
  bar:          { height: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 3, overflow: 'hidden' },
  barFill:      { height: '100%', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.85)' },

  sectionTitle: { fontSize: 12, color: MUTED, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: 20, marginBottom: 12 },

  emptyAccounts:    { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyAccountsTxt: { color: MUTED, fontSize: 14 },

  accCard:    { backgroundColor: SURFACE, borderRadius: 14, padding: 16, marginHorizontal: 20, marginBottom: 10, borderWidth: 1, borderColor: BORDER },
  accRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  accIcon:    { width: 34, height: 34, borderRadius: 10, backgroundColor: '#2a1a6a', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  accEmail:   { fontSize: 14, color: TEXT, fontWeight: '500' },
  accMeta:    { fontSize: 12, color: MUTED, marginTop: 2 },
  accPct:     { fontSize: 13, fontWeight: '700' },
  accStorage: { fontSize: 12, color: MUTED, marginTop: 6 },

  addBtn:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginTop: 8, padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: ACCENT, borderStyle: 'dashed' },
  addBtnTxt: { color: ACCENT, fontSize: 15, fontWeight: '600' },
})
