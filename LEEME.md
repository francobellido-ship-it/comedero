# Comedero inteligente: app del dueño (APK) + comedero simulado

Las dos partes del sistema, igual que en la tesis:

| Página | Qué es | Dónde se usa |
|---|---|---|
| `app.html` | **App del dueño.** Primer uso, mis gatos (registro con la cámara), servir ahora, horarios, historial y alertas | Celular (APK o instalada) o PC |
| `comedero.html` | **Comedero simulado** (gemelo digital): ESP32 + ESP32-S3-CAM con tu webcam, panel, mecanismo, fallas y **componentes y pines en vivo** | PC con webcam |
| `demo.html` | Las dos juntas en una pantalla, para presentar | PC, o celular publicada con https (sección 2.4) |
| `index.html` | Página de inicio con los tres accesos | — |

**El dueño solo ve la app** (`app.html`, o la parte izquierda de `demo.html`). El comedero simulado es "por dentro del equipo": en la realidad es el aparato con el ESP32, la cámara y los motores. Está para probar y presentar.

La app y el comedero **solo se comunican por la nube**, con las rutas de la Tabla 7.6:
- La app escribe `/config`, `/gatos` y `/comandos`.
- El comedero escribe `/estado`, `/alertas`, `/historial`, `/huellas` e `/instalacion`.

Hay dos formas de conectarlas:
- **Pestañas (sin configurar nada):** la app y el comedero abiertos en dos pestañas del mismo navegador de la PC.
- **Firebase Realtime Database:** la app en el celular y el comedero en la PC, desde cualquier lugar. Es la arquitectura de la tesis.

### Las 4 formas de dar comida

| Forma | Cómo se usa | ¿Usa la cámara? |
|---|---|---|
| **Botón del comedero** (modo local) | Cada toque corto = 12 g (máximo 4 toques = 48 g). Sale 3 s después del último toque | No |
| **Desde el celular** | Inicio → "Servir ahora" | No |
| **A sus horas** (modo por horarios) | A cada horario la cámara espera al gato hasta 30 min y le sirve su ración cuando lo reconoce. **Fuera de esas horas la cámara no busca al gato** | Sí |
| **Cuando llegue** (modo libre) | Cuando el PIR ve movimiento, la cámara despierta y busca al gato hasta 30 s. Si es un gato registrado y ya pasó el tiempo mínimo (2 h por defecto, máximo 4 al día), le sirve. Si vuelve antes, no le sirve y lo anota en el historial | Sí |

El modo (horarios o libre) se elige en la app: en Inicio ("¿Cuándo come?"), en Ajustes o en el último paso del primer uso.

**Ver a tu gato desde cualquier lugar:** Inicio → "Ver la cámara en vivo". La cámara enciende su Wi-Fi y sube 1 foto por segundo a la nube; la app la muestra con "EN VIVO". Se apaga sola al minuto ("Seguir mirando" suma otro minuto) y al cerrar se borra la foto. Funciona aunque el equipo esté en mantenimiento (sirve para ver qué pasó).

Para comprobar que la cámara reconoce a tu gato sin que salga comida: **Mis gatos → Probar reconocimiento**. La cámara lo mira hasta 30 s y te dice "¡Te reconocí! Es Michi (93 %)".

---

## 0. Paso a paso: lo que tienes que hacer

**Hoy, en tu computadora (15 minutos)**
1. Descomprime `Comedero_app_v9.zip`.
2. Instala VS Code y, dentro de él, la extensión **Live Server**.
3. Abre la carpeta `comedero_app` en VS Code, haz clic derecho en `index.html` y elige **Open with Live Server**.
4. Abre **Comedero simulado** y pulsa **Encender webcam** (acepta el permiso).
   - Si estás frente a la cámara, desmarca "Usar el movimiento de la webcam como PIR".
5. En otra pestaña abre **App del dueño** y sigue el primer uso:
   - Cuenta y conexión (se conecta sola).
   - Fondo vacío: deja la zona sin nada y pulsa Registrar.
   - Papel limpio (zona de comida): pulsa Calibrar.
   - En **Mis gatos**, primero el **fondo vacío** (lo que ve la cámara sin gato) y después cada gato: 45 fotos en unos 15 s, moviéndolo un poco.
   - Elige cuándo come (a sus horas o cuando llegue) y Empezar.
   - En Mis gatos pulsa **Probar reconocimiento** para ver si te reconoce al gato.
