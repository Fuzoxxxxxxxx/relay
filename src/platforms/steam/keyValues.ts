export type KeyValuesValue = string | KeyValuesObject
export interface KeyValuesObject {
  [key: string]: KeyValuesValue
}

function tokenize(source: string): string[] {
  const withoutComments = source.replace(/\/\/.*$/gm, '')
  const tokens = withoutComments.match(/"(?:\\.|[^"\\])*"|\{|\}|[^\s{}"]+/g) ?? []
  return tokens.map((token) => {
    if (token.startsWith('"') && token.endsWith('"')) {
      return token.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    return token
  })
}

function parseObject(tokens: string[], startIndex: number): [KeyValuesObject, number] {
  const result: KeyValuesObject = {}
  let index = startIndex

  while (index < tokens.length) {
    const key = tokens[index]
    if (key === '}') return [result, index + 1]
    if (key === undefined || key === '{') throw new Error('Fichier KeyValues Steam mal formé.')

    const value = tokens[index + 1]
    if (value === undefined || value === '}') throw new Error(`Valeur manquante pour "${key}".`)

    if (value === '{') {
      const [nested, nextIndex] = parseObject(tokens, index + 2)
      result[key] = nested
      index = nextIndex
    } else {
      result[key] = value
      index += 2
    }
  }

  return [result, index]
}

export function parseKeyValues(source: string): KeyValuesObject {
  const tokens = tokenize(source)
  const rootKey = tokens[0]
  if (!rootKey || tokens[1] !== '{') throw new Error('Racine KeyValues Steam invalide.')
  const [root, nextIndex] = parseObject(tokens, 2)
  if (nextIndex !== tokens.length) throw new Error('Contenu inattendu après le bloc KeyValues.')
  return { [rootKey]: root }
}

export function getKeyValuesObject(
  parent: KeyValuesObject | undefined,
  name: string,
): KeyValuesObject | undefined {
  const key = Object.keys(parent ?? {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  const value = key === undefined ? undefined : parent?.[key]
  return typeof value === 'object' ? value : undefined
}

export function getKeyValuesString(parent: KeyValuesObject | undefined, name: string): string | undefined {
  const key = Object.keys(parent ?? {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  const value = key === undefined ? undefined : parent?.[key]
  return typeof value === 'string' ? value : undefined
}
