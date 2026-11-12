import { supabase } from '../lib/supabase'

// ============================================================================
// Типы
// ============================================================================

export interface ChatProfile {
  id: string
  name: string
  username: string
  avatarUrl: string | null
  bio: string
  status: 'online' | 'offline'
  lastSeen: string | null
}

export interface ChatMessage {
  id: string
  conversationId: string
  senderId: string
  content: string
  createdAt: string
  type: 'text' | 'image' | 'video' | 'file' | 'voice'
  editedAt: string | null
  deletedAt: string | null
  replyTo?: string | null
  forwardOf?: string | null
}

export interface MessageReaction {
  emoji: string
  count: number
  userIds: string[]
}

export interface ChatConversation {
  id: string
  type: 'direct' | 'group'
  title: string
  avatarUrl: string | null
  updatedAt: string
  memberIds: string[]
  peer: ChatProfile | null
  lastMessage: ChatMessage | null
}

export interface MessagePage {
  messages: ChatMessage[]
  hasMore: boolean
}

// ============================================================================
// Внутренние мапперы
// ============================================================================

interface ProfileRow {
  id: string
  name: string
  username: string
  avatar_url: string | null
  bio: string | null
  status: string
  last_seen: string | null
}

interface MessageRow {
  id: string
  conversation_id: string
  sender_id: string
  content: string | null
  message_type: ChatMessage['type']
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

const PAGE_SIZE = 50
const nonTextContent: Record<ChatMessage['type'], string> = {
  text: '',
  image: 'Изображение',
  video: 'Видео',
  file: 'Файл',
  voice: 'Голосовое сообщение',
}

const requireClient = () => {
  if (!supabase) {
    throw new Error('Подключение к Supabase не настроено. Проверьте переменные окружения.')
  }
  return supabase
}

const toChatMessage = (row: {
  id: string
  conversation_id: string
  sender_id: string
  content: string | null
  message_type: ChatMessage['type']
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  reply_to?: string | null
  forward_of?: string | null
}): ChatMessage => ({
  id: row.id,
  conversationId: row.conversation_id,
  senderId: row.sender_id,
  content: row.deleted_at ? 'Сообщение удалено' : row.content ?? nonTextContent[row.message_type],
  createdAt: row.created_at,
  type: row.message_type,
  editedAt: row.edited_at,
  deletedAt: row.deleted_at,
  replyTo: row.reply_to ?? null,
  forwardOf: row.forward_of ?? null,
})

const toChatProfile = (row: {
  id: string
  name: string
  username: string
  avatar_url: string | null
  bio: string | null
  status: string
  last_seen: string | null
}): ChatProfile => ({
  id: row.id,
  name: row.name,
  username: row.username,
  avatarUrl: row.avatar_url,
  bio: row.bio ?? '',
  // Не доверяем сохранённому status без свежего heartbeat:
  // вкладка может закрыться аварийно, и pagehide не всегда успевает отправить offline.
  // Heartbeat приходит каждые 25 секунд; 75 секунд дают запас на задержки сети/фоновой вкладки.
  status:
    row.status === 'online' &&
    !!row.last_seen &&
    Date.now() - new Date(row.last_seen).getTime() <= 75_000
      ? 'online'
      : 'offline',
  lastSeen: row.last_seen,
})

export const loadConversations = async (userId: string): Promise<ChatConversation[]> => {
  const client = requireClient()
  const { data: memberRows, error: memberError } = await client
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId)

  if (memberError) throw memberError
  const conversationIds = [...new Set((memberRows ?? []).map((row) => row.conversation_id))]
  if (!conversationIds.length) return []

  const { data: conversationRows, error: conversationError } = await client
    .from('conversations')
    .select('id,type,title,avatar_url,updated_at')
    .in('id', conversationIds)
    .order('updated_at', { ascending: false })

  if (conversationError) throw conversationError
  if (!conversationRows?.length) return []

