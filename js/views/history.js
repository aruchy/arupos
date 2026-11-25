import {
  formatRupiah,
  formatDateTime,
  getLocalDateKey,
  isSameLocalDay,
  escapeHtml,
  debounce,
  bus,
} from '../utils.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { openReceiptModal } from '../receipt.js';
import { toast, openSheet, closeSheet } from '../motion.js';
import { t } from '../i18n.js';

const DETAIL_SHEET_ID = 'history-detail-sheet';
const VOID_SHEET_ID = 'history-void-sheet';

const REDUNDANT_PAYMENT_DETAILS = new Set([
  'tunai',
  'cash',
  'transfer',
  'transfer bank',
  'bank transfer',
  'qris',
  'ewallet',
  'e-wallet',
]);

const state = {
  search: '',
  dateFilter: 'all', // 'all' | 'today' | '7days'
  statusFilter: 'all', // 'all' | 'completed' | 'void'
  paymentFilter: 'all', // 'all' | 'cash' | 'qris' | 'transfer' | 'ewallet'
  selectedId: null,
};

let rootEl = null;
let unsubs = [];
let debouncedSearchUpdate = null;
let viewportMq = null;
let viewportListener = null;

function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches;
}

function normalizePaymentMethod(raw) {
  const key = String(raw || 'cash')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (key === 'tunai' || key === 'cash') return 'cash';
  if (key === 'qris' || key === 'qr') return 'qris';
  if (key === 'transfer' || key === 'bank' || key === 'banktransfer') return 'transfer';
  if (key === 'ewallet' || key === 'wallet' || key === 'gopay' || key === 'ovo' || key === 'dana' || key === 'shopeepay') {
    return 'ewallet';
  }
  return 'cash';
}

function getPaymentMeta(raw) {
  const key = normalizePaymentMethod(raw);
  const map = {
    cash: { label: t('payment.cash'), icon: 'cash', badgeClass: 'badge--success' },
    qris: { label: t('payment.qris'), icon: 'qris', badgeClass: 'badge--primary' },
    transfer: { label: t('payment.transferShort'), icon: 'bank', badgeClass: 'badge--muted' },
    ewallet: { label: t('payment.ewallet'), icon: 'wallet', badgeClass: 'badge--warning' },
  };
  return map[key] || map.cash;
}

function isTxVoid(tx) {
  const status = String(tx?.status || '').toLowerCase();
  return status === 'void' || status === 'voided';
}

function getTxTimestamp(tx) {
  return tx?.createdAt || tx?.timestamp || tx?.date || '';
}

function getTxPaymentMethod(tx) {
  return normalizePaymentMethod(tx?.paymentMethod ?? tx?.payment?.method ?? 'cash');
}

function getTxPaymentDetail(tx) {
  return String(tx?.paymentDetail ?? tx?.payment?.detail ?? '').trim();
}

function getItemUnitPrice(item) {
  return Math.max(0, Math.round(Number(item?.price ?? item?.unitPrice ?? 0) || 0));
}

function getItemQty(item) {
  return Math.max(0, Math.round(Number(item?.qty ?? item?.quantity ?? 0) || 0));
}

function getItemDiscountAmount(item) {
  if (!item) return 0;
  if (typeof item.discountAmount === 'number') return Math.max(0, Math.round(item.discountAmount));
  if (typeof item.discount === 'number') return Math.max(0, Math.round(item.discount));
  return 0;
}

function getItemNetTotal(item) {
  if (item?.netTotal !== undefined && Number.isFinite(Number(item.netTotal))) {
    return Math.max(0, Math.round(Number(item.netTotal)));
  }
  return Math.max(0, getItemUnitPrice(item) * getItemQty(item) - getItemDiscountAmount(item));
}

function getTxSubtotal(tx) {
  if (tx?.subtotal !== undefined && Number.isFinite(Number(tx.subtotal))) {
    return Math.max(0, Math.round(Number(tx.subtotal)));
  }
  const items = Array.isArray(tx?.items) ? tx.items : [];
  return items.reduce((sum, item) => sum + getItemNetTotal(item), 0);
}

function getTxOrderDiscount(tx) {
  if (tx?.orderDiscountType === 'none') return 0;
  return Math.max(0, Math.round(Number(tx?.orderDiscountAmount ?? tx?.orderDiscount ?? 0) || 0));
}

function getTxServiceAmount(tx) {
  return Math.max(0, Math.round(Number(tx?.serviceAmount ?? 0) || 0));
}

function getTxTaxAmount(tx) {
  return Math.max(0, Math.round(Number(tx?.taxAmount ?? 0) || 0));
}

function getTxGrandTotal(tx) {
  if (tx?.grandTotal !== undefined && Number.isFinite(Number(tx.grandTotal))) {
    return Math.max(0, Math.round(Number(tx.grandTotal)));
  }
  return Math.max(0, getTxSubtotal(tx) - getTxOrderDiscount(tx) + getTxServiceAmount(tx) + getTxTaxAmount(tx));
}

