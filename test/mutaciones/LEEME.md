# Guiones de mutaciones (hechos para la v0.3.0)

Sirven para probar las pruebas. Cada guion estropea el código a propósito, de una manera cada vez (un cambio pequeño), y mira si las pruebas fallan. Si con un cambio las pruebas siguen pasando, a las pruebas les falta un caso.

No forman parte de la app: la web no los usa. Trabajan sobre copias en carpetas temporales y no modifican el repo. No llevan datos de ninguna biblioteca real.

## Cómo se usan

Desde la raíz del repo.

- **`mut-nucleo.py`** estropea la puerta de escritura (`core.js`) y pasa `test/nucleo.js`. Tarda segundos.

  ```
  python3 test/mutaciones/mut-nucleo.py
  ```

- **`mut-e2e.py`** estropea el motor de sincronización (`app.js`) y pasa las pruebas de sincronización de `test/e2e.js` (`SOLO=escritura`, parando en el primer fallo). Necesita `NODE_PATH` y `CHROME`, igual que `test/e2e.js`. Cada cambio tarda entre medio minuto y un cuarto de hora, y van de dos en dos.

  ```
  python3 test/mutaciones/mut-e2e.py . --lista            # sin pasar pruebas: dice si cada cambio se puede aplicar
  NODE_PATH=<…> CHROME=<…> python3 test/mutaciones/mut-e2e.py . salida.txt        # todos
  NODE_PATH=<…> CHROME=<…> python3 test/mutaciones/mut-e2e.py . salida.txt 3 7    # solo esos
  ```

  El resultado va al archivo de salida: una línea por cambio, con «detectada» (y la prueba que falló) o «NO DETECTADA».

## Para qué versión son

Para la **v0.3.0**. Cada cambio busca un trozo exacto del código; si el código cambia, ese cambio deja de poder aplicarse y el guion lo dice («no encuentro», «NO APLICADA», «NO SE PUEDE»). Antes de usarlos con otra versión hay que poner al día las listas, y añadir cambios para lo nuevo.

Estado con la v0.3.0:

- `mut-nucleo.py`: las pruebas detectan todos los cambios.
- `mut-e2e.py`: todos los cambios se pueden aplicar. Se detectaron todos mientras se preparaba la versión, la mayoría sobre el commit anterior a los últimos retoques; la pasada entera no se repitió sobre el código final.
