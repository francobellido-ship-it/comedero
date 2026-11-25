# Reporte de simulaciones del comedero

Fecha: 24/11/2026 (versión 13: cuenta del dueño, registro desde el celular y cámara dormida en la ventana del horario)

**Resultado: 285 de 285 comprobaciones correctas**, sin errores de JavaScript. Además, 900 corridas al azar de la lógica (36 000 acciones) y 7 corridas al azar en Chrome (1 214 acciones de usuario) sin romper ninguna regla.

| Bloque | Casos | Correctos |
|---|---|---|
| Lógica del ESP32 (`test_casos.js`) | 92 | 92 |
| Pruebas básicas (`test_comedero.js`) | 26 | 26 |
| Visión (`test_vision.js`) | 18 | 18 |
| Conexión app ↔ comedero (`test_nube.js`) | 21 | 21 |
| Cuenta del dueño, local y Firebase simulado (`test_cuenta.js`) | 12 | 12 |
| Escenarios de un clic en Chrome (`demo.html`) | 12 | 12 |
| Todos los modos como usuario en Chrome, desde cero (`pruebas/navegador`, partes A–E) | 62 | 62 |
| Un cliente nuevo en el celular: cuenta, conexión, cámara, gato y Mi cuenta (parte G) | 21 | 21 |
| Acciones al azar en Chrome ("mono", 7 semillas × 3 reglas) | 21 | 21 |

## 1. Lógica del ESP32

Cada caso arranca el comedero simulado con una cámara falsa que responde por UART (OK, GATO, MOV, LIMPIO/RESTOS).

**A. Configuración y reconocimiento (Tabla 4.5, Fig. D.2)**

- ✔ Ración de 12 g = 1 porciones — 12 g, 1 vueltas
- ✔ Ración de 24 g = 2 porciones — 24 g, 2 vueltas
- ✔ Ración de 36 g = 3 porciones — 36 g, 3 vueltas
- ✔ Ración de 48 g = 4 porciones — 48 g, 4 vueltas
- ✔ 4 gatos llegan en otro orden: 4 comidas y 4 ciclos de papel — Tom → Michi → Nala → Luna
- ✔ La espera se pausa mientras come otro gato (3 gatos, espera 10 min) — 3 comidas, 0 omitidas
- ✔ Un gato que ya comió vuelve: se ignora — Luna, Michi
- ✔ Ningún gato llega (espera 5 min): raciones omitidas — 2 omitidas
- ✔ Ningún gato llega (espera 60 min): raciones omitidas — 2 omitidas
- ✔ Llega uno y el otro no: 1 comida + 1 omitida
- ✔ Cámara sin respuesta, opción "dosificar" — 1 raciones por defecto
- ✔ Cámara sin respuesta, opción "no" — 0 raciones por defecto
- ✔ La cámara deja de responder a mitad del reconocimiento
- ✔ La cámara vuelve: la alerta se resuelve sola
- ✔ Horarios pausados durante el primer uso
- ✔ 6 horarios en un día: se atienden todos — 6 comidas
- ✔ Horario llega con un ciclo en curso: queda en cola — Reconocido por la cámara / Ciclo rápido
- ✔ Horario en mantenimiento: raciones omitidas
- ✔ Sin gatos registrados: ración por defecto y aviso

**B. Dosificación (Fig. 4.19, Tabla 4.6)**

- ✔ Atasco en la 2.ª porción: mantenimiento, 1 porción entregada — entregado 12 g
- ✔ Atasco que se suelta en el reintento: ración completa
- ✔ Arco de croquetas que se deshace en el reintento
- ✔ La tolva se vacía a mitad de una ración de 48 g — quedan 1 g, entregado 24 g
- ✔ Alimento bajo: aviso pero sigue dosificando
- ✔ Sensor de nivel desajustado: aviso de inventario
- ✔ Rellenar la tolva borra los avisos

**C. Papel (Cap. 5, Tabla 5.10)**

- ✔ Aviso del rollo al bajar a 22 ciclos — El rollo de papel se está acabando. Quedan unos 22 ciclos (7 días).
- ✔ El papel se acaba en la presentación
- ✔ Atasco del papel en la renovación
- ✔ El gato vuelve 3 veces durante la renovación — 3 frenadas
- ✔ El gato no se va: el consumo termina a los 60 min — 61.5 min
- ✔ Consumo termina 1 min después de que el gato se va — 1.3 min
- ✔ Consumo termina 5 min después de que el gato se va — 5.3 min
- ✔ Consumo termina 10 min después de que el gato se va — 10.3 min
- ✔ Cambio de rollo con papel flojo: aviso de la cinta guía
- ✔ Cambio de rollo normal: primera renovación
- ✔ Corte de energía durante el consumo: al encender renueva

