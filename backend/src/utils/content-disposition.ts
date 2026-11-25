// HTTP headers can't carry most Unicode, and Node throws if one does. filename is an ASCII
// fallback; filename* (RFC 5987) holds the real name and browsers prefer it.
export function contentDisposition(type: 'inline' | 'attachment', fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download'
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
