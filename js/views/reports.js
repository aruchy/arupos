import {
  formatRupiah,
  formatCompactRupiah,
  formatDateShort,
  getLocalDateKey,
  isSameLocalDay,
  escapeHtml,
  bus,
} from '../utils.js';
import { icon, categoryIcon } from '../icons.js';
import { store } from '../store.js';
import { animateRupiah, animateNumber, prefersReducedMotion, toast } from '../motion.js';
import {
  t,
  getLanguage,
  getDaysShort,
  getDaysLong,
  getMonthsShort,
  getLocale,
} from '../i18n.js';

function getPaymentMethodsConfig() {
  return [
    { key: 'cash', label: t('payment.cash'), icon: 'cash', barColor: 'var(--success)' },
    { key: 'qris', label: t('payment.qris'), icon: 'qris', barColor: 'var(--primary)' },
    { key: 'transfer', label: t('payment.transferShort'), icon: 'bank', barColor: 'var(--info)' },
    { key: 'ewallet', label: t('payment.ewallet'), icon: 'wallet', barColor: 'var(--warning)' },
  ];
}

const state = {
  selectedDayKey: null,
  periodTab: 'today', // 'today' | '7days'
};

let rootEl = null;
let unsubs = [];
let lastDaysCache = [];

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

function isTxCompleted(tx) {
  return String(tx?.status || '').toLowerCase() === 'completed';
}

function isTxVoid(tx) {
  const status = String(tx?.status || '').toLowerCase();
  return status === 'void' || status === 'voided';
}

function getTxTimestamp(tx) {
  return tx?.createdAt || tx?.timestamp || tx?.date || '';
}

function getItemQty(item) {
  return Math.max(0, Math.round(Number(item?.qty ?? item?.quantity ?? 0) || 0));
}

function getItemNetTotal(item) {
  if (item?.netTotal !== undefined && Number.isFinite(Number(item.netTotal))) {
    return Math.max(0, Math.round(Number(item.netTotal)));
  }
  const price = Math.max(0, Math.round(Number(item?.price ?? item?.unitPrice ?? 0) || 0));
  const disc = Math.max(0, Math.round(Number(item?.discountAmount ?? 0) || 0));
  return Math.max(0, price * getItemQty(item) - disc);
}

function getTxGrandTotal(tx) {
  if (tx?.grandTotal !== undefined && Number.isFinite(Number(tx.grandTotal))) {
    return Math.max(0, Math.round(Number(tx.grandTotal)));
  }
  const items = Array.isArray(tx?.items) ? tx.items : [];
  return items.reduce((sum, item) => sum + getItemNetTotal(item), 0);
}

function getTxItemsSold(tx) {
  const items = Array.isArray(tx?.items) ? tx.items : [];
  return items.reduce((sum, item) => sum + getItemQty(item), 0);
}

