/* SynchroSound — núcleo.
   Normalización de textos, lector del XML de rekordbox, buscador de coincidencias y la puerta de escritura.
   Son funciones puras: aquí no hay red ni se toca Spotify, Dropbox ni el navegador. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Súbelo cuando cambien las reglas del buscador: invalida lo emparejado con reglas viejas.
  const MATCHER = 5;

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
      soloEdit: t.length === 1 && t[0] === 'edit', // «(Edit)» a secas: no dice de quién
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
      ver: { who: '', crudoWho: '', largo: null, sabores: '', esRemix: false, soloEdit: false, remaster: false },
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
        if (c.soloEdit) o.ver.soloEdit = true;
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
  function cobertura(mios, cand, letras) {
    if (!mios.length) return 0;
    const cub = mios.map(t => {
      if (cand.set.has(t)) return true;
      if (t.length < 4) return false;
      for (const c of cand.lista) {
        if (c.length > t.length && c.includes(t) && t.length >= 0.6 * c.length) return true;
        if (t.length >= 5 && Math.abs(c.length - t.length) <= 1 && lev(c, t) <= 1) {
          if (letras) letras.push([t, c]); // p. ej. un artista que cambió una letra de su nombre
          return true;
        }
      }
      return false;
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
    // Un título es el principio o el final del otro («Calma» y «Calma, tómatelo con calma»).
    const ta = toks(a.base), tb = toks(b.base);
    const corto = ta.length <= tb.length ? ta : tb, largo = ta.length <= tb.length ? tb : ta;
    const c = corto.join(' ');
    if (c.length >= 3 && corto.length < largo.length &&
        (largo.slice(0, corto.length).join(' ') === c || largo.slice(-corto.length).join(' ') === c)) {
      return { nivel: 'contiene', sim: Math.max(s, c.length / largo.join(' ').length) };
    }
    return { nivel: 'no', sim: s };
  }

  function evalArtista(rb, sp) {
    if (!rb.art.length) return { nivel: 'sin', cov: 0, prim: 0 };
    const cand = conj(sp.art.concat(toks(sp.tit.ver.who), toks(sp.tit.feats)));
    const letras = [];
    const cov = cobertura(rb.art, cand, letras);
    const mio = conj(rb.art.concat(toks(rb.tit.ver.who), toks(rb.tit.feats)));
    const prim = cobertura(sp.prim, mio);
    if (cov >= 0.85 || (prim >= 0.85 && cov >= 0.5)) return { nivel: 'fuerte', cov, prim, letras };
    if (cov >= 0.5 || prim >= 0.85) return { nivel: 'parcial', cov, prim };
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
    if (a.who && !b.who) {
      // El remix o edit que nombra rekordbox no sale en el título de Spotify.
      if (mismoQuien(rb.art.join(' '), a.who)) return { ok: false, motivo: 'falta-remix' };       // es del propio artista: se pregunta
      if (cobertura(toks(a.who), conj(sp.art)) >= 0.85) return { ok: false, motivo: 'remix-en-artistas' }; // figura como artista: se pregunta
      return { ok: false, motivo: 'falta-remix', descarta: true };                                  // es de otra persona y solo está la original: no vale
    }
    if (!a.who && b.who) {
      // «Título Remix» sin decir de quién: solo se da por bueno si el remixer que nombra Spotify
      // es el artista que figura en rekordbox. Que coincida el artista original no basta.
      if (a.esRemix) return mismoQuien(rb.art.join(' '), b.who) ? Object.assign(largo(), { porArtista: true }) : { ok: false, motivo: 'remix-sin-nombre' };
      return { ok: false, motivo: 'es-remix' };
    }
    if (a.esRemix !== b.esRemix) return { ok: false, motivo: a.esRemix ? 'falta-remix' : 'es-remix' };
    return largo();
  }

  const MARGEN_DUR = 3; // segundos de diferencia con los que dos duraciones cuentan como la misma
  const NOM_LARGO = { ext: 'Extended', orig: 'Original', radio: 'Radio Edit' };
  const letrasTxt = A => A.letras.map(x => x[0] + ' / ' + x[1]).join(', ');
  const palabraVer = rb => (rb.tit.ver.esRemix ? 'Remix' : 'Edit');
  function notaDe(rb, sp, dd, A, amb) {
    const p = [];
    if (A && A.letras && A.letras.length) p.push('Artista con una letra distinta (' + letrasTxt(A) + ')');
    if (amb && amb.sinNombre) p.push('Tu título dice «' + palabraVer(rb) + '» sin decir de quién; la duración coincide');
    const la = rb.tit.ver.largo, lb = sp.tit.ver.largo;
    if (la === 'ext' && lb !== 'ext') { if (dd > 10) p.push('Sin Extended en Spotify: se usa la ' + (lb === 'radio' ? 'Radio Edit' : 'Original')); }
    else if (la && lb && la !== lb) p.push('En Spotify es la ' + NOM_LARGO[lb]);
    else if (!la && lb === 'radio') p.push('En Spotify es la Radio Edit');
    else if (!la && lb === 'ext') p.push('En Spotify es la Extended');
    if (rb.dur && sp.dur && dd > 20) p.push('dura ' + mmss(sp.dur) + ' en Spotify y ' + mmss(rb.dur) + ' en rekordbox');
    return p.join('; ');
  }
  function motivosDe(rb, sp, T, A, V, amb) {
    const m = [];
    if (amb) {
      // Texto ambiguo y la duración no lo confirma: se pregunta.
      if (amb.sinNombre) m.push('tu título dice «' + palabraVer(rb) + '» sin decir de quién');
      if (amb.letras) m.push('el artista se escribe con una letra distinta (' + letrasTxt(A) + ')');
      m.push(rb.dur && sp.dur ? 'dura ' + mmss(sp.dur) + ' en Spotify y ' + mmss(rb.dur) + ' en rekordbox' : 'no se puede comparar la duración');
    }
    if (T.nivel === 'fuzzy') m.push('el título no es idéntico');
    if (T.nivel === 'contiene') m.push('un título contiene al otro');
    if (T.nivel === 'extras') m.push('el paréntesis del título es distinto');
    if (A.nivel === 'parcial') m.push('solo coincide parte de los artistas');
    if (A.nivel === 'sin') m.push('en rekordbox no tiene artista');
    if (A.nivel === 'pista') m.push('el artista solo sale en tu anotación del título');
    if (!V.ok) {
      if (V.motivo === 'sabor') m.push('es otra versión (' + (sp.tit.ver.sabores || rb.tit.ver.sabores) + ')');
      else if (V.motivo === 'falta-remix') m.push('en Spotify está la original, no ' + (rb.tit.ver.who ? 'la de ' + (rb.tit.ver.crudoWho || rb.tit.ver.who) : 'el remix'));
      else if (V.motivo === 'remix-en-artistas') m.push('en Spotify el título no dice que sea esa versión, pero ' + (rb.tit.ver.crudoWho || rb.tit.ver.who) + ' figura como artista');
      else if (V.motivo === 'es-remix') m.push('en Spotify es un remix' + (sp.tit.ver.who ? ' (' + (sp.tit.ver.crudoWho || sp.tit.ver.who) + ')' : ''));
      else if (V.motivo === 'remix-sin-nombre') m.push('tu título dice «Remix» sin decir de quién, y en Spotify es la mezcla «' + (sp.tit.ver.crudoWho || sp.tit.ver.who) + '»');
    }
    return m;
  }

  /* Compara una canción de rekordbox con una de Spotify.
     clase: 'seguro' (se puede añadir sola), 'dudosa' (se pregunta) o 'no'. */
  const pega = s => String(s || '').replace(/ /g, '');
  // ¿El título de rekordbox es el artista de Spotify y el artista de rekordbox es el título de Spotify?
  function cambiados(rb, sp) {
    const rbTit = pega(rb.tit.full), rbArt = pega(norm(sinPais(rb.artista))), spTit = pega(sp.tit.full);
    if (rbTit.length < 4 || rbArt.length < 4 || spTit.length < 4) return false;
    if (parecido(rbArt, spTit) < 0.9) return false;
    return (sp.m.a || []).some(a => { const x = pega(norm(sinPais(a))); return x.length >= 4 && parecido(rbTit, x) >= 0.9; });
  }
  function puntua(rb, sp) {
    const T = evalTitulo(rb.tit, sp.tit);
    if (T.nivel === 'no') {
      if (!cambiados(rb, sp)) return { clase: 'no', p: 0 };
      const dd0 = (rb.dur && sp.dur) ? Math.abs(rb.dur - sp.dur) : 30;
      // Es un texto ambiguo más: se da por segura solo si además coincide la duración.
      const igual = !!(rb.dur && sp.dur) && dd0 <= MARGEN_DUR;
      return {
        clase: igual ? 'seguro' : 'dudosa', p: 70 - Math.min(20, dd0 / 6), dd: dd0, titulo: 'cambiado', artista: 'cambiado', version: 'ok',
        nota: igual ? 'Artista y título cambiados de sitio; la duración coincide' : '',
        motivos: igual ? [] : ['el artista y el título están cambiados de sitio', rb.dur && sp.dur ? 'dura ' + mmss(sp.dur) + ' en Spotify y ' + mmss(rb.dur) + ' en rekordbox' : 'no se puede comparar la duración'],
        otraVersion: false, riesgo: igual ? 2 : 0,
      };
    }
    const A = evalArtista(rb, sp);
    if (A.nivel === 'no') return { clase: 'no', p: 0 };
    const V = evalVersion(rb, sp);
    if (V.descarta) return { clase: 'no', p: 0 };
    // Sin artista y además sin el remix que se busca: solo coincide el título, no vale ni para preguntar.
    if (A.nivel === 'sin' && !V.ok) return { clase: 'no', p: 0 };
    if (T.nivel === 'contiene' && A.nivel !== 'fuerte') return { clase: 'no', p: 0 };
    let p = 100;
    if (T.nivel === 'base') p -= 3;
    else if (T.nivel === 'extras') p -= 15;
    else if (T.nivel === 'contiene') p -= 25;
    else if (T.nivel === 'fuzzy') p -= 12 + (1 - T.sim) * 80;
    p -= { fuerte: 0, parcial: 22, sin: 28, pista: 34 }[A.nivel];
    if (A.nivel === 'fuerte') p -= (1 - Math.min(1, A.cov)) * 6;
    p -= V.ok ? V.pen : 30;
    const dd = (rb.dur && sp.dur) ? Math.abs(rb.dur - sp.dur) : 30;
    p -= Math.min(20, dd / 6);
    const porTexto = (T.nivel === 'exact' || T.nivel === 'base') && A.nivel === 'fuerte' && V.ok;
    /* Texto ambiguo: el título no dice de quién es el remix o el edit, o el artista se escribe con una letra
       distinta. Ahí el texto solo no basta: se da por segura únicamente si además coincide la duración. */
    const va = rb.tit.ver;
    const amb = {
      sinNombre: !va.who && (va.esRemix || va.soloEdit) && !V.porArtista,
      letras: !!(A.letras && A.letras.length),
    };
    const ambigua = porTexto && (amb.sinNombre || amb.letras);
    const durIgual = !!(rb.dur && sp.dur) && Math.abs(rb.dur - sp.dur) <= MARGEN_DUR;
    const seguro = porTexto && (!ambigua || durIgual);
    const duda = ambigua && !seguro ? amb : null;
    const nota = seguro ? notaDe(rb, sp, dd, A, ambigua ? amb : null) : '';
    // Para ordenar las seguras al repasarlas: 3 = en Spotify dura más que el archivo (lo menos habitual),
    // 2 = texto ambiguo confirmado por la duración, 1 = cualquier otro aviso, 0 = sin aviso.
    const masLarga = !!(rb.dur && sp.dur) && sp.dur - rb.dur > 20;
    return {
      clase: seguro ? 'seguro' : 'dudosa', p, dd, titulo: T.nivel,
      artista: duda && amb.letras ? 'letra' : A.nivel,
      version: V.ok ? (duda && amb.sinNombre ? 'sin-nombre' : 'ok') : V.motivo,
      nota, motivos: seguro ? [] : motivosDe(rb, sp, T, A, V, duda),
      otraVersion: seguro && dd > 20,
      riesgo: seguro ? (masLarga ? 3 : ambigua ? 2 : nota ? 1 : 0) : 0,
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
    // La misma canción publicada en varios discos se enseña una sola vez.
    const dudosas = [], yaVista = new Set();
    if (!seguro) for (const e of ev) {
      const k = aspecto(e.sp);
      if (yaVista.has(k)) continue;
      yaVista.add(k);
      dudosas.push(e); // todas: quien decide las ve de una vez
    }
    return { seguro, dudosas };
  }
  // Dos entradas de Spotify con el mismo nombre, artistas y duración se ven iguales.
  function aspecto(sp) { return norm(sp.m.n) + '|' + norm((sp.m.a || []).join(',')) + '|' + (sp.dur || 0); }
  // Para el diagnóstico: por qué una candidata no ha valido, y las más parecidas de una lista.
  function explica(rb, sp) {
    const T = evalTitulo(rb.tit, sp.tit), A = evalArtista(rb, sp), V = evalVersion(rb, sp);
    if (T.nivel === 'no' && cambiados(rb, sp)) return { titulo: 'cambiado', sim: 1, artista: 'cambiado', cov: 1, version: 'ok' };
    return { titulo: T.nivel, sim: T.sim || 0, artista: A.nivel, cov: A.cov || 0, version: V.ok ? 'ok' : V.motivo };
  }
  function cercanas(rb, cands, n) {
    return cands.map(sp => { const e = explica(rb, sp); return { sp, e, k: e.sim * 2 + e.cov }; })
      .sort((x, y) => y.k - x.k).slice(0, n || 2);
  }
  // ¿Está ya esta canción (u otra versión de la misma) en una lista de canciones de Spotify?
  function yaEsta(rb, lista, rechazadas) {
    let mejor = null;
    for (const sp of lista) {
      if (rechazadas && rechazadas.has(sp.uri)) continue; // «No es»: que esté en la playlist no cuenta
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

  // ---------------- la puerta de escritura (fase 2) ----------------
  /* Decide, sin red y sin estado propio, si una escritura puede salir hacia Spotify. Está aquí, como función pura,
     para poder probarla caso a caso (test/nucleo.js). En app.js, spotify() no envía ninguna escritura que no
     salga de puerta(): la ruta y las canciones que se envían son las que esta devuelve. */
  const PREFIJO_DESTINO = /^(NS|OG) - \S/;   // el nombre tiene que empezar exactamente por «NS - » u «OG - »
  const URI_CANCION = /^spotify:track:[A-Za-z0-9]{22}$/;
  const MAX_LOTE = 100;                      // canciones por petición: el máximo que admite Spotify
  const FRESCA_ESCR = 15000;                 // la playlist tiene que haberse releído de Spotify hace menos de esto (ms)
  /* ¿Se puede escribir en esa playlist? pl = la playlist tal como se leyó de Spotify ({nombre, propia}) o null;
     enMapa = cuántas playlists de rekordbox la tienen de pareja. Devuelve por qué no, o '' si se puede. */
  function destinoMal(pl, enMapa) {
    if (!pl) return 'esa playlist no está en lo leído de tu Spotify';
    if (pl.propia !== true) return 'la playlist «' + pl.nombre + '» no es tuya';
    if (typeof pl.nombre !== 'string' || !PREFIJO_DESTINO.test(pl.nombre)) return 'el nombre de «' + pl.nombre + '» no empieza por «NS - » ni por «OG - »';
    if (enMapa !== 1) return enMapa > 1 ? 'hay ' + enMapa + ' playlists de rekordbox que apuntan a «' + pl.nombre + '»' : '«' + pl.nombre + '» no está en el mapa';
    return '';
  }
  /* x = { metodo, ruta, cuerpo, pase, permiso, ahora, concedido, destino }:
       pase      = el lote que se quiere enviar: {id, uris}. Vale para una llamada;
       permiso   = lo confirmado por el usuario: {hasta, copia, pls: Map(id → Set(uris que aún pueden salir)), lotes};
       leida     = cuándo se releyó de Spotify esa playlist por última vez (ms); ahora = la hora (ms);
       concedido = true si Spotify ha concedido los dos permisos de escritura;
       destino   = función(id) → por qué no se puede escribir en esa playlist, o '' (destinoMal con los datos de la app).
     Solo sale POST /playlists/{id}/items, sin parámetros, a una playlist válida y confirmada, con entre 1 y 100
     canciones sin repetir, todas confirmadas para esa playlist y ninguna enviada ya, y con la copia guardada. */
  function porQueNoSale(x) {
    const p = x.pase, per = x.permiso;
    if (x.metodo !== 'POST') return 'solo se permite añadir (POST)';
    if (!p || typeof p.id !== 'string') return 'falta la confirmación del usuario';
    if (x.concedido !== true) return 'Spotify no ha concedido el permiso de escritura';
    const m = /^\/playlists\/([A-Za-z0-9]{22})\/items$/.exec(String(x.ruta));
    if (!m || m[1] !== p.id) return 'no es la llamada confirmada';
    const mal = typeof x.destino === 'function' ? x.destino(p.id) : null;
    if (mal !== '') return String(mal || 'no se ha podido comprobar la playlist de destino');
    if (!per || !(x.ahora < per.hasta)) return 'no hay ninguna sincronización confirmada en curso';
    if (!per.copia) return 'no hay copia guardada antes de escribir';
    if (!(x.leida <= x.ahora && x.ahora - x.leida < FRESCA_ESCR)) return 'la playlist no se ha releído de Spotify justo antes de escribir';
    const quedan = per.pls instanceof Map ? per.pls.get(p.id) : null;
    if (!(quedan instanceof Set)) return 'esa playlist no está entre las confirmadas';
    if (!(per.lotes >= 1)) return 'ya han salido todos los lotes confirmados';
    const us = p.uris;
    if (!Array.isArray(us) || us.length < 1 || us.length > MAX_LOTE) return 'el lote no tiene entre 1 y ' + MAX_LOTE + ' canciones';
    if (new Set(us).size !== us.length) return 'el lote repite canciones';
    if (!us.every(u => typeof u === 'string' && URI_CANCION.test(u) && quedan.has(u))) return 'el lote lleva algo que no está confirmado para esa playlist o que ya se envió';
    const c = x.cuerpo;
    if (!c || typeof c !== 'object' || Object.keys(c).length !== 1 || !Array.isArray(c.uris) || c.uris.length !== us.length ||
        !c.uris.every((u, i) => u === us[i])) return 'el cuerpo no es exactamente el lote confirmado';
    return '';
  }
  /* Devuelve {no: 'por qué no sale'} o {ruta, uris}: lo que hay que enviar, tal cual. AL APROBAR, GASTA: tacha del
     permiso las canciones del lote y descuenta un lote. Así la misma llamada, repetida, ya no sale: una canción
     no puede ir dos veces a la misma playlist dentro de una sincronización, llegue o no la primera. */
  function puerta(x) {
    const no = porQueNoSale(x);
    if (no) return { no };
    const quedan = x.permiso.pls.get(x.pase.id), uris = x.pase.uris.slice();
    uris.forEach(u => quedan.delete(u));
    x.permiso.lotes--;
    return { ruta: '/playlists/' + x.pase.id + '/items', uris };
  }

  return {
    PREFIJO_DESTINO, URI_CANCION, MAX_LOTE, FRESCA_ESCR, destinoMal, puerta,
    MATCHER, norm, parecido, mmss, parseTitulo, descRb, descSp, minSp, claveCancion, puntua, elige, yaEsta, explica, cercanas, aspecto,
    consultas, consultaExtended, leeRekordbox, nombreDestino, propMapa, buscaPorNombre, sinRepartir,
  };
});
