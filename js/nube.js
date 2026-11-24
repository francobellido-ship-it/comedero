/* ============================================================================
 * nube.js — conexión entre la app del dueño y el comedero (Tabla 7.6)
 * ----------------------------------------------------------------------------
 * Rutas y quién las escribe:
 *   app       → /config, /gatos, /comandos
 *   comedero  → /estado, /alertas, /historial, /huellas, /instalacion, /ultimaSync,
 *               /vista (foto en vivo de la cámara solo mientras el dueño mira)
 * Modos:
 *   local     → app y comedero en la misma página (demo.html)
 *   pestanas  → dos pestañas del mismo navegador (BroadcastChannel), sin cuenta
 *   firebase  → Firebase Realtime Database (celular ↔ PC), si hay configuración
 * ==========================================================================*/
(function (root) {
  'use strict';
  const PROPIAS = {
    app: ['config', 'gatos'],
    comedero: ['estado', 'alertas', 'historial', 'huellas', 'instalacion', 'ultimaSync', 'vista']
  };
  const TODAS = PROPIAS.app.concat(PROPIAS.comedero);
  const FB_VER = '10.12.2';

  function normal(p, v) {
    if (v === null || v === undefined) return { gatos: [], alertas: [], historial: [], huellas: {}, instalacion: {}, estado: {}, ultimaSync: null, vista: null }[p];
    if (['gatos', 'alertas', 'historial'].includes(p) && !Array.isArray(v)) return Object.values(v);
    if (p === 'config' && v && !Array.isArray(v.horarios)) v.horarios = v.horarios ? Object.values(v.horarios) : ['07:00'];
    return v;
  }
  const limpio = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  // Firebase borra los null y los vacíos: se compara siempre sin ellos para no reenviar en bucle
  function podar(v) {
    if (Array.isArray(v)) { const a = v.map(podar).filter((x) => x !== undefined); return a.length ? a : undefined; }
    if (v && typeof v === 'object') { const o = {}; for (const k in v) { const x = podar(v[k]); if (x !== undefined) o[k] = x; } return Object.keys(o).length ? o : undefined; }
    return v === null || v === undefined ? undefined : v;
  }
  const firma = (v) => JSON.stringify(podar(v) === undefined ? null : podar(v));
  // Un mismo script de Firebase se carga una sola vez aunque lo pidan la nube y la cuenta a la vez
  function cargarScript(src) {
    root.__cargasFB = root.__cargasFB || {};
    if (!root.__cargasFB[src]) root.__cargasFB[src] = new Promise((ok, mal) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => { delete root.__cargasFB[src]; mal(new Error('No cargó ' + src)); }; document.head.appendChild(s); });
    return root.__cargasFB[src];
  }
  root.cargarScriptFB = cargarScript;

  class Conexion {
    constructor(nube, rol) {
      this.nube = nube; this.rol = rol;            // 'app' | 'comedero' | 'todo'
      this.modo = 'local'; this.offline = false;
      this.enviados = {}; this.listo = {}; this.buffer = [];
      this.texto = 'Misma página'; this.error = null; this.ultimoRecibido = 0;
      this.codigo = root.CODIGO_COMEDERO || 'COMEDERO-4F2A';
    }
    propias() { return this.rol === 'todo' ? [] : PROPIAS[this.rol]; }
    ajenas() { return this.rol === 'todo' ? [] : TODAS.filter((p) => !PROPIAS[this.rol].includes(p)); }

    async iniciar() {
      if (this.rol === 'todo') { this.modo = 'local'; this.texto = 'Todo en una página'; return; }
      const cfg = root.FIREBASE_CONFIG;
      if (cfg && cfg.apiKey && cfg.databaseURL) {
        try { await this._firebase(cfg); return; }
        catch (e) { this.error = e.message; console.warn('Firebase no disponible:', e); }
      }
      this._pestanas();
    }

    // ---------- Dos pestañas del mismo navegador ----------
    _pestanas() {
      this.modo = 'pestanas';
      this.texto = 'Misma computadora (pestañas)';
      TODAS.forEach((p) => { this.listo[p] = true; });
      if (!('BroadcastChannel' in root)) { this.texto = 'Este navegador no puede unir pestañas'; return; }
      this.bc = new BroadcastChannel('comedero-tesis');
      this.bc.onmessage = (e) => {
        const m = e.data || {};
        if (m.t === 'hola') { this.enviados = {}; return; }
        if (m.t === 'datos') {
          if (this.offline) return;
          for (const p in m.d) {
            if (this.rol === 'comedero' && PROPIAS.comedero.includes(p)) continue;
            this.nube[p] = normal(p, m.d[p]);
            if (this.propias().includes(p)) this.enviados[p] = firma(this.nube[p]);
          }
          this.ultimoRecibido = Date.now();
        }
        if (m.t === 'cmd' && this.rol === 'comedero') {
          if (this.offline) this.buffer.push(m.c); else this.nube.comandos.push(m.c);
        }
      };
      this.bc.postMessage({ t: 'hola' });
    }

    // ---------- Firebase Realtime Database ----------
    async _firebase(cfg) {
      this.texto = 'Conectando con Firebase…';
      // Cada script se pide una sola vez (la cuenta puede haber cargado ya firebase-app para Authentication)
      if (!root.firebase || !root.firebase.apps) await cargarScript(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app-compat.js`);
      if (!root.firebase.database) await cargarScript(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-database-compat.js`);
      let app; try { app = root.firebase.apps.length ? root.firebase.app() : root.firebase.initializeApp(cfg); } catch (e) { app = root.firebase.app(); }
      this.db = app.database();
      this.ref = this.db.ref('comederos/' + this.codigo);
      this.modo = 'firebase';
      TODAS.forEach((p) => {
        this.ref.child(p).on('value', (snap) => {
          const v = snap.val();
          const mia = this.propias().includes(p);
          // La configuración vacía en la nube (la app aún no la subió) no borra la que ya se tiene
          if (v === null && (p === 'config' || p === 'comandos')) { if (mia) this.enviados[p] = firma(v); this.listo[p] = true; this.ultimoRecibido = Date.now(); return; }
          if (mia) {
            this.enviados[p] = firma(v);                                   // lo que ya está en la base
            if (this.rol === 'app' && v !== null) this.nube[p] = normal(p, v); // otra copia de la app pudo cambiarlo
          } else this.nube[p] = normal(p, v);                              // el comedero manda sobre sus rutas
          this.listo[p] = true;
          this.ultimoRecibido = Date.now();
        }, (err) => { this.error = err.message; this.texto = 'Firebase rechazó la conexión: revisa las reglas'; });
      });
      if (this.rol === 'comedero') {
        this.ref.child('comandos').on('child_added', (snap) => { this.nube.comandos.push(snap.val()); snap.ref.remove(); });
      }
      this.db.ref('.info/connected').on('value', (s) => { this.texto = s.val() ? `Firebase (${this.codigo})` : 'Firebase: sin conexión'; });
    }

    // Sube las rutas propias que cambiaron (llamar cada ~1 s)
    publicar() {
      if (this.modo === 'local' || this.offline) return;
      const cambios = {};
      this.propias().forEach((p) => {
        if (!this.listo[p]) return;
        const j = firma(this.nube[p]);
        if (j !== this.enviados[p]) { cambios[p] = limpio(this.nube[p]); this.enviados[p] = j; }
      });
      if (!Object.keys(cambios).length) return;
      if (this.modo === 'pestanas' && this.bc) this.bc.postMessage({ t: 'datos', d: cambios });
      if (this.modo === 'firebase') this.ref.update(cambios).catch((e) => { this.error = e.message; });
    }

    enviarComando(c) {
      if (this.modo === 'local') { this.nube.comandos.push(c); return; }
      if (this.modo === 'pestanas' && this.bc) this.bc.postMessage({ t: 'cmd', c });
      if (this.modo === 'firebase') this.ref.child('comandos').push(limpio(c));
    }

    // El comedero simula que pierde internet
    setOffline(v) {
      if (v === this.offline) return;
      this.offline = v;
      if (this.modo === 'firebase') { if (v) this.db.goOffline(); else this.db.goOnline(); }
      if (!v) { this.buffer.forEach((c) => this.nube.comandos.push(c)); this.buffer = []; this.enviados = {}; }
    }
  }

  root.ConexionNube = Conexion;
})(window);

// ---- Guardado local por rol (cada página guarda lo suyo) ----
(function (root) {
  'use strict';
  root.cargarNube = function (rol) {
    const S = root.SimComedero;
    let n = null;
    try { n = JSON.parse(localStorage.getItem('comedero_nube_v2_' + rol) || 'null'); } catch (e) { n = null; }
    n = n || S.nubeNueva();
    n.comandos = []; n.gatos = n.gatos || []; n.historial = n.historial || []; n.alertas = n.alertas || [];
    n.huellas = n.huellas || {}; n.instalacion = n.instalacion || {}; n.estado = n.estado || {};
    n.config = Object.assign(JSON.parse(JSON.stringify(S.CONFIG_DEF)), n.config || {});
    n.config.vision = Object.assign({ umbralP: 0.8, fotos: 3, pirSens: 0.04, restosPct: 3 }, n.config.vision || {});
    return n;
  };
  root.guardarNube = function (rol, n) {
    try { const c = Object.assign({}, n, { comandos: [], vista: null }); localStorage.setItem('comedero_nube_v2_' + rol, JSON.stringify(c)); } catch (e) { /* lleno */ }
  };
})(window);
