// Pruebas de la lógica del comedero con una cámara falsa (node pruebas/test_comedero.js)
const path = require('path');
const { Comedero, nubeNueva } = require(path.join(__dirname, '..', 'js', 'comedero.js'));

class CamFalsa {
  constructor() { this.t = 0; this.despierta = false; this.reconociendo = false; this.muerta = false; this.cola = []; this.proxOK = 0; this.gatoQueLlega = []; this.movHasta = -1; this.platoResp = 'RESTOS,7'; }
  recibir(m) {
    if (this.muerta) return;
    if (m === 'REC') { this.despierta = true; this.reconociendo = true; this.tRec = this.t; this.proxOK = this.t; }
    if (m === 'FIN') { this.reconociendo = false; }
    if (m === 'REVISAR') this.cola.push({ t: this.t + 300, m: this.platoResp });
    if (m.startsWith('REG,')) this.cola.push({ t: this.t + 1000, m: 'REGOK,' + m.split(',')[1] + ',30,0,0,0.5' });
  }
  tick(dt) {
    this.t += dt;
    if (this.muerta) return;
    if (this.despierta && this.t >= this.proxOK) { this.enviar('OK'); this.proxOK = this.t + 1000; }
    if (this.reconociendo && this.gatoQueLlega.length && this.t - this.tRec >= 2000) {
      const g = this.gatoQueLlega.shift(); this.enviar(`GATO,${g},0.93`); this.movHasta = this.t + 3000; this.reconociendo = false;
    }
    if (this.t < this.movHasta && this.t % 1000 < dt) this.enviar('MOV');
    while (this.cola.length && this.cola[0].t <= this.t) this.enviar(this.cola.shift().m);
  }
}

function nuevo() {
  const nube = nubeNueva();
  nube.gatos = [{ id: 1, nombre: 'Michi', racionG: 24 }, { id: 2, nombre: 'Luna', racionG: 36 }];
  const d = new Date(); d.setHours(5, 0, 0, 0);
  const c = new Comedero({ nube, simInicio: d.getTime() });
  const cam = new CamFalsa();
  c.enviarUart = (m) => cam.recibir(m);
  cam.enviar = (m) => c.onUart(m);
  return { c, cam, nube };
}
async function correr(c, cam, seg) {
  for (let i = 0; i < seg * 20; i++) { c.tick(50); cam.tick(50); await new Promise((r) => setImmediate(r)); }
}
let fallos = 0;
function ok(cond, msg) { console.log((cond ? '  ✔ ' : '  ✘ ') + msg); if (!cond) fallos++; }

