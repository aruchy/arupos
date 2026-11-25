import {
  formatRupiah,
  parseRupiahInput,
  escapeHtml,
  clamp,
  debounce,
  bus,
} from '../utils.js';
import { icon, categoryIcon } from '../icons.js';
import { store } from '../store.js';
import {
  animateRupiah,
  animateNumber,
  flyToCart,
  popElement,
  prefersReducedMotion,
  toast,
  openSheet,
  closeSheet,
  confirmDialog,
} from '../motion.js';
import { cart } from '../cart.js';
import { openReceiptModal } from '../receipt.js';
import { t } from '../i18n.js';

let rootEl = null;
let initialized = false;
let searchQuery = '';
let selectedCategory = 'all';
let mobileCartSheetPanel = null;
let pendingEnterProductId = null;

const EWALLET_PROVIDERS = ['GoPay', 'OVO', 'DANA', 'ShopeePay'];
const EWALLET_OTHER_ID = '__other__';
const BANK_PRESETS = ['BCA', 'BRI', 'BNI', 'Mandiri', 'BSI'];

function getFnbNoteChips() {
  const raw = t('pos.noteChips');
  return Array.isArray(raw) ? raw : [];
}

function formatNumberPlain(n) {
  const num = Math.max(0, Math.round(Number(n) || 0));
  if (!num) return '';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function getSettings() {
  return store.getSettings() || {};
}

function mapDiscountTypeForStore(type) {
  if (type === 'pct' || type === 'percent') return 'percent';
  if (type === 'rp' || type === 'nominal') return 'nominal';
  return 'none';
}

function buildCartItemQtyMap(cartState) {
  const map = new Map();
  for (const it of cartState.items || []) {
    map.set(it.productId, it.qty);
  }
  return map;
}

function buildCategoryMap() {
  const map = new Map();
  for (const cat of store.getCategories() || []) {
    map.set(cat.id, cat);
  }
  return map;
}

function getFilteredProducts() {
  const products = (store.getProducts() || []).filter((p) => p && p.active !== false);
  const q = searchQuery.trim().toLowerCase();

  return products.filter((p) => {
    if (selectedCategory !== 'all' && p.categoryId !== selectedCategory) {
      return false;
    }
    if (!q) return true;
    const nameMatch = String(p.name || '').toLowerCase().includes(q);
    const skuMatch = String(p.sku || '').toLowerCase().includes(q);
    return nameMatch || skuMatch;
  });
}

function renderShell() {
  if (!rootEl) return;

  rootEl.innerHTML = `
    <div class="pos-layout">
      <section class="pos-catalog" aria-label="${escapeHtml(t('pos.catalogAria'))}">
        <div class="pos-toolbar">
          <div class="search-bar">
            ${icon('search')}
            <input
              type="search"
              id="pos-search-input"
              class="search-input"
              placeholder="${escapeHtml(t('pos.searchPlaceholder'))}"
              autocomplete="off"
              aria-label="${escapeHtml(t('pos.searchAria'))}"
            />
          <button
            type="button"
            id="pos-search-clear"
            class="search-clear"
            aria-label="${escapeHtml(t('common.clearSearchAria'))}"
            hidden
          >
            ${icon('close')}
          </button>
        </div>

        <div
          class="view-switcher"
          id="pos-view-switcher"
          role="group"
          aria-label="${escapeHtml(t('pos.viewModeAria'))}"
        >
          <button
            type="button"
            class="view-switcher-btn"
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

        <div class="pos-fnb-bar" id="pos-fnb-bar" hidden>
          <div class="seg-control" role="group" aria-label="${escapeHtml(t('pos.orderTypeAria'))}">
            <button
              type="button"
              class="seg-btn is-active"
              data-order-type="dine-in"
              aria-pressed="true"
            >
              ${icon('utensils')}
              <span>${escapeHtml(t('receipt.dineIn'))}</span>
            </button>
            <button
              type="button"
              class="seg-btn"
              data-order-type="takeaway"
              aria-pressed="false"
            >
              ${icon('bag')}
              <span>${escapeHtml(t('receipt.takeaway'))}</span>
            </button>
          </div>
          <div id="pos-table-input-wrap" style="display:flex;align-items:center;gap:8px;flex:1;min-width:140px;max-width:220px;">
            <span style="color:var(--text-muted);display:inline-flex;">${icon('table')}</span>
            <input
              type="text"
              id="pos-table-input"
              class="input"
              placeholder="${escapeHtml(t('pos.tablePlaceholder'))}"
              maxlength="20"
              autocomplete="off"
              aria-label="${escapeHtml(t('pos.tableAria'))}"
            />
          </div>
        </div>

        <div class="chip-row" id="pos-category-chips" role="tablist" aria-label="${escapeHtml(t('pos.categoryFilterAria'))}"></div>

        <div class="product-grid" id="pos-product-grid"></div>
      </section>

      <aside class="pos-cart-panel" id="pos-cart-panel" aria-label="${escapeHtml(t('pos.cartPanelAria'))}">
        <div class="cart-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <h2 id="pos-cart-title" style="margin:0;font-size:1.05rem;font-weight:800;">${escapeHtml(t('pos.cartTitle'))}</h2>
            <span class="badge badge--primary tabular-nums" id="pos-cart-count">0</span>
          </div>
          <button
            type="button"
            class="btn btn--text btn--sm"
            id="pos-cart-clear-btn"
            data-cart-action="clear"
            disabled
          >
            ${icon('trash')}
            <span id="pos-cart-clear-label">${escapeHtml(t('pos.clearCart'))}</span>
          </button>
        </div>

        <div class="cart-items" id="pos-cart-items"></div>

        <div class="cart-adjustments" id="pos-cart-adjustments"></div>

        <div class="cart-summary" id="pos-cart-summary">
          <div id="pos-cart-summary-rows" style="display:flex;flex-direction:column;gap:6px;"></div>
          <div class="cart-summary-total">
            <span id="pos-cart-total-label">${escapeHtml(t('common.total'))}</span>
            <strong class="tabular-nums" id="pos-cart-total-val">Rp 0</strong>
          </div>
          <button
            type="button"
            class="btn btn--primary btn--lg btn--block"
            id="pos-pay-btn"
            data-cart-action="checkout"
            style="margin-top:6px;"
            disabled
          >
            <span id="pos-pay-btn-label">${escapeHtml(t('pos.pay'))}</span>
            <span class="tabular-nums" id="pos-pay-btn-amount">Rp 0</span>
          </button>
        </div>
      </aside>
    </div>

    <div class="mobile-cart-bar is-hidden" id="mobile-cart-bar" aria-hidden="true">
      <button
        type="button"
        id="mobile-cart-open-btn"
        aria-label="${escapeHtml(t('pos.viewCartAria'))}"
        style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;min-height:44px;text-align:left;"
      >
        <span style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:var(--radius-md);background:var(--primary-container);color:var(--on-primary-container);flex-shrink:0;">
          ${icon('cart')}
          <span
            id="mobile-cart-count-val"
            class="badge badge--primary tabular-nums"
            style="position:absolute;top:-6px;right:-6px;min-width:22px;height:22px;padding:0 5px;justify-content:center;background:var(--primary-solid);color:var(--text-on-primary);"
          >0</span>
        </span>
        <span style="display:flex;flex-direction:column;min-width:0;">
          <span id="mobile-cart-view-label" style="font-size:0.74rem;color:var(--text-muted);font-weight:600;">${escapeHtml(t('pos.viewCart'))}</span>
          <strong class="tabular-nums" id="mobile-cart-total-val" style="font-size:1.02rem;font-weight:800;color:var(--text-primary);">Rp 0</strong>
        </span>
      </button>
      <button
        type="button"
        class="btn btn--primary"
        id="mobile-cart-pay-btn"
      >
        <span id="mobile-cart-pay-label">${escapeHtml(t('pos.pay'))}</span>
        ${icon('chevronRight')}
      </button>
    </div>
  `;

  bindShellEvents();
}

function syncShellTranslations() {
  if (!rootEl) return;

  const catalogEl = rootEl.querySelector('.pos-catalog');
  if (catalogEl) catalogEl.setAttribute('aria-label', t('pos.catalogAria'));

  const searchInput = rootEl.querySelector('#pos-search-input');
  if (searchInput) {
    searchInput.placeholder = t('pos.searchPlaceholder');
    searchInput.setAttribute('aria-label', t('pos.searchAria'));
  }

  const searchClear = rootEl.querySelector('#pos-search-clear');
  if (searchClear) searchClear.setAttribute('aria-label', t('common.clearSearchAria'));

  const fnbGroup = rootEl.querySelector('#pos-fnb-bar .seg-control');
  if (fnbGroup) fnbGroup.setAttribute('aria-label', t('pos.orderTypeAria'));

  const tableInput = rootEl.querySelector('#pos-table-input');
  if (tableInput) {
    tableInput.placeholder = t('pos.tablePlaceholder');
    tableInput.setAttribute('aria-label', t('pos.tableAria'));
  }

  const chipsEl = rootEl.querySelector('#pos-category-chips');
  if (chipsEl) chipsEl.setAttribute('aria-label', t('pos.categoryFilterAria'));

  const cartPanel = rootEl.querySelector('#pos-cart-panel');
  if (cartPanel) cartPanel.setAttribute('aria-label', t('pos.cartPanelAria'));

  const cartTitle = rootEl.querySelector('#pos-cart-title');
  if (cartTitle) cartTitle.textContent = t('pos.cartTitle');

  const clearLabel = rootEl.querySelector('#pos-cart-clear-label');
  if (clearLabel) clearLabel.textContent = t('pos.clearCart');

  const totalLabel = rootEl.querySelector('#pos-cart-total-label');
  if (totalLabel) totalLabel.textContent = t('common.total');

  const payLabel = rootEl.querySelector('#pos-pay-btn-label');
  if (payLabel) payLabel.textContent = t('pos.pay');

  const mobileOpenBtn = rootEl.querySelector('#mobile-cart-open-btn');
  if (mobileOpenBtn) mobileOpenBtn.setAttribute('aria-label', t('pos.viewCartAria'));

  const mobileViewLabel = rootEl.querySelector('#mobile-cart-view-label');
  if (mobileViewLabel) mobileViewLabel.textContent = t('pos.viewCart');

  const mobilePayLabel = rootEl.querySelector('#mobile-cart-pay-label');
  if (mobilePayLabel) mobilePayLabel.textContent = t('pos.pay');

  const viewSwitcher = rootEl.querySelector('#pos-view-switcher');
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
  if (!rootEl) return;
  const viewMode = getValidProductView(getSettings().productView);
  const viewSwitcher = rootEl.querySelector('#pos-view-switcher');
  if (viewSwitcher) {
    viewSwitcher.querySelectorAll('[data-product-view]').forEach((btn) => {
      const active = btn.dataset.productView === viewMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  const gridEl = rootEl.querySelector('#pos-product-grid');
  if (gridEl) {
    gridEl.classList.remove('product-grid--grid', 'product-grid--compact', 'product-grid--list');
    gridEl.classList.add(`product-grid--${viewMode}`);
  }
}

function triggerGridReveal(gridEl) {
  if (!gridEl || prefersReducedMotion()) return;
  if (typeof gridEl.animate === 'function') {
    gridEl.animate(
      [
        { opacity: 0.72, transform: 'translate3d(0, 6px, 0)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      ],
      {
        duration: 180,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }
    );
    return;
  }
  gridEl.classList.remove('is-list-revealing');
  requestAnimationFrame(() => gridEl.classList.add('is-list-revealing'));
}

function bindShellEvents() {
  if (!rootEl) return;

  const searchInput = rootEl.querySelector('#pos-search-input');
  const searchClear = rootEl.querySelector('#pos-search-clear');
  const viewSwitcher = rootEl.querySelector('#pos-view-switcher');
  const fnbBar = rootEl.querySelector('#pos-fnb-bar');
  const tableInput = rootEl.querySelector('#pos-table-input');
  const chipsEl = rootEl.querySelector('#pos-category-chips');
  const gridEl = rootEl.querySelector('#pos-product-grid');
  const cartPanel = rootEl.querySelector('#pos-cart-panel');
  const mobileOpenBtn = rootEl.querySelector('#mobile-cart-open-btn');
  const mobilePayBtn = rootEl.querySelector('#mobile-cart-pay-btn');

  const debouncedFilter = debounce(() => {
    renderProductGrid();
    triggerGridReveal(gridEl);
  }, 110);

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      if (searchClear) {
        searchClear.hidden = !searchQuery;
      }
      debouncedFilter();
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchQuery = '';
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      searchClear.hidden = true;
      renderProductGrid();
      triggerGridReveal(gridEl);
    });
  }

  if (viewSwitcher) {
    viewSwitcher.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-product-view]');
      if (!btn) return;
      const nextView = getValidProductView(btn.dataset.productView);
      const currentView = getValidProductView(getSettings().productView);
      if (nextView === currentView) return;
      store.updateSettings({ productView: nextView });
    });
  }

  if (fnbBar) {
    fnbBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-order-type]');
      if (!btn) return;
      cart.setOrderMeta({ orderType: btn.dataset.orderType });
      syncFnbBar();
    });
  }

  if (tableInput) {
    tableInput.addEventListener('input', (e) => {
      cart.setOrderMeta({ tableNumber: e.target.value });
    });
  }

  if (chipsEl) {
    chipsEl.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-category]');
      if (!chip) return;
      selectedCategory = chip.dataset.category || 'all';
      syncActiveCategoryChip();
      renderProductGrid();
      triggerGridReveal(gridEl);
    });
  }

  if (gridEl) {
    gridEl.addEventListener('click', (e) => {
      const resetBtn = e.target.closest('[data-pos-action="reset-filter"]');
      if (resetBtn) {
        searchQuery = '';
        selectedCategory = 'all';
        if (searchInput) searchInput.value = '';
        if (searchClear) searchClear.hidden = true;
        syncActiveCategoryChip();
        renderProductGrid();
        triggerGridReveal(gridEl);
        return;
      }

      const gotoProductsBtn = e.target.closest('[data-pos-action="goto-products"]');
      if (gotoProductsBtn) {
        bus.emit('nav:goto', 'products');
        return;
      }

      const card = e.target.closest('.product-card[data-product-id]');
      if (!card || card.disabled || card.classList.contains('is-out')) return;
      const productId = card.dataset.productId;
      const product = store.getProductById(productId);
      if (!product) return;

      const wasInCart = (cart.getState().items || []).some((it) => it.productId === productId);
      pendingEnterProductId = wasInCart ? null : productId;

      const res = cart.addItem(product);
      if (!res.ok) {
        pendingEnterProductId = null;
      }
      if (res.ok) {
        const isDesktop = window.innerWidth >= 900;
        const targetEl = isDesktop
          ? rootEl.querySelector('#pos-cart-count') || rootEl.querySelector('#pos-cart-panel')
          : rootEl.querySelector('#mobile-cart-count-val') || rootEl.querySelector('#mobile-cart-bar');

        if (targetEl) {
          flyToCart(card, targetEl, '+1');
        }

        const updatedCard = gridEl.querySelector(
          `.product-card[data-product-id="${CSS.escape(productId)}"]`
        );
        const badge = updatedCard?.querySelector('.product-badge-qty');
        if (badge) {
          popElement(badge);
        }
      }
    });
  }

  if (cartPanel) {
    attachCartInteractionHandlers(cartPanel);
  }

  if (mobileOpenBtn) {
    mobileOpenBtn.addEventListener('click', () => {
      openMobileCartSheet();
    });
  }

  if (mobilePayBtn) {
    mobilePayBtn.addEventListener('click', () => {
      openCheckoutSheet();
    });
  }
}

