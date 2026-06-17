import {
  getFirestore,
  doc,
  collection,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { auth } from './auth.js';

// Importamos la app ya inicializada desde auth.js via el mismo initializeApp
// Firebase reutiliza la instancia si el config es igual
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { firebaseConfig } from './firebase-config.js';

let _app;
if (getApps().length === 0) {
  _app = initializeApp(firebaseConfig);
} else {
  _app = getApps()[0];
}

export const db = getFirestore(_app);

/**
 * Referencia al documento principal del usuario
 * @param {string} uid
 */
export function userRef(uid) {
  return doc(db, 'users', uid);
}

/**
 * Referencia a una coleccion dentro del usuario
 * @param {string} uid
 * @param {string} colName
 */
export function userCol(uid, colName) {
  return collection(db, 'users', uid, colName);
}

/**
 * Crea un nuevo documento en una coleccion del usuario
 * @param {string} uid
 * @param {string} colName
 * @param {object} data
 * @returns {Promise<string>} ID del documento creado
 */
export async function createDoc(uid, colName, data) {
  const colRef = userCol(uid, colName);
  const docRef = await addDoc(colRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return docRef.id;
}

/**
 * Lee todos los documentos de una coleccion del usuario
 * @param {string} uid
 * @param {string} colName
 * @returns {Promise<Array<{id: string, ...}>>}
 */
export async function readDocs(uid, colName) {
  const colRef = userCol(uid, colName);
  const snapshot = await getDocs(colRef);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Actualiza un documento por ID
 * @param {string} uid
 * @param {string} colName
 * @param {string} id
 * @param {object} data
 */
export async function updateDocById(uid, colName, id, data) {
  const docRef = doc(db, 'users', uid, colName, id);
  await updateDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp()
  });
}

/**
 * Elimina un documento por ID
 * @param {string} uid
 * @param {string} colName
 * @param {string} id
 */
export async function deleteDocById(uid, colName, id) {
  const docRef = doc(db, 'users', uid, colName, id);
  await deleteDoc(docRef);
}

/**
 * Obtiene un documento por ID
 * @param {string} uid
 * @param {string} colName
 * @param {string} id
 * @returns {Promise<{id: string, ...}|null>}
 */
export async function getDocById(uid, colName, id) {
  const docRef = doc(db, 'users', uid, colName, id);
  const snapshot = await getDoc(docRef);
  if (snapshot.exists()) {
    return { id: snapshot.id, ...snapshot.data() };
  }
  return null;
}

/**
 * Inicializa el documento principal del usuario si no existe
 * @param {string} uid
 */
export async function initUserDoc(uid) {
  const ref = userRef(uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    await setDoc(ref, {
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}

/**
 * Convierte un Timestamp de Firestore a string ISO YYYY-MM-DD
 * @param {Timestamp|string|null} ts
 * @returns {string}
 */
export function tsToISO(ts) {
  if (!ts) return '';
  if (typeof ts === 'string') return ts;
  if (ts.toDate) {
    const d = ts.toDate();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return '';
}
