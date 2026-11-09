import { supabase } from '../lib/supabase'

const requireClient = () => {
  if (!supabase) {
    throw new Error('Подключение к Supabase не настроено.')
  }
  return supabase
}

export interface UserSettings {
  soundEnabled: boolean
  pushEnabled: boolean
  messageNotifications: boolean
  callNotifications: boolean
  groupNotifications: boolean
  showPreview: boolean
}

/** Загрузить настройки пользователя. */
export const loadUserSettings = async (): Promise<UserSettings> => {
  const client = requireClient()
  const { data, error } = await client.rpc('nexora_get_user_settings')
  if (error) throw error
  return (data as UserSettings) ?? {
    soundEnabled: true,
    pushEnabled: false,
    messageNotifications: true,
    callNotifications: true,
    groupNotifications: true,
    showPreview: true,
  }
}

/** Обновить настройки пользователя. */
export const updateUserSettings = async (
  settings: Partial<Omit<UserSettings, 'showPreview'>>,
): Promise<void> => {
  const client = requireClient()
  const { error } = await client.rpc('nexora_update_user_settings', {
    p_sound_enabled: settings.soundEnabled,
    p_push_enabled: settings.pushEnabled,
    p_message_notifications: settings.messageNotifications,
    p_call_notifications: settings.callNotifications,
    p_group_notifications: settings.groupNotifications,
  })
  if (error) throw error
}

/** Подписка на изменения настроек через Realtime. */
export const subscribeToSettingsChanges = (
  onUpdate: () => void,
): (() => void) => {
  const client = requireClient()

  const channel = client
    .channel('nexora-settings')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_settings',
        filter: `user_id=eq.${requireClient().auth.getUser().then(r => r.data?.user?.id)}`,
      },
      () => {
        onUpdate()
      },
    )
    .subscribe()

  return () => {
    void client.removeChannel(channel)
  }
}