  const { data: allMemberRows, error: allMembersError } = await client
    .from('conversation_members')
    .select('conversation_id,user_id')
    .in('conversation_id', conversationRows.map((row) => row.id))

  if (allMembersError) throw allMembersError
  const memberIdsByConversation = new Map<string, string[]>()
  for (const row of allMemberRows ?? []) {
    const members = memberIdsByConversation.get(row.conversation_id) ?? []
    members.push(row.user_id)
    memberIdsByConversation.set(row.conversation_id, members)
  }

  const peerIds = [...new Set(
    [...memberIdsByConversation.values()].flat().filter((id) => id !== userId),
  )]
  const [profileResult, messageResult] = await Promise.all([
    peerIds.length
      ? client.rpc('nexora_get_profiles', { p_user_ids: peerIds })
      : Promise.resolve({ data: [], error: null }),
    client.rpc('nexora_latest_messages', {
      p_conversation_ids: conversationRows.map((row) => row.id),
    }),
  ])
  if (profileResult.error) throw profileResult.error
  if (messageResult.error) throw messageResult.error

  const latestMessageRows: MessageRow[] = messageResult.data ?? []
  const profiles = new Map(
    (profileResult.data ?? []).map((row: ProfileRow) => {
      const profile = toChatProfile(row)
      return [profile.id, profile]
    }),
  )
  const latestMessages = new Map<string, ChatMessage>()
  for (const row of latestMessageRows) {
    if (!latestMessages.has(row.conversation_id)) {
      latestMessages.set(row.conversation_id, toChatMessage(row))
    }
  }

  return conversationRows.map((row) => {
    const memberIds = memberIdsByConversation.get(row.id) ?? []
    const peer = memberIds
      .filter((memberId) => memberId !== userId)
      .map((memberId) => profiles.get(memberId))
      .find((profile): profile is ChatProfile => Boolean(profile)) ?? null
    return {
      id: row.id,
      type: row.type === 'group' ? 'group' : 'direct',
      title: row.title ?? peer?.name ?? 'Переписка',
      avatarUrl: row.avatar_url ?? peer?.avatarUrl ?? null,
      updatedAt: row.updated_at,
      memberIds,
      peer,
      lastMessage: latestMessages.get(row.id) ?? null,
    }
  })
}

export const loadMessages = async (
  conversationId: string,
  before?: Pick<ChatMessage, 'createdAt' | 'id'>,
): Promise<MessagePage> => {
  const client = requireClient()
  let query = client
    .from('messages')
    .select('id,conversation_id,sender_id,content,message_type,created_at,edited_at,deleted_at,reply_to,forward_of')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE + 1)

  if (before) {
    query = query.or(
      `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
    )
  }
  const { data, error } = await query
  if (error) throw error

  const rows = data ?? []
  const hasMore = rows.length > PAGE_SIZE
  const page = rows.slice(0, PAGE_SIZE).map(toChatMessage).reverse()
  return { messages: page, hasMore }
}

export const sendMessage = async (
  conversationId: string,
  senderId: string,
  content: string,
  options?: { replyTo?: string; forwardOf?: string },
) => {
  const client = requireClient()
  const { data, error } = await client
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content,
      message_type: 'text',
      reply_to: options?.replyTo ?? null,
      forward_of: options?.forwardOf ?? null,
    })
    .select('id,conversation_id,sender_id,content,message_type,created_at,edited_at,deleted_at,reply_to,forward_of')
    .single()

  if (error) throw error
  return toChatMessage(data)
}

export const searchProfiles = async (search: string): Promise<ChatProfile[]> => {
  const { data, error } = await requireClient().rpc('nexora_search_profiles', {
    p_search: search.trim(),
  })
  if (error) throw error
  return (data ?? []).map((row: ProfileRow) => toChatProfile(row))
}

export const createDirectConversation = async (otherUserId: string) => {
  const { data, error } = await requireClient().rpc('nexora_create_direct_conversation', {
    p_other_user_id: otherUserId,
  })
  if (error) throw error
  if (!data) throw new Error('Supabase не вернул идентификатор переписки.')
  return data
}

interface MessageRowPayload {
  id: string
  conversation_id: string
  sender_id: string
  content: string | null
  message_type: ChatMessage['type']
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  reply_to?: string | null
  forward_of?: string | null
}

export const subscribeToConversationMessages = (
  conversationId: string | null,
  handlers: {
    onInsert: (message: ChatMessage) => void
    onUpdate?: (message: ChatMessage) => void
    onDelete?: (messageId: string) => void
    onStatus: (status: string) => void
  },
) => {
  if (!conversationId) {
    handlers.onStatus('CLOSED')
    return () => undefined
  }

  const channel = requireClient()
    .channel(`nexora-messages-${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        handlers.onInsert(toChatMessage(payload.new as MessageRowPayload))
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        handlers.onUpdate?.(toChatMessage(payload.new as MessageRowPayload))
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        handlers.onDelete?.((payload.old as { id: string }).id)
      },
    )
    .subscribe(handlers.onStatus)

  return () => {
    void requireClient().removeChannel(channel)
  }
}

