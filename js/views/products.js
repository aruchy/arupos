import { store } from '../store.js';
import {
  formatRupiah,
  parseRupiahInput,
  escapeHtml,
  clamp,
  debounce,
  compressImageFile,
  bus,
} from '../utils.js';
import { icon, categoryIcon, getCategoryIconName, CATEGORY_ICON_OPTIONS } from '../icons.js';
import {
  toast,
  openSheet,
  closeSheet,
  confirmDialog,
  popElement,
} from '../motion.js';
import { t } from '../i18n.js';

const CATEGORY_COLORS = [
  '#0EA5E9',
  '#D97706',
  '#DB2777',
  '#7C3AED',
  '#0D9488',
  '#2563EB',
  '#EA580C',
  '#65A30D',
];

function getNextCategoryColor(categories) {
  const list = Array.isArray(categories) ? categories : [];
  const used = new Set(list.map((c) => String(c?.color || '').toLowerCase()));
  const available = CATEGORY_COLORS.find((col) => !used.has(col.toLowerCase()));
  return available || CATEGORY_COLORS[list.length % CATEGORY_COLORS.length];
}

const LOW_STOCK_THRESHOLD = 5;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const PRODUCT_SHEET_ID = 'arupos-product-form-sheet';
const CATEGORY_SHEET_ID = 'arupos-categories-sheet';

const viewState = {
  container: null,
  searchQuery: '',
  activeFilter: 'all', // 'all' | 'low' | 'out' | categoryId
  unsubscribers: [],
  boundClickHandler: null,
  boundInputHandler: null,
  lastPopProductId: null,
};

function safeColor(color) {
  return typeof color === 'string' && HEX_COLOR_RE.test(color.trim())
    ? color.trim()
    : '#0EA5E9';
}

function isSafeDataImage(src) {
  return typeof src === 'string' && src.startsWith('data:image/');
}

function injectMinimalHelperStyles() {
  if (document.getElementById('arupos-products-helper-styles')) return;
  const style = document.createElement('style');
  style.id = 'arupos-products-helper-styles';
  style.textContent = `
    .kpi-card.is-filter-active {
      border-color: var(--primary);
      background: var(--primary-container);
      box-shadow: 0 0 0 2px var(--focus-ring), var(--shadow-sm);
    }
    .kpi-card.is-filter-active .kpi-label,
    .kpi-card.is-filter-active .kpi-value,
    .kpi-card.is-filter-active .kpi-sub {
      color: var(--on-primary-container);
    }
    .products-manage-card-wrap {
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
      padding: 14px;
    }
    .products-manage-card-wrap.is-inactive {
      opacity: 0.65;
    }
    .products-manage-top {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .products-manage-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid var(--border-subtle);
      flex-wrap: wrap;
    }
    .products-cat-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      display: inline-block;
      flex-shrink: 0;
    }
    .products-sku-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .products-sku-row .input {
      flex: 1;
      min-width: 0;
    }
    .products-cat-item {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px 14px;
      border-radius: var(--radius-md);
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
    }
    .products-cat-item-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .products-cat-edit-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border-subtle);
    }
  `;
  document.head.appendChild(style);
}

