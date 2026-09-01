# Sitio Ferretería San José — carpeta de deploy completa

Tu sitio web con **catálogo showcase + cotización por WhatsApp** y el **panel
interno de empleados**. Súbela tal cual a Netlify: es la carpeta que se publica.

## Contenido

```
index.html               Home: showcase de 15 productos (5 a la vez). El menú
                         "Catálogo" abre el catálogo nuevo.
catalogo.html            NUEVO · Catálogo showcase: fotos, precios, búsqueda,
                         armado de cotización y envío por WhatsApp. (Público)
interno.html             Panel de empleados (entrada con clave personal).
panel-inventario.html    NUEVO · EL TABLERO. Todo el trabajo del día en una
                         pantalla: cargar, elegir con buscador, ajustar y
                         publicar. Es por donde se empieza.
usuarios.js              Solo los NOMBRES y roles. Las claves NO están aquí:
                         viven en Netlify (ver el final de este manual).
acceso.js                Pantalla de entrada: pide tu nombre y luego TU clave
                         (no tocar).
robots.txt               Evita que Google indexe el área de empleados.
analisis-inventario.html NUEVO · Analiza el reporte de FelTec: métricas, errores
                         y el SUGERIDO DE COMPRAS por movimiento.
conversor-marcador.html  NUEVO · Convierte la exportación del marcador
                         biométrico en el cuadro semanal de asistencia.
netlify.toml             Configuración (necesaria para las fotos automáticas).
netlify/functions/       Funciones del servidor: entrada de empleados, fotos y
                         NUEVO · cambios de inventario compartidos.
sincronia.js             NUEVO · La línea de arriba de las pantallas internas
                         que dice si los cambios se están compartiendo.
recuperar-fotos.js       TEMPORAL · Sube al sitio las fotos que se quedaron
                         guardadas en un equipo. Ver «Fotos varadas» abajo.
inventario-admin.html    NUEVO · Precios, fotos, historial y actualización con
                         revisión de discrepancias. (Interno)
cargar-archivos.html     NUEVO · Ventana para cargar los Excel y revisar uno por
                         uno los cambios antes de aceptarlos. (Interno)
administrar-productos.html NUEVO · Crear, dar de baja y regresar productos,
                         precios y promociones. (Interno)
vinetas-precios.html     Generador de viñetas conectado al inventario. (Interno)
calculadora-fletes.html  Calculadora de fletes. (Interno)
inventario.js            Motor de datos compartido (inventario, fotos, historial).
                         Lo usan TODAS las páginas internas, una sola copia.
catalogo-data.json       NUEVO · Lo que baja el CLIENTE: solo los productos que
                         puede ver y solo los datos que se le enseñan (1 MB).
inventario-data.json     La base del panel: los 11.267 productos, incluidos los
                         dados de baja. No lleva costos de compra.
showcase-data.json       NUEVO · los 15 productos del inicio (archivo pequeño).
showcase-embed.html      NUEVO · el carrusel del inicio (se muestra dentro del
                         home en un marco aislado; no tocar).
imagenes-data.json       (lo generas tú) Fotos de producto publicadas.
catalog-data.js          Catálogo anterior (lo sigue usando el home).
support.js, assets/      Motor del sitio e imágenes.
assets/vendor/           NUEVO · React, que antes se bajaba de un servidor
                         ajeno (unpkg.com). Ahora viaja dentro del sitio: si
                         ese servidor falla, la portada ya no queda en blanco.
```

---

## Qué cambió en esta versión

**Lo primero, porque cambia el día a día: se acabó descargar archivos y volver
a subir el sitio para cada precio.** Cuando Carlos corrige un precio en su
teléfono, o pone una oferta, o da de baja algo, el cambio sale al momento y lo
ven los demás equipos y el cliente en el catálogo. Sin publicar, sin subir
nada. Solo la carga del Excel mensual completo sigue necesitando publicación.
Está explicado en **Cómo se comparten los cambios**, más abajo.

Y otras seis, de la más importante a la menos.

**1. Los costos de compra ya no se publican.** El sitio es estático: *todo*
archivo que se sube es público, aunque solo lo lea el panel. La versión anterior
publicaba el costo de 11.182 productos junto al precio de venta — con esos dos
números cualquiera saca tu margen. Ahora el costo vive solo en el navegador de
cada equipo y entra por el Excel de conteo. **Efecto para ti:** si abres el panel
en una computadora nueva, los costos no estarán hasta que cargues la hoja de
conteo. El análisis de inventario los necesita, así que cárgala primero.

**2. La portada ya no depende de un servidor ajeno.** Se dibujaba con React
traído de `unpkg.com`, y mientras esperaba escondía todo. Si ese servidor iba
lento o estaba caído, el cliente veía una **página en blanco**: ni el teléfono,
ni el WhatsApp, ni el catálogo. Ahora React viaja dentro del sitio (son los
mismos archivos, con la misma firma de seguridad). Y por si acaso, si aun así no
se dibujara nada, a los 6 segundos aparece una pantalla de respaldo con el
nombre de la ferretería y tres botones: catálogo, WhatsApp y llamar.

