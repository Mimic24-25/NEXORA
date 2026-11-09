import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  PENDING_CONFIRMATION_EMAIL_KEY,
  PENDING_CONFIRMATION_RESEND_AT_KEY,
  validateEmail,
} from '../services/authService'

const getInitialCooldown = () => {
  const resendAt = Number(window.sessionStorage.getItem(PENDING_CONFIRMATION_RESEND_AT_KEY))
  return Number.isFinite(resendAt) ? Math.max(Math.ceil((resendAt - Date.now()) / 1000), 0) : 0
}

interface ConfirmationLocationState {
  email?: string
  emailAlreadyRegistered?: boolean
}

export function EmailConfirmationPage({ isCallback = false }: { isCallback?: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, isReady, resendConfirmation } = useAuth()
  const state = location.state as ConfirmationLocationState | null
  const [email, setEmail] = useState(
    state?.email ?? window.sessionStorage.getItem(PENDING_CONFIRMATION_EMAIL_KEY) ?? '',
  )
  const [secondsRemaining, setSecondsRemaining] = useState(getInitialCooldown)
  const [isSending, setIsSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const callbackError =
    isCallback && isReady && !user
      ? 'Ссылка подтверждения недействительна или устарела. Запросите новое письмо.'
      : null
  const isExistingAccount = state?.emailAlreadyRegistered ?? false

  useEffect(() => {
    if (!user) return
    window.sessionStorage.removeItem(PENDING_CONFIRMATION_EMAIL_KEY)
    const timeout = window.setTimeout(() => navigate('/app', { replace: true }), 1800)
    return () => window.clearTimeout(timeout)
  }, [navigate, user])

  useEffect(() => {
    if (secondsRemaining === 0) return
    const interval = window.setInterval(
      () => setSecondsRemaining((remaining) => Math.max(remaining - 1, 0)),
      1000,
    )
    return () => window.clearInterval(interval)
  }, [secondsRemaining])

  useEffect(() => {
    if (secondsRemaining === 0) {
      window.sessionStorage.removeItem(PENDING_CONFIRMATION_RESEND_AT_KEY)
    }
  }, [secondsRemaining])

  const handleResend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (!validateEmail(email)) {
      setError('Введите корректный адрес электронной почты.')
      return
    }

    try {
      setIsSending(true)
      await resendConfirmation(email)
      window.sessionStorage.setItem(PENDING_CONFIRMATION_EMAIL_KEY, email.trim())
      setSecondsRemaining(60)
      window.sessionStorage.setItem(
        PENDING_CONFIRMATION_RESEND_AT_KEY,
        String(Date.now() + 60_000),
      )
      setMessage('Письмо с подтверждением отправлено. Проверьте входящие и папку «Спам».')
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Не удалось повторно отправить письмо.')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-lg rounded-[28px] border border-white/10 bg-slate-900 p-8 text-center shadow-2xl shadow-slate-950/50">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/15 text-2xl text-cyan-300">
          {user ? '✓' : '✉'}
        </div>
        <h1 className="text-3xl font-semibold text-white">
          {user
            ? 'Адрес подтверждён'
            : callbackError
              ? 'Не удалось подтвердить адрес'
              : isCallback
                ? 'Проверяем ссылку'
                : 'Подтвердите электронную почту'}
        </h1>
        <p className="mt-3 text-slate-300">
          {user
            ? 'Спасибо! Сейчас вы автоматически вернётесь в NEXORA.'
            : isCallback && !callbackError
              ? 'Проверяем подтверждение в Supabase Auth. Это может занять несколько секунд.'
              : isExistingAccount
                ? 'Аккаунт с таким адресом уже существует. Попробуйте войти или запросите новое письмо с подтверждением.'
                : 'Для входа подтвердите адрес по ссылке из письма. Проверьте входящие и папку «Спам».'}
        </p>

        {!user && (!isCallback || callbackError) ? (
          <form className="mt-6 space-y-3 text-left" onSubmit={handleResend} noValidate>
            <label className="block text-sm text-slate-200" htmlFor="confirmation-email">
              Адрес электронной почты
            </label>
            <input
              id="confirmation-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
              placeholder="имя@example.com"
            />
            {message ? (
              <div role="status" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {message}
              </div>
            ) : null}
            {callbackError || error ? (
              <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {callbackError ?? error}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={isSending || secondsRemaining > 0}
              className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSending
                ? 'Отправляем письмо…'
                : secondsRemaining > 0
                  ? `Повторная отправка через ${secondsRemaining} с`
                  : 'Отправить письмо повторно'}
            </button>
          </form>
        ) : null}

        {!user ? (
          <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-slate-300">
            <Link className="hover:text-white" to="/register">
              Изменить адрес или создать аккаунт
            </Link>
            <Link className="hover:text-white" to="/login">
              Вернуться ко входу
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  )
}
