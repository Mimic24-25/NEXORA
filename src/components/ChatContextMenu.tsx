import { Archive, BellOff, Bell, Pin, Trash2, Eraser, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface ChatContextMenuProps {
  isPinned: boolean
  isArchived: boolean
  isMuted: boolean
  onPin: () => void
  onArchive: () => void
  onUnarchive: () => void
  onMute: (until: string | null) => void
  onUnmute: () => void
  onClearHistory: () => void
  onDeleteForMe: () => void
  onClose: () => void
}

const muteOptions = [
  { label: 'На 1 час', value: () => { const d = new Date(); d.setHours(d.getHours() + 1); return d.toISOString() } },
  { label: 'На 8 часов', value: () => { const d = new Date(); d.setHours(d.getHours() + 8); return d.toISOString() } },
  { label: 'Навсегда', value: () => '9999-12-31T23:59:59.000Z' },
] as const

export function ChatContextMenu({
  isPinned, isArchived, isMuted,
  onPin, onArchive, onUnarchive, onMute, onUnmute,
  onClearHistory, onDeleteForMe, onClose,
}: ChatContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [showMuteMenu, setShowMuteMenu] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'clear' | 'delete' | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handleConfirm = (action: 'clear' | 'delete') => {
    if (action === 'clear') onClearHistory()
    else onDeleteForMe()
    onClose()
  }

  return (
    <div
      ref={ref}
      className="absolute right-2 top-full z-40 mt-1 w-56 rounded-2xl border border-white/10 bg-slate-900 p-2 shadow-2xl shadow-black/50"
    >
      {confirmAction ? (
        <div className="p-2">
          <p className="mb-3 text-sm text-slate-300">
            {confirmAction === 'clear'
              ? 'Удалить все ваши сообщения в этом чате?'
              : 'Удалить чат для вас? Сообщения других пользователей останутся.'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleConfirm(confirmAction)}
              className="flex-1 rounded-lg bg-red-500 px-3 py-2 text-xs font-medium text-white hover:bg-red-600"
            >
              Удалить
            </button>
            <button
              onClick={() => setConfirmAction(null)}
              className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : showMuteMenu ? (
        <div>
          <button onClick={() => setShowMuteMenu(false)} className="mb-1 text-xs text-cyan-400 hover:underline">
            ← Назад
          </button>
          {muteOptions.map((opt) => (
            <button
              key={opt.label}
              onClick={() => { onMute(opt.value()); onClose() }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <BellOff size={16} className="text-slate-400" />
              {opt.label}
            </button>
          ))}
        </div>
      ) : (
        <>
          <button
            onClick={() => { onPin(); onClose() }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <Pin size={16} className={isPinned ? 'text-cyan-400' : 'text-slate-400'} />
            {isPinned ? 'Открепить' : 'Закрепить'}
          </button>

          {!isArchived ? (
            <button
              onClick={() => { onArchive(); onClose() }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <Archive size={16} className="text-slate-400" />
              В архив
            </button>
          ) : (
            <button
              onClick={() => { onUnarchive(); onClose() }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <RotateCcw size={16} className="text-slate-400" />
              Вернуть из архива
            </button>
          )}

          {isMuted ? (
            <button
              onClick={() => { onUnmute(); onClose() }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <Bell size={16} className="text-slate-400" />
              Включить уведомления
            </button>
          ) : (
            <button
              onClick={() => setShowMuteMenu(true)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <BellOff size={16} className="text-slate-400" />
              Отключить уведомления
            </button>
          )}

          <div className="my-1 border-t border-white/5" />

          <button
            onClick={() => setConfirmAction('clear')}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <Eraser size={16} className="text-slate-400" />
            Очистить историю
          </button>

          <button
            onClick={() => setConfirmAction('delete')}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-red-300 hover:bg-red-500/10 hover:text-red-200"
          >
            <Trash2 size={16} />
            Удалить чат
          </button>
        </>
      )}
    </div>
  )
}
