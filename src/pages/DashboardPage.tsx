import {
  ArrowUpRight,
  BellRing,
  Check,
  CheckCheck,
  Copy,
  Edit2,
  FileText,
  Forward,
  Info,
  Mic,
  MicOff,
  MoreVertical,
  Pause,
  Phone,
  PhoneOff,
  Pin,
  Play,
  Plus,
  Reply,
  Search,
  Send,
  Shield,
  ShieldOff,
  Trash2,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../contexts/AuthContext'
import { isSupabaseConfigured } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import {
  acceptIncomingCall,
  loadCallHistory,
  rejectIncomingCall,
  startOutgoingCall,
  subscribeIncomingCalls,
} from '../services/callsService'
import type { ActiveCallSession, CallMode, CallStatus, IncomingCallInfo } from '../services/callsService'
import {
  addContact,
  addReaction,
  blockUser,
  createDirectConversation,
  createGroupConversation,
  deleteMessage,
  editMessage,
  forwardMessage,
  getBlockedUsers,
  getContacts,
  matchPhoneContacts,
  getFileUrl,
  getMessageReadStatuses,
  getMessageReactions,
  getMessageReactionsBatch,
  loadConversations,
  loadMessages,
  markMessageAsRead,
  removeContact,
  removeReaction,
  sendMessage,
  startTyping,
  stopTyping,
  searchMessages,
  searchProfiles,
  subscribeToConversationMessages,
  subscribeToTyping,
  unblockUser,
  updateOnlineStatus,
} from '../services/chatService'
import type { ChatConversation, ChatMessage, ChatProfile, MessageReaction } from '../services/chatService'
import {
  updateConversationSettings,
  loadConversationSettings,
  uploadAvatar,
  deleteAvatar,
  loadUserProfile,
  deleteChatForMe,
  clearConversationHistory,
} from '../services/conversationService'
import {
  getUnreadNotificationCount,
  loadUnreadCounts,
  subscribeToNotifications,
  playNotificationSound,
} from '../services/notificationsService'
import {
  loadUserSettings,
  updateUserSettings,
} from '../services/settingsService'
import {
  GroupProfilePanel } from '../components/GroupProfilePanel'
import { UserProfilePanel } from '../components/UserProfilePanel'
import { ChatContextMenu } from '../components/ChatContextMenu'
import { NotificationPanel } from '../components/NotificationPanel'
import { VideoMessageRecorder } from '../components/VideoMessageRecorder'
import type { AppView } from '../components/AppShell'
import type { ChangeEvent } from 'react'
import { readVCardFile } from '../services/phoneContactsService'

const formatMessageTime = (date: string) =>
  new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(date))

const formatConversationTime = (date: string) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date))

const getErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  if (/nexora_(get_profiles|latest_messages|search_profiles|create_direct_conversation)/i.test(message)) {
    return 'Не найдены функции чатов в Supabase. Выполните миграцию 003_chat_profiles_and_message_deletion.sql в SQL Editor.'
  }
  if (/nexora_(delete_group|match_phone_contacts|update_group_settings)/i.test(message)) {
    return 'Функции новых возможностей ещё не установлены в Supabase. Выполните миграцию 008_contacts_group_delete_and_avatars.sql в SQL Editor.'
  }
  if (/row-level security|permission denied|not allowed/i.test(message)) {
    return 'Supabase отклонил действие по правилам доступа. Проверьте применение миграций и членство в переписке.'
  }
  if (/fetch|network/i.test(message)) {
    return 'Не удалось подключиться к Supabase. Проверьте подключение к интернету.'
  }
  return message || 'Не удалось выполнить запрос к Supabase.'
}

const mergeMessages = (previous: ChatMessage[], incoming: ChatMessage[]) => {
  const messages = new Map(previous.map((message) => [message.id, message]))
  incoming.forEach((message) => messages.set(message.id, message))
  return [...messages.values()].sort((first, second) =>
    first.createdAt.localeCompare(second.createdAt),
  )
}

// Имя файла из signed URL вида .../nexora-media/<user>/<chat>/<timestamp>_<name>
const fileNameFromUrl = (url: string): string => {
  try {
    const path = new URL(url, window.location.origin).pathname
    const lastSegment = decodeURIComponent(path.split('/').pop() ?? '')
    return lastSegment.replace(/^\d+_/, '').replace(/\.[^.]*$/, '') || 'Файл'
  } catch {
    return 'Файл'
  }
}

// Путь в хранилище из signed URL (для обновления истёкшей ссылки).
const storagePathFromSignedUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    const marker = '/object/sign/nexora-media/'
    const index = parsed.pathname.indexOf(marker)
    if (index === -1) return null
    return decodeURIComponent(parsed.pathname.slice(index + marker.length))
  } catch {
    return null
  }
}