function formatFullLocalDate(date) {
  const daysLong = getDaysLong();
  const months = getMonthsShort();
  if (getLanguage() === 'en') {
    return `${daysLong[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }
  return `${daysLong[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function formatShortLocalDateWithDay(date) {
  const daysShort = getDaysShort();
  if (getLanguage() === 'en') {
    return `${daysShort[date.getDay()]}, ${formatDateShort(date)}, ${date.getFullYear()}`;
  }
  return `${daysShort[date.getDay()]}, ${formatDateShort(date)} ${date.getFullYear()}`;
}

function computeNiceAxisMax(maxVal) {
  if (!maxVal || maxVal <= 0) return 100000;
  const rawStep = maxVal / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let niceUnit = 1;
  if (normalized <= 1) niceUnit = 1;
  else if (normalized <= 2) niceUnit = 2;
  else if (normalized <= 2.5) niceUnit = 2.5;
  else if (normalized <= 5) niceUnit = 5;
  else niceUnit = 10;
  return Math.ceil(niceUnit * magnitude * 4);
}

function buildReportData() {
  const now = new Date();
  const todayKey = getLocalDateKey(now);
  const allTxs = store.getTransactions();
  const txs = Array.isArray(allTxs) ? allTxs : [];
  const daysShort = getDaysShort();

  const days = [];
  const dayMap = new Map();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = getLocalDateKey(d);
    const entry = {
      key,
      date: d,
      dayShort: daysShort[d.getDay()],
      dateShort: formatDateShort(d),
      fullDateLabel: formatShortLocalDateWithDay(d),
      isToday: offset === 0,
      revenue: 0,
      txCount: 0,
      voidCount: 0,
      itemsSold: 0,
    };
    days.push(entry);
    dayMap.set(key, entry);
  }

  let todayRevenue = 0;
  let todayTxCount = 0;
  let todayVoidCount = 0;
  let todayItemsSold = 0;

  const todayCompletedTxs = [];
  const weekCompletedTxs = [];
  let weekVoidCount = 0;

  for (const tx of txs) {
    const ts = getTxTimestamp(tx);
    const txKey = getLocalDateKey(ts);
    const inToday = isSameLocalDay(ts, now);
    const dayEntry = txKey ? dayMap.get(txKey) : null;
    const completed = isTxCompleted(tx);
    const voided = isTxVoid(tx);

    if (inToday) {
      if (completed) {
        const total = getTxGrandTotal(tx);
        const qty = getTxItemsSold(tx);
        todayRevenue += total;
        todayTxCount += 1;
        todayItemsSold += qty;
        todayCompletedTxs.push(tx);
      } else if (voided) {
        todayVoidCount += 1;
      }
    }

    if (dayEntry) {
      if (completed) {
        const total = getTxGrandTotal(tx);
        const qty = getTxItemsSold(tx);
        dayEntry.revenue += total;
        dayEntry.txCount += 1;
        dayEntry.itemsSold += qty;
        weekCompletedTxs.push(tx);
      } else if (voided) {
        dayEntry.voidCount += 1;
        weekVoidCount += 1;
      }
    }
  }

  const avgTx = todayTxCount > 0 ? Math.round(todayRevenue / todayTxCount) : 0;
  const weekTotalRevenue = days.reduce((sum, d) => sum + d.revenue, 0);
  const weekTotalTxCount = days.reduce((sum, d) => sum + d.txCount, 0);

  return {
    now,
    todayKey,
    todayLabel: formatFullLocalDate(now),
    todayRevenue,
    todayTxCount,
    todayVoidCount,
    avgTx,
    todayItemsSold,
    days,
    weekTotalRevenue,
    weekTotalTxCount,
    weekVoidCount,
    todayCompletedTxs,
    weekCompletedTxs,
  };
}

function aggregateTopProducts(completedTxs, limit = 8) {
  const map = new Map();
  const fallbackProduct = t('common.product');

  for (const tx of completedTxs) {
    const items = Array.isArray(tx.items) ? tx.items : [];
    for (const item of items) {
      const name = String(item?.name || fallbackProduct).trim() || fallbackProduct;
      const key = String(item?.productId || item?.id || name.toLowerCase());
      const qty = getItemQty(item);
      const revenue = getItemNetTotal(item);
      if (qty <= 0) continue;

      let row = map.get(key);
      if (!row) {
        row = {
          key,
          productId: item?.productId || '',
          name,
          emoji: String(item?.emoji || '').trim(),
          qtySold: 0,
          revenue: 0,
        };
        map.set(key, row);
      }
      row.qtySold += qty;
      row.revenue += revenue;
      if (!row.emoji && item?.emoji) {
        row.emoji = String(item.emoji).trim();
      }
    }
  }

  const locale = getLocale();
  return [...map.values()]
    .sort((a, b) => {
      if (b.qtySold !== a.qtySold) return b.qtySold - a.qtySold;
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      return a.name.localeCompare(b.name, locale);
    })
    .slice(0, limit);
}

function aggregatePaymentMethods(completedTxs) {
  const buckets = new Map();
  for (const pm of getPaymentMethodsConfig()) {
    buckets.set(pm.key, {
      ...pm,
      count: 0,
      total: 0,
      sharePct: 0,
    });
  }

  let grandRevenue = 0;
  let grandCount = 0;

  for (const tx of completedTxs) {
    const method = normalizePaymentMethod(tx?.paymentMethod ?? 'cash');
    const bucket = buckets.get(method) || buckets.get('cash');
    const total = getTxGrandTotal(tx);
    bucket.count += 1;
    bucket.total += total;
    grandRevenue += total;
    grandCount += 1;
  }

  const rows = [...buckets.values()].map((row) => {
    const pct =
      grandRevenue > 0
        ? Math.round((row.total / grandRevenue) * 100)
        : grandCount > 0
          ? Math.round((row.count / grandCount) * 100)
          : 0;
    return { ...row, sharePct: pct };
  });

  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return b.count - a.count;
  });

  return { rows, grandRevenue, grandCount };
}

function renderChartDayDetailHtml(day) {
  if (!day) return '';
  const heading = day.isToday
    ? t('reports.dayDetailTodayHeading', { date: day.fullDateLabel })
    : day.fullDateLabel;
  return `
    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
      <span class="badge ${day.isToday ? 'badge--primary' : 'badge--muted'}">${escapeHtml(day.isToday ? t('reports.dayDetailTodayBadge') : t('reports.dayDetailSelectedBadge'))}</span>
      <strong style="color: var(--text-primary);">${escapeHtml(heading)}</strong>
    </div>
    <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
      <span>${escapeHtml(t('reports.dayDetailRevenue'))} <strong class="tabular-nums" style="color: var(--primary);">${escapeHtml(formatRupiah(day.revenue))}</strong></span>
      <span>${escapeHtml(t('reports.dayDetailTx'))} <strong class="tabular-nums" style="color: var(--text-primary);">${day.txCount}</strong></span>
      ${
        day.voidCount > 0
          ? `<span class="badge badge--warning tabular-nums">${escapeHtml(t('history.summaryVoid', { count: day.voidCount }))}</span>`
          : ''
      }
    </div>
  `;
}

function renderSevenDayChartSvg(days, selectedKey) {
  const width = 640;
  const height = 246;
  const padLeft = 72;
  const padRight = 18;
  const padTop = 26;
  const padBottom = 48;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxRevenue = Math.max(0, ...days.map((d) => d.revenue));
  const axisMax = computeNiceAxisMax(maxRevenue);

  const gridLines = [];
  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const val = Math.round(axisMax * (1 - ratio));
    const y = padTop + plotH * ratio;
    gridLines.push(`
      <g>
        <line
          x1="${padLeft}"
          y1="${y.toFixed(1)}"
          x2="${width - padRight}"
          y2="${y.toFixed(1)}"
          stroke="var(--border-subtle)"
          stroke-width="1"
          ${i === 4 ? '' : 'stroke-dasharray="4 4"'}
        />
        <text
          x="${padLeft - 10}"
          y="${(y + 4).toFixed(1)}"
          text-anchor="end"
          fill="var(--text-muted)"
          font-size="11"
          style="font-variant-numeric: tabular-nums;"
        >${escapeHtml(formatCompactRupiah(val))}</text>
      </g>
    `);
  }

  const slotW = plotW / days.length;
  const barW = Math.min(46, Math.max(24, slotW * 0.54));

  const barsHtml = days
    .map((day, idx) => {
      const slotX = padLeft + idx * slotW;
      const barX = slotX + (slotW - barW) / 2;
      const centerX = slotX + slotW / 2;
      const rawH = axisMax > 0 ? (day.revenue / axisMax) * plotH : 0;
      const barH = day.revenue > 0 ? Math.max(8, rawH) : 4;
      const barY = padTop + plotH - barH;
      const isSelected = day.key === selectedKey;

      const ariaLabel = t('reports.chartBarAria', {
        date: day.fullDateLabel,
        revenue: formatRupiah(day.revenue),
        count: day.txCount,
      });

      return `
        <g
          class="chart-bar-group${day.isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}"
          data-day-key="${escapeHtml(day.key)}"
          tabindex="0"
          role="button"
          aria-pressed="${isSelected ? 'true' : 'false'}"
          aria-label="${escapeHtml(ariaLabel)}"
        >
          <rect
            x="${slotX.toFixed(1)}"
            y="${padTop - 10}"
            width="${slotW.toFixed(1)}"
            height="${(plotH + padBottom + 6).toFixed(1)}"
            fill="transparent"
          />
          <rect
            x="${barX.toFixed(1)}"
            y="${barY.toFixed(1)}"
            width="${barW.toFixed(1)}"
            height="${barH.toFixed(1)}"
            rx="7"
            ry="7"
            class="chart-bar${isSelected ? ' is-selected' : ''}${day.revenue === 0 ? ' is-zero' : ''}"
            style="animation-delay: ${idx * 28}ms;${day.revenue === 0 ? ' fill: var(--border-strong); opacity: 0.45;' : ''}"
          />
          ${
            day.revenue > 0
              ? `
            <text
              x="${centerX.toFixed(1)}"
              y="${Math.max(14, barY - 7).toFixed(1)}"
              text-anchor="middle"
              class="aru-bar-val"
              fill="${isSelected ? 'var(--text-primary)' : 'var(--text-muted)'}"
              font-size="10.5"
              font-weight="${isSelected ? '700' : '600'}"
              opacity="${isSelected ? '1' : '0.82'}"
              style="font-variant-numeric: tabular-nums; pointer-events: none;"
            >${escapeHtml(formatCompactRupiah(day.revenue))}</text>
          `
              : ''
          }
          <text
            x="${centerX.toFixed(1)}"
            y="${(padTop + plotH + 20).toFixed(1)}"
            text-anchor="middle"
            class="aru-x-day"
            fill="${isSelected || day.isToday ? 'var(--primary)' : 'var(--text-secondary)'}"
            font-size="12"
            font-weight="${isSelected || day.isToday ? '700' : '600'}"
          >${escapeHtml(day.dayShort)}</text>
          <text
            x="${centerX.toFixed(1)}"
            y="${(padTop + plotH + 36).toFixed(1)}"
            text-anchor="middle"
            fill="var(--text-muted)"
            font-size="10.5"
            style="font-variant-numeric: tabular-nums;"
          >${escapeHtml(day.dateShort)}</text>
        </g>
      `;
    })
    .join('');

  return `
    <svg
      viewBox="0 0 ${width} ${height}"
      role="img"
      aria-label="${escapeHtml(t('reports.chartAria'))}"
    >
      ${gridLines.join('')}
      ${barsHtml}
    </svg>
  `;
}

