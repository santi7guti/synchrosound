/* Pruebas de extremo a extremo con Spotify y Dropbox simulados (ver falsos.js).
   Uso:  NODE_PATH=<carpeta con playwright> CHROME=/ruta/a/chrome node test/e2e.js
   Comprueba, entre otras cosas, que a Spotify no sale nada que no sea GET salvo las escrituras de la sincronización:
   POST /playlists/{id}/items a playlists «NS - …» y «OG - …» del mapa, las marcadas, y solo tras confirmarlo. */
'use strict';
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const { Mundo, SITIO } = require('./falsos.js');
const D = require('./datos.js');
const C = require('../core.js');

let ok = 0, mal = 0;
// PRIMERA=1 corta en el primer fallo (para comprobar deprisa que un cambio a propósito en el código se detecta).
function es(cond, texto) { if (cond) ok++; else { mal++; console.log('  FALLA: ' + texto); if (process.env.PRIMERA) { console.log('Extremo a extremo: parado en el primer fallo, tras ' + ok + ' comprobaciones bien.'); process.exit(1); } } }
const SALIDA = process.env.SALIDA || '';
const LECTURA = 'playlist-read-private playlist-read-collaborative user-library-read';
const PEDIDOS = LECTURA + ' playlist-modify-public playlist-modify-private';
// Llama a la puerta de Spotify de la app como lo haría cualquier otro trozo de código: dice si pasó o por qué no.
const intenta = (page, it) => page.evaluate(([m, r, o]) => window.SS.spotify(m, r, o).then(() => 'pasó', e => e.message), it);

let navegador;
async function nuevo(opc, ctxOpc) {
  const mundo = new Mundo(opc);
  const ctx = await navegador.newContext(Object.assign({ locale: 'es-ES', timezoneId: 'Europe/Madrid' }, ctxOpc || {}));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await mundo.instala(ctx);
  const page = await ctx.newPage();
  const consola = [];
  // Dropbox contesta 409 a «ese archivo no existe» y Spotify 429 a «espera»: el navegador los apunta como
  // recursos fallidos aunque la app los espera. Aquí solo cuentan los errores del propio código.
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) consola.push(m.text()); });
  page.on('pageerror', e => consola.push('pageerror: ' + e.message));
  await page.goto(SITIO);
  await page.waitForSelector('.cab');
  return { mundo, ctx, page, consola };
}
const boton = (page, nombre) => page.getByRole('button', { name: nombre, exact: true });
const cuerpo = page => page.innerText('body');
async function conecta(page, quien) {
  await boton(page, 'Conectar ' + quien).click();
  await page.waitForFunction(q => document.body.innerText.indexOf(q + ' conectado.') >= 0 || !!document.querySelector('.aviso.error'), quien, { timeout: 15000 });
}
async function eligeXml(page) {
  await boton(page, 'Ver archivos de la carpeta').click();
  await boton(page, 'Usar este').click();
  await page.waitForFunction(() => /Archivo: \/rekordbox\.xml/.test(document.body.innerText), null, { timeout: 15000 });
}
async function pestana(page, nombre) { await page.locator('.pestana', { hasText: nombre }).click(); }
async function simula(page, nombreBoton) {
  await pestana(page, 'rekordbox a Spotify');
  await boton(page, nombreBoton || 'Simular').click();
  await page.waitForFunction(() => !window.SS.estado.tarea && !!window.SS.estado.sim, null, { timeout: 120000 });
}
const numeros = page => page.evaluate(() => { const o = {}; document.querySelectorAll('.filtro').forEach(f => { o[f.className.match(/cat-(\w+)/)[1]] = Number(f.querySelector('.filtro-num').textContent); }); return o; });
const estados = page => page.evaluate(() => window.SS.estado.sim.unicas.map(u => ({ n: u.rb.nombre, e: u.estado, sp: u.elegida ? u.elegida.sp.id : (u.destinos.find(d => d.ya) ? u.destinos.find(d => d.ya).ya.sp.id : (u.dudosas[0] ? u.dudosas[0].sp.id : null)), nota: u.elegida ? u.elegida.r.nota : '' })));
const foto = async (page, nombre) => { if (SALIDA) await page.screenshot({ path: path.join(SALIDA, nombre + '.png'), fullPage: true }); };

