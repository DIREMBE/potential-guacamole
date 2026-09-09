/* ==========================================================================
   Ajustes compartidos del negocio — Ferretería San José

   POR QUÉ EXISTE
   La tabla «quién le vende cada marca» no es de un equipo, es de la
   ferretería: si Diego le pone proveedor a TRUPER, Carlos tiene que verlo.
   Estaba guardada en el navegador de cada quien, y eso significaba que cada
   uno tenía su propia versión y ninguna era la buena.

   Aquí vive una sola, y todos leen la misma.

   NO ES PÚBLICO
   A quién le compramos y a qué marca es información del negocio, así que
   hasta para LEER hace falta la clave del empleado. Esto no lo toca el
   catálogo del cliente.

   SE MEZCLA, NO SE PISA
   Si Diego asigna una marca y Carlos otra al mismo tiempo, mandar el mapa
   entero haría que el último borrara lo del primero. Por eso lo normal es
   mandar solo lo que cambió (`cambios`) y el servidor lo mezcla. Reemplazar
   entero se puede, pero hay que pedirlo a propósito — es lo que hace
   «cargar una tabla» desde un archivo.

   RUTAS
     GET    /api/config              -> { proveedores, actualizado, por }
     POST   /api/config              -> { clave, cambios:{MARCA:'quien'} }   mezcla
     POST   /api/config              -> { clave, proveedores:{...}, reemplazar:true }
     DELETE /api/config              -> { clave }   deja la tabla vacía

   La variable de Netlify es la misma de siempre: FSJ_USUARIOS.
   ========================================================================== */
import { getStore } from '@netlify/blobs';

const STORE = 'fsj-config';
const LLAVE = 'proveedores';
const MAX_MARCAS = 2000;        // tope de cordura
const MAX_LARGO = 80;           // lo que cabe en un nombre de proveedor

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
}

function clavesValidas() {
  return String(process.env.FSJ_USUARIOS || '')
    .split(',')
    .map((e) => String(e.split(':')[1] || '').trim())
    .filter(Boolean)
    .concat(String(process.env.FSJ_CLAVE || '').split(',').map((c) => c.trim()).filter(Boolean));
}

function iguales(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return dif === 0;
}

function claveOk(clave) {
  const c = String(clave || '').trim();
  if (!c) return false;
  const validas = clavesValidas();
  if (!validas.length) return false;
  let vale = false;
  for (const v of validas) if (iguales(v, c)) vale = true;
  return vale;
}

function quienEs(clave) {
  const c = String(clave || '').trim();
  for (const entrada of String(process.env.FSJ_USUARIOS || '').split(',')) {
    const p = entrada.split(':');
    if (p[1] && iguales(String(p[1]).trim(), c)) return String(p[0] || '').trim();
  }
  return '';
}

/* La marca se guarda en mayúsculas para que «Truper» y «TRUPER» sean la
   misma; el nombre del proveedor se respeta tal como se escribió. */
function limpiarMapa(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  let n = 0;
  for (const k of Object.keys(obj)) {
    if (n >= MAX_MARCAS) break;
    const marca = String(k || '').trim().toUpperCase().slice(0, MAX_LARGO);
    const quien = String(obj[k] == null ? '' : obj[k]).trim().slice(0, MAX_LARGO);
    if (!marca || !quien) continue;
    out[marca] = quien;
    n++;
  }
  return out;
}

async function leer(store) {
  try {
    const d = await store.get(LLAVE, { type: 'json' });
    if (d && d.proveedores) return d;
  } catch (e) {}
  return { proveedores: {}, actualizado: '', por: '' };
}

export default async (req) => {
  let store;
  try { store = getStore(STORE); }
  catch (e) { return json({ ok: false, disponible: false, error: 'blobs no disponible' }, 503); }

  const clave = req.headers.get('x-fsj-clave') || '';

  /* -------------------------------- LEER -------------------------------- */
  if (req.method === 'GET') {
    if (!clavesValidas().length) {
      return json({ ok: false, disponible: false, error: 'sin claves configuradas' }, 503);
    }
    if (!claveOk(clave)) return json({ ok: false, error: 'hace falta la clave' }, 401);
    const d = await leer(store);
    return json({ ok: true, disponible: true, proveedores: d.proveedores,
                  actualizado: d.actualizado || '', por: d.por || '',
                  count: Object.keys(d.proveedores).length });
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return json({ ok: false, error: 'método no permitido' }, 405);
  }

  let datos = null;
  try { datos = await req.json(); } catch (e) { datos = null; }
  const c = (datos && datos.clave) || clave;

  if (!clavesValidas().length) {
    return json({ ok: false, error: 'sin claves configuradas', pista:
      'Falta la variable FSJ_USUARIOS en Netlify (Site configuration → Environment variables).' }, 503);
  }
  if (!claveOk(c)) {
    await new Promise((r) => setTimeout(r, 400));
    return json({ ok: false, error: 'clave incorrecta' }, 401);
  }

  /* ------------------------------- BORRAR ------------------------------- */
  if (req.method === 'DELETE') {
    await store.setJSON(LLAVE, { proveedores: {}, actualizado: new Date().toISOString(), por: quienEs(c) });
    return json({ ok: true, proveedores: {}, count: 0 });
  }

  /* ------------------------------ GUARDAR ------------------------------- */
  const actual = await leer(store);
  let mapa;

  if (datos && datos.reemplazar) {
    mapa = limpiarMapa(datos.proveedores);
  } else {
    /* Se mezcla sobre lo que ya hay: así dos personas asignando marcas
       distintas a la vez no se borran una a la otra. Un valor vacío quita
       esa marca, que es como se desasigna. */
    mapa = Object.assign({}, actual.proveedores);
    const cambios = (datos && datos.cambios) || {};
    if (!cambios || typeof cambios !== 'object') return json({ ok: false, error: 'no vienen cambios' }, 400);
    for (const k of Object.keys(cambios)) {
      const marca = String(k || '').trim().toUpperCase().slice(0, MAX_LARGO);
      if (!marca) continue;
      const quien = String(cambios[k] == null ? '' : cambios[k]).trim().slice(0, MAX_LARGO);
      if (quien) mapa[marca] = quien; else delete mapa[marca];
    }
    if (Object.keys(mapa).length > MAX_MARCAS) {
      return json({ ok: false, error: 'demasiadas marcas', maximo: MAX_MARCAS }, 413);
    }
  }

  const guardado = { proveedores: mapa, actualizado: new Date().toISOString(), por: quienEs(c) };
  try { await store.setJSON(LLAVE, guardado); }
  catch (e) { return json({ ok: false, error: 'no se pudo guardar' }, 500); }

  return json({ ok: true, proveedores: mapa, count: Object.keys(mapa).length,
                actualizado: guardado.actualizado, por: guardado.por });
};

export const config = {
  path: '/api/config',
};