function renderTopProductsHtml(completedTxs, periodLabelLower) {
  const topProducts = aggregateTopProducts(completedTxs, 8);
  if (topProducts.length === 0) {
    return `
      <div class="empty-state" style="padding: 24px 12px;">
        <div class="empty-icon">${icon('reports')}</div>
        <h4 class="empty-title">${escapeHtml(t('reports.topProductsEmptyTitle', { period: periodLabelLower }))}</h4>
        <p class="empty-desc">${escapeHtml(t('reports.topProductsEmptyDesc'))}</p>
      </div>
    `;
  }

  const maxQty = Math.max(1, topProducts[0].qtySold);
  const catMap = new Map((store.getCategories() || []).map((c) => [c.id, c]));

  return `
    <div class="top-products-list">
      ${topProducts
        .map((item, idx) => {
          const rank = idx + 1;
          const pct = Math.max(6, Math.round((item.qtySold / maxQty) * 100));
          const rankBadgeClass = rank === 1 ? 'badge--primary' : rank <= 3 ? 'badge--success' : 'badge--muted';
          const product = item.productId ? store.getProductById(item.productId) : null;
          const cat = product?.categoryId ? catMap.get(product.categoryId) : null;
          return `
            <div class="top-product-row">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                  <span class="badge ${rankBadgeClass} tabular-nums">#${rank}</span>
                  <span class="inline-cat-icon" aria-hidden="true">${categoryIcon(cat)}</span>
                  <span style="font-weight: 700; font-size: 0.9rem; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${escapeHtml(item.name)}
                  </span>
                </div>
                <div class="tabular-nums" style="display: flex; align-items: center; gap: 10px; flex-shrink: 0; font-size: 0.84rem;">
                  <span style="color: var(--text-muted); font-weight: 600;">${escapeHtml(t('reports.soldQty', { qty: item.qtySold }))}</span>
                  <strong style="color: var(--text-primary);">${escapeHtml(formatRupiah(item.revenue))}</strong>
                </div>
              </div>
              <div class="progress-bar-track" aria-hidden="true">
                <div class="progress-bar-fill" data-progress-bar style="width: ${pct}%; transition-delay: ${Math.min(idx, 6) * 28}ms;"></div>
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderPaymentBreakdownHtml(completedTxs, periodLabelLower) {
  const { rows, grandCount } = aggregatePaymentMethods(completedTxs);

  if (grandCount === 0) {
    return `
      <div class="empty-state" style="padding: 24px 12px;">
        <div class="empty-icon">${icon('wallet')}</div>
        <h4 class="empty-title">${escapeHtml(t('reports.paymentEmptyTitle', { period: periodLabelLower }))}</h4>
        <p class="empty-desc">${escapeHtml(t('reports.paymentEmptyDesc'))}</p>
      </div>
    `;
  }

  return `
    <div class="payment-breakdown-list">
      ${rows
        .map((row, idx) => {
          const pct = Math.max(0, Math.min(100, row.sharePct));
          return `
            <div class="top-product-row" style="${row.count === 0 ? 'opacity: 0.56;' : ''}">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                  <span style="width: 34px; height: 34px; border-radius: var(--radius-sm); background: var(--bg-surface-2); color: var(--text-primary); display: grid; place-items: center; flex-shrink: 0;">
                    ${icon(row.icon)}
                  </span>
                  <div style="min-width: 0;">
                    <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-primary);">${escapeHtml(row.label)}</div>
                    <div class="tabular-nums" style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(t('reports.paymentRowSub', { count: row.count, pct }))}</div>
                  </div>
                </div>
                <strong class="tabular-nums" style="font-size: 0.92rem; color: var(--text-primary); white-space: nowrap;">
                  ${escapeHtml(formatRupiah(row.total))}
                </strong>
              </div>
              <div class="progress-bar-track" aria-hidden="true">
                <div
                  class="progress-bar-fill"
                  data-progress-bar
                  style="width: ${pct}%; background: ${row.barColor}; transition-delay: ${Math.min(idx, 6) * 28}ms;"
                ></div>
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function animateProgressBars(container) {
  if (!container) return;
  const fills = container.querySelectorAll('.progress-bar-fill[data-progress-bar]');
  if (fills.length === 0) return;

  if (prefersReducedMotion()) {
    fills.forEach((el) => el.classList.add('is-ready'));
    return;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fills.forEach((el) => el.classList.add('is-ready'));
    });
  });
}

