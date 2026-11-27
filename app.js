/* SynchroSound — la app. FASE 2, ETAPA 1: en Spotify solo puede AÑADIR canciones a las playlists propias
   «NS - …» y «OG - …» del mapa, las que el usuario marca y confirma, y después de guardar una copia.
   No quita, no reordena, no reemplaza, no crea, y no toca los likes. Todo lo demás sigue siendo lectura.
   Web estática, sin servidor. Habla solo con Spotify y Dropbox (PKCE, sin secretos). */
(function () {
  'use strict';

  const VERSION = '0.5.0';
  const C = window.SSCore;

  const CFG = {
    spotifyId: '6251c56f9a7e49d4891a1531e89735ad', // público: no es un secreto
    dropboxKey: 'd614ryq07qvpgkj',                 // público: no es un secreto
    vuelta: 'https://santi7guti.github.io/synchrosound/',
  };
  /* Permisos que se piden a Spotify. Los de lectura son los de la fase 1. Los dos de escritura (fase 2, con el OK
     expreso del dueño) dejan modificar playlists: desde que Spotify los concede, lo que impide un cambio ya no es
     Spotify sino la puerta de este archivo (ver spotify()). `user-library-modify` (tocar los likes) no se pide
     nunca: los likes los sigue protegiendo Spotify. */
  const PERMISOS_LECTURA = ['playlist-read-private', 'playlist-read-collaborative', 'user-library-read'];
  const PERMISOS_ESCRITURA = ['playlist-modify-public', 'playlist-modify-private'];
  const PERMISOS_SPOTIFY = PERMISOS_LECTURA.concat(PERMISOS_ESCRITURA);
  const URI_CANCION = C && C.URI_CANCION, MAX_LOTE = (C && C.MAX_LOTE) || 100; // la puerta de escritura está en core.js
  const VALE_SIM = 60 * 60000;                // con una simulación de más de una hora no se sincroniza: se simula otra vez
  const VALE_PERMISO = 15 * 60000;            // lo confirmado deja de valer a los 15 minutos
  const ENFRIA = 2 * 60000;                   // tras escribir en una playlist sin poder comprobarlo, no se vuelve a escribir en ella en este tiempo
  const VENTANA_OTRA = VALE_PERMISO + 60000;  // una sincronización empezada en otra pestaña o dispositivo hace menos de esto, y sin cerrar, se da por viva
  const FRESCA_ESCR = (C && C.FRESCA_ESCR) || 15000; // una escritura solo sale si la playlist se ha releído hace menos de esto
  const PLAZO_SP = 30000;                     // una petición a Spotify que no responde en este tiempo se da por cortada

  const RUTA_MEM = '/memoria/memoria.json';
  const RUTA_CACHE = '/memoria/cache-busquedas.json';
  const RUTA_LIB = '/memoria/cache-biblioteca.json';
  const COPIA_COMPLETA = /^spotify-completa-.*\.json$/i;
  const PAUSA_SP = 350;                      // milisegundos entre dos peticiones a Spotify
  const GUARDA = { cuota: 60 * 60000, otro: 15 * 60000 }; // tras un corte sin plazo, cuánto tiempo los botones no envían nada a Spotify
  const LIKES_DESDE = '2026-09-01';

  // ---------------- utilidades ----------------
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } },
  };
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'css') { for (const c in v) el.style.setProperty(c, v[c]); }
      else if (k === 'value') el.value = v;
      else if (k === 'disabled' || k === 'selected' || k === 'open' || k === 'checked') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(4)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const dos = n => String(n).padStart(2, '0');
  function fechaHora(v) {
    if (!v) return 'fecha desconocida';
    const d = new Date(v);
    if (isNaN(d)) return String(v);
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }
  const fechaCorta = v => (v ? fechaHora(v).slice(0, 10) : '');
  const soloHora = v => fechaHora(v).slice(11);
  const hoy = () => { const d = new Date(); return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()); };
  const horaODia = v => (fechaHora(v).slice(0, 10) === fechaHora(Date.now()).slice(0, 10) ? 'las ' + soloHora(v) : 'las ' + soloHora(v) + ' del ' + fechaHora(v).slice(0, 5));
  function duracion(seg) {
    seg = Math.max(0, Math.round(seg));
    if (seg < 90) return seg + ' s';
    if (seg < 5400) return Math.round(seg / 60) + ' min';
    return String(Math.round(seg / 360) / 10).replace('.', ',') + ' h';
  }
  function sello() {
    const d = new Date();
    return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()) + '_' + dos(d.getHours()) + '-' + dos(d.getMinutes()) + '-' + dos(d.getSeconds());
  }
  const kb = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const lineaSp = m => (m.a && m.a.length ? m.a.join(', ') + ' — ' : '') + m.n;
  const lineaRb = rb => (rb.artista ? rb.artista + ' — ' : '') + rb.nombre;
  const canciones = n => n + (n === 1 ? ' canción' : ' canciones');

  // ---------------- estado ----------------
  const S = {
    vista: ls.get('ss.vista') || 'cuentas',
    sp: ls.get('ss.sp'), db: ls.get('ss.db'),
    yo: ls.get('ss.yo'), dbNombre: '',
    archivos: null, xml: null, lib: null, libCache: undefined,
    mem: null, memRev: null, memLista: false,
    cache: null, cacheSucia: false,
    sim: null, simFiltro: 'add', abiertas: {},
    sx: null, sxMirado: false, sxLlegada: ls.get('ss.sx.llegada'), simB: null, simBFiltro: 'add', planB: null, planBVer: null, manoAyuda: false,
    c: null, cOcultas: false,
    copias: null, ultimaCopia: null,
    tarea: null, parar: false, candado: false,
    avisos: [], errores: [], nueva: null, manoTxt: '', manoDe: null, manoConf: null, confRelee: false,
    plan: null, planVer: null, sinc: ls.get('ss.sinc'),
    cont: { spGet: 0, spEscr: 0, spBloqueadas: 0, sp429: 0, busquedas: 0, deCache: 0, db: 0, ext: 0, tope: 0 },
  };
  let nAviso = 0;

  function aviso(texto, tipo) {
    const a = { id: ++nAviso, texto, tipo: tipo || 'info' };
    S.avisos.push(a);
    if (S.avisos.length > 4) S.avisos.shift();
    if (a.tipo !== 'error') setTimeout(() => { S.avisos = S.avisos.filter(x => x !== a); pinta(); }, 9000);
    pinta();
  }
  function textoError(e) {
    const m = (e && e.message) || String(e);
    if (e && e.corte) return textoCorte(e.corte, e.local);
    if (e && e.status === 403 && e.servicio === 'Spotify') {
      return 'Spotify ha rechazado la petición (403). En modo desarrollo suele ser que la cuenta no está en «User Management» de la app, o que la cuenta dueña de la app no es Premium. Detalle: ' + m;
    }
    if (e && /missing_scope/.test(e.resumen || '')) {
      const s = e.datos && e.datos.error && e.datos.error.required_scope;
      return 'A la app de Dropbox le falta el permiso «' + (s || '?') + '». Actívalo en la consola de Dropbox (pestaña Permissions), pulsa Submit y vuelve a conectar Dropbox aquí.';
    }
    return m;
  }
  function falla(e, donde) {
    if (window.console) console.error(donde, e);
    S.errores.push({ t: new Date().toISOString(), donde, m: String((e && e.message) || e).slice(0, 300), s: (e && e.status) || '' });
    if (S.errores.length > 40) S.errores.shift();
    aviso((donde ? donde + ': ' : '') + textoError(e), 'error');
  }

  // ---------------- tareas largas ----------------
  async function tarea(nombre, fn) {
    if (S.tarea) { aviso('Espera a que termine: ' + S.tarea.nombre + '.'); return undefined; }
    S.tarea = { nombre, texto: nombre + '…', hecho: 0, total: 0 };
    S.parar = false;
    pinta();
    const prog = (texto, hecho, total) => { Object.assign(S.tarea, { texto, hecho: hecho || 0, total: total || 0 }); pintaTarea(); };
    try { return await fn(prog); }
    catch (e) { if (e && e.parada) aviso('Parado. Lo ya resuelto se conserva.'); else falla(e, nombre); return undefined; }
    finally { S.tarea = null; anotaUso(); pinta(); }
  }
  function siParar() {
    if (S.parar) { const e = new Error('Parado'); e.parada = true; throw e; }
  }

  // ---------------- conexión (PKCE) ----------------
  function b64url(bytes) {
    let s = '';
    bytes.forEach(b => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function alAzar(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
  async function retoDe(v) {
    return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))));
  }
  const NOMBRE = { sp: 'Spotify', db: 'Dropbox' };

  async function conecta(prov) {
    try {
      const ver = alAzar(48), st = prov + '.' + alAzar(12);
      ls.set('ss.pkce', { prov, ver, st, t: Date.now() });
      const u = new URL(prov === 'sp' ? 'https://accounts.spotify.com/authorize' : 'https://www.dropbox.com/oauth2/authorize');
      const p = {
        client_id: prov === 'sp' ? CFG.spotifyId : CFG.dropboxKey,
        response_type: 'code', redirect_uri: CFG.vuelta, state: st,
        code_challenge_method: 'S256', code_challenge: await retoDe(ver),
      };
      if (prov === 'sp') p.scope = PERMISOS_SPOTIFY.join(' ');
      else p.token_access_type = 'offline';
      for (const k in p) u.searchParams.set(k, p[k]);
      location.assign(u.toString());
    } catch (e) { falla(e, 'Conectar ' + NOMBRE[prov]); }
  }
  async function pideToken(prov, params) {
    const url = prov === 'sp' ? 'https://accounts.spotify.com/api/token' : 'https://api.dropboxapi.com/oauth2/token';
    params.client_id = prov === 'sp' ? CFG.spotifyId : CFG.dropboxKey;
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    let j = null;
    try { j = await r.json(); } catch (e) { /* cuerpo no JSON */ }
    if (!r.ok || !j || !j.access_token) {
      const err = new Error(NOMBRE[prov] + ' no ha dado acceso (' + r.status + (j && (j.error_description || j.error) ? ': ' + (j.error_description || j.error) : '') + ').');
      err.status = r.status;
      err.codigo = (j && j.error) || '';
      throw err;
    }
    return j;
  }
  function guardaToken(prov, j, anterior) {
    const t = {
      a: j.access_token,
      r: j.refresh_token || (anterior && anterior.r) || null,
      exp: Date.now() + (Number(j.expires_in) || 3600) * 1000,
      scope: j.scope != null ? String(j.scope) : (anterior && anterior.scope) || '',
      desde: (anterior && anterior.desde) || Date.now(),
    };
    if (prov === 'sp') {
      // Si Spotify concediese algo que no se ha pedido (tocar los likes, por ejemplo), la conexión no se guarda.
      const de_mas = t.scope.split(/\s+/).filter(Boolean).filter(s => PERMISOS_SPOTIFY.indexOf(s) < 0);
      if (de_mas.length) {
        ls.del('ss.sp'); S.sp = null;
        throw new Error('Spotify ha concedido permisos que esta versión no debe tener (' + de_mas.join(', ') + '). No se guarda la conexión.');
      }
    }
    S[prov] = t;
    ls.set('ss.' + prov, t);
    return t;
  }
  async function vueltaOAuth() {
    const q = new URLSearchParams(location.search);
    if (q.has('v') && !q.has('code') && !q.has('error')) { history.replaceState(null, '', location.pathname + location.hash); return; }
    if (!q.has('code') && !q.has('error')) return;
    history.replaceState(null, '', location.pathname);
    const pk = ls.get('ss.pkce');
    if (!pk || pk.st !== q.get('state')) {
      aviso('La vuelta de la conexión no corresponde a lo que se pidió desde este navegador. Pulsa «Conectar» otra vez.', 'error');
      return;
    }
    ls.del('ss.pkce');
    S.vista = 'cuentas';
    if (q.has('error')) { aviso(NOMBRE[pk.prov] + ' no se ha conectado (' + q.get('error') + ').', 'error'); return; }
    try {
      const j = await pideToken(pk.prov, { grant_type: 'authorization_code', code: q.get('code'), redirect_uri: CFG.vuelta, code_verifier: pk.ver });
      guardaToken(pk.prov, j, null);
      aviso(NOMBRE[pk.prov] + ' conectado.');
      if (pk.prov === 'sp') S.recienSp = true; // el nombre de la cuenta se pide una vez, al conectar; no en cada carga
    } catch (e) { falla(e, 'Conectar ' + NOMBRE[pk.prov]); }
  }
  const refrescando = {};
  function refresca(prov) {
    if (refrescando[prov]) return refrescando[prov];
    const t = S[prov];
    refrescando[prov] = (async () => {
      if (!t || !t.r) throw new Error('Hay que volver a conectar ' + NOMBRE[prov] + '.');
      try {
        return guardaToken(prov, await pideToken(prov, { grant_type: 'refresh_token', refresh_token: t.r }), t).a;
      } catch (e) {
        if (e.codigo === 'invalid_grant') {
          S[prov] = null; ls.del('ss.' + prov);
          throw new Error('La conexión con ' + NOMBRE[prov] + ' ha caducado. Vuelve a conectarla en Cuentas.');
        }
        throw e;
      }
    })();
    const fin = () => { refrescando[prov] = null; };
    refrescando[prov].then(fin, fin);
    return refrescando[prov];
  }
  async function token(prov) {
    const t = S[prov];
    if (!t) throw new Error('Conecta ' + NOMBRE[prov] + ' en Cuentas.');
    if (t.exp - 90000 > Date.now()) return t.a;
    return refresca(prov);
  }
  // ¿Ha concedido Spotify, en este dispositivo, los permisos para modificar playlists?
  function tieneEscritura() {
    const c = S.sp ? String(S.sp.scope || '').split(/\s+/) : [];
    return PERMISOS_ESCRITURA.every(p => c.indexOf(p) >= 0);
  }
  // ¿Y alguno de ellos? Con uno solo, Spotify ya dejaría cambiar algunas playlists: el indicador no puede decir «solo lectura».
  const algunaEscritura = () => !!S.sp && String(S.sp.scope || '').split(/\s+/).some(p => PERMISOS_ESCRITURA.indexOf(p) >= 0);
  function desconecta(prov) {
    S[prov] = null; ls.del('ss.' + prov);
    if (prov === 'sp') { S.yo = null; ls.del('ss.yo'); S.lib = null; S.sim = null; S.c = null; S.plan = null; S.simB = null; S.planB = null; }
    else {
      S.dbNombre = ''; S.archivos = null; S.xml = null; S.mem = null; S.memRev = null; S.memLista = false; S.cache = null; S.libCache = undefined; S.copias = null;
      // sin memoria no hay simulación ni plan que valgan (y la lista de Soundeo se lee de Dropbox)
      S.sim = null; S.plan = null; S.simB = null; S.planB = null; S.sx = null; S.sxMirado = false;
    }
    aviso(NOMBRE[prov] + ' desconectado de este dispositivo.');
  }

  // ---------------- cuánto se le pide a Spotify ----------------
  /* Spotify limita las peticiones de las apps en modo desarrollo con una cuota que no publica. Por eso la app
     cuenta lo que pide cada día (entre todos los dispositivos) y, si Spotify corta, lo apunta y no insiste. */
  function disp() { let d = ls.get('ss.disp'); if (!d) { d = alAzar(4); ls.set('ss.disp', d); } return d; }
  let usoSucio = false;
  function usoLocal() { const u = ls.get('ss.uso'); return u && u.dia === hoy() ? u : { dia: hoy(), n: 0, b: 0 }; }
  function cuentaPeticion() { const u = usoLocal(); u.n++; ls.set('ss.uso', u); usoSucio = true; }
  // «b» = búsquedas nuevas del día (las que de verdad salen hacia Spotify; las de caché no cuentan).
  function cuentaBusqueda() { const u = usoLocal(); u.b = (u.b || 0) + 1; ls.set('ss.uso', u); usoSucio = true; }
  function anotaUso() {
    if (!S.mem || !S.memLista || !usoSucio) return;
    const u = usoLocal(), k = u.dia + '|' + disp();
    if (!S.mem.uso) S.mem.uso = {};
    S.mem.uso[k] = { n: u.n, b: u.b || 0, t: Date.now() };
    const d = new Date(); d.setDate(d.getDate() - 30);
    const lim = d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate());
    for (const x of Object.keys(S.mem.uso)) if (x.slice(0, 10) < lim) delete S.mem.uso[x];
    usoSucio = false;
    memToca();
  }
  function usoDe(dia) {
    const mio = dia + '|' + disp(), loc = usoLocal(), U = (S.mem && S.mem.uso) || {};
    let otros = 0, otrosB = 0;
    for (const k in U) if (k.slice(0, 10) === dia && k !== mio) { otros += U[k].n || 0; otrosB += U[k].b || 0; }
    const propio = dia === loc.dia ? Math.max(loc.n, (U[mio] && U[mio].n) || 0) : ((U[mio] && U[mio].n) || 0);
    const propioB = dia === loc.dia ? Math.max(loc.b || 0, (U[mio] && U[mio].b) || 0) : ((U[mio] && U[mio].b) || 0);
    return { total: otros + propio, propio, busq: otrosB + propioB };
  }
  /* Tope de búsquedas nuevas al día, entre todos los dispositivos: al llegar, la app deja de buscar y sigue otro
     día (lo ya buscado queda guardado). Se cambia en Cuentas › Ajustes. */
  const TOPES_BUSQ = [50, 100, 150, 200, 300, 500], TOPE_BUSQ = 150;
  function topeBusq() { const v = Number(ajuste('topeBusq', TOPE_BUSQ)); return TOPES_BUSQ.indexOf(v) >= 0 ? v : TOPE_BUSQ; }
  /* El último corte de Spotify: se guarda en este dispositivo y en la memoria común, para que el otro lo sepa.
     Un corte es {t, cuota, motivo, espera, hasta, ruta, fin, mano, e}: t = hora del rechazo, hasta = hasta cuándo
     los botones no envían nada, ruta = la llamada rechazada (sin parámetros), fin = cuándo volvió a responder esa
     llamada, mano = plazo escrito a mano {s, t, hasta}, e = cuándo se escribió este registro por última vez. */
  function uneCortes(a, b) {
    if (!a || !a.t) return b && b.t ? b : null;
    if (!b || !b.t) return a;
    // Rechazos distintos: manda el más reciente. El mismo rechazo visto desde dos dispositivos: lo último escrito.
    const n = a.t !== b.t ? (b.t > a.t ? b : a) : ((b.e || 0) > (a.e || 0) ? b : a), v = n === a ? b : a;
    let r = n;
    if (a.t === b.t && !r.fin && v.fin) r = Object.assign({}, r, { fin: v.fin }); // un «fin» no se pierde
    // Ni un plazo escrito a mano que acabe más tarde: un rechazo nuevo, aquí o en el otro dispositivo, no lo acorta.
    if (!r.fin && !r.mano && !v.fin && v.mano && v.mano.hasta > (r.hasta || 0)) r = Object.assign({}, r, { hasta: v.mano.hasta, mano: v.mano });
    return r;
  }
  function corteSp() {
    return uneCortes(ls.get('ss.corte'), S.mem && S.mem.ajustes && S.mem.ajustes.corteSp && S.mem.ajustes.corteSp.v);
  }
  const corteActivo = () => { const c = corteSp(); return c && !c.fin && Date.now() < c.hasta ? c : null; };
  function apuntaCorte(c) {
    c = Object.assign({}, c, { e: Date.now() });
    ls.set('ss.corte', c);
    if (S.mem && S.memLista) { S.mem.ajustes.corteSp = { v: c, t: c.e }; memToca(); }
  }
  // Si este dispositivo sabe del corte algo que la memoria común no tiene (se cerró la página antes de subirlo,
  // o se apuntó con la memoria aún sin cargar), se sube al cargarla.
  function sincronizaCorte() {
    if (!S.mem || !S.memLista) return;
    const m = S.mem.ajustes.corteSp, enMem = (m && m.v) || null, u = uneCortes(ls.get('ss.corte'), enMem);
    if (u && JSON.stringify(u) !== JSON.stringify(enMem)) { S.mem.ajustes.corteSp = { v: u, t: Date.now() }; memToca(); }
  }
  // Las llamadas se agrupan por ruta, sin el id de cada playlist.
  const grupoRuta = r => String(r || '').split('?')[0].replace(/^\/playlists\/[^/]+\//, '/playlists/*/');
  // «Probar ahora» repite la llamada que rechazó Spotify, pidiendo lo mínimo.
  function rutaPrueba(c) {
    const r = (c && c.ruta) || '/me/playlists';
    if (r === '/me') return r;
    if (r === '/search') return '/search?type=track&limit=1&q=remix';
    return r + '?limit=1';
  }
  function errorCorte(c, local) {
    const e = new Error('Límite de peticiones de Spotify' + (c.cuota ? ' (cuota agotada)' : ''));
    e.corte = c; e.local = !!local; e.status = 429; e.servicio = 'Spotify';
    return e;
  }
  function textoCorte(c, local) {
    const que = c.cuota
      ? 'Spotify ha cortado las peticiones de la app: se ha agotado la cuota del modo desarrollo.'
      : 'Spotify ha cortado las peticiones de la app por haber hecho demasiadas.';
    const esp = c.mano ? ' Según el plazo que escribiste, Spotify vuelve a ' + horaODia(c.mano.hasta) + '.'
      : c.espera != null ? ' Pide esperar ' + duracion(c.espera) + '.' : ' No dice cuánto hay que esperar; a otros les ha durado horas.';
    // La app nunca pide nada a Spotify por su cuenta: la espera solo frena los botones.
    return (local ? 'No se ha enviado nada a Spotify. ' : '') + 'A ' + horaODia(c.t) + ': ' + que + (c.escr ? ' El rechazo fue a una escritura.' : '') + esp +
      ' Hasta ' + horaODia(c.hasta) + ' los botones no envían nada a Spotify, para no alargar el corte. La app no prueba sola: después, pulsa tú. Lo ya leído se conserva.';
  }
  /* Plazo leído a mano con F12 (Retry-After, en segundos). Cuenta desde la hora del rechazo, no desde ahora.
     «seguro» = ya se ha confirmado que el número está bien aunque la hora que da haya pasado. */
  function guardaMano(seguro) {
    const campo = document.getElementById('retry-mano');
    if (campo && document.activeElement === campo) campo.blur(); // si no, la pantalla no se repinta (ver pinta)
    const c = corteSp();
    if (!c || c.fin) { // el aviso seguía en pantalla, pero ese corte ya terminó
      S.manoTxt = ''; S.manoConf = null;
      aviso('Ya no hay ningún corte de Spotify pendiente: no hace falta el plazo.');
      return;
    }
    // Retry-After es un número entero de segundos. Con puntos, comas, espacios o letras no se adivina: se rechaza.
    const txt = String(S.manoTxt || '').trim(), s = /^\d{1,6}$/.test(txt) ? parseInt(txt, 10) : 0;
    if (s < 1 || s > 7 * 86400) {
      S.manoConf = null;
      aviso('Escribe solo el número entero que pone en Retry-After, en segundos, sin puntos ni letras (por ejemplo 3600).', 'error');
      return;
    }
    const ahora = Date.now(), hasta = c.t + s * 1000;
    // Si con ese número la espera ya habría terminado, guardarlo suelta los botones: puede ser una errata. Se pregunta.
    if (hasta <= ahora && ahora < c.hasta && seguro !== true) { S.manoConf = { s, hasta }; pinta(); return; }
    apuntaCorte(Object.assign({}, c, { hasta, mano: { s, t: ahora, hasta } }));
    S.manoTxt = ''; S.manoConf = null;
    aviso(hasta > ahora
      ? 'Guardado: Spotify vuelve a ' + horaODia(hasta) + '. Hasta entonces los botones no le envían nada.'
      : 'Guardado: según ese plazo, Spotify volvía a ' + horaODia(hasta) + ', así que los botones ya vuelven a enviar. La app no prueba sola.');
  }

  // ---------------- Spotify: única puerta ----------------
  let spUltima = 0;
  /* Dos cerrojos, y ninguno se puede abrir desde fuera de este archivo:
     - permiso: lo que el usuario ha confirmado en la pantalla de sincronización. Solo lo crea sincroniza(), después
       de guardar la copia en Dropbox. Por cada playlist marcada lleva las canciones que aún pueden salir hacia ella;
       cada una se tacha al enviarla, llegue o no, así que una canción no puede salir dos veces hacia la misma
       playlist y un lote no se puede repetir.
     - pase: un lote concreto (una playlist y su lista exacta de canciones). Vale para una llamada y se gasta al
       usarlo, salga o no. */
  let permiso = null; // {hasta, copia, pls: Map(id de playlist -> Set(uris que aún pueden salir)), lotes; y en B, quita: Map(id -> Set(uris que aún se pueden quitar)), lotesQ}
  let pase = null;    // {id, uris} para añadir; {id, uris, quita: true} para quitar
  /* ¿Se puede escribir en esa playlist? Tiene que ser tuya, llamarse «NS - …» u «OG - …» y ser la pareja de una
     (y solo una) playlist de rekordbox en el mapa (C.destinoMal). Devuelve por qué no, o '' si se puede. La usan
     la puerta y la pantalla de confirmación: lo que la pantalla deja marcar es lo que la puerta deja pasar. */
  function destinoFijo(id) {
    const pl = S.lib ? S.lib.playlists.find(x => x.id === id) : null;
    const m = S.xml && S.lib ? mapaActual().mapa : {};
    return C.destinoMal(pl || null, Object.keys(m).filter(k => m[k] && m[k].id === id).length);
  }
  /* Y además: si la app escribió en esa playlist y no pudo comprobar que quedó bien (Spotify puede tardar en
     enseñar un cambio), no se vuelve a escribir en ella hasta pasados dos minutos. Así, si lo «que falta» ya está
     y aún no se ve, no se añade dos veces. */
  /* Marcas que comparten las pestañas de este navegador; se leen cada vez (no solo al arrancar), para que lo que
     apunta una pestaña lo vea la otra:
       ss.releer  = playlists cuyo contenido guardado no vale: la próxima lectura las pide a Spotify;
       ss.dudosas = playlists en las que se escribió sin poder comprobar cómo quedaron, y cuándo. */
  const marcasMem = {}; // solo las que el navegador no dejó guardar (almacenamiento lleno o bloqueado): valen para esta pestaña
  const marcas = clave => Object.assign({}, ls.get(clave) || {}, marcasMem[clave] || {});
  function ponMarca(clave, id, valor) {
    const m = ls.get(clave) || {};
    if (valor == null) delete m[id]; else m[id] = valor;
    const guardada = ls.set(clave, m), mm = marcasMem[clave] || (marcasMem[clave] = {});
    if (valor == null || guardada) delete mm[id]; else mm[id] = valor;
  }
  // Identifica esta carga de página: dos pestañas (o la misma, recargada) son dos «sesiones» distintas.
  const SESION = alAzar(4);
  function enfriando(id, desde) { // «desde»: las marcas de la sincronización en curso (posteriores a ese momento) no cuentan
    const t = marcas('ss.dudosas')[id];
    if (!t || !(Date.now() - t < ENFRIA) || (desde && t >= desde)) return '';
    return 'la app escribió en ella hace menos de dos minutos y no pudo comprobar del todo cómo quedó: espera a las ' +
      new Date(t + ENFRIA + 59000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + ' y simula otra vez';
  }
  // Las tres playlists de Soundeo (botón B): cuáles de sus papeles (all, down, try) apuntan a esa playlist en el mapa.
  function papelesDe(id) {
    if (!S.lib) return [];
    const s = soundeoActual();
    return SOUNDEO.map(x => x[0]).filter(k => s[k] && s[k].id === id);
  }
  // ¿Se puede escribir en ella como playlist de Soundeo? '' = sí (C.destinoSxMal: propia, con su nombre y con un solo papel).
  function destinoSx(id) {
    const pl = S.lib ? S.lib.playlists.find(x => x.id === id) : null, ps = papelesDe(id);
    return C.destinoSxMal(pl || null, ps[0], ps.length);
  }
  // Para añadir vale una «NS -» u «OG -» del mapa (botón A) o una de las tres de Soundeo (botón B). Para quitar, solo estas (ver spotify).
  // Con una sincronización en curso, cada botón solo puede escribir en lo suyo: A no llega a una de Soundeo ni B a una «NS -» u «OG -».
  const destinoValido = id => {
    const a = destinoFijo(id);
    const mal = permiso && permiso.b === true ? destinoSx(id) : permiso && permiso.b === false ? a : (a && papelesDe(id).length ? destinoSx(id) : a);
    return mal || enfriando(id, permiso ? permiso.desde : 0);
  };
  /* Todas las llamadas a la API de Spotify pasan por aquí. Los GET salen. De lo demás solo sale lo que aprueba
     una de las dos puertas de core.js:
       C.puerta(): POST /playlists/{id}/items a una playlist válida y confirmada, con canciones confirmadas y con
         la copia guardada (añadir);
       C.puertaQuita(): DELETE /playlists/{id}/items, solo en «Sound All», «Sound Down» o «Sound Try», solo con las
         canciones confirmadas para quitar de esa playlist (quitar). A esta puerta solo se llega con un pase de
         quitar; cualquier otro DELETE va a la de añadir, que lo rechaza.
     Lo que se envía (método, ruta y canciones) es lo que devuelve la puerta, no lo que traiga quien llama; y al
     aprobar, la puerta tacha esas canciones: no vuelven a salir. Nunca PUT. El resto se corta antes de llegar a la red.
     Una escritura nunca se reintenta sola: si falla, o si no se sabe si llegó, quien la pidió relee y compara. */
  async function spotify(metodo, ruta, opts) {
    const escribe = metodo !== 'GET';
    let destino = ruta, lote = null, quita = false;
    if (escribe) {
      const p = pase;
      pase = null; // el pase se gasta siempre, salga o no
      let g;
      if (metodo === 'DELETE' && p && p.quita === true) {
        const pl = S.lib ? S.lib.playlists.find(x => x.id === p.id) : null, ps = papelesDe(p.id);
        g = C.puertaQuita({ metodo, ruta, cuerpo: opts && opts.cuerpo, pase: p, permiso, ahora: Date.now(), leida: opts && opts.leida, concedido: tieneEscritura(),
          playlist: pl ? { nombre: pl.nombre, propia: pl.propia } : null, papel: ps[0], papeles: ps.length, enfria: enfriando(p.id, permiso ? permiso.desde : 0) });
      } else g = C.puerta({ metodo, ruta, cuerpo: opts && opts.cuerpo, pase: p, permiso, ahora: Date.now(), leida: opts && opts.leida, concedido: tieneEscritura(), destino: destinoValido });
      quita = g.quita === true;
      if (g.no || !g.ruta || !Array.isArray(g.uris)) {
        S.cont.spBloqueadas++;
        throw new Error('Bloqueado: esta versión no envía esa escritura a Spotify (' + metodo + ' ' + String(ruta).split('?')[0] + '): ' + (g.no || 'la puerta no la ha aprobado') + '.');
      }
      destino = g.ruta; lote = g.uris;
    }
    const pausa = Math.max(PAUSA_SP, (opts && opts.pausa) || 0);
    // Si Spotify cortó hace poco, no se envía nada hasta que pase el plazo (salvo la prueba de lectura que pide el usuario).
    const c0 = corteSp();
    if (c0 && !c0.fin && Date.now() < c0.hasta && !(opts && opts.aunque && !escribe)) throw errorCorte(c0, true);
    const url = 'https://api.spotify.com/v1' + destino;
    for (let intento = 0; ; intento++) {
      const falta = spUltima + pausa - Date.now();
      if (falta > 0) await espera(falta);
      spUltima = Date.now();
      const tok = await token('sp');
      // cache 'no-store': ni una lectura ni una escritura salen de la caché del navegador ni se guardan en ella.
      const ini = { method: !escribe ? 'GET' : quita ? 'DELETE' : 'POST', headers: { Authorization: 'Bearer ' + tok }, cache: 'no-store' };
      // Una petición que no responde no se queda colgada para siempre: a los 30 s se corta (y si era una escritura,
      // se trata como «no se sabe si llegó»: no se repite, se relee).
      const corta = typeof AbortController === 'function' ? new AbortController() : null;
      if (corta) ini.signal = corta.signal;
      if (escribe) {
        // Entre la aprobación y el envío hay una pausa y, a veces, renovar la sesión: si en medio ha pasado demasiado
        // (el equipo se suspendió, por ejemplo), la lectura previa ya no es «de ahora mismo» y la escritura no sale.
        if (!(Date.now() - opts.leida < FRESCA_ESCR)) throw new Error('No enviada: ha pasado demasiado tiempo desde que se releyó la playlist.');
        ini.headers['Content-Type'] = 'application/json';
        ini.body = JSON.stringify(quita ? { items: lote.map(u => ({ uri: u })) } : { uris: lote });
        S.cont.spEscr++; cuentaPeticion(); // se cuenta al enviarla: aunque falle la red, puede haber llegado
      }
      let r;
      const reloj = corta ? setTimeout(() => corta.abort(), PLAZO_SP) : null;
      try { r = await fetch(url, ini); }
      catch (e) {
        clearTimeout(reloj);
        if (escribe) {
          const err = new Error('Se cortó la conexión con Spotify al enviar la ' + (quita ? 'petición de quitar' : 'escritura'));
          err.servicio = 'Spotify'; err.incierta = true;
          throw err;
        }
        if (intento < 2) { await espera(1500 * (intento + 1)); continue; }
        throw new Error('No hay conexión con Spotify.');
      }
      clearTimeout(reloj);
      if (!escribe) { S.cont.spGet++; cuentaPeticion(); }
      if (r.status === 401 && intento < 1 && !escribe) { await refresca('sp'); continue; }
      if (r.status === 429) {
        /* Se para a la primera: insistir sobre un 429 solo alarga el corte. Se apunta lo que Spotify dice de
           verdad: el motivo que viene en el cuerpo y el plazo de la cabecera Retry-After, si el navegador la deja leer. */
        S.cont.sp429++;
        let motivo = '';
        try { const j = JSON.parse(await r.text()); motivo = String((j.error && j.error.reason) || ''); } catch (e) { /* sin cuerpo */ }
        const ra = parseInt(r.headers.get('Retry-After'), 10);
        const plazo = isFinite(ra) && ra >= 0 ? ra : null, cuota = motivo === 'QUOTA_EXCEEDED', t = Date.now();
        const c = { t, cuota, motivo, espera: plazo, hasta: t + (plazo != null ? plazo * 1000 : (cuota ? GUARDA.cuota : GUARDA.otro)), ruta: ruta.split('?')[0] };
        if (escribe) c.escr = true;
        // Un rechazo nuevo no acorta un plazo escrito a mano que acabe más tarde.
        const ant = corteSp();
        if (ant && !ant.fin && ant.mano && ant.mano.hasta > c.hasta) { c.hasta = ant.mano.hasta; c.mano = ant.mano; }
        apuntaCorte(c);
        anotaUso();
        throw errorCorte(c, false);
      }
      if (r.status >= 500 && intento < 3 && !escribe) { await espera(1200 * (intento + 1)); continue; }
      if (!r.ok) {
        let cuerpo = '';
        try { cuerpo = await r.text(); } catch (e) { /* sin cuerpo */ }
        let msg = cuerpo.slice(0, 200);
        try { const j = JSON.parse(cuerpo); msg = (j.error && (j.error.message || j.error)) || msg; } catch (e) { /* texto */ }
        const err = new Error('Spotify respondió ' + r.status + (msg ? ': ' + msg : '') + ' (' + ruta.split('?')[0] + ')');
        err.status = r.status; err.servicio = 'Spotify';
        if (escribe) { err.escritura = true; err.incierta = r.status >= 500; }
        throw err;
      }
      /* Spotify vuelve a responder: se apunta cuándo, que es lo que dice cuánto duró el corte. Solo cuenta si
         responde la misma llamada que rechazó, o la de «Probar ahora»: Spotify corta por grupos de llamadas
         y que responda otra (el perfil, por ejemplo) no dice nada. Una lectura no cierra el corte de una escritura. */
      const c1 = corteSp();
      if (c1 && !c1.fin && !!c1.escr === escribe && ((opts && opts.prueba && !escribe) || grupoRuta(c1.ruta) === grupoRuta(ruta))) apuntaCorte(Object.assign({}, c1, { fin: Date.now() }));
      if (escribe) {
        // La respuesta de una escritura puede venir sin cuerpo: que no se pueda leer no la convierte en un fallo.
        let j = null;
        try { j = await r.json(); } catch (e) { j = null; }
        return { estado: r.status, cuerpo: j };
      }
      return r.json();
    }
  }
  // Recorre una lista paginada avanzando por lo que de verdad llega (por si Spotify da menos de lo pedido).
  // «firme» = no se deja a medias aunque se pulse «Parar» (las lecturas que rodean a una escritura).
  async function paginas(ruta, alLlegar, firme) {
    let limite = 50, off = 0, total = null;
    for (;;) {
      const sep = ruta.indexOf('?') >= 0 ? '&' : '?';
      let pg;
      try { pg = await spotify('GET', ruta + sep + (limite ? 'limit=' + limite + '&' : '') + 'offset=' + off); }
      catch (e) { if (e.status === 400 && limite && off === 0) { limite = 0; continue; } throw e; }
      const its = pg.items || [];
      if (typeof pg.total === 'number') total = pg.total;
      off += its.length;
      alLlegar(its, total);
      if (!its.length || (total != null && off >= total)) break;
      if (!firme) siParar();
    }
    return total;
  }

  function itemDe(e) {
    const tr = e && (e.item || e.track);
    if (!tr) return { add: (e && e.added_at) || '', t: null, tipo: 'vacío' };
    const tipo = tr.type || 'track';
    return {
      add: e.added_at || '', tipo, local: !!(e.is_local || tr.is_local),
      t: tipo === 'track' ? C.minSp(tr) : null, uri: tr.uri || '', nombre: tr.name || '',
    };
  }
  async function leePerfil() {
    const yo = await spotify('GET', '/me');
    S.yo = { id: yo.id, nombre: yo.display_name || yo.id };
    ls.set('ss.yo', S.yo);
    return S.yo;
  }
  // Lo leído de Spotify la última vez, en Dropbox (común a PC e iPhone).
  async function libCacheCarga() {
    if (S.libCache !== undefined) return;
    let c = null;
    if (S.db) { try { const r = await dbxBaja(RUTA_LIB); if (r) c = JSON.parse(r.texto); } catch (e) { c = null; } }
    S.libCache = c && c.v === 1 && c.pls ? c : null;
    // La primera vez no hay nada guardado: se parte de la última copia completa, que lleva el sello de cada
    // playlist. Lo que haya cambiado desde entonces se detecta igual y se vuelve a pedir.
    if (!S.libCache && S.db) { try { S.libCache = await semillaDeCopia(); } catch (e) { S.libCache = null; } }
  }
  async function semillaDeCopia() {
    const cs = (await listaCarpeta('/copias', false)).filter(a => COPIA_COMPLETA.test(a.nombre)).sort((a, b) => (b.nombre > a.nombre ? 1 : -1));
    if (!cs.length) return null;
    const r = await dbxBaja(cs[0].ruta);
    const j = r && JSON.parse(r.texto);
    if (!j || !j.usuario || !j.usuario.id || !Array.isArray(j.playlists) || !Array.isArray(j.likes)) return null;
    const it = x => {
      if (!x) return { add: '', t: null, tipo: 'vacío' };
      if (!x.artistas) return { add: x.agregada || '', tipo: x.tipo || 'vacío', local: false, t: null, uri: x.uri || '', nombre: x.nombre || '' };
      const local = !!x.local, uri = x.uri || '';
      const id = !local && uri.indexOf('spotify:track:') === 0 ? uri.slice(14) : null;
      return { add: x.agregada || '', tipo: 'track', local, t: { id, u: uri, n: x.nombre || '', a: x.artistas || [], d: x.duracion_s || 0, al: x.album || '', isrc: x.isrc || '' }, uri, nombre: x.nombre || '' };
    };
    const pls = {};
    j.playlists.forEach(p => {
      if (p && p.id && p.contenido_guardado && p.snapshot_id) pls[p.id] = { snap: p.snapshot_id, total: p.total_segun_spotify != null ? p.total_segun_spotify : null, items: (p.canciones || []).map(it), contenido: true, motivo: '' };
    });
    return { v: 1, usuario: j.usuario.id, t: Date.parse(j.fecha) || Date.now(), pls, likes: { total: j.likes.length, items: j.likes.map(it) }, semilla: cs[0].nombre };
  }
  async function libCacheGuarda() {
    if (!S.db || !S.libCache) return;
    try { await dbxSube(RUTA_LIB, JSON.stringify(S.libCache), 'overwrite', false); }
    catch (e) { falla(e, 'Guardar en Dropbox lo leído de Spotify'); }
  }
  const firma = its => its.map(x => (x.uri || '') + '@' + (x.add || '')).join('|');
  /* Lee playlists y likes gastando lo mínimo. Spotify da a cada playlist un sello de versión (snapshot_id):
     solo se vuelve a pedir el contenido de la playlist cuyo sello o número de canciones haya cambiado, y los
     likes solo si cambia el total o los más recientes. «todo» = no fiarse de lo guardado y releerlo entero. */
  async function leeBiblioteca(prog, todo) {
    const antes = S.cont.spGet;
    if (!S.yo) { prog('Leyendo tu perfil de Spotify…'); await leePerfil(); }
    const yo = S.yo;
    prog('Mirando lo que ya se había leído de Spotify…');
    await libCacheCarga();
    // P = lo que había guardado de esta cuenta antes de empezar; K = de qué se fía esta lectura (de nada, si es «todo»).
    const P = S.libCache && S.libCache.usuario === yo.id ? S.libCache : null;
    const K = !todo && P ? P : { v: 1, usuario: yo.id, pls: {}, likes: null };
    const N = { v: 1, usuario: yo.id, t: Date.now(), pls: {}, likes: null };
    const L = { releidas: 0, iguales: 0, likes: '', peticiones: 0, semilla: K.semilla || '', nombres: [] };
    const playlists = [], releer = marcas('ss.releer');
    let likes = [], completa = false, cambio = !!todo || !!K.semilla;
    try {
      const crudas = [];
      await paginas('/me/playlists', (its, total) => {
        its.forEach(p => { if (p && p.id) crudas.push(p); });
        prog('Leyendo la lista de playlists…', crudas.length, total || 0);
      });
      let n = 0;
      for (const p of crudas) {
        siParar();
        n++;
        const ref = p.items || p.tracks || {};
        const pl = {
          id: p.id, nombre: p.name || '', propia: !!(p.owner && p.owner.id === yo.id), colaborativa: !!p.collaborative,
          publica: p.public, descripcion: p.description || '', snapshot: p.snapshot_id || '',
          dueno: (p.owner && (p.owner.display_name || p.owner.id)) || '', total: typeof ref.total === 'number' ? ref.total : null,
          contenido: false, motivo: '', items: [],
        };
        playlists.push(pl);
        if (!pl.propia && !pl.colaborativa) { pl.motivo = 'No es tuya: Spotify no da su contenido'; continue; }
        const g = K.pls[p.id];
        if (g && g.snap && g.snap === pl.snapshot && (pl.total == null || g.total == null || g.total === pl.total) && !releer[p.id]) {
          pl.items = g.items; pl.contenido = !!g.contenido; pl.motivo = g.motivo || '';
          if (g.total != null) pl.total = g.total;
          N.pls[p.id] = g; L.iguales++;
          prog('Comprobando playlists…', n, crudas.length);
          continue;
        }
        prog('Leyendo «' + pl.nombre + '»…', n, crudas.length);
        try {
          const total = await paginas('/playlists/' + encodeURIComponent(p.id) + '/items', its => { its.forEach(e => pl.items.push(itemDe(e))); });
          pl.contenido = true;
          if (total != null) pl.total = total;
          if (marcas('ss.releer')[p.id]) ponMarca('ss.releer', p.id, null);
        } catch (e) {
          if (e.status === 403 || e.status === 404) pl.motivo = 'Spotify no deja leerla (' + e.status + ')';
          else throw e;
        }
        N.pls[p.id] = { snap: pl.snapshot, total: pl.total, items: pl.items, contenido: pl.contenido, motivo: pl.motivo };
        L.releidas++; L.nombres.push(pl.nombre); cambio = true;
      }
      if (Object.keys(K.pls).some(id => !N.pls[id])) cambio = true; // alguna playlist guardada ya no existe
      // Likes: con la primera página basta para saber si hay cambios (los nuevos llegan arriba).
      prog('Comprobando tus likes…');
      const pg = await spotify('GET', '/me/tracks?limit=50&offset=0');
      const prim = (pg.items || []).map(itemDe), total = typeof pg.total === 'number' ? pg.total : null;
      const g = K.likes, k = g && total != null ? total - g.total : null;
      if (g && k === 0 && firma(g.items.slice(0, prim.length)) === firma(prim)) { likes = g.items; L.likes = 'sin cambios'; }
      else if (g && k > 0 && k < prim.length && firma(prim.slice(k)) === firma(g.items.slice(0, prim.length - k))) {
        likes = prim.slice(0, k).concat(g.items); L.likes = k + (k === 1 ? ' nuevo' : ' nuevos'); cambio = true;
      } else {
        likes = prim.slice();
        let off = prim.length;
        while (prim.length && (total == null || off < total)) {
          siParar();
          prog('Leyendo tus likes…', off, total || 0);
          const its = (await spotify('GET', '/me/tracks?limit=50&offset=' + off)).items || [];
          if (!its.length) break;
          its.forEach(e => likes.push(itemDe(e)));
          off += its.length;
        }
        L.likes = 'releídos'; cambio = true;
      }
      N.likes = { total: total != null ? total : likes.length, items: likes };
      completa = true;
    } finally {
      // Lo leído se conserva aunque la lectura se corte: la próxima vez no se vuelve a pedir.
      L.peticiones = S.cont.spGet - antes;
      if (cambio) {
        /* Una relectura completa («todo») que no termina no puede dejar guardado menos de lo que había: se
           conserva lo anterior y encima va lo que sí dio tiempo a releer. Si no se llegó a leer nada, no se toca. */
        const base = todo && P ? P : K;
        const nada = !completa && !!todo && !!P && !Object.keys(N.pls).length && !N.likes;
        if (!nada) {
          S.libCache = completa ? N : { v: 1, usuario: yo.id, t: Date.now(), pls: Object.assign({}, base.pls, N.pls), likes: N.likes || base.likes };
          await libCacheGuarda();
        }
      }
    }
    S.lib = { leida: Date.now(), yo: S.yo, playlists, likes, idx: null, lectura: L };
    S.c = null; S.plan = null; S.planB = null;
    return S.lib;
  }
  const textoLectura = L => (L ? 'playlists releídas ' + L.releidas + ', sin cambios ' + L.iguales + '; likes ' + L.likes + '; ' + L.peticiones + ' peticiones a Spotify' + (L.semilla ? '; partiendo de la copia ' + L.semilla : '') : '');
  function indices() {
    const lib = S.lib;
    if (lib.idx) return lib.idx;
    const porBase = new Map(), enCasa = new Set(), porPl = new Map();
    const mete = m => {
      if (!m || !m.id) return null;
      enCasa.add(m.id);
      const d = C.descSp(m);
      if (d.tit.base) { let l = porBase.get(d.tit.base); if (!l) porBase.set(d.tit.base, l = []); l.push(d); }
      return d;
    };
    lib.likes.forEach(it => mete(it.t));
    lib.playlists.forEach(p => {
      const descs = [];
      p.items.forEach(it => { const d = mete(it.t); if (d) descs.push(d); });
      porPl.set(p.id, { ids: new Set(descs.map(d => d.id)), descs });
    });
    return (lib.idx = { porBase, enCasa, porPl });
  }

  // ---------------- Dropbox ----------------
  const argCabecera = o => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
  /* La app nunca borra archivos de Dropbox: aquí no hay ninguna llamada de borrado.
     Con acceso de «carpeta de la aplicación», las rutas son relativas a esa carpeta. */
  async function dbx(tipo, endpoint, arg, cuerpo) {
    for (let intento = 0; ; intento++) {
      const tok = await token('db');
      const hd = { Authorization: 'Bearer ' + tok };
      let body;
      if (tipo === 'rpc') { hd['Content-Type'] = 'application/json'; body = JSON.stringify(arg); }
      else {
        hd['Dropbox-API-Arg'] = argCabecera(arg);
        if (tipo === 'sube') { hd['Content-Type'] = 'application/octet-stream'; body = cuerpo; }
      }
      let r;
      try { r = await fetch((tipo === 'rpc' ? 'https://api.dropboxapi.com/2/' : 'https://content.dropboxapi.com/2/') + endpoint, { method: 'POST', headers: hd, body }); }
      catch (e) {
        if (intento < 2) { await espera(1500 * (intento + 1)); continue; }
        throw new Error('No hay conexión con Dropbox.');
      }
      S.cont.db++;
      if (r.status === 401 && intento < 1) {
        let j = null;
        try { j = await r.clone().json(); } catch (e) { /* nada */ }
        if (!(j && j.error && j.error['.tag'] === 'missing_scope')) { await refresca('db'); continue; }
      }
      if ((r.status === 429 || r.status >= 500) && intento < 4) {
        await espera(((parseInt(r.headers.get('Retry-After'), 10) || Math.pow(2, intento)) + 0.5) * 1000);
        continue;
      }
      if (!r.ok) {
        let txt = '', j = null;
        try { txt = await r.text(); j = JSON.parse(txt); } catch (e) { /* texto */ }
        const err = new Error('Dropbox respondió ' + r.status + ': ' + ((j && j.error_summary) || txt.slice(0, 200) || endpoint));
        err.status = r.status; err.servicio = 'Dropbox'; err.resumen = (j && j.error_summary) || ''; err.datos = j;
        throw err;
      }
      return r;
    }
  }
  const dbxRpc = async (endpoint, arg) => (await dbx('rpc', endpoint, arg)).json();
  async function dbxBaja(ruta) {
    let r;
    try { r = await dbx('baja', 'files/download', { path: ruta }); }
    catch (e) { if (e.status === 409 && /not_found/.test(e.resumen || '')) return null; throw e; }
    let meta = null;
    try { meta = JSON.parse(r.headers.get('Dropbox-API-Result')); } catch (e) { /* cabecera no visible */ }
    const texto = await r.text();
    if (!meta) { try { meta = await dbxRpc('files/get_metadata', { path: ruta }); } catch (e) { meta = null; } }
    return { texto, meta };
  }
  // modo: 'add' (archivo nuevo; nunca pisa otro) | {'.tag':'update', update: rev} | 'overwrite' (solo la caché).
  async function dbxSube(ruta, texto, modo, renombrar) {
    const bytes = new TextEncoder().encode(texto);
    const r = await dbx('sube', 'files/upload', { path: ruta, mode: modo, autorename: !!renombrar, mute: true, strict_conflict: false }, bytes);
    const meta = await r.json();
    if (typeof meta.size === 'number' && meta.size !== bytes.length) throw new Error('Dropbox guardó ' + meta.size + ' bytes y se enviaron ' + bytes.length + '.');
    return meta;
  }
  async function listaCarpeta(ruta, recursiva) {
    const out = [];
    let r;
    try { r = await dbxRpc('files/list_folder', { path: ruta, recursive: !!recursiva, limit: 1000 }); }
    catch (e) { if (e.status === 409 && /not_found/.test(e.resumen || '')) return out; throw e; }
    for (;;) {
      out.push(...r.entries);
      if (!r.has_more) break;
      r = await dbxRpc('files/list_folder/continue', { cursor: r.cursor });
    }
    return out.filter(e => e['.tag'] === 'file')
      .map(e => ({ ruta: e.path_display, baja: e.path_lower, nombre: e.name, tam: e.size, fecha: e.client_modified || e.server_modified, servidor: e.server_modified }));
  }

  // ---------------- memoria de la app (en Dropbox, común a PC e iPhone) ----------------
  // «sx» = el registro del botón B: qué canción puso o emparejó la app en cada playlist de Soundeo, por favorito.
  const SECCIONES = ['mapa', 'soundeo', 'decisiones', 'ocultas', 'pares', 'ajustes', 'uso', 'sx'];
  function memVacia() { const m = { v: 1 }; SECCIONES.forEach(s => { m[s] = {}; }); return m; }
  // Une dos memorias: en cada dato gana el más reciente.
  function fusiona(a, b) {
    const m = memVacia();
    for (const s of SECCIONES) {
      const A = (a && a[s]) || {}, B = (b && b[s]) || {};
      for (const k of new Set(Object.keys(A).concat(Object.keys(B)))) {
        const x = A[k], y = B[k];
        m[s][k] = !x ? y : !y ? x : ((y.t || 0) > (x.t || 0) ? y : x);
        // El corte de Spotify se une con su propia regla: así no se pierde el «fin» que apuntó el otro dispositivo.
        if (s === 'ajustes' && k === 'corteSp' && x && y) m[s][k] = { v: uneCortes(x.v, y.v), t: Math.max(x.t || 0, y.t || 0) };
      }
    }
    return m;
  }
  async function memCarga() {
    const r = await dbxBaja(RUTA_MEM);
    if (r) { S.mem = fusiona(JSON.parse(r.texto), S.mem); S.memRev = (r.meta && r.meta.rev) || null; }
    else { S.mem = fusiona(S.mem, null); S.memRev = null; }
    S.memLista = true;
    sxRecupera();
    sincronizaCorte();
  }
  /* El registro de B (sección «sx») se guarda también en este navegador. Hasta la v0.4.0 la app no conocía esa sección
     y, al guardar la memoria, la dejaba fuera: una pestaña antigua abierta en otro dispositivo borraría el registro.
     Y si un guardado en Dropbox falla, lo apuntado no se pierde. Al cargar, lo que aquí sea más reciente vuelve. */
  const SX_LOCAL = 'ss.sx.reg';
  function sxGuardaLocal() { if (S.mem) ls.set(SX_LOCAL, S.mem.sx || {}); }
  function sxRecupera() {
    const g = ls.get(SX_LOCAL);
    let n = 0;
    if (g && typeof g === 'object') {
      Object.keys(g).forEach(id => {
        const x = S.mem.sx[id], y = g[id];
        if (y && typeof y === 'object' && (!x || (y.t || 0) > (x.t || 0))) { S.mem.sx[id] = y; n++; }
      });
    }
    if (n) { S.sxRecuperados = (S.sxRecuperados || 0) + n; memToca(); }
    sxGuardaLocal();
  }
  async function aseguraMem() { if (!S.memLista) await memCarga(); }
  let memReloj = null, memOcupada = false, memSucia = false;
  function memToca() {
    memSucia = true;
    clearTimeout(memReloj);
    memReloj = setTimeout(memGuarda, 1200);
  }
  async function memGuarda() {
    if (!S.db || !S.mem || !S.memLista) return;
    if (memOcupada) { memToca(); return; }
    memOcupada = true; memSucia = false;
    const sube = () => dbxSube(RUTA_MEM, JSON.stringify(S.mem), S.memRev ? { '.tag': 'update', update: S.memRev } : 'add', false);
    try {
      S.mem.actualizado = new Date().toISOString();
      S.mem.app = 'SynchroSound ' + VERSION;
      try { S.memRev = (await sube()).rev; }
      catch (e) {
        if (!(e.status === 409 && /conflict/.test(e.resumen || ''))) throw e;
        // Otro dispositivo guardó antes: se baja, se une y se vuelve a subir.
        const r = await dbxBaja(RUTA_MEM);
        if (r) { S.mem = fusiona(JSON.parse(r.texto), S.mem); S.memRev = (r.meta && r.meta.rev) || null; }
        S.memRev = (await sube()).rev;
        pinta(); // lo unido puede cambiar lo que se ve (p. ej. un plazo escrito en el otro dispositivo)
      }
    } catch (e) { falla(e, 'Guardar la memoria en Dropbox'); }
    finally { memOcupada = false; if (memSucia) memToca(); }
  }
  function ajuste(k, def) { const a = S.mem && S.mem.ajustes[k]; return a && a.v != null ? a.v : def; }
  function ponAjuste(k, v) { if (!S.mem) return; S.mem.ajustes[k] = { v, t: Date.now() }; memToca(); }

  async function cacheCarga() {
    if (S.cache) return;
    let c = null;
    try { const r = await dbxBaja(RUTA_CACHE); if (r) c = JSON.parse(r.texto); } catch (e) { c = null; }
    S.cache = c && c.q ? c : { v: 1, q: {} };
  }
  async function cacheGuarda() {
    if (!S.cacheSucia || !S.cache) return;
    const lim = Date.now() - 45 * 864e5;
    for (const k of Object.keys(S.cache.q)) if (S.cache.q[k].t < lim) delete S.cache.q[k];
    try { await dbxSube(RUTA_CACHE, JSON.stringify(S.cache), 'overwrite', false); S.cacheSucia = false; }
    catch (e) { falla(e, 'Guardar la caché de búsquedas'); }
  }

  // ---------------- XML de rekordbox (solo se lee) ----------------
  async function cargaXml(ruta) {
    const r = await dbxBaja(ruta);
    if (!r) throw new Error('No encuentro «' + ruta + '» en la carpeta de SynchroSound en Dropbox.');
    const doc = new DOMParser().parseFromString(r.texto, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('«' + ruta + '» no se puede leer como XML.');
    const datos = C.leeRekordbox(doc);
    S.xml = { ruta, fecha: (r.meta && (r.meta.client_modified || r.meta.server_modified)) || '', visto: Date.now(), tam: r.texto.length, datos };
    S.sim = null; S.plan = null;
    return S.xml;
  }
  const pareceXml = a => !/^\/(copias|memoria|registro|soundeo)\//.test(a.baja) && (/\.xml$/i.test(a.nombre) || !/\.[a-z0-9]{1,5}$/i.test(a.nombre));

  // ---------------- mapa de playlists ----------------
  function plsSp() { return S.lib ? S.lib.playlists.map(p => ({ id: p.id, nombre: p.nombre, propia: p.propia })) : []; }
  function mapaActual() {
    const pls = plsSp();
    const delMapa = S.xml ? S.xml.datos.delMapa : [];
    const prop = C.propMapa(delMapa, pls);
    const mapa = {};
    for (const pl of delMapa) {
      const g = S.mem && S.mem.mapa[pl.clave];
      const viva = g && g.id && pls.find(p => p.id === g.id);
      if (g && g.id === null) mapa[pl.clave] = null;
      else if (viva) mapa[pl.clave] = { id: viva.id, nombre: viva.nombre, manual: true };
      else mapa[pl.clave] = prop.mapa[pl.clave];
    }
    return { mapa, ambiguas: prop.ambiguas };
  }
  const SOUNDEO = [['all', 'Sound All'], ['down', 'Sound Down'], ['try', 'Sound Try']];
  function soundeoActual() {
    const out = {};
    if (!S.lib) return out;
    for (const [k, nombre] of SOUNDEO) {
      const g = S.mem && S.mem.soundeo[k];
      let p = g && g.id ? S.lib.playlists.find(x => x.id === g.id) : null;
      if (!p && !(g && g.id === null)) { const c = C.buscaPorNombre(plsSp(), nombre); p = c ? S.lib.playlists.find(x => x.id === c.id) : null; }
      out[k] = p || null;
    }
    return out;
  }
  // Playlists de Spotify que cuentan como «repartida»: las del mapa y las tuyas que se llamen «NS - …» u «OG - …».
  function repartidoras() {
    const ids = new Set();
    Object.values(mapaActual().mapa).forEach(x => { if (x && x.id) ids.add(x.id); });
    S.lib.playlists.forEach(p => { if (p.propia && /^\s*(NS|OG)\s+-\s/i.test(p.nombre)) ids.add(p.id); });
    return S.lib.playlists.filter(p => ids.has(p.id));
  }

  // ---------------- botón A: simulación ----------------
  async function busca(q) {
    const c = S.cache.q[q], ahora = Date.now();
    /* Una búsqueda ya hecha vale entre 30 y 40 días si dio resultados y entre 14 y 21 (dos o tres semanas) si no
       dio ninguno. El plazo depende del texto buscado para que no caduquen todas el mismo día y haya que
       repetirlas de golpe. */
    let h = 0;
    for (let i = 0; i < q.length; i++) h = (h * 31 + q.charCodeAt(i)) % 1000;
    if (c && ahora - c.t < (c.r.length ? 30 + h / 100 : 14 + h * 7 / 1000) * 864e5) { S.cont.deCache++; return c.r; }
    // Tope diario: una búsqueda nueva no sale si hoy ya se han hecho las que tocan (ver resuelve).
    if (usoDe(hoy()).busq >= topeBusq()) { const e = new Error('Hoy ya se han hecho las ' + topeBusq() + ' búsquedas nuevas del tope diario.'); e.tope = true; throw e; }
    cuentaBusqueda(); // se cuenta al enviarla, responda Spotify o no
    let its = [];
    try {
      const j = await spotify('GET', '/search?type=track&limit=10&q=' + encodeURIComponent(q), { pausa: 350 });
      its = ((j.tracks && j.tracks.items) || []).filter(t => t && t.id).map(C.minSp);
    } catch (e) {
      if (e.status !== 400 && e.status !== 404) throw e; // una búsqueda rara no para la simulación
      S.errores.push({ t: new Date().toISOString(), donde: 'Búsqueda «' + q + '»', m: e.message, s: e.status });
    }
    S.cache.q[q] = { t: ahora, r: its };
    S.cacheSucia = true;
    S.cont.busquedas++;
    return its;
  }
  // Parte sin red: junta candidatas de su biblioteca, elige y mira si ya está en cada playlist de destino.
  function reevalua(u, idx) {
    const rb = u.rb, dec = S.mem.decisiones[rb.clave] || null;
    const rech = new Set((dec && dec.no) || []);
    if (!u.cands) u.cands = new Map();
    const mete = d => { if (d && d.uri && d.id && !u.cands.has(d.uri)) u.cands.set(d.uri, d); };
    (idx.porBase.get(rb.tit.base) || []).forEach(mete);
    const par = S.mem.pares[rb.clave];
    if (par && par.m && par.mv === C.MATCHER) mete(C.descSp(par.m));
    if (dec && dec.si && dec.m) mete(C.descSp(dec.m));
    for (const d of u.destinos) {
      d.ya = null;
      const pl = d.spId && idx.porPl.get(d.spId);
      if (!pl) continue;
      const y = C.yaEsta(rb, pl.descs, rech);
      if (y) { d.ya = y; mete(y.sp); }
    }
    u.elegida = null; u.dudosas = []; u.porTi = false;
    if (dec && dec.si && u.cands.has(dec.si)) {
      const sp = u.cands.get(dec.si);
      u.elegida = { sp, r: Object.assign(C.puntua(rb, sp), { clase: 'seguro', nota: 'Confirmada por ti', motivos: [] }) };
      u.porTi = true;
    } else {
      const e = C.elige(rb, Array.from(u.cands.values()), { rechazadas: rech, enCasa: idx.enCasa });
      u.elegida = e.seguro; u.dudosas = dec && dec.nada ? [] : e.dudosas;
    }
    for (const d of u.destinos) {
      const pl = d.spId && idx.porPl.get(d.spId);
      if (pl && u.elegida && pl.ids.has(u.elegida.sp.id)) d.ya = { sp: u.elegida.sp, r: u.elegida.r };
    }
    const conDestino = u.destinos.filter(d => d.spId);
    u.estado = conDestino.length && conDestino.every(d => d.ya) ? 'ya' : u.elegida ? 'add' : u.dudosas.length ? 'duda' : 'no';
    // «pend» = se quedó sin buscar por el tope diario: ni se añade ni se da por «no está» hasta que se busque.
    if (u.pend && u.estado !== 'ya' && !u.porTi) u.estado = 'pend';
    u.decidida = !!(dec && (dec.si || dec.nada || (dec.no && dec.no.length)));
    u.ninguna = !!(dec && dec.nada);
  }
  function versionBien(rb, el) {
    if (el.r.dd <= 10) return true;
    return !!rb.tit.ver.largo && el.sp.tit.ver.largo === rb.tit.ver.largo && el.r.dd <= 45;
  }
  /* Con el tope diario alcanzado, lo que se resuelve con la biblioteca o con búsquedas ya guardadas sigue
     saliendo; la canción que necesitaría una búsqueda nueva queda «pend» y se busca otro día. */
  async function resuelve(u, idx) {
    u.pend = false;
    try { await resuelveBuscando(u, idx); }
    catch (e) {
      if (!e.tope) throw e;
      u.pend = true; S.cont.tope++;
      reevalua(u, idx);
    }
  }
  async function resuelveBuscando(u, idx) {
    reevalua(u, idx);
    if (u.estado === 'ya' || u.porTi) return;
    if (u.elegida && versionBien(u.rb, u.elegida)) return;
    const mete = m => { const d = C.descSp(m); if (d.uri && d.id && !u.cands.has(d.uri)) u.cands.set(d.uri, d); };
    const qs = C.consultas(u.rb);
    u.consultas = qs.slice();
    for (const q of qs) {
      (await busca(q)).forEach(mete);
      reevalua(u, idx);
      if (u.elegida) break;
    }
    // Antes de conformarse con una versión corta, se busca la Extended a propósito: cuando el título de
    // rekordbox lo dice, o cuando la de Spotify dura más de un minuto menos que el archivo.
    const el = u.elegida, rb = u.rb;
    if (el && el.sp.tit.ver.largo !== 'ext' && rb.tit.ver.largo !== 'radio' &&
        ((rb.tit.ver.largo === 'ext' && el.r.dd > 10) || (rb.dur && el.sp.dur && rb.dur - el.sp.dur > 60))) {
      const q = C.consultaExtended(rb);
      if (qs.indexOf(q) < 0) { u.consultas.push(q); S.cont.ext++; (await busca(q)).forEach(mete); reevalua(u, idx); }
    }
  }
  async function simula(prog, fresca) {
    if (!S.db || !S.sp) throw new Error('Conecta Dropbox y Spotify en Cuentas.');
    if (!S.xml) throw new Error('Elige el XML de rekordbox en Cuentas.');
    await aseguraMem();
    prog('Bajando el XML de rekordbox…');
    await cargaXml(S.xml.ruta);
    S.plan = null;
    // «vieja» = la app ha escrito en Spotify después de esa lectura: se vuelve a comprobar aunque sea reciente.
    if (!S.lib || fresca || S.lib.vieja || Date.now() - S.lib.leida > 15 * 60000) await leeBiblioteca(prog);
    prog('Preparando…');
    await cacheCarga();
    const idx = indices(), X = S.xml.datos, mapa = mapaActual().mapa;
    const unicas = new Map();
    for (const pl of X.delMapa) {
      const dest = mapa[pl.clave];
      for (const id of pl.ids) {
        const p = X.pistas.get(id);
        if (!p || p.ign) continue;
        let u = unicas.get(id);
        if (!u) unicas.set(id, u = { rb: C.descRb(p), destinos: [] });
        u.destinos.push({ clave: pl.clave, spId: (dest && dest.id) || null });
      }
    }
    // «lib» dice con qué lectura de Spotify se ha hecho: solo se sincroniza si sigue siendo la misma.
    const sim = { fecha: Date.now(), xmlFecha: S.xml.fecha, lib: S.lib.leida, unicas: Array.from(unicas.values()), hechas: 0, incompleta: true, mapa };
    migraClaves(sim.unicas);
    S.sim = sim;
    try {
      for (const u of sim.unicas) {
        siParar();
        prog('Buscando coincidencias…', sim.hechas, sim.unicas.length);
        await resuelve(u, idx);
        sim.hechas++;
      }
      sim.incompleta = false;
    } finally {
      sim.unicas.forEach(u => { if (!u.estado) reevalua(u, idx); });
      guardaPares(sim);
      await cacheGuarda();
    }
    if (!cuenta(sim).add && cuenta(sim).duda) S.simFiltro = 'duda';
    return sim;
  }
  // Lo emparejado se recuerda (memoria común): la próxima simulación no vuelve a buscarlo.
  function guardaPares(sim) {
    const ahora = Date.now();
    for (const u of sim.unicas) {
      if (u.estado !== 'ya' && u.estado !== 'add') continue;
      const sp = u.elegida ? u.elegida.sp : (u.destinos.find(d => d.ya) || {}).ya.sp;
      const ant = S.mem.pares[u.rb.clave];
      if (!ant || !ant.m || ant.m.u !== sp.uri || ant.mv !== C.MATCHER || ant.c !== u.estado) {
        S.mem.pares[u.rb.clave] = { m: sp.m, c: u.estado, mv: C.MATCHER, t: ahora };
        memSucia = true;
      }
    }
    if (memSucia) memToca();
  }
  function cuenta(sim) {
    const c = { ya: 0, add: 0, duda: 0, no: 0, pend: 0, mano: 0 };
    sim.unicas.forEach(u => { if (u.estado) c[u.estado]++; });
    return c;
  }
  // Estado de una canción dentro de una playlist concreta.
  const estadoEn = (u, d) => (d.ya ? 'ya' : d.mano ? 'mano' : u.estado === 'pend' ? 'pend' : u.elegida ? 'add' : u.dudosas.length ? 'duda' : 'no');
  function porPlaylist(sim) {
    const out = new Map();
    (S.xml ? S.xml.datos.delMapa : []).forEach(pl => out.set(pl.clave, { pl, ya: 0, add: 0, duda: 0, no: 0, pend: 0, total: 0 }));
    sim.unicas.forEach(u => u.destinos.forEach(d => {
      const f = out.get(d.clave);
      if (!f || !u.estado) return;
      f[estadoEn(u, d)]++; f.total++;
    }));
    return Array.from(out.values());
  }
  function decide(u, uri, si) {
    const d = S.mem.decisiones[u.rb.clave] || { si: null, m: null, no: [] };
    if (si === null) { d.si = null; d.m = null; d.no = []; d.nada = false; }
    else if (si) { d.si = uri; d.m = u.cands.get(uri).m; }
    else {
      // «No es» descarta también las copias idénticas de esa canción en otros discos.
      const igual = C.aspecto(u.cands.get(uri));
      u.cands.forEach((sp, k) => { if ((k === uri || C.aspecto(sp) === igual) && d.no.indexOf(k) < 0) d.no.push(k); });
      if (d.si && d.no.indexOf(d.si) >= 0) { d.si = null; d.m = null; }
    }
    d.t = Date.now();
    S.mem.decisiones[u.rb.clave] = d;
    memToca();
    S.plan = null; S.planB = null; // cambia lo que se añadiría: la sincronización hay que prepararla otra vez
    reevalua(u, indices());
    otrasIguales(u);
    replanB(S.simB);
    pinta();
  }
  // La misma canción puede estar en la simulación de A y en la de B (comparten respuestas): se repasa en las dos.
  function otrasIguales(u) {
    [S.sim, S.simB].forEach(sim => { if (sim) sim.unicas.forEach(x => { if (x !== u && x.rb.clave === u.rb.clave) reevalua(x, indices()); }); });
  }

  // Las seguras se repasan mejor con las de aviso arriba: primero las que en Spotify duran más que el
  // archivo (lo menos habitual), luego el resto de avisos de mayor a menor diferencia de duración.
  const riesgoDe = u => (u.porTi || !u.elegida ? 0 : (u.elegida.r.riesgo || 0));
  function porRiesgo(lista) {
    return lista.map((u, i) => ({ u, i, k: riesgoDe(u), dd: (u.elegida && u.elegida.r.dd) || 0 }))
      .sort((a, b) => (b.k - a.k) || (a.k ? b.dd - a.dd : 0) || (a.i - b.i)).map(x => x.u);
  }
  // «Ninguna es»: descarta todas las candidatas a la vista y deja de preguntar por esa canción.
  // Si más adelante Spotify devuelve una coincidencia segura, esa sí se propone.
  function ninguna(u) {
    const d = S.mem.decisiones[u.rb.clave] || { si: null, m: null, no: [] };
    const vistas = new Set(u.dudosas.map(x => C.aspecto(x.sp)));
    u.cands.forEach((sp, k) => { if (vistas.has(C.aspecto(sp)) && d.no.indexOf(k) < 0) d.no.push(k); });
    d.si = null; d.m = null; d.nada = true; d.t = Date.now();
    S.mem.decisiones[u.rb.clave] = d;
    memToca();
    S.plan = null; S.planB = null;
    reevalua(u, indices());
    otrasIguales(u);
    replanB(S.simB);
    aviso('Hecho. «' + u.rb.nombre + '» pasa a «' + CAT[u.estado] + '» y no se volverá a preguntar; ahí puedes deshacerlo.');
  }
  // «No es» sobre una pareja que la app daba por buena (segura o «ya está»).
  function descarta(u, sp) {
    const antes = u.estado;
    decide(u, sp.uri, false);
    aviso(u.estado === antes
      ? 'Descartada. Para «' + u.rb.nombre + '» queda otra canción de Spotify: mírala.'
      : 'Descartada. «' + u.rb.nombre + '» pasa a «' + CAT[u.estado] + '»; ahí puedes deshacerlo.');
  }

  // ---------------- botón B: Soundeo ----------------
  /* Los favoritos (★) y las descargas de Soundeo los lee el lector (userscript/) en el iPhone y llegan aquí
     dentro de un enlace. Esta versión los recibe, los comprueba, los guarda en Dropbox (soundeo/) y simula:
     no escribe en Spotify. La puerta de Spotify no sabe nada de las playlists de Soundeo, así que no deja
     pasar nada hacia ellas. */
  const SX_ENTRADA = 'https://soundeo.com/account/favorites';
  const SX_CARPETA = '/soundeo';
  const SX_PLAZO = 30 * 60000;    // lo que vale la marca de «Leer Soundeo»
  const SX_VIEJA = 24 * 3600000;  // a partir de aquí la lista se da por vieja
  const SX_LECTOR = 'userscript/synchrosound-lector.user.js';
  const favoritos = n => n + (n === 1 ? ' favorito' : ' favoritos');
  function textoLista(l) {
    const baj = C.sxDescargadas(l), nb = l.fav.filter(f => baj.has(f[0])).length;
    return favoritos(l.fav.length) + ', ' + nb + (nb === 1 ? ' descargado' : ' descargados');
  }
  function sxAvisos(l) {
    const m = C.sxMotivos(l);
    if (Date.now() - l.t > SX_VIEJA) m.push('se leyó hace más de 24 horas');
    return m;
  }
  // «Leer Soundeo»: apunta una marca de un solo uso y abre Soundeo con ella. Allí el lector lee y devuelve la lista.
  async function leerSoundeo() {
    const n = alAzar(16);
    if (!ls.set('ss.sx.pide', { n, t: Date.now() })) { aviso('Este navegador no deja guardar la marca de la lectura (¿navegación privada?).', 'error'); return; }
    // Se sale de la página: lo que la memoria tuviera pendiente de guardar en Dropbox se guarda antes.
    if (memSucia) { clearTimeout(memReloj); try { await memGuarda(); } catch (e) { /* memGuarda ya avisa */ } }
    location.href = SX_ENTRADA + '#synchrosound=' + n;
  }
  function deB64url(t) {
    const b = atob(t.replace(/-/g, '+').replace(/_/g, '/')), u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
  async function infla(bytes) {
    const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter();
    w.write(bytes).catch(() => {}); w.close().catch(() => {});
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  /* La vuelta de Soundeo: #soundeo=1.<marca>.<z|j>.<nº de favoritos>.<suma>.<datos>. Solo se acepta si la marca
     es la que pidió este navegador hace menos de media hora, y vale una vez. Lo que llega es texto: se comprueba
     su forma entera (C.sxValida) y en pantalla se pinta siempre como texto. */
  async function vueltaSoundeo() {
    const m = /^#soundeo=(.*)$/.exec(location.hash || '');
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    const rechaza = por => aviso('La lista de Soundeo no se ha aceptado: ' + por + ' No se ha guardado nada. Pulsa «Leer Soundeo» otra vez.', 'error');
    const p = m[1].split('.');
    if (m[1].length > 3000000 || p.length !== 6 || p[0] !== '1' || !/^[zj]$/.test(p[2]) || !/^\d{1,5}$/.test(p[3]) || !/^[0-9a-f]{8}$/.test(p[4]) || !/^[A-Za-z0-9_-]+$/.test(p[5])) {
      rechaza('el enlace no tiene la forma esperada (puede haber llegado cortado).'); return;
    }
    const pide = ls.get('ss.sx.pide');
    if (!pide || typeof pide.n !== 'string' || pide.n !== p[1]) { rechaza('no corresponde a una lectura pedida desde este navegador.'); return; }
    ls.del('ss.sx.pide'); // la marca vale una vez
    if (Date.now() - pide.t > SX_PLAZO) { rechaza('se pidió hace más de media hora.'); return; }
    let o;
    try {
      let bytes = deB64url(p[5]);
      if (p[2] === 'z') bytes = await infla(bytes);
      const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (C.sxSuma(json) !== p[4]) { rechaza('la suma de control no cuadra (el enlace ha llegado cortado o cambiado).'); return; }
      o = JSON.parse(json);
    } catch (e) { rechaza('no se puede leer (' + ((e && e.message) || e) + ').'); return; }
    const v = C.sxValida(o);
    if (v.error) { rechaza(v.error + '.'); return; }
    if (o.n !== p[1] || v.lista.fav.length !== Number(p[3])) { rechaza('el recuento no cuadra.'); return; }
    if (v.lista.t < pide.t - 60000 || v.lista.t > Date.now() + 60000) { rechaza('la hora de la lectura no cuadra con la petición.'); return; }
    S.sxLlegada = { lista: v.lista, recibida: Date.now() };
    ls.set('ss.sx.llegada', S.sxLlegada);
    S.vista = 'b'; ls.set('ss.vista', 'b');
    aviso('Lista de Soundeo recibida: ' + textoLista(v.lista) + '.');
  }
  const nombreLista = t => { const d = new Date(t); return 'soundeo-' + d.getFullYear() + dos(d.getMonth() + 1) + dos(d.getDate()) + '-' + dos(d.getHours()) + dos(d.getMinutes()) + dos(d.getSeconds()) + '.json'; };
  // La lista recién llegada se guarda como archivo nuevo (nunca pisa otro): cada lectura queda como copia de sus favoritos.
  async function sxGuardaLlegada() {
    const ll = S.sxLlegada;
    if (!ll || !S.db) return false;
    const v = C.sxValida(ll.lista); // viene del navegador (localStorage): se comprueba otra vez
    if (v.error) { S.sxLlegada = null; ls.del('ss.sx.llegada'); throw new Error('La lista recibida no se puede usar: ' + v.error + '.'); }
    const cuerpo = Object.assign({ app: 'SynchroSound ' + VERSION, recibida: new Date(ll.recibida || Date.now()).toISOString(), dispositivo: disp() }, v.lista);
    const meta = await dbxSube(SX_CARPETA + '/' + nombreLista(v.lista.t), JSON.stringify(cuerpo), 'add', true);
    S.sx = { ruta: meta.path_display || (SX_CARPETA + '/' + nombreLista(v.lista.t)), lista: v.lista, visto: Date.now() };
    S.sxLlegada = null; ls.del('ss.sx.llegada');
    S.sxMirado = true; S.simB = null; S.planB = null;
    aviso('Lista de Soundeo guardada en Dropbox: ' + S.sx.ruta + '.');
    return true;
  }
  // La lista más reciente de las guardadas en Dropbox (el nombre lleva fecha y hora).
  async function sxCarga() {
    const arch = (await listaCarpeta(SX_CARPETA, false)).filter(a => /^soundeo-\d{8}-\d{6}( \(\d+\))?\.json$/.test(a.nombre)).sort((a, b) => (a.nombre < b.nombre ? 1 : a.nombre > b.nombre ? -1 : 0));
    S.sxMirado = true;
    if (!arch.length) { S.sx = null; S.simB = null; S.planB = null; return null; }
    if (S.sx && S.sx.ruta === arch[0].ruta) { S.sx.visto = Date.now(); return S.sx; }
    const r = await dbxBaja(arch[0].ruta);
    let v;
    try { v = r ? C.sxValida(JSON.parse(r.texto)) : { error: 'no se ha podido bajar' }; } catch (e) { v = { error: 'no es JSON' }; }
    if (v.error) throw new Error('La lista «' + arch[0].ruta + '» no se puede usar: ' + v.error + '.');
    S.sx = { ruta: arch[0].ruta, lista: v.lista, visto: Date.now() };
    S.simB = null; S.planB = null;
    return S.sx;
  }
  let sxMirando = false;
  // Sin bloquear la pantalla: guarda la lista recién llegada, si la hay, o mira cuál es la última de Dropbox.
  function sxMira(aposta) {
    if (!S.db || sxMirando || S.tarea || (S.sxMirado && !aposta && !S.sxLlegada)) return;
    sxMirando = true;
    (async () => {
      try { await aseguraMem(); if (!(S.sxLlegada && await sxGuardaLlegada())) await sxCarga(); }
      catch (e) { S.sxMirado = true; falla(e, 'La lista de Soundeo en Dropbox'); }
      finally { sxMirando = false; pinta(); }
    })();
  }
  // Una canción cuya clave ha cambiado con esta versión (llevaba «´» o parecido): lo que la memoria guardaba con la
  // clave antigua («No es», «Añadir», su pareja) se copia a la nueva. Se copia, no se mueve: otra versión aún puede leerla.
  function migraClaves(unicas) {
    let n = 0;
    unicas.forEach(u => {
      const v = u.rb.claveVieja, k = u.rb.clave;
      if (!v) return;
      ['decisiones', 'pares'].forEach(sec => { const M = S.mem[sec]; if (M && M[v] && !M[k]) { M[k] = M[v]; n++; } });
    });
    if (n) memToca();
    return n;
  }
  async function simulaB(prog, fresca) {
    if (!S.db || !S.sp) throw new Error('Conecta Dropbox y Spotify en Cuentas.');
    await aseguraMem();
    prog('Buscando la lista de Soundeo…');
    while (sxMirando) await espera(100); // si ya se estaba guardando o mirando, se espera: así no se guarda dos veces
    if (!(S.sxLlegada && await sxGuardaLlegada())) await sxCarga();
    if (!S.sx) throw new Error('Todavía no hay ninguna lista de Soundeo. Pulsa «Leer Soundeo» en el iPhone.');
    if (!S.lib || fresca || S.lib.vieja || Date.now() - S.lib.leida > 15 * 60000) await leeBiblioteca(prog);
    prog('Preparando…');
    await cacheCarga();
    S.planB = null;
    const idx = indices(), L = S.sx.lista, baj = C.sxDescargadas(L), pls = soundeoActual(), reg = S.mem.sx || {};
    const dest = k => ({ clave: k, spId: pls[k] ? pls[k].id : null, nombre: pls[k] ? pls[k].nombre : SOUNDEO.find(x => x[0] === k)[1] + ' (sin pareja)' });
    // Cada favorito va a Sound All y, además, a Sound Down si está descargado (o lo estuvo: nunca vuelve de Down a Try) o a Sound Try si no.
    const unicas = L.fav.map(f => ({ rb: C.descRb(C.sxPista(f)), sx: { id: f[0], texto: f[1], baj: baj.has(f[0]), sinPublicar: f[3] === 2 },
      destinos: [dest('all'), dest(C.sxDestino(baj.has(f[0]), reg[f[0]]))] }));
    const sim = { fecha: Date.now(), lista: S.sx.ruta, listaT: L.t, lib: S.lib.leida, unicas, hechas: 0, incompleta: true,
      pls: { all: pls.all ? pls.all.id : null, down: pls.down ? pls.down.id : null, try: pls.try ? pls.try.id : null } };
    migraClaves(sim.unicas);
    S.simB = sim;
    try {
      for (const u of sim.unicas) {
        siParar();
        prog('Buscando coincidencias…', sim.hechas, sim.unicas.length);
        await resuelve(u, idx);
        sim.hechas++;
      }
      sim.incompleta = false;
    } finally {
      sim.unicas.forEach(u => { if (!u.estado) reevalua(u, idx); });
      replanB(sim);
      guardaPares(sim);
      await cacheGuarda();
    }
    if (!cuenta(sim).add && cuenta(sim).duda) S.simBFiltro = 'duda';
    return sim;
  }
  // ¿Vale la lista de Soundeo para quitar? Solo si está completa y es de hace menos de 24 horas.
  const sxValeQuitar = () => !!S.sx && sxAvisos(S.sx.lista).length === 0;
  /* El registro de B tal como vale hoy. Cada apunte lleva el id de la playlist en la que se hizo («q»): si «Sound Try»
     se borra y se crea otra, o el mapa pasa a otra playlist, lo apuntado en la antigua no dice nada de la nueva
     (ni «la quitaste a mano» ni «la puso la app»). «d» (estuvo en Sound Down) sí se conserva. */
  function sxReg() {
    const pls = S.lib ? soundeoActual() : {}, M = (S.mem && S.mem.sx) || {}, out = {};
    Object.keys(M).forEach(id => {
      const r = M[id];
      if (!r || typeof r !== 'object') return;
      const p = {};
      SOUNDEO.forEach(([k]) => { if (r.p && typeof r.p[k] === 'string' && pls[k] && r.q && r.q[k] === pls[k].id) p[k] = r.p[k]; });
      out[id] = Object.assign({}, r, { p });
    });
    return out;
  }
  const sxApuntados = () => Object.values(sxReg()).filter(r => Object.keys(r.p).length > 0).length;
  // La canción de Spotify de un favorito para una playlist: la que ya está allí o, si no, la elegida.
  const uriEn = (u, d) => (d.ya ? d.ya.sp.uri : (u.elegida && (u.estado === 'add' || u.estado === 'ya' || u.estado === 'mano') ? u.elegida.sp.uri : null));
  /* Con la simulación hecha (o tras una respuesta del usuario), qué habría que hacer en las tres playlists:
     C.sxPlan, que es puro, con el registro de la app. Marca además en cada favorito lo que él quitó a mano. */
  function replanB(sim) {
    if (!sim || !S.lib || !S.mem) return;
    const pls = soundeoActual(), reg = sxReg(), cont = {};
    SOUNDEO.forEach(([k]) => { const p = pls[k]; cont[k] = p && p.id === sim.pls[k] && p.contenido && !destinoSx(p.id) ? urisDe(p.items) : null; });
    sim.unicas.forEach(u => { u.destinos.forEach(d => { d.mano = false; d.asi = false; }); if (u.estado === 'mano') u.estado = 'add'; });
    const favs = sim.unicas.map(u => {
      const uris = {}, dec = S.mem.decisiones[u.rb.clave];
      u.destinos.forEach(d => { const x = uriEn(u, d); if (x) uris[d.clave] = x; });
      return { id: u.sx.id, dest: u.destinos[1].clave, uris, rech: (dec && dec.no) || [] };
    });
    sim.quitarVale = sxValeQuitar() && S.sx.ruta === sim.lista;
    const P = sim.planB = C.sxPlan({ favs, reg, cont, quitar: sim.quitarVale });
    const porId = new Map(sim.unicas.map(u => [String(u.sx.id), u]));
    SOUNDEO.forEach(([k]) => P[k].mano.forEach(m => m.sx.forEach(id => {
      const u = porId.get(String(id)), d = u && u.destinos.find(x => x.clave === k);
      if (d && !d.ya) { d.mano = true; d.asi = !!m.asi; d.manoUri = m.uri; }
    })));
    // Un favorito al que no le queda nada por añadir porque lo que falta lo quitó él: sale de «Se añadirían».
    sim.unicas.forEach(u => { if (u.estado === 'add' && u.destinos.some(d => d.mano) && u.destinos.every(d => d.ya || d.mano || !d.spId)) u.estado = 'mano'; });
  }
  // «Dejarla así»: no vuelve a esa playlist y no se pregunta más. Se apunta en el registro de ese favorito.
  async function dejaAsi(u, d, si) {
    if (!S.db || !S.mem) throw new Error('Conecta Dropbox en Cuentas.');
    await memCarga(); // el apunte se cambia sobre lo último que haya en la memoria común, no sobre lo que esta pestaña tenía cargado
    const id = String(u.sx.id), r = S.mem.sx[id] || { p: {} };
    const asi = (Array.isArray(r.asi) ? r.asi : []).filter(k => k !== d.clave);
    if (si) asi.push(d.clave);
    S.mem.sx[id] = Object.assign({}, r, { asi, t: Date.now() });
    sxGuardaLocal();
    memToca();
    S.planB = null;
    replanB(S.simB);
  }
  function porPlaylistB(sim) {
    const out = {};
    SOUNDEO.forEach(([k]) => { out[k] = { ya: 0, add: 0, duda: 0, no: 0, pend: 0, mano: 0, total: 0 }; });
    sim.unicas.forEach(u => u.destinos.forEach(d => { if (u.estado && out[d.clave]) { out[d.clave][estadoEn(u, d)]++; out[d.clave].total++; } }));
    return out;
  }

  // ---------------- botón C: sin repartir ----------------
  function calculaC() {
    const s = soundeoActual();
    const its = k => (s[k] ? s[k].items : []);
    const rep = repartidoras();
    const repartidas = [];
    rep.forEach(p => repartidas.push(...p.items));
    const desde = ajuste('likesDesde', LIKES_DESDE);
    const filas = C.sinRepartir({ likes: S.lib.likes, soundAll: its('all'), soundDown: its('down'), soundTry: its('try'), repartidas, desde });
    S.c = { fecha: Date.now(), filas, rep: rep.map(p => p.nombre), desde, soundeo: { all: !!s.all, down: !!s.down, try: !!s.try } };
  }
  const oculta = uri => !!(S.mem && S.mem.ocultas[uri] && S.mem.ocultas[uri].o);
  function ponOculta(uri, o) { S.mem.ocultas[uri] = { o, t: Date.now() }; memToca(); pinta(); }

  // ---------------- copia completa ----------------
  const pistaCopia = it => (it.t
    ? { uri: it.t.u, nombre: it.t.n, artistas: it.t.a, album: it.t.al, duracion_s: it.t.d, isrc: it.t.isrc || undefined, local: it.local || undefined, agregada: it.add }
    : { uri: it.uri || null, nombre: it.nombre || null, tipo: it.tipo, agregada: it.add });
  function construyeCopia(lib) {
    const avisos = [];
    lib.playlists.forEach(p => { if (p.contenido && p.total != null && p.total !== p.items.length) avisos.push('«' + p.nombre + '»: Spotify dice ' + p.total + ' y se han leído ' + p.items.length); });
    const conCont = lib.playlists.filter(p => p.contenido);
    return {
      app: 'SynchroSound', version: VERSION, tipo: 'Copia completa de Spotify: playlists y likes',
      fecha: new Date().toISOString(), usuario: { id: lib.yo.id, nombre: lib.yo.nombre },
      resumen: {
        playlists: lib.playlists.length, playlists_con_contenido: conCont.length,
        canciones_en_playlists: conCont.reduce((n, p) => n + p.items.length, 0), likes: lib.likes.length, avisos,
        lectura: textoLectura(lib.lectura),
      },
      likes: lib.likes.map(pistaCopia),
      playlists: lib.playlists.map(p => ({
        id: p.id, uri: 'spotify:playlist:' + p.id, nombre: p.nombre, propia: p.propia, colaborativa: p.colaborativa,
        publica: p.publica, descripcion: p.descripcion, duenio: p.dueno, snapshot_id: p.snapshot,
        total_segun_spotify: p.total, contenido_guardado: p.contenido, motivo: p.motivo || undefined,
        canciones: p.items.map(pistaCopia),
      })),
    };
  }
  async function hazCopia(prog) {
    if (!S.db || !S.sp) throw new Error('Conecta Dropbox y Spotify en Cuentas.');
    const lib = await leeBiblioteca(prog);
    const copia = construyeCopia(lib);
    prog('Guardando la copia en Dropbox…');
    // modo «add» con nombre nuevo: una copia nunca pisa a otra.
    const meta = await dbxSube('/copias/spotify-completa-' + sello() + '.json', JSON.stringify(copia, null, 1), 'add', true);
    S.ultimaCopia = { nombre: meta.name, ruta: meta.path_display, tam: meta.size, resumen: copia.resumen, fecha: copia.fecha };
    S.copias = null;
    await cargaCopias();
    aviso('Copia guardada en Dropbox: ' + meta.name + '.');
  }
  async function cargaCopias() {
    S.copias = (await listaCarpeta('/copias', false)).sort((a, b) => (b.nombre > a.nombre ? 1 : -1));
  }

  // ---------------- fase 2, etapa 1: sincronización «solo añadir» ----------------
  /* Añade a las playlists «NS - …» y «OG - …» del mapa las canciones que la simulación da como «se añadirían».
     Tres pasos: preparar (sin red: hace la lista y la enseña), confirmar (el usuario marca playlists y pulsa) y
     ejecutar. Al ejecutar:
     1) se guarda una copia en Dropbox, y sin copia no se escribe;
     2) cada playlist se relee de Spotify justo antes de escribir en ella y, si no es idéntica a la que vio la
        simulación, no se toca;
     3) las canciones van al final, en el orden de rekordbox, en lotes de hasta 100, y tras cada lote se relee la
        playlist y se compara;
     4) ninguna escritura se repite: si algo falla, no cuadra o no se sabe si llegó, se para y se dice lo que hay. */
  const TAREA_SINC = 'Sincronizar';
  const ultimaSinc = () => ls.get('ss.sinc') || S.sinc; // la pudo hacer otra pestaña de este navegador
  const ESPERA_COMP = 3000; // si Spotify aceptó un lote y al releer aún no se ve, se espera esto y se relee una vez más
  // Lee las canciones de una playlist pidiéndoselas a Spotify, sin fiarse de lo guardado.
  async function leePlaylistDirecta(id, firme) {
    const items = [];
    await paginas('/playlists/' + encodeURIComponent(id) + '/items', its => { its.forEach(e => items.push(itemDe(e))); }, firme);
    return items;
  }
  const urisDe = items => items.map(it => it.uri || (it.t && it.t.u) || '');
  const mismas = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const lotesDe = n => Math.ceil(n / MAX_LOTE);
  const txtErr = e => String((e && e.message) || e).slice(0, 300);
  const visib = v => (v === true ? 'pública' : v === false ? 'privada' : 'no se sabe si es pública');
  const nPlaylists = n => n + (n === 1 ? ' playlist' : ' playlists');

  /* La lista de lo que se añadiría, playlist por playlist, sacada de la simulación (sin red). Una fila por cada
     playlist de rekordbox del mapa: {clave, id, nombre, publica, tiene, antes, uris, lineas, bloqueo, nada}.
     «antes» = las canciones que tenía la playlist cuando se simuló; «uris» = lo que se añadiría, en el orden de
     rekordbox y sin repetir; «bloqueo» = por qué no se puede marcar. En cada playlist solo entran las canciones
     que la simulación da como «se añadirían» para esa playlist. */
  function planDe(sim) {
    const porRb = new Map();
    sim.unicas.forEach(u => porRb.set(u.rb.id, u));
    return S.xml.datos.delMapa.map(pl => {
      const dest = sim.mapa[pl.clave];
      const f = { clave: pl.clave, grupo: pl.grupo, nombreRb: pl.nombre, id: (dest && dest.id) || null, nombre: (dest && dest.nombre) || '',
        publica: null, tiene: 0, antes: [], uris: [], lineas: [], bloqueo: '', nada: false };
      if (!f.id) { f.bloqueo = 'no tiene pareja en Spotify.'; return f; }
      const p = S.lib.playlists.find(x => x.id === f.id);
      if (p) { f.nombre = p.nombre; f.publica = p.publica; }
      const no = destinoFijo(f.id);
      if (no) { f.bloqueo = no + '.'; return f; }
      if (!p.contenido) { f.bloqueo = 'no se ha podido leer su contenido' + (p.motivo ? ' (' + p.motivo + ')' : '') + '.'; return f; }
      f.antes = urisDe(p.items); f.tiene = f.antes.length;
      const dentro = new Set(f.antes), vistas = new Set();
      for (const id of pl.ids) {
        const u = porRb.get(id);
        const d = u && u.destinos.find(x => x.clave === pl.clave);
        if (!d || d.spId !== f.id || !u.estado || estadoEn(u, d) !== 'add') continue;
        const uri = u.elegida.sp.uri;
        // Dos archivos de rekordbox pueden apuntar a la misma canción de Spotify: entra una sola vez.
        if (!URI_CANCION.test(uri) || dentro.has(uri) || vistas.has(uri)) continue;
        vistas.add(uri);
        f.uris.push(uri);
        f.lineas.push({ uri, rb: lineaRb(u.rb), sp: lineaSp(u.elegida.sp.m), riesgo: riesgoDe(u), nota: u.elegida.r.nota || '' });
      }
      if (!f.uris.length) { f.nada = true; f.bloqueo = 'no hay nada que añadir.'; }
      else if (enfriando(f.id)) f.bloqueo = enfriando(f.id) + '.';
      return f;
    });
  }
  // Por qué no se puede preparar ni ejecutar la sincronización ahora mismo (sin red). '' = se puede.
  function porQueNoSinc(esB) {
    if (!S.db || !S.sp) return 'Conecta Dropbox y Spotify en Cuentas.';
    if (!tieneEscritura()) return 'En este dispositivo Spotify está conectado solo con permisos de lectura: vuelve a conectarlo en Cuentas.';
    if (corteActivo()) return 'Spotify tiene cortadas las peticiones de la app: hay que esperar a que pase el plazo.';
    if (esB) {
      if (!S.lib || !S.simB || !S.mem) return 'Primero simula: la sincronización parte de una simulación.';
      if (S.simB.incompleta) return 'La simulación está incompleta: simula otra vez.';
      if (S.lib.vieja || S.simB.lib !== S.lib.leida) return 'Spotify se ha vuelto a leer, o ha cambiado, después de la simulación: simula otra vez.';
      if (Date.now() - S.simB.fecha > VALE_SIM) return 'La simulación tiene más de una hora: simula otra vez.';
      if (!S.sx || S.sx.ruta !== S.simB.lista) return 'La lista de Soundeo ha cambiado después de la simulación: simula otra vez.';
      return '';
    }
    if (!S.xml || !S.lib || !S.sim) return 'Primero simula: la sincronización parte de una simulación.';
    if (S.sim.incompleta) return 'La simulación está incompleta: simula otra vez.';
    if (S.lib.vieja || S.sim.lib !== S.lib.leida) return 'Spotify se ha vuelto a leer, o ha cambiado, después de la simulación: simula otra vez.';
    if (Date.now() - S.sim.fecha > VALE_SIM) return 'La simulación tiene más de una hora: simula otra vez.';
    return '';
  }
  function preparaSinc() {
    const no = porQueNoSinc();
    if (no) { aviso(no, 'error'); return; }
    S.plan = { t: Date.now(), sim: S.sim.fecha, filas: planDe(S.sim), marcadas: {} }; // ninguna marcada de entrada
    S.planVer = null;
    pinta();
  }
  /* Lo mismo para el botón B: una fila por cada una de las tres playlists de Soundeo, con lo que se añadiría
     («uris», «lineas») y lo que se propone quitar («quita», «lineasQ», cada una con su motivo), sacado de sim.planB. */
  const MOTIVO_Q = { descargada: 'ya la has descargado: pasa a Sound Down', 'sin-estrella': 'ya no es favorita en Soundeo', 'no-es': 'dijiste que no es la canción de tu favorito' };
  function planDeB(sim) {
    const pls = soundeoActual(), P = sim.planB, reg = S.mem.sx || {};
    const porId = new Map(sim.unicas.map(u => [String(u.sx.id), u]));
    return SOUNDEO.map(([k, nombreSx]) => {
      const p = pls[k];
      const f = { clave: k, nombreSx, id: p ? p.id : null, nombre: p ? p.nombre : '', publica: p ? p.publica : null, tiene: 0, antes: [], uris: [], lineas: [], quita: [], lineasQ: [], bloqueo: '', nada: false };
      if (!p) { f.bloqueo = 'no tiene pareja en Spotify: crea allí una playlist vacía que se llame «' + nombreSx + '» y simula otra vez.'; return f; }
      if (p.id !== sim.pls[k]) { f.bloqueo = 'el mapa ha cambiado desde la simulación: simula otra vez.'; return f; }
      const no = destinoSx(p.id);
      if (no) { f.bloqueo = no + '.'; return f; }
      if (!p.contenido || !P || !P[k] || !P[k].usable) { f.bloqueo = 'no se ha podido leer su contenido' + (p.motivo ? ' (' + p.motivo + ')' : '') + '.'; return f; }
      f.antes = urisDe(p.items); f.tiene = f.antes.length;
      const dentro = new Set(f.antes);
      P[k].anadir.forEach(a => {
        if (!URI_CANCION.test(a.uri) || dentro.has(a.uri) || f.uris.indexOf(a.uri) >= 0) return;
        const u = porId.get(String(a.sx[0])), sp = u && u.elegida ? u.elegida.sp : null;
        f.uris.push(a.uri);
        f.lineas.push({ uri: a.uri, rb: u ? lineaRb(u.rb) : '', sp: sp && sp.uri === a.uri ? lineaSp(sp.m) : a.uri, riesgo: u ? riesgoDe(u) : 0,
          nota: u && u.elegida && u.elegida.r.nota ? String(u.elegida.r.nota).replace(/en rekordbox/g, 'en Soundeo') : '' });
      });
      P[k].quitar.forEach(q => {
        if (!URI_CANCION.test(q.uri) || !dentro.has(q.uri) || f.quita.indexOf(q.uri) >= 0) return;
        const it = p.items.find(x => (x.uri || (x.t && x.t.u)) === q.uri);
        const fav = q.sx.map(id => { const u = porId.get(String(id)); return u ? lineaRb(u.rb) : (reg[id] && reg[id].n) || ''; }).filter(Boolean)[0] || '';
        // «puesta» = la añadió la propia app en una sincronización; si no, ya estaba ahí y la app la dio por pareja del favorito.
        const puesta = q.sx.some(id => { const r = reg[id]; return !!(r && r.o && r.o[k] && r.q && r.q[k] === p.id); });
        f.quita.push(q.uri);
        f.lineasQ.push({ uri: q.uri, sp: it && it.t ? lineaSp(it.t) : q.uri, fav, motivo: q.motivo, trasDown: !!q.trasDown, enDown: q.enDown || [], puesta });
      });
      if (!f.uris.length && !f.quita.length) { f.nada = true; f.bloqueo = 'no hay nada que añadir ni que quitar.'; }
      else if (enfriando(f.id)) f.bloqueo = enfriando(f.id) + '.';
      return f;
    });
  }
  // Lo marcado en la pantalla de B: en cada playlist, añadir (todo o nada) y, canción a canción, lo que se quita.
  const claveQ = (f, uri) => f.clave + '|' + uri;
  function marcadasB(plan) {
    return plan.filas.filter(f => !f.bloqueo).map(f => {
      const anade = plan.marcadas[f.clave] === true && f.uris.length > 0;
      const lq = f.lineasQ.filter(l => plan.quitar[claveQ(f, l.uri)] === true);
      return Object.assign({}, f, { uris: anade ? f.uris : [], lineas: anade ? f.lineas : [], quita: lq.map(l => l.uri), lineasQ: lq, todasUris: f.uris, todasQuita: f.quita });
    }).filter(f => f.uris.length || f.quita.length);
  }
  function preparaSincB() {
    const no = porQueNoSinc(true);
    if (no) { aviso(no, 'error'); return; }
    replanB(S.simB);
    S.planB = { t: Date.now(), sim: S.simB.fecha, filas: planDeB(S.simB), marcadas: {}, quitar: {} }; // nada marcado de entrada
    S.planBVer = null;
    pinta();
  }
  // Cuánto gasta: por cada playlist, releerla antes, un envío por lote y releerla tras cada lote (50 canciones por lectura).
  const pagsDe = n => Math.max(1, Math.ceil(n / 50));
  function gastoDe(filas) {
    let escr = 0, lect = 0;
    filas.forEach(f => {
      lect += pagsDe(f.tiene);
      for (let k = 0; k < f.uris.length; k += MAX_LOTE) { escr++; lect += pagsDe(f.tiene + Math.min(f.uris.length, k + MAX_LOTE)); }
      const q = (f.quita || []).length;
      for (let k = 0; k < q; k += MAX_LOTE) { escr++; lect += pagsDe(f.tiene + f.uris.length); }
      // de Sound Try, por descarga, solo sale lo que esté en Sound Down: si Down no va marcada, se lee aparte
      if (f.clave === 'try' && (f.lineasQ || []).some(l => l.motivo === 'descargada') && !filas.some(x => x.clave === 'down')) lect += 1;
    });
    return { escr, lect };
  }
  // La copia que se guarda antes de escribir: las playlists que se van a tocar, tal como estaban, y lo que se va a añadir.
  function construyeAntes(marcadas, simB) {
    if (simB) {
      return {
        app: 'SynchroSound', version: VERSION,
        tipo: 'Copia antes de sincronizar Soundeo: las playlists en las que se va a escribir, tal como estaban, y lo que se va a añadir y a quitar en cada una',
        fecha: new Date().toISOString(), usuario: { id: S.lib.yo.id, nombre: S.lib.yo.nombre },
        lista_soundeo: simB.lista, lista_leida: new Date(simB.listaT).toISOString(), simulacion: new Date(simB.fecha).toISOString(), spotify_leido: new Date(S.lib.leida).toISOString(),
        nota: 'Justo antes de escribir en cada playlist se relee de Spotify; si no coincide con lo guardado aquí, no se escribe en ella. Para deshacer una quita, la canción está en «canciones» con su uri.',
        playlists: marcadas.map(f => {
          const p = S.lib.playlists.find(x => x.id === f.id);
          return { id: p.id, uri: 'spotify:playlist:' + p.id, nombre: p.nombre, publica: p.publica, snapshot_id: p.snapshot, soundeo: f.nombreSx,
            canciones: p.items.map(pistaCopia), se_van_a_anadir: f.lineas.map(l => ({ uri: l.uri, cancion: l.sp, favorito: l.rb })),
            se_van_a_quitar: f.lineasQ.map(l => ({ uri: l.uri, cancion: l.sp, favorito: l.fav, motivo: MOTIVO_Q[l.motivo] || l.motivo, la_anadio_la_app: !!l.puesta })) };
        }),
        // el registro de la app tal como estaba: qué canción tenía apuntada de cada favorito en cada playlist
        registro_de_la_app: JSON.parse(JSON.stringify((S.mem && S.mem.sx) || {})),
      };
    }
    return {
      app: 'SynchroSound', version: VERSION,
      tipo: 'Copia antes de sincronizar: las playlists en las que se va a escribir, tal como estaban, y lo que se va a añadir a cada una',
      fecha: new Date().toISOString(), usuario: { id: S.lib.yo.id, nombre: S.lib.yo.nombre },
      xml_ultimo_cambio: S.xml.fecha, simulacion: new Date(S.sim.fecha).toISOString(), spotify_leido: new Date(S.lib.leida).toISOString(),
      nota: 'Justo antes de escribir en cada playlist se relee de Spotify; si no coincide con lo guardado aquí, no se escribe en ella.',
      playlists: marcadas.map(f => {
        const p = S.lib.playlists.find(x => x.id === f.id);
        return { id: p.id, uri: 'spotify:playlist:' + p.id, nombre: p.nombre, publica: p.publica, snapshot_id: p.snapshot, rekordbox: f.clave,
          canciones: p.items.map(pistaCopia), se_van_a_anadir: f.lineas.map(l => ({ uri: l.uri, cancion: l.sp, rekordbox: l.rb })) };
      }),
    };
  }
  // Lo que queda escrito de una sincronización: qué se envió a cada playlist y qué se comprobó al releer.
  function construyeRegistro(res, marcadas, reg) {
    const linea = (f, u) => {
      const l = f.lineas.find(x => x.uri === u), q = !l && res.b ? (f.lineasQ || []).find(x => x.uri === u) : null;
      if (q) return { uri: u, cancion: q.sp, favorito: q.fav, se_pidio_quitar: true }; // un lote de quitar que no se pudo comprobar
      return res.b ? { uri: u, cancion: l ? l.sp : '', favorito: l ? l.rb : '' } : { uri: u, cancion: l ? l.sp : '', rekordbox: l ? l.rb : '' };
    };
    const lineaQ = (f, u) => { const l = (f.lineasQ || []).find(x => x.uri === u); return { uri: u, cancion: l ? l.sp : '', favorito: l ? l.fav : '', motivo: l ? (MOTIVO_Q[l.motivo] || l.motivo) : '' }; };
    return {
      app: 'SynchroSound', version: VERSION, tipo: res.b ? 'Registro de una sincronización de Soundeo a Spotify (añadir y quitar en Sound All, Sound Down y Sound Try)' : 'Registro de una sincronización de rekordbox a Spotify (solo añadir)',
      fecha: new Date(res.t).toISOString(), usuario: { id: S.lib.yo.id, nombre: S.lib.yo.nombre },
      copia_previa: res.copia, xml_ultimo_cambio: res.xml, final: res.fin || (res.pls.every(q => q.estado === 'ok') ? 'completa' : 'terminada con playlists sin tocar'),
      playlists: marcadas.map((f, i) => {
        const r = res.pls[i];
        return { id: f.id, uri: 'spotify:playlist:' + f.id, nombre: f.nombre, rekordbox: res.b ? undefined : f.clave, soundeo: res.b ? f.nombreSx : undefined, estado: r.estado,
          canciones_antes: r.antes, canciones_despues: r.despues,
          lotes: r.lotes.map(L => ({ quitar: L.quita || undefined, canciones: L.n, enviado: L.enviada, respuesta: L.estado, error: L.error || undefined, no_se_sabe_si_llego: L.incierta || undefined, cuadra_al_releer: L.cuadra })),
          anadidas: reg[i].anadidas.map(u => linea(f, u)),
          enviadas_sin_comprobar: reg[i].sinComprobar.map(u => linea(f, u)),
          enviadas_que_no_se_ven_al_releer: reg[i].noEstan.map(u => linea(f, u)),
          quitadas: res.b ? reg[i].quitadas.map(u => lineaQ(f, u)) : undefined,
          pedidas_quitar_que_siguen_al_releer: res.b ? reg[i].siguen.map(u => lineaQ(f, u)) : undefined };
      }),
    };
  }
  // Lo leído directamente de Spotify sustituye a lo guardado de esa playlist. Sin sello, la próxima lectura la vuelve a pedir.
  function ponEnLib(id, items, snap) {
    const pl = S.lib && S.lib.playlists.find(x => x.id === id);
    if (!pl) return;
    pl.items = items; pl.total = items.length; pl.contenido = true; pl.motivo = ''; pl.snapshot = snap || '';
    S.lib.idx = null;
    if (S.libCache && S.libCache.pls && S.libCache.usuario === S.lib.yo.id) S.libCache.pls[id] = { snap: pl.snapshot, total: pl.total, items, contenido: true, motivo: '' };
  }
  /* «esB» = la sincronización del botón B (Soundeo): mismo recorrido y mismas garantías, sobre las tres playlists
     de Soundeo, y además puede quitar (paso 5). Sin «esB» es la del botón A, que solo añade. */
  async function sincroniza(prog, esB) {
    const NADA = ' No se ha enviado nada a Spotify.';
    const plan = esB ? S.planB : S.plan;
    if (esB) S.planB = null; else S.plan = null; // una confirmación vale para una sola ejecución
    if (!plan) throw new Error('Prepara la sincronización primero.' + NADA);
    const no = porQueNoSinc(esB);
    if (no) throw new Error(no + NADA);
    const SIM = esB ? S.simB : S.sim; // la simulación de la que parte
    if (plan.sim !== SIM.fecha) throw new Error('La simulación ha cambiado desde que se preparó la sincronización: prepárala otra vez.' + NADA);
    const marcadas = esB ? marcadasB(plan) : plan.filas.filter(f => plan.marcadas[f.clave] === true && !f.bloqueo);
    if (!marcadas.length) throw new Error((esB ? 'No hay nada marcado.' : 'No hay ninguna playlist marcada.') + NADA);
    /* Lo decidido en otro dispositivo también cuenta (un «No es», un cambio de mapa, un corte de Spotify): se baja
       la memoria común y se vuelve a mirar. Si con eso cambia lo que se añadiría, la comparación de abajo lo para. */
    const decAntes = {};
    SIM.unicas.forEach(u => { decAntes[u.rb.clave] = JSON.stringify(S.mem.decisiones[u.rb.clave] || null); });
    try { await memCarga(); }
    catch (e) { throw new Error('No se ha podido leer en Dropbox la memoria común (' + txtErr(e) + ').' + NADA); }
    if (esB) {
      // Si desde otro dispositivo se ha guardado una lista de Soundeo más nueva, la de la simulación ya no vale.
      let ultima;
      try { ultima = await sxCarga(); }
      catch (e) { throw new Error('No se ha podido mirar en Dropbox cuál es la última lista de Soundeo (' + txtErr(e) + ').' + NADA); }
      if (!ultima || ultima.ruta !== SIM.lista) throw new Error('En Dropbox hay una lista de Soundeo más nueva que la de la simulación: simula otra vez.' + NADA);
    }
    const no2 = porQueNoSinc(esB);
    if (no2) throw new Error(no2 + NADA);
    if (esB) {
      // «Estuvo en Sound Down» puede haberse apuntado en otro dispositivo después de simular: el destino tiene que ser el mismo.
      if (SIM.unicas.some(u => C.sxDestino(u.sx.baj, S.mem.sx[u.sx.id]) !== u.destinos[1].clave)) {
        S.simB = null;
        throw new Error('El registro de Soundeo ha cambiado desde la simulación (quizá en otro dispositivo): simula otra vez.' + NADA);
      }
      const hoyPl = soundeoActual();
      if (SOUNDEO.some(([k]) => ((hoyPl[k] || {}).id || null) !== (SIM.pls[k] || null))) {
        S.simB = null;
        throw new Error('El mapa de las playlists de Soundeo ha cambiado desde la simulación (quizá en otro dispositivo): simula otra vez.' + NADA);
      }
    } else {
      const mapaHoy = mapaActual().mapa;
      if (S.xml.datos.delMapa.some(pl => ((mapaHoy[pl.clave] || {}).id || null) !== ((S.sim.mapa[pl.clave] || {}).id || null))) {
        S.sim = null;
        throw new Error('El mapa de playlists ha cambiado desde la simulación (quizá en otro dispositivo): simula otra vez.' + NADA);
      }
    }
    const idx = indices();
    SIM.unicas.forEach(u => { if (JSON.stringify(S.mem.decisiones[u.rb.clave] || null) !== decAntes[u.rb.clave]) reevalua(u, idx); });
    if (esB) replanB(SIM); // con las respuestas y el registro recién bajados de la memoria común
    // Lo confirmado tiene que ser, ahora mismo, exactamente lo que da la simulación: ni una canción más ni una menos.
    const fresco = esB ? planDeB(SIM) : planDe(SIM);
    for (const f of marcadas) {
      const g = fresco.find(x => x.clave === f.clave);
      // En B también tienen que coincidir los motivos de cada quita (y lo que cada una espera de Sound Down).
      const motivos = F => JSON.stringify(F.lineasQ.map(l => [l.uri, l.motivo, !!l.trasDown, l.enDown || []]));
      const lq = esB && g ? g.lineasQ.filter(l => f.quita.indexOf(l.uri) >= 0) : [];
      if (!g || g.bloqueo || g.id !== f.id || !mismas(g.uris, f.todasUris || f.uris) || !mismas(g.antes, f.antes) || (esB && (!mismas(g.quita, f.todasQuita) || motivos({ lineasQ: lq }) !== motivos(f)))) {
        throw new Error('Lo que se ' + (esB ? 'haría en' : 'añadiría a') + ' «' + f.nombre + '» ha cambiado desde que se preparó la sincronización: prepárala otra vez.' + NADA);
      }
    }
    if (new Set(marcadas.map(f => f.id)).size !== marcadas.length) throw new Error('Dos de las playlists marcadas son la misma en Spotify.' + NADA);

    /* 1) La copia. Si no se guarda, de aquí no se pasa.
       La copia previa es además el TESTIGO de que aquí se va a sincronizar: su nombre lleva el dispositivo y la
       sesión (esta carga de página). Y toda sincronización que llega a guardar su copia termina guardando su
       registro, con el mismo nombre: es el CIERRE del testigo, y dice que ya no va a escribir más. */
    let copia = null, completa = '', enCopias = null, rutaRegistro = '';
    const t0 = Date.now(); // el permiso cuenta desde aquí, antes de guardar la copia: caduca antes que el testigo para los demás
    const yo = disp() + '-' + SESION;
    const cierraSin = async motivo => { // cierra el testigo de una sincronización que no llega a escribir nada
      if (!rutaRegistro) return;
      try {
        await dbxSube(rutaRegistro, JSON.stringify({ app: 'SynchroSound', version: VERSION, tipo: 'Sincronización que no llegó a escribir nada en Spotify',
          fecha: new Date().toISOString(), copia_previa: copia && copia.name, final: motivo, playlists: [] }, null, 1), 'add', true);
      } catch (e) { /* sin cierre, los demás esperan a que el testigo caduque: es lo seguro */ }
    };
    try {
      prog('Guardando la copia en Dropbox…');
      copia = await dbxSube('/copias/antes-de-sincronizar-' + sello() + '-' + yo + '.json', JSON.stringify(construyeAntes(marcadas, esB ? SIM : null), null, 1), 'add', true);
      if (!copia || !copia.name) throw new Error('Dropbox no ha confirmado la copia');
      rutaRegistro = '/registro/sincronizacion-' + copia.name.replace(/^antes-de-sincronizar-/, '');
      S.copias = null;
      enCopias = await listaCarpeta('/copias', false);
      // La completa (todas las playlists y los likes) solo si no hay ninguna; después basta con las playlists que se van a tocar.
      if (!enCopias.some(a => COPIA_COMPLETA.test(a.nombre))) {
        completa = (await dbxSube('/copias/spotify-completa-' + sello() + '.json', JSON.stringify(construyeCopia(S.lib), null, 1), 'add', true)).name;
      }
    } catch (e) {
      await cierraSin('no se pudo guardar la copia');
      throw new Error('No se ha podido guardar la copia en Dropbox (' + txtErr(e) + '). Sin copia no se escribe.' + NADA);
    }
    /* ¿Hay otra sincronización viva, en otra pestaña o en otro dispositivo? Cada una guarda su testigo antes de
       escribir y después mira la carpeta: si ve el testigo de OTRA, de hace menos de un cuarto de hora (lo máximo
       que puede durar una, más un margen) y sin cerrar, se retira sin escribir. Como cada una sube primero y mira
       después, de dos que empiezan a la vez al menos una ve a la otra. */
    let viva = '';
    try {
      if (!enCopias.some(a => a.nombre === copia.name)) viva = 'Dropbox todavía no enseña la copia recién guardada, así que no se puede saber si hay otra sincronización en marcha';
      else {
        const mio = Date.parse(copia.server_modified) || Date.now();
        const TESTIGO = /^antes-de-sincronizar-(\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d(?:-(.+?))?(?: \(\d+\))?\.json)$/;
        const otras = enCopias.map(a => ({ a, m: TESTIGO.exec(a.nombre), t: Date.parse(a.servidor || a.fecha) }))
          .filter(o => o.m && o.a.nombre !== copia.name && o.m[2] !== yo && isFinite(o.t) && Math.abs(mio - o.t) < VENTANA_OTRA);
        if (otras.length) {
          const cierres = await listaCarpeta('/registro', false);
          const abiertas = otras.filter(o => !cierres.some(c => c.nombre === 'sincronizacion-' + o.m[1]));
          if (abiertas.length) {
            const falta = Math.max(1, Math.ceil((VENTANA_OTRA - (mio - Math.max(...abiertas.map(o => o.t)))) / 60000));
            viva = 'Hay otra sincronización empezada hace menos de un cuarto de hora, en otra pestaña o en otro dispositivo, y no consta que haya terminado. Simula otra vez y vuelve a intentarlo: si la otra ya acabó o se retiró, funcionará; si sigue en marcha, espera a que acabe; y si se cerró a medias, habrá que esperar unos ' + falta + ' minutos';
          }
        }
      }
    } catch (e) { viva = 'No se ha podido mirar en Dropbox si hay otra sincronización en marcha (' + txtErr(e) + ')'; }
    if (viva) { await cierraSin('retirada: ' + viva); throw new Error(viva + '.' + NADA); }

    const res = { t: Date.now(), v: VERSION, xml: esB ? '' : S.xml.fecha, copia: copia.name, completa, registro: '', errorRegistro: '', fin: '',
      pls: marcadas.map(f => ({ clave: f.clave, id: f.id, nombre: f.nombre, publica: f.publica, pedidas: f.uris.length, antes: null, despues: null, anadidas: 0, estado: 'pendiente', detalle: '', lotes: [] })) };
    if (esB) { res.b = true; res.pls.forEach((r, i) => { r.quitar = marcadas[i].quita.length; r.quitadas = 0; r.sinDown = 0; }); }
    const reg = marcadas.map(() => ({ anadidas: [], sinComprobar: [], noEstan: [], quitadas: [], siguen: [] }));
    const total = marcadas.reduce((n, f) => n + f.uris.length + (esB ? f.quita.length : 0), 0);
    // Cómo quedó cada playlist la última vez que se leyó de Spotify en esta sincronización (para Sound Down y para el registro de B).
    const leidasAhora = new Map();
    const leeDown = async () => {
      const id = SIM.pls.down;
      if (!id) return null;
      if (!leidasAhora.has(id)) leidasAhora.set(id, urisDe(await leePlaylistDirecta(id, true)));
      return new Set(leidasAhora.get(id));
    };
    let hechas = 0, enviados = 0, libSucia = false;
    /* El avance se apunta en el navegador antes y después de cada escritura: si la página se cierra o se recarga
       a mitad, al volver se ve hasta dónde llegó («abierta»), en vez de no quedar rastro. */
    res.abierta = true;
    const apunta = () => ls.set('ss.sinc', res);
    // Y hasta comprobarlo, lo guardado de esa playlist no vale: la próxima lectura la pide a Spotify.
    const marcaReleer = (id, si) => { ponMarca('ss.releer', id, si ? Date.now() : null); ponMarca('ss.dudosas', id, si ? Date.now() : null); };
    let vuelo = null; // el lote que está entre «enviado» y «comprobado»: si algo se rompe ahí, queda dicho
    // 2) El permiso: exactamente lo confirmado, y solo mientras dura esta ejecución.
    permiso = { desde: Date.now(), hasta: t0 + VALE_PERMISO, copia: copia.path_display || copia.name, pls: new Map(marcadas.map(f => [f.id, new Set(f.uris)])),
      lotes: marcadas.reduce((n, f) => n + lotesDe(f.uris.length), 0), b: !!esB };
    if (esB) { // lo confirmado para quitar, playlist por playlist: la puerta de quitar no deja salir nada más
      permiso.quita = new Map(marcadas.filter(f => f.quita.length).map(f => [f.id, new Set(f.quita)]));
      permiso.lotesQ = marcadas.reduce((n, f) => n + lotesDe(f.quita.length), 0);
    }
    try {
      for (let i = 0; i < marcadas.length; i++) {
        const f = marcadas[i], r = res.pls[i], G = reg[i];
        if (S.parar) { res.fin = 'La paraste antes de empezar con «' + f.nombre + '».'; break; }
        // De Sound Try, por descarga, solo sale lo que esté ahora mismo en Sound Down: se mira antes de empezar con ella.
        let enDown = null;
        if (esB && f.lineasQ.some(l => l.motivo === 'descargada')) { try { enDown = await leeDown(); } catch (e) { enDown = null; } }
        // 3) Justo antes de escribir se relee la playlist de Spotify (no la guardada).
        prog('Releyendo «' + f.nombre + '» justo antes de escribir…', hechas, total);
        let items;
        try { items = await leePlaylistDirecta(f.id, true); }
        catch (e) {
          r.estado = 'sinleer'; r.detalle = txtErr(e);
          if (e.status === 403 || e.status === 404) continue; // esa playlist no se deja leer: se salta
          res.fin = 'No se ha podido leer «' + f.nombre + '» antes de escribir (' + r.detalle + ').';
          break;
        }
        let prev = urisDe(items), leida = Date.now(); // cuándo se leyó por última vez: la puerta exige que sea de ahora mismo
        leidasAhora.set(f.id, prev);
        r.antes = prev.length; r.despues = prev.length;
        if (!mismas(prev, f.antes)) { // no es la que vio la simulación: no se toca
          r.estado = 'cambiada';
          ponEnLib(f.id, items, ''); libSucia = true;
          continue;
        }
        const falta = f.uris.filter(u => prev.indexOf(u) < 0);
        for (let k = 0; k < falta.length; k += MAX_LOTE) {
          if (k > 0 && S.parar) { r.estado = 'parada'; res.fin = 'La paraste a mitad de «' + f.nombre + '».'; break; }
          const lote = falta.slice(k, k + MAX_LOTE);
          const L = { n: lote.length, enviada: false, estado: null, sello: false, error: '', incierta: false, corte: false, relecturas: 0, cuadra: null, estan: null, repes: 0, errorComp: '' };
          r.lotes.push(L);
          prog('Añadiendo ' + canciones(lote.length) + ' a «' + f.nombre + '»…', hechas, total);
          const n0 = S.cont.spEscr;
          let snap = '';
          r.estado = 'enviando'; marcaReleer(f.id, true); apunta();
          vuelo = { r, L, G, lote };
          pase = { id: f.id, uris: lote }; // un solo uso: la puerta lo gasta
          try {
            const w = await spotify('POST', '/playlists/' + f.id + '/items', { cuerpo: { uris: lote }, leida });
            L.estado = w.estado; snap = String((w.cuerpo && w.cuerpo.snapshot_id) || ''); L.sello = !!snap;
          } catch (e) {
            L.estado = e.status || null; L.error = txtErr(e); L.incierta = !!e.incierta; L.corte = !!e.corte;
          } finally { pase = null; }
          L.enviada = S.cont.spEscr > n0;
          if (!L.enviada) { vuelo = null; marcaReleer(f.id, false); r.estado = 'noenviada'; r.detalle = L.error; res.fin = 'Un lote para «' + f.nombre + '» no ha salido.'; break; }
          enviados++;
          // Tras un corte de Spotify no se envía nada más: tampoco la lectura de comprobación.
          if (L.corte) { vuelo = null; r.estado = 'corte'; G.sinComprobar.push(...lote); res.fin = 'Spotify ha cortado las peticiones al escribir en «' + f.nombre + '».'; break; }
          // 4) Haya ido bien, mal, o no se sepa si llegó: la escritura no se repite; se relee la playlist y se compara.
          prog('Comprobando «' + f.nombre + '» en Spotify…', hechas, total);
          const esperado = prev.concat(lote), bien = L.estado >= 200 && L.estado < 300;
          let ua;
          try {
            items = await leePlaylistDirecta(f.id, true); L.relecturas = 1; ua = urisDe(items);
            // Pudo llegar (la aceptó, o no se sabe) y todavía no se ve: Spotify puede tardar unos segundos en
            // enseñarlo. Se espera y se vuelve a LEER una vez; escribir, no.
            if ((bien || L.incierta || L.estado == null) && mismas(ua, prev)) { await espera(ESPERA_COMP); items = await leePlaylistDirecta(f.id, true); L.relecturas = 2; ua = urisDe(items); }
            leida = Date.now();
          } catch (e) {
            vuelo = null;
            L.errorComp = txtErr(e); r.estado = 'sincomprobar'; G.sinComprobar.push(...lote);
            res.fin = 'No se ha podido comprobar «' + f.nombre + '» releyéndola.';
            break;
          }
          L.cuadra = mismas(ua, esperado);
          const estan = lote.filter(u => ua.indexOf(u) >= 0);
          L.estan = estan.length;
          L.repes = lote.filter(u => ua.filter(x => x === u).length > 1).length;
          G.anadidas.push(...estan); G.noEstan.push(...lote.filter(u => ua.indexOf(u) < 0));
          r.despues = ua.length; r.anadidas += L.estan; hechas += L.estan;
          ponEnLib(f.id, items, bien && L.cuadra ? snap : ''); libSucia = true;
          vuelo = null;
          if (L.cuadra) marcaReleer(f.id, false); // la playlist está exactamente como tenía que quedar: comprobado
          if (bien && L.cuadra) r.estado = 'amedias';
          else {
            // Cualquier otra cosa para la sincronización, también si llegó pero Spotify no lo confirmó (algo va mal en la conexión).
            r.estado = bien ? 'nocuadra' : L.cuadra ? 'llego' : (L.incierta || L.estado == null ? 'incierta' : 'rechazada');
            res.fin = bien ? 'Lo releído de «' + f.nombre + '» no cuadra con lo enviado.'
              : r.estado === 'llego' ? 'La escritura en «' + f.nombre + '» llegó, pero Spotify no la confirmó: por prudencia se para aquí.'
                : r.estado === 'incierta' ? 'No se sabe si llegó una escritura en «' + f.nombre + '».' : 'Spotify ha rechazado una escritura en «' + f.nombre + '».';
          }
          apunta();
          leidasAhora.set(f.id, ua); // lo que se ha visto al releer vale para el registro también si se para aquí
          if (res.fin) break;
          prev = ua;
        }
        if (res.fin) break;
        // 5) Quitar (solo el botón B): lo confirmado que siga ahí, por su propia puerta, y comprobando que sale todo lo pedido y nada más.
        if (esB && f.quita.length) {
          const sinDown = new Set(f.lineasQ.filter(l => l.motivo === 'descargada' && !(enDown && l.enDown.length && l.enDown.every(x => enDown.has(x)))).map(l => l.uri));
          const aQuitar = f.quita.filter(u => prev.indexOf(u) >= 0 && !sinDown.has(u));
          r.sinDown = f.quita.filter(u => prev.indexOf(u) >= 0 && sinDown.has(u)).length;
          for (let k = 0; k < aQuitar.length; k += MAX_LOTE) {
            if (S.parar) { r.estado = 'parada'; res.fin = 'La paraste a mitad de «' + f.nombre + '».'; break; }
            const lote = aQuitar.slice(k, k + MAX_LOTE);
            const L = { n: lote.length, quita: true, enviada: false, estado: null, sello: false, error: '', incierta: false, corte: false, relecturas: 0, cuadra: null, estan: null, repes: 0, errorComp: '' };
            r.lotes.push(L);
            prog('Quitando ' + canciones(lote.length) + ' de «' + f.nombre + '»…', hechas, total);
            const n0 = S.cont.spEscr;
            let snap = '';
            r.estado = 'enviando'; marcaReleer(f.id, true); apunta();
            vuelo = { r, L, G, lote };
            pase = { id: f.id, uris: lote, quita: true }; // un solo uso: la puerta de quitar lo gasta
            try {
              const w = await spotify('DELETE', '/playlists/' + f.id + '/items', { cuerpo: { items: lote.map(u => ({ uri: u })) }, leida });
              L.estado = w.estado; snap = String((w.cuerpo && w.cuerpo.snapshot_id) || ''); L.sello = !!snap;
            } catch (e) {
              L.estado = e.status || null; L.error = txtErr(e); L.incierta = !!e.incierta; L.corte = !!e.corte;
            } finally { pase = null; }
            L.enviada = S.cont.spEscr > n0;
            if (!L.enviada) { vuelo = null; marcaReleer(f.id, false); r.estado = 'noenviada'; r.detalle = L.error; res.fin = 'Una petición de quitar de «' + f.nombre + '» no ha salido.'; break; }
            enviados++;
            if (L.corte) { vuelo = null; r.estado = 'corte'; G.sinComprobar.push(...lote); res.fin = 'Spotify ha cortado las peticiones al quitar de «' + f.nombre + '».'; break; }
            // Como al añadir: vaya bien, mal o no se sepa, la petición no se repite; se relee y se compara.
            prog('Comprobando «' + f.nombre + '» en Spotify…', hechas, total);
            const esperado = prev.filter(u => lote.indexOf(u) < 0), bien = L.estado >= 200 && L.estado < 300; // salen todas las copias de cada una, y nada más
            let ua;
            try {
              items = await leePlaylistDirecta(f.id, true); L.relecturas = 1; ua = urisDe(items);
              if ((bien || L.incierta || L.estado == null) && mismas(ua, prev)) { await espera(ESPERA_COMP); items = await leePlaylistDirecta(f.id, true); L.relecturas = 2; ua = urisDe(items); }
              leida = Date.now();
            } catch (e) {
              vuelo = null;
              L.errorComp = txtErr(e); r.estado = 'sincomprobar'; G.sinComprobar.push(...lote);
              res.fin = 'No se ha podido comprobar «' + f.nombre + '» releyéndola.';
              break;
            }
            L.cuadra = mismas(ua, esperado);
            const siguen = lote.filter(u => ua.indexOf(u) >= 0);
            L.estan = siguen.length;
            G.quitadas.push(...lote.filter(u => ua.indexOf(u) < 0)); G.siguen.push(...siguen);
            r.despues = ua.length; r.quitadas += lote.length - siguen.length; hechas += lote.length - siguen.length;
            ponEnLib(f.id, items, bien && L.cuadra ? snap : ''); libSucia = true;
            leidasAhora.set(f.id, ua);
            vuelo = null;
            if (L.cuadra) marcaReleer(f.id, false);
            if (bien && L.cuadra) r.estado = 'amedias';
            else {
              r.estado = bien ? 'nocuadra' : L.cuadra ? 'llego' : (L.incierta || L.estado == null ? 'incierta' : 'rechazada');
              res.fin = bien ? 'Lo releído de «' + f.nombre + '» no cuadra con lo que se pidió quitar.'
                : r.estado === 'llego' ? 'La petición de quitar de «' + f.nombre + '» llegó, pero Spotify no la confirmó: por prudencia se para aquí.'
                  : r.estado === 'incierta' ? 'No se sabe si llegó una petición de quitar de «' + f.nombre + '».' : 'Spotify ha rechazado quitar de «' + f.nombre + '».';
            }
            apunta();
            if (res.fin) break;
            prev = ua;
          }
          if (res.fin) break;
        }
        r.estado = 'ok';
        apunta();
      }
    } catch (e) { // un fallo no previsto: se para aquí y se cuenta lo que haya
      if (vuelo) { // había un lote enviado y sin comprobar: que no conste como «no se ha tocado»
        vuelo.r.estado = 'sincomprobar'; vuelo.L.errorComp = 'error inesperado: ' + txtErr(e); vuelo.G.sinComprobar.push(...vuelo.lote);
      }
      if (!res.fin) res.fin = 'Error inesperado: ' + txtErr(e) + '.';
      S.errores.push({ t: new Date().toISOString(), donde: 'Sincronizar', m: txtErr(e), s: (e && e.status) || '' });
    } finally {
      permiso = null; pase = null;
      S.sim = null; S.c = null; S.plan = null; S.simB = null; S.planB = null;
      if (S.lib) S.lib.vieja = true; // la próxima simulación vuelve a comprobar Spotify
      res.abierta = false;
      S.sinc = res;
      apunta(); // el resultado queda apuntado antes de lo que sigue, que habla con Dropbox y puede tardar o fallar
      // El registro de B: qué canción hay de cada favorito en cada playlist tocada, y lo quitado deja de constar.
      if (esB) {
        try { if (apuntaSx(SIM, marcadas, reg, leidasAhora)) { clearTimeout(memReloj); await memGuarda(); } }
        catch (e) { S.errores.push({ t: new Date().toISOString(), donde: 'Registro de Soundeo', m: txtErr(e), s: '' }); }
      }
      try { if (libSucia) await libCacheGuarda(); } catch (e) { /* ya avisa libCacheGuarda */ }
      // El registro se guarda siempre, aunque no se haya enviado nada: es también el cierre del testigo.
      try {
        prog('Guardando el registro en Dropbox…');
        res.registro = (await dbxSube(rutaRegistro, JSON.stringify(construyeRegistro(res, marcadas, reg), null, 1), 'add', true)).name;
      } catch (e) { res.errorRegistro = txtErr(e); }
      apunta();
    }
    const rs = resumenSinc(res);
    aviso('Sincronización ' + rs.texto, rs.clase === 'ok' ? 'info' : 'error');
  }
  // Una sola sincronización a la vez en este navegador: con dos pestañas, la segunda no empieza.
  async function sincronizaSola(prog, esB) {
    const cerrojos = typeof navigator !== 'undefined' && navigator.locks;
    if (!cerrojos || typeof cerrojos.request !== 'function') return sincroniza(prog, esB);
    return cerrojos.request('synchrosound-sincronizar', { ifAvailable: true }, async tengo => {
      if (!tengo) { S.plan = null; S.planB = null; throw new Error('Hay otra sincronización en marcha en otra pestaña de este navegador. Desde esta no se ha enviado nada a Spotify.'); }
      return sincroniza(prog, esB);
    });
  }
  /* Tras sincronizar B, el registro (memoria común, sección «sx») apunta, de cada playlist tocada y tal como se
     releyó al final: qué canción de Spotify hay de cada favorito (la añadida y comprobada, o la que ya estaba y
     la app emparejó) y, de lo quitado y comprobado, que ya no consta. Devuelve si ha cambiado algo. */
  function apuntaSx(sim, marcadas, reg, leidas) {
    const ahora = Date.now(), M = S.mem.sx;
    let cambio = false;
    const toca = (id, fn) => {
      const k = String(id), r = M[k] && typeof M[k] === 'object' ? JSON.parse(JSON.stringify(M[k])) : { p: {} };
      if (!r.p || typeof r.p !== 'object') r.p = {};
      if (fn(r) === false) return;
      r.t = ahora; M[k] = r; cambio = true;
    };
    marcadas.forEach((f, i) => {
      const fin = leidas.get(f.id), k = f.clave;
      if (!fin || !reg[i]) return;
      const dentro = new Set(fin);
      reg[i].quitadas.forEach(uri => {
        if (dentro.has(uri)) return;
        Object.keys(M).forEach(id => {
          const m = M[id];
          if (m && m.p && m.p[k] === uri && m.q && m.q[k] === f.id) toca(id, r => { delete r.p[k]; if (r.q) delete r.q[k]; if (r.o) delete r.o[k]; });
        });
      });
      const puestas = new Set(reg[i].anadidas);
      sim.unicas.forEach(u => {
        const d = u.destinos.find(x => x.clave === k), uri = d ? uriEn(u, d) : null;
        if (!uri || !dentro.has(uri)) return;
        toca(u.sx.id, r => {
          const igual = r.p[k] === uri && !!r.q && r.q[k] === f.id;
          if (igual && (k !== 'down' || r.d) && r.n === u.sx.texto) return false;
          if (!r.q || typeof r.q !== 'object') r.q = {};
          if (!r.o || typeof r.o !== 'object') r.o = {};
          // «o» = la añadió la app en esta sincronización; si ya estaba ahí, la app solo la ha emparejado
          if (!igual) { if (puestas.has(uri)) r.o[k] = 1; else delete r.o[k]; }
          r.p[k] = uri; r.q[k] = f.id; r.n = u.sx.texto;
          if (k === 'down') r.d = 1;
          return true;
        });
      });
    });
    if (cambio) { sxGuardaLocal(); memToca(); }
    return cambio;
  }
  // Qué ha pasado en una playlist, en una frase.
  function textoPl(r) {
    const n = '«' + r.nombre + '»: ', u = r.lotes[r.lotes.length - 1] || {};
    const cuenta = '(' + r.antes + ' antes, ' + r.despues + ' ahora)';
    const estan = 'de las ' + u.n + ' enviadas se ven ' + u.estan + (u.repes ? ', ' + u.repes + ' de ellas repetidas' : '') + ' ' + cuenta;
    // Lo que no se ve puede estar: Spotify a veces tarda en enseñar un cambio. Que no se dé por perdido ni se añada a mano.
    const ojo = u.estan < u.n ? ' Spotify puede tardar en enseñar un cambio: espera un par de minutos y simula otra vez antes de añadir nada a mano.' : '';
    if (u.quita && r.estado !== 'ok') return n + textoQuita(r, u, cuenta);
    const yQuitadas = r.quitar == null ? '' : (r.quitar ? ' y quitadas ' + r.quitadas + ' de ' + r.quitar : '') + (r.sinDown ? ' (' + r.sinDown + ' no se han quitado porque todavía no están en Sound Down)' : '');
    switch (r.estado) {
      case 'ok': return n + 'añadidas ' + r.anadidas + yQuitadas + ' ' + cuenta + '. Comprobado releyendo la playlist.';
      case 'cambiada': return n + 'no se ha tocado. Al releerla justo antes de escribir no era la misma que vio la simulación (ahora tiene ' + canciones(r.antes) + '). Simula otra vez.';
      case 'sinleer': return n + 'no se ha tocado: no se ha podido leer (' + r.detalle + ').';
      case 'parada': return n + 'parada a medias. Añadidas ' + r.anadidas + ' de ' + r.pedidas + (r.quitar ? '; quitadas ' + (r.quitadas || 0) + ' de ' + r.quitar : '') + ' ' + cuenta + (r.quitar ? '; lo hecho está comprobado.' : '; lo añadido está comprobado.');
      case 'noenviada': return n + 'un lote no ha salido (' + r.detalle + '). Añadidas ' + r.anadidas + ' de ' + r.pedidas + '.';
      case 'corte': return n + 'Spotify cortó las peticiones al enviar ' + canciones(u.n) + '. No se puede comprobar ahora y la escritura no se repite: míralo en Spotify. Comprobadas antes del corte: ' + r.anadidas + ' de ' + r.pedidas + '.';
      case 'sincomprobar': return n + 'enviadas ' + canciones(u.n) + ' (respuesta: ' + (u.estado == null ? 'ninguna' : u.estado) + ') y no se ha podido comprobar releyendo: ' + String(u.errorComp).replace(/\.+$/, '') + '. La escritura no se repite: míralo en Spotify.';
      case 'rechazada': return n + 'Spotify ha rechazado la escritura: ' + String(u.error).replace(/\.+$/, '') + '. Al releer, ' + estan + '. La escritura no se ha repetido.';
      case 'llego': return n + 'Spotify no confirmó la escritura: ' + String(u.error).replace(/\.+$/, '') + '. Al releer están las ' + u.n + ' enviadas ' + cuenta + '; la escritura no se ha repetido.';
      case 'amedias': return n + 'se quedó a medias. Añadidas ' + r.anadidas + ' de ' + r.pedidas + ' ' + cuenta + '; lo añadido está comprobado.';
      case 'incierta': return n + 'enviada una vez, y no se sabe si llegó: ' + String(u.error).replace(/\.+$/, '') + '. Al releer, ' + estan + '. La escritura no se ha repetido.' + ojo;
      case 'nocuadra': return n + 'Spotify respondió ' + u.estado + ', pero al releer no cuadra: ' + estan + '. La escritura no se ha repetido.' + (ojo || ' Míralo en Spotify.');
      case 'enviando': return n + 'quedó a mitad de enviar ' + canciones(u.n) + ' (si la página se cerró o se recargó ahí, no se sabe si llegaron). La escritura no se repite: simula otra vez y se verá lo que hay' + (r.anadidas ? ' (antes de eso, añadidas y comprobadas: ' + r.anadidas + ')' : '') + '.';
      default: return n + 'no se ha tocado: la sincronización se paró antes de llegar a ella.';
    }
  }
  // Lo mismo cuando lo que falló fue una petición de quitar (botón B).
  function textoQuita(r, u, cuenta) {
    const hecho = (r.anadidas ? 'Añadidas ' + r.anadidas + '. ' : '') + 'Quitadas y comprobadas: ' + (r.quitadas || 0) + ' de ' + r.quitar + ' ' + cuenta + '.';
    const siguen = 'de las ' + u.n + ' que se pidió quitar siguen ' + u.estan;
    const sinP = t => String(t).replace(/\.+$/, '');
    switch (r.estado) {
      case 'parada': return 'parada a medias. ' + hecho;
      case 'noenviada': return 'una petición de quitar no ha salido (' + r.detalle + '). ' + hecho;
      case 'corte': return 'Spotify cortó las peticiones al quitar ' + canciones(u.n) + '. No se puede comprobar ahora y la petición no se repite: míralo en Spotify. ' + hecho;
      case 'sincomprobar': return 'se pidió quitar ' + canciones(u.n) + ' (respuesta: ' + (u.estado == null ? 'ninguna' : u.estado) + ') y no se ha podido comprobar releyendo: ' + sinP(u.errorComp) + '. La petición no se repite: míralo en Spotify.';
      case 'rechazada': return 'Spotify ha rechazado quitar: ' + sinP(u.error) + '. Al releer, ' + siguen + ' ' + cuenta + '. La petición no se ha repetido.';
      case 'llego': return 'Spotify no confirmó la petición de quitar: ' + sinP(u.error) + '. Al releer ya no están las ' + u.n + ' ' + cuenta + '; la petición no se ha repetido.';
      case 'amedias': return 'se quedó a medias. ' + hecho;
      case 'incierta': return 'se pidió quitar una vez, y no se sabe si llegó: ' + sinP(u.error) + '. Al releer, ' + siguen + ' ' + cuenta + '. La petición no se ha repetido. Spotify puede tardar en enseñar un cambio: espera un par de minutos y simula otra vez.';
      case 'nocuadra': return 'Spotify respondió ' + u.estado + ' al quitar, pero al releer no cuadra: ' + siguen + ' ' + cuenta + '. La petición no se ha repetido. Míralo en Spotify.';
      case 'enviando': return 'quedó a mitad de quitar ' + canciones(u.n) + ' (si la página se cerró o se recargó ahí, no se sabe si se quitaron). La petición no se repite: simula otra vez y se verá lo que hay.';
      default: return 'no se ha tocado: la sincronización se paró antes de llegar a ella.';
    }
  }
  // El resultado entero, en una frase. clase: 'ok' | 'mal'.
  function resumenSinc(r) {
    if (r.b) return resumenSincB(r);
    const bien = r.pls.filter(p => p.estado === 'ok').length, tot = r.pls.reduce((n, p) => n + p.anadidas, 0);
    if (r.abierta && S.tarea && S.tarea.nombre === TAREA_SINC) return { clase: 'mal', texto: 'en marcha ahora mismo, en esta pestaña. Añadidas y comprobadas hasta este momento: ' + canciones(tot) + '.' };
    if (r.abierta) return { clase: 'mal', texto: 'sin terminar: o sigue en marcha en otra pestaña, o la página se cerró o se recargó antes de acabar. Añadidas y comprobadas hasta ese momento: ' + canciones(tot) + '. Si se cerró a medias no queda registro en Dropbox (la copia previa sí): simula otra vez para ver cómo está Spotify.' };
    if (!r.fin && bien === r.pls.length) return { clase: 'ok', texto: 'completa: añadidas ' + canciones(tot) + ' en ' + nPlaylists(bien) + ', comprobadas releyendo cada playlist.' };
    if (!r.fin) return { clase: 'mal', texto: 'terminada con ' + nPlaylists(r.pls.length - bien) + ' sin tocar. Añadidas y comprobadas: ' + canciones(tot) + '.' };
    return { clase: 'mal', texto: 'parada. ' + r.fin + ' Añadidas y comprobadas hasta ese momento: ' + canciones(tot) + '. Ninguna escritura se ha repetido.' };
  }

  function resumenSincB(r) {
    const bien = r.pls.filter(p => p.estado === 'ok').length, tot = r.pls.reduce((n, p) => n + p.anadidas, 0), quit = r.pls.reduce((n, p) => n + (p.quitadas || 0), 0);
    const sinD = r.pls.reduce((n, p) => n + (p.sinDown || 0), 0);
    const hecho = 'añadidas ' + tot + ' y quitadas ' + quit + (sinD ? ' (' + sinD + ' sin quitar de Sound Try: todavía no ' + (sinD === 1 ? 'está' : 'están') + ' en Sound Down)' : '');
    if (r.abierta && S.tarea && S.tarea.nombre === TAREA_SINC) return { clase: 'mal', texto: 'de Soundeo en marcha ahora mismo, en esta pestaña. Hasta este momento, comprobadas: ' + hecho + '.' };
    if (r.abierta) return { clase: 'mal', texto: 'de Soundeo sin terminar: o sigue en marcha en otra pestaña, o la página se cerró o se recargó antes de acabar. Hasta ese momento, comprobadas: ' + hecho + '. Si se cerró a medias no queda registro en Dropbox (la copia previa sí): simula otra vez para ver cómo está Spotify.' };
    if (!r.fin && bien === r.pls.length) return { clase: 'ok', texto: 'de Soundeo completa: ' + hecho + ' en ' + nPlaylists(bien) + ', comprobado releyendo cada playlist.' };
    if (!r.fin) return { clase: 'mal', texto: 'de Soundeo terminada con ' + nPlaylists(r.pls.length - bien) + ' sin tocar. Comprobadas: ' + hecho + '.' };
    return { clase: 'mal', texto: 'de Soundeo parada. ' + r.fin + ' Hasta ese momento, comprobadas: ' + hecho + '. Ninguna petición se ha repetido.' };
  }

  // ---------------- diagnóstico (sin tokens ni datos de acceso) ----------------
  function diagnostico() {
    const L = [];
    const p = s => L.push(s);
    p('SynchroSound ' + VERSION + ' — añade a «NS -» y «OG -»; añade y quita en Sound All, Sound Down y Sound Try; todo con confirmación — buscador v' + C.MATCHER);
    p('Fecha: ' + new Date().toISOString());
    p('Navegador: ' + navigator.userAgent);
    p('Dropbox: ' + (S.db ? 'conectado; permisos: ' + (S.db.scope || '(no informados)') : 'sin conectar'));
    p('Memoria: ' + (S.memLista ? 'cargada' + (S.memRev ? '' : ' (aún sin archivo)') : 'sin cargar'));
    p('Spotify: ' + (S.sp ? 'conectado; permisos: ' + (S.sp.scope || '(no informados)') : 'sin conectar'));
    p('Permiso de escritura en este dispositivo: ' + (tieneEscritura() ? 'sí' : 'no'));
    p('Peticiones a Spotify: ' + S.cont.spGet + ' GET; escrituras enviadas: ' + S.cont.spEscr + '; escrituras bloqueadas por la app: ' + S.cont.spBloqueadas + '; avisos de límite (429): ' + S.cont.sp429);
    const sc = ultimaSinc();
    if (sc) {
      p('Sincronización: ' + fechaHora(sc.t) + ' (v' + sc.v + '): ' + resumenSinc(sc).texto);
      p('  copia previa: ' + sc.copia + (sc.completa ? '; copia completa: ' + sc.completa : '') + '; registro: ' + (sc.registro || (sc.errorRegistro ? 'NO GUARDADO (' + sc.errorRegistro + ')' : 'no se llegó a guardar')));
      sc.pls.forEach(r => {
        p('  ' + r.nombre + ' (' + visib(r.publica) + '): ' + r.estado + '; pedidas ' + r.pedidas + '; antes ' + (r.antes == null ? '?' : r.antes) + '; después ' + (r.despues == null ? '?' : r.despues) + '; añadidas ' + r.anadidas + (r.detalle ? '; ' + r.detalle : ''));
        r.lotes.forEach((L, i) => p('    lote ' + (i + 1) + ': ' + L.n + '; enviado: ' + (L.enviada ? 'sí, una vez' : r.estado === 'enviando' && i === r.lotes.length - 1 ? 'no se sabe (la página se cerró)' : 'no') + '; respuesta: ' + (L.estado == null ? 'ninguna' : L.estado) + '; sello nuevo: ' + (L.sello ? 'sí' : 'no') +
          '; relecturas: ' + L.relecturas + '; cuadra: ' + (L.cuadra == null ? 'sin comprobar' : L.cuadra ? 'sí' : 'NO') + '; se ven: ' + (L.estan == null ? '?' : L.estan + ' de ' + L.n) + (L.repes ? ' (' + L.repes + ' repetidas)' : '') +
          (L.error ? '; error: ' + L.error : '') + (L.incierta ? ' [no se sabe si llegó]' : '') + (L.corte ? ' [corte de Spotify]' : '') + (L.errorComp ? '; error al comprobar: ' + L.errorComp : '')));
      });
    } else p('Sincronización: sin hacer');
    const uh = usoDe(hoy());
    p('Peticiones a Spotify hoy: ' + uh.total + ' entre todos tus dispositivos (este: ' + uh.propio + ')');
    p('Búsquedas nuevas hoy: ' + uh.busq + ' de ' + topeBusq() + ' como mucho (tope diario)' + (S.cont.tope ? '; canciones que se quedaron sin buscar en esta sesión: ' + S.cont.tope : ''));
    const dias = {};
    Object.keys((S.mem && S.mem.uso) || {}).forEach(k => { const d = k.slice(0, 10); if (d !== hoy()) dias[d] = (dias[d] || 0) + (S.mem.uso[k].n || 0); });
    const antes = Object.keys(dias).sort().slice(-7);
    if (antes.length) p('  días anteriores: ' + antes.map(d => d.slice(8) + '/' + d.slice(5, 7) + ' ' + dias[d]).join('; '));
    const ct = corteSp();
    p('Último corte de Spotify: ' + (ct ? fechaHora(ct.t) + ' en ' + (ct.ruta || '(llamada sin apuntar)') + (ct.escr ? ' (escritura)' : '') + '; motivo: ' + (ct.motivo || 'no lo dice') + '; plazo: ' + (ct.espera != null ? duracion(ct.espera) : 'no legible') +
      (ct.mano ? '; a mano: Retry-After ' + ct.mano.s + ' s (escrito el ' + fechaHora(ct.mano.t) + '), vuelve el ' + fechaHora(ct.mano.hasta) : '') +
      (ct.fin ? '; volvió a responder el ' + fechaHora(ct.fin)
        : Date.now() < ct.hasta ? '; los botones no envían nada hasta ' + horaODia(ct.hasta) + ' (la app nunca prueba sola)'
        : '; la espera ' + (ct.hasta ? 'terminó a ' + horaODia(ct.hasta) : 'no tiene hora de fin') + '; todavía no se ha visto responder a esa llamada') : 'ninguno apuntado'));
    p('Búsquedas: ' + S.cont.busquedas + ' nuevas, ' + S.cont.deCache + ' de caché; de ellas, ' + S.cont.ext + ' buscando la Extended. Peticiones a Dropbox: ' + S.cont.db);
    if (S.xml) {
      const X = S.xml.datos;
      p('XML: ' + S.xml.ruta + ' (' + kb(S.xml.tam) + '), último cambio ' + fechaHora(S.xml.fecha) + ', comprobado ' + soloHora(S.xml.visto) + ', ' + X.producto);
      p('  entradas ' + X.entradas + '; ignoradas: ' + X.ignoradas.soundcloud + ' de SoundCloud, ' + X.ignoradas.sampler + ' samples; playlists ' + X.playlists.length + ' (del mapa ' + X.delMapa.length + ')');
    } else p('XML: sin elegir');
    if (S.lib) {
      const pr = S.lib.playlists.filter(x => x.propia).length, sin = S.lib.playlists.filter(x => !x.contenido).length;
      p('Biblioteca: ' + S.lib.playlists.length + ' playlists (' + pr + ' propias, ' + sin + ' sin contenido), ' + S.lib.likes.length + ' likes; leída ' + fechaHora(S.lib.leida) + (S.lib.vieja ? ' (la app ha escrito después: la próxima simulación vuelve a comprobarla)' : ''));
      p('  ' + textoLectura(S.lib.lectura));
      const ln = S.lib.lectura;
      if (ln && ln.nombres && ln.nombres.length) {
        p('  playlists releídas: ' + (ln.iguales === 0 && ln.nombres.length > 1 ? 'todas (' + ln.nombres.length + ')'
          : ln.nombres.slice(0, 30).map(x => '«' + x + '»').join(', ') + (ln.nombres.length > 30 ? ' y ' + (ln.nombres.length - 30) + ' más' : '')));
      }
    } else p('Biblioteca de Spotify: sin leer');
    if (S.xml && S.lib) {
      const m = mapaActual();
      p('Mapa:');
      S.xml.datos.delMapa.forEach(pl => p('  ' + pl.clave + ' (' + pl.ids.length + ') -> ' + (m.mapa[pl.clave] ? m.mapa[pl.clave].nombre + (m.mapa[pl.clave].manual ? ' [a mano]' : '') : 'SIN PAREJA')));
      const s = soundeoActual();
      p('Soundeo: ' + SOUNDEO.map(([k, n]) => n + (s[k] ? ' ok (' + s[k].items.length + ')' : ' no encontrada')).join('; '));
    }
    if (S.sim) {
      const c = cuenta(S.sim);
      p('Simulación ' + fechaHora(S.sim.fecha) + (S.sim.incompleta ? ' [INCOMPLETA ' + S.sim.hechas + '/' + S.sim.unicas.length + ']' : '') + ': únicas ' + S.sim.unicas.length + '; ya están ' + c.ya + '; se añadirían ' + c.add + '; dudosas ' + c.duda + '; no están ' + c.no + (c.pend ? '; sin buscar por el tope ' + c.pend : ''));
      porPlaylist(S.sim).forEach(f => p('  ' + f.pl.clave + ': ya ' + f.ya + ', añadir ' + f.add + ', dudosas ' + f.duda + ', no están ' + f.no + (f.pend ? ', sin buscar ' + f.pend : '')));
      const de = e => S.sim.unicas.filter(u => u.estado === e);
      p('Dudosas (' + de('duda').length + '):');
      de('duda').slice(0, 80).forEach(u => {
        p('  RB ' + lineaRb(u.rb) + ' [' + C.mmss(u.rb.dur) + ']' + (u.decidida ? ' [con respuesta tuya]' : ''));
        u.dudosas.forEach(d => p('     ? ' + lineaSp(d.sp.m) + ' [' + C.mmss(d.sp.dur) + '] p=' + Math.round(d.r.p) + ' t=' + d.r.titulo + ' a=' + d.r.artista + ' v=' + d.r.version));
      });
      p('No están (' + de('no').length + '); con ~ lo más parecido que devolvió Spotify:');
      de('no').slice(0, 120).forEach(u => {
        p('  RB ' + lineaRb(u.rb) + ' [' + C.mmss(u.rb.dur) + '] q=' + JSON.stringify(u.consultas || []) + ' cand=' + (u.cands ? u.cands.size : 0) + (u.ninguna ? ' [ninguna es]' : u.decidida ? ' [con respuesta tuya]' : ''));
        C.cercanas(u.rb, u.cands ? Array.from(u.cands.values()) : [], 2).forEach(c =>
          p('     ~ ' + lineaSp(c.sp.m) + ' [' + C.mmss(c.sp.dur) + '] t=' + c.e.titulo + ' a=' + c.e.artista + ' v=' + c.e.version));
      });
      p('Se añadirían (' + de('add').length + '):');
      p('  con aviso ' + de('add').filter(u => riesgoDe(u) > 0).length + ', que van primero (r3 = en Spotify dura más que el archivo)');
      porRiesgo(de('add')).forEach(u => p('  ' + (riesgoDe(u) ? 'r' + riesgoDe(u) + ' ' : '') + lineaRb(u.rb) + ' [' + C.mmss(u.rb.dur) + '] -> ' + lineaSp(u.elegida.sp.m) + ' [' + C.mmss(u.elegida.sp.dur) + ']' + (u.elegida.r.nota ? ' | ' + u.elegida.r.nota : '')));
      p('Ya están (' + de('ya').length + '):');
      de('ya').forEach(u => {
        const y = u.destinos.find(d => d.ya).ya;
        p('  ' + lineaRb(u.rb) + ' [' + C.mmss(u.rb.dur) + '] = ' + lineaSp(y.sp.m) + ' [' + C.mmss(y.sp.dur) + ']' + (y.r.otraVersion ? ' | otra versión' : ''));
      });
    } else p('Simulación: sin hacer');
    if (S.sx) {
      const l = S.sx.lista, av = sxAvisos(l);
      p('Soundeo: lista ' + S.sx.ruta + ', leída el ' + fechaHora(l.t) + ' (lector ' + (l.lector || '?') + '): ' + textoLista(l) + '; sin publicar ' + l.fav.filter(f => f[3] === 2).length +
        '; en «Mis descargas» ' + l.dow.length + '; páginas ' + l.pag.join('+') + '; ' + (av.length ? 'AVISOS: ' + av.join('; ') : 'completa'));
    } else p('Soundeo: ' + (S.sxLlegada ? 'lista recibida sin guardar' : S.sxMirado ? 'sin ninguna lista en Dropbox' : 'sin mirar'));
    if (S.simB) {
      const c = cuenta(S.simB), f = porPlaylistB(S.simB), pl = soundeoActual();
      p('Simulación B ' + fechaHora(S.simB.fecha) + (S.simB.incompleta ? ' [INCOMPLETA ' + S.simB.hechas + '/' + S.simB.unicas.length + ']' : '') + ': favoritos ' + S.simB.unicas.length + '; ya están ' + c.ya + '; se añadirían ' + c.add + '; dudosas ' + c.duda + '; no están ' + c.no + (c.pend ? '; sin buscar por el tope ' + c.pend : ''));
      SOUNDEO.forEach(([k, nombre]) => p('  ' + nombre + (pl[k] ? '' : ' [SIN PAREJA]') + ': ya ' + f[k].ya + ', añadir ' + f[k].add + ', dudosas ' + f[k].duda + ', no están ' + f[k].no + (f[k].pend ? ', sin buscar ' + f[k].pend : '')));
      const de = e => S.simB.unicas.filter(u => u.estado === e);
      p('  Dudosas B (' + de('duda').length + '):');
      de('duda').slice(0, 80).forEach(u => {
        p('    SX ' + lineaRb(u.rb) + ' [' + C.mmss(u.rb.dur) + ']' + (u.decidida ? ' [con respuesta tuya]' : ''));
        u.dudosas.forEach(d => p('       ? ' + lineaSp(d.sp.m) + ' [' + C.mmss(d.sp.dur) + '] p=' + Math.round(d.r.p) + ' t=' + d.r.titulo + ' a=' + d.r.artista + ' v=' + d.r.version));
      });
      p('  No están B (' + de('no').length + '); con ~ lo más parecido que devolvió Spotify:');
      de('no').slice(0, 120).forEach(u => {
        p('    SX ' + lineaRb(u.rb) + ' [' + C.mmss(u.rb.dur) + '] q=' + JSON.stringify(u.consultas || []) + ' cand=' + (u.cands ? u.cands.size : 0) + (u.ninguna ? ' [ninguna es]' : u.decidida ? ' [con respuesta tuya]' : ''));
        C.cercanas(u.rb, u.cands ? Array.from(u.cands.values()) : [], 2).forEach(c =>
          p('       ~ ' + lineaSp(c.sp.m) + ' [' + C.mmss(c.sp.dur) + '] t=' + c.e.titulo + ' a=' + c.e.artista + ' v=' + c.e.version));
      });
      const enSx = t => String(t).replace(/en rekordbox/g, 'en Soundeo');
      p('  Se añadirían B (' + de('add').length + '):');
      porRiesgo(de('add')).forEach(u => p('    ' + (riesgoDe(u) ? 'r' + riesgoDe(u) + ' ' : '') + lineaRb(u.rb) + ' [' + C.mmss(u.rb.dur) + '] -> ' + lineaSp(u.elegida.sp.m) + ' [' + C.mmss(u.elegida.sp.dur) + '] a ' + u.destinos.filter(d => !d.ya && !d.mano).map(d => d.nombre).join(' y ') + (u.elegida.r.nota ? ' | ' + enSx(u.elegida.r.nota) : '')));
      // Lo que la app tiene apuntado de B y lo que haría hoy con ello (sin títulos: solo cuentas y motivos).
      const P = S.simB.planB, nReg = sxApuntados();
      p('  Registro de B: ' + nReg + ' favoritos apuntados' + (S.sxRecuperados ? ' (' + S.sxRecuperados + ' apuntes recuperados de este navegador: faltaban en Dropbox)' : '') + '. Quitar: ' + (S.simB.quitarVale ? 'se puede proponer' : 'esta vez no (' + ((S.sx && sxAvisos(S.sx.lista).join('; ')) || 'la lista no vale') + ')'));
      if (P) SOUNDEO.forEach(([k, nombre]) => {
        const q = P[k].quitar, cuentaM = m => q.filter(x => x.motivo === m).length;
        p('    ' + nombre + (P[k].usable ? '' : ' [NO SE PUEDE USAR]') + ': añadir ' + P[k].anadir.length + '; quitar ' + q.length + (q.length ? ' (descargadas ' + cuentaM('descargada') + ', sin estrella ' + cuentaM('sin-estrella') + ', «No es» ' + cuentaM('no-es') + ')' : '') +
          '; quitadas a mano ' + P[k].mano.length + (P[k].mano.length ? ' (dejadas así ' + P[k].mano.filter(m => m.asi).length + ')' : ''));
      });
      const man = S.simB.unicas.filter(u => u.destinos.some(d => d.mano));
      if (man.length) {
        p('  Quitadas a mano B (' + man.length + '):');
        man.slice(0, 60).forEach(u => p('    SX ' + lineaRb(u.rb) + ' fuera de ' + u.destinos.filter(d => d.mano).map(d => d.nombre + (d.asi ? ' [dejada así]' : '')).join(' y ')));
      }
    } else p('Simulación B: sin hacer');
    if (S.c) p('Sin repartir: ' + S.c.filas.length + ' (ocultas ' + S.c.filas.filter(f => oculta(f.uri)).length + '); likes desde ' + S.c.desde + '; cuentan como repartidas: ' + S.c.rep.length + ' playlists');
    if (S.ultimaCopia) p('Última copia: ' + S.ultimaCopia.nombre + ' (' + kb(S.ultimaCopia.tam) + '): ' + JSON.stringify(S.ultimaCopia.resumen));
    p('Errores (' + S.errores.length + '):');
    S.errores.slice(-20).forEach(e => p('  ' + e.t + ' ' + e.donde + ' ' + (e.s || '') + ' ' + e.m));
    return L.join('\n');
  }
  async function copia(texto) {
    try { await navigator.clipboard.writeText(texto); aviso('Copiado. Pégalo en la conversación con Claude.'); }
    catch (e) {
      const ta = document.getElementById('diag');
      if (ta) { ta.focus(); ta.select(); }
      aviso('No se ha podido copiar solo: el texto está seleccionado, cópialo a mano.');
    }
  }

  // ---------------- versión ----------------
  async function miraVersion() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (j && j.version && j.version !== VERSION) { S.nueva = j.version; pinta(); }
    } catch (e) { /* sin red: no pasa nada */ }
  }

  // ================= interfaz =================
  const VISTAS = [['cuentas', '', 'Cuentas'], ['a', 'A', 'rekordbox a Spotify'], ['b', 'B', 'Soundeo a Spotify'], ['c', 'C', 'Sin repartir'], ['copia', '', 'Copia'], ['diag', '', 'Diagnóstico']];
  function ir(v) { S.vista = v; S.confRelee = false; ls.set('ss.vista', v); window.scrollTo(0, 0); if (v === 'b') sxMira(false); pinta(); }
  const boton = (texto, fn, clase, off) => h('button', { class: 'btn ' + (clase || ''), type: 'button', onclick: fn, disabled: !!off || !!S.tarea }, texto);
  const enlace = (texto, href) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, texto);
  // Enlace «spotify:»: lo abre la app de Spotify instalada, sin pestaña nueva. Va sin target a propósito.
  const enlaceApp = (texto, uri) => h('a', { href: uri, class: 'app' }, texto);

  function cabecera() {
    const escritas = S.sp ? S.sp.scope.split(/\s+/).filter(Boolean) : [];
    const esc = algunaEscritura();
    return h('header', { class: 'cab' },
      h('div', { class: 'cab-fila' },
        h('div', { class: 'marca' }, 'SynchroSound', h('span', { class: 'ver', title: 'Versión' }, 'v' + VERSION)),
        h('button', { class: 'candado' + (esc ? ' abierto' : ''), type: 'button', 'aria-expanded': S.candado ? 'true' : 'false', onclick: () => { S.candado = !S.candado; pinta(); } },
          h('span', { class: 'pestillo', 'aria-hidden': 'true' }, h('span', { class: 'pestillo-pieza' })), esc ? 'Escritura limitada' : 'Solo lectura')),
      S.candado && h('div', { class: 'candado-panel' + (esc ? ' abierto' : '') },
        esc
          ? [h('p', null, 'En este dispositivo Spotify ha concedido permiso para modificar playlists. Desde ese momento ya no es Spotify quien impide un cambio en tus playlists: es el código de esta página.'),
            h('p', null, 'Esta versión solo deja salir dos cosas, las dos después de guardar una copia en Dropbox y solo con lo que tú marcas y confirmas: (1) añadir canciones al final de tus playlists «NS - …» y «OG - …» del mapa (pestaña A) y de «Sound All», «Sound Down» y «Sound Try» (pestaña B); (2) quitar canciones de esas tres de Soundeo, y solo las que la app tiene apuntadas como pareja de un favorito tuyo (las que añadió ella y las que ya estaban y emparejó). De una «NS -», de una «OG -» o de cualquier otra playlist no puede quitar nada. Cualquier otra cosa (otra playlist, reordenar, reemplazar, crear) se corta antes de salir.'),
            h('p', null, 'Tus likes no se pueden tocar: ese permiso (user-library-modify) no se pide, así que ahí sigue mandando Spotify.')]
          : h('p', null, 'En este dispositivo la app no puede cambiar nada en tu Spotify. Lo garantiza Spotify, no solo el código: aquí solo tiene permisos de lectura, así que Spotify rechaza cualquier intento de añadir, quitar o crear.'),
        h('p', null, 'Permisos pedidos: ' + PERMISOS_SPOTIFY.join(', ') + '.'),
        S.sp && h('p', null, 'Permisos que Spotify dice haber concedido: ' + (escritas.join(', ') || '(no lo ha dicho)') + '.'),
        h('p', null, 'En esta sesión: ' + S.cont.spGet + ' lecturas de Spotify y ' + S.cont.spEscr + (S.cont.spEscr === 1 ? ' escritura.' : ' escrituras.')),
        h('p', null, 'Peticiones a Spotify hoy: ' + usoDe(hoy()).total + ' entre todos tus dispositivos (este: ' + usoDe(hoy()).propio + ').'),
        h('p', null, 'Búsquedas nuevas hoy: ' + usoDe(hoy()).busq + ' de ' + topeBusq() + ' como mucho.'),
        h('p', null, 'En Dropbox la app solo ve su carpeta. Ahí escribe archivos nuevos (copias) y su memoria; no borra nada y no toca el XML de rekordbox.')),
      S.nueva && h('div', { class: 'nueva' }, 'Hay una versión nueva (' + S.nueva + '). ',
        h('button', { class: 'btn mini', type: 'button', disabled: !!S.tarea, onclick: () => location.replace(location.pathname + '?v=' + encodeURIComponent(S.nueva)) }, 'Recargar')),
      h('nav', { class: 'pestanas', 'aria-label': 'Secciones' }, VISTAS.map(([v, letra, nombre]) =>
        h('button', { class: 'pestana' + (S.vista === v ? ' activa' : ''), type: 'button', 'aria-current': S.vista === v ? 'page' : null, onclick: () => ir(v) },
          letra && h('span', { class: 'letra' }, letra), nombre))));
  }
  function zonaAvisos() {
    return h('div', { class: 'avisos', role: 'status' }, S.avisos.map(a =>
      h('div', { class: 'aviso ' + a.tipo }, h('span', null, a.texto),
        h('button', { class: 'cerrar', type: 'button', 'aria-label': 'Cerrar aviso', onclick: () => { S.avisos = S.avisos.filter(x => x !== a); pinta(); } }, '×'))));
  }
  function barraTarea() {
    const t = S.tarea;
    if (!t) return null;
    const pct = t.total ? Math.min(100, Math.round(100 * t.hecho / t.total)) : 0;
    return h('div', { class: 'tarea', id: 'tarea' },
      h('div', { class: 'tarea-texto', id: 'tarea-texto' }, t.texto + (t.total ? ' ' + t.hecho + ' de ' + t.total : '')),
      h('div', { class: 'tarea-barra' }, h('div', { class: 'tarea-relleno' + (t.total ? '' : ' sin'), id: 'tarea-relleno', css: { width: (t.total ? pct : 100) + '%' } })),
      h('button', { class: 'btn mini sec', type: 'button', onclick: () => { S.parar = true; } }, 'Parar'));
  }
  function pintaTarea() {
    const t = S.tarea, tx = document.getElementById('tarea-texto'), re = document.getElementById('tarea-relleno');
    if (!t || !tx || !re) { pinta(); return; }
    tx.textContent = t.texto + (t.total ? ' ' + t.hecho + ' de ' + t.total : '');
    re.className = 'tarea-relleno' + (t.total ? '' : ' sin');
    re.style.setProperty('width', (t.total ? Math.min(100, Math.round(100 * t.hecho / t.total)) : 100) + '%');
  }

  // ---- Cuentas ----
  /* Mientras dura un corte de Spotify se dice arriba, con la opción de probar gastando una sola petición y una
     casilla para escribir el plazo que da Spotify. La casilla no va en un formulario: la política de la página
     los prohíbe. */
  function bandaCorte() {
    const c = corteActivo();
    // Lo escrito en la casilla vale para un rechazo concreto: si cambia o termina, se borra.
    if (S.manoDe !== (c ? c.t : null)) { S.manoTxt = ''; S.manoConf = null; S.manoDe = c ? c.t : null; }
    if (!c) return null;
    const ruta = rutaPrueba(c), llamada = ruta.split('?')[0];
    return h('div', { class: 'estado mal corte-sp' }, textoCorte(c, false),
      // El rechazo de una escritura no se prueba repitiéndola: la app no escribe para probar.
      c.escr ? h('div', { class: 'fila-sub' }, 'La app no repite una escritura para probar: espera a que pase el plazo.')
        : [h('div', { class: 'acciones' }, boton('Probar ahora (gasta 1 petición)', () => tarea('Probar Spotify', async () => {
          await spotify('GET', ruta, { aunque: true, prueba: true });
          aviso('Spotify vuelve a responder a la llamada que había rechazado (' + llamada + ').');
        }), 'mini sec')),
        h('div', { class: 'fila-sub' }, 'Prueba la misma llamada que rechazó Spotify (' + llamada + ').')],
      h('div', { class: 'mano' },
        h('label', { for: 'retry-mano' }, 'Plazo que da Spotify (Retry-After, en segundos)'),
        S.manoConf
          ? h('div', { class: 'mano-conf' }, 'Con ' + S.manoConf.s + ' s, Spotify habría vuelto a ' + horaODia(S.manoConf.hasta) + ', que ya ha pasado. Si el número está bien, los botones volverán a enviar ya. ¿Es correcto?',
            h('div', { class: 'acciones' },
              boton('Sí, es correcto', () => guardaMano(true), 'mini'),
              boton('Corregir', () => { S.manoConf = null; pinta(); }, 'mini sec')))
          : h('div', { class: 'acciones' },
            h('input', { id: 'retry-mano', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'p. ej. 3600', value: S.manoTxt, disabled: !!S.tarea,
              oninput: e => { S.manoTxt = e.target.value; },
              onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); guardaMano(false); } },
              onblur: pintaPendiente }),
            boton('Guardar plazo', () => guardaMano(false), 'mini')),
        h('div', { class: 'fila-sub' }, 'Cómo verlo en el PC: F12 → Network → la última fila en rojo → Headers → Response headers → Retry-After. No copies nada de «Request headers»: lleva la llave de tu sesión.')));
  }
  function vistaCuentas() {
    const X = S.xml && S.xml.datos;
    const cand = S.archivos ? S.archivos.filter(pareceXml) : null;
    return [
      h('section', { class: 'bloque' },
        h('h2', null, 'Dropbox'),
        h('p', { class: 'nota' }, 'Guarda las copias y la memoria de la app. SynchroSound solo ve su propia carpeta (Aplicaciones/SynchroSound); el resto de tu Dropbox, tu música incluida, queda fuera de su alcance.'),
        h('p', { class: 'estado' + (S.db ? ' ok' : '') }, S.db ? 'Conectado' + (S.dbNombre ? ' como ' + S.dbNombre : '') + '.' : 'Sin conectar en este dispositivo.'),
        h('div', { class: 'acciones' }, S.db ? boton('Desconectar Dropbox de este dispositivo', () => desconecta('db'), 'sec') : boton('Conectar Dropbox', () => conecta('db')))),
      h('section', { class: 'bloque' },
        h('h2', null, 'Spotify'),
        h('p', { class: 'nota' }, 'Se piden tres permisos para leer playlists y likes y dos para modificar playlists. Con estos últimos la app solo hace una cosa: añadir canciones a tus playlists «NS -» y «OG -» cuando tú lo confirmas en la pestaña A. El permiso de tocar los likes no se pide nunca.'),
        h('p', { class: 'estado' + (S.sp ? ' ok' : '') }, S.sp ? 'Conectado' + (S.yo ? ' como ' + S.yo.nombre : '') + '.' : 'Sin conectar en este dispositivo.'),
        S.sp && h('p', { class: 'nota' }, 'Permisos concedidos: ' + (S.sp.scope || '(Spotify no lo ha dicho)') + '.'),
        S.sp && !tieneEscritura() && h('div', { class: 'estado' }, 'En este dispositivo Spotify está conectado solo con permisos de lectura: todo funciona como antes y aquí no se puede escribir nada. Para sincronizar hay que volver a conectarlo.',
          h('div', { class: 'acciones' }, botonReconecta())),
        S.sp && bandaCorte(),
        h('div', { class: 'acciones' }, S.sp ? boton('Desconectar Spotify de este dispositivo', () => desconecta('sp'), 'sec') : boton('Conectar Spotify', () => conecta('sp')))),
      h('section', { class: 'bloque' },
        h('h2', null, 'rekordbox'),
        h('p', { class: 'nota' }, 'Se lee el XML que rekordbox guarda al cerrarse en la carpeta de SynchroSound de tu Dropbox. La app lo lee y nunca lo modifica.'),
        !S.db ? h('p', { class: 'estado' }, 'Conecta Dropbox para elegir el archivo.') : [
          S.xml ? h('div', { class: 'estado ok' },
            h('div', null, 'Archivo: ' + S.xml.ruta + ', último cambio el ' + fechaHora(S.xml.fecha) + ' (comprobado a las ' + soloHora(S.xml.visto) + ').'),
            h('div', { class: 'fila-sub' }, 'Si cierras rekordbox sin haber cambiado nada, esa fecha no se mueve: el archivo es idéntico y Dropbox no lo cuenta como cambio.'),
            h('div', null, X.entradas + ' entradas (' + X.producto.trim() + '). Del mapa: ' + X.delMapa.filter(p => p.grupo === 'NS').length + ' playlists New School y ' + X.delMapa.filter(p => p.grupo === 'OG').length + ' Old Gems.'),
            h('div', null, 'Ignoradas: ' + X.ignoradas.soundcloud + ' de SoundCloud y ' + X.ignoradas.sampler + (X.ignoradas.sampler === 1 ? ' sample.' : ' samples.')))
            : h('p', { class: 'estado' }, 'Sin archivo elegido.'),
          X && !X.delMapa.length && h('p', { class: 'estado mal' }, 'En este XML no encuentro las carpetas «New School (…)» ni «Old Gems».'),
          h('div', { class: 'acciones' }, boton(S.archivos ? 'Actualizar la lista de archivos' : 'Ver archivos de la carpeta', () => tarea('Leer la carpeta de Dropbox', async () => { S.archivos = await listaCarpeta('', true); }), 'sec')),
          cand && (cand.length ? h('ul', { class: 'lista' }, cand.map(a => h('li', { class: 'fila' },
            h('div', { class: 'fila-cuerpo' }, h('div', { class: 'fila-titulo' }, a.ruta), h('div', { class: 'fila-sub' }, kb(a.tam) + ', modificado el ' + fechaHora(a.fecha))),
            boton(S.xml && S.xml.ruta === a.ruta ? 'Volver a leer' : 'Usar este', () => tarea('Leer el XML', async () => { await cargaXml(a.ruta); ponAjuste('xml', a.ruta); }), 'mini'))))
            : h('p', { class: 'estado' }, 'No hay ningún XML en la carpeta de la app. En rekordbox, pon la carpeta de «XML Auto Export» en Dropbox › Aplicaciones › SynchroSound y cierra rekordbox.')),
        ]),
      h('section', { class: 'bloque' },
        h('h2', null, 'Ajustes'),
        h('p', { class: 'nota' }, 'Spotify limita lo que puede pedir esta app cada día y no dice cuánto. Por eso las búsquedas nuevas tienen un tope diario, entre todos tus dispositivos: al llegar, la app deja de buscar y sigue otro día. Lo ya buscado no se repite.'),
        h('div', { class: 'mapa-sel' },
          h('label', { for: 'tope-busq' }, 'Búsquedas nuevas al día, como mucho: '),
          h('select', { id: 'tope-busq', disabled: !S.mem || !!S.tarea, onchange: e => { ponAjuste('topeBusq', Number(e.target.value)); pinta(); } },
            TOPES_BUSQ.map(n => h('option', { value: String(n), selected: n === topeBusq() }, n + (n === TOPE_BUSQ ? ' (lo normal)' : ''))))),
        h('p', { class: 'estado' }, S.mem ? 'Hoy llevas ' + usoDe(hoy()).busq + ' de ' + topeBusq() + '.' : 'Conecta Dropbox para poder cambiarlo: el ajuste se guarda en la memoria común.')),
      h('section', { class: 'bloque' },
        h('h2', null, 'Soundeo y SoundCloud'),
        h('p', { class: 'nota' }, 'Soundeo no tiene conexión para apps. Tus favoritos (★) y tus descargas los lee un lector pequeño que se instala una vez en el iPhone, en Safari con la extensión Userscripts (la misma de Soundeo Feed). Solo lee, y solo cuando pulsas «Leer Soundeo» en la pestaña B: mientras usas Soundeo no hace nada.'),
        h('p', null, h('a', { href: SX_LECTOR, id: 'sx-instalar', target: '_blank', rel: 'noopener noreferrer' }, 'Instalar el lector de Soundeo')),
        h('p', { class: 'nota' }, 'SoundCloud no se puede conectar: su API no lo permite.')),
    ];
  }

  // ---- A ----
  const CAT = { add: 'Se añadirían', duda: 'Dudosas', no: 'No están en Spotify', ya: 'Ya están', pend: 'Sin buscar', mano: 'Quitadas a mano' };
  function tira(c) {
    const total = c.ya + c.add + c.duda + c.no + (c.pend || 0);
    return h('div', { class: 'tira', role: 'img', 'aria-label': 'Ya están ' + c.ya + ', se añadirían ' + c.add + ', dudosas ' + c.duda + ', no están ' + c.no + (c.pend ? ', sin buscar ' + c.pend : '') },
      ['ya', 'add', 'duda', 'no', 'pend'].map(k => (c[k] ? h('span', { class: 'tramo ' + k, css: { 'flex-grow': String(c[k]) } }) : null)),
      !total && h('span', { class: 'tramo vacio', css: { 'flex-grow': '1' } }));
  }
  const destinosDe = (u, soloFalta) => u.destinos.filter(d => !soloFalta || (!d.ya && !d.mano)).map(d => d.nombre || (S.sim && S.sim.mapa[d.clave] ? S.sim.mapa[d.clave].nombre : d.clave + ' (sin pareja)')).join(', ');
  function filaSim(u) {
    const rb = u.rb;
    const cab = h('div', { class: 'fila-titulo' }, u.sx && h('span', { class: 'origen' }, u.sx.baj ? 'Descargada' : u.sx.sinPublicar ? 'Sin publicar' : 'Sin descargar'), lineaRb(rb), h('span', { class: 'dur' }, C.mmss(rb.dur)));
    const abrir = sp => [enlaceApp('Abrir en la app', 'spotify:track:' + encodeURIComponent(sp.id)), enlace('Web', 'https://open.spotify.com/track/' + encodeURIComponent(sp.id))];
    const deshacer = u.decidida && boton('Deshacer mi respuesta', () => decide(u, null, null), 'mini sec');
    const noEs = sp => boton('No es', () => descarta(u, sp), 'mini sec');
    // Las notas del buscador hablan de rekordbox; en un favorito de Soundeo, de Soundeo.
    const tx = t => (u.sx ? String(t).replace(/en rekordbox/g, 'en Soundeo') : t);
    let cuerpo;
    if (u.estado === 'add') {
      const e = u.elegida;
      cuerpo = [h('div', { class: 'fila-sub' }, 'En Spotify: ' + lineaSp(e.sp.m), h('span', { class: 'dur' }, C.mmss(e.sp.dur))),
        e.r.nota && h('div', { class: 'fila-nota' }, tx(e.r.nota)),
        h('div', { class: 'fila-sub' }, 'Iría a: ' + destinosDe(u, true)),
        h('div', { class: 'fila-acc' }, noEs(e.sp), abrir(e.sp), deshacer)];
    } else if (u.estado === 'ya') {
      const y = u.destinos.find(d => d.ya).ya;
      cuerpo = [h('div', { class: 'fila-sub' }, 'En Spotify: ' + lineaSp(y.sp.m), h('span', { class: 'dur' }, C.mmss(y.sp.dur))),
        y.r.otraVersion && h('div', { class: 'fila-nota' }, 'Es otra versión de la misma canción; cuenta como que ya está.'),
        h('div', { class: 'fila-sub' }, 'Está en: ' + destinosDe(u, false)), h('div', { class: 'fila-acc' }, noEs(y.sp), abrir(y.sp), deshacer)];
    } else if (u.estado === 'duda') {
      cuerpo = [u.dudosas.map(d => h('div', { class: 'cand' },
        h('div', { class: 'fila-sub' }, lineaSp(d.sp.m), h('span', { class: 'dur' }, C.mmss(d.sp.dur))),
        h('div', { class: 'fila-nota' }, 'Duda: ' + (tx(d.r.motivos.join('; ')) || 'no coincide del todo') + '.'),
        h('div', { class: 'fila-acc' },
          boton('Añadir', () => decide(u, d.sp.uri, true), 'mini'),
          boton('No es', () => decide(u, d.sp.uri, false), 'mini sec'),
          abrir(d.sp)))),
        h('div', { class: 'fila-sub' }, 'Iría a: ' + destinosDe(u, true)),
        (u.dudosas.length > 1 || deshacer) && h('div', { class: 'fila-acc' },
          u.dudosas.length > 1 && boton('Ninguna es', () => ninguna(u), 'mini sec'), deshacer)];
    } else if (u.estado === 'pend') {
      cuerpo = [h('div', { class: 'fila-nota' }, 'Sin buscar todavía: hoy se llegó al tope de búsquedas nuevas. Se buscará en otra simulación, otro día.'),
        h('div', { class: 'fila-sub' }, 'Iría a: ' + destinosDe(u, true))];
    } else {
      const q = encodeURIComponent((rb.artista + ' ' + rb.tit.crudoBase).trim());
      cuerpo = [u.ninguna && h('div', { class: 'fila-nota' }, 'Dijiste que ninguna de las de Spotify es la tuya. Solo volverá a salir si aparece una coincidencia segura.'),
        h('div', { class: 'fila-sub' }, 'Iría a: ' + destinosDe(u, true)),
        h('div', { class: 'fila-acc' }, enlace('Buscar en SoundCloud', 'https://soundcloud.com/search?q=' + q), enlaceApp('Buscar en la app de Spotify', 'spotify:search:' + q), enlace('Web', 'https://open.spotify.com/search/' + q), deshacer)];
    }
    return h('li', { class: 'fila cat-' + u.estado }, h('div', { class: 'fila-cuerpo' }, cab, cuerpo));
  }
  // ---- A: sincronizar ----
  function bloqueResultado(r) {
    const rs = resumenSinc(r);
    return h('div', { class: 'estado ' + rs.clase, id: 'sinc-res' },
      h('div', { class: 'fila-titulo' }, 'Última sincronización (' + fechaHora(r.t) + '): ' + rs.texto),
      h('ul', { class: 'plan-canc' }, r.pls.map(p => h('li', null, textoPl(p)))),
      h('div', { class: 'fila-sub' }, 'Copia guardada antes de escribir: ' + r.copia + (r.completa ? ' (y la copia completa ' + r.completa + ')' : '') + '. ' +
        (r.registro ? 'Registro de lo añadido: ' + r.registro + '.'
          : r.errorRegistro ? 'El registro no se ha podido guardar en Dropbox (' + r.errorRegistro + '). Lo que se iba a añadir a cada playlist está en la copia previa, y cuántas se añadieron, aquí y en el diagnóstico. Sin ese registro, otra pestaña u otro dispositivo no podrán sincronizar hasta pasado un cuarto de hora.'
            : 'El registro no se llegó a guardar.')));
  }
  /* La pantalla de confirmación. Lo que se ve aquí es lo que sale: al confirmar se vuelve a comprobar que coincide
     con la simulación, y la puerta de Spotify no deja pasar nada que no esté en las playlists marcadas. */
  function pantallaConfirma(plan, no) {
    const marc = plan.filas.filter(f => plan.marcadas[f.clave] === true && !f.bloqueo), libres = plan.filas.filter(f => !f.bloqueo);
    const nCanc = marc.reduce((n, f) => n + f.uris.length, 0), g = gastoDe(marc);
    const marca = (f, v) => { if (v && !f.bloqueo) plan.marcadas[f.clave] = true; else delete plan.marcadas[f.clave]; };
    return h('div', { class: 'estado confirma', id: 'sinc-conf' },
      h('div', { class: 'fila-titulo' }, 'Marca las playlists en las que quieres que se añadan canciones'),
      h('div', { class: 'fila-sub' }, 'XML de rekordbox: último cambio el ' + fechaHora(S.xml.fecha) + '. Simulación del ' + fechaHora(S.sim.fecha) + '. Spotify leído el ' + fechaHora(S.lib.leida) + '.'),
      h('ul', { class: 'lista plan' }, plan.filas.map((f, i) => {
        const idc = 'marca-' + i, puesta = plan.marcadas[f.clave] === true && !f.bloqueo, avisos = f.lineas.filter(l => l.riesgo > 0).length;
        const lineas = f.lineas.map((l, k) => ({ l, k })).sort((a, b) => (b.l.riesgo - a.l.riesgo) || (a.k - b.k)).map(x => x.l);
        return h('li', { class: 'fila' + (f.bloqueo ? (f.nada ? ' cat-ya' : ' cat-no') : puesta ? ' cat-add' : '') },
          h('input', { type: 'checkbox', id: idc, class: 'marca', checked: puesta, disabled: !!f.bloqueo || !!S.tarea, 'aria-label': 'Sincronizar ' + (f.nombre || f.nombreRb),
            onchange: e => { marca(f, e.target.checked); pinta(); } }),
          h('div', { class: 'fila-cuerpo' },
            h('label', { class: 'fila-titulo', for: idc }, (f.grupo === 'OG' ? 'Old Gems / ' : 'New School / ') + f.nombreRb + ' → ' + (f.nombre || 'sin pareja')),
            f.bloqueo
              ? h('div', { class: f.nada ? 'fila-sub' : 'fila-nota' }, f.nada ? 'Nada que añadir: no se puede marcar.' : 'No se puede marcar: ' + f.bloqueo)
              : [h('div', { class: 'fila-sub' }, 'En Spotify es ' + visib(f.publica) + ' y tiene ' + canciones(f.tiene) + '. Se añadirían ' + f.uris.length + (avisos ? ' (' + avisos + ' con aviso)' : '') + '.'),
                h('div', { class: 'fila-acc' }, h('button', { class: 'btn mini sec', type: 'button', disabled: !!S.tarea, onclick: () => { S.planVer = S.planVer === f.clave ? null : f.clave; pinta(); } },
                  S.planVer === f.clave ? 'Ocultar' : (f.uris.length === 1 ? 'Ver la canción' : 'Ver las ' + f.uris.length))),
                S.planVer === f.clave && h('ul', { class: 'plan-canc' }, lineas.map(l =>
                  h('li', null, l.riesgo > 0 && h('span', { class: 'origen' }, 'Con aviso'), l.rb + ' → ' + l.sp, l.nota && h('div', { class: 'fila-nota' }, l.nota))))]));
      })),
      h('div', { class: 'acciones' },
        boton('Marcar todas', () => { libres.forEach(f => marca(f, true)); pinta(); }, 'mini sec', !libres.length || marc.length === libres.length),
        boton('Desmarcar todas', () => { plan.marcadas = {}; pinta(); }, 'mini sec', !marc.length)),
      h('div', { class: 'fila-titulo', id: 'sinc-total' }, marc.length
        ? 'Marcadas: ' + nPlaylists(marc.length) + ', ' + canciones(nCanc) + '. Gasta ' + g.escr + (g.escr === 1 ? ' escritura' : ' escrituras') + ' y unas ' + g.lect + ' lecturas de Spotify.'
        : 'Ninguna playlist marcada: no se envía nada.'),
      h('ul', { class: 'plan-canc' },
        h('li', null, 'Antes de escribir se guarda una copia en Dropbox. Si no se guarda, no se escribe.'),
        h('li', null, 'Cada playlist se relee de Spotify justo antes de escribir en ella. Si no es idéntica a la que vio la simulación, no se toca.'),
        h('li', null, 'Las canciones se añaden al final, en el orden de rekordbox, en lotes de hasta ' + MAX_LOTE + '. Tras cada lote se relee la playlist y se compara.'),
        h('li', null, 'Una escritura no se repite nunca. Si algo falla, no cuadra o no se sabe si llegó, la sincronización se para y dice lo que hay.'),
        h('li', null, 'Si más adelante quitas a mano en Spotify una canción que añadió la app y sigue en rekordbox, la siguiente sincronización la volvería a proponer: para evitarlo, márcala con «No es» en «Se añadirían».')),
      no && h('div', { class: 'mal' }, no),
      h('div', { class: 'acciones' },
        boton(marc.length ? 'Confirmar: añadir ' + canciones(nCanc) + ' a ' + nPlaylists(marc.length) : 'Confirmar', () => tarea(TAREA_SINC, sincronizaSola), '', !marc.length || !!no),
        boton('Cancelar', () => { S.plan = null; pinta(); }, 'sec')));
  }
  function bloqueSinc() {
    const no = porQueNoSinc(), soloLee = !!S.sp && !!S.db && !tieneEscritura();
    let cuerpo;
    if (soloLee) {
      cuerpo = h('div', { class: 'estado' }, 'En este dispositivo Spotify está conectado solo con permisos de lectura: aquí se puede simular, pero no sincronizar. Para sincronizar hay que volver a conectarlo: Spotify te enseñará los permisos nuevos (modificar tus playlists) y tendrás que aceptarlos.',
        h('div', { class: 'acciones' }, botonReconecta()));
    } else if (S.plan) cuerpo = pantallaConfirma(S.plan, no);
    else {
      cuerpo = [no && h('p', { class: 'estado' }, no),
        h('div', { class: 'acciones' }, boton('Preparar la sincronización (no envía nada)', preparaSinc, '', !!no))];
    }
    return h('section', { class: 'bloque' },
      h('h2', null, 'Sincronizar: añadir a Spotify'),
      h('p', { class: 'nota' }, 'Añade a tus playlists «NS -» y «OG -» las canciones que la simulación da como «se añadirían». Solo añade: no quita, no reordena y no toca los likes ni ninguna otra playlist. Nada sale hacia Spotify hasta que marcas playlists y confirmas.'),
      ultimaSinc() && !(S.tarea && S.tarea.nombre === TAREA_SINC) && bloqueResultado(ultimaSinc()),
      cuerpo);
  }
  function vistaA() {
    const listo = S.db && S.sp && S.xml;
    const out = [];
    out.push(h('section', { class: 'bloque' },
      h('h2', null, 'rekordbox a Spotify: simular'),
      h('p', { class: 'nota' }, 'Compara las playlists New School y Old Gems de rekordbox con sus playlists «NS -» y «OG -» de Spotify y enseña qué se añadiría. Simular no cambia nada en Spotify.'),
      !listo && h('p', { class: 'estado mal' }, 'Falta: ' + [!S.db && 'conectar Dropbox', !S.sp && 'conectar Spotify', !S.xml && 'elegir el XML de rekordbox'].filter(Boolean).join(', ') + '. Se hace en Cuentas.'),
      S.xml && h('p', { class: 'estado' }, 'XML de rekordbox: último cambio el ' + fechaHora(S.xml.fecha) + ' (comprobado a las ' + soloHora(S.xml.visto) + ').' +
        (S.lib ? ' Spotify leído el ' + fechaHora(S.lib.leida) + (S.lib.lectura ? ': ' + textoLectura(S.lib.lectura) : '') + '.' : '')),
      listo && h('p', { class: 'nota', id: 'busq-hoy' }, 'Búsquedas nuevas en Spotify hoy: ' + usoDe(hoy()).busq + ' de ' + topeBusq() + ' como mucho. El tope se cambia en Cuentas.'),
      bandaCorte(),
      h('div', { class: 'acciones' },
        boton(S.sim ? 'Simular otra vez' : 'Simular', () => tarea('Simular', p => simula(p, false)), '', !listo),
        S.lib && boton('Simular leyendo Spotify de nuevo', () => tarea('Simular', p => simula(p, true)), 'sec', !listo),
        !S.lib && listo && boton('Leer Spotify para ver el mapa', () => tarea('Leer Spotify', p => leeBiblioteca(p)), 'sec'))));
    out.push(bloqueSinc());

    if (S.xml && S.lib) {
      const m = mapaActual(), propias = S.lib.playlists.filter(p => p.propia), filasSim = S.sim ? porPlaylist(S.sim) : null;
      const sinPareja = S.xml.datos.delMapa.filter(pl => !m.mapa[pl.clave]);
      out.push(h('section', { class: 'bloque' },
        h('h2', null, 'Mapa de playlists'),
        sinPareja.length ? h('p', { class: 'estado mal' }, sinPareja.length + ' playlist' + (sinPareja.length > 1 ? 's' : '') + ' de rekordbox sin pareja en Spotify. Elige una abajo, o créala en Spotify con el nombre que se indica y vuelve a simular.') : h('p', { class: 'estado ok' }, 'Las ' + S.xml.datos.delMapa.length + ' playlists de rekordbox tienen pareja en Spotify.'),
        h('ul', { class: 'lista mapa' }, S.xml.datos.delMapa.map(pl => {
          const act = m.mapa[pl.clave], f = filasSim && filasSim.find(x => x.pl.clave === pl.clave);
          const sel = h('select', { 'aria-label': 'Playlist de Spotify para ' + pl.nombre, disabled: !!S.tarea || !S.mem, onchange: e => {
            const v = e.target.value;
            S.mem.mapa[pl.clave] = { id: v === '' ? null : v, t: Date.now() };
            memToca(); S.sim = null; S.c = null; S.plan = null; pinta();
          } },
            h('option', { value: '', selected: !act }, 'Sin pareja' + (act ? '' : ' (esperada: ' + C.nombreDestino(pl) + ')')),
            propias.map(p => h('option', { value: p.id, selected: !!act && act.id === p.id }, p.nombre)));
          return h('li', { class: 'fila' + (act ? '' : ' cat-no') }, h('div', { class: 'fila-cuerpo' },
            h('div', { class: 'fila-titulo' }, (pl.grupo === 'OG' ? 'Old Gems / ' : 'New School / ') + pl.nombre, h('span', { class: 'dur' }, canciones(pl.ids.length))),
            h('div', { class: 'mapa-sel' }, sel, m.ambiguas.indexOf(pl.clave) >= 0 && h('span', { class: 'fila-nota' }, 'Hay varias con ese nombre: elige una.')),
            f && [tira(f), h('div', { class: 'fila-sub' }, 'Ya están ' + f.ya + ', se añadirían ' + f.add + ', dudosas ' + f.duda + ', no están ' + f.no + (f.pend ? ', sin buscar ' + f.pend : '') + '.')]));
        }))));
    }
    if (S.sim) out.push(bloqueLista(S.sim, 'simFiltro', false));
    return out;
  }

  /* El resultado de una simulación, de A o de B: recuento, las listas y sus filas. «clave» dice dónde se guarda
     la lista que se está viendo (S.simFiltro o S.simBFiltro). */
  function bloqueLista(sim, clave, esB) {
    const c = cuenta(sim);
    if (S[clave] === 'pend' && !c.pend) S[clave] = 'add'; // la lista «Sin buscar» solo existe mientras haya alguna
    const filtro = S[clave], cosa = esB ? 'tu favorito' : 'tu archivo';
    let lista = sim.unicas.filter(u => u.estado === filtro);
    let conAviso = 0, filas;
    if (filtro === 'add') {
      lista = porRiesgo(lista);
      conAviso = lista.filter(u => riesgoDe(u) > 0).length;
      filas = lista.map(filaSim);
      if (conAviso && conAviso < lista.length) filas.splice(conAviso, 0, h('li', { class: 'corte' }, 'Sin aviso: ' + (lista.length - conAviso)));
      if (conAviso) filas.unshift(h('li', { class: 'corte' }, 'Con aviso: ' + conAviso));
    } else filas = lista.map(filaSim);
    return h('section', { class: 'bloque' },
      h('h2', null, 'Resultado'),
      h('p', { class: 'estado' + (sim.incompleta ? ' mal' : '') }, (sim.incompleta ? 'Simulación incompleta (' + sim.hechas + ' de ' + sim.unicas.length + '). ' : '') +
        (esB ? favoritos(sim.unicas.length) + ' de Soundeo' : canciones(sim.unicas.length) + ' distintas en rekordbox') + '. Simulación del ' + fechaHora(sim.fecha) + ': no se ha cambiado nada en Spotify.' +
        (c.mano ? ' ' + (c.mano === 1 ? 'Uno no sale en las listas de abajo: lo quitaste' : c.mano + ' no salen en las listas de abajo: los quitaste') + ' a mano de Spotify (ver «Quitadas a mano»).' : '')),
      c.pend > 0 && h('p', { class: 'estado mal', id: 'tope-aviso' }, canciones(c.pend) + ' sin buscar: hoy se ha llegado al tope de ' + topeBusq() + ' búsquedas nuevas. Lo buscado queda guardado; simula otro día y la app sigue con ellas.' + (esB ? '' : ' Lo demás se puede sincronizar ya.')),
      tira(c),
      h('div', { class: 'filtros', role: 'tablist', css: c.pend ? { 'grid-template-columns': 'repeat(5, 1fr)' } : null }, ['add', 'duda', 'no', 'ya'].concat(c.pend ? ['pend'] : []).map(k =>
        h('button', { class: 'filtro cat-' + k + (filtro === k ? ' activo' : ''), type: 'button', role: 'tab', 'aria-selected': filtro === k ? 'true' : 'false', onclick: () => { S[clave] = k; pinta(); } },
          h('span', { class: 'filtro-num' }, String(c[k])), CAT[k]))),
      filtro === 'duda' && lista.length > 0 && h('p', { class: 'nota' }, '«Añadir» guarda tu respuesta y pasa la canción a «Se añadirían»; no cambia nada en Spotify hasta que sincronices. «No es» descarta esa candidata. «Ninguna es» las descarta todas y deja de preguntar por esa canción.'),
      filtro === 'add' && lista.length > 0 && h('p', { class: 'nota' }, (conAviso ? 'Arriba van las ' + conAviso + ' que llevan aviso; primero las que en Spotify duran más que ' + cosa + ', que es lo menos habitual. ' : '') +
        '«No es» descarta esa canción de Spotify para ' + cosa + ': se recuerda y se puede deshacer.'),
      filtro === 'ya' && lista.length > 0 && h('p', { class: 'nota' }, '«No es» sirve si la que está en la playlist no es la tuya: deja de contar como que ya está.'),
      filtro === 'no' && lista.length > 0 && h('p', { class: 'nota' }, 'Se vuelven a buscar de vez en cuando (cada dos o tres semanas), no en cada simulación: así se gastan pocas peticiones a Spotify.'),
      lista.length ? h('ul', { class: 'lista' }, filas) : h('p', { class: 'estado' }, 'Nada en esta lista.'));
  }
  // El mapa de las tres playlists de Soundeo (se ve en B y en C). «filas»: recuento de la simulación de B, si la hay.
  function bloqueMapaSoundeo(filas) {
    const s = soundeoActual(), propias = S.lib.playlists.filter(p => p.propia);
    return h('section', { class: 'bloque' },
      h('h2', null, 'Playlists de Soundeo'),
      h('ul', { class: 'lista mapa' }, SOUNDEO.map(([k, nombre]) => h('li', { class: 'fila' + (s[k] ? '' : ' cat-no') }, h('div', { class: 'fila-cuerpo' },
        h('div', { class: 'fila-titulo' }, nombre, s[k] && h('span', { class: 'dur' }, canciones(s[k].items.length))),
        h('div', { class: 'mapa-sel' }, h('select', { 'aria-label': 'Playlist de Spotify para ' + nombre, disabled: !!S.tarea, onchange: e => { S.mem.soundeo[k] = { id: e.target.value || null, t: Date.now() }; memToca(); S.simB = null; S.planB = null; if (S.lib && (S.vista === 'c' || S.c)) calculaC(); pinta(); } },
          h('option', { value: '', selected: !s[k] }, 'Sin pareja'),
          propias.map(p => h('option', { value: p.id, selected: !!s[k] && s[k].id === p.id }, p.nombre))),
          !s[k] && filas && h('span', { class: 'fila-nota' }, 'No encuentro esta playlist en tu Spotify: créala vacía con ese nombre o elige otra.')),
        filas && filas[k] && [tira(filas[k]), h('div', { class: 'fila-sub' }, 'Ya están ' + filas[k].ya + ', se añadirían ' + filas[k].add + ', dudosas ' + filas[k].duda + ', no están ' + filas[k].no + (filas[k].pend ? ', sin buscar ' + filas[k].pend : '') + (filas[k].mano ? ', quitadas a mano ' + filas[k].mano : '') + '.')])))));
  }

  // ---- B ----
  function vistaB() {
    const listo = S.db && S.sp;
    const out = [], L = S.sx && S.sx.lista, av = L ? sxAvisos(L) : [];
    out.push(h('section', { class: 'bloque' },
      h('h2', null, 'Soundeo a Spotify: simular'),
      h('p', { class: 'nota' }, 'Tus favoritos (★) de Soundeo que estén en Spotify van a «Sound All» y, además, a «Sound Down» si ya los descargaste o a «Sound Try» si no. Simular no cambia nada en Spotify, y en Soundeo la app solo lee.'),
      !listo && h('p', { class: 'estado mal' }, 'Falta: ' + [!S.db && 'conectar Dropbox', !S.sp && 'conectar Spotify'].filter(Boolean).join(', ') + '. Se hace en Cuentas.'),
      S.sxLlegada && h('p', { class: 'estado mal', id: 'sx-llegada' }, 'Hay una lista recién leída (' + textoLista(S.sxLlegada.lista) + ') sin guardar en Dropbox.' + (S.db ? ' Guardándola…' : ' Conecta Dropbox en Cuentas para guardarla.')),
      L ? h('p', { class: 'estado', id: 'sx-lista' }, 'Favoritos de Soundeo leídos el ' + fechaHora(L.t) + ': ' + textoLista(L) + '.' + (S.lib ? ' Spotify leído el ' + fechaHora(S.lib.leida) + '.' : ''))
        : S.db && !S.sxLlegada && h('p', { class: 'estado', id: 'sx-lista' }, S.sxMirado ? 'Todavía no hay ninguna lista de Soundeo guardada.' : 'Mirando en Dropbox si hay una lista de Soundeo…'),
      av.length > 0 && h('p', { class: 'estado mal', id: 'sx-avisos' }, 'Ojo con esta lista: ' + av.join('; ') + '. Para simular y para añadir sirve; con una lista así la app no propone quitar nada.'),
      h('p', { class: 'nota' }, 'La lista se lee en el iPhone. «Leer Soundeo» abre Soundeo en esta pestaña; allí el lector lee tus favoritos y tus descargas (solo lee) y te devuelve aquí con la lista, que se guarda en Dropbox para todos tus dispositivos. El lector se instala una vez, desde Cuentas.'),
      listo && h('p', { class: 'nota', id: 'busq-hoy-b' }, 'Búsquedas nuevas en Spotify hoy: ' + usoDe(hoy()).busq + ' de ' + topeBusq() + ' como mucho. El tope se cambia en Cuentas.'),
      bandaCorte(),
      h('div', { class: 'acciones' },
        boton(S.simB ? 'Simular otra vez' : 'Simular', () => tarea('Simular Soundeo', p => simulaB(p, false)), '', !listo || !(L || S.sxLlegada)),
        S.lib && boton('Simular leyendo Spotify de nuevo', () => tarea('Simular Soundeo', p => simulaB(p, true)), 'sec', !listo || !(L || S.sxLlegada)),
        boton('Leer Soundeo', leerSoundeo, 'sec', !S.db),
        S.db && boton('Mirar en Dropbox', () => sxMira(true), 'sec'))));
    out.push(bloqueSincB());
    if (S.lib && S.mem) out.push(bloqueMapaSoundeo(S.simB ? porPlaylistB(S.simB) : null));
    if (S.simB) { const m = bloqueMano(S.simB); if (m) out.push(m); }
    if (S.simB) out.push(bloqueLista(S.simB, 'simBFiltro', true));
    return out;
  }
  // ---- B: sincronizar ----
  function bloqueSincB() {
    const no = porQueNoSinc(true), soloLee = !!S.sp && !!S.db && !tieneEscritura();
    let cuerpo;
    if (soloLee) {
      cuerpo = h('div', { class: 'estado' }, 'En este dispositivo Spotify está conectado solo con permisos de lectura: aquí se puede simular, pero no sincronizar. Para sincronizar hay que volver a conectarlo en Cuentas.',
        h('div', { class: 'acciones' }, botonReconecta()));
    } else if (S.planB) cuerpo = pantallaConfirmaB(S.planB, no);
    else {
      cuerpo = [no && h('p', { class: 'estado' }, no),
        h('div', { class: 'acciones' }, boton('Preparar la sincronización de Soundeo (no envía nada)', preparaSincB, '', !!no))];
    }
    return h('section', { class: 'bloque' },
      h('h2', null, 'Sincronizar: añadir y quitar en Spotify'),
      h('p', { class: 'nota' }, 'Añade a «Sound All», «Sound Down» y «Sound Try» los favoritos que la simulación da como «se añadirían» y, si lo marcas canción a canción, quita de ellas lo que ya no toca: de Sound Try lo que has descargado y de las tres lo que ya no es favorito. Solo quita canciones que la app tiene apuntadas como pareja de un favorito tuyo. No toca los likes ni ninguna otra playlist, y nada sale hacia Spotify hasta que marcas y confirmas.'),
      ultimaSinc() && !(S.tarea && S.tarea.nombre === TAREA_SINC) && bloqueResultado(ultimaSinc()),
      cuerpo);
  }
  /* La pantalla de confirmación de B. Añadir se marca por playlist; quitar, canción a canción, cada una con su
     motivo. Nada viene marcado. Lo que se ve aquí es lo que sale: al confirmar se vuelve a comprobar que coincide
     con la simulación, y las puertas de Spotify no dejan pasar nada que no esté marcado. */
  function pantallaConfirmaB(plan, no) {
    const sim = S.simB, marc = marcadasB(plan), libres = plan.filas.filter(f => !f.bloqueo && f.uris.length);
    const nAdd = marc.reduce((n, f) => n + f.uris.length, 0), nQ = marc.reduce((n, f) => n + f.quita.length, 0), g = gastoDe(marc);
    const pon = (o, k, v) => { if (v) o[k] = true; else delete o[k]; };
    // Si de golpe «ya no son favoritas» muchas de las que la app tiene apuntadas, lo más probable es una lectura corta de Soundeo.
    const sinE = new Set(), nReg = sxApuntados();
    plan.filas.forEach(f => f.lineasQ.forEach(l => { if (l.motivo === 'sin-estrella') sinE.add(l.uri); }));
    const muchas = sinE.size >= 5 && sinE.size * 4 > nReg;
    return h('div', { class: 'estado confirma', id: 'sincb-conf' },
      h('div', { class: 'fila-titulo' }, 'Marca lo que quieres que se haga en las playlists de Soundeo'),
      h('div', { class: 'fila-sub' }, 'Favoritos de Soundeo leídos el ' + fechaHora(sim.listaT) + '. Simulación del ' + fechaHora(sim.fecha) + '. Spotify leído el ' + fechaHora(S.lib.leida) + '.'),
      !sim.quitarVale && h('div', { class: 'fila-nota', id: 'sincb-sinquitar' }, 'Esta vez no se propone quitar nada: ' + ((S.sx && sxAvisos(S.sx.lista).join('; ')) || 'la lista de Soundeo no vale para eso') + '. Solo se añade.'),
      muchas && h('div', { class: 'mal', id: 'sincb-muchas' }, 'Ojo: ' + sinE.size + ' canciones saldrían por «ya no es favorita en Soundeo», más de la cuarta parte de las ' + nReg + ' que la app tiene apuntadas. Si no has quitado tantas estrellas, puede que Soundeo no haya dado la lista entera: pulsa «Leer Soundeo» otra vez antes de marcar nada.'),
      h('ul', { class: 'lista plan' }, plan.filas.map((f, i) => {
        const idc = 'marcab-' + i, puesta = plan.marcadas[f.clave] === true && !f.bloqueo && f.uris.length > 0, avisos = f.lineas.filter(l => l.riesgo > 0).length;
        const nq = f.lineasQ.filter(l => plan.quitar[claveQ(f, l.uri)] === true).length;
        const lineas = f.lineas.map((l, k) => ({ l, k })).sort((a, b) => (b.l.riesgo - a.l.riesgo) || (a.k - b.k)).map(x => x.l);
        return h('li', { class: 'fila' + (f.bloqueo ? (f.nada ? ' cat-ya' : ' cat-no') : (puesta || nq) ? ' cat-add' : '') },
          h('input', { type: 'checkbox', id: idc, class: 'marca', checked: puesta, disabled: !!f.bloqueo || !f.uris.length || !!S.tarea, 'aria-label': 'Añadir a ' + (f.nombre || f.nombreSx),
            onchange: e => { pon(plan.marcadas, f.clave, e.target.checked && !f.bloqueo); pinta(); } }),
          h('div', { class: 'fila-cuerpo' },
            h('label', { class: 'fila-titulo', for: idc }, f.nombreSx + ' → ' + (f.nombre || 'sin pareja')),
            f.bloqueo
              ? h('div', { class: f.nada ? 'fila-sub' : 'fila-nota' }, f.nada ? 'Nada que añadir ni que quitar: no se puede marcar.' : 'No se puede marcar: ' + f.bloqueo)
              : [h('div', { class: 'fila-sub' }, 'En Spotify es ' + visib(f.publica) + ' y tiene ' + canciones(f.tiene) + '. Se añadirían ' + f.uris.length + (avisos ? ' (' + avisos + ' con aviso)' : '') + (f.lineasQ.length ? '. Se propone quitar ' + f.lineasQ.length : '') + '.'),
                f.uris.length > 0 && h('div', { class: 'fila-acc' }, h('button', { class: 'btn mini sec', type: 'button', disabled: !!S.tarea, onclick: () => { S.planBVer = S.planBVer === f.clave ? null : f.clave; pinta(); } },
                  S.planBVer === f.clave ? 'Ocultar' : (f.uris.length === 1 ? 'Ver la canción' : 'Ver las ' + f.uris.length))),
                S.planBVer === f.clave && h('ul', { class: 'plan-canc' }, lineas.map(l =>
                  h('li', null, l.riesgo > 0 && h('span', { class: 'origen' }, 'Con aviso'), l.rb + ' → ' + l.sp, l.nota && h('div', { class: 'fila-nota' }, l.nota)))),
                f.lineasQ.length > 0 && h('ul', { class: 'plan-quita' }, f.lineasQ.map((l, k) => {
                  const idq = 'quita-' + i + '-' + k, on = plan.quitar[claveQ(f, l.uri)] === true;
                  return h('li', { class: on ? 'puesta' : '' },
                    h('input', { type: 'checkbox', id: idq, class: 'marca', checked: on, disabled: !!S.tarea, 'aria-label': 'Quitar ' + l.sp + ' de ' + f.nombre,
                      onchange: e => { pon(plan.quitar, claveQ(f, l.uri), e.target.checked); pinta(); } }),
                    h('div', { class: 'fila-cuerpo' },
                      h('label', { for: idq }, 'Quitar de ' + f.nombre + ': ' + l.sp),
                      h('div', { class: 'fila-nota' }, 'Por qué: ' + (MOTIVO_Q[l.motivo] || l.motivo) + (l.fav ? ' (tu favorito: ' + l.fav + ')' : '') + '.' +
                        (l.puesta ? '' : ' Esta no la añadió la app: ya estaba en la playlist y la app la dio por la pareja de ese favorito.') +
                        (l.trasDown ? ' Todavía no está en Sound Down: solo saldrá de aquí si en esta misma sincronización se añade allí (marca también Sound Down).' : ''))));
                }))]));
      })),
      h('div', { class: 'acciones' },
        boton('Marcar añadir en todas', () => { libres.forEach(f => { plan.marcadas[f.clave] = true; }); pinta(); }, 'mini sec', !libres.length || libres.every(f => plan.marcadas[f.clave] === true)),
        boton('Desmarcar todo', () => { plan.marcadas = {}; plan.quitar = {}; pinta(); }, 'mini sec', !marc.length)),
      h('div', { class: 'fila-titulo', id: 'sincb-total' }, marc.length
        ? 'Marcado: añadir ' + canciones(nAdd) + ' y quitar ' + nQ + ', en ' + nPlaylists(marc.length) + '. Gasta ' + g.escr + (g.escr === 1 ? ' escritura' : ' escrituras') + ' y unas ' + g.lect + ' lecturas de Spotify.'
        : 'Nada marcado: no se envía nada.'),
      h('ul', { class: 'plan-canc' },
        h('li', null, 'Antes de escribir se guarda una copia en Dropbox con las playlists tal como están. Si no se guarda, no se escribe.'),
        h('li', null, 'Cada playlist se relee de Spotify justo antes de tocarla. Si no es idéntica a la que vio la simulación, no se toca.'),
        h('li', null, 'Primero se añade (al final, de tu favorito más antiguo al más nuevo) y después se quita. Tras cada paso se relee la playlist y se compara.'),
        h('li', null, 'Solo se quita lo que marcas aquí, canción a canción, y solo canciones que la app tiene apuntadas como pareja de un favorito tuyo: las que añadió ella y las que ya estaban y emparejó (de estas lo dice). Si una está repetida en la playlist, salen todas sus copias.'),
        h('li', null, 'Una petición no se repite nunca. Si algo falla, no cuadra o no se sabe si llegó, la sincronización se para y dice lo que hay.')),
      no && h('div', { class: 'mal' }, no),
      h('div', { class: 'acciones' },
        boton(marc.length ? 'Confirmar: añadir ' + nAdd + ' y quitar ' + nQ : 'Confirmar', () => tarea(TAREA_SINC, p => sincronizaSola(p, true)), '', !marc.length || !!no),
        boton('Cancelar', () => { S.planB = null; pinta(); }, 'sec')));
  }
  // Lo que él quitó a mano de una playlist de Soundeo: no se vuelve a añadir, y aquí decide qué hacer con cada una.
  const AYUDA_MANO = {
    noes: '«No es»: la app emparejó mal. Conservas la estrella en Soundeo; esa canción de Spotify queda descartada para este favorito, la app busca otra pareja y, si la descartada sigue en otra de las tres playlists, te propondrá quitarla.',
    asi: '«Dejarla así»: la pareja era buena, pero no la quieres en esa playlist. Conservas la estrella, la canción no vuelve a esa playlist y no se te pregunta más.',
    estrella: '«Quitar ★»: ya no te gusta. Quitará la estrella en Soundeo y la canción saldrá de las tres playlists. Llega en la próxima versión; mientras tanto, quita la estrella a mano en Soundeo y vuelve a leerlo.',
  };
  function bloqueMano(sim) {
    const filas = [];
    sim.unicas.forEach(u => u.destinos.forEach(d => { if (d.mano) filas.push({ u, d }); }));
    if (!filas.length) return null;
    const abiertas = filas.filter(x => !x.d.asi), calladas = filas.filter(x => x.d.asi);
    const bt = (texto, ayuda, fn) => h('button', { class: 'btn mini sec', type: 'button', title: ayuda, disabled: !fn || !!S.tarea, onclick: fn || null }, texto);
    return h('section', { class: 'bloque', id: 'sx-mano' },
      h('h2', null, 'Quitadas a mano'),
      h('p', { class: 'nota' }, 'Canciones que la app tenía apuntadas en una playlist de Soundeo y ya no están: las has quitado tú en Spotify. No se vuelven a añadir (si quitaste alguna sin querer, vuelve a ponerla tú en Spotify y la app la dará por buena). Dime qué hago con cada una; si no respondes, se quedan como están: fuera de esa playlist y con su estrella. ',
        h('button', { class: 'btn mini sec', type: 'button', id: 'mano-ayuda', 'aria-expanded': S.manoAyuda ? 'true' : 'false', 'aria-label': 'Qué hace cada respuesta', onclick: () => { S.manoAyuda = !S.manoAyuda; pinta(); } }, '?')),
      S.manoAyuda && h('ul', { class: 'plan-canc', id: 'mano-explica' }, h('li', null, AYUDA_MANO.noes), h('li', null, AYUDA_MANO.asi), h('li', null, AYUDA_MANO.estrella)),
      abiertas.length > 0 && h('ul', { class: 'lista' }, abiertas.map(({ u, d }) => {
        const sp = u.cands ? u.cands.get(d.manoUri) : null;
        return h('li', { class: 'fila cat-pend' }, h('div', { class: 'fila-cuerpo' },
          h('div', { class: 'fila-titulo' }, lineaRb(u.rb), h('span', { class: 'dur' }, C.mmss(u.rb.dur))),
          h('div', { class: 'fila-sub' }, 'La quitaste de ' + d.nombre + (sp ? ': ' + lineaSp(sp.m) : '') + '.'),
          h('div', { class: 'fila-acc' },
            bt('No es', AYUDA_MANO.noes, sp ? () => descarta(u, sp) : null),
            bt('Dejarla así', AYUDA_MANO.asi, () => tarea('Dejarla así', () => dejaAsi(u, d, true))),
            bt('Quitar ★', AYUDA_MANO.estrella, null))));
      })),
      calladas.length > 0 && h('p', { class: 'estado', id: 'mano-asi' }, 'Dejadas así (no vuelven y no se pregunta más): ' + calladas.length + '.'),
      calladas.length > 0 && S.manoAyuda && h('ul', { class: 'lista' }, calladas.map(({ u, d }) => h('li', { class: 'fila' }, h('div', { class: 'fila-cuerpo' },
        h('div', { class: 'fila-titulo' }, lineaRb(u.rb)), h('div', { class: 'fila-sub' }, 'No vuelve a ' + d.nombre + '.'),
        h('div', { class: 'fila-acc' }, boton('Volver a preguntar', () => tarea('Volver a preguntar', () => dejaAsi(u, d, false)), 'mini sec')))))));
  }

  // ---- C ----
  function vistaC() {
    const listo = S.db && S.sp;
    const out = [];
    const desde = ajuste('likesDesde', LIKES_DESDE);
    out.push(h('section', { class: 'bloque' },
      h('h2', null, 'Sin repartir'),
      h('p', { class: 'nota' }, 'Tus likes de Spotify desde una fecha y todo Sound All, menos lo que ya está en alguna playlist «NS -» u «OG -». Solo es una lista: no cambia nada en Spotify.'),
      !listo && h('p', { class: 'estado mal' }, 'Conecta Dropbox y Spotify en Cuentas.'),
      bandaCorte(),
      h('label', { class: 'campo' }, 'Likes desde el ',
        h('input', { type: 'date', value: desde, disabled: !S.mem || !!S.tarea, onchange: e => { if (e.target.value) { ponAjuste('likesDesde', e.target.value); if (S.lib) calculaC(); pinta(); } } })),
      S.lib && h('p', { class: 'estado' }, 'Spotify leído el ' + fechaHora(S.lib.leida) + '.'),
      h('div', { class: 'acciones' },
        boton(S.lib ? 'Calcular' : 'Leer Spotify y calcular', () => tarea('Calcular sin repartir', async p => { await aseguraMem(); if (!S.lib) await leeBiblioteca(p); calculaC(); }), '', !listo),
        S.lib && boton('Leer Spotify de nuevo', () => tarea('Leer Spotify', async p => { await aseguraMem(); await leeBiblioteca(p); calculaC(); }), 'sec', !listo))));
    if (S.lib && S.mem) out.push(bloqueMapaSoundeo(null));
    if (S.c) {
      const vis = S.c.filas.filter(f => !oculta(f.uri)), ocu = S.c.filas.filter(f => oculta(f.uri));
      const lista = S.cOcultas ? ocu : vis;
      out.push(h('section', { class: 'bloque' },
        h('h2', null, vis.length + ' sin repartir'),
        h('p', { class: 'nota' }, 'Cuenta como repartido lo que está en: ' + (S.c.rep.join(', ') || 'ninguna playlist NS u OG encontrada') + '.'),
        (ocu.length > 0 || S.cOcultas) && h('div', { class: 'acciones' }, h('button', { class: 'btn mini sec', type: 'button', onclick: () => { S.cOcultas = !S.cOcultas; pinta(); } }, S.cOcultas ? 'Ver las que no están ocultas' : (ocu.length === 1 ? 'Ver la oculta' : 'Ver las ' + ocu.length + ' ocultas'))),
        lista.length ? h('ul', { class: 'lista' }, lista.map(f => h('li', { class: 'fila' }, h('div', { class: 'fila-cuerpo' },
          h('div', { class: 'fila-titulo' }, lineaSp(f.t), h('span', { class: 'dur' }, C.mmss(f.t.d))),
          h('div', { class: 'fila-sub' }, f.origenes.map(o => h('span', { class: 'origen' }, o)), f.fecha ? ' desde el ' + fechaCorta(f.fecha) : ''),
          h('div', { class: 'fila-acc' }, enlace('Abrir en Spotify', 'https://open.spotify.com/track/' + encodeURIComponent(f.id)),
            boton(S.cOcultas ? 'Volver a mostrar' : 'Ocultar', () => ponOculta(f.uri, !S.cOcultas), 'mini sec'))))))
          : h('p', { class: 'estado' }, S.cOcultas ? 'No has ocultado ninguna.' : 'Todo repartido.')));
    }
    return out;
  }

  // ---- Copia ----
  function vistaCopia() {
    const listo = S.db && S.sp, u = S.ultimaCopia;
    return [h('section', { class: 'bloque' },
      h('h2', null, 'Copia completa de Spotify'),
      h('p', { class: 'nota' }, 'Lee todas tus playlists y tus likes y los guarda en un archivo nuevo, con fecha, en la carpeta «copias» de SynchroSound en Dropbox. Una copia nunca sustituye a otra y la app no borra ninguna.'),
      !listo && h('p', { class: 'estado mal' }, 'Conecta Dropbox y Spotify en Cuentas.'),
      bandaCorte(),
      h('div', { class: 'acciones' }, boton('Hacer una copia ahora', () => tarea('Hacer la copia', hazCopia), '', !listo),
        S.db && boton('Ver copias guardadas', () => tarea('Leer las copias', cargaCopias), 'sec')),
      u && h('div', { class: 'estado ok' },
        h('div', null, 'Guardada: ' + u.ruta + ' (' + kb(u.tam) + ').'),
        h('div', null, u.resumen.playlists + ' playlists (' + u.resumen.playlists_con_contenido + ' con sus canciones: ' + u.resumen.canciones_en_playlists + ') y ' + u.resumen.likes + ' likes.'),
        u.resumen.playlists > u.resumen.playlists_con_contenido && h('div', null, 'De las playlists que sigues pero no son tuyas solo se guarda el nombre: Spotify no da su contenido.'),
        u.resumen.avisos.map(a => h('div', { class: 'mal' }, 'Revisar: ' + a + '.'))),
      S.copias && (S.copias.length ? h('ul', { class: 'lista' }, S.copias.map(a => h('li', { class: 'fila' }, h('div', { class: 'fila-cuerpo' },
        h('div', { class: 'fila-titulo' }, a.nombre), h('div', { class: 'fila-sub' }, kb(a.tam) + ', del ' + fechaHora(a.fecha))))))
        : h('p', { class: 'estado' }, 'Todavía no hay copias.')))];
  }

  // ---- Diagnóstico ----
  // Cuántas peticiones gasta releerlo todo: una por cada 50 canciones de cada playlist y de los likes.
  function costeRelectura() {
    if (!S.lib) return 0;
    const pag = n => Math.max(1, Math.ceil((n || 0) / 50));
    return pag(S.lib.playlists.length) + pag(S.lib.likes.length) +
      S.lib.playlists.filter(p => p.propia || p.colaborativa).reduce((n, p) => n + pag(p.total != null ? p.total : p.items.length), 0);
  }
  const botonReconecta = () => boton('Volver a conectar Spotify', () => conecta('sp'), 'sec');
  function vistaDiag() {
    const texto = diagnostico(), coste = costeRelectura();
    return [h('section', { class: 'bloque' },
      h('h2', null, 'Diagnóstico'),
      h('p', { class: 'nota' }, 'Resumen para pegar en la conversación con Claude. Lleva nombres de playlists y canciones de ejemplo; no lleva contraseñas, tokens ni tu correo.'),
      h('div', { class: 'acciones' }, boton('Copiar', () => copia(texto))),
      bandaCorte(),
      S.sp && S.db && h('p', { class: 'nota' }, 'La app guarda lo último leído de Spotify y solo vuelve a pedir lo que ha cambiado. Si alguna vez no cuadra con lo que ves en Spotify, puedes releerlo todo; gasta una petición por cada 50 canciones.'),
      // Gasta muchas peticiones de un toque: pide confirmación antes de enviar nada.
      S.sp && S.db && (S.confRelee && !corteActivo()
        ? h('div', { class: 'estado confirma' }, '¿Releer todo Spotify? Vuelve a pedir todas tus playlists y likes: ' + (coste ? 'unas ' + coste + ' peticiones' : 'una petición por cada 50 canciones') +
            ', en vez de las 2 o 3 de una lectura normal. Solo hace falta si lo guardado no cuadra con lo que ves en Spotify.',
          h('div', { class: 'acciones' },
            boton('Sí, releer todo', () => { S.confRelee = false; tarea('Releer todo Spotify', p => leeBiblioteca(p, true)); }, 'mini'),
            boton('Cancelar', () => { S.confRelee = false; pinta(); }, 'mini sec')))
        : h('div', { class: 'acciones' }, boton('Releer todo Spotify', () => { S.confRelee = true; pinta(); }, 'sec', !!corteActivo()))),
      S.sp && S.db && corteActivo() && h('p', { class: 'nota' }, 'Mientras dura el corte de Spotify no se puede releer: no se enviaría nada.'),
      h('textarea', { id: 'diag', class: 'diag', readonly: true, rows: '18', 'aria-label': 'Texto del diagnóstico' }, texto))];
  }

  let raiz = null, pintaLuego = false, pulsando = false, pulsaT = 0;
  /* Al soltar la casilla del plazo se hace la repintada que quedó pendiente. Si en ese momento hay un dedo o el
     ratón apretando un botón, se espera a que suelte: repintar le cambiaría el botón debajo y se perdería la pulsación. */
  function pintaPendiente() {
    if (!pintaLuego) return;
    setTimeout(function mira() {
      if (!pintaLuego) return;
      if (pulsando && Date.now() - pulsaT < 4000) setTimeout(mira, 120); else pinta();
    }, 250);
  }
  function pinta() {
    if (!raiz) return;
    // pinta() rehace la página entera: mientras se escribe en la casilla del plazo, se espera a que se suelte.
    const foco = document.activeElement;
    if (foco && foco.id === 'retry-mano' && raiz.contains(foco)) { pintaLuego = true; return; }
    pintaLuego = false;
    const y = window.scrollY;
    const v = { cuentas: vistaCuentas, a: vistaA, b: vistaB, c: vistaC, copia: vistaCopia, diag: vistaDiag }[S.vista] || vistaCuentas;
    let cuerpo;
    try { cuerpo = v(); }
    catch (e) { if (window.console) console.error(e); S.errores.push({ t: new Date().toISOString(), donde: 'Pintar ' + S.vista, m: String(e.message || e) }); cuerpo = h('p', { class: 'estado mal' }, 'Error al pintar esta pantalla: ' + (e.message || e)); }
    raiz.replaceChildren(...[cabecera(), zonaAvisos(), h('main', { class: 'vista' }, cuerpo), barraTarea(),
      h('footer', { class: 'pie' }, 'SynchroSound v' + VERSION + '. En Spotify añade a tus playlists «NS -» y «OG -», y añade y quita en «Sound All», «Sound Down» y «Sound Try»; siempre con una copia antes y solo cuando lo confirmas.')].filter(Boolean));
    window.scrollTo(0, y);
    // En el móvil las pestañas no caben a lo ancho: la que está abierta se deja a la vista.
    const act = raiz.querySelector('.pestana.activa'), nav = act && act.parentElement;
    if (nav && nav.scrollWidth > nav.clientWidth) {
      const r = act.getBoundingClientRect(), rn = nav.getBoundingClientRect();
      nav.scrollLeft = Math.max(0, r.left - rn.left + nav.scrollLeft - (nav.clientWidth - r.width) / 2);
    }
  }

  async function arranca() {
    raiz = document.getElementById('app');
    if (!C) { raiz.textContent = 'No se ha cargado core.js. Recarga la página.'; return; }
    ls.del('ss.prueba'); // resto de la v0.2.0 (la prueba de escritura, que ya no existe)
    // Cerrar o recargar la página con una sincronización en marcha: el navegador pregunta antes (donde lo permite).
    window.addEventListener('beforeunload', e => { if (S.tarea && S.tarea.nombre === TAREA_SINC) { e.preventDefault(); e.returnValue = ''; } });
    // Si otra pestaña de este navegador sincroniza, esta se entera (el resultado y las marcas viven en el navegador).
    window.addEventListener('storage', e => { if ((e.key === 'ss.sinc' || e.key === 'ss.dudosas') && !S.tarea) pinta(); });
    /* Tocar cualquier otra cosa da por terminada la escritura en la casilla del plazo. En el iPhone, tocar un botón
       no le quita el foco a un campo, y con el foco dentro la pantalla no se repinta (ver pinta). */
    document.addEventListener('click', e => {
      const f = document.activeElement;
      if (f && f.id === 'retry-mano' && e.target !== f) f.blur();
    }, true);
    document.addEventListener('pointerdown', () => { pulsando = true; pulsaT = Date.now(); }, true);
    ['pointerup', 'pointercancel'].forEach(n => document.addEventListener(n, () => { pulsando = false; }, true));
    pinta();
    await vueltaOAuth();
    try { await vueltaSoundeo(); } catch (e) { falla(e, 'La vuelta de Soundeo'); }
    window.addEventListener('hashchange', () => { vueltaSoundeo().then(() => { if (S.sxLlegada) sxMira(true); pinta(); }, e => falla(e, 'La vuelta de Soundeo')); });
    pinta();
    miraVersion();
    if (S.db) {
      try {
        await memCarga();
        pinta();
        dbxRpc('users/get_current_account', null).then(j => { S.dbNombre = (j.name && j.name.display_name) || ''; pinta(); }, () => {});
        const ruta = ajuste('xml', null);
        if (ruta) { try { await cargaXml(ruta); } catch (e) { falla(e, 'Leer el XML'); } }
      } catch (e) { falla(e, 'Leer la memoria de Dropbox'); }
      if (S.sxLlegada || S.vista === 'b') sxMira(false);
    }
    // Al cargar la página no se le pide nada a Spotify, salvo el nombre de la cuenta justo después de conectarla.
    if (S.sp && S.recienSp && !corteActivo()) leePerfil().then(pinta, e => falla(e, 'Spotify'));
    pinta();
  }
  // Para las pruebas automáticas: el estado y la puerta de Spotify. El pase de escritura no se expone.
  window.SS = { VERSION, estado: S, spotify, diagnostico, PERMISOS_SPOTIFY, pinta, uneCortes, sxMirando: () => sxMirando };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arranca);
  else arranca();
})();