**D. Tacho (Cap. 6)**

- ✔ Los restos llenan el tacho: mantenimiento — 150 g
- ✔ Recordatorio del tacho a los 7 días
- ✔ Confirmar con el tacho lleno no sale; vaciarlo sí

**E. Panel: pulsador, LED RGB y zumbador (Tabla 7.7)**

- ✔ 5 pulsaciones cortas = máximo 4 porciones — 48 g
- ✔ Pulsación corta en mantenimiento: ignorada
- ✔ Pulsación corta con un ciclo en curso: ignorada
- ✔ Colores del LED RGB en cada situación — verde → blanco → azul → azul* → amarillo → rojo*
- ✔ Zumbador: suena en mantenimiento y se silencia con la pulsación larga

**F. Órdenes de la app y nube (Tabla 7.6)**

- ✔ "Servir ahora" en mantenimiento: ignorado
- ✔ "Ya lo resolví" desde la app sale del mantenimiento
- ✔ Sin internet: lo que pasa se sube al reconectar — Conexión recuperada: se enviaron 2 registros pendientes
- ✔ La app cambia los horarios y el comedero los usa
- ✔ "Entendido" desde la app cierra un aviso

**H. Modo libre y prueba de reconocimiento (nuevo en la versión 4)**

En modo libre el PIR (en la placa de la cámara) envía `MOV`, el ESP32 pide `REC` y, si la cámara reconoce a un gato registrado que ya puede comer, se sirve su ración. Límites: tiempo mínimo entre comidas del mismo gato (2 h por defecto) y máximo de comidas al día (4).

- ✔ Llega Michi: el PIR despierta la cámara, lo reconoce y sirve su ración — Michi 24 g · Modo libre: reconocido por la cámara
- ✔ Michi vuelve antes de 2 h: no se sirve y la visita se cuenta una sola vez — 3 visitas: ya comió a las 05:06; vuelve a comer desde las 07:06
- ✔ Pasado el intervalo, Michi vuelve a comer
- ✔ Tope diario: con máximo 2 al día, la 3.ª vez no se sirve — ya comió 2 veces hoy (máximo 2)
- ✔ Un gato no registrado: no se sirve y queda la visita — no se sirve porque no está registrado
- ✔ Movimiento sin gato (una persona): no sirve y la cámara se calma 30 s — REC enviados: 2
- ✔ Cámara sin respuesta en modo libre: alerta y no sirve
- ✔ En modo libre no se disparan los horarios
- ✔ Modo libre pausado durante el primer uso
- ✔ Dos gatos en modo libre: cada uno come su ración — Michi 24 g, Luna 36 g
- ✔ El pulsador y "Servir ahora" siguen funcionando en modo libre
- ✔ "Probar reconocimiento": reconoce a Michi y no sirve comida
- ✔ "Probar reconocimiento" con un gato no registrado y sin nadie — otro / nadie
- ✔ "Probar reconocimiento" en mantenimiento: avisa que no puede
- ✔ "Volver a la hora real" con el reloj adelantado: el historial sigue en orden — la comida sigue 617 min antes de "ahora" y nada quedó en el futuro
- ✔ "Ver a mi gato": enciende la cámara 60 s, también en mantenimiento, y se apaga sola — VER enviado, cuenta 59 s, se apagó sola y con "Cerrar"
- ✔ Registro fallido (la cámara casi no vio al gato): la app recibe el aviso
- ✔ Gato frente al plato todo el rato: el ciclo espera; "Ya terminó de comer" lo destraba — esperaba: sí · cuenta regresiva: sí · terminó sin esperar los 5 min
- ✔ Días de alimento y papel según el modo — libre 6/día, horarios 3/día

**G. Pruebas al azar (fuzz)**

- ✔ 300 corridas al azar × 40 acciones: ninguna regla rota — 12 000 acciones (se repitió con las semillas 12345, 777 y 2026)
- ✔ Después de arreglar todo, siempre vuelve a la espera — 300/300

Las acciones al azar incluyen ahora cambiar de modo, que llegue un gato en modo libre, un gato no registrado y "Probar reconocimiento".

### Reglas vigiladas en cada paso (invariantes)

1. El servo y los motores del papel nunca funcionan a la vez (sección 7.5.2).
2. En mantenimiento no hay ningún actuador encendido.
3. La tolva nunca queda en negativo.
4. LED rojo si y solo si está en mantenimiento (Tabla 7.7).
5. El zumbador solo suena en mantenimiento.
6. En la renovación, el papel no se mueve con el gato delante (Tabla 5.10).
7. Los ciclos de papel están entre 0 y 94.
8. El servo solo gira durante la dosificación.
9. Toda ración es múltiplo de 12 g (12 a 48 g).
10. Ningún error interno del programa.
11. En modo libre, un gato nunca come dos veces dentro del tiempo mínimo entre comidas.

