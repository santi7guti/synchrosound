/* Pruebas del núcleo (buscador de coincidencias). Uso: node test/nucleo.js */
'use strict';
const C = require('../core.js');
const D = require('./datos.js');

let ok = 0, mal = 0;
function es(cond, texto) { if (cond) ok++; else { mal++; console.log('  FALLA: ' + texto); } }
const sp = t => C.descSp(C.minSp(t));
const rb = t => C.descRb(t);
const todo = D.catalogo.map(sp);
const clavePorId = {};
Object.keys(D.cat).forEach(k => { clavePorId[D.cat[k].id] = k; });

// --- normalización ---
es(C.norm('Canción Élégante') === 'cancion elegante', 'acentos');
es(C.norm('Søren') === 'soren', 'ø');
es(C.norm('A.B.C.D.') === 'abcd', 'puntos');
es(C.norm("I'm Here’s") === 'im heres', 'apóstrofos');
es(C.norm('K雨L  -  Ladrillo!') === 'k雨l ladrillo', 'caracteres no latinos y espacios');
es(C.norm('Sal & Pimienta') === 'sal pimienta', '&');

// --- títulos ---
let t = C.parseTitulo('Baila (Zeta Extended Remix) (feat. Teo Lang)');
es(t.base === 'baila' && t.ver.who === 'zeta' && t.ver.largo === 'ext' && t.ver.esRemix && t.feats === 'teo lang', 'paréntesis encadenados');
t = C.parseTitulo('Need Your Signal (OJO BPM)');
es(t.base === 'need your signal' && t.extras[0] === 'ojo bpm' && !t.ver.who, 'anotación en paréntesis');
t = C.parseTitulo('Perdón | Marisol');
es(t.base === 'perdon' && t.pista === 'marisol', 'anotación con barra');
t = C.parseTitulo('Cobalt Avenue - Extended Mix');
es(t.base === 'cobalt avenue' && t.ver.largo === 'ext' && !t.ver.who && !t.ver.esRemix, 'guion de Spotify');
t = C.parseTitulo('Lluvia Fina (Club Marfil Remix)');
es(t.ver.who === 'club marfil', 'remixer con palabra genérica en el nombre');
t = C.parseTitulo('Foco (Club Mix)');
es(t.ver.who === '' && !t.ver.esRemix, 'Club Mix no es de nadie');
t = C.parseTitulo('Toda La Noche Remix');
es(t.base === 'toda la noche' && t.ver.esRemix && !t.ver.who, 'Remix sin paréntesis');
t = C.parseTitulo('Dama (Óyeme Esta Noche)');
es(t.base === 'dama' && t.extras[0] === 'oyeme esta noche', 'paréntesis que es parte del título');
t = C.parseTitulo('Crucero Lunar (Remastered 2022)');
es(t.base === 'crucero lunar' && t.ver.remaster && !t.extras.length, 'remaster');
t = C.parseTitulo('Pánico (1993)');
es(t.base === 'panico' && !t.extras.length, 'año entre paréntesis');
t = C.parseTitulo('Deep Current - Instrumental');
es(t.ver.sabores === 'instrumental', 'instrumental');
t = C.parseTitulo('Ladrillo! (Edit)');
es(t.ver.largo === 'radio' && !t.ver.esRemix, 'Edit a secas');

