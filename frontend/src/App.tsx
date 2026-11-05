import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { DriveLayout } from '@/layouts/DriveLayout'
import { AllFilesPage } from '@/pages/AllFilesPage'
import { ArchivedPage } from '@/pages/ArchivedPage'
import { FilesByTypePage } from '@/pages/FilesByTypePage'
import { JobsPage } from '@/pages/JobsPage'
import { RebalancePage } from '@/pages/RebalancePage'
import { ToastProvider } from '@/context/ToastContext'
import { JobsProvider } from '@/context/JobsContext'
import { JobsToast } from '@/components/drive/JobsToast'
import { OverviewPage } from '@/pages/OverviewPage'
import { LoginPage } from '@/pages/LoginPage'
import { GoogleAuthPage } from '@/pages/GoogleAuthPage'
import { GoogleConnectedPage } from '@/pages/GoogleConnectedPage'
import { QuotaTrackerPage } from '@/pages/QuotaTrackerPage'
import { RecentPage } from '@/pages/RecentPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SharedPage } from '@/pages/SharedPage'
import { StarredPage } from '@/pages/StarredPage'
import { PublicFilePage } from '@/pages/PublicFilePage'
import { ApiManagementPage } from '@/pages/ApiManagementPage'
import { TrashPage } from '@/pages/TrashPage'
import { ActivityLogPage } from '@/pages/ActivityLogPage'
import { UploadProvider } from '@/context/UploadContext'


function App() {
  return (
    <ToastProvider>
    <UploadProvider>
      <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="register" element={<RegisterPage />} />
      <Route path="google-auth" element={<GoogleAuthPage />} />
      <Route path="google-connected" element={<GoogleConnectedPage />} />
      <Route path="public/files/:token" element={<PublicFilePage />} />
      <Route path="public/files/:token/embed" element={<PublicFilePage embed />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<JobsProvider><DriveLayout /><JobsToast /></JobsProvider>}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="all-files" element={<AllFilesPage />} />
          <Route path="files-by-type" element={<FilesByTypePage />} />
          <Route path="move-jobs" element={<JobsPage />} />
          <Route path="rebalance" element={<RebalancePage />} />
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
      <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </UploadProvider>
    </ToastProvider>
  )
}


export default App
