/* ==========================================================================
   Ajustes del candado para el tablero — Ferretería San José

   Va ANTES de /acceso.js. Es un archivo aparte (y no un <script> dentro de
   la página) porque la política de seguridad del tablero no deja ejecutar
   código escrito dentro del HTML.

   El candado es el mismo de todo el área de empleados: nombre + clave,
   comprobada en el servidor contra FSJ_USUARIOS. Quién puede ver la página de
   gerencia (rol admin) lo decide tablero.js después de entrar.
   ========================================================================== */
(function () {
  'use strict';
  var gerencia = /^\/gerencia\//.test(location.pathname);
  window.FSJ_ACCESO = {
    sub: gerencia ? 'Tablero de gerencia · solo administración'
                  : 'Tablero de ventas y pedidos · solo personal',
    volver: '/',
    emblema: '/assets/emblem.png',
  };
})();
