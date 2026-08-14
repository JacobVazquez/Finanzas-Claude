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
  return cats.map(c => ({ ...c, parentId: c.parentId || null })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Obtiene las categorias de gasto con un "displayName" que incluye la
 * categoria principal para las subcategorias (ej. "IAs -> Claude")
 */
export async function getExpenseCategoriesWithDisplayNames(uid) {
  const categories = await getExpenseCategories(uid);
  const byId = Object.fromEntries(categories.map(c => [c.id, c]));
  return categories.map(c => {
    const parent = c.parentId ? byId[c.parentId] : null;
    return { ...c, displayName: parent ? `${parent.name} → ${c.name}` : c.name };
  });
}

/**
 * Obtiene todos los tipos de ingreso
 */
export async function getIncomeTypes(uid) {
  const types = await readDocs(uid, 'incomeTypes');
  return types.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Crea una nueva categoria de gasto. Si se pasa parentId, se crea como
 * subcategoria de esa categoria principal.
 */
export async function createExpenseCategory(uid, name, parentId = null) {
  if (!name || !name.trim()) throw new Error('El nombre es requerido.');
  const existing = await getExpenseCategories(uid);

  if (parentId && !existing.find(c => c.id === parentId)) {
    throw new Error('La categoria principal no existe.');
  }

  const siblings = existing.filter(c => c.parentId === (parentId || null));
  if (siblings.find(c => c.name.toLowerCase() === name.trim().toLowerCase())) {
    throw new Error('Ya existe una categoria con ese nombre en este nivel.');
  }

  return await createDoc(uid, 'expenseCategories', { name: name.trim(), isDefault: false, parentId: parentId || null });
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
 * Elimina una categoria de gasto. Si tiene subcategorias, hay que
 * eliminarlas primero.
 */
export async function deleteExpenseCategory(uid, id) {
  const categories = await getExpenseCategories(uid);
  if (categories.some(c => c.parentId === id)) {
    throw new Error('Elimina primero las subcategorias de esta categoria.');
  }
  await deleteDocById(uid, 'expenseCategories', id);
}

/**
 * Elimina un tipo de ingreso
 */
export async function deleteIncomeType(uid, id) {
  await deleteDocById(uid, 'incomeTypes', id);
}

/**
 * Agrupa categorias en un arbol de nivel 1: { topLevel: [...], childrenByParent: {id: [...]} }
 */
function groupCategoriesByParent(categories) {
  const topLevel = categories.filter(c => !c.parentId).sort((a, b) => a.name.localeCompare(b.name));
  const childrenByParent = {};
  categories.filter(c => c.parentId).forEach(c => {
    (childrenByParent[c.parentId] ||= []).push(c);
  });
  Object.values(childrenByParent).forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));
  return { topLevel, childrenByParent };
}

/**
 * Llena todos los selects de categorias y tipos de ingreso en el DOM
 */
export async function populateCategorySelects(uid) {
  const [categories, incomeTypes] = await Promise.all([
    getExpenseCategories(uid),
    getIncomeTypes(uid)
  ]);

  const { topLevel, childrenByParent } = groupCategoriesByParent(categories);

  const optionsHtml = topLevel.map(cat => {
    const children = childrenByParent[cat.id];
    if (!children || children.length === 0) {
      return `<option value="${cat.id}">${cat.name}</option>`;
    }
    const childOptions = [
      `<option value="${cat.id}">General</option>`,
      ...children.map(ch => `<option value="${ch.id}">${ch.name}</option>`)
    ].join('');
    return `<optgroup label="${cat.name}">${childOptions}</optgroup>`;
  }).join('');

  // Expense category selects
  document.querySelectorAll('.select-expense-category').forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">-- Seleccionar categoria --</option>' + optionsHtml;
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

  const { topLevel, childrenByParent } = groupCategoriesByParent(categories);

  const expList = document.getElementById('expense-categories-list');
  if (expList) {
    expList.innerHTML = topLevel.length === 0
      ? '<p class="empty-state">No hay categorias.</p>'
      : `<div class="category-tree">
          ${topLevel.map(c => {
            const children = childrenByParent[c.id] || [];
            return `
              <div class="category-node">
                <div class="category-node-header">
                  <span class="category-name">${c.name}</span>
                  <div class="category-node-actions">
                    <button class="btn btn-sm btn-outline" onclick="window._addSubcategory('${c.id}', '${uid}')">+ Subcategoria</button>
                    ${!c.isDefault ? `<button class="btn btn-sm btn-danger" onclick="window._deleteCat('${c.id}', '${uid}')">Eliminar</button>` : '<span class="badge-default">Predefinida</span>'}
                  </div>
                </div>
                ${children.length > 0 ? `
                  <ul class="subcategory-list">
                    ${children.map(ch => `
                      <li class="subcategory-item">
                        <span class="category-name">${ch.name}</span>
                        <button class="btn btn-sm btn-danger" onclick="window._deleteCat('${ch.id}', '${uid}')">Eliminar</button>
                      </li>
                    `).join('')}
                  </ul>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>`;
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

  window._addSubcategory = async (parentId, uid) => {
    const name = prompt('Nombre de la nueva subcategoria:');
    if (!name || !name.trim()) return;
    try {
      await createExpenseCategory(uid, name, parentId);
      showToast('Subcategoria creada', 'success');
      await renderCategoriesLists(uid);
      await populateCategorySelects(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

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
