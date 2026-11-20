import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EgDataClient } from '../platforms/egdata/adapter'
import { IgdbClient } from '../platforms/igdb/adapter'
import { GameArtworkService } from './artwork'
import { GameMetadataService } from './metadata'
import { clearSteamStoreCache } from './steamStore'

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9])
const imageResponse = () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } })
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const notFound = () => new Response('', { status: 404 })

let directory: string

function createService(epicNamespace?: (appId: string) => Promise<string | null>) {
  const metadata = new GameMetadataService(async () => directory, {
    igdb: new IgdbClient(async () => null),
    egdata: new EgDataClient(),
    epicNamespace,
  })
  return new GameArtworkService(async () => directory, { metadata })
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'nexora-artwork-'))
  clearSteamStoreCache()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})

describe('GameArtworkService', () => {
  it('télécharge le visuel bibliothèque officiel d’un jeu Steam puis le relit depuis le cache', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('library_600x900') ? imageResponse() : notFound())
    vi.stubGlobal('fetch', fetchMock)
    const service = createService()

    const first = await service.get('steam', '730', 'Counter-Strike 2', 'cover')
    const second = await service.get('steam', '730', 'Counter-Strike 2', 'cover')

    expect(first).toMatch(/^data:image\/jpeg;base64,/)
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('supprime les images des anciennes versions, potentiellement erronées', async () => {
    const legacy = path.join(directory, 'local-' + 'a'.repeat(64) + '-cover.jpg')
    await writeFile(legacy, jpeg)
    vi.stubGlobal('fetch', vi.fn(async () => notFound()))

    await createService().get('steam', '10', 'Counter-Strike', 'cover')

    expect(await readdir(directory)).not.toContain(path.basename(legacy))
  })

  it('utilise egdata et le namespace du manifeste pour un jeu Epic, sans deviner par titre', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://api.egdata.app/sandboxes/ns-test/offers')) {
        return jsonResponse({
          elements: [{
            id: 'offer1',
            namespace: 'ns-test',
            title: 'Test Game',
            description: 'Un jeu de test.',
            offerType: 'BASE_GAME',
            keyImages: [{ type: 'DieselGameBoxTall', url: 'https://cdn1.epicgames.com/offer/cover.jpg' }],
          }],
        })
      }
      return url === 'https://cdn1.epicgames.com/offer/cover.jpg' ? imageResponse() : notFound()
    })
    vi.stubGlobal('fetch', fetchMock)

    const url = await createService(async () => 'ns-test').get('epic', 'TestGameApp', 'Test Game', 'cover')

    expect(url).toMatch(/^data:image\/jpeg;base64,/)
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain('https://cdn1.epicgames.com/offer/cover.jpg')
  })

  it('ne télécharge rien quand aucune correspondance fiable n’existe et ne réinterroge pas pendant 10 minutes', async () => {
    const fetchMock = vi.fn(async () => notFound())
    vi.stubGlobal('fetch', fetchMock)
    const service = createService()

    expect(await service.get('local', 'b'.repeat(64), 'Jeu Inconnu 123', 'cover')).toBeNull()
    const calls = fetchMock.mock.calls.length
    expect(await service.get('local', 'b'.repeat(64), 'Jeu Inconnu 123', 'cover')).toBeNull()
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('priorise une image personnalisée sur toute source automatique', async () => {
    const fetchMock = vi.fn(async () => notFound())
    vi.stubGlobal('fetch', fetchMock)
    const source = path.join(directory, 'mine.jpg')
    await writeFile(source, jpeg)
    const service = createService()

    await service.setCustom('steam', '730', 'cover', source)

    expect(await service.get('steam', '730', 'Counter-Strike 2', 'cover')).toMatch(/^data:image\/jpeg;base64,/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuse un fichier qui n’est pas une image', async () => {
    const source = path.join(directory, 'fake.jpg')
    await writeFile(source, 'pas une image')

    await expect(createService().setCustom('steam', '730', 'cover', source)).rejects.toThrow('Format d’image')
  })
})
