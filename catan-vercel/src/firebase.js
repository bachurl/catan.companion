import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyALlcTbgA3WXiyiMZrD0XSDJx1e99zKSCU",
  authDomain: "catancompanion.firebaseapp.com",
  databaseURL: "https://catancompanion-default-rtdb.firebaseio.com",
  projectId: "catancompanion",
  storageBucket: "catancompanion.firebasestorage.app",
  messagingSenderId: "1069595333063",
  appId: "1:1069595333063:web:fef823215dd79c52b289e2",
  measurementId: "G-9GSX7BLGC5"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db };