// --- comparación uno a uno ---
const P = (a, b) => C.puntua(rb(a), sp(b));
es(P(D.R.glass, D.cat.glass).clase === 'seguro', 'idéntica');
es(P(D.R.paper, D.cat.paper).clase === 'seguro' && /Sin Extended/.test(P(D.R.paper, D.cat.paper).nota), 'sin Extended vale la Original y se anota');
es(P(D.R.cobalt, D.cat.cobaltRadio).clase === 'seguro' && /Radio Edit/.test(P(D.R.cobalt, D.cat.cobaltRadio).nota), 'sin Extended vale la Radio Edit y se anota');
es(P(D.R.velvet, D.cat.velvetOtro).clase === 'no', 'remix de otra persona no vale');
es(P(D.R.openWater, D.cat.openWater).clase === 'dudosa', 'original en vez de remix es dudosa');
es(P(D.R.glass, D.cat.velvetRmx).clase === 'no', 'otra canción');
es(P(D.R.errata, D.cat.conErrata).clase === 'dudosa', 'título con errata es dudosa');
es(P(D.R.cumbia, D.cat.cumbia).clase === 'dudosa', 'sin artista es dudosa');
es(P(D.R.sunrise, D.cat.sunriseOtro).clase === 'no', 'mismo título de otro artista no vale');
es(P(D.R.current, D.cat.currentInst).clase === 'dudosa', 'instrumental en vez de original es dudosa');
es(P(D.R.extra, D.cat.xtra).clase === 'dudosa' && P(D.R.extra, D.cat.extra).clase === 'seguro', 'títulos casi iguales no se confunden');
es(P(D.R.wait, D.cat.wait).clase === 'seguro' && /Artista con una letra distinta \(martan \/ marten\)/.test(P(D.R.wait, D.cat.wait).nota), 'una letra cambiada en el artista: segura y con nota');
es(!/letra distinta/.test(P(D.R.glass, D.cat.glass).nota), 'sin letra cambiada no hay nota');
es(P(D.R.besos, D.cat.besosOtro).clase === 'no', 'sin artista y sin el remix buscado: ni se pregunta');
es(P(D.R.alto, D.cat.altoOtro).clase === 'no', 'un artista que solo se parece en una palabra no vale ni como dudosa');
es(P(D.R.calma, D.cat.calmaLarga).clase === 'dudosa' && /contiene/.test(P(D.R.calma, D.cat.calmaLarga).motivos.join()), 'un título que contiene al otro es dudosa');
es(P({ name: 'Calma', artist: 'Otra Persona', dur: 360 }, D.cat.calmaLarga).clase === 'no', 'título contenido de otro artista no vale');
es(P({ name: 'U', artist: 'Mila Ros', dur: 200 }, { id: 'x', name: 'U Got It', artists: [{ name: 'Mila Ros' }], duration_ms: 200000 }).clase === 'no', 'un título de una letra no cuenta como contenido');
es(P({ name: 'Calma, Tómatelo Con Calma', artist: 'Mila Ros', dur: 220 }, { id: 'x', name: 'Calma', artists: [{ name: 'Mila Ros' }], duration_ms: 200000 }).clase === 'dudosa', 'título contenido, en el otro sentido');
es(P(D.R.moveOn, D.cat.moveOn).clase === 'seguro', 'país entre paréntesis en el artista');
es(P(D.R.tondo, D.cat.tondo).clase === 'seguro', 'espacios dobles y &');
es(P(D.R.ladrillo, D.cat.ladrillo).clase === 'seguro', 'caracteres no latinos');
es(P({ name: 'Dama', artist: 'Modelo Uno', dur: 221 }, D.cat.lady).clase === 'seguro', 'paréntesis solo en Spotify');
es(P({ name: 'Dama Óyeme Esta Noche', artist: 'Modelo Uno', dur: 221 }, D.cat.lady).clase === 'seguro', 'paréntesis frente a sin paréntesis');
es(P({ name: 'Glass Harbor', artist: 'Nora Vex & Otro Más', dur: 372 }, D.cat.glass).clase === 'seguro', 'un artista de más en rekordbox');
es(P({ name: 'Glass Harbor', artist: 'Uno, Dos, Tres & Nora Vex', dur: 372 }, D.cat.glass).clase === 'dudosa', 'solo coincide un artista de cuatro');
es(P({ name: 'Glass Harbor', artist: 'DosMitades', dur: 300 }, { id: 'x', name: 'Glass Harbor', artists: [{ name: 'Dos Mitades' }], duration_ms: 300000 }).clase === 'seguro', 'nombre pegado frente a separado');
es(P({ name: 'Baja Ya', artist: 'K-lumen', dur: 300 }, { id: 'x', name: 'Baja Ya', artists: [{ name: 'Klumen' }], duration_ms: 300000 }).clase === 'seguro', 'guion en el artista');
es(P({ name: 'Glass Harbor', artist: 'Nora Vex', dur: 372 }, { id: 'x', name: 'Glass Harbor - Mixed', artists: [{ name: 'Nora Vex' }], duration_ms: 200000 }).clase === 'dudosa', 'versión de sesión mezclada es dudosa');
es(P({ name: 'Veneno Remix', artist: 'DJ Fulano', dur: 280 }, { id: 'x', name: 'Veneno - DJ Fulano Remix', artists: [{ name: 'Grupo Original' }], duration_ms: 281000 }).clase === 'seguro', 'remix sin nombre cuyo autor es el artista');
es(P({ name: 'Veneno Remix', artist: 'DJ Fulano', dur: 280 }, { id: 'x', name: 'Veneno', artists: [{ name: 'DJ Fulano' }], duration_ms: 281000 }).clase === 'dudosa', 'remix sin nombre frente a original');

