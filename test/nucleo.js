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
let rv;
es(P(D.R.glass, D.cat.glass).clase === 'seguro', 'idéntica');
es(P(D.R.paper, D.cat.paper).clase === 'seguro' && /Sin Extended/.test(P(D.R.paper, D.cat.paper).nota), 'sin Extended vale la Original y se anota');
es(P(D.R.cobalt, D.cat.cobaltRadio).clase === 'seguro' && /Radio Edit/.test(P(D.R.cobalt, D.cat.cobaltRadio).nota), 'sin Extended vale la Radio Edit y se anota');
es(P(D.R.velvet, D.cat.velvetOtro).clase === 'no', 'remix de otra persona no vale');
es(P(D.R.openWater, D.cat.openWater).clase === 'no', 'el remix es de otra persona y en Spotify solo está la original: ni se pregunta');
es(P({ name: 'Robot Lento (DJ Nadie TOOL)', artist: 'DJ Nadie', dur: 245 }, { id: 'x', name: 'Robot Lento', artists: [{ name: 'DJ Nadie' }], duration_ms: 240000 }).clase === 'dudosa', 'si el remix es del propio artista y solo está la original, se pregunta');
rv = C.puntua(rb(D.R.openWater), sp({ id: 'x', name: 'Open Water', artists: [{ name: 'Mira Sol' }, { name: 'Juno Park' }], duration_ms: 340000 }));
es(rv.clase === 'dudosa' && /Juno Park figura como artista/.test(rv.motivos.join()) && rv.version === 'remix-en-artistas', 'si el remixer figura como artista en Spotify, se pregunta');
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
es(P({ name: 'Veneno Remix', artist: 'Grupo Original, DJ Fulano', dur: 280 }, { id: 'x', name: 'Veneno - DJ Fulano Remix', artists: [{ name: 'Grupo Original' }, { name: 'DJ Fulano' }], duration_ms: 281000 }).clase === 'seguro', 'remix sin nombre cuyo remixer es uno de los artistas');
rv = P(D.R.veneno, D.cat.venenoRB);
es(rv.clase === 'dudosa' && /sin decir de quién/.test(rv.motivos.join()) && /R & B/.test(rv.motivos.join()), 'remix sin nombre frente a una mezcla con nombre del mismo artista: dudosa (' + rv.clase + ')');
rv = P(D.R.cambiada, D.cat.cambiadaSp);
es(rv.clase === 'seguro' && /Artista y título cambiados de sitio; la duración coincide/.test(rv.nota) && rv.riesgo === 2, 'artista y título cambiados de sitio con la misma duración: segura, con nota (' + rv.clase + ')');
rv = P({ name: 'Novia Techno Rara', artist: 'PACO ALTO', dur: 250 }, D.cat.cambiadaSp);
es(rv.clase === 'dudosa' && /cambiados de sitio/.test(rv.motivos.join()) && /dura 5:05 en Spotify y 4:10 en rekordbox/.test(rv.motivos.join()), 'cambiados de sitio con otra duración: dudosa');
es(C.yaEsta(rb(D.R.cambiada), [sp(D.cat.cambiadaSp)]), 'y si esa pareja ya está en la playlist, cuenta como que ya está');
es(P({ name: 'Novia Techno Rara', artist: 'OTRO NOMBRE', dur: 305 }, D.cat.cambiadaSp).clase === 'no', 'si solo coincide una mitad, no es un cambio de sitio');
es(P(D.R.glass, D.cat.cambiadaSp).clase === 'no', 'canciones sin relación siguen sin valer');

// --- texto ambiguo: solo es segura si la duración coincide ---
rv = P(D.R.veneno, D.cat.venenoOtro);
es(rv.clase === 'dudosa' && /«Remix» sin decir de quién/.test(rv.motivos.join()) && /letra distinta \(lunna \/ luna\)/.test(rv.motivos.join()) && /dura 6:02 en Spotify y 4:38 en rekordbox/.test(rv.motivos.join()),
  'dos «Remix» sin nombre con duración distinta: dudosa y dice por qué (' + rv.clase + ': ' + rv.motivos.join('; ') + ')');
