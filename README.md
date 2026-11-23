# SynchroSound

Web estática (GitHub Pages, sin servidor) para llevar a Spotify lo que hay en rekordbox.
Se abre en <https://santi7guti.github.io/synchrosound/> desde el PC o el iPhone.

**Estado: fase 1, solo lectura (v0.1.3).** Esta versión lee y enseña; no cambia nada en Spotify.

## Qué hace esta versión

- **Cuentas.** Conecta Dropbox y Spotify (PKCE, sin secretos) y elige el XML de rekordbox dentro de la carpeta de la app en Dropbox.
- **Copia.** Guarda todas las playlists y los likes de Spotify en un archivo nuevo con fecha (`copias/`). Una copia nunca sustituye a otra.
- **A, rekordbox a Spotify (simulación).** Empareja las playlists de las carpetas «New School» y «Old Gems» de rekordbox con las playlists `NS - …` y `OG - …` de Spotify y enseña cuatro listas: ya están, se añadirían, dudosas y no están en Spotify. Cualquier pareja se puede rechazar con «No es» (también las que la app da por seguras) y la respuesta se recuerda. Las seguras con aviso salen arriba para repasarlas primero. Si el texto es ambiguo (un «Remix» sin decir de quién, un artista con una letra distinta), solo se da por segura cuando además coincide la duración.
- **C, sin repartir.** Likes desde una fecha más la playlist «Sound All», menos lo que ya está en alguna `NS -` u `OG -`.
- **Diagnóstico.** Un resumen en texto para ajustar el buscador de coincidencias. No lleva tokens.

Fuera de esta versión: escribir en Spotify (fase 2) y leer Soundeo (fase 3).

## Qué puede tocar y qué no

| Dónde | Leer | Escribir |
|---|---|---|
| Spotify | playlists y likes | **nada** |
| Dropbox, carpeta de la app | sí | archivos nuevos en `copias/` y su memoria en `memoria/` |
| Resto de Dropbox | no | no |
| XML de rekordbox | sí | no |

Quién lo garantiza:

- **Spotify.** La app solo pide `playlist-read-private`, `playlist-read-collaborative` y `user-library-read`. Sin permisos de escritura, Spotify rechaza cualquier cambio aunque el código tuviese un fallo. Si Spotify concediese algún permiso de más, la app no guarda la conexión.
- **El código.** Todas las llamadas a Spotify pasan por una única función (`spotify()` en `app.js`) que solo deja salir `GET`.
- **El navegador.** La política de seguridad de `index.html` solo deja hablar con Spotify, Dropbox y este sitio.
- **Dropbox.** La app está registrada con acceso a su carpeta únicamente, y el código no tiene ninguna llamada de borrado.

No hay claves secretas: el Client ID de Spotify y la clave de la app de Dropbox que aparecen en `app.js` son públicos por diseño (PKCE). Los tokens se guardan en el navegador de cada dispositivo.

## Archivos

- `index.html`, `styles.css`: la página.
- `core.js`: lector del XML de rekordbox y buscador de coincidencias. Funciones puras, sin red.
- `app.js`: conexiones, lectura, copia, simulación e interfaz.
- `version.json`: para avisar de que hay versión nueva. **Publicar una versión** = cambiar el número en `app.js` (`VERSION`), en `version.json` y en los `?v=` de `index.html`.
- `test/`: pruebas con datos inventados y con Spotify y Dropbox simulados.

## Pruebas

```
node test/nucleo.js
NODE_PATH=<carpeta de node_modules con playwright> CHROME=<ruta de Chrome> node test/e2e.js
```

`test/e2e.js` recorre la app entera en escritorio, emulando un iPhone y en modo oscuro, y comprueba entre otras cosas que a `api.spotify.com` no sale ninguna petición que no sea `GET`.

## Datos personales

El repositorio es público. Aquí no se sube ningún XML de rekordbox, ninguna copia de Spotify ni ningún dato de una biblioteca real: las pruebas usan datos inventados y `.gitignore` bloquea esos archivos.
