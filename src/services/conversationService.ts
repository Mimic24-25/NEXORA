import { supabase } from '../lib/supabase'

const requireClient = () => {
  if (!supabase) {
    throw new Error('Подключение к Supabase не настроено.')
  }
  return supabase
}

/** Настройки чата для пользователя (из conversation_user_settings). */
export interface ConversationUserSettings {
  conversationId: string
  isPinned: boolean
  isArchived: boolean
  mutedUntil: string | null
  lastReadAt: string | null
}

/** Обновить настройки чата (pin/archive/mute/read). */
export const updateConversationSettings = async (
  conversationId: string,
  options: {
    isPinned?: boolean
    isArchived?: boolean
    mutedUntil?: string | null
    lastReadAt?: string
  },
): Promise<void> => {
  const client = requireClient()
  const { error } = await client.rpc('nexora_update_conversation_settings', {
    p_conversation_id: conversationId,
    p_is_pinned: options.isPinned,
    p_is_archived: options.isArchived,
    p_muted_until: options.mutedUntil,
    p_last_read_at: options.lastReadAt,
  })
  if (error) throw error
}

/** Загрузить настройки пользователя для списка чатов. */
export const loadConversationSettings = async (conversationIds: string[]): Promise<Map<string, ConversationUserSettings>> => {
  if (!conversationIds.length) return new Map()
  const client = requireClient()
  const { data, error } = await client.rpc('nexora_load_conversation_settings', {
    p_conversation_ids: conversationIds,
  })
  if (error) throw error
  const map = new Map<string, ConversationUserSettings>()
  for (const row of (data ?? []) as {
    conversation_id: string
    is_pinned: boolean
    is_archived: boolean
    muted_until: string | null
    last_read_at: string | null
  }[]) {
    map.set(row.conversation_id, {
      conversationId: row.conversation_id,
      isPinned: row.is_pinned,
      isArchived: row.is_archived,
      mutedUntil: row.muted_until,
      lastReadAt: row.last_read_at,
    })
  }
  return map
}

/** Обновить настройки группы (только owner/admin). */
export const updateGroupSettings = async (
  conversationId: string,
  options: {
    title?: string
    description?: string
    avatarUrl?: string | null
    canWrite?: boolean
    canSendFiles?: boolean
    canSendMedia?: boolean
  },
): Promise<void> => {
  const client = requireClient()
  const { error } = await client.rpc('nexora_update_group_settings', {
    p_conversation_id: conversationId,
    p_title: options.title,
    p_description: options.description,
    p_avatar_url: options.avatarUrl,
    p_can_write: options.canWrite,
    p_can_send_files: options.canSendFiles,
    p_can_send_media: options.canSendMedia,
  })
  if (error) throw error
}

/** Загрузить полную информацию о группе. */
export const loadGroupInfo = async (conversationId: string): Promise<Record<string, unknown>> => {
  const client = requireClient()
  const { data, error } = await client.rpc('nexora_get_group_info', {
    p_conversation_id: conversationId,
  })
  if (error) throw error
  if (!data) throw new Error('Группа не найдена.')
  return data as Record<string, unknown>
}

/** Загрузить профиль другого пользователя. */
export const loadUserProfile = async (userId: string): Promise<Record<string, unknown>> => {
  const client = requireClient()
  const { data, error } = await client.rpc('nexora_get_user_profile', {
    p_user_id: userId,
  })
  if (error) throw error
  if (!data) throw new Error('Профиль не найден.')
  return data as Record<string, unknown>
}

/**
 * Обновить аватар пользователя через загрузку в storage + обновление профиля.
 */
export const uploadAvatar = async (file: File): Promise<string> => {
  const client = requireClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) throw new Error('Требуется авторизация.')

  if (file.size > 5_000_000) {
    throw new Error('Файл аватара слишком большой. Максимум 5 МБ.')
  }

  const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  if (!allowedMimes.has(file.type)) {
    throw new Error('Недопустимый формат аватара. Используйте JPG, PNG, WebP или GIF.')
  }

  const safeName = `avatar_${user.id}_${Date.now()}.png`
  const storagePath = `${user.id}/avatar/${safeName}`

  const { error: uploadError } = await client.storage
    .from('nexora-media')
    .upload(storagePath, file, { upsert: true })
  if (uploadError) throw uploadError

  const { data: urlData } = await client.storage
    .from('nexora-media')
    .createSignedUrl(storagePath, 604800)

  if (!urlData?.signedUrl) throw new Error('Не удалось получить URL аватара.')

  const { error: profileError } = await client
    .from('profiles')
    .update({ avatar_url: urlData.signedUrl })
    .eq('id', user.id)

  if (profileError) throw profileError

  return urlData.signedUrl
}

/** Удалить аватар пользователя. */
export const deleteAvatar = async (): Promise<void> => {
  const client = requireClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) throw new Error('Требуется авторизация.')

  const { error: _storageError } = await client.storage
    .from('nexora-media')
    .remove([`${user.id}/avatar/*`])
  // Не критично, если storage не настроен

  const { error: profileError } = await client
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', user.id)

  if (profileError) throw profileError
}

/** Очистить историю чата (сообщения текущего пользователя получают deleted_at). */
export const clearConversationHistory = async (conversationId: string): Promise<void> => {
  const client = requireClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) throw new Error('Требуется авторизация.')

  const { error } = await client.rpc('nexora_clear_conversation_history', {
    p_conversation_id: conversationId,
  })
  if (error) throw error
}

/** Удалить чат для себя (leave conversation + archive). */
export const deleteChatForMe = async (conversationId: string): Promise<void> => {
  const client = requireClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) throw new Error('Требуется авторизация.')

  // Помечаем как архивированный
  await updateConversationSettings(conversationId, { isArchived: true })

  // Удаляем из conversation_members (leave)
  const { error } = await client
    .from('conversation_members')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)

  if (error) throw error
}
