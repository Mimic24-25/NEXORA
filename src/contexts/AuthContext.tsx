import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { LoginPayload, RegistrationPayload, UserProfile } from '../types'
import { getAuthErrorMessage } from '../services/authService'

interface AuthContextValue {
  user: UserProfile | null
  isReady: boolean
  login: (payload: LoginPayload) => Promise<UserProfile>
  register: (payload: RegistrationPayload) => Promise<{ emailAlreadyRegistered: boolean }>
  resendConfirmation: (email: string) => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  logout: () => void
  updateProfile: (nextProfile: Partial<UserProfile>) => Promise<UserProfile>
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)
const USERS_STORAGE_KEY = 'nexora-users'
const LEGACY_SESSION_STORAGE_KEY = 'nexora-session'
const LEGACY_ACCOUNTS_STORAGE_KEY = 'nexora-accounts'

const getStoredProfile = (userId: string): Partial<UserProfile> => {
  const saved = window.localStorage.getItem(USERS_STORAGE_KEY)
  if (!saved) return {}

  try {
    const profiles = JSON.parse(saved) as UserProfile[]
    return profiles.find((profile) => profile.id === userId) ?? {}
  } catch {
    return {}
  }
}

const profileFromAuthUser = (authUser: User): UserProfile => {
  const metadata = authUser.user_metadata ?? {}
  const savedProfile = getStoredProfile(authUser.id)
  const email = authUser.email ?? ''

  return {
    id: authUser.id,
    name: String(metadata.name ?? savedProfile.name ?? email.split('@')[0] ?? 'Пользователь'),
    username: String(metadata.username ?? savedProfile.username ?? email.split('@')[0] ?? ''),
    phone: String(metadata.phone ?? savedProfile.phone ?? ''),
    email,
    avatar: String(metadata.avatar_url ?? savedProfile.avatar ?? ''),
    bio: String(metadata.bio ?? savedProfile.bio ?? ''),
    status: 'online',
    lastSeen: 'только что',
    createdAt: authUser.created_at,
    privacy: savedProfile.privacy ?? {
      phone: 'contacts',
      lastSeen: 'everyone',
      avatar: 'contacts',
    },
  }
}

const requireSupabase = () => {
  if (!supabase) {
    throw new Error(
      'Авторизация недоступна: настройте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в файле .env.',
    )
  }
  return supabase
}

