import { createDoc, readDocs, updateDocById, deleteDocById } from './firestore.js';
import { formatMXN, toCents, fromCents, formatDate, showToast, validateAmount, validateDate, todayISO, dispatchDataChange, openEditModal, closeEditModal } from './utils.js';

// ─── Precio actual via Yahoo Finance (sin API key) ───────────────────────────

export async function fetchCurrentPrice(ticker) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    return {
      price: meta.regularMarketPrice ?? null,
      previousClose: meta.previousClose ?? meta.chartPreviousClose ?? null,
      currency: meta.currency ?? 'USD',
      shortName: meta.shortName ?? ticker
    };
  } catch {
    return null;
  }
}

// ─── CRUD inversiones ─────────────────────────────────────────────────────────

export async function getInvestments(uid) {
  const [investments, purchases] = await Promise.all([
    readDocs(uid, 'investments'),
    readDocs(uid, 'investment_purchases')
  ]);

  return investments.map(inv => {
    const invPurchases = purchases.filter(p => p.investmentId === inv.id);
    let totalShares = 0;
    let totalInvestedCents = 0;

    for (const p of invPurchases) {
      totalShares += p.shares;
      totalInvestedCents += p.shares * p.pricePerShareCents;
    }

    const avgCostCents = totalShares > 0 ? totalInvestedCents / totalShares : 0;
    const currentPriceCents = inv.currentPriceCents ?? 0;
    const previousCloseCents = inv.previousCloseCents ?? 0;
    const currentValueCents = totalShares * currentPriceCents;
    const pnlCents = currentValueCents - totalInvestedCents;
    const pnlPct = totalInvestedCents > 0 ? (pnlCents / totalInvestedCents) * 100 : 0;
    const dailyChangeCents = totalShares * (currentPriceCents - previousCloseCents);

    return {
      ...inv,
      purchases: invPurchases,
      totalShares,
      totalInvestedCents,
      avgCostCents,
      currentValueCents,
      pnlCents,
      pnlPct,
      dailyChangeCents
    };
  });
}

export async function getPurchases(uid, investmentId) {
  const all = await readDocs(uid, 'investment_purchases');
  return all.filter(p => p.investmentId === investmentId)
            .sort((a, b) => b.date.localeCompare(a.date));
}

export async function addInvestmentHolding(uid, { ticker, name, currency }) {
  ticker = ticker.trim().toUpperCase();
  if (!ticker) throw new Error('Ingresa un ticker válido (ej. AAPL, AMXL).');
  if (!name?.trim()) throw new Error('Ingresa el nombre de la empresa.');

  const existing = await readDocs(uid, 'investments');
  if (existing.find(i => i.ticker === ticker)) {
    throw new Error(`Ya tienes un registro para ${ticker}.`);
  }

  return createDoc(uid, 'investments', {
    ticker,
    name: name.trim(),
    currency: currency || 'USD',
    currentPriceCents: 0,
    previousCloseCents: 0,
    lastPriceUpdate: null
  });
}

export async function addPurchase(uid, { investmentId, ticker, date, shares, pricePerShare, isFractional, fees, notes }) {
  if (!validateDate(date)) throw new Error('Fecha inválida.');
  if (!shares || isNaN(shares) || Number(shares) <= 0) throw new Error('Cantidad de acciones inválida.');
  if (!validateAmount(pricePerShare)) throw new Error('Precio por acción inválido.');

  const pricePerShareCents = toCents(pricePerShare);
  const feesCents = fees ? toCents(fees) : 0;

  await createDoc(uid, 'investment_purchases', {
    investmentId,
    ticker,
    date,
    shares: Number(shares),
    pricePerShareCents,
    isFractional: !!isFractional,
    feesCents,
    notes: notes || ''
  });
}

export async function deleteInvestment(uid, investmentId) {
  const purchases = await readDocs(uid, 'investment_purchases');
  await Promise.all(
    purchases.filter(p => p.investmentId === investmentId)
             .map(p => deleteDocById(uid, 'investment_purchases', p.id))
  );
  await deleteDocById(uid, 'investments', investmentId);
}

