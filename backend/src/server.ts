import { app } from './app.js'
import { env } from './config/env.js'
import { startThumbCacheSweeper } from './modules/drive-index/thumb-cache.js'
import { recoverScans } from './modules/drive-index/drive-scan.js'
import { startMoveRunner } from './modules/jobs/move-runner.js'

app.listen(env.APP_PORT, () => {
  console.log(`Backend running on http://localhost:${env.APP_PORT}`)
  startThumbCacheSweeper()
  recoverScans().catch(() => undefined)
  startMoveRunner().catch((error) => console.error('Failed to start move runner:', error instanceof Error ? error.message : error))
})
