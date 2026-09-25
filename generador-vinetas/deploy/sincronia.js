/* ==========================================================================
   Guardar — Ferretería San José

   Una sola barra, arriba y siempre a la vista en las pantallas internas, con
   UN solo botón: Guardar.

   POR QUÉ
   Antes había varias formas de que algo llegara al sitio y ninguna decía la
   verdad completa. La barra decía «se comparte al instante», pero no era
   cierto para todo: un producto que se volvía a dar de alta, lo cargado desde
   el Excel o una foto que no terminó de subir se quedaban en el navegador
   del empleado. Por eso había productos que en el catálogo solo aparecían con
   una sesión abierta.

   Ahora la barra cuenta lo que el cliente TODAVÍA NO VE, y Guardar lo deja
   todo al día —cambios, fotos, la base entera si hace falta— y trae de paso lo
   que hayan hecho los demás.

   Se monta solo: basta con que la página tenga <div id="sync-estado"></div>
   y cargue este archivo después de inventario.js.
   ========================================================================== */
(function () {
  'use strict';

  var CSS = [
    /* Fija arriba: es lo que hay que ver antes de cerrar la pantalla. */
    '#sync-estado{position:sticky;top:0;z-index:60;margin:0 0 14px}',
    '.sync-caja{display:flex;align-items:center;gap:10px;flex-wrap:wrap;',
    '  padding:9px 13px;border-radius:9px;font-size:13.5px;line-height:1.45;',
    '  border:1px solid transparent;box-shadow:0 2px 10px rgba(0,0,0,.06)}',
    '.sync-caja .pt{width:9px;height:9px;border-radius:50%;flex:none}',
    '.sync-caja b{font-weight:700}',
    '.sync-caja .tx{flex:1;min-width:220px}',
    '.sync-caja .det{display:block;font-size:12.5px;opacity:.85;margin-top:2px}',
    /* Las pantallas internas son de fondo claro: el texto va oscuro para que
       se lea de verdad. */
    '.sync-ok{background:#EAF7EF;border-color:#A8DCBE;color:#17643A}',
    '.sync-ok .pt{background:#1EA25A}',
    '.sync-no{background:#FDF6E0;border-color:#E6CE7E;color:#6E5507}',
    '.sync-no .pt{background:#D9A400}',
    '.sync-mal{background:#FDEDE8;border-color:#F0B49E;color:#94300F}',
    '.sync-mal .pt{background:#E0491E}',
    '.sync-caja .btn-guardar{margin-left:auto;cursor:pointer;border-radius:8px;',
    '  padding:8px 18px;font:inherit;font-size:14px;font-weight:700;',
    '  background:#F06030;color:#fff;border:1px solid #d6481c}',
    '.sync-caja .btn-guardar:hover{background:#d6481c}',
    '.sync-ok .btn-guardar{background:#fff;color:#17643A;border-color:#8CCBA6;font-weight:600}',
    '.sync-caja .btn-guardar[disabled]{opacity:.6;cursor:default}',
    '@media(max-width:560px){.sync-caja .btn-guardar{margin-left:0;width:100%}}',
  ].join('');

  function ponerCSS() {
    if (document.getElementById('sync-css')) return;
    var s = document.createElement('style');
    s.id = 'sync-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var guardando = false;
  var ultimo = null;          // el informe del último Guardar, para enseñarlo

  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

  /* Lo que falta, dicho como lo diría una persona. */
  function queFalta(p) {
    var l = [];
    if (p.base) l.push(p.motivoBase);
    if (p.cola) l.push(plural(p.cola, 'cambio sin mandar', 'cambios sin mandar'));
    if (p.fotos) l.push(plural(p.fotos, 'foto que solo está en este equipo',
                                         'fotos que solo están en este equipo'));
    if (p.secciones && p.secciones.length) l.push('sin mandar: ' + p.secciones.join(', '));
    return l;
  }

  function pintar(caja) {
    if (!window.Inventario || !Inventario.pendientesDelCliente) return;
    if (guardando) return;                       // mientras guarda, manda el progreso
    var p = Inventario.pendientesDelCliente();
    var e = Inventario.estadoSincronizacion ? Inventario.estadoSincronizacion() : {};
    var clase, texto, det = '', boton = 'Guardar';

    if (p.sinClave) {
      clase = 'sync-no';
      texto = '<b>Entra con tu nombre y clave</b> para poder guardar.';
    } else if (!p.comprobado) {
      clase = 'sync-no';
      texto = 'Comprobando qué tiene el sitio…';
    } else if (e.error === 'clave') {
      clase = 'sync-mal';
      texto = '<b>Tu clave no fue aceptada.</b> Sal y vuelve a entrar; si sigue igual, avisa a Diego.';
    } else if (p.baseParcial) {
      clase = 'sync-no';
      texto = '<b>Este equipo tiene la base a medias.</b> Se completa sola en unos segundos; ' +
              'mientras tanto no se sube la base, para no borrarle nada a nadie.';
    } else if (p.total) {
      clase = 'sync-no';
      texto = '<b>El cliente todavía no ve todo.</b> Pulsa Guardar.';
      det = 'Falta: ' + queFalta(p).join(' · ') + '.';
    } else {
      clase = 'sync-ok';
      texto = '<b>Todo guardado.</b> Lo que ves aquí es lo que ve el cliente.';
      if (ultimo && ultimo.ok) det = resumenInforme(ultimo);
      boton = 'Guardar y traer lo de los demás';
    }

    if (ultimo && !ultimo.ok) {
      clase = 'sync-mal';
      texto = '<b>No se pudo guardar todo.</b> Vuelve a pulsar Guardar; si sigue, ' +
              'revisa el internet.';
      det = 'Faltó: ' + ultimo.faltan.join(' · ') + '.';
    }

    caja.className = 'sync-caja ' + clase;
    caja.innerHTML = '<span class="pt"></span>' +
      '<span class="tx">' + texto + (det ? '<span class="det">' + det + '</span>' : '') + '</span>' +
      (p.sinClave ? '' : '<button type="button" class="btn-guardar">' + boton + '</button>');

    var btn = caja.querySelector('.btn-guardar');
    if (btn) btn.addEventListener('click', function () { guardar(caja); });

    /* Si el sitio falla del todo, que aparezca la salida de emergencia. */
    var emer = document.getElementById('card-emergencia');
    if (emer) emer.hidden = !(ultimo && !ultimo.ok);
  }

  function resumenInforme(inf) {
    var l = [];
    if (inf.cambios) l.push(plural(inf.cambios, 'cambio mandado', 'cambios mandados'));
    if (inf.fotos) l.push(plural(inf.fotos, 'foto subida', 'fotos subidas'));
    if (inf.base) l.push('base guardada entera');
    if (inf.secciones && inf.secciones.length) l.push('mandado: ' + inf.secciones.join(', '));
    if (inf.recibidos) l.push(plural(inf.recibidos, 'cambio de otros equipos', 'cambios de otros equipos'));
    return l.length ? 'Último guardado: ' + l.join(' · ') + '.' : 'Nada que mandar: ya estaba al día.';
  }

  function textoPaso(p) {
    if (p.fase === 'cambios') return 'Mandando los cambios…';
    if (p.fase === 'fotos') return 'Subiendo fotos: ' + (p.hechas + 1) + ' de ' + p.total + '…';
    if (p.fase === 'ajustes') return 'Mandando proveedores, equivalentes y combos…';
    if (p.fase === 'base') {
      return p.etapa === 'cerrando'
        ? 'Guardando la base: terminando…'
        : 'Guardando la base entera: parte ' + (p.parte || 1) + ' de ' + (p.partes || '?') + '…';
    }
    if (p.fase === 'trayendo') return 'Trayendo lo de los demás equipos…';
    return 'Guardando…';
  }

  function guardar(caja) {
    if (guardando) return;
    guardando = true;
    ultimo = null;
    var btn = caja.querySelector('.btn-guardar');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    caja.className = 'sync-caja sync-no';
    var tx = caja.querySelector('.tx');
    Promise.resolve(Inventario.guardarTodo(function (p) {
      if (tx) tx.innerHTML = '<b>' + textoPaso(p) + '</b> No cierres esta pantalla.';
    })).then(function (inf) {
      ultimo = inf;
    }).catch(function (err) {
      ultimo = { ok: false, faltan: [String((err && err.message) || err || 'error')] };
    }).then(function () {
      guardando = false;
      pintar(caja);
      /* La pantalla puede querer redibujarse (contadores, avisos). */
      try { document.dispatchEvent(new CustomEvent('fsj-guardado', { detail: ultimo })); } catch (e) {}
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
    /* Se repinta unas cuantas veces al principio: la barra aparece antes de
       que termine de comprobarse qué tiene el sitio. */
    [400, 1000, 2000, 4000, 8000].forEach(function (ms) { setTimeout(listo, ms); });

    if (window.Inventario && Inventario.onCambio) {
      Inventario.onCambio(function (tipo) {
        /* Cualquier cambio puede dejar algo pendiente (o quitarlo). Se agrupa
           para no repintar cien veces seguidas al cargar un archivo. */
        if (tipo === 'guardado') return;
        clearTimeout(montar._t);
        montar._t = setTimeout(listo, 350);
      });
    }
    setInterval(listo, 30000);

    /* Antes de cerrar con cosas que el cliente no ve, se pregunta. Es justo
       el descuido que dejaba productos sin aparecer. */
    window.addEventListener('beforeunload', function (ev) {
      if (!window.Inventario || !Inventario.pendientesDelCliente) return;
      var p = Inventario.pendientesDelCliente();
      if (guardando || (p.total && !p.sinClave)) {
        ev.preventDefault();
        ev.returnValue = '';
        return '';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }
})();
