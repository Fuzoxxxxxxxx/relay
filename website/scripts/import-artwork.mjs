/**
 * Prépare les images des jeux pour le site (copie locale, sans dépendre du navigateur du visiteur).
 *
 *   node website/scripts/import-artwork.mjs          → jeux présents dans le site
 *   node website/scripts/import-artwork.mjs --all    → toute votre bibliothèque (aussi dans le mur et le ruban)
 *
 * 1. Copie les images déjà téléchargées par Relay (base %APPDATA%\nexora\relay.sqlite + son dossier d'images).
 * 2. Pour les jeux hors Steam du site (VALORANT, Fortnite, Rocket League, League of Legends...) qui n'ont toujours
 *    pas d'image, les télécharge depuis les mêmes sources que l'application (egdata pour Epic, visuels officiels Riot).
 * 3. Génère website/assets/games/manifest.js, chargé automatiquement par le site.
 */
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const siteDir = path.resolve(here, '..')
const projectRoot = path.resolve(siteDir, '..')
const outDir = path.join(siteDir, 'assets', 'games')
const includeAll = process.argv.includes('--all')
const userData = path.join(process.env.APPDATA ?? '', 'nexora')

const slug = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '')
const exists = (file) => access(file).then(() => true, () => false)

const coverTypes = ['DieselGameBoxTall', 'OfferImageTall', 'DieselStoreFrontTall', 'Thumbnail']
const heroTypes = ['DieselGameBox', 'DieselStoreFrontWide', 'OfferImageWide', 'featuredMedia']

/* ---------- Catalogue du site (lu dans script.js) ---------- */

const siteScript = await readFile(path.join(siteDir, 'script.js'), 'utf8')
const titles = new Map() // clé → titre
const remoteGames = [] // jeux hors Steam à télécharger
for (const line of siteScript.split('\n')) {
  const title = line.match(/title: '([^']+)'/)?.[1]
  if (!title) continue
  titles.set(slug(title), title)
  const egdata = line.match(/egdata: '([^']+)'/)?.[1]
  const riot = line.match(/riot: '([^']+)'/)?.[1]
  if (egdata || riot) remoteGames.push({ key: slug(title), title, egdata, riot })
}

await mkdir(outDir, { recursive: true })
const coverFile = (key) => path.join(outDir, `${key}.jpg`)
const heroFile = (key) => path.join(outDir, `${key}-hero.jpg`)

/* ---------- 1. Images déjà téléchargées par Relay ---------- */

async function importFromRelay() {
  let bytes = null
  for (const name of ['relay.sqlite', 'nexora.sqlite']) {
    try {
      bytes = await readFile(path.join(userData, name))
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (!bytes) {
    console.log(`(Base Relay introuvable dans ${userData} : étape 1 ignorée.)`)
    return
  }
  const { default: initSqlJs } = await import('sql.js')
  const SQL = await initSqlJs({ locateFile: (file) => path.join(projectRoot, 'node_modules', 'sql.js', 'dist', file) })
  const db = new SQL.Database(bytes)
  const query = (sql) => {
    const statement = db.prepare(sql)
    const rows = []
    while (statement.step()) rows.push(statement.getAsObject())
    statement.free()
    return rows
  }

  const configured = query("SELECT value FROM preferences WHERE key = 'cacheDirectory'")[0]?.value
  const cacheDirectory = configured && path.isAbsolute(configured) ? configured : path.join(userData, 'artwork')
  console.log(`Dossier d'images de Relay : ${cacheDirectory}`)

  const games = query(`
    SELECT COALESCE(NULLIF(TRIM(g.custom_title), ''), g.title) AS title, pg.platform AS platform, pg.external_id AS externalId
    FROM games g JOIN platform_games pg ON pg.game_id = g.id
    WHERE NOT (pg.platform = 'steam' AND pg.external_id = '228980')
  `)
  let copied = 0
  for (const game of games) {
    const key = slug(game.title)
    if (!key || (!includeAll && !titles.has(key))) continue
    titles.set(key, titles.get(key) ?? game.title)
    for (const kind of ['cover', 'hero']) {
      const base = `${game.platform}-${game.externalId}-${kind}`
      const candidates = [`${base}-custom.jpg`, `${base}-v3.jpg`].map((name) => path.join(cacheDirectory, name))
      const found = (await Promise.all(candidates.map(async (file) => ((await exists(file)) ? file : null)))).find(Boolean)
      if (!found) continue
      await copyFile(found, kind === 'cover' ? coverFile(key) : heroFile(key))
      copied += 1
    }
  }
  console.log(`Étape 1 : ${copied} image(s) copiée(s) depuis Relay (${games.length} jeu(x) dans la bibliothèque).`)
}

/* ---------- 2. Téléchargement pour les jeux hors Steam ---------- */

async function download(url, file) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) return `HTTP ${response.status}`
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!type.startsWith('image/')) return `type inattendu (${type || 'inconnu'})`
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > 8 * 1024 * 1024) return 'image trop lourde'
    await writeFile(file, bytes)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'échec'
  }
}

