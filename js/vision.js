/* ============================================================================
 * vision.js — ESP32-S3-CAM virtual (la webcam hace de cámara del comedero)
 * ----------------------------------------------------------------------------
 * Se comporta como el módulo de la tesis (sección 4.5.5), no como una PC:
 *  - Sensor OV3660 en QVGA (320 × 240): todo se procesa desde esa imagen chica.
 *  - Entrada de la red de 160 × 160 px y tiempos del ESP32-S3: despertar 0.5 s,
 *    captura 0.10 s e inferencia 0.61 s por foto (219 ms a 96 × 96, Rovai 2024,
 *    escalado a 160 × 160). La PC calcula más rápido, pero la demo espera lo mismo
 *    que esperaría el ESP32-S3: 3 fotos seguidas ≥ 0.8 → respuesta ≈ 2.6 s (≤ 5 s).
 *  - Huellas en int8 (como un modelo cuantizado a 8 bits) guardadas en la memoria.
 *  - PIR AM312: despierta la cámara (aquí, diferencia entre imágenes de la webcam).
 *  - Recorte automático: compara con la foto del fondo vacío y solo mira la zona que
 *    cambió (donde está el gato). Si nada cambió, es "vacío" y ni usa la red.
 *  - Reconocimiento: MobileNetV2 (preentrenada) → huella; vecinos más cercanos con
 *    las huellas del registro; gato desconocido → OTRO; collares para gatos parecidos.
 *  - Restos: compara la zona de comida del papel con la foto del papel limpio → LIMPIO o RESTOS.
 *  - Noche: mide el brillo y enciende los LED blancos.
 *  - Habla con el ESP32 simulado por "UART" (mensajes de la Tabla 4.7).
 * Si la red da valores inválidos (NaN) con la tarjeta gráfica, pasa a CPU; si no
 * carga (sin internet), usa una huella simple de colores y formas.
 * ==========================================================================*/
