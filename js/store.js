import { createSeedData } from './seed.js';
import { uid, getLocalDateKey, bus } from './utils.js';
import { t, setLanguage, getLocale, VALID_LANGUAGES } from './i18n.js';

const STORAGE_KEYS = {
  products: 'arupos_v1_products',
  categories: 'arupos_v1_categories',
  transactions: 'arupos_v1_transactions',
  settings: 'arupos_v1_settings',
  seeded: 'arupos_v1_seeded',
  themePref: 'arupos_v1_theme_pref',
};

const VALID_ACCENTS = ['emerald', 'amber', 'burgundy', 'sapphire'];

const DEFAULT_SETTINGS = {
  storeName: 'Kedai & Toko Aru',
  storeAddress: 'Jl. Boulevard Deltamas No. 18, Cikarang',
  storePhone: '0812-3456-7890',
  receiptFooter: 'Terima kasih sudah berbelanja! Simpan struk ini sebagai bukti pembayaran.',
  mode: 'retail',
  theme: 'light',
  accent: 'emerald',
  language: 'id',
  taxEnabled: false,
  taxRate: 11,
  taxLabel: 'PPN',
  serviceEnabled: false,
  serviceRate: 5,
  serviceLabel: 'Service',
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

const state = {
  initialized: false,
  settings: { ...DEFAULT_SETTINGS },
  categories: [],
  products: [],
  transactions: [],
};

function safeReadStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeParseJson(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistKey(key, value) {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    window.localStorage.setItem(key, serialized);
  } catch (err) {
    if (
      err &&
      (err.name === 'QuotaExceededError' ||
        err.code === 22 ||
        err.code === 1014 ||
        String(err.message || '').toLowerCase().includes('quota'))
    ) {
      throw new Error(t('store.quotaFull'));
    }
    throw new Error(t('store.persistFailed'));
  }
}

function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const taxRate = Number(src.taxRate);
  const serviceRate = Number(src.serviceRate);
  return {
    storeName: String(src.storeName ?? DEFAULT_SETTINGS.storeName).trim() || DEFAULT_SETTINGS.storeName,
    storeAddress: String(src.storeAddress ?? DEFAULT_SETTINGS.storeAddress).trim(),
    storePhone: String(src.storePhone ?? DEFAULT_SETTINGS.storePhone).trim(),
    receiptFooter: String(src.receiptFooter ?? DEFAULT_SETTINGS.receiptFooter).trim(),
    mode: src.mode === 'fnb' ? 'fnb' : 'retail',
    theme: src.theme === 'dark' || src.theme === 'system' ? src.theme : 'light',
    accent: VALID_ACCENTS.includes(src.accent) ? src.accent : DEFAULT_SETTINGS.accent,
    language: VALID_LANGUAGES.includes(src.language) ? src.language : DEFAULT_SETTINGS.language,
    taxEnabled: Boolean(src.taxEnabled),
    taxRate: Number.isFinite(taxRate) ? Math.min(100, Math.max(0, taxRate)) : DEFAULT_SETTINGS.taxRate,
    taxLabel: String(src.taxLabel ?? DEFAULT_SETTINGS.taxLabel).trim() || 'PPN',
    serviceEnabled: Boolean(src.serviceEnabled),
    serviceRate: Number.isFinite(serviceRate)
      ? Math.min(100, Math.max(0, serviceRate))
      : DEFAULT_SETTINGS.serviceRate,
    serviceLabel: String(src.serviceLabel ?? DEFAULT_SETTINGS.serviceLabel).trim() || 'Service',
  };
}

function normalizeCategory(raw) {
  const color = typeof raw?.color === 'string' && HEX_COLOR_RE.test(raw.color.trim())
    ? raw.color.trim()
    : '#0EA5E9';
  return {
    id: String(raw?.id || uid('cat')).trim(),
    name: String(raw?.name || t('store.defaultCategory')).trim() || t('store.defaultCategory'),
    emoji: String(raw?.emoji || '🏷️').trim() || '🏷️',
    color,
  };
}

