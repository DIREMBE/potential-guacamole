/* ==========================================================================
   ACCESO AL ÁREA DE EMPLEADOS — Ferretería San José

   Pantalla de entrada compartida por todas las herramientas internas.
   Pide DOS pasos:
     1) ¿Quién eres?  -> se escribe el nombre del empleado (Diego, Carlos, Mario...)
     2) Su clave      -> se comprueba en el servidor (/api/entrar)

   Así el historial de cambios siempre queda con el nombre correcto.

   Cómo se usa en una página:
     <script src="usuarios.js"></script>
     <script src="acceso.js"></script>

   Opcional, ANTES de cargar este archivo:
     <script>window.FSJ_ACCESO = { sub:'Viñetas de precio · solo personal' };</script>

   Los nombres se editan en usuarios.js. Las claves NO están en ningún archivo
   del sitio: viven en Netlify, en la variable FSJ_USUARIOS.
   ========================================================================== */
(function () {
  'use strict';

  var cfg = window.FSJ_ACCESO || {};
  var SUB = cfg.sub || 'Panel de empleados · solo personal';
  var VOLVER = cfg.volver === null ? null : (cfg.volver || 'index.html');
  var EMBLEMA = cfg.emblema || 'assets/emblem.png';

  var CSS = [
    'html.fsj-bloqueado, html.fsj-bloqueado body{overflow:hidden !important}',
    'html.fsj-bloqueado body > *:not(#lock-screen){visibility:hidden !important}',
    '#lock-screen{position:fixed;inset:0;z-index:99999;background:#141210;align-items:center;justify-content:center;padding:24px;overflow:auto;transition:opacity .28s ease;font-family:"Barlow",system-ui,sans-serif;visibility:visible !important}',
    '#lock-card{width:100%;max-width:380px;background:#1C1813;border:1px solid rgba(255,255,255,.08);border-top:4px solid #F15930;border-radius:14px;padding:34px 28px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.5)}',
    '#lock-card .lock-emblem{height:60px;width:auto;margin:0 auto 16px;display:block}',
    '#lock-card .lock-title{font-family:"Anton",sans-serif;text-transform:uppercase;font-size:25px;color:#F4EEE6;letter-spacing:.02em;line-height:1;margin:0}',
    '#lock-card .lock-sub{font-size:13.5px;color:#A79E8F;margin-top:6px;letter-spacing:.03em}',
    '#lock-card .lock-pregunta{font-family:"Barlow Condensed",sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:14px;color:#A79E8F;margin:24px 0 12px}',
    '#lock-nombre{width:100%;margin-top:4px;text-align:center;font-family:inherit;font-size:17px;font-weight:600;padding:12px 14px;color:#F4EEE6;background:#141210;border:1.5px solid rgba(255,255,255,.16);border-radius:8px}',
    '#lock-nombre::placeholder{color:#5d5649;font-weight:400}',
    '#lock-nombre:focus{outline:none;border-color:#F15930;box-shadow:0 0 0 3px rgba(241,89,48,.2)}',
    '#lock-paso-clave .lock-hola{margin:22px 0 0;font-size:15px;color:#F4EEE6}',
    '#lock-paso-clave .lock-hola b{font-weight:700}',
    '#lock-paso-clave .lock-pide{font-size:13px;color:#A79E8F;margin-top:2px}',
    '#lock-input{width:100%;margin-top:16px;text-align:center;font-family:inherit;font-size:20px;font-weight:600;letter-spacing:.14em;padding:13px 14px;color:#F4EEE6;background:#141210;border:1.5px solid rgba(255,255,255,.16);border-radius:8px}',
    '#lock-input:focus{outline:none;border-color:#F15930;box-shadow:0 0 0 3px rgba(241,89,48,.2)}',
    '#lock-aviso{display:none;margin-top:18px;padding:12px 13px;border-radius:8px;border:1px solid rgba(241,89,48,.5);background:rgba(241,89,48,.12);color:#F6C7B4;font-size:13px;line-height:1.5;text-align:left}',
    '#lock-aviso b{color:#F4EEE6}',
    '#lock-aviso code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:rgba(0,0,0,.35);padding:1px 5px;border-radius:4px}',
    '#lock-error-nom{visibility:hidden;color:#F6A07F;font-size:13.5px;margin-top:10px;font-weight:600;min-height:18px}',
    '#lock-sigue{width:100%;margin-top:12px;font-family:inherit;font-weight:700;font-size:16px;padding:12px 16px;border-radius:8px;border:none;cursor:pointer;background:#F15930;color:#fff;transition:background .15s}',
    '#lock-sigue:hover{background:#d6481c}',
    '#lock-error{visibility:hidden;color:#F6A07F;font-size:13.5px;margin-top:11px;font-weight:600;min-height:18px}',
    '#lock-btn{width:100%;margin-top:14px;font-family:inherit;font-weight:700;font-size:16px;padding:12px 16px;border-radius:8px;border:none;cursor:pointer;background:#F15930;color:#fff;transition:background .15s}',
    '#lock-btn:hover{background:#d6481c}',
    '.lock-link{display:inline-block;margin-top:14px;background:none;border:none;padding:0;color:#A79E8F;font-family:inherit;font-size:13px;cursor:pointer;text-decoration:none;letter-spacing:.03em}',
    '.lock-link:hover{color:#F4EEE6}',
    '#lock-card .lock-back{display:block;margin-top:18px;color:#6E665A;font-size:12.5px;text-decoration:none;letter-spacing:.04em}',
    '#lock-card .lock-back:hover{color:#F4EEE6}',
    '@keyframes lockShake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(2px)}30%,50%,70%{transform:translateX(-5px)}40%,60%{transform:translateX(5px)}}',
    '#lock-card.shake{animation:lockShake .5s}'
  ].join('\n');

  function lista() {
    var us = (window.FSJAuth && window.FSJAuth.usuarios && window.FSJAuth.usuarios()) || window.FSJ_USUARIOS || [];
    return us;
  }

  /* Devuelve una promesa: la sesión si la clave es correcta, null si no.
     La comprobación de verdad la hace usuarios.js contra el servidor. */
  function entrar(clave, nombre) {
    if (window.FSJAuth && window.FSJAuth.entrar) {
      return Promise.resolve(window.FSJAuth.entrar(clave, nombre));
    }
    /* Respaldo por si usuarios.js no cargó: solo sirve si la lista trae pin. */
    var c = String(clave || '');
    var u = lista().filter(function (x) { return x.pin && (!nombre || x.nombre === nombre); })
      .filter(function (x) { return String(x.pin) === c; })[0];
    if (!u) return Promise.resolve(null);
    try { sessionStorage.setItem('fsj-calc-auth', '1'); } catch (e) {}
    return Promise.resolve({ nombre: u.nombre, rol: u.rol });
  }

  function autenticado() {
    if (window.FSJAuth && window.FSJAuth.autenticado) return window.FSJAuth.autenticado();
    try { return sessionStorage.getItem('fsj-calc-auth') === '1'; } catch (e) { return false; }
  }

  function sesion() {
    return (window.FSJAuth && window.FSJAuth.usuario && window.FSJAuth.usuario()) || null;
  }

  function ultimo() {
    if (window.FSJAuth && window.FSJAuth.ultimo) return window.FSJAuth.ultimo();
    try { return localStorage.getItem('fsj-ultimo-usuario') || ''; } catch (e) { return ''; }
  }

  function recordar(nombre) {
    if (window.FSJAuth && window.FSJAuth.recordar) return window.FSJAuth.recordar(nombre);
    try { localStorage.setItem('fsj-ultimo-usuario', nombre); } catch (e) {}
  }

  /* ---------- freno a los intentos a ciegas ----------
     No convierte el candado en algo infranqueable (es una página estática),
     pero corta de raíz el "probar claves hasta que salga". */
  var MAX_INTENTOS = 5, ESPERA_MS = 60000;
  function intentos() {
    try { return JSON.parse(localStorage.getItem('fsj-intentos') || '{}') || {}; } catch (e) { return {}; }
  }
  function guardarIntentos(o) {
    try { localStorage.setItem('fsj-intentos', JSON.stringify(o)); } catch (e) {}
  }
  function bloqueadoHasta() {
    var i = intentos();
    return (i.hasta && i.hasta > Date.now()) ? i.hasta : 0;
  }
  function sumarFallo() {
    var i = intentos();
    i.n = (i.n || 0) + 1;
    if (i.n >= MAX_INTENTOS) {
      // cada tanda de fallos espera más que la anterior
      var tandas = Math.floor(i.n / MAX_INTENTOS);
      i.hasta = Date.now() + ESPERA_MS * tandas;
    }
    guardarIntentos(i);
    return i;
  }
  function limpiarFallos() { guardarIntentos({}); }

  function avisar(u) {
    try { if (window.__fsjTrasLogin) window.__fsjTrasLogin(u || sesion()); } catch (e) {}
  }

  /* ---------- estilos: se agregan al final del <head> para que manden ---------- */
  var estilo = null;
  function ponerEstilos() {
    if (!estilo) {
      estilo = document.createElement('style');
      estilo.id = 'fsj-acceso-css';
      estilo.textContent = CSS;
    }
    (document.head || document.documentElement).appendChild(estilo);
  }

  /* ---------- pantalla ---------- */
  var ov = null, inp = null, err = null, card = null, elegido = null;

  function escapar(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function construir() {
    if (document.getElementById('lock-screen')) {
      // por si la página trae un candado viejo en el HTML: se descarta
      var viejo = document.getElementById('lock-screen');
      viejo.parentNode.removeChild(viejo);
    }
    ov = document.createElement('div');
    ov.id = 'lock-screen';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.style.display = 'flex';

    ov.innerHTML =
      '<div id="lock-card">' +
        '<img class="lock-emblem" src="' + escapar(EMBLEMA) + '" alt="Ferretería San José" onerror="this.style.display=\'none\'">' +
        '<div class="lock-title">Acceso interno</div>' +
        '<div class="lock-sub">' + escapar(SUB) + '</div>' +
        '<div id="lock-paso-usuario">' +
          '<div class="lock-pregunta">Tu nombre de usuario</div>' +
          '<input id="lock-nombre" type="text" autocomplete="off" autocapitalize="words" ' +
            'spellcheck="false" maxlength="30" placeholder="Escribe tu nombre" aria-label="Tu nombre de usuario">' +
          '<div id="lock-error-nom" role="alert">Escribe tu nombre para continuar.</div>' +
          '<button id="lock-sigue" type="button">Continuar</button>' +
        '</div>' +
        '<div id="lock-paso-clave" style="display:none">' +
          '<div class="lock-hola"><b id="lock-quien"></b></div>' +
          '<div class="lock-pide">Escribe tu clave</div>' +
          '<input id="lock-input" type="password" maxlength="60" autocomplete="current-password" placeholder="Tu clave" aria-label="Tu clave">' +
          '<div id="lock-error" role="alert">Clave incorrecta. Intenta de nuevo.</div>' +
          '<button id="lock-btn" type="button">Entrar</button>' +
          '<button id="lock-cambiar" type="button" class="lock-link">← Cambiar de usuario</button>' +
        '</div>' +
        (VOLVER ? '<a href="' + escapar(VOLVER) + '" class="lock-back">← Volver al sitio</a>' : '') +
      '</div>';

    document.body.appendChild(ov);
    card = document.getElementById('lock-card');
    inp = document.getElementById('lock-input');
    err = document.getElementById('lock-error');

    var nomInp = document.getElementById('lock-nombre');
    document.getElementById('lock-sigue').addEventListener('click', pasarAClave);
    nomInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') pasarAClave(); });
    nomInp.addEventListener('input', function () {
      document.getElementById('lock-error-nom').style.visibility = 'hidden';
    });
    setTimeout(function () { try { nomInp.focus(); } catch (e) {} }, 60);
    if (window.FSJAuth && FSJAuth.estadoServidor) {
      FSJAuth.estadoServidor().then(function (e) {
        if (e && e.estado === 'no') avisoServidor('sin-configurar', e.pista);
      });
    }

    document.getElementById('lock-cambiar').addEventListener('click', volverAUsuarios);
    document.getElementById('lock-btn').addEventListener('click', probar);
    inp.addEventListener('input', function () {
      err.style.visibility = 'hidden';
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') probar(); });

  }

  /* Del nombre escrito al paso de la clave. No se comprueba aquí si el nombre
     existe: si dijera "ese usuario no existe" estaríamos regalando la lista de
     empleados a cualquiera. El fallo se avisa una sola vez, al final. */
  function pasarAClave() {
    var v = document.getElementById('lock-nombre').value.trim().replace(/\s+/g, ' ');
    if (v.length < 2) {
      var e = document.getElementById('lock-error-nom');
      e.textContent = 'Escribe tu nombre para continuar.';
      e.style.visibility = 'visible';
      return;
    }
    pedirClave(v);
  }

  function pedirClave(nombre) {
    elegido = nombre;
    document.getElementById('lock-paso-usuario').style.display = 'none';
    document.getElementById('lock-paso-clave').style.display = 'block';
    // solo para saludar: "carlos" se muestra como "Carlos"
    var bonito = nombre.replace(/(^|\s)(\S)/g, function (_, a, b) { return a + b.toUpperCase(); });
    document.getElementById('lock-quien').textContent = 'Hola, ' + bonito;
    err.style.visibility = 'hidden';
    inp.value = '';
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
  }

  function volverAUsuarios() {
    elegido = null;
    inp.value = '';
    err.style.visibility = 'hidden';
    document.getElementById('lock-paso-clave').style.display = 'none';
    document.getElementById('lock-paso-usuario').style.display = 'block';
    var n = document.getElementById('lock-nombre');
    n.value = '';
    document.getElementById('lock-error-nom').style.visibility = 'hidden';
    setTimeout(function () { try { n.focus(); } catch (e) {} }, 60);
  }

  function probar() {
    var espera = bloqueadoHasta();
    if (espera) {
      var seg = Math.ceil((espera - Date.now()) / 1000);
      fallar('Demasiados intentos. Espera ' + seg + ' segundo' + (seg === 1 ? '' : 's') + '.');
      inp.value = '';
      return;
    }
    var v = inp.value.trim();
    if (v.length < 3) return;
    var btn = document.getElementById('lock-btn');
    var txt = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Comprobando…'; }
    Promise.resolve(entrar(v, elegido)).then(function (u) {
      if (btn) { btn.disabled = false; btn.textContent = txt; }
      if (u) { limpiarFallos(); recordar(u.nombre); abrir(u); return; }

      /* Si el fallo NO es culpa de quien escribe, hay que decirlo tal cual: si
         no, alguien con su clave bien puesta se queda probándola sin entender.
         Tampoco cuenta como intento fallido ni activa el freno. */
      var porQue = (window.FSJAuth && FSJAuth.ultimoError) ? FSJAuth.ultimoError() : 'clave';
      if (porQue === 'sin-configurar' || porQue === 'sin-servidor') {
        avisoServidor(porQue);
        if (window.FSJAuth && FSJAuth.estadoServidor) {
          FSJAuth.estadoServidor().then(function (e) {
            if (e && e.pista) avisoServidor(porQue, e.pista);
          });
        }
        return;
      }
      /* Mensaje igual siempre: si dijera "el nombre no existe" o "la clave de
         Diego es otra", estaríamos confirmando qué nombres son válidos. */
      var i = sumarFallo();
      var quedan = MAX_INTENTOS - (i.n % MAX_INTENTOS || MAX_INTENTOS);
      fallar(i.hasta && i.hasta > Date.now()
        ? 'Demasiados intentos. Espera un momento antes de volver a probar.'
        : 'Nombre o clave incorrectos.' + (quedan <= 2
            ? (quedan === 1 ? ' Te queda 1 intento.' : ' Te quedan ' + quedan + ' intentos.')
            : ''));
      inp.value = '';
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 0);
    });
  }

  /* Aviso grande cuando el problema es del sitio, no de la persona. */
  function avisoServidor(porQue, pista) {
    var caja = document.getElementById('lock-aviso');
    if (!caja) {
      caja = document.createElement('div');
      caja.id = 'lock-aviso';
      var card = document.getElementById('lock-card');
      card.insertBefore(caja, card.querySelector('#lock-paso-usuario'));
    }
    caja.innerHTML = porQue === 'sin-configurar'
      ? '<b>Tu clave está bien; el problema es del sitio.</b><br>' +
        'Todavía no tiene cargadas las claves de los empleados ' +
        '(falta la variable <code>FSJ_USUARIOS</code> en Netlify). ' +
        'Mientras no se ponga, no puede entrar nadie. Avísale a Diego.'
      : '<b>No se pudo consultar al servidor.</b><br>' +
        'Puede ser la conexión, o que el sitio se haya publicado sin la carpeta ' +
        '<code>netlify/</code>. Revisa el internet y vuelve a intentar.';
    if (pista) {
      caja.innerHTML += '<br><br><span style="color:#A79E8F">Lo que dice el servidor:</span><br>' + escapar(pista);
    }
    caja.style.display = 'block';
    if (err) err.style.visibility = 'hidden';
    var btn = document.getElementById('lock-btn');
    if (btn) btn.disabled = false;
  }

  function fallar(msg) {
    err.textContent = msg;
    err.style.visibility = 'visible';
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  }

  function abrir(u) {
    document.documentElement.classList.remove('fsj-bloqueado');
    if (ov) {
      ov.style.opacity = '0';
      setTimeout(function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); ov = null; }, 300);
    }
    avisar(u);
  }

  /* ---------- arranque ---------- */
  if (autenticado()) {
    document.documentElement.classList.remove('fsj-bloqueado');
    ponerEstilos();
    cuandoListo(function () {
      var viejo = document.getElementById('lock-screen');
      if (viejo && viejo.parentNode) viejo.parentNode.removeChild(viejo);
      avisar(sesion());
    });
  } else {
    document.documentElement.classList.add('fsj-bloqueado');
    ponerEstilos();
    cuandoListo(function () { ponerEstilos(); construir(); });
  }

  function cuandoListo(fn) {
    if (document.body) return fn();
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  window.FSJAcceso = {
    usuario: sesion,
    autenticado: autenticado,
    salir: function () { if (window.FSJAuth) window.FSJAuth.salir(); else location.reload(); }
  };
})();
