const LEGACY_SEED_CATEGORIES = {
  cat_minuman: ['Minuman', 'Minuman Kemasan'],
  cat_makanan: ['Makanan'],
  cat_camilan: ['Camilan', 'Snack & Roti'],
  cat_retail: ['Retail & Aksesoris'],
  cat_harian: ['Kebutuhan Harian'],
  cat_elektronik: ['Aksesoris & Gadget'],
  cat_perlengkapan: ['Tas & Perlengkapan'],
};

const LEGACY_SEED_PRODUCTS = {
  prd_mnm_01: { name: 'Es Kopi Susu Gula Aren', price: 22000, stock: 45, sku: 'MNM-001' },
  prd_mnm_02: { name: 'Matcha Latte Dingin', price: 25000, stock: 30, sku: 'MNM-002' },
  prd_mnm_03: { name: 'Es Teh Manis Jumbo', price: 8000, stock: 80, sku: 'MNM-003' },
  prd_mnm_04: { name: 'Air Mineral 600ml', price: 5000, stock: 120, sku: 'MNM-004' },
  prd_mkn_01: { name: 'Nasi Goreng Spesial', price: 28000, stock: 25, sku: 'MKN-001' },
  prd_mkn_02: { name: 'Mie Ayam Bakso', price: 22000, stock: 20, sku: 'MKN-002' },
  prd_mkn_03: { name: 'Ayam Geprek Sambal Matah', price: 26000, stock: 18, sku: 'MKN-003' },
  prd_mkn_04: { name: 'Roti Bakar Cokelat Keju', price: 18000, stock: 24, sku: 'MKN-004' },
  prd_cml_01: { name: 'Croissant Butter', price: 20000, stock: 15, sku: 'CML-001' },
  prd_cml_02: { name: 'Pisang Goreng Keju', price: 15000, stock: 22, sku: 'CML-002' },
  prd_cml_03: { name: 'Keripik Singkong Balado', price: 14000, stock: 35, sku: 'CML-003' },
  prd_cml_04: { name: 'Donat Kampung Gula', price: 10000, stock: 3, sku: 'CML-004' },
  prd_rtl_01: { name: 'Kabel USB-C Fast 1m', price: 35000, stock: 14, sku: 'RTL-001' },
  prd_rtl_02: { name: 'Tumbler Stainless 500ml', price: 85000, stock: 9, sku: 'RTL-002' },
  prd_rtl_03: { name: 'Tote Bag Kanvas Polos', price: 45000, stock: 16, sku: 'RTL-003' },
  prd_hrn_01: { name: 'Sabun Cair Botol 250ml', price: 24000, stock: 28, sku: 'HRN-001' },
  prd_hrn_02: { name: 'Tisu Wajah 200 Lembar', price: 12000, stock: 40, sku: 'HRN-002' },
  prd_hrn_03: { name: 'Baterai AA Isi 4', price: 18000, stock: 20, sku: 'HRN-003' },
};

const LEGACY_SEED_TX_STATUS = {
  tx_seed_01: 'completed',
  tx_seed_02: 'completed',
  tx_seed_03: 'void',
  tx_seed_04: 'completed',
  tx_seed_05: 'completed',
  tx_seed_06: 'completed',
  tx_seed_07: 'completed',
  tx_seed_08: 'completed',
  tx_seed_09: 'completed',
  tx_seed_10: 'completed',
  tx_seed_11: 'completed',
  tx_seed_12: 'completed',
  tx_seed_13: 'completed',
  tx_seed_14: 'completed',
  tx_seed_15: 'completed',
  tx_seed_16: 'void',
};

const DEFAULT_STORE_NAMES = new Set(['', 'arupos', 'toko aru', 'kedai & toko aru']);
const DEFAULT_STORE_ADDRS = new Set(['', 'jl. boulevard deltamas no. 18, cikarang']);
const DEFAULT_STORE_PHONES = new Set(['', '0812-3456-7890']);

export function isLegacySeedProductCoreUnchanged(prod) {
  if (!prod || typeof prod !== 'object') return false;
  const spec = LEGACY_SEED_PRODUCTS[String(prod.id || '')];
  if (!spec) return false;
  const name = String(prod.name || '').trim();
  const price = Math.round(Number(prod.price) || 0);
  const sku = String(prod.sku || '').trim().toUpperCase();
  const hasImage = typeof prod.image === 'string' && prod.image.trim() !== '';
  return !hasImage && name === spec.name && price === spec.price && sku === spec.sku;
}

