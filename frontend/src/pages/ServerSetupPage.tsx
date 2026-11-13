import { useState, type FormEvent } from 'react'
import { HardDrive, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { isValidServerUrl, setConfiguredApiUrl } from '@/lib/server'

type ReachableServer = { apiUrl: string; label: string }
type ProbeFailure = { apiUrl: string; reason: string }

async function findReachableApi(baseUrl: string): Promise<{ server: ReachableServer | null; failures: ProbeFailure[] }> {
  const base = baseUrl.replace(/\/+$/, '')
  // A bare backend answers on /health; a reverse proxy (the Docker setup)
  // serves the same check under /api.
  const candidates = [
    { apiUrl: base, label: 'Direct backend' },
    { apiUrl: `${base}/api`, label: 'Reverse proxy' },
  ]
  const failures: ProbeFailure[] = []
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${candidate.apiUrl}/health`, { signal: AbortSignal.timeout(8000) })
      if (response.ok) return { server: candidate, failures }
      failures.push({ apiUrl: candidate.apiUrl, reason: `HTTP ${response.status}` })
    } catch (err) {
      // Keep the real cause: a DNS/TLS/CORS failure looks identical to the user
      // otherwise, and it is the only way to tell a bad URL from a blocked host.
      failures.push({ apiUrl: candidate.apiUrl, reason: err instanceof Error ? `${err.name}: ${err.message}` : String(err) })
    }
  }
  return { server: null, failures }
}

export function ServerSetupPage() {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<ProbeFailure[]>([])
  const [connecting, setConnecting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = url.trim()
    setDetail([])
    if (!isValidServerUrl(value)) {
      setError('Enter a full server URL, for example https://9drive.example.com')
      return
    }
    setConnecting(true)
    setError('')
    try {
      const { server, failures } = await findReachableApi(value)
      if (!server) {
        setError('Could not reach a 9Drive server at that address. Check the URL and that the backend is running.')
        setDetail(failures)
        return
      }
      setConfiguredApiUrl(server.apiUrl)
      window.location.replace('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to the server')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <Card className="w-full max-w-md p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white"><HardDrive className="h-6 w-6" /></div>
          <div><h1 className="text-2xl font-extrabold">Connect your server</h1><p className="text-sm text-slate-500">Point 9Drive at your self-hosted gateway.</p></div>
        </div>
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <label className="grid gap-2 text-sm font-semibold">
            Server URL
            <Input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://9drive.example.com"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
            />
          </label>
          <p className="flex items-start gap-2 rounded-xl bg-slate-100 p-3 text-xs text-slate-500">
            <Server className="mt-0.5 h-4 w-4 shrink-0" />
            Use the address where your 9Drive instance is hosted. Both a direct backend URL and a reverse-proxied site URL work.
          </p>
          {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p> : null}
          {detail.length > 0 ? (
            <ul className="grid gap-1 rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
              {detail.map((failure) => (
                <li key={failure.apiUrl} className="break-all">
                  <span className="font-semibold">{failure.apiUrl}</span> — {failure.reason}
                </li>
              ))}
            </ul>
          ) : null}
          <Button disabled={connecting}>{connecting ? 'Checking server...' : 'Connect'}</Button>
        </form>
      </Card>
    </main>
  )
}