**3. El catálogo pesa la tercera parte.** El cliente bajaba 3,2 MB para ver
6.316 productos, porque el archivo traía también los 4.951 dados de baja y
campos internos. Ahora baja `catalogo-data.json`: **1 MB** (0,18 MB comprimido).
En datos móviles esa es la diferencia entre esperar y cerrar la página.

**4. Las promociones ya se ven.** Estaban programadas pero no salían en ningún
lado. Ahora, al poner una oferta desde *Administrar productos*, el catálogo
muestra el precio de antes tachado y una etiqueta amarilla con el descuento, y
la viñeta de precio sale ya con el precio anterior y el porcentaje puestos.

**5. Las fotos del sitio pesan la cuarta parte.** De 7,59 MB a 2,04 MB, sin que
se note en pantalla.

**6. Una sola copia del motor.** La página de viñetas llevaba dentro su propia
copia del motor de inventario, y se había quedado atrás. Como las dos copias
usan la misma base del navegador, cargar un Excel desde las viñetas **borraba
los precios corregidos a mano**. Ahora todas las páginas usan el mismo
`inventario.js`.

Y dos arreglos pequeños: en el teléfono el encabezado del catálogo ya no empuja
la página a lo ancho, y la etiqueta de oferta dejó de taparse con el «EN STOCK».

---

## 1) Catálogo showcase + cotización por WhatsApp (clientes)

`catalogo.html` — página pública, enlazada desde el menú "Catálogo" y desde un
botón grande en el home.

- **Showcase**: tarjetas con **foto**, nombre, categoría, **precio**, unidad y
  estado (*En stock* / *Consultar*). Los **destacados** y los que tienen foto
  aparecen primero.
- **Búsqueda** y **filtros** por categoría, "solo con existencia" y "solo con foto".
- El cliente pulsa **Agregar** en cada producto y ajusta cantidades en el panel
  **Mi cotización** (se guarda aunque cierre la página).
- Al pulsar **Enviar por WhatsApp** se abre WhatsApp (al **7493-9560**) con el
  pedido ya redactado:

```
*SOLICITUD DE COTIZACIÓN*
Ferretería San José

*Cliente:* Juan Pérez
*Teléfono:* 7777-8888

*Productos solicitados:*
1. CEMENTO GRIS FORTALEZA 42.5KG
    2 Unidad × US$9.00 = US$18.00
2. CEMENTO REGIONAL 42.5KG
    1 Unidad × US$9.45 = US$9.45

*Total estimado:* US$27.45
```

> Para cambiar el número de WhatsApp: en `catalogo.html`, busca `var WA =`.

---

## 2) Panel interno de empleados

Entra por **“Acceso interno · empleados”** (pie del sitio) → `interno.html`.

La pantalla de entrada tiene **dos pasos**:

1. **Tu nombre de usuario** — se escribe (Diego, Carlos o Mario). **La pantalla
   no muestra ninguna lista**: quien no trabaje aquí no sabe qué nombres existen.
   Da igual mayúsculas, acentos o espacios de más.
2. **Tu clave** — solo sirve la clave **de ese nombre**. Si escribes “Carlos” y
   pones la clave de Diego, no entra.

Si fallas, el mensaje es siempre el mismo (*“Nombre o clave incorrectos”*), sin
decir si lo que estaba mal era el nombre o la clave. A los **5 intentos fallidos**
el equipo queda frenado un minuto, y cada tanda espera más que la anterior.

Se pide una sola vez por sesión y el nombre queda registrado en el historial de
cambios. En el panel, arriba a la derecha, dice **quién está trabajando** y hay
un botón **Salir** para cambiar de persona.

| Usuario | Clave | Rol |
|---|---|---|
| Diego | `4729` | admin |
| Carlos | `1102` | empleado |
| Mario | `2203` | empleado |

> **Para cambiar un nombre o una clave:** abre `usuarios.js`, edita la línea que
> corresponda y vuelve a subir el sitio. Cada empleado debe tener una clave
> distinta; no las compartan entre ellos (el historial se llena con ese nombre).
> `FSJ_CLAVE` de Netlify es **otra cosa** —la clave para subir fotos— y conviene
> que sea distinta de todas estas: ver **Seguridad**.

### Inventario y catálogo (`inventario-admin.html`)

**Pestaña “Productos y fotos”**
- Busca por nombre, ITEM o código de barras.
- **Cambia el precio** en la casilla: se aplica **al instante** y **el catálogo
  lo muestra de inmediato** (sin cargar ningún archivo).
- **Sube la foto** del producto pulsando el recuadro de la imagen. Se reduce y
  comprime sola para que el sitio siga rápido.
- Marca **★ destacado** para que salga primero en el catálogo.
- Tu nombre sale solo (el que elegiste al entrar) y queda registrado en el
  historial de cada cambio de precio.
