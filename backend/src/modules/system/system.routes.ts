import { Router } from 'express'
import { exec, execFile, spawn } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { requireAdmin, type AuthRequest } from '../../middleware/auth.middleware.js'
import { prisma } from '../../config/prisma.js'
import { decryptText, encryptText } from '../../utils/crypto.js'
import Busboy from 'busboy'

export const systemRouter = Router()
const execFileAsync = promisify(execFile)

function mysqlConnection() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl?.startsWith('mysql://')) throw new Error('MySQL database configuration is required.')
  const url = new URL(databaseUrl)
  return {
    host: url.hostname,
    port: url.port || '3306',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '').split('?')[0],
  }
}

function mysqlArgs(connection: ReturnType<typeof mysqlConnection>) {
  return ['--host', connection.host, '--port', connection.port, '--user', connection.user, connection.database]
}


systemRouter.post('/update', requireAdmin, (req, res, next) => {
  const projectRoot = path.resolve(process.cwd(), '..')
  const updateScript = path.join(projectRoot, 'update.sh')

  // Check if git is installed
  exec('git --version', (gitError) => {
    if (gitError) {
      return res.status(400).json({
        code: 'GIT_NOT_FOUND',
        message: 'System update is unavailable on this server.'
      })
    }

    if (fs.existsSync(updateScript)) {
      try {
        // Clear old update log to prevent race conditions on frontend polling
        const logFile = path.join(projectRoot, 'update.log')
        fs.writeFileSync(logFile, 'Initiating update...\n')

        const child = spawn('bash', ['update.sh'], {
          cwd: projectRoot,
          detached: true,
          stdio: 'ignore'
        })
        child.unref()

        return res.json({
          status: 'success',
          message: 'System update initiated. Rebuilding and restarting backend & frontend in the background. Please wait ~1 minute and refresh the page.'
        })
      } catch (err: any) {
        return res.status(500).json({
          code: 'UPDATE_FAILED',
          message: 'Failed to start system update.'
        })
      }
    } else {
      // Fallback to simple git pull if update.sh doesn't exist
      exec('git pull', { cwd: projectRoot }, (error, stdout, stderr) => {
        if (error) {
          console.error('System update failed:', error)
          return res.status(500).json({
            code: 'UPDATE_FAILED',
            message: 'Failed to update the system.'
          })
        }

        console.log('System update stdout:', stdout)
        if (stderr) {
          console.warn('System update stderr:', stderr)
        }

        return res.json({
          status: 'success',
          message: 'System code updated successfully. Dev servers will auto-restart.'
        })
      })
    }
  })
})

systemRouter.get('/update-log', requireAdmin, (req, res) => {
  const projectRoot = path.resolve(process.cwd(), '..')
  const logFile = path.join(projectRoot, 'update.log')

  if (!fs.existsSync(logFile)) {
    return res.json({
      log: 'No update history found.'
    })
  }

  try {
    const logContent = fs.readFileSync(logFile, 'utf8')
    return res.json({
      log: logContent
    })
  } catch (error: any) {
    return res.status(500).json({
      code: 'READ_LOG_FAILED',
      message: 'Failed to read update log file.',
      error: error.message
    })
  }
})

systemRouter.get('/google-config', requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const config = await prisma.providerConfig.findFirst({
      where: { userId: null, provider: 'google_drive', status: 'active' },
      orderBy: { createdAt: 'desc' }
    })

    const defaultRedirect = `${req.protocol}://${req.get('host')}/connected-accounts/google/callback`

    if (!config) {
      return res.json({
        exists: false,
        defaultRedirectUri: defaultRedirect
      })
    }

    let clientId = ''
    try {
      clientId = decryptText(config.clientIdEncrypted)
    } catch {
      clientId = ''
    }

    return res.json({
      exists: true,
      clientId,
      redirectUri: config.redirectUri,
      hasSecret: !!config.clientSecretEncrypted,
      defaultRedirectUri: defaultRedirect
    })
  } catch (error) {
    return next(error)
  }
})

