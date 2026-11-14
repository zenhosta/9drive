import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'

export const isNative = () => Capacitor.isNativePlatform()

/** Opens an external URL in the in-app browser on Android, a new tab on the web. */
export async function openExternalUrl(url: string) {
  if (!isNative()) {
    window.location.assign(url)
    return
  }
  await Browser.open({ url })
}

/** Marks OAuth start URLs so the backend returns to the app's deep link. */
export function withMobilePlatform(path: string) {
  if (!isNative()) return path
  return `${path}${path.includes('?') ? '&' : '?'}platform=mobile`
}

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(blob)
  })
}

export function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_') || 'download'
}

/**
 * Saves a downloaded file. On the web this is a normal browser download; on
 * Android the file is written to the cache directory and handed to the system
 * share/save sheet, because WebView cannot save blob downloads by itself.
 */
export async function saveBlob(blob: Blob, fileName: string) {
  const name = safeFileName(fileName)
  if (!isNative()) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    return
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  const written = await Filesystem.writeFile({
    path: name,
    data: await toBase64(blob),
    directory: Directory.Cache,
    recursive: true,
  })
  await Share.share({ title: name, url: written.uri })
}

export async function downloadUrl(url: string, fileName: string, headers?: HeadersInit) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error('Download failed')
  await saveBlob(await response.blob(), fileName)
}
