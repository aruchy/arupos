import { clamp, bus } from './utils.js';
import { store } from './store.js';
import { toast } from './motion.js';
import { t } from './i18n.js';

function getSafeSettings() {
  try {
    return (typeof store?.getSettings === 'function' ? store.getSettings() : null) || {};
  } catch {
    return {};
  }
}

function normalizeDiscountType(type) {
  if (type === 'rp' || type === 'nominal') return 'rp';
  if (type === 'pct' || type === 'percent') return 'pct';
  return 'none';
}

const initialSettings = getSafeSettings();
let lastSettingsTax = Boolean(initialSettings.taxEnabled);
let lastSettingsService = Boolean(initialSettings.serviceEnabled);

const state = {
  items: [],
  orderDiscountType: 'none',
  orderDiscountValue: 0,
  taxEnabled: lastSettingsTax,
  serviceEnabled: lastSettingsService,
  orderType: 'dine-in',
  tableNumber: '',
  customerName: '',
};

export function computeTotals(cartState, settings) {
  const cs = cartState || {};
  const s = settings || {};
  const rawItems = Array.isArray(cs.items) ? cs.items : [];

  const computedItems = [];
  let itemCount = 0;
  let rawSubtotal = 0;
  let itemDiscountTotal = 0;

  for (const item of rawItems) {
    const price = Math.max(0, Math.round(Number(item.price) || 0));
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
    const grossTotal = price * qty;
    const discountType = normalizeDiscountType(item.discountType);
    const discountValue = Math.max(0, Number(item.discountValue) || 0);

    let discountAmount = 0;
    if (discountType === 'pct') {
      discountAmount = Math.round((grossTotal * clamp(discountValue, 0, 100)) / 100);
    } else if (discountType === 'rp') {
      discountAmount = clamp(Math.round(discountValue), 0, grossTotal);
    }

    const netTotal = Math.max(0, grossTotal - discountAmount);
    itemCount += qty;
    rawSubtotal += grossTotal;
    itemDiscountTotal += discountAmount;

    computedItems.push({
      ...item,
      price,
      qty,
      discountType,
      discountValue: discountType === 'none' ? 0 : discountValue,
      grossTotal,
      discountAmount,
      netTotal,
      note: String(item.note ?? ''),
    });
  }

  const subtotal = Math.max(0, rawSubtotal - itemDiscountTotal);
  const orderDiscountType = normalizeDiscountType(cs.orderDiscountType);
  const orderDiscountValue = Math.max(0, Number(cs.orderDiscountValue) || 0);

  let orderDiscountAmount = 0;
  if (orderDiscountType === 'pct') {
    orderDiscountAmount = Math.round((subtotal * clamp(orderDiscountValue, 0, 100)) / 100);
  } else if (orderDiscountType === 'rp') {
    orderDiscountAmount = clamp(Math.round(orderDiscountValue), 0, subtotal);
  }

  const afterOrderDiscount = Math.max(0, subtotal - orderDiscountAmount);
  const serviceAllowed = Boolean(s.serviceEnabled);
  const serviceActive = serviceAllowed && Boolean(cs.serviceEnabled);
  const serviceRate = Math.max(0, Number(s.serviceRate) || 0);
  const serviceAmount = serviceActive
    ? Math.round((afterOrderDiscount * serviceRate) / 100)
    : 0;

  const taxAllowed = Boolean(s.taxEnabled);
  const taxActive = taxAllowed && Boolean(cs.taxEnabled);
  const taxRate = Math.max(0, Number(s.taxRate) || 0);
  const taxAmount = taxActive
    ? Math.round(((afterOrderDiscount + serviceAmount) * taxRate) / 100)
    : 0;

  const grandTotal = afterOrderDiscount + serviceAmount + taxAmount;

  return {
    items: computedItems,
    itemCount,
    rawSubtotal,
    itemDiscountTotal,
    subtotal,
    orderDiscountAmount,
    serviceAllowed,
    serviceActive,
    serviceRate,
    serviceAmount,
    taxAllowed,
    taxActive,
    taxRate,
    taxLabel: s.taxLabel || 'PPN',
    serviceLabel: s.serviceLabel || 'Service',
    taxAmount,
    grandTotal,
  };
}

