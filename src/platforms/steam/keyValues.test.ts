import { describe, expect, it } from 'vitest'
import { getKeyValuesObject, getKeyValuesString, parseKeyValues } from './keyValues'
import { parseSteamLibraryFolders, parseSteamManifest } from './manifest'

describe('Steam KeyValues parser', () => {
  it('parses nested library data and quoted Windows paths', () => {
    const parsed = parseKeyValues(`
      "libraryfolders"
      {
        "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" "apps" { "10" "2" } }
        "1" { "path" "D:\\\\SteamLibrary" }
      }
    `)
    const root = getKeyValuesObject(parsed, 'LIBRARYFOLDERS')
    const secondary = getKeyValuesObject(root, '1')

    expect(getKeyValuesString(secondary, 'path')).toBe('D:\\SteamLibrary')
  })

  it('handles manifest fields without coercing identifier strings', () => {
    const parsed = parseKeyValues(`
      "AppState"
      {
        "appid" "570"
        "name" "Dota 2"
        "installdir" "dota 2"
      }
    `)
    const appState = getKeyValuesObject(parsed, 'appstate')

    expect(getKeyValuesString(appState, 'appid')).toBe('570')
    expect(getKeyValuesString(appState, 'name')).toBe('Dota 2')
    expect(getKeyValuesString(appState, 'installdir')).toBe('dota 2')
  })

  it('rejects incomplete and malformed KeyValues data', () => {
    expect(() => parseKeyValues('"root" { "key" }')).toThrow('Valeur manquante')
    expect(() => parseKeyValues('not a root')).toThrow('Racine KeyValues Steam invalide')
  })

  it('reads multi-library paths and validated app manifests', () => {
    const libraries = parseSteamLibraryFolders(`
      "libraryfolders"
      {
        "0" { "path" "C:\\\\Steam" }
        "1" { "path" "D:\\\\Games\\\\SteamLibrary" }
      }
    `, 'C:\\Steam')
    const game = parseSteamManifest(`
      "AppState"
      {
        "appid" "570"
        "name" "Dota 2"
        "installdir" "dota 2"
      }
    `, 'D:\\Games\\SteamLibrary')

    expect(libraries).toContain('D:\\Games\\SteamLibrary')
    expect(game).toEqual({
      appId: '570',
      title: 'Dota 2',
      installPath: 'D:\\Games\\SteamLibrary\\steamapps\\common\\dota 2',
    })
    expect(parseSteamManifest('"AppState" { "appid" "not-an-id" }', 'C:\\Steam')).toBeNull()
  })
})
