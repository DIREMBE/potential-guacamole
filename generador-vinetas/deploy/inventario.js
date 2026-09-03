/* ==========================================================================
   Inventario — Ferretería San José
   Módulo del lado del cliente para el generador de viñetas.
   - Carga el reporte de inventario (Excel .xlsx) con SheetJS.
   - Guarda los productos en el navegador (IndexedDB) — soporta miles de filas.
   - Búsqueda por nombre, ITEM o código de barras (el código se va asignando
     a medida que se crean viñetas y queda guardado en el producto).
   - Registra cambios de precio (exportables a CSV).
   - Publica un archivo de datos (inventario-data.json) para compartir con
     todos los equipos, y lo carga como base si está presente en el sitio.

   API global: window.Inventario
   ========================================================================== */
window.Inventario = (function () {
  'use strict';

  const DB_NAME = 'fsj-inventario';
  const DB_VER = 2;
  const COLS = { productos: 'productos', cambios: 'cambios', meta: 'meta', imagenes: 'imagenes' };

  let db = null;
  let productos = [];            // caché en memoria
  let byItem = new Map();        // item(string) -> producto
  let byCodigo = new Map();      // codigo(normalizado) -> producto
  let cambios = [];              // registro de cambios de precio
  let imagenes = new Map();      // item -> data URI (foto del producto)
  let imagenesT = new Map();     // item -> cuándo se guardó la foto
  let fotosServidor = new Set(); // items cuya foto ya está en el servidor (Netlify)
  let servidorActivo = false;    // ¿hay función de fotos disponible?
  let claveServidor = '';        // clave de entrada del empleado (compatibilidad)
  let claveFotos = '';           // clave EXCLUSIVA para subir fotos (no está en el código)
  const LS_CLAVE_FOTOS = 'fsj-clave-fotos';
  try { claveFotos = localStorage.getItem(LS_CLAVE_FOTOS) || ''; } catch (e) {}
  const API_FOTOS = '/api/fotos';

  /* ------------------- Cambios compartidos (en línea) --------------------
     El sitio es estático, así que los .json publicados son una foto fija del
     día que se subieron. Esta función guarda los cambios sueltos —un precio,
     una promoción, una baja— para que TODOS los vean sin publicar nada.
     Si no está disponible, se sigue trabajando como siempre.               */
  const API_INV = '/api/inventario';
  let invActivo = false;                  // ¿hay servidor de cambios?
  let invEstado = { actualizado: '', count: 0, tope: 0, error: '' };
  let invComprobado = false;   // ¿ya se sabe si hay servidor? (al abrir, todavía no)
  const INV_MAX_LOTE = 200;               // cuántos van en cada envío
  const INV_MAX_DE_GOLPE = 500;           // más que esto: toca publicar, no sincronizar
  let meta = { lastUpload: null, count: 0, baselineAt: null };
  const listeners = [];          // avisos de cambios (para refrescar la vista)

  /* ----------------------------- Utilidades ------------------------------ */
  const normCod = (c) => String(c == null ? '' : c).trim();
  const upper = (s) => String(s == null ? '' : s).trim().toUpperCase();
  const numOf = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function txDone(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }
  function store(name, mode) { return db.transaction(name, mode || 'readonly').objectStore(name); }

  /* Guardar y esperar a que quede GUARDADO DE VERDAD.

     `reqP` avisa en cuanto la petición sale bien, pero en ese momento la
     transacción todavía no se ha confirmado. Si el navegador cambia de página
     justo ahí —el empleado pone una oferta y toca otro enlace enseguida—,
     IndexedDB aborta la transacción y el cambio se pierde sin decir nada.
     Esperando a `oncomplete` eso no pasa: cuando esto termina, está escrito. */
  async function guardar(nombre, hacer) {
    const st = store(nombre, 'readwrite');
    const r = await reqP(hacer(st));
    await txDone(st.transaction);
    return r;
  }

  function openDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(COLS.productos)) d.createObjectStore(COLS.productos, { keyPath: 'item' });
        if (!d.objectStoreNames.contains(COLS.cambios)) d.createObjectStore(COLS.cambios, { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains(COLS.meta)) d.createObjectStore(COLS.meta, { keyPath: 'k' });
        if (!d.objectStoreNames.contains(COLS.imagenes)) d.createObjectStore(COLS.imagenes, { keyPath: 'item' });
      };
      req.onsuccess = (e) => { db = e.target.result; res(); };
      req.onerror = () => rej(req.error);
    });
  }

  async function loadAll() {
    productos = await reqP(store(COLS.productos).getAll());
    cambios = await reqP(store(COLS.cambios).getAll());
    const imgs = await reqP(store(COLS.imagenes).getAll());
    imagenes = new Map(imgs.map((r) => [String(r.item), r.data]));
    imagenesT = new Map(imgs.map((r) => [String(r.item), r.t || 0]));
    const m = await reqP(store(COLS.meta).get('meta'));
    meta = (m && m.v) ? m.v : { lastUpload: null, count: 0, baselineAt: null };
    reindex();
  }

  /* ------------------- Avisos de cambio (para las vistas) ---------------- */
  function onCambio(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function emitir(tipo, detalle) {
    for (const fn of listeners) { try { fn(tipo, detalle); } catch (e) {} }
    // Aviso entre pestañas del mismo navegador (catálogo abierto en otra pestaña)
    try { localStorage.setItem('fsj-inv-ping', JSON.stringify({ tipo, t: Date.now() })); } catch (e) {}
  }
  // Escucha cambios hechos en otra pestaña y recarga los datos.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', async (e) => {
      if (e.key !== 'fsj-inv-ping' || !db) return;
      await loadAll();
      for (const fn of listeners) { try { fn('externo'); } catch (err) {} }
    });
  }

  function reindex() {
    byItem = new Map();
    byCodigo = new Map();
    for (const p of productos) {
      byItem.set(String(p.item), p);
      if (p.codigo) byCodigo.set(normCod(p.codigo), p);
    }
  }

  async function saveMeta() { await guardar(COLS.meta, (st) => st.put({ k: 'meta', v: meta })); }

  /* --------------------- Importar Excel (.xlsx) -------------------------- */
  // Mapea encabezados del reporte FelTec a nuestros campos.
  function mapHeader(header) {
    const H = header.map(upper);
    const find = (names) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
    const findRe = (re) => H.findIndex((h) => re.test(h));
    return {
      item: find(['ITEM', 'CODIGO ITEM', 'ID']),
      nombre: find(['PRODUCTO', 'DESCRIPCION', 'NOMBRE']),
      categoria: find(['CATEGORIA', 'CATEGORÍA']),
      unidad: find(['UNIDAD MEDIDA', 'UNIDAD', 'UNIDAD DE MEDIDA']),
      existencia: find(['EXISTENCIA', 'STOCK', 'SALDO']),
      precio: find(['C. VENTA', 'PRECIO VENTA', 'PRECIO', 'P. VENTA', 'PVP']),
      costo: find(['C. COMPRA', 'COSTO', 'COSTO UNITARIO', 'P. COMPRA']),
      codigo: findRe(/COD.*BARRA|BARRA|EAN|UPC|COD\. BARRAS|CODIGO DE BARRA/),
    };
  }

  // El reporte trae una fila final "Totales:" que no es un producto.
  function esFilaDeProducto(item) {
    const v = String(item == null ? '' : item).trim();
    if (!v) return false;
    if (/^totales?\s*:?$/i.test(v)) return false;   // fila de totales
    if (!/\d/.test(v)) return false;                // un ITEM siempre lleva dígitos
    return true;
  }

  // file: File (del <input type=file>). Devuelve {count, sinPrecio}.
  async function importarExcel(file) {
    if (typeof XLSX === 'undefined') throw new Error('No se pudo cargar el lector de Excel (XLSX).');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
    if (!rows.length) throw new Error('El archivo está vacío.');
    const col = mapHeader(rows[0]);
    if (col.item < 0 || col.nombre < 0) {
      throw new Error('No se encontraron las columnas ITEM y PRODUCTO en el archivo.');
    }

    /* Se conserva todo lo que se hizo a mano y el archivo no sabe: códigos de
       barra, destacados, costos, marcas, y los productos dados de baja. */
    const prevCod = new Map(), prevDest = new Set(), prevToc = new Map();
    const prev = new Map();
    for (const p of productos) {
      prev.set(String(p.item), p);
      if (p.codigo) prevCod.set(String(p.item), p.codigo);
      if (p.destacado) prevDest.add(String(p.item));
      if (p.tocadoEn) prevToc.set(String(p.item), p.tocadoEn);
    }

    /* Precios que un empleado corrigió DESPUÉS de la última carga de archivo.
       Esos ganan sobre lo que traiga el Excel: el que los escribió sabía algo
       que el sistema todavía no. */
    const desde = Date.parse(meta.lastUpload || '') || 0;
    const editadoAMano = new Set();
    for (const c of cambios) {
      const t = Date.parse(c.fecha || '') || 0;
      const origen = String(c.origen || '');
      if (t > desde && origen !== 'archivo') editadoAMano.add(String(c.item));
    }
    let conservados = 0;

    const st = store(COLS.productos, 'readwrite');
    st.clear();
    let count = 0, sinPrecio = 0, bajasSinPrecio = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !esFilaDeProducto(row[col.item])) continue;
      const item = String(row[col.item]).trim();
      let codigo = '';
      if (col.codigo >= 0 && row[col.codigo] != null && String(row[col.codigo]).trim() !== '') codigo = String(row[col.codigo]).trim();
      else if (prevCod.has(item)) codigo = prevCod.get(item);
      const ant = prev.get(item);
      let precio = numOf(row[col.precio]);
      if (ant && editadoAMano.has(item) && numOf(ant.precio) !== precio) {
        precio = numOf(ant.precio);      // gana el precio corregido por el empleado
        conservados++;
      }
      if (precio <= 0) sinPrecio++;
      /* Sin precio de venta no se puede vender: queda de baja hasta que alguien
         le ponga precio. Si una persona lo reactivó a mano, se respeta. */
      const bajaPorPrecio = precio <= 0 && !(ant && ant.activoManual);
      if (bajaPorPrecio) bajasSinPrecio++;
      st.put({
        item,
        nombre: String(row[col.nombre] == null ? '' : row[col.nombre]).trim(),
        categoria: col.categoria >= 0 ? String(row[col.categoria] || '').trim() : '',
        unidad: col.unidad >= 0 ? String(row[col.unidad] || '').trim() : '',
        existencia: numOf(row[col.existencia]),
        precio,
        codigo,
        bajaMotivo: bajaPorPrecio ? 'sin-precio' : (ant ? (ant.bajaMotivo || '') : ''),
        activoManual: ant ? !!ant.activoManual : false,
        costo: col.costo >= 0 ? numOf(row[col.costo]) : (ant ? numOf(ant.costo) : 0),
        marca: ant ? String(ant.marca || '') : '',
        promoAntes: ant ? numOf(ant.promoAntes) : 0,
        promoHasta: ant ? String(ant.promoHasta || '') : '',
        destacado: prevDest.has(item),
        activo: bajaPorPrecio ? false : (ant ? ant.activo !== false : true),
        tocadoEn: prevToc.get(item) || 0,
      });
      count++;
    }
    await txDone(st.transaction);
    meta.lastUpload = new Date().toISOString();
    meta.baselineAt = meta.lastUpload;   // marca la versión de datos cargada
    meta.count = count;
    await saveMeta();
    await loadAll();
    emitir('import');
    return { count, sinPrecio, preciosConservados: conservados, bajasSinPrecio };
  }

  /* ======================================================================
     REVISIÓN DE DISCREPANCIAS
     analizarArchivo() lee el Excel y compara SIN aplicar nada; devuelve las
     diferencias para que el empleado elija cuáles aplicar.
     ====================================================================== */
  async function analizarArchivo(file) {
    if (typeof XLSX === 'undefined') throw new Error('No se pudo cargar el lector de Excel (XLSX).');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
    if (!rows.length) throw new Error('El archivo está vacío.');
    const col = mapHeader(rows[0]);
    if (col.item < 0 || col.nombre < 0) throw new Error('No se encontraron las columnas ITEM y PRODUCTO en el archivo.');

    const filas = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !esFilaDeProducto(row[col.item])) continue;
      filas.push({
        item: String(row[col.item]).trim(),
        nombre: String(row[col.nombre] == null ? '' : row[col.nombre]).trim(),
        categoria: col.categoria >= 0 ? String(row[col.categoria] || '').trim() : '',
        unidad: col.unidad >= 0 ? String(row[col.unidad] || '').trim() : '',
        existencia: numOf(row[col.existencia]),
        precio: numOf(row[col.precio]),
        codigo: col.codigo >= 0 ? String(row[col.codigo] || '').trim() : '',
      });
    }

    const enArchivo = new Set(filas.map((f) => f.item));
    const nuevos = [], precios = [], iguales = [];
    for (const f of filas) {
      const actual = byItem.get(f.item);
      if (!actual) { nuevos.push(f); continue; }
      if (f.precio > 0 && Math.abs(f.precio - numOf(actual.precio)) >= 0.005) {
        precios.push({
          item: f.item, nombre: actual.nombre || f.nombre,
          actual: numOf(actual.precio), nuevo: f.precio, fila: f,
        });
      } else iguales.push(f.item);
    }
    // Productos que están en el sistema pero ya no vienen en el archivo
    const faltantes = productos.filter((p) => !enArchivo.has(String(p.item)))
      .map((p) => ({ item: p.item, nombre: p.nombre, precio: numOf(p.precio) }));

    return { filas, nuevos, precios, faltantes, sinCambio: iguales.length, total: filas.length };
  }

  /* Aplica el análisis con la selección del empleado.
     sel = { precios: Set/array de items a actualizar,
             nuevos: Set/array de items a agregar,
             quitarFaltantes: bool, empleado: string }                       */
  async function aplicarAnalisis(analisis, sel) {
    sel = sel || {};
    const okPrecio = new Set((sel.precios || []).map(String));
    const okNuevo = new Set((sel.nuevos || []).map(String));
    const empleado = sel.empleado || '';
    const enArchivo = new Map(analisis.filas.map((f) => [f.item, f]));

    const st = store(COLS.productos, 'readwrite');
    const nuevosCambios = [];
    let actualizados = 0, agregados = 0, quitados = 0;
    // ITEM que el empleado marcó para dar de baja (se calcula una sola vez)
    const marcadosBaja = sel.quitar ? new Set(sel.quitar.map(String)) : null;

    for (const p of productos) {
      const item = String(p.item);
      const f = enArchivo.get(item);
      if (!f) {
        /* Los que ya no vienen en el archivo NO se borran: se dan de baja.
           Así conservan foto, código de barras e historial de precios, y se
           pueden reactivar. `quitar` trae los ITEM que el empleado marcó. */
        if (sel.quitarFaltantes || (marcadosBaja && marcadosBaja.has(item))) {
          if (p.activo !== false) {
            p.activo = false; p.tocadoEn = Date.now();
            st.put(p); quitados++;
          }
        }
        continue;
      }
      // Datos que no son precio se actualizan siempre (nombre, categoría, stock)
      const actualizado = {
        item,
        nombre: f.nombre || p.nombre,
        categoria: f.categoria || p.categoria,
        unidad: f.unidad || p.unidad,
        existencia: f.existencia,
        precio: numOf(p.precio),
        codigo: p.codigo || f.codigo || '',
        destacado: !!p.destacado,
        tocadoEn: p.tocadoEn || 0,
      };
      // El precio solo si el empleado lo aprobó
      if (okPrecio.has(item) && f.precio > 0) {
        const anterior = numOf(p.precio);
        if (Math.abs(f.precio - anterior) >= 0.005) {
          actualizado.precio = f.precio;
          nuevosCambios.push({ item, nombre: actualizado.nombre, anterior, nuevo: f.precio, fecha: new Date().toISOString(), empleado, origen: 'archivo' });
          actualizados++;
        }
      }
      st.put(actualizado);
    }
    for (const f of analisis.nuevos) {
      if (!okNuevo.has(f.item)) continue;
      st.put({
        item: f.item, nombre: f.nombre, categoria: f.categoria, unidad: f.unidad,
        existencia: f.existencia, precio: f.precio, codigo: f.codigo || '', destacado: false,
        tocadoEn: Date.now(),
      });
      agregados++;
    }
    await txDone(st.transaction);

    if (nuevosCambios.length) {
      const stc = store(COLS.cambios, 'readwrite');
      for (const c of nuevosCambios) stc.add(c);
      await txDone(stc.transaction);
    }
    meta.lastUpload = new Date().toISOString();
    meta.baselineAt = meta.lastUpload;
    await saveMeta();
    await loadAll();
    emitir('import');

    /* Lo que el empleado revisó y aceptó se comparte con los demás equipos.
       Si fueran miles (el Excel mensual completo), no: ese es el momento de
       publicar el inventario al sitio, que es más barato que mandar miles de
       cambios sueltos. La pantalla lo dice. */
    const paraCompartir = [];
    for (const c of nuevosCambios) {
      const p = byItem.get(String(c.item));
      if (p) paraCompartir.push({ item: p.item, precio: numOf(p.precio) });
    }
    for (const it of okNuevo) {
      const p = byItem.get(String(it));
      if (p) {
        paraCompartir.push({
          item: p.item, alta: true, nombre: p.nombre, categoria: p.categoria,
          unidad: p.unidad, existencia: p.existencia, precio: p.precio,
          codigo: p.codigo || '', marca: p.marca || '', activo: true,
        });
      }
    }
    if (paraCompartir.length) _empujar(paraCompartir);

    return { actualizados, agregados, quitados,
             compartidos: paraCompartir.length <= INV_MAX_DE_GOLPE ? paraCompartir.length : 0 };
  }

  /* ------------------- Cargar base publicada (JSON) ----------------------
     `op.parcial` es para la base del CLIENTE, que solo trae lo que se enseña:
     faltan los ~4.900 dados de baja. En el equipo de un empleado el catálogo y
     el panel comparten la misma base local, así que abrir el catálogo NO puede
     llevarse por delante lo que el panel necesita. Con `parcial` lo que no
     viene se queda como está, en vez de borrarse.                           */
  async function importarBaseline(data, op) {
    if (!data || !Array.isArray(data.productos)) return 0;
    const parcial = !!(op && op.parcial);

    /* Lo que este equipo ya tenía. Cargar la base publicada NO puede borrar el
       trabajo hecho aquí: códigos de barra asignados, destacados, si el
       producto está dado de baja, y sobre todo los PRECIOS que alguien
       corrigió a mano y todavía no se han publicado. */
    const previo = new Map();
    for (const p of productos) previo.set(String(p.item), p);

    /* Un precio se considera "editado aquí" si hay un cambio registrado en el
       historial posterior a la fecha de la base que llega. Ese gana. */
    const baseAt = Date.parse(data.generatedAt || '') || 0;
    const editadoAqui = new Set();
    for (const c of cambios) {
      const t = Date.parse(c.fecha || '') || 0;
      if (t > baseAt) editadoAqui.add(String(c.item));
    }

    const st = store(COLS.productos, 'readwrite');
    if (!parcial) st.clear();
    let count = 0, preciosConservados = 0;
    for (const p of data.productos) {
      const item = String(p.item).trim();
      const ant = previo.get(item);
      let precio = numOf(p.precio);
      if (ant && editadoAqui.has(item) && numOf(ant.precio) !== precio) {
        precio = numOf(ant.precio);          // gana el precio corregido aquí
        preciosConservados++;
      }
      st.put({
        item,
        nombre: String(p.nombre || '').trim(),
        categoria: String(p.categoria || '').trim(),
        unidad: String(p.unidad || '').trim(),
        existencia: numOf(p.existencia),
        precio: precio,
        costo: numOf(p.costo) || (ant ? numOf(ant.costo) : 0),
        marca: String(p.marca || '').trim() || (ant ? String(ant.marca || '') : ''),
        // el código de barras del archivo manda; si no trae, se conserva el de aquí
        codigo: p.codigo ? String(p.codigo).trim() : (ant && ant.codigo ? ant.codigo : ''),
        destacado: p.destacado !== undefined ? !!p.destacado : !!(ant && ant.destacado),
        activo: p.activo !== undefined ? !!p.activo
                : (numOf(precio) <= 0 && !(ant && ant.activoManual) ? false
                   : (ant ? ant.activo !== false : true)),
        bajaMotivo: p.bajaMotivo !== undefined ? String(p.bajaMotivo || '')
                    : (numOf(precio) <= 0 ? 'sin-precio' : (ant ? String(ant.bajaMotivo || '') : '')),
        activoManual: p.activoManual !== undefined ? !!p.activoManual : !!(ant && ant.activoManual),
        promoAntes: p.promoAntes !== undefined ? numOf(p.promoAntes) : (ant ? numOf(ant.promoAntes) : 0),
        promoHasta: p.promoHasta !== undefined ? String(p.promoHasta || '') : (ant ? String(ant.promoHasta || '') : ''),
        tocadoEn: Number(p.tocadoEn) || (ant ? Number(ant.tocadoEn) || 0 : 0),
        /* Lo que ya se imprimió aquí no se pierde por cargar una base nueva:
           si la que llega no lo trae, se conserva lo de este equipo. */
        etiquetaEn: Number(p.etiquetaEn) || (ant ? Number(ant.etiquetaEn) || 0 : 0),
        etiquetaPrecio: Number(p.etiquetaPrecio) || (ant ? Number(ant.etiquetaPrecio) || 0 : 0),
      });
      count++;
    }
    await txDone(st.transaction);
    if (preciosConservados) {
      try { console.info('[Inventario] se conservaron ' + preciosConservados + ' precio(s) editados en este equipo'); } catch (e) {}
    }
    meta.lastUpload = data.generatedAt || new Date().toISOString();
    meta.baselineAt = data.generatedAt || null;
    /* Si lo que se cargó fue la base del cliente, este equipo NO tiene la base
       completa aunque la fecha diga que está al día. El panel lo mira para
       volver a pedir la entera en vez de creerse actualizado. */
    meta.baselineParcial = parcial;
    meta.count = count;
    await saveMeta();
    await loadAll();
    return count;
  }

  /* ----------------------------- Búsqueda -------------------------------- */
  function buscar(q, limite) {
    q = String(q || '').trim();
    if (q.length < 2) return [];
    const lim = limite || 12;
    const ql = q.toLowerCase();
    const res = [];
    const seen = new Set();
    const add = (p) => { if (p && !seen.has(p.item)) { seen.add(p.item); res.push(p); } };
    // coincidencia exacta por código o ITEM primero
    add(byCodigo.get(normCod(q)));
    add(byItem.get(q));
    // tokens (todas las palabras deben aparecer en el nombre)
    const toks = ql.split(/\s+/).filter(Boolean);
    for (const p of productos) {
      if (res.length >= lim) break;
      if (seen.has(p.item)) continue;
      const nom = p.nombre.toLowerCase();
      const okNombre = toks.every((t) => nom.includes(t));
      const okCod = p.codigo && p.codigo.toLowerCase().includes(ql);
      if (okNombre || okCod || String(p.item) === q) add(p);
    }
    return res.slice(0, lim);
  }

  // Busca por código de barras asignado y, si no hay, por ITEM (código por defecto).
  function porCodigo(cod) { const c = normCod(cod); return byCodigo.get(c) || byItem.get(c) || null; }
  function porItem(item) { return byItem.get(String(item)) || null; }
  // Código que se imprime en la viñeta: el asignado, o el ITEM por defecto.
  function codigoEfectivo(prod) { return (prod && prod.codigo) ? prod.codigo : (prod ? String(prod.item) : ''); }

  /* ---------------- Asignar código / actualizar precio ------------------- */
  async function asignarCodigo(item, codigo) {
    const p = byItem.get(String(item));
    if (!p) return false;
    const nuevo = normCod(codigo);
    if (p.codigo === nuevo) return true;
    // libera el índice del código anterior si otro producto no lo usa
    if (p.codigo && byCodigo.get(p.codigo) === p) byCodigo.delete(p.codigo);
    p.codigo = nuevo;
    await guardar(COLS.productos, (st) => st.put(p));
    if (nuevo) byCodigo.set(nuevo, p);
    return true;
  }

  // Registra un cambio de precio (si difiere) y actualiza el precio local.
  async function actualizarPrecio(item, nuevoPrecio, empleado, origen) {
    const p = byItem.get(String(item));
    if (!p) return false;
    const anterior = numOf(p.precio);
    const nuevo = numOf(nuevoPrecio);
    if (nuevo <= 0 || Math.abs(nuevo - anterior) < 0.0001) return false;
    p.precio = nuevo;
    p.tocadoEn = Date.now();
    await guardar(COLS.productos, (st) => st.put(p));
    const entry = {
      item: p.item, nombre: p.nombre, anterior, nuevo,
      fecha: new Date().toISOString(), empleado: empleado || '', origen: origen || 'viñetas',
    };
    await guardar(COLS.cambios, (st) => st.add(entry));
    cambios.push(entry);
    _editado(p);
    emitir('precio', { item: p.item, nuevo });
    await _revisarBajaPorPrecio(p.item);   // con precio, vuelve al catálogo
    /* Se comparte con los demás equipos. Si no se puede, queda en cola: el
       precio ya está guardado aquí, no se pierde. */
    if (origen !== 'archivo') _empujar([{ item: p.item, precio: nuevo }]);
    return true;
  }

  /* --------------------------- Fotos de producto -------------------------
     La foto se reduce y se comprime hasta pesar poco (el catálogo la muestra
     a ~250px, así que no hace falta más). Se aceptan los formatos que el
     navegador sepa decodificar; los que no (p. ej. HEIC de iPhone) se avisan
     con un mensaje claro en vez de fallar en silencio.
     ---------------------------------------------------------------------- */
  const IMG_MAX_LADO = 640;      // lado máximo en píxeles
  const IMG_OBJETIVO = 90 * 1024; // objetivo de peso por foto (~90 KB)

  // Decodifica el archivo con el mejor método disponible.
  function _decodificar(file) {
    // createImageBitmap acepta más formatos y no infla el archivo a base64.
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file).catch(() => _decodificarConImg(file));
    }
    return _decodificarConImg(file);
  }
  function _decodificarConImg(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const ext = (file.name || '').split('.').pop().toLowerCase();
        if (['heic', 'heif'].indexOf(ext) >= 0) {
          rej(new Error('“' + file.name + '” está en formato HEIC (iPhone) y el navegador no puede abrirlo. ' +
            'En el iPhone: Ajustes → Cámara → Formatos → “Más compatible”, o comparte la foto como JPG.'));
        } else {
          rej(new Error('“' + (file.name || 'el archivo') + '” no se pudo abrir como imagen. Usa JPG, PNG o WEBP.'));
        }
      };
      img.src = url;
    });
  }

  async function _procesarImagen(file) {
    if (file && file.size === 0) throw new Error('“' + (file.name || 'el archivo') + '” está vacío.');
    const src = await _decodificar(file);
    const iw = src.width || src.naturalWidth, ih = src.height || src.naturalHeight;
    if (!iw || !ih) throw new Error('No se pudieron leer las dimensiones de la imagen.');

    let w = iw, h = ih;
    if (w > IMG_MAX_LADO || h > IMG_MAX_LADO) {
      const s = Math.min(IMG_MAX_LADO / w, IMG_MAX_LADO / h);
      w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    if (src.close) src.close();

    // Baja la calidad por pasos hasta acercarse al peso objetivo.
    let q = 0.78, data = c.toDataURL('image/jpeg', q);
    while (data.length * 0.75 > IMG_OBJETIVO && q > 0.42) {
      q -= 0.1;
      data = c.toDataURL('image/jpeg', q);
    }
    if (!data || data.indexOf('data:image') !== 0) throw new Error('No se pudo convertir la imagen.');
    return data;
  }

  async function guardarImagen(item, file) {
    const key = String(item);
    if (!byItem.get(key)) throw new Error('El producto ya no está en el inventario (ITEM ' + key + ').');
    const data = await _procesarImagen(file);
    try {
      await guardar(COLS.imagenes, (st) => st.put({ item: key, data, t: Date.now() }));
    } catch (e) {
      if (e && /quota/i.test(e.name + ' ' + e.message)) {
        throw new Error('Ya no hay espacio en este navegador para más fotos. Publica las fotos al sitio y luego borra las que no necesites.');
      }
      throw new Error('No se pudo guardar la foto: ' + (e && e.message ? e.message : 'error de almacenamiento'));
    }
    // Verifica que quedó realmente guardada (no confiar solo en el put).
    const check = await reqP(store(COLS.imagenes).get(key));
    if (!check || !check.data) throw new Error('La foto no quedó guardada. Intenta de nuevo.');
    imagenes.set(key, check.data);
    imagenesT.set(key, Date.now());
    tocar(key);
    // Sube al servidor para que se vea en todos los dispositivos (si está activo)
    const subida = await _subirFotoServidor(key, check.data);
    emitir('imagen', { item: key, servidor: subida });
    return { ok: true, servidor: subida };
  }


  /* ====================== HOJA DE CONTEO (códigos de barra) ==================
     El reporte de FelTec trae el ITEM pero no el código de barras; la hoja de
     conteo trae el código pero no el ITEM. El puente es el nombre: el conteo
     escribe el mismo nombre del reporte MÁS la marca entre paréntesis al final.
     Quitando ese sufijo casan el 98.9% de los productos; para el resto se usa
     el número de modelo que ambos sistemas escriben dentro del nombre, y el
     costo para desempatar cuando hay varios candidatos.
     ========================================================================= */
  function _sinAcentos(t) {
    t = String(t == null ? '' : t);
    try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return t;
  }
  // nombre comparable: sin la marca final entre paréntesis
  function _base(nombre) {
    let t = _sinAcentos(nombre).toUpperCase();
    t = t.replace(/\([^)]*\)\s*$/, '');
    return t.replace(/\s+/g, ' ').trim();
  }
  function _marcaDe(nombre) {
    const m = /\(([^)]*)\)\s*$/.exec(String(nombre || ''));
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
  }
  // números de modelo del fabricante (4 a 7 cifras), ignorando fracciones
  function _modelos(nombre) {
    const n = _sinAcentos(nombre).toUpperCase().replace(/\d+\s*\/\s*\d+/g, ' ');
    return (n.match(/(?:^|[^\d])(\d{4,7})(?![\d])/g) || [])
      .map((x) => x.replace(/\D/g, ''));
  }

  /* Lee la hoja de conteo y devuelve lo que se encontró, SIN aplicar nada:
     el panel lo muestra para revisar antes de guardar. */
  async function analizarConteo(file) {
    if (typeof XLSX === 'undefined') throw new Error('No se pudo cargar el lector de Excel (XLSX).');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });

    // la cabecera real puede no ser la primera fila (el archivo trae título)
    let iCab = -1;
    for (let i = 0; i < Math.min(filas.length, 15); i++) {
      const f = (filas[i] || []).map((x) => upper(x));
      if (f.indexOf('CODIGO') >= 0 || f.indexOf('CÓDIGO') >= 0) { iCab = i; break; }
    }
    if (iCab < 0) throw new Error('No se encontró la columna CÓDIGO. ¿Es la hoja de conteo?');
    const cab = (filas[iCab] || []).map((x) => upper(x));
    const col = {
      codigo: Math.max(cab.indexOf('CODIGO'), cab.indexOf('CÓDIGO')),
      nombre: Math.max(cab.indexOf('PRODUCTO'), cab.indexOf('DESCRIPCION')),
      unidad: Math.max(cab.indexOf('PRES.'), cab.indexOf('PRES'), cab.indexOf('UNIDAD')),
      costo: cab.indexOf('COSTO'),
      stock: cab.indexOf('STOCK'),
    };
    if (col.nombre < 0) throw new Error('No se encontró la columna PRODUCTO en la hoja de conteo.');

    // índices de los productos que ya tenemos
    const porBase = new Map(), porModelo = new Map();
    for (const p of productos) {
      const b = _base(p.nombre);
      if (!porBase.has(b)) porBase.set(b, []);
      porBase.get(b).push(p);
      for (const m of _modelos(p.nombre)) {
        if (!porModelo.has(m)) porModelo.set(m, []);
        porModelo.get(m).push(p);
      }
    }

    const res = { conCodigo: [], nuevos: [], ambiguos: [], sinCodigo: 0, filas: 0, categoria: '' };
    let categoria = '';
    for (let i = iCab + 1; i < filas.length; i++) {
      const f = filas[i] || [];
      const codigo = String(f[col.codigo] == null ? '' : f[col.codigo]).trim();
      const nombre = String(f[col.nombre] == null ? '' : f[col.nombre]).trim();
      const primera = String(f[0] == null ? '' : f[0]).trim();
      // fila de categoría: solo trae la primera celda
      if (primera && !codigo && !nombre) { categoria = primera; continue; }
      if (!nombre) continue;
      res.filas++;
      if (!codigo) res.sinCodigo++;

      const reg = {
        codigo: codigo,
        nombre: nombre,
        base: _base(nombre),
        marca: _marcaDe(nombre),
        categoria: categoria,
        unidad: col.unidad >= 0 ? String(f[col.unidad] || '').trim() : '',
        costo: col.costo >= 0 ? numOf(f[col.costo]) : 0,
        stock: col.stock >= 0 ? numOf(f[col.stock]) : 0,
      };

      let cand = porBase.get(reg.base) || [];
      if (cand.length > 1) {
        const cerca = cand.filter((p) => reg.costo > 0 && Math.abs(numOf(p.costo) - reg.costo) < 0.02);
        if (cerca.length === 1) cand = cerca;
      }
      if (!cand.length) {                      // segundo intento: número de modelo
        const vistos = new Set(); const porMod = [];
        for (const m of _modelos(nombre)) {
          for (const p of (porModelo.get(m) || [])) {
            if (!vistos.has(p.item)) { vistos.add(p.item); porMod.push(p); }
          }
        }
        cand = porMod;
      }

      if (cand.length === 1) {
        const p = cand[0];
        reg.item = p.item;
        reg.nombreActual = p.nombre;
        reg.codigoActual = p.codigo || '';
        reg.cambia = reg.codigo && reg.codigo !== reg.codigoActual;
        res.conCodigo.push(reg);
      } else if (cand.length > 1) {
        reg.opciones = cand.slice(0, 5).map((p) => ({ item: p.item, nombre: p.nombre }));
        res.ambiguos.push(reg);
      } else {
        res.nuevos.push(reg);
      }
    }
    return res;
  }

  /* Aplica lo revisado: asigna códigos de barra, costo y marca, y da de alta los
     productos nuevos que se hayan marcado. */
  async function aplicarConteo(analisis, opciones) {
    opciones = opciones || {};
    const ponerCodigos = opciones.codigos !== false;
    const altaNuevos = !!opciones.altaNuevos;
    const nuevosOk = opciones.nuevosSeleccionados || null;   // Set de códigos

    let codigos = 0, costos = 0, altas = 0;
    const nuevosCodigos = [];        // lo que vale la pena compartir
    const st = store(COLS.productos, 'readwrite');

    if (ponerCodigos) {
      for (const r of (analisis.conCodigo || [])) {
        const p = byItem.get(String(r.item));
        if (!p) continue;
        let toco = false;
        if (r.codigo && p.codigo !== r.codigo) {
          p.codigo = r.codigo; codigos++; toco = true;
          nuevosCodigos.push({ item: p.item, codigo: r.codigo });
        }
        if (r.costo > 0 && numOf(p.costo) !== r.costo) { p.costo = r.costo; costos++; toco = true; }
        if (r.marca && !p.marca) { p.marca = r.marca; toco = true; }
        if (toco) st.put(p);
      }
    }

    if (altaNuevos) {
      let siguiente = 0;
      for (const p of productos) {
        const n = parseInt(p.item, 10);
        if (isFinite(n) && n > siguiente) siguiente = n;
      }
      for (const r of (analisis.nuevos || [])) {
        if (nuevosOk && !nuevosOk.has(r.codigo + '|' + r.nombre)) continue;
        siguiente++;
        st.put({
          item: String(siguiente), nombre: r.nombre, categoria: r.categoria,
          unidad: r.unidad || 'Unidad', existencia: r.stock, precio: 0,
          costo: r.costo, marca: r.marca, codigo: r.codigo,
          destacado: false, activo: true, tocadoEn: Date.now(),
        });
        altas++;
      }
    }

    await txDone(st.transaction);
    meta.cambioSinPublicar = Date.now();
    await saveMeta();
    await loadAll();
    emitir('conteo', { codigos: codigos, costos: costos, altas: altas });

    /* De la hoja de conteo se comparte el código de barras, que le sirve a
       todo el mundo para escanear. El COSTO no: es lo que pagamos nosotros y
       esto se sirve sin clave. */
    if (nuevosCodigos.length && nuevosCodigos.length <= INV_MAX_DE_GOLPE) {
      _empujar(nuevosCodigos);
    }

    return { codigos: codigos, costos: costos, altas: altas };
  }

  /* ---------------------- Dar de baja / de alta -------------------------
     Nunca se borra un producto: se marca de baja. Así conserva su foto, su
     historial de precios y su código, y se puede volver a activar. */
  /* Poner un precio devuelve al producto al catálogo si estaba de baja solo
     por no tenerlo. Es lo que espera quien acaba de escribirlo. */
  async function _revisarBajaPorPrecio(item) {
    const p = byItem.get(String(item));
    if (!p) return false;
    if (numOf(p.precio) > 0 && p.activo === false && p.bajaMotivo === 'sin-precio') {
      p.activo = true;
      p.bajaMotivo = '';
      await guardar(COLS.productos, (st) => st.put(p));
      emitir('activo', { item: p.item, activo: true });
      _empujar([{ item: p.item, activo: true, bajaMotivo: '' }]);
      return true;
    }
    return false;
  }

  async function setActivo(item, activo) {
    const p = byItem.get(String(item));
    if (!p) return false;
    p.activo = !!activo;
    /* Si una persona lo reactiva, se respeta aunque no tenga precio: no se
       vuelve a bajar solo en la siguiente carga de archivo. */
    p.activoManual = !!activo;
    p.bajaMotivo = activo ? '' : '';
    p.tocadoEn = Date.now();
    await guardar(COLS.productos, (st) => st.put(p));
    meta.cambioSinPublicar = Date.now();
    await saveMeta();
    _editado(p);
    emitir('activo', { item: p.item, activo: p.activo });
    _empujar([{ item: p.item, activo: p.activo, activoManual: p.activoManual,
                bajaMotivo: p.bajaMotivo || '' }]);
    return true;
  }
  function esActivo(p) { return !p || p.activo !== false; }
  /* deBaja(q, limite, motivo)
       motivo 'sin-precio' -> las que puso el sistema por venir en cero
       motivo 'manual'     -> las que decidió una persona
       sin motivo          -> todas */
  function deBaja(q, limite, motivo) {
    const ql = String(q || '').trim().toLowerCase();
    return productos.filter(function (p) {
      if (p.activo !== false) return false;
      if (motivo === 'sin-precio' && p.bajaMotivo !== 'sin-precio') return false;
      if (motivo === 'manual' && p.bajaMotivo === 'sin-precio') return false;
      if (!ql) return true;
      return p.nombre.toLowerCase().indexOf(ql) >= 0 || String(p.item) === ql ||
             String(p.codigo || '').toLowerCase() === ql;
    }).slice(0, limite || 200);
  }

  /* Alta manual de un producto que no viene en ningún archivo. */
  async function altaProducto(datos) {
    datos = datos || {};
    const nombre = String(datos.nombre || '').trim();
    if (!nombre) throw new Error('El producto necesita un nombre.');
    let item = String(datos.item || '').trim();
    if (!item) {
      let siguiente = 0;
      for (const p of productos) {
        const n = parseInt(p.item, 10);
        if (isFinite(n) && n > siguiente) siguiente = n;
      }
      item = String(siguiente + 1);
    }
    if (byItem.get(item)) throw new Error('Ya existe un producto con el ITEM ' + item + '.');
    const codigo = String(datos.codigo || '').trim();
    if (codigo && byCodigo.get(normCod(codigo))) {
      throw new Error('Ese código de barras ya lo tiene otro producto.');
    }
    const p = {
      item: item, nombre: nombre,
      categoria: String(datos.categoria || '').trim(),
      unidad: String(datos.unidad || 'Unidad').trim(),
      existencia: numOf(datos.existencia), precio: numOf(datos.precio),
      costo: numOf(datos.costo), marca: String(datos.marca || '').trim(),
      codigo: codigo, destacado: false, activo: true, tocadoEn: Date.now(),
    };
    await guardar(COLS.productos, (st) => st.put(p));
    meta.cambioSinPublicar = Date.now();
    await saveMeta();
    await loadAll();
    emitir('alta', { item: item });
    /* Va con `alta: true` para que los demás equipos, que no tienen este
       producto en su archivo, lo puedan crear. El costo NO viaja. */
    _empujar([{
      item: p.item, alta: true, nombre: p.nombre, categoria: p.categoria,
      unidad: p.unidad, existencia: p.existencia, precio: p.precio,
      codigo: p.codigo, marca: p.marca, activo: true,
    }]);
    return p;
  }

  /* Cambiar el código de barras de un producto a mano (por si el escáner da
     otro distinto al del archivo). */
  async function setCodigo(item, codigo) {
    const p = byItem.get(String(item));
    if (!p) return false;
    const c = String(codigo || '').trim();
    const otro = c ? byCodigo.get(normCod(c)) : null;
    if (otro && String(otro.item) !== String(item)) {
      throw new Error('Ese código ya lo tiene: ' + otro.nombre);
    }
    p.codigo = c;
    p.tocadoEn = Date.now();
    await guardar(COLS.productos, (st) => st.put(p));
    meta.cambioSinPublicar = Date.now();
    await saveMeta();
    await loadAll();
    _editado(p);
    emitir('codigo', { item: p.item, codigo: c });
    _empujar([{ item: p.item, codigo: c }]);
    return true;
  }


  /* =============================== PROMOCIONES ==========================
     Una promoción es: el precio de antes (tachado) y hasta cuándo dura.
     El precio que se cobra sigue siendo `precio`; `promoAntes` solo sirve para
     enseñar el descuento. Si la fecha ya pasó, la promoción deja de mostrarse
     sola, sin que nadie tenga que acordarse de quitarla.
     ===================================================================== */
  function hoyISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }

  function enOferta(p) {
    if (!p) return false;
    const antes = numOf(p.promoAntes);
    if (!(antes > 0) || !(numOf(p.precio) > 0) || antes <= numOf(p.precio)) return false;
    if (p.promoHasta && String(p.promoHasta) < hoyISO()) return false;   // ya venció
    return true;
  }

  function descuento(p) {
    if (!enOferta(p)) return 0;
    const antes = numOf(p.promoAntes);
    return Math.round((antes - numOf(p.precio)) / antes * 100);
  }

  /* Pone la promoción. Si no se pasa `antes`, se toma el precio actual como
     precio de antes y el nuevo pasa a ser el de oferta. */
  async function setPromo(item, precioOferta, antes, hasta, empleado) {
    const p = byItem.get(String(item));
    if (!p) return false;
    const oferta = numOf(precioOferta);
    const previo = numOf(antes) > 0 ? numOf(antes) : numOf(p.precio);
    if (!(oferta > 0)) throw new Error('El precio de oferta tiene que ser mayor que cero.');
    if (!(previo > oferta)) throw new Error('El precio de antes tiene que ser MAYOR que el de oferta.');

    if (numOf(p.precio) !== oferta) {
      await actualizarPrecio(item, oferta, empleado || '', 'promoción');
    }
    /* Aquí NO se vuelve a leer el precio del índice. Entre la línea de arriba
       y ésta puede haberse recargado la base (init todavía en marcha, o un
       cambio que llegó de otro equipo), y entonces `byItem` trae objetos
       nuevos leídos del disco —con el precio de ANTES si la escritura de
       `actualizarPrecio` aún no se había confirmado cuando se leyeron—.
       Eso guardaba y compartía la oferta con el precio viejo: promoAntes y
       precio iguales, o sea ninguna oferta. El precio que debe quedar es
       `oferta`, que es el que nos pidieron: se pone y punto. */
    const q = byItem.get(String(item)) || p;
    q.precio = oferta;
    q.promoAntes = previo;
    q.promoHasta = String(hasta || '').trim();
    q.tocadoEn = Date.now();
    await guardar(COLS.productos, (st) => st.put(q));
    meta.cambioSinPublicar = Date.now();
    await saveMeta();
    await loadAll();
    _editado(byItem.get(String(item)));
    emitir('promo', { item: q.item });
    _empujar([{ item: q.item, precio: oferta,
                promoAntes: previo, promoHasta: q.promoHasta }]);
    return true;
  }

  /* Quita la promoción. Si se pide, devuelve el precio al de antes. */
  async function quitarPromo(item, restaurarPrecio, empleado) {
    const p = byItem.get(String(item));
    if (!p) return false;
    const antes = numOf(p.promoAntes);
    if (restaurarPrecio && antes > 0) {
      await actualizarPrecio(item, antes, empleado || '', 'fin de promoción');
    }
    /* Mismo cuidado que en setPromo: el precio que debe quedar se sabe aquí
       —el restaurado, o el que ya tenía—, así que no se vuelve a leer de un
       índice que puede haberse recargado mientras tanto. */
    const q = byItem.get(String(item)) || p;
    const queda = (restaurarPrecio && antes > 0) ? antes : numOf(q.precio);
    q.precio = queda;
    q.promoAntes = 0;
    q.promoHasta = '';
    q.tocadoEn = Date.now();
    await guardar(COLS.productos, (st) => st.put(q));
    meta.cambioSinPublicar = Date.now();
    await saveMeta();
    await loadAll();
    _editado(byItem.get(String(item)));
    emitir('promo', { item: q.item });
    _empujar([{ item: q.item, precio: queda, promoAntes: 0, promoHasta: '' }]);
    return true;
  }

  /* Las promociones puestas. `vencidas:true` incluye las que ya pasaron de
     fecha, para poder limpiarlas. */
  function promociones(opts) {
    opts = opts || {};
    return productos.filter(function (p) {
      const tiene = numOf(p.promoAntes) > 0;
      if (!tiene) return false;
      if (opts.vencidas) return !enOferta(p);
      return enOferta(p);
    }).sort(function (a, b) { return descuento(b) - descuento(a); });
  }

  /* ------------------ ¿Qué falta por publicar al sitio? ------------------
     Los cambios (fotos y precios) viven en este navegador hasta que se
     publican los archivos y se suben al sitio. Esto lo hace visible.        */
  async function marcarPublicado() {
    /* Antes de nada, que salga lo que estaba esperando: si no, se borraría
       del servidor un cambio que todavía no había llegado a él. */
    await _mandarPendiente();
    const corte = new Date().toISOString();
    meta.publicadoEn = Date.now();
    meta.cambioSinPublicar = 0;
    await saveMeta();

    /* El archivo nuevo ya lleva dentro estos cambios, así que en el servidor
       sobran. Se borran los anteriores a este momento; lo que llegue mientras
       se sube el sitio se queda, que si no se perdería. */
    if (invActivo && _claveEnvio()) {
      try {
        const r = await fetch(API_INV, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clave: _claveEnvio(), hasta: corte }),
        });
        const d = await r.json().catch(() => null);
        if (d && d.ok) invEstado = Object.assign({}, invEstado, { count: d.total || 0, error: '' });
      } catch (e) { /* si falla, se limpia en la siguiente publicación */ }
    }

    emitir('publicado');
    return true;
  }

  function pendientes() {
    const desde = meta.publicadoEn || 0;
    let fotos = 0;
    imagenesT.forEach((t, item) => {
      if ((t || 0) <= desde) return;
      if (servidorActivo && fotosServidor.has(String(item))) return; // ya está en línea
      fotos++;
    });
    const precios = cambios.filter((c) => {
      const t = Date.parse(c.fecha || '');
      return isFinite(t) && t > desde;
    }).length;
    const otros = (meta.cambioSinPublicar || 0) > desde ? 1 : 0;
    return {
      fotos, precios, otros,
      total: fotos + precios + otros,
      publicadoEn: meta.publicadoEn || null,
    };
  }

  /* ============== CAMBIOS COMPARTIDOS ENTRE TODOS LOS EQUIPOS ============
     Antes: Carlos corregía un precio en su teléfono y ese precio existía solo
     en su teléfono. Para que llegara al cliente había que generar el archivo
     y volver a subir el sitio.

     Ahora: el cambio se manda a /api/inventario y cualquiera que abra el
     catálogo lo ve. Los archivos publicados siguen siendo la base (rápidos y
     cacheados); esto es solo lo que ha cambiado ENCIMA de esa base.

     Qué NO se manda: la carga del Excel mensual de FelTec, que toca miles de
     productos. Eso es justo el momento de publicar el inventario de nuevo, y
     al publicarlo esto se vacía solo.
     ===================================================================== */

  /* Marca que a este producto lo tocó una persona en ESTE equipo y cuándo.
     Sirve para no dejar que un cambio viejo de otro equipo pise uno nuevo de
     aquí. Se usa `editadoEn` y no `tocadoEn` porque `tocadoEn` también sube
     con solo mirar el producto en el catálogo. */
  function _editado(p) { if (p) p.editadoEn = Date.now(); return p; }

  /* Aplica a un producto lo que venga del servidor. Devuelve true solo si de
     verdad cambió algo, para no escribir en la base sin motivo. */
  const INV_CAMPOS = ['precio', 'promoAntes', 'promoHasta', 'activo', 'activoManual',
                      'bajaMotivo', 'codigo', 'destacado', 'existencia',
                      'nombre', 'categoria', 'unidad', 'marca'];

  async function _aplicarCambioServidor(o) {
    if (!o || !o.item) return false;
    const cuando = Date.parse(o.fecha || '') || 0;
    let p = byItem.get(String(o.item));

    if (!p) {
      if (!o.alta) return false;              // no está y no es un alta: nada que hacer
      p = {
        item: String(o.item), nombre: String(o.nombre || ''),
        categoria: String(o.categoria || ''), unidad: String(o.unidad || 'Unidad'),
        existencia: numOf(o.existencia), precio: numOf(o.precio),
        costo: 0, marca: String(o.marca || ''), codigo: String(o.codigo || ''),
        destacado: false, activo: o.activo !== false, tocadoEn: Date.now(),
      };
      await guardar(COLS.productos, (st) => st.put(p));
      return true;
    }

    // un cambio de aquí más nuevo manda sobre el del servidor
    if (cuando && cuando <= (p.editadoEn || 0)) return false;

    let toco = false;
    for (const k of INV_CAMPOS) {
      if (o[k] === undefined) continue;
      const nuevo = (k === 'precio' || k === 'promoAntes' || k === 'existencia')
        ? numOf(o[k])
        : (k === 'activo' || k === 'activoManual' || k === 'destacado') ? !!o[k] : String(o[k]);
      const actual = (k === 'precio' || k === 'promoAntes' || k === 'existencia')
        ? numOf(p[k])
        : (k === 'activo' || k === 'activoManual' || k === 'destacado') ? (k === 'activo' ? p.activo !== false : !!p[k]) : String(p[k] || '');
      if (nuevo === actual) continue;
      p[k] = nuevo;
      toco = true;
    }
    if (!toco) return false;
    await guardar(COLS.productos, (st) => st.put(p));
    return true;
  }

  /* Se baja lo que hayan cambiado los demás y se aplica encima de la base. */
  async function _bajarCambiosServidor() {
    let d = null;
    try {
      const r = await fetch(API_INV, {
        cache: 'no-store',
        headers: _claveEnvio() ? { 'x-fsj-clave': _claveEnvio() } : {},
      });
      if (!r.ok) { invActivo = false; invComprobado = true; return 0; }
      d = await r.json();
    } catch (e) { invActivo = false; invComprobado = true; return 0; }

    invComprobado = true;
    if (!d || !d.ok || !d.cambios) { invActivo = false; return 0; }
    invActivo = true;
    invEstado = { actualizado: d.actualizado || '', count: d.count || 0,
                  tope: d.tope || 0, error: '' };

    let aplicados = 0;
    for (const k of Object.keys(d.cambios)) {
      try { if (await _aplicarCambioServidor(d.cambios[k])) aplicados++; }
      catch (e) { /* uno malo no tumba el resto */ }
    }
    if (aplicados) { await loadAll(); emitir('sincronizado', { aplicados }); }
    return aplicados;
  }

  /* --------------------------- Mandar los cambios ------------------------
     Si falla (sin internet, clave vencida), el cambio se guarda en una cola
     que sobrevive al cierre del navegador y se reintenta al volver a abrir.
     Nunca se pierde: en el peor caso queda como antes, para publicar a mano. */
  function _colaGuardada() { return Array.isArray(meta.colaEnvio) ? meta.colaEnvio : []; }

  async function _encolar(lista) {
    const cola = _colaGuardada();
    for (const c of lista) {
      const i = cola.findIndex((x) => String(x.item) === String(c.item));
      if (i >= 0) cola[i] = Object.assign({}, cola[i], c);   // el último gana
      else cola.push(c);
    }
    meta.colaEnvio = cola.slice(-1000);
    await saveMeta();
  }

  async function _vaciarCola(items) {
    const fuera = new Set(items.map(String));
    meta.colaEnvio = _colaGuardada().filter((c) => !fuera.has(String(c.item)));
    await saveMeta();
  }

  async function _enviarLote(lista) {
    const r = await fetch(API_INV, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave: _claveEnvio(), cambios: lista }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      const err = (r.status === 401 || r.status === 403) ? 'clave'
                : (r.status === 409) ? 'lleno' : 'red';
      throw Object.assign(new Error(err), { motivo: err, detalle: d });
    }
    return d;
  }

  /* Los cambios no salen uno por uno: se juntan un cuarto de segundo y se
     mandan de una. Poner una promoción, por ejemplo, toca el precio y luego
     la oferta; si salieran por separado podrían cruzarse en el camino y
     llegar en el orden equivocado. Juntándolos sale un solo cambio completo,
     y de paso son menos viajes. */
  let _porMandar = new Map();
  let _reloj = null;
  let _enCurso = Promise.resolve({ enviados: 0 });

  function _empujar(lista) {
    if (!Array.isArray(lista) || !lista.length) return _enCurso;
    for (const c of lista) {
      const k = String(c.item);
      _porMandar.set(k, Object.assign({}, _porMandar.get(k) || {}, c));
    }
    clearTimeout(_reloj);
    _enCurso = new Promise(function (listo) {
      _reloj = setTimeout(function () {
        const juntos = Array.from(_porMandar.values());
        _porMandar = new Map();
        _mandarYa(juntos).then(listo, function () { listo({ enviados: 0, motivo: 'red' }); });
      }, 250);
    });
    return _enCurso;
  }

  /* Manda los cambios. No corta el trabajo de nadie: si no se puede, se
     encola y la persona sigue con lo suyo. */
  async function _mandarYa(lista) {
    if (!Array.isArray(lista) || !lista.length) return { enviados: 0 };
    if (!_claveEnvio()) { await _encolar(lista); return { enviados: 0, motivo: 'sin-clave' }; }
    if (lista.length > INV_MAX_DE_GOLPE) return { enviados: 0, motivo: 'demasiados' };

    let enviados = 0;
    try {
      for (let i = 0; i < lista.length; i += INV_MAX_LOTE) {
        const trozo = lista.slice(i, i + INV_MAX_LOTE);
        const d = await _enviarLote(trozo);
        enviados += (d && d.guardados) || 0;
        if (d) invEstado = { actualizado: d.actualizado || '', count: d.total || 0,
                             tope: invEstado.tope, error: '' };
      }
      invActivo = true;
      await _vaciarCola(lista.map((c) => c.item));
      emitir('sincronizado', { enviados });
      return { enviados };
    } catch (e) {
      invEstado = Object.assign({}, invEstado, { error: e.motivo || 'red' });
      if (e.motivo !== 'lleno') invActivo = (e.motivo === 'clave');
      await _encolar(lista);
      return { enviados, motivo: e.motivo || 'red' };
    }
  }

  /* Se llama al abrir: reintenta lo que quedó pendiente de la vez pasada. */
  async function _reintentarCola() {
    const cola = _colaGuardada();
    if (!cola.length || !_claveEnvio()) return 0;
    const r = await _mandarYa(cola);
    return r.enviados || 0;
  }

  /* Suelta ya lo que esté esperando el cuarto de segundo. */
  async function _mandarPendiente() {
    if (_porMandar.size) {
      clearTimeout(_reloj);
      const juntos = Array.from(_porMandar.values());
      _porMandar = new Map();
      await _mandarYa(juntos).catch(function () {});
    } else {
      await _enCurso.catch(function () {});
    }
  }

  /* Para las pantallas: ¿esto se está compartiendo o no? */
  function estadoSincronizacion() {
    return {
      activo: invActivo,
      /* Mientras esto sea false, la pantalla no debe decir "solo en este
         equipo": todavía se está preguntando. Decirlo antes de tiempo hace
         que alguien crea que tiene que publicar cuando no. */
      comprobado: invComprobado,
      actualizado: invEstado.actualizado,
      enServidor: invEstado.count,
      tope: invEstado.tope,
      pendientes: _colaGuardada().length,
      error: invEstado.error,
      lleno: invEstado.error === 'lleno',
    };
  }

  /* Recoger ahora mismo lo que hayan hecho los demás (botón "actualizar"). */
  async function sincronizar(opciones) {
    const op = opciones || {};
    await _mandarPendiente();      // primero lo de uno, para no pisarlo luego
    await _reintentarCola();

    /* ¿Subieron una base nueva desde otro equipo? Va ANTES de los cambios
       sueltos, porque esos se aplican encima de ella. Al abrir la pantalla
       puede que todavía no hubiera clave; ahora normalmente ya la hay. */
    let base = 0;
    if (op.base !== false) {
      try { base = await _bajarBaseServidor({ publica: !!op.publica }); } catch (e) { base = 0; }
    }
    const n = await _bajarCambiosServidor();
    return { recibidos: n, base, estado: estadoSincronizacion() };
  }

  /* ==================== FOTOS EN EL SERVIDOR (automático) ================
     Si el sitio tiene la función de fotos (Netlify Blobs), las fotos se suben
     solas y se ven en todos los dispositivos sin publicar ni resubir nada.
     Si no está disponible, todo sigue funcionando con el método manual.       */
  function setClaveServidor(c) {
    claveServidor = String(c || '');
    _reintentarBaseConClave();     // ya se puede pedir la base entera del sitio
  }
  function servidorDisponible() { return servidorActivo; }

  /* ---------------------- Clave para subir fotos -------------------------
     La clave de ENTRADA de cada empleado viaja en usuarios.js, que cualquiera
     puede abrir desde el navegador. Por eso subir fotos usa una clave aparte
     (la variable FSJ_CLAVE de Netlify) que NO está en ningún archivo del
     sitio: se escribe una vez en cada equipo y queda guardada aquí.
     Si no se ha configurado ninguna, se sigue usando la del empleado para no
     romper lo que ya funcionaba.                                          */
  function setClaveFotos(c) {
    claveFotos = String(c || '').trim();
    try {
      if (claveFotos) localStorage.setItem(LS_CLAVE_FOTOS, claveFotos);
      else localStorage.removeItem(LS_CLAVE_FOTOS);
    } catch (e) {}
    _reintentarBaseConClave();
    return claveFotos;
  }
  function getClaveFotos() { return claveFotos; }
  function tieneClaveFotos() { return !!claveFotos; }
  function _claveEnvio() { return claveFotos || claveServidor; }

  async function _cargarIndiceServidor() {
    try {
      const r = await fetch(API_FOTOS, { cache: 'no-store' });
      if (!r.ok) return false;
      const d = await r.json();
      if (!d || !Array.isArray(d.items)) return false;
      fotosServidor = new Set(d.items.map(String));
      servidorActivo = true;
      return true;
    } catch (e) { return false; }
  }

  let _ultimoErrorServidor = '';
  // '' = todo bien | 'clave' = la clave de fotos no sirve | 'red' = no se pudo conectar
  function ultimoErrorServidor() { return _ultimoErrorServidor; }

  function _dataUriABlob(dataUri) {
    const [cab, b64] = String(dataUri).split(',');
    const tipo = (/data:([^;]+)/.exec(cab) || [, 'image/jpeg'])[1];
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: tipo });
  }

  // Sube la foto al servidor. Devuelve true si quedó guardada allí.
  async function _subirFotoServidor(item, dataUri) {
    if (!servidorActivo) return false;
    try {
      const tipo = (/^data:([^;,]+)/i.exec(String(dataUri)) || [, 'image/jpeg'])[1];
      const r = await fetch(API_FOTOS + '/' + encodeURIComponent(item), {
        method: 'POST',
        headers: { 'content-type': tipo, 'x-fsj-clave': _claveEnvio() },
        body: _dataUriABlob(dataUri),
      });
      if (!r.ok) { _ultimoErrorServidor = (r.status === 401 || r.status === 403) ? 'clave' : 'red'; return false; }
      _ultimoErrorServidor = '';
      fotosServidor.add(String(item));
      return true;
    } catch (e) { _ultimoErrorServidor = 'red'; return false; }
  }

  async function _borrarFotoServidor(item) {
    if (!servidorActivo) return false;
    try {
      const r = await fetch(API_FOTOS + '/' + encodeURIComponent(item), {
        method: 'DELETE', headers: { 'x-fsj-clave': _claveEnvio() },
      });
      if (r.ok) { fotosServidor.delete(String(item)); return true; }
    } catch (e) {}
    return false;
  }

  // Peso aproximado de las fotos guardadas (para avisar antes de publicar).
  function pesoImagenes() {
    let bytes = 0;
    imagenes.forEach((v) => { bytes += v.length * 0.75; });
    return { fotos: imagenes.size, mb: +(bytes / 1048576).toFixed(1) };
  }
  async function quitarImagen(item) {
    const key = String(item);
    await guardar(COLS.imagenes, (st) => st.delete(key));
    imagenes.delete(key);
    imagenesT.delete(key);
    await _borrarFotoServidor(key);
    meta.cambioSinPublicar = Date.now();
    await saveMeta();
    emitir('imagen', { item: key });
    return true;
  }
  // Devuelve la foto: la local (data URI) o, si no está, la del servidor (URL).
  function getImagen(item) {
    const k = String(item);
    const local = imagenes.get(k);
    if (local) return local;
    if (fotosServidor.has(k)) return API_FOTOS + '/' + encodeURIComponent(k);
    return null;
  }
  function tieneImagen(item) {
    const k = String(item);
    return imagenes.has(k) || fotosServidor.has(k);
  }
  function fotoEnServidor(item) { return fotosServidor.has(String(item)); }

  /* ------------------------ Destacados (showcase) ------------------------ */
  async function setDestacado(item, valor) {
    const p = byItem.get(String(item));
    if (!p) return false;
    p.destacado = !!valor;
    p.tocadoEn = Date.now();
    await guardar(COLS.productos, (st) => st.put(p));
    meta.cambioSinPublicar = Date.now();
    saveMeta();
    _editado(p);
    emitir('destacado', { item: p.item, valor: p.destacado });
    _empujar([{ item: p.item, destacado: p.destacado }]);
    return true;
  }

  /* ------------- Actividad reciente (modificados o vistos) ---------------
     Marca el producto como "tocado" para el showcase del inicio: se apunta
     cuando se cambia el precio, se sube una foto, se destaca o cuando un
     cliente lo abre/agrega en el catálogo.                                 */
  let _pendienteVisto = null;
  async function tocar(item) {
    const p = byItem.get(String(item));
    if (!p) return false;
    p.tocadoEn = Date.now();
    try { await guardar(COLS.productos, (st) => st.put(p)); } catch (e) { return false; }
    return true;
  }
  // Versión ligera para el catálogo público: agrupa las escrituras.
  function marcarVisto(item) {
    const p = byItem.get(String(item));
    if (!p) return;
    p.tocadoEn = Date.now();
    clearTimeout(_pendienteVisto);
    _pendienteVisto = setTimeout(function () {
      try { store(COLS.productos, 'readwrite').put(p); } catch (e) {}
    }, 400);
  }

  /* ============ ETIQUETAS: QUÉ SE IMPRIMIÓ Y CON QUÉ PRECIO =============
     El problema de verdad no es imprimir, es saber a QUÉ le falta etiqueta.
     Un producto puede estar en la góndola con un precio viejo pegado y nadie
     se entera hasta que un cliente reclama en caja.

     Se guardan dos cosas por producto: cuándo se imprimió su etiqueta y con
     qué precio salió. Comparando ese precio con el de hoy se sabe si la que
     está pegada sirve o hay que cambiarla.                                 */
  function estadoEtiqueta(p) {
    if (!p) return { estado: 'nunca', desde: 0, precio: 0 };
    const cuando = Number(p.etiquetaEn) || 0;
    if (!cuando) return { estado: 'nunca', desde: 0, precio: 0 };
    const impreso = numOf(p.etiquetaPrecio);
    const ahora = numOf(p.precio);
    /* Se comparan en centavos: 3.4 y 3.40 son el mismo precio. */
    if (Math.round(impreso * 100) !== Math.round(ahora * 100)) {
      return { estado: 'desfasada', desde: cuando, precio: impreso, ahora: ahora };
    }
    return { estado: 'ok', desde: cuando, precio: impreso };
  }

  /* Se llama al imprimir o exportar: deja constancia de con qué precio salió
     cada etiqueta. Si se imprime y no se marca, esto no sirve de nada. */
  async function marcarEtiqueta(items) {
    const lista = Array.isArray(items) ? items : [items];
    const tocados = [], paraCompartir = [];
    for (const it of lista) {
      const p = byItem.get(String(it && it.item != null ? it.item : it));
      if (!p) continue;
      p.etiquetaEn = Date.now();
      p.etiquetaPrecio = numOf(p.precio);
      await guardar(COLS.productos, (st) => st.put(p));
      tocados.push(p.item);
      paraCompartir.push({ item: p.item, etiquetaEn: p.etiquetaEn, etiquetaPrecio: p.etiquetaPrecio });
    }
    if (paraCompartir.length) {
      await loadAll();
      /* Se comparte para que no se reimprima en otro equipo lo que aquí ya se
         imprimió. Si el servidor todavía no conoce estos campos, los descarta
         y no pasa nada: cada equipo conserva los suyos. */
      _empujar(paraCompartir);
      emitir('etiqueta', { items: tocados });
    }
    return tocados.length;
  }

  /* A qué le falta etiqueta. `motivo`: 'nunca' | 'desfasada' | 'todos'. */
  function sinEtiqueta(q, limite, motivo) {
    const cual = motivo || 'todos';
    const texto = String(q || '').trim();
    const out = [];
    for (const p of productos) {
      if (p.activo === false) continue;
      if (!(numOf(p.precio) > 0)) continue;          // sin precio no hay etiqueta que poner
      const e = estadoEtiqueta(p);
      if (e.estado === 'ok') continue;
      if (cual !== 'todos' && e.estado !== cual) continue;
      out.push(Object.assign({}, p, { _etiqueta: e }));
    }
    const lista = texto ? _filtrarTexto(out, texto) : out;
    /* Primero las desfasadas: esas están MAL pegadas, no solo ausentes. */
    lista.sort((a, b) => {
      if (a._etiqueta.estado !== b._etiqueta.estado) return a._etiqueta.estado === 'desfasada' ? -1 : 1;
      return numOf(b.existencia) - numOf(a.existencia);
    });
    return lista.slice(0, limite || 200);
  }

  function _filtrarTexto(lista, q) {
    const pal = _sinAcentos(q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!pal.length) return lista;
    return lista.filter((p) => {
      const t = _sinAcentos((p.nombre || '') + ' ' + p.item + ' ' + (p.categoria || '') +
                            ' ' + (p.codigo || '') + ' ' + (p.marca || '')).toLowerCase();
      return pal.every((x) => t.indexOf(x) >= 0);
    });
  }

  /* ==================== PROVEEDORES (por marca) =========================
     El reporte de FelTec no trae proveedor: trae ITEM, producto, categoría,
     existencias y precios, y nada más. Pero en la práctica cada marca se le
     compra a alguien, así que el pedido se puede partir por proveedor con
     una tabla marca -> proveedor que se llena una vez y se corrige cuando
     cambia. Vive en este equipo; se puede exportar e importar.            */
  function proveedores() { return Object.assign({}, meta.proveedores || {}); }

  async function setProveedorDeMarca(marca, proveedor) {
    const m = upper(marca);
    if (!m) return false;
    const mapa = Object.assign({}, meta.proveedores || {});
    const v = String(proveedor || '').trim();
    if (v) mapa[m] = v; else delete mapa[m];
    meta.proveedores = mapa;
    await saveMeta();
    emitir('proveedores', { marca: m, proveedor: v });
    return true;
  }

  async function setProveedores(mapa) {
    const limpio = {};
    for (const k of Object.keys(mapa || {})) {
      const m = upper(k), v = String(mapa[k] || '').trim();
      if (m && v) limpio[m] = v;
    }
    meta.proveedores = limpio;
    await saveMeta();
    emitir('proveedores', { total: Object.keys(limpio).length });
    return Object.keys(limpio).length;
  }

  const SIN_PROVEEDOR = '(sin proveedor asignado)';
  function proveedorDeMarca(marca) {
    const m = upper(marca);
    return (meta.proveedores && meta.proveedores[m]) || SIN_PROVEEDOR;
  }

  // Los N productos más recientes (modificados o vistos) para el showcase.
  function recientes(n) {
    const lim = n || 15;
    const conPrecio = productos.filter((p) => numOf(p.precio) > 0);
    const tocados = conPrecio.filter((p) => p.tocadoEn).sort((a, b) => b.tocadoEn - a.tocadoEn);
    const resto = conPrecio.filter((p) => !p.tocadoEn).sort((a, b) => {
      // sin actividad: primero destacados y con foto, luego con existencia
      const d = (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0); if (d) return d;
      // igual que arriba: cuentan las fotos del sitio, no solo las de este equipo
      const i = (tieneImagen(b.item) ? 1 : 0) - (tieneImagen(a.item) ? 1 : 0); if (i) return i;
      return numOf(b.existencia) - numOf(a.existencia);
    });
    return tocados.concat(resto).slice(0, lim);
  }

  /* ------------------------- Historial de precios ------------------------ */
  function historial(filtro) {
    let list = cambios.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    const q = String(filtro || '').trim().toLowerCase();
    if (q) list = list.filter((c) => String(c.nombre).toLowerCase().includes(q) || String(c.item) === q);
    return list;
  }

  async function limpiarCambios() {
    const st = store(COLS.cambios, 'readwrite');
    st.clear();
    await txDone(st.transaction);
    cambios = [];
  }

  /* ----------------------- Publicar / exportar --------------------------- */
  function _download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Genera inventario-data.json (para publicar en el sitio y compartir a todos).
  /* El sitio es estático: TODO archivo que se publica es público, aunque solo
     lo lea el panel. Por eso el COSTO DE COMPRA no se escribe en ninguno de los
     dos: con costo y precio a la vista, cualquiera calcula el margen del
     negocio. El costo vive en el navegador de cada equipo y entra por el Excel.

     Se publican dos archivos:
       inventario-data.json -> base del panel (todos los productos, sin costos)
       catalogo-data.json   -> lo que baja el cliente: solo los productos que
                               puede ver y solo los campos que se enseñan       */
  function publicar() {
    const data = {
      generatedAt: new Date().toISOString(),
      count: productos.length,
      productos: productos.map((p) => ({
        item: p.item, nombre: p.nombre, categoria: p.categoria,
        unidad: p.unidad, existencia: p.existencia, precio: p.precio, codigo: p.codigo || '',
        marca: p.marca || '',
        promoAntes: p.promoAntes || 0, promoHasta: p.promoHasta || '',
        destacado: !!p.destacado, activo: p.activo !== false,
        bajaMotivo: p.bajaMotivo || '', activoManual: !!p.activoManual,
        tocadoEn: p.tocadoEn || 0,
        etiquetaEn: p.etiquetaEn || 0, etiquetaPrecio: p.etiquetaPrecio || 0,
      })),
    };
    _download('inventario-data.json', JSON.stringify(data), 'application/json');
    return data.count;
  }

  /* Archivo del catálogo: solo lo que el cliente puede llegar a ver. Quita los
     dados de baja (más de 4.000) y los campos internos. Baja de unos 3 MB a
     poco más de 1, que en datos móviles es la diferencia entre esperar y
     cerrar la página. */
  function publicarCatalogo() {
    const vis = productos.filter((p) => p.activo !== false);
    const data = {
      generatedAt: new Date().toISOString(),
      count: vis.length,
      productos: vis.map((p) => {
        const o = {
          item: p.item, nombre: p.nombre, categoria: p.categoria,
          unidad: p.unidad, existencia: p.existencia, precio: p.precio,
          codigo: p.codigo || '',
        };
        if (p.marca) o.marca = p.marca;
        if (p.destacado) o.destacado = true;
        if (numOf(p.promoAntes) > 0) { o.promoAntes = numOf(p.promoAntes); o.promoHasta = p.promoHasta || ''; }
        return o;
      }),
    };
    _download('catalogo-data.json', JSON.stringify(data), 'application/json');
    return data.count;
  }

  /* ================= LA BASE, GUARDADA EN EL SITIO ======================
     Los cambios sueltos (un precio, una oferta) ya se comparten solos. Lo
     que seguía atando a los archivos era la carga del Excel mensual: toca
     miles de productos y obligaba a descargar dos .json y volver a subir el
     sitio entero.

     Con esto la base entera se guarda en el sitio (/api/base) y los demás
     equipos la recogen solos. Los .json publicados se quedan de respaldo: si
     el servidor no estuviera, todo sigue funcionando con ellos.

     Va POR PARTES porque son 11.267 productos (unos 3 MB) y de un golpe no
     pasa. El servidor solo la da por buena cuando llegaron TODAS: si se corta
     el internet a la mitad, no queda una base coja, simplemente no cambia
     nada y se vuelve a intentar.                                          */
  const API_BASE = '/api/base';
  const BASE_POR_PARTE = 2000;
  let baseEstado = { comprobado: false, disponible: false, hay: false,
                     generatedAt: '', por: '', count: 0, error: '' };

  function estadoBaseServidor() { return Object.assign({}, baseEstado); }

  async function _metaBaseServidor() {
    try {
      const r = await fetch(API_BASE, { cache: 'no-store' });
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      baseEstado = {
        comprobado: true, disponible: d.disponible !== false,
        hay: !!d.hay, generatedAt: d.generatedAt || '', por: d.por || '',
        count: d.count || 0, partes: d.partes || 0, subida: d.subida || '', error: '',
      };
      return baseEstado.disponible ? d : null;
    } catch (e) {
      baseEstado = Object.assign({}, baseEstado, { comprobado: true, disponible: false, error: 'red' });
      return null;
    }
  }

  /* Trae la base del sitio y la deja como base de este equipo.
     `publica` = la versión del cliente (sin dados de baja, sin campos
     internos); es la única que se puede pedir sin clave.                   */
  let _bajandoBase = null;          // una a la vez: reescribe la base entera
  let _baseFaltaClave = false;      // se saltó porque todavía no había clave
  let _arranque = null;             // lo que está haciendo init()

  async function _bajarBaseServidor(opciones) {
    if (_bajandoBase) { try { await _bajandoBase; } catch (e) {} }
    _bajandoBase = _bajarBaseServidorYa(opciones || {});
    try { return await _bajandoBase; } finally { _bajandoBase = null; }
  }

  /* Al abrir una pantalla del panel todavía no hay clave: el empleado no ha
     escrito la suya. Sin clave no se puede pedir la base del panel, así que se
     carga el archivo publicado y queda apuntado que faltó. En cuanto entra, se
     vuelve a intentar y se queda con la del sitio si es más nueva. */
  function _reintentarBaseConClave() {
    if (!_baseFaltaClave || !_claveEnvio()) return;
    _baseFaltaClave = false;
    Promise.resolve(_arranque).catch(() => {})
      .then(() => _bajarBaseServidor())
      .then((n) => { if (n) emitir('sincronizado', { origen: 'base', count: n }); })
      .catch(() => { _baseFaltaClave = true; });
  }

  async function _bajarBaseServidorYa(opciones) {
    const op = opciones || {};
    const d = op.meta || await _metaBaseServidor();
    if (!d || !d.hay) return 0;

    const nueva = d.generatedAt || '';
    /* Si aquí solo está la base del cliente (le faltan los dados de baja), el
       panel pide la completa aunque la fecha diga que está al día. */
    const cojo = !op.publica && !!meta.baselineParcial;
    if (!op.forzar && !cojo && productos.length && !(nueva && nueva > (meta.baselineAt || ''))) return 0;

    const clave = _claveEnvio();
    const full = !op.publica && !!clave;
    /* Sin clave no se puede pedir la base del panel, y la del cliente no
       sirve para el panel: le faltan los dados de baja. Mejor quedarse con el
       archivo publicado que cargar media base — y volver por ella cuando el
       empleado entre. */
    if (!full && !op.publica) { _baseFaltaClave = true; return 0; }

    const partes = full ? (d.partes || 0) : (d.partesCatalogo || d.partes || 0);
    if (!partes) return 0;

    const todos = [];
    for (let i = 0; i < partes; i++) {
      const cab = full ? { 'x-fsj-clave': clave } : undefined;
      const r = await fetch(API_BASE + '?parte=' + i + (full ? '&full=1' : ''), { headers: cab });
      if (!r.ok) throw new Error('no llegó la parte ' + i + ' (' + r.status + ')');
      const t = await r.json();
      if (!t.ok || !Array.isArray(t.productos)) throw new Error('parte ' + i + ' vino mal');
      for (const p of t.productos) todos.push(p);
      if (typeof op.onPaso === 'function') op.onPaso({ parte: i + 1, partes, recibidos: todos.length });
    }
    if (!todos.length) return 0;

    const n = await importarBaseline({ generatedAt: nueva, count: todos.length, productos: todos },
                                      { parcial: !full });
    emitir('base-del-servidor', { count: n, generatedAt: nueva, por: d.por || '' });
    return n;
  }

  function _marcaDeSubida() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async function _postBase(cuerpo, intentos) {
    let ultimo = null;
    for (let i = 0; i < (intentos || 3); i++) {
      try {
        const r = await fetch(API_BASE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(cuerpo),
        });
        const d = await r.json().catch(() => null);
        if (r.ok && d && d.ok) return d;
        /* Clave mala o trozo rechazado: reintentar no arregla nada. */
        if (r.status === 401 || r.status === 400 || r.status === 413) {
          const e = new Error((d && d.error) || ('http ' + r.status));
          e.motivo = r.status === 401 ? 'clave' : 'rechazado';
          throw e;
        }
        ultimo = new Error((d && d.error) || ('http ' + r.status));
        ultimo.motivo = r.status === 409 ? 'incompleta' : 'servidor';
      } catch (e) {
        if (e.motivo === 'clave' || e.motivo === 'rechazado') throw e;
        ultimo = e;
        if (!ultimo.motivo) ultimo.motivo = 'red';
      }
      await new Promise((res) => setTimeout(res, 600 * (i + 1)));
    }
    throw ultimo || new Error('no se pudo guardar');
  }

  /* Sube la base entera. Devuelve { ok, count, partes } o { ok:false, motivo }.
     Mientras sube, los demás siguen viendo la base anterior COMPLETA; solo al
     final se cambia, de golpe.                                             */
  async function guardarBaseEnServidor(onPaso) {
    if (!_claveEnvio()) return { ok: false, motivo: 'sin-clave' };
    if (!productos.length) return { ok: false, motivo: 'sin-datos' };

    const d = await _metaBaseServidor();
    if (!baseEstado.disponible && !d) return { ok: false, motivo: 'sin-servidor' };

    const lista = productos.map((p) => ({
      item: p.item, nombre: p.nombre, categoria: p.categoria,
      unidad: p.unidad, existencia: p.existencia, precio: p.precio, codigo: p.codigo || '',
      marca: p.marca || '',
      promoAntes: p.promoAntes || 0, promoHasta: p.promoHasta || '',
      destacado: !!p.destacado, activo: p.activo !== false,
      bajaMotivo: p.bajaMotivo || '', activoManual: !!p.activoManual,
      tocadoEn: p.tocadoEn || 0,
      etiquetaEn: p.etiquetaEn || 0, etiquetaPrecio: p.etiquetaPrecio || 0,
    }));
    /* El costo de compra NO va: la parte del catálogo se sirve sin clave. */

    const subida = _marcaDeSubida();
    const generatedAt = new Date().toISOString();
    const partes = Math.ceil(lista.length / BASE_POR_PARTE);
    let countCatalogo = 0;

    try {
      for (let i = 0; i < partes; i++) {
        if (typeof onPaso === 'function') {
          onPaso({ fase: 'subiendo', parte: i + 1, partes, enviados: i * BASE_POR_PARTE, total: lista.length });
        }
        const r = await _postBase({
          clave: _claveEnvio(), subida, parte: i,
          productos: lista.slice(i * BASE_POR_PARTE, (i + 1) * BASE_POR_PARTE),
        });
        countCatalogo += r.delCatalogo || 0;
      }
      if (typeof onPaso === 'function') onPaso({ fase: 'cerrando', parte: partes, partes, enviados: lista.length, total: lista.length });
      const fin = await _postBase({
        clave: _claveEnvio(), subida, cerrar: true, partes,
        count: lista.length, countCatalogo, generatedAt,
      });

      meta.baselineAt = generatedAt;
      await saveMeta();
      /* Los cambios sueltos anteriores ya están dentro de esta base: sobran
         en el servidor. `marcarPublicado` los borra y apaga el aviso de
         "pendiente de publicar". */
      await marcarPublicado();
      await _metaBaseServidor();
      return { ok: true, count: lista.length, countCatalogo, partes, subida, meta: fin.meta };
    } catch (e) {
      /* No se llamó a `cerrar` (o falló): el sitio sigue con la base de antes,
         entera. No hay nada que deshacer. */
      return { ok: false, motivo: e.motivo || 'red', error: String(e.message || e) };
    }
  }

  /* Genera showcase-data.json: los 15 productos más recientes (modificados o
     vistos) con miniaturas pequeñas, para que la página de inicio cargue
     rápido sin descargar todo el inventario.                               */
  function _miniatura(dataUri, lado) {
    return new Promise((res) => {
      const img = new Image();
      img.onerror = () => res(null);
      img.onload = () => {
        const max = lado || 320;
        let w = img.width, h = img.height;
        if (w > max || h > max) { const s = Math.min(max / w, max / h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        res(c.toDataURL('image/jpeg', 0.7));
      };
      img.src = dataUri;
    });
  }

  async function publicarShowcase(n) {
    const list = recientes(n || 15);
    const out = [];
    for (const p of list) {
      const full = imagenes.get(String(p.item));
      const mini = full ? await _miniatura(full, 320) : null;
      out.push({
        item: p.item, nombre: p.nombre, categoria: p.categoria, unidad: p.unidad,
        precio: numOf(p.precio), existencia: numOf(p.existencia), destacado: !!p.destacado,
        foto: mini || '',
      });
    }
    const data = { generatedAt: new Date().toISOString(), count: out.length, productos: out };
    const json = JSON.stringify(data);
    _download('showcase-data.json', json, 'application/json');
    return { count: out.length, kb: Math.round(json.length / 1024) };
  }

  // Genera imagenes-data.json (fotos de producto) para publicar en el sitio.
  function publicarImagenes() {
    const obj = {};
    imagenes.forEach((v, k) => { obj[k] = v; });
    const data = { generatedAt: new Date().toISOString(), count: imagenes.size, imagenes: obj };
    _download('imagenes-data.json', JSON.stringify(data), 'application/json');
    return imagenes.size;
  }

  function _csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportarCambios() {
    if (!cambios.length) return 0;
    const head = ['ITEM', 'PRODUCTO', 'PRECIO ANTERIOR', 'PRECIO NUEVO', 'FECHA', 'EMPLEADO'];
    const lines = [head.join(',')];
    for (const c of cambios) {
      lines.push([c.item, _csvCell(c.nombre), c.anterior.toFixed(2), c.nuevo.toFixed(2), c.fecha, _csvCell(c.empleado)].join(','));
    }
    _download('cambios-de-precio.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
    return cambios.length;
  }

  /* ------------------------------ Estado --------------------------------- */
  function stats() {
    let conCodigo = 0, conPrecio = 0, destacados = 0;
    for (const p of productos) { if (p.codigo) conCodigo++; if (p.precio > 0) conPrecio++; if (p.destacado) destacados++; }
    return {
      total: productos.length, conCodigo, conPrecio, destacados,
      conImagen: new Set([...imagenes.keys(), ...fotosServidor]).size,
      fotosEnServidor: fotosServidor.size,
      servidorFotos: servidorActivo,
      cambios: cambios.length, lastUpload: meta.lastUpload, baselineAt: meta.baselineAt,
    };
  }
  const disponible = () => productos.length > 0;

  /* ---------------------- Consultas para el catálogo --------------------- */
  // Productos visibles en el catálogo público: con precio (y existencia si se pide).
  function catalogo(opts) {
    opts = opts || {};
    /* Se muestran los productos con precio y, además, los que no tienen precio
       pero sí foto o están destacados: si alguien se tomó el trabajo de
       prepararlos, deben verse (con "Consultar precio") en vez de desaparecer. */
    let list = productos.filter((p) => {
      if (p.activo === false) return false;         // dado de baja: no se muestra
      if (numOf(p.precio) > 0) return true;
      const k = String(p.item);
      return (imagenes.has(k) || fotosServidor.has(k) || p.destacado) && numOf(p.existencia) > 0;
    });
    if (opts.soloConExistencia) list = list.filter((p) => numOf(p.existencia) > 0);
    if (opts.categoria) list = list.filter((p) => p.categoria === opts.categoria);
    if (opts.soloDestacados) list = list.filter((p) => p.destacado);
    const q = String(opts.q || '').trim().toLowerCase();
    if (q) {
      const toks = q.split(/\s+/).filter(Boolean);
      list = list.filter((p) => {
        const n = p.nombre.toLowerCase();
        return toks.every((t) => n.includes(t)) || String(p.item) === q || (p.codigo || '').toLowerCase() === q;
      });
    }
    /* OJO: tieneImagen(), no imagenes.has(). La mayoría de las fotos están
       en el sitio (Netlify) y este equipo solo conoce la lista, no el
       archivo. Mirando solo lo local, «Solo con foto» no devolvía nada
       aunque el contador de arriba dijera que hay decenas. */
    if (opts.soloConImagen) list = list.filter((p) => tieneImagen(p.item));
    // Orden: destacados primero, luego los que tienen foto, luego por nombre
    list.sort((a, b) => {
      const d = (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0);
      if (d) return d;
      const i = (tieneImagen(b.item) ? 1 : 0) - (tieneImagen(a.item) ? 1 : 0);
      if (i) return i;
      const pr = (numOf(b.precio) > 0 ? 1 : 0) - (numOf(a.precio) > 0 ? 1 : 0);
      if (pr) return pr;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
    return list;
  }

  /* Productos con existencia a los que les falta el precio.
     Son los que el catálogo muestra como "Consultar precio" (o que ni siquiera
     salen, si tampoco tienen foto ni están destacados). Sirve para encontrarlos
     y ponerles precio de una vez. */
  function sinPrecio(q, limite) {
    const lim = limite || 200;
    const ql = String(q || '').trim().toLowerCase();
    const toks = ql.split(/\s+/).filter(Boolean);
    const list = productos.filter((p) => {
      if (numOf(p.precio) > 0) return false;
      if (numOf(p.existencia) <= 0) return false;
      if (!toks.length) return true;
      const n = p.nombre.toLowerCase();
      return toks.every((t) => n.includes(t)) || String(p.item) === ql || (p.codigo || '').toLowerCase() === ql;
    });
    // primero los que ya tienen foto o destacado (ya se están mostrando al cliente)
    list.sort((a, b) => {
      const v = ((tieneImagen(b.item) || b.destacado) ? 1 : 0) - ((tieneImagen(a.item) || a.destacado) ? 1 : 0);
      if (v) return v;
      const e = numOf(b.existencia) - numOf(a.existencia);
      if (e) return e;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
    return list.slice(0, lim);
  }

  function categorias() {
    const m = new Map();
    for (const p of productos) {
      const k = String(p.item);
      const visible = numOf(p.precio) > 0 ||
        ((imagenes.has(k) || fotosServidor.has(k) || p.destacado) && numOf(p.existencia) > 0);
      if (!visible) continue;
      const c = p.categoria || 'Otros';
      m.set(c, (m.get(c) || 0) + 1);
    }
    return [...m.entries()].map(([nombre, count]) => ({ nombre, count }))
      .sort((a, b) => b.count - a.count || a.nombre.localeCompare(b.nombre, 'es'));
  }

  /* ------------------------------- Init ---------------------------------- */
  function init(baselineUrls, opciones) {
    /* Se guarda en marcha: si el empleado entra mientras esto todavía carga,
       la base del sitio se pide DESPUÉS, no encima. */
    _arranque = _init(baselineUrls, opciones);
    return _arranque;
  }

  async function _init(baselineUrls, opciones) {
    const op = opciones || {};
    await openDB();
    await loadAll();

    /* Primero, la base guardada EN EL SITIO: es la que puede ser más nueva
       que los archivos publicados, porque no hace falta publicar para
       cambiarla. Si no está disponible se sigue con los .json de siempre. */
    let delServidor = 0;
    if (op.baseServidor !== false) {
      try { delServidor = await _bajarBaseServidor({ publica: !!op.publica }); }
      catch (e) { delServidor = 0; }
    }

    // Carga la base publicada del sitio si no hay datos locales, o si la base
    // publicada es más nueva que la que ya tenemos (actualización automática).
    const urls = delServidor ? [] : (baselineUrls || ['./inventario-data.json', '../inventario-data.json']);
    for (const url of urls) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) continue;
        const d = await r.json();
        const baseAt = d.generatedAt || '';
        /* `parcial` cuando lo que se está cargando es el archivo del cliente:
           no trae los dados de baja, y borrarlos aquí dejaría al panel sin
           ellos hasta el próximo Excel. */
        const parcial = !!op.publica && /catalogo-data\.json$/.test(url);
        /* Ojo: aquí NO se fuerza nada. El archivo publicado es viejo por
           definición; volver a cargarlo "por si acaso" pisaría las ofertas y
           los precios que se acaban de tocar en este equipo. Solo la base del
           sitio, que sí está al día, se pide de más. */
        if (!productos.length || (baseAt && baseAt > (meta.baselineAt || ''))) {
          await importarBaseline(d, { parcial });
        }
        break;
      } catch (e) { /* no disponible */ }
    }
    // ¿Hay servidor de fotos? (Netlify) — si sí, las fotos son automáticas
    await _cargarIndiceServidor();

    /* Lo que hayan cambiado los demás desde que se publicó el archivo. Va
       después de la base, porque se aplica ENCIMA de ella. Si no hay servidor
       no pasa nada: se sigue trabajando con lo que hay en el equipo. */
    await _bajarCambiosServidor();
    /* Y lo que quedó pendiente de mandar la última vez (sin internet, o con la
       sesión cerrada). Sin esperar: no hay por qué retrasar la pantalla. */
    _reintentarCola();

    /* Fotos publicadas dentro de un archivo (no pisan las locales del equipo).
       Es el método viejo, de cuando no había servidor de fotos. Si el servidor
       está activo ese archivo sobra, y pedirlo solo deja un 404 en la consola
       de cada página. Se busca únicamente cuando hace falta de verdad. */
    for (const url of (servidorActivo ? [] : ['./imagenes-data.json', '../imagenes-data.json'])) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) continue;
        const d = await r.json();
        if (d && d.imagenes) {
          const st = store(COLS.imagenes, 'readwrite');
          let n = 0;
          for (const k of Object.keys(d.imagenes)) {
            if (imagenes.has(String(k))) continue;      // conserva la local
            st.put({ item: String(k), data: d.imagenes[k] });
            imagenes.set(String(k), d.imagenes[k]);
            n++;
          }
          if (n) await txDone(st.transaction);
        }
        break;
      } catch (e) { /* no disponible */ }
    }
    return stats();
  }

  return {
    init, importarExcel, importarBaseline,
    analizarArchivo, aplicarAnalisis,
    buscar, porCodigo, porItem, codigoEfectivo,
    asignarCodigo, actualizarPrecio,
    guardarImagen, quitarImagen, getImagen, tieneImagen, pesoImagenes,
    setClaveServidor, servidorDisponible, fotoEnServidor,
    sincronizar, estadoSincronizacion,
    setClaveFotos, getClaveFotos, tieneClaveFotos, ultimoErrorServidor,
    guardarBaseEnServidor, estadoBaseServidor, bajarBaseServidor: _bajarBaseServidor,
    estadoEtiqueta, marcarEtiqueta, sinEtiqueta,
    proveedores, setProveedorDeMarca, setProveedores, proveedorDeMarca, SIN_PROVEEDOR,
    setDestacado, historial, catalogo, categorias, sinPrecio, recientes, tocar, marcarVisto,
    analizarConteo, aplicarConteo, setActivo, deBaja, altaProducto, setCodigo,
    setPromo, quitarPromo, promociones, enOferta, descuento,
    publicar, publicarCatalogo, publicarImagenes, publicarShowcase, exportarCambios, limpiarCambios,
    marcarPublicado, pendientes,
    stats, disponible, onCambio,
    get cambios() { return cambios.slice(); },
  };
})();