Además se comprobó que, después de arreglar todas las fallas, el equipo **siempre vuelve a la espera**.

### J. Horario con la cámara dormida entre visitas (v13)

Antes, durante el tiempo de espera del horario (30 min) la cámara quedaba encendida todo el rato. Ahora mira 20 s al abrir la ventana (por si el gato ya espera), duerme, y cada vez que el PIR ve movimiento despierta y mira mientras haya movimiento y 30 s más.

- ✔ Nadie llega: la cámara solo estuvo encendida 20 s de toda la ventana, y la ración queda omitida
- ✔ El gato ya esperaba al abrir la ventana: lo reconoce en el primer vistazo
- ✔ El gato llega a mitad de la ventana: el PIR despierta la cámara y se le sirve (2 despertares, 22.6 s encendida)
- ✔ Pasa alguien sin gato: mira 30 s y vuelve a dormir; luego llega el gato y come (3 despertares)
- ✔ Mientras haya movimiento sigue mirando (no se apaga a los 30 s)
- ✔ La cámara no responde al abrir la ventana: alerta y ración por defecto según el ajuste
- ✔ La cámara se muere mientras duerme: se detecta cuando el PIR la despierta

### K. Tiempos de cada etapa de la comida (v18)

Franco pidió que se note cada etapa: dispensar toma su tiempo (el disco gira y la comida cae), acercar es un solo movimiento corto de 1 a 2 s y renovar dura 5 a 6 s. El papel va a 60 mm/s (sección 5.3.6: 41–92 mm/s) y, tras la última porción, se espera 1 s a que la comida se asiente antes de mover el papel.

- ✔ 12 g: dispensa 2.1 s · acerca 1.7 s · renueva 6.0 s
- ✔ 24 g: dispensa 3.2 s · acerca 1.7 s · renueva 6.0 s
- ✔ 48 g: dispensa 5.4 s · acerca 1.7 s · renueva 6.0 s
- ✔ Cada cambio de etapa se publica enseguida: la nube ve DOSIFICACION → PRESENTACION → CONSUMO → RENOVACION → ESPERA
- ✔ En la nube cada comida lleva fecha y hora legibles (`24/11/2026`, `20:26`) y los tiempos van sin decimales

## 2. Visión por computadora

Se usaron huellas sintéticas con la forma de las de MobileNet (1280 valores): cada gato es un centro más ruido, y el fondo es una escena quieta. Esto comprueba que la lógica funciona; la precisión real se mide con fotos reales (Capítulo 8).

- ✔ Precisión con 3 gatos + fondo según el ruido — ruido 0.2: 100.0 % · ruido 0.4: 100.0 % · ruido 0.6: 100.0 % · ruido 0.8: 100.0 %
- ✔ Precisión con 1, 2, 3 y 4 gatos registrados — 1 gato: 100.0 % · 2 gatos: 100.0 % · 3 gatos: 100.0 % · 4 gatos: 100.0 %
- ✔ Gato no registrado: se marca como desconocido (OTRO) — 100/100 desconocidos · 0/100 gatos propios rechazados por error
- ✔ Gatos parecidos: la app pide collares solo cuando se confunden — parecido 0 %: sin collar (acierta 100 %) · parecido 50 %: sin collar (acierta 100 %) · parecido 80 %: pide collar (acierta 12 %) · parecido 95 %: pide collar (acierta 4 %)
- ✔ Collares: con gatos casi iguales decide el color del collar — acierta 100/100 · sin collar visible → "sin collar" 50/50
- ✔ Solo envía GATO tras 3 fotos seguidas del mismo gato — secuencia 1-2-1-1-2-1-1-1 → GATO,1,1.00 en la foto 8
- ✔ No repite GATO del mismo gato en menos de 5 s — 1 mensaje(s) GATO
- ✔ Plataforma vacía → VACIO — VACIO
- ✔ Plato: limpio, con más luz, y con restos de 1 %, 5 %, 12 % — 0 % restos → LIMPIO,0 · 0 % restos (luz ×1.4) → LIMPIO,0 · 1 % restos → LIMPIO,0.9 · 5 % restos → RESTOS,4.7 · 12 % restos → RESTOS,11.4 · 8 % restos (luz ×0.7) → RESTOS,8
- ✔ Plato sin calibrar → SINREF
- ✔ Huellas guardadas y cargadas dan el mismo resultado — 100/100 iguales · 153 KB en el navegador
- ✔ REC despierta la cámara; con falla no responde nada
- ✔ Sin webcam: el PIR simulado se apaga solo y deja de enviar MOV
- ✔ PIR con webcam: la persona del fondo no lo activa; algo distinto del fondo sí
- ✔ Carga la red de la tesis (MobileNetV2 α = 0.35 a 160 × 160) y, si falla, la siguiente; con NaN reintenta en CPU
- ✔ Red con NaN: se descartan esas huellas y pasa sola a CPU — 3 huellas NaN rechazadas → backend cpu; huella válida después: true; clases limpias: {"0":1}
- ✔ Recorte automático: encuentra el objeto y ve vacío cuando no hay nada — objeto en (58, 32) → caja centrada en (58, 32), lado 42 % del ancho · sin objeto → vacío (0.0 % cambió)
- ✔ Sin fondo registrado no reconoce; con el fondo sí (con un solo gato registrado, sin fondo todo daba p = 1.00)

