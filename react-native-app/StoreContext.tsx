import React, { createContext, useState, useEffect, ReactNode } from 'react'
import * as api from './api'

interface Store {
  id: string
  name: string
  code?: string
  address?: string
  phone?: string
  type?: string
}

interface StoreContextValue {
  selectedStore: Store | null
  stores: Store[]
  loading: boolean
  selectStore: (store: Store) => Promise<void>
  clearStore: () => Promise<void>
  refresh: () => Promise<void>
}

export const StoreContext = createContext<StoreContextValue | undefined>(undefined)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [selectedStore, setSelectedStore] = useState<Store | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)

  // Load stores + previously selected store on mount
  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true)
        const [storeList, prevStore] = await Promise.all([
          api.getStores(),
          api.getSelectedStore(),
        ])
        setStores(storeList)
        if (prevStore) {
          setSelectedStore(prevStore as any)
        }
      } catch (e) {
        console.error('[StoreContext] Error loading stores:', e)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  const selectStore = async (store: Store) => {
    setSelectedStore(store)
    await api.saveSelectedStore(store.id, store.name)
  }

  const clearStore = async () => {
    setSelectedStore(null)
    await api.clearSelectedStore()
  }

  const refresh = async () => {
    try {
      setLoading(true)
      const storeList = await api.getStores()
      setStores(storeList)
    } catch (e) {
      console.error('[StoreContext] Error refreshing stores:', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <StoreContext.Provider value={{ selectedStore, stores, loading, selectStore, clearStore, refresh }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore(): StoreContextValue {
  const ctx = React.useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
