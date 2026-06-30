import { useEffect, useState, useRef, type FormEvent } from 'react'
import { Bell, Cloud, Database, Globe, HardDrive, Link2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DummyModal } from '@/components/drive/DummyModal'
import { PageHeader } from '@/components/drive/PageHeader'
import { apiFetch, formatBytes, API_URL } from '@/lib/api'
import { getGravatarUrl } from '@/lib/gravatar'
import { getStoredUser, getAccessToken, clearAuthSession } from '@/lib/auth'

type ConnectedAccount = { id: string; provider: string; email: string; displayName?: string | null; status: string; storageAccount?: { totalBytes: string | null; usedBytes: string; availableBytes: string | null; lastSyncedAt: string | null } | null }

function providerLabel(provider: string) {
  if (provider === 's3') return 'S3 Storage'
  return 'Google Drive'
}

function storageLimitLabel(account: ConnectedAccount) {
  if (account.provider === 's3' && account.storageAccount?.totalBytes === null) return 'Unlimited'
  return formatBytes(account.storageAccount?.totalBytes)
}

function availableLabel(account: ConnectedAccount) {
  if (account.provider === 's3' && account.storageAccount?.availableBytes === null) return 'Unlimited'
  return formatBytes(account.storageAccount?.availableBytes)
}

