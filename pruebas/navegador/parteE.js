// Parte E: Ajustes y Mis gatos (horarios, raciones, borrar y volver a registrar, historial, cámara que falla)
const { abrir } = require('./comun.js');
(async () => {
  const T = await abrir('E');
  const { page } = T;
  await T.webcam(); await T.libre(); await T.vel(60);
  const sync = () => page.waitForTimeout(1800);
  const cambiar = async (sel, valor) => { await page.evaluate(() => document.querySelectorAll('#app-vista details').forEach((d) => { d.open = true; })); await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await page.selectOption(sel, String(valor)); await page.waitForTimeout(300); };

  // ---- E1. Ajustes: tiempos de consumo y sensibilidad ----
  await T.vista('ajustes');
  await cambiar('[data-act-change="cfg"][data-k="consumoSinGatoMin"]', 1);
  await cambiar('[data-act-change="vis"][data-k="fotos"]', 2);
  await sync();
  const cfg = await T.ev(() => ({ c: window.comedero.config.consumoSinGatoMin, f: window.camara.V.FOTOS }));
  T.ok('Ajustes: "terminar cuando se va" = 1 min y 2 fotos seguidas llegan al comedero y a la cámara', cfg.c === 1 && cfg.f === 2, JSON.stringify(cfg));
  await cambiar('[data-act-change="vis"][data-k="fotos"]', 3);

  // ---- E2. Horarios: agregar sin duplicar, editar, hora vacía, quitar ----
  const antes = await T.ev(() => window.nube.config.horarios.slice());
  await T.clic('[data-act="agregarHorario"]'); await T.clic('[data-act="agregarHorario"]');
  let hs = await T.ev(() => window.nube.config.horarios.slice());
  T.ok('Agregar dos horarios: no se repiten', hs.length === antes.length + 2 && new Set(hs).size === hs.length, hs.join(', '));
  // editar uno a una hora que ya existe → se rechaza
  const inputs = await page.$$('[data-act-change="horario"]');
  await inputs[1].fill(hs[0]); await inputs[1].dispatchEvent('change'); await page.waitForTimeout(400);
  hs = await T.ev(() => window.nube.config.horarios.slice());
  T.ok('Editar un horario a una hora repetida: se rechaza', new Set(hs).size === hs.length, hs.join(', '));
  // borrar la hora (vacía) → se rechaza sin romper nada
  const inp2 = (await page.$$('[data-act-change="horario"]'))[1];
  await inp2.evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(400);
  hs = await T.ev(() => window.nube.config.horarios.slice());
  T.ok('Dejar un horario vacío: se rechaza', hs.every((x) => /^\d{1,2}:\d{2}$/.test(x)), hs.join(', '));
  // quitar los dos agregados
  for (let k = 0; k < 2; k++) {
    const extra = await T.ev((a) => window.nube.config.horarios.findIndex((x) => !a.includes(x)), antes);
    if (extra >= 0) await T.clic(`[data-act="quitarHorario"][data-i="${extra}"]`);
  }
  await sync();
  hs = await T.ev(() => window.comedero.config.horarios.slice());
  T.ok('Quitar horarios: el comedero queda con los de antes', JSON.stringify(hs) === JSON.stringify(antes), hs.join(', '));

  // ---- E3. Ración de Lulu a 36 g → el horario le sirve 36 g ----
  await T.vista('gatos');
  await cambiar('[data-act-change="racion"][data-id="1"]', 36);
  await sync();
  await T.clic('#btn-horario');
  await T.esperar(() => window.comedero.estado === 'RECONOCIMIENTO', 15000);
  await page.waitForTimeout(1500); await T.escena('gato1');
  await T.esperar(() => window.comedero.estado === 'CONSUMO', 40000);
  await page.waitForTimeout(1500); await T.escena('fondo');
  await T.libre();
  let h = await T.hist();
  const lulu = h.find((x) => x.tipo === 'comida' && x.gato === 'Lulu');
  T.ok('Cambiar la ración de Lulu a 36 g: el horario le sirve 36 g', lulu && lulu.g === 36, lulu ? lulu.g + ' g' : 'sin comida');
  await T.vista('gatos'); await cambiar('[data-act-change="racion"][data-id="1"]', 24);

  // ---- E4. Borrar a Pancha y volver a registrarla ----
  const borrar = await page.$('[data-act="borrar"][data-id="2"]');
  if (borrar) { await borrar.click(); await page.waitForTimeout(300); await (await page.$('[data-act="borrar"][data-id="2"]')).click(); }
  await sync();
  const sinPancha = await T.ev(() => !window.nube.gatos.some((g) => g.id === 2) && !window.camara.resumenHuellas()['2']);
  T.ok('Eliminar a Pancha: sale de la app y la cámara borra su huella', sinPancha);
  await T.escena('gato2'); await page.waitForTimeout(600);
  await T.clic('[data-act="ir-agregar"]');
  await page.fill('#ng-nombre', 'Pancha'); await page.selectOption('#ng-racion', '36');
  await T.clic('[data-act="agregar"]');
  const nueva = await T.esperar(() => window.nube.gatos.some((g) => g.nombre === 'Pancha' && window.nube.huellas['g' + g.id]), 90000);
  await T.escena('fondo');
  const idP = await T.ev(() => (window.nube.gatos.find((g) => g.nombre === 'Pancha') || {}).id);
  T.ok('Volver a registrar a Pancha: queda con huella nueva', nueva, 'id ' + idP);

  // ---- E5. Historial: se ve y ninguna comida queda en "comiendo…" ----
  await T.vista('historial');
  const txt = await T.ev(() => document.querySelector('#app-vista').textContent);
  const colgado = await T.ev(() => window.comedero.historial.filter((x, i) => x.tipo === 'comida' && !x.restos && !(i === 0 && window.comedero.cicloEnCurso)).length);
  T.ok('Historial: muestra las comidas con su nombre y gramos, sin "comiendo…" colgados', /Lulu/.test(txt) && /\d+ g/.test(txt) && colgado === 0, `${colgado} colgados · ` + txt.replace(/\s+/g, ' ').slice(0, 120));

  // ---- E6. Cámara que falla con "Servir la ración por defecto" ----
  await T.vista('ajustes');
  await cambiar('[data-act-change="cfg"][data-k="siCamaraFalla"]', 'dosificar');
  await sync();
  await page.check('#f-camara');
  await T.clic('#btn-horario');
  await T.esperar(() => window.comedero.alertas.some((a) => a.activa && a.tipo === 'camara'), 40000);
  const sirve = await T.esperar(() => window.comedero.estado === 'DOSIFICACION', 30000);
  await T.libre();
  await page.uncheck('#f-camara');
  h = await T.hist();
  const def = h.slice(0, 4).find((x) => x.tipo === 'comida' && /por defecto/.test(x.modo || ''));
  T.ok('Cámara caída + "Servir la ración por defecto": igual sirve', sirve && def, def ? `${def.modo} ${def.g} g` : JSON.stringify(h.slice(0, 3)));
  await T.vista('ajustes'); await cambiar('[data-act-change="cfg"][data-k="siCamaraFalla"]', 'no');
  await cambiar('[data-act-change="cfg"][data-k="consumoSinGatoMin"]', 5);
  await T.esperar(() => !window.comedero.alertas.some((a) => a.activa && a.tipo === 'camara'), 15000);
  const e = await T.estado();
  T.ok('Al final de E: espera y LED verde', e.e === 'ESPERA' && e.led === 'verde', JSON.stringify(e));
  await T.vel(1);
  await T.cerrar();
})();
