# SynchroSound

Web estática (GitHub Pages, sin servidor) para llevar a Spotify lo que hay en rekordbox.
Se abre en <https://santi7guti.github.io/synchrosound/> desde el PC o el iPhone.

**Estado: v0.4.0 (fase 3, primera entrega: Soundeo se lee y se simula).** Lo nuevo: un **tope diario de búsquedas** en Spotify (150, se cambia en Cuentas), las «no están» se vuelven a buscar cada dos o tres semanas, y el **botón B**: un lector para el iPhone (`userscript/`) lee los favoritos y las descargas de Soundeo cuando se le pide, la app guarda esa lista en Dropbox y **simula** qué iría a «Sound All», «Sound Down» y «Sound Try». El botón B todavía no escribe nada en Spotify, y el lector solo lee Soundeo. Lo demás sigue como en la v0.3.0: Esta versión lee y simula como las anteriores y, además, puede **añadir** canciones a las playlists propias `NS - …` y `OG - …` del mapa: las que se marcan y se confirman a mano, y después de guardar una copia. No quita, no reordena, no reemplaza y no crea nada. Añadir está probado con una biblioteca real desde un PC, en playlists públicas y privadas; escribir desde el iPhone y los casos de fallo solo están probados con los servicios simulados de `test/`.

## Qué hace esta versión

- **Cuentas.** Conecta Dropbox y Spotify (PKCE, sin secretos) y elige el XML de rekordbox dentro de la carpeta de la app en Dropbox.
- **Copia.** Guarda todas las playlists y los likes de Spotify en un archivo nuevo con fecha (`copias/`). Una copia nunca sustituye a otra.
- **A, rekordbox a Spotify: simular.** Empareja las playlists de las carpetas «New School» y «Old Gems» de rekordbox con las playlists `NS - …` y `OG - …` de Spotify y enseña cuatro listas: ya están, se añadirían, dudosas y no están en Spotify. Cualquier pareja se puede rechazar con «No es» (también las que la app da por seguras) y la respuesta se recuerda. Las seguras con aviso salen arriba para repasarlas primero. Si el texto es ambiguo (un «Remix» sin decir de quién, un artista con una letra distinta, artista y título cambiados de sitio), solo se da por segura cuando además coincide la duración. Una dudosa enseña todas sus candidatas y «Ninguna es» las descarta de una vez. Si el archivo es el remix de otra persona y en Spotify solo está la original, no se pregunta: va a «no están». Cada canción lleva un enlace que la abre en la app de Spotify y otro a la web.
- **Gasta pocas peticiones a Spotify.** Las apps en modo desarrollo tienen una cuota que Spotify no publica. La app guarda en Dropbox lo último que leyó y solo vuelve a pedir las playlists cuyo sello de versión haya cambiado; al cargar la página no pide nada; cuenta las peticiones de cada día; y si Spotify corta (429), para a la primera, dice el motivo y el plazo que dé Spotify y no insiste. Mientras dura el corte, los botones no envían nada; la app nunca pide nada a Spotify por su cuenta. «Probar ahora» repite, con una sola petición, la llamada que Spotify rechazó, y el corte solo se da por terminado cuando esa llamada vuelve a responder (Spotify corta por grupos de llamadas: que responda el perfil no dice nada de las playlists). El navegador no deja leer el plazo de Spotify (`Retry-After`), así que se puede escribir a mano en el aviso del corte: cuenta desde la hora del rechazo y vale también en el otro dispositivo.
- **B, Soundeo a Spotify: simular.** Los favoritos (★) de Soundeo que estén en Spotify irían a «Sound All» y, además, a «Sound Down» si ya están descargados o a «Sound Try» si no. «Leer Soundeo» abre soundeo.com con una marca de un solo uso; allí el lector (ver «El lector de Soundeo») lee favoritos y descargas y vuelve a la app con la lista dentro del enlace (en la parte `#`, que no llega a ningún servidor). La app comprueba la marca, el recuento, una suma de control y la forma de la lista, y la guarda como archivo nuevo en `soundeo/` de su carpeta de Dropbox; desde otro dispositivo se lee de ahí. Si la lista llega con filtros puestos, sin alguna página o tiene más de 24 horas, se avisa. Esta versión solo simula.
- **Tope de búsquedas.** Como mucho 150 búsquedas nuevas al día entre todos los dispositivos (se cambia en Cuentas). Al llegar, lo que falta queda en la lista «Sin buscar» y la app sigue otro día; lo que ya está resuelto se puede sincronizar.
- **C, sin repartir.** Likes desde una fecha más la playlist «Sound All», menos lo que ya está en alguna `NS -` u `OG -`.
- **Diagnóstico.** Un resumen en texto para ajustar el buscador de coincidencias; dice qué playlists se han vuelto a leer. No lleva tokens. «Releer todo Spotify» pide confirmación y dice cuántas peticiones gasta.
- **A, rekordbox a Spotify: sincronizar (solo añadir).** Parte de una simulación completa y reciente. «Preparar» no envía nada: enseña, playlist por playlist, lo que la simulación da como «se añadirían», si la playlist es pública o privada y cuánto gasta; ninguna playlist viene marcada. Al confirmar:
  1. se guarda en Dropbox una copia de las playlists marcadas tal como estaban, con la lista de lo que se va a añadir (y una copia completa si no había ninguna). Si la copia no se guarda, no se escribe;
  2. cada playlist se relee de Spotify justo antes de escribir en ella; si no es idéntica a la que vio la simulación, no se toca;
  3. las canciones van al final, en el orden de rekordbox, en lotes de hasta 100; tras cada lote se relee la playlist y se compara;
  4. ninguna escritura se repite. Si Spotify rechaza, si no se sabe si llegó, si al releer no cuadra o si corta (429), la sincronización se para ahí y dice lo que hay. Si pudo llegar y aún no se ve, espera 3 s y **lee** una vez más (Spotify puede tardar en enseñar un cambio);
  5. queda un registro de lo añadido en un archivo nuevo de `registro/`.

  Además: antes de confirmar se baja la memoria común (un «No es» o un cambio de mapa hechos en otro dispositivo cuentan); dos pestañas del mismo navegador no sincronizan a la vez (cerrojo del navegador) y dos dispositivos tampoco (la copia previa lleva el dispositivo y la sesión en el nombre y hace de testigo; el registro, con el mismo nombre, es su cierre: si hay un testigo de otra sesión de hace menos de un cuarto de hora y sin cerrar, esta se retira sin escribir); una escritura solo sale si la playlist se ha releído hace menos de 15 s; tras una escritura que no se pudo comprobar del todo, en esa playlist no se vuelve a escribir en dos minutos y su contenido se vuelve a pedir a Spotify; una petición que no responde se corta a los 30 s; el avance se apunta en el navegador antes y después de cada escritura, así que una recarga a mitad deja dicho hasta dónde llegó.

