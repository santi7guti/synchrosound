/* Pruebas de extremo a extremo con Spotify y Dropbox simulados (ver falsos.js).
   Uso:  NODE_PATH=<carpeta con playwright> CHROME=/ruta/a/chrome node test/e2e.js
   Comprueba, entre otras cosas, que a Spotify no sale ninguna petición que no sea GET. */
'use strict';
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const { Mundo, SITIO } = require('./falsos.js');
const D = require('./datos.js');

let ok = 0, mal = 0;
function es(cond, texto) { if (cond) ok++; else { mal++; console.log('  FALLA: ' + texto); } }
const SALIDA = process.env.SALIDA || '';
const LECTURA = 'playlist-read-private playlist-read-collaborative user-library-read';

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
  es(/v0\.1\.6/.test(t), 'se ve el número de versión');
  es(/Solo lectura/.test(t), 'se ve el indicador de solo lectura');
  es(/Sin conectar en este dispositivo/.test(t), 'empieza sin conectar');
  await foto(page, 'cuentas-vacio' + sufijo);

  // --- cuentas ---
  await conecta(page, 'Dropbox');
  es(page.url() === SITIO, 'tras conectar Dropbox la dirección queda limpia (sin code)');
  es(mundo.autoriza.db.token_access_type === 'offline' && mundo.autoriza.db.code_challenge_method === 'S256' && mundo.autoriza.db.redirect_uri === SITIO, 'Dropbox: PKCE con acceso offline y la redirección exacta');
  es(mundo.autoriza.db.client_id === 'd614ryq07qvpgkj', 'Dropbox: clave de la app');
  await conecta(page, 'Spotify');
  es(mundo.autoriza.sp.scope === LECTURA, 'Spotify: se piden exactamente los tres permisos de lectura (' + mundo.autoriza.sp.scope + ')');
  es(!/modify/.test(mundo.autoriza.sp.scope), 'Spotify: no se pide ningún permiso de escritura');
  es(mundo.autoriza.sp.code_challenge_method === 'S256' && mundo.autoriza.sp.redirect_uri === SITIO && mundo.autoriza.sp.response_type === 'code', 'Spotify: PKCE y la redirección exacta');
  es(mundo.autoriza.sp.client_id === '6251c56f9a7e49d4891a1531e89735ad', 'Spotify: Client ID');
  es(mundo.autoriza.sp.state !== mundo.autoriza.db.state && /^sp\./.test(mundo.autoriza.sp.state) && /^db\./.test(mundo.autoriza.db.state), 'el state distingue Spotify de Dropbox');
  await page.waitForFunction(() => /como Prueba/.test(document.body.innerText) && /como Cuenta de Prueba/.test(document.body.innerText), null, { timeout: 10000 });
  t = await cuerpo(page);
  es(t.indexOf('Permisos concedidos: ' + LECTURA) >= 0, 'enseña los permisos que Spotify ha concedido');
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
  es(/En esta fase «Añadir» solo guarda tu respuesta/.test(await cuerpo(page)), 'explica que «Añadir» no escribe en esta fase');
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
  es(/SynchroSound 0\.1\.6/.test(diag) && /buscador v5/.test(diag) && /escrituras enviadas: 0/.test(diag) && /Simulación/.test(diag) && diag.indexOf('Dudosas (' + (nD - 2) + ')') >= 0, 'el diagnóstico lleva versión, recuentos y dudosas');
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
  if (porta !== null) es(porta.indexOf('SynchroSound 0.1.6') === 0, 'el botón Copiar copia el diagnóstico');
  await foto(page, 'diagnostico' + sufijo);

  // --- el candado ---
  await page.locator('.candado').click();
  t = await page.locator('.candado-panel').innerText();
  es(/0 escrituras/.test(t) && t.indexOf(LECTURA.split(' ').join(', ')) >= 0, 'el panel de solo lectura enseña permisos y escrituras');
  es(/Peticiones a Spotify hoy: \d+ entre todos tus dispositivos/.test(t), 'y cuántas peticiones a Spotify se llevan hoy');

  // --- la puerta: nada que no sea GET sale hacia Spotify ---
  const antes = mundo.peticiones.length;
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = await page.evaluate(m => window.SS.spotify(m, '/playlists/x/items').then(() => 'pasó', e => e.message), m);
    es(/^Bloqueado/.test(r), 'la app corta un ' + m + ' antes de que salga');
  }
  es(mundo.peticiones.length === antes, 'los intentos bloqueados no llegan a la red');
  // y aunque alguien se saltase la puerta, el Spotify simulado (como el real sin permisos) lo rechaza
  const directo = await page.evaluate(async () => { try { const r = await fetch('https://api.spotify.com/v1/playlists/x/items', { method: 'POST', headers: { Authorization: 'Bearer ' + window.SS.estado.sp.a } }); return r.status; } catch (e) { return 'error'; } });
  es(directo === 403, 'sin permisos de escritura, Spotify responde 403 a un POST');
  mundo.spotifyNoGet.length = 0; // ese POST era de la propia prueba

  // --- ancho de pantalla ---
  for (const v of ['Cuentas', 'rekordbox a Spotify', 'Sin repartir', 'Copia', 'Diagnóstico']) {
    await pestana(page, v);
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    es(desborda <= 1, 'la pantalla «' + v + '» no se sale de ancho (' + desborda + ' px)');
  }

  // --- resumen de red ---
  const sp = mundo.peticiones.filter(p => p.host === 'api.spotify.com');
  const noGet = sp.filter(p => p.metodo !== 'GET' && p.metodo !== 'OPTIONS');
  es(noGet.length === 1 && noGet[0].metodo === 'POST', 'a Spotify solo ha salido un no-GET: el POST directo de la prueba (' + noGet.length + ')');
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

  // Spotify concede más de lo pedido: no se guarda
  x = await nuevo({ scopeSpotify: 'playlist-read-private playlist-modify-private user-library-read' });
  await conecta(x.page, 'Spotify');
  es(/permisos que esta versión no debe tener \(playlist-modify-private\)/.test(await cuerpo(x.page)), 'si Spotify concediese escritura, la conexión no se guarda');
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

(async () => {
  const exe = process.env.CHROME;
  navegador = await chromium.launch(exe ? { executablePath: exe } : {});
  if (SALIDA) fs.mkdirSync(SALIDA, { recursive: true });
  try {
    await flujoCompleto('Flujo completo en escritorio', { viewport: { width: 1100, height: 800 } }, '-pc');
    await flujoCompleto('Flujo completo emulando iPhone', Object.assign({}, devices['iPhone 14'], { defaultBrowserType: undefined }), '-iphone');
    await flujoCompleto('Flujo completo en modo oscuro', { viewport: { width: 900, height: 800 }, colorScheme: 'dark' }, '-oscuro');
    await casos();
  } catch (e) { mal++; console.log('  ERROR en las pruebas: ' + (e.stack || e)); }
  await navegador.close();
  console.log('Extremo a extremo: ' + ok + ' comprobaciones bien, ' + mal + ' mal.');
  process.exit(mal ? 1 : 0);
})();
