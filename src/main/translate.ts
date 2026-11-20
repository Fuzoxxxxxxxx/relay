import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Traduction française des descriptions (DeepL API). Les textes déjà français sont renvoyés tels quels ;
 * les traductions sont conservées sur disque (clé = empreinte du texte source) : un texte n'est donc
 * traduit qu'une fois, et une description modifiée en amont est retraduite automatiquement.
 */

const frenchWords = new Set([
  'le', 'la', 'les', 'des', 'une', 'un', 'et', 'est', 'dans', 'pour', 'sur', 'avec', 'qui', 'que', 'du', 'au', 'aux',
  'ce', 'cette', 'ces', 'vous', 'votre', 'vos', 'ses', 'sont', 'par', 'pas', 'plus', 'mais', 'ou', 'où', 'en', 'il',
  'elle', 'ils', 'leur', 'leurs', 'son', 'sa', 'nous', 'être', 'avoir', 'jeu', 'de', 'd', 'l', 'qu',
])
const englishWords = new Set([
  'the', 'and', 'of', 'to', 'in', 'is', 'that', 'for', 'with', 'as', 'are', 'you', 'your', 'it', 'this', 'be', 'on',
  'by', 'from', 'an', 'will', 'their', 'can', 'its', 'has', 'have', 'game', 'a', 'or', 'his', 'her', 'they', 'which',
])

/** Heuristique simple : plus de mots-outils français qu'anglais. */
export function looksFrench(text: string): boolean {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  let french = 0
  let english = 0
  for (const word of words) {
    if (frenchWords.has(word)) french += 1
    if (englishWords.has(word)) english += 1
  }
  return french > english
}

const requestTimeoutMs = 15_000
const blockedDurationMs = 10 * 60 * 1000

function endpointFor(key: string): string {
  return key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com'
}

export class FrenchTranslator {
  private blockedUntil = 0
  private queue: Promise<unknown> = Promise.resolve()

  private readonly readKey: () => Promise<string | null>
  private readonly cacheDirectory: () => Promise<string>

  constructor(readKey: () => Promise<string | null>, cacheDirectory: () => Promise<string>) {
    this.readKey = readKey
    this.cacheDirectory = cacheDirectory
  }

  /** Vérifie une clé DeepL (lève une erreur lisible si elle est refusée). */
  async validateKey(key: string): Promise<void> {
    if (!/^[A-Za-z0-9-]{20,64}(?::fx)?$/.test(key)) throw new Error('La clé d’API DeepL est invalide.')
    const response = await fetch(`${endpointFor(key)}/v2/usage`, {
      headers: { Authorization: `DeepL-Auth-Key ${key}` },
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    if (response.status === 403 || response.status === 401) throw new Error('Clé DeepL refusée : vérifiez qu’elle est correcte.')
    if (!response.ok) throw new Error(`DeepL est indisponible (HTTP ${response.status}).`)
    this.blockedUntil = 0
  }

  /** Renvoie le texte en français, ou null si la traduction est impossible (aucun texte anglais n'est jamais renvoyé). */
  async toFrench(text: string): Promise<string | null> {
    const source = text.trim()
    if (!source) return null
    if (looksFrench(source)) return source

    const file = path.join(await this.cacheDirectory(), 'translations', `${createHash('sha256').update(source).digest('hex')}.txt`)
    try {
      const cached = await readFile(file, 'utf8')
      if (cached.trim()) return cached
    } catch {
      // pas encore traduit
    }

    // Appels DeepL séquentiels pour respecter les quotas.
    const task = this.queue.then(() => this.translateRemote(source, file))
    this.queue = task.catch(() => undefined)
    return task
  }

  private async translateRemote(source: string, file: string): Promise<string | null> {
    if (Date.now() < this.blockedUntil) return null
    const key = await this.readKey()
    if (!key) return null
    try {
      const response = await fetch(`${endpointFor(key)}/v2/translate`, {
        method: 'POST',
        headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ text: source, target_lang: 'FR', preserve_formatting: '1' }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
      if (response.status === 456 || response.status === 429 || response.status === 403) {
        this.blockedUntil = Date.now() + blockedDurationMs
        return null
      }
      if (!response.ok) return null
      const payload = (await response.json()) as { translations?: Array<{ text?: string }> }
      const translated = payload.translations?.[0]?.text?.trim()
      if (!translated) return null
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, translated, 'utf8')
      return translated
    } catch {
      return null
    }
  }
}
