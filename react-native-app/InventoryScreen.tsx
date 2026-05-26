import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Modal,
  StyleSheet, StatusBar, ActivityIndicator, Alert, Switch,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { FontAwesome5 } from '@expo/vector-icons'
import { useTheme, Colors } from './ThemeContext'
import { useStore } from './StoreContext'
import * as api from './api'

const fmtVnd = (n: number) => n.toLocaleString('vi-VN') + 'đ'

const EMPTY_FORM = { name: '', price: '', sellingPrice: '', code: '', categoryId: '', unitOfMeasure: '', minStockLevel: '' }
const EMPTY_STOCK_IN = { productId: '', productName: '', unitOfMeasure: '', qty: '', unitPrice: '', supplier: '', invoiceNumber: '', expiredDate: '', note: '' }

type TabKey = 'list' | 'stock'

export default function InventoryScreen({ onBack }: { onBack: () => void }) {
  const { colors: c, mode } = useTheme()
  const { selectedStore } = useStore()
  const s = useMemo(() => makeStyles(c), [c])

  const [tab, setTab] = useState<TabKey>('list')
  const [products, setProducts]     = useState<api.Product[]>([])
  const [categories, setCategories] = useState<api.ProductCategory[]>([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [search, setSearch]         = useState('')
  const [filterCat, setFilterCat]   = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [filterLow, setFilterLow]   = useState(false)

  // Modal state
  const [editModal, setEditModal]   = useState<'none' | 'add' | 'edit'>('none')
  const [editTarget, setEditTarget] = useState<api.Product | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  // Nhập hàng modal
  const [stockModal, setStockModal] = useState(false)
  const [stockForm, setStockForm]   = useState(EMPTY_STOCK_IN)
  const [stockSearch, setStockSearch] = useState('')

  // Điều chỉnh tồn kho nhanh
  const [adjustModal, setAdjustModal] = useState(false)
  const [adjustTarget, setAdjustTarget] = useState<api.Product | null>(null)
  const [adjustQty, setAdjustQty]   = useState('')
  const [adjustMin, setAdjustMin]   = useState('')

  const loadData = useCallback(async () => {
    try {
      const [prods, cats] = await Promise.all([
        api.getAllProducts(),
        api.getProductCategories(),
      ])
      setProducts(prods)
      setCategories(cats)
    } catch (err) {
      console.error('InventoryScreen load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const filtered = useMemo(() => {
    let list = products
    if (!showInactive) list = list.filter(p => p.isActive !== false)
    if (filterCat !== 'all') list = list.filter(p => p.categoryId === filterCat)
    if (filterLow) list = list.filter(p => (p.stock ?? 0) <= (p.minStockLevel ?? 0) && (p.minStockLevel ?? 0) > 0)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.code ?? '').toLowerCase().includes(q))
    }
    return list
  }, [products, filterCat, search, showInactive, filterLow])

  const lowStockCount = useMemo(() =>
    products.filter(p => p.isActive !== false && (p.stock ?? 0) <= (p.minStockLevel ?? 0) && (p.minStockLevel ?? 0) > 0).length
  , [products])

  const openAdd = () => {
    setForm(EMPTY_FORM)
    setEditTarget(null)
    setEditModal('add')
  }

  const openEdit = (product: api.Product) => {
    setEditTarget(product)
    setForm({
      name: product.name,
      price: String(product.price || 0),
      sellingPrice: String(product.sellingPrice || product.price || 0),
      code: product.code ?? '',
      categoryId: product.categoryId ?? '',
      unitOfMeasure: product.unitOfMeasure ?? '',
      minStockLevel: String(product.minStockLevel || 0),
    })
    setEditModal('edit')
  }

  const openAdjust = (product: api.Product) => {
    setAdjustTarget(product)
    setAdjustQty(String(product.stock ?? 0))
    setAdjustMin(String(product.minStockLevel ?? 0))
    setAdjustModal(true)
  }

  const openStockIn = (product?: api.Product) => {
    setStockForm({
      ...EMPTY_STOCK_IN,
      productId: product?.id ?? '',
      productName: product?.name ?? '',
    })
    setStockSearch('')
    setStockModal(true)
  }

  const handleSaveProduct = async () => {
    const name = form.name.trim()
    if (!name) { Alert.alert('Thiếu thông tin', 'Vui lòng nhập tên sản phẩm'); return }
    const price = parseInt(form.price.replace(/\D/g, '')) || 0
    const sellingPrice = parseInt(form.sellingPrice.replace(/\D/g, '')) || price
    setSaving(true)
    try {
      const data: api.ProductInput = {
        name,
        price,
        sellingPrice,
        code: form.code.trim() || undefined,
        categoryId: form.categoryId || undefined,
        type: 'product',
      }
      if (editModal === 'add') {
        const newP = await api.createProduct(data)
        setProducts(prev => [newP, ...prev])
        Alert.alert('Thành công', `Đã thêm "${name}"`)
      } else if (editTarget) {
        const updated = await api.updateProduct(editTarget.id, {
          ...data,
          minStockLevel: parseInt(form.minStockLevel) || 0,
        } as any)
        setProducts(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p))
        Alert.alert('Thành công', `Đã cập nhật "${name}"`)
      }
      setEditModal('none')
    } catch (err: any) {
      Alert.alert('Lỗi', err?.message ?? 'Không thể lưu sản phẩm')
    } finally {
      setSaving(false)
    }
  }

  const handleStockIn = async () => {
    if (!stockForm.productId) { Alert.alert('Chưa chọn sản phẩm', 'Vui lòng chọn sản phẩm để nhập'); return }
    const qty = parseInt(stockForm.qty) || 0
    if (qty <= 0) { Alert.alert('Số lượng không hợp lệ', 'Nhập số lượng > 0'); return }
    setSaving(true)
    try {
      const product = products.find(p => p.id === stockForm.productId)!
      const updated = await api.stockIn(
        stockForm.productId,
        qty,
        product.stock ?? 0,
        parseInt(stockForm.unitPrice) || undefined,
        stockForm.supplier.trim() || undefined,
        stockForm.note.trim() || undefined,
        stockForm.invoiceNumber.trim() || undefined,
        stockForm.expiredDate.trim() || undefined,
      )
      setProducts(prev => prev.map(p => p.id === updated.id ? { ...p, stock: updated.stock } : p))
      Alert.alert('Nhập hàng thành công', `+${qty} ${product.unitOfMeasure ?? 'đơn vị'} cho "${product.name}"\nTồn mới: ${updated.stock}`)
      setStockModal(false)
    } catch (err: any) {
      Alert.alert('Lỗi', err?.message ?? 'Không thể nhập hàng')
    } finally {
      setSaving(false)
    }
  }

  const handleAdjust = async () => {
    if (!adjustTarget) return
    const newStock = parseInt(adjustQty) || 0
    const newMin   = parseInt(adjustMin) || 0
    setSaving(true)
    try {
      const updated = await api.adjustStock(adjustTarget.id, newStock, newMin)
      setProducts(prev => prev.map(p => p.id === adjustTarget.id
        ? { ...p, stock: updated.stock, minStockLevel: updated.minStockLevel }
        : p))
      setAdjustModal(false)
    } catch (err: any) {
      Alert.alert('Lỗi', err?.message ?? 'Không thể điều chỉnh')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = (product: api.Product) => {
    const action = product.isActive !== false ? 'ẩn' : 'kích hoạt'
    Alert.alert(
      `${action.charAt(0).toUpperCase() + action.slice(1)} sản phẩm?`,
      `"${product.name}"`,
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: action.charAt(0).toUpperCase() + action.slice(1),
          style: product.isActive !== false ? 'destructive' : 'default',
          onPress: async () => {
            try {
              await api.updateProduct(product.id, { isActive: !(product.isActive !== false) })
              setProducts(prev => prev.map(p => p.id === product.id ? { ...p, isActive: !(p.isActive !== false) } : p))
            } catch (err: any) {
              Alert.alert('Lỗi', err?.message ?? 'Không thể cập nhật')
            }
          },
        },
      ]
    )
  }

  const catName = (id: string) => categories.find(c => c.id === id)?.name ?? ''
  const isLow = (p: api.Product) => (p.minStockLevel ?? 0) > 0 && (p.stock ?? 0) <= (p.minStockLevel ?? 0)

  if (loading) {
    return (
      <SafeAreaView style={s.root} edges={['top']}>
        <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#7c3aed" />
          <Text style={{ color: c.textMuted, marginTop: 12 }}>Đang tải...</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <FontAwesome5 name="arrow-left" size={13} color={c.textMuted} solid />
          <FontAwesome5 name="boxes" size={18} color="#7c3aed" solid />
          <View>
            <Text style={s.headerTitle}>Quản lý hàng hoá</Text>
          </View>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={() => openStockIn()} style={[s.iconBtn, { backgroundColor: '#16a34a' }]}>
            <FontAwesome5 name="truck-loading" size={13} color="#fff" solid />
          </TouchableOpacity>
          <TouchableOpacity onPress={loadData} style={s.iconBtn}>
            <FontAwesome5 name="sync-alt" size={13} color={c.textMuted} solid />
          </TouchableOpacity>
          <TouchableOpacity onPress={openAdd} style={[s.iconBtn, { backgroundColor: '#7c3aed' }]}>
            <FontAwesome5 name="plus" size={14} color="#fff" solid />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Tab bar ── */}
      <View style={s.tabBar}>
        <TouchableOpacity style={[s.tabBtn, tab === 'list' && s.tabBtnActive]} onPress={() => setTab('list')}>
          <FontAwesome5 name="list" size={12} color={tab === 'list' ? '#7c3aed' : c.textMuted} solid />
          <Text style={[s.tabBtnText, tab === 'list' && { color: '#7c3aed', fontWeight: '700' }]}>Danh sách</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tabBtn, tab === 'stock' && s.tabBtnActive]} onPress={() => setTab('stock')}>
          <FontAwesome5 name="warehouse" size={12} color={tab === 'stock' ? '#7c3aed' : c.textMuted} solid />
          <Text style={[s.tabBtnText, tab === 'stock' && { color: '#7c3aed', fontWeight: '700' }]}>Tồn kho</Text>
          {lowStockCount > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{lowStockCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Search + filter bar ── */}
      <View style={s.searchRow}>
        <View style={s.searchBar}>
          <FontAwesome5 name="search" size={12} color="#6b7280" solid />
          <TextInput
            style={s.searchInput}
            placeholder="Tìm tên, mã SP..."
            placeholderTextColor="#9ca3af"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        {tab === 'stock' && (
          <TouchableOpacity
            style={[s.filterBtn, filterLow && { backgroundColor: '#dc2626' }]}
            onPress={() => setFilterLow(v => !v)}>
            <FontAwesome5 name="exclamation-triangle" size={12} color={filterLow ? '#fff' : '#dc2626'} solid />
            <Text style={{ color: filterLow ? '#fff' : '#dc2626', fontSize: 12, fontWeight: '600' }}>Sắp hết</Text>
          </TouchableOpacity>
        )}
        {tab === 'list' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: c.textFaint, fontSize: 11 }}>Đã ẩn</Text>
            <Switch
              value={showInactive}
              onValueChange={setShowInactive}
              trackColor={{ false: c.border, true: '#7c3aed' }}
              thumbColor={showInactive ? '#7c3aed' : '#9ca3af'}
              style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
            />
          </View>
        )}
      </View>

      {/* ── Category filter ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catStrip}
        contentContainerStyle={{ paddingHorizontal: 10, gap: 8, paddingVertical: 8 }}>
        <TouchableOpacity style={filterCat === 'all' ? s.catActive : s.catBtn} onPress={() => setFilterCat('all')}>
          <Text style={filterCat === 'all' ? s.catActiveText : s.catBtnText}>Tất cả</Text>
        </TouchableOpacity>
        {categories.map(cat => (
          <TouchableOpacity key={cat.id} style={filterCat === cat.id ? s.catActive : s.catBtn} onPress={() => setFilterCat(cat.id)}>
            <Text style={filterCat === cat.id ? s.catActiveText : s.catBtnText}>{cat.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── TAB: Danh sách sản phẩm ── */}
      {tab === 'list' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10, gap: 8, paddingBottom: 24 }}>
          {filtered.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <FontAwesome5 name="box-open" size={38} color="#d1d5db" solid />
              <Text style={{ color: c.textMuted, marginTop: 12, fontSize: 15 }}>Không có sản phẩm</Text>
              <TouchableOpacity onPress={openAdd} style={s.emptyBtn}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>+ Thêm sản phẩm</Text>
              </TouchableOpacity>
            </View>
          )}
          {filtered.map(product => {
            const inactive = product.isActive === false
            return (
              <View key={product.id} style={[s.productCard, inactive && s.productCardInactive]}>
                {/* Left: info */}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    {inactive && <View style={s.badgeHidden}><Text style={s.badgeHiddenText}>Ẩn</Text></View>}
                    <Text style={[s.productName, inactive && { color: c.textFaint }]} numberOfLines={1}>
                      {product.name}
                    </Text>
                  </View>
                  <Text style={s.productPrice}>{fmtVnd(product.sellingPrice || product.price)}</Text>
                  <Text style={s.productMeta}>
                    {catName(product.categoryId) || 'Chưa phân loại'}
                    {product.code ? ` · ${product.code}` : ''}
                    {product.unitOfMeasure ? ` · ${product.unitOfMeasure}` : ''}
                  </Text>
                </View>
                {/* Right: actions */}
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <TouchableOpacity style={s.actionIconBtn} onPress={() => handleToggleActive(product)}>
                    <FontAwesome5 name={inactive ? 'eye' : 'eye-slash'} size={13} color={inactive ? '#16a34a' : c.textMuted} solid />
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.actionIconBtn, { backgroundColor: '#ede9fe' }]} onPress={() => openEdit(product)}>
                    <FontAwesome5 name="edit" size={13} color="#7c3aed" solid />
                  </TouchableOpacity>
                </View>
              </View>
            )
          })}
        </ScrollView>
      )}

      {/* ── TAB: Tồn kho ── */}
      {tab === 'stock' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10, gap: 8, paddingBottom: 24 }}>
          {/* Summary cards */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
            <View style={[s.summaryCard, { backgroundColor: '#f0fdf4', borderColor: '#86efac' }]}>
              <Text style={[s.summaryVal, { color: '#16a34a' }]}>{products.filter(p => p.isActive !== false && (p.stock ?? 0) > (p.minStockLevel ?? 0)).length}</Text>
              <Text style={s.summaryLabel}>Đủ hàng</Text>
            </View>
            <View style={[s.summaryCard, { backgroundColor: '#fef2f2', borderColor: '#fca5a5' }]}>
              <Text style={[s.summaryVal, { color: '#dc2626' }]}>{lowStockCount}</Text>
              <Text style={s.summaryLabel}>Sắp hết</Text>
            </View>
            <View style={[s.summaryCard, { backgroundColor: '#fffbeb', borderColor: '#fcd34d' }]}>
              <Text style={[s.summaryVal, { color: '#d97706' }]}>{products.filter(p => p.isActive !== false && (p.stock ?? 0) === 0 && p.type !== 'service').length}</Text>
              <Text style={s.summaryLabel}>Hết hàng</Text>
            </View>
          </View>

          {filtered.filter(p => p.type !== 'service' && !p.isTimeBased).length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <FontAwesome5 name="warehouse" size={36} color="#d1d5db" solid />
              <Text style={{ color: c.textMuted, marginTop: 12 }}>Không có sản phẩm</Text>
            </View>
          )}

          {filtered
            .filter(p => p.type !== 'service' && !p.isTimeBased)
            .sort((a, b) => {
              // Ưu tiên sắp hết lên đầu
              const aLow = isLow(a) ? 0 : 1
              const bLow = isLow(b) ? 0 : 1
              return aLow - bLow
            })
            .map(product => {
              const stock = product.stock ?? 0
              const minLevel = product.minStockLevel ?? 0
              const low = isLow(product)
              const empty = stock === 0
              const stockColor = empty ? '#dc2626' : low ? '#d97706' : '#16a34a'
              const stockBg    = empty ? '#fef2f2' : low ? '#fffbeb' : '#f0fdf4'
              const stockBorder= empty ? '#fca5a5' : low ? '#fcd34d' : '#86efac'

              return (
                <View key={product.id} style={[s.stockCard, low && s.stockCardLow]}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      {(empty || low) && (
                        <FontAwesome5 name="exclamation-triangle" size={11} color={empty ? '#dc2626' : '#d97706'} solid />
                      )}
                      <Text style={s.stockName} numberOfLines={1}>{product.name}</Text>
                    </View>
                    <Text style={s.stockMeta}>
                      {catName(product.categoryId) || 'Chưa phân loại'}
                      {product.code ? ` · ${product.code}` : ''}
                    </Text>
                    {minLevel > 0 && (
                      <Text style={{ color: c.textFaint, fontSize: 11, marginTop: 2 }}>
                        Tối thiểu: {minLevel} {product.unitOfMeasure}
                      </Text>
                    )}
                  </View>

                  {/* Stock badge */}
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <View style={[s.stockBadge, { backgroundColor: stockBg, borderColor: stockBorder }]}>
                      <Text style={[s.stockVal, { color: stockColor }]}>{stock}</Text>
                      <Text style={[s.stockUnit, { color: stockColor }]}>{product.unitOfMeasure || 'đv'}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity
                        style={[s.smallBtn, { backgroundColor: '#dcfce7' }]}
                        onPress={() => openStockIn(product)}>
                        <FontAwesome5 name="plus" size={10} color="#16a34a" solid />
                        <Text style={{ color: '#16a34a', fontSize: 11, fontWeight: '700' }}>Nhập</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.smallBtn, { backgroundColor: '#ede9fe' }]}
                        onPress={() => openAdjust(product)}>
                        <FontAwesome5 name="sliders-h" size={10} color="#7c3aed" solid />
                        <Text style={{ color: '#7c3aed', fontSize: 11, fontWeight: '700' }}>Sửa</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )
            })}
        </ScrollView>
      )}

      {/* ── Modal: Nhập hàng ── */}
      <Modal visible={stockModal} transparent animationType="slide" onRequestClose={() => setStockModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalBox}>
            <View style={s.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <FontAwesome5 name="truck-loading" size={16} color="#16a34a" solid />
                <Text style={s.modalTitle}>Nhập hàng</Text>
              </View>
              <TouchableOpacity onPress={() => setStockModal(false)}>
                <FontAwesome5 name="times" size={16} color={c.textMuted} solid />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Chọn sản phẩm */}
              <Text style={s.fieldLabel}>Sản phẩm *</Text>
              {stockForm.productId ? (
                <TouchableOpacity
                  style={[s.fieldInput, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }]}
                  onPress={() => setStockForm(f => ({ ...f, productId: '', productName: '' }))}>
                  <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{stockForm.productName}</Text>
                  <FontAwesome5 name="times-circle" size={14} color={c.textMuted} solid />
                </TouchableOpacity>
              ) : (
                <View style={{ marginBottom: 14 }}>
                  <View style={[s.fieldInput, { flexDirection: 'row', alignItems: 'center', paddingVertical: 0, paddingHorizontal: 10, marginBottom: 6 }]}>
                    <FontAwesome5 name="search" size={13} color={c.textMuted} style={{ marginRight: 8 }} />
                    <TextInput
                      style={{ flex: 1, color: c.text, fontSize: 14, paddingVertical: 10 }}
                      placeholder="Tìm tên sản phẩm..."
                      placeholderTextColor={c.textFaint ?? '#9ca3af'}
                      value={stockSearch}
                      onChangeText={setStockSearch}
                      autoCorrect={false}
                      autoCapitalize="none"
                    />
                    {stockSearch.length > 0 && (
                      <TouchableOpacity onPress={() => setStockSearch('')}>
                        <FontAwesome5 name="times-circle" size={13} color={c.textMuted} solid />
                      </TouchableOpacity>
                    )}
                  </View>
                  <ScrollView style={{ maxHeight: 180, borderWidth: 1, borderColor: c.border, borderRadius: 10 }} nestedScrollEnabled>
                    {products
                      .filter(p => p.isActive !== false && !p.isTimeBased)
                      .filter(p => !stockSearch.trim() || p.name.toLowerCase().includes(stockSearch.trim().toLowerCase()))
                      .slice(0, 50)
                      .map(p => (
                        <TouchableOpacity key={p.id}
                          style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: c.border }}
                          onPress={() => {
                            setStockForm(f => ({
                              ...f,
                              productId: p.id,
                              productName: p.name,
                              unitOfMeasure: p.unitOfMeasure ?? '',
                              // Auto-populate giá nhập nếu chưa nhập
                              unitPrice: f.unitPrice || String(p.price || ''),
                            }))
                            setStockSearch('')
                          }}>
                          <Text style={{ color: c.text, fontSize: 14 }}>{p.name}</Text>
                          <Text style={{ color: c.textMuted, fontSize: 11 }}>Tồn: {p.stock ?? 0} {p.unitOfMeasure}</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>
                    Số lượng nhập *
                    {stockForm.unitOfMeasure ? <Text style={{ color: c.textMuted, fontWeight: '400' }}>  ({stockForm.unitOfMeasure})</Text> : null}
                  </Text>
                  <View style={[s.fieldInput, { flexDirection: 'row', alignItems: 'center', paddingVertical: 0, paddingHorizontal: 12 }]}>
                    <TextInput
                      style={{ flex: 1, color: c.text, fontSize: 15, paddingVertical: 12 }}
                      placeholder="0"
                      placeholderTextColor="#9ca3af"
                      keyboardType="numeric"
                      value={stockForm.qty}
                      onChangeText={v => setStockForm(f => ({ ...f, qty: v.replace(/\D/g, '') }))}
                    />
                    {stockForm.unitOfMeasure ? (
                      <Text style={{ color: c.textMuted, fontSize: 13, marginLeft: 4 }}>{stockForm.unitOfMeasure}</Text>
                    ) : null}
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Giá nhập (đ)</Text>
                  <TextInput
                    style={s.fieldInput}
                    placeholder="0"
                    placeholderTextColor="#9ca3af"
                    keyboardType="numeric"
                    value={stockForm.unitPrice}
                    onChangeText={v => setStockForm(f => ({ ...f, unitPrice: v.replace(/\D/g, '') }))}
                  />
                </View>
              </View>

              <Text style={s.fieldLabel}>Nhà cung cấp</Text>
              <TextInput
                style={s.fieldInput}
                placeholder="VD: Công ty Bia Sài Gòn"
                placeholderTextColor="#9ca3af"
                value={stockForm.supplier}
                onChangeText={v => setStockForm(f => ({ ...f, supplier: v }))}
              />

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Số phiếu nhập</Text>
                  <TextInput
                    style={s.fieldInput}
                    placeholder="VD: PN2026001"
                    placeholderTextColor="#9ca3af"
                    value={stockForm.invoiceNumber}
                    onChangeText={v => setStockForm(f => ({ ...f, invoiceNumber: v }))}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Hạn sử dụng</Text>
                  <TextInput
                    style={s.fieldInput}
                    placeholder="DD/MM/YYYY"
                    placeholderTextColor="#9ca3af"
                    keyboardType="numbers-and-punctuation"
                    value={stockForm.expiredDate}
                    onChangeText={v => setStockForm(f => ({ ...f, expiredDate: v }))}
                  />
                </View>
              </View>

              <Text style={s.fieldLabel}>Ghi chú</Text>
              <TextInput
                style={[s.fieldInput, { height: 70, textAlignVertical: 'top' }]}
                placeholder="Ghi chú thêm..."
                placeholderTextColor="#9ca3af"
                multiline
                value={stockForm.note}
                onChangeText={v => setStockForm(f => ({ ...f, note: v }))}
              />

              {stockForm.productId && stockForm.qty && parseInt(stockForm.qty) > 0 && (
                <View style={s.importSummary}>
                  <Text style={{ color: '#16a34a', fontWeight: '700', fontSize: 13 }}>
                    Nhập: +{stockForm.qty} {products.find(p => p.id === stockForm.productId)?.unitOfMeasure ?? 'đv'}
                  </Text>
                  {stockForm.unitPrice && (
                    <Text style={{ color: '#16a34a', fontSize: 12 }}>
                      Thành tiền: {fmtVnd((parseInt(stockForm.qty) || 0) * (parseInt(stockForm.unitPrice) || 0))}
                    </Text>
                  )}
                </View>
              )}

              <View style={s.modalActions}>
                <TouchableOpacity
                  style={[s.btnConfirm, { backgroundColor: '#16a34a' }, saving && { opacity: 0.6 }]}
                  onPress={handleStockIn} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.btnConfirmText}>Xác nhận nhập hàng</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={s.btnCancel} onPress={() => setStockModal(false)}>
                  <Text style={s.btnCancelText}>Huỷ</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal: Điều chỉnh tồn kho ── */}
      <Modal visible={adjustModal} transparent animationType="fade" onRequestClose={() => setAdjustModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.modalBox, { maxHeight: 380 }]}>
            <View style={s.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <FontAwesome5 name="sliders-h" size={15} color="#7c3aed" solid />
                <Text style={s.modalTitle}>Điều chỉnh tồn kho</Text>
              </View>
              <TouchableOpacity onPress={() => setAdjustModal(false)}>
                <FontAwesome5 name="times" size={16} color={c.textMuted} solid />
              </TouchableOpacity>
            </View>
            <Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 14 }}>{adjustTarget?.name}</Text>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.fieldLabel}>Tồn hiện tại</Text>
                <TextInput
                  style={s.fieldInput}
                  keyboardType="numeric"
                  value={adjustQty}
                  onChangeText={v => setAdjustQty(v.replace(/\D/g, ''))}
                  autoFocus
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.fieldLabel}>Tồn tối thiểu</Text>
                <TextInput
                  style={s.fieldInput}
                  keyboardType="numeric"
                  value={adjustMin}
                  onChangeText={v => setAdjustMin(v.replace(/\D/g, ''))}
                />
              </View>
            </View>

            <View style={s.modalActions}>
              <TouchableOpacity
                style={[s.btnConfirm, saving && { opacity: 0.6 }]}
                onPress={handleAdjust} disabled={saving}>
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.btnConfirmText}>Lưu</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.btnCancel} onPress={() => setAdjustModal(false)}>
                <Text style={s.btnCancelText}>Huỷ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modal: Thêm / Sửa sản phẩm ── */}
      <Modal visible={editModal !== 'none'} transparent animationType="slide" onRequestClose={() => setEditModal('none')}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalBox}>
            <View style={s.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <FontAwesome5 name={editModal === 'add' ? 'plus-circle' : 'edit'} size={15} color="#7c3aed" solid />
                <Text style={s.modalTitle}>{editModal === 'add' ? 'Thêm sản phẩm' : 'Sửa sản phẩm'}</Text>
              </View>
              <TouchableOpacity onPress={() => setEditModal('none')}>
                <FontAwesome5 name="times" size={16} color={c.textMuted} solid />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={s.fieldLabel}>Tên sản phẩm *</Text>
              <TextInput
                style={s.fieldInput}
                placeholder="VD: Bia Tiger 333ml"
                placeholderTextColor="#9ca3af"
                value={form.name}
                onChangeText={v => setForm(f => ({ ...f, name: v }))}
                autoFocus={editModal === 'add'}
              />

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Giá nhập (đ)</Text>
                  <TextInput style={s.fieldInput} placeholder="0" placeholderTextColor="#9ca3af" keyboardType="numeric"
                    value={form.price} onChangeText={v => setForm(f => ({ ...f, price: v.replace(/\D/g, '') }))} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Giá bán (đ) *</Text>
                  <TextInput style={s.fieldInput} placeholder="0" placeholderTextColor="#9ca3af" keyboardType="numeric"
                    value={form.sellingPrice} onChangeText={v => setForm(f => ({ ...f, sellingPrice: v.replace(/\D/g, '') }))} />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Mã SP</Text>
                  <TextInput style={s.fieldInput} placeholder="VD: BIA001" placeholderTextColor="#9ca3af" autoCapitalize="characters"
                    value={form.code} onChangeText={v => setForm(f => ({ ...f, code: v }))} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Đơn vị tính</Text>
                  <TextInput style={s.fieldInput} placeholder="Lon, Chai, Ly..." placeholderTextColor="#9ca3af"
                    value={form.unitOfMeasure} onChangeText={v => setForm(f => ({ ...f, unitOfMeasure: v }))} />
                </View>
              </View>

              {editModal === 'edit' && (
                <>
                  <Text style={s.fieldLabel}>Tồn tối thiểu (cảnh báo)</Text>
                  <TextInput style={s.fieldInput} placeholder="0" placeholderTextColor="#9ca3af" keyboardType="numeric"
                    value={form.minStockLevel} onChangeText={v => setForm(f => ({ ...f, minStockLevel: v.replace(/\D/g, '') }))} />
                </>
              )}

              <Text style={s.fieldLabel}>Danh mục</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                style={{ marginBottom: 14 }} contentContainerStyle={{ gap: 8 }}>
                <TouchableOpacity style={[s.catBtn, !form.categoryId && s.catActive]}
                  onPress={() => setForm(f => ({ ...f, categoryId: '' }))}>
                  <Text style={[s.catBtnText, !form.categoryId && s.catActiveText]}>Chưa phân loại</Text>
                </TouchableOpacity>
                {categories.map(cat => (
                  <TouchableOpacity key={cat.id} style={[s.catBtn, form.categoryId === cat.id && s.catActive]}
                    onPress={() => setForm(f => ({ ...f, categoryId: cat.id }))}>
                    <Text style={[s.catBtnText, form.categoryId === cat.id && s.catActiveText]}>{cat.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {form.sellingPrice && form.price && parseInt(form.price) > 0 && (
                <View style={s.priceSummary}>
                  <Text style={{ color: '#6b7280', fontSize: 12 }}>Lợi nhuận:</Text>
                  <Text style={{ color: '#16a34a', fontWeight: '700', fontSize: 13 }}>
                    {fmtVnd((parseInt(form.sellingPrice) || 0) - (parseInt(form.price) || 0))}
                    {' '}({Math.round(((parseInt(form.sellingPrice) - parseInt(form.price)) / parseInt(form.price)) * 100)}%)
                  </Text>
                </View>
              )}

              <View style={s.modalActions}>
                <TouchableOpacity style={[s.btnConfirm, saving && { opacity: 0.6 }]} onPress={handleSaveProduct} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.btnConfirmText}>{editModal === 'add' ? 'Thêm sản phẩm' : 'Lưu thay đổi'}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={s.btnCancel} onPress={() => setEditModal('none')}>
                  <Text style={s.btnCancelText}>Huỷ</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

const makeStyles = (c: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },

  header: {
    backgroundColor: c.surface, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  headerTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
  headerSub:   { color: c.textMuted, fontSize: 11, marginTop: 1 },
  iconBtn: { width: 34, height: 34, borderRadius: 8, backgroundColor: c.elevated, alignItems: 'center', justifyContent: 'center' },

  tabBar: { flexDirection: 'row', backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#7c3aed' },
  tabBtnText: { color: c.textMuted, fontSize: 13 },
  badge: { backgroundColor: '#dc2626', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.input, borderRadius: 8, borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, paddingVertical: 7 },
  searchInput: { flex: 1, color: c.text, fontSize: 14, paddingVertical: 0 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#dc2626' },

  catStrip: { backgroundColor: c.surface, flexGrow: 0, borderBottomWidth: 1, borderBottomColor: c.border },
  catBtn: { backgroundColor: c.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  catBtnText: { color: c.textMuted, fontSize: 13 },
  catActive: { backgroundColor: '#7c3aed', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  catActiveText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // Summary cards
  summaryCard: { flex: 1, borderRadius: 10, padding: 12, borderWidth: 1, alignItems: 'center' },
  summaryVal:  { fontSize: 22, fontWeight: '800', marginBottom: 2 },
  summaryLabel:{ color: '#6b7280', fontSize: 12 },

  // Product card (list tab)
  productCard: { backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border, flexDirection: 'row', alignItems: 'center', gap: 12 },
  productCardInactive: { opacity: 0.5 },
  productName:  { color: c.text, fontWeight: '700', fontSize: 15, flex: 1 },
  productPrice: { color: '#7c3aed', fontWeight: '700', fontSize: 14, marginBottom: 2 },
  productMeta:  { color: c.textMuted, fontSize: 12 },
  badgeHidden:  { backgroundColor: '#fee2e2', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  badgeHiddenText: { color: '#dc2626', fontSize: 10, fontWeight: '700' },
  actionIconBtn: { width: 34, height: 34, borderRadius: 8, backgroundColor: c.elevated, alignItems: 'center', justifyContent: 'center' },

  // Stock card (stock tab)
  stockCard: { backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border, flexDirection: 'row', alignItems: 'center', gap: 12 },
  stockCardLow: { borderColor: '#fca5a5', borderWidth: 1.5 },
  stockName:    { color: c.text, fontWeight: '700', fontSize: 14, flex: 1 },
  stockMeta:    { color: c.textMuted, fontSize: 12, marginTop: 1 },
  stockBadge:   { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, alignItems: 'center', minWidth: 64 },
  stockVal:     { fontSize: 18, fontWeight: '800' },
  stockUnit:    { fontSize: 11, fontWeight: '600' },
  smallBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },

  emptyBtn: { marginTop: 16, backgroundColor: '#7c3aed', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },

  // Import summary
  importSummary: { backgroundColor: '#f0fdf4', borderRadius: 8, borderWidth: 1, borderColor: '#86efac', padding: 10, marginBottom: 14, gap: 2 },

  // Price summary
  priceSummary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f0fdf4', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 14, borderWidth: 1, borderColor: '#86efac' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '92%', borderTopWidth: 1, borderTopColor: c.border },
  modalHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle:   { color: c.text, fontSize: 17, fontWeight: '700' },

  fieldLabel: { color: c.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  fieldInput: { backgroundColor: c.input, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 15, marginBottom: 14 },

  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4, paddingBottom: 8 },
  btnConfirm:   { flex: 1, backgroundColor: '#7c3aed', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  btnConfirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnCancel:    { flex: 1, backgroundColor: c.elevated, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  btnCancelText:{ color: c.textSub, fontWeight: '600', fontSize: 15 },
})