function getTxCashReceived(tx) {
  if (tx?.cashReceived !== undefined && Number.isFinite(Number(tx.cashReceived))) {
    return Math.max(0, Math.round(Number(tx.cashReceived)));
  }
  return getTxGrandTotal(tx);
}

function getTxChange(tx) {
  if (tx?.changeAmount !== undefined && Number.isFinite(Number(tx.changeAmount))) {
    return Math.max(0, Math.round(Number(tx.changeAmount)));
  }
  return Math.max(0, getTxCashReceived(tx) - getTxGrandTotal(tx));
}

function getTxTotalItemQty(tx) {
  const items = Array.isArray(tx?.items) ? tx.items : [];
  return items.reduce((sum, item) => sum + getItemQty(item), 0);
}

function formatOrderContext(tx) {
  const mode = String(tx?.mode || 'retail').toLowerCase();
  const tableNo = String(tx?.tableNumber ?? '').trim();
  const orderType = String(tx?.orderType || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

  if (mode === 'fnb' || orderType === 'dinein' || orderType === 'takeaway') {
    if (orderType === 'takeaway') return t('receipt.takeaway');
    if (orderType === 'dinein' || tableNo) {
      return tableNo ? t('history.tableWithDineIn', { table: tableNo }) : t('receipt.dineIn');
    }
    return t('app.modeShortFnb');
  }
  return t('receipt.retail');
}

function buildLast7LocalDayKeys(now = new Date()) {
  const set = new Set();
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    set.add(getLocalDateKey(d));
  }
  return set;
}

function matchesSearch(tx, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;

  const receiptNo = String(tx?.receiptNo || tx?.id || '').toLowerCase();
  if (receiptNo.includes(q)) return true;

  const customer = String(tx?.customerName || '').toLowerCase();
  if (customer.includes(q)) return true;

  const tableNo = String(tx?.tableNumber || '').trim().toLowerCase();
  if (tableNo && (tableNo.includes(q) || `meja ${tableNo}`.includes(q) || `table ${tableNo}`.includes(q))) {
    return true;
  }

  const paymentMeta = getPaymentMeta(getTxPaymentMethod(tx));
  const paymentDetail = getTxPaymentDetail(tx).toLowerCase();
  if (paymentMeta.label.toLowerCase().includes(q) || paymentDetail.includes(q)) return true;

  const orderContext = formatOrderContext(tx).toLowerCase();
  if (orderContext.includes(q)) return true;

  const items = Array.isArray(tx?.items) ? tx.items : [];
  for (const item of items) {
    const name = String(item?.name || '').toLowerCase();
    const sku = String(item?.sku || '').toLowerCase();
    const note = String(item?.note || '').toLowerCase();
    if (name.includes(q) || sku.includes(q) || note.includes(q)) {
      return true;
    }
  }
  return false;
}

function getAllTransactions() {
  const list = store.getTransactions();
  return Array.isArray(list) ? list : [];
}

function getFilteredTransactions(allTxs) {
  const now = new Date();
  const last7Keys = state.dateFilter === '7days' ? buildLast7LocalDayKeys(now) : null;

  return allTxs.filter((tx) => {
    const ts = getTxTimestamp(tx);
    if (state.dateFilter === 'today' && !isSameLocalDay(ts, now)) {
      return false;
    }
    if (state.dateFilter === '7days') {
      const key = getLocalDateKey(ts);
      if (!key || !last7Keys.has(key)) return false;
    }

    const voided = isTxVoid(tx);
    if (state.statusFilter === 'completed' && voided) return false;
    if (state.statusFilter === 'void' && !voided) return false;

    if (state.paymentFilter !== 'all' && getTxPaymentMethod(tx) !== state.paymentFilter) {
      return false;
    }

    return matchesSearch(tx, state.search);
  });
}

function hasActiveFilters() {
  return (
    state.search.trim() !== '' ||
    state.dateFilter !== 'all' ||
    state.statusFilter !== 'all' ||
    state.paymentFilter !== 'all'
  );
}

function renderSummaryBadgeHtml(filteredTxs) {
  let completedCount = 0;
  let completedRevenue = 0;
  let voidCount = 0;

  for (const tx of filteredTxs) {
    if (isTxVoid(tx)) {
      voidCount += 1;
    } else {
      completedCount += 1;
      completedRevenue += getTxGrandTotal(tx);
    }
  }

  return `
    <span class="badge badge--muted tabular-nums">${escapeHtml(t('history.summaryTx', { count: filteredTxs.length }))}</span>
    <span class="badge badge--success tabular-nums">${escapeHtml(t('history.summaryCompleted', { count: completedCount, revenue: formatRupiah(completedRevenue) }))}</span>
    ${voidCount > 0 ? `<span class="badge badge--danger tabular-nums">${escapeHtml(t('history.summaryVoid', { count: voidCount }))}</span>` : ''}
  `;
}

