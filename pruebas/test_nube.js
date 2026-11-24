// =============================================================================
// Simulación de la conexión app ↔ comedero (node pruebas/test_nube.js)
//  1. Pestañas (BroadcastChannel)
//  2. Firebase Realtime Database: servidor falso en memoria que imita sus reglas
//     (borra null y vacíos, arreglos como objetos, push, child_added, sin conexión)
//  Se conecta un Comedero real (con cámara falsa) con la app y se revisa todo el ciclo.
// =============================================================================
const path = require('path');
const fs = require('fs');
global.window = globalThis;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const S = require(path.join(__dirname, '..', 'js', 'comedero.js'));
global.SimComedero = S;
require(path.join(__dirname, '..', 'js', 'nube.js'));

// ---------------- Servidor Firebase falso ----------------
function podar(v) {
  if (Array.isArray(v)) { const o = {}; v.forEach((x, i) => { const y = podar(x); if (y !== undefined) o[i] = y; }); return Object.keys(o).length ? o : undefined; }
  if (v && typeof v === 'object') { const o = {}; for (const k in v) { const y = podar(v[k]); if (y !== undefined) o[k] = y; } return Object.keys(o).length ? o : undefined; }
  return v === null || v === undefined ? undefined : v;
}
function comoArreglo(v) {
  if (!v || typeof v !== 'object') return v;
  const ks = Object.keys(v); const o = {};
  for (const k of ks) o[k] = comoArreglo(v[k]);
  if (ks.length && ks.every((k) => /^\d+$/.test(k)) && Math.max(...ks.map(Number)) < ks.length * 2) {
    const a = []; for (const k of ks) a[+k] = o[k]; for (let i = 0; i < a.length; i++) if (a[i] === undefined) a[i] = null; return a;
  }
  return o;
}
class Servidor {
  constructor() { this.raiz = {}; this.clientes = []; this.escrituras = {}; this.idPush = 0; }
  leer(seg) { let n = this.raiz; for (const s of seg) { if (!n || typeof n !== 'object') return null; n = n[s]; } return n === undefined ? null : JSON.parse(JSON.stringify(n)); }
  escribir(seg, v, quien) {
    v = podar(v);
    const clave = seg.slice(2).join('/') || '/'; this.escrituras[clave] = (this.escrituras[clave] || 0) + 1;
    if (!seg.length) { this.raiz = v || {}; }
    else {
      let n = this.raiz; for (let i = 0; i < seg.length - 1; i++) { if (!n[seg[i]] || typeof n[seg[i]] !== 'object') n[seg[i]] = {}; n = n[seg[i]]; }
      if (v === undefined) delete n[seg[seg.length - 1]]; else n[seg[seg.length - 1]] = v;
    }
    this.clientes.forEach((c) => c.avisar(seg));
  }
}
class Ref {
  constructor(cli, seg) { this.cli = cli; this.seg = seg; }
  child(p) { return new Ref(this.cli, this.seg.concat(p.split('/').filter(Boolean))); }
  on(tipo, cb, err) {
    const l = { tipo, seg: this.seg, cb, vistos: new Set() };
    this.cli.oyentes.push(l);
    setImmediate(() => this.cli.entregar(l));
  }
  update(o) { for (const k in o) this.cli.escribir(this.seg.concat(k.split('/')), o[k]); return Promise.resolve(); }
  push(v) { const k = 'c' + (++this.cli.srv.idPush).toString().padStart(6, '0'); this.cli.escribir(this.seg.concat(k), v); return new Ref(this.cli, this.seg.concat(k)); }
  remove() { this.cli.escribir(this.seg, null); return Promise.resolve(); }
}
class Cliente {
  constructor(srv) { this.srv = srv; this.oyentes = []; this.online = true; this.cola = []; srv.clientes.push(this); }
  ref(p) { return new Ref(this, p.split('/').filter(Boolean)); }
  escribir(seg, v) { if (this.online) this.srv.escribir(seg, v); else this.cola.push([seg, v]); }
  avisar(segW) {
    if (!this.online) return;
    for (const l of this.oyentes) {
      const a = l.seg.join('/'), b = segW.join('/');
      if (a === '.info/connected') continue;
      if (b.startsWith(a) || a.startsWith(b)) setImmediate(() => this.entregar(l));
    }
  }
  entregar(l) {
    if (!this.online) return;
    if (l.seg.join('/') === '.info/connected') { l.cb({ val: () => this.online }); return; }
    const v = this.srv.leer(l.seg);
    if (l.tipo === 'value') l.cb({ val: () => comoArreglo(v), ref: new Ref(this, l.seg) });
    if (l.tipo === 'child_added' && v) for (const k of Object.keys(v).sort()) {
      if (l.vistos.has(k)) continue; l.vistos.add(k);
      l.cb({ val: () => comoArreglo(v[k]), ref: new Ref(this, l.seg.concat(k)), key: k });
    }
  }
  goOffline() { this.online = false; }
  goOnline() { this.online = true; this.cola.forEach(([s, v]) => this.srv.escribir(s, v)); this.cola = []; this.oyentes.forEach((l) => setImmediate(() => this.entregar(l))); }
}
function firebaseFalso(srv) {
  const cli = new Cliente(srv); const app = { database: () => cli };
  return { cli, ns: { apps: [], app: () => app, initializeApp: () => { return app; }, database: () => app.database() } };
}

