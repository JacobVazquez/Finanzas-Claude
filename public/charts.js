import { getTransactions } from './transactions.js';
import { getAccounts, calculateAccountBalance } from './accounts.js';
import { getExpenseCategories } from './categories.js';
import { getGoals } from './goals.js';
import { getDebts } from './debts.js';
import { fromCents, dateToISO } from './utils.js';

// Chart instances storage to destroy before recreating
const chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

function getChart() {
  return window.Chart;
}

const COLORS = {
  primary: '#6366F1',
  secondary: '#8B5CF6',
  success: '#10B981',
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
  muted: '#94A3B8',
  palette: [
    '#6366F1', '#8B5CF6', '#EC4899', '#EF4444', '#F59E0B',
    '#10B981', '#3B82F6', '#14B8A6', '#F97316', '#84CC16'
  ]
};

/**
 * Renderiza grafica de barras: ingresos vs egresos por mes
 */
export async function renderIncomeExpenseChart(uid, startDate, endDate) {
  const canvas = document.getElementById('chart-income-expense');
  if (!canvas) return;

  const Chart = getChart();
  if (!Chart) return;

  const transactions = await getTransactions(uid, { startDate, endDate });

  // Group by month
  const months = {};
  for (const t of transactions) {
    const month = t.date ? t.date.substring(0, 7) : 'unknown';
    if (!months[month]) months[month] = { income: 0, expense: 0 };
    if (t.type === 'income') months[month].income += t.amount;
    else if (t.type === 'expense' || t.type === 'debt_payment' || t.type === 'goal_contribution') {
      months[month].expense += t.amount;
    }
  }

  const labels = Object.keys(months).sort().map(m => {
    const [y, mo] = m.split('-');
    const date = new Date(parseInt(y), parseInt(mo) - 1, 1);
    return date.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
  });
  const sortedKeys = Object.keys(months).sort();
  const incomes = sortedKeys.map(k => fromCents(months[k].income));
  const expenses = sortedKeys.map(k => fromCents(months[k].expense));

  destroyChart('income-expense');
  chartInstances['income-expense'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ingresos', data: incomes, backgroundColor: COLORS.success + 'CC', borderColor: COLORS.success, borderWidth: 1 },
        { label: 'Egresos', data: expenses, backgroundColor: COLORS.danger + 'CC', borderColor: COLORS.danger, borderWidth: 1 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: $${ctx.raw.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => '$' + v.toLocaleString('es-MX') }
        }
      }
    }
  });
}

/**
 * Renderiza dona de egresos por categoria
 */
export async function renderExpenseByCategoryChart(uid, startDate, endDate) {
  const canvas = document.getElementById('chart-expense-category');
  if (!canvas) return;

  const Chart = getChart();
  if (!Chart) return;

  const [transactions, categories] = await Promise.all([
    getTransactions(uid, { startDate, endDate, type: 'expense' }),
    getExpenseCategories(uid)
  ]);

  const categoryMap = Object.fromEntries(categories.map(c => [c.id, c.name]));
  const data = {};

  for (const t of transactions) {
    const label = t.categoryId ? (categoryMap[t.categoryId] || 'Sin categoria') : 'Sin categoria';
    data[label] = (data[label] || 0) + t.amount;
  }

  const labels = Object.keys(data);
  const values = labels.map(l => fromCents(data[l]));

  destroyChart('expense-category');
  chartInstances['expense-category'] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: COLORS.palette.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: $${ctx.raw.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
          }
        }
      }
    }
  });
}

/**
 * Renderiza barras horizontales de saldos por cuenta
 */
