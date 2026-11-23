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
const s256 = v => crypto.createHash('sha256').update(v).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class Mundo {
  constructor(opc) {
    this.opc = Object.assign({
      scopeSpotify: null,        // null = lo que se pidió
      limite429: 1,              // cuántas búsquedas devuelven 429 (Retry-After 1) antes de ir bien
      esperaLarga: 0,            // si >0, a partir de la búsqueda nº esperaLarga devuelve 429 con Retry-After 3600
      maxPagina: 30,             // Spotify da como mucho estas por página aunque se pidan más
      prohibido: false,          // todas las lecturas de Spotify dan 403 (cuenta no dada de alta)
      xml: D.xml(),
    }, opc || {});
    this.peticiones = [];        // {host, metodo, ruta}
    this.fuera = [];             // peticiones a sitios no previstos
    this.spotifyNoGet = [];
    this.busquedas = 0;
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
  emiteToken(prov) { const t = prov + '-acceso-' + (++this.nTok) + '-' + crypto.randomBytes(6).toString('hex'); this.tokens[prov].add(t); return t; }

  async instala(contexto) {
    await contexto.route('**/*', ruta => this.atiende(ruta).catch(e => { console.log('  (error en el servicio falso: ' + e.message + ')'); return ruta.abort(); }));
  }
  async atiende(ruta) {
    const req = ruta.request(), u = new URL(req.url()), metodo = req.method();
    this.peticiones.push({ host: u.host, metodo, ruta: u.pathname });
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
        return json({ access_token: this.emiteToken(prov), token_type: 'Bearer', scope, expires_in: prov === 'sp' ? 3600 : 14400, refresh_token: prov + '-refresco-secreto' });
      }
      if (p.grant_type === 'refresh_token' && p.refresh_token === prov + '-refresco-secreto') {
        this.refrescos[prov]++;
        const o = { access_token: this.emiteToken(prov), token_type: 'Bearer', expires_in: prov === 'sp' ? 3600 : 14400 };
        if (prov === 'sp') o.scope = this.opc.scopeSpotify || 'playlist-read-private playlist-read-collaborative user-library-read';
        return json(o);
      }
      return json({ error: 'invalid_grant' }, 400);
    }
    // ---- API de Spotify ----
    if (u.host === 'api.spotify.com') {
      if (metodo !== 'GET') { this.spotifyNoGet.push(metodo + ' ' + u.pathname); return json({ error: { status: 403, message: 'Insufficient client scope' } }, 403); }
      const tok = (req.headers().authorization || '').replace(/^Bearer /, '');
      if (!this.tokens.sp.has(tok)) return json({ error: { status: 401, message: 'The access token expired' } }, 401);
      if (this.opc.prohibido) return json({ error: { status: 403, message: 'User not registered in the Developer Dashboard' } }, 403);
      const ruta_ = u.pathname.replace(/^\/v1/, '');
      const lim = Math.min(parseInt(u.searchParams.get('limit') || '20', 10), this.opc.maxPagina), off = parseInt(u.searchParams.get('offset') || '0', 10);
      const pagina = (todos, f) => ({ href: req.url(), items: todos.slice(off, off + lim).map(f), limit: lim, offset: off, total: todos.length, next: off + lim < todos.length ? 'https://api.spotify.com/v1/siguiente' : null, previous: null });
      if (ruta_ === '/me') return json(D.YO);
      if (ruta_ === '/me/playlists') {
        return json(pagina(D.playlists, p => {
          const o = { id: p.id, name: p.name, owner: p.owner, collaborative: p.collaborative, public: p.public, description: p.description, snapshot_id: p.snapshot_id, type: 'playlist', uri: 'spotify:playlist:' + p.id };
          if (p.owner.id === D.YO.id) o.items = { href: 'https://api.spotify.com/v1/playlists/' + p.id + '/items', total: p.pistas.length };
          return o;
        }));
      }
      let m = ruta_.match(/^\/playlists\/([^/]+)\/items$/);
      if (m) {
        const p = D.playlists.find(x => x.id === m[1]);
        if (!p) return json({ error: { status: 404, message: 'Not found' } }, 404);
        if (p.owner.id !== D.YO.id) return json({ error: { status: 403, message: 'Forbidden' } }, 403);
        return json(pagina(p.pistas, e => ({ added_at: e.added_at, added_by: { id: D.YO.id }, is_local: false, item: e.t })));
      }
      if (/^\/playlists\/[^/]+\/tracks$/.test(ruta_)) return json({ error: { status: 403, message: 'Forbidden' } }, 403); // retirado en 2026
      if (ruta_ === '/me/tracks') return json(pagina(D.likes, e => ({ added_at: e.added_at, track: e.t })));
      if (ruta_ === '/search') {
        this.busquedas++;
        if (parseInt(u.searchParams.get('limit') || '5', 10) > 10) return json({ error: { status: 400, message: 'Invalid limit' } }, 400);
        if (this.opc.esperaLarga && this.busquedas >= this.opc.esperaLarga) return json({ error: { status: 429, message: 'API rate limit exceeded' } }, 429, { 'retry-after': '3600' });
        if (this.opc.limite429 > 0) { this.opc.limite429--; return json({ error: { status: 429, message: 'API rate limit exceeded' } }, 429, { 'retry-after': '1' }); }
        const qt = C.norm(u.searchParams.get('q') || '').split(' ').filter(Boolean);
        const res = D.catalogo.map(t => {
          const texto = ' ' + C.norm(t.name + ' ' + t.artists.map(a => a.name).join(' ')) + ' ';
          return { t, f: qt.filter(x => texto.indexOf(' ' + x + ' ') >= 0).length / (qt.length || 1) };
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
        return json(this.meta(this.pon(rutaF, texto)));
      }
      return json({ error_summary: 'endpoint_no_previsto/' + ep }, 400);
    }
    this.fuera.push(metodo + ' ' + req.url());
    return ruta.abort();
  }
}
module.exports = { Mundo, SITIO };
