/* Spotify y Dropbox de mentira para las pruebas. Se enchufan al navegador de Playwright:
   la app cree que habla con los servicios reales y aquí se apunta todo lo que pide. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('../core.js');
const D = require('./datos.js');

const SITIO = 'https://santi7guti.github.io/synchrosound/';
const RAIZ = path.join(__dirname, '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Dropbox-API-Result, Retry-After' };
// Spotify, como el de verdad en las pruebas con cuentas reales, no deja leer Retry-After desde el navegador (salvo que la prueba lo pida).
const CORS_SP = { 'access-control-allow-origin': '*' };
const s256 = v => crypto.createHash('sha256').update(v).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class Mundo {
  constructor(opc) {
    this.opc = Object.assign({
      scopeSpotify: null,        // null = lo que se pidió
      // corte: {desde, cuota, retry, expone, rutas}: a partir de la petición nº «desde» a la API, Spotify responde 429.
      //   cuota: el cuerpo lleva reason QUOTA_EXCEEDED; retry: segundos de Retry-After; expone: el navegador puede leerla;
      //   rutas: si se da, solo se cortan esas rutas (p. ej. ['/me/playlists']; con '*' al final, las que empiezan así),
      //   porque Spotify corta por grupos de llamadas: el perfil puede responder y las playlists no.
      corte: null,
      maxPagina: 30,             // Spotify da como mucho estas por página aunque se pidan más
      prohibido: false,          // todas las lecturas de Spotify dan 403 (cuenta no dada de alta)
      // escritura: null = Spotify acepta las escrituras bien hechas. {estado, mensaje, cuota, red, llega}: responde con
      //   ese estado (429 con cuota = QUOTA_EXCEEDED), o con red:true corta la conexión; con llega:true la canción
      //   se añade igualmente (la escritura llegó aunque la respuesta diga otra cosa o no llegue).
      //   Sin «estado» ni «red», la escritura se acepta (201) con estas variantes, para probar lo que la app comprueba
      //   después: {parcial: n} solo añade las n primeras; {doble: true} las añade dos veces; {oculta: n} las n lecturas
      //   siguientes de esa playlist aún enseñan lo de antes; {espera: ms} tarda en responder; {cuelga: true} la añade
      //   y no responde nunca (como si la página se cerrase a mitad); {sinCuerpo: true} responde 201 sin cuerpo.
      //   Con «llega», {oculta: n} vale también cuando la respuesta falla.
      escritura: null,
      itemsFallaTrasEscribir: null, // un código (403…): tras la primera escritura, leer cualquier playlist falla con él
      listaAtrasada: false,      // la lista de playlists sigue dando el sello y el total de antes de escribir
      playlists: null,           // null = las comunes de datos.js; si no, una copia propia (D.copiaBiblio())
      subidaFalla: null,         // expresión regular: las subidas a Dropbox cuya ruta la cumpla responden 400
      xml: D.xml(),
    }, opc || {});
    this.playlists = this.opc.playlists || D.playlists;
    this.escrituras = [];        // todo lo que llega a la API de Spotify y no es GET: {metodo, ruta, q, cuerpo, tipo}
    this.eventos = [];           // en orden: 'sp GET /v1/…', 'sp POST /v1/…' y 'db sube /ruta' (para saber qué fue antes)
    this.scopeDe = new Map();    // token de Spotify -> permisos con los que se emitió
    this.scopeSp = '';           // permisos concedidos en la última autorización de Spotify
    this.peticiones = [];        // {host, metodo, ruta, q}
    this.fuera = [];             // peticiones a sitios no previstos
    this.spotifyNoGet = [];
    this.busquedas = 0;
    this.spGets = 0;             // peticiones GET a la API de Spotify que llegan con token válido
    this.sp429 = 0;              // cuántas se han respondido con 429
    this.itemsDe = {};           // id de playlist -> veces que se ha pedido su contenido
    this.autoriza = {};          // parámetros del último /authorize por proveedor
    this.retos = {};             // code -> {reto, prov}
    this.tokens = { sp: new Set(), db: new Set() };
    this.refrescos = { sp: 0, db: 0 };
    this.nTok = 0;
    this.dbEndpoints = new Set();
    this.archivos = new Map();   // ruta en minúsculas -> {ruta, texto, rev, fecha}
    this.nRev = 0;
    if (this.opc.xml != null) this.pon('/rekordbox.xml', this.opc.xml, '2026-11-23T13:05:00Z');
    this.pon('/Notas.txt', 'esto no es un xml', '2026-11-01T10:00:00Z');
  }
  pon(ruta, texto, fecha) {
    this.nRev++;
    const a = { ruta, texto, rev: 'rev' + String(this.nRev).padStart(9, '0'), fecha: fecha || new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
    this.archivos.set(ruta.toLowerCase(), a);
    return a;
  }
  meta(a) {
    return { '.tag': 'file', name: a.ruta.split('/').pop(), path_display: a.ruta, path_lower: a.ruta.toLowerCase(), id: 'id:' + a.rev,
      client_modified: a.fecha, server_modified: a.fecha, rev: a.rev, size: Buffer.byteLength(a.texto, 'utf8') };
  }
  emiteToken(prov, scope) { const t = prov + '-acceso-' + (++this.nTok) + '-' + crypto.randomBytes(6).toString('hex'); this.tokens[prov].add(t); if (prov === 'sp') this.scopeDe.set(t, scope || ''); return t; }

  async instala(contexto) {
    await contexto.route('**/*', ruta => this.atiende(ruta).catch(e => { console.log('  (error en el servicio falso: ' + e.message + ')'); return ruta.abort(); }));
  }
  async atiende(ruta) {
    const req = ruta.request(), u = new URL(req.url()), metodo = req.method();
    this.peticiones.push({ host: u.host, metodo, ruta: u.pathname, q: u.search });
    const json = (o, estado, cab) => ruta.fulfill({ status: estado || 200, headers: Object.assign({ 'content-type': 'application/json' }, CORS, cab || {}), body: JSON.stringify(o) });

    if (req.url().startsWith(SITIO)) {
      let rel = u.pathname.slice('/synchrosound/'.length) || 'index.html';
      if (['index.html', 'app.js', 'core.js', 'styles.css', 'version.json'].indexOf(rel) < 0) return ruta.fulfill({ status: 404, body: 'no' });
      return ruta.fulfill({ status: 200, headers: { 'content-type': TIPOS[path.extname(rel)] }, body: fs.readFileSync(path.join(RAIZ, rel)) });
    }
    // ---- inicio de sesión ----
    if ((u.host === 'accounts.spotify.com' && u.pathname === '/authorize') || (u.host === 'www.dropbox.com' && u.pathname === '/oauth2/authorize')) {
      const prov = u.host === 'www.dropbox.com' ? 'db' : 'sp';
      const p = Object.fromEntries(u.searchParams);
      this.autoriza[prov] = p;
      const code = prov + '-code-' + crypto.randomBytes(5).toString('hex');
      this.retos[code] = { reto: p.code_challenge, prov, redirect: p.redirect_uri, scope: p.scope || '' };
      const vuelta = new URL(p.redirect_uri);
      if (this.opc.denegar === prov) vuelta.searchParams.set('error', 'access_denied');
      else vuelta.searchParams.set('code', code);
      vuelta.searchParams.set('state', p.state);
      return ruta.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<script>location.replace(' + JSON.stringify(vuelta.toString()) + ')</script>' });
    }
    if ((u.host === 'accounts.spotify.com' && u.pathname === '/api/token') || (u.host === 'api.dropboxapi.com' && u.pathname === '/oauth2/token')) {
      const prov = u.host === 'api.dropboxapi.com' ? 'db' : 'sp';
      const p = Object.fromEntries(new URLSearchParams(req.postData() || ''));
      if (p.client_secret) return json({ error: 'la_app_no_debe_mandar_secretos' }, 400);
      if (p.grant_type === 'authorization_code') {
        const r = this.retos[p.code];
        if (!r || r.prov !== prov || s256(p.code_verifier || '') !== r.reto || p.redirect_uri !== r.redirect) return json({ error: 'invalid_grant' }, 400);
        delete this.retos[p.code];
        const scope = prov === 'sp' ? (this.opc.scopeSpotify || r.scope) : 'account_info.read files.content.read files.content.write files.metadata.read';
        if (prov === 'sp') this.scopeSp = scope;
        return json({ access_token: this.emiteToken(prov, scope), token_type: 'Bearer', scope, expires_in: prov === 'sp' ? 3600 : 14400, refresh_token: prov + '-refresco-secreto' });
      }
      if (p.grant_type === 'refresh_token' && p.refresh_token === prov + '-refresco-secreto') {
        this.refrescos[prov]++;
        // Al renovar, Spotify mantiene los permisos que se concedieron al autorizar.
        const sc = prov === 'sp' ? (this.opc.scopeSpotify || this.scopeSp || 'playlist-read-private playlist-read-collaborative user-library-read') : '';
        const o = { access_token: this.emiteToken(prov, sc), token_type: 'Bearer', expires_in: prov === 'sp' ? 3600 : 14400 };
        if (prov === 'sp') o.scope = sc;
        return json(o);
      }
      return json({ error: 'invalid_grant' }, 400);
    }
    // ---- API de Spotify ----
    if (u.host === 'api.spotify.com') {
      const tok = (req.headers().authorization || '').replace(/^Bearer /, '');
      if (metodo !== 'OPTIONS') this.eventos.push('sp ' + metodo + ' ' + u.pathname);
      if (metodo !== 'GET') {
        // Escrituras. Se apunta todo lo que llega; solo se atiende «añadir canciones a una playlist propia», con el permiso que toca.
        this.spotifyNoGet.push(metodo + ' ' + u.pathname);
        const cuerpo = req.postData() || '';
        this.escrituras.push({ metodo, ruta: u.pathname, q: u.search, cuerpo, tipo: req.headers()['content-type'] || '' });
        if (!this.tokens.sp.has(tok)) return json({ error: { status: 401, message: 'The access token expired' } }, 401);
        const prohibe = msg => json({ error: { status: 403, message: msg || 'Forbidden' } }, 403);
        const mw = u.pathname.match(/^\/v1\/playlists\/([^/]+)\/items$/);
        if (metodo !== 'POST' || !mw) return prohibe();
        const pw = this.playlists.find(x => x.id === mw[1]);
        if (!pw) return json({ error: { status: 404, message: 'Not found' } }, 404);
        const permisos = (this.scopeDe.get(tok) || '').split(' ');
        if (permisos.indexOf(pw.public ? 'playlist-modify-public' : 'playlist-modify-private') < 0) return prohibe('Insufficient client scope');
        if (pw.owner.id !== D.YO.id) return prohibe();
        let uris = null;
        try { uris = JSON.parse(cuerpo).uris; } catch (e) { uris = null; }
        if (!Array.isArray(uris) || !uris.length || uris.length > 100) return json({ error: { status: 400, message: 'Bad request' } }, 400);
        const aplica = () => {
          for (const uri of uris) pw.pistas.push({ added_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), t: D.catalogo.find(c => c.uri === uri) || { id: uri.split(':').pop(), uri, type: 'track', name: 'Desconocida', artists: [], duration_ms: 0 } });
          pw.snapshot_id += 'w';
        };
        const esc = this.opc.escritura;
        if (!esc || (esc.estado == null && !esc.red)) {
          const viejas = pw.pistas.slice(), selloViejo = pw.snapshot_id;
          if (esc && esc.parcial != null) uris = uris.slice(0, esc.parcial);
          aplica();
          if (esc && esc.doble) aplica();
          if (esc && esc.oculta) pw.oculta = { n: esc.oculta, pistas: viejas, sirve: false };
          if (this.opc.listaAtrasada && !pw.enLista) pw.enLista = { snapshot_id: selloViejo, total: viejas.length };
          if (esc && esc.cuelga) return new Promise(() => {});
          if (esc && esc.espera) await new Promise(r => setTimeout(r, esc.espera));
          if (esc && esc.sinCuerpo) return ruta.fulfill({ status: 201, headers: CORS_SP, body: '' });
          return json({ snapshot_id: pw.snapshot_id }, 201);
        }
        if (esc.llega) {
          const viejas = pw.pistas.slice();
          aplica();
          if (esc.oculta) pw.oculta = { n: esc.oculta, pistas: viejas, sirve: false };
        }
        if (esc.red) return ruta.abort('connectionreset');
        if (esc.estado === 429) {
          this.sp429++;
          const c429 = { error: { status: 429, message: 'Too many requests' } };
          if (esc.cuota) c429.error.reason = 'QUOTA_EXCEEDED';
          return ruta.fulfill({ status: 429, headers: Object.assign({ 'content-type': 'application/json' }, CORS_SP), body: JSON.stringify(c429) });
        }
        return json({ error: { status: esc.estado, message: esc.mensaje || 'Forbidden' } }, esc.estado);
      }
      if (!this.tokens.sp.has(tok)) return json({ error: { status: 401, message: 'The access token expired' } }, 401);
      this.spGets++;
      const ct = this.opc.corte, ruta_ = u.pathname.replace(/^\/v1/, '');
      const cortada = ct && (!ct.rutas || ct.rutas.some(r => (r.slice(-1) === '*' ? ruta_.indexOf(r.slice(0, -1)) === 0 : ruta_ === r)));
      if (cortada && this.spGets >= ct.desde) {
        this.sp429++;
        const cuerpo = { error: { status: 429, message: ct.cuota ? 'Too many requests' : 'API rate limit exceeded' } };
        if (ct.cuota) cuerpo.error.reason = 'QUOTA_EXCEEDED';
        const cab = Object.assign({ 'content-type': 'application/json' }, ct.expone ? CORS : CORS_SP);
        if (ct.retry != null) cab['retry-after'] = String(ct.retry);
        return ruta.fulfill({ status: 429, headers: cab, body: JSON.stringify(cuerpo) });
      }
      if (this.opc.prohibido) return json({ error: { status: 403, message: 'User not registered in the Developer Dashboard' } }, 403);
      const lim = Math.min(parseInt(u.searchParams.get('limit') || '20', 10), this.opc.maxPagina), off = parseInt(u.searchParams.get('offset') || '0', 10);
      const pagina = (todos, f) => ({ href: req.url(), items: todos.slice(off, off + lim).map(f), limit: lim, offset: off, total: todos.length, next: off + lim < todos.length ? 'https://api.spotify.com/v1/siguiente' : null, previous: null });
      if (ruta_ === '/me') return json(D.YO);
      if (ruta_ === '/me/playlists') {
        return json(pagina(this.playlists, p => {
          const o = { id: p.id, name: p.name, owner: p.owner, collaborative: p.collaborative, public: p.public, description: p.description, snapshot_id: p.enLista ? p.enLista.snapshot_id : p.snapshot_id, type: 'playlist', uri: 'spotify:playlist:' + p.id };
          if (p.owner.id === D.YO.id) o.items = { href: 'https://api.spotify.com/v1/playlists/' + p.id + '/items', total: p.enLista ? p.enLista.total : p.pistas.length };
          return o;
        }));
      }
      let m = ruta_.match(/^\/playlists\/([^/]+)\/items$/);
      if (m) {
        const p = this.playlists.find(x => x.id === m[1]);
        if (!p) return json({ error: { status: 404, message: 'Not found' } }, 404);
        if (p.owner.id !== D.YO.id) return json({ error: { status: 403, message: 'Forbidden' } }, 403);
        this.itemsDe[p.id] = (this.itemsDe[p.id] || 0) + 1;
        if (this.opc.itemsFallaTrasEscribir && this.escrituras.length) return json({ error: { status: this.opc.itemsFallaTrasEscribir, message: 'Forbidden' } }, this.opc.itemsFallaTrasEscribir);
        // «oculta»: cada lectura completa (empieza en offset 0) gasta una de las que aún enseñan lo de antes
        if (p.oculta && off === 0) { p.oculta.sirve = p.oculta.n > 0; if (p.oculta.sirve) p.oculta.n--; }
        if (p.oculta && p.oculta.sirve) return json(pagina(p.oculta.pistas, e => ({ added_at: e.added_at, added_by: { id: D.YO.id }, is_local: false, item: e.t })));
        return json(pagina(p.pistas, e => ({ added_at: e.added_at, added_by: { id: D.YO.id }, is_local: false, item: e.t })));
      }
      if (/^\/playlists\/[^/]+\/tracks$/.test(ruta_)) return json({ error: { status: 403, message: 'Forbidden' } }, 403); // retirado en 2026
      if (ruta_ === '/me/tracks') return json(pagina(D.likes, e => ({ added_at: e.added_at, track: e.t })));
      if (ruta_ === '/search') {
        this.busquedas++;
        if (parseInt(u.searchParams.get('limit') || '5', 10) > 10) return json({ error: { status: 400, message: 'Invalid limit' } }, 400);
        if (!(u.searchParams.get('q') || '').trim()) return json({ error: { status: 400, message: 'No search query' } }, 400);
        const qt = C.norm(u.searchParams.get('q') || '').split(' ').filter(Boolean);
        const res = D.catalogo.filter(t => !t.soloConExtended || qt.indexOf('extended') >= 0).map(t => {
          const texto = ' ' + C.norm(t.name + ' ' + t.artists.map(a => a.name).join(' ')) + ' ';
          return { t, f: qt.filter(x => texto.indexOf(x.length >= 4 ? x : ' ' + x + ' ') >= 0).length / (qt.length || 1) };
        }).filter(x => x.f >= 0.6).sort((a, b) => b.f - a.f).slice(0, 10).map(x => x.t);
        return json({ tracks: { href: req.url(), items: res, limit: 10, offset: 0, total: res.length, next: null, previous: null } });
      }
      return json({ error: { status: 404, message: 'Service not found' } }, 404);
    }
    // ---- API de Dropbox ----
    if (u.host === 'api.dropboxapi.com' || u.host === 'content.dropboxapi.com') {
      const ep = u.pathname.replace(/^\/2\//, '');
      this.dbEndpoints.add(ep);
      const tok = (req.headers().authorization || '').replace(/^Bearer /, '');
      if (!this.tokens.db.has(tok)) return json({ error_summary: 'expired_access_token/', error: { '.tag': 'expired_access_token' } }, 401);
      const noEsta = () => json({ error_summary: 'path/not_found/..', error: { '.tag': 'path', path: { '.tag': 'not_found' } } }, 409);
      if (u.host === 'api.dropboxapi.com') {
        const arg = JSON.parse(req.postData() || 'null');
        if (ep === 'users/get_current_account') return json({ account_id: 'dbid:x', name: { display_name: 'Cuenta de Prueba' }, email: 'no-debe-salir@ejemplo.test' });
        if (ep === 'files/list_folder') {
          if (this.opc.sinPermisoLista) return json({ error_summary: 'missing_scope/.', error: { '.tag': 'missing_scope', required_scope: 'files.metadata.read' } }, 401);
          const base = (arg.path || '').toLowerCase();
          const todos = Array.from(this.archivos.values()).filter(a => a.ruta.toLowerCase().startsWith(base + '/') && (arg.recursive || a.ruta.slice(base.length + 1).indexOf('/') < 0));
          if (base && !todos.length) return noEsta();
          return json({ entries: todos.map(a => this.meta(a)), cursor: 'c', has_more: false });
        }
        if (ep === 'files/get_metadata') { const a = this.archivos.get((arg.path || '').toLowerCase()); return a ? json(this.meta(a)) : noEsta(); }
        return json({ error_summary: 'endpoint_no_previsto/' + ep }, 400);
      }
      const arg = JSON.parse(req.headers()['dropbox-api-arg'] || 'null');
      if (ep === 'files/download') {
        const a = this.archivos.get((arg.path || '').toLowerCase());
        if (!a) return noEsta();
        return ruta.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/octet-stream', 'dropbox-api-result': JSON.stringify(this.meta(a)).replace(/[\u007f-￿]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4)) }, CORS), body: Buffer.from(a.texto, 'utf8') });
      }
      if (ep === 'files/upload') {
        const texto = (req.postDataBuffer() || Buffer.alloc(0)).toString('utf8');
        const modo = typeof arg.mode === 'string' ? arg.mode : arg.mode['.tag'];
        let rutaF = arg.path;
        if (this.opc.subidaFalla && this.opc.subidaFalla.test(rutaF)) return json({ error_summary: 'prueba/subida_rechazada/' }, 400);
        const ya = this.archivos.get(rutaF.toLowerCase());
        const conflicto = () => json({ error_summary: 'path/conflict/file/..', error: { '.tag': 'path', reason: { '.tag': 'conflict' } } }, 409);
        if (modo === 'add' && ya) {
          if (!arg.autorename) return conflicto();
          let n = 1;
          const pt = rutaF.lastIndexOf('.');
          while (this.archivos.has((rutaF.slice(0, pt) + ' (' + n + ')' + rutaF.slice(pt)).toLowerCase())) n++;
          rutaF = rutaF.slice(0, pt) + ' (' + n + ')' + rutaF.slice(pt);
        }
        if (modo === 'update' && (!ya || ya.rev !== arg.mode.update)) return conflicto();
        this.eventos.push('db sube ' + rutaF);
        return json(this.meta(this.pon(rutaF, texto)));
      }
      return json({ error_summary: 'endpoint_no_previsto/' + ep }, 400);
    }
    this.fuera.push(metodo + ' ' + req.url());
    return ruta.abort();
  }
}
module.exports = { Mundo, SITIO };
