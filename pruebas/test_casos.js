// =============================================================================
// Simulación de TODOS los casos de la lógica del comedero (node pruebas/test_casos.js)
//  - Matriz de casos: configuración (Tabla 4.5), dosificación, papel, tacho, panel, nube
//  - Pruebas al azar (fuzz) con reglas que nunca se deben romper (invariantes)
// Escribe pruebas/resultados_casos.json para el reporte.
// =============================================================================
const path = require('path');
const fs = require('fs');
const { Comedero, nubeNueva, CFG } = require(path.join(__dirname, '..', 'js', 'comedero.js'));

// ---------- Cámara falsa (ESP32-S3-CAM) ----------
class CamFalsa {
  constructor() {
    this.t = 0; this.despierta = false; this.rec = false; this.muerta = false; this.cola = [];
    this.proxOK = 0; this.llegan = []; this.movHasta = -1; this.proxMov = 0; this.plato = 'LIMPIO,1';
    this.otro = false; this.proxOtro = 0;   // otro = true: hay un gato que no está registrado
  }
  recibir(m) {
    if (this.muerta) return;
    const p = m.split(',');
    if (p[0] === 'REC') { this.despierta = true; this.rec = true; this.tRec = this.t; this.proxOK = this.t; }
    if (p[0] === 'FIN') this.rec = false;
    if (p[0] === 'REVISAR') this.cola.push({ t: this.t + 300, m: this.plato });
    if (p[0] === 'REG') this.cola.push({ t: this.t + 1000, m: `REGOK,${p[1]},30,0,0,0.4` });
    if (p[0] === 'CALPAPEL') this.cola.push({ t: this.t + 500, m: 'CALOK' });
  }
  llega(id, trasMs, quedaMs) { this.llegan.push({ id, tras: trasMs || 2000, queda: quedaMs || 3000 }); }
  mov(ms) { this.movHasta = this.t + ms; }
  tick(dt) {
    this.t += dt;
    if (this.muerta) return;
    if (this.despierta && this.t >= this.proxOK) { this.enviar('OK'); this.proxOK = this.t + 1000; }
    if (this.rec && this.llegan.length && this.t - this.tRec >= this.llegan[0].tras) {
      const g = this.llegan.shift();
      this.enviar(`GATO,${g.id},0.93`); this.movHasta = this.t + g.queda; this.tRec = this.t;
    }
    if (this.rec && this.otro && this.t >= this.proxOtro) { this.enviar('OTRO,0.40'); this.proxOtro = this.t + 2000; }
    if (this.t < this.movHasta && this.t >= this.proxMov) { this.enviar('MOV'); this.proxMov = this.t + 1000; }
    while (this.cola.length && this.cola[0].t <= this.t) this.enviar(this.cola.shift().m);
  }
}

// ---------- Invariantes ----------
const violaciones = [];
function vigilar(c, etiqueta) {
  const mueve = (x) => x === 'enrollar' || x === 'soltar';
  const v = (cond, txt) => { if (cond && violaciones.length < 50) violaciones.push(`${etiqueta}: ${txt} (estado ${c.estado})`); };
  v(c.hw.servo && (mueve(c.hw.m1) || mueve(c.hw.m2)), 'servo y motores del papel a la vez');
  v(c.estado === 'MANTENIMIENTO' && (c.hw.servo || mueve(c.hw.m1) || mueve(c.hw.m2)), 'actuador encendido en mantenimiento');
  v(c.hw.tolvaG < 0, 'tolva negativa');
  v((c.led().color === 'rojo') !== (c.estado === 'MANTENIMIENTO'), 'LED rojo sin mantenimiento o al revés');
  v(c.zumbador() && c.estado !== 'MANTENIMIENTO', 'zumbador fuera de mantenimiento');
  if (c.estado === 'RENOVACION' && c.gatoPresente() && c.hw.m2 === 'enrollar' && c.reloj.real - c.lastMovReal > 200 && process.env.DEPURAR && violaciones.length < 1) console.log('DEPURAR', c.detalle, '|', c.hw.motores, '|', c.reloj.real - c.lastMovReal, '|', c.eventos.slice(0, 6).map((e) => e.texto).join(' / '));
  v(c.estado === 'RENOVACION' && c.gatoPresente() && c.hw.m2 === 'enrollar' && c.reloj.real - c.lastMovReal > 200, 'papel moviéndose con el gato delante');
  v(c.hw.papelCiclos < 0 || c.hw.papelCiclos > CFG.ROLLO_CICLOS, 'ciclos de papel fuera de rango');
  v(c.hw.servo && c.estado !== 'DOSIFICACION', 'servo girando fuera de la dosificación');
  v(c.historial.some((h) => h.tipo === 'comida' && ![12, 24, 36, 48].includes(h.gramos)), 'ración que no es múltiplo de 12 g');
  // Modo libre: un gato nunca come dos veces dentro del intervalo
  const com = c.historial.filter((h) => h.tipo === 'comida' && h.gatoId);
  v(com.some((h, i) => /Modo libre/.test(h.modo) && com.slice(i + 1).some((o) => o.gatoId === h.gatoId && h.t - o.t < (c.config.libreIntervaloMin || 120) * 60000)), 'modo libre: un gato comió dos veces dentro del intervalo');
  v(c.eventos.some((e) => /Error interno/.test(e.texto)), 'error interno: ' + (c.eventos.find((e) => /Error interno/.test(e.texto)) || {}).texto);
}

// ---------- Utilidades ----------
function nuevo(opts) {
  opts = opts || {};
  const nube = nubeNueva();
  nube.gatos = (opts.gatos || [['Michi', 24], ['Luna', 36]]).map((g, i) => ({ id: i + 1, nombre: g[0], racionG: g[1] }));
  Object.assign(nube.config, opts.config || {});
  const d = new Date(); d.setHours(5, 0, 0, 0);
  const c = new Comedero({ nube, simInicio: d.getTime() });
  c.reloj.vel = opts.vel || 60;
  const cam = new CamFalsa();
  c.enviarUart = (m) => cam.recibir(m);
  cam.enviar = (m) => c.onUart(m);
  return { c, cam, nube };
}
async function correr(c, cam, seg, etiqueta, hasta) {
  for (let i = 0; i < seg * 20; i++) {
    c.tick(50); cam.tick(50);
    await new Promise((r) => setImmediate(r));
    vigilar(c, etiqueta || 'caso');
    if (hasta && hasta()) return true;
  }
  return false;
}
async function listo(etiqueta, opts) { const x = nuevo(opts); x.c.arrancar(); await correr(x.c, x.cam, 3, etiqueta); return x; }
const pulsar = async (c, cam, ms, et) => { c.pulsadorAbajo(); await correr(c, cam, ms / 1000, et); c.pulsadorArriba(); };
const comidas = (c) => c.historial.filter((h) => h.tipo === 'comida');
const omitidas = (c) => c.historial.filter((h) => h.tipo === 'omitida');
const enEspera = (c) => () => c.estado === 'ESPERA' && !c.ocupado && !c.cr;