async function flujoCompleto(titulo, ctxOpc, sufijo) {
  console.log(titulo);
  const { mundo, ctx, page, consola } = await nuevo({}, ctxOpc);
  const xmlAntes = mundo.archivos.get('/rekordbox.xml').texto, revAntes = mundo.archivos.get('/rekordbox.xml').rev;

  // --- arranque ---
  let t = await cuerpo(page);
  es(/v0\.4\.0/.test(t), 'se ve el número de versión');
  es(/Solo lectura/.test(t), 'se ve el indicador de solo lectura');
  es(/Sin conectar en este dispositivo/.test(t), 'empieza sin conectar');
  await foto(page, 'cuentas-vacio' + sufijo);

  // --- cuentas ---
  await conecta(page, 'Dropbox');
  es(page.url() === SITIO, 'tras conectar Dropbox la dirección queda limpia (sin code)');
  es(mundo.autoriza.db.token_access_type === 'offline' && mundo.autoriza.db.code_challenge_method === 'S256' && mundo.autoriza.db.redirect_uri === SITIO, 'Dropbox: PKCE con acceso offline y la redirección exacta');
  es(mundo.autoriza.db.client_id === 'd614ryq07qvpgkj', 'Dropbox: clave de la app');
  await conecta(page, 'Spotify');
  es(mundo.autoriza.sp.scope === PEDIDOS, 'Spotify: se piden exactamente los tres permisos de lectura y los dos de modificar playlists (' + mundo.autoriza.sp.scope + ')');
  es(!/library-modify/.test(mundo.autoriza.sp.scope), 'Spotify: no se pide el permiso de tocar los likes');
  es(mundo.autoriza.sp.code_challenge_method === 'S256' && mundo.autoriza.sp.redirect_uri === SITIO && mundo.autoriza.sp.response_type === 'code', 'Spotify: PKCE y la redirección exacta');
  es(mundo.autoriza.sp.client_id === '6251c56f9a7e49d4891a1531e89735ad', 'Spotify: Client ID');
  es(mundo.autoriza.sp.state !== mundo.autoriza.db.state && /^sp\./.test(mundo.autoriza.sp.state) && /^db\./.test(mundo.autoriza.db.state), 'el state distingue Spotify de Dropbox');
  await page.waitForFunction(() => /como Prueba/.test(document.body.innerText) && /como Cuenta de Prueba/.test(document.body.innerText), null, { timeout: 10000 });
  t = await cuerpo(page);
  es(t.indexOf('Permisos concedidos: ' + PEDIDOS + '.') >= 0, 'enseña los permisos que Spotify ha concedido');
  es(/Solo añadir/.test(await page.locator('.candado').innerText()), 'con el permiso de escritura concedido el indicador deja de decir «Solo lectura»');
  es(t.indexOf('no-debe-salir@ejemplo.test') < 0, 'no enseña el correo de Dropbox');

  await eligeXml(page);
  t = await cuerpo(page);
  es(/Notas\.txt/.test(t) === false, 'la lista de XML no enseña archivos que no lo son');
  es(/33 entradas/.test(t) && /4 playlists New School y 2 Old Gems/.test(t), 'lee la colección y las playlists del mapa');
  es(/Ignoradas: 1 de SoundCloud y 1 sample\./.test(t), 'ignora SoundCloud y samples');
  es(/Archivo: \/rekordbox\.xml, último cambio el 23\/11\/2026 14:05 \(comprobado a las \d\d:\d\d\)/.test(t) && /Si cierras rekordbox sin haber cambiado nada, esa fecha no se mueve/.test(t), 'del XML dice cuándo cambió por última vez y cuándo se ha comprobado');
  await foto(page, 'cuentas' + sufijo);

  // --- copia ---
  await pestana(page, 'Copia');
  await boton(page, 'Hacer una copia ahora').click();
  await page.waitForFunction(() => /Guardada: \/copias\//.test(document.body.innerText), null, { timeout: 60000 });
  let copias = Array.from(mundo.archivos.values()).filter(a => a.ruta.startsWith('/copias/'));
  es(copias.length === 1 && /^\/copias\/spotify-completa-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.json$/.test(copias[0].ruta), 'la copia es un archivo nuevo con fecha (' + (copias[0] && copias[0].ruta) + ')');
  const copia = JSON.parse(copias[0].texto);
  es(copia.playlists.length === D.playlists.length && copia.likes.length === D.likes.length, 'la copia lleva todas las playlists y todos los likes');
  const larga = copia.playlists.find(p => p.nombre === 'VARIOS - Larga');
  es(larga.canciones.length === 120 && larga.canciones[119].uri === D.relleno[119].uri, 'una playlist de 120 se lee entera aunque Spotify dé páginas de 30');
  es(copia.likes.length === 75 && copia.likes[0].agregada === '2026-10-20T09:00:00Z', 'los likes llevan su fecha');
  const ajena = copia.playlists.find(p => p.nombre === 'Lista ajena');
  es(ajena && ajena.contenido_guardado === false && ajena.canciones.length === 0, 'de una playlist ajena se guarda el nombre y se avisa de que no hay contenido');
  es(copia.resumen.avisos.length === 0, 'los totales leídos coinciden con los que dice Spotify');
  es(!/acceso|refresco/.test(copias[0].texto), 'la copia no lleva tokens');
  await page.waitForFunction(() => !window.SS.estado.tarea);
  es(mundo.archivos.has('/memoria/cache-biblioteca.json') && !/acceso|refresco/.test(mundo.archivos.get('/memoria/cache-biblioteca.json').texto), 'lo leído de Spotify se guarda en Dropbox, sin tokens');
  es(/playlists releídas 10, sin cambios 0; likes releídos; \d+ peticiones a Spotify/.test(copia.resumen.lectura), 'la primera lectura lo lee todo: ' + copia.resumen.lectura);
  await page.waitForTimeout(1100); // otro segundo: otro nombre
  const gCopia = mundo.spGets;
  await boton(page, 'Hacer una copia ahora').click();
  await page.waitForFunction(n => window.SS.estado.copias && window.SS.estado.copias.length === n && !window.SS.estado.tarea, 2, { timeout: 60000 });
  copias = Array.from(mundo.archivos.values()).filter(a => a.ruta.startsWith('/copias/'));
  es(copias.length === 2 && copias[0].texto.length > 1000, 'una segunda copia no pisa la primera');
  const copia2 = JSON.parse(copias[1].texto);
  es(mundo.spGets - gCopia <= 2 && /playlists releídas 0, sin cambios 10; likes sin cambios; 2 peticiones a Spotify/.test(copia2.resumen.lectura), 'la segunda lectura solo comprueba: ' + (mundo.spGets - gCopia) + ' peticiones (' + copia2.resumen.lectura + ')');
  es(JSON.stringify(copia2.playlists) === JSON.stringify(copia.playlists) && JSON.stringify(copia2.likes) === JSON.stringify(copia.likes), 'y la copia hecha con lo guardado es idéntica a la leída entera');
  await foto(page, 'copia' + sufijo);

  // --- simulación del botón A ---
  const busAntes = mundo.busquedas;
  await simula(page);
  let n = await numeros(page);
  const E = D.esperado;
  const nA = Object.keys(E.add).length, nD = Object.keys(E.duda).length, nN = E.no.length, nY = E.ya.length;
  // recuento respecto al de partida: (se añadirían, dudosas, no están, ya están)
  const cuadra = (n, a, d, no, y) => n.add === nA + a && n.duda === nD + d && n.no === nN + no && n.ya === nY + y;
  es(cuadra(n, 0, 0, 0, 0), 'recuento de la simulación: ' + JSON.stringify(n));
  let est = await estados(page);
  es(est.length === E.unicas, 'canciones distintas: ' + est.length);
  const de = k => est.find(x => x.n === D.R[k].name);
  for (const k of Object.keys(E.add)) es(de(k).e === 'add' && de(k).sp === D.cat[E.add[k]].id, 'se añadiría ' + E.add[k] + ' para ' + k);
  for (const k of Object.keys(E.duda)) es(de(k).e === 'duda' && de(k).sp === D.cat[E.duda[k]].id, 'dudosa ' + k);
  for (const k of E.no) es(de(k).e === 'no', 'no está ' + k);
  for (const k of E.ya) es(de(k).e === 'ya', 'ya está ' + k);
  es(!est.find(x => x.n === 'Algo de SoundCloud') && !est.find(x => x.n === 'Canción Vieja'), 'no entra lo de SoundCloud ni lo de fuera de New School');
  es(/Sin Extended en Spotify: se usa la Original/.test(de('paper').nota), 'anota cuando no hay Extended');
  es(de('larga').sp === D.cat.largaExt.id, 'si la de Spotify sale más de un minuto más corta, busca la Extended a propósito y se queda con ella');
  es(/Artista con una letra distinta \(martan \/ marten\)/.test(de('wait').nota), 'una letra distinta en el artista: segura, con nota');
  es((await page.evaluate(() => window.SS.estado.cont.ext)) >= 2, 'búsquedas de Extended hechas');
  es(mundo.busquedas > busAntes && mundo.busquedas - busAntes < 70, 'búsquedas hechas: ' + (mundo.busquedas - busAntes));
  es(mundo.sp429 === 0, 'en el uso normal Spotify no corta');
  t = await cuerpo(page);
  es(/1 playlist de rekordbox sin pareja en Spotify/.test(t), 'avisa de la playlist sin pareja');
  es(/no se ha cambiado nada en Spotify/.test(t), 'dice que es una simulación');
  const mapa = await page.evaluate(() => { const o = {}; document.querySelectorAll('.mapa select').forEach(s => { o[s.getAttribute('aria-label')] = s.options[s.selectedIndex].textContent; }); return o; });
  es(mapa['Playlist de Spotify para Raw/UK Garage'] === 'NS - Raw / UK Garage' && mapa['Playlist de Spotify para ALL'] === 'OG - All', 'el mapa empareja por nombre');
  es(/Sin pareja \(esperada: NS - Chill\)/.test(mapa['Playlist de Spotify para Chill']), 'dice qué nombre espera para la que falta');
  es(await page.locator('.mapa select option', { hasText: 'Lista ajena' }).count() === 0, 'en el mapa solo se pueden elegir playlists propias');
  await foto(page, 'simulacion' + sufijo);

  // el cobalt está en NS/House y en OG/ALL: iría a las dos
  await page.locator('.filtro.cat-add').click();
  const filaCobalt = page.locator('.fila.cat-add', { hasText: 'Cobalt Avenue (Extended Mix)' });
  es(/Iría a: NS - House, OG - All/.test(await filaCobalt.innerText()), 'una Old Gem que también está en New School va a las dos playlists');
  es(/Cobalt Avenue - Extended Mix/.test(await filaCobalt.innerText()), 'enseña la versión de Spotify elegida');
  // las seguras con aviso van arriba, y primero la que en Spotify dura más que el archivo
  const orden = await page.evaluate(() => Array.from(document.querySelectorAll('.lista:not(.mapa) > li')).map(li => (li.classList.contains('corte') ? 'corte:' + li.textContent : (li.querySelector('.fila-nota') ? 'aviso:' : 'limpia:') + li.querySelector('.fila-titulo').textContent)));
  const iCorte = orden.findIndex(x => /^corte:Sin aviso/.test(x)), nAv = iCorte - 1;
  es(orden[0] === 'corte:Con aviso: ' + nAv && nAv > 0 && orden.slice(1, iCorte).every(x => /^aviso:/.test(x)) && orden.slice(iCorte + 1).every(x => /^limpia:/.test(x)), 'las seguras con aviso van arriba, con un rótulo para cada grupo (' + orden[0] + ')');
  es(/^aviso:Selva Nord — Río Arriba/.test(orden[1]), 'la primera es la que en Spotify dura más que el archivo (' + orden[1] + ')');
  es((await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.corte')).fontSize))) >= 18, 'los rótulos de grupo se leen bien');
  const fRio = page.locator('.fila.cat-add', { hasText: 'Río Arriba' });
  es(await fRio.locator('a.app').getAttribute('href') === 'spotify:track:' + D.cat.rioLarga.id && (await fRio.locator('a.app').getAttribute('target')) === null && await fRio.locator('a.app').innerText() === 'Abrir en la app',
    'cada canción lleva un enlace que abre la app de Spotify en esa canción, sin pestaña nueva');
  es(await fRio.locator('a[href="https://open.spotify.com/track/' + D.cat.rioLarga.id + '"]').count() === 1, 'y al lado el enlace a la web');
  es(/Artista y título cambiados de sitio; la duración coincide/.test(await page.locator('.fila.cat-add', { hasText: 'Novia Techno Rara' }).innerText()), 'artista y título cambiados con la misma duración: segura, con nota');
  es(orden.findIndex(x => /No Puedo Esperar/.test(x)) < orden.findIndex(x => /Paper Lanterns/.test(x)), 'después las de texto ambiguo confirmado por la duración, y luego el resto de avisos');
  t = await cuerpo(page);
  es(new RegExp('Arriba van las ' + nAv + ' que llevan aviso').test(t) && new RegExp('Sin aviso: ' + (nA - nAv)).test(t), 'la lista dice cuántas llevan aviso');
  es(/«No es» descarta esa canción de Spotify para tu archivo/.test(t), 'y explica el «No es» de las seguras');
  // otra versión ya presente
  await page.locator('.filtro.cat-ya').click();
  es(/Es otra versión de la misma canción/.test(await page.locator('.fila.cat-ya', { hasText: 'Radio Silence' }).innerText()), 'otra versión en la playlist cuenta como ya está y se dice');

  // --- «No es» en lo que la app daba por bueno ---
  // una que «ya está»: deja de contar, y se puede deshacer
  await page.locator('.fila.cat-ya', { hasText: 'Radio Silence' }).getByRole('button', { name: 'No es', exact: true }).click();
  n = await numeros(page);
  es(cuadra(n, 0, 0, 1, -1), '«No es» en una que ya está: deja de contar como que está: ' + JSON.stringify(n));
  es(/Descartada\. «Radio Silence \(Extended Mix\)» pasa a «No están en Spotify»; ahí puedes deshacerlo/.test(await cuerpo(page)), 'y dice adónde ha ido');
  await page.locator('.filtro.cat-no').click();
  await page.locator('.fila.cat-no', { hasText: 'Radio Silence' }).getByRole('button', { name: 'Deshacer mi respuesta', exact: true }).click();
  n = await numeros(page);
  es(cuadra(n, 0, 0, 0, 0), 'y al deshacerlo vuelve a estar: ' + JSON.stringify(n));
  // una segura: pasa a preguntarse por la siguiente candidata; se deja así hasta después de recargar
  await page.locator('.filtro.cat-add').click();
  await page.locator('.fila.cat-add', { hasText: 'Mill Life Extra' }).getByRole('button', { name: 'No es', exact: true }).click();
  n = await numeros(page);
  es(cuadra(n, -1, 1, 0, 0), '«No es» en una segura la saca de «Se añadirían»: ' + JSON.stringify(n));
  es(/Descartada\. «Mill Life Extra» pasa a «Dudosas»/.test(await cuerpo(page)), 'y dice adónde ha ido');

  // --- dudosas: Añadir y No es ---
  await page.locator('.filtro.cat-duda').click();
  await foto(page, 'dudosas' + sufijo);
  es(/«Añadir» guarda tu respuesta y pasa la canción a «Se añadirían»; no cambia nada en Spotify hasta que sincronices/.test(await cuerpo(page)), 'explica que «Añadir» no escribe: solo guarda la respuesta');
  await page.locator('.fila.cat-duda', { hasText: 'Midnigth Train' }).getByRole('button', { name: 'Añadir', exact: true }).click();
  await page.locator('.fila.cat-duda', { hasText: 'Cumbia del Túnel' }).getByRole('button', { name: 'No es', exact: true }).click();
  n = await numeros(page);
  es(cuadra(n, 0, -1, 1, 0), 'tras responder dos dudosas: ' + JSON.stringify(n));
  // todas las candidatas a la vista y «Ninguna es»
  const fHumo = page.locator('.fila.cat-duda', { hasText: 'Vera Luz — Humo' });
  es(await fHumo.locator('.cand').count() === 4, 'una dudosa enseña todas sus candidatas, no solo tres');
  es(await page.locator('.fila.cat-duda', { hasText: 'Marea Baja' }).getByRole('button', { name: 'Ninguna es', exact: true }).count() === 0, 'con una sola candidata no hace falta «Ninguna es»');
  await fHumo.getByRole('button', { name: 'Ninguna es', exact: true }).click();
  n = await numeros(page);
  es(cuadra(n, 0, -2, 2, 0), '«Ninguna es» las descarta todas de una vez: ' + JSON.stringify(n));
  es(/«Humo» pasa a «No están en Spotify» y no se volverá a preguntar/.test(await cuerpo(page)), 'y dice qué ha pasado');
  es(/sin decir de quién/.test(await page.locator('.fila.cat-duda', { hasText: 'Veneno Remix' }).innerText()), 'remix sin nombre: sale como dudosa y lo explica');
  es(await page.locator('.fila.cat-duda', { hasText: 'Veneno Remix' }).locator('.cand').count() === 2 && /dura 6:02 en Spotify y 4:38 en rekordbox/.test(await page.locator('.fila.cat-duda', { hasText: 'Veneno Remix' }).innerText()), 'y enseña las dos mezclas, con la duración que no cuadra');
  es(/el artista se escribe con una letra distinta \(brandt \/ brendt\); dura 2:56 en Spotify y 6:21 en rekordbox/.test(await page.locator('.fila.cat-duda', { hasText: 'Marea Baja' }).innerText()), 'artista con una letra distinta y otra duración: se pregunta');
  es(await page.locator('.fila.cat-duda', { hasText: 'Mila Ros' }).locator('.cand').count() === 1, 'la misma candidata en dos discos se enseña una vez');
  await page.waitForFunction(() => true, null, { timeout: 1 }).catch(() => {});
  await page.waitForTimeout(2500); // la memoria se guarda sola al cabo de un momento
  const mem = JSON.parse(mundo.archivos.get('/memoria/memoria.json').texto);
  const clDis = Object.keys(mem.decisiones).find(k => /midnigth/.test(k)), clOpen = Object.keys(mem.decisiones).find(k => /cumbia/.test(k)), clHumo = Object.keys(mem.decisiones).find(k => /humo/.test(k));
  es(clDis && mem.decisiones[clDis].si === D.cat.conErrata.uri, 'la respuesta «Añadir» queda en la memoria de Dropbox');
  es(clOpen && mem.decisiones[clOpen].no[0] === D.cat.cumbia.uri && !mem.decisiones[clOpen].si, 'la respuesta «No es» queda en la memoria');
  es(clHumo && mem.decisiones[clHumo].nada === true && mem.decisiones[clHumo].no.length === 4, '«Ninguna es» queda en la memoria, con las cuatro descartadas');
  const clExtra = Object.keys(mem.decisiones).find(k => /mill life extra/.test(k)), clSil = Object.keys(mem.decisiones).find(k => /radio silence/.test(k));
  es(clExtra && mem.decisiones[clExtra].no.indexOf(D.cat.extra.uri) >= 0, 'el «No es» de una segura queda en la memoria');
  es(clSil && mem.decisiones[clSil].no.length === 0 && !mem.decisiones[clSil].si, 'y uno deshecho no deja nada');
  es(Object.keys(mem.pares).length >= 14, 'los emparejamientos seguros quedan apuntados (' + Object.keys(mem.pares).length + ')');
  es(mundo.archivos.has('/memoria/cache-busquedas.json'), 'la caché de búsquedas se guarda en Dropbox');
  es(!/acceso|refresco/.test(mundo.archivos.get('/memoria/memoria.json').texto), 'la memoria no lleva tokens');

  // --- recargar: todo sigue y no se vuelve a buscar ---
  const gRecarga = mundo.spGets;
  await page.reload();
  await page.waitForSelector('.cab');
  es(await page.locator('.pestana.activa').innerText() === 'A\nrekordbox a Spotify' || /rekordbox a Spotify/.test(await page.locator('.pestana.activa').innerText()), 'al recargar vuelve a la misma pestaña');
  await pestana(page, 'Cuentas');
  await page.waitForFunction(() => /Archivo: \/rekordbox\.xml/.test(document.body.innerText) && /como Prueba/.test(document.body.innerText), null, { timeout: 15000 });
  es(true, 'al recargar sigue conectado y vuelve a leer el XML solo');
  es(mundo.spGets === gRecarga, 'al cargar la página no se le pide nada a Spotify');
  const bus2 = mundo.busquedas;
  await simula(page);
  n = await numeros(page);
  es(cuadra(n, 0, -2, 2, 0), 'tras recargar, las respuestas siguen: ' + JSON.stringify(n));
  es(mundo.busquedas === bus2, 'la segunda simulación no repite búsquedas (caché): ' + (mundo.busquedas - bus2));
  es(mundo.spGets - gRecarga <= 2 && /Spotify leído el [^.]*: playlists releídas 0, sin cambios 10; likes sin cambios; 2 peticiones a Spotify/.test(await cuerpo(page)), 'una simulación tras recargar gasta 2 peticiones a Spotify en vez de releerlo todo (' + (mundo.spGets - gRecarga) + ')');
  est = await estados(page);
  es(est.find(x => x.n === 'Mill Life Extra').e === 'duda' && est.find(x => x.n === 'Mill Life Extra').sp === D.cat.xtra.id, 'la segura rechazada sigue rechazada tras recargar y simular');
  await page.locator('.filtro.cat-duda').click();
  await page.locator('.fila.cat-duda', { hasText: 'Mill Life Extra' }).getByRole('button', { name: 'Deshacer mi respuesta', exact: true }).click();
  n = await numeros(page);
  es(cuadra(n, 1, -3, 2, 0), 'y al deshacerlo vuelve a «Se añadirían»: ' + JSON.stringify(n));
  es(est.find(x => x.n === 'Humo').e === 'no', 'la de «Ninguna es» sigue sin preguntarse tras recargar y simular');
  await page.locator('.filtro.cat-no').click();
  const fHumoNo = page.locator('.fila.cat-no', { hasText: 'Vera Luz — Humo' });
  es(/Dijiste que ninguna de las de Spotify es la tuya/.test(await fHumoNo.innerText()), 'en «No están» recuerda que dijiste que ninguna');
  es(await fHumoNo.locator('a.app').getAttribute('href') === 'spotify:search:' + encodeURIComponent('Vera Luz Humo'), 'y la búsqueda también se puede abrir en la app');
  await fHumoNo.getByRole('button', { name: 'Deshacer mi respuesta', exact: true }).click();
  n = await numeros(page);
  es(cuadra(n, 1, -2, 1, 0), 'y se puede deshacer: vuelve a preguntarse: ' + JSON.stringify(n));
  await page.locator('.filtro.cat-add').click();
  es(/Confirmada por ti/.test(await page.locator('.fila.cat-add', { hasText: 'Midnigth Train' }).innerText()), 'la confirmada por ti se distingue');
  await page.locator('.fila.cat-add', { hasText: 'Midnigth Train' }).getByRole('button', { name: 'Deshacer mi respuesta', exact: true }).click();
  n = await numeros(page);
  es(cuadra(n, 0, -1, 1, 0), 'se puede deshacer una respuesta: ' + JSON.stringify(n));
  await page.locator('.filtro.cat-duda').click();
  await page.locator('.fila.cat-duda', { hasText: 'Mila Ros' }).getByRole('button', { name: 'No es', exact: true }).click();
  n = await numeros(page);
  es(cuadra(n, 0, -2, 2, 0), 'un solo «No es» descarta también la copia idéntica: ' + JSON.stringify(n));

  // --- cambiar el mapa a mano ---
  await page.locator('select[aria-label="Playlist de Spotify para Chill"]').selectOption({ label: 'VARIOS - Otra' });
  await page.waitForFunction(() => !window.SS.estado.sim);
  es(/Las 6 playlists de rekordbox tienen pareja/.test(await cuerpo(page)), 'el mapa se puede cambiar a mano');
  await page.locator('select[aria-label="Playlist de Spotify para Chill"]').selectOption({ index: 0 });
  await page.waitForFunction(() => /1 playlist de rekordbox sin pareja/.test(document.body.innerText));
  await simula(page);
  n = await numeros(page);
  es(cuadra(n, 0, -2, 2, 0) && mundo.busquedas === bus2, 'tras tocar el mapa se simula de nuevo sin búsquedas nuevas: ' + JSON.stringify(n));

  // --- solo se relee lo que cambia ---
  const plT = D.playlists.find(p => p.name === 'NS - Techno'), snapT = plT.snapshot_id, itemsAntes = Object.assign({}, mundo.itemsDe);
  plT.pistas.push({ added_at: '2026-11-22T10:00:00Z', t: D.cat.likeViejo }); plT.snapshot_id = snapT + 'b';
  D.likes.unshift({ added_at: '2026-11-22T11:00:00Z', t: D.cat.s3 });
  let g0 = mundo.spGets, lec;
  try {
    await simula(page, 'Simular leyendo Spotify de nuevo');
    lec = await page.evaluate(() => window.SS.estado.lib.lectura);
    es(lec.releidas === 1 && lec.iguales === 9 && lec.likes === '1 nuevo', 'tras cambiar una playlist y dar un like, solo se relee esa playlist y el like nuevo: ' + JSON.stringify(lec));
    es(Object.keys(mundo.itemsDe).filter(id => mundo.itemsDe[id] !== (itemsAntes[id] || 0)).join() === plT.id && mundo.spGets - g0 === 3, 'a Spotify solo se le pide la lista, esa playlist y la primera página de likes (' + (mundo.spGets - g0) + ' peticiones)');
    es((await page.evaluate(() => window.SS.estado.lib.likes.length)) === D.likes.length && (await page.evaluate(id => window.SS.estado.lib.playlists.find(p => p.id === id).items.length, plT.id)) === plT.pistas.length, 'y lo leído queda completo');
  } finally { plT.pistas.pop(); plT.snapshot_id = snapT; D.likes.shift(); } // los datos de prueba son comunes a los tres flujos
  await simula(page, 'Simular leyendo Spotify de nuevo');
  lec = await page.evaluate(() => window.SS.estado.lib.lectura);
  es(lec.releidas === 1 && lec.likes === 'releídos', 'si desaparece un like se releen los likes enteros: ' + JSON.stringify(lec));
  n = await numeros(page);
  es(cuadra(n, 0, -2, 2, 0) && mundo.busquedas === bus2, 'y la simulación vuelve a dar lo mismo, sin búsquedas nuevas: ' + JSON.stringify(n));

  // --- botón C ---
  await pestana(page, 'Sin repartir');
  await boton(page, 'Calcular').click();
  await page.waitForFunction(() => !!window.SS.estado.c && !window.SS.estado.tarea, null, { timeout: 60000 });
  let filas = await page.evaluate(() => window.SS.estado.c.filas.map(f => ({ id: f.id, o: f.origenes.join('+') })));
  es(filas.length === 3 && E.sinRepartir.every(k => filas.find(f => f.id === D_cat(k))), 'sin repartir: ' + filas.length);
  function D_cat(k) { return D.cat[k].id; }
  es(filas.find(f => f.id === D.cat.s2.id).o === 'Like+Try' && filas.find(f => f.id === D.cat.s1.id).o === 'Down' && filas.find(f => f.id === D.cat.like1.id).o === 'Like', 'cada canción lleva su origen');
  t = await cuerpo(page);
  es(/3 sin repartir/.test(t) && /Cuenta como repartido lo que está en: NS - House/.test(t), 'dice qué playlists cuentan como repartidas');
  es(!/Favorita Ya Repartida/.test(t.split('3 sin repartir')[1] || ''), 'lo que ya está en una NS no sale');
  es(!/Like Antiguo/.test(t) && !/Faro Azul/.test(t), 'no salen los likes anteriores a la fecha ni otra versión de una ya repartida');
  await foto(page, 'sin-repartir' + sufijo);
  await page.locator('.fila', { hasText: 'Solo Me Gusta' }).getByRole('button', { name: 'Ocultar', exact: true }).click();
  es(/2 sin repartir/.test(await cuerpo(page)), 'Ocultar quita la canción de la lista');
  await boton(page, 'Ver la oculta').click();
  es(await page.locator('.fila', { hasText: 'Solo Me Gusta' }).count() === 1, 'las ocultas se pueden ver');
  await boton(page, 'Ver las que no están ocultas').click();
  // cambiar la fecha: entran los likes de julio (70 de relleno) y el de agosto
  await page.locator('input[type="date"]').fill('2026-07-01');
  await page.waitForFunction(() => window.SS.estado.c && window.SS.estado.c.desde === '2026-07-01');
  es((await page.evaluate(() => window.SS.estado.c.filas.length)) === 74, 'la fecha de los likes es ajustable');
  await page.locator('input[type="date"]').fill('2026-09-01');
  await page.waitForTimeout(2500);
  const mem2 = JSON.parse(mundo.archivos.get('/memoria/memoria.json').texto);
  es(mem2.ocultas[D.cat.like1.uri] && mem2.ocultas[D.cat.like1.uri].o === true, 'lo oculto queda en la memoria');
  es(!mem2.decisiones[clDis].si && mem2.decisiones[clOpen] && mem2.decisiones[clOpen].no.length === 1 && mem2.decisiones[clHumo].nada === false, 'la memoria se actualiza sin perder lo anterior');
  const usoMem = Object.keys(mem2.uso || {});
  es(usoMem.length === 1 && /^\d{4}-\d\d-\d\d\|/.test(usoMem[0]) && mem2.uso[usoMem[0]].n > 10 && mem2.uso[usoMem[0]].n <= mundo.spGets, 'las peticiones del día quedan apuntadas en la memoria común (' + (usoMem[0] && mem2.uso[usoMem[0]].n) + ')');

  // --- diagnóstico ---
  await pestana(page, 'Diagnóstico');
  const diag = await page.locator('#diag').inputValue();
  es(/Permiso de escritura en este dispositivo: sí/.test(diag) && /Sincronización: sin hacer/.test(diag) && /fase 2, etapa 1/.test(diag), 'el diagnóstico dice si hay permiso de escritura y si se ha sincronizado');
  es(/SynchroSound 0\.4\.0/.test(diag) && /buscador v5/.test(diag) && /escrituras enviadas: 0/.test(diag) && /Simulación/.test(diag) && diag.indexOf('Dudosas (' + (nD - 2) + ')') >= 0, 'el diagnóstico lleva versión, recuentos y dudosas');
  const usoLs = await page.evaluate(() => JSON.parse(localStorage.getItem('ss.uso')).n);
  es(usoLs === mundo.spGets && diag.indexOf('Peticiones a Spotify hoy: ' + usoLs + ' entre todos tus dispositivos (este: ' + usoLs + ')') >= 0, 'el contador del día coincide con lo que ha recibido Spotify (' + usoLs + ' y ' + mundo.spGets + ')');
  es(/; \d+ peticiones a Spotify\n  playlists releídas: «NS - Techno»\n/.test(diag), 'el diagnóstico dice qué playlists se han releído');
  es(/Último corte de Spotify: ninguno apuntado/.test(diag) && /XML: \/rekordbox\.xml \(\d+ KB\), último cambio 23\/11\/2026 14:05, comprobado \d\d:\d\d/.test(diag), 'el diagnóstico dice si ha habido cortes y de cuándo es el XML');
  es(diag.indexOf('Se añadirían (' + nA + '):') >= 0 && Object.keys(E.add).every(k => diag.indexOf(D.R[k].name) >= 0), 'el diagnóstico lista todas las que se añadirían');
  es(/Se añadirían \(\d+\):\n  con aviso \d+, que van primero[^\n]*\n  r3 Selva Nord — Río Arriba \[3:34\] -> Selva Nord — Río Arriba \[5:01\] \| dura 5:01 en Spotify y 3:34 en rekordbox/.test(diag), 'y las ordena igual que la pantalla, con su nivel de aviso');
  es(/\? Grupo Luna, Hermanos Jota — Veneno - Remix \[6:02\] p=\d+ t=exact a=letra v=sin-nombre/.test(diag), 'el diagnóstico dice por qué una pareja ambigua es dudosa');
  es(/RB Mira Sol — Open Water \(Juno Park Remix\) \[5:40\][^\n]*\n     ~ Mira Sol — Open Water \[5:38\] t=exact a=fuerte v=falta-remix/.test(diag), 'un remix de otra persona con solo la original en Spotify va a «No están», y el diagnóstico lo enseña');
  es(diag.indexOf('Ya están (' + nY + '):') >= 0 && /Radio Silence.*otra versión/.test(diag), 'el diagnóstico lista las que ya están');
  es(diag.indexOf('No están (' + (nN + 2) + ')') >= 0 && /~ Banda Equis — B\.E\.S\.O\.S \[5:15\] t=exact a=sin v=falta-remix/.test(diag), 'el diagnóstico enseña lo más parecido a las que no están y por qué no valió');
  const secretos = await page.evaluate(() => [window.SS.estado.sp.a, window.SS.estado.sp.r, window.SS.estado.db.a, window.SS.estado.db.r]);
  es(secretos.every(s => s && diag.indexOf(s) < 0) && !/refresco-secreto|acceso-\d/.test(diag), 'el diagnóstico no lleva tokens');
  es(diag.indexOf('usuario_prueba') < 0 && diag.indexOf('ejemplo.test') < 0, 'el diagnóstico no lleva el usuario ni el correo');
  await boton(page, 'Copiar').click();
  const porta = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (porta !== null) es(porta.indexOf('SynchroSound 0.4.0') === 0, 'el botón Copiar copia el diagnóstico');
  await foto(page, 'diagnostico' + sufijo);

  // --- el candado ---
  await page.locator('.candado').click();
  t = await page.locator('.candado-panel').innerText();
  es(/0 escrituras/.test(t) && t.indexOf(PEDIDOS.split(' ').join(', ')) >= 0, 'el panel del indicador enseña permisos y escrituras');
  es(/solo deja salir una cosa: añadir canciones al final de tus playlists «NS - …» y «OG - …» del mapa/.test(t) && /ya no es Spotify quien impide/.test(t) && /user-library-modify/.test(t), 'y dice qué es lo único que puede escribir, quién lo garantiza ahora y que los likes no se pueden tocar');
  es(/Peticiones a Spotify hoy: \d+ entre todos tus dispositivos/.test(t), 'y cuántas peticiones a Spotify se llevan hoy');

  // --- la puerta: aun con el permiso de escritura concedido, nada que no sea GET sale hacia Spotify ---
  const antes = mundo.peticiones.length;
  const idH = D.playlists.find(p => p.name === 'NS - House').id, uriX = D.cat.like1.uri;
  const intentos = [
    ['POST', '/playlists/x/items'], ['PUT', '/playlists/x/items'], ['DELETE', '/playlists/x/items'], ['PATCH', '/playlists/x/items'],
    ['POST', '/playlists/' + idH + '/items', { cuerpo: { uris: [uriX] } }],
    ['PUT', '/playlists/' + idH + '/items', { cuerpo: { uris: [uriX] } }],
    ['DELETE', '/playlists/' + idH + '/items', { cuerpo: { items: [{ uri: uriX }] } }],
    ['PUT', '/playlists/' + idH, { cuerpo: { name: 'Otro nombre' } }],
    ['POST', '/me/playlists', { cuerpo: { name: 'Nueva' } }],
    ['PUT', '/me/tracks', { cuerpo: { ids: ['x'] } }], ['DELETE', '/me/tracks', { cuerpo: { ids: ['x'] } }],
    ['HEAD', '/me'], ['get', '/me'],
  ];
  for (const it of intentos) es(/^Bloqueado/.test(await intenta(page, it)), 'la app corta un ' + it[0] + ' ' + it[1].replace(idH, '<playlist>') + ' antes de que salga');
  es(mundo.peticiones.length === antes && mundo.escrituras.length === 0, 'los intentos bloqueados no llegan a la red');
  es((await page.evaluate(() => window.SS.estado.cont.spBloqueadas)) === intentos.length && (await page.evaluate(() => window.SS.estado.cont.spEscr)) === 0, 'y quedan contados como bloqueados, no como enviados');

  // --- ancho de pantalla ---
  for (const v of ['Cuentas', 'rekordbox a Spotify', 'Sin repartir', 'Copia', 'Diagnóstico']) {
    await pestana(page, v);
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    es(desborda <= 1, 'la pantalla «' + v + '» no se sale de ancho (' + desborda + ' px)');
  }

  // --- resumen de red ---
  const sp = mundo.peticiones.filter(p => p.host === 'api.spotify.com');
  const noGet = sp.filter(p => p.metodo !== 'GET' && p.metodo !== 'OPTIONS');
  es(noGet.length === 0 && mundo.spotifyNoGet.length === 0, 'a Spotify no ha salido ninguna petición que no sea GET (' + noGet.length + ')');
  es(sp.filter(p => p.metodo === 'GET').length > 20, 'lecturas a Spotify: ' + sp.filter(p => p.metodo === 'GET').length);
  es(mundo.fuera.length === 0, 'ninguna petición a otros sitios: ' + mundo.fuera.join(' | '));
  const hosts = Array.from(new Set(mundo.peticiones.map(p => p.host))).sort().join(' ');
  es(hosts === 'accounts.spotify.com api.dropboxapi.com api.spotify.com content.dropboxapi.com santi7guti.github.io www.dropbox.com', 'solo habla con: ' + hosts);
  const permitidos = ['oauth2/token', 'files/list_folder', 'files/download', 'files/upload', 'files/get_metadata', 'users/get_current_account'];
  es(mundo.sp429 === 0, 'y Spotify no ha cortado en ningún momento');
  es(Array.from(mundo.dbEndpoints).every(e => permitidos.indexOf(e) >= 0 || e === '/oauth2/token'), 'Dropbox: solo listar, bajar y subir; nada de borrar ni mover (' + Array.from(mundo.dbEndpoints).join(', ') + ')');
  es(mundo.archivos.get('/rekordbox.xml').texto === xmlAntes && mundo.archivos.get('/rekordbox.xml').rev === revAntes, 'el XML de rekordbox no se ha tocado');
  es(Array.from(mundo.archivos.keys()).every(k => k === '/rekordbox.xml' || k === '/notas.txt' || k.startsWith('/copias/') || k.startsWith('/memoria/')), 'en Dropbox solo se escribe en copias/ y memoria/');
  es(consola.length === 0, 'sin errores en la consola: ' + consola.slice(0, 3).join(' | '));
  await ctx.close();
}

async function casos() {
  console.log('Casos sueltos');
  // vuelta con un state que no es el nuestro
  let x = await nuevo();
  await x.page.goto(SITIO + '?code=robado&state=sp.loquesea');
  await x.page.waitForSelector('.aviso.error');
  es(/no corresponde a lo que se pidió/.test(await cuerpo(x.page)) && !(await x.page.evaluate(() => window.SS.estado.sp)), 'una vuelta con otro state se rechaza y no guarda nada');
  es(x.page.url() === SITIO, 'y la dirección queda limpia');
  es(!x.mundo.peticiones.find(p => p.ruta === '/api/token'), 'ni siquiera se intenta canjear el código');
  await x.ctx.close();

  // el usuario dice que no
  x = await nuevo({ denegar: 'sp' });
  await conecta(x.page, 'Spotify');
  es(/Spotify no se ha conectado \(access_denied\)/.test(await cuerpo(x.page)), 'si se deniega el permiso, lo dice');
  await x.ctx.close();

  // Spotify concede más de lo pedido (tocar los likes): no se guarda
  x = await nuevo({ scopeSpotify: PEDIDOS + ' user-library-modify' });
  await conecta(x.page, 'Spotify');
  es(/permisos que esta versión no debe tener \(user-library-modify\)/.test(await cuerpo(x.page)), 'si Spotify concediese el permiso de tocar los likes, la conexión no se guarda');
  es(!(await x.page.evaluate(() => window.SS.estado.sp || localStorage.getItem('ss.sp'))), 'y no queda ningún token');
  await x.ctx.close();

  // token caducado: se renueva solo
  x = await nuevo();
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify');
  await x.page.waitForFunction(() => /como Prueba/.test(document.body.innerText), null, { timeout: 15000 }); // el nombre se pide una vez, al conectar
  await x.page.evaluate(() => { for (const k of ['ss.sp', 'ss.db']) { const t = JSON.parse(localStorage.getItem(k)); t.exp = Date.now() - 1000; localStorage.setItem(k, JSON.stringify(t)); } });
  await x.page.reload();
  await x.page.waitForFunction(() => /como Prueba/.test(document.body.innerText) && /como Cuenta de Prueba/.test(document.body.innerText), null, { timeout: 15000 });
  es(x.mundo.refrescos.db === 1 && x.mundo.refrescos.sp === 0, 'al recargar con los tokens caducados se renueva el de Dropbox y a Spotify no se le pide nada');
  await x.page.evaluate(() => window.SS.spotify('GET', '/me'));
  es(x.mundo.refrescos.sp === 1, 'y el de Spotify se renueva solo en la primera lectura');
  // token revocado en el servidor (401): también se renueva
  x.mundo.tokens.sp.clear(); x.mundo.tokens.db.clear();
  await eligeXml(x.page);
  es(x.mundo.refrescos.db === 2, 'ante un 401 de Dropbox renueva y reintenta');
  await x.ctx.close();

  // cuenta no dada de alta en la app de Spotify
  x = await nuevo({ prohibido: true });
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify');
  await x.page.waitForSelector('.aviso.error');
  es(/User Management/.test(await cuerpo(x.page)), 'un 403 de Spotify explica lo de User Management');
  await x.ctx.close();

  // archivo que no es de rekordbox
  x = await nuevo({ xml: '<?xml version="1.0"?><otra_cosa/>' });
  await conecta(x.page, 'Dropbox');
  await boton(x.page, 'Ver archivos de la carpeta').click();
  await boton(x.page, 'Usar este').click();
  await x.page.waitForSelector('.aviso.error');
  es(/no es un XML de rekordbox/.test(await cuerpo(x.page)), 'un XML que no es de rekordbox se rechaza');
  await x.ctx.close();

  // XML sin las carpetas esperadas
  x = await nuevo({ xml: '<?xml version="1.0"?><DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="0"></COLLECTION><PLAYLISTS><NODE Type="0" Name="ROOT" Count="0"></NODE></PLAYLISTS></DJ_PLAYLISTS>' });
  await conecta(x.page, 'Dropbox');
  await eligeXml(x.page);
  es(/no encuentro las carpetas/.test(await cuerpo(x.page)), 'un XML vacío avisa de que faltan las carpetas');
  await x.ctx.close();

  // a Dropbox le falta el permiso de listar
  x = await nuevo({ sinPermisoLista: true });
  await conecta(x.page, 'Dropbox');
  await boton(x.page, 'Ver archivos de la carpeta').click();
  await x.page.waitForSelector('.aviso.error');
  es(/le falta el permiso «files\.metadata\.read»/.test(await cuerpo(x.page)), 'si falta un permiso de Dropbox dice cuál');
  await x.ctx.close();

  // Spotify corta a media simulación sin decir motivo ni plazo: se para a la primera y no insiste
  x = await nuevo({ corte: { desde: 24 } });
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify'); await eligeXml(x.page);
  await simula(x.page);
  let t = await cuerpo(x.page);
  es(/Spotify ha cortado las peticiones de la app por haber hecho demasiadas\. No dice cuánto hay que esperar/.test(t), 'un corte de Spotify para la simulación y dice lo que se sabe, sin inventar un plazo');
  es(x.mundo.sp429 === 1, 'se para al primer 429, sin reintentar (' + x.mundo.sp429 + ')');
  es(/Simulación incompleta/.test(t), 'y lo ya resuelto se enseña como incompleto');
  es(x.mundo.archivos.has('/memoria/cache-busquedas.json') && x.mundo.archivos.has('/memoria/cache-biblioteca.json'), 'y lo buscado y lo leído hasta ahí quedan guardados');
  let g = x.mundo.spGets;
  await boton(x.page, 'Simular otra vez').click();
  await x.page.waitForFunction(() => !window.SS.estado.tarea);
  es(x.mundo.spGets === g && /No se ha enviado nada a Spotify/.test(await cuerpo(x.page)), 'mientras dura la guarda, volver a pulsar no envía nada a Spotify');
  es(await x.page.locator('.corte-sp').count() === 1, 'y el corte se ve en pantalla');
  x.mundo.opc.corte = null; // Spotify vuelve a dejar pasar
  await boton(x.page, 'Probar ahora (gasta 1 petición)').click();
  await x.page.waitForFunction(() => /Spotify vuelve a responder/.test(document.body.innerText) && !window.SS.estado.tarea);
  es(x.mundo.spGets === g + 1 && await x.page.locator('.corte-sp').count() === 0, 'la prueba a mano gasta una sola petición y, si va bien, quita el aviso');
  const pBus = x.mundo.peticiones.filter(p => p.host === 'api.spotify.com').slice(-1)[0];
  es(pBus.ruta === '/v1/search' && /limit=1/.test(pBus.q) && /[?&]q=[^&]+/.test(pBus.q), 'y prueba la llamada que se cortó (una búsqueda, con texto que buscar), no el perfil (' + pBus.ruta + pBus.q + ')');
  await simula(x.page, 'Simular otra vez');
  es(!(await x.page.evaluate(() => window.SS.estado.sim.incompleta)), 'y la simulación ya termina');
  await pestana(x.page, 'Diagnóstico');
  es(/Último corte de Spotify: [^\n]* en \/search; motivo: no lo dice; plazo: no legible; volvió a responder el /.test(await x.page.locator('#diag').inputValue()), 'el diagnóstico guarda cuándo cortó y cuándo volvió');
  await x.ctx.close();

  // corte mientras lee la biblioteca: lo leído se conserva y no se vuelve a pedir
  x = await nuevo({ corte: { desde: 6, cuota: true } });
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify'); await eligeXml(x.page);
  await pestana(x.page, 'rekordbox a Spotify');
  await boton(x.page, 'Simular').click();
  await x.page.waitForSelector('.aviso.error');
  t = await cuerpo(x.page);
  es(/se ha agotado la cuota del modo desarrollo/.test(t) && /Lo ya leído se conserva/.test(t), 'si es la cuota, lo dice con su nombre');
  es(x.mundo.sp429 === 1, 'también ahí se para al primer rechazo');
  const leidas = D.playlists.slice(0, 3).map(p => p.id);
  es(leidas.every(id => x.mundo.itemsDe[id] === 1), 'antes del corte había leído tres playlists');
  await pestana(x.page, 'Diagnóstico');
  es(/motivo: QUOTA_EXCEEDED; plazo: no legible; los botones no envían nada hasta [^\n]*\(la app nunca prueba sola\)/.test(await x.page.locator('#diag').inputValue()), 'y el diagnóstico apunta el motivo que da Spotify');
  x.mundo.opc.corte = null;
  await pestana(x.page, 'rekordbox a Spotify');
  await boton(x.page, 'Probar ahora (gasta 1 petición)').click();
  await x.page.waitForFunction(() => /Spotify vuelve a responder/.test(document.body.innerText) && !window.SS.estado.tarea);
  await simula(x.page);
  es(leidas.every(id => x.mundo.itemsDe[id] === 1) && !(await x.page.evaluate(() => window.SS.estado.sim.incompleta)), 'al seguir, las playlists ya leídas no se vuelven a pedir');
  await x.ctx.close();

  // corte parcial (Spotify corta por grupos de llamadas): el perfil responde y las playlists no
  x = await nuevo({ corte: { desde: 1, cuota: true, rutas: ['/me/playlists'] } });
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify'); await eligeXml(x.page);
  await x.page.waitForFunction(() => /como Prueba/.test(document.body.innerText), null, { timeout: 15000 });
  es(x.mundo.sp429 === 0, 'corte parcial: el perfil sí responde');
  await pestana(x.page, 'rekordbox a Spotify');
  await boton(x.page, 'Simular').click();
  await x.page.waitForSelector('.corte-sp');
  await x.page.waitForFunction(() => !window.SS.estado.tarea);
  es(x.mundo.sp429 === 1 && /se ha agotado la cuota/.test(await cuerpo(x.page)), 'las playlists dan 429 y se para');
  t = await x.page.locator('.corte-sp').innerText();
  es(/los botones no envían nada a Spotify/.test(t) && /La app no prueba sola/.test(t) && !/no lo intentará/.test(t), 'el aviso no da a entender que la app vaya a probar sola');
  es(/Prueba la misma llamada que rechazó Spotify \(\/me\/playlists\)/.test(t), 'y dice qué llamada se prueba');
  const aSp = () => x.mundo.peticiones.filter(p => p.host === 'api.spotify.com');
  let nSp = aSp().length;
  await boton(x.page, 'Probar ahora (gasta 1 petición)').click();
  await x.page.waitForFunction(() => !window.SS.estado.tarea);
  const pr = aSp().slice(nSp);
  es(pr.length === 1 && pr[0].ruta === '/v1/me/playlists' && pr[0].q === '?limit=1', '«Probar ahora» pide la llamada rechazada, con lo mínimo (' + pr.map(p => p.ruta + p.q).join(', ') + ')');
  es(x.mundo.sp429 === 2 && !/Spotify vuelve a responder/.test(await cuerpo(x.page)) && await x.page.locator('.corte-sp').count() === 1, 'si sigue cortada, no dice que Spotify ha vuelto y el aviso sigue');
  await x.page.evaluate(() => window.SS.spotify('GET', '/me', { aunque: true }));
  es(!(await x.page.evaluate(() => JSON.parse(localStorage.getItem('ss.corte')).fin)), 'que responda el perfil no termina un corte de las playlists');
  // el plazo escrito a mano
  const campo = x.page.locator('#retry-mano');
  es(await campo.count() === 1 && /F12 → Network → la última fila en rojo → Headers → Response headers → Retry-After/.test(await x.page.locator('.corte-sp').innerText()), 'el aviso lleva la casilla del plazo y cómo leerlo');
  await campo.fill('abc');
  await boton(x.page, 'Guardar plazo').click();
  es(/Escribe solo el número entero que pone en Retry-After/.test(await cuerpo(x.page)) && !(await x.page.evaluate(() => JSON.parse(localStorage.getItem('ss.corte')).mano)), 'un plazo que no es un número no se guarda');
  const lsCorte = () => x.page.evaluate(() => JSON.parse(localStorage.getItem('ss.corte')));
  const malos = ['', ' ', '0', '00', '-5', '+90', '9000s', 's9000', '1.5', '9.000', '9,000', '9 000', '1e3', '0x10', '604801', '9999999', '９０００'];
  const colados = [];
  for (const v of malos) {
    await campo.fill(v);
    await boton(x.page, 'Guardar plazo').click();
    if ((await lsCorte()).mano || await boton(x.page, 'Sí, es correcto').count()) colados.push(JSON.stringify(v));
  }
  es(colados.length === 0 && await x.page.locator('.corte-sp').count() === 1, 'no se guarda ni se reinterpreta nada que no sea un número entero de segundos entre 1 y 7 días (' + (colados.join(' ') || 'ninguno colado') + ')');
  await campo.fill(' 9600 ');
  await campo.press('Enter');
  es((await lsCorte()).mano && (await lsCorte()).mano.s === 9600 && /Según el plazo que escribiste/.test(await x.page.locator('.corte-sp').innerText()), 'la tecla Enter también guarda el plazo');
  // se puede corregir: mientras se escribe, la pantalla no se repinta; al soltar la casilla, sí
  await campo.fill('90');
  await x.page.evaluate(() => { window.SS.estado.candado = true; window.SS.pinta(); });
  es(await x.page.evaluate(() => !!document.activeElement && document.activeElement.id === 'retry-mano' && document.activeElement.value === '90') && await x.page.locator('.candado-panel').count() === 0, 'si la pantalla se repinta mientras se escribe, no se pierde lo escrito');
  await x.page.keyboard.type('00');
  await x.page.evaluate(() => document.activeElement.blur());
  await x.page.waitForTimeout(600);
  es(await x.page.locator('.candado-panel').count() === 1 && await campo.inputValue() === '9000', 'al soltar la casilla se hace la repintada pendiente, con lo escrito');
  // en el iPhone, tocar un botón no le quita el foco a un campo: la pantalla tiene que cambiar igual
  await campo.focus();
  await x.page.evaluate(() => Array.from(document.querySelectorAll('.pestana')).find(b => /Copia/.test(b.textContent)).click());
  es(/Copia completa de Spotify/.test(await cuerpo(x.page)) && /Copia/.test(await x.page.locator('.pestana.activa').innerText()), 'un botón pulsado con el foco aún en la casilla cambia la pantalla');
  // los demás botones tampoco envían nada durante el corte
  g = x.mundo.spGets;
  await boton(x.page, 'Hacer una copia ahora').click();
  await x.page.waitForFunction(() => !window.SS.estado.tarea);
  await pestana(x.page, 'Sin repartir');
  await boton(x.page, 'Leer Spotify y calcular').click();
  await x.page.waitForFunction(() => !window.SS.estado.tarea);
  es(x.mundo.spGets === g && !Array.from(x.mundo.archivos.keys()).some(k => k.startsWith('/copias/')), 'durante el corte, ni «Hacer una copia» ni «Leer Spotify y calcular» envían nada a Spotify');
  await pestana(x.page, 'rekordbox a Spotify');
  es(await campo.inputValue() === '9000', 'y lo escrito en la casilla sigue ahí al volver');
  await boton(x.page, 'Guardar plazo').click();
  const cm = await x.page.evaluate(() => JSON.parse(localStorage.getItem('ss.corte')));
  es(cm.mano && cm.mano.s === 9000 && cm.hasta === cm.t + 9000000 && cm.mano.hasta === cm.hasta, 'el plazo a mano cuenta desde la hora del rechazo, no desde que se escribe, y se puede corregir (9600 → 9000)');
  es(cm.e > 0, 'cada vez que se apunta el corte queda la hora en que se escribió');
  const hora = await x.page.evaluate(v => { const d = new Date(v), z = n => String(n).padStart(2, '0'); return z(d.getHours()) + ':' + z(d.getMinutes()); }, cm.hasta);
  t = await x.page.locator('.corte-sp').innerText();
  es(t.indexOf('Según el plazo que escribiste, Spotify vuelve a las ' + hora) >= 0 && t.indexOf('Hasta las ' + hora) >= 0 && /Guardado: Spotify vuelve a las /.test(await cuerpo(x.page)), 'y enseña la hora real (' + hora + ')');
  await x.page.waitForTimeout(1700);
  const memC = JSON.parse(x.mundo.archivos.get('/memoria/memoria.json').texto).ajustes.corteSp.v;
  es(memC.mano && memC.mano.s === 9000 && memC.hasta === cm.hasta, 'el plazo a mano queda en la memoria común, para el otro dispositivo');
  g = x.mundo.spGets;
  await boton(x.page, 'Simular').click();
  await x.page.waitForFunction(() => !window.SS.estado.tarea);
  es(x.mundo.spGets === g && /No se ha enviado nada a Spotify/.test(await cuerpo(x.page)), 'con el plazo a mano, los botones siguen sin enviar nada');
  await boton(x.page, 'Probar ahora (gasta 1 petición)').click();
  await x.page.waitForFunction(() => !window.SS.estado.tarea);
  const cm2 = await x.page.evaluate(() => JSON.parse(localStorage.getItem('ss.corte')));
  es(x.mundo.sp429 === 3 && cm2.t > cm.t && cm2.hasta === cm.hasta && cm2.mano && cm2.mano.s === 9000, 'un rechazo nuevo no acorta el plazo escrito a mano');
  es(await boton(x.page, 'Probar ahora (gasta 1 petición)').count() === 1, '«Probar ahora» sigue a la vista aunque haya plazo a mano');
  x.mundo.opc.corte = null;
  await boton(x.page, 'Probar ahora (gasta 1 petición)').click();
  await x.page.waitForFunction(() => /Spotify vuelve a responder a la llamada que había rechazado \(\/me\/playlists\)/.test(document.body.innerText) && !window.SS.estado.tarea);
  es(await x.page.locator('.corte-sp').count() === 0 && (await x.page.evaluate(() => JSON.parse(localStorage.getItem('ss.corte')).fin)) > 0, 'cuando la llamada rechazada responde, el corte se da por terminado');
  await pestana(x.page, 'Diagnóstico');
  es(/en \/me\/playlists; motivo: QUOTA_EXCEEDED; plazo: no legible; a mano: Retry-After 9000 s \(escrito el [^)]+\), vuelve el [^;]+; volvió a responder el /.test(await x.page.locator('#diag').inputValue()), 'el diagnóstico lleva el plazo escrito a mano y cuándo volvió');
  // un corte nuevo no hereda el plazo de uno que ya terminó
  x.mundo.opc.corte = { desde: 1, cuota: true, rutas: ['/me/playlists'] };
  await pestana(x.page, 'rekordbox a Spotify');
  await boton(x.page, 'Simular').click();
  await x.page.waitForSelector('.corte-sp');
  await x.page.waitForFunction(() => !window.SS.estado.tarea);
  const cm3 = await lsCorte();
  es(!cm3.mano && !cm3.fin && Math.abs(cm3.hasta - cm3.t - 3600000) < 5 && !/Según el plazo que escribiste/.test(await x.page.locator('.corte-sp').innerText()), 'un corte nuevo no hereda el plazo a mano de uno que ya terminó');
  // en la consola solo pueden estar los rechazos de Spotify que la prueba provoca; nada de fallos al pintar
  const raros = x.consola.filter(m => !/Límite de peticiones de Spotify/.test(m));
  es(raros.length === 0 && !/Error al pintar/.test(await cuerpo(x.page)), 'corte parcial sin errores propios en la consola: ' + raros.slice(0, 3).join(' | '));
  await x.ctx.close();

  // la casilla del plazo: pulsación lenta, plazo que ya ha pasado, aviso caducado y recarga
  x = await nuevo({ corte: { desde: 1, cuota: true, rutas: ['/me/playlists'] } });
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify'); await eligeXml(x.page);
  const lsC = () => x.page.evaluate(() => JSON.parse(localStorage.getItem('ss.corte')));
  const corta = async () => { await pestana(x.page, 'rekordbox a Spotify'); await boton(x.page, 'Simular').click(); await x.page.waitForSelector('.corte-sp'); await x.page.waitForFunction(() => !window.SS.estado.tarea); };
  await corta();
  const casilla = x.page.locator('#retry-mano');
  await casilla.fill('9000');
  await x.page.evaluate(() => window.SS.pinta()); // queda una repintada pendiente
  const caja = await boton(x.page, 'Guardar plazo').boundingBox();
  await x.page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await x.page.mouse.down();
  await x.page.waitForTimeout(700);
  await x.page.mouse.up();
  await x.page.waitForTimeout(300);
  es((await lsC()).mano && (await lsC()).mano.s === 9000, 'una pulsación lenta sobre «Guardar plazo» con una repintada pendiente no se pierde');
  // un plazo que ya habría pasado (p. ej. una errata) no suelta los botones sin preguntar
  await x.page.waitForTimeout(1100);
  await casilla.fill('1');
  await boton(x.page, 'Guardar plazo').click();
  t = await x.page.locator('.corte-sp').innerText();
  es(/Con 1 s, Spotify habría vuelto a [^,]+, que ya ha pasado\. Si el número está bien, los botones volverán a enviar ya\. ¿Es correcto\?/.test(t) && (await lsC()).mano.s === 9000, 'un plazo que ya habría pasado no se guarda sin preguntar');
  g = x.mundo.spGets;
  await boton(x.page, 'Corregir').click();
  es(await casilla.inputValue() === '1' && await boton(x.page, 'Sí, es correcto').count() === 0 && (await lsC()).mano.s === 9000, '«Corregir» vuelve a la casilla con lo escrito, sin guardar nada');
  await boton(x.page, 'Guardar plazo').click();
  await boton(x.page, 'Sí, es correcto').click();
  es((await lsC()).mano.s === 1 && await x.page.locator('.corte-sp').count() === 0 && /los botones ya vuelven a enviar/.test(await cuerpo(x.page)) && x.mundo.spGets === g, 'confirmado, se guarda, lo dice y la app no envía nada por su cuenta');
  await corta();
  es(x.mundo.spGets === g + 1 && !(await lsC()).mano, 'después los botones vuelven a enviar; y un plazo ya vencido no pasa al rechazo siguiente');
  // el aviso sigue en pantalla pero la espera de la app ya terminó: el plazo aún se puede escribir
  await x.page.evaluate(() => { const c = JSON.parse(localStorage.getItem('ss.corte')); c.hasta = Date.now() - 1; localStorage.setItem('ss.corte', JSON.stringify(c)); });
  await casilla.fill('9000');
  await boton(x.page, 'Guardar plazo').click();
  const cV = await lsC();
  es(cV.mano && cV.mano.s === 9000 && cV.hasta === cV.t + 9000000 && /Según el plazo que escribiste/.test(await x.page.locator('.corte-sp').innerText()), 'con la espera de la app ya vencida y el aviso aún en pantalla, el plazo se guarda y vuelve a frenar');
  // si ese corte ya terminó, lo dice en vez de no hacer nada
  await x.page.evaluate(() => { const c = JSON.parse(localStorage.getItem('ss.corte')); c.fin = Date.now(); c.e = Date.now(); localStorage.setItem('ss.corte', JSON.stringify(c)); });
  await casilla.fill('9000');
  await boton(x.page, 'Guardar plazo').click();
  es(/Ya no hay ningún corte de Spotify pendiente/.test(await cuerpo(x.page)) && await x.page.locator('.corte-sp').count() === 0, 'y si el corte ya terminó, «Guardar plazo» lo dice y quita el aviso');
  // recargar justo después de guardar: el plazo no se queda solo en este dispositivo
  await corta();
  await x.page.waitForTimeout(1800); // que suba el corte nuevo
  await casilla.fill('9000');
  await boton(x.page, 'Guardar plazo').click();
  await x.page.reload();
  const enMem = () => JSON.parse(x.mundo.archivos.get('/memoria/memoria.json').texto).ajustes.corteSp.v;
  const antesDeSubir = !!enMem().mano;
  await x.page.waitForFunction(() => !!(window.SS && window.SS.estado.memLista), null, { timeout: 15000 });
  await x.page.waitForTimeout(2500);
  es(!antesDeSubir && enMem().mano && enMem().mano.s === 9000 && enMem().t === (await lsC()).t, 'si se recarga antes de que el plazo suba a Dropbox, se sube al volver a cargar');
  const raros2 = x.consola.filter(m => !/Límite de peticiones de Spotify/.test(m));
  es(raros2.length === 0 && !/Error al pintar/.test(await cuerpo(x.page)), 'la casilla, sin errores propios en la consola: ' + raros2.slice(0, 3).join(' | '));
  await x.ctx.close();

  // un corte guardado sin la llamada (datos ajenos): se prueba la lista de playlists y esa prueba lo cierra
  x = await nuevo();
  await x.page.evaluate(() => localStorage.setItem('ss.corte', JSON.stringify({ t: Date.now() - 1000, cuota: true, motivo: 'QUOTA_EXCEEDED', espera: null, hasta: Date.now() + 3600000 })));
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify');
  await x.page.waitForSelector('.corte-sp');
  es(await x.page.locator('.aviso.error').count() === 0 && x.mundo.spGets === 0, 'conectar Spotify durante un corte no pide nada ni deja un aviso de error');
  t = await x.page.locator('.corte-sp').innerText();
  es(/Prueba la misma llamada que rechazó Spotify \(\/me\/playlists\)/.test(t) && !/undefined/.test(await cuerpo(x.page)) && !/undefined/.test(await x.page.evaluate(() => window.SS.diagnostico())), 'un corte sin la llamada apuntada no enseña «undefined»');
  await boton(x.page, 'Probar ahora (gasta 1 petición)').click();
  await x.page.waitForFunction(() => !window.SS.estado.tarea);
  const pSin = x.mundo.peticiones.filter(p => p.host === 'api.spotify.com').slice(-1)[0];
  es(pSin.ruta === '/v1/me/playlists' && pSin.q === '?limit=1' && (await x.page.evaluate(() => JSON.parse(localStorage.getItem('ss.corte')).fin)) > 0 && await x.page.locator('.corte-sp').count() === 0, 'y «Probar ahora» lo cierra aunque no se sepa qué llamada era');
  await x.ctx.close();

  // el mismo corte visto desde dos dispositivos: el plazo a mano y el «fin» del otro se ven aquí
  x = await nuevo();
  const T = Date.now() - 600000;
  const base = { t: T, cuota: true, motivo: 'QUOTA_EXCEEDED', espera: null, hasta: T + 3600000, ruta: '/me/playlists', e: T };
  const mano = { s: 9000, t: T + 60000, hasta: T + 9000000 };
  const memCon = v => JSON.stringify({ v: 1, mapa: {}, soundeo: {}, decisiones: {}, ocultas: {}, pares: {}, ajustes: { corteSp: { v, t: v.e } }, uso: {} });
  const ponLs = c => x.page.evaluate(v => localStorage.setItem('ss.corte', JSON.stringify(v)), c);
  await ponLs(base);
  x.mundo.pon('/memoria/memoria.json', memCon(Object.assign({}, base, { hasta: mano.hasta, mano, e: T + 60000 })));
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify');
  await x.page.waitForSelector('.corte-sp');
  // el aviso sale primero con lo de este navegador; lo de la memoria común llega al cargarla
  await x.page.waitForFunction(() => window.SS.estado.memLista && /Según el plazo que escribiste/.test((document.querySelector('.corte-sp') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => {});
  es(/Según el plazo que escribiste/.test(await x.page.locator('.corte-sp').innerText()) && x.mundo.spGets === 0, 'el plazo escrito en el otro dispositivo sobre el mismo corte se ve aquí');
  x.mundo.pon('/memoria/memoria.json', memCon(Object.assign({}, base, { hasta: mano.hasta, mano, fin: T + 120000, e: T + 120000 })));
  await x.page.reload();
  await x.page.waitForFunction(() => !!(window.SS && window.SS.estado.memLista), null, { timeout: 15000 });
  es(await x.page.locator('.corte-sp').count() === 0, 'y si el otro dispositivo vio que Spotify había vuelto, aquí tampoco frena');
  await ponLs(Object.assign({}, base, { fin: T + 120000, e: T + 120000 }));
  x.mundo.pon('/memoria/memoria.json', memCon(Object.assign({}, base, { hasta: mano.hasta, mano, e: T + 180000 })));
  await x.page.reload();
  await x.page.waitForFunction(() => !!(window.SS && window.SS.estado.memLista), null, { timeout: 15000 });
  es(await x.page.locator('.corte-sp').count() === 0 && /volvió a responder el /.test(await x.page.evaluate(() => window.SS.diagnostico())), 'un «fin» apuntado aquí no se pierde aunque el otro escribiera después sobre el mismo corte');
  // con el plazo ya pasado, una llamada que responde solo cierra el corte si es la misma ruta
  const ya = await x.page.evaluate(() => Date.now());
  await ponLs({ t: ya - 300000, cuota: true, motivo: 'QUOTA_EXCEEDED', espera: null, hasta: ya - 60000, ruta: '/playlists/otra/items', e: ya - 300000 });
  es(/en \/playlists\/otra\/items; [^\n]*; la espera terminó a las \d\d:\d\d; todavía no se ha visto responder a esa llamada/.test(await x.page.evaluate(() => window.SS.diagnostico())), 'el diagnóstico de un corte con la espera vencida no habla en presente');
  await x.page.evaluate(() => window.SS.spotify('GET', '/me'));
  await x.page.evaluate(() => window.SS.spotify('GET', '/me/playlists?limit=1'));
  es(!(await x.page.evaluate(() => JSON.parse(localStorage.getItem('ss.corte')).fin)), 'que respondan el perfil o la lista de playlists no termina un corte de otra llamada');
  await x.page.evaluate(id => window.SS.spotify('GET', '/playlists/' + id + '/items?limit=1'), D.playlists.find(p => p.owner.id === D.YO.id).id);
  es((await x.page.evaluate(() => JSON.parse(localStorage.getItem('ss.corte')).fin)) > 0, 'sí lo termina que responda esa misma llamada (aunque sea de otra playlist)');
  // las reglas para unir el corte de este navegador con el de la memoria común, una a una
  const U = await x.page.evaluate(() => {
    const u = window.SS.uneCortes, t = 1000000, m = { s: 50, t: t + 5, hasta: t + 50000 }, r = {};
    const A = { t, hasta: t + 10000, ruta: '/me/playlists', e: t }, con = o => Object.assign({}, A, o);
    r['sin nada o con uno solo'] = u(null, null) === null && u(A, null) === A && u(null, A) === A && u({}, A) === A;
    r['de dos rechazos manda el más reciente'] = u(A, { t: t + 1, hasta: t + 20000 }).t === t + 1 && u({ t: t + 1, hasta: t + 20000 }, A).t === t + 1;
    const h1 = u(con({ mano: m, hasta: m.hasta }), { t: t + 1, hasta: t + 20000, e: t + 1 });
    r['un rechazo nuevo conserva el plazo a mano que acaba más tarde'] = h1.t === t + 1 && h1.hasta === m.hasta && h1.mano.s === 50;
    const h2 = u(con({ mano: m, hasta: m.hasta, fin: t + 9 }), { t: t + 1, hasta: t + 20000 });
    r['no lo conserva si aquel corte ya terminó'] = !h2.mano && h2.hasta === t + 20000;
    const h3 = u(con({ mano: m, hasta: m.hasta }), { t: t + 1, hasta: t + 90000 });
    r['ni si el plazo a mano acaba antes'] = !h3.mano && h3.hasta === t + 90000;
    const h4 = u(con({ mano: m, hasta: m.hasta }), { t: t + 1, hasta: t + 20000, fin: t + 30 });
    r['ni si el rechazo nuevo ya terminó'] = !h4.mano && h4.fin === t + 30;
    r['mismo rechazo: gana lo último escrito'] = !!u(con({ e: t + 2, mano: m, hasta: m.hasta }), con({ e: t + 1 })).mano && !!u(con({ e: t + 1 }), con({ e: t + 2, mano: m, hasta: m.hasta })).mano;
    r['mismo rechazo: un fin no se pierde'] = u(con({ e: t + 2 }), con({ e: t + 1, fin: t + 7 })).fin === t + 7;
    const h7 = u(A, con({ mano: m, hasta: m.hasta }));
    r['mismo rechazo escrito a la vez: el plazo no se pierde'] = !!h7.mano && h7.hasta === m.hasta;
    const sinE = { t, hasta: t + 10000 };
    r['cortes de la v0.1.5 (sin hora de escritura)'] = u(sinE, Object.assign({}, sinE, { fin: t + 3 })).fin === t + 3 && u(sinE, sinE) === sinE;
    const m2 = { s: 20, t: t + 8, hasta: t + 20000 };
    const h8 = u(con({ e: t + 5, mano: m, hasta: m.hasta }), con({ e: t + 8, mano: m2, hasta: m2.hasta }));
    r['un plazo corregido a uno más corto se respeta'] = h8.mano.s === 20 && h8.hasta === m2.hasta;
    return r;
  });
  for (const k of Object.keys(U)) es(U[k] === true, 'unir cortes: ' + k);
  await x.ctx.close();

  // un rechazo nuevo aquí no borra el plazo que se escribió en el otro dispositivo y que aquí aún no se había bajado
  x = await nuevo({ corte: { desde: 1, cuota: true, rutas: ['/me/playlists'] } });
  const T1 = Date.now() - 60000;
  const c1 = { t: T1, cuota: true, motivo: 'QUOTA_EXCEEDED', espera: null, hasta: T1 + 3600000, ruta: '/me/playlists', e: T1 };
  const mOtro = { s: 9000, t: T1 + 30000, hasta: T1 + 9000000 };
  x.mundo.pon('/memoria/memoria.json', memCon(c1));
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify');
  await x.page.waitForFunction(() => window.SS.estado.memLista && !!document.querySelector('.corte-sp'), null, { timeout: 15000 });
  x.mundo.pon('/memoria/memoria.json', memCon(Object.assign({}, c1, { hasta: mOtro.hasta, mano: mOtro, e: T1 + 30000 }))); // el otro dispositivo escribe el plazo
  await boton(x.page, 'Probar ahora (gasta 1 petición)').click();
  await x.page.waitForFunction(() => !window.SS.estado.tarea);
  await x.page.waitForFunction(() => /Según el plazo que escribiste/.test((document.querySelector('.corte-sp') || {}).innerText || ''), null, { timeout: 8000 }).catch(() => {});
  const cU = JSON.parse(x.mundo.archivos.get('/memoria/memoria.json').texto).ajustes.corteSp.v;
  es(x.mundo.sp429 === 1 && cU.t > T1 && !!cU.mano && cU.mano.s === 9000 && cU.hasta === mOtro.hasta, 'un rechazo nuevo en este dispositivo no acorta en la memoria común el plazo escrito en el otro (' + JSON.stringify({ nuevo: cU.t > T1, mano: cU.mano && cU.mano.s, min: Math.round((cU.hasta - Date.now()) / 60000) }) + ')');
  es(/Según el plazo que escribiste/.test(await x.page.locator('.corte-sp').innerText()), 'y este dispositivo pasa a verlo sin recargar');
  await x.ctx.close();

  // si Spotify dice el plazo y el navegador lo puede leer, se enseña y se respeta
  x = await nuevo({ corte: { desde: 3, retry: 7200, expone: true } });
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify'); await eligeXml(x.page);
  await pestana(x.page, 'rekordbox a Spotify');
  await boton(x.page, 'Simular').click();
  await x.page.waitForSelector('.aviso.error');
  es(/Pide esperar 2 h\./.test(await cuerpo(x.page)), 'con plazo legible, dice el que da Spotify');
  const ct = await x.page.evaluate(() => JSON.parse(localStorage.getItem('ss.corte')));
  es(ct.espera === 7200 && Math.abs(ct.hasta - ct.t - 7200000) < 5 && ct.cuota === false, 'y no reintenta hasta entonces');
  await x.ctx.close();

  // primera vez con esta versión: sin lo leído guardado, se parte de la última copia completa
  x = await nuevo();
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify'); await eligeXml(x.page);
  await pestana(x.page, 'Copia');
  await boton(x.page, 'Hacer una copia ahora').click();
  await x.page.waitForFunction(() => /Guardada: \/copias\//.test(document.body.innerText) && !window.SS.estado.tarea, null, { timeout: 60000 });
  const foto1 = () => x.page.evaluate(() => JSON.stringify([window.SS.estado.lib.playlists.map(p => [p.id, p.nombre, p.total, p.contenido, p.motivo, p.items]), window.SS.estado.lib.likes]));
  const entera = await foto1();
  x.mundo.archivos.delete('/memoria/cache-biblioteca.json'); // como si viniera de una versión que aún no lo guardaba
  await x.page.reload();
  await x.page.waitForFunction(() => !!(window.SS && window.SS.estado.xml), null, { timeout: 15000 });
  g = x.mundo.spGets;
  await simula(x.page);
  const lecS = await x.page.evaluate(() => window.SS.estado.lib.lectura);
  es(lecS.peticiones === 2 && lecS.releidas === 0 && lecS.iguales === 10 && lecS.likes === 'sin cambios' && /partiendo de la copia spotify-completa-/.test(await cuerpo(x.page)), 'sin lo leído guardado se parte de la última copia y la biblioteca solo se comprueba: ' + JSON.stringify(lecS));
  es(x.mundo.spGets - g === 2 + x.mundo.busquedas, 'el resto de peticiones son las búsquedas de canciones, que se hacen una vez (' + x.mundo.busquedas + ')');
  es((await foto1()) === entera, 'y lo reconstruido desde la copia es idéntico a lo leído de Spotify');
  es(x.mundo.archivos.has('/memoria/cache-biblioteca.json') && !JSON.parse(x.mundo.archivos.get('/memoria/cache-biblioteca.json').texto).semilla, 'a partir de ahí queda guardado como lectura normal');
  // y siempre se puede releer todo a propósito
  await pestana(x.page, 'Diagnóstico');
  g = x.mundo.spGets;
  await boton(x.page, 'Releer todo Spotify').click();
  es(x.mundo.spGets === g && !(await x.page.evaluate(() => window.SS.estado.tarea)) && /¿Releer todo Spotify\? Vuelve a pedir todas tus playlists y likes: unas \d+ peticiones/.test(await cuerpo(x.page)), '«Releer todo Spotify» pide confirmación y dice cuánto gasta, sin enviar nada');
  await boton(x.page, 'Cancelar').click();
  await x.page.waitForTimeout(600);
  es(x.mundo.spGets === g && await boton(x.page, 'Sí, releer todo').count() === 0 && await boton(x.page, 'Releer todo Spotify').count() === 1, 'y se puede cancelar: no se envía nada');
  await boton(x.page, 'Releer todo Spotify').click();
  await pestana(x.page, 'Copia'); await pestana(x.page, 'Diagnóstico');
  es(await boton(x.page, 'Sí, releer todo').count() === 0 && x.mundo.spGets === g, 'la confirmación no se queda abierta al cambiar de pestaña');
  await boton(x.page, 'Releer todo Spotify').click();
  await boton(x.page, 'Sí, releer todo').click();
  await x.page.waitForFunction(() => !window.SS.estado.tarea && window.SS.estado.lib && window.SS.estado.lib.lectura.releidas > 0, null, { timeout: 60000 });
  const lecT = await x.page.evaluate(() => window.SS.estado.lib.lectura);
  es(lecT.releidas === 10 && lecT.iguales === 0 && lecT.likes === 'releídos' && (await foto1()) === entera, '«Releer todo Spotify» no se fía de lo guardado y da lo mismo: ' + JSON.stringify(lecT));
  es(/\n  playlists releídas: todas \(10\)\n/.test(await x.page.locator('#diag').inputValue()), 'y el diagnóstico dice que se han releído todas');
  // una relectura completa que no termina no deja guardado menos de lo que había
  const guardado = () => { const j = JSON.parse(x.mundo.archivos.get('/memoria/cache-biblioteca.json').texto); return { pls: Object.keys(j.pls).length, likes: j.likes ? j.likes.items.length : null, rev: x.mundo.archivos.get('/memoria/cache-biblioteca.json').rev }; };
  const relee = async () => { await boton(x.page, 'Releer todo Spotify').click(); await boton(x.page, 'Sí, releer todo').click(); await x.page.waitForSelector('.corte-sp'); await x.page.waitForFunction(() => !window.SS.estado.tarea); };
  const quitaCorte = async () => { x.mundo.opc.corte = null; await boton(x.page, 'Probar ahora (gasta 1 petición)').click(); await x.page.waitForFunction(() => !window.SS.estado.tarea && !document.querySelector('.corte-sp')); };
  const g0 = guardado();
  es(g0.pls === 10 && g0.likes === 75, 'lo leído guardado: 10 playlists y 75 likes');
  x.mundo.opc.corte = { desde: x.mundo.spGets + 1, cuota: true }; // Spotify corta en la primera petición de la relectura
  await relee();
  let g1 = guardado();
  es(g1.pls === 10 && g1.likes === 75 && g1.rev === g0.rev, 'si «Releer todo» se corta sin haber leído nada, lo guardado no se toca (' + JSON.stringify(g1) + ')');
  t = await cuerpo(x.page);
  es(await boton(x.page, 'Releer todo Spotify').isDisabled() && /Mientras dura el corte de Spotify no se puede releer/.test(t) && await x.page.locator('.corte-sp').count() === 1, 'durante un corte, Diagnóstico enseña el aviso y «Releer todo Spotify» está apagado');
  await quitaCorte();
  x.mundo.opc.corte = { desde: x.mundo.spGets + 6, cuota: true }; // ahora corta a media relectura
  await relee();
  g1 = guardado();
  es(g1.pls === 10 && g1.likes === 75, 'si se corta a media relectura, se conserva lo que había y lo releído va encima (' + JSON.stringify(g1) + ')');
  await quitaCorte();
  await simula(x.page, 'Simular leyendo Spotify de nuevo');
  const lecD = await x.page.evaluate(() => window.SS.estado.lib.lectura);
  es(lecD.peticiones === 2 && lecD.releidas === 0 && lecD.iguales === 10 && lecD.likes === 'sin cambios' && (await foto1()) === entera, 'y la lectura normal siguiente sigue costando 2 peticiones y da lo mismo: ' + JSON.stringify(lecD));
  await x.ctx.close();

  // el otro dispositivo se entera del corte por la memoria común y no gasta ni una petición
  x = await nuevo();
  const dia = await x.page.evaluate(() => { const d = new Date(), z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); });
  x.mundo.pon('/memoria/memoria.json', JSON.stringify({ v: 1, mapa: {}, soundeo: {}, decisiones: {}, ocultas: {}, pares: {},
    ajustes: { corteSp: { v: { t: Date.now(), hasta: Date.now() + 3600000, cuota: true, motivo: 'QUOTA_EXCEEDED', espera: null, ruta: '/me/playlists' }, t: Date.now() } },
    uso: { [dia + '|otro']: { n: 500, t: Date.now() } } }));
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify');
  await x.page.waitForSelector('.corte-sp');
  es(x.mundo.spGets === 0 && /se ha agotado la cuota del modo desarrollo/.test(await x.page.locator('.corte-sp').innerText()), 'un corte apuntado por otro dispositivo se respeta también aquí, sin gastar peticiones');
  es(await x.page.locator('.aviso.error').count() === 0, 'y conectar Spotify con ese corte activo no deja un aviso de error');
  await pestana(x.page, 'Diagnóstico');
  es(/Peticiones a Spotify hoy: 500 entre todos tus dispositivos \(este: 0\)/.test(await x.page.locator('#diag').inputValue()), 'y el contador del día suma lo de todos los dispositivos');
  await x.ctx.close();

  // otra pestaña / otro dispositivo guardó memoria antes: se une, no se pisa
  x = await nuevo();
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify'); await eligeXml(x.page);
  await x.page.waitForTimeout(1800);
  const m0 = JSON.parse(x.mundo.archivos.get('/memoria/memoria.json').texto);
  m0.ocultas['spotify:track:deotro'] = { o: true, t: Date.now() };
  x.mundo.pon('/memoria/memoria.json', JSON.stringify(m0)); // otro dispositivo escribe
  await x.page.evaluate(() => { window.SS.estado.mem.ocultas['spotify:track:mio'] = { o: true, t: Date.now() }; });
  await pestana(x.page, 'Sin repartir');
  await x.page.locator('input[type="date"]').fill('2026-08-15');
  await x.page.waitForTimeout(2800);
  const m1 = JSON.parse(x.mundo.archivos.get('/memoria/memoria.json').texto);
  es(m1.ocultas['spotify:track:deotro'] && m1.ocultas['spotify:track:mio'] && m1.ajustes.likesDesde.v === '2026-08-15', 'si otro dispositivo guardó antes, la memoria se une en vez de pisarse');
  await x.ctx.close();

  // versión nueva publicada
  x = await nuevo();
  await x.page.evaluate(() => { window.SS.estado.nueva = '9.9.9'; });
  await pestana(x.page, 'Copia');
  es(/Hay una versión nueva \(9\.9\.9\)/.test(await cuerpo(x.page)), 'avisa cuando hay una versión nueva');
  await x.ctx.close();
}

// Tope diario de búsquedas nuevas (v0.4.0) y plazo de las búsquedas sin resultado («no están»: dos o tres semanas).
async function casosTope() {
  console.log('Tope de búsquedas');
  const E = D.esperado;
  const nA = Object.keys(E.add).length, nD = Object.keys(E.duda).length, nN = E.no.length, nY = E.ya.length;
  const hoyDe = page => page.evaluate(() => { const d = new Date(), dos = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()); });
  const otraVez = async page => { await boton(page, 'Simular otra vez').click(); await page.waitForFunction(() => !window.SS.estado.tarea && !!window.SS.estado.sim, null, { timeout: 120000 }); };
  const diag = async page => { await pestana(page, 'Diagnóstico'); const t = await page.locator('#diag').inputValue(); await pestana(page, 'rekordbox a Spotify'); return t; };

  // ---------- Hoy ya se han hecho 140 de las 150: solo salen 10 búsquedas y el resto queda «sin buscar» ----------
  let x = await nuevo();
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify'); await eligeXml(x.page);
  const dia = await hoyDe(x.page);
  await x.page.evaluate(d => { const u = JSON.parse(localStorage.getItem('ss.uso')) || { dia: d, n: 0 }; u.dia = d; u.b = 140; localStorage.setItem('ss.uso', JSON.stringify(u)); }, dia);
  await pestana(x.page, 'rekordbox a Spotify');
  es(/Búsquedas nuevas en Spotify hoy: 140 de 150 como mucho/.test(await cuerpo(x.page)), 'antes de simular, la pestaña A dice cuántas búsquedas van hoy y el tope');
  await simula(x.page);
  let n = await numeros(x.page);
  let sim = await x.page.evaluate(() => ({ inc: window.SS.estado.sim.incompleta, hechas: window.SS.estado.sim.hechas, total: window.SS.estado.sim.unicas.length, tope: window.SS.estado.cont.tope }));
  es(x.mundo.busquedas === 10, 'con 140 hechas y tope de 150 solo salen 10 búsquedas nuevas: ' + x.mundo.busquedas);
  es(n.pend > 0 && n.ya + n.add + n.duda + n.no + n.pend === E.unicas, 'lo que no se pudo buscar queda en su propia lista, «Sin buscar»: ' + JSON.stringify(n));
  es(n.ya === nY, 'lo que ya está en las playlists no necesita búsquedas y sale igual: ' + n.ya);
  es(n.no <= nN && n.add <= nA && n.duda <= nD, 'nada se da por «no está» ni se propone sin haberlo buscado');
  es(!sim.inc && sim.hechas === sim.total && sim.tope === n.pend, 'la simulación no queda incompleta: se recorren todas y se cuentan las que esperan: ' + JSON.stringify(sim));
  es(await x.page.locator('#tope-aviso').count() === 1 && /sin buscar: hoy se ha llegado al tope de 150 búsquedas nuevas/.test(await x.page.locator('#tope-aviso').innerText()), 'y un aviso lo explica');
  es(x.mundo.sp429 === 0 && x.consola.length === 0, 'sin cortes de Spotify ni errores');
  await x.page.locator('.filtro.cat-pend').click();
  es(await x.page.locator('.fila.cat-pend').count() === n.pend && /Sin buscar todavía: hoy se llegó al tope/.test(await x.page.locator('.fila.cat-pend').first().innerText()), 'la lista enseña esas canciones y por qué');
  let d = await diag(x.page);
  es(/Búsquedas nuevas hoy: 150 de 150 como mucho \(tope diario\); canciones que se quedaron sin buscar en esta sesión: \d+/.test(d) && d.indexOf('sin buscar por el tope ' + n.pend) >= 0, 'el diagnóstico lo cuenta');
  es(await boton(x.page, 'Preparar la sincronización (no envía nada)').isEnabled(), 'lo que sí se resolvió se puede sincronizar');
  // otra simulación el mismo día: ni una búsqueda más
  await otraVez(x.page);
  let n2 = await numeros(x.page);
  es(x.mundo.busquedas === 10 && JSON.stringify(n2) === JSON.stringify(n), 'simular otra vez el mismo día no gasta ninguna búsqueda y da lo mismo: ' + x.mundo.busquedas);
  // el uso del día viaja a la memoria común
  await x.page.waitForFunction(() => { const u = window.SS.estado.mem.uso; return Object.keys(u).some(k => u[k].b === 150); }, null, { timeout: 5000 }).catch(() => {});
  es(await x.page.evaluate(() => { const u = window.SS.estado.mem.uso; return Object.keys(u).some(k => u[k].b === 150 && u[k].n > 0); }), 'las búsquedas del día se apuntan en la memoria común, junto a las peticiones');

  // ---------- Subir el tope en Cuentas: se guarda y la siguiente simulación termina lo pendiente ----------
  await pestana(x.page, 'Cuentas');
  es(await x.page.locator('#tope-busq').inputValue() === '150' && /Hoy llevas 150 de 150\./.test(await cuerpo(x.page)), 'Cuentas enseña el tope (150 de fábrica) y lo que va hoy');
  await x.page.selectOption('#tope-busq', '500');
  es(await x.page.evaluate(() => window.SS.estado.mem.ajustes.topeBusq.v) === 500 && /Hoy llevas 150 de 500\./.test(await cuerpo(x.page)), 'al elegir otro tope se guarda como ajuste');
  await x.page.waitForTimeout(1600);
  es(JSON.parse(x.mundo.archivos.get('/memoria/memoria.json').texto).ajustes.topeBusq.v === 500, 'y llega a la memoria de Dropbox, común al PC y al iPhone');
  await pestana(x.page, 'rekordbox a Spotify');
  await otraVez(x.page);
  n = await numeros(x.page);
  es(n.pend === undefined && n.add === nA && n.duda === nD && n.no === nN && n.ya === nY, 'con el tope subido, la siguiente simulación busca lo que faltaba y cuadra con la de siempre: ' + JSON.stringify(n));
  es(x.mundo.busquedas > 10 && x.mundo.busquedas < 80 && await x.page.locator('#tope-aviso').count() === 0, 'gastando solo las búsquedas que faltaban (' + x.mundo.busquedas + ' en total)');
  const total = x.mundo.busquedas;

  // ---------- Las búsquedas sin resultado valen dos o tres semanas (antes, de tres a cinco días) ----------
  const RUTA = '/memoria/cache-busquedas.json';
  const envejece = dias => { // todas las búsquedas guardadas pasan a tener «dias» días
    const c = JSON.parse(x.mundo.archivos.get(RUTA).texto);
    for (const k of Object.keys(c.q)) c.q[k].t = Date.now() - dias * 864e5;
    x.mundo.pon(RUTA, JSON.stringify(c));
    return Object.values(c.q).filter(e => !e.r.length).length;
  };
  const recarga = async () => { await x.page.reload(); await x.page.waitForFunction(() => !!(window.SS && window.SS.estado.xml), null, { timeout: 15000 }); };
  let vacias = envejece(6);
  es(vacias > 0, 'hay búsquedas guardadas que no dieron nada: ' + vacias);
  await recarga();
  await simula(x.page);
  es(x.mundo.busquedas === total, 'a los 6 días una búsqueda sin resultado sigue valiendo: ninguna petición nueva (' + (x.mundo.busquedas - total) + ')');
  vacias = envejece(13.9);
  await recarga();
  await simula(x.page);
  es(x.mundo.busquedas === total, 'y a punto de cumplir dos semanas, también');
  vacias = envejece(21.1);
  await recarga();
  await simula(x.page);
  n = await numeros(x.page);
  es(x.mundo.busquedas - total === vacias, 'pasadas tres semanas se repiten las que no dieron nada, y solo esas (' + (x.mundo.busquedas - total) + ' de ' + vacias + '); las que dieron resultado valen un mes');
  es(n.add === nA && n.duda === nD && n.no === nN && n.ya === nY, 'y el resultado es el mismo: ' + JSON.stringify(n));
  await x.ctx.close();

  // ---------- El tope es de todos los dispositivos: si otro ya lo gastó hoy, aquí no sale ninguna búsqueda ----------
  x = await nuevo();
  const dia2 = await hoyDe(x.page);
  x.mundo.pon('/memoria/memoria.json', JSON.stringify({ v: 1, uso: { [dia2 + '|otro']: { n: 310, b: 150, t: Date.now() } } }));
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify'); await eligeXml(x.page);
  await simula(x.page);
  n = await numeros(x.page);
  es(x.mundo.busquedas === 0 && n.pend > 0 && n.ya === nY, 'con las 150 gastadas en otro dispositivo, aquí no sale ninguna búsqueda: ' + JSON.stringify(n));
  es(/Búsquedas nuevas en Spotify hoy: 150 de 150 como mucho/.test(await cuerpo(x.page)), 'y la pantalla cuenta las del otro dispositivo');
  // un ajuste que no es de la lista (memoria tocada a mano o de otra versión) no desactiva el tope
  await x.page.evaluate(() => { window.SS.estado.mem.ajustes.topeBusq = { v: 99999, t: Date.now() }; window.SS.pinta(); });
  await otraVez(x.page);
  es(x.mundo.busquedas === 0 && /de 150 como mucho/.test(await cuerpo(x.page)), 'un tope que no es de los ofrecidos no vale: se queda en 150');
  await x.ctx.close();
}

// Botón B (v0.4.0): el lector de Soundeo (userscript/), la vuelta con la lista y la simulación, contra un Soundeo
// de mentira (falsos.js). El cargador se inyecta como lo haría la extensión Userscripts: solo en soundeo.com.
async function casosSoundeo() {
  console.log('Soundeo (botón B)');
  const CARGADOR = fs.readFileSync(path.join(__dirname, '..', 'userscript', 'synchrosound-lector.user.js'), 'utf8');
  const soloEnSoundeo = codigo => "if (location.hostname === 'soundeo.com') {\n" + codigo + '\n}';
  // Un doble de Soundeo Feed: hace en la página lo que hace el de verdad y podría estorbar al lector (visto en su
  // código publicado): guarda sus cosas, envuelve fetch, oculta lo que cuelga de <body> y reescribe el «#» a los 350 ms.
  const FEED = `(function () {
    localStorage.setItem('sxfeed:app:code', 'codigo de feed');
    localStorage.setItem('sxfeed:app:checkedAt', '1700000000000');
    localStorage.setItem('prefs', '{"ui2":true}');
    var F = window.fetch; window.__feedFetch = 0;
    window.fetch = function () { window.__feedFetch++; return F.apply(this, arguments); };
    document.addEventListener('DOMContentLoaded', function () {
      var st = document.createElement('style');
      st.textContent = '#sx-host{position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000}html.sx-open body>*:not(#sx-host){display:none!important}html.sx-open,html.sx-open body{overflow:hidden!important;height:100%!important}';
      document.head.appendChild(st);
      var host = document.createElement('div'); host.id = 'sx-host'; document.body.appendChild(host);
      document.documentElement.classList.add('sx-open');
      setTimeout(function () { history.replaceState(history.state, '', location.pathname + location.search + '#sx=feed&id=1'); }, 350);
    });
  })();`;
  const E = D.sxEsperado;
  const IPHONE = Object.assign({}, devices['iPhone 14'], { defaultBrowserType: undefined });
  const abre = async (opc, conFeed, ctxOpc) => {
    const x = await nuevo(opc, ctxOpc);
    await x.ctx.addInitScript({ content: soloEnSoundeo(CARGADOR) });
    if (conFeed) await x.ctx.addInitScript({ content: soloEnSoundeo(FEED) });
    return x;
  };
  const enPanel = (page, fn) => page.evaluate(fn);
  const textoPanel = page => page.evaluate(() => document.getElementById('ssync-lector').shadowRoot.querySelector('.caja').innerText);
  // pulsa «Leer Soundeo» y espera a que el lector termine (cuando ofrece el enlace de vuelta)
  const leeSoundeo = async x => {
    await pestana(x.page, 'Soundeo a Spotify');
    await boton(x.page, 'Leer Soundeo').click();
    await x.page.waitForURL(/^https:\/\/soundeo\.com\//, { timeout: 15000 });
    await x.page.waitForFunction(() => { const h = document.getElementById('ssync-lector'); return !!h && !!h.shadowRoot.querySelector('#ssync-volver'); }, null, { timeout: 20000 });
    return textoPanel(x.page);
  };
  const enlaceVuelta = page => page.evaluate(() => document.getElementById('ssync-lector').shadowRoot.querySelector('#ssync-volver').href);
  const vuelve = async x => {
    await x.page.locator('#ssync-volver').click();
    await x.page.waitForURL(u => u.toString().startsWith(SITIO), { timeout: 15000 });
    await x.page.waitForSelector('.cab');
  };
  const guardada = page => page.waitForFunction(() => !!window.SS && !!window.SS.estado.sx && !window.SS.estado.sxLlegada && !window.SS.sxMirando(), null, { timeout: 15000 });
  const listas = m => Array.from(m.archivos.keys()).filter(k => k.startsWith('/soundeo/')).sort();
  const soloLee = m => m.sxPet.every(p => /^GET \/(account\/(favorites|downloads)(\?page=\d+)?|account\/logoreg|favicon\.ico)$/.test(p));
  const simulaB = async page => { await boton(page, await boton(page, 'Simular').count() ? 'Simular' : 'Simular otra vez').click(); await page.waitForFunction(() => !window.SS.estado.tarea && !!window.SS.estado.simB, null, { timeout: 120000 }); };
  const diag = async page => { await pestana(page, 'Diagnóstico'); const t = await page.locator('#diag').inputValue(); await pestana(page, 'Soundeo a Spotify'); return t; };
  // un enlace de vuelta hecho a mano, sin comprimir (formato «j»)
  const enlaceCon = (n, datos, opc) => {
    const o = Object.assign({ v: 1, n, t: Date.now(), lector: 'prueba', fav: [], dow: [], pag: [1, 1], mal: [] }, datos);
    const json = JSON.stringify(o);
    return SITIO + '#soundeo=1.' + n + '.j.' + (opc && opc.cuenta != null ? opc.cuenta : o.fav.length) + '.' + ((opc && opc.suma) || C.sxSuma(json)) + '.' + Buffer.from(json, 'utf8').toString('base64url');
  };
  const pide = (page, n, haceMin) => page.evaluate(([n, m]) => localStorage.setItem('ss.sx.pide', JSON.stringify({ n, t: Date.now() - m * 60000 })), [n, haceMin || 0]);
  const llega = async (page, enlace) => { await page.goto('about:blank'); await page.goto(enlace); await page.waitForSelector('.cab'); await page.waitForSelector('.aviso'); };
  const MARCA = 'AbCdEfGhIjKlMnOpQrStUv';

  // ---------- El recorrido entero en un iPhone con Soundeo Feed puesto: leer, volver, guardar y simular ----------
  let x = await abre(null, true, IPHONE);
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify'); await eligeXml(x.page);
  await pestana(x.page, 'Cuentas');
  es(await x.page.locator('#sx-instalar').getAttribute('href') === 'userscript/synchrosound-lector.user.js' && /Solo lee, y solo cuando pulsas «Leer Soundeo»/.test(await cuerpo(x.page)), 'Cuentas explica el lector y da el enlace para instalarlo');
  await pestana(x.page, 'Soundeo a Spotify');
  await x.page.waitForFunction(() => /Todavía no hay ninguna lista de Soundeo guardada/.test(document.body.innerText), null, { timeout: 15000 });
  es(await boton(x.page, 'Simular').isDisabled() && /el botón B solo simula: no cambia nada en Spotify ni en Soundeo/.test(await cuerpo(x.page)), 'sin lista de Soundeo no se puede simular, y la pantalla dice que B solo simula');
  let panel = await leeSoundeo(x);
  es(/Favoritos leídos/.test(panel) && /Favoritos: 10 \(3 descargados, 1 sin publicar\)\./.test(panel) && /Descargas: 5\./.test(panel) && /Listo: todo leído\. En Soundeo no se ha cambiado nada\./.test(panel), 'el lector lee favoritos y descargas y lo cuenta: ' + panel.replace(/\n+/g, ' | ').slice(0, 200));
  es(x.mundo.sxPet.filter(p => !/favicon/.test(p)).join(' ; ') === 'GET /account/favorites ; GET /account/favorites ; GET /account/downloads' && soloLee(x.mundo), 'a Soundeo solo salen la página que se abre y dos lecturas (GET): ' + x.mundo.sxPet.join(' ; '));
  await x.page.waitForTimeout(500); // el doble de Feed reescribe el «#» a los 350 ms
  let enSx = await x.page.evaluate(() => { const h = document.getElementById('ssync-lector'), r = h.shadowRoot.querySelector('.fondo').getBoundingClientRect(), b = h.shadowRoot.querySelector('#ssync-volver').getBoundingClientRect();
    return { padre: h.parentElement.tagName, ancho: r.width, alto: r.height, vw: innerWidth, vh: innerHeight, arriba: document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === h,
      claves: Object.keys(localStorage).sort().join(','), code: localStorage.getItem('sxfeed:app:code'), at: localStorage.getItem('sxfeed:app:checkedAt'), prefs: localStorage.getItem('prefs'),
      sesion: Object.keys(sessionStorage).length, hash: location.hash, cookies: document.cookie, feedAbierto: document.documentElement.classList.contains('sx-open'), feedFetch: window.__feedFetch }; });
  es(enSx.padre === 'HTML' && enSx.ancho >= enSx.vw - 1 && enSx.alto >= enSx.vh - 1 && enSx.arriba, 'con Soundeo Feed abierto, el panel del lector se ve entero y encima (cuelga de <html>): ' + JSON.stringify([enSx.ancho, enSx.alto, enSx.vw, enSx.vh]));
  es(enSx.claves === 'prefs,sxfeed:app:checkedAt,sxfeed:app:code' && enSx.code === 'codigo de feed' && enSx.at === '1700000000000' && enSx.prefs === '{"ui2":true}' && enSx.sesion === 0 && enSx.cookies === '',
    'lo que guarda Soundeo Feed queda igual y el lector no guarda nada en Soundeo: ' + enSx.claves);
  es(enSx.hash === '#sx=feed&id=1' && enSx.feedAbierto && enSx.feedFetch >= 2, 'Feed sigue a lo suyo (reescribe el «#» y ve pasar las lecturas): el lector ya había leído su marca: ' + JSON.stringify([enSx.hash, enSx.feedAbierto, enSx.feedFetch]));
  await foto(x.page, 'lector-iphone');
  const enlace1 = await enlaceVuelta(x.page);
  es(enlace1.indexOf(SITIO + '#soundeo=1.') === 0 && enlace1.length < 4000, 'el enlace de vuelta va a SynchroSound con la lista en el «#»: ' + enlace1.length + ' caracteres');
  await vuelve(x);
  await guardada(x.page);
  es(x.page.url() === SITIO, 'al volver, la dirección queda limpia');
  let t = await cuerpo(x.page);
  es(/Lista de Soundeo recibida: 10 favoritos, 4 descargados\./.test(t) && /Lista de Soundeo guardada en Dropbox: \/soundeo\/soundeo-\d{8}-\d{6}\.json\./.test(t), 'la app la recibe, la comprueba y la guarda en Dropbox');
  es(/Favoritos de Soundeo leídos el \d\d\/\d\d\/\d{4}.* 10 favoritos, 4 descargados\./.test(t) && await x.page.locator('#sx-avisos').count() === 0, 'y enseña de cuándo es, sin avisos: es una lista completa');
  let ls1 = listas(x.mundo);
  let guard = JSON.parse(x.mundo.archivos.get(ls1[0]).texto);
  es(ls1.length === 1 && guard.v === 1 && guard.fav.length === 10 && guard.dow.length === 5 && guard.mal.length === 0 && guard.pag.join() === '1,1' && guard.lector === '1.0.0' && /^SynchroSound /.test(guard.app) && guard.n === undefined,
    'el archivo guardado lleva los 10 favoritos, las 5 descargas y de dónde sale');
  es(JSON.stringify(guard.fav[9]) === JSON.stringify([9000010, 'Rita Polo - Sube Sube (Extended Mix)', 370, 0]) && guard.fav[7][3] === 2, 'cada favorito con su id, su texto, su duración y su estado');
  es(await x.page.evaluate(() => localStorage.getItem('ss.sx.pide') === null && localStorage.getItem('ss.sx.llegada') === null), 'la marca queda gastada y no queda nada pendiente en el navegador');
  const petSx = x.mundo.sxPet.length, busB = x.mundo.busquedas;
  await simulaB(x.page);
  let n = await numeros(x.page);
  es(n.ya === E.ya.length && n.add === E.add.length && n.duda === E.duda.length && n.no === E.no.length && n.pend === undefined, 'recuento de la simulación de B: ' + JSON.stringify(n));
  let est = await x.page.evaluate(() => window.SS.estado.simB.unicas.map(u => ({ id: u.sx.id, e: u.estado, baj: u.sx.baj, sp: u.elegida ? u.elegida.sp.id : null, dest: u.destinos.map(d => d.clave + (d.ya ? '=' : '+')).join(' ') })));
  const de = id => est.find(e => e.id === id);
  for (const k of ['ya', 'add', 'duda', 'no']) for (const id of E[k]) es(de(id).e === k, 'el favorito ' + id + ' sale como «' + k + '» (' + de(id).e + ')');
  es(est.filter(e => e.baj).map(e => e.id).join() === E.descargadas.join(), 'descargadas: las que marca Soundeo y la que solo está en «Mis descargas»');
  es(de(9000003).dest === 'all= down+' && de(9000004).dest === 'all+ try+' && de(9000005).dest === 'all+ down+' && de(9000002).dest === 'all= try=', 'cada favorito va a Sound All y a Down o Try según esté descargado: ' + de(9000003).dest + ' | ' + de(9000004).dest);
  es(de(9000004).sp === D.cat.paper.id && de(9000005).sp === D.cat.cobaltExt.id && de(9000009).sp === D.cat.like1.id && de(9000010).sp === D.cat.largaExt.id, 'y se empareja con la canción de Spotify que toca');
  const filasMapa = await x.page.evaluate(() => Array.from(document.querySelectorAll('.lista.mapa .fila')).map(f => f.querySelector('.fila-titulo').firstChild.textContent + ': ' + (f.querySelector('.fila-sub') || {}).textContent));
  const linea = k => 'Ya están ' + E[k].ya + ', se añadirían ' + E[k].add + ', dudosas ' + E[k].duda + ', no están ' + E[k].no + '.';
  es(filasMapa.join(' | ') === 'Sound All: ' + linea('all') + ' | Sound Down: ' + linea('down') + ' | Sound Try: ' + linea('try'), 'el recuento por playlist: ' + filasMapa.join(' | '));
  t = await cuerpo(x.page);
  es(/10 favoritos de Soundeo\. Simulación del .*: no se ha cambiado nada en Spotify\./.test(t) && /Iría a: Sound Down\n/.test(t + '\n') && /Iría a: Sound All, Sound Try/.test(t) && /Descargada/.test(t) && /Sin descargar/.test(t), 'la lista de «Se añadirían» dice a qué playlists iría cada una y si está descargada');
  es(x.mundo.escrituras.length === 0 && x.mundo.sxPet.length === petSx, 'simular no escribe nada en Spotify ni pide nada a Soundeo');
  es(/Sin Extended en Spotify: se usa la Original; dura 3:35 en Spotify y 6:35 en Soundeo/.test(t) && !/en rekordbox/.test(await x.page.locator('.lista:not(.mapa)').innerText()), 'las notas del buscador hablan de Soundeo, no de rekordbox');
  await foto(x.page, 'b-iphone');
  es(x.mundo.busquedas - busB > 0 && x.mundo.busquedas - busB < 25, 'búsquedas de la simulación de B: ' + (x.mundo.busquedas - busB));
  let d = await diag(x.page);
  es(/Soundeo: lista \/soundeo\/soundeo-\d{8}-\d{6}\.json, leída el .* \(lector 1\.0\.0\): 10 favoritos, 4 descargados; sin publicar 1; en «Mis descargas» 5; páginas 1\+1; completa/.test(d) &&
    /Simulación B .*: favoritos 10; ya están 2; se añadirían 5; dudosas 1; no están 2/.test(d) && d.indexOf('  Sound Down: ya 1, añadir 3, dudosas 0, no están 0') > 0, 'el diagnóstico cuenta la lista y la simulación de B');
  // la simulación de A no se ve afectada, y una respuesta dada en B vale para la misma canción en A
  await simula(x.page);
  n = await numeros(x.page);
  es(n.add === Object.keys(D.esperado.add).length && n.ya === D.esperado.ya.length, 'la simulación de A sigue dando lo suyo: ' + JSON.stringify(n));
  await pestana(x.page, 'Soundeo a Spotify');
  await x.page.locator('.fila.cat-add', { hasText: 'Paper Lanterns' }).getByRole('button', { name: 'No es', exact: true }).click();
  es(await x.page.evaluate(() => { const S = window.SS.estado, cl = 'nora vex|paper lanterns extended mix'; return S.simB.unicas.find(u => u.rb.clave === cl).estado !== 'add' && S.sim.unicas.find(u => u.rb.clave === cl).estado !== 'add' && S.mem.decisiones[cl].no.length > 0; }),
    'un «No es» dado en B vale también para el archivo de rekordbox de esa misma canción');
  await x.page.locator('.filtro.cat-no').click();
  await x.page.locator('.fila', { hasText: 'Paper Lanterns' }).getByRole('button', { name: 'Deshacer mi respuesta', exact: true }).click();
  es(await x.page.evaluate(() => window.SS.estado.simB.unicas.find(u => u.sx.id === 9000004).estado === 'add' && window.SS.estado.sim.unicas.find(u => u.rb.clave === 'nora vex|paper lanterns extended mix').estado === 'add'), 'y deshacerlo, también');
  es(x.consola.length === 0, 'sin errores en la consola: ' + x.consola.join(' | '));

  // ---------- Otro dispositivo (el PC) encuentra la lista en Dropbox, sin pasar por Soundeo ----------
  const ctx2 = await navegador.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  await x.mundo.instala(ctx2);
  const p2 = await ctx2.newPage();
  await p2.goto(SITIO); await p2.waitForSelector('.cab');
  await conecta(p2, 'Dropbox'); await conecta(p2, 'Spotify');
  await pestana(p2, 'Soundeo a Spotify');
  await p2.waitForFunction(() => /Favoritos de Soundeo leídos el/.test(document.body.innerText), null, { timeout: 15000 });
  es(/10 favoritos, 4 descargados\./.test(await cuerpo(p2)) && x.mundo.sxPet.length === petSx && listas(x.mundo).length === 1, 'en otro dispositivo la lista sale de Dropbox, sin tocar Soundeo ni guardar otra copia');
  await simulaB(p2);
  await foto(p2, 'b-pc');
  n = await numeros(p2);
  es(n.ya === E.ya.length && n.add === E.add.length && n.duda === E.duda.length && n.no === E.no.length, 'y la simulación da lo mismo: ' + JSON.stringify(n));
  await ctx2.close();

  // ---------- Lo que no se acepta: enlaces repetidos, cortados, viejos o no pedidos ----------
  await llega(x.page, enlace1);
  t = await cuerpo(x.page);
  es(/La lista de Soundeo no se ha aceptado: no corresponde a una lectura pedida desde este navegador\./.test(t) && listas(x.mundo).length === 1 && x.page.url() === SITIO, 'el mismo enlace por segunda vez no vale: la marca era de un solo uso');
  const favs2 = [[9000001, 'Soundero - Favorita Bajada (Original Mix)', 300, 1], [9000004, 'Nora Vex - Paper Lanterns (Extended Mix)', 395, 0]];
  await llega(x.page, enlaceCon(MARCA, { fav: favs2 }));
  es(/no corresponde a una lectura pedida desde este navegador/.test(await cuerpo(x.page)) && listas(x.mundo).length === 1, 'una lista que nadie ha pedido desde este navegador no se acepta');
  await pide(x.page, MARCA);
  await llega(x.page, enlaceCon(MARCA, { fav: favs2 }, { suma: '00000000' }));
  es(/la suma de control no cuadra/.test(await cuerpo(x.page)) && listas(x.mundo).length === 1 && await x.page.evaluate(() => localStorage.getItem('ss.sx.pide') === null), 'con la suma de control cambiada se rechaza, y la marca queda gastada');
  await pide(x.page, MARCA);
  await llega(x.page, enlaceCon(MARCA, { fav: favs2 }, { cuenta: 3 }));
  es(/el recuento no cuadra/.test(await cuerpo(x.page)) && listas(x.mundo).length === 1, 'si el recuento no cuadra, se rechaza entera');
  await pide(x.page, MARCA);
  await llega(x.page, enlaceCon(MARCA, { fav: favs2 }).slice(0, -30));
  es(/La lista de Soundeo no se ha aceptado/.test(await cuerpo(x.page)) && listas(x.mundo).length === 1, 'un enlace cortado se rechaza');
  await pide(x.page, MARCA, 31);
  await llega(x.page, enlaceCon(MARCA, { fav: favs2 }));
  es(/se pidió hace más de media hora/.test(await cuerpo(x.page)) && listas(x.mundo).length === 1, 'una marca de hace más de media hora ya no vale');
  await pide(x.page, MARCA);
  await llega(x.page, enlaceCon(MARCA, { fav: [[9000001, 'A - B', 300, 1], [9000001, 'A - B', 300, 1]] }));
  es(/un favorito viene repetido/.test(await cuerpo(x.page)) && listas(x.mundo).length === 1, 'una lista con la forma mal (un favorito repetido) se rechaza');
  await pide(x.page, MARCA);
  await llega(x.page, enlaceCon(MARCA, { fav: favs2, t: Date.now() - 3 * 3600000 }));
  es(/la hora de la lectura no cuadra con la petición/.test(await cuerpo(x.page)) && listas(x.mundo).length === 1, 'una lista leída antes de pedirla tampoco');
  await pide(x.page, MARCA);
  await llega(x.page, SITIO + '#soundeo=1.' + MARCA + '.j.2');
  es(/el enlace no tiene la forma esperada/.test(await cuerpo(x.page)) && await x.page.evaluate(() => localStorage.getItem('ss.sx.pide') !== null), 'un enlace sin la forma esperada se rechaza sin gastar la marca');
  // y una bien hecha, sin comprimir (un navegador sin compresión), sí: pasa a ser la lista vigente
  await llega(x.page, enlaceCon(MARCA, { fav: favs2, t: Date.now() + 2000, texto: '<img src=x onerror=alert(1)>' }));
  await guardada(x.page);
  t = await cuerpo(x.page);
  es(/Lista de Soundeo recibida: 2 favoritos, 1 descargado\./.test(t) && listas(x.mundo).length === 2 && /Favoritos de Soundeo leídos el .* 2 favoritos, 1 descargado\./.test(t), 'una lista sin comprimir y bien formada se acepta y pasa a ser la vigente');
  es(JSON.parse(x.mundo.archivos.get(listas(x.mundo)[1]).texto).texto === undefined && await x.page.evaluate(() => window.SS.estado.simB === null), 'lo que no está previsto en la lista no se guarda, y la simulación anterior deja de valer');
  await x.ctx.close();

  // ---------- Más de una página: 230 favoritos son tres lecturas; 200 justos, una cuarta para asegurarse ----------
  x = await abre({ soundeo: { fav: D.sxMuchos(230), dow: [] } });
  await conecta(x.page, 'Dropbox');
  panel = await leeSoundeo(x);
  es(/Favoritos: 230 \(77 descargados\)\./.test(panel) && /Favoritos leídos/.test(panel), 'con 230 favoritos lee las tres páginas: ' + panel.replace(/\n+/g, ' | ').slice(0, 120));
  es(x.mundo.sxPet.filter(p => /favorites/.test(p)).join(' ; ') === 'GET /account/favorites ; GET /account/favorites ; GET /account/favorites?page=2 ; GET /account/favorites?page=3' && soloLee(x.mundo), 'pide las páginas 2 y 3 y ninguna más: ' + x.mundo.sxPet.join(' ; '));
  const largo230 = (await enlaceVuelta(x.page)).length;
  await vuelve(x); await guardada(x.page);
  guard = JSON.parse(x.mundo.archivos.get(listas(x.mundo)[0]).texto);
  es(guard.fav.length === 230 && new Set(guard.fav.map(f => f[0])).size === 230 && guard.pag.join() === '3,1' && guard.mal.length === 0 && /230 favoritos, 77 descargados/.test(await cuerpo(x.page)), 'y llegan los 230, sin repetir (enlace de ' + largo230 + ' caracteres)');
  await x.ctx.close();
  x = await abre({ soundeo: { fav: D.sxMuchos(200), dow: [] } });
  await conecta(x.page, 'Dropbox');
  panel = await leeSoundeo(x);
  es(/Favoritos: 200 /.test(panel) && /Favoritos leídos/.test(panel) && x.mundo.sxPet.filter(p => /favorites\?page/.test(p)).join(' ; ') === 'GET /account/favorites?page=2 ; GET /account/favorites?page=3',
    'con 200 justos (la última página viene llena) mira si hay una tercera, y que no exista no es un fallo: ' + x.mundo.sxPet.join(' ; '));
  await x.ctx.close();

  // ---------- Una página que no llega: la lista viaja marcada como incompleta ----------
  x = await abre({ soundeo: { fav: D.sxMuchos(230), dow: [], falla: { lista: 'favorites', pagina: 2, estado: 500 } } });
  await conecta(x.page, 'Dropbox');
  panel = await leeSoundeo(x);
  es(/Leído, con avisos/.test(panel) && /no se han podido leer todas las páginas de favoritos/.test(panel) && /Favoritos: 100 /.test(panel), 'si una página falla, el lector lo dice: ' + panel.replace(/\n+/g, ' | ').slice(0, 160));
  await vuelve(x); await guardada(x.page);
  es(/Ojo con esta lista: no se pudieron leer todas las páginas de favoritos\./.test(await x.page.locator('#sx-avisos').innerText()) && JSON.parse(x.mundo.archivos.get(listas(x.mundo)[0]).texto).mal.join() === 'fav-paginas', 'y la app la guarda con ese aviso a la vista');
  await x.ctx.close();

  // ---------- Filtros puestos en Soundeo, y descargas que no se pueden leer ----------
  x = await abre({ soundeo: { filtros: 'fav', falla: { lista: 'downloads', pagina: 1, estado: 500 } } });
  await conecta(x.page, 'Dropbox');
  panel = await leeSoundeo(x);
  es(/Soundeo tiene filtros puestos en tus favoritos/.test(panel) && /no se ha podido leer la lista de descargas/.test(panel) && /Descargas: no se han podido leer/.test(panel), 'filtros puestos y descargas sin leer: los dos avisos');
  await vuelve(x); await guardada(x.page);
  t = await x.page.locator('#sx-avisos').innerText();
  es(/Soundeo tenía filtros puestos en tus favoritos; no se pudo leer la lista de descargas/.test(t) && /10 favoritos, 3 descargados/.test(await cuerpo(x.page)), 'la app lo enseña; lo descargado sale entonces solo de lo que marca la lista de favoritos');
  await x.ctx.close();

  // ---------- Sin sesión en Soundeo: no se lee nada y la vuelta no lleva lista ----------
  x = await abre({ soundeo: { sesion: false } });
  await conecta(x.page, 'Dropbox');
  panel = await leeSoundeo(x);
  es(/No has iniciado sesión en Soundeo/.test(panel) && /No se ha leído ni cambiado nada/.test(panel) && await enlaceVuelta(x.page) === SITIO && soloLee(x.mundo), 'sin sesión el lector lo dice y la vuelta no lleva ninguna lista: ' + x.mundo.sxPet.join(' ; '));
  await x.page.locator('#ssync-lector').getByRole('button', { name: 'Cerrar y quedarme en Soundeo' }).click();
  es(await x.page.locator('#ssync-lector').count() === 0, '«Cerrar» quita el panel y deja Soundeo como estaba');
  await x.ctx.close();

  // ---------- Usando Soundeo con normalidad (sin la marca) el cargador no hace nada ----------
  x = await abre(null, true);
  for (const dir of ['https://soundeo.com/account/favorites', 'https://soundeo.com/account/favorites#sx=feed&id=3', 'https://soundeo.com/account/favorites#synchrosound=corta', 'https://soundeo.com/account/favorites#synchrosound=' + MARCA + '&otra=cosa']) {
    await x.page.goto('about:blank'); await x.page.goto(dir);
    await x.page.waitForTimeout(700);
  }
  es(await x.page.locator('#ssync-lector').count() === 0 && !x.mundo.peticiones.find(p => /synchrosound-lector/.test(p.ruta)) && x.mundo.sxPet.filter(p => !/favicon/.test(p)).length === 4 && await x.page.evaluate(() => window.__SSYNC_LECTOR__ === undefined && window.__feedFetch === 0),
    'sin la marca exacta de SynchroSound no hay panel, ni descarga del lector, ni una sola petición de más');
  await x.ctx.close();

  // ---------- Una lista de hace días se avisa como vieja; un archivo estropeado no se usa ----------
  x = await abre();
  const vieja = { v: 1, t: Date.now() - 3 * 86400000, lector: '1.0.0', fav: D.sxFav.map(f => [f.id, f.texto, f.dur, f.estado]), dow: D.sxDow, pag: [1, 1], mal: [] };
  x.mundo.pon('/soundeo/soundeo-20261101-100000.json', JSON.stringify(vieja));
  x.mundo.pon('/soundeo/otra-cosa.json', '{"no":"es una lista"}');
  await conecta(x.page, 'Dropbox'); await conecta(x.page, 'Spotify');
  await pestana(x.page, 'Soundeo a Spotify');
  await x.page.waitForSelector('#sx-avisos', { timeout: 15000 });
  es(/Ojo con esta lista: se leyó hace más de 24 horas\./.test(await x.page.locator('#sx-avisos').innerText()) && await boton(x.page, 'Simular').isEnabled(), 'una lista de hace tres días se avisa como vieja (y se puede simular con ella)');
  x.mundo.pon('/soundeo/soundeo-20261120-100000.json', '{"v":1,"t":"mal"}');
  await boton(x.page, 'Mirar en Dropbox').click();
  await x.page.waitForSelector('.aviso.error', { timeout: 15000 });
  es(/La lista «\/soundeo\/soundeo-20261120-100000\.json» no se puede usar: no dice cuándo se leyó\./.test(await cuerpo(x.page)), 'un archivo de lista estropeado no se usa, y se dice cuál es');
  await x.ctx.close();
}

async function casosSinc() {
  console.log('Sincronización');
  let x, t, P, w, nPet, dg, ev0, ev, sp, antes, regs, ja, jr, cw, raros, t0, antesItems, preguntas, y, fuera, dato, jm;
  // COLA=1 pasa solo el último bloque (lo añadido tras la revisión independiente), para iterar deprisa.
  const COLA = !!process.env.COLA;
  // ================= fase 2, etapa 1: la sincronización «solo añadir» =================
  const conectaTodo = async y => {
    await conecta(y.page, 'Dropbox'); await conecta(y.page, 'Spotify');
    await y.page.waitForFunction(() => /como Prueba/.test(document.body.innerText), null, { timeout: 15000 });
    await eligeXml(y.page);
  };
  const libre = y => y.page.waitForFunction(() => !window.SS.estado.tarea, null, { timeout: 90000 });
  const prepara = async y => { await boton(y.page, 'Preparar la sincronización (no envía nada)').click(); await y.page.waitForSelector('#sinc-conf'); };
  const fila = (y, nombre) => y.page.locator('#sinc-conf li.fila').filter({ has: y.page.locator('label.fila-titulo', { hasText: new RegExp('→ ' + nombre.replace(/[/]/g, '\\/') + '$') }) });
  const marca = async (y, nombre) => { await fila(y, nombre).locator('input.marca').click(); };
  const confirma = async y => { await y.page.locator('#sinc-conf .acciones .btn', { hasText: /^Confirmar/ }).click(); await libre(y); };
  const aSpot = y => y.mundo.peticiones.filter(p => p.host === 'api.spotify.com' && p.metodo !== 'OPTIONS');
  const pl = (lista, nombre) => lista.find(p => p.name === nombre);
  const uris = p => p.pistas.map(e => e.t.uri);
  const rutaDe = p => '/v1/playlists/' + p.id + '/items';
  const archivos = (y, re) => Array.from(y.mundo.archivos.values()).filter(a => re.test(a.ruta));
  const resultado = y => y.page.locator('#sinc-res').innerText();
  const lsCorteDe = y => y.page.evaluate(() => JSON.parse(localStorage.getItem('ss.corte')));
  const ANTES = /^\/copias\/antes-de-sincronizar-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d-[A-Za-z0-9_-]+\.json$/, REGISTRO = /^\/registro\/sincronizacion-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d-[A-Za-z0-9_-]+\.json$/, COMPLETA = /^\/copias\/spotify-completa-/;

  if (!COLA) {
  // ---------- Conexión antigua, de solo lectura: se puede simular; sincronizar, no ----------
  P = D.copiaBiblio([D.playlist('OG - Larga', [])], { 'NS - Techno': { public: true } });
  const ini = {};
  P.forEach(p => { ini[p.name] = uris(p); });
  const techno = pl(P, 'NS - Techno'), casa = pl(P, 'NS - House'), larga = pl(P, 'OG - Larga');
  const llamada = ['POST', '/playlists/' + techno.id + '/items', { cuerpo: { uris: D.aAnadir('ns', 'Techno') } }];
  x = await nuevo({ playlists: P, xml: D.xmlLargo(), scopeSpotify: LECTURA });
  await conectaTodo(x);
  t = await cuerpo(x.page);
  es(x.mundo.autoriza.sp.scope === PEDIDOS && t.indexOf('Permisos concedidos: ' + LECTURA + '.') >= 0 && /Solo lectura/.test(await x.page.locator('.candado').innerText()), 'con una conexión de solo lectura el indicador sigue diciendo «Solo lectura»');
  es(/solo con permisos de lectura: todo funciona como antes/.test(t) && /Para sincronizar hay que volver a conectarlo/.test(t) && await boton(x.page, 'Volver a conectar Spotify').count() === 1, 'y Cuentas explica que para sincronizar hay que volver a conectar');
  await simula(x.page);
  t = await cuerpo(x.page);
  es(/aquí se puede simular, pero no sincronizar/.test(t) && await boton(x.page, 'Preparar la sincronización (no envía nada)').count() === 0 && (await numeros(x.page)).add > 100, 'sin el permiso de escritura se simula como siempre, pero la sincronización no se puede ni preparar');
  es(/^Bloqueado/.test(await intenta(x.page, llamada)) && x.mundo.escrituras.length === 0, 'y la puerta corta la escritura aunque se le pida por otro camino');
  const directo = await x.page.evaluate(async id => { try { const r = await fetch('https://api.spotify.com/v1/playlists/' + id + '/items', { method: 'POST', headers: { Authorization: 'Bearer ' + window.SS.estado.sp.a, 'Content-Type': 'application/json' }, body: JSON.stringify({ uris: ['spotify:track:x'] }) }); return r.status; } catch (e) { return 'error'; } }, casa.id);
  es(directo === 403 && casa.pistas.length === 2, 'aunque alguien se saltase la puerta, sin ese permiso Spotify responde 403 y no cambia nada');
  x.mundo.escrituras.length = 0; x.mundo.spotifyNoGet.length = 0; // ese POST era de la propia prueba

  // ---------- Se vuelve a conectar y Spotify concede la escritura: sigue sin salir nada hasta confirmar ----------
  x.mundo.opc.scopeSpotify = null;
  await pestana(x.page, 'Cuentas');
  await boton(x.page, 'Volver a conectar Spotify').click();
  await x.page.waitForFunction(() => document.body.innerText.indexOf('Spotify conectado.') >= 0 || !!document.querySelector('.aviso.error'), null, { timeout: 15000 });
  await x.page.waitForFunction(() => /como Prueba/.test(document.body.innerText) && !!window.SS.estado.xml, null, { timeout: 15000 });
  t = await cuerpo(x.page);
  es(t.indexOf('Permisos concedidos: ' + PEDIDOS + '.') >= 0 && /Solo añadir/.test(await x.page.locator('.candado').innerText()) && !/solo con permisos de lectura/.test(t), 'tras volver a conectar, Spotify concede la escritura y el indicador pasa a «Solo añadir»');
  await pestana(x.page, 'rekordbox a Spotify');
  es(/Primero simula/.test(await cuerpo(x.page)) && await boton(x.page, 'Preparar la sincronización (no envía nada)').isDisabled(), 'sin simulación no se puede preparar la sincronización');
  await simula(x.page);
  es(/^Bloqueado.*falta la confirmación del usuario/.test(await intenta(x.page, llamada)) && x.mundo.escrituras.length === 0, 'con el permiso concedido y la simulación hecha, la escritura sin confirmar no sale');
  const gPrep = aSpot(x).length, dPrep = x.mundo.eventos.length;
  await prepara(x);
  es(aSpot(x).length === gPrep && x.mundo.eventos.length === dPrep, 'preparar la sincronización no pide nada a Spotify ni guarda nada en Dropbox');
  t = await x.page.locator('#sinc-conf').innerText();
  es(await x.page.locator('#sinc-conf li.fila').count() === 7 && await x.page.locator('#sinc-conf input.marca:checked').count() === 0, 'la pantalla enseña las 7 playlists de rekordbox del mapa y ninguna viene marcada');
  es(/Ninguna playlist marcada: no se envía nada\./.test(t) && await x.page.locator('#sinc-conf .acciones .btn', { hasText: /^Confirmar/ }).isDisabled(), 'sin ninguna marcada, «Confirmar» está apagado');
  es(/XML de rekordbox: último cambio el 23\/11\/2026 14:05\. Simulación del \d\d\/\d\d\/\d{4} \d\d:\d\d\. Spotify leído el /.test(t), 'dice de cuándo son el XML, la simulación y la lectura de Spotify');
  t = await fila(x, 'NS - House').innerText();
  es(/En Spotify es privada y tiene 2 canciones\. Se añadirían 8 \(\d+ con aviso\)\./.test(t), 'de cada playlist dice si es privada, cuántas tiene y cuántas se añadirían: ' + t.replace(/\n/g, ' ').slice(0, 130));
  es(/En Spotify es pública y tiene 0 canciones\. Se añadirían 5/.test(await fila(x, 'NS - Techno').innerText()) && /Se añadirían 130\./.test(await fila(x, 'OG - Larga').innerText()), 'y si es pública; en «OG - Larga» son 130');
  t = await fila(x, 'sin pareja').innerText();
  es(/New School \/ Chill → sin pareja/.test(t) && /No se puede marcar: no tiene pareja en Spotify\./.test(t) && await fila(x, 'sin pareja').locator('input.marca').isDisabled(), 'una playlist sin pareja no se puede marcar');
  await fila(x, 'NS - House').getByRole('button', { name: 'Ver las 8', exact: true }).click();
  t = await fila(x, 'NS - House').innerText();
  es(/Nora Vex — Paper Lanterns \(Extended Mix\) → Nora Vex — Paper Lanterns/.test(t) && !/Glass Harbor/.test(t) && !/Midnigth Train/.test(t), 'la lista de una playlist enseña solo las que la simulación da como «se añadirían» (ni las que ya están ni las dudosas)');
  await marca(x, 'NS - Techno');
  t = await x.page.locator('#sinc-total').innerText();
  es(/Marcadas: 1 playlist, 5 canciones\. Gasta 1 escritura y unas 2 lecturas de Spotify\./.test(t) && await boton(x.page, 'Confirmar: añadir 5 canciones a 1 playlist').count() === 1, 'al marcar una, dice cuánto es y cuánto gasta: ' + t);
  // con la confirmación en pantalla y la playlist marcada, la misma llamada pedida por otro camino sigue cortada, y cualquier variante también
  const uriOk = D.aAnadir('ns', 'Techno')[0], idOtra = pl(P, 'VARIOS - Otra').id;
  const variantes = [
    llamada,
    ['POST', '/playlists/' + techno.id + '/items', { cuerpo: { uris: [uriOk] } }],
    ['POST', '/playlists/' + casa.id + '/items', { cuerpo: { uris: D.aAnadir('ns', 'House') } }],
    ['POST', '/playlists/' + idOtra + '/items', { cuerpo: { uris: [uriOk] } }],
    ['POST', '/playlists/' + techno.id + '/items?position=0', { cuerpo: { uris: [uriOk] } }],
    ['POST', '/playlists/' + techno.id + '/items', { cuerpo: { uris: [uriOk], position: 0 } }],
    ['PUT', '/playlists/' + techno.id + '/items', { cuerpo: { uris: [uriOk] } }],
    ['DELETE', '/playlists/' + techno.id + '/items', { cuerpo: { items: [{ uri: uriOk }] } }],
    ['POST', '/me/playlists', { cuerpo: { name: 'NS - Nueva' } }],
    ['PUT', '/me/tracks', { cuerpo: { ids: [D.cat.like1.id] } }],
    ['PUT', '/me/library', { cuerpo: { uris: [uriOk] } }],
  ];
  const coladas = [];
  for (const it of variantes) if (!/^Bloqueado/.test(await intenta(x.page, it))) coladas.push(it[0] + ' ' + it[1]);
  es(coladas.length === 0 && x.mundo.escrituras.length === 0, 'ni la llamada exacta ni sus variantes salen sin pasar por «Confirmar» (' + (coladas.join(', ') || 'ninguna colada') + ')');
  await boton(x.page, 'Cancelar').click();
  es(await x.page.locator('#sinc-conf').count() === 0 && x.mundo.escrituras.length === 0, '«Cancelar» cierra la confirmación sin enviar nada');

  // ---------- Una sola playlist, confirmada: copia, relectura, una escritura y comprobación ----------
  await prepara(x);
  es(await x.page.locator('#sinc-conf input.marca:checked').count() === 0, 'al preparar otra vez, vuelve a no haber ninguna marcada');
  await marca(x, 'NS - Techno');
  nPet = aSpot(x).length;
  ev0 = x.mundo.eventos.length;
  await confirma(x);
  ev = x.mundo.eventos.slice(ev0), sp = ev.filter(e => /^sp /.test(e));
  es(sp.join(' | ') === 'sp GET ' + rutaDe(techno) + ' | sp POST ' + rutaDe(techno) + ' | sp GET ' + rutaDe(techno), 'al confirmar: relee la playlist de Spotify, envía una escritura y vuelve a leerla (' + sp.join(' | ').split(techno.id).join('<techno>') + ')');
  const iCopia = ev.findIndex(e => /^db sube \/copias\/antes-de-sincronizar-/.test(e)), iPost = ev.findIndex(e => /^sp POST/.test(e)), iPrimera = ev.findIndex(e => /^sp /.test(e));
  es(iCopia >= 0 && iCopia < iPrimera && iCopia < iPost, 'la copia se guarda en Dropbox antes de la primera petición a Spotify y antes de escribir');
  es(archivos(x, COMPLETA).length === 1 && ev.findIndex(e => /^db sube \/copias\/spotify-completa-/.test(e)) > iCopia && ev.findIndex(e => /^db sube \/copias\/spotify-completa-/.test(e)) < iPrimera, 'como no había ninguna copia completa, también se guarda una, antes de pedir nada a Spotify');
  w = x.mundo.escrituras;
  es(w.length === 1 && w[0].metodo === 'POST' && w[0].ruta === rutaDe(techno) && w[0].q === '' && w[0].cuerpo === JSON.stringify({ uris: D.aAnadir('ns', 'Techno') }) && /^application\/json/.test(w[0].tipo),
    'lo único que sale que no es GET: un POST a «NS - Techno» con sus 5 canciones, en el orden de rekordbox, y nada más');
  es(JSON.stringify(uris(techno)) === JSON.stringify(D.aAnadir('ns', 'Techno')) && P.every(p => p === techno || JSON.stringify(uris(p)) === JSON.stringify(ini[p.name])), 'en Spotify «NS - Techno» pasa a tener esas 5 y ninguna otra playlist cambia');
  t = await resultado(x);
  es(/Última sincronización \([^)]+\): completa: añadidas 5 canciones en 1 playlist, comprobadas releyendo cada playlist\./.test(t) && /«NS - Techno»: añadidas 5 \(0 antes, 5 ahora\)\. Comprobado releyendo la playlist\./.test(t), 'el resultado dice lo añadido y que se ha comprobado releyendo: ' + t.replace(/\n/g, ' ').slice(0, 170));
  antes = archivos(x, ANTES), regs = archivos(x, REGISTRO);
  ja = antes.length === 1 ? JSON.parse(antes[0].texto) : null, jr = regs.length === 1 ? JSON.parse(regs[0].texto) : null;
  es(!!ja && ja.playlists.length === 1 && ja.playlists[0].nombre === 'NS - Techno' && ja.playlists[0].canciones.length === 0 && ja.playlists[0].se_van_a_anadir.map(c => c.uri).join() === D.aAnadir('ns', 'Techno').join(), 'la copia previa lleva la playlist tal como estaba y lo que se iba a añadir');
  es(!!jr && jr.final === 'completa' && jr.copia_previa === antes[0].ruta.split('/').pop() && jr.playlists[0].anadidas.map(c => c.uri).join() === D.aAnadir('ns', 'Techno').join() && jr.playlists[0].enviadas_sin_comprobar.length === 0 && /Kilo X Lima — Night Bus/.test(jr.playlists[0].anadidas[0].rekordbox),
    'y queda un registro en Dropbox con lo añadido, canción a canción');
  es(t.indexOf(antes[0].ruta.split('/').pop()) >= 0 && t.indexOf(regs[0].ruta.split('/').pop()) >= 0, 'el resultado nombra la copia y el registro');
  await pestana(x.page, 'Diagnóstico');
  dg = await x.page.locator('#diag').inputValue();
  es(/escrituras enviadas: 1;/.test(dg) && /Sincronización: [^\n]* \(v0\.4\.0\): completa: añadidas 5 canciones en 1 playlist[^\n]*\n  copia previa: antes-de-sincronizar-[^\n]*; registro: sincronizacion-[^\n]*\n  NS - Techno \(pública\): ok; pedidas 5; antes 0; después 5; añadidas 5\n    lote 1: 5; enviado: sí, una vez; respuesta: 201; sello nuevo: sí; relecturas: 1; cuadra: sí; se ven: 5 de 5\n/.test(dg), 'y el diagnóstico lleva la sincronización entera');
  es((await x.page.evaluate(() => JSON.parse(localStorage.getItem('ss.uso')).n)) === x.mundo.spGets + 1, 'la escritura cuenta en las peticiones del día');
  await x.page.locator('.candado').click();
  t = await x.page.locator('.candado-panel').innerText();
  es(/y 1 escritura\./.test(t) && /solo deja salir una cosa: añadir canciones al final de tus playlists «NS - …» y «OG - …» del mapa/.test(t) && /user-library-modify/.test(t), 'el panel del indicador cuenta la escritura y dice qué es lo único que puede escribir');
  await x.page.locator('.candado').click();
  await pestana(x.page, 'rekordbox a Spotify');
  es(await x.page.locator('#sinc-conf').count() === 0 && /Primero simula/.test(await cuerpo(x.page)) && await boton(x.page, 'Preparar la sincronización (no envía nada)').isDisabled(), 'tras sincronizar hay que simular otra vez para preparar otra');
  es(/^Bloqueado/.test(await intenta(x.page, llamada)) && x.mundo.escrituras.length === 1, 'y la misma escritura ya no sale por ningún camino');

  // ---------- El resto, de una vez: seis lotes, y «OG - Larga» en dos (100 + 30) ----------
  const gSim = aSpot(x).length;
  await simula(x.page, 'Simular');
  es(aSpot(x).length - gSim <= 2 && !/fecha desconocida/.test(await cuerpo(x.page)), 'la simulación siguiente vuelve a comprobar Spotify con 2 peticiones (lo escrito ya está guardado) y no dice «fecha desconocida»');
  await prepara(x);
  t = await fila(x, 'NS - Techno').innerText();
  es(/Nada que añadir: no se puede marcar\./.test(t) && await fila(x, 'NS - Techno').locator('input.marca').isDisabled(), 'lo que se acaba de añadir ya consta como que está: en «NS - Techno» no queda nada que añadir');
  await boton(x.page, 'Marcar todas').click();
  t = await x.page.locator('#sinc-total').innerText();
  es(/Marcadas: 5 playlists, 142 canciones\. Gasta 6 escrituras y unas \d+ lecturas de Spotify\./.test(t), '«Marcar todas» marca las cinco en las que hay algo que añadir: ' + t);
  ev0 = x.mundo.eventos.length;
  await confirma(x);
  ev = x.mundo.eventos.slice(ev0);
  w = x.mundo.escrituras.slice(1);
  const esperadas = [['NS - House', D.aAnadir('ns', 'House')], ['NS - Raw / UK Garage', D.aAnadir('ns', 'Raw/UK Garage')], ['OG - All', D.aAnadir('og', 'ALL')], ['OG - Classics', D.aAnadir('og', 'Classics')],
    ['OG - Larga', D.largas.slice(0, 100).map(c => c.uri)], ['OG - Larga', D.largas.slice(100).map(c => c.uri)]];
  es(w.length === 6 && w.every((e, i) => e.metodo === 'POST' && e.ruta === rutaDe(pl(P, esperadas[i][0])) && e.cuerpo === JSON.stringify({ uris: esperadas[i][1] })),
    'salen seis escrituras, una por lote y en orden, cada una con exactamente sus canciones; «OG - Larga» va en dos lotes de 100 y 30 (' + w.map(e => JSON.parse(e.cuerpo).uris.length).join(', ') + ')');
  // tras cada POST, lo siguiente que se pide a Spotify es la lectura de esa misma playlist; y antes de cada playlist, su lectura
  const sp2 = ev.filter(e => /^sp /.test(e));
  es(sp2.every((e, i) => !/^sp POST/.test(e) || (sp2[i - 1] === e.replace('POST', 'GET') && sp2[i + 1] === e.replace('POST', 'GET'))), 'cada escritura va entre dos lecturas de su playlist: la de justo antes y la de comprobación');
  es(ev.filter(e => /^db sube \/copias\/spotify-completa-/.test(e)).length === 0 && archivos(x, ANTES).length === 2 && archivos(x, REGISTRO).length === 2 && ev.findIndex(e => /^db sube \/copias\/antes-/.test(e)) < ev.findIndex(e => /^sp /.test(e)),
    'esta vez no se repite la copia completa: se guarda la de las playlists que se van a tocar, antes de pedir nada a Spotify');
  es(esperadas.slice(0, 4).every(([n, u]) => JSON.stringify(uris(pl(P, n))) === JSON.stringify(ini[n].concat(u))) && JSON.stringify(uris(larga)) === JSON.stringify(D.largas.map(c => c.uri)),
    'cada playlist queda como estaba más lo suyo, al final y en orden');
  es(P.every(p => new Set(uris(p)).size === uris(p).length) && ['Sound All', 'Sound Down', 'Sound Try', 'VARIOS - Larga', 'VARIOS - Otra', 'Lista ajena'].every(n => JSON.stringify(uris(pl(P, n))) === JSON.stringify(ini[n])),
    'ninguna canción queda repetida en una playlist, y las playlists de fuera del mapa no cambian');
  const enDos = u => P.filter(p => /^(NS|OG) - /.test(p.name) && uris(p).indexOf(u) >= 0).map(p => p.name).join(' + ');
  es(enDos(D.cat.velvetRmx.uri) === 'NS - Techno + NS - Raw / UK Garage' && enDos(D.cat.signal.uri) === 'OG - All + OG - Classics' && enDos(D.cat.cobaltExt.uri) === 'NS - House + OG - All', 'una canción que en rekordbox está en dos playlists va a las dos, una vez a cada una');
  t = await resultado(x);
  es(/completa: añadidas 142 canciones en 5 playlists/.test(t) && /«OG - Larga»: añadidas 130 \(0 antes, 130 ahora\)/.test(t), 'el resultado: ' + t.replace(/\n/g, ' ').slice(0, 120));
  jr = JSON.parse(archivos(x, REGISTRO).sort((a, b) => (a.ruta > b.ruta ? 1 : -1))[1].texto);
  es(jr.playlists.length === 5 && jr.playlists[4].lotes.length === 2 && jr.playlists[4].anadidas.length === 130 && jr.playlists.every(p => p.estado === 'ok'), 'y el registro lleva las cinco playlists, con los dos lotes de la larga');
  await simula(x.page, 'Simular');
  const fin = await numeros(x.page);
  es(fin.add === 0, 'una simulación después ya no encuentra nada que añadir (se añadirían: ' + fin.add + ')');
  es(/no hay nada|Nada que añadir/.test(await (async () => { await prepara(x); return x.page.locator('#sinc-conf').innerText(); })()) && await x.page.locator('#sinc-conf input.marca:enabled').count() === 0, 'y la pantalla de sincronización no deja marcar ninguna');
  es(x.mundo.spotifyNoGet.every(e => /^POST \/v1\/playlists\/[^/]+\/items$/.test(e)) && x.mundo.escrituras.length === 7, 'en todo el caso, a Spotify solo han salido esas siete escrituras');
  raros = x.consola.filter(m => !/^Bloqueado|Error: Bloqueado/.test(m));
  es(raros.length === 0, 'la sincronización, sin errores en la consola: ' + raros.slice(0, 3).join(' | '));
  await x.ctx.close();

  // ---------- El mapa apunta a una playlist con otro nombre: la pantalla lo dice y no deja marcarla ----------
  P = D.copiaBiblio();
  x = await nuevo({ playlists: P });
  await conectaTodo(x);
  await simula(x.page);
  await x.page.locator('select[aria-label="Playlist de Spotify para Raw/UK Garage"]').selectOption({ label: 'VARIOS - Otra' });
  await simula(x.page, 'Simular');
  await prepara(x);
  t = await fila(x, 'VARIOS - Otra').innerText();
  es(/New School \/ Raw\/UK Garage → VARIOS - Otra/.test(t) && /No se puede marcar: el nombre de «VARIOS - Otra» no empieza por «NS - » ni por «OG - »\./.test(t) && await fila(x, 'VARIOS - Otra').locator('input.marca').isDisabled(),
    'si el mapa apunta a una playlist que no se llama «NS - …» ni «OG - …», la pantalla lo dice y no deja marcarla');
  await boton(x.page, 'Marcar todas').click();
  es(!(await x.page.evaluate(() => window.SS.estado.plan.marcadas['NS/Raw/UK Garage'])) && /Marcadas: 4 playlists/.test(await x.page.locator('#sinc-total').innerText()), '«Marcar todas» tampoco la marca');
  // aunque la pantalla la diese por marcada (un fallo del código), no sale nada: se vuelve a comprobar al confirmar
  await x.page.evaluate(() => { const p = window.SS.estado.plan, f = p.filas.find(q => q.clave === 'NS/Raw/UK Garage'); p.marcadas = {}; p.marcadas[f.clave] = true; f.bloqueo = ''; f.uris = [window.SS.estado.plan.filas[1].uris[0]]; f.antes = []; window.SS.pinta(); });
  nPet = aSpot(x).length;
  await confirma(x);
  es(x.mundo.escrituras.length === 0 && aSpot(x).length === nPet && archivos(x, ANTES).length === 0 && JSON.stringify(uris(pl(P, 'VARIOS - Otra'))) === JSON.stringify([D.cat.lady.uri, D.cat.openWater.uri]) &&
    await x.page.locator('.aviso.error', { hasText: 'No se ha enviado nada a Spotify' }).count() >= 1, 'y si aun así llegase marcada a «Confirmar», no se envía nada: ni copia, ni lecturas, ni escritura');
  es(/^Bloqueado/.test(await intenta(x.page, ['POST', '/playlists/' + pl(P, 'VARIOS - Otra').id + '/items', { cuerpo: { uris: [D.cat.glass.uri] } }])) && x.mundo.escrituras.length === 0, 'y la puerta corta cualquier escritura en ella');
  await x.ctx.close();

  // ---------- Entre simular y confirmar una playlist cambia: se relee justo antes y esa no se toca ----------
  P = D.copiaBiblio();
  x = await nuevo({ playlists: P });
  await conectaTodo(x);
  await simula(x.page);
  await prepara(x);
  await marca(x, 'NS - House');
  await marca(x, 'NS - Techno');
  const casa2 = pl(P, 'NS - House'), techno2 = pl(P, 'NS - Techno');
  casa2.pistas.push({ added_at: '2026-11-24T10:00:00Z', t: D.cat.paper }); casa2.snapshot_id += 'm'; // alguien añade a mano una de las que se iban a añadir
  ev0 = x.mundo.eventos.length;
  await confirma(x);
  sp = x.mundo.eventos.slice(ev0).filter(e => /^sp /.test(e));
  es(sp.join(' | ') === ['sp GET ' + rutaDe(casa2), 'sp GET ' + rutaDe(techno2), 'sp POST ' + rutaDe(techno2), 'sp GET ' + rutaDe(techno2)].join(' | '), 'la playlist que ha cambiado se relee y no se escribe en ella; la otra sigue adelante');
  t = await resultado(x);
  es(casa2.pistas.length === 3 && x.mundo.escrituras.length === 1 && /terminada con 1 playlist sin tocar/.test(t) && /«NS - House»: no se ha tocado\. Al releerla justo antes de escribir no era la misma que vio la simulación \(ahora tiene 3 canciones\)\. Simula otra vez\./.test(t) && /«NS - Techno»: añadidas 5/.test(t),
    'y el resultado lo dice: ' + t.replace(/\n/g, ' ').slice(0, 150));
  await simula(x.page, 'Simular');
  await prepara(x);
  es(/tiene 3 canciones\. Se añadirían 7/.test(await fila(x, 'NS - House').innerText()), 'al simular otra vez, la que se añadió a mano ya cuenta como que está (quedan 7 por añadir)');
  await x.ctx.close();

  // ---------- Spotify rechaza o falla: una sola escritura, nunca se reintenta, se relee y se para ----------
  const fallos = [
    { n: 'un 403', esc: { estado: 403, mensaje: 'Forbidden' }, sec: 'GET POST GET', queda: 0, estado: 'rechazada', re: /«NS - Techno»: Spotify ha rechazado la escritura: Spotify respondió 403: Forbidden [^.]*\. Al releer, de las 5 enviadas se ven 0 \(0 antes, 0 ahora\)\. La escritura no se ha repetido\./ },
    { n: 'un 500 que no llegó a aplicarse', esc: { estado: 500, mensaje: 'Server error' }, sec: 'GET POST GET GET', queda: 0, estado: 'incierta', re: /«NS - Techno»: enviada una vez, y no se sabe si llegó: Spotify respondió 500: Server error [^.]*\. Al releer, de las 5 enviadas se ven 0 \(0 antes, 0 ahora\)\. La escritura no se ha repetido\./ },
    { n: 'un 500 que sí se aplicó', esc: { estado: 500, mensaje: 'Server error', llega: true }, sec: 'GET POST GET', queda: 5, estado: 'llego', re: /«NS - Techno»: Spotify no confirmó la escritura: Spotify respondió 500[^.]*\. Al releer están las 5 enviadas \(0 antes, 5 ahora\); la escritura no se ha repetido\./ },
    { n: 'un 401 (la sesión ha caducado en Spotify)', esc: { estado: 401, mensaje: 'The access token expired' }, sec: 'GET POST GET', queda: 0, estado: 'rechazada', re: /«NS - Techno»: Spotify ha rechazado la escritura: Spotify respondió 401: The access token expired [^.]*\. Al releer, de las 5 enviadas se ven 0 \(0 antes, 0 ahora\)\. La escritura no se ha repetido\./ },
    { n: 'la conexión se corta pero sí llegó', esc: { red: true, llega: true }, sec: 'GET POST GET', queda: 5, estado: 'llego', re: /«NS - Techno»: Spotify no confirmó la escritura: Se cortó la conexión con Spotify al enviar la escritura\. Al releer están las 5 enviadas \(0 antes, 5 ahora\); la escritura no se ha repetido\./ },
  ];
  for (const f of fallos) {
    P = D.copiaBiblio();
    x = await nuevo({ playlists: P, escritura: f.esc });
    await conectaTodo(x);
    await simula(x.page);
    await prepara(x);
    await marca(x, 'NS - Techno');
    await marca(x, 'OG - All');
    ev0 = x.mundo.eventos.length;
    await confirma(x);
    sp = x.mundo.eventos.slice(ev0).filter(e => /^sp /.test(e)).map(e => e.split(' ')[1]);
    es(x.mundo.escrituras.length === 1 && sp.join(' ') === f.sec && x.mundo.refrescos.sp === 0, 'si Spotify responde con ' + f.n + ': una sola escritura, sin reintentos, y después relee (' + sp.join(' ') + ')');
    t = await resultado(x);
    es(f.re.test(t) && /parada\. /.test(t) && /Ninguna escritura se ha repetido\./.test(t) && pl(P, 'NS - Techno').pistas.length === f.queda, 'y dice lo que ha pasado de verdad (' + f.n + '): ' + t.replace(/\n/g, ' ').replace(/^[^:]*:[^:]*: /, '').slice(0, 150));
    es(/«OG - All»: no se ha tocado: la sincronización se paró antes de llegar a ella\./.test(t) && pl(P, 'OG - All').pistas.length === 2 && x.mundo.itemsDe[pl(P, 'OG - All').id] === 1, 'la sincronización se para ahí: la siguiente playlist ni se relee ni se toca (' + f.n + ')');
    jr = archivos(x, REGISTRO).map(a => JSON.parse(a.texto))[0];
    es(!!jr && jr.playlists[0].estado === f.estado && jr.playlists[0].anadidas.length === f.queda && jr.playlists[0].enviadas_que_no_se_ven_al_releer.length === 5 - f.queda && jr.playlists[1].estado === 'pendiente' && /^parada|llegó|rechazado|No se sabe/.test(jr.final), 'y el registro apunta lo que se envió y lo que se ve al releer (' + f.n + ')');
    await x.ctx.close();
  }

  // ---------- Spotify corta (429) justo en una escritura: no se envía nada más, ni la comprobación ----------
  P = D.copiaBiblio();
  x = await nuevo({ playlists: P, escritura: { estado: 429, cuota: true } });
  await conectaTodo(x);
  await simula(x.page);
  await prepara(x);
  await marca(x, 'NS - Techno');
  await marca(x, 'OG - All');
  ev0 = x.mundo.eventos.length;
  await confirma(x);
  sp = x.mundo.eventos.slice(ev0).filter(e => /^sp /.test(e)).map(e => e.split(' ')[1]);
  es(x.mundo.escrituras.length === 1 && sp.join(' ') === 'GET POST' && pl(P, 'NS - Techno').pistas.length === 0, 'un 429 a la escritura: se para ahí y no se envía ni la lectura de comprobación (' + sp.join(' ') + ')');
  t = await resultado(x);
  es(/«NS - Techno»: Spotify cortó las peticiones al enviar 5 canciones\. No se puede comprobar ahora y la escritura no se repite: míralo en Spotify\./.test(t) && /«OG - All»: no se ha tocado/.test(t), 'y el resultado lo dice');
  cw = await lsCorteDe(x);
  es(cw && cw.escr === true && cw.cuota === true && cw.ruta === '/playlists/' + pl(P, 'NS - Techno').id + '/items' && !cw.fin, 'el corte queda apuntado como corte de una escritura');
  t = await x.page.locator('.corte-sp').first().innerText();
  es(/El rechazo fue a una escritura\./.test(t) && /La app no repite una escritura para probar/.test(t) && await boton(x.page, 'Probar ahora (gasta 1 petición)').count() === 0, 'y el aviso no ofrece «Probar ahora»: la app no escribe para probar');
  es(await boton(x.page, 'Preparar la sincronización (no envía nada)').isDisabled() && /Spotify tiene cortadas las peticiones de la app/.test(await cuerpo(x.page)), 'mientras dura el corte no se puede preparar otra sincronización');
  jr = archivos(x, REGISTRO).map(a => JSON.parse(a.texto))[0];
  es(!!jr && jr.playlists[0].estado === 'corte' && jr.playlists[0].enviadas_sin_comprobar.length === 5 && jr.playlists[0].anadidas.length === 0, 'y el registro apunta esas 5 como enviadas y sin comprobar');
  await x.ctx.close();

  // ---------- Si la copia no se puede guardar, no se escribe ----------
  P = D.copiaBiblio();
  x = await nuevo({ playlists: P, subidaFalla: /antes-de-sincronizar/ });
  await conectaTodo(x);
  await simula(x.page);
  await prepara(x);
  await marca(x, 'NS - Techno');
  nPet = aSpot(x).length;
  await confirma(x);
  es(x.mundo.escrituras.length === 0 && aSpot(x).length === nPet && pl(P, 'NS - Techno').pistas.length === 0 &&
    await x.page.locator('.aviso.error', { hasText: /No se ha podido guardar la copia en Dropbox.*Sin copia no se escribe\. No se ha enviado nada a Spotify\./ }).count() === 1, 'si la copia no se guarda en Dropbox, no se pide ni se escribe nada en Spotify, y lo dice');
  await x.ctx.close();

  // ---------- Spotify concede solo uno de los dos permisos de escritura ----------
  x = await nuevo({ playlists: D.copiaBiblio(), scopeSpotify: LECTURA + ' playlist-modify-public' });
  await conectaTodo(x);
  await simula(x.page);
  es(/Solo añadir/.test(await x.page.locator('.candado').innerText()) && await boton(x.page, 'Preparar la sincronización (no envía nada)').count() === 0, 'con solo uno de los dos permisos de escritura no se ofrece sincronizar y el indicador no dice «Solo lectura»');
  await x.ctx.close();
  }

  // ================= etapa 2: lo que puede torcerse alrededor de una escritura =================
  const monta = async (opc, marcas) => {
    P = D.copiaBiblio();
    x = await nuevo(Object.assign({ playlists: P }, opc || {}));
    await conectaTodo(x);
    await simula(x.page);
    await prepara(x);
    for (const n of marcas) await marca(x, n);
    ev0 = x.mundo.eventos.length;
  };
  const spDesde = y => y.mundo.eventos.slice(ev0).filter(e => /^sp /.test(e)).map(e => e.split(' ')[1]).join(' ');
  const registro = y => archivos(y, REGISTRO).map(a => JSON.parse(a.texto))[0];
  const techDe = lista => pl(lista, 'NS - Techno');

  if (!COLA) {
  // ---------- Spotify dice 201 pero al releer no está todo: se para, no se repite, y luego solo propone lo que falta ----------
  await monta({ escritura: { parcial: 3 } }, ['NS - Techno', 'OG - All']);
  await confirma(x);
  t = await resultado(x);
  es(x.mundo.escrituras.length === 1 && spDesde(x) === 'GET POST GET' && /«NS - Techno»: Spotify respondió 201, pero al releer no cuadra: de las 5 enviadas se ven 3 \(0 antes, 3 ahora\)\. La escritura no se ha repetido\. Spotify puede tardar en enseñar un cambio: espera un par de minutos y simula otra vez antes de añadir nada a mano\./.test(t) && /«OG - All»: no se ha tocado/.test(t),
    'un 201 que solo añade 3 de 5: lo detecta al releer, no repite la escritura y se para: ' + t.replace(/\n/g, ' ').slice(0, 110));
  jr = registro(x);
  es(!!jr && jr.playlists[0].estado === 'nocuadra' && jr.playlists[0].anadidas.length === 3 && jr.playlists[0].enviadas_que_no_se_ven_al_releer.length === 2, 'el registro separa las 3 que están de las 2 que no');
  await simula(x.page, 'Simular');
  await prepara(x);
  t = await fila(x, 'NS - Techno').innerText();
  es(/No se puede marcar: la app escribió en ella hace menos de dos minutos y no pudo comprobar del todo cómo quedó: espera a las \d\d:\d\d y simula otra vez\./.test(t) && await fila(x, 'NS - Techno').locator('input.marca').isDisabled(),
    'durante dos minutos no deja volver a escribir en esa playlist (lo que «falta» puede estar y no verse todavía): ' + t.replace(/\n/g, ' ').slice(-120));
  await x.page.evaluate(() => { const d = JSON.parse(localStorage.getItem('ss.dudosas') || '{}'); Object.keys(d).forEach(k => { d[k] -= 3 * 60000; }); localStorage.setItem('ss.dudosas', JSON.stringify(d)); });
  await boton(x.page, 'Cancelar').click();
  await prepara(x);
  es(/tiene 3 canciones\. Se añadirían 2/.test(await fila(x, 'NS - Techno').innerText()) && !(await fila(x, 'NS - Techno').locator('input.marca').isDisabled()), 'pasado ese tiempo propone solo las 2 que faltan, no las 5');
  await x.ctx.close();

  // ---------- Spotify dice 201 y las añade dos veces: se ve al releer y no se toca nada más ----------
  await monta({ escritura: { doble: true } }, ['NS - Techno', 'OG - All']);
  await confirma(x);
  t = await resultado(x);
  es(x.mundo.escrituras.length === 1 && /no cuadra: de las 5 enviadas se ven 5, 5 de ellas repetidas \(0 antes, 10 ahora\)/.test(t) && /«OG - All»: no se ha tocado/.test(t), 'si aparecen repetidas (Spotify las añade dos veces), lo dice y se para');
  await simula(x.page, 'Simular');
  await prepara(x);
  es(/Nada que añadir/.test(await fila(x, 'NS - Techno').innerText()) && x.mundo.escrituras.length === 1, 'y después no propone añadirlas otra vez');
  await x.ctx.close();

  // ---------- Spotify acepta y tarda en enseñarlo: se relee una vez más (leer, no escribir) ----------
  await monta({ escritura: { oculta: 1 } }, ['NS - Techno', 'OG - All']);
  t0 = Date.now();
  await confirma(x);
  t = await resultado(x);
  es(x.mundo.escrituras.length === 2 && spDesde(x) === 'GET POST GET GET GET POST GET GET' && /completa: añadidas 7 canciones en 2 playlists/.test(t) && Date.now() - t0 >= 6000,
    'si Spotify acepta el lote y al releer aún no se ve, espera y lee una vez más; escribir, una sola vez por lote (' + spDesde(x) + ')');
  await pestana(x.page, 'Diagnóstico');
  es(/lote 1: 5; enviado: sí, una vez; respuesta: 201; sello nuevo: sí; relecturas: 2; cuadra: sí; se ven: 5 de 5/.test(await x.page.locator('#diag').inputValue()), 'y el diagnóstico dice que hizo falta una segunda lectura');
  await x.ctx.close();

  await monta({ escritura: { oculta: 2 } }, ['NS - Techno', 'OG - All']);
  await confirma(x);
  t = await resultado(x);
  es(x.mundo.escrituras.length === 1 && spDesde(x) === 'GET POST GET GET' && /Spotify respondió 201, pero al releer no cuadra: de las 5 enviadas se ven 0 \(0 antes, 0 ahora\)\. La escritura no se ha repetido\. Spotify puede tardar en enseñar un cambio/.test(t) && techDe(P).pistas.length === 5,
    'si tras la segunda lectura sigue sin verse, se para sin repetir la escritura (en Spotify sí están)');
  await simula(x.page, 'Simular');
  await prepara(x);
  es(/Nada que añadir/.test(await fila(x, 'NS - Techno').innerText()) && x.mundo.escrituras.length === 1, 'y la simulación siguiente ya las ve: no propone añadirlas otra vez');
  await x.ctx.close();

  // ---------- No se puede comprobar (falla la lectura de después) y, además, la lista de playlists va con retraso ----------
  await monta({ itemsFallaTrasEscribir: 403, listaAtrasada: true }, ['NS - Techno', 'OG - All']);
  await confirma(x);
  t = await resultado(x);
  es(x.mundo.escrituras.length === 1 && spDesde(x) === 'GET POST GET' && /«NS - Techno»: enviadas 5 canciones \(respuesta: 201\) y no se ha podido comprobar releyendo: Spotify respondió 403[^.]*\. La escritura no se repite: míralo en Spotify\./.test(t) && /«OG - All»: no se ha tocado/.test(t),
    'si la lectura de comprobación falla, lo dice, no repite la escritura y se para: ' + t.replace(/\n/g, ' ').slice(0, 100));
  jr = registro(x);
  es(!!jr && jr.playlists[0].estado === 'sincomprobar' && jr.playlists[0].enviadas_sin_comprobar.length === 5 && jr.playlists[0].anadidas.length === 0, 'el registro las apunta como enviadas y sin comprobar');
  x.mundo.opc.itemsFallaTrasEscribir = null;
  antesItems = x.mundo.itemsDe[techDe(P).id];
  await simula(x.page, 'Simular');
  await prepara(x);
  es(x.mundo.itemsDe[techDe(P).id] === antesItems + 1 && /Nada que añadir/.test(await fila(x, 'NS - Techno').innerText()) && x.mundo.escrituras.length === 1,
    'aunque la lista de playlists diga que nada ha cambiado, esa playlist se vuelve a pedir a Spotify: no se propone añadir lo que ya está');
  await x.ctx.close();

  // ---------- La página se cierra o se recarga con una escritura en vuelo ----------
  await monta({ escritura: { cuelga: true }, listaAtrasada: true }, ['NS - Techno', 'OG - All']);
  preguntas = 0;
  x.page.on('dialog', d => { preguntas++; d.accept().catch(() => {}); });
  await x.page.locator('#sinc-conf .acciones .btn', { hasText: /^Confirmar/ }).click();
  await x.page.waitForFunction(() => window.SS.estado.cont.spEscr === 1, null, { timeout: 30000 });
  for (let i = 0; i < 50 && x.mundo.escrituras.length < 1; i++) await x.page.waitForTimeout(100);
  await x.page.reload();
  await x.page.waitForSelector('.cab');
  await x.page.waitForFunction(() => !!window.SS.estado.xml, null, { timeout: 15000 });
  await pestana(x.page, 'rekordbox a Spotify');
  t = await resultado(x);
  es(preguntas === 1, 'al recargar con una sincronización en marcha, el navegador pregunta antes (' + preguntas + ')');
  es(x.mundo.escrituras.length === 1 && /sin terminar: o sigue en marcha en otra pestaña, o la página se cerró o se recargó antes de acabar/.test(t) && /«NS - Techno»: quedó a mitad de enviar 5 canciones \(si la página se cerró o se recargó ahí, no se sabe si llegaron\)\. La escritura no se repite/.test(t) && /«OG - All»: no se ha tocado/.test(t),
    'si la página se recarga con una escritura en vuelo, al volver dice hasta dónde llegó y que no se sabe si llegó: ' + t.replace(/\n/g, ' ').slice(0, 110));
  es(/El registro no se llegó a guardar/.test(t) && archivos(x, ANTES).length === 1 && archivos(x, REGISTRO).length === 0, 'dice que no hay registro y que la copia previa sí está');
  x.mundo.opc.escritura = null;
  antesItems = x.mundo.itemsDe[techDe(P).id];
  await simula(x.page);
  await prepara(x);
  es(x.mundo.itemsDe[techDe(P).id] === antesItems + 1 && /Nada que añadir/.test(await fila(x, 'NS - Techno').innerText()) && x.mundo.escrituras.length === 1 && techDe(P).pistas.length === 5,
    'y al simular otra vez esa playlist se pide de nuevo a Spotify (aunque la lista diga que no ha cambiado): no se añade dos veces');
  await x.ctx.close();

  // ---------- El registro no se puede guardar: la sincronización vale y lo dice ----------
  await monta({ subidaFalla: /^\/registro\// }, ['NS - Techno']);
  await confirma(x);
  t = await resultado(x);
  es(x.mundo.escrituras.length === 1 && /completa: añadidas 5 canciones en 1 playlist/.test(t) && /El registro no se ha podido guardar en Dropbox \(.*400.*\)\. Lo que se iba a añadir a cada playlist está en la copia previa, y cuántas se añadieron, aquí y en el diagnóstico\./.test(t), 'si el registro no se puede guardar, lo dice (lo añadido está comprobado y sale en el diagnóstico)');
  await pestana(x.page, 'Diagnóstico');
  es(/registro: NO GUARDADO/.test(await x.page.locator('#diag').inputValue()), 'y el diagnóstico también');
  await x.ctx.close();

  // ---------- Doble clic en «Confirmar»: una sola sincronización ----------
  await monta({ escritura: { espera: 400 } }, ['NS - Techno']);
  await x.page.evaluate(() => { const b = Array.from(document.querySelectorAll('#sinc-conf .acciones .btn')).find(q => /^Confirmar/.test(q.textContent)); b.click(); b.click(); });
  await libre(x);
  es(x.mundo.escrituras.length === 1 && techDe(P).pistas.length === 5 && archivos(x, ANTES).length === 1 && /completa: añadidas 5 canciones/.test(await resultado(x)), 'dos clics seguidos en «Confirmar» hacen una sola sincronización');
  await x.ctx.close();

  // ---------- Lo marcado no coincide con la simulación (un fallo del código): no sale nada ----------
  await monta(null, ['NS - Techno']);
  await x.page.evaluate(u => { window.SS.estado.plan.filas.find(q => q.clave === 'NS/Techno').uris.push(u); }, D.cat.glass.uri);
  nPet = aSpot(x).length;
  await confirma(x);
  es(x.mundo.escrituras.length === 0 && aSpot(x).length === nPet && archivos(x, ANTES).length === 0 && await x.page.locator('.aviso.error', { hasText: /Lo que se añadiría a «NS - Techno» ha cambiado.*No se ha enviado nada a Spotify\./ }).count() === 1,
    'si lo marcado lleva una canción que la simulación no da (un fallo del código), no se envía nada');
  await x.ctx.close();

  // ---------- Simulación de más de una hora ----------
  await monta(null, ['NS - Techno']);
  await x.page.evaluate(() => { const S = window.SS.estado; S.sim.fecha -= 61 * 60000; S.plan.sim = S.sim.fecha; window.SS.pinta(); });
  t = await x.page.locator('#sinc-conf').innerText();
  es(/La simulación tiene más de una hora: simula otra vez\./.test(t) && await x.page.locator('#sinc-conf .acciones .btn', { hasText: /^Confirmar/ }).isDisabled(), 'con una simulación de más de una hora, «Confirmar» se apaga y pide simular otra vez');
  await boton(x.page, 'Cancelar').click();
  es(await boton(x.page, 'Preparar la sincronización (no envía nada)').isDisabled() && x.mundo.escrituras.length === 0, 'y tampoco deja preparar otra');
  await x.ctx.close();

  // ---------- Spotify se ha vuelto a leer después de simular: la simulación ya no vale para sincronizar ----------
  await monta(null, ['NS - Techno']);
  await x.page.evaluate(() => { window.SS.estado.lib.leida += 1; window.SS.pinta(); }); // como si se hubiera leído otra vez
  t = await x.page.locator('#sinc-conf').innerText();
  es(/Spotify se ha vuelto a leer, o ha cambiado, después de la simulación: simula otra vez\./.test(t) && await x.page.locator('#sinc-conf .acciones .btn', { hasText: /^Confirmar/ }).isDisabled() && x.mundo.escrituras.length === 0,
    'si Spotify se ha vuelto a leer después de simular, «Confirmar» se apaga y pide simular otra vez');
  await x.ctx.close();

  // ---------- Dos playlists de rekordbox apuntan a la misma de Spotify ----------
  P = D.copiaBiblio();
  x = await nuevo({ playlists: P });
  await conectaTodo(x);
  await simula(x.page);
  await x.page.locator('select[aria-label="Playlist de Spotify para Raw/UK Garage"]').selectOption({ label: 'NS - Techno' });
  await simula(x.page, 'Simular');
  await prepara(x);
  const dos = fila(x, 'NS - Techno');
  es(await dos.count() === 2 && /No se puede marcar: hay 2 playlists de rekordbox que apuntan a «NS - Techno»\./.test(await dos.nth(0).innerText()) && /hay 2 playlists de rekordbox/.test(await dos.nth(1).innerText()) &&
    await dos.nth(0).locator('input.marca').isDisabled() && await dos.nth(1).locator('input.marca').isDisabled(), 'si dos playlists de rekordbox apuntan a la misma de Spotify, ninguna de las dos se puede marcar');
  await x.ctx.close();

  // ---------- «Parar»: solo entre lotes o entre playlists, nunca entre una escritura y su comprobación ----------
  P = D.copiaBiblio([D.playlist('OG - Larga', [])]);
  x = await nuevo({ playlists: P, xml: D.xmlLargo(), escritura: { espera: 1200 } });
  await conectaTodo(x);
  await simula(x.page);
  await prepara(x);
  await marca(x, 'OG - Larga');
  ev0 = x.mundo.eventos.length;
  await x.page.locator('#sinc-conf .acciones .btn', { hasText: /^Confirmar/ }).click();
  for (let i = 0; i < 100 && x.mundo.escrituras.length < 1; i++) await x.page.waitForTimeout(100);
  await boton(x.page, 'Parar').click();
  await libre(x);
  t = await resultado(x);
  const larga2 = pl(P, 'OG - Larga');
  es(x.mundo.escrituras.length === 1 && /^GET POST( GET)+$/.test(spDesde(x)) && larga2.pistas.length === 100 && /parada\. La paraste a mitad de «OG - Larga»\./.test(t) && /«OG - Larga»: parada a medias\. Añadidas 100 de 130 \(0 antes, 100 ahora\); lo añadido está comprobado\./.test(t),
    '«Parar» durante el primer lote: ese lote se termina y se comprueba, y el segundo no sale: ' + t.replace(/\n/g, ' ').slice(0, 110));
  jr = registro(x);
  es(!!jr && jr.playlists[0].estado === 'parada' && jr.playlists[0].anadidas.length === 100, 'el registro lleva las 100 añadidas');
  await simula(x.page, 'Simular');
  await prepara(x);
  es(/tiene 100 canciones\. Se añadirían 30\./.test(await fila(x, 'OG - Larga').innerText()), 'la simulación siguiente propone las 30 que faltan');
  await marca(x, 'NS - House');
  await marca(x, 'OG - Larga');
  ev0 = x.mundo.eventos.length;
  await x.page.locator('#sinc-conf .acciones .btn', { hasText: /^Confirmar/ }).click();
  for (let i = 0; i < 100 && x.mundo.escrituras.length < 2; i++) await x.page.waitForTimeout(100);
  await boton(x.page, 'Parar').click();
  await libre(x);
  t = await resultado(x);
  es(x.mundo.escrituras.length === 2 && spDesde(x) === 'GET POST GET' && larga2.pistas.length === 100 && /parada\. La paraste antes de empezar con «OG - Larga»\./.test(t) && /«NS - House»: añadidas 8/.test(t) && /«OG - Larga»: no se ha tocado/.test(t),
    '«Parar» durante una playlist: esa se termina y la siguiente ni se relee');
  x.mundo.opc.escritura = null;
  await simula(x.page, 'Simular');
  await prepara(x);
  await marca(x, 'OG - Larga');
  await confirma(x);
  es(JSON.stringify(uris(larga2)) === JSON.stringify(D.largas.map(c => c.uri)) && x.mundo.escrituras.length === 3 && x.mundo.escrituras[2].cuerpo === JSON.stringify({ uris: D.largas.slice(100).map(c => c.uri) }),
    'y al terminar en otra sincronización, la playlist queda con las 130, una vez cada una y en orden');
  raros = x.consola.filter(m => !/^Bloqueado|Error: Bloqueado/.test(m));
  es(raros.length === 0, 'sin errores en la consola: ' + raros.slice(0, 3).join(' | '));
  await x.ctx.close();

  // ---------- Emulando un iPhone: preparar, marcar tocando y sincronizar ----------
  P = D.copiaBiblio();
  x = await nuevo({ playlists: P }, Object.assign({}, devices['iPhone 14'], { defaultBrowserType: undefined }));
  await conectaTodo(x);
  await simula(x.page);
  await prepara(x);
  await fila(x, 'NS - Techno').locator('input.marca').tap();
  await fila(x, 'OG - All').locator('label.fila-titulo').tap(); // tocar el nombre también marca
  es(/Marcadas: 2 playlists, 7 canciones\./.test(await x.page.locator('#sinc-total').innerText()), 'en el iPhone emulado se marca tocando la casilla o el nombre');
  const ancho = await x.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  es(ancho <= 1, 'la pantalla de confirmación no se sale de ancho en el iPhone emulado (' + ancho + ' px)');
  await foto(x.page, 'sinc-confirma-iphone');
  await x.page.locator('#sinc-conf .acciones .btn', { hasText: /^Confirmar/ }).tap();
  await libre(x);
  t = await resultado(x);
  es(x.mundo.escrituras.length === 2 && /completa: añadidas 7 canciones en 2 playlists/.test(t) && techDe(P).pistas.length === 5 && pl(P, 'OG - All').pistas.length === 4, 'y la sincronización funciona igual');
  raros = x.consola.filter(m => !/^Bloqueado|Error: Bloqueado/.test(m));
  es(raros.length === 0, 'sin errores en la consola en el iPhone emulado: ' + raros.slice(0, 3).join(' | '));
  await x.ctx.close();
  }

  // ================= etapa 2, tras la revisión independiente =================
  const otroEn = async mundo => { // otro navegador (otro «dispositivo») sobre el mismo Spotify y el mismo Dropbox
    const ctx = await navegador.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });
    await mundo.instala(ctx);
    const page = await ctx.newPage();
    const consola = [];
    page.on('pageerror', e => consola.push('pageerror: ' + e.message));
    await page.goto(SITIO);
    await page.waitForSelector('.cab');
    return { mundo, ctx, page, consola };
  };
  const pulsaConfirmar = y => y.page.locator('#sinc-conf .acciones .btn', { hasText: /^Confirmar/ }).click();
  const avisoDe = (y, re) => y.page.locator('.aviso.error', { hasText: re }).count();

  // ---------- Dos pestañas del mismo navegador confirman a la vez: solo una sincroniza ----------
  P = D.copiaBiblio();
  x = await nuevo({ playlists: P, escritura: { espera: 900 } });
  await conectaTodo(x);
  await simula(x.page);
  y = { mundo: x.mundo, ctx: x.ctx, page: await x.ctx.newPage(), consola: [] };
  await y.page.goto(SITIO);
  await y.page.waitForSelector('.cab');
  await y.page.waitForFunction(() => !!window.SS.estado.xml && !!window.SS.estado.sp, null, { timeout: 15000 });
  await simula(y.page);
  await prepara(x); await marca(x, 'NS - Techno');
  await prepara(y); await marca(y, 'NS - Techno');
  await Promise.all([pulsaConfirmar(x), pulsaConfirmar(y)]);
  await libre(x); await libre(y);
  fuera = await avisoDe(x, /Hay otra sincronización en marcha en otra pestaña de este navegador/) + await avisoDe(y, /Hay otra sincronización en marcha en otra pestaña de este navegador/);
  es(x.mundo.escrituras.length === 1 && techDe(P).pistas.length === 5 && new Set(uris(techDe(P))).size === 5 && fuera === 1, 'dos pestañas que confirman a la vez: solo una sincroniza, la otra lo dice, y no hay duplicados (' + x.mundo.escrituras.length + ' escritura; avisos: ' + fuera + ')');
  await x.ctx.close();

  // ---------- Dos dispositivos confirman a la vez: como mucho uno escribe ----------
  for (const desfase of [0, 250]) {
    P = D.copiaBiblio();
    x = await nuevo({ playlists: P, escritura: { espera: 900 } });
    await conectaTodo(x);
    await simula(x.page);
    y = await otroEn(x.mundo);
    await conecta(y.page, 'Dropbox'); await conecta(y.page, 'Spotify');
    await y.page.waitForFunction(() => /como Prueba/.test(document.body.innerText) && !!window.SS.estado.xml, null, { timeout: 15000 });
    await simula(y.page);
    await prepara(x); await marca(x, 'NS - Techno');
    await prepara(y); await marca(y, 'NS - Techno');
    await Promise.all([pulsaConfirmar(x), (async () => { if (desfase) await y.page.waitForTimeout(desfase); await pulsaConfirmar(y); })()]);
    await libre(x); await libre(y);
    fuera = await avisoDe(x, /Hay otra sincronización empezada hace menos de un cuarto de hora/) + await avisoDe(y, /Hay otra sincronización empezada hace menos de un cuarto de hora/);
    es(x.mundo.escrituras.length <= 1 && techDe(P).pistas.length <= 5 && new Set(uris(techDe(P))).size === techDe(P).pistas.length && fuera >= 1 && archivos(x, /^\/copias\/antes-de-sincronizar-/).length === 2 && archivos(x, /^\/registro\/sincronizacion-/).length === 2,
      'dos dispositivos que confirman a la vez (desfase ' + desfase + ' ms): como mucho uno escribe y no hay duplicados (' + x.mundo.escrituras.length + ' escrituras, ' + techDe(P).pistas.length + ' canciones; se retiran: ' + fuera + ')');
    await y.ctx.close();
    await x.ctx.close();
  }

  // ---------- Un «No es» hecho en otro dispositivo cuenta al confirmar ----------
  await monta(null, ['NS - Techno']);
  dato = await x.page.evaluate(() => { const u = window.SS.estado.sim.unicas.find(q => /Night Bus/.test(q.rb.nombre)); return { clave: u.rb.clave, uri: u.elegida.sp.uri }; });
  jm = JSON.parse(x.mundo.archivos.get('/memoria/memoria.json').texto);
  jm.decisiones[dato.clave] = { si: null, m: null, no: [dato.uri], t: Date.now() + 5000 };
  x.mundo.pon('/memoria/memoria.json', JSON.stringify(jm));
  nPet = aSpot(x).length;
  await confirma(x);
  es(x.mundo.escrituras.length === 0 && aSpot(x).length === nPet && archivos(x, ANTES).length === 0 && await avisoDe(x, /Lo que se añadiría a «NS - Techno» ha cambiado desde que se preparó la sincronización.*No se ha enviado nada a Spotify\./) === 1,
    'un «No es» guardado desde otro dispositivo después de simular: al confirmar se entera y no envía nada');
  await prepara(x);
  es(await x.page.evaluate(u => window.SS.estado.plan.filas.find(q => q.clave === 'NS/Techno').uris.indexOf(u) < 0, dato.uri), 'y al preparar otra vez, esa canción ya no está entre las que se añadirían');
  await x.ctx.close();

  // ---------- Un cambio de mapa hecho en otro dispositivo también ----------
  await monta(null, ['NS - Techno']);
  jm = JSON.parse(x.mundo.archivos.get('/memoria/memoria.json').texto);
  jm.mapa['NS/Techno'] = { id: pl(P, 'NS - House').id, t: Date.now() + 5000 };
  x.mundo.pon('/memoria/memoria.json', JSON.stringify(jm));
  await confirma(x);
  es(x.mundo.escrituras.length === 0 && archivos(x, ANTES).length === 0 && await avisoDe(x, /El mapa de playlists ha cambiado desde la simulación.*No se ha enviado nada a Spotify\./) === 1, 'un cambio de mapa guardado desde otro dispositivo: al confirmar se entera y no envía nada');
  await x.ctx.close();

  // ---------- No se sabe si llegó y Spotify tarda en enseñarlo: segunda lectura, y no dice «no están» ----------
  await monta({ escritura: { red: true, llega: true, oculta: 1 } }, ['NS - Techno', 'OG - All']);
  await confirma(x);
  t = await resultado(x);
  es(x.mundo.escrituras.length === 1 && spDesde(x) === 'GET POST GET GET' && /Spotify no confirmó la escritura: Se cortó la conexión con Spotify al enviar la escritura\. Al releer están las 5 enviadas \(0 antes, 5 ahora\)/.test(t) && /llegó, pero Spotify no la confirmó: por prudencia se para aquí/.test(t),
    'corte de red con la escritura hecha y Spotify que tarda en enseñarla: lee una segunda vez y las ve (' + spDesde(x) + ')');
  await x.ctx.close();
  await monta({ escritura: { red: true, llega: true, oculta: 2 } }, ['NS - Techno', 'OG - All']);
  await confirma(x);
  t = await resultado(x);
  es(x.mundo.escrituras.length === 1 && /Al releer, de las 5 enviadas se ven 0 \(0 antes, 0 ahora\)\. La escritura no se ha repetido\. Spotify puede tardar en enseñar un cambio: espera un par de minutos y simula otra vez antes de añadir nada a mano\./.test(t),
    'si tampoco se ven a la segunda, no afirma que no estén: avisa de que Spotify puede tardar');
  jr = registro(x);
  es(!!jr && jr.playlists[0].enviadas_que_no_se_ven_al_releer.length === 5 && jr.final !== 'completa', 'y el registro las apunta como «enviadas que no se ven al releer»');
  await x.ctx.close();

  // ---------- Una escritura que no responde: a los 30 s se corta sola, no se repite y se relee ----------
  await monta({ escritura: { cuelga: true } }, ['NS - Techno', 'OG - All']);
  t0 = Date.now();
  await confirma(x);
  t = await resultado(x);
  es(Date.now() - t0 >= 29000 && x.mundo.escrituras.length === 1 && spDesde(x) === 'GET POST GET' && /«NS - Techno»: Spotify no confirmó la escritura: Se cortó la conexión con Spotify al enviar la escritura\. Al releer están las 5 enviadas/.test(t) && /«OG - All»: no se ha tocado/.test(t),
    'una escritura que no responde no deja la app colgada: a los 30 s se da por cortada, no se repite y se relee (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  await x.ctx.close();

  // ---------- Spotify acepta sin devolver cuerpo ----------
  await monta({ escritura: { sinCuerpo: true } }, ['NS - Techno']);
  await confirma(x);
  es(x.mundo.escrituras.length === 1 && /completa: añadidas 5 canciones en 1 playlist/.test(await resultado(x)), 'un 201 sin cuerpo no se toma por fallo: se comprueba releyendo, como siempre');
  await x.ctx.close();

  // ---------- Si no se puede guardar la copia completa (la primera vez), tampoco se escribe ----------
  await monta({ subidaFalla: /spotify-completa/ }, ['NS - Techno']);
  nPet = aSpot(x).length;
  await confirma(x);
  es(x.mundo.escrituras.length === 0 && aSpot(x).length === nPet && await avisoDe(x, /No se ha podido guardar la copia en Dropbox.*Sin copia no se escribe\. No se ha enviado nada a Spotify\./) === 1, 'si falla la copia completa de la primera vez, tampoco se escribe');
  await x.ctx.close();

  // ---------- El registro dice la verdad cuando una playlist se queda sin tocar ----------
  await monta(null, ['NS - House', 'NS - Techno']);
  pl(P, 'NS - House').pistas.push({ added_at: '2026-11-24T10:00:00Z', t: D.cat.paper }); pl(P, 'NS - House').snapshot_id += 'm';
  await confirma(x);
  jr = registro(x);
  es(!!jr && jr.final === 'terminada con playlists sin tocar' && jr.playlists[0].estado === 'cambiada' && jr.playlists[1].estado === 'ok', 'el registro no dice «completa» si una playlist se quedó sin tocar');
  await x.ctx.close();

  // ---------- Una sincronización que no llega a enviar nada también deja su registro (es el cierre de su testigo) ----------
  await monta(null, ['NS - House']);
  pl(P, 'NS - House').pistas.push({ added_at: '2026-11-24T10:00:00Z', t: D.cat.paper }); pl(P, 'NS - House').snapshot_id += 'm';
  await confirma(x);
  jr = registro(x);
  es(x.mundo.escrituras.length === 0 && archivos(x, REGISTRO).length === 1 && !!jr && jr.playlists[0].estado === 'cambiada' && jr.playlists[0].anadidas.length === 0 && /terminada con 1 playlist sin tocar/.test(await resultado(x)),
    'aunque no se envíe nada (la única playlist marcada había cambiado), queda el registro: sin él, las demás sesiones esperarían un cuarto de hora');
  await x.ctx.close();
  // ---------- Una sincronización larga en un dispositivo: el otro no puede empezar hasta que la primera cierre ----------
  P = D.copiaBiblio();
  x = await nuevo({ playlists: P, escritura: { espera: 6000 } });
  await conectaTodo(x);
  await simula(x.page);
  y = await otroEn(x.mundo);
  await conecta(y.page, 'Dropbox'); await conecta(y.page, 'Spotify');
  await y.page.waitForFunction(() => /como Prueba/.test(document.body.innerText) && !!window.SS.estado.xml, null, { timeout: 15000 });
  await simula(y.page);
  await prepara(x); await marca(x, 'NS - Techno');
  await prepara(y); await marca(y, 'NS - Techno');
  await pulsaConfirmar(x);
  for (let i = 0; i < 100 && x.mundo.escrituras.length < 1; i++) await x.page.waitForTimeout(100);
  // como si la primera llevase ya dos minutos y medio sincronizando: su testigo es «viejo», pero no está cerrado
  for (const a of x.mundo.archivos.values()) if (/^\/copias\/antes-de-sincronizar-/.test(a.ruta)) a.fecha = new Date(Date.now() - 150000).toISOString().replace(/\.\d+Z$/, 'Z');
  await pulsaConfirmar(y);
  await libre(y);
  es(x.mundo.escrituras.length === 1 && await avisoDe(y, /Hay otra sincronización empezada hace menos de un cuarto de hora, en otra pestaña o en otro dispositivo, y no consta que haya terminado.*No se ha enviado nada a Spotify\./) === 1,
    'con una sincronización que lleva más de dos minutos en marcha en otro dispositivo, este se retira sin escribir');
  await libre(x);
  es(techDe(P).pistas.length === 5 && new Set(uris(techDe(P))).size === 5 && /completa: añadidas 5 canciones/.test(await resultado(x)) && archivos(x, /^\/registro\/sincronizacion-/).length === 2, 'la primera termina bien, sin duplicados, y los dos testigos quedan cerrados');
  x.mundo.opc.escritura = null;
  await simula(y.page, 'Simular otra vez');
  await prepara(y); await marca(y, 'OG - All');
  await confirma(y);
  es(x.mundo.escrituras.length === 2 && pl(P, 'OG - All').pistas.length === 4 && /completa: añadidas 2 canciones en 1 playlist/.test(await resultado(y)), 'y cuando la primera ha cerrado, el otro dispositivo ya puede sincronizar');
  await y.ctx.close();
  await x.ctx.close();

  // ---------- Una pestaña con la sincronización preparada de antes no escribe tras una escritura dudosa hecha en otra ----------
  P = D.copiaBiblio();
  x = await nuevo({ playlists: P, escritura: { oculta: 3 } });
  await conectaTodo(x);
  await simula(x.page);
  y = { mundo: x.mundo, ctx: x.ctx, page: await x.ctx.newPage(), consola: [] };
  await y.page.goto(SITIO);
  await y.page.waitForSelector('.cab');
  await y.page.waitForFunction(() => !!window.SS.estado.xml && !!window.SS.estado.sp, null, { timeout: 15000 });
  await simula(y.page);
  await prepara(y); await marca(y, 'NS - Techno');
  await prepara(x); await marca(x, 'NS - Techno');
  await confirma(x);
  es(x.mundo.escrituras.length === 1 && /no cuadra: de las 5 enviadas se ven 0/.test(await resultado(x)) && techDe(P).pistas.length === 5, 'en una pestaña, Spotify acepta la escritura y aún no la enseña: «se ven 0» (en Spotify están las 5)');
  await confirma(y);
  es(x.mundo.escrituras.length === 1 && techDe(P).pistas.length === 5 && await avisoDe(y, /Lo que se añadiría a «NS - Techno» ha cambiado desde que se preparó la sincronización.*No se ha enviado nada a Spotify\./) === 1,
    'la otra pestaña, que la tenía preparada de antes, ve la marca y no escribe: no hay duplicados');
  await pestana(y.page, 'Diagnóstico');
  es(/Sincronización: [^\n]*parada\. Lo releído de «NS - Techno» no cuadra/.test(await y.page.locator('#diag').inputValue()), 'y su diagnóstico enseña la última sincronización hecha en este navegador, aunque fuese en la otra pestaña');
  await x.ctx.close();
}

(async () => {
  const exe = process.env.CHROME;
  navegador = await chromium.launch(exe ? { executablePath: exe } : {});
  if (SALIDA) fs.mkdirSync(SALIDA, { recursive: true });
  try {
    // SOLO=escritura pasa solo las pruebas de la sincronización (unos minutos menos); SOLO=tope, las del tope de
    // búsquedas; SOLO=soundeo, las del botón B y el lector; sin SOLO se pasa todo.
    const SOLO = process.env.SOLO || '';
    if (!SOLO) {
      await flujoCompleto('Flujo completo en escritorio', { viewport: { width: 1100, height: 800 } }, '-pc');
      await flujoCompleto('Flujo completo emulando iPhone', Object.assign({}, devices['iPhone 14'], { defaultBrowserType: undefined }), '-iphone');
      await flujoCompleto('Flujo completo en modo oscuro', { viewport: { width: 900, height: 800 }, colorScheme: 'dark' }, '-oscuro');
      await casos();
    }
    if (!SOLO || SOLO === 'tope') await casosTope();
    if (!SOLO || SOLO === 'soundeo') await casosSoundeo();
    if (!SOLO || SOLO === 'escritura') await casosSinc();
  } catch (e) { mal++; console.log('  ERROR en las pruebas: ' + (e.stack || e)); }
  await navegador.close();
  console.log('Extremo a extremo: ' + ok + ' comprobaciones bien, ' + mal + ' mal.');
  process.exit(mal ? 1 : 0);
})();
