// =============================================================================
// Simulación de la visión (node pruebas/test_vision.js)
// Usa "huellas" sintéticas con la forma de las de MobileNet (1280 valores ≥ 0):
// cada gato = un centro + ruido. Se prueban las variables: ruido, número de gatos,
// parecido entre gatos, gatos desconocidos, collares, rachas de 3 fotos, plato y guardado.
// =============================================================================
const path = require('path');
const fs = require('fs');
// ---- Entorno mínimo de navegador ----
const almacen = {};
global.window = globalThis;
global.localStorage = { getItem: (k) => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: (k) => { delete almacen[k]; } };
global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
require(path.join(__dirname, '..', 'js', 'vision.js'));
const CamaraVirtual = global.CamaraVirtual;

let semilla = 99;
const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
const gauss = () => { let u = 0, v = 0; while (!u) u = azar(); while (!v) v = azar(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const DIM = 1280;
// Todas las fotos comparten el fondo de la cocina; cada gato agrega su propio patrón
const FONDO = Float32Array.from({ length: DIM }, () => Math.max(0, 0.6 + 0.4 * gauss()));
function patron(fuerza) { return Float32Array.from({ length: DIM }, () => Math.max(0, gauss()) * fuerza); }
function mezcla(a, b, t) { return Float32Array.from(a, (x, i) => x * (1 - t) + b[i] * t); }
function foto(centro, ruido) { return Float32Array.from(centro, (x) => Math.max(0, x + ruido * Math.abs(gauss()) * (azar() < 0.5 ? -1 : 1))); }
const norm = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n); return Float32Array.from(v, (x) => x / n); };
const gato = (fuerza) => { const p = patron(fuerza || 1); return Float32Array.from(FONDO, (x, i) => x + p[i]); };

function nuevaCam(conservar) {
  if (!conservar) for (const k in almacen) delete almacen[k];   // cada caso empieza sin huellas guardadas
  const c = new CamaraVirtual({});
  c.mensajes = []; c.enviados = []; c.enviar = (m) => c.enviados.push(m);
  return c;
}
const RUIDO_FONDO = 0.15; // la plataforma vacía casi no cambia entre fotos (escena quieta)
function registrar(cam, id, centro, ruido, n) {
  if (String(id) === '0') ruido = Math.min(ruido, RUIDO_FONDO);
  cam.clases[String(id)] = Array.from({ length: n || 30 }, () => norm(foto(centro, ruido)));
  cam.recalcular();
}
const resultados = [];
function caso(nombre, ok, detalle) { resultados.push({ grupo: 'V', nombre, ok, detalle }); console.log(`${ok ? '  ✔' : '  ✘'} ${nombre}${detalle ? ' — ' + detalle : ''}`); }