function normalizeProduct(raw, fallbackCategoryId) {
  const priceNum = Math.round(Number(raw?.price));
  const stockNum = Math.round(Number(raw?.stock));
  return {
    id: String(raw?.id || uid('prd')).trim(),
    name: String(raw?.name || t('store.defaultProduct')).trim() || t('store.defaultProduct'),
    price: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : 0,
    categoryId: String(raw?.categoryId || fallbackCategoryId || '').trim() || fallbackCategoryId,
    sku: String(raw?.sku || '').trim().toUpperCase(),
    stock: Number.isFinite(stockNum) && stockNum >= 0 ? stockNum : 0,
    emoji: String(raw?.emoji || '📦').trim() || '📦',
    image: typeof raw?.image === 'string' ? raw.image : '',
    active: raw?.active === undefined ? true : Boolean(raw.active),
    createdAt: raw?.createdAt || new Date().toISOString(),
  };
}

function normalizeDiscountEnum(rawType) {
  if (rawType === 'percent' || rawType === 'pct') return 'percent';
  if (rawType === 'nominal' || rawType === 'rp') return 'nominal';
  return 'none';
}

function normalizeTxItem(item) {
  const price = Math.max(0, Math.round(Number(item?.price) || 0));
  const qty = Math.max(1, Math.round(Number(item?.qty) || 1));
  const grossTotal = price * qty;
  const discountType = normalizeDiscountEnum(item?.discountType);
  const rawDiscountValue = Math.max(0, Number(item?.discountValue) || 0);
  const discountValue =
    discountType === 'none'
      ? 0
      : discountType === 'percent'
        ? Math.min(100, rawDiscountValue)
        : rawDiscountValue;

  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = Math.min(grossTotal, Math.round((grossTotal * discountValue) / 100));
  } else if (discountType === 'nominal') {
    discountAmount = Math.min(grossTotal, Math.round(discountValue));
  }
  const netTotal = Math.max(0, grossTotal - discountAmount);

  return {
    productId: String(item?.productId || ''),
    name: String(item?.name || t('store.defaultItem')),
    sku: String(item?.sku || ''),
    emoji: String(item?.emoji || '📦'),
    price,
    qty,
    grossTotal,
    discountType,
    discountValue,
    discountAmount,
    netTotal,
    note: String(item?.note || ''),
  };
}

