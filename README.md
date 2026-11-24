# SynchroSound

Web estática (GitHub Pages, sin servidor) para llevar a Spotify lo que hay en rekordbox.
Se abre en <https://santi7guti.github.io/synchrosound/> desde el PC o el iPhone.

**Estado: fase 2, etapa 0 (v0.2.0).** Esta versión lee y enseña como la anterior y, además, puede hacer una única escritura de prueba en Spotify: añadir una canción a una playlist llamada `PRUEBA PEGAR`, cuando se confirma a mano. Nada más cambia en Spotify.

## Qué hace esta versión

- **Cuentas.** Conecta Dropbox y Spotify (PKCE, sin secretos) y elige el XML de rekordbox dentro de la carpeta de la app en Dropbox.
- **Copia.** Guarda todas las playlists y los likes de Spotify en un archivo nuevo con fecha (`copias/`). Una copia nunca sustituye a otra.
- **A, rekordbox a Spotify (simulación).** Empareja las playlists de las carpetas «New School» y «Old Gems» de rekordbox con las playlists `NS - …` y `OG - …` de Spotify y enseña cuatro listas: ya están, se añadirían, dudosas y no están en Spotify. Cualquier pareja se puede rechazar con «No es» (también las que la app da por seguras) y la respuesta se recuerda. Las seguras con aviso salen arriba para repasarlas primero. Si el texto es ambiguo (un «Remix» sin decir de quién, un artista con una letra distinta, artista y título cambiados de sitio), solo se da por segura cuando además coincide la duración. Una dudosa enseña todas sus candidatas y «Ninguna es» las descarta de una vez. Si el archivo es el remix de otra persona y en Spotify solo está la original, no se pregunta: va a «no están». Cada canción lleva un enlace que la abre en la app de Spotify y otro a la web.
- **Gasta pocas peticiones a Spotify.** Las apps en modo desarrollo tienen una cuota que Spotify no publica. La app guarda en Dropbox lo último que leyó y solo vuelve a pedir las playlists cuyo sello de versión haya cambiado; al cargar la página no pide nada; cuenta las peticiones de cada día; y si Spotify corta (429), para a la primera, dice el motivo y el plazo que dé Spotify y no insiste. Mientras dura el corte, los botones no envían nada; la app nunca pide nada a Spotify por su cuenta. «Probar ahora» repite, con una sola petición, la llamada que Spotify rechazó, y el corte solo se da por terminado cuando esa llamada vuelve a responder (Spotify corta por grupos de llamadas: que responda el perfil no dice nada de las playlists). El navegador no deja leer el plazo de Spotify (`Retry-After`), así que se puede escribir a mano en el aviso del corte: cuenta desde la hora del rechazo y vale también en el otro dispositivo.
- **C, sin repartir.** Likes desde una fecha más la playlist «Sound All», menos lo que ya está en alguna `NS -` u `OG -`.
- **Diagnóstico.** Un resumen en texto para ajustar el buscador de coincidencias; dice qué playlists se han vuelto a leer. No lleva tokens. «Releer todo Spotify» pide confirmación y dice cuántas peticiones gasta.
- **Prueba de escritura (en Diagnóstico).** Sirve para saber si Spotify, en modo desarrollo, deja añadir canciones a una playlist. «Preparar» solo lee: busca la playlist propia que se llame exactamente `PRUEBA PEGAR` (tiene que haber una y solo una) y el like más reciente que no esté en ella. «Confirmar» relee la playlist de Spotify, envía una sola escritura con esa canción y vuelve a leer la playlist para comprobarlo. La escritura no se reintenta nunca: si falla, o si no se sabe si llegó, se relee y se dice lo que hay. Como mucho una por carga de página.

Fuera de esta versión: sincronizar de verdad las playlists (resto de la fase 2) y leer Soundeo (fase 3).

## Qué puede tocar y qué no

| Dónde | Leer | Escribir |
|---|---|---|
| Spotify, playlist `PRUEBA PEGAR` | sí | **añadir 1 canción**, con confirmación, una vez por carga de página |
| Spotify, resto de playlists | sí | **nada** |
| Spotify, likes | sí | **nada** |
| Dropbox, carpeta de la app | sí | archivos nuevos en `copias/` y su memoria en `memoria/` |
| Resto de Dropbox | no | no |
| XML de rekordbox | sí | no |

Quién lo garantiza:

- **Los likes: Spotify.** La app no pide nunca `user-library-modify`, así que Spotify rechaza cualquier cambio en los likes aunque el código tuviese un fallo. Si Spotify concediese un permiso que no se ha pedido, la app no guarda la conexión.
- **Las playlists: el código.** Desde esta versión la app pide `playlist-modify-public` y `playlist-modify-private`. En un dispositivo donde Spotify los ha concedido, ya no es Spotify quien impide un cambio en las playlists. Lo impide la única puerta por la que pasan todas las llamadas a Spotify (`spotify()` en `app.js`): los `GET` salen; de lo demás solo sale un `POST /playlists/{id}/items` con una sola canción, a la playlist propia llamada exactamente `PRUEBA PEGAR`, con un pase de un solo uso que solo crea el botón «Confirmar», y como mucho una vez por carga de página. Nunca `PUT`, nunca `DELETE`, nunca otra playlist. Las pruebas automáticas lo comprueban.
- **Donde no se ha vuelto a conectar Spotify**, la conexión sigue teniendo solo permisos de lectura y Spotify lo rechaza todo, como en la fase 1. El indicador de arriba dice en cada dispositivo cuál es el caso («Solo lectura» o «Solo prueba»).
- **El navegador.** La política de seguridad de `index.html` solo deja hablar con Spotify, Dropbox y este sitio.
- **Dropbox.** La app está registrada con acceso a su carpeta únicamente, y el código no tiene ninguna llamada de borrado.

No hay claves secretas: el Client ID de Spotify y la clave de la app de Dropbox que aparecen en `app.js` son públicos por diseño (PKCE). Los tokens se guardan en el navegador de cada dispositivo.

## Archivos

- `index.html`, `styles.css`: la página.
- `core.js`: lector del XML de rekordbox y buscador de coincidencias. Funciones puras, sin red.
- `app.js`: conexiones, lectura, copia, simulación e interfaz.
- `version.json`: para avisar de que hay versión nueva. **Publicar una versión** = cambiar el número en `app.js` (`VERSION`), en `version.json`, en los `?v=` de `index.html`, en la línea «Estado» de este README y en `test/e2e.js`.
- `test/`: pruebas con datos inventados y con Spotify y Dropbox simulados.

## Pruebas

```
node test/nucleo.js
NODE_PATH=<carpeta de node_modules con playwright> CHROME=<ruta de Chrome> node test/e2e.js
```

`test/e2e.js` (tarda unos minutos) recorre la app entera en escritorio, emulando un iPhone y en modo oscuro. Comprueba, entre otras cosas, que a `api.spotify.com` no sale nada que no sea `GET` salvo la escritura de la prueba, y de esa: que no sale sin confirmar, que es exactamente una llamada con una canción a `PRUEBA PEGAR`, que no se reintenta ante un error o un corte de conexión, y que después se relee la playlist.

## Datos personales

El repositorio es público. Aquí no se sube ningún XML de rekordbox, ninguna copia de Spotify ni ningún dato de una biblioteca real: las pruebas usan datos inventados y `.gitignore` bloquea esos archivos.
