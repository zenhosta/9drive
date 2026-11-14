import { NavLink } from 'react-router-dom'
import { Cloud, Folder, Home, Settings, Workflow } from 'lucide-react'
import { cn } from '@/lib/utils'

const tabs = [
  { label: 'Home', href: '/home', icon: Home },
  { label: 'Tree Map', href: '/tree-map', icon: Workflow },
  { label: 'Files', href: '/all-files', icon: Folder },
  { label: 'Storage', href: '/quota', icon: Cloud },
  { label: 'Settings', href: '/settings', icon: Settings },
]

/**
 * Mobile tab bar from the Stitch design: five destinations, emerald glow on the
 * active tab. The desktop layout keeps the sidebar instead.
 */
export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-white/8 bg-[#070b0d]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto grid max-w-xl grid-cols-5 px-2">
        {tabs.map((tab) => (
          <NavLink
            key={tab.href}
            to={tab.href}
            end={tab.href === '/home'}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1.5 rounded-2xl px-1 py-2.5 text-[11px] font-semibold transition-colors',
                isActive ? 'tab-glow-active' : 'tab-glow hover:text-white',
              )
            }
          >
            {({ isActive }) => (
              <>
                <tab.icon className={cn('h-[22px] w-[22px]', isActive && 'glow-ring')} strokeWidth={isActive ? 2.2 : 1.8} />
                <span className="leading-none">{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
