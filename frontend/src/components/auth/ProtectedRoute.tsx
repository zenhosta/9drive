import { Navigate, Outlet } from 'react-router-dom'
import { getStoredUser } from '@/lib/auth'

export function ProtectedRoute() {
  return getStoredUser() ? <Outlet /> : <Navigate to="/login" replace />
}
