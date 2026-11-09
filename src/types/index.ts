export type ThemeMode = 'dark' | 'light' | 'system'

export type PrivacyLevel = 'everyone' | 'contacts' | 'nobody'

export interface UserProfile {
  id: string
  name: string
  username: string
  phone: string
  email: string
  avatar: string
  bio: string
  status: 'online' | 'offline'
  lastSeen: string
  createdAt: string
  privacy: {
    phone: PrivacyLevel
    lastSeen: PrivacyLevel
    avatar: PrivacyLevel
  }
}

export interface RegistrationPayload {
  name: string
  username: string
  phone: string
  email: string
  password: string
  repeatedPassword: string
}

export interface LoginPayload {
  identifier: string
  password: string
}
