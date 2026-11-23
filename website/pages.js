/* ==========================================================================
   Relay — pages secondaires (documentation, support, confidentialité)
   - Sommaire de la documentation qui suit la lecture
   - En-tête qui se renforce au défilement
   ========================================================================== */

const docLinks = [...document.querySelectorAll('.doc-nav a[href^="#"]')]
if (docLinks.length && 'IntersectionObserver' in window) {
  const sections = docLinks.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean)
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      for (const link of docLinks) link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`)
    }
  }, { rootMargin: '-20% 0px -70% 0px' })
  sections.forEach((section) => observer.observe(section))
}

/* Aperçu local (fichier ouvert directement, ou serveur de développement comme live-server) : on garde le .html dans les liens. */
if (window.location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
  document.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href')
    if (/^\.\/(documentation|support|confidentialite)(#.*)?$/.test(href)) link.setAttribute('href', href.replace(/^(\.\/[a-z]+)/, '$1.html'))
    else if (/^\.\/(#.*)?$/.test(href)) link.setAttribute('href', `./index.html${href.slice(2)}`)
  })
}

const header = document.querySelector('.site-header')
if (header) {
  const update = () => header.classList.toggle('is-scrolled', window.scrollY > 8)
  update()
  window.addEventListener('scroll', update, { passive: true })
}