function normalizeTransaction(raw) {
  const items = Array.isArray(raw?.items) ? raw.items.map(normalizeTxItem) : [];
  const hasItems = items.length > 0;
  const rawSubtotal = hasItems
    ? items.reduce((s, it) => s + it.grossTotal, 0)
    : Math.max(0, Math.round(Number(raw?.rawSubtotal) || 0));
  const itemDiscountTotal = hasItems
    ? items.reduce((s, it) => s + it.discountAmount, 0)
    : Math.max(0, Math.round(Number(raw?.itemDiscountTotal) || 0));
  const subtotal = Math.max(0, rawSubtotal - itemDiscountTotal);

  const orderDiscountType = normalizeDiscountEnum(raw?.orderDiscountType);
  const rawOrderDiscountValue = Math.max(0, Number(raw?.orderDiscountValue) || 0);
  const orderDiscountValue =
    orderDiscountType === 'none'
      ? 0
      : orderDiscountType === 'percent'
        ? Math.min(100, rawOrderDiscountValue)
        : rawOrderDiscountValue;

  let orderDiscountAmount = 0;
  if (orderDiscountType === 'percent') {
    orderDiscountAmount = Math.min(subtotal, Math.round((subtotal * orderDiscountValue) / 100));
  } else if (orderDiscountType === 'nominal') {
    orderDiscountAmount = Math.min(subtotal, Math.round(orderDiscountValue));
  }

  const afterOrderDiscount = Math.max(0, subtotal - orderDiscountAmount);
  const serviceEnabled = Boolean(raw?.serviceEnabled);
  const serviceRate = serviceEnabled ? Math.max(0, Number(raw?.serviceRate) || 0) : 0;
  const serviceLabel = String(raw?.serviceLabel || 'Service');
  const serviceAmount = serviceEnabled
    ? serviceRate > 0
      ? Math.round((afterOrderDiscount * serviceRate) / 100)
      : Math.max(0, Math.round(Number(raw?.serviceAmount) || 0))
    : 0;
  const taxEnabled = Boolean(raw?.taxEnabled);
  const taxRate = taxEnabled ? Math.max(0, Number(raw?.taxRate) || 0) : 0;
  const taxLabel = String(raw?.taxLabel || 'PPN');
  const taxAmount = taxEnabled
    ? taxRate > 0
      ? Math.round(((afterOrderDiscount + serviceAmount) * taxRate) / 100)
      : Math.max(0, Math.round(Number(raw?.taxAmount) || 0))
    : 0;
  const grandTotal = afterOrderDiscount + serviceAmount + taxAmount;

  const paymentMethod = String(raw?.paymentMethod || 'cash');
  const paymentDetail = String(raw?.paymentDetail || (paymentMethod === 'cash' ? 'Tunai' : paymentMethod));
  const cashReceived =
    raw?.cashReceived !== undefined
      ? Math.max(0, Math.round(Number(raw.cashReceived) || 0))
      : grandTotal;
  const changeAmount = paymentMethod === 'cash' ? Math.max(0, cashReceived - grandTotal) : 0;

  return {
    id: String(raw?.id || uid('tx')),
    receiptNo: String(raw?.receiptNo || ''),
    createdAt: raw?.createdAt || new Date().toISOString(),
    status: raw?.status === 'void' ? 'void' : 'completed',
    voidedAt: raw?.status === 'void' ? raw?.voidedAt || new Date().toISOString() : null,
    voidReason: raw?.status === 'void' ? String(raw?.voidReason || t('store.defaultVoidReason')) : '',
    mode: raw?.mode === 'fnb' ? 'fnb' : 'retail',
    stockDeducted: Boolean(raw?.stockDeducted),
    orderType: String(raw?.orderType || ''),
    tableNumber: String(raw?.tableNumber || ''),
    customerName: String(raw?.customerName || ''),
    items,
    rawSubtotal,
    itemDiscountTotal,
    subtotal,
    orderDiscountType,
    orderDiscountValue,
    orderDiscountAmount,
    serviceEnabled,
    serviceRate,
    serviceLabel,
    serviceAmount,
    taxEnabled,
    taxRate,
    taxLabel,
    taxAmount,
    grandTotal,
    paymentMethod,
    paymentDetail,
    cashReceived,
    changeAmount,
  };
}

function cloneProduct(p) {
  return { ...p };
}

function cloneCategory(c) {
  return { ...c };
}

function cloneTransaction(tx) {
  return {
    ...tx,
    items: tx.items.map((item) => ({ ...item })),
  };
}

function ensureInitialized() {
  if (!state.initialized) {
    store.init();
  }
}

function syncThemePrefStorage(theme) {
  try {
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      window.localStorage.setItem(STORAGE_KEYS.themePref, theme);
    }
  } catch {
    // Ignore theme preference storage sync error
  }
}

function writeAllToStorage(nextSettings, nextCategories, nextProducts, nextTransactions) {
  persistKey(STORAGE_KEYS.settings, nextSettings);
  persistKey(STORAGE_KEYS.categories, nextCategories);
  persistKey(STORAGE_KEYS.products, nextProducts);
  persistKey(STORAGE_KEYS.transactions, nextTransactions);
  persistKey(STORAGE_KEYS.seeded, '1');
  syncThemePrefStorage(nextSettings?.theme);
}

