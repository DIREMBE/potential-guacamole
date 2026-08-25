/* ==========================================================================
   Fotos de producto — Ferretería San José
   Guarda las fotos en Netlify Blobs para que se vean en TODOS los dispositivos
   sin volver a subir archivos al sitio.

   Rutas (ver netlify.toml):
     GET  /api/fotos            -> { items: ["14971", ...], actualizado }
     GET  /api/fotos/<item>     -> la foto (image/jpeg)
     POST /api/fotos/<item>     -> guarda la foto   (requiere clave)
     DELETE /api/fotos/<item>   -> borra la foto    (requiere clave)
   ========================================================================== */
import { getStore } from '@netlify/blobs';

const STORE = 'fsj-fotos';
const INDICE = '_indice';
const MAX_BYTES = 400 * 1024;   // una foto ya viene reducida a ~80 KB

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

/* Claves válidas para escribir. Se aceptan dos fuentes:
     1) FSJ_USUARIOS -> la clave de entrada de cada empleado (una sola clave por
        persona: la misma con la que entra al área interna).
        Formato: Diego:suClave:admin,Carlos:suClave:empleado
     2) FSJ_CLAVE    -> claves sueltas, separadas por coma (compatibilidad).
   Sin ninguna de las dos configurada, no se permite escribir. */
function clavesValidas() {
  const deUsuarios = String(process.env.FSJ_USUARIOS || '')
    .split(',')
    .map((e) => String(e.split(':')[1] || '').trim())
    .filter(Boolean);
  const sueltas = String(process.env.FSJ_CLAVE || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  return deUsuarios.concat(sueltas);
}
function autorizado(req) {
  const validas = clavesValidas();
  if (!validas.length) return false;          // sin claves configuradas no se permite escribir
  const dada = String(req.headers.get('x-fsj-clave') || '').trim();
  return !!dada && validas.indexOf(dada) >= 0;
}

/* El ITEM viene de la URL: solo se aceptan letras, números, guion y punto.
   Así nadie puede inventar rutas raras dentro del almacén de fotos. */
function itemValido(item) {
  return /^[A-Za-z0-9._-]{1,40}$/.test(item);
}

/* Comprueba que lo subido sea de verdad una imagen (JPG, PNG o WEBP) y no
   cualquier archivo disfrazado. */
function esImagen(buf) {
  const b = new Uint8Array(buf);
  if (b.length < 12) return false;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return true;                    // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return true;   // PNG
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true; // WEBP
  return false;
}

const MAX_FOTOS = 3000;   // tope de fotos distintas guardadas
/* true si guardar esta foto pasaría del tope (las que ya existen se pueden
   reemplazar siempre). */
function idxTope(idx, item) {
  return idx.items.length >= MAX_FOTOS && idx.items.indexOf(item) < 0;
}

async function leerIndice(store) {
  const idx = await store.get(INDICE, { type: 'json' });
  return idx && Array.isArray(idx.items) ? idx : { items: [], actualizado: null };
}

export default async (req, context) => {
  const store = getStore({ name: STORE, consistency: 'strong' });
  const url = new URL(req.url);
  // /api/fotos/<item>  ó  /.netlify/functions/fotos/<item>
  const partes = url.pathname.split('/').filter(Boolean);
  const iFotos = partes.lastIndexOf('fotos');
  const item = (iFotos >= 0 && partes[iFotos + 1]) ? decodeURIComponent(partes[iFotos + 1]) : '';

  try {
    /* ------------------------------- LEER ------------------------------- */
    if (req.method === 'GET') {
      if (!item) {
        const idx = await leerIndice(store);
        return json(idx, 200, { 'cache-control': 'public, max-age=30' });
      }
      if (!itemValido(item)) return json({ error: 'ITEM no válido' }, 400);
      const foto = await store.get('f_' + item, { type: 'arrayBuffer' });
      if (!foto) return json({ error: 'sin foto' }, 404);
      return new Response(foto, {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          // se puede cachear: al cambiar la foto cambia el parámetro ?v= desde el cliente
          'cache-control': 'public, max-age=86400',
        },
      });
    }

    /* ------------------------------ GUARDAR ----------------------------- */
    if (req.method === 'POST' || req.method === 'PUT') {
      if (!autorizado(req)) return json({ error: 'no autorizado' }, 401);
      if (!item) return json({ error: 'falta el ITEM' }, 400);
      if (!itemValido(item)) return json({ error: 'ITEM no válido' }, 400);

      const cuerpo = await req.arrayBuffer();
      if (!cuerpo || cuerpo.byteLength === 0) return json({ error: 'archivo vacío' }, 400);
      if (cuerpo.byteLength > MAX_BYTES) {
        return json({ error: 'la foto pesa demasiado (máx. ' + Math.round(MAX_BYTES / 1024) + ' KB)' }, 413);
      }
      if (!esImagen(cuerpo)) return json({ error: 'el archivo no es una imagen (JPG, PNG o WEBP)' }, 415);
      if (idxTope(await leerIndice(store), item)) {
        return json({ error: 'ya hay demasiadas fotos guardadas' }, 409);
      }

      await store.set('f_' + item, cuerpo);
      const idx = await leerIndice(store);
      if (idx.items.indexOf(item) < 0) idx.items.push(item);
      idx.actualizado = new Date().toISOString();
      await store.setJSON(INDICE, idx);
      return json({ ok: true, item, bytes: cuerpo.byteLength, total: idx.items.length });
    }

    /* ------------------------------ BORRAR ------------------------------ */
    if (req.method === 'DELETE') {
      if (!autorizado(req)) return json({ error: 'no autorizado' }, 401);
      if (!item) return json({ error: 'falta el ITEM' }, 400);
      if (!itemValido(item)) return json({ error: 'ITEM no válido' }, 400);
      await store.delete('f_' + item);
      const idx = await leerIndice(store);
      idx.items = idx.items.filter((x) => x !== item);
      idx.actualizado = new Date().toISOString();
      await store.setJSON(INDICE, idx);
      return json({ ok: true, item, total: idx.items.length });
    }

    return json({ error: 'método no permitido' }, 405);
  } catch (e) {
    return json({ error: 'error del servidor', detalle: String(e && e.message || e) }, 500);
  }
};

export const config = {
  path: ['/api/fotos', '/api/fotos/*'],
};
