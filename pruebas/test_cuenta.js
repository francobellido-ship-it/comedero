/* Pruebas de la cuenta del dueño (js/cuenta.js): forma local y forma Firebase (con un Firebase falso). */
'use strict';
const almacen = {};
globalThis.localStorage = { getItem: (k) => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: (k) => { delete almacen[k]; } };
globalThis.window = globalThis;
const CD = require('../js/cuenta.js');

// Firebase Authentication falso: mismas funciones y códigos de error que el SDK compat
function firebaseFalso() {
  const usuarios = {}; let actual = null; const oyentes = [];
  const err = (code) => { const e = new Error(code); e.code = code; return e; };
  const hacerUsuario = (u) => ({
    get email() { return u.correo; }, get displayName() { return u.nombre; }, metadata: { creationTime: new Date().toUTCString() },
    async updateProfile(p) { u.nombre = p.displayName; },
    async reauthenticateWithCredential(c) { if (c.clave !== u.clave) throw err('auth/wrong-password'); },
    async updatePassword(n) { u.clave = n; },
    async delete() { delete usuarios[u.correo]; actual = null; }
  });
  const auth = {
    onAuthStateChanged(f) { oyentes.push(f); setTimeout(() => f(actual), 0); return () => { const i = oyentes.indexOf(f); if (i >= 0) oyentes.splice(i, 1); }; },
    async createUserWithEmailAndPassword(c, k) { if (usuarios[c]) throw err('auth/email-already-in-use'); if (k.length < 6) throw err('auth/weak-password'); usuarios[c] = { correo: c, clave: k, nombre: null }; actual = hacerUsuario(usuarios[c]); return { user: actual }; },
    async signInWithEmailAndPassword(c, k) { const u = usuarios[c]; if (!u || u.clave !== k) throw err('auth/invalid-credential'); actual = hacerUsuario(u); return { user: actual }; },
    async sendPasswordResetEmail(c) { if (!usuarios[c]) throw err('auth/user-not-found'); },
    async signOut() { actual = null; }
  };
  const fb = { apps: [], initializeApp() { this.apps.push({}); return {}; }, app() { return {}; }, auth: () => auth };
  fb.auth.EmailAuthProvider = { credential: (correo, clave) => ({ correo, clave }) };
  return fb;
}

const casos = [];
const caso = (n, f) => casos.push([n, f]);
async function probar(nombre, nueva) {
  caso(`${nombre}: crear cuenta valida los datos`, async () => {
    const c = nueva();
    const r = [await c.crear({ nombre: '', correo: 'a@b.com', clave: '123456' }), await c.crear({ nombre: 'Franco', correo: 'malo', clave: '123456' }), await c.crear({ nombre: 'Franco', correo: 'f@gmail.com', clave: '123' })];
    return r.every((x) => !x.ok) && /nombre/.test(r[0].error) && /válido/.test(r[1].error) && /6/.test(r[2].error);
  });
  caso(`${nombre}: crear, cerrar sesión y entrar (correo sin importar mayúsculas)`, async () => {
    const c = nueva();
    const a = await c.crear({ nombre: 'Franco', correo: 'Franco@Gmail.com ', clave: 'gatitos1' });
    const u1 = c.actual(); await c.salir(); const u2 = c.actual();
    const b = await c.entrar({ correo: 'franco@gmail.com', clave: 'mala123' });
    const d = await c.entrar({ correo: 'FRANCO@gmail.com', clave: 'gatitos1' });
    return a.ok && u1 && u1.nombre === 'Franco' && u1.correo === 'franco@gmail.com' && !u2 && !b.ok && d.ok && c.actual().nombre === 'Franco';
  });
  caso(`${nombre}: no se repite el correo`, async () => {
    const c = nueva(); await c.crear({ nombre: 'A', correo: 'x@y.com', clave: '123456' }); await c.salir();
    const r = await c.crear({ nombre: 'B', correo: 'X@y.com', clave: '654321' });
    return !r.ok && /Ya hay una cuenta/.test(r.error);
  });
  caso(`${nombre}: cambiar nombre y contraseña`, async () => {
    const c = nueva(); await c.crear({ nombre: 'A', correo: 'n@y.com', clave: '123456' });
    const n = await c.cambiarNombre('Ana'); const m = await c.cambiarClave('nolase', 'abcdef'); const k = await c.cambiarClave('123456', 'abcdef');
    await c.salir(); const v = await c.entrar({ correo: 'n@y.com', clave: '123456' }); const w = await c.entrar({ correo: 'n@y.com', clave: 'abcdef' });
    return n.ok && c.actual().nombre === 'Ana' && !m.ok && k.ok && !v.ok && w.ok;
  });
  caso(`${nombre}: vincular el comedero y eliminar la cuenta con la contraseña`, async () => {
    const c = nueva(); await c.crear({ nombre: 'E', correo: 'e@y.com', clave: '123456' });
    await c.vincular('comedero-4f2a'); const cod = c.actual().comedero;
    const x = await c.eliminar('mala'); const y = await c.eliminar('123456');
    const z = await c.entrar({ correo: 'e@y.com', clave: '123456' });
    return cod === 'COMEDERO-4F2A' && !x.ok && y.ok && !c.actual() && !z.ok;
  });
}
caso('Código del comedero: forma y coincidencia con la etiqueta', async () => {
  const R = CD.REGLAS;
  return R.codigo('', 'COMEDERO-4F2A') && R.codigo('COMEDERO 12', 'COMEDERO-4F2A') && /No encontramos/.test(R.codigo('COMEDERO-1234', 'COMEDERO-4F2A')) && R.codigo('comedero-4f2a', 'COMEDERO-4F2A') === '';
});
caso('Local: la contraseña no se guarda, solo su huella con sal', async () => {
  const c = new CD._CuentaLocal('t'); await c.crear({ nombre: 'S', correo: 's@y.com', clave: 'secreto99' });
  const txt = almacen['comedero_cuentas_v1'] || '';
  return !txt.includes('secreto99') && /pbkdf2:[0-9a-f]{64}/.test(txt);
});

(async () => {
  await probar('Local', () => new CD._CuentaLocal('prueba'));
  await probar('Firebase', () => { globalThis.firebase = firebaseFalso(); return new CD._CuentaFirebase({ apiKey: 'x', authDomain: 'x' }, 'prueba'); });
  let bien = 0;
  for (const [n, f] of casos) {
    let ok = false; try { ok = !!(await f()); } catch (e) { console.log('   error:', e.message); }
    console.log((ok ? '  ✔ ' : '  ✘ ') + n); if (ok) bien++;
  }
  console.log(`Resultado: ${bien} de ${casos.length} casos de la cuenta correctos`);
  process.exitCode = bien === casos.length ? 0 : 1;
})();
