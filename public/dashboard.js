import { readDocs } from './firestore.js';
import { formatMXN, firstDayOfMonth, lastDayOfMonth, todayISO, dateToISO, showToast, dispatchDataChange } from './utils.js';
import { getTransactions, renderTransactionsList, addIncome, addExpense } from './transactions.js';
import { getAccounts, calculateAccountBalance, renderAccountCards, getTotalYieldCents } from './accounts.js';
import { getExpenseCategories, getIncomeTypes } from './categories.js';

// Estado del filtro activo en el dashboard
let _activeFilter = 'month';
let _customStart = null;
let _customEnd = null;
let _dashboardUid = null;

export function getActiveFilter() { return _activeFilter; }

/**
 * Calcula KPIs para un periodo dado
 * @returns {Promise<{totalIncome, totalExpenses, balance, savingsRate, netWorth}>}
 */
export async function calculateKPIs(uid, startDate, endDate) {
  const [transactions, accounts] = await Promise.all([
    getTransactions(uid, { startDate, endDate }),
    getAccounts(uid)
  ]);

  let totalIncome = 0;
  let totalExpenses = 0;

  for (const t of transactions) {
    if (t.type === 'income') totalIncome += t.amount;
    else if (t.type === 'expense') totalExpenses += t.amount;
    else if (t.type === 'debt_payment') totalExpenses += t.amount;
    else if (t.type === 'goal_contribution') totalExpenses += t.amount;
  }

  const balance = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? Math.round((balance / totalIncome) * 100) : 0;

  // Net worth: sum of all account balances
  const [balances, totalYield] = await Promise.all([
    Promise.all(accounts.map(a => calculateAccountBalance(uid, a.id))),
    getTotalYieldCents(uid)
  ]);
  const netWorth = balances.reduce((sum, b) => sum + b, 0);

  return { totalIncome, totalExpenses, balance, savingsRate, netWorth, totalYield };
}

/**
 * Renderiza las tarjetas KPI
 */
export function renderKPICards(data) {
  const { totalIncome, totalExpenses, balance, savingsRate, netWorth, totalYield } = data;

  const setEl = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };

  setEl('kpi-income', formatMXN(totalIncome));
  setEl('kpi-expenses', formatMXN(totalExpenses));
  setEl('kpi-total-yield', formatMXN(totalYield || 0));
  setEl('kpi-balance', formatMXN(balance));
  setEl('kpi-savings-rate', `${savingsRate}%`);
  setEl('kpi-net-worth', formatMXN(netWorth));

  // Color coding
  const balanceCard = document.getElementById('kpi-balance-card');
  if (balanceCard) {
    balanceCard.classList.toggle('kpi-positive', balance >= 0);
    balanceCard.classList.toggle('kpi-negative', balance < 0);
  }
}

/**
 * Renderiza movimientos recientes en el dashboard
 */