- **Solo sin precio** (casilla de filtro): lista los productos que tienen
  existencia pero **les falta el precio**. Son los que el catálogo muestra como
  *“Consultar precio”*. Las fichas sin precio salen **marcadas en amarillo** con
  el aviso, para que no se te pasen.

**Pestaña “Historial de precios”**
- Tabla con fecha, producto, precio anterior → nuevo, **% de variación**,
  origen (catálogo / viñetas / archivo) y empleado.
- Filtro por producto y **descarga en CSV**.

**Pestaña “Actualizar inventario”**
- Eliges el Excel nuevo y el sitio **compara antes de aplicar nada**:
  - **Cambios de precio** — lista con precio actual vs. precio del archivo y la
    variación. **Marca cuáles aplicar** (todos / ninguno / uno por uno).
  - **Productos nuevos** — los que no están en el sistema; también los eliges.
  - **Ya no aparecen en el archivo** — solo se quitan si tú lo marcas.
  - Existencias, nombres y categorías se actualizan siempre.
  - Los **códigos de barras** y las **fotos** que ya asignaste se conservan.

### Administrar productos (pestaña nueva)

Aquí se hace el mantenimiento del inventario: cargar la hoja de conteo, agregar
productos a mano y dar de baja o reactivar.

**Hoja de conteo (códigos de barra).** Es la que sale del sistema con las
columnas *CÓDIGO, PRODUCTO, COSTO, STOCK*. No trae el ITEM, así que se cruza por
el nombre: el conteo escribe el mismo nombre del reporte **más la marca entre
paréntesis**. Con eso casan **11,143 de 11,265 productos (98.9%)**. Antes de
guardar nada te muestra cuántos casaron, cuántos no están en el inventario y
cuántos son dudosos, con un **CSV de los que no casaron** para revisarlos.

- Al aplicarla, cada producto recibe su **código de barras**, su **costo** y su
  **marca**. Desde entonces el lector de códigos funciona en las viñetas y en la
  búsqueda del panel.
- Los **dudosos** (varios productos con el mismo nombre) no se tocan a propósito:
  asignarles un código al azar sería peor. Se les pone a mano.

**Agregar un producto.** Para lo que no viene en ningún archivo. El ITEM se
asigna solo. Si escaneas un código que ya tiene otro producto, avisa en vez de
duplicarlo.

**Dar de baja / reactivar.** En *Productos y fotos*, cada ficha tiene el botón
**dar de baja**. Eso **no borra nada**: el producto sale del catálogo y de las
viñetas, pero conserva su **foto, su código y su historial de precios**, y se
reactiva cuando quieras desde la lista de esta pestaña.

> **Lo que nunca se pierde al cargar un archivo.** Ni el reporte ni la hoja de
> conteo pisan lo que se hizo a mano: si un empleado corrigió un precio después
> de la última carga, ese precio **gana** sobre el del archivo. Lo mismo con los
> códigos de barra asignados, los destacados, las fotos y las bajas. Al terminar
> te dice cuántos precios se conservaron.

---

**Pestaña “Publicar al sitio”**
- Descarga `inventario-data.json` (datos), `imagenes-data.json` (fotos) y
  `showcase-data.json` (los 15 del inicio).
- Súbelos a la raíz del sitio, reemplazando los anteriores, y vuelve a desplegar:
  **todos los equipos y los clientes** verán esos precios y fotos.

---

## El tablero: todo el día en una pantalla (nuevo)

`panel-inventario.html` — la primera tarjeta del panel, y la que hay que usar a
diario. Antes el trabajo estaba repartido en tres ventanas y había que ir y
volver; ahora es un solo camino de cuatro pasos, con el número a la vista para
que nadie se pierda.

**Arriba, cómo está el inventario**: cuántos productos, cuántos con precio,
cuántos con existencia esperando precio, cuántos dados de baja y cuántos
cambios quedan sin publicar. Sin cargar nada.

**Paso 1 · Cargar.** Sueltas el archivo. Reconoce solo si es el reporte de
FelTec o la hoja de conteo. Nada se aplica todavía.

**Paso 2 · Revisar y elegir — aquí está el buscador.** Escribes «cemento» y de
los 453 cambios te quedan los 18 que te interesan. Tres cosas que importan:

- **Lo que marcas no se pierde al buscar.** La selección no vive en las
  casillas de la tabla, vive aparte; el buscador solo cambia lo que se ve.
- **«Marcar los que se ven» alcanza a todos los que coinciden**, no solo a los
  que caben en pantalla. Si la búsqueda encuentra 300 y solo se pintan 200, el
  botón marca los 300.
- **Buscas por varias palabras y en cualquier orden**, sin acentos: «blanco
  cemento» encuentra «CEMENTO BLANCO CEMEX».

Cada grupo lleva su cuenta de marcados, y abajo el total. Si no hay nada
marcado, el botón de aplicar está apagado. Y **«Marcar todo» nunca marca las
bajas**: dar de baja en masa por un archivo raro es el error caro de esta
pantalla.

