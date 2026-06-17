import { onAuthChange, loginUser, registerUser, logoutUser } from './auth.js';
import { initUserDoc } from './firestore.js';
import { loadDashboard, setupDashboardFilters } from './dashboard.js';
import { setupAccountsSection } from './accounts.js';
import { setupTransactionsSection } from './transactions.js';
import { setupCategoriesSection, initDefaultCategories, populateCategorySelects } from './categories.js';
import { setupGoalsSection } from './goals.js';
import { setupDebtsSection } from './debts.js';
import { setupImportExport } from './import-export.js';
import { showToast } from './utils.js';

// ============================================================
// Navigation
// ============================================================

const sections = ['dashboard', 'accounts', 'transactions', 'categories', 'goals', 'debts', 'export'];

function navigateTo(sectionId) {
  sections.forEach(s => {
    const el = document.getElementById(`section-${s}`);
    if (el) el.classList.toggle('active', s === sectionId);
  });

  // Update nav active state
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === sectionId);
  });

  // Store current section
  sessionStorage.setItem('currentSection', sectionId);
}

// ============================================================
// Auth UI
// ============================================================

function showAuth() {
  document.getElementById('auth-screen').style.display = '';
  document.getElementById('app-screen').style.display = 'none';
  showLoginPanel();
}

function showApp(user) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = '';
  const emailEl = document.getElementById('user-email-display');
  if (emailEl) emailEl.textContent = user.email;
}

function showLoginPanel() {
  document.getElementById('login-panel').style.display = '';
  document.getElementById('register-panel').style.display = 'none';
}

function showRegisterPanel() {
  document.getElementById('login-panel').style.display = 'none';
  document.getElementById('register-panel').style.display = '';
}

// ============================================================
// App Initialization
// ============================================================

let appInitialized = false;

async function initApp(user) {
  if (appInitialized) {
    showApp(user);
    return;
  }

  showApp(user);

  try {
    await initUserDoc(user.uid);
    await initDefaultCategories(user.uid);

    // Setup all sections
    setupDashboardFilters(user.uid);
    setupAccountsSection(user.uid);
    await setupTransactionsSection(user.uid);
    setupGoalsSection(user.uid);
    setupDebtsSection(user.uid);
    await setupCategoriesSection(user.uid);
    setupImportExport(user.uid);

    // Navigate to stored section or dashboard
    const lastSection = sessionStorage.getItem('currentSection') || 'dashboard';
    navigateTo(lastSection);

    // Load dashboard
    await loadDashboard(user.uid, 'month');

    appInitialized = true;
  } catch (err) {
    console.error('Error inicializando app:', err);
    showToast('Error al cargar la aplicacion. Verifica tu configuracion de Firebase.', 'error');
  }
}

// ============================================================
// Event Listeners
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Auth state listener
  onAuthChange(async (user) => {
    if (user) {
      await initApp(user);
    } else {
      appInitialized = false;
      showAuth();
    }
  });

  // Login form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const btn = loginForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Entrando...';
      try {
        await loginUser(email, password);
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    });
  }

  // Register form
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('register-email').value;
      const password = document.getElementById('register-password').value;
      const confirm = document.getElementById('register-confirm-password').value;

      if (password !== confirm) {
        showToast('Las contrasenas no coinciden', 'error');
        return;
      }
      if (password.length < 6) {
        showToast('La contrasena debe tener al menos 6 caracteres', 'error');
        return;
      }

      const btn = registerForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Registrando...';
      try {
        await registerUser(email, password);
        showToast('Cuenta creada exitosamente', 'success');
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Registrarme';
      }
    });
  }

  // Switch between login/register
  document.getElementById('go-to-register')?.addEventListener('click', (e) => {
    e.preventDefault();
    showRegisterPanel();
  });
  document.getElementById('go-to-login')?.addEventListener('click', (e) => {
    e.preventDefault();
    showLoginPanel();
  });

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await logoutUser();
      appInitialized = false;
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Navigation links
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const target = el.dataset.nav;
      if (sections.includes(target)) {
        navigateTo(target);
        // Close mobile menu if open
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('open');
      }
    });
  });

  // Mobile menu toggle
  document.getElementById('mobile-menu-toggle')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('open');
  });

  // Close sidebar when clicking overlay
  document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('open');
  });
});
