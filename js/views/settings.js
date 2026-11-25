import {
  getLocalDateKey,
  formatDateTime,
  escapeHtml,
  clamp,
  bus,
} from '../utils.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { renderReceiptHtml } from '../receipt.js';
import {
  applyTheme,
  applyAccent,
  ACCENT_THEMES,
  toast,
  confirmDialog,
  animateLanguageSwitch,
} from '../motion.js';
import { t, LANGUAGES, VALID_LANGUAGES } from '../i18n.js';

const THEME_PREF_KEY = 'arupos_v1_theme_pref';
const VALID_ACCENTS = ACCENT_THEMES.map((item) => item.id);

let rootEl = null;
let unsubs = [];
let skipNextSettingsRender = false;

function readThemePref(storeTheme) {
  if (storeTheme === 'light' || storeTheme === 'dark' || storeTheme === 'system') {
    return storeTheme;
  }
  try {
    const saved = window.localStorage.getItem(THEME_PREF_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
  } catch {
    // Ignore storage read errors
  }
  return 'light';
}

function writeThemePref(mode) {
  try {
    if (mode === 'light' || mode === 'dark' || mode === 'system') {
      window.localStorage.setItem(THEME_PREF_KEY, mode);
    } else {
      window.localStorage.removeItem(THEME_PREF_KEY);
    }
  } catch {
    // Ignore storage write errors
  }
}

function getSettingsSafe() {
  const s = store.getSettings() || {};
  const theme = readThemePref(s.theme);
  const accent = VALID_ACCENTS.includes(s.accent) ? s.accent : 'emerald';
  const language = VALID_LANGUAGES.includes(s.language) ? s.language : 'id';

  return {
    theme,
    accent,
    language,
    storeName: String(s.storeName ?? ''),
    storeAddress: String(s.storeAddress ?? ''),
    storePhone: String(s.storePhone ?? ''),
    receiptFooter: String(s.receiptFooter ?? ''),
    taxEnabled: Boolean(s.taxEnabled),
    taxLabel: String(s.taxLabel ?? 'PPN').trim() || 'PPN',
    taxRate: clamp(Number(s.taxRate ?? 11), 0, 100),
    serviceEnabled: Boolean(s.serviceEnabled),
    serviceLabel: String(s.serviceLabel ?? 'Service').trim() || 'Service',
    serviceRate: clamp(Number(s.serviceRate ?? 5), 0, 100),
  };
}

function buildSampleReceiptHtml(draft) {
  const sampleSubtotal = 47000;
  const serviceRate = draft.serviceEnabled ? clamp(draft.serviceRate, 0, 100) : 0;
  const serviceAmount = draft.serviceEnabled ? Math.round((sampleSubtotal * serviceRate) / 100) : 0;
  const taxRate = draft.taxEnabled ? clamp(draft.taxRate, 0, 100) : 0;
  const taxAmount = draft.taxEnabled ? Math.round(((sampleSubtotal + serviceAmount) * taxRate) / 100) : 0;
  const grandTotal = sampleSubtotal + serviceAmount + taxAmount;

  const sampleTx = {
    id: 'preview_tx',
    receiptNo: t('settings.sampleReceiptNo'),
    createdAt: new Date().toISOString(),
    status: 'completed',
    customerName: '',
    items: [
      {
        name: t('settings.sampleItem1'),
        price: 25000,
        qty: 1,
        grossTotal: 25000,
        discountAmount: 0,
        netTotal: 25000,
        note: '',
      },
      {
        name: t('settings.sampleItem2'),
        price: 22000,
        qty: 1,
        grossTotal: 22000,
        discountAmount: 0,
        netTotal: 22000,
        note: '',
      },
    ],
    subtotal: sampleSubtotal,
    orderDiscountAmount: 0,
    serviceEnabled: draft.serviceEnabled,
    serviceRate,
    serviceLabel: draft.serviceLabel || 'Service',
    serviceAmount,
    taxEnabled: draft.taxEnabled,
    taxRate,
    taxLabel: draft.taxLabel || 'PPN',
    taxAmount,
    grandTotal,
    paymentMethod: 'cash',
    paymentDetail: '',
    cashReceived: Math.ceil(grandTotal / 50000) * 50000,
    changeAmount: Math.max(0, Math.ceil(grandTotal / 50000) * 50000 - grandTotal),
  };

  return renderReceiptHtml(sampleTx, {
    storeName: String(draft.storeName || '').trim() || t('settings.defaultStoreName'),
    storeAddress: String(draft.storeAddress || '').trim(),
    storePhone: String(draft.storePhone || '').trim(),
    receiptFooter: String(draft.receiptFooter || '').trim(),
    taxLabel: draft.taxLabel || 'PPN',
    taxRate,
    serviceLabel: draft.serviceLabel || 'Service',
    serviceRate,
  });
}

function readDraftFromDom() {
  const s = getSettingsSafe();
  if (!rootEl) return s;

  const storeForm = rootEl.querySelector('#settings-store-form');
  const taxForm = rootEl.querySelector('#settings-tax-form');

  const storeName = storeForm?.querySelector('[name="storeName"]')?.value ?? s.storeName;
  const storeAddress = storeForm?.querySelector('[name="storeAddress"]')?.value ?? s.storeAddress;
  const storePhone = storeForm?.querySelector('[name="storePhone"]')?.value ?? s.storePhone;
  const receiptFooter = storeForm?.querySelector('[name="receiptFooter"]')?.value ?? s.receiptFooter;

  const taxEnabled = taxForm?.querySelector('[name="taxEnabled"]')?.checked ?? s.taxEnabled;
  const taxLabel = taxForm?.querySelector('[name="taxLabel"]')?.value ?? s.taxLabel;
  const taxRate = Number(taxForm?.querySelector('[name="taxRate"]')?.value ?? s.taxRate) || 0;

  const serviceEnabled = taxForm?.querySelector('[name="serviceEnabled"]')?.checked ?? s.serviceEnabled;
  const serviceLabel = taxForm?.querySelector('[name="serviceLabel"]')?.value ?? s.serviceLabel;
  const serviceRate = Number(taxForm?.querySelector('[name="serviceRate"]')?.value ?? s.serviceRate) || 0;

  return {
    ...s,
    storeName,
    storeAddress,
    storePhone,
    receiptFooter,
    taxEnabled,
    taxLabel: String(taxLabel || 'PPN').trim() || 'PPN',
    taxRate: clamp(taxRate, 0, 100),
    serviceEnabled,
    serviceLabel: String(serviceLabel || 'Service').trim() || 'Service',
    serviceRate: clamp(serviceRate, 0, 100),
  };
}

function updateLivePreview() {
  if (!rootEl) return;
  const previewEl = rootEl.querySelector('[data-mini-receipt-preview]');
  if (!previewEl) return;
  previewEl.innerHTML = buildSampleReceiptHtml(readDraftFromDom());
}

function syncTaxFieldStates() {
  if (!rootEl) return;
  const taxForm = rootEl.querySelector('#settings-tax-form');
  if (!taxForm) return;

  const taxChecked = Boolean(taxForm.querySelector('[name="taxEnabled"]')?.checked);
  const serviceChecked = Boolean(taxForm.querySelector('[name="serviceEnabled"]')?.checked);

  const taxFields = taxForm.querySelector('[data-tax-fields]');
  const serviceFields = taxForm.querySelector('[data-service-fields]');

  if (taxFields) {
    taxFields.style.opacity = taxChecked ? '1' : '0.52';
    taxFields.querySelectorAll('input').forEach((inp) => {
      inp.disabled = !taxChecked;
    });
  }

  if (serviceFields) {
    serviceFields.style.opacity = serviceChecked ? '1' : '0.52';
    serviceFields.querySelectorAll('input').forEach((inp) => {
      inp.disabled = !serviceChecked;
    });
  }
}

function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleExportJson() {
  try {
    const jsonStr = store.exportAllData();
    const content = typeof jsonStr === 'string' ? jsonStr : JSON.stringify(jsonStr, null, 2);
    const dateKey = getLocalDateKey(new Date()) || 'export';
    const filename = `arupos-export-${dateKey}.json`;
    downloadBlob(content, 'application/json;charset=utf-8', filename);
    toast(t('settings.exportedToast', { filename }), 'success');
  } catch (err) {
    toast(err?.message || t('settings.exportFailedToast'), 'error');
  }
}

function handleExportCsvTransactions() {
  try {
    const csv = store.exportTransactionsCsv();
    const dateKey = getLocalDateKey(new Date()) || 'transaksi';
    const filename = `arupos-transaksi-${dateKey}.csv`;
    downloadBlob(csv, 'text/csv;charset=utf-8', filename);
    toast(t('settings.exportedToast', { filename }), 'success');
  } catch (err) {
    toast(err?.message || t('settings.exportFailedToast'), 'error');
  }
}

function handleExportCsvProducts() {
  try {
    const csv = store.exportProductsCsv();
    const dateKey = getLocalDateKey(new Date()) || 'produk';
    const filename = `arupos-produk-${dateKey}.csv`;
    downloadBlob(csv, 'text/csv;charset=utf-8', filename);
    toast(t('settings.exportedToast', { filename }), 'success');
  } catch (err) {
    toast(err?.message || t('settings.exportFailedToast'), 'error');
  }
}

async function handleSignOut() {
  const confirmed = await confirmDialog({
    title: t('auth.signOutConfirmTitle'),
    message: t('auth.signOutConfirmMsg'),
    confirmText: t('auth.signOutConfirmOk'),
    cancelText: t('common.cancel'),
    danger: false,
  });
  if (!confirmed) return;
  bus.emit('auth:signout-requested');
}

async function handleDeleteSampleData() {
  const counts = store.getDemoDataCounts();
  if (!counts || counts.total <= 0) return;

  const confirmed = await confirmDialog({
    title: t('settings.deleteSampleConfirmTitle'),
    message: t('settings.deleteSampleConfirmMsg', {
      products: counts.products,
      transactions: counts.transactions,
      categories: counts.categories,
    }),
    confirmText: t('settings.deleteSampleConfirmOk'),
    cancelText: t('common.cancel'),
    danger: true,
  });
  if (!confirmed) return;

  try {
    store.deleteSampleData();
    toast(t('settings.deleteSampleDoneToast'), 'success');
    updateDeleteSampleSection();
  } catch (err) {
    toast(err?.message || t('settings.exportFailedToast'), 'error');
  }
}

function renderCloudSyncBoxHtml(syncStatus) {
  const s = syncStatus || { state: 'idle', lastSyncedAt: null, errorCode: null };
  let boxClass = 'cloud-sync-box';
  let iconName = 'cloud';
  let statusText = t('cloud.connecting');

  if (s.state === 'synced') {
    boxClass += ' is-synced';
    iconName = 'cloud';
    statusText = t('cloud.synced');
  } else if (s.state === 'syncing') {
    boxClass += ' is-syncing';
    iconName = 'cloud';
    statusText = t('cloud.syncing');
  } else if (s.state === 'offline') {
    boxClass += ' is-offline';
    iconName = 'cloudOff';
    statusText = t('cloud.offline');
  } else if (s.state === 'error') {
    boxClass += ' is-error';
    iconName = 'warning';
    statusText = s.errorCode === 'permission-denied' ? t('cloud.rulesMissing') : t('cloud.error');
  }

  const timeHtml = s.lastSyncedAt
    ? `<span class="tabular-nums" style="font-size:0.74rem; opacity:0.86;">${escapeHtml(t('cloud.lastSynced', { time: formatDateTime(s.lastSyncedAt) }))}</span>`
    : '';

  return `
    <div class="${boxClass}" role="status">
      <span class="cloud-sync-icon">${icon(iconName)}</span>
      <div style="display:flex; flex-direction:column; gap:2px; min-width:0; flex:1;">
        <span style="font-weight:700; font-size:0.84rem;">${escapeHtml(statusText)}</span>
        ${timeHtml}
      </div>
    </div>
  `;
}

function updateCloudSyncBox() {
  if (!rootEl) return;
  const slot = rootEl.querySelector('[data-slot="cloud-sync-box"]');
  if (!slot) return;
  slot.innerHTML = renderCloudSyncBoxHtml(store.getSyncStatus());
}

function renderDeleteSampleHtml() {
  if (!store.hasDemoData()) return '';
  const counts = store.getDemoDataCounts();
  if (!counts || counts.total <= 0) return '';

  return `
    <div class="sample-cleanup-box">
      <div style="flex:1; min-width:160px;">
        <div style="font-weight:700; font-size:0.88rem; color:var(--danger);">${escapeHtml(t('settings.deleteSampleTitle'))}</div>
        <div class="settings-card-desc">${escapeHtml(t('settings.deleteSampleDesc', { products: counts.products, transactions: counts.transactions }))}</div>
      </div>
      <button type="button" class="btn btn--danger btn--sm" data-action="delete-sample">
        ${icon('trash')}
        <span>${escapeHtml(t('settings.deleteSampleBtn'))}</span>
      </button>
    </div>
  `;
}

function updateDeleteSampleSection() {
  if (!rootEl) return;
  const slot = rootEl.querySelector('[data-slot="delete-sample-wrap"]');
  if (!slot) return;
  slot.innerHTML = renderDeleteSampleHtml();
}

function getInitials(nameOrEmail) {
  const str = String(nameOrEmail || '').trim();
  if (!str) return 'A';
  const parts = str.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return str.slice(0, 2).toUpperCase();
}

function renderAccountAvatarHtml(user) {
  const photoUrl = String(user?.photoURL || '').trim();
  const displayName = user?.displayName || user?.email || 'AruPOS';
  const initials = escapeHtml(getInitials(displayName));

  if (/^https:\/\//i.test(photoUrl)) {
    return `
      <span class="account-avatar-wrap" data-avatar-wrap>
        <img
          src="${escapeHtml(photoUrl)}"
          alt="${escapeHtml(displayName)}"
          class="account-avatar"
          width="44"
          height="44"
          referrerpolicy="no-referrer"
          data-account-avatar-img
        />
        <span class="account-avatar account-avatar--fallback" hidden>${initials}</span>
      </span>
    `;
  }

  return `<span class="account-avatar account-avatar--fallback">${initials}</span>`;
}

function syncAppearanceCards(activeTheme = null, activeAccent = null) {
  if (!rootEl) return;
  if (activeTheme) {
    rootEl.querySelectorAll('.theme-card[data-select-theme]').forEach((card) => {
      const id = card.getAttribute('data-select-theme');
      const isSelected = id === activeTheme;
      card.classList.toggle('is-active', isSelected);
      card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      const checkSlot = card.querySelector('[data-theme-check]');
      if (checkSlot) {
        checkSlot.innerHTML = isSelected ? icon('checkCircle') : '';
      }
    });
  }
  if (activeAccent) {
    rootEl.querySelectorAll('.accent-card[data-select-accent]').forEach((card) => {
      const id = card.getAttribute('data-select-accent');
      const isSelected = id === activeAccent;
      card.classList.toggle('is-active', isSelected);
      card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      const checkSlot = card.querySelector('[data-accent-check]');
      if (checkSlot) {
        checkSlot.innerHTML = isSelected ? icon('checkCircle') : '';
      }
    });
  }
}

function handleContainerClick(e) {
  const target = e.target;
  if (!(target instanceof Element)) return;

  const signOutBtn = target.closest('[data-action="sign-out"]');
  if (signOutBtn && rootEl.contains(signOutBtn)) {
    handleSignOut();
    return;
  }

  const themeCard = target.closest('[data-select-theme]');
  if (themeCard && rootEl.contains(themeCard)) {
    const theme = themeCard.getAttribute('data-select-theme');
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      if (theme === getSettingsSafe().theme) return;
      writeThemePref(theme);
      skipNextSettingsRender = true;
      try {
        store.updateSettings({ theme });
      } finally {
        skipNextSettingsRender = false;
      }
      applyTheme(theme);
      syncAppearanceCards(theme, null);
    }
    return;
  }

  const accentCard = target.closest('[data-select-accent]');
  if (accentCard && rootEl.contains(accentCard)) {
    const accent = accentCard.getAttribute('data-select-accent');
    const preset = ACCENT_THEMES.find((item) => item.id === accent);
    if (preset) {
      if (preset.id === getSettingsSafe().accent) return;
      skipNextSettingsRender = true;
      try {
        store.updateSettings({ accent: preset.id });
      } finally {
        skipNextSettingsRender = false;
      }
      applyAccent(preset.id);
      syncAppearanceCards(null, preset.id);
    }
    return;
  }

  const langCard = target.closest('[data-select-language]');
  if (langCard && rootEl.contains(langCard)) {
    const language = langCard.getAttribute('data-select-language');
    const preset = LANGUAGES.find((item) => item.id === language);
    if (preset) {
      if (preset.id === getSettingsSafe().language) return;
      const prevScrollY = window.scrollY;
      skipNextSettingsRender = true;
      try {
        store.updateSettings({ language: preset.id });
      } finally {
        skipNextSettingsRender = false;
      }
      renderSettingsView();
      if (window.scrollY !== prevScrollY) {
        window.scrollTo({ top: prevScrollY, behavior: 'auto' });
      }
      animateLanguageSwitch([
        rootEl,
        document.querySelector('.store-title-wrap'),
        ...document.querySelectorAll('.nav-label'),
      ]);
    }
    return;
  }

  const exportJsonBtn = target.closest('[data-action="export-json"]');
  if (exportJsonBtn && rootEl.contains(exportJsonBtn)) {
    handleExportJson();
    return;
  }

  const exportCsvTxBtn = target.closest('[data-action="export-csv-tx"]');
  if (exportCsvTxBtn && rootEl.contains(exportCsvTxBtn)) {
    handleExportCsvTransactions();
    return;
  }

  const exportCsvProdBtn = target.closest('[data-action="export-csv-prod"]');
  if (exportCsvProdBtn && rootEl.contains(exportCsvProdBtn)) {
    handleExportCsvProducts();
    return;
  }

  const deleteSampleBtn = target.closest('[data-action="delete-sample"]');
  if (deleteSampleBtn && rootEl.contains(deleteSampleBtn)) {
    handleDeleteSampleData();
  }
}

