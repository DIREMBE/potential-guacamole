/* ==========================================================================
   Cambios de inventario en línea — Ferretería San José

   PARA QUÉ SIRVE
   El sitio es estático: los archivos .json que están publicados son una foto
   fija del inventario del día que se subieron. Sin esto, cuando Carlos corrige
   un precio en su teléfono ese precio existe SOLO en su teléfono, y para que
   lo vea el cliente hay que descargar el archivo y volver a subir el sitio.

   Con esto, cada cambio suelto (un precio, una promoción, dar de baja) se
   guarda aquí y TODOS lo ven enseguida, sin publicar ni resubir nada. Es la
   misma idea que ya usan las fotos (ver fotos.mjs).

   CÓMO ESTÁ GUARDADO
   Cada producto tocado es un archivito aparte: `p/<item>`. Se hace así a
   propósito. Si todo fuera un solo archivo, dos empleados guardando a la vez
   se pisarían y un precio volvería solo hacia atrás sin que nadie se entere
   — justo el fallo que costó arreglar. Con un archivo por producto, dos
   personas editando cosas distintas nunca chocan, y si editan el MISMO
   producto gana el último, que es lo que uno espera.

   Además se mantiene `_consolidado`: la suma de todos, para que el cliente
   se lo baje de un solo viaje en vez de cientos. Se repara solo (ver abajo).

   RUTAS (ver la config del final)
     GET    /api/inventario   -> { ok, disponible, actualizado, count, cambios }
     POST   /api/inventario   -> { clave, cambios:[{item, precio, ...}] }
     DELETE /api/inventario   -> { clave, hasta? }  borra lo ya publicado

   La variable de Netlify es la misma de siempre: FSJ_USUARIOS.
   ========================================================================== */
import { getStore } from '@netlify/blobs';

const STORE = 'fsj-inventario';
const CONSOLIDADO = '_consolidado';
const PREFIJO = 'p/';

/* Topes. No son burocracia: si esto crece sin freno, el cliente termina
   bajándose el catálogo entero otra vez por la puerta de atrás. Pasado el
   tope, el sistema pide publicar, que es lo que toca hacer. */
const MAX_POR_ENVIO = 400;
const MAX_GUARDADOS = 4000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/* ------------------------------- La clave -------------------------------
   La misma con la que el empleado entra al área interna. Se lee de
   FSJ_USUARIOS, que vive en Netlify y no en ningún archivo del sitio.      */
function clavesValidas() {
  return String(process.env.FSJ_USUARIOS || '')
    .split(',')
    .map((e) => String(e.split(':')[1] || '').trim())
    .filter(Boolean)
    .concat(
      String(process.env.FSJ_CLAVE || '').split(',').map((c) => c.trim()).filter(Boolean)
    );
}

/* Comparación que no delata la clave por el tiempo que tarda. */
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
  for (const v of validas) if (iguales(v, c)) vale = true;   // sin cortar: tiempo constante
  return vale;
}

/* Quién guardó el cambio, para el registro. No se le enseña al cliente. */
function quienEs(clave) {
  const c = String(clave || '').trim();
  for (const entrada of String(process.env.FSJ_USUARIOS || '').split(',')) {
    const p = entrada.split(':');
    if (p[1] && iguales(String(p[1]).trim(), c)) return String(p[0] || '').trim();
  }
  return '';
}

/* --------------------------- Qué se deja guardar -------------------------
   Lista blanca. Lo que no esté aquí se descarta sin más: así, si algún día
   alguien logra mandar cosas raras a esta dirección, no puede inventarse
   campos nuevos dentro del inventario.

   `costo` NO está y no debe estar. Es lo que pagamos nosotros; el sitio es
   público y esto se sirve sin clave.                                        */
/* `etiquetaEn`/`etiquetaPrecio`: cuándo se imprimió la etiqueta y con qué
   precio. Se comparten para no reimprimir en un equipo lo que ya se imprimió
   en otro. No son datos del cliente: la parte pública no los sirve. */
const NUMEROS = ['precio', 'promoAntes', 'existencia', 'etiquetaEn', 'etiquetaPrecio'];
const TEXTOS = ['promoHasta', 'codigo', 'bajaMotivo', 'nombre', 'categoria', 'unidad', 'marca'];
const SINO = ['activo', 'activoManual', 'destacado', 'alta'];

