/* ==========================================================================
   Relay — pages secondaires
   - Téléchargement : dernière release GitHub et liste des fichiers
   - Changelog : notes de version issues des releases GitHub
   - Documentation : sommaire qui suit la lecture
   ========================================================================== */

const owner = 'Fuzoxxxxxxxx'
const repository = 'relay'
const API = `https://api.github.com/repos/${owner}/${repository}/releases`

const $ = (selector, root = document) => root.querySelector(selector)
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' })
const formatSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`)

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub API : ${response.status}`)
  return response.json()
}

/* ---------- Markdown minimal et sûr (notes de version) ---------- */

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
}

function markdown(source) {
  let html = ''
  let inList = false
  let paragraph = []
  const flush = () => {
    if (paragraph.length) html += `<p>${inline(paragraph.join(' '))}</p>`
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
      html += `<h${level}>${inline(heading[2])}</h${level}>`
    } else if (item) {
      flush()
      if (!inList) { html += '<ul>'; inList = true }
      html += `<li>${inline(item[1])}</li>`
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

/* ---------- Téléchargement ---------- */

const downloadLink = $('#download-link')
if (downloadLink) {
  const label = $('#download-label')
  const status = $('#download-status')
  const assetList = $('#asset-list')
  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>'

  const assetTitle = (name) => {
    if (/setup|install/i.test(name)) return 'Installateur Windows (recommandé)'
    if (/portable/i.test(name)) return 'Version portable'
    return 'Fichier de la version'
  }

  ;(async () => {
    try {
      const release = await getJson(`${API}/latest`)
      if (!release) {
        status.textContent = 'La première version n’est pas encore publiée. Elle apparaîtra ici dès sa sortie.'
        if (assetList) assetList.innerHTML = '<div class="asset-empty">Aucun fichier à télécharger pour le moment.</div>'
        return
      }
      const assets = (release.assets ?? []).filter((asset) => !/\.(blockmap|yml|yaml)$/i.test(asset.name))
      const installer = assets.find((asset) => /setup|install/i.test(asset.name) && /\.exe$/i.test(asset.name)) ?? assets.find((asset) => /\.exe$/i.test(asset.name))
      const published = release.published_at ? dateFormat.format(new Date(release.published_at)) : ''
      if (installer) {
        downloadLink.href = installer.browser_download_url
        downloadLink.classList.remove('is-disabled')
        downloadLink.removeAttribute('aria-disabled')
        label.textContent = 'Télécharger pour Windows'
      }
      status.textContent = `Version ${release.tag_name}${published ? ` · publiée le ${published}` : ''}${installer ? ` · ${formatSize(installer.size)}` : ''}`
      if (assetList) {
        assetList.innerHTML = assets.length
          ? assets.map((asset) => `<div class="asset"><span class="asset-icon">${icon}</span>
              <div class="asset-info"><strong>${esc(assetTitle(asset.name))}</strong><span>${esc(asset.name)} · ${formatSize(asset.size)}</span></div>
              <a class="button button-small" href="${esc(asset.browser_download_url)}">Télécharger</a></div>`).join('')
          : '<div class="asset-empty">Cette version ne contient pas encore de fichier à télécharger.</div>'
      }
    } catch (error) {
      console.error('Impossible de récupérer la dernière version de Relay :', error)
      status.textContent = 'Impossible de vérifier la dernière version pour le moment. Utilisez la page des releases GitHub.'
      if (assetList) assetList.innerHTML = '<div class="asset-empty">Liste indisponible. Consultez les <a href="https://github.com/Fuzoxxxxxxxx/relay/releases" target="_blank" rel="noreferrer">releases GitHub</a>.</div>'
    }
  })()
}

/* ---------- Changelog ---------- */

const changelog = $('#changelog-list')
if (changelog) {
  ;(async () => {
    try {
      const releases = (await getJson(`${API}?per_page=20`)) ?? []
      if (!releases.length) {
        changelog.innerHTML = '<div class="state-card"><strong>Aucune version publiée pour l’instant</strong>Les notes de chaque version apparaîtront ici dès la première release.</div>'
        return
      }
      const latestId = releases.find((release) => !release.prerelease)?.id
      changelog.innerHTML = releases.map((release) => {
        const date = release.published_at ? dateFormat.format(new Date(release.published_at)) : ''
        const title = release.name && release.name !== release.tag_name ? release.name : `Version ${release.tag_name}`
        const body = release.body?.trim() ? markdown(release.body) : '<p>Aucune note de version n’a été fournie pour cette release.</p>'
        return `<article class="release${release.id === latestId ? ' is-latest' : ''}" id="${esc(release.tag_name)}">
          <div class="release-meta">
            <span class="release-tag">${esc(release.tag_name)}</span>
            ${date ? `<time datetime="${esc(release.published_at)}">${date}</time>` : ''}
            ${release.id === latestId ? '<span class="badge">Dernière version</span>' : ''}
            ${release.prerelease ? '<span class="badge pre">Pré-version</span>' : ''}
          </div>
          <h2>${esc(title)}</h2>
          <div class="prose">${body}</div>
          <a class="release-link" href="${esc(release.html_url)}" target="_blank" rel="noreferrer">Voir sur GitHub ↗</a>
        </article>`
      }).join('')
    } catch (error) {
      console.error('Impossible de charger le changelog :', error)
      changelog.innerHTML = '<div class="state-card"><strong>Changelog momentanément indisponible</strong>Consultez directement les <a href="https://github.com/Fuzoxxxxxxxx/relay/releases" target="_blank" rel="noreferrer" style="color:var(--accent-2)">releases GitHub</a>.</div>'
    }
  })()
}

/* ---------- Documentation : sommaire actif ---------- */

const docLinks = [...document.querySelectorAll('.doc-nav a[href^="#"]')]
if (docLinks.length && 'IntersectionObserver' in window) {
  const sections = docLinks.map((link) => $(link.getAttribute('href'))).filter(Boolean)
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      for (const link of docLinks) link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`)
    }
  }, { rootMargin: '-20% 0px -70% 0px' })
  sections.forEach((section) => observer.observe(section))
}

/* ---------- Effets communs ---------- */

const header = $('.site-header')
if (header) {
  const update = () => header.classList.toggle('is-scrolled', window.scrollY > 8)
  update()
  window.addEventListener('scroll', update, { passive: true })
}
