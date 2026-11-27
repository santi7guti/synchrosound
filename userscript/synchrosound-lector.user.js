// ==UserScript==
// @name         SynchroSound · lector de Soundeo
// @namespace    synchrosound
// @version      2
// @description  Lee tus favoritos y descargas de Soundeo cuando se lo pide SynchroSound. Solo si tú lo tocas allí, quita la estrella de las canciones que SynchroSound te proponga. Nunca da estrellas ni descarga.
// @match        https://soundeo.com/*
// @match        https://www.soundeo.com/*
// @run-at       document-start
// @inject-into  auto
// @noframes
// ==/UserScript==

// Este archivo se instala una sola vez. No hace nada mientras usas Soundeo: solo arranca cuando llegas desde
// SynchroSound pulsando «Leer Soundeo» o «Ir a Soundeo a quitar ★», que ponen una marca de un solo uso en la
// dirección. Entonces descarga el lector (SRC), que lee tus favoritos y tus descargas y te devuelve a SynchroSound
// con la lista. Desde la versión 1.1.0 del lector, además, puede quitar la estrella de las canciones que SynchroSound
// pida en esa marca, y solo de la que tú toques en su panel, una a una. Nunca da estrellas ni descarga.
// No guarda nada en Soundeo, no conecta Dropbox y no toca Soundeo Feed.
// (La versión 1 de este archivo hace exactamente lo mismo: solo cambian estos textos. No hace falta reinstalarlo.)
(function () {
  'use strict';
  var m = /^#synchrosound=([A-Za-z0-9_-]{16,64})$/.exec(location.hash || '');
  if (!m) return; // uso normal de Soundeo: termina aquí, sin red ni pantalla
  if (window.top !== window.self || window.__SSYNC_LECTOR__) return;
  window.__SSYNC_LECTOR__ = { marca: m[1], cargador: '2' };

  var SRC = 'https://santi7guti.github.io/synchrosound/userscript/synchrosound-lector.app.js';

  function avisa(texto) {
    var pon = function () {
      try {
        var d = document.createElement('div');
        d.textContent = 'SynchroSound: ' + texto + ' (toca para cerrar)';
        d.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:2147483647;padding:14px 16px;border-radius:8px;' +
          'background:#16181c;color:#f6f6f2;font:16px/1.35 -apple-system,system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.4)';
        d.addEventListener('click', function () { d.remove(); });
        document.documentElement.appendChild(d);
      } catch (e) { /* nada */ }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pon); else pon();
  }
  function valido(codigo) {
    return typeof codigo === 'string' && codigo.length > 3000 && codigo.indexOf('__SSYNC_LECTOR_APP__') > 0;
  }

  fetch(SRC + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (codigo) {
      if (!valido(codigo)) throw new Error('lo descargado no es el lector');
      (0, eval)(codigo + '\n//# sourceURL=synchrosound-lector.app.js');
    })
    .catch(function (e) {
      avisa('no se ha podido cargar el lector de Soundeo (' + ((e && e.message) || e) + '). Vuelve a SynchroSound y pulsa «Leer Soundeo» otra vez.');
    });
})();
