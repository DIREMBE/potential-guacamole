/* ==========================================================================
   Fotos de producto — Ferretería San José
   Guarda las fotos en Netlify Blobs para que se vean en TODOS los dispositivos
   sin volver a subir archivos al sitio.

   Rutas (ver netlify.toml):
     GET  /api/fotos              -> { items: ["14971", ...], mas, ver, actualizado }
     GET  /api/fotos/<item>       -> la foto principal (image/jpeg)
     GET  /api/fotos/<item>/<n>   -> la foto n (2 o 3)
     POST /api/fotos/<item>[/<n>] -> guarda la foto   (requiere clave)
     DELETE /api/fotos/<item>[/<n>] -> borra la foto  (requiere clave)

   HASTA 3 FOTOS POR PRODUCTO. La principal sigue donde siempre (f_<item>),
   así que todo lo que ya estaba guardado y las páginas viejas siguen
   funcionando. La 2 y la 3 van en f_<item>~2 y f_<item>~3.
   En el índice:
     items -> los que tienen foto (como antes)
     mas   -> { item: 2|3 } solo los que tienen más de una
     ver   -> { item: 'versión' } cambia cada vez que se tocan sus fotos, para
              que el navegador no se quede enseñando una foto vieja
   Las fotos van siempre seguidas: si se borra la 2 de 3, la 3 pasa a ser la
   2. Así nunca hay huecos y el catálogo no tiene que adivinar.
   ========================================================================== */
import { getStore } from '@netlify/blobs';

const STORE = 'fsj-fotos';
const INDICE = '_indice';
const MAX_BYTES = 400 * 1024;   // una foto ya viene reducida a ~80 KB

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
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

function tipoImagen(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  return 'image/webp';
}

const MAX_FOTOS = 6000;          // tope de fotos guardadas, contando las 2 y 3
const MAX_POR_PRODUCTO = 3;

function claveFoto(item, n) { return n > 1 ? 'f_' + item + '~' + n : 'f_' + item; }

/* Cuántas fotos tiene un producto según el índice. */
function cuantas(idx, item) {
  if (idx.items.indexOf(item) < 0) return 0;
  const m = Number(idx.mas && idx.mas[item]) || 0;
  return m > 1 ? Math.min(m, MAX_POR_PRODUCTO) : 1;
}
function totalFotos(idx) {
  let t = idx.items.length;
  for (const k of Object.keys(idx.mas || {})) t += Math.max(0, (Number(idx.mas[k]) || 1) - 1);
  return t;
}
/* Deja el índice diciendo que `item` tiene `n` fotos, y le cambia la
   versión para que nadie se quede con una vieja en caché. */
function ponerCuantas(idx, item, n) {
  idx.mas = idx.mas || {};
  idx.ver = idx.ver || {};
  if (n <= 0) {
    idx.items = idx.items.filter((x) => x !== item);
    delete idx.mas[item];
    delete idx.ver[item];
  } else {
    if (idx.items.indexOf(item) < 0) idx.items.push(item);
    if (n > 1) idx.mas[item] = n; else delete idx.mas[item];
    idx.ver[item] = Date.now().toString(36);
  }
  idx.actualizado = new Date().toISOString();
}

async function leerIndice(store) {
  const idx = await store.get(INDICE, { type: 'json' });
  const ok = idx && Array.isArray(idx.items) ? idx : { items: [], actualizado: null };
  if (!ok.mas || typeof ok.mas !== 'object') ok.mas = {};
  if (!ok.ver || typeof ok.ver !== 'object') ok.ver = {};
  return ok;
}

