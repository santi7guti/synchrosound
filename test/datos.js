/* Datos INVENTADOS para las pruebas. Nada de esto sale de la biblioteca de nadie:
   artistas, títulos y playlists de mentira con las mismas formas que dan guerra en la vida real. */
'use strict';

let nId = 0;
function pista(nombre, artistas, seg, extra) {
  nId++;
  const id = 'sp' + String(nId).padStart(20, '0');
  return Object.assign({
    id, uri: 'spotify:track:' + id, type: 'track', name: nombre, duration_ms: seg * 1000,
    artists: artistas.map((n, i) => ({ id: 'ar' + nId + '_' + i, name: n })),
    album: { name: 'Disco ' + nId }, external_ids: { isrc: 'XX' + String(nId).padStart(10, '0') },
  }, extra || {});
}

// ---- catálogo de Spotify de mentira ----
const cat = {
  glass: pista('Glass Harbor', ['Nora Vex'], 372),
  paper: pista('Paper Lanterns', ['Nora Vex'], 215),
  cobaltExt: pista('Cobalt Avenue - Extended Mix', ['Tom Río', 'Søren Falk'], 400),
  cobaltRadio: pista('Cobalt Avenue - Radio Edit', ['Tom Río', 'Søren Falk'], 190),
  busCorta: pista('Night Bus', ['Kilo', 'Lima'], 201),
  busExt: pista('Night Bus - Extended Mix', ['Kilo', 'Lima'], 389),
  velvetRmx: pista('Velvet Engine - Dario Kent Remix', ['Mira Sol', 'Dario Kent'], 366),
  velvetOtro: pista('Velvet Engine - Uma Reed Remix', ['Mira Sol', 'Uma Reed'], 365),
  openWater: pista('Open Water', ['Mira Sol'], 338),
  conErrata: pista('Midnight Train', ['Harlan Pike'], 301),
  cumbia: pista('Cumbia del Túnel', ['Los Faros'], 281),
  signal: pista('Need Your Signal', ['Ada Quill', 'Ben Orr', 'Cy Tan'], 418),
  perdon: pista('Perdón', ['Marisol'], 240),
  ladrillo: pista('Ladrillo!', ['K雨L'], 322),
  tondo: pista('Faro Azul', ['Ivo Ren', 'Ana Paz'], 329),
  tondoOtra: pista('Faro Azul', ['Ivo Ren', 'Ana Paz'], 329), // la misma canción en otro disco (otro id)
  extra: pista('Mill Life Extra', ['The Mill'], 360),
  xtra: pista('Mill Life Xtra', ['The Mill'], 338),
  bailaCorta: pista('Baila (feat. Teo Lang) - Zeta Remix', ['Inés Coral', 'Teo Lang', 'Zeta'], 222),
  bailaExt: pista('Baila (feat. Teo Lang) - Zeta Extended Remix', ['Inés Coral', 'Teo Lang', 'Zeta'], 341),
  wait: pista("No Puedo Esperar", ['Leo Marten', 'Polar Unit'], 284),
  silenceRadio: pista('Radio Silence - Radio Edit', ['Lena Fox'], 200),
  moveOn: pista('Sigue Recto - Extended Mix', ['Vigías'], 298),
  currentInst: pista('Deep Current - Instrumental', ['Mira Sol'], 300),
  sunriseOtro: pista('Sunrise', ['Otra Gente'], 250),
  lady: pista('Dama (Óyeme Esta Noche)', ['Modelo Uno'], 221),
  largaCorta: pista('Sube Sube', ['Rita Polo'], 185),
  // la Extended solo sale si se busca a propósito con la palabra «extended»
  largaExt: pista('Sube Sube - Extended Mix', ['Rita Polo'], 372, { soloConExtended: true }),
  calmaLarga: pista('Calma, Tómatelo Con Calma', ['Mila Ros'], 220),
  calmaLarga2: pista('Calma, Tómatelo Con Calma', ['Mila Ros'], 220), // la misma, en otro disco
  cambiadaSp: pista('PACO ALTO', ['noviatechnorara', 'Pol Lebay'], 305),
  venenoRB: pista('Veneno - R & B Mix', ['Grupo Luna'], 259),
  // otro remix que también se llama «Remix» a secas, de otra gente y con otra duración
  venenoOtro: pista('Veneno - Remix', ['Grupo Luna', 'Hermanos Jota'], 362),
  // mismo título, artista con una letra distinta y una duración que no cuadra
  mareaCorta: pista('Marea Baja', ['NICO BRENDT'], 176),
  // en Spotify dura bastante más que el archivo: segura, pero la primera que conviene repasar
  rioLarga: pista('Río Arriba', ['Selva Nord'], 301),
  // cuatro versiones distintas de un título que contiene al del archivo: se enseñan las cuatro
  humoA: pista('Humo Blanco', ['Vera Luz'], 201),
  humoRadio: pista('Humo Blanco - Radio Edit', ['Vera Luz'], 178),
  humoExt: pista('Humo Blanco - Extended Mix', ['Vera Luz'], 392),
  humoB: pista('Humo Blanco', ['Vera Luz'], 246),
  besosOtro: pista('B.E.S.O.S', ['Banda Equis'], 315),
  altoOtro: pista('Alto', ['Brown Cult'], 177),
  // sueltas para likes y Soundeo
  like1: pista('Solo Me Gusta', ['Iris Mar'], 200),
  likeViejo: pista('Like Antiguo', ['Iris Mar'], 210),
  s1: pista('Favorita Bajada', ['Soundero'], 300),
  s2: pista('Favorita Por Probar', ['Soundero'], 301),
  s3: pista('Favorita Ya Repartida', ['Soundero'], 302),
};
const relleno = [];
for (let i = 1; i <= 190; i++) relleno.push(pista('Relleno ' + i, ['Artista Relleno ' + (i % 7)], 180 + i));
const catalogo = Object.values(cat).concat(relleno);