function renderTxCardHtml(tx) {
  const voided = isTxVoid(tx);
  const selected = tx.id === state.selectedId;
  const paymentMeta = getPaymentMeta(getTxPaymentMethod(tx));
  const orderContext = formatOrderContext(tx);
  const itemLines = Array.isArray(tx.items) ? tx.items.length : 0;
  const totalQty = getTxTotalItemQty(tx);
  const grandTotal = getTxGrandTotal(tx);
  const customerName = String(tx?.customerName || '').trim();
  const modeIcon = String(tx?.mode || '').toLowerCase() === 'fnb' ? 'utensils' : 'bag';

  return `
    <button
      type="button"
      class="tx-card${selected ? ' is-selected' : ''}${voided ? ' is-void' : ''}"
      data-tx-id="${escapeHtml(tx.id)}"
      aria-pressed="${selected ? 'true' : 'false'}"
    >
      <div style="min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span class="tabular-nums" style="font-weight: 800; font-size: 0.94rem;">${escapeHtml(tx.receiptNo || tx.id)}</span>
          ${voided ? '<span class="badge badge--danger">VOID</span>' : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <span class="badge ${paymentMeta.badgeClass}">
            ${icon(paymentMeta.icon)}
            <span>${escapeHtml(paymentMeta.label)}</span>
          </span>
          <span class="badge badge--muted">
            ${icon(modeIcon)}
            <span>${escapeHtml(orderContext)}</span>
          </span>
          ${customerName ? `<span class="badge badge--muted">${escapeHtml(customerName)}</span>` : ''}
        </div>
        <div class="tabular-nums" style="font-size: 0.78rem; color: var(--text-muted);">
          ${escapeHtml(formatDateTime(getTxTimestamp(tx)))} · ${escapeHtml(t('history.cardLines', { lines: itemLines, qty: totalQty }))}
        </div>
      </div>

      <div style="text-align: right; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
        <div
          class="tabular-nums"
          style="font-weight: 800; font-size: 1rem;${voided ? ' text-decoration: line-through; color: var(--text-muted);' : ''}"
        >
          ${escapeHtml(formatRupiah(grandTotal))}
        </div>
        <span style="color: var(--text-muted); font-size: 0.75rem; display: inline-flex; align-items: center; gap: 2px;">
          <span>${escapeHtml(t('history.detailBtn'))}</span>
          ${icon('chevronRight')}
        </span>
      </div>
    </button>
  `;
}

function formatPaymentDetailSuffix(paymentMethod, paymentMeta, paymentDetail) {
  const clean = String(paymentDetail || '').trim();
  const normalized = clean.toLowerCase();
  if (
    !clean ||
    normalized === paymentMeta.label.toLowerCase() ||
    normalized === paymentMethod.toLowerCase() ||
    ((paymentMethod === 'cash' || paymentMethod === 'qris' || paymentMethod === 'transfer') &&
      REDUNDANT_PAYMENT_DETAILS.has(normalized))
  ) {
    return '';
  }
  return ` (${clean})`;
}

