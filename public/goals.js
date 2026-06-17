import { createDoc, readDocs, updateDocById, deleteDocById } from './firestore.js';
import { formatMXN, toCents, fromCents, formatDate, showToast, validateAmount, validateDate, todayISO } from './utils.js';

/**
 * Crea una nueva meta de ahorro
 */
export async function createGoal(uid, { name, targetAmount, targetDate, description }) {
  if (!name || !name.trim()) throw new Error('El nombre de la meta es requerido.');
  if (!validateAmount(targetAmount)) throw new Error('El monto objetivo debe ser mayor a 0.');

  const cents = toCents(targetAmount);
  return await createDoc(uid, 'goals', {
    name: name.trim(),
    targetAmount: cents,
    accumulated: 0,
    targetDate: targetDate || null,
    description: description || '',
    status: 'active'
  });
}

/**
 * Obtiene todas las metas del usuario
 */
export async function getGoals(uid) {
  const goals = await readDocs(uid, 'goals');
  return goals.map(g => ({
    ...g,
    progress: g.targetAmount > 0 ? Math.min(100, Math.round((g.accumulated / g.targetAmount) * 100)) : 0
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Actualiza una meta
 */
export async function updateGoal(uid, id, data) {
  const update = { ...data };
  if (update.targetAmount !== undefined) {
    update.targetAmount = toCents(update.targetAmount);
  }
  await updateDocById(uid, 'goals', id, update);
}

/**
 * Elimina una meta
 */
export async function deleteGoal(uid, id) {
  await deleteDocById(uid, 'goals', id);
}

/**
 * Suma al acumulado de una meta (en centavos)
 */
export async function addGoalContribution(uid, goalId, amountCents) {
  const goals = await readDocs(uid, 'goals');
  const goal = goals.find(g => g.id === goalId);
  if (!goal) throw new Error('Meta no encontrada.');

  const newAccumulated = (goal.accumulated || 0) + amountCents;
  const status = newAccumulated >= goal.targetAmount ? 'completed' : 'active';

  await updateDocById(uid, 'goals', goalId, {
    accumulated: newAccumulated,
    status
  });
}

/**
 * Renderiza la lista de metas con barras de progreso
 */
export async function renderGoalsList(uid) {
  const container = document.getElementById('goals-list');
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Cargando metas...</p>';
  const goals = await getGoals(uid);

  if (goals.length === 0) {
    container.innerHTML = '<p class="empty-state">No tienes metas de ahorro registradas.</p>';
    return;
  }

  container.innerHTML = `
    <div class="goals-grid">
      ${goals.map(g => `
        <div class="goal-card ${g.status === 'completed' ? 'goal-completed' : ''}">
          <div class="goal-card-header">
            <h3 class="goal-name">${g.name}</h3>
            ${g.status === 'completed' ? '<span class="badge badge-success">Completada</span>' : ''}
          </div>
          ${g.description ? `<p class="goal-description">${g.description}</p>` : ''}
          <div class="goal-amounts">
            <span class="goal-accumulated">${formatMXN(g.accumulated)}</span>
            <span class="goal-separator"> / </span>
            <span class="goal-target">${formatMXN(g.targetAmount)}</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${g.progress}%"></div>
            </div>
            <span class="progress-label">${g.progress}%</span>
          </div>
          ${g.targetDate ? `<p class="goal-date">Meta para: ${formatDate(g.targetDate)}</p>` : ''}
          <div class="goal-actions">
            <button class="btn btn-sm btn-danger" onclick="window._deleteGoal('${g.id}', '${uid}')">Eliminar</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Inicializa la seccion de metas
 */
export function setupGoalsSection(uid) {
  const form = document.getElementById('goal-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await createGoal(uid, {
        name: document.getElementById('goal-name').value,
        targetAmount: document.getElementById('goal-target-amount').value,
        targetDate: document.getElementById('goal-target-date').value,
        description: document.getElementById('goal-description').value
      });
      showToast('Meta creada correctamente', 'success');
      form.reset();
      await renderGoalsList(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  window._deleteGoal = async (id, uid) => {
    if (!confirm('¿Eliminar esta meta? Esta accion no se puede deshacer.')) return;
    try {
      await deleteGoal(uid, id);
      showToast('Meta eliminada', 'success');
      await renderGoalsList(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  renderGoalsList(uid);
}
