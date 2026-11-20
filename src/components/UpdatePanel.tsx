import { useState } from 'react'
import { Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { useUpdateState } from '../lib/useUpdateState'
import type { UpdateState } from '../shared/types'

interface UpdatePanelProps {
  onToast: (message: string) => void
  onError: (message: string) => void
}

function describe(state: UpdateState): string {
  switch (state.status) {
    case 'disabled':
      return 'Les mises à jour automatiques sont inactives en mode développement.'
    case 'checking':
      return 'Recherche d’une mise à jour…'
    case 'downloading':
      return `Téléchargement de la version ${state.version ?? ''} : ${state.percent} %`
    case 'downloaded':
      return `La version ${state.version} est prête à être installée.`
    case 'up-to-date':
      return 'Nexora est à jour.'
    case 'error':
      return state.error ?? 'La recherche de mise à jour a échoué.'
    default:
      return 'Vérification au démarrage, puis toutes les 4 heures.'
  }
}

export function UpdatePanel({ onToast, onError }: UpdatePanelProps) {
  const state = useUpdateState()
  const [installing, setInstalling] = useState(false)

  if (!state) return null

  const checking = state.status === 'checking' || state.status === 'downloading'

  async function check(): Promise<void> {
    try {
      const result = await window.nexora.update.check()
      if (result.status === 'up-to-date') onToast('Nexora est à jour')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'La recherche de mise à jour a échoué.')
    }
  }

  async function install(): Promise<void> {
    setInstalling(true)
    try {
      await window.nexora.update.install()
    } catch (error) {
      setInstalling(false)
      onError(error instanceof Error ? error.message : 'La mise à jour n’a pas pu être installée.')
    }
  }

  return (
    <section className="panel">
      <div className="panel-head"><span className="panel-icon"><Download size={18} /></span><div><h2>Mises à jour</h2><p>Version installée : {state.currentVersion}</p></div></div>
      <div className="setting">
        <div><strong>{describe(state)}</strong><small>Les mises à jour se téléchargent en arrière-plan et s’installent à la fermeture de Nexora.</small></div>
        {state.status === 'downloaded' ? (
          <button className="btn btn-primary" disabled={installing} onClick={() => void install()}>
            {installing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}Redémarrer et installer
          </button>
        ) : (
          <button className="btn" disabled={state.status === 'disabled' || checking} onClick={() => void check()}>
            {checking ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}Rechercher
          </button>
        )}
      </div>
    </section>
  )
}
