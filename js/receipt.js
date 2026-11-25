import { formatRupiah, formatDateTime, escapeHtml, formatTransactionCode } from './utils.js';
import { icon } from './icons.js';
import { toast, openSheet, closeSheet, animatedSuccessCheckSvg, animateRupiah } from './motion.js';
import { t, resolveReceiptFooter } from './i18n.js';

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

function getPaymentLabel(method) {
  if (method === 'cash') return t('payment.cash');
  if (method === 'qris') return t('payment.qris');
  if (method === 'transfer') return t('payment.transfer');
  if (method === 'ewallet') return t('payment.ewallet');
  return String(method || t('payment.cash'));
}

function isPercentDiscount(type) {
  return type === 'pct' || type === 'percent';
}

function formatPaymentDisplay(method, detail) {
  const label = getPaymentLabel(method);
  const cleanDetail = String(detail || '').trim();
  const normalizedDetail = cleanDetail.toLowerCase();
  if (
    !cleanDetail ||
    normalizedDetail === label.toLowerCase() ||
    normalizedDetail === String(method || '').toLowerCase() ||
    ((method === 'cash' || method === 'qris' || method === 'transfer') &&
      REDUNDANT_PAYMENT_DETAILS.has(normalizedDetail))
  ) {
    return label;
  }
  return `${label} (${cleanDetail})`;
}

