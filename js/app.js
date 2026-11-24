/* ============================================================================
 * app.js — App del dueño (PWA / APK)
 * Solo habla con la nube (Tabla 7.6): escribe /config, /gatos y /comandos, y
 * lee /estado, /alertas, /historial, /huellas e /instalacion que publica el
 * comedero. En app.html funciona sola (celular); en demo.html comparte la
 * página con el comedero simulado.
 * ==========================================================================*/
(function () {
  'use strict';
  const S = window.SimComedero;
  const { CFG, hhmm, horaEnDia } = S;
  const CTX = window.CTX || {};
  const ROL = CTX.nube ? 'todo' : 'app';
  const CLAVE_APP = 'comedero_app_v2_' + ROL;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const leer = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };

  // ---------- Nube y conexión ----------
  const nube = CTX.nube || window.cargarNube('app');
  const con = CTX.con || new ConexionNube(nube, 'app');
  if (!CTX.con) {
    con.iniciar();
    setInterval(() => con.publicar(), 700);
    setInterval(() => window.guardarNube('app', nube), 2000);
  }
  const app = Object.assign({ onboarding: false, nombre: '', paso: 0 }, leer(CLAVE_APP) || {});
  setInterval(() => { try { localStorage.setItem(CLAVE_APP, JSON.stringify(app)); } catch (e) { /* */ } }, 2000);
  nube.config.horariosActivos = !!app.onboarding;

  let vista = 'inicio', porcionesApp = 1, registrando = null, probando = null, nuevoGato = { nombre: '', racionG: 24 };
  let ultimoHTML = '', syncVisto = { v: undefined, t: performance.now() }, vioComedero = false;

  // ---------- Utilidades ----------
  const COLOR_LED = { verde: '#3bd16f', azul: '#378add', amarillo: '#f5c518', rojo: '#e24b4a', blanco: '#d3d1c7' };
  const ESTADO_AMIGABLE = {
    INICIO: 'Encendiendo', VERIFICACION: 'Revisando el equipo', ESPERA: 'Listo', RECONOCIMIENTO: 'Esperando a tu gato',
    DOSIFICACION: 'Sirviendo la comida', PRESENTACION: 'Acercando la comida', CONSUMO: 'Hora de comer',
    RENOVACION: 'Renovando el papel', MANTENIMIENTO: 'Necesita tu ayuda'
  };
  const COLLARES = ['rojo', 'azul', 'amarillo', 'verde'];
  const ahoraSim = () => (nube.estado && nube.estado.hora) || Date.now();
  const huella = (id) => (nube.huellas || {})['g' + id] || null;
  const camInfo = () => ((nube.estado || {}).camara) || {};
  const idLibre = () => [1, 2, 3, 4].find((i) => !nube.gatos.some((g) => g.id === i));
  const gatoPorId = (i) => nube.gatos.find((g) => g.id === i);
  function proximoHorario() {
    const s = ahoraSim(); let mejor = null;
    for (let d = 0; d < 2; d++) for (const h of nube.config.horarios) { const t = horaEnDia(s + d * 86400000, h); if (t > s && (!mejor || t < mejor)) mejor = t; }
    return mejor ? hhmm(mejor) : '—';
  }
  function desconectado() {
    if (nube.ultimaSync !== syncVisto.v) { syncVisto = { v: nube.ultimaSync, t: performance.now() }; if (nube.ultimaSync) vioComedero = true; }
    return !nube.ultimaSync || performance.now() - syncVisto.t > 3500;
  }
  function enviarComando(c, texto) {
    con.enviarComando(c);
    toast(desconectado() ? 'Se enviará cuando el comedero se conecte' : (texto || 'Enviado al comedero'));
  }
  let toastT = null;
  function toast(t) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; $('.telefono').appendChild(el); }
    el.textContent = t; el.style.opacity = '1';
    clearTimeout(toastT); toastT = setTimeout(() => { el.style.opacity = '0'; }, 2400);
  }
  const dias = (n) => (n === 1 ? '1 día' : (n || 0) + ' días');
  const esLibre = () => nube.config.modo === 'libre';
  const horas = (m) => (m % 60 ? m + ' min' : m / 60 + (m === 60 ? ' hora' : ' horas'));
  // ---------- Ver a mi gato (foto en vivo de la cámara) ----------
  let verPedido = 0;
  const hms = (ms) => { const d = new Date(ms); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'); };
  function viendo() { return ((nube.estado || {}).viendo || 0) > 0 || performance.now() - verPedido < 5000; }
  function htmlVista(compacto) {
    const v = nube.vista, e = nube.estado || {}, cm = e.camara || {};
    if (!viendo()) return '';
    if (!v || !v.jpg) {
      const msg = desconectado() ? 'El comedero no está conectado.' : cm.webcam === false ? 'La cámara del comedero está apagada (enciende la webcam en la página del comedero).' : 'Encendiendo la cámara y su Wi-Fi…';
      return `<div class="vista vista-espera"><span>${esc(msg)}</span></div>`;
    }
    const c = v.caja;
    return `<div class="vista"><img src="${v.jpg}" alt="Lo que ve la cámara del comedero"><span class="en-vivo-tag">EN VIVO</span>` +
      (c ? `<i class="vista-caja" style="left:${c.x * 100}%;top:${c.y * 100}%;width:${c.w * 100}%;height:${c.h * 100}%" data-txt="${esc(v.texto || '')}"></i>` : '') + `</div>` +
      (compacto ? '' : `<p class="mini">Foto de las ${hms(v.t)} · ${v.kb} KB · ${e.viendo ? `se apaga en ${e.viendo} s` : 'apagándose'}</p>`);
  }
  function htmlVerGato() {
    if (!viendo()) {
      return `<div class="tarjeta"><h4>Ver a tu gato</h4><p class="mini">Mira por la cámara del comedero desde donde estés. Se apaga sola al minuto, para cuidar tu privacidad y la energía.</p>
        <button class="grande" data-act="ver"><span class="ic-cam"></span> Ver la cámara en vivo</button></div>`;
    }
    return `<div class="tarjeta"><h4>Cámara del comedero</h4>${htmlVista(false)}
      <div class="fila-botones"><button data-act="ver">Seguir mirando</button><button data-act="nover">Cerrar</button></div></div>`;
  }

  // Las 4 formas de dar comida: a sus horas, cuando llega (libre), desde el celular y con el botón
  function htmlModo() {
    const c = nube.config, lib = esLibre();
    return `<div class="tarjeta"><h4>¿Cuándo come?</h4><div class="modos">
      <button data-act="modo" data-m="horario" class="${!lib ? 'on' : ''}"><b>A sus horas</b><span>${c.horarios.join(' · ')}</span></button>
      <button data-act="modo" data-m="libre" class="${lib ? 'on' : ''}"><b>Cuando llegue</b><span>cada ${horas(c.libreIntervaloMin || 120)} como mínimo, hasta ${c.libreMaxDia || 4} al día</span></button></div>
      <p class="mini">${lib ? 'Cuando tu gato se acerca, la cámara lo reconoce y, si ya pasó el tiempo mínimo, le sirve.' : 'A cada hora, la cámara espera a tu gato y le sirve cuando lo reconoce.'} También puedes servir aquí abajo o con el botón del comedero (cada toque = 12 g).</p></div>`;
  }

  // ======================= VISTAS =======================
  const vistaEl = $('#app-vista');
  $$('#app-nav button').forEach((b) => b.addEventListener('click', () => irA(b.dataset.vista)));
  function irA(v) {
    vista = v; ultimoHTML = '';
    $$('#app-nav button').forEach((b) => b.classList.toggle('on', b.dataset.vista === v));
    animar = true; renderApp(true); vistaEl.scrollTop = 0;
  }
  function renderApp(forzar) {
    if (!app.onboarding) { $('#app-nav').style.display = 'none'; pintar(htmlBienvenida(), forzar); return; }
    $('#app-nav').style.display = '';
    pintar(vista === 'inicio' ? htmlInicio() : vista === 'gatos' ? htmlGatos() : vista === 'historial' ? htmlHistorial() : htmlAjustes(), forzar);
  }
  // Pintar sin parpadeo: al cambiar de pantalla se reemplaza todo (con una animación corta);
  // en las actualizaciones solo se cambia lo que cambió (el resto del DOM queda igual).
  let animar = true;
  function pintar(html, forzar) {
    if (!forzar && html === ultimoHTML) return;
    ultimoHTML = html;
    if (animar || !vistaEl.firstChild) {
      animar = false; vistaEl.innerHTML = html;
      vistaEl.classList.add('entrando'); clearTimeout(pintar.t); pintar.t = setTimeout(() => vistaEl.classList.remove('entrando'), 350);
      return;
    }
    const t = document.createElement('template'); t.innerHTML = html;
    morfar(vistaEl, t.content);
  }
  function morfar(viejo, nuevo) {
    const vc = Array.from(viejo.childNodes), nc = Array.from(nuevo.childNodes);
    if (vc.length !== nc.length) { viejo.replaceChildren(...nc); return; }
    for (let i = 0; i < vc.length; i++) {
      const a = vc[i], b = nc[i];
      if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); continue; }
      if (a.nodeType === 3) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; continue; }
      if (a.nodeType !== 1 || a.isEqualNode(b)) continue;
      Array.from(a.attributes).forEach((x) => { if (!b.hasAttribute(x.name)) a.removeAttribute(x.name); });
      Array.from(b.attributes).forEach((x) => { if (a.getAttribute(x.name) !== x.value) a.setAttribute(x.name, x.value); });
      morfar(a, b);
    }
  }
  function actualizarApp() {
    const est = nube.estado || {};
    const reloj = hhmm(ahoraSim()) + (est.vel > 1 ? ` · ×${est.vel}` : est.horaReal === false ? ' · hora simulada' : '');
    if ($('#tel-hora').textContent !== reloj) $('#tel-hora').textContent = reloj;
    $('#tel-con').textContent = desconectado() ? 'Comedero sin conexión' : 'Comedero conectado';
    if (!app.onboarding) { actualizarRegistro(); actualizarBienvenidaDinamica(); return; }
    if (vista === 'inicio' || vista === 'historial') renderApp(false);
    if (vista === 'gatos') { actualizarRegistro(); actualizarGatosDinamico(); actualizarPrueba(); actualizarAjustesDinamico(); }
    if (vista === 'ajustes') actualizarAjustesDinamico();
  }
  setInterval(actualizarApp, 400);

  function bannerConexion() {
    if (!desconectado()) return '';
    if (!vioComedero) {
      if (con.modo === 'pestanas') return `<div class="banner">Buscando el comedero… Abre <b>comedero.html</b> en otra pestaña de este navegador, o conecta Firebase para usar la app en el celular.</div>`;
      if (con.modo === 'firebase') return `<div class="banner">Conectado a Firebase. Esperando que el comedero (${esc(con.codigo)}) se encienda.</div>`;
      return '';
    }
    // En la demo (app y comedero en la misma página) se dice la causa: la falla simulada "Sin internet"
    const demoSinInternet = CTX.comedero && CTX.comedero.fallas && CTX.comedero.fallas.sinInternet;
    return `<div class="banner">El comedero no se conecta desde las ${nube.ultimaSync ? hhmm(nube.ultimaSync) : '—'}. Sigue funcionando con tu configuración y enviará el historial al volver.` +
      (demoSinInternet ? `<br><b>En la demo:</b> está activada la falla "Sin internet" del comedero simulado. Desmárcala en el panel Fallas para reconectar.` :
        con.modo === 'pestanas' ? '<br>¿Sigue abierta la pestaña del comedero?' : '') + `</div>`;
  }

  // ---------- Inicio ----------
  const TITULO = {
    ESPERA: 'Todo listo', RECONOCIMIENTO: 'Esperando a tu gato', DOSIFICACION: 'Sirviendo la comida',
    PRESENTACION: 'Acercando la comida', CONSUMO: 'Hora de comer', RENOVACION: 'Renovando el papel',
    MANTENIMIENTO: 'Necesito tu ayuda', INICIO: 'Encendiendo', VERIFICACION: 'Revisando el equipo'
  };
  function htmlInicio() {
    const e = nube.estado || {};
    const led = e.led || { color: 'verde' };
    const activas = (nube.alertas || []).filter((a) => a.activa);
    const comidas = (nube.historial || []).filter((h) => ['comida', 'omitida', 'visita'].includes(h.tipo)).slice(0, 4);
    let fecha = new Date(ahoraSim()).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }); fecha = fecha.charAt(0).toUpperCase() + fecha.slice(1);
    let h = `<div class="saludo-fila"><div><p class="saludo">Hola${app.nombre ? ', ' + esc(app.nombre) : ''}</p><p class="mini fecha">${esc(fecha)}</p></div>${Dibujos.avatar(app.nombre || 'Tú', null, 38)}</div>` + bannerConexion();
    const sub = e.estado === 'ESPERA' ? (esLibre() ? 'Modo libre: le sirvo cuando llegue tu gato' : 'Próxima comida a las ' + proximoHorario()) : (e.detalle || '');
    h += `<div class="hero hero-${led.color}">${Dibujos.escena(e.estado || 'INICIO')}<div class="hero-txt"><span class="punto ${led.parpadeo ? 'parpadeo' : ''}" style="background:${COLOR_LED[led.color] || '#888'}"></span><div><b>${esc(TITULO[e.estado] || 'Conectando…')}</b><div class="mini">${esc(sub)}</div></div></div></div>`;
    activas.forEach((a) => {
      h += `<div class="alerta ${a.nivel}"><b>${a.nivel === 'falla' ? 'Falla' : 'Aviso'}:</b> ${esc(a.texto)}<br>` +
        (a.nivel === 'falla' ? `<button data-act="confirmar">Ya lo resolví</button>` : `<button data-act="entendido" data-tipo="${a.tipo}">Entendido</button>`) + `</div>`;
    });
    const mant = e.estado === 'MANTENIMIENTO';
    // En mantenimiento siempre hay forma de confirmar desde la app, aunque la alerta ya se haya resuelto
    // (p. ej. ya pusiste el rollo nuevo: falta confirmar para que tense el papel)
    if (mant && !activas.some((a) => a.nivel === 'falla')) {
      h += `<div class="alerta falla"><b>Mantenimiento:</b> ${esc(e.detalle || 'el comedero espera que confirmes')}<br><button data-act="confirmar">Ya lo resolví</button></div>`;
    }
    if (e.estado === 'CONSUMO' && !/revisa si quedaron restos/.test(e.detalle || '')) {
      h += `<div class="tarjeta"><h4>Tu gato está comiendo</h4><p class="mini">El papel se limpia solo cuando el gato se va. Si ya ves que terminó, puedes limpiarlo ahora (si sigue frente a la comida, el papel no se mueve).</p>
        <button data-act="terminoComer">Ya terminó de comer: limpiar ahora</button></div>`;
    }
    h += htmlVerGato();
    h += htmlModo();
    h += `<div class="tarjeta"><h4>Servir ahora</h4><div class="segmento">` +
      [1, 2, 3, 4].map((n) => `<button data-act="porciones" data-n="${n}" class="${porcionesApp === n ? 'on' : ''}"><span class="croq">${'●'.repeat(n)}</span>${n * 12} g</button>`).join('') +
      `</div><button class="primario grande" data-act="servir" ${mant ? 'disabled' : ''}>Servir ${porcionesApp * 12} g ahora</button>` +
      `<p class="mini">${mant ? 'Primero resuelve la alerta de arriba.' : 'Sale enseguida, sin esperar a la cámara.'}</p></div>`;
    const pctPapel = Math.round(((e.papelCiclos || 0) / CFG.ROLLO_CICLOS) * 100);
    const colorNivel = (p, malo) => (malo ? '#E24B4A' : p <= 25 ? '#EF9F27' : '#1D9E75');
    h += `<div class="anillos">
      <div class="anillo-caja">${Dibujos.anillo(e.nivelPct, colorNivel(e.nivelPct, (e.nivelG || 0) <= 300), (e.nivelPct || 0) + '%')}<b>Alimento</b><span>≈ ${dias(e.diasAlimento)}</span></div>
      <div class="anillo-caja">${Dibujos.anillo(pctPapel, colorNivel(pctPapel, (e.papelCiclos || 0) === 0), e.papelCiclos != null ? e.papelCiclos : '—')}<b>Papel</b><span>ciclos · ≈ ${dias(e.diasPapel)}</span></div>
      <div class="anillo-caja">${Dibujos.anillo(e.tachoPct, (e.tachoPct || 0) >= 100 ? '#E24B4A' : (e.tachoPct || 0) >= 80 ? '#EF9F27' : '#378ADD', (e.tachoPct || 0) + '%')}<b>Tacho</b><span>vaciado hace ${dias(e.diasTacho)}</span></div>
    </div>`;
    const cm = e.camara || {};
    h += `<div class="chip-cam ${cm.despierta ? 'on' : ''}"><span class="ojo"></span>${cm.pred ? 'La cámara está mirando: ' + esc(cm.pred.mejor) + ' ' + Math.round(cm.pred.p * 100) + ' %' : cm.despierta ? 'Cámara despierta' : 'Cámara dormida: despierta cuando el PIR ve movimiento'}</div>`;
    h += `<div class="tarjeta"><h4>Últimas comidas</h4>${comidas.length ? `<div class="linea">${comidas.map(filaHist).join('')}</div>` : '<div class="vacio-txt">' + (esLibre() ? 'Todavía no hay comidas. Cuando tu gato se acerque, la cámara lo reconocerá y le servirá.' : 'Todavía no hay comidas. La primera llegará a las ' + proximoHorario() + '.') + '</div>'}</div>`;
    return h;
  }
  function filaHist(x) {
    const g = x.gatoId ? gatoPorId(x.gatoId) : null;
    const quien = x.gato || (/^Ciclo rápido/.test(x.modo) ? 'Ciclo rápido' : 'Sin gato identificado');
    const av = Dibujos.avatar(x.gato || (/^Ciclo/.test(x.modo) ? '+' : '?'), g && g.collar, 34);
    if (x.tipo === 'visita') {
      const n = x.veces > 1 ? ` (${x.veces} veces)` : '';
      return `<div class="item omitida">${Dibujos.avatar(x.gato || '?', g && g.collar, 34)}<div class="item-txt"><b>${esc(x.gato || 'Un gato no registrado')} vino${n}</b><div class="t2">${hhmm(x.t)}${x.veces > 1 && x.ultima ? '–' + hhmm(x.ultima) : ''} · ${esc(x.detalle || x.modo)}</div></div><span class="pill-g gris">no se sirvió</span></div>`;
    }
    if (x.tipo === 'omitida') return `<div class="item omitida">${av}<div class="item-txt"><b>${esc(quien)} no vino</b><div class="t2">${hhmm(x.t)} · ${esc(x.modo.replace('Ración omitida: ', ''))}</div></div><span class="pill-g gris">omitida</span></div>`;
    const plato = x.restos === 'restos' ? `<span class="warn">dejó un poco (${x.restosPct} %)</span>` : x.restos === 'limpio' ? '<span class="ok">comió todo</span>' : x.restos === 'interrumpida' ? 'se interrumpió (corte de luz o falla)' : !x.restos ? 'comiendo…' : 'papel sin revisar';
    const como = /reconocido/i.test(x.modo) ? `${/Modo libre/.test(x.modo) ? 'llegó solo y ' : ''}la cámara lo reconoció${x.p ? ' (' + Math.round(x.p * 100) + ' %)' : ''}` : esc(x.modo.toLowerCase());
    return `<div class="item">${av}<div class="item-txt"><b>${esc(quien)}</b><div class="t2">${hhmm(x.t)} · ${como}</div><div class="t2">${plato}</div></div><span class="pill-g">${x.gramos} g</span></div>`;
  }

  // ---------- Mis gatos ----------
  function htmlGatos() {
    const fondoOk = !!(nube.instalacion || {}).fondoOk;
    let h = `<p class="saludo">Mis gatos</p><p class="mini">El comedero aprende a reconocer a cada gato con un video corto (unos 30 s), sin enviar fotos a internet. Puede ser tu gato, un peluche o la foto de un gato en tu celular: lo importante es que llene el centro de la cámara.</p>` + bannerConexion();
    if (!fondoOk) {
      h += `<div class="tarjeta destacada"><h4>Paso 1 · Lo que ve la cámara sin gato</h4>
        <p class="mini">Antes de registrar gatos, la cámara necesita ver el lugar del comedero <b>sin gato</b>, tal como se ve siempre. Así sabe qué es "no hay nadie". Aleja a tu gato de la cámara y toca el botón. Tarda unos 30 s.</p>
        <div class="fila" style="border:0"><div>Fondo vacío<div class="t2" id="aj-fondo">Sin registrar</div></div><button class="primario" data-act="fondo">Registrar el fondo</button></div></div>`;
    } else {
      h += `<div class="fila"><div>Fondo vacío<div class="t2" id="aj-fondo"><span class="ok">Registrado</span></div></div><button data-act="fondo">Volver a registrar</button></div>`;
    }
    if (fondoOk && nube.gatos.some((g) => huella(g.id))) {
      h += `<div class="tarjeta"><h4>Probar reconocimiento</h4><p class="mini">Pon a tu gato frente al comedero. La cámara lo mira hasta 30 s y te dice a quién ve. No sale comida.</p>
        <button class="primario grande" data-act="probar">Probar ahora</button><div id="prueba-zona"></div></div>`;
    }
    if (!nube.gatos.length) h += `<div class="vacio-txt">Aún no registras a ningún gato</div>`;
    else h += `<div class="fila" style="border:0"><b>Tus gatos (${nube.gatos.length} de 4)</b>${nube.gatos.length < 4 ? '<button data-act="ir-agregar">+ Agregar otro gato</button>' : ''}</div>`;
    nube.gatos.forEach((g) => {
      const hu = huella(g.id);
      const parecido = hu && hu.parecido && gatoPorId(hu.parecidoA);
      h += `<div class="tarjeta">
        <div class="fila" style="border:0;padding-top:0"><div class="gato-cab">${Dibujos.avatar(g.nombre, g.collar, 44)}<div><b style="font-size:15px">${esc(g.nombre)}</b> ${g.collar ? `<span class="chip"><span class="collar c-${g.collar}"></span> collar ${g.collar}</span>` : ''}
        <div class="t2" data-huella="${g.id}">${hu ? `Huella: ${hu.n} fotos` : '<span class="warn">Sin registrar en la cámara</span>'}</div></div></div>
        <select data-act-change="racion" data-id="${g.id}" aria-label="Ración">${[12, 24, 36, 48].map((v) => `<option value="${v}" ${g.racionG === v ? 'selected' : ''}>${v} g</option>`).join('')}</select></div>
        ${parecido ? `<div class="alerta aviso">${esc(g.nombre)} se parece a ${esc(parecido.nombre)}. Para distinguirlos, ponles collares de colores distintos y elígelos aquí.</div>` : ''}
        <div class="form-fila"><label>Collar (solo si se parece a otro gato)</label>
          <select data-act-change="collar" data-id="${g.id}"><option value="">Sin collar</option>${COLLARES.map((c) => `<option value="${c}" ${g.collar === c ? 'selected' : ''} ${nube.gatos.some((o) => o.id !== g.id && o.collar === c) ? 'disabled' : ''}>${c}</option>`).join('')}</select></div>
        <div class="fila-botones"><button data-act="registrar" data-id="${g.id}" ${fondoOk ? '' : 'disabled'}>${hu ? 'Mejorar reconocimiento' : 'Registrar con la cámara'}</button><button class="peligro" data-act="borrar" data-id="${g.id}">Eliminar</button></div>
        <div data-regzona="${g.id}"></div>
      </div>`;
    });
    if (nube.gatos.length < 4) {
      h += `<div class="tarjeta" id="form-gato"><h4>${nube.gatos.length ? 'Agregar otro gato' : 'Agregar un gato'}</h4>
        <ol class="pasos-lista"><li>Escribe su nombre y su ración.</li><li>Pulsa el botón verde.</li><li>Pon a <b>ese</b> gato frente a la cámara unos 30 s y muévelo un poco. Con una foto en el celular, acércala hasta que llene el centro de la imagen.</li></ol>
        <div class="form-fila"><label for="ng-nombre">Nombre</label><input type="text" id="ng-nombre" placeholder="Michi" maxlength="20" value="${esc(nuevoGato.nombre)}"></div>
        <div class="form-fila"><label for="ng-racion">Ración por comida</label><select id="ng-racion">${[12, 24, 36, 48].map((v) => `<option value="${v}" ${nuevoGato.racionG === v ? 'selected' : ''}>${v} g (${v / 12} ${v === 12 ? 'porción' : 'porciones'})</option>`).join('')}</select></div>
        <p id="ng-error" class="mini mal"></p>
        <button class="primario grande" data-act="agregar" ${fondoOk ? '' : 'disabled'}>Guardar y registrar con la cámara</button>
        <p class="mini">${fondoOk ? 'La cámara toma 45 fotos en unos 30 segundos (lo que tarda el ESP32-S3), cada una con un recorte distinto. Solo mira la parte que cambió respecto al fondo.' : 'Primero registra el fondo vacío (arriba).'}</p></div>`;
    } else h += `<p class="mini">El comedero admite hasta 4 gatos (Tabla 4.5).</p>`;
    return h;
  }
  function actualizarPrueba() {
    const zona = vistaEl.querySelector('#prueba-zona'); if (!zona || !probando) return;
    const e = nube.estado || {}, pr = e.prueba, cm = e.camara || {};
    let html;
    const imagen = htmlVista(true);
    if (pr && pr.t >= probando.t0 && pr.estado === 'listo') {
      const g = pr.gatoId ? gatoPorId(pr.gatoId) : null;
      html = {
        gato: `<div class="resultado ok">${Dibujos.avatar(pr.nombre || '?', g && g.collar, 40)}<div><b>¡Te reconocí! Es ${esc(pr.nombre)}</b><div class="mini">Seguridad ${Math.round((pr.p || 0) * 100)} % · 3 fotos seguidas coincidieron${pr.seg ? ` · en ${pr.seg} s (requisito ≤ 5 s)` : ''}</div></div></div>`,
        otro: `<div class="alerta aviso">Veo un gato, pero no se parece a ninguno registrado. Si es tu gato, toca "Mejorar reconocimiento" y muévelo frente a la cámara.</div>`,
        nadie: `<div class="alerta aviso">No vi a ningún gato en 30 s. Acércalo más a la cámara (que llene el centro), con buena luz.</div>`,
        camara: `<div class="alerta falla">La cámara no respondió.</div>`,
        ocupado: `<div class="alerta aviso">Ahora no se puede: ${esc(pr.motivo || 'el comedero está ocupado')}.</div>`
      }[pr.resultado] || '';
    } else if (!cm.webcam) html = `<div class="alerta aviso">La cámara del comedero está apagada. Enciende la webcam en la página del comedero.</div>`;
    else if (cm.sinFondo) html = `<div class="alerta aviso">Falta registrar el fondo vacío.</div>`;
    else if (cm.pred) {
      const N = cm.pred.fotos || 3;
      html = `<div class="en-vivo"><b>Mirando… veo: ${esc(cm.pred.mejor)} (${Math.round(cm.pred.p * 100)} %)</b><div class="racha">Fotos seguidas que coinciden: ${Array.from({ length: N }, (_, i) => `<i class="${i < cm.pred.racha ? 'on' : ''}"></i>`).join('')}</div><div class="mini">${esc(cm.pred.decision)}</div></div>`;
    } else html = `<p class="mini">Despertando la cámara…</p><div class="progreso"><i style="width:15%"></i></div>`;
    html = imagen + html;
    if (zona.dataset.h !== html) { zona.dataset.h = html; const t = document.createElement('template'); t.innerHTML = html; if (zona.childNodes.length) morfar(zona, t.content); else zona.innerHTML = html; }
  }
  let fondoVisto = null;
  function actualizarGatosDinamico() {
    const f = !!(nube.instalacion || {}).fondoOk;
    if (fondoVisto !== null && f !== fondoVisto) renderApp(true);
    fondoVisto = f;
    nube.gatos.forEach((g) => {
      const el = vistaEl.querySelector(`[data-huella="${g.id}"]`); const hu = huella(g.id);
      if (el && hu && el.textContent !== `Huella: ${hu.n} fotos`) renderApp(true);
    });
  }
  function actualizarRegistro() {
    if (!registrando) return;
    const zona = vistaEl.querySelector(`[data-regzona="${registrando.id}"]`) || vistaEl.querySelector('#reg-zona');
    const g = gatoPorId(registrando.id), cm = camInfo(), hu = huella(registrando.id);
    let html;
    const inst = nube.instalacion || {}, err = inst.regError;
    if (err && err.id === registrando.id && err.t >= registrando.t0) {
      html = `<div class="alerta aviso">No lo vi bien: solo ${err.n} fotos con ${esc(g ? g.nombre : 'el gato')} a la vista. Acércalo a la cámara (que llene el centro, distinto del fondo) y toca "Registrar" otra vez.</div>`;
      registrando = null;
    } else if (hu && hu.t >= registrando.t0) {
      const par = hu.parecido && gatoPorId(hu.parecidoA);
      html = `<p class="ok"><b>${esc(g ? g.nombre : '')} quedó registrado (${hu.n} fotos).</b></p>` + (par ? `<div class="alerta aviso">Se parece mucho a ${esc(par.nombre)}. Ponles collares de colores distintos.</div>` : '');
      registrando = null;
      setTimeout(() => renderApp(true), 1800);
    } else if (cm.reg && cm.reg.id === registrando.id) {
      const tot = cm.reg.total || 45;
      html = `<div class="reg-vivo">${Dibujos.anillo((cm.reg.n / tot) * 100, '#1D9E75', cm.reg.n + '/' + tot)}<p class="mini">Tomando fotos de ${esc(g ? g.nombre : '')}… Muévelo un poco para que la cámara lo vea desde varios ángulos.</p></div>`;
    } else if (desconectado()) html = `<div class="alerta aviso">El comedero no está conectado. La orden se enviará cuando se conecte.</div>`;
    else if (!cm.webcam) html = `<div class="alerta aviso">La cámara del comedero está apagada. Enciende la webcam en la página del comedero.</div>`;
    else html = `<p class="mini">Enviando la orden al comedero…</p><div class="progreso"><i style="width:3%"></i></div>`;
    if (zona && zona.innerHTML !== html) zona.innerHTML = html;
  }

  // ---------- Historial ----------
  function htmlHistorial() {
    const hist = (nube.historial || []).slice(0, 40), al = (nube.alertas || []).slice(0, 12);
    let h = `<p class="saludo">Historial</p>` + bannerConexion();
    h += `<div class="tarjeta"><h4>Comidas</h4>${hist.length ? hist.map(filaHist).join('') : '<div class="vacio-txt">Sin comidas todavía</div>'}</div>`;
    h += `<div class="tarjeta"><h4>Alertas</h4>${al.length ? al.map((a) => `<div class="fila"><div><span class="${a.nivel === 'falla' ? 'mal' : 'warn'}">${esc(a.texto)}</span><div class="t2">${hhmm(a.t)} · ${a.activa ? 'activa' : 'resuelta'}</div></div></div>`).join('') : '<div class="vacio-txt">Sin alertas</div>'}</div>`;
    return h;
  }

  // ---------- Ajustes ----------
  function htmlAjustes() {
    const c = nube.config, v = c.vision, inst = nube.instalacion || {};
    const opt = (arr, val, suf) => arr.map((x) => `<option value="${x}" ${+val === x ? 'selected' : ''}>${x}${suf || ''}</option>`).join('');
    let h = `<p class="saludo">Ajustes</p>` + htmlModo();
    if (esLibre()) {
      h += `<div class="tarjeta"><h4>Modo libre</h4>
        <div class="form-fila"><label>Tiempo mínimo entre comidas de un mismo gato</label><select data-act-change="cfg" data-k="libreIntervaloMin">${[30, 60, 90, 120, 180, 240].map((m) => `<option value="${m}" ${+c.libreIntervaloMin === m ? 'selected' : ''}>${horas(m)}</option>`).join('')}</select></div>
        <div class="form-fila"><label>Máximo de comidas por gato al día</label><select data-act-change="cfg" data-k="libreMaxDia">${opt([2, 3, 4, 5, 6, 8], c.libreMaxDia)}</select></div>
        <p class="mini">Si vuelve antes, la cámara lo reconoce pero no le sirve, y lo verás en el historial.</p></div>`;
    } else {
      h += `<div class="tarjeta"><h4>Horarios de comida</h4>` +
        c.horarios.map((x, i) => `<div class="fila"><input type="time" value="${x}" data-act-change="horario" data-i="${i}" aria-label="Horario ${i + 1}"><button data-act="quitarHorario" data-i="${i}" ${c.horarios.length <= 1 ? 'disabled' : ''}>Quitar</button></div>`).join('') +
        (c.horarios.length < 6 ? `<button data-act="agregarHorario">Agregar horario</button>` : '') + `</div>`;
    }
    h += `<div class="tarjeta"><h4>Comidas</h4>
      ${esLibre() ? '' : `<div class="form-fila"><label>Esperar al gato hasta</label><select data-act-change="cfg" data-k="esperaMin">${opt([5, 10, 15, 20, 30, 45, 60], c.esperaMin, ' min')}</select></div>`}
      <div class="form-fila"><label>Terminar la comida cuando el gato se va por</label><select data-act-change="cfg" data-k="consumoSinGatoMin">${opt([1, 2, 3, 5, 10], c.consumoSinGatoMin, ' min')}</select></div>
      <div class="form-fila"><label>Tiempo máximo de comida</label><select data-act-change="cfg" data-k="consumoMaxMin">${opt([15, 30, 45, 60], c.consumoMaxMin, ' min')}</select></div>
      ${esLibre() ? '' : `<div class="form-fila"><label>Si la cámara falla</label><select data-act-change="cfg" data-k="siCamaraFalla"><option value="dosificar" ${c.siCamaraFalla === 'dosificar' ? 'selected' : ''}>Servir la ración por defecto</option><option value="no" ${c.siCamaraFalla !== 'dosificar' ? 'selected' : ''}>No servir</option></select></div>`}
      <div class="form-fila"><label>Ración por defecto</label><select data-act-change="cfg" data-k="racionDefectoG">${opt([12, 24, 36, 48], c.racionDefectoG, ' g')}</select></div></div>`;
    h += `<div class="tarjeta"><h4>Cámara del comedero</h4>
      <div class="fila"><div>Fondo vacío<div class="t2" id="aj-fondo">${inst.fondoOk ? '<span class="ok">Registrado</span>' : 'Sin registrar'}</div></div><button data-act="fondo">Registrar</button></div>
      <div class="fila"><div>Papel limpio (zona de comida)<div class="t2" id="aj-plato">${inst.platoOk ? '<span class="ok">Calibrado</span>' : 'Sin calibrar'}</div></div><button data-act="plato">Calibrar</button></div>
      <p class="mini">Deja la plataforma sin gato ni comida antes de pulsar.</p>
      <details><summary>Ajustes avanzados de la visión</summary>
        <div class="form-fila"><label>Probabilidad mínima para reconocer</label><select data-act-change="vis" data-k="umbralP">${opt([0.6, 0.7, 0.8, 0.9], v.umbralP)}</select></div>
        <div class="form-fila"><label>Fotos seguidas que deben coincidir</label><select data-act-change="vis" data-k="fotos">${opt([1, 2, 3, 4, 5], v.fotos)}</select></div>
        <div class="form-fila"><label>Sensibilidad del PIR (fracción de la imagen que cambia)</label><select data-act-change="vis" data-k="pirSens">${opt([0.02, 0.04, 0.08, 0.12], v.pirSens)}</select></div>
        <div class="form-fila"><label>Restos: cambio mínimo en el papel</label><select data-act-change="vis" data-k="restosPct">${opt([1, 2, 3, 5, 8], v.restosPct, ' %')}</select></div>
      </details></div>`;
    h += `<div class="tarjeta"><h4>Conexión</h4><p class="mini" id="aj-con">${esc(con.texto)}</p>
      <p class="mini">${con.modo === 'firebase' ? 'La app y el comedero se comunican por Firebase, desde cualquier lugar.' : con.modo === 'pestanas' ? 'La app y el comedero están en la misma computadora. Para usar la app en el celular, conecta Firebase (LEEME, sección 4).' : 'La app y el comedero están en la misma página.'}</p></div>`;
    h += `<div class="tarjeta"><h4>Demo</h4><button class="peligro" data-act="reiniciar">Reiniciar la app</button><p class="mini">Borra lo que la app guardó en este navegador.</p></div>`;
    return h;
  }
  function actualizarAjustesDinamico() {
    const inst = nube.instalacion || {}, cm = camInfo();
    const f = $('#aj-fondo'), p = $('#aj-plato'), c = $('#aj-con');
    if (f) { const t = inst.fondoOk ? '<span class="ok">Registrado</span>' : (cm.reg && cm.reg.id === 0 ? `Registrando… ${cm.reg.n}/${cm.reg.total || 45}` : 'Sin registrar'); if (f.innerHTML !== t) f.innerHTML = t; }
    if (p) { const t = inst.platoOk ? '<span class="ok">Calibrado</span>' : 'Sin calibrar'; if (p.innerHTML !== t) p.innerHTML = t; }
    if (c && c.textContent !== con.texto) c.textContent = con.texto;
  }

  // ---------- Primer uso ----------
  function htmlBienvenida() {
    const p = app.paso;
    const pasos = `<div class="pasos">${[0, 1, 2, 3, 4].map((i) => `<i class="${i <= p ? 'on' : ''}"></i>`).join('')}</div>`;
    const saltar = `<button class="enlace" data-act="ob-saltar">Saltar la configuración</button>`;
    if (p === 0) return `${pasos}<div class="hero hero-verde">${Dibujos.escena('CONSUMO')}</div><p class="saludo">Bienvenido a tu comedero</p><p class="mini">Vamos a dejarlo listo en 5 pasos.</p>
      <div class="form-fila"><label for="ob-nombre">Tu nombre</label><input type="text" id="ob-nombre" placeholder="Franco" value="${esc(app.nombre)}" maxlength="24"></div>
      <div class="form-fila"><label>Correo</label><input type="text" placeholder="tucorreo@gmail.com" disabled></div>
      <p class="mini">Con Firebase Authentication aquí se crea tu cuenta. En esta versión los datos quedan en tu comedero (código ${esc(con.codigo)}).</p>
      <button class="primario grande" data-act="ob-siguiente">Crear cuenta</button>${saltar}`;
    if (p === 1) return `${pasos}<p class="saludo">Conecta tu comedero</p><p class="mini">Enchúfalo. El comedero crea su propia red "Comedero-4F2A": conéctate a ella y elige el Wi-Fi de tu casa (WiFiManager).</p>
      <div class="form-fila"><label>Red Wi-Fi de tu casa</label><input type="text" value="MiCasa_2.4G" aria-label="Red Wi-Fi"></div>
      <div class="form-fila"><label>Contraseña</label><input type="password" value="12345678" aria-label="Contraseña del Wi-Fi"></div>
      <p id="ob-con" class="mini"></p>
      <button class="primario grande" data-act="ob-siguiente">Conectar</button>${saltar}`;
    if (p === 2) return `${pasos}<p class="saludo">Prepara la cámara</p><p class="mini">La cámara necesita ver una vez la plataforma vacía y el papel limpio.</p>
      <div class="fila"><div>1. Cámara del comedero<div class="t2" id="ob-cam"></div></div>${CTX.cam ? '<button data-act="ob-webcam">Encender</button>' : ''}</div>
      <div class="fila"><div>2. Fondo vacío<div class="t2" id="aj-fondo"></div></div><button data-act="fondo">Registrar</button></div>
      <div class="fila"><div>3. Papel limpio (zona de comida)<div class="t2" id="aj-plato"></div></div><button data-act="plato">Calibrar</button></div>
      <button class="primario grande" data-act="ob-siguiente" style="margin-top:12px">Siguiente</button>${saltar}`;
    if (p === 3) {
      const g = nube.gatos[0];
      const fOk = !!(nube.instalacion || {}).fondoOk;
      return `${pasos}<p class="saludo">Registra a tu gato</p><p class="mini">Pon a tu gato frente al comedero (o la foto de un gato en tu celular, llenando el centro de la cámara). Toma 45 fotos en unos 30 segundos y aprende a reconocerlo.</p>
      ${fOk ? '' : `<div class="alerta aviso">Primero registra el fondo vacío: la cámara debe ver el lugar sin gato.<div class="fila" style="border:0"><span class="t2" id="aj-fondo">Sin registrar</span><button data-act="fondo">Registrar el fondo</button></div></div>`}
      ${g ? `<div class="tarjeta"><b>${esc(g.nombre)}</b> · ${g.racionG} g por comida<div id="reg-zona"></div></div><button data-act="registrar" data-id="${g.id}">Volver a registrar</button>` :
      `<div class="form-fila"><label for="ng-nombre">Nombre del gato</label><input type="text" id="ng-nombre" placeholder="Michi" maxlength="20"></div>
       <div class="form-fila"><label for="ng-racion">Ración por comida</label><select id="ng-racion">${[12, 24, 36, 48].map((v) => `<option value="${v}" ${v === 24 ? 'selected' : ''}>${v} g</option>`).join('')}</select></div>
       <p id="ng-error" class="mini mal"></p>
       <button class="primario grande" data-act="agregar" ${fOk ? '' : 'disabled'}>Registrar con la cámara</button><div id="reg-zona"></div>`}
      <p class="mini">¿Tienes más gatos? Los agregas luego en "Mis gatos".</p>
      <button class="grande" data-act="ob-siguiente" style="margin-top:8px">Siguiente</button>${saltar}`;
    }
    return `${pasos}<div class="hero hero-verde">${Dibujos.escena('ESPERA')}</div><p class="saludo">¿Cuándo debe comer?</p><p class="mini">Elige uno. Lo puedes cambiar cuando quieras en Inicio o en Ajustes.</p>
      ${htmlModo()}
      <div class="tarjeta"><h4>Antes de empezar</h4><div class="fila">Tolva con alimento</div><div class="fila">Rollo de papel puesto</div><div class="fila">Tacho vacío</div></div>
      <button class="primario grande" data-act="ob-fin">Empezar</button>`;
  }
  const ponerHTML = (el, t) => { if (el && el.innerHTML !== t) el.innerHTML = t; };
  function actualizarBienvenidaDinamica() {
    if (app.paso === 1) ponerHTML($('#ob-con'), desconectado() ? `<span class="warn">Buscando el comedero…${con.modo === 'pestanas' ? ' Abre comedero.html en otra pestaña.' : ''}</span>` : '<span class="ok">Comedero encontrado y conectado</span>');
    if (app.paso === 2) {
      const cm = camInfo();
      ponerHTML($('#ob-cam'), cm.webcam ? '<span class="ok">Encendida</span>' : (CTX.cam ? 'Apagada' : 'Apagada: enciende la webcam en la página del comedero'));
      actualizarAjustesDinamico();
    }
    if (app.paso === 3) {
      actualizarAjustesDinamico();
      const f = !!(nube.instalacion || {}).fondoOk;
      if (fondoVisto !== null && f !== fondoVisto) renderApp(true);
      fondoVisto = f;
    }
  }

  // ---------- Acciones ----------
  vistaEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act, id = +b.dataset.id;
    switch (a) {
      case 'porciones': porcionesApp = +b.dataset.n; renderApp(true); break;
      case 'modo':
        nube.config.modo = b.dataset.m === 'libre' ? 'libre' : 'horario';
        toast(desconectado() ? 'Se enviará cuando el comedero se conecte' : (esLibre() ? 'Modo libre: sirve cuando llegue tu gato' : 'Modo por horarios'));
        renderApp(true); break;
      case 'probar':
        probando = { t0: ahoraSim() - 1000 };
        verPedido = performance.now();
        enviarComando({ tipo: 'ver', seg: 40 }, 'La cámara está mirando');
        enviarComando({ tipo: 'probar' }, 'La cámara está mirando');
        break;
      case 'terminoComer': enviarComando({ tipo: 'terminoComer' }, 'Se limpia el papel'); break;
      case 'ver': verPedido = performance.now(); enviarComando({ tipo: 'ver', seg: 60 }, 'Encendiendo la cámara'); renderApp(true); break;
      case 'nover': verPedido = 0; enviarComando({ tipo: 'nover' }, 'Cámara cerrada'); if (nube.estado) nube.estado.viendo = 0; renderApp(true); break;
      case 'servir': enviarComando({ tipo: 'servir', porciones: porcionesApp }, `Sirviendo ${porcionesApp * 12} g`); break;
      case 'confirmar': enviarComando({ tipo: 'confirmar' }, 'Confirmado'); break;
      case 'entendido': enviarComando({ tipo: 'resolverAviso', alerta: b.dataset.tipo }, 'Aviso cerrado'); break;
      case 'agregar': {
        const nom = ($('#ng-nombre').value || '').trim(), err = $('#ng-error');
        if (!nom) { err.textContent = 'Escribe el nombre del gato'; return; }
        if (nube.gatos.some((g) => g.nombre.toLowerCase() === nom.toLowerCase())) { err.textContent = 'Ya tienes un gato con ese nombre'; return; }
        const gid = idLibre(); if (!gid) return;
        nube.gatos.push({ id: gid, nombre: nom, racionG: +$('#ng-racion').value, collar: null });
        nuevoGato = { nombre: '', racionG: 24 };
        registrar(gid); renderApp(true);
        break;
      }
      case 'registrar': registrar(id); break;
      case 'ir-agregar': { const f = vistaEl.querySelector('#form-gato'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => { const i = vistaEl.querySelector('#ng-nombre'); if (i) i.focus(); }, 400); } break; }
      case 'borrar': {
        const g = gatoPorId(id);
        if (g && b.dataset.seguro === '1') {
          nube.gatos = nube.gatos.filter((x) => x.id !== id);
          enviarComando({ tipo: 'borrarGato', gatoId: id }, 'Gato eliminado'); renderApp(true);
        } else if (g) { b.dataset.seguro = '1'; b.textContent = `¿Eliminar a ${g.nombre}? Toca otra vez`; }
        break;
      }
      case 'fondo': enviarComando({ tipo: 'registrarFondo' }, 'Registrando el fondo vacío'); break;
      case 'plato': enviarComando({ tipo: 'calibrarPlato' }, 'Calibrando el papel limpio'); break;
      case 'agregarHorario': {
        // Propone una hora que no esté ya usada (no se duplican horarios)
        const usadas = new Set(nube.config.horarios);
        const libre = ['16:00', '12:00', '10:00', '21:00', '15:00', '09:00', '18:00', '22:00', '14:00', '20:00'].find((x) => !usadas.has(x));
        if (!libre || nube.config.horarios.length >= 8) { toast('Ya tienes muchos horarios'); break; }
        nube.config.horarios.push(libre); nube.config.horarios.sort(); renderApp(true); toast('Horario agregado: ' + libre + '. Cámbialo si quieres otra hora'); break;
      }
      case 'quitarHorario': nube.config.horarios.splice(+b.dataset.i, 1); renderApp(true); break;
      case 'reiniciar':
        if (b.dataset.seguro === '1') { localStorage.removeItem(CLAVE_APP); localStorage.removeItem('comedero_nube_v2_' + ROL); location.reload(); }
        else { b.dataset.seguro = '1'; b.textContent = 'Toca otra vez para borrar'; }
        break;
      case 'ob-siguiente':
        if (app.paso === 0) app.nombre = ($('#ob-nombre').value || '').trim();
        app.paso = Math.min(4, app.paso + 1); renderApp(true); break;
      case 'ob-webcam': if (CTX.cam) CTX.cam.encender().then((ok) => { if (!ok) toast('No se pudo abrir la webcam. Revisa los permisos.'); }); break;
      case 'ob-saltar': case 'ob-fin': app.onboarding = true; nube.config.horariosActivos = true; irA('inicio'); break;
    }
  });
  vistaEl.addEventListener('change', (ev) => {
    const t = ev.target, a = t.dataset.actChange; if (!a) return;
    const avisar = () => toast(desconectado() ? 'Se enviará cuando el comedero se conecte' : 'Guardado');
    if (a === 'racion') { const g = gatoPorId(+t.dataset.id); if (g) g.racionG = +t.value; avisar(); }
    if (a === 'collar') { const g = gatoPorId(+t.dataset.id); if (g) g.collar = t.value || null; avisar(); renderApp(true); }
    if (a === 'horario') {
      const i = +t.dataset.i, v = t.value;
      if (!/^\d{1,2}:\d{2}$/.test(v)) { toast('Escribe una hora válida'); renderApp(true); return; }
      if (nube.config.horarios.some((x, k) => k !== i && x === v)) { toast('Ese horario ya existe'); renderApp(true); return; }
      nube.config.horarios[i] = v; nube.config.horarios.sort(); avisar(); renderApp(true);
    }
    if (a === 'cfg') { const k = t.dataset.k; nube.config[k] = k === 'siCamaraFalla' ? t.value : +t.value; avisar(); }
    if (a === 'vis') { nube.config.vision[t.dataset.k] = +t.value; avisar(); }
  });
  vistaEl.addEventListener('input', (ev) => { if (ev.target.id === 'ng-nombre') nuevoGato.nombre = ev.target.value; if (ev.target.id === 'ng-racion') nuevoGato.racionG = +ev.target.value; });
  function registrar(gid) {
    registrando = { id: gid, t0: ahoraSim() - 1000 };
    enviarComando({ tipo: 'registrar', gatoId: gid }, 'Registrando con la cámara');
  }

  renderApp(true);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && (ROL === 'app' || ROL === 'todo')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