// --- elección entre todo el catálogo ---
const elegida = k => C.elige(rb(D.R[k]), todo, {});
for (const k of Object.keys(D.esperado.add)) {
  const e = elegida(k);
  es(e.seguro && clavePorId[e.seguro.sp.id] === D.esperado.add[k], 'elige ' + D.esperado.add[k] + ' para ' + k + ' (salió ' + (e.seguro ? clavePorId[e.seguro.sp.id] : 'ninguna') + ')');
}
for (const k of Object.keys(D.esperado.duda)) {
  const e = elegida(k);
  es(!e.seguro && e.dudosas.length && clavePorId[e.dudosas[0].sp.id] === D.esperado.duda[k], 'dudosa ' + D.esperado.duda[k] + ' para ' + k);
  es(e.dudosas.every(d => d.r.motivos.length > 0), 'la dudosa de ' + k + ' explica por qué');
}
for (const k of D.esperado.no) {
  const e = elegida(k);
  es(!e.seguro && !e.dudosas.length, 'no encuentra nada para ' + k);
}
// lo más parecido a una que no está (para el diagnóstico)
let cer = C.cercanas(rb(D.R.besos), todo, 2);
es(cer.length === 2 && cer[0].sp.id === D.cat.besosOtro.id && cer[0].e.titulo === 'exact' && cer[0].e.artista === 'sin', 'cercanas dice qué es lo más parecido y por qué no valió');
// con la Extended a la vista, se elige la Extended aunque rekordbox no lo diga
es(C.elige(rb(D.R.larga), [sp(D.cat.largaCorta)], {}).seguro.sp.id === D.cat.largaCorta.id, 'sin la Extended se queda con la corta');
// «No es» descarta esa candidata
let e = C.elige(rb(D.R.errata), todo, { rechazadas: new Set([D.cat.conErrata.uri]) });
es(!e.seguro && !e.dudosas.length, 'una candidata rechazada no vuelve a salir');
// otra versión en la playlist cuenta como «ya está»
let y = C.yaEsta(rb(D.R.silence), [sp(D.cat.tondo), sp(D.cat.silenceRadio)]);
es(y && y.sp.id === D.cat.silenceRadio.id && y.r.otraVersion, 'otra versión en la playlist cuenta como ya está');
es(!C.yaEsta(rb(D.R.velvet), [sp(D.cat.velvetOtro)]), 'un remix de otra persona no cuenta como ya está');
es(!C.yaEsta(rb(D.R.openWater), [sp(D.cat.openWater)]), 'la original no cuenta como ya está el remix');

// --- búsquedas ---
let q = C.consultas(rb(D.R.signal));
es(q.length <= 3 && q.every(x => !/OJO/.test(x)), 'las anotaciones en mayúsculas no se buscan');
q = C.consultas(rb(D.R.cumbia));
es(q.length >= 1 && q[0] === 'Cumbia del Túnel', 'sin artista busca por título');
q = C.consultas(rb(D.R.velvet));
es(q[0] === 'Velvet Engine Mira Sol Dario Kent', 'búsqueda con remixer');
es(C.consultas(rb({ name: 'Algo (Remix)', artist: 'A, B & C x D', dur: 1 })).length <= 3, 'como mucho tres búsquedas');

// --- mapa ---
const plsRb = [{ grupo: 'NS', nombre: 'Raw/UK Garage', clave: 'NS/Raw/UK Garage' }, { grupo: 'OG', nombre: 'ALL', clave: 'OG/ALL' }, { grupo: 'NS', nombre: 'Chill', clave: 'NS/Chill' }, { grupo: 'NS', nombre: 'Doble', clave: 'NS/Doble' }];
const plsSp = [{ id: '1', nombre: 'NS - Raw / UK Garage', propia: true }, { id: '2', nombre: 'OG - All', propia: true }, { id: '3', nombre: 'Chill', propia: true },
  { id: '4', nombre: 'NS - Doble', propia: true }, { id: '5', nombre: 'NS - Doble', propia: true }, { id: '6', nombre: 'OG - ALL', propia: false }];
const m = C.propMapa(plsRb, plsSp);
es(m.mapa['NS/Raw/UK Garage'] && m.mapa['NS/Raw/UK Garage'].id === '1', 'empareja aunque cambien espacios y mayúsculas');
es(m.mapa['OG/ALL'] && m.mapa['OG/ALL'].id === '2', 'ALL con OG - All, y prefiere la propia');
es(m.mapa['NS/Chill'] === null, 'sin prefijo no hay pareja');
es(m.mapa['NS/Doble'] === null && m.ambiguas.indexOf('NS/Doble') >= 0, 'dos con el mismo nombre: no elige sola');

// --- sin repartir ---
const it = (t, add) => ({ add: add || '2026-10-01T00:00:00Z', t: C.minSp(t) });
const filas = C.sinRepartir({
  likes: [it(D.cat.like1, '2026-10-20T09:00:00Z'), it(D.cat.glass), it(D.cat.likeViejo, '2026-08-01T09:00:00Z'), it(D.cat.tondoOtra), it(D.cat.s2, '2026-10-17T09:00:00Z')],
  soundAll: [it(D.cat.s1), it(D.cat.s2), it(D.cat.s3)], soundDown: [it(D.cat.s1)], soundTry: [it(D.cat.s2)],
  repartidas: [it(D.cat.glass), it(D.cat.s3), it(D.cat.tondo)], desde: '2026-09-01',
});
const nombres = filas.map(f => clavePorId[f.id]);
es(nombres.length === 3 && nombres.indexOf('like1') >= 0 && nombres.indexOf('s1') >= 0 && nombres.indexOf('s2') >= 0, 'sin repartir: solo las que tocan (' + nombres.join(',') + ')');
es(filas.find(f => clavePorId[f.id] === 's2').origenes.join('+') === 'Like+Try', 'una canción puede venir de like y de Try');
es(filas.find(f => clavePorId[f.id] === 's1').origenes.join('+') === 'Down', 'origen Down');
es(nombres[0] === 'like1', 'las más nuevas primero');

console.log('Núcleo: ' + ok + ' comprobaciones bien, ' + mal + ' mal.');
process.exit(mal ? 1 : 0);
