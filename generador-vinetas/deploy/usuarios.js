/* ==========================================================================
   USUARIOS DEL ÁREA DE EMPLEADOS — Ferretería San José

   >>> LAS CLAVES YA NO ESTÁN EN ESTE ARCHIVO <<<

   Cualquiera puede abrir este archivo desde el navegador, así que aquí solo
   quedan los NOMBRES y el rol. La clave de cada persona vive en Netlify, en la
   variable FSJ_USUARIOS, con este formato (una entrada por empleado):

     FSJ_USUARIOS = Diego:suClave:admin,Carlos:suClave:empleado,Mario:suClave:empleado

   Esa clave hace las dos cosas: entrar al área de empleados y subir fotos al
   servidor. No hay que escribir ninguna clave aparte en cada equipo.

   Para agregar o quitar gente: cambia la lista de abajo (nombre y rol) y la
   variable FSJ_USUARIOS en Netlify. Los nombres deben coincidir.

   rol: 'admin'    -> puede todo (incluye publicar y actualizar inventario)
        'empleado' -> puede usar las herramientas y cambiar precios/fotos
   ========================================================================== */
window.FSJ_USUARIOS = [
  { nombre: 'Diego',  rol: 'admin' },
  { nombre: 'Carlos', rol: 'empleado' },
  { nombre: 'Mario',  rol: 'empleado' },
];

/* Respaldo sin servidor: si necesitas trabajar con el sitio abierto desde una
   carpeta (sin Netlify), agrega un pin temporal a la línea que corresponda
   —por ejemplo { nombre:'Diego', rol:'admin', pin:'4729' }— y solo entonces se
   usará la comprobación local. Con el sitio publicado manda siempre el
   servidor, aunque haya pin escrito aquí. */

/* --------------------------------------------------------------------------
   Control de acceso (no hace falta modificar nada de aquí para abajo)
   -------------------------------------------------------------------------- */
window.FSJAuth = (function () {
  'use strict';
  var CLAVE_SESION = 'fsj-sesion';
  var CLAVE_VIEJA = 'fsj-calc-auth';   // compatibilidad con la versión anterior
  var CLAVE_ULTIMO = 'fsj-ultimo-usuario';
  var API_ENTRAR = '/api/entrar';

  function usuarios() { return window.FSJ_USUARIOS || []; }

  function usuario() {
    try {
      var raw = sessionStorage.getItem(CLAVE_SESION);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  /* Compara nombres sin fijarse en mayúsculas, acentos ni espacios de más:
     "  diego ", "Diego" y "DIEGO" son la misma persona. */
  function normNombre(s) {
    var t = String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t;
  }

  /* La sesión guarda la clave escrita (en pin) porque es la que autoriza subir
     fotos al servidor. Vive en sessionStorage: se borra al cerrar la pestaña. */
  function guardarSesion(u, clave) {
    var sesion = { nombre: u.nombre, rol: u.rol || 'empleado', pin: String(clave || ''), desde: Date.now() };
    try {
      sessionStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
      sessionStorage.setItem(CLAVE_VIEJA, '1');
    } catch (e) {}
    recordar(sesion.nombre);
    return sesion;
  }

  /* Respaldo local: solo sirve si la lista de arriba trae pin. */
  function entrarLocal(clave, nombre) {
    var n = normNombre(nombre);
    var u = usuarios().filter(function (x) {
      return x.pin && (!n || normNombre(x.nombre) === n);
    }).filter(function (x) { return String(x.pin) === String(clave); })[0];
    return u ? guardarSesion(u, clave) : null;
  }

  /* entrar(clave, nombre) -> Promise: la sesión si la clave es correcta, null si no.
     La comprobación la hace el servidor (/api/entrar), el único que conoce las
     claves. Si no hay servidor (sitio abierto desde una carpeta), se intenta el
     respaldo local. */
  /* Por qué falló el último intento. Importa distinguirlo: decirle "clave
     incorrecta" a alguien que la escribió bien, cuando lo que pasa es que el
     sitio no tiene las claves puestas, es mandarlo a buscar donde no es.
       'clave'          -> el nombre o la clave no cuadran
       'sin-configurar' -> falta la variable FSJ_USUARIOS en Netlify
       'sin-servidor'   -> no hay función desplegada o no hay conexión        */
  var motivo = '';
  function ultimoError() { return motivo; }

  function entrar(clave, nombre) {
    var c = String(clave == null ? '' : clave).trim();
    var n = String(nombre == null ? '' : nombre).trim();
    motivo = '';
    if (!c) { motivo = 'clave'; return Promise.resolve(null); }
    return fetch(API_ENTRAR, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: n, clave: c }),
      cache: 'no-store',
    }).then(function (r) {
      if (r.status === 401) { motivo = 'clave'; return null; }
      if (r.status === 503) { motivo = 'sin-configurar'; return respaldo(c, n); }
      if (!r.ok) { motivo = 'sin-servidor'; return respaldo(c, n); }
      return r.json().then(function (d) {
        if (!d || !d.ok || !d.nombre) { motivo = 'clave'; return null; }
        motivo = '';
        return guardarSesion({ nombre: d.nombre, rol: d.rol }, c);
      });
    }).catch(function () { motivo = 'sin-servidor'; return respaldo(c, n); });
  }

  function respaldo(c, n) {
    var s = entrarLocal(c, n);
    if (s) motivo = '';
    return s;
  }

  /* ¿El servidor tiene las claves puestas?
     -> Promise({ estado:'si'|'no'|'sin-servidor', pista:'...' }) */
  function estadoServidor() {
    return fetch(API_ENTRAR, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) return { estado: 'sin-servidor', pista: '' };
        return r.json().then(function (d) {
          return {
            estado: (d && d.configurado) ? 'si' : 'no',
            pista: (d && d.diagnostico && d.diagnostico.pista) || '',
          };
        });
      })
      .catch(function () { return { estado: 'sin-servidor', pista: '' }; });
  }

  /* último usuario que entró en este equipo (solo para marcarlo en la lista) */
  function ultimo() {
    try { return localStorage.getItem(CLAVE_ULTIMO) || ''; } catch (e) { return ''; }
  }
  function recordar(nombre) {
    try { localStorage.setItem(CLAVE_ULTIMO, String(nombre || '')); } catch (e) {}
  }

  function salir() {
    try {
      sessionStorage.removeItem(CLAVE_SESION);
      sessionStorage.removeItem(CLAVE_VIEJA);
    } catch (e) {}
    location.reload();
  }

  function esAdmin() { var u = usuario(); return !!u && u.rol === 'admin'; }
  function autenticado() { return !!usuario(); }

  return {
    usuarios: usuarios, usuario: usuario, entrar: entrar, salir: salir,
    esAdmin: esAdmin, autenticado: autenticado, ultimo: ultimo, recordar: recordar,
    ultimoError: ultimoError, estadoServidor: estadoServidor
  };
})();
