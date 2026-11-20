import { describe, expect, it } from 'vitest'
import type { IgdbGameInfo } from '../platforms/igdb/adapter'
import { canonicalTitle, normalizeTitle, pickIgdbMatch, searchTerms } from './metadata'
import { htmlToText, limitText } from './steamStore'

function game(overrides: Partial<IgdbGameInfo>): IgdbGameInfo {
  return {
    id: 1,
    name: 'Jeu',
    altNames: [],
    summary: null,
    storyline: null,
    genres: [],
    developers: [],
    publishers: [],
    firstRelease: null,
    isDlcOrEdition: false,
    popularity: 0,
    coverId: null,
    artworkIds: [],
    screenshotIds: [],
    ...overrides,
  }
}

describe('titres', () => {
  it('normalise accents, ponctuation et casse', () => {
    expect(normalizeTitle('Pokémon: Légendes — Arceus™')).toBe('pokemon legendes arceus')
  })

  it('ignore l’article initial et les suffixes d’édition', () => {
    expect(canonicalTitle('The Witcher 3: Wild Hunt - Game of the Year Edition')).toBe('witcher 3 wild hunt')
    expect(canonicalTitle('Hades Deluxe Edition')).toBe('hades')
  })

  it('retire les suffixes techniques d’un exécutable', () => {
    expect(searchTerms('Hades-Win64-Shipping')).toEqual(['Hades-Win64-Shipping', 'Hades'])
  })
})

describe('pickIgdbMatch', () => {
  it('refuse les titres simplement proches', () => {
    const results = [game({ id: 1, name: 'Among Us 2' }), game({ id: 2, name: 'Among Us: Impostor Edition' })]

    expect(pickIgdbMatch(results, 'Among Us')).toBeNull()
  })

  it('préfère le jeu principal populaire à un DLC portant le même nom', () => {
    const results = [
      game({ id: 1, name: 'Hades', isDlcOrEdition: true, popularity: 900 }),
      game({ id: 2, name: 'Hades', popularity: 50 }),
    ]

    expect(pickIgdbMatch(results, 'Hades')?.id).toBe(2)
  })

  it('accepte un nom alternatif identique', () => {
    expect(pickIgdbMatch([game({ id: 3, name: 'Counter-Strike 2', altNames: ['CS2'] })], 'CS2')?.id).toBe(3)
  })
})

describe('descriptions Steam', () => {
  it('convertit le HTML en texte en conservant les paragraphes', () => {
    const text = htmlToText('<p>Premier &amp; second.</p><ul><li>Un</li><li>Deux</li></ul><img src="x.png"><br>Fin')

    expect(text).toBe('Premier & second.\n• Un\n• Deux\n\nFin')
  })

  it('coupe proprement à la fin d’un paragraphe', () => {
    const long = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`

    expect(limitText(long, 100)).toBe(`${'a'.repeat(60)}\n\n…`)
  })
})