function renderTxDetailBodyHtml(tx) {
  const voided = isTxVoid(tx);
  const paymentMethod = getTxPaymentMethod(tx);
  const paymentMeta = getPaymentMeta(paymentMethod);
  const paymentDetail = getTxPaymentDetail(tx);
  const paymentSuffix = formatPaymentDetailSuffix(paymentMethod, paymentMeta, paymentDetail);
  const orderContext = formatOrderContext(tx);
  const modeLabel = String(tx?.mode || 'retail').toLowerCase() === 'fnb'
    ? t('app.modeBadgeFnb')
    : t('app.modeBadgeRetail');
  const customerName = String(tx?.customerName || '').trim();
  const voidReason = String(tx?.voidReason || '').trim();
  const voidedAt = tx?.voidedAt || '';

  const items = Array.isArray(tx.items) ? tx.items : [];
  const subtotal = getTxSubtotal(tx);
  const orderDiscount = getTxOrderDiscount(tx);
  const serviceAmount = getTxServiceAmount(tx);
  const taxAmount = getTxTaxAmount(tx);
  const grandTotal = getTxGrandTotal(tx);

  const serviceLabel = String(tx?.serviceLabel || 'Service').trim() || 'Service';
  const serviceRate = Number(tx?.serviceRate) || 0;
  const taxLabel = String(tx?.taxLabel || 'PPN').trim() || 'PPN';
  const taxRate = Number(tx?.taxRate) || 0;
  const cashReceived = getTxCashReceived(tx);
  const changeAmount = getTxChange(tx);

  const itemsHtml = items
    .map((item) => {
      const qty = getItemQty(item);
      const unitPrice = getItemUnitPrice(item);
      const disc = getItemDiscountAmount(item);
      const net = getItemNetTotal(item);
      const itemNote = String(item?.note || '').trim();
      const sku = String(item?.sku || '').trim();
      const emoji = String(item?.emoji || '').trim();

      return `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-subtle);">
          <div style="min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px;">
            <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-primary); word-break: break-word;">
              ${emoji ? `<span aria-hidden="true" style="margin-right: 4px;">${escapeHtml(emoji)}</span>` : ''}${escapeHtml(item?.name || t('common.product'))}
            </div>
            <div class="tabular-nums" style="font-size: 0.8rem; color: var(--text-muted);">
              ${qty} x ${escapeHtml(formatRupiah(unitPrice))}${sku ? ` · SKU ${escapeHtml(sku)}` : ''}
            </div>
            ${
              disc > 0
                ? `<div class="tabular-nums" style="font-size: 0.78rem; font-weight: 600; color: var(--success);">${escapeHtml(t('history.itemDiscLine', { amount: formatRupiah(disc) }))}</div>`
                : ''
            }
            ${
              itemNote
                ? `<div class="cart-item-note" style="margin-top: 2px;">${escapeHtml(t('history.itemNoteLine', { note: itemNote }))}</div>`
                : ''
            }
          </div>
          <div class="tabular-nums" style="font-weight: 700; font-size: 0.9rem; white-space: nowrap; color: var(--text-primary);">
            ${escapeHtml(formatRupiah(net))}
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <div data-detail-tx-id="${escapeHtml(tx.id)}" style="display: flex; flex-direction: column; gap: 16px;">
      <div style="display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--border-subtle);">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
          <h3 class="tabular-nums" style="margin: 0; font-size: 1.05rem; font-weight: 800;">${escapeHtml(tx.receiptNo || tx.id)}</h3>
          ${
            voided
              ? `<span class="badge badge--danger">${icon('ban')} <span>${escapeHtml(t('history.voidBadge'))}</span></span>`
              : `<span class="badge badge--success">${icon('checkCircle')} <span>${escapeHtml(t('history.completedBadge'))}</span></span>`
          }
        </div>
        <div class="tabular-nums" style="font-size: 0.82rem; color: var(--text-muted);">
          ${escapeHtml(formatDateTime(getTxTimestamp(tx)))}
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
          <span class="badge badge--muted">${escapeHtml(modeLabel)}</span>
          <span class="badge badge--muted">${escapeHtml(orderContext)}</span>
          ${customerName ? `<span class="badge badge--muted">${escapeHtml(t('history.customerBadge', { name: customerName }))}</span>` : ''}
        </div>
        ${
          voided
            ? `
          <div role="status" style="display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: var(--radius-md); background: var(--danger-bg); color: var(--danger); font-size: 0.82rem; margin-top: 4px;">
            <span style="flex-shrink: 0; margin-top: 1px;">${icon('warning')}</span>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <strong>${escapeHtml(t('history.voidBannerTitle'))}</strong>
              ${voidedAt ? `<span class="tabular-nums">${escapeHtml(t('history.voidTime', { time: formatDateTime(voidedAt) }))}</span>` : ''}
              <span>${escapeHtml(t('history.voidReason', { reason: voidReason || t('store.defaultVoidReason') }))}</span>
            </div>
          </div>
        `
            : ''
        }
      </div>

      <div>
        <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 4px;">
          ${escapeHtml(t('history.itemsHeading', { count: items.length }))}
        </div>
        <div>
          ${itemsHtml || `<div style="font-size: 0.86rem; color: var(--text-muted); padding: 8px 0;">${escapeHtml(t('history.noItems'))}</div>`}
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 7px; padding: 12px 14px; border-radius: var(--radius-md); background: var(--bg-surface-2); border: 1px solid var(--border-subtle);">
        <div class="cart-summary-row">
          <span>${escapeHtml(t('common.subtotal'))}</span>
          <span class="tabular-nums">${escapeHtml(formatRupiah(subtotal))}</span>
        </div>
        ${
          orderDiscount > 0
            ? `
          <div class="cart-summary-row" style="color: var(--success);">
            <span>${escapeHtml(t('receipt.orderDiscount'))}${(tx?.orderDiscountType === 'percent' || tx?.orderDiscountType === 'pct') && tx?.orderDiscountValue ? ` (${escapeHtml(tx.orderDiscountValue)}%)` : ''}</span>
            <span class="tabular-nums">-${escapeHtml(formatRupiah(orderDiscount))}</span>
          </div>
        `
            : ''
        }
        ${
          serviceAmount > 0
            ? `
          <div class="cart-summary-row">
            <span>${escapeHtml(serviceLabel)}${serviceRate ? ` (${escapeHtml(serviceRate)}%)` : ''}</span>
            <span class="tabular-nums">${escapeHtml(formatRupiah(serviceAmount))}</span>
          </div>
        `
            : ''
        }
        ${
          taxAmount > 0
            ? `
          <div class="cart-summary-row">
            <span>${escapeHtml(taxLabel)}${taxRate ? ` (${escapeHtml(taxRate)}%)` : ''}</span>
            <span class="tabular-nums">${escapeHtml(formatRupiah(taxAmount))}</span>
          </div>
        `
            : ''
        }
        <div class="cart-summary-total">
          <span>${escapeHtml(t('common.total'))}</span>
          <span class="tabular-nums" style="${voided ? 'text-decoration: line-through; color: var(--text-muted);' : ''}">
            ${escapeHtml(formatRupiah(grandTotal))}
          </span>
        </div>

        <div style="border-top: 1px solid var(--border-subtle); margin: 4px 0;"></div>

        <div class="cart-summary-row">
          <span>${escapeHtml(t('history.paymentMethodRow'))}</span>
          <span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: var(--text-primary);">
            ${icon(paymentMeta.icon)}
            <span>${escapeHtml(paymentMeta.label)}${escapeHtml(paymentSuffix)}</span>
          </span>
        </div>
        ${
          paymentMethod === 'cash'
            ? `
          <div class="cart-summary-row">
            <span>${escapeHtml(t('history.cashReceivedRow'))}</span>
            <span class="tabular-nums">${escapeHtml(formatRupiah(cashReceived))}</span>
          </div>
          <div class="cart-summary-row">
            <span>${escapeHtml(t('history.changeRow'))}</span>
            <span class="tabular-nums" style="font-weight: 700; color: var(--success);">${escapeHtml(formatRupiah(changeAmount))}</span>
          </div>
        `
            : ''
        }
      </div>
    </div>
  `;
}

function renderTxDetailActionsHtml(tx) {
  const voided = isTxVoid(tx);
  return `
    <div style="display: flex; flex-wrap: wrap; gap: 10px; width: 100%;">
      <button
        type="button"
        class="btn btn--primary"
        style="flex: 1 0 auto;"
        data-action="open-receipt"
        data-tx-id="${escapeHtml(tx.id)}"
      >
        ${icon('printer')}
        <span>${escapeHtml(t('history.btnReceipt'))}</span>
      </button>
      ${
        !voided
          ? `
        <button
          type="button"
          class="btn btn--danger"
          data-action="open-void"
          data-tx-id="${escapeHtml(tx.id)}"
        >
          ${icon('ban')}
          <span>${escapeHtml(t('history.btnVoid'))}</span>
        </button>
      `
          : ''
      }
    </div>
  `;
}

function openTransactionReceipt(txId) {
  const tx = store.getTransactionById(txId);
  if (!tx) {
    toast(t('history.txNotFound'), 'error');
    return;
  }
  openReceiptModal(tx, store.getSettings());
}

function openVoidConfirmationSheet(txId) {
  const tx = store.getTransactionById(txId);
  if (!tx) {
    toast(t('history.txNotFound'), 'error');
    return;
  }
  if (isTxVoid(tx)) {
    toast(t('history.alreadyVoidToast'), 'info');
    return;
  }

  const voidPresets = t('history.voidPresets');
  const quickChipsHtml = (Array.isArray(voidPresets) ? voidPresets : [])
    .map(
      (reason) => `
      <button type="button" class="chip" data-void-preset="${escapeHtml(reason)}">
        ${escapeHtml(reason)}
      </button>
    `
    )
    .join('');

  const contentHtml = `
    <div style="display: flex; flex-direction: column; gap: 14px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-radius: var(--radius-md); background: var(--bg-surface-2); border: 1px solid var(--border-subtle);">
        <div>
          <div style="font-size: 0.76rem; color: var(--text-muted);">${escapeHtml(t('history.voidReceiptNo'))}</div>
          <div class="tabular-nums" style="font-weight: 800; font-size: 0.94rem;">${escapeHtml(tx.receiptNo || tx.id)}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 0.76rem; color: var(--text-muted);">${escapeHtml(t('history.voidTotalTx'))}</div>
          <div class="tabular-nums" style="font-weight: 800; font-size: 0.96rem;">${escapeHtml(formatRupiah(getTxGrandTotal(tx)))}</div>
        </div>
      </div>

      <div role="alert" style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: var(--radius-md); background: var(--warning-bg); color: var(--warning); font-size: 0.84rem; line-height: 1.45;">
        <span style="flex-shrink: 0; margin-top: 1px;">${icon('warning')}</span>
        <span>${escapeHtml(t('history.voidStockWarn'))}</span>
      </div>

      <div class="field">
        <label class="field-label" for="void-reason-input">${escapeHtml(t('history.voidReasonLabel'))}</label>
        <div class="chip-row" style="margin-bottom: 4px;">${quickChipsHtml}</div>
        <textarea
          id="void-reason-input"
          class="textarea"
          rows="3"
          maxlength="200"
          placeholder="${escapeHtml(t('history.voidReasonPlaceholder'))}"
        ></textarea>
      </div>
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn--outlined" data-void-cancel>${escapeHtml(t('common.back'))}</button>
    <button type="button" class="btn btn--danger" data-void-confirm>
      ${icon('ban')}
      <span>${escapeHtml(t('history.voidConfirmBtn'))}</span>
    </button>
  `;

  openSheet({
    id: VOID_SHEET_ID,
    title: t('history.voidConfirmTitle'),
    contentHtml,
    footerHtml,
    size: 'sm',
    onMount(panelEl) {
      if (!panelEl) return;
      const reasonInput = panelEl.querySelector('#void-reason-input');
      const cancelBtn = panelEl.querySelector('[data-void-cancel]');
      const confirmBtn = panelEl.querySelector('[data-void-confirm]');

      panelEl.querySelectorAll('[data-void-preset]').forEach((chip) => {
        chip.addEventListener('click', () => {
          if (!reasonInput) return;
          reasonInput.value = chip.getAttribute('data-void-preset') || '';
          reasonInput.focus();
        });
      });

      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => closeSheet(VOID_SHEET_ID));
      }

      if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
          const reason = String(reasonInput?.value || '').trim();
          const res = store.voidTransaction(tx.id, reason);
          if (res && res.ok === false) {
            toast(res.reason || t('history.voidFailedToast'), 'error');
            return;
          }
          closeSheet(VOID_SHEET_ID);
          closeSheet(DETAIL_SHEET_ID);
          toast(t('history.voidSuccessToast'), 'warning');
          renderHistoryView();
        });
      }
    },
  });
}

