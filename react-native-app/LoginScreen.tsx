import React, { useState, useMemo, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { FontAwesome5 } from '@expo/vector-icons'
import { useTheme, Colors } from './ThemeContext'
import * as api from './api'

type RoleKey = 'manager' | 'cashier' | 'waiter'

interface Props {
  onLogin: (roles: string[], userId: string) => void
}

export default function LoginScreen({ onLogin }: Props) {
  const { colors: c, mode } = useTheme()
  const s = useMemo(() => makeStyles(c), [c])

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [showServer, setShowServer] = useState(false)
  const [serverUrl, setServerUrl]   = useState('')

  // Load URL đã lưu từ AsyncStorage
  useEffect(() => {
    api.getServerUrl().then(url => setServerUrl(url))
  }, [])

  async function handleSaveServer() {
    if (serverUrl.trim()) {
      await api.setServerUrl(serverUrl.trim())
    }
    setShowServer(false)
  }

  async function handleLogin() {
    if (!username.trim() || !password) {
      setError('Vui lòng nhập tên đăng nhập và mật khẩu')
      return
    }
    setError('')
    setLoading(true)
    try {
      const result = await api.login(username.trim(), password)
      onLogin(result.roles, result.userId)
    } catch (e: any) {
      console.error('[LOGIN ERROR]', e?.message ?? e)
      setError(String(e?.message ?? 'Lỗi không xác định'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          {/* Logo */}
          <View style={s.logoArea}>
            <TouchableOpacity onLongPress={() => setShowServer(v => !v)} activeOpacity={1}>
              <View style={s.logoCircle}>
                <FontAwesome5 name="music" size={38} color="#fff" solid />
              </View>
            </TouchableOpacity>
            <Text style={s.brand}>Kara POS</Text>
            <Text style={s.brandSub}>Hệ thống quản lý karaoke</Text>
          </View>

          {/* Server URL — hiện khi long press logo */}
          {showServer && (
            <View style={[s.card, { marginBottom: 12 }]}>
              <Text style={s.label}>Server URL</Text>
              <View style={s.inputWrap}>
                <FontAwesome5 name="server" size={13} color={c.textMuted} style={s.inputIcon} />
                <TextInput
                  style={s.input}
                  placeholder="https://your-server.com"
                  placeholderTextColor={c.textFaint}
                  value={serverUrl}
                  onChangeText={setServerUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>
              <TouchableOpacity style={[s.btnLogin, { backgroundColor: '#059669' }]} onPress={handleSaveServer}>
                <Text style={s.btnLoginText}>Lưu địa chỉ</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Login card */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Đăng nhập</Text>

            {/* Username */}
            <Text style={s.label}>Tên đăng nhập</Text>
            <View style={s.inputWrap}>
              <FontAwesome5 name="user" size={13} color={c.textMuted} style={s.inputIcon} />
              <TextInput
                style={s.input}
                placeholder="Tên đăng nhập"
                placeholderTextColor={c.textFaint}
                value={username}
                onChangeText={t => { setUsername(t); setError('') }}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            {/* Password */}
            <Text style={s.label}>Mật khẩu</Text>
            <View style={s.inputWrap}>
              <FontAwesome5 name="lock" size={13} color={c.textMuted} style={s.inputIcon} />
              <TextInput
                style={s.input}
                placeholder="••••••"
                placeholderTextColor={c.textFaint}
                value={password}
                onChangeText={t => { setPassword(t); setError('') }}
                secureTextEntry={!showPw}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity onPress={() => setShowPw(v => !v)} style={s.eyeBtn}>
                <FontAwesome5 name={showPw ? 'eye-slash' : 'eye'} size={13} color={c.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Error */}
            {error ? (
              <View style={s.errorRow}>
                <FontAwesome5 name="exclamation-circle" size={12} color="#ef4444" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Login button */}
            <TouchableOpacity style={s.btnLogin} onPress={handleLogin} disabled={loading} activeOpacity={0.85}>
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnLoginText}>Đăng nhập</Text>
              }
            </TouchableOpacity>

          </View>

          {/* Privacy policy link placeholder */}
          <Text style={s.privacy}>
            Bằng cách đăng nhập, bạn đồng ý với{' '}
            <Text style={s.privacyLink}>Chính sách bảo mật</Text>
          </Text>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const makeStyles = (c: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingBottom: 40 },

  // Logo
  logoArea: { alignItems: 'center', marginBottom: 28 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: '#7c3aed',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 14,
    shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 10,
  },
  brand: { fontSize: 28, fontWeight: '800', color: c.text, letterSpacing: 0.5 },
  brandSub: { fontSize: 13, color: c.textMuted, marginTop: 4 },

  // Card
  card: {
    backgroundColor: c.surface, borderRadius: 20, padding: 24,
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 20 },

  // Form
  label: { fontSize: 12, fontWeight: '600', color: c.textSub, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.input, borderRadius: 10, borderWidth: 1, borderColor: c.border,
    marginBottom: 14, paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, color: c.text, fontSize: 15, paddingVertical: 12 },
  eyeBtn: { padding: 8 },

  // Error
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, marginTop: -6 },
  errorText: { color: '#ef4444', fontSize: 13 },

  // Login button
  btnLogin: {
    backgroundColor: '#7c3aed', borderRadius: 12, paddingVertical: 15,
    alignItems: 'center', marginTop: 4,
    shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },
  btnLoginText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Privacy
  privacy: { textAlign: 'center', fontSize: 11, color: c.textFaint, marginTop: 12 },
  privacyLink: { color: '#7c3aed', textDecorationLine: 'underline' },
})
