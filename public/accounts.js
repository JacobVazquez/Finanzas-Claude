import { createDoc, readDocs, updateDocById, deleteDocById } from './firestore.js';
import { formatMXN, toCents, fromCents, showToast, validateAmount, dispatchDataChange, openEditModal, closeEditModal } from './utils.js';

export const ACCOUNT_TYPES = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'debito', label: 'Debito' },
  { value: 'bancaria', label: 'Bancaria' },
  { value: 'digital', label: 'Digital (OXXO Pay, Mercado Pago, etc.)' },
  { value: 'otro', label: 'Otro' }
];

/**
 * Crea una nueva cuenta financiera
 */
export async function createAccount(uid, { name, type, initialBalance }) {
  if (!name || !name.trim()) throw new Error('El nombre de la cuenta es requerido.');
  if (!ACCOUNT_TYPES.find(t => t.value === type)) throw new Error('Tipo de cuenta invalido.');
  const balanceCents = toCents(initialBalance || 0);
  return await createDoc(uid, 'accounts', {
    name: name.trim(),
    type,
    initialBalance: balanceCents
  });
}

/**
 * Obtiene todas las cuentas del usuario
 */
export async function getAccounts(uid) {
  return await readDocs(uid, 'accounts');
}

/**
 * Actualiza una cuenta
 */
export async function updateAccount(uid, id, data) {
  const update = { ...data };
  if (update.initialBalance !== undefined) {
    update.initialBalance = toCents(update.initialBalance);
  }
  await updateDocById(uid, 'accounts', id, update);
}

/**
 * Elimina una cuenta
 */
export async function deleteAccount(uid, id) {
  const transactions = await readDocs(uid, 'transactions');
  const hasMovements = transactions.some(t => t.accountId === id || t.fromAccountId === id || t.toAccountId === id);
  if (hasMovements) {
    throw new Error('No puedes eliminar una cuenta que tiene movimientos registrados.');
  }
  await deleteDocById(uid, 'accounts', id);
}

/**
 * Calcula el saldo real de una cuenta sumando todos los movimientos
 */
export async function calculateAccountBalance(uid, accountId) {
  const [account, transactions] = await Promise.all([
    readDocs(uid, 'accounts').then(list => list.find(a => a.id === accountId)),
    readDocs(uid, 'transactions')
  ]);
  if (!account) return 0;

  let balance = account.initialBalance || 0;

  for (const t of transactions) {
    if (t.accountId === accountId) {
      if (t.type === 'income') balance += t.amount;
      else if (t.type === 'expense') balance -= t.amount;
      else if (t.type === 'transfer_out') balance -= t.amount;
      else if (t.type === 'transfer_in') balance += t.amount;
      else if (t.type === 'debt_payment') balance -= t.amount;
      else if (t.type === 'goal_contribution') balance -= t.amount;
    }
    if (t.fromAccountId === accountId && t.type === 'transfer_out') {
      // already counted above via accountId
    }
    if (t.toAccountId === accountId && t.type === 'transfer_in') {
      // already counted above
    }
  }

  return balance;
}

/**
 * Renderiza las cards de saldo en el dashboard
 */
export async function renderAccountCards(uid) {
  const container = document.getElementById('dashboard-account-cards');
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Cargando cuentas...</p>';
  const accounts = await getAccounts(uid);

  if (accounts.length === 0) {
    container.innerHTML = '<p class="empty-state">No tienes cuentas registradas. <a href="#" data-nav="accounts">Crea una cuenta</a></p>';
    return;
  }

  const balances = await Promise.all(accounts.map(a => calculateAccountBalance(uid, a.id).then(b => ({ ...a, balance: b }))));
  const totalNet = balances.reduce((sum, a) => sum + a.balance, 0);

  container.innerHTML = `
    <div class="account-cards-grid">
      ${balances.map(a => `
        <div class="account-card account-type-${a.type}">
          <div class="account-card-header">
            <span class="account-icon">${accountIcon(a.type)}</span>
            <span class="account-type-label">${ACCOUNT_TYPES.find(t => t.value === a.type)?.label || a.type}</span>
          </div>
          <div class="account-name">${a.name}</div>
          <div class="account-balance ${a.balance < 0 ? 'negative' : ''}">${formatMXN(a.balance)}</div>
        </div>
      `).join('')}
      <div class="account-card account-total">
        <div class="account-card-header">
          <span class="account-icon">💼</span>
          <span class="account-type-label">Total</span>
        </div>
        <div class="account-name">Patrimonio neto</div>
        <div class="account-balance ${totalNet < 0 ? 'negative' : ''}">${formatMXN(totalNet)}</div>
      </div>
    </div>
  `;
}

