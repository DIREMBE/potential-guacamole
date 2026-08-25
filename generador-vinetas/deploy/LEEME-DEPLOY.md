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
usuarios.js              LOS 3 USUARIOS Y SUS CLAVES (aquí se editan).
acceso.js                Pantalla de entrada: pide tu nombre y luego TU clave
                         (no tocar).
robots.txt               Evita que Google indexe el área de empleados.
analisis-inventario.html NUEVO · Analiza el reporte de FelTec: métricas y errores.
netlify.toml             Configuración (necesaria para las fotos automáticas).
netlify/functions/       Función que guarda las fotos en línea.
inventario-admin.html    NUEVO · Precios, fotos, historial y actualización con
                         revisión de discrepancias. (Interno)
vinetas-precios.html     Generador de viñetas conectado al inventario. (Interno)
calculadora-fletes.html  Calculadora de fletes. (Interno)
inventario.js            Motor de datos compartido (inventario, fotos, historial).
inventario-data.json     Listado de inventario (se carga solo, ~11.000).
showcase-data.json       NUEVO · los 15 productos del inicio (archivo pequeño).
showcase-embed.html      NUEVO · el carrusel del inicio (se muestra dentro del
                         home en un marco aislado; no tocar).
imagenes-data.json       (lo generas tú) Fotos de producto publicadas.
catalog-data.js          Catálogo anterior (lo sigue usando el home).
support.js, assets/      Motor del sitio e imágenes (sin cambios).
```

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

## ⚠️ Cómo se comparten los cambios (precios)

| Qué cambiaste | Quién lo ve y cuándo |
|---|---|
| **Foto**, con *fotos automáticas activas* | **Todos, al instante.** No hay que publicar nada. |
| **Foto**, sin fotos automáticas | Solo ese equipo, hasta publicar y subir. |
| **Precio** | Solo ese equipo, hasta publicar y subir. |

### Publicar (3 pasos)

1. En **Inventario y catálogo** verás arriba un aviso amarillo:
   *“Tienes X cambios de precio sin publicar”*. Pulsa **Publicar precios**
   (o **Publicar todo** si las fotos aún no son automáticas). Si estás en medio
   de otra cosa, pulsa **Ahora no** y el aviso se quita hasta que recargues.
2. Se descargan los archivos: `inventario-data.json` y `showcase-data.json`
   (y `imagenes-data.json` solo si las fotos no son automáticas).
3. Cópialos en la carpeta de tu sitio **reemplazando los anteriores** (junto a
   `index.html`) y súbela a Netlify.

Cuando termines, el aviso amarillo desaparece. Si vuelve a aparecer, es que hay
cambios nuevos sin publicar.

> El sitio es estático (sin servidor ni base de datos), por eso hace falta este
> paso. Si algún día quieres que sea **automático**, habría que agregar un
> pequeño servicio en el servidor; se puede, pero es otro trabajo aparte.

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
