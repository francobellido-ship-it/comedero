// Parte F: "mono" — acciones al azar de un usuario (app, pulsador, fallas, escenarios, velocidad, recargas)
// con reglas que nunca deben romperse. Uso: node parteF.js <semilla> <minutos>
const { abrir } = require('./comun.js');
const fs = require('fs');
const semilla = +(process.argv[2] || 1), minutos = +(process.argv[3] || 7);
let x = semilla * 9973 + 1; const azar = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
const uno = (a) => a[Math.floor(azar() * a.length)];
(async () => {
  const T = await abrir('F' + semilla);
  const { page } = T;
  await T.webcam(); await T.libre();
  const instalarVigia = () => page.evaluate(() => {
    window.__v = { rotas: [], ocupadoSim: 0, desconectadoMs: 0, ultimo: performance.now() };
    setInterval(() => {
      const c = window.comedero, v = window.__v, ahora = performance.now(), dt = ahora - v.ultimo; v.ultimo = ahora;
      const regla = (ok, txt) => { if (!ok && v.rotas.length < 40 && !v.rotas.some((r) => r.txt === txt)) v.rotas.push({ txt, estado: c.estado, det: c.detalle, t: Math.round(ahora / 1000) }); };
      const led = c.led();
      regla(c.estado !== 'MANTENIMIENTO' || led.color === 'rojo', 'en mantenimiento el LED no está rojo');
      regla(!c.ocupado || ['azul', 'blanco', 'rojo'].includes(led.color), 'con un ciclo en curso el LED no está azul');
      regla(c.hw.tolvaG >= 0 && c.hw.papelCiclos >= 0 && c.hw.tachoG >= 0, 'un nivel quedó negativo');
      v.ocupadoSim = c.ocupado ? v.ocupadoSim + dt * c.reloj.vel : 0;
      regla(v.ocupadoSim < 150 * 60000, 'un ciclo lleva más de 150 min simulados');
      const sinCon = /no se conecta desde/.test((document.querySelector('#app-vista') || {}).textContent || '');
      v.desconectadoMs = sinCon && !c.fallas.sinInternet ? v.desconectadoMs + dt : 0;
      regla(v.desconectadoMs < 7000, 'la app dice "sin conexión" sin la falla de internet');
      v.comandosMs = !c.fallas.sinInternet && (window.nube.comandos || []).length ? (v.comandosMs || 0) + dt : 0;
      regla(v.comandosMs < 4000, 'órdenes de la app sin atender más de 4 s con internet');
      regla(c.historial.every((h) => ['comida', 'omitida', 'visita', 'mantenimiento', 'aviso'].includes(h.tipo) || h.tipo), 'historial con tipo inválido');
    }, 250);
  });
  await instalarVigia();
  const log = [];
  const hacer = async (nombre, fn) => { log.push(`${new Date().toISOString().slice(11, 19)} ${nombre}`); try { await fn(); } catch (e) { log.push('   (no se pudo: ' + e.message.split('\n')[0] + ')'); } };
  const clicApp = async (sel) => { const b = await page.$(sel); if (b) { await b.click({ timeout: 2000 }); await page.waitForTimeout(250); } };
  const ACC = [
    ['app: servir', async () => { await T.vista('inicio'); await clicApp(`[data-act="porciones"][data-n="${1 + Math.floor(azar() * 4)}"]`); await clicApp('[data-act="servir"]'); }, 3],
    ['app: modo libre', async () => { await T.vista('inicio'); await clicApp('[data-act="modo"][data-m="libre"]'); }, 1],
    ['app: modo horarios', async () => { await T.vista('inicio'); await clicApp('[data-act="modo"][data-m="horario"]'); }, 1.5],
    ['app: probar', async () => { await T.vista('gatos'); await clicApp('[data-act="probar"]'); }, 1],
    ['app: ver cámara', async () => { await T.vista('inicio'); await clicApp('[data-act="ver"]'); }, 1],
    ['app: cerrar cámara', async () => { await T.vista('inicio'); await clicApp('[data-act="nover"]'); }, 0.7],
    ['app: ya terminó de comer', async () => { await T.vista('inicio'); await clicApp('[data-act="terminoComer"]'); }, 1.5],
    ['app: ya lo resolví', async () => { await T.vista('inicio'); await clicApp('[data-act="confirmar"]'); }, 2],
    ['app: entendido', async () => { await T.vista('inicio'); await clicApp('[data-act="entendido"]'); }, 1],
    ['app: pestaña', async () => { await T.vista(uno(['inicio', 'gatos', 'historial', 'ajustes'])); }, 1],
    ['pulsador corto', async () => { await T.pulsar(1 + Math.floor(azar() * 3)); }, 3],
    ['pulsador largo', async () => { await T.pulsarLargo(); }, 1],
    ['ir al próximo horario', async () => { await T.clic('#btn-horario'); }, 2],
    ['+1 h', async () => { await T.clic('#btn-1h'); }, 1],
    ['velocidad', async () => { await T.vel(uno([1, 10, 60, 60, 300])); }, 1.5],
    ['volver a la hora real', async () => { await T.clic('#btn-real'); }, 0.7],
    ['escena', async () => { await T.escena(uno(['fondo', 'fondo', 'gato1', 'gato2', 'plumon'])); }, 3],
    ['PIR simulado', async () => { await T.clic('#btn-pir'); }, 1],
    ['falla on/off', async () => { const k = uno(['atascoDisco', 'arco', 'sinInternet', 'atascoPapel', 'papelFlojo', 'inventario']); await page.click(`[data-falla="${k}"]`); log.push('   ' + k); }, 2],
    ['cámara no responde on/off', async () => { await page.click('#f-camara'); }, 0.7],
    ['acción', async () => { const k = uno(['rellenarTolva', 'tolvaMitad', 'tolvaCasiVacia', 'tolvaVacia', 'rolloPorAcabarse', 'acabarPapel', 'ponerRollo', 'llenarTacho', 'vaciarTacho']); await T.clic(`[data-accion="${k}"]`); log.push('   ' + k); }, 2],
    ['corte de energía', async () => { await T.clic('#btn-corte'); }, 0.5],
    ['escenario', async () => { const k = uno(['comida', 'dos', 'libre', 'rapido', 'atasco', 'alimento', 'vuelve', 'internet', 'tacho', 'papel', 'camara', 'corte']); log.push('   ' + k); await T.clic(`[data-escn="${k}"]`); if (azar() < 0.5) { await page.waitForTimeout(1000 + azar() * 8000); await T.clic('#esc-parar'); log.push('   detenido'); } }, 1],
    ['recargar la página', async () => { await page.reload(); await page.waitForTimeout(2500); await T.webcam(); await instalarVigia(); }, 0.25]
  ];
  const total = ACC.reduce((a, b) => a + b[2], 0);
  const fin = Date.now() + minutos * 60000;
  let n = 0;
  while (Date.now() < fin) {
    let r = azar() * total, a = ACC[0];
    for (const z of ACC) { r -= z[2]; if (r <= 0) { a = z; break; } }
    await hacer(a[0], a[1]); n++;
    await page.waitForTimeout(300 + azar() * 2500);
  }
  const rotas = await T.ev(() => window.__v.rotas);
  T.ok(`Mono (semilla ${semilla}): ${n} acciones al azar sin romper ninguna regla`, rotas.length === 0, JSON.stringify(rotas).slice(0, 600));
  // Al final, el dueño lo arregla todo y el equipo vuelve a quedar listo
  await hacer('arreglar todo', async () => {
    await page.evaluate(() => { const e = window.estadoEscenario && window.estadoEscenario(); if (e && !e.fin) e.cancelado = true; });
    await T.esperar(() => !window.estadoEscenario() || window.estadoEscenario().fin, 120000);
    for (const k of ['atascoDisco', 'arco', 'sinInternet', 'atascoPapel', 'papelFlojo', 'inventario']) await page.uncheck(`[data-falla="${k}"]`);
    await page.uncheck('#f-camara');
    for (const k of ['rellenarTolva', 'vaciarTacho', 'ponerRollo']) await T.clic(`[data-accion="${k}"]`);
    await T.escena('fondo'); await T.vel(60);
    await T.vista('inicio'); await clicApp('[data-act="modo"][data-m="horario"]');
  });
  let listo = false;
  for (let k = 0; k < 40 && !listo; k++) {
    await T.vista('inicio'); await clicApp('[data-act="confirmar"]'); await clicApp('[data-act="terminoComer"]');
    for (let j = 0; j < 4; j++) await clicApp('[data-act="entendido"]');
    listo = await T.ev(() => window.comedero.estado === 'ESPERA' && !window.comedero.ocupado && window.comedero.led().color === 'verde');
    if (!listo) await page.waitForTimeout(3000);
  }
  T.ok(`Mono (semilla ${semilla}): al resolver todo, vuelve a ESPERA con LED verde`, listo, JSON.stringify(await T.estado()));
  await T.clic('#btn-real');
  fs.writeFileSync(require('path').join(__dirname, `mono_${semilla}.log`), log.join('\n'));
  await T.cerrar();
})();
