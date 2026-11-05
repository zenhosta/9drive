import { app } from './app.js'
import { env } from './config/env.js'
import { startMoveRunner } from './modules/jobs/move-runner.js'

app.listen(env.APP_PORT, () => {
  console.log(`Backend running on http://localhost:${env.APP_PORT}`)
  startMoveRunner().catch((error) => console.error('Failed to start move runner:', error instanceof Error ? error.message : error))
})
