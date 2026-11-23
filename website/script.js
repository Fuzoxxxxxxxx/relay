/* ==========================================================================
   Relay — site vitrine
   1. Lien de téléchargement (dernière release GitHub)
   2. Images de jeux (mur, ruban, jaquettes) et captures de l'application
   3. Effets de page
   ========================================================================== */

/* ---------- 1. Téléchargement ---------- */

const owner = 'Fuzoxxxxxxxx'
const repository = 'relay'
const apiUrl = `https://api.github.com/repos/${owner}/${repository}/releases?per_page=10`
const installerCacheKey = 'relay.last-valid-installer'
const fallbackInstallerUrl = `https://github.com/${owner}/${repository}/releases/download/v0.1.1/Relay-Setup-0.1.1.exe`

function getLastValidInstallerUrl() {
  try {
    const cachedUrl = localStorage.getItem(installerCacheKey)
    if (cachedUrl) {
      const parsedUrl = new URL(cachedUrl)
      const fileName = parsedUrl.pathname.split('/').pop() ?? ''
      if (
        parsedUrl.origin === 'https://github.com'
        && parsedUrl.pathname.startsWith(`/${owner}/${repository}/releases/download/`)
        && /^Relay-Setup-.*\.exe$/i.test(fileName)
      ) return cachedUrl
    }
  } catch (error) {
    console.warn('Impossible de lire le dernier installateur mémorisé :', error)
  }
  return fallbackInstallerUrl
}

const primaryLink = document.querySelector('#download-link')
const secondaryLink = document.querySelector('#download-link-bottom')
const primaryLabel = document.querySelector('#download-label')
const secondaryLabel = document.querySelector('#download-label-bottom')
const status = document.querySelector('#download-status')
const releaseMeta = document.querySelector('#release-meta')

function setDownload(assetUrl, label, details) {
  try {
    localStorage.setItem(installerCacheKey, assetUrl)
  } catch (error) {
    console.warn('Impossible de mémoriser le dernier installateur Relay :', error)
  }
  for (const link of [primaryLink, secondaryLink]) {
    if (!link) continue
    link.href = assetUrl
    link.classList.remove('is-disabled')
    link.removeAttribute('aria-disabled')
  }
  if (primaryLabel) primaryLabel.textContent = label
  if (secondaryLabel) secondaryLabel.textContent = label
  if (status) status.textContent = details
  if (releaseMeta) releaseMeta.textContent = details
}

setDownload(getLastValidInstallerUrl(), 'Télécharger pour Windows', 'Téléchargement disponible · vérification de la version…')

async function loadReleases() {
  try {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 10000)
    let response
    try {
      response = await fetch(apiUrl, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
      })
    } finally {
      window.clearTimeout(timeout)
    }
    if (response.status === 404) {
      status.textContent = 'La dernière version est introuvable pour le moment. Le lien de téléchargement précédent reste disponible.'
      renderAssets([])
      renderNews([])
      return
    }
    if (!response.ok) throw new Error(`GitHub API: ${response.status}`)

    const releases = await response.json()
    if (!Array.isArray(releases)) throw new Error('GitHub API: réponse de releases invalide')
    renderNews(releases.slice(0, 4))

    const release = releases.find((item) => !item.draft && !item.prerelease)
    if (!release) {
      status.textContent = 'Aucune version stable n’est disponible. Le lien de téléchargement précédent reste disponible.'
      renderAssets([])
      return
    }

    const assets = Array.isArray(release.assets) ? release.assets : []
    renderAssets(assets)
    const installer = assets.find((asset) => /^Relay-Setup-.*\.exe$/i.test(asset.name))
      ?? assets.find((asset) => /\.exe$/i.test(asset.name))
    if (!installer?.browser_download_url) {
      status.textContent = `La version ${release.tag_name} n’a pas encore d’installateur. Le lien précédent reste disponible.`
      releaseMeta.textContent = 'Version précédente conservée'
      return
    }

    const date = release.published_at
      ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(release.published_at))
      : 'dernière version'
    setDownload(installer.browser_download_url, 'Télécharger pour Windows', `Version ${release.tag_name} · publiée le ${date}`)
  } catch (error) {
    console.error('Impossible de récupérer la dernière release Relay :', error)
    if (status) status.textContent = 'Impossible de vérifier la dernière version. Le lien de téléchargement précédent reste disponible.'
    renderAssets(null)
    renderNewsError()
  }
}

if (primaryLink && status) loadReleases()