## 3. Conexión app ↔ comedero

Se probó con pestañas (BroadcastChannel) y con un servidor Firebase falso que imita sus reglas (borra los valores vacíos, guarda los arreglos como objetos, `push`, `child_added`, sin conexión).

- ✔ [pestanas] Modo de conexión — Misma computadora (pestañas)
- ✔ [pestanas] La app recibe el estado del comedero — estado ESPERA
- ✔ [pestanas] El comedero recibe gatos y horarios de la app
- ✔ [pestanas] Registro desde la app: la huella y el plato vuelven a la app
- ✔ [pestanas] La comida aparece en el historial de la app — Michi 36 g, restos 6.5 %
- ✔ [pestanas] "Servir ahora" desde la app dosifica en el comedero
- ✔ [pestanas] Falla del comedero → alerta y LED rojo en la app; al resolverla se limpia
- ✔ [pestanas] Sin internet: la app ve el corte, la orden espera y se cumple al volver — congelado true, esperó true
- ✔ [firebase] Modo de conexión — Firebase (COMEDERO-4F2A)
- ✔ [firebase] La app recibe el estado del comedero — estado ESPERA
- ✔ [firebase] El comedero recibe gatos y horarios de la app
- ✔ [firebase] Registro desde la app: la huella y el plato vuelven a la app
- ✔ [firebase] La comida aparece en el historial de la app — Michi 36 g, restos 6.5 %
- ✔ [firebase] "Servir ahora" desde la app dosifica en el comedero
- ✔ [firebase] Falla del comedero → alerta y LED rojo en la app; al resolverla se limpia
- ✔ [firebase] Sin internet: la app ve el corte, la orden espera y se cumple al volver — congelado true, esperó true
- ✔ [firebase] Sin bucles: en 10 s quietos no se reescriben historial, alertas ni gatos — escrituras en 10 s → estado 10, ultimaSync 10, historial 0, alertas 0, gatos 0
- ✔ [firebase] Dos copias de la app (celular y PC) quedan iguales — la copia nueva ve 1 gato(s); espera en el comedero 45 min
- ✔ [firebase] Tamaño de los datos en la nube — 1.3 KB (el plan gratuito de Firebase admite 1 GB)
- ✔ [pestanas] "Ver a mi gato": la foto de la cámara llega a la app y se borra al cerrar — foto de 14 KB
- ✔ [firebase] "Ver a mi gato": la foto de la cámara llega a la app y se borra al cerrar — foto de 14 KB

## 4. Pruebas en el navegador

**Escenarios de un clic.** Chrome con `demo.html`, sin webcam (los gatos se simulan con los botones), Michi y Luna registrados. Cada escenario corre en su modo y al terminar vuelve a la hora real.

| Escenario | Resultado | Duración |
|---|---|---|
| comida | ✔ terminó todos sus pasos | 52.5 s |
| dos | ✔ terminó todos sus pasos | 49.3 s |
| libre | ✔ terminó todos sus pasos | 32.6 s |
| rapido | ✔ terminó todos sus pasos | 25.0 s |
| atasco | ✔ terminó todos sus pasos | 15.3 s |
| alimento | ✔ terminó todos sus pasos | 32.4 s |
| vuelve | ✔ terminó todos sus pasos | 32.5 s |
| internet | ✔ terminó todos sus pasos | 31.3 s |
| tacho | ✔ terminó todos sus pasos | 4.3 s |
| papel | ✔ terminó todos sus pasos | 22.5 s |
| camara | ✔ terminó todos sus pasos | 28.9 s |
| corte | ✔ terminó todos sus pasos | 20.8 s |