export default async (req, context) => {
  const store = getStore({ name: STORE, consistency: 'strong' });
  const url = new URL(req.url);
  // /api/fotos/<item>  ó  /.netlify/functions/fotos/<item>
  const partes = url.pathname.split('/').filter(Boolean);
  const iFotos = partes.lastIndexOf('fotos');
  const item = (iFotos >= 0 && partes[iFotos + 1]) ? decodeURIComponent(partes[iFotos + 1]) : '';
  /* /api/fotos/logo/<marca>: el logo de una marca de la franja del catálogo.
     Va aparte de las fotos de producto: no entra en el índice ni cuenta
     para el tope. La versión la lleva la lista de marcas (?v=…). */
  if (item === 'logo') {
    const marca = (iFotos >= 0 && partes[iFotos + 2]) ? decodeURIComponent(partes[iFotos + 2]) : '';
    if (!/^[a-z0-9-]{1,40}$/.test(marca)) return json({ error: 'marca no válida' }, 400);
    const llave = 'l_' + marca;
    try {
      if (req.method === 'GET') {
        const foto = await store.get(llave, { type: 'arrayBuffer' });
        if (!foto) return json({ error: 'sin logo' }, 404);
        return new Response(foto, { status: 200, headers: {
          'content-type': tipoImagen(foto), 'x-content-type-options': 'nosniff',
          'cache-control': 'public, max-age=86400' } });
      }
      if (!autorizado(req)) return json({ error: 'no autorizado' }, 401);
      if (req.method === 'POST' || req.method === 'PUT') {
        const cuerpo = await req.arrayBuffer();
        if (!cuerpo || !cuerpo.byteLength) return json({ error: 'archivo vacío' }, 400);
        if (cuerpo.byteLength > MAX_BYTES) return json({ error: 'el logo pesa demasiado' }, 413);
        if (!esImagen(cuerpo)) return json({ error: 'el archivo no es una imagen (JPG, PNG o WEBP)' }, 415);
        await store.set(llave, cuerpo);
        return json({ ok: true, marca, ver: Date.now().toString(36) });
      }
      if (req.method === 'DELETE') { await store.delete(llave); return json({ ok: true, marca }); }
      return json({ error: 'método no permitido' }, 405);
    } catch (e) { return json({ error: 'error del servidor' }, 500); }
  }

  /* /api/fotos/<item>/<n>: qué foto del producto (1, 2 o 3). */
  const nTxt = (iFotos >= 0 && partes[iFotos + 2]) ? partes[iFotos + 2] : '1';
  const n = /^[1-3]$/.test(nTxt) ? Number(nTxt) : 0;

  try {
    /* ------------------------------- LEER ------------------------------- */
    if (req.method === 'GET') {
      if (!item) {
        const idx = await leerIndice(store);
        return json(idx, 200, { 'cache-control': 'public, max-age=30' });
      }
      if (!itemValido(item) || !n) return json({ error: 'ITEM no válido' }, 400);
      const foto = await store.get(claveFoto(item, n), { type: 'arrayBuffer' });
      if (!foto) return json({ error: 'sin foto' }, 404);
      return new Response(foto, {
        status: 200,
        headers: {
          'content-type': tipoImagen(foto),
          'x-content-type-options': 'nosniff',
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
      if (!n) return json({ error: 'solo caben ' + MAX_POR_PRODUCTO + ' fotos por producto' }, 400);

      const idx = await leerIndice(store);
      const tiene = cuantas(idx, item);
      /* Sin huecos: la foto 3 de un producto que tiene una sola pasa a ser
         la 2. Y un producto sin fotos empieza por la principal. */
      const pos = Math.min(n, tiene + 1);
      if (pos > MAX_POR_PRODUCTO) {
        return json({ error: 'solo caben ' + MAX_POR_PRODUCTO + ' fotos por producto' }, 409);
      }
      if (pos > tiene && totalFotos(idx) >= MAX_FOTOS) {
        return json({ error: 'ya hay demasiadas fotos guardadas' }, 409);
      }

      await store.set(claveFoto(item, pos), cuerpo);
      ponerCuantas(idx, item, Math.max(tiene, pos));
      await store.setJSON(INDICE, idx);
      return json({ ok: true, item, n: pos, fotos: cuantas(idx, item), ver: idx.ver[item],
                    bytes: cuerpo.byteLength, total: idx.items.length });
    }

    /* ------------------------------ BORRAR ------------------------------ */
    if (req.method === 'DELETE') {
      if (!autorizado(req)) return json({ error: 'no autorizado' }, 401);
      if (!item) return json({ error: 'falta el ITEM' }, 400);
      if (!itemValido(item) || !n) return json({ error: 'ITEM no válido' }, 400);
      const idx = await leerIndice(store);
      const tiene = cuantas(idx, item);
      if (n > tiene) {
        /* Nada que borrar ahí. Si el índice no lo tenía pero la foto existe
           (un índice viejo), se borra igual. */
        if (n === 1) await store.delete(claveFoto(item, 1));
        return json({ ok: true, item, fotos: tiene, total: idx.items.length });
      }
      /* Las de detrás se corren un puesto: la 3 pasa a 2, la 2 a principal. */
      for (let k = n; k < tiene; k++) {
        const sig = await store.get(claveFoto(item, k + 1), { type: 'arrayBuffer' });
        if (sig) await store.set(claveFoto(item, k), sig);
      }
      await store.delete(claveFoto(item, tiene));
      ponerCuantas(idx, item, tiene - 1);
      await store.setJSON(INDICE, idx);
      return json({ ok: true, item, fotos: tiene - 1, ver: idx.ver[item] || '',
                    total: idx.items.length });
    }

    return json({ error: 'método no permitido' }, 405);
  } catch (e) {
    return json({ error: 'error del servidor' }, 500);
  }
};

export const config = {
  path: ['/api/fotos', '/api/fotos/*'],
};
