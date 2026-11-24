// Parte A: primer uso, segundo gato, servir desde la app, pulsador, por horarios (1 y 2 gatos)
const { abrir } = require('./comun.js');
(async () => {
  const T = await abrir('A');
  const { page } = T;
  await T.webcam();
  // ---- A1. Primer uso completo (5 pasos) ----
  if (T.enOnboarding) {
    // cuenta nueva y conexión del comedero (como un cliente)
    await T.clic('[data-act="cuenta-ir"][data-p="crear"]');
    await page.fill('#cu-nombre', 'Franco'); await page.fill('#cu-correo', 'franco@gmail.com');
    await page.fill('#cu-clave', 'gatitos123'); await page.fill('#cu-clave2', 'gatitos123');
    await T.clic('[data-act="cuenta-crear"]'); await page.waitForTimeout(600);
    const codigo = await T.ev(() => document.getElementById('codigo-equipo').textContent);
    await page.fill('#ob-codigo', codigo); await page.fill('#ob-wifi', 'MiCasa_2.4G'); await page.fill('#ob-wifiClave', 'clave12345');
    await T.clic('[data-act="ob-conectar"]'); await page.waitForTimeout(600);
    await T.clic('[data-act="ob-siguiente"]');
    await T.clic('[data-act="fondo"]');
    const fondo = await T.esperar(() => (window.nube.instalacion || {}).fondoOk, 70000);
    await T.clic('[data-act="plato"]');
    const plato = await T.esperar(() => (window.nube.instalacion || {}).platoOk, 10000);
    await T.clic('[data-act="ob-siguiente"]');
    await T.escena('gato1'); await page.waitForTimeout(800);
    await page.fill('#ng-nombre', 'Lulu'); await T.clic('[data-act="agregar"]');
    const g1 = await T.esperar(() => (window.nube.huellas || {}).g1, 80000);
    await T.escena('fondo');
    await T.clic('[data-act="ob-siguiente"]');
    await T.clic('[data-act="modo"][data-m="horario"]');
    await T.clic('[data-act="ob-fin"]');
    const fin = await T.ev(() => ({ act: window.nube.config.horariosActivos, inicio: !!document.querySelector('#app-vista .hero') }));
    T.ok('Primer uso: cuenta, conexión, fondo, papel, gato y modo; termina en Inicio', fondo && plato && g1 && fin.act && fin.inicio, JSON.stringify(fin));
  } else T.ok('Primer uso (ya hecho en este perfil)', true);

  // ---- A2. Segundo gato desde Mis gatos ----
  await T.vista('gatos');
  if (!(await T.ev(() => (window.nube.huellas || {}).g2))) {
    await T.escena('gato2'); await page.waitForTimeout(800);
    await T.clic('[data-act="ir-agregar"]');
    await page.fill('#ng-nombre', 'Pancha'); await page.selectOption('#ng-racion', '36');
    await T.clic('[data-act="agregar"]');
    await T.esperar(() => (window.nube.huellas || {}).g2, 80000);
    await T.escena('fondo');
  }
  const h2 = await T.ev(() => window.nube.huellas.g2);
  T.ok('Segundo gato (Pancha) registrado y no se confunde con Lulu', h2 && !h2.parecido, JSON.stringify(h2));

  // ---- A3. Servir 12 g desde la app con la persona delante (PIR de webcam activo) ----
  await T.vel(60);
  await T.vista('inicio');
  await T.clic('[data-act="porciones"][data-n="1"]'); await T.clic('[data-act="servir"]');
  const sirve = await T.esperar(() => window.comedero.estado === 'DOSIFICACION', 15000);
  const libre1 = await T.libre();
  let h = await T.hist();
  T.ok('Servir 12 g desde la app: ciclo completo con la persona delante', sirve && libre1 && h[0].tipo === 'comida' && h[0].g === 12, `${h[0].modo} · ${h[0].g} g · LED ${(await T.estado()).led}`);

  // ---- A4. Pulsador: 2 toques = 24 g ----
  await T.pulsar(2);
  const sirve2 = await T.esperar(() => window.comedero.estado === 'DOSIFICACION', 8000);
  await T.libre(); h = await T.hist();
  T.ok('Pulsador: 2 toques = 24 g y vuelve a verde', sirve2 && h[0].g === 24 && (await T.estado()).led === 'verde', `${h[0].g} g`);

  // ---- A5. Por horarios: llega Lulu (foto en el celular) y se sirve; Pancha no llega → omitida ----
  await T.clic('#btn-horario');
  const rec = await T.esperar(() => window.comedero.estado === 'RECONOCIMIENTO', 15000);
  await page.waitForTimeout(1500);
  await T.escena('gato1');
  const dos = await T.esperar(() => window.comedero.estado === 'DOSIFICACION', 30000);
  await T.esperar(() => window.comedero.estado === 'CONSUMO', 20000);
  // Lulu come (la foto sigue delante, moviéndose un poco): el PIR la ve en algún momento de estos 6 s
  const comiendo = await T.esperar(() => /sigue frente a la comida/.test(window.comedero.detalle), 6000);
  await T.escena('fondo');                           // se va
  await T.libre(); h = await T.hist();
  const lulu = h.find((x) => x.tipo === 'comida' && x.gato === 'Lulu'), pancha = h.find((x) => x.tipo === 'omitida' && x.gato === 'Pancha');
  T.ok('Por horarios: reconoce a Lulu, sirve 24 g, espera a que se vaya y limpia; Pancha queda omitida', rec && dos && comiendo && lulu && lulu.g === 24 && pancha, `Lulu ${lulu && lulu.g} g (${lulu && lulu.modo}) · Pancha ${pancha ? 'omitida' : '¿?'} · mientras comía: ${comiendo}`);

  // ---- A6. Por horarios con los dos gatos: Lulu y luego Pancha ----
  await T.clic('#btn-horario');
  await T.esperar(() => window.comedero.estado === 'RECONOCIMIENTO', 15000);
  await page.waitForTimeout(1500);
  const n0 = (await T.hist()).length;
  await T.escena('gato1');
  await T.esperar(() => window.comedero.estado === 'CONSUMO', 40000);
  await page.waitForTimeout(2000); await T.escena('fondo');
  await T.esperar(() => window.comedero.estado === 'RECONOCIMIENTO' || window.comedero.estado === 'ESPERA', 60000);
  await page.waitForTimeout(1500);
  await T.escena('gato2');
  await T.esperar(() => window.comedero.estado === 'CONSUMO', 40000);
  await page.waitForTimeout(2000); await T.escena('fondo');
  await T.libre();
  h = (await T.hist()).slice(0, (await T.hist()).length - n0);
  const c1 = h.find((x) => x.tipo === 'comida' && x.gato === 'Lulu'), c2 = h.find((x) => x.tipo === 'comida' && x.gato === 'Pancha');
  T.ok('Por horarios con dos gatos: Lulu 24 g y Pancha 36 g, cada una con su ración', c1 && c2 && c1.g === 24 && c2.g === 36, h.map((x) => `${x.tipo} ${x.gato} ${x.g} g`).join(' · '));
  const e = await T.estado();
  T.ok('Al final: espera, LED verde, sin alertas', e.e === 'ESPERA' && e.led === 'verde' && !e.alertas.length, JSON.stringify(e));
  await T.vel(1);
  await T.cerrar();
})();