**Como lo usa el dueño.** La webcam se reemplaza por un lienzo que repite lo que hizo Franco: él sentado frente a la cámara (registrado como fondo vacío), un tomatodo en la mano, la foto de un gato en el celular y un plumón no registrado. La imagen se mueve unos píxeles, como una cámara real. Sin internet MobileNet no carga y se usa la huella simple; con internet se usa MobileNet. Además se probó `app.html` sola en otra pestaña: la foto en vivo de la cámara llega a la app.

- ✔ Fondo vacío (él sentado) registrado — 34 s, como el ESP32-S3 (45 fotos × 0.71 s)
- ✔ Tomatodo registrado
- ✔ Michi registrado
- ✔ Probar con el tomatodo en la mano → "Es Tomatodo" — gato Tomatodo en 2.4 s · caja visible: true
- ✔ Probar con la foto del gato en el celular → "Es Michi" — gato Michi en 2.3 s
- ✔ Tiempo de reconocimiento como el ESP32-S3 (≈ 2.6 s, requisito ≤ 5 s) — 2.3 s
- ✔ Probar sin nada en la mano → "no vi a ningún gato" — nadie
- ✔ Probar con un plumón (no registrado) → no lo confunde con un gato registrado — otro
- ✔ Ver a mi gato: la app muestra la foto en vivo de la cámara
- ✔ Al cerrar, la cámara deja de transmitir y se borra la foto
- ✔ Sin errores de JavaScript

**Modo presentación.** Con el fondo y Michi registrados, se recorrieron los 9 pasos con "Siguiente": la cámara reconoció a Michi en 2.4 s; los escenarios comida, libre, atasco e internet terminaron bien; "Ver a mi gato" mostró la foto en vivo; al salir no quedó nada corriendo.

Errores de JavaScript en las páginas: 0.

### Todos los modos como usuario (v11)

Chrome automático con `demo.html`, **desde un navegador limpio**. La webcam es un lienzo con una persona sentada (registrada como fondo), dos gatos en la pantalla de un celular (Lulu y Pancha) y un plumón; la imagen tiembla unos píxeles. El PIR de la webcam está activado. Todo se hace con los botones, como el dueño: la app, el pulsador, las casillas de fallas y los botones del panel.

**A. Primer uso, servir y horarios**
- ✔ Primer uso completo: fondo, papel limpio, gato, modo; termina en Inicio
- ✔ Segundo gato (Pancha) registrado y no se confunde con Lulu
- ✔ Servir 12 g desde la app con la persona delante: ciclo completo
- ✔ Pulsador: 2 toques = 24 g y vuelve el verde
- ✔ Por horarios: reconoce a Lulu, sirve 24 g, espera a que se vaya y renueva el papel; Pancha queda omitida
- ✔ Por horarios con dos gatos: Lulu 24 g y Pancha 36 g
- ✔ Al final: espera, LED verde, sin alertas

**B. Modo libre, Probar y Ver a mi gato**
- ✔ App → Modo libre llega al comedero
- ✔ Llega Lulu → la reconoce y le sirve su ración
- ✔ Lulu vuelve enseguida → visita, no se sirve otra vez
- ✔ Llega Pancha → 36 g
- ✔ Un plumón → no es gato registrado, no se sirve
- ✔ Solo la persona sentada (el fondo) → no se dispara solo (0 disparos en 8 s)
- ✔ Volver a modo por horarios
- ✔ Probar con Pancha → la reconoce y muestra la imagen en vivo
- ✔ Probar con un plumón → no dice Lulu ni Pancha
- ✔ Probar durante un ciclo → avisa y el ciclo termina normal
- ✔ Ver a mi gato → imagen EN VIVO, se actualiza cada 1–2 s, y al cerrar deja de transmitir

**C. El caso de Franco y las fallas de mantenimiento**
- ✔ Escenario "Sin internet" detenido a la mitad: vuelve el Wi-Fi, la app se reconecta y el reloj vuelve a la hora real
- ✔ No queda ninguna orden pendiente del escenario
- ✔ Después, el pulsador sirve (2 toques = 24 g)
- ✔ Pulsador durante la comida: la página dice por qué se ignora y qué hacer
- ✔ "Ya terminó de comer" en la app: renueva el papel y vuelve el verde
- ✔ Escenario detenido en plena comida: termina el ciclo y vuelve a la hora real
- ✔ Atasco del disco, arco de croquetas, atasco del papel, se acaba el papel, tacho lleno y tolva vacía: cada una pasa a mantenimiento (LED rojo y alerta en la app) y se recupera con su solución ("Ya lo resolví", pulsación larga, rollo nuevo, vaciar tacho, rellenar)
- ✔ Papel flojo al cambiar el rollo: avisa y luego se quita solo