// ---------------- Cámara falsa ----------------
class CamFalsa {
  constructor() { this.t = 0; this.despierta = false; this.rec = false; this.proxOK = 0; this.cola = []; this.llegan = []; }
  recibir(m) {
    const p = m.split(',');
    if (p[0] === 'REC') { this.despierta = true; this.rec = true; this.tRec = this.t; }
    if (p[0] === 'FIN') this.rec = false;
    if (p[0] === 'REVISAR') this.cola.push({ t: this.t + 300, m: 'RESTOS,6.5' });
    if (p[0] === 'REG') this.cola.push({ t: this.t + 1500, m: `REGOK,${p[1]},30,0,0,0.3` });
    if (p[0] === 'CALPAPEL') this.cola.push({ t: this.t + 500, m: 'CALOK' });
  }
  tick(dt) {
    this.t += dt;
    if (this.despierta && this.t >= this.proxOK) { this.enviar('OK'); this.proxOK = this.t + 1000; }
    if (this.rec && this.llegan.length && this.t - this.tRec >= 2000) { this.enviar(`GATO,${this.llegan.shift()},0.93`); this.tRec = this.t; }
    while (this.cola.length && this.cola[0].t <= this.t) this.enviar(this.cola.shift().m);
  }
}

const resultados = [];
function caso(nombre, ok, detalle) { resultados.push({ grupo: 'N', nombre, ok: !!ok, detalle }); console.log(`${ok ? '  ✔' : '  ✘'} ${nombre}${detalle ? ' — ' + detalle : ''}`); }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function montar(modo, srv) {
  const nubeC = S.nubeNueva(), nubeA = S.nubeNueva();
  if (modo === 'firebase') { window.FIREBASE_CONFIG = { apiKey: 'x', databaseURL: 'https://falso' }; }
  else window.FIREBASE_CONFIG = null;
  let fbC, fbA;
  if (modo === 'firebase') { fbC = firebaseFalso(srv); window.firebase = fbC.ns; }
  const conC = new ConexionNube(nubeC, 'comedero'); await conC.iniciar();
  if (modo === 'firebase') { fbA = firebaseFalso(srv); window.firebase = fbA.ns; }
  const conA = new ConexionNube(nubeA, 'app'); await conA.iniciar();
  const d = new Date(); d.setHours(5, 0, 0, 0);
  const c = new S.Comedero({ nube: nubeC, simInicio: d.getTime() });
  const cam = new CamFalsa(); c.enviarUart = (m) => cam.recibir(m); cam.enviar = (m) => c.onUart(m);
  c.arrancar();
  let pasos = 0;
  const correr = async (seg, hasta) => {
    for (let i = 0; i < seg * 20; i++) {
      conC.setOffline(!!c.fallas.sinInternet);
      c.tick(50); cam.tick(50);
      if (++pasos % 14 === 0) { conC.publicar(); conA.publicar(); }
      await new Promise((r) => setImmediate(r));
      if (hasta && hasta()) return true;
    }
    return false;
  };
  await correr(3);
  return { c, cam, nubeA, nubeC, conA, conC, correr, fbA, fbC };
}