function attachCartInteractionHandlers(container, { isMobileSheet = false } = {}) {
  container.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-cart-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.cartAction;
    const itemRow = actionEl.closest('.cart-item[data-product-id]');
    const productId = itemRow?.dataset.productId || actionEl.dataset.productId;

    if (action === 'inc' && productId) {
      pendingEnterProductId = null;
      const res = cart.increment(productId);
      if (res.ok) {
        const updatedRow = container.querySelector(
          `.cart-item[data-product-id="${CSS.escape(productId)}"]`
        );
        const valEl = updatedRow?.querySelector('.qty-value');
        if (valEl) popElement(valEl);
      }
      return;
    }

    if (action === 'dec' && productId) {
      const existing = (cart.getState().items || []).find((it) => it.productId === productId);
      if (existing && existing.qty <= 1 && itemRow && !prefersReducedMotion()) {
        if (itemRow.dataset.removing === '1') return;
        itemRow.dataset.removing = '1';
        itemRow.classList.add('is-removing');
        setTimeout(() => {
          cart.decrement(productId);
        }, 175);
      } else {
        cart.decrement(productId);
      }
      return;
    }

    if (action === 'remove' && productId) {
      if (itemRow && !prefersReducedMotion()) {
        if (itemRow.dataset.removing === '1') return;
        itemRow.dataset.removing = '1';
        itemRow.classList.add('is-removing');
        setTimeout(() => {
          cart.removeItem(productId);
        }, 175);
      } else {
        cart.removeItem(productId);
      }
      return;
    }

    if (action === 'options' && productId) {
      openItemOptionsSheet(productId);
      return;
    }

    if (action === 'order-discount') {
      openOrderDiscountSheet();
      return;
    }

    if (action === 'clear') {
      const totals = cart.getTotals();
      if (totals.itemCount === 0) return;
      if (totals.itemCount >= 2 || totals.items.length >= 2) {
        const confirmed = await confirmDialog({
          title: t('pos.clearTitle'),
          message: t('pos.clearMessage', { count: totals.itemCount }),
          confirmText: t('pos.clearCart'),
          cancelText: t('common.cancel'),
          danger: true,
        });
        if (!confirmed) return;
      }
      cart.clear(true);
      toast(t('pos.clearedToast'), 'info');
      if (isMobileSheet) {
        closeSheet('mobile-cart-sheet');
      }
      return;
    }

    if (action === 'checkout') {
      if (isMobileSheet) {
        closeSheet('mobile-cart-sheet');
      }
      openCheckoutSheet();
    }
  });

  container.addEventListener('change', (e) => {
    const toggle = e.target.closest('[data-cart-toggle]');
    if (!toggle) return;
    const kind = toggle.dataset.cartToggle;
    if (kind === 'tax') {
      cart.setTaxEnabled(toggle.checked);
    } else if (kind === 'service') {
      cart.setServiceEnabled(toggle.checked);
    }
  });
}