export async function renderRecentTransactions(uid, limit = 8) {
  const container = document.getElementById('dashboard-recent-transactions');
  if (!container) return;

  const transactions = await getTransactions(uid, {});
  const recent = transactions.slice(0, limit);
  const accounts = await getAccounts(uid);
  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));

  const { TRANSACTION_TYPES } = await import('./transactions.js');

  if (recent.length === 0) {
    container.innerHTML = '<p class="empty-state">No hay movimientos recientes.</p>';
    return;
  }

  container.innerHTML = `
    <div class="recent-tx-list">
      ${recent.map(t => {
        const isPositive = t.type === 'income' || t.type === 'transfer_in';
        return `
          <div class="recent-tx-item">
            <div class="recent-tx-icon tx-icon-${t.type}">
              ${txIcon(t.type)}
            </div>
            <div class="recent-tx-info">
              <span class="recent-tx-type">${TRANSACTION_TYPES[t.type] || t.type}</span>
              <span class="recent-tx-account">${accountMap[t.accountId] || '-'}</span>
            </div>
            <div class="recent-tx-meta">
              <span class="recent-tx-date">${formatShortDate(t.date)}</span>
              <span class="recent-tx-amount ${isPositive ? 'text-success' : 'text-danger'}">
                ${isPositive ? '+' : '-'}${formatMXN(t.amount)}
              </span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function txIcon(type) {
  const icons = {
    income: '⬆️',
    expense: '⬇️',
    transfer_out: '➡️',
    transfer_in: '⬅️',
    debt_payment: '💸',
    goal_contribution: '🎯'
  };
  return icons[type] || '💰';
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

/**
 * Obtiene rango de fechas segun el filtro seleccionado
 */
function getDateRange(filter, customStart, customEnd) {
  const today = new Date();
  let startDate, endDate;

  switch (filter) {
    case 'day':
      startDate = todayISO();
      endDate = todayISO();
      break;
    case 'week': {
      const dayOfWeek = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      startDate = dateToISO(monday);
      endDate = todayISO();
      break;
    }
    case 'year':
      startDate = `${today.getFullYear()}-01-01`;
      endDate = `${today.getFullYear()}-12-31`;
      break;
    case 'custom':
      startDate = customStart;
      endDate = customEnd;
      break;
    case 'month':
    default:
      startDate = firstDayOfMonth();
      endDate = lastDayOfMonth();
      break;
  }

  return { startDate, endDate };
}

/**
 * Carga el dashboard completo
 */
export async function loadDashboard(uid, filter = 'month', customStart, customEnd) {
  const { startDate, endDate } = getDateRange(filter, customStart, customEnd);

  try {
    const [kpis] = await Promise.all([
      calculateKPIs(uid, startDate, endDate),
      renderAccountCards(uid),
      renderRecentTransactions(uid)
    ]);

    renderKPICards(kpis);

    // Update charts if available
    const { updateAllCharts } = await import('./charts.js');
    await updateAllCharts(uid, startDate, endDate);
  } catch (err) {
    console.error('Error cargando dashboard:', err);
    showToast('Error cargando el dashboard', 'error');
  }
}

/**
 * Abre un modal por id
 */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

/**
 * Popula los selects de cuentas/categorias dentro de los modales rapidos
 */
async function populateModalSelects(uid) {
  const [accounts, categories, incomeTypes] = await Promise.all([
    getAccounts(uid),
    getExpenseCategories(uid),
    getIncomeTypes(uid)
  ]);

  const accountOptions = '<option value="">-- Seleccionar cuenta --</option>' +
    accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

  document.querySelectorAll('.select-account-modal').forEach(sel => {
    sel.innerHTML = accountOptions;
  });

  const expCatOptions = '<option value="">-- Sin categoria --</option>' +
    categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  document.querySelectorAll('.select-expense-category-modal').forEach(sel => {
    sel.innerHTML = expCatOptions;
  });

  const incTypeOptions = '<option value="">-- Sin tipo --</option>' +
    incomeTypes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  document.querySelectorAll('.select-income-type-modal').forEach(sel => {
    sel.innerHTML = incTypeOptions;
  });
}

/**
 * Configura los botones de acceso rapido y sus modales en el dashboard
 */
export async function setupDashboardQuickActions(uid) {
  await populateModalSelects(uid);

  // Fechas por defecto
  const today = todayISO();
  const qiDate = document.getElementById('qi-date');
  const qeDate = document.getElementById('qe-date');
  if (qiDate) qiDate.value = today;
  if (qeDate) qeDate.value = today;

  // Abrir modales
  document.getElementById('btn-quick-income')?.addEventListener('click', () => openModal('modal-quick-income'));
  document.getElementById('btn-quick-expense')?.addEventListener('click', () => openModal('modal-quick-expense'));

  // Cerrar modales (botones con data-close y click fuera)
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Tecla Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal('modal-quick-income');
      closeModal('modal-quick-expense');
    }
  });

  // Form ingreso rapido
  const qiForm = document.getElementById('quick-income-form');
  if (qiForm) {
    qiForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = qiForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await addIncome(uid, {
          accountId: document.getElementById('qi-account').value,
          incomeTypeId: document.getElementById('qi-type').value,
          amount: document.getElementById('qi-amount').value,
          date: document.getElementById('qi-date').value,
          description: document.getElementById('qi-description').value
        });
        showToast('Ingreso registrado', 'success');
        qiForm.reset();
        document.getElementById('qi-date').value = todayISO();
        closeModal('modal-quick-income');
        dispatchDataChange();
        await loadDashboard(uid);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Form egreso rapido
  const qeForm = document.getElementById('quick-expense-form');
  if (qeForm) {
    qeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = qeForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await addExpense(uid, {
          accountId: document.getElementById('qe-account').value,
          categoryId: document.getElementById('qe-category').value,
          amount: document.getElementById('qe-amount').value,
          date: document.getElementById('qe-date').value,
          description: document.getElementById('qe-description').value
        });
        showToast('Egreso registrado', 'success');
        qeForm.reset();
        document.getElementById('qe-date').value = todayISO();
        closeModal('modal-quick-expense');
        dispatchDataChange();
        await loadDashboard(uid);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }
}

/**
 * Inicializa los filtros del dashboard y el listener de auto-refresh
 */
export function setupDashboardFilters(uid) {
  _dashboardUid = uid;

  const filterBtns = document.querySelectorAll('.dashboard-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      _activeFilter = filter;
      const customPanel = document.getElementById('custom-date-panel');
      if (customPanel) {
        customPanel.style.display = filter === 'custom' ? 'flex' : 'none';
      }
      if (filter !== 'custom') {
        await loadDashboard(uid, filter);
      }
    });
  });

  const applyCustomBtn = document.getElementById('apply-custom-dates');
  if (applyCustomBtn) {
    applyCustomBtn.addEventListener('click', async () => {
      const start = document.getElementById('custom-start-date')?.value;
      const end = document.getElementById('custom-end-date')?.value;
      if (!start || !end) {
        showToast('Selecciona las fechas de inicio y fin', 'error');
        return;
      }
      _customStart = start;
      _customEnd = end;
      await loadDashboard(uid, 'custom', start, end);
    });
  }

  // Auto-refresh: recarga el dashboard cuando cualquier modulo cambia datos
  window.addEventListener('finanzas:changed', async () => {
    const dashSection = document.getElementById('section-dashboard');
    if (!dashSection?.classList.contains('active')) return;
    await loadDashboard(uid, _activeFilter, _customStart, _customEnd);
  });
}