Si el archivo no cambia nada —lo normal si ya lo aplicaste— lo dice, en vez de
dejarte una pantalla en blanco.

**Paso 3 · Ajustar.** Buscas o escaneas un producto y corriges el precio y el
código ahí mismo, en la tabla. También das de baja, lo regresas, o pones una
oferta sin salir de la pantalla. Hay filtros rápidos: *con existencia y sin
precio*, *dados de baja*, *en oferta*. Todo se comparte con los demás equipos
al instante.

**Paso 4 · Publicar.** Los archivos, solo cuando toca.

Las ventanas de antes siguen ahí, enlazadas abajo como **Herramientas aparte**:
el análisis con el sugerido de compras, administrar productos completo, fotos e
historial, y las viñetas. Nada se perdió; lo que cambió es por dónde se empieza.

---

## Sugerido de compras (nuevo)

Está dentro de **Análisis de inventario**, debajo del resumen. No usa cantidades
mínimas: una mínima fija pide lo mismo del que vuela que del que lleva un año
parado. Usa el **movimiento** que trae el propio reporte.

La cuenta, sin misterio:

```
salida al día     = SALIDA del periodo ÷ días del periodo
días que aguanta  = EXISTENCIA ÷ salida al día
a pedir           = salida al día × días de cobertura − EXISTENCIA
```

Los días del periodo salen solos del nombre del archivo de FelTec (que los lleva
pegados al final); si no, se escriben a mano. La cobertura la eliges tú: 30 días
por defecto.

El pedido se agrupa **por categoría o por marca**, y cada grupo dice cuántos
productos, cuántas unidades y cuánto cuesta. Se descarga en CSV.

> **La marca sale del nombre del producto**, porque el reporte no trae columna de
> marca. Muchos artículos (placas, abrazaderas, clavos) no la llevan escrita y
> caen en «(sin marca)». Para un pedido completo, agrupa por categoría.

Dos avisos que la pantalla te repite, porque importan:

- **SALIDA es todo lo que salió**, no solo lo vendido. Un traslado a la otra
  sucursal o un ajuste también cuentan.
- **Un mes no sabe de temporada.** Contrástalo con los informes anteriores antes
  de una compra grande.

### Inventario congelado y promociones

Debajo, lo contrario: productos **con existencia y cero salidas** en el periodo.
Es dinero parado. El descuento sugerido regala la **mitad del margen**, con tope
del 40%, y **nunca baja del costo**.

Cuando no hay con qué calcularlo, no se inventa un número — se dice cuál es el
caso: falta el precio, falta el costo, o **el «precio» del archivo no es un
precio** (FelTec escribe a veces el costo+IVA o el doble del costo; en el reporte
de agosto eso pasa en 601 productos). Descontar sobre esos sería vender a
pérdida.

Si un solo producto se lleva más del 15% del dinero quieto, la pantalla lo señala:
casi siempre es una existencia o un costo escritos en otra unidad, no mercadería
de verdad.

---

## Conversor del marcador (nuevo)

`conversor-marcador.html` — convierte la exportación del marcador biométrico
(NGL_001.TXT) en el cuadro semanal de asistencia, listo para pegar en la planilla.
Entra con tu nombre y clave, como las demás pantallas internas.

**La lista de empleados se edita ahí mismo**, en la tarjeta de arriba: agregar,
renombrar, mover de lugar y quitar. Se guarda en ese equipo.

> **El orden importa.** El número de cada empleado es la fila que le toca en el
> cuadro «📅 Asistencia Anual», así que moverlos en la pantalla mueve filas en la
> planilla. Si agregas gente, la pantalla te avisa de que hay que hacerle sitio
> al cuadro: cada semana ocupa 19 filas y los empleados empiezan en la 7.

Cuando cambias el orden o quitas a alguien, el mapeo de usuarios del marcador se
ajusta solo para que las marcas no terminen en la fila de otro.

---

## Análisis de inventario (nuevo)

**Panel interno → Análisis de inventario.** Sube el reporte de FelTec tal como
sale y te muestra, sin cambiar nada de tu inventario:

**Métricas:** productos, con y sin existencia, sin precio, categorías, valor del
inventario a costo y a precio de venta, ganancia potencial, margen mediano,
productos con y sin movimiento, y lo vendido en el periodo.

**Posibles errores que detecta** (con el detalle y descarga en CSV):

| Error | Qué significa |
|---|---|
| Existencias imposibles | Cantidades enormes (ej. 10,000,266) que inflan el valor del inventario |
| Existencias negativas | Se vendió más de lo registrado |
| Se venden bajo el costo | El precio de venta es menor que el costo |
| Con existencia sin precio | Producto en bodega que no se puede cotizar |
| Margen sospechoso | Margen > 300%: puede faltar un decimal |
| Sin costo de compra | No se puede calcular la ganancia |
| No cuadra el movimiento | Saldo + entradas − salidas ≠ existencia |
| Salidas sin existencia | Se movió y quedó en cero |
| ITEM repetido / sin nombre / sin categoría | Datos incompletos |

