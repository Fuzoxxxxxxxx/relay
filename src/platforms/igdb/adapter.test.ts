import { afterEach, describe, expect, it, vi } from 'vitest'
import { IgdbClient, parseIgdbGame } from './adapter'

const credentials = { clientId: 'client', clientSecret: 'secret' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

describe('parseIgdbGame', () => {
  it('extrait noms, entreprises, genres et identifiants d’images', () => {
    const game = parseIgdbGame({
      id: 7,
      name: 'Hades',
      alternative_names: [{ name: 'Hades (2020)' }],
      summary: 'Un rogue-like.',
      genres: [{ name: 'Indie' }],
      involved_companies: [
        { developer: true, publisher: false, company: { name: 'Supergiant Games' } },
        { developer: false, publisher: true, company: { name: 'Private Division' } },
      ],
      cover: { image_id: 'co1abc' },
      artworks: [{ image_id: 'ar2def' }],
      total_rating_count: 120,
    })

    expect(game).toMatchObject({
      id: 7,
      name: 'Hades',
      altNames: ['Hades (2020)'],
      developers: ['Supergiant Games'],
      publishers: ['Private Division'],
      genres: ['Indie'],
      coverId: 'co1abc',
      artworkIds: ['ar2def'],
      isDlcOrEdition: false,
    })
  })

  it('marque les DLC et éditions, et ignore les identifiants d’image suspects', () => {
    const game = parseIgdbGame({ id: 1, name: 'X', parent_game: 5, cover: { image_id: '../evil' } })

    expect(game?.isDlcOrEdition).toBe(true)
    expect(game?.coverId).toBeNull()
  })
})

describe('IgdbClient', () => {
  it('n’interroge rien sans identifiants configurés', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await new IgdbClient(async () => null).search('Hades')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('signale des identifiants refusés sans mettre l’échec en cache', async () => {
    const fetchMock = vi.fn(async () => json({}, 401))
    vi.stubGlobal('fetch', fetchMock)
    const client = new IgdbClient(async () => credentials)

    await expect(client.search('Hades')).rejects.toThrow('authentification refusée (HTTP 401)')
    await expect(client.search('Hades')).rejects.toThrow('authentification refusée (HTTP 401)')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retrouve un jeu par son identifiant Steam, avec repli sur l’ancien schéma external_games', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('oauth2/token')) return json({ access_token: 'token', expires_in: 3600 })
      const body = String(init?.body)
      bodies.push(body)
      if (url.endsWith('/external_games')) {
        return body.includes('external_game_source') ? json({}, 400) : json([{ uid: '1145360', game: 7 }])
      }
      return json([{ id: 7, name: 'Hades' }])
    }))

    const game = await new IgdbClient(async () => credentials).findBySteamAppId('1145360')

    expect(game?.name).toBe('Hades')
    expect(bodies.some((body) => body.includes('category = 1'))).toBe(true)
  })
})