/* Liste des fichiers de la dernière version */
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const formatSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`)
const longDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' })
const RELEASES_URL = `https://github.com/${owner}/${repository}/releases`

function renderAssets(assets) {
  const list = document.querySelector('#asset-list')
  if (!list) return
  if (assets === null) {
    list.innerHTML = `<div class="asset-empty">Liste indisponible. Consultez les <a href="${RELEASES_URL}" target="_blank" rel="noreferrer">releases GitHub</a>.</div>`
    return
  }
  const files = assets.filter((asset) => !/\.(blockmap|ya?ml)$/i.test(asset.name))
  if (!files.length) {
    list.innerHTML = '<div class="asset-empty">Aucun fichier à télécharger pour le moment.</div>'
    return
  }
  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>'
  const title = (name) => (/setup|install/i.test(name) ? 'Installateur Windows (recommandé)' : /portable/i.test(name) ? 'Version portable' : 'Fichier de la version')
  list.innerHTML = files.map((asset) => `<div class="asset"><span class="asset-icon">${icon}</span>
    <div class="asset-info"><strong>${escapeHtml(title(asset.name))}</strong><span>${escapeHtml(asset.name)} · ${formatSize(asset.size)}</span></div>
    <a class="button button-small" href="${escapeHtml(asset.browser_download_url)}">Télécharger</a></div>`).join('')
}

/* Nouveautés : notes des dernières releases (Markdown minimal et sûr) */
function mdInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
}

function mdBlocks(source) {
  let html = ''
  let inList = false
  let paragraph = []
  const flush = () => {
    if (paragraph.length) html += `<p>${mdInline(paragraph.join(' '))}</p>`
    paragraph = []
  }
  const closeList = () => {
    if (inList) html += '</ul>'
    inList = false
  }
  for (const raw of String(source).replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    const item = line.match(/^\s*[-*+]\s+(.*)$/)
    if (heading) {
      flush(); closeList()
      const level = Math.min(heading[1].length + 2, 5)
      html += `<h${level}>${mdInline(heading[2])}</h${level}>`
    } else if (item) {
      flush()
      if (!inList) { html += '<ul>'; inList = true }
      html += `<li>${mdInline(item[1])}</li>`
    } else if (!line.trim()) {
      flush(); closeList()
    } else {
      closeList()
      paragraph.push(line.trim())
    }
  }
  flush(); closeList()
  return html
}

function renderNews(releases) {
  const container = document.querySelector('#news-list')
  if (!container) return
  if (!releases.length) {
    container.innerHTML = '<div class="news-state"><strong>Aucune version publiée pour l’instant</strong>Les notes de chaque version apparaîtront ici dès la première release.</div>'
    return
  }

  const [latest, ...older] = releases
  const dateOf = (release) => (release.published_at ? longDate.format(new Date(release.published_at)) : '')
  const titleOf = (release) => (release.name && release.name !== release.tag_name ? release.name : `Version ${release.tag_name}`)
  const body = latest.body?.trim() ? mdBlocks(latest.body) : '<p>Aucune note de version n’a été fournie pour cette release.</p>'

  container.innerHTML = `<article class="news-latest">
      <div class="news-meta">
        <span class="news-tag">${escapeHtml(latest.tag_name)}</span>
        ${dateOf(latest) ? `<time datetime="${escapeHtml(latest.published_at)}">${dateOf(latest)}</time>` : ''}
        ${latest.prerelease ? '<span class="news-badge pre">Pré-version</span>' : '<span class="news-badge">Dernière version</span>'}
      </div>
      <h3>${escapeHtml(titleOf(latest))}</h3>
      <div class="news-body">${body}</div>
      <a class="news-link" href="${escapeHtml(latest.html_url)}" target="_blank" rel="noreferrer">Notes complètes sur GitHub ↗</a>
    </article>
    ${older.slice(0, 3).map((release) => `<a class="news-row" href="${escapeHtml(release.html_url)}" target="_blank" rel="noreferrer">
      <span class="news-tag">${escapeHtml(release.tag_name)}</span><strong>${escapeHtml(titleOf(release))}</strong><time>${dateOf(release)}</time></a>`).join('')}
    <p class="news-all"><a class="news-link" href="${RELEASES_URL}" target="_blank" rel="noreferrer">Tout l’historique sur GitHub ↗</a></p>`

  const bodyElement = container.querySelector('.news-body')
  if (bodyElement && bodyElement.scrollHeight > bodyElement.clientHeight + 4) bodyElement.classList.add('is-clamped')
}