También descarta automáticamente la fila **“Totales:”** que trae el reporte y que
no es un producto.

### Historial de informes (afina los resultados)

Cada reporte que analizas queda **guardado en ese equipo** —solo los números y
los ITEM con error, nunca el archivo— y con eso la herramienta te da tres cosas
que un informe suelto no puede dar:

**1. Comparación con el informe anterior.** Arriba aparece qué cambió: productos,
sin precio, valor del inventario y errores totales, cada uno con la diferencia
(*−5 vs. el anterior*). Y una tabla por tipo de error con **cuántos se
corrigieron** y **cuántos aparecieron nuevos**. Así se ve si el trabajo de
limpieza va avanzando o si los errores se están reponiendo solos.

**2. Errores crónicos.** Los productos con el **mismo error en 3 informes o más**.
Esta es la lista que importa: un producto sin precio en un solo reporte puede ser
que se registró ese día; uno sin precio en cinco reportes seguidos es un problema
real que nadie ha tocado. Los de un solo día dejan de hacer ruido.

**3. Tabla de informes anteriores** con fecha, archivo, quién lo analizó,
productos, sin precio, valor a costo y errores; con **descarga en CSV** para ver
la evolución en Excel, y botones para quitar un informe o borrar todo.

> Se guardan los **24 informes más recientes**. El historial es de ese navegador:
> si analizas desde otro equipo, ese equipo lleva su propio historial.

---

## 3) Showcase del inicio (15 productos, 5 a la vez)

La página de inicio ya no muestra el catálogo completo: ahora tiene un
**carrusel limpio con 15 productos, 5 visibles a la vez** (flechas y puntos),
bajo el título **“Lo más reciente”**.

- Se eligen por **actividad**: los últimos productos cuyo **precio se modificó**,
  a los que **se les subió foto**, se **destacaron**, o que un cliente
  **abrió/agregó** en el catálogo.
- Sale de `showcase-data.json`, un archivo **pequeño (unos pocos KB)** para que
  el inicio cargue rápido; incluye miniaturas reducidas de las fotos.
- Para actualizarlo: **Panel interno → Inventario y catálogo → Publicar al sitio
  → “Descargar showcase-data.json (inicio)”** y súbelo a la raíz del sitio.
- Técnicamente el carrusel vive en `showcase-embed.html` y el home lo muestra
  dentro de un marco (iframe). Se hizo así a propósito: el home usa React y, si
  se le inserta contenido por fuera, la página puede romperse
  (*“Failed to execute removeChild…”*). Con el marco aparte eso no puede pasar.

## Productos sin precio (importante)

En el reporte de FelTec hay **miles de productos con existencia pero sin precio
de venta** (por ejemplo, la `MOTOSIERRA STIHL 250` venía con precio `0.00`).

Qué hace el sitio con ellos:

| Situación | Qué ve el cliente |
|---|---|
| Sin precio y **con foto** o **★ destacado** | La tarjeta sale con **“Consultar precio”** y el botón **Consultar** |
| Sin precio, **sin foto** y sin ★ | No sale en el catálogo (serían miles de fichas vacías) |
| Con precio | Normal, con su precio |

Si el cliente pide uno de esos por WhatsApp, el mensaje lo dice claro
(*“precio a confirmar”*) y el total no lo suma.

**Para ponerles precio:** en *Inventario y catálogo* marca la casilla
**“Solo sin precio”** y ve escribiéndolos. En cuanto pones el precio, el
producto pasa a mostrarse normal. Las fichas sin precio se ven **en amarillo**
con el aviso, y al subirles una foto el sistema te lo recuerda.

---

## Fotos de producto: qué tener en cuenta

- Formatos que funcionan: **JPG, PNG y WEBP**.
- **Fotos de iPhone (HEIC) no se pueden abrir en el navegador.** Si te pasa, la
  herramienta te lo dice y deja la lista de fallos a la vista. Solución: en el
  iPhone, **Ajustes → Cámara → Formatos → “Más compatible”**, o comparte la foto
  como JPG (por ejemplo, enviándola por WhatsApp a ti mismo y descargándola).
- Cada foto se reduce a unos **80 KB** automáticamente, así el sitio sigue
  rápido. Si el total de fotos supera los 8 MB, la herramienta te avisa.
- Si una foto no se guarda, **aparece en un recuadro rojo con el motivo** y no
  desaparece hasta que lo cierras, para que sepas exactamente cuáles repetir.

---

## Fotos varadas en un equipo (herramienta temporal)

Al guardar una foto, el sistema la guarda en el equipo y enseguida la sube al
sitio. Si la subida falla —porque en ese momento la función de fotos no estaba
en línea, o faltaba la clave— **la foto se queda solo en ese equipo**. No se
pierde, pero no la ve nadie más.

Eso ya pasó una vez: 40 fotos llegaron al sitio y otras se quedaron atrás sin
que nadie se enterara, porque el panel decía «Foto guardada» igual. Ese mensaje
ya está corregido: ahora, si la foto no llega al sitio, lo dice.

