import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectGameExecutable, localGameId, validateGameExecutable } from './adapter'

let temporaryDirectory = ''

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = ''
})

async function createTemporaryDirectory(): Promise<string> {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'relay-local-game-'))
  return temporaryDirectory
}

describe('local game executables', () => {
  it('gets the game title and folder from the selected executable', async () => {
    const root = await createTemporaryDirectory()
    const gameFolder = path.join(root, 'Game Folder')
    const executablePath = path.join(gameFolder, 'MyGame.exe')
    await mkdir(gameFolder)
    await writeFile(executablePath, '')

    await expect(inspectGameExecutable(executablePath)).resolves.toEqual({
      folderPath: gameFolder,
      title: 'MyGame',
      executablePath,
    })
  })

  it('rejects files that are not .exe executables', async () => {
    const root = await createTemporaryDirectory()
    const filePath = path.join(root, 'game.txt')
    await writeFile(filePath, '')

    await expect(inspectGameExecutable(filePath)).rejects.toThrow('Choisissez ou déposez un fichier .exe.')
  })

  it('rejects a directory named with an .exe extension', async () => {
    const root = await createTemporaryDirectory()
    const directoryPath = path.join(root, 'not-a-game.exe')
    await mkdir(directoryPath)

    await expect(inspectGameExecutable(directoryPath)).rejects.toThrow('Le fichier .exe du jeu est introuvable.')
  })

  it('keeps executable IDs stable and distinguishes executables in one folder', async () => {
    const root = await createTemporaryDirectory()
    const firstExecutable = path.join(root, 'first.exe')
    const secondExecutable = path.join(root, 'second.exe')
    expect(localGameId(firstExecutable)).toBe(localGameId(firstExecutable))
    expect(localGameId(firstExecutable)).toMatch(/^[a-f0-9]{64}$/)
    expect(localGameId(firstExecutable)).not.toBe(localGameId(secondExecutable))
  })

  it('rejects a launch executable outside the selected game folder', async () => {
    const root = await createTemporaryDirectory()
    const gameFolder = path.join(root, 'Game')
    const outsideExecutable = path.join(root, 'outside.exe')
    await mkdir(gameFolder)
    await writeFile(outsideExecutable, '')

    await expect(validateGameExecutable(gameFolder, outsideExecutable))
      .rejects.toThrow('Le programme choisi doit se trouver dans le dossier du jeu.')
  })
})
