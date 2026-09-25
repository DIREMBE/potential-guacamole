/* ==========================================================================
   Visitas del catálogo — Ferretería San José

   PARA QUÉ
   El carrusel de la portada enseña los productos que más se miran en el
   catálogo. Cada vez que un cliente abre la ficha de un producto, el
   catálogo avisa aquí; la portada pide los más vistos de los últimos 30 días.

   QUÉ SE GUARDA
   Solo el ITEM y cuántas veces se abrió, por día. Nada de quién, ni desde
   dónde: no hace falta para esto.

   RUTAS
     POST /api/visitas          { item }   -> cuenta una visita (sin clave)
     GET  /api/visitas?top=15              -> los más vistos, con lo que la
                                              portada necesita para pintarlos

   LA CUENTA ES APROXIMADA, a propósito: dos visitas en el mismo instante
   pueden contarse como una. Para ordenar un carrusel sobra, y así no hace
   falta nada más complicado.

   Lo que se devuelve sale de la base publicada del catálogo (la que ya ve el
   cliente) con los últimos cambios encima: nombre, precio, foto. El COSTO no
   está en ninguna de las dos, así que tampoco puede salir de aquí. Solo entra
   lo que se puede vender: dado de baja o sin precio, no.
   ========================================================================== */
import { getStore } from '@netlify/blobs';

const STORE = 'fsj-visitas';
const DIAS = 30;                    // la ventana que cuenta para "lo más visto"
const MAX_TOP = 30;
const MAX_PRODUCTOS_DIA = 8000;     // tope de cordura por día
const REFRESCO_MS = 15 * 60 * 1000; // el ranking se rehace, como mucho, cada 15 minutos

function json(body, status = 200, cache) {
  const h = {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': cache || 'no-store',
  };
  if (cache) h['netlify-cdn-cache-control'] = cache;
  return new Response(JSON.stringify(body), { status, headers: h });
}

function itemValido(item) {
  return /^[A-Za-z0-9._-]{1,40}$/.test(item);
}

/* El día en El Salvador (UTC-6, sin horario de verano). */
function dia(ms) {
  return new Date(ms - 6 * 3600 * 1000).toISOString().slice(0, 10);
}

async function contar(store, item) {
  const k = 'd/' + dia(Date.now());
  let d = null;
  try { d = await store.get(k, { type: 'json' }); } catch (e) {}
  if (!d || typeof d.c !== 'object') d = { c: {} };
  if (!(item in d.c) && Object.keys(d.c).length >= MAX_PRODUCTOS_DIA) return false;
  d.c[item] = (Number(d.c[item]) || 0) + 1;
  await store.setJSON(k, d);
  return true;
}

/* Suma los últimos DIAS días. */
async function sumar(store) {
  const total = {};
  const hoy = Date.now();
  for (let i = 0; i < DIAS; i++) {
    let d = null;
    try { d = await store.get('d/' + dia(hoy - i * 86400000), { type: 'json' }); } catch (e) {}
    if (!d || !d.c) continue;
    for (const it of Object.keys(d.c)) total[it] = (total[it] || 0) + (Number(d.c[it]) || 0);
  }
  return total;
}

/* Lo que el cliente ve de cada producto: la base publicada del catálogo más
   los cambios sueltos que llegaron después. */
async function fichasPublicas(items) {
  const quiero = new Set(items);
  const out = {};
  try {
    const base = getStore('fsj-base');
    const meta = await base.get('meta', { type: 'json' });
    if (meta && meta.subida) {
      const partes = Number(meta.partesCatalogo) || Number(meta.partes) || 0;
      for (let i = 0; i < partes && Object.keys(out).length < quiero.size; i++) {
        let t = null;
        try { t = await base.get('v/' + meta.subida + '/c/' + i, { type: 'json' }); } catch (e) {}
        for (const p of (t && t.productos) || []) {
          if (quiero.has(String(p.item))) out[String(p.item)] = Object.assign({}, p);
        }
      }
    }
  } catch (e) { /* sin base guardada: solo lo que traigan los cambios */ }

  try {
    const inv = getStore('fsj-inventario');
    const cons = await inv.get('_consolidado', { type: 'json' });
    const cambios = (cons && cons.cambios) || {};
    for (const it of quiero) {
      const c = cambios[it];
      if (!c) continue;
      if (!out[it] && !c.alta) continue;     // no se sabe cómo se llama: fuera
      const p = out[it] || { item: it };
      for (const k of ['nombre', 'categoria', 'unidad', 'precio', 'promoAntes', 'promoHasta',
                       'activo', 'destacado', 'existencia']) {
        if (c[k] !== undefined) p[k] = c[k];
      }
      out[it] = p;
    }
  } catch (e) {}
  return out;
}

async function fotos() {
  try {
    const f = getStore({ name: 'fsj-fotos', consistency: 'strong' });
    const idx = await f.get('_indice', { type: 'json' });
    if (idx && Array.isArray(idx.items)) return { items: new Set(idx.items.map(String)), ver: idx.ver || {} };
  } catch (e) {}
  return { items: new Set(), ver: {} };
}

async function ranking(store) {
  const total = await sumar(store);
  const orden = Object.keys(total).sort((a, b) => total[b] - total[a]).slice(0, MAX_TOP * 3);
  const fichas = await fichasPublicas(orden);
  const f = await fotos();
  const productos = [];
  for (const it of orden) {
    const p = fichas[it];
    if (!p || p.activo === false || !(Number(p.precio) > 0) || !p.nombre) continue;
    productos.push({
      item: it, nombre: p.nombre, categoria: p.categoria || '', unidad: p.unidad || '',
      precio: Number(p.precio) || 0,
      promoAntes: Number(p.promoAntes) > 0 ? Number(p.promoAntes) : 0,
      promoHasta: p.promoHasta || '',
      destacado: !!p.destacado,
      foto: f.items.has(it)
        ? '/api/fotos/' + encodeURIComponent(it) + (f.ver[it] ? '?v=' + f.ver[it] : '')
        : '',
    });
    if (productos.length >= MAX_TOP) break;
  }
  return { generado: new Date().toISOString(), dias: DIAS, productos };
}

export default async (req) => {
  let store;
  try { store = getStore(STORE); }
  catch (e) { return json({ ok: false, error: 'almacén no disponible' }, 503); }

  try {
    if (req.method === 'POST') {
      const txt = await req.text();
      if (txt.length > 300) return json({ ok: false, error: 'demasiado largo' }, 413);
      let d = null;
      try { d = JSON.parse(txt); } catch (e) {}
      const item = String((d && d.item) || '').trim();
      if (!itemValido(item)) return json({ ok: false, error: 'ITEM no válido' }, 400);
      await contar(store, item);
      return json({ ok: true });
    }

    if (req.method === 'GET') {
      const n = Math.max(1, Math.min(MAX_TOP, parseInt(new URL(req.url).searchParams.get('top'), 10) || 15));
      let r = null;
      try { r = await store.get('top', { type: 'json' }); } catch (e) {}
      if (!r || !r.generado || Date.now() - Date.parse(r.generado) > REFRESCO_MS) {
        r = await ranking(store);
        try { await store.setJSON('top', r); } catch (e) {}
      }
      return json({ ok: true, generado: r.generado, dias: r.dias,
                    productos: (r.productos || []).slice(0, n) },
                  200, 'public, max-age=300');
    }

    return json({ ok: false, error: 'método no permitido' }, 405);
  } catch (e) {
    return json({ ok: false, error: 'error del servidor' }, 500);
  }
};

export const config = {
  path: '/api/visitas',
};
