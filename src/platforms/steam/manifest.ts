import path from 'node:path'
import { getKeyValuesObject, getKeyValuesString, parseKeyValues } from './keyValues'

export interface SteamInstalledGame {
  appId: string
  title: string
  installPath: string
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

export function parseSteamLibraryFolders(contents: string, mainRoot: string): string[] {
  const parsed = parseKeyValues(contents)
  const rootObject = getKeyValuesObject(parsed, 'libraryfolders')
  const paths = new Set<string>([path.resolve(mainRoot)])

  for (const value of Object.values(rootObject ?? {})) {
    const library = asObject(value)
    const libraryPath = typeof value === 'string'
      ? value
      : Object.entries(library ?? {}).find(([key]) => key.toLowerCase() === 'path')?.[1]
    if (typeof libraryPath === 'string' && libraryPath.trim()) {
      paths.add(path.resolve(libraryPath))
    }
  }
  return [...paths]
}

export function parseSteamManifest(contents: string, libraryRoot: string): SteamInstalledGame | null {
  const parsed = parseKeyValues(contents)
  const state = getKeyValuesObject(parsed, 'appstate')
  const appId = getKeyValuesString(state, 'appid')
  const title = getKeyValuesString(state, 'name')
  const installDir = getKeyValuesString(state, 'installdir')
  if (!appId || !/^\d+$/.test(appId) || !title?.trim() || !installDir?.trim()) return null
  return {
    appId,
    title: title.trim(),
    installPath: path.join(libraryRoot, 'steamapps', 'common', installDir),
  }
}