function generateAutoSku(categoryId) {
  const categories = store.getCategories();
  const products = store.getProducts();
  const cat = categories.find((c) => c.id === categoryId);
  const rawPrefix = (cat ? cat.name : 'PRD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 3);
  const prefix = (rawPrefix || 'PRD').padEnd(3, 'X');

  const existingSkus = new Set(products.map((p) => String(p.sku || '').toUpperCase()));
  let num = 1;
  while (num < 999) {
    const candidate = `${prefix}-${String(num).padStart(3, '0')}`;
    if (!existingSkus.has(candidate)) return candidate;
    num += 1;
  }
  return `${prefix}-${Date.now().toString().slice(-3)}`;
}

function getStockBadgeHtml(stock) {
  if (stock <= 0) {
    return `<span class="badge badge--danger">${escapeHtml(t('products.badgeOut'))}</span>`;
  }
  if (stock <= LOW_STOCK_THRESHOLD) {
    return `<span class="badge badge--warning">${escapeHtml(t('products.badgeLow', { stock }))}</span>`;
  }
  return `<span class="badge badge--success">${escapeHtml(t('products.badgeOk', { stock }))}</span>`;
}

function renderShell(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title" data-slot="products-title">${escapeHtml(t('products.title'))}</h1>
        <p class="view-subtitle" data-slot="stock-subtitle">${escapeHtml(t('products.stockSub'))}</p>
      </div>
      <div class="view-actions">
        <button type="button" class="btn btn--outlined" data-action="manage-categories">
          ${icon('tag')}
          <span data-slot="btn-manage-categories">${escapeHtml(t('products.manageCategories'))}</span>
        </button>
        <button type="button" class="btn btn--primary" data-action="add-product">
          ${icon('plus')}
          <span data-slot="btn-add-product">${escapeHtml(t('products.addProduct'))}</span>
        </button>
      </div>
    </div>

    <div class="kpi-grid" data-slot="kpis"></div>

    <div class="products-toolbar">
      <div class="search-bar">
        ${icon('search')}
        <input
          type="search"
          class="search-input"
          data-role="product-search"
          placeholder="${escapeHtml(t('products.searchPlaceholder'))}"
          autocomplete="off"
          aria-label="${escapeHtml(t('products.searchAria'))}"
        />
        <button
          type="button"
          class="search-clear"
          data-action="clear-search"
          aria-label="${escapeHtml(t('common.clearSearchAria'))}"
          hidden
        >
          ${icon('close')}
        </button>
      </div>

      <div
        class="view-switcher"
        data-role="products-view-switcher"
        role="group"
        aria-label="${escapeHtml(t('pos.viewModeAria'))}"
      >
        <button
          type="button"
          class="view-switcher-btn"
          data-action="set-product-view"
          data-product-view="grid"
          title="${escapeHtml(t('pos.viewGrid'))}"
          aria-label="${escapeHtml(t('pos.viewGrid'))}"
          aria-pressed="false"
        >
          ${icon('viewGrid')}
          <span class="view-switcher-label">${escapeHtml(t('pos.viewGrid'))}</span>
        </button>
        <button
          type="button"
          class="view-switcher-btn"
          data-action="set-product-view"
          data-product-view="compact"
          title="${escapeHtml(t('pos.viewCompact'))}"
          aria-label="${escapeHtml(t('pos.viewCompact'))}"
          aria-pressed="false"
        >
          ${icon('viewCompact')}
          <span class="view-switcher-label">${escapeHtml(t('pos.viewCompact'))}</span>
        </button>
        <button
          type="button"
          class="view-switcher-btn"
          data-action="set-product-view"
          data-product-view="list"
          title="${escapeHtml(t('pos.viewList'))}"
          aria-label="${escapeHtml(t('pos.viewList'))}"
          aria-pressed="false"
        >
          ${icon('viewList')}
          <span class="view-switcher-label">${escapeHtml(t('pos.viewList'))}</span>
        </button>
      </div>
    </div>

    <div class="chip-row" data-slot="chips" role="tablist" aria-label="${escapeHtml(t('products.filterAria'))}" style="margin-bottom:var(--space-4);"></div>

    <div data-slot="list"></div>
  `;
}

function syncShellTranslations() {
  const container = viewState.container;
  if (!container) return;

  const titleEl = container.querySelector('[data-slot="products-title"]');
  if (titleEl) titleEl.textContent = t('products.title');

  const subtitleEl = container.querySelector('[data-slot="stock-subtitle"]');
  if (subtitleEl) subtitleEl.textContent = t('products.stockSub');

  const catBtnLabel = container.querySelector('[data-slot="btn-manage-categories"]');
  if (catBtnLabel) catBtnLabel.textContent = t('products.manageCategories');

  const addBtnLabel = container.querySelector('[data-slot="btn-add-product"]');
  if (addBtnLabel) addBtnLabel.textContent = t('products.addProduct');

  const searchInput = container.querySelector('[data-role="product-search"]');
  if (searchInput) {
    searchInput.placeholder = t('products.searchPlaceholder');
    searchInput.setAttribute('aria-label', t('products.searchAria'));
  }

  const clearBtn = container.querySelector('[data-action="clear-search"]');
  if (clearBtn) clearBtn.setAttribute('aria-label', t('common.clearSearchAria'));

  const chipsEl = container.querySelector('[data-slot="chips"]');
  if (chipsEl) chipsEl.setAttribute('aria-label', t('products.filterAria'));

  const viewSwitcher = container.querySelector('[data-role="products-view-switcher"]');
  if (viewSwitcher) {
    viewSwitcher.setAttribute('aria-label', t('pos.viewModeAria'));
    const labelMap = {
      grid: t('pos.viewGrid'),
      compact: t('pos.viewCompact'),
      list: t('pos.viewList'),
    };
    viewSwitcher.querySelectorAll('[data-product-view]').forEach((btn) => {
      const mode = btn.dataset.productView;
      const lbl = labelMap[mode] || mode;
      btn.title = lbl;
      btn.setAttribute('aria-label', lbl);
      const spanEl = btn.querySelector('.view-switcher-label');
      if (spanEl) spanEl.textContent = lbl;
    });
  }
}

function getValidProductView(rawView) {
  return rawView === 'compact' || rawView === 'list' ? rawView : 'grid';
}

function syncProductViewSwitcher() {
  const container = viewState.container;
  if (!container) return;
  const viewMode = getValidProductView(store.getSettings()?.productView);
  const viewSwitcher = container.querySelector('[data-role="products-view-switcher"]');
  if (viewSwitcher) {
    viewSwitcher.querySelectorAll('[data-product-view]').forEach((btn) => {
      const active = btn.dataset.productView === viewMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  const gridEl = container.querySelector('.products-manage-grid');
  if (gridEl) {
    gridEl.classList.remove(
      'products-manage-grid--grid',
      'products-manage-grid--compact',
      'products-manage-grid--list'
    );
    gridEl.classList.add(`products-manage-grid--${viewMode}`);
  }
}

function renderDynamicRegions() {
  const container = viewState.container;
  if (!container) return;

  syncShellTranslations();
  syncProductViewSwitcher();

  const settings = store.getSettings();
  const products = store.getProducts();
  const categories = store.getCategories();
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  if (
    viewState.activeFilter !== 'all' &&
    viewState.activeFilter !== 'low' &&
    viewState.activeFilter !== 'out' &&
    !categoryMap.has(viewState.activeFilter)
  ) {
    viewState.activeFilter = 'all';
  }

  const totalCount = products.length;
  const lowCount = products.filter((p) => p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD).length;
  const outCount = products.filter((p) => p.stock === 0).length;

  const searchInput = container.querySelector('[data-role="product-search"]');
  const clearBtn = container.querySelector('[data-action="clear-search"]');
  if (searchInput && searchInput.value !== viewState.searchQuery) {
    searchInput.value = viewState.searchQuery;
  }
  if (clearBtn) {
    clearBtn.hidden = viewState.searchQuery.length === 0;
  }

  const kpiSlot = container.querySelector('[data-slot="kpis"]');
  if (kpiSlot) {
    kpiSlot.innerHTML = `
      <button
        type="button"
        class="kpi-card is-clickable ${viewState.activeFilter === 'all' ? 'is-filter-active' : ''}"
        data-action="filter"
        data-filter="all"
      >
        <span class="kpi-label">${escapeHtml(t('products.kpiTotalLabel'))}</span>
        <span class="kpi-value tabular-nums">${totalCount}</span>
        <span class="kpi-sub">${escapeHtml(t('products.kpiTotalSub', { count: categories.length }))}</span>
      </button>

      <button
        type="button"
        class="kpi-card is-clickable ${viewState.activeFilter === 'low' ? 'is-filter-active' : ''}"
        data-action="filter"
        data-filter="low"
      >
        <span class="kpi-label">${escapeHtml(t('products.kpiLowLabel'))}</span>
        <span class="kpi-value tabular-nums">${lowCount}</span>
        <span class="kpi-sub">${escapeHtml(t('products.kpiLowSub', { max: LOW_STOCK_THRESHOLD }))}</span>
      </button>

      <button
        type="button"
        class="kpi-card is-clickable ${viewState.activeFilter === 'out' ? 'is-filter-active' : ''}"
        data-action="filter"
        data-filter="out"
      >
        <span class="kpi-label">${escapeHtml(t('products.kpiOutLabel'))}</span>
        <span class="kpi-value tabular-nums">${outCount}</span>
        <span class="kpi-sub">${escapeHtml(t('products.kpiOutSub'))}</span>
      </button>
    `;
  }

  const countByCat = new Map();
  for (const p of products) {
    countByCat.set(p.categoryId, (countByCat.get(p.categoryId) || 0) + 1);
  }

  const chipsSlot = container.querySelector('[data-slot="chips"]');
  if (chipsSlot) {
    const chipsHtml = [
      `<button type="button" class="chip ${viewState.activeFilter === 'all' ? 'is-active' : ''}" data-action="filter" data-filter="all">${escapeHtml(t('products.chipAll', { count: totalCount }))}</button>`,
      `<button type="button" class="chip ${viewState.activeFilter === 'low' ? 'is-active' : ''}" data-action="filter" data-filter="low">${icon('warning')} ${escapeHtml(t('products.chipLow', { count: lowCount }))}</button>`,
      `<button type="button" class="chip ${viewState.activeFilter === 'out' ? 'is-active' : ''}" data-action="filter" data-filter="out">${escapeHtml(t('products.chipOut', { count: outCount }))}</button>`,
      ...categories.map((cat) => {
        const count = countByCat.get(cat.id) || 0;
        const color = safeColor(cat.color);
        const isActive = viewState.activeFilter === cat.id;
        return `
          <button
            type="button"
            class="chip ${isActive ? 'is-active' : ''}"
            data-action="filter"
            data-filter="${escapeHtml(cat.id)}"
          >
            <span class="chip-cat-icon has-cat-tint" style="--cat-tint:${color}" aria-hidden="true">${categoryIcon(cat)}</span>
            <span>${escapeHtml(cat.name)} (${count})</span>
          </button>
        `;
      }),
    ].join('');
    chipsSlot.innerHTML = chipsHtml;
  }

  const q = viewState.searchQuery.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (viewState.activeFilter === 'low' && !(p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD)) {
      return false;
    }
    if (viewState.activeFilter === 'out' && p.stock !== 0) {
      return false;
    }
    if (
      viewState.activeFilter !== 'all' &&
      viewState.activeFilter !== 'low' &&
      viewState.activeFilter !== 'out' &&
      p.categoryId !== viewState.activeFilter
    ) {
      return false;
    }
    if (q) {
      const hayName = p.name.toLowerCase();
      const haySku = (p.sku || '').toLowerCase();
      if (!hayName.includes(q) && !haySku.includes(q)) return false;
    }
    return true;
  });

  const listSlot = container.querySelector('[data-slot="list"]');
  if (!listSlot) return;

  if (products.length === 0) {
    listSlot.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${icon('products')}</div>
        <h3 class="empty-title">${escapeHtml(t('products.emptyTitle'))}</h3>
        <p class="empty-desc">${escapeHtml(t('products.emptyDesc'))}</p>
        <button type="button" class="btn btn--primary" data-action="add-product" style="margin-top:6px;">
          ${icon('plus')}
          <span>${escapeHtml(t('products.emptyCta'))}</span>
        </button>
      </div>
    `;
    return;
  }

  if (filtered.length === 0) {
    listSlot.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${icon('search')}</div>
        <h3 class="empty-title">${escapeHtml(t('products.notFoundTitle'))}</h3>
        <p class="empty-desc">${escapeHtml(t('products.notFoundDesc'))}</p>
        <button type="button" class="btn btn--tonal" data-action="reset-filters" style="margin-top:6px;">
          ${icon('refresh')}
          <span>${escapeHtml(t('common.resetFilter'))}</span>
        </button>
      </div>
    `;
    return;
  }

  const viewMode = getValidProductView(settings.productView);
  const cardsHtml = filtered
    .map((p) => {
      const cat = categoryMap.get(p.categoryId);
      const catTint = cat ? safeColor(cat.color) : '';
      const hasPhoto = isSafeDataImage(p.image);
      const catLabel = cat
        ? escapeHtml(cat.name)
        : escapeHtml(t('products.uncategorized'));
      const thumbHtml = hasPhoto
        ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy" />`
        : `<span class="product-cat-icon" aria-hidden="true">${categoryIcon(cat)}</span>`;

      return `
        <article class="product-manage-card products-manage-card-wrap ${p.active ? '' : 'is-inactive'}" data-product-id="${escapeHtml(p.id)}">
          <div class="products-manage-top">
            <div class="product-manage-thumb${!hasPhoto && catTint ? ' has-cat-tint' : ''}"${!hasPhoto && catTint ? ` style="--cat-tint:${catTint}"` : ''}>${thumbHtml}</div>
            <div class="product-manage-info">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span class="products-manage-name" style="font-weight:700; font-size:0.96rem; color:var(--text-primary); word-break:break-word;">${escapeHtml(p.name)}</span>
                ${p.active ? '' : `<span class="badge badge--muted">${escapeHtml(t('common.inactive'))}</span>`}
              </div>
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:2px;">
                <span class="badge badge--muted products-manage-cat-badge">
                  <span class="badge-cat-icon${catTint ? ' has-cat-tint' : ''}"${catTint ? ` style="--cat-tint:${catTint}"` : ''} aria-hidden="true">${categoryIcon(cat)}</span>
                  <span>${catLabel}</span>
                </span>
                <span class="products-manage-sku tabular-nums" style="font-size:0.76rem; color:var(--text-muted);">
                  ${p.sku ? `SKU: ${escapeHtml(p.sku)}` : escapeHtml(t('products.noSku'))}
                </span>
              </div>
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-top:6px;">
                <span class="tabular-nums" style="font-weight:800; font-size:0.98rem; color:var(--primary);">${formatRupiah(p.price)}</span>
                ${getStockBadgeHtml(p.stock)}
              </div>
            </div>
          </div>

          <div class="products-manage-footer">
            <div class="qty-stepper" aria-label="${escapeHtml(t('products.stockStepperAria', { name: p.name }))}">
              <button
                type="button"
                class="qty-btn"
                data-action="stock-dec"
                data-id="${escapeHtml(p.id)}"
                aria-label="${escapeHtml(t('products.stockDecAria', { name: p.name }))}"
                ${p.stock <= 0 ? 'disabled' : ''}
              >
                ${icon('minus')}
              </button>
              <span class="qty-value tabular-nums" data-stock-val="${escapeHtml(p.id)}">${p.stock}</span>
              <button
                type="button"
                class="qty-btn"
                data-action="stock-inc"
                data-id="${escapeHtml(p.id)}"
                aria-label="${escapeHtml(t('products.stockIncAria', { name: p.name }))}"
              >
                ${icon('plus')}
              </button>
            </div>

            <div class="product-manage-actions">
              <button
                type="button"
                class="btn btn--tonal btn--sm"
                data-action="edit-product"
                data-id="${escapeHtml(p.id)}"
              >
                ${icon('edit')}
                <span>${escapeHtml(t('common.edit'))}</span>
              </button>
              <button
                type="button"
                class="icon-btn"
                style="color:var(--danger);"
                data-action="delete-product"
                data-id="${escapeHtml(p.id)}"
                aria-label="${escapeHtml(t('products.deleteAria', { name: p.name }))}"
                title="${escapeHtml(t('products.deleteTitle'))}"
              >
                ${icon('trash')}
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  listSlot.innerHTML = `<div class="products-manage-grid products-manage-grid--${viewMode}">${cardsHtml}</div>`;

  if (viewState.lastPopProductId) {
    const targetId = viewState.lastPopProductId;
    const valEl = Array.from(listSlot.querySelectorAll('[data-stock-val]')).find(
      (el) => el.dataset.stockVal === targetId
    );
    if (valEl) {
      popElement(valEl);
    }
    viewState.lastPopProductId = null;
  }
}

function openProductFormSheet(productId = null) {
  const existing = productId ? store.getProductById(productId) : null;
  const isEdit = Boolean(existing);
  const categories = store.getCategories();

  let uploadedImage = isSafeDataImage(existing?.image) ? existing.image : '';
  let visualTab = uploadedImage ? 'photo' : 'icon';

  const initialCatId = existing ? existing.categoryId || '' : categories[0]?.id || '';
  const initialCat = initialCatId
    ? categories.find((c) => c.id === initialCatId) || null
    : null;
  const initialCatTint = initialCat ? safeColor(initialCat.color) : '';

  const categoryOptionsHtml = [
    `<option value="" ${!initialCatId ? 'selected' : ''}>${escapeHtml(t('products.uncategorized'))}</option>`,
    ...categories.map((cat) => {
      const selected = cat.id === initialCatId;
      return `<option value="${escapeHtml(cat.id)}" ${selected ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`;
    }),
  ].join('');

  const contentHtml = `
    <form id="arupos-product-form" novalidate>
      <div class="field">
        <label class="field-label" for="prd-name">${escapeHtml(t('products.formNameLabel'))}</label>
        <input
          id="prd-name"
          name="name"
          type="text"
          class="input"
          maxlength="80"
          placeholder="${escapeHtml(t('products.formNamePlaceholder'))}"
          value="${escapeHtml(existing?.name || '')}"
          required
        />
        <div class="products-inline-error" data-error="name"></div>
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="prd-price">${escapeHtml(t('products.formPriceLabel'))}</label>
          <input
            id="prd-price"
            name="price"
            type="text"
            inputmode="numeric"
            class="input tabular-nums"
            placeholder="22000"
            value="${existing ? String(existing.price) : ''}"
            required
          />
          <div class="field-hint tabular-nums" data-role="price-preview">
            ${existing ? formatRupiah(existing.price) : 'Rp 0'}
          </div>
          <div class="products-inline-error" data-error="price"></div>
        </div>

        <div class="field">
          <label class="field-label" for="prd-stock">${escapeHtml(isEdit ? t('products.formStockEdit') : t('products.formStockAdd'))}</label>
          <input
            id="prd-stock"
            name="stock"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            class="input tabular-nums"
            value="${existing ? String(existing.stock) : '10'}"
            required
          />
          <div class="products-inline-error" data-error="stock"></div>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="prd-category">${escapeHtml(t('products.formCategoryLabel'))}</label>
          <select id="prd-category" name="categoryId" class="select">
            ${categoryOptionsHtml}
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="prd-sku">${escapeHtml(t('products.formSkuLabel'))}</label>
          <div class="products-sku-row">
            <input
              id="prd-sku"
              name="sku"
              type="text"
              maxlength="24"
              class="input"
              placeholder="${escapeHtml(t('products.formSkuPlaceholder'))}"
              value="${escapeHtml(existing?.sku || '')}"
            />
            <button
              type="button"
              class="btn btn--tonal btn--sm"
              data-action="gen-sku"
              title="${escapeHtml(t('products.genSkuTitle'))}"
              aria-label="${escapeHtml(t('products.genSkuTitle'))}"
            >
              ${icon('refresh')}
            </button>
          </div>
        </div>
      </div>

      <div class="field">
        <label class="field-label">${escapeHtml(t('products.visualLabel'))}</label>
        <div class="seg-control" role="tablist" style="width:100%; margin-bottom:10px;">
          <button
            type="button"
            class="seg-btn ${visualTab === 'icon' ? 'is-active' : ''}"
            data-visual-tab="icon"
          >
            <span data-role="tab-icon-preview" style="display:inline-flex;">${categoryIcon(initialCat)}</span>
            <span>${escapeHtml(t('products.tabEmoji'))}</span>
          </button>
          <button
            type="button"
            class="seg-btn ${visualTab === 'photo' ? 'is-active' : ''}"
            data-visual-tab="photo"
          >
            ${icon('camera')}
            <span>${escapeHtml(t('products.tabPhoto'))}</span>
          </button>
        </div>

        <div data-visual-panel="icon" ${visualTab === 'icon' ? '' : 'hidden'}>
          <div class="product-visual-auto-preview" data-role="product-auto-icon-preview">
            <span class="cat-sheet-icon${initialCatTint ? ' has-cat-tint' : ''}"${initialCatTint ? ` style="--cat-tint:${initialCatTint}"` : ''}>
              ${categoryIcon(initialCat)}
            </span>
            <div style="min-width:0;">
              <div style="font-weight:700; font-size:0.88rem; color:var(--text-primary);" data-role="auto-icon-cat-name">
                ${escapeHtml(initialCat ? initialCat.name : t('products.uncategorized'))}
              </div>
              <div class="field-hint">${escapeHtml(t('products.autoIconNote'))}</div>
            </div>
          </div>
        </div>

        <div data-visual-panel="photo" ${visualTab === 'photo' ? '' : 'hidden'}>
          <div data-role="photo-has-image" ${uploadedImage ? '' : 'hidden'}>
            <div class="image-preview-wrap" style="width:100%; justify-content:space-between; flex-wrap:wrap;">
              <div style="display:flex; align-items:center; gap:12px;">
                <img data-role="photo-preview-img" src="${uploadedImage ? escapeHtml(uploadedImage) : ''}" alt="${escapeHtml(t('products.photoPreviewAlt'))}" />
                <div>
                  <div style="font-weight:700; font-size:0.88rem;">${escapeHtml(t('products.photoActive'))}</div>
                  <div class="field-hint">${escapeHtml(t('products.photoHint'))}</div>
                </div>
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <label class="btn btn--outlined btn--sm" style="cursor:pointer;">
                  ${icon('image')}
                  <span>${escapeHtml(t('products.photoReplace'))}</span>
                  <input type="file" accept="image/*" data-role="photo-input-replace" hidden />
                </label>
                <button type="button" class="btn btn--danger btn--sm" data-action="remove-photo">
                  ${icon('trash')}
                  <span>${escapeHtml(t('products.photoRemove'))}</span>
                </button>
              </div>
            </div>
          </div>

          <label class="image-upload-box" data-role="photo-upload-box" ${uploadedImage ? 'hidden' : ''}>
            ${icon('camera')}
            <div style="font-weight:700; font-size:0.9rem;">${escapeHtml(t('products.photoUploadPrompt'))}</div>
            <div class="field-hint" data-role="photo-status">${escapeHtml(t('products.photoUploadHint'))}</div>
            <input type="file" accept="image/*" data-role="photo-input" hidden />
          </label>
        </div>
      </div>

      <div class="field" style="margin-top:8px;">
        <label class="switch" for="prd-active" style="justify-content:space-between; width:100%; padding:10px 12px; border-radius:var(--radius-md); background:var(--bg-surface-2);">
          <div>
            <div style="font-weight:700; font-size:0.9rem; color:var(--text-primary);">${escapeHtml(t('products.activeSwitchTitle'))}</div>
            <div class="field-hint">${escapeHtml(t('products.activeSwitchHint'))}</div>
          </div>
          <span style="position:relative; display:inline-flex; align-items:center;">
            <input
              id="prd-active"
              name="active"
              type="checkbox"
              class="switch-input"
              ${existing ? (existing.active ? 'checked' : '') : 'checked'}
            />
            <span class="switch-track"></span>
          </span>
        </label>
      </div>
    </form>
  `;

  const footerHtml = `
    <button type="button" class="btn btn--outlined" data-action="cancel-sheet">${escapeHtml(t('common.cancel'))}</button>
    <button type="submit" form="arupos-product-form" class="btn btn--primary">
      ${icon('check')}
      <span>${escapeHtml(isEdit ? t('products.saveChanges') : t('products.saveProduct'))}</span>
    </button>
  `;

  openSheet({
    id: PRODUCT_SHEET_ID,
    title: isEdit ? t('products.sheetEditTitle') : t('products.sheetAddTitle'),
    contentHtml,
    footerHtml,
    size: 'md',
    onMount(sheetEl) {
      const form = sheetEl.querySelector('#arupos-product-form');
      const nameInput = sheetEl.querySelector('#prd-name');
      const priceInput = sheetEl.querySelector('#prd-price');
      const pricePreview = sheetEl.querySelector('[data-role="price-preview"]');
      const stockInput = sheetEl.querySelector('#prd-stock');
      const catSelect = sheetEl.querySelector('#prd-category');
      const skuInput = sheetEl.querySelector('#prd-sku');
      const photoInput = sheetEl.querySelector('[data-role="photo-input"]');
      const photoInputReplace = sheetEl.querySelector('[data-role="photo-input-replace"]');
      const photoHasBox = sheetEl.querySelector('[data-role="photo-has-image"]');
      const photoUploadBox = sheetEl.querySelector('[data-role="photo-upload-box"]');
      const photoPreviewImg = sheetEl.querySelector('[data-role="photo-preview-img"]');
      const photoStatus = sheetEl.querySelector('[data-role="photo-status"]');

      const setFieldError = (field, msg) => {
        const el = sheetEl.querySelector(`[data-error="${field}"]`);
        if (el) el.textContent = msg || '';
      };

      const syncVisualTabs = () => {
        sheetEl.querySelectorAll('[data-visual-tab]').forEach((btn) => {
          btn.classList.toggle('is-active', btn.dataset.visualTab === visualTab);
        });
        const iconPanel = sheetEl.querySelector('[data-visual-panel="icon"]');
        const photoPanel = sheetEl.querySelector('[data-visual-panel="photo"]');
        if (iconPanel) iconPanel.hidden = visualTab !== 'icon';
        if (photoPanel) photoPanel.hidden = visualTab !== 'photo';
      };

      const syncCategoryPreview = () => {
        const selectedCat = catSelect?.value
          ? categories.find((c) => c.id === catSelect.value) || null
          : null;
        const tint = selectedCat ? safeColor(selectedCat.color) : '';
        const tabPreview = sheetEl.querySelector('[data-role="tab-icon-preview"]');
        if (tabPreview) tabPreview.innerHTML = categoryIcon(selectedCat);
        const autoBox = sheetEl.querySelector('[data-role="product-auto-icon-preview"]');
        if (autoBox) {
          const iconBox = autoBox.querySelector('.cat-sheet-icon');
          if (iconBox) {
            iconBox.innerHTML = categoryIcon(selectedCat);
            iconBox.classList.toggle('has-cat-tint', Boolean(tint));
            if (tint) {
              iconBox.style.setProperty('--cat-tint', tint);
            } else {
              iconBox.style.removeProperty('--cat-tint');
            }
          }
          const nameEl = autoBox.querySelector('[data-role="auto-icon-cat-name"]');
          if (nameEl) {
            nameEl.textContent = selectedCat ? selectedCat.name : t('products.uncategorized');
          }
        }
      };

      const syncPhotoUI = () => {
        if (photoHasBox) photoHasBox.hidden = !uploadedImage;
        if (photoUploadBox) photoUploadBox.hidden = Boolean(uploadedImage);
        if (photoPreviewImg) {
          photoPreviewImg.src = uploadedImage || '';
        }
        if (photoStatus) {
          photoStatus.textContent = t('products.photoUploadHint');
        }
      };

      const handlePhotoFile = async (inputEl) => {
        const file = inputEl?.files && inputEl.files[0];
        if (!file) return;
        if (photoStatus) photoStatus.textContent = t('products.photoCompressing');
        try {
          const dataUrl = await compressImageFile(file, 320, 0.78);
          uploadedImage = dataUrl;
          syncPhotoUI();
          toast(t('products.photoLoadedToast'), 'success');
        } catch (err) {
          inputEl.value = '';
          syncPhotoUI();
          toast(err?.message || t('products.photoErrorToast'), 'error');
        }
      };

      priceInput?.addEventListener('input', () => {
        const val = parseRupiahInput(priceInput.value);
        if (pricePreview) pricePreview.textContent = formatRupiah(val);
        setFieldError('price', '');
      });

      nameInput?.addEventListener('input', () => setFieldError('name', ''));
      stockInput?.addEventListener('input', () => setFieldError('stock', ''));
      catSelect?.addEventListener('change', syncCategoryPreview);
      photoInput?.addEventListener('change', () => handlePhotoFile(photoInput));
      photoInputReplace?.addEventListener('change', () => handlePhotoFile(photoInputReplace));

      sheetEl.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="cancel-sheet"]')) {
          closeSheet(PRODUCT_SHEET_ID);
          return;
        }

        if (e.target.closest('[data-action="gen-sku"]') && skuInput && catSelect) {
          skuInput.value = generateAutoSku(catSelect.value);
          popElement(skuInput);
          return;
        }

        const tabBtn = e.target.closest('[data-visual-tab]');
        if (tabBtn) {
          visualTab = tabBtn.dataset.visualTab === 'photo' ? 'photo' : 'icon';
          syncVisualTabs();
          return;
        }

        if (e.target.closest('[data-action="remove-photo"]')) {
          uploadedImage = '';
          if (photoInput) photoInput.value = '';
          if (photoInputReplace) photoInputReplace.value = '';
          syncPhotoUI();
          toast(t('products.photoRemovedToast'), 'info');
        }
      });

      form?.addEventListener('submit', (e) => {
        e.preventDefault();
        setFieldError('name', '');
        setFieldError('price', '');
        setFieldError('stock', '');

        const name = String(nameInput?.value || '').trim();
        const rawPriceText = String(priceInput?.value || '').trim();
        const price = parseRupiahInput(rawPriceText);
        const rawStock = stockInput?.value === '' ? NaN : Number(stockInput?.value);
        const stock = Math.round(rawStock);
        const categoryId = catSelect?.value || '';
        const sku = String(skuInput?.value || '').trim().toUpperCase();
        const active = Boolean(sheetEl.querySelector('#prd-active')?.checked);

        let hasError = false;
        if (!name) {
          setFieldError('name', t('products.errName'));
          hasError = true;
        }
        if (!rawPriceText || !Number.isFinite(price) || price < 0) {
          setFieldError('price', t('products.errPrice'));
          hasError = true;
        }
        if (!Number.isFinite(rawStock) || stock < 0) {
          setFieldError('stock', t('products.errStock'));
          hasError = true;
        }

        if (hasError) {
          toast(t('products.errFormToast'), 'warning');
          return;
        }

        const payload = {
          name,
          price,
          stock: clamp(stock, 0, 999999),
          categoryId,
          sku,
          emoji: existing?.emoji || '📦',
          image: uploadedImage,
          active,
        };

        try {
          if (isEdit) {
            store.updateProduct(existing.id, payload);
            toast(t('products.updatedToast'), 'success');
          } else {
            store.addProduct(payload);
            toast(t('products.addedToast'), 'success');
          }
          closeSheet(PRODUCT_SHEET_ID);
        } catch (err) {
          toast(err?.message || t('products.saveFailedToast'), 'error');
        }
      });
    },
  });
}

function openCategoriesSheet() {
  let editingCatId = null;
  let newIcon = 'tag';
  let newColor = getNextCategoryColor(store.getCategories());

  const buildSheetContent = () => {
    const categories = store.getCategories();
    const products = store.getProducts();
    const countMap = new Map();
    for (const p of products) {
      countMap.set(p.categoryId, (countMap.get(p.categoryId) || 0) + 1);
    }

    const listHtml = categories.length === 0
      ? `<div class="field-hint" style="padding:10px 12px;border-radius:var(--radius-md);background:var(--bg-surface-2);">${escapeHtml(t('products.catEmptyHint'))}</div>`
      : categories
          .map((cat) => {
            const count = countMap.get(cat.id) || 0;
            const color = safeColor(cat.color);
            const catIconName = getCategoryIconName(cat);
            const isEditing = editingCatId === cat.id;

            return `
          <div class="products-cat-item" data-cat-row="${escapeHtml(cat.id)}">
            <div class="products-cat-item-head">
              <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
                <span class="cat-sheet-icon has-cat-tint" style="--cat-tint:${color}">
                  ${categoryIcon(cat)}
                </span>
                <div style="min-width:0;">
                  <div style="font-weight:700; font-size:0.94rem; color:var(--text-primary); word-break:break-word;">${escapeHtml(cat.name)}</div>
                  <div class="field-hint tabular-nums">${escapeHtml(t('products.catCount', { count }))}</div>
                </div>
              </div>
              <div style="display:inline-flex; gap:4px; flex-shrink:0;">
                <button
                  type="button"
                  class="icon-btn"
                  data-cat-action="toggle-edit"
                  data-cat-id="${escapeHtml(cat.id)}"
                  aria-label="${escapeHtml(t('products.catEditAria', { name: cat.name }))}"
                  title="${escapeHtml(isEditing ? t('products.catEditClose') : t('products.catEditTitle'))}"
                >
                  ${icon(isEditing ? 'close' : 'edit')}
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  style="color:var(--danger);"
                  data-cat-action="delete"
                  data-cat-id="${escapeHtml(cat.id)}"
                  aria-label="${escapeHtml(t('products.catDeleteAria', { name: cat.name }))}"
                  title="${escapeHtml(t('products.catDeleteTitle'))}"
                >
                  ${icon('trash')}
                </button>
              </div>
            </div>
            ${
              isEditing
                ? `
                  <form class="products-cat-edit-form" data-cat-edit-form="${escapeHtml(cat.id)}" novalidate>
                    <input
                      type="text"
                      name="name"
                      class="input"
                      maxlength="40"
                      value="${escapeHtml(cat.name)}"
                      placeholder="${escapeHtml(t('products.catNamePlaceholder'))}"
                      required
                    />
                    <div class="icon-picker-grid" role="radiogroup" aria-label="${escapeHtml(t('products.catIconLabel'))}">
                      ${CATEGORY_ICON_OPTIONS.map(
                        (iconKey) => `
                          <button
                            type="button"
                            class="icon-option ${iconKey === catIconName ? 'is-selected' : ''}"
                            data-edit-icon="${escapeHtml(iconKey)}"
                            aria-label="${escapeHtml(t('products.chooseIconAria', { name: iconKey }))}"
                            aria-checked="${iconKey === catIconName ? 'true' : 'false'}"
                          >${icon(iconKey)}</button>
                        `
                      ).join('')}
                    </div>
                    <div class="color-swatch-row">
                      ${CATEGORY_COLORS.map(
                        (col) => `
                          <button
                            type="button"
                            class="color-swatch ${col.toLowerCase() === color.toLowerCase() ? 'is-selected' : ''}"
                            style="background:${col}; color:#fff;"
                            data-edit-color="${col}"
                            aria-label="${escapeHtml(t('products.catColorAria', { col }))}"
                          >${col.toLowerCase() === color.toLowerCase() ? icon('check') : ''}</button>
                        `
                      ).join('')}
                    </div>
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                      <button type="button" class="btn btn--outlined btn--sm" data-cat-action="cancel-edit">${escapeHtml(t('common.cancel'))}</button>
                      <button type="submit" class="btn btn--primary btn--sm">
                        ${icon('check')}
                        <span>${escapeHtml(t('common.save'))}</span>
                      </button>
                    </div>
                  </form>
                `
                : ''
            }
          </div>
        `;
      })
          .join('');

    return `
      <div class="category-list" style="margin-bottom:var(--space-5);">${listHtml}</div>
      <hr style="border:0; border-top:1px solid var(--border-subtle); margin:var(--space-4) 0;" />
      <form id="arupos-add-category-form" novalidate>
        <div style="font-weight:700; font-size:0.98rem; margin-bottom:var(--space-3);">${escapeHtml(t('products.catAddHeading'))}</div>
        <div class="field">
          <label class="field-label" for="cat-new-name">${escapeHtml(t('products.catAddNameLabel'))}</label>
          <input
            id="cat-new-name"
            name="name"
            type="text"
            class="input"
            maxlength="40"
            placeholder="${escapeHtml(t('products.catAddNamePlaceholder'))}"
            required
          />
        </div>
        <div class="field">
          <label class="field-label">${escapeHtml(t('products.catIconLabel'))}</label>
          <div class="icon-picker-grid" role="radiogroup" aria-label="${escapeHtml(t('products.catIconLabel'))}">
            ${CATEGORY_ICON_OPTIONS.map(
              (iconKey) => `
                <button
                  type="button"
                  class="icon-option ${iconKey === newIcon ? 'is-selected' : ''}"
                  data-new-icon="${escapeHtml(iconKey)}"
                  aria-label="${escapeHtml(t('products.chooseIconAria', { name: iconKey }))}"
                  aria-checked="${iconKey === newIcon ? 'true' : 'false'}"
                >${icon(iconKey)}</button>
              `
            ).join('')}
          </div>
        </div>
        <div class="field">
          <label class="field-label">${escapeHtml(t('products.catColorLabel'))}</label>
          <div class="color-swatch-row">
            ${CATEGORY_COLORS.map(
              (col) => `
                <button
                  type="button"
                  class="color-swatch ${col === newColor ? 'is-selected' : ''}"
                  style="background:${col}; color:#fff;"
                  data-new-color="${col}"
                  aria-label="${escapeHtml(t('products.catColorAria', { col }))}"
                >${col === newColor ? icon('check') : ''}</button>
              `
            ).join('')}
          </div>
        </div>
        <button type="submit" class="btn btn--primary btn--block" style="margin-top:var(--space-2);">
          ${icon('plus')}
          <span>${escapeHtml(t('products.catAddBtn'))}</span>
        </button>
      </form>
    `;
  };

  const footerHtml = `
    <button type="button" class="btn btn--tonal" data-action="close-categories">${escapeHtml(t('common.done'))}</button>
  `;

  openSheet({
    id: CATEGORY_SHEET_ID,
    title: t('products.manageCategories'),
    contentHtml: `<div data-role="categories-sheet-body">${buildSheetContent()}</div>`,
    footerHtml,
    size: 'md',
    onMount(sheetEl) {
      const bodySlot = sheetEl.querySelector('[data-role="categories-sheet-body"]');
      let editDraftIcon = '';
      let editDraftColor = '';

      const rerenderBody = () => {
        if (bodySlot) {
          bodySlot.innerHTML = buildSheetContent();
        }
      };

      sheetEl.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action="close-categories"]')) {
          closeSheet(CATEGORY_SHEET_ID);
          return;
        }

        const newIconBtn = e.target.closest('[data-new-icon]');
        if (newIconBtn) {
          newIcon = newIconBtn.dataset.newIcon || 'tag';
          sheetEl.querySelectorAll('[data-new-icon]').forEach((b) => {
            const active = b === newIconBtn;
            b.classList.toggle('is-selected', active);
            b.setAttribute('aria-checked', active ? 'true' : 'false');
          });
          return;
        }

        const newColorBtn = e.target.closest('[data-new-color]');
        if (newColorBtn) {
          newColor = newColorBtn.dataset.newColor || CATEGORY_COLORS[0];
          sheetEl.querySelectorAll('[data-new-color]').forEach((b) => {
            const active = b === newColorBtn;
            b.classList.toggle('is-selected', active);
            b.innerHTML = active ? icon('check') : '';
          });
          return;
        }

        const editIconBtn = e.target.closest('[data-edit-icon]');
        if (editIconBtn) {
          editDraftIcon = editIconBtn.dataset.editIcon || 'tag';
          const form = editIconBtn.closest('form');
          form?.querySelectorAll('[data-edit-icon]').forEach((b) => {
            const active = b === editIconBtn;
            b.classList.toggle('is-selected', active);
            b.setAttribute('aria-checked', active ? 'true' : 'false');
          });
          return;
        }

        const editColorBtn = e.target.closest('[data-edit-color]');
        if (editColorBtn) {
          editDraftColor = editColorBtn.dataset.editColor || CATEGORY_COLORS[0];
          const form = editColorBtn.closest('form');
          form?.querySelectorAll('[data-edit-color]').forEach((b) => {
            const active = b === editColorBtn;
            b.classList.toggle('is-selected', active);
            b.innerHTML = active ? icon('check') : '';
          });
          return;
        }

        const actionBtn = e.target.closest('[data-cat-action]');
        if (!actionBtn) return;

        const action = actionBtn.dataset.catAction;
        const catId = actionBtn.dataset.catId;

        if (action === 'toggle-edit') {
          if (editingCatId === catId) {
            editingCatId = null;
            editDraftIcon = '';
            editDraftColor = '';
          } else {
            const target = store.getCategories().find((c) => c.id === catId);
            editingCatId = catId;
            editDraftIcon = getCategoryIconName(target);
            editDraftColor = target?.color || CATEGORY_COLORS[0];
          }
          rerenderBody();
          return;
        }

        if (action === 'cancel-edit') {
          editingCatId = null;
          editDraftIcon = '';
          editDraftColor = '';
          rerenderBody();
          return;
        }

        if (action === 'delete') {
          const cats = store.getCategories();
          const target = cats.find((c) => c.id === catId);
          if (!target) return;
          const fallback = cats.find((c) => c.id !== catId);
          const affectedCount = store
            .getProducts()
            .filter((p) => p.categoryId === catId).length;

          const msg =
            affectedCount > 0
              ? t('products.catDeleteWithProducts', {
                  name: target.name,
                  count: affectedCount,
                  fallback: fallback?.name || t('products.uncategorized'),
                })
              : t('products.catDeleteConfirm', { name: target.name });

          const confirmed = await confirmDialog({
            title: t('products.catDeleteTitleDialog'),
            message: msg,
            confirmText: t('products.catDeleteOk'),
            cancelText: t('common.cancel'),
            danger: true,
          });
          if (!confirmed) return;

          try {
            store.deleteCategory(catId);
            if (editingCatId === catId) editingCatId = null;
            rerenderBody();
            toast(t('products.catDeletedToast', { name: target.name }), 'success');
          } catch (err) {
            toast(err?.message || t('products.catDeleteFailedToast'), 'error');
          }
        }
      });

      sheetEl.addEventListener('submit', (e) => {
        const editForm = e.target.closest('[data-cat-edit-form]');
        if (editForm) {
          e.preventDefault();
          const catId = editForm.dataset.catEditForm;
          const nameInput = editForm.querySelector('input[name="name"]');
          const name = String(nameInput?.value || '').trim();
          if (!name) {
            toast(t('products.catEmptyNameToast'), 'warning');
            return;
          }
          try {
            store.updateCategory(catId, {
              name,
              icon: editDraftIcon || undefined,
              color: editDraftColor || undefined,
            });
            editingCatId = null;
            rerenderBody();
            toast(t('products.catUpdatedToast'), 'success');
          } catch (err) {
            toast(err?.message || t('products.catUpdateFailedToast'), 'error');
          }
          return;
        }

        const addForm = e.target.closest('#arupos-add-category-form');
        if (addForm) {
          e.preventDefault();
          const nameInput = addForm.querySelector('#cat-new-name');
          const name = String(nameInput?.value || '').trim();
          if (!name) {
            toast(t('products.catNewEmptyNameToast'), 'warning');
            return;
          }
          try {
            store.addCategory({
              name,
              icon: newIcon,
              color: newColor,
            });
            newIcon = 'tag';
            newColor = getNextCategoryColor(store.getCategories());
            rerenderBody();
            toast(t('products.catAddedToast', { name }), 'success');
          } catch (err) {
            toast(err?.message || t('products.catAddFailedToast'), 'error');
          }
        }
      });
    },
  });
}

async function handleDeleteProduct(productId) {
  const product = store.getProductById(productId);
  if (!product) return;

  const confirmed = await confirmDialog({
    title: t('products.deleteConfirmTitle'),
    message: t('products.deleteConfirmMsg', { name: product.name }),
    confirmText: t('products.catDeleteOk'),
    cancelText: t('common.cancel'),
    danger: true,
  });

  if (!confirmed) return;

  try {
    store.deleteProduct(productId);
    toast(t('products.deletedToast', { name: product.name }), 'success');
  } catch (err) {
    toast(err?.message || t('products.deleteFailedToast'), 'error');
  }
}

export function renderProductsView() {
  if (!viewState.container) return;
  if (!viewState.container.querySelector('[data-slot="list"]')) {
    renderShell(viewState.container);
  }
  renderDynamicRegions();
}

export function initProductsView(container) {
  if (!container) return;
  injectMinimalHelperStyles();

  for (const unsub of viewState.unsubscribers) {
    try {
      unsub();
    } catch {
      // ignore
    }
  }
  viewState.unsubscribers = [];

  if (viewState.container && viewState.boundClickHandler) {
    viewState.container.removeEventListener('click', viewState.boundClickHandler);
  }
  if (viewState.container && viewState.boundInputHandler) {
    viewState.container.removeEventListener('input', viewState.boundInputHandler);
  }

  viewState.container = container;
  renderShell(container);

  const debouncedSearchRender = debounce(() => {
    renderDynamicRegions();
  }, 140);

  viewState.boundInputHandler = (e) => {
    const searchEl = e.target.closest('[data-role="product-search"]');
    if (!searchEl) return;
    viewState.searchQuery = searchEl.value;
    const clearBtn = container.querySelector('[data-action="clear-search"]');
    if (clearBtn) clearBtn.hidden = viewState.searchQuery.length === 0;
    debouncedSearchRender();
  };

  viewState.boundClickHandler = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'set-product-view') {
      const nextView = getValidProductView(btn.dataset.productView);
      const currentView = getValidProductView(store.getSettings()?.productView);
      if (nextView === currentView) return;
      store.updateSettings({ productView: nextView });
      return;
    }

    if (action === 'add-product') {
      openProductFormSheet(null);
      return;
    }

    if (action === 'manage-categories') {
      openCategoriesSheet();
      return;
    }

    if (action === 'filter') {
      const nextFilter = btn.dataset.filter || 'all';
      if (
        (nextFilter === 'low' || nextFilter === 'out') &&
        viewState.activeFilter === nextFilter
      ) {
        viewState.activeFilter = 'all';
      } else {
        viewState.activeFilter = nextFilter;
      }
      renderDynamicRegions();
      return;
    }

    if (action === 'clear-search') {
      viewState.searchQuery = '';
      debouncedSearchRender.cancel();
      const input = container.querySelector('[data-role="product-search"]');
      if (input) {
        input.value = '';
        input.focus();
      }
      renderDynamicRegions();
      return;
    }

    if (action === 'reset-filters') {
      viewState.searchQuery = '';
      viewState.activeFilter = 'all';
      debouncedSearchRender.cancel();
      renderDynamicRegions();
      return;
    }

    if (action === 'stock-dec') {
      const id = btn.dataset.id;
      if (!id) return;
      viewState.lastPopProductId = id;
      try {
        store.adjustStock(id, -1);
      } catch (err) {
        toast(err?.message || t('products.stockUpdateFailed'), 'error');
      }
      return;
    }

    if (action === 'stock-inc') {
      const id = btn.dataset.id;
      if (!id) return;
      viewState.lastPopProductId = id;
      try {
        store.adjustStock(id, 1);
      } catch (err) {
        toast(err?.message || t('products.stockUpdateFailed'), 'error');
      }
      return;
    }

    if (action === 'edit-product') {
      const id = btn.dataset.id;
      if (id) openProductFormSheet(id);
      return;
    }

    if (action === 'delete-product') {
      const id = btn.dataset.id;
      if (id) handleDeleteProduct(id);
    }
  };

  container.addEventListener('click', viewState.boundClickHandler);
  container.addEventListener('input', viewState.boundInputHandler);

  const rerender = () => renderProductsView();
  const onSettingsChanged = (nextSettings) => {
    const keys = nextSettings?._changedKeys;
    if (Array.isArray(keys) && keys.length > 0 && keys.every((k) => k === 'theme' || k === 'accent')) {
      return;
    }
    if (Array.isArray(keys) && keys.length > 0 && keys.every((k) => k === 'productView')) {
      syncProductViewSwitcher();
      return;
    }
    renderProductsView();
  };
  viewState.unsubscribers.push(
    bus.on('products:changed', rerender),
    bus.on('categories:changed', rerender),
    bus.on('settings:changed', onSettingsChanged),
    bus.on('store:reset', () => {
      viewState.searchQuery = '';
      viewState.activeFilter = 'all';
      renderProductsView();
    })
  );

  renderProductsView();
}