systemRouter.post('/google-config', requireAdmin, async (req, res, next) => {
  try {
    const { clientId, clientSecret, redirectUri } = req.body

    if (!clientId) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Client ID is required.' })
    }

    const defaultRedirect = `${req.protocol}://${req.get('host')}/connected-accounts/google/callback`
    const finalRedirectUri = redirectUri || defaultRedirect

    const scopes = [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ]

    // Disable old global active config
    await prisma.providerConfig.updateMany({
      where: { userId: null, provider: 'google_drive', status: 'active' },
      data: { status: 'disabled' }
    })

    // Retrieve the old config to see if we need to reuse the secret if it was not provided in the request
    let finalSecret = clientSecret
    if (!finalSecret) {
      const oldConfig = await prisma.providerConfig.findFirst({
        where: { userId: null, provider: 'google_drive', status: 'disabled' },
        orderBy: { createdAt: 'desc' }
      })
      if (oldConfig) {
        try {
          finalSecret = decryptText(oldConfig.clientSecretEncrypted)
        } catch {
          // ignore
        }
      }
    }

    if (!finalSecret) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'Client Secret is required for first-time setup.' })
    }

    const config = await prisma.providerConfig.create({
      data: {
        userId: null,
        provider: 'google_drive',
        clientIdEncrypted: encryptText(clientId),
        clientSecretEncrypted: encryptText(finalSecret),
        redirectUri: finalRedirectUri,
        scopes,
        status: 'active'
      }
    })

    return res.status(201).json({
      status: 'success',
      message: 'Global Google OAuth configuration updated successfully.',
      id: config.id
    })
  } catch (error) {
    return next(error)
  }
})

systemRouter.get('/backup', requireAdmin, async (req, res, next) => {
  let temporaryDirectory = ''
  try {
    const connection = mysqlConnection()
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), '9drive-backup-'))
    const backupPath = path.join(temporaryDirectory, '9drive-backup.sql')
    await execFileAsync('mysqldump', ['--single-transaction', '--routines', '--events', ...mysqlArgs(connection), '--result-file', backupPath], { env: { ...process.env, MYSQL_PWD: connection.password } })
    res.setHeader('Content-Disposition', 'attachment; filename=9drive-backup.sql')
    res.setHeader('Content-Type', 'application/sql')
    const fileStream = fs.createReadStream(backupPath)
    fileStream.on('close', () => fs.rmSync(temporaryDirectory, { recursive: true, force: true }))
    fileStream.pipe(res)
  } catch (error) {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    return next(error)
  }
})

systemRouter.post('/restore', requireAdmin, async (req, res, next) => {
  let temporaryDirectory = ''
  try {
    if (req.header('x-restore-confirm') !== 'RESTORE-9DRIVE') return res.status(400).json({ code: 'RESTORE_CONFIRMATION_REQUIRED', message: 'Explicit restore confirmation is required.' })
    const contentType = req.headers['content-type']
    if (!contentType?.includes('multipart/form-data')) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'multipart/form-data required.' })
    }

    const busboy = Busboy({ headers: req.headers, limits: { files: 1 } })
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), '9drive-restore-'))
    const restorePath = path.join(temporaryDirectory, 'restore.sql')
    let fileReceived = false
    const writePromise = new Promise<void>((resolve, reject) => {
      busboy.on('file', (_name, fileStream) => {
        fileReceived = true
        fileStream.pipe(fs.createWriteStream(restorePath).on('finish', resolve).on('error', reject))
      })
      busboy.on('error', reject)
      busboy.on('finish', () => {
        if (!fileReceived) reject(new Error('No file uploaded.'))
      })
    })
    req.pipe(busboy)
    await writePromise
    const header = Buffer.alloc(4096)
    const descriptor = fs.openSync(restorePath, 'r')
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0)
    fs.closeSync(descriptor)
    if (!bytesRead || !header.subarray(0, bytesRead).toString('utf8').includes('MySQL')) throw new Error('Backup format validation failed.')

    const connection = mysqlConnection()
    const restoreProcess = spawn('mysql', mysqlArgs(connection), { env: { ...process.env, MYSQL_PWD: connection.password }, stdio: ['pipe', 'ignore', 'pipe'] })
    const diagnostics: Buffer[] = []
    restoreProcess.stderr.on('data', (chunk) => diagnostics.push(Buffer.from(chunk)))
    fs.createReadStream(restorePath).pipe(restoreProcess.stdin)
    const exitCode = await new Promise<number>((resolve, reject) => {
      restoreProcess.on('error', reject)
      restoreProcess.on('close', (code) => resolve(code ?? 1))
    })
    if (exitCode !== 0) throw new Error(`MySQL restore failed: ${diagnostics.join('').slice(0, 500)}`)
    return res.json({ status: 'success', message: 'MySQL database restored successfully.' })
  } catch (error) {
    return next(error)
  } finally {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})
