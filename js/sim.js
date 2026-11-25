/* ============================================================================
 * sim.js — Comedero simulado: ESP32 + ESP32-S3-CAM (webcam) + panel + pines
 * Crea el gemelo digital, lo conecta con la cámara virtual y con la nube, y
 * dibuja el panel del simulador. Lo usan comedero.html y demo.html.
 * ==========================================================================*/
(function () {
  'use strict';
  const S = window.SimComedero;
  const { Comedero, CFG, ESTADOS, hhmm } = S;
  const ROL = window.ROL || 'comedero';               // 'comedero' o 'todo'
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CLAVE_EQ = 'comedero_equipo_v2';
  let guardado = null; try { guardado = JSON.parse(localStorage.getItem(CLAVE_EQ) || 'null'); } catch (e) { guardado = null; }

  // ---------- Crear el comedero, la cámara y la conexión ----------
  const nube = window.cargarNube(ROL);
  const comedero = new Comedero({ nube, simInicio: Date.now(), estadoGuardado: guardado });
  comedero.alinearConHoraReal(Date.now());   // al abrir la página el reloj es el de verdad (×1)
  const cam = new CamaraVirtual($('#video'));
  const con = new ConexionNube(nube, ROL);
  comedero.enviarUart = (m) => setTimeout(() => cam.recibir(m), 5);
  cam.enviar = (m) => comedero.onUart(m);
  // La cámara sube su foto por su propio Wi-Fi a la nube (/vista) solo mientras el dueño mira
  cam.subirFoto = (f) => { nube.vista = f ? Object.assign({ t: comedero.reloj.sim }, f) : null; };
  comedero.infoCamara = () => {
    const p = cam.pred, vivo = cam.estado === 'RECONOCIENDO' && p && p.clases;
    return {
      estado: cam.estado, webcam: cam.webcam, tipo: cam.tipo, reg: cam.reg ? { id: cam.reg.id, n: cam.reg.fotos.length, total: cam.V.REG_FOTOS } : null,
      sinFondo: !!(p && p.sinFondo && cam.estado === 'RECONOCIENDO'),
      viendo: cam.viendo(), backend: cam.backend, respuestaS: cam.ultimaRespuestaS,
      pred: vivo ? { mejor: p.mejor, p: p.clases[0] ? Math.round(p.clases[0].p * 100) / 100 : 0, racha: p.racha, fotos: cam.V.FOTOS, etiqueta: p.etiqueta, decision: p.decision } : null
    };
  };
  window.CTX = { nube, comedero, cam, con, rol: ROL };
  window.comedero = comedero; window.camara = cam; window.nube = nube; // para revisar desde la consola
  con.iniciar();

  const gatosConHuella = () => (nube.gatos || []).map((g) => Object.assign({}, g, { huella: (nube.huellas || {})['g' + g.id] || null }));

  // ---------- Bucle principal ----------
  // Lo marca un Worker (no la página): así el comedero sigue funcionando aunque su pestaña quede
  // en segundo plano, donde el navegador frena los temporizadores normales a uno por minuto.
  let ultimo = performance.now(), nLatido = 0;
  function latido() {
    const ahora = performance.now();
    let dt = ahora - ultimo; ultimo = ahora;
    if (dt > 60000) { comedero.reanudarTrasPausa(dt); dt = 50; }
    while (dt > 0) { const d = Math.min(500, dt); dt -= d; pasoEquipo(d); }
    if (++nLatido % 14 === 0) con.publicar();
  }
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},50)'], { type: 'text/javascript' })));
    w.onmessage = latido;
  } catch (e) { setInterval(latido, 50); }
  function pasoEquipo(dt) {
    con.setOffline(!!comedero.fallas.sinInternet);
    comedero.tick(dt);
    try {
      cam.gatos = gatosConHuella();
      const v = nube.config.vision || {};
      if (v.umbralP) { cam.V.UMBRAL_P = v.umbralP; cam.V.FOTOS = v.fotos; cam.V.PIR_SENS = v.pirSens; cam.V.RESTOS_UMBRAL_PCT = v.restosPct; }
      cam.tick();
    } catch (e) { console.error(e); }
    try { sonido(); } catch (e) { /* sin audio */ }
  }
  setInterval(renderSim, 200);
  // La app ve lo que la cámara tiene de verdad: si una huella se perdió (cambio de red, NaN,
  // versión anterior), se marca como no registrada para que el dueño la vuelva a registrar.
  setInterval(() => {
    const res = cam.resumenHuellas(); nube.huellas = nube.huellas || {}; nube.instalacion = nube.instalacion || {};
    if (cam.cargando || cam.cambiando || cam.reg) return;
    if (nube.instalacion.fondoOk && !res['0']) { nube.instalacion.fondoOk = false; comedero.evento('La cámara no tiene el fondo vacío: hay que registrarlo otra vez'); }
    (nube.gatos || []).forEach((g) => { if (nube.huellas['g' + g.id] && !res[g.id]) { delete nube.huellas['g' + g.id]; comedero.evento(`La cámara no tiene la huella de ${g.nombre}: hay que registrarlo otra vez`); } });
  }, 2000);
  let pararGuardado = false;
  const guardarEquipo = () => {
    if (pararGuardado) return;
    window.guardarNube(ROL, nube);
    try { localStorage.setItem(CLAVE_EQ, JSON.stringify(comedero.exportar())); } catch (e) { /* lleno */ }
  };
  setInterval(guardarEquipo, 2000);
  // Guarda al instante cuando cambia algo importante (estado, ciclo en curso, historial):
  // así, si se cierra la página justo al terminar un ciclo, no se cree que quedó a medias.
  let firmaEq = '';
  setInterval(() => {
    const f = comedero.estado + '|' + comedero.cicloEnCurso + '|' + comedero.historial.length + '|' + (comedero.historial[0] ? comedero.historial[0].restos : '') + '|' + comedero.alertas.filter((a) => a.activa).length + '|' + comedero.hw.tolvaG + '|' + comedero.hw.papelCiclos + '|' + comedero.hw.tachoG;
    if (f !== firmaEq) { firmaEq = f; guardarEquipo(); }
  }, 250);
  window.addEventListener('pagehide', guardarEquipo);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') guardarEquipo(); });

  // ---------- Controles ----------
  const ESTADO_CAM = { APAGADA: 'Sin webcam', DORMIDA: 'Dormida (ahorro)', DESPERTANDO: 'Despertando', DESPIERTA: 'Despierta', RECONOCIENDO: 'Reconociendo', REGISTRANDO: 'Registrando huella' };
  const NOMBRE_ESTADO = { INICIO: 'Inicio', VERIFICACION: 'Verificación', ESPERA: 'Espera', RECONOCIMIENTO: 'Reconocimiento', DOSIFICACION: 'Dosificación', PRESENTACION: 'Presentación', CONSUMO: 'Consumo', RENOVACION: 'Renovación', MANTENIMIENTO: 'Mantenimiento' };
  $$('.pestanas button').forEach((b) => b.addEventListener('click', () => {
    $$('.pestanas button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.lado').forEach((l) => l.classList.toggle('on', l.id === 'lado-' + b.dataset.lado));
  }));
  $('#btn-webcam').addEventListener('click', async () => {
    if (cam.webcam) { cam.apagar(); return; }
    const ok = await cam.encender();
    if (!ok) alert('No se pudo abrir la webcam. Da permiso de cámara al navegador y abre la página con http://localhost o https.');
  });
  $('#btn-cambiar').addEventListener('click', () => cam.cambiarCamara());
  $('#btn-pir').addEventListener('click', () => cam.simularPIR(4));
  $('#chk-pirweb').addEventListener('change', (e) => { cam.pirWebcam = e.target.checked; });
  $('#vel').addEventListener('change', (e) => { comedero.reloj.vel = +e.target.value; });
  $('#vel').value = String(comedero.reloj.vel);
  $('#btn-real').addEventListener('click', () => {
    // Con un ciclo en curso, se deja terminar a la velocidad actual y luego el reloj vuelve solo a la hora real
    if (comedero.ocupado) { volverHoraReal = true; comedero.evento('Vuelve a la hora real apenas termine este ciclo'); }
    else comedero.alinearConHoraReal(Date.now());
    $('#vel').value = String(comedero.reloj.vel);
  });
  let volverHoraReal = false;
  setInterval(() => {
    if (volverHoraReal && !comedero.ocupado && !comedero.cr) { volverHoraReal = false; comedero.alinearConHoraReal(Date.now()); $('#vel').value = '1'; }
  }, 300);
  $('#btn-1h').addEventListener('click', () => comedero.adelantarMin(60));
  $('#btn-cero').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (b.dataset.seguro !== '1') { b.dataset.seguro = '1'; b.textContent = 'Toca otra vez: se borran gatos, huellas e historial'; return; }
    Object.keys(localStorage).filter((k) => k.startsWith('comedero_')).forEach((k) => localStorage.removeItem(k));
    pararGuardado = true; location.reload();
  });
  $('#btn-horario').addEventListener('click', () => comedero.irAlProximoHorario());
  $('#btn-7dias').addEventListener('click', () => comedero.saltarDias(7));
  $('#btn-corte').addEventListener('click', () => comedero.corteEnergia());
  $$('[data-falla]').forEach((c) => c.addEventListener('change', () => { comedero.fallas[c.dataset.falla] = c.checked; }));
  $('#f-camara').addEventListener('change', (e) => { cam.noResponde = e.target.checked; });
  $$('[data-accion]').forEach((b) => b.addEventListener('click', () => comedero[b.dataset.accion]()));
  const pul = $('#pulsador');
  pul.addEventListener('pointerdown', (e) => { e.preventDefault(); pul.setPointerCapture(e.pointerId); comedero.pulsadorAbajo(); });
  ['pointerup', 'pointercancel'].forEach((t) => pul.addEventListener(t, () => comedero.pulsadorArriba()));
  $('#cam-simular').addEventListener('click', (e) => { const b = e.target.closest('[data-sim]'); if (b) cam.simularGato(+b.dataset.sim); });
  $('#estados').innerHTML = ESTADOS.map((e) => `<span data-e="${e}">${NOMBRE_ESTADO[e]}</span>`).join('');

  // ---------- Pines (placa rev 3.0, Tabla 7.1) ----------
  function filasPines() {
    const c = comedero, hw = c.hw, r = c.reloj.real;
    const m = c.nivelMedido();
    const d = m >= CFG.LECTURA_MAX_G ? 20 : m <= CFG.ALIMENTO_BAJO_G ? 90 : Math.round(90 - (m - 300) / 10.05);
    const eco = Math.round((2 * d) / 0.343);
    const l298 = (modo, en, a, b) => ({
      enrollar: `${en} PWM (lazo a 40 mm/s) · ${a} = 1 · ${b} = 0 → enrolla`,
      soltar: `${en} PWM 88 (frena por PWM) · ${a} = 0 · ${b} = 1 → suelta`,
      freno: `${en} = 1 · ${a} = 1 · ${b} = 1 → freno dinámico`,
      libre: `${en} = 0 → libre`
    }[modo] || modo);
    const mueve = (x) => x === 'enrollar' || x === 'soltar';
    const tx = c.uart.find((u) => u.dir === '→'), rx = c.uart.find((u) => u.dir === '←');
    const led = c.led();
    const v = (on, si, no) => `<span class="${on ? 'pin-on' : ''}">${on ? si : no}</span>`;
    return [
      ['ESP32 DevKit V1 (placa de control)'],
      ['Servo MG996R 360°', 'GPIO23 → U1A (74AHCT125)', hw.servo ? '<span class="pin-on">50 Hz · 2.0 ms (D = 6554) · gira</span>' : '50 Hz · 1.5 ms (D = 4915) · quieto'],
      ['HC-SR04 (nivel)', 'GPIO5 TRIG (U1C) · GPIO18 ECHO (divisor 2.2k/3.3k)', `ECHO ${eco} µs → d ≈ ${d} mm → ${m} g`],
      ['TCRT5000 del disco', 'GPIO33', v(r - hw.tcrtT < 300, '1 · marca del disco', '0')],
      ['Barrera IR (TSAL6200 + PT334-6C)', 'GPIO21 (pull-up R6)', v(r - hw.barreraT < 300, '3.27 V · haz cortado', '0.16 V · haz libre')],
      ['L298N motor 1 (rollo)', 'GPIO25 ENA · GPIO26 IN1 · GPIO27 IN2', v(mueve(hw.m1), l298(hw.m1, 'ENA', 'IN1', 'IN2'), l298(hw.m1, 'ENA', 'IN1', 'IN2'))],
      ['L298N motor 2 (tubo)', 'GPIO13 ENB · GPIO14 IN3 · GPIO4 IN4', v(mueve(hw.m2), l298(hw.m2, 'ENB', 'IN3', 'IN4'), l298(hw.m2, 'ENB', 'IN3', 'IN4'))],
      ['Encoder Hall M1', 'GPIO34 A · GPIO35 B (R9, R10)', v(mueve(hw.m1), '≈ 2.9 k cuentas/s (PCNT ×4)', '0 cuentas/s')],
      ['Encoder Hall M2', 'GPIO36 A · GPIO39 B (R11, R12)', v(mueve(hw.m2), '≈ 2.9 k cuentas/s (PCNT ×4)', '0 cuentas/s')],
      ['TCRT5000 fin de papel (A6)', 'GPIO32', hw.papelCiclos > 0 ? '0 V · ve el papel' : '<span class="pin-mal">3.3 V · sin papel</span>'],
      ['TCRT5000 del rollo (A7)', 'GPIO22', hw.papelCiclos > CFG.AVISO_ROLLO_CICLOS ? '0 · radio > 20 mm' : '<span class="pin-warn">1 · radio ≤ 20 mm (aviso)</span>'],
      ['E18-D80NK (tacho)', 'GPIO19 (BAT43 + 10 k a 3V3)', hw.tachoG >= CFG.TACHO_ALARMA_G ? '<span class="pin-mal">0.25 V · tacho lleno</span>' : '3.30 V · hay espacio'],
      ['LED RGB WS2812B', 'GPIO2 → 74AHCT125 → R7 330 Ω', `<span class="dot-led" style="background:${{ verde: '#3bd16f', azul: '#378add', amarillo: '#f5c518', rojo: '#e24b4a', blanco: '#ddd' }[led.color]}"></span> ${led.color}${led.parpadeo ? ' intermitente' : ''}`],
      ['Zumbador 5 V', 'GPIO12 → Q1 2N2222 (R6 1 k)', v(c.zumbador(), '1 · suena', '0')],
      ['Pulsador SW2', 'GPIO15 (pull-up, R15 + C7)', v(c.pulsador.abajo, '0 · presionado', '1 · suelto')],
      ['UART2 con la cámara (115 200 bd)', 'GPIO17 TX2 · GPIO16 RX2 (J15)', `TX: ${tx ? esc(tx.msg) : '—'} · RX: ${rx ? esc(rx.msg) : '—'}`],
      ['ESP32-S3-CAM (módulo de visión)'],
      ['Cámara OV3660', 'DVP interno', ESTADO_CAM[cam.estado] || cam.estado],
      ['PIR AM312', 'IO14 (3.3 V de la cámara)', v(cam.pirActivo, '1 · movimiento', '0')],
      ['2 LED blancos 5 mm', 'IO21 → Q102 PN2222A (R101 1 k)', v(cam.ledsNoche, '1 · encendidos (≈ 16 mA c/u)', '0')],
      ['UART con el ESP32', 'IO42 TX · IO41 RX', cam.estado === 'DORMIDA' || cam.estado === 'APAGADA' ? 'en espera' : 'envía OK cada 1 s'],
      ['Wi-Fi del ESP32-S3', 'antena del módulo', v(cam.viendo(), `encendido · ${cam.fotosSubidas} fotos JPEG QVGA subidas a la nube`, 'apagado (solo se enciende cuando el dueño mira)')]
    ];
  }
  function renderPines() {
    const el = $('#pines'); if (!el) return;
    const html = filasPines().map((f) => f.length === 1 ? `<tr class="pin-grupo"><td colspan="3">${f[0]}</td></tr>` : `<tr><td>${f[0]}</td><td class="mono">${f[1]}</td><td>${f[2]}</td></tr>`).join('');
    if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; }
  }

  // ---------- Dibujar el simulador ----------
  let cacheGatosCam = '';
  const cacheHTML = new Map();
  function setHTML(sel, html) { const el = $(sel); if (!el || cacheHTML.get(sel) === html) return; cacheHTML.set(sel, html); el.innerHTML = html; }
  function renderSim() {
    const c = comedero, hw = c.hw, r = c.reloj;
    const conTxt = $('#con-texto'); if (conTxt) conTxt.textContent = con.texto + (con.error ? ' · ' + con.error : '');
    const ce = $('#cam-estado'); ce.textContent = ESTADO_CAM[cam.estado] || cam.estado;
    ce.className = 'pill ' + (['DORMIDA', 'APAGADA'].includes(cam.estado) ? 'dormida' : 'despierta');
    $('.video-caja').classList.toggle('dormida', cam.estado === 'DORMIDA');
    $('#video-tapa').style.display = cam.webcam ? 'none' : 'flex';
    $('#btn-webcam').textContent = cam.webcam ? 'Apagar webcam' : 'Encender webcam';
    const roi = $('#roi'); const R = cam.roi;
    roi.style.left = R.x0 * 100 + '%'; roi.style.top = R.y0 * 100 + '%'; roi.style.width = (R.x1 - R.x0) * 100 + '%'; roi.style.height = (R.y1 - R.y0) * 100 + '%';
    roi.style.display = cam.webcam ? 'block' : 'none';
    const mirando = cam.platoPend || performance.now() - (cam.platoVisto || -1e9) < 3000;
    roi.classList.toggle('activa', mirando);
    roi.dataset.txt = mirando ? 'revisando restos' : 'zona de comida';
    const vs = $('#vel'); if (document.activeElement !== vs && vs.value !== String(r.vel)) vs.value = String(r.vel);
    const nota = Math.abs(r.sim - Date.now()) < 90000 && r.vel === 1 ? 'Hora real.' : `Hora simulada${r.vel > 1 ? ', corriendo ×' + r.vel : ''}. "Volver a la hora real" la iguala con tu reloj.`;
    const rn = $('#reloj-nota'); if (rn && rn.textContent !== nota) rn.textContent = nota;
    $('#b-pir').classList.toggle('on', cam.pirActivo);
    $('#b-led').classList.toggle('on', cam.ledsNoche);
    const nombre = (k) => (k === '0' ? 'fondo' : ((nube.gatos.find((g) => String(g.id) === k) || {}).nombre || 'gato ' + k));
    const huellas = Object.entries(cam.resumenHuellas()).map(([k, n]) => nombre(k) + ' ' + n).join(', ');
    const red = cam.cargando ? 'cargando MobileNetV2…' : cam.cambiando ? 'pasando a CPU…' : cam.tipo ? (cam.tipo === 'simple' ? 'huella simple (MobileNet no cargó)' : (cam.nombreRed || cam.tipo) + (cam.backend ? ` en ${cam.backend === 'webgl' ? 'tarjeta gráfica' : cam.backend.toUpperCase()}` : '')) : 'se carga al encender la webcam';
    const txtModelo = `Red neuronal: ${red} · Huellas: ${huellas || 'ninguna'}`;
    if ($('#cam-modelo').textContent !== txtModelo) $('#cam-modelo').textContent = txtModelo;
    const V = cam.V, tf = cam.tFoto();
    setHTML('#cam-esp', `<b>Como el ESP32-S3-CAM:</b> sensor ${V.SENSOR_W}×${V.SENSOR_H} · entrada de la red ${V.ENTRADA}×${V.ENTRADA} · por foto ${(V.T_CAPTURA_MS / 1000).toFixed(2)} s de captura + ${(V.T_INF_MS[V.ENTRADA] / 1000).toFixed(2)} s de inferencia` +
      (cam.tPC ? ` (tu PC la hizo en ${Math.round(cam.tPC)} ms; la demo espera lo del ESP32)` : '') +
      ` · respuesta estimada ${((V.T_DESPERTAR_MS + V.FOTOS * tf) / 1000).toFixed(1)} s (requisito ≤ 5 s)` +
      (cam.ultimaRespuestaS ? ` · última: <b>${cam.ultimaRespuestaS} s</b>` : '') +
      ` · huellas int8 en memoria: ${cam.memoriaKB()} KB de ${V.PSRAM_KB / 1024} MB (PSRAM)` +
      ` · Wi-Fi de la cámara: ${cam.viendo() ? '<span class="pin-on">enviando 1 foto/s al dueño</span>' : 'apagado'}`);
    // Caja de lo que mira la red (zona distinta al fondo vacío)
    const caja = cam.fg && cam.fg.caja, cj = $('#caja-obj');
    if (cj) {
      const ver = !!(caja && cam.webcam && (cam.estado === 'RECONOCIENDO' || cam.estado === 'REGISTRANDO'));
      cj.style.display = ver ? 'block' : 'none';
      if (ver) {
        // el video se muestra en espejo: se refleja la caja
        cj.style.left = (1 - caja.x - caja.w) * 100 + '%'; cj.style.top = caja.y * 100 + '%'; cj.style.width = caja.w * 100 + '%'; cj.style.height = caja.h * 100 + '%';
        const p = cam.pred;
        cj.dataset.txt = cam.estado === 'REGISTRANDO' ? 'aprendiendo esto' : p && p.clases ? `${p.mejor} ${Math.round(p.clases[0].p * 100)} %` : 'mirando';
        cj.classList.toggle('ok', !!(p && p.etiqueta === 'gato' && p.clases && p.clases[0].p >= V.UMBRAL_P && cam.estado === 'RECONOCIENDO'));
      }
    }
    setHTML('#cam-pred', htmlPred());
    $('#m-pir').style.width = Math.min(100, (cam.pirNivel / (cam.V.PIR_SENS * 2)) * 100) + '%';
    $('#m-pir').style.background = cam.pirActivo ? '#ef9f27' : '';
    $('#m-brillo').style.width = (cam.brillo / 255) * 100 + '%';
    const key = nube.gatos.map((g) => g.id + g.nombre).join('|');
    if (key !== cacheGatosCam) {
      cacheGatosCam = key;
      $('#cam-simular').innerHTML = nube.gatos.length ? `<span class="mini" style="width:100%">Sin webcam o para presentar: simular que llega…</span>` + nube.gatos.map((g) => `<button data-sim="${g.id}">${esc(g.nombre)}</button>`).join('') : '';
    }
    setHTML('#cam-log', cam.mensajes.map((m) => `<li>${esc(m)}</li>`).join(''));
    const led = c.led();
    $('#led').className = 'led ' + led.color + (led.parpadeo ? ' parpadeo' : '');
    const ap = c.avisoPulsador && r.real < c.avisoPulsador.hasta ? c.avisoPulsador.texto : '';
    setHTML('#led-texto', esc(led.texto) +
      (c.ocupado && c.estado !== 'ESPERA' ? `<br><b>Ahora:</b> ${esc(NOMBRE_ESTADO[c.estado] || c.estado)}${c.detalle ? ' — ' + esc(c.detalle) : ''}` : '') +
      (c.fallas.sinInternet ? '<br><b class="warn">Está activada la falla "Sin internet"</b> (panel Fallas): la app no recibe nada hasta que la desmarques.' : '') +
      (ap ? `<br><b class="warn">Pulsador ignorado:</b> ${esc(ap)}` : ''));
    const clave = led.color === 'azul' && led.parpadeo ? 'azul-i' : led.color;
    document.querySelectorAll('#led-leyenda li').forEach((li) => li.classList.toggle('on', li.dataset.c === clave));
    $('#zumb').classList.toggle('on', c.zumbador());
    $('#zumb').textContent = c.zumbador() ? 'Zumbador sonando' : (c.estado === 'MANTENIMIENTO' ? 'Silenciado' : 'Zumbador');
    const frac = c.pulsador.abajo ? Math.min(1, (r.real - c.pulsador.t) / (CFG.PULSACION_LARGA_S * 1000)) : 0;
    $('#pul-anillo').style.strokeDashoffset = 100.5 * (1 - frac);
    $('#cr-texto').textContent = c.cr ? `Ciclo rápido: ${c.cr.porciones * 12} g (${c.cr.porciones} ${c.cr.porciones === 1 ? 'porción' : 'porciones'}). Sale en ${Math.max(0, Math.ceil((CFG.CICLO_RAPIDO_ESPERA_S * 1000 - (r.real - c.cr.t)) / 1000))} s` : '';
    $$('#estados span').forEach((s) => { s.classList.toggle('on', s.dataset.e === c.estado); s.classList.toggle('mant', s.dataset.e === 'MANTENIMIENTO'); });
    $('#estado-detalle').textContent = c.detalle || NOMBRE_ESTADO[c.estado] || '';
    $('#tolva-nivel').style.height = Math.max(0, (hw.tolvaG / CFG.TOLVA_MAX_G) * 100) + '%';
    $('#tolva-txt').innerHTML = `${Math.max(0, hw.tolvaG)} g<br>HC-SR04: ${c.nivelMedido()} g`;
    $('#s-servo').className = 'foco' + (hw.servo ? ' gira' : '');
    $('#s-servo-txt').textContent = c.estado === 'DOSIFICACION' ? `porción ${Math.min(hw.k + 1, hw.n)} de ${hw.n}` : '';
    $('#s-tcrt').className = 'foco' + (r.real - hw.tcrtT < 300 ? ' on' : '');
    $('#s-barrera').className = 'foco' + (r.real - hw.barreraT < 300 ? ' on' : '');
    const com = $('#comida');
    if (hw.comidaPos !== null && hw.comidaPos <= CFG.LARGO_PLATAFORMA_MM + 10) { com.style.display = 'block'; com.style.left = `calc(${(Math.max(0, hw.comidaPos) / (CFG.LARGO_PLATAFORMA_MM + 10)) * 100}% - 12px)`; }
    else com.style.display = 'none';
    $('#papel-txt').textContent = `${hw.papelCiclos} de ${CFG.ROLLO_CICLOS} ciclos`;
    $('#motores').textContent = 'Motores: ' + hw.motores;
    $('#tacho-nivel').style.width = Math.min(100, (hw.tachoG / CFG.TACHO_ALARMA_G) * 100) + '%';
    $('#tacho-nivel').style.background = hw.tachoG >= CFG.TACHO_ALARMA_G ? '#e24b4a' : '';
    $('#tacho-txt').textContent = `${hw.tachoG} g de ${CFG.TACHO_ALARMA_G} g (sensor E18-D80NK) · vaciado hace ${Math.max(0, Math.floor((r.sim - hw.vaciadoSim) / 86400000))} días`;
    const d = new Date(r.sim);
    $('#reloj').textContent = hhmm(r.sim) + '  ' + d.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' });
    $$('[data-falla]').forEach((x) => { x.checked = !!c.fallas[x.dataset.falla]; });
    $('#f-camara').checked = cam.noResponde;
    setHTML('#uart', c.uart.slice(0, 30).map((u) => `<li class="${u.dir === '→' ? 'tx' : 'rxm'}">${hhmm(u.t)} ${u.dir === '→' ? 'ESP32 → cámara' : 'cámara → ESP32'}: <b>${esc(u.msg)}</b>${u.n > 1 ? ' ×' + u.n : ''}</li>`).join(''));
    setHTML('#eventos', c.eventos.slice(0, 40).map((e) => `<li><time>${hhmm(e.t)}</time>${esc(e.texto)}</li>`).join(''));
    renderPines();
    const det = $('pre#nube');
    if (det && det.parentElement.open) {
      det.textContent = JSON.stringify({ config: nube.config, gatos: nube.gatos, huellas: nube.huellas, instalacion: nube.instalacion, estado: nube.estado, alertas: (nube.alertas || []).filter((a) => a.activa), historial: (nube.historial || []).slice(0, 5) }, null, 1);
    }
  }
  function htmlPred() {
    const p = cam.pred;
    if (!cam.webcam) return '<p class="mini">Sin imagen. Enciende la webcam o usa los botones para simular que llega un gato.</p>';
    if (cam.estado === 'REGISTRANDO' && cam.reg) return `<p class="mini">Registrando huella${cam.reg.id === 0 ? ' del fondo vacío' : ''}: ${cam.reg.fotos.length} de ${cam.V.REG_FOTOS} fotos (cada una con un recorte distinto)</p><div class="progreso"><i style="width:${(cam.reg.fotos.length / cam.V.REG_FOTOS) * 100}%"></i></div>`;
    if (cam.estado !== 'RECONOCIENDO') {
      const libre = nube.config.modo === 'libre';
      return `<p class="mini">${cam.estado === 'DORMIDA' ? 'Dormida. Solo el PIR sigue mirando; la red neuronal está apagada.' : 'Despierta, pero la red neuronal no está mirando.'} ` +
        (libre ? 'Modo libre: cuando el PIR vea movimiento, el ESP32 envía REC y la cámara busca a tu gato.' : 'Modo por horarios: la cámara solo busca a tu gato a la hora de comer (o con "Probar reconocimiento" en la app).') + '</p>';
    }
    if (p && p.sinRed) return `<div class="lb"><span>Vacío</span><div class="tr"><div class="fl" style="width:100%"></div></div><span>1.00</span></div><p class="mini"><b>${esc(p.decision)}</b></p>`;
    if (p && p.sinFondo) return '<p class="mini"><b>Falta registrar el fondo vacío</b> (app → Mis gatos). Sin él, cualquier cosa se parecería a tu gato y no se puede reconocer.</p>';
    if (!p || p.sinHuellas) return '<p class="mini">No hay huellas guardadas: registra el fondo y a tus gatos desde la app.</p>';
    if (!p.clases) return '';
    const N = cam.V.FOTOS;
    return p.clases.map((x) => `<div class="lb"><span>${esc(x.nombre)}</span><div class="tr"><div class="fl ${x.nombre !== 'Vacío' ? 'gato' : ''}" style="width:${Math.round(x.p * 100)}%"></div></div><span>${x.p.toFixed(2)}</span></div>`).join('') +
      `<div class="racha">Fotos seguidas ≥ ${cam.V.UMBRAL_P}: ${Array.from({ length: N }, (_, i) => `<i class="${i < p.racha ? 'on' : ''}"></i>`).join('')}</div>` +
      `<p class="mini"><b>${esc(p.decision)}</b>${p.collar ? ' · collar ' + p.collar : ''}</p>`;
  }

  // ---------- Zumbador con sonido (opcional) ----------
  let audio = null, gan = null;
  $('#chk-sonido').addEventListener('change', (e) => {
    if (e.target.checked && !audio) {
      try {
        audio = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audio.createOscillator(); gan = audio.createGain(); osc.frequency.value = 2300; gan.gain.value = 0;
        osc.connect(gan).connect(audio.destination); osc.start();
      } catch (err) { audio = null; }
    }
  });
  function sonido() {
    if (!gan) return;
    const on = $('#chk-sonido').checked && comedero.zumbador() && Math.floor(performance.now() / 300) % 2 === 0;
    gan.gain.value = on ? 0.05 : 0;
  }

  // ======================= GUÍA DE LA PRIMERA DEMO =======================
  const GUIA = [
    ['Encender la webcam', 'aquí, en la cámara', () => cam.webcam],
    ['Registrar el fondo vacío', 'en la app: Mis gatos, paso 1', () => !!(nube.instalacion || {}).fondoOk],
    ['Calibrar el papel limpio', 'en la app', () => !!(nube.instalacion || {}).platoOk],
    ['Registrar un gato', 'en la app: Mis gatos (y luego "Probar ahora")', () => Object.keys(nube.huellas || {}).length > 0],
    ['Primera comida', 'escenario "Una comida completa"', () => comedero.historial.some((h) => h.tipo === 'comida')],
    ['Probar una falla', 'cualquier escenario de falla', () => comedero.alertas.some((a) => a.nivel === 'falla')],
    ['Salir del mantenimiento', 'pulsación larga o "Ya lo resolví"', () => comedero.alertas.some((a) => a.nivel === 'falla' && !a.activa)]
  ];
  function renderGuia() {
    const el = $('#guia'); if (!el) return;
    const hechos = GUIA.map((g) => g[2]());
    const html = GUIA.map((g, i) => `<div class="paso-g ${hechos[i] ? 'hecho' : ''}"><i>${hechos[i] ? '✓' : i + 1}</i><div><b>${g[0]}</b><div class="mini">${g[1]}</div></div></div>`).join('');
    if (el.innerHTML !== html) el.innerHTML = html;
    const n = hechos.filter(Boolean).length;
    $('#guia-barra').style.width = (n / GUIA.length) * 100 + '%';
    $('#guia-txt').textContent = `${n} de ${GUIA.length}`;
  }
  setInterval(renderGuia, 500);

  // ======================= ESCENARIOS DE UN CLIC =======================
  const dormir = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const tocar = async (n) => { for (let i = 0; i < n; i++) { comedero.pulsadorAbajo(); await dormir(0.08); comedero.pulsadorArriba(); await dormir(0.35); } };
  const gatoN = (i) => (nube.gatos || [])[i];
  const libre = () => comedero.estado === 'ESPERA' && !comedero.ocupado && !comedero.cr;
  async function ponerEnOrden() {
    Object.keys(comedero.fallas).forEach((k) => { comedero.fallas[k] = false; });
    cam.noResponde = false;
    if (comedero.hw.tolvaG < 320) comedero.rellenarTolva();
    if (comedero.hw.tachoG >= CFG.TACHO_ALARMA_G) comedero.vaciarTacho();
    if (comedero.hw.papelCiclos <= CFG.AVISO_ROLLO_CICLOS) { comedero.hw.papelCiclos = CFG.ROLLO_CICLOS; comedero.resolver('rollo'); comedero.resolver('fin_papel'); }
    if (comedero.estado === 'MANTENIMIENTO') comedero.confirmar('escenario');
    for (let i = 0; i < 600 && !libre(); i++) await dormir(0.1);
    // espera a que el comedero lea el modo y los horarios que puso el escenario (sincroniza cada 1 s)
    for (let i = 0; i < 40 && (comedero.config.modo !== nube.config.modo || comedero.config.horariosActivos !== nube.config.horariosActivos); i++) await dormir(0.1);
  }
  // Cada paso: [texto, acción, condición para seguir, segundos máximos]
  const ESCENARIOS = {
    comida: ['Una comida completa', 'Horario → reconoce → dosifica → come → renueva', () => {
      const g = gatoN(0);
      if (!g) return [['No hay gatos registrados: pido una comida con el pulsador', () => tocar(2), () => comedero.estado === 'DOSIFICACION', 8], ...cola()];
      return [['Adelanto el reloj al próximo horario', () => comedero.irAlProximoHorario(), () => comedero.estado === 'RECONOCIMIENTO', 40],
        ['El ESP32 envía REC por UART: la cámara despierta y mira', null, () => cam.rec, 8],
        [`Llega ${g.nombre}: 3 fotos seguidas ≥ 0.8 → la cámara envía GATO,${g.id}`, () => cam.simularGato(g.id), () => comedero.estado === 'DOSIFICACION', 12], ...cola()];
    }],
    dos: ['Dos gatos en un horario', 'Uno detrás del otro; la espera se pausa', () => {
      const a = gatoN(0), b = gatoN(1);
      if (!a || !b) return [['Necesitas 2 gatos registrados en la app (Mis gatos)', null, null, 3]];
      return [['Adelanto el reloj al próximo horario', () => comedero.irAlProximoHorario(), () => comedero.estado === 'RECONOCIMIENTO', 40],
        [`Llega ${a.nombre}: GATO,${a.id}`, async () => { await dormir(0.5); cam.simularGato(a.id); }, () => comedero.estado === 'DOSIFICACION', 12],
        [`Sirve la ración de ${a.nombre} (${a.racionG} g) y completa su ciclo`, null, () => comedero.estado === 'RECONOCIMIENTO', 150],
        [`Vuelve a esperar: llega ${b.nombre}: GATO,${b.id}`, async () => { await dormir(1); cam.simularGato(b.id); }, () => comedero.estado === 'DOSIFICACION', 12],
        [`Sirve a ${b.nombre} (${b.racionG} g)`, null, () => libre(), 150],
        ['Listo: las dos comidas están en el historial de la app', null, null, 0]];
    }],
    libre: ['Modo libre', 'Llega el gato → come; vuelve → no repite', () => {
      const g = gatoN(0);
      if (!g) return [['Necesitas un gato registrado en la app (Mis gatos)', null, null, 3]];
      return [['Paso el comedero a modo libre (en la app lo eliges en Inicio o Ajustes)', () => {
          const ok = comedero.puedeComerLibre(g);
          if (!ok.ok) comedero.adelantarMin(/veces hoy/.test(ok.motivo) ? 1440 : (nube.config.libreIntervaloMin || 120) + 1);
        }, () => comedero.config.modo === 'libre', 4],
        [`Llega ${g.nombre}: el PIR lo ve, la cámara despierta y el ESP32 envía REC`, () => cam.simularGato(g.id), () => cam.rec, 6],
        [`3 fotos seguidas ≥ 0.8 → GATO,${g.id}: puede comer, se sirven ${g.racionG} g`, null, () => comedero.estado === 'DOSIFICACION', 12], ...cola().slice(0, -1),
        [`${g.nombre} vuelve enseguida: la cámara lo reconoce, pero ya comió → no se sirve`, async () => { await dormir(6); cam.simularGato(g.id); }, () => comedero.historial.some((h) => h.tipo === 'visita'), 30],
        [`Listo: en la app aparece "${g.nombre} vino, pero ya había comido". Vuelve a comer en ${nube.config.libreIntervaloMin || 120} min. El comedero vuelve a tu modo anterior`, null, null, 0]];
    }],
    rapido: ['Ciclo rápido con el pulsador', 'Dos toques = 24 g, sin cámara', () => [
      ['Dos toques cortos al pulsador (GPIO15): el LED parpadea blanco', () => tocar(2), () => !!comedero.cr, 3],
      ['Espera 3 s desde el último toque y sale sin reconocimiento', null, () => comedero.estado === 'DOSIFICACION', 6], ...cola()]],
    atasco: ['Atasco del disco', 'Reintento → mantenimiento → pulsación larga', () => [
      ['Simulo que una croqueta traba el disco', () => { comedero.fallas.atascoDisco = true; }, null, 0.5],
      ['Pido una porción con el pulsador', () => tocar(1), () => comedero.estado === 'DOSIFICACION', 6],
      ['No llega el pulso del TCRT5000 en 2 s: reintenta una vez', null, () => comedero.estado === 'MANTENIMIENTO', 10],
      ['Mantenimiento: LED rojo intermitente, zumbador y alerta en la app', null, null, 4],
      ['Destrabo el disco y hago la pulsación larga de 3 s', async () => { comedero.fallas.atascoDisco = false; comedero.pulsadorAbajo(); await dormir(3.3); comedero.pulsadorArriba(); }, () => comedero.estado === 'ESPERA', 6],
      ['Vuelve el LED verde: listo', null, null, 0]]],
    alimento: ['Se acaba el alimento', 'Aviso amarillo y luego tolva vacía', () => [
      ['Dejo 260 g en la tolva: el HC-SR04 ya no ve más que el embudo', () => comedero.tolvaCasiVacia(), null, 0.5],
      ['Pido una porción: sale, pero avisa "queda poco alimento" (LED amarillo)', () => tocar(1), () => comedero.activa('alimento_bajo'), 15],
      ['Espero que termine el ciclo', null, () => libre(), 90],
      ['Ahora vacío la tolva por completo y pido otra porción', async () => { comedero.tolvaVacia(); await tocar(1); }, () => comedero.estado === 'DOSIFICACION', 8],
      ['El disco gira, pero la barrera IR no ve caer nada: reintenta y pasa a mantenimiento', null, () => comedero.estado === 'MANTENIMIENTO', 10],
      ['Relleno la tolva y confirmo desde la app ("Ya lo resolví")', () => { comedero.rellenarTolva(); nube.comandos.push({ escenario: true, tipo: 'confirmar' }); }, () => comedero.estado === 'ESPERA', 6],
      ['Listo', null, null, 0]]],
    vuelve: ['El gato vuelve en la renovación', 'Los motores frenan y siguen', () => [
      ['Pido una comida con el pulsador', () => tocar(1), () => comedero.estado === 'CONSUMO', 20],
      ['Nadie se acerca: a los 5 min (5 s) termina el consumo', null, () => comedero.estado === 'RENOVACION', 60],
      ['¡Vuelve el gato! El PIR envía MOV y los motores frenan (L298N en freno)', () => cam.simularPIR(4), () => /Frenados/.test(comedero.hw.motores), 4],
      ['Cuando se va, la renovación sigue', null, () => libre(), 40],
      ['Listo: el papel nunca se movió con el gato delante', null, null, 0]]],
    internet: ['Sin internet', 'La orden espera y se cumple al volver', () => [
      ['Corto el Wi-Fi: el LED se pone azul intermitente', () => { comedero.fallas.sinInternet = true; }, null, 4],
      ['Desde la app pido "Servir 12 g": queda pendiente en la nube', () => nube.comandos.push({ escenario: true, tipo: 'servir', porciones: 1 }), null, 6],
      ['Vuelve el Wi-Fi: recibe la orden y sube lo pendiente', () => { comedero.fallas.sinInternet = false; }, () => comedero.estado === 'DOSIFICACION', 8], ...cola()]],
    tacho: ['Tacho lleno', 'Sensor E18-D80NK → mantenimiento', () => [
      ['Lleno el tacho hasta el sensor (GPIO19 baja a 0.25 V)', () => comedero.llenarTacho(), () => comedero.estado === 'MANTENIMIENTO', 4],
      ['No inicia más ciclos: la renovación empujaría los restos fuera', null, null, 4],
      ['Vacío el tacho: el sensor lo ve vacío y sale solo', () => comedero.vaciarTacho(), () => comedero.estado === 'ESPERA', 4],
      ['Listo', null, null, 0]]],
    papel: ['Se acaba el papel', 'Aviso del rollo → fin → rollo nuevo', () => [
      ['Quedan 22 ciclos: el TCRT5000 del rollo (GPIO22) avisa (LED amarillo)', () => comedero.rolloPorAcabarse(), () => comedero.activa('rollo'), 3],
      ['Se acaba el papel y pido una porción', async () => { comedero.acabarPapel(); await tocar(1); }, () => comedero.estado === 'MANTENIMIENTO', 8],
      ['No dosifica: el TCRT5000 del recorrido (GPIO32) ya no ve papel', null, null, 4],
      ['Pongo un rollo nuevo y confirmo con la pulsación larga', async () => { comedero.ponerRollo(); comedero.pulsadorAbajo(); await dormir(3.3); comedero.pulsadorArriba(); }, () => comedero.estado === 'RENOVACION', 8],
      ['Tensar_Papel() y una primera renovación', null, () => libre(), 30],
      ['Listo: 94 ciclos', null, null, 0]]],
    camara: ['La cámara no responde', 'Alerta y ración por defecto', () => [
      ['Desconecto la cámara (no envía OK)', () => { cam.noResponde = true; }, null, 1],
      ['Llega el horario: envía REC y espera 3 s', () => comedero.irAlProximoHorario(), () => comedero.activa('camara'), 40],
      [`Alerta "La cámara no responde". Según Ajustes: ${nube.config.siCamaraFalla === 'dosificar' ? 'sirve la ración por defecto' : 'no sirve'}`, null, () => libre(), 120],
      ['Reconecto la cámara: la alerta se borra sola', () => { cam.noResponde = false; cam.despertar('prueba'); }, () => !comedero.activa('camara'), 6],
      ['Listo', null, null, 0]]],
    corte: ['Corte de energía', 'A mitad de la comida', () => [
      ['Pido una comida con el pulsador', () => tocar(1), () => comedero.estado === 'CONSUMO', 20],
      ['¡Se corta la luz! Todo se apaga', () => comedero.corteEnergia(), () => comedero.estado === 'INICIO', 3],
      ['Al volver: revisa el equipo y ve que el ciclo quedó a medias', null, () => comedero.estado === 'RENOVACION', 10],
      ['Renueva el papel para no dejar comida vieja (Tabla 5.10)', null, () => libre(), 30],
      ['Listo', null, null, 0]]]
  };
  function cola() {
    return [['Dosifica porción por porción: servo (GPIO23), pulso del TCRT5000 (GPIO33) y caída en la barrera (GPIO21)', null, () => comedero.estado === 'PRESENTACION', 25],
      ['Presentación: el motor 1 enrolla y acerca la comida 100 mm', null, () => comedero.estado === 'CONSUMO', 12],
      ['Consumo: papel quieto. Cuando el gato se va 5 min (5 s a ×60), termina', null, () => comedero.estado !== 'CONSUMO', 120],
      ['La cámara revisa si quedaron restos en el papel (REVISAR → LIMPIO o RESTOS) y empieza la renovación del papel', null, () => comedero.estado === 'RENOVACION', 10],
      ['Renovación: el motor 2 enrolla 360 mm y los restos caen al tacho', null, () => libre(), 40],
      ['Listo: mira el historial en la app', null, null, 0]];
  }
  let escn = null;
  $('#esc-botones').innerHTML = Object.entries(ESCENARIOS).map(([k, e]) => `<button data-escn="${k}"><b>${e[0]}</b><span>${e[1]}</span></button>`).join('');
  $('#esc-botones').addEventListener('click', (ev) => { const b = ev.target.closest('[data-escn]'); if (b) correrEscenario(b.dataset.escn); });
  $('#esc-parar').addEventListener('click', () => { if (escn) escn.cancelado = true; });
  function pintarNarr() {
    const n = $('#narracion');
    if (!escn) { n.classList.remove('on'); $('#esc-parar').style.display = 'none'; $$('#esc-botones button').forEach((b) => b.classList.remove('corriendo')); return; }
    n.classList.add('on'); $('#esc-parar').style.display = escn.fin ? 'none' : '';
    $$('#esc-botones button').forEach((b) => b.classList.toggle('corriendo', b.dataset.escn === escn.clave && !escn.fin));
    n.innerHTML = `<b>${escn.titulo}</b>${escn.error ? ` · <span class="mal">${escn.error}</span>` : ''}<ol>` + escn.pasos.map((p, i) => `<li class="${i < escn.i || (escn.fin && !escn.error && i <= escn.i) ? 'listo' : i === escn.i ? 'ahora' : ''}">${esc_(p[0])}</li>`).join('') + '</ol>';
  }
  const esc_ = esc_html;
  function esc_html(t) { return String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  async function correrEscenario(clave) {
    if (escn && !escn.fin) return;
    const E = ESCENARIOS[clave];
    escn = { clave, titulo: E[0], pasos: [['Ordeno el equipo: sin fallas, tolva, papel y tacho bien', null, null, 0]], i: 0, cancelado: false, fin: false };
    pintarNarr();
    const pirAntes = cam.pirWebcam; cam.pirWebcam = false; $('#chk-pirweb').checked = false;
    // Cada escenario corre en su modo (libre o por horarios) y al final vuelve el modo que tenías
    const modoAntes = nube.config.modo || 'horario', activosAntes = nube.config.horariosActivos;
    nube.config.modo = clave === 'libre' ? 'libre' : 'horario'; nube.config.horariosActivos = true;
    const velAntes = comedero.reloj.vel;
    if (comedero.reloj.vel < 60) { comedero.reloj.vel = 60; $('#vel').value = '60'; }
    await ponerEnOrden();
    escn.pasos = escn.pasos.concat(E[2]());
    try {
      for (let i = 1; i < escn.pasos.length && !escn.cancelado; i++) {
        const [, accion, hasta, max] = escn.pasos[i];
        escn.i = i; pintarNarr();
        if (accion) await accion();
        if (hasta) {
          let ok = false;
          for (let t = 0; t < max * 10 && !escn.cancelado; t++) { if (hasta()) { ok = true; break; } await dormir(0.1); }
          if (!ok && !escn.cancelado) { escn.error = 'este paso no terminó a tiempo'; break; }
        } else await dormir(max || 0.3);
      }
    } finally {
      // Ninguna falla simulada queda activada al terminar o detener un escenario, y si se detuvo,
      // las órdenes que el escenario dejó pendientes (p. ej. "Servir" sin internet) se descartan
      if (escn.cancelado && nube.comandos) for (let i = nube.comandos.length - 1; i >= 0; i--) if (nube.comandos[i] && nube.comandos[i].escenario) nube.comandos.splice(i, 1);
      Object.keys(comedero.fallas).forEach((k) => { comedero.fallas[k] = false; });
      cam.noResponde = false;
      await dormir(1.2);   // una sincronización: si había órdenes pendientes, empiezan ahora
      cam.pirWebcam = pirAntes; $('#chk-pirweb').checked = pirAntes;
      nube.config.modo = modoAntes; nube.config.horariosActivos = activosAntes;
      // Si quedó un ciclo a medias, se deja terminar a ×60 (no se baja a ×1 en plena comida:
      // eso dejaría el LED azul varios minutos y el pulsador sin responder)
      if (comedero.ocupado) {
        escn.pasos.push(['Termino el ciclo que quedó en curso…', null, null, 0]); escn.i = escn.pasos.length - 1; pintarNarr();
        comedero.reloj.vel = Math.max(comedero.reloj.vel, 60); $('#vel').value = String(comedero.reloj.vel);
        for (let k = 0; k < 1800 && comedero.ocupado; k++) await dormir(0.1);
      }
      // Al terminar vuelve la velocidad que tenías; si era la hora real, el reloj vuelve a la hora real
      if (velAntes === 1) {
        if (!comedero.ocupado) comedero.alinearConHoraReal(Date.now()); else comedero.reloj.vel = 1;
      } else comedero.reloj.vel = velAntes;
      $('#vel').value = String(comedero.reloj.vel);
      escn.fin = true; if (escn.cancelado) escn.error = 'detenido'; pintarNarr();
    }
  }
  window.correrEscenario = correrEscenario; window.ESCENARIOS = ESCENARIOS; window.estadoEscenario = () => escn;

  // Si la misma página está abierta en otra pestaña, cada una es un comedero distinto y se pisan lo guardado: se avisa
  try {
    const bc = new BroadcastChannel('comedero_pagina_' + ROL);
    const yo = Math.random().toString(36).slice(2);
    bc.onmessage = (ev) => {
      if (!ev.data || ev.data.de === yo) return;
      if (ev.data.tipo === 'hola') bc.postMessage({ tipo: 'aqui', de: yo });
      const av = document.getElementById('aviso-pestana');
      if (av) { av.hidden = false; }
      else { const d = document.createElement('div'); d.id = 'aviso-pestana'; d.className = 'banner banner-fijo'; d.textContent = 'Esta página ya está abierta en otra pestaña. Usa solo una: cada pestaña es un comedero distinto y se pisan lo guardado.'; document.body.prepend(d); }
    };
    bc.postMessage({ tipo: 'hola', de: yo });
  } catch (e) { /* navegador sin BroadcastChannel */ }

  { const ce = document.getElementById('codigo-equipo'); if (ce) ce.textContent = con.codigo || window.CODIGO_COMEDERO || 'COMEDERO-4F2A'; }
  comedero.arrancar();
})();