function renderNewsError() {
  const container = document.querySelector('#news-list')
  if (!container) return
  container.innerHTML = `<div class="news-state"><strong>Nouveautés momentanément indisponibles</strong>Consultez directement les <a href="${RELEASES_URL}" target="_blank" rel="noreferrer">releases GitHub</a>.</div>`
}

/* ---------- 2. Images de jeux ----------
   Les jaquettes viennent du CDN public de Steam (comme dans l'application), avec un
   dégradé de secours si l'image ne charge pas.
   Les images exportées depuis Relay (scripts/import-artwork.mjs → assets/games/manifest.js)
   sont utilisées en priorité ; sinon Steam, les sources de l'app, puis un dégradé. */

const ART = window.RELAY_ARTWORK || {}
const slug = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'
const FILES = { cover: 'library_600x900.jpg', hero: 'library_hero.jpg', wide: 'header.jpg', capsule: 'capsule_616x353.jpg', bg: 'page_bg_generated_v6b.jpg' }

const CAT = {
  cs2: { title: 'Counter-Strike 2', steam: 730, hue: 28 },
  cyberpunk: { title: 'Cyberpunk 2077', steam: 1091500, hue: 55 },
  elden: { title: 'Elden Ring', steam: 1245620, hue: 75 },
  bg3: { title: 'Baldur’s Gate 3', steam: 1086940, hue: 300 },
  hades: { title: 'Hades', steam: 1145360, hue: 8 },
  hollow: { title: 'Hollow Knight', steam: 367520, hue: 168 },
  dota2: { title: 'Dota 2', steam: 570, hue: 355 },
  stardew: { title: 'Stardew Valley', steam: 413150, hue: 120 },
  terraria: { title: 'Terraria', steam: 105600, hue: 140 },
  portal2: { title: 'Portal 2', steam: 620, hue: 200 },
  rdr2: { title: 'Red Dead Redemption 2', steam: 1174180, hue: 20 },
  witcher3: { title: 'The Witcher 3', steam: 292030, hue: 40 },
  apex: { title: 'Apex Legends', steam: 1172470, hue: 10 },
  rust: { title: 'Rust', steam: 252490, hue: 25 },
  helldivers: { title: 'Helldivers 2', steam: 553850, hue: 60 },
  palworld: { title: 'Palworld', steam: 1623730, hue: 190 },
  lethal: { title: 'Lethal Company', steam: 1966720, hue: 90 },
  balatro: { title: 'Balatro', steam: 2379780, hue: 330 },
  wukong: { title: 'Black Myth: Wukong', steam: 2358720, hue: 35 },
  sekiro: { title: 'Sekiro', steam: 814380, hue: 350 },
  celeste: { title: 'Celeste', steam: 504230, hue: 280 },
  dave: { title: 'Dave the Diver', steam: 1868140, hue: 205 },
  vampire: { title: 'Vampire Survivors', steam: 1794680, hue: 310 },
  hades2: { title: 'Hades II', steam: 1145350, hue: 15 },
  gta5: { title: 'Grand Theft Auto V', steam: 271590, hue: 25 },
  r6: { title: 'Rainbow Six Siege', steam: 359550, hue: 215 },
  overwatch: { title: 'Overwatch 2', steam: 2357570, hue: 30 },
  fallguys: { title: 'Fall Guys', steam: 1097150, hue: 320 },
  silksong: { title: 'Hollow Knight: Silksong', steam: 1030300, hue: 350 },
  clair: { title: 'Clair Obscur: Expedition 33', steam: 1903340, hue: 45 },
  splitfiction: { title: 'Split Fiction', steam: 2001120, hue: 170 },
  /* Jeux hors Steam : images résolues comme dans l'application (visuel Riot officiel, egdata pour Epic). */
  valorant: { title: 'VALORANT', cover: 'VALORANT', hue: 350, egdata: 'VALORANT' },
  lol: { title: 'League of Legends', cover: 'LEAGUE|OF|LEGENDS', hue: 215, riot: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/news/565197caf987af4e4da307df6e2b235a28714736-837x469.jpg?accountingTag=LoL&w=1200&h=630&fm=jpg&fit=crop&crop=center' },
  '2xko': { title: '2XKO', cover: '2XKO', hue: 280, riot: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/0d8da14d9cc0c69376e8fb42cc6344276bf937ad-1200x600.jpg?accountingTag=2XKO&w=1200&h=630&fm=jpg&fit=crop&crop=center' },
  fortnite: { title: 'Fortnite', hue: 255, egdata: 'Fortnite' },
  rocketleague: { title: 'Rocket League', cover: 'ROCKET|LEAGUE', hue: 188, steam: 252950, egdata: 'Rocket League' },
  genshin: { title: 'Genshin Impact', cover: 'GENSHIN|IMPACT', hue: 200, egdata: 'Genshin Impact' },
}

function localFile(id, kind) {
  const game = CAT[id]
  const key = ART[id] ? id : game && ART[slug(game.title)] ? slug(game.title) : null
  if (!key) return null
  if (kind === 'cover') return ART[key].cover ? `./assets/games/${key}.jpg` : null
  return ART[key].hero ? `./assets/games/${key}-hero.jpg` : null
}

/* Avec --all, toute la bibliothèque exportée rejoint aussi le mur et le ruban. */
const extraIds = []
if (window.RELAY_ARTWORK_ALL) {
  const known = new Set(Object.values(CAT).map((game) => slug(game.title)))
  for (const [key, entry] of Object.entries(ART)) {
    if (known.has(key) || CAT[key]) continue
    CAT[key] = { title: entry.title, hue: [...key].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360 }
    extraIds.push(key)
  }
}

const EPIC_TYPES = {
  cover: ['DieselGameBoxTall', 'OfferImageTall', 'DieselStoreFrontTall', 'Thumbnail', 'DieselGameBox', 'DieselStoreFrontWide', 'OfferImageWide'],
  wide: ['DieselGameBox', 'DieselStoreFrontWide', 'OfferImageWide', 'featuredMedia', 'DieselGameBoxTall'],
}
const egCache = new Map()

/* API publique egdata (catalogue Epic), la même source que l'application. Résultat gardé 24 h. */
function egImages(title) {
  if (egCache.has(title)) return egCache.get(title)
  const key = `relay:eg:${title}`
  const request = (async () => {
    try {
      const cached = JSON.parse(localStorage.getItem(key) || 'null')
      if (cached && Date.now() - cached.t < 864e5) return cached.images
    } catch { /* stockage indisponible */ }
    const response = await fetch(`https://api.egdata.app/autocomplete?query=${encodeURIComponent(title)}&limit=10`, { headers: { Accept: 'application/json' } })
    if (!response.ok) return []
    const payload = await response.json()
    const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '')
    const offer = (Array.isArray(payload?.elements) ? payload.elements : [])
      .find((entry) => entry.offerType === 'BASE_GAME' && normalize(entry.title) === normalize(title))
    const images = (offer?.keyImages || [])
      .filter((image) => typeof image?.url === 'string' && /^https:\/\/[^/]*(epicgames|unrealengine)\.com\//.test(image.url))
      .map((image) => ({ type: image.type, url: image.url }))
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), images })) } catch { /* ignoré */ }
    return images
  })().catch(() => [])
  egCache.set(title, request)
  return request
}

