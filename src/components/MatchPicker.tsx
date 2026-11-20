import { useEffect, useState } from 'react'
import { LoaderCircle, Search, X } from 'lucide-react'
import { initials } from '../lib/format'
import type { MatchCandidate } from '../shared/types'

interface MatchPickerProps {
  gameId: string
  initialQuery: string
  onSelect: (candidate: MatchCandidate) => void
  onClose: () => void
}

const sourceLabels: Record<MatchCandidate['source'], string> = { steam: 'Steam', igdb: 'IGDB', egdata: 'Epic Games (egdata)' }

/** Recherche manuelle du « vrai » jeu : l'utilisateur tranche quand la détection automatique est impossible ou fausse. */
export function MatchPicker({ gameId, initialQuery, onSelect, onClose }: MatchPickerProps) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<MatchCandidate[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      setState('ready')
      return
    }
    let cancelled = false
    setState('loading')
    const timeout = window.setTimeout(() => {
      window.nexora.metadata.searchMatches(gameId, term)
        .then((candidates) => {
          if (cancelled) return
          setResults(candidates)
          setState('ready')
        })
        .catch((searchError: unknown) => {
          if (cancelled) return
          setError(searchError instanceof Error ? searchError.message : 'La recherche a échoué.')
          setState('error')
        })
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [gameId, query])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="match-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2 id="match-title">Choisir le bon jeu</h2>
            <p>Les images et la description seront récupérées pour le jeu que vous sélectionnez.</p>
          </div>
          <button className="icon-btn" aria-label="Fermer" onClick={onClose}><X size={18} /></button>
        </header>
        <label className="modal-search">
          <Search size={16} />
          <input autoFocus value={query} placeholder="Nom du jeu" aria-label="Nom du jeu à rechercher" onChange={(event) => setQuery(event.target.value)} />
          {state === 'loading' && <LoaderCircle size={16} className="spin" />}
        </label>
        <div className="modal-results">
          {state === 'error' && <p className="modal-note is-error">{error}</p>}
          {state === 'ready' && results.length === 0 && (
            <p className="modal-note">{query.trim().length < 2 ? 'Saisissez au moins 2 caractères.' : 'Aucun résultat. Essayez le nom officiel en anglais.'}</p>
          )}
          {results.map((candidate) => (
            <button key={`${candidate.source}-${candidate.id}`} className="candidate" onClick={() => onSelect(candidate)}>
              <span className="candidate-art">
                {candidate.thumbnail ? <img src={candidate.thumbnail} alt="" draggable={false} /> : <span>{initials(candidate.name)}</span>}
              </span>
              <span className="candidate-text">
                <strong>{candidate.name}</strong>
                <small>{sourceLabels[candidate.source]}{candidate.year ? ` · ${candidate.year}` : ''}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
