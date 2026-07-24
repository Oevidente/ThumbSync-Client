import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  projectId: "robotic-century-498520-e2",
  appId: "1:272601092637:web:444a89fb73d019aa3dacf4",
  apiKey: "AIzaSyAtFJkMRreLow6x8-yc4Vd7mn6avCuQz3o",
  authDomain: "robotic-century-498520-e2.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-thumbsyncclient-9a070013-569f-4149-8f2d-5603146c9313",
  storageBucket: "robotic-century-498520-e2.firebasestorage.app",
  messagingSenderId: "272601092637",
  oAuthClientId: "272601092637-74ect8eqrrtar3rsjk0im4fgieahv0qj.apps.googleusercontent.com"
};

let app = null;
let db = null;
let isFirebaseConnected = false;
let firebaseErrorMessage = '';
let lastSyncTime = null;

try {
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  if (firebaseConfig.firestoreDatabaseId) {
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  } else {
    db = getFirestore(app);
  }
} catch (e) {
  console.warn("Erro ao inicializar Firebase:", e);
  firebaseErrorMessage = e.message;
}

export const firebaseService = {
  isConfigured() {
    return !!db;
  },

  getStatus() {
    return {
      connected: isFirebaseConnected,
      errorMessage: firebaseErrorMessage,
      lastSyncTime: lastSyncTime
    };
  },

  async saveData(docId, payload) {
    if (!db) {
      isFirebaseConnected = false;
      return false;
    }
    try {
      const docRef = doc(db, 'app_data', docId);
      const dataToSave = {
        ...payload,
        updatedAt: new Date().toISOString()
      };
      await setDoc(docRef, dataToSave, { merge: true });
      isFirebaseConnected = true;
      firebaseErrorMessage = '';
      lastSyncTime = new Date().toLocaleTimeString();
      return true;
    } catch (e) {
      console.warn(`Erro ao salvar '${docId}' no Firebase:`, e);
      isFirebaseConnected = false;
      firebaseErrorMessage = e.message;
      return false;
    }
  },

  async loadData(docId) {
    if (!db) {
      isFirebaseConnected = false;
      return null;
    }
    try {
      const docRef = doc(db, 'app_data', docId);
      const snapshot = await getDoc(docRef);
      if (snapshot.exists()) {
        isFirebaseConnected = true;
        firebaseErrorMessage = '';
        lastSyncTime = new Date().toLocaleTimeString();
        return snapshot.data();
      } else {
        isFirebaseConnected = true;
        return null;
      }
    } catch (e) {
      console.warn(`Erro ao ler '${docId}' do Firebase:`, e);
      isFirebaseConnected = false;
      firebaseErrorMessage = e.message;
      return null;
    }
  },

  async loadAllData() {
    if (!db) {
      isFirebaseConnected = false;
      return null;
    }
    try {
      const [lista, tags, history, dates, emerson, admin_accs] = await Promise.all([
        this.loadData('lista'),
        this.loadData('tags'),
        this.loadData('history'),
        this.loadData('dates'),
        this.loadData('emerson_accounts'),
        this.loadData('admin_accounts')
      ]);

      return {
        lista,
        tags,
        history,
        dates,
        emerson,
        admin_accs
      };
    } catch (e) {
      console.warn("Erro ao carregar dados do Firebase:", e);
      isFirebaseConnected = false;
      firebaseErrorMessage = e.message;
      return null;
    }
  }
};