/**
 * Renderiza la lista completa de cuentas en la seccion de cuentas
 */
export async function renderAccountsList(uid) {
  const container = document.getElementById('accounts-list');
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Cargando...</p>';
  const accounts = await getAccounts(uid);

  if (accounts.length === 0) {
    container.innerHTML = '<p class="empty-state">No tienes cuentas registradas todavia.</p>';
    return;
  }

  const balances = await Promise.all(accounts.map(a => calculateAccountBalance(uid, a.id).then(b => ({ ...a, balance: b }))));

  container.innerHTML = `
    <div class="accounts-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Tipo</th>
            <th>Saldo Inicial</th>
            <th>Saldo Actual</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${balances.map(a => `
            <tr>
              <td>${a.name}</td>
              <td>${ACCOUNT_TYPES.find(t => t.value === a.type)?.label || a.type}</td>
              <td>${formatMXN(a.initialBalance || 0)}</td>
              <td class="${a.balance < 0 ? 'text-danger' : 'text-success'}">${formatMXN(a.balance)}</td>
              <td>
                <button class="btn btn-sm btn-outline" onclick="window._editAccount('${a.id}', '${uid}')">Editar</button>
                <button class="btn btn-sm btn-danger" onclick="window._deleteAccount('${a.id}', '${uid}')">Eliminar</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Inicializa la seccion de cuentas con formularios y eventos
 */
export function setupAccountsSection(uid) {
  const form = document.getElementById('account-form');
  if (!form) return;

  // Populate type select
  const typeSelect = document.getElementById('account-type');
  if (typeSelect) {
    typeSelect.innerHTML = ACCOUNT_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('account-name').value;
    const type = document.getElementById('account-type').value;
    const initialBalance = document.getElementById('account-initial-balance').value;

    try {
      await createAccount(uid, { name, type, initialBalance });
      showToast('Cuenta creada correctamente', 'success');
      form.reset();
      dispatchDataChange();
      await renderAccountsList(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  window._deleteAccount = async (id, uid) => {
    if (!confirm('¿Eliminar esta cuenta? Esta accion no se puede deshacer.')) return;
    try {
      await deleteAccount(uid, id);
      showToast('Cuenta eliminada', 'success');
      dispatchDataChange();
      await renderAccountsList(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window._editAccount = async (id, uid) => {
    const accounts = await getAccounts(uid);
    const a = accounts.find(ac => ac.id === id);
    if (!a) return;

    const typeOpts = ACCOUNT_TYPES.map(t =>
      `<option value="${t.value}" ${t.value === a.type ? 'selected' : ''}>${t.label}</option>`
    ).join('');

    openEditModal('Editar cuenta', `
      <form id="edit-account-form" class="form-grid" style="padding:1.25rem 1.5rem 1.5rem">
        <div class="form-group form-full">
          <label>Nombre</label>
          <input type="text" id="ea-name" value="${a.name}" required />
        </div>
        <div class="form-group form-full">
          <label>Tipo</label>
          <select id="ea-type">${typeOpts}</select>
        </div>
        <div class="form-group form-full modal-actions">
          <button type="button" class="btn btn-outline" onclick="document.getElementById('modal-edit').style.display='none'">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);

    document.getElementById('edit-account-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await updateAccount(uid, id, {
          name: document.getElementById('ea-name').value.trim(),
          type: document.getElementById('ea-type').value
        });
        showToast('Cuenta actualizada', 'success');
        closeEditModal();
        dispatchDataChange();
        await renderAccountsList(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  };

  renderAccountsList(uid);
}

function accountIcon(type) {
  const icons = {
    efectivo: '💵',
    debito: '💳',
    bancaria: '🏦',
    digital: '📱',
    otro: '🪙'
  };
  return icons[type] || '💰';
}