export async function deletePurchase(uid, purchaseId) {
  await deleteDocById(uid, 'investment_purchases', purchaseId);
}

export async function refreshPrice(uid, investment) {
  const info = await fetchCurrentPrice(investment.ticker);
  if (!info || info.price == null) return false;

  const currentPriceCents = Math.round(info.price * 100);
  const previousCloseCents = info.previousClose != null
    ? Math.round(info.previousClose * 100)
    : investment.previousCloseCents ?? 0;

  await updateDocById(uid, 'investments', investment.id, {
    currentPriceCents,
    previousCloseCents,
    lastPriceUpdate: new Date().toISOString(),
    fetchedCurrency: info.currency
  });
  return true;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function fmtShares(n) {
  return Number.isInteger(n) ? n.toString() : n.toFixed(4).replace(/\.?0+$/, '');
}

function fmtPrice(cents, currency) {
  const val = fromCents(cents).toFixed(2);
  return currency === 'MXN' ? `$${val} MXN` : `$${val} ${currency || 'USD'}`;
}

function pnlClass(val) {
  if (val > 0) return 'text-success';
  if (val < 0) return 'text-danger';
  return 'text-muted';
}

function pnlArrow(val) {
  if (val > 0) return '▲';
  if (val < 0) return '▼';
  return '–';
}

export async function renderInvestmentsList(uid) {
  const container = document.getElementById('investments-list');
  if (!container) return;

  container.innerHTML = '<p class="loading-text">Cargando inversiones...</p>';

  const investments = await getInvestments(uid);

  if (investments.length === 0) {
    container.innerHTML = '<p class="empty-state">No tienes inversiones registradas aún.</p>';
    return;
  }

  // Totales del portafolio
  const totalInvested = investments.reduce((s, i) => s + i.totalInvestedCents, 0);
  const totalValue    = investments.reduce((s, i) => s + i.currentValueCents, 0);
  const totalPnl      = totalValue - totalInvested;
  const totalPnlPct   = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  const totalDaily    = investments.reduce((s, i) => s + i.dailyChangeCents, 0);

  container.innerHTML = `
    <div class="portfolio-summary">
      <div class="portfolio-stat">
        <span class="portfolio-stat-label">Valor del portafolio</span>
        <span class="portfolio-stat-value">${formatMXN(totalValue)}</span>
      </div>
      <div class="portfolio-stat">
        <span class="portfolio-stat-label">Total invertido</span>
        <span class="portfolio-stat-value">${formatMXN(totalInvested)}</span>
      </div>
      <div class="portfolio-stat">
        <span class="portfolio-stat-label">Ganancia / Pérdida total</span>
        <span class="portfolio-stat-value ${pnlClass(totalPnl)}">
          ${pnlArrow(totalPnl)} ${formatMXN(Math.abs(totalPnl))}
          <small>(${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%)</small>
        </span>
      </div>
      <div class="portfolio-stat">
        <span class="portfolio-stat-label">Cambio hoy</span>
        <span class="portfolio-stat-value ${pnlClass(totalDaily)}">
          ${pnlArrow(totalDaily)} ${formatMXN(Math.abs(totalDaily))}
        </span>
      </div>
    </div>

    <div class="investments-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Empresa</th>
            <th class="text-right">Acciones</th>
            <th class="text-right">Precio actual</th>
            <th class="text-right">Costo promedio</th>
            <th class="text-right">Valor actual</th>
            <th class="text-right">G/P total</th>
            <th class="text-right">Cambio hoy</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${investments.map(inv => `
            <tr>
              <td>
                <span class="ticker-badge">${inv.ticker}</span>
              </td>
              <td>
                <span class="inv-name">${inv.name}</span>
                <small class="text-muted d-block">${inv.fetchedCurrency || inv.currency}</small>
              </td>
              <td class="text-right font-mono">
                ${fmtShares(inv.totalShares)}
                ${inv.purchases.some(p => p.isFractional) ? '<small class="badge-fractional">frac.</small>' : ''}
              </td>
              <td class="text-right font-mono">
                ${inv.currentPriceCents > 0
                  ? fmtPrice(inv.currentPriceCents, inv.fetchedCurrency || inv.currency)
                  : '<span class="text-muted">–</span>'}
              </td>
              <td class="text-right font-mono">
                ${inv.avgCostCents > 0 ? fmtPrice(inv.avgCostCents, inv.fetchedCurrency || inv.currency) : '–'}
              </td>
              <td class="text-right font-mono">
                ${inv.currentPriceCents > 0 ? formatMXN(inv.currentValueCents) : '–'}
              </td>
              <td class="text-right font-mono ${pnlClass(inv.pnlCents)}">
                ${inv.currentPriceCents > 0
                  ? `${pnlArrow(inv.pnlCents)} ${formatMXN(Math.abs(inv.pnlCents))} <small>(${inv.pnlPct >= 0 ? '+' : ''}${inv.pnlPct.toFixed(2)}%)</small>`
                  : '–'}
              </td>
              <td class="text-right font-mono ${pnlClass(inv.dailyChangeCents)}">
                ${inv.currentPriceCents > 0 && inv.previousCloseCents > 0
                  ? `${pnlArrow(inv.dailyChangeCents)} ${formatMXN(Math.abs(inv.dailyChangeCents))}`
                  : '–'}
              </td>
              <td>
                <div class="inv-actions">
                  <button class="btn btn-sm btn-primary" onclick="window._invRefreshPrice('${inv.id}', '${uid}')">↻</button>
                  <button class="btn btn-sm btn-outline" onclick="window._invShowPurchases('${inv.id}', '${uid}')">Compras</button>
                  <button class="btn btn-sm btn-outline" onclick="window._invEditHolding('${inv.id}', '${uid}')">Editar</button>
                  <button class="btn btn-sm btn-danger" onclick="window._invDelete('${inv.id}', '${uid}')">✕</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <p class="inv-price-note">
      ℹ️ Los precios se obtienen de Yahoo Finance en la moneda original del activo.
      Usa el botón ↻ por fila o "Actualizar precios" para refrescar.
    </p>
  `;
}

export async function renderPurchasesModal(uid, investmentId) {
  const investments = await getInvestments(uid);
  const inv = investments.find(i => i.id === investmentId);
  if (!inv) return;

  const modal = document.getElementById('modal-purchases');
  const title = document.getElementById('modal-purchases-title');
  const body  = document.getElementById('modal-purchases-body');
  if (!modal || !title || !body) return;

  title.textContent = `Compras — ${inv.ticker} (${inv.name})`;

  if (inv.purchases.length === 0) {
    body.innerHTML = '<p class="empty-state">No hay compras registradas.</p>';
  } else {
    body.innerHTML = `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th class="text-right">Acciones</th>
              <th>Tipo</th>
              <th class="text-right">Precio/acción</th>
              <th class="text-right">Total</th>
              <th class="text-right">Comisión</th>
              <th>Notas</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${inv.purchases.map(p => `
              <tr>
                <td>${formatDate(p.date)}</td>
                <td class="text-right font-mono">${fmtShares(p.shares)}</td>
                <td><span class="badge ${p.isFractional ? 'badge-fractional-tag' : 'badge-complete-tag'}">${p.isFractional ? 'Fraccionada' : 'Completa'}</span></td>
                <td class="text-right font-mono">${fmtPrice(p.pricePerShareCents, inv.fetchedCurrency || inv.currency)}</td>
                <td class="text-right font-mono">${fmtPrice(p.shares * p.pricePerShareCents, inv.fetchedCurrency || inv.currency)}</td>
                <td class="text-right font-mono">${p.feesCents > 0 ? fmtPrice(p.feesCents, inv.fetchedCurrency || inv.currency) : '–'}</td>
                <td class="text-muted">${p.notes || '–'}</td>
                <td>
                  <div style="display:flex;gap:.3rem">
                    <button class="btn btn-sm btn-outline" onclick="window._invEditPurchase('${p.id}', '${investmentId}', '${uid}')">Editar</button>
                    <button class="btn btn-sm btn-danger" onclick="window._invDeletePurchase('${p.id}', '${investmentId}', '${uid}')">✕</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  modal.style.display = 'flex';
}

// ─── Setup ────────────────────────────────────────────────────────────────────

export async function setupInvestmentsSection(uid) {
  // Poblar select de holdings en el form de compra
  async function refreshHoldingSelect() {
    const investments = await readDocs(uid, 'investments');
    const sel = document.getElementById('purchase-investment');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Seleccionar acción --</option>' +
      investments.map(i => `<option value="${i.id}" data-ticker="${i.ticker}">${i.ticker} — ${i.name}</option>`).join('');
  }

  await refreshHoldingSelect();

  // Form: agregar holding
  const holdingForm = document.getElementById('investment-holding-form');
  if (holdingForm) {
    holdingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = holdingForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await addInvestmentHolding(uid, {
          ticker: document.getElementById('inv-ticker').value,
          name: document.getElementById('inv-name').value,
          currency: document.getElementById('inv-currency').value
        });
        showToast('Acción agregada', 'success');
        holdingForm.reset();
        dispatchDataChange();
        await refreshHoldingSelect();
        await renderInvestmentsList(uid);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Form: registrar compra
  const purchaseForm = document.getElementById('investment-purchase-form');
  if (purchaseForm) {
    // Fecha de hoy por defecto
    const dateInput = document.getElementById('purchase-date');
    if (dateInput) dateInput.value = todayISO();

    // Toggle fraccionada
    const sharesInput = document.getElementById('purchase-shares');
    const fractionalCheck = document.getElementById('purchase-fractional');
    if (fractionalCheck && sharesInput) {
      fractionalCheck.addEventListener('change', () => {
        sharesInput.step = fractionalCheck.checked ? '0.0001' : '1';
        sharesInput.min  = fractionalCheck.checked ? '0.0001' : '1';
      });
    }

    purchaseForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = purchaseForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const sel = document.getElementById('purchase-investment');
        const investmentId = sel.value;
        const ticker = sel.options[sel.selectedIndex]?.dataset.ticker || '';
        if (!investmentId) throw new Error('Selecciona una acción.');

        await addPurchase(uid, {
          investmentId,
          ticker,
          date: document.getElementById('purchase-date').value,
          shares: document.getElementById('purchase-shares').value,
          pricePerShare: document.getElementById('purchase-price').value,
          isFractional: document.getElementById('purchase-fractional').checked,
          fees: document.getElementById('purchase-fees').value,
          notes: document.getElementById('purchase-notes').value
        });
        showToast('Compra registrada', 'success');
        purchaseForm.reset();
        document.getElementById('purchase-date').value = todayISO();
        dispatchDataChange();
        await renderInvestmentsList(uid);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Botón actualizar todos los precios
  document.getElementById('btn-refresh-all-prices')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh-all-prices');
    btn.disabled = true;
    btn.textContent = 'Actualizando...';
    try {
      const investments = await readDocs(uid, 'investments');
      let updated = 0;
      await Promise.all(investments.map(async inv => {
        const ok = await refreshPrice(uid, inv);
        if (ok) updated++;
      }));
      showToast(`${updated} de ${investments.length} precios actualizados`, 'success');
      await renderInvestmentsList(uid);
    } catch (err) {
      showToast('Error actualizando precios', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Actualizar precios';
    }
  });

  // Cerrar modal de compras
  document.querySelectorAll('[data-close="modal-purchases"]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('modal-purchases').style.display = 'none';
    });
  });
  document.getElementById('modal-purchases')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });

  // Handlers globales
  window._invRefreshPrice = async (id, uid) => {
    const btn = event.currentTarget;
    try {
      const investments = await readDocs(uid, 'investments');
      const inv = investments.find(i => i.id === id);
      if (!inv) return;
      const ok = await refreshPrice(uid, inv);
      showToast(ok ? `Precio de ${inv.ticker} actualizado` : `No se pudo obtener precio de ${inv.ticker}`, ok ? 'success' : 'error');
      await renderInvestmentsList(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window._invShowPurchases = async (id, uid) => {
    await renderPurchasesModal(uid, id);
  };

  window._invDelete = async (id, uid) => {
    if (!confirm('¿Eliminar esta inversión y todas sus compras? Esta acción no se puede deshacer.')) return;
    try {
      await deleteInvestment(uid, id);
      showToast('Inversión eliminada', 'success');
      dispatchDataChange();
      await renderInvestmentsList(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window._invDeletePurchase = async (purchaseId, investmentId, uid) => {
    if (!confirm('¿Eliminar esta compra?')) return;
    try {
      await deletePurchase(uid, purchaseId);
      showToast('Compra eliminada', 'success');
      dispatchDataChange();
      await renderPurchasesModal(uid, investmentId);
      await renderInvestmentsList(uid);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window._invEditHolding = async (id, uid) => {
    const investments = await readDocs(uid, 'investments');
    const inv = investments.find(i => i.id === id);
    if (!inv) return;

    openEditModal('Editar acción / ETF', `
      <form id="edit-holding-form" class="form-grid" style="padding:1.25rem 1.5rem 1.5rem">
        <div class="form-group form-full">
          <label>Nombre de la empresa</label>
          <input type="text" id="eh-name" value="${inv.name}" required />
        </div>
        <div class="form-group form-full modal-actions">
          <button type="button" class="btn btn-outline" onclick="document.getElementById('modal-edit').style.display='none'">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);

    document.getElementById('edit-holding-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await updateDocById(uid, 'investments', id, { name: document.getElementById('eh-name').value.trim() });
        showToast('Acción actualizada', 'success');
        closeEditModal();
        dispatchDataChange();
        await renderInvestmentsList(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  };

  window._invEditPurchase = async (purchaseId, investmentId, uid) => {
    const purchases = await readDocs(uid, 'investment_purchases');
    const p = purchases.find(x => x.id === purchaseId);
    if (!p) return;

    openEditModal('Editar compra', `
      <form id="edit-purchase-form" class="form-grid" style="padding:1.25rem 1.5rem 1.5rem">
        <div class="form-group">
          <label>Fecha</label>
          <input type="date" id="ep-date" value="${p.date}" required />
        </div>
        <div class="form-group">
          <label>Precio por acción</label>
          <input type="number" id="ep-price" value="${fromCents(p.pricePerShareCents)}" min="0.0001" step="0.0001" required />
        </div>
        <div class="form-group">
          <label>Cantidad de acciones</label>
          <input type="number" id="ep-shares" value="${p.shares}" min="0.0001" step="${p.isFractional ? '0.0001' : '1'}" required />
        </div>
        <div class="form-group">
          <label>Comisión</label>
          <input type="number" id="ep-fees" value="${fromCents(p.feesCents || 0)}" min="0" step="0.01" />
        </div>
        <div class="form-group inv-fractional-check">
          <label class="checkbox-label">
            <input type="checkbox" id="ep-fractional" ${p.isFractional ? 'checked' : ''} />
            <span>Fraccionada</span>
          </label>
        </div>
        <div class="form-group form-full">
          <label>Notas</label>
          <input type="text" id="ep-notes" value="${p.notes || ''}" />
        </div>
        <div class="form-group form-full modal-actions">
          <button type="button" class="btn btn-outline" onclick="document.getElementById('modal-edit').style.display='none'">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);

    document.getElementById('edit-purchase-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await updateDocById(uid, 'investment_purchases', purchaseId, {
          date: document.getElementById('ep-date').value,
          pricePerShareCents: toCents(document.getElementById('ep-price').value),
          shares: Number(document.getElementById('ep-shares').value),
          feesCents: toCents(document.getElementById('ep-fees').value || 0),
          isFractional: document.getElementById('ep-fractional').checked,
          notes: document.getElementById('ep-notes').value
        });
        showToast('Compra actualizada', 'success');
        closeEditModal();
        dispatchDataChange();
        await renderPurchasesModal(uid, investmentId);
        await renderInvestmentsList(uid);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  };

  await renderInvestmentsList(uid);
}
