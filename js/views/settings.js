import {
  getLocalDateKey,
  escapeHtml,
  clamp,
  bus,
} from '../utils.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { renderReceiptHtml } from '../receipt.js';
import { applyTheme, applyAccent, ACCENT_THEMES, toast, confirmDialog, animateLanguageSwitch } from '../motion.js';
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
  const mode = s.mode === 'fnb' ? 'fnb' : 'retail';
  const theme = readThemePref(s.theme);
  const accent = VALID_ACCENTS.includes(s.accent) ? s.accent : 'emerald';
  const language = VALID_LANGUAGES.includes(s.language) ? s.language : 'id';

  return {
    mode,
    theme,
    accent,
    language,
    storeName: String(s.storeName ?? 'Kedai & Toko Aru'),
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
    mode: draft.mode,
    orderType: draft.mode === 'fnb' ? 'dine-in' : '',
    tableNumber: draft.mode === 'fnb' ? '05' : '',
    customerName: '',
    items: [
      {
        name: 'Kopi Susu Gula Aren',
        price: 25000,
        qty: 1,
        grossTotal: 25000,
        discountAmount: 0,
        netTotal: 25000,
        note: '',
      },
      {
        name: 'Croissant Butter',
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

function handleExportData() {
  try {
    const jsonStr = store.exportAllData();
    const content = typeof jsonStr === 'string' ? jsonStr : JSON.stringify(jsonStr, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const dateKey = getLocalDateKey(new Date()) || 'backup';
    const filename = `arupos-backup-${dateKey}.json`;

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('settings.exportedToast', { filename }), 'success');
  } catch (err) {
    toast(err?.message || t('settings.exportFailedToast'), 'error');
  }
}

async function handleImportFile(fileInput) {
  const file = fileInput?.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    try {
      JSON.parse(text);
    } catch {
      toast(t('settings.importInvalidJson'), 'error');
      return;
    }

    const confirmed = await confirmDialog({
      title: t('settings.importConfirmTitle'),
      message: t('settings.importConfirmMsg'),
      confirmText: t('settings.importConfirmOk'),
      cancelText: t('common.cancel'),
      danger: true,
    });

    if (!confirmed) return;

    const res = store.importAllData(text);
    if (res && typeof res === 'object' && res.ok === false) {
      toast(res.error || res.reason || t('settings.importBadStructure'), 'error');
      return;
    }

    writeThemePref('');
    const updated = getSettingsSafe();
    applyTheme(updated.theme);
    applyAccent(updated.accent);
    toast(t('settings.importSuccessToast'), 'success');
    renderSettingsView();
  } catch (err) {
    toast(err?.message || t('settings.importFailedToast'), 'error');
  } finally {
    if (fileInput) fileInput.value = '';
  }
}

async function handleResetDemo() {
  const confirmed = await confirmDialog({
    title: t('settings.resetConfirmTitle'),
    message: t('settings.resetConfirmMsg'),
    confirmText: t('settings.resetConfirmOk'),
    cancelText: t('common.cancel'),
    danger: true,
  });

  if (!confirmed) return;

  try {
    store.resetDemoData();
    writeThemePref('');
    const updated = getSettingsSafe();
    applyTheme(updated.theme);
    applyAccent(updated.accent);
    toast(t('settings.resetSuccessToast'), 'success');
    renderSettingsView();
  } catch (err) {
    toast(err?.message || t('settings.resetFailedToast'), 'error');
  }
}

function syncAppearanceCards(activeTheme = null, activeAccent = null) {
  if (!rootEl) return;
  if (activeTheme) {
    const iconByTheme = { light: 'sun', dark: 'moon', system: 'pos' };
    rootEl.querySelectorAll('.theme-card[data-select-theme]').forEach((card) => {
      const id = card.getAttribute('data-select-theme');
      const isSelected = id === activeTheme;
      card.classList.toggle('is-active', isSelected);
      card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      const topRow = card.firstElementChild;
      if (topRow) {
        topRow.innerHTML = `${icon(iconByTheme[id] || 'pos')}${isSelected ? icon('checkCircle') : ''}`;
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

  const modeCard = target.closest('[data-select-mode]');
  if (modeCard && rootEl.contains(modeCard)) {
    const mode = modeCard.getAttribute('data-select-mode');
    if (mode === 'retail' || mode === 'fnb') {
      store.updateSettings({ mode });
      const label = mode === 'fnb' ? t('settings.modeFnbName') : t('settings.modeRetailName');
      toast(t('settings.modeChangedToast', { label }), 'success');
      renderSettingsView();
    }
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
        document.querySelector('#topbar-mode-pill .mode-pill-text'),
        ...document.querySelectorAll('.nav-label'),
      ]);
    }
    return;
  }

  const exportBtn = target.closest('[data-action="export-data"]');
  if (exportBtn && rootEl.contains(exportBtn)) {
    handleExportData();
    return;
  }

  const importBtn = target.closest('[data-action="trigger-import"]');
  if (importBtn && rootEl.contains(importBtn)) {
    const fileInput = rootEl.querySelector('#settings-import-file');
    if (fileInput) fileInput.click();
    return;
  }

  const resetBtn = target.closest('[data-action="reset-demo"]');
  if (resetBtn && rootEl.contains(resetBtn)) {
    handleResetDemo();
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

  if (target.id === 'settings-import-file') {
    handleImportFile(target);
    return;
  }

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
      if (Array.isArray(keys) && keys.length > 0 && keys.every((k) => k === 'theme' || k === 'accent')) {
        syncAppearanceCards(nextSettings.theme, nextSettings.accent);
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

  renderSettingsView();
}

export function renderSettingsView() {
  if (!rootEl) return;

  const s = getSettingsSafe();

  rootEl.innerHTML = `
    <div class="settings-view">
      <header class="view-header">
        <div>
          <h1 class="view-title">${escapeHtml(t('settings.title'))}</h1>
          <p class="view-subtitle">${escapeHtml(t('settings.subtitle'))}</p>
        </div>
      </header>

      <div class="settings-grid">
        <!-- Card 1: Mode Operasional Kasir -->
        <section class="settings-section" style="grid-column: 1 / -1;" aria-labelledby="settings-mode-title">
          <div>
            <h2 id="settings-mode-title" style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--text-primary);">
              ${escapeHtml(t('settings.modeTitle'))}
            </h2>
            <p style="margin: 3px 0 0; font-size: 0.84rem; color: var(--text-muted);">
              ${escapeHtml(t('settings.modeSubtitle'))}
            </p>
          </div>

          <div class="mode-cards" role="radiogroup" aria-label="${escapeHtml(t('settings.modeGroupAria'))}">
            <button
              type="button"
              role="radio"
              class="mode-card${s.mode === 'retail' ? ' is-active' : ''}"
              data-select-mode="retail"
              aria-checked="${s.mode === 'retail' ? 'true' : 'false'}"
            >
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; width: 100%; gap: 8px;">
                <span style="display: inline-flex; align-items: center; gap: 8px; font-weight: 800; font-size: 0.96rem;">
                  ${icon('bag')}
                  <span>${escapeHtml(t('settings.modeRetailName'))}</span>
                </span>
                ${s.mode === 'retail' ? `<span class="badge badge--primary">${icon('check')} ${escapeHtml(t('common.active'))}</span>` : ''}
              </div>
              <p style="margin: 2px 0 0; font-size: 0.82rem; line-height: 1.45; opacity: 0.88;">
                ${escapeHtml(t('settings.modeRetailDesc'))}
              </p>
            </button>

            <button
              type="button"
              role="radio"
              class="mode-card${s.mode === 'fnb' ? ' is-active' : ''}"
              data-select-mode="fnb"
              aria-checked="${s.mode === 'fnb' ? 'true' : 'false'}"
            >
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; width: 100%; gap: 8px;">
                <span style="display: inline-flex; align-items: center; gap: 8px; font-weight: 800; font-size: 0.96rem;">
                  ${icon('utensils')}
                  <span>${escapeHtml(t('settings.modeFnbName'))}</span>
                </span>
                ${s.mode === 'fnb' ? `<span class="badge badge--primary">${icon('check')} ${escapeHtml(t('common.active'))}</span>` : ''}
              </div>
              <p style="margin: 2px 0 0; font-size: 0.82rem; line-height: 1.45; opacity: 0.88;">
                ${escapeHtml(t('settings.modeFnbDesc'))}
              </p>
            </button>
          </div>
        </section>

        <!-- Card 2: Tampilan, Aksen & Bahasa -->
        <section class="settings-section" style="grid-column: 1 / -1;" aria-labelledby="settings-theme-title">
          <div>
            <h2 id="settings-theme-title" style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--text-primary);">
              ${escapeHtml(t('settings.appearanceTitle'))}
            </h2>
            <p style="margin: 3px 0 0; font-size: 0.84rem; color: var(--text-muted);">
              ${escapeHtml(t('settings.appearanceSubtitle'))}
            </p>
          </div>

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
                ${s.theme === 'light' ? icon('checkCircle') : ''}
              </div>
              <strong style="font-size: 0.92rem;">${escapeHtml(t('theme.light.name'))}</strong>
              <span style="font-size: 0.78rem; opacity: 0.82;">${escapeHtml(t('theme.light.desc'))}</span>
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
                ${s.theme === 'dark' ? icon('checkCircle') : ''}
              </div>
              <strong style="font-size: 0.92rem;">${escapeHtml(t('theme.dark.name'))}</strong>
              <span style="font-size: 0.78rem; opacity: 0.82;">${escapeHtml(t('theme.dark.desc'))}</span>
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
                ${s.theme === 'system' ? icon('checkCircle') : ''}
              </div>
              <strong style="font-size: 0.92rem;">${escapeHtml(t('theme.system.name'))}</strong>
              <span style="font-size: 0.78rem; opacity: 0.82;">${escapeHtml(t('theme.system.desc'))}</span>
            </button>
          </div>

          <div class="accent-divider" aria-hidden="true"></div>

          <div>
            <h3 style="margin: 0; font-size: 0.95rem; font-weight: 800; color: var(--text-primary);">
              ${escapeHtml(t('settings.accentTitle'))}
            </h3>
            <p style="margin: 2px 0 0; font-size: 0.82rem; color: var(--text-muted);">
              ${escapeHtml(t('settings.accentSubtitle'))}
            </p>
          </div>

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
                  <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                    <span
                      class="accent-swatch"
                      aria-hidden="true"
                      style="background: linear-gradient(135deg, ${escapeHtml(item.swatchLight)} 50%, ${escapeHtml(item.swatchDark)} 50%);"
                    ></span>
                    <span data-accent-check style="display: inline-flex;">${isSelected ? icon('checkCircle') : ''}</span>
                  </div>
                  <strong style="font-size: 0.9rem;">${escapeHtml(t(item.nameKey))}</strong>
                  <span style="font-size: 0.76rem; opacity: 0.82; line-height: 1.35;">${escapeHtml(t(item.descKey))}</span>
                </button>
              `;
            }).join('')}
          </div>

          <div class="accent-divider" aria-hidden="true"></div>

          <div>
            <h3 style="margin: 0; font-size: 0.95rem; font-weight: 800; color: var(--text-primary);">
              ${escapeHtml(t('lang.title'))}
            </h3>
            <p style="margin: 2px 0 0; font-size: 0.82rem; color: var(--text-muted);">
              ${escapeHtml(t('lang.subtitle'))}
            </p>
          </div>

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
                  <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                    <span class="lang-badge" aria-hidden="true">${escapeHtml(item.code)}</span>
                    <span data-lang-check style="display: inline-flex;">${isSelected ? icon('checkCircle') : ''}</span>
                  </div>
                  <strong style="font-size: 0.9rem;">${escapeHtml(item.nativeName)}</strong>
                  <span style="font-size: 0.76rem; opacity: 0.82; line-height: 1.35;">${escapeHtml(t(item.descKey))}</span>
                </button>
              `;
            }).join('')}
          </div>
        </section>

        <!-- Card 3: Profil Toko & Struk -->
        <section class="settings-section" style="grid-column: 1 / -1;" aria-labelledby="settings-profile-title">
          <div>
            <h2 id="settings-profile-title" style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--text-primary);">
              ${escapeHtml(t('settings.profileTitle'))}
            </h2>
            <p style="margin: 3px 0 0; font-size: 0.84rem; color: var(--text-muted);">
              ${escapeHtml(t('settings.profileSubtitle'))}
            </p>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; align-items: start;">
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
                  rows="3"
                  maxlength="200"
                  placeholder="${escapeHtml(t('settings.receiptFooterPlaceholder'))}"
                >${escapeHtml(s.receiptFooter)}</textarea>
              </div>

              <div style="margin-top: 14px;">
                <button type="submit" class="btn btn--primary">
                  ${icon('check')}
                  <span>${escapeHtml(t('settings.saveProfileBtn'))}</span>
                </button>
              </div>
            </form>

            <div class="receipt-preview-mini">
              <div style="font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 10px; text-align: center;">
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
          <div>
            <h2 id="settings-tax-title" style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--text-primary);">
              ${escapeHtml(t('settings.taxTitle'))}
            </h2>
            <p style="margin: 3px 0 0; font-size: 0.84rem; color: var(--text-muted);">
              ${escapeHtml(t('settings.taxSubtitle'))}
            </p>
          </div>

          <form id="settings-tax-form" novalidate style="display: flex; flex-direction: column; gap: 16px;">
            <div style="padding: 12px 14px; border-radius: var(--radius-md); background: var(--bg-surface-2); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 10px;">
              <label class="switch" for="toggle-tax-enabled">
                <input
                  id="toggle-tax-enabled"
                  type="checkbox"
                  name="taxEnabled"
                  class="switch-input"
                  ${s.taxEnabled ? 'checked' : ''}
                />
                <span class="switch-track"></span>
                <span style="font-weight: 700; font-size: 0.92rem;">${escapeHtml(t('settings.taxEnableLabel'))}</span>
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

            <div style="padding: 12px 14px; border-radius: var(--radius-md); background: var(--bg-surface-2); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 10px;">
              <label class="switch" for="toggle-service-enabled">
                <input
                  id="toggle-service-enabled"
                  type="checkbox"
                  name="serviceEnabled"
                  class="switch-input"
                  ${s.serviceEnabled ? 'checked' : ''}
                />
                <span class="switch-track"></span>
                <span style="font-weight: 700; font-size: 0.92rem;">${escapeHtml(t('settings.serviceEnableLabel'))}</span>
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

        <!-- Card 5: Cadangan & Data Lokal -->
        <section class="settings-section danger-zone" aria-labelledby="settings-backup-title">
          <div>
            <h2 id="settings-backup-title" style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--text-primary);">
              ${escapeHtml(t('settings.backupTitle'))}
            </h2>
            <p style="margin: 3px 0 0; font-size: 0.84rem; color: var(--text-secondary);">
              ${escapeHtml(t('settings.backupSubtitle'))}
            </p>
          </div>

          <div style="display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px; border-radius: var(--radius-md); background: var(--bg-surface); border: 1px solid var(--border-subtle);">
              <div style="flex: 1; min-width: 180px;">
                <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-primary);">${escapeHtml(t('settings.exportTitle'))}</div>
                <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(t('settings.exportDesc'))}</div>
              </div>
              <button type="button" class="btn btn--outlined" data-action="export-data">
                ${icon('download')}
                <span>${escapeHtml(t('settings.exportBtn'))}</span>
              </button>
            </div>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px; border-radius: var(--radius-md); background: var(--bg-surface); border: 1px solid var(--border-subtle);">
              <div style="flex: 1; min-width: 180px;">
                <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-primary);">${escapeHtml(t('settings.importTitle'))}</div>
                <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(t('settings.importDesc'))}</div>
              </div>
              <input id="settings-import-file" type="file" accept="application/json,.json" hidden />
              <button type="button" class="btn btn--outlined" data-action="trigger-import">
                ${icon('upload')}
                <span>${escapeHtml(t('settings.importBtn'))}</span>
              </button>
            </div>

            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px; border-radius: var(--radius-md); background: var(--bg-surface); border: 1px solid rgba(185, 28, 28, 0.30);">
              <div style="flex: 1; min-width: 180px;">
                <div style="font-weight: 700; font-size: 0.9rem; color: var(--danger);">${escapeHtml(t('settings.resetTitle'))}</div>
                <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(t('settings.resetDesc'))}</div>
              </div>
              <button type="button" class="btn btn--danger" data-action="reset-demo">
                ${icon('refresh')}
                <span>${escapeHtml(t('settings.resetBtn'))}</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

  syncTaxFieldStates();
}