Para recuperar las que quedaron atrás, `recuperar-fotos.js` compara las fotos
de ese equipo con las del sitio y ofrece subir las que faltan. Aparece solo en
**Inventario y catálogo**, y solo si hay algo que subir. Hay que abrirlo **en
cada equipo** donde se hayan tomado fotos.

> **Es temporal.** Cuando ya no queden fotos varadas, se quita así:
> 1. borrar el archivo `recuperar-fotos.js`;
> 2. borrar la línea `<script src="recuperar-fotos.js"></script>` de
>    `inventario-admin.html`.
>
> Nada más. No toca `inventario.js` ni ningún otro archivo — está hecho aparte
> justamente para que quitarlo no pueda romper nada.

---

## Fotos automáticas (sin resubir nada)

El sitio incluye una función (`netlify/functions/fotos.mjs`) que guarda las fotos
en **Netlify Blobs**. Con eso, **al subir una foto se ve en todos los dispositivos
al instante**, sin publicar archivos ni volver a desplegar.

- En el panel verás **“fotos automáticas activas”** cuando esté funcionando.
  Con eso, **subir una foto no pide descargar ni publicar nada**: se guarda sola.
- Si dice **“fotos solo en este equipo”**, la función todavía no está desplegada:
  sube el sitio incluyendo las carpetas `netlify/` y `node_modules/`, y el archivo
  `netlify.toml`. Mientras tanto, las fotos sí hay que publicarlas a mano y el
  aviso amarillo te lo explica (con un enlace *“¿Cómo activarlas?”*).
- Los **precios** todavía usan el método de publicar (ver más abajo). Cuando las
  fotos son automáticas, el botón dice **“Publicar precios”** y se descargan
  **2 archivos** en vez de 3.

> **Importante:** `FSJ_CLAVE` quedó configurada con las claves de entrada, y esas
> son públicas (están en `usuarios.js`). Cámbiala por una clave distinta y solo
> tuya: ver **Seguridad**, más abajo.

---

## Cómo se comparten los cambios

**Esto cambió por completo.** Antes, cualquier cosa que tocara un empleado se
quedaba en su equipo hasta que alguien generaba los archivos y volvía a subir
el sitio. Ahora los cambios sueltos se comparten solos.

| Qué cambiaste | Quién lo ve y cuándo |
|---|---|
| **Precio** de un producto | **Todos, al instante.** No hay que publicar nada. |
| **Promoción** (poner o quitar) | **Todos, al instante.** |
| **Dar de baja / regresar** un producto | **Todos, al instante.** |
| **Producto nuevo** creado a mano | **Todos, al instante.** |
| **Código de barras** corregido | **Todos, al instante.** |
| **Foto** de producto | **Todos, al instante.** |
| **Cargar el Excel mensual completo** (miles de filas) | Solo ese equipo → hay que publicar. |

Arriba de cada pantalla interna hay una línea que lo dice sin adornos:

- 🟢 **«Se comparte al instante»** — lo que hagas lo ven los demás y el catálogo.
- 🟡 **«N cambios sin mandar»** — casi siempre es el internet. Se reintenta solo,
  incluso si cierras el navegador y vuelves mañana. Nada se pierde.
- 🟡 **«Solo en este equipo»** — no hay servidor (o el sitio corre sin Netlify).
  Todo funciona igual, pero toca publicar para compartir.
- 🔴 **«Tu clave no fue aceptada»** — sal y vuelve a entrar.

El botón **Actualizar** de esa misma línea trae lo que hayan hecho los demás sin
tener que recargar.

### ¿Y entonces cuándo hay que publicar?

Dos casos, nada más:

1. **Después de cargar el Excel mensual de FelTec.** Son miles de filas: eso se
   publica, no se sincroniza.
2. **De vez en cuando, para dejarlo todo asentado.** Los cambios sueltos se van
   acumulando en el servidor; al publicar entran en el archivo y el servidor se
   vacía solo. Si nunca publicas, a los 4.000 cambios el sistema avisa y deja de
   compartir hasta que lo hagas.

Para el día a día —un precio, una oferta, dar de baja algo que ya no se vende—
**ya no hay que hacer nada.**

### Publicar (3 pasos)

1. En **Inventario y catálogo** verás arriba un aviso amarillo:
   *“Tienes X cambios de precio sin publicar”*. Pulsa **Publicar precios**
   (o **Publicar todo** si las fotos aún no son automáticas). Si estás en medio
   de otra cosa, pulsa **Ahora no** y el aviso se quita hasta que recargues.
2. Se descargan los archivos: `inventario-data.json`, **`catalogo-data.json`**
   y `showcase-data.json` (y `imagenes-data.json` solo si las fotos no son
   automáticas).
3. Cópialos en la carpeta de tu sitio **reemplazando los anteriores** (junto a
   `index.html`) y súbela a Netlify.

