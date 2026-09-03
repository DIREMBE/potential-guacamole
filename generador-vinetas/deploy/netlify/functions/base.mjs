/* ==========================================================================
   La base del inventario, guardada en el sitio — Ferretería San José

   POR QUÉ EXISTE
   Los cambios sueltos (un precio, una oferta) ya se comparten solos por
   /api/inventario. Lo que seguía atando a los archivos era la carga del Excel
   mensual: toca miles de productos, no cabe como "cambios sueltos", y obligaba
   a descargar dos .json y volver a subir el sitio entero.

   Aquí se guarda la BASE COMPLETA. Al aplicar el Excel, el panel la manda, y
   cualquier equipo —y el catálogo del cliente— la recoge sin que nadie publique
   nada. Los archivos .json publicados se quedan como respaldo: si esto no
   estuviera disponible, el sitio sigue funcionando con ellos.

   POR PARTES, A PROPÓSITO
   Son 11.267 productos, unos 3 MB. Mandar eso de un golpe se pasa del tamaño
   que aceptan las funciones, así que va en trozos de 2.000. Los trozos se
   guardan aparte y solo al final se cambia el "meta": mientras se está
   subiendo, quien lea sigue viendo la base anterior, completa. Nunca se sirve
   una base a medias.

   RUTAS
     GET  /api/base            -> qué hay guardado (fechas y tamaños)
     GET  /api/base?parte=2    -> un trozo del catálogo (público)
     GET  /api/base?parte=2&full=1  -> un trozo de la base del panel (con clave)
     POST /api/base            -> { clave, subida, parte, total, productos[] }
     POST /api/base            -> { clave, subida, cerrar:true }   (promueve)
     DELETE /api/base          -> { clave }   borra lo guardado

   La variable de Netlify es la misma de siempre: FSJ_USUARIOS.
   ========================================================================== */
import { getStore } from '@netlify/blobs';

const STORE = 'fsj-base';
const META = 'meta';                 // lo que está publicado ahora mismo
const MAX_PRODUCTOS_PARTE = 2500;    // ~600 KB por trozo
const MAX_PARTES = 24;               // tope de cordura: ~60.000 productos

