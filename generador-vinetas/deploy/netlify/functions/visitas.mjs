/* ==========================================================================
   Visitas del catálogo — Ferretería San José

   PARA QUÉ
   El carrusel de la portada enseña los productos que más se miran en el
   catálogo. Cada vez que un cliente abre la ficha de un producto, el
   catálogo avisa aquí (y agregarlo a la cotización cuenta más); la portada
   pide los más vistos de los últimos 30 días.

   QUÉ SE GUARDA
   Solo el ITEM y cuántas veces, por día. Nada de quién, ni desde dónde.

   RUTAS
     POST /api/visitas   { item, tipo }  -> cuenta una visita (sin clave).
                                            tipo 'cotizacion' vale 3.
     GET  /api/visitas?top=15            -> lo que pinta la portada
     GET  /api/visitas?top=30&conteo=1   -> con cuántas visitas (pide clave)

   MIENTRAS HAY POCAS VISITAS (al principio), el carrusel se completa con
   productos que valga la pena enseñar —destacados, en oferta, con foto— y
   ese relleno cambia cada día. Así la portada se mueve desde el primer día y,
   según se acumulan visitas, va quedando solo lo más visto.

   LA CUENTA ES APROXIMADA, a propósito: dos visitas en el mismo instante
   pueden contarse como una. Para ordenar un carrusel sobra.

   Lo que se devuelve sale de lo que ya ve el cliente (la base publicada del
   catálogo con los últimos cambios encima, o el catalogo-data.json del
   sitio si no hubiera base guardada). El COSTO no está en ninguno, así que
   tampoco puede salir de aquí.
   ========================================================================== */
import { getStore } from '@netlify/blobs';

const STORE = 'fsj-visitas';
const DIAS = 30;                    // la ventana que cuenta para "lo más visto"
const MAX_TOP = 30;
const MAX_PRODUCTOS_DIA = 8000;     // tope de cordura por día
const REFRESCO_MS = 5 * 60 * 1000;  // el ranking se rehace, como mucho, cada 5 minutos
const PESO = { ficha: 1, cotizacion: 3 };

function json(body, status = 200, cache) {
  const h = {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': cache || 'no-store',
  };
  if (cache) h['netlify-cdn-cache-control'] = cache;
  return new Response(JSON.stringify(body), { status, headers: h });
}

function clavesValidas() {
  return String(process.env.FSJ_USUARIOS || '')
    .split(',').map((e) => String(e.split(':')[1] || '').trim()).filter(Boolean)
    .concat(String(process.env.FSJ_CLAVE || '').split(',').map((c) => c.trim()).filter(Boolean));
}
function claveOk(c) {
  const x = String(c || '').trim();
  return !!x && clavesValidas().indexOf(x) >= 0;
}

function itemValido(item) {
  return /^[A-Za-z0-9._-]{1,40}$/.test(item);
}

/* El día en El Salvador (UTC-6, sin horario de verano). */
function dia(ms) {
  return new Date(ms - 6 * 3600 * 1000).toISOString().slice(0, 10);
}