function selectChartDay(dayKey) {
  if (!rootEl || !dayKey) return;
  const day = lastDaysCache.find((d) => d.key === dayKey);
  if (!day) return;

  state.selectedDayKey = dayKey;

  const detailEl = rootEl.querySelector('.chart-day-detail');
  if (detailEl) {
    detailEl.innerHTML = renderChartDayDetailHtml(day);
  }

  rootEl.querySelectorAll('.chart-bar-group[data-day-key]').forEach((group) => {
    const key = group.getAttribute('data-day-key');
    const active = key === dayKey;
    const isToday = group.classList.contains('is-today');
    group.classList.toggle('is-selected', active);
    group.setAttribute('aria-pressed', active ? 'true' : 'false');

    const barRect = group.querySelector('.chart-bar');
    if (barRect) barRect.classList.toggle('is-selected', active);

    const valText = group.querySelector('.aru-bar-val');
    if (valText) {
      valText.setAttribute('fill', active ? 'var(--text-primary)' : 'var(--text-muted)');
      valText.setAttribute('font-weight', active ? '700' : '600');
      valText.setAttribute('opacity', active ? '1' : '0.82');
    }

    const dayText = group.querySelector('.aru-x-day');
    if (dayText) {
      dayText.setAttribute('fill', active || isToday ? 'var(--primary)' : 'var(--text-secondary)');
      dayText.setAttribute('font-weight', active || isToday ? '700' : '600');
    }
  });
}

