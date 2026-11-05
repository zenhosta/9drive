import { google } from 'googleapis'
import { prisma } from '../config/prisma.js'
import { getAuthedGoogleClient } from '../modules/google/google.service.js'

// Older versions of 9Drive gave every uploaded Google Drive file an
// "anyone with the link can edit" permission. This script removes those
// public permissions from files tracked by 9Drive.
//
//   npm run drive:revoke-public -- --dry-run   # report only, change nothing
//   npm run drive:revoke-public                # remove public edit access
//   npm run drive:revoke-public -- --all       # also remove public view-only links

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const includeReaders = args.has('--all')

function shouldRevoke(permission: { type?: string | null; role?: string | null }) {
  if (permission.type !== 'anyone') return false
  return includeReaders || permission.role !== 'reader'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function main() {
  console.log(`Revoking public Google Drive permissions${dryRun ? ' (dry run)' : ''}; scope: ${includeReaders ? 'all public links' : 'public edit access only'}`)

  const accounts = await prisma.connectedAccount.findMany({ where: { provider: 'google_drive', status: 'connected' } })
  let checked = 0
  let revoked = 0
  let failed = 0

  for (const account of accounts) {
    let drive
    try {
      drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(account) })
    } catch (error) {
      console.error(`[${account.email}] skipped: could not authenticate (${errorMessage(error)})`)
      continue
    }

    const files = await prisma.file.findMany({
      where: { connectedAccountId: account.id, provider: 'google_drive', status: { in: ['active', 'deleted'] } },
      select: { id: true, name: true, providerFileId: true },
    })
    console.log(`[${account.email}] checking ${files.length} file(s)`)

    for (const file of files) {
      checked += 1
      try {
        const { data } = await drive.permissions.list({ fileId: file.providerFileId, fields: 'permissions(id,type,role)' })
        for (const permission of data.permissions ?? []) {
          if (!permission.id || !shouldRevoke(permission)) continue
          if (!dryRun) await drive.permissions.delete({ fileId: file.providerFileId, permissionId: permission.id })
          revoked += 1
          console.log(`  ${dryRun ? 'would revoke' : 'revoked'} anyone/${permission.role} on "${file.name}"`)
        }
      } catch (error) {
        failed += 1
        console.error(`  failed on "${file.name}": ${errorMessage(error)}`)
      }
    }
  }

  console.log(`Done. Files checked: ${checked}. Permissions ${dryRun ? 'to revoke' : 'revoked'}: ${revoked}. Failures: ${failed}.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
