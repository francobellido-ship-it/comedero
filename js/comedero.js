/* ============================================================================
 * comedero.js — ESP32 principal simulado (gemelo digital del comedero)
 * ----------------------------------------------------------------------------
 * Reproduce la lógica de control de la tesis:
 *  - Máquina de estados (Tabla 7.5): INICIO, VERIFICACION, ESPERA, RECONOCIMIENTO,
 *    DOSIFICACION, PRESENTACION, CONSUMO, RENOVACION, MANTENIMIENTO.
 *  - Dosificar_Racion() (Fig. 4.19): una vuelta por porción, pulso del TCRT5000 en 2 s,
 *    caída en la barrera IR en 1 s, un reintento y luego mantenimiento.
 *  - Reconocer_Gato() (Fig. D.2): REC por UART, espera GATO,i,p de un gato que no comió.
 *  - Ciclo del papel (Cap. 5): presentación 100 mm, consumo (5 min sin gato o 60 min),
 *    renovación 360 mm, se frena si el gato vuelve; fallas de la Tabla 5.10.
 *  - Tacho (Cap. 6): sensor de lleno y recordatorio a los 7 días.
 *  - Panel (Tabla 7.7): LED RGB, zumbador y pulsador (corto = +1 porción, largo 3 s =
 *    silenciar y confirmar).
 *  - Nube (Tabla 7.6): /config, /gatos, /comandos, /estado, /alertas, /historial.
 * No usa el DOM: se puede probar con Node (pruebas/test_comedero.js).
 * ==========================================================================*/
