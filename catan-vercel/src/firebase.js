import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

// ══════════════════════════════════════════════════════════════
//  CONFIGURÁ TUS CREDENCIALES DE FIREBASE ACÁ
//  1. Andá a https://console.firebase.google.com
//  2. Creá un proyecto (o usá uno existente)
//  3. Activá Realtime Database (en modo test para empezar)
//  4. En Project Settings > General, copiá la config de tu web app
//  5. Reemplazá los valores "TU_..." con los de tu proyecto
// ══════════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  databaseURL: "https://TU_PROYECTO-default-rtdb.firebaseio.com",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_PROYECTO.firebasestorage.app",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};

let db = null;

try {
  if (!firebaseConfig.apiKey.startsWith('TU_')) {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
  }
} catch (e) {
  console.warn('[Catán] Firebase no configurado:', e.message);
}

export { db };