6. Vuelve al comedero y usa **Escenarios de un clic**: cada uno hace solo los pasos y te narra qué pasa. Mira a la vez el LED, el mecanismo, la tabla de pines y la app.
   - Empieza por "Una comida completa" y luego "Modo libre".
   - Luego prueba las fallas.
   - La tarjeta **Tu primera demo** se va marcando sola.

**Después, para el celular (30 minutos, sección 2)**
1. Sube la carpeta a GitHub Pages.
2. Crea Firebase y pega tu configuración en `js/firebase-config.js`.
3. Saca el APK con PWABuilder.

**Para la presentación**
- Usa `demo.html` (todo en una pantalla) o el comedero en la PC y la app en el celular.
- Lleva un peluche, o dos con collares de colores si quieres mostrar la excepción de los gatos parecidos.
- `pruebas/REPORTE_PRUEBAS.md` resume las 130 simulaciones. Sirve para la sección 7.9 (pruebas preliminares).

---

## 1. Correrlo en tu computadora (5 minutos)

La webcam solo funciona con `http://localhost` o `https://`.

1. Instala **VS Code** y, dentro de VS Code, la extensión **Live Server** (de Ritwick Dey).
2. Abre la carpeta `comedero_app` (Archivo → Abrir carpeta).
3. Clic derecho en `index.html` → **Open with Live Server**. Se abre `http://127.0.0.1:5500`.
4. Abre **Comedero simulado** en una pestaña y pulsa **Encender webcam** (acepta el permiso de cámara).
5. Abre **App del dueño** en otra pestaña y sigue el primer uso. Las dos pestañas se conectan solas.

Si prefieres Python: `python -m http.server 8000` dentro de la carpeta y abre `http://localhost:8000`.

---

## 2. Llevar la app al celular

### 2.1 Publicar la carpeta gratis (GitHub Pages)
1. Crea una cuenta en github.com y un repositorio público, por ejemplo `comedero`.
2. En el repositorio: **Add file → Upload files** y arrastra todo el contenido de `comedero_app`.
3. **Settings → Pages → Deploy from a branch → main / (root) → Save**.
4. En un minuto tendrás `https://TUUSUARIO.github.io/comedero/`:
   - La app: `https://TUUSUARIO.github.io/comedero/app.html`.
   - El comedero: `https://TUUSUARIO.github.io/comedero/comedero.html`. La webcam también funciona porque es https.

### 2.2 Conectar Firebase (para que el celular hable con la PC)
1. https://console.firebase.google.com → **Agregar proyecto** (puedes desactivar Analytics).
2. **Compilación → Realtime Database → Crear base de datos** → elige una ubicación → **Iniciar en modo de prueba**.
3. **Configuración del proyecto (engranaje) → Tus apps → Web (</>)**. Registra la app y copia el objeto `firebaseConfig`.
4. Pégalo en `js/firebase-config.js`, en lugar de `window.FIREBASE_CONFIG = null;`. Debe incluir `databaseURL`.
5. Vuelve a subir ese archivo a GitHub.

Desde entonces, la app (celular) y el comedero (PC) se encuentran por el código `COMEDERO-4F2A`. En "Ajustes → Conexión" de la app dice "Firebase (COMEDERO-4F2A)".

El modo de prueba deja la base abierta unos 30 días. Para la versión final se agrega Firebase Authentication con correo y contraseña, como dice la sección 7.5.3.

### 2.3 Sacar el APK (PWABuilder)
1. Entra a https://www.pwabuilder.com y pega `https://TUUSUARIO.github.io/comedero/app.html`.
2. **Start → Package for stores → Android → Generate package**. Deja "Signing key: New".
3. Descarga el zip: trae un **.apk** para instalar y probar, y un **.aab** para la Play Store.
4. Pasa el .apk al celular, ábrelo y permite "instalar apps de origen desconocido".

El APK abre tu app publicada a pantalla completa. Si actualizas los archivos en GitHub, la app se actualiza sola.

Sin APK también se puede: abre `app.html` en Chrome del celular → menú ⋮ → **Agregar a la pantalla principal**.