function json(body, status = 200, cache) {
  const h = {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': cache || 'no-store',
  };
  /* Netlify guarda en su red la respuesta de la función si se le pide con esta
     cabecera. Sin ella, cada cliente que abre el catálogo despierta la función
     y se baja los trozos otra vez; con ella, casi todos los reciben del borde,
     igual de rápido que un archivo suelto. */
  if (cache) h['netlify-cdn-cache-control'] = cache;
  return new Response(JSON.stringify(body), { status, headers: h });
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

/* ------------------------- Qué se deja guardar --------------------------
   Lista blanca, igual que en los cambios sueltos. El COSTO DE COMPRA no
   está y no debe estar: la parte del catálogo se sirve sin clave.          */
const NUMEROS = ['precio', 'promoAntes', 'existencia', 'tocadoEn', 'etiquetaEn', 'etiquetaPrecio'];
const TEXTOS = ['nombre', 'categoria', 'unidad', 'codigo', 'marca', 'promoHasta', 'bajaMotivo'];
const SINO = ['activo', 'destacado', 'activoManual'];

function limpiar(p) {
  if (!p || typeof p !== 'object') return null;
  const item = String(p.item == null ? '' : p.item).trim();
  if (!item || item.length > 40) return null;
  const o = { item };
  for (const k of NUMEROS) {
    const n = Number(p[k]);
    if (isFinite(n) && n >= 0 && n < 1e13) o[k] = (k === 'tocadoEn' || k === 'etiquetaEn') ? Math.round(n) : Math.round(n * 100) / 100;
  }
  for (const k of TEXTOS) if (p[k] != null) o[k] = String(p[k]).slice(0, 200);
  for (const k of SINO) if (p[k] !== undefined) o[k] = !!p[k];
  return o;
}

/* Lo que ve el cliente: solo lo activo y solo lo que se enseña. */
function paraCatalogo(p) {
  if (p.activo === false) return null;
  const o = {
    item: p.item, nombre: p.nombre || '', categoria: p.categoria || '',
    unidad: p.unidad || '', existencia: p.existencia || 0, precio: p.precio || 0,
    codigo: p.codigo || '',
  };
  if (p.marca) o.marca = p.marca;
  if (p.destacado) o.destacado = true;
  if (p.promoAntes > 0) { o.promoAntes = p.promoAntes; o.promoHasta = p.promoHasta || ''; }
  return o;
}

async function leerMeta(store) {
  try {
    const m = await store.get(META, { type: 'json' });
    if (m && m.subida) return m;
  } catch (e) {}
  return null;
}

/* Qué subidas hay guardadas, por lo que se ve en el almacén. */
async function subidasGuardadas(store) {
  const vistas = new Map();     // subida -> [llaves]
  try {
    const { blobs } = await store.list({ prefix: 'v/' });
    for (const b of (blobs || [])) {
      const s = String(b.key).split('/')[1];
      if (!s) continue;
      if (!vistas.has(s)) vistas.set(s, []);
      vistas.get(s).push(b.key);
    }
  } catch (e) {}
  return vistas;
}

/* Una subida que se cortó a la mitad (se fue el internet, se cerró el
   navegador) deja sus trozos y nadie los vuelve a mirar: nunca se llamó a
   `cerrar`. Se barren al publicar la siguiente, pero solo si son viejos, no
   sea que alguien esté subiendo justo ahora desde otro equipo.            */
const HUERFANA_TRAS = 6 * 60 * 60 * 1000;   // 6 horas

async function barrerHuerfanas(store, salvar) {
  const vistas = await subidasGuardadas(store);
  const ahora = Date.now();
  let barridas = 0, llaves = 0;
  for (const [s, ks] of vistas) {
    if (salvar.indexOf(s) >= 0) continue;
    let inicio = 0;
    try {
      const m = await store.get('v/' + s + '/sello', { type: 'json' });
      inicio = (m && Number(m.en)) || 0;
    } catch (e) {}
    /* Sin marca de inicio es de una versión anterior de esto: se puede tirar. */
    if (inicio && ahora - inicio < HUERFANA_TRAS) continue;
    for (const k of ks) { try { await store.delete(k); llaves++; } catch (e) {} }
    barridas++;
  }
  return { barridas, llaves };
}

export default async (req) => {
  let store;
  try { store = getStore(STORE); }
  catch (e) { return json({ ok: false, disponible: false, error: 'blobs no disponible' }, 503); }

  const url = new URL(req.url);

  /* ------------------------------- LEER -------------------------------- */
  if (req.method === 'GET') {
    const meta = await leerMeta(store);
    const parte = url.searchParams.get('parte');
    const full = url.searchParams.get('full') === '1';

    if (parte === null) {
      /* El "meta" cambia cada vez que se sube una base nueva, así que se
         guarda poco tiempo: es lo que le dice al cliente si hay algo nuevo. */
      return json({
        ok: true, disponible: true,
        hay: !!meta,
        generatedAt: meta ? meta.generatedAt : '',
        subida: meta ? meta.subida : '',
        por: meta ? meta.por : '',
        count: meta ? meta.count : 0,
        partes: meta ? meta.partes : 0,
        countCatalogo: meta ? meta.countCatalogo : 0,
        partesCatalogo: meta ? meta.partesCatalogo : 0,
      }, 200, 'public, max-age=60, stale-while-revalidate=600');
    }

    if (!meta) return json({ ok: false, error: 'no hay base guardada' }, 404);
    const n = parseInt(parte, 10);
    if (!isFinite(n) || n < 0 || n >= MAX_PARTES) return json({ ok: false, error: 'parte no válida' }, 400);

    if (full && !claveOk(req.headers.get('x-fsj-clave'))) {
      return json({ ok: false, error: 'la base del panel necesita clave' }, 401);
    }
    const llave = (full ? 'v/' + meta.subida + '/p/' : 'v/' + meta.subida + '/c/') + n;
    let trozo = null;
    try { trozo = await store.get(llave, { type: 'json' }); } catch (e) {}
    if (!trozo) return json({ ok: false, error: 'esa parte no está' }, 404);

    /* Los trozos llevan la fecha de subida dentro de su nombre, así que nunca
       cambian de contenido: se pueden guardar mucho tiempo sin miedo. */
    return json({ ok: true, parte: n, productos: trozo.productos || [] },
      200, 'public, max-age=86400, immutable');
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return json({ ok: false, error: 'método no permitido' }, 405);
  }

  let datos = null;
  try { datos = await req.json(); } catch (e) { datos = null; }
  const clave = (datos && datos.clave) || req.headers.get('x-fsj-clave') || '';

  if (!clavesValidas().length) {
    return json({ ok: false, error: 'sin claves configuradas', pista:
      'Falta la variable FSJ_USUARIOS en Netlify (Site configuration → Environment variables).' }, 503);
  }
  if (!claveOk(clave)) {
    await new Promise((r) => setTimeout(r, 400));
    return json({ ok: false, error: 'clave incorrecta' }, 401);
  }

  /* ------------------------------ BORRAR ------------------------------- */
  if (req.method === 'DELETE') {
    const meta = await leerMeta(store);
    try { await store.delete(META); } catch (e) {}
    /* Se van también los trozos: si no, quedan 3 MB ocupando sitio sin que
       nadie pueda llegar a ellos. */
    let llaves = 0;
    const vistas = await subidasGuardadas(store);
    for (const ks of vistas.values()) {
      for (const k of ks) { try { await store.delete(k); llaves++; } catch (e) {} }
    }
    return json({ ok: true, borrada: meta ? meta.subida : null, llaves });
  }

  /* ------------------------------ GUARDAR ------------------------------
     Cada trozo se guarda bajo la marca de tiempo de ESTA subida. Mientras no
     se llame a `cerrar`, el meta sigue apuntando a la base anterior, así que
     quien lea durante la subida ve la de antes, entera. */
  const subida = String((datos && datos.subida) || '').trim();
  if (!/^[0-9a-zA-Z_-]{6,40}$/.test(subida)) {
    return json({ ok: false, error: 'falta la marca de la subida' }, 400);
  }

  if (datos && datos.cerrar) {
    const partes = Math.max(0, Math.min(MAX_PARTES, parseInt(datos.partes, 10) || 0));
    if (!partes) return json({ ok: false, error: 'no se subió ninguna parte' }, 400);

    /* Antes de cambiar el meta se comprueba que estén TODAS las partes. Si
       falta una, la base quedaría coja y sería peor que no tenerla. */
    for (let i = 0; i < partes; i++) {
      let t = null;
      try { t = await store.get('v/' + subida + '/p/' + i, { type: 'json' }); } catch (e) {}
      if (!t) return json({ ok: false, error: 'falta la parte ' + i + ' de la base' }, 409);
    }

    const meta = {
      subida,
      generatedAt: String((datos && datos.generatedAt) || new Date().toISOString()),
      guardadaEn: new Date().toISOString(),
      por: quienEs(clave),
      count: Math.max(0, parseInt(datos.count, 10) || 0),
      countCatalogo: Math.max(0, parseInt(datos.countCatalogo, 10) || 0),
      partes,
      /* Los trozos del catálogo llevan los mismos índices que los del panel,
         así que se recorren con la misma cuenta. */
      partesCatalogo: partes,
    };

    /* Se cambia el meta AL FINAL: hasta este momento quien lea sigue viendo
       la base anterior, entera. */
    const anterior = await leerMeta(store);
    await store.setJSON(META, meta);

    /* Y se tira la versión de antes. Si no, cada carga mensual deja 12 trozos
       de 600 KB para siempre. Se hace DESPUÉS de publicar la nueva: si algo
       falla aquí, lo peor es gastar espacio, no quedarse sin base. */
    let limpiados = 0;
    if (anterior && anterior.subida && anterior.subida !== subida) {
      for (let i = 0; i < (anterior.partes || 0); i++) {
        try { await store.delete('v/' + anterior.subida + '/p/' + i); limpiados++; } catch (e) {}
        try { await store.delete('v/' + anterior.subida + '/c/' + i); } catch (e) {}
      }
      try { await store.delete('v/' + anterior.subida + '/sello'); } catch (e) {}
    }
    /* Y las que se quedaron a medias hace tiempo. */
    const huerfanas = await barrerHuerfanas(store, [subida]);
    return json({ ok: true, meta, limpiados, huerfanas: huerfanas.barridas });
  }

  const parte = parseInt(datos && datos.parte, 10);
  const productos = Array.isArray(datos && datos.productos) ? datos.productos : null;
  if (!isFinite(parte) || parte < 0 || parte >= MAX_PARTES) {
    return json({ ok: false, error: 'parte no válida' }, 400);
  }
  if (!productos) return json({ ok: false, error: 'no vienen productos' }, 400);
  if (productos.length > MAX_PRODUCTOS_PARTE) {
    return json({ ok: false, error: 'trozo demasiado grande', maximo: MAX_PRODUCTOS_PARTE }, 413);
  }

  const limpios = productos.map(limpiar).filter(Boolean);
  const delCatalogo = limpios.map(paraCatalogo).filter(Boolean);

  try {
    /* La última vez que se tocó esta subida. Si se corta y nunca se cierra,
       esto es lo que permite reconocer sus trozos como basura vieja y
       barrerlos —y, mientras se está subiendo, no confundirla con basura. */
    await store.setJSON('v/' + subida + '/sello', { en: Date.now() });
    await store.setJSON('v/' + subida + '/p/' + parte, { productos: limpios });
    await store.setJSON('v/' + subida + '/c/' + parte, { productos: delCatalogo });
  } catch (e) {
    return json({ ok: false, error: 'no se pudo guardar la parte' }, 500);
  }
  return json({ ok: true, parte, guardados: limpios.length, delCatalogo: delCatalogo.length });
};

export const config = {
  path: '/api/base',
};
