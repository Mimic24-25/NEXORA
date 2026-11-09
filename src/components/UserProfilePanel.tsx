import { MessageSquare, ShieldOff, UserPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { addContact, blockUser, removeContact, unblockUser } from '../services/chatService'
import { loadUserProfile } from '../services/conversationService'

interface UserProfileData {
  id: string
  name: string
  username: string
  bio: string
  status: string
  lastSeen: string | null
  avatarUrl: string | null
  phone: string | null
  createdAt: string
  isContact: boolean
  isBlocked: boolean
}

interface UserProfilePanelProps {
  userId: string
  onClose: () => void
  onStartChat?: (userId: string) => void
}

export function UserProfilePanel({ userId, onClose, onStartChat }: UserProfilePanelProps) {
  const [profile, setProfile] = useState<UserProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    void loadUserProfile(userId)
      .then((data) => setProfile(data as unknown as UserProfileData))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Ошибка загрузки профиля'))
      .finally(() => setLoading(false))
  }, [userId])

  const handleAddContact = async () => {
    setActionLoading(true)
    try {
      await addContact(userId)
      setProfile((prev) => (prev ? { ...prev, isContact: true } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setActionLoading(false)
    }
  }

  const handleRemoveContact = async () => {
    setActionLoading(true)
    try {
      await removeContact(userId)
      setProfile((prev) => (prev ? { ...prev, isContact: false } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setActionLoading(false)
    }
  }

  const handleBlock = async () => {
    setActionLoading(true)
    try {
      await blockUser(userId)
      setProfile((prev) => (prev ? { ...prev, isBlocked: true } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setActionLoading(false)
    }
  }

  const handleUnblock = async () => {
    setActionLoading(true)
    try {
      await unblockUser(userId)
      setProfile((prev) => (prev ? { ...prev, isBlocked: false } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-slate-400">
        Загрузка профиля…
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <div className="text-sm text-red-300">{error ?? 'Профиль не найден'}</div>
        <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm">
          Закрыть
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <h2 className="text-lg font-semibold text-white">Профиль</h2>
        <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-white/5 hover:text-white">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {/* Avatar + name */}
        <div className="flex flex-col items-center gap-3 py-4">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt={profile.name} className="h-24 w-24 rounded-full object-cover ring-2 ring-cyan-500/30" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-cyan-500/20 text-3xl text-cyan-200">
              {profile.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="text-center">
            <div className="text-xl font-semibold text-white">{profile.name}</div>
            <div className="text-sm text-cyan-300">@{profile.username}</div>
            <div className="mt-1 text-xs text-slate-400">
              {profile.status === 'online'
                ? 'В сети'
                : profile.lastSeen
                  ? `Был(а) ${new Date(profile.lastSeen).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}`
                  : 'Не в сети'}
            </div>
          </div>
        </div>

        {/* Bio */}
        {profile.bio ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-400">О себе</div>
            <p className="mt-1 text-sm text-slate-300">{profile.bio}</p>
          </div>
        ) : null}

        {/* Phone */}
        {profile.phone ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Телефон</div>
            <p className="mt-1 text-sm text-slate-300">{profile.phone}</p>
          </div>
        ) : null}

        {/* Registered */}
        <div className="text-center text-xs text-slate-500">
          На NEXORA с {new Date(profile.createdAt).toLocaleDateString('ru-RU')}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          {onStartChat && !profile.isBlocked ? (
            <button
              onClick={() => onStartChat(userId)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950 hover:bg-cyan-400"
            >
              <MessageSquare size={16} />
              Написать сообщение
            </button>
          ) : null}

          {!profile.isContact && !profile.isBlocked ? (
            <button
              onClick={() => void handleAddContact()}
              disabled={actionLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-200 hover:bg-cyan-500/15 disabled:opacity-50"
            >
              <UserPlus size={16} />
              Добавить в контакты
            </button>
          ) : null}

          {profile.isContact ? (
            <button
              onClick={() => void handleRemoveContact()}
              disabled={actionLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-50"
            >
              Убрать из контактов
            </button>
          ) : null}

          {profile.isBlocked ? (
            <button
              onClick={() => void handleUnblock()}
              disabled={actionLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-50"
            >
              <ShieldOff size={16} />
              Разблокировать
            </button>
          ) : (
            <button
              onClick={() => void handleBlock()}
              disabled={actionLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200 hover:bg-red-500/15 disabled:opacity-50"
            >
              <ShieldOff size={16} />
              Заблокировать
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
