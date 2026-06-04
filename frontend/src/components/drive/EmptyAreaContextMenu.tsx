import { ClipboardPaste, FolderPlus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EmptyAreaContextMenu({ x, y, open, canPasteFolder = false, onClose, onUpload, onCreateFolder, onPasteFolder }: { x: number; y: number; open: boolean; canPasteFolder?: boolean; onClose: () => void; onUpload: () => void; onCreateFolder: () => void; onPasteFolder?: () => void }) {
  if (!open) return null
  const safeX = Math.max(12, Math.min(x, window.innerWidth - 220))
  const safeY = Math.max(12, Math.min(y, window.innerHeight - 148))

  return (
    <>
      <button className="fixed inset-0 z-40 cursor-default" aria-label="Close empty area menu" onClick={onClose} />
      <div className="fixed z-50 w-52 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/15" style={{ left: safeX, top: safeY }}>
        <Button variant="ghost" className="w-full justify-start" onClick={onUpload}><Upload className="h-4 w-4" />Upload File</Button>
        <Button variant="ghost" className="w-full justify-start" onClick={onCreateFolder}><FolderPlus className="h-4 w-4" />Create Folder</Button>
        {canPasteFolder ? <Button variant="ghost" className="w-full justify-start" onClick={onPasteFolder}><ClipboardPaste className="h-4 w-4" />Paste Folder Here</Button> : null}
      </div>
    </>
  )
}
