import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, XCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useTranslation } from '@/lib/i18nContext'

export function GoogleConnectedPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const status = params.get('status') ?? 'success'
  const ok = status === 'success'

  useEffect(() => {
    window.opener?.postMessage({ type: 'GOOGLE_CONNECTED', status }, window.location.origin)
    const timer = window.setTimeout(() => {
      if (window.opener) window.close()
      else navigate('/settings')
    }, 800)
    return () => window.clearTimeout(timer)
  }, [navigate, status])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <Card className="w-full max-w-sm p-6 text-center">
        {ok ? <CheckCircle className="mx-auto h-10 w-10 text-emerald-500" /> : <XCircle className="mx-auto h-10 w-10 text-red-500" />}
        <h1 className="mt-4 text-xl font-extrabold">{ok ? t('Google Drive Connected') : t('Connection Failed')}</h1>
        <p className="mt-2 text-sm text-slate-500">{ok ? t('This window will close automatically.') : t('Close this window and try again.')}</p>
      </Card>
    </main>
  )
}
