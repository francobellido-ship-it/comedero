/* ============================================================================
 * Configuración de Firebase — proyecto "comedero-gatos"
 * ----------------------------------------------------------------------------
 * Con esto, la app del celular (app.html o el APK) y el comedero de la PC
 * (comedero.html) se encuentran por Firebase Realtime Database, como en la tesis,
 * y las cuentas del dueño usan Firebase Authentication (correo y contraseña).
 * La demo todo-en-uno (demo.html) no usa Firebase: funciona sin internet.
 *
 * Proyecto creado el 24-11-2026 con la cuenta ccusfrancobellido@gmail.com:
 *  - Realtime Database en us-central1, reglas: solo /comederos/COMEDERO-XXXX.
 *  - Authentication: correo/contraseña habilitado; dominios autorizados:
 *    localhost, 127.0.0.1 y francobellido-ship-it.github.io.
 * Estos datos identifican el proyecto (no son una contraseña): es normal que
 * vayan en una página web pública.
 * ==========================================================================*/
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCB-HVVgabMtn-vIsC6uwHNvhCRwluTtWQ',
  authDomain: 'comedero-gatos.firebaseapp.com',
  databaseURL: 'https://comedero-gatos-default-rtdb.firebaseio.com',
  projectId: 'comedero-gatos',
  storageBucket: 'comedero-gatos.firebasestorage.app',
  messagingSenderId: '765299491657',
  appId: '1:765299491657:web:9258535d9e972f736ed098'
};
window.CODIGO_COMEDERO = 'COMEDERO-4F2A';
// Para pruebas: comedero.html?codigo=COMEDERO-XXXX usa otro canal y no toca los datos del equipo real
(function () {
  try {
    var c = new URLSearchParams(location.search).get('codigo');
    if (c && /^COMEDERO-[0-9A-F]{4}$/.test(c)) window.CODIGO_COMEDERO = c;
  } catch (e) { /* sin parámetros */ }
})();
