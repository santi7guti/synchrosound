#!/usr/bin/env python3
"""Estropea la puerta de core.js de una manera cada vez y comprueba que test/nucleo.js falla.
Uso: python3 test/mutaciones/mut-nucleo.py [repo]. Sin argumento usa el repo en el que está.
Trabaja sobre una copia en una carpeta temporal; no toca el repo. Hecho para la v0.3.0."""
import os, re, shutil, subprocess, sys, tempfile

repo = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
tmp = tempfile.mkdtemp(prefix='mutnuc-')
shutil.copy(os.path.join(repo, 'core.js'), tmp)
shutil.copytree(os.path.join(repo, 'test'), os.path.join(tmp, 'test'))
orig = open(os.path.join(tmp, 'core.js'), encoding='utf-8').read()
a = orig.index('  function destinoMal(pl, enMapa) {')
b = orig.index('  return {\n    PREFIJO_DESTINO')
zona = orig[a:b]

muts = []
# 1) quitar cada comprobación entera
for linea in zona.split('\n'):
    if re.match(r'^    if \(.*\) return ', linea) or (linea.strip().startswith('!c.uris.every') and 'return' in linea):
        muts.append(('quitar: ' + linea.strip()[:70], linea, '' if linea.startswith('    if') else None))
# la comprobación del cuerpo ocupa dos líneas: se quita entera
cuerpo = "    if (!c || typeof c !== 'object' || Object.keys(c).length !== 1 || !Array.isArray(c.uris) || c.uris.length !== us.length ||\n        !c.uris.every((u, i) => u === us[i])) return 'el cuerpo no es exactamente el lote confirmado';"
muts = [m for m in muts if m[2] is not None and "Object.keys(c).length !== 1" not in m[1]]
muts.append(('quitar: la comprobación del cuerpo', cuerpo, ''))
# 2) aflojar una condición
flojas = [
    ("PREFIJO sin exigir algo detrás", "const PREFIJO_DESTINO = /^(NS|OG) - \\S/;", "const PREFIJO_DESTINO = /^(NS|OG) - /;"),
    ("PREFIJO sin anclar al principio", "const PREFIJO_DESTINO = /^(NS|OG) - \\S/;", "const PREFIJO_DESTINO = /(NS|OG) - \\S/;"),
    ("PREFIJO sin distinguir mayúsculas", "const PREFIJO_DESTINO = /^(NS|OG) - \\S/;", "const PREFIJO_DESTINO = /^(NS|OG) - \\S/i;"),
    ("PREFIJO con espacios opcionales", "const PREFIJO_DESTINO = /^(NS|OG) - \\S/;", "const PREFIJO_DESTINO = /^(NS|OG) ?- ?\\S/;"),
    ("PREFIJO con cualquier guion", "const PREFIJO_DESTINO = /^(NS|OG) - \\S/;", "const PREFIJO_DESTINO = /^(NS|OG) [-–—] \\S/;"),
    ("URI sin anclar al final", "const URI_CANCION = /^spotify:track:[A-Za-z0-9]{22}$/;", "const URI_CANCION = /^spotify:track:[A-Za-z0-9]{22}/;"),
    ("URI de cualquier tipo", "const URI_CANCION = /^spotify:track:[A-Za-z0-9]{22}$/;", "const URI_CANCION = /^spotify:[a-z]+:.+$/;"),
    ("tope de 100 subido", "const MAX_LOTE = 100;", "const MAX_LOTE = 101;"),
    ("propia: basta con que no sea falsa", "if (pl.propia !== true)", "if (pl.propia === false)"),
    ("mapa: vale más de una pareja", "if (enMapa !== 1)", "if (enMapa < 1)"),
    ("mapa: vale ninguna pareja", "if (enMapa !== 1)", "if (enMapa > 1)"),
    ("método: todo menos PUT y DELETE", "if (x.metodo !== 'POST')", "if (x.metodo === 'PUT' || x.metodo === 'DELETE')"),
    ("permiso de Spotify: basta con algo", "if (x.concedido !== true)", "if (!x.concedido)"),
    ("ruta: no mira que sea la del pase", "if (!m || m[1] !== p.id)", "if (!m)"),
    ("ruta: admite parámetros", "/items$/.exec(String(x.ruta))", "/items/.exec(String(x.ruta))"),
    ("destino: basta con que no diga nada", "if (mal !== '') return", "if (mal) return"),
    ("permiso: no mira la caducidad", "if (!per || !(x.ahora < per.hasta))", "if (!per)"),
    ("permiso: caducidad al revés para NaN", "!(x.ahora < per.hasta)", "x.ahora >= per.hasta"),
    ("lectura previa: admite una fecha futura", "x.leida <= x.ahora && ", ""),
    ("lectura previa: sin tope de antigüedad", " && x.ahora - x.leida < FRESCA_ESCR", ""),
    ("lectura previa: tope de una hora", "const FRESCA_ESCR = 15000;", "const FRESCA_ESCR = 3600000;"),
    ("lotes: deja uno de más", "if (!(per.lotes >= 1))", "if (!(per.lotes >= 0))"),
    ("lote: admite vacío", "us.length < 1 || ", ""),
    ("lote: sin tope", " || us.length > MAX_LOTE)", ")"),
    ("lote: no mira que sean canciones", "typeof u === 'string' && URI_CANCION.test(u) && quedan.has(u)", "typeof u === 'string' && quedan.has(u)"),
    ("lote: no mira que estén confirmadas", "typeof u === 'string' && URI_CANCION.test(u) && quedan.has(u)", "typeof u === 'string' && URI_CANCION.test(u)"),
    ("cuerpo: admite claves de más", "Object.keys(c).length !== 1 || ", ""),
    ("cuerpo: no compara canción a canción", " ||\n        !c.uris.every((u, i) => u === us[i])) return", ") return"),
    ("cuerpo: no compara la longitud", "c.uris.length !== us.length ||\n        !c.uris.every((u, i) => u === us[i])", "!us.every((u, i) => u === c.uris[i])"),
    ("al aprobar no tacha las canciones", "    uris.forEach(u => quedan.delete(u));\n", ""),
    ("al aprobar no descuenta el lote", "    x.permiso.lotes--;\n", ""),
    ("devuelve la lista de quien llama, sin copiar", "uris = x.pase.uris.slice();", "uris = x.pase.uris;"),
    ("envía a la ruta que diga quien llama", "return { ruta: '/playlists/' + x.pase.id + '/items', uris };", "return { ruta: x.ruta, uris };"),
]
for nombre, viejo, nuevo in flojas:
    muts.append((nombre, viejo, nuevo))