### 2.4 La demo completa en el celular (app + comedero, con la cámara del celular)
Para mostrar el prototipo virtual solo con el celular, sin PC:
1. Publica la carpeta (2.1). La cámara del celular **solo funciona con https**: por eso no sirve abrirla con la IP de tu PC (`http://192.168…`).
2. En el celular abre `https://TUUSUARIO.github.io/comedero/demo.html`.
3. Arriba eliges **App del dueño** o **Comedero simulado**. En "Comedero simulado" → **Encender webcam** → "Cambiar cámara" si quieres la trasera.
4. Para tenerla como app: en PWABuilder pega la dirección de **demo.html** (no la de app.html). El APK abre la demo completa. La demo tiene su propio manifiesto (`manifest-demo.json`).
5. La primera vez necesita internet para descargar TensorFlow.js y MobileNet (unos 15 MB); después el navegador los guarda.

---

## 3. Guion para la demo (o usa los escenarios de un clic)

**Preparación:**
- Usa un peluche o una foto de gato en el celular como "gato".
- Elige la velocidad ×60, donde 1 s equivale a 1 min.
- Si estás frente a la webcam, desmarca "Usar el movimiento de la webcam como PIR"; si no, el comedero te detecta como si fueras el gato.

1. **Primer uso** (app): cuenta, conectar, "Prepara la cámara" (fondo vacío y papel limpio), registrar al gato con 45 fotos en unos 15 s, elegir cuándo come y Empezar.
2. **Cámara dormida:** después de 15 s sin movimiento se duerme. El PIR la despierta: mueve la mano o usa "Simular movimiento".
3. **Una comida** (comedero → "Ir al próximo horario"). La secuencia es:
   - El ESP32 envía `REC`.
   - La cámara envía `GATO,1,p` tras 3 fotos seguidas de 0.8 o más.
   - Dosificación: servo, TCRT5000 y barrera IR.
   - Presentación de 100 mm.
   - Consumo: termina cuando el gato se va 5 min (5 s a ×60) o a los 60 min.
   - La cámara revisa si quedaron restos sobre el papel: `LIMPIO` o `RESTOS,%`. Luego la **renovación del papel** lleva el papel usado (y los restos) al raspador y al tacho.
   - Renovación de 360 mm.
   - En la app aparece "Michi · 24 g · comió todo / dejó restos".
4. **Componentes y pines:** durante la comida mira la tabla:
   - GPIO23 del servo a 2.0 ms.
   - ECHO del HC-SR04.
   - GPIO33 y GPIO21 con un pulso por porción.
   - L298N: IN1/IN2 y ENA según la Tabla 5.6 (enrollar, soltar, freno, libre).
   - Encoders, E18 en GPIO19, WS2812B en GPIO2, PIR en IO14.
5. **Modo libre** (app → Inicio → "Cuando llegue"): acerca el peluche o usa "Simular que llega… Michi".
   - El PIR envía `MOV`, el ESP32 envía `REC` y la cámara responde `GATO,1,p`.
   - Se sirve su ración y en la app aparece "llegó solo y la cámara lo reconoció".
   - Si vuelve enseguida, la cámara lo reconoce pero no le sirve: en la app aparece "Michi vino · ya comió a las 15:20".
6. **Ciclo rápido local:** dos toques cortos al pulsador (24 g), que sale a los 3 s. El LED pasa a blanco y luego a azul.
7. **Desde el celular:** "Servir ahora", cambiar horarios y raciones. El comedero los recibe en 1 s.
8. **Fallas** (comedero → "Probar fallas"). La app muestra cada alerta y el LED RGB cambia de color:
   - Atasco del disco, arco o tolva vacía.
   - Alimento bajo (260 g).
   - Sensor de nivel desajustado.
   - Cámara no responde.
   - Sin internet: la app dice "sin conexión" y las órdenes esperan.
   - Rollo por acabarse, fin de papel, atasco del papel y papel flojo.
   - Tacho lleno y recordatorio de 7 días.
   - Corte de energía.
9. **Salir de mantenimiento:** pulsación larga de 3 s o "Ya lo resolví" en la app.

---

## 4. Qué parte de la tesis representa cada cosa

