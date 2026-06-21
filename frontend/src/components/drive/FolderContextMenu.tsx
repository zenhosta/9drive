import { Copy, Edit3, FolderOpen, Scissors, Trash2, UserPlus } from 'lucide-react'
import type { FolderItem } from '@/data/drive-data'

type Props = {
  x: number
  y: number
  folder: FolderItem | null
  onClose: () => void
  onCut: () => void
  onRename: () => void
  onInvite: () => void
  onCopyLink: () => void
  onDelete: () => void
}

function MenuItem({ icon: Icon, label, onClick, danger = false, kbd }: { icon: React.ElementType; label: string; onClick: () => void; danger?: boolean; kbd?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-semibold transition-all duration-150',
        danger
          ? 'text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/70',
      ].join(' ')}
    >
      <span className={[
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-150',
        danger
          ? 'bg-red-50 text-red-500 group-hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400'
          : 'bg-slate-100 text-slate-500 group-hover:bg-white group-hover:shadow-sm dark:bg-slate-800 dark:text-slate-400',
      ].join(' ')}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="flex-1 text-left">{label}</span>
      {kbd && (
        <kbd className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 group-hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500 sm:inline">
          {kbd}
        </kbd>
      )}
    </button>
  )
}

export function FolderContextMenu({ x, y, folder, onClose, onCut, onRename, onInvite, onCopyLink, onDelete }: Props) {
  if (!folder) return null
  const safeX = Math.max(12, Math.min(x, window.innerWidth - 228))
  const safeY = Math.max(12, Math.min(y, window.innerHeight - 280))

  return (
    <>
      <button
        className="fixed inset-0 z-40 cursor-default"
        aria-label="Close folder menu"
        onClick={onClose}
      />
      <div
        className="fixed z-50 w-56 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-2xl shadow-slate-950/15 backdrop-blur-2xl dark:border-slate-800/70 dark:bg-slate-900/95"
        style={
          window.innerWidth >= 640
            ? { left: safeX, top: safeY }
            : { insetInline: '0.75rem', bottom: '0.75rem', position: 'fixed' }
        }
      >
        {/* Header */}
        <div className="border-b border-slate-100 bg-slate-50/80 px-3.5 py-3 dark:border-slate-800 dark:bg-slate-800/50">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-950/40">
              <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold leading-tight text-slate-900 dark:text-slate-100">{folder.name}</p>
              <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500">Virtual folder</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-1.5">
          <MenuItem icon={Copy} label="Copy Link" onClick={onCopyLink} />
          <MenuItem icon={Scissors} label="Cut" onClick={onCut} kbd="⌘X" />
          <MenuItem icon={Edit3} label="Rename" onClick={onRename} />
          <MenuItem icon={UserPlus} label="Invite Member" onClick={onInvite} />
          <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
          <MenuItem icon={Trash2} label="Delete Folder" onClick={onDelete} danger />
        </div>
      </div>
    </>
  )
}
