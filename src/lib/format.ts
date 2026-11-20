export function formatRelative(value: string | null): string {
  if (!value) return 'Jamais lancé'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date inconnue'
  const hours = Math.floor((Date.now() - date.getTime()) / 3_600_000)
  if (hours < 1) return 'À l’instant'
  if (hours < 24) return `Il y a ${hours} h`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Il y a 1 jour'
  if (days < 30) return `Il y a ${days} jours`
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: days > 330 ? 'numeric' : undefined })
}

export function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date inconnue'
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Teinte stable (0-359) dérivée d'un texte, pour les visuels de secours. */
export function textHue(text: string): number {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  return hash % 360
}

export function initials(title: string): string {
  const words = title.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase('fr')
  return (words[0][0] + words[1][0]).toLocaleUpperCase('fr')
}

/** Taille lisible en unités françaises (o, Ko, Mo, Go, To ; base 1024 comme l'Explorateur Windows). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  const units = ['Ko', 'Mo', 'Go', 'To']
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit += 1
  } while (value >= 1024 && unit < units.length - 1)
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: digits })} ${units[unit]}`
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`
}