async function contar(store, item, peso) {
  const k = 'd/' + dia(Date.now());
  let d = null;
  try { d = await store.get(k, { type: 'json' }); } catch (e) {}
  if (!d || typeof d.c !== 'object') d = { c: {} };
  if (!(item in d.c) && Object.keys(d.c).length >= MAX_PRODUCTOS_DIA) return false;
  d.c[item] = (Number(d.c[item]) || 0) + peso;
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

/* El catálogo tal como lo ve el cliente: la base guardada en el sitio (o, si
   no hay, el archivo publicado) con los cambios sueltos encima. */
async function catalogoPublico(origen) {
  const mapa = {};
  let deBase = false;
  try {
    const base = getStore('fsj-base');
    const meta = await base.get('meta', { type: 'json' });
    if (meta && meta.subida) {
      const partes = Number(meta.partesCatalogo) || Number(meta.partes) || 0;
      for (let i = 0; i < partes; i++) {
        let t = null;
        try { t = await base.get('v/' + meta.subida + '/c/' + i, { type: 'json' }); } catch (e) {}
        for (const p of (t && t.productos) || []) mapa[String(p.item)] = Object.assign({}, p);
      }
      deBase = Object.keys(mapa).length > 0;
    }
  } catch (e) {}

  if (!deBase && origen) {
    try {
      const r = await fetch(new URL('/catalogo-data.json', origen));
      if (r.ok) {
        const d = await r.json();
        for (const p of (d && d.productos) || []) mapa[String(p.item)] = Object.assign({}, p);
      }
    } catch (e) {}
  }

  try {
    const inv = getStore('fsj-inventario');
    const cons = await inv.get('_consolidado', { type: 'json' });
    const cambios = (cons && cons.cambios) || {};
    for (const it of Object.keys(cambios)) {
      const c = cambios[it];
      if (!mapa[it] && !c.alta) continue;     // no se sabe cómo se llama: fuera
      const p = mapa[it] || { item: it };
      for (const k of ['nombre', 'categoria', 'unidad', 'precio', 'promoAntes', 'promoHasta',
                       'activo', 'destacado', 'existencia']) {
        if (c[k] !== undefined) p[k] = c[k];
      }
      mapa[it] = p;
    }
  } catch (e) {}
  return mapa;
}

async function fotos() {
  try {
    const f = getStore({ name: 'fsj-fotos', consistency: 'strong' });
    const idx = await f.get('_indice', { type: 'json' });
    if (idx && Array.isArray(idx.items)) return { items: new Set(idx.items.map(String)), ver: idx.ver || {} };
  } catch (e) {}
  return { items: new Set(), ver: {} };
}

function vendible(p) {
  return p && p.activo !== false && Number(p.precio) > 0 && p.nombre;
}
function enOferta(p) {
  if (!(Number(p.promoAntes) > Number(p.precio))) return false;
  return !p.promoHasta || String(p.promoHasta) >= dia(Date.now());
}

/* Un orden que cambia cada día, pero es el mismo todo el día. */
function barajarDelDia(lista) {
  let s = 0;
  for (const ch of dia(Date.now())) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const azar = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const l = lista.slice();
  for (let i = l.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    const t = l[i]; l[i] = l[j]; l[j] = t;
  }
  return l;
}

async function ranking(store, origen) {
  const total = await sumar(store);
  const cat = await catalogoPublico(origen);
  const f = await fotos();
  const ficha = (it, p, n) => ({
    item: it, nombre: p.nombre, categoria: p.categoria || '', unidad: p.unidad || '',
    precio: Number(p.precio) || 0,
    promoAntes: enOferta(p) ? Number(p.promoAntes) : 0,
    promoHasta: enOferta(p) ? (p.promoHasta || '') : '',
    destacado: !!p.destacado,
    foto: f.items.has(it)
      ? '/api/fotos/' + encodeURIComponent(it) + (f.ver[it] ? '?v=' + f.ver[it] : '')
      : '',
    visitas: n || 0,
  });

  const productos = [];
  const ya = new Set();
  const orden = Object.keys(total).sort((a, b) => total[b] - total[a]);
  for (const it of orden) {
    const p = cat[it];
    if (!vendible(p)) continue;
    productos.push(ficha(it, p, total[it]));
    ya.add(it);
    if (productos.length >= MAX_TOP) break;
  }
  const vistos = productos.length;

  /* Relleno: lo que vale la pena enseñar, con foto primero. */
  if (productos.length < MAX_TOP) {
    const cand = Object.keys(cat).filter((it) => !ya.has(it) && vendible(cat[it]) &&
      (f.items.has(it) || cat[it].destacado || enOferta(cat[it])) &&
      !(Number(cat[it].existencia) <= 0));
    const peso = (it) => (f.items.has(it) ? 2 : 0) + (cat[it].destacado ? 2 : 0) + (enOferta(cat[it]) ? 1 : 0);
    const porPeso = {};
    for (const it of cand) (porPeso[peso(it)] = porPeso[peso(it)] || []).push(it);
    for (const w of Object.keys(porPeso).map(Number).sort((a, b) => b - a)) {
      for (const it of barajarDelDia(porPeso[w])) {
        if (productos.length >= MAX_TOP) break;
        productos.push(ficha(it, cat[it], 0));
      }
    }
  }
  return { generado: new Date().toISOString(), dias: DIAS, vistos, productos };
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
      await contar(store, item, PESO[d && d.tipo] || 1);
      return json({ ok: true });
    }

    if (req.method === 'GET') {
      const u = new URL(req.url);
      const n = Math.max(1, Math.min(MAX_TOP, parseInt(u.searchParams.get('top'), 10) || 15));
      const conteo = u.searchParams.get('conteo') === '1';
      if (conteo && !claveOk(req.headers.get('x-fsj-clave'))) {
        return json({ ok: false, error: 'hace falta la clave' }, 401);
      }
      let r = null;
      try { r = await store.get('top', { type: 'json' }); } catch (e) {}
      if (!r || !r.generado || Date.now() - Date.parse(r.generado) > REFRESCO_MS) {
        r = await ranking(store, req.url);
        try { await store.setJSON('top', r); } catch (e) {}
      }
      /* Al público no se le dice cuántas visitas tiene cada uno. */
      const productos = (r.productos || []).slice(0, n).map((p) => {
        if (conteo) return p;
        const o = Object.assign({}, p); delete o.visitas; return o;
      });
      return json({ ok: true, generado: r.generado, dias: r.dias, vistos: Math.min(r.vistos || 0, n), productos },
                  200, conteo ? undefined : 'public, max-age=120');
    }

    return json({ ok: false, error: 'método no permitido' }, 405);
  } catch (e) {
    return json({ ok: false, error: 'error del servidor' }, 500);
  }
};

export const config = {
  path: '/api/visitas',
};
