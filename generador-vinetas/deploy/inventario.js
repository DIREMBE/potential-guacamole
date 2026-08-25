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
  let meta = { lastUpload: null, count: 0, baselineAt: null };
  const listeners = [];          // avisos de cambios (para refrescar la vista)

  /* ----------------------------- Utilidades ------------------------------ */
  const normCod = (c) => String(c == null ? '' : c).trim();
  const upper = (s) => String(s == null ? '' : s).trim().toUpperCase();
  const numOf = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function txDone(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }
  function store(name, mode) { return db.transaction(name, mode || 'readonly').objectStore(name); }

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

  async function saveMeta() { await reqP(store(COLS.meta, 'readwrite').put({ k: 'meta', v: meta })); }

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
    let count = 0, sinPrecio = 0;
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
      st.put({
        item,
        nombre: String(row[col.nombre] == null ? '' : row[col.nombre]).trim(),
        categoria: col.categoria >= 0 ? String(row[col.categoria] || '').trim() : '',
        unidad: col.unidad >= 0 ? String(row[col.unidad] || '').trim() : '',
        existencia: numOf(row[col.existencia]),
        precio,
        codigo,
        costo: col.costo >= 0 ? numOf(row[col.costo]) : (ant ? numOf(ant.costo) : 0),
        marca: ant ? String(ant.marca || '') : '',
        destacado: prevDest.has(item),
        activo: ant ? ant.activo !== false : true,
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
    return { count, sinPrecio, preciosConservados: conservados };
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

    for (const p of productos) {
      const item = String(p.item);
      const f = enArchivo.get(item);
      if (!f) {
        if (sel.quitarFaltantes) { st.delete(item); quitados++; }
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
    return { actualizados, agregados, quitados };
  }

  /* ------------------- Cargar base publicada (JSON) ---------------------- */
  async function importarBaseline(data) {
    if (!data || !Array.isArray(data.productos)) return 0;

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
    st.clear();
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
        activo: p.activo !== undefined ? !!p.activo : (ant ? ant.activo !== false : true),
        tocadoEn: Number(p.tocadoEn) || (ant ? Number(ant.tocadoEn) || 0 : 0),
      });
      count++;
    }
    await txDone(st.transaction);
    if (preciosConservados) {
      try { console.info('[Inventario] se conservaron ' + preciosConservados + ' precio(s) editados en este equipo'); } catch (e) {}
    }
    meta.lastUpload = data.generatedAt || new Date().toISOString();
    meta.baselineAt = data.generatedAt || null;
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
    await reqP(store(COLS.productos, 'readwrite').put(p));
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
    await reqP(store(COLS.productos, 'readwrite').put(p));
    const entry = {
      item: p.item, nombre: p.nombre, anterior, nuevo,
      fecha: new Date().toISOString(), empleado: empleado || '', origen: origen || 'viñetas',
    };
    await reqP(store(COLS.cambios, 'readwrite').add(entry));
    cambios.push(entry);
    emitir('precio', { item: p.item, nuevo });
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
      await reqP(store(COLS.imagenes, 'readwrite').put({ item: key, data, t: Date.now() }));
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
    const st = store(COLS.productos, 'readwrite');

    if (ponerCodigos) {
      for (const r of (analisis.conCodigo || [])) {
        const p = byItem.get(String(r.item));
        if (!p) continue;
        let toco = false;
        if (r.codigo && p.codigo !== r.codigo) { p.codigo = r.codigo; codigos++; toco = true; }
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
    return { codigos: codigos, costos: costos, altas: altas };
  }

  /* ---------------------- Dar de baja / de alta -------------------------
     Nunca se borra un producto: se marca de baja. Así conserva su foto, su
     historial de precios y su código, y se puede volver a activar. */
  async function setActivo(item, activo) {
    const p = byItem.get(String(item));
    if (!p) return false;
    p.activo = !!activo;
    p.tocadoEn = Date.now();
    await reqP(store(COLS.productos, 'readwrite').put(p));
    meta.cambioSinPublicar = Date.now();
    await saveMeta();
    emitir('activo', { item: p.item, activo: p.activo });
    return true;
  }
  function esActivo(p) { return !p || p.activo !== false; }
  function deBaja(q, limite) {
    const ql = String(q || '').trim().toLowerCase();
    return productos.filter(function (p) {
      if (p.activo !== false) return false;
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
    await reqP(store(COLS.productos, 'readwrite').put(p));
    meta.cambioSinPublicar = Date.now();
    await saveMeta();
    await loadAll();
    emitir('alta', { item: item });
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
    await reqP(store(COLS.productos, 'readwrite').put(p));
    meta.cambioSinPublicar = Date.now();
    await saveMeta();
    await loadAll();
    emitir('codigo', { item: p.item, codigo: c });
    return true;
  }

  /* ------------------ ¿Qué falta por publicar al sitio? ------------------
     Los cambios (fotos y precios) viven en este navegador hasta que se
     publican los archivos y se suben al sitio. Esto lo hace visible.        */
  async function marcarPublicado() {
    meta.publicadoEn = Date.now();
    meta.cambioSinPublicar = 0;
    await saveMeta();
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

  /* ==================== FOTOS EN EL SERVIDOR (automático) ================
     Si el sitio tiene la función de fotos (Netlify Blobs), las fotos se suben
     solas y se ven en todos los dispositivos sin publicar ni resubir nada.
     Si no está disponible, todo sigue funcionando con el método manual.       */
  function setClaveServidor(c) { claveServidor = String(c || ''); }
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
      const r = await fetch(API_FOTOS + '/' + encodeURIComponent(item), {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg', 'x-fsj-clave': _claveEnvio() },
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
    await reqP(store(COLS.imagenes, 'readwrite').delete(key));
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
    await reqP(store(COLS.productos, 'readwrite').put(p));
    meta.cambioSinPublicar = Date.now();
    saveMeta();
    emitir('destacado', { item: p.item, valor: p.destacado });
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
    try { await reqP(store(COLS.productos, 'readwrite').put(p)); } catch (e) { return false; }
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

  // Los N productos más recientes (modificados o vistos) para el showcase.
  function recientes(n) {
    const lim = n || 15;
    const conPrecio = productos.filter((p) => numOf(p.precio) > 0);
    const tocados = conPrecio.filter((p) => p.tocadoEn).sort((a, b) => b.tocadoEn - a.tocadoEn);
    const resto = conPrecio.filter((p) => !p.tocadoEn).sort((a, b) => {
      // sin actividad: primero destacados y con foto, luego con existencia
      const d = (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0); if (d) return d;
      const i = (imagenes.has(String(b.item)) ? 1 : 0) - (imagenes.has(String(a.item)) ? 1 : 0); if (i) return i;
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
  function publicar() {
    const data = {
      generatedAt: new Date().toISOString(),
      count: productos.length,
      productos: productos.map((p) => ({
        item: p.item, nombre: p.nombre, categoria: p.categoria,
        unidad: p.unidad, existencia: p.existencia, precio: p.precio, codigo: p.codigo || '',
        costo: p.costo || 0, marca: p.marca || '',
        destacado: !!p.destacado, activo: p.activo !== false, tocadoEn: p.tocadoEn || 0,
      })),
    };
    _download('inventario-data.json', JSON.stringify(data), 'application/json');
    return data.count;
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
    if (opts.soloConImagen) list = list.filter((p) => imagenes.has(String(p.item)));
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
  async function init(baselineUrls) {
    await openDB();
    await loadAll();
    // Carga la base publicada del sitio si no hay datos locales, o si la base
    // publicada es más nueva que la que ya tenemos (actualización automática).
    const urls = baselineUrls || ['./inventario-data.json', '../inventario-data.json'];
    for (const url of urls) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) continue;
        const d = await r.json();
        const baseAt = d.generatedAt || '';
        if (!productos.length || (baseAt && baseAt > (meta.baselineAt || ''))) {
          await importarBaseline(d);
        }
        break;
      } catch (e) { /* no disponible */ }
    }
    // ¿Hay servidor de fotos? (Netlify) — si sí, las fotos son automáticas
    await _cargarIndiceServidor();

    // Fotos de producto publicadas en el sitio (no pisan las locales del equipo)
    for (const url of ['./imagenes-data.json', '../imagenes-data.json']) {
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
    setClaveFotos, getClaveFotos, tieneClaveFotos, ultimoErrorServidor,
    setDestacado, historial, catalogo, categorias, sinPrecio, recientes, tocar, marcarVisto,
    analizarConteo, aplicarConteo, setActivo, deBaja, altaProducto, setCodigo,
    publicar, publicarImagenes, publicarShowcase, exportarCambios, limpiarCambios,
    marcarPublicado, pendientes,
    stats, disponible, onCambio,
    get cambios() { return cambios.slice(); },
  };
})();