es(rv.version === 'sin-nombre' && rv.artista === 'letra', 'y el diagnóstico lo distingue');
rv = P({ name: 'Veneno Remix', artist: 'Grupo Luna', dur: 361 }, D.cat.venenoOtro);
es(rv.clase === 'seguro' && /sin decir de quién; la duración coincide/.test(rv.nota) && rv.riesgo === 2, 'dos «Remix» sin nombre con la misma duración: segura, con nota');
rv = P({ name: 'Veneno Remix', artist: 'Grupo Luna', dur: 365 }, D.cat.venenoOtro);
es(rv.clase === 'seguro', 'tres segundos de diferencia cuentan como la misma duración');
rv = P({ name: 'Veneno Remix', artist: 'Grupo Luna', dur: 366 }, D.cat.venenoOtro);
es(rv.clase === 'dudosa', 'cuatro segundos ya no');
rv = P({ name: 'Veneno Remix', artist: 'Grupo Luna', dur: 0 }, D.cat.venenoOtro);
es(rv.clase === 'dudosa' && /no se puede comparar la duración/.test(rv.motivos.join()), 'sin duración en el archivo no se puede confirmar: dudosa');
rv = P(D.R.marea, D.cat.mareaCorta);
es(rv.clase === 'dudosa' && /letra distinta \(brandt \/ brendt\)/.test(rv.motivos.join()) && /dura 2:56 en Spotify y 6:21/.test(rv.motivos.join()) && rv.artista === 'letra' && rv.version === 'ok',
  'artista con una letra distinta y duración distinta: dudosa (' + rv.clase + ')');
rv = P({ name: 'Veneno Remix', artist: 'DJ Fulano', dur: 280 }, { id: 'x', name: 'Veneno - DJ Fulano Remix', artists: [{ name: 'Grupo Original' }], duration_ms: 200000 });
es(rv.clase === 'seguro' && !/sin decir de quién/.test(rv.nota), 'si el remixer de Spotify es el artista del archivo no hay ambigüedad, aunque la duración no cuadre');
rv = P({ name: 'Ladrillo! (Edit)', artist: 'K雨L', dur: 200 }, D.cat.ladrillo);
es(rv.clase === 'dudosa' && /«Edit» sin decir de quién/.test(rv.motivos.join()), 'un «Edit» a secas con duración distinta: dudosa');
rv = P({ name: 'Cobalt Avenue (Radio Edit)', artist: 'Tom Río & Søren Falk', dur: 300 }, D.cat.cobaltRadio);
es(rv.clase === 'seguro', 'un «Radio Edit» no es ambiguo');
rv = P({ name: 'Glass Harbor (Extended Mix)', artist: 'Nora Vex', dur: 500 }, D.cat.glass);
es(rv.clase === 'seguro' && rv.riesgo === 1, 'sin ambigüedad, la duración sigue sin convertir en dudosa');
// orden para repasar las seguras
es(P({ name: 'Glass Harbor', artist: 'Nora Vex', dur: 300 }, D.cat.glass).riesgo === 3, 'riesgo 3: en Spotify dura más que el archivo');
es(P(D.R.wait, D.cat.wait).riesgo === 2, 'riesgo 2: texto ambiguo confirmado por la duración');
es(P(D.R.paper, D.cat.paper).riesgo === 1, 'riesgo 1: cualquier otro aviso');
es(P(D.R.glass, D.cat.glass).riesgo === 0 && P(D.R.errata, D.cat.conErrata).riesgo === 0, 'riesgo 0: sin aviso, y las dudosas no cuentan');

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
// la misma canción en dos discos se enseña una vez
cer = C.elige(rb(D.R.calma), todo, {});
es(cer.dudosas.length === 1 && C.aspecto(sp(D.cat.calmaLarga)) === C.aspecto(sp(D.cat.calmaLarga2)), 'la misma candidata no se repite');
// «No es» descarta esa candidata
let e = C.elige(rb(D.R.errata), todo, { rechazadas: new Set([D.cat.conErrata.uri]) });
es(!e.seguro && !e.dudosas.length, 'una candidata rechazada no vuelve a salir');
// otra versión en la playlist cuenta como «ya está»
let y = C.yaEsta(rb(D.R.silence), [sp(D.cat.tondo), sp(D.cat.silenceRadio)]);
es(y && y.sp.id === D.cat.silenceRadio.id && y.r.otraVersion, 'otra versión en la playlist cuenta como ya está');
es(!C.yaEsta(rb(D.R.velvet), [sp(D.cat.velvetOtro)]), 'un remix de otra persona no cuenta como ya está');
es(!C.yaEsta(rb(D.R.openWater), [sp(D.cat.openWater)]), 'la original no cuenta como ya está el remix');
es(!C.yaEsta(rb(D.R.silence), [sp(D.cat.silenceRadio)], new Set([D.cat.silenceRadio.uri])), 'una rechazada con «No es» no cuenta como ya está');
es(!C.yaEsta(rb(D.R.marea), [sp(D.cat.mareaCorta)]), 'una pareja ambigua no cuenta como ya está sin preguntar');
// las dos candidatas de un «Remix» sin nombre se enseñan, la que también se llama «Remix» primero
e = C.elige(rb(D.R.veneno), todo, {});
es(!e.seguro && e.dudosas.length === 2 && e.dudosas[0].sp.id === D.cat.venenoOtro.id && e.dudosas[1].sp.id === D.cat.venenoRB.id, 'un «Remix» sin nombre enseña las dos mezclas para elegir');
// rechazada la segura, se pasa a la siguiente mejor
e = C.elige(rb(D.R.extra), todo, { rechazadas: new Set([D.cat.extra.uri]) });
es(!e.seguro && e.dudosas.length === 1 && e.dudosas[0].sp.id === D.cat.xtra.id, 'con la segura rechazada queda la siguiente como dudosa');
// se enseñan todas las candidatas, no solo tres
e = C.elige(rb(D.R.humo), todo, {});
es(!e.seguro && e.dudosas.length === 4 && e.dudosas[0].sp.id === D.cat.humoExt.id, 'una dudosa enseña todas sus candidatas (' + e.dudosas.length + ')');

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