export function SettingsPage() {
  const user = getStoredUser()
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [message, setMessage] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [s3Open, setS3Open] = useState(false)
  const [connectingS3, setConnectingS3] = useState(false)
  const [s3Form, setS3Form] = useState({ name: '', bucket: '', region: 'us-east-1', endpoint: '', accessKeyId: '', secretAccessKey: '', forcePathStyle: false, quotaBytes: '' })
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null)
  const [disconnectingAccountId, setDisconnectingAccountId] = useState<string | null>(null)
  const [accountToDisconnect, setAccountToDisconnect] = useState<ConnectedAccount | null>(null)
  const [profileImageUrl, setProfileImageUrl] = useState('')
  const [avatarError, setAvatarError] = useState(false)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [updatingSystem, setUpdatingSystem] = useState(false)
  const [updateModalOpen, setUpdateModalOpen] = useState(false)
  const [updateModalTitle, setUpdateModalTitle] = useState('')

  // Google OAuth Config states
  const [googleClientId, setGoogleClientId] = useState('')
  const [googleClientSecret, setGoogleClientSecret] = useState('')
  const [googleRedirectUri, setGoogleRedirectUri] = useState('')
  const [defaultRedirectUri, setDefaultRedirectUri] = useState('')
  const [hasSecret, setHasSecret] = useState(false)
  const [savingGoogleConfig, setSavingGoogleConfig] = useState(false)
  const [showGoogleHelp, setShowGoogleHelp] = useState(false)

  // Live log polling states
  const [isPollingLog, setIsPollingLog] = useState(false)
  const [updateLog, setUpdateLog] = useState('')
  const [updateFinished, setUpdateFinished] = useState(false)
  const [updateSuccess, setUpdateSuccess] = useState<boolean | null>(null)
  const [reconnectCount, setReconnectCount] = useState(0)
  const logContainerRef = useRef<HTMLDivElement>(null)

  // Backup & Restore states
  const [downloadingBackup, setDownloadingBackup] = useState(false)
  const [restoringBackup, setRestoringBackup] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoreMessage, setRestoreMessage] = useState('')
  const [restoreSuccess, setRestoreSuccess] = useState(false)

  async function downloadBackup() {
    setDownloadingBackup(true)
    try {
      const token = getAccessToken()
      const response = await fetch(`${API_URL}/system/backup`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!response.ok) {
        throw new Error('Failed to retrieve database backup.')
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = '9drive-backup.db'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      alert('Failed to download backup: ' + err.message)
    } finally {
      setDownloadingBackup(false)
    }
  }

  function handleRestoreFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      setRestoreFile(e.target.files[0])
    } else {
      setRestoreFile(null)
    }
  }

  async function restoreBackup() {
    if (!restoreFile) return
    if (!confirm('WARNING: Restoring database will overwrite all your current configurations, connected accounts, virtual folders, and user accounts. The server will restart. Are you sure you want to proceed?')) {
      return
    }

    setRestoringBackup(true)
    setRestoreMessage('')
    setRestoreSuccess(false)

    try {
      const token = getAccessToken()
      const formData = new FormData()
      formData.append('file', restoreFile)

      const response = await fetch(`${API_URL}/system/restore`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Failed to restore database.')
      }

      setRestoreSuccess(true)
      setRestoreMessage(data.message || 'Database restored successfully! Logging you out and reloading...')

      setTimeout(() => {
        clearAuthSession()
        window.location.href = '/login'
      }, 4000)

    } catch (err: any) {
      setRestoreSuccess(false)
      setRestoreMessage(err.message || 'Failed to restore database.')
    } finally {
      setRestoringBackup(false)
    }
  }

  useEffect(() => {
    if (!isPollingLog) return

    let intervalId: any
    let active = true

    async function fetchLog() {
      try {
        const data = await apiFetch<{ log: string }>('/system/update-log')
        if (!active) return

        setUpdateLog(data.log)
        setReconnectCount(0)

        if (data.log.includes('=== System Update Completed:')) {
          setUpdateFinished(true)
          setUpdateSuccess(true)
          setIsPollingLog(false)
          setUpdateModalTitle('System Updated')
        }
      } catch (err) {
        if (!active) return
        setReconnectCount((prev) => prev + 1)
      }
    }

    fetchLog()
    intervalId = setInterval(fetchLog, 2000)

    return () => {
      active = false
      clearInterval(intervalId)
    }
  }, [isPollingLog])

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [updateLog])

  async function runSystemUpdate() {
    setUpdatingSystem(true)
    setMessage('')
    setUpdateLog('Initiating system update in the background...\n')
    setUpdateFinished(false)
    setUpdateSuccess(null)
    setReconnectCount(0)
    setUpdateModalTitle('System Updating')
    setUpdateModalOpen(true)

    try {
      await apiFetch<{ message: string }>('/system/update', { method: 'POST' })
      setIsPollingLog(true)
    } catch (error) {
      setUpdateModalTitle('System Update Failed')
      const errMsg = error instanceof Error ? error.message : 'System update failed to initiate.'
      setUpdateLog((prev) => prev + `\nError: ${errMsg}`)
      setUpdateFinished(true)
      setUpdateSuccess(false)
    } finally {
      setUpdatingSystem(false)
    }
  }

  async function saveGoogleConfig(event: FormEvent) {
    event.preventDefault()
    setSavingGoogleConfig(true)
    setMessage('')
    try {
      const res = await apiFetch<{ message: string }>('/system/google-config', {
        method: 'POST',
        body: JSON.stringify({
          clientId: googleClientId,
          clientSecret: googleClientSecret || undefined,
          redirectUri: googleRedirectUri || defaultRedirectUri,
        }),
      })
      setMessage(res.message || 'Google OAuth credentials saved.')
      setHasSecret(true)
      setGoogleClientSecret('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save Google OAuth configuration')
    } finally {
      setSavingGoogleConfig(false)
    }
  }

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? accounts[0] ?? null

  async function load() {
    const data = await apiFetch<{ accounts: ConnectedAccount[] }>('/connected-accounts')
    setAccounts(data.accounts)

    try {
      const configData = await apiFetch<{ exists: boolean; clientId: string; redirectUri: string; hasSecret: boolean; defaultRedirectUri: string }>('/system/google-config')
      if (configData.exists) {
        setGoogleClientId(configData.clientId || '')
        setGoogleRedirectUri(configData.redirectUri || '')
        setHasSecret(configData.hasSecret || false)
      }
      setDefaultRedirectUri(configData.defaultRedirectUri || '')
    } catch (e) {
      console.error('Failed to load global Google config', e)
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to load settings'))
  }, [])

  useEffect(() => {
    setAvatarError(false)
    getGravatarUrl(user?.email, 96).then(setProfileImageUrl).catch(() => setProfileImageUrl(''))
  }, [user?.email])

  useEffect(() => {
    if (accounts.length === 0) {
      setSelectedAccountId('')
      return
    }
    if (!accounts.some((account) => account.id === selectedAccountId)) setSelectedAccountId(accounts[0].id)
  }, [accounts, selectedAccountId])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.data?.type !== 'GOOGLE_CONNECTED') return
      setMessage(event.data.status === 'success' ? 'Google Drive connected.' : 'Google Drive connection failed.')
      load().then(() => {
        window.dispatchEvent(new Event('9drive:storage-changed'))
      }).catch(() => undefined)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  async function connectDrive() {
    setConnecting(true)
    setMessage('')
    const popup = window.open('', 'google-drive-connect', 'width=540,height=720')
    if (popup) {
      popup.document.write('<html><head><title>Connecting...</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#64748b;}</style></head><body><div style="text-align:center;"><h2>Connecting to Google...</h2><p>Please wait while we redirect you.</p></div></body></html>')
    }
    try {
      const data = await apiFetch<{ url: string }>('/connected-accounts/google/connect-url')
      if (popup) {
        popup.location.href = data.url
      } else {
        window.location.href = data.url
      }
    } catch (error) {
      if (popup) popup.close()
      setMessage(error instanceof Error ? error.message : 'Failed to start Google Drive connection')
    } finally {
      setConnecting(false)
    }
  }

  async function sync(accountId: string) {
    setSyncingAccountId(accountId)
    try {
      await apiFetch(`/connected-accounts/${accountId}/sync-quota`, { method: 'POST' })
      await load()
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } finally {
      setSyncingAccountId(null)
    }
  }

  async function disconnect() {
    if (!accountToDisconnect) return
    setDisconnectingAccountId(accountToDisconnect.id)
    setMessage('')
    try {
      await apiFetch(`/connected-accounts/${accountToDisconnect.id}`, { method: 'DELETE' })
      setAccountToDisconnect(null)
      setMessage('Storage account disconnected.')
      await load()
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to disconnect Google Drive account')
    } finally {
      setDisconnectingAccountId(null)
    }
  }

  async function connectS3(event: FormEvent) {
    event.preventDefault()
    setConnectingS3(true)
    setMessage('')
    try {
      await apiFetch('/connected-accounts/s3', { method: 'POST', body: JSON.stringify({ ...s3Form, endpoint: s3Form.endpoint || undefined, quotaBytes: s3Form.quotaBytes || null }) })
      setS3Open(false)
      setS3Form({ name: '', bucket: '', region: 'us-east-1', endpoint: '', accessKeyId: '', secretAccessKey: '', forcePathStyle: false, quotaBytes: '' })
      setMessage('S3 storage connected.')
      await load()
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to connect S3 storage')
    } finally {
      setConnectingS3(false)
    }
  }

  return (
    <>
      <PageHeader title="Setting" description="Manage account and connected storage." actions={<><Button variant="outline" size="sm" onClick={() => setS3Open(true)}><Database className="h-4 w-4" />Connect S3</Button><Button size="sm" onClick={connectDrive} disabled={connecting}><Link2 className="h-4 w-4" />{connecting ? 'Connecting...' : 'Connect Drive'}</Button></>} />
      {message ? <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="grid gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3.5">
              {!profileImageUrl || avatarError ? (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-lg font-bold text-white shadow-sm border border-blue-400/20 sm:h-14 sm:w-14">
                  {(user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase()}
                </div>
              ) : (
                <img
                  src={profileImageUrl}
                  alt="User avatar"
                  className="h-12 w-12 rounded-xl object-cover sm:h-14 sm:w-14"
                  onError={() => setAvatarError(true)}
                />
              )}
              <div className="flex-1"><h2 className="text-lg font-bold">{user?.name ?? 'User'}</h2><p className="text-xs text-slate-500 mt-0.5">{user?.email ?? '-'}</p></div>
            </div>
          </Card>

          <Card className="overflow-hidden p-3.5">
            <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2.5"><Cloud className="h-5 w-5 text-blue-600" /><h2 className="text-[16px] font-bold">Google Drive</h2></div>
                <p className="mt-1 text-[13px] text-slate-500">Connect one or more Google Drive accounts. 9Drive will route uploads to account with enough space.</p>
              </div>
              <Button className="w-full sm:w-32" size="sm" onClick={connectDrive} disabled={connecting}><Link2 className="h-4 w-4" />{connecting ? 'Opening...' : 'Connect Drive'}</Button>
            </div>
          </Card>

          <Card className="overflow-hidden p-3.5">
            <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2.5"><Database className="h-5 w-5 text-blue-600" /><h2 className="text-[16px] font-bold">S3 Compatible</h2></div>
                <p className="mt-1 text-[13px] text-slate-500">Connect AWS S3, Cloudflare R2, MinIO, Wasabi, Backblaze B2, or custom endpoint storage.</p>
              </div>
              <Button className="w-full sm:w-32" size="sm" variant="outline" onClick={() => setS3Open(true)}><Database className="h-4 w-4" />Connect S3</Button>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-[16px] font-bold">Connected Storage Accounts</h2>
            <div className="mt-3.5 grid gap-3">
              {accounts.length === 0 ? <p className="text-xs text-slate-500">No connected storage account yet.</p> : <>
                <label className="grid gap-1.5 text-xs font-semibold text-slate-500">Choose Account<select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none" value={selectedAccount?.id ?? ''} onChange={(event) => setSelectedAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{providerLabel(account.provider)} - {account.displayName || account.email} ({account.status})</option>)}</select></label>
                {selectedAccount ? <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0"><p className="break-all font-semibold text-sm">{selectedAccount.displayName || selectedAccount.email}</p><p className="text-xs text-slate-500 mt-0.5">{providerLabel(selectedAccount.provider)} · {selectedAccount.status}</p></div>
                    <div className="grid grid-cols-2 gap-2 sm:flex"><Button className="w-full" size="sm" variant="outline" onClick={() => sync(selectedAccount.id)} disabled={syncingAccountId === selectedAccount.id}><RefreshCw className={syncingAccountId === selectedAccount.id ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{syncingAccountId === selectedAccount.id ? 'Syncing...' : 'Sync'}</Button><Button className="w-full" size="sm" variant="danger" onClick={() => setAccountToDisconnect(selectedAccount)}><Trash2 className="h-4 w-4" />Disconnect</Button></div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-xl bg-white dark:bg-slate-950 p-2 border border-slate-100 dark:border-slate-800"><p className="font-extrabold text-slate-950">{formatBytes(selectedAccount.storageAccount?.usedBytes)}</p><p className="mt-0.5 text-[10px] text-slate-500">Used</p></div>
                    <div className="rounded-xl bg-white dark:bg-slate-950 p-2 border border-slate-100 dark:border-slate-800"><p className="font-extrabold text-slate-950">{storageLimitLabel(selectedAccount)}</p><p className="mt-0.5 text-[10px] text-slate-500">Total</p></div>
                    <div className="rounded-xl bg-white dark:bg-slate-950 p-2 border border-slate-100 dark:border-slate-800"><p className="font-extrabold text-slate-950">{availableLabel(selectedAccount)}</p><p className="mt-0.5 text-[10px] text-slate-500">Free</p></div>
                  </div>
                </div> : null}
              </>}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2.5">
                <Cloud className="h-5 w-5 text-blue-600" />
                <h2 className="text-[17px] font-bold">Google OAuth Credentials</h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-semibold"
                type="button"
                onClick={() => setShowGoogleHelp(!showGoogleHelp)}
              >
                {showGoogleHelp ? 'Hide Guide' : 'Setup Guide'}
              </Button>
            </div>

            {showGoogleHelp && (
              <div className="mb-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3.5 text-[13px] leading-relaxed text-slate-600 border border-slate-100 dark:border-slate-800">
                <p className="font-bold text-slate-800 dark:text-slate-200 mb-1.5">How to setup Google credentials:</p>
                <ol className="list-decimal pl-4 space-y-1.5">
                  <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Google Cloud Console</a>.</li>
                  <li>Enable the <strong>Google Drive API</strong> in your project.</li>
                  <li>Go to <strong>APIs & Services &gt; Credentials</strong>, click <strong>Create Credentials &gt; OAuth client ID</strong>.</li>
                  <li>Set application type to <strong>Web application</strong>.</li>
                  <li>Add this exact URL under <strong>Authorized redirect URIs</strong>:
                    <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] bg-white dark:bg-slate-950 p-1.5 rounded border border-slate-200 dark:border-slate-800 select-all overflow-x-auto">
                      {googleRedirectUri || defaultRedirectUri}
                    </div>
                  </li>
                  <li>Copy the generated <strong>Client ID</strong> and <strong>Client Secret</strong> into the form below and save.</li>
                </ol>
              </div>
            )}

            <form onSubmit={saveGoogleConfig} className="grid gap-3.5">
              <label className="grid gap-1.5 text-xs font-bold text-slate-500">
                Client ID
                <input
                  className="h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 text-sm focus:border-blue-600 focus:outline-none"
                  placeholder="Enter Google Client ID"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  required
                />
              </label>

              <label className="grid gap-1.5 text-xs font-bold text-slate-500">
                Client Secret {hasSecret && <span className="font-normal text-emerald-600">(Already Configured)</span>}
                <input
                  className="h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 text-sm focus:border-blue-600 focus:outline-none"
                  type="password"
                  placeholder={hasSecret ? "••••••••••••••••••••••••" : "Enter Google Client Secret"}
                  value={googleClientSecret}
                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                  required={!hasSecret}
                />
              </label>

              <label className="grid gap-1.5 text-xs font-bold text-slate-500">
                Redirect URI (Optional)
                <input
                  className="h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 text-sm focus:border-blue-600 focus:outline-none"
                  placeholder={defaultRedirectUri}
                  value={googleRedirectUri}
                  onChange={(e) => setGoogleRedirectUri(e.target.value)}
                />
              </label>

              <div className="flex justify-end mt-1">
                <Button type="submit" disabled={savingGoogleConfig} size="sm">
                  {savingGoogleConfig ? 'Saving...' : 'Save Credentials'}
                </Button>
              </div>
            </form>
          </Card>

          <Card className="overflow-hidden p-3.5">
            <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2.5">
                  <RefreshCw className="h-5 w-5 text-blue-600" />
                  <h2 className="text-[16px] font-bold">System Update</h2>
                </div>
                <p className="mt-1 text-[13px] text-slate-500">
                  Pull the latest code from GitHub. Dev servers will automatically restart.
                </p>
              </div>
              <Button
                className="w-full sm:w-32"
                variant="outline"
                size="sm"
                onClick={runSystemUpdate}
                disabled={updatingSystem}
              >
                <RefreshCw className={updatingSystem ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                {updatingSystem ? 'Updating...' : 'Update Code'}
              </Button>
            </div>
          </Card>

          <Card className="overflow-hidden p-3.5">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <Database className="h-5 w-5 text-blue-600" />
                  <h2 className="text-[16px] font-bold">Backup & Restore Database</h2>
                </div>
                <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">SQLite Local Database</span>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                {/* Download Backup Section (Translucent Green Glass) */}
                <div className="rounded-2xl bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 dark:border-emerald-500/30 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-all duration-300 p-5 flex flex-col justify-between shadow-sm relative overflow-hidden group">
                  <div className="flex items-start gap-4">
                    <div className="h-10 w-10 shrink-0 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                      <HardDrive className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Download Database Backup</h3>
                      <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 leading-normal">
                        Save a copy of your active database containing accounts, virtual folders, file metadata, and configurations.
                      </p>
                    </div>
                  </div>
                  <button
                    className="mt-5 w-full h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold shadow-md shadow-emerald-500/10 hover:shadow-emerald-500/20 border-0 transition-all duration-300 transform active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer"
                    onClick={downloadBackup}
                    disabled={downloadingBackup}
                    style={{ color: '#ffffff' }}
                  >
                    <HardDrive className="h-4 w-4" style={{ color: '#ffffff' }} />
                    <span style={{ color: '#ffffff' }}>{downloadingBackup ? 'Downloading...' : 'Download Backup'}</span>
                  </button>
                </div>

                {/* Restore Backup Section (Translucent Orange Glass) */}
                <div className="rounded-2xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 dark:border-amber-500/30 hover:border-amber-500/40 hover:bg-amber-500/10 transition-all duration-300 p-5 flex flex-col justify-between shadow-sm relative overflow-hidden group">
                  <div className="flex items-start gap-4">
                    <div className="h-10 w-10 shrink-0 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                      <RefreshCw className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Restore Database Backup</h3>
                      <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 leading-normal">
                        Upload a previously downloaded 9Drive backup file to replace the active database.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3">
                    <input
                      type="file"
                      accept=".db"
                      onChange={handleRestoreFileChange}
                      className="block w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-[11px] file:font-extrabold file:bg-amber-500/15 file:text-amber-700 dark:file:text-amber-300 hover:file:bg-amber-500/20 cursor-pointer border border-amber-500/20 dark:border-amber-500/30 rounded-xl p-1 bg-amber-500/5"
                    />
                    {restoreFile ? (
                      <button
                        className="w-full h-11 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold shadow-md shadow-amber-500/10 hover:shadow-amber-500/20 border-0 transition-all duration-300 transform active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer"
                        onClick={restoreBackup}
                        disabled={restoringBackup}
                        style={{ color: '#ffffff' }}
                      >
                        <RefreshCw className={restoringBackup ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} style={{ color: '#ffffff' }} />
                        <span style={{ color: '#ffffff' }}>{restoringBackup ? 'Restoring & Restarting...' : 'Restore Backup'}</span>
                      </button>
                    ) : (
                      <button
                        className="w-full h-11 rounded-xl bg-slate-100 dark:bg-slate-800/50 text-slate-400 dark:text-slate-600 border border-slate-200/50 dark:border-slate-800/50 cursor-not-allowed flex items-center justify-center gap-2"
                        disabled
                      >
                        <RefreshCw className="h-4 w-4 text-slate-400 dark:text-slate-600" />
                        <span>Restore Backup</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {restoreMessage && (
                <p className={restoreSuccess ? "rounded-xl bg-emerald-50 p-3 text-xs font-semibold mt-1 text-emerald-700" : "rounded-xl bg-red-50 p-3 text-xs font-semibold mt-1 text-red-700"}>
                  {restoreMessage}
                </p>
              )}
            </div>
          </Card>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 lg:gap-3">
          <Card className="p-4"><HardDrive className="h-5 w-5 text-blue-600" /><h2 className="mt-2 text-[14px] font-bold">Storage</h2><p className="mt-1 text-[12px] text-slate-500">Connected accounts: {accounts.length}</p></Card>
          <Card className="p-4"><Bell className="h-5 w-5 text-blue-600" /><h2 className="mt-2 text-[14px] font-bold">Notifications</h2><p className="mt-1 text-[12px] text-slate-500">Email and app alerts are active.</p></Card>
          <Card className="p-4"><Globe className="h-5 w-5 text-blue-600" /><h2 className="mt-2 text-[14px] font-bold">Region</h2><p className="mt-1 text-[12px] text-slate-500">Workspace region: local gateway.</p></Card>
        </div>
      </div>
      <DummyModal open={s3Open} title="Connect S3 Storage" description="Use any S3-compatible provider with custom endpoint support." onClose={() => setS3Open(false)}>
        <form className="grid gap-4" onSubmit={connectS3}>
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder="Display name" value={s3Form.name} onChange={(event) => setS3Form({ ...s3Form, name: event.target.value })} required />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder="Bucket" value={s3Form.bucket} onChange={(event) => setS3Form({ ...s3Form, bucket: event.target.value })} required />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder="Region" value={s3Form.region} onChange={(event) => setS3Form({ ...s3Form, region: event.target.value })} required />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder="Endpoint URL (optional)" value={s3Form.endpoint} onChange={(event) => setS3Form({ ...s3Form, endpoint: event.target.value })} />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder="Access key ID" value={s3Form.accessKeyId} onChange={(event) => setS3Form({ ...s3Form, accessKeyId: event.target.value })} required />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder="Secret access key" type="password" value={s3Form.secretAccessKey} onChange={(event) => setS3Form({ ...s3Form, secretAccessKey: event.target.value })} required />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder="Quota bytes (optional)" inputMode="numeric" value={s3Form.quotaBytes} onChange={(event) => setS3Form({ ...s3Form, quotaBytes: event.target.value })} />
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={s3Form.forcePathStyle} onChange={(event) => setS3Form({ ...s3Form, forcePathStyle: event.target.checked })} />Force path style</label>
          <div className="grid gap-3 sm:flex sm:justify-end"><Button variant="outline" type="button" onClick={() => setS3Open(false)} disabled={connectingS3}>Cancel</Button><Button type="submit" disabled={connectingS3}>{connectingS3 ? 'Connecting...' : 'Connect S3'}</Button></div>
        </form>
      </DummyModal>
      <DummyModal open={Boolean(accountToDisconnect)} title="Disconnect storage?" description="This will remove this storage account from 9Drive. Existing file records for this account may no longer be usable." onClose={() => setAccountToDisconnect(null)}>
        <div className="grid gap-4">
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-950">{accountToDisconnect?.email}</p>
            <p className="mt-1">Used storage: {formatBytes(accountToDisconnect?.storageAccount?.usedBytes)}</p>
          </div>
          <div className="grid gap-3 sm:flex sm:justify-end">
            <Button variant="outline" onClick={() => setAccountToDisconnect(null)} disabled={Boolean(disconnectingAccountId)}>Cancel</Button>
            <Button variant="danger" onClick={disconnect} disabled={Boolean(disconnectingAccountId)}><Trash2 className="h-4 w-4" />{disconnectingAccountId ? 'Disconnecting...' : 'Disconnect'}</Button>
          </div>
        </div>
      </DummyModal>

      <DummyModal
        open={updateModalOpen}
        title={updateModalTitle}
        description={
          updateFinished
            ? (updateSuccess ? 'System updated successfully' : 'Update failed')
            : 'Live installation logs'
        }
        className="max-w-2xl"
        onClose={() => {
          if (!updateFinished) {
            if (!confirm('The update is still running in the background. Close log viewer?')) {
              return
            }
          }
          setUpdateModalOpen(false)
          setIsPollingLog(false)
          if (updateFinished && updateSuccess) {
            window.location.reload()
          }
        }}
      >
        <div className="grid gap-4">
          <div
            ref={logContainerRef}
            className="relative rounded-xl bg-slate-950 p-4 font-mono text-xs text-slate-300 leading-relaxed border border-slate-800 h-80 overflow-y-auto select-text"
          >
            <pre className="whitespace-pre-wrap">{updateLog}</pre>
            {!updateFinished && (
              <div className="mt-3 flex items-center gap-2 text-blue-400">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>
                  {reconnectCount > 0
                    ? `Rebooting server and reconnecting... (attempt ${reconnectCount})`
                    : 'Installing updates...'}
                </span>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!updateFinished) {
                  if (!confirm('The update is still running. Close log viewer?')) return
                }
                setUpdateModalOpen(false)
                setIsPollingLog(false)
                if (updateFinished && updateSuccess) {
                  window.location.reload()
                }
              }}
            >
              Close
            </Button>
            {updateFinished && updateSuccess && (
              <Button onClick={() => window.location.reload()}>
                Reload Page
              </Button>
            )}
          </div>
        </div>
      </DummyModal>
    </>
  )
}