// ============================================================================
// Реакции
// ============================================================================

export const addReaction = async (messageId: string, emoji: string): Promise<string> => {
  const { data, error } = await requireClient().rpc('nexora_add_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
  })
  if (error) throw error
  return data
}

export const removeReaction = async (messageId: string, emoji: string): Promise<void> => {
  const { error } = await requireClient().rpc('nexora_remove_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
  })
  if (error) throw error
}

export const getMessageReactions = async (messageId: string): Promise<MessageReaction[]> => {
  const { data, error } = await requireClient().rpc('nexora_get_message_reactions', {
    p_message_id: messageId,
  })
  if (error) throw error
  return (data ?? []).map((row: { emoji: string; count: number; user_ids: string[] }) => ({
    emoji: row.emoji,
    count: row.count,
    userIds: row.user_ids,
  }))
}

// Пакетная загрузка реакций для списка сообщений (RLS разрешает участникам чата).
const chunk = <T,>(items: T[], size: number): T[][] => {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

export const getMessageReactionsBatch = async (
  messageIds: string[],
): Promise<Record<string, MessageReaction[]>> => {
  if (!messageIds.length) return {}
  const client = requireClient()
  const grouped: Record<string, MessageReaction[]> = {}
  for (const ids of chunk(messageIds, 200)) {
    const { data, error } = await client
      .from('message_reactions')
      .select('message_id,user_id,emoji')
      .in('message_id', ids)
    if (error) throw error
    for (const row of (data ?? []) as { message_id: string; user_id: string; emoji: string }[]) {
      const list = grouped[row.message_id] ?? []
      const existing = list.find((reaction) => reaction.emoji === row.emoji)
      if (existing) {
        existing.count += 1
        existing.userIds.push(row.user_id)
      } else {
        list.push({ emoji: row.emoji, count: 1, userIds: [row.user_id] })
      }
      grouped[row.message_id] = list
    }
  }
  return grouped
}

// ============================================================================
// Редактирование и удаление сообщений
// ============================================================================

export const editMessage = async (messageId: string, newContent: string): Promise<string> => {
  const { data, error } = await requireClient().rpc('nexora_edit_message', {
    p_message_id: messageId,
    p_new_content: newContent.trim(),
  })
  if (error) throw error
  return data
}

export const deleteMessage = async (messageId: string): Promise<string> => {
  const { data, error } = await requireClient().rpc('nexora_delete_message', {
    p_message_id: messageId,
  })
  if (error) throw error
  return data
}

// ============================================================================
// Ответы и пересылка
// ============================================================================

export const replyToMessage = async (
  messageId: string,
  content: string,
  conversationId: string,
): Promise<string> => {
  const { data, error } = await requireClient().rpc('nexora_reply_to_message', {
    p_message_id: messageId,
    p_content: content.trim(),
    p_conversation_id: conversationId,
  })
  if (error) throw error
  return data
}

export const forwardMessage = async (
  messageId: string,
  targetConversationId: string,
): Promise<string> => {
  const { data, error } = await requireClient().rpc('nexora_forward_message', {
    p_message_id: messageId,
    p_target_conversation_id: targetConversationId,
  })
  if (error) throw error
  return data
}

// ============================================================================
// Поиск по сообщениям
// ============================================================================

export const searchMessages = async (
  conversationId: string,
  search: string,
  limit: number = 50,
): Promise<ChatMessage[]> => {
  const { data, error } = await requireClient().rpc('nexora_search_messages', {
    p_conversation_id: conversationId,
    p_search: search.trim(),
    p_limit: limit,
  })
  if (error) throw error
  return (data ?? []).map(toChatMessage)
}

// ============================================================================
// Индикатор набора текста
// ============================================================================

export const startTyping = async (conversationId: string): Promise<void> => {
  const client = requireClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) throw new Error('Требуется авторизация.')

  const { error } = await client.from('typing_indicators').upsert(
    { conversation_id: conversationId, user_id: user.id, started_at: new Date().toISOString() },
    { onConflict: 'conversation_id,user_id' },
  )
  if (error) throw error
}

