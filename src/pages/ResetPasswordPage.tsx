import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { validatePassword } from '../services/authService'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { user, isReady, updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [repeatedPassword, setRepeatedPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!validatePassword(password)) {
      setError('Пароль должен содержать не менее 8 символов, заглавную букву и цифру.')
      return
    }
    if (password !== repeatedPassword) {
      setError('Пароли не совпадают.')
      return
    }
    setSaving(true)
    try {
      await updatePassword(password)
      navigate('/app', { replace: true })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось изменить пароль.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-lg rounded-[28px] border-white/10 bg-slate-900 p-8 shadow-2xl shadow-slate-950/50">
        <h1 className="text-3xl font-semibold text-white">Новый пароль</h1>
        <p className="mt-3 text-slate-300">Задайте пароль для входа в NEXORA.</p>
        {isReady && !user ? <div role="alert" className="mt-5 rounded-2xl border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">Ссылка сброса недействительна или устарела. Запросите письмо повторно.</div> : null}
        {user ? (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm text-slate-200" htmlFor="new-password">Новый пароль</label>
            <input id="new-password" type="password" autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-2xl border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none focus:border-cyan-400" />
            <label className="block text-sm text-slate-200" htmlFor="repeat-password">Повторите пароль</label>
            <input id="repeat-password" type="password" autoComplete="new-password" required value={repeatedPassword} onChange={(event) => setRepeatedPassword(event.target.value)} className="w-full rounded-2xl border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none focus:border-cyan-400" />
            {error ? <div role="alert" className="rounded-2xl border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}
            <button type="submit" disabled={saving} className="w-full rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60">{saving ? 'Сохраняем…' : 'Сохранить пароль'}</button>
          </form>
        ) : null}
        <div className="mt-5"><Link to="/forgot-password" className="text-sm text-cyan-300">Запросить новую ссылку</Link></div>
      </div>
    </div>
  )
}
