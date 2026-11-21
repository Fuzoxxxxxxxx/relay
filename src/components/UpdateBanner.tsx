import { useState } from 'react'
import { Download, LoaderCircle, X } from 'lucide-react'
import './UpdateBanner.css'
import { useUpdateState } from '../lib/useUpdateState'

interface UpdateBannerProps {
  onError: (message: string) => void
}

/** Progression du téléchargement, puis invitation à redémarrer quand la mise à jour est prête. */
export function UpdateBanner({ onError }: UpdateBannerProps) {
  const state = useUpdateState()
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  if (!state) return null

  if (state.status === 'downloading') {
    return (
      <div className="update-banner" role="status">
        <div className="update-row">
          <LoaderCircle size={15} className="spin" />
          <span>Téléchargement de Relay {state.version ?? ''}…</span>
          <strong>{state.percent} %</strong>
        </div>
        <div className="update-progress"><span style={{ width: `${state.percent}%` }} /></div>
      </div>
    )
  }

  if (state.status === 'downloaded' && state.version !== dismissedVersion) {
    const install = async (): Promise<void> => {
      setInstalling(true)
      try {
        await window.relay.update.install()
      } catch (error) {
        setInstalling(false)
        onError(error instanceof Error ? error.message : 'La mise à jour n’a pas pu être installée.')
      }
    }
    return (
      <div className="update-banner update-ready" role="status">
        <div className="update-row">
          <Download size={16} />
          <span>Relay {state.version} est prête. Elle s’installera aussi à la fermeture de l’application.</span>
          <button className="btn btn-primary" disabled={installing} onClick={() => void install()}>
            {installing ? <LoaderCircle size={15} className="spin" /> : null}Redémarrer et installer
          </button>
          <button className="btn" aria-label="Plus tard" onClick={() => setDismissedVersion(state.version)}><X size={15} /></button>
        </div>
      </div>
    )
  }

  return null
}
