import { useEffect, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, RefreshControl, TextInput, Platform, Modal, Linking
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import { apiFetch, formatBytes, API_URL } from '@/lib/api'
import { getItem } from '@/lib/storage'

type DriveFile = {
  id: string
  name: string
  mimeType: string
  sizeBytes: string
  createdAt: string
  folderId: string | null
  connectedAccount: { email: string; provider: string } | null
}

export default function FilesPage() {
  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')

  // state untuk modal rename
  const [renameModal, setRenameModal] = useState(false)
  const [renameTarget, setRenameTarget] = useState<DriveFile | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  async function fetchFiles(q?: string) {
    setLoading(true)
    try {
      const url = q ? `/files?q=${encodeURIComponent(q)}` : '/files'
      const data = await apiFetch<DriveFile[]>(url)
      setFiles(data)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setLoading(false)
    }
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
        const res = await fetch(file.uri)
        const blob = await res.blob()
        form.append('file', blob, file.name)
      } else {
        form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as any)
      }

      form.append('fileName', file.name)
      form.append('sizeBytes', String(file.size ?? 0))
      form.append('mimeType', file.mimeType ?? 'application/octet-stream')

      const uploadRes = await fetch(`${API_URL}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ detail: 'Upload gagal' }))
        throw new Error(err.detail)
      }

      Alert.alert('Sukses', 'File berhasil diupload')
      fetchFiles()
    } catch (e: any) {
      Alert.alert('Upload gagal', e.message)
    } finally {
      setUploading(false)
    }
  }

  async function deleteFile(id: string, name: string) {
    const doDelete = async () => {
      try {
        await apiFetch(`/files/${id}`, { method: 'DELETE' })
        setFiles(prev => prev.filter(f => f.id !== id))
      } catch (e: any) {
        Alert.alert('Error', e.message)
      }
    }

    if (Platform.OS === 'web') {
      if (window.confirm(`Hapus "${name}"?`)) {
        await doDelete()
      }
    } else {
      Alert.alert('Hapus file', `Hapus "${name}"?`, [
        { text: 'Batal', style: 'cancel' },
        { text: 'Hapus', style: 'destructive', onPress: doDelete },
      ])
    }
  }

  function openRenameModal(file: DriveFile) {
    setRenameTarget(file)
    setRenameValue(file.name)
    setRenameModal(true)
  }

  async function submitRename() {
    if (!renameTarget || !renameValue.trim()) return
    setRenaming(true)
    try {
      const updated = await apiFetch<{ id: string; name: string }>(`/files/${renameTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: renameValue.trim() }),
      })
      setFiles(prev => prev.map(f => f.id === updated.id ? { ...f, name: updated.name } : f))
      setRenameModal(false)
    } catch (e: any) {
      Alert.alert('Error', e.message)
    } finally {
      setRenaming(false)
    }
  }

  async function previewFile(file: DriveFile) {
    const token = await getItem('accessToken')
    const url = `${API_URL}/files/${file.id}/download`

    if (Platform.OS === 'web') {
      // di web: fetch dengan auth header, lalu buat blob URL supaya bisa dibuka di tab baru
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error('Gagal memuat file')
        const blob = await res.blob()
        const blobUrl = URL.createObjectURL(blob)
        window.open(blobUrl, '_blank')
        // cleanup setelah 60 detik
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
      } catch (e: any) {
        Alert.alert('Preview gagal', e.message)
      }
    } else {
      // di native: Linking tidak bisa kirim header, jadi tampilkan info ke user
      Alert.alert(
        'Preview',
        `File: ${file.name}\n\nUntuk preview, gunakan fitur download terlebih dahulu.`,
        [{ text: 'OK' }]
      )
    }
  }

  useEffect(() => { fetchFiles() }, [])

  function getIcon(mimeType: string) {
    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType.startsWith('video/')) return 'videocam'
    if (mimeType.includes('pdf')) return 'document-text'
    if (mimeType.includes('zip') || mimeType.includes('rar')) return 'archive'
    if (mimeType.includes('audio/')) return 'musical-notes'
    return 'document'
  }

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Files</Text>
        <TouchableOpacity onPress={pickAndUpload} disabled={uploading} style={s.uploadBtn}>
          <Ionicons name={uploading ? 'cloud-upload' : 'cloud-upload-outline'} size={22} color={uploading ? '#555' : '#6366f1'} />
          <Text style={[s.uploadText, uploading && { color: '#555' }]}>{uploading ? 'Uploading...' : 'Upload'}</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.searchBox}>
        <Ionicons name="search" size={16} color="#555" style={{ marginRight: 8 }} />
        <TextInput
          style={s.searchInput}
          placeholder="Cari file..."
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => fetchFiles(search)}
          returnKeyType="search"
        />
        {search ? (
          <TouchableOpacity onPress={() => { setSearch(''); fetchFiles() }}>
            <Ionicons name="close-circle" size={16} color="#555" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* File list */}
      <FlatList
        data={files}
        keyExtractor={f => f.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => fetchFiles(search)} tintColor="#6366f1" />}
        ListEmptyComponent={
          !loading ? (
            <View style={s.empty}>
              <Ionicons name="folder-open" size={48} color="#333" />
              <Text style={s.emptyText}>Tidak ada file</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={s.item}>
            <View style={s.itemIcon}>
              <Ionicons name={getIcon(item.mimeType) as any} size={24} color="#6366f1" />
            </View>
            <View style={s.itemInfo}>
              <Text style={s.itemName} numberOfLines={1}>{item.name}</Text>
              <Text style={s.itemMeta}>{formatBytes(Number(item.sizeBytes))} · {item.connectedAccount?.email}</Text>
            </View>
            <View style={s.actions}>
              <TouchableOpacity onPress={() => previewFile(item)} style={s.actionBtn}>
                <Ionicons name="eye-outline" size={18} color="#888" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openRenameModal(item)} style={s.actionBtn}>
                <Ionicons name="pencil-outline" size={18} color="#6366f1" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => deleteFile(item.id, item.name)} style={s.actionBtn}>
                <Ionicons name="trash-outline" size={18} color="#e55" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* Modal Rename */}
      <Modal
        visible={renameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameModal(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Ganti nama</Text>
            <TextInput
              style={s.modalInput}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              selectTextOnFocus
              placeholderTextColor="#555"
            />
            <View style={s.modalActions}>
              <TouchableOpacity
                style={[s.modalBtn, s.modalBtnCancel]}
                onPress={() => setRenameModal(false)}
                disabled={renaming}
              >
                <Text style={s.modalBtnCancelText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, s.modalBtnSave, renaming && { opacity: 0.5 }]}
                onPress={submitRename}
                disabled={renaming}
              >
                <Text style={s.modalBtnSaveText}>{renaming ? 'Menyimpan...' : 'Simpan'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f', paddingTop: 52 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff' },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1a1a1a', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a' },
  uploadText: { color: '#6366f1', fontSize: 14, fontWeight: '500' },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', marginHorizontal: 20, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, borderWidth: 1, borderColor: '#2a2a2a' },
  searchInput: { flex: 1, color: '#fff', fontSize: 14 },
  item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  itemIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  itemInfo: { flex: 1, marginRight: 4 },
  itemName: { color: '#fff', fontSize: 14, fontWeight: '500' },
  itemMeta: { color: '#555', fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionBtn: { padding: 7 },
  empty: { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyText: { color: '#444', fontSize: 14 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  modalBox: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24, width: '100%', borderWidth: 1, borderColor: '#2a2a2a' },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '600', marginBottom: 16 },
  modalInput: { backgroundColor: '#0f0f0f', color: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, borderWidth: 1, borderColor: '#2a2a2a', marginBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  modalBtnCancel: { backgroundColor: '#0f0f0f', borderWidth: 1, borderColor: '#2a2a2a' },
  modalBtnCancelText: { color: '#888', fontWeight: '500', fontSize: 15 },
  modalBtnSave: { backgroundColor: '#6366f1' },
  modalBtnSaveText: { color: '#fff', fontWeight: '600', fontSize: 15 },
})