export const stopTyping = async (conversationId: string): Promise<void> => {
  const client = requireClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) throw new Error('Требуется авторизация.')

  const { error } = await client
    .from('typing_indicators')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)
  if (error) throw error
}

export const subscribeToTyping = (
  conversationId: string | null,
  onTyping: (userId: string, isTyping: boolean) => void,
) => {
  if (!conversationId) return () => undefined

  const channel = requireClient()
    .channel(`nexora-typing-${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'typing_indicators',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        onTyping((payload.new as { user_id: string }).user_id, true)
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'typing_indicators',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        onTyping((payload.new as { user_id: string }).user_id, true)
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'typing_indicators',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        onTyping((payload.old as { user_id: string }).user_id, false)
      },
    )
    .subscribe()

  return () => {
    void requireClient().removeChannel(channel)
  }
}

// ============================================================================
// Статусы прочтения
// ============================================================================

export const markMessageAsRead = async (messageId: string): Promise<void> => {
  const client = requireClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) throw new Error('Требуется авторизация.')

  const { error } = await client
    .from('message_reads')
    .upsert(
      { message_id: messageId, user_id: user.id },
      { onConflict: 'message_id,user_id' },
    )
  if (error) throw error
}

export const getMessageReadStatus = async (messageId: string): Promise<string[]> => {
  const { data, error } = await requireClient()
    .from('message_reads')
    .select('user_id')
    .eq('message_id', messageId)
  if (error) throw error
  return (data ?? []).map((row: { user_id: string }) => row.user_id)
}

export interface MessageReadRow {
  messageId: string
  userId: string
}

// Пакетная загрузка статусов прочтения (RLS разрешает участникам чата).
export const getMessageReadStatuses = async (messageIds: string[]): Promise<MessageReadRow[]> => {
  if (!messageIds.length) return []
  const client = requireClient()
  const rows: MessageReadRow[] = []
  for (const ids of chunk(messageIds, 200)) {
    const { data, error } = await client
      .from('message_reads')
      .select('message_id,user_id')
      .in('message_id', ids)
    if (error) throw error
    for (const row of (data ?? []) as { message_id: string; user_id: string }[]) {
      rows.push({ messageId: row.message_id, userId: row.user_id })
    }
  }
  return rows
}

// ============================================================================
// Групповые чаты
// ============================================================================

export const createGroupConversation = async (
  title: string,
  memberIds: string[],
  avatarUrl?: string,
): Promise<string> => {
  const { data, error } = await requireClient().rpc('nexora_create_group_conversation', {
    p_title: title.trim(),
    p_member_ids: memberIds,
    p_avatar_url: avatarUrl ?? null,
  })
  if (error) throw error
  return data
}

export const addGroupMembers = async (
  conversationId: string,
  userIds: string[],
): Promise<void> => {
  const { error } = await requireClient().rpc('nexora_add_group_members', {
    p_conversation_id: conversationId,
    p_user_ids: userIds,
  })
  if (error) throw error
}

export const removeGroupMember = async (
  conversationId: string,
  userId: string,
): Promise<void> => {
  const { error } = await requireClient().rpc('nexora_remove_group_member', {
    p_conversation_id: conversationId,
    p_user_id: userId,
  })
  if (error) throw error
}


/** Permanently delete a group for all participants (owner only, enforced by RPC). */
export const deleteGroupConversation = async (conversationId: string): Promise<void> => {
  const { error } = await requireClient().rpc('nexora_delete_group', {
    p_conversation_id: conversationId,
  })
  if (error) throw error
}

/** Match explicitly imported phone numbers against registered, confirmed NEXORA accounts. */
export interface PhoneContactMatch {
  id: string
  name: string
  username: string
  avatar_url: string | null
  matched_phone: string
}

export const matchPhoneContacts = async (phoneNumbers: string[]): Promise<PhoneContactMatch[]> => {
  const normalized = [...new Set(phoneNumbers.map((value) => value.replace(/[^0-9]/g, '')).filter((value) => value.length >= 7))]
  if (!normalized.length) return []
  const { data, error } = await requireClient().rpc('nexora_match_phone_contacts', {
    p_phone_numbers: normalized,
  })
  if (error) throw error
  return (data ?? []) as PhoneContactMatch[]
}

export const leaveGroup = async (conversationId: string): Promise<void> => {
  const { error } = await requireClient().rpc('nexora_leave_group', {
    p_conversation_id: conversationId,
  })
  if (error) throw error
}

export const promoteGroupMember = async (
  conversationId: string,
  userId: string,
  role: 'owner' | 'admin' | 'member',
): Promise<void> => {
  const { error } = await requireClient().rpc('nexora_promote_member', {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_new_role: role,
  })
  if (error) throw error
}

// ============================================================================
// Блокировки пользователей
// ============================================================================

export const blockUser = async (userId: string): Promise<void> => {
  const { error } = await requireClient().rpc('nexora_block_user', {
    p_user_id: userId,
  })
  if (error) throw error
}

export const unblockUser = async (userId: string): Promise<void> => {
  const { error } = await requireClient().rpc('nexora_unblock_user', {
    p_user_id: userId,
  })
  if (error) throw error
}

export const getBlockedUsers = async (): Promise<ChatProfile[]> => {
  const { data, error } = await requireClient().rpc('nexora_get_blocked_users')
  if (error) throw error
  return (data ?? []).map((row: ProfileRow) => toChatProfile(row))
}

// ============================================================================
// Контакты
// ============================================================================

export const addContact = async (contactUserId: string): Promise<void> => {
  const { error } = await requireClient().rpc('nexora_add_contact', {
    p_contact_user_id: contactUserId,
  })
  if (error) throw error
}

export const removeContact = async (contactUserId: string): Promise<void> => {
  const { error } = await requireClient().rpc('nexora_remove_contact', {
    p_contact_user_id: contactUserId,
  })
  if (error) throw error
}

export const getContacts = async (): Promise<ChatProfile[]> => {
  const { data, error } = await requireClient().rpc('nexora_get_contacts')
  if (error) throw error
  return (data ?? []).map((row: ProfileRow) => toChatProfile(row))
}

// ============================================================================
// Статус онлайн
// ============================================================================

export const updateOnlineStatus = async (
  status: 'online' | 'offline',
  lastSeen?: string,
): Promise<void> => {
  const client = requireClient()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError) throw authError
  if (!user) return

  // Обновляем собственный профиль напрямую: RPC nexora_update_status
  // отсутствует в установленных миграциях, из-за чего heartbeat молча падал.
  const { error } = await client
    .from('profiles')
    .update({
      status,
      last_seen: lastSeen ?? new Date().toISOString(),
    })
    .eq('id', user.id)
  if (error) throw error
}

// ============================================================================
// Загрузка файлов в Storage
// ============================================================================

const MAX_FILE_SIZE = 25_000_000 // 25 MB
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-rar-compressed',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/flac',
])

const getFileCategory = (mimeType: string): ChatMessage['type'] => {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'voice'
  return 'file'
}

export const uploadFile = async (
  conversationId: string,
  file: File,
): Promise<{ storagePath: string; messageType: ChatMessage['type'] }> => {
  const client = requireClient()
  const session = client.auth.getSession().then((r) => r.data.session)
  if (!(await session)) throw new Error('Требуется авторизация.')
  const { data: { user } } = await client.auth.getUser()
  if (!user) throw new Error('Требуется авторизация.')

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`Файл слишком большой. Максимальный размер ${MAX_FILE_SIZE / 1_000_000} МБ.`)
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error(`Недопустимый тип файла: ${file.type || 'неизвестный'}.`)
  }

  const messageType = getFileCategory(file.type)
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${user.id}/${conversationId}/${Date.now()}_${safeName}`

  const { error } = await client.storage
    .from('nexora-media')
    .upload(storagePath, file, { upsert: false })

  if (error) throw error

  return { storagePath, messageType }
}

export const sendFileMessage = async (
  conversationId: string,
  senderId: string,
  file: File,
): Promise<ChatMessage> => {
  const { storagePath, messageType } = await uploadFile(conversationId, file)

  const { data: { session } } = await requireClient().auth.getSession()
  if (!session) throw new Error('Требуется авторизация.')

  const signedUrl = await requireClient().storage
    .from('nexora-media')
    .createSignedUrl(storagePath, 604800) // 7 дней

  const url = signedUrl.data?.signedUrl ?? storagePath
  const client = requireClient()
  const { data, error } = await client
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content: url,
      message_type: messageType,
    })
    .select('id,conversation_id,sender_id,content,message_type,created_at,edited_at,deleted_at,reply_to,forward_of')
    .single()

  if (error) throw error
  return toChatMessage(data)
}

