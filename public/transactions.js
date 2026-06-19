import { createDoc, readDocs, deleteDocById, updateDocById } from './firestore.js';
import { formatMXN, toCents, fromCents, formatDate, showToast, validateAmount, validateDate, todayISO, dispatchDataChange, openEditModal, closeEditModal } from './utils.js';
import { getAccounts } from './accounts.js';
import { getExpenseCategories, getIncomeTypes, populateCategorySelects } from './categories.js';
import { getDebts, registerDebtPayment } from './debts.js';
import { getGoals, addGoalContribution as updateGoalAccumulated } from './goals.js';

export const TRANSACTION_TYPES = {
  income: 'Ingreso',
  expense: 'Egreso',
  transfer_out: 'Transferencia salida',
  transfer_in: 'Transferencia entrada',
  debt_payment: 'Pago de deuda',
  goal_contribution: 'Aportacion a meta',
  investment_buy: 'Compra de inversión'
};

/**
 * Agrega un ingreso
 */
export async function addIncome(uid, { accountId, incomeTypeId, amount, date, description }) {
  if (!validateAmount(amount)) throw new Error('El monto debe ser mayor a 0.');
  if (!validateDate(date)) throw new Error('Fecha invalida.');
  if (!accountId) throw new Error('Selecciona una cuenta.');

  const cents = toCents(amount);
  await createDoc(uid, 'transactions', {
    type: 'income',
    accountId,
    incomeTypeId: incomeTypeId || null,
    amount: cents,
    date,
    description: description || ''
  });
}

/**
 * Agrega un egreso
 */
export async function addExpense(uid, { accountId, categoryId, amount, date, description }) {
  if (!validateAmount(amount)) throw new Error('El monto debe ser mayor a 0.');
  if (!validateDate(date)) throw new Error('Fecha invalida.');
  if (!accountId) throw new Error('Selecciona una cuenta.');

  const cents = toCents(amount);
  await createDoc(uid, 'transactions', {
    type: 'expense',
    accountId,
    categoryId: categoryId || null,
    amount: cents,
    date,
    description: description || ''
  });
}

/**
 * Agrega una transferencia entre cuentas
 */
export async function addTransfer(uid, { fromAccountId, toAccountId, amount, date, description }) {
  if (!validateAmount(amount)) throw new Error('El monto debe ser mayor a 0.');
  if (!validateDate(date)) throw new Error('Fecha invalida.');
  if (!fromAccountId || !toAccountId) throw new Error('Selecciona las cuentas de origen y destino.');
  if (fromAccountId === toAccountId) throw new Error('Las cuentas de origen y destino deben ser diferentes.');

  const cents = toCents(amount);
  const transferGroupId = `transfer-${Date.now()}`;

  await Promise.all([
    createDoc(uid, 'transactions', {
      type: 'transfer_out',
      accountId: fromAccountId,
      fromAccountId,
      toAccountId,
      amount: cents,
      date,
      description: description || '',
      transferGroupId
    }),
    createDoc(uid, 'transactions', {
      type: 'transfer_in',
      accountId: toAccountId,
      fromAccountId,
      toAccountId,
      amount: cents,
      date,
      description: description || '',
      transferGroupId
    })
  ]);
}

/**
 * Agrega un pago de deuda
 */
export async function addDebtPayment(uid, { accountId, debtId, amount, date, description }) {
  if (!validateAmount(amount)) throw new Error('El monto debe ser mayor a 0.');
  if (!validateDate(date)) throw new Error('Fecha invalida.');
  if (!accountId) throw new Error('Selecciona una cuenta.');
  if (!debtId) throw new Error('Selecciona una deuda.');

  const cents = toCents(amount);

  await registerDebtPayment(uid, debtId, cents);
  await createDoc(uid, 'transactions', {
    type: 'debt_payment',
    accountId,
    debtId,
    amount: cents,
    date,
    description: description || ''
  });
}

/**
 * Agrega una aportacion a una meta
 */
export async function addGoalContribution(uid, { accountId, goalId, amount, date, description }) {
  if (!validateAmount(amount)) throw new Error('El monto debe ser mayor a 0.');
  if (!validateDate(date)) throw new Error('Fecha invalida.');
  if (!accountId) throw new Error('Selecciona una cuenta.');
  if (!goalId) throw new Error('Selecciona una meta.');

  const cents = toCents(amount);

  await updateGoalAccumulated(uid, goalId, cents);
  await createDoc(uid, 'transactions', {
    type: 'goal_contribution',
    accountId,
    goalId,
    amount: cents,
    date,
    description: description || ''
  });
}

/**
 * Actualiza un movimiento de tipo ingreso o egreso
 */
