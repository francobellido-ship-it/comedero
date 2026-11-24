# Pruebas en el navegador: "todos los modos" como un usuario

Un Chrome automático usa `demo.html` como lo haría el dueño. La webcam se reemplaza por un lienzo con fotos: una persona sentada (el fondo), dos gatos en la pantalla de un celular (Lulu y Pancha) y un plumón. La imagen tiembla unos píxeles, como una cámara real.

| Archivo | Qué prueba |
|---|---|
| `parteA.js` | Primer uso completo (fondo, papel limpio, gato, modo), segundo gato, servir desde la app, pulsador, horarios con 1 y 2 gatos |
| `parteB.js` | Modo libre (come, vuelve y no repite, otro gato, plumón, nadie), Probar reconocimiento, Ver a mi gato |
| `parteC.js` | Escenario detenido a la mitad (caso "Sin internet"), pulsador durante un ciclo, y cada falla de mantenimiento con su solución |
| `parteD.js` | Avisos amarillos, inventario, cámara caída, sin internet, corte de energía y recargas |
| `parteE.js` | Ajustes, horarios (sin duplicados ni vacíos), ración, borrar y volver a registrar un gato, historial |
| `parteF.js` | "Mono": acciones al azar durante unos minutos, con reglas que nunca deben romperse |

Cómo correrlas:
```
cd comedero_app && python -m http.server 8765        # en una terminal
cd comedero_app/pruebas/navegador && npm i playwright # una vez
node parteA.js && node parteB.js && node parteC.js && node parteD.js && node parteE.js
node parteF.js 1 7        # semilla 1, 7 minutos
```
Se corren en orden: comparten el perfil del navegador (la parte A registra el fondo y los gatos).