function handleContainerClick(e) {
  const target = e.target;
  if (!(target instanceof Element)) return;

  const refreshBtn = target.closest('[data-action="refresh-reports"]');
  if (refreshBtn && rootEl.contains(refreshBtn)) {
    renderReportsView();
    toast(t('reports.refreshedToast'), 'info', 1800);
    return;
  }

  const periodBtn = target.closest('[data-period-tab]');
  if (periodBtn && rootEl.contains(periodBtn)) {
    const nextTab = periodBtn.getAttribute('data-period-tab');
    if (nextTab === 'today' || nextTab === '7days') {
      if (state.periodTab !== nextTab) {
        state.periodTab = nextTab;
        renderPeriodSection();
      }
    }
    return;
  }

  const barGroup = target.closest('.chart-bar-group[data-day-key]');
  if (barGroup && rootEl.contains(barGroup)) {
    const dayKey = barGroup.getAttribute('data-day-key');
    if (dayKey) selectChartDay(dayKey);
  }
}

function handleContainerPointerOver(e) {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  const target = e.target;
  if (!(target instanceof Element)) return;
  const barGroup = target.closest('.chart-bar-group[data-day-key]');
  if (barGroup && rootEl.contains(barGroup)) {
    const dayKey = barGroup.getAttribute('data-day-key');
    if (dayKey && dayKey !== state.selectedDayKey) {
      selectChartDay(dayKey);
    }
  }
}