**D. Avisos, cámara, internet, corte y recargas**
- ✔ "Entendido" en la app cierra los avisos
- ✔ Queda poco alimento (amarillo) y se quita al rellenar
- ✔ Rollo por acabarse (amarillo) y rollo nuevo
- ✔ Sensor de nivel desajustado → aviso de inventario (con la tolva a 700 g)
- ✔ Cámara no responde → alerta y se borra al volver
- ✔ Sin internet → azul intermitente y la app dice la causa; la orden de la app espera y se cumple al volver
- ✔ Corte de energía en plena comida → al volver renueva el papel
- ✔ Recargar en plena comida → renueva el papel; recargar en reposo → no renueva sin motivo

**E. Ajustes y Mis gatos**
- ✔ Tiempos de consumo y fotos seguidas llegan al comedero y a la cámara
- ✔ Horarios: agregar sin duplicar, rechaza una hora repetida o vacía, quitar
- ✔ Cambiar la ración de Lulu a 36 g → el horario le sirve 36 g
- ✔ Eliminar a Pancha (la cámara borra su huella) y volver a registrarla
- ✔ Historial sin comidas colgadas en "comiendo…"
- ✔ Cámara caída + "Servir la ración por defecto" → igual sirve 24 g

**F. Mono (acciones al azar).** Durante 6–7 minutos por semilla, un usuario "al azar" toca de todo: servir, modos, probar, ver, pulsador corto y largo, horarios, +1 h, velocidades, hora real, escenas de la cámara, cada falla, cada botón del panel, corte de energía, escenarios (la mitad detenidos a medias) y recargas. Reglas vigiladas cada 0.25 s: en mantenimiento el LED es rojo; con un ciclo en curso el LED es azul; ningún nivel negativo; ningún ciclo dura más de 150 min simulados; la app nunca dice "sin conexión" sin la falla de internet; ninguna orden de la app queda sin atender más de 4 s. Al final se resuelve todo y debe volver a ESPERA con LED verde.

| Semilla | Acciones | Reglas rotas | Vuelve a verde |
|---|---|---|---|
| 1 | 154 | 0 | ✔ |
| 2 | 172 | 0 | ✔ |
| 3 | 179 | 0 | ✔ |
| 4 | 169 | 0 | ✔ |
| 5 | 183 | 0 | ✔ |
| 6 | 182 | 0 | ✔ |
| 7 | 175 | 0 | ✔ |

### Un cliente nuevo usa la app en el celular (v12, parte G)

Chrome en tamaño celular (390 × 844, pantalla táctil), desde un navegador limpio, tocando como una persona:
- ✔ Al abrir: "Crear cuenta" y "Ya tengo cuenta", sin el menú de abajo
- ✔ Crear cuenta avisa: nombre vacío, correo inválido, contraseña corta y contraseñas distintas; "Mostrar" deja ver la contraseña
- ✔ Cuenta creada → "Conecta tu comedero": rechaza un código mal escrito, el código de otro comedero y una clave de Wi-Fi corta; con el código de la etiqueta se conecta
- ✔ "Prepara la cámara": dice que está apagada, la enciende desde la app y muestra lo que ve la cámara EN VIVO
- ✔ Registrar el fondo (con avance e imagen) y calibrar el papel limpio
- ✔ Registrar a Lulu viendo la cámara en la app mientras toma las 45 fotos
- ✔ Empezar → Inicio con "Hola, Franco"; servir 24 g desde la app
- ✔ Mi cuenta: nombre, correo y código; cambiar nombre; cambiar contraseña (rechaza la actual equivocada)
- ✔ Cerrar sesión e iniciar sesión: avisa contraseña vieja, correo sin cuenta y "olvidé"; entra con Enter aunque el correo tenga mayúsculas o espacios
- ✔ Recargar la página: la sesión sigue abierta
- ✔ Otra persona de la casa crea su cuenta: no se repiten correos y entra directo al comedero ya configurado
- ✔ Eliminar cuenta: pide la contraseña y después ya no se puede entrar
- ✔ "Ver la demo sin cuenta" sigue funcionando; nada se sale de la pantalla del celular; 0 errores de JavaScript

`test_cuenta.js` prueba lo mismo sin navegador, con la cuenta local y con un Firebase Authentication simulado (mismos códigos de error que el real): 12 de 12. Además verifica que la contraseña no se guarde, solo su huella PBKDF2-SHA256 con sal.

## 5. Problemas que encontraron las simulaciones (y ya están corregidos)

