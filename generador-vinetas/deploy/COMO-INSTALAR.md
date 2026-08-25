# Cómo instalar — Viñetas de precio (acceso interno)

Este es **un solo archivo** (`vinetas-precios.html`), igual que tu
`calculadora-fletes.html`, con el **mismo acceso de empleados**: se escribe tu
nombre de usuario y después tu clave.

> Necesita, en la misma carpeta, los archivos **`usuarios.js`** (los nombres y
> las claves) y **`acceso.js`** (la pantalla de entrada). Los dos vienen en la
> carpeta de deploy.

## 1) Dónde ponerlo

Copia `vinetas-precios.html` en la **misma carpeta donde está
`calculadora-fletes.html`** (la raíz de tu sitio que publicas en Netlify).

Quedará accesible en:

```
https://tusitio.com/vinetas-precios.html
```

No hay que copiar nada más: el archivo trae todo dentro (estilos y lógica). Las
librerías de códigos de barras y PDF se cargan solas desde un CDN.

## 2) Enlazarlo en el menú (junto a la calculadora)

En tu `index.html`, al lado del enlace de la calculadora de fletes, agrega uno
igual para las viñetas. Busca esta línea:

```html
<a href="calculadora-fletes.html" style="text-decoration:none;color:#8A8170" style-hover="color:#F15930">Calculadora de fletes · interno</a>
```

Y añade justo después:

```html
<a href="vinetas-precios.html" style="text-decoration:none;color:#8A8170" style-hover="color:#F15930">Viñetas de precio · interno</a>
```

## 3) Acceso de empleados

- Al abrir pide **tu nombre de usuario** (se escribe: no hay lista a la vista) y
  luego **la clave de esa persona**. La clave de un compañero no sirve para
  entrar con otro nombre; así el historial de precios queda bien. A los 5
  intentos fallidos el equipo queda frenado un minuto.
- Es la **misma sesión** en todas las herramientas internas: si ya entró a la
  calculadora, no le vuelve a pedir nada en las viñetas (y viceversa). Se guarda
  en `sessionStorage`, así que al cerrar el navegador se vuelve a pedir.

### Cambiar nombres o claves

Abre **`usuarios.js`** y edita la línea que corresponda. No hay que tocar nada
más (ni el HTML de las herramientas).

> Nota: igual que en la calculadora, este candado es del **lado del cliente**:
> sirve para que solo el personal la use, pero no es un cifrado fuerte (la clave
> viaja en el archivo). Para algo más estricto se usaría la protección con
> contraseña de Netlify (planes de pago). Como es una herramienta interna, este
> candado es consistente con lo que ya usas.

## 4) Catálogo (automático)

Si tu `catalog-data.js` está en la raíz (como ahora), al abrir la herramienta
aparece un **buscador del catálogo** que rellena nombre y precio del producto.
No tienes que hacer nada; se detecta solo.

## 5) Deploy en Netlify

Nada distinto: sube el archivo con tu sitio como siempre (arrastrando la carpeta
o con Git). No necesita build, ni variables de entorno, ni claves de API.

---

### Uso rápido (empleados)

1. Entra a **Viñetas de precio · interno** y escribe la clave.
2. Agrega productos (nombre, código, precio; opcional: precio original para
   oferta y precio por cantidad —docena, ciento, libra, quintal…—) y cuántas copias imprimir.
3. Elige el tamaño de viñeta y de hoja.
4. **Imprimir**, **Descargar PDF** o **Descargar PNG (300 DPI)**.

Los datos se guardan en el navegador; no se pierden al recargar.
