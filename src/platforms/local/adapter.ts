import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

export function localGameId(executablePath: string): string {
  const normalizedPath = path.resolve(executablePath).toLocaleLowerCase('en')
  return createHash('sha256').update(normalizedPath).digest('hex')
}

export async function inspectGameExecutable(executablePath: string): Promise<{ folderPath: string; title: string; executablePath: string }> {
  if (path.extname(executablePath).toLocaleLowerCase('en') !== '.exe') {
    throw new Error('Choisissez ou déposez un fichier .exe.')
  }
  const resolvedExecutable = await realpath(executablePath)
  const executableStat = await stat(resolvedExecutable)
  if (!executableStat.isFile()) throw new Error('Le fichier .exe du jeu est introuvable.')
  const title = path.basename(resolvedExecutable, path.extname(resolvedExecutable))
  if (!title || title.length > 200) throw new Error('Le nom du jeu est invalide.')
  return {
    folderPath: path.dirname(resolvedExecutable),
    title,
    executablePath: resolvedExecutable,
  }
}

export async function validateGameExecutable(folderPath: string, executablePath: string): Promise<string> {
  const root = await realpath(folderPath)
  const executable = await realpath(executablePath)
  const relativePath = path.relative(root, executable)
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) {
    throw new Error('Le programme choisi doit se trouver dans le dossier du jeu.')
  }
  if (path.extname(executable).toLocaleLowerCase('en') !== '.exe') {
    throw new Error('Choisissez un fichier .exe du jeu.')
  }
  const executableStat = await stat(executable)
  if (!executableStat.isFile()) throw new Error('Le programme choisi est introuvable.')
  return executable
}
