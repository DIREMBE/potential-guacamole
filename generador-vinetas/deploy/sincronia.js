/* ==========================================================================
   Aviso de "esto se está compartiendo" — Ferretería San José

   Una línea arriba de las pantallas internas que dice, sin rodeos, si lo que
   la persona cambia lo van a ver los demás o se queda en este equipo. Antes
   no había forma de saberlo y era justo la duda importante.

   Se monta solo: basta con que la página tenga <div id="sync-estado"></div>
   y cargue este archivo después de inventario.js.
   ========================================================================== */
(function () {
  'use strict';

  var CSS = [
    '#sync-estado{margin:0 0 14px}',
    '.sync-caja{display:flex;align-items:center;gap:10px;flex-wrap:wrap;',
    '  padding:9px 13px;border-radius:9px;font-size:13.5px;line-height:1.45;',
    '  border:1px solid transparent}',
    '.sync-caja .pt{width:8px;height:8px;border-radius:50%;flex:none}',
    '.sync-caja b{font-weight:700}',
    /* Las pantallas internas son de fondo claro: el texto va oscuro para que
       se lea de verdad, no solo "se vea bonito". */
    '.sync-ok{background:#EAF7EF;border-color:#A8DCBE;color:#17643A}',
    '.sync-ok .pt{background:#1EA25A}',
    '.sync-no{background:#FDF6E0;border-color:#E6CE7E;color:#6E5507}',
    '.sync-no .pt{background:#D9A400}',
    '.sync-mal{background:#FDEDE8;border-color:#F0B49E;color:#94300F}',
    '.sync-mal .pt{background:#E0491E}',
    '.sync-caja .btn-sync{margin-left:auto;background:transparent;cursor:pointer;',
    '  border:1px solid currentColor;color:inherit;border-radius:7px;',
    '  padding:5px 11px;font:inherit;font-size:12.5px;opacity:.85}',
    '.sync-caja .btn-sync:hover{opacity:1}',
    '.sync-caja .btn-sync[disabled]{opacity:.45;cursor:default}',
    '@media(max-width:520px){.sync-caja .btn-sync{margin-left:0;width:100%}}',
  ].join('');

  function ponerCSS() {
    if (document.getElementById('sync-css')) return;
    var s = document.createElement('style');
    s.id = 'sync-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function cuando(iso) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (!t) return '';
    var min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return 'hace un momento';
    if (min < 60) return 'hace ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'hace ' + h + (h === 1 ? ' hora' : ' horas');
    return 'el ' + new Date(t).toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
  }

  function pintar(caja) {
    if (!window.Inventario || !Inventario.estadoSincronizacion) return;
    var e = Inventario.estadoSincronizacion();
    var clase, texto;

    if (e.lleno) {
      clase = 'sync-mal';
      texto = '<b>Hay demasiados cambios sin publicar.</b> Se siguen guardando aquí, ' +
              'pero ya no se comparten hasta que publiques el inventario al sitio.';
    } else if (e.error === 'clave') {
      clase = 'sync-mal';
      texto = '<b>Tu clave no fue aceptada al compartir.</b> Los cambios se guardan en este ' +
              'equipo. Sal y vuelve a entrar; si sigue igual, avisa a Diego.';
    } else if (!e.comprobado) {
      /* Todavía se está preguntando al sitio. Decir "solo en este equipo"
         ahora sería mentir por unos segundos, y hace pensar a la persona que
         tiene que publicar cuando no. */
      clase = 'sync-no';
      texto = 'Comprobando si los cambios se están compartiendo…';
    } else if (!e.activo) {
      clase = 'sync-no';
      texto = '<b>Solo en este equipo.</b> Lo que cambies no lo verán los demás hasta ' +
              'publicar el inventario y subir el sitio.';
    } else if (e.pendientes > 0) {
      clase = 'sync-no';
      texto = '<b>' + e.pendientes + ' cambio' + (e.pendientes === 1 ? '' : 's') +
              ' sin mandar.</b> Suele ser el internet. Se reintenta solo; también ' +
              'puedes pulsar Actualizar.';
    } else {
      clase = 'sync-ok';
      var extra = e.enServidor
        ? ' · ' + e.enServidor + ' cambio' + (e.enServidor === 1 ? '' : 's') + ' compartido' +
          (e.enServidor === 1 ? '' : 's')
        : '';
      var ts = cuando(e.actualizado);
      texto = '<b>Se comparte al instante.</b> Lo que cambies aquí lo ven los demás ' +
              'equipos y el catálogo, sin subir archivos' + extra +
              (ts ? ' · ' + ts : '') + '.';
    }

    caja.className = 'sync-caja ' + clase;
    caja.innerHTML = '<span class="pt"></span><span class="tx">' + texto + '</span>' +
      '<button type="button" class="btn-sync">Actualizar</button>';

    var btn = caja.querySelector('.btn-sync');
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Buscando…';
      Promise.resolve(Inventario.sincronizar()).then(function (r) {
        var n = (r && r.recibidos) || 0;
        btn.textContent = n ? 'Llegaron ' + n : 'Al día';
        setTimeout(function () { pintar(caja); }, 1400);
      }).catch(function () {
        btn.textContent = 'No se pudo';
        setTimeout(function () { pintar(caja); }, 1800);
      });
    });
  }

  function montar() {
    var host = document.getElementById('sync-estado');
    if (!host) return;
    ponerCSS();
    var caja = document.createElement('div');
    host.appendChild(caja);

    var listo = function () { pintar(caja); };
    listo();
    /* Se repinta unas cuantas veces al principio: el listado aparece antes de
       que termine de comprobarse si hay servidor, y así el aviso se corrige
       solo en cuanto se sabe. */
    [400, 1000, 2000, 4000, 8000].forEach(function (ms) { setTimeout(listo, ms); });

    // se repinta cuando el motor avisa de algo
    if (window.Inventario && Inventario.onCambio) {
      Inventario.onCambio(function (tipo) {
        if (tipo === 'sincronizado' || tipo === 'publicado') pintar(caja);
      });
    }
    // y cada tanto, por si cambió el estado del internet
    setInterval(listo, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }
})();
