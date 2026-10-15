# Tablero de pedidos — guía rápida

Te dice **qué se está acabando y cuánto pedir**, a partir de lo que exportás de
FelTec. **Ningún archivo sale de la computadora**: la página los lee ahí mismo y
nada se sube al sitio. Si cerrás la pestaña, hay que volver a arrastrarlos.

## 1. Qué exportar de FelTec

Usá **las mismas fechas** para todo. Lo normal: **los últimos 30 días**, hasta
ayer o hasta hoy.

| # | Archivo | ¿Hace falta? | Fechas |
|---|---------|--------------|--------|
| 1 | **ZIP de DTE** (las facturas en JSON) | Sí, siempre | Del primer al último día del período |
| 2 | **Reporte de inventario** en Excel (.xlsx) — el que trae ITEM, PRODUCTO, EXISTENCIA, C. VENTA… | Sí, para el pedido | **Exportalo el último día del período**, al cierre |
| 3 | **Excel de ventas** (.xlsx) — el que trae «Codigo de generacion» y «Estado» | No, pero ayuda | Las mismas fechas del ZIP |

- El ZIP se arrastra **tal cual**, sin descomprimir.
- El inventario tiene que ser **del último día**: si es de otra fecha, el
  tablero te avisa en amarillo, porque la existencia ya no cuadra con lo vendido.
- El Excel de ventas sirve para descartar las facturas que FelTec marca
  **INVALIDADO**.

## 2. Qué hacer en la página

1. Entrá a **ferreteriasnjose.com/empleados/tablero/** (o desde el panel de
   empleados → *Tablero de pedidos*) con **tu nombre y tu clave** de siempre.
2. **Arrastrá los archivos** al recuadro de arriba, todos juntos o de a uno
   (en el celular: *tocá para elegirlos*). Tarda unos segundos.
3. Revisá el recuadro **Lectura de archivos**: cuántas facturas leyó y de qué
   fechas. Si algo no te cuadra, avisá antes de pedir.
4. En **Rotación y pedido**:
   - 🔴 **Urgente**: se acaba antes de que llegue el pedido.
   - 🟡 **Pedir**: ya bajó del punto de reorden.
   - 🟢 **Bien** · ⚪ **Sin movimiento** en el período.
   - Los recuadros **amarillos** (tiempo de entrega, días de seguridad,
     cobertura) se pueden cambiar; la computadora se acuerda de ellos.
5. **Descargar pedido en Excel** baja solo lo que hay que pedir (lo que se ve
   con los filtros puestos).

## 3. Si sale un mensaje rojo

Dice qué pasó y qué hacer. Lo más común: arrastraste otro reporte en vez del
ZIP de DTE o del inventario. Lo que ya estaba cargado no se pierde.
