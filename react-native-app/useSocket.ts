import { useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getServerUrl } from './api'

const WS_PORT = 30000
const TENANT_ID = 'kara'

export type SocketEvent = {
  event: string
  id?: string
  status?: string
  roomId?: string
  code?: string
  [key: string]: any
}

/**
 * Hook kết nối WebSocket tới ws.js và tự reconnect khi mất kết nối.
 * @param onMessage   callback nhận event khi có update
 * @param enabled     có kết nối không (default true)
 */
export function useSocket(onMessage: (msg: SocketEvent) => void, enabled = true) {
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  // Giữ reference mới nhất của callback mà không cần recreate effect
  const cbRef = useRef(onMessage)
  cbRef.current = onMessage

  useEffect(() => {
    mountedRef.current = true

    async function connect() {
      if (!mountedRef.current || !enabled) return

      const userId = (await AsyncStorage.getItem('kara_user_id')) ?? ''

      // Lấy server URL từ AsyncStorage (cùng nguồn với api.ts)
      const serverUrl = await getServerUrl()
      const wsHost = serverUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      const wsProto = serverUrl.startsWith('https') ? 'wss' : 'ws'
      const wsUrl = `${wsProto}://${wsHost}:${WS_PORT}`

      let ws: WebSocket
      try {
        ws = new WebSocket(wsUrl)
      } catch {
        // URL không hợp lệ, thử lại sau
        timerRef.current = setTimeout(connect, 5000)
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            action: 'subscribe',
            filter: { userId, tenantId: TENANT_ID },
          })
        )
      }

      ws.onmessage = (e) => {
        try {
          const data: SocketEvent = JSON.parse(e.data as string)
          // Bỏ qua ack subscribe
          if ((data as any).action === 'subscribe_success') return
          cbRef.current(data)
        } catch {}
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        timerRef.current = setTimeout(connect, 5000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    if (enabled) connect()

    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [enabled])
}