const resultados = [];
async function caso(grupo, nombre, fn) {
  let ok = false, detalle = '';
  try { const r = await fn(); ok = r === true || (r && r.ok); detalle = (r && r.detalle) || ''; }
  catch (e) { ok = false; detalle = 'excepción: ' + e.message; }
  resultados.push({ grupo, nombre, ok, detalle });
  console.log(`${ok ? '  ✔' : '  ✘'} [${grupo}] ${nombre}${detalle ? ' — ' + detalle : ''}`);
}

(async () => {
  console.log('A. Configuración y reconocimiento (Tabla 4.5, Figura D.2)');
  for (const g of [12, 24, 36, 48]) {
    await caso('A', `Ración de ${g} g = ${g / 12} porciones`, async () => {
      const { c, cam } = await listo('A1', { gatos: [['Michi', g]] });
      cam.llega(1); c.irAlProximoHorario(); await correr(c, cam, 60, 'A1', () => comidas(c).length && enEspera(c)());
      const h = comidas(c)[0];
      return { ok: h && h.gramos === g && c.hw.entG === g, detalle: h ? `${h.gramos} g, ${c.hw.cavidad} vueltas` : 'sin comida' };
    });
  }
  await caso('A', '4 gatos llegan en otro orden: 4 comidas y 4 ciclos de papel', async () => {
    const { c, cam } = await listo('A2', { gatos: [['Michi', 24], ['Luna', 36], ['Tom', 12], ['Nala', 48]], vel: 120 });
    [3, 1, 4, 2].forEach((i) => cam.llega(i, 1500, 2000));
    c.irAlProximoHorario(); await correr(c, cam, 200, 'A2', () => comidas(c).length === 4 && enEspera(c)());
    return { ok: comidas(c).length === 4 && c.hw.papelCiclos === 90, detalle: comidas(c).map((h) => h.gato).reverse().join(' → ') };
  });
  await caso('A', 'La espera se pausa mientras come otro gato (3 gatos, espera 10 min)', async () => {
    const { c, cam } = await listo('A2b', { gatos: [['Michi', 24], ['Luna', 24], ['Tom', 24]], config: { esperaMin: 10, consumoSinGatoMin: 5 }, vel: 60 });
    cam.llega(1, 2000, 1000); cam.llega(2, 4000, 1000); cam.llega(3, 4000, 1000);
    c.irAlProximoHorario(); await correr(c, cam, 240, 'A2b', () => c.historial.length === 3 && enEspera(c)());
    return { ok: comidas(c).length === 3, detalle: `${comidas(c).length} comidas, ${omitidas(c).length} omitidas` };
  });
  await caso('A', 'Un gato que ya comió vuelve: se ignora', async () => {
    const { c, cam } = await listo('A3', { config: { esperaMin: 30 }, vel: 120 });
    cam.llega(1); cam.llega(1); cam.llega(2);
    c.irAlProximoHorario(); await correr(c, cam, 150, 'A3', () => comidas(c).length === 2 && enEspera(c)());
    return { ok: comidas(c).length === 2 && c.eventos.some((e) => /ya comió/.test(e.texto)), detalle: comidas(c).map((h) => h.gato).join(', ') };
  });
  for (const espera of [5, 60]) {
    await caso('A', `Ningún gato llega (espera ${espera} min): raciones omitidas`, async () => {
      const { c, cam } = await listo('A4', { config: { esperaMin: espera }, vel: 600 });
      c.irAlProximoHorario(); await correr(c, cam, espera * 0.1 + 20, 'A4', () => omitidas(c).length === 2);
      return { ok: omitidas(c).length === 2 && comidas(c).length === 0 && c.hw.tolvaG === 1200, detalle: `${omitidas(c).length} omitidas` };
    });
  }
  await caso('A', 'Llega uno y el otro no: 1 comida + 1 omitida', async () => {
    const { c, cam } = await listo('A5', { config: { esperaMin: 10 }, vel: 120 });
    cam.llega(2); c.irAlProximoHorario(); await correr(c, cam, 120, 'A5', () => omitidas(c).length === 1 && enEspera(c)());
    return { ok: comidas(c).length === 1 && omitidas(c).length === 1 && omitidas(c)[0].gato === 'Michi' };
  });
  for (const op of ['dosificar', 'no']) {
    await caso('A', `Cámara sin respuesta, opción "${op}"`, async () => {
      const { c, cam } = await listo('A6', { config: { siCamaraFalla: op } });
      cam.muerta = true; c.irAlProximoHorario(); await correr(c, cam, 60, 'A6', () => omitidas(c).length === 2 && enEspera(c)());
      const n = comidas(c).length;
      return { ok: c.activa('camara') && (op === 'dosificar' ? n === 1 && /defecto/.test(comidas(c)[0].modo) : n === 0), detalle: `${n} raciones por defecto` };
    });
  }
  await caso('A', 'La cámara deja de responder a mitad del reconocimiento', async () => {
    const { c, cam } = await listo('A8', { config: { siCamaraFalla: 'no' } });
    c.irAlProximoHorario(); await correr(c, cam, 6, 'A8'); cam.muerta = true;
    await correr(c, cam, 20, 'A8', () => c.activa('camara'));
    return { ok: c.activa('camara') && comidas(c).length === 0 };
  });
  await caso('A', 'La cámara vuelve: la alerta se resuelve sola', async () => {
    const { c, cam } = await listo('A8b', { config: { siCamaraFalla: 'no' } });
    cam.muerta = true; c.irAlProximoHorario(); await correr(c, cam, 15, 'A8b', () => c.activa('camara'));
    cam.muerta = false; cam.despierta = true; await correr(c, cam, 3, 'A8b');
    return { ok: !c.activa('camara') };
  });
  await caso('A', 'Horarios pausados durante el primer uso', async () => {
    const { c, cam } = await listo('A9', { config: { horariosActivos: false } });
    c.irAlProximoHorario(); await correr(c, cam, 10, 'A9');
    return { ok: c.estado === 'ESPERA' && !c.historial.length };
  });
  await caso('A', '6 horarios en un día: se atienden todos', async () => {
    const { c, cam } = await listo('A10', { gatos: [['Michi', 12]], config: { horarios: ['06:00', '09:00', '12:00', '15:00', '18:00', '21:00'], esperaMin: 30, consumoSinGatoMin: 1 }, vel: 120 });
    for (let i = 0; i < 6; i++) cam.llega(1, 1500, 500);
    let n = 0;
    for (let i = 0; i < 6; i++) { c.irAlProximoHorario(); await correr(c, cam, 40, 'A10', () => comidas(c).length > n && enEspera(c)()); n = comidas(c).length; }
    return { ok: comidas(c).length === 6, detalle: `${comidas(c).length} comidas` };
  });
  await caso('A', 'Horario llega con un ciclo en curso: queda en cola', async () => {
    const { c, cam } = await listo('A11', { gatos: [['Michi', 24]], vel: 60 });
    await pulsar(c, cam, 150, 'A11'); await correr(c, cam, 4, 'A11');
    c.irAlProximoHorario(); cam.llega(1);
    await correr(c, cam, 90, 'A11', () => comidas(c).length === 2 && enEspera(c)());
    return { ok: comidas(c).length === 2 && comidas(c).some((h) => h.modo === 'Ciclo rápido'), detalle: comidas(c).map((h) => h.modo).join(' / ') };
  });
  await caso('A', 'Horario en mantenimiento: raciones omitidas', async () => {
    const { c, cam } = await listo('A12');
    c.llenarTacho(); await correr(c, cam, 1, 'A12');
    c.irAlProximoHorario(); await correr(c, cam, 3, 'A12');
    return { ok: omitidas(c).length === 2 && comidas(c).length === 0 };
  });
  await caso('A', 'Sin gatos registrados: ración por defecto y aviso', async () => {
    const { c, cam } = await listo('A13', { gatos: [] });
    c.irAlProximoHorario(); await correr(c, cam, 40, 'A13', () => comidas(c).length === 1 && enEspera(c)());
    return { ok: comidas(c).length === 1 && c.activa('sin_gatos') };
  });

  console.log('B. Dosificación (Figura 4.19, Tabla 4.6)');
  await caso('B', 'Atasco en la 2.ª porción: mantenimiento, 1 porción entregada', async () => {
    const { c, cam } = await listo('B1', { gatos: [['Michi', 36]] });
    cam.llega(1); c.irAlProximoHorario();
    await correr(c, cam, 30, 'B1', () => c.hw.k === 1); c.fallas.atascoDisco = true;
    await correr(c, cam, 10, 'B1', () => c.estado === 'MANTENIMIENTO');
    return { ok: c.estado === 'MANTENIMIENTO' && c.activa('atasco_disco') && c.hw.entG === 12, detalle: `entregado ${c.hw.entG} g` };
  });
  await caso('B', 'Atasco que se suelta en el reintento: ración completa', async () => {
    const { c, cam } = await listo('B2', { gatos: [['Michi', 24]] });
    c.fallas.atascoDisco = true; await pulsar(c, cam, 150, 'B2'); await correr(c, cam, 3.5, 'B2');
    await correr(c, cam, 1.5, 'B2'); c.fallas.atascoDisco = false;
    await correr(c, cam, 40, 'B2', () => comidas(c).length === 1);
    return { ok: comidas(c).length === 1 && c.estado !== 'MANTENIMIENTO' && c.eventos.some((e) => /se reintenta/.test(e.texto)) };
  });
  await caso('B', 'Arco de croquetas que se deshace en el reintento', async () => {
    const { c, cam } = await listo('B3', { gatos: [['Michi', 12]] });
    c.fallas.arco = true; await pulsar(c, cam, 150, 'B3'); await correr(c, cam, 4.5, 'B3'); c.fallas.arco = false;
    await correr(c, cam, 40, 'B3', () => comidas(c).length === 1);
    return { ok: comidas(c).length === 1 && c.estado !== 'MANTENIMIENTO' };
  });
  await caso('B', 'La tolva se vacía a mitad de una ración de 48 g', async () => {
    const { c, cam } = await listo('B4', { gatos: [['Michi', 48]] });
    c.hw.tolvaG = 25; cam.llega(1); c.irAlProximoHorario();
    await correr(c, cam, 40, 'B4', () => c.estado === 'MANTENIMIENTO');
    return { ok: c.estado === 'MANTENIMIENTO' && c.activa('sin_caida') && c.hw.tolvaG >= 0, detalle: `quedan ${c.hw.tolvaG} g, entregado ${c.hw.entG} g` };
  });
  await caso('B', 'Alimento bajo: aviso pero sigue dosificando', async () => {
    const { c, cam } = await listo('B5', { gatos: [['Michi', 24]] });
    c.hw.tolvaG = 320; cam.llega(1); c.irAlProximoHorario();
    await correr(c, cam, 40, 'B5', () => comidas(c).length === 1 && enEspera(c)());
    return { ok: c.activa('alimento_bajo') && comidas(c).length === 1 && c.led().color === 'amarillo' };
  });
  await caso('B', 'Sensor de nivel desajustado: aviso de inventario', async () => {
    const { c, cam } = await listo('B6', { gatos: [['Michi', 48]], vel: 120 });
    c.hw.tolvaG = 700; c.hw.m0G = 700; c.fallas.inventario = true; cam.llega(1); c.irAlProximoHorario();
    await correr(c, cam, 40, 'B6', () => comidas(c).length === 1);
    return { ok: c.activa('inventario') };
  });
  await caso('B', 'Rellenar la tolva borra los avisos', async () => {
    const { c, cam } = await listo('B7');
    c.alerta('alimento_bajo', 'aviso'); c.alerta('inventario', 'aviso'); c.rellenarTolva(); await correr(c, cam, 1, 'B7');
    return { ok: !c.activa('alimento_bajo') && !c.activa('inventario') && c.hw.tolvaG === 1200 };
  });

  console.log('C. Papel (Capítulo 5, Tabla 5.10)');
  await caso('C', 'Aviso del rollo al bajar a 22 ciclos', async () => {
    const { c, cam } = await listo('C1', { gatos: [['Michi', 12]] });
    c.hw.papelCiclos = 23; await pulsar(c, cam, 150, 'C1');
    await correr(c, cam, 40, 'C1', () => comidas(c).length === 1 && enEspera(c)());
    return { ok: c.hw.papelCiclos === 22 && c.activa('rollo'), detalle: c.alertas[0] && c.alertas[0].texto };
  });
  await caso('C', 'El papel se acaba en la presentación', async () => {
    const { c, cam } = await listo('C2', { gatos: [['Michi', 12]] });
    await pulsar(c, cam, 150, 'C2'); await correr(c, cam, 30, 'C2', () => c.estado === 'PRESENTACION'); c.hw.papelCiclos = 0;
    await correr(c, cam, 3, 'C2');
    return { ok: c.estado === 'MANTENIMIENTO' && c.activa('fin_papel') };
  });
  await caso('C', 'Atasco del papel en la renovación', async () => {
    const { c, cam } = await listo('C3', { gatos: [['Michi', 12]], vel: 300 });
    await pulsar(c, cam, 150, 'C3'); await correr(c, cam, 40, 'C3', () => c.estado === 'RENOVACION'); c.fallas.atascoPapel = true;
    await correr(c, cam, 2, 'C3');
    return { ok: c.estado === 'MANTENIMIENTO' && c.activa('atasco_papel') };
  });
  await caso('C', 'El gato vuelve 3 veces durante la renovación', async () => {
    const { c, cam } = await listo('C4', { gatos: [['Michi', 12]], vel: 300 });
    await pulsar(c, cam, 150, 'C4'); await correr(c, cam, 40, 'C4', () => c.estado === 'RENOVACION');
    let frenos = 0, antes = false;
    for (let i = 0; i < 3; i++) {
      cam.mov(1500);
      for (let k = 0; k < 160; k++) { c.tick(50); cam.tick(50); await new Promise((r) => setImmediate(r)); vigilar(c, 'C4'); const f = /Frenados/.test(c.hw.motores); if (f && !antes) frenos++; antes = f; }
    }
    await correr(c, cam, 20, 'C4', enEspera(c));
    return { ok: frenos === 3 && c.hw.papelCiclos === 93, detalle: `${frenos} frenadas` };
  });
  await caso('C', 'El gato no se va: el consumo termina a los 60 min', async () => {
    const { c, cam } = await listo('C5', { gatos: [['Michi', 12]], vel: 300 });
    await pulsar(c, cam, 150, 'C5'); await correr(c, cam, 30, 'C5', () => c.estado === 'CONSUMO');
    const t0 = c.reloj.sim; cam.mov(15000);
    await correr(c, cam, 20, 'C5', () => c.estado !== 'CONSUMO');
    const min = (c.reloj.sim - t0) / 60000;
    return { ok: min >= 59 && min <= 62, detalle: `${min.toFixed(1)} min` };
  });
  for (const m of [1, 5, 10]) {
    await caso('C', `Consumo termina ${m} min después de que el gato se va`, async () => {
      const { c, cam } = await listo('C6', { gatos: [['Michi', 12]], config: { consumoSinGatoMin: m }, vel: 60 });
      await pulsar(c, cam, 150, 'C6'); await correr(c, cam, 30, 'C6', () => c.estado === 'CONSUMO');
      const t0 = c.reloj.sim; await correr(c, cam, m * 1.2 + 5, 'C6', () => c.estado !== 'CONSUMO');
      const min = (c.reloj.sim - t0) / 60000;
      return { ok: min >= m - 0.2 && min <= m + 0.5, detalle: `${min.toFixed(1)} min` };
    });
  }
  await caso('C', 'Cambio de rollo con papel flojo: aviso de la cinta guía', async () => {
    const { c, cam } = await listo('C7');
    c.fallas.papelFlojo = true; c.ponerRollo(); await correr(c, cam, 5, 'C7');
    return { ok: c.activa('papel_flojo') };
  });
  await caso('C', 'Cambio de rollo normal: primera renovación', async () => {
    const { c, cam } = await listo('C7b');
    c.hw.papelCiclos = 3; c.ponerRollo(); await correr(c, cam, 15, 'C7b', enEspera(c));
    return { ok: c.hw.papelCiclos === 94 && c.eventos.some((e) => /Tensar_Papel/.test(e.texto)) };
  });
  await caso('C', 'Corte de energía durante el consumo: al encender renueva', async () => {
    const { c, cam } = await listo('C8', { gatos: [['Michi', 12]] });
    await pulsar(c, cam, 150, 'C8'); await correr(c, cam, 30, 'C8', () => c.estado === 'CONSUMO');
    c.corteEnergia(); await correr(c, cam, 20, 'C8', () => c.estado === 'ESPERA' && !c.ocupado && c.hw.comidaPos === null);
    return { ok: c.hw.comidaPos === null && c.hw.papelCiclos === 93 && c.eventos.some((e) => /Ciclo sin terminar/.test(e.texto)) };
  });

  console.log('D. Tacho de residuos (Capítulo 6)');
  await caso('D', 'Los restos llenan el tacho: mantenimiento', async () => {
    const { c, cam, nube } = await listo('D1', { gatos: [['Michi', 48]], config: { consumoSinGatoMin: 1 }, vel: 600 });
    cam.plato = 'RESTOS,12'; c.hw.tachoG = 130;
    for (let i = 0; i < 3 && c.estado !== 'MANTENIMIENTO'; i++) { const n0 = comidas(c).length; nube.comandos.push({ tipo: 'servir', porciones: 4 }); await correr(c, cam, 60, 'D1', () => (comidas(c).length > n0 && enEspera(c)()) || c.estado === 'MANTENIMIENTO'); }
    return { ok: c.estado === 'MANTENIMIENTO' && c.activa('tacho_lleno'), detalle: `${c.hw.tachoG} g` };
  });
  await caso('D', 'Recordatorio del tacho a los 7 días', async () => {
    const { c, cam } = await listo('D2');
    c.saltarDias(7); await correr(c, cam, 1, 'D2');
    return { ok: c.activa('tacho_recordatorio') && c.led().color === 'amarillo' };
  });
  await caso('D', 'Confirmar con el tacho lleno no sale; vaciarlo sí', async () => {
    const { c, cam } = await listo('D3');
    c.llenarTacho(); await correr(c, cam, 1, 'D3'); c.confirmar('prueba'); const sigue = c.estado === 'MANTENIMIENTO';
    c.vaciarTacho(); await correr(c, cam, 1, 'D3');
    return { ok: sigue && c.estado === 'ESPERA' };
  });

  console.log('E. Panel: pulsador, LED RGB y zumbador (Tabla 7.7)');
  await caso('E', '5 pulsaciones cortas = máximo 4 porciones', async () => {
    const { c, cam } = await listo('E1', { gatos: [['Michi', 12]] });
    for (let i = 0; i < 5; i++) { await pulsar(c, cam, 120, 'E1'); await correr(c, cam, 0.3, 'E1'); }
    const n = c.cr && c.cr.porciones; await correr(c, cam, 60, 'E1', () => comidas(c).length === 1 && enEspera(c)());
    return { ok: n === 4 && comidas(c)[0].gramos === 48, detalle: `${comidas(c)[0] && comidas(c)[0].gramos} g` };
  });
  await caso('E', 'Pulsación corta en mantenimiento: ignorada', async () => {
    const { c, cam } = await listo('E2');
    c.llenarTacho(); await correr(c, cam, 1, 'E2'); await pulsar(c, cam, 150, 'E2'); await correr(c, cam, 4, 'E2');
    return { ok: !c.cr && !comidas(c).length && c.estado === 'MANTENIMIENTO' };
  });
  await caso('E', 'Pulsación corta con un ciclo en curso: ignorada', async () => {
    const { c, cam } = await listo('E3', { gatos: [['Michi', 12]] });
    await pulsar(c, cam, 150, 'E3'); await correr(c, cam, 4, 'E3'); await pulsar(c, cam, 150, 'E3');
    await correr(c, cam, 40, 'E3', () => comidas(c).length && enEspera(c)());
    return { ok: comidas(c).length === 1 && c.eventos.some((e) => /hay un ciclo en curso/.test(e.texto)) };
  });
  await caso('E', 'Colores del LED RGB en cada situación', async () => {
    const { c, cam } = await listo('E4', { gatos: [['Michi', 12]] });
    const vistos = [];
    vistos.push(c.led().color);                                      // verde
    c.pulsadorAbajo(); c.tick(50); c.pulsadorArriba(); vistos.push(c.led().color); // blanco
    await correr(c, cam, 1, 'E4'); vistos.push(c.led().color);       // azul (ciclo rápido)
    await correr(c, cam, 40, 'E4', () => enEspera(c)());
    c.fallas.sinInternet = true; await correr(c, cam, 1.5, 'E4'); vistos.push(c.led().color + (c.led().parpadeo ? '*' : ''));
    c.fallas.sinInternet = false; c.alerta('rollo', 'aviso'); await correr(c, cam, 1.5, 'E4'); vistos.push(c.led().color);
    c.llenarTacho(); await correr(c, cam, 0.5, 'E4'); vistos.push(c.led().color + (c.led().parpadeo ? '*' : ''));
    const esp = ['verde', 'blanco', 'azul', 'azul*', 'amarillo', 'rojo*'];
    return { ok: JSON.stringify(vistos) === JSON.stringify(esp), detalle: vistos.join(' → ') };
  });
  await caso('E', 'Zumbador: suena en mantenimiento y se silencia con la pulsación larga', async () => {
    const { c, cam } = await listo('E5');
    c.llenarTacho(); await correr(c, cam, 0.5, 'E5'); const suena = c.zumbador();
    await pulsar(c, cam, 3300, 'E5');
    return { ok: suena && !c.zumbador() && c.estado === 'MANTENIMIENTO' };
  });

  console.log('F. Órdenes de la app y nube (Tabla 7.6)');
  await caso('F', '"Servir ahora" en mantenimiento: ignorado', async () => {
    const { c, cam, nube } = await listo('F1');
    c.llenarTacho(); await correr(c, cam, 1, 'F1'); nube.comandos.push({ tipo: 'servir', porciones: 2 }); await correr(c, cam, 5, 'F1');
    return { ok: !comidas(c).length && c.eventos.some((e) => /ignorada: equipo en mantenimiento/.test(e.texto)) };
  });
  await caso('F', '"Ya lo resolví" desde la app sale del mantenimiento', async () => {
    const { c, cam, nube } = await listo('F2');
    c.mantenimiento('atasco_disco'); nube.comandos.push({ tipo: 'confirmar' }); await correr(c, cam, 2, 'F2');
    return { ok: c.estado === 'ESPERA' && !c.activa('atasco_disco') };
  });
  await caso('F', 'Sin internet: lo que pasa se sube al reconectar', async () => {
    const { c, cam, nube } = await listo('F3', { gatos: [['Michi', 12]] });
    c.fallas.sinInternet = true; await correr(c, cam, 2, 'F3');
    await pulsar(c, cam, 150, 'F3'); await correr(c, cam, 40, 'F3', () => comidas(c).length && enEspera(c)());
    c.saltarDias(7); await correr(c, cam, 2, 'F3');
    const antes = nube.historial.length;
    c.fallas.sinInternet = false; await correr(c, cam, 2, 'F3');
    return { ok: antes === 0 && nube.historial.length === 1 && nube.alertas.some((a) => a.tipo === 'tacho_recordatorio'), detalle: c.eventos.find((e) => /Conexión recuperada/.test(e.texto)).texto };
  });
  await caso('F', 'La app cambia los horarios y el comedero los usa', async () => {
    const { c, cam, nube } = await listo('F4');
    nube.config.horarios = ['05:30']; await correr(c, cam, 2, 'F4'); cam.llega(1); cam.llega(2);
    await correr(c, cam, 40, 'F4', () => c.historial.length > 0);
    return { ok: c.config.horarios[0] === '05:30' && c.historial.some((h) => h.horario === '05:30') };
  });
  await caso('F', '"Entendido" desde la app cierra un aviso', async () => {
    const { c, cam, nube } = await listo('F5');
    c.alerta('rollo', 'aviso'); nube.comandos.push({ tipo: 'resolverAviso', alerta: 'rollo' }); await correr(c, cam, 2, 'F5');
    return { ok: !c.activa('rollo') };
  });

  console.log('H. Modo libre (sirve cuando llega el gato) y prueba de reconocimiento');
  const LIBRE = { modo: 'libre', libreIntervaloMin: 120, libreMaxDia: 4 };
  const visitas = (c) => c.historial.filter((h) => h.tipo === 'visita');
  const llegaLibre = (cam, id) => { cam.llega(id, 1500, 2500); cam.mov(1500); };
  await caso('H', 'Llega Michi: el PIR despierta la cámara, lo reconoce y sirve su ración', async () => {
    const { c, cam } = await listo('H1', { gatos: [['Michi', 24]], config: LIBRE });
    llegaLibre(cam, 1); await correr(c, cam, 60, 'H1', () => comidas(c).length && enEspera(c)());
    const h = comidas(c)[0];
    return { ok: h && h.gato === 'Michi' && h.gramos === 24 && /Modo libre/.test(h.modo) && c.uart.some((u) => u.msg === 'REC'), detalle: h ? `${h.gato} ${h.gramos} g · ${h.modo}` : 'sin comida' };
  });
  await caso('H', 'Michi vuelve antes de 2 h: no se sirve y la visita se cuenta una sola vez', async () => {
    const { c, cam } = await listo('H2', { gatos: [['Michi', 24]], config: LIBRE, vel: 60 });
    llegaLibre(cam, 1); await correr(c, cam, 60, 'H2', () => comidas(c).length && enEspera(c)());
    for (let i = 0; i < 3; i++) { await correr(c, cam, 31, 'H2'); llegaLibre(cam, 1); await correr(c, cam, 6, 'H2', () => visitas(c).length && (visitas(c)[0].veces || 1) > i); }
    const v = visitas(c)[0];
    return { ok: comidas(c).length === 1 && visitas(c).length === 1 && v.veces === 3 && /ya comió/.test(v.modo), detalle: v ? `${v.veces} visitas: ${v.detalle}` : 'sin visita' };
  });
  await caso('H', 'Pasado el intervalo, Michi vuelve a comer', async () => {
    const { c, cam } = await listo('H3', { gatos: [['Michi', 24]], config: LIBRE });
    llegaLibre(cam, 1); await correr(c, cam, 60, 'H3', () => comidas(c).length && enEspera(c)());
    c.reloj.saltar(121 * 60000); await correr(c, cam, 31, 'H3');
    llegaLibre(cam, 1); await correr(c, cam, 60, 'H3', () => comidas(c).length === 2 && enEspera(c)());
    return { ok: comidas(c).length === 2 && !visitas(c).length };
  });
  await caso('H', 'Tope diario: con máximo 2 al día, la 3.ª vez no se sirve', async () => {
    const { c, cam } = await listo('H4', { gatos: [['Michi', 12]], config: { modo: 'libre', libreIntervaloMin: 30, libreMaxDia: 2 } });
    for (let i = 0; i < 3; i++) {
      llegaLibre(cam, 1); await correr(c, cam, 60, 'H4', () => (comidas(c).length > i || visitas(c).length) && enEspera(c)());
      c.reloj.saltar(31 * 60000); await correr(c, cam, 31, 'H4');
    }
    const v = visitas(c)[0];
    return { ok: comidas(c).length === 2 && v && /veces hoy/.test(v.modo), detalle: v && v.modo };
  });
  await caso('H', 'Un gato no registrado: no se sirve y queda la visita', async () => {
    const { c, cam } = await listo('H5', { gatos: [['Michi', 24]], config: LIBRE });
    cam.otro = true; cam.mov(1500); await correr(c, cam, 30, 'H5', () => visitas(c).length && enEspera(c)());
    const v = visitas(c)[0];
    return { ok: !comidas(c).length && v && v.gatoId === 0 && c.hw.tolvaG === 1200, detalle: v && v.modo };
  });
  await caso('H', 'Movimiento sin gato (una persona): no sirve y la cámara se calma 30 s', async () => {
    const { c, cam } = await listo('H6', { gatos: [['Michi', 24]], config: LIBRE });
    cam.mov(1500); await correr(c, cam, 40, 'H6', () => c.eventos.some((e) => /no vio a ningún gato/.test(e.texto)));
    const recs = () => c.uart.filter((u) => u.msg === 'REC').reduce((a, u) => a + (u.n || 1), 0);
    const r0 = recs(); cam.mov(1500); await correr(c, cam, 5, 'H6');
    return { ok: !comidas(c).length && recs() === r0 && c.hw.tolvaG === 1200, detalle: `REC enviados: ${r0}` };
  });
  await caso('H', 'Cámara sin respuesta en modo libre: alerta y no sirve', async () => {
    const { c, cam } = await listo('H7', { gatos: [['Michi', 24]], config: LIBRE });
    cam.muerta = true; c.lastMovReal = c.reloj.real; await correr(c, cam, 10, 'H7', () => c.activa('camara') && enEspera(c)());
    return { ok: c.activa('camara') && !comidas(c).length };
  });
  await caso('H', 'En modo libre no se disparan los horarios', async () => {
    const { c, cam } = await listo('H8', { config: LIBRE });
    c.irAlProximoHorario(); await correr(c, cam, 10, 'H8');
    return { ok: c.estado === 'ESPERA' && !c.historial.length };
  });
  await caso('H', 'Modo libre pausado durante el primer uso', async () => {
    const { c, cam } = await listo('H9', { config: Object.assign({ horariosActivos: false }, LIBRE) });
    llegaLibre(cam, 1); await correr(c, cam, 10, 'H9');
    return { ok: c.estado === 'ESPERA' && !c.historial.length && !c.uart.some((u) => u.msg === 'REC' && u.t > c.reloj.sim - 9 * 60000 * 1) };
  });
  await caso('H', 'Dos gatos en modo libre: cada uno come su ración', async () => {
    const { c, cam } = await listo('H10', { config: LIBRE });
    llegaLibre(cam, 1); await correr(c, cam, 60, 'H10', () => comidas(c).length === 1 && enEspera(c)());
    await correr(c, cam, 6, 'H10');
    llegaLibre(cam, 2); await correr(c, cam, 60, 'H10', () => comidas(c).length === 2 && enEspera(c)());
    return { ok: comidas(c).map((h) => h.gato + ' ' + h.gramos).reverse().join(', ') === 'Michi 24, Luna 36', detalle: comidas(c).map((h) => h.gato + ' ' + h.gramos + ' g').reverse().join(', ') };
  });
  await caso('H', 'El pulsador y "Servir ahora" siguen funcionando en modo libre', async () => {
    const { c, cam, nube } = await listo('H11', { gatos: [['Michi', 24]], config: LIBRE });
    await pulsar(c, cam, 150, 'H11'); await correr(c, cam, 40, 'H11', () => comidas(c).length && enEspera(c)());
    nube.comandos.push({ tipo: 'servir', porciones: 2 }); await correr(c, cam, 40, 'H11', () => comidas(c).length === 2 && enEspera(c)());
    return { ok: comidas(c).length === 2 && comidas(c).every((h) => h.modo === 'Ciclo rápido') };
  });
  await caso('H', '"Probar reconocimiento": reconoce a Michi y no sirve comida', async () => {
    const { c, cam, nube } = await listo('H12', { gatos: [['Michi', 24]] });
    nube.comandos.push({ tipo: 'probar' }); cam.llega(1, 1500, 500);
    await correr(c, cam, 30, 'H12', () => c.prueba && c.prueba.estado === 'listo' && enEspera(c)());
    await correr(c, cam, 1.5, 'H12');   // la app lo ve en la siguiente sincronización
    return { ok: c.prueba.resultado === 'gato' && c.prueba.nombre === 'Michi' && !comidas(c).length && c.hw.tolvaG === 1200 && nube.estado.prueba.nombre === 'Michi', detalle: JSON.stringify(c.prueba) };
  });
  await caso('H', '"Probar reconocimiento" con un gato no registrado y sin nadie', async () => {
    const { c, cam, nube } = await listo('H13', { gatos: [['Michi', 24]] });
    cam.otro = true; nube.comandos.push({ tipo: 'probar' });
    await correr(c, cam, 30, 'H13', () => c.prueba && c.prueba.estado === 'listo');
    const r1 = c.prueba.resultado; cam.otro = false; await correr(c, cam, 2, 'H13', enEspera(c));
    nube.comandos.push({ tipo: 'probar' }); await correr(c, cam, 1.5, 'H13');
    await correr(c, cam, 40, 'H13', () => c.prueba && c.prueba.estado === 'listo');
    return { ok: r1 === 'otro' && c.prueba.resultado === 'nadie', detalle: r1 + ' / ' + c.prueba.resultado };
  });
  await caso('H', '"Probar reconocimiento" en mantenimiento: avisa que no puede', async () => {
    const { c, cam, nube } = await listo('H14');
    c.llenarTacho(); await correr(c, cam, 1, 'H14'); nube.comandos.push({ tipo: 'probar' }); await correr(c, cam, 2, 'H14');
    return { ok: c.prueba && c.prueba.resultado === 'ocupado' && c.estado === 'MANTENIMIENTO' };
  });
  await caso('H', '"Volver a la hora real" con el reloj adelantado: el historial sigue en orden', async () => {
    const { c, cam } = await listo('H16', { gatos: [['Michi', 24]], config: LIBRE, vel: 60 });
    llegaLibre(cam, 1); await correr(c, cam, 60, 'H16', () => comidas(c).length && enEspera(c)());
    // El reloj simulado quedó 10 h adelantado respecto a la hora real
    const ahora = c.reloj.sim; c.adelantarMin(600);
    const h = comidas(c)[0], gap = c.reloj.sim - h.t;
    c.alinearConHoraReal(ahora);
    return { ok: c.reloj.vel === 1 && c.reloj.sim === ahora && ahora - h.t === gap && h.t < ahora && c.resumen().diasTacho >= 0 && !c.eventos.some((e) => e.t > ahora), detalle: `la comida sigue ${Math.round(gap / 60000)} min antes de "ahora" y nada quedó en el futuro` };
  });
  await caso('H', '"Ver a mi gato": enciende la cámara 60 s, también en mantenimiento, y se apaga sola', async () => {
    const { c, cam, nube } = await listo('H17');
    c.llenarTacho(); await correr(c, cam, 1, 'H17');
    nube.comandos.push({ tipo: 'ver', seg: 60 }); await correr(c, cam, 2, 'H17');
    const ver = c.uart.some((u) => u.msg === 'VER'), cuenta = nube.estado.viendo;
    await correr(c, cam, 60, 'H17');
    const apagada = c.uart.some((u) => u.msg === 'NOVER') && c.resumen().viendo === 0;
    nube.comandos.push({ tipo: 'ver' }); await correr(c, cam, 2, 'H17'); nube.comandos.push({ tipo: 'nover' }); await correr(c, cam, 2, 'H17');
    return { ok: ver && cuenta >= 57 && cuenta <= 60 && apagada && c.resumen().viendo === 0 && c.estado === 'MANTENIMIENTO', detalle: `VER enviado, cuenta ${cuenta} s, se apagó sola y con "Cerrar"` };
  });
  await caso('H', 'Registro fallido (la cámara casi no vio al gato): la app recibe el aviso', async () => {
    const { c, cam, nube } = await listo('H18');
    c.onUart('REGMAL,1,4'); await correr(c, cam, 1.5, 'H18');
    const e = nube.instalacion.regError;
    return { ok: e && e.id === 1 && e.n === 4 && c.eventos.some((x) => /fallido/.test(x.texto)) };
  });
  await caso('H', 'Gato frente a la comida todo el rato: el ciclo espera; "Ya terminó de comer" lo destraba', async () => {
    const { c, cam, nube } = await listo('H19', { vel: 1 });
    await pulsar(c, cam, 150, 'H19'); await correr(c, cam, 25, 'H19', () => c.estado === 'CONSUMO');
    cam.mov(20000); await correr(c, cam, 15, 'H19');
    const espera = c.estado === 'CONSUMO' && /sigue frente a la comida/.test(c.detalle);
    cam.movHasta = -1; await correr(c, cam, 5, 'H19');
    const cuenta = /se limpia en \d:\d\d/.test(c.detalle);
    nube.comandos.push({ tipo: 'terminoComer' });
    await correr(c, cam, 40, 'H19', () => c.estado === 'ESPERA' && !c.ocupado);
    const h = comidas(c)[0];
    return { ok: espera && cuenta && c.estado === 'ESPERA' && h && h.gramos === 12 && c.eventos.some((e) => /terminó de comer/.test(e.texto)), detalle: `esperaba: ${espera} · cuenta regresiva: ${cuenta} · terminó sin esperar los 5 min` };
  });
  await caso('H', 'Días de alimento y papel según el modo', async () => {
    const { c, cam } = await listo('H15', { gatos: [['Michi', 24]], config: { modo: 'libre', libreIntervaloMin: 180, libreMaxDia: 6 } });
    const libre = c.comidasPorDia(); c.config.modo = 'horario'; const hor = c.comidasPorDia();
    return { ok: libre === 6 && hor === 3, detalle: `libre ${libre}/día, horarios ${hor}/día` };
  });

  // ---------------- I. Lo que encontró Franco al usarla (v10) ----------------
  console.log('I. Casos encontrados al usarla (v10)');
  await caso('I', 'Pulsador durante un ciclo: se ignora y deja el motivo para mostrarlo', async () => {
    const { c, cam } = await listo('I1', { vel: 1 });
    await pulsar(c, cam, 120, 'I1'); await correr(c, cam, 25, 'I1', () => c.estado === 'CONSUMO');
    await pulsar(c, cam, 120, 'I1');
    const a = c.avisoPulsador;
    return { ok: c.estado === 'CONSUMO' && a && /ciclo en curso/.test(a.texto) && /Ya terminó de comer/.test(a.texto), detalle: a ? a.texto : 'sin aviso' };
  });
  await caso('I', 'Pulsador en mantenimiento: dice cómo salir', async () => {
    const { c, cam } = await listo('I2');
    c.fallas.atascoDisco = true; await pulsar(c, cam, 120, 'I2'); await correr(c, cam, 30, 'I2', () => c.estado === 'MANTENIMIENTO');
    await pulsar(c, cam, 120, 'I2');
    return { ok: c.avisoPulsador && /mantenimiento/.test(c.avisoPulsador.texto) && /3 s/.test(c.avisoPulsador.texto) };
  });
  await caso('I', 'Atasco del papel con comida encima → "Ya lo resolví" renueva el papel (no queda comida vieja)', async () => {
    const { c, cam, nube } = await listo('I3');
    await pulsar(c, cam, 120, 'I3'); await correr(c, cam, 20, 'I3', () => c.estado === 'PRESENTACION');
    c.fallas.atascoPapel = true; await correr(c, cam, 30, 'I3', () => c.estado === 'MANTENIMIENTO');
    const conComida = c.hw.comidaPos !== null && c.cicloEnCurso;
    c.fallas.atascoPapel = false; nube.comandos.push({ tipo: 'confirmar' });
    const renovo = await correr(c, cam, 10, 'I3', () => c.estado === 'RENOVACION');
    await correr(c, cam, 40, 'I3', enEspera(c));
    const h = comidas(c)[0];
    return { ok: conComida && renovo && c.hw.comidaPos === null && !c.cicloEnCurso && h && h.restos === 'interrumpida', detalle: `comida encima: ${conComida} · renovó: ${renovo} · historial: ${h && h.restos}` };
  });
  await caso('I', 'Al recargar, las fallas simuladas no vuelven (Sin internet, atascos…)', async () => {
    const { c } = await listo('I4');
    Object.keys(c.fallas).forEach((k) => { c.fallas[k] = true; });
    const guardado = JSON.parse(JSON.stringify(c.exportar()));
    const { c: c2 } = nuevo(); c2.importar(guardado);
    return { ok: Object.values(c2.fallas).every((v) => v === false) };
  });
  await caso('I', 'Comidas viejas sin revisar no quedan en "comiendo…" al recargar', async () => {
    const { c } = await listo('I5');
    c.historial = [{ tipo: 'comida', gramos: 12, restos: null, t: c.reloj.sim }, { tipo: 'comida', gramos: 24, restos: null, t: c.reloj.sim - 1000 }];
    const g = JSON.parse(JSON.stringify(c.exportar())); g.cicloEnCurso = false;
    const { c: c2 } = nuevo(); c2.importar(g);
    return { ok: c2.historial.every((h) => h.restos === 'interrumpida') };
  });
  await caso('I', 'Un error interno en el bucle no corta la conexión con la app', async () => {
    const { c, cam, nube } = await listo('I6');
    const orig = c.revisarTacho.bind(c); let n = 0;
    c.revisarTacho = () => { n++; if (n < 40) throw new Error('prueba'); return orig(); };
    const s0 = nube.ultimaSync;
    for (let i = 0; i < 60; i++) { c.tick(50); cam.tick(50); await new Promise((r) => setImmediate(r)); }   // sin vigilar: el error es a propósito
    const sigue = nube.ultimaSync !== s0;
    c.revisarTacho = orig; c.eventos = c.eventos.filter((e) => !/Error interno/.test(e.texto));
    return { ok: sigue, detalle: `sincronizó: ${sigue}` };
  });
  await caso('I', 'Horarios vacíos o mal escritos no rompen nada', async () => {
    const { c, cam, nube } = await listo('I7');
    nube.config.horarios = ['07:00', '', null, '25', '13:00'];
    await correr(c, cam, 3, 'I7');
    return { ok: !c.eventos.some((e) => /Error interno/.test(e.texto)) && c.estado === 'ESPERA' };
  });
  await caso('I', 'Rollo nuevo en mantenimiento: lo dice y "Ya lo resolví" tensa el papel', async () => {
    const { c, cam, nube } = await listo('I8');
    c.acabarPapel(); await pulsar(c, cam, 120, 'I8'); await correr(c, cam, 10, 'I8', () => c.estado === 'MANTENIMIENTO');
    c.ponerRollo();
    const dice = /Rollo nuevo puesto/.test(c.detalle);
    nube.comandos.push({ tipo: 'confirmar' });
    const tensa = await correr(c, cam, 10, 'I8', () => c.estado === 'RENOVACION');
    await correr(c, cam, 40, 'I8', enEspera(c));
    return { ok: dice && tensa && c.estado === 'ESPERA' && c.hw.papelCiclos > 90, detalle: `${c.hw.papelCiclos} ciclos` };
  });
  await caso('I', 'Tolva a 700 g + sensor desajustado → aviso de inventario', async () => {
    const { c, cam } = await listo('I9');
    c.tolvaMitad(); c.fallas.inventario = true;
    await pulsar(c, cam, 120, 'I9'); await correr(c, cam, 60, 'I9', () => comidas(c).length && enEspera(c)());
    const sinFalla = nuevo(); sinFalla.c.arrancar(); await correr(sinFalla.c, sinFalla.cam, 3, 'I9b');
    sinFalla.c.tolvaMitad(); await pulsar(sinFalla.c, sinFalla.cam, 120, 'I9b'); await correr(sinFalla.c, sinFalla.cam, 60, 'I9b', () => comidas(sinFalla.c).length && enEspera(sinFalla.c)());
    return { ok: c.activa('inventario') && !sinFalla.c.activa('inventario'), detalle: `con falla: ${!!c.activa('inventario')} · sin falla: ${!!sinFalla.c.activa('inventario')}` };
  });

  // ---------------- G. Pruebas al azar ----------------
  console.log('G. Pruebas al azar (fuzz) con invariantes');
  let semilla = +(process.env.SEMILLA || 12345);
  const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
  const N_RUNS = +(process.env.CORRIDAS || 30), acciones = {};
  let liveOK = 0;
  for (let run = 0; run < N_RUNS; run++) {
    const nG = 1 + Math.floor(azar() * 4);
    const { c, cam, nube } = await listo('fuzz' + run, {
      gatos: Array.from({ length: nG }, (_, i) => ['G' + (i + 1), [12, 24, 36, 48][Math.floor(azar() * 4)]]),
      config: { esperaMin: [5, 10, 30][Math.floor(azar() * 3)], consumoSinGatoMin: [1, 2, 5][Math.floor(azar() * 3)], siCamaraFalla: azar() < 0.5 ? 'dosificar' : 'no' },
      vel: [60, 300, 600][Math.floor(azar() * 3)]
    });
    const lista = [
      ['horario', () => { c.irAlProximoHorario(); for (let i = 1; i <= nG; i++) if (azar() < 0.7) cam.llega(i, 1000 + azar() * 3000, 500 + azar() * 4000); }],
      ['pulsador corto', () => { c.pulsadorAbajo(); c.tick(60); c.pulsadorArriba(); }],
      ['servir desde la app', () => nube.comandos.push({ tipo: 'servir', porciones: 1 + Math.floor(azar() * 4) })],
      ['atasco del disco', () => { c.fallas.atascoDisco = !c.fallas.atascoDisco; }],
      ['arco', () => { c.fallas.arco = !c.fallas.arco; }],
      ['atasco del papel', () => { c.fallas.atascoPapel = !c.fallas.atascoPapel; }],
      ['sin internet', () => { c.fallas.sinInternet = !c.fallas.sinInternet; }],
      ['cámara muerta', () => { cam.muerta = !cam.muerta; }],
      ['gato se mueve', () => cam.mov(500 + azar() * 4000)],
      ['tolva casi vacía', () => c.tolvaCasiVacia()],
      ['vaciar tolva', () => c.tolvaVacia()],
      ['rellenar', () => c.rellenarTolva()],
      ['acabar papel', () => c.acabarPapel()],
      ['rollo nuevo', () => c.ponerRollo()],
      ['llenar tacho', () => c.llenarTacho()],
      ['vaciar tacho', () => c.vaciarTacho()],
      ['confirmar', () => c.confirmar('fuzz')],
      ['corte de energía', () => c.corteEnergia()],
      ['plato con restos', () => { cam.plato = azar() < 0.5 ? 'RESTOS,9' : 'LIMPIO,1'; }],
      ['cambiar de modo', () => { nube.config.modo = nube.config.modo === 'libre' ? 'horario' : 'libre'; }],
      ['llega un gato (modo libre)', () => { const i = 1 + Math.floor(azar() * nG); cam.llega(i, 1000 + azar() * 2000, 500 + azar() * 3000); cam.mov(1500); }],
      ['gato no registrado', () => { cam.otro = !cam.otro; cam.mov(1500); }],
      ['probar reconocimiento', () => nube.comandos.push({ tipo: 'probar' })]
    ];
    for (let paso = 0; paso < 40; paso++) {
      const [nombre, fn] = lista[Math.floor(azar() * lista.length)];
      acciones[nombre] = (acciones[nombre] || 0) + 1;
      fn();
      await correr(c, cam, 1 + azar() * 6, 'fuzz' + run);
    }
    // Vida: si se arregla todo, debe volver a la espera
    Object.keys(c.fallas).forEach((k) => { c.fallas[k] = false; }); cam.muerta = false; cam.movHasta = -1; cam.otro = false;
    c.rellenarTolva(); c.vaciarTacho(); c.hw.papelCiclos = 94;
    await correr(c, cam, 130, 'fuzz' + run, () => !c.ocupado && c.estado === 'MANTENIMIENTO');
    if (c.estado === 'MANTENIMIENTO') c.confirmar('fuzz');
    const volvio = await correr(c, cam, 130, 'fuzz' + run, enEspera(c));
    if (volvio || enEspera(c)()) liveOK++;
  }
  await caso('G', `${N_RUNS} corridas al azar × 40 acciones: ninguna regla rota`, async () => ({ ok: violaciones.length === 0, detalle: violaciones.length ? violaciones.slice(0, 3).join(' | ') : `${Object.values(acciones).reduce((a, b) => a + b, 0)} acciones` }));
  await caso('G', 'Después de arreglar todo, siempre vuelve a la espera', async () => ({ ok: liveOK === N_RUNS, detalle: `${liveOK}/${N_RUNS}` }));

  const ok = resultados.filter((r) => r.ok).length;
  console.log(`\nResultado: ${ok} de ${resultados.length} casos correctos · invariantes rotas: ${violaciones.length}`);
  fs.writeFileSync(path.join(__dirname, 'resultados_casos.json'), JSON.stringify({ fecha: new Date().toISOString(), resultados, violaciones, acciones }, null, 1));
  process.exit(ok === resultados.length && !violaciones.length ? 0 : 1);
})();
