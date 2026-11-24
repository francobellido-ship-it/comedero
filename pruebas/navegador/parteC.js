// Parte C: el caso de Franco (escenario detenido a la mitad) y cada falla desde los controles de la página
const { abrir } = require('./comun.js');
(async () => {
  const T = await abrir('C');
  const { page } = T;
  await T.webcam(); await T.libre();
  // Para esta parte se apaga el PIR por webcam (el caso de Franco era sin webcam)
  await page.evaluate(() => { window.camara.pirWebcam = false; document.querySelector('#chk-pirweb').checked = false; });
  await T.clic('#btn-real'); await T.libre();
  const desconectada = () => T.ev(() => /no se conecta desde/.test(document.querySelector('#app-vista').textContent));
  const tocarApp = async (sel) => { await T.vista('inicio'); await T.clic(sel); };

  // ---- C1. Caso de Franco: "Sin internet" detenido a la mitad, a la hora real ----
  await T.clic('[data-escn="internet"]');
  await T.esperar(() => window.comedero.fallas.sinInternet, 15000);
  await page.waitForTimeout(3000);
  await T.clic('#esc-parar');
  await T.esperar(() => window.estadoEscenario() && window.estadoEscenario().fin, 120000);
  await page.waitForTimeout(4500);
  let e = await T.estado();
  const vel = await T.ev(() => window.comedero.reloj.vel);
  T.ok('Escenario "Sin internet" detenido a la mitad: el Wi-Fi vuelve, la app se reconecta y el reloj vuelve a la hora real',
    !(await T.ev(() => window.comedero.fallas.sinInternet)) && !(await desconectada()) && vel === 1 && e.led === 'verde', `LED ${e.led} · ×${vel} · ${e.e}`);
  const pendientes = await T.ev(() => window.nube.comandos.length);
  T.ok('Al detenerlo no queda ninguna orden pendiente del escenario', pendientes === 0, `${pendientes} pendientes`);
  await T.libre();
  await T.pulsar(2);
  const dos = await T.esperar(() => window.comedero.estado === 'DOSIFICACION', 8000);
  const g2 = await T.ev(() => window.comedero.hw.n);
  T.ok('Después: el pulsador sirve (2 toques = 24 g)', dos && g2 === 2, `porciones ${g2}`);
  // a ×1 la comida espera 5 min reales: el dueño lo destraba desde la app
  await T.esperar(() => window.comedero.estado === 'CONSUMO', 30000);
  await T.pulsar(1);
  const txtLed = await T.ev(() => document.querySelector('#led-texto').textContent);
  T.ok('Pulsador durante la comida: la página dice por qué se ignora', /Pulsador ignorado/.test(txtLed) && /Ya terminó de comer/.test(txtLed), txtLed.slice(0, 200));
  await tocarApp('[data-act="terminoComer"]');
  const fin1 = await T.libre();
  T.ok('"Ya terminó de comer" en la app: limpia el papel y vuelve el verde (a la hora real)', fin1 && (await T.estado()).led === 'verde');

  // ---- C2. Escenario detenido en plena comida a ×1: no baja a ×1 en medio del ciclo ----
  await T.clic('[data-escn="rapido"]');
  await T.esperar(() => window.comedero.estado === 'CONSUMO' || window.comedero.estado === 'PRESENTACION', 40000);
  await T.clic('#esc-parar');
  const t0 = Date.now();
  await T.esperar(() => window.estadoEscenario().fin, 120000);
  e = await T.estado();
  T.ok('Escenario detenido en plena comida: termina el ciclo rápido y vuelve a la hora real', e.e === 'ESPERA' && e.led === 'verde' && (await T.ev(() => window.comedero.reloj.vel)) === 1, `${Math.round((Date.now() - t0) / 1000)} s`);

  // ---- C3. Cada falla desde el panel Fallas + resolución ----
  await T.vel(60);
  const falla = async (nombre, marcar, provocar, esperaMant, resolver, tipoAlerta) => {
    await marcar();
    await provocar();
    const mant = await T.esperar(() => window.comedero.estado === 'MANTENIMIENTO', 30000);
    const est = await T.estado();
    if (esperaMant) await T.vista('inicio');
    const appAlerta = await T.esperar(() => /Falla:/.test(document.querySelector('#app-vista').textContent), 5000);
    await resolver();
    const ok = await T.esperar(() => window.comedero.estado === 'ESPERA' && !window.comedero.ocupado, 40000);
    await T.libre();
    const e2 = await T.estado();
    T.ok(`${nombre}: mantenimiento (rojo + alerta en la app) y se recupera`, mant === esperaMant && (!esperaMant || (est.led === 'rojo' && appAlerta)) && ok && e2.led !== 'rojo', `${est.e}/${est.led} → ${e2.e}/${e2.led} ${e2.alertas.join(',')}`);
  };
  const chk = (k) => page.check(`[data-falla="${k}"]`);
  const unchk = (k) => page.uncheck(`[data-falla="${k}"]`);
  const ya = async () => { await T.vista('inicio'); try { await page.waitForSelector('[data-act="confirmar"]', { timeout: 6000 }); await page.click('[data-act="confirmar"]'); } catch (e) { console.log('    (no apareció "Ya lo resolví")'); } await page.waitForTimeout(400); };
  await falla('Atasco del disco', () => chk('atascoDisco'), () => T.pulsar(1), true, async () => { await unchk('atascoDisco'); await ya(); });
  await falla('Arco de croquetas (no caen)', () => chk('arco'), () => T.pulsar(1), true, async () => { await unchk('arco'); await T.pulsarLargo(); });
  await falla('Atasco del papel', () => chk('atascoPapel'), () => T.pulsar(1), true, async () => { await unchk('atascoPapel'); await ya(); });
  await falla('Se acaba el papel', () => T.clic('[data-accion="acabarPapel"]'), () => T.pulsar(1), true, async () => { await T.clic('[data-accion="ponerRollo"]'); await ya(); });
  await falla('Tacho lleno', () => T.clic('[data-accion="llenarTacho"]'), async () => {}, true, async () => { await T.clic('[data-accion="vaciarTacho"]'); });
  await falla('Tolva vacía', () => T.clic('[data-accion="tolvaVacia"]'), () => T.pulsar(1), true, async () => { await T.clic('[data-accion="rellenarTolva"]'); await ya(); });
  // Papel flojo: Tensar_Papel al poner un rollo nuevo
  await chk('papelFlojo'); await T.clic('[data-accion="acabarPapel"]'); await T.pulsar(1);
  await T.esperar(() => window.comedero.estado === 'MANTENIMIENTO', 20000);
  await T.clic('[data-accion="ponerRollo"]'); await ya();
  await T.esperar(() => window.comedero.estado !== 'MANTENIMIENTO', 20000); await T.libre();
  await unchk('papelFlojo'); await T.libre();
  e = await T.estado();
  T.ok('Papel flojo al cambiar el rollo: lo tensa y sigue (o avisa)', e.e === 'ESPERA' || e.e === 'MANTENIMIENTO', JSON.stringify(e));
  if (e.e === 'MANTENIMIENTO') { await ya(); await T.libre(); }
  await T.cerrar();
})();