function getLegacyOrderBadge(tx) {
  const orderType = String(tx?.legacyOrderType || tx?.orderType || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  const tableNo = String(tx?.legacyTableNumber || tx?.tableNumber || '').trim();
  if (orderType === 'dinein' || tableNo) {
    return tableNo ? t('receipt.legacyDineInTable', { table: tableNo }) : t('receipt.legacyDineIn');
  }
  if (orderType === 'takeaway') {
    return t('receipt.legacyTakeaway');
  }
  return '';
}

function normalizeReceiptItems(tx) {
  const items = Array.isArray(tx?.items) ? tx.items : [];
  return items.map((item) => {
    const price = Math.max(0, Math.round(Number(item.price) || 0));
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
    const grossTotal =
      item.grossTotal !== undefined ? Number(item.grossTotal) || 0 : price * qty;
    const discountAmount = Math.max(0, Math.round(Number(item.discountAmount) || 0));
    const netTotal =
      item.netTotal !== undefined
        ? Number(item.netTotal) || 0
        : Math.max(0, grossTotal - discountAmount);
    return {
      ...item,
      price,
      qty,
      grossTotal,
      discountAmount,
      netTotal,
      note: String(item.note ?? '').trim(),
    };
  });
}

export function renderReceiptHtml(tx, settings = {}) {
  const tData = tx || {};
  const s = settings || {};
  const items = normalizeReceiptItems(tData);

  const storeName = s.storeName || 'AruPOS';
  const storeAddress = String(s.storeAddress || '').trim();
  const storePhone = String(s.storePhone || '').trim();
  const receiptFooter = resolveReceiptFooter(s.receiptFooter);

  const receiptNo = formatTransactionCode(tData);
  const createdAt = formatDateTime(tData.createdAt);
  const legacyOrderLabel = getLegacyOrderBadge(tData);
  const customerName = String(tData.customerName || '').trim();
  const isVoid = tData.status === 'void';
  const voidReason = String(tData.voidReason || '').trim();

  const subtotal =
    items.length > 0
      ? items.reduce((sum, it) => sum + it.netTotal, 0)
      : Math.round(Number(tData.subtotal) || 0);
  const orderDiscountType = tData.orderDiscountType || 'none';
  const orderDiscountAmount =
    orderDiscountType === 'none'
      ? 0
      : Math.min(subtotal, Math.max(0, Math.round(Number(tData.orderDiscountAmount) || 0)));
  const serviceAmount = Math.max(0, Math.round(Number(tData.serviceAmount) || 0));
  const serviceRate = Number(tData.serviceRate ?? s.serviceRate) || 0;
  const serviceLabel = tData.serviceLabel || s.serviceLabel || 'Service';
  const taxAmount = Math.max(0, Math.round(Number(tData.taxAmount) || 0));
  const taxRate = Number(tData.taxRate ?? s.taxRate) || 0;
  const taxLabel = tData.taxLabel || s.taxLabel || 'PPN';
  const grandTotal =
    tData.grandTotal !== undefined
      ? Math.round(Number(tData.grandTotal) || 0)
      : Math.max(0, subtotal - orderDiscountAmount + serviceAmount + taxAmount);

  const paymentMethod = tData.paymentMethod || 'cash';
  const paymentDisplay = formatPaymentDisplay(paymentMethod, tData.paymentDetail);
  const cashReceived =
    tData.cashReceived !== undefined ? Math.round(Number(tData.cashReceived) || 0) : grandTotal;
  const changeAmount =
    tData.changeAmount !== undefined
      ? Math.max(0, Math.round(Number(tData.changeAmount) || 0))
      : Math.max(0, cashReceived - grandTotal);

  const itemsHtml = items
    .map((item) => {
      const discMeta =
        item.discountAmount > 0
          ? `<div class="receipt-row" style="font-size:0.75rem;color:#1E5C8A;">
              <span>${escapeHtml(t('receipt.itemDiscount'))}${isPercentDiscount(item.discountType) && item.discountValue ? ` (${escapeHtml(item.discountValue)}%)` : ''}</span>
              <span class="tabular-nums">-${formatRupiah(item.discountAmount)}</span>
            </div>`
          : '';
      const noteMeta = item.note
        ? `<div style="font-size:0.74rem;color:#4B5563;font-style:italic;margin-top:1px;">${escapeHtml(t('receipt.notePrefix'))}: ${escapeHtml(item.note)}</div>`
        : '';

      return `
        <div>
          <div style="font-weight:700;color:#111827;">${escapeHtml(item.name)}</div>
          <div class="receipt-row">
            <span class="tabular-nums" style="color:#4B5563;">${item.qty} x ${formatRupiah(item.price)}</span>
            <span class="tabular-nums" style="font-weight:700;">${formatRupiah(item.netTotal)}</span>
          </div>
          ${discMeta}
          ${noteMeta}
        </div>
      `;
    })
    .join('');

  const orderDiscRow =
    orderDiscountAmount > 0
      ? `<div class="receipt-row" style="color:#1E5C8A;">
          <span>${escapeHtml(t('receipt.orderDiscount'))}${isPercentDiscount(tData.orderDiscountType) && tData.orderDiscountValue ? ` (${escapeHtml(tData.orderDiscountValue)}%)` : ''}</span>
          <span class="tabular-nums">-${formatRupiah(orderDiscountAmount)}</span>
        </div>`
      : '';

  const serviceRow =
    serviceAmount > 0
      ? `<div class="receipt-row">
          <span>${escapeHtml(serviceLabel)}${serviceRate ? ` (${escapeHtml(serviceRate)}%)` : ''}</span>
          <span class="tabular-nums">${formatRupiah(serviceAmount)}</span>
        </div>`
      : '';

  const taxRow =
    taxAmount > 0
      ? `<div class="receipt-row">
          <span>${escapeHtml(taxLabel)}${taxRate ? ` (${escapeHtml(taxRate)}%)` : ''}</span>
          <span class="tabular-nums">${formatRupiah(taxAmount)}</span>
        </div>`
      : '';

  const cashRows =
    paymentMethod === 'cash'
      ? `
        <div class="receipt-row">
          <span>${escapeHtml(t('receipt.cashReceived'))}</span>
          <span class="tabular-nums">${formatRupiah(cashReceived)}</span>
        </div>
        <div class="receipt-row" style="font-weight:700;">
          <span>${escapeHtml(t('receipt.change'))}</span>
          <span class="tabular-nums">${formatRupiah(changeAmount)}</span>
        </div>
      `
      : '';

  const voidStamp = isVoid
    ? `<div class="receipt-void-stamp" role="status">VOID</div>`
    : '';

  const voidNote =
    isVoid && voidReason
      ? `<div style="margin-top:6px;padding:6px 8px;border:1px dashed #B91C1C;border-radius:6px;color:#B91C1C;font-size:0.74rem;text-align:center;">
          ${escapeHtml(t('receipt.voidedNote', { reason: voidReason }))}
        </div>`
      : '';

  return `
    <div class="receipt-paper${isVoid ? ' is-void' : ''}">
      ${voidStamp}

      <div class="receipt-header">
        <div style="font-size:1rem;font-weight:800;letter-spacing:0.02em;">${escapeHtml(storeName)}</div>
        ${storeAddress ? `<div style="font-size:0.75rem;color:#4B5563;">${escapeHtml(storeAddress)}</div>` : ''}
        ${storePhone ? `<div style="font-size:0.75rem;color:#4B5563;">${escapeHtml(t('receipt.phonePrefix', { phone: storePhone }))}</div>` : ''}
      </div>

      ${voidNote}

      <hr class="receipt-divider" />

      <div>
        <div class="receipt-row">
          <span>${escapeHtml(t('receipt.receiptNo'))}</span>
          <span class="tabular-nums">${escapeHtml(receiptNo)}</span>
        </div>
        <div class="receipt-row">
          <span>${escapeHtml(t('receipt.date'))}</span>
          <span class="tabular-nums">${escapeHtml(createdAt)}</span>
        </div>
        ${
          legacyOrderLabel
            ? `<div class="receipt-row">
                <span>${escapeHtml(t('receipt.order'))}</span>
                <span>${escapeHtml(legacyOrderLabel)}</span>
              </div>`
            : ''
        }
        ${
          customerName
            ? `<div class="receipt-row">
                <span>${escapeHtml(t('receipt.customer'))}</span>
                <span>${escapeHtml(customerName)}</span>
              </div>`
            : ''
        }
      </div>

      <hr class="receipt-divider" />

      <div class="receipt-items">
        ${itemsHtml}
      </div>

      <hr class="receipt-divider" />

      <div>
        <div class="receipt-row">
          <span>${escapeHtml(t('receipt.subtotal'))}</span>
          <span class="tabular-nums">${formatRupiah(subtotal)}</span>
        </div>
        ${orderDiscRow}
        ${serviceRow}
        ${taxRow}
        <div class="receipt-total-row">
          <span>${escapeHtml(t('receipt.total'))}</span>
          <span class="tabular-nums">${formatRupiah(grandTotal)}</span>
        </div>
      </div>

      <hr class="receipt-divider" />

      <div>
        <div class="receipt-row">
          <span>${escapeHtml(t('receipt.payment'))}</span>
          <span>${escapeHtml(paymentDisplay)}</span>
        </div>
        ${cashRows}
      </div>

      <hr class="receipt-divider" />

      <div class="receipt-footer">
        <div>${escapeHtml(receiptFooter)}</div>
        <div style="margin-top:4px;font-size:0.7rem;opacity:0.75;">AruPOS</div>
      </div>
    </div>
  `;
}

function padRow(left, right, width = 32) {
  const l = String(left ?? '');
  const r = String(right ?? '');
  const spaceCount = width - l.length - r.length;
  if (spaceCount >= 1) {
    return `${l}${' '.repeat(spaceCount)}${r}`;
  }
  return `${l} ${r}`;
}

export function formatReceiptText(tx, settings = {}) {
  const tData = tx || {};
  const s = settings || {};
  const items = normalizeReceiptItems(tData);
  const line = '-'.repeat(32);
  const dblLine = '='.repeat(32);

  const lines = [];
  const storeName = s.storeName || 'AruPOS';
  lines.push(storeName.toUpperCase());
  if (s.storeAddress) lines.push(String(s.storeAddress).trim());
  if (s.storePhone) lines.push(t('receipt.phonePrefix', { phone: String(s.storePhone).trim() }));

  if (tData.status === 'void') {
    lines.push(dblLine);
    lines.push(t('receipt.voidBanner'));
    if (tData.voidReason) lines.push(t('receipt.voidReasonLine', { reason: String(tData.voidReason).trim() }));
  }

  lines.push(dblLine);
  lines.push(padRow(t('receipt.receiptShort'), formatTransactionCode(tData)));
  lines.push(padRow(t('receipt.date'), formatDateTime(tData.createdAt)));
  const legacyOrderText = getLegacyOrderBadge(tData);
  if (legacyOrderText) {
    lines.push(padRow(t('receipt.order'), legacyOrderText));
  }
  if (tData.customerName) {
    lines.push(padRow(t('receipt.customer'), String(tData.customerName).trim()));
  }
  lines.push(line);

  for (const item of items) {
    lines.push(item.name);
    lines.push(padRow(`  ${item.qty} x ${formatRupiah(item.price)}`, formatRupiah(item.netTotal)));
    if (item.discountAmount > 0) {
      const pctSuffix =
        isPercentDiscount(item.discountType) && item.discountValue
          ? ` (${item.discountValue}%)`
          : '';
      lines.push(padRow(`  ${t('receipt.textItemDiscount')}${pctSuffix}`, `-${formatRupiah(item.discountAmount)}`));
    }
    if (item.note) {
      lines.push(`  ${t('receipt.notePrefix')}: ${item.note}`);
    }
  }

  const subtotal =
    items.length > 0
      ? items.reduce((sum, it) => sum + it.netTotal, 0)
      : Math.round(Number(tData.subtotal) || 0);
  const orderDiscountType = tData.orderDiscountType || 'none';
  const orderDiscountAmount =
    orderDiscountType === 'none'
      ? 0
      : Math.min(subtotal, Math.max(0, Math.round(Number(tData.orderDiscountAmount) || 0)));
  const serviceAmount = Math.max(0, Math.round(Number(tData.serviceAmount) || 0));
  const serviceRate = Number(tData.serviceRate ?? s.serviceRate) || 0;
  const serviceLabel = tData.serviceLabel || s.serviceLabel || 'Service';
  const taxAmount = Math.max(0, Math.round(Number(tData.taxAmount) || 0));
  const taxRate = Number(tData.taxRate ?? s.taxRate) || 0;
  const taxLabel = tData.taxLabel || s.taxLabel || 'PPN';
  const grandTotal =
    tData.grandTotal !== undefined
      ? Math.round(Number(tData.grandTotal) || 0)
      : Math.max(0, subtotal - orderDiscountAmount + serviceAmount + taxAmount);

  lines.push(line);
  lines.push(padRow(t('receipt.subtotal'), formatRupiah(subtotal)));
  if (orderDiscountAmount > 0) {
    const pctSuffix =
      isPercentDiscount(tData.orderDiscountType) && tData.orderDiscountValue
        ? ` (${tData.orderDiscountValue}%)`
        : '';
    lines.push(padRow(`${t('receipt.orderDiscount')}${pctSuffix}`, `-${formatRupiah(orderDiscountAmount)}`));
  }
  if (serviceAmount > 0) {
    lines.push(
      padRow(`${serviceLabel}${serviceRate ? ` (${serviceRate}%)` : ''}`, formatRupiah(serviceAmount))
    );
  }
  if (taxAmount > 0) {
    lines.push(padRow(`${taxLabel}${taxRate ? ` (${taxRate}%)` : ''}`, formatRupiah(taxAmount)));
  }
  lines.push(dblLine);
  lines.push(padRow(t('receipt.total'), formatRupiah(grandTotal)));
  lines.push(line);

  const paymentMethod = tData.paymentMethod || 'cash';
  lines.push(padRow(t('receipt.payShort'), formatPaymentDisplay(paymentMethod, tData.paymentDetail)));

  if (paymentMethod === 'cash') {
    const cashReceived =
      tData.cashReceived !== undefined ? Math.round(Number(tData.cashReceived) || 0) : grandTotal;
    const changeAmount =
      tData.changeAmount !== undefined
        ? Math.max(0, Math.round(Number(tData.changeAmount) || 0))
        : Math.max(0, cashReceived - grandTotal);
    lines.push(padRow(t('payment.cash'), formatRupiah(cashReceived)));
    lines.push(padRow(t('receipt.change'), formatRupiah(changeAmount)));
  }

  lines.push(line);
  lines.push(resolveReceiptFooter(s.receiptFooter));

  return lines.join('\n');
}

export function printReceipt(tx, settings = {}) {
  let printArea = document.getElementById('print-receipt-area');
  if (!printArea) {
    printArea = document.createElement('div');
    printArea.id = 'print-receipt-area';
    document.body.appendChild(printArea);
  }
  printArea.innerHTML = renderReceiptHtml(tx, settings);
  window.print();
}

function copyTextFallback(text) {
  const host = document.querySelector('#sheet-root .sheet-panel') || document.body;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.opacity = '0.01';
  host.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  host.removeChild(textarea);
  return ok;
}

export async function shareReceipt(tx, settings = {}) {
  const text = formatReceiptText(tx, settings);
  const shortCode = formatTransactionCode(tx);
  const title = t('receipt.shareTitle', {
    ref: shortCode !== '-' ? shortCode : settings?.storeName || 'AruPOS',
  });

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return { ok: true, method: 'share' };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { ok: false, aborted: true };
      }
    }
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      toast(t('receipt.copiedToast'), 'success');
      return { ok: true, method: 'clipboard' };
    }
  } catch {
    // Fall through to legacy textarea copy
  }

  const copied = copyTextFallback(text);
  if (copied) {
    toast(t('receipt.copiedToast'), 'success');
    return { ok: true, method: 'clipboard' };
  }

  toast(t('receipt.copyFailedToast'), 'error');
  return { ok: false };
}