// --- la puerta de escritura: qué playlists valen ---
const plOk = n => ({ nombre: n, propia: true });
['NS - House', 'OG - All', 'OG - Hard Techno / Techno ', 'NS - 2', 'OG - Others / Classics'].forEach(n => es(C.destinoMal(plOk(n), 1) === '', 'destino: «' + n + '» vale'));
['ns - House', ' NS - House', 'NS -House', 'NS- House', 'NS – House', 'NS — House', 'NS - ', 'NS -  House', 'NS', 'XNS - House', 'ONS - x', 'NSFW - x', 'Sound All', 'VARIOS - Otra', 'PRUEBA', 'Mis NS - House', ''].forEach(n =>
  es(/no empieza por «NS - » ni por «OG - »/.test(C.destinoMal(plOk(n), 1)), 'destino: «' + n + '» no vale por el nombre'));
es(/no está en lo leído/.test(C.destinoMal(null, 1)), 'destino: una playlist que no se ha leído no vale');
es(/no es tuya/.test(C.destinoMal({ nombre: 'NS - House', propia: false }, 1)) && /no es tuya/.test(C.destinoMal({ nombre: 'NS - House' }, 1)), 'destino: una playlist ajena (o sin saber de quién es) no vale');
es(/no está en el mapa/.test(C.destinoMal(plOk('NS - House'), 0)) && /hay 2 playlists de rekordbox/.test(C.destinoMal(plOk('NS - House'), 2)) && C.destinoMal(plOk('NS - House'), undefined) !== '', 'destino: tiene que ser la pareja de una sola playlist de rekordbox');
es(C.destinoMal({ nombre: 12, propia: true }, 1) !== '', 'destino: un nombre que no es texto no vale');

// --- la puerta de escritura: qué llamadas salen ---
const U = n => 'spotify:track:' + String(n).padStart(22, '0');
const PL = 'p'.repeat(22), OTRA = 'q'.repeat(22);
const permisoDe = c => Object.assign({ hasta: 2000, copia: '/copias/antes.json', pls: new Map([[PL, new Set([U(1), U(2), U(3)])]]), lotes: 2 }, c || {});
const llamada = c => Object.assign({ metodo: 'POST', ruta: '/playlists/' + PL + '/items', cuerpo: { uris: [U(1), U(2)] }, pase: { id: PL, uris: [U(1), U(2)] },
  permiso: permisoDe(), ahora: 1000, leida: 990, concedido: true, destino: () => '' }, c || {});
