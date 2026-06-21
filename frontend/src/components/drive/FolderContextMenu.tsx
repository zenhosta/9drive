import { Edit3, Scissors, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FolderItem } from '@/data/drive-data'

export function FolderContextMenu({ x, y, folder, onClose, onCut, onRename, onInvite, onDelete }: { x: number; y: number; folder: FolderItem | null; onClose: () => void; onCut: () => void; onRename: () => void; onInvite: () => void; onDelete: () => void }) {
  if (!folder) return null
  const safeX = Math.max(12, Math.min(x, window.innerWidth - 220))
  const safeY = Math.max(12, Math.min(y, window.innerHeight - 224))

  return (
    <>
      <button className="fixed inset-0 z-40 cursor-default bg-slate-950/20 sm:bg-transparent" aria-label="Close folder menu" onClick={onClose} />
      <div className="fixed inset-x-3 bottom-3 z-50 rounded-3xl border border-slate-200/80 bg-white/95 p-2 shadow-2xl shadow-slate-950/10 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/95 sm:inset-x-auto sm:bottom-auto sm:w-52 sm:rounded-2xl" style={{ left: window.innerWidth >= 640 ? safeX : undefined, top: window.innerWidth >= 640 ? safeY : undefined }}>
        <p className="truncate px-3 py-2 text-xs font-extrabold text-slate-700 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 mb-1">{folder.name}</p>
        <Button variant="ghost" className="h-10 w-full justify-start text-[13px] font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors duration-150" onClick={onCut}><Scissors className="h-4 w-4 text-slate-500" />Cut</Button>
        <Button variant="ghost" className="h-10 w-full justify-start text-[13px] font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors duration-150" onClick={onRename}><Edit3 className="h-4 w-4 text-slate-500" />Rename</Button>
        <Button variant="ghost" className="h-10 w-full justify-start text-[13px] font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors duration-150" onClick={onInvite}><UserPlus className="h-4 w-4 text-slate-500" />Invite Member</Button>
        <div className="border-t border-slate-100 dark:border-slate-800 mt-1 pt-1">
          <Button variant="danger" className="h-10 w-full justify-start text-[13px] font-bold hover:bg-orange-100/80 dark:hover:bg-orange-950/40 text-orange-600 dark:text-orange-400 transition-colors duration-150" onClick={onDelete}><Trash2 className="h-4 w-4 text-orange-500" />Delete</Button>
        </div>
      </div>
    </>
  )
}