| En la página | En la tesis |
|---|---|
| Máquina de estados | Tabla 7.5 |
| Dosificar_Racion(): TCRT en 2 s, barrera en 1 s, un reintento | Figura 4.19, Tabla 4.6 |
| Reconocer_Gato(): REC y GATO,i,p | Figura D.2 |
| Modo libre: MOV → REC → GATO, con tiempo mínimo entre comidas y tope diario | **Nuevo:** agregar a la Tabla 7.5 y a la sección 7.5 |
| Probar reconocimiento (REC sin dosificar) | **Nuevo:** sección 7.5.3 (app) |
| HC-SR04 (satura en 1.0 kg, mínimo 0.3 kg) e inventario ±60 g | Anexo D.8 |
| Papel: 100 mm, consumo 5/60 min, 360 mm, freno si vuelve el gato | Cap. 5, Tabla 5.10 |
| Modos del L298N (enrollar, soltar, freno, libre) | Tabla 5.6 |
| Rollo de 94 ciclos, aviso a los 22 | Secciones 5.3.7 y 5.4.3 |
| Tacho: sensor y recordatorio a 7 días | Cap. 6 |
| LED RGB y pulsador | Tabla 7.7, sección 7.4.6 |
| Pines | Placa rev 3.0 (Tabla 7.1) |
| Rutas de la nube | Tabla 7.6 |

### Mensajes UART (Tabla 4.7 ampliada)
| Mensaje | Sentido | Significado |
|---|---|---|
| REC / FIN | ESP32 → cámara | Iniciar / detener el reconocimiento |
| GATO,i,p | cámara → ESP32 | Gato registrado i, con probabilidad p |
| OTRO,p | cámara → ESP32 | Persona, otro animal o gato no registrado |
| VACIO | cámara → ESP32 | Plataforma vacía |
| MOV | cámara → ESP32 | El PIR detecta movimiento (cada 1 s) |
| OK | cámara → ESP32 | Señal de vida cada 1 s mientras está despierta |
| **REVISAR** → **LIMPIO,% / RESTOS,%** | ida y vuelta | Revisión de restos sobre el papel, en la zona de comida (nuevo) |
| **REG,i** → **REGOK,i,n,j,s,sim** | ida y vuelta | Registrar la huella del gato i (0 = fondo); j = gato más parecido; s = 1 si se parecen (nuevo) |
| **CALPAPEL** → **CALOK** | ida y vuelta | Guardar la foto del papel limpio (nuevo) |
| **BORRAR,i** | ESP32 → cámara | Borrar la huella del gato i (nuevo) |
| **REGMAL,i,n** | cámara → ESP32 | El registro falló: solo n fotos con el gato a la vista (nuevo) |
| **VER / NOVER** | ESP32 → cámara | El dueño quiere ver la cámara: enciende el Wi-Fi del módulo y sube 1 foto por segundo a /vista; NOVER o 60 s la apagan (nuevo) |

### Colores del LED RGB (Tabla 7.7)
| Color | Significa |
|---|---|
| Verde fijo | Listo, en espera |
| Azul fijo | Ciclo en curso: sirve, acerca la comida, el gato come o se renueva el papel |
| Azul intermitente | Sin Wi-Fi: sigue con la configuración guardada |
| Amarillo fijo | Un aviso: poco alimento, papel o tacho por llenarse, cámara |
| Rojo intermitente | Falla o mantenimiento, con zumbador (se confirma con pulsación larga) |
| Blanco breve | El pulsador aceptó la pulsación |

La leyenda está en "Panel del equipo" y se marca el color actual.

### No hay plato: la comida cae sobre el papel
Como en el prototipo, la comida cae directo sobre el **papel parafinado**, que se desliza sobre la plataforma de acrílico (zona de consumo). La "presentación" mueve el papel para acercar la comida al gato y la **renovación del papel** (motor 2 enrolla, motor 1 acompaña) lleva el papel usado al rodillo B, donde los restos caen al **tacho** y el raspador quita lo pegado. Los dibujos de la app muestran ese mecanismo.

### Si el pulsador "no hace nada"
Mientras hay un ciclo en curso (LED azul) el pulsador corto se ignora, como en la tesis. Ahora la página lo dice debajo del LED ("Pulsador ignorado: …") y muestra qué está haciendo el equipo y cuánto falta. Si el gato ya comió, toca **"Ya terminó de comer"** en la app. En mantenimiento (LED rojo), resuelve la falla y mantén pulsado 3 s o toca "Ya lo resolví".

### Si la app dice "El comedero no se conecta"
En la demo casi siempre es la falla **"Sin internet"** marcada en el panel Fallas: la app ahora lo dice. Desmárcala. Además:
- Al **detener** un escenario o al terminar, se quitan todas las fallas simuladas y se descartan las órdenes que el escenario dejó pendientes.
- Si quedó una comida a medias, se termina a ×60 y recién entonces el reloj vuelve a la hora real (antes bajaba a ×1 en plena comida y el LED se quedaba azul 5 minutos).
- **Recargar la página** deja el equipo sin fallas simuladas (las casillas vuelven a desmarcarse). Lo físico sí se recuerda: tolva, papel, tacho e historial.
- "Volver a la hora real" con un ciclo en curso espera a que termine y luego vuelve sola.