function openMobileDetailSheet(tx) {
  if (!tx) return;
  openSheet({
    id: DETAIL_SHEET_ID,
    title: tx.receiptNo || t('history.detailTitleFallback'),
    contentHtml: renderTxDetailBodyHtml(tx),
    footerHtml: renderTxDetailActionsHtml(tx),
    size: 'md',
    onMount(panelEl) {
      if (!panelEl) return;
      const receiptBtn = panelEl.querySelector('[data-action="open-receipt"]');
      const voidBtn = panelEl.querySelector('[data-action="open-void"]');

      if (receiptBtn) {
        receiptBtn.addEventListener('click', () => openTransactionReceipt(tx.id));
      }
      if (voidBtn) {
        voidBtn.addEventListener('click', () => openVoidConfirmationSheet(tx.id));
      }
    },
  });
}

function buildFilterChips(group, options, activeValue) {
  return options
    .map(
      (opt) => `
      <button
        type="button"
        class="chip${opt.value === activeValue ? ' is-active' : ''}"
        data-filter-group="${group}"
        data-filter-value="${opt.value}"
        aria-pressed="${opt.value === activeValue ? 'true' : 'false'}"
      >
        ${opt.icon ? icon(opt.icon) : ''}
        <span>${escapeHtml(opt.label)}</span>
      </button>
    `
    )
    .join('');
}

