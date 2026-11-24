// Herramientas comunes para probar todos los modos como un usuario (con webcam de prueba)
// Requisitos: npm i playwright  ·  Google Chrome instalado  ·  la carpeta servida en http://127.0.0.1:8765
//   (por ejemplo: python -m http.server 8765 dentro de comedero_app). Cambia la dirección con URL=...
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'imagenes') + path.sep;
const URL = process.env.URL || 'http://127.0.0.1:8765/demo.html';
const img = (f) => 'data:image/png;base64,' + fs.readFileSync(OUT + f).toString('base64');
async function abrir(parte) {
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, process.env.PERFIL || 'perfil'), {
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }), viewport: { width: 1500, height: 950 }, colorScheme: 'dark',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox']
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const T = { page, ctx, errores: [], res: [], parte };
  page.on('pageerror', (e) => T.errores.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/jsdelivr|tfhub|kaggle|Failed to load resource|ERR_|fetch/i.test(m.text())) T.errores.push('console: ' + m.text()); });
  T.esperar = async (fn, ms, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 200 }); return true; } catch (e) { return false; } };
  T.ev = (fn, arg) => page.evaluate(fn, arg);
  T.ok = (nombre, ok, detalle) => { T.res.push({ parte, nombre, ok: !!ok, detalle: detalle || '' }); console.log((ok ? '  ✔ ' : '  ✘ ') + nombre + (detalle ? ' — ' + detalle : '')); };
  T.escena = (e) => page.evaluate((x) => { window.__escena = x; }, e);
  T.vista = async (v) => { await page.click(`#app-nav button[data-vista="${v}"]`); await page.waitForTimeout(500); };
  T.clic = async (sel) => { await page.click(sel); await page.waitForTimeout(300); };
  T.vel = async (v) => { await page.selectOption('#vel', String(v)); await page.waitForTimeout(300); };
  T.libre = () => T.esperar(() => window.comedero.estado === 'ESPERA' && !window.comedero.ocupado && !window.comedero.cr, 120000);
  T.estado = () => page.evaluate(() => { const c = window.comedero; return { e: c.estado, oc: c.ocupado, led: c.led().color, det: c.detalle, alertas: c.alertas.filter((a) => a.activa).map((a) => a.tipo) }; });
  T.hist = () => page.evaluate(() => window.comedero.historial.map((h) => ({ tipo: h.tipo, gato: h.gato, g: h.gramos, modo: h.modo, restos: h.restos })));
  T.pulsar = async (n) => { const b = await page.$('#pulsador'); await b.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); const r = await b.boundingBox(); for (let i = 0; i < n; i++) { await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up(); await page.waitForTimeout(350); } };
  T.pulsarLargo = async () => { const b = await page.$('#pulsador'); await b.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); const r = await b.boundingBox(); await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down(); await page.waitForTimeout(3400); await page.mouse.up(); await page.waitForTimeout(500); };
  T.webcam = async () => {
    await page.goto(URL); await page.waitForTimeout(2500);
    const sinOnb = await page.$('[data-act="ob-saltar"]');
    T.enOnboarding = !!sinOnb;
    await page.click('#btn-webcam'); await T.esperar(() => window.camara.webcam, 8000);
    await page.evaluate((imgs) => {
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480; const ctx = cv.getContext('2d');
      const I = {}; for (const k in imgs) { I[k] = new Image(); I[k].src = imgs[k]; }
      window.__escena = 'fondo';
      setInterval(() => { const im = I[window.__escena]; if (im.complete) ctx.drawImage(im, -3 + Math.random() * 6, -3 + Math.random() * 6, 646, 486); }, 66);
      window.camara.video.srcObject = cv.captureStream(15); window.camara.video.play();
    }, { fondo: img('p_fondo.png'), gato1: img('p_gato_cel.png'), gato2: img('p_gato2_cel.png'), plumon: img('p_plumon.png') });
    await T.esperar(() => !!window.camara.tipo && !window.camara.cargando, 60000);
  };
  T.cerrar = async () => {
    T.ok(`[${parte}] sin errores de JavaScript`, T.errores.length === 0, T.errores.slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(__dirname, `resultado_${parte}.json`), JSON.stringify(T.res, null, 1));
    await ctx.close();
  };
  return T;
}
module.exports = { abrir };