Fuera de esta versión: escribir en las playlists de Soundeo, quitar canciones, crear playlists y restaurar desde una copia.

## Qué puede tocar y qué no

| Dónde | Leer | Escribir |
|---|---|---|
| Spotify, playlists propias `NS - …` y `OG - …` del mapa | sí | **añadir canciones al final**, las marcadas y confirmadas, tras guardar la copia |
| Spotify, resto de playlists | sí | **nada** |
| Spotify, likes | sí | **nada** |
| Spotify, «Sound All», «Sound Down» y «Sound Try» | sí | **nada** (el botón B solo simula) |
| Soundeo | favoritos y descargas, solo cuando se pulsa «Leer Soundeo» | **nada** |
| Dropbox, carpeta de la app | sí | archivos nuevos en `copias/`, `registro/` y `soundeo/` y su memoria en `memoria/` |
| Resto de Dropbox | no | no |
| XML de rekordbox | sí | no |

Quién lo garantiza:

- **Los likes: Spotify.** La app no pide nunca `user-library-modify`, así que Spotify rechaza cualquier cambio en los likes aunque el código tuviese un fallo. Si Spotify concediese un permiso que no se ha pedido, la app no guarda la conexión.
- **Las playlists: el código.** La app pide `playlist-modify-public` y `playlist-modify-private`. En un dispositivo donde Spotify los ha concedido, ya no es Spotify quien impide un cambio en las playlists. Lo impide la única puerta por la que pasan todas las llamadas a Spotify (`spotify()` en `app.js`, que no envía ninguna escritura que no apruebe `puerta()`, en `core.js`): los `GET` salen; de lo demás solo sale `POST /playlists/{id}/items`, y solo si la playlist es propia, su nombre empieza por `NS - ` u `OG - `, es la pareja de una sola playlist de rekordbox en el mapa y está entre las marcadas en una sincronización confirmada y con la copia ya guardada; y solo con canciones confirmadas para esa playlist, entre 1 y 100 por llamada. Cada canción confirmada se tacha al enviarla, llegue o no: no puede salir dos veces hacia la misma playlist. Nunca `PUT`, nunca `DELETE`, nunca otra playlist. Las pruebas automáticas lo comprueban.
- **Donde no se ha vuelto a conectar Spotify**, la conexión sigue teniendo solo permisos de lectura y Spotify lo rechaza todo, como en la fase 1. El indicador de arriba dice en cada dispositivo cuál es el caso («Solo lectura» o «Solo añadir»).
- **El navegador.** La política de seguridad de `index.html` solo deja hablar con Spotify, Dropbox y este sitio.
- **Dropbox.** La app está registrada con acceso a su carpeta únicamente, y el código no tiene ninguna llamada de borrado.
- **Soundeo: el código del lector.** Ninguna plataforma lo impide (un userscript puede hacer en una página lo mismo que quien la usa), así que lo garantiza el propio lector: su única función de red solo admite `GET` a `/account/favorites` y `/account/downloads`, y `test/nucleo.js` comprueba sobre su código que no hay otra forma de pedir, enviar, pulsar ni guardar nada.

