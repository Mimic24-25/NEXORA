import type { LoginPayload, RegistrationPayload } from '../types'

const normalizePhone = (value: string) => {
  const digits = value.replace(/\D/g, '')
  return `+${digits}`
}

export const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

export const validatePhone = (phone: string) => {
  const normalized = normalizePhone(phone)
  return normalized.length >= 10 && normalized.length <= 16
}

export const validatePassword = (password: string) => {
  return password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password)
}

export const validateRegistration = (payload: RegistrationPayload) => {
  const errors: Record<string, string> = {}

  if (!payload.name.trim()) errors.name = 'Укажите имя.'
  if (payload.name.trim().length > 80) errors.name = 'Имя не должно превышать 80 символов.'
  if (!payload.username.trim()) errors.username = 'Укажите никнейм.'
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(payload.username.trim())) {
    errors.username = 'Никнейм должен содержать от 3 до 32 латинских букв, цифр или символов _.'
  }
  if (!validatePhone(payload.phone)) errors.phone = 'Укажите корректный номер телефона, например +14155550198.'
  if (!validateEmail(payload.email)) errors.email = 'Укажите корректный адрес электронной почты.'
  if (!validatePassword(payload.password)) {
    errors.password = 'Пароль должен содержать не менее 8 символов, заглавную букву и цифру.'
  }
  if (payload.password !== payload.repeatedPassword) {
    errors.repeatedPassword = 'Пароли не совпадают.'
  }

  return errors
}

export const validateLogin = (payload: LoginPayload) => {
  const errors: Record<string, string> = {}

  if (!payload.identifier.trim()) errors.identifier = 'Введите адрес электронной почты или никнейм.'
  if (!payload.password) errors.password = 'Введите пароль.'

  return errors
}

export const formatPhone = (value: string) => normalizePhone(value)

export const getLobbyNotice = () =>
  'Вход и регистрация выполняются через Supabase Auth. Для подтверждения адреса должны быть включены письма и SMTP.'

const authErrorMessages: Record<string, string> = {
  email_not_confirmed: 'Подтвердите адрес электронной почты по ссылке из письма.',
  invalid_credentials: 'Неверный адрес электронной почты или пароль.',
  user_already_exists: 'Аккаунт с таким адресом уже существует. Попробуйте войти или запросить письмо повторно.',
  email_exists: 'Аккаунт с таким адресом уже существует. Попробуйте войти или запросить письмо повторно.',
  user_already_confirmed: 'Этот адрес уже подтверждён. Попробуйте войти в аккаунт.',
  weak_password: 'Пароль слишком простой. Используйте более надёжный пароль.',
  over_email_send_rate_limit: 'Слишком много запросов на отправку писем. Подождите и попробуйте снова.',
  email_address_invalid: 'Укажите корректный адрес электронной почты.',
  otp_expired: 'Ссылка подтверждения устарела. Запросите новое письмо.',
  otp_disabled: 'Ссылка подтверждения недействительна. Запросите новое письмо.',
}

export const getAuthErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code)
    if (authErrorMessages[code]) return authErrorMessages[code]
  }

  if (error instanceof Error && /fetch|network|failed to fetch/i.test(error.message)) {
    return 'Не удалось подключиться к Supabase. Проверьте подключение к интернету и настройки проекта.'
  }

  return fallback
}

export const PENDING_CONFIRMATION_EMAIL_KEY = 'nexora-pending-confirmation-email'
export const PENDING_CONFIRMATION_RESEND_AT_KEY = 'nexora-pending-confirmation-resend-at'