function getDateFilterOptions() {
  return [
    { value: 'all', label: t('history.dateAll') },
    { value: 'today', label: t('history.dateToday') },
    { value: '7days', label: t('history.date7Days') },
  ];
}

function getStatusFilterOptions() {
  return [
    { value: 'all', label: t('history.statusAll') },
    { value: 'completed', label: t('history.statusCompleted') },
    { value: 'void', label: t('history.statusVoid') },
  ];
}

function getPaymentFilterOptions() {
  return [
    { value: 'all', label: t('history.paymentAll') },
    { value: 'cash', label: t('payment.cash'), icon: 'cash' },
    { value: 'qris', label: t('payment.qris'), icon: 'qris' },
    { value: 'transfer', label: t('payment.transferShort'), icon: 'bank' },
    { value: 'ewallet', label: t('payment.ewallet'), icon: 'wallet' },
  ];
}

function mountShell() {
  if (!rootEl) return;

  rootEl.innerHTML = `
    <div class="history-view">
      <header class="view-header">
        <div>
          <h1 class="view-title" data-history-title>${escapeHtml(t('history.title'))}</h1>
          <p class="view-subtitle" data-history-subtitle>${escapeHtml(t('history.subtitle'))}</p>
        </div>
        <div class="view-actions" data-history-summary></div>
      </header>

      <section class="history-filters" aria-label="${escapeHtml(t('history.filtersAria'))}" style="flex-direction: column; align-items: stretch; gap: 10px;">
        <div class="search-bar">
          ${icon('search')}
          <input
            type="search"
            class="search-input"
            data-history-search
            placeholder="${escapeHtml(t('history.searchPlaceholder'))}"
            aria-label="${escapeHtml(t('history.searchAria'))}"
            value="${escapeHtml(state.search)}"
          />
          <button
            type="button"
            class="search-clear"
            data-action="clear-search"
            aria-label="${escapeHtml(t('common.clearSearchAria'))}"
            ${state.search ? '' : 'hidden'}
          >
            ${icon('close')}
          </button>
        </div>

        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px;">
          <div class="chip-row" data-filter-row="date" role="group" aria-label="${escapeHtml(t('history.dateAria'))}">
            ${buildFilterChips('date', getDateFilterOptions(), state.dateFilter)}
          </div>
          <div class="chip-row" data-filter-row="status" role="group" aria-label="${escapeHtml(t('history.statusAria'))}">
            ${buildFilterChips('status', getStatusFilterOptions(), state.statusFilter)}
          </div>
          <div class="chip-row" data-filter-row="payment" role="group" aria-label="${escapeHtml(t('history.paymentAria'))}">
            ${buildFilterChips('payment', getPaymentFilterOptions(), state.paymentFilter)}
          </div>
        </div>
      </section>

      <div class="history-layout">
        <div class="history-list" data-history-list role="list" aria-label="${escapeHtml(t('history.listAria'))}"></div>
        <aside class="history-detail-panel" data-history-detail aria-label="${escapeHtml(t('history.detailAria'))}"></aside>
      </div>
    </div>
  `;
}

