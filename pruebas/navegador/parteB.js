// Parte B: modo libre, probar, ver a mi gato (todo como usuario, con la webcam de prueba)
const { abrir } = require('./comun.js');
(async () => {
  const T = await abrir('B');
  const { page } = T;
  await T.webcam(); await T.libre();
  await T.vel(60);
  // permitir que coman en libre ahora (si ya comieron hace poco, adelantar 3 h)
  await T.ev(() => window.comedero.adelantarMin(181));
  await T.libre();
  // ---- B1. Modo libre desde la app ----
  await T.vista('inicio');
  await T.clic('[data-act="modo"][data-m="libre"]');
  const enLibre = await T.esperar(() => window.comedero.config.modo === 'libre', 6000);
  T.ok('App → Modo libre: el comedero lo recibe', enLibre);
  let n0 = (await T.hist()).length;
  await T.escena('gato1');
  const sirveLibre = await T.esperar(() => window.comedero.estado === 'DOSIFICACION', 30000);
  await T.esperar(() => window.comedero.estado === 'CONSUMO', 20000);
  await page.waitForTimeout(2500); await T.escena('fondo');
  await T.libre();
  let h = await T.hist(); let nuevos = h.slice(0, h.length - n0);
  const c = nuevos.find((x) => x.tipo === 'comida' && x.gato === 'Lulu');
  T.ok('Libre: llega Lulu → la reconoce y le sirve su ración', sirveLibre && c && c.g === 24, nuevos.map((x) => `${x.tipo} ${x.gato || ''} ${x.g || ''}`).join(' · '));
  // vuelve enseguida → visita sin comida
  await page.waitForTimeout(31000 / 60 + 1500);   // pasa la calma (30 s simulados)
  n0 = (await T.hist()).length;
  await T.escena('gato1');
  const visita = await T.esperar((n) => window.comedero.historial.length > n, 40000, n0);
  await T.escena('fondo');
  await T.libre();
  h = await T.hist(); nuevos = h.slice(0, h.length - n0);
  T.ok('Libre: Lulu vuelve enseguida → visita, no se sirve otra vez', visita && nuevos.length && nuevos.every((x) => x.tipo !== 'comida'), nuevos.map((x) => `${x.tipo} ${x.gato || ''}`).join(' · '));
  // llega Pancha → sí come
  await page.waitForTimeout(1500);
  n0 = (await T.hist()).length;
  await T.escena('gato2');
  await T.esperar(() => window.comedero.estado === 'CONSUMO', 40000);
  await page.waitForTimeout(2000); await T.escena('fondo');
  await T.libre();
  h = await T.hist(); nuevos = h.slice(0, h.length - n0);
  T.ok('Libre: llega Pancha → le sirve 36 g', nuevos.some((x) => x.tipo === 'comida' && x.gato === 'Pancha' && x.g === 36), nuevos.map((x) => `${x.tipo} ${x.gato || ''} ${x.g || ''}`).join(' · '));
  // un objeto cualquiera (plumón) → no se sirve
  await page.waitForTimeout(1500);
  n0 = (await T.hist()).length;
  await T.escena('plumon');
  await T.esperar(() => window.comedero.estado === 'RECONOCIMIENTO', 10000);
  await T.esperar(() => window.comedero.estado === 'ESPERA' && !window.comedero.ocupado, 60000);
  const sirvioPlumon = await T.ev(() => window.comedero.estado === 'DOSIFICACION');
  await T.escena('fondo'); await T.libre();
  h = await T.hist(); nuevos = h.slice(0, h.length - n0);
  T.ok('Libre: un plumón frente a la cámara → no es gato registrado, no se sirve', !sirvioPlumon && !nuevos.some((x) => x.tipo === 'comida'), nuevos.map((x) => `${x.tipo} ${x.gato || ''}`).join(' · ') || 'sin registro');
  // nadie (persona sentada sin moverse) → no se dispara solo
  const ciclos0 = await T.ev(() => window.comedero.eventos.filter((e) => /Modo libre: el PIR/.test(e.texto)).length);
  await page.waitForTimeout(8000);
  const ciclos1 = await T.ev(() => window.comedero.eventos.filter((e) => /Modo libre: el PIR/.test(e.texto)).length);
  T.ok('Libre: con solo la persona sentada (el fondo) no se dispara solo', ciclos1 === ciclos0, `${ciclos1 - ciclos0} disparos en 8 s`);
  // volver a horarios
  await T.vista('inicio');
  await T.clic('[data-act="modo"][data-m="horario"]');
  T.ok('App → volver a modo por horarios', await T.esperar(() => window.comedero.config.modo === 'horario', 6000));

  // ---- B2. Probar reconocimiento ----
  await T.vel(1);
  await T.vista('gatos');
  const btnProbar = await page.$('[data-act="probar"]');
  if (!btnProbar) T.ok('Botón Probar en Mis gatos', false);
  else {
    await T.escena('gato2'); await page.waitForTimeout(600);
    await T.clic('[data-act="probar"]');
    const r1 = await T.esperar(() => /Pancha/.test((document.querySelector('#app-vista') || {}).textContent || '') && /Reconoc|Coincide|Es /.test(document.querySelector('#app-vista').textContent), 40000);
    const txt1 = await T.ev(() => { const el = document.querySelector('#app-vista .resultado') || document.querySelector('#app-vista'); return el.textContent.replace(/\s+/g, ' ').slice(0, 160); });
    const img1 = await T.ev(() => !!document.querySelector('#app-vista img[src^="data:image"]'));
    T.ok('Probar con Pancha: la app la reconoce y muestra la imagen en vivo', r1 && img1, txt1);
    await T.esperar(() => !window.comedero.ocupado, 60000);
    await T.escena('plumon'); await page.waitForTimeout(600);
    await T.clic('[data-act="probar"]');
    await page.waitForTimeout(9000);
    const txt2 = await T.ev(() => { const el = document.querySelector('#app-vista .resultado') || document.querySelector('#app-vista'); return el.textContent.replace(/\s+/g, ' ').slice(0, 200); });
    T.ok('Probar con un plumón: no dice que es Lulu ni Pancha', !/Es Lulu|Es Pancha|Reconocido: Lulu|Reconocido: Pancha/.test(txt2), txt2);
    await T.esperar(() => !window.comedero.ocupado, 60000);
    await T.escena('fondo');
  }
  // probar mientras hay un ciclo → aviso, no se cuelga
  await T.vel(60);
  await T.pulsar(1);
  await T.esperar(() => window.comedero.ocupado, 8000);
  await T.vista('gatos');
  const pb = await page.$('[data-act="probar"]');
  if (pb) { await pb.click(); await page.waitForTimeout(1200); }
  const ev = await T.ev(() => window.comedero.eventos.slice(0, 6).map((e) => e.texto).join(' | '));
  await T.libre();
  T.ok('Probar durante un ciclo: se avisa y el ciclo termina normal', /ocupado|en curso|ignorad|después/i.test(ev) || !pb, ev.slice(0, 160));

  // ---- B3. Ver a mi gato ----
  await T.vel(1);
  await T.vista('inicio');
  await T.escena('gato1');
  const bv = await page.$('[data-act="ver"]');
  if (!bv) T.ok('Botón Ver a mi gato en Inicio', false);
  else {
    await bv.click();
    const vivo = await T.esperar(() => !!document.querySelector('#app-vista img[src^="data:image"]') && /EN VIVO/i.test(document.querySelector('#app-vista').textContent), 15000);
    T.ok('Ver a mi gato: aparece la imagen EN VIVO en la app', vivo);
    const s1 = await T.ev(() => (window.nube.vista || {}).t || 0); await page.waitForTimeout(2500);
    const s2 = await T.ev(() => (window.nube.vista || {}).t || 0);
    T.ok('Ver a mi gato: la imagen se actualiza (≈1 por segundo)', s2 > s1, `${Math.round((s2 - s1))} ms entre fotos`);
    await T.clic('[data-act="nover"]');
    const cerrado = await T.esperar(() => !document.querySelector('#app-vista img[src^="data:image"]') && !window.camara.viendo(), 8000);
    T.ok('Cerrar: la cámara deja de transmitir', cerrado);
  }
  await T.escena('fondo');
  const e = await T.estado();
  T.ok('Al final de B: espera, LED verde', e.e === 'ESPERA' && e.led === 'verde', JSON.stringify(e));
  await T.cerrar();
})();