export function isUntouchedLegacySeedProduct(prod) {
  if (!isLegacySeedProductCoreUnchanged(prod)) return false;
  const spec = LEGACY_SEED_PRODUCTS[String(prod.id || '')];
  const stock = Math.round(Number(prod.stock) || 0);
  return prod.active !== false && stock === spec.stock;
}

export function isLegacySeedCategoryNameUnchanged(cat) {
  if (!cat || typeof cat !== 'object') return false;
  const names = LEGACY_SEED_CATEGORIES[String(cat.id || '')];
  if (!names) return false;
  return names.includes(String(cat.name || '').trim());
}

export function isUntouchedLegacySeedTransaction(tx) {
  if (!tx || typeof tx !== 'object') return false;
  const id = String(tx.id || '');
  if (!(id in LEGACY_SEED_TX_STATUS)) return false;
  const status = tx.status === 'void' ? 'void' : 'completed';
  return status === LEGACY_SEED_TX_STATUS[id];
}

export function extractCustomLocalProfile(rawSettings) {
  const s = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  const rawName = String(s.storeName || '').trim();
  const rawAddr = String(s.storeAddress || '').trim();
  const rawPhone = String(s.storePhone || '').trim();
  const rawFooter = String(s.receiptFooter || '').trim();
  return {
    storeName: DEFAULT_STORE_NAMES.has(rawName.toLowerCase()) ? '' : rawName,
    storeAddress: DEFAULT_STORE_ADDRS.has(rawAddr.toLowerCase()) ? '' : rawAddr,
    storePhone: DEFAULT_STORE_PHONES.has(rawPhone.toLowerCase()) ? '' : rawPhone,
    receiptFooter: rawFooter === 'Terima kasih sudah berbelanja! Simpan struk ini sebagai bukti pembayaran.' ? '' : rawFooter,
  };
}

export function filterLocalDataForMigration(raw = {}) {
  const rawCategories = Array.isArray(raw.categories) ? raw.categories : [];
  const rawProducts = Array.isArray(raw.products) ? raw.products : [];
  const rawTransactions = Array.isArray(raw.transactions) ? raw.transactions : [];

  let excludedDemoCount = 0;

  // 1. Filter products: discard exact untouched legacy seed products, keep edited/custom ones
  const keptProducts = [];
  const referencedCatIds = new Set();
  for (const prod of rawProducts) {
    if (!prod || typeof prod !== 'object') continue;
    if (isUntouchedLegacySeedProduct(prod)) {
      excludedDemoCount += 1;
      continue;
    }
    const coreUnchanged = isLegacySeedProductCoreUnchanged(prod);
    const nextProd = {
      ...prod,
      isDemo: coreUnchanged,
    };
    keptProducts.push(nextProd);
    if (nextProd.categoryId) {
      referencedCatIds.add(String(nextProd.categoryId));
    }
  }

  // 2. Filter transactions: discard untouched tx_seed_* items, keep real/modified ones
  const keptTransactions = [];
  for (const tx of rawTransactions) {
    if (!tx || typeof tx !== 'object') continue;
    if (isUntouchedLegacySeedTransaction(tx)) {
      excludedDemoCount += 1;
      continue;
    }
    const isSeedId = /^tx_seed_\d+$/i.test(String(tx.id || ''));
    keptTransactions.push({
      ...tx,
      isDemo: Boolean(tx.isDemo) || isSeedId,
    });
  }

  // 3. Filter categories: keep custom/renamed categories or seed categories still used by kept products
  const keptCategories = [];
  for (const cat of rawCategories) {
    if (!cat || typeof cat !== 'object') continue;
    const catId = String(cat.id || '');
    const unchangedSeedCat = isLegacySeedCategoryNameUnchanged(cat);
    const isReferenced = referencedCatIds.has(catId);
    if (unchangedSeedCat && !isReferenced) {
      excludedDemoCount += 1;
      continue;
    }
    keptCategories.push({
      ...cat,
      isDemo: unchangedSeedCat,
    });
  }

  const profile = extractCustomLocalProfile(raw.settings);
  const hasRealProfile = Boolean(profile.storeName || profile.storeAddress || profile.storePhone);
  const hasRealData =
    keptProducts.length > 0 ||
    keptCategories.length > 0 ||
    keptTransactions.length > 0;

  return {
    hasRealData,
    hasRealProfile,
    excludedDemoCount,
    customProfile: profile,
    counts: {
      categories: keptCategories.length,
      products: keptProducts.length,
      transactions: keptTransactions.length,
    },
    data: {
      settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
      categories: keptCategories,
      products: keptProducts,
      transactions: keptTransactions,
    },
  };
}