// Понятная диагностика ошибок воспроизведения вместо общего сообщения.
const describeAudioError = (audio: HTMLAudioElement, error?: unknown): string => {
  const errorName = error instanceof DOMException ? error.name : ''
  if (errorName === 'NotSupportedError' || audio.error?.code === 4) {
    return 'Браузер не поддерживает формат этой записи (например, webm в Safari). Новые голосовые сохраняются в mp4.'
  }
  const code = audio.error?.code
  if (code === 3) return 'Не удалось декодировать аудио — запись повреждена или формат не поддерживается.'
  if (code === 2) return 'Не удалось скачать запись — проверьте сеть или обновите страницу (ссылка могла истечь).'
  if (code === 1) return 'Воспроизведение прервано.'
  return 'Не удалось воспроизвести запись.'
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { user, logout, updateProfile, deleteAccount } = useAuth()
  const [activeView, setActiveView] = useState<AppView>('chats')
  const [profileName, setProfileName] = useState('')
  const [profileUsername, setProfileUsername] = useState('')
  const [profileBio, setProfileBio] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSaving, setProfileSaving] = useState(false)
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [chatSearch, setChatSearch] = useState('')
  const [peopleSearch, setPeopleSearch] = useState('')
  const [people, setPeople] = useState<ChatProfile[]>([])
  const [peopleLoading, setPeopleLoading] = useState(false)
  const [peopleError, setPeopleError] = useState<string | null>(null)
  const [chatsLoading, setChatsLoading] = useState(true)
  const [chatsError, setChatsError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [messageReloadToken, setMessageReloadToken] = useState(0)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [olderMessagesLoading, setOlderMessagesLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [creatingChatId, setCreatingChatId] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState('CONNECTING')
  const [realtimeRetry, setRealtimeRetry] = useState(0)

  // Реакции, редактирование, удаление, ответы, пересылка
  const [messageContextMenu, setMessageContextMenu] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(null)
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null)
  const [reactions, setReactions] = useState<Record<string, MessageReaction[]>>({})

  // Индикатор набора текста
  const [typingUserIds, setTypingUserIds] = useState<string[]>([])
  const lastTypingPingRef = useRef(0)
  const typingStopTimeoutRef = useRef<number | null>(null)

  // Прочтения и воспроизведение голоса
  const [latestReadMessageAt, setLatestReadMessageAt] = useState<string | null>(null)
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null)
  const voiceAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map())

  // Контакты
  const [contacts, setContacts] = useState<ChatProfile[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const phoneContactsFileRef = useRef<HTMLInputElement>(null)
  const [phoneContactsLoading, setPhoneContactsLoading] = useState(false)
  const [phoneContactsError, setPhoneContactsError] = useState<string | null>(null)
  const [phoneContactsNotInNexora, setPhoneContactsNotInNexora] = useState<Array<{ name: string; phones: string[] }>>([])
  const [phoneContactsMatches, setPhoneContactsMatches] = useState<ChatProfile[]>([])

  // Звонки
  const [activeCallInfo, setActiveCallInfo] = useState<{
    callId: string
    peerName: string
    mode: CallMode
    status: CallStatus
  } | null>(null)
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null)
  const [callMuted, setCallMuted] = useState(false)
  const [callCameraOn, setCallCameraOn] = useState(true)
  const [callAudioBlocked, setCallAudioBlocked] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const activeCallRef = useRef<ActiveCallSession | null>(null)
  const incomingCallRef = useRef<IncomingCallInfo | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const [callHistory, setCallHistory] = useState<Awaited<ReturnType<typeof loadCallHistory>>>([])
  const [callHistoryLoading, setCallHistoryLoading] = useState(false)

  // Поиск по сообщениям
  const [messageSearchQuery, setMessageSearchQuery] = useState('')
  const [messageSearchResults, setMessageSearchResults] = useState<ChatMessage[]>([])
  const [messageSearchActive, setMessageSearchActive] = useState(false)

  // Загрузка файлов
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Голосовые сообщения
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<number | null>(null)
  const recorderMimeRef = useRef<string>('audio/webm')

  // Групповые чаты
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [groupTitle, setGroupTitle] = useState('')
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([])
  const [groupCreating, setGroupCreating] = useState(false)
  const [groupError, setGroupError] = useState<string | null>(null)

  // Блокировки
  const [blockedUsers, setBlockedUsers] = useState<ChatProfile[]>([])
  const [blockedLoading, setBlockedLoading] = useState(false)

  // Настройки
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  // Управление чатами: настройки участника
  const [conversationSettings, setConversationSettings] = useState<Map<string, import('../services/conversationService').ConversationUserSettings>>(new Map())
  const [chatContextMenuId, setChatContextMenuId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  // Панели: группа, профиль
  const [showGroupPanel, setShowGroupPanel] = useState(false)
  const [showUserPanel, setShowUserPanel] = useState<string | null>(null)

  // Уведомления
  const [showNotificationPanel, setShowNotificationPanel] = useState(false)
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0)
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map())

  // Видеосообщения
  const [showVideoRecorder, setShowVideoRecorder] = useState(false)

  // Настройки уведомлений
  const [notificationSettings, setNotificationSettings] = useState({
    soundEnabled: true, pushEnabled: false, messageNotifications: true, callNotifications: true, groupNotifications: true,
  })
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  // Загрузка аватара
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  // Онлайн статус: heartbeat обновляет last_seen, пока приложение открыто.
  useEffect(() => {
    if (!user) return

    const markOffline = () => {
      void updateOnlineStatus('offline').catch(() => {})
    }

    void updateOnlineStatus('online').catch(() => {})
    const heartbeatId = window.setInterval(() => {
      void updateOnlineStatus('online').catch(() => {})
    }, 25_000)

    window.addEventListener('pagehide', markOffline)
    return () => {
      window.clearInterval(heartbeatId)
      window.removeEventListener('pagehide', markOffline)
      markOffline()
    }
  }, [user])

  const selectedConversation =
    conversations.find((conversation) => conversation.id === selectedConversationId) ?? null
  const selectedPeer = selectedConversation?.peer ?? null

  const reloadConversations = useCallback(async (showLoading = false) => {
    if (!user) return false
    if (showLoading) setChatsLoading(true)
    setChatsError(null)
    try {
      const nextConversations = await loadConversations(user.id)
      setConversations(nextConversations)
      setSelectedConversationId((current) =>
        current && nextConversations.some((conversation) => conversation.id === current)
          ? current
          : nextConversations[0]?.id ?? null,
      )
      return true
    } catch (error) {
      setChatsError(getErrorMessage(error))
      return false
    } finally {
      if (showLoading) setChatsLoading(false)
    }
  }, [user])

  useEffect(() => {
    void reloadConversations(true)
  }, [reloadConversations])

  // Актуальные сообщения для колбэков realtime (без пересоздания подписок)
  const messagesRef = useRef<ChatMessage[]>([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // «Прочитано» = у последнего прочитанного собеседником сообщения есть строка в
  // message_reads; все свои сообщения не новее него тоже считаем прочитанными.
  const refreshReadReceipts = useCallback(async (conversationMessages: ChatMessage[], currentUserId: string) => {
    const ownMessages = conversationMessages.filter((message) => message.senderId === currentUserId)
    if (!ownMessages.length) {
      setLatestReadMessageAt(null)
      return
    }
    try {
      const rows = await getMessageReadStatuses(ownMessages.map((message) => message.id))
      const othersRead = new Set(
        rows.filter((row) => row.userId !== currentUserId).map((row) => row.messageId),
      )
      if (!othersRead.size) {
        setLatestReadMessageAt(null)
        return
      }
      const latest = ownMessages
        .filter((message) => othersRead.has(message.id))
        .reduce<string | null>(
          (accumulator, message) => (!accumulator || message.createdAt > accumulator ? message.createdAt : accumulator),
          null,
        )
      setLatestReadMessageAt(latest)
    } catch {
      // Статусы прочтения не критичны — молча пропускаем.
    }
  }, [])

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([])
      setHasOlderMessages(false)
      setLatestReadMessageAt(null)
      return
    }

    let active = true
    setMessages([])
    setMessagesError(null)
    setMessagesLoading(true)
    setHasOlderMessages(false)
    setLatestReadMessageAt(null)

    void loadMessages(selectedConversationId)
      .then((page) => {
        if (!active) return
        setMessages((current) => mergeMessages(page.messages, current))
        setHasOlderMessages(page.hasMore)

        void getMessageReactionsBatch(page.messages.map((message) => message.id))
          .then((batch) => {
            if (active) setReactions((current) => ({ ...current, ...batch }))
          })
          .catch(() => {})

        const lastIncoming = [...page.messages]
          .reverse()
          .find((message) => message.senderId !== user?.id && !message.deletedAt)
        if (lastIncoming && user) {
          void markMessageAsRead(lastIncoming.id)
            .then(() => {
              if (active) void refreshReadReceipts(page.messages, user.id)
            })
            .catch(() => {})
        } else if (user) {
          void refreshReadReceipts(page.messages, user.id)
        }
      })
      .catch((error: unknown) => {
        if (active) setMessagesError(getErrorMessage(error))
      })
      .finally(() => {
        if (active) setMessagesLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedConversationId, messageReloadToken, refreshReadReceipts, user])

  useEffect(() => {
    if (!selectedConversationId || !user) return
    const ownUserId = user.id

    const unsubscribe = subscribeToConversationMessages(selectedConversationId, {
      onInsert: (message) => {
        if (message.conversationId !== selectedConversationId) return
        setMessages((current) => mergeMessages(current, [message]))
        setConversations((current) =>
          current
            .map((conversation) =>
              conversation.id === message.conversationId
                ? { ...conversation, lastMessage: message, updatedAt: message.createdAt }
                : conversation,
            )
            .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)),
        )
        if (message.senderId !== ownUserId) {
          void markMessageAsRead(message.id)
            .then(() => void refreshReadReceipts(messagesRef.current, ownUserId))
            .catch(() => {})
        }
      },
      onUpdate: (message) => {
        if (message.conversationId !== selectedConversationId) return
        setMessages((current) => mergeMessages(current, [message]))
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === message.conversationId && conversation.lastMessage?.id === message.id
              ? { ...conversation, lastMessage: message }
              : conversation,
          ),
        )
      },
      onDelete: (messageId) => {
        setMessages((current) => current.filter((message) => message.id !== messageId))
      },
      onStatus: setRealtimeStatus,
    })
    return unsubscribe
  }, [selectedConversationId, realtimeRetry, refreshReadReceipts, user])

  // Индикатор набора текста: подписка на чужие события + очистка при выходе из чата
  useEffect(() => {
    if (!selectedConversationId || !user) {
      setTypingUserIds([])
      return
    }
    const conversationId = selectedConversationId
    const ownUserId = user.id

    const unsubscribe = subscribeToTyping(conversationId, (userId, isTyping) => {
      if (userId === ownUserId) return
      setTypingUserIds((current) => {
        const withoutUser = current.filter((id) => id !== userId)
        return isTyping ? [...withoutUser, userId] : withoutUser
      })
    })

    return () => {
      unsubscribe()
      setTypingUserIds([])
      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current)
        typingStopTimeoutRef.current = null
      }
      lastTypingPingRef.current = 0
      void stopTyping(conversationId).catch(() => {})
    }
  }, [selectedConversationId, user])

  useEffect(() => {
    if (activeView !== 'people') return
    const searchTerm = peopleSearch.trim()
    if (!searchTerm) {
      setPeople([])
      setPeopleError(null)
      setPeopleLoading(false)
      return
    }

    let active = true
    setPeopleLoading(true)
    setPeopleError(null)
    const timeout = window.setTimeout(() => {
      void searchProfiles(searchTerm)
        .then((profiles) => {
          if (active) setPeople(profiles)
        })
        .catch((error: unknown) => {
          if (active) setPeopleError(getErrorMessage(error))
        })
        .finally(() => {
          if (active) setPeopleLoading(false)
        })
    }, 250)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [activeView, peopleSearch])

  // Контакты: загрузка при открытии раздела
  const reloadContacts = useCallback(() => {
    setContactsLoading(true)
    void getContacts()
      .then((list) => setContacts(list))
      .catch(() => {})
      .finally(() => setContactsLoading(false))
  }, [])

  useEffect(() => {
    if (activeView !== 'people') return
    reloadContacts()
  }, [activeView, reloadContacts])

  const handleAddContact = async (profile: ChatProfile) => {
    try {
      await addContact(profile.id)
      reloadContacts()
    } catch (error) {
      setPeopleError(getErrorMessage(error))
    }
  }

  const handleRemoveContact = async (profileId: string) => {
    try {
      await removeContact(profileId)
      setContacts((current) => current.filter((contact) => contact.id !== profileId))
    } catch (error) {
      setPeopleError(getErrorMessage(error))
    }
  }

  const processPhoneContacts = async (items: Array<{ name: string; phones: string[] }>) => {
    setPhoneContactsLoading(true)
    setPhoneContactsError(null)
    setPhoneContactsNotInNexora([])
    setPhoneContactsMatches([])
    try {
      const validItems = items.map((item) => ({
        name: item.name || 'Без имени',
        phones: [...new Set(item.phones.filter((phone) => phone.replace(/[^0-9]/g, '').length >= 7))],
      })).filter((item) => item.phones.length > 0)
      if (!validItems.length) throw new Error('В выбранных контактах не найдено номеров телефонов.')
      const matched = await matchPhoneContacts(validItems.flatMap((item) => item.phones))
      const matchedDigits = new Set(matched.map((profile) => profile.matched_phone))
      const matchedProfiles: ChatProfile[] = matched.map((profile) => ({
        id: profile.id, name: profile.name, username: profile.username,
        avatarUrl: profile.avatar_url, bio: '', status: 'offline', lastSeen: null,
      }))
      setPhoneContactsMatches(matchedProfiles)
      setPhoneContactsNotInNexora(validItems.filter((item) =>
        !item.phones.some((phone) => matchedDigits.has(phone.replace(/[^0-9]/g, '')))
      ))
    } catch (error) {
      setPhoneContactsError(getErrorMessage(error))
    } finally {
      setPhoneContactsLoading(false)
    }
  }

  const handleImportPhoneContacts = async () => {
    const contactNavigator = navigator as Navigator & {
      contacts?: { select: (properties: string[], options?: { multiple?: boolean }) => Promise<Array<{ name?: string[]; tel?: string[] }>> }
    }
    if (!contactNavigator.contacts?.select) {
      phoneContactsFileRef.current?.click()
      return
    }
    setPhoneContactsLoading(true)
    setPhoneContactsError(null)
    try {
      const selected = await contactNavigator.contacts.select(['name', 'tel'], { multiple: true })
      await processPhoneContacts(selected.map((contact) => ({
        name: contact.name?.[0] ?? 'Без имени', phones: contact.tel ?? [],
      })))
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setPhoneContactsError(getErrorMessage(error))
      }
      setPhoneContactsLoading(false)
    }
  }

  const handleVCardImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPhoneContactsLoading(true)
    try {
      const imported = await readVCardFile(file)
      await processPhoneContacts(imported)
    } catch (error) {
      setPhoneContactsError(getErrorMessage(error))
      setPhoneContactsLoading(false)
    }
  }

  // Индикаторы «печатает…»:Debounced debounce для поиска по сообщениям
  const notifyTyping = useCallback((conversationId: string) => {
    const now = Date.now()
    if (typingStopTimeoutRef.current) {
      window.clearTimeout(typingStopTimeoutRef.current)
      typingStopTimeoutRef.current = null
    }
    if (now - lastTypingPingRef.current > 2000) {
      lastTypingPingRef.current = now
      void startTyping(conversationId).catch(() => {})
    }
    typingStopTimeoutRef.current = window.setTimeout(() => {
      typingStopTimeoutRef.current = null
      lastTypingPingRef.current = 0
      void stopTyping(conversationId).catch(() => {})
    }, 3000)
  }, [])

  const handleDraftChange = (value: string) => {
    setDraft(value)
    if (!selectedConversation) return
    if (!value.trim()) {
      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current)
        typingStopTimeoutRef.current = null
      }
      lastTypingPingRef.current = 0
      void stopTyping(selectedConversation.id).catch(() => {})
      return
    }
    notifyTyping(selectedConversation.id)
  }

  // Debounce для поиска по сообщениям
  useEffect(() => {
    if (!messageSearchActive || !selectedConversation) return
    const query = messageSearchQuery.trim()
    if (!query) {
      setMessageSearchResults([])
      return
    }
    let active = true
    const timeout = window.setTimeout(() => {
      void searchMessages(selectedConversation.id, query)
        .then((results) => {
          if (active) setMessageSearchResults(results)
        })
        .catch(() => {})
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [messageSearchActive, messageSearchQuery, selectedConversation])

  // ============================================================================
  // Звонки
  // ============================================================================

  const isTerminalCallStatus = (status: CallStatus) =>
    status === 'ended' || status === 'declined' || status === 'missed' || status === 'busy' || status === 'failed'

  const closeCallOverlay = useCallback(() => {
    activeCallRef.current?.destroy()
    activeCallRef.current = null
    setActiveCallInfo(null)
    setLocalStream(null)
    setRemoteStream(null)
    setCallMuted(false)
    setCallCameraOn(true)
    setCallAudioBlocked(false)
  }, [])

  // Закрыть оверлей через паузу после завершения звонка
  const closeCallOverlayRef = useRef(closeCallOverlay)
  useEffect(() => {
    closeCallOverlayRef.current = closeCallOverlay
  }, [closeCallOverlay])

  useEffect(() => () => activeCallRef.current?.destroy(), [])

  const callHandlers = useMemo(() => ({
    onStatus: (status: CallStatus) => {
      setActiveCallInfo((current) => (current ? { ...current, status } : current))
      if (status === 'connected') {
        // Повторная попытка запуска аудио — трек мог появиться позже соединения.
        window.setTimeout(() => tryPlayRemoteAudioRef.current(), 150)
      }
      if (isTerminalCallStatus(status)) {
        window.setTimeout(() => closeCallOverlayRef.current(), 2200)
      }
    },
    onLocalStream: (stream: MediaStream) => setLocalStream(stream),
    onRemoteStream: (stream: MediaStream) => setRemoteStream(stream),
  }), [])

  // Входящие вызовы: постоянная подписка на личный inbox
  useEffect(() => {
    if (!user) return
    const unsubscribe = subscribeIncomingCalls(user.id, {
      onInvite: (info) => {
        if (activeCallRef.current || incomingCallRef.current) {
          rejectIncomingCall(info, 'busy')
          return
        }
        incomingCallRef.current = info
        setIncomingCall(info)
      },
      onCancel: (callId) => {
        if (incomingCallRef.current?.callId === callId) {
          incomingCallRef.current = null
          setIncomingCall(null)
        }
      },
    })
    return () => {
      unsubscribe()
      incomingCallRef.current = null
      setIncomingCall(null)
    }
  }, [user])

  // Привязка медиапотоков к video-элементам
  useEffect(() => {
    if (localVideoRef.current && localVideoRef.current.srcObject !== localStream) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream, activeCallInfo?.callId])

  useEffect(() => {
    if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream
    }
  }, [remoteStream, activeCallInfo?.callId])
  // Воспроизведение удалённого аудио: Safari может отказать в autoplay —
  // показываем кнопку «Включить звук» (жест пользователя разблокирует play()).
  const tryPlayRemoteAudio = useCallback((): void => {
    const audio = remoteAudioRef.current
    if (!audio || !audio.srcObject) return
    audio.play()
      .then(() => setCallAudioBlocked(false))
      .catch(() => setCallAudioBlocked(true))
  }, [])

  const tryPlayRemoteAudioRef = useRef(tryPlayRemoteAudio)
  useEffect(() => {
    tryPlayRemoteAudioRef.current = tryPlayRemoteAudio
  }, [tryPlayRemoteAudio])

  useEffect(() => {
    const audio = remoteAudioRef.current
    if (!audio) return

    if (activeCallInfo?.mode === 'audio' && remoteStream) {
      audio.srcObject = remoteStream
      tryPlayRemoteAudio()
    } else {
      audio.pause()
      audio.srcObject = null
      setCallAudioBlocked(false)
    }

    return () => {
      audio.pause()
      audio.srcObject = null
    }
  }, [remoteStream, activeCallInfo?.callId, activeCallInfo?.mode, tryPlayRemoteAudio])

  const beginCall = (session: ActiveCallSession) => {
    activeCallRef.current = session
    setActiveCallInfo({
      callId: session.callId,
      peerName: session.peerName,
      mode: session.mode,
      status: session.direction === 'outgoing' ? 'ringing' : 'connecting',
    })
  }

  const handleStartCall = (mode: CallMode) => {
    if (!user || !selectedConversation) return
    if (selectedConversation.type !== 'direct' || !selectedPeer) {
      setSendError('Звонки доступны в личных переписках.')
      return
    }
    if (activeCallRef.current) {
      setSendError('Уже идёт разговор.')
      return
    }
    const session = startOutgoingCall(
      {
        userId: user.id,
        conversationId: selectedConversation.id,
        peerUserId: selectedPeer.id,
        peerName: selectedPeer.name,
        mode,
        ...callHandlers,
      },
      user.name,
    )
    beginCall(session)
  }

  const handleAnswerCall = () => {
    if (!user || !incomingCall || activeCallRef.current) return
    const info = incomingCall
    incomingCallRef.current = null
    setIncomingCall(null)
    const session = acceptIncomingCall(info, user.id, callHandlers)
    beginCall(session)
  }

  const handleDeclineCall = () => {
    if (!incomingCall) return
    rejectIncomingCall(incomingCall, 'decline')
    incomingCallRef.current = null
    setIncomingCall(null)
  }

  const handleHangupCall = () => {
    activeCallRef.current?.hangup()
  }

  const handleToggleMic = () => {
    setCallMuted((muted) => {
      activeCallRef.current?.setMicEnabled(muted)
      return !muted
    })
  }

  const handleToggleCamera = () => {
    setCallCameraOn((cameraOn) => {
      activeCallRef.current?.setCameraEnabled(!cameraOn)
      return !cameraOn
    })
  }

  // История звонков
  useEffect(() => {
    if (activeView !== 'calls' || !user) return
    let active = true
    setCallHistoryLoading(true)
    void loadCallHistory(conversations.map((conversation) => conversation.id))
      .then((entries) => {
        if (active) setCallHistory(entries)
      })
      .catch(() => {
        if (active) setCallHistory([])
      })
      .finally(() => {
        if (active) setCallHistoryLoading(false)
      })
    return () => {
      active = false
    }
  }, [activeView, conversations, user])

  const filteredConversations = useMemo(() => {
    const query = chatSearch.trim().toLocaleLowerCase('ru-RU')
    const filtered = conversations.filter((conversation) => {
      const settings = conversationSettings.get(conversation.id)
      if (showArchived && !settings?.isArchived) return false
      if (!showArchived && settings?.isArchived) return false
      if (!query) return true
      return [conversation.title, conversation.peer?.username ?? '']
        .some((value) => value.toLocaleLowerCase('ru-RU').includes(query))
    })
    filtered.sort((a, b) => {
      const aPinned = conversationSettings.get(a.id)?.isPinned ? 1 : 0
      const bPinned = conversationSettings.get(b.id)?.isPinned ? 1 : 0
      if (bPinned !== aPinned) return bPinned - aPinned
      return b.updatedAt.localeCompare(a.updatedAt)
    })
    return filtered
  }, [chatSearch, conversations, conversationSettings, showArchived])

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await submitMessage()
  }

  const submitMessage = async () => {
    if (!draft.trim() || !selectedConversation || !user || isSending) return
    const content = draft.trim()
    setSendError(null)
    setIsSending(true)
    try {
      const message = await sendMessage(selectedConversation.id, user.id, content,
        replyToMessage ? { replyTo: replyToMessage.id } : undefined,
      )
      setMessages((current) => mergeMessages(current, [message]))
      setConversations((current) =>
        current
          .map((conversation) =>
            conversation.id === message.conversationId
              ? { ...conversation, lastMessage: message, updatedAt: message.createdAt }
              : conversation,
          )
          .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)),
      )
      setDraft('')
      setReplyToMessage(null)
      // Остановить индикатор «печатает…»
      if (typingStopTimeoutRef.current) window.clearTimeout(typingStopTimeoutRef.current)
      typingStopTimeoutRef.current = null
      lastTypingPingRef.current = 0
      void stopTyping(selectedConversation.id).catch(() => {})
    } catch (error) {
      setSendError(getErrorMessage(error))
    } finally {
      setIsSending(false)
    }
  }

  const loadOlderMessages = async () => {
    if (!selectedConversation || !messages.length || olderMessagesLoading) return
    setOlderMessagesLoading(true)
    setMessagesError(null)
    try {
      const page = await loadMessages(selectedConversation.id, {
        createdAt: messages[0].createdAt,
        id: messages[0].id,
      })
      setMessages((current) => mergeMessages(page.messages, current))
      setHasOlderMessages(page.hasMore)
    } catch (error) {
      setMessagesError(getErrorMessage(error))
    } finally {
      setOlderMessagesLoading(false)
    }
  }

  const handleCreateChat = async (profile: ChatProfile) => {
    setCreatingChatId(profile.id)
    setPeopleError(null)
    try {
      const conversationId = await createDirectConversation(profile.id)
      const refreshed = await reloadConversations()
      if (!refreshed) {
        throw new Error('Переписка создана, но список не удалось обновить. Повторите загрузку списка чатов.')
      }
      setSelectedConversationId(conversationId)
      setActiveView('chats')
      setChatSearch('')
    } catch (error) {
      setPeopleError(getErrorMessage(error))
    } finally {
      setCreatingChatId(null)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    if (!user) return
    setProfileName(user.name)
    setProfileUsername(user.username)
    setProfileBio(user.bio)
    setProfilePhone(user.phone)
  }, [user])

  const handleProfileSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setProfileMessage(null)
    setProfileError(null)
    if (profileName.trim().length < 1 || profileName.trim().length > 80) {
      setProfileError('Имя должно содержать от 1 до 80 символов.')
      return
    }
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(profileUsername.trim())) {
      setProfileError('Никнейм: от 3 до 32 символов, латинские буквы, цифры и _.')
      return
    }
    if (profilePhone.trim() && !/^\+?[\d\s-()]{7,20}$/.test(profilePhone.trim())) {
      setProfileError('Укажите корректный номер телефона.')
      return
    }
    if (profileBio.length > 500) {
      setProfileError('Описание не должно превышать 500 символов.')
      return
    }
    setProfileSaving(true)
    try {
      await updateProfile({ name: profileName, username: profileUsername, bio: profileBio, phone: profilePhone })
      setProfileMessage('Изменения профиля сохранены.')
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Не удалось сохранить профиль.')
    } finally {
      setProfileSaving(false)
    }
  }

  // ============================================================================
  // Новые обработчики
  // ============================================================================

  const handleAddReaction = async (messageId: string, emoji: string) => {
    try {
      const currentReactions = reactions[messageId] ?? []
      const existing = currentReactions.find((reaction) => reaction.emoji === emoji)
      const hasOwn = existing?.userIds.includes(user!.id) ?? false
      if (hasOwn) {
        // Удаляем свою реакцию (toggle)
        await removeReaction(messageId, emoji)
        setReactions((prev) => ({
          ...prev,
          [messageId]: (prev[messageId] ?? [])
            .map((reaction) =>
              reaction.emoji === emoji
                ? { ...reaction, count: reaction.count - 1, userIds: reaction.userIds.filter((id) => id !== user!.id) }
                : reaction,
            )
            .filter((reaction) => reaction.count > 0),
        }))
      } else {
        // Добавляем
        await addReaction(messageId, emoji)
        setReactions((prev) => {
          const current = prev[messageId] ?? []
          const found = current.find((reaction) => reaction.emoji === emoji)
          const updated = found
            ? current.map((reaction) =>
                reaction.emoji === emoji
                  ? { ...reaction, count: reaction.count + 1, userIds: [...reaction.userIds, user!.id] }
                  : reaction,
              )
            : [...current, { emoji, count: 1, userIds: [user!.id] }]
          return { ...prev, [messageId]: updated }
        })
      }
    } catch (error) {
      setSendError(getErrorMessage(error))
    }
  }

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await deleteMessage(messageId)
      setMessages((current) =>
        current.map((m) => (m.id === messageId ? { ...m, deletedAt: new Date().toISOString(), content: 'Сообщение удалено' } : m)),
      )
    } catch (error) {
      setSendError(getErrorMessage(error))
    }
  }

  const handleEditMessage = async () => {
    if (!editingMessageId || !editingContent.trim()) return
    try {
      await editMessage(editingMessageId, editingContent.trim())
      setMessages((current) =>
        current.map((m) =>
          m.id === editingMessageId
            ? { ...m, content: editingContent.trim(), editedAt: new Date().toISOString() }
            : m,
        ),
      )
      setEditingMessageId(null)
      setEditingContent('')
    } catch (error) {
      setSendError(getErrorMessage(error))
    }
  }

  const handleForwardSend = async (targetConversationId: string) => {
    if (!forwardingMessage || !user) return
    try {
      await forwardMessage(forwardingMessage.id, targetConversationId)
      setForwardingMessage(null)
      await reloadConversations()
      setActiveView('chats')
    } catch (error) {
      setSendError(getErrorMessage(error))
    }
  }

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !selectedConversation || !user) return

    setIsUploading(true)
    setUploadError(null)

    try {
      const { sendFileMessage } = await import('../services/chatService')
      const message = await sendFileMessage(selectedConversation.id, user.id, file)
      setMessages((current) => mergeMessages(current, [message]))
      setConversations((current) =>
        current
          .map((conversation) =>
            conversation.id === message.conversationId
              ? { ...conversation, lastMessage: message, updatedAt: message.createdAt }
              : conversation,
          )
          .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)),
      )
    } catch (error) {
      setUploadError(getErrorMessage(error))
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Форматы в порядке кросс-браузерной совместимости:
  // audio/mp4 (Safari 14.1+, Chrome 126+) воспроизводится всеми браузерами;
  // webm/opus — только Chrome/Firefox (Safari не умеет).
  const pickAudioMimeType = (): string => {
    const candidates = ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm']
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type
    }
    return ''
  }

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickAudioMimeType()
      recorderMimeRef.current = mimeType || 'audio/webm'
      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        const actualType = mediaRecorder.mimeType || recorderMimeRef.current
        const audioBlob = new Blob(audioChunksRef.current, { type: actualType })
        if (selectedConversation && user && audioBlob.size > 0) {
          try {
            const { sendVoiceMessage } = await import('../services/chatService')
            const message = await sendVoiceMessage(selectedConversation.id, user.id, audioBlob, actualType)
            setMessages((current) => mergeMessages(current, [message]))
            setConversations((current) =>
              current
                .map((conversation) =>
                  conversation.id === message.conversationId
                    ? { ...conversation, lastMessage: message, updatedAt: message.createdAt }
                    : conversation,
                )
                .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)),
            )
          } catch (error) {
            setSendError(getErrorMessage(error))
          }
        }
        setRecordingTime(0)
      }

      mediaRecorder.start()
      setIsRecording(true)

      recordingTimerRef.current = window.setInterval(() => {
        setRecordingTime((prev) => prev + 1)
      }, 1000)
    } catch {
      setSendError('Не удалось получить доступ к микрофону. Проверьте разрешения браузера.')
    }
  }

  const handleStopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }

  // Воспроизведение голосовых сообщений с диагностикой и обновлением signed URL.
  const handleVoicePlay = async (message: ChatMessage) => {
    const audio = voiceAudioRefs.current.get(message.id)
    if (!audio) return
    if (!audio.paused) {
      audio.pause()
      return
    }

    let lastError: unknown = undefined
    const tryPlay = async (): Promise<boolean> => {
      try {
        await audio.play()
        return true
      } catch (error) {
        lastError = error
        return false
      }
    }

    if (await tryPlay()) return

    const errorName = lastError instanceof DOMException ? lastError.name : ''
    // NotAllowedError — это политика autoplay, а не формат/URL: повторный
    // клик (жест пользователя) обычно помогает, просим кликнуть ещё раз.
    if (errorName === 'NotAllowedError') {
      setSendError('Браузер заблокировал автовоспроизведение — нажмите «Пуск» ещё раз.')
      return
    }

    // Если проблема в доступе к URL — пробуем обновить signed URL из storagePath в ссылке.
    const storagePath = storagePathFromSignedUrl(audio.src)
    if (storagePath) {
      try {
        const freshUrl = await getFileUrl(storagePath)
        audio.src = freshUrl
        audio.load()
        if (await tryPlay()) return
      } catch {
        // Обновление ссылки не помогло — сообщаем про сеть/доступ.
      }
    }

    setSendError(describeAudioError(audio, lastError))
  }

  const handleSearchMessages = async () => {
    if (!selectedConversation) return
    setMessageSearchActive(true)
    try {
      const results = await searchMessages(selectedConversation.id, messageSearchQuery)
      setMessageSearchResults(results)
    } catch (error) {
      setSendError(getErrorMessage(error))
    }
  }

  const handleCreateGroup = async () => {
    if (!groupTitle.trim() || !user) return
    setGroupCreating(true)
    setGroupError(null)
    try {
      await createGroupConversation(groupTitle.trim(), groupMemberIds)
      setShowGroupModal(false)
      setGroupTitle('')
      setGroupMemberIds([])
      await reloadConversations()
    } catch (error) {
      setGroupError(getErrorMessage(error))
    } finally {
      setGroupCreating(false)
    }
  }

  const handleBlockUser = async (userId: string) => {
    try {
      await blockUser(userId)
      setBlockedUsers((prev) => [...prev, { id: userId } as ChatProfile])
    } catch (error) {
      setSendError(getErrorMessage(error))
    }
  }

  const handleUnblockUser = async (userId: string) => {
    try {
      await unblockUser(userId)
      setBlockedUsers((prev) => prev.filter((u) => u.id !== userId))
    } catch (error) {
      setSendError(getErrorMessage(error))
    }
  }

  const loadBlockedUsers = useCallback(async () => {
    setBlockedLoading(true)
    try {
      const blocked = await getBlockedUsers()
      setBlockedUsers(blocked)
    } catch (error) {
      setSendError(getErrorMessage(error))
    } finally {
      setBlockedLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeView !== 'settings') return
    void loadBlockedUsers()
  }, [activeView, loadBlockedUsers])

  const handleDeleteAccount = async () => {
    if (!user) return
    if (deleteConfirmText !== 'УДАЛИТЬ') {
      setDeleteError('Введите «УДАЛИТЬ» для подтверждения.')
      return
    }
    setDeletingAccount(true)
    setDeleteError(null)
    try {
      await deleteAccount()
      navigate('/login', { replace: true })
    } catch (error) {
      setDeleteError(getErrorMessage(error))
      setDeletingAccount(false)
    }
  }

  // --- Управление чатами -------------------------------------------------------

  const loadChatSettings = useCallback(async () => {
    if (!user || conversations.length === 0) return
    const ids = conversations.map((c) => c.id)
    const settings = await loadConversationSettings(ids)
    setConversationSettings(settings)
  }, [user, conversations])

  const loadUnreadData = useCallback(async () => {
    if (!user || conversations.length === 0) return
    const counts = await loadUnreadCounts(conversations.map((c) => c.id))
    setUnreadCounts(counts)
    const unread = await getUnreadNotificationCount()
    setUnreadNotificationCount(unread)
  }, [user, conversations])

  const handleTogglePin = async (conversationId: string) => {
    const current = conversationSettings.get(conversationId)
    const pinned = !current?.isPinned
    await updateConversationSettings(conversationId, { isPinned: pinned }).catch(() => {})
    setConversationSettings((prev) => {
      const next = new Map(prev)
      next.set(conversationId, { ...current!, isPinned: pinned })
      return next
    })
    void reloadConversations()
  }

  const handleToggleArchive = async (conversationId: string) => {
    const current = conversationSettings.get(conversationId)
    const archived = !current?.isArchived
    await updateConversationSettings(conversationId, { isArchived: archived }).catch(() => {})
    setConversationSettings((prev) => {
      const next = new Map(prev)
      next.set(conversationId, { ...current!, isArchived: archived })
      return next
    })
    void reloadConversations()
    setChatContextMenuId(null)
  }

  const handleToggleMute = async (conversationId: string, mutedUntil: string | null) => {
    const current = conversationSettings.get(conversationId)
    await updateConversationSettings(conversationId, { mutedUntil }).catch(() => {})
    setConversationSettings((prev) => {
      const next = new Map(prev)
      next.set(conversationId, { ...current!, mutedUntil })
      return next
    })
    setChatContextMenuId(null)
  }

  const handleClearHistory = async (conversationId: string) => {
    if (!user) return
    try {
      await clearConversationHistory(conversationId)
    } catch {
      // Не критично
    }
  }

  const handleDeleteChatForMe = async (conversationId: string) => {
    await deleteChatForMe(conversationId).catch(() => {})
    await updateConversationSettings(conversationId, { isArchived: true }).catch(() => {})
    setChatContextMenuId(null)
    void reloadConversations()
  }

  const handleMarkAsRead = useCallback(async () => {
    if (!user || !selectedConversationId) return
    await updateConversationSettings(selectedConversationId, { lastReadAt: new Date().toISOString() }).catch(() => {})
    void loadUnreadData()
  }, [user, selectedConversationId, loadUnreadData])

  // Отмечать как прочитанное при открытии чата
  useEffect(() => {
    if (selectedConversationId) {
      void handleMarkAsRead()
    }
  }, [selectedConversationId, handleMarkAsRead])

  // --- Уведомления ------------------------------------------------------------

  const handleOpenNotifications = () => {
    // Не помечаем всё прочитанным при простом открытии панели.
    // Уведомление считается прочитанным только после нажатия на него
    // либо явной команды «Прочитать все» внутри панели.
    setShowNotificationPanel(true)
  }

  // --- Настройки уведомлений --------------------------------------------------

  const loadNotificationSettings = useCallback(async () => {
    setSettingsLoading(true)
    try {
      const settings = await loadUserSettings()
      setNotificationSettings(settings)
    } catch {
      // ignore
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  const saveNotificationSettings = async () => {
    setSettingsLoading(true)
    try {
      const nextSettings = { ...notificationSettings }
      if (nextSettings.pushEnabled && 'Notification' in window && Notification.permission === 'default') {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') nextSettings.pushEnabled = false
      }
      await updateUserSettings(nextSettings)
      setNotificationSettings(nextSettings)
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    } catch {
      // ignore
    } finally {
      setSettingsLoading(false)
    }
  }

  // --- Видеосообщения ----------------------------------------------------------

  const handleSendVideoMessage = async (blob: Blob, mimeType: string) => {
    if (!selectedConversation || !user) return
    const extension = mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm'
    const file = new File([blob], `circle_video_${Date.now()}.${extension}`, { type: mimeType })
    try {
      const client = requireClient()
      const { data: { user: authUser } } = await client.auth.getUser()
      if (!authUser) throw new Error('Требуется авторизация.')

      if (file.size > 25_000_000) throw new Error('Файл слишком большой. Максимум 25 МБ.')

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `${authUser.id}/${selectedConversation.id}/${Date.now()}_${safeName}`

      const { error: uploadError } = await client.storage.from('nexora-media').upload(storagePath, file, { upsert: false })
      if (uploadError) throw uploadError

      const { data: { session } } = await client.auth.getSession()
      if (!session) throw new Error('Требуется авторизация.')
      const signedUrl = await client.storage.from('nexora-media').createSignedUrl(storagePath, 604800)
      const url = signedUrl.data?.signedUrl ?? storagePath

      const { data, error } = await client
        .from('messages')
        .insert({
          conversation_id: selectedConversation.id,
          sender_id: user.id,
          content: url,
          message_type: 'video',
        })
        .select('id,conversation_id,sender_id,content,message_type,created_at,edited_at,deleted_at,reply_to,forward_of')
        .single()
      if (error) throw error

      const message = toChatMessage(data)
      setMessages((current) => [...current, message])
      setConversations((current) =>
        current.map((c) => c.id === selectedConversation.id ? { ...c, lastMessage: message, updatedAt: message.createdAt } : c)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      )
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Ошибка отправки видео')
    }
    setShowVideoRecorder(false)
  }

  // --- Загрузка аватара --------------------------------------------------------

  const handleAvatarChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!user) return
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    try {
      const avatarUrl = await uploadAvatar(file)
      await updateProfile({ avatar: avatarUrl })
      setProfileMessage('Аватар обновлён.')
      setProfileError(null)
      void reloadConversations()
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Ошибка загрузки аватара')
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleDeleteAvatar = async () => {
    setAvatarUploading(true)
    try {
      await deleteAvatar()
      await updateProfile({ avatar: '' })
      setProfileMessage('Аватар удалён.')
      setProfileError(null)
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Ошибка удаления аватара')
    } finally {
      setAvatarUploading(false)
    }
  }

  // --- Просмотр профиля --------------------------------------------------------

  const handleViewUserProfile = async (userId: string) => {
    try {
      const profile = await loadUserProfile(userId)
      setProfileName(profile.name as string)
      setProfileUsername(profile.username as string)
      setProfileBio((profile.bio as string) ?? '')
      setShowUserPanel(userId)
    } catch {
      setSendError('Не удалось загрузить профиль')
    }
  }

  const handleStartChatFromProfile = async (userId: string) => {
    try {
      const convId = await createDirectConversation(userId)
      await reloadConversations()
      setSelectedConversationId(convId)
      setShowUserPanel(null)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Не удалось создать чат')
    }
  }

  // --- Группа ------------------------------------------------------------------

  const handleOpenGroupPanel = async () => {
    if (!selectedConversation || selectedConversation.type !== 'group') return
    setShowGroupPanel(true)
  }

  // Эффекты загрузки данных (после определений колбэков)
  useEffect(() => {
    if (conversations.length > 0) void loadChatSettings()
  }, [conversations.length, loadChatSettings])

  // Обновляем счётчик даже если список чатов пуст, а новые уведомления
  // показываем сразу, не дожидаясь открытия панели.
  useEffect(() => {
    if (!user) return
    let active = true
    const refreshCount = async () => {
      const count = await getUnreadNotificationCount().catch(() => 0)
      if (active) setUnreadNotificationCount(count)
    }
    void refreshCount()
    const pollId = window.setInterval(() => void refreshCount(), 12_000)
    let unsubscribe: (() => void) | undefined
    void subscribeToNotifications({
      onInsert: (notification) => {
        setUnreadNotificationCount((count) => count + 1)
        if (notificationSettings.soundEnabled) playNotificationSound()
        if (
          notificationSettings.pushEnabled &&
          'Notification' in window &&
          Notification.permission === 'granted' &&
          document.visibilityState !== 'visible'
        ) {
          new Notification(notification.title, {
            body: notification.body,
            icon: '/NEXORA/icons/icon-192x192.svg',
            tag: notification.id,
          })
        }
      },
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup
      else cleanup()
    }).catch(() => {})
    return () => {
      active = false
      window.clearInterval(pollId)
      unsubscribe?.()
    }
  }, [user, notificationSettings.soundEnabled, notificationSettings.pushEnabled])

  useEffect(() => {
    if (activeView === 'settings') {
      void loadNotificationSettings()
    }
  }, [activeView, loadNotificationSettings])

  const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥']

const requireClient = () => {
  if (!supabase) throw new Error('Подключение к Supabase не настроено.')
  return supabase
}

const toChatMessage = (row: Record<string, unknown>): ChatMessage => ({
  id: row.id as string,
  conversationId: row.conversation_id as string,
  senderId: row.sender_id as string,
  content: (row.content as string) ?? '',
  createdAt: row.created_at as string,
  type: (row.message_type as ChatMessage['type']) ?? 'text',
  editedAt: (row.edited_at as string) ?? null,
  deletedAt: (row.deleted_at as string) ?? null,
  replyTo: (row.reply_to as string) ?? null,
  forwardOf: (row.forward_of as string) ?? null,
})

  if (!user) return null

  return (
    <AppShell activeView={activeView} onViewChange={setActiveView} onLogout={handleLogout} user={user}>
      {activeView === 'chats' ? (
        <div className="grid h-full min-h-[calc(100vh-10rem)] grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)_300px]">
          <aside className="border-b border-white/10 bg-slate-950/40 xl:border-b-0 xl:border-r">
            <div className="flex items-center gap-3 border-b border-white/10 p-4">
              <div className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-slate-300">
                <div className="flex items-center gap-2">
                  <Search size={15} />
                  <input
                    value={chatSearch}
                    onChange={(event) => setChatSearch(event.target.value)}
                    className="w-full bg-transparent text-sm text-white placeholder:text-slate-400 focus:outline-none"
                    placeholder="Поиск по перепискам"
                  />
                </div>
              </div>
              <button
                aria-label="Уведомления"
                title="Уведомления"
                onClick={() => void handleOpenNotifications()}
                className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-cyan-300 hover:bg-white/10"
              >
                <BellRing size={16} />
                {unreadNotificationCount > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                  </span>
                ) : null}
              </button>
            </div>

            {/* Архив */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
              <button
                onClick={() => setShowArchived(!showArchived)}
                className={`text-xs transition ${showArchived ? 'text-cyan-300 font-medium' : 'text-slate-400 hover:text-slate-300'}`}
              >
                {showArchived ? '← Назад к чатам' : 'Архив'}
              </button>
            </div>

            <div className="max-h-[45vh] space-y-2 overflow-y-auto p-3 xl:max-h-[calc(100vh-13rem)]">
              {chatsLoading ? <div className="p-4 text-center text-sm text-slate-400">Загружаем переписки…</div> : null}
              {chatsError ? (
                <div role="alert" className="space-y-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                  <p>{chatsError}</p>
                  <button className="font-medium underline" onClick={() => void reloadConversations(true)}>Повторить</button>
                </div>
              ) : null}
              {!chatsLoading && !chatsError && filteredConversations.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-400">
                  {conversations.length ? 'Переписки не найдены' : 'Переписок пока нет. Найдите пользователя в разделе «Контакты».'}
                </div>
              ) : null}
              {filteredConversations.map((conversation: ChatConversation) => {
                const settings = conversationSettings.get(conversation.id)
                const unread = unreadCounts.get(conversation.id) ?? 0
                return (
                <div key={conversation.id} className="relative">
                  <button
                    type="button"
                    onClick={() => setSelectedConversationId(conversation.id)}
                    className={[
                      'flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition',
                      conversation.id === selectedConversationId
                        ? 'border-cyan-500/40 bg-cyan-500/10'
                        : 'border-transparent bg-white/0 hover:bg-white/5',
                    ].join(' ')}
                  >
                    {conversation.avatarUrl ? (
                      <img src={conversation.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-200">
                        {conversation.title.slice(0, 1).toLocaleUpperCase('ru-RU')}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {settings?.isPinned ? <Pin size={12} className="shrink-0 text-cyan-400" /> : null}
                        <span className="truncate text-sm font-medium text-white">{conversation.title}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-400">
                        {conversation.lastMessage?.deletedAt
                          ? 'Сообщение удалено'
                          : conversation.lastMessage?.content ?? 'Нет сообщений'}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {conversation.lastMessage ? (
                        <span className="shrink-0 text-[10px] text-slate-400">
                          {formatConversationTime(conversation.lastMessage.createdAt)}
                        </span>
                      ) : null}
                      {unread > 0 ? (
                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-cyan-500 px-1.5 text-[10px] font-bold text-slate-950">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      ) : null}
                    </div>
                  </button>
                  {/* Контекстное меню */}
                  <div className="absolute right-2 top-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); setChatContextMenuId(chatContextMenuId === conversation.id ? null : conversation.id) }}
                      className="rounded-full p-1 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-white"
                      style={{ opacity: chatContextMenuId === conversation.id ? 1 : undefined }}
                    >
                      <MoreVertical size={16} />
                    </button>
                    {chatContextMenuId === conversation.id ? (
                      <ChatContextMenu
                        isPinned={settings?.isPinned ?? false}
                        isArchived={settings?.isArchived ?? false}
                        isMuted={!!settings?.mutedUntil && new Date(settings.mutedUntil) > new Date()}
                        onPin={() => void handleTogglePin(conversation.id)}
                        onArchive={() => void handleToggleArchive(conversation.id)}
                        onUnarchive={() => void handleToggleArchive(conversation.id)}
                        onMute={(until) => void handleToggleMute(conversation.id, until)}
                        onUnmute={() => void handleToggleMute(conversation.id, null)}
                        onClearHistory={() => void handleClearHistory(conversation.id)}
                        onDeleteForMe={() => void handleDeleteChatForMe(conversation.id)}
                        onClose={() => setChatContextMenuId(null)}
                      />
                    ) : null}
                  </div>
                </div>
                )
              })}
            </div>
          </aside>

          <main className="flex min-h-0 flex-col border-b border-white/10 bg-slate-900/60 xl:border-b-0 xl:border-r">
            {selectedConversation ? (
              <>
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    {selectedPeer?.avatarUrl ? (
                      <img src={selectedPeer.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-200">
                        {selectedConversation.title.slice(0, 1).toLocaleUpperCase('ru-RU')}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{selectedConversation.title}</div>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className={[
                          'inline-block h-2 w-2 rounded-full',
                          selectedPeer?.status === 'online' ? 'bg-emerald-400' : 'bg-slate-500',
                        ].join(' ')} />
                        {selectedPeer?.status === 'online'
                          ? 'В сети'
                          : selectedPeer?.lastSeen
                            ? `Был(а) в сети ${formatConversationTime(selectedPeer.lastSeen)}`
                            : 'Не в сети'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-slate-200">
                    <button
                      aria-label="Информация"
                      title={selectedConversation.type === 'group' ? 'Информация о группе' : 'Профиль'}
                      onClick={() => {
                        if (selectedConversation.type === 'group') {
                          void handleOpenGroupPanel()
                        } else if (selectedPeer) {
                          void handleViewUserProfile(selectedPeer.id)
                        }
                      }}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 hover:text-cyan-300"
                    >
                      {selectedConversation.type === 'group' ? <Users size={16} /> : <Info size={16} />}
                    </button>
                    <button
                      aria-label="Аудиозвонок"
                      title={selectedPeer ? 'Аудиозвонок' : 'Звонки доступны в личных переписках'}
                      disabled={selectedConversation.type !== 'direct' || !selectedPeer}
                      onClick={() => handleStartCall('audio')}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 hover:text-cyan-300 disabled:opacity-40 disabled:hover:text-slate-200"
                    >
                      <Phone size={16} />
                    </button>
                    <button
                      aria-label="Видеозвонок"
                      title={selectedPeer ? 'Видеозвонок' : 'Звонки доступны в личных переписках'}
                      disabled={selectedConversation.type !== 'direct' || !selectedPeer}
                      onClick={() => handleStartCall('video')}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 hover:text-cyan-300 disabled:opacity-40 disabled:hover:text-slate-200"
                    >
                      <Video size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto p-4">
                  {hasOlderMessages ? (
                    <div className="text-center">
                      <button
                        disabled={olderMessagesLoading}
                        onClick={() => void loadOlderMessages()}
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300 disabled:opacity-50"
                      >
                        {olderMessagesLoading ? 'Загружаем…' : 'Загрузить предыдущие сообщения'}
                      </button>
                    </div>
                  ) : null}
                  {messagesLoading ? <div className="py-8 text-center text-sm text-slate-400">Загружаем сообщения…</div> : null}
                  {messagesError ? (
                    <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-center text-sm text-red-200">
                      <p>{messagesError}</p>
                      <button
                        className="mt-2 font-medium underline"
                        onClick={() => setMessageReloadToken((current) => current + 1)}
                      >
                        Повторить
                      </button>
                    </div>
                  ) : null}
                  {!messagesLoading && !messagesError && messages.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-400">Пока нет сообщений</div>
                  ) : null}

                  {/* Индикатор набора текста */}
                  {typingUserIds.length > 0 ? (
                    <div className="flex items-center gap-2 px-1 text-xs text-slate-400">
                      <span className="inline-flex gap-1">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" />
                      </span>
                      {selectedPeer && typingUserIds.includes(selectedPeer.id)
                        ? 'Печатает…'
                        : typingUserIds.length === 1
                          ? 'Участник печатает…'
                          : 'Участники печатают…'}
                    </div>
                  ) : null}

                  {messages.map((message) => {
                    const isOwn = message.senderId === user.id
                    const isEditing = editingMessageId === message.id
                    return (
                      <div key={message.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                        <div className="group relative max-w-[78%]">
                          {/* Reply preview */}
                          {message.replyTo && (() => {
                            const source = messages.find((m) => m.id === message.replyTo)
                            const sourceContent = source?.content?.slice(0, 60) ?? 'Сообщение недоступно'
                            return (
                              <div className={`mb-1 rounded-lg border-l-2 px-2 py-1 text-xs ${isOwn ? 'border-cyan-300 bg-cyan-400/20 text-slate-900' : 'border-cyan-500 bg-white/5 text-slate-300'}`}>
                                ↩ {sourceContent}
                              </div>
                            )
                          })()}
                          {/* Forward preview */}
                          {message.forwardOf && (
                            <div className={`mb-1 rounded-lg border-l-2 px-2 py-1 text-xs ${isOwn ? 'border-cyan-300 bg-cyan-400/20 text-slate-900' : 'border-cyan-500 bg-white/5 text-slate-300'}`}>
                              ↪ Пересланное сообщение
                            </div>
                          )}

                          {isEditing ? (
                            <div className={`rounded-2xl px-4 py-3 text-sm ${isOwn ? 'bg-cyan-500 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-50'}`}>
                              <input
                                autoFocus
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditMessage(); } }}
                                className="w-full bg-transparent text-sm outline-none"
                              />
                              <div className="mt-2 flex justify-end gap-2">
                                <button onClick={() => { setEditingMessageId(null); setEditingContent(''); }} className="text-xs underline opacity-60">Отмена</button>
                                <button onClick={handleEditMessage} className="text-xs font-medium text-cyan-300">Сохранить</button>
                              </div>
                            </div>
                          ) : (
                            <div
                              className={[
                                'rounded-2xl px-4 py-3 text-sm cursor-pointer transition',
                                isOwn ? 'bg-cyan-500 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-50',
                                message.deletedAt ? 'italic opacity-70' : '',
                              ].join(' ')}
                              onDoubleClick={() => {
                                if (isOwn && !message.deletedAt) {
                                  setEditingMessageId(message.id)
                                  setEditingContent(message.content)
                                }
                              }}
                            >
                              {message.type === 'image' ? (
                                <div>
                                  <img src={message.content} alt="Фото" className="mb-2 max-w-full rounded-xl" loading="lazy" />
                                  <div className="text-xs opacity-70">{formatMessageTime(message.createdAt)}</div>
                                </div>
                              ) : message.type === 'video' ? (
                                <div>
                                  {message.content.includes('circle_video_') ? (
                                    <div className="mb-2 flex justify-start">
                                      <div className="relative h-56 w-56 max-w-full overflow-hidden rounded-full border-2 border-cyan-400/40 bg-slate-950 shadow-lg shadow-cyan-500/10">
                                        <video
                                          src={message.content}
                                          controls
                                          playsInline
                                          preload="metadata"
                                          className="h-full w-full rounded-full object-cover"
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <video src={message.content} controls playsInline className="mb-2 max-w-full rounded-xl" />
                                  )}
                                  <div className="text-xs opacity-70">{formatMessageTime(message.createdAt)}</div>
                                </div>
                              ) : message.type === 'voice' ? (
                                <div className="flex items-center gap-3">
                                  <button
                                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20"
                                    aria-label={playingVoiceId === message.id ? 'Пауза' : 'Воспроизвести'}
                                    onClick={() => void handleVoicePlay(message)}
                                  >
                                    {playingVoiceId === message.id ? <Pause size={14} /> : <Play size={14} />}
                                  </button>
                                  <audio
                                    src={message.content}
                                    preload="metadata"
                                    className="hidden"
                                    ref={(element) => {
                                      if (element) voiceAudioRefs.current.set(message.id, element)
                                      else voiceAudioRefs.current.delete(message.id)
                                    }}
                                    onPlay={() => {
                                      setPlayingVoiceId(message.id)
                                      // Остановить прочие воспроизведения
                                      voiceAudioRefs.current.forEach((audio, id) => {
                                        if (id !== message.id) audio.pause()
                                      })
                                    }}
                                    onPause={() => setPlayingVoiceId((current) => (current === message.id ? null : current))}
                                    onEnded={() => setPlayingVoiceId((current) => (current === message.id ? null : current))}
                                    onError={(event) => {
                                      const element = event.currentTarget
                                      setPlayingVoiceId((current) => (current === message.id ? null : current))
                                      setSendError(describeAudioError(element))
                                    }}
                                  />
                                  <span className="text-xs opacity-70">Голосовое сообщение</span>
                                  <div className="text-xs opacity-70">{formatMessageTime(message.createdAt)}</div>
                                </div>
                              ) : message.type === 'file' ? (
                                <div className="flex items-center gap-2">
                                  <FileText size={16} />
                                  <a
                                    href={message.content}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="max-w-[220px] truncate underline"
                                    title={fileNameFromUrl(message.content)}
                                  >
                                    {fileNameFromUrl(message.content)}
                                  </a>
                                  <div className="text-xs opacity-70">{formatMessageTime(message.createdAt)}</div>
                                </div>
                              ) : (
                                message.content
                              )}
                              <div className={['mt-2 text-[10px] opacity-70', isOwn ? 'text-slate-900' : 'text-slate-300'].join(' ')}>
                                {formatMessageTime(message.createdAt)}{message.editedAt ? ' · изменено' : ''}
                                {isOwn && !message.deletedAt && (
                                  <span title={message.createdAt <= (latestReadMessageAt ?? '') ? 'Прочитано' : 'Отправлено'} className="ml-1 inline-flex align-middle">
                                    {message.createdAt <= (latestReadMessageAt ?? '')
                                      ? <CheckCheck size={13} />
                                      : <Check size={13} />}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Реакции */}
                          {!isEditing && !message.deletedAt && (reactions[message.id]?.length ?? 0) > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {reactions[message.id]?.map((r) => (
                                <button
                                  key={r.emoji}
                                  className={`rounded-full border px-2 py-0.5 text-xs transition ${
                                    r.userIds.includes(user.id)
                                      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300'
                                      : 'border-white/10 bg-white/5 text-slate-300'
                                  }`}
                                  onClick={() => void handleAddReaction(message.id, r.emoji)}
                                >
                                  {r.emoji} {r.count}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Контекстное меню */}
                          {!isEditing && (
                            <button
                              onClick={() => {
                                if (messageContextMenu === message.id) {
                                  setMessageContextMenu(null)
                                } else {
                                  setMessageContextMenu(message.id)
                                  if (!reactions[message.id]) {
                                    void getMessageReactions(message.id).then((r) => {
                                      setReactions((prev) => ({ ...prev, [message.id]: r }))
                                    }).catch(() => {})
                                  }
                                }
                              }}
                              className="mt-1 hidden text-[10px] text-slate-400 hover:text-cyan-300 group-hover:block"
                            >
                              {messageContextMenu === message.id ? 'Скрыть' : 'Действия ▾'}
                            </button>
                          )}
                          {messageContextMenu === message.id && (
                            <div className="absolute z-50 mt-1 w-48 rounded-xl border border-white/10 bg-slate-900 shadow-xl">
                              <div className="p-1">
                                {REACTION_EMOJIS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    onClick={() => { handleAddReaction(message.id, emoji); setMessageContextMenu(null); }}
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5"
                                  >
                                    <span className="text-lg">{emoji}</span>
                                  </button>
                                ))}
                                <div className="my-1 border-t border-white/10" />
                                {isOwn && !message.deletedAt && (
                                  <>
                                    <button onClick={() => { setEditingMessageId(message.id); setEditingContent(message.content); setMessageContextMenu(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/5">
                                      <Edit2 size={14} /> Изменить
                                    </button>
                                    <button onClick={() => { handleDeleteMessage(message.id); setMessageContextMenu(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">
                                      <Trash2 size={14} /> Удалить
                                    </button>
                                    <div className="my-1 border-t border-white/10" />
                                  </>
                                )}
                                <button onClick={() => { setReplyToMessage(message); setMessageContextMenu(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/5">
                                  <Reply size={14} /> Ответить
                                </button>
                                <button onClick={() => { setForwardingMessage(message); setMessageContextMenu(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/5">
                                  <Forward size={14} /> Переслать
                                </button>
                                <button onClick={() => { void navigator.clipboard.writeText(message.content); setMessageContextMenu(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/5">
                                  <Copy size={14} /> Копировать
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="border-t border-white/10 p-4">
                  {/* Reply preview */}
                  {replyToMessage && (
                    <div className="mb-2 flex items-center justify-between rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
                      <span>↩ Ответ: {replyToMessage.content.slice(0, 50)}</span>
                      <button onClick={() => setReplyToMessage(null)} className="text-cyan-300 hover:text-white">
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  {/* Forward preview */}
                  {forwardingMessage && (
                    <div className="mb-2 flex items-center justify-between rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs text-purple-200">
                      <span>↪ Пересылка: {forwardingMessage.content.slice(0, 50)}</span>
                      <div className="flex gap-2">
                        <button onClick={() => { void handleForwardSend(selectedConversation!.id); setForwardingMessage(null); }} className="text-purple-300 hover:text-white">В этот чат</button>
                        <button onClick={() => setForwardingMessage(null)} className="text-purple-300 hover:text-white">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )}

                  <form onSubmit={handleSend} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3">
                    {/* Загрузка файла */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      aria-label="Прикрепить файл"
                      title="Прикрепить файл"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 hover:text-cyan-300 disabled:opacity-50"
                    >
                      {isUploading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" /> : <Plus size={14} />}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
                      className="hidden"
                      onChange={handleFileUpload}
                    />

                    {/* Голосовое сообщение */}
                    <button
                      type="button"
                      onClick={isRecording ? handleStopRecording : () => void handleStartRecording()}
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition ${
                        isRecording
                          ? 'border-red-500 bg-red-500/20 text-red-400 animate-pulse'
                          : 'border-white/10 bg-white/5 text-slate-300 hover:text-cyan-300'
                      }`}
                      aria-label={isRecording ? 'Остановить запись' : 'Записать голосовое сообщение'}
                      title={isRecording ? 'Остановить запись' : 'Голосовое сообщение'}
                    >
                      {isRecording ? <Pause size={14} /> : <Mic size={14} />}
                    </button>
                    {isRecording && (
                      <span className="text-xs text-red-400">
                        ⏺ {Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}
                      </span>
                    )}

                    {/* Видеосообщение (кружок) */}
                    <button
                      type="button"
                      onClick={() => setShowVideoRecorder(true)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 hover:text-cyan-300"
                      aria-label="Видеосообщение"
                      title="Видеосообщение"
                    >
                      <Video size={14} />
                    </button>

                    {/* Поиск по сообщениям */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (messageSearchActive) {
                            setMessageSearchActive(false)
                            setMessageSearchResults([])
                            setMessageSearchQuery('')
                          } else {
                            setMessageSearchActive(true)
                          }
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 hover:text-cyan-300"
                        aria-label="Поиск по сообщениям"
                        title="Поиск по сообщениям"
                      >
                        <Search size={14} />
                      </button>
                    </div>

                    <input
                      value={draft}
                      onChange={(event) => handleDraftChange(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-slate-400 focus:outline-none"
                      placeholder={replyToMessage ? 'Ответьте на сообщение…' : 'Введите сообщение…'}
                      disabled={isSending || isRecording}
                    />
                    <button
                      type="submit"
                      disabled={!draft.trim() || isSending || isRecording}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Отправить сообщение"
                      title="Отправить сообщение"
                    >
                      <Send size={16} />
                    </button>
                  </form>

                  {/* Результаты поиска по сообщениям */}
                  {messageSearchActive && (
                    <div className="mt-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={messageSearchQuery}
                          onChange={(e) => { setMessageSearchQuery(e.target.value); void handleSearchMessages() }}
                          className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-400 focus:outline-none"
                          placeholder="Поиск в этом чате…"
                        />
                        <button onClick={() => { setMessageSearchActive(false); setMessageSearchResults([]); setMessageSearchQuery('') }} className="text-slate-400 hover:text-white">
                          <X size={14} />
                        </button>
                      </div>
                      {messageSearchResults.length > 0 && (
                        <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                          {messageSearchResults.map((r) => (
                            <div key={r.id} className="rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-300">
                              {r.content.slice(0, 80)} · {formatMessageTime(r.createdAt)}
                            </div>
                          ))}
                        </div>
                      )}
                      {messageSearchQuery && messageSearchResults.length === 0 && (
                        <div className="mt-2 text-xs text-slate-400">Ничего не найдено</div>
                      )}
                    </div>
                  )}

                  {uploadError ? (
                    <div role="alert" className="mt-2 text-xs text-red-300">{uploadError}</div>
                  ) : null}
                  {sendError ? (
                    <div role="alert" className="mt-2 flex items-center justify-between gap-3 text-xs text-red-300">
                      <span>{sendError}</span>
                      <button type="button" className="shrink-0 underline" onClick={() => void submitMessage()}>
                        Повторить
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-slate-400">
                {chatsLoading ? 'Загружаем переписки…' : 'Выберите переписку или найдите пользователя в контактах'}
              </div>
            )}
          </main>

          <aside className="space-y-4 bg-slate-950/40 p-4">
            {showGroupPanel && selectedConversation?.type === 'group' ? (
              <div className="h-[calc(100vh-10rem)] overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                <GroupProfilePanel
                  conversationId={selectedConversation.id}
                  currentUserId={user.id}
                  onClose={() => setShowGroupPanel(false)}
                  onLeftGroup={() => { setShowGroupPanel(false); void reloadConversations() }}
                  onGroupUpdated={() => void reloadConversations()}
                />
              </div>
            ) : showUserPanel ? (
              <div className="h-[calc(100vh-10rem)] overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                <UserProfilePanel
                  userId={showUserPanel}
                  onClose={() => setShowUserPanel(null)}
                  onStartChat={handleStartChatFromProfile}
                />
              </div>
            ) : selectedConversation ? (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-medium text-white">Профиль собеседника</div>
                {selectedPeer?.avatarUrl ? (
                  <img src={selectedPeer.avatarUrl} alt="" className="mt-4 h-20 w-20 rounded-full object-cover" />
                ) : null}
                <div className="mt-4 text-lg font-semibold text-white">{selectedPeer?.name ?? selectedConversation.title}</div>
                {selectedPeer?.username ? <div className="text-sm text-slate-300">@{selectedPeer.username}</div> : null}
                {selectedPeer?.bio ? (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/80 p-3 text-xs text-slate-300">
                    {selectedPeer.bio}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Shield size={16} className="text-cyan-300" />
                Состояние безопасности
              </div>
              <div className="mt-3 flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                <span>Защита RLS</span>
                <span>{isSupabaseConfigured ? 'На стороне Supabase' : 'Не настроена'}</span>
              </div>
              <div className="mt-2 flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
                <span>Обмен в реальном времени</span>
                <span className="flex items-center gap-2">
                  {realtimeStatus === 'SUBSCRIBED'
                    ? 'Подключён'
                    : realtimeStatus === 'CHANNEL_ERROR' || realtimeStatus === 'TIMED_OUT'
                      ? 'Ошибка'
                      : realtimeStatus === 'CLOSED'
                        ? 'Нет активного чата'
                        : 'Подключение…'}
                  {selectedConversation && realtimeStatus !== 'SUBSCRIBED' ? (
                    <button className="underline" onClick={() => setRealtimeRetry((current) => current + 1)}>
                      Повторить
                    </button>
                  ) : null}
                </span>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {activeView === 'people' ? (
        <div className="space-y-4 p-4 md:p-6">
          {/* Раздел «Контакты» */}
          <div className="rounded-[28px] border border-white/10 bg-slate-950/50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-lg font-semibold text-white">Контакты</div>
              <div className="flex gap-2">
                <button type="button" disabled={phoneContactsLoading} onClick={() => void handleImportPhoneContacts()} className="rounded-xl bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
                  {phoneContactsLoading ? 'Импортируем…' : 'Импортировать контакты телефона'}
                </button>
                <button onClick={() => void reloadContacts()} className="text-sm text-cyan-300 hover:text-cyan-200">Обновить</button>
              </div>
              <input ref={phoneContactsFileRef} type="file" accept=".vcf,text/vcard" className="hidden" onChange={(event) => void handleVCardImport(event)} />
            </div>
            <p className="mt-2 text-xs text-slate-400">Номера используются только для сверки и не сохраняются. Если браузер не поддерживает выбор контактов, выберите экспортированный файл .vcf.</p>
            {phoneContactsError ? <div role="alert" className="mt-3 text-sm text-red-300">{phoneContactsError}</div> : null}
            {phoneContactsMatches.length > 0 ? (
              <div className="mt-4">
                <div className="mb-2 text-sm font-medium text-emerald-300">Уже в NEXORA ({phoneContactsMatches.length})</div>
                <div className="space-y-2">
                  {phoneContactsMatches.map((profile) => (
                    <div key={profile.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3">
                      <div><div className="text-sm text-white">{profile.name}</div><div className="text-xs text-slate-400">@{profile.username}</div></div>
                      <button type="button" onClick={() => void handleAddContact(profile)} className="text-xs text-cyan-300">Добавить</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {phoneContactsNotInNexora.length > 0 ? (
              <div className="mt-4">
                <div className="mb-2 text-sm font-medium text-slate-300">Пока не зарегистрированы ({phoneContactsNotInNexora.length})</div>
                <div className="space-y-1 text-sm text-slate-400">
                  {phoneContactsNotInNexora.map((item, index) => <div key={index}>{item.name}</div>)}
                </div>
              </div>
            ) : null}
            {contactsLoading ? (
              <div className="mt-3 text-sm text-slate-400">Загружаю…</div>
            ) : contacts.length === 0 ? (
              <div className="mt-3 text-sm text-slate-400">Список контактов пуст</div>
            ) : (
              <div className="mt-3 space-y-2">
                {contacts.map((contact) => (
                  <div key={contact.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                    <span>{contact.name}</span>
                    <button
                      onClick={() => void handleRemoveContact(contact.id)}
                      className="text-xs text-cyan-300 hover:text-cyan-200"
                    >
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Поиск пользователей */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3">
              <Search size={16} className="text-slate-400" />
              <input
                value={peopleSearch}
                onChange={(event) => setPeopleSearch(event.target.value)}
                className="w-full bg-transparent text-sm text-white placeholder:text-slate-400 focus:outline-none"
                placeholder="Поиск по имени или никнейму"
              />
            </div>
            <button
              onClick={() => setShowGroupModal(true)}
              className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
            >
              <span className="flex items-center gap-2"><Plus size={16} /> Создать группу</span>
            </button>
          </div>
          {peopleError ? (
            <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              {peopleError}
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {peopleLoading ? <div className="text-sm text-slate-400">Ищем пользователей…</div> : null}
            {!peopleLoading && !peopleError && peopleSearch.trim() && people.length === 0 ? (
              <div className="rounded-[28px] border border-white/10 bg-slate-950/50 p-6 text-center text-slate-300 md:col-span-2 xl:col-span-3">
                Пользователи не найдены
              </div>
            ) : null}
            {!peopleSearch.trim() ? (
              <div className="rounded-[28px] border border-white/10 bg-slate-950/50 p-6 text-center text-slate-300 md:col-span-2 xl:col-span-3">
                Введите имя или никнейм, чтобы найти собеседника
              </div>
            ) : null}
            {people.map((profile) => (
              <div key={profile.id} className="rounded-[28px] border border-white/10 bg-slate-950/50 p-4">
                <div className="flex items-center gap-3">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-200">
                      {profile.name.slice(0, 1).toLocaleUpperCase('ru-RU')}
                    </div>
                  )}
                  <div>
                    <div className="text-base font-semibold text-white">{profile.name}</div>
                    <div className="text-sm text-slate-300">@{profile.username}</div>
                  </div>
                </div>
                {profile.bio ? <div className="mt-4 text-sm text-slate-300">{profile.bio}</div> : null}
                <div className="mt-4 text-xs text-slate-300">
                  {profile.status === 'online'
                    ? 'В сети'
                    : profile.lastSeen
                      ? `Был(а) в сети ${formatConversationTime(profile.lastSeen)}`
                      : 'Не в сети'}
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    disabled={creatingChatId === profile.id}
                    onClick={() => void handleCreateChat(profile)}
                    className="flex-1 rounded-2xl bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                  >
                    {creatingChatId === profile.id ? 'Открываем…' : 'Написать'}
                  </button>
                  <button
                    onClick={() => void handleAddContact(profile)}
                    className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-300 hover:bg-cyan-500/20"
                    title="Добавить в контакты"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    onClick={() => void handleBlockUser(profile.id)}
                    className="rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 hover:bg-red-500/20"
                    title="Заблокировать"
                  >
                    <ShieldOff size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Модальное окно создания группы */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Создать группу</h2>
              <button onClick={() => { setShowGroupModal(false); setGroupError(null); }} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <label className="block text-sm text-slate-200">
                Название группы
                <input
                  autoFocus
                  maxLength={100}
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  className="mt-2 w-full rounded-2xl border-white/10 bg-slate-950 px-4 py-3 text-white"
                  placeholder="Название группы"
                />
              </label>
              <div>
                <div className="mb-2 text-sm text-slate-300">
                  Добавить участников (необязательно)
                </div>
                <div className="flex items-center gap-2">
                  <Search size={16} className="text-slate-400" />
                  <input
                    value={peopleSearch}
                    onChange={(e) => setPeopleSearch(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-400 focus:outline-none"
                    placeholder="Поиск для добавления…"
                  />
                </div>
                {peopleSearch.trim() && people.length > 0 && (
                  <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                    {people.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          if (groupMemberIds.includes(p.id)) {
                            setGroupMemberIds((prev) => prev.filter((id) => id !== p.id))
                          } else {
                            setGroupMemberIds((prev) => [...prev, p.id])
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                      >
                        <span className={groupMemberIds.includes(p.id) ? 'text-cyan-400' : 'text-slate-400'}>
                          {groupMemberIds.includes(p.id) ? '✓' : '○'}
                        </span>
                        {p.name} (@{p.username})
                      </button>
                    ))}
                  </div>
                )}
                {groupMemberIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {groupMemberIds.map((id) => {
                      const p = people.find((pp) => pp.id === id)
                      return p ? (
                        <span key={id} className="flex items-center gap-1 rounded-full bg-cyan-500/20 px-3 py-1 text-xs text-cyan-200">
                          {p.name}
                          <button onClick={() => setGroupMemberIds((prev) => prev.filter((x) => x !== id))} className="ml-1 text-cyan-400 hover:text-white">×</button>
                        </span>
                      ) : null
                    })}
                  </div>
                )}
              </div>
              {groupError ? <div role="alert" className="text-sm text-red-300">{groupError}</div> : null}
              <button
                onClick={() => void handleCreateGroup()}
                disabled={groupCreating || !groupTitle.trim()}
                className="w-full rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                {groupCreating ? 'Создаём…' : 'Создать группу'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно пересылки */}
      {forwardingMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Переслать сообщение</h2>
              <button onClick={() => setForwardingMessage(null)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              «{forwardingMessage.content.slice(0, 80)}…»
            </p>
            <div className="mt-4 space-y-2">
              <div className="text-sm font-medium text-slate-200">Выберите чат:</div>
              {conversations
                .filter((c) => c.memberIds.includes(user.id))
                .slice(0, 10)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { void handleForwardSend(c.id); setForwardingMessage(null); }}
                    className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
                  >
                    {c.avatarUrl ? (
                      <img src={c.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-200">
                        {c.title.slice(0, 1).toLocaleUpperCase('ru-RU')}
                      </div>
                    )}
                    <span className="truncate">{c.title}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {activeView === 'calls' ? (
        <div className="space-y-4 p-4 md:p-6">
          <div className="text-lg font-semibold text-white">История звонков</div>
          {callHistoryLoading ? (
            <div className="text-sm text-slate-400">Загружаем…</div>
          ) : callHistory.length === 0 ? (
            <div className="rounded-[28px] border border-white/10 bg-slate-950/50 p-6 text-center text-slate-300">
              Звонков пока не было. Начните аудио- или видеозвонок из личного чата.
            </div>
          ) : (
            <div className="space-y-2">
              {callHistory.map((call) => {
                const conversation = conversations.find((c) => c.id === call.conversationId)
                const Icon = call.mode === 'video' ? Video : Phone
                const isIncoming = call.createdBy !== user.id
                return (
                  <div key={call.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${call.status === 'missed' ? 'bg-red-500/20 text-red-300' : 'bg-cyan-500/15 text-cyan-300'}`}>
                        <Icon size={18} />
                      </div>
                      <div>
                        <div className="font-medium text-white">{conversation?.title ?? 'Неизвестный чат'}</div>
                        <div className="text-xs text-slate-400">
                          {isIncoming ? 'Входящий' : 'Исходящий'} · {formatConversationTime(call.startedAt)}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-slate-400">
                      {call.status === 'missed' ? 'Пропущенный' : call.status === 'ended' ? 'Завершён' : call.status === 'active' ? 'Активен' : call.status}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}

      {activeView === 'settings' ? (
        <div className="space-y-5 p-4 md:p-6">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-[28px] border border-white/10 bg-slate-950/50 p-5">
              <div className="text-lg font-semibold text-white">Аккаунт</div>
              <div className="mt-3 space-y-3 text-sm text-slate-300">
                <div className="flex justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"><span>Имя</span><span className="text-right">{user.name}</span></div>
                <div className="flex justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"><span>Никнейм</span><span className="text-right">@{user.username}</span></div>
                <div className="flex justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"><span>Телефон</span><span className="text-right">{user.phone || 'Не указан'}</span></div>
                <div className="flex justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"><span>Электронная почта</span><span className="text-right">{user.email}</span></div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-[28px] border border-white/10 bg-slate-950/50 p-5">
                <div className="text-lg font-semibold text-white">Безопасность сообщений</div>
                <p className="mt-3 text-sm text-slate-300">
                  Чтение и отправка сообщений проверяются Supabase по членству в переписке. Email и закрытые поля чужих профилей клиенту не передаются.
                </p>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-slate-950/50 p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold text-white">Заблокированные</div>
                  <button
                    onClick={() => void loadBlockedUsers()}
                    className="text-sm text-cyan-300 hover:text-cyan-200"
                  >
                    Обновить
                  </button>
                </div>
                {blockedLoading ? (
                  <div className="mt-3 text-sm text-slate-400">Загружаем…</div>
                ) : blockedUsers.length === 0 ? (
                  <div className="mt-3 text-sm text-slate-400">Нет заблокированных пользователей</div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {blockedUsers.map((blocked) => (
                      <div key={blocked.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                        <span>{blocked.name}</span>
                        <button
                          onClick={() => void handleUnblockUser(blocked.id)}
                          className="text-xs text-cyan-300 hover:text-cyan-200"
                        >
                          Разблокировать
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Уведомления */}
          <div className="rounded-[28px] border border-white/10 bg-slate-950/50 p-5">
            <div className="text-lg font-semibold text-white">Уведомления</div>
            {settingsLoading ? (
              <div className="mt-3 text-sm text-slate-400">Загрузка…</div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                  <span>Звуковые уведомления</span>
                  <button
                    onClick={() => setNotificationSettings((prev) => ({ ...prev, soundEnabled: !prev.soundEnabled }))}
                    className={`relative h-6 w-11 rounded-full transition ${notificationSettings.soundEnabled ? 'bg-cyan-500' : 'bg-slate-600'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${notificationSettings.soundEnabled ? 'left-5.5' : 'left-0.5'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                  <span>Уведомления о сообщениях</span>
                  <button
                    onClick={() => setNotificationSettings((prev) => ({ ...prev, messageNotifications: !prev.messageNotifications }))}
                    className={`relative h-6 w-11 rounded-full transition ${notificationSettings.messageNotifications ? 'bg-cyan-500' : 'bg-slate-600'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${notificationSettings.messageNotifications ? 'left-5.5' : 'left-0.5'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                  <span>Уведомления о звонках</span>
                  <button
                    onClick={() => setNotificationSettings((prev) => ({ ...prev, callNotifications: !prev.callNotifications }))}
                    className={`relative h-6 w-11 rounded-full transition ${notificationSettings.callNotifications ? 'bg-cyan-500' : 'bg-slate-600'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${notificationSettings.callNotifications ? 'left-5.5' : 'left-0.5'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                  <span>Уведомления о группах</span>
                  <button
                    onClick={() => setNotificationSettings((prev) => ({ ...prev, groupNotifications: !prev.groupNotifications }))}
                    className={`relative h-6 w-11 rounded-full transition ${notificationSettings.groupNotifications ? 'bg-cyan-500' : 'bg-slate-600'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${notificationSettings.groupNotifications ? 'left-5.5' : 'left-0.5'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                  <span>Push-уведомления</span>
                  <button
                    onClick={() => setNotificationSettings((prev) => ({ ...prev, pushEnabled: !prev.pushEnabled }))}
                    className={`relative h-6 w-11 rounded-full transition ${notificationSettings.pushEnabled ? 'bg-cyan-500' : 'bg-slate-600'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${notificationSettings.pushEnabled ? 'left-5.5' : 'left-0.5'}`} />
                  </button>
                </div>
                <div className="flex justify-end gap-2">
                  {settingsSaved ? <span className="text-xs text-emerald-300">Сохранено ✓</span> : null}
                  <button
                    onClick={() => void saveNotificationSettings()}
                    disabled={settingsLoading}
                    className="rounded-2xl bg-cyan-500 px-5 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
                  >
                    Сохранить настройки
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Удаление аккаунта */}
          <div className="rounded-[28px] border border-red-500/30 bg-red-500/5 p-5">
            <div className="text-lg font-semibold text-red-300">Опасная зона</div>
            <p className="mt-2 text-sm text-slate-300">
              Удаление аккаунта необратимо. Все ваши данные, переписки и файлы будут удалены без возможности восстановления.
            </p>
            {!showDeleteModal ? (
              <button
                onClick={() => setShowDeleteModal(true)}
                className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-3 text-sm font-medium text-red-200 hover:bg-red-500/20"
              >
                Удалить аккаунт
              </button>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-sm text-red-200">
                  Введите <strong>УДАЛИТЬ</strong> для подтверждения:
                  <input
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-red-500/30 bg-slate-950/60 px-4 py-3 text-white"
                    placeholder="УДАЛИТЬ"
                  />
                </label>
                {deleteError ? <div className="text-sm text-red-300">{deleteError}</div> : null}
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); setDeleteError(null) }}
                    className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-slate-300"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={() => void handleDeleteAccount()}
                    disabled={deletingAccount || deleteConfirmText !== 'УДАЛИТЬ'}
                    className="rounded-2xl bg-red-500 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {deletingAccount ? 'Удаляем…' : 'Удалить навсегда'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activeView === 'profile' ? (
        <div className="p-4 md:p-6">
          <div className="rounded-[32px] border border-white/10 bg-slate-950/50 p-6">
            <form className="mb-8 grid gap-4 md:grid-cols-2" onSubmit={handleProfileSave}>
              <label className="space-y-2 text-sm text-slate-200">Имя<input required maxLength={80} value={profileName} onChange={(event) => setProfileName(event.target.value)} className="w-full rounded-2xl border-white/10 bg-slate-900 px-4 py-3 text-white" /></label>
              <label className="space-y-2 text-sm text-slate-200">Никнейм<input required maxLength={32} value={profileUsername} onChange={(event) => setProfileUsername(event.target.value)} className="w-full rounded-2xl border-white/10 bg-slate-900 px-4 py-3 text-white" /></label>
              <label className="space-y-2 text-sm text-slate-200">Телефон<input maxLength={20} value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} className="w-full rounded-2xl border-white/10 bg-slate-900 px-4 py-3 text-white" placeholder="+14155550198" /></label>
              <label className="space-y-2 text-sm text-slate-200 md:col-span-2">О себе<textarea maxLength={500} value={profileBio} onChange={(event) => setProfileBio(event.target.value)} className="w-full rounded-2xl border-white/10 bg-slate-900 px-4 py-3 text-white" rows={3} /></label>
              {profileError ? <div role="alert" className="text-sm text-red-300 md:col-span-2">{profileError}</div> : null}
              {profileMessage ? <div role="status" className="text-sm text-emerald-300 md:col-span-2">{profileMessage}</div> : null}
              <button disabled={profileSaving} className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60 md:col-span-2">{profileSaving ? 'Сохраняем…' : 'Сохранить профиль'}</button>
            </form>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
              {user.avatar ? (
                <img src={user.avatar} alt="" className="h-28 w-28 rounded-full object-cover" />
              ) : (
                <div className="flex h-28 w-28 items-center justify-center rounded-full bg-cyan-500/15 text-3xl text-cyan-200">
                  {user.name.slice(0, 1).toLocaleUpperCase('ru-RU')}
                </div>
              )}
              <div className="flex-1">
                <div className="text-3xl font-semibold text-white">{user.name}</div>
                <div className="mt-1 text-slate-300">@{user.username}</div>
                {user.phone ? <div className="mt-1 text-sm text-slate-300">{user.phone}</div> : null}
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                  {user.bio || 'Расскажите о себе в профиле.'}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarUploading}
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50"
                  >
                    {avatarUploading ? 'Загрузка…' : 'Загрузить фото'}
                  </button>
                  {user.avatar ? (
                    <button
                      onClick={() => void handleDeleteAvatar()}
                      disabled={avatarUploading}
                      className="rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200 hover:bg-red-500/15 disabled:opacity-50"
                    >
                      Удалить фото
                    </button>
                  ) : null}
                </div>
              </div>
              <button className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950">
                <ArrowUpRight size={16} />
                Поделиться профилем
              </button>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Статус</div>
                <div className="mt-2 flex items-center gap-2 text-lg font-medium text-white">
                  <span className="inline-block h-3 w-3 rounded-full bg-emerald-400" />
                  В сети
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Телефон</div>
                <div className="mt-2 text-lg font-medium text-white">{user.phone || 'Не указан'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Дата регистрации</div>
                <div className="mt-2 text-lg font-medium text-white">
                  {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(user.createdAt))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Оверлей активного звонка */}
      {activeCallInfo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6 text-center">
            <div className="text-2xl font-semibold text-white">{activeCallInfo.peerName}</div>
            <div className="mt-1 text-sm text-slate-400">
              {activeCallInfo.mode === 'video' ? 'Видеозвонок' : 'Аудиозвонок'} ·{' '}
              {activeCallInfo.status === 'ringing' ? 'Вызов…' :
                activeCallInfo.status === 'connecting' ? 'Соединение…' :
                activeCallInfo.status === 'connected' ? 'Разговор' :
                activeCallInfo.status === 'ended' ? 'Завершён' :
                activeCallInfo.status === 'declined' ? 'Отклонён' :
                activeCallInfo.status === 'busy' ? 'Занято' :
                activeCallInfo.status === 'failed' ? 'Ошибка' :
                activeCallInfo.status === 'missed' ? 'Пропущен' : activeCallInfo.status}
             </div>
            <audio ref={remoteAudioRef} autoPlay playsInline />

            {callAudioBlocked && activeCallInfo.mode === 'audio' ? (
              <button
                onClick={tryPlayRemoteAudio}
                className="mt-4 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
              >
                Включить звук собеседника
              </button>
            ) : null}

            {activeCallInfo.mode === 'video' ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <video ref={remoteVideoRef} autoPlay playsInline className="rounded-xl bg-slate-950 object-cover" />
                <video ref={localVideoRef} autoPlay playsInline muted className="rounded-xl bg-slate-950 object-cover" />
              </div>
            ) : null}
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={handleToggleMic}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-full border transition ${callMuted ? 'border-red-500 bg-red-500/20 text-red-300' : 'border-white/10 bg-white/5 text-slate-200 hover:text-cyan-300'}`}
                title={callMuted ? 'Включить микрофон' : 'Выключить микрофон'}
              >
                {callMuted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              {activeCallInfo.mode === 'video' ? (
                <button
                  onClick={handleToggleCamera}
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-full border transition ${!callCameraOn ? 'border-red-500 bg-red-500/20 text-red-300' : 'border-white/10 bg-white/5 text-slate-200 hover:text-cyan-300'}`}
                  title={callCameraOn ? 'Выключить камеру' : 'Включить камеру'}
                >
                  {callCameraOn ? <Video size={18} /> : <VideoOff size={18} />}
                </button>
              ) : null}
              <button
                onClick={handleHangupCall}
                className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                title="Завершить звонок"
              >
                <PhoneOff size={18} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Баннер входящего звонка */}
      {incomingCall ? (
        <div className="fixed inset-x-0 top-4 z-50 mx-auto w-full max-w-sm rounded-2xl border border-cyan-500/30 bg-slate-900 p-4 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium text-white">{incomingCall.fromName}</div>
              <div className="text-xs text-slate-400">
                Входящий {incomingCall.mode === 'video' ? 'видеозвонок' : 'аудиозвонок'}…
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAnswerCall}
                className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-600"
              >
                Ответить
              </button>
              <button
                onClick={handleDeclineCall}
                className="rounded-full bg-red-500 px-4 py-2 text-xs font-medium text-white hover:bg-red-600"
              >
                Отклонить
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Панель уведомлений */}
      {showNotificationPanel ? (
        <NotificationPanel
          onClose={() => setShowNotificationPanel(false)}
          onSelectConversation={(convId) => { setSelectedConversationId(convId); setActiveView('chats') }}
        />
      ) : null}

      {/* Видеосообщение (кружок) */}
      {showVideoRecorder ? (
        <VideoMessageRecorder
          onSend={(blob, mime) => void handleSendVideoMessage(blob, mime)}
          onCancel={() => setShowVideoRecorder(false)}
        />
      ) : null}
    </AppShell>
  )
}