async function resolveImage(id, kind) {
  const game = CAT[id]
  if (!game) return null
  if (game.riot) return game.riot
  if (game.egdata) {
    const images = await egImages(game.egdata)
    for (const type of kind === 'cover' ? EPIC_TYPES.cover : EPIC_TYPES.wide) {
      const hit = images.find((image) => image.type === type)
      if (hit) return hit.url
    }
  }
  return null
}

function gameImg(id, kind = 'cover', lazy = true) {
  const game = CAT[id]
  if (!game) return ''
  const local = localFile(id, kind)
  const remote = game.steam ? `${CDN}/${game.steam}/${FILES[kind]}` : null
  const resolvable = Boolean(game.riot || game.egdata)
  const src = local || remote
  if (!src && !resolvable) return ''
  const attributes = [
    src ? `src="${src}"` : '',
    local && remote ? `data-fallback="${remote}"` : '',
    resolvable ? `data-resolve="${id}" data-kind="${kind}"` : '',
    lazy ? 'loading="lazy"' : '',
  ].filter(Boolean).join(' ')
  return `<img class="game-img" ${attributes} alt="" decoding="async" referrerpolicy="no-referrer" />`
}

/* Résout les images des jeux hors Steam (balises sans src). */
function hydrateImages(root) {
  root.querySelectorAll('img.game-img[data-resolve]:not([src])').forEach(async (img) => {
    img.dataset.tried = '1'
    const url = await resolveImage(img.dataset.resolve, img.dataset.kind)
    if (url) img.src = url
    else img.remove()
  })
}

function gameArt(id) {
  const game = CAT[id]
  const lines = (game.cover || game.title.toUpperCase()).split('|').map((line) => `<i>${line}</i>`).join(' ')
  return `<div class="art" style="--hue:${game.hue}"><span class="art-title">${lines}</span></div>`
}