> **Son dos archivos, no uno.** `catalogo-data.json` es el que baja el cliente
> en su teléfono: pesa 1 MB en vez de 3 porque solo lleva los 6.316 productos
> que se le pueden enseñar y solo los datos que se ven en pantalla.
> `inventario-data.json` es la base del panel y trae los 11.267, incluidos los
> dados de baja. **Sube siempre los dos**: si subes solo uno, el catálogo y el
> panel quedan desfasados.

Cuando termines, el aviso amarillo desaparece. Si vuelve a aparecer, es que hay
cambios nuevos sin publicar.

> Al publicar, el sistema le avisa al servidor que esos cambios ya van dentro
> del archivo nuevo, y los suelta. Lo que llegue mientras subes el sitio se
> queda guardado: no se pierde nada por publicar en mal momento.

---

## 🔒 Seguridad: qué protege esto y qué no

Conviene tenerlo claro, sin adornos.

### Lo que hay que entender

El sitio es **estático**: son archivos que Netlify entrega tal cual, sin servidor
ni base de datos detrás. Eso tiene una consecuencia directa:

> **El candado de las herramientas internas es del lado del cliente.** El archivo
> `usuarios.js` viaja al navegador, así que cualquiera que escriba
> `tusitio.com/usuarios.js` en la barra de direcciones puede leer los nombres y
> las claves. Sirve para que un cliente no entre por curiosidad; **no** detiene a
> alguien que sepa lo que hace.

### Qué se puede perder de verdad

| Qué | ¿Está expuesto? | Cuánto importa |
|---|---|---|
| Nombres, precios de venta y existencias | **Sí**, en `inventario-data.json` | Poco: es justo lo que el catálogo le enseña al cliente |
| **Costos de compra y márgenes** | **No.** Nunca salen del reporte de FelTec: se leen en tu navegador y no se publican | Aquí sí habría daño, y por eso no se publica |
| Datos de clientes | **No se guarda ninguno.** La cotización va directa a WhatsApp | — |
| Cambiar precios o borrar inventario desde fuera | **No se puede.** No hay servidor que acepte cambios; cada equipo guarda lo suyo | — |
| Subir o borrar fotos | Depende de la variable `FSJ_CLAVE` (ver abajo) | **Esto sí era un agujero real** |

### Lo que ya quedó reforzado

- **Las claves salieron del sitio.** Ya no están en `usuarios.js` (que cualquiera
  puede abrir): viven en una variable de Netlify y quien las compara es el
  servidor. En el sitio solo quedan los nombres y los roles.
- **Los costos de compra ya no se publican.** Ni en la base del panel ni en el
  archivo del catálogo. Antes salían junto al precio de venta, y con esos dos
  números cualquiera calcula tu margen.
- **La clave de las fotos ya no es la de entrar.** Antes, `FSJ_CLAVE` en Netlify
  tenía las mismas claves de los empleados, que están publicadas en
  `usuarios.js`: cualquiera podía subir o borrar fotos del catálogo. Ahora el
  panel usa una **clave de fotos aparte**, que se escribe una vez en cada equipo
  y **no está en ningún archivo del sitio**.
- **La función solo acepta imágenes de verdad.** Se comprueba que el archivo sea
  JPG, PNG o WEBP (no basta con ponerle ese nombre), con tope de tamaño, tope de
  cantidad y el ITEM validado.
- **Al fallar el acceso, el mensaje no da pistas** ni confirma qué nombres
  existen, y **frena los intentos** a los 5 fallos.
- **La pantalla ya no muestra la lista de empleados**: hay que escribir el nombre.
- **Google no indexa el área de empleados** (`robots.txt` + `noindex` + cabecera
  `X-Robots-Tag`), así que esas páginas no salen buscando en internet.
- **Estos manuales ya no se pueden leer desde internet.** Van en la misma
  carpeta que se publica y traen la tabla de claves; ahora `netlify.toml`
  hace que el sitio responda “no existe” a cualquier archivo `.md`. En tu
  computadora los sigues abriendo normal.

### Lo que te toca hacer a ti (10 minutos, y es lo que más rinde)

1. **Comprueba la clave de fotos.** Está en Netlify, en
   *Site configuration → Environment variables → `FSJ_CLAVE`*, guardada como
   variable secreta. **No está escrita en ningún archivo del sitio ni en este
   manual, y así debe quedarse.** Si no aparece, créala tú ahí mismo.
   Luego, en el panel, pulsa **“poner clave de fotos”** (sale junto a
   *fotos automáticas activas*) y escríbela una vez en cada equipo que suba
   fotos. Es lo único que hay que teclear por equipo, y queda guardada.
2. **Cambia las claves de entrada cuando alguien deje de trabajar contigo.** Se
   editan en `usuarios.js` y se vuelve a subir el sitio.
3. **Que cada quien use la suya.** Si las comparten, el historial de precios deja
   de servir para saber quién cambió qué, que es medio motivo de tenerlo.

### ¿Hace falta algo más?

**Para una ferretería, con esto estás bien.** Lo que se protege son herramientas
de trabajo, no dinero ni datos personales: lo peor que puede pasar si alguien
entra es que vea precios que de todos modos están en el catálogo. No vale la pena
complicarse más.