export async function updateTransaction(uid, id, data) {
  const update = {};
  if (data.amount !== undefined) update.amount = toCents(data.amount);
  if (data.date !== undefined) update.date = data.date;
  if (data.description !== undefined) update.description = data.description;
  if (data.accountId !== undefined) update.accountId = data.accountId;
  if (data.categoryId !== undefined) update.categoryId = data.categoryId;
  if (data.incomeTypeId !== undefined) update.incomeTypeId = data.incomeTypeId;
  await updateDocById(uid, 'transactions', id, update);
}

/**
 * Obtiene movimientos con filtros opcionales
 */
export async function getTransactions(uid, filters = {}) {
  let transactions = await readDocs(uid, 'transactions');

  if (filters.startDate) {
    transactions = transactions.filter(t => t.date >= filters.startDate);
  }
  if (filters.endDate) {
    transactions = transactions.filter(t => t.date <= filters.endDate);
  }
  if (filters.type) {
    transactions = transactions.filter(t => t.type === filters.type);
  }
  if (filters.accountId) {
    transactions = transactions.filter(t => t.accountId === filters.accountId);
  }
  if (filters.categoryId) {
    transactions = transactions.filter(t => t.categoryId === filters.categoryId);
  }

  return transactions.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Elimina un movimiento y revierte su efecto
 */
export async function deleteTransaction(uid, id) {
  const transactions = await readDocs(uid, 'transactions');
  const t = transactions.find(tx => tx.id === id);
  if (!t) throw new Error('Movimiento no encontrado.');

  // If it's part of a transfer, delete both sides
  if (t.transferGroupId) {
    const paired = transactions.filter(tx => tx.transferGroupId === t.transferGroupId);
    await Promise.all(paired.map(tx => deleteDocById(uid, 'transactions', tx.id)));
    return;
  }

  // Revert debt payment
  if (t.type === 'debt_payment' && t.debtId) {
    const { updateDocById: ud } = await import('./firestore.js');
    const debts = await readDocs(uid, 'debts');
    const debt = debts.find(d => d.id === t.debtId);
    if (debt) {
      const newPending = (debt.pendingAmount || 0) + t.amount;
      await updateDocById(uid, 'debts', t.debtId, {
        pendingAmount: newPending,
        status: newPending > 0 ? 'active' : 'paid'
      });
    }
  }

  // Revert goal contribution
  if (t.type === 'goal_contribution' && t.goalId) {
    const goals = await readDocs(uid, 'goals');
    const goal = goals.find(g => g.id === t.goalId);
    if (goal) {
      const newAccumulated = Math.max(0, (goal.accumulated || 0) - t.amount);
      await updateDocById(uid, 'goals', t.goalId, { accumulated: newAccumulated });
    }
  }

  await deleteDocById(uid, 'transactions', id);
}

/**
 * Renderiza la tabla de movimientos
 */
export async function renderTransactionsList(uid, filters = {}) {
  const container = document.getElementById('transactions-list');
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Cargando movimientos...</p>';

  const [transactions, accounts, categories, incomeTypes] = await Promise.all([
    getTransactions(uid, filters),
    getAccounts(uid),
    getExpenseCategories(uid),
    getIncomeTypes(uid)
  ]);

  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
  const categoryMap = Object.fromEntries(categories.map(c => [c.id, c.name]));
  const incomeTypeMap = Object.fromEntries(incomeTypes.map(t => [t.id, t.name]));

  if (transactions.length === 0) {
    container.innerHTML = '<p class="empty-state">No hay movimientos en el periodo seleccionado.</p>';
    return;
  }

  container.innerHTML = `
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Cuenta</th>
            <th>Categoria / Tipo</th>
            <th>Descripcion</th>
            <th class="text-right">Monto</th>
            <th>Accion</th>
          </tr>
        </thead>
        <tbody>
          ${transactions.map(t => {
            const isPositive = ['income', 'transfer_in'].includes(t.type);
            const isNeutral = ['transfer_out', 'transfer_in'].includes(t.type);
            const catLabel = t.categoryId ? (categoryMap[t.categoryId] || '-') :
                             t.incomeTypeId ? (incomeTypeMap[t.incomeTypeId] || '-') : '-';
            return `
              <tr>
                <td>${formatDate(t.date)}</td>
                <td><span class="badge badge-${t.type}">${TRANSACTION_TYPES[t.type] || t.type}</span></td>
                <td>${accountMap[t.accountId] || '-'}</td>
                <td>${catLabel}</td>
                <td class="text-muted">${t.description || '-'}</td>
                <td class="text-right ${isPositive ? 'text-success' : 'text-danger'} font-mono">
                  ${isPositive ? '+' : '-'}${formatMXN(t.amount)}
                </td>
                <td>
                  <div style="display:flex;gap:.3rem;flex-wrap:wrap">
                    ${['income','expense'].includes(t.type)
                      ? `<button class="btn btn-sm btn-outline" onclick="window._editTx('${t.id}', '${uid}')">Editar</button>`
                      : ''}
                    ${!t.transferGroupId || t.type === 'transfer_out'
                      ? `<button class="btn btn-sm btn-danger" onclick="window._deleteTx('${t.id}', '${uid}')">Eliminar</button>`
                      : ''}
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Inicializa la seccion de movimientos
 */
export async function setupTransactionsSection(uid) {
  const today = todayISO();

  // Set default dates in filters
  const filterStart = document.getElementById('tx-filter-start');
  const filterEnd = document.getElementById('tx-filter-end');
  if (filterStart) filterStart.value = today.substring(0, 8) + '01';
  if (filterEnd) filterEnd.value = today;

  // Tab switching
  document.querySelectorAll('.tx-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tx-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tx-tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById(`tx-panel-${tab}`);
      if (panel) panel.classList.add('active');
    });
  });

  // Populate account selects
  const accounts = await getAccounts(uid);
  document.querySelectorAll('.select-account').forEach(sel => {
    sel.innerHTML = '<option value="">-- Seleccionar cuenta --</option>' +
      accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  });

  // Populate transfer account selects
  document.querySelectorAll('.select-from-account, .select-to-account').forEach(sel => {
    sel.innerHTML = '<option value="">-- Seleccionar cuenta --</option>' +
      accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  });

  // Populate debts/goals selects
  const [debts, goals] = await Promise.all([getDebts(uid), getGoals(uid)]);
  document.querySelectorAll('.select-debt').forEach(sel => {
    sel.innerHTML = '<option value="">-- Seleccionar deuda --</option>' +
      debts.filter(d => d.status !== 'paid').map(d => `<option value="${d.id}">${d.name} (${formatMXN(d.pendingAmount || 0)})</option>`).join('');
  });
  document.querySelectorAll('.select-goal').forEach(sel => {
    sel.innerHTML = '<option value="">-- Seleccionar meta --</option>' +
      goals.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
  });

  await populateCategorySelects(uid);

  // Set default dates
  document.querySelectorAll('.tx-date').forEach(d => { d.value = today; });

  // Income form
  const incomeForm = document.getElementById('income-form');
  if (incomeForm) {
    incomeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await addIncome(uid, {
          accountId: document.getElementById('income-account').value,
          incomeTypeId: document.getElementById('income-type').value,
          amount: document.getElementById('income-amount').value,
          date: document.getElementById('income-date').value,
          description: document.getElementById('income-description').value
        });
        showToast('Ingreso registrado', 'success');
        incomeForm.reset();
        document.getElementById('income-date').value = todayISO();
        dispatchDataChange();
        await renderTransactionsList(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Expense form
  const expenseForm = document.getElementById('expense-form');
  if (expenseForm) {
    expenseForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await addExpense(uid, {
          accountId: document.getElementById('expense-account').value,
          categoryId: document.getElementById('expense-category').value,
          amount: document.getElementById('expense-amount').value,
          date: document.getElementById('expense-date').value,
          description: document.getElementById('expense-description').value
        });
        showToast('Egreso registrado', 'success');
        expenseForm.reset();
        document.getElementById('expense-date').value = todayISO();
        dispatchDataChange();
        await renderTransactionsList(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Transfer form
  const transferForm = document.getElementById('transfer-form');
  if (transferForm) {
    transferForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await addTransfer(uid, {
          fromAccountId: document.getElementById('transfer-from').value,
          toAccountId: document.getElementById('transfer-to').value,
          amount: document.getElementById('transfer-amount').value,
          date: document.getElementById('transfer-date').value,
          description: document.getElementById('transfer-description').value
        });
        showToast('Transferencia registrada', 'success');
        transferForm.reset();
        document.getElementById('transfer-date').value = todayISO();
        dispatchDataChange();
        await renderTransactionsList(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Debt payment form
  const debtForm = document.getElementById('debt-payment-form');
  if (debtForm) {
    debtForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await addDebtPayment(uid, {
          accountId: document.getElementById('debt-payment-account').value,
          debtId: document.getElementById('debt-payment-debt').value,
          amount: document.getElementById('debt-payment-amount').value,
          date: document.getElementById('debt-payment-date').value,
          description: document.getElementById('debt-payment-description').value
        });
        showToast('Pago de deuda registrado', 'success');
        debtForm.reset();
        document.getElementById('debt-payment-date').value = todayISO();
        dispatchDataChange();
        await renderTransactionsList(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Goal contribution form
  const goalForm = document.getElementById('goal-contribution-form');
  if (goalForm) {
    goalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await addGoalContribution(uid, {
          accountId: document.getElementById('goal-contribution-account').value,
          goalId: document.getElementById('goal-contribution-goal').value,
          amount: document.getElementById('goal-contribution-amount').value,
          date: document.getElementById('goal-contribution-date').value,
          description: document.getElementById('goal-contribution-description').value
        });
        showToast('Aportacion a meta registrada', 'success');
        goalForm.reset();
        document.getElementById('goal-contribution-date').value = todayISO();
        dispatchDataChange();
        await renderTransactionsList(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Filter apply
  const filterBtn = document.getElementById('apply-tx-filters');
  if (filterBtn) {
    filterBtn.addEventListener('click', async () => {
      const start = document.getElementById('tx-filter-start')?.value;
      const end = document.getElementById('tx-filter-end')?.value;
      const type = document.getElementById('tx-filter-type')?.value;
      await renderTransactionsList(uid, { startDate: start, endDate: end, type: type || undefined });
    });
  }

  // Global delete handler
  window._deleteTx = async (id, uid) => {
    if (!confirm('¿Eliminar este movimiento? Esta accion no se puede deshacer.')) return;
    try {
      await deleteTransaction(uid, id);
      showToast('Movimiento eliminado', 'success');
      dispatchDataChange();
      await renderTransactionsList(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Global edit handler
  window._editTx = async (id, uid) => {
    const [transactions, accounts, categories, incomeTypes] = await Promise.all([
      getTransactions(uid, {}),
      getAccounts(uid),
      getExpenseCategories(uid),
      getIncomeTypes(uid)
    ]);
    const t = transactions.find(tx => tx.id === id);
    if (!t) return;

    if (!['income', 'expense'].includes(t.type)) {
      openEditModal('No editable', `
        <div style="padding:1.25rem 1.5rem 1.5rem">
          <p>Los movimientos de tipo <strong>${TRANSACTION_TYPES[t.type]}</strong> no se pueden editar directamente porque afectan otros registros.</p>
          <p style="margin-top:.5rem;color:var(--text-muted)">Elimínalo y vuelve a registrarlo con los datos correctos.</p>
          <div class="modal-actions" style="margin-top:1.25rem">
            <button class="btn btn-outline" onclick="document.getElementById('modal-edit').style.display='none'">Cerrar</button>
          </div>
        </div>
      `);
      return;
    }

    const acctOptions = accounts.map(a => `<option value="${a.id}" ${a.id === t.accountId ? 'selected' : ''}>${a.name}</option>`).join('');
    const isIncome = t.type === 'income';
    const extraOptions = isIncome
      ? incomeTypes.map(it => `<option value="${it.id}" ${it.id === t.incomeTypeId ? 'selected' : ''}>${it.name}</option>`).join('')
      : categories.map(c => `<option value="${c.id}" ${c.id === t.categoryId ? 'selected' : ''}>${c.name}</option>`).join('');

    openEditModal(`Editar ${TRANSACTION_TYPES[t.type]}`, `
      <form id="edit-tx-form" class="form-grid" style="padding:1.25rem 1.5rem 1.5rem">
        <div class="form-group">
          <label>Cuenta</label>
          <select id="etx-account" required>${acctOptions}</select>
        </div>
        <div class="form-group">
          <label>${isIncome ? 'Tipo de ingreso' : 'Categoría'}</label>
          <select id="etx-extra">
            <option value="">-- Sin ${isIncome ? 'tipo' : 'categoría'} --</option>
            ${extraOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Monto (MXN)</label>
          <input type="number" id="etx-amount" value="${fromCents(t.amount)}" min="0.01" step="0.01" required />
        </div>
        <div class="form-group">
          <label>Fecha</label>
          <input type="date" id="etx-date" value="${t.date}" required />
        </div>
        <div class="form-group form-full">
          <label>Descripción</label>
          <input type="text" id="etx-description" value="${t.description || ''}" />
        </div>
        <div class="form-group form-full modal-actions">
          <button type="button" class="btn btn-outline" onclick="document.getElementById('modal-edit').style.display='none'">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar cambios</button>
        </div>
      </form>
    `);

    document.getElementById('edit-tx-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const extraVal = document.getElementById('etx-extra').value;
        await updateTransaction(uid, id, {
          accountId: document.getElementById('etx-account').value,
          amount: document.getElementById('etx-amount').value,
          date: document.getElementById('etx-date').value,
          description: document.getElementById('etx-description').value,
          ...(isIncome ? { incomeTypeId: extraVal || null } : { categoryId: extraVal || null })
        });
        showToast('Movimiento actualizado', 'success');
        closeEditModal();
        dispatchDataChange();
        await renderTransactionsList(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  };

  await renderTransactionsList(uid);
}