function syncFnbBar() {
  if (!rootEl) return;
  const fnbBar = rootEl.querySelector('#pos-fnb-bar');
  if (!fnbBar) return;

  const settings = getSettings();
  const isFnb = settings.mode === 'fnb';
  fnbBar.hidden = !isFnb;
  if (!isFnb) return;

  const cartState = cart.getState();
  const buttons = fnbBar.querySelectorAll('[data-order-type]');
  buttons.forEach((btn) => {
    const active = btn.dataset.orderType === cartState.orderType;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const tableWrap = fnbBar.querySelector('#pos-table-input-wrap');
  const tableInput = fnbBar.querySelector('#pos-table-input');
  const isDineIn = cartState.orderType === 'dine-in';

  if (tableWrap) {
    tableWrap.style.display = isDineIn ? 'flex' : 'none';
  }
  if (tableInput) {
    tableInput.disabled = !isDineIn;
    if (document.activeElement !== tableInput && tableInput.value !== cartState.tableNumber) {
      tableInput.value = cartState.tableNumber;
    }
  }
}

function syncActiveCategoryChip() {
  if (!rootEl) return;
  const chipsEl = rootEl.querySelector('#pos-category-chips');
  if (!chipsEl) return;

  chipsEl.querySelectorAll('.chip[data-category]').forEach((chip) => {
    const isActive = (chip.dataset.category || 'all') === selectedCategory;
    chip.classList.toggle('is-active', isActive);
    chip.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function safeCatColor(cat) {
  const col = typeof cat?.color === 'string' ? cat.color.trim() : '';
  return /^#[0-9a-fA-F]{3,8}$/.test(col) ? col : '';
}

function renderCategoryChips() {
  if (!rootEl) return;
  const chipsEl = rootEl.querySelector('#pos-category-chips');
  if (!chipsEl) return;

  const categories = store.getCategories() || [];
  if (
    selectedCategory !== 'all' &&
    !categories.some((cat) => cat.id === selectedCategory)
  ) {
    selectedCategory = 'all';
  }

  const allChip = `
    <button
      type="button"
      class="chip${selectedCategory === 'all' ? ' is-active' : ''}"
      data-category="all"
      role="tab"
      aria-selected="${selectedCategory === 'all' ? 'true' : 'false'}"
    >
      <span>${escapeHtml(t('common.all'))}</span>
    </button>
  `;

  const catChips = categories
    .map((cat) => {
      const active = selectedCategory === cat.id;
      const catTint = safeCatColor(cat);
      return `
        <button
          type="button"
          class="chip${active ? ' is-active' : ''}"
          data-category="${escapeHtml(cat.id)}"
          role="tab"
          aria-selected="${active ? 'true' : 'false'}"
        >
          <span class="chip-cat-icon${catTint ? ' has-cat-tint' : ''}"${catTint ? ` style="--cat-tint:${catTint}"` : ''} aria-hidden="true">${categoryIcon(cat)}</span>
          <span>${escapeHtml(cat.name)}</span>
        </button>
      `;
    })
    .join('');

  chipsEl.innerHTML = allChip + catChips;
}

function renderProductGrid() {
  if (!rootEl) return;
  const gridEl = rootEl.querySelector('#pos-product-grid');
  if (!gridEl) return;

  const settings = getSettings();
  const isRetail = settings.mode === 'retail';
  const viewMode = getValidProductView(settings.productView);
  gridEl.className = `product-grid product-grid--${viewMode}`;
  const allActive = (store.getProducts() || []).filter((p) => p && p.active !== false);
  const filtered = getFilteredProducts();
  const qtyMap = buildCartItemQtyMap(cart.getState());
  const catMap = buildCategoryMap();

  if (filtered.length === 0) {
    const isFiltering = Boolean(searchQuery.trim()) || selectedCategory !== 'all';
    gridEl.innerHTML = `
      <div class="empty-state" style="grid-column:1 / -1;">
        <div class="empty-icon">${icon(allActive.length === 0 ? 'products' : 'search')}</div>
        <h3 class="empty-title">
          ${escapeHtml(allActive.length === 0 ? t('pos.noActiveProductsTitle') : t('pos.notFoundTitle'))}
        </h3>
        <p class="empty-desc">
          ${escapeHtml(allActive.length === 0 ? t('pos.noActiveProductsDesc') : t('pos.notFoundDesc'))}
        </p>
        <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:8px;">
          ${
            isFiltering
              ? `<button type="button" class="btn btn--outlined" data-pos-action="reset-filter">${escapeHtml(t('common.resetFilter'))}</button>`
              : ''
          }
          <button type="button" class="btn btn--primary" data-pos-action="goto-products">
            ${icon('plus')}
            <span>${escapeHtml(allActive.length === 0 ? t('pos.manageProducts') : t('pos.addProduct'))}</span>
          </button>
        </div>
      </div>
    `;
    return;
  }

  gridEl.innerHTML = filtered
    .map((p) => {
      const qtyInCart = qtyMap.get(p.id) || 0;
      const stock = Math.max(0, Math.floor(Number(p.stock) || 0));
      const isOutOfStock = isRetail && stock <= 0;
      const isLowStock = isRetail && stock > 0 && stock <= 5;
      const cat = catMap.get(p.categoryId);
      const catTint = safeCatColor(cat);

      const mediaHtml = p.image
        ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy" />`
        : `<span class="product-cat-icon${catTint ? ' has-cat-tint' : ''}"${catTint ? ` style="--cat-tint:${catTint}"` : ''} aria-hidden="true">${categoryIcon(cat)}</span>`;

      const qtyBadgeHtml =
        qtyInCart > 0
          ? `<span class="product-badge-qty tabular-nums" aria-label="${escapeHtml(t('pos.inCartAria', { qty: qtyInCart }))}">${qtyInCart}</span>`
          : '';

      let stockPillHtml = '';
      let listStockHtml = '';
      if (isRetail) {
        const pillStyle = isOutOfStock
          ? 'background:var(--danger-bg);color:var(--danger);border-color:rgba(185,28,28,0.28);'
          : isLowStock
            ? 'background:var(--warning-bg);color:var(--warning);border-color:rgba(180,83,9,0.28);'
            : '';
        const stockText = isOutOfStock ? t('pos.outOfStock') : t('pos.stockCount', { stock });
        stockPillHtml = `<span class="product-stock-pill" style="${pillStyle}">${escapeHtml(stockText)}</span>`;
        listStockHtml = `<span class="product-list-stock tabular-nums" style="${pillStyle}">${escapeHtml(stockText)}</span>`;
      }

      const metaHtml =
        isRetail && p.sku
          ? `<span>${escapeHtml(p.sku)}</span>`
          : cat
            ? `<span>${escapeHtml(cat.name)}</span>`
            : '';

      const classes = ['product-card'];
      if (qtyInCart > 0) classes.push('is-in-cart');
      if (isOutOfStock) classes.push('is-out');

      return `
        <button
          type="button"
          class="${classes.join(' ')}"
          data-product-id="${escapeHtml(p.id)}"
          ${isOutOfStock ? 'disabled aria-disabled="true"' : ''}
        >
          <div class="product-thumb">
            <div class="product-thumb-media">${mediaHtml}</div>
            ${qtyBadgeHtml}
            ${stockPillHtml}
          </div>
          <div class="product-info">
            <div class="product-info-main">
              <h3 class="product-name">${escapeHtml(p.name)}</h3>
              ${metaHtml ? `<div class="product-meta">${metaHtml}</div>` : ''}
            </div>
            <div class="product-price-col">
              <div class="product-price tabular-nums">${formatRupiah(p.price)}</div>
              ${listStockHtml}
            </div>
          </div>
        </button>
      `;
    })
    .join('');
}

function updateProductCardBadgesOnly() {
  if (!rootEl) return;
  const gridEl = rootEl.querySelector('#pos-product-grid');
  if (!gridEl) return;

  const cards = gridEl.querySelectorAll('.product-card[data-product-id]');
  if (!cards.length) return;

  const qtyMap = buildCartItemQtyMap(cart.getState());
  cards.forEach((card) => {
    const id = card.dataset.productId;
    const qty = qtyMap.get(id) || 0;
    card.classList.toggle('is-in-cart', qty > 0);
    const thumb = card.querySelector('.product-thumb');
    if (!thumb) return;
    let badge = thumb.querySelector('.product-badge-qty');
    if (qty > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'product-badge-qty tabular-nums';
        thumb.appendChild(badge);
      }
      badge.textContent = String(qty);
      badge.setAttribute('aria-label', t('pos.inCartAria', { qty }));
    } else if (badge) {
      badge.remove();
    }
  });
}

function buildCartItemsHtml(totals, { enterId = null } = {}) {
  if (!totals.items.length) {
    return `
      <div class="empty-state" style="padding:36px 16px;">
        <div class="empty-icon">${icon('cart')}</div>
        <h3 class="empty-title">${escapeHtml(t('pos.emptyCartTitle'))}</h3>
        <p class="empty-desc">${escapeHtml(t('pos.emptyCartDesc'))}</p>
      </div>
    `;
  }

  const catMap = buildCategoryMap();

  return totals.items
    .map((item) => {
      const catId = item.categoryId || store.getProductById(item.productId)?.categoryId;
      const cat = catId ? catMap.get(catId) : null;
      const catTint = safeCatColor(cat);
      const thumbHtml = item.image
        ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" style="width:42px;height:42px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0;" />`
        : `<span class="cart-item-cat-icon${catTint ? ' has-cat-tint' : ''}"${catTint ? ` style="--cat-tint:${catTint}"` : ''} aria-hidden="true">${categoryIcon(cat)}</span>`;

      const hasDisc = item.discountAmount > 0;
      const hasNote = Boolean(item.note);

      const pctSuffix = item.discountType === 'pct' ? ` (${item.discountValue}%)` : '';
      const discHtml = hasDisc
        ? `<div class="cart-item-discount">
            ${icon('tag')}
            <span>${escapeHtml(t('pos.itemDiscountTag', { amount: formatRupiah(item.discountAmount), pct: pctSuffix }))}</span>
          </div>`
        : '';

      const noteHtml = hasNote
        ? `<div class="cart-item-note">${escapeHtml(item.note)}</div>`
        : '';

      const rowClasses = ['cart-item'];
      if (enterId && item.productId === enterId) rowClasses.push('is-entering');

      return `
        <div class="${rowClasses.join(' ')}" data-product-id="${escapeHtml(item.productId)}">
          <div class="cart-item-main">
            <div style="display:flex;align-items:flex-start;gap:10px;min-width:0;flex:1;">
              ${thumbHtml}
              <div class="cart-item-meta">
                <div style="font-size:0.9rem;font-weight:700;color:var(--text-primary);line-height:1.25;">${escapeHtml(item.name)}</div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:0.8rem;color:var(--text-muted);">
                  <span class="tabular-nums">${formatRupiah(item.price)}</span>
                  <span>·</span>
                  <span class="tabular-nums" style="color:var(--primary);font-weight:700;">
                    ${hasDisc ? `<s style="color:var(--text-muted);font-weight:500;margin-right:4px;">${formatRupiah(item.grossTotal)}</s>` : ''}${formatRupiah(item.netTotal)}
                  </span>
                </div>
                ${discHtml}
              </div>
            </div>
            <button
              type="button"
              class="icon-btn"
              data-cart-action="remove"
              aria-label="${escapeHtml(t('pos.removeItemAria', { name: item.name }))}"
              style="color:var(--text-muted);flex-shrink:0;"
            >
              ${icon('trash')}
            </button>
          </div>
          ${noteHtml}
          <div class="cart-item-actions">
            <div class="qty-stepper" aria-label="${escapeHtml(t('pos.qtyAria', { name: item.name }))}">
              <button
                type="button"
                class="qty-btn"
                data-cart-action="dec"
                aria-label="${escapeHtml(t('pos.decQtyAria'))}"
              >
                ${icon('minus')}
              </button>
              <span class="qty-value tabular-nums">${item.qty}</span>
              <button
                type="button"
                class="qty-btn"
                data-cart-action="inc"
                aria-label="${escapeHtml(t('pos.incQtyAria'))}"
              >
                ${icon('plus')}
              </button>
            </div>
            <button
              type="button"
              class="btn ${hasDisc || hasNote ? 'btn--tonal' : 'btn--outlined'} btn--sm"
              data-cart-action="options"
            >
              ${icon('edit')}
              <span>${escapeHtml(t('pos.discountNoteBtn'))}</span>
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

function getOrderDiscountLabel(cartState, totals) {
  if (totals.orderDiscountAmount > 0) {
    const pct = cartState.orderDiscountType === 'pct' ? ` / ${cartState.orderDiscountValue}%` : '';
    return t('pos.orderDiscountActive', {
      amount: formatRupiah(totals.orderDiscountAmount),
      pct,
    });
  }
  return t('pos.orderDiscount');
}

function buildCartAdjustmentsHtml(cartState, totals) {
  const scope = cartState._scope || 'desktop';
  const hasOrderDisc = totals.orderDiscountAmount > 0;
  const discLabel = escapeHtml(getOrderDiscountLabel(cartState, totals));

  const serviceRowHtml = totals.serviceAllowed
    ? `
      <div data-cart-row="service" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 2px;">
        <label class="switch" for="cart-toggle-service-${scope}" style="width:100%;justify-content:space-between;">
          <span data-cart-toggle-label="service" style="font-size:0.84rem;font-weight:600;color:var(--text-secondary);">
            ${escapeHtml(totals.serviceLabel)} (${escapeHtml(totals.serviceRate)}%)
          </span>
          <span style="position:relative;display:inline-flex;align-items:center;">
            <input
              type="checkbox"
              class="switch-input"
              id="cart-toggle-service-${scope}"
              data-cart-toggle="service"
              ${cartState.serviceEnabled ? 'checked' : ''}
            />
            <span class="switch-track"></span>
          </span>
        </label>
      </div>
    `
    : '';

  const taxRowHtml = totals.taxAllowed
    ? `
      <div data-cart-row="tax" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 2px;">
        <label class="switch" for="cart-toggle-tax-${scope}" style="width:100%;justify-content:space-between;">
          <span data-cart-toggle-label="tax" style="font-size:0.84rem;font-weight:600;color:var(--text-secondary);">
            ${escapeHtml(t('pos.taxSwitch', { label: totals.taxLabel, rate: totals.taxRate }))}
          </span>
          <span style="position:relative;display:inline-flex;align-items:center;">
            <input
              type="checkbox"
              class="switch-input"
              id="cart-toggle-tax-${scope}"
              data-cart-toggle="tax"
              ${cartState.taxEnabled ? 'checked' : ''}
            />
            <span class="switch-track"></span>
          </span>
        </label>
      </div>
    `
    : '';

  return `
    <div style="width:100%;display:flex;flex-direction:column;gap:4px;">
      <button
        type="button"
        class="btn ${hasOrderDisc ? 'btn--tonal' : 'btn--outlined'} btn--sm btn--block"
        data-cart-action="order-discount"
        style="justify-content:space-between;"
        ${totals.itemCount === 0 ? 'disabled' : ''}
      >
        <span style="display:inline-flex;align-items:center;gap:6px;">
          ${icon('percent')}
          <span class="tabular-nums" data-order-disc-label>${discLabel}</span>
        </span>
        ${icon('chevronRight')}
      </button>
      ${serviceRowHtml}
      ${taxRowHtml}
    </div>
  `;
}

function syncCartAdjustments(adjEl, scope, cartState, totals) {
  if (!adjEl) return;
  const discBtn = adjEl.querySelector('[data-cart-action="order-discount"]');
  const hasServiceRow = Boolean(adjEl.querySelector('[data-cart-row="service"]'));
  const hasTaxRow = Boolean(adjEl.querySelector('[data-cart-row="tax"]'));

  if (
    !discBtn ||
    hasServiceRow !== Boolean(totals.serviceAllowed) ||
    hasTaxRow !== Boolean(totals.taxAllowed)
  ) {
    adjEl.innerHTML = buildCartAdjustmentsHtml({ ...cartState, _scope: scope }, totals);
    return;
  }

  const hasOrderDisc = totals.orderDiscountAmount > 0;
  discBtn.disabled = totals.itemCount === 0;
  discBtn.classList.toggle('btn--tonal', hasOrderDisc);
  discBtn.classList.toggle('btn--outlined', !hasOrderDisc);

  const discLabelEl = discBtn.querySelector('[data-order-disc-label]');
  if (discLabelEl) {
    discLabelEl.textContent = getOrderDiscountLabel(cartState, totals);
  }

  const serviceLabelEl = adjEl.querySelector('[data-cart-toggle-label="service"]');
  if (serviceLabelEl) {
    serviceLabelEl.textContent = `${totals.serviceLabel} (${totals.serviceRate}%)`;
  }
  const serviceToggle = adjEl.querySelector('[data-cart-toggle="service"]');
  if (serviceToggle) {
    serviceToggle.checked = Boolean(cartState.serviceEnabled);
  }

  const taxLabelEl = adjEl.querySelector('[data-cart-toggle-label="tax"]');
  if (taxLabelEl) {
    taxLabelEl.textContent = t('pos.taxSwitch', {
      label: totals.taxLabel,
      rate: totals.taxRate,
    });
  }
  const taxToggle = adjEl.querySelector('[data-cart-toggle="tax"]');
  if (taxToggle) {
    taxToggle.checked = Boolean(cartState.taxEnabled);
  }
}

function buildCartSummaryRowsHtml(totals) {
  const rows = [];

  if (totals.itemDiscountTotal > 0) {
    rows.push(`
      <div class="cart-summary-row">
        <span>${escapeHtml(t('pos.rawSubtotal'))}</span>
        <span class="tabular-nums">${formatRupiah(totals.rawSubtotal)}</span>
      </div>
      <div class="cart-summary-row" style="color:var(--success);">
        <span>${escapeHtml(t('pos.itemDiscountRow'))}</span>
        <span class="tabular-nums">-${formatRupiah(totals.itemDiscountTotal)}</span>
      </div>
      <div class="cart-summary-row">
        <span>${escapeHtml(t('common.subtotal'))}</span>
        <span class="tabular-nums">${formatRupiah(totals.subtotal)}</span>
      </div>
    `);
  } else {
    rows.push(`
      <div class="cart-summary-row">
        <span>${escapeHtml(t('common.subtotal'))}</span>
        <span class="tabular-nums">${formatRupiah(totals.subtotal)}</span>
      </div>
    `);
  }

  if (totals.orderDiscountAmount > 0) {
    rows.push(`
      <div class="cart-summary-row" style="color:var(--success);">
        <span>${escapeHtml(t('pos.orderDiscount'))}</span>
        <span class="tabular-nums">-${formatRupiah(totals.orderDiscountAmount)}</span>
      </div>
    `);
  }

  if (totals.serviceAmount > 0) {
    rows.push(`
      <div class="cart-summary-row">
        <span>${escapeHtml(totals.serviceLabel)} (${escapeHtml(totals.serviceRate)}%)</span>
        <span class="tabular-nums">${formatRupiah(totals.serviceAmount)}</span>
      </div>
    `);
  }

  if (totals.taxAmount > 0) {
    rows.push(`
      <div class="cart-summary-row">
        <span>${escapeHtml(totals.taxLabel)} (${escapeHtml(totals.taxRate)}%)</span>
        <span class="tabular-nums">${formatRupiah(totals.taxAmount)}</span>
      </div>
    `);
  }

  return rows.join('');
}

function renderDesktopCart(animOpts = {}) {
  if (!rootEl) return;
  const cartState = cart.getState();
  const totals = cart.getTotals();

  const countEl = rootEl.querySelector('#pos-cart-count');
  const clearBtn = rootEl.querySelector('#pos-cart-clear-btn');
  const itemsEl = rootEl.querySelector('#pos-cart-items');
  const adjEl = rootEl.querySelector('#pos-cart-adjustments');
  const summaryRowsEl = rootEl.querySelector('#pos-cart-summary-rows');
  const totalValEl = rootEl.querySelector('#pos-cart-total-val');
  const payBtn = rootEl.querySelector('#pos-pay-btn');
  const payAmountEl = rootEl.querySelector('#pos-pay-btn-amount');

  if (countEl) {
    countEl.textContent = String(totals.itemCount);
  }
  if (clearBtn) {
    clearBtn.disabled = totals.itemCount === 0;
  }
  if (itemsEl) {
    const prevScroll = itemsEl.scrollTop;
    itemsEl.innerHTML = buildCartItemsHtml(totals, animOpts);
    itemsEl.scrollTop = prevScroll;
  }
  if (adjEl) {
    syncCartAdjustments(adjEl, 'desktop', cartState, totals);
  }
  if (summaryRowsEl) {
    summaryRowsEl.innerHTML = buildCartSummaryRowsHtml(totals);
  }
  if (totalValEl) {
    animateRupiah(totalValEl, totals.grandTotal);
  }
  if (payBtn) {
    payBtn.disabled = totals.itemCount === 0;
  }
  if (payAmountEl) {
    animateRupiah(payAmountEl, totals.grandTotal);
  }
}

function renderMobileCartBar() {
  if (!rootEl) return;
  const barEl = rootEl.querySelector('#mobile-cart-bar');
  if (!barEl) return;

  const totals = cart.getTotals();
  const isEmpty = totals.itemCount === 0;
  barEl.classList.toggle('is-hidden', isEmpty);
  barEl.setAttribute('aria-hidden', isEmpty ? 'true' : 'false');

  const openBtn = barEl.querySelector('#mobile-cart-open-btn');
  const countEl = barEl.querySelector('#mobile-cart-count-val');
  const totalEl = barEl.querySelector('#mobile-cart-total-val');
  const payBtn = barEl.querySelector('#mobile-cart-pay-btn');

  if (openBtn) {
    openBtn.disabled = isEmpty;
    openBtn.tabIndex = isEmpty ? -1 : 0;
  }
  if (countEl) {
    animateNumber(countEl, totals.itemCount);
  }
  if (totalEl) {
    animateRupiah(totalEl, totals.grandTotal);
  }
  if (payBtn) {
    payBtn.disabled = isEmpty;
    payBtn.tabIndex = isEmpty ? -1 : 0;
  }
}

function syncMobileCartSheet(animOpts = {}) {
  if (!mobileCartSheetPanel || !document.body.contains(mobileCartSheetPanel)) {
    mobileCartSheetPanel = null;
    return;
  }

  const cartState = cart.getState();
  const totals = cart.getTotals();

  const countEl = mobileCartSheetPanel.querySelector('[data-mobile-sheet="count"]');
  const clearBtn = mobileCartSheetPanel.querySelector('[data-cart-action="clear"]');
  const itemsEl = mobileCartSheetPanel.querySelector('[data-mobile-sheet="items"]');
  const adjEl = mobileCartSheetPanel.querySelector('[data-mobile-sheet="adjustments"]');
  const rowsEl = mobileCartSheetPanel.querySelector('[data-mobile-sheet="summary-rows"]');
  const totalEl = mobileCartSheetPanel.querySelector('[data-mobile-sheet="total"]');
  const payBtn = mobileCartSheetPanel.querySelector('[data-cart-action="checkout"]');
  const payAmountEl = mobileCartSheetPanel.querySelector('[data-mobile-sheet="pay-amount"]');

  if (countEl) countEl.textContent = t('pos.countItems', { count: totals.itemCount });
  if (clearBtn) clearBtn.disabled = totals.itemCount === 0;
  if (itemsEl) {
    const prevScroll = itemsEl.scrollTop;
    itemsEl.innerHTML = buildCartItemsHtml(totals, animOpts);
    itemsEl.scrollTop = prevScroll;
  }
  if (adjEl) {
    syncCartAdjustments(adjEl, 'mobile', cartState, totals);
  }
  if (rowsEl) rowsEl.innerHTML = buildCartSummaryRowsHtml(totals);
  if (totalEl) animateRupiah(totalEl, totals.grandTotal);
  if (payBtn) payBtn.disabled = totals.itemCount === 0;
  if (payAmountEl) animateRupiah(payAmountEl, totals.grandTotal);
}

function openMobileCartSheet() {
  const sheetId = 'mobile-cart-sheet';
  const totals = cart.getTotals();

  const contentHtml = `
    <div class="pos-cart-panel">
      <div class="cart-header" style="padding:0 0 12px;">
        <span class="badge badge--primary tabular-nums" data-mobile-sheet="count">${escapeHtml(t('pos.countItems', { count: totals.itemCount }))}</span>
        <button
          type="button"
          class="btn btn--text btn--sm"
          data-cart-action="clear"
          ${totals.itemCount === 0 ? 'disabled' : ''}
        >
          ${icon('trash')}
          <span>${escapeHtml(t('pos.clearCart'))}</span>
        </button>
      </div>
      <div class="cart-items" data-mobile-sheet="items" style="padding:12px 0;"></div>
      <div class="cart-adjustments" data-mobile-sheet="adjustments" style="padding:10px 0;"></div>
      <div class="cart-summary" style="padding:12px 0 0;">
        <div data-mobile-sheet="summary-rows" style="display:flex;flex-direction:column;gap:6px;"></div>
        <div class="cart-summary-total">
          <span>${escapeHtml(t('common.total'))}</span>
          <strong class="tabular-nums" data-mobile-sheet="total">${formatRupiah(totals.grandTotal)}</strong>
        </div>
      </div>
    </div>
  `;

  const footerHtml = `
    <button
      type="button"
      class="btn btn--primary btn--lg btn--block"
      data-cart-action="checkout"
      ${totals.itemCount === 0 ? 'disabled' : ''}
    >
      <span>${escapeHtml(t('pos.pay'))}</span>
      <span class="tabular-nums" data-mobile-sheet="pay-amount">${formatRupiah(totals.grandTotal)}</span>
    </button>
  `;

  openSheet({
    id: sheetId,
    title: t('pos.cartTitle'),
    size: 'lg',
    contentHtml,
    footerHtml,
    onMount(panelEl) {
      mobileCartSheetPanel = panelEl;
      attachCartInteractionHandlers(panelEl, { isMobileSheet: true });
      syncMobileCartSheet();
    },
    onClose() {
      mobileCartSheetPanel = null;
    },
  });
}

function openItemOptionsSheet(productId) {
  const cartState = cart.getState();
  const item = cartState.items.find((it) => it.productId === productId);
  if (!item) return;

  const settings = getSettings();
  const sheetId = 'item-options-sheet';
  const grossTotal = item.price * item.qty;

  let currentType = item.discountType || 'none';
  let currentValue = Number(item.discountValue) || 0;
  let currentNote = String(item.note || '');

  const fnbChipsHtml =
    settings.mode === 'fnb'
      ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
          ${getFnbNoteChips()
            .map(
              (chip) =>
                `<button type="button" class="chip" data-note-preset="${escapeHtml(chip)}" style="min-height:36px;padding:0 12px;font-size:0.8rem;">${escapeHtml(chip)}</button>`
            )
            .join('')}
        </div>`
      : '';

  const contentHtml = `
    <div class="card" style="margin-bottom:14px;padding:12px 14px;background:var(--bg-surface-2);">
      <div style="font-weight:700;color:var(--text-primary);">${escapeHtml(item.name)}</div>
      <div class="tabular-nums" style="font-size:0.84rem;color:var(--text-secondary);margin-top:2px;">
        ${item.qty} x ${formatRupiah(item.price)} = <strong>${formatRupiah(grossTotal)}</strong>
      </div>
    </div>

    <div class="field">
      <label class="field-label">${escapeHtml(t('pos.itemDiscountLabel'))}</label>
      <div class="seg-control" role="group" aria-label="${escapeHtml(t('pos.discountTypeAria'))}" style="width:100%;">
        <button type="button" class="seg-btn${currentType === 'none' ? ' is-active' : ''}" data-disc-type="none">${escapeHtml(t('common.none'))}</button>
        <button type="button" class="seg-btn${currentType === 'rp' ? ' is-active' : ''}" data-disc-type="rp">${escapeHtml(t('pos.nominalRp'))}</button>
        <button type="button" class="seg-btn${currentType === 'pct' ? ' is-active' : ''}" data-disc-type="pct">${escapeHtml(t('pos.percentPct'))}</button>
      </div>
    </div>

    <div class="field" data-disc-value-wrap ${currentType === 'none' ? 'hidden' : ''}>
      <label class="field-label" data-disc-value-label>
        ${escapeHtml(currentType === 'pct' ? t('pos.pctInputLabel') : t('pos.rpInputLabel'))}
      </label>
      <input
        type="text"
        inputmode="numeric"
        class="input tabular-nums"
        data-disc-value-input
        value="${currentType === 'rp' ? formatNumberPlain(currentValue) : currentValue || ''}"
        placeholder="${escapeHtml(currentType === 'pct' ? t('pos.pctPlaceholder') : t('pos.rpPlaceholder'))}"
      />
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;" data-disc-presets></div>
      <div class="field-hint tabular-nums" data-disc-preview></div>
    </div>

    <div class="field">
      <label class="field-label" for="item-note-input">${escapeHtml(t('pos.itemNoteLabel'))}</label>
      <input
        type="text"
        id="item-note-input"
        class="input"
        data-item-note-input
        value="${escapeHtml(currentNote)}"
        placeholder="${escapeHtml(t('pos.itemNotePlaceholder'))}"
        maxlength="120"
      />
      ${fnbChipsHtml}
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn--outlined" data-opt-action="cancel">${escapeHtml(t('common.cancel'))}</button>
    <button type="button" class="btn btn--primary" data-opt-action="save">${escapeHtml(t('common.save'))}</button>
  `;

  openSheet({
    id: sheetId,
    title: t('pos.itemOptionsTitle'),
    size: 'sm',
    contentHtml,
    footerHtml,
    onMount(panelEl) {
      const typeBtns = panelEl.querySelectorAll('[data-disc-type]');
      const valueWrap = panelEl.querySelector('[data-disc-value-wrap]');
      const valueLabel = panelEl.querySelector('[data-disc-value-label]');
      const valueInput = panelEl.querySelector('[data-disc-value-input]');
      const presetsEl = panelEl.querySelector('[data-disc-presets]');
      const previewEl = panelEl.querySelector('[data-disc-preview]');
      const noteInput = panelEl.querySelector('[data-item-note-input]');

      function renderPresetsAndPreview() {
        typeBtns.forEach((btn) => {
          btn.classList.toggle('is-active', btn.dataset.discType === currentType);
        });
        if (valueWrap) valueWrap.hidden = currentType === 'none';
        if (valueLabel) {
          valueLabel.textContent =
            currentType === 'pct' ? t('pos.pctInputLabel') : t('pos.rpInputLabel');
        }
        if (presetsEl) {
          if (currentType === 'pct') {
            presetsEl.innerHTML = [5, 10, 15, 20, 50]
              .map(
                (v) =>
                  `<button type="button" class="chip tabular-nums" data-disc-preset="${v}" style="min-height:36px;padding:0 12px;font-size:0.8rem;">${v}%</button>`
              )
              .join('');
          } else if (currentType === 'rp') {
            presetsEl.innerHTML = [2000, 5000, 10000, 20000]
              .map(
                (v) =>
                  `<button type="button" class="chip tabular-nums" data-disc-preset="${v}" style="min-height:36px;padding:0 12px;font-size:0.8rem;">${formatRupiah(v)}</button>`
              )
              .join('');
          } else {
            presetsEl.innerHTML = '';
          }
        }

        let discAmt = 0;
        if (currentType === 'pct') {
          discAmt = Math.round((grossTotal * clamp(currentValue, 0, 100)) / 100);
        } else if (currentType === 'rp') {
          discAmt = clamp(Math.round(currentValue), 0, grossTotal);
        }
        const net = Math.max(0, grossTotal - discAmt);
        if (previewEl) {
          previewEl.textContent = t('pos.discPreview', {
            disc: formatRupiah(discAmt),
            net: formatRupiah(net),
          });
        }
      }

      panelEl.addEventListener('click', (e) => {
        const typeBtn = e.target.closest('[data-disc-type]');
        if (typeBtn) {
          currentType = typeBtn.dataset.discType;
          currentValue = 0;
          if (valueInput) {
            valueInput.value = '';
            valueInput.placeholder =
              currentType === 'pct' ? t('pos.pctPlaceholder') : t('pos.rpPlaceholder');
          }
          renderPresetsAndPreview();
          if (currentType !== 'none' && valueInput) valueInput.focus();
          return;
        }

        const presetBtn = e.target.closest('[data-disc-preset]');
        if (presetBtn) {
          currentValue = Number(presetBtn.dataset.discPreset) || 0;
          if (valueInput) {
            valueInput.value =
              currentType === 'rp' ? formatNumberPlain(currentValue) : String(currentValue);
          }
          renderPresetsAndPreview();
          return;
        }

        const noteChip = e.target.closest('[data-note-preset]');
        if (noteChip && noteInput) {
          const phrase = noteChip.dataset.notePreset;
          const existing = noteInput.value.trim();
          if (!existing) {
            noteInput.value = phrase;
          } else if (!existing.toLowerCase().includes(phrase.toLowerCase())) {
            noteInput.value = `${existing}, ${phrase}`;
          }
          currentNote = noteInput.value;
          return;
        }

        const actionBtn = e.target.closest('[data-opt-action]');
        if (actionBtn) {
          const act = actionBtn.dataset.optAction;
          if (act === 'cancel') {
            closeSheet(sheetId);
          } else if (act === 'save') {
            const finalVal =
              currentType === 'pct'
                ? clamp(currentValue, 0, 100)
                : currentType === 'rp'
                  ? clamp(Math.round(currentValue), 0, grossTotal)
                  : 0;
            cart.updateItemOptions(productId, {
              discountType: finalVal > 0 ? currentType : 'none',
              discountValue: finalVal,
              note: noteInput ? noteInput.value.trim() : currentNote,
            });
            closeSheet(sheetId);
          }
        }
      });

      if (valueInput) {
        valueInput.addEventListener('input', (e) => {
          const parsed = parseRupiahInput(e.target.value);
          if (currentType === 'pct') {
            currentValue = clamp(parsed, 0, 100);
            e.target.value = currentValue ? String(currentValue) : '';
          } else {
            currentValue = parsed;
            e.target.value = formatNumberPlain(currentValue);
          }
          renderPresetsAndPreview();
        });
      }

      if (noteInput) {
        noteInput.addEventListener('input', (e) => {
          currentNote = e.target.value;
        });
      }

      renderPresetsAndPreview();
    },
  });
}

function openOrderDiscountSheet() {
  const cartState = cart.getState();
  const totals = cart.getTotals();
  if (totals.itemCount === 0) return;

  const sheetId = 'order-discount-sheet';
  const baseSubtotal = totals.subtotal;
  let currentType = cartState.orderDiscountType || 'none';
  let currentValue = Number(cartState.orderDiscountValue) || 0;

  const contentHtml = `
    <div class="card" style="margin-bottom:14px;padding:12px 14px;background:var(--bg-surface-2);display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:0.86rem;color:var(--text-secondary);font-weight:600;">${escapeHtml(t('pos.orderSubtotalCard'))}</span>
      <strong class="tabular-nums" style="font-size:1.05rem;">${formatRupiah(baseSubtotal)}</strong>
    </div>

    <div class="field">
      <label class="field-label">${escapeHtml(t('pos.orderDiscountTypeLabel'))}</label>
      <div class="seg-control" role="group" aria-label="${escapeHtml(t('pos.orderDiscountTypeAria'))}" style="width:100%;">
        <button type="button" class="seg-btn${currentType === 'none' ? ' is-active' : ''}" data-od-type="none">${escapeHtml(t('common.none'))}</button>
        <button type="button" class="seg-btn${currentType === 'rp' ? ' is-active' : ''}" data-od-type="rp">${escapeHtml(t('pos.nominalRp'))}</button>
        <button type="button" class="seg-btn${currentType === 'pct' ? ' is-active' : ''}" data-od-type="pct">${escapeHtml(t('pos.percentPct'))}</button>
      </div>
    </div>

    <div class="field" data-od-value-wrap ${currentType === 'none' ? 'hidden' : ''}>
      <label class="field-label" data-od-value-label>
        ${escapeHtml(currentType === 'pct' ? t('pos.pctInputLabel') : t('pos.rpInputLabel'))}
      </label>
      <input
        type="text"
        inputmode="numeric"
        class="input tabular-nums"
        data-od-value-input
        value="${currentType === 'rp' ? formatNumberPlain(currentValue) : currentValue || ''}"
        placeholder="${escapeHtml(currentType === 'pct' ? t('pos.pctPlaceholder') : t('pos.orderRpPlaceholder'))}"
      />
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;" data-od-presets></div>
      <div class="field-hint tabular-nums" data-od-preview></div>
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn--outlined" data-od-action="cancel">${escapeHtml(t('common.cancel'))}</button>
    <button type="button" class="btn btn--primary" data-od-action="save">${escapeHtml(t('common.apply'))}</button>
  `;

  openSheet({
    id: sheetId,
    title: t('pos.orderDiscount'),
    size: 'sm',
    contentHtml,
    footerHtml,
    onMount(panelEl) {
      const typeBtns = panelEl.querySelectorAll('[data-od-type]');
      const valueWrap = panelEl.querySelector('[data-od-value-wrap]');
      const valueLabel = panelEl.querySelector('[data-od-value-label]');
      const valueInput = panelEl.querySelector('[data-od-value-input]');
      const presetsEl = panelEl.querySelector('[data-od-presets]');
      const previewEl = panelEl.querySelector('[data-od-preview]');

      function syncView() {
        typeBtns.forEach((btn) => {
          btn.classList.toggle('is-active', btn.dataset.odType === currentType);
        });
        if (valueWrap) valueWrap.hidden = currentType === 'none';
        if (valueLabel) {
          valueLabel.textContent =
            currentType === 'pct' ? t('pos.pctInputLabel') : t('pos.rpInputLabel');
        }
        if (presetsEl) {
          if (currentType === 'pct') {
            presetsEl.innerHTML = [5, 10, 15, 20, 25]
              .map(
                (v) =>
                  `<button type="button" class="chip tabular-nums" data-od-preset="${v}" style="min-height:36px;padding:0 12px;font-size:0.8rem;">${v}%</button>`
              )
              .join('');
          } else if (currentType === 'rp') {
            presetsEl.innerHTML = [5000, 10000, 20000, 50000]
              .map(
                (v) =>
                  `<button type="button" class="chip tabular-nums" data-od-preset="${v}" style="min-height:36px;padding:0 12px;font-size:0.8rem;">${formatRupiah(v)}</button>`
              )
              .join('');
          } else {
            presetsEl.innerHTML = '';
          }
        }

        let discAmt = 0;
        if (currentType === 'pct') {
          discAmt = Math.round((baseSubtotal * clamp(currentValue, 0, 100)) / 100);
        } else if (currentType === 'rp') {
          discAmt = clamp(Math.round(currentValue), 0, baseSubtotal);
        }
        const afterDisc = Math.max(0, baseSubtotal - discAmt);
        if (previewEl) {
          previewEl.textContent = t('pos.orderDiscPreview', {
            disc: formatRupiah(discAmt),
            after: formatRupiah(afterDisc),
          });
        }
      }

      panelEl.addEventListener('click', (e) => {
        const typeBtn = e.target.closest('[data-od-type]');
        if (typeBtn) {
          currentType = typeBtn.dataset.odType;
          currentValue = 0;
          if (valueInput) {
            valueInput.value = '';
            valueInput.placeholder =
              currentType === 'pct' ? t('pos.pctPlaceholder') : t('pos.orderRpPlaceholder');
          }
          syncView();
          if (currentType !== 'none' && valueInput) valueInput.focus();
          return;
        }

        const presetBtn = e.target.closest('[data-od-preset]');
        if (presetBtn) {
          currentValue = Number(presetBtn.dataset.odPreset) || 0;
          if (valueInput) {
            valueInput.value =
              currentType === 'rp' ? formatNumberPlain(currentValue) : String(currentValue);
          }
          syncView();
          return;
        }

        const actBtn = e.target.closest('[data-od-action]');
        if (actBtn) {
          const act = actBtn.dataset.odAction;
          if (act === 'cancel') {
            closeSheet(sheetId);
          } else if (act === 'save') {
            const finalVal =
              currentType === 'pct'
                ? clamp(currentValue, 0, 100)
                : currentType === 'rp'
                  ? clamp(Math.round(currentValue), 0, baseSubtotal)
                  : 0;
            cart.setOrderDiscount(finalVal > 0 ? currentType : 'none', finalVal);
            closeSheet(sheetId);
          }
        }
      });

      if (valueInput) {
        valueInput.addEventListener('input', (e) => {
          const parsed = parseRupiahInput(e.target.value);
          if (currentType === 'pct') {
            currentValue = clamp(parsed, 0, 100);
            e.target.value = currentValue ? String(currentValue) : '';
          } else {
            currentValue = parsed;
            e.target.value = formatNumberPlain(currentValue);
          }
          syncView();
        });
      }

      syncView();
    },
  });
}

function computeCashPresets(grandTotal) {
  const presets = [{ label: t('pos.exactCash'), amount: grandTotal, isExact: true }];
  const seen = new Set([grandTotal]);

  const smartCandidates = [
    Math.ceil(grandTotal / 5000) * 5000,
    Math.ceil(grandTotal / 10000) * 10000,
    Math.ceil(grandTotal / 50000) * 50000,
  ];
  for (const val of smartCandidates) {
    if (val > grandTotal && !seen.has(val)) {
      presets.push({ label: formatRupiah(val), amount: val, isSmart: true });
      seen.add(val);
      break;
    }
  }

  for (const bill of [20000, 50000, 100000, 200000]) {
    if (!seen.has(bill)) {
      presets.push({ label: formatRupiah(bill), amount: bill });
      seen.add(bill);
    }
  }

  return presets;
}

function generateLocalQrisSvg(seedText) {
  const size = 25;
  const grid = Array.from({ length: size }, () => Array(size).fill(0));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));

  function drawFinder(r0, c0) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        reserved[rr][cc] = true;
        if (r === -1 || r === 7 || c === -1 || c === 7) {
          grid[rr][cc] = 0;
        } else if (
          r === 0 ||
          r === 6 ||
          c === 0 ||
          c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ) {
          grid[rr][cc] = 1;
        } else {
          grid[rr][cc] = 0;
        }
      }
    }
  }

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const rr = 18 + r;
      const cc = 18 + c;
      reserved[rr][cc] = true;
      const border = Math.abs(r) === 2 || Math.abs(c) === 2;
      const center = r === 0 && c === 0;
      grid[rr][cc] = border || center ? 1 : 0;
    }
  }

  for (let i = 8; i < size - 8; i++) {
    reserved[6][i] = true;
    grid[6][i] = i % 2 === 0 ? 1 : 0;
    reserved[i][6] = true;
    grid[i][6] = i % 2 === 0 ? 1 : 0;
  }

  let h = 2166136261;
  const str = String(seedText || 'AruPOS-QRIS');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let x = (h >>> 0) || 123456789;
  const nextBit = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % 2;
  };

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c]) {
        grid[r][c] = nextBit();
      }
    }
  }

  const rects = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) {
        rects.push(`<rect x="${c + 2}" y="${r + 2}" width="1" height="1"/>`);
      }
    }
  }

  const vb = size + 4;
  return `
    <svg
      viewBox="0 0 ${vb} ${vb}"
      width="180"
      height="180"
      role="img"
      aria-label="${escapeHtml(t('pos.qrisAria'))}"
      shape-rendering="crispEdges"
      style="border-radius:10px;border:1px solid var(--border-subtle);"
    >
      <rect width="${vb}" height="${vb}" rx="1.5" fill="#ffffff"/>
      <g fill="#111827">${rects.join('')}</g>
    </svg>
  `;
}

