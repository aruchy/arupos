import { filterLocalDataForMigration } from './migration.js';
import { uid, getLocalDateKey, bus, formatDateTime, formatTransactionCode } from './utils.js';
import { t, setLanguage, getLocale, VALID_LANGUAGES } from './i18n.js';
import { getCategoryIconName } from './icons.js';

const STORAGE_KEYS = {
  products: 'arupos_v1_products',
  categories: 'arupos_v1_categories',
  transactions: 'arupos_v1_transactions',
  settings: 'arupos_v1_settings',
  seeded: 'arupos_v1_seeded',
  themePref: 'arupos_v1_theme_pref',
  accentPref: 'arupos_v1_accent_pref',
  langPref: 'arupos_v1_lang_pref',
};

const VALID_ACCENTS = ['emerald', 'amber', 'burgundy', 'sapphire'];
const VALID_PRODUCT_VIEWS = ['grid', 'compact', 'list'];

const DEFAULT_SETTINGS = {
  storeName: '',
  storeAddress: '',
  storePhone: '',
  receiptFooter: '',
  setupCompleted: false,
  theme: 'light',
  accent: 'emerald',
  language: 'id',
  productView: 'grid',
  taxEnabled: false,
  taxRate: 11,
  taxLabel: 'PPN',
  serviceEnabled: false,
  serviceRate: 5,
  serviceLabel: 'Service',
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const DEFAULT_CATEGORY_COLORS = [
  '#0EA5E9',
  '#DB2777',
  '#7C3AED',
  '#0D9488',
  '#D97706',
  '#2563EB',
  '#EA580C',
  '#65A30D',
];

const state = {
  initialized: false,
  settings: { ...DEFAULT_SETTINGS },
  categories: [],
  products: [],
  transactions: [],
};

let currentUser = null;
let cloudAdapter = null;
let cloudUnsub = null;
let cloudSessionSeq = 0;
let pendingCloudWriteCount = 0;
let syncStatus = {
  state: 'idle', // 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
  lastSyncedAt: null,
  pendingWrites: false,
  errorCode: null,
  errorMessage: '',
};

function emitSyncStatus() {
  bus.emit('sync:changed', { ...syncStatus });
}

function updateSyncStatus(patch) {
  syncStatus = {
    ...syncStatus,
    ...patch,
  };
  emitSyncStatus();
}

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

function readAppearancePrefs() {
  const themePref = safeReadStorage(STORAGE_KEYS.themePref);
  const accentPref = safeReadStorage(STORAGE_KEYS.accentPref);
  const langPref = safeReadStorage(STORAGE_KEYS.langPref);
  return {
    theme: themePref === 'dark' || themePref === 'system' ? themePref : 'light',
    accent: VALID_ACCENTS.includes(accentPref) ? accentPref : DEFAULT_SETTINGS.accent,
    language: VALID_LANGUAGES.includes(langPref) ? langPref : DEFAULT_SETTINGS.language,
  };
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

function syncAppearancePrefsStorage(settingsObj) {
  if (!settingsObj || typeof settingsObj !== 'object') return;
  try {
    const { theme, accent, language } = settingsObj;
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      window.localStorage.setItem(STORAGE_KEYS.themePref, theme);
    }
    if (VALID_ACCENTS.includes(accent)) {
      window.localStorage.setItem(STORAGE_KEYS.accentPref, accent);
    }
    if (VALID_LANGUAGES.includes(language)) {
      window.localStorage.setItem(STORAGE_KEYS.langPref, language);
    }
  } catch {
    // Ignore preference storage errors
  }
}

function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const taxRate = Number(src.taxRate);
  const serviceRate = Number(src.serviceRate);
  return {
    storeName: String(src.storeName ?? DEFAULT_SETTINGS.storeName).trim(),
    storeAddress: String(src.storeAddress ?? DEFAULT_SETTINGS.storeAddress).trim(),
    storePhone: String(src.storePhone ?? DEFAULT_SETTINGS.storePhone).trim(),
    receiptFooter: String(src.receiptFooter ?? DEFAULT_SETTINGS.receiptFooter).trim(),
    setupCompleted: Boolean(src.setupCompleted),
    theme: src.theme === 'dark' || src.theme === 'system' ? src.theme : 'light',
    accent: VALID_ACCENTS.includes(src.accent) ? src.accent : DEFAULT_SETTINGS.accent,
    language: VALID_LANGUAGES.includes(src.language) ? src.language : DEFAULT_SETTINGS.language,
    productView: VALID_PRODUCT_VIEWS.includes(src.productView)
      ? src.productView
      : DEFAULT_SETTINGS.productView,
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

function normalizeCategory(raw, idx = 0) {
  const fallbackColor = DEFAULT_CATEGORY_COLORS[idx % DEFAULT_CATEGORY_COLORS.length];
  const color = typeof raw?.color === 'string' && HEX_COLOR_RE.test(raw.color.trim())
    ? raw.color.trim()
    : fallbackColor;
  const name = String(raw?.name || t('store.defaultCategory')).trim() || t('store.defaultCategory');
  const legacyEmoji = typeof raw?.emoji === 'string' ? raw.emoji.trim() : '';
  return {
    id: String(raw?.id || uid('cat')).trim(),
    name,
    icon: getCategoryIconName({ id: raw?.id, name, icon: raw?.icon, emoji: legacyEmoji }),
    color,
    isDemo: Boolean(raw?.isDemo),
  };
}

function normalizeProduct(raw, fallbackCategoryId = '') {
  const priceNum = Math.round(Number(raw?.price));
  const stockNum = Math.round(Number(raw?.stock));
  const hasExplicitCat = raw?.categoryId !== undefined && raw?.categoryId !== null;
  const rawCatId = hasExplicitCat ? String(raw.categoryId).trim() : '';
  return {
    id: String(raw?.id || uid('prd')).trim(),
    name: String(raw?.name || t('store.defaultProduct')).trim() || t('store.defaultProduct'),
    price: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : 0,
    categoryId: hasExplicitCat ? rawCatId : fallbackCategoryId || '',
    sku: String(raw?.sku || '').trim().toUpperCase(),
    stock: Number.isFinite(stockNum) && stockNum >= 0 ? stockNum : 0,
    image: typeof raw?.image === 'string' ? raw.image : '',
    active: raw?.active === undefined ? true : Boolean(raw.active),
    isDemo: Boolean(raw?.isDemo),
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

  const normalized = {
    id: String(raw?.id || uid('tx')),
    receiptNo: String(raw?.receiptNo || ''),
    createdAt: raw?.createdAt || new Date().toISOString(),
    status: raw?.status === 'void' ? 'void' : 'completed',
    voidedAt: raw?.status === 'void' ? raw?.voidedAt || new Date().toISOString() : null,
    voidReason: raw?.status === 'void' ? String(raw?.voidReason || t('store.defaultVoidReason')) : '',
    stockDeducted: raw?.stockDeducted === undefined ? true : Boolean(raw.stockDeducted),
    isDemo: Boolean(raw?.isDemo),
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

  // Preserve historical order context read-only if present on legacy records
  const rawOrderType = String(raw?.orderType || raw?.legacyOrderType || '').trim();
  const rawTableNumber = String(raw?.tableNumber || raw?.legacyTableNumber || '').trim();
  if (rawOrderType && rawOrderType !== 'retail') {
    normalized.legacyOrderType = rawOrderType;
  }
  if (rawTableNumber) {
    normalized.legacyTableNumber = rawTableNumber;
  }

  return normalized;
}

function normalizeDataset({ settings, categories, products, transactions }) {
  const safeSettings = normalizeSettings(settings);
  const rawCats = Array.isArray(categories) ? categories : [];
  const safeCategories = rawCats.map((c, idx) => normalizeCategory(c, idx));
  const validCatIds = new Set(safeCategories.map((c) => c.id));
  const fallbackCatId = safeCategories[0]?.id || '';
  const safeProducts = (Array.isArray(products) ? products : []).map((p) => {
    const prod = normalizeProduct(p, '');
    if (prod.categoryId && !validCatIds.has(prod.categoryId)) {
      prod.categoryId = fallbackCatId;
    }
    return prod;
  });
  const safeTransactions = (Array.isArray(transactions) ? transactions : []).map(normalizeTransaction);

  return {
    settings: safeSettings,
    categories: safeCategories,
    products: safeProducts,
    transactions: safeTransactions,
  };
}

function applyDatasetToState(dataset) {
  state.settings = dataset.settings;
  state.categories = dataset.categories;
  state.products = dataset.products;
  state.transactions = dataset.transactions;
  state.initialized = true;
  setLanguage(state.settings.language);
  syncAppearancePrefsStorage(state.settings);
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

function writeAllToStorage(nextSettings, nextCategories, nextProducts, nextTransactions) {
  persistKey(STORAGE_KEYS.settings, nextSettings);
  persistKey(STORAGE_KEYS.categories, nextCategories);
  persistKey(STORAGE_KEYS.products, nextProducts);
  persistKey(STORAGE_KEYS.transactions, nextTransactions);
  persistKey(STORAGE_KEYS.seeded, '1');
  syncAppearancePrefsStorage(nextSettings);
}

function persistLocalOnly(key, value) {
  if (cloudAdapter) return;
  persistKey(key, value);
}

function runCloudWrite(fn) {
  if (!cloudAdapter) return Promise.resolve();
  const adapter = cloudAdapter;
  const sessionAtCall = cloudSessionSeq;
  pendingCloudWriteCount += 1;
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  updateSyncStatus({
    state: isOffline ? 'offline' : 'syncing',
    pendingWrites: true,
    errorCode: null,
    errorMessage: '',
  });

  return Promise.resolve()
    .then(() => fn(adapter))
    .then(() => {
      if (sessionAtCall !== cloudSessionSeq) return;
      pendingCloudWriteCount = Math.max(0, pendingCloudWriteCount - 1);
      const stillOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (pendingCloudWriteCount === 0) {
        updateSyncStatus({
          state: stillOffline ? 'offline' : 'synced',
          pendingWrites: stillOffline,
          lastSyncedAt: stillOffline ? syncStatus.lastSyncedAt : new Date().toISOString(),
          errorCode: null,
          errorMessage: '',
        });
      }
    })
    .catch((err) => {
      if (sessionAtCall !== cloudSessionSeq) return;
      pendingCloudWriteCount = Math.max(0, pendingCloudWriteCount - 1);
      console.error('[AruPOS cloud write]', err);
      const code = err?.code || 'write-error';
      updateSyncStatus({
        state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error',
        pendingWrites: false,
        errorCode: code,
        errorMessage: err?.message || '',
      });
    });
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
      if (typeof tx.receiptNo === 'string') {
        if (tx.receiptNo.startsWith(prefix)) {
          const parsedSeq = Number.parseInt(tx.receiptNo.slice(prefix.length), 10);
          if (Number.isFinite(parsedSeq) && parsedSeq > maxSeq) {
            maxSeq = parsedSeq;
          }
        } else {
          const shortMatch = tx.receiptNo.trim().match(/^#(\d+)$/);
          if (shortMatch) {
            const parsedShort = Number.parseInt(shortMatch[1], 10);
            if (Number.isFinite(parsedShort) && parsedShort > maxSeq) {
              maxSeq = parsedShort;
            }
          }
        }
      }
    }
  }

  const nextSeq = Math.max(sameDayCount, maxSeq) + 1;
  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

function escapeCsvCell(value) {
  let str = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function sortById(list) {
  return [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function listEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildCloudListenerHandlers(sessionSeq) {
  return {
    onSettings: (rawSettings) => {
      if (sessionSeq !== cloudSessionSeq || !rawSettings) return;
      const prev = state.settings;
      const next = normalizeSettings({ ...rawSettings, setupCompleted: true });
      if (JSON.stringify(prev) === JSON.stringify(next)) return;
      const changedKeys = Object.keys(next).filter((k) => next[k] !== prev[k]);
      state.settings = next;
      setLanguage(next.language);
      syncAppearancePrefsStorage(next);
      const emitted = { ...next };
      Object.defineProperty(emitted, '_changedKeys', {
        value: changedKeys,
        enumerable: false,
      });
      bus.emit('settings:changed', emitted);
    },

    onCategories: (rawCategories) => {
      if (sessionSeq !== cloudSessionSeq || !Array.isArray(rawCategories)) return;
      const next = rawCategories.map((c, idx) => normalizeCategory(c, idx));
      if (listEquals(sortById(state.categories), sortById(next))) return;
      state.categories = next;
      bus.emit('categories:changed', { action: 'sync' });
    },

    onProducts: (rawProducts) => {
      if (sessionSeq !== cloudSessionSeq || !Array.isArray(rawProducts)) return;
      const next = rawProducts.map((p) => normalizeProduct(p, ''));
      if (listEquals(sortById(state.products), sortById(next))) return;
      state.products = next;
      bus.emit('products:changed', { action: 'sync' });
    },

    onTransactions: (rawTxs) => {
      if (sessionSeq !== cloudSessionSeq || !Array.isArray(rawTxs)) return;
      const next = rawTxs.map(normalizeTransaction);
      if (listEquals(sortById(state.transactions), sortById(next))) return;
      state.transactions = next;
      bus.emit('transactions:changed', { action: 'sync' });
    },

    onSyncChange: ({ offline, pendingWrites, syncedAt } = {}) => {
      if (sessionSeq !== cloudSessionSeq) return;
      const combinedPending = Boolean(pendingWrites) || pendingCloudWriteCount > 0;
      const nextState = offline
        ? 'offline'
        : combinedPending
          ? 'syncing'
          : 'synced';
      updateSyncStatus({
        state: nextState,
        pendingWrites: combinedPending,
        lastSyncedAt: syncedAt || (nextState === 'synced' ? syncStatus.lastSyncedAt || new Date().toISOString() : syncStatus.lastSyncedAt),
        errorCode: null,
        errorMessage: '',
      });
    },

    onError: (err) => {
      if (sessionSeq !== cloudSessionSeq) return;
      updateSyncStatus({
        state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error',
        errorCode: err?.code || 'sync-error',
        errorMessage: err?.message || '',
      });
    },
  };
}

function attachCloudListeners(adapter, sessionSeq) {
  if (cloudUnsub) {
    cloudUnsub();
    cloudUnsub = null;
  }
  if (typeof adapter?.subscribeAll !== 'function') return;

  cloudUnsub = adapter.subscribeAll(buildCloudListenerHandlers(sessionSeq));
}

function readRawLocalStore() {
  return {
    seeded: safeReadStorage(STORAGE_KEYS.seeded),
    settings: safeParseJson(safeReadStorage(STORAGE_KEYS.settings)),
    categories: safeParseJson(safeReadStorage(STORAGE_KEYS.categories)),
    products: safeParseJson(safeReadStorage(STORAGE_KEYS.products)),
    transactions: safeParseJson(safeReadStorage(STORAGE_KEYS.transactions)),
  };
}

export const store = {
  init() {
    const raw = readRawLocalStore();
    const prefs = readAppearancePrefs();
    const hasLocalStore =
      raw.seeded === '1' ||
      (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) ||
      Array.isArray(raw.categories) ||
      Array.isArray(raw.products) ||
      Array.isArray(raw.transactions);

    if (!hasLocalStore) {
      // Truly empty by default — zero built-in sample/demo data
      const dataset = normalizeDataset({
        settings: { ...DEFAULT_SETTINGS, ...prefs },
        categories: [],
        products: [],
        transactions: [],
      });
      applyDatasetToState(dataset);
      return;
    }

    const dataset = normalizeDataset({
      settings: raw.settings && typeof raw.settings === 'object' ? { ...prefs, ...raw.settings } : prefs,
      categories: Array.isArray(raw.categories) ? raw.categories : [],
      products: Array.isArray(raw.products) ? raw.products : [],
      transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    });
    applyDatasetToState(dataset);
  },

  // --- Cloud, Auth Session & Setup Wizard ---
  getCurrentUser() {
    return currentUser ? { ...currentUser } : null;
  },

  getSyncStatus() {
    return { ...syncStatus };
  },

  hasLegacyLocalStorageKeys() {
    const raw = readRawLocalStore();
    return Boolean(
      raw.seeded === '1' ||
      raw.settings ||
      Array.isArray(raw.categories) ||
      Array.isArray(raw.products) ||
      Array.isArray(raw.transactions)
    );
  },

  getLocalMigrationCandidate() {
    const raw = readRawLocalStore();
    const hasLocal =
      raw.seeded === '1' ||
      (Array.isArray(raw.categories) && raw.categories.length > 0) ||
      (Array.isArray(raw.products) && raw.products.length > 0) ||
      (Array.isArray(raw.transactions) && raw.transactions.length > 0);

    if (!hasLocal) return null;

    const filtered = filterLocalDataForMigration(raw);
    if (!filtered.hasRealData) {
      return null;
    }

    const normalized = normalizeDataset(filtered.data);
    return {
      data: normalized,
      counts: {
        categories: normalized.categories.length,
        products: normalized.products.length,
        transactions: normalized.transactions.length,
      },
      excludedDemoCount: filtered.excludedDemoCount,
      customProfile: filtered.customProfile,
    };
  },

  getLocalProfileSuggestion() {
    const raw = readRawLocalStore();
    const filtered = filterLocalDataForMigration(raw);
    return filtered.customProfile;
  },

  clearLocalLegacyData() {
    try {
      window.localStorage.removeItem(STORAGE_KEYS.products);
      window.localStorage.removeItem(STORAGE_KEYS.categories);
      window.localStorage.removeItem(STORAGE_KEYS.transactions);
      window.localStorage.removeItem(STORAGE_KEYS.settings);
      window.localStorage.removeItem(STORAGE_KEYS.seeded);
    } catch {
      // Ignore storage removal errors
    }
  },

  async connectCloud(user, adapter) {
    if (cloudUnsub) {
      cloudUnsub();
      cloudUnsub = null;
    }

    const sessionSeq = ++cloudSessionSeq;
    pendingCloudWriteCount = 0;

    currentUser = user
      ? {
          uid: user.uid,
          displayName: user.displayName || user.email || 'Pengguna',
          email: user.email || '',
          photoURL: user.photoURL || '',
        }
      : null;
    cloudAdapter = adapter || null;

    const initialOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    updateSyncStatus({
      state: initialOffline ? 'offline' : 'syncing',
      pendingWrites: false,
      errorCode: null,
      errorMessage: '',
    });

    let cloudData;
    try {
      if (typeof adapter?.openSession === 'function') {
        const sessionRes = await adapter.openSession(buildCloudListenerHandlers(sessionSeq));
        if (sessionSeq !== cloudSessionSeq) {
          sessionRes?.unsubscribe?.();
          return { ok: false, stale: true };
        }
        cloudData = sessionRes.initialData;
        cloudUnsub = typeof sessionRes.unsubscribe === 'function' ? sessionRes.unsubscribe : null;
      } else {
        cloudData = await adapter.fetchInitialCloudData();
      }
    } catch (err) {
      if (sessionSeq !== cloudSessionSeq) return { ok: false, stale: true };
      const code = err?.code || 'fetch-error';
      this.init();
      updateSyncStatus({
        state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error',
        pendingWrites: false,
        errorCode: code,
        errorMessage: err?.message || '',
      });
      return { ok: false, errorCode: code, error: err, needsSetup: false };
    }

    if (sessionSeq !== cloudSessionSeq) return { ok: false, stale: true };

    const cloudCategories = Array.isArray(cloudData?.categories) ? cloudData.categories : [];
    const cloudProducts = Array.isArray(cloudData?.products) ? cloudData.products : [];
    const cloudTransactions = Array.isArray(cloudData?.transactions) ? cloudData.transactions : [];
    const rawSettings = cloudData?.settings && typeof cloudData.settings === 'object' ? cloudData.settings : null;
    const cloudHasCompletedSettings = Boolean(
      rawSettings && (rawSettings.setupCompleted === true || String(rawSettings.storeName || '').trim() !== '')
    );
    const cloudHasData =
      cloudHasCompletedSettings ||
      cloudCategories.length > 0 ||
      cloudProducts.length > 0 ||
      cloudTransactions.length > 0;

    if (!cloudHasData) {
      // Brand-new account with empty cloud -> keep empty state and trigger simplified Setup Wizard
      const prefs = readAppearancePrefs();
      applyDatasetToState(
        normalizeDataset({
          settings: { ...DEFAULT_SETTINGS, ...prefs, setupCompleted: false },
          categories: [],
          products: [],
          transactions: [],
        })
      );
      return {
        ok: true,
        needsSetup: true,
        localMigrationCandidate: this.getLocalMigrationCandidate(),
        profileSuggestion: this.getLocalProfileSuggestion(),
      };
    }

    const prefs = readAppearancePrefs();
    const mergedSettings = rawSettings
      ? { ...rawSettings, setupCompleted: true }
      : { ...DEFAULT_SETTINGS, ...prefs, setupCompleted: true };

    const dataset = normalizeDataset({
      settings: mergedSettings,
      categories: cloudCategories,
      products: cloudProducts,
      transactions: cloudTransactions,
    });
    applyDatasetToState(dataset);

    if (!cloudUnsub) {
      attachCloudListeners(adapter, sessionSeq);
    }

    const nowOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    updateSyncStatus({
      state: nowOnline ? 'synced' : 'offline',
      pendingWrites: false,
      lastSyncedAt: nowOnline ? new Date().toISOString() : null,
      errorCode: null,
      errorMessage: '',
    });

    bus.emit('store:reset', { source: 'cloud-connect' });
    return { ok: true, needsSetup: false };
  },

  async completeSetup({
    storeName,
    storeAddress = '',
    storePhone = '',
    receiptFooter = '',
    importLocal = false,
  } = {}) {
    const cleanName = String(storeName || '').trim();
    if (!cleanName) {
      throw new Error(t('wizard.errStoreNameRequired'));
    }

    const sessionSeq = cloudSessionSeq;
    const prefs = readAppearancePrefs();
    const candidate = importLocal ? this.getLocalMigrationCandidate() : null;
    const baseSettings = candidate?.data?.settings || {};

    const nextSettings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...baseSettings,
      ...prefs,
      storeName: cleanName,
      storeAddress: String(storeAddress || '').trim(),
      storePhone: String(storePhone || '').trim(),
      receiptFooter: String(receiptFooter || '').trim(),
      setupCompleted: true,
    });

    const dataset = candidate
      ? {
          settings: nextSettings,
          categories: candidate.data.categories,
          products: candidate.data.products,
          transactions: candidate.data.transactions,
        }
      : {
          settings: nextSettings,
          categories: [],
          products: [],
          transactions: [],
        };

    if (cloudAdapter) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error(t('wizard.offlineImportError'));
      }

      updateSyncStatus({
        state: 'syncing',
        pendingWrites: true,
        errorCode: null,
        errorMessage: '',
      });

      await cloudAdapter.writeFullDataset(dataset);
      if (sessionSeq !== cloudSessionSeq) return { ok: false, stale: true };

      if (importLocal || !this.getLocalMigrationCandidate()) {
        // Clear legacy local keys only after cloud commit succeeds
        this.clearLocalLegacyData();
      }

      applyDatasetToState(dataset);
      if (!cloudUnsub) {
        attachCloudListeners(cloudAdapter, sessionSeq);
      }
    } else {
      applyDatasetToState(dataset);
      writeAllToStorage(
        dataset.settings,
        dataset.categories,
        dataset.products,
        dataset.transactions
      );
    }

    const nowOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    updateSyncStatus({
      state: nowOnline ? 'synced' : 'offline',
      pendingWrites: false,
      lastSyncedAt: nowOnline ? new Date().toISOString() : null,
      errorCode: null,
      errorMessage: '',
    });

    bus.emit('products:changed', { action: 'setup' });
    bus.emit('categories:changed', { action: 'setup' });
    bus.emit('transactions:changed', { action: 'setup' });
    bus.emit('settings:changed', this.getSettings());
    bus.emit('store:reset', { source: 'setup' });

    return {
      ok: true,
      importedLocal: Boolean(candidate),
      counts: {
        categories: dataset.categories.length,
        products: dataset.products.length,
        transactions: dataset.transactions.length,
      },
    };
  },

  getDemoDataCounts() {
    ensureInitialized();
    const demoProducts = state.products.filter((p) => p.isDemo === true);
    const demoTransactions = state.transactions.filter((tx) => tx.isDemo === true);
    const nonDemoProductCatIds = new Set(
      state.products.filter((p) => p.isDemo !== true && p.categoryId).map((p) => p.categoryId)
    );
    const emptyDemoCategories = state.categories.filter(
      (c) => c.isDemo === true && !nonDemoProductCatIds.has(c.id)
    );
    const products = demoProducts.length;
    const transactions = demoTransactions.length;
    const categories = emptyDemoCategories.length;
    return {
      products,
      transactions,
      categories,
      total: products + transactions + categories,
    };
  },

  hasDemoData() {
    return this.getDemoDataCounts().total > 0;
  },

  deleteSampleData() {
    ensureInitialized();
    const demoProductIds = state.products.filter((p) => p.isDemo === true).map((p) => p.id);
    const demoTxIds = state.transactions.filter((tx) => tx.isDemo === true).map((tx) => tx.id);

    const survivingProducts = state.products.filter((p) => p.isDemo !== true);
    const survivingTransactions = state.transactions.filter((tx) => tx.isDemo !== true);
    const usedCatIds = new Set(
      survivingProducts.map((p) => p.categoryId).filter(Boolean)
    );

    const deletedCategoryIds = [];
    const upsertedCategories = [];
    const survivingCategories = [];

    for (const cat of state.categories) {
      if (cat.isDemo === true) {
        if (usedCatIds.has(cat.id)) {
          const adopted = { ...cat, isDemo: false };
          survivingCategories.push(adopted);
          upsertedCategories.push(adopted);
        } else {
          deletedCategoryIds.push(cat.id);
        }
      } else {
        survivingCategories.push(cat);
      }
    }

    state.categories = survivingCategories;
    state.products = survivingProducts;
    state.transactions = survivingTransactions;

    if (!cloudAdapter) {
      persistLocalOnly(STORAGE_KEYS.categories, survivingCategories);
      persistLocalOnly(STORAGE_KEYS.products, survivingProducts);
      persistLocalOnly(STORAGE_KEYS.transactions, survivingTransactions);
    } else {
      runCloudWrite((adapter) =>
        adapter.deleteSampleDocs({
          productIds: demoProductIds,
          transactionIds: demoTxIds,
          categoryIds: deletedCategoryIds,
          upsertCategories: upsertedCategories,
        })
      );
    }

    bus.emit('categories:changed', { action: 'delete-sample' });
    bus.emit('products:changed', { action: 'delete-sample' });
    bus.emit('transactions:changed', { action: 'delete-sample' });

    return {
      ok: true,
      deletedProducts: demoProductIds.length,
      deletedTransactions: demoTxIds.length,
      deletedCategories: deletedCategoryIds.length,
    };
  },

  disconnectCloud() {
    cloudSessionSeq += 1;
    pendingCloudWriteCount = 0;
    if (cloudUnsub) {
      cloudUnsub();
      cloudUnsub = null;
    }
    cloudAdapter = null;
    currentUser = null;
    const prefs = readAppearancePrefs();
    state.initialized = false;
    state.categories = [];
    state.products = [];
    state.transactions = [];
    state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...prefs });
    syncStatus = {
      state: 'idle',
      lastSyncedAt: null,
      pendingWrites: false,
      errorCode: null,
      errorMessage: '',
    };
    emitSyncStatus();
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

    let categoryId = '';
    if (data?.categoryId === undefined) {
      categoryId = state.categories[0]?.id || '';
    } else if (data.categoryId) {
      const catExists = state.categories.some((c) => c.id === data.categoryId);
      categoryId = catExists ? data.categoryId : '';
    }

    const created = {
      id: uid('prd'),
      name,
      price,
      categoryId,
      sku: String(data?.sku || '').trim().toUpperCase(),
      stock,
      image: typeof data?.image === 'string' ? data.image : '',
      active: data?.active === undefined ? true : Boolean(data.active),
      isDemo: false,
      createdAt: new Date().toISOString(),
    };

    const nextProducts = [...state.products, created];
    persistLocalOnly(STORAGE_KEYS.products, nextProducts);
    state.products = nextProducts;
    runCloudWrite((adapter) => adapter.saveProduct(created));

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
      if (patch.categoryId === '') {
        next.categoryId = '';
      } else {
        const validCat = state.categories.some((c) => c.id === patch.categoryId);
        next.categoryId = validCat ? patch.categoryId : current.categoryId;
      }
    }

    if (patch?.sku !== undefined) {
      next.sku = String(patch.sku || '').trim().toUpperCase();
    }

    if (patch?.image !== undefined) {
      next.image = typeof patch.image === 'string' ? patch.image : '';
    }

    if (patch?.active !== undefined) {
      next.active = Boolean(patch.active);
    }

    if (
      patch?.name !== undefined ||
      patch?.price !== undefined ||
      patch?.sku !== undefined ||
      (typeof patch?.image === 'string' && patch.image.trim() !== '')
    ) {
      next.isDemo = false;
    }

    const nextProducts = [...state.products];
    nextProducts[idx] = next;
    persistLocalOnly(STORAGE_KEYS.products, nextProducts);
    state.products = nextProducts;
    runCloudWrite((adapter) => adapter.saveProduct(next));

    const cloned = cloneProduct(next);
    bus.emit('products:changed', { action: 'update', product: cloned });
    return cloned;
  },

  deleteProduct(id) {
    ensureInitialized();
    const idx = state.products.findIndex((p) => p.id === id);
    if (idx === -1) return false;

    const nextProducts = state.products.filter((p) => p.id !== id);
    persistLocalOnly(STORAGE_KEYS.products, nextProducts);
    state.products = nextProducts;
    runCloudWrite((adapter) => adapter.deleteProduct(id));

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
    persistLocalOnly(STORAGE_KEYS.products, nextProducts);
    state.products = nextProducts;
    runCloudWrite((adapter) => adapter.saveProduct(updated));

    const cloned = cloneProduct(updated);
    bus.emit('products:changed', { action: 'stock', product: cloned });
    return cloned;
  },

  // --- Categories ---
  getCategories() {
    ensureInitialized();
    return state.categories.map(cloneCategory);
  },

  addCategory({ name, icon, color } = {}) {
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

    const fallbackColor =
      DEFAULT_CATEGORY_COLORS[state.categories.length % DEFAULT_CATEGORY_COLORS.length];
    const cleanColor =
      typeof color === 'string' && HEX_COLOR_RE.test(color.trim()) ? color.trim() : fallbackColor;
    const cleanIcon = getCategoryIconName({ name: cleanName, icon });

    const created = {
      id: uid('cat'),
      name: cleanName,
      icon: cleanIcon,
      color: cleanColor,
      isDemo: false,
    };

    const nextCategories = [...state.categories, created];
    persistLocalOnly(STORAGE_KEYS.categories, nextCategories);
    state.categories = nextCategories;
    runCloudWrite((adapter) => adapter.saveCategory(created));

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

    if (patch?.icon !== undefined) {
      next.icon = getCategoryIconName({ icon: patch.icon, name: next.name });
    }

    if (patch?.color !== undefined) {
      next.color =
        typeof patch.color === 'string' && HEX_COLOR_RE.test(patch.color.trim())
          ? patch.color.trim()
          : current.color;
    }

    if (
      patch?.name !== undefined ||
      patch?.icon !== undefined ||
      patch?.color !== undefined
    ) {
      next.isDemo = false;
    }

    const nextCategories = [...state.categories];
    nextCategories[idx] = next;
    persistLocalOnly(STORAGE_KEYS.categories, nextCategories);
    state.categories = nextCategories;
    runCloudWrite((adapter) => adapter.saveCategory(next));

    const cloned = cloneCategory(next);
    bus.emit('categories:changed', { action: 'update', category: cloned });
    return cloned;
  },

  deleteCategory(id) {
    ensureInitialized();
    const exists = state.categories.some((c) => c.id === id);
    if (!exists) return false;

    const nextCategories = state.categories.filter((c) => c.id !== id);
    const fallbackCategoryId = nextCategories[0]?.id || '';

    const reassignedProducts = [];
    const nextProducts = state.products.map((product) => {
      if (product.categoryId === id) {
        const updated = { ...product, categoryId: fallbackCategoryId };
        reassignedProducts.push(updated);
        return updated;
      }
      return product;
    });

    persistLocalOnly(STORAGE_KEYS.categories, nextCategories);
    persistLocalOnly(STORAGE_KEYS.products, nextProducts);
    state.categories = nextCategories;
    state.products = nextProducts;
    runCloudWrite((adapter) => adapter.deleteCategoryWithReassign(id, reassignedProducts));

    bus.emit('categories:changed', { action: 'delete', id, fallbackCategoryId });
    bus.emit('products:changed', { action: 'category-reassigned', fromId: id, toId: fallbackCategoryId });
    return { ok: true, reassignedCount: reassignedProducts.length, fallbackCategoryId };
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

    const items = Array.isArray(txInput?.items) ? txInput.items.map(normalizeTxItem) : [];
    if (items.length === 0) {
      throw new Error(t('store.cartEmpty'));
    }

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

    const updatedProducts = [];
    let nextProducts = state.products;

    if (deductByProductId.size > 0) {
      nextProducts = state.products.map((product) => {
        const deductQty = deductByProductId.get(product.id);
        if (!deductQty) return product;
        const updated = {
          ...product,
          stock: Math.max(0, product.stock - deductQty),
        };
        updatedProducts.push(updated);
        return updated;
      });
    }

    const tx = normalizeTransaction({
      ...txInput,
      id: uid('tx'),
      receiptNo,
      createdAt,
      status: 'completed',
      voidedAt: null,
      voidReason: '',
      stockDeducted: true,
      isDemo: false,
      items,
    });

    const nextTransactions = [tx, ...state.transactions];
    persistLocalOnly(STORAGE_KEYS.transactions, nextTransactions);
    if (updatedProducts.length > 0) {
      persistLocalOnly(STORAGE_KEYS.products, nextProducts);
      state.products = nextProducts;
    }
    state.transactions = nextTransactions;
    runCloudWrite((adapter) => adapter.saveTransactionAndProducts(tx, updatedProducts));

    const cloned = cloneTransaction(tx);
    bus.emit('transactions:changed', { action: 'create', transaction: cloned });
    if (updatedProducts.length > 0) {
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

    const restoredProducts = [];
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
          const updated = {
            ...product,
            stock: product.stock + restoreQty,
          };
          restoredProducts.push(updated);
          return updated;
        });
      }
    }

    const nextTransactions = [...state.transactions];
    nextTransactions[idx] = voidedTx;

    persistLocalOnly(STORAGE_KEYS.transactions, nextTransactions);
    if (restoredProducts.length > 0) {
      persistLocalOnly(STORAGE_KEYS.products, nextProducts);
      state.products = nextProducts;
    }
    state.transactions = nextTransactions;
    runCloudWrite((adapter) => adapter.saveTransactionAndProducts(voidedTx, restoredProducts));

    const cloned = cloneTransaction(voidedTx);
    bus.emit('transactions:changed', { action: 'void', transaction: cloned });
    if (restoredProducts.length > 0) {
      bus.emit('products:changed', { action: 'void-restore', transactionId: cloned.id });
    }
    return { ok: true, transaction: cloned };
  },

  // --- Settings & Export ---
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

    persistLocalOnly(STORAGE_KEYS.settings, nextSettings);
    syncAppearancePrefsStorage(nextSettings);
    state.settings = nextSettings;
    setLanguage(nextSettings.language);
    runCloudWrite((adapter) => adapter.saveSettings(nextSettings));

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
      version: 2,
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      categories: this.getCategories(),
      products: this.getProducts(),
      transactions: this.getTransactions(),
    };
    return JSON.stringify(payload, null, 2);
  },

  exportProductsCsv() {
    ensureInitialized();
    const catMap = new Map(this.getCategories().map((c) => [c.id, c.name]));
    const headers = [
      t('csv.prodName'),
      t('csv.prodSku'),
      t('csv.prodCategory'),
      t('csv.prodPrice'),
      t('csv.prodStock'),
      t('csv.prodStatus'),
    ];
    const rows = this.getProducts().map((p) => [
      p.name,
      p.sku || '',
      catMap.get(p.categoryId) || t('products.uncategorized'),
      p.price,
      p.stock,
      p.active ? t('common.active') : t('common.inactive'),
    ]);
    return '\uFEFF' + [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  },

  exportTransactionsCsv() {
    ensureInitialized();
    const headers = [
      t('csv.txCode'),
      t('csv.txDate'),
      t('csv.txStatus'),
      t('csv.txCustomer'),
      t('csv.txMethod'),
      t('csv.txMethodDetail'),
      t('csv.txItemCount'),
      t('csv.txSubtotal'),
      t('csv.txOrderDiscount'),
      t('csv.txService'),
      t('csv.txTax'),
      t('csv.txTotal'),
      t('csv.txVoidReason'),
    ];
    const rows = this.getTransactions().map((tx) => {
      const qtySum = (tx.items || []).reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
      return [
        formatTransactionCode(tx),
        formatDateTime(tx.createdAt),
        tx.status === 'void' ? 'VOID' : t('history.statusCompleted'),
        tx.customerName || '',
        tx.paymentMethod || 'cash',
        tx.paymentDetail || '',
        qtySum,
        tx.subtotal,
        tx.orderDiscountAmount,
        tx.serviceAmount,
        tx.taxAmount,
        tx.grandTotal,
        tx.status === 'void' ? tx.voidReason || '' : '',
      ];
    });
    return '\uFEFF' + [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  },
};