// ---- XML de rekordbox de mentira ----
let nRb = 1000;
const rbPistas = [];
function rb(nombre, artista, seg, extra) {
  nRb++;
  const t = Object.assign({ id: String(nRb), name: nombre, artist: artista, dur: seg, kind: 'MP3 File', remixer: '',
    loc: 'file://localhost/C:/Musica/Biblioteca/2026/26.10/' + encodeURIComponent((artista || 'x') + ' - ' + nombre) + '.mp3' }, extra || {});
  rbPistas.push(t);
  return t;
}
const R = {
  glass: rb('Glass Harbor', 'Nora Vex', 372),
  paper: rb('Paper Lanterns (Extended Mix)', 'Nora Vex', 395),
  cobalt: rb('Cobalt Avenue (Extended Mix)', 'Tom Río & Søren Falk', 402),
  bus: rb('Night Bus', 'Kilo X Lima ', 388),
  velvet: rb('Velvet Engine (Dario Kent Remix)', 'Mira Sol', 365),
  openWater: rb('Open Water (Juno Park Remix)', 'Mira Sol', 340),
  errata: rb('Midnigth Train', 'Harlan Pike', 300),
  tool: rb('Robot Lento (DJ Nadie TOOL)', 'DJ Nadie', 245),
  cumbia: rb('Cumbia del Túnel', '', 280),
  signal: rb('Need Your Signal (OJO BPM)', 'Ada Quill, Ben Orr, Cy Tan', 420),
  perdon: rb('Perdón | Marisol', 'KLAUS9', 283),
  ladrillo: rb('Ladrillo! (Edit)', 'K雨L', 321),
  tondo: rb('Faro Azul', 'Ivo Ren  & Ana Paz ', 329),
  extra: rb('Mill Life Extra', 'The Mill', 360),
  xtra: rb('Mill Life Xtra', 'The Mill', 338),
  baila: rb('Baila (Zeta Extended Remix) (feat. Teo Lang)', 'Inés Coral', 340),
  wait: rb("No Puedo Esperar (Original Mix)", 'LEO MARTAN, Polar Unit', 284),
  silence: rb('Radio Silence (Extended Mix)', 'Lena Fox', 400),
  moveOn: rb('Sigue Recto (Extended Mix)', 'Vigías (UK)', 298, { kind: 'AIFF File' }),
  current: rb('Deep Current', 'Mira Sol', 300),
  sunrise: rb('Sunrise', 'Otto Blau', 250),
  larga: rb('Sube Sube', 'Rita Polo', 370),
  calma: rb('Calma', 'Mila Ros', 360),
  besos: rb('Besos (Nolo Remix)', '', 289),
  alto: rb('ALTO', 'Browen, DJ Libre', 243),
  cambiada: rb('Novia Techno Rara', 'PACO ALTO', 305),
  veneno: rb('Veneno Remix', 'Grupo Lunna', 278),
  marea: rb('Marea Baja', 'Nico Brandt', 381),
  rio: rb('Río Arriba', 'Selva Nord', 214),
  humo: rb('Humo', 'Vera Luz', 365),
  nube: rb('Algo de SoundCloud', 'Nube', 300, { kind: 'Unknown Format', loc: 'file://localhost/soundcloud:tracks:123456' }),
  sample: rb('Sirena', '', 4, { kind: 'WAV File', loc: 'file://localhost/C:/Users/x/rekordbox/Sampler/OSC_SAMPLER/Sirena.wav' }),
  vieja: rb('Canción Vieja', 'Alguien', 300),
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const arbol = {
  ns: {
    'House': ['glass', 'paper', 'cobalt', 'errata', 'cumbia', 'perdon', 'extra', 'xtra', 'baila', 'wait', 'nube', 'larga', 'calma', 'besos', 'alto', 'cambiada', 'veneno', 'humo'],
    'Techno': ['bus', 'velvet', 'openWater', 'tool', 'ladrillo', 'moveOn', 'current', 'sunrise', 'marea', 'rio'],
    'Raw/UK Garage': ['velvet'],
    'Chill': ['glass'],
  },
  og: { 'ALL': ['cobalt', 'signal', 'tondo', 'silence'], 'Classics': ['signal'] },
};
// «extra» = {pistas: [...], og: {nombre: [pistas]}}: canciones y playlists Old Gems de más, solo para ese XML.
function xml(extra) {
  const todas = rbPistas.concat((extra && extra.pistas) || []), og = Object.assign({}, arbol.og, (extra && extra.og) || {});
  const pl = (nombre, claves) => '      <NODE Name="' + esc(nombre) + '" Type="1" KeyType="0" Entries="' + claves.length + '">\r\n' +
    claves.map(k => '        <TRACK Key="' + (typeof k === 'string' ? R[k] : k).id + '"/>\r\n').join('') + '      </NODE>\r\n';
  return '<?xml version="1.0" encoding="UTF-8"?>\r\n\r\n<DJ_PLAYLISTS Version="1.0.0">\r\n' +
    '  <PRODUCT Name="rekordbox" Version="7.2.19" Company="AlphaTheta"/>\r\n' +
    '  <COLLECTION Entries="' + todas.length + '">\r\n' +
    todas.map(t => '    <TRACK TrackID="' + t.id + '" Name="' + esc(t.name) + '" Artist="' + esc(t.artist) + '" Composer="" Album="" Kind="' + t.kind +
      '" TotalTime="' + t.dur + '" DateAdded="2026-10-01" Comments="" Location="' + esc(t.loc) + '" Remixer="' + esc(t.remixer) + '" Label="" Mix="">\r\n' +
      '      <TEMPO Inizio="0.1" Bpm="130.00" Metro="4/4" Battito="1"/>\r\n    </TRACK>\r\n').join('') +
    '  </COLLECTION>\r\n  <PLAYLISTS>\r\n    <NODE Type="0" Name="ROOT" Count="4">\r\n' +
    '     <NODE Name="New School (From 01.25)" Type="0" Count="5">\r\n' +
    Object.keys(arbol.ns).map(n => pl(n, arbol.ns[n])).join('') +
    '      <NODE Name="Old Gems" Type="0" Count="' + Object.keys(og).length + '">\r\n' + Object.keys(og).map(n => pl(n, og[n])).join('') + '      </NODE>\r\n' +
    '     </NODE>\r\n' +
    '     <NODE Name="Otra Carpeta" Type="0" Count="1">\r\n' + pl('Viejas', ['vieja', 'glass']) + '     </NODE>\r\n' +
    pl('SUELTA', ['glass', 'vieja']) + pl('New School Todo (All)', ['glass']) +
    '    </NODE>\r\n  </PLAYLISTS>\r\n</DJ_PLAYLISTS>\r\n';
}

// ---- biblioteca de Spotify de mentira ----
const YO = { id: 'usuario_prueba', display_name: 'Prueba' };
let nPl = 0;
function playlist(nombre, pistas, extra) {
  nPl++;
  return Object.assign({ id: 'pl' + String(nPl).padStart(20, '0'), name: nombre, owner: YO, collaborative: false, public: false,
    description: '', snapshot_id: 'snap' + nPl, pistas: pistas.map((t, i) => ({ added_at: '2026-10-' + String(1 + (i % 27)).padStart(2, '0') + 'T10:00:00Z', t })) }, extra || {});
}
const playlists = [
  playlist('NS - House', [cat.glass, cat.s3]),
  playlist('NS - Techno', []),
  playlist('NS - Raw / UK Garage', []),
  playlist('OG - All', [cat.tondo, cat.silenceRadio]),
  playlist('OG - Classics', []),
  playlist('Sound All', [cat.s1, cat.s2, cat.s3]),
  playlist('Sound Down', [cat.s1]),
  playlist('Sound Try', [cat.s2]),
  playlist('VARIOS - Larga', relleno.slice(0, 120)),
  playlist('VARIOS - Otra', [cat.lady, cat.openWater]),
  playlist('Lista ajena', [cat.paper], { owner: { id: 'otra_persona', display_name: 'Otra' } }),
];
const likes = [
  { added_at: '2026-10-20T09:00:00Z', t: cat.like1 },      // sin repartir
  { added_at: '2026-10-19T09:00:00Z', t: cat.glass },      // ya está en NS - House
  { added_at: '2026-08-01T09:00:00Z', t: cat.likeViejo },  // anterior a la fecha
  { added_at: '2026-10-18T09:00:00Z', t: cat.tondoOtra },  // misma canción que una de OG - All (otro id)
  { added_at: '2026-10-17T09:00:00Z', t: cat.s2 },         // like y además Sound Try
].concat(relleno.slice(120, 190).map((t, i) => ({ added_at: '2026-07-' + String(1 + (i % 27)).padStart(2, '0') + 'T08:00:00Z', t })));

// Para las pruebas de sincronización: la misma biblioteca en copia aparte (lo que se escriba no toca los datos comunes).
// «otras» = playlists de más; «cambios» = {nombre de playlist: propiedades que cambian}.
function copiaBiblio(otras, cambios) {
  return playlists.map(p => Object.assign({}, p, { pistas: p.pistas.slice() }, (cambios && cambios[p.name]) || {})).concat(otras || []);
}
// Y un XML con una playlist Old Gems de más, «Larga», con 130 canciones que están en la biblioteca de Spotify:
// para probar que una playlist con más de 100 canciones por añadir se escribe en dos lotes.
const largas = relleno.slice(0, 130).map((t, i) => ({ id: String(5000 + i), name: t.name, artist: t.artists[0].name, dur: t.duration_ms / 1000, kind: 'MP3 File', remixer: '', uri: t.uri,
  loc: 'file://localhost/C:/Musica/Biblioteca/2026/26.11/' + encodeURIComponent(t.artists[0].name + ' - ' + t.name) + '.mp3' }));
// En medio va otro archivo de una canción que ya está en la lista (dos archivos de rekordbox, una canción de Spotify):
// tiene que añadirse una sola vez.
const repetida = Object.assign({}, largas[3], { id: '5999', kind: 'AIFF File', loc: largas[3].loc.replace(/\.mp3$/, '%20(otra%20copia).aiff') });
const xmlLargo = () => xml({ pistas: largas.concat([repetida]), og: { Larga: largas.slice(0, 50).concat([repetida], largas.slice(50)) } });
// Lo que la sincronización tiene que añadir a la playlist de rekordbox «nombre» del grupo «ns» u «og», en su orden.
const aAnadir = (grupo, nombre) => arbol[grupo][nombre].filter(k => esperado.add[k]).map(k => cat[esperado.add[k]].uri);

// Qué tiene que salir de la simulación.
const esperado = {
  unicas: 30,
  ya: ['glass', 'tondo', 'silence'],
  add: { paper: 'paper', cobalt: 'cobaltExt', bus: 'busExt', velvet: 'velvetRmx', signal: 'signal', ladrillo: 'ladrillo', extra: 'extra', xtra: 'xtra', baila: 'bailaExt', wait: 'wait', moveOn: 'moveOn', larga: 'largaExt', rio: 'rioLarga', cambiada: 'cambiadaSp' },
  duda: { errata: 'conErrata', cumbia: 'cumbia', perdon: 'perdon', current: 'currentInst', calma: 'calmaLarga', veneno: 'venenoOtro', marea: 'mareaCorta', humo: 'humoExt' },
  no: ['tool', 'sunrise', 'besos', 'alto', 'openWater'],
  sinRepartir: ['like1', 's2', 's1'],
};

// ---- Soundeo de mentira (botón B) ----
// Favoritos tal como los enseña Soundeo: «Artistas - Título (Mezcla)». estado: 0 sin descargar, 1 descargada, 2 sin publicar.
const sxFav = [
  { id: 9000001, texto: 'Soundero - Favorita Bajada (Original Mix)', dur: 300, estado: 1 },       // ya en Sound All y Sound Down
  { id: 9000002, texto: 'Soundero - Favorita Por Probar (Original Mix)', dur: 301, estado: 0 },   // ya en Sound All y Sound Try
  { id: 9000003, texto: 'Soundero - Favorita Ya Repartida (Original Mix)', dur: 302, estado: 1 }, // en Sound All; falta en Sound Down
  { id: 9000004, texto: 'Nora Vex - Paper Lanterns (Extended Mix)', dur: 395, estado: 0 },        // la misma que en rekordbox: a All y Try
  { id: 9000005, texto: 'Tom Río, Søren Falk - Cobalt Avenue (Extended Mix)', dur: 402, estado: 1 }, // a All y Down
  { id: 9000006, texto: 'Harlan Pike - Midnigth Train', dur: 300, estado: 0 },                    // dudosa (errata en el título)
  { id: 9000007, texto: 'DJ Nadie - Robot Lento (DJ Nadie TOOL)', dur: 245, estado: 0 },          // no está en Spotify
  { id: 9000008, texto: 'Otto Blau - Sunrise (Original Mix)', dur: 250, estado: 2 },              // sin publicar en Soundeo y no está en Spotify
  { id: 9000009, texto: 'Iris Mar - Solo Me Gusta (Original Mix)', dur: 200, estado: 0 },         // está en sus likes: sale sin buscar
  // Soundeo no la marca como descargada en favoritos, pero está en «Mis descargas»: cuenta como descargada
  { id: 9000010, texto: 'Rita Polo - Sube Sube (Extended Mix)', dur: 370, estado: 0 },
];
// «Mis descargas»: cuatro favoritos y una que ya no tiene estrella.
const sxDow = [9000001, 9000003, 9000005, 9000010, 9000099];
// Qué tiene que salir de la simulación del botón B.
const sxEsperado = {
  ya: [9000001, 9000002], add: [9000003, 9000004, 9000005, 9000009, 9000010], duda: [9000006], no: [9000007, 9000008],
  descargadas: [9000001, 9000003, 9000005, 9000010],
  all: { ya: 3, add: 4, duda: 1, no: 2 }, down: { ya: 1, add: 3, duda: 0, no: 0 }, try: { ya: 1, add: 2, duda: 1, no: 2 },
};
// Muchos favoritos, para probar las páginas (100 por página).
const sxMuchos = n => Array.from({ length: n }, (_, i) => ({ id: 9100000 + i, texto: 'Artista Relleno ' + (i % 7) + ' - Relleno ' + (i + 1) + ' (Original Mix)', dur: 181 + (i % 190), estado: i % 3 === 0 ? 1 : 0 }));

module.exports = { cat, catalogo, relleno, R, rbPistas, arbol, xml, xmlLargo, largas, aAnadir, YO, playlist, playlists, copiaBiblio, likes, esperado, sxFav, sxDow, sxEsperado, sxMuchos };
