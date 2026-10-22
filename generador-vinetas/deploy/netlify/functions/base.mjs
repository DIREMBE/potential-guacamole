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

   VERSIONES ANTERIORES (para poder volver atrás)
   Antes, al guardar una base nueva se tiraba la anterior. Si la nueva venía
   mal —un Excel que cruzó nombres entre productos—, no había a dónde volver.
   Ahora se guardan las últimas GUARDAR_VERSIONES, y gerencia puede ver
   cualquiera de ellas o devolver el sitio a una.

   RUTAS
     GET  /api/base            -> qué hay guardado (fechas y tamaños)
     GET  /api/base?parte=2&v=<subida>        -> un trozo del catálogo (público)
     GET  /api/base?parte=2&v=<subida>&full=1 -> un trozo de la base del panel (con clave)
     GET  /api/base?versiones=1   -> las versiones guardadas (con clave)
     POST /api/base            -> { clave, subida, parte, total, productos[] }
     POST /api/base            -> { clave, subida, cerrar:true }   (promueve)
     POST /api/base            -> { clave, restaurar:<subida> }   (vuelve a una
                                  versión anterior; solo rol admin)
     DELETE /api/base          -> { clave }   borra lo guardado (solo rol admin)

   OJO CON LA CACHÉ. Los trozos se piden con `v=<subida>`: así cada versión
   tiene su propia dirección y se puede guardar en caché para siempre. Antes
   la dirección era la misma para todas las versiones (?parte=2) y se
   guardaba 24 horas: después de guardar una base nueva, la red de Netlify y
   el navegador podían seguir dando trozos de la anterior, mezclados con
   trozos de la nueva. Y la base del panel (full=1) ya no se guarda en la red
   de Netlify: pide clave, y la red no mira la clave para decidir a quién se
   la da.

   La variable de Netlify es la misma de siempre: FSJ_USUARIOS.
   ========================================================================== */
import { getStore } from '@netlify/blobs';

const STORE = 'fsj-base';
const META = 'meta';                 // lo que está publicado ahora mismo
const MAX_PRODUCTOS_PARTE = 2500;    // ~600 KB por trozo
const MAX_PARTES = 24;               // tope de cordura: ~60.000 productos
const GUARDAR_VERSIONES = 8;         // bases anteriores que se conservan

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

/* El rol de quien manda la clave (admin o empleado). Volver a una base
   anterior o borrarla es cosa de gerencia. */
function rolDe(clave) {
  const c = String(clave || '').trim();
  for (const entrada of String(process.env.FSJ_USUARIOS || '').split(',')) {
    const p = entrada.split(':');
    if (p[1] && iguales(String(p[1]).trim(), c)) return String(p[2] || 'empleado').trim().toLowerCase();
  }
  return '';
}

/* Lo que se apunta de cada versión en la lista. */
function resumen(m) {
  return {
    subida: m.subida, generatedAt: m.generatedAt || '', guardadaEn: m.guardadaEn || '',
    por: m.por || '', count: m.count || 0, countCatalogo: m.countCatalogo || 0,
    partes: m.partes || 0, restaurada: m.restaurada || '',
  };
}

async function borrarVersion(store, h) {
  for (let i = 0; i < (h.partes || MAX_PARTES); i++) {
    try { await store.delete('v/' + h.subida + '/p/' + i); } catch (e) {}
    try { await store.delete('v/' + h.subida + '/c/' + i); } catch (e) {}
  }
  try { await store.delete('v/' + h.subida + '/sello'); } catch (e) {}
}

async function partesCompletas(store, subida, partes) {
  for (let i = 0; i < partes; i++) {
    let t = null;
    try { t = await store.get('v/' + subida + '/p/' + i, { type: 'json' }); } catch (e) {}
    if (!t) return i;
  }
  return -1;
}

/* ------------------------- Qué se deja guardar --------------------------
   Lista blanca, igual que en los cambios sueltos. El COSTO DE COMPRA no
   está y no debe estar: la parte del catálogo se sirve sin clave.          */
const NUMEROS = ['precio', 'promoAntes', 'existencia', 'tocadoEn', 'etiquetaEn', 'etiquetaPrecio'];
const TEXTOS = ['nombre', 'categoria', 'unidad', 'codigo', 'marca', 'promoHasta',
                'bajaMotivo', 'especificaciones', 'presentaciones', 'fichaFijada',
                /* nombreReporte: el nombre que trae FelTec cuando el nuestro
                   se corrigió a mano; con él se nota si FelTec le da el mismo
                   ITEM a otro producto. origen: 'panel' si se creó aquí. */
                'nombreReporte', 'origen'];
/* `presentaciones` lleva dentro las formas en que se vende el producto
   —«varilla», «quintal de 14»—; recortarla a 200 la dejaria rota a medias. */
