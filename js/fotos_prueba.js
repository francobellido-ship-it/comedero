/* Fotos de prueba: muestra a la cámara del comedero simulado fotos y cuadros de video de tres gatos reales,
 * para presentar el reconocimiento sin tener gatos frente a la webcam (Capítulo 8, sección 8.6.1).
 * Las imágenes están en pruebas/navegador/imagenes/reales: la versión "a" de cada gato sirve para
 * registrarlo y la "b" (otra foto u otros cuadros del video) para probarlo. */
(function () {
  'use strict';
  const BASE = 'pruebas/navegador/imagenes/reales/';
  const rango = (p, n) => Array.from({ length: n }, (_, i) => p + String(i).padStart(2, '0'));
  const ESC = [
    { id: 'vacio', nombre: 'Lugar vacío', a: ['fondo_piso'] },
    { id: 'g1', nombre: 'Gato blanco y negro', a: ['g1_tuxedo_a'], b: ['g1_tuxedo_b'] },
    { id: 'g2', nombre: 'Gato naranja', a: ['g2_naranja_a'], b: ['g2_naranja_b'] },
    { id: 'g3', nombre: 'Gata tricolor', a: rango('g3_tricolor_a', 18), b: rango('g3_tricolor_b', 14) },
    { id: 'obj', nombre: 'Objeto (balanza)', a: ['objeto_balanza'] },
  ];
  const imgs = {};
  const cargar = (n) => imgs[n] || (imgs[n] = new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = BASE + n + '.jpg'; }));
  const st = { activo: false, esc: 'vacio', version: 'a', borroso: 0, timer: null, t0: 0 };
  const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480;
  const ctx = cv.getContext('2d');
  let cuadros = [];

  async function elegir(id, version) {
    st.esc = id; st.version = version || st.version;
    const e = ESC.find((x) => x.id === id);
    const lista = (st.version === 'b' && e.b) ? e.b : e.a;
    cuadros = (await Promise.all(lista.map(cargar))).filter(Boolean);
    pintarBotones();
  }
  function dibujar() {
    if (!cuadros.length) return;
    const im = cuadros[Math.floor((performance.now() - st.t0) / 250) % cuadros.length];   // 4 cuadros por segundo
    const jx = (Math.random() - 0.5) * 6, jy = (Math.random() - 0.5) * 6;              // un poco de movimiento
    ctx.filter = st.borroso ? `blur(${st.borroso}px)` : 'none';
    ctx.drawImage(im, -8 + jx, -6 + jy, 656, 492);
    ctx.filter = 'none';
  }
  async function activar() {
    const cam = window.camara; if (!cam) return;
    if (cam.webcam) cam.apagar();
    await elegir(st.esc);
    st.t0 = performance.now(); dibujar();
    clearInterval(st.timer); st.timer = setInterval(dibujar, 66);
    const ok = await cam.encender(cv.captureStream(15));
    st.activo = !!ok; pintarBotones();
  }
  function desactivar() {
    clearInterval(st.timer); st.timer = null; st.activo = false;
    if (window.camara && window.camara.webcam) window.camara.apagar();
    pintarBotones();
  }

  let caja = null;
  function pintarBotones() {
    if (!caja) return;
    if (!st.activo) {
      caja.innerHTML = '<button data-fp="on">Usar fotos de gatos reales</button><span class="mini"> Para presentar sin gatos: la cámara ve fotos de tres gatos en lugar de la webcam.</span>';
      return;
    }
    caja.innerHTML =
      '<div class="fila-botones">' + ESC.map((e) => `<button data-fp-esc="${e.id}" class="${e.id === st.esc ? 'primario' : ''}">${e.nombre}</button>`).join('') + '</div>' +
      '<div class="fila-botones"><label class="mini">Foto: <select data-fp-ver><option value="a"' + (st.version === 'a' ? ' selected' : '') + '>a (para registrar)</option><option value="b"' + (st.version === 'b' ? ' selected' : '') + '>b (otra foto, para probar)</option></select></label> ' +
      '<label class="mini">Borroso: <select data-fp-blur>' + [0, 4, 8, 12, 16].map((b) => `<option value="${b}"${b === st.borroso ? ' selected' : ''}>${b ? b + ' px' : 'nada'}</option>`).join('') + '</select></label> ' +
      '<button data-fp="off">Volver a la webcam</button></div>' +
      '<p class="mini">Registra el fondo con «Lugar vacío» y cada gato con su foto a; luego elige la foto b y usa «Probar reconocimiento» en la app.</p>';
  }
  function iniciar() {
    const ref = document.getElementById('btn-pir'); if (!ref) return;
    caja = document.createElement('div'); caja.id = 'fotos-prueba'; caja.className = 'fotos-prueba';
    ref.parentElement.insertAdjacentElement('afterend', caja);
    caja.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.fp === 'on') activar();
      else if (b.dataset.fp === 'off') desactivar();
      else if (b.dataset.fpEsc) elegir(b.dataset.fpEsc);
    });
    caja.addEventListener('change', (ev) => {
      if (ev.target.dataset.fpVer !== undefined) elegir(st.esc, ev.target.value);
      if (ev.target.dataset.fpBlur !== undefined) st.borroso = +ev.target.value;
    });
    pintarBotones();
  }
  window.fotosPrueba = { activar, desactivar, elegir, estado: st, escenas: ESC };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
