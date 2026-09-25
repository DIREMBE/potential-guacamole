/* ==========================================================================
   Pantalla de carga — Ferretería San José

   Solo aparece si la página tarda: los primeros 350 ms no se ve nada, así
   que en una carga normal ni se nota. Si tarda, en el centro se va
   levantando un muro de bloques, uno por uno, y vuelve a empezar mientras
   haga falta. Debajo, una frase que va cambiando.

   Se pone justo después de <body>:
     <script src="cargando.js"></script>                      se quita al cargar
     <script src="cargando.js" data-espera="inventario"></script>
                                    se quita cuando el inventario está listo
     <script src="cargando.js" data-espera="contenido"></script>
                                    se quita cuando la página ya pintó algo
   Y data-tema="claro" para las pantallas de fondo claro.

   Nunca se queda para siempre: a los 25 segundos se quita sola.
   ========================================================================== */
(function () {
  'use strict';
  if (window.FSJ_CARGA) return;

  var yo = document.currentScript || {};
  var espera = (yo.dataset && yo.dataset.espera) || '';
  var claro = !!(yo.dataset && yo.dataset.tema === 'claro');

  var FRASES = [
    'Construyendo algo para ti…',
    'Ordenando la bodega…',
    'Midiendo dos veces, cortando una…',
    'Buscando la herramienta correcta…',
    'Apretando los últimos tornillos…',
  ];

  var CSS =
    '#fsj-carga{position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;' +
    '  background:' + (claro ? '#f6f5f3' : '#0C2036') + ';opacity:0;pointer-events:none;' +
    '  animation:fc-entra .3s ease .35s forwards;transition:opacity .3s ease}' +
    '#fsj-carga.fuera{opacity:0!important;animation:none}' +
    '@keyframes fc-entra{to{opacity:1;pointer-events:auto}}' +
    '#fsj-carga .fc-in{display:flex;flex-direction:column;align-items:center;gap:18px;padding:24px;text-align:center}' +
    '#fsj-carga svg{width:132px;height:auto;overflow:visible}' +
    /* Cada bloque cae en su sitio, uno tras otro; al final el muro se va y
       vuelve a empezar. Un ciclo dura 3,6 s. */
    '#fsj-carga .b{opacity:0;transform-box:fill-box;transform-origin:center;animation:fc-bloque 3.6s ease-in-out infinite}' +
    '@keyframes fc-bloque{0%{opacity:0;transform:translateY(-16px)}' +
    '  7%{opacity:1;transform:translateY(0)}78%{opacity:1;transform:translateY(0)}' +
    '  90%,100%{opacity:0;transform:translateY(0)}}' +
    '#fsj-carga .suelo{stroke:' + (claro ? '#b3ab9d' : '#2D4A66') + '}' +
    '#fsj-carga .fc-barra{width:132px;height:3px;border-radius:3px;overflow:hidden;' +
    '  background:' + (claro ? '#e9e6e1' : 'rgba(255,255,255,.1)') + '}' +
    '#fsj-carga .fc-barra span{display:block;height:100%;width:100%;background:#F06030;' +
    '  transform-origin:left;animation:fc-barra 3.6s ease-in-out infinite}' +
    '@keyframes fc-barra{0%{transform:scaleX(0)}78%{transform:scaleX(1);opacity:1}90%,100%{transform:scaleX(1);opacity:0}}' +
    '#fsj-carga .fc-txt{margin:0;font:600 16px/1.3 "Barlow","Barlow Condensed",system-ui,sans-serif;' +
    '  letter-spacing:.02em;color:' + (claro ? '#544c42' : '#BDD0E1') + ';min-height:1.3em;transition:opacity .25s}' +
    '#fsj-carga .fc-marca{margin:0;font:700 11px/1 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.22em;' +
    '  text-transform:uppercase;color:' + (claro ? '#8b8175' : '#5D7A95') + '}' +
    '@media (prefers-reduced-motion:reduce){#fsj-carga .b{animation:none;opacity:1}' +
    '  #fsj-carga .fc-barra span{animation:none;transform:scaleX(.6)}}';

  /* El muro: tres hileras trabadas, como se pega el bloque. Naranja y azul,
     los colores de la casa. */
  var FILAS = [
    { y: 58, bloques: [[0, 38], [41, 38], [82, 38]] },
    { y: 37, bloques: [[0, 18], [21, 38], [62, 38], [103, 17]] },
    { y: 16, bloques: [[0, 38], [41, 38], [82, 38]] },
  ];
  var n = 0, rects = '';
  FILAS.forEach(function (f, fi) {
    f.bloques.forEach(function (b) {
      var color = (n % 3 === 1) ? '#0070C0' : '#F06030';
      rects += '<rect class="b" x="' + b[0] + '" y="' + f.y + '" width="' + b[1] + '" height="18" rx="2.5" ' +
        'fill="' + color + '" style="animation-delay:' + (n * 0.22).toFixed(2) + 's"/>';
      n++;
    });
  });
  var SVG = '<svg viewBox="0 0 120 80" aria-hidden="true">' + rects +
    '<line class="suelo" x1="-8" y1="78.5" x2="128" y2="78.5" stroke-width="2" stroke-linecap="round"/></svg>';

  function montar() {
    if (document.getElementById('fsj-carga')) return;
    var st = document.createElement('style');
    st.id = 'fsj-carga-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
    var d = document.createElement('div');
    d.id = 'fsj-carga';
    d.setAttribute('role', 'status');
    d.setAttribute('aria-live', 'polite');
    d.innerHTML = '<div class="fc-in">' + SVG + '<div class="fc-barra"><span></span></div>' +
      '<p class="fc-txt">' + FRASES[0] + '</p><p class="fc-marca">Ferretería San José</p></div>';
    (document.body || document.documentElement).appendChild(d);
  }
  montar();

  var i = 0;
  var reloj = setInterval(function () {
    var t = document.querySelector('#fsj-carga .fc-txt');
    if (!t) return clearInterval(reloj);
    t.style.opacity = '0';
    setTimeout(function () { i = (i + 1) % FRASES.length; t.textContent = FRASES[i]; t.style.opacity = '1'; }, 250);
  }, 2800);

  var listoYa = false;
  function listo() {
    if (listoYa) return;
    listoYa = true;
    clearInterval(reloj);
    var d = document.getElementById('fsj-carga');
    if (!d) return;
    d.classList.add('fuera');
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 350);
  }
  window.FSJ_CARGA = { listo: listo };

  /* ¿Ya hay algo pintado en la página, además de esto? */
  function hayContenido() {
    var b = document.body;
    if (!b) return false;
    return Array.prototype.some.call(b.children, function (el) {
      return el.id !== 'fsj-carga' && el.id !== 'fsj-respaldo' && el.tagName !== 'SCRIPT' &&
             el.tagName !== 'STYLE' && el.offsetHeight > 40;
    });
  }

  if (espera === 'contenido') {
    var mirar = setInterval(function () {
      if (hayContenido()) { clearInterval(mirar); listo(); }
    }, 150);
  } else if (espera === 'inventario') {
    /* Si el motor ni siquiera llegó a cargar, no hay nada que esperar. */
    window.addEventListener('load', function () { if (!window.Inventario) listo(); });
  } else {
    if (document.readyState === 'complete') listo();
    else window.addEventListener('load', listo);
  }
  /* Pase lo que pase, no se queda para siempre. */
  setTimeout(listo, 25000);
})();
