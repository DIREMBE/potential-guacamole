/* ==========================================================================
   Análisis de inventario — la parte que piensa
   Ferretería San José

   Aquí vive TODO lo que sabe leer el reporte de FelTec y sacarle conclusiones:
   reconocer las columnas, detectar errores, calcular el dinero, deducir la
   marca del nombre, y armar el sugerido de compras y las promociones.

   No dibuja nada. No sabe de botones ni de tablas. Por eso lo pueden usar dos
   pantallas distintas —el análisis completo y el panel de inventario— sin
   copiar y pegar, que es como se desincronizan las cosas.

   Se usa así:   Analisis.columnas(cab) · Analisis.analizar(filas, col)
                 Analisis.detectar(D)   · Analisis.metricas(D)
                 Analisis.compras(D, dias, objetivo) · Analisis.congelado(D)
   ========================================================================== */
window.Analisis = (function () {
  'use strict';

  /* Formateo: lo usan los textos de los errores ("1.234 productos"). Se
     define aquí para que el módulo no dependa de la página que lo cargue. */
  var nf=function(n){return Number(n||0).toLocaleString('es-SV');};
  var money=function(n){return 'US$'+(Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});};
  var money0=function(n){return 'US$'+(Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:0});};

  /* ---------------- Umbrales de detección (ajustables) ---------------- */
  var STOCK_CENTINELA = 9000;    // existencias así de altas suelen ser un error/"sin control"
  var MARGEN_ALTO     = 300;     // % de margen que hace sospechar de un error de precio
  var IVA             = 0.13;    // El Salvador
  /* FelTec a veces escribe en la columna de precio de venta el costo + IVA, o
     directamente el doble del costo. Ninguno de los dos es un precio de venta:
     publicarlos sería vender al costo. Se detectan por la proporción exacta. */
  var esCostoConIVA = function(p){ return p.compra>0 && p.venta>0 && Math.abs(p.venta/p.compra-(1+IVA))<0.005; };
  var esCostoDoble  = function(p){ return p.compra>0 && p.venta>0 && Math.abs(p.venta/p.compra-2)<0.02; };
  var num=function(v){ var n=parseFloat(String(v==null?'':v).replace(/,/g,'').replace(/\s/g,'')); return isFinite(n)?n:0; };


  function columnas(cab){
    var H=cab.map(function(h){return String(h==null?'':h).trim().toUpperCase();});
    function buscar(){ for(var i=0;i<arguments.length;i++){var k=H.indexOf(arguments[i]); if(k>=0) return k;} return -1; }
    return {
      item:buscar('ITEM','CODIGO','ID'), nombre:buscar('PRODUCTO','DESCRIPCION','NOMBRE'),
      cat:buscar('CATEGORIA','CATEGORÍA'), uni:buscar('UNIDAD MEDIDA','UNIDAD'),
      saldo:buscar('SALDO ANTERIOR','SALDO'), ent:buscar('ENTRADA','ENTRADAS'),
      sal:buscar('SALIDA','SALIDAS'), exist:buscar('EXISTENCIA','STOCK'),
      venta:buscar('C. VENTA','PRECIO VENTA','PRECIO'), tventa:buscar('C. T. VENTA'),
      compra:buscar('C. COMPRA','COSTO','COSTO UNITARIO'), costot:buscar('COSTO TOTAL')
    };
  }
  function esProducto(v){
    var s=String(v==null?'':v).trim();
    if(!s) return false;
    if(/^totales?\s*:?$/i.test(s)) return false;
    return /\d/.test(s);
  }

  function analizar(filas, col){
    var d=[], descartadas=0;
    for(var i=1;i<filas.length;i++){
      var f=filas[i];
      if(!f || !f.length){ continue; }
      if(!esProducto(f[col.item])){ descartadas++; continue; }
      d.push({
        item:String(f[col.item]).trim(),
        nombre:String(f[col.nombre]==null?'':f[col.nombre]).trim(),
        cat:col.cat>=0?String(f[col.cat]||'').trim():'',
        uni:col.uni>=0?String(f[col.uni]||'').trim():'',
        saldo:num(f[col.saldo]), ent:num(f[col.ent]), sal:num(f[col.sal]),
        exist:num(f[col.exist]), venta:num(f[col.venta]), tventa:num(f[col.tventa]),
        compra:num(f[col.compra]), costot:num(f[col.costot])
      });
    }
    return {filas:d, descartadas:descartadas};
  }

  /* --------------------------- Detección de errores -------------------- */
  function detectar(D){
    var A=[];
    var vistos={}, dups=[];
    D.forEach(function(p){ if(vistos[p.item]) dups.push(p); else vistos[p.item]=1; });

    var centinela = D.filter(function(p){ return p.exist >= STOCK_CENTINELA; });
    var negativos = D.filter(function(p){ return p.exist < 0; });
    var stockSinPrecio = D.filter(function(p){ return p.exist > 0 && p.venta <= 0; });
    var bajoCosto = D.filter(function(p){ return p.venta > 0 && p.compra > 0 && p.venta < p.compra; });
    var margenRaro = D.filter(function(p){ return p.venta>0 && p.compra>0 && ((p.venta-p.compra)/p.compra*100) > MARGEN_ALTO; });
    var sinCosto = D.filter(function(p){ return p.compra <= 0 && p.exist > 0; });
    var sinNombre = D.filter(function(p){ return !p.nombre; });
    var sinCat = D.filter(function(p){ return !p.cat; });
    var descuadre = D.filter(function(p){ return Math.abs((p.saldo + p.ent - p.sal) - p.exist) > 0.009; });
    var salioSinStock = D.filter(function(p){ return p.sal > 0 && p.exist <= 0; });
    var precioEsIVA = D.filter(esCostoConIVA);
    var precioEsDoble = D.filter(esCostoDoble);

    function reg(clave,nivel,titulo,desc,lista,cols){ if(lista.length) A.push({clave:clave,nivel:nivel,titulo:titulo,desc:desc,lista:lista,cols:cols}); }

    var C_STOCK=[['item','ITEM'],['nombre','Producto'],['exist','Existencia'],['uni','Unidad'],['venta','Precio']];
    var C_PRECIO=[['item','ITEM'],['nombre','Producto'],['compra','Costo'],['venta','Venta'],['exist','Existencia']];

    var C_IVA=[['item','ITEM'],['nombre','Producto'],['compra','Costo'],['venta','"Venta" del archivo'],['exist','Existencia']];
    reg('precioiva','grave','El "precio de venta" es el costo + IVA',
        'En estos, el número de la columna de venta es exactamente el costo más el 13% de IVA. ' +
        'No es un precio de venta: si se publica, se le está vendiendo al cliente al costo. ' +
        'El precio real está en el sistema pero NO viaja en este archivo: hay que ponerlo a mano.',
        precioEsIVA, C_IVA);
    reg('preciodoble','grave','El "precio de venta" es el doble del costo',
        'Aquí la columna de venta trae exactamente el costo multiplicado por dos. Es el otro ' +
        'error conocido de FelTec. Puede coincidir con el precio real, pero conviene revisarlo ' +
        'uno por uno antes de publicarlo.',
        precioEsDoble, C_IVA);

    reg('centinela','grave','Existencias imposibles',
        'Cantidades enormes (≥ '+nf(STOCK_CENTINELA)+'). Suelen ser un error de digitación o un producto "sin control de stock". Inflan el valor del inventario.',
        centinela, C_STOCK);
    reg('negativos','grave','Existencias negativas',
        'Se vendió más de lo que había registrado. Indica faltantes de ingreso o errores de conteo.',
        negativos, C_STOCK);
    reg('bajocosto','grave','Se venden por debajo del costo',
        'El precio de venta es menor que el costo de compra: cada venta genera pérdida.',
        bajoCosto, C_PRECIO);
    reg('sinprecio','medio','Con existencia pero sin precio de venta',
        'Hay producto en bodega que no se puede cotizar ni aparece en el catálogo.',
        stockSinPrecio, C_STOCK);
    reg('margen','medio','Margen sospechosamente alto',
        'Margen mayor a '+MARGEN_ALTO+'%. Puede ser correcto, pero conviene revisar si falta un decimal.',
        margenRaro, C_PRECIO);
    reg('sincosto','medio','Con existencia pero sin costo de compra',
        'Sin costo no se puede calcular la ganancia ni valorar el inventario correctamente.',
        sinCosto, C_PRECIO);
    reg('descuadre','medio','No cuadra el movimiento',
        'Saldo anterior + entradas − salidas no coincide con la existencia.',
        descuadre, [['item','ITEM'],['nombre','Producto'],['saldo','Saldo ant.'],['ent','Entradas'],['sal','Salidas'],['exist','Existencia']]);
    reg('saliosinstock','leve','Salidas sin existencia',
        'Tuvo salidas en el periodo y quedó en cero o menos. Revisa si falta reponer.',
        salioSinStock, C_STOCK);
    reg('dups','leve','ITEM repetido', 'El mismo código aparece más de una vez.', dups, C_STOCK);
    reg('sinnombre','leve','Sin nombre de producto','Filas sin descripción.', sinNombre, C_STOCK);
    reg('sincat','leve','Sin categoría','No se podrán filtrar en el catálogo.', sinCat, C_STOCK);
    return A;
  }

  /* ------------------------------ Métricas ---------------------------- */

  function metricas(D){
    var normales = D.filter(function(p){ return p.exist < STOCK_CENTINELA; });
    function val(l,campo){ return l.reduce(function(a,p){ return a + (p.exist>0 ? p.exist*p[campo] : 0); },0); }
    /* Para el margen solo cuentan los productos con un precio de venta de
       verdad: los que traen costo+IVA o el doble del costo ensucian la cuenta
       (con ellos el "margen mediano" da 13%, que es el IVA, no una ganancia). */
    var conPrecioReal = D.filter(function(p){
      return p.venta>0 && p.compra>0 && !esCostoConIVA(p) && !esCostoDoble(p);
    });
    var margenes = conPrecioReal.map(function(p){return (p.venta-p.compra)/p.compra*100;})
                                .sort(function(a,b){return a-b;});
    var vendido = D.reduce(function(a,p){ return a + (p.exist<STOCK_CENTINELA ? p.tventa : 0); },0);
    return {
      total:D.length,
      conStock:D.filter(function(p){return p.exist>0;}).length,
      sinStock:D.filter(function(p){return p.exist<=0;}).length,
      conPrecio:D.filter(function(p){return p.venta>0;}).length,
      sinPrecio:D.filter(function(p){return p.venta<=0;}).length,
      categorias:Object.keys(D.reduce(function(m,p){ if(p.cat) m[p.cat]=1; return m; },{})).length,
      valorCosto:val(normales,'compra'),
      valorVenta:val(normales,'venta'),
      margenMediano: margenes.length ? margenes[Math.floor(margenes.length/2)] : 0,
      conPrecioReal: conPrecioReal.length,
      precioSospechoso: D.filter(function(p){ return esCostoConIVA(p) || esCostoDoble(p); }).length,
      conMovimiento:D.filter(function(p){return p.sal>0;}).length,
      sinMovimiento:D.filter(function(p){return p.sal<=0 && p.exist>0;}).length,
      vendido:vendido,
      excluidos:D.length-normales.length
    };
  }

  function porCategoria(D){
    var m={};
    D.forEach(function(p){
      if(p.exist>=STOCK_CENTINELA) return;
      var c=p.cat||'(sin categoría)';
      if(!m[c]) m[c]={cat:c,n:0,stock:0,costo:0,venta:0};
      m[c].n++;
      if(p.exist>0){ m[c].stock++; m[c].costo+=p.exist*p.compra; m[c].venta+=p.exist*p.venta; }
    });
    return Object.keys(m).map(function(k){return m[k];}).sort(function(a,b){return b.costo-a.costo;});
  }

  /* ------------------------------ Pintado ------------------------------ */

  /* Las marcas se leen del propio nombre del producto: el reporte no trae
     columna de marca. Esta lista salió de contar las palabras que más se
     repiten en TUS 11.267 nombres, así que está hecha a la medida de lo que
     vendes. Para agregar una marca nueva, basta con escribirla aquí. */
  var MARCAS = ['TRUPER','STIHL','INGCO','TOTAL','PRETUL','DURMAN','WADFOW','LANCO',
    'FIERO','FOSET','EMTOP','VIKINGO','VOLTECK','ABRO','HERMEX','AMANCO','CEMEX',
    'DEWALT','MAKITA','STANLEY','YALE','KOHLER','TECNOLITE','CORINCA','HOLCIM',
    'HONDA','REFLEX','PFERD','IMACASA','SHERWIN','VALVOLINE','CASTROL','EVEREST',
    'PANDA','FORTALEZA','CESSA','ADIR','URREA','SURTEK','MIKELS','ROTOPLAS',
    'IRWIN','COFLEX','BRICKELL','NOVERA','EXPERT','EAGLE','ROCA','ENERGY','PALMA'];

  function marcaDe(nombre){
    var n = ' ' + String(nombre||'').toUpperCase().replace(/[^A-ZÑ0-9]/g,' ') + ' ';
    for(var i=0;i<MARCAS.length;i++){
      if(n.indexOf(' '+MARCAS[i]+' ')>=0) return MARCAS[i];
    }
    return '(sin marca)';
  }

  /* El nombre del archivo de FelTec lleva las dos fechas pegadas:
     Reporte_de_inventario 20260725 20260825 -> 31 días. Si no se puede leer,
     se dejan 30 y la persona lo corrige a mano. */
  function diasDelNombre(nombre){
    var d = String(nombre||'').replace(/\D/g,'');
    if(d.length < 16) return 0;
    var a = d.slice(d.length-16, d.length-8), b = d.slice(d.length-8);
    function fecha(t){
      var y=+t.slice(0,4), m=+t.slice(4,6), dd=+t.slice(6,8);
      if(y<2000||y>2100||m<1||m>12||dd<1||dd>31) return null;
      return new Date(y, m-1, dd);
    }
    var f1=fecha(a), f2=fecha(b);
    if(!f1||!f2) return 0;
    var n = Math.round((f2-f1)/86400000);
    return (n>0 && n<=400) ? n : 0;
  }

  /* Una existencia absurda (10 millones de cubetas de arena) no es inventario,
     es un error de digitación. Si se cuela, el sugerido y el dinero quieto
     salen disparatados, así que se deja fuera y se avisa aparte. */
  function usable(p){ return p.exist < STOCK_CENTINELA; }


  function calcularCompras(D, dias, objetivo){
    var lista = [];
    D.forEach(function(p){
      if(!usable(p)) return;
      var dia = p.sal / dias;
      if(!(dia > 0)) return;                       // sin movimiento: no se pide
      var exist = Math.max(0, p.exist);
      var cob = dia > 0 ? exist / dia : 0;
      if(cob >= objetivo) return;                  // aguanta de sobra
      var pedir = Math.ceil(dia * objetivo - exist);
      if(pedir <= 0) return;
      lista.push({
        item:p.item, nombre:p.nombre, cat:p.cat||'(sin categoría)', marca:marcaDe(p.nombre),
        sal:p.sal, exist:p.exist, dia:dia, cob:cob, pedir:pedir,
        compra:p.compra, venta:p.venta,
        costo: p.compra > 0 ? pedir * p.compra : 0,
        agotado: p.exist <= 0,
        urg: p.exist <= 0 ? 0 : (cob < 7 ? 0 : (cob < 15 ? 1 : 2))
      });
    });
    lista.sort(function(a,b){ return a.cob - b.cob; });
    return lista;
  }

  /* Promoción sugerida: nunca por debajo del costo. Se propone regalar la
     MITAD del margen, con tope del 40%, redondeado a múltiplos de 5. Si no se
     conoce el costo no se sugiere número: se marca para revisar a mano, que es
     más honesto que inventar un descuento que podría vender a pérdida. */
  function descuentoSugerido(p){
    if(!(p.venta > 0)) return { pct:0, motivo:'sin precio de venta' };
    /* FelTec escribe a veces el costo+IVA, o el doble del costo, en la columna
       del precio de venta. Eso NO es un precio: descontarle un 20% sería vender
       por debajo de lo que costó. Son 601 productos en el reporte de agosto,
       así que no es un caso raro. Se detectan por la proporción exacta y no se
       les sugiere nada. */
    if(esCostoConIVA(p)) return { pct:0, motivo:'el precio del archivo es costo+IVA' };
    if(esCostoDoble(p))  return { pct:0, motivo:'el precio del archivo es el doble del costo' };
    if(!(p.compra > 0)) return { pct:0, motivo:'falta el costo' };
    if(p.venta <= p.compra) return { pct:0, motivo:'ya está al costo' };
    var margen = (p.venta - p.compra) / p.venta;          // 0..1
    var pct = Math.floor(Math.min(0.40, margen / 2) * 100 / 5) * 5;
    if(pct < 5) return { pct:0, motivo:'margen muy corto' };
    return { pct:pct, motivo:'' };
  }

  function calcularCongelado(D){
    var lista = [];
    D.forEach(function(p){
      if(!usable(p)) return;
      if(!(p.exist > 0)) return;
      if(p.sal > 0) return;                        // se movió: no está congelado
      var d = descuentoSugerido(p);
      lista.push({
        item:p.item, nombre:p.nombre, cat:p.cat||'(sin categoría)', marca:marcaDe(p.nombre),
        exist:p.exist, venta:p.venta, compra:p.compra,
        dinero: p.compra > 0 ? p.exist * p.compra : 0,
        pct:d.pct, motivo:d.motivo,
        precioOferta: d.pct ? Math.round(p.venta * (1 - d.pct/100) * 100) / 100 : 0
      });
    });
    lista.sort(function(a,b){ return b.dinero - a.dinero; });
    return lista;
  }

  /* `por`: 'cat' | 'marca' | 'prov'. El proveedor no viene en el reporte de
     FelTec —no trae esa columna—, así que lo pone quien llama, en `p.prov`,
     a partir de la tabla marca→proveedor. Si no lo puso, todos caen en el
     mismo saco y se ve enseguida que falta asignarlos. */
  function agrupar(lista, por, sumar){
    var g = {};
    lista.forEach(function(p){
      var k = por === 'marca' ? p.marca
            : por === 'prov'  ? (p.prov || '(sin proveedor asignado)')
            : p.cat;
      if(!g[k]) g[k] = { nombre:k, items:[], total:0 };
      g[k].items.push(p);
      g[k].total += sumar(p);
    });
    return Object.keys(g).map(function(k){ return g[k]; })
      .sort(function(a,b){ return b.total - a.total || b.items.length - a.items.length; });
  }

  return {
    STOCK_CENTINELA: STOCK_CENTINELA, MARGEN_ALTO: MARGEN_ALTO, IVA: IVA,
    esCostoConIVA: esCostoConIVA, esCostoDoble: esCostoDoble, num: num,
    columnas: columnas, esProducto: esProducto, analizar: analizar,
    detectar: detectar, metricas: metricas, porCategoria: porCategoria,
    MARCAS: MARCAS, marcaDe: marcaDe, diasDelNombre: diasDelNombre,
    usable: usable, compras: calcularCompras, congelado: calcularCongelado,
    descuentoSugerido: descuentoSugerido, agrupar: agrupar,
    nf: nf, money: money, money0: money0,
  };
})();