| Problema | Corrección |
|---|---|
| Con 3 o 4 gatos, el tiempo de espera del horario seguía corriendo mientras comía otro gato, y al último casi no le quedaba espera | La espera se pausa mientras se atiende a otro gato. **Conviene anotarlo en la Figura D.2.** |
| Con el papel trabado, si el gato volvía en la renovación, el motor intentaba girar 0.3 s con el gato delante | Primero se revisa si está el gato y después el atasco |
| Una orden de la app que llegaba durante el arranque (después de un corte de energía) dejaba el servo encendido | Durante el arranque se ignoran órdenes y pulsaciones, y el arranque apaga todos los actuadores |
| Cambiar el rollo durante un mantenimiento por otra causa sacaba al equipo del mantenimiento sin confirmar | Tensar_Papel() se hace después de confirmar |
| La cámara no enviaba GATO en los primeros 5 s después de encender | Corregido el control de mensajes repetidos |
| El umbral de "gato desconocido" no detectaba gatos ajenos | El umbral ahora es relativo a la consistencia de cada clase (intra × 0.35, mínimo 0.08) y vale también para el fondo |
| Al entrar en mantenimiento o cortarse la luz, los motores quedaban marcados como "enrollando" | Pasan a freno y luego a libre (Tabla 5.6) |
| Una comida cortada por un corte de energía quedaba como "comiendo…" | Se marca "se interrumpió" |
| Sin webcam, el botón "Simular movimiento" dejaba el PIR encendido para siempre: el comedero creía que el gato nunca se iba y no renovaba el papel | El PIR se recalcula en cada ciclo y se apaga 2 s después del último movimiento |
| Fuera de la hora de comida, mostrar el gato a la cámara no hacía nada y parecía que el reconocimiento fallaba (en el modo por horarios es lo esperado) | Se agregó el **modo libre**, el botón **"Probar reconocimiento"** en la app y un aviso en el registro: "el PIR vio movimiento, pero no es hora de comer" |
| En la PC de Franco, MobileNet devolvía NaN con la tarjeta gráfica: todas las probabilidades salían "NaN" y nunca reconocía | La cámara prueba la red al cargar y en cada foto; si da NaN pasa a CPU y descarta esas huellas. La app pide registrar de nuevo lo que se perdió |
| Un objeto chico frente a la persona casi no cambiaba la imagen completa, y la red no lo distinguía | Recorte automático: solo se mira la zona distinta al fondo vacío (caja sobre el video) |
| La cámara respondía más rápido que el ESP32-S3 real (la PC tarda ~30 ms por foto) | Cada foto espera 0.71 s (captura + inferencia del ESP32-S3) y la imagen se reduce a 320 × 240 y 160 × 160: respuesta medida 2.3–2.6 s |
| Con un solo gato registrado y sin el fondo vacío, cualquier cosa (la cara del dueño, un plumón) salía "100 %" ese gato | El reconocimiento exige el fondo vacío: la app lo pide como paso 1 en Mis gatos y no deja registrar gatos sin él |
| Mientras juntaba las 3 fotos seguidas, la cámara decía "Dudoso: no llega a 0.8" aunque cada foto sí llegaba | Ahora dice "Coincide con Michi: 2 de 3 fotos seguidas" |
| La app parpadeaba: cada vez que algo cambiaba se redibujaba toda la pantalla y se repetía la animación de entrada | Solo se cambia lo que cambió; la animación solo al cambiar de pantalla |
| El reloj simulado corría a ×60 siempre y se guardaba: la app mostraba otro día y otra hora | Al abrir, el reloj es la hora real (×1). Los escenarios usan ×60 y al terminar vuelven a la hora real, corriendo hacia atrás lo anotado para que siga en orden |
| Con la persona frente a la webcam, el PIR simulado veía movimiento todo el tiempo: después de servir, el ciclo se quedaba en consumo (LED azul) esperando que "el gato" se fuera | Con el fondo registrado, el PIR de la webcam solo cuenta lo distinto del fondo; el detalle muestra la cuenta regresiva y la app tiene "Ya terminó de comer". Probado en Chrome: servir 12 g con la persona delante → "El gato se fue: se limpia en 4:52" → botón → LED verde |
| Si el gato se registraba con la imagen quieta, las 30 huellas eran casi iguales y luego costaba reconocerlo en otra posición | Cada foto del registro usa un recorte distinto (zoom, corrimiento y espejo) |
| Al **detener** un escenario a la mitad (por ejemplo "Sin internet"), la falla quedaba activada: la app decía "El comedero no se conecta" y la orden pendiente salía después sola | Al terminar o detener un escenario se quitan todas las fallas simuladas y se descartan sus órdenes pendientes |
| Al terminar un escenario con una comida a medias, el reloj bajaba a ×1: el LED quedaba azul 5 minutos y el pulsador "no hacía nada" | La comida termina a ×60 y recién entonces vuelve la hora real. "Volver a la hora real" con un ciclo en curso también espera a que termine |
| El pulsador se ignoraba en silencio durante un ciclo (y el LED decía "pulsación aceptada") | Debajo del LED: "Pulsador ignorado: …" con el motivo y qué hacer; el blanco breve solo cuando se acepta |
| Las fallas simuladas se guardaban: al recargar, "Sin internet" seguía activa | Al recargar el equipo vuelve sano; lo físico (tolva, papel, tacho, historial) sí se recuerda |
| Se cerraba la página justo al terminar un ciclo y al abrirla "renovaba el papel por corte de energía" sin motivo | Se guarda al instante cada cambio de estado (y al cerrar la página) |
| Rollo nuevo durante el mantenimiento: la alerta se quitaba y la app se quedaba sin el botón "Ya lo resolví" | En mantenimiento la app siempre muestra "Ya lo resolví", con el motivo |
| Atasco del papel con la comida encima: al confirmar, la comida quedaba vieja sobre el papel | Al confirmar se hace una renovación de recuperación |
| El aviso "papel flojo" no se quitaba nunca | Se quita solo cuando el papel vuelve a avanzar bien |
| Se podían duplicar horarios o dejar uno vacío | La app propone una hora libre y rechaza horas repetidas o vacías; el comedero ignora horas mal escritas |
| Comidas cortadas quedaban en "comiendo…" para siempre en el historial | Se marcan "se interrumpió (corte de luz o falla)" |
| Un error en una parte del bucle podía cortar la conexión con la app | Cada parte del bucle está protegida: la sincronización sigue |
| La revisión de restos podía dar "restos" por un temblor de 1 píxel de la cámara | Cada píxel se compara con sus vecinos en la foto del papel limpio |
| Los dibujos mostraban un plato, pero en el prototipo la comida cae sobre el papel | Dibujos del mecanismo real (papel sobre la plataforma, rodillos, raspador, tacho y renovación); los textos dicen "papel" y "zona de comida", y los mensajes UART pasan a REVISAR y CALPAPEL |