export function openReceiptModal(
  tx,
  settings = {},
  { isPostCheckout = false, onNewTransaction } = {}
) {
  const sheetId = 'receipt-modal';
  const tData = tx || {};
  const paymentMethod = tData.paymentMethod || 'cash';
  const grandTotal = Math.round(Number(tData.grandTotal) || 0);
  const changeAmount = Math.max(0, Math.round(Number(tData.changeAmount) || 0));

  const successBannerHtml = isPostCheckout
    ? `
      <div class="kembalian-box is-ok success-banner" style="margin-top:0;margin-bottom:16px;align-items:center;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          ${animatedSuccessCheckSvg(28)}
          <div style="display:flex;flex-direction:column;gap:2px;">
            <span style="font-size:0.95rem;font-weight:800;">${escapeHtml(t('receipt.txCompleteTitle'))}</span>
            <span class="tabular-nums" style="font-size:0.8rem;opacity:0.9;">
              ${
                paymentMethod === 'cash'
                  ? escapeHtml(t('receipt.changeLabel', { amount: formatRupiah(changeAmount) }))
                  : escapeHtml(t('receipt.paidVia', { method: formatPaymentDisplay(paymentMethod, tData.paymentDetail) }))
              }
            </span>
          </div>
        </div>
        <strong class="tabular-nums" data-receipt-grand-total style="font-size:1.05rem;white-space:nowrap;">${formatRupiah(grandTotal)}</strong>
      </div>
    `
    : '';

  const contentHtml = `
    ${successBannerHtml}
    ${renderReceiptHtml(tData, settings)}
  `;

  const closeLabel = isPostCheckout ? t('receipt.btnNewTx') : t('receipt.btnClose');
  const footerHtml = `
    <button type="button" class="btn btn--outlined" data-receipt-action="print">
      ${icon('printer')}
      <span>${escapeHtml(t('receipt.btnPrint'))}</span>
    </button>
    <button type="button" class="btn btn--outlined" data-receipt-action="share">
      ${icon('share')}
      <span>${escapeHtml(t('receipt.btnShare'))}</span>
    </button>
    <button type="button" class="btn btn--primary" data-receipt-action="close">
      <span>${escapeHtml(closeLabel)}</span>
    </button>
  `;

  let callbackFired = false;
  const triggerNewTx = () => {
    if (callbackFired) return;
    callbackFired = true;
    if (typeof onNewTransaction === 'function') {
      onNewTransaction();
    }
  };

  const shortCode = formatTransactionCode(tData);

  return openSheet({
    id: sheetId,
    title: isPostCheckout
      ? t('receipt.modalTitlePost')
      : t('receipt.modalTitleView', { no: shortCode !== '-' ? shortCode : '' }).trim(),
    size: 'md',
    contentHtml,
    footerHtml,
    onMount(panelEl) {
      const bannerTotalEl = panelEl.querySelector('[data-receipt-grand-total]');
      if (bannerTotalEl && isPostCheckout) {
        bannerTotalEl.dataset.animCurrent = '0';
        animateRupiah(bannerTotalEl, grandTotal, { duration: 280, pulse: false });
      }
      const printBtn = panelEl.querySelector('[data-receipt-action="print"]');
      const shareBtn = panelEl.querySelector('[data-receipt-action="share"]');
      const closeBtn = panelEl.querySelector('[data-receipt-action="close"]');

      if (printBtn) {
        printBtn.addEventListener('click', () => {
          printReceipt(tData, settings);
        });
      }
      if (shareBtn) {
        shareBtn.addEventListener('click', () => {
          shareReceipt(tData, settings);
        });
      }
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          closeSheet(sheetId);
          triggerNewTx();
        });
      }
    },
    onClose() {
      triggerNewTx();
    },
  });
}