function handleContainerInput(e) {
  const target = e.target;
  if (!(target instanceof Element)) return;
  if (target.closest('#settings-store-form') || target.closest('#settings-tax-form')) {
    updateLivePreview();
  }
}

function handleContainerChange(e) {
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.name === 'taxEnabled' || target.name === 'serviceEnabled') {
    syncTaxFieldStates();
    updateLivePreview();
  }
}

function handleContainerSubmit(e) {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.id === 'settings-store-form') {
    e.preventDefault();
    const storeNameInput = form.querySelector('[name="storeName"]');
    const storeName = String(storeNameInput?.value || '').trim();
    const storeAddress = String(form.querySelector('[name="storeAddress"]')?.value || '').trim();
    const storePhone = String(form.querySelector('[name="storePhone"]')?.value || '').trim();
    const receiptFooter = String(form.querySelector('[name="receiptFooter"]')?.value || '').trim();

    if (!storeName) {
      toast(t('settings.storeNameEmptyToast'), 'warning');
      if (storeNameInput) storeNameInput.focus();
      return;
    }

    store.updateSettings({
      storeName,
      storeAddress,
      storePhone,
      receiptFooter,
    });
    toast(t('settings.profileSavedToast'), 'success');
    updateLivePreview();
    return;
  }

  if (form.id === 'settings-tax-form') {
    e.preventDefault();
    const taxEnabled = Boolean(form.querySelector('[name="taxEnabled"]')?.checked);
    const taxLabel = String(form.querySelector('[name="taxLabel"]')?.value || '').trim() || 'PPN';
    const taxRate = clamp(Number(form.querySelector('[name="taxRate"]')?.value ?? 0), 0, 100);

    const serviceEnabled = Boolean(form.querySelector('[name="serviceEnabled"]')?.checked);
    const serviceLabel = String(form.querySelector('[name="serviceLabel"]')?.value || '').trim() || 'Service';
    const serviceRate = clamp(Number(form.querySelector('[name="serviceRate"]')?.value ?? 0), 0, 100);

    store.updateSettings({
      taxEnabled,
      taxLabel,
      taxRate,
      serviceEnabled,
      serviceLabel,
      serviceRate,
    });

    const taxRateInput = form.querySelector('[name="taxRate"]');
    const serviceRateInput = form.querySelector('[name="serviceRate"]');
    if (taxRateInput) taxRateInput.value = String(taxRate);
    if (serviceRateInput) serviceRateInput.value = String(serviceRate);

    toast(t('settings.taxSavedToast'), 'success');
    updateLivePreview();
  }
}