def corre():
    r = subprocess.run(['node', 'test/nucleo.js'], cwd=tmp, capture_output=True, text=True)
    fallos = [l.strip() for l in r.stdout.split('\n') if 'FALLA' in l]
    return r.returncode, fallos, r.stderr.strip().split('\n')[-1] if r.returncode and not fallos else ''

rc, f, _ = corre()
print('control (sin cambios):', 'bien' if rc == 0 else 'MAL ' + str(f[:2]))
vivas = []
for nombre, viejo, nuevo in muts:
    if orig.count(viejo) != 1:
        print('  ?? no encuentro (o está repetido %d veces): %s' % (orig.count(viejo), nombre)); vivas.append(nombre + ' (sin aplicar)'); continue
    open(os.path.join(tmp, 'core.js'), 'w', encoding='utf-8').write(orig.replace(viejo, nuevo))
    rc, f, err = corre()
    if rc == 0:
        vivas.append(nombre); print('  NO DETECTADA: ' + nombre)
    else:
        print('  detectada (%d fallos%s): %s' % (len(f), '; ' + err[:60] if err else '', nombre))
open(os.path.join(tmp, 'core.js'), 'w', encoding='utf-8').write(orig)
print('\n%d maneras de estropear la puerta; %d sin detectar.' % (len(muts), len(vivas)))
for v in vivas: print('  - ' + v)
shutil.rmtree(tmp)
