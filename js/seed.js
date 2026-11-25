import { getLocalDateKey } from './utils.js';

function makeSeedDate(daysAgo, hours, minutes) {
  const now = new Date();
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysAgo,
    hours,
    minutes,
    0,
    0
  );

  if (daysAgo === 0 && target.getTime() > now.getTime()) {
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      1,
      0,
      0
    ).getTime();
    const span = Math.max(60_000, now.getTime() - startOfToday);
    const ratio = Math.min(0.95, Math.max(0.08, (hours * 60 + minutes) / (24 * 60)));
    return new Date(Math.round(startOfToday + span * ratio));
  }

  return target;
}

function formatReceiptNo(date, seq) {
  const compact = getLocalDateKey(date).replace(/-/g, '');
  return `TRX-${compact}-${String(seq).padStart(3, '0')}`;
}

function buildSeedTransaction(productMap, spec, createdDate, seq) {
  const items = spec.items.map((entry) => {
    const product = productMap.get(entry.productId);
    const price = product ? product.price : entry.price || 0;
    const qty = Math.max(1, Math.round(entry.qty || 1));
    const grossTotal = price * qty;
    const discountType = entry.discountType || 'none';
    const discountValue = Number(entry.discountValue) || 0;

    let discountAmount = 0;
    if (discountType === 'percent') {
      discountAmount = Math.min(grossTotal, Math.round(grossTotal * (discountValue / 100)));
    } else if (discountType === 'nominal') {
      discountAmount = Math.min(grossTotal, Math.max(0, Math.round(discountValue)));
    }

    const netTotal = grossTotal - discountAmount;

    return {
      productId: product ? product.id : entry.productId,
      name: product ? product.name : entry.name || 'Produk',
      sku: product ? product.sku : '',
      emoji: product ? product.emoji : '📦',
      price,
      qty,
      grossTotal,
      discountType,
      discountValue,
      discountAmount,
      netTotal,
      note: entry.note || '',
    };
  });

  const rawSubtotal = items.reduce((sum, item) => sum + item.grossTotal, 0);
  const itemDiscountTotal = items.reduce((sum, item) => sum + item.discountAmount, 0);
  const subtotal = rawSubtotal - itemDiscountTotal;

  const orderDiscountType = spec.orderDiscountType || 'none';
  const orderDiscountValue = Number(spec.orderDiscountValue) || 0;
  let orderDiscountAmount = 0;
  if (orderDiscountType === 'percent') {
    orderDiscountAmount = Math.min(subtotal, Math.round(subtotal * (orderDiscountValue / 100)));
  } else if (orderDiscountType === 'nominal') {
    orderDiscountAmount = Math.min(subtotal, Math.max(0, Math.round(orderDiscountValue)));
  }

  const afterOrderDiscount = Math.max(0, subtotal - orderDiscountAmount);

  const serviceEnabled = Boolean(spec.serviceEnabled);
  const serviceRate = serviceEnabled ? Number(spec.serviceRate ?? 5) : 0;
  const serviceAmount = serviceEnabled
    ? Math.round(afterOrderDiscount * (serviceRate / 100))
    : 0;

  const taxEnabled = Boolean(spec.taxEnabled);
  const taxRate = taxEnabled ? Number(spec.taxRate ?? 11) : 0;
  const taxLabel = spec.taxLabel || 'PPN';
  const taxAmount = taxEnabled
    ? Math.round((afterOrderDiscount + serviceAmount) * (taxRate / 100))
    : 0;

  const grandTotal = afterOrderDiscount + serviceAmount + taxAmount;

  const paymentMethod = spec.paymentMethod || 'cash';
  const paymentDetail = spec.paymentDetail || 'Tunai';
  let cashReceived = grandTotal;
  let changeAmount = 0;
  if (paymentMethod === 'cash') {
    cashReceived =
      spec.cashReceived !== undefined && spec.cashReceived >= grandTotal
        ? Math.round(spec.cashReceived)
        : Math.ceil(grandTotal / 10_000) * 10_000;
    changeAmount = cashReceived - grandTotal;
  }

  const status = spec.status === 'void' ? 'void' : 'completed';
  const voidedAt =
    status === 'void'
      ? new Date(createdDate.getTime() + 6 * 60_000).toISOString()
      : null;

  return {
    id: spec.id,
    receiptNo: formatReceiptNo(createdDate, seq),
    createdAt: createdDate.toISOString(),
    status,
    voidedAt,
    voidReason: status === 'void' ? spec.voidReason || 'Salah input item' : '',
    mode: spec.mode || 'retail',
    stockDeducted: spec.stockDeducted !== undefined ? Boolean(spec.stockDeducted) : true,
    orderType: spec.orderType || '',
    tableNumber: spec.tableNumber || '',
    customerName: spec.customerName || '',
    items,
    rawSubtotal,
    itemDiscountTotal,
    subtotal,
    orderDiscountType,
    orderDiscountValue,
    orderDiscountAmount,
    serviceEnabled,
    serviceRate,
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

export function createSeedData() {
  const settings = {
    storeName: 'Kedai & Toko Aru',
    storeAddress: 'Jl. Boulevard Deltamas No. 18, Cikarang',
    storePhone: '0812-3456-7890',
    receiptFooter: 'Terima kasih sudah berbelanja! Simpan struk ini sebagai bukti pembayaran.',
    mode: 'retail',
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

  const categories = [
    { id: 'cat_minuman', name: 'Minuman', icon: 'cup', emoji: '☕', color: '#0EA5E9' },
    { id: 'cat_makanan', name: 'Makanan', icon: 'utensils', emoji: '🍜', color: '#D97706' },
    { id: 'cat_camilan', name: 'Camilan', icon: 'cookie', emoji: '🥐', color: '#DB2777' },
    { id: 'cat_retail', name: 'Retail & Aksesoris', icon: 'bag', emoji: '🛍️', color: '#7C3AED' },
    { id: 'cat_harian', name: 'Kebutuhan Harian', icon: 'daily', emoji: '🧴', color: '#0D9488' },
  ];

  const productBaseTime = makeSeedDate(14, 9, 0).getTime();
  const rawProducts = [
    { id: 'prd_mnm_01', name: 'Es Kopi Susu Gula Aren', price: 22000, categoryId: 'cat_minuman', sku: 'MNM-001', stock: 45, emoji: '🧋' },
    { id: 'prd_mnm_02', name: 'Matcha Latte Dingin', price: 25000, categoryId: 'cat_minuman', sku: 'MNM-002', stock: 30, emoji: '🍵' },
    { id: 'prd_mnm_03', name: 'Es Teh Manis Jumbo', price: 8000, categoryId: 'cat_minuman', sku: 'MNM-003', stock: 80, emoji: '🧊' },
    { id: 'prd_mnm_04', name: 'Air Mineral 600ml', price: 5000, categoryId: 'cat_minuman', sku: 'MNM-004', stock: 120, emoji: '💧' },
    { id: 'prd_mkn_01', name: 'Nasi Goreng Spesial', price: 28000, categoryId: 'cat_makanan', sku: 'MKN-001', stock: 25, emoji: '🍳' },
    { id: 'prd_mkn_02', name: 'Mie Ayam Bakso', price: 22000, categoryId: 'cat_makanan', sku: 'MKN-002', stock: 20, emoji: '🍜' },
    { id: 'prd_mkn_03', name: 'Ayam Geprek Sambal Matah', price: 26000, categoryId: 'cat_makanan', sku: 'MKN-003', stock: 18, emoji: '🍗' },
    { id: 'prd_mkn_04', name: 'Roti Bakar Cokelat Keju', price: 18000, categoryId: 'cat_makanan', sku: 'MKN-004', stock: 24, emoji: '🍞' },
    { id: 'prd_cml_01', name: 'Croissant Butter', price: 20000, categoryId: 'cat_camilan', sku: 'CML-001', stock: 15, emoji: '🥐' },
    { id: 'prd_cml_02', name: 'Pisang Goreng Keju', price: 15000, categoryId: 'cat_camilan', sku: 'CML-002', stock: 22, emoji: '🍌' },
    { id: 'prd_cml_03', name: 'Keripik Singkong Balado', price: 14000, categoryId: 'cat_camilan', sku: 'CML-003', stock: 35, emoji: '🥨' },
    { id: 'prd_cml_04', name: 'Donat Kampung Gula', price: 10000, categoryId: 'cat_camilan', sku: 'CML-004', stock: 3, emoji: '🍩' },
    { id: 'prd_rtl_01', name: 'Kabel USB-C Fast 1m', price: 35000, categoryId: 'cat_retail', sku: 'RTL-001', stock: 14, emoji: '🔌' },
    { id: 'prd_rtl_02', name: 'Tumbler Stainless 500ml', price: 85000, categoryId: 'cat_retail', sku: 'RTL-002', stock: 9, emoji: '🥤' },
    { id: 'prd_rtl_03', name: 'Tote Bag Kanvas Polos', price: 45000, categoryId: 'cat_retail', sku: 'RTL-003', stock: 16, emoji: '👜' },
    { id: 'prd_hrn_01', name: 'Sabun Cair Botol 250ml', price: 24000, categoryId: 'cat_harian', sku: 'HRN-001', stock: 28, emoji: '🧴' },
    { id: 'prd_hrn_02', name: 'Tisu Wajah 200 Lembar', price: 12000, categoryId: 'cat_harian', sku: 'HRN-002', stock: 40, emoji: '🧻' },
    { id: 'prd_hrn_03', name: 'Baterai AA Isi 4', price: 18000, categoryId: 'cat_harian', sku: 'HRN-003', stock: 20, emoji: '🔋' },
  ];

  const products = rawProducts.map((item, idx) => ({
    ...item,
    image: '',
    active: true,
    createdAt: new Date(productBaseTime + idx * 120_000).toISOString(),
  }));

  const productMap = new Map(products.map((p) => [p.id, p]));

  const txSpecs = [
    // Hari ini (4 transaksi: 3 selesai + 1 batal/void)
    {
      id: 'tx_seed_01',
      daysAgo: 0,
      hours: 8,
      minutes: 45,
      seq: 1,
      paymentMethod: 'qris',
      paymentDetail: 'QRIS Dinamis',
      customerName: 'Nadia',
      items: [
        { productId: 'prd_mnm_01', qty: 2, note: 'Es sedikit' },
        { productId: 'prd_cml_01', qty: 1 },
      ],
    },
    {
      id: 'tx_seed_02',
      daysAgo: 0,
      hours: 10,
      minutes: 15,
      seq: 2,
      paymentMethod: 'cash',
      paymentDetail: 'Tunai',
      cashReceived: 100000,
      customerName: 'Budi Santoso',
      items: [
        { productId: 'prd_mkn_01', qty: 1 },
        { productId: 'prd_mkn_03', qty: 1, note: 'Sambal dipisah' },
        { productId: 'prd_mnm_03', qty: 2 },
      ],
    },
    {
      id: 'tx_seed_03',
      daysAgo: 0,
      hours: 11,
      minutes: 20,
      seq: 3,
      status: 'void',
      voidReason: 'Salah input item',
      paymentMethod: 'cash',
      paymentDetail: 'Tunai',
      cashReceived: 50000,
      items: [
        { productId: 'prd_cml_04', qty: 2 },
        { productId: 'prd_mnm_02', qty: 1 },
      ],
    },
    {
      id: 'tx_seed_04',
      daysAgo: 0,
      hours: 12,
      minutes: 30,
      seq: 4,
      paymentMethod: 'ewallet',
      paymentDetail: 'GoPay',
      orderDiscountType: 'nominal',
      orderDiscountValue: 5000,
      items: [
        { productId: 'prd_rtl_02', qty: 1 },
        { productId: 'prd_mnm_02', qty: 1 },
      ],
    },

    // Kemarin (daysAgo: 1)
    {
      id: 'tx_seed_05',
      daysAgo: 1,
      hours: 11,
      minutes: 10,
      seq: 1,
      paymentMethod: 'qris',
      paymentDetail: 'QRIS Statis',
      customerName: 'Rina',
      items: [
        { productId: 'prd_mkn_02', qty: 2 },
        { productId: 'prd_mnm_03', qty: 2 },
        { productId: 'prd_cml_02', qty: 1 },
      ],
    },
    {
      id: 'tx_seed_06',
      daysAgo: 1,
      hours: 16,
      minutes: 40,
      seq: 2,
      paymentMethod: 'transfer',
      paymentDetail: 'Transfer BCA',
      items: [
        { productId: 'prd_rtl_01', qty: 2 },
        { productId: 'prd_rtl_03', qty: 1, discountType: 'percent', discountValue: 10 },
      ],
    },

    // 2 hari lalu (daysAgo: 2)
    {
      id: 'tx_seed_07',
      daysAgo: 2,
      hours: 9,
      minutes: 50,
      seq: 1,
      paymentMethod: 'cash',
      paymentDetail: 'Tunai',
      cashReceived: 100000,
      items: [
        { productId: 'prd_hrn_01', qty: 2 },
        { productId: 'prd_hrn_02', qty: 2 },
        { productId: 'prd_hrn_03', qty: 1 },
      ],
    },
    {
      id: 'tx_seed_08',
      daysAgo: 2,
      hours: 15,
      minutes: 25,
      seq: 2,
      paymentMethod: 'ewallet',
      paymentDetail: 'OVO',
      customerName: 'Dimas',
      items: [
        { productId: 'prd_mnm_01', qty: 3 },
        { productId: 'prd_mkn_04', qty: 2 },
      ],
    },

    // 3 hari lalu (daysAgo: 3)
    {
      id: 'tx_seed_09',
      daysAgo: 3,
      hours: 12,
      minutes: 5,
      seq: 1,
      paymentMethod: 'qris',
      paymentDetail: 'QRIS Dinamis',
      items: [
        { productId: 'prd_mkn_03', qty: 2 },
        { productId: 'prd_mnm_04', qty: 2 },
        { productId: 'prd_cml_03', qty: 1 },
      ],
    },
    {
      id: 'tx_seed_10',
      daysAgo: 3,
      hours: 18,
      minutes: 15,
      seq: 2,
      paymentMethod: 'cash',
      paymentDetail: 'Tunai',
      cashReceived: 150000,
      orderDiscountType: 'percent',
      orderDiscountValue: 5,
      items: [
        { productId: 'prd_rtl_02', qty: 1 },
        { productId: 'prd_rtl_01', qty: 1 },
        { productId: 'prd_mnm_04', qty: 1 },
      ],
    },

    // 4 hari lalu (daysAgo: 4)
    {
      id: 'tx_seed_11',
      daysAgo: 4,
      hours: 13,
      minutes: 30,
      seq: 1,
      paymentMethod: 'transfer',
      paymentDetail: 'Transfer Mandiri',
      customerName: 'Ibu Sari',
      items: [
        { productId: 'prd_mkn_01', qty: 2 },
        { productId: 'prd_mkn_02', qty: 1 },
        { productId: 'prd_mnm_01', qty: 2 },
        { productId: 'prd_cml_02', qty: 1 },
      ],
    },

    // 5 hari lalu (daysAgo: 5)
    {
      id: 'tx_seed_12',
      daysAgo: 5,
      hours: 10,
      minutes: 20,
      seq: 1,
      paymentMethod: 'cash',
      paymentDetail: 'Tunai',
      cashReceived: 50000,
      items: [
        { productId: 'prd_cml_01', qty: 1 },
        { productId: 'prd_cml_04', qty: 2 },
        { productId: 'prd_mnm_03', qty: 1 },
      ],
    },
    {
      id: 'tx_seed_13',
      daysAgo: 5,
      hours: 17,
      minutes: 5,
      seq: 2,
      paymentMethod: 'ewallet',
      paymentDetail: 'DANA',
      items: [
        { productId: 'prd_rtl_03', qty: 2 },
        { productId: 'prd_hrn_01', qty: 1 },
        { productId: 'prd_hrn_02', qty: 1 },
      ],
    },

    // 6 hari lalu (daysAgo: 6)
    {
      id: 'tx_seed_14',
      daysAgo: 6,
      hours: 14,
      minutes: 45,
      seq: 1,
      paymentMethod: 'qris',
      paymentDetail: 'QRIS Dinamis',
      customerName: 'Hendra',
      items: [
        { productId: 'prd_mkn_04', qty: 2 },
        { productId: 'prd_mnm_02', qty: 2 },
        { productId: 'prd_cml_03', qty: 2 },
      ],
    },
  ];

  const transactions = txSpecs
    .map((spec) => {
      const createdDate = makeSeedDate(spec.daysAgo, spec.hours, spec.minutes);
      return buildSeedTransaction(productMap, spec, createdDate, spec.seq);
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    settings,
    categories,
    products,
    transactions,
  };
}
