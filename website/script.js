const owner = 'Fuzoxxxxxxxx'
const repository = 'nexora'
const releasesUrl = `https://github.com/${owner}/${repository}/releases`
const apiUrl = `https://api.github.com/repos/${owner}/${repository}/releases/latest`

const primaryLink = document.querySelector('#download-link')
const secondaryLink = document.querySelector('#download-link-bottom')
const primaryLabel = document.querySelector('#download-label')
const secondaryLabel = document.querySelector('#download-label-bottom')
const status = document.querySelector('#download-status')
const releaseMeta = document.querySelector('#release-meta')

function setDownload(assetUrl, label, details) {
  for (const link of [primaryLink, secondaryLink]) {
    link.href = assetUrl
    link.classList.remove('is-disabled')
    link.removeAttribute('aria-disabled')
  }
  primaryLabel.textContent = label
  secondaryLabel.textContent = label
  status.textContent = details
  releaseMeta.textContent = details
}

async function loadLatestRelease() {
  try {
    const response = await fetch(apiUrl, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    })
    if (response.status === 404) {
      status.textContent = 'La première version n’est pas encore publiée. Consultez les releases GitHub pour suivre sa sortie.'
      return
    }
    if (!response.ok) throw new Error(`GitHub API: ${response.status}`)

    const release = await response.json()
    const assets = Array.isArray(release.assets) ? release.assets : []
    const installer = assets.find((asset) => /^Nexora-Setup-.*\.exe$/i.test(asset.name))
      ?? assets.find((asset) => /\.exe$/i.test(asset.name))
    if (!installer?.browser_download_url) {
      status.textContent = `La version ${release.tag_name} est publiée, mais son installateur Windows n’est pas encore disponible.`
      releaseMeta.textContent = `Version ${release.tag_name} · installateur en attente`
      return
    }

    const date = release.published_at
      ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(release.published_at))
      : 'dernière version'
    setDownload(installer.browser_download_url, 'Télécharger pour Windows', `Version ${release.tag_name} · publiée le ${date}`)
  } catch (error) {
    console.error('Impossible de récupérer la dernière release Nexora :', error)
    status.textContent = 'Impossible de vérifier le téléchargement pour le moment. Consultez les releases GitHub.'
  }
}

loadLatestRelease()
