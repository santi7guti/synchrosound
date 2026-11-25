#!/usr/bin/env python3
"""Estropea app.js de una manera cada vez y comprueba que las pruebas de sincronización (e2e, SOLO=escritura) fallan.
Uso: python3 test/mutaciones/mut-e2e.py <repo> <salida.txt> [n...]   (n = números de los cambios; sin ellos, todos)
     python3 test/mutaciones/mut-e2e.py <repo> --lista             (solo dice si cada cambio se puede aplicar)
Hacen falta NODE_PATH y CHROME, igual que para test/e2e.js. Cada cambio se prueba en una copia aparte, en una
carpeta temporal; el repo no se toca. Dos a la vez (máquina de 2 núcleos). Hecho para la v0.3.0."""
import os, shutil, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor

repo, salida = sys.argv[1], sys.argv[2]
solo = [int(a) for a in sys.argv[3:]] if salida != '--lista' else []
orig = open(os.path.join(repo, 'app.js'), encoding='utf-8').read()

M = [
 ("reintenta una escritura ante un 5xx", "if (r.status >= 500 && intento < 3 && !escribe) {", "if (r.status >= 500 && intento < 3) {"),
 ("reintenta una escritura ante un 401", "if (r.status === 401 && intento < 1 && !escribe) {", "if (r.status === 401 && intento < 1) {"),
 ("reintenta una escritura ante un corte de red", "        if (escribe) {\n          const err = new Error('Se cortó la conexión con Spotify al enviar la escritura');\n          err.servicio = 'Spotify'; err.incierta = true;\n          throw err;\n        }\n", ""),
 ("no consulta la puerta", "const g = C.puerta({ metodo, ruta, cuerpo: opts && opts.cuerpo, pase: p, permiso, ahora: Date.now(), leida: opts && opts.leida, concedido: tieneEscritura(), destino: destinoValido });", "const g = { ruta: String(ruta), uris: (opts && opts.cuerpo && opts.cuerpo.uris) || [] };"),
 ("no guarda la copia previa", "copia = await dbxSube('/copias/antes-de-sincronizar-' + sello() + '-' + yo + '.json', JSON.stringify(construyeAntes(marcadas), null, 1), 'add', true);", "copia = { name: 'antes-de-sincronizar-sin-copia.json' };"),
 ("sigue aunque la copia falle", "      await cierraSin('no se pudo guardar la copia');\n      throw new Error('No se ha podido guardar la copia en Dropbox (' + txtErr(e) + '). Sin copia no se escribe.' + NADA);\n    }", "      copia = copia || { name: 'antes-de-sincronizar-x.json' }; enCopias = [{ nombre: copia.name }];\n    }"),
 ("no relee la playlist antes de escribir", "        try { items = await leePlaylistDirecta(f.id, true); }\n        catch (e) {\n          r.estado = 'sinleer';", "        try { items = S.lib.playlists.find(q => q.id === f.id).items; }\n        catch (e) {\n          r.estado = 'sinleer';"),
 ("no compara la playlist con la de la simulación", "if (!mismas(prev, f.antes)) { // no es la que vio la simulación: no se toca", "if (false) {"),
 ("no compara después de escribir", "L.cuadra = mismas(ua, esperado);", "L.cuadra = true;"),
 ("da por buena cualquier respuesta", "bien = L.estado >= 200 && L.estado < 300;", "bien = true;"),
 ("sigue con la siguiente playlist tras un fallo", "        if (res.fin) break;\n        r.estado = 'ok';", "        if (res.fin) { res.fin = ''; continue; }\n        r.estado = 'ok';"),
 ("tras un 429 intenta comprobar", "if (L.corte) { vuelo = null; r.estado = 'corte';", "if (false) { vuelo = null; r.estado = 'corte';"),
 ("no quita las canciones repetidas del plan", "if (!URI_CANCION.test(uri) || dentro.has(uri) || vistas.has(uri)) continue;", "if (!URI_CANCION.test(uri) || dentro.has(uri)) continue;"),
 ("el plan mete canciones que no son «se añadirían»", "if (!d || d.spId !== f.id || !u.estado || estadoEn(u, d) !== 'add') continue;", "if (!d || d.spId !== f.id || !u.estado || !u.elegida) continue;"),
 ("las playlists vienen marcadas", "S.plan = { t: Date.now(), sim: S.sim.fecha, filas: planDe(S.sim), marcadas: {} }; // ninguna marcada de entrada", "S.plan = { t: Date.now(), sim: S.sim.fecha, filas: planDe(S.sim), marcadas: {} }; S.plan.filas.forEach(f => { if (!f.bloqueo) S.plan.marcadas[f.clave] = true; });"),
 ("deja marcar una playlist bloqueada", "disabled: !!f.bloqueo || !!S.tarea, 'aria-label': 'Sincronizar '", "disabled: !!S.tarea, 'aria-label': 'Sincronizar '"),
 ("al confirmar no vuelve a comprobar lo marcado", "if (!g || g.bloqueo || g.id !== f.id || !mismas(g.uris, f.uris) || !mismas(g.antes, f.antes)) {", "if (false) {"),
 ("la lectura siguiente se fía de lo guardado tras una escritura sin comprobar", " && !releer[p.id]) {", ") {"),
 ("no marca la playlist para releerla", "r.estado = 'enviando'; marcaReleer(f.id, true); apunta();", "r.estado = 'enviando'; apunta();"),
 ("no apunta el avance antes de escribir", "r.estado = 'enviando'; marcaReleer(f.id, true); apunta();", "r.estado = 'enviando'; marcaReleer(f.id, true);"),
 ("«Parar» corta la comprobación", "items = await leePlaylistDirecta(f.id, true); L.relecturas = 1; ua = urisDe(items);", "items = await leePlaylistDirecta(f.id); L.relecturas = 1; ua = urisDe(items);"),
 ("basta uno de los dos permisos", "return PERMISOS_ESCRITURA.every(p => c.indexOf(p) >= 0);", "return PERMISOS_ESCRITURA.some(p => c.indexOf(p) >= 0);"),
 ("el destino no mira el mapa", "return C.destinoMal(pl || null, Object.keys(m).filter(k => m[k] && m[k].id === id).length);", "return C.destinoMal(pl || null, 1);"),
 ("lotes de más de 100", "const lote = falta.slice(k, k + MAX_LOTE);", "const lote = falta.slice(k, k + 200);"),
 ("no espera a la segunda lectura", "if ((bien || L.incierta || L.estado == null) && mismas(ua, prev)) { await espera(ESPERA_COMP);", "if (false) { await espera(ESPERA_COMP);"),
 ("la segunda lectura, solo si Spotify aceptó", "if ((bien || L.incierta || L.estado == null) && mismas(ua, prev)) { await espera(ESPERA_COMP);", "if (bien && mismas(ua, prev)) { await espera(ESPERA_COMP);"),
 ("sin cerrojo entre pestañas", "if (!cerrojos || typeof cerrojos.request !== 'function') return sincroniza(prog);", "if (true) return sincroniza(prog);"),
 ("sin testigo entre dispositivos", "if (viva) { await cierraSin('retirada: ' + viva); throw new Error(viva + '.' + NADA); }", "if (false) { throw new Error(viva); }"),
 ("el testigo caduca a los dos minutos", "const VENTANA_OTRA = VALE_PERMISO + 60000;", "const VENTANA_OTRA = 2 * 60000;"),
 ("no mira si la otra sincronización ya cerró", "const abiertas = otras.filter(o => !cierres.some(c => c.nombre === 'sincronizacion-' + o.m[1]));", "const abiertas = otras;"),
 ("el plan no tiene en cuenta el enfriamiento", "      else if (enfriando(f.id)) f.bloqueo = enfriando(f.id) + '.';\n", ""),
 ("no guarda el registro si no envió nada", "        res.registro = (await dbxSube(rutaRegistro, JSON.stringify(construyeRegistro(res, marcadas, reg), null, 1), 'add', true)).name;", "        if (enviados) res.registro = (await dbxSube(rutaRegistro, JSON.stringify(construyeRegistro(res, marcadas, reg), null, 1), 'add', true)).name;"),
 ("sin enfriamiento tras una escritura dudosa", "if (!t || !(Date.now() - t < ENFRIA) || (desde && t >= desde)) return '';", "if (true) return '';"),
 ("no baja la memoria común antes de confirmar", "    try { await memCarga(); }\n    catch (e) { throw new Error('No se ha podido leer en Dropbox la memoria común", "    try { await aseguraMem(); }\n    catch (e) { throw new Error('No se ha podido leer en Dropbox la memoria común"),
 ("tras bajar la memoria no vuelve a evaluar las canciones", "S.sim.unicas.forEach(u => { if (JSON.stringify(S.mem.decisiones[u.rb.clave] || null) !== decAntes[u.rb.clave]) reevalua(u, idx); });", ""),
 ("no mira si el mapa ha cambiado", "if (S.xml.datos.delMapa.some(pl => ((mapaHoy[pl.clave] || {}).id || null) !== ((S.sim.mapa[pl.clave] || {}).id || null))) {", "if (false) {"),
 ("sin plazo de 30 s para una petición colgada", "const reloj = corta ? setTimeout(() => corta.abort(), PLAZO_SP) : null;", "const reloj = null;"),
 ("el registro dice «completa» aunque haya playlists sin tocar", "final: res.fin || (res.pls.every(q => q.estado === 'ok') ? 'completa' : 'terminada con playlists sin tocar'),", "final: res.fin || 'completa',"),
 ("no pregunta antes de recargar a mitad", "window.addEventListener('beforeunload', e => { if (S.tarea && S.tarea.nombre === TAREA_SINC) { e.preventDefault(); e.returnValue = ''; } });", ""),
 ("la marca de la sincronización en curso también enfría", "|| (desde && t >= desde)) return '';", ") return '';"),
 ("vale una simulación de cualquier antigüedad", "if (Date.now() - S.sim.fecha > VALE_SIM) return", "if (false) return"),
 ("vale una simulación hecha con otra lectura de Spotify", "if (S.lib.vieja || S.sim.lib !== S.lib.leida) return", "if (false) return"),
]

