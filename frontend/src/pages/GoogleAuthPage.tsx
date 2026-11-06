import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { HardDrive } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api'
import { setAuthSession, type AuthUser } from '@/lib/auth'

type AuthResponse = { accessToken: string; refreshToken: string; user: AuthUser }

export function GoogleAuthPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [message, setMessage] = useState('Completing Google sign-in...')
  const token = params.get('token')
  const status = params.get('status')

  useEffect(() => {
    if (status === 'error' || !token) {
      setMessage('Google sign-in failed. Please try again.')
      return
    }

    apiFetch<AuthResponse>('/auth/google/exchange', { method: 'POST', skipAuth: true, body: JSON.stringify({ token }) })
      .then((data) => {
        setAuthSession(data.accessToken, data.refreshToken, data.user)
        navigate('/overview', { replace: true })
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Google sign-in failed. Please try again.'))
  }, [navigate, status, token])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <Card className="w-full max-w-sm p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white"><HardDrive className="h-6 w-6" /></div>
        <h1 className="mt-4 text-xl font-extrabold">Google Sign-in</h1>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
      </Card>
    </main>
  )
}