function limpiarCambio(c) {
  if (!c || typeof c !== 'object') return null;
  const item = String(c.item == null ? '' : c.item).trim();
  if (!item || item.length > 40) return null;

  const out = { item };
  for (const k of NUMEROS) {
    if (c[k] === undefined) continue;
    const n = Number(c[k]);
    if (!isFinite(n) || n < 0) continue;
    /* `etiquetaEn` es una fecha en milisegundos: 1,7 billones. El tope de los
       precios y existencias (10 millones) la tiraría en silencio, así que
       lleva el suyo y se guarda entera, sin decimales. */
    if (k === 'etiquetaEn') {
      if (n > 4e12) continue;                 // más allá del año 2096: basura
      out[k] = Math.round(n);
      continue;
    }
    if (n > 1e7) continue;
    out[k] = Math.round(n * 100) / 100;
  }
  for (const k of TEXTOS) {
    if (c[k] === undefined) continue;
    out[k] = String(c[k]).slice(0, 160);
  }
  for (const k of SINO) {
    if (c[k] === undefined) continue;
    out[k] = !!c[k];
  }
  // Solo `item` no es un cambio: hay que tocar algo.
  return Object.keys(out).length > 1 ? out : null;
}

/* ------------------------- El archivo consolidado ------------------------
   Se guarda junto a los etags que tenía cada producto cuando se armó. En
   cada lectura se compara con la lista real: si algo no cuadra —porque dos
   guardados se cruzaron, o porque alguien borró algo a mano— se rehace solo
   con los que cambiaron. Así el consolidado nunca puede quedar mintiendo:
   la verdad son siempre los archivitos por producto.                        */
async function leerConsolidado(store) {
  try {
    const d = await store.get(CONSOLIDADO, { type: 'json' });
    if (d && d.cambios) {
      return {
        actualizado: d.actualizado || '',
        etags: d.etags || {},
        claves: d.claves || {},          // archivo -> ITEM que contiene
        cambios: d.cambios,
      };
    }
  } catch (e) { /* todavía no existe */ }
  return { actualizado: '', etags: {}, claves: {}, cambios: {} };
}

async function consolidar(store) {
  const cons = await leerConsolidado(store);

  let listado;
  try {
    listado = await store.list({ prefix: PREFIJO });
  } catch (e) {
    return cons;                       // sin listado, se sirve lo que haya
  }
  const blobs = (listado && listado.blobs) || [];

  const reales = {};
  for (const b of blobs) reales[b.key] = b.etag || '';

  const faltan = Object.keys(reales).filter((k) => cons.etags[k] !== reales[k]);
  const sobran = Object.keys(cons.etags).filter((k) => !(k in reales));

  /* Aunque no haya nada que traer ni que quitar, se comprueba que el
     consolidado no tenga productos de más: podría traerlos si el archivo se
     estropeó o alguien lo tocó a mano. Los archivitos por producto mandan. */
  const sobrantes = Object.keys(cons.cambios).filter(
    (item) => !Object.keys(reales).some((k) => cons.claves[k] === item)
  );

  if (!faltan.length && !sobran.length && !sobrantes.length) return cons;   // caso normal

  for (const k of sobran) {
    delete cons.cambios[cons.claves[k]];
    delete cons.claves[k];
    delete cons.etags[k];
  }
  for (const k of faltan) {
    try {
      const v = await store.get(k, { type: 'json' });
      if (v && v.item) {
        cons.cambios[String(v.item)] = v;
        cons.claves[k] = String(v.item);
        cons.etags[k] = reales[k];
      }
    } catch (e) { /* se reintenta en la siguiente lectura */ }
  }
  // lo que quedó sin archivo detrás, fuera
  for (const item of Object.keys(cons.cambios)) {
    if (!Object.keys(cons.claves).some((k) => cons.claves[k] === item && k in reales)) {
      delete cons.cambios[item];
    }
  }
  cons.actualizado = new Date().toISOString();
  try { await store.setJSON(CONSOLIDADO, cons); } catch (e) {}
  return cons;
}

/* El nombre del empleado es cosa de la casa, no del cliente. */
function sinAutor(cambios) {
  const out = {};
  for (const k of Object.keys(cambios)) {
    const c = Object.assign({}, cambios[k]);
    delete c.por;
    out[k] = c;
  }
  return out;
}

