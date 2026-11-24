/* ============================================================================
 * cuenta.js — Cuenta del dueño (crear cuenta, iniciar sesión, vincular comedero)
 * ----------------------------------------------------------------------------
 * Dos formas, con la misma interfaz:
 *   firebase → Firebase Authentication (correo y contraseña), si js/firebase-config.js
 *              tiene configuración y la página es la app sola (app.html). La cuenta
 *              vive en la nube: se entra desde cualquier celular.
 *   local    → la cuenta se guarda en este navegador (demo o sin Firebase). La
 *              contraseña nunca se guarda: solo su huella PBKDF2-SHA256 con sal.
 * Todas las funciones devuelven { ok, error } con mensajes en español para el dueño.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const CLAVE_CUENTAS = 'comedero_cuentas_v1';
  const FB_VER = '10.12.2';
  const leer = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const escribir = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* lleno */ } };
  const normal = (c) => String(c || '').trim().toLowerCase();

  // ---------- Reglas de los datos (las mismas para las dos formas) ----------
  const REGLAS = {
    correo(c) {
      c = normal(c);
      if (!c) return 'Escribe tu correo';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c)) return 'Ese correo no parece válido (ejemplo: nombre@gmail.com)';
      return '';
    },
    clave(c) {
      c = String(c || '');
      if (c.length < 6) return 'La contraseña debe tener al menos 6 caracteres';
      if (c.length > 64) return 'La contraseña es demasiado larga';
      if (/^\s|\s$/.test(c)) return 'La contraseña no puede empezar ni terminar con un espacio';
      return '';
    },
    nombre(n) {
      n = String(n || '').trim();
      if (!n) return 'Escribe tu nombre';
      if (n.length > 24) return 'El nombre es demasiado largo (máximo 24 letras)';
      return '';
    },
    codigo(c, esperado) {
      c = String(c || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!c) return 'Escribe el código de tu comedero';
      if (!/^COMEDERO-[0-9A-F]{4}$/.test(c)) return 'El código tiene la forma COMEDERO-XXXX (está en la etiqueta debajo del equipo)';
      if (esperado && c !== String(esperado).toUpperCase()) return 'No encontramos un comedero con ese código. Revisa la etiqueta debajo del equipo y que esté enchufado';
      return '';
    }
  };

  // ---------- Huella de la contraseña (local) ----------
  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  async function huellaClave(clave, salHex) {
    const sutil = root.crypto && root.crypto.subtle;
    if (sutil) {
      const sal = new Uint8Array(salHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
      const llave = await sutil.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']);
      const bits = await sutil.deriveBits({ name: 'PBKDF2', salt: sal, iterations: 60000, hash: 'SHA-256' }, llave, 256);
      return 'pbkdf2:' + hex(bits);
    }
    // Sin crypto.subtle (página abierta como archivo en algunos navegadores): huella simple
    let h = 2166136261; const s = salHex + ':' + clave;
    for (let k = 0; k < 20000; k++) for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) + k; h = Math.imul(h, 16777619) >>> 0; }
    return 'fnv:' + h.toString(16);
  }
  function salNueva() {
    const a = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a); else for (let i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
    return hex(a);
  }

  // ---------- Cuenta local ----------
  class CuentaLocal {
    constructor(rol) { this.modo = 'local'; this.claveSesion = 'comedero_sesion_' + rol; this.listo = Promise.resolve(); }
    _todas() { return leer(CLAVE_CUENTAS) || {}; }
    _guardar(t) { escribir(CLAVE_CUENTAS, t); }
    actual() {
      const s = leer(this.claveSesion); if (!s) return null;
      const c = this._todas()[s.correo]; if (!c) return null;
      return { nombre: c.nombre, correo: c.correo, comedero: c.comedero || null, creada: c.creada, invitado: false };
    }
    async crear({ nombre, correo, clave }) {
      const e = REGLAS.nombre(nombre) || REGLAS.correo(correo) || REGLAS.clave(clave); if (e) return { ok: false, error: e };
      const t = this._todas(), k = normal(correo);
      if (t[k]) return { ok: false, error: 'Ya hay una cuenta con ese correo. Toca "Ya tengo cuenta" para entrar' };
      const sal = salNueva();
      t[k] = { nombre: String(nombre).trim(), correo: k, sal, huella: await huellaClave(String(clave), sal), creada: Date.now(), comedero: null };
      this._guardar(t); escribir(this.claveSesion, { correo: k, t: Date.now() });
      return { ok: true };
    }
    async entrar({ correo, clave }) {
      const e = REGLAS.correo(correo); if (e) return { ok: false, error: e };
      if (!clave) return { ok: false, error: 'Escribe tu contraseña' };
      const c = this._todas()[normal(correo)];
      if (!c) return { ok: false, error: 'No hay ninguna cuenta con ese correo en este dispositivo. Revisa el correo o crea una cuenta' };
      if ((await huellaClave(String(clave), c.sal)) !== c.huella) return { ok: false, error: 'La contraseña no es correcta' };
      escribir(this.claveSesion, { correo: c.correo, t: Date.now() });
      return { ok: true };
    }
    async salir() { localStorage.removeItem(this.claveSesion); return { ok: true }; }
    async recuperar(correo) {
      const e = REGLAS.correo(correo); if (e) return { ok: false, error: e };
      return { ok: false, error: 'En esta versión la cuenta vive solo en este dispositivo y no se puede enviar un correo. Si olvidaste la contraseña, toca "Crear cuenta" con otro correo o borra los datos de la app en Ajustes.' };
    }
    async cambiarNombre(nombre) {
      const e = REGLAS.nombre(nombre); if (e) return { ok: false, error: e };
      const a = this.actual(); if (!a) return { ok: false, error: 'Inicia sesión otra vez' };
      const t = this._todas(); t[a.correo].nombre = String(nombre).trim(); this._guardar(t); return { ok: true };
    }
    async cambiarClave(actualClave, nueva) {
      const a = this.actual(); if (!a) return { ok: false, error: 'Inicia sesión otra vez' };
      const t = this._todas(), c = t[a.correo];
      if ((await huellaClave(String(actualClave || ''), c.sal)) !== c.huella) return { ok: false, error: 'La contraseña actual no es correcta' };
      const e = REGLAS.clave(nueva); if (e) return { ok: false, error: e };
      if (actualClave === nueva) return { ok: false, error: 'La nueva contraseña es igual a la actual' };
      c.sal = salNueva(); c.huella = await huellaClave(String(nueva), c.sal); this._guardar(t); return { ok: true };
    }
    async vincular(codigo) {
      const a = this.actual(); if (!a) return { ok: false, error: 'Inicia sesión otra vez' };
      const t = this._todas(); t[a.correo].comedero = String(codigo).trim().toUpperCase(); this._guardar(t); return { ok: true };
    }
    async eliminar(clave) {
      const a = this.actual(); if (!a) return { ok: false, error: 'Inicia sesión otra vez' };
      const t = this._todas(), c = t[a.correo];
      if ((await huellaClave(String(clave || ''), c.sal)) !== c.huella) return { ok: false, error: 'La contraseña no es correcta' };
      delete t[a.correo]; this._guardar(t); localStorage.removeItem(this.claveSesion); return { ok: true };
    }
  }

  // ---------- Cuenta con Firebase Authentication ----------
  const ERR_FB = {
    'auth/email-already-in-use': 'Ya hay una cuenta con ese correo. Toca "Ya tengo cuenta" para entrar',
    'auth/invalid-email': 'Ese correo no parece válido',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
    'auth/user-not-found': 'No hay ninguna cuenta con ese correo',
    'auth/wrong-password': 'La contraseña no es correcta',
    'auth/invalid-credential': 'El correo o la contraseña no son correctos',
    'auth/invalid-login-credentials': 'El correo o la contraseña no son correctos',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos y vuelve a intentar',
    'auth/network-request-failed': 'Sin internet. Revisa tu conexión',
    'auth/operation-not-allowed': 'En Firebase falta activar "Correo y contraseña" (Authentication → Sign-in method)',
    'auth/requires-recent-login': 'Por seguridad, cierra sesión y vuelve a entrar antes de hacer esto'
  };
  const msgFB = (e) => ERR_FB[e && e.code] || ('No se pudo: ' + ((e && e.message) || 'error desconocido'));
  class CuentaFirebase {
    constructor(cfg, rol) {
      this.modo = 'firebase'; this.usuario = null; this.perfil = {}; this.claveSesion = 'comedero_sesion_' + rol;
      this.listo = (async () => {
        if (!root.firebase || !root.firebase.auth) {
          const carga = root.cargarScriptFB || ((src) => new Promise((ok, mal) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => mal(new Error('No cargó ' + src)); document.head.appendChild(s); }));
          if (!root.firebase || !root.firebase.apps) await carga(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app-compat.js`);
          await carga(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-auth-compat.js`);
        }
        let app; try { app = root.firebase.apps.length ? root.firebase.app() : root.firebase.initializeApp(cfg); } catch (e) { app = root.firebase.app(); }
        this.auth = root.firebase.auth(app);
        await new Promise((ok) => { const fin = this.auth.onAuthStateChanged((u) => { this.usuario = u; this.perfil = leer(this.claveSesion) || {}; fin(); ok(); }); });
        this.auth.onAuthStateChanged((u) => { this.usuario = u; });
      })();
    }
    actual() {
      const u = this.usuario; if (!u) return null;
      return { nombre: u.displayName || this.perfil.nombre || '', correo: u.email, comedero: this.perfil.comedero || null, creada: u.metadata && Date.parse(u.metadata.creationTime), invitado: false };
    }
    async crear({ nombre, correo, clave }) {
      const e = REGLAS.nombre(nombre) || REGLAS.correo(correo) || REGLAS.clave(clave); if (e) return { ok: false, error: e };
      try {
        await this.listo;
        const r = await this.auth.createUserWithEmailAndPassword(normal(correo), String(clave));
        await r.user.updateProfile({ displayName: String(nombre).trim() });
        this.usuario = r.user; this.perfil = { nombre: String(nombre).trim(), comedero: null }; escribir(this.claveSesion, this.perfil);
        return { ok: true };
      } catch (err) { return { ok: false, error: msgFB(err) }; }
    }
    async entrar({ correo, clave }) {
      const e = REGLAS.correo(correo); if (e) return { ok: false, error: e };
      if (!clave) return { ok: false, error: 'Escribe tu contraseña' };
      try { await this.listo; const r = await this.auth.signInWithEmailAndPassword(normal(correo), String(clave)); this.usuario = r.user; return { ok: true }; }
      catch (err) { return { ok: false, error: msgFB(err) }; }
    }
    async salir() { try { await this.listo; await this.auth.signOut(); } catch (e) { /* */ } this.usuario = null; return { ok: true }; }
    async recuperar(correo) {
      const e = REGLAS.correo(correo); if (e) return { ok: false, error: e };
      try { await this.listo; await this.auth.sendPasswordResetEmail(normal(correo)); return { ok: true, mensaje: 'Te enviamos un correo para crear una contraseña nueva. Revisa también "Spam".' }; }
      catch (err) { return { ok: false, error: msgFB(err) }; }
    }
    async cambiarNombre(nombre) {
      const e = REGLAS.nombre(nombre); if (e) return { ok: false, error: e };
      try { await this.usuario.updateProfile({ displayName: String(nombre).trim() }); this.perfil.nombre = String(nombre).trim(); escribir(this.claveSesion, this.perfil); return { ok: true }; }
      catch (err) { return { ok: false, error: msgFB(err) }; }
    }
    async _reautenticar(clave) {
      const cred = root.firebase.auth.EmailAuthProvider.credential(this.usuario.email, String(clave || ''));
      await this.usuario.reauthenticateWithCredential(cred);
    }
    async cambiarClave(actualClave, nueva) {
      const e = REGLAS.clave(nueva); if (e) return { ok: false, error: e };
      if (actualClave === nueva) return { ok: false, error: 'La nueva contraseña es igual a la actual' };
      try { await this._reautenticar(actualClave); await this.usuario.updatePassword(String(nueva)); return { ok: true }; }
      catch (err) { return { ok: false, error: err && err.code === 'auth/wrong-password' || err && err.code === 'auth/invalid-credential' ? 'La contraseña actual no es correcta' : msgFB(err) }; }
    }
    async vincular(codigo) { this.perfil.comedero = String(codigo).trim().toUpperCase(); escribir(this.claveSesion, this.perfil); return { ok: true }; }
    async eliminar(clave) {
      try { await this._reautenticar(clave); await this.usuario.delete(); this.usuario = null; localStorage.removeItem(this.claveSesion); return { ok: true }; }
      catch (err) { return { ok: false, error: err && (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') ? 'La contraseña no es correcta' : msgFB(err) }; }
    }
  }

  root.CuentaDueno = {
    REGLAS,
    crear(rol) {
      const cfg = root.FIREBASE_CONFIG;
      if (rol === 'app' && cfg && cfg.apiKey && cfg.authDomain) {
        const c = new CuentaFirebase(cfg, rol);
        c.listo.catch((e) => { console.warn('Firebase Authentication no disponible:', e); });
        return c;
      }
      return new CuentaLocal(rol);
    },
    _CuentaLocal: CuentaLocal, _CuentaFirebase: CuentaFirebase
  };
  if (typeof module !== 'undefined') module.exports = root.CuentaDueno;
})(typeof window !== 'undefined' ? window : globalThis);
