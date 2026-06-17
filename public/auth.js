import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/**
 * Registra un nuevo usuario con email y password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<import('firebase/auth').UserCredential>}
 */
export async function registerUser(email, password) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    return userCredential;
  } catch (error) {
    const msg = translateAuthError(error.code);
    throw new Error(msg);
  }
}

/**
 * Inicia sesion con email y password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<import('firebase/auth').UserCredential>}
 */
export async function loginUser(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential;
  } catch (error) {
    const msg = translateAuthError(error.code);
    throw new Error(msg);
  }
}

/**
 * Cierra la sesion del usuario actual
 * @returns {Promise<void>}
 */
export async function logoutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    throw new Error('Error al cerrar sesion. Intenta de nuevo.');
  }
}

/**
 * Escucha cambios en el estado de autenticacion
 * @param {function} callback - Funcion que recibe el usuario (o null)
 */
export function onAuthChange(callback) {
  onAuthStateChanged(auth, callback);
}

/**
 * Retorna el usuario actualmente autenticado
 * @returns {import('firebase/auth').User|null}
 */
export function getCurrentUser() {
  return auth.currentUser;
}

/**
 * Traduce codigos de error de Firebase Auth a mensajes en espanol
 * @param {string} code
 * @returns {string}
 */
function translateAuthError(code) {
  const errors = {
    'auth/email-already-in-use': 'Este correo ya esta registrado. Intenta iniciar sesion.',
    'auth/invalid-email': 'El formato del correo no es valido.',
    'auth/weak-password': 'La contrasena debe tener al menos 6 caracteres.',
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/wrong-password': 'Contrasena incorrecta. Intenta de nuevo.',
    'auth/too-many-requests': 'Demasiados intentos fallidos. Espera un momento e intenta de nuevo.',
    'auth/network-request-failed': 'Error de red. Verifica tu conexion a internet.',
    'auth/user-disabled': 'Esta cuenta ha sido deshabilitada.',
    'auth/invalid-credential': 'Credenciales invalidas. Verifica tu correo y contrasena.',
  };
  return errors[code] || `Error de autenticacion: ${code}`;
}