const confirmationRedirectUrl = () => `${window.location.origin}/auth/confirm`

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isReady, setIsReady] = useState(!supabase)

  useEffect(() => {
    window.localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY)
    window.localStorage.removeItem(LEGACY_ACCOUNTS_STORAGE_KEY)

    if (!supabase) return

    let active = true
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      const authUser = session?.user
      setUser(authUser?.email_confirmed_at ? profileFromAuthUser(authUser) : null)
      setIsReady(true)
    })

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        setUser(null)
        setIsReady(true)
        return
      }

      const authUser = data.session?.user
      setUser(authUser?.email_confirmed_at ? profileFromAuthUser(authUser) : null)
      setIsReady(true)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const login = useCallback(async (payload: LoginPayload) => {
    const client = requireSupabase()
    const identifier = payload.identifier.trim()
    let data: Awaited<ReturnType<typeof client.auth.signInWithPassword>>['data']
    let error: Awaited<ReturnType<typeof client.auth.signInWithPassword>>['error']

    if (identifier.includes('@')) {
      const result = await client.auth.signInWithPassword({
        email: identifier,
        password: payload.password,
      })
      data = result.data
      error = result.error
    } else {
      const result = await client.functions.invoke('resolve-username', {
        body: { identifier, password: payload.password },
      })
      if (result.error) {
        throw new Error(getAuthErrorMessage(result.error, 'Неверный никнейм или пароль.'))
      }
      const session = result.data as { access_token?: string; refresh_token?: string } | null
      if (!session?.access_token || !session.refresh_token) {
        throw new Error('Неверный никнейм или пароль.')
      }
      const sessionResult = await client.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      })
      if (sessionResult.error || !sessionResult.data.user || !sessionResult.data.session) {
        throw new Error(getAuthErrorMessage(sessionResult.error, 'Не удалось создать сессию.'))
      }
      data = { user: sessionResult.data.user, session: sessionResult.data.session }
      error = null
    }

    if (error || !data.user) {
      throw new Error(getAuthErrorMessage(error, 'Неверный адрес электронной почты или пароль.'))
    }
    if (!data.user.email_confirmed_at) {
      await client.auth.signOut({ scope: 'local' })
      throw new Error('Подтвердите адрес электронной почты по ссылке из письма, прежде чем войти.')
    }

    const nextUser = profileFromAuthUser(data.user)
    setUser(nextUser)
    return nextUser
  }, [])

  const register = useCallback(async (payload: RegistrationPayload) => {
    const client = requireSupabase()
    const { data, error } = await client.auth.signUp({
      email: payload.email.trim(),
      password: payload.password,
      options: {
        emailRedirectTo: confirmationRedirectUrl(),
        data: {
          name: payload.name.trim(),
          username: payload.username.trim(),
          phone: payload.phone.trim(),
        },
      },
    })

    if (error) {
      throw new Error(getAuthErrorMessage(error, 'Не удалось создать аккаунт.'))
    }
    if (data.session) {
      await client.auth.signOut({ scope: 'local' })
      throw new Error(
        'Supabase сразу выполнил вход без подтверждения адреса. Включите подтверждение Email в настройках Supabase Auth.',
      )
    }
    return { emailAlreadyRegistered: data.user?.identities?.length === 0 }
  }, [])

  const resendConfirmation = useCallback(async (email: string) => {
    const client = requireSupabase()
    const { error } = await client.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: confirmationRedirectUrl() },
    })

    if (error) {
      throw new Error(getAuthErrorMessage(error, 'Не удалось повторно отправить письмо.'))
    }
  }, [])

  const requestPasswordReset = useCallback(async (email: string) => {
    const client = requireSupabase()
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    if (error) throw new Error(getAuthErrorMessage(error, 'Не удалось отправить письмо для сброса пароля.'))
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    const client = requireSupabase()
    const { data, error } = await client.auth.updateUser({ password })
    if (error) throw new Error(getAuthErrorMessage(error, 'Не удалось изменить пароль.'))
    if (data.user) setUser(profileFromAuthUser(data.user))
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    if (supabase) {
      void supabase.auth.signOut().then(({ error }) => {
        if (error) console.error('Не удалось завершить сеанс Supabase:', error.message)
      })
    }
  }, [])

  const updateProfile = useCallback(async (nextProfile: Partial<UserProfile>) => {
    if (!user) throw new Error('Войдите в аккаунт, чтобы изменить профиль.')

    const client = requireSupabase()
    const fields: Record<string, string | null> = {}
    if (nextProfile.name !== undefined) fields.name = nextProfile.name.trim()
    if (nextProfile.username !== undefined) fields.username = nextProfile.username.trim().toLowerCase()
    if (nextProfile.phone !== undefined) fields.phone = nextProfile.phone.trim()
    if (nextProfile.bio !== undefined) fields.bio = nextProfile.bio.trim()
    if (nextProfile.avatar !== undefined) fields.avatar_url = nextProfile.avatar || null
    const { error } = await client.from('profiles').update(fields).eq('id', user.id)
    if (error) {
      if (error.code === '23505') throw new Error('Этот никнейм уже занят.')
      throw new Error(getAuthErrorMessage(error, 'Не удалось сохранить профиль.'))
    }

    const nextUser = { ...user, ...nextProfile }
    const metadata: Record<string, string> = {}
    if (nextProfile.name !== undefined) metadata.name = nextProfile.name
    if (nextProfile.username !== undefined) metadata.username = nextProfile.username
    if (nextProfile.phone !== undefined) metadata.phone = nextProfile.phone
    if (nextProfile.bio !== undefined) metadata.bio = nextProfile.bio
    const { error: metadataError } = await client.auth.updateUser({ data: metadata })
    if (metadataError) throw new Error(getAuthErrorMessage(metadataError, 'Профиль сохранён, но не удалось синхронизировать данные аккаунта.'))
    setUser(nextUser)
    return nextUser
  }, [user])

  const deleteAccount = useCallback(async () => {
    const client = requireSupabase()
    const { error } = await client.functions.invoke('delete-account', {
      body: {},
    })
    if (error) {
      throw new Error(getAuthErrorMessage(error, 'Не удалось удалить аккаунт.'))
    }
    setUser(null)
    await client.auth.signOut()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, isReady, login, register, resendConfirmation, requestPasswordReset, updatePassword, logout, updateProfile, deleteAccount }),
    [user, isReady, login, register, resendConfirmation, requestPasswordReset, updatePassword, logout, updateProfile, deleteAccount],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth необходимо использовать внутри AuthProvider')
  }

  return context
}
