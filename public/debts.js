import { createDoc, readDocs, updateDocById, deleteDocById, getDocById } from './firestore.js';
import { formatMXN, toCents, fromCents, formatDate, showToast, validateAmount, validateDate, dispatchDataChange, openEditModal, closeEditModal } from './utils.js';

/**
 * Crea una nueva deuda
 */
export async function createDebt(uid, { name, initialAmount, creditor, dueDate, description }) {
  if (!name || !name.trim()) throw new Error('El nombre de la deuda es requerido.');
  if (!validateAmount(initialAmount)) throw new Error('El monto inicial debe ser mayor a 0.');

  const cents = toCents(initialAmount);
  return await createDoc(uid, 'debts', {
    name: name.trim(),
    initialAmount: cents,
    pendingAmount: cents,
    creditor: creditor || '',
    dueDate: dueDate || null,
    description: description || '',
    status: 'active'
  });
}

/**
 * Obtiene todas las deudas del usuario
 */
export async function getDebts(uid) {
  const debts = await readDocs(uid, 'debts');
  return debts.map(d => ({
    ...d,
    paidAmount: (d.initialAmount || 0) - (d.pendingAmount || 0),
    progress: d.initialAmount > 0 ? Math.min(100, Math.round(((d.initialAmount - d.pendingAmount) / d.initialAmount) * 100)) : 0
  })).sort((a, b) => {
    // Active first, then paid
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Actualiza una deuda
 */
export async function updateDebt(uid, id, data) {
  const update = { ...data };
  if (update.initialAmount !== undefined) {
    update.initialAmount = toCents(update.initialAmount);
  }
  await updateDocById(uid, 'debts', id, update);
}

/**
 * Elimina una deuda
 */
export async function deleteDebt(uid, id) {
  await deleteDocById(uid, 'debts', id);
}

/**
 * Registra un pago parcial o total de una deuda (en centavos)
 */
export async function registerDebtPayment(uid, debtId, amountCents) {
  const debt = await getDocById(uid, 'debts', debtId);
  if (!debt) throw new Error('Deuda no encontrada.');

  const newPending = Math.max(0, (debt.pendingAmount || 0) - amountCents);
  const status = newPending <= 0 ? 'paid' : 'active';

  await updateDocById(uid, 'debts', debtId, {
    pendingAmount: newPending,
    status
  });
}

/**
 * Renderiza la lista de deudas con progreso de pago
 */
export async function renderDebtsList(uid) {
  const container = document.getElementById('debts-list');
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Cargando deudas...</p>';
  const debts = await getDebts(uid);

  if (debts.length === 0) {
    container.innerHTML = '<p class="empty-state">No tienes deudas registradas.</p>';
    return;
  }

  container.innerHTML = `
    <div class="debts-grid">
      ${debts.map(d => `
        <div class="debt-card ${d.status === 'paid' ? 'debt-paid' : ''}">
          <div class="debt-card-header">
            <h3 class="debt-name">${d.name}</h3>
            <span class="badge badge-${d.status === 'paid' ? 'success' : 'warning'}">${d.status === 'paid' ? 'Pagada' : 'Activa'}</span>
          </div>
          ${d.creditor ? `<p class="debt-creditor">Acreedor: <strong>${d.creditor}</strong></p>` : ''}
          ${d.description ? `<p class="debt-description">${d.description}</p>` : ''}
          <div class="debt-amounts">
            <div class="debt-amount-row">
              <span class="label">Total original:</span>
              <span class="value">${formatMXN(d.initialAmount)}</span>
            </div>
            <div class="debt-amount-row">
              <span class="label">Pagado:</span>
              <span class="value text-success">${formatMXN(d.paidAmount)}</span>
            </div>
            <div class="debt-amount-row">
              <span class="label">Pendiente:</span>
              <span class="value ${d.pendingAmount > 0 ? 'text-danger' : 'text-success'}">${formatMXN(d.pendingAmount)}</span>
            </div>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar">
              <div class="progress-fill progress-fill-debt" style="width: ${d.progress}%"></div>
            </div>
            <span class="progress-label">${d.progress}% pagado</span>
          </div>
          ${d.dueDate ? `<p class="debt-due-date">Vencimiento: ${formatDate(d.dueDate)}</p>` : ''}
          <div class="debt-actions">
            <button class="btn btn-sm btn-outline" onclick="window._editDebt('${d.id}', '${uid}')">Editar</button>
            <button class="btn btn-sm btn-danger" onclick="window._deleteDebt('${d.id}', '${uid}')">Eliminar</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Inicializa la seccion de deudas
 */
export function setupDebtsSection(uid) {
  const form = document.getElementById('debt-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await createDebt(uid, {
        name: document.getElementById('debt-name').value,
        initialAmount: document.getElementById('debt-initial-amount').value,
        creditor: document.getElementById('debt-creditor').value,
        dueDate: document.getElementById('debt-due-date').value,
        description: document.getElementById('debt-description').value
      });
      showToast('Deuda registrada correctamente', 'success');
      form.reset();
      dispatchDataChange();
      await renderDebtsList(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  window._deleteDebt = async (id, uid) => {
    if (!confirm('¿Eliminar esta deuda? Esta accion no se puede deshacer.')) return;
    try {
      await deleteDebt(uid, id);
      showToast('Deuda eliminada', 'success');
      dispatchDataChange();
      await renderDebtsList(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window._editDebt = async (id, uid) => {
    const debts = await readDocs(uid, 'debts');
    const d = debts.find(x => x.id === id);
    if (!d) return;

    openEditModal('Editar deuda', `
      <form id="edit-debt-form" class="form-grid" style="padding:1.25rem 1.5rem 1.5rem">
        <div class="form-group form-full">
          <label>Nombre</label>
          <input type="text" id="ed-name" value="${d.name}" required />
        </div>
        <div class="form-group">
          <label>Acreedor</label>
          <input type="text" id="ed-creditor" value="${d.creditor || ''}" />
        </div>
        <div class="form-group">
          <label>Fecha de vencimiento</label>
          <input type="date" id="ed-due" value="${d.dueDate || ''}" />
        </div>
        <div class="form-group form-full">
          <label>Descripción / notas</label>
          <textarea id="ed-description" rows="2">${d.description || ''}</textarea>
        </div>
        <div class="form-group form-full modal-actions">
          <button type="button" class="btn btn-outline" onclick="document.getElementById('modal-edit').style.display='none'">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);

    document.getElementById('edit-debt-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await updateDebt(uid, id, {
          name: document.getElementById('ed-name').value.trim(),
          creditor: document.getElementById('ed-creditor').value,
          dueDate: document.getElementById('ed-due').value || null,
          description: document.getElementById('ed-description').value
        });
        showToast('Deuda actualizada', 'success');
        closeEditModal();
        dispatchDataChange();
        await renderDebtsList(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  };

  renderDebtsList(uid);
}
