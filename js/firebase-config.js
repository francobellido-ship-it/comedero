/* ============================================================================
 * Configuración de Firebase (opcional)
 * ----------------------------------------------------------------------------
 * Sin esto, la app y el comedero se conectan entre pestañas del mismo navegador.
 * Con esto, la app del celular (APK) y el comedero de la PC se encuentran por
 * Firebase Realtime Database, como en la tesis (Tabla 7.6).
 *
 * 1. https://console.firebase.google.com → Agregar proyecto (sin Analytics).
 * 2. Compilación → Realtime Database → Crear base de datos → "modo de prueba".
 * 3. Configuración del proyecto → Tus apps → Web (</>) → registra la app y copia
 *    el objeto firebaseConfig aquí abajo (debe tener databaseURL).
 * 4. Usa el mismo código de comedero en todos tus dispositivos.
 * ==========================================================================*/
window.FIREBASE_CONFIG = null;
/* Ejemplo (reemplaza con el tuyo y quita los comentarios):
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "comedero-tesis.firebaseapp.com",
  databaseURL: "https://comedero-tesis-default-rtdb.firebaseio.com",
  projectId: "comedero-tesis",
  storageBucket: "comedero-tesis.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
*/
window.CODIGO_COMEDERO = 'COMEDERO-4F2A';
