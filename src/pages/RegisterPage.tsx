import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  getLobbyNotice,
  PENDING_CONFIRMATION_RESEND_AT_KEY,
  validateRegistration,
} from '../services/authService'

const initialForm = {
  name: '',
  username: '',
  phone: '',
  email: '',
  password: '',
  repeatedPassword: '',
}

export function RegisterPage() {
  const navigate = useNavigate()
  const { register } = useAuth()
  const [form, setForm] = useState(initialForm)
  const [showPassword, setShowPassword] = useState(false)
  const [showRepeatedPassword, setShowRepeatedPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const onChange = (field: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const validation = validateRegistration(form)
    if (Object.keys(validation).length > 0) {
      setErrors(validation)
      return
    }

    try {
      setIsSubmitting(true)
      const { emailAlreadyRegistered } = await register(form)
      window.sessionStorage.setItem('nexora-pending-confirmation-email', form.email.trim())
      if (!emailAlreadyRegistered) {
        window.sessionStorage.setItem(
          PENDING_CONFIRMATION_RESEND_AT_KEY,
          String(Date.now() + 60_000),
        )
      }
      navigate('/verify-email', {
        replace: true,
        state: { email: form.email.trim(), emailAlreadyRegistered },
      })
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : 'Не удалось создать аккаунт.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#0f172a_0%,#020817_36%,#020617_100%)] p-4">
      <div className="w-full max-w-5xl overflow-hidden rounded-[30px] border border-white/10 bg-slate-900/80 shadow-2xl shadow-slate-950/50 backdrop-blur-xl">
        <div className="grid min-h-[820px] lg:grid-cols-[0.9fr_1.1fr]">
          <div className="border-b border-white/10 bg-slate-950/60 p-8 lg:border-b-0 lg:border-r">
            <div className="text-xs uppercase tracking-[0.38em] text-cyan-300">NEXORA</div>
            <h1 className="mt-5 text-4xl font-semibold text-white">Создайте защищённый профиль.</h1>
            <p className="mt-4 text-base text-slate-300">
              Настройте профиль, параметры приватности и предпочтения для переписки.
            </p>

            <div className="mt-10 space-y-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-5 text-sm text-cyan-100">
              <div className="flex items-center gap-2 font-medium"><ShieldCheck size={18} /> Безопасность</div>
              <p>Мы проверяем надёжность пароля и уникальность никнейма. Доступ к личным данным защищён правилами разграничения доступа.</p>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              {getLobbyNotice()}
            </div>
          </div>

          <div className="flex items-center justify-center p-6 sm:p-10">
            <div className="w-full max-w-xl">
              <div className="mb-6">
                <div className="text-sm uppercase tracking-[0.28em] text-cyan-300">Регистрация</div>
                <h2 className="mt-3 text-3xl font-semibold text-white">Создать аккаунт</h2>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                {errors.form ? (
                  <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {errors.form}
                  </div>
                ) : null}
                <div>
                  <label className="mb-1 block text-sm text-slate-200">Имя</label>
                  <input
                    value={form.name}
                    onChange={(event) => onChange('name', event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                    placeholder="Введите имя"
                  />
                  {errors.name ? <div className="mt-1 text-sm text-red-300">{errors.name}</div> : null}
                </div>

                <div>
                  <label className="mb-1 block text-sm text-slate-200">Никнейм</label>
                  <input
                    value={form.username}
                    onChange={(event) => onChange('username', event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                    placeholder="Придумайте никнейм"
                  />
                  {errors.username ? <div className="mt-1 text-sm text-red-300">{errors.username}</div> : null}
                </div>

                <div>
                  <label className="mb-1 block text-sm text-slate-200">Номер телефона</label>
                  <input
                    value={form.phone}
                    onChange={(event) => onChange('phone', event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                    placeholder="+14155550198"
                  />
                  {errors.phone ? <div className="mt-1 text-sm text-red-300">{errors.phone}</div> : null}
                </div>

                <div>
                  <label className="mb-1 block text-sm text-slate-200">Электронная почта</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => onChange('email', event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                    placeholder="имя@example.com"
                  />
                  {errors.email ? <div className="mt-1 text-sm text-red-300">{errors.email}</div> : null}
                </div>

                <div>
                  <label className="mb-1 block text-sm text-slate-200">Пароль</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(event) => onChange('password', event.target.value)}
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
                  {errors.password ? <div className="mt-1 text-sm text-red-300">{errors.password}</div> : null}
                </div>

                <div>
                  <label className="mb-1 block text-sm text-slate-200">Повторите пароль</label>
                  <div className="relative">
                    <input
                      type={showRepeatedPassword ? 'text' : 'password'}
                      value={form.repeatedPassword}
                      onChange={(event) => onChange('repeatedPassword', event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 pr-12 text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20"
                      placeholder="Повторите пароль"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRepeatedPassword((current) => !current)}
                      className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-200"
                      aria-label={showRepeatedPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      title={showRepeatedPassword ? 'Скрыть пароль' : 'Показать пароль'}
                    >
                      {showRepeatedPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {errors.repeatedPassword ? (
                    <div className="mt-1 text-sm text-red-300">{errors.repeatedPassword}</div>
                  ) : null}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmitting ? 'Создаётся аккаунт…' : 'Создать аккаунт'}
                </button>
              </form>

              <div className="mt-5 text-sm text-slate-300">
                Уже есть аккаунт?{' '}
                <Link className="font-medium text-cyan-300 hover:text-cyan-200" to="/login">
                  Войти
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
