import { createDoc, readDocs, updateDocById, deleteDocById } from './firestore.js';
import { formatMXN, toCents, validateAmount, showToast, firstDayOfMonth, lastDayOfMonth } from './utils.js';
import { getExpenseCategories, populateCategorySelects } from './categories.js';
import { getTransactions } from './transactions.js';

/**
 * Crea un presupuesto mensual para una categoria de gasto
 */
export async function createBudget(uid, { categoryId, limitAmount }) {
  if (!categoryId) throw new Error('Selecciona una categoria.');
  if (!validateAmount(limitAmount)) throw new Error('El limite debe ser mayor a 0.');

  const existing = await readDocs(uid, 'budgets');
  if (existing.find(b => b.categoryId === categoryId)) {
    throw new Error('Ya existe un presupuesto para esta categoria.');
  }

  return await createDoc(uid, 'budgets', {
    categoryId,
    limitAmount: toCents(limitAmount)
  });
}

/**
 * Actualiza el limite de un presupuesto
 */
export async function updateBudget(uid, id, limitAmount) {
  if (!validateAmount(limitAmount)) throw new Error('El limite debe ser mayor a 0.');
  await updateDocById(uid, 'budgets', id, { limitAmount: toCents(limitAmount) });
}

/**
 * Elimina un presupuesto
 */
export async function deleteBudget(uid, id) {
  await deleteDocById(uid, 'budgets', id);
}

/**
 * Obtiene los presupuestos con el gasto acumulado del mes actual (o rango dado)
 */
export async function getBudgetsWithProgress(uid, startDate = firstDayOfMonth(), endDate = lastDayOfMonth()) {
  const [budgets, categories, expenses] = await Promise.all([
    readDocs(uid, 'budgets'),
    getExpenseCategories(uid),
    getTransactions(uid, { startDate, endDate, type: 'expense' })
  ]);

  const categoryMap = Object.fromEntries(categories.map(c => [c.id, c.name]));

  const spentByCategory = {};
  for (const tx of expenses) {
    if (!tx.categoryId) continue;
    spentByCategory[tx.categoryId] = (spentByCategory[tx.categoryId] || 0) + tx.amount;
  }

  return budgets
    .map(b => {
      const spent = spentByCategory[b.categoryId] || 0;
      const percent = b.limitAmount > 0 ? Math.round((spent / b.limitAmount) * 100) : 0;
      let status = 'ok';
      if (percent >= 100) status = 'over';
      else if (percent >= 80) status = 'warning';

      return {
        ...b,
        categoryName: categoryMap[b.categoryId] || 'Categoria eliminada',
        spent,
        remaining: b.limitAmount - spent,
        percent,
        status
      };
    })
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}

/**
 * Calcula el resumen global de presupuestos del mes actual (o rango dado)
 */
export async function calculateBudgetSummary(uid, startDate = firstDayOfMonth(), endDate = lastDayOfMonth()) {
  const budgets = await getBudgetsWithProgress(uid, startDate, endDate);

  const totalBudgeted = budgets.reduce((sum, b) => sum + b.limitAmount, 0);
  const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
  const totalRemaining = totalBudgeted - totalSpent;
  const percentUsed = totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted) * 100) : 0;

  return { totalBudgeted, totalSpent, totalRemaining, percentUsed };
}

/**
 * Renderiza las tarjetas KPI del resumen de presupuestos
 */
export async function renderBudgetSummary(uid) {
  const setEl = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };

  if (!document.getElementById('budget-kpi-total')) return;

  const { totalBudgeted, totalSpent, totalRemaining, percentUsed } = await calculateBudgetSummary(uid);

  setEl('budget-kpi-total', formatMXN(totalBudgeted));
  setEl('budget-kpi-spent', formatMXN(totalSpent));
  setEl('budget-kpi-available', formatMXN(totalRemaining));
  setEl('budget-kpi-percent', `${percentUsed}%`);

  const availableCard = document.getElementById('budget-kpi-available-card');
  if (availableCard) {
    availableCard.classList.toggle('kpi-positive', totalRemaining >= 0);
    availableCard.classList.toggle('kpi-negative', totalRemaining < 0);
  }
}

/**
 * Renderiza la lista de presupuestos con barras de progreso
 */
export async function renderBudgetsList(uid) {
  const container = document.getElementById('budgets-list');
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Cargando presupuestos...</p>';
  const budgets = await getBudgetsWithProgress(uid);

  if (budgets.length === 0) {
    container.innerHTML = '<p class="empty-state">No tienes presupuestos configurados.</p>';
    return;
  }

  const statusLabel = { ok: 'En orden', warning: 'Por agotarse', over: 'Excedido' };
  const statusBadge = { ok: 'badge-success', warning: 'badge-warning', over: 'badge-danger' };
  const statusFill = { ok: '', warning: 'progress-fill-warning', over: 'progress-fill-over' };

  container.innerHTML = `
    <div class="goals-grid">
      ${budgets.map(b => `
        <div class="goal-card budget-card budget-${b.status}">
          <div class="goal-card-header">
            <h3 class="goal-name">${b.categoryName}</h3>
            <span class="badge ${statusBadge[b.status]}">${statusLabel[b.status]}</span>
          </div>
          <div class="goal-amounts">
            <span class="goal-accumulated">${formatMXN(b.spent)}</span>
            <span class="goal-separator"> / </span>
            <span class="goal-target">${formatMXN(b.limitAmount)}</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar">
              <div class="progress-fill ${statusFill[b.status]}" style="width: ${Math.min(100, b.percent)}%"></div>
            </div>
            <span class="progress-label">${b.percent}%</span>
          </div>
          <p class="goal-date">${b.remaining >= 0 ? `Disponible: ${formatMXN(b.remaining)}` : `Excedido por: ${formatMXN(-b.remaining)}`}</p>
          <div class="goal-actions">
            <button class="btn btn-sm btn-danger" onclick="window._deleteBudget('${b.id}', '${uid}')">Eliminar</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Refresca la lista, el resumen KPI y la grafica de presupuestos
 */
async function refreshBudgetsView(uid) {
  const { renderBudgetVsSpentChart } = await import('./charts.js');
  await Promise.all([
    renderBudgetsList(uid),
    renderBudgetSummary(uid),
    renderBudgetVsSpentChart(uid)
  ]);
}

/**
 * Inicializa la seccion de presupuestos
 */
export async function setupBudgetsSection(uid) {
  await populateCategorySelects(uid);

  const form = document.getElementById('budget-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await createBudget(uid, {
          categoryId: document.getElementById('budget-category').value,
          limitAmount: document.getElementById('budget-limit-amount').value
        });
        showToast('Presupuesto creado', 'success');
        form.reset();
        await refreshBudgetsView(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  window._deleteBudget = async (id, uid) => {
    if (!confirm('¿Eliminar este presupuesto?')) return;
    try {
      await deleteBudget(uid, id);
      showToast('Presupuesto eliminado', 'success');
      await refreshBudgetsView(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  await refreshBudgetsView(uid);
}
