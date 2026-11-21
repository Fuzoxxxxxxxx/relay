import { useEffect, useState } from 'react'
import type { UpdateState } from '../shared/types'

/** État des mises à jour automatiques, tenu à jour par le processus principal. */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    let active = true
    window.relay.update.getState()
      .then((initial) => {
        if (active) setState((current) => current ?? initial)
      })
      .catch(() => undefined)
    const unsubscribe = window.relay.update.onState((next) => {
      if (active) setState(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return state
}
