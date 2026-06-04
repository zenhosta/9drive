import { MoreVertical, Star } from 'lucide-react'
import type { MouseEvent } from 'react'
import { AvatarStack } from '@/components/drive/AvatarStack'
import { FileIcon } from '@/components/drive/FileIcon'
import type { FileItem } from '@/data/drive-data'

export function FileTable({ files, mode = 'default', selectedFileIds = new Set<string>(), allSelected = false, onFileContextMenu, onToggleFile, onToggleAll }: { files: FileItem[]; mode?: 'default' | 'shared' | 'recent' | 'starred' | 'archived'; selectedFileIds?: Set<string>; allSelected?: boolean; onFileContextMenu?: (event: MouseEvent<HTMLElement>, file: FileItem) => void; onToggleFile?: (file: FileItem) => void; onToggleAll?: () => void }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-950">
            <th className="w-10 py-4"><input type="checkbox" className="h-4 w-4 accent-blue-600" checked={allSelected} onChange={onToggleAll} /></th>
            <th className="py-4 font-extrabold">Name</th>
            {mode === 'shared' ? <th className="py-4 font-extrabold">Owner</th> : null}
            {mode === 'recent' ? <th className="py-4 font-extrabold">Last Opened</th> : null}
            {mode === 'starred' ? <th className="py-4 font-extrabold">Starred On</th> : null}
            {mode === 'archived' ? <th className="py-4 font-extrabold">Archived Date</th> : null}
            {mode === 'archived' ? <th className="py-4 font-extrabold">Original Location</th> : <th className="py-4 font-extrabold">Last Modified</th>}
            <th className="py-4 font-extrabold">Size</th>
            <th className="py-4 font-extrabold">Access</th>
            <th className="py-4" />
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.id ?? file.name} onContextMenu={(event) => onFileContextMenu?.(event, file)} onClick={() => onToggleFile?.(file)} className={selectedFileIds.has(file.id ?? '') ? 'border-b border-blue-100 bg-blue-50 transition hover:bg-blue-50' : 'border-b border-slate-200 transition hover:bg-slate-50'}>
              <td className="py-4"><input type="checkbox" className="h-4 w-4 accent-blue-600" checked={selectedFileIds.has(file.id ?? '')} onChange={() => onToggleFile?.(file)} onClick={(event) => event.stopPropagation()} /></td>
              <td className="py-4 font-semibold">
                <span className="flex min-w-0 items-center gap-3">
                  {mode === 'starred' ? <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" /> : <FileIcon kind={file.kind} />}
                  <span className="truncate">{file.name}</span>
                </span>
              </td>
              {mode === 'shared' ? <td className="py-4 text-slate-500">{file.owner}</td> : null}
              {mode === 'recent' ? <td className="py-4 text-slate-500">{file.openedDate}</td> : null}
              {mode === 'starred' ? <td className="py-4 text-slate-500">{file.starredDate}</td> : null}
              {mode === 'archived' ? <td className="py-4 text-slate-500">{file.archivedDate}</td> : null}
              <td className="py-4 text-slate-500">{mode === 'archived' ? file.location : file.date}</td>
              <td className="py-4 text-slate-500">{file.size}</td>
              <td className="py-4 text-slate-500"><span className="flex items-center gap-3"><AvatarStack count={file.shared} />{file.access}</span></td>
              <td className="py-4 text-right"><button className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={(event) => { event.stopPropagation(); onFileContextMenu?.(event, file) }} aria-label={`Open ${file.name} menu`}><MoreVertical className="h-5 w-5" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