### Si el ciclo "no avanza" (LED azul todo el rato)
Después de servir, el comedero espera a que el gato **se vaya** y luego 5 min más antes de limpiar el papel (el detalle muestra la cuenta regresiva). Si el PIR sigue viendo movimiento, sigue esperando. Con el fondo registrado, la webcam solo cuenta como PIR lo que es distinto del fondo, así que tu movimiento normal ya no lo traba. Si quieres limpiar antes: en la app, **Inicio → "Ya terminó de comer: limpiar ahora"** (si hay algo frente al papel, el papel no se mueve).

### Cómo registrar bien (para que te reconozca)
- **No tiene que ser un gato.** Reconoce lo que le enseñes: tu gato, un peluche o la foto de un gato en el celular.
- **Primero el fondo vacío**: la cámara mira el lugar sin gato, tal como estará siempre. Si tú vas a estar sentado frente a la webcam, regístralo contigo sentado (así "tú" cuenta como "no hay gato").
- **El gato debe llenar el centro de la imagen.** Un objeto chico (un plumón) casi no cambia la foto y no se distingue del fondo. Con el celular, acerca la foto a la webcam.
- **Varios gatos:** Mis gatos → "+ Agregar otro gato", uno por uno, cada uno con su foto.
- Comprueba con **Probar ahora**. Si no lo reconoce, usa "Mejorar reconocimiento" (agrega 45 fotos más).
- La caja punteada de la cámara es la **zona de comida** (sobre el papel): después de cada comida la cámara mira ahí si quedaron restos (se pinta de amarillo mientras revisa).

### Modo presentación (para mostrarlo al jurado)
En `demo.html`, botón **▶ Presentar** arriba a la derecha. Son 9 pasos, unos 5 minutos:
1. Portada: app a la izquierda, equipo por dentro a la derecha.
2. La app del dueño.
3. La cámara reconoce al gato (en vivo, con "Probar reconocimiento").
4. Un ciclo completo a la hora de comer.
5. Modo libre.
6. Ver al gato desde lejos.
7. Atasco: mantenimiento y alertas.
8. Sin internet.
9. Cierre: las 237 comprobaciones y las acciones al azar.

Cada paso muestra abajo un texto para leer en voz alta, resalta en amarillo de qué parte se habla y hace solo lo que hay que mostrar. Avanza con **Siguiente** o con la flecha → del teclado; ◀ vuelve; Esc sale. Si un paso está corriendo, "Saltar" lo detiene y pasa al siguiente.

Antes de presentar: enciende la webcam, registra el fondo y un gato (la foto de un gato en el celular sirve) en **Mis gatos**. Si no hay gato registrado, el paso 3 te lo recuerda y puedes seguir igual.

### ¿La demo se comporta como el ESP32-S3-CAM de la tesis?
La cuenta la hace la PC, pero la demo **respeta los límites y tiempos del módulo** (sección 4.5.5):

| Qué | ESP32-S3-CAM (tesis) | En la demo |
|---|---|---|
| Imagen | OV3660 | La webcam se reduce a 320 × 240 (QVGA) y todo se procesa desde ahí |
| Entrada de la red | 160 × 160 | El recorte se reduce a 160 × 160 antes de la red |
| Red | MobileNetV2 α = 0.35 a 160 × 160, int8 | La misma: MobileNetV2 α = 0.35 a 160 × 160 de TensorFlow Hub; huellas en int8. Si no carga, usa α = 0.35 a 224 y luego α = 0.5 de respaldo (el panel dice cuál) |
| Tiempo por foto | 0.10 s captura + 0.61 s inferencia | Espera lo mismo: 0.71 s por foto (aunque la PC la haga en ~30 ms) |
| Despertar | 0.5 s | 0.5 s |
| Regla | 3 fotos seguidas ≥ 0.8 | Igual |
| Respuesta | ≈ 2.6 s (≤ 5 s) | Se mide en cada reconocimiento: 2.3 s despierta, ≈ 2.6 s dormida |
| Memoria | 8 MB de PSRAM | Muestra cuánto ocupan las huellas (≈ 180 KB con 3 clases de 45 fotos) |
| Wi-Fi | — | Solo cuando el dueño mira la cámara |