/* Une image qui ne charge pas disparaît : le dégradé placé dessous reste visible. */
document.addEventListener('error', async (event) => {
  const target = event.target
  if (!(target instanceof HTMLImageElement) || !target.classList.contains('game-img')) return
  if (target.dataset.fallback) {
    target.src = target.dataset.fallback
    delete target.dataset.fallback
    return
  }
  if (target.dataset.resolve && !target.dataset.tried) {
    target.dataset.tried = '1'
    const url = await resolveImage(target.dataset.resolve, target.dataset.kind)
    if (url) {
      target.src = url
      return
    }
  }
  target.remove()
}, true)

/* Mur de jaquettes du hero */
;(function renderWall() {
  const wall = document.querySelector('#wall')
  if (!wall) return
  const ids = [...extraIds, 'cs2', 'fortnite', 'cyberpunk', 'elden', 'valorant', 'bg3', 'hades', 'rocketleague', 'hollow', 'gta5', 'dota2', 'overwatch',
    'stardew', 'lol', 'terraria', 'portal2', 'rdr2', 'witcher3', 'apex', 'rust', 'helldivers', 'palworld', 'lethal', 'balatro',
    'wukong', 'sekiro', 'celeste', 'dave', 'vampire', 'hades2', 'r6', 'fallguys', 'genshin', 'silksong', 'clair', 'splitfiction']
  /* Assez de colonnes pour couvrir l'écran, 3 copies par colonne : la boucle (1/3) est exacte, sans saut ni zone vide. */
  const colWidth = window.innerWidth <= 760 ? 130 : 190
  const widest = Math.max(window.innerWidth, window.screen?.width || 0)
  const columns = Math.min(14, Math.ceil((widest * 1.15) / ((colWidth + 16) * 1.2)) + 2)
  const perColumn = 6
  const offsets = [0, -140, -60, -200, -100, -30, -170, -80]
  const tile = (id) => `<div class="wall-card">${gameArt(id).replace(/<span class="art-title">.*?<\/span>/, '')}${gameImg(id, 'cover', false)}</div>`
  let html = ''
  for (let c = 0; c < columns; c += 1) {
    const start = (c * 7) % ids.length
    const set = Array.from({ length: perColumn }, (_, i) => ids[(start + i) % ids.length])
    html += `<div class="wall-col" style="margin-top:${offsets[c % offsets.length]}px">${[...set, ...set, ...set].map(tile).join('')}</div>`
  }
  wall.innerHTML = `<div class="wall-rot">${html}</div><div class="wall-shade"></div>`
})()

/* Ruban horizontal de bannières */
;(function renderStrip() {
  const rows = document.querySelectorAll('[data-strip]')
  if (!rows.length) return
  const sets = [
    [...extraIds, 'fortnite', 'cyberpunk', 'valorant', 'elden', 'cs2', 'rocketleague', 'bg3', 'gta5', 'hades', 'overwatch', 'rdr2', 'witcher3', 'sekiro', 'wukong'],
    ['lol', 'celeste', 'genshin', 'dave', 'stardew', 'apex', 'r6', 'fallguys', 'portal2', 'dota2', 'helldivers', 'palworld', 'silksong', 'clair'],
  ]
  rows.forEach((row) => {
    const ids = sets[Number(row.dataset.strip)] || sets[0]
    const tile = (id) => `<div class="strip-card">${gameArt(id).replace(/<span class="art-title">.*?<\/span>/, '')}${gameImg(id, 'wide', false)}</div>`
    row.innerHTML = [...ids, ...ids].map(tile).join('')
  })
})()

/* Pochettes décoratives : <div data-covers="id,id" data-kind="cover|wide"> */
;(function renderCovers() {
  document.querySelectorAll('[data-covers]').forEach((container) => {
    const wide = container.dataset.kind === 'wide'
    container.innerHTML = container.dataset.covers.split(',').filter((id) => CAT[id]).map((id) =>
      `<span class="poster${wide ? ' wide' : ''}">${gameArt(id)}${gameImg(id, wide ? 'wide' : 'cover')}</span>`).join('')
  })
})()

/* ---------- Captures de l'application ----------
   Chaque <figure data-shot="home|library|game"> reçoit une image fidèle de l'interface
   (mêmes styles que l'application). Si assets/screenshots/<nom>.png existe, la vraie
   capture s'affiche par-dessus (voir <img class="shot-real">). */

