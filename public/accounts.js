import { createDoc, readDocs, updateDocById, deleteDocById } from './firestore.js';
import { formatMXN, toCents, fromCents, showToast, validateAmount, dispatchDataChange, openEditModal, closeEditModal } from './utils.js';

export const ACCOUNT_TYPES = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'debito', label: 'Débito' },
  { value: 'bancaria', label: 'Bancaria' },
  { value: 'digital', label: 'Digital (OXXO Pay, Mercado Pago, etc.)' },
  { value: 'inversion', label: 'Inversión (broker)' },
  { value: 'otro', label: 'Otro' }
];

/**
 * Calcula los centavos acumulados por rendimiento compuesto diario
 * rate: porcentaje anual (ej. 8.5 para 8.5%)
 * balanceCents: saldo base en centavos
 * createdAt: Firestore Timestamp o Date
 */
export function calcYieldCents(balanceCents, rate, createdAt) {
  if (!rate || rate <= 0 || !balanceCents) return 0;
  const start = createdAt?.toDate ? createdAt.toDate() : (createdAt instanceof Date ? createdAt : new Date());
  const days = Math.max(0, (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
  const factor = Math.pow(1 + rate / 100, days / 365) - 1;
  return Math.round(balanceCents * factor);
}

/**
 * Retorna el total de rendimientos acumulados en todas las cuentas de inversión
 */
export async function getTotalYieldCents(uid) {
  const [accounts, transactions] = await Promise.all([
    readDocs(uid, 'accounts'),
    readDocs(uid, 'transactions')
  ]);
  let total = 0;
  for (const a of accounts) {
    if (a.type !== 'inversion' || !a.annualYield) continue;
    let base = a.initialBalance || 0;
    for (const t of transactions) {
      if (t.accountId !== a.id) continue;
      if (t.type === 'income') base += t.amount;
      else if (['expense','transfer_out','debt_payment','goal_contribution','investment_buy'].includes(t.type)) base -= t.amount;
      else if (t.type === 'transfer_in') base += t.amount;
    }
    total += calcYieldCents(base, a.annualYield, a.createdAt);
  }
  return total;
}

/**
 * Retorna cuentas de inversión con sus datos de rendimiento para gráficas
 */
export async function getInvestmentAccountsYield(uid) {
  const [accounts, transactions] = await Promise.all([
    readDocs(uid, 'accounts'),
    readDocs(uid, 'transactions')
  ]);
  return accounts
    .filter(a => a.type === 'inversion' && a.annualYield > 0)
    .map(a => {
      let base = a.initialBalance || 0;
      for (const t of transactions) {
        if (t.accountId !== a.id) continue;
        if (t.type === 'income') base += t.amount;
        else if (['expense','transfer_out','debt_payment','goal_contribution','investment_buy'].includes(t.type)) base -= t.amount;
        else if (t.type === 'transfer_in') base += t.amount;
      }
      return { ...a, baseBalance: base };
    });
}

/**
 * Crea una nueva cuenta financiera
 */
export async function createAccount(uid, { name, type, initialBalance, annualYield }) {
  if (!name || !name.trim()) throw new Error('El nombre de la cuenta es requerido.');
  if (!ACCOUNT_TYPES.find(t => t.value === type)) throw new Error('Tipo de cuenta invalido.');
  const balanceCents = toCents(initialBalance || 0);
  const yieldRate = type === 'inversion' && annualYield ? parseFloat(annualYield) : 0;
  return await createDoc(uid, 'accounts', {
    name: name.trim(),
    type,
    initialBalance: balanceCents,
    annualYield: yieldRate
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
  if (update.annualYield !== undefined) {
    update.annualYield = parseFloat(update.annualYield) || 0;
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
 * Calcula el saldo real de una cuenta sumando todos los movimientos.
 * Para cuentas de inversión con rendimiento anual, aplica interés compuesto diario.
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
      else if (t.type === 'investment_buy') balance -= t.amount;
    }
  }

  // Aplica rendimiento compuesto si es cuenta de inversión
  if (account.type === 'inversion' && account.annualYield > 0) {
    balance += calcYieldCents(balance, account.annualYield, account.createdAt);
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
      ${balances.map(a => {
        const yieldCents = a.type === 'inversion' && a.annualYield > 0
          ? calcYieldCents(a.balance - calcYieldCents(a.balance, a.annualYield, a.createdAt), a.annualYield, a.createdAt)
          : 0;
        const dailyYieldCents = a.type === 'inversion' && a.annualYield > 0
          ? Math.round((a.balance * (a.annualYield / 100)) / 365)
          : 0;
        return `
        <div class="account-card account-type-${a.type}">
          <div class="account-card-header">
            <span class="account-icon">${accountIconSvg(a.type)}</span>
            <span class="account-type-label">${ACCOUNT_TYPES.find(t => t.value === a.type)?.label || a.type}</span>
          </div>
          <div class="account-name">${a.name}</div>
          <div class="account-balance ${a.balance < 0 ? 'negative' : ''}">${formatMXN(a.balance)}</div>
          ${a.type === 'inversion' && a.annualYield > 0 ? `
            <div class="account-yield-info">
              <span class="yield-rate">${a.annualYield}% anual</span>
              <span class="yield-daily">+${formatMXN(dailyYieldCents)}/día</span>
            </div>
          ` : ''}
        </div>
      `}).join('')}
      <div class="account-card account-total">
        <div class="account-card-header">
          <span class="account-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
          </span>
          <span class="account-type-label">Total</span>
        </div>
        <div class="account-name">Saldo total</div>
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
            <th>Rendimiento</th>
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
              <td>${a.type === 'inversion' && a.annualYield > 0 ? `<span class="badge badge-success">${a.annualYield}% anual</span>` : '—'}</td>
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

  const typeSelect = document.getElementById('account-type');
  const yieldGroup = document.getElementById('account-yield-group');

  if (typeSelect) {
    typeSelect.innerHTML = ACCOUNT_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
    typeSelect.addEventListener('change', () => {
      if (yieldGroup) yieldGroup.style.display = typeSelect.value === 'inversion' ? '' : 'none';
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'Guardando...';
    const name = document.getElementById('account-name').value;
    const type = document.getElementById('account-type').value;
    const initialBalance = document.getElementById('account-initial-balance').value;
    const annualYield = document.getElementById('account-annual-yield')?.value || 0;

    try {
      await createAccount(uid, { name, type, initialBalance, annualYield });
      showToast('Cuenta creada correctamente', 'success');
      form.reset();
      if (yieldGroup) yieldGroup.style.display = 'none';
      dispatchDataChange();
      await renderAccountsList(uid);
    } catch (err) {
      showToast(err.message || 'Error al crear cuenta', 'error');
    } finally {
      btn.disabled = false; btn.textContent = orig;
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
          <select id="ea-type" onchange="document.getElementById('ea-yield-group').style.display=this.value==='inversion'?'':'none'">${typeOpts}</select>
        </div>
        <div class="form-group form-full" id="ea-yield-group" style="${a.type === 'inversion' ? '' : 'display:none'}">
          <label>Rendimiento anual (%)</label>
          <input type="number" id="ea-yield" value="${a.annualYield || ''}" min="0" max="100" step="0.01" placeholder="ej. 8.5" />
          <small style="color:var(--text-muted);font-size:0.78rem">El saldo acumulará este rendimiento compuesto diariamente.</small>
        </div>
        <div class="form-group form-full modal-actions">
          <button type="button" class="btn btn-outline" onclick="document.getElementById('modal-edit').style.display='none'">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);

    document.getElementById('edit-account-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = 'Guardando...';
      try {
        await updateAccount(uid, id, {
          name: document.getElementById('ea-name').value.trim(),
          type: document.getElementById('ea-type').value,
          annualYield: document.getElementById('ea-yield')?.value || 0
        });
        showToast('Cuenta actualizada', 'success');
        closeEditModal();
        dispatchDataChange();
        await renderAccountsList(uid);
      } catch (err) {
        showToast(err.message || 'Error al actualizar cuenta', 'error');
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    });
  };

  renderAccountsList(uid);
}

function accountIconSvg(type) {
  const icons = {
    efectivo: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>`,
    debito: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
    bancaria: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    digital: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
    inversion: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
    otro: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
  };
  return icons[type] || icons.otro;
}