(async () => {
  for (const modo of ['pestanas', 'firebase']) {
    console.log(`N. Conexión por ${modo === 'firebase' ? 'Firebase (servidor falso)' : 'pestañas (BroadcastChannel)'}`);
    const srv = new Servidor();
    const m = await montar(modo, srv);
    const { c, cam, nubeA, nubeC, conA, correr } = m;
    caso(`[${modo}] Modo de conexión`, conA.modo === modo && m.conC.modo === modo, conA.texto);
    await correr(2);
    caso(`[${modo}] La app recibe el estado del comedero`, nubeA.estado && nubeA.estado.estado === 'ESPERA' && nubeA.ultimaSync, `estado ${nubeA.estado && nubeA.estado.estado}`);
    // La app agrega un gato y cambia la configuración
    nubeA.gatos.push({ id: 1, nombre: 'Michi', racionG: 36, collar: null });
    nubeA.config.horarios = ['05:30', '13:00']; nubeA.config.esperaMin = 10;
    await correr(3);
    caso(`[${modo}] El comedero recibe gatos y horarios de la app`, c.gatos.length === 1 && c.gatos[0].racionG === 36 && c.config.horarios[0] === '05:30' && c.config.esperaMin === 10);
    // Registrar la huella (comando → REG → REGOK → /huellas)
    conA.enviarComando({ tipo: 'registrar', gatoId: 1 }); conA.enviarComando({ tipo: 'calibrarPlato' });
    await correr(5, () => nubeA.huellas.g1 && nubeA.instalacion.platoOk);
    caso(`[${modo}] Registro desde la app: la huella y el plato vuelven a la app`, nubeA.huellas.g1 && nubeA.huellas.g1.n === 30 && nubeA.instalacion.platoOk);
    // Una comida por horario
    cam.llegan.push(1); c.irAlProximoHorario();
    await correr(60, () => (nubeA.historial || []).some((h) => h.tipo === 'comida' && h.restos));
    const h = (nubeA.historial || []).find((x) => x.tipo === 'comida');
    caso(`[${modo}] La comida aparece en el historial de la app`, h && h.gato === 'Michi' && h.gramos === 36 && h.restos === 'restos', h ? `${h.gato} ${h.gramos} g, ${h.restos} ${h.restosPct} %` : 'no llegó');
    // Servir desde la app
    await correr(15, () => c.estado === 'ESPERA' && !c.ocupado);
    const n0 = c.historial.length;
    conA.enviarComando({ tipo: 'servir', porciones: 2 });
    await correr(40, () => c.historial.length > n0);
    caso(`[${modo}] "Servir ahora" desde la app dosifica en el comedero`, c.historial[0] && c.historial[0].gramos === 24 && c.historial[0].modo === 'Ciclo rápido');
    await correr(30, () => c.estado === 'ESPERA' && !c.ocupado);
    // Falla → alerta en la app → "Ya lo resolví"
    c.llenarTacho(); await correr(3, () => (nubeA.alertas || []).some((a) => a.activa && a.tipo === 'tacho_lleno'));
    const alertaLlego = (nubeA.alertas || []).some((a) => a.activa && a.tipo === 'tacho_lleno') && nubeA.estado.led.color === 'rojo';
    c.vaciarTacho(); await correr(3);
    caso(`[${modo}] Falla del comedero → alerta y LED rojo en la app; al resolverla se limpia`, alertaLlego && !(nubeA.alertas || []).some((a) => a.activa && a.tipo === 'tacho_lleno'));
    // Ver a mi gato: la app pide ver; el comedero (la cámara) sube una foto a /vista y la app la recibe
    conA.enviarComando({ tipo: 'ver', seg: 60 }); await correr(2);
    const jpg = 'data:image/jpeg;base64,' + 'A'.repeat(14000);
    nubeC.vista = { jpg, kb: 10, n: 1, t: c.reloj.sim, caja: { x: 0.3, y: 0.2, w: 0.4, h: 0.53 }, texto: 'Michi 93 %' };
    await correr(2, () => nubeA.vista && nubeA.vista.jpg === jpg);
    const llegoFoto = !!(nubeA.vista && nubeA.vista.jpg === jpg && nubeA.estado.viendo > 0);
    nubeC.vista = null; conA.enviarComando({ tipo: 'nover' }); await correr(2);
    caso(`[${modo}] "Ver a mi gato": la foto de la cámara llega a la app y se borra al cerrar`, llegoFoto && !nubeA.vista && c.resumen().viendo === 0, `foto de ${(jpg.length / 1024).toFixed(0)} KB`);
    // Sin internet: la app ve el corte; la orden espera y se ejecuta al volver
    c.fallas.sinInternet = true; await correr(2);
    const syncAntes = nubeA.ultimaSync; await correr(4);
    const congelado = nubeA.ultimaSync === syncAntes;
    conA.enviarComando({ tipo: 'servir', porciones: 1 }); const n1 = c.historial.length;
    await correr(6); const noLlego = c.historial.length === n1 && !c.ocupado;
    c.fallas.sinInternet = false; await correr(40, () => c.historial.length > n1);
    caso(`[${modo}] Sin internet: la app ve el corte, la orden espera y se cumple al volver`, congelado && noLlego && c.historial.length > n1, `congelado ${congelado}, esperó ${noLlego}`);
    // Sin bucles de reenvío: con el equipo quieto, el historial no se reescribe
    await correr(30, () => c.estado === 'ESPERA' && !c.ocupado); await correr(3);
    if (modo === 'firebase') {
      const antes = Object.assign({}, srv.escrituras);
      await correr(10);
      const dif = (k) => (srv.escrituras[k] || 0) - (antes[k] || 0);
      caso('[firebase] Sin bucles: en 10 s quietos no se reescriben historial, alertas ni gatos', dif('historial') === 0 && dif('alertas') === 0 && dif('gatos') === 0 && dif('config') === 0,
        `escrituras en 10 s → estado ${dif('estado')}, ultimaSync ${dif('ultimaSync')}, historial ${dif('historial')}, alertas ${dif('alertas')}, gatos ${dif('gatos')}`);
      // Segunda copia de la app (celular + PC): los cambios se ven en las dos
      const fb3 = firebaseFalso(srv); window.firebase = fb3.ns;
      const nube3 = S.nubeNueva(); const con3 = new ConexionNube(nube3, 'app'); await con3.iniciar();
      for (let i = 0; i < 20; i++) { await new Promise((r) => setImmediate(r)); }
      const vioGatos = nube3.gatos.length === 1 && nube3.config.horarios[0] === '05:30';
      nube3.config.esperaMin = 45; con3.publicar();
      await correr(3);
      caso('[firebase] Dos copias de la app (celular y PC) quedan iguales', vioGatos && nubeA.config.esperaMin === 45 && c.config.esperaMin === 45, `la copia nueva ve ${nube3.gatos.length} gato(s); espera en el comedero ${c.config.esperaMin} min`);
      const tamaño = JSON.stringify(srv.raiz).length;
      caso('[firebase] Tamaño de los datos en la nube', tamaño < 200000, `${(tamaño / 1024).toFixed(1)} KB (el plan gratuito de Firebase admite 1 GB)`);
    }
    if (m.conC.bc) { m.conC.bc.close(); conA.bc.close(); }
  }
  const ok = resultados.filter((r) => r.ok).length;
  console.log(`\nResultado: ${ok} de ${resultados.length} casos de conexión correctos`);
  fs.writeFileSync(path.join(__dirname, 'resultados_nube.json'), JSON.stringify({ resultados }, null, 1));
  process.exit(ok === resultados.length ? 0 : 1);
})();
