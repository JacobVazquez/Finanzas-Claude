import { calculateKPIs } from './dashboard.js';
import { getTransactions } from './transactions.js';
import { getAccounts } from './accounts.js';
import { formatMXN } from './utils.js';

const COLORS = {
  primary: '#1E3A8A',
  secondary: '#14213D',
  gold: '#D4AF37',
  success: '#16a34a',
  danger: '#dc2626',
  warning: '#d97706',
  info: '#2563eb',
  bg: '#F5F7FA',
  text: '#0D1B2A',
  muted: '#6B7280',
  border: '#E5E7EB',
};

const TX_LABELS = {
  income: 'Ingreso',
  expense: 'Egreso',
  transfer_out: 'Transferencia salida',
  transfer_in: 'Transferencia entrada',
  debt_payment: 'Pago de deuda',
  goal_contribution: 'Aportación a meta',
  investment_buy: 'Compra de inversión',
};

const CHART_META = [
  { id: 'chart-income',            title: 'Ingresos por Mes' },
  { id: 'chart-expense',           title: 'Egresos por Mes' },
  { id: 'chart-expense-category',  title: 'Egresos por Categoría' },
  { id: 'chart-account-balances',  title: 'Saldos por Cuenta' },
  { id: 'chart-monthly-trend',     title: 'Tendencia Mensual' },
  { id: 'chart-debts',             title: 'Estado de Deudas' },
  { id: 'chart-investments',       title: 'Rendimiento de Inversiones' },
  { id: 'chart-yield-projection',  title: 'Proyección de Rendimientos — 12 meses' },
];

function formatDate(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${d}/${m}/${iso.split('-')[0]}`;
}

function formatDateLong(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

function txTypeColor(type) {
  if (type === 'income' || type === 'transfer_in') return COLORS.success;
  if (type === 'expense' || type === 'debt_payment') return COLORS.danger;
  if (type === 'goal_contribution') return COLORS.warning;
  if (type === 'investment_buy') return COLORS.info;
  return COLORS.muted;
}

function txSign(type) {
  return (type === 'income' || type === 'transfer_in') ? '+' : '-';
}

/**
 * Captura los canvas de Chart.js del DOM como imágenes base64.
 * Solo incluye los que tienen datos (width > 0 y no están vacíos).
 */
function captureCharts() {
  return CHART_META.map(({ id, title }) => {
    const canvas = document.getElementById(id);
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      // Un canvas vacío produce una imagen de un color sólido muy pequeña — la excluimos
      if (dataUrl === 'data:,') return null;
      return { title, dataUrl };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function buildChartsHTML(charts) {
  if (!charts.length) return '';

  // Separar proyección (ancho completo) del resto (grid 2 columnas)
  const projection = charts.find(c => c.title.includes('Proyección'));
  const grid = charts.filter(c => !c.title.includes('Proyección'));

  const gridHTML = grid.length ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      ${grid.map(c => `
        <div style="background:${COLORS.bg};border-radius:8px;padding:14px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;
                      color:${COLORS.muted};margin-bottom:10px">${c.title}</div>
          <img src="${c.dataUrl}" style="width:100%;height:auto;border-radius:4px" />
        </div>
      `).join('')}
    </div>
  ` : '';

  const projHTML = projection ? `
    <div style="background:${COLORS.bg};border-radius:8px;padding:14px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;
                  color:${COLORS.muted};margin-bottom:10px">${projection.title}</div>
      <img src="${projection.dataUrl}" style="width:100%;height:auto;border-radius:4px" />
    </div>
  ` : '';

  return gridHTML + projHTML;
}