export default async (req) => {
  let store;
  try {
    store = getStore(STORE);
  } catch (e) {
    // Sin Blobs configurados, el sitio sigue funcionando a la antigua.
    return json({ ok: false, disponible: false, error: 'blobs no disponible' }, 503);
  }

  /* ------------------------------ LEER ---------------------------------
     Abierta, como el catálogo: son los mismos precios que ya se enseñan en
     la página. No sale ni el costo ni quién hizo el cambio.                */
  if (req.method === 'GET') {
    const cons = await consolidar(store);
    const autorizado = claveOk(req.headers.get('x-fsj-clave'));
    return json({
      ok: true,
      disponible: true,
      actualizado: cons.actualizado || '',
      count: Object.keys(cons.cambios).length,
      tope: MAX_GUARDADOS,
      cambios: autorizado ? cons.cambios : sinAutor(cons.cambios),
    });
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
    await new Promise((r) => setTimeout(r, 400));   // encarece probar a ciegas
    return json({ ok: false, error: 'clave incorrecta' }, 401);
  }

  /* ----------------------------- GUARDAR -------------------------------- */
  if (req.method === 'POST') {
    const lista = Array.isArray(datos && datos.cambios) ? datos.cambios : [];
    if (!lista.length) return json({ ok: false, error: 'nada que guardar' }, 400);
    if (lista.length > MAX_POR_ENVIO) {
      return json({ ok: false, error: 'demasiados de una vez', maximo: MAX_POR_ENVIO }, 413);
    }

    const cons = await leerConsolidado(store);
    const yaHay = Object.keys(cons.cambios).length;
    const nuevos = lista.filter((c) => c && !(String(c.item) in cons.cambios)).length;
    if (yaHay + nuevos > MAX_GUARDADOS) {
      return json({
        ok: false, error: 'lleno', guardados: yaHay, tope: MAX_GUARDADOS,
        pista: 'Hay demasiados cambios sin publicar. Publica el inventario al sitio y se vacía solo.',
      }, 409);
    }

    const por = quienEs(clave);
    const ahora = new Date().toISOString();
    let guardados = 0;
    const fallaron = [];

    for (const bruto of lista) {
      const c = limpiarCambio(bruto);
      if (!c) continue;
      const llave = PREFIJO + encodeURIComponent(c.item);

      /* Se JUNTA con lo que ya hubiera de ese producto, no se reemplaza.
         Un cambio es "estos campos pasan a valer esto", no "el producto
         entero queda así". Sin esto, mandar solo el precio borraba la
         promoción que se acababa de poner. Para quitar algo se manda el
         valor vacío a propósito (promoAntes: 0), no omitiéndolo. */
      let previo = null;
      try { previo = await store.get(llave, { type: 'json' }); } catch (e) {}
      const final = Object.assign({}, previo || {}, c, { por, fecha: ahora });

      try {
        await store.setJSON(llave, final);
        guardados++;
      } catch (e) {
        fallaron.push(c.item);
      }
    }

    /* Se rehace el consolidado leyendo la lista de verdad. Si dos empleados
       guardaron a la vez, aquí se junta todo: ninguno pierde su cambio. */
    const final = await consolidar(store);
    return json({
      ok: true, guardados, fallaron,
      actualizado: final.actualizado,
      total: Object.keys(final.cambios).length,
    });
  }

  /* ------------------------------ VACIAR --------------------------------
     Después de publicar el inventario al sitio, los cambios que ya van
     dentro del archivo nuevo sobran aquí. Se borran los anteriores a la
     fecha de publicación; los que llegaron mientras tanto se quedan.       */
  const hasta = String((datos && datos.hasta) || '').trim();
  let listado;
  try { listado = await store.list({ prefix: PREFIJO }); } catch (e) { listado = { blobs: [] }; }

  let borrados = 0, quedan = 0;
  for (const b of (listado.blobs || [])) {
    let v = null;
    try { v = await store.get(b.key, { type: 'json' }); } catch (e) {}
    if (hasta && v && v.fecha && String(v.fecha) > hasta) { quedan++; continue; }
    try { await store.delete(b.key); borrados++; } catch (e) {}
  }
  try { await store.delete(CONSOLIDADO); } catch (e) {}
  const final = await consolidar(store);
  return json({ ok: true, borrados, quedan, total: Object.keys(final.cambios).length });
};

export const config = {
  path: '/api/inventario',
};
