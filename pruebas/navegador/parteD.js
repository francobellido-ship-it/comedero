// Parte D: avisos, inventario, cámara, sin internet, corte de energía y recargas
const { abrir } = require('./comun.js');
(async () => {
  const T = await abrir('D');
  const { page } = T;
  await T.webcam(); await T.libre();
  // Para esta parte se apaga el PIR por webcam (el caso de Franco era sin webcam)
  await page.evaluate(() => { window.camara.pirWebcam = false; document.querySelector('#chk-pirweb').checked = false; });
  await T.clic('#btn-real'); await T.libre();
  const desconectada = () => T.ev(() => /no se conecta desde/.test(document.querySelector('#app-vista').textContent));
  const tocarApp = async (sel) => { await T.vista('inicio'); await T.clic(sel); };

  await T.vel(60);
  const chk = (k) => page.check(`[data-falla="${k}"]`);
  const unchk = (k) => page.uncheck(`[data-falla="${k}"]`);
  const ya = async () => { await T.vista('inicio'); try { await page.waitForSelector('[data-act="confirmar"]', { timeout: 6000 }); await page.click('[data-act="confirmar"]'); } catch (e) { console.log('    (no apareció "Ya lo resolví")'); } await page.waitForTimeout(400); };
  let e;
  // Empieza limpio: se cierran los avisos que queden con "Entendido" en la app
  await T.vista('inicio');
  for (let k = 0; k < 6; k++) { const b = await page.$('[data-act="entendido"]'); if (!b) break; await b.click(); await page.waitForTimeout(1500); }
  T.ok('Avisos que quedaban: "Entendido" en la app los cierra', (await T.estado()).led === 'verde', JSON.stringify(await T.estado()));
  // Avisos amarillos
  await T.clic('[data-accion="tolvaCasiVacia"]'); await T.pulsar(1); await T.libre();
  e = await T.estado();
  T.ok('Queda poco alimento: aviso amarillo y alerta en la app', e.led === 'amarillo' && e.alertas.includes('alimento_bajo'), e.alertas.join(','));
  await T.clic('[data-accion="rellenarTolva"]'); await page.waitForTimeout(800);
  T.ok('Rellenar tolva: se quita el aviso', !(await T.estado()).alertas.includes('alimento_bajo'));
  await T.clic('[data-accion="rolloPorAcabarse"]'); await page.waitForTimeout(800);
  e = await T.estado();
  T.ok('Rollo por acabarse: aviso amarillo', e.led === 'amarillo' && e.alertas.includes('rollo'), e.alertas.join(','));
  await T.vista('inicio');
  const ent = await page.$('[data-act="entendido"][data-tipo="rollo"]'); if (ent) { await ent.click(); await page.waitForTimeout(1500); }
  await T.clic('[data-accion="ponerRollo"]'); await T.libre(); await page.waitForTimeout(1000);
  T.ok('Rollo nuevo / Entendido: vuelve el verde', (await T.estado()).led === 'verde', JSON.stringify(await T.estado()));
  // Sensor de nivel desajustado (inventario)
  await T.clic('[data-accion="tolvaMitad"]');
  await chk('inventario'); await T.pulsar(1); await T.libre();
  e = await T.estado();
  T.ok('Sensor de nivel desajustado: aviso de inventario', e.alertas.includes('inventario'), e.alertas.join(','));
  await unchk('inventario'); await T.clic('[data-accion="rellenarTolva"]'); await page.waitForTimeout(800);
  // Cámara no responde (por horarios)
  await page.check('#f-camara');
  await T.clic('#btn-horario');
  const alertaCam = await T.esperar(() => window.comedero.alertas.some((a) => a.activa && a.tipo === 'camara'), 40000);
  await T.libre();
  await page.uncheck('#f-camara');
  const sinAlerta = await T.esperar(() => !window.comedero.alertas.some((a) => a.activa && a.tipo === 'camara'), 15000);
  T.ok('Cámara no responde: alerta, termina el horario y la alerta se borra al volver', alertaCam && sinAlerta);
  // Sin internet: LED azul intermitente, app avisa con la causa; servir desde la app queda pendiente
  await chk('sinInternet'); await page.waitForTimeout(5000);
  e = await T.estado();
  const led = await T.ev(() => window.comedero.led());
  const banner = await T.ev(() => document.querySelector('#app-vista').textContent);
  T.ok('Sin internet: LED azul intermitente y la app dice la causa', led.color === 'azul' && led.parpadeo && /falla "Sin internet"/.test(banner), led.texto);
  await tocarApp('[data-act="servir"]');
  await page.waitForTimeout(2500);
  const noSirvio = await T.ev(() => window.comedero.estado === 'ESPERA');
  await unchk('sinInternet');
  const sirvio = await T.esperar(() => window.comedero.estado === 'DOSIFICACION', 10000);
  await T.libre();
  T.ok('Sin internet: la orden de la app espera y se cumple al volver', noSirvio && sirvio && !(await desconectada()));
  // Corte de energía en plena comida
  await T.libre();
  await T.pulsar(1); const enC = await T.esperar(() => window.comedero.estado === 'CONSUMO', 30000);
  if (!enC) console.log('    no llegó a CONSUMO:', await T.ev(() => window.comedero.eventos.slice(0, 5).map((x) => x.texto).join(' | ')));
  await T.clic('#btn-corte');
  const ren = await T.esperar(() => window.comedero.estado === 'RENOVACION', 20000);
  await T.libre();
  T.ok('Corte de energía en plena comida: al volver renueva el papel y queda listo', ren && (await T.estado()).led === 'verde');
  // Recargar la página en plena comida
  await T.pulsar(1); await T.esperar(() => window.comedero.estado === 'CONSUMO', 30000);
  await page.reload(); await page.waitForTimeout(3000);
  const ren2 = await T.esperar(() => window.comedero.estado === 'RENOVACION' || (window.comedero.estado === 'ESPERA' && !window.comedero.ocupado), 30000);
  await T.ev(() => { window.comedero.reloj.vel = 60; });
  const fin2 = await T.esperar(() => window.comedero.estado === 'ESPERA' && !window.comedero.ocupado, 60000);
  const r2 = await T.ev(() => window.comedero.eventos.slice(0, 12).map((x) => x.texto).join(' | '));
  T.ok('Recargar en plena comida: al encender renueva el papel (ciclo a medias)', ren2 && fin2 && /Ciclo sin terminar/.test(r2), r2.slice(0, 160));
  // Recargar sin ciclo: no inventa un ciclo a medias
  await page.waitForTimeout(1500);
  await page.reload(); await page.waitForTimeout(4000);
  const r3 = await T.ev(() => { const ev = window.comedero.eventos; const i = ev.findIndex((x) => x.texto === 'Encendido'); return ev.slice(0, i + 1).map((x) => x.texto).join(' | '); });
  T.ok('Recargar en reposo: no renueva el papel sin motivo', !/Ciclo sin terminar/.test(r3) && !(await T.ev(() => window.comedero.cicloEnCurso)), r3.slice(0, 120));
  await T.cerrar();
})();