function buildHTML({ startDate, endDate, kpis, transactions, accountMap, charts }) {
  const rows = transactions.map(t => `
    <tr>
      <td>${formatDate(t.date)}</td>
      <td>
        <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;
          background:${txTypeColor(t.type)}22;color:${txTypeColor(t.type)}">
          ${TX_LABELS[t.type] || t.type}
        </span>
      </td>
      <td style="color:${COLORS.muted};font-size:12px">${t.description || '—'}</td>
      <td style="color:${COLORS.muted};font-size:12px">${accountMap[t.accountId] || '—'}</td>
      <td style="text-align:right;font-weight:600;color:${txTypeColor(t.type)}">
        ${txSign(t.type)}${formatMXN(t.amount)}
      </td>
    </tr>
  `).join('');

  const chartsSection = charts.length ? `
    <div class="section-title">Gráficas</div>
    ${buildChartsHTML(charts)}
  ` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Reporte Finanzas Pro</title>
  <style>
    @page { size: letter portrait; margin: 14mm 14mm 14mm 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: ${COLORS.text}; background: #fff; }

    .report-header {
      background: linear-gradient(135deg, ${COLORS.secondary} 0%, ${COLORS.primary} 100%);
      color: #fff; padding: 18px 22px; border-radius: 10px; margin-bottom: 18px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .report-header h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    .report-header .gold { color: ${COLORS.gold}; }
    .report-header .period { font-size: 11px; opacity: 0.8; margin-top: 4px; }
    .report-header .generated { font-size: 11px; opacity: 0.6; text-align: right; }

    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
    .kpi-card { background: ${COLORS.bg}; border-radius: 8px; padding: 12px 14px; border-left: 3px solid ${COLORS.primary}; }
    .kpi-card.income { border-color: ${COLORS.success}; }
    .kpi-card.expense { border-color: ${COLORS.danger}; }
    .kpi-card.yield  { border-color: ${COLORS.warning}; }
    .kpi-card.total  {
      background: linear-gradient(135deg, ${COLORS.secondary} 0%, ${COLORS.primary} 100%);
      border: none; color: #fff; grid-column: span 4;
      display: flex; justify-content: space-between; align-items: center; padding: 14px 18px;
    }
    .kpi-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: ${COLORS.muted}; margin-bottom: 5px; }
    .kpi-card.total .kpi-label { color: rgba(255,255,255,0.7); margin: 0; }
    .kpi-value { font-size: 16px; font-weight: 700; }
    .kpi-card.total .kpi-value { font-size: 22px; color: ${COLORS.gold}; }

    .section-title {
      font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
      color: ${COLORS.primary}; border-bottom: 2px solid ${COLORS.primary};
      padding-bottom: 5px; margin-bottom: 12px; margin-top: 20px;
    }

    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    thead tr { background: ${COLORS.secondary}; color: #fff; }
    thead th { padding: 7px 9px; text-align: left; font-weight: 600; font-size: 10.5px; }
    thead th:last-child { text-align: right; }
    tbody tr { border-bottom: 1px solid ${COLORS.border}; }
    tbody tr:last-child { border-bottom: none; }
    tbody td { padding: 6px 9px; vertical-align: middle; }
    tbody tr:nth-child(even) { background: ${COLORS.bg}; }

    .report-footer {
      margin-top: 24px; padding-top: 10px; border-top: 1px solid ${COLORS.border};
      font-size: 9.5px; color: ${COLORS.muted}; display: flex; justify-content: space-between;
    }
    .empty { text-align:center; padding:20px; color:${COLORS.muted}; font-style:italic; }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>

  <div class="no-print" style="margin-bottom:14px;display:flex;gap:10px;justify-content:flex-end">
    <button onclick="window.print()" style="
      background:${COLORS.primary};color:#fff;border:none;padding:9px 20px;
      border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">
      🖨️ Imprimir / Guardar PDF
    </button>
    <button onclick="window.close()" style="
      background:${COLORS.bg};color:${COLORS.text};border:1px solid ${COLORS.border};
      padding:9px 20px;border-radius:6px;font-size:13px;cursor:pointer">
      Cerrar
    </button>
  </div>

  <div class="report-header">
    <div>
      <h1>Finanzas <span class="gold">Pro</span></h1>
      <div class="period">Reporte del ${formatDateLong(startDate)} al ${formatDateLong(endDate)}</div>
    </div>
    <div class="generated">
      Generado el ${formatDateLong(new Date().toISOString().split('T')[0])}<br/>
      ${transactions.length} movimiento${transactions.length !== 1 ? 's' : ''}
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card income">
      <div class="kpi-label">Ingresos</div>
      <div class="kpi-value" style="color:${COLORS.success}">${formatMXN(kpis.totalIncome)}</div>
    </div>
    <div class="kpi-card expense">
      <div class="kpi-label">Egresos</div>
      <div class="kpi-value" style="color:${COLORS.danger}">${formatMXN(kpis.totalExpenses)}</div>
    </div>
    <div class="kpi-card yield">
      <div class="kpi-label">Rendimientos</div>
      <div class="kpi-value" style="color:${COLORS.warning}">${formatMXN(kpis.totalYield || 0)}</div>
    </div>
    <div class="kpi-card" style="border-color:${COLORS.info}">
      <div class="kpi-label">Balance del periodo</div>
      <div class="kpi-value" style="color:${kpis.balance >= 0 ? COLORS.success : COLORS.danger}">
        ${formatMXN(kpis.balance)}
      </div>
    </div>
    <div class="kpi-card total">
      <div class="kpi-label">Saldo Total (Patrimonio)</div>
      <div class="kpi-value">${formatMXN(kpis.netWorth)}</div>
    </div>
  </div>

  ${chartsSection}

  <div class="section-title">Movimientos del periodo</div>
  ${transactions.length === 0
    ? '<div class="empty">Sin movimientos en el periodo seleccionado.</div>'
    : `<table>
        <thead>
          <tr>
            <th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Cuenta</th>
            <th style="text-align:right">Monto</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
  }

  <div class="report-footer">
    <span>Finanzas Pro — Reporte generado automáticamente</span>
    <span>Periodo: ${formatDate(startDate)} – ${formatDate(endDate)}</span>
  </div>

</body>
</html>`;
}

export function setupReportButton(uid) {
  const btn = document.getElementById('btn-generate-pdf');
  if (!btn) return;
  btn.addEventListener('click', () => openReportModal(uid));
}

function openReportModal(uid) {
  document.getElementById('report-modal')?.remove();

  const today = new Date().toISOString().split('T')[0];
  const firstOfMonth = today.substring(0, 8) + '01';

  const modal = document.createElement('div');
  modal.id = 'report-modal';
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(13,27,42,0.6);display:flex;
    align-items:center;justify-content:center;z-index:9999;padding:1rem
  `;
  modal.innerHTML = `
    <div style="
      background:#fff;border-radius:14px;padding:28px 32px;width:100%;max-width:420px;
      box-shadow:0 20px 60px rgba(0,0,0,0.3)
    ">
      <h3 style="font-size:17px;font-weight:700;color:${COLORS.secondary};margin-bottom:6px">
        Generar Reporte PDF
      </h3>
      <p style="font-size:12px;color:${COLORS.muted};margin-bottom:20px">
        Incluye KPIs, gráficas y tabla de movimientos.
      </p>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <label style="font-size:12px;font-weight:600;color:${COLORS.muted};text-transform:uppercase;
                        letter-spacing:0.4px;display:block;margin-bottom:6px">Fecha inicio</label>
          <input type="date" id="report-start" value="${firstOfMonth}" style="
            width:100%;padding:9px 12px;border:1.5px solid ${COLORS.border};
            border-radius:8px;font-size:14px;color:${COLORS.text};outline:none"/>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:${COLORS.muted};text-transform:uppercase;
                        letter-spacing:0.4px;display:block;margin-bottom:6px">Fecha fin</label>
          <input type="date" id="report-end" value="${today}" style="
            width:100%;padding:9px 12px;border:1.5px solid ${COLORS.border};
            border-radius:8px;font-size:14px;color:${COLORS.text};outline:none"/>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:24px">
        <button id="report-cancel" style="
          flex:1;padding:10px;border:1.5px solid ${COLORS.border};background:#fff;
          border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;color:${COLORS.text}
        ">Cancelar</button>
        <button id="report-generate" style="
          flex:2;padding:10px;background:${COLORS.primary};color:#fff;border:none;
          border-radius:8px;font-size:14px;font-weight:600;cursor:pointer
        ">Generar PDF</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById('report-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  document.getElementById('report-generate').addEventListener('click', async () => {
    const startDate = document.getElementById('report-start').value;
    const endDate = document.getElementById('report-end').value;

    if (!startDate || !endDate) { alert('Selecciona las fechas de inicio y fin.'); return; }
    if (startDate > endDate) { alert('La fecha de inicio debe ser anterior a la fecha fin.'); return; }

    const genBtn = document.getElementById('report-generate');
    genBtn.disabled = true;
    genBtn.textContent = 'Generando...';

    try {
      // Capturar gráficas ANTES de abrir la ventana (deben estar en el DOM actual)
      const charts = captureCharts();

      const [kpis, transactions, accounts] = await Promise.all([
        calculateKPIs(uid, startDate, endDate),
        getTransactions(uid, { startDate, endDate }),
        getAccounts(uid)
      ]);

      const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
      const html = buildHTML({ startDate, endDate, kpis, transactions, accountMap, charts });

      const win = window.open('', '_blank', 'width=960,height=750');
      win.document.write(html);
      win.document.close();

      modal.remove();
    } catch (err) {
      alert('Error al generar el reporte: ' + (err.message || 'Error desconocido'));
      genBtn.disabled = false;
      genBtn.textContent = 'Generar PDF';
    }
  });
}