No hay claves secretas: el Client ID de Spotify y la clave de la app de Dropbox que aparecen en `app.js` son públicos por diseño (PKCE). Los tokens se guardan en el navegador de cada dispositivo.

## El lector de Soundeo

Soundeo no tiene acceso para apps, y una web no puede leer otra. Por eso los favoritos los lee un userscript, en Safari del iPhone con la extensión Userscripts:

- `userscript/synchrosound-lector.user.js` es el **cargador**: se instala una vez (enlace en Cuentas). Mientras se usa Soundeo con normalidad termina en su primera línea, sin red ni pantalla. Solo arranca si la dirección trae la marca que pone «Leer Soundeo» (`#synchrosound=…`); entonces descarga el lector de este sitio.
- `userscript/synchrosound-lector.app.js` es el **lector**: pide `/account/favorites` y `/account/downloads` (todas sus páginas, sin filtros en la dirección), enseña lo que ha leído y ofrece el enlace de vuelta. No da ni quita estrellas, no descarga, no vota, no guarda nada en el navegador y no conecta Dropbox.
- Convive con otros userscripts de la página: su panel cuelga de `<html>` en un Shadow DOM propio, no usa el almacenamiento de soundeo.com ni toca el historial.

## Archivos

- `index.html`, `styles.css`: la página.
- `core.js`: lector del XML de rekordbox, buscador de coincidencias y la puerta de escritura (`puerta()`: decide qué escritura puede salir). Funciones puras, sin red.
- `app.js`: conexiones, lectura, copia, simulación, sincronización e interfaz.
- `version.json`: para avisar de que hay versión nueva. **Publicar una versión** = cambiar el número en `app.js` (`VERSION`), en `version.json`, en los `?v=` de `index.html`, en la línea «Estado» de este README y en `test/e2e.js`.
- `userscript/`: el cargador y el lector de Soundeo (ver arriba). Publicar el lector = subirlo a `main`; el cargador solo se cambia si hay que reinstalarlo.
- `test/`: pruebas con datos inventados y con Spotify, Dropbox y Soundeo simulados.

## Pruebas

```
node test/nucleo.js
NODE_PATH=<carpeta de node_modules con playwright> CHROME=<ruta de Chrome> node test/e2e.js
```

`test/nucleo.js` prueba el buscador y, caso a caso, la puerta de escritura (qué playlists valen y qué llamadas salen). `test/e2e.js` (tarda unos veinte minutos; `SOLO=escritura` pasa solo la sincronización, y con `COLA=1` solo su último bloque; `SOLO=tope`, el tope de búsquedas; `SOLO=soundeo`, el lector y el botón B; `PRIMERA=1` para en el primer fallo) recorre la app entera en escritorio, emulando un iPhone y en modo oscuro. Comprueba, entre otras cosas, que a `api.spotify.com` no sale nada que no sea `GET` salvo las escrituras de una sincronización confirmada, y de esas: que no salen sin confirmar ni sin copia, que cada una lleva exactamente sus canciones a su playlist, que una playlist con más de 100 va en dos lotes, que ninguna se reintenta ante un error, un 401 o un corte de conexión, que antes y después de cada una se relee la playlist, y qué pasa si Spotify tarda en enseñar lo añadido, si la página se recarga a mitad, si se pulsa «Parar» o si dos pestañas o dos dispositivos confirman a la vez.

## Datos personales

El repositorio es público. Aquí no se sube ningún XML de rekordbox, ninguna copia de Spotify, ninguna lista de Soundeo ni ningún dato de una biblioteca real: las pruebas usan datos inventados y `.gitignore` bloquea esos archivos.
