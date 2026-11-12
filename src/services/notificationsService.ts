import { supabase } from '../lib/supabase'

const requireClient = () => {
  if (!supabase) {
    throw new Error('Подключение к Supabase не настроено.')
  }
  return supabase
}

export interface NotificationItem {
  id: string
  kind: 'message' | 'call' | 'group' | 'system'
  title: string
  body: string
  payload: Record<string, unknown>
  isRead: boolean
  createdAt: string
}

/** Загрузить уведомления пользователя. */
export const loadNotifications = async (limit: number = 50): Promise<NotificationItem[]> => {
  const client = requireClient()
  const { data, error } = await client.rpc('nexora_get_notifications', { p_limit: limit })
  if (error) throw error
  return (data ?? []).map((row: {
    id: string
    kind: string
    title: string
    body: string
    payload: Record<string, unknown>
    is_read: boolean
    created_at: string
  }) => ({
    id: row.id,
    kind: row.kind as NotificationItem['kind'],
    title: row.title,
    body: row.body,
    payload: row.payload ?? {},
    isRead: row.is_read,
    createdAt: row.created_at,
  }))
}

/** Отметить уведомление прочитанным. */
export const markNotificationRead = async (notificationId: string): Promise<void> => {
  const client = requireClient()
  const { error } = await client.rpc('nexora_mark_notification_read', {
    p_notification_id: notificationId,
  })
  if (error) throw error
}

/** Отметить все уведомления прочитанными. */
export const markAllNotificationsRead = async (): Promise<void> => {
  const client = requireClient()
  const { error } = await client.rpc('nexora_mark_all_notifications_read')
  if (error) throw error
}

/** Удалить уведомление. */
export const deleteNotification = async (notificationId: string): Promise<void> => {
  const client = requireClient()
  const { error } = await client.rpc('nexora_delete_notification', {
    p_notification_id: notificationId,
  })
  if (error) throw error
}

/** Счётчик непрочитанных уведомлений. */
export const getUnreadNotificationCount = async (): Promise<number> => {
  const client = requireClient()
  const { data, error } = await client.rpc('nexora_unread_notification_count')
  if (error) return 0
  return data as number
}

/**
 * Загрузить счётчик непрочитанных сообщений для всех чатов.
 * Использует message_reads для определения прочитанного.
 */
export const loadUnreadCounts = async (conversationIds: string[]): Promise<Map<string, number>> => {
  if (!conversationIds.length) return new Map()
  const client = requireClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return new Map()

  const map = new Map<string, number>()

  for (const convId of conversationIds) {
    // Последние сообщения в чате
    const { data: msgs } = await client
      .from('messages')
      .select('id')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(500)

    if (!msgs?.length) continue

    const msgIds = msgs.map((m: { id: string }) => m.id)

    // Прочитанные текущим пользователем
    const { data: reads } = await client
      .from('message_reads')
      .select('message_id')
      .eq('user_id', user.id)
      .in('message_id', msgIds)

    const readIds = new Set((reads ?? []).map((r: { message_id: string }) => r.message_id))

    // Считаем непрочитанные (сообщения от других)
    const { data: otherMsgs } = await client
      .from('messages')
      .select('id,sender_id')
      .eq('conversation_id', convId)
      .neq('sender_id', user.id)
      .order('created_at', { ascending: false })

    let count = 0
    for (const m of (otherMsgs ?? [])) {
      if (m.sender_id !== user.id && !readIds.has(m.id)) {
        count++
      } else {
        break // считаем только подряд идущие непрочитанные от конца
      }
    }

    map.set(convId, count)
  }

  return map
}

/**
 * Подписка на новые уведомления через Realtime.
 */
export const subscribeToNotifications = async (
  handlers: {
    onInsert: (notification: NotificationItem) => void
    onDelete?: (notificationId: string) => void
  },
): Promise<() => void> => {
  const client = requireClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error) throw error
  if (!user) return () => {}

  const channel = client
    .channel(`nexora-notifications-${user.id}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      },
      (payload) => {
        const row = payload.new as {
          id: string; user_id: string; kind: string; title: string;
          body: string; payload: Record<string, unknown>; created_at: string;
        }
        if (row.user_id !== user.id) return
        handlers.onInsert({
          id: row.id,
          kind: row.kind as NotificationItem['kind'],
          title: row.title,
          body: row.body,
          payload: row.payload ?? {},
          isRead: false,
          createdAt: row.created_at,
        })
      },
    )
    .subscribe()

  return () => {
    void client.removeChannel(channel)
  }
}

/**
 * Воспроизвести звук уведомления.
 */
export const playNotificationSound = (): void => {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(800, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  } catch {
    // Audio API недоступен — молча игнорируем
  }
}