function openCheckoutSheet() {
  const cartState = cart.getState();
  const totals = cart.getTotals();
  const settings = getSettings();

  if (totals.itemCount === 0) {
    toast(t('pos.cartEmptyWarning'), 'warning');
    return;
  }

  const sheetId = 'checkout-sheet';
  const grandTotal = totals.grandTotal;
  const cashPresets = computeCashPresets(grandTotal);

  let selectedMethod = 'cash';
  let cashReceived = 0;
  let transferNote = '';
  let selectedEwallet = 'GoPay';
  let customEwalletName = '';
  let customerName = cartState.customerName || '';
  let isSubmitting = false;

  const orderBadge =
    settings.mode === 'fnb'
      ? cartState.orderType === 'dine-in'
        ? cartState.tableNumber.trim()
          ? t('receipt.dineInTable', { table: cartState.tableNumber.trim() })
          : t('receipt.dineIn')
        : t('receipt.takeaway')
      : t('receipt.retail');

  const qrisSeed = `${settings.storeName || 'AruPOS'}|${grandTotal}|${totals.itemCount}|${Date.now()}`;
  const qrisSvg = generateLocalQrisSvg(qrisSeed);

  const ewalletButtonsHtml = [
    ...EWALLET_PROVIDERS.map(
      (prov) => `
      <button
        type="button"
        class="chip${prov === selectedEwallet ? ' is-active' : ''}"
        data-ewallet-provider="${escapeHtml(prov)}"
      >
        ${escapeHtml(prov)}
      </button>
    `
    ),
    `
      <button
        type="button"
        class="chip"
        data-ewallet-provider="${EWALLET_OTHER_ID}"
      >
        ${escapeHtml(t('pos.other'))}
      </button>
    `,
  ].join('');

  const contentHtml = `
    <div class="card" style="margin-bottom:14px;background:var(--primary-container);border-color:transparent;color:var(--on-primary-container);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;">
        <span style="font-size:0.8rem;font-weight:700;opacity:0.85;">${escapeHtml(t('pos.amountDue'))}</span>
        <span class="badge badge--primary" style="background:var(--bg-surface);color:var(--primary);">${escapeHtml(orderBadge)} · ${escapeHtml(t('pos.countItems', { count: totals.itemCount }))}</span>
      </div>
      <div class="tabular-nums" style="font-size:1.65rem;font-weight:900;letter-spacing:-0.02em;">${formatRupiah(grandTotal)}</div>
    </div>

    <div class="field">
      <label class="field-label" for="checkout-customer-input">${escapeHtml(t('pos.customerLabel'))}</label>
      <input
        type="text"
        id="checkout-customer-input"
        class="input"
        value="${escapeHtml(customerName)}"
        placeholder="${escapeHtml(t('pos.customerPlaceholder'))}"
        maxlength="60"
      />
    </div>

    <div class="field">
      <label class="field-label">${escapeHtml(t('pos.paymentMethodLabel'))}</label>
      <div class="checkout-methods" role="radiogroup" aria-label="${escapeHtml(t('pos.paymentMethodAria'))}" style="margin-bottom:0;">
        <button type="button" class="method-card is-selected" data-pay-method="cash" aria-checked="true">
          ${icon('cash')}
          <span>${escapeHtml(t('payment.cash'))}</span>
        </button>
        <button type="button" class="method-card" data-pay-method="qris" aria-checked="false">
          ${icon('qris')}
          <span>${escapeHtml(t('payment.qris'))}</span>
        </button>
        <button type="button" class="method-card" data-pay-method="transfer" aria-checked="false">
          ${icon('bank')}
          <span>${escapeHtml(t('payment.transfer'))}</span>
        </button>
        <button type="button" class="method-card" data-pay-method="ewallet" aria-checked="false">
          ${icon('wallet')}
          <span>${escapeHtml(t('payment.ewallet'))}</span>
        </button>
      </div>
    </div>

    <div data-pay-panel="cash">
      <div class="field" style="margin-top:12px;">
        <label class="field-label" for="checkout-cash-input">${escapeHtml(t('pos.cashReceivedLabel'))}</label>
        <div style="position:relative;display:flex;align-items:center;">
          <span style="position:absolute;left:14px;font-weight:700;color:var(--text-muted);pointer-events:none;">Rp</span>
          <input
            type="text"
            inputmode="numeric"
            id="checkout-cash-input"
            class="input tabular-nums"
            style="padding-left:42px;font-weight:700;"
            placeholder="${formatNumberPlain(grandTotal) || '0'}"
            autocomplete="off"
          />
        </div>
        <div class="quick-cash-grid">
          ${cashPresets
            .map(
              (p) => `
              <button
                type="button"
                class="quick-cash-btn"
                data-cash-preset="${p.amount}"
              >
                ${escapeHtml(p.label)}
              </button>
            `
            )
            .join('')}
        </div>
      </div>

      <div class="kembalian-box is-short" data-kembalian-box>
        <span data-kembalian-label>${escapeHtml(t('pos.shortage'))}</span>
        <strong class="tabular-nums" data-kembalian-val style="font-size:1.1rem;">${formatRupiah(grandTotal)}</strong>
      </div>
    </div>

    <div data-pay-panel="qris" hidden style="margin-top:12px;">
      <div class="qris-card">
        <span class="badge badge--primary">${escapeHtml(t('payment.qris'))}</span>
        <div style="font-weight:800;font-size:1rem;color:var(--text-primary);">${escapeHtml(settings.storeName || 'AruPOS')}</div>
        ${qrisSvg}
        <div class="tabular-nums" style="font-size:1.25rem;font-weight:800;color:var(--primary);">${formatRupiah(grandTotal)}</div>
        <p style="margin:0;font-size:0.82rem;color:var(--text-muted);max-width:280px;">
          ${escapeHtml(t('pos.qrisPrompt'))}
        </p>
      </div>
    </div>

    <div data-pay-panel="transfer" hidden style="margin-top:12px;">
      <div class="field">
        <label class="field-label">${escapeHtml(t('pos.bankPresetLabel'))}</label>
        <div class="ewallet-chips" style="margin-top:0;">
          ${BANK_PRESETS.map(
            (bank) => `<button type="button" class="chip" data-bank-preset="${bank}" style="min-height:38px;padding:0 14px;">${bank}</button>`
          ).join('')}
        </div>
      </div>
      <div class="field">
        <label class="field-label" for="checkout-transfer-note">${escapeHtml(t('pos.transferNoteLabel'))}</label>
        <input
          type="text"
          id="checkout-transfer-note"
          class="input"
          placeholder="${escapeHtml(t('pos.transferNotePlaceholder'))}"
          maxlength="80"
        />
      </div>
    </div>

    <div data-pay-panel="ewallet" hidden style="margin-top:12px;">
      <div class="field">
        <label class="field-label">${escapeHtml(t('pos.ewalletSelectLabel'))}</label>
        <div class="ewallet-chips">
          ${ewalletButtonsHtml}
        </div>
      </div>
      <div class="field" data-ewallet-custom-wrap hidden>
        <label class="field-label" for="checkout-ewallet-custom">${escapeHtml(t('pos.ewalletCustomLabel'))}</label>
        <input
          type="text"
          id="checkout-ewallet-custom"
          class="input"
          placeholder="${escapeHtml(t('pos.ewalletCustomPlaceholder'))}"
          maxlength="50"
        />
      </div>
    </div>
  `;

  const footerHtml = `
    <button type="button" class="btn btn--outlined" data-checkout-action="cancel">${escapeHtml(t('common.cancel'))}</button>
    <button
      type="button"
      class="btn btn--primary btn--lg"
      data-checkout-action="confirm"
      disabled
    >
      ${icon('check')}
      <span>${escapeHtml(t('pos.checkoutConfirm'))}</span>
    </button>
  `;

  openSheet({
    id: sheetId,
    title: t('pos.checkoutTitle'),
    size: 'md',
    contentHtml,
    footerHtml,
    onMount(panelEl) {
      const methodBtns = panelEl.querySelectorAll('[data-pay-method]');
      const panels = panelEl.querySelectorAll('[data-pay-panel]');
      const cashInput = panelEl.querySelector('#checkout-cash-input');
      const kembalianBox = panelEl.querySelector('[data-kembalian-box]');
      const kembalianLabel = panelEl.querySelector('[data-kembalian-label]');
      const kembalianVal = panelEl.querySelector('[data-kembalian-val]');
      const transferNoteInput = panelEl.querySelector('#checkout-transfer-note');
      const ewalletBtns = panelEl.querySelectorAll('[data-ewallet-provider]');
      const ewalletCustomWrap = panelEl.querySelector('[data-ewallet-custom-wrap]');
      const ewalletCustomInput = panelEl.querySelector('#checkout-ewallet-custom');
      const customerInput = panelEl.querySelector('#checkout-customer-input');
      const confirmBtn = panelEl.querySelector('[data-checkout-action="confirm"]');

      if (kembalianVal) {
        kembalianVal.dataset.animVal = String(grandTotal);
      }

      function syncCashStatus() {
        const diff = cashReceived - grandTotal;
        const isOk = diff >= 0;

        if (kembalianBox) {
          kembalianBox.classList.toggle('is-ok', isOk);
          kembalianBox.classList.toggle('is-short', !isOk);
        }
        if (kembalianLabel) {
          kembalianLabel.textContent = isOk ? t('pos.change') : t('pos.shortage');
        }
        const displayAmt = Math.abs(diff);
        if (kembalianVal) {
          animateRupiah(kembalianVal, displayAmt);
        }

        syncConfirmButton();
      }

      function syncConfirmButton() {
        if (!confirmBtn) return;
        const canSubmit = selectedMethod !== 'cash' || cashReceived >= grandTotal;
        confirmBtn.disabled = !canSubmit || isSubmitting;
      }

      function syncMethodPanels() {
        methodBtns.forEach((btn) => {
          const active = btn.dataset.payMethod === selectedMethod;
          btn.classList.toggle('is-selected', active);
          btn.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        panels.forEach((panel) => {
          panel.hidden = panel.dataset.payPanel !== selectedMethod;
        });
        syncConfirmButton();
      }

      function submitCheckout() {
        if (isSubmitting) return;
        if (selectedMethod === 'cash' && cashReceived < grandTotal) {
          toast(t('pos.insufficientCash'), 'warning');
          return;
        }

        isSubmitting = true;
        syncConfirmButton();

        try {
          const freshCart = cart.getState();
          const freshTotals = cart.getTotals();
          const freshSettings = getSettings();

          let paymentDetail = '';
          if (selectedMethod === 'transfer') {
            paymentDetail = transferNote.trim();
          } else if (selectedMethod === 'ewallet') {
            paymentDetail =
              selectedEwallet === EWALLET_OTHER_ID
                ? customEwalletName.trim() || t('pos.other')
                : selectedEwallet;
          }

          const paidCash =
            selectedMethod === 'cash' ? cashReceived : freshTotals.grandTotal;
          const changeAmt =
            selectedMethod === 'cash'
              ? Math.max(0, cashReceived - freshTotals.grandTotal)
              : 0;

          const txInput = {
            items: freshTotals.items.map((it) => ({
              productId: it.productId,
              name: it.name,
              sku: it.sku || '',
              emoji: it.emoji || '',
              price: it.price,
              qty: it.qty,
              discountType: mapDiscountTypeForStore(it.discountType),
              discountValue: it.discountValue,
              discountAmount: it.discountAmount,
              grossTotal: it.grossTotal,
              netTotal: it.netTotal,
              note: it.note || '',
            })),
            itemCount: freshTotals.itemCount,
            rawSubtotal: freshTotals.rawSubtotal,
            itemDiscountTotal: freshTotals.itemDiscountTotal,
            subtotal: freshTotals.subtotal,
            orderDiscountType: mapDiscountTypeForStore(freshCart.orderDiscountType),
            orderDiscountValue: freshCart.orderDiscountValue,
            orderDiscountAmount: freshTotals.orderDiscountAmount,
            serviceEnabled: freshTotals.serviceActive,
            serviceRate: freshTotals.serviceRate,
            serviceLabel: freshTotals.serviceLabel,
            serviceAmount: freshTotals.serviceAmount,
            taxEnabled: freshTotals.taxActive,
            taxRate: freshTotals.taxRate,
            taxLabel: freshTotals.taxLabel,
            taxAmount: freshTotals.taxAmount,
            grandTotal: freshTotals.grandTotal,
            paymentMethod: selectedMethod,
            paymentDetail,
            cashReceived: paidCash,
            changeAmount: changeAmt,
            mode: freshSettings.mode || 'retail',
            orderType:
              freshSettings.mode === 'fnb' ? freshCart.orderType : 'retail',
            tableNumber:
              freshSettings.mode === 'fnb' && freshCart.orderType === 'dine-in'
                ? freshCart.tableNumber.trim()
                : '',
            customerName: customerName.trim(),
          };

          const createdTx = store.createTransaction(txInput);
          cart.clear(false);
          closeSheet(sheetId);
          toast(t('pos.checkoutSuccess'), 'success');
          openReceiptModal(createdTx, freshSettings, { isPostCheckout: true });
        } catch (err) {
          console.error('[POS] Checkout error:', err);
          toast(err?.message || t('pos.checkoutError'), 'error');
          isSubmitting = false;
          syncConfirmButton();
        }
      }

      panelEl.addEventListener('click', (e) => {
        const methodBtn = e.target.closest('[data-pay-method]');
        if (methodBtn) {
          selectedMethod = methodBtn.dataset.payMethod;
          syncMethodPanels();
          return;
        }

        const cashPresetBtn = e.target.closest('[data-cash-preset]');
        if (cashPresetBtn) {
          cashReceived = Math.max(0, Number(cashPresetBtn.dataset.cashPreset) || 0);
          if (cashInput) {
            cashInput.value = formatNumberPlain(cashReceived);
          }
          syncCashStatus();
          return;
        }

        const bankPresetBtn = e.target.closest('[data-bank-preset]');
        if (bankPresetBtn && transferNoteInput) {
          const bank = bankPresetBtn.dataset.bankPreset;
          const existing = transferNoteInput.value.trim();
          if (!existing || BANK_PRESETS.includes(existing)) {
            transferNoteInput.value = bank;
          } else if (!existing.toUpperCase().startsWith(bank)) {
            transferNoteInput.value = `${bank} - ${existing}`;
          }
          transferNote = transferNoteInput.value;
          transferNoteInput.focus();
          return;
        }

        const ewalletBtn = e.target.closest('[data-ewallet-provider]');
        if (ewalletBtn) {
          selectedEwallet = ewalletBtn.dataset.ewalletProvider;
          ewalletBtns.forEach((b) => {
            b.classList.toggle('is-active', b.dataset.ewalletProvider === selectedEwallet);
          });
          if (ewalletCustomWrap) {
            ewalletCustomWrap.hidden = selectedEwallet !== EWALLET_OTHER_ID;
          }
          if (selectedEwallet === EWALLET_OTHER_ID && ewalletCustomInput) {
            ewalletCustomInput.focus();
          }
          return;
        }

        const checkoutAct = e.target.closest('[data-checkout-action]');
        if (checkoutAct) {
          const act = checkoutAct.dataset.checkoutAction;
          if (act === 'cancel') {
            closeSheet(sheetId);
          } else if (act === 'confirm') {
            submitCheckout();
          }
        }
      });

      if (cashInput) {
        cashInput.addEventListener('input', (e) => {
          cashReceived = parseRupiahInput(e.target.value);
          e.target.value = formatNumberPlain(cashReceived);
          syncCashStatus();
        });
        cashInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && cashReceived >= grandTotal) {
            e.preventDefault();
            submitCheckout();
          }
        });
      }

      if (transferNoteInput) {
        transferNoteInput.addEventListener('input', (e) => {
          transferNote = e.target.value;
        });
      }

      if (ewalletCustomInput) {
        ewalletCustomInput.addEventListener('input', (e) => {
          customEwalletName = e.target.value;
        });
      }

      if (customerInput) {
        customerInput.addEventListener('input', (e) => {
          customerName = e.target.value;
          cart.setOrderMeta({ customerName });
        });
      }

      syncMethodPanels();
      syncCashStatus();
    },
  });
}