export function initSettingsView(container) {
  if (!container) return;

  if (rootEl && rootEl !== container) {
    rootEl.removeEventListener('click', handleContainerClick);
    rootEl.removeEventListener('input', handleContainerInput);
    rootEl.removeEventListener('change', handleContainerChange);
    rootEl.removeEventListener('submit', handleContainerSubmit);
  }

  for (const off of unsubs) {
    if (typeof off === 'function') off();
  }
  unsubs = [];

  rootEl = container;

  rootEl.removeEventListener('click', handleContainerClick);
  rootEl.removeEventListener('input', handleContainerInput);
  rootEl.removeEventListener('change', handleContainerChange);
  rootEl.removeEventListener('submit', handleContainerSubmit);

  rootEl.addEventListener('click', handleContainerClick);
  rootEl.addEventListener('input', handleContainerInput);
  rootEl.addEventListener('change', handleContainerChange);
  rootEl.addEventListener('submit', handleContainerSubmit);

  unsubs.push(
    bus.on('settings:changed', (nextSettings) => {
      if (skipNextSettingsRender) return;
      const keys = nextSettings?._changedKeys;
      if (
        Array.isArray(keys) &&
        keys.length > 0 &&
        keys.every((k) => k === 'theme' || k === 'accent' || k === 'productView')
      ) {
        if (keys.some((k) => k === 'theme' || k === 'accent')) {
          syncAppearanceCards(nextSettings.theme, nextSettings.accent);
        }
        return;
      }
      const active = document.activeElement;
      const isEditing =
        active &&
        rootEl &&
        rootEl.contains(active) &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (!isEditing) {
        renderSettingsView();
      }
    })
  );
  unsubs.push(
    bus.on('store:reset', () => {
      writeThemePref('');
      renderSettingsView();
    })
  );
  unsubs.push(bus.on('sync:changed', updateCloudSyncBox));
  unsubs.push(bus.on('products:changed', updateDeleteSampleSection));
  unsubs.push(bus.on('categories:changed', updateDeleteSampleSection));
  unsubs.push(bus.on('transactions:changed', updateDeleteSampleSection));

  renderSettingsView();
}

