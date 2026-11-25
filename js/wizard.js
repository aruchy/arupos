import { escapeHtml } from './utils.js';
import { icon } from './icons.js';
import { t, getLanguage } from './i18n.js';
import { prefersReducedMotion, applyAccent } from './motion.js';

let wizardState = {
  step: 0,
  storeName: '',
  storeAddress: '',
  storePhone: '',
  receiptFooter: '',
  importLocal: false,
  isSubmitting: false,
  nameError: '',
  submitError: '',
  user: null,
  localMigrationCandidate: null,
  onComplete: null,
  onSignOut: null,
  onToggleTheme: null,
  onToggleLang: null,
};

function getWizardHost() {
  return document.getElementById('setup-wizard');
}

function getStepsConfig() {
  if (wizardState.localMigrationCandidate) {
    return [
      { id: 'profile', label: t('wizard.stepProfile') },
      { id: 'import', label: t('wizard.stepImport') },
      { id: 'ready', label: t('wizard.stepReady') },
    ];
  }
  return [
    { id: 'profile', label: t('wizard.stepProfile') },
    { id: 'ready', label: t('wizard.stepReady') },
  ];
}

function animateStepPanel(host) {
  if (!host || prefersReducedMotion()) return;
  const panel = host.querySelector('.wizard-step-body');
  if (panel && typeof panel.animate === 'function') {
    panel.animate(
      [
        { opacity: 0, transform: 'translate3d(10px, 0, 0)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      ],
      { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
  }
}

function syncDraftInputsFromDom(host) {
  if (!host) return;
  const nameInp = host.querySelector('#wizard-store-name');
  const addrInp = host.querySelector('#wizard-store-addr');
  const phoneInp = host.querySelector('#wizard-store-phone');
  const footerInp = host.querySelector('#wizard-receipt-footer');
  if (nameInp) wizardState.storeName = nameInp.value;
  if (addrInp) wizardState.storeAddress = addrInp.value;
  if (phoneInp) wizardState.storePhone = phoneInp.value;
  if (footerInp) wizardState.receiptFooter = footerInp.value;
}

export function renderSetupWizard() {
  const host = getWizardHost();
  if (!host || host.hidden) return;

  const steps = getStepsConfig();
  const clampedIdx = Math.min(wizardState.step, steps.length - 1);
  wizardState.step = clampedIdx;
  const currentStepId = steps[clampedIdx].id;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const lang = getLanguage();
  const candidate = wizardState.localMigrationCandidate;

  host.setAttribute('aria-label', t('wizard.ariaLabel'));

  const stepperHtml = steps
    .map((st, idx) => {
      const done = idx < clampedIdx;
      const active = idx === clampedIdx;
      return `
        <div class="wizard-step-dot${active ? ' is-active' : ''}${done ? ' is-done' : ''}">
          <span class="wizard-step-num">${done ? icon('check') : idx + 1}</span>
          <span class="wizard-step-label">${escapeHtml(st.label)}</span>
        </div>
      `;
    })
    .join('');

  let stepBodyHtml = '';

  if (currentStepId === 'profile') {
    stepBodyHtml = `
      <div class="wizard-step-body">
        <div class="wizard-heading-wrap">
          <h2 class="wizard-title">${escapeHtml(t('wizard.profileTitle'))}</h2>
          <p class="wizard-subtitle">${escapeHtml(t('wizard.profileSubtitle'))}</p>
        </div>

        <form id="wizard-profile-form" class="wizard-form" novalidate>
          <div class="field">
            <label class="field-label" for="wizard-store-name">${escapeHtml(t('wizard.storeNameLabel'))}</label>
            <input
              id="wizard-store-name"
              name="storeName"
              type="text"
              class="input"
              maxlength="60"
              required
              placeholder="${escapeHtml(t('wizard.storeNamePlaceholder'))}"
              value="${escapeHtml(wizardState.storeName)}"
            />
            ${wizardState.nameError ? `<div class="products-inline-error" role="alert">${escapeHtml(wizardState.nameError)}</div>` : ''}
          </div>

          <div class="field">
            <label class="field-label" for="wizard-store-addr">${escapeHtml(t('settings.storeAddressLabel'))}</label>
            <input
              id="wizard-store-addr"
              name="storeAddress"
              type="text"
              class="input"
              maxlength="160"
              placeholder="${escapeHtml(t('settings.storeAddressPlaceholder'))}"
              value="${escapeHtml(wizardState.storeAddress)}"
            />
          </div>

          <div class="field">
            <label class="field-label" for="wizard-store-phone">${escapeHtml(t('settings.storePhoneLabel'))}</label>
            <input
              id="wizard-store-phone"
              name="storePhone"
              type="tel"
              class="input"
              maxlength="30"
              placeholder="${escapeHtml(t('settings.storePhonePlaceholder'))}"
              value="${escapeHtml(wizardState.storePhone)}"
            />
          </div>

          <div class="field">
            <label class="field-label" for="wizard-receipt-footer">${escapeHtml(t('settings.receiptFooterLabel'))}</label>
            <input
              id="wizard-receipt-footer"
              name="receiptFooter"
              type="text"
              class="input"
              maxlength="200"
              placeholder="${escapeHtml(t('settings.receiptFooterPlaceholder'))}"
              value="${escapeHtml(wizardState.receiptFooter)}"
            />
          </div>

          <div class="wizard-actions">
            <button type="submit" class="btn btn--primary btn--block" data-wizard-next>
              <span>${escapeHtml(t('wizard.nextBtn'))}</span>
              ${icon('chevronRight')}
            </button>
          </div>
        </form>
      </div>
    `;
  } else if (currentStepId === 'import' && candidate) {
    const counts = candidate.counts || { products: 0, categories: 0, transactions: 0 };
    stepBodyHtml = `
      <div class="wizard-step-body">
        <div class="wizard-heading-wrap">
          <h2 class="wizard-title">${escapeHtml(t('wizard.importTitle'))}</h2>
          <p class="wizard-subtitle">${escapeHtml(t('wizard.importSubtitle'))}</p>
        </div>

        <div class="wizard-choice-list" role="radiogroup" aria-label="${escapeHtml(t('wizard.importGroupAria'))}">
          <button
            type="button"
            role="radio"
            class="wizard-choice-card${wizardState.importLocal ? ' is-selected' : ''}"
            data-wizard-choice="import"
            aria-checked="${wizardState.importLocal ? 'true' : 'false'}"
          >
            <span class="wizard-choice-icon">${icon('cloud')}</span>
            <div style="flex:1; min-width:0; text-align:left;">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <strong>${escapeHtml(t('wizard.optionImportTitle'))}</strong>
                <span class="badge badge--primary">${escapeHtml(t('wizard.recommendedBadge'))}</span>
              </div>
              <p class="settings-card-desc" style="margin-top:4px;">
                ${escapeHtml(t('wizard.optionImportDesc', counts))}
              </p>
            </div>
            <span class="settings-card-check">${wizardState.importLocal ? icon('checkCircle') : ''}</span>
          </button>

          <button
            type="button"
            role="radio"
            class="wizard-choice-card${!wizardState.importLocal ? ' is-selected' : ''}"
            data-wizard-choice="empty"
            aria-checked="${!wizardState.importLocal ? 'true' : 'false'}"
          >
            <span class="wizard-choice-icon">${icon('products')}</span>
            <div style="flex:1; min-width:0; text-align:left;">
              <strong>${escapeHtml(t('wizard.optionEmptyTitle'))}</strong>
              <p class="settings-card-desc" style="margin-top:4px;">
                ${escapeHtml(t('wizard.optionEmptyDesc'))}
              </p>
            </div>
            <span class="settings-card-check">${!wizardState.importLocal ? icon('checkCircle') : ''}</span>
          </button>
        </div>

        <div class="wizard-actions wizard-actions--split">
          <button type="button" class="btn btn--outlined" data-wizard-back>
            ${escapeHtml(t('common.back'))}
          </button>
          <button type="button" class="btn btn--primary" style="flex:1;" data-wizard-next>
            <span>${escapeHtml(t('wizard.nextBtn'))}</span>
            ${icon('chevronRight')}
          </button>
        </div>
      </div>
    `;
  } else {
    const cleanName = wizardState.storeName.trim() || '-';
    const willImport = Boolean(candidate && wizardState.importLocal);
    const dataSummary = willImport
      ? t('wizard.summaryImport', candidate.counts)
      : t('wizard.summaryEmpty');

    stepBodyHtml = `
      <div class="wizard-step-body">
        <div class="wizard-heading-wrap">
          <h2 class="wizard-title">${escapeHtml(t('wizard.readyTitle'))}</h2>
          <p class="wizard-subtitle">${escapeHtml(t('wizard.readySubtitle'))}</p>
        </div>

        <div class="wizard-summary-box">
          <div class="wizard-summary-row">
            <span>${escapeHtml(t('wizard.summaryAccount'))}</span>
            <strong>${escapeHtml(wizardState.user?.email || wizardState.user?.displayName || '-')}</strong>
          </div>
          <div class="wizard-summary-row">
            <span>${escapeHtml(t('settings.storeNameLabel'))}</span>
            <strong>${escapeHtml(cleanName)}</strong>
          </div>
          ${
            wizardState.storeAddress.trim()
              ? `<div class="wizard-summary-row">
                  <span>${escapeHtml(t('settings.storeAddressLabel'))}</span>
                  <strong>${escapeHtml(wizardState.storeAddress.trim())}</strong>
                </div>`
              : ''
          }
          ${
            wizardState.storePhone.trim()
              ? `<div class="wizard-summary-row">
                  <span>${escapeHtml(t('settings.storePhoneLabel'))}</span>
                  <strong>${escapeHtml(wizardState.storePhone.trim())}</strong>
                </div>`
              : ''
          }
          <div class="wizard-summary-row">
            <span>${escapeHtml(t('wizard.summaryInitialData'))}</span>
            <strong>${escapeHtml(dataSummary)}</strong>
          </div>
        </div>

        ${
          wizardState.submitError
            ? `<div class="auth-error-box" role="alert" style="margin-bottom:12px;">${escapeHtml(wizardState.submitError)}</div>`
            : ''
        }

        <div class="wizard-actions wizard-actions--split">
          <button type="button" class="btn btn--outlined" data-wizard-back ${wizardState.isSubmitting ? 'disabled' : ''}>
            ${escapeHtml(t('common.back'))}
          </button>
          <button type="button" class="btn btn--primary" style="flex:1;" data-wizard-finish ${wizardState.isSubmitting ? 'disabled' : ''}>
            ${icon('check')}
            <span>${escapeHtml(wizardState.isSubmitting ? t('wizard.savingBtn') : t('wizard.finishBtn'))}</span>
          </button>
        </div>
      </div>
    `;
  }

  host.innerHTML = `
    <div class="auth-topbar">
      <button type="button" class="chip" data-wizard-lang style="min-height:38px; padding:0 12px;">
        <span>${lang === 'id' ? 'ID' : 'EN'}</span>
      </button>
      <button
        type="button"
        class="icon-btn"
        data-wizard-theme
        aria-label="${escapeHtml(isDark ? t('app.themeToggleLightAria') : t('app.themeToggleDarkAria'))}"
        title="${escapeHtml(isDark ? t('app.themeToggleLightTitle') : t('app.themeToggleDarkTitle'))}"
      >
        ${icon(isDark ? 'sun' : 'moon')}
      </button>
      <button type="button" class="btn btn--ghost btn--sm" data-wizard-signout>
        ${icon('logOut')}
        <span>${escapeHtml(t('auth.signOutBtn'))}</span>
      </button>
    </div>

    <div class="auth-card wizard-card">
      <div class="auth-brand" style="margin-bottom:14px;">
        <img src="./assets/icon.svg" alt="${escapeHtml(t('app.logoAlt'))}" class="brand-logo" width="44" height="44" />
        <div>
          <div class="auth-brand-title">${escapeHtml(t('wizard.headerTitle'))}</div>
          <div class="auth-brand-sub">${escapeHtml(t('wizard.headerSub'))}</div>
        </div>
      </div>

      <div class="wizard-stepper" aria-label="${escapeHtml(t('wizard.stepperAria'))}">
        ${stepperHtml}
      </div>

      ${stepBodyHtml}
    </div>
  `;

  applyAccent(document.documentElement.getAttribute('data-accent') || 'emerald');
  animateStepPanel(host);

  host.querySelector('[data-wizard-theme]')?.addEventListener('click', () => {
    syncDraftInputsFromDom(host);
    if (typeof wizardState.onToggleTheme === 'function') {
      wizardState.onToggleTheme();
      renderSetupWizard();
    }
  });

  host.querySelector('[data-wizard-lang]')?.addEventListener('click', () => {
    syncDraftInputsFromDom(host);
    if (typeof wizardState.onToggleLang === 'function') {
      wizardState.onToggleLang();
      renderSetupWizard();
    }
  });

  host.querySelector('[data-wizard-signout]')?.addEventListener('click', () => {
    if (typeof wizardState.onSignOut === 'function') {
      wizardState.onSignOut();
    }
  });

  const profileForm = host.querySelector('#wizard-profile-form');
  if (profileForm) {
    profileForm.addEventListener('submit', (e) => {
      e.preventDefault();
      syncDraftInputsFromDom(host);
      if (!wizardState.storeName.trim()) {
        wizardState.nameError = t('wizard.errStoreNameRequired');
        renderSetupWizard();
        host.querySelector('#wizard-store-name')?.focus();
        return;
      }
      wizardState.nameError = '';
      wizardState.step = Math.min(steps.length - 1, wizardState.step + 1);
      renderSetupWizard();
    });
  }

  host.querySelectorAll('[data-wizard-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      wizardState.importLocal = btn.dataset.wizardChoice === 'import';
      renderSetupWizard();
    });
  });

  host.querySelector('[data-wizard-back]')?.addEventListener('click', () => {
    syncDraftInputsFromDom(host);
    wizardState.submitError = '';
    wizardState.step = Math.max(0, wizardState.step - 1);
    renderSetupWizard();
  });

  host.querySelector('[data-wizard-next]')?.addEventListener('click', (e) => {
    if (profileForm) return; // handled by form submit
    wizardState.step = Math.min(steps.length - 1, wizardState.step + 1);
    renderSetupWizard();
  });

  host.querySelector('[data-wizard-finish]')?.addEventListener('click', async () => {
    if (wizardState.isSubmitting) return;
    wizardState.isSubmitting = true;
    wizardState.submitError = '';
    renderSetupWizard();
    try {
      if (typeof wizardState.onComplete === 'function') {
        await wizardState.onComplete({
          storeName: wizardState.storeName.trim(),
          storeAddress: wizardState.storeAddress.trim(),
          storePhone: wizardState.storePhone.trim(),
          receiptFooter: wizardState.receiptFooter.trim(),
          importLocal: Boolean(candidate && wizardState.importLocal),
        });
      }
    } catch (err) {
      wizardState.isSubmitting = false;
      wizardState.submitError = err?.message || t('wizard.saveError');
      renderSetupWizard();
    }
  });
}

export function showSetupWizard({
  user,
  localMigrationCandidate = null,
  profileSuggestion = null,
  onComplete,
  onSignOut,
  onToggleTheme,
  onToggleLang,
} = {}) {
  const host = getWizardHost();
  if (!host) return;

  wizardState = {
    step: 0,
    storeName: String(profileSuggestion?.storeName || ''),
    storeAddress: String(profileSuggestion?.storeAddress || ''),
    storePhone: String(profileSuggestion?.storePhone || ''),
    receiptFooter: String(profileSuggestion?.receiptFooter || ''),
    importLocal: Boolean(localMigrationCandidate),
    isSubmitting: false,
    nameError: '',
    submitError: '',
    user: user || null,
    localMigrationCandidate,
    onComplete,
    onSignOut,
    onToggleTheme,
    onToggleLang,
  };

  host.hidden = false;
  renderSetupWizard();
}

export function hideSetupWizard() {
  const host = getWizardHost();
  if (!host) return;
  host.hidden = true;
  host.innerHTML = '';
}
