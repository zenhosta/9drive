/*
 * Checks that the SQL filters behind "Files by type" agree with classifyFile() and add up to the total.
 * Inserts throwaway rows (no Drive calls) and removes them afterwards.
 *   npx tsx src/scripts/test-file-types.ts
 */
import { prisma } from '../config/prisma.js'
import { CATEGORY_KEYS, categoryWhere, classifyFile } from '../modules/files/file-types.js'

const samples: Array<[string, string]> = [
  ['image/png', 'a.png'], ['image/jpeg', 'b.JPG'], ['application/octet-stream', 'c.heic'], ['video/mp4', 'd.mp4'], ['application/octet-stream', 'e.mkv'],
  ['audio/mpeg', 'f.mp3'], ['application/octet-stream', 'g.flac'], ['application/pdf', 'h.pdf'], ['text/plain', 'i.txt'], ['text/plain', 'notes'], ['text/plain', 'j.py'],
  ['text/plain', 'k.csv'], ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'l.docx'], ['application/vnd.google-apps.document', 'Doc'],
  ['application/vnd.ms-excel', 'm.xls'], ['application/vnd.google-apps.spreadsheet', 'Sheet'], ['text/csv', 'n.csv'],
  ['application/vnd.ms-powerpoint', 'o.ppt'], ['application/vnd.google-apps.presentation', 'Slides'], ['application/zip', 'p.zip'], ['application/octet-stream', 'q.7z'],
  ['application/x-rar-compressed', 'r.rar'], ['application/json', 's.json'], ['text/x-python', 't'], ['text/html', 'u.html'], ['application/octet-stream', 'v.ts'],
  ['application/octet-stream', 'w.bin'], ['application/vnd.google-apps.form', 'Form'], ['application/x-unknown', 'noext'], ['', 'x.PNG'], ['application/x-msdownload', 'y.exe'],
]

async function main() {
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { provider: 'google_drive' } })
  const tag = `test-types-${Date.now()}`
  await prisma.file.createMany({ data: samples.map(([mimeType, name], i) => ({ userId: account.userId, connectedAccountId: account.id, provider: 'google_drive', providerFileId: `${tag}-${i}`, name: `${tag}-${name}`, mimeType, sizeBytes: 10n })) })
  let failures = 0
  try {
    const base = { userId: account.userId, status: 'active', providerFileId: { startsWith: tag } }
    const total = await prisma.file.count({ where: base })
    let sum = 0
    for (const key of CATEGORY_KEYS) {
      const rows = await prisma.file.findMany({ where: { AND: [base, categoryWhere(key)] }, select: { name: true, mimeType: true } })
      sum += rows.length
      const wrong = rows.filter((r) => classifyFile(r.mimeType, r.name.replace(`${tag}-`, '')) !== key)
      const expected = samples.filter(([m, n]) => classifyFile(m, n) === key).length
      const ok = wrong.length === 0 && rows.length === expected
      if (!ok) failures += 1
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${key}: sql=${rows.length} expected=${expected}${wrong.length ? ` mismatches=${wrong.map((w) => w.name).join(',')}` : ''}`)
    }
    const ok = sum === total && total === samples.length
    if (!ok) failures += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  category counts add up to total (${sum} / ${total} / ${samples.length})`)
  } finally {
    await prisma.file.deleteMany({ where: { providerFileId: { startsWith: tag } } })
    await prisma.$disconnect()
  }
  process.exitCode = failures ? 1 : 0
}
main()