const LARGO_TEXTO = { presentaciones: 600 };
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
  for (const k of TEXTOS) if (p[k] != null) o[k] = String(p[k]).slice(0, LARGO_TEXTO[k] || 200);
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
  /* Lo que el empleado escribio para que lo vea el cliente: de que es el
     producto y de que formas se vende. El costo de compra sigue sin ir. */
  if (p.especificaciones) o.especificaciones = p.especificaciones;
  if (p.presentaciones) o.presentaciones = p.presentaciones;
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
    const v = String(url.searchParams.get('v') || '').trim();

    /* Las versiones guardadas, para la pantalla de reparar. Con clave. */
    if (url.searchParams.get('versiones') === '1') {
      if (!claveOk(req.headers.get('x-fsj-clave'))) {
        return json({ ok: false, error: 'las versiones necesitan clave' }, 401);
      }
      return json({ ok: true, actual: meta ? resumen(meta) : null,
                    historial: (meta && meta.historial) || [] }, 200, 'private, no-store');
    }

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
    /* Qué versión: la que se pide con `v`, si todavía está guardada; si no
       se dice, la de ahora (los equipos con el código de antes). */
    let subida = meta.subida;
    if (v) {
      const existe = v === meta.subida || (meta.historial || []).some((h) => h.subida === v);
      if (!existe) return json({ ok: false, error: 'esa versión ya no está', actual: meta.subida }, 404);
      subida = v;
    }
    const llave = (full ? 'v/' + subida + '/p/' : 'v/' + subida + '/c/') + n;
    let trozo = null;
    try { trozo = await store.get(llave, { type: 'json' }); } catch (e) {}
    if (!trozo) return json({ ok: false, error: 'esa parte no está' }, 404);

    /* Con `v` la dirección es de esa versión y nunca cambia de contenido: se
       puede guardar para siempre. Sin `v` es «la de ahora», que cambia en
       cuanto alguien guarda: solo un minuto. La del panel, nunca en la red. */
    const cache = full ? 'private, no-store'
                : v ? 'public, max-age=31536000, immutable'
                : 'public, max-age=60';
    return json({ ok: true, parte: n, subida, productos: trozo.productos || [] }, 200, cache);
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
    if (rolDe(clave) !== 'admin') {
      return json({ ok: false, error: 'solo gerencia puede borrar la base guardada' }, 403);
    }
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

  /* ---------------------- VOLVER A UNA VERSIÓN ANTERIOR -----------------
     La versión elegida pasa a ser la de ahora, con fecha de hoy (si no, los
     equipos que ya tienen una más nueva no la bajarían), y la de ahora pasa
     a la lista: tampoco se pierde. Solo gerencia. */
  if (datos && datos.restaurar) {
    if (rolDe(clave) !== 'admin') {
      return json({ ok: false, error: 'solo gerencia puede volver a una base anterior' }, 403);
    }
    const actual = await leerMeta(store);
    const elegida = actual && (actual.historial || []).find((h) => h.subida === String(datos.restaurar));
    if (!elegida) return json({ ok: false, error: 'esa versión ya no está guardada' }, 404);
    const falta = await partesCompletas(store, elegida.subida, elegida.partes || 0);
    if (falta >= 0) return json({ ok: false, error: 'a esa versión le falta la parte ' + falta }, 409);

    const historial = [resumen(actual)].concat(actual.historial || [])
      .filter((h) => h.subida !== elegida.subida).slice(0, GUARDAR_VERSIONES);
    const meta = Object.assign(resumen(elegida), {
      generatedAt: new Date().toISOString(),
      guardadaEn: new Date().toISOString(),
      por: quienEs(clave),
      restaurada: elegida.generatedAt || elegida.guardadaEn || '',
      partesCatalogo: elegida.partes || 0,
      historial,
    });
    await store.setJSON(META, meta);
    return json({ ok: true, meta: resumen(meta), historial });
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
    const falta = await partesCompletas(store, subida, partes);
    if (falta >= 0) return json({ ok: false, error: 'falta la parte ' + falta + ' de la base' }, 409);

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

    /* La de antes NO se tira: pasa a la lista de versiones, por si la nueva
       viene mal y hay que volver. Solo se tiran las que se pasan del tope. */
    const anterior = await leerMeta(store);
    let historial = anterior && anterior.subida && anterior.subida !== subida
      ? [resumen(anterior)].concat(anterior.historial || []) : ((anterior && anterior.historial) || []);
    historial = historial.filter((h) => h && h.subida && h.subida !== subida);
    const sobran = historial.slice(GUARDAR_VERSIONES);
    historial = historial.slice(0, GUARDAR_VERSIONES);
    meta.historial = historial;

    /* Se cambia el meta AL FINAL: hasta este momento quien lea sigue viendo
       la base anterior, entera. */
    await store.setJSON(META, meta);

    let limpiados = 0;
    for (const h of sobran) { await borrarVersion(store, h); limpiados++; }
    /* Y las que se quedaron a medias hace tiempo (nunca una de la lista). */
    const huerfanas = await barrerHuerfanas(store, [subida].concat(historial.map((h) => h.subida)));
    return json({ ok: true, meta: resumen(meta), historial, limpiados, huerfanas: huerfanas.barridas });
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
