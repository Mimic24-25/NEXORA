import { ImagePlus, Shield, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  addGroupMembers,
  searchProfiles,
} from '../services/chatService'
import {
  loadGroupInfo,
  updateGroupSettings,
  uploadGroupAvatar,
  deleteGroupAvatar,
} from '../services/conversationService'
import {
  leaveGroup,
  promoteGroupMember,
  removeGroupMember,
  deleteGroupConversation,
} from '../services/chatService'
import type { ChatProfile } from '../services/chatService'

interface GroupMember {
  userId: string
  role: 'owner' | 'admin' | 'member'
  name: string
  username: string
  avatarUrl: string | null
  status: string
  lastSeen: string | null
}

interface GroupInfo {
  conversation: {
    id: string
    title: string
    description: string
    avatarUrl: string | null
    createdAt: string
    createdBy: string
    canWrite: boolean
    canSendFiles: boolean
    canSendMedia: boolean
  }
  members: GroupMember[]
  creator: { id: string; name: string; username: string; avatarUrl: string | null } | null
}

interface GroupProfilePanelProps {
  conversationId: string
  currentUserId: string
  onClose: () => void
  onLeftGroup?: () => void
  onGroupUpdated?: () => void
}

export function GroupProfilePanel({ conversationId, currentUserId, onClose, onLeftGroup, onGroupUpdated }: GroupProfilePanelProps) {
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddMember, setShowAddMember] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ChatProfile[]>([])
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([])
  const [addingMembers, setAddingMembers] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const groupAvatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState(false)

  useEffect(() => {
    void loadGroupInfo(conversationId)
      .then((info) => {
        const typed = info as unknown as GroupInfo
        setGroupInfo(typed)
        setNewTitle(typed.conversation.title)
        setNewDescription(typed.conversation.description ?? '')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [conversationId])

  // Обновляем список участников и их онлайн-статусы, пока открыта карточка группы.
  useEffect(() => {
    let active = true
    const refreshPresence = async () => {
      try {
        const info = await loadGroupInfo(conversationId)
        if (active) setGroupInfo(info as unknown as GroupInfo)
      } catch {
        // Не скрываем уже загруженную информацию из-за временной сетевой ошибки.
      }
    }
    const intervalId = window.setInterval(() => void refreshPresence(), 15_000)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [conversationId])

  const myRole = groupInfo?.members.find((m) => m.userId === currentUserId)?.role
  const isOwner = myRole === 'owner'
  const isAdmin = myRole === 'owner' || myRole === 'admin'

  const handleUpdateGroup = async (updates: Record<string, unknown>) => {
    try {
      await updateGroupSettings(conversationId, updates)
      const info = await loadGroupInfo(conversationId)
      setGroupInfo(info as unknown as GroupInfo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления')
    }
  }

  const handleTogglePermission = (key: 'canWrite' | 'canSendFiles' | 'canSendMedia') => {
    if (!groupInfo || !isAdmin) return
    void handleUpdateGroup({ [key]: !groupInfo.conversation[key] })
  }

  const handleSaveTitle = () => {
    if (!newTitle.trim()) return
    void handleUpdateGroup({ title: newTitle.trim() })
    setEditingTitle(false)
  }

  const handleSaveDescription = () => {
    void handleUpdateGroup({ description: newDescription })
  }

  const handlePromote = (userId: string, role: 'admin' | 'member') => {
    void promoteGroupMember(conversationId, userId, role).then(() => {
      void loadGroupInfo(conversationId).then((info) => setGroupInfo(info as unknown as GroupInfo))
    })
  }

  const handleRemoveMember = (userId: string) => {
    void removeGroupMember(conversationId, userId).then(() => {
      void loadGroupInfo(conversationId).then((info) => setGroupInfo(info as unknown as GroupInfo))
    })
  }

  const handleLeave = () => {
    void leaveGroup(conversationId).then(() => onLeftGroup?.()).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : 'Не удалось покинуть группу'))
  }

  const handleGroupAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setAvatarBusy(true)
    try {
      await uploadGroupAvatar(conversationId, file)
      const info = await loadGroupInfo(conversationId)
      setGroupInfo(info as unknown as GroupInfo)
      onGroupUpdated?.()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить аватар группы')
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleDeleteGroupAvatar = async () => {
    setAvatarBusy(true)
    try {
      await deleteGroupAvatar(conversationId)
      const info = await loadGroupInfo(conversationId)
      setGroupInfo(info as unknown as GroupInfo)
      onGroupUpdated?.()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить аватар группы')
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleDeleteGroup = async () => {
    if (!window.confirm('Удалить группу для всех участников? История и сообщения группы будут удалены без возможности восстановления.')) return
    setDeletingGroup(true)
    try {
      await deleteGroupConversation(conversationId)
      onLeftGroup?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить группу')
      setDeletingGroup(false)
    }
  }

  const handleSearchMembers = async () => {
    try {
      const results = await searchProfiles(memberSearch)
      setSearchResults(results.filter((r) => !groupInfo?.members.some((m) => m.userId === r.id)))
    } catch {
      setSearchResults([])
    }
  }

  const handleAddMembers = async () => {
    if (!selectedToAdd.length) return
    setAddingMembers(true)
    try {
      await addGroupMembers(conversationId, selectedToAdd)
      const info = await loadGroupInfo(conversationId)
      setGroupInfo(info as unknown as GroupInfo)
      setShowAddMember(false)
      setSelectedToAdd([])
      setMemberSearch('')
      setSearchResults([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка добавления')
    } finally {
      setAddingMembers(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-slate-400">
        Загрузка информации о группе…
      </div>
    )
  }

  if (error || !groupInfo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <div className="text-sm text-red-300">{error ?? 'Группа не найдена'}</div>
        <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm">
          Закрыть
        </button>
      </div>
    )
  }

  const { conversation, members, creator } = groupInfo
  const onlineMembersCount = members.filter((member) => member.status === 'online').length

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <h2 className="text-lg font-semibold text-white">Информация о группе</h2>
        <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-white/5 hover:text-white">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {/* Group avatar + name */}
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cyan-500/20 text-2xl text-cyan-200">
            {conversation.avatarUrl ? <img src={conversation.avatarUrl} alt={conversation.title} className="h-full w-full object-cover" /> : conversation.title.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            {editingTitle && isAdmin ? (
              <div className="flex gap-2">
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-white"
                />
                <button onClick={handleSaveTitle} className="rounded-lg bg-cyan-500 px-3 py-1 text-xs font-medium text-slate-950">
                  ОК
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-white">{conversation.title}</h3>
                {isAdmin ? (
                  <button onClick={() => setEditingTitle(true)} className="text-xs text-cyan-400 hover:underline">
                    Изменить
                  </button>
                ) : null}
              </div>
            )}
            <div className="text-sm text-slate-400">{members.length} участников · {onlineMembersCount} в сети</div>
            {isAdmin ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <input ref={groupAvatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => void handleGroupAvatarChange(event)} />
                <button type="button" disabled={avatarBusy} onClick={() => groupAvatarInputRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-cyan-300 disabled:opacity-50">
                  <ImagePlus size={14} /> {avatarBusy ? 'Подождите…' : 'Загрузить аватар'}
                </button>
                {conversation.avatarUrl ? <button type="button" disabled={avatarBusy} onClick={() => void handleDeleteGroupAvatar()} className="rounded-lg border border-red-500/20 px-2 py-1 text-xs text-red-300 disabled:opacity-50">Удалить аватар</button> : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Описание</label>
          {isAdmin ? (
            <div className="mt-1 space-y-2">
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                placeholder="Добавьте описание группы…"
              />
              <button onClick={handleSaveDescription} className="rounded-lg bg-cyan-500 px-3 py-1 text-xs font-medium text-slate-950">
                Сохранить
              </button>
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-300">{conversation.description || 'Нет описания'}</p>
          )}
        </div>

        {/* Group info */}
        <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Информация</div>
          <div className="text-sm text-slate-300">
            Создана: {new Date(conversation.createdAt).toLocaleDateString('ru-RU')}
          </div>
          {creator ? (
            <div className="text-sm text-slate-300">
              Создатель: <span className="text-cyan-300">@{creator.username}</span>
            </div>
          ) : null}
        </div>

        {/* Permissions (admin only) */}
        {isAdmin ? (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Права участников</div>
            <div className="flex items-center justify-between text-sm text-slate-300">
              <span>Писать могут все</span>
              <button
                onClick={() => handleTogglePermission('canWrite')}
                className={`relative h-6 w-11 rounded-full transition ${conversation.canWrite ? 'bg-cyan-500' : 'bg-slate-600'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${conversation.canWrite ? 'left-5.5' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-300">
              <span>Отправлять файлы</span>
              <button
                onClick={() => handleTogglePermission('canSendFiles')}
                className={`relative h-6 w-11 rounded-full transition ${conversation.canSendFiles ? 'bg-cyan-500' : 'bg-slate-600'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${conversation.canSendFiles ? 'left-5.5' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-300">
              <span>Отправлять медиа</span>
              <button
                onClick={() => handleTogglePermission('canSendMedia')}
                className={`relative h-6 w-11 rounded-full transition ${conversation.canSendMedia ? 'bg-cyan-500' : 'bg-slate-600'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${conversation.canSendMedia ? 'left-5.5' : 'left-0.5'}`} />
              </button>
            </div>
          </div>
        ) : null}

        {/* Members */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Участники ({members.length})
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {onlineMembersCount} в сети
              </div>
            </div>
            {isAdmin ? (
              <button
                onClick={() => setShowAddMember(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/15 px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-500/25"
              >
                <UserPlus size={12} />
                Добавить
              </button>
            ) : null}
          </div>

          <div className="space-y-1">
            {members.map((member) => (
              <div key={member.userId} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5">
                {member.avatarUrl ? (
                  <img src={member.avatarUrl} alt={member.name} className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/20 text-sm text-cyan-200">
                    {member.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-white">
                    {member.name}
                    {member.role === 'owner' ? <ShieldCheck size={14} className="text-yellow-400" /> : null}
                    {member.role === 'admin' ? <Shield size={14} className="text-cyan-400" /> : null}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <span className={`h-1.5 w-1.5 rounded-full ${member.status === 'online' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                    @{member.username}
                  </div>
                </div>
                {isAdmin && member.userId !== currentUserId ? (
                  <div className="flex gap-1">
                    {member.role === 'member' ? (
                      <button
                        onClick={() => handlePromote(member.userId, 'admin')}
                        className="rounded-lg px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-500/15"
                        title="Сделать админом"
                      >
                        Админ
                      </button>
                    ) : member.role === 'admin' && isOwner ? (
                      <button
                        onClick={() => handlePromote(member.userId, 'member')}
                        className="rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-white/5"
                        title="Снять админа"
                      >
                        Снять
                      </button>
                    ) : null}
                    <button
                      onClick={() => handleRemoveMember(member.userId)}
                      className="rounded-lg p-1 text-red-300 hover:bg-red-500/15"
                      title="Удалить из группы"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Leave group (not owner) */}
        {!isOwner ? (
          <button
            onClick={handleLeave}
            className="w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-200 hover:bg-red-500/15"
          >
            Покинуть группу
          </button>
        ) : (
          <button
            onClick={() => void handleDeleteGroup()}
            disabled={deletingGroup}
            className="w-full rounded-xl border border-red-500/40 bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-200 hover:bg-red-500/25 disabled:opacity-50"
          >
            {deletingGroup ? 'Удаляем группу…' : 'Удалить группу для всех'}
          </button>
        )}
      </div>

      {/* Add member modal */}
      {showAddMember ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Добавить участников</h3>
              <button onClick={() => setShowAddMember(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleSearchMembers()}
                placeholder="Поиск по имени или @username"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500"
              />
              <button onClick={() => void handleSearchMembers()} className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-medium text-slate-950">
                Найти
              </button>
            </div>
            <div className="mt-3 max-h-48 space-y-1 overflow-y-auto">
              {searchResults.map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => setSelectedToAdd((prev) =>
                    prev.includes(profile.id) ? prev.filter((id) => id !== profile.id) : [...prev, profile.id]
                  )}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${
                    selectedToAdd.includes(profile.id) ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/20 text-xs text-cyan-200">
                    {profile.name.slice(0, 1).toUpperCase()}
                  </div>
                  <span>{profile.name}</span>
                  <span className="text-xs text-slate-500">@{profile.username}</span>
                </button>
              ))}
              {searchResults.length === 0 && memberSearch ? (
                <div className="py-4 text-center text-sm text-slate-500">Никого не найдено</div>
              ) : null}
            </div>
            {selectedToAdd.length > 0 ? (
              <button
                onClick={() => void handleAddMembers()}
                disabled={addingMembers}
                className="mt-3 w-full rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
              >
                {addingMembers ? 'Добавляем…' : `Добавить (${selectedToAdd.length})`}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
