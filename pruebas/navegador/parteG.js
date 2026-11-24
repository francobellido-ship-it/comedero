// Parte G: un cliente nuevo usa la app en el celular (390×844, táctil): cuenta, conexión, cámara, gato y Mi cuenta
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'imagenes') + path.sep;
const DIR = __dirname + path.sep;
const img = (f) => 'data:image/png;base64,' + fs.readFileSync(OUT + f).toString('base64');
(async () => {
  fs.rmSync(DIR + 'perfil_cliente', { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(DIR + 'perfil_cliente', {
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }), viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox']
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errores = [], res = [];
  page.on('pageerror', (e) => errores.push(e.message));
  const ok = (n, c, d) => { res.push({ n, ok: !!c }); console.log((c ? '  ✔ ' : '  ✘ ') + n + (d ? ' — ' + d : '')); };
  const esperar = async (fn, ms, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 200 }); return true; } catch (e) { return false; } };
  const app = (sel) => `#app-vista ${sel}`;
  const tocar = async (sel) => { await page.tap(sel); await page.waitForTimeout(350); };
  const escribir = async (sel, t) => { await page.fill(sel, ''); await page.type(sel, t, { delay: 8 }); };
  const texto = () => page.evaluate(() => document.querySelector('#app-vista').innerText);
  const error = () => page.evaluate(() => { const e = document.querySelector('#app-vista [role="alert"]'); return e ? e.textContent : ''; });
  const lado = async (l) => { const b = await page.$(`.pestanas button[data-lado="${l}"]`); if (b && await b.isVisible()) { await b.tap(); await page.waitForTimeout(400); } };

  await page.goto(process.env.URL || 'http://127.0.0.1:8765/demo.html'); await page.waitForTimeout(2500);
  // ---- G1. Primera pantalla ----
  let t = await texto();
  ok('Al abrir: "Crear cuenta" y "Ya tengo cuenta", sin menú abajo', /Crear cuenta/.test(t) && /Ya tengo cuenta/.test(t) && !(await page.isVisible('#app-nav')));
  // ---- G2. Crear cuenta con errores ----
  await tocar(app('[data-act="cuenta-ir"][data-p="crear"]'));
  await tocar(app('[data-act="cuenta-crear"]'));
  const e1 = await error();
  await escribir('#cu-nombre', 'Franco'); await escribir('#cu-correo', 'franco@gmail'); await escribir('#cu-clave', 'abc'); await escribir('#cu-clave2', 'abc');
  await tocar(app('[data-act="cuenta-crear"]')); const e2 = await error();
  await escribir('#cu-correo', 'franco.bellido@pucp.edu.pe'); await tocar(app('[data-act="cuenta-crear"]')); const e3 = await error();
  await escribir('#cu-clave', 'gatitos123'); await escribir('#cu-clave2', 'gatitos124'); await tocar(app('[data-act="cuenta-crear"]')); const e4 = await error();
  ok('Crear cuenta: avisa nombre vacío, correo inválido, contraseña corta y contraseñas distintas',
    /nombre/.test(e1) && /no parece válido/.test(e2) && /al menos 6/.test(e3) && /no coinciden/.test(e4), [e1, e2, e3, e4].join(' | '));
  // mostrar contraseña
  await tocar(app('[data-act="ver-clave"][data-para="cu-clave"]'));
  const tipo = await page.$eval('#cu-clave', (el) => el.type);
  ok('"Mostrar" deja ver la contraseña', tipo === 'text');
  await escribir('#cu-clave2', 'gatitos123'); await tocar(app('[data-act="cuenta-crear"]'));
  t = await texto();
  ok('Cuenta creada → pasa a "Conecta tu comedero"', /Conecta tu comedero/.test(t), t.slice(0, 60).replace(/\n/g, ' '));
  // ---- G3. Conectar el comedero ----
  await escribir('#ob-codigo', 'comedero 12'); await escribir('#ob-wifi', 'MiCasa_2.4G'); await escribir('#ob-wifiClave', 'clave123');
  await tocar(app('[data-act="ob-conectar"]')); t = await texto(); const c1 = /COMEDERO-XXXX/.test(t);
  await escribir('#ob-codigo', 'COMEDERO-1234'); await tocar(app('[data-act="ob-conectar"]')); t = await texto(); const c2 = /No encontramos/.test(t);
  const codigo = await page.evaluate(() => document.getElementById('codigo-equipo').textContent);
  await escribir('#ob-codigo', codigo.toLowerCase()); await escribir('#ob-wifiClave', '1234'); await tocar(app('[data-act="ob-conectar"]')); t = await texto(); const c3 = /al menos 8/.test(t);
  await escribir('#ob-wifiClave', 'clave12345'); await tocar(app('[data-act="ob-conectar"]'));
  const c4 = await esperar(() => /encontrado y conectado/.test(document.querySelector('#app-vista').innerText), 8000);
  ok('Conectar: rechaza código mal escrito, código ajeno y Wi-Fi corto; con el código de la etiqueta se conecta', c1 && c2 && c3 && c4, `formato ${c1} · ajeno ${c2} · wifi ${c3} · conectado ${c4}`);
  await tocar(app('[data-act="ob-siguiente"]'));
  // ---- G4. Cámara: encender desde la app, ver en vivo, fondo y papel ----
  t = await texto();
  ok('Paso cámara: dice que está apagada y ofrece encenderla', /Prepara la cámara/.test(t) && !!(await page.$(app('[data-act="ob-webcam"]'))));
  await tocar(app('[data-act="ob-webcam"]'));
  await esperar(() => window.camara.webcam, 10000);
  await page.evaluate((imgs) => {
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480; const ctx = cv.getContext('2d');
    const I = {}; for (const k in imgs) { I[k] = new Image(); I[k].src = imgs[k]; }
    window.__escena = 'fondo';
    setInterval(() => { const im = I[window.__escena]; if (im.complete) ctx.drawImage(im, -3 + Math.random() * 6, -3 + Math.random() * 6, 646, 486); }, 66);
    window.camara.video.srcObject = cv.captureStream(15); window.camara.video.play();
  }, { fondo: img('p_fondo.png'), gato1: img('p_gato_cel.png') });
  await esperar(() => !!window.camara.tipo && !window.camara.cargando, 60000);
  const vivo = await esperar(() => !!document.querySelector('#fondo-zona img[src^="data:image"]'), 15000);
  ok('La app muestra lo que ve la cámara del comedero (EN VIVO) antes de registrar', vivo);
  await tocar(app('[data-act="fondo"]'));
  const prog = await esperar(() => /Aprendiendo el fondo/.test(document.querySelector('#app-vista').innerText) && !!document.querySelector('#fondo-zona img'), 10000);
  const fondo = await esperar(() => (window.nube.instalacion || {}).fondoOk && /Fondo registrado/.test(document.querySelector('#app-vista').innerText), 80000);
  await tocar(app('[data-act="plato"]'));
  const papel = await esperar(() => (window.nube.instalacion || {}).platoOk, 15000);
  ok('Registrar el fondo (con avance e imagen) y calibrar el papel', prog && fondo && papel, `avance ${prog} · fondo ${fondo} · papel ${papel}`);
  await tocar(app('[data-act="ob-siguiente"]'));
  // ---- G5. Registrar al gato viendo la cámara ----
  await escribir('#ng-nombre', 'Lulu');
  await page.evaluate(() => { window.__escena = 'gato1'; });
  await page.waitForTimeout(600);
  await tocar(app('[data-act="agregar"]'));
  const regVivo = await esperar(() => !!document.querySelector('#reg-zona img[src^="data:image"]') && /Tomando fotos/.test(document.querySelector('#app-vista').innerText), 15000);
  const reg = await esperar(() => /quedó registrado/.test(document.querySelector('#app-vista').innerText), 90000);
  await page.evaluate(() => { window.__escena = 'fondo'; });
  ok('Registrar a Lulu: la app muestra la cámara mientras toma las fotos y avisa al terminar', regVivo && reg, `en vivo ${regVivo} · registrado ${reg}`);
  await page.waitForTimeout(2000);
  await tocar(app('[data-act="ob-siguiente"]'));
  await tocar(app('[data-act="ob-fin"]'));
  t = await texto();
  ok('Empezar → Inicio con "Hola, Franco" y el menú abajo', /Hola, Franco/.test(t) && await page.isVisible('#app-nav'));
  // ---- G6. Servir desde la app ----
  await tocar(app('[data-act="porciones"][data-n="2"]')); await tocar(app('[data-act="servir"]'));
  const sirve = await esperar(() => window.comedero.estado === 'DOSIFICACION' && window.comedero.hw.n === 2, 10000);
  ok('Servir 24 g desde la app', sirve);
  // ---- G7. Mi cuenta ----
  await tocar('#app-nav button[data-vista="ajustes"]');
  t = await texto();
  ok('Ajustes → Mi cuenta: nombre, correo y código del comedero', /Mi cuenta/.test(t) && /franco.bellido@pucp.edu.pe/.test(t) && t.includes(codigo), '');
  await tocar(app('[data-act="cuenta-panel"][data-p="nombre"]'));
  await escribir('#cu-nuevoNombre', 'Franco B.'); await tocar(app('[data-act="cuenta-nombre"]'));
  await tocar('#app-nav button[data-vista="inicio"]'); t = await texto();
  ok('Cambiar nombre: Inicio saluda con el nombre nuevo', /Hola, Franco B\./.test(t));
  await tocar('#app-nav button[data-vista="ajustes"]');
  await tocar(app('[data-act="cuenta-panel"][data-p="clave"]'));
  await escribir('#cu-actual', 'equivocada'); await escribir('#cu-nueva', 'michis456'); await escribir('#cu-nueva2', 'michis456');
  await tocar(app('[data-act="cuenta-clave"]')); const k1 = await error();
  await escribir('#cu-actual', 'gatitos123'); await tocar(app('[data-act="cuenta-clave"]'));
  const k2 = !(await page.$('#cu-actual'));
  ok('Cambiar contraseña: rechaza la actual equivocada y acepta la correcta', /no es correcta/.test(k1) && k2, k1);
  // ---- G8. Cerrar sesión y volver a entrar ----
  await tocar(app('[data-act="cuenta-salir"]')); t = await texto();
  const enLogin = /Inicia sesión/.test(t);
  await escribir('#cu-correo', 'franco.bellido@pucp.edu.pe'); await escribir('#cu-clave', 'gatitos123'); await tocar(app('[data-act="cuenta-entrar"]')); const l1 = await error();
  await escribir('#cu-correo', 'otro@gmail.com'); await tocar(app('[data-act="cuenta-entrar"]')); const l2 = await error();
  await tocar(app('[data-act="cuenta-ir"][data-p="recuperar"]')); await escribir('#cu-correo', 'franco.bellido@pucp.edu.pe'); await tocar(app('[data-act="cuenta-recuperar"]')); const l3 = await error();
  await tocar(app('[data-act="cuenta-ir"][data-p="entrar"]'));
  await escribir('#cu-correo', 'Franco.Bellido@PUCP.edu.pe '); await escribir('#cu-clave', 'michis456');
  await page.press('#cu-clave', 'Enter');
  await esperar(() => /Hola, Franco B\./.test(document.querySelector('#app-vista').innerText), 5000);
  t = await texto(); if (!/Hola, Franco B\./.test(t)) console.log('    pantalla:', t.slice(0, 200).replace(/\n/g, ' | '), '· error:', await error());
  ok('Cerrar sesión → Iniciar sesión: avisa contraseña vieja, correo sin cuenta y "olvidé"; entra con la nueva (Enter, mayúsculas y espacios en el correo)',
    enLogin && /no es correcta/.test(l1) && /No hay ninguna cuenta/.test(l2) && /dispositivo/.test(l3) && /Hola, Franco B\./.test(t), [l1, l2, l3].join(' | '));
  // ---- G9. Recargar: sigue la sesión ----
  await page.reload(); await page.waitForTimeout(2500); t = await texto();
  ok('Recargar la página: la sesión sigue abierta', /Hola, Franco B\./.test(t));
  // ---- G10. Otra persona de la casa crea su cuenta ----
  await tocar('#app-nav button[data-vista="ajustes"]'); await tocar(app('[data-act="cuenta-salir"]'));
  await tocar(app('[data-act="cuenta-ir"][data-p="crear"]'));
  await escribir('#cu-nombre', 'Ana'); await escribir('#cu-correo', 'franco.bellido@pucp.edu.pe'); await escribir('#cu-clave', 'ana12345'); await escribir('#cu-clave2', 'ana12345');
  await tocar(app('[data-act="cuenta-crear"]')); const d1 = await error();
  await escribir('#cu-correo', 'ana@gmail.com'); await tocar(app('[data-act="cuenta-crear"]'));
  await esperar(() => /Hola, Ana/.test(document.querySelector('#app-vista').innerText), 5000);
  t = await texto(); if (!/Hola, Ana/.test(t)) console.log('    pantalla:', t.slice(0, 200).replace(/\n/g, ' | '), '· error:', await error());
  ok('Otra cuenta en el mismo celular: no repite correos y entra directo al comedero ya configurado', /Ya hay una cuenta/.test(d1) && /Hola, Ana/.test(t), d1);
  // ---- G11. Eliminar la cuenta ----
  await tocar('#app-nav button[data-vista="ajustes"]');
  await tocar(app('[data-act="cuenta-panel"][data-p="eliminar"]'));
  await escribir('#cu-claveEliminar', 'nolase'); await tocar(app('[data-act="cuenta-eliminar"]')); const x1 = await error();
  await escribir('#cu-claveEliminar', 'ana12345'); await tocar(app('[data-act="cuenta-eliminar"]'));
  t = await texto();
  await tocar(app('[data-act="cuenta-ir"][data-p="entrar"]'));
  await escribir('#cu-correo', 'ana@gmail.com'); await escribir('#cu-clave', 'ana12345'); await tocar(app('[data-act="cuenta-entrar"]')); const x2 = await error();
  ok('Eliminar cuenta: pide la contraseña, la borra y ya no se puede entrar con ella', /no es correcta/.test(x1) && /Crear cuenta/.test(t) && /No hay ninguna cuenta/.test(x2), x1 + ' | ' + x2);
  // ---- G12. Ver la demo sin cuenta ----
  await tocar(app('[data-act="cuenta-ir"][data-p="inicio"]'));
  await tocar(app('[data-act="ob-saltar"]'));
  t = await texto();
  await tocar('#app-nav button[data-vista="ajustes"]'); const t2 = await texto();
  ok('"Ver la demo sin cuenta": entra a Inicio y en Ajustes ofrece crear cuenta', /Todo listo|Hola/.test(t) && /demo sin cuenta/.test(t2));
  // ---- G13. Nada se sale de la pantalla del celular ----
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  ok('Nada se sale de la pantalla del celular (ancho 390)', ancho <= 392, `${ancho} px`);
  
  ok('Sin errores de JavaScript', errores.length === 0, errores.slice(0, 3).join(' | '));
  fs.writeFileSync(DIR + 'resultado_G.json', JSON.stringify(res, null, 1));
  await ctx.close();
})();
