import { lstat, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * Taille d'un dossier d'installation : parcours récursif asynchrone, sans suivre les liens symboliques, avec un cache
 * de quelques minutes et un garde-fou de durée (un dossier énorme renvoie « indisponible » plutôt que de bloquer).
 */

const cacheDurationMs = 10 * 60 * 1000
const maxDurationMs = 90_000
const maxEntries = 3_000_000
const directoryBatch = 32
const fileBatch = 64

export class InstallSizeService {
  private readonly cache = new Map<string, { bytes: number | null; at: number }>()
  private readonly running = new Map<string, Promise<number | null>>()

  /** Taille en octets, ou null si le dossier est introuvable, trop volumineux à parcourir ou refusé (ex. racine d'un disque). */
  async size(folder: string): Promise<number | null> {
    const resolved = path.resolve(folder)
    if (path.parse(resolved).root === resolved) return null
    const cached = this.cache.get(resolved)
    if (cached && Date.now() - cached.at < cacheDurationMs) return cached.bytes
    const existing = this.running.get(resolved)
    if (existing) return existing
    const task = this.measure(resolved)
      .then((bytes) => {
        this.cache.set(resolved, { bytes, at: Date.now() })
        return bytes
      })
      .finally(() => this.running.delete(resolved))
    this.running.set(resolved, task)
    return task
  }

  private async measure(root: string): Promise<number | null> {
    const rootStat = await stat(root).catch(() => null)
    if (!rootStat?.isDirectory()) return null
    const deadline = Date.now() + maxDurationMs
    const stack = [root]
    let total = 0
    let visited = 0
    while (stack.length > 0) {
      if (Date.now() > deadline || visited > maxEntries) return null
      const batch = stack.splice(-directoryBatch)
      await Promise.all(batch.map(async (directory) => {
        let entries
        try {
          entries = await readdir(directory, { withFileTypes: true })
        } catch {
          return
        }
        const files: string[] = []
        for (const entry of entries) {
          visited += 1
          if (entry.isSymbolicLink()) continue
          const fullPath = path.join(directory, entry.name)
          if (entry.isDirectory()) stack.push(fullPath)
          else if (entry.isFile()) files.push(fullPath)
        }
        for (let index = 0; index < files.length; index += fileBatch) {
          const sizes = await Promise.all(files.slice(index, index + fileBatch).map((file) => lstat(file).then((info) => info.size, () => 0)))
          for (const size of sizes) total += size
        }
      }))
    }
    return total
  }
}
