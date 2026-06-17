import { createDoc, readDocs, deleteDocById } from './firestore.js';
import { showToast } from './utils.js';

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Comida', 'Transporte', 'Vivienda', 'Servicios',
  'Salud', 'Educacion', 'Entretenimiento', 'Deudas', 'Otros'
];

export const DEFAULT_INCOME_TYPES = [
  'Sueldo', 'Bonos', 'Venta', 'Inversion', 'Otro'
];

/**
 * Crea categorias y tipos de ingreso por defecto para un usuario nuevo
 */
export async function initDefaultCategories(uid) {
  const [cats, incomes] = await Promise.all([
    readDocs(uid, 'expenseCategories'),
    readDocs(uid, 'incomeTypes')
  ]);

  const promises = [];

  if (cats.length === 0) {
    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
      promises.push(createDoc(uid, 'expenseCategories', { name, isDefault: true }));
    }
  }

  if (incomes.length === 0) {
    for (const name of DEFAULT_INCOME_TYPES) {
      promises.push(createDoc(uid, 'incomeTypes', { name, isDefault: true }));
    }
  }

  await Promise.all(promises);
}

/**
 * Obtiene todas las categorias de gasto
 */
export async function getExpenseCategories(uid) {
  const cats = await readDocs(uid, 'expenseCategories');
  return cats.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Obtiene todos los tipos de ingreso
 */
export async function getIncomeTypes(uid) {
  const types = await readDocs(uid, 'incomeTypes');
  return types.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Crea una nueva categoria de gasto
 */
export async function createExpenseCategory(uid, name) {
  if (!name || !name.trim()) throw new Error('El nombre es requerido.');
  const existing = await getExpenseCategories(uid);
  if (existing.find(c => c.name.toLowerCase() === name.trim().toLowerCase())) {
    throw new Error('Ya existe una categoria con ese nombre.');
  }
  return await createDoc(uid, 'expenseCategories', { name: name.trim(), isDefault: false });
}

/**
 * Crea un nuevo tipo de ingreso
 */
export async function createIncomeType(uid, name) {
  if (!name || !name.trim()) throw new Error('El nombre es requerido.');
  const existing = await getIncomeTypes(uid);
  if (existing.find(t => t.name.toLowerCase() === name.trim().toLowerCase())) {
    throw new Error('Ya existe un tipo de ingreso con ese nombre.');
  }
  return await createDoc(uid, 'incomeTypes', { name: name.trim(), isDefault: false });
}

/**
 * Elimina una categoria de gasto
 */
export async function deleteExpenseCategory(uid, id) {
  await deleteDocById(uid, 'expenseCategories', id);
}

/**
 * Elimina un tipo de ingreso
 */
export async function deleteIncomeType(uid, id) {
  await deleteDocById(uid, 'incomeTypes', id);
}

/**
 * Llena todos los selects de categorias y tipos de ingreso en el DOM
 */
export async function populateCategorySelects(uid) {
  const [categories, incomeTypes] = await Promise.all([
    getExpenseCategories(uid),
    getIncomeTypes(uid)
  ]);

  // Expense category selects
  document.querySelectorAll('.select-expense-category').forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">-- Seleccionar categoria --</option>' +
      categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    if (current) sel.value = current;
  });

  // Income type selects
  document.querySelectorAll('.select-income-type').forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">-- Seleccionar tipo --</option>' +
      incomeTypes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    if (current) sel.value = current;
  });

  return { categories, incomeTypes };
}

/**
 * Renderiza las listas de categorias en la seccion de categorias
 */
async function renderCategoriesLists(uid) {
  const [categories, incomeTypes] = await Promise.all([
    getExpenseCategories(uid),
    getIncomeTypes(uid)
  ]);

  const expList = document.getElementById('expense-categories-list');
  if (expList) {
    expList.innerHTML = categories.length === 0
      ? '<p class="empty-state">No hay categorias.</p>'
      : `<ul class="categories-list">
          ${categories.map(c => `
            <li class="category-item">
              <span class="category-name">${c.name}</span>
              ${!c.isDefault ? `<button class="btn btn-sm btn-danger" onclick="window._deleteCat('${c.id}', '${uid}')">Eliminar</button>` : '<span class="badge-default">Predefinida</span>'}
            </li>
          `).join('')}
        </ul>`;
  }

  const incList = document.getElementById('income-types-list');
  if (incList) {
    incList.innerHTML = incomeTypes.length === 0
      ? '<p class="empty-state">No hay tipos de ingreso.</p>'
      : `<ul class="categories-list">
          ${incomeTypes.map(t => `
            <li class="category-item">
              <span class="category-name">${t.name}</span>
              ${!t.isDefault ? `<button class="btn btn-sm btn-danger" onclick="window._deleteIncome('${t.id}', '${uid}')">Eliminar</button>` : '<span class="badge-default">Predefinida</span>'}
            </li>
          `).join('')}
        </ul>`;
  }
}

/**
 * Inicializa la seccion de categorias
 */
export async function setupCategoriesSection(uid) {
  const expForm = document.getElementById('add-expense-category-form');
  if (expForm) {
    expForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('new-expense-category-name');
      try {
        await createExpenseCategory(uid, input.value);
        showToast('Categoria creada', 'success');
        input.value = '';
        await renderCategoriesLists(uid);
        await populateCategorySelects(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const incForm = document.getElementById('add-income-type-form');
  if (incForm) {
    incForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('new-income-type-name');
      try {
        await createIncomeType(uid, input.value);
        showToast('Tipo de ingreso creado', 'success');
        input.value = '';
        await renderCategoriesLists(uid);
        await populateCategorySelects(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  window._deleteCat = async (id, uid) => {
    if (!confirm('¿Eliminar esta categoria?')) return;
    try {
      await deleteExpenseCategory(uid, id);
      showToast('Categoria eliminada', 'success');
      await renderCategoriesLists(uid);
      await populateCategorySelects(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window._deleteIncome = async (id, uid) => {
    if (!confirm('¿Eliminar este tipo de ingreso?')) return;
    try {
      await deleteIncomeType(uid, id);
      showToast('Tipo de ingreso eliminado', 'success');
      await renderCategoriesLists(uid);
      await populateCategorySelects(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  await renderCategoriesLists(uid);
}