export async function renderAccountBalancesChart(uid) {
  const canvas = document.getElementById('chart-account-balances');
  if (!canvas) return;

  const Chart = getChart();
  if (!Chart) return;

  const accounts = await getAccounts(uid);
  const balances = await Promise.all(accounts.map(a => calculateAccountBalance(uid, a.id)));

  const labels = accounts.map(a => a.name);
  const values = balances.map(b => fromCents(b));
  const colors = values.map(v => v >= 0 ? COLORS.success + 'CC' : COLORS.danger + 'CC');

  destroyChart('account-balances');
  chartInstances['account-balances'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Saldo',
        data: values,
        backgroundColor: colors,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `Saldo: $${ctx.raw.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
          }
        }
      },
      scales: {
        x: { ticks: { callback: v => '$' + v.toLocaleString('es-MX') } }
      }
    }
  });
}

/**
 * Renderiza barras de avance de metas
 */
export async function renderGoalsProgressChart(uid) {
  const canvas = document.getElementById('chart-goals-progress');
  if (!canvas) return;

  const Chart = getChart();
  if (!Chart) return;

  const goals = await getGoals(uid);
  const labels = goals.map(g => g.name);
  const accumulated = goals.map(g => fromCents(g.accumulated));
  const remaining = goals.map(g => fromCents(Math.max(0, g.targetAmount - g.accumulated)));

  destroyChart('goals-progress');
  chartInstances['goals-progress'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Acumulado', data: accumulated, backgroundColor: COLORS.primary + 'CC', stack: 'goals' },
        { label: 'Restante', data: remaining, backgroundColor: COLORS.muted + '66', stack: 'goals' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString('es-MX') } }
      }
    }
  });
}

/**
 * Renderiza barras de deudas (pagado vs pendiente)
 */
export async function renderDebtsChart(uid) {
  const canvas = document.getElementById('chart-debts');
  if (!canvas) return;

  const Chart = getChart();
  if (!Chart) return;

  const debts = await getDebts(uid);
  const active = debts.filter(d => d.status === 'active');
  const labels = active.map(d => d.name);
  const paid = active.map(d => fromCents(d.paidAmount));
  const pending = active.map(d => fromCents(d.pendingAmount));

  destroyChart('debts');
  chartInstances['debts'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Pagado', data: paid, backgroundColor: COLORS.success + 'CC', stack: 'debt' },
        { label: 'Pendiente', data: pending, backgroundColor: COLORS.danger + 'CC', stack: 'debt' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString('es-MX') } }
      }
    }
  });
}

/**
 * Renderiza tendencia mensual de los ultimos 6 meses
 */
export async function renderMonthlyTrendChart(uid) {
  const canvas = document.getElementById('chart-monthly-trend');
  if (!canvas) return;

  const Chart = getChart();
  if (!Chart) return;

  // Build last 6 months
  const today = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const start = dateToISO(new Date(d.getFullYear(), d.getMonth(), 1));
    const end = dateToISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const label = d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
    months.push({ start, end, label });
  }

  const allTx = await getTransactions(uid, {
    startDate: months[0].start,
    endDate: months[months.length - 1].end
  });

  const incomeData = [];
  const expenseData = [];

  for (const month of months) {
    const mTx = allTx.filter(t => t.date >= month.start && t.date <= month.end);
    let inc = 0, exp = 0;
    for (const t of mTx) {
      if (t.type === 'income') inc += t.amount;
      else if (t.type === 'expense' || t.type === 'debt_payment' || t.type === 'goal_contribution') exp += t.amount;
    }
    incomeData.push(fromCents(inc));
    expenseData.push(fromCents(exp));
  }

  destroyChart('monthly-trend');
  chartInstances['monthly-trend'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: months.map(m => m.label),
      datasets: [
        {
          label: 'Ingresos',
          data: incomeData,
          borderColor: COLORS.success,
          backgroundColor: COLORS.success + '22',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Egresos',
          data: expenseData,
          borderColor: COLORS.danger,
          backgroundColor: COLORS.danger + '22',
          fill: true,
          tension: 0.4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString('es-MX') } }
      }
    }
  });
}

/**
 * Actualiza todas las graficas
 */
export async function updateAllCharts(uid, startDate, endDate) {
  await Promise.all([
    renderIncomeExpenseChart(uid, startDate, endDate),
    renderExpenseByCategoryChart(uid, startDate, endDate),
    renderAccountBalancesChart(uid),
    renderGoalsProgressChart(uid),
    renderDebtsChart(uid),
    renderMonthlyTrendChart(uid)
  ]);
}