let g = C.puerta(llamada());
es(!g.no && g.ruta === '/playlists/' + PL + '/items' && g.uris.join() === [U(1), U(2)].join(), 'puerta: una llamada confirmada sale, con su ruta y sus canciones');
let x = llamada();
const desdeFuera = x.pase.uris;
g = C.puerta(x);
desdeFuera.push(U(3));
es(g.uris.length === 2, 'puerta: lo que devuelve para enviar no cambia aunque quien llamó cambie su lista después');
es(x.permiso.pls.get(PL).size === 1 && x.permiso.pls.get(PL).has(U(3)) && x.permiso.lotes === 1, 'puerta: al aprobar tacha las canciones enviadas y descuenta el lote');
x.pase = { id: PL, uris: [U(1), U(2)] };
es(/ya se envió/.test(C.puerta(x).no) && x.permiso.lotes === 1, 'puerta: la misma llamada, repetida, ya no sale');
x.pase = { id: PL, uris: [U(2)] }; x.cuerpo = { uris: [U(2)] };
es(/ya se envió/.test(C.puerta(x).no), 'puerta: tampoco una sola de las ya enviadas');
x.pase = { id: PL, uris: [U(3)] }; x.cuerpo = { uris: [U(3)] };
es(!C.puerta(x).no && x.permiso.pls.get(PL).size === 0 && x.permiso.lotes === 0, 'puerta: lo que quedaba por enviar sí sale, una vez');
x.pase = { id: PL, uris: [U(3)] };
es(!!C.puerta(x).no, 'puerta: y después ya no sale nada más');
g = C.puerta(llamada({ ruta: { toString: () => '/playlists/' + PL + '/items' } }));
es(!g.no && g.ruta === '/playlists/' + PL + '/items', 'puerta: la ruta que devuelve para enviar la escribe ella, no es la que trae quien llama');
// la misma canción puede ir a dos playlists, una vez a cada una
x = llamada({ permiso: permisoDe({ pls: new Map([[PL, new Set([U(1)])], [OTRA, new Set([U(1)])]]), lotes: 2 }), pase: { id: PL, uris: [U(1)] }, cuerpo: { uris: [U(1)] } });
es(!C.puerta(x).no, 'puerta: una canción confirmada para dos playlists sale hacia la primera');
x.pase = { id: OTRA, uris: [U(1)] }; x.ruta = '/playlists/' + OTRA + '/items';
es(!C.puerta(x).no, 'puerta: y hacia la segunda');
x.pase = { id: OTRA, uris: [U(1)] };
es(!!C.puerta(x).no, 'puerta: pero no dos veces a la misma');
// cien justas salen; ciento una no
const cien = Array.from({ length: 100 }, (_, i) => U(i + 1)), ciento1 = cien.concat([U(101)]);
es(!C.puerta(llamada({ permiso: permisoDe({ pls: new Map([[PL, new Set(ciento1)]]) }), pase: { id: PL, uris: cien }, cuerpo: { uris: cien } })).no, 'puerta: un lote de 100 canciones sale');
const noSale = [
  ['PUT', { metodo: 'PUT' }, /solo se permite añadir/],
  ['DELETE', { metodo: 'DELETE' }, /solo se permite añadir/],
  ['PATCH', { metodo: 'PATCH' }, /solo se permite añadir/],
  ['post en minúsculas', { metodo: 'post' }, /solo se permite añadir/],
  ['sin pase', { pase: null }, /falta la confirmación/],
  ['pase sin playlist', { pase: { uris: [U(1), U(2)] } }, /falta la confirmación/],
  ['sin el permiso de Spotify', { concedido: false }, /no ha concedido/],
  ['permiso de Spotify dudoso', { concedido: 'sí' }, /no ha concedido/],
  ['ruta con parámetros', { ruta: '/playlists/' + PL + '/items?position=0' }, /no es la llamada confirmada/],
  ['ruta antigua /tracks', { ruta: '/playlists/' + PL + '/tracks' }, /no es la llamada confirmada/],
  ['ruta de otra playlist', { ruta: '/playlists/' + OTRA + '/items' }, /no es la llamada confirmada/],
  ['ruta de likes', { ruta: '/me/tracks' }, /no es la llamada confirmada/],
  ['ruta de crear playlist', { ruta: '/me/playlists' }, /no es la llamada confirmada/],
  ['ruta con algo detrás', { ruta: '/playlists/' + PL + '/items/' }, /no es la llamada confirmada/],
  ['destino que no vale', { destino: () => 'el nombre de «X» no empieza por «NS - » ni por «OG - »' }, /no empieza por/],
  ['destino sin respuesta', { destino: () => undefined }, /no se ha podido comprobar/],
  ['sin forma de comprobar el destino', { destino: null }, /no se ha podido comprobar/],
  ['sin sincronización confirmada', { permiso: null }, /ninguna sincronización confirmada/],
  ['permiso caducado', { ahora: 2000 }, /ninguna sincronización confirmada/],
  ['hora que no es un número', { ahora: NaN }, /ninguna sincronización confirmada/],
  ['sin copia', { permiso: permisoDe({ copia: '' }) }, /no hay copia/],
  ['sin lectura previa', { leida: undefined }, /no se ha releído/],
  ['lectura previa de hace 15 s', { ahora: 1000, leida: 1000 - 15000 }, /no se ha releído/],
  ['lectura previa de hace una hora', { ahora: 1000, leida: 1000 - 3600000 }, /no se ha releído/],
  ['lectura previa con fecha futura', { leida: 1500 }, /no se ha releído/],
  ['lectura previa que no es un número', { leida: 'ahora' }, /no se ha releído/],
  ['playlist no confirmada', { permiso: permisoDe({ pls: new Map([[OTRA, new Set([U(1), U(2)])]]) }) }, /no está entre las confirmadas/],
  ['lista de confirmadas rota', { permiso: permisoDe({ pls: {} }) }, /no está entre las confirmadas/],
  ['sin lotes disponibles', { permiso: permisoDe({ lotes: 0 }) }, /todos los lotes/],
  ['lote vacío', { pase: { id: PL, uris: [] }, cuerpo: { uris: [] } }, /entre 1 y 100/],
  ['lote que no es una lista', { pase: { id: PL, uris: U(1) }, cuerpo: { uris: U(1) } }, /entre 1 y 100/],
  ['101 canciones', { permiso: permisoDe({ pls: new Map([[PL, new Set(ciento1)]]) }), pase: { id: PL, uris: ciento1 }, cuerpo: { uris: ciento1 } }, /entre 1 y 100/],
  ['canción repetida en el lote', { pase: { id: PL, uris: [U(1), U(1)] }, cuerpo: { uris: [U(1), U(1)] } }, /repite/],
  ['una canción sin confirmar', { pase: { id: PL, uris: [U(1), U(9)] }, cuerpo: { uris: [U(1), U(9)] } }, /no está confirmado/],
  ['un episodio', { permiso: permisoDe({ pls: new Map([[PL, new Set(['spotify:episode:' + '0'.repeat(22)])]]) }), pase: { id: PL, uris: ['spotify:episode:' + '0'.repeat(22)] }, cuerpo: { uris: ['spotify:episode:' + '0'.repeat(22)] } }, /no está confirmado/],
  ['un archivo local', { permiso: permisoDe({ pls: new Map([[PL, new Set(['spotify:local:a:b:c:100'])]]) }), pase: { id: PL, uris: ['spotify:local:a:b:c:100'] }, cuerpo: { uris: ['spotify:local:a:b:c:100'] } }, /no está confirmado/],
  ['algo que no es texto', { pase: { id: PL, uris: [U(1), 7] }, cuerpo: { uris: [U(1), 7] } }, /no está confirmado/],
  ['cuerpo con otras canciones', { cuerpo: { uris: [U(1), U(3)] } }, /el cuerpo no es/],
  ['cuerpo en otro orden', { cuerpo: { uris: [U(2), U(1)] } }, /el cuerpo no es/],
  ['cuerpo con una de más', { cuerpo: { uris: [U(1), U(2), U(3)] } }, /el cuerpo no es/],
  ['cuerpo con position', { cuerpo: { uris: [U(1), U(2)], position: 0 } }, /el cuerpo no es/],
  ['cuerpo sin canciones', { cuerpo: {} }, /el cuerpo no es/],
  ['sin cuerpo', { cuerpo: null }, /el cuerpo no es/],
];
noSale.forEach(([nombre, cambios, motivo]) => {
  const y = llamada(cambios), antes = y.permiso && y.permiso.pls instanceof Map ? JSON.stringify(Array.from(y.permiso.pls).map(([k, v]) => [k, Array.from(v)])) + y.permiso.lotes : '';
  const r = C.puerta(y);
  const despues = y.permiso && y.permiso.pls instanceof Map ? JSON.stringify(Array.from(y.permiso.pls).map(([k, v]) => [k, Array.from(v)])) + y.permiso.lotes : '';
  es(!!r.no && motivo.test(r.no) && !r.ruta && !r.uris && antes === despues, 'puerta: no sale (' + nombre + ')' + (r.no ? '' : ' — HA SALIDO') + (r.no && !motivo.test(r.no) ? ' — motivo: ' + r.no : ''));
});
es(!C.puerta(llamada({ ahora: 100000, leida: 100000 - 14999, permiso: permisoDe({ hasta: 200000 }) })).no && !C.puerta(llamada({ leida: 1000 })).no, 'puerta: con la playlist releída hace menos de 15 s, sale');
es(C.FRESCA_ESCR === 15000 && C.MAX_LOTE === 100 && C.URI_CANCION.test(U(1)) && !C.URI_CANCION.test(U(1) + 'x') && !C.URI_CANCION.test(' ' + U(1)), 'puerta: el tope es 100 y una canción es exactamente spotify:track: más 22 caracteres');

console.log('Núcleo: ' + ok + ' comprobaciones bien, ' + mal + ' mal.');
process.exit(mal ? 1 : 0);
