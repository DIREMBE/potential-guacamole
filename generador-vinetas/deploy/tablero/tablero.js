/* ==========================================================================
   Tablero de ventas, rotación y pedido sugerido — Ferretería San José

   EL PRINCIPIO QUE MANDA
   Los datos de ventas NUNCA salen de esta computadora. Los archivos que se
   arrastran (ZIP de DTE, inventario, Excel de ventas) se leen aquí, en el
   navegador, y el tablero se arma en memoria. No se manda nada al sitio ni a
   ningún otro lado: la página ni siquiera tiene permiso para hacerlo (ver la
   política de seguridad en el index.html). Al cerrar la pestaña, se olvida.
   Lo único que se guarda (en este equipo) son los parámetros editables:
   días de entrega, de seguridad, de cobertura y si C. COMPRA trae IVA.

   UNA SOLA PÁGINA, DOS VISTAS (la decide la ruta)
     /empleados/tablero/  -> rotación, existencias y pedido sugerido.
                            Sin costos, márgenes, montos ni clientes.
     /gerencia/tablero/   -> todo lo anterior + resumen, precios, márgenes,
                            clientes y calidad de datos. Solo rol admin.

   ORDEN DEL ARCHIVO
     1. Vista y acceso        5. Lectura del inventario
     2. Utilidades            6. Lectura del Excel de ventas
     3. Parámetros            7. Cálculo (todo en memoria)
     4. Lectura del ZIP       8. Pantalla: carga, lectura y pestañas
                              9. Pestañas, una por una
                             10. Descargar el pedido en Excel
   ========================================================================== */
