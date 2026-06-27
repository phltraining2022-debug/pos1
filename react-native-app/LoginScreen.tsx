import React, { useState, useMemo, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Modal, FlatList,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { FontAwesome5 } from '@expo/vector-icons'
import { useTheme, Colors } from './ThemeContext'
import { useStore } from './StoreContext'
import * as api from './api'

type RoleKey = 'manager' | 'cashier' | 'waiter'

interface Props {
  onLogin: (roles: string[], userId: string) => void
}

export default function LoginScreen({ onLogin }: Props) {
  const { colors: c, mode } = useTheme()
  const { selectStore, stores, loading: storeLoading } = useStore()
  const s = useMemo(() => makeStyles(c), [c])

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [showServer, setShowServer] = useState(false)
  const [serverUrl, setServerUrl]   = useState('')
  const [showStoreSelection, setShowStoreSelection] = useState(false)
  const [tempUserId, setTempUserId] = useState('')
  const [tempRoles, setTempRoles] = useState<string[]>([])
  const [forgotVisible, setForgotVisible] = useState(false)
  const [forgotStep, setForgotStep] = useState<'contact' | 'code' | 'password'>('contact')
  const [forgotContact, setForgotContact] = useState('')
  const [forgotCode, setForgotCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotError, setForgotError] = useState('')
  const [forgotDone, setForgotDone] = useState('')

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
      // Lưu tạm thời, show store selection
      setTempUserId(result.userId)
      setTempRoles(result.roles)
      setShowStoreSelection(true)
    } catch (e: any) {
      console.error('[LOGIN ERROR]', e?.message ?? e)
      setError(String(e?.message ?? 'Lỗi không xác định'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectStore(store: api.Store) {
    await selectStore(store as any)
    setShowStoreSelection(false)
    onLogin(tempRoles, tempUserId)
  }

  function openForgotPassword() {
    setForgotVisible(true)
    setForgotStep('contact')
    setForgotContact(username.trim())
    setForgotCode('')
    setNewPassword('')
    setRepeatPassword('')
    setForgotError('')
    setForgotDone('')
  }

  function closeForgotPassword() {
    setForgotVisible(false)
    setForgotLoading(false)
  }

  async function handleRequestResetCode() {
    const contact = forgotContact.trim()
    if (!contact) {
      setForgotError('Vui lòng nhập số điện thoại hoặc email')
      return
    }
    setForgotError('')
    setForgotDone('')
    setForgotLoading(true)
    try {
      await api.requestUserPasswordReset(contact)
      setForgotStep('code')
      setForgotDone('Đã gửi mã xác thực')
    } catch (e: any) {
      setForgotError(String(e?.message ?? 'Không gửi được mã xác thực'))
    } finally {
      setForgotLoading(false)
    }
  }

  function handleConfirmResetCode() {
    if (!forgotCode.trim()) {
      setForgotError('Vui lòng nhập mã xác thực')
      return
    }
    setForgotError('')
    setForgotDone('')
    setForgotStep('password')
  }

  async function handleResetPassword() {
    const contact = forgotContact.trim()
    const code = forgotCode.trim()
    if (!newPassword || !repeatPassword) {
      setForgotError('Vui lòng nhập đủ mật khẩu mới')
      return
    }
    if (newPassword.length < 6) {
      setForgotError('Mật khẩu mới phải có ít nhất 6 ký tự')
      return
    }
    if (newPassword !== repeatPassword) {
      setForgotError('Mật khẩu nhập lại không khớp')
      return
    }
    setForgotError('')
    setForgotDone('')
    setForgotLoading(true)
    try {
      await api.resetUserPassword(contact, code, newPassword)
      setUsername(contact)
      setPassword('')
      setForgotDone('Đổi mật khẩu thành công')
      setTimeout(closeForgotPassword, 700)
    } catch (e: any) {
      setForgotError(String(e?.message ?? 'Không đổi được mật khẩu'))
    } finally {
      setForgotLoading(false)
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
            <Text style={s.brandSub}>Hệ thống quản lý nhà hàng</Text>
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

            <TouchableOpacity style={s.linkButton} onPress={openForgotPassword}>
              <Text style={s.linkButtonText}>Quên mật khẩu?</Text>
            </TouchableOpacity>

          </View>

          {/* Privacy policy link placeholder */}
          <Text style={s.privacy}>
            Bằng cách đăng nhập, bạn đồng ý với{' '}
            <Text style={s.privacyLink}>Chính sách bảo mật</Text>
          </Text>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Forgot Password Modal */}
      <Modal visible={forgotVisible} animationType="slide" transparent={true} onRequestClose={closeForgotPassword}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: c.bg }]}>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: c.text }]}>Quên mật khẩu</Text>
            </View>
            <View style={s.modalBody}>
              {forgotStep === 'contact' && (
                <>
                  <Text style={s.label}>Số điện thoại hoặc email</Text>
                  <View style={s.inputWrap}>
                    <FontAwesome5 name="user" size={13} color={c.textMuted} style={s.inputIcon} />
                    <TextInput
                      style={s.input}
                      placeholder="Nhập tài khoản"
                      placeholderTextColor={c.textFaint}
                      value={forgotContact}
                      onChangeText={t => { setForgotContact(t); setForgotError(''); setForgotDone('') }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                    />
                  </View>
                </>
              )}

              {forgotStep === 'code' && (
                <>
                  <Text style={s.helperText}>Mã xác thực đã gửi tới {forgotContact.trim()}</Text>
                  <Text style={s.label}>Mã xác thực</Text>
                  <View style={s.inputWrap}>
                    <FontAwesome5 name="key" size={13} color={c.textMuted} style={s.inputIcon} />
                    <TextInput
                      style={s.input}
                      placeholder="OTP"
                      placeholderTextColor={c.textFaint}
                      value={forgotCode}
                      onChangeText={t => { setForgotCode(t); setForgotError(''); setForgotDone('') }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="number-pad"
                    />
                  </View>
                </>
              )}

              {forgotStep === 'password' && (
                <>
                  <Text style={s.label}>Mật khẩu mới</Text>
                  <View style={s.inputWrap}>
                    <FontAwesome5 name="lock" size={13} color={c.textMuted} style={s.inputIcon} />
                    <TextInput
                      style={s.input}
                      placeholder="Mật khẩu mới"
                      placeholderTextColor={c.textFaint}
                      value={newPassword}
                      onChangeText={t => { setNewPassword(t); setForgotError(''); setForgotDone('') }}
                      secureTextEntry
                    />
                  </View>
                  <Text style={s.label}>Nhập lại mật khẩu</Text>
                  <View style={s.inputWrap}>
                    <FontAwesome5 name="lock" size={13} color={c.textMuted} style={s.inputIcon} />
                    <TextInput
                      style={s.input}
                      placeholder="Nhập lại mật khẩu"
                      placeholderTextColor={c.textFaint}
                      value={repeatPassword}
                      onChangeText={t => { setRepeatPassword(t); setForgotError(''); setForgotDone('') }}
                      secureTextEntry
                      onSubmitEditing={handleResetPassword}
                    />
                  </View>
                </>
              )}

              {forgotError ? (
                <View style={s.errorRow}>
                  <FontAwesome5 name="exclamation-circle" size={12} color="#ef4444" />
                  <Text style={s.errorText}>{forgotError}</Text>
                </View>
              ) : null}
              {forgotDone ? (
                <View style={s.successRow}>
                  <FontAwesome5 name="check-circle" size={12} color="#10b981" />
                  <Text style={s.successText}>{forgotDone}</Text>
                </View>
              ) : null}

              <View style={s.modalActions}>
                <TouchableOpacity style={s.btnSecondary} onPress={closeForgotPassword} disabled={forgotLoading}>
                  <Text style={s.btnSecondaryText}>Huỷ</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btnModalPrimary, forgotLoading && s.btnDisabled]}
                  onPress={forgotStep === 'contact' ? handleRequestResetCode : forgotStep === 'code' ? handleConfirmResetCode : handleResetPassword}
                  disabled={forgotLoading}
                >
                  {forgotLoading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={s.btnLoginText}>{forgotStep === 'password' ? 'Đổi mật khẩu' : 'Tiếp tục'}</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Store Selection Modal */}
      <Modal visible={showStoreSelection} animationType="slide" transparent={true}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: c.bg }]}>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: c.text }]}>Chọn cửa hàng</Text>
            </View>
            {storeLoading ? (
              <View style={s.modalCenter}>
                <ActivityIndicator size="large" color="#7c3aed" />
              </View>
            ) : (
              <FlatList
                data={stores}
                keyExtractor={store => store.id}
                renderItem={({ item: store }) => (
                  <TouchableOpacity
                    style={[s.storeItem, { borderBottomColor: c.border }]}
                    onPress={() => handleSelectStore(store)}
                  >
                    <View style={s.storeIcon}>
                      <FontAwesome5 name="store" size={20} color="#7c3aed" solid />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.storeName, { color: c.text }]}>{store.name}</Text>
                      {store.code && (
                        <Text style={[s.storeCode, { color: c.textMuted }]}>{store.code}</Text>
                      )}
                    </View>
                    <FontAwesome5 name="chevron-right" size={14} color={c.textMuted} />
                  </TouchableOpacity>
                )}
                contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12 }}
              />
            )}
          </View>
        </View>
      </Modal>
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
  linkButton: { alignItems: 'center', paddingTop: 14 },
  linkButtonText: { color: '#7c3aed', fontSize: 13, fontWeight: '700' },

  // Privacy
  privacy: { textAlign: 'center', fontSize: 11, color: c.textFaint, marginTop: 12 },
  privacyLink: { color: '#7c3aed', textDecorationLine: 'underline' },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end'
  },
  modalContent: {
    maxHeight: '70%', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 20,
  },
  modalHeader: {
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalBody: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  helperText: { color: c.textSub, fontSize: 13, marginBottom: 14 },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, marginTop: -2 },
  successText: { color: '#10b981', fontSize: 13 },
  btnSecondary: {
    flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  btnSecondaryText: { color: c.textSub, fontSize: 15, fontWeight: '700' },
  btnModalPrimary: {
    flex: 1, backgroundColor: '#7c3aed', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 5,
  },
  btnDisabled: { opacity: 0.65 },
  storeItem: {
    flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1,
  },
  storeIcon: {
    width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(124,58,237,0.1)', justifyContent: 'center', alignItems: 'center',
  },
  storeName: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  storeCode: { fontSize: 12 },
})
