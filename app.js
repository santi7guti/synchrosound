/* SynchroSound — la app. FASE 1: SOLO LECTURA EN SPOTIFY.
   Web estática, sin servidor. Habla solo con Spotify y Dropbox (PKCE, sin secretos). */
(function () {
  'use strict';

  const VERSION = '0.1.5';
  const C = window.SSCore;

  const CFG = {
    spotifyId: '6251c56f9a7e49d4891a1531e89735ad', // público: no es un secreto
    dropboxKey: 'd614ryq07qvpgkj',                 // público: no es un secreto
    vuelta: 'https://santi7guti.github.io/synchrosound/',
  };
  /* FASE 1 = SOLO LECTURA. Estos son los únicos permisos que se piden a Spotify, y con ellos
     Spotify rechaza cualquier cambio. No añadir permisos de escritura sin el OK expreso del dueño
     para la fase 2. `user-library-modify` (tocar los likes) no se pide nunca. */
  const PERMISOS_SPOTIFY = ['playlist-read-private', 'playlist-read-collaborative', 'user-library-read'];

  const RUTA_MEM = '/memoria/memoria.json';
  const RUTA_CACHE = '/memoria/cache-busquedas.json';
  const RUTA_LIB = '/memoria/cache-biblioteca.json';
  const PAUSA_SP = 350;                       // milisegundos entre dos peticiones a Spotify
  const GUARDA = { cuota: 60 * 60000, otro: 15 * 60000 }; // tras un corte sin plazo, cuánto tarda la app en volver a intentarlo
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
    c: null, cOcultas: false,
    copias: null, ultimaCopia: null,
    tarea: null, parar: false, candado: false,
    avisos: [], errores: [], nueva: null,
    cont: { spGet: 0, spBloqueadas: 0, sp429: 0, busquedas: 0, deCache: 0, db: 0, ext: 0 },
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
      // Comprobación de la fase 1: si Spotify concediese algo más que lectura, no se guarda.
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
  function desconecta(prov) {
    S[prov] = null; ls.del('ss.' + prov);
    if (prov === 'sp') { S.yo = null; ls.del('ss.yo'); S.lib = null; S.sim = null; S.c = null; }
    else { S.dbNombre = ''; S.archivos = null; S.xml = null; S.mem = null; S.memRev = null; S.memLista = false; S.cache = null; S.libCache = undefined; S.copias = null; }
    aviso(NOMBRE[prov] + ' desconectado de este dispositivo.');
  }

  // ---------------- cuánto se le pide a Spotify ----------------
  /* Spotify limita las peticiones de las apps en modo desarrollo con una cuota que no publica. Por eso la app
     cuenta lo que pide cada día (entre todos los dispositivos) y, si Spotify corta, lo apunta y no insiste. */
  function disp() { let d = ls.get('ss.disp'); if (!d) { d = alAzar(4); ls.set('ss.disp', d); } return d; }
  let usoSucio = false;
  function usoLocal() { const u = ls.get('ss.uso'); return u && u.dia === hoy() ? u : { dia: hoy(), n: 0 }; }
  function cuentaPeticion() { const u = usoLocal(); u.n++; ls.set('ss.uso', u); usoSucio = true; }
  function anotaUso() {
    if (!S.mem || !S.memLista || !usoSucio) return;
    const u = usoLocal(), k = u.dia + '|' + disp();
    if (!S.mem.uso) S.mem.uso = {};
    S.mem.uso[k] = { n: u.n, t: Date.now() };
    const d = new Date(); d.setDate(d.getDate() - 30);
    const lim = d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate());
    for (const x of Object.keys(S.mem.uso)) if (x.slice(0, 10) < lim) delete S.mem.uso[x];
    usoSucio = false;
    memToca();
  }
  function usoDe(dia) {
    const mio = dia + '|' + disp(), loc = usoLocal(), U = (S.mem && S.mem.uso) || {};
    let otros = 0;
    for (const k in U) if (k.slice(0, 10) === dia && k !== mio) otros += U[k].n || 0;
    const propio = dia === loc.dia ? Math.max(loc.n, (U[mio] && U[mio].n) || 0) : ((U[mio] && U[mio].n) || 0);
    return { total: otros + propio, propio };
  }
  // El último corte de Spotify: se guarda en este dispositivo y en la memoria común, para que el otro lo sepa.
  function corteSp() {
    const a = ls.get('ss.corte'), b = S.mem && S.mem.ajustes && S.mem.ajustes.corteSp && S.mem.ajustes.corteSp.v;
    const c = a && b ? ((b.t || 0) > (a.t || 0) ? b : a) : (a || b || null);
    return c && c.t ? c : null;
  }
  const corteActivo = () => { const c = corteSp(); return c && !c.fin && Date.now() < c.hasta ? c : null; };
  function apuntaCorte(c) {
    ls.set('ss.corte', c);
    if (S.mem && S.memLista) { S.mem.ajustes.corteSp = { v: c, t: Date.now() }; memToca(); }
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
    const esp = c.espera != null ? ' Pide esperar ' + duracion(c.espera) + '.' : ' No dice cuánto hay que esperar; a otros les ha durado horas.';
    return (local ? 'No se ha enviado nada a Spotify. ' : '') + 'A ' + horaODia(c.t) + ': ' + que + esp +
      ' Para no alargarlo, la app no lo intentará antes de ' + horaODia(c.hasta) + '. Lo ya leído se conserva.';
  }

  // ---------------- Spotify: única puerta ----------------
  let spUltima = 0;
  /* Todas las llamadas a la API de Spotify pasan por aquí. En la fase 1 solo deja salir GET:
     cualquier otra cosa se corta antes de llegar a la red. */
  async function spotify(metodo, ruta, opts) {
    if (metodo !== 'GET') {
      S.cont.spBloqueadas++;
      throw new Error('Bloqueado: esta versión no escribe en Spotify (' + metodo + ' ' + ruta + ').');
    }
    const url = 'https://api.spotify.com/v1' + ruta;
    const pausa = Math.max(PAUSA_SP, (opts && opts.pausa) || 0);
    // Si Spotify cortó hace poco, no se envía nada hasta que pase el plazo (salvo la prueba que pide el usuario).
    const c0 = corteSp();
    if (c0 && !c0.fin && Date.now() < c0.hasta && !(opts && opts.aunque)) throw errorCorte(c0, true);
    for (let intento = 0; ; intento++) {
      const falta = spUltima + pausa - Date.now();
      if (falta > 0) await espera(falta);
      spUltima = Date.now();
      const tok = await token('sp');
      let r;
      try { r = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + tok } }); }
      catch (e) {
        if (intento < 2) { await espera(1500 * (intento + 1)); continue; }
        throw new Error('No hay conexión con Spotify.');
      }
      S.cont.spGet++;
      cuentaPeticion();
      if (r.status === 401 && intento < 1) { await refresca('sp'); continue; }
      if (r.status === 429) {
        /* Se para a la primera: insistir sobre un 429 solo alarga el corte. Se apunta lo que Spotify dice de
           verdad: el motivo que viene en el cuerpo y el plazo de la cabecera Retry-After, si el navegador la deja leer. */
        S.cont.sp429++;
        let motivo = '';
        try { const j = JSON.parse(await r.text()); motivo = String((j.error && j.error.reason) || ''); } catch (e) { /* sin cuerpo */ }
        const ra = parseInt(r.headers.get('Retry-After'), 10);
        const plazo = isFinite(ra) && ra >= 0 ? ra : null, cuota = motivo === 'QUOTA_EXCEEDED', t = Date.now();
        const c = { t, cuota, motivo, espera: plazo, hasta: t + (plazo != null ? plazo * 1000 : (cuota ? GUARDA.cuota : GUARDA.otro)), ruta: ruta.split('?')[0] };
        apuntaCorte(c);
        anotaUso();
        throw errorCorte(c, false);
      }
      if (r.status >= 500 && intento < 3) { await espera(1200 * (intento + 1)); continue; }
      if (!r.ok) {
        let cuerpo = '';
        try { cuerpo = await r.text(); } catch (e) { /* sin cuerpo */ }
        let msg = cuerpo.slice(0, 200);
        try { const j = JSON.parse(cuerpo); msg = (j.error && (j.error.message || j.error)) || msg; } catch (e) { /* texto */ }
        const err = new Error('Spotify respondió ' + r.status + (msg ? ': ' + msg : '') + ' (' + ruta.split('?')[0] + ')');
        err.status = r.status; err.servicio = 'Spotify';
        throw err;
      }
      // Spotify vuelve a responder: se apunta cuándo, que es lo que dice cuánto duró el corte.
      if (c0 && !c0.fin) apuntaCorte(Object.assign({}, c0, { fin: Date.now() }));
      return r.json();
    }
  }
  // Recorre una lista paginada avanzando por lo que de verdad llega (por si Spotify da menos de lo pedido).
  async function paginas(ruta, alLlegar) {
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
      siParar();
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
    const cs = (await listaCarpeta('/copias', false)).filter(a => /^spotify-completa-.*\.json$/i.test(a.nombre)).sort((a, b) => (b.nombre > a.nombre ? 1 : -1));
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
    const K = !todo && S.libCache && S.libCache.usuario === yo.id ? S.libCache : { v: 1, usuario: yo.id, pls: {}, likes: null };
    const N = { v: 1, usuario: yo.id, t: Date.now(), pls: {}, likes: null };
    const L = { releidas: 0, iguales: 0, likes: '', peticiones: 0, semilla: K.semilla || '' };
    const playlists = [];
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
        if (g && g.snap && g.snap === pl.snapshot && (pl.total == null || g.total == null || g.total === pl.total)) {
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
        } catch (e) {
          if (e.status === 403 || e.status === 404) pl.motivo = 'Spotify no deja leerla (' + e.status + ')';
          else throw e;
        }
        N.pls[p.id] = { snap: pl.snapshot, total: pl.total, items: pl.items, contenido: pl.contenido, motivo: pl.motivo };
        L.releidas++; cambio = true;
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
        S.libCache = completa ? N : { v: 1, usuario: yo.id, t: Date.now(), pls: Object.assign({}, K.pls, N.pls), likes: N.likes || K.likes };
        await libCacheGuarda();
      }
    }
    S.lib = { leida: Date.now(), yo: S.yo, playlists, likes, idx: null, lectura: L };
    S.c = null;
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
      .map(e => ({ ruta: e.path_display, baja: e.path_lower, nombre: e.name, tam: e.size, fecha: e.client_modified || e.server_modified }));
  }

  // ---------------- memoria de la app (en Dropbox, común a PC e iPhone) ----------------
  const SECCIONES = ['mapa', 'soundeo', 'decisiones', 'ocultas', 'pares', 'ajustes', 'uso'];
  function memVacia() { const m = { v: 1 }; SECCIONES.forEach(s => { m[s] = {}; }); return m; }
  // Une dos memorias: en cada dato gana el más reciente.
  function fusiona(a, b) {
    const m = memVacia();
    for (const s of SECCIONES) {
      const A = (a && a[s]) || {}, B = (b && b[s]) || {};
      for (const k of new Set(Object.keys(A).concat(Object.keys(B)))) {
        const x = A[k], y = B[k];
        m[s][k] = !x ? y : !y ? x : ((y.t || 0) > (x.t || 0) ? y : x);
      }
    }
    return m;
  }
  async function memCarga() {
    const r = await dbxBaja(RUTA_MEM);
    if (r) { S.mem = fusiona(JSON.parse(r.texto), S.mem); S.memRev = (r.meta && r.meta.rev) || null; }
    else { S.mem = fusiona(S.mem, null); S.memRev = null; }
    S.memLista = true;
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
    S.sim = null;
    return S.xml;
  }
  const pareceXml = a => !/^\/(copias|memoria|soundeo)\//.test(a.baja) && (/\.xml$/i.test(a.nombre) || !/\.[a-z0-9]{1,5}$/i.test(a.nombre));

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
    /* Una búsqueda ya hecha vale entre 30 y 40 días si dio resultados y entre 3 y 5 si no dio ninguno. El plazo
       depende del texto buscado para que no caduquen todas el mismo día y haya que repetirlas de golpe. */
    let h = 0;
    for (let i = 0; i < q.length; i++) h = (h * 31 + q.charCodeAt(i)) % 1000;
    if (c && ahora - c.t < (c.r.length ? 30 + h / 100 : 3 + h / 500) * 864e5) { S.cont.deCache++; return c.r; }
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
    u.decidida = !!(dec && (dec.si || dec.nada || (dec.no && dec.no.length)));
    u.ninguna = !!(dec && dec.nada);
  }
  function versionBien(rb, el) {
    if (el.r.dd <= 10) return true;
    return !!rb.tit.ver.largo && el.sp.tit.ver.largo === rb.tit.ver.largo && el.r.dd <= 45;
  }
  async function resuelve(u, idx) {
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
    if (!S.lib || fresca || Date.now() - S.lib.leida > 15 * 60000) await leeBiblioteca(prog);
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
    const sim = { fecha: Date.now(), xmlFecha: S.xml.fecha, unicas: Array.from(unicas.values()), hechas: 0, incompleta: true, mapa };
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
      await cacheGuarda();
    }
    if (!cuenta(sim).add && cuenta(sim).duda) S.simFiltro = 'duda';
    return sim;
  }
  function cuenta(sim) {
    const c = { ya: 0, add: 0, duda: 0, no: 0 };
    sim.unicas.forEach(u => { if (u.estado) c[u.estado]++; });
    return c;
  }
  // Estado de una canción dentro de una playlist concreta.
  const estadoEn = (u, d) => (d.ya ? 'ya' : u.elegida ? 'add' : u.dudosas.length ? 'duda' : 'no');
  function porPlaylist(sim) {
    const out = new Map();
    (S.xml ? S.xml.datos.delMapa : []).forEach(pl => out.set(pl.clave, { pl, ya: 0, add: 0, duda: 0, no: 0, total: 0 }));
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
    reevalua(u, indices());
    pinta();
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
    reevalua(u, indices());
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
  function construyeCopia(lib) {
    const pista = it => (it.t
      ? { uri: it.t.u, nombre: it.t.n, artistas: it.t.a, album: it.t.al, duracion_s: it.t.d, isrc: it.t.isrc || undefined, local: it.local || undefined, agregada: it.add }
      : { uri: it.uri || null, nombre: it.nombre || null, tipo: it.tipo, agregada: it.add });
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
      likes: lib.likes.map(pista),
      playlists: lib.playlists.map(p => ({
        id: p.id, uri: 'spotify:playlist:' + p.id, nombre: p.nombre, propia: p.propia, colaborativa: p.colaborativa,
        publica: p.publica, descripcion: p.descripcion, duenio: p.dueno, snapshot_id: p.snapshot,
        total_segun_spotify: p.total, contenido_guardado: p.contenido, motivo: p.motivo || undefined,
        canciones: p.items.map(pista),
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

  // ---------------- diagnóstico (sin tokens ni datos de acceso) ----------------
  function diagnostico() {
    const L = [];
    const p = s => L.push(s);
    p('SynchroSound ' + VERSION + ' — fase 1 (solo lectura) — buscador v' + C.MATCHER);
    p('Fecha: ' + new Date().toISOString());
    p('Navegador: ' + navigator.userAgent);
    p('Dropbox: ' + (S.db ? 'conectado; permisos: ' + (S.db.scope || '(no informados)') : 'sin conectar'));
    p('Memoria: ' + (S.memLista ? 'cargada' + (S.memRev ? '' : ' (aún sin archivo)') : 'sin cargar'));
    p('Spotify: ' + (S.sp ? 'conectado; permisos: ' + (S.sp.scope || '(no informados)') : 'sin conectar'));
    p('Peticiones a Spotify: ' + S.cont.spGet + ' GET; escrituras enviadas: 0; escrituras bloqueadas por la app: ' + S.cont.spBloqueadas + '; avisos de límite (429): ' + S.cont.sp429);
    const uh = usoDe(hoy());
    p('Peticiones a Spotify hoy: ' + uh.total + ' entre todos tus dispositivos (este: ' + uh.propio + ')');
    const dias = {};
    Object.keys((S.mem && S.mem.uso) || {}).forEach(k => { const d = k.slice(0, 10); if (d !== hoy()) dias[d] = (dias[d] || 0) + (S.mem.uso[k].n || 0); });
    const antes = Object.keys(dias).sort().slice(-7);
    if (antes.length) p('  días anteriores: ' + antes.map(d => d.slice(8) + '/' + d.slice(5, 7) + ' ' + dias[d]).join('; '));
    const ct = corteSp();
    p('Último corte de Spotify: ' + (ct ? fechaHora(ct.t) + ' en ' + ct.ruta + '; motivo: ' + (ct.motivo || 'no lo dice') + '; plazo: ' + (ct.espera != null ? duracion(ct.espera) : 'no legible') +
      (ct.fin ? '; volvió a responder el ' + fechaHora(ct.fin) : '; la app no reintenta antes de ' + horaODia(ct.hasta)) : 'ninguno apuntado'));
    p('Búsquedas: ' + S.cont.busquedas + ' nuevas, ' + S.cont.deCache + ' de caché; de ellas, ' + S.cont.ext + ' buscando la Extended. Peticiones a Dropbox: ' + S.cont.db);
    if (S.xml) {
      const X = S.xml.datos;
      p('XML: ' + S.xml.ruta + ' (' + kb(S.xml.tam) + '), último cambio ' + fechaHora(S.xml.fecha) + ', comprobado ' + soloHora(S.xml.visto) + ', ' + X.producto);
      p('  entradas ' + X.entradas + '; ignoradas: ' + X.ignoradas.soundcloud + ' de SoundCloud, ' + X.ignoradas.sampler + ' samples; playlists ' + X.playlists.length + ' (del mapa ' + X.delMapa.length + ')');
    } else p('XML: sin elegir');
    if (S.lib) {
      const pr = S.lib.playlists.filter(x => x.propia).length, sin = S.lib.playlists.filter(x => !x.contenido).length;
      p('Biblioteca: ' + S.lib.playlists.length + ' playlists (' + pr + ' propias, ' + sin + ' sin contenido), ' + S.lib.likes.length + ' likes; leída ' + fechaHora(S.lib.leida));
      p('  ' + textoLectura(S.lib.lectura));
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
      p('Simulación ' + fechaHora(S.sim.fecha) + (S.sim.incompleta ? ' [INCOMPLETA ' + S.sim.hechas + '/' + S.sim.unicas.length + ']' : '') + ': únicas ' + S.sim.unicas.length + '; ya están ' + c.ya + '; se añadirían ' + c.add + '; dudosas ' + c.duda + '; no están ' + c.no);
      porPlaylist(S.sim).forEach(f => p('  ' + f.pl.clave + ': ya ' + f.ya + ', añadir ' + f.add + ', dudosas ' + f.duda + ', no están ' + f.no));
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
  const VISTAS = [['cuentas', '', 'Cuentas'], ['a', 'A', 'rekordbox a Spotify'], ['c', 'C', 'Sin repartir'], ['copia', '', 'Copia'], ['diag', '', 'Diagnóstico']];
  function ir(v) { S.vista = v; ls.set('ss.vista', v); window.scrollTo(0, 0); pinta(); }
  const boton = (texto, fn, clase, off) => h('button', { class: 'btn ' + (clase || ''), type: 'button', onclick: fn, disabled: !!off || !!S.tarea }, texto);
  const enlace = (texto, href) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, texto);
  // Enlace «spotify:»: lo abre la app de Spotify instalada, sin pestaña nueva. Va sin target a propósito.
  const enlaceApp = (texto, uri) => h('a', { href: uri, class: 'app' }, texto);

  function cabecera() {
    const escritas = S.sp ? S.sp.scope.split(/\s+/).filter(Boolean) : [];
    return h('header', { class: 'cab' },
      h('div', { class: 'cab-fila' },
        h('div', { class: 'marca' }, 'SynchroSound', h('span', { class: 'ver', title: 'Versión' }, 'v' + VERSION)),
        h('button', { class: 'candado', type: 'button', 'aria-expanded': S.candado ? 'true' : 'false', onclick: () => { S.candado = !S.candado; pinta(); } },
          h('span', { class: 'pestillo', 'aria-hidden': 'true' }, h('span', { class: 'pestillo-pieza' })), 'Solo lectura')),
      S.candado && h('div', { class: 'candado-panel' },
        h('p', null, 'Esta versión no puede cambiar nada en tu Spotify. Lo garantiza Spotify, no solo el código: la app pide únicamente permisos de lectura, así que Spotify rechaza cualquier intento de añadir, quitar o crear.'),
        h('p', null, 'Permisos pedidos: ' + PERMISOS_SPOTIFY.join(', ') + '.'),
        S.sp && h('p', null, 'Permisos que Spotify dice haber concedido: ' + (escritas.join(', ') || '(no lo ha dicho)') + '.'),
        h('p', null, 'En esta sesión: ' + S.cont.spGet + ' lecturas de Spotify y 0 escrituras.'),
        h('p', null, 'Peticiones a Spotify hoy: ' + usoDe(hoy()).total + ' entre todos tus dispositivos (este: ' + usoDe(hoy()).propio + ').'),
        h('p', null, 'En Dropbox la app solo ve su carpeta. Ahí escribe archivos nuevos (copias) y su memoria; no borra nada y no toca el XML de rekordbox.')),
      S.nueva && h('div', { class: 'nueva' }, 'Hay una versión nueva (' + S.nueva + '). ',
        h('button', { class: 'btn mini', type: 'button', onclick: () => location.replace(location.pathname + '?v=' + encodeURIComponent(S.nueva)) }, 'Recargar')),
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
  // Mientras dura un corte de Spotify se dice arriba, con la opción de probar gastando una sola petición.
  function bandaCorte() {
    const c = corteActivo();
    if (!c) return null;
    return h('div', { class: 'estado mal corte-sp' }, textoCorte(c, false),
      h('div', { class: 'acciones' }, boton('Probar ahora (gasta 1 petición)', () => tarea('Probar Spotify', async () => {
        await spotify('GET', '/me', { aunque: true });
        aviso('Spotify vuelve a responder.');
      }), 'mini sec')));
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
        h('p', { class: 'nota' }, 'Solo lectura: se piden tres permisos para leer playlists y likes. Con ellos Spotify rechaza cualquier cambio.'),
        h('p', { class: 'estado' + (S.sp ? ' ok' : '') }, S.sp ? 'Conectado' + (S.yo ? ' como ' + S.yo.nombre : '') + '.' : 'Sin conectar en este dispositivo.'),
        S.sp && h('p', { class: 'nota' }, 'Permisos concedidos: ' + (S.sp.scope || '(Spotify no lo ha dicho)') + '.'),
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
        h('h2', null, 'Soundeo y SoundCloud'),
        h('p', { class: 'nota' }, 'Soundeo llega en la fase 3, con un userscript en el iPhone. SoundCloud no se puede conectar: su API no lo permite.')),
    ];
  }

  // ---- A ----
  const CAT = { add: 'Se añadirían', duda: 'Dudosas', no: 'No están en Spotify', ya: 'Ya están' };
  function tira(c) {
    const total = c.ya + c.add + c.duda + c.no;
    return h('div', { class: 'tira', role: 'img', 'aria-label': 'Ya están ' + c.ya + ', se añadirían ' + c.add + ', dudosas ' + c.duda + ', no están ' + c.no },
      ['ya', 'add', 'duda', 'no'].map(k => (c[k] ? h('span', { class: 'tramo ' + k, css: { 'flex-grow': String(c[k]) } }) : null)),
      !total && h('span', { class: 'tramo vacio', css: { 'flex-grow': '1' } }));
  }
  const destinosDe = (u, soloFalta) => u.destinos.filter(d => !soloFalta || !d.ya).map(d => (S.sim.mapa[d.clave] ? S.sim.mapa[d.clave].nombre : d.clave + ' (sin pareja)')).join(', ');
  function filaSim(u) {
    const rb = u.rb;
    const cab = h('div', { class: 'fila-titulo' }, lineaRb(rb), h('span', { class: 'dur' }, C.mmss(rb.dur)));
    const abrir = sp => [enlaceApp('Abrir en la app', 'spotify:track:' + encodeURIComponent(sp.id)), enlace('Web', 'https://open.spotify.com/track/' + encodeURIComponent(sp.id))];
    const deshacer = u.decidida && boton('Deshacer mi respuesta', () => decide(u, null, null), 'mini sec');
    const noEs = sp => boton('No es', () => descarta(u, sp), 'mini sec');
    let cuerpo;
    if (u.estado === 'add') {
      const e = u.elegida;
      cuerpo = [h('div', { class: 'fila-sub' }, 'En Spotify: ' + lineaSp(e.sp.m), h('span', { class: 'dur' }, C.mmss(e.sp.dur))),
        e.r.nota && h('div', { class: 'fila-nota' }, e.r.nota),
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
        h('div', { class: 'fila-nota' }, 'Duda: ' + (d.r.motivos.join('; ') || 'no coincide del todo') + '.'),
        h('div', { class: 'fila-acc' },
          boton('Añadir', () => decide(u, d.sp.uri, true), 'mini'),
          boton('No es', () => decide(u, d.sp.uri, false), 'mini sec'),
          abrir(d.sp)))),
        h('div', { class: 'fila-sub' }, 'Iría a: ' + destinosDe(u, true)),
        (u.dudosas.length > 1 || deshacer) && h('div', { class: 'fila-acc' },
          u.dudosas.length > 1 && boton('Ninguna es', () => ninguna(u), 'mini sec'), deshacer)];
    } else {
      const q = encodeURIComponent((rb.artista + ' ' + rb.tit.crudoBase).trim());
      cuerpo = [u.ninguna && h('div', { class: 'fila-nota' }, 'Dijiste que ninguna de las de Spotify es la tuya. Solo volverá a salir si aparece una coincidencia segura.'),
        h('div', { class: 'fila-sub' }, 'Iría a: ' + destinosDe(u, true)),
        h('div', { class: 'fila-acc' }, enlace('Buscar en SoundCloud', 'https://soundcloud.com/search?q=' + q), enlaceApp('Buscar en la app de Spotify', 'spotify:search:' + q), enlace('Web', 'https://open.spotify.com/search/' + q), deshacer)];
    }
    return h('li', { class: 'fila cat-' + u.estado }, h('div', { class: 'fila-cuerpo' }, cab, cuerpo));
  }
  function vistaA() {
    const listo = S.db && S.sp && S.xml;
    const out = [];
    out.push(h('section', { class: 'bloque' },
      h('h2', null, 'rekordbox a Spotify, en simulación'),
      h('p', { class: 'nota' }, 'Compara las playlists New School y Old Gems de rekordbox con sus playlists «NS -» y «OG -» de Spotify y enseña qué se añadiría. No cambia nada en Spotify.'),
      !listo && h('p', { class: 'estado mal' }, 'Falta: ' + [!S.db && 'conectar Dropbox', !S.sp && 'conectar Spotify', !S.xml && 'elegir el XML de rekordbox'].filter(Boolean).join(', ') + '. Se hace en Cuentas.'),
      S.xml && h('p', { class: 'estado' }, 'XML de rekordbox: último cambio el ' + fechaHora(S.xml.fecha) + ' (comprobado a las ' + soloHora(S.xml.visto) + ').' +
        (S.lib ? ' Spotify leído el ' + fechaHora(S.lib.leida) + (S.lib.lectura ? ': ' + textoLectura(S.lib.lectura) : '') + '.' : '')),
      bandaCorte(),
      h('div', { class: 'acciones' },
        boton(S.sim ? 'Simular otra vez' : 'Simular', () => tarea('Simular', p => simula(p, false)), '', !listo),
        S.lib && boton('Simular leyendo Spotify de nuevo', () => tarea('Simular', p => simula(p, true)), 'sec', !listo),
        !S.lib && listo && boton('Leer Spotify para ver el mapa', () => tarea('Leer Spotify', p => leeBiblioteca(p)), 'sec'))));

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
            memToca(); S.sim = null; S.c = null; pinta();
          } },
            h('option', { value: '', selected: !act }, 'Sin pareja' + (act ? '' : ' (esperada: ' + C.nombreDestino(pl) + ')')),
            propias.map(p => h('option', { value: p.id, selected: !!act && act.id === p.id }, p.nombre)));
          return h('li', { class: 'fila' + (act ? '' : ' cat-no') }, h('div', { class: 'fila-cuerpo' },
            h('div', { class: 'fila-titulo' }, (pl.grupo === 'OG' ? 'Old Gems / ' : 'New School / ') + pl.nombre, h('span', { class: 'dur' }, canciones(pl.ids.length))),
            h('div', { class: 'mapa-sel' }, sel, m.ambiguas.indexOf(pl.clave) >= 0 && h('span', { class: 'fila-nota' }, 'Hay varias con ese nombre: elige una.')),
            f && [tira(f), h('div', { class: 'fila-sub' }, 'Ya están ' + f.ya + ', se añadirían ' + f.add + ', dudosas ' + f.duda + ', no están ' + f.no + '.')]));
        }))));
    }
    if (S.sim) {
      const c = cuenta(S.sim), filtro = S.simFiltro;
      let lista = S.sim.unicas.filter(u => u.estado === filtro);
      let conAviso = 0, filas;
      if (filtro === 'add') {
        lista = porRiesgo(lista);
        conAviso = lista.filter(u => riesgoDe(u) > 0).length;
        filas = lista.map(filaSim);
        if (conAviso && conAviso < lista.length) filas.splice(conAviso, 0, h('li', { class: 'corte' }, 'Sin aviso: ' + (lista.length - conAviso)));
        if (conAviso) filas.unshift(h('li', { class: 'corte' }, 'Con aviso: ' + conAviso));
      } else filas = lista.map(filaSim);
      out.push(h('section', { class: 'bloque' },
        h('h2', null, 'Resultado'),
        h('p', { class: 'estado' + (S.sim.incompleta ? ' mal' : '') }, (S.sim.incompleta ? 'Simulación incompleta (' + S.sim.hechas + ' de ' + S.sim.unicas.length + '). ' : '') + canciones(S.sim.unicas.length) + ' distintas en rekordbox. Simulación del ' + fechaHora(S.sim.fecha) + ': no se ha cambiado nada en Spotify.'),
        tira(c),
        h('div', { class: 'filtros', role: 'tablist' }, ['add', 'duda', 'no', 'ya'].map(k =>
          h('button', { class: 'filtro cat-' + k + (filtro === k ? ' activo' : ''), type: 'button', role: 'tab', 'aria-selected': filtro === k ? 'true' : 'false', onclick: () => { S.simFiltro = k; pinta(); } },
            h('span', { class: 'filtro-num' }, String(c[k])), CAT[k]))),
        filtro === 'duda' && lista.length > 0 && h('p', { class: 'nota' }, 'En esta fase «Añadir» solo guarda tu respuesta para cuando se pueda escribir; no cambia nada en Spotify. «No es» descarta esa candidata. «Ninguna es» las descarta todas y deja de preguntar por esa canción.'),
        filtro === 'add' && lista.length > 0 && h('p', { class: 'nota' }, (conAviso ? 'Arriba van las ' + conAviso + ' que llevan aviso; primero las que en Spotify duran más que tu archivo, que es lo menos habitual. ' : '') +
          '«No es» descarta esa canción de Spotify para tu archivo: se recuerda y se puede deshacer.'),
        filtro === 'ya' && lista.length > 0 && h('p', { class: 'nota' }, '«No es» sirve si la que está en la playlist no es la tuya: deja de contar como que ya está.'),
        filtro === 'no' && lista.length > 0 && h('p', { class: 'nota' }, 'Se vuelven a buscar de vez en cuando (cada pocas semanas), no en cada simulación: así se gastan pocas peticiones a Spotify.'),
        lista.length ? h('ul', { class: 'lista' }, filas) : h('p', { class: 'estado' }, 'Nada en esta lista.')));
    }
    return out;
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
    if (S.lib && S.mem) {
      const s = soundeoActual(), propias = S.lib.playlists.filter(p => p.propia);
      out.push(h('section', { class: 'bloque' },
        h('h2', null, 'Playlists de Soundeo'),
        h('ul', { class: 'lista mapa' }, SOUNDEO.map(([k, nombre]) => h('li', { class: 'fila' + (s[k] ? '' : ' cat-no') }, h('div', { class: 'fila-cuerpo' },
          h('div', { class: 'fila-titulo' }, nombre, s[k] && h('span', { class: 'dur' }, canciones(s[k].items.length))),
          h('div', { class: 'mapa-sel' }, h('select', { 'aria-label': 'Playlist de Spotify para ' + nombre, disabled: !!S.tarea, onchange: e => { S.mem.soundeo[k] = { id: e.target.value || null, t: Date.now() }; memToca(); if (S.lib) calculaC(); pinta(); } },
            h('option', { value: '', selected: !s[k] }, 'Sin pareja'),
            propias.map(p => h('option', { value: p.id, selected: !!s[k] && s[k].id === p.id }, p.nombre))))))))));
    }
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
  function vistaDiag() {
    const texto = diagnostico();
    return [h('section', { class: 'bloque' },
      h('h2', null, 'Diagnóstico'),
      h('p', { class: 'nota' }, 'Resumen para pegar en la conversación con Claude. Lleva nombres de playlists y canciones de ejemplo; no lleva contraseñas, tokens ni tu correo.'),
      h('div', { class: 'acciones' }, boton('Copiar', () => copia(texto))),
      S.sp && S.db && h('p', { class: 'nota' }, 'La app guarda lo último leído de Spotify y solo vuelve a pedir lo que ha cambiado. Si alguna vez no cuadra con lo que ves en Spotify, puedes releerlo todo; gasta una petición por cada 50 canciones.'),
      S.sp && S.db && h('div', { class: 'acciones' }, boton('Releer todo Spotify', () => tarea('Releer todo Spotify', p => leeBiblioteca(p, true)), 'sec')),
      h('textarea', { id: 'diag', class: 'diag', readonly: true, rows: '18', 'aria-label': 'Texto del diagnóstico' }, texto))];
  }

  let raiz = null;
  function pinta() {
    if (!raiz) return;
    const y = window.scrollY;
    const v = { cuentas: vistaCuentas, a: vistaA, c: vistaC, copia: vistaCopia, diag: vistaDiag }[S.vista] || vistaCuentas;
    let cuerpo;
    try { cuerpo = v(); }
    catch (e) { if (window.console) console.error(e); S.errores.push({ t: new Date().toISOString(), donde: 'Pintar ' + S.vista, m: String(e.message || e) }); cuerpo = h('p', { class: 'estado mal' }, 'Error al pintar esta pantalla: ' + (e.message || e)); }
    raiz.replaceChildren(...[cabecera(), zonaAvisos(), h('main', { class: 'vista' }, cuerpo), barraTarea(),
      h('footer', { class: 'pie' }, 'SynchroSound v' + VERSION + '. Fase 1: solo lectura.')].filter(Boolean));
    window.scrollTo(0, y);
  }

  async function arranca() {
    raiz = document.getElementById('app');
    if (!C) { raiz.textContent = 'No se ha cargado core.js. Recarga la página.'; return; }
    pinta();
    await vueltaOAuth();
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
    }
    // Al cargar la página no se le pide nada a Spotify, salvo el nombre de la cuenta justo después de conectarla.
    if (S.sp && S.recienSp) leePerfil().then(pinta, e => falla(e, 'Spotify'));
    pinta();
  }
  // Para las pruebas automáticas: estado de solo lectura y la puerta de Spotify.
  window.SS = { VERSION, estado: S, spotify, diagnostico, PERMISOS_SPOTIFY };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arranca);
  else arranca();
})();