| La app no tenía cuenta: el correo estaba desactivado y no se podía "registrar" como un cliente | Crear cuenta, iniciar y cerrar sesión, olvidé mi contraseña, Mi cuenta (nombre, contraseña, eliminar) y vincular el comedero por su código; con Firebase Authentication si está configurado |
| En el celular, al registrar el fondo o el gato no se veía lo que veía la cámara (estaba en la otra pestaña) | La app muestra la cámara EN VIVO mientras registra, y la enciende o cambia de cámara desde ahí |
| Después de entrar con tu cuenta, la app volvía a la última pantalla (Ajustes) | Siempre vuelve a Inicio |
| Si la nube y la cuenta cargaban Firebase a la vez, se podía cargar dos veces | Cada script de Firebase se carga una sola vez |
| Con la pestaña del comedero en segundo plano (o la PC suspendida), el navegador frenaba el comedero y la app del celular no veía respuesta | El bucle del comedero lo marca un Worker; tras una pausa sigue desde la hora actual |
| La demo decía "Comedero conectado" aunque no usa internet, y se confundía con la app conectada a la PC | La barra dice la ruta: "Demo: comedero en esta pantalla", "Conectado por internet" o "Conectado (misma PC)" |
| La app podía saltarse "Dispensando" o "Acercando" porque duraban 1 a 2 s y el estado salía cada segundo | Cada cambio de etapa sale enseguida a la nube y la app muestra las 4 etapas en orden (✓ las hechas) |
| En Firebase la hora de cada comida era un número de 13 cifras con decimales | Cada comida lleva `fecha` y `hora` legibles; los tiempos van sin decimales |


## 6. Cómo repetir las pruebas

```
node pruebas/test_comedero.js      # 26 pruebas básicas
node pruebas/test_casos.js         # 92 casos + 30 corridas al azar
CORRIDAS=150 SEMILLA=777 node pruebas/test_casos.js   # más corridas al azar
node pruebas/test_vision.js        # 18 casos de visión
node pruebas/test_nube.js          # 21 casos de conexión (pestañas y Firebase)
node pruebas/test_cuenta.js        # 12 casos de la cuenta del dueño
```
Las pruebas en Chrome como usuario están en `pruebas/navegador` (ver su LEEME_PRUEBAS.md).
Solo necesitas Node.js (https://nodejs.org).
