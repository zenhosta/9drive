import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { register } from '@/lib/api'

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRegister() {
    if (!name || !email || !password) return Alert.alert('Error', 'Isi semua field')
    if (password.length < 8) return Alert.alert('Error', 'Password minimal 8 karakter')
    setLoading(true)
    try {
      await register(name, email, password)
      router.replace('/(app)/main')
    } catch (e: any) {
      Alert.alert('Register gagal', e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={s.title}>9Drive</Text>
      <Text style={s.subtitle}>Buat akun baru</Text>

      <TextInput style={s.input} placeholder="Nama" placeholderTextColor="#555" value={name} onChangeText={setName} />
      <TextInput style={s.input} placeholder="Email" placeholderTextColor="#555" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={s.input} placeholder="Password" placeholderTextColor="#555" value={password} onChangeText={setPassword} secureTextEntry />

      <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handleRegister} disabled={loading}>
        <Text style={s.btnText}>{loading ? 'Loading...' : 'Register'}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.back()}>
        <Text style={s.link}>Sudah punya akun? <Text style={s.linkBold}>Login</Text></Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f', justifyContent: 'center', padding: 24 },
  title: { fontSize: 36, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 32 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 15, borderWidth: 1, borderColor: '#2a2a2a' },
  btn: { backgroundColor: '#6366f1', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 4 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  link: { color: '#666', textAlign: 'center', marginTop: 20 },
  linkBold: { color: '#6366f1', fontWeight: '600' },
})
