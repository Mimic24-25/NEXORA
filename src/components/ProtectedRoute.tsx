import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isReady } = useAuth()

  if (!isReady) {
    return <div className="flex min-h-screen items-center justify-center text-slate-300">Загрузка NEXORA…</div>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}