function handleContainerFocusIn(e) {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const barGroup = target.closest('.chart-bar-group[data-day-key]');
  if (barGroup && rootEl.contains(barGroup)) {
    const dayKey = barGroup.getAttribute('data-day-key');
    if (dayKey) selectChartDay(dayKey);
  }
}

function handleContainerKeyDown(e) {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const barGroup = target.closest('.chart-bar-group[data-day-key]');
  if (!barGroup || !rootEl.contains(barGroup)) return;

  const key = barGroup.getAttribute('data-day-key');
  const idx = lastDaysCache.findIndex((d) => d.key === key);
  if (idx === -1) return;

  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectChartDay(key);
    return;
  }

  if (e.key === 'ArrowLeft' && idx > 0) {
    e.preventDefault();
    const prevKey = lastDaysCache[idx - 1].key;
    selectChartDay(prevKey);
    const prevEl = rootEl.querySelector(`.chart-bar-group[data-day-key="${prevKey}"]`);
    if (prevEl && typeof prevEl.focus === 'function') prevEl.focus();
  } else if (e.key === 'ArrowRight' && idx < lastDaysCache.length - 1) {
    e.preventDefault();
    const nextKey = lastDaysCache[idx + 1].key;
    selectChartDay(nextKey);
    const nextEl = rootEl.querySelector(`.chart-bar-group[data-day-key="${nextKey}"]`);
    if (nextEl && typeof nextEl.focus === 'function') nextEl.focus();
  }
}

