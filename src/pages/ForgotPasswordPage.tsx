import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { validateEmail } from '../services/authService'

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    setError(null)
    if (!validateEmail(email)) {
      setError('Введите корректный адрес электронной почты.')
      return
    }
    setIsSending(true)
    try {
      await requestPasswordReset(email)
      setMessage('Если аккаунт с таким адресом существует, письмо для сброса пароля уже отправлено.')
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Не удалось отправить письмо.')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-lg rounded-[28px] border-white/10 bg-slate-900 p-8 shadow-2xl shadow-slate-950/50">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/15 text-2xl text-cyan-300">🔐</div>
        <h1 className="text-center text-3xl font-semibold text-white">Восстановление пароля</h1>
        <p className="mt-3 text-center text-slate-300">Укажите Email аккаунта. Мы отправим защищённую ссылку для создания нового пароля.</p>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm text-slate-200" htmlFor="reset-email">Электронная почта</label>
          <input id="reset-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-2xl border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none focus:border-cyan-400" placeholder="имя@example.com" />
          {message ? <div role="status" className="rounded-2xl border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</div> : null}
          {error ? <div role="alert" className="rounded-2xl border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}
          <button type="submit" disabled={isSending} className="w-full rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60">{isSending ? 'Отправляем…' : 'Отправить ссылку'}</button>
        </form>
        <div className="mt-5 text-center"><Link to="/login" className="text-sm text-cyan-300 hover:text-cyan-200">Вернуться ко входу</Link></div>
      </div>
    </div>
  )
}
