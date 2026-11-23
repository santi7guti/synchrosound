/* SynchroSound — núcleo.
   Normalización de textos, lector del XML de rekordbox y buscador de coincidencias.
   Son funciones puras: aquí no hay red ni se toca Spotify, Dropbox ni el navegador. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Súbelo cuando cambien las reglas del buscador: invalida lo emparejado con reglas viejas.
  const MATCHER = 1;

  // ---------- texto ----------
  const RARAS = { 'ø': 'o', 'đ': 'd', 'ł': 'l', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ð': 'd', 'þ': 'th', 'ı': 'i' };

  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[øđłßæœðþı]/g, c => RARAS[c])
      .replace(/['’‘`´.]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }
  function toks(s) { return s ? String(s).split(' ').filter(Boolean) : []; }
  function ordena(s) { return toks(s).sort().join(' '); }

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const c = ca === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }
  function parecido(a, b) {
    if (a === b) return 1;
    const m = Math.max(a.length, b.length);
    return m ? 1 - lev(a, b) / m : 0;
  }
  function mmss(seg) {
    seg = Math.max(0, Math.round(seg || 0));
    return Math.floor(seg / 60) + ':' + String(seg % 60).padStart(2, '0');
  }

  // ---------- títulos ----------
  // Palabras que convierten un paréntesis en «nombre de versión».
  const MARCA = new Set(['remix', 'rmx', 'mix', 'edit', 'reedit', 'rework', 'regroove', 'bootleg', 'flip', 'refix',
    'remake', 'version', 'vip', 'dub', 'tool', 'mashup', 'rerub', 'extended', 'original', 'radio', 'instrumental',
    'acapella', 'acappella', 'live', 'acoustic', 'mixed', 'edition']);
  // Palabras que dicen «es un remix» aunque no se sepa de quién.
  const REMIX = new Set(['remix', 'rmx', 'rework', 'regroove', 'bootleg', 'flip', 'refix', 'remake', 'mashup',
    'reedit', 'rerub', 'tool']);
  const L_RADIO = new Set(['radio', 'short', 'single', '7']);
  const L_ORIG = new Set(['original', 'album', 'main']);
  const L_EXT = new Set(['long', 'full', '12']);
  // Versiones que suenan distinto: nunca valen como «la misma».
  const SABOR = new Set(['instrumental', 'dub', 'acapella', 'acappella', 'live', 'acoustic', 'vip', 'mixed', 'demo',
    'karaoke']);
  // Palabras genéricas que no son el nombre de nadie («Extended Mix», «Club Mix»…).
  const GEN = new Set([...MARCA, ...L_RADIO, ...L_ORIG, ...L_EXT, ...SABOR, 'club', 'vocal', 'the', 'a', 'inch',
    'digital', 'clean', 'dirty', 'explicit', 'official', 'video', 'audio', 're']);
  const FEAT = new Set(['feat', 'ft', 'featuring', 'with']);

  function clasifica(crudo) {
    const t = toks(norm(crudo));
    if (!t.length) return null;
    if (FEAT.has(t[0])) return { tipo: 'feat', v: t.slice(1).join(' ') };
    if (t.some(x => x.startsWith('remaster'))) return { tipo: 'remaster' };
    if (t.length === 1 && /^(19|20)\d\d$/.test(t[0])) return { tipo: 'anio' };
    if (!t.some(x => MARCA.has(x))) return { tipo: 'extra', v: t.join(' '), crudo: String(crudo).trim() };
    const resto = t.slice();
    while (resto.length && GEN.has(resto[resto.length - 1])) resto.pop();
    const palabras = String(crudo).trim().split(/\s+/);
    while (palabras.length && (GEN.has(norm(palabras[palabras.length - 1])) || !norm(palabras[palabras.length - 1]))) palabras.pop();
    const who = resto.join(' ');
    let largo = null;
    if (t.includes('extended')) largo = 'ext';
    else if (t.some(x => L_RADIO.has(x))) largo = 'radio';
    else if (t.some(x => L_ORIG.has(x))) largo = 'orig';
    else if (t.some(x => L_EXT.has(x))) largo = 'ext';
    else if (!who && t.includes('edit')) largo = 'radio';
    return {
      tipo: 'ver', who, crudoWho: palabras.join(' '), largo,
      sabores: t.filter(x => SABOR.has(x)).map(x => (x === 'acappella' ? 'acapella' : x)),
      esRemix: !!who || t.some(x => REMIX.has(x)),
    };
  }

  /* Separa un título en: nombre base, paréntesis que son parte del nombre («extras»),
     artistas invitados y versión (de quién es el remix, si es Extended/Original/Radio…). */
  function parseTitulo(crudo) {
    let s = String(crudo == null ? '' : crudo).replace(/\s+/g, ' ').trim();
    let pista = '', crudoPista = '';
    const pi = s.indexOf(' | ');
    if (pi > 0) { crudoPista = s.slice(pi + 3).trim(); pista = norm(crudoPista); s = s.slice(0, pi); }
    const descs = [];
    for (let k = 0; k < 3; k++) {
      const antes = s;
      s = s.replace(/\(([^()]*)\)|\[([^\[\]]*)\]/g, (m, a, b) => { descs.push(a != null ? a : b); return ' '; });
      if (s === antes) break;
    }
    const partes = s.split(/\s+[-–—]\s+/);
    s = partes.shift() || '';
    for (const p of partes) descs.push(p);
    let m = s.match(/^(.*\S)\s+(?:feat\.?|ft\.?|featuring)\s+(\S.*)$/i);
    if (m) { s = m[1]; descs.push('feat ' + m[2]); }
    m = s.match(/^(.*\S)\s+(remix|rmx|bootleg)$/i);
    if (m && norm(m[1])) { s = m[1]; descs.push(m[2]); }
    const o = {
      base: norm(s), crudoBase: s.replace(/\s+/g, ' ').trim(), extras: [], crudoExtras: [], feats: '', pista, crudoPista,
      ver: { who: '', crudoWho: '', largo: null, sabores: '', esRemix: false, remaster: false },
    };
    const sab = new Set();
    for (const d of descs) {
      const c = clasifica(d);
      if (!c) continue;
      if (c.tipo === 'feat') o.feats = (o.feats + ' ' + c.v).trim();
      else if (c.tipo === 'remaster') o.ver.remaster = true;
      else if (c.tipo === 'extra') { o.extras.push(c.v); o.crudoExtras.push(c.crudo); }
      else if (c.tipo === 'ver') {
        if (c.who) { o.ver.who = (o.ver.who + ' ' + c.who).trim(); o.ver.crudoWho = (o.ver.crudoWho + ' ' + c.crudoWho).trim(); }
        if (!o.ver.largo) o.ver.largo = c.largo;
        if (c.esRemix) o.ver.esRemix = true;
        c.sabores.forEach(x => sab.add(x));
      }
    }
    o.ver.sabores = Array.from(sab).sort().join(' ');
    o.full = [o.base].concat(o.extras).join(' ').trim();
    o.kBase = ordena(o.base);
    o.kFull = ordena(o.full);
    return o;
  }

  // ---------- artistas ----------
  const STOP_ART = new Set(['feat', 'ft', 'featuring', 'vs', 'x', 'and', 'with', 'the', 'pres', 'presents', 'y']);
  const sinPais = s => String(s || '').replace(/\((?:[A-Za-z]{2,3})\)/g, ' ');

  function tokensArtista(s) {
    return toks(norm(sinPais(s))).filter(t => !STOP_ART.has(t));
  }
  function artistasCrudos(s) {
    return sinPais(s)
      .split(/\s*(?:,|&|\+|;|\/|\bfeat\.?(?=\s)|\bft\.?(?=\s)|\bfeaturing\b|\bvs\.?(?=\s)|\s[xX]\s)\s*/i)
      .map(x => x.trim()).filter(Boolean);
  }
  function conj(lista) {
    const set = new Set(lista);
    for (let i = 0; i + 1 < lista.length; i++) set.add(lista[i] + lista[i + 1]);
    return { set, lista };
  }
  /* Qué parte (0..1) de `mios` aparece en `cand`, pesando por longitud y perdonando
     una letra cambiada («marten»/«martan») y nombres pegados o separados («dos mitades»/«dosmitades»). */
  function cobertura(mios, cand) {
    if (!mios.length) return 0;
    const cub = mios.map(t => {
      if (cand.set.has(t)) return true;
      if (t.length < 4) return false;
      return cand.lista.some(c =>
        (c.length > t.length && c.includes(t) && t.length >= 0.6 * c.length) ||
        (t.length >= 5 && Math.abs(c.length - t.length) <= 1 && lev(c, t) <= 1));
    });
    for (let i = 0; i + 1 < mios.length; i++) if (cand.set.has(mios[i] + mios[i + 1])) cub[i] = cub[i + 1] = true;
    let tot = 0, ok = 0;
    mios.forEach((t, i) => { tot += t.length; if (cub[i]) ok += t.length; });
    return tot ? ok / tot : 0;
  }

  // ---------- descripciones ----------
  function descRb(t) {
    let artista = String(t.artist || '').replace(/\s+/g, ' ').trim();
    let nombre = String(t.name || '').replace(/\s+/g, ' ').trim();
    const i = nombre.indexOf(' - ');
    if (i > 0) {
      const izq = nombre.slice(0, i);
      if (!artista) { artista = izq; nombre = nombre.slice(i + 3); }
      else if (norm(izq) === norm(artista)) nombre = nombre.slice(i + 3);
    }
    const tit = parseTitulo(nombre);
    if (!tit.ver.who && t.remixer && norm(t.remixer)) {
      tit.ver.who = norm(t.remixer); tit.ver.crudoWho = String(t.remixer).trim(); tit.ver.esRemix = true;
    }
    return {
      id: t.id, artista, nombre, dur: t.dur || 0, tit, art: tokensArtista(artista),
      clave: norm(t.artist) + '|' + norm(t.name),
    };
  }
  function minSp(tr) {
    return {
      id: tr.id || null,
      u: tr.uri || (tr.id ? 'spotify:track:' + tr.id : ''),
      n: tr.name || '',
      a: (tr.artists || []).map(x => x && x.name).filter(Boolean),
      d: Math.round((tr.duration_ms || 0) / 1000),
      al: (tr.album && tr.album.name) || '',
      isrc: (tr.external_ids && tr.external_ids.isrc) || '',
    };
  }
  const cacheSp = new WeakMap();
  function descSp(m) {
    let d = cacheSp.get(m);
    if (d) return d;
    d = {
      id: m.id, uri: m.u, m, dur: m.d || 0, tit: parseTitulo(m.n),
      art: tokensArtista((m.a || []).join(' , ')), prim: tokensArtista((m.a || [])[0] || ''),
    };
    cacheSp.set(m, d);
    return d;
  }
  // Dos canciones de Spotify con la misma clave son «la misma canción» (da igual Extended, Original o Radio Edit).
  function claveCancion(sp) {
    return sp.prim.join(' ') + '|' + sp.tit.base + '|' + sp.tit.ver.who + '|' + sp.tit.ver.sabores;
  }

  // ---------- comparación ----------
  function evalTitulo(a, b) {
    if (!a.full || !b.full) return { nivel: 'no', sim: 0 };
    if (a.kFull === b.kFull || a.kFull === b.kBase || a.kBase === b.kFull) return { nivel: 'exact', sim: 1 };
    if (a.base && a.base === b.base) return { nivel: (a.extras.length && b.extras.length) ? 'extras' : 'base', sim: 1 };
    const s = Math.max(parecido(a.full, b.full), a.base && b.base ? parecido(a.base, b.base) : 0);
    if (s >= 0.82 && Math.min(a.full.length, b.full.length) >= 4) return { nivel: 'fuzzy', sim: s };
    return { nivel: 'no', sim: s };
  }

  function evalArtista(rb, sp) {
    if (!rb.art.length) return { nivel: 'sin', cov: 0, prim: 0 };
    const cand = conj(sp.art.concat(toks(sp.tit.ver.who), toks(sp.tit.feats)));
    const cov = cobertura(rb.art, cand);
    const mio = conj(rb.art.concat(toks(rb.tit.ver.who), toks(rb.tit.feats)));
    const prim = cobertura(sp.prim, mio);
    if (cov >= 0.85 || (prim >= 0.85 && cov >= 0.5)) return { nivel: 'fuerte', cov, prim };
    if (cov >= 0.34 || prim >= 0.85) return { nivel: 'parcial', cov, prim };
    if (rb.tit.pista && cobertura(sp.prim, conj(toks(rb.tit.pista))) >= 0.85) return { nivel: 'pista', cov, prim };
    return { nivel: 'no', cov, prim };
  }

  function mismoQuien(x, y) {
    const a = toks(x), b = toks(y);
    return Math.max(cobertura(a, conj(b)), cobertura(b, conj(a))) >= 0.85;
  }
  const PEN_LARGO = { 'ext>': 4, 'ext>orig': 4, 'ext>radio': 8, 'orig>': 0, 'orig>ext': 4, 'orig>radio': 6, 'radio>': 2, 'radio>orig': 2, 'radio>ext': 8 };

  function evalVersion(rb, sp) {
    const a = rb.tit.ver, b = sp.tit.ver;
    const largo = () => {
      const pen = (a.largo && a.largo !== b.largo) ? (PEN_LARGO[a.largo + '>' + (b.largo || '')] || 0) : 0;
      return { ok: true, pen };
    };
    if (a.sabores !== b.sabores) return { ok: false, motivo: 'sabor' };
    if (a.who && b.who) return mismoQuien(a.who, b.who) ? largo() : { ok: false, motivo: 'otro-remix', descarta: true };
    if (a.who && !b.who) return { ok: false, motivo: 'falta-remix' };
    if (!a.who && b.who) {
      if (a.esRemix && cobertura(rb.art, conj(toks(b.who).concat(sp.art))) >= 0.85) return largo();
      return { ok: false, motivo: 'es-remix' };
    }
    if (a.esRemix !== b.esRemix) return { ok: false, motivo: a.esRemix ? 'falta-remix' : 'es-remix' };
    return largo();
  }

  const NOM_LARGO = { ext: 'Extended', orig: 'Original', radio: 'Radio Edit' };
  function notaDe(rb, sp, dd) {
    const p = [];
    const la = rb.tit.ver.largo, lb = sp.tit.ver.largo;
    if (la === 'ext' && lb !== 'ext') { if (dd > 10) p.push('Sin Extended en Spotify: se usa la ' + (lb === 'radio' ? 'Radio Edit' : 'Original')); }
    else if (la && lb && la !== lb) p.push('En Spotify es la ' + NOM_LARGO[lb]);
    else if (!la && lb === 'radio') p.push('En Spotify es la Radio Edit');
    else if (!la && lb === 'ext') p.push('En Spotify es la Extended');
    if (rb.dur && sp.dur && dd > 20) p.push('dura ' + mmss(sp.dur) + ' en Spotify y ' + mmss(rb.dur) + ' en rekordbox');
    return p.join('; ');
  }
  function motivosDe(rb, sp, T, A, V) {
    const m = [];
    if (T.nivel === 'fuzzy') m.push('el título no es idéntico');
    if (T.nivel === 'extras') m.push('el paréntesis del título es distinto');
    if (A.nivel === 'parcial') m.push('solo coincide parte de los artistas');
    if (A.nivel === 'sin') m.push('en rekordbox no tiene artista');
    if (A.nivel === 'pista') m.push('el artista solo sale en tu anotación del título');
    if (!V.ok) {
      if (V.motivo === 'sabor') m.push('es otra versión (' + (sp.tit.ver.sabores || rb.tit.ver.sabores) + ')');
      else if (V.motivo === 'falta-remix') m.push('en Spotify está la original, no ' + (rb.tit.ver.who ? 'la de ' + (rb.tit.ver.crudoWho || rb.tit.ver.who) : 'el remix'));
      else if (V.motivo === 'es-remix') m.push('en Spotify es un remix' + (sp.tit.ver.who ? ' (' + (sp.tit.ver.crudoWho || sp.tit.ver.who) + ')' : ''));
    }
    return m;
  }

  /* Compara una canción de rekordbox con una de Spotify.
     clase: 'seguro' (se puede añadir sola), 'dudosa' (se pregunta) o 'no'. */
  function puntua(rb, sp) {
    const T = evalTitulo(rb.tit, sp.tit);
    if (T.nivel === 'no') return { clase: 'no', p: 0 };
    const A = evalArtista(rb, sp);
    if (A.nivel === 'no') return { clase: 'no', p: 0 };
    const V = evalVersion(rb, sp);
    if (V.descarta) return { clase: 'no', p: 0 };
    let p = 100;
    if (T.nivel === 'base') p -= 3;
    else if (T.nivel === 'extras') p -= 15;
    else if (T.nivel === 'fuzzy') p -= 12 + (1 - T.sim) * 80;
    p -= { fuerte: 0, parcial: 22, sin: 28, pista: 34 }[A.nivel];
    if (A.nivel === 'fuerte') p -= (1 - Math.min(1, A.cov)) * 6;
    p -= V.ok ? V.pen : 30;
    const dd = (rb.dur && sp.dur) ? Math.abs(rb.dur - sp.dur) : 30;
    p -= Math.min(20, dd / 6);
    const seguro = (T.nivel === 'exact' || T.nivel === 'base') && A.nivel === 'fuerte' && V.ok;
    return {
      clase: seguro ? 'seguro' : 'dudosa', p, dd, titulo: T.nivel, artista: A.nivel, version: V.ok ? 'ok' : V.motivo,
      nota: seguro ? notaDe(rb, sp, dd) : '', motivos: seguro ? [] : motivosDe(rb, sp, T, A, V),
      otraVersion: seguro && dd > 20,
    };
  }

  const UMBRAL_DUDA = 35;
  /* Elige entre candidatas. opts.rechazadas: uris marcadas «No es»; opts.enCasa: ids de su biblioteca. */
  function elige(rb, cands, opts) {
    opts = opts || {};
    const vistos = new Set(), ev = [];
    for (const sp of cands) {
      if (!sp || !sp.uri || vistos.has(sp.uri)) continue;
      vistos.add(sp.uri);
      if (opts.rechazadas && opts.rechazadas.has(sp.uri)) continue;
      const r = puntua(rb, sp);
      if (r.clase === 'no') continue;
      if (r.clase === 'dudosa' && r.p < UMBRAL_DUDA) continue;
      if (opts.enCasa && opts.enCasa.has(sp.id)) r.p += 1.5;
      ev.push({ sp, r });
    }
    ev.sort((x, y) => ((y.r.clase === 'seguro') - (x.r.clase === 'seguro')) || (y.r.p - x.r.p));
    const seguro = ev.length && ev[0].r.clase === 'seguro' ? ev[0] : null;
    return { seguro, dudosas: seguro ? [] : ev.slice(0, 3) };
  }
  // ¿Está ya esta canción (u otra versión de la misma) en una lista de canciones de Spotify?
  function yaEsta(rb, lista) {
    let mejor = null;
    for (const sp of lista) {
      const r = puntua(rb, sp);
      if (r.clase === 'seguro' && (!mejor || r.p > mejor.r.p)) mejor = { sp, r };
    }
    return mejor;
  }

  // ---------- búsquedas ----------
  function limpiaQ(s) {
    return String(s || '').replace(/["“”«»()\[\]{}|*:;!?¿¡]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // Hasta 3 textos de búsqueda, del más completo al más suelto.
  function consultas(rb) {
    const t = rb.tit, arts = artistasCrudos(rb.artista);
    const base = t.crudoBase || t.crudoExtras.join(' ');
    let who = t.ver.crudoWho || t.ver.who;
    if (who && norm(arts.join(' ')).indexOf(norm(who)) >= 0) who = ''; // el remixer ya va como artista
    // Los paréntesis en mayúsculas son anotaciones a mano («OJO BPM»): no se buscan.
    const ext = t.crudoBase ? t.crudoExtras.filter(x => x !== x.toUpperCase() || !/[A-Z]/.test(x)).join(' ') : '';
    const j = (...p) => limpiaQ(p.filter(Boolean).join(' ')).slice(0, 140);
    const qs = [];
    const mete = q => { if (q && !qs.includes(q)) qs.push(q); };
    mete(j(base, arts.join(' '), who));
    if (arts.length > 1) mete(j(base, arts[0], who));
    if (t.crudoPista) mete(j(base, t.crudoPista)); // su anotación «Título | Artista original»
    if (ext) mete(j(base, ext, arts[0]));
    if (arts.length > 1) mete(j(base, arts[arts.length - 1], who));
    if (who) mete(j(base, who));
    if (who && arts.length) mete(j(base, arts[0]));
    if (!arts.length) mete(j(base));
    return qs.slice(0, 3);
  }
  function consultaExtended(rb) {
    const arts = artistasCrudos(rb.artista);
    return limpiaQ([rb.tit.crudoBase, arts[0] || '', rb.tit.ver.crudoWho || '', 'extended'].filter(Boolean).join(' ')).slice(0, 140);
  }

  // ---------- XML de rekordbox ----------
  const hijos = (n, nombre) => Array.prototype.filter.call(n ? n.children : [], c => c.nodeName === nombre);

  /* Lee el documento XML (ya parseado) de rekordbox. No modifica nada.
     Ignora lo que es streaming de SoundCloud y los samples. */
  function leeRekordbox(doc) {
    const raiz = doc && doc.documentElement;
    if (!raiz || raiz.nodeName !== 'DJ_PLAYLISTS') throw new Error('Este archivo no es un XML de rekordbox (falta DJ_PLAYLISTS).');
    const col = hijos(raiz, 'COLLECTION')[0], pls = hijos(raiz, 'PLAYLISTS')[0];
    if (!col || !pls) throw new Error('Al XML de rekordbox le falta la colección o las playlists.');
    const prod = hijos(raiz, 'PRODUCT')[0];
    const pistas = new Map(), porLoc = new Map();
    const ign = { soundcloud: 0, sampler: 0 };
    for (const t of hijos(col, 'TRACK')) {
      const loc = t.getAttribute('Location') || '';
      const id = t.getAttribute('TrackID') || '';
      let motivo = null;
      if (loc.indexOf('soundcloud:tracks') >= 0) motivo = 'soundcloud';
      else if (loc.indexOf('/Sampler/') >= 0) motivo = 'sampler';
      if (motivo) ign[motivo]++;
      pistas.set(id, {
        id, name: t.getAttribute('Name') || '', artist: t.getAttribute('Artist') || '',
        kind: t.getAttribute('Kind') || '', dur: parseInt(t.getAttribute('TotalTime'), 10) || 0,
        remixer: t.getAttribute('Remixer') || '', ign: motivo,
      });
      if (loc) porLoc.set(loc, id);
    }
    const playlists = [];
    (function anda(n, ruta) {
      for (const c of hijos(n, 'NODE')) {
        const nombre = (c.getAttribute('Name') || '').trim();
        if (c.getAttribute('Type') === '0') { anda(c, ruta.concat(nombre)); continue; }
        const porRuta = c.getAttribute('KeyType') === '1';
        const ids = [];
        let faltan = 0;
        for (const k of hijos(c, 'TRACK')) {
          const key = k.getAttribute('Key') || '';
          const id = porRuta ? porLoc.get(key) : key;
          if (id && pistas.has(id)) ids.push(id); else faltan++;
        }
        const carpetas = ruta.filter(x => x !== 'ROOT');
        let grupo = null;
        if (carpetas.some(x => /^old gems$/i.test(x))) grupo = 'OG';
        else if (carpetas.some(x => /^new school\b/i.test(x))) grupo = 'NS';
        playlists.push({ nombre, carpetas, grupo, clave: grupo ? grupo + '/' + nombre : null, ids, faltan });
      }
    })(pls, []);
    return {
      producto: prod ? (prod.getAttribute('Name') || '') + ' ' + (prod.getAttribute('Version') || '') : '',
      entradas: pistas.size, ignoradas: ign, pistas, playlists,
      delMapa: playlists.filter(p => p.grupo),
    };
  }

  // ---------- mapa rekordbox → Spotify ----------
  const pegado = s => norm(s).replace(/ /g, '');
  function nombreDestino(pl) { return (pl.grupo === 'OG' ? 'OG - ' : 'NS - ') + pl.nombre; }
  /* Propone la pareja de cada playlist de rekordbox por su nombre («NS - …» / «OG - …»).
     plsSp: [{id, nombre, propia}]. Devuelve clave → {id, nombre} | null y las ambiguas. */
  function propMapa(plsRb, plsSp) {
    const idx = new Map();
    for (const p of plsSp) {
      const k = pegado(p.nombre);
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(p);
    }
    const mapa = {}, ambiguas = [];
    for (const pl of plsRb) {
      const c = idx.get(pegado(nombreDestino(pl))) || [];
      const propias = c.filter(x => x.propia);
      const el = propias.length === 1 ? propias[0] : null;
      if (!el && c.length > 1) ambiguas.push(pl.clave);
      mapa[pl.clave] = el ? { id: el.id, nombre: el.nombre } : null;
    }
    return { mapa, ambiguas };
  }
  function buscaPorNombre(plsSp, nombre) {
    const c = plsSp.filter(p => p.propia && pegado(p.nombre) === pegado(nombre));
    return c.length === 1 ? c[0] : null;
  }

  // ---------- botón C: sin repartir ----------
  /* o: {likes, soundAll, soundDown, soundTry, repartidas} son listas de {add, t} (t = canción mínima de Spotify);
     desde: 'AAAA-MM-DD'. Devuelve filas ordenadas de más nueva a más vieja. */
  function sinRepartir(o) {
    const ids = new Set(), claves = new Set();
    for (const it of o.repartidas || []) {
      if (!it.t || !it.t.id) continue;
      ids.add(it.t.id);
      claves.add(claveCancion(descSp(it.t)));
    }
    const idsDe = l => new Set((l || []).filter(it => it.t && it.t.id).map(it => it.t.id));
    const down = idsDe(o.soundDown), tr = idsDe(o.soundTry);
    const filas = new Map();
    const mete = (it, origen) => {
      if (!it.t || !it.t.id) return;
      const id = it.t.id;
      if (ids.has(id) || claves.has(claveCancion(descSp(it.t)))) return;
      let f = filas.get(id);
      if (!f) { f = { id, uri: it.t.u, t: it.t, origenes: [], fecha: it.add || '' }; filas.set(id, f); }
      if (!f.origenes.includes(origen)) f.origenes.push(origen);
      if ((it.add || '') > f.fecha) f.fecha = it.add;
    };
    const desde = o.desde ? o.desde + 'T00:00:00Z' : '';
    for (const it of o.likes || []) if (!desde || (it.add || '') >= desde) mete(it, 'Like');
    for (const it of o.soundAll || []) {
      const id = it.t && it.t.id;
      mete(it, down.has(id) ? 'Down' : tr.has(id) ? 'Try' : 'Sound All');
    }
    return Array.from(filas.values()).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  }

  return {
    MATCHER, norm, parecido, mmss, parseTitulo, descRb, descSp, minSp, claveCancion, puntua, elige, yaEsta,
    consultas, consultaExtended, leeRekordbox, nombreDestino, propMapa, buscaPorNombre, sinRepartir,
  };
});