export function renderSettingsView() {
  if (!rootEl) return;

  const s = getSettingsSafe();
  const user = store.getCurrentUser();
  const syncStatus = store.getSyncStatus();
  const displayName = user?.displayName || user?.email || 'AruPOS';
  const email = user?.email || '';

  rootEl.innerHTML = `
    <div class="settings-view">
      <header class="view-header">
        <div>
          <h1 class="view-title">${escapeHtml(t('settings.title'))}</h1>
        </div>
      </header>

      <div class="settings-grid">
        <!-- Card 1: Akun & Sinkronisasi Cloud -->
        <section class="settings-section" style="grid-column: 1 / -1;" aria-labelledby="settings-account-title">
          <h2 id="settings-account-title" class="settings-section-title">
            ${escapeHtml(t('auth.accountSectionTitle'))}
          </h2>

          <div class="account-row">
            <div class="account-identity">
              ${renderAccountAvatarHtml(user)}
              <div class="account-meta">
                <div class="account-name">${escapeHtml(displayName)}</div>
                ${email ? `<div class="account-email">${escapeHtml(email)}</div>` : ''}
              </div>
            </div>
            <button type="button" class="btn btn--outlined btn--sm" data-action="sign-out">
              ${icon('logOut')}
              <span>${escapeHtml(t('auth.signOutBtn'))}</span>
            </button>
          </div>

          <div data-slot="cloud-sync-box">
            ${renderCloudSyncBoxHtml(syncStatus)}
          </div>

          <p class="settings-card-desc">${escapeHtml(t('cloud.autoBackupNote'))}</p>
        </section>

        <!-- Card 2: Tampilan, Aksen & Bahasa -->
        <section class="settings-section" style="grid-column: 1 / -1;" aria-labelledby="settings-theme-title">
          <h2 id="settings-theme-title" class="settings-section-title">
            ${escapeHtml(t('settings.appearanceTitle'))}
          </h2>

          <div class="theme-cards" role="radiogroup" aria-label="${escapeHtml(t('settings.themeGroupAria'))}">
            <button
              type="button"
              role="radio"
              class="theme-card${s.theme === 'light' ? ' is-active' : ''}"
              data-select-theme="light"
              aria-checked="${s.theme === 'light' ? 'true' : 'false'}"
            >
              <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                ${icon('sun')}
                <span data-theme-check class="settings-card-check">${s.theme === 'light' ? icon('checkCircle') : ''}</span>
              </div>
              <strong class="settings-card-label">${escapeHtml(t('theme.light.name'))}</strong>
            </button>

            <button
              type="button"
              role="radio"
              class="theme-card${s.theme === 'dark' ? ' is-active' : ''}"
              data-select-theme="dark"
              aria-checked="${s.theme === 'dark' ? 'true' : 'false'}"
            >
              <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                ${icon('moon')}
                <span data-theme-check class="settings-card-check">${s.theme === 'dark' ? icon('checkCircle') : ''}</span>
              </div>
              <strong class="settings-card-label">${escapeHtml(t('theme.dark.name'))}</strong>
            </button>

            <button
              type="button"
              role="radio"
              class="theme-card${s.theme === 'system' ? ' is-active' : ''}"
              data-select-theme="system"
              aria-checked="${s.theme === 'system' ? 'true' : 'false'}"
            >
              <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                ${icon('pos')}
                <span data-theme-check class="settings-card-check">${s.theme === 'system' ? icon('checkCircle') : ''}</span>
              </div>
              <strong class="settings-card-label">${escapeHtml(t('theme.system.name'))}</strong>
            </button>
          </div>

          <div class="accent-divider" aria-hidden="true"></div>

          <h3 class="settings-subsection-title">
            ${escapeHtml(t('settings.accentTitle'))}
          </h3>

          <div class="accent-cards" role="radiogroup" aria-label="${escapeHtml(t('settings.accentGroupAria'))}">
            ${ACCENT_THEMES.map((item) => {
              const isSelected = s.accent === item.id;
              return `
                <button
                  type="button"
                  role="radio"
                  class="accent-card${isSelected ? ' is-active' : ''}"
                  data-select-accent="${escapeHtml(item.id)}"
                  aria-checked="${isSelected ? 'true' : 'false'}"
                >
                  <span
                    class="accent-swatch"
                    aria-hidden="true"
                    style="background: linear-gradient(135deg, ${escapeHtml(item.swatchLight)} 50%, ${escapeHtml(item.swatchDark)} 50%);"
                  ></span>
                  <strong class="settings-card-label">${escapeHtml(t(item.nameKey))}</strong>
                  <span data-accent-check class="settings-card-check">${isSelected ? icon('checkCircle') : ''}</span>
                </button>
              `;
            }).join('')}
          </div>

          <div class="accent-divider" aria-hidden="true"></div>

          <h3 class="settings-subsection-title">
            ${escapeHtml(t('lang.title'))}
          </h3>

          <div class="lang-cards" role="radiogroup" aria-label="${escapeHtml(t('lang.aria'))}">
            ${LANGUAGES.map((item) => {
              const isSelected = s.language === item.id;
              return `
                <button
                  type="button"
                  role="radio"
                  class="lang-card${isSelected ? ' is-active' : ''}"
                  data-select-language="${escapeHtml(item.id)}"
                  aria-checked="${isSelected ? 'true' : 'false'}"
                >
                  <span class="lang-badge" aria-hidden="true">${escapeHtml(item.code)}</span>
                  <strong class="settings-card-label">${escapeHtml(item.nativeName)}</strong>
                  <span data-lang-check class="settings-card-check">${isSelected ? icon('checkCircle') : ''}</span>
                </button>
              `;
            }).join('')}
          </div>
        </section>

        <!-- Card 3: Profil Toko & Struk -->
        <section class="settings-section" style="grid-column: 1 / -1;" aria-labelledby="settings-profile-title">
          <h2 id="settings-profile-title" class="settings-section-title">
            ${escapeHtml(t('settings.profileTitle'))}
          </h2>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; align-items: start;">
            <form id="settings-store-form" novalidate>
              <div class="field">
                <label class="field-label" for="input-store-name">${escapeHtml(t('settings.storeNameLabel'))}</label>
                <input
                  id="input-store-name"
                  type="text"
                  name="storeName"
                  class="input"
                  maxlength="60"
                  required
                  placeholder="${escapeHtml(t('settings.storeNamePlaceholder'))}"
                  value="${escapeHtml(s.storeName)}"
                />
              </div>

              <div class="field">
                <label class="field-label" for="input-store-address">${escapeHtml(t('settings.storeAddressLabel'))}</label>
                <input
                  id="input-store-address"
                  type="text"
                  name="storeAddress"
                  class="input"
                  maxlength="160"
                  placeholder="${escapeHtml(t('settings.storeAddressPlaceholder'))}"
                  value="${escapeHtml(s.storeAddress)}"
                />
              </div>

              <div class="field">
                <label class="field-label" for="input-store-phone">${escapeHtml(t('settings.storePhoneLabel'))}</label>
                <input
                  id="input-store-phone"
                  type="tel"
                  name="storePhone"
                  class="input"
                  maxlength="30"
                  placeholder="${escapeHtml(t('settings.storePhonePlaceholder'))}"
                  value="${escapeHtml(s.storePhone)}"
                />
              </div>

              <div class="field">
                <label class="field-label" for="input-receipt-footer">${escapeHtml(t('settings.receiptFooterLabel'))}</label>
                <textarea
                  id="input-receipt-footer"
                  name="receiptFooter"
                  class="textarea"
                  rows="2"
                  maxlength="200"
                  placeholder="${escapeHtml(t('settings.receiptFooterPlaceholder'))}"
                >${escapeHtml(s.receiptFooter)}</textarea>
              </div>

              <div style="margin-top: 10px;">
                <button type="submit" class="btn btn--primary">
                  ${icon('check')}
                  <span>${escapeHtml(t('settings.saveProfileBtn'))}</span>
                </button>
              </div>
            </form>

            <div class="receipt-preview-mini">
              <div style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 8px; text-align: center;">
                ${escapeHtml(t('settings.sampleReceiptHeading'))}
              </div>
              <div data-mini-receipt-preview>
                ${buildSampleReceiptHtml(s)}
              </div>
            </div>
          </div>
        </section>

        <!-- Card 4: Pajak & Biaya Layanan -->
        <section class="settings-section" aria-labelledby="settings-tax-title">
          <h2 id="settings-tax-title" class="settings-section-title">
            ${escapeHtml(t('settings.taxTitle'))}
          </h2>

          <form id="settings-tax-form" novalidate style="display: flex; flex-direction: column; gap: 10px;">
            <div style="padding: 10px 12px; border-radius: var(--radius-md); background: var(--bg-surface-2); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 8px;">
              <label class="switch" for="toggle-tax-enabled">
                <input
                  id="toggle-tax-enabled"
                  type="checkbox"
                  name="taxEnabled"
                  class="switch-input"
                  ${s.taxEnabled ? 'checked' : ''}
                />
                <span class="switch-track"></span>
                <span style="font-weight: 700; font-size: 0.9rem;">${escapeHtml(t('settings.taxEnableLabel'))}</span>
              </label>

              <div class="field-row" data-tax-fields>
                <div class="field" style="margin-bottom: 0;">
                  <label class="field-label" for="input-tax-label">${escapeHtml(t('settings.taxLabelField'))}</label>
                  <input
                    id="input-tax-label"
                    type="text"
                    name="taxLabel"
                    class="input"
                    maxlength="24"
                    placeholder="PPN"
                    value="${escapeHtml(s.taxLabel)}"
                  />
                </div>
                <div class="field" style="margin-bottom: 0;">
                  <label class="field-label" for="input-tax-rate">${escapeHtml(t('settings.rateField'))}</label>
                  <input
                    id="input-tax-rate"
                    type="number"
                    name="taxRate"
                    class="input tabular-nums"
                    min="0"
                    max="100"
                    step="0.5"
                    value="${escapeHtml(String(s.taxRate))}"
                  />
                </div>
              </div>
            </div>

            <div style="padding: 10px 12px; border-radius: var(--radius-md); background: var(--bg-surface-2); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 8px;">
              <label class="switch" for="toggle-service-enabled">
                <input
                  id="toggle-service-enabled"
                  type="checkbox"
                  name="serviceEnabled"
                  class="switch-input"
                  ${s.serviceEnabled ? 'checked' : ''}
                />
                <span class="switch-track"></span>
                <span style="font-weight: 700; font-size: 0.9rem;">${escapeHtml(t('settings.serviceEnableLabel'))}</span>
              </label>

              <div class="field-row" data-service-fields>
                <div class="field" style="margin-bottom: 0;">
                  <label class="field-label" for="input-service-label">${escapeHtml(t('settings.serviceLabelField'))}</label>
                  <input
                    id="input-service-label"
                    type="text"
                    name="serviceLabel"
                    class="input"
                    maxlength="24"
                    placeholder="Service"
                    value="${escapeHtml(s.serviceLabel)}"
                  />
                </div>
                <div class="field" style="margin-bottom: 0;">
                  <label class="field-label" for="input-service-rate">${escapeHtml(t('settings.rateField'))}</label>
                  <input
                    id="input-service-rate"
                    type="number"
                    name="serviceRate"
                    class="input tabular-nums"
                    min="0"
                    max="100"
                    step="0.5"
                    value="${escapeHtml(String(s.serviceRate))}"
                  />
                </div>
              </div>
            </div>

            <div>
              <button type="submit" class="btn btn--primary">
                ${icon('check')}
                <span>${escapeHtml(t('settings.saveTaxBtn'))}</span>
              </button>
            </div>
          </form>
        </section>

        <!-- Card 5: Ekspor Data & Pembukuan -->
        <section class="settings-section" aria-labelledby="settings-export-title">
          <h2 id="settings-export-title" class="settings-section-title">
            ${escapeHtml(t('settings.exportSectionTitle'))}
          </h2>

          <p class="settings-card-desc">${escapeHtml(t('cloud.autoBackupNote'))}</p>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div class="export-row">
              <div style="flex: 1; min-width: 160px;">
                <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-primary);">${escapeHtml(t('settings.exportJsonTitle'))}</div>
                <div class="settings-card-desc">${escapeHtml(t('settings.exportJsonDesc'))}</div>
              </div>
              <button type="button" class="btn btn--outlined btn--sm" data-action="export-json">
                ${icon('download')}
                <span>${escapeHtml(t('settings.exportJsonBtn'))}</span>
              </button>
            </div>

            <div class="export-row">
              <div style="flex: 1; min-width: 160px;">
                <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-primary);">${escapeHtml(t('settings.exportCsvTxTitle'))}</div>
                <div class="settings-card-desc">${escapeHtml(t('settings.exportCsvTxDesc'))}</div>
              </div>
              <button type="button" class="btn btn--outlined btn--sm" data-action="export-csv-tx">
                ${icon('fileSpreadsheet')}
                <span>${escapeHtml(t('settings.exportCsvTxBtn'))}</span>
              </button>
            </div>

            <div class="export-row">
              <div style="flex: 1; min-width: 160px;">
                <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-primary);">${escapeHtml(t('settings.exportCsvProdTitle'))}</div>
                <div class="settings-card-desc">${escapeHtml(t('settings.exportCsvProdDesc'))}</div>
              </div>
              <button type="button" class="btn btn--outlined btn--sm" data-action="export-csv-prod">
                ${icon('fileSpreadsheet')}
                <span>${escapeHtml(t('settings.exportCsvProdBtn'))}</span>
              </button>
            </div>
          </div>

          <div data-slot="delete-sample-wrap">${renderDeleteSampleHtml()}</div>
        </section>
      </div>
    </div>
  `;

  const avatarImg = rootEl.querySelector('[data-account-avatar-img]');
  if (avatarImg) {
    avatarImg.addEventListener('error', () => {
      avatarImg.hidden = true;
      const fallback = avatarImg.parentElement?.querySelector('.account-avatar--fallback');
      if (fallback) fallback.hidden = false;
    });
  }

  syncTaxFieldStates();
}
