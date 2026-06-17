import { readDocs, createDoc, deleteDocById } from './firestore.js';
import { getTransactions } from './transactions.js';
import { getAccounts } from './accounts.js';
import { getExpenseCategories, getIncomeTypes } from './categories.js';
import { getGoals } from './goals.js';
import { getDebts } from './debts.js';
import { formatMXN, fromCents, showToast, todayISO } from './utils.js';

const COLLECTIONS = ['accounts', 'transactions', 'expenseCategories', 'incomeTypes', 'goals', 'debts'];

/**
 * Exporta todos los datos del usuario como JSON descargable
 */
export async function exportJSON(uid) {
  try {
    const data = {};
    await Promise.all(COLLECTIONS.map(async col => {
      data[col] = await readDocs(uid, col);
    }));

    data.exportedAt = new Date().toISOString();
    data.version = '1.0';

    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `finanzas-backup-${todayISO()}.json`, 'application/json');
    showToast('Datos exportados correctamente', 'success');
  } catch (err) {
    console.error(err);
    showToast('Error al exportar: ' + err.message, 'error');
  }
}

/**
 * Exporta movimientos filtrados como CSV descargable
 */
export async function exportCSV(uid, startDate, endDate) {
  try {
    const [transactions, accounts, categories, incomeTypes] = await Promise.all([
      getTransactions(uid, { startDate, endDate }),
      getAccounts(uid),
      getExpenseCategories(uid),
      getIncomeTypes(uid)
    ]);

    const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
    const categoryMap = Object.fromEntries(categories.map(c => [c.id, c.name]));
    const incomeTypeMap = Object.fromEntries(incomeTypes.map(t => [t.id, t.name]));

    const TIPO_MAP = {
      income: 'Ingreso',
      expense: 'Egreso',
      transfer_out: 'Transferencia salida',
      transfer_in: 'Transferencia entrada',
      debt_payment: 'Pago de deuda',
      goal_contribution: 'Aportacion a meta'
    };

    const headers = ['Fecha', 'Tipo', 'Cuenta', 'Categoria / Tipo de Ingreso', 'Descripcion', 'Monto (MXN)', 'Monto (centavos)'];
    const rows = transactions.map(t => {
      const catLabel = t.categoryId ? (categoryMap[t.categoryId] || '-') :
                       t.incomeTypeId ? (incomeTypeMap[t.incomeTypeId] || '-') : '-';
      return [
        t.date || '',
        TIPO_MAP[t.type] || t.type,
        accountMap[t.accountId] || '-',
        catLabel,
        t.description || '',
        fromCents(t.amount).toFixed(2),
        t.amount
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    downloadFile('﻿' + csv, `movimientos-${todayISO()}.csv`, 'text/csv;charset=utf-8');
    showToast(`${transactions.length} movimientos exportados`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Error al exportar CSV: ' + err.message, 'error');
  }
}

/**
 * Importa datos desde un archivo JSON
 */
export async function importJSON(uid, file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!validateBackupStructure(data)) {
      showToast('El archivo no tiene un formato valido de respaldo', 'error');
      return;
    }

    const mode = confirm(
      'Tienes dos opciones:\n\n' +
      'OK = Agregar los datos del archivo a los existentes\n' +
      'Cancelar = Sobrescribir TODOS tus datos actuales con los del archivo\n\n' +
      '¿Deseas AGREGAR los datos (OK) o SOBRESCRIBIR (Cancelar)?'
    );

    if (!mode) {
      // Overwrite: delete all existing data first
      const confirmed = confirm(
        '¡ATENCION! Esto eliminara TODOS tus datos actuales y los reemplazara con los del archivo.\n\n' +
        '¿Estas seguro de que deseas continuar?'
      );
      if (!confirmed) return;

      // Delete existing
      await Promise.all(COLLECTIONS.map(async col => {
        const existing = await readDocs(uid, col);
        await Promise.all(existing.map(doc => deleteDocById(uid, col, doc.id)));
      }));
    }

    // Import each collection
    let imported = 0;
    for (const col of COLLECTIONS) {
      if (data[col] && Array.isArray(data[col])) {
        for (const item of data[col]) {
          const { id, createdAt, updatedAt, ...rest } = item;
          await createDoc(uid, col, rest);
          imported++;
        }
      }
    }

    showToast(`Importacion completada: ${imported} registros`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Error al importar: ' + err.message, 'error');
  }
}

/**
 * Valida que el JSON de respaldo tenga la estructura esperada
 */
export function validateBackupStructure(data) {
  if (!data || typeof data !== 'object') return false;
  // At least one of the expected collections should be present
  return COLLECTIONS.some(col => Array.isArray(data[col]));
}

/**
 * Crea y descarga un archivo en el navegador
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Inicializa la seccion de exportar/importar
 */
export function setupImportExport(uid) {
  const exportJsonBtn = document.getElementById('btn-export-json');
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => exportJSON(uid));
  }

  const exportCsvBtn = document.getElementById('btn-export-csv');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      const start = document.getElementById('export-start-date')?.value;
      const end = document.getElementById('export-end-date')?.value;
      exportCSV(uid, start, end);
    });
  }

  const importInput = document.getElementById('import-json-file');
  const importBtn = document.getElementById('btn-import-json');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await importJSON(uid, file);
      importInput.value = '';
    });
  }

  // Set default dates for CSV export
  const today = todayISO();
  const exportStart = document.getElementById('export-start-date');
  const exportEnd = document.getElementById('export-end-date');
  if (exportStart) exportStart.value = `${today.substring(0, 4)}-01-01`;
  if (exportEnd) exportEnd.value = today;
}