;(function renderShots() {
  const figures = document.querySelectorAll('[data-shot]')
  if (!figures.length) return

  const paths = {
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    home: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16.5 12"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    ok: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    minus: '<path d="M5 12h14"/>',
    square: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  }
  const ic = (name, size = 16, fill = false) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`

  const P = {
    steam: { label: 'Steam', logo: './assets/platforms/steam.svg' },
    epic: { label: 'Epic Games', logo: './assets/platforms/epicgames.svg' },
    riot: { label: 'Riot Games', logo: './assets/platforms/riotgames.svg' },
    local: { label: 'Jeux locaux', logo: './assets/platforms/local.svg' },
  }
  const games = [
    { id: 'cyberpunk', platform: 'steam', installed: true, favorite: true, played: 'il y a 2 heures', rank: 1, launches: 48, dev: 'CD PROJEKT RED', year: '2020', genres: ['RPG', 'Action', 'Monde ouvert'],
      summary: 'Un RPG d’action en monde ouvert dans la mégalopole de Night City.',
      text: ['Incarnez V, mercenaire en quête d’une puce qui change tout, et choisissez votre style : piratage, discrétion ou armes lourdes.', 'Quêtes, choix et conséquences se mêlent dans une ville dense et vivante.'] },
    { id: 'elden', platform: 'steam', installed: true, favorite: false, played: 'hier', rank: 2, launches: 31, dev: 'FromSoftware', year: '2022' },
    { id: 'cs2', platform: 'steam', installed: true, favorite: true, played: 'il y a 2 jours', rank: 3, launches: 210, dev: 'Valve', year: '2023' },
    { id: 'hades', platform: 'epic', installed: true, favorite: false, played: 'il y a 4 jours', rank: 4, launches: 22, dev: 'Supergiant Games', year: '2020' },
    { id: 'valorant', platform: 'riot', installed: true, favorite: false, played: 'il y a 5 jours', rank: 5, launches: 64, dev: 'Riot Games', year: '2020' },
    { id: 'bg3', platform: 'steam', installed: true, favorite: false, played: 'il y a 1 semaine', rank: 6, launches: 17, dev: 'Larian Studios', year: '2023' },
    { id: 'celeste', platform: 'epic', installed: true, favorite: false, played: 'il y a 2 semaines', rank: 7, launches: 6, dev: 'Maddy Makes Games', year: '2018' },
    { id: 'lol', platform: 'riot', installed: true, favorite: false, played: 'il y a 3 semaines', rank: 8, launches: 120, dev: 'Riot Games', year: '2009' },
    { id: 'hollow', platform: 'local', installed: true, favorite: false, played: 'il y a 1 mois', rank: 9, launches: 5, dev: 'Team Cherry', year: '2017' },
    { id: 'stardew', platform: 'steam', installed: false, favorite: true, played: null, rank: 0, launches: 0, dev: 'ConcernedApe', year: '2016' },
  ]
  games.push(
    { id: 'fortnite', platform: 'epic', installed: true, favorite: false, played: 'il y a 3 jours', rank: 3.5, launches: 40, dev: 'Epic Games', year: '2017' },
    { id: 'rocketleague', platform: 'epic', installed: true, favorite: false, played: 'il y a 3 semaines', rank: 7.5, launches: 66, dev: 'Psyonix', year: '2015' },
    { id: '2xko', platform: 'riot', installed: true, favorite: false, played: 'il y a 2 mois', rank: 12, launches: 3, dev: 'Riot Games', year: '2025' },
  )
  for (const game of games) game.title = CAT[game.id].title
  const featured = games[0]

  const card = (game, wide = false) => `<article class="card${wide ? ' card-wide' : ''}">
    <div class="card-cover">
      ${gameArt(game.id)}${gameImg(game.id, wide ? 'wide' : 'cover')}
      ${game.installed ? '' : '<span class="card-flag">Non installé</span>'}
      ${game.favorite ? `<span class="card-fav">${ic('star', 16, true)}</span>` : ''}
      <span class="card-platform"><img src="${P[game.platform].logo}" alt="" /></span>
    </div>
    <div class="card-meta"><strong>${game.title}</strong><span>${game.played ? `Joué · ${game.played}` : game.dev}</span></div>
  </article>`

  const shelf = (title, subtitle, cards) => `<section class="shelf">
    <header class="shelf-head"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
      <div class="shelf-tools"><span class="link-btn">Tout voir</span><span class="icon-btn" style="opacity:.3">${ic('left', 18)}</span><span class="icon-btn">${ic('right', 18)}</span></div></header>
    <div class="shelf-track">${cards.join('')}</div>
  </section>`

  const pageHome = () => {
    const recents = games.filter((game) => game.rank).sort((a, b) => a.rank - b.rank)
    return `<section class="page home">
      <section class="hero">
        ${gameArt(featured.id)}${gameImg(featured.id, 'hero')}<div class="hero-shade"></div>
        <div class="hero-content">
          <span class="hero-kicker">À la une</span>
          <h1>${featured.title}</h1>
          <p class="hero-genres">${featured.genres.join(' · ')}</p>
          <p class="hero-text">${featured.summary}</p>
          <div class="hero-actions-app">
            <span class="btn btn-primary btn-lg">${ic('play', 17, true)}Jouer</span>
            <span class="btn btn-lg btn-glass">${ic('info', 16)}Voir la fiche</span>
          </div>
          <span class="hero-foot">Dernier lancement : ${featured.played}</span>
        </div>
      </section>
      ${shelf('Reprendre', 'Vos derniers lancements', recents.slice(0, 6).map((game) => card(game, true)))}
      ${shelf('Favoris', '', games.filter((game) => game.favorite).map((game) => card(game)))}
    </section>`
  }

  const filterLabels = [['Tous les jeux', games.length], ['Installés', games.filter((g) => g.installed).length], ['Non installés', games.filter((g) => !g.installed).length], ['Favoris', games.filter((g) => g.favorite).length], ['Récemment joués', games.filter((g) => g.played).length], ['Masqués', 0]]

  const pageLibrary = () => {
    const list = [...games].sort((a, b) => (a.rank || 99) - (b.rank || 99))
    return `<section class="page">
      <header class="page-head">
        <div><p class="win-eyebrow">Bibliothèque</p><h1>Tous les jeux</h1><p class="page-sub">${plural(list.length, 'jeu', 'jeux')}</p></div>
        <span class="btn btn-primary">${ic('refresh', 15)}Synchroniser</span>
      </header>
      <div class="filters">
        <div class="pills">${filterLabels.map(([label, n], i) => `<span class="pill${i === 0 ? ' is-on' : ''}">${label}<span>${n}</span></span>`).join('')}</div>
        <div class="pills"><span class="pill is-on">Toutes</span>${Object.entries(P).map(([id, p]) => `<span class="pill"><img src="${p.logo}" alt="" />${p.label}<span>${games.filter((g) => g.platform === id).length}</span></span>`).join('')}</div>
      </div>
      <div class="toolbar">
        <span class="count">${list.length} résultats</span>
        <div class="toolbar-tools"><span class="select-wrap">${ic('sort', 14)}<span style="color:var(--text);font-size:13px">Dernière utilisation</span></span><input class="size-slider" type="range" min="120" max="256" value="176" disabled tabindex="-1" /></div>
      </div>
      <div class="games games-grid">${list.map((game) => card(game)).join('')}</div>
    </section>`
  }

  const pageGame = () => {
    const g = featured
    const p = P[g.platform]
    const rows = [['Plateforme', p.label], ['État', 'Installé'], ['Dernier lancement', 'Il y a 2 heures'], ['Lancements via Relay', String(g.launches)], ['Sortie', g.year], ['Développeur', g.dev]]
    const kinds = ['hero', 'wide', 'capsule', 'bg']
    const thumbs = kinds.map((kind, i) => `<div class="gp-thumb" style="--h:${(CAT[g.id].hue + i * 38) % 360}">${gameImg(g.id, kind)}${i === 0 ? `<span class="play"><span>${ic('play', 14, true)}</span></span>` : ''}</div>`).join('')
    return `<article class="gp">
      <header class="gp-hero">
        ${gameArt(g.id)}${gameImg(g.id, 'hero')}<div class="gp-hero-shade"></div>
        <span class="btn btn-glass gp-back">${ic('back', 16)}Retour</span>
        <div class="gp-hero-body">
          <div class="gp-cover">${gameArt(g.id)}${gameImg(g.id, 'cover')}</div>
          <div class="gp-heading">
            <div class="gp-tags"><span class="chip"><img src="${p.logo}" alt="" />${p.label}</span><span class="chip chip-ok">Installé</span>${g.genres.map((x) => `<span class="chip chip-soft">${x}</span>`).join('')}</div>
            <h1>${g.title}</h1>
            <p class="gp-meta">${g.dev} · ${g.year}</p>
            <div class="gp-actions"><span class="btn btn-primary btn-lg">${ic('play', 18, true)}Jouer</span><span class="btn btn-lg btn-glass is-on">${ic('star', 17, true)}Dans les favoris</span></div>
          </div>
        </div>
      </header>
      <div class="gp-grid">
        <section class="gp-main">
          <h2>À propos du jeu</h2>
          <p class="gp-lead">${g.summary}</p>
          <div class="gp-text">${g.text.map((t) => `<p>${t}</p>`).join('')}</div>
          <p class="gp-source">Description : Steam</p>
          <div class="gp-gallery">${thumbs}</div>
        </section>
        <aside class="gp-side">
          <section class="panel"><h3>Informations</h3><dl class="info-list">${rows.map(([l, v]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`).join('')}</dl></section>
          <section class="panel"><h3>Correspondance et images</h3>
            <div class="match">${ic('ok', 18)}<div><strong>Identifié avec certitude : ${g.title}</strong><p>Identifiant Steam du jeu connu.</p></div></div>
            <div class="action-grid"><span class="btn">${ic('refresh', 15)}Actualiser</span><span class="btn">${ic('image', 15)}Ma jaquette…</span><span class="btn">${ic('image', 15)}Ma bannière…</span></div>
          </section>
        </aside>
      </div>
    </article>`
  }

  const rail = (active) => {
    const item = (id, label, icon) => `<span class="rail-item${id === active ? ' is-active' : ''}">${ic(icon, 21)}<span>${label}</span></span>`
    return `<div class="rail-group">${item('home', 'Accueil', 'home')}${item('all', 'Jeux', 'grid')}${item('fav', 'Favoris', 'heart')}${item('recent', 'Récents', 'clock')}</div>
      <div class="rail-group">${item('add', 'Ajouter', 'plus')}${item('settings', 'Réglages', 'settings')}</div>`
  }

  const shots = {
    home: { page: pageHome, rail: 'home', ambient: true, toast: `Lancement de ${featured.title} transmis à Steam` },
    library: { page: pageLibrary, rail: 'all', ambient: false },
    game: { page: pageGame, rail: 'all', ambient: true },
  }

  for (const figure of figures) {
    const shot = shots[figure.dataset.shot]
    if (!shot) continue
    const win = document.createElement('div')
    win.className = 'win'
    win.setAttribute('role', 'img')
    win.setAttribute('aria-label', figure.dataset.label || 'Capture de l’application Relay')
    win.innerHTML = `<header class="titlebar" aria-hidden="true">
        <div class="titlebar-brand"><img src="./assets/relay-mark.svg" alt="" width="26" height="26" /></div>
        <div class="titlebar-search">${ic('search', 15)}<span style="flex:1;font-size:13px">Rechercher un jeu, un genre, une plateforme…</span><kbd>Ctrl K</kbd></div>
        <div class="titlebar-drag"></div>
        <div class="window-controls"><span>${ic('minus', 15)}</span><span>${ic('square', 12)}</span><span>${ic('x', 16)}</span></div>
      </header>
      <div class="body" aria-hidden="true">
        <nav class="rail">${rail(shot.rail)}</nav>
        <div class="main"><div class="ambient">${shot.ambient ? gameImg(featured.id, 'hero') : ''}</div><div class="scroll">${shot.page()}</div></div>
      </div>
      ${shot.toast ? `<div class="toast" aria-hidden="true">${ic('check', 16)}<span>${shot.toast}</span></div>` : ''}`
    figure.prepend(win)
  }
})()

hydrateImages(document)

/* Aperçu local (fichier ouvert directement, ou serveur de développement comme live-server) : on garde le .html dans les liens. */
if (window.location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
  document.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href')
    if (/^\.\/(documentation|support|confidentialite)(#.*)?$/.test(href)) link.setAttribute('href', href.replace(/^(\.\/[a-z]+)/, '$1.html'))
    else if (/^\.\/(#.*)?$/.test(href)) link.setAttribute('href', `./index.html${href.slice(2)}`)
  })
}

/* ---------- 3. Effets de page ---------- */

const header = document.querySelector('.site-header')
if (header) {
  const update = () => header.classList.toggle('is-scrolled', window.scrollY > 8)
  update()
  window.addEventListener('scroll', update, { passive: true })
}

for (const card of document.querySelectorAll('.bento-card')) {
  card.addEventListener('pointermove', (event) => {
    const rect = card.getBoundingClientRect()
    card.style.setProperty('--mx', `${event.clientX - rect.left}px`)
    card.style.setProperty('--my', `${event.clientY - rect.top}px`)
  })
}

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('js-reveal')
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('in')
      observer.unobserve(entry.target)
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' })
  document.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element))
}
