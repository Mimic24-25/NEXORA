import { Bell, BellOff, CheckCheck, Phone, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  deleteNotification,
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationsService'
import type { NotificationItem } from '../services/notificationsService'

interface NotificationPanelProps {
  onClose: () => void
  onSelectConversation?: (conversationId: string) => void
}

const kindIcon = (kind: NotificationItem['kind']) => {
  switch (kind) {
    case 'call': return <Phone size={14} />
    case 'group': return <Users size={14} />
    default: return <Bell size={14} />
  }
}

const formatTime = (date: string) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(date))

export function NotificationPanel({ onClose, onSelectConversation }: NotificationPanelProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadNotifications()
      .then(setNotifications)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handleMarkRead = async (id: string) => {
    await markNotificationRead(id).catch(() => {})
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
  }

  const handleMarkAll = async () => {
    await markAllNotificationsRead().catch(() => {})
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
  }

  const handleDelete = async (id: string) => {
    await deleteNotification(id).catch(() => {})
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }

  const handleClick = (n: NotificationItem) => {
    if (!n.isRead) void handleMarkRead(n.id)
    const convId = n.payload?.conversationId as string | undefined
    if (convId && onSelectConversation) {
      onSelectConversation(convId)
      onClose()
    }
  }

  const unreadCount = notifications.filter((n) => !n.isRead).length

  return (
    <div
      ref={ref}
      className="fixed right-4 top-16 z-50 w-80 max-h-[70vh] overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-black/50"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Bell size={16} className="text-cyan-300" />
          Уведомления
          {unreadCount > 0 ? (
            <span className="rounded-full bg-cyan-500 px-2 py-0.5 text-xs text-slate-950">{unreadCount}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 ? (
            <button
              onClick={() => void handleMarkAll()}
              className="rounded-full p-1.5 text-slate-400 hover:bg-white/5 hover:text-cyan-300"
              title="Прочитать все"
            >
              <CheckCheck size={16} />
            </button>
          ) : null}
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-white/5 hover:text-white">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="max-h-[60vh] overflow-y-auto">
        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Загрузка…</div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-slate-500">
            <BellOff size={32} className="opacity-30" />
            <div className="text-sm">Нет уведомлений</div>
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => handleClick(n)}
              className={`flex cursor-pointer items-start gap-3 border-b border-white/5 px-4 py-3 transition hover:bg-white/5 ${
                n.isRead ? 'opacity-60' : ''
              }`}
            >
              <div className={`mt-0.5 rounded-full p-1.5 ${
                n.kind === 'call' ? 'bg-emerald-500/15 text-emerald-300' :
                n.kind === 'group' ? 'bg-purple-500/15 text-purple-300' :
                'bg-cyan-500/15 text-cyan-300'
              }`}>
                {kindIcon(n.kind)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white">{n.title}</div>
                <div className="mt-0.5 text-xs text-slate-400 line-clamp-2">{n.body}</div>
                <div className="mt-1 text-xs text-slate-500">{formatTime(n.createdAt)}</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); void handleDelete(n.id) }}
                className="rounded-full p-1 text-slate-500 hover:bg-white/5 hover:text-red-300"
                title="Удалить"
              >
                <X size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
