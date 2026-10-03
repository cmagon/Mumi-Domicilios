// Accesibilidad: enlaza cada <label> con el campo que le sigue (si aún no están enlazados), para que los lectores de pantalla lo anuncien
// y al tocar la etiqueta se enfoque el campo. Se aplica a toda la app, incluidos los modales.
let n = 0
function enlazar(raiz: ParentNode) {
  raiz.querySelectorAll('label:not([for])').forEach((l) => {
    if (l.querySelector('input,select,textarea') || l.classList.contains('switch-fila')) return
    const base = l.parentElement?.classList.contains('lbl-fila') ? l.parentElement : l // etiqueta + botón de ayuda en una fila
    const sig = base.nextElementSibling
    const c = sig && (sig.matches('input,select,textarea') ? sig : sig.querySelector('input,select,textarea')) as HTMLElement | null
    if (!c || c.getAttribute('aria-label') || c.getAttribute('type') === 'checkbox') return
    if (!c.id) c.id = `campo-${++n}`
    l.setAttribute('for', c.id)
  })
}
export function activarEtiquetas() {
  let t = 0
  const correr = () => { cancelAnimationFrame(t); t = requestAnimationFrame(() => enlazar(document)) }
  const obs = new MutationObserver(correr)
  obs.observe(document.body, { childList: true, subtree: true })
  correr()
  return () => obs.disconnect()
}