export function renderPosView() {
  if (!rootEl) return;
  syncShellTranslations();
  syncProductViewSwitcher();
  syncFnbBar();
  renderCategoryChips();
  renderProductGrid();
  renderDesktopCart();
  renderMobileCartBar();
  syncMobileCartSheet();
}

export function initPosView(container) {
  if (!container) return;
  rootEl = container;
  cart.syncFromSettings(getSettings());
  renderShell();

  if (!initialized) {
    initialized = true;

    bus.on('products:changed', () => {
      renderProductGrid();
      renderDesktopCart();
      renderMobileCartBar();
      syncMobileCartSheet();
    });

    bus.on('categories:changed', () => {
      renderCategoryChips();
      renderProductGrid();
    });

    bus.on('settings:changed', (nextSettings) => {
      const keys = nextSettings?._changedKeys;
      if (Array.isArray(keys) && keys.length > 0 && keys.every((k) => k === 'theme' || k === 'accent')) {
        return;
      }
      if (Array.isArray(keys) && keys.length > 0 && keys.every((k) => k === 'productView')) {
        syncProductViewSwitcher();
        triggerGridReveal(rootEl?.querySelector('#pos-product-grid'));
        return;
      }
      renderPosView();
    });

    bus.on('cart:changed', () => {
      const animOpts = {
        enterId: pendingEnterProductId,
      };
      pendingEnterProductId = null;

      syncFnbBar();
      updateProductCardBadgesOnly();
      renderDesktopCart(animOpts);
      renderMobileCartBar();
      syncMobileCartSheet(animOpts);
    });

    bus.on('store:reset', () => {
      searchQuery = '';
      selectedCategory = 'all';
      const searchInput = rootEl?.querySelector('#pos-search-input');
      const searchClear = rootEl?.querySelector('#pos-search-clear');
      if (searchInput) searchInput.value = '';
      if (searchClear) searchClear.hidden = true;
      renderPosView();
    });
  }

  renderPosView();
}