(function () {
  'use strict';

  /* ============================ 1. VISTA Y ACCESO ========================= */
  var GERENCIA = /^\/gerencia\//.test(location.pathname);

  var PESTANAS = GERENCIA
    ? [['resumen', 'Resumen'], ['rotacion', 'Rotación y pedido'], ['precios', 'Precios'],
       ['margenes', 'Márgenes'], ['clientes', 'Clientes'], ['vendedores', 'Vendedores'],
       ['calidad', 'Calidad de datos']]
    : [['rotacion', 'Rotación y pedido']];
  var pestana = GERENCIA ? 'resumen' : 'rotacion';

  /* El candado (/acceso.js) llama a esto al entrar, y también si ya había
     sesión abierta. La página de gerencia solo se abre con rol admin. */
  window.__fsjTrasLogin = function (u) {
    var quien = $('tb-quien');
    if (u && quien) {
      quien.innerHTML = '<span class="tb-nombre">' + esc(u.nombre) + '</span> <button type="button" id="tb-salir">Salir</button>';
      $('tb-salir').addEventListener('click', function () {
        if (window.FSJAcceso) window.FSJAcceso.salir(); else location.reload();
      });
    }
    if (GERENCIA && (!u || u.rol !== 'admin')) {
      var b = $('tb-bloqueo');
      b.hidden = false;
      b.innerHTML = '<h1>Esta página es solo para gerencia</h1>' +
        '<p>Entraste como <b>' + esc(u ? u.nombre : '—') + '</b>, que no tiene permiso para ver ' +
        'costos, márgenes ni clientes.</p>' +
        '<p><a class="tb-btn pri" href="/empleados/tablero/">Ir al tablero de pedidos</a></p>';
      return;
    }
    $('tb-app').hidden = false;
    pintarTodo();
  };

  /* ================================ 2. UTILIDADES ========================= */
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Número de una celda o de un JSON. Vacío = 0. Acepta "1,234.50". */
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v == null) return 0;
    var t = String(v).trim().replace(/[$\s]/g, '');
    if (!t) return 0;
    if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    var n = parseFloat(t);
    return isFinite(n) ? n : 0;
  }
  function r2(n) { return Math.round(n * 100) / 100; }

  var FMT2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  function dinero(n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', FMT2); }
  function nf(n, dec) {
    if (n == null || !isFinite(n)) return '—';
    dec = dec || 0;
    return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function pct(x) { return isFinite(x) ? (x * 100).toFixed(1) + '%' : '—'; }

  /* Encabezados: sin tildes, en mayúsculas y con un solo espacio, para
     buscar columnas por su nombre y no por su posición. */
  function normEnc(s) {
    var t = String(s == null ? '' : s);
    if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return t.toUpperCase().replace(/\s+/g, ' ').trim();
  }
  function normTexto(s) { return normEnc(s).toLowerCase(); }

  /* LA LLAVE DE UN PRODUCTO. Siempre el código, nunca la descripción.
     El DTE trae "0000002966" y el inventario 2966: los dos son "2966".
     Un código con letras se deja como texto (con «T:» delante para que no se
     confunda con uno numérico). */
  function claveCodigo(c) {
    var t = String(c == null ? '' : c).trim();
    if (/^\d+(\.0+)?$/.test(t)) return String(parseInt(t, 10));
    return t ? 'T:' + t.toUpperCase() : '';
  }
  function codigoVisible(clave) { return clave.indexOf('T:') === 0 ? clave.slice(2) : clave; }

  /* Fechas como texto AAAA-MM-DD: se comparan y se ordenan solas. */
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function fechaValida(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function aUTC(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function diasEntre(a, b) { return Math.round((aUTC(b) - aUTC(a)) / 864e5); }
  function fechaBonita(s) {
    if (!fechaValida(s)) return s || '—';
    var p = s.split('-');
    return (+p[2]) + ' ' + MESES[+p[1] - 1] + ' ' + p[0];
  }
  function sumarDias(s, n) {
    var d = new Date(aUTC(s) + n * 864e5);
    return d.toISOString().slice(0, 10);
  }
  function hoyTexto() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* Ceder el turno al navegador para que pinte la barra de progreso. */
  function pausa() { return new Promise(function (r) { setTimeout(r, 0); }); }

  /* ================================ 3. PARÁMETROS ========================= */
  /* Lo único que se guarda en el equipo. Si el navegador no deja guardar
     (modo privado, por ejemplo), se trabaja con los de siempre. */
  var CLAVE_PARAM = 'fsj-tablero-parametros';
  var P = { entrega: 7, seguridad: 5, cobertura: 30, compraConIva: false, campoVendedor: '' };
  try {
    var guardados = JSON.parse(localStorage.getItem(CLAVE_PARAM) || 'null');
    if (guardados && typeof guardados === 'object') {
      ['entrega', 'seguridad', 'cobertura'].forEach(function (k) {
        var n = Number(guardados[k]);
        if (isFinite(n) && n >= 0 && n <= 365) P[k] = n;
      });
      P.compraConIva = guardados.compraConIva === true;
      /* De qué dato del documento sale el vendedor (si gerencia eligió uno). */
      if (typeof guardados.campoVendedor === 'string') P.campoVendedor = guardados.campoVendedor.slice(0, 120);
    }
  } catch (e) { /* sin almacenamiento: se usan los de siempre */ }
  function guardarParam() {
    try { localStorage.setItem(CLAVE_PARAM, JSON.stringify(P)); } catch (e) {}
  }

  /* Lo leído de los archivos (en memoria) y lo calculado a partir de eso. */
  var ESTADO = { zip: null, inv: null, xls: null, vendXls: null, segundos: 0 };
  var D = null;

  /* ============================== 4. LECTURA DEL ZIP ======================
     Reglas de FelTec (verificadas con los archivos reales):
       · con la llave «identificacion» -> documento emitido
       · sin ella -> registro de anulación (estado, descripcion, invalidacion,
         respuestaHacienda, response_anular). No es una venta: se cuenta aparte.
       · tipoDte 01 factura (precios CON IVA), 03 crédito fiscal (SIN IVA),
         14 sujeto excluido = una COMPRA: fuera de ventas.                    */
  var LLAVES_ANULACION = ['estado', 'descripcion', 'invalidacion', 'respuestaHacienda', 'response_anular'];
  var UUID = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi;

  function textoDe(v) { return String(v == null ? '' : v).trim(); }

  function normalizarLinea(l, tipo) {
    var cant = num(l.cantidad), grav = num(l.ventaGravada), exe = num(l.ventaExenta),
        ns = num(l.ventaNoSuj), iva = num(l.ivaItem), pu = num(l.precioUni);
    var bruto = grav + exe + ns;
    var sinIva, conIva, puSin, puCon;
    if (tipo === '01') {
      /* Factura: lo gravado ya trae el 13 %. Se usa el IVA de la línea si
         viene; si no, se calcula. */
      var ivaL = iva > 0 ? iva : grav - grav / 1.13;
      sinIva = bruto - ivaL;
      conIva = bruto;
      puCon = pu;
      puSin = grav > 0 ? pu / 1.13 : pu;
    } else {
      /* Crédito fiscal (y lo demás): viene sin IVA. */
      sinIva = bruto;
      conIva = bruto + grav * 0.13;
      puSin = pu;
      puCon = grav > 0 ? pu * 1.13 : pu;
    }
    var codigo = textoDe(l.codigo);
    return {
      codigo: codigo, clave: claveCodigo(codigo), desc: textoDe(l.descripcion),
      cant: cant, descu: num(l.montoDescu), sinIva: sinIva, conIva: conIva,
      puSin: puSin, puCon: puCon, gravada: grav > 0,
    };
  }

  /* ¿QUIÉN VENDIÓ? El DTE de Hacienda no tiene un campo «vendedor», pero los
     sistemas de facturación lo dejan en alguno de estos lugares:
       · el «apéndice» (campo, etiqueta, valor): «Vendedor», «Usuario», «Caja»…
       · la «extensión»: el nombre de quien entrega el documento por la
         ferretería (nombEntrega), o «Vendedor: …» en las observaciones
       · un campo propio de FelTec fuera del DTE (vendedor, usuario, cajero…)
       · el punto de venta del emisor (la caja), como último recurso
     Se apunta TODO lo que traiga cada documento. Con qué se agrupa lo decide
     el tablero (y gerencia lo puede cambiar en la pestaña Vendedores).   */
  var DTE_ESTANDAR = { identificacion: 1, documentoRelacionado: 1, emisor: 1, receptor: 1, sujetoExcluido: 1,
    otrosDocumentos: 1, ventaTercero: 1, cuerpoDocumento: 1, resumen: 1, extension: 1, apendice: 1,
    firmaElectronica: 1, selloRecibido: 1 };
  var RE_VENDEDOR = /vende|usuari|cajer|atendi|asesor|emplead|responsab|digitad|elabor|user|seller/i;
  function candidatosVendedor(o) {
    var c = {};
    var poner = function (campo, v) {
      if (v && typeof v === 'object') v = v.nombre || v.name || v.usuario || v.nombreCompleto || '';
      v = textoDe(v).replace(/\s+/g, ' ');
      /* Un número largo es un documento (DUI, NIT), no un nombre. */
      if (!v || v.length > 80 || (/^[\d\s.,-]+$/.test(v) && v.length > 6)) return;
      if (!c[campo]) c[campo] = v;
    };
    (Array.isArray(o.apendice) ? o.apendice : []).forEach(function (a) {
      if (a && typeof a === 'object') poner('Apéndice: ' + (textoDe(a.etiqueta) || textoDe(a.campo) || 'sin nombre'), a.valor);
    });
    var ex = o.extension;
    if (ex && typeof ex === 'object') {
      poner('Extensión: quien entrega el documento', ex.nombEntrega);
      var m = /(?:vendedor|vend\.|atendi[oó]|atendido por|cajero|usuario)\s*[:\-]\s*([^\n;|]+)/i.exec(textoDe(ex.observaciones));
      if (m) poner('Extensión: vendedor en las observaciones', m[1]);
    }
    Object.keys(o).forEach(function (k) {
      if (!DTE_ESTANDAR[k] && RE_VENDEDOR.test(k)) poner('Campo «' + k + '»', o[k]);
    });
    var em = o.emisor || {};
    poner('Punto de venta (caja)', em.codPuntoVenta || em.codPuntoVentaMH);
    return c;
  }

  function normalizarDoc(o, ruta) {
    var id = o.identificacion || {};
    var tipo = textoDe(id.tipoDte);
    var rec = o.receptor || o.sujetoExcluido || {};
    var res = o.resumen || {};
    var lineas = (Array.isArray(o.cuerpoDocumento) ? o.cuerpoDocumento : []).map(function (l) {
      return normalizarLinea(l || {}, tipo);
    });
    var sinIva = 0, conIva = 0;
    lineas.forEach(function (l) { sinIva += l.sinIva; conIva += l.conIva; });
    return {
      archivo: ruta,
      cod: textoDe(id.codigoGeneracion).toUpperCase(),
      tipo: tipo,
      fecha: textoDe(id.fecEmi),
      hora: textoDe(id.horEmi),
      receptor: {
        nombre: textoDe(rec.nombre),
        doc: textoDe(rec.numDocumento || rec.nit),
        nrc: textoDe(rec.nrc),
      },
      pagos: (Array.isArray(res.pagos) ? res.pagos : []).map(function (p) { return textoDe(p && p.codigo); }),
      condicion: textoDe(res.condicionOperacion),
      totalPagar: num(res.totalPagar != null ? res.totalPagar : res.montoTotalOperacion),
      lineas: lineas, sinIva: sinIva, conIva: conIva,
      vend: candidatosVendedor(o),
    };
  }

  function esAnulacion(o) {
    return LLAVES_ANULACION.some(function (k) { return Object.prototype.hasOwnProperty.call(o, k); });
  }

  async function leerZip(file, progreso) {
    if (typeof JSZip === 'undefined') throw new Error('No se cargó el lector de ZIP. Recargá la página.');
    var zip;
    try { zip = await JSZip.loadAsync(file); }
    catch (e) {
      throw new Error('No se pudo abrir «' + file.name + '»: el ZIP parece dañado o incompleto. ' +
        'Volvé a exportarlo desde FelTec y probá de nuevo.');
    }
    var rutas = [];
    zip.forEach(function (ruta, f) { if (!f.dir && /\.json$/i.test(ruta)) rutas.push(ruta); });
    if (!rutas.length) {
      throw new Error('Este ZIP no trae documentos de FelTec; revisá que exportaste los DTE y no otro reporte.');
    }
    var r = { archivo: file.name, totalJson: rutas.length, docs: [], anulaciones: [], ilegibles: [], desconocidos: [] };
    for (var i = 0; i < rutas.length; i++) {
      var txt = await zip.file(rutas[i]).async('string');
      var o = null;
      try { o = JSON.parse(txt.replace(/^﻿/, '')); } catch (e) { r.ilegibles.push(rutas[i]); }
      if (o && typeof o === 'object') {
        if (o.identificacion) r.docs.push(normalizarDoc(o, rutas[i]));
        else if (esAnulacion(o)) {
          /* A qué documento se refiere: cualquier código de generación que
             venga adentro (o en el nombre del archivo). */
          var refs = {};
          ((txt + ' ' + rutas[i]).match(UUID) || []).forEach(function (u) { refs[u.toUpperCase()] = 1; });
          r.anulaciones.push({
            archivo: rutas[i], estado: textoDe(typeof o.estado === 'object' ? JSON.stringify(o.estado) : o.estado),
            descripcion: textoDe(typeof o.descripcion === 'object' ? '' : o.descripcion), refs: Object.keys(refs),
          });
        } else r.desconocidos.push(rutas[i]);
      }
      if (i % 50 === 49) { progreso(i + 1, rutas.length); await pausa(); }
    }
    progreso(rutas.length, rutas.length);
    if (!r.docs.length && !r.anulaciones.length) {
      throw new Error('Este ZIP no trae documentos de FelTec; revisá que exportaste los DTE y no otro reporte.');
    }
    return r;
  }

  /* ========================== 5. LECTURA DEL INVENTARIO ==================== */
  /* Busca la fila de encabezados en las primeras filas y devuelve, para cada
     columna pedida, en qué posición está (-1 si no está). */
  function columnas(filas, pedidas) {
    for (var f = 0; f < Math.min(6, filas.length); f++) {
      var enc = (filas[f] || []).map(normEnc);
      var col = { fila: f }, alguna = false;
      Object.keys(pedidas).forEach(function (k) {
        var i = -1;
        pedidas[k].some(function (nombre) { i = enc.indexOf(nombre); return i >= 0; });
        col[k] = i;
        if (i >= 0) alguna = true;
      });
      if (alguna && Object.keys(pedidas).filter(function (k) { return col[k] >= 0; }).length >= 3) return col;
    }
    return null;
  }

  var COL_INV = {
    ITEM: ['ITEM'], PRODUCTO: ['PRODUCTO', 'DESCRIPCION'], CATEGORIA: ['CATEGORIA'],
    UNIDAD: ['UNIDAD MEDIDA', 'UNIDAD DE MEDIDA', 'UNIDAD'], SALDO: ['SALDO ANTERIOR'],
    ENTRADA: ['ENTRADA', 'ENTRADAS'], SALIDA: ['SALIDA', 'SALIDAS'], EXISTENCIA: ['EXISTENCIA'],
    CVENTA: ['C. VENTA', 'C.VENTA'], CTVENTA: ['C. T. VENTA', 'C.T.VENTA'],
    CCOMPRA: ['C. COMPRA', 'C.COMPRA'], COSTOTOTAL: ['COSTO TOTAL'],
  };
  var COL_VENTAS = {
    FECHA: ['FECHA'], CLASE: ['CLASE'], TIPO: ['TIPO'], SELLO: ['SELLO DE RECEPCION'],
    COD: ['CODIGO DE GENERACION'], CONTROL: ['NUMERO DE CONTROL'], NRC: ['NRC'], NIT: ['NIT'],
    DUI: ['DUI'], RAZON: ['RAZON SOCIAL'], EXENTA: ['EXENTA'], NOSUJ: ['NO SUJETA'],
    GRAVADA: ['GRAVADA LOCAL'], DEBITO: ['DEBITO FISCAL'], RET1: ['RETENCION 1%'], ISR: ['ISR 10%'],
    TOTAL: ['TOTAL VENTA'], ESTADO: ['ESTADO'], FECHAMH: ['FECHA MH'], MENSAJE: ['MENSAJE MH'],
    VENDEDOR: ['VENDEDOR', 'NOMBRE VENDEDOR', 'USUARIO', 'CAJERO', 'ATENDIDO POR', 'ATENDIO', 'EMPLEADO', 'ASESOR'],
  };

  /* La fecha del inventario: FelTec la pone en el nombre del archivo
     («Reporte_de_inventario 20260915 20261015.xlsx»). Se toma la última.
     Si el nombre no trae fecha, se usa la del archivo. */
  function fechaDelNombre(nombre) {
    var m, ultima = '';
    var re = /(20\d{2})[-_.]?([01]\d)[-_.]?([0-3]\d)/g;
    while ((m = re.exec(nombre))) {
      var f = m[1] + '-' + m[2] + '-' + m[3];
      if (fechaValida(f) && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) ultima = f;
    }
    return ultima;
  }

  function leerInventario(wb, file) {
    var ws = wb.Sheets[wb.SheetNames[0]];
    var filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    var col = columnas(filas, COL_INV);
    if (!col || col.ITEM < 0 || col.PRODUCTO < 0 || col.EXISTENCIA < 0) {
      throw new Error('«' + file.name + '» no parece el reporte de inventario de FelTec: no encontré las ' +
        'columnas ITEM, PRODUCTO y EXISTENCIA en la primera fila.');
    }
    var porFecha = fechaDelNombre(file.name);
    var fecha = porFecha, fuente = 'el nombre del archivo';
    if (!fecha) {
      var d = new Date(file.lastModified || Date.now());
      fecha = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      fuente = 'la fecha del archivo';
    }
    var inv = { archivo: file.name, fecha: fecha, fechaFuente: fuente, items: new Map(),
                sinCosto: 0, negativas: 0, repetidos: 0, sinCodigo: 0, columnas: col };
    var v = function (fila, k) { return col[k] >= 0 ? fila[col[k]] : null; };
    for (var r = col.fila + 1; r < filas.length; r++) {
      var fila = filas[r] || [];
      var t = textoDe(v(fila, 'ITEM'));
      if (!t) continue;
      if (!/^\d+(\.0+)?$/.test(t)) {          // la fila de «Totales:» y similares
        if (!/total/i.test(t)) inv.sinCodigo++;
        continue;
      }
      var clave = claveCodigo(t);
      if (inv.items.has(clave)) { inv.repetidos++; continue; }
      var compra = num(v(fila, 'CCOMPRA')), existencia = num(v(fila, 'EXISTENCIA'));
      var it = {
        clave: clave, item: parseInt(t, 10),
        nombre: textoDe(v(fila, 'PRODUCTO')), categoria: textoDe(v(fila, 'CATEGORIA')),
        unidad: textoDe(v(fila, 'UNIDAD')),
        saldo: num(v(fila, 'SALDO')), entrada: num(v(fila, 'ENTRADA')), salida: num(v(fila, 'SALIDA')),
        existencia: existencia, cVenta: num(v(fila, 'CVENTA')), cTVenta: num(v(fila, 'CTVENTA')),
        cCompra: compra, costoTotal: num(v(fila, 'COSTOTOTAL')),
        /* C. COMPRA = 0 es «sin costo registrado» (muy común), no costo cero. */
        sinCosto: compra <= 0,
        /* Existencia negativa = error de unidad de medida en FelTec (cable
           vendido por metro e ingresado por rollo, por ejemplo). */
        negativa: existencia < 0,
      };
      if (it.sinCosto) inv.sinCosto++;
      if (it.negativa) inv.negativas++;
      inv.items.set(clave, it);
    }
    if (!inv.items.size) {
      throw new Error('«' + file.name + '» tiene los encabezados del inventario pero ningún producto debajo.');
    }
    return inv;
  }

  /* ======================== 6. LECTURA DEL EXCEL DE VENTAS ================= */
  /* NIT y DUI vienen como fórmulas =TEXT("06142305...") : se saca el texto de
     adentro de las comillas. */
  function textoCelda(cell) {
    if (!cell) return '';
    var m;
    if (cell.f && (m = /TEXT\s*\(\s*"([^"]*)"/i.exec(cell.f))) return m[1];
    var v = cell.w != null && typeof cell.v !== 'string' ? cell.w : cell.v;
    if (typeof v === 'string' && (m = /^=?\s*TEXT\s*\(\s*"([^"]*)"/i.exec(v))) return m[1];
    return v == null ? '' : String(v).trim();
  }
  function fechaCelda(cell) {
    if (!cell || cell.v == null) return '';
    if (typeof cell.v === 'number') {
      var p = XLSX.SSF.parse_date_code(cell.v);
      if (p) return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
    }
    var t = String(cell.w || cell.v).trim(), m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t))) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return t;
  }

  function leerVentasXls(wb, file) {
    var ws = wb.Sheets[wb.SheetNames[0]];
    var filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    var col = columnas(filas, COL_VENTAS);
    /* Un Excel con el código de generación y el vendedor, sin estado: es un
       reporte de ventas por vendedor. Sirve para saber quién vendió qué. */
    var soloVendedor = col && col.COD >= 0 && col.ESTADO < 0 && col.VENDEDOR >= 0;
    if (!col || col.COD < 0 || (col.ESTADO < 0 && !soloVendedor)) {
      throw new Error('«' + file.name + '» no parece el Excel de ventas de FelTec: no encontré las ' +
        'columnas «Codigo de generacion» y «Estado».');
    }
    var rango = XLSX.utils.decode_range(ws['!ref']);
    var celda = function (r, k) {
      return col[k] >= 0 ? ws[XLSX.utils.encode_cell({ r: r, c: col[k] })] : null;
    };
    var x = { archivo: file.name, filas: [], facturadas: 0, invalidadas: 0, otrosEstados: 0, montoFacturado: 0,
              soloVendedor: soloVendedor,
              columnaVendedor: col.VENDEDOR >= 0 ? textoDe((filas[col.fila] || [])[col.VENDEDOR]) : '' };
    for (var r = col.fila + 1; r <= rango.e.r; r++) {
      var cod = textoCelda(celda(r, 'COD')).toUpperCase();
      if (!cod) continue;
      var estado = normEnc(textoCelda(celda(r, 'ESTADO')));
      var f = {
        cod: cod, estado: estado, fecha: fechaCelda(celda(r, 'FECHA')),
        clase: textoCelda(celda(r, 'CLASE')), tipo: textoCelda(celda(r, 'TIPO')),
        nrc: textoCelda(celda(r, 'NRC')), nit: textoCelda(celda(r, 'NIT')), dui: textoCelda(celda(r, 'DUI')),
        razon: textoCelda(celda(r, 'RAZON')),
        total: num(celda(r, 'TOTAL') && celda(r, 'TOTAL').v),
        mensaje: textoCelda(celda(r, 'MENSAJE')),
        vendedor: textoCelda(celda(r, 'VENDEDOR')).replace(/\s+/g, ' '),
      };
      if (soloVendedor) { x.filas.push(f); continue; }
      if (estado === 'FACTURADA') { x.facturadas++; x.montoFacturado += f.total; }
      else if (estado === 'INVALIDADO') x.invalidadas++;
      else x.otrosEstados++;
      x.filas.push(f);
    }
    if (!x.filas.length) throw new Error('«' + file.name + '» no trae ninguna factura debajo de los encabezados.');
    return x;
  }

  /* ¿Qué Excel es? Se decide por sus encabezados, no por el nombre. */
  function tipoDeExcel(wb) {
    var ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws || !ws['!ref']) return '';
    /* Solo las primeras filas: no hace falta recorrer once mil para saberlo. */
    var rg = XLSX.utils.decode_range(ws['!ref']);
    for (var f = rg.s.r; f <= Math.min(rg.s.r + 5, rg.e.r); f++) {
      var enc = [];
      for (var c = rg.s.c; c <= rg.e.c; c++) {
        var cell = ws[XLSX.utils.encode_cell({ r: f, c: c })];
        enc.push(normEnc(cell ? cell.v : ''));
      }
      if (enc.indexOf('CODIGO DE GENERACION') >= 0) return 'ventas';
      if (enc.indexOf('ITEM') >= 0 && enc.indexOf('EXISTENCIA') >= 0) return 'inventario';
    }
    return '';
  }

  /* ========================= 7. CÁLCULO (TODO EN MEMORIA) =================== */
  function calcular() {
    var Z = ESTADO.zip, I = ESTADO.inv, X = ESTADO.xls;
    var d = { hayZip: !!Z, hayInv: !!I, hayXls: !!X };

    /* --- 7.1 Qué documentos son ventas --- */
    var ventas = [], compras14 = [], otrosTipos = [], anuladosReg = [], invalidadosXls = [];
    var porCod = new Map();
    var xlsPorCod = new Map();
    if (X) X.filas.forEach(function (f) { xlsPorCod.set(f.cod, f); });
    if (Z) {
      Z.docs.forEach(function (doc) { if (doc.cod) porCod.set(doc.cod, doc); });
      /* Una anulación que apunta a un documento que SÍ viene en el ZIP: ese
         documento no es venta. (Normalmente el original ya no viene.) */
      var anulados = {};
      Z.anulaciones.forEach(function (a) {
        a.enZip = 0;
        a.refs.forEach(function (u) { if (porCod.has(u)) { anulados[u] = 1; a.enZip++; } });
      });
      Z.docs.forEach(function (doc) {
        if (doc.tipo === '14') return compras14.push(doc);
        if (doc.tipo !== '01' && doc.tipo !== '03') return otrosTipos.push(doc);
        if (anulados[doc.cod]) return anuladosReg.push(doc);
        /* Con el Excel de ventas cargado: lo que FelTec marca INVALIDADO no
           cuenta, aunque el documento venga completo en el ZIP. */
        var fx = xlsPorCod.get(doc.cod);
        if (fx && fx.estado === 'INVALIDADO') return invalidadosXls.push(doc);
        ventas.push(doc);
      });
    }
    d.ventas = ventas; d.compras14 = compras14; d.otrosTipos = otrosTipos;
    d.anuladosReg = anuladosReg; d.invalidadosXls = invalidadosXls;

    /* --- 7.2 El período: de la primera a la última venta, contando los dos días --- */
    var fechas = ventas.map(function (x) { return x.fecha; }).filter(fechaValida).sort();
    d.inicio = fechas[0] || ''; d.fin = fechas[fechas.length - 1] || '';
    d.dias = d.inicio ? diasEntre(d.inicio, d.fin) + 1 : 0;

    /* --- 7.3 Totales, por día, por hora --- */
    var t = { sinIva: 0, conIva: 0, docs: ventas.length, lineas: 0 };
    var porDia = {}, porHora = new Array(24).fill(0);
    ventas.forEach(function (doc) {
      t.sinIva += doc.sinIva; t.conIva += doc.conIva; t.lineas += doc.lineas.length;
      var dd = porDia[doc.fecha] || (porDia[doc.fecha] = { sinIva: 0, conIva: 0, docs: 0 });
      dd.sinIva += doc.sinIva; dd.conIva += doc.conIva; dd.docs++;
      var h = parseInt(String(doc.hora).slice(0, 2), 10);
      if (h >= 0 && h < 24) porHora[h]++;
    });
    t.ticket = t.docs ? t.conIva / t.docs : 0;
    d.totales = t; d.porDia = porDia; d.porHora = porHora;

    /* --- 7.4 Por producto (SIEMPRE por código) --- */
    var prods = new Map();
    ventas.forEach(function (doc) {
      doc.lineas.forEach(function (l) {
        if (!l.clave) return;
        var p = prods.get(l.clave);
        if (!p) {
          p = { clave: l.clave, nombres: {}, cant: 0, sinIva: 0, conIva: 0, lineas: [] };
          prods.set(l.clave, p);
        }
        p.nombres[l.desc] = (p.nombres[l.desc] || 0) + 1;
        p.cant += l.cant; p.sinIva += l.sinIva; p.conIva += l.conIva;
        p.lineas.push({ cant: l.cant, puCon: r2(l.puCon), efSin: l.cant ? l.sinIva / l.cant : 0,
                        efCon: l.cant ? l.conIva / l.cant : 0 });
      });
    });
    prods.forEach(function (p) {
      var ns = Object.keys(p.nombres).sort(function (a, b) { return p.nombres[b] - p.nombres[a]; });
      p.nombre = ns[0] || ''; p.listaNombres = ns;
    });
    d.prods = prods;

    /* --- 7.5 Rotación y pedido sugerido --- */
    d.filas = calcularRotacion(d);
    var cats = {};
    d.filas.forEach(function (f) { cats[f.categoria] = 1; });
    d.categorias = Object.keys(cats).sort(function (a, b) { return a.localeCompare(b, 'es'); });

    /* --- 7.6 Lo que se lee del ZIP, tal cual, para comparar con FelTec --- */
    if (Z) {
      var porTipo = {}, lineasTodas = 0, codsTodos = {}, codsVentas = {};
      Z.docs.forEach(function (doc) {
        porTipo[doc.tipo] = (porTipo[doc.tipo] || 0) + 1;
        lineasTodas += doc.lineas.length;
        doc.lineas.forEach(function (l) { if (l.clave) codsTodos[l.clave] = 1; });
      });
      prods.forEach(function (p, k) { codsVentas[k] = 1; });
      d.lectura = { porTipo: porTipo, lineasTodas: lineasTodas, codigosTodos: Object.keys(codsTodos).length,
                    codigosVentas: Object.keys(codsVentas).length };
    }
    if (X && Z) d.cuadre = calcularCuadre(d, porCod, xlsPorCod);

    /* --- 7.7 De dónde sale el vendedor --- */
    d.xlsPorCod = xlsPorCod;
    d.vendCampos = camposVendedor(d);
    d.campoVendedor = elegirCampoVendedor(d.vendCampos);
    return d;
  }

  /* ======================= 7b. VENDEDORES ===============================
     Qué datos de los documentos podrían ser el vendedor, y cuántos
     documentos de venta lo traen. Los Excel también cuentan: el de ventas si
     trae una columna «Vendedor» o «Usuario», o un reporte aparte con el
     código de generación y el vendedor.                                   */
  var XLS_VEND = 'xls:ventas', XLS_VEND2 = 'xls:vendedores';
  function vendedorDe(doc, campo) {
    if (!doc || !campo) return '';
    if (campo === XLS_VEND || campo === XLS_VEND2) {
      var mapa = campo === XLS_VEND ? D.xlsPorCod : D.vendXlsPorCod;
      var f = mapa && mapa.get(doc.cod);
      return f ? f.vendedor || '' : '';
    }
    return (doc.vend && doc.vend[campo]) || '';
  }
  function camposVendedor(d) {
    var stats = {};
    var contar = function (campo, etiqueta, v) {
      var s = stats[campo] || (stats[campo] = { campo: campo, etiqueta: etiqueta, docs: 0, nombres: {} });
      if (!v) return;
      s.docs++;
      var k = normEnc(v);
      s.nombres[k] = (s.nombres[k] || 0) + 1;
    };
    var X = ESTADO.xls, V = ESTADO.vendXls;
    d.vendXlsPorCod = null;
    if (V) { d.vendXlsPorCod = new Map(); V.filas.forEach(function (f) { if (f.vendedor) d.vendXlsPorCod.set(f.cod, f); }); }
    var conVendXls = X && X.filas.some(function (f) { return f.vendedor; });
    d.ventas.forEach(function (doc) {
      Object.keys(doc.vend || {}).forEach(function (k) { contar(k, k, doc.vend[k]); });
      if (conVendXls) { var f = d.xlsPorCod.get(doc.cod); contar(XLS_VEND, 'Excel de ventas: columna «' + X.columnaVendedor + '»', f && f.vendedor); }
      if (V) { var g = d.vendXlsPorCod.get(doc.cod); contar(XLS_VEND2, 'Archivo «' + V.archivo + '»: columna «' + V.columnaVendedor + '»', g && g.vendedor); }
    });
    return Object.keys(stats).map(function (k) {
      var s = stats[k];
      s.distintos = Object.keys(s.nombres).length;
      s.ejemplos = Object.keys(s.nombres).sort(function (a, b) { return s.nombres[b] - s.nombres[a]; }).slice(0, 4);
      return s;
    }).filter(function (s) { return s.docs > 0; })
      .sort(function (a, b) { return puntosCampo(b, d) - puntosCampo(a, d); });
  }
  /* Cuál tiene más pinta de ser el vendedor: lo que se llama «vendedor»
     primero; luego usuario, cajero, quien entrega…; la caja, al final. Que lo
     traigan casi todos los documentos y que haya más de un nombre, suma. */
  function puntosCampo(s, d) {
    var e = normTexto(s.etiqueta), p = 0;
    if (s.campo === XLS_VEND || s.campo === XLS_VEND2) p = 5;
    else if (/vende/.test(e)) p = 4;
    else if (/usuari|cajer|atendi|asesor|emplead|responsab|digitad|elabor|user|seller/.test(e)) p = 3;
    else if (/quien entrega/.test(e)) p = 2;
    else if (/punto de venta/.test(e)) p = 0.5;
    else p = 1;
    var cobertura = d.ventas.length ? s.docs / d.ventas.length : 0;
    return p + cobertura + (s.distintos > 1 ? 0.5 : 0);
  }
  function elegirCampoVendedor(campos) {
    if (!campos.length) return '';
    if (P.campoVendedor && campos.some(function (c) { return c.campo === P.campoVendedor; })) return P.campoVendedor;
    return campos[0].campo;
  }

  /* Las cuentas de cada vendedor con el campo elegido. */
  function calcularVendedores(campo) {
    var I = ESTADO.inv, total = D.totales.conIva || 0;
    /* El precio habitual de cada producto en el período: el que más se cobró.
       Vender por debajo de él es «más barato que lo normal». */
    var habitual = {};
    D.prods.forEach(function (p, clave) {
      var veces = {};
      p.lineas.forEach(function (l) { var k = l.puCon.toFixed(2); veces[k] = (veces[k] || 0) + 1; });
      var mejor = null;
      Object.keys(veces).forEach(function (k) {
        if (mejor == null || veces[k] > veces[mejor] || (veces[k] === veces[mejor] && +k > +mejor)) mejor = k;
      });
      habitual[clave] = mejor == null ? 0 : +mejor;
    });
    var costoU = function (clave) {
      var it = I && I.items.get(clave);
      if (!it || it.sinCosto) return null;
      return P.compraConIva ? it.cCompra / 1.13 : it.cCompra;
    };

    var mapa = {};
    var de = function (doc) {
      var crudo = vendedorDe(doc, campo);
      var k = crudo ? normEnc(crudo) : '';
      var v = mapa[k];
      if (!v) {
        v = mapa[k] = { clave: k, formas: {}, docs: 0, facturas: 0, ccf: 0, conIva: 0, sinIva: 0, lineas: 0, unidades: 0,
          descuento: 0, docsDescuento: 0, identificados: 0, clientes: {}, dias: {}, porDia: {}, porHora: new Array(24).fill(0),
          credito: 0, medible: 0, costo: 0, noMedible: 0, bajoHab: 0, bajoHabDinero: 0, bajoCosto: 0, bajoCostoDinero: 0,
          anuladas: 0, anuladasDinero: 0, prods: {}, detalleBajo: [], docsAnulados: [] };
      }
      if (crudo) v.formas[crudo] = (v.formas[crudo] || 0) + 1;
      return v;
    };

    D.ventas.forEach(function (doc) {
      var v = de(doc);
      v.docs++;
      if (doc.tipo === '01') v.facturas++; else if (doc.tipo === '03') v.ccf++;
      v.conIva += doc.conIva; v.sinIva += doc.sinIva; v.lineas += doc.lineas.length;
      if (!esVarios(doc.receptor)) {
        v.identificados++;
        v.clientes[doc.receptor.doc || doc.receptor.nrc || normEnc(doc.receptor.nombre)] = 1;
      }
      if (doc.condicion === '2') v.credito++;
      v.dias[doc.fecha] = 1;
      v.porDia[doc.fecha] = (v.porDia[doc.fecha] || 0) + doc.conIva;
      var h = parseInt(String(doc.hora).slice(0, 2), 10);
      if (h >= 0 && h < 24) v.porHora[h]++;
      var conDescuento = false;
      doc.lineas.forEach(function (l) {
        v.unidades += l.cant;
        if (l.descu > 0) { v.descuento += l.descu; conDescuento = true; }
        var p = v.prods[l.clave] || (v.prods[l.clave] = { nombre: l.desc, u: 0, v: 0 });
        p.u += l.cant; p.v += l.conIva;
        if (l.cant > 0) {
          var ef = l.conIva / l.cant, hab = habitual[l.clave] || 0;
          if (hab > 0 && ef < hab * 0.99 - 0.005) {
            var dif = (hab - ef) * l.cant;
            v.bajoHab++; v.bajoHabDinero += dif;
            v.detalleBajo.push({ cod: doc.cod, fecha: doc.fecha, codigo: codigoVisible(l.clave), nombre: l.desc,
                                 cant: l.cant, cobrado: ef, habitual: hab, dif: dif });
          }
        }
        var cu = costoU(l.clave);
        if (cu == null) { v.noMedible += l.sinIva; return; }
        v.medible += l.sinIva; v.costo += cu * l.cant;
        if (l.cant > 0 && l.sinIva / l.cant < cu - 0.005) {
          v.bajoCosto++; v.bajoCostoDinero += (cu - l.sinIva / l.cant) * l.cant;
        }
      });
      if (conDescuento) v.docsDescuento++;
    });
    /* Lo anulado o invalidado también tiene vendedor: dice algo de cómo se
       factura. No suma a las ventas. */
    D.anuladosReg.concat(D.invalidadosXls).forEach(function (doc) {
      var v = de(doc);
      v.anuladas++; v.anuladasDinero += doc.conIva;
      v.docsAnulados.push({ cod: doc.cod, fecha: doc.fecha, total: doc.conIva, receptor: doc.receptor.nombre });
    });

    return Object.keys(mapa).map(function (k) {
      var v = mapa[k];
      var formas = Object.keys(v.formas).sort(function (a, b) { return v.formas[b] - v.formas[a]; });
      v.nombre = k ? formas[0] : '(sin vendedor en el documento)';
      v.sinNombre = !k;
      v.diasActivos = Object.keys(v.dias).length;
      v.ticket = v.docs ? v.conIva / v.docs : 0;
      v.lineasDoc = v.docs ? v.lineas / v.docs : 0;
      v.share = total ? v.conIva / total : 0;
      v.ventaDia = v.diasActivos ? v.conIva / v.diasActivos : 0;
      v.margen = v.medible - v.costo;
      v.margenPct = v.medible ? v.margen / v.medible : null;
      v.pctIdent = v.docs ? v.identificados / v.docs : 0;
      v.nClientes = Object.keys(v.clientes).length;
      v.pctDescuento = v.conIva ? v.descuento / v.conIva : 0;
      v.tasaAnul = (v.docs + v.anuladas) ? v.anuladas / (v.docs + v.anuladas) : 0;
      v.top = Object.keys(v.prods).map(function (c) { return v.prods[c]; }).sort(function (a, b) { return b.v - a.v; });
      v.detalleBajo.sort(function (a, b) { return b.dif - a.dif; });
      return v;
    }).sort(function (a, b) { return (a.sinNombre - b.sinNombre) || (b.conIva - a.conIva); });
  }

  /* Fórmulas (las de siempre de la ferretería):
       venta diaria       = vendido ÷ días del período
       días de cobertura  = existencia ÷ venta diaria
       punto de reorden   = venta diaria × (tiempo de entrega + días de seguridad)
       pedido sugerido    = máx(0, venta diaria × cobertura objetivo − existencia),
                            redondeado hacia arriba
     Semáforo: rojo si la cobertura no alcanza ni para el tiempo de entrega;
     amarillo si la existencia está por debajo del punto de reorden; verde si
     está bien; gris si no se vendió nada en el período.
     Una existencia NEGATIVA (error de unidad en FelTec) se toma como 0 para
     el cálculo y se marca, para que se revise.                              */
  function calcularRotacion(d) {
    var I = ESTADO.inv, dias = d.dias || 0, filas = [], vistos = {};
    var costoSin = function (it) { return it.sinCosto ? 0 : (P.compraConIva ? it.cCompra / 1.13 : it.cCompra); };
    function fila(clave, it, p) {
      var vendido = p ? p.cant : 0;
      var vd = dias > 0 ? vendido / dias : 0;
      var f = {
        clave: clave, codigo: it ? String(it.item) : codigoVisible(clave),
        nombre: it ? it.nombre : (p ? p.nombre : ''),
        categoria: it ? (it.categoria || '(sin categoría)') : '(no está en el inventario)',
        unidad: it ? it.unidad : '',
        vendido: vendido, ventaDiaria: vd,
        existencia: it ? it.existencia : null,
        negativa: !!(it && it.negativa), sinCosto: !it || it.sinCosto, noInv: !it,
        cVenta: it ? it.cVenta : 0, costo: it ? costoSin(it) : 0,
      };
      var ex = it ? Math.max(0, it.existencia) : null;
      f.reorden = vd * (P.entrega + P.seguridad);
      f.cobertura = (vd > 0 && ex != null) ? ex / vd : null;
      if (!it) {
        f.pedido = null; f.semaforo = 'sininv';
      } else {
        f.pedido = Math.max(0, Math.ceil(r2(vd * P.cobertura - ex) - 1e-9));
        if (vd <= 0) f.semaforo = 'gris';
        else if (f.cobertura < P.entrega) f.semaforo = 'rojo';
        else if (ex < f.reorden) f.semaforo = 'amarillo';
        else f.semaforo = 'verde';
      }
      f.costoPedido = f.pedido && f.costo ? f.pedido * f.costo : 0;
      f.semOrden = SEM_ORDEN[f.semaforo];
      return f;
    }
    if (I) I.items.forEach(function (it, clave) { vistos[clave] = 1; filas.push(fila(clave, it, d.prods.get(clave))); });
    d.prods.forEach(function (p, clave) { if (!vistos[clave]) filas.push(fila(clave, null, p)); });
    return filas;
  }

  /* Cruce con el Excel de ventas de FelTec, por código de generación. */
  function calcularCuadre(d, porCod, xlsPorCod) {
    var c = { soloExcel: [], soloZip: [], excluidosInvalidado: d.invalidadosXls.slice(),
              invalidadosSinZip: 0, invalidadosConAnulacion: 0, facturadaEsCompra: [], totalesDistintos: [],
              sumaVentasExcel: 0, sumaVentasZip: 0 };
    var refsAnulacion = {};
    ESTADO.zip.anulaciones.forEach(function (a) { a.refs.forEach(function (u) { refsAnulacion[u] = 1; }); });
    xlsPorCod.forEach(function (f, cod) {
      var doc = porCod.get(cod);
      if (f.estado === 'INVALIDADO') {
        if (!doc) { c.invalidadosSinZip++; if (refsAnulacion[cod]) c.invalidadosConAnulacion++; }
        return;
      }
      if (f.estado !== 'FACTURADA') return;
      if (!doc) return c.soloExcel.push(f);
      if (doc.tipo === '14') return c.facturadaEsCompra.push(f);
      if (Math.abs(f.total - doc.totalPagar) > 0.011) c.totalesDistintos.push({ f: f, doc: doc });
    });
    d.ventas.forEach(function (doc) {
      c.sumaVentasZip += doc.totalPagar;
      var f = xlsPorCod.get(doc.cod);
      if (!f) c.soloZip.push(doc); else if (f.estado === 'FACTURADA') c.sumaVentasExcel += f.total;
    });
    return c;
  }

  /* =================== 8. PANTALLA: CARGA, LECTURA Y PESTAÑAS ============== */
  function pintarTodo() {
    pintarListaArchivos();
    pintarLectura();
    pintarPestanas();
    pintarContenido();
  }

  function pintarListaArchivos() {
    var Z = ESTADO.zip, I = ESTADO.inv, X = ESTADO.xls;
    var li = function (ok, titulo, det, op) {
      return '<li class="' + (ok ? 'ok' : 'falta') + '"><span class="ic">' + (ok ? '✓' : '○') + '</span>' +
        '<b>' + titulo + '</b>' + (det ? '<span class="det">' + det + '</span>' : '') +
        (op ? '<span class="op">' + op + '</span>' : '') + '</li>';
    };
    $('tb-lista').innerHTML =
      li(!!Z, '1. ZIP de DTE', Z ? esc(Z.archivo) + ' · ' + nf(Z.totalJson) + ' JSON' : '', Z ? '' : 'obligatorio') +
      li(!!I, '2. Inventario (.xlsx)', I ? esc(I.archivo) + ' · ' + nf(I.items.size) + ' productos' : '',
         I ? '' : 'obligatorio para el pedido') +
      li(!!X, '3. Excel de ventas (.xlsx)', X ? esc(X.archivo) + ' · ' + nf(X.filas.length) + ' facturas' : '',
         X ? '' : 'opcional: descarta lo que FelTec marca INVALIDADO');
  }

  function mostrarError(msg) {
    var e = $('tb-error');
    if (!msg) { e.hidden = true; e.innerHTML = ''; return; }
    e.hidden = false;
    e.innerHTML = msg;
  }

  function progreso(texto, fraccion) {
    var p = $('tb-progreso');
    if (texto == null) { p.hidden = true; return; }
    p.hidden = false;
    $('tb-progreso-txt').textContent = texto;
    $('tb-progreso-span').style.width = Math.round((fraccion || 0) * 100) + '%';
  }

  async function procesarArchivos(lista) {
    var archivos = Array.prototype.slice.call(lista || []);
    if (!archivos.length) return;
    mostrarError('');
    var t0 = performance.now(), errores = [];
    /* El ZIP primero: es el que más tarda y el que define el período. */
    archivos.sort(function (a, b) { return (/\.zip$/i.test(b.name) ? 1 : 0) - (/\.zip$/i.test(a.name) ? 1 : 0); });
    for (var i = 0; i < archivos.length; i++) {
      var f = archivos[i];
      try {
        if (/\.zip$/i.test(f.name)) {
          progreso('Abriendo ' + f.name + '…', 0);
          await pausa();
          ESTADO.zip = await leerZip(f, function (hechos, total) {
            progreso('Leyendo documentos: ' + nf(hechos) + ' de ' + nf(total), hechos / total);
          });
        } else if (/\.xlsx?$/i.test(f.name)) {
          progreso('Leyendo ' + f.name + '…', 0.5);
          await pausa();
          if (typeof XLSX === 'undefined') throw new Error('No se cargó el lector de Excel. Recargá la página.');
          var wb;
          try { wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellFormula: true }); }
          catch (e) { throw new Error('No se pudo abrir «' + f.name + '». Revisá que sea un Excel (.xlsx) exportado de FelTec.'); }
          var tipo = tipoDeExcel(wb);
          if (tipo === 'inventario') ESTADO.inv = leerInventario(wb, f);
          else if (tipo === 'ventas') {
            var lx = leerVentasXls(wb, f);
            if (lx.soloVendedor) ESTADO.vendXls = lx; else ESTADO.xls = lx;
          }
          else throw new Error('No reconozco «' + esc(f.name) + '». Del inventario espero las columnas ITEM y ' +
            'EXISTENCIA; del Excel de ventas, «Codigo de generacion» y «Estado». Revisá que sea uno de los dos reportes de FelTec.');
        } else {
          throw new Error('«' + f.name + '» no es un ZIP ni un Excel. Arrastrá el ZIP de los DTE y los reportes .xlsx de FelTec.');
        }
      } catch (e) {
        errores.push(esc(e.message || String(e)));
      }
    }
    progreso('Armando el tablero…', 1);
    await pausa();
    D = calcular();
    ESTADO.segundos = (performance.now() - t0) / 1000;
    progreso(null);
    if (errores.length) mostrarError(errores.join('<br>'));
    pintarTodo();
  }

  /* El recuadro «Lectura de archivos»: lo que se leyó, contado, para poder
     compararlo con FelTec. En la vista de empleados no lleva montos. */
  function pintarLectura() {
    var box = $('tb-lectura'), Z = ESTADO.zip, I = ESTADO.inv, X = ESTADO.xls;
    if (!D || (!Z && !I && !X)) { box.hidden = true; return; }
    box.hidden = false;
    var c = function (etq, val) { return '<div><span>' + etq + '</span><b>' + val + '</b></div>'; };
    var h = '<h2>Lectura de archivos' + (ESTADO.segundos ? ' · ' + ESTADO.segundos.toFixed(1) + ' s' : '') + '</h2><div class="tb-cifras">';
    if (Z) {
      var pt = D.lectura.porTipo, otros = 0;
      Object.keys(pt).forEach(function (k) { if (k !== '01' && k !== '03' && k !== '14') otros += pt[k]; });
      h += c('JSON en el ZIP', nf(Z.totalJson)) +
        c('Con «identificacion»', nf(Z.docs.length)) +
        c('· tipo 01 (factura)', nf(pt['01'] || 0)) +
        c('· tipo 03 (crédito fiscal)', nf(pt['03'] || 0)) +
        c('· tipo 14 (compra, fuera de ventas)', nf(pt['14'] || 0)) +
        (otros ? c('· otros tipos (fuera de ventas)', nf(otros)) : '') +
        c('Registros de anulación', nf(Z.anulaciones.length)) +
        c('Líneas de detalle', nf(D.lectura.lineasTodas)) +
        c('Códigos distintos', nf(D.lectura.codigosTodos)) +
        (Z.ilegibles.length ? c('JSON que no se pudieron leer', nf(Z.ilegibles.length)) : '') +
        (Z.desconocidos.length ? c('JSON que no son de FelTec', nf(Z.desconocidos.length)) : '') +
        c('Período de ventas', D.inicio ? fechaBonita(D.inicio) + ' – ' + fechaBonita(D.fin) + ' (' + D.dias + ' días)' : '—') +
        c('Documentos de venta que cuentan', nf(D.ventas.length)) +
        (D.anuladosReg.length ? c('Anulados (su anulación viene en el ZIP)', nf(D.anuladosReg.length)) : '') +
        (D.invalidadosXls.length ? c('INVALIDADO según el Excel (no cuentan)', nf(D.invalidadosXls.length)) : '');
      if (GERENCIA) h += c('Ventas sin IVA', dinero(D.totales.sinIva)) + c('Ventas con IVA', dinero(D.totales.conIva));
    }
    if (Z && GERENCIA) {
      var cv = (D.vendCampos || []).find(function (x) { return x.campo === D.campoVendedor; });
      h += c('Vendedor', cv ? esc(cv.etiqueta) + ' · ' + nf(cv.docs) + ' de ' + nf(D.ventas.length) + ' documentos'
                         : 'no viene en los documentos');
    }
    if (I) {
      h += c('Inventario: productos', nf(I.items.size)) +
        c('Inventario del', fechaBonita(I.fecha)) +
        c('Sin costo registrado (C. COMPRA = 0)', nf(I.sinCosto)) +
        c('Existencias negativas', nf(I.negativas));
    }
    if (X) {
      h += c('Excel de ventas: facturas', nf(X.filas.length)) +
        c('· FACTURADA', nf(X.facturadas) + (GERENCIA ? ' · ' + dinero(X.montoFacturado) : '')) +
        c('· INVALIDADO', nf(X.invalidadas)) +
        (X.otrosEstados ? c('· otro estado', nf(X.otrosEstados)) : '');
    }
    h += '</div>';
    h += avisosGenerales();
    box.innerHTML = h;
  }

  function avisosGenerales() {
    var a = '';
    if (ESTADO.zip && ESTADO.inv && D.fin && ESTADO.inv.fecha !== D.fin) {
      a += '<div class="tb-aviso ama">⚠ <b>El inventario es del ' + fechaBonita(ESTADO.inv.fecha) + '</b> (tomado de ' +
        esc(ESTADO.inv.fechaFuente) + ') <b>y las ventas llegan al ' + fechaBonita(D.fin) + '.</b> Si no son del mismo día, ' +
        'la existencia no cuadra con lo vendido y el pedido puede salir de más o de menos. Lo mejor es exportar el ' +
        'inventario el mismo día que termina el ZIP.</div>';
    }
    if (ESTADO.zip && !ESTADO.inv) {
      a += '<div class="tb-aviso info">Falta el <b>inventario</b>: sin él se ven las ventas, pero no la existencia ' +
        'ni el pedido sugerido.</div>';
    }
    if (!ESTADO.zip && (ESTADO.inv || ESTADO.xls)) {
      a += '<div class="tb-aviso info">Falta el <b>ZIP de DTE</b>: de ahí salen las ventas.</div>';
    }
    if (ESTADO.zip && ESTADO.xls && D.invalidadosXls.length) {
      a += '<div class="tb-aviso info">El Excel de ventas marca <b>INVALIDADO</b> a ' + nf(D.invalidadosXls.length) +
        ' documento(s) que sí vienen en el ZIP: <b>no se cuentan como venta</b>.' +
        (GERENCIA ? ' Detalle en «Calidad de datos».' : '') + '</div>';
    }
    return a;
  }

  function pintarPestanas() {
    var nav = $('tb-pestanas');
    if (!D || !ESTADO.zip) { nav.hidden = true; return; }
    nav.hidden = PESTANAS.length < 2;
    nav.innerHTML = PESTANAS.map(function (p) {
      return '<button type="button" role="tab" data-p="' + p[0] + '" aria-selected="' + (p[0] === pestana) + '">' +
        p[1] + '</button>';
    }).join('');
  }

  function pintarContenido() {
    var box = $('tb-contenido');
    destruirGraficas();
    if (!D || !ESTADO.zip) {
      box.innerHTML = '<div class="tb-bloque"><h3>Cómo se usa</h3><p class="tb-nota">' +
        'Exportá de FelTec el <b>ZIP de los DTE</b> del período y el <b>reporte de inventario</b> (.xlsx) del último día ' +
        'de ese período, y arrastralos juntos al recuadro de arriba. ' +
        (GERENCIA ? 'Si querés cuadrar contra Hacienda, agregá también el <b>Excel de ventas</b>. ' : '') +
        'En unos segundos aparece el pedido sugerido.</p></div>';
      return;
    }
    var fn = { resumen: pintarResumen, rotacion: pintarRotacion, precios: pintarPrecios,
               margenes: pintarMargenes, clientes: pintarClientes, vendedores: pintarVendedores,
               calidad: pintarCalidad }[pestana];
    box.innerHTML = '';
    (fn || pintarRotacion)(box);
  }

  /* ---- Tablas: una función para todas (ordenar por columna incluido) ----
     cols: [{ k, t, n (numérica), f (formato), h (html propio) }]          */
  function tablaHTML(id, cols, filas, orden) {
    return '<div class="tb-tabla"><table data-tabla="' + id + '"><thead><tr>' +
      cols.map(function (c) {
        var o = orden && orden.k === c.k ? ' ord' + (orden.desc ? ' desc' : '') : '';
        /* c.ns: columna que no se ordena (listas de nombres, por ejemplo). */
        return '<th class="' + (c.n ? 'n' : '') + o + '"' + (c.ns || !orden ? ' style="cursor:default"' : ' data-k="' + c.k + '"') +
          '>' + c.t + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      filas.map(function (f) {
        return '<tr>' + cols.map(function (c) {
          var v = c.h ? c.h(f) : (c.f ? c.f(f[c.k], f) : esc(f[c.k]));
          return '<td class="' + (c.n ? 'n ' : '') + (c.cls || '') + '">' + v + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function ordenar(filas, orden) {
    if (!orden || !orden.k) return filas;
    var k = orden.k, s = orden.desc ? -1 : 1;
    return filas.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      var xn = x == null || x === '', yn = y == null || y === '';
      if (xn && yn) return 0;
      if (xn) return 1;                 // los vacíos siempre al final
      if (yn) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * s;
      return String(x).localeCompare(String(y), 'es', { numeric: true }) * s;
    });
  }
  /* Al tocar un encabezado: ordena por esa columna (y al revés si se vuelve a tocar). */
  function alOrdenar(box, orden, repintar) {
    box.addEventListener('click', function (e) {
      var th = e.target.closest('th[data-k]'); if (!th) return;
      if (orden.k === th.dataset.k) orden.desc = !orden.desc;
      else { orden.k = th.dataset.k; orden.desc = true; }
      repintar();
    });
  }
  function coincide(texto, palabras) {
    var t = normTexto(texto);
    return palabras.every(function (w) { return t.indexOf(w) >= 0; });
  }
  function palabrasDe(q) { return normTexto(q).split(/\s+/).filter(Boolean); }

  /* =========================== 9. PESTAÑAS ================================ */

  /* ---------- 9.1 Resumen (gerencia) ---------- */
  var GRAF = [];
  function destruirGraficas() { GRAF.forEach(function (g) { try { g.destroy(); } catch (e) {} }); GRAF = []; }
  function grafica(lienzo, cfg) {
    if (typeof Chart === 'undefined') return;
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } } }, cfg.options || {});
    GRAF.push(new Chart(lienzo, cfg));
  }

  function pintarResumen(box) {
    var t = D.totales;
    var anul = ESTADO.zip.anulaciones.length;
    var kpi = function (v, l, cls) { return '<div class="tb-kpi ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; };
    box.innerHTML =
      '<div class="tb-kpis">' +
        kpi(dinero(t.sinIva), 'Ventas sin IVA', 'n') +
        kpi(dinero(t.conIva), 'Ventas con IVA', 'a') +
        kpi(nf(t.docs), 'Documentos de venta') +
        kpi(dinero(t.ticket), 'Ticket promedio (con IVA)') +
        kpi(nf(anul), 'Registros de anulación') +
        kpi(D.dias + ' días', fechaBonita(D.inicio) + ' – ' + fechaBonita(D.fin)) +
      '</div>' +
      '<div class="tb-graficas">' +
        '<div class="tb-graf"><h3>Ventas por día (con IVA)</h3><div class="lienzo"><canvas id="g-dia"></canvas></div></div>' +
        '<div class="tb-graf"><h3>Facturas por hora del día</h3><div class="lienzo"><canvas id="g-hora"></canvas></div></div>' +
      '</div>' +
      '<div class="tb-graf"><h3>Top 10 categorías (ventas sin IVA)</h3>' +
        (ESTADO.inv ? '<div class="lienzo" style="height:300px"><canvas id="g-cat"></canvas></div>'
                    : '<p class="tb-nota">Cargá el inventario para ver las categorías.</p>') +
      '</div>';

    /* Todos los días del período, también los que no hubo ventas. */
    var etq = [], val = [];
    for (var f = D.inicio, n = 0; f && f <= D.fin && n < 400; f = sumarDias(f, 1), n++) {
      etq.push(f.slice(8, 10) + '/' + f.slice(5, 7));
      val.push(r2((D.porDia[f] || { conIva: 0 }).conIva));
    }
    grafica($('g-dia'), { type: 'bar', data: { labels: etq, datasets: [{ data: val, backgroundColor: '#F15930' }] },
      options: { scales: { y: { ticks: { callback: function (v) { return '$' + nf(v); } } } } } });

    var horas = D.porHora, h0 = horas.findIndex(function (x) { return x > 0; }), h1 = 23;
    while (h1 > 0 && !horas[h1]) h1--;
    if (h0 < 0) { h0 = 0; h1 = 23; }
    var eh = [], vh = [];
    for (var h = h0; h <= h1; h++) { eh.push(h + ' h'); vh.push(horas[h]); }
    grafica($('g-hora'), { type: 'bar', data: { labels: eh, datasets: [{ data: vh, backgroundColor: '#0475BB' }] } });

    if (ESTADO.inv) {
      var porCat = {};
      D.prods.forEach(function (p, clave) {
        var it = ESTADO.inv.items.get(clave);
        var cat = it ? (it.categoria || '(sin categoría)') : '(no está en el inventario)';
        porCat[cat] = (porCat[cat] || 0) + p.sinIva;
      });
      var top = Object.keys(porCat).sort(function (a, b) { return porCat[b] - porCat[a]; }).slice(0, 10);
      grafica($('g-cat'), { type: 'bar',
        data: { labels: top, datasets: [{ data: top.map(function (k) { return r2(porCat[k]); }), backgroundColor: '#0475BB' }] },
        options: { indexAxis: 'y', scales: { x: { ticks: { callback: function (v) { return '$' + nf(v); } } } } } });
    }
  }

  /* ---------- 9.2 Rotación y pedido sugerido (la más importante) ---------- */
  var ROT = { sem: 'movimiento', cat: '', q: '', orden: { k: '', desc: false }, ver: 200 };
  var SEM_TXT = { rojo: 'Urgente', amarillo: 'Pedir', verde: 'Bien', gris: 'Sin movimiento', sininv: 'No está en el inventario' };
  var SEM_ORDEN = { rojo: 0, amarillo: 1, verde: 2, sininv: 3, gris: 4 };

  function filasRotacion() {
    var pal = palabrasDe(ROT.q);
    var l = D.filas.filter(function (f) {
      if (ROT.cat && f.categoria !== ROT.cat) return false;
      switch (ROT.sem) {
        case 'movimiento': if (f.semaforo === 'gris') return false; break;
        case 'pedido': if (!(f.pedido > 0)) return false; break;
        case 'todos': break;
        default: if (f.semaforo !== ROT.sem) return false;
      }
      return !pal.length || coincide(f.codigo + ' ' + f.nombre, pal);
    });
    if (ROT.orden.k) return ordenar(l, ROT.orden);
    /* Orden de siempre: lo urgente arriba, y dentro, lo que más hay que pedir. */
    return l.sort(function (a, b) {
      return (SEM_ORDEN[a.semaforo] - SEM_ORDEN[b.semaforo]) || ((b.pedido || 0) - (a.pedido || 0)) || (b.vendido - a.vendido);
    });
  }

  function columnasRotacion() {
    var cols = [
      { k: 'semOrden', t: 'Estado', h: function (f) { return '<span class="sem ' + f.semaforo + '">' + SEM_TXT[f.semaforo] + '</span>'; } },
      { k: 'codigo', t: 'Código', cls: 'cod' },
      { k: 'nombre', t: 'Producto', h: function (f) {
          return esc(f.nombre) +
            (f.negativa ? ' <span class="marca-aviso" title="Existencia negativa en FelTec: casi siempre es la unidad de medida (se vende por metro y entra por rollo). Para el pedido se tomó como 0.">existencia negativa</span>' : '');
        } },
      { k: 'categoria', t: 'Categoría' },
      { k: 'unidad', t: 'Unidad' },
      { k: 'vendido', t: 'Vendido', n: 1, f: function (v) { return nf(v, v % 1 ? 2 : 0); } },
      { k: 'ventaDiaria', t: 'Venta diaria', n: 1, f: function (v) { return nf(v, 2); } },
      { k: 'existencia', t: 'Existencia', n: 1, f: function (v) { return v == null ? '—' : nf(v, v % 1 ? 2 : 0); } },
      { k: 'cobertura', t: 'Días de cobertura', n: 1, f: function (v, f) { return f.ventaDiaria > 0 ? nf(v, 1) : '—'; } },
      { k: 'reorden', t: 'Punto de reorden', n: 1, f: function (v, f) { return f.ventaDiaria > 0 ? nf(v, 1) : '—'; } },
      { k: 'pedido', t: 'Pedido sugerido', n: 1, cls: 'pedido', f: function (v) { return v == null ? '—' : (v ? nf(v) : '0'); } },
    ];
    if (GERENCIA) {
      cols.push({ k: 'costo', t: 'Costo unit.', n: 1, f: function (v, f) { return f.sinCosto ? '<span class="marca-aviso ama">sin costo</span>' : dinero(v); } });
      cols.push({ k: 'costoPedido', t: 'Costo del pedido', n: 1, f: function (v) { return v ? dinero(v) : '—'; } });
    }
    return cols;
  }

  function pintarRotacion(box) {
    if (!ESTADO.inv) {
      box.innerHTML = '<div class="tb-aviso info">Cargá el <b>reporte de inventario</b> (.xlsx) para ver existencias, ' +
        'días de cobertura y el pedido sugerido. Mientras tanto, esto es lo que más se vendió:</div>';
    }
    box.insertAdjacentHTML('beforeend',
      '<div class="tb-param">' +
        '<label>Tiempo de entrega (días)<input type="number" min="0" max="365" step="1" data-param="entrega" value="' + P.entrega + '"></label>' +
        '<label>Días de seguridad<input type="number" min="0" max="365" step="1" data-param="seguridad" value="' + P.seguridad + '"></label>' +
        '<label>Cobertura objetivo (días)<input type="number" min="0" max="365" step="1" data-param="cobertura" value="' + P.cobertura + '"></label>' +
        '<span class="ayuda">Venta diaria = vendido ÷ ' + D.dias + ' días del período. Se pide para que alcance la cobertura ' +
          'objetivo; el punto de reorden es la venta de los días de entrega más los de seguridad. Estos números se ' +
          'guardan en este equipo.</span>' +
      '</div>' +
      '<div class="tb-filtros">' +
        '<input type="search" id="rot-q" placeholder="Buscar por código o nombre…" value="' + esc(ROT.q) + '" aria-label="Buscar producto">' +
        '<select id="rot-sem" aria-label="Filtrar por estado">' +
          [['movimiento', 'Con movimiento'], ['pedido', 'Con pedido'], ['rojo', '● Urgente (rojo)'], ['amarillo', '● Pedir (amarillo)'],
           ['verde', '● Bien (verde)'], ['gris', 'Sin movimiento'], ['sininv', 'No está en el inventario'], ['todos', 'Todos']]
            .map(function (o) { return '<option value="' + o[0] + '"' + (ROT.sem === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select>' +
        '<select id="rot-cat" aria-label="Filtrar por categoría"><option value="">Todas las categorías</option>' +
          D.categorias.map(function (c) { return '<option' + (ROT.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
        '</select>' +
        '<button type="button" class="tb-btn pri" id="rot-excel">⬇ Descargar pedido en Excel</button>' +
      '</div>' +
      '<p class="tb-cuenta" id="rot-cuenta"></p>' +
      '<div id="rot-tabla"></div>');

    var repintar = function () {
      var filas = filasRotacion();
      var conPedido = filas.filter(function (f) { return f.pedido > 0; });
      var unidades = conPedido.reduce(function (a, f) { return a + f.pedido; }, 0);
      $('rot-cuenta').innerHTML = '<b>' + nf(filas.length) + '</b> producto(s) · <b>' + nf(conPedido.length) +
        '</b> con pedido (' + nf(unidades) + ' unidades' +
        (GERENCIA ? ', costo estimado ' + dinero(conPedido.reduce(function (a, f) { return a + f.costoPedido; }, 0)) : '') + ')';
      var ver = filas.slice(0, ROT.ver);
      $('rot-tabla').innerHTML = tablaHTML('rot', columnasRotacion(), ver, ROT.orden) +
        (filas.length > ROT.ver ? '<button type="button" class="tb-btn tb-mas" id="rot-mas">Ver ' +
          nf(Math.min(200, filas.length - ROT.ver)) + ' más (de ' + nf(filas.length) + ')</button>' : '');
      $('rot-excel').disabled = !conPedido.length;
    };
    repintar();

    var reloj;
    $('rot-q').addEventListener('input', function (e) {
      clearTimeout(reloj);
      reloj = setTimeout(function () { ROT.q = e.target.value; ROT.ver = 200; repintar(); }, 180);
    });
    /* Enter: busca ya y baja el teclado del teléfono. */
    $('rot-q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { clearTimeout(reloj); ROT.q = e.target.value; ROT.ver = 200; repintar(); e.target.blur(); }
    });
    $('rot-sem').addEventListener('change', function (e) { ROT.sem = e.target.value; ROT.ver = 200; repintar(); });
    $('rot-cat').addEventListener('change', function (e) { ROT.cat = e.target.value; ROT.ver = 200; repintar(); });
    $('rot-excel').addEventListener('click', function () { descargarPedido(filasRotacion()); });
    $('rot-tabla').addEventListener('click', function (e) {
      if (e.target.id === 'rot-mas') { ROT.ver += 200; repintar(); }
    });
    alOrdenar($('rot-tabla'), ROT.orden, repintar);
    box.querySelectorAll('[data-param]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var n = Math.round(Number(inp.value));
        if (!isFinite(n) || n < 0) n = 0;
        if (n > 365) n = 365;
        inp.value = n;
        P[inp.dataset.param] = n;
        guardarParam();
        D.filas = calcularRotacion(D);
        repintar();
      });
    });
  }

  /* ---------- 9.3 Precios (gerencia) ----------
     Precios con IVA, que es lo que paga el cliente: en el crédito fiscal se
     les suma el IVA para poder compararlos. C. VENTA del inventario se toma
     como el precio al público (con IVA). El costo se compara sin IVA.     */
  var PRE = { modo: 'varios', q: '', orden: { k: '', desc: false } };

  function filasPrecios() {
    var I = ESTADO.inv, l = [];
    D.prods.forEach(function (p, clave) {
      var it = I ? I.items.get(clave) : null;
      var costo = it && !it.sinCosto ? (P.compraConIva ? it.cCompra / 1.13 : it.cCompra) : 0;
      var precios = {}, bajoV = { n: 0, u: 0 }, bajoC = { n: 0, u: 0, perdida: 0 };
      p.lineas.forEach(function (x) {
        if (!(x.cant > 0)) return;
        var k = x.puCon.toFixed(2);
        precios[k] = precios[k] || { n: 0, u: 0 };
        precios[k].n++; precios[k].u += x.cant;
        if (it && it.cVenta > 0 && x.efCon < it.cVenta - 0.005) { bajoV.n++; bajoV.u += x.cant; }
        if (costo > 0 && x.efSin < costo - 0.005) { bajoC.n++; bajoC.u += x.cant; bajoC.perdida += (costo - x.efSin) * x.cant; }
      });
      var ks = Object.keys(precios).map(Number).sort(function (a, b) { return a - b; });
      l.push({
        clave: clave, codigo: it ? String(it.item) : codigoVisible(clave), nombre: it ? it.nombre : p.nombre,
        nPrecios: ks.length, min: ks[0] || 0, max: ks[ks.length - 1] || 0,
        precios: ks.map(function (k) { return { p: k, n: precios[k.toFixed(2)].n, u: precios[k.toFixed(2)].u }; }),
        cVenta: it ? it.cVenta : 0, costo: costo,
        bajoV: bajoV.n, bajoVu: bajoV.u, bajoC: bajoC.n, bajoCu: bajoC.u, perdida: bajoC.perdida,
      });
    });
    var pal = palabrasDe(PRE.q);
    l = l.filter(function (f) {
      if (PRE.modo === 'varios' && f.nPrecios < 2) return false;
      if (PRE.modo === 'bajoventa' && !f.bajoV) return false;
      if (PRE.modo === 'bajocosto' && !f.bajoC) return false;
      return !pal.length || coincide(f.codigo + ' ' + f.nombre, pal);
    });
    if (PRE.orden.k) return ordenar(l, PRE.orden);
    return l.sort(function (a, b) { return (b.max - b.min) - (a.max - a.min) || b.bajoC - a.bajoC; });
  }

  function pintarPrecios(box) {
    box.innerHTML = paramCompraIva() +
      '<p class="tb-nota">Precios <b>con IVA</b> (lo que paga el cliente; al crédito fiscal se le suma el IVA para compararlo). ' +
      '<b>C. VENTA</b> se toma como el precio al público con IVA. «Debajo del costo» compara el precio sin IVA contra C. COMPRA, ' +
      'después de descuentos.</p>' +
      '<div class="tb-filtros"><input type="search" id="pre-q" placeholder="Buscar producto…" value="' + esc(PRE.q) + '">' +
      '<select id="pre-modo">' +
        [['varios', 'Vendidos a más de un precio'], ['bajoventa', 'Vendidos debajo de C. VENTA'], ['bajocosto', 'Vendidos debajo del costo']]
          .map(function (o) { return '<option value="' + o[0] + '"' + (PRE.modo === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select></div><p class="tb-cuenta" id="pre-cuenta"></p><div id="pre-tabla"></div>';
    var cols = [
      { k: 'codigo', t: 'Código', cls: 'cod' }, { k: 'nombre', t: 'Producto' },
      { k: 'nPrecios', t: 'Precios', n: 1 },
      { k: 'min', t: 'Mínimo', n: 1, f: dinero }, { k: 'max', t: 'Máximo', n: 1, f: dinero },
      { k: 'precios', t: 'Ventas a cada precio', ns: 1, h: function (f) {
          return f.precios.map(function (x) { return '<span class="chip">' + dinero(x.p) + ' × ' + x.n + '</span>'; }).join('');
        } },
      { k: 'cVenta', t: 'C. VENTA', n: 1, f: function (v) { return v ? dinero(v) : '—'; } },
      { k: 'bajoV', t: 'Debajo de C. VENTA', n: 1, f: function (v, f) { return v ? nf(v) + ' (' + nf(f.bajoVu) + ' u.)' : '—'; } },
      { k: 'bajoC', t: 'Debajo del costo', n: 1, f: function (v, f) {
          return v ? '<b style="color:var(--rojo)">' + nf(v) + ' (' + nf(f.bajoCu) + ' u.) · ' + dinero(-f.perdida) + '</b>' : '—';
        } },
    ];
    var repintar = function () {
      var l = filasPrecios();
      $('pre-cuenta').innerHTML = '<b>' + nf(l.length) + '</b> producto(s)';
      $('pre-tabla').innerHTML = tablaHTML('pre', cols, l.slice(0, 500), PRE.orden) +
        (l.length > 500 ? '<p class="tb-nota">Se ven 500 de ' + nf(l.length) + '. Buscá para acotar.</p>' : '');
    };
    repintar();
    $('pre-q').addEventListener('input', function (e) { PRE.q = e.target.value; repintar(); });
    $('pre-modo').addEventListener('change', function (e) { PRE.modo = e.target.value; repintar(); });
    alOrdenar($('pre-tabla'), PRE.orden, repintar);
    engancharCompraIva(box);
  }

  function paramCompraIva() {
    return '<div class="tb-param"><label>C. COMPRA incluye IVA<select data-compra-iva>' +
      '<option value="no"' + (P.compraConIva ? '' : ' selected') + '>No (costo sin IVA)</option>' +
      '<option value="si"' + (P.compraConIva ? ' selected' : '') + '>Sí (se le quita el 13 %)</option></select></label>' +
      '<span class="ayuda">Según cómo esté cargado el costo en FelTec. Se guarda en este equipo.</span></div>';
  }
  function engancharCompraIva(box) {
    var s = box.querySelector('[data-compra-iva]');
    if (s) s.addEventListener('change', function () {
      P.compraConIva = s.value === 'si';
      guardarParam();
      D.filas = calcularRotacion(D);
      pintarContenido();
    });
  }

  /* ---------- 9.4 Márgenes (gerencia) ----------
     Solo con los productos que tienen costo registrado. Lo que se vendió sin
     costo no se puede medir: se dice cuánto fue, aparte.                   */
  var MAR = { q: '', orden: { k: 'margen', desc: true }, vista: 'producto' };

  function pintarMargenes(box) {
    var I = ESTADO.inv;
    if (!I) { box.innerHTML = '<div class="tb-aviso info">Cargá el <b>inventario</b>: de ahí sale el costo (C. COMPRA).</div>'; return; }
    var porProd = [], porCat = {}, medible = 0, noMedible = 0, costoTotal = 0;
    D.prods.forEach(function (p, clave) {
      var it = I.items.get(clave);
      if (!it || it.sinCosto) { noMedible += p.sinIva; return; }
      var cu = P.compraConIva ? it.cCompra / 1.13 : it.cCompra;
      var costo = cu * p.cant, margen = p.sinIva - costo;
      medible += p.sinIva; costoTotal += costo;
      porProd.push({ codigo: String(it.item), nombre: it.nombre, categoria: it.categoria || '(sin categoría)',
                     cant: p.cant, venta: p.sinIva, costoU: cu, costo: costo, margen: margen,
                     pct: p.sinIva ? margen / p.sinIva : 0 });
      var c = porCat[it.categoria || '(sin categoría)'] || (porCat[it.categoria || '(sin categoría)'] = { venta: 0, costo: 0, sinCosto: 0 });
      c.venta += p.sinIva; c.costo += costo;
    });
    D.prods.forEach(function (p, clave) {
      var it = I.items.get(clave);
      if (it && it.sinCosto) {
        var cat = it.categoria || '(sin categoría)';
        (porCat[cat] || (porCat[cat] = { venta: 0, costo: 0, sinCosto: 0 })).sinCosto += p.sinIva;
      }
    });
    var total = medible + noMedible, margenT = medible - costoTotal;
    var kpi = function (v, l, cls) { return '<div class="tb-kpi ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; };
    box.innerHTML = paramCompraIva() +
      '<div class="tb-kpis">' +
        kpi(dinero(margenT), 'Margen (productos con costo)', 'n') +
        kpi(pct(medible ? margenT / medible : NaN), 'Margen %', 'a') +
        kpi(dinero(medible), 'Venta medible (sin IVA)') +
        kpi(dinero(noMedible), 'Venta sin costo registrado') +
        kpi(pct(total ? noMedible / total : NaN), 'De la venta no se pudo medir') +
      '</div>' +
      '<p class="tb-nota">El margen se calcula solo con los productos que tienen <b>C. COMPRA</b> en el inventario. ' +
      'Lo vendido sin costo registrado (o con un código que no está en el inventario) suma <b>' + dinero(noMedible) +
      '</b> y no entra en el margen.</p>' +
      '<div class="tb-filtros"><select id="mar-vista"><option value="producto"' + (MAR.vista === 'producto' ? ' selected' : '') +
        '>Por producto</option><option value="categoria"' + (MAR.vista === 'categoria' ? ' selected' : '') + '>Por categoría</option></select>' +
      '<input type="search" id="mar-q" placeholder="Buscar…" value="' + esc(MAR.q) + '"></div>' +
      '<div id="mar-tabla"></div>';
    var filasCat = Object.keys(porCat).map(function (k) {
      var c = porCat[k], m = c.venta - c.costo;
      return { categoria: k, venta: c.venta, costo: c.costo, margen: m, pct: c.venta ? m / c.venta : 0, sinCosto: c.sinCosto };
    });
    var fPct = function (v) { return '<span style="color:' + (v < 0 ? 'var(--rojo)' : 'inherit') + '">' + pct(v) + '</span>'; };
    var fMar = function (v) { return '<span style="color:' + (v < 0 ? 'var(--rojo)' : 'inherit') + '">' + dinero(v) + '</span>'; };
    var colsP = [
      { k: 'codigo', t: 'Código', cls: 'cod' }, { k: 'nombre', t: 'Producto' }, { k: 'categoria', t: 'Categoría' },
      { k: 'cant', t: 'Cantidad', n: 1, f: function (v) { return nf(v, v % 1 ? 2 : 0); } },
      { k: 'venta', t: 'Venta sin IVA', n: 1, f: dinero }, { k: 'costoU', t: 'Costo unit.', n: 1, f: dinero },
      { k: 'costo', t: 'Costo de lo vendido', n: 1, f: dinero }, { k: 'margen', t: 'Margen $', n: 1, f: fMar },
      { k: 'pct', t: 'Margen %', n: 1, f: fPct },
    ];
    var colsC = [
      { k: 'categoria', t: 'Categoría' }, { k: 'venta', t: 'Venta medible', n: 1, f: dinero },
      { k: 'costo', t: 'Costo', n: 1, f: dinero }, { k: 'margen', t: 'Margen $', n: 1, f: fMar },
      { k: 'pct', t: 'Margen %', n: 1, f: fPct }, { k: 'sinCosto', t: 'Venta sin costo', n: 1, f: function (v) { return v ? dinero(v) : '—'; } },
    ];
    var repintar = function () {
      var pal = palabrasDe(MAR.q);
      if (MAR.vista === 'categoria') {
        var l = filasCat.filter(function (f) { return !pal.length || coincide(f.categoria, pal); });
        $('mar-tabla').innerHTML = tablaHTML('mar', colsC, ordenar(l, MAR.orden), MAR.orden);
      } else {
        var lp = porProd.filter(function (f) { return !pal.length || coincide(f.codigo + ' ' + f.nombre + ' ' + f.categoria, pal); });
        lp = ordenar(lp, MAR.orden);
        $('mar-tabla').innerHTML = tablaHTML('mar', colsP, lp.slice(0, 500), MAR.orden) +
          (lp.length > 500 ? '<p class="tb-nota">Se ven 500 de ' + nf(lp.length) + '. Buscá u ordená para ver otros.</p>' : '');
      }
    };
    repintar();
    $('mar-vista').addEventListener('change', function (e) { MAR.vista = e.target.value; repintar(); });
    $('mar-q').addEventListener('input', function (e) { MAR.q = e.target.value; repintar(); });
    alOrdenar($('mar-tabla'), MAR.orden, repintar);
    engancharCompraIva(box);
  }

  /* ---------- 9.5 Clientes (gerencia) ---------- */
  var CLI = { orden: { k: 'total', desc: true }, q: '' };
  function esVarios(r) {
    var n = normEnc(r.nombre);
    return !n || /^VARIOS\b/.test(n) || /CONSUMIDOR FINAL/.test(n);
  }
  function pintarClientes(box) {
    var varios = 0, mapa = {};
    D.ventas.forEach(function (doc) {
      if (esVarios(doc.receptor)) { varios++; return; }
      var k = doc.receptor.doc || doc.receptor.nrc || normEnc(doc.receptor.nombre);
      var c = mapa[k] || (mapa[k] = { nombre: doc.receptor.nombre, doc: doc.receptor.doc, nrc: doc.receptor.nrc,
                                      facturas: 0, total: 0, sinIva: 0, ultima: '', prods: {} });
      c.facturas++; c.total += doc.conIva; c.sinIva += doc.sinIva;
      if (doc.fecha > c.ultima) c.ultima = doc.fecha;
      doc.lineas.forEach(function (l) {
        var p = c.prods[l.clave] || (c.prods[l.clave] = { nombre: l.desc, u: 0, v: 0 });
        p.u += l.cant; p.v += l.conIva;
      });
    });
    var l = Object.keys(mapa).map(function (k) {
      var c = mapa[k];
      c.ticket = c.total / c.facturas;
      c.top = Object.keys(c.prods).map(function (x) { return c.prods[x]; })
        .sort(function (a, b) { return b.v - a.v; });
      return c;
    });
    var nDocs = D.ventas.length;
    var kpi = function (v, t, cls) { return '<div class="tb-kpi ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + t + '</div></div>'; };
    box.innerHTML = '<div class="tb-kpis">' +
        kpi(pct(nDocs ? varios / nDocs : NaN), 'Facturas a «VARIOS» (sin identificar)', 'n') +
        kpi(nf(varios), 'Facturas a VARIOS') +
        kpi(nf(l.length), 'Clientes identificados', 'a') +
        kpi(dinero(l.reduce(function (a, c) { return a + c.total; }, 0)), 'Compra de los identificados (con IVA)') +
      '</div>' +
      '<div class="tb-filtros"><input type="search" id="cli-q" placeholder="Buscar cliente…">' +
      '<select id="cli-orden"><option value="total">Ordenar por compra total</option><option value="facturas">Ordenar por frecuencia</option></select></div>' +
      '<div id="cli-tabla"></div>';
    var cols = [
      { k: 'nombre', t: 'Cliente' },
      { k: 'doc', t: 'Documento / NRC', ns: 1, h: function (c) { return esc(c.doc || '—') + (c.nrc ? '<br><span class="chip">NRC ' + esc(c.nrc) + '</span>' : ''); } },
      { k: 'facturas', t: 'Facturas', n: 1 },
      { k: 'total', t: 'Compra total (con IVA)', n: 1, f: dinero },
      { k: 'ticket', t: 'Ticket promedio', n: 1, f: dinero },
      { k: 'ultima', t: 'Última compra', f: fechaBonita },
      { k: 'top', t: 'Qué compra', ns: 1, h: function (c) {
          var tres = c.top.slice(0, 3).map(function (p) { return '<span class="chip">' + esc(p.nombre) + '</span>'; }).join('');
          var mas = c.top.length > 3 ? '<details class="tb-det"><summary>ver los ' + c.top.length + '</summary>' +
            c.top.slice(0, 30).map(function (p) { return esc(p.nombre) + ' — ' + nf(p.u, p.u % 1 ? 2 : 0) + ' u. · ' + dinero(p.v); }).join('<br>') +
            '</details>' : '';
          return tres + mas;
        } },
    ];
    var repintar = function () {
      var pal = palabrasDe(CLI.q);
      var f = l.filter(function (c) { return !pal.length || coincide(c.nombre + ' ' + c.doc + ' ' + c.nrc, pal); });
      $('cli-tabla').innerHTML = tablaHTML('cli', cols, ordenar(f, CLI.orden).slice(0, 300), CLI.orden);
    };
    repintar();
    $('cli-q').addEventListener('input', function (e) { CLI.q = e.target.value; repintar(); });
    $('cli-orden').addEventListener('change', function (e) { CLI.orden.k = e.target.value; CLI.orden.desc = true; repintar(); });
    alOrdenar($('cli-tabla'), CLI.orden, repintar);
  }

  /* ---------- 9.6 Vendedores (gerencia) ----------
     Cuánto vende cada uno y CÓMO vende: ticket, cuántas cosas por factura,
     margen, descuentos, ventas por debajo del precio habitual o del costo,
     clientes identificados y documentos anulados. Es para conversar con cada
     vendedor con números, no para premiar solo al que más factura.        */
  var VEN = { orden: { k: 'conIva', desc: true }, ver: null };   // ver: qué vendedor tiene abierto el detalle
  var COLORES = ['#F15930', '#0475BB', '#2e7d43', '#8e44ad', '#c98a12', '#5b554c', '#d81b60', '#00897b'];

  function pintarVendedores(box) {
    var campos = D.vendCampos || [];
    if (!campos.length) {
      box.innerHTML = '<div class="tb-aviso ama"><b>Los documentos de este ZIP no dicen quién hizo cada venta.</b> ' +
        'Busqué el vendedor en el apéndice, en quién entrega el documento, en las observaciones, en campos propios de ' +
        'FelTec y en el punto de venta, y no viene en ninguno.</div>' +
        '<div class="tb-bloque"><h3>Cómo tenerlo</h3><p class="tb-nota">' +
        '1. En FelTec, que el vendedor salga en la factura: en el <b>apéndice</b> (por ejemplo «Vendedor») o como ' +
        '<b>responsable de entrega</b>. Desde ese día, el ZIP ya lo trae y esta pestaña se llena sola.<br>' +
        '2. Mientras tanto, si FelTec tiene un <b>reporte de ventas por vendedor o por usuario</b> en Excel que traiga el ' +
        '<b>código de generación</b>, arrastralo junto con el ZIP: se cruza por ese código.</p></div>';
      return;
    }
    var campo = D.campoVendedor;
    var cActual = campos.find(function (x) { return x.campo === campo; }) || campos[0];
    var L = calcularVendedores(campo);
    var conNombre = L.filter(function (v) { return !v.sinNombre; });
    var sinV = L.find(function (v) { return v.sinNombre; });
    var total = D.totales.conIva || 0;
    var hayInv = !!ESTADO.inv;
    var kpi = function (v, t, cls) { return '<div class="tb-kpi ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + t + '</div></div>'; };
    var mejor = conNombre[0];
    var mayorTicket = conNombre.slice().filter(function (v) { return v.docs >= 5; }).sort(function (a, b) { return b.ticket - a.ticket; })[0];

    box.innerHTML =
      '<div class="tb-param"><label>El vendedor sale de <select id="ven-campo">' +
        campos.map(function (c) {
          return '<option value="' + esc(c.campo) + '"' + (c.campo === campo ? ' selected' : '') + '>' + esc(c.etiqueta) +
            ' — ' + nf(c.docs) + ' de ' + nf(D.ventas.length) + ' documentos, ' + nf(c.distintos) + ' nombre(s)</option>';
        }).join('') + '</select></label>' +
        '<span class="ayuda">Ejemplos: ' + cActual.ejemplos.map(function (e) { return '<span class="chip">' + esc(e) + '</span>'; }).join(' ') +
        '. Si no son vendedores, elegí otro dato; este equipo se acuerda.</span></div>' +
      '<div class="tb-kpis">' +
        kpi(nf(conNombre.length), 'Vendedores con ventas', 'n') +
        kpi(mejor ? esc(mejor.nombre) : '—', mejor ? 'Más vendió: ' + dinero(mejor.conIva) + ' (' + pct(mejor.share) + ')' : 'Más vendió', 'a txt') +
        kpi(mayorTicket ? dinero(mayorTicket.ticket) : '—', 'Mayor ticket promedio' + (mayorTicket ? ': ' + esc(mayorTicket.nombre) : '')) +
        kpi(pct(total && sinV ? sinV.conIva / total : 0), 'De la venta sin vendedor en el documento') +
      '</div>' +
      '<div class="tb-graficas">' +
        '<div class="tb-graf"><h3>Ventas por vendedor (con IVA)</h3><div class="lienzo" style="height:' +
          Math.max(200, 34 * Math.min(conNombre.length, 14) + 40) + 'px"><canvas id="g-ven"></canvas></div></div>' +
        '<div class="tb-graf"><h3>Ventas por día de los ' + Math.min(6, conNombre.length) + ' que más venden</h3>' +
          '<div class="lienzo"><canvas id="g-ven-dia"></canvas></div></div>' +
      '</div>' +
      '<div class="tb-filtros"><button type="button" class="tb-btn pri" id="ven-excel">⬇ Descargar por vendedor en Excel</button></div>' +
      '<div id="ven-tabla"></div>' +
      '<p class="tb-nota"><b>Bajo el precio habitual</b>: líneas cobradas más baratas que el precio que más se cobró por ese ' +
        'producto en el período (si el precio cambió a mitad de mes, lo vendido antes del cambio también sale aquí). ' +
        (hayInv ? '<b>Margen</b> y <b>bajo el costo</b> usan el C. COMPRA del inventario. '
                : 'Cargá el inventario para ver margen y ventas bajo el costo. ') +
        '<b>Anuladas</b>: documentos con su anulación en el ZIP' + (ESTADO.xls ? ' o INVALIDADO en el Excel de ventas' : '') +
        '; no suman a las ventas.</p>' +
      '<div class="tb-bloque"><h3>Detalle de un vendedor</h3><div class="tb-filtros"><select id="ven-ver">' +
        L.map(function (v) {
          var abierto = VEN.ver != null ? v.clave === VEN.ver : v === conNombre[0];
          return '<option value="' + esc(v.clave) + '"' + (abierto ? ' selected' : '') + '>' + esc(v.nombre) + '</option>';
        }).join('') +
      '</select></div><div id="ven-det"></div></div>';

    var fPct = function (v) { return v == null ? '—' : '<span style="color:' + (v < 0 ? 'var(--rojo)' : 'inherit') + '">' + pct(v) + '</span>'; };
    var cols = [
      { k: 'nombre', t: 'Vendedor', cls: 'nom', h: function (v) { return v.sinNombre ? '<i>' + esc(v.nombre) + '</i>' : '<b>' + esc(v.nombre) + '</b>'; } },
      { k: 'conIva', t: 'Ventas con IVA', n: 1, f: dinero },
      { k: 'share', t: '% del total', n: 1, f: function (v) { return pct(v); } },
      { k: 'docs', t: 'Documentos', n: 1, f: function (v) { return nf(v); } },
      { k: 'ticket', t: 'Ticket promedio', n: 1, f: dinero },
      { k: 'lineasDoc', t: 'Productos por factura', n: 1, f: function (v) { return nf(v, 1); } },
      { k: 'diasActivos', t: 'Días con venta', n: 1, f: function (v) { return nf(v); } },
      { k: 'ventaDia', t: 'Venta por día trabajado', n: 1, f: dinero },
    ];
    if (hayInv) cols.push({ k: 'margenPct', t: 'Margen %', n: 1, f: fPct },
                          { k: 'margen', t: 'Margen $', n: 1, f: function (v) { return dinero(v); } });
    cols.push(
      { k: 'descuento', t: 'Descuentos dados', n: 1, f: function (v, x) { return v ? dinero(v) + ' <span class="chip">' + nf(x.docsDescuento) + ' fact.</span>' : '—'; } },
      { k: 'bajoHabDinero', t: 'Bajo el precio habitual', n: 1, f: function (v, x) { return x.bajoHab ? dinero(v) + ' <span class="chip">' + nf(x.bajoHab) + ' líneas</span>' : '—'; } });
    if (hayInv) cols.push({ k: 'bajoCosto', t: 'Bajo el costo', n: 1, f: function (v, x) { return v ? '<span style="color:var(--rojo)">' + nf(v) + ' líneas · ' + dinero(x.bajoCostoDinero) + '</span>' : '—'; } });
    cols.push(
      { k: 'pctIdent', t: 'Clientes identificados', n: 1, f: function (v, x) { return pct(v) + ' <span class="chip">' + nf(x.nClientes) + ' clientes</span>'; } },
      { k: 'ccf', t: 'Créditos fiscales', n: 1, f: function (v) { return nf(v); } },
      { k: 'anuladas', t: 'Anuladas', n: 1, f: function (v, x) { return v ? nf(v) + ' <span class="chip">' + pct(x.tasaAnul) + '</span>' : '—'; } });

    var repintar = function () {
      var l = ordenar(L, VEN.orden);
      /* «Sin vendedor» siempre al final: no es una persona. */
      l = l.filter(function (v) { return !v.sinNombre; }).concat(l.filter(function (v) { return v.sinNombre; }));
      $('ven-tabla').innerHTML = tablaHTML('ven', cols, l, VEN.orden);
    };
    repintar();
    alOrdenar($('ven-tabla'), VEN.orden, repintar);

    var top = conNombre.slice(0, 14);
    grafica($('g-ven'), { type: 'bar',
      data: { labels: top.map(function (v) { return v.nombre; }),
              datasets: [{ data: top.map(function (v) { return r2(v.conIva); }), backgroundColor: '#F15930' }] },
      options: { indexAxis: 'y', scales: { x: { ticks: { callback: function (v) { return '$' + nf(v); } } } } } });
    var etq = [], dias = [];
    for (var f = D.inicio, n = 0; f && f <= D.fin && n < 400; f = sumarDias(f, 1), n++) { dias.push(f); etq.push(f.slice(8, 10) + '/' + f.slice(5, 7)); }
    grafica($('g-ven-dia'), { type: 'line',
      data: { labels: etq, datasets: conNombre.slice(0, 6).map(function (v, i) {
        return { label: v.nombre, data: dias.map(function (d) { return r2(v.porDia[d] || 0); }),
                 borderColor: COLORES[i], backgroundColor: COLORES[i], pointRadius: 0, borderWidth: 2, tension: 0.2 };
      }) },
      options: { plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12 } } },
                 scales: { y: { ticks: { callback: function (v) { return '$' + nf(v); } } } } } });

    var detalle = function () {
      /* Sin elegir, el primero que vendió (no «sin vendedor»). */
      var v = (VEN.ver != null && L.find(function (x) { return x.clave === VEN.ver; })) || conNombre[0] || L[0];
      if (!v) { $('ven-det').innerHTML = ''; return; }
      VEN.ver = v.clave;
      var horas = v.porHora, h0 = horas.findIndex(function (x) { return x > 0; }), h1 = 23;
      while (h1 > 0 && !horas[h1]) h1--;
      $('ven-det').innerHTML =
        '<div class="tb-kpis">' +
          kpi(dinero(v.conIva), 'Ventas con IVA', 'n') + kpi(nf(v.docs), 'Documentos') + kpi(dinero(v.ticket), 'Ticket promedio') +
          (hayInv ? kpi(v.margenPct == null ? '—' : pct(v.margenPct), 'Margen %', 'a') : '') +
          kpi(dinero(v.descuento), 'Descuentos dados') + kpi(dinero(v.bajoHabDinero), 'Dejado de cobrar (bajo el habitual)') +
        '</div>' +
        '<div class="tb-graficas">' +
          '<div class="tb-graf"><h3>Lo que más vende</h3>' + tablaHTML('x', [
            { k: 'nombre', t: 'Producto' }, { k: 'u', t: 'Unidades', n: 1, f: function (x) { return nf(x, x % 1 ? 2 : 0); } },
            { k: 'v', t: 'Venta con IVA', n: 1, f: dinero }], v.top.slice(0, 10)) + '</div>' +
          '<div class="tb-graf"><h3>Documentos por hora</h3><div class="lienzo"><canvas id="g-ven-hora"></canvas></div></div>' +
        '</div>' +
        (v.detalleBajo.length ? '<h3>Vendido más barato que lo habitual</h3>' + tablaHTML('x', [
            { k: 'fecha', t: 'Fecha', f: fechaBonita }, { k: 'codigo', t: 'Código', cls: 'cod' }, { k: 'nombre', t: 'Producto' },
            { k: 'cant', t: 'Cant.', n: 1, f: function (x) { return nf(x, x % 1 ? 2 : 0); } },
            { k: 'cobrado', t: 'Cobrado c/u', n: 1, f: dinero }, { k: 'habitual', t: 'Habitual c/u', n: 1, f: dinero },
            { k: 'dif', t: 'Diferencia', n: 1, f: dinero }], v.detalleBajo.slice(0, 30)) +
            (v.detalleBajo.length > 30 ? '<p class="tb-nota">Se ven 30 de ' + nf(v.detalleBajo.length) + ' (las de más diferencia).</p>' : '') : '') +
        (v.docsAnulados.length ? '<h3>Documentos anulados</h3>' + tablaHTML('x', [
            { k: 'cod', t: 'Código de generación', cls: 'cod' }, { k: 'fecha', t: 'Fecha', f: fechaBonita },
            { k: 'receptor', t: 'Cliente' }, { k: 'total', t: 'Total', n: 1, f: dinero }], v.docsAnulados.slice(0, 50)) : '');
      if (h0 >= 0) {
        var eh = [], vh = [];
        for (var h = h0; h <= h1; h++) { eh.push(h + ' h'); vh.push(horas[h]); }
        grafica($('g-ven-hora'), { type: 'bar', data: { labels: eh, datasets: [{ data: vh, backgroundColor: '#0475BB' }] } });
      }
    };
    detalle();

    $('ven-ver').addEventListener('change', function (e) { VEN.ver = e.target.value; detalle(); });
    $('ven-campo').addEventListener('change', function (e) {
      P.campoVendedor = e.target.value; guardarParam();
      D.campoVendedor = e.target.value; VEN.ver = null;
      pintarLectura(); pintarContenido();
    });
    $('ven-excel').addEventListener('click', function () { descargarVendedores(L, cActual); });
  }

  /* ---------- 9.7 Calidad de datos (gerencia) ---------- */
  var PAGOS = { '01': 'Billetes y monedas', '02': 'Tarjeta débito', '03': 'Tarjeta crédito', '04': 'Cheque',
                '05': 'Transferencia', '08': 'Dinero electrónico', '09': 'Monedero electrónico', '11': 'Bitcoin',
                '12': 'Otras criptomonedas', '13': 'Cuentas por pagar del receptor', '14': 'Giro bancario', '99': 'Otros' };
  var CONDICION = { '1': 'Contado', '2': 'A crédito', '3': 'Otro' };

  function seccion(titulo, n, nota, cuerpo, abierta) {
    return '<details class="tb-bloque"' + (abierta ? ' open' : '') + '><summary><b>' + titulo + '</b> — ' + n + '</summary>' +
      (nota ? '<p class="tb-nota">' + nota + '</p>' : '') + (cuerpo || '') + '</details>';
  }

  function pintarCalidad(box) {
    var I = ESTADO.inv, Z = ESTADO.zip, h = '';

    /* Lo que se dejó fuera de las ventas, y por qué. */
    var tabDocs = function (docs) {
      return tablaHTML('x', [
        { k: 'cod', t: 'Código de generación', cls: 'cod' }, { k: 'tipo', t: 'Tipo' },
        { k: 'fecha', t: 'Fecha', f: fechaBonita }, { k: 'nombre', t: 'Receptor', h: function (d) { return esc(d.receptor.nombre); } },
        { k: 'conIva', t: 'Total', n: 1, f: dinero },
      ], docs.slice(0, 200));
    };
    h += seccion('Documentos fuera de las ventas',
      nf(D.compras14.length + D.otrosTipos.length + D.anuladosReg.length + D.invalidadosXls.length + Z.anulaciones.length),
      'Tipo 14 (sujeto excluido) es una <b>compra</b>. Los registros de anulación no son ventas. ' +
      (ESTADO.xls ? 'Lo que el Excel de FelTec marca INVALIDADO tampoco cuenta, aunque venga en el ZIP.' :
                    'Cargá el Excel de ventas para descartar también lo que FelTec marca INVALIDADO.'),
      '<div class="tb-cifras" style="margin-bottom:10px">' +
        '<div><span>Tipo 14 (compras)</span><b>' + nf(D.compras14.length) + '</b></div>' +
        '<div><span>Otros tipos de DTE</span><b>' + nf(D.otrosTipos.length) + '</b></div>' +
        '<div><span>Registros de anulación</span><b>' + nf(Z.anulaciones.length) + '</b></div>' +
        '<div><span>· que apuntan a un documento del ZIP</span><b>' + nf(Z.anulaciones.filter(function (a) { return a.enZip; }).length) + '</b></div>' +
        '<div><span>Documentos anulados (excluidos)</span><b>' + nf(D.anuladosReg.length) + '</b></div>' +
        '<div><span>INVALIDADO según el Excel (excluidos)</span><b>' + nf(D.invalidadosXls.length) + '</b></div>' +
        '<div><span>JSON ilegibles / no de FelTec</span><b>' + nf(Z.ilegibles.length + Z.desconocidos.length) + '</b></div>' +
      '</div>' +
      (D.invalidadosXls.length ? '<h3>INVALIDADO según el Excel, que sí vienen en el ZIP</h3>' + tabDocs(D.invalidadosXls) : '') +
      (D.compras14.length ? '<h3>Tipo 14 (compras)</h3>' + tabDocs(D.compras14) : '') +
      (D.otrosTipos.length ? '<h3>Otros tipos</h3>' + tabDocs(D.otrosTipos) : ''), true);

    /* Cuadre con el Excel de ventas. */
    if (D.cuadre) {
      var c = D.cuadre;
      var dif = c.sumaVentasExcel - c.sumaVentasZip;
      h += seccion('Cuadre con el Excel de ventas',
        (c.soloExcel.length + c.soloZip.length + c.totalesDistintos.length) ? 'hay diferencias' : 'cuadra',
        'Se cruza por <b>código de generación</b>. Total del Excel (FACTURADA, de los documentos que están en los dos): ' +
        dinero(c.sumaVentasExcel) + ' · total a pagar en el ZIP de esos mismos: ' + dinero(c.sumaVentasZip) +
        (Math.abs(dif) > 0.01 ? ' · diferencia ' + dinero(dif) : ' · <b>cuadra</b>') + '.',
        '<div class="tb-cifras" style="margin-bottom:10px">' +
          '<div><span>FACTURADA en el Excel y no en el ZIP</span><b>' + nf(c.soloExcel.length) + '</b></div>' +
          '<div><span>En el ZIP y no en el Excel</span><b>' + nf(c.soloZip.length) + '</b></div>' +
          '<div><span>FACTURADA en el Excel pero es tipo 14 (compra)</span><b>' + nf(c.facturadaEsCompra.length) + '</b></div>' +
          '<div><span>Con total distinto</span><b>' + nf(c.totalesDistintos.length) + '</b></div>' +
          '<div><span>INVALIDADO sin documento en el ZIP (lo normal)</span><b>' + nf(c.invalidadosSinZip) + '</b></div>' +
          '<div><span>· de esos, con su registro de anulación en el ZIP</span><b>' + nf(c.invalidadosConAnulacion) + '</b></div>' +
        '</div>' +
        (c.soloExcel.length ? '<h3>FACTURADA en el Excel que no vienen en el ZIP</h3>' + tablaHTML('x', [
            { k: 'cod', t: 'Código de generación', cls: 'cod' }, { k: 'fecha', t: 'Fecha', f: fechaBonita },
            { k: 'razon', t: 'Razón social' }, { k: 'total', t: 'Total venta', n: 1, f: dinero }], c.soloExcel.slice(0, 200)) : '') +
        (c.soloZip.length ? '<h3>En el ZIP que no están en el Excel</h3>' + tabDocs(c.soloZip) : '') +
        (c.totalesDistintos.length ? '<h3>Totales que no cuadran</h3>' + tablaHTML('x', [
            { k: 'cod', t: 'Código de generación', cls: 'cod', h: function (x) { return esc(x.f.cod); } },
            { k: 'fecha', t: 'Fecha', h: function (x) { return fechaBonita(x.doc.fecha); } },
            { k: 'excel', t: 'Excel', n: 1, h: function (x) { return dinero(x.f.total); } },
            { k: 'zip', t: 'ZIP (total a pagar)', n: 1, h: function (x) { return dinero(x.doc.totalPagar); } }],
            c.totalesDistintos.slice(0, 200)) : ''), true);
    } else {
      h += '<div class="tb-aviso info">Para el cuadre con Hacienda, arrastrá también el <b>Excel de ventas</b> de FelTec del mismo período.</div>';
    }

    if (I) {
      /* Códigos del DTE que no existen en el inventario. */
      var noInv = [];
      D.prods.forEach(function (p, clave) {
        if (!I.items.has(clave)) noInv.push({ codigo: codigoVisible(clave), nombre: p.listaNombres.join(' / '), cant: p.cant, venta: p.sinIva });
      });
      noInv.sort(function (a, b) { return b.venta - a.venta; });
      h += seccion('Códigos del DTE que no están en el inventario', nf(noInv.length),
        'Se vendieron con un código que el reporte de inventario no trae: no tienen existencia ni costo para el pedido ni el margen.',
        tablaHTML('x', [{ k: 'codigo', t: 'Código', cls: 'cod' }, { k: 'nombre', t: 'Descripción en el DTE' },
          { k: 'cant', t: 'Vendido', n: 1, f: function (v) { return nf(v, v % 1 ? 2 : 0); } },
          { k: 'venta', t: 'Venta sin IVA', n: 1, f: dinero }], noInv.slice(0, 300)));

      /* Sin costo. */
      var sinCosto = [];
      D.prods.forEach(function (p, clave) {
        var it = I.items.get(clave);
        if (it && it.sinCosto) sinCosto.push({ codigo: String(it.item), nombre: it.nombre, cant: p.cant, venta: p.sinIva });
      });
      sinCosto.sort(function (a, b) { return b.venta - a.venta; });
      h += seccion('Productos vendidos sin costo registrado', nf(sinCosto.length) + ' (de ' + nf(I.sinCosto) + ' sin costo en todo el inventario)',
        'C. COMPRA = 0 en FelTec es «sin costo registrado», no costo cero. Estos no entran en el margen.',
        tablaHTML('x', [{ k: 'codigo', t: 'Código', cls: 'cod' }, { k: 'nombre', t: 'Producto' },
          { k: 'cant', t: 'Vendido', n: 1, f: function (v) { return nf(v, v % 1 ? 2 : 0); } },
          { k: 'venta', t: 'Venta sin IVA', n: 1, f: dinero }], sinCosto.slice(0, 300)));

      /* Existencias negativas. */
      var neg = [];
      I.items.forEach(function (it, clave) {
        if (it.negativa) { var p = D.prods.get(clave); neg.push({ codigo: String(it.item), nombre: it.nombre, unidad: it.unidad, existencia: it.existencia, vendido: p ? p.cant : 0 }); }
      });
      neg.sort(function (a, b) { return a.existencia - b.existencia; });
      h += seccion('Existencias negativas', nf(neg.length),
        'Casi siempre es la unidad de medida en FelTec (por ejemplo, cable vendido por metro e ingresado por rollo). ' +
        'Para el pedido sugerido se toman como 0.',
        tablaHTML('x', [{ k: 'codigo', t: 'Código', cls: 'cod' }, { k: 'nombre', t: 'Producto' }, { k: 'unidad', t: 'Unidad' },
          { k: 'existencia', t: 'Existencia', n: 1, f: function (v) { return nf(v, v % 1 ? 2 : 0); } },
          { k: 'vendido', t: 'Vendido', n: 1, f: function (v) { return nf(v, v % 1 ? 2 : 0); } }], neg.slice(0, 300)));
    }

    /* Más de un nombre para el mismo código. */
    var varios = [];
    D.prods.forEach(function (p, clave) {
      if (p.listaNombres.length > 1) varios.push({ codigo: codigoVisible(clave), nombres: p.listaNombres.map(function (n) { return n + ' (' + p.nombres[n] + ')'; }) });
    });
    h += seccion('Productos con más de un nombre', nf(varios.length),
      'El mismo código con descripciones distintas en las facturas. El tablero los cuenta como UN producto (siempre por código).',
      tablaHTML('x', [{ k: 'codigo', t: 'Código', cls: 'cod' },
        { k: 'nombres', t: 'Nombres en los DTE', h: function (f) { return f.nombres.map(function (n) { return '<span class="chip">' + esc(n) + '</span>'; }).join(' '); } }],
        varios.slice(0, 300)));

    /* Formas de pago y condición. */
    var pagos = {}, cond = {};
    D.ventas.forEach(function (doc) {
      (doc.pagos.length ? doc.pagos : ['(sin dato)']).forEach(function (p) { pagos[p] = (pagos[p] || 0) + 1; });
      cond[doc.condicion || '(sin dato)'] = (cond[doc.condicion || '(sin dato)'] || 0) + 1;
    });
    var lista = function (obj, nombres) {
      return Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; }).map(function (k) {
        return '<div><span>' + esc(k) + (nombres[k] ? ' · ' + nombres[k] : '') + '</span><b>' + nf(obj[k]) + '</b></div>';
      }).join('');
    };
    h += seccion('Formas de pago y condición de la operación', Object.keys(pagos).length + ' forma(s)',
      'Solo informativo: hoy FelTec manda casi todo como 01 (efectivo) y 1 (contado), así que no sirve para sacar conclusiones.',
      '<div class="tb-cifras"><div><b>Forma de pago</b><span></span></div>' + lista(pagos, PAGOS) +
      '<div><b>Condición</b><span></span></div>' + lista(cond, CONDICION) + '</div>');

    box.innerHTML = h;
  }

  /* ======================= 10. DESCARGAR EL PEDIDO ======================== */
  /* Solo las filas con pedido > 0, de lo que se está viendo (con filtros). En
     la vista de empleados no lleva costos. Se arma aquí y se descarga: no pasa
     por el sitio. */
  function descargarPedido(filas) {
    var l = filas.filter(function (f) { return f.pedido > 0; });
    if (!l.length) { mostrarError('No hay productos con pedido en lo que estás viendo.'); return; }
    var enc = ['Código', 'Producto', 'Categoría', 'Unidad', 'Existencia', 'Vendido en el período', 'Venta diaria',
               'Días de cobertura', 'Pedido sugerido'];
    if (GERENCIA) enc.push('Costo unitario', 'Costo del pedido');
    var aoa = [
      ['Pedido sugerido — Ferretería San José'],
      ['Ventas del ' + fechaBonita(D.inicio) + ' al ' + fechaBonita(D.fin) + ' (' + D.dias + ' días)' +
        (ESTADO.inv ? ' · inventario del ' + fechaBonita(ESTADO.inv.fecha) : '')],
      ['Tiempo de entrega ' + P.entrega + ' días · seguridad ' + P.seguridad + ' días · cobertura objetivo ' + P.cobertura + ' días'],
      [],
      enc,
    ];
    l.forEach(function (f) {
      var fila = [Number(f.codigo) || f.codigo, f.nombre, f.categoria, f.unidad, f.existencia, r2(f.vendido),
                  r2(f.ventaDiaria), f.cobertura == null ? '' : Math.round(f.cobertura * 10) / 10, f.pedido];
      if (GERENCIA) fila.push(f.sinCosto ? '' : r2(f.costo), f.costoPedido ? r2(f.costoPedido) : '');
      aoa.push(fila);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 10 }, { wch: 46 }, { wch: 22 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 12 },
                   { wch: 12 }, { wch: 12 }, { wch: 14 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pedido');
    XLSX.writeFile(wb, 'pedido-sugerido-' + hoyTexto() + '.xlsx');
  }

  /* Resumen por vendedor en Excel (para la planilla y las comisiones). Se arma
     aquí y se descarga: no pasa por el sitio. */
  function descargarVendedores(L, campo) {
    var hayInv = !!ESTADO.inv;
    var enc = ['Vendedor', 'Ventas con IVA', 'Ventas sin IVA', '% del total', 'Documentos', 'Facturas', 'Créditos fiscales',
               'Ticket promedio', 'Productos por factura', 'Días con venta', 'Venta por día trabajado'];
    if (hayInv) enc.push('Margen $', 'Margen %');
    enc.push('Descuentos dados', 'Líneas bajo el precio habitual', 'Dejado de cobrar', 'Clientes identificados %',
             'Clientes distintos', 'Anuladas');
    if (hayInv) enc.push('Líneas bajo el costo');
    var aoa = [['Ventas por vendedor — Ferretería San José'],
      ['Del ' + fechaBonita(D.inicio) + ' al ' + fechaBonita(D.fin) + ' (' + D.dias + ' días) · vendedor según: ' + campo.etiqueta],
      [], enc];
    L.forEach(function (v) {
      var f = [v.nombre, r2(v.conIva), r2(v.sinIva), Math.round(v.share * 1000) / 10, v.docs, v.facturas, v.ccf,
               r2(v.ticket), Math.round(v.lineasDoc * 10) / 10, v.diasActivos, r2(v.ventaDia)];
      if (hayInv) f.push(r2(v.margen), v.margenPct == null ? '' : Math.round(v.margenPct * 1000) / 10);
      f.push(r2(v.descuento), v.bajoHab, r2(v.bajoHabDinero), Math.round(v.pctIdent * 1000) / 10, v.nClientes, v.anuladas);
      if (hayInv) f.push(v.bajoCosto);
      aoa.push(f);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = enc.map(function (e, i) { return { wch: i === 0 ? 34 : 14 }; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Vendedores');
    XLSX.writeFile(wb, 'ventas-por-vendedor-' + hoyTexto() + '.xlsx');
  }

  /* ===================== ARRANQUE: arrastrar y elegir archivos ============= */
  function arrancar() {
    $('tb-subtitulo').textContent = GERENCIA ? 'Tablero de gerencia' : 'Tablero de pedidos';
    document.title = (GERENCIA ? 'Tablero de gerencia' : 'Tablero de pedidos') + ' — Ferretería San José';
    var zona = $('tb-zona'), input = $('tb-archivos');
    zona.addEventListener('click', function () { input.click(); });
    zona.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', function () { procesarArchivos(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add('encima'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.remove('encima'); });
    });
    /* Soltar en cualquier parte del tablero también sirve (y así el navegador
       no abre el archivo por su cuenta si se suelta un poco fuera). */
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!$('tb-app').hidden && e.dataTransfer && e.dataTransfer.files.length) procesarArchivos(e.dataTransfer.files);
    });
    $('tb-pestanas').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-p]'); if (!b) return;
      pestana = b.dataset.p;
      pintarPestanas();
      pintarContenido();
    });
    if (typeof Chart !== 'undefined') {
      Chart.defaults.font.family = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
      Chart.defaults.color = '#5b554c';
    }
    /* Si el candado no cargó (por ejemplo, abriendo el archivo sin el sitio),
       se avisa en vez de dejar la página en blanco. */
    setTimeout(function () {
      if (!window.FSJAcceso && $('tb-app').hidden && $('tb-bloqueo').hidden) {
        var b = $('tb-bloqueo');
        b.hidden = false;
        b.innerHTML = '<h1>No se pudo cargar el acceso</h1><p>Abrí el tablero desde el sitio ' +
          '(ferreteriasnjose.com/empleados/tablero/) y revisá el internet.</p>';
      }
    }, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();
})();