function emitChanged() {
  bus.emit('cart:changed', cart.getState());
}

function resetOrderDiscountIfEmpty() {
  if (state.items.length === 0) {
    state.orderDiscountType = 'none';
    state.orderDiscountValue = 0;
  }
}

function getStockLimit(product) {
  const settings = getSafeSettings();
  if (settings.mode !== 'retail') return null;
  if (!product) return null;
  return Math.max(0, Math.floor(Number(product.stock) || 0));
}

export const cart = {
  getState() {
    return {
      ...state,
      items: state.items.map((item) => ({ ...item })),
    };
  },

  syncFromSettings(settings) {
    const s = settings || getSafeSettings();
    const nextTax = Boolean(s.taxEnabled);
    const nextService = Boolean(s.serviceEnabled);
    const isEmpty = state.items.length === 0;
    let changed = false;

    if (isEmpty || nextTax !== lastSettingsTax) {
      if (state.taxEnabled !== nextTax) {
        state.taxEnabled = nextTax;
        changed = true;
      }
    }
    if (isEmpty || nextService !== lastSettingsService) {
      if (state.serviceEnabled !== nextService) {
        state.serviceEnabled = nextService;
        changed = true;
      }
    }

    lastSettingsTax = nextTax;
    lastSettingsService = nextService;

    if (changed) {
      emitChanged();
    }
  },

  addItem(product) {
    if (!product || !product.id) {
      return { ok: false, reason: t('cart.invalidProduct') };
    }

    const latest =
      typeof store?.getProductById === 'function'
        ? store.getProductById(product.id) || product
        : product;

    if (latest.active === false) {
      toast(t('cart.inactiveProduct', { name: latest.name || t('common.product') }), 'warning');
      return { ok: false, reason: t('cart.inactiveReason') };
    }

    const existing = state.items.find((it) => it.productId === latest.id);
    const currentQty = existing ? existing.qty : 0;
    const nextQty = currentQty + 1;

    const stockLimit = getStockLimit(latest);
    if (stockLimit !== null) {
      if (stockLimit <= 0) {
        toast(t('cart.outOfStockToast', { name: latest.name }), 'warning');
        return { ok: false, reason: t('cart.outOfStockReason') };
      }
      if (nextQty > stockLimit) {
        toast(t('cart.lowLimitToast', { name: latest.name, stock: stockLimit }), 'warning');
        return { ok: false, reason: t('cart.lowLimitReason', { stock: stockLimit }) };
      }
    }

    if (existing) {
      existing.qty = nextQty;
      existing.name = latest.name;
      existing.sku = latest.sku || '';
      existing.categoryId = latest.categoryId || '';
      existing.emoji = latest.emoji || '';
      existing.image = latest.image || '';
      existing.price = Math.max(0, Math.round(Number(latest.price) || 0));
    } else {
      state.items.push({
        productId: latest.id,
        name: latest.name,
        sku: latest.sku || '',
        categoryId: latest.categoryId || '',
        emoji: latest.emoji || '',
        image: latest.image || '',
        price: Math.max(0, Math.round(Number(latest.price) || 0)),
        qty: 1,
        discountType: 'none',
        discountValue: 0,
        note: '',
      });
    }

    emitChanged();
    return { ok: true, qty: nextQty };
  },

  setQty(productId, qty) {
    const idx = state.items.findIndex((it) => it.productId === productId);
    if (idx === -1) {
      return { ok: false, reason: t('cart.itemNotFound') };
    }

    const parsedQty = Math.floor(Number(qty) || 0);
    if (parsedQty <= 0) {
      state.items.splice(idx, 1);
      resetOrderDiscountIfEmpty();
      emitChanged();
      return { ok: true, qty: 0 };
    }

    const item = state.items[idx];
    const latest =
      typeof store?.getProductById === 'function'
        ? store.getProductById(productId)
        : null;
    const stockLimit = getStockLimit(latest);

    if (stockLimit !== null) {
      if (stockLimit <= 0) {
        toast(t('cart.outOfStockToast', { name: item.name }), 'warning');
        return { ok: false, reason: t('cart.outOfStockReason'), qty: item.qty };
      }
      if (parsedQty > stockLimit) {
        const clamped = stockLimit;
        if (item.qty !== clamped) {
          item.qty = clamped;
          emitChanged();
        }
        toast(t('cart.lowLimitToast', { name: item.name, stock: stockLimit }), 'warning');
        return { ok: false, reason: t('cart.lowLimitReason', { stock: stockLimit }), qty: item.qty };
      }
    }

    item.qty = parsedQty;
    emitChanged();
    return { ok: true, qty: item.qty };
  },

  increment(productId) {
    const item = state.items.find((it) => it.productId === productId);
    if (!item) {
      return { ok: false, reason: t('cart.itemNotFound') };
    }
    return this.setQty(productId, item.qty + 1);
  },

  decrement(productId) {
    const item = state.items.find((it) => it.productId === productId);
    if (!item) {
      return { ok: false, reason: t('cart.itemNotFound') };
    }
    return this.setQty(productId, item.qty - 1);
  },

  removeItem(productId) {
    const idx = state.items.findIndex((it) => it.productId === productId);
    if (idx === -1) return false;
    state.items.splice(idx, 1);
    resetOrderDiscountIfEmpty();
    emitChanged();
    return true;
  },

  updateItemOptions(productId, { discountType, discountValue, note } = {}) {
    const item = state.items.find((it) => it.productId === productId);
    if (!item) return false;

    if (discountType !== undefined) {
      item.discountType = normalizeDiscountType(discountType);
    }
    if (discountValue !== undefined) {
      item.discountValue =
        item.discountType === 'none' ? 0 : Math.max(0, Number(discountValue) || 0);
    } else if (item.discountType === 'none') {
      item.discountValue = 0;
    }
    if (note !== undefined) {
      item.note = String(note ?? '').trim();
    }

    emitChanged();
    return true;
  },

  setOrderDiscount(type, value) {
    const normalized = normalizeDiscountType(type);
    state.orderDiscountType = normalized;
    state.orderDiscountValue =
      normalized === 'none' ? 0 : Math.max(0, Number(value) || 0);
    emitChanged();
  },

  setTaxEnabled(bool) {
    const next = Boolean(bool);
    if (state.taxEnabled === next) return;
    state.taxEnabled = next;
    emitChanged();
  },

  setServiceEnabled(bool) {
    const next = Boolean(bool);
    if (state.serviceEnabled === next) return;
    state.serviceEnabled = next;
    emitChanged();
  },

  setOrderMeta({ orderType, tableNumber, customerName } = {}) {
    let changed = false;
    if (orderType === 'dine-in' || orderType === 'takeaway') {
      if (state.orderType !== orderType) {
        state.orderType = orderType;
        changed = true;
      }
    }
    if (tableNumber !== undefined) {
      const val = String(tableNumber ?? '');
      if (state.tableNumber !== val) {
        state.tableNumber = val;
        changed = true;
      }
    }
    if (customerName !== undefined) {
      const val = String(customerName ?? '');
      if (state.customerName !== val) {
        state.customerName = val;
        changed = true;
      }
    }
    if (changed) {
      emitChanged();
    }
  },

  clear(preserveToggles = false) {
    state.items = [];
    state.orderDiscountType = 'none';
    state.orderDiscountValue = 0;
    state.tableNumber = '';
    state.customerName = '';

    if (!preserveToggles) {
      const s = getSafeSettings();
      lastSettingsTax = Boolean(s.taxEnabled);
      lastSettingsService = Boolean(s.serviceEnabled);
      state.taxEnabled = lastSettingsTax;
      state.serviceEnabled = lastSettingsService;
    }

    emitChanged();
  },

  getTotals() {
    return computeTotals(state, getSafeSettings());
  },
};

bus.on('settings:changed', (nextSettings) => {
  cart.syncFromSettings(nextSettings);
});

bus.on('store:reset', () => {
  cart.clear(false);
});