function syncShellTranslations() {
  if (!rootEl) return;

  const titleEl = rootEl.querySelector('[data-history-title]');
  if (titleEl) titleEl.textContent = t('history.title');

  const subtitleEl = rootEl.querySelector('[data-history-subtitle]');
  if (subtitleEl) subtitleEl.textContent = t('history.subtitle');

  const filtersEl = rootEl.querySelector('.history-filters');
  if (filtersEl) filtersEl.setAttribute('aria-label', t('history.filtersAria'));

  const searchInput = rootEl.querySelector('[data-history-search]');
  if (searchInput) {
    searchInput.placeholder = t('history.searchPlaceholder');
    searchInput.setAttribute('aria-label', t('history.searchAria'));
  }

  const clearBtn = rootEl.querySelector('[data-action="clear-search"]');
  if (clearBtn) clearBtn.setAttribute('aria-label', t('common.clearSearchAria'));

  const dateRow = rootEl.querySelector('[data-filter-row="date"]');
  if (dateRow) {
    dateRow.setAttribute('aria-label', t('history.dateAria'));
    dateRow.innerHTML = buildFilterChips('date', getDateFilterOptions(), state.dateFilter);
  }

  const statusRow = rootEl.querySelector('[data-filter-row="status"]');
  if (statusRow) {
    statusRow.setAttribute('aria-label', t('history.statusAria'));
    statusRow.innerHTML = buildFilterChips('status', getStatusFilterOptions(), state.statusFilter);
  }

  const paymentRow = rootEl.querySelector('[data-filter-row="payment"]');
  if (paymentRow) {
    paymentRow.setAttribute('aria-label', t('history.paymentAria'));
    paymentRow.innerHTML = buildFilterChips('payment', getPaymentFilterOptions(), state.paymentFilter);
  }

  const listEl = rootEl.querySelector('[data-history-list]');
  if (listEl) listEl.setAttribute('aria-label', t('history.listAria'));

  const detailEl = rootEl.querySelector('[data-history-detail]');
  if (detailEl) detailEl.setAttribute('aria-label', t('history.detailAria'));
}

