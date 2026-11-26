# Pruebas en el navegador: "todos los modos" como un usuario

Un Chrome automático usa `demo.html` como lo haría el dueño. La webcam se reemplaza por un lienzo con fotos: una persona sentada (el fondo), dos gatos en la pantalla de un celular (Lulu y Pancha) y un plumón. La imagen tiembla unos píxeles, como una cámara real.

| Archivo | Qué prueba |
|---|---|
| `parteA.js` | Primer uso completo (fondo, papel limpio, gato, modo), segundo gato, servir desde la app, pulsador, horarios con 1 y 2 gatos |
| `parteB.js` | Modo libre (come, vuelve y no repite, otro gato, plumón, nadie), Probar reconocimiento, Ver a mi gato |
| `parteC.js` | Escenario detenido a la mitad (caso "Sin internet"), pulsador durante un ciclo, y cada falla de mantenimiento con su solución |
| `parteD.js` | Avisos amarillos, inventario, cámara caída, sin internet, corte de energía y recargas |
| `parteE.js` | Ajustes, horarios (sin duplicados ni vacíos), ración, borrar y volver a registrar un gato, historial |
| `parteG.js` | Un cliente nuevo en tamaño celular: crear cuenta (con errores), conectar el comedero, cámara en vivo, fondo, gato, Mi cuenta, cerrar sesión, otra cuenta y eliminar cuenta |
| `parteF.js` | "Mono": acciones al azar durante unos minutos, con reglas que nunca deben romperse |

Cómo correrlas:
```
cd comedero_app && python -m http.server 8765        # en una terminal
cd comedero_app/pruebas/navegador && npm i playwright # una vez
node parteA.js && node parteB.js && node parteC.js && node parteD.js && node parteE.js
node parteG.js           # cliente nuevo (perfil propio, se puede correr solo)
node parteF.js 1 7        # semilla 1, 7 minutos
```
Se corren en orden: comparten el perfil del navegador (la parte A registra el fondo y los gatos).

**Ojo con la hora del día:** las partes C y D corren a ×60. Si se lanzan cerca de un horario (07:00, 13:00 o 19:00), el horario se abre en medio de la prueba y algunos pasos fallan sin que sea un error del comedero. En ese caso, córrelas con otra zona horaria, por ejemplo `TZ=Europe/Moscow node parteD.js`.

## Fotos reales para la prueba de reconocimiento (imagenes/reales)

Recortes de 640 × 480 de fotos y de un video de tres gatos reales, que se envían al comedero simulado en lugar de la cámara web:

- `g1_tuxedo_a.jpg` y `g1_tuxedo_b.jpg`: gato blanco y negro (una sola foto; la b es otro encuadre).
- `g2_naranja_a.jpg` (registro) y `g2_naranja_b.jpg` (prueba): gato naranja y blanco, dos fotos distintas.
- `g3_tricolor_aNN.jpg` (registro, caminando hacia la cámara) y `g3_tricolor_bNN.jpg` (prueba, sobre el tapete): gata tricolor, cuadros del video.
- `g3_tricolor_movN.jpg`: cuadros movidos (borrosos) del mismo video.
- `fondo_piso.jpg`: el lugar vacío; `objeto_balanza.jpg`: un objeto que no es un gato.
