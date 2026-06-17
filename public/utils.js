// utils.js - Utilidades comunes para la aplicacion de finanzas

/**
 * Formatea centavos a string de moneda MXN
 * @param {number} centavos
 * @returns {string}
 */
export function formatMXN(centavos) {
  const pesos = centavos / 100;
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2
  }).format(pesos);
}

/**
 * Convierte pesos (float/string) a centavos enteros
 * @param {number|string} pesos
 * @returns {number}
 */
export function toCents(pesos) {
  return Math.round(parseFloat(pesos) * 100);
}

/**
 * Convierte centavos a numero con decimales
 * @param {number} centavos
 * @returns {number}
 */
export function fromCents(centavos) {
  return centavos / 100;
}

/**
 * Formatea fecha ISO a string legible en espanol
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string}
 */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Retorna fecha de hoy en formato YYYY-MM-DD
 * @returns {string}
 */
export function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Genera ID unico
 * @returns {string}
 */
export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Valida que un valor sea numero mayor a 0
 * @param {any} value
 * @returns {boolean}
 */
export function validateAmount(value) {
  const num = parseFloat(value);
  return !isNaN(num) && num > 0;
}

/**
 * Valida que una cadena sea una fecha valida
 * @param {string} dateStr
 * @returns {boolean}
 */
export function validateDate(dateStr) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Muestra una notificacion flotante
 * @param {string} msg - Mensaje a mostrar
 * @param {'success'|'error'|'info'} type - Tipo de notificacion
 */
export function showToast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`,
    error: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`,
    info: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-msg">${msg}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>
  `;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  // Auto remove after 4 seconds
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hiding');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/**
 * Formatea numero de fecha como YYYY-MM-DD desde un Date object
 * @param {Date} date
 * @returns {string}
 */
export function dateToISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Obtiene el primer dia del mes actual en formato ISO
 * @returns {string}
 */
export function firstDayOfMonth() {
  const now = new Date();
  return dateToISO(new Date(now.getFullYear(), now.getMonth(), 1));
}

/**
 * Obtiene el ultimo dia del mes actual en formato ISO
 * @returns {string}
 */
export function lastDayOfMonth() {
  const now = new Date();
  return dateToISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

/**
 * Trunca texto largo
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
export function truncate(text, maxLen = 40) {
  if (!text) return '';
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}
