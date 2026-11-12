import type { ReactNode } from 'react'
import {
  LogOut,
  MessageSquareText,
  MoonStar,
  PhoneCall,
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
    <div className="h-[100dvh] min-h-0 overflow-hidden bg-slate-950 text-slate-50">
      <div className="mx-auto flex h-full min-h-0 max-w-[1800px] gap-4 p-0 lg:p-4">
        <aside className="hidden w-[250px] shrink-0 flex-col rounded-[26px] border border-white/10 bg-white/5 p-4 backdrop-blur-xl lg:flex">
          <div className="mb-7">
            <div className="text-xs uppercase tracking-[0.32em] text-cyan-300">NEXORA</div>
            <div className="mt-2 text-xl font-semibold text-white">Мессенджер</div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-3">
            {user.avatar ? (
              <img src={user.avatar} alt={user.name} className="h-11 w-11 shrink-0 rounded-full object-cover" />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cyan-500/25 text-lg text-cyan-200">
                {user.name.slice(0, 1).toLocaleUpperCase('ru-RU')}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{user.name}</div>
              <div className="truncate text-xs text-slate-300">@{user.username}</div>
            </div>
          </div>

          <nav className="mt-7 space-y-1.5">
            {navItems.map(({ key, label, icon: Icon }) => (
              <button
                type="button"
                key={key}
                onClick={() => onViewChange(key)}
                className={[
                  'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition',
                  activeView === key
                    ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white',
                ].join(' ')}
              >
                <Icon size={18} />{label}
              </button>
            ))}
          </nav>

          <button
            type="button"
            onClick={onLogout}
            className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-3 text-sm font-medium text-red-200 transition hover:bg-red-500/15"
          >
            <LogOut size={16} />Выйти
          </button>
        </aside>

        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-0 bg-slate-900/80 shadow-2xl backdrop-blur-xl lg:rounded-[26px] lg:border lg:border-white/10">
          <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-cyan-300">На связи</div>
              <div className="text-lg font-semibold text-white">NEXORA</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="max-w-[38vw] truncate text-right text-xs text-slate-400 lg:hidden">{user.name}</div>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
                aria-label={resolvedTheme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
                title={resolvedTheme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              >
                {resolvedTheme === 'dark' ? <SunMedium size={18} /> : <MoonStar size={18} />}
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

          <nav aria-label="Основная навигация" className="grid shrink-0 grid-cols-5 border-t border-white/10 bg-slate-950/95 px-1 pb-[max(env(safe-area-inset-bottom),6px)] pt-1 lg:hidden">
            {navItems.map(({ key, label, icon: Icon }) => (
              <button
                type="button"
                key={key}
                onClick={() => onViewChange(key)}
                aria-current={activeView === key ? 'page' : undefined}
                className={[
                  'flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] transition',
                  activeView === key ? 'text-cyan-300' : 'text-slate-400',
                ].join(' ')}
              >
                <Icon size={19} />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}
