import { createDoc, readDocs, updateDocById, deleteDocById, getDocById } from './firestore.js';
import { formatMXN, toCents, fromCents, formatDate, showToast, validateAmount, validateDate, todayISO, dispatchDataChange, openEditModal, closeEditModal } from './utils.js';

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
  const goal = await getDocById(uid, 'goals', goalId);
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
            <button class="btn btn-sm btn-outline" onclick="window._editGoal('${g.id}', '${uid}')">Editar</button>
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
    const btn = form.querySelector('button[type="submit"]');
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      await createGoal(uid, {
        name: document.getElementById('goal-name').value,
        targetAmount: document.getElementById('goal-target-amount').value,
        targetDate: document.getElementById('goal-target-date').value,
        description: document.getElementById('goal-description').value
      });
      showToast('Meta creada correctamente', 'success');
      form.reset();
      dispatchDataChange();
      await renderGoalsList(uid);
    } catch (err) {
      showToast(err.message || 'Error al crear meta', 'error');
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  });

  window._deleteGoal = async (id, uid) => {
    if (!confirm('¿Eliminar esta meta? Esta accion no se puede deshacer.')) return;
    try {
      await deleteGoal(uid, id);
      showToast('Meta eliminada', 'success');
      dispatchDataChange();
      await renderGoalsList(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window._editGoal = async (id, uid) => {
    const goals = await readDocs(uid, 'goals');
    const g = goals.find(x => x.id === id);
    if (!g) return;

    openEditModal('Editar meta', `
      <form id="edit-goal-form" class="form-grid" style="padding:1.25rem 1.5rem 1.5rem">
        <div class="form-group form-full">
          <label>Nombre</label>
          <input type="text" id="eg-name" value="${g.name}" required />
        </div>
        <div class="form-group">
          <label>Monto objetivo (MXN)</label>
          <input type="number" id="eg-target" value="${fromCents(g.targetAmount)}" min="0.01" step="0.01" required />
        </div>
        <div class="form-group">
          <label>Fecha objetivo</label>
          <input type="date" id="eg-date" value="${g.targetDate || ''}" />
        </div>
        <div class="form-group form-full">
          <label>Descripción</label>
          <textarea id="eg-description" rows="2">${g.description || ''}</textarea>
        </div>
        <div class="form-group form-full modal-actions">
          <button type="button" class="btn btn-outline" onclick="document.getElementById('modal-edit').style.display='none'">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);

    document.getElementById('edit-goal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = 'Guardando...';
      try {
        await updateGoal(uid, id, {
          name: document.getElementById('eg-name').value.trim(),
          targetAmount: document.getElementById('eg-target').value,
          targetDate: document.getElementById('eg-date').value || null,
          description: document.getElementById('eg-description').value
        });
        showToast('Meta actualizada', 'success');
        closeEditModal();
        dispatchDataChange();
        await renderGoalsList(uid);
      } catch (err) {
        showToast(err.message || 'Error al actualizar meta', 'error');
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    });
  };

  renderGoalsList(uid);
}
