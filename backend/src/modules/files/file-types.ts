import type { Prisma } from '@prisma/client'

/*
 * Single source of truth for "Files by type". Edit the lists below to change how files are grouped.
 *
 * classify(mime, name):
 *   1. a MIME rule (exact or prefix) decides first;
 *   2. otherwise the file extension decides (this also covers generic types like application/octet-stream
 *      and text/plain, which are deliberately NOT listed as MIME rules);
 *   3. otherwise text/plain counts as a document and everything else as "other".
 * The same data builds the SQL filter, so counts, tabs and the file list always agree.
 */

export const CATEGORY_KEYS = ['images', 'videos', 'audio', 'documents', 'spreadsheets', 'presentations', 'archives', 'code', 'other'] as const
export type CategoryKey = (typeof CATEGORY_KEYS)[number]

type Rule = { label: string; mimePrefixes?: string[]; mimeExact?: string[]; extensions: string[] }

export const FILE_TYPE_CATEGORIES: Record<Exclude<CategoryKey, 'other'>, Rule> = {
  images: {
    label: 'Images',
    mimePrefixes: ['image/'],
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'heic', 'heif', 'avif', 'tif', 'tiff', 'ico', 'cr2', 'nef', 'arw', 'dng', 'psd'],
  },
  videos: {
    label: 'Videos',
    mimePrefixes: ['video/'],
    extensions: ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp'],
  },
  audio: {
    label: 'Audio',
    mimePrefixes: ['audio/'],
    extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff', 'mid', 'midi'],
  },
  documents: {
    label: 'Documents',
    mimeExact: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/rtf',
      'text/rtf',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.google-apps.document',
      'application/epub+zip',
      'text/markdown',
    ],
    extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md', 'epub', 'pages'],
  },
  spreadsheets: {
    label: 'Spreadsheets',
    mimeExact: [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.google-apps.spreadsheet',
      'text/csv',
      'text/tab-separated-values',
    ],
    extensions: ['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers'],
  },
  presentations: {
    label: 'Presentations',
    mimeExact: [
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.presentation',
      'application/vnd.google-apps.presentation',
    ],
    extensions: ['ppt', 'pptx', 'odp', 'key'],
  },
  archives: {
    label: 'Archives',
    mimeExact: [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-rar-compressed',
      'application/vnd.rar',
      'application/x-7z-compressed',
      'application/x-tar',
      'application/gzip',
      'application/x-gzip',
      'application/x-bzip2',
      'application/x-xz',
      'application/zstd',
    ],
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'dmg'],
  },
  code: {
    label: 'Code',
    mimePrefixes: ['text/x-'],
    mimeExact: [
      'application/json',
      'application/javascript',
      'text/javascript',
      'application/typescript',
      'text/html',
      'text/css',
      'application/xml',
      'text/xml',
      'application/x-sh',
      'application/x-shellscript',
      'application/x-yaml',
      'text/yaml',
      'application/sql',
    ],
    extensions: ['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bat', 'ps1', 'json', 'xml', 'html', 'htm', 'css', 'scss', 'yml', 'yaml', 'sql', 'swift', 'kt', 'lua', 'vue', 'toml', 'ini'],
  },
}

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  images: FILE_TYPE_CATEGORIES.images.label,
  videos: FILE_TYPE_CATEGORIES.videos.label,
  audio: FILE_TYPE_CATEGORIES.audio.label,
  documents: FILE_TYPE_CATEGORIES.documents.label,
  spreadsheets: FILE_TYPE_CATEGORIES.spreadsheets.label,
  presentations: FILE_TYPE_CATEGORIES.presentations.label,
  archives: FILE_TYPE_CATEGORIES.archives.label,
  code: FILE_TYPE_CATEGORIES.code.label,
  other: 'Other',
}

const GENERIC_TEXT = 'text/plain'
const ruleEntries = Object.entries(FILE_TYPE_CATEGORIES) as Array<[Exclude<CategoryKey, 'other'>, Rule]>

export function extensionOf(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
}

function categoryByMime(mime: string): Exclude<CategoryKey, 'other'> | null {
  for (const [key, rule] of ruleEntries) {
    if (rule.mimeExact?.includes(mime)) return key
    if (rule.mimePrefixes?.some((p) => mime.startsWith(p))) return key
  }
  return null
}

function categoryByExtension(ext: string): Exclude<CategoryKey, 'other'> | null {
  if (!ext) return null
  for (const [key, rule] of ruleEntries) if (rule.extensions.includes(ext)) return key
  return null
}

export function classifyFile(mimeType: string, name: string): CategoryKey {
  const mime = (mimeType ?? '').toLowerCase().trim()
  return categoryByMime(mime) ?? categoryByExtension(extensionOf(name)) ?? (mime === GENERIC_TEXT ? 'documents' : 'other')
}

// ---- SQL filter built from the same rules ----

type FileWhere = Prisma.FileWhereInput

function mimeMatch(rule: Rule): FileWhere[] {
  return [
    ...(rule.mimeExact?.length ? [{ mimeType: { in: rule.mimeExact } }] : []),
    ...(rule.mimePrefixes ?? []).map((p) => ({ mimeType: { startsWith: p } })),
  ]
}

function extMatch(rule: Rule): FileWhere[] {
  // MySQL's default collation is case-insensitive, so ".PDF" matches too.
  return rule.extensions.map((e) => ({ name: { endsWith: `.${e}` } }))
}

const anyMime = (): FileWhere => ({ OR: ruleEntries.flatMap(([, rule]) => mimeMatch(rule)) })
const anyExt = (): FileWhere => ({ OR: ruleEntries.flatMap(([, rule]) => extMatch(rule)) })

export function categoryWhere(category: CategoryKey): FileWhere {
  const noMimeRule: FileWhere = { NOT: anyMime() }
  if (category === 'other') return { AND: [noMimeRule, { NOT: anyExt() }, { NOT: { mimeType: GENERIC_TEXT } }] }
  const rule = FILE_TYPE_CATEGORIES[category]
  const branches: FileWhere[] = [
    ...mimeMatch(rule).length ? [{ OR: mimeMatch(rule) }] : [],
    { AND: [noMimeRule, { OR: extMatch(rule) }] },
  ]
  // Unrecognised plain-text files default to documents.
  if (category === 'documents') branches.push({ AND: [noMimeRule, { mimeType: GENERIC_TEXT }, { NOT: anyExt() }] })
  return { OR: branches }
}
