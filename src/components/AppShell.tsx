import type { ReactNode } from 'react'
import {
  Bell,
  LogOut,
  MessageSquareText,
  MoonStar,
  PhoneCall,
  Search,
  Settings,
  SunMedium,
  UserRound,
  Users,
} from 'lucide-react'
import type { UserProfile } from '../types'
import { useTheme } from '../contexts/ThemeContext'

export type AppView = 'chats' | 'calls' | 'people' | 'settings' | 'profile'

interface AppShellProps {
  user: UserProfile
  activeView: AppView
  onViewChange: (view: AppView) => void
  onLogout: () => void
  children: ReactNode
}

const navItems: Array<{ key: AppView; label: string; icon: typeof MessageSquareText }> = [
  { key: 'chats', label: 'Чаты', icon: MessageSquareText },
  { key: 'calls', label: 'Звонки', icon: PhoneCall },
  { key: 'people', label: 'Контакты', icon: Users },
  { key: 'settings', label: 'Настройки', icon: Settings },
  { key: 'profile', label: 'Профиль', icon: UserRound },
]

export function AppShell({ user, activeView, onViewChange, onLogout, children }: AppShellProps) {
  const { resolvedTheme, toggleTheme } = useTheme()

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-[1600px] gap-6 p-4 lg:p-6">
        <aside className="hidden w-[280px] flex-col rounded-[28px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl lg:flex">
          <div className="mb-7 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.32em] text-cyan-300">NEXORA</div>
              <div className="mt-2 text-xl font-semibold text-white">Мессенджер</div>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-slate-900/60 text-slate-200 transition hover:border-cyan-400/60 hover:text-cyan-300"
              aria-label={resolvedTheme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              title={resolvedTheme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
            >
              {resolvedTheme === 'dark' ? <SunMedium size={18} /> : <MoonStar size={18} />}
            </button>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-3">
            {user.avatar ? (
              <img src={user.avatar} alt={user.name} className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/25 text-lg text-cyan-200">
                {user.name.slice(0, 1).toLocaleUpperCase('ru-RU')}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{user.name}</div>
              <div className="text-xs text-slate-300">@{user.username}</div>
            </div>
          </div>

          <nav className="mt-8 space-y-2">
            {navItems.map(({ key, label, icon: Icon }) => (
              <button
                type="button"
                key={key}
                onClick={() => onViewChange(key)}
                className={[
                  'flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition',
                  activeView === key
                    ? 'bg-cyan-500/15 text-cyan-200 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-400/40'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white',
                ].join(' ')}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-auto space-y-3">
            <button
              type="button"
              onClick={onLogout}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-3 text-sm font-medium text-red-200 transition hover:border-red-400 hover:bg-red-500/15"
            >
              <LogOut size={16} />
              Выйти
            </button>
          </div>
        </aside>

        <div className="flex min-h-[calc(100vh-2rem)] flex-1 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-900/80 shadow-2xl shadow-slate-950/60 backdrop-blur-xl">
          <header className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-300 lg:hidden">
                <Search size={18} />
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-cyan-300">На связи</div>
                <div className="text-lg font-semibold text-white">NEXORA</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="hidden h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 md:inline-flex"
                aria-label="Уведомления"
                title="Уведомления"
              >
                <Bell size={18} />
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200"
                aria-label={resolvedTheme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
                title={resolvedTheme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              >
                {resolvedTheme === 'dark' ? <SunMedium size={18} /> : <MoonStar size={18} />}
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-hidden">{children}</div>
        </div>
      </div>
    </div>
  )
}
