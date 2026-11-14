import { useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { DriveLayout } from '@/layouts/DriveLayout'
import { AllFilesPage } from '@/pages/AllFilesPage'
import { ArchivedPage } from '@/pages/ArchivedPage'
import { HomePage } from '@/pages/HomePage'
import { TreeMapPage } from '@/pages/TreeMapPage'
import { LoginPage } from '@/pages/LoginPage'
import { GoogleAuthPage } from '@/pages/GoogleAuthPage'
import { GoogleConnectedPage } from '@/pages/GoogleConnectedPage'
import { QuotaTrackerPage } from '@/pages/QuotaTrackerPage'
import { RecentPage } from '@/pages/RecentPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { ServerSetupPage } from '@/pages/ServerSetupPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SharedPage } from '@/pages/SharedPage'
import { StarredPage } from '@/pages/StarredPage'
import { PublicFilePage } from '@/pages/PublicFilePage'
import { ApiManagementPage } from '@/pages/ApiManagementPage'
import { TrashPage } from '@/pages/TrashPage'
import { ActivityLogPage } from '@/pages/ActivityLogPage'
import { UploadProvider } from '@/context/UploadContext'
import { isNativeApp, needsServerSetup } from '@/lib/server'

/**
 * The Android app receives OAuth results through the `ninedrive://` deep link
 * (see MOBILE_APP_REDIRECT_URL on the backend), so route them into the same
 * pages the web app uses after a browser redirect.
 */
function useDeepLinks() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isNativeApp()) return
    let disposed = false
    const pending: Array<{ remove: () => Promise<void> }> = []

    const openUrl = (rawUrl?: string | null) => {
      if (!rawUrl || disposed) return
      try {
        const url = new URL(rawUrl)
        if (url.protocol !== 'ninedrive:') return
        Browser.close().catch(() => undefined)
        // Connecting a Drive account reuses the current page, so tell it to reload.
        if (url.pathname === '/google-connected') {
          window.dispatchEvent(new CustomEvent('9drive:google-connected', {
            detail: { status: url.searchParams.get('status') ?? 'error' },
          }))
          return
        }
        navigate(`${url.pathname}${url.search}`, { replace: true })
      } catch {
        // Ignore links that are not valid app URLs.
      }
    }

    CapacitorApp.addListener('appUrlOpen', ({ url }) => openUrl(url)).then((handle) => {
      if (disposed) handle.remove()
      else pending.push(handle)
    })
    CapacitorApp.getLaunchUrl().then((launch) => openUrl(launch?.url))

    return () => {
      disposed = true
      pending.forEach((handle) => handle.remove())
    }
  }, [navigate])
}

function App() {
  useDeepLinks()

  if (needsServerSetup()) return <ServerSetupPage />

  return (
    <UploadProvider>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="google-auth" element={<GoogleAuthPage />} />
        <Route path="google-connected" element={<GoogleConnectedPage />} />
        <Route path="public/files/:token" element={<PublicFilePage />} />
        <Route path="public/files/:token/embed" element={<PublicFilePage embed />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<DriveLayout />}>
            <Route index element={<Navigate to="/home" replace />} />
            <Route path="home" element={<HomePage />} />
            <Route path="tree-map" element={<TreeMapPage />} />
            <Route path="all-files" element={<AllFilesPage />} />
            <Route path="quota" element={<QuotaTrackerPage />} />
            <Route path="shared" element={<SharedPage />} />
            <Route path="recent" element={<RecentPage />} />
            <Route path="starred" element={<StarredPage />} />
            <Route path="archived" element={<ArchivedPage />} />
            <Route path="trash" element={<TrashPage />} />
            <Route path="activity" element={<ActivityLogPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="api" element={<ApiManagementPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </UploadProvider>
  )
}

export default App
