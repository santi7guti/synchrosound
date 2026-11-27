/* SynchroSound · lector de Soundeo (__SSYNC_LECTOR_APP__)

   Lo descarga y arranca el cargador (synchrosound-lector.user.js) solo cuando Tiger llega a soundeo.com desde
   SynchroSound con «Leer Soundeo». Lee sus favoritos (★) y sus descargas y prepara un enlace de vuelta a
   SynchroSound con la lista dentro (en la parte «#», que no llega a ningún servidor).

   Lo que NO hace, por diseño:
   - No da ni quita estrellas, no descarga, no vota y no marca nada como escuchado: su única función de red
     («pide») solo admite GET a /account/favorites y /account/downloads (y sus páginas).
   - No manda filtros en la dirección, así que no cambia los que Soundeo recuerda.
   - No guarda nada en el navegador (ni localStorage ni cookies) y no conecta Dropbox.
   - No toca Soundeo Feed: ni su capa, ni sus claves «sxfeed:*», ni el historial. Su panel cuelga de <html>
     (Feed oculta lo que cuelga de <body>) y vive en su propio Shadow DOM. */
(function () {
  'use strict';
  const VERSION = '1.0.0';
  const info = window.__SSYNC_LECTOR__;
  if (!info || !/^[A-Za-z0-9_-]{16,64}$/.test(info.marca || '') || info.en) return;
  info.en = true;

  const VUELTA = 'https://santi7guti.github.io/synchrosound/'; // fija: la vuelta nunca sale de la dirección
  const POR_PAGINA = 100;  // canciones que da Soundeo por página
  const MAX_PAGINAS = 60;  // tope de seguridad
  const PAUSA = 250;       // ms entre páginas
  const espera = ms => new Promise(r => setTimeout(r, ms));

  // ---------------- red: la única función que pide algo a Soundeo ----------------
  const RUTA_OK = /^\/account\/(favorites|downloads)(\?page=[1-9]\d{0,2})?$/;
  async function pide(ruta) {
    if (!RUTA_OK.test(ruta)) throw new Error('el lector no pide esa dirección (' + ruta + ')');
    const r = await fetch(ruta, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    const fin = new URL(r.url || ruta, location.href);
    const texto = await r.text();
    // DOMParser no ejecuta nada de la página: solo se lee su texto.
    return { estado: r.status, mismaRuta: fin.pathname + fin.search === ruta, doc: new DOMParser().parseFromString(texto, 'text/html') };
  }

  // ---------------- leer una página ----------------
  function segundos(s) {
    const m = /^(\d+):(\d\d)(?::(\d\d))?$/.exec(String(s || '').trim());
    if (!m) return 0;
    const n = m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
    return n <= 86400 ? n : 0;
  }
  function dePagina(doc) {
    const filas = [];
    let raras = 0;
    doc.querySelectorAll('.trackitem').forEach(el => {
      const id = Number(el.getAttribute('data-track-id'));
      const a = el.querySelector('.info strong a') || el.querySelector('.info strong');
      const texto = a ? a.textContent.replace(/\s+/g, ' ').trim() : '';
      if (!Number.isSafeInteger(id) || id <= 0 || !texto) { raras++; return; }
      const t = el.querySelector('.info time'), d = el.querySelector('.download'), estrella = el.querySelector('button.favorites');
      filas.push({
        id, texto: texto.slice(0, 300), dur: segundos(t && t.textContent),
        estado: d ? (d.classList.contains('downloaded') ? 1 : 0) : 2, // 2 = aún no publicada: no se puede descargar
        estrella: estrella ? estrella.classList.contains('favored') : null,
      });
    });
    let ultima = 1;
    doc.querySelectorAll('.pagination a[href*="page="]').forEach(a => {
      const m = /[?&]page=(\d+)/.exec(a.getAttribute('href') || '');
      if (m) ultima = Math.max(ultima, Number(m[1]));
    });
    // Filtros puestos: Soundeo enseña «reset», deja marcadas las opciones o rellena la búsqueda.
    const bpm = doc.querySelector('#bpmFilter');
    const bpmPuesto = !!bpm && ['min', 'max'].some(k => {
      const i = bpm.querySelector('input.' + k), tope = bpm.getAttribute('data-' + k);
      return !!i && tope != null && (i.getAttribute('value') || '') !== '' && i.getAttribute('value') !== tope;
    });
    const filtros = doc.querySelectorAll('.filter-reset').length > 0 || doc.querySelectorAll('.filter-block select option[selected]').length > 0 ||
      Array.from(doc.querySelectorAll('.filter-block input[name="searchFilter"]')).some(i => (i.getAttribute('value') || '').trim() !== '') || bpmPuesto;
    return { filas, raras, ultima, filtros, sesion: !!doc.querySelector('a[href*="logout"]') };
  }

  // ---------------- leer una lista entera (todas sus páginas) ----------------
  async function leeLista(cual, prog) {
    const base = '/account/' + cual;
    const out = { filas: [], paginas: 0, sesion: true, leida: false, incompleta: false, filtros: false, raras: 0, error: '' };
    const vistos = new Set();
    let ultima = 1;
    for (let p = 1; p <= MAX_PAGINAS; p++) {
      const sonda = p > ultima; // la anterior vino llena y Soundeo no anunciaba más: se mira si hay otra
      prog(p, ultima);
      if (p > 1) await espera(PAUSA);
      let x;
      try { x = await pide(p === 1 ? base : base + '?page=' + p); }
      catch (e) { out.error = String((e && e.message) || e); if (p > 1 && !sonda) out.incompleta = true; break; }
      const pg = dePagina(x.doc);
      if (p === 1) {
        if (x.mismaRuta && x.estado !== 200) { out.error = 'Soundeo respondió ' + x.estado; break; }
        if (!x.mismaRuta || !pg.sesion) { out.sesion = false; break; } // sin sesión, Soundeo manda a otra página
        out.leida = true;
      } else if (x.estado !== 200 || !x.mismaRuta || !pg.filas.length) {
        if (!sonda) { out.incompleta = true; out.error = 'la página ' + p + ' no llegó (' + x.estado + ')'; }
        break;
      }
      let nuevas = 0;
      pg.filas.forEach(f => { if (!vistos.has(f.id)) { vistos.add(f.id); out.filas.push(f); nuevas++; } });
      out.paginas = p;
      out.raras += pg.raras;
      if (pg.filtros) out.filtros = true;
      ultima = Math.max(ultima, pg.ultima);
      if (p > 1 && !nuevas) { if (!sonda) out.incompleta = true; break; } // la misma página otra vez: se corta
      if (p >= ultima && pg.filas.length < POR_PAGINA) break;            // última página, y no viene llena
      if (p === MAX_PAGINAS) out.incompleta = true;
    }
    return out;
  }

  // ---------------- el enlace de vuelta ----------------
  function suma(texto) { // FNV-1a de 32 bits; la misma cuenta que hace SynchroSound al recibirla
    let h = 0x811c9dc5;
    for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function b64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function comprime(bytes) {
    if (typeof CompressionStream !== 'function') return null;
    try {
      const cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter();
      w.write(bytes); w.close();
      return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    } catch (e) { return null; }
  }
  async function enlaceDe(datos) {
    const json = JSON.stringify(datos), bytes = new TextEncoder().encode(json);
    const z = await comprime(bytes), usaZ = !!z && z.length < bytes.length;
    return VUELTA + '#soundeo=1.' + datos.n + '.' + (usaZ ? 'z' : 'j') + '.' + datos.fav.length + '.' + suma(json) + '.' + b64url(usaZ ? z : bytes);
  }

  // ---------------- panel ----------------
  const MOTIVOS = {
    'fav-filtros': 'Soundeo tiene filtros puestos en tus favoritos',
    'fav-paginas': 'no se han podido leer todas las páginas de favoritos',
    'fav-vacia': 'Soundeo no enseña ningún favorito',
    'fav-marcado': 'algún favorito viene con una forma que el lector no conoce',
    'dow-error': 'no se ha podido leer la lista de descargas',
    'dow-filtros': 'Soundeo tiene filtros puestos en tus descargas',
    'dow-paginas': 'no se han podido leer todas las páginas de descargas',
  };
  const CSS = ':host{all:initial}' +
    '.fondo{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:#16181c;color:#ecede9;overflow:auto;-webkit-overflow-scrolling:touch;' +
    'font:17px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:calc(20px + env(safe-area-inset-top)) 20px calc(28px + env(safe-area-inset-bottom));box-sizing:border-box}' +
    '.caja{max-width:520px;margin:0 auto}h1{font:700 22px/1.2 inherit;margin:0 0 14px}p{margin:0 0 12px}' +
    '.linea{padding:10px 12px;margin:0 0 8px;background:#25292f;border-left:4px solid #76a6f6;border-radius:0 4px 4px 0}' +
    '.linea.bien{border-left-color:#45c98f}.linea.mal{border-left-color:#ef7189}.linea.ojo{border-left-color:#efa73a}' +
    '.acc{display:flex;flex-direction:column;gap:10px;margin-top:18px}' +
    'a.btn,button.btn{display:block;text-align:center;font:600 18px/1.2 inherit;padding:15px 16px;border-radius:6px;border:1px solid #ecede9;background:#ecede9;color:#16181c;text-decoration:none;cursor:pointer;-webkit-appearance:none}' +
    'button.sec{background:transparent;color:#ecede9}.pie{margin-top:22px;font-size:14px;color:#a4aab3}';
  let host = null, caja = null;
  function el(tag, clase, texto) { const e = document.createElement(tag); if (clase) e.className = clase; if (texto != null) e.textContent = texto; return e; }
  function abrePanel() {
    host = document.createElement('div');
    host.id = 'ssync-lector';
    const sombra = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = CSS;
    const fondo = el('div', 'fondo');
    caja = el('div', 'caja');
    fondo.appendChild(caja);
    sombra.appendChild(st);
    sombra.appendChild(fondo);
    document.documentElement.appendChild(host); // de <html>, no de <body>: así Soundeo Feed no lo oculta
  }
  function cierra() { if (host) host.remove(); host = null; }
  function pinta(titulo, lineas, acciones) {
    if (!host) return;
    const hijos = [el('h1', '', titulo)];
    lineas.forEach(l => hijos.push(el(l.p ? 'p' : 'div', l.p ? '' : 'linea ' + (l.c || ''), l.t)));
    const acc = el('div', 'acc');
    (acciones || []).forEach(a => {
      let b;
      if (a.href) { b = el('a', 'btn', a.t); b.href = a.href; b.id = 'ssync-volver'; }
      else { b = el('button', 'btn sec', a.t); b.type = 'button'; b.addEventListener('click', a.fn); }
      acc.appendChild(b);
    });
    hijos.push(acc, el('div', 'pie', 'Lector de SynchroSound v' + VERSION + '. Solo lee: no toca tus estrellas, no descarga y no cambia nada en Soundeo.'));
    caja.replaceChildren.apply(caja, hijos);
  }
  const cerrar = { t: 'Cerrar y quedarme en Soundeo', fn: cierra };

  // ---------------- todo junto ----------------
  async function lee() {
    const lin = { fav: { t: 'Favoritos: leyendo…' }, dow: { t: 'Descargas: esperando…' } };
    const repinta = () => pinta('Leyendo tus favoritos de Soundeo', [lin.fav, lin.dow], [cerrar]);
    repinta();
    const fav = await leeLista('favorites', (p, de) => { lin.fav = { t: 'Favoritos: leyendo la página ' + p + (de > 1 ? ' de ' + de : '') + '…' }; repinta(); });
    if (!fav.sesion) {
      pinta('No has iniciado sesión en Soundeo', [
        { p: 1, t: 'El lector no puede ver tus favoritos sin tu sesión. Cierra este aviso, inicia sesión en Soundeo y pulsa otra vez «Leer Soundeo» en SynchroSound.' },
        { t: 'No se ha leído ni cambiado nada.', c: 'ojo' }], [cerrar, { t: 'Volver a SynchroSound sin leer', href: VUELTA }]);
      return;
    }
    if (!fav.leida) {
      pinta('No se ha podido leer Soundeo', [
        { t: 'Favoritos: ' + (fav.error || 'no han llegado') + '.', c: 'mal' },
        { p: 1, t: 'No se ha cambiado nada. Prueba otra vez desde SynchroSound dentro de un rato.' }], [{ t: 'Volver a SynchroSound sin leer', href: VUELTA }, cerrar]);
      return;
    }
    const favs = fav.filas.filter(f => f.estrella !== false); // por si Soundeo enseñase alguna sin estrella
    const baj = favs.filter(f => f.estado === 1).length, sinPub = favs.filter(f => f.estado === 2).length;
    lin.fav = { t: 'Favoritos: ' + favs.length + ' (' + baj + (baj === 1 ? ' descargado' : ' descargados') + (sinPub ? ', ' + sinPub + ' sin publicar' : '') + ').', c: 'bien' };
    lin.dow = { t: 'Descargas: leyendo…' };
    repinta();
    const dow = await leeLista('downloads', (p, de) => { lin.dow = { t: 'Descargas: leyendo la página ' + p + (de > 1 ? ' de ' + de : '') + '…' }; repinta(); });
    const mal = [];
    if (fav.filtros) mal.push('fav-filtros');
    if (fav.incompleta) mal.push('fav-paginas');
    if (fav.raras) mal.push('fav-marcado');
    if (!favs.length) mal.push('fav-vacia');
    if (!dow.leida) mal.push('dow-error');
    else { if (dow.filtros) mal.push('dow-filtros'); if (dow.incompleta) mal.push('dow-paginas'); }
    lin.dow = dow.leida ? { t: 'Descargas: ' + dow.filas.length + '.', c: 'bien' } : { t: 'Descargas: no se han podido leer' + (dow.error ? ' (' + dow.error + ')' : '') + '.', c: 'mal' };
    const datos = {
      v: 1, n: info.marca, t: Date.now(), lector: VERSION,
      fav: favs.map(f => [f.id, f.texto, f.dur, f.estado]),
      dow: dow.leida ? dow.filas.map(f => f.id) : [],
      pag: [fav.paginas, dow.paginas], mal,
    };
    const href = await enlaceDe(datos);
    const lineas = [lin.fav, lin.dow];
    if (mal.length) lineas.push({ t: 'Ojo, la lista no vale como completa: ' + mal.map(m => MOTIVOS[m] || m).join('; ') + '. SynchroSound lo tendrá en cuenta.', c: 'ojo' });
    lineas.push({ p: 1, t: mal.length ? 'Puedes llevarla igualmente a SynchroSound. En Soundeo no se ha cambiado nada.' : 'Listo: todo leído. En Soundeo no se ha cambiado nada.' });
    pinta(mal.length ? 'Leído, con avisos' : 'Favoritos leídos', lineas, [{ t: 'Volver a SynchroSound', href }, cerrar]);
    info.hecho = { fav: datos.fav.length, dow: datos.dow.length, mal: mal.slice(), largo: href.length };
  }

  function arranca() {
    abrePanel();
    lee().catch(e => {
      pinta('El lector ha fallado', [{ t: String((e && e.message) || e), c: 'mal' }, { p: 1, t: 'No se ha cambiado nada en Soundeo.' }], [{ t: 'Volver a SynchroSound sin leer', href: VUELTA }, cerrar]);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arranca);
  else arranca();
})();
