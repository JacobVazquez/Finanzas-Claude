import { readDocs } from './firestore.js';
import { formatMXN, firstDayOfMonth, lastDayOfMonth, todayISO, dateToISO, showToast } from './utils.js';
import { getTransactions, renderTransactionsList } from './transactions.js';
import { getAccounts, calculateAccountBalance, renderAccountCards } from './accounts.js';

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
  const balances = await Promise.all(accounts.map(a => calculateAccountBalance(uid, a.id)));
  const netWorth = balances.reduce((sum, b) => sum + b, 0);

  return { totalIncome, totalExpenses, balance, savingsRate, netWorth };
}

/**
 * Renderiza las tarjetas KPI
 */
export function renderKPICards(data) {
  const { totalIncome, totalExpenses, balance, savingsRate, netWorth } = data;

  const setEl = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };

  setEl('kpi-income', formatMXN(totalIncome));
  setEl('kpi-expenses', formatMXN(totalExpenses));
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
 * Inicializa los filtros del dashboard
 */
export function setupDashboardFilters(uid) {
  const filterBtns = document.querySelectorAll('.dashboard-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
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
      await loadDashboard(uid, 'custom', start, end);
    });
  }
}
