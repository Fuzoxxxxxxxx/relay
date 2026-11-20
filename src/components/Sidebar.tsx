import { Clock3, Heart, LayoutDashboard, LayoutGrid, LoaderCircle, Plus, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { LibraryFilter } from '../shared/types'

export type AppView = 'home' | 'library' | 'settings'

interface SidebarProps {
  view: AppView
  filter: LibraryFilter
  adding: boolean
  onHome: () => void
  onLibrary: (filter: LibraryFilter) => void
  onAdd: () => void
  onSettings: () => void
}

interface RailItem {
  id: string
  label: string
  icon: LucideIcon
  active: boolean
  onClick: () => void
}

/** Rail de navigation : icônes avec libellé court, l'élément actif est marqué par une pastille. */
export function Sidebar({ view, filter, adding, onHome, onLibrary, onAdd, onSettings }: SidebarProps) {
  const inLibrary = view === 'library'
  const items: RailItem[] = [
    { id: 'home', label: 'Accueil', icon: LayoutDashboard, active: view === 'home', onClick: onHome },
    { id: 'library', label: 'Jeux', icon: LayoutGrid, active: inLibrary && filter !== 'favorites' && filter !== 'recent', onClick: () => onLibrary('all') },
    { id: 'favorites', label: 'Favoris', icon: Heart, active: inLibrary && filter === 'favorites', onClick: () => onLibrary('favorites') },
    { id: 'recent', label: 'Récents', icon: Clock3, active: inLibrary && filter === 'recent', onClick: () => onLibrary('recent') },
  ]
  return (
    <nav className="rail" aria-label="Navigation principale">
      <div className="rail-group">
        {items.map(({ id, label, icon: Icon, active, onClick }) => (
          <button key={id} className={`rail-item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="rail-group">
        <button className="rail-item" disabled={adding} onClick={onAdd}>
          {adding ? <LoaderCircle size={21} className="spin" /> : <Plus size={21} />}
          <span>Ajouter</span>
        </button>
        <button className={`rail-item${view === 'settings' ? ' is-active' : ''}`} aria-current={view === 'settings' ? 'page' : undefined} onClick={onSettings}>
          <Settings size={21} />
          <span>Réglages</span>
        </button>
      </div>
    </nav>
  )
}
