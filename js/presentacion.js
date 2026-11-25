/* ============================================================================
 * presentacion.js — Modo presentación de demo.html (para mostrar el prototipo)
 * ----------------------------------------------------------------------------
 * Un botón "Presentar" arriba. Cada paso muestra un texto grande para el público,
 * resalta la parte de la pantalla de la que se habla y ejecuta solo lo que hace
 * falta (escenarios de un clic, la prueba de reconocimiento, "Ver a mi gato").
 * El presentador avanza con "Siguiente" o con la flecha → del teclado.
 * ==========================================================================*/
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const dormir = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const tarjeta = (sel) => { const e = $(sel); return e ? e.closest('.card') || e : null; };
  const ctx = () => window.CTX || {};
  const clic = (sel) => { const b = $(sel); if (b && !b.disabled) { b.click(); return true; } return false; };
  const verApp = async (v) => {
    // Si la app está en la pantalla de la cuenta o en el primer uso, entra como demo sin cuenta
    const nav = document.querySelector('#app-nav');
    if (nav && getComputedStyle(nav).display === 'none') { clic('#app-vista [data-act="ob-saltar"]'); await dormir(0.6); }
    clic(`#app-nav button[data-vista="${v}"]`); await dormir(0.5);
  };

  async function escenario(clave, pres) {
    if (!window.correrEscenario) return;
    const p = window.correrEscenario(clave);
    pres.sub = () => { const e = window.estadoEscenario && window.estadoEscenario(); return e && e.pasos[e.i] ? e.pasos[e.i][0] : ''; };
    await p;
  }
  function listoParaReconocer() {
    const { cam, nube } = ctx();
    return !!(cam && cam.webcam && (nube.instalacion || {}).fondoOk && (nube.gatos || []).some((g) => (nube.huellas || {})['g' + g.id]));
  }

  const PASOS = [
    {
      titulo: 'Comedero inteligente: prototipo virtual',
      texto: 'A la izquierda, la app del dueño. A la derecha, lo que pasa dentro del equipo: el ESP32 y la ESP32-S3-CAM simulados, con la webcam haciendo de cámara.',
      foco: ['.telefono', '.aviso-dentro'],
      accion: async () => { const { cam } = ctx(); if (cam && !cam.webcam) clic('#btn-webcam'); await verApp('inicio'); }
    },
    {
      titulo: 'Lo único que ve el dueño: la app',
      texto: 'Elige cuándo come su gato (a sus horas o cuando llegue), sirve desde el celular, recibe alertas y puede mirar la cámara.',
      foco: ['.telefono'],
      accion: async () => { await verApp('inicio'); }
    },
    {
      titulo: 'La cámara reconoce al gato',
      texto: 'Recorta lo que cambió respecto al fondo vacío, saca la huella con MobileNetV2 y la compara con las 45 del registro. Con 3 fotos seguidas de p ≥ 0.8 envía GATO al ESP32, en unos 2.6 s como el ESP32-S3.',
      foco: ['.telefono', '#video'],
      accion: async (pres) => {
        await verApp('gatos');
        if (!listoParaReconocer()) {
          pres.sub = () => 'Para verlo en vivo: registra el fondo y un gato en "Mis gatos" (o la foto de un gato en el celular). Pulsa Siguiente para continuar.';
          return;
        }
        const { nube, comedero } = ctx();
        const t0 = comedero.reloj.sim;
        clic('[data-act="probar"]');
        pres.sub = () => {
          const e = nube.estado || {}, cm = e.camara || {}, pr = e.prueba;
          if (pr && pr.t >= t0 - 1000 && pr.estado === 'listo') return pr.resultado === 'gato' ? `Resultado: es ${pr.nombre} (${Math.round((pr.p || 0) * 100)} %), en ${pr.seg} s` : 'Resultado: ' + ({ otro: 'un gato no registrado', nadie: 'no vio a ningún gato', camara: 'la cámara no respondió' }[pr.resultado] || pr.resultado);
          return cm.pred ? `La cámara está mirando: ${cm.pred.mejor} ${Math.round(cm.pred.p * 100)} % · ${cm.pred.decision}` : 'Despertando la cámara…';
        };
        for (let i = 0; i < 400; i++) { const pr = (nube.estado || {}).prueba; if (pr && pr.t >= t0 - 1000 && pr.estado === 'listo') break; await dormir(0.1); }
      }
    },
    {
      titulo: 'A la hora de comer: un ciclo completo',
      texto: 'Horario → la cámara reconoce al gato → se dosifican 24 g (servo, TCRT5000 y barrera IR) → el papel acerca la comida al gato → el gato come → el papel se renueva y los restos van al tacho.',
      foco: ['.estados', '.mecanismo'],
      accion: async (pres) => { await verApp('inicio'); await escenario('comida', pres); }
    },
    {
      titulo: 'Modo libre: come cuando llega',
      texto: 'El PIR despierta la cámara; si es un gato registrado y ya pasó el tiempo mínimo, se le sirve. Si vuelve antes, no se repite y queda anotado.',
      foco: ['.telefono', '.estados'],
      accion: async (pres) => { await verApp('inicio'); await escenario('libre', pres); }
    },
    {
      titulo: 'Ver al gato desde cualquier lugar',
      texto: 'La cámara enciende su Wi-Fi solo mientras el dueño mira: sube una foto por segundo a la nube y se apaga sola al minuto.',
      foco: ['.telefono', '#video'],
      accion: async (pres) => {
        const { cam } = ctx();
        await verApp('inicio');
        if (!cam || !cam.webcam) { pres.sub = () => 'Enciende la webcam para mostrar la foto en vivo.'; return; }
        clic('[data-act="ver"]');
        pres.sub = () => { const v = (ctx().nube || {}).vista; return v && v.jpg ? `Foto en vivo n.° ${v.n} · ${v.kb} KB` : 'Encendiendo la cámara y su Wi-Fi…'; };
        await dormir(9);
        clic('[data-act="nover"]');
      }
    },
    {
      titulo: 'Si algo falla, avisa',
      texto: 'Atasco del disco: un reintento; si sigue, mantenimiento con LED rojo, zumbador y alerta en la app. Se confirma con una pulsación larga del botón.',
      foco: ['.panel', '.telefono'],
      accion: async (pres) => { await verApp('inicio'); await escenario('atasco', pres); }
    },
    {
      titulo: 'Sin internet sigue funcionando',
      texto: 'La comida a su hora no depende de la nube. Las órdenes de la app esperan y se cumplen al volver la conexión.',
      foco: ['.telefono', '.estados'],
      accion: async (pres) => { await verApp('inicio'); await escenario('internet', pres); }
    },
    {
      titulo: 'Validado por simulación',
      texto: '285 comprobaciones correctas: lógica del ESP32 (con 900 corridas al azar), visión, conexión app ↔ comedero, cuenta del dueño, todos los modos y fallas usados como un cliente en el navegador y más de 1 200 acciones al azar sin romper ninguna regla. En el prototipo físico se validan los sensores y la faja.',
      foco: [],
      accion: async () => {
        const { comedero } = ctx();
        if (comedero && !comedero.ocupado && (comedero.reloj.vel !== 1 || Math.abs(comedero.reloj.sim - Date.now()) > 90000)) comedero.alinearConHoraReal(Date.now());
        await verApp('historial');
      }
    }
  ];

  // ---------- Interfaz ----------
  const barra = document.createElement('div');
  barra.id = 'pres'; barra.className = 'pres';
  barra.innerHTML = `<div class="pres-num" id="pres-num"></div><div class="pres-txt"><b id="pres-tit"></b><span id="pres-texto"></span><em id="pres-sub"></em></div>
    <div class="pres-btn"><button id="pres-ant" title="Anterior">◀</button><button id="pres-sig" class="primario">Siguiente ▶</button><button id="pres-cerrar" title="Salir">✕</button></div>`;
  document.body.appendChild(barra);
  const boton = document.createElement('button');
  boton.id = 'btn-presentar'; boton.className = 'btn-presentar'; boton.textContent = '▶ Presentar';
  const volver = $('header.top .volver'); if (volver) volver.before(boton); else document.body.prepend(boton);

  const pres = { i: -1, sub: null, corriendo: false, gen: 0 };
  function quitarFoco() { document.querySelectorAll('.pres-foco').forEach((e) => e.classList.remove('pres-foco')); }
  async function ir(i) {
    if (i < 0 || i >= PASOS.length) return;
    const g = ++pres.gen;
    // si estaba corriendo un escenario, se detiene para pasar al siguiente
    const e = window.estadoEscenario && window.estadoEscenario();
    if (e && !e.fin) { e.cancelado = true; for (let k = 0; k < 50 && !e.fin; k++) await dormir(0.1); }
    pres.i = i; pres.sub = null; pres.corriendo = true;
    const P = PASOS[i];
    $('#pres-num').textContent = `${i + 1}/${PASOS.length}`;
    $('#pres-tit').textContent = P.titulo; $('#pres-texto').textContent = P.texto; $('#pres-sub').textContent = '';
    quitarFoco();
    const focos = P.foco.map((s) => (s === '.estados' || s === '.mecanismo' || s === '.panel' ? tarjeta(s) : $(s))).filter(Boolean);
    focos.forEach((f) => f.classList.add('pres-foco'));
    if (focos[focos.length - 1]) focos[focos.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
    pintar();
    try { await P.accion(pres); } catch (err) { pres.sub = () => 'No se pudo completar este paso: ' + err.message; }
    if (g === pres.gen) { pres.corriendo = false; pintar(); }
  }
  function pintar() {
    barra.classList.toggle('on', pres.i >= 0);
    document.body.classList.toggle('presentando', pres.i >= 0);
    if (pres.i < 0) return;
    const s = pres.sub ? pres.sub() : '';
    if ($('#pres-sub').textContent !== s) $('#pres-sub').innerHTML = esc(s);
    $('#pres-ant').disabled = pres.i === 0;
    const sig = $('#pres-sig');
    sig.textContent = pres.i === PASOS.length - 1 ? 'Terminar' : pres.corriendo ? 'Saltar ▶' : 'Siguiente ▶';
    sig.classList.toggle('listo', !pres.corriendo);
  }
  function salir() { const e = window.estadoEscenario && window.estadoEscenario(); if (e && !e.fin) e.cancelado = true; pres.gen++; pres.i = -1; quitarFoco(); pintar(); }
  boton.addEventListener('click', () => ir(0));
  $('#pres-sig').addEventListener('click', () => (pres.i === PASOS.length - 1 ? salir() : ir(pres.i + 1)));
  $('#pres-ant').addEventListener('click', () => ir(pres.i - 1));
  $('#pres-cerrar').addEventListener('click', salir);
  document.addEventListener('keydown', (ev) => {
    if (pres.i < 0 || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (ev.key === 'ArrowRight' || ev.key === 'PageDown') { ev.preventDefault(); $('#pres-sig').click(); }
    if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); if (pres.i > 0) ir(pres.i - 1); }
    if (ev.key === 'Escape') salir();
  });
  setInterval(pintar, 300);
  window.presentacion = { ir, salir, estado: () => ({ i: pres.i, corriendo: pres.corriendo, total: PASOS.length }) };
})();