function renderPeriodSection(reportData = null) {
  if (!rootEl) return;
  const data = reportData || buildReportData();
  const isTodayTab = state.periodTab === 'today';
  const periodTxs = isTodayTab ? data.todayCompletedTxs : data.weekCompletedTxs;
  const periodLabelLower = isTodayTab ? t('reports.periodTodayLower') : t('reports.period7DaysLower');
  const periodVoidCount = isTodayTab ? data.todayVoidCount : data.weekVoidCount;

  rootEl.querySelectorAll('[data-period-tab]').forEach((btn) => {
    const active = btn.getAttribute('data-period-tab') === state.periodTab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const periodNoteEl = rootEl.querySelector('[data-period-void-note]');
  if (periodNoteEl) {
    if (periodVoidCount > 0) {
      periodNoteEl.textContent = t('reports.periodVoidNote', { count: periodVoidCount });
      periodNoteEl.hidden = false;
    } else {
      periodNoteEl.textContent = '';
      periodNoteEl.hidden = true;
    }
  }

  const topProductsEl = rootEl.querySelector('[data-top-products]');
  if (topProductsEl) {
    topProductsEl.innerHTML = renderTopProductsHtml(periodTxs, periodLabelLower);
    animateProgressBars(topProductsEl);
  }

  const paymentEl = rootEl.querySelector('[data-payment-breakdown]');
  if (paymentEl) {
    paymentEl.innerHTML = renderPaymentBreakdownHtml(periodTxs, periodLabelLower);
    animateProgressBars(paymentEl);
  }
}

export function initReportsView(container) {
  if (!container) return;

  if (rootEl && rootEl !== container) {
    rootEl.removeEventListener('click', handleContainerClick);
    rootEl.removeEventListener('pointerover', handleContainerPointerOver);
    rootEl.removeEventListener('focusin', handleContainerFocusIn);
    rootEl.removeEventListener('keydown', handleContainerKeyDown);
  }

  for (const off of unsubs) {
    if (typeof off === 'function') off();
  }
  unsubs = [];

  rootEl = container;

  rootEl.removeEventListener('click', handleContainerClick);
  rootEl.removeEventListener('pointerover', handleContainerPointerOver);
  rootEl.removeEventListener('focusin', handleContainerFocusIn);
  rootEl.removeEventListener('keydown', handleContainerKeyDown);

  rootEl.addEventListener('click', handleContainerClick);
  rootEl.addEventListener('pointerover', handleContainerPointerOver);
  rootEl.addEventListener('focusin', handleContainerFocusIn);
  rootEl.addEventListener('keydown', handleContainerKeyDown);

  unsubs.push(bus.on('transactions:changed', () => renderReportsView()));
  unsubs.push(
    bus.on('settings:changed', (nextSettings) => {
      const keys = nextSettings?._changedKeys;
      if (
        Array.isArray(keys) &&
        keys.length > 0 &&
        keys.every((k) => k === 'theme' || k === 'accent' || k === 'productView')
      ) {
        return;
      }
      renderReportsView();
    })
  );
  unsubs.push(
    bus.on('store:reset', () => {
      state.selectedDayKey = null;
      renderReportsView();
    })
  );

  renderReportsView();
}

export function renderReportsView() {
  if (!rootEl) return;

  const data = buildReportData();
  lastDaysCache = data.days;

  const hasSelectedDay = data.days.some((d) => d.key === state.selectedDayKey);
  if (!hasSelectedDay) {
    state.selectedDayKey = data.todayKey;
  }

  const selectedDay = data.days.find((d) => d.key === state.selectedDayKey) || data.days[data.days.length - 1];

  rootEl.innerHTML = `
    <div class="reports-view">
      <header class="view-header">
        <div>
          <h1 class="view-title">${escapeHtml(t('reports.title'))}</h1>
          <p class="view-subtitle">
            ${escapeHtml(data.todayLabel)}${data.todayVoidCount > 0 ? ` · ${escapeHtml(t('reports.todayVoidExcluded', { count: data.todayVoidCount }))}` : ''}
          </p>
        </div>
        <div class="view-actions">
          <button type="button" class="btn btn--outlined" data-action="refresh-reports">
            ${icon('refresh')}
            <span>${escapeHtml(t('reports.refresh'))}</span>
          </button>
        </div>
      </header>

      <section aria-label="${escapeHtml(t('reports.todaySectionAria'))}">
        <div class="kpi-grid">
          <article class="kpi-card kpi-card--animated" style="--stagger-i: 0;">
            <div class="kpi-label">${escapeHtml(t('reports.kpiRevenueTitle'))}</div>
            <div class="kpi-value tabular-nums" data-kpi="revenue">${escapeHtml(formatRupiah(data.todayRevenue))}</div>
            <div class="kpi-sub">${escapeHtml(t('reports.kpiRevenueSub'))}</div>
          </article>

          <article class="kpi-card kpi-card--animated" style="--stagger-i: 1;">
            <div class="kpi-label">${escapeHtml(t('reports.kpiTxTitle'))}</div>
            <div class="kpi-value tabular-nums" data-kpi="txCount">${data.todayTxCount}</div>
            <div class="kpi-sub" style="${data.todayVoidCount > 0 ? 'color: var(--warning);' : ''}">
              ${
                data.todayVoidCount > 0
                  ? escapeHtml(t('reports.kpiTxSubVoid', { count: data.todayVoidCount }))
                  : escapeHtml(t('reports.kpiTxSubOk'))
              }
            </div>
          </article>

          <article class="kpi-card kpi-card--animated" style="--stagger-i: 2;">
            <div class="kpi-label">${escapeHtml(t('reports.kpiAvgTitle'))}</div>
            <div class="kpi-value tabular-nums" data-kpi="avgTx">${escapeHtml(formatRupiah(data.avgTx))}</div>
            <div class="kpi-sub">${escapeHtml(t('reports.kpiAvgSub'))}</div>
          </article>

          <article class="kpi-card kpi-card--animated" style="--stagger-i: 3;">
            <div class="kpi-label">${escapeHtml(t('reports.kpiItemsTitle'))}</div>
            <div class="kpi-value tabular-nums" data-kpi="itemsSold">${data.todayItemsSold}</div>
            <div class="kpi-sub">${escapeHtml(t('reports.kpiItemsSub'))}</div>
          </article>
        </div>
      </section>

      <div class="reports-grid">
        <section class="chart-card" aria-label="${escapeHtml(t('reports.chartAria'))}">
          <div style="display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px;">
            <div>
              <h2 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--text-primary);">${escapeHtml(t('reports.chartTitle'))}</h2>
              <p style="margin: 2px 0 0; font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(t('reports.chartHint'))}</p>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(t('reports.chartWeekTotal'))}</div>
              <div class="tabular-nums" style="font-size: 1rem; font-weight: 800; color: var(--primary);">
                ${escapeHtml(formatRupiah(data.weekTotalRevenue))}
              </div>
              <div class="tabular-nums" style="font-size: 0.76rem; color: var(--text-muted);">
                ${escapeHtml(t('reports.chartWeekTx', { count: data.weekTotalTxCount }))}
              </div>
            </div>
          </div>

          <div class="chart-svg-wrap">
            ${renderSevenDayChartSvg(data.days, selectedDay.key)}
          </div>

          <div class="chart-day-detail" aria-live="polite">
            ${renderChartDayDetailHtml(selectedDay)}
          </div>
        </section>

        <div style="grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 4px;">
          <div>
            <h2 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--text-primary);">${escapeHtml(t('reports.periodHeading'))}</h2>
            <p data-period-void-note hidden style="margin: 2px 0 0; font-size: 0.8rem; color: var(--warning);"></p>
          </div>
          <div class="seg-control" role="tablist" aria-label="${escapeHtml(t('reports.periodAria'))}">
            <button
              type="button"
              role="tab"
              class="seg-btn${state.periodTab === 'today' ? ' is-active' : ''}"
              data-period-tab="today"
              aria-selected="${state.periodTab === 'today' ? 'true' : 'false'}"
            >
              ${escapeHtml(t('reports.periodToday'))}
            </button>
            <button
              type="button"
              role="tab"
              class="seg-btn${state.periodTab === '7days' ? ' is-active' : ''}"
              data-period-tab="7days"
              aria-selected="${state.periodTab === '7days' ? 'true' : 'false'}"
            >
              ${escapeHtml(t('reports.period7Days'))}
            </button>
          </div>
        </div>

        <article class="card">
          <div style="margin-bottom: 14px;">
            <h3 style="margin: 0; font-size: 0.98rem; font-weight: 800; color: var(--text-primary);">${escapeHtml(t('reports.topProductsTitle'))}</h3>
            <p style="margin: 2px 0 0; font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(t('reports.topProductsSub'))}</p>
          </div>
          <div data-top-products></div>
        </article>

        <article class="card">
          <div style="margin-bottom: 14px;">
            <h3 style="margin: 0; font-size: 0.98rem; font-weight: 800; color: var(--text-primary);">${escapeHtml(t('reports.paymentTitle'))}</h3>
            <p style="margin: 2px 0 0; font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(t('reports.paymentSub'))}</p>
          </div>
          <div data-payment-breakdown></div>
        </article>
      </div>
    </div>
  `;

  const revEl = rootEl.querySelector('[data-kpi="revenue"]');
  const txEl = rootEl.querySelector('[data-kpi="txCount"]');
  const avgEl = rootEl.querySelector('[data-kpi="avgTx"]');
  const itemsEl = rootEl.querySelector('[data-kpi="itemsSold"]');

  if (revEl) animateRupiah(revEl, data.todayRevenue);
  if (txEl) animateNumber(txEl, data.todayTxCount);
  if (avgEl) animateRupiah(avgEl, data.avgTx);
  if (itemsEl) animateNumber(itemsEl, data.todayItemsSold);

  renderPeriodSection(data);
}