(async () => {
  console.log('1. Horario con dos gatos reconocidos');
  {
    const { c, cam } = nuevo();
    c.arrancar(); await correr(c, cam, 4);
    ok(c.estado === 'ESPERA', 'arranca y queda en ESPERA (estado: ' + c.estado + ')');
    cam.gatoQueLlega = [1, 2];
    c.irAlProximoHorario(); await correr(c, cam, 90);
    const comidas = c.historial.filter((h) => h.tipo === 'comida');
    ok(comidas.length === 2, 'sirvió a los dos gatos (' + comidas.map((h) => h.gato + ' ' + h.gramos + ' g').join(', ') + ')');
    ok(comidas.every((h) => h.restos === 'restos'), 'registró los restos del plato');
    ok(c.hw.papelCiclos === 92, 'gastó dos ciclos de papel (' + c.hw.papelCiclos + ')');
    ok(Math.abs(c.hw.tolvaG - (1200 - 60)) <= 3, 'la tolva bajó unos 60 g, con las masas del ensayo (' + c.hw.tolvaG + ' g)');
    ok(c.estado === 'ESPERA', 'vuelve a ESPERA');
  }
  console.log('2. Atasco del disco con el pulsador, y pulsación larga');
  {
    const { c, cam } = nuevo();
    c.arrancar(); await correr(c, cam, 4);
    c.fallas.atascoDisco = true;
    c.pulsadorAbajo(); await correr(c, cam, 0.2); c.pulsadorArriba();
    c.pulsadorAbajo(); await correr(c, cam, 0.2); c.pulsadorArriba();
    ok(c.cr && c.cr.porciones === 2, 'dos pulsaciones cortas = 2 porciones');
    await correr(c, cam, 10);
    ok(c.estado === 'MANTENIMIENTO', 'pasa a MANTENIMIENTO tras el reintento');
    ok(c.led().color === 'rojo' && c.zumbador(), 'LED rojo intermitente y zumbador');
    c.fallas.atascoDisco = false;
    c.pulsadorAbajo(); await correr(c, cam, 3.3); c.pulsadorArriba();
    ok(c.estado === 'ESPERA' && !c.zumbador(), 'la pulsación larga confirma y silencia');
  }
  console.log('3. Cámara sin respuesta: ración por defecto');
  {
    const { c, cam } = nuevo();
    c.arrancar(); await correr(c, cam, 4);
    cam.muerta = true;
    c.irAlProximoHorario(); await correr(c, cam, 60);
    ok(c.activa('camara'), 'alerta de cámara sin respuesta');
    ok(c.historial.some((h) => h.tipo === 'comida' && /defecto/.test(h.modo)), 'sirvió la ración por defecto');
    ok(c.historial.filter((h) => h.tipo === 'omitida').length === 2, 'registró las dos raciones como omitidas');
  }
  console.log('4. Tacho lleno y vaciado');
  {
    const { c, cam } = nuevo();
    c.arrancar(); await correr(c, cam, 4);
    c.llenarTacho(); await correr(c, cam, 1);
    ok(c.estado === 'MANTENIMIENTO' && c.activa('tacho_lleno'), 'tacho lleno → mantenimiento');
    c.vaciarTacho(); await correr(c, cam, 1);
    ok(c.estado === 'ESPERA', 'al vaciarlo sale solo de mantenimiento');
  }
  console.log('5. Sin internet');
  {
    const { c, cam, nube } = nuevo();
    c.arrancar(); await correr(c, cam, 4);
    c.fallas.sinInternet = true; await correr(c, cam, 2);
    ok(c.led().parpadeo && c.led().color === 'azul', 'LED azul intermitente');
    nube.comandos.push({ tipo: 'servir', porciones: 1 });
    await correr(c, cam, 3);
    ok(nube.comandos.length === 1, 'la orden de la app queda pendiente en la nube');
    c.fallas.sinInternet = false; await correr(c, cam, 2);
    ok(nube.comandos.length === 0, 'al reconectar ejecuta la orden pendiente');
    await correr(c, cam, 30);
    ok(nube.historial.some((h) => h.modo === 'Ciclo rápido'), 'la comida aparece en la nube');
  }
  console.log('6. Papel: rollo por acabarse y fin de papel');
  {
    const { c, cam } = nuevo();
    c.arrancar(); await correr(c, cam, 4);
    c.rolloPorAcabarse();
    ok(c.activa('rollo') && c.led().color === 'amarillo', 'aviso de rollo y LED amarillo');
    c.acabarPapel();
    c.pulsadorAbajo(); await correr(c, cam, 0.2); c.pulsadorArriba(); await correr(c, cam, 4);
    ok(c.estado === 'MANTENIMIENTO' && c.activa('fin_papel'), 'sin papel → mantenimiento, no dosifica');
    ok(c.hw.tolvaG === 1200, 'no se gastó alimento');
  }
  console.log('7. Gato frente al papel en la renovación');
  {
    const { c, cam } = nuevo();
    c.arrancar(); await correr(c, cam, 4);
    c.reloj.vel = 600;
    c.pulsadorAbajo(); await correr(c, cam, 0.2); c.pulsadorArriba();
    let vioFreno = false;
    for (let i = 0; i < 60 * 20; i++) {
      c.tick(50); cam.tick(50); await new Promise((r) => setImmediate(r));
      if (c.estado === 'RENOVACION' && !vioFreno && cam.movHasta < cam.t) cam.movHasta = cam.t + 2500;
      if (/Frenados/.test(c.hw.motores)) vioFreno = true;
      if (vioFreno && c.estado === 'ESPERA') break;
    }
    ok(vioFreno, 'frenó los motores cuando volvió el gato');
    ok(c.estado === 'ESPERA' && c.hw.papelCiclos === 93, 'terminó la renovación cuando se fue');
  }
  console.log('8. Arco de croquetas y alimento bajo');
  {
    const { c, cam } = nuevo();
    c.arrancar(); await correr(c, cam, 4);
    c.tolvaCasiVacia(); c.pulsadorAbajo(); await correr(c, cam, 0.2); c.pulsadorArriba(); await correr(c, cam, 6);
    ok(c.activa('alimento_bajo'), 'aviso de alimento bajo');
    const { c: c2, cam: cam2 } = nuevo();
    c2.arrancar(); await correr(c2, cam2, 4);
    c2.fallas.arco = true; c2.pulsadorAbajo(); await correr(c2, cam2, 0.2); c2.pulsadorArriba(); await correr(c2, cam2, 10);
    ok(c2.estado === 'MANTENIMIENTO' && c2.activa('sin_caida'), 'sin caída → reintento → mantenimiento');
  }
  console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
  process.exit(fallos ? 1 : 0);
})();