(async () => {
  console.log('V. Visión por computadora (huellas + vecinos más cercanos)');
  // ---- 1. Precisión según el ruido de la imagen ----
  const tabla = [];
  for (const ruido of [0.2, 0.4, 0.6, 0.8]) {
    const cam = nuevaCam();
    const C = { 0: FONDO, 1: gato(), 2: gato(), 3: gato() };
    for (const k in C) registrar(cam, k, C[k], ruido);
    let bien = 0, tot = 0;
    for (const k in C) for (let i = 0; i < 100; i++) {
      const r = cam.clasificar(norm(foto(C[k], k === '0' ? Math.min(ruido, RUIDO_FONDO) : ruido)));
      const esperado = k === '0' ? 'vacio' : 'gato';
      if (r.best.id === k && r.etiqueta === esperado) bien++; tot++;
    }
    tabla.push({ ruido, precision: bien / tot });
  }
  caso('Precisión con 3 gatos + fondo según el ruido', tabla.every((f) => f.ruido > 0.6 || f.precision >= 0.95), tabla.map((f) => `ruido ${f.ruido}: ${(f.precision * 100).toFixed(1)} %`).join(' · '));

  // ---- 2. Número de gatos (1 a 4) ----
  const porN = [];
  for (let n = 1; n <= 4; n++) {
    const cam = nuevaCam(); const C = { 0: FONDO };
    for (let i = 1; i <= n; i++) C[i] = gato();
    for (const k in C) registrar(cam, k, C[k], 0.4);
    let bien = 0, tot = 0;
    for (const k in C) for (let i = 0; i < 80; i++) { const r = cam.clasificar(norm(foto(C[k], k === '0' ? RUIDO_FONDO : 0.4))); if (r.best.id === k) bien++; tot++; }
    porN.push(`${n} gato${n > 1 ? 's' : ''}: ${(bien / tot * 100).toFixed(1)} %`);
  }
  caso('Precisión con 1, 2, 3 y 4 gatos registrados', porN.every((t) => parseFloat(t.split(': ')[1]) >= 95), porN.join(' · '));

  // ---- 3. Gato desconocido → OTRO ----
  {
    const cam = nuevaCam(); const C = { 0: FONDO, 1: gato(), 2: gato() };
    for (const k in C) registrar(cam, k, C[k], 0.4);
    const extraño = gato(); let otros = 0;
    for (let i = 0; i < 100; i++) if (cam.clasificar(norm(foto(extraño, 0.4))).etiqueta === 'desconocido') otros++;
    let falsos = 0;
    for (let i = 0; i < 100; i++) if (cam.clasificar(norm(foto(C[1], 0.4))).etiqueta === 'desconocido') falsos++;
    caso('Gato no registrado: se marca como desconocido (OTRO)', otros >= 90 && falsos <= 5, `${otros}/100 desconocidos · ${falsos}/100 gatos propios rechazados por error`);
  }

  // ---- 4. Parecido entre gatos: cuándo pide collares ----
  const parecidos = [];
  for (const t of [0.0, 0.5, 0.8, 0.95]) {
    const cam = nuevaCam();
    const A = gato(); const B = mezcla(gato(), A, t);
    registrar(cam, 0, FONDO, 0.4); registrar(cam, 1, A, 0.4);
    cam.reg = { id: 2, fotos: Array.from({ length: 30 }, () => norm(foto(B, 0.4))) };
    await cam._terminarRegistro();
    const msg = cam.enviados.find((m) => m.startsWith('REGOK,2'));
    const pide = msg.split(',')[4] === '1';
    let bien = 0; for (let i = 0; i < 100; i++) if (cam.clasificar(norm(foto(B, 0.4))).best.id === '2') bien++;
    parecidos.push({ t, pide, bien });
  }
  caso('Gatos parecidos: la app pide collares solo cuando se confunden', parecidos[0].pide === false && parecidos[3].pide === true && parecidos.every((p) => p.pide || p.bien >= 90),
    parecidos.map((p) => `parecido ${Math.round(p.t * 100)} %: ${p.pide ? 'pide collar' : 'sin collar'} (acierta ${p.bien} %)`).join(' · '));

  // ---- 5. Collares: decide el color visible ----
  {
    const cam = nuevaCam();
    const A = gato(); const B = mezcla(gato(), A, 0.97);
    registrar(cam, 0, FONDO, 0.4); registrar(cam, 1, A, 0.4); registrar(cam, 2, B, 0.4);
    cam.gatos = [{ id: 1, nombre: 'Michi', collar: 'rojo', huella: { parecidoA: 2 } }, { id: 2, nombre: 'Max', collar: 'azul', huella: { parecidoA: 1 } }];
    let bien = 0, sinCollar = 0;
    for (let i = 0; i < 100; i++) {
      const real = i % 2 ? 1 : 2;
      cam.colores = function () { this.colorFrac = { rojo: real === 1 ? 0.02 : 0, azul: real === 2 ? 0.02 : 0, amarillo: 0, verde: 0 }; };
      const r = cam.clasificar(norm(foto(real === 1 ? A : B, 0.4)));
      if (r.best.id === String(real)) bien++;
    }
    cam.colores = function () { this.colorFrac = { rojo: 0, azul: 0, amarillo: 0, verde: 0 }; };
    for (let i = 0; i < 50; i++) if (cam.clasificar(norm(foto(A, 0.4))).etiqueta === 'sin collar') sinCollar++;
    caso('Collares: con gatos casi iguales decide el color del collar', bien >= 98 && sinCollar === 50, `acierta ${bien}/100 · sin collar visible → "sin collar" ${sinCollar}/50`);
  }

  // ---- 6. Regla de 3 fotos seguidas ≥ 0.8 ----
  {
    const cam = nuevaCam(); const C = { 0: FONDO, 1: gato(), 2: gato() };
    for (const k in C) registrar(cam, k, C[k], 0.4);
    cam.webcam = true;
    const secuencia = [1, 2, 1, 1, 2, 1, 1, 1];
    let i = 0; cam.huella = async () => norm(foto(C[secuencia[i++]], 0.4));
    const antes = [];
    for (let k = 0; k < secuencia.length; k++) { await cam._foto(); antes.push(cam.enviados.filter((m) => m.startsWith('GATO')).length); }
    const g = cam.enviados.filter((m) => m.startsWith('GATO'));
    caso('Solo envía GATO tras 3 fotos seguidas del mismo gato', g.length === 1 && g[0].startsWith('GATO,1') && antes.indexOf(1) === 7, `secuencia ${secuencia.join('-')} → ${g.join(', ')} en la foto ${antes.indexOf(1) + 1}`);
    cam.racha = { id: null, n: 0 }; i = 0; const s2 = [1, 1, 1, 1, 1, 1]; cam.huella = async () => norm(foto(C[s2[i++]], 0.4));
    for (let k = 0; k < 6; k++) await cam._foto();
    caso('No repite GATO del mismo gato en menos de 5 s', cam.enviados.filter((m) => m.startsWith('GATO')).length === 1, `${cam.enviados.filter((m) => m.startsWith('GATO')).length} mensaje(s) GATO`);
    i = 0; cam.huella = async () => norm(foto(FONDO, RUIDO_FONDO)); cam.ultimoEnvio = {}; cam.enviados = [];
    await cam._foto();
    caso('Plataforma vacía → VACIO', cam.enviados.includes('VACIO'), cam.enviados.join(', '));
  }

  // ---- 7. Restos en el plato ----
  {
    const cam = nuevaCam(); const N = 32 * 20;
    const limpio = Float32Array.from({ length: N }, () => 1 + 0.03 * gauss());
    cam._grisROI = () => limpio; cam.recibir('CALPAPEL');
    await new Promise((r) => setTimeout(r, 650));
    const prueba = (frac, luz) => {
      const g = Float32Array.from(limpio, (x) => x * (luz || 1) + 0.03 * gauss());
      for (let k = 0; k < Math.round(N * frac); k++) g[Math.floor(azar() * N)] = 0.4;
      let m = 0; for (const x of g) m += x; m /= N; const gn = Float32Array.from(g, (x) => x / m);
      cam._grisROI = () => gn; return cam.revisarPlato().msg;
    };
    const filas = [[0, 1], [0, 1.4], [0.01, 1], [0.05, 1], [0.12, 1], [0.08, 0.7]].map(([f, luz]) => ({ f, luz, msg: prueba(f, luz) }));
    const ok = filas[0].msg.startsWith('LIMPIO') && filas[1].msg.startsWith('LIMPIO') && filas[2].msg.startsWith('LIMPIO') && filas[3].msg.startsWith('RESTOS') && filas[4].msg.startsWith('RESTOS') && filas[5].msg.startsWith('RESTOS');
    caso('Plato: limpio, con más luz, y con restos de 1 %, 5 %, 12 %', ok && cam.enviados.includes('CALOK'), filas.map((x) => `${Math.round(x.f * 100)} % restos${x.luz !== 1 ? ` (luz ×${x.luz})` : ''} → ${x.msg}`).join(' · '));
    const sinRef = nuevaCam(); sinRef._grisROI = () => limpio;
    caso('Plato sin calibrar → SINREF', sinRef.revisarPlato().msg === 'SINREF');
  }

  // ---- 8. Guardar y cargar huellas (int8 + base64) ----
  {
    const cam = nuevaCam(); const C = { 0: FONDO, 1: gato(), 2: gato() };
    for (const k in C) registrar(cam, k, C[k], 0.4);
    cam.tipo = 'mobilenet-v2-0.5'; cam.guardarHuellas();
    const kb = (almacen.comedero_huellas_v2.length / 1024).toFixed(0);
    const cam2 = nuevaCam(true);
    let iguales = 0;
    for (let i = 0; i < 100; i++) { const f = norm(foto(C[1 + (i % 2)], 0.4)); if (cam.clasificar(f).best.id === cam2.clasificar(f).best.id) iguales++; }
    caso('Huellas guardadas y cargadas dan el mismo resultado', iguales === 100 && Object.keys(cam2.clases).length === 3, `${iguales}/100 iguales · ${kb} KB en el navegador`);
  }

  // ---- 9. Ciclo de sueño de la cámara ----
  {
    const cam = nuevaCam(); cam.estado = 'DORMIDA';
    cam.recibir('REC'); const desperto = cam.estado === 'DESPERTANDO';
    cam.noResponde = true; const n0 = cam.enviados.length; cam.recibir('REC'); await cam.tick();
    caso('REC despierta la cámara; con falla no responde nada', desperto && cam.enviados.length === n0);
  }
  {
    // Sin el fondo vacío registrado no se reconoce (con un solo gato, todo daría p = 1.00)
    const cam = nuevaCam(); cam.webcam = true;
    const G = gato(); registrar(cam, 1, G, 0.4);
    cam.huella = async () => norm(foto(FONDO, RUIDO_FONDO)); cam.rec = true;
    for (let k = 0; k < 5; k++) await cam._foto();
    const sinFondo = cam.pred && cam.pred.sinFondo && !cam.enviados.some((m) => m.startsWith('GATO'));
    registrar(cam, 0, FONDO, RUIDO_FONDO); cam.huella = async () => norm(foto(G, 0.4));
    for (let k = 0; k < 4; k++) await cam._foto();
    caso('Sin fondo registrado no reconoce; con el fondo sí', sinFondo && cam.enviados.some((m) => m.startsWith('GATO,1')), cam.enviados.join(' '));
  }
  {
    // La red da NaN (tarjeta gráfica con problemas): no se guardan huellas inválidas y se pasa a CPU
    const cam = nuevaCam(); cam.webcam = true; cam._dibujar = () => ({});
    cam.cIn = { width: 160, height: 160, getContext: () => ({ createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {} }) };
    const tensor = (arr) => ({ data: async () => Float32Array.from(arr), dispose() {} });
    const mala = { infer: () => tensor(Array.from({ length: 1280 }, () => NaN)) };
    const buena = { infer: () => tensor(Array.from({ length: 1280 }, (_, i) => (i % 7) / 7)) };
    let backend = 'webgl';
    global.tf = { tidy: (f) => f(), setBackend: async (b) => { backend = b; }, ready: async () => {}, getBackend: () => backend };
    global.mobilenet = { load: async () => buena };
    cam.net = mala; cam.tipo = 'mobilenet-v2-0.5';
    const r1 = [await cam.huella(), await cam.huella(), await cam.huella()];
    await new Promise((r) => setTimeout(r, 50));
    const h = await cam.huella();
    cam.clases = { 0: [norm(FONDO), Float32Array.from({ length: 1280 }, () => NaN)], 1: [Float32Array.from({ length: 1280 }, () => 0)] }; cam.recalcular();
    caso('Red con NaN: se descartan esas huellas y pasa sola a CPU', r1.every((x) => x === null) && cam.backend === 'cpu' && h && h.every(Number.isFinite) && cam.clases['0'].length === 1 && !cam.clases['1'] && cam.clasificar(Float32Array.from({ length: 1280 }, () => NaN)) === null,
      `3 huellas NaN rechazadas → backend ${cam.backend}; huella válida después: ${!!h}; clases limpias: ${JSON.stringify(cam.resumenHuellas())}`);
    delete global.tf; delete global.mobilenet;
  }
  {
    // Carga de la red: primero la de la tesis (α = 0.35 a 160 × 160); si no carga, la siguiente;
    // si una da NaN en la tarjeta gráfica, se reintenta la misma en CPU.
    const cam = nuevaCam();
    cam.cIn = { width: 160, height: 160, getContext: () => ({ createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {} }) };
    class T { constructor(v, shape) { this.v = v; this.shape = shape; } toFloat() { return this; } div() { return this; } expandDims() { return this; } async data() { return Float32Array.from(this.v); } dispose() {} }
    let backend = 'webgl'; const pedidas = [];
    global.tf = {
      tidy: (f) => f(), getBackend: () => backend, setBackend: async (b) => { backend = b; }, ready: async () => {},
      browser: { fromPixels: () => new T([0], [160, 160, 3]) }, image: { resizeBilinear: (x) => new T(x.v, [224, 224, 3]) },
      reshape: (t) => t,
      loadGraphModel: async (url) => {
        pedidas.push(url.replace(/.*mobilenet_/, ''));
        if (url.includes('035_160')) throw new Error('404');
        return { execute: () => new T(Array.from({ length: 1280 }, (_, i) => (backend === 'webgl' ? NaN : (i % 5) / 5)), [1, 1, 1, 1280]) };
      }
    };
    await cam.cargarModelo();
    caso('Carga la red de la tesis y, si falla, la siguiente; con NaN reintenta en CPU', cam.tipo === 'mobilenet-v2-0.35-224' && cam.backend === 'cpu' && pedidas[0].startsWith('v2_035_160') && cam.net,
      `intentos: ${pedidas.join(' → ')} · elegida: ${cam.nombreRed} en ${cam.backend}`);
    delete global.tf;
  }
  {
    // PIR con la webcam: con el fondo registrado, el movimiento de la persona (que es parte del
    // fondo) no cuenta; el de algo distinto del fondo (el gato) sí.
    const cam = nuevaCam(); cam.webcam = true; cam.pirWebcam = true; cam.ignorarPIRHasta = 0;
    cam.video = { videoWidth: 640 };
    let k = 0; const cuadro = () => { k++; const d = new Uint8ClampedArray(768 * 4); for (let i = 0; i < d.length; i++) d[i] = (k % 2 ? 40 : 200); return d; };
    cam.c32 = { getContext: () => ({ drawImage() {}, getImageData: () => ({ data: cuadro() }) }) };
    cam.fondoRef = new Float32Array(10); cam._capturar = () => true;
    cam._primerPlano = () => ({ frac: 0.01, caja: null });
    cam._pir(1000); cam._pir(1200);
    const persona = cam.ultimoMov;
    cam._primerPlano = () => ({ frac: 0.2, caja: { x: 0.3, y: 0.2, w: 0.4, h: 0.53 } });
    cam._pir(1400);
    caso('PIR con webcam: la persona del fondo no lo activa; algo distinto del fondo sí', persona < 0 && cam.ultimoMov === 1400, `con solo la persona: ${persona < 0 ? 'no se activa' : 'se activa'}; con el gato: ${cam.ultimoMov === 1400 ? 'se activa' : 'no'}`);
  }
  {
    // Recorte automático: solo mira la zona distinta al fondo vacío
    const cam = nuevaCam(); const V = cam.V, n = V.FG_W * V.FG_H * 3;
    cam.fondoRef = Float32Array.from({ length: n }, (_, i) => 100 + (i % 13));
    const conObjeto = Float32Array.from(cam.fondoRef);
    for (let y = 20; y < 44; y++) for (let x = 50; x < 66; x++) for (let c = 0; c < 3; c++) conObjeto[(y * V.FG_W + x) * 3 + c] += c === 0 ? 120 : -60;
    cam._rgbChico = () => Float32Array.from(conObjeto.map((v) => v + (Math.random() - 0.5) * 6));
    const fg = cam._primerPlano();
    const cx = fg && fg.caja ? (fg.caja.x + fg.caja.w / 2) * V.FG_W : -1, cy = fg && fg.caja ? (fg.caja.y + fg.caja.h / 2) * V.FG_H : -1;
    cam._rgbChico = () => Float32Array.from(cam.fondoRef.map((v) => v + (Math.random() - 0.5) * 6));
    const vacio = cam._primerPlano();
    caso('Recorte automático: encuentra el objeto y ve vacío cuando no hay nada', fg && fg.caja && Math.abs(cx - 58) < 6 && Math.abs(cy - 32) < 6 && vacio && !vacio.caja,
      `objeto en (58, 32) → caja centrada en (${cx.toFixed(0)}, ${cy.toFixed(0)}), lado ${(fg.caja.w * 100).toFixed(0)} % del ancho · sin objeto → ${vacio.caja ? 'caja' : 'vacío'} (${(vacio.frac * 100).toFixed(1)} % cambió)`);
  }
  {
    // Sin webcam, "Simular movimiento" enciende el PIR y se apaga solo después de 2 s
    const cam = nuevaCam();
    cam.simularPIR(0.5); await cam.tick(); const encendido = cam.pirActivo;
    await new Promise((r) => setTimeout(r, 2700)); await cam.tick();
    const movs = cam.enviados.filter((m) => m === 'MOV').length;
    caso('Sin webcam: el PIR simulado se apaga solo y deja de enviar MOV', encendido && !cam.pirActivo, `MOV enviados: ${movs}`);
  }

  const ok = resultados.filter((r) => r.ok).length;
  console.log(`\nResultado: ${ok} de ${resultados.length} casos de visión correctos`);
  fs.writeFileSync(path.join(__dirname, 'resultados_vision.json'), JSON.stringify({ resultados, precisionRuido: tabla, parecidos }, null, 1));
  process.exit(ok === resultados.length ? 0 : 1);
})();