function generateReceiptNoForDate(createdAt) {
  const dateKey = getLocalDateKey(createdAt);
  const compact = dateKey.replace(/-/g, '');
  const prefix = `TRX-${compact}-`;
  let sameDayCount = 0;
  let maxSeq = 0;

  for (const tx of state.transactions) {
    if (getLocalDateKey(tx.createdAt) === dateKey) {
      sameDayCount += 1;
      if (typeof tx.receiptNo === 'string' && tx.receiptNo.startsWith(prefix)) {
        const parsedSeq = Number.parseInt(tx.receiptNo.slice(prefix.length), 10);
        if (Number.isFinite(parsedSeq) && parsedSeq > maxSeq) {
          maxSeq = parsedSeq;
        }
      }
    }
  }

  const nextSeq = Math.max(sameDayCount, maxSeq) + 1;
  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

export const store = {
  init() {
    const seededFlag = safeReadStorage(STORAGE_KEYS.seeded);
    const rawSettings = safeParseJson(safeReadStorage(STORAGE_KEYS.settings));
    const rawCategories = safeParseJson(safeReadStorage(STORAGE_KEYS.categories));
    const rawProducts = safeParseJson(safeReadStorage(STORAGE_KEYS.products));
    const rawTransactions = safeParseJson(safeReadStorage(STORAGE_KEYS.transactions));

    const hasValidStore =
      seededFlag === '1' &&
      rawSettings &&
      typeof rawSettings === 'object' &&
      !Array.isArray(rawSettings) &&
      Array.isArray(rawCategories) &&
      rawCategories.length > 0 &&
      Array.isArray(rawProducts) &&
      Array.isArray(rawTransactions);

    if (!hasValidStore) {
      const seed = createSeedData();
      state.settings = normalizeSettings(seed.settings);
      setLanguage(state.settings.language);
      state.categories = seed.categories.map(normalizeCategory);
      const fallbackCatId = state.categories[0]?.id || 'cat_minuman';
      state.products = seed.products.map((p) => normalizeProduct(p, fallbackCatId));
      state.transactions = seed.transactions.map(normalizeTransaction);
      state.initialized = true;
      try {
        writeAllToStorage(
          state.settings,
          state.categories,
          state.products,
          state.transactions
        );
      } catch (err) {
        console.error('[AruPOS store] gagal menyimpan data awal:', err);
      }
      return;
    }

    state.settings = normalizeSettings(rawSettings);
    setLanguage(state.settings.language);
    state.categories = rawCategories.map(normalizeCategory);
    const validCatIds = new Set(state.categories.map((c) => c.id));
    const fallbackCatId = state.categories[0].id;
    state.products = rawProducts.map((p) => {
      const normalized = normalizeProduct(p, fallbackCatId);
      if (!validCatIds.has(normalized.categoryId)) {
        normalized.categoryId = fallbackCatId;
      }
      return normalized;
    });
    state.transactions = rawTransactions.map(normalizeTransaction);
    state.initialized = true;
  },

  // --- Products ---
  getProducts() {
    ensureInitialized();
    return [...state.products]
      .sort((a, b) => a.name.localeCompare(b.name, getLocale(), { sensitivity: 'base' }))
      .map(cloneProduct);
  },

  getProductById(id) {
    ensureInitialized();
    const found = state.products.find((p) => p.id === id);
    return found ? cloneProduct(found) : null;
  },

  addProduct(data) {
    ensureInitialized();
    const name = String(data?.name || '').trim();
    if (!name) {
      throw new Error(t('store.productNameRequired'));
    }

    const price = Math.round(Number(data?.price));
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(t('store.productPriceInvalid'));
    }

    const stock = Math.round(Number(data?.stock ?? 0));
    if (!Number.isFinite(stock) || stock < 0) {
      throw new Error(t('store.productStockInvalid'));
    }

    const catExists = state.categories.some((c) => c.id === data?.categoryId);
    const categoryId = catExists ? data.categoryId : state.categories[0]?.id || 'cat_minuman';

    const created = {
      id: uid('prd'),
      name,
      price,
      categoryId,
      sku: String(data?.sku || '').trim().toUpperCase(),
      stock,
      emoji: String(data?.emoji || '📦').trim() || '📦',
      image: typeof data?.image === 'string' ? data.image : '',
      active: data?.active === undefined ? true : Boolean(data.active),
      createdAt: new Date().toISOString(),
    };

    const nextProducts = [...state.products, created];
    persistKey(STORAGE_KEYS.products, nextProducts);
    state.products = nextProducts;

    const cloned = cloneProduct(created);
    bus.emit('products:changed', { action: 'add', product: cloned });
    return cloned;
  },

  updateProduct(id, patch) {
    ensureInitialized();
    const idx = state.products.findIndex((p) => p.id === id);
    if (idx === -1) {
      throw new Error(t('store.productNotFound'));
    }

    const current = state.products[idx];
    const next = { ...current };

    if (patch?.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) {
        throw new Error(t('store.productNameEmpty'));
      }
      next.name = name;
    }

    if (patch?.price !== undefined) {
      const price = Math.round(Number(patch.price));
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(t('store.productPriceInvalid'));
      }
      next.price = price;
    }

    if (patch?.stock !== undefined) {
      const stock = Math.round(Number(patch.stock));
      if (!Number.isFinite(stock) || stock < 0) {
        throw new Error(t('store.productStockInvalid'));
      }
      next.stock = stock;
    }

    if (patch?.categoryId !== undefined) {
      const validCat = state.categories.some((c) => c.id === patch.categoryId);
      next.categoryId = validCat ? patch.categoryId : current.categoryId;
    }

    if (patch?.sku !== undefined) {
      next.sku = String(patch.sku || '').trim().toUpperCase();
    }

    if (patch?.emoji !== undefined) {
      next.emoji = String(patch.emoji || '📦').trim() || '📦';
    }

    if (patch?.image !== undefined) {
      next.image = typeof patch.image === 'string' ? patch.image : '';
    }

    if (patch?.active !== undefined) {
      next.active = Boolean(patch.active);
    }

    const nextProducts = [...state.products];
    nextProducts[idx] = next;
    persistKey(STORAGE_KEYS.products, nextProducts);
    state.products = nextProducts;

    const cloned = cloneProduct(next);
    bus.emit('products:changed', { action: 'update', product: cloned });
    return cloned;
  },

  deleteProduct(id) {
    ensureInitialized();
    const idx = state.products.findIndex((p) => p.id === id);
    if (idx === -1) return false;

    const nextProducts = state.products.filter((p) => p.id !== id);
    persistKey(STORAGE_KEYS.products, nextProducts);
    state.products = nextProducts;

    bus.emit('products:changed', { action: 'delete', id });
    return true;
  },

  adjustStock(id, delta) {
    ensureInitialized();
    const idx = state.products.findIndex((p) => p.id === id);
    if (idx === -1) return null;

    const current = state.products[idx];
    const diff = Math.round(Number(delta) || 0);
    const nextStock = Math.max(0, current.stock + diff);

    const updated = { ...current, stock: nextStock };
    const nextProducts = [...state.products];
    nextProducts[idx] = updated;
    persistKey(STORAGE_KEYS.products, nextProducts);
    state.products = nextProducts;

    const cloned = cloneProduct(updated);
    bus.emit('products:changed', { action: 'stock', product: cloned });
    return cloned;
  },

  // --- Categories ---
  getCategories() {
    ensureInitialized();
    return state.categories.map(cloneCategory);
  },

  addCategory({ name, emoji = '🏷️', color = '#0EA5E9' } = {}) {
    ensureInitialized();
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      throw new Error(t('store.categoryNameRequired'));
    }

    const duplicate = state.categories.some(
      (c) => c.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      throw new Error(t('store.categoryDuplicate'));
    }

    const cleanColor =
      typeof color === 'string' && HEX_COLOR_RE.test(color.trim()) ? color.trim() : '#0EA5E9';

    const created = {
      id: uid('cat'),
      name: cleanName,
      emoji: String(emoji || '🏷️').trim() || '🏷️',
      color: cleanColor,
    };

    const nextCategories = [...state.categories, created];
    persistKey(STORAGE_KEYS.categories, nextCategories);
    state.categories = nextCategories;

    const cloned = cloneCategory(created);
    bus.emit('categories:changed', { action: 'add', category: cloned });
    return cloned;
  },

  updateCategory(id, patch) {
    ensureInitialized();
    const idx = state.categories.findIndex((c) => c.id === id);
    if (idx === -1) {
      throw new Error(t('store.categoryNotFound'));
    }

    const current = state.categories[idx];
    const next = { ...current };

    if (patch?.name !== undefined) {
      const cleanName = String(patch.name).trim();
      if (!cleanName) {
        throw new Error(t('store.categoryNameEmpty'));
      }
      const duplicate = state.categories.some(
        (c) => c.id !== id && c.name.toLowerCase() === cleanName.toLowerCase()
      );
      if (duplicate) {
        throw new Error(t('store.categoryDuplicate'));
      }
      next.name = cleanName;
    }

    if (patch?.emoji !== undefined) {
      next.emoji = String(patch.emoji || '🏷️').trim() || '🏷️';
    }

    if (patch?.color !== undefined) {
      next.color =
        typeof patch.color === 'string' && HEX_COLOR_RE.test(patch.color.trim())
          ? patch.color.trim()
          : current.color;
    }

    const nextCategories = [...state.categories];
    nextCategories[idx] = next;
    persistKey(STORAGE_KEYS.categories, nextCategories);
    state.categories = nextCategories;

    const cloned = cloneCategory(next);
    bus.emit('categories:changed', { action: 'update', category: cloned });
    return cloned;
  },

  deleteCategory(id) {
    ensureInitialized();
    if (state.categories.length <= 1) {
      throw new Error(t('store.categoryMinOne'));
    }

    const exists = state.categories.some((c) => c.id === id);
    if (!exists) return false;

    const nextCategories = state.categories.filter((c) => c.id !== id);
    const fallbackCategoryId = nextCategories[0].id;

    let reassignedCount = 0;
    const nextProducts = state.products.map((product) => {
      if (product.categoryId === id) {
        reassignedCount += 1;
        return { ...product, categoryId: fallbackCategoryId };
      }
      return product;
    });

    persistKey(STORAGE_KEYS.categories, nextCategories);
    persistKey(STORAGE_KEYS.products, nextProducts);
    state.categories = nextCategories;
    state.products = nextProducts;

    bus.emit('categories:changed', { action: 'delete', id, fallbackCategoryId });
    bus.emit('products:changed', { action: 'category-reassigned', fromId: id, toId: fallbackCategoryId });
    return { ok: true, reassignedCount, fallbackCategoryId };
  },

  // --- Transactions ---
  getTransactions() {
    ensureInitialized();
    return [...state.transactions]
      .sort((a, b) => {
        const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (diff !== 0) return diff;
        return String(b.receiptNo || '').localeCompare(String(a.receiptNo || ''));
      })
      .map(cloneTransaction);
  },

  getTransactionById(id) {
    ensureInitialized();
    const found = state.transactions.find((tx) => tx.id === id);
    return found ? cloneTransaction(found) : null;
  },

  createTransaction(txInput) {
    ensureInitialized();
    const createdAt = new Date().toISOString();
    const receiptNo = generateReceiptNoForDate(createdAt);
    const currentMode = state.settings.mode === 'fnb' ? 'fnb' : 'retail';
    const shouldDeductStock = currentMode === 'retail';

    const items = Array.isArray(txInput?.items) ? txInput.items.map(normalizeTxItem) : [];
    if (items.length === 0) {
      throw new Error(t('store.cartEmpty'));
    }

    let stockChanged = false;
    let nextProducts = state.products;

    if (shouldDeductStock) {
      const deductByProductId = new Map();
      for (const item of items) {
        if (!item.productId) continue;
        const qty = Math.max(0, Math.round(Number(item.qty) || 0));
        if (qty <= 0) continue;
        deductByProductId.set(
          item.productId,
          (deductByProductId.get(item.productId) || 0) + qty
        );
      }

      if (deductByProductId.size > 0) {
        nextProducts = state.products.map((product) => {
          const deductQty = deductByProductId.get(product.id);
          if (!deductQty) return product;
          stockChanged = true;
          return {
            ...product,
            stock: Math.max(0, product.stock - deductQty),
          };
        });
      }
    }

    const tx = normalizeTransaction({
      ...txInput,
      id: uid('tx'),
      receiptNo,
      createdAt,
      status: 'completed',
      voidedAt: null,
      voidReason: '',
      mode: currentMode,
      stockDeducted: shouldDeductStock,
      items,
    });

    const nextTransactions = [tx, ...state.transactions];
    persistKey(STORAGE_KEYS.transactions, nextTransactions);
    if (stockChanged) {
      persistKey(STORAGE_KEYS.products, nextProducts);
      state.products = nextProducts;
    }
    state.transactions = nextTransactions;

    const cloned = cloneTransaction(tx);
    bus.emit('transactions:changed', { action: 'create', transaction: cloned });
    if (stockChanged) {
      bus.emit('products:changed', { action: 'sale-deduct', transactionId: cloned.id });
    }
    return cloned;
  },

  voidTransaction(id, reason = '') {
    ensureInitialized();
    const idx = state.transactions.findIndex((tx) => tx.id === id);
    if (idx === -1) {
      return { ok: false, reason: t('store.txNotFound') };
    }

    const current = state.transactions[idx];
    if (current.status === 'void') {
      return { ok: false, reason: t('store.txAlreadyVoid') };
    }

    const voidedTx = {
      ...current,
      status: 'void',
      voidedAt: new Date().toISOString(),
      voidReason: String(reason || t('store.defaultVoidReason')).trim() || t('store.defaultVoidReason'),
    };

    let stockRestored = false;
    let nextProducts = state.products;

    if (current.stockDeducted === true && Array.isArray(current.items)) {
      const restoreByProductId = new Map();
      for (const item of current.items) {
        if (!item.productId) continue;
        const qty = Math.max(0, Math.round(Number(item.qty) || 0));
        if (qty <= 0) continue;
        restoreByProductId.set(
          item.productId,
          (restoreByProductId.get(item.productId) || 0) + qty
        );
      }

      if (restoreByProductId.size > 0) {
        nextProducts = state.products.map((product) => {
          const restoreQty = restoreByProductId.get(product.id);
          if (!restoreQty) return product;
          stockRestored = true;
          return {
            ...product,
            stock: product.stock + restoreQty,
          };
        });
      }
    }

    const nextTransactions = [...state.transactions];
    nextTransactions[idx] = voidedTx;

    persistKey(STORAGE_KEYS.transactions, nextTransactions);
    if (stockRestored) {
      persistKey(STORAGE_KEYS.products, nextProducts);
      state.products = nextProducts;
    }
    state.transactions = nextTransactions;

    const cloned = cloneTransaction(voidedTx);
    bus.emit('transactions:changed', { action: 'void', transaction: cloned });
    if (stockRestored) {
      bus.emit('products:changed', { action: 'void-restore', transactionId: cloned.id });
    }
    return { ok: true, transaction: cloned };
  },

  // --- Settings & Backup ---
  getSettings() {
    ensureInitialized();
    return { ...state.settings };
  },

  updateSettings(patch) {
    ensureInitialized();
    const prevSettings = state.settings;
    const nextSettings = normalizeSettings({
      ...prevSettings,
      ...(patch && typeof patch === 'object' ? patch : {}),
    });

    const changedKeys = Object.keys(nextSettings).filter(
      (k) => nextSettings[k] !== prevSettings[k]
    );

    persistKey(STORAGE_KEYS.settings, nextSettings);
    syncThemePrefStorage(nextSettings.theme);
    state.settings = nextSettings;
    setLanguage(nextSettings.language);

    const emitted = { ...nextSettings };
    Object.defineProperty(emitted, '_changedKeys', {
      value: changedKeys,
      enumerable: false,
    });
    bus.emit('settings:changed', emitted);
    return { ...nextSettings };
  },

  exportAllData() {
    ensureInitialized();
    const payload = {
      app: 'AruPOS',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      categories: this.getCategories(),
      products: this.getProducts(),
      transactions: this.getTransactions(),
    };
    return JSON.stringify(payload, null, 2);
  },

  importAllData(jsonStr) {
    ensureInitialized();
    let parsed;
    try {
      parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    } catch {
      throw new Error(t('store.backupInvalidJson'));
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(t('store.backupInvalidStructure'));
    }

    if (
      !parsed.settings ||
      typeof parsed.settings !== 'object' ||
      Array.isArray(parsed.settings) ||
      !Array.isArray(parsed.categories) ||
      !Array.isArray(parsed.products) ||
      !Array.isArray(parsed.transactions)
    ) {
      throw new Error(t('store.backupIncomplete'));
    }

    if (parsed.categories.length === 0) {
      throw new Error(t('store.backupNoCategories'));
    }

    const nextSettings = normalizeSettings(parsed.settings);
    setLanguage(nextSettings.language);
    const nextCategories = parsed.categories.map(normalizeCategory);
    const validCatIds = new Set(nextCategories.map((c) => c.id));
    const fallbackCatId = nextCategories[0].id;
    const nextProducts = parsed.products.map((p) => {
      const normalized = normalizeProduct(p, fallbackCatId);
      if (!validCatIds.has(normalized.categoryId)) {
        normalized.categoryId = fallbackCatId;
      }
      return normalized;
    });
    const nextTransactions = parsed.transactions.map(normalizeTransaction);

    writeAllToStorage(nextSettings, nextCategories, nextProducts, nextTransactions);

    state.settings = nextSettings;
    state.categories = nextCategories;
    state.products = nextProducts;
    state.transactions = nextTransactions;
    state.initialized = true;

    bus.emit('settings:changed', this.getSettings());
    bus.emit('categories:changed', { action: 'import' });
    bus.emit('products:changed', { action: 'import' });
    bus.emit('transactions:changed', { action: 'import' });
    bus.emit('store:reset', { source: 'import' });

    return {
      ok: true,
      categories: nextCategories.length,
      products: nextProducts.length,
      transactions: nextTransactions.length,
    };
  },

  resetDemoData() {
    const seed = createSeedData();
    const nextSettings = normalizeSettings(seed.settings);
    setLanguage(nextSettings.language);
    const nextCategories = seed.categories.map(normalizeCategory);
    const fallbackCatId = nextCategories[0]?.id || 'cat_minuman';
    const nextProducts = seed.products.map((p) => normalizeProduct(p, fallbackCatId));
    const nextTransactions = seed.transactions.map(normalizeTransaction);

    writeAllToStorage(nextSettings, nextCategories, nextProducts, nextTransactions);

    state.settings = nextSettings;
    state.categories = nextCategories;
    state.products = nextProducts;
    state.transactions = nextTransactions;
    state.initialized = true;

    bus.emit('products:changed', { action: 'reset' });
    bus.emit('categories:changed', { action: 'reset' });
    bus.emit('transactions:changed', { action: 'reset' });
    bus.emit('settings:changed', this.getSettings());
    bus.emit('store:reset', { source: 'demo' });

    return { ok: true };
  },
};
