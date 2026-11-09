import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getLobbyNotice, validateLogin } from '../services/authService'

export function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    const validation = validateLogin({ identifier, password })
    if (Object.keys(validation).length > 0) {
      setError(Object.values(validation)[0])
      return
    }

    try {
      setIsSubmitting(true)
      await login({ identifier, password })
      navigate('/app', { replace: true })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось войти в аккаунт.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#0f172a_0%,#020817_36%,#020617_100%)] p-4">
      <div className="w-full max-w-6xl overflow-hidden rounded-[30px] border border-white/10 bg-slate-900/80 shadow-2xl shadow-slate-950/50 backdrop-blur-xl">
        <div className="grid min-h-[760px] lg:grid-cols-[1.1fr_0.9fr]">
          <div className="relative overflow-hidden border-b border-white/10 bg-slate-950/60 p-10 lg:border-b-0 lg:border-r">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.24),transparent_30%)]" />
            <div className="relative z-10 flex h-full flex-col justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.4em] text-cyan-300">NEXORA</div>
                <h1 className="mt-6 text-4xl font-semibold text-white md:text-5xl">Личные переписки и общение без задержек.</h1>
                <p className="mt-4 max-w-md text-base text-slate-300">
                  Безопасный обмен сообщениями, групповые чаты, звонки и удобная совместная работа.
                </p>
              </div>

              <div className="mt-10 grid gap-4 text-sm text-slate-200 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <ShieldCheck className="mb-3 text-cyan-300" size={20} />
                  Архитектура с поддержкой RLS
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <Mail className="mb-3 text-cyan-300" size={20} />
                  Авторизация через Supabase
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <LockKeyhole className="mb-3 text-cyan-300" size={20} />
                  Защищённые сеансы
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center p-6 sm:p-10">
            <div className="w-full max-w-md">
              <div className="mb-8">
                <div className="text-sm uppercase tracking-[0.28em] text-cyan-300">С возвращением</div>
                <h2 className="mt-3 text-3xl font-semibold text-white">Вход</h2>
              </div>

              <form className="space-y-5" onSubmit={handleSubmit} noValidate>
                <div>
                  <label className="mb-2 block text-sm text-slate-200">Электронная почта или никнейм</label>
                  <input
                    autoComplete="username"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                    placeholder="имя@example.com или никнейм"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-slate-200">Пароль</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 pr-12 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                      placeholder="Введите пароль"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-200"
                      aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {error ? (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                ) : null}

                <div className="flex items-center justify-between text-sm text-slate-300">
                  <Link className="hover:text-white" to="/forgot-password">
                    Забыли пароль?
                  </Link>
                  <Link className="hover:text-white" to="/register">
                    Создать аккаунт
                  </Link>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmitting ? 'Выполняется вход…' : 'Войти'}
                </button>
              </form>

              <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">
                {getLobbyNotice()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