Lo que **no** simula: la velocidad real del chip (la demo espera los tiempos estimados de la tesis) y la precisión con tu gato real. Eso se mide en el Capítulo 8 con el módulo.

### Recorte automático (lo que mira la red)
La cámara compara cada foto con el **fondo vacío** y solo le pasa a la red la zona que cambió (la caja naranja sobre el video; verde cuando reconoce). Por eso:
- si no cambió nada, dice "vacío" sin usar la red (ahorra energía);
- un objeto en tu mano, o el gato, se ve grande para la red aunque ocupe poco de la imagen;
- si tú estás sentado delante, registra el fondo contigo sentado: "tú" cuentas como fondo.

### Si la red da NaN
Algunas tarjetas gráficas hacen que MobileNet devuelva valores inválidos (NaN): todo salía "NaN" y nunca reconocía. Ahora la cámara lo detecta (al cargar y durante el uso), pasa la red al procesador (CPU) y descarta esas huellas. La app te pide registrar de nuevo lo que se perdió.

### El reloj
- Al abrir la página, el reloj es la **hora real** (×1). Una comida completa tarda unos 6 min de verdad.
- Para ir más rápido elige ×10 o ×60, o usa "Pasar 1 hora" o "Ir al próximo horario". "Volver a la hora real" lo iguala con tu reloj.
- Los escenarios de un clic corren a ×60 y al terminar vuelven a la hora real.
- "Empezar de cero" borra gatos, huellas e historial de este navegador.

### Cómo reconoce
- **MobileNet** (preentrenada) convierte cada foto en una huella.
- **Al registrar** se guardan 45 huellas por gato (hasta 90 con "Mejorar reconocimiento"), en unos 30 s porque cada foto tarda lo que en el ESP32-S3. Cada foto usa un recorte distinto (zoom, corrimiento y espejo) para que luego lo reconozca aunque no esté en el mismo lugar. No se entrena en la nube y las fotos no salen del equipo.
- **Al reconocer** se usa la similitud coseno con los 5 vecinos más cercanos y luego softmax.
  - Con 3 fotos seguidas de 0.8 o más, la cámara envía `GATO`.
  - Si la foto queda lejos de todas las huellas, es un gato desconocido y envía `OTRO`.
- **Gatos parecidos:** la app pide collares de colores.
- **Restos:** se compara la zona de comida del papel con la foto del papel limpio (cada píxel con sus vecinos, para que un temblor de la cámara no cuente como restos).

Diferencias con el equipo real:
- **La red:** la demo usa MobileNetV2 0.5 de TensorFlow.js. La ESP32-S3-CAM usaría MobileNetV2 0.35 con ESP-DL o TFLite Micro, y su tiempo se mide en el Cap. 8.
- **El PIR:** aquí es la webcam detectando movimiento; en el equipo real es el AM312 en IO14.

---

## 5. Qué páginas externas usa

**Todo corre en tu navegador** con los archivos de esta carpeta. Solo se descargan de afuera:
- **TensorFlow.js y MobileNet**, desde cdn.jsdelivr.net y los servidores de Google, la primera vez. Sin internet, la cámara usa una huella simple de colores.
- **El SDK de Firebase** (gstatic.com), solo si configuraste Firebase.
- **Para publicar:** GitHub Pages (alojamiento) y PWABuilder (genera el APK).

## 6. Archivos
```
index.html, app.html, comedero.html, demo.html
css/app.css
js/firebase-config.js   ← aquí pegas tu Firebase
js/comedero.js          ESP32 simulado (lógica, sin pantalla; se prueba con Node)
js/vision.js            cámara virtual con la webcam (PIR, MobileNet, restos sobre el papel, LED)
js/nube.js              conexión app ↔ comedero (pestañas o Firebase)
js/sim.js               pantalla del comedero simulado y pines
js/app.js               app del dueño
js/dibujos.js           ilustraciones de la app (mecanismo real: papel, rodillos, raspador y tacho; gato, anillos, avatares)
manifest.json, sw.js, icon-*.png   para instalarla y sacar el APK
pruebas/                simulaciones: test_comedero.js (26), test_casos.js (52 + al azar),
                        test_vision.js (12), test_nube.js (19) y REPORTE_PRUEBAS.md
```
