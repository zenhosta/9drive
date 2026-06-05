import { ClipboardPaste, FolderPlus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EmptyAreaContextMenu({ x, y, open, canPasteFolder = false, onClose, onUpload, onCreateFolder, onPasteFolder }: { x: number; y: number; open: boolean; canPasteFolder?: boolean; onClose: () => void; onUpload: () => void; onCreateFolder: () => void; onPasteFolder?: () => void }) {
  if (!open) return null
  const safeX = Math.max(12, Math.min(x, window.innerWidth - 220))
  const safeY = Math.max(12, Math.min(y, window.innerHeight - 148))

  return (
    <>
      <button className="fixed inset-0 z-40 cursor-default bg-slate-950/20 sm:bg-transparent" aria-label="Close empty area menu" onClick={onClose} />
      <div className="fixed inset-x-3 bottom-3 z-50 rounded-3xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/15 sm:inset-x-auto sm:bottom-auto sm:w-52 sm:rounded-2xl" style={{ left: window.innerWidth >= 640 ? safeX : undefined, top: window.innerWidth >= 640 ? safeY : undefined }}>
        <Button variant="ghost" className="h-12 w-full justify-start sm:h-11" onClick={onUpload}><Upload className="h-4 w-4" />Upload File</Button>
        <Button variant="ghost" className="h-12 w-full justify-start sm:h-11" onClick={onCreateFolder}><FolderPlus className="h-4 w-4" />Create Folder</Button>
        {canPasteFolder ? <Button variant="ghost" className="h-12 w-full justify-start sm:h-11" onClick={onPasteFolder}><ClipboardPaste className="h-4 w-4" />Paste Folder Here</Button> : null}
      </div>
    </>
  )
}