async function egdataImages(title) {
  const response = await fetch(`https://api.egdata.app/autocomplete?query=${encodeURIComponent(title)}&limit=10`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Relay (site vitrine)' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`egdata HTTP ${response.status}`)
  const payload = await response.json()
  const offers = (Array.isArray(payload?.elements) ? payload.elements : []).filter((offer) => offer.offerType === 'BASE_GAME')
  const offer = offers.find((entry) => normalize(entry.title) === normalize(title))
  if (!offer) throw new Error(`aucune offre « ${title} » trouvée dans egdata`)
  return (offer.keyImages ?? []).filter((image) => typeof image?.url === 'string' && /^https:\/\/[^/]*(epicgames|unrealengine)\.com\//.test(image.url))
}

async function downloadMissing() {
  for (const game of remoteGames) {
    const needCover = !(await exists(coverFile(game.key)))
    const needHero = !(await exists(heroFile(game.key)))
    if (!needCover && !needHero) continue
    let images = []
    let problem = null
    if (game.egdata) {
      try {
        images = await egdataImages(game.egdata)
      } catch (error) {
        problem = error instanceof Error ? error.message : 'échec egdata'
      }
    }
    const pick = (types) => types.map((type) => images.find((image) => image.type === type)?.url).find(Boolean)
    const targets = [
      needCover && { label: 'jaquette', file: coverFile(game.key), url: pick(coverTypes) ?? game.riot ?? pick(heroTypes) },
      needHero && { label: 'bannière', file: heroFile(game.key), url: pick(heroTypes) ?? game.riot ?? pick(coverTypes) },
    ].filter(Boolean)
    for (const target of targets) {
      if (!target.url) {
        console.log(`  ✗ ${game.title} (${target.label}) : ${problem ?? 'aucune image trouvée'}`)
        continue
      }
      const failure = await download(target.url, target.file)
      console.log(failure ? `  ✗ ${game.title} (${target.label}) : ${failure}` : `  ✓ ${game.title} (${target.label})`)
    }
  }
}

console.log('Étape 1 : images de Relay…')
try {
  await importFromRelay()
} catch (error) {
  console.log(`Étape 1 ignorée : ${error instanceof Error ? error.message : error}`)
}
console.log('Étape 2 : téléchargement des jeux hors Steam…')
await downloadMissing()

/* ---------- 3. Manifeste ---------- */

const manifest = {}
for (const [key, title] of titles) {
  const cover = await exists(coverFile(key))
  const hero = await exists(heroFile(key))
  if (cover || hero) manifest[key] = { title, ...(cover && { cover: true }), ...(hero && { hero: true }) }
}
await writeFile(
  path.join(outDir, 'manifest.js'),
  `/* Généré par scripts/import-artwork.mjs — ne pas modifier à la main. */\nwindow.RELAY_ARTWORK = ${JSON.stringify(manifest, null, 2)}\nwindow.RELAY_ARTWORK_ALL = ${includeAll}\n`,
)
console.log(`\nTerminé : ${Object.keys(manifest).length} jeu(x) avec images locales → ${outDir}`)
const stillMissing = remoteGames.filter((game) => !manifest[game.key]?.cover).map((game) => game.title)
if (stillMissing.length) console.log(`Sans image : ${stillMissing.join(', ')}`)