(function (root) {
  'use strict';

  const V = {
    UMBRAL_P: 0.8, FOTOS: 3, T_DESPERTAR_MS: 500, T_DORMIR_MS: 15000,
    HEARTBEAT_MS: 1000, PIR_SENS: 0.04, PIR_HOLD_MS: 2000, PIR_CADA_MS: 200,
    RESTOS_UMBRAL_PCT: 3, BRILLO_NOCHE: 55, REG_FOTOS: 45, REG_MAX_MS: 75000, REG_MIN_FOTOS: 12,
    MARGEN: 0.08, TOPK: 5, TAU: 0.1, MAX_EJEMPLOS: 90,
    // ESP32-S3-CAM (sección 4.5.5)
    SENSOR_W: 320, SENSOR_H: 240, ENTRADA: 160, T_CAPTURA_MS: 100, T_INF_MS: { 96: 219, 160: 610 },
    PSRAM_KB: 8192,
    // Primer plano (diferencia con el fondo vacío) en una imagen de 80 × 60
    FG_W: 80, FG_H: 60, FG_CELDA: 4, FG_UMBRAL: 70, FG_MIN_CELDAS: 4, FG_LADO_MIN: 0.3, FG_MARGEN: 0.2
  };
  // Redes que se intentan cargar, en orden. La primera es la de la tesis (sección 4.5.5):
  // MobileNetV2 con α = 0.35 entrenada a 160 × 160 (TensorFlow Hub). Si no carga, se usan
  // respaldos; la huella siempre sale de la capa anterior a la clasificación (1280 valores).
  const NODO_V2 = 'module_apply_default/MobilenetV2/Logits/AvgPool';
  const CANDIDATOS = [
    { tipo: 'mobilenet-v2-0.35-160', nombre: 'MobileNetV2 α = 0.35 a 160 × 160 (la de la tesis)', url: 'https://tfhub.dev/google/imagenet/mobilenet_v2_035_160/classification/2', lado: 160 },
    { tipo: 'mobilenet-v2-0.35-224', nombre: 'MobileNetV2 α = 0.35 (entrada 224)', url: 'https://tfhub.dev/google/imagenet/mobilenet_v2_035_224/classification/2', lado: 224 },
    { tipo: 'mobilenet-v2-0.5', nombre: 'MobileNetV2 α = 0.5 (respaldo)', paquete: { version: 2, alpha: 0.5 } },
    { tipo: 'mobilenet-v1-1.0', nombre: 'MobileNetV1 (respaldo)', paquete: { version: 1, alpha: 1.0 } }
  ];
  const tFoto = () => V.T_CAPTURA_MS + (V.T_INF_MS[V.ENTRADA] || 610);
  const CLAVE = 'comedero_huellas_v2';
  // Al registrar, cada foto se toma con un recorte distinto (zoom, corrimiento y espejo):
  // así la huella no depende de que el gato esté justo en el mismo lugar.
  const VARIANTES = [
    { z: 1, dx: 0, dy: 0, f: 0 }, { z: 1, dx: 0, dy: 0, f: 1 }, { z: 0.85, dx: 0, dy: 0, f: 0 },
    { z: 0.85, dx: -0.07, dy: 0, f: 0 }, { z: 0.85, dx: 0.07, dy: 0, f: 1 }, { z: 0.85, dx: 0, dy: 0.07, f: 0 }
  ];
  const COLORES = {
    rojo: (h, s, v) => (h < 12 || h > 345) && s > 0.5 && v > 0.35,
    amarillo: (h, s, v) => h >= 42 && h <= 68 && s > 0.5 && v > 0.45,
    verde: (h, s, v) => h >= 85 && h <= 160 && s > 0.4 && v > 0.3,
    azul: (h, s, v) => h >= 190 && h <= 250 && s > 0.45 && v > 0.3
  };

  // ---- utilidades de vectores ----
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  function normalizar(v) { let n = Math.sqrt(dot(v, v)) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / n; return o; }
  // Una huella sirve si todos sus valores son números y no es el vector cero
  function valida(v) { if (!v || !v.length) return false; let n = 0; for (let i = 0; i < v.length; i++) { if (!Number.isFinite(v[i])) return false; n += v[i] * v[i]; } return n > 1e-9; }
  // Como en el ESP32-S3: la huella se guarda en 8 bits (int8) con una escala
  function int8(v) { let mx = 0; for (const x of v) mx = Math.max(mx, Math.abs(x)); const s = mx / 127 || 1; return Float32Array.from(v, (x) => Math.round(x / s) * s); }
  function topkMedia(arr, k) { const s = arr.slice().sort((a, b) => b - a); const n = Math.min(k, s.length); let t = 0; for (let i = 0; i < n; i++) t += s[i]; return n ? t / n : -1; }
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, mx ? d / mx : 0, mx];
  }
  function cuantizar(v) {
    let mx = 0; for (const x of v) mx = Math.max(mx, Math.abs(x));
    const s = mx || 1; const q = new Int8Array(v.length);
    for (let i = 0; i < v.length; i++) q[i] = Math.round((v[i] / s) * 127);
    let bin = ''; const u = new Uint8Array(q.buffer); for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    return { s, b: btoa(bin) };
  }
  function descuantizar(o) {
    const bin = atob(o.b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const q = new Int8Array(u.buffer); const v = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) v[i] = (q[i] / 127) * o.s;
    return v;
  }
  const lienzo = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  class CamaraVirtual {
    constructor(video) {
      this.V = V; this.tFoto = tFoto;
      this.video = video;
      this.estado = 'APAGADA';          // sin webcam
      this.webcam = false; this.stream = null; this.trasera = false;
      this.enviar = () => {};
      this.noResponde = false;
      this.gatos = [];                  // perfiles (nombre, collar) que llegan de la app
      this.tipo = null; this.net = null; this.cargando = false; this.backend = null; this.cambiando = false; this.invalidas = 0;
      this.clases = {};                 // id → [Float32Array normalizados]
      this.intra = {}; this.media = null; this.cache = {};
      this.platoRef = null; this.roi = { x0: 0.15, x1: 0.85, y0: 0.55, y1: 0.98 };
      this.fondoRef = null; this.fg = null;   // foto chica del fondo vacío y último primer plano
      this.rec = false; this.tRec = 0; this.racha = { id: null, n: 0 }; this.ultimoEnvio = {};
      this.pred = null; this.reg = null; this.platoPend = 0;
      this.pirNivel = 0; this.pirActivo = false; this.pirManualHasta = 0; this.ultimoMov = -1e9;
      this.brillo = 128; this.ledsNoche = false; this.colorFrac = {};
      this.despiertaHasta = 0; this.tEstado = 0; this.proxOK = 0; this.proxPIR = 0; this.proxFoto = 0; this.proxMov = 0;
      this.prevGris = null; this.ignorarPIRHasta = 0; this.procesando = false;
      this.pirWebcam = true;           // false: el PIR solo se activa con el botón
      this.tPC = null; this.ultimaRespuestaS = null;
      // "Ver a mi gato": mientras el dueño mira, la cámara usa su Wi-Fi y sube 1 foto por segundo
      this.verHasta = 0; this.proxVista = 0; this.fotosSubidas = 0; this.subirFoto = () => {};
      this.mensajes = []; // registro corto para la interfaz
      this.cSensor = lienzo(V.SENSOR_W, V.SENSOR_H);   // imagen del OV3660 (QVGA)
      this.cIn = lienzo(V.ENTRADA, V.ENTRADA);         // entrada de la red
      this.c48 = lienzo(48, 48); this.c64 = lienzo(64, 48); this.c32 = lienzo(32, 24); this.c80 = lienzo(V.FG_W, V.FG_H);
      this.hayCaptura = false;
      this.cargarHuellas();
    }

    log(t) { this.mensajes.unshift(t); if (this.mensajes.length > 6) this.mensajes.pop(); }

    // ---------- Webcam ----------
    async encender() {
      if (this.webcam) return true;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: this.trasera ? 'environment' : 'user' }, audio: false });
        this.video.srcObject = this.stream;
        await this.video.play();
        this.webcam = true;
        this.ignorarPIRHasta = performance.now() + 2500;
        if (this.estado === 'APAGADA') this._estado('DORMIDA');
        this.cargarModelo();
        return true;
      } catch (e) {
        this.log('No se pudo abrir la webcam: ' + (e.name || e.message));
        return false;
      }
    }
    apagar() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null; this.webcam = false; this.video.srcObject = null;
    }
    async cambiarCamara() { this.trasera = !this.trasera; this.apagar(); return this.encender(); }

    // Carga una red de la lista. Las de TensorFlow Hub se leen como modelo de grafo y la huella
    // sale del nodo AvgPool; las del paquete @tensorflow-models/mobilenet, con infer(img, true).
    async _cargarCandidato(c) {
      const tf = root.tf;
      if (c.url) {
        if (!tf || !tf.loadGraphModel) throw new Error('sin TensorFlow.js');
        const m = await tf.loadGraphModel(c.url, { fromTFHub: true });
        return {
          infer: (img) => tf.tidy(() => {
            let x = tf.browser.fromPixels(img).toFloat().div(255);            // entrada en [0, 1]
            if (x.shape[0] !== c.lado || x.shape[1] !== c.lado) x = tf.image.resizeBilinear(x, [c.lado, c.lado], true);
            return tf.reshape(m.execute(x.expandDims(0), NODO_V2), [-1]);
          })
        };
      }
      if (!root.mobilenet) throw new Error('sin el paquete mobilenet');
      return root.mobilenet.load(c.paquete);
    }
    async cargarModelo() {
      if (this.net || this.cargando) return;
      this.cargando = true;
      this.net = null; this.tipo = 'simple';
      if (root.tf) {
        for (const c of CANDIDATOS) {
          try {
            this.net = await this._cargarCandidato(c);
            this.backend = root.tf.getBackend();
            let ok = await this._autoprueba();
            // Algunas tarjetas gráficas devuelven NaN con WebGL: se prueba la misma red en CPU
            if (!ok && this.backend !== 'cpu') {
              this.log(`${c.nombre}: la tarjeta gráfica dio valores inválidos (NaN); se prueba en el procesador (CPU)`);
              await root.tf.setBackend('cpu'); await root.tf.ready();
              this.net = await this._cargarCandidato(c); this.backend = 'cpu';
              ok = await this._autoprueba();
            }
            if (!ok) throw new Error('autoprueba');
            this.candidato = c; this.tipo = c.tipo; this.nombreRed = c.nombre;
            break;
          } catch (e) { this.net = null; this.log(`No se pudo usar ${c.nombre}`); }
        }
      }
      if (this.net) this.log(`Red neuronal: ${this.nombreRed} (${this.backend === 'webgl' ? 'tarjeta gráfica' : this.backend})`);
      else { this.tipo = 'simple'; this.nombreRed = 'huella simple de colores'; this.log('Sin MobileNet: se usa la huella simple de colores'); }
      this.cargando = false;
      this._revisarTipo();
    }
    _revisarTipo() {
      if (this.tipoGuardado && this.tipoGuardado !== this.tipo && Object.keys(this.clases).length) {
        this.log('Las huellas guardadas se hicieron con otra red: vuelve a registrar el fondo y los gatos');
        this.clases = {}; this.fondoRef = null; this.recalcular(); this.guardarHuellas();
      }
      this.tipoGuardado = this.tipo;
    }
    async _autoprueba() {
      if (!this.net || !root.tf) return false;
      const ctx = this.cIn.getContext('2d'); if (!ctx) return false;
      const g = ctx.createLinearGradient(0, 0, V.ENTRADA, V.ENTRADA);
      g.addColorStop(0, '#c27a3a'); g.addColorStop(1, '#3a5fc2');
      ctx.fillStyle = g; ctx.fillRect(0, 0, V.ENTRADA, V.ENTRADA);
      ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.arc(80, 70, 35, 0, 7); ctx.fill();
      try {
        const t = root.tf.tidy(() => this.net.infer(this.cIn, true));
        const d = await t.data(); t.dispose();
        return valida(d);
      } catch (e) { return false; }
    }
    async _aCPU(motivo) {
      if (this.cambiando) return;
      this.cambiando = true;
      this.log(`La red dio valores inválidos (NaN) con la tarjeta gráfica (${motivo}): se pasa al procesador (CPU)`);
      try {
        await root.tf.setBackend('cpu'); await root.tf.ready();
        this.net = await this._cargarCandidato(this.candidato || CANDIDATOS[2]);
        if (!(await this._autoprueba())) throw new Error('sigue inválida');
        this.backend = 'cpu'; this.invalidas = 0;
        this.log('Red neuronal funcionando en CPU');
      } catch (e) {
        this.net = null; this.tipo = 'simple'; this.backend = null;
        this.log('La red no funciona en este navegador: se usa la huella simple. Vuelve a registrar el fondo y los gatos');
      }
      this.cambiando = false;
      this._revisarTipo();
    }

    // ---------- Captura (sensor QVGA) y recortes ----------
    // Toma una foto de la webcam al tamaño del sensor del ESP32-S3-CAM (320 × 240)
    _capturar() {
      const vw = this.video && this.video.videoWidth;
      if (!vw) return false;
      const ctx = this.cSensor.getContext('2d', { willReadFrequently: true }); if (!ctx) return false;
      ctx.drawImage(this.video, 0, 0, V.SENSOR_W, V.SENSOR_H);
      this.hayCaptura = true;
      return true;
    }
    // Dibuja la última captura en "c". Para la red (cuadrada): un recorte cuadrado, el de la
    // caja del primer plano si la hay (si no, el centro), con la variante de registro "va".
    _dibujar(c, va, caja) {
      if (!this.hayCaptura && !this._capturar()) return null;
      const ctx = c.getContext('2d', { willReadFrequently: true }); if (!ctx) return null;
      const W = V.SENSOR_W, H = V.SENSOR_H;
      if (c === this.cIn || c === this.c48) {
        let lado = Math.min(W, H), sx = (W - lado) / 2, sy = (H - lado) / 2;
        if (caja) { lado = caja.w * W; sx = caja.x * W; sy = caja.y * H; }
        const cs = lado * (va ? va.z : 1);
        const x = Math.max(0, Math.min(W - cs, sx + (lado - cs) / 2 + (va ? va.dx * lado : 0)));
        const y = Math.max(0, Math.min(H - cs, sy + (lado - cs) / 2 + (va ? va.dy * lado : 0)));
        ctx.save();
        if (va && va.f) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
        ctx.drawImage(this.cSensor, x, y, cs, cs, 0, 0, c.width, c.height);
        ctx.restore();
      } else ctx.drawImage(this.cSensor, 0, 0, c.width, c.height);
      return ctx;
    }
    // Imagen chica RGB con el brillo normalizado (para comparar con el fondo aunque cambie la luz)
    _rgbChico() {
      const ctx = this._dibujar(this.c80); if (!ctx) return null;
      const d = ctx.getImageData(0, 0, V.FG_W, V.FG_H).data;
      const n = V.FG_W * V.FG_H, o = new Float32Array(n * 3); let m = 0;
      for (let i = 0; i < n; i++) { o[i * 3] = d[i * 4]; o[i * 3 + 1] = d[i * 4 + 1]; o[i * 3 + 2] = d[i * 4 + 2]; m += d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]; }
      m = m / (n * 3) || 1;
      for (let i = 0; i < o.length; i++) o[i] = (o[i] / m) * 128;
      return o;
    }
    // Primer plano: qué parte de la imagen es distinta del fondo vacío.
    // Devuelve { frac, caja } (caja cuadrada en coordenadas 0–1 del sensor) o null sin fondo.
    _primerPlano() {
      if (!this.fondoRef) return null;
      const cur = this._rgbChico(); if (!cur) return null;
      const R = this.fondoRef, W = V.FG_W, H = V.FG_H, C = V.FG_CELDA, cw = W / C, ch = H / C;
      const cnt = new Uint8Array(cw * ch);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        if (Math.abs(cur[i] - R[i]) + Math.abs(cur[i + 1] - R[i + 1]) + Math.abs(cur[i + 2] - R[i + 2]) > V.FG_UMBRAL) cnt[((y / C) | 0) * cw + ((x / C) | 0)]++;
      }
      const on = new Uint8Array(cw * ch); let total = 0;
      for (let k = 0; k < on.length; k++) if (cnt[k] >= C * C * 0.35) { on[k] = 1; total++; }
      // Mancha más grande (vecinos arriba/abajo/izquierda/derecha)
      const visto = new Uint8Array(cw * ch); let mejor = null;
      for (let k = 0; k < on.length; k++) {
        if (!on[k] || visto[k]) continue;
        const pila = [k]; visto[k] = 1; const m = { n: 0, x0: cw, y0: ch, x1: 0, y1: 0 };
        while (pila.length) {
          const q = pila.pop(), qx = q % cw, qy = (q / cw) | 0;
          m.n++; m.x0 = Math.min(m.x0, qx); m.x1 = Math.max(m.x1, qx); m.y0 = Math.min(m.y0, qy); m.y1 = Math.max(m.y1, qy);
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([ax, ay]) => {
            const nx = qx + ax, ny = qy + ay, nk = ny * cw + nx;
            if (nx >= 0 && ny >= 0 && nx < cw && ny < ch && on[nk] && !visto[nk]) { visto[nk] = 1; pila.push(nk); }
          });
        }
        if (!mejor || m.n > mejor.n) mejor = m;
      }
      const frac = total / on.length;
      // El fondo se actualiza despacio cuando no hay nada (cambios de luz del día)
      if (frac < 0.005 && !this.reg) for (let i = 0; i < R.length; i++) R[i] = R[i] * 0.97 + cur[i] * 0.03;
      if (!mejor || mejor.n < V.FG_MIN_CELDAS) return { frac, caja: null };
      // Caja cuadrada con margen, en píxeles del sensor
      const Ws = V.SENSOR_W, Hs = V.SENSOR_H;
      const bx0 = (mejor.x0 / cw) * Ws, bx1 = ((mejor.x1 + 1) / cw) * Ws, by0 = (mejor.y0 / ch) * Hs, by1 = ((mejor.y1 + 1) / ch) * Hs;
      let lado = Math.max(bx1 - bx0, by1 - by0) * (1 + 2 * V.FG_MARGEN);
      lado = Math.min(Math.max(lado, V.FG_LADO_MIN * Hs), Math.min(Ws, Hs));
      const x = Math.max(0, Math.min(Ws - lado, (bx0 + bx1) / 2 - lado / 2)), y = Math.max(0, Math.min(Hs - lado, (by0 + by1) / 2 - lado / 2));
      return { frac, caja: { x: x / Ws, y: y / Hs, w: lado / Ws, h: lado / Hs }, area: mejor.n / on.length };
    }

    // ---------- Huellas ----------
    async huella(va, caja) {
      if (!this.webcam) return null;
      if (this.net && root.tf && !this.cambiando) {
        if (!this._dibujar(this.cIn, va, caja)) return null;
        const t0 = performance.now();
        const t = root.tf.tidy(() => this.net.infer(this.cIn, true));
        const d = await t.data(); t.dispose();
        this.tPC = performance.now() - t0;
        if (!valida(d)) {                       // NaN o vector cero: no se usa
          if (++this.invalidas >= 3) this._aCPU('durante el uso');
          return null;
        }
        this.invalidas = 0;
        return normalizar(int8(d));
      }
      return this.huellaSimple(va, caja);
    }
    huellaSimple(va, caja) {
      const ctx = this._dibujar(this.c48, va, caja); if (!ctx) return null;
      const px = ctx.getImageData(0, 0, 48, 48).data;
      const hue = new Float32Array(12), gris = new Float32Array(4), grid = new Float32Array(27);
      for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
        const i = (y * 48 + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
        const [h, s, v] = rgb2hsv(r, g, b);
        if (s > 0.2 && v > 0.15) hue[Math.floor(h / 30) % 12] += s * v; else gris[Math.min(3, Math.floor(v * 4))] += 1;
        const gi = (Math.floor(y / 16) * 3 + Math.floor(x / 16)) * 3;
        grid[gi] += r; grid[gi + 1] += g; grid[gi + 2] += b;
      }
      const partes = [normalizar(hue), normalizar(gris), normalizar(grid)];
      const out = new Float32Array(43); let o = 0;
      partes.forEach((p) => p.forEach((x) => { out[o++] = x; }));
      return normalizar(out);
    }

    recalcular() {
      // Se descartan huellas inválidas (por ejemplo, NaN de una tarjeta gráfica con problemas)
      Object.keys(this.clases).forEach((k) => { this.clases[k] = this.clases[k].filter(valida); if (!this.clases[k].length) delete this.clases[k]; });
      const ids = Object.keys(this.clases);
      this.media = null;
      if (ids.length >= 2) {
        const dim = this.clases[ids[0]][0].length; const m = new Float32Array(dim); let n = 0;
        ids.forEach((k) => this.clases[k].forEach((e) => { if (e.length === dim) { for (let i = 0; i < dim; i++) m[i] += e[i]; n++; } }));
        for (let i = 0; i < dim; i++) m[i] /= n || 1;
        this.media = m;
      }
      this.cache = {};
      ids.forEach((k) => { this.cache[k] = this.clases[k].map((e) => this._centrar(e)); });
      this.intra = {};
      ids.forEach((k) => {
        const E = this.cache[k];
        if (E.length < 2) { this.intra[k] = 0.5; return; }
        let t = 0;
        E.forEach((e, i) => { t += topkMedia(E.filter((_, j) => j !== i).map((f) => dot(e, f)), V.TOPK); });
        this.intra[k] = t / E.length;
      });
    }
    _centrar(v) {
      if (!this.media || this.media.length !== v.length) return v;
      const o = new Float32Array(v.length);
      for (let i = 0; i < v.length; i++) o[i] = v[i] - this.media[i];
      return normalizar(o);
    }

    clasificar(raw) {
      const ids = Object.keys(this.cache);
      if (!ids.length || !valida(raw)) return null;
      const x = this._centrar(raw);
      const scores = ids.map((k) => ({ id: k, s: topkMedia(this.cache[k].map((e) => dot(e, x)), V.TOPK) }));
      const mx = Math.max(...scores.map((o) => o.s));
      const ex = scores.map((o) => Math.exp((o.s - mx) / V.TAU)); const sum = ex.reduce((a, b) => a + b, 0);
      scores.forEach((o, i) => { o.p = ex[i] / sum; });
      scores.sort((a, b) => b.p - a.p);
      let best = scores[0];
      let etiqueta = best.id === '0' ? 'vacio' : 'gato';
      // Desconocido: la foto queda lejos incluso de la clase más parecida. El margen es relativo
      // a qué tan parecidas son entre sí las fotos de esa clase (intra), con un mínimo de MARGEN.
      const intra = this.intra[best.id] || 0.5;
      if (best.s < intra - Math.max(V.MARGEN, 0.35 * intra)) etiqueta = 'desconocido';
      // Excepción de los collares: gatos parecidos con collar asignado
      let collar = null;
      if (etiqueta === 'gato') {
        const g = this.gatos.find((y) => String(y.id) === best.id);
        const grupo = g && g.collar ? this.gatos.filter((y) => y.collar && (y.id === g.id || (g.huella && g.huella.parecidoA === y.id) || (y.huella && y.huella.parecidoA === g.id))) : [];
        if (grupo.length >= 2) {
          this.colores();
          const cand = grupo.map((y) => ({ y, f: this.colorFrac[y.collar] || 0 })).sort((a, b) => b.f - a.f);
          if (cand[0].f >= 0.004) {
            collar = cand[0].y.collar;
            const elegido = scores.find((o) => o.id === String(cand[0].y.id));
            if (elegido && elegido !== best) { const p = best.p; best = elegido; best.p = Math.max(best.p, p); }
          } else etiqueta = 'sin collar';
        }
      }
      return { scores, best, etiqueta, collar };
    }

    // Color del collar: se mira dentro de la caja del gato si la hay
    colores() {
      const caja = this.fg && this.fg.caja;
      const ctx = caja ? this._dibujar(this.c48, null, caja) : this._dibujar(this.c64); if (!ctx) return;
      const w = caja ? 48 : 64, h = 48;
      const px = ctx.getImageData(0, 0, w, h).data; const n = w * h;
      const f = { rojo: 0, amarillo: 0, verde: 0, azul: 0 };
      for (let i = 0; i < px.length; i += 4) {
        const [hh, s, v] = rgb2hsv(px[i], px[i + 1], px[i + 2]);
        for (const c in COLORES) if (COLORES[c](hh, s, v)) f[c]++;
      }
      for (const c in f) f[c] /= n;
      this.colorFrac = f;
    }

    // ---------- Restos sobre el papel (zona de comida) ----------
    _grisROI() {
      this._capturar();
      const ctx = this._dibujar(this.c64); if (!ctx) return null;
      const r = this.roi, x0 = Math.floor(r.x0 * 64), x1 = Math.ceil(r.x1 * 64), y0 = Math.floor(r.y0 * 48), y1 = Math.ceil(r.y1 * 48);
      const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data; const g = new Float32Array(d.length / 4); let m = 0;
      for (let i = 0; i < g.length; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; m += g[i]; }
      m = m / g.length || 1;
      for (let i = 0; i < g.length; i++) g[i] /= m;
      return g;
    }
    revisarPlato() {
      this.platoVisto = performance.now();
      if (!this.platoRef) return { msg: 'SINREF' };
      const g = this._grisROI(); if (!g) return { msg: 'SINREF' };
      // Cada píxel se compara con su vecindario 3×3 de la referencia: un temblor de 1 píxel
      // (cámara que vibra, ruido del sensor) no cuenta como restos; una mancha de comida sí.
      const r = this.roi, w = Math.ceil(r.x1 * 64) - Math.floor(r.x0 * 64), ref = this.platoRef;
      if (ref.length !== g.length) return { msg: 'SINREF' };
      const h = g.length / w;
      let c = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = g[y * w + x]; let dmin = 9;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
          const d = Math.abs(v - ref[yy * w + xx]); if (d < dmin) dmin = d;
        }
        if (dmin > 0.22) c++;
      }
      const pct = Math.round((c / g.length) * 1000) / 10;
      this.ultimoPlato = pct;
      return { msg: pct >= V.RESTOS_UMBRAL_PCT ? 'RESTOS,' + pct : 'LIMPIO,' + pct };
    }

    // ---------- UART ----------
    recibir(msg) {
      if (this.noResponde) return;
      const p = msg.split(','), ahora = performance.now();
      switch (p[0]) {
        case 'REC': this.rec = true; this.tRec = ahora; this.racha = { id: null, n: 0 }; this.ultimoEnvio = {}; this.despertar('REC'); break;
        case 'FIN': this.rec = false; if (this.estado === 'RECONOCIENDO') this._estado('DESPIERTA'); this.despiertaHasta = ahora + V.T_DORMIR_MS; break;
        case 'REVISAR': this.platoPend = ahora + V.T_DESPERTAR_MS; this.despertar('REVISAR restos'); break;
        case 'CALPAPEL':
          this.despertar('CALPAPEL'); this.platoVisto = performance.now() + V.T_DESPERTAR_MS;
          setTimeout(() => {
            const g = this._grisROI();
            if (g) { this.platoRef = g; this.guardarHuellas(); this.enviar('CALOK'); this.log('Papel limpio calibrado'); }
            else this.log('No hay imagen para calibrar el papel limpio');
          }, V.T_DESPERTAR_MS);
          break;
        case 'REG': this.empezarRegistro(+p[1]); break;
        case 'BORRAR': delete this.clases[p[1]]; this.recalcular(); this.guardarHuellas(); break;
        case 'VER': this.verHasta = ahora + 65000; this.proxVista = 0; this.despertar('VER (el dueño quiere mirar)'); break;
        case 'NOVER': if (this.verHasta) { this.verHasta = 0; this.subirFoto(null); this.log('El dueño dejó de mirar: Wi-Fi de la cámara apagado'); } break;
      }
    }
    viendo() { return performance.now() < this.verHasta; }
    // Foto JPEG del sensor (QVGA, como la que comprime el OV3660) para el dueño
    _subirVista() {
      if (!this._capturar()) return;
      let jpg = null;
      try { jpg = this.cSensor.toDataURL('image/jpeg', 0.6); } catch (e) { return; }
      this.fotosSubidas++;
      const p = this.pred && this.estado === 'RECONOCIENDO' && this.pred.clases ? this.pred : null;
      this.subirFoto({ jpg, kb: Math.round((jpg.length * 0.75) / 1024), n: this.fotosSubidas,
        caja: this.fg && this.fg.caja && (this.estado === 'RECONOCIENDO' || this.estado === 'REGISTRANDO') ? this.fg.caja : null,
        texto: this.estado === 'REGISTRANDO' ? 'aprendiendo' : p ? `${p.mejor} ${Math.round((p.clases[0] || {}).p * 100 || 0)} %` : '' });
    }
    despertar(motivo) {
      const ahora = performance.now();
      this.despiertaHasta = ahora + V.T_DORMIR_MS;
      if (this.estado === 'DORMIDA' || this.estado === 'APAGADA') {
        this._estado('DESPERTANDO');
        this.proxOK = ahora;
        this.log('Despierta por ' + motivo);
      }
    }
    _estado(e) {
      this.estado = e; this.tEstado = performance.now();
      // La primera foto no está lista al instante: tarda captura + inferencia (0.71 s en el ESP32-S3)
      if (e === 'RECONOCIENDO') this.proxFoto = this.tEstado + tFoto();
    }

    empezarRegistro(id) {
      if (!this.webcam) { this.log('Enciende la webcam para registrar'); return; }
      this.despertar('registro');
      this.reg = { id, fotos: [], prox: performance.now() + V.T_DESPERTAR_MS, t0: performance.now(), vacias: 0, acum: id === 0 ? new Float32Array(V.FG_W * V.FG_H * 3) : null, nAcum: 0 };
      this._estado('REGISTRANDO');
      this.log(id === 0 ? 'Registrando el fondo vacío: que no haya gato a la vista' : 'Registrando: pon al gato frente a la cámara');
    }
    async _pasoRegistro() {
      const r = this.reg; if (!r) return;
      this._capturar();
      let caja = null;
      if (r.id === 0) {
        const c = this._rgbChico();
        if (c && r.acum) { for (let i = 0; i < c.length; i++) r.acum[i] += c[i]; r.nAcum++; }
      } else if (this.fondoRef) {
        const fg = this._primerPlano(); this.fg = fg;
        if (!fg || !fg.caja) {                  // no hay nada distinto al fondo: esta foto no sirve
          r.vacias++;
          if (r.vacias % 4 === 1) this.log('No veo nada distinto al fondo: acerca el gato (o la foto) a la cámara');
          return;
        }
        caja = fg.caja;
      }
      const h = await this.huella(VARIANTES[r.fotos.length % VARIANTES.length], caja);
      if (h && this.reg === r) r.fotos.push(h);
    }
    async _terminarRegistro() {
      const r = this.reg; this.reg = null;
      const { id, fotos } = r;
      const k = String(id);
      this._estado(this.rec ? 'RECONOCIENDO' : 'DESPIERTA');
      if (id !== 0 && fotos.length < V.REG_MIN_FOTOS && r.t0 !== undefined) {
        this.enviar(`REGMAL,${id},${fotos.length}`);
        this.log(`Registro fallido: solo ${fotos.length} fotos con el gato a la vista. Acércalo a la cámara y vuelve a intentar`);
        return;
      }
      if (id === 0 && r.acum && r.nAcum) this.fondoRef = Float32Array.from(r.acum, (x) => x / r.nAcum);
      this.clases[k] = (this.clases[k] || []).concat(fotos).slice(-V.MAX_EJEMPLOS);
      this.recalcular(); this.guardarHuellas();
      if (id === 0) { this.enviar('FONDOOK'); this.log('Fondo vacío registrado'); return; }
      if (!this.cache[k]) { this.enviar(`REGMAL,${id},0`); this.log('Registro fallido: las fotos no sirvieron'); return; }
      // ¿Se parece a otro gato?
      let peor = { j: 0, s: -1 };
      const Ei = this.cache[k];
      Object.keys(this.cache).filter((j) => j !== k && j !== '0').forEach((j) => {
        const Ej = this.cache[j];
        const cruz = Ei.reduce((t, e) => t + topkMedia(Ej.map((f) => dot(e, f)), V.TOPK), 0) / Ei.length;
        if (cruz > peor.s) peor = { j: +j, s: cruz };
      });
      const parecido = peor.j && peor.s >= (this.intra[k] || 0.5) - 0.1 ? 1 : 0;
      this.enviar(`REGOK,${id},${this.clases[k].length},${peor.j},${parecido},${peor.s.toFixed(2)}`);
      this.log(`Huella guardada (${this.clases[k].length} fotos)` + (parecido ? ' — se parece a otro gato' : ''));
    }

    // ---------- Bucle ----------
    async tick() {
      const ahora = performance.now();
      if (this.noResponde) { this.pirActivo = false; return; }
      if (this.webcam && ahora >= this.proxPIR) { this.proxPIR = ahora + V.PIR_CADA_MS; this._pir(ahora); }
      // PIR: activo mientras hubo movimiento en los últimos 2 s (webcam o botón "Simular").
      if (ahora < this.pirManualHasta) this.ultimoMov = ahora;
      this.pirActivo = ahora - this.ultimoMov < V.PIR_HOLD_MS;
      // El PIR despierta la cámara y avisa al ESP32 (MOV) mientras haya movimiento
      if (this.pirActivo) {
        this.despertar('PIR');
        if (ahora >= this.proxMov) { this.proxMov = ahora + 1000; this.enviar('MOV'); }
      }
      if (this.verHasta && ahora >= this.verHasta) { this.verHasta = 0; this.subirFoto(null); this.log('Se dejó de transmitir (60 s)'); }
      if (this.viendo()) this.despertar('VER');
      const despierta = !['APAGADA', 'DORMIDA'].includes(this.estado);
      if (!despierta) { this.ledsNoche = false; return; }
      if (this.viendo() && this.estado !== 'DESPERTANDO' && ahora >= this.proxVista) { this.proxVista = ahora + 1000; this._subirVista(); }
      if (ahora >= this.proxOK) { this.proxOK = ahora + V.HEARTBEAT_MS; this.enviar('OK'); }
      this.ledsNoche = this.webcam && this.brillo < V.BRILLO_NOCHE;
      if (this.estado === 'DESPERTANDO' && ahora - this.tEstado >= V.T_DESPERTAR_MS) this._estado(this.reg ? 'REGISTRANDO' : this.rec ? 'RECONOCIENDO' : 'DESPIERTA');
      if (this.estado === 'DESPERTANDO') return;
      if (this.platoPend && ahora >= this.platoPend) { this.platoPend = 0; const r = this.revisarPlato(); this.enviar(r.msg); this.log('Restos en el papel: ' + r.msg.replace(',', ' ') + (r.msg.startsWith('SINREF') ? ' (falta calibrar)' : ' %')); }
      if (this.procesando) return;
      if (this.estado === 'REGISTRANDO' && this.reg && ahora >= this.reg.prox) {
        // Cada foto del registro tarda lo mismo que en el ESP32-S3 (captura + inferencia)
        const r = this.reg;
        this.procesando = true;
        try {
          await this._pasoRegistro();
          r.prox = performance.now() + tFoto();
          if (this.reg === r && (r.fotos.length >= V.REG_FOTOS || performance.now() - r.t0 > V.REG_MAX_MS)) await this._terminarRegistro();
        } finally { this.procesando = false; }
        this.despiertaHasta = performance.now() + V.T_DORMIR_MS;
        return;
      }
      if (this.estado === 'DESPIERTA' && this.rec) this._estado('RECONOCIENDO');
      if (this.estado === 'RECONOCIENDO' && ahora >= this.proxFoto) {
        this.proxFoto = ahora + tFoto();
        this.despiertaHasta = ahora + V.T_DORMIR_MS;
        this.procesando = true;
        try { await this._foto(); } finally { this.procesando = false; }
        return;
      }
      if (this.estado === 'DESPIERTA' && !this.rec && !this.platoPend && ahora > this.despiertaHasta) { this._estado('DORMIDA'); this.log('Se duerme: sin movimiento por 15 s'); }
    }

    // PIR AM312 simulado: diferencia entre dos imágenes chicas seguidas de la webcam
    _pir(ahora) {
      const vw = this.video && this.video.videoWidth; if (!vw) return;
      const ctx = this.c32.getContext('2d', { willReadFrequently: true }); if (!ctx) return;
      ctx.drawImage(this.video, 0, 0, 32, 24);
      const d = ctx.getImageData(0, 0, 32, 24).data; const g = new Float32Array(768); let suma = 0;
      for (let i = 0; i < 768; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; suma += g[i]; }
      this.brillo = suma / 768;
      if (this.prevGris && ahora > this.ignorarPIRHasta) {
        let c = 0; for (let i = 0; i < 768; i++) if (Math.abs(g[i] - this.prevGris[i]) > 22) c++;
        this.pirNivel = c / 768;
        // Con el fondo vacío registrado, solo cuenta el movimiento de algo que no es el fondo
        // (el gato), no el de la persona que está siempre frente a la webcam.
        if (this.pirWebcam && this.pirNivel > V.PIR_SENS) {
          let hayAlgo = true;
          if (this.fondoRef && !this.reg) { this._capturar(); const fg = this._primerPlano(); hayAlgo = !!(fg && fg.caja); this.pirFondo = !hayAlgo; }
          if (hayAlgo) this.ultimoMov = ahora;
        }
      }
      this.prevGris = g;
    }

    async _foto() {
      if (!this.webcam) { this.pred = { sinImagen: true }; return; }
      // Sin la foto del fondo vacío no hay con qué comparar "no hay gato": cualquier cosa
      // se parecería al único gato registrado. Por eso no se reconoce hasta registrarlo.
      if (!this.cache['0'] && Object.keys(this.cache).length) { this.pred = { sinFondo: true }; this.racha = { id: null, n: 0 }; return; }
      this._capturar();
      const fg = this._primerPlano(); this.fg = fg;
      const ahora = performance.now();
      // Nada distinto al fondo: plataforma vacía, sin gastar la red neuronal (ahorra energía)
      if (fg && !fg.caja && this.cache['0']) {
        this.racha = { id: null, n: 0 };
        if (this.ultimoEnvio.v === undefined || ahora - this.ultimoEnvio.v > 2000) { this.enviar('VACIO'); this.ultimoEnvio.v = ahora; }
        this.pred = { clases: [{ nombre: 'Vacío', p: 1, s: 1 }], etiqueta: 'vacio', racha: 0, decision: 'Igual al fondo vacío: no hay gato (no hizo falta la red)', mejor: 'Vacío', sinRed: true };
        return;
      }
      const h = await this.huella(null, fg ? fg.caja : null); if (!h) return;
      const r = this.clasificar(h);
      if (!r) { this.pred = { sinHuellas: true }; return; }
      const nombre = (id) => id === '0' ? 'Vacío' : ((this.gatos.find((g) => String(g.id) === id) || {}).nombre || 'Gato ' + id);
      const { best, etiqueta } = r;
      const ahora2 = performance.now();
      if (etiqueta === 'gato' && best.p >= V.UMBRAL_P) {
        this.racha = this.racha.id === best.id ? { id: best.id, n: this.racha.n + 1 } : { id: best.id, n: 1 };
      } else this.racha = { id: null, n: 0 };
      let decision = '';
      if (this.racha.n >= V.FOTOS) {
        const ult = this.ultimoEnvio[best.id];
        if (ult === undefined || ahora2 - ult > 5000) {
          this.enviar(`GATO,${best.id},${best.p.toFixed(2)}`); this.ultimoEnvio[best.id] = ahora2;
          this.ultimaRespuestaS = this.tRec ? Math.round((ahora2 - this.tRec) / 100) / 10 : null;
          decision = `Enviado GATO,${best.id}` + (this.ultimaRespuestaS ? ` (${this.ultimaRespuestaS} s desde REC)` : '');
          if (this.ultimaRespuestaS) this.log(`Reconocido ${nombre(best.id)} en ${this.ultimaRespuestaS} s (requisito ≤ 5 s)`);
        }
        this.racha = { id: null, n: 0 };
      } else if (etiqueta === 'vacio' && best.p >= V.UMBRAL_P) {
        if (this.ultimoEnvio.v === undefined || ahora2 - this.ultimoEnvio.v > 2000) { this.enviar('VACIO'); this.ultimoEnvio.v = ahora2; }
        decision = 'Plataforma vacía';
      } else if (etiqueta === 'desconocido' || etiqueta === 'sin collar') {
        if (this.ultimoEnvio.o === undefined || ahora2 - this.ultimoEnvio.o > 2000) { this.enviar('OTRO,' + best.p.toFixed(2)); this.ultimoEnvio.o = ahora2; }
        decision = etiqueta === 'sin collar' ? 'Gato parecido sin su collar a la vista' : 'No se parece a ningún gato registrado';
      } else if (etiqueta === 'gato' && best.p >= V.UMBRAL_P) decision = `Coincide con ${nombre(best.id)}: ${this.racha.n} de ${V.FOTOS} fotos seguidas`;
      else decision = `Dudoso: no llega a ${V.UMBRAL_P}`;
      this.pred = {
        clases: r.scores.slice(0, 5).map((o) => ({ nombre: nombre(o.id), p: o.p, s: o.s })),
        etiqueta, racha: this.racha.n, decision, collar: r.collar, mejor: nombre(best.id)
      };
    }

    // Sin webcam: simular a mano que llega un gato (para presentar sin cámara)
    simularGato(id) {
      if (this.noResponde) return;
      this.pirManualHasta = performance.now() + 3000;   // el PIR lo ve (en modo libre esto despierta todo)
      const t0 = performance.now();
      const intentar = () => {
        if (this.noResponde) return;
        if (this.rec && performance.now() - t0 >= 2100) { this.enviar(`GATO,${id},0.95`); return; }
        if (performance.now() - t0 < 6000) setTimeout(intentar, 150);
      };
      setTimeout(intentar, 150);
    }
    simularPIR(seg) { this.pirManualHasta = performance.now() + (seg || 3) * 1000; }

    // ---------- Datos del módulo (para el panel) ----------
    memoriaKB() {
      let n = 0, dim = 0;
      for (const k in this.clases) { n += this.clases[k].length; if (this.clases[k][0]) dim = this.clases[k][0].length; }
      return Math.round((n * dim + (this.fondoRef ? this.fondoRef.length : 0)) / 1024);
    }

    // ---------- Persistencia (en el equipo real: memoria flash del módulo) ----------
    guardarHuellas() {
      try {
        const o = {
          tipo: this.tipo || this.tipoGuardado, clases: {},
          platoRef: this.platoRef ? Array.from(this.platoRef, (x) => Math.round(x * 1000) / 1000) : null,
          fondoRef: this.fondoRef ? Array.from(this.fondoRef, (x) => Math.round(Math.min(255, Math.max(0, x)))) : null
        };
        for (const k in this.clases) o.clases[k] = this.clases[k].map(cuantizar);
        localStorage.setItem(CLAVE, JSON.stringify(o));
      } catch (e) { this.log('No se pudieron guardar las huellas: ' + e.message); }
    }
    cargarHuellas() {
      try {
        const o = JSON.parse(localStorage.getItem(CLAVE) || 'null'); if (!o) return;
        this.tipoGuardado = o.tipo;
        for (const k in o.clases) this.clases[k] = o.clases[k].map(descuantizar);
        if (o.platoRef) this.platoRef = Float32Array.from(o.platoRef);
        if (o.fondoRef) this.fondoRef = Float32Array.from(o.fondoRef);
        this.recalcular();
      } catch (e) { console.warn(e); }
    }
    borrarTodo() { this.clases = {}; this.platoRef = null; this.fondoRef = null; this.recalcular(); localStorage.removeItem(CLAVE); }
    resumenHuellas() { const o = {}; for (const k in this.clases) o[k] = this.clases[k].length; return o; }
  }

  root.CamaraVirtual = CamaraVirtual;
})(window);