Si algún día quieres que el acceso sea de verdad —por ejemplo, si llegas a manejar
costos o datos de clientes dentro del sitio— hay dos caminos, y ambos cuestan:

- **Netlify Identity** (usuarios reales con correo y contraseña, validados en el
  servidor). Es la opción correcta y encaja con lo que ya tienes.
- **Password protection de Netlify** (planes de pago): una contraseña delante de
  todo el sitio o de una carpeta. Rápido, pero es una sola clave para todos y
  perderías el registro de quién hizo cada cambio.

Mientras el área interna solo tenga herramientas de precios y fletes, mi
recomendación es **quedarte como estás y hacer los 3 puntos de arriba**.

## Dos ventanas nuevas en el área de empleados

### 1. Cargar archivos

Una sola pantalla para los dos archivos. Reconoce sola cuál es y **no aplica
nada hasta que tú lo aceptes**:

- **Reporte de FelTec** → te enseña los cambios de precio, los productos nuevos
  y los que ya no vienen. Marcas lo que quieras aplicar, casilla por casilla.
- **Hoja de conteo** → códigos de barra y costos, con los que no casaron aparte.
- Botón para bajar la revisión en **CSV** antes de decidir.
- *"Ya no vienen en el archivo"* nunca se marca solo: dar de baja tiene que ser
  una decisión tuya.

### 2. Administrar productos

- **Buscar y editar**: por nombre, ITEM o **escaneando el código**. Cambias
  precio y código ahí mismo.
- **Sin precio**: la lista de los que vienen en cero, para írselos poniendo.
- **Promociones**: precio de antes tachado, % de descuento y fecha de fin
  opcional. Si le pones fecha, **la oferta se quita sola** ese día.
- **Crear producto** y **Dados de baja** (con el motivo separado).

---

## ⚠️ Los precios del reporte de FelTec no son precios de venta

Esto salió al cruzar los números y **conviene tenerlo muy claro**:

| Qué trae la columna "C. VENTA" | Cuántos |
|---|---|
| El **costo + 13% de IVA** (no es un precio de venta) | **973 · 71%** |
| El **doble del costo** | 101 · 7% |
| Un margen de verdad | 206 · 15% |
| Vendido bajo el costo | 3 |

Por eso el "margen mediano" daba exactamente 13%: no era ganancia, **era el
IVA**. Y por eso productos como `CEMENTO USO GENERAL CEMEX` salen en 0.00
aunque en FelTec tengan su precio: **ese dato no viaja en el archivo**.

**Qué significa en la práctica:** si se publican esos números tal cual, se le
está ofreciendo al cliente el producto **al costo**. El *Análisis de inventario*
ahora los detecta y los lista aparte, y el margen mediano se calcula solo con
los productos que tienen un precio de verdad.

**Regla nueva:** si el archivo trae el precio en cero, el producto queda
**dado de baja** automáticamente (no se ve en el catálogo ni en las viñetas).
En cuanto alguien le pone precio, **vuelve solo**. Son 4,951 productos hoy: se
van poniendo desde *Administrar productos → Sin precio*.

---

## Deploy en Netlify

Sube esta carpeta como siempre. **Importante:** para que funcionen las fotos
automáticas debe subirse **completa**, incluyendo `netlify.toml`, la carpeta
`netlify/` y `node_modules/`.

Si al abrir el panel dice *“fotos solo en este equipo”*, es que la función no
quedó desplegada. En ese caso, desde la carpeta del sitio:

```bash
npx netlify-cli deploy --prod
```

(la primera vez te pedirá vincular el sitio: elige `luminous-seahorse-5e3f04`).


---

## Claves de los empleados (una sola por persona)

Las claves **ya no están en `usuarios.js`** (ese archivo lo puede abrir cualquiera).
Ahora se guardan en Netlify y el servidor es el que las comprueba.

1. Netlify → tu sitio → **Site configuration → Environment variables**.
2. Crea la variable **`FSJ_USUARIOS`** con este formato, una entrada por persona,
   separadas por coma:

   ```
   Diego:claveDeDiego:admin,Carlos:claveDeCarlos:empleado,Mario:claveDeMario:empleado
   ```

   - El **nombre** debe coincidir con el de la lista de `usuarios.js`.
   - El **rol** es `admin` (puede publicar y actualizar inventario) o `empleado`.
   - La clave puede ser cualquier texto sin comas ni dos puntos; mejor larga que corta.
3. Vuelve a desplegar el sitio (**Deploys → Trigger deploy**) para que la variable quede activa.

Esa misma clave sirve para **entrar** al área de empleados y para **subir fotos**:
ya no hay que escribir una "clave de fotos" en cada equipo. La variable `FSJ_CLAVE`
sigue funcionando si prefieres usarla como clave extra para fotos.

En `usuarios.js` solo se editan **nombres y roles**. Si agregas a alguien ahí,
agrégalo también en `FSJ_USUARIOS`.
