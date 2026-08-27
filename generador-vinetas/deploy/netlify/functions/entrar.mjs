/* ==========================================================================
   Entrada de empleados — Ferretería San José

   Comprueba la clave EN EL SERVIDOR, no en el navegador. Así ninguna clave
   viaja dentro de los archivos del sitio.

   Ruta (ver netlify.toml / config de abajo):
     GET  /api/entrar   -> { ok, configurado }        (¿ya hay claves puestas?)
     POST /api/entrar   -> { nombre, clave }
                           200 { ok:true, nombre, rol } | 401 si no cuadra

   Variable de Netlify (Site settings → Environment variables):
     FSJ_USUARIOS = Diego:suClave:admin,Carlos:suClave:empleado,Mario:suClave:empleado

   Esa misma clave sirve para subir fotos (ver fotos.mjs): una sola por persona.
   ========================================================================== */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/* "  diego ", "Diego" y "DIEGO" son la misma persona (y sin acentos). */
function normNombre(s) {
  let t = String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
  return t;
}

/* FSJ_USUARIOS -> [{ nombre, clave, rol }] */
export function leerUsuarios() {
  return String(process.env.FSJ_USUARIOS || '')
    .split(',')
    .map((entrada) => {
      const p = entrada.split(':');
      const rol = String(p[2] || 'empleado').trim().toLowerCase();
      return {
        nombre: String(p[0] || '').trim(),
        clave: String(p[1] || '').trim(),
        rol: rol === 'admin' ? 'admin' : 'empleado',
      };
    })
    .filter((u) => u.nombre && u.clave);
}

/* Comparación que no delata la clave por el tiempo que tarda. */
function iguales(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return dif === 0;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export default async (req) => {
  const usuarios = leerUsuarios();

  /* ¿Está configurado? Además explica QUÉ falta: "false" a secas no distingue
     si la variable no llegó o si llegó mal escrita, y se arreglan distinto.
     No sale ninguna clave: solo nombres (que ya están en usuarios.js), cuántas
     entradas se leyeron y dónde está corriendo esto. */
  if (req.method === 'GET') {
    const bruto = String(process.env.FSJ_USUARIOS || '');

    let pista;
    if (!bruto) {
      pista = 'La variable FSJ_USUARIOS no está configurada en Netlify o no está disponible para Functions.';
    } else if (!usuarios.length) {
      pista = 'La variable SÍ llega (' + bruto.length + ' caracteres) pero no se pudo leer ninguna ' +
              'entrada. El formato es Nombre:clave:rol, separando personas con coma y sin espacios ' +
              'alrededor de los dos puntos. Ejemplo: Diego:suClave:admin,Carlos:otraClave:empleado';
    } else {
      pista = 'Todo en orden.';
    }

    return json({
      ok: true,
      configurado: usuarios.length > 0,
      diagnostico: {
        largoDeFSJ_USUARIOS: bruto.length,
        entradasLeidas: usuarios.length,
        pista: pista,
      },
    });
  }
  if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405);
  if (!usuarios.length) return json({ ok: false, error: 'sin usuarios configurados' }, 503);

  let datos = null;
  try { datos = await req.json(); } catch (e) { datos = null; }
  const nombre = normNombre(datos && datos.nombre);
  const clave = String((datos && datos.clave) || '').trim();
  if (!nombre || !clave) {
    await esperar(300);
    return json({ ok: false }, 401);
  }

  const u = usuarios.find((x) => normNombre(x.nombre) === nombre && iguales(x.clave, clave));
  if (!u) {
    /* Pausa corta: encarece el probar claves a ciegas y no molesta a nadie. */
    await esperar(400);
    return json({ ok: false }, 401);
  }
  return json({ ok: true, nombre: u.nombre, rol: u.rol });
};

export const config = {
  path: '/api/entrar',
};