if salida == '--lista':
    for i, (nombre, viejo, nuevo) in enumerate(M):
        n = orig.count(viejo)
        print('%02d %s %s' % (i, 'se puede aplicar ' if n == 1 else 'NO SE PUEDE (%d veces)' % n, nombre))
    sys.exit(0)

def corre(i):
    nombre, viejo, nuevo = M[i]
    if orig.count(viejo) != 1:
        return i, nombre, 'NO APLICADA (el texto aparece %d veces)' % orig.count(viejo), 0
    d = tempfile.mkdtemp(prefix='mut%02d-' % i)
    dst = os.path.join(d, 'r')
    shutil.copytree(repo, dst, ignore=shutil.ignore_patterns('.git'))
    open(os.path.join(dst, 'app.js'), 'w', encoding='utf-8').write(orig.replace(viejo, nuevo))
    t0 = time.time()
    env = dict(os.environ, SOLO='escritura', PRIMERA='1')
    try:
        r = subprocess.run(['node', 'test/e2e.js'], cwd=dst, capture_output=True, text=True, env=env, timeout=1500)
        out = r.stdout
        rc = r.returncode
    except subprocess.TimeoutExpired as e:
        out, rc = (e.stdout or b'').decode('utf-8', 'replace') if isinstance(e.stdout, bytes) else (e.stdout or ''), -9
    shutil.rmtree(d, ignore_errors=True)
    lineas = [l.strip() for l in out.split('\n') if 'FALLA' in l or 'ERROR en las pruebas' in l]
    if rc == 0:
        res = 'NO DETECTADA'
    else:
        res = 'detectada: ' + (lineas[0][:230] if lineas else 'sin línea de fallo (rc=%s)' % rc)
    return i, nombre, res, time.time() - t0

ids = solo or list(range(len(M)))
with open(salida, 'a', encoding='utf-8') as f:
    f.write('--- %d cambios, %s ---\n' % (len(ids), time.strftime('%H:%M:%S'))); f.flush()
    with ThreadPoolExecutor(max_workers=2) as ex:
        for i, nombre, res, seg in ex.map(corre, ids):
            f.write('%02d [%3ds] %s\n     %s\n' % (i, seg, nombre, res)); f.flush()
    f.write('--- fin %s ---\n' % time.strftime('%H:%M:%S'))