export const getFileUrl = async (storagePath: string): Promise<string> => {
  const { data, error } = await requireClient().storage
    .from('nexora-media')
    .createSignedUrl(storagePath, 3600)
  if (error) throw error
  return data.signedUrl
}

export const deleteFile = async (storagePath: string): Promise<void> => {
  const { error } = await requireClient().storage
    .from('nexora-media')
    .remove([storagePath])
  if (error) throw error
}

// ============================================================================
// Голосовые сообщения
// ============================================================================

export const sendVoiceMessage = async (
  conversationId: string,
  senderId: string,
  audioBlob: Blob,
  mimeType: string = 'audio/webm',
): Promise<ChatMessage> => {
  const client = requireClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) throw new Error('Требуется авторизация.')

  const extension = mimeType.includes('mp4') ? 'm4a'
    : mimeType.includes('ogg') ? 'ogg'
    : 'webm'
  const storagePath = `${user.id}/${conversationId}/voice_${Date.now()}.${extension}`

  const { error: uploadError } = await client.storage
    .from('nexora-media')
    .upload(storagePath, audioBlob, { contentType: mimeType })

  if (uploadError) throw uploadError

  const { data: { session } } = await client.auth.getSession()
  if (!session) throw new Error('Требуется авторизация.')

  const signedUrl = await client.storage
    .from('nexora-media')
    .createSignedUrl(storagePath, 604800)

  const url = signedUrl.data?.signedUrl ?? storagePath

  const { data, error } = await client
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content: url,
      message_type: 'voice',
    })
    .select('id,conversation_id,sender_id,content,message_type,created_at,edited_at,deleted_at,reply_to,forward_of')
    .single()

  if (error) throw error
  return toChatMessage(data)
}