function syncFilterControls() {
  if (!rootEl) return;

  const searchInput = rootEl.querySelector('[data-history-search]');
  if (searchInput && document.activeElement !== searchInput && searchInput.value !== state.search) {
    searchInput.value = state.search;
  }

  const clearBtn = rootEl.querySelector('[data-action="clear-search"]');
  if (clearBtn) {
    clearBtn.hidden = !state.search;
  }

  const map = {
    date: state.dateFilter,
    status: state.statusFilter,
    payment: state.paymentFilter,
  };

  rootEl.querySelectorAll('[data-filter-group]').forEach((btn) => {
    const group = btn.getAttribute('data-filter-group');
    const val = btn.getAttribute('data-filter-value');
    const active = map[group] === val;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function updateDynamicRegions() {
  if (!rootEl) return;
  if (!rootEl.querySelector('.history-view')) {
    mountShell();
  } else {
    syncShellTranslations();
  }

  syncFilterControls();

  const allTxs = getAllTransactions();
  const filtered = getFilteredTransactions(allTxs);
  const mobile = isMobileViewport();

  const summaryEl = rootEl.querySelector('[data-history-summary]');
  if (summaryEl) {
    summaryEl.innerHTML = renderSummaryBadgeHtml(filtered);
  }

  const stillVisible = filtered.some((tx) => tx.id === state.selectedId);
  if (!stillVisible) {
    state.selectedId = !mobile && filtered.length > 0 ? filtered[0].id : null;
  } else if (!state.selectedId && !mobile && filtered.length > 0) {
    state.selectedId = filtered[0].id;
  }

  const listEl = rootEl.querySelector('[data-history-list]');
  if (listEl) {
    if (filtered.length === 0) {
      const filteredOut = allTxs.length > 0 && hasActiveFilters();
      listEl.innerHTML = `
        <div class="card empty-state">
          <div class="empty-icon">${icon('history')}</div>
          <h3 class="empty-title">${escapeHtml(filteredOut ? t('history.notFoundTitle') : t('history.emptyTitle'))}</h3>
          <p class="empty-desc">
            ${escapeHtml(filteredOut ? t('history.notFoundDesc') : t('history.emptyDesc'))}
          </p>
          ${
            filteredOut
              ? `<button type="button" class="btn btn--outlined" data-action="reset-filters">${escapeHtml(t('common.resetFilter'))}</button>`
              : ''
          }
        </div>
      `;
    } else {
      listEl.innerHTML = filtered.map((tx) => renderTxCardHtml(tx)).join('');
    }
  }

  const detailEl = rootEl.querySelector('[data-history-detail]');
  if (detailEl) {
    detailEl.hidden = mobile;
    if (!mobile) {
      const selectedTx = filtered.find((tx) => tx.id === state.selectedId) || null;
      if (!selectedTx) {
        detailEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">${icon('history')}</div>
            <h3 class="empty-title">${escapeHtml(t('history.selectPromptTitle'))}</h3>
            <p class="empty-desc">${escapeHtml(t('history.selectPromptDesc'))}</p>
          </div>
        `;
      } else {
        detailEl.innerHTML = `
          <div class="is-detail-entering">
            ${renderTxDetailBodyHtml(selectedTx)}
            <div style="margin-top: 16px;">${renderTxDetailActionsHtml(selectedTx)}</div>
          </div>
        `;
      }
    }
  }
}

function handleContainerClick(e) {
  const target = e.target;
  if (!(target instanceof Element)) return;

  const filterBtn = target.closest('[data-filter-group]');
  if (filterBtn && rootEl.contains(filterBtn)) {
    const group = filterBtn.getAttribute('data-filter-group');
    const val = filterBtn.getAttribute('data-filter-value');
    if (group === 'date') state.dateFilter = val || 'all';
    if (group === 'status') state.statusFilter = val || 'all';
    if (group === 'payment') state.paymentFilter = val || 'all';
    updateDynamicRegions();
    return;
  }

  const clearSearchBtn = target.closest('[data-action="clear-search"]');
  if (clearSearchBtn && rootEl.contains(clearSearchBtn)) {
    state.search = '';
    const input = rootEl.querySelector('[data-history-search]');
    if (input) {
      input.value = '';
      input.focus();
    }
    updateDynamicRegions();
    return;
  }

  const resetBtn = target.closest('[data-action="reset-filters"]');
  if (resetBtn && rootEl.contains(resetBtn)) {
    state.search = '';
    state.dateFilter = 'all';
    state.statusFilter = 'all';
    state.paymentFilter = 'all';
    const input = rootEl.querySelector('[data-history-search]');
    if (input) input.value = '';
    updateDynamicRegions();
    return;
  }

  const receiptBtn = target.closest('[data-action="open-receipt"]');
  if (receiptBtn && rootEl.contains(receiptBtn)) {
    const txId = receiptBtn.getAttribute('data-tx-id');
    if (txId) openTransactionReceipt(txId);
    return;
  }

  const voidBtn = target.closest('[data-action="open-void"]');
  if (voidBtn && rootEl.contains(voidBtn)) {
    const txId = voidBtn.getAttribute('data-tx-id');
    if (txId) openVoidConfirmationSheet(txId);
    return;
  }

  const cardBtn = target.closest('.tx-card[data-tx-id]');
  if (cardBtn && rootEl.contains(cardBtn)) {
    const txId = cardBtn.getAttribute('data-tx-id');
    if (!txId) return;
    state.selectedId = txId;
    updateDynamicRegions();

    if (isMobileViewport()) {
      const tx = store.getTransactionById(txId);
      if (tx) openMobileDetailSheet(tx);
    }
  }
}

function handleContainerInput(e) {
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!target.hasAttribute('data-history-search')) return;

  state.search = target.value;
  const clearBtn = rootEl?.querySelector('[data-action="clear-search"]');
  if (clearBtn) clearBtn.hidden = !state.search;

  if (debouncedSearchUpdate) {
    debouncedSearchUpdate();
  } else {
    updateDynamicRegions();
  }
}

export function initHistoryView(container) {
  if (!container) return;

  if (rootEl && rootEl !== container) {
    rootEl.removeEventListener('click', handleContainerClick);
    rootEl.removeEventListener('input', handleContainerInput);
  }

  for (const off of unsubs) {
    if (typeof off === 'function') off();
  }
  unsubs = [];

  if (viewportMq && viewportListener) {
    if (typeof viewportMq.removeEventListener === 'function') {
      viewportMq.removeEventListener('change', viewportListener);
    }
    viewportListener = null;
  }

  rootEl = container;
  debouncedSearchUpdate = debounce(() => updateDynamicRegions(), 150);

  rootEl.removeEventListener('click', handleContainerClick);
  rootEl.removeEventListener('input', handleContainerInput);
  rootEl.addEventListener('click', handleContainerClick);
  rootEl.addEventListener('input', handleContainerInput);

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    viewportMq = window.matchMedia('(max-width: 899px)');
    viewportListener = () => updateDynamicRegions();
    if (typeof viewportMq.addEventListener === 'function') {
      viewportMq.addEventListener('change', viewportListener);
    }
  }

  unsubs.push(
    bus.on('transactions:changed', (payload) => {
      if (!isMobileViewport() && payload?.action === 'create' && payload.transaction?.id) {
        state.selectedId = payload.transaction.id;
      }
      renderHistoryView();
    })
  );
  unsubs.push(
    bus.on('settings:changed', (nextSettings) => {
      const keys = nextSettings?._changedKeys;
      if (Array.isArray(keys) && keys.length > 0 && keys.every((k) => k === 'theme' || k === 'accent')) {
        return;
      }
      renderHistoryView();
    })
  );
  unsubs.push(
    bus.on('store:reset', () => {
      state.selectedId = null;
      renderHistoryView();
    })
  );

  mountShell();
  updateDynamicRegions();
}

export function renderHistoryView() {
  if (!rootEl) return;
  updateDynamicRegions();
}