(function (root) {
  'use strict';

  // ---- Constantes tomadas de la tesis ---------------------------------------
  const CFG = {
    PORCION_G: 12,              // sección 4.3.1
    TOLVA_MAX_G: 1200,          // sección 4.3.2
    ALIMENTO_BAJO_G: 300,       // borde del embudo, unos 4 días (4.5.4)
    LECTURA_MAX_G: 1000,        // el HC-SR04 no ve los 0.2 kg más altos (Anexo D.8)
    RESOLUCION_G: 30,           // 3 mm de resolución ≈ 30 g (Anexo D.8)
    INVENTARIO_TOL_G: 60,       // Anexo D.8
    T_VUELTA_S: 1.0,            // MG996R ≈ 1 vuelta por segundo
    T_TCRT_MAX_S: 2.0,          // Tabla 4.6
    T_CAIDA_S: 0.09,            // Anexo D.11
    T_CAIDA_MAX_S: 1.0,         // Tabla 4.6
    T_ASENTAR_S: 2.5,           // tras la última porción, la comida termina de caer por el ducto, rebota y se asienta antes de mover el papel
    CAMARA_TIMEOUT_S: 3,        // Tabla 4.6
    VEL_PAPEL_MM_S: 40,         // consigna del lazo de velocidad (código de la faja); presentación 100 mm ≈ 2.5 s, renovación 360 mm ≈ 9 s (< 2 min)
    PRESENTACION_MM: 100,       // sección 5.3.1
    RENOVACION_MM: 360,
    POS_CAIDA_MM: 230,          // la porción cae junto al rodillo B
    LARGO_PLATAFORMA_MM: 250,
    T_ATASCO_PAPEL_S: 0.3,      // Tabla 5.10
    ROLLO_CICLOS: 94,           // sección 5.3.7
    AVISO_ROLLO_CICLOS: 22,     // sección 5.4.3
    TACHO_ALARMA_G: 150,        // supuesto dentro de 105–185 g (Cap. 6)
    TACHO_RECORDATORIO_DIAS: 7, // Cap. 6
    RESTOS_FRACCION: 0.2,       // f = 0.2 (Cap. 6)
    CICLO_RAPIDO_ESPERA_S: 3,   // sección 4.5.1
    PULSACION_LARGA_S: 3,
    MAX_PORCIONES: 4,
    GATO_SE_FUE_S: 4,           // sin MOV en 4 s → el gato se fue (renovación)
    VISTAZO_S: 20,              // horario: al abrir la ventana, la cámara mira 20 s (por si el gato ya espera)
    REC_TRAS_MOV_S: 30,         // horario: tras cada MOV del PIR, la cámara sigue mirando hasta 30 s después del último
    LIBRE_ESPERA_S: 30,         // modo libre: la cámara mira hasta 30 s quién llegó
    LIBRE_CALMA_S: 30,          // modo libre: tras no servir, el PIR se ignora 30 s
    PRUEBA_S: 30,               // "Probar reconocimiento" desde la app
    SYNC_S: 1                   // la tesis usa 5 s; aquí 1 s para que la demo responda rápido
  };

  const CONFIG_DEF = {
    horarios: ['07:00', '13:00', '19:00'],
    esperaMin: 30,
    siCamaraFalla: 'dosificar',
    consumoSinGatoMin: 5,
    consumoMaxMin: 60,
    racionDefectoG: 24,
    cicloRapidoPorciones: 1,
    modo: 'horario',            // 'horario' (a sus horas) o 'libre' (cuando llega el gato)
    libreIntervaloMin: 120,     // modo libre: tiempo mínimo entre comidas de un mismo gato
    libreMaxDia: 4              // modo libre: máximo de comidas por gato al día
  };

  // Masas medidas en el ensayo: alternan ≈ 14 g y ≈ 10 g (Tabla D.1), media 12 g
  const MASAS_CAVIDAD = [14, 10, 14, 10, 13, 11];

  const ESTADOS = ['INICIO', 'VERIFICACION', 'ESPERA', 'RECONOCIMIENTO', 'DOSIFICACION',
    'PRESENTACION', 'CONSUMO', 'RENOVACION', 'MANTENIMIENTO'];

  const TEXTOS = {
    alimento_bajo: 'Queda poco alimento (unos 4 días). Rellena la tolva.',
    inventario: 'Lo entregado no cuadra con el nivel de la tolva. Revisa la tolva.',
    atasco_disco: 'El disco dosificador se trabó. Revisa el dosificador.',
    sin_caida: 'No cayó alimento: la tolva está vacía o las croquetas se atascaron.',
    camara: 'La cámara no responde.',
    fin_papel: 'Se acabó el papel o se rompió. Cambia el rollo.',
    atasco_papel: 'El papel o el mecanismo se trabó. Revisa el cajón del papel.',
    rollo: 'El rollo de papel se está acabando.',
    papel_flojo: 'El papel quedó flojo. Revisa la cinta guía del tubo.',
    tacho_lleno: 'El tacho de residuos está lleno. Vacíalo.',
    tacho_recordatorio: 'Ya pasaron 7 días desde el último vaciado. Revisa el tacho.',
    sin_gatos: 'Registra a tu gato para que el comedero lo reconozca.'
  };
  const FALLAS_MANT = ['atasco_disco', 'sin_caida', 'fin_papel', 'atasco_papel', 'tacho_lleno'];

  // ---- Utilidades -----------------------------------------------------------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pad = (n) => String(n).padStart(2, '0');
  function hhmm(ms) { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  const seg = (mm) => Math.round((mm / CFG.VEL_PAPEL_MM_S) * 10) / 10;
  function fecha(ms) { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fechaLeible(ms) { const d = new Date(ms); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function inicioHoy(h, m) { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); }
  function horaEnDia(ms, hm) { const d = new Date(ms); const [h, m] = hm.split(':').map(Number); d.setHours(h, m, 0, 0); return d.getTime(); }

  class Abortado extends Error {}

  // Reloj con dos tiempos: real (acciones físicas) y simulado (horarios y esperas)
  class Reloj {
    constructor(simInicio) { this.real = 0; this.sim = simInicio; this.vel = 60; this.timers = []; }
    tick(dt) { this.real += dt; this.sim += dt * this.vel; this._disparar(); }
    saltar(ms) { this.sim += ms; }
    dormir(s) { return new Promise((r) => this.timers.push({ t: this.real + s * 1000, r })); }
    _disparar() {
      const now = this.real;
      if (!this.timers.some((x) => now >= x.t)) return;
      const listos = this.timers.filter((x) => now >= x.t);
      this.timers = this.timers.filter((x) => now < x.t);
      listos.forEach((x) => x.r());
    }
  }

  // Nube local con las rutas de la Tabla 7.6 (luego se reemplaza por Firebase)
  function nubeNueva() {
    return { config: clone(CONFIG_DEF), gatos: [], comandos: [], estado: {}, alertas: [], historial: [], huellas: {}, instalacion: {}, ultimaSync: null };
  }

  // ---- Comedero -------------------------------------------------------------
  class Comedero {
    constructor(opts) {
      opts = opts || {};
      this.CFG = CFG;
      this.nube = opts.nube || nubeNueva();
      this.reloj = new Reloj(opts.simInicio || inicioHoy(6, 58));
      this.hw = {
        tolvaG: CFG.TOLVA_MAX_G, m0G: CFG.TOLVA_MAX_G, entG: 0, cavidad: 0,
        servo: false, k: 0, n: 0, tcrtT: -1e9, barreraT: -1e9,
        papelCiclos: CFG.ROLLO_CICLOS, motores: 'Detenidos', comidaPos: null, m1: 'libre', m2: 'libre', frenoHasta: -1e9,
        tachoG: 0, vaciadoSim: this.reloj.sim
      };
      this.fallas = { atascoDisco: false, arco: false, atascoPapel: false, papelFlojo: false, inventario: false, sinInternet: false };
      this.config = Object.assign(clone(CONFIG_DEF), this.nube.config ? clone(this.nube.config) : {});
      this.gatos = Array.isArray(this.nube.gatos) ? clone(this.nube.gatos) : [];
      this.estado = 'INICIO'; this.detalle = '';
      this.alertas = []; this.historial = []; this.eventos = []; this.uart = [];
      this.rx = []; this.lastOK = -1e9; this.lastMovReal = -1e9; this.lastMovSim = -1e9;
      this.silenciado = false; this.blancoHasta = -1;
      this.pulsador = { abajo: false, t: 0, largo: false };
      this.cr = null;
      this.hechos = {}; this.colaHorario = null; this.ultimoCheckSim = this.reloj.sim;
      this.ciclo = 0; this.ocupado = false; this.motivoMant = null; this.cicloEnCurso = false;
      this.desconectadoDesde = null; this.pendientes = 0; this.proxSync = 0;
      this.horariosActivos = true;   // la app los pausa durante la configuración inicial
    this.libreCalmaHasta = 0; this.prueba = null; this.verHasta = 0;
      this.enviarUart = () => {};
      this._id = 1;
      if (opts.estadoGuardado) this.importar(opts.estadoGuardado);
    }

    // ---------- Registro ----------
    evento(texto) {
      this.eventos.unshift({ t: this.reloj.sim, texto });
      if (this.eventos.length > 80) this.eventos.pop();
    }
    tx(msg) { this._uart('→', msg); this.enviarUart(msg); }
    _uart(dir, msg) {
      const u = this.uart[0];
      if (u && u.msg === msg && u.dir === dir) { u.n = (u.n || 1) + 1; u.t = this.reloj.sim; return; }
      this.uart.unshift({ t: this.reloj.sim, dir, msg });
      if (this.uart.length > 60) this.uart.pop();
    }
    alerta(tipo, nivel, extra) {
      const ya = this.alertas.find((a) => a.tipo === tipo && a.activa);
      if (ya) return ya;
      const a = { id: this._id++, tipo, nivel, texto: TEXTOS[tipo] + (extra ? ' ' + extra : ''), t: this.reloj.sim, activa: true };
      this.alertas.unshift(a);
      if (this.alertas.length > 60) this.alertas.pop();
      this.evento((nivel === 'falla' ? 'Falla: ' : 'Aviso: ') + a.texto);
      if (this.fallas.sinInternet) this.pendientes++;
      return a;
    }
    resolver(tipo) {
      this.alertas.filter((a) => a.tipo === tipo && a.activa).forEach((a) => { a.activa = false; a.resuelta = this.reloj.sim; });
    }
    activa(tipo) { return this.alertas.some((a) => a.tipo === tipo && a.activa); }
    registrar(entrada) {
      entrada.id = this._id++;
      entrada.t = entrada.t || this.reloj.sim;
      this.historial.unshift(entrada);
      if (this.historial.length > 200) this.historial.pop();
      if (this.fallas.sinInternet) this.pendientes++;
      return entrada;
    }
    _set(estado, detalle) {
      if (estado !== this.estado) this.proxSync = Math.min(this.proxSync || 0, this.reloj.real);
      this.estado = estado; this.detalle = detalle || '';
    }
    _vivo(id) { if (id !== this.ciclo) throw new Abortado(); }

    async _esperar(cond, segReal, id) {
      const fin = this.reloj.real + segReal * 1000;
      while (true) {
        if (cond()) return true;
        if (this.reloj.real >= fin) return false;
        await this.reloj.dormir(0.05);
        if (id !== undefined) this._vivo(id);
      }
    }

    iniciarCiclo(fn, nombre, forzar) {
      if (!forzar && (this.ocupado || this.estado === 'MANTENIMIENTO' || this.estado === 'INICIO')) return false;
      this.ocupado = true; this.nombreCiclo = nombre || '';
      const id = ++this.ciclo;
      Promise.resolve().then(() => fn(id)).catch((e) => {
        if (!(e instanceof Abortado)) { console.error(e); this.evento('Error interno: ' + e.message); }
      }).finally(() => {
        if (this.ciclo === id) {
          this.ocupado = false;
          if (this.estado !== 'MANTENIMIENTO') this._set('ESPERA');
        }
      });
      if (nombre) this.evento(nombre);
      return true;
    }

    // ---------- UART: mensajes de la cámara ----------
    onUart(msg) {
      this._uart('←', msg);
      const p = msg.split(',');
      const r = this.reloj;
      switch (p[0]) {
        case 'OK':
          this.lastOK = r.real;
          if (this.activa('camara')) { this.resolver('camara'); this.evento('La cámara volvió a responder'); }
          return;
        case 'MOV':
          this.lastMovReal = r.real; this.lastMovSim = r.sim;
          return;
        case 'REGOK': {
          // REGOK,i,n,j,parecido(0/1),sim
          const id = +p[1];
          this.nube.huellas = this.nube.huellas || {};
          this.nube.huellas['g' + id] = { n: +p[2], parecidoA: +p[3] || 0, parecido: p[4] === '1', sim: +p[5] || 0, t: r.sim };
          this.evento(`Huella de ${this._nombre(id)} guardada (${p[2]} fotos)`);
          return;
        }
        case 'FONDOOK': this._inst().fondoOk = true; this.evento('Fondo vacío registrado'); return;
        case 'REGMAL':
          this._inst().regError = { id: +p[1], n: +p[2] || 0, t: r.sim };
          this.evento(`Registro de ${this._nombre(+p[1])} fallido: la cámara casi no lo vio (${p[2] || 0} fotos)`);
          return;
        case 'CALOK': this._inst().platoOk = true; this.evento('Papel limpio calibrado (zona de comida)'); return;
        default:
          this.rx.push({ t: r.real, msg, p });
      }
    }
    _inst() { this.nube.instalacion = this.nube.instalacion || {}; return this.nube.instalacion; }
    camaraViva() { return this.reloj.real - this.lastOK < 1500; }
    gatoPresente() { return this.reloj.real - this.lastMovReal < CFG.GATO_SE_FUE_S * 1000; }

    // ---------- Sensores simulados ----------
    nivelMedido() {
      // HC-SR04: satura en 1.0 kg, y bajo el borde del embudo devuelve 0.3 kg (Anexo D.8)
      let raw = this.hw.tolvaG + (this.fallas.inventario ? 150 : 0);
      if (raw >= CFG.LECTURA_MAX_G) return CFG.LECTURA_MAX_G;
      if (raw <= CFG.ALIMENTO_BAJO_G) return CFG.ALIMENTO_BAJO_G;
      return Math.round(raw / CFG.RESOLUCION_G) * CFG.RESOLUCION_G;
    }
    // Comidas por día: los horarios, o en modo libre el máximo que permiten el intervalo y el tope diario
    comidasPorDia() {
      const c = this.config;
      if (c.modo === 'libre') return Math.max(1, Math.min(c.libreMaxDia || 4, Math.floor(1440 / (c.libreIntervaloMin || 120))));
      return Math.max(1, c.horarios.length);
    }
    racionDiariaG() {
      const porGato = this.gatos.length ? this.gatos.reduce((s, g) => s + g.racionG, 0) : this.config.racionDefectoG;
      return Math.max(12, porGato * this.comidasPorDia());
    }

    // ---------- Pulsador y panel ----------
    pulsadorAbajo() { this.pulsador = { abajo: true, t: this.reloj.real, largo: false }; }
    pulsadorArriba() {
      if (this.pulsador.abajo && !this.pulsador.largo) this.pulsacionCorta();
      this.pulsador.abajo = false;
    }
    pulsacionCorta() {
      const ignorar = (txt) => { this.avisoPulsador = { texto: txt, hasta: this.reloj.real + 10000 }; this.evento('Pulsación corta ignorada: ' + txt); };
      if (this.estado === 'MANTENIMIENTO') return ignorar('el equipo está en mantenimiento. Resuelve la falla y mantén pulsado 3 s (o "Ya lo resolví" en la app)');
      if (this.estado === 'INICIO' || this.estado === 'VERIFICACION' && this.ocupado && !this.cicloEnCurso && /Encendido/.test(this.nombreCiclo || '')) return ignorar('el equipo está encendiendo');
      if (this.ocupado) {
        const EST = { RECONOCIMIENTO: 'la cámara está buscando al gato', DOSIFICACION: 'está sirviendo', PRESENTACION: 'está acercando la comida', CONSUMO: 'el gato está comiendo (o se espera a que se vaya)', RENOVACION: 'se está renovando el papel' };
        return ignorar(`hay un ciclo en curso: ${EST[this.estado] || this.estado.toLowerCase()}. ${this.estado === 'CONSUMO' ? 'Si ya terminó, toca "Ya terminó de comer" en la app.' : 'Espera a que termine.'}`);
      }
      this.avisoPulsador = null;
      this.blancoHasta = this.reloj.real + 350;     // blanco breve solo si la pulsación se aceptó (Tabla 7.7)
      const n = this.cr ? Math.min(CFG.MAX_PORCIONES, this.cr.porciones + 1) : 1;
      this.cr = { porciones: n, t: this.reloj.real };
      this.evento(`Pulsador: ${n} ${n === 1 ? 'porción' : 'porciones'} (sale a los 3 s)`);
    }
    pulsacionLarga() {
      this.blancoHasta = this.reloj.real + 350;
      this.evento('Pulsación larga: silenciar y confirmar');
      this.confirmar('pulsador');
    }
    led() {
      const r = this.reloj.real;
      if (this.estado === 'MANTENIMIENTO') return { color: 'rojo', parpadeo: true, texto: 'Rojo intermitente: falla o mantenimiento' };
      if (r < this.blancoHasta) return { color: 'blanco', parpadeo: false, texto: 'Blanco breve: pulsación aceptada' };
      if (this.ocupado || this.cr) return { color: 'azul', parpadeo: false, texto: 'Azul fijo: ciclo en curso' };
      if (this.fallas.sinInternet) return { color: 'azul', parpadeo: true, texto: 'Azul intermitente: sin Wi-Fi, usa la configuración guardada' };
      if (this.alertas.some((a) => a.activa && a.nivel === 'aviso')) return { color: 'amarillo', parpadeo: false, texto: 'Amarillo fijo: hay un aviso' };
      return { color: 'verde', parpadeo: false, texto: 'Verde fijo: listo, en espera' };
    }
    zumbador() { return this.estado === 'MANTENIMIENTO' && !this.silenciado; }

    // ---------- Mantenimiento ----------
    _cerrarEntrada() {
      if (this.entradaActual && !this.entradaActual.restos) this.entradaActual.restos = 'interrumpida';
      this.entradaActual = null;
    }
    mantenimiento(tipo, extra) {
      this._cerrarEntrada();
      this.alerta(tipo, 'falla', extra);
      this.motivoMant = tipo;
      this.silenciado = false;
      this.hw.servo = false; this.hw.motores = 'Detenidos';
      this.hw.m1 = 'freno'; this.hw.m2 = 'freno'; this.hw.frenoHasta = this.reloj.real + 400;
      this.ciclo++; this.ocupado = false; this.cr = null;
      this._set('MANTENIMIENTO', TEXTOS[tipo]);
    }
    confirmar(origen) {
      this.silenciado = true;
      ['atasco_disco', 'sin_caida', 'atasco_papel', 'inventario'].forEach((t) => this.resolver(t));
      if (this.estado !== 'MANTENIMIENTO') { this.evento('Confirmado desde ' + origen); return; }
      if (this.hw.tachoG >= CFG.TACHO_ALARMA_G) { this.motivoMant = 'tacho_lleno'; this.alerta('tacho_lleno', 'falla'); this._set('MANTENIMIENTO', TEXTOS.tacho_lleno); this.evento('Sigue en mantenimiento: el tacho sigue lleno'); return; }
      if (this.hw.papelCiclos <= 0) { this.motivoMant = 'fin_papel'; this.alerta('fin_papel', 'falla'); this._set('MANTENIMIENTO', TEXTOS.fin_papel); this.evento('Sigue en mantenimiento: no hay papel'); return; }
      this.resolver('fin_papel'); this.resolver('tacho_lleno');
      this.motivoMant = null;
      this._set('ESPERA');
      this.evento('Mantenimiento confirmado desde ' + origen + '; vuelve a la espera');
      if (this.tensarPendiente) this._tensar();
      else if (this.cicloEnCurso && this.hw.comidaPos !== null) this._renovarPendiente('quedó comida sobre el papel del ciclo interrumpido');
    }
    // Renovación de recuperación: si un ciclo se cortó con comida sobre el papel, se lleva al tacho
    _cerrarInterrumpida() {
      const h = this.historial.find((x) => x.tipo === 'comida');
      if (h && !h.restos) h.restos = 'interrumpida';
    }
    _renovarPendiente(motivo) {
      this._cerrarInterrumpida();
      this.iniciarCiclo(async (id) => {
        this.evento('Renovación del papel: ' + motivo);
        this._set('RENOVACION', 'Renovación de recuperación: el papel usado va al tacho');
        const m = await this.moverPapel(id, CFG.RENOVACION_MM, true);
        if (!m.ok) { this.mantenimiento(m.falla); throw new Abortado(); }
        this.hw.comidaPos = null; this.cicloEnCurso = false; this.entradaActual = null;
        if (!this.fallas.papelFlojo) this.resolver('papel_flojo');
        this.hw.papelCiclos = Math.max(0, this.hw.papelCiclos - 1);
        this.revisarRollo();
      }, 'Renovación de recuperación');
    }

    // ---------- Acciones del simulador (lo que haría el usuario con las manos) ----------
    rellenarTolva() {
      this.hw.tolvaG = CFG.TOLVA_MAX_G; this.hw.m0G = CFG.TOLVA_MAX_G; this.hw.entG = 0;
      this.resolver('alimento_bajo'); this.resolver('inventario');
      this.evento('Tolva rellenada (1.2 kg); el inventario vuelve a cero');
    }
    // Simula días de consumo: lo que falta salió por el dosificador, así que se suma a lo entregado
    _bajarTolva(g) { const d = Math.max(0, this.hw.tolvaG - g); this.hw.entG += d; this.hw.tolvaG = g; }
    tolvaCasiVacia() { this._bajarTolva(260); this.evento('Simulación: quedan 260 g en la tolva'); }
    tolvaMitad() { this._bajarTolva(700); this.evento('Simulación: pasaron unos días, quedan 700 g en la tolva'); }
    tolvaVacia() { this.hw.tolvaG = 0; this.evento('Simulación: tolva vacía'); }
    rolloPorAcabarse() { this.hw.papelCiclos = CFG.AVISO_ROLLO_CICLOS; this.evento('Simulación: quedan 22 ciclos de papel'); this.revisarRollo(); }
    acabarPapel() { this.hw.papelCiclos = 0; this.evento('Simulación: el papel se acabó'); }
    ponerRollo() {
      this.hw.papelCiclos = CFG.ROLLO_CICLOS;
      this.resolver('rollo'); this.resolver('fin_papel');
      this.evento('Rollo nuevo instalado (94 ciclos)');
      if (this.estado === 'MANTENIMIENTO') {
        this.tensarPendiente = true;
        this._set('MANTENIMIENTO', 'Rollo nuevo puesto. Confirma con una pulsación larga de 3 s o con "Ya lo resolví" en la app: luego se tensa el papel');
        this.evento('Confirma con una pulsación larga o con "Ya lo resolví" en la app; luego se tensa el papel');
        return;
      }
      this._tensar();
    }
    _tensar() {
      this.tensarPendiente = false;
      this.iniciarCiclo(async (id) => {
        this._set('RENOVACION', 'Tensar_Papel() y primera renovación');
        await this.reloj.dormir(1); this._vivo(id);
        if (this.fallas.papelFlojo) {
          await this.reloj.dormir(2); this._vivo(id);
          this.alerta('papel_flojo', 'aviso'); return;
        }
        this.resolver('papel_flojo');
        const m = await this.moverPapel(id, CFG.RENOVACION_MM, true);
        if (!m.ok) { this.mantenimiento(m.falla); throw new Abortado(); }
        this.hw.comidaPos = null; this.cicloEnCurso = false; this.entradaActual = null;
      }, 'Tensar_Papel() después del cambio de rollo');
    }
    llenarTacho() { this.hw.tachoG = CFG.TACHO_ALARMA_G; this.evento('Simulación: el tacho llegó al nivel del sensor'); this.revisarTacho(); }
    vaciarTacho() {
      this.hw.tachoG = 0; this.hw.vaciadoSim = this.reloj.sim;
      this.resolver('tacho_lleno'); this.resolver('tacho_recordatorio');
      this.evento('Tacho vaciado');
      if (this.estado === 'MANTENIMIENTO' && this.motivoMant === 'tacho_lleno') {
        this.motivoMant = null; this._set('ESPERA');
        this.evento('El sensor ve el tacho vacío: sale de mantenimiento (Cap. 6)');
      }
    }
    saltarDias(d) { this.reloj.saltar(d * 86400000); this.ultimoCheckSim = this.reloj.sim; this.evento(`Simulación: pasan ${d} días`); }
    // Vuelve a la hora real (×1). Si el reloj simulado iba adelantado, corre hacia atrás todo lo
    // anotado (historial, alertas, registro) para que siga en orden y termine "ahora".
    alinearConHoraReal(ahora) {
      ahora = ahora || Date.now();
      const d = this.reloj.sim - ahora;
      if (d > 60000) {
        const mover = (o, k) => { if (o && typeof o[k] === 'number') o[k] -= d; };
        this.historial.forEach((h) => { mover(h, 't'); mover(h, 'ultima'); });
        this.alertas.forEach((a) => { mover(a, 't'); mover(a, 'resuelta'); });
        this.eventos.forEach((e) => mover(e, 't'));
        this.uart.forEach((u) => mover(u, 't'));
        mover(this.hw, 'vaciadoSim'); mover(this, 'lastMovSim');
        if (this.prueba) { mover(this.prueba, 't'); mover(this.prueba, 'fin'); }
        this.hechos = {};
      }
      this.reloj.sim = ahora; this.ultimoCheckSim = ahora; this.reloj.vel = 1;
      this.evento('El reloj está en la hora real (×1)');
    }
    // La página estuvo en pausa (PC suspendida o pestaña congelada): el equipo "estuvo apagado"
    // ese tiempo. El reloj sigue desde la hora actual y los horarios de ese lapso no se recuperan.
    reanudarTrasPausa(ms) {
      this.reloj.real += ms;
      this.reloj.sim += ms * (this.reloj.vel === 1 ? 1 : 0);
      if (this.reloj.vel === 1 && Math.abs(this.reloj.sim - Date.now()) > 60000) this.reloj.sim = Date.now();
      this.ultimoCheckSim = this.reloj.sim;
      this.reloj._disparar();
      this.evento(`La página estuvo en pausa ${Math.round(ms / 60000)} min (PC suspendida): el comedero sigue desde ahora`);
    }
    adelantarMin(m) { this.reloj.saltar(m * 60000); this.ultimoCheckSim = this.reloj.sim; this.evento(`Simulación: el reloj avanza ${m >= 60 ? Math.round(m / 6) / 10 + ' h' : m + ' min'}`); }
    irAlProximoHorario() {
      const s = this.reloj.sim;
      let mejor = null;
      for (let dia = 0; dia < 2; dia++) {
        for (const h of this.config.horarios) {
          const t = horaEnDia(s + dia * 86400000, h);
          if (t > s + 60000 && (mejor === null || t < mejor)) mejor = t;
        }
      }
      if (mejor) { this.reloj.sim = mejor - 20000; this.ultimoCheckSim = this.reloj.sim; this.evento('Reloj adelantado al próximo horario: ' + hhmm(mejor)); }
    }
    corteEnergia() {
      this.ciclo++; this.ocupado = false; this.cr = null;
      this.hw.servo = false; this.hw.motores = 'Detenidos'; this.hw.m1 = 'libre'; this.hw.m2 = 'libre';
      this._cerrarEntrada();
      this.evento('Corte de energía');
      this._set('INICIO');
      setTimeoutReloj(this, 1.5, () => this.arrancar());
    }

    // ---------- Arranque ----------
    arrancar() {
      this.ciclo++; this.ocupado = false; this.cr = null;              // detiene cualquier ciclo anterior
      this.hw.servo = false; this.hw.m1 = 'libre'; this.hw.m2 = 'libre'; this.hw.motores = 'Detenidos';
      this._set('INICIO');
      this.iniciarCiclo(async (id) => {
        this._set('INICIO', 'Carga la configuración, se conecta a Wi-Fi y sincroniza la hora');
        await this.reloj.dormir(1); this._vivo(id);
        this._set('VERIFICACION', 'Revisa alimento, papel, tacho y cámara');
        this.tx('REC');
        const ok = await this._esperar(() => this.camaraViva(), CFG.CAMARA_TIMEOUT_S, id);
        this.tx('FIN');
        if (!ok) this.alerta('camara', 'aviso');
        if (!this.verificar()) return;
        if (this.cicloEnCurso && this.hw.comidaPos !== null) {
          this._cerrarInterrumpida();
          this.evento('Ciclo sin terminar al encender: se renueva el papel (Tabla 5.10)');
          this._set('RENOVACION', 'Renovación por corte de energía');
          const m = await this.moverPapel(id, CFG.RENOVACION_MM, true);
          if (!m.ok) { this.mantenimiento(m.falla); throw new Abortado(); }
          this.hw.comidaPos = null; this.cicloEnCurso = false; this.hw.papelCiclos--;
          if (!this.fallas.papelFlojo) this.resolver('papel_flojo');
        }
      }, 'Encendido', true);
    }

    verificar() {
      if (this.estado === 'MANTENIMIENTO') return false;
      if (this.hw.tachoG >= CFG.TACHO_ALARMA_G) { this.mantenimiento('tacho_lleno'); return false; }
      if (this.hw.papelCiclos <= 0) { this.mantenimiento('fin_papel'); return false; }
      if (this.nivelMedido() <= CFG.ALIMENTO_BAJO_G) this.alerta('alimento_bajo', 'aviso');
      return true;
    }
    revisarRollo() {
      const c = this.hw.papelCiclos;
      if (c > 0 && c <= CFG.AVISO_ROLLO_CICLOS) this.alerta('rollo', 'aviso', `Quedan unos ${c} ciclos (${Math.round(c / this.comidasPorDia())} días).`);
    }
    revisarTacho() {
      if (this.hw.tachoG >= CFG.TACHO_ALARMA_G) {
        if (this.estado === 'MANTENIMIENTO') this.alerta('tacho_lleno', 'falla');
        else if (!this.ocupado) this.mantenimiento('tacho_lleno');
      }
      const dias = (this.reloj.sim - this.hw.vaciadoSim) / 86400000;
      if (dias >= CFG.TACHO_RECORDATORIO_DIAS) this.alerta('tacho_recordatorio', 'aviso');
    }

    // ---------- Horario (secuencia general, Cap. 7) ----------
    async cicloHorario(id, h) {
      this._set('VERIFICACION', 'Horario de las ' + h);
      if (!this.verificar()) { this._omitirTodos(h, 'equipo en mantenimiento'); throw new Abortado(); }
      if (!this.gatos.length) {
        this.alerta('sin_gatos', 'aviso');
        await this.servirYCiclo(id, this.config.racionDefectoG, { modo: 'Horario sin gatos registrados (ración por defecto)' });
        return;
      }
      const pend = this.gatos.map((g) => g.id);
      let fin = this.reloj.sim + this.config.esperaMin * 60000;   // la espera se pausa mientras come otro gato
      let porDefecto = false;
      while (pend.length) {
        const r = await this.reconocerGato(id, pend, fin);
        if (r.tipo === 'gato') {
          const g = this.gatos.find((x) => x.id === r.id);
          this.evento(`Reconocido: ${g.nombre} (p = ${r.p.toFixed(2)})`);
          const resta = Math.max(0, fin - this.reloj.sim);
          await this.servirYCiclo(id, g.racionG, { gato: g, modo: 'Reconocido por la cámara', p: r.p, horario: h });
          fin = this.reloj.sim + resta;
          pend.splice(pend.indexOf(r.id), 1);
          if (pend.length && !this.verificar()) { this._omitir(pend, h, 'equipo en mantenimiento'); throw new Abortado(); }
          continue;
        }
        if (r.tipo === 'camara') {
          const servir = this.config.siCamaraFalla === 'dosificar';
          this.alerta('camara', 'aviso', servir ? 'Se sirvió la ración por defecto.' : 'No se sirvió la ración.');
          if (servir && !porDefecto) {
            porDefecto = true;
            await this.servirYCiclo(id, this.config.racionDefectoG, { modo: 'Ración por defecto (cámara sin respuesta)', horario: h });
          }
          this._omitir(pend, h, 'cámara sin respuesta');
          return;
        }
        break; // nadie llegó en el tiempo de espera
      }
      this._omitir(pend, h, 'no llegó en el tiempo de espera');
    }
    _nombre(i) { const g = this.gatos.find((x) => x.id === i); return g ? g.nombre : 'gato ' + i; }
    _omitir(ids, h, motivo) {
      ids.forEach((i) => this.registrar({ tipo: 'omitida', gato: this._nombre(i), gatoId: i, gramos: 0, modo: 'Ración omitida: ' + motivo, horario: h }));
    }
    _omitirTodos(h, motivo) { this._omitir(this.gatos.map((g) => g.id), h, motivo); }

    // Reconocer_Gato() — Figura D.2, con la cámara dormida entre visitas.
    // La ventana de espera dura esperaMin, pero la cámara no queda encendida todo ese tiempo:
    //  1. al abrir la ventana mira VISTAZO_S (20 s), por si el gato ya está esperando;
    //  2. luego duerme; cada MOV del PIR la despierta (REC) y sigue mirando mientras haya
    //     movimiento y hasta REC_TRAS_MOV_S (30 s) después del último MOV;
    //  3. sin movimiento, FIN: la cámara vuelve a dormir hasta el próximo MOV.
    // La señal de vida (OK) solo se exige mientras la cámara está despierta.
    async reconocerGato(id, pend, finSim) {
      this.rx = [];
      const R = this.reloj, nombres = () => pend.map((i) => this._nombre(i)).join(', ');
      let activa = false, recHasta = 0, movVisto = this.lastMovReal, desde = 0;
      const uso = this.usoCamara = { seg: 0, veces: 0 };
      const detalle = () => this._set('RECONOCIMIENTO', `Esperando a ${nombres()} (hasta las ${hhmm(finSim)}) · ${activa ? 'la cámara está mirando' : 'cámara dormida: la despierta el PIR'}`);
      const despertar = async (motivo) => {
        const t0 = R.real; this.rx = [];
        this.tx('REC'); activa = true; desde = t0; uso.veces++; detalle();
        if (motivo) this.evento(motivo);
        return this._esperar(() => this.lastOK >= t0, CFG.CAMARA_TIMEOUT_S, id);
      };
      const dormir = (txt) => { this.tx('FIN'); uso.seg += (R.real - desde) / 1000; activa = false; detalle(); if (txt) this.evento(txt); };
      const terminar = (r) => { if (activa) dormir(); this.evento(`Ventana del horario: la cámara estuvo encendida ${Math.round(uso.seg)} s en ${uso.veces} ${uso.veces === 1 ? 'vez' : 'veces'}`); return r; };
      recHasta = R.real + CFG.VISTAZO_S * 1000;
      if (!(await despertar('Se abre la ventana: la cámara mira 20 s por si el gato ya está esperando'))) { dormir(); return terminar({ tipo: 'camara' }); }
      while (true) {
        // Movimiento del PIR: despierta la cámara o alarga su tiempo encendida
        if (this.lastMovReal > movVisto) {
          movVisto = this.lastMovReal;
          recHasta = Math.max(recHasta, R.real + CFG.REC_TRAS_MOV_S * 1000);
          if (!activa && !(await despertar('El PIR vio movimiento: la cámara despierta y busca al gato'))) { dormir(); return terminar({ tipo: 'camara' }); }
        }
        const m = this.rx.shift();
        if (m) {
          if (m.p[0] === 'GATO') {
            const gid = +m.p[1], p = +m.p[2];
            if (pend.includes(gid)) return terminar({ tipo: 'gato', id: gid, p });
            this.evento(`${this._nombre(gid)} ya comió en este horario: se ignora`);
          }
          continue;
        }
        if (R.sim >= finSim) return terminar({ tipo: 'nadie' });
        if (activa && R.real > recHasta) dormir('Nadie a la vista: la cámara vuelve a dormir hasta que el PIR vea movimiento');
        if (activa && R.real - this.lastOK > CFG.CAMARA_TIMEOUT_S * 1000) { dormir(); return terminar({ tipo: 'camara' }); }
        await R.dormir(0.05); this._vivo(id);
      }
    }

    // ---------- Modo libre: sirve cuando llega un gato registrado ----------
    // El PIR (en la placa de la cámara) envía MOV → el ESP32 pide REC → si la cámara
    // reconoce a un gato y ese gato puede comer (intervalo y tope diario), se sirve su ración.
    async cicloLibre(id) {
      const calma = (s) => { this.libreCalmaHasta = this.reloj.real + s * 1000; };
      this._set('VERIFICACION', 'Modo libre: el PIR vio movimiento');
      if (!this.verificar()) throw new Abortado();
      if (!this.gatos.length) { this.alerta('sin_gatos', 'aviso'); calma(CFG.LIBRE_CALMA_S); return; }
      this._set('RECONOCIMIENTO', 'Modo libre: la cámara mira quién llegó');
      const r = await this.reconocerLibre(id, CFG.LIBRE_ESPERA_S);
      if (r.tipo === 'camara') { this.alerta('camara', 'aviso', 'En modo libre no se sirve sin reconocer al gato.'); calma(CFG.LIBRE_CALMA_S); return; }
      if (r.tipo === 'nadie') { this.evento('Modo libre: hubo movimiento, pero la cámara no vio a ningún gato registrado'); calma(CFG.LIBRE_CALMA_S); return; }
      if (r.tipo === 'otro') { this._visita(null, 'no se sirve porque no está registrado'); calma(CFG.LIBRE_CALMA_S); return; }
      const g = this.gatos.find((x) => x.id === r.id);
      const permiso = this.puedeComerLibre(g);
      if (!permiso.ok) { this._visita(g, permiso.motivo); calma(CFG.LIBRE_CALMA_S); return; }
      this.evento(`Modo libre: reconocido ${g.nombre} (p = ${r.p.toFixed(2)})`);
      await this.servirYCiclo(id, g.racionG, { gato: g, modo: 'Modo libre: reconocido por la cámara', p: r.p });
      calma(5);
    }
    puedeComerLibre(g) {
      const s = this.reloj.sim, c = this.config;
      const suyas = this.historial.filter((h) => h.tipo === 'comida' && h.gatoId === g.id);
      const ult = suyas[0], intervalo = (c.libreIntervaloMin || 120) * 60000;
      if (ult && s - ult.t < intervalo) return { ok: false, motivo: `ya comió a las ${hhmm(ult.t)}; vuelve a comer desde las ${hhmm(ult.t + intervalo)}` };
      const hoy = suyas.filter((h) => fecha(h.t) === fecha(s)).length;
      if (hoy >= (c.libreMaxDia || 4)) return { ok: false, motivo: `ya comió ${hoy} veces hoy (máximo ${c.libreMaxDia || 4})` };
      return { ok: true };
    }
    // Una visita sin comida queda una sola vez en el historial (se cuentan las repeticiones)
    _visita(g, motivo) {
      const gid = g ? g.id : 0;
      this.evento(`Modo libre: ${g ? g.nombre : 'gato no registrado'} vino, pero no se sirve (${motivo})`);
      let previa = null;
      for (const h of this.historial) {
        if (h.tipo === 'comida' && h.gatoId === gid) break;
        if (h.tipo === 'visita' && h.gatoId === gid) { previa = h; break; }
      }
      if (previa && previa.modo === motivo.split(';')[0]) { previa.veces = (previa.veces || 1) + 1; previa.ultima = this.reloj.sim; previa.detalle = motivo; return; }
      this.registrar({ tipo: 'visita', gato: g ? g.nombre : null, gatoId: gid, gramos: 0, modo: motivo.split(';')[0], detalle: motivo, veces: 1 });
    }

    // Reconocer a cualquier gato registrado (modo libre y prueba). Termina con el primer GATO,
    // con 4 respuestas OTRO seguidas, o al pasar "seg" segundos.
    async reconocerLibre(id, seg) {
      this.rx = [];
      const t0 = this.reloj.real;
      this.tx('REC');
      const ok = await this._esperar(() => this.lastOK >= t0, CFG.CAMARA_TIMEOUT_S, id);
      if (!ok) { this.tx('FIN'); return { tipo: 'camara' }; }
      const fin = t0 + seg * 1000, ids = this.gatos.map((g) => g.id);
      let otros = 0;
      while (true) {
        const m = this.rx.shift();
        if (m) {
          if (m.p[0] === 'GATO' && ids.includes(+m.p[1])) { this.tx('FIN'); return { tipo: 'gato', id: +m.p[1], p: +m.p[2], seg: Math.round((this.reloj.real - t0) / 100) / 10 }; }
          if (m.p[0] === 'OTRO' && ++otros >= 4) { this.tx('FIN'); return { tipo: 'otro' }; }
          continue;
        }
        if (this.reloj.real >= fin) { this.tx('FIN'); return { tipo: otros ? 'otro' : 'nadie' }; }
        if (this.reloj.real - this.lastOK > CFG.CAMARA_TIMEOUT_S * 1000) { this.tx('FIN'); return { tipo: 'camara' }; }
        await this.reloj.dormir(0.05); this._vivo(id);
      }
    }

    // "Probar reconocimiento" desde la app: la cámara mira, pero no se sirve comida
    async cicloPrueba(id) {
      this.prueba = { t: this.reloj.sim, estado: 'mirando' };
      this._set('RECONOCIMIENTO', 'Prueba de reconocimiento: solo mira, no sirve comida');
      const r = await this.reconocerLibre(id, CFG.PRUEBA_S);
      const g = r.tipo === 'gato' ? this.gatos.find((x) => x.id === r.id) : null;
      this.prueba = { t: this.prueba.t, fin: this.reloj.sim, estado: 'listo', resultado: r.tipo, nombre: g ? g.nombre : null, gatoId: g ? g.id : 0, p: r.p || null, seg: r.seg || null };
      const txt = { gato: g ? `reconoció a ${g.nombre} (p = ${(r.p || 0).toFixed(2)})` : '', otro: 'vio un gato que no está registrado', nadie: 'no vio a ningún gato', camara: 'la cámara no respondió' }[r.tipo];
      this.evento('Prueba de reconocimiento: ' + txt);
      this.libreCalmaHasta = this.reloj.real + 10000;
    }

    // Ciclo rápido (pulsador o app): sin reconocimiento
    async cicloRapido(id, porciones) {
      this._set('VERIFICACION', 'Ciclo rápido');
      if (!this.verificar()) throw new Abortado();
      await this.servirYCiclo(id, porciones * CFG.PORCION_G, { modo: 'Ciclo rápido' });
    }

    // Una comida completa: dosificar → presentar → consumo → revisar restos en el papel → renovar
    async servirYCiclo(id, gramos, info) {
      const n = Math.max(1, Math.min(CFG.MAX_PORCIONES, Math.round(gramos / CFG.PORCION_G)));
      this.cicloEnCurso = true;
      this.comidaActual = { g: n * 12, gato: info.gato ? info.gato.nombre : null };
      this._set('DOSIFICACION', `${n} ${n === 1 ? 'porción' : 'porciones'} (${n * 12} g)` + (info.gato ? ' para ' + info.gato.nombre : ''));
      const d = await this.dosificarRacion(id, n);
      if (!d.ok) { this.cicloEnCurso = false; this.mantenimiento(d.falla); throw new Abortado(); }
      const entrada = this.registrar({
        tipo: 'comida', gato: info.gato ? info.gato.nombre : null, gatoId: info.gato ? info.gato.id : 0,
        gramos: n * 12, modo: info.modo, p: info.p || null, horario: info.horario || null, restos: null
      });
      this.entradaActual = entrada;
      this.registrarRacion();
      this.hw.comidaPos = CFG.POS_CAIDA_MM;

      this._set('PRESENTACION', `Un movimiento corto: el papel avanza ${CFG.PRESENTACION_MM} mm hacia el gato (≈ ${seg(CFG.PRESENTACION_MM)} s)`);
      let m = await this.moverPapel(id, -CFG.PRESENTACION_MM, false);
      if (!m.ok) { this.mantenimiento(m.falla); throw new Abortado(); }

      this._set('CONSUMO');
      await this.esperarFinConsumo(id);

      this._set('CONSUMO', 'La cámara revisa si quedaron restos en el papel');
      const plato = await this.revisarPlato(id);
      entrada.restos = plato.estado;
      entrada.restosPct = plato.pct;
      const restosG = plato.estado === 'limpio' ? 1 : Math.round(n * 12 * CFG.RESTOS_FRACCION);

      this._set('RENOVACION', `El papel avanza ${CFG.RENOVACION_MM} mm: el usado y los restos van al tacho (≈ ${seg(CFG.RENOVACION_MM)} s)`);
      m = await this.moverPapel(id, CFG.RENOVACION_MM, true);
      if (!m.ok) { this.mantenimiento(m.falla); throw new Abortado(); }
      this.hw.comidaPos = null; this.cicloEnCurso = false; this.entradaActual = null;
      if (!this.fallas.papelFlojo) this.resolver('papel_flojo');      // el papel avanzó bien: ya está tenso
      this.hw.papelCiclos = Math.max(0, this.hw.papelCiclos - 1);   // Actualizar_Radios()
      this.hw.tachoG += restosG;
      this.revisarRollo();
      if (this.hw.tachoG >= CFG.TACHO_ALARMA_G) { this.mantenimiento('tacho_lleno'); throw new Abortado(); }
    }

    // Dosificar_Racion() — Figura 4.19
    async dosificarRacion(id, n) {
      let k = 0, r = 0;
      this.hw.n = n; this.hw.k = 0;
      const txtPorcion = () => (n > 1 ? `Porción ${k + 1} de ${n}: ` : '');
      while (k < n) {
        this.hw.servo = true;
        this.detalle = txtPorcion() + 'el disco dosificador gira una vuelta';
        const t0 = this.reloj.real;
        const pulso = await this._esperar(() => !this.fallas.atascoDisco && this.reloj.real - t0 >= CFG.T_VUELTA_S * 1000, CFG.T_TCRT_MAX_S, id);
        this.hw.servo = false;
        if (!pulso) {
          this.evento(`Sin pulso del TCRT5000 en 2 s (porción ${k + 1})` + (r ? '' : '; se reintenta'));
          if (r === 0) { r = 1; continue; }
          return { ok: false, falla: 'atasco_disco' };
        }
        const tp = this.reloj.real;
        this.hw.tcrtT = tp;
        const masa = MASAS_CAVIDAD[this.hw.cavidad % 6];
        const hay = this.hw.tolvaG >= masa && !this.fallas.arco;
        this.hw.cavidad++;
        this.detalle = txtPorcion() + 'la comida cae sobre el papel';
        const cayo = await this._esperar(() => hay && this.reloj.real - tp >= CFG.T_CAIDA_S * 1000, CFG.T_CAIDA_MAX_S, id);
        if (!cayo) {
          this.evento(`Sin caída en la barrera 1 s después del pulso (porción ${k + 1})` + (r ? '' : '; se reintenta'));
          if (r === 0) { r = 1; continue; }
          return { ok: false, falla: 'sin_caida' };
        }
        this.hw.barreraT = this.reloj.real;
        this.hw.tolvaG -= masa;
        this.hw.entG += CFG.PORCION_G;
        k++; r = 0; this.hw.k = k;
      }
      // La comida termina de caer y rebotar: recién entonces se mueve el papel
      this.detalle = `${n * 12} g sobre el papel: la comida se asienta`;
      const ta = this.reloj.real;
      await this._esperar(() => this.reloj.real - ta >= CFG.T_ASENTAR_S * 1000, CFG.T_ASENTAR_S + 1, id);
      return { ok: true };
    }

    // Registrar_Racion() + revisión del inventario — Anexo D.8
    registrarRacion() {
      const m = this.nivelMedido();
      if (m <= CFG.ALIMENTO_BAJO_G) { this.alerta('alimento_bajo', 'aviso'); return; }
      if (m < CFG.LECTURA_MAX_G && Math.abs((this.hw.m0G - m) - this.hw.entG) > CFG.INVENTARIO_TOL_G) this.alerta('inventario', 'aviso');
    }

    // Mover_Papel() — Figura 5.25 (simplificada: avance a velocidad constante)
    async moverPapel(id, mm, renovacion) {
      const total = Math.abs(mm), dir = Math.sign(mm);
      const normal = dir > 0 ? 'Renovando: motor 2 enrolla, motor 1 frena por PWM' : 'Presentando: motor 1 enrolla, motor 2 frena por PWM';
      let av = 0, frenado = false;
      const tira = dir > 0 ? 'm2' : 'm1', suelta = dir > 0 ? 'm1' : 'm2';
      const modos = () => { this.hw[tira] = 'enrollar'; this.hw[suelta] = 'soltar'; };
      const parar = () => { this.hw.m1 = 'freno'; this.hw.m2 = 'freno'; this.hw.frenoHasta = this.reloj.real + 400; };
      this.hw.motores = normal;
      while (av < total) {
        this._vivo(id);
        if (this.hw.papelCiclos <= 0) { parar(); this.hw.motores = 'Detenidos'; this.evento('El TCRT5000 del recorrido ya no ve papel'); return { ok: false, falla: 'fin_papel' }; }
        // Primero el gato: en la renovación no se mueve el papel si está delante (Tabla 5.10)
        if (renovacion && this.gatoPresente()) {
          if (!frenado) { this.evento('Gato frente al papel: se frenan los motores'); frenado = true; }
          this.hw.motores = 'Frenados: el gato está frente al papel'; this.hw.m1 = 'freno'; this.hw.m2 = 'freno';
          await this.reloj.dormir(0.1); continue;
        }
        if (frenado) { this.evento('El gato se fue: sigue la renovación'); frenado = false; this.hw.motores = normal; }
        modos();
        if (this.fallas.atascoPapel) {
          await this.reloj.dormir(CFG.T_ATASCO_PAPEL_S); this._vivo(id);
          parar(); this.hw.motores = 'Detenidos'; this.evento('Ninguna cuenta del encoder en 0.3 s: freno'); return { ok: false, falla: 'atasco_papel' };
        }
        await this.reloj.dormir(0.1); this._vivo(id);
        av += CFG.VEL_PAPEL_MM_S * 0.1;
        if (this.hw.comidaPos !== null) this.hw.comidaPos += dir * CFG.VEL_PAPEL_MM_S * 0.1;
      }
      parar(); this.hw.motores = 'Detenidos';
      return { ok: true };
    }

    // Esperar_Fin_Consumo(): 5 min sin gato o 60 min como máximo
    async esperarFinConsumo(id) {
      const t0 = this.reloj.sim;
      this.lastMovSim = Math.max(this.lastMovSim, t0);
      this.finConsumoPedido = false;
      const mmss = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
      while (true) {
        this._vivo(id);
        const s = this.reloj.sim;
        const sin = s - this.lastMovSim;
        const lim = this.config.consumoSinGatoMin * 60000;
        const presente = this.reloj.real - this.lastMovReal < CFG.GATO_SE_FUE_S * 1000;
        this.detalle = presente
          ? `El gato sigue frente a la comida (el PIR ve movimiento). Cuando se vaya, se esperan ${this.config.consumoSinGatoMin} min y se limpia`
          : `El gato se fue: el papel se limpia en ${mmss(lim - sin)} si no vuelve`;
        if (this.finConsumoPedido) { this.finConsumoPedido = false; this.evento('El dueño indicó que el gato terminó de comer'); return 'el dueño'; }
        if (sin >= lim) return 'se fue';
        if (s - t0 >= this.config.consumoMaxMin * 60000) return 'tiempo máximo';
        await this.reloj.dormir(0.1);
      }
    }

    // Revisar si quedaron restos en el papel (la cámara compara con la foto del papel limpio)
    async revisarPlato(id) {
      this.rx = [];
      this.tx('REVISAR');
      let res = null;
      await this._esperar(() => {
        const m = this.rx.find((x) => ['LIMPIO', 'RESTOS', 'SINREF'].includes(x.p[0]));
        if (m) res = m; return !!m;
      }, CFG.CAMARA_TIMEOUT_S, id);
      if (!res || res.p[0] === 'SINREF') return { estado: 'sin revisar', pct: null };
      if (res.p[0] === 'LIMPIO') return { estado: 'limpio', pct: +res.p[1] || 0 };
      return { estado: 'restos', pct: +res.p[1] || 0 };
    }

    // ---------- Comandos de la app (vía nube) ----------
    ejecutar(c) {
      switch (c.tipo) {
        case 'servir':
          if (this.estado === 'MANTENIMIENTO') { this.evento('Orden de la app ignorada: equipo en mantenimiento'); return; }
          if (this.estado === 'INICIO') { this.evento('Orden de la app ignorada: el equipo está encendiendo'); return; }
          if (!this.iniciarCiclo((id) => this.cicloRapido(id, c.porciones), `App: servir ${c.porciones} ${c.porciones === 1 ? 'porción' : 'porciones'}`)) this.evento('Orden de la app ignorada: hay un ciclo en curso');
          return;
        case 'confirmar': this.confirmar('la app'); return;
        case 'terminoComer':   // el dueño ve que el gato ya terminó: no se esperan los 5 min
          if (this.estado === 'CONSUMO') this.finConsumoPedido = true;
          else this.evento('Orden "ya terminó de comer" ignorada: no hay un gato comiendo');
          return;
        case 'resolverAviso': this.resolver(c.alerta); return;
        case 'registrar': this.tx('REG,' + c.gatoId); return;
        case 'borrarGato': if (this.nube.huellas) delete this.nube.huellas['g' + c.gatoId]; this.tx('BORRAR,' + c.gatoId); return;
        case 'registrarFondo': this._inst().fondoOk = false; this.tx('REG,0'); return;
        case 'calibrarPlato': this._inst().platoOk = false; this.tx('CALPAPEL'); return;
        case 'ver':     // el dueño quiere ver la cámara: se permite en cualquier estado (sirve para ver una falla)
          this.verHasta = this.reloj.real + Math.min(120, c.seg || 60) * 1000;
          this.tx('VER'); this.evento('App: el dueño mira la cámara (la cámara enciende su Wi-Fi)');
          return;
        case 'nover':
          if (this.verHasta) { this.verHasta = 0; this.tx('NOVER'); this.evento('App: el dueño dejó de mirar la cámara'); }
          return;
        case 'probar':
          if (!this.iniciarCiclo((id) => this.cicloPrueba(id), 'App: probar el reconocimiento')) {
            const motivo = this.estado === 'MANTENIMIENTO' ? 'el equipo está en mantenimiento' : this.estado === 'INICIO' ? 'el equipo está encendiendo'
              : this.estado === 'CONSUMO' ? 'hay un gato comiendo; espera a que termine el ciclo (o toca "Ya terminó de comer" en Inicio)' : 'hay un ciclo en curso';
            this.prueba = { t: this.reloj.sim, estado: 'listo', resultado: 'ocupado', motivo };
            this.evento('Prueba de reconocimiento no iniciada: ' + motivo);
          }
          return;
      }
    }

    // ---------- Sincronización con la nube ----------
    sincronizar() {
      if (this.fallas.sinInternet) {
        if (!this.desconectadoDesde) { this.desconectadoDesde = this.reloj.sim; this.pendientes = 0; this.evento('Sin internet: sigue con la configuración guardada'); }
        return;
      }
      if (this.desconectadoDesde) {
        this.evento(`Conexión recuperada: se enviaron ${this.pendientes} registros pendientes`);
        this.desconectadoDesde = null; this.pendientes = 0;
      }
      // Si la nube aún no tiene configuración (la app todavía no se conectó), se sigue con la última conocida
      if (this.nube.config && typeof this.nube.config === 'object') this.config = Object.assign(clone(CONFIG_DEF), clone(this.nube.config));
      if (Array.isArray(this.nube.gatos)) this.gatos = clone(this.nube.gatos);
      if (!Array.isArray(this.nube.comandos)) this.nube.comandos = [];
      while (this.nube.comandos.length) { const c = this.nube.comandos.shift(); try { this.ejecutar(c); } catch (e) { this._errorInterno(e); } }
      this.nube.estado = this.resumen();
      this.nube.alertas = clone(this.alertas);
      // En la nube cada registro lleva también su fecha y hora legibles (para mirar Firebase a mano)
      this.nube.historial = this.historial.map((h) => Object.assign(clone(h), { t: Math.round(h.t), fecha: fechaLeible(h.t), hora: hhmm(h.t) }));
      this.nube.ultimaSync = Math.round(this.reloj.sim);
    }

    resumen() {
      const m = this.nivelMedido();
      const diaria = this.racionDiariaG();
      return {
        estado: this.estado, detalle: this.detalle, led: this.led(),
        nivelG: m, nivelPct: Math.round((m / CFG.TOLVA_MAX_G) * 100), diasAlimento: Math.floor(m / diaria),
        papelCiclos: this.hw.papelCiclos, diasPapel: Math.floor(this.hw.papelCiclos / this.comidasPorDia()),
        tachoG: this.hw.tachoG, tachoPct: Math.min(100, Math.round((this.hw.tachoG / CFG.TACHO_ALARMA_G) * 100)),
        diasTacho: Math.max(0, Math.floor((this.reloj.sim - this.hw.vaciadoSim) / 86400000)),
        camara: Object.assign({ despierta: this.camaraViva() }, (() => { try { return this.infoCamara ? this.infoCamara() : {}; } catch (e) { return {}; } })()), hora: Math.round(this.reloj.sim),
        cr: this.cr ? this.cr.porciones : 0,
        comida: this.cicloEnCurso && this.comidaActual ? this.comidaActual : null,
        modo: this.config.modo === 'libre' ? 'libre' : 'horario', prueba: this.prueba,
        viendo: this.verHasta ? Math.max(0, Math.round((this.verHasta - this.reloj.real) / 1000)) : 0,
        vel: this.reloj.vel, horaReal: this.reloj.vel === 1 && Math.abs(this.reloj.sim - Date.now()) < 90000
      };
    }

    // ---------- Bucle principal ----------
    tick(dt) {
      this.reloj.tick(dt);
      try { this._tick(); } catch (e) { this._errorInterno(e); }
      try { if (this.reloj.real >= this.proxSync) { this.proxSync = this.reloj.real + CFG.SYNC_S * 1000; this.sincronizar(); } } catch (e) { this._errorInterno(e); }
    }
    _errorInterno(e) {
      console.error(e);
      const msg = 'Error interno: ' + (e && e.message);
      if (!this.eventos[0] || this.eventos[0].texto !== msg) this.evento(msg);
    }
    _tick() {
      const r = this.reloj.real, s = this.reloj.sim;
      if (this.hw.m1 === 'freno' && this.hw.m2 === 'freno' && r > this.hw.frenoHasta && !/Frenados/.test(this.hw.motores)) { this.hw.m1 = 'libre'; this.hw.m2 = 'libre'; }
      if (this.pulsador.abajo && !this.pulsador.largo && r - this.pulsador.t >= CFG.PULSACION_LARGA_S * 1000) {
        this.pulsador.largo = true; this.pulsacionLarga();
      }
      if (this.cr && !this.pulsador.abajo && r - this.cr.t >= CFG.CICLO_RAPIDO_ESPERA_S * 1000) {
        const n = this.cr.porciones; this.cr = null;
        if (!this.iniciarCiclo((id) => this.cicloRapido(id, n), `Ciclo rápido local: ${n} ${n === 1 ? 'porción' : 'porciones'}`)) this.evento('Ciclo rápido no iniciado: equipo ocupado');
      }
      // Horarios: se disparan al cruzar la hora programada
      for (const h of (this.config.horarios || []).filter((x) => /^\d{1,2}:\d{2}$/.test(x))) {
        for (const base of [s - 86400000, s]) {
          const t = horaEnDia(base, h);
          if (t > this.ultimoCheckSim && t <= s) {
            const clave = fecha(t) + ' ' + h;
            if (this.hechos[clave] || !this.horariosActivos || this.config.horariosActivos === false || this.config.modo === 'libre') continue;
            this.hechos[clave] = true;
            if (s - t > 10 * 60000) continue;
            if (this.estado === 'MANTENIMIENTO') { this._omitirTodos(h, 'equipo en mantenimiento'); this.evento('Horario de las ' + h + ' omitido: mantenimiento'); }
            else if (this.ocupado || this.cr) this.colaHorario = h;
            else this.iniciarCiclo((id) => this.cicloHorario(id, h), 'Horario de las ' + h);
          }
        }
      }
      this.ultimoCheckSim = s;
      if (this.colaHorario && this.config.modo === 'libre') this.colaHorario = null;
      if (this.colaHorario && !this.ocupado && !this.cr && this.estado === 'ESPERA') {
        const h = this.colaHorario; this.colaHorario = null;
        this.iniciarCiclo((id) => this.cicloHorario(id, h), 'Horario de las ' + h + ' (en cola)');
      }
      // Modo libre: el PIR vio movimiento hace menos de 1.5 s → ¿quién llegó?
      if (this.config.modo === 'libre' && this.horariosActivos && this.config.horariosActivos !== false &&
          !this.ocupado && !this.cr && this.estado === 'ESPERA' && r - this.lastMovReal < 1500 && r >= this.libreCalmaHasta) {
        this.iniciarCiclo((id) => this.cicloLibre(id), 'Modo libre: el PIR vio movimiento');
      }
      // Modo por horarios: se anota que hubo movimiento fuera de hora (como mucho 1 vez por minuto)
      if (this.config.modo !== 'libre' && this.estado === 'ESPERA' && !this.ocupado && !this.cr && r - this.lastMovReal < 1500 && r >= (this.avisoMovHasta || 0)) {
        this.avisoMovHasta = r + 60000;
        this.evento('El PIR vio movimiento, pero no es hora de comer (modo por horarios): la cámara no busca al gato');
      }
      if (!this.ocupado && this.estado === 'ESPERA') this.revisarTacho();
      if (this.verHasta && r >= this.verHasta) { this.verHasta = 0; this.tx('NOVER'); }
    }

    // ---------- Persistencia ----------
    exportar() {
      return {
        hw: this.hw, fallas: this.fallas, alertas: this.alertas, historial: this.historial,
        eventos: this.eventos.slice(0, 30), hechos: this.hechos, sim: this.reloj.sim, vel: this.reloj.vel,
        estado: this.estado === 'MANTENIMIENTO' ? 'MANTENIMIENTO' : 'ESPERA', motivoMant: this.motivoMant,
        cicloEnCurso: this.cicloEnCurso, _id: this._id
      };
    }
    importar(e) {
      try {
        Object.assign(this.hw, e.hw || {});   // las fallas simuladas (casillas) no se recuerdan: al recargar el equipo vuelve sano
        this.alertas = e.alertas || []; this.historial = e.historial || []; this.eventos = e.eventos || [];
        this.hechos = e.hechos || {}; this.reloj.sim = e.sim || this.reloj.sim; this.reloj.vel = e.vel || 60;
        this.ultimoCheckSim = this.reloj.sim; this.motivoMant = e.motivoMant || null;
        this.cicloEnCurso = !!e.cicloEnCurso; this._id = e._id || 1;
        // Comidas viejas que quedaron sin revisar (se cerró la página en otra versión): no quedan en "comiendo…"
        this.historial.forEach((h, i) => { if (h.tipo === 'comida' && !h.restos && (i > 0 || !this.cicloEnCurso)) h.restos = 'interrumpida'; });
        this.hw.servo = false; this.hw.motores = 'Detenidos'; this.hw.m1 = 'libre'; this.hw.m2 = 'libre';
        if (e.estado === 'MANTENIMIENTO') this._set('MANTENIMIENTO', TEXTOS[this.motivoMant] || '');
      } catch (err) { console.warn('No se pudo cargar el estado guardado', err); }
    }
  }

  function setTimeoutReloj(c, s, fn) { c.reloj.dormir(s).then(fn); }

  const api = { Comedero, CFG, CONFIG_DEF, ESTADOS, TEXTOS, FALLAS_MANT, nubeNueva, hhmm, fecha, horaEnDia, Abortado };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimComedero = api;
})(typeof window !== 'undefined' ? window : globalThis);
