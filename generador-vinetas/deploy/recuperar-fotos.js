/* ==========================================================================
   HERRAMIENTA TEMPORAL — Recuperar fotos que se quedaron en un equipo
   Ferretería San José

   POR QUÉ EXISTE
   Al guardar una foto, el sistema la guarda en el equipo y enseguida la sube
   al sitio. Si la subida falla —porque en ese momento la función de fotos no
   estaba en línea, o faltaba la clave del servidor— la foto se queda SOLO en
   ese equipo. No se pierde, pero no la ve nadie más.

   Esto compara las fotos de este equipo con las que hay en el sitio y sube
   las que faltan. Hay que abrirlo EN CADA EQUIPO que tenga fotos varadas.

   CÓMO SE QUITA (cuando ya no haga falta)
   1. Borrar este archivo.
   2. Borrar la línea <script src="recuperar-fotos.js"></script> de
      inventario-admin.html.
   Nada más. No toca inventario.js ni ningún otro archivo: lee la base del
   navegador y habla con /api/fotos por su cuenta, a propósito, para que
   quitarlo no pueda romper nada.
   ========================================================================== */
(function () {
  'use strict';

  var DB = 'fsj-inventario';
  var TIENDA = 'imagenes';
  var API = '/api/fotos';

  /* ----------------------------- Utilidades ----------------------------- */

  /* Se abre SIN número de versión: así se usa la base tal como está y no se
     dispara ninguna actualización de esquema por accidente. */
  function abrirBase() {
    return new Promise(function (listo, falla) {
      var r = indexedDB.open(DB);
      r.onsuccess = function () { listo(r.result); };
      r.onerror = function () { falla(r.error); };
    });
  }

  function fotosDeEsteEquipo() {
    return abrirBase().then(function (db) {
      if (db.objectStoreNames.contains(TIENDA) === false) return [];
      return new Promise(function (listo, falla) {
        var t = db.transaction(TIENDA, 'readonly').objectStore(TIENDA).getAll();
        t.onsuccess = function () {
          listo((t.result || []).filter(function (x) { return x && x.item && x.data; }));
        };
        t.onerror = function () { falla(t.error); };
      });
    });
  }

  function fotosDelSitio() {
    return fetch(API, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { return (d && d.items) ? d.items.map(String) : []; });
  }

  /* La clave que autoriza a escribir: la de fotos si la hay, y si no la que
     escribió la persona al entrar (queda en la sesión). */
  function clave() {
    try {
      if (window.Inventario && Inventario.getClaveFotos && Inventario.getClaveFotos()) {
        return Inventario.getClaveFotos();
      }
    } catch (e) {}
    try {
      var s = JSON.parse(sessionStorage.getItem('fsj-sesion') || '{}');
      return String(s.pin || '');
    } catch (e) { return ''; }
  }

  function aBlob(dataUri) {
    var partes = String(dataUri).split(',');
    var tipo = (/data:([^;]+)/.exec(partes[0]) || [, 'image/jpeg'])[1];
    var bin = atob(partes[1] || '');
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: tipo });
  }

  function nombreDe(item) {
    try {
      var p = window.Inventario && Inventario.porItem && Inventario.porItem(item);
      return p ? p.nombre : ('ITEM ' + item);
    } catch (e) { return 'ITEM ' + item; }
  }

  /* ------------------------------ La subida ----------------------------- */

  function subirUna(item, dataUri, k) {
    return fetch(API + '/' + encodeURIComponent(item), {
      method: 'POST',
      headers: { 'content-type': aBlob(dataUri).type, 'x-fsj-clave': k },
      body: aBlob(dataUri),
    }).then(function (r) {
      if (r.ok) return { ok: true };
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: false, estado: r.status, error: (d && d.error) || ('HTTP ' + r.status) };
      });
    }).catch(function () { return { ok: false, estado: 0, error: 'sin conexión' }; });
  }

  /* ------------------------------- Pantalla ----------------------------- */

  var CSS = [
    '#rec-fotos{margin:0 0 14px}',
    '.rec-caja{border:1px solid #E6CE7E;background:#FDF6E0;color:#6E5507;',
    '  border-radius:9px;padding:13px 15px;font-size:13.5px;line-height:1.5}',
    '.rec-caja h3{margin:0 0 6px;font-size:15px;color:#5A4506}',
    '.rec-caja .rec-btn{margin-top:10px;background:#D9A400;color:#3A2E00;border:0;',
    '  border-radius:8px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer}',
    '.rec-caja .rec-btn:hover{background:#c39400}',
    '.rec-caja .rec-btn[disabled]{opacity:.55;cursor:default}',
    '.rec-caja .rec-lista{margin:8px 0 0;padding-left:18px;max-height:150px;overflow:auto}',
    '.rec-caja .rec-lista li{margin:1px 0}',
    '.rec-ok{border-color:#A8DCBE;background:#EAF7EF;color:#17643A}',
    '.rec-ok h3{color:#12522F}',
    '.rec-mal{border-color:#F0B49E;background:#FDEDE8;color:#94300F}',
    '.rec-mal h3{color:#7A2709}',
  ].join('');

  function ponerCSS() {
    if (document.getElementById('rec-fotos-css')) return;
    var s = document.createElement('style');
    s.id = 'rec-fotos-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function caja() {
    var host = document.getElementById('rec-fotos');
    if (host) return host.firstChild;
    ponerCSS();
    host = document.createElement('div');
    host.id = 'rec-fotos';
    var c = document.createElement('div');
    c.className = 'rec-caja';
    host.appendChild(c);

    /* Se pone arriba del todo, donde no se pueda pasar por alto. */
    var wrap = document.querySelector('.wrap') || document.body;
    var sync = document.getElementById('sync-estado');
    if (sync && sync.parentNode === wrap) wrap.insertBefore(host, sync.nextSibling);
    else wrap.insertBefore(host, wrap.firstChild);
    return c;
  }

  function pintar(html, clase) {
    var c = caja();
    c.className = 'rec-caja' + (clase ? ' ' + clase : '');
    c.innerHTML = html;
    return c;
  }

  /* -------------------------------- Revisar ----------------------------- */

  var varadas = [];

  function revisar() {
    return Promise.all([fotosDeEsteEquipo(), fotosDelSitio()]).then(function (r) {
      var aqui = r[0], enSitio = r[1];
      var yaEstan = {};
      enSitio.forEach(function (i) { yaEstan[String(i)] = true; });
      varadas = aqui.filter(function (f) { return !yaEstan[String(f.item)]; });

      if (!aqui.length) return;                       // este equipo no tiene fotos: nada que decir
      if (!varadas.length) {
        pintar('<h3>Las fotos de este equipo ya están en el sitio</h3>' +
               'Este equipo tiene <b>' + aqui.length + '</b> foto' + (aqui.length === 1 ? '' : 's') +
               ' guardada' + (aqui.length === 1 ? '' : 's') + ', y todas están subidas. ' +
               'En el sitio hay <b>' + enSitio.length + '</b> en total.', 'rec-ok');
        return;
      }

      var lista = varadas.slice(0, 30).map(function (f) {
        return '<li>' + String(nombreDe(f.item)).slice(0, 60) + '</li>';
      }).join('');
      pintar(
        '<h3>Hay ' + varadas.length + ' foto' + (varadas.length === 1 ? '' : 's') +
        ' que solo está' + (varadas.length === 1 ? '' : 'n') + ' en este equipo</h3>' +
        'Se guardaron aquí pero nunca llegaron al sitio, así que no las ve nadie más. ' +
        'En el sitio hay <b>' + enSitio.length + '</b>; en este equipo, <b>' + aqui.length + '</b>.' +
        '<ul class="rec-lista">' + lista +
        (varadas.length > 30 ? '<li>… y ' + (varadas.length - 30) + ' más</li>' : '') + '</ul>' +
        '<button type="button" class="rec-btn" id="rec-subir">Subir las ' + varadas.length +
        ' al sitio</button>');

      var btn = document.getElementById('rec-subir');
      if (btn) btn.addEventListener('click', subirTodas);
    }).catch(function (e) {
      pintar('<h3>No se pudo revisar las fotos</h3>' +
             'El sitio no respondió. Revisa la conexión y recarga la página.' +
             '<br><small>' + String(e && e.message ? e.message : e) + '</small>', 'rec-mal');
    });
  }

  /* -------------------------------- Subir ------------------------------- */

  function subirTodas() {
    var btn = document.getElementById('rec-subir');
    var k = clave();
    if (!k) {
      pintar('<h3>Falta tu clave</h3>Sal del panel y vuelve a entrar con tu nombre y clave, ' +
             'y prueba otra vez.', 'rec-mal');
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Subiendo…'; }

    var subidas = 0, fallaron = [], i = 0;

    function siguiente() {
      if (i >= varadas.length) return terminar();
      var f = varadas[i++];
      if (btn) btn.textContent = 'Subiendo ' + i + ' de ' + varadas.length + '…';
      return subirUna(f.item, f.data, k).then(function (r) {
        if (r.ok) subidas++;
        else fallaron.push({ item: f.item, error: r.error, estado: r.estado });
        /* Una pausa mínima: no hace falta atropellar al servidor y así el
           número de arriba se ve avanzar. */
        return new Promise(function (l) { setTimeout(l, 60); }).then(siguiente);
      });
    }

    function terminar() {
      if (!fallaron.length) {
        pintar('<h3>Listo: ' + subidas + ' foto' + (subidas === 1 ? '' : 's') + ' subida' +
               (subidas === 1 ? '' : 's') + '</h3>' +
               'Ya se ven en todos los equipos y en el catálogo. ' +
               'Si hay más equipos con fotos, abre esta misma página en cada uno.', 'rec-ok');
        try { if (window.Inventario && Inventario.sincronizar) Inventario.sincronizar(); } catch (e) {}
        return;
      }
      var porClave = fallaron.some(function (x) { return x.estado === 401 || x.estado === 403; });
      pintar('<h3>Subieron ' + subidas + ', fallaron ' + fallaron.length + '</h3>' +
             (porClave
               ? 'El sitio no aceptó tu clave. Sal del panel, vuelve a entrar y prueba otra vez. ' +
                 'Si sigue igual, revisa que la variable FSJ_USUARIOS esté puesta en Netlify.'
               : 'Casi siempre es la conexión. Las fotos siguen guardadas aquí: puedes volver a ' +
                 'intentarlo recargando la página.') +
             '<ul class="rec-lista">' + fallaron.slice(0, 10).map(function (x) {
               return '<li>' + String(nombreDe(x.item)).slice(0, 48) + ' — ' + x.error + '</li>';
             }).join('') + '</ul>', 'rec-mal');
    }

    siguiente();
  }

  /* --------------------------------- Arranque --------------------------- */

  function arrancar() {
    /* Se espera a que el inventario esté cargado, para poder poner el nombre
       de cada producto en vez de un número suelto. */
    var intentos = 0;
    (function esperar() {
      var listo = window.Inventario && Inventario.disponible && Inventario.disponible();
      if (listo || intentos++ > 40) return revisar();
      setTimeout(esperar, 400);
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }
})();
