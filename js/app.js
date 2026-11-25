import { bus, escapeHtml } from './utils.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { cart } from './cart.js';
import { setLanguage, getLanguage, t } from './i18n.js';
import {
  subscribeAuth,
  signInWithGoogle,
  resolveRedirectLogin,
  signOutUser,
  createFirestoreAdapter,
} from './firebase.js';
import { showSetupWizard, hideSetupWizard, renderSetupWizard } from './wizard.js';
import {
  initMotion,
  applyTheme,
  applyAccent,
  transitionView,
  popElement,
  prefersReducedMotion,
  closeAllSheets,
  toast,
} from './motion.js';
import { initPosView, renderPosView } from './views/pos.js';
import { initProductsView, renderProductsView } from './views/products.js';
import { initHistoryView, renderHistoryView } from './views/history.js';
import { initReportsView, renderReportsView } from './views/reports.js';
import { initSettingsView, renderSettingsView } from './views/settings.js';

const VIEW_ORDER = ['pos', 'products', 'history', 'reports', 'settings'];

const VIEW_HANDLERS = {
  pos: { init: initPosView, render: renderPosView },
  products: { init: initProductsView, render: renderProductsView },
  history: { init: initHistoryView, render: renderHistoryView },
  reports: { init: initReportsView, render: renderReportsView },
  settings: { init: initSettingsView, render: renderSettingsView },
};

const VALID_ACCENTS = ['emerald', 'amber', 'burgundy', 'sapphire'];

let activeView = 'pos';
let viewsInitialized = false;
let shellListenersBound = false;
let isFirebaseAuthSession = false;
let sessionGeneration = 0;

const authUiState = {
  busy: true,
  busyMessageKey: 'auth.checkingSession',
  errorMessage: '',
};

const GOOGLE_G_SVG = `
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.25-.97 2.31-2.06 3.02l3.33 2.58c1.94-1.79 3.06-4.43 3.06-7.54 0-.73-.07-1.43-.19-2.1H12z"/>
    <path fill="#34A853" d="M12 22c2.79 0 5.13-.92 6.84-2.5l-3.33-2.58c-.92.62-2.1.99-3.51.99-2.7 0-4.99-1.82-5.8-4.27H2.76v2.68A10.33 10.33 0 0 0 12 22z"/>
    <path fill="#4A90E2" d="M6.2 14.64A6.18 6.18 0 0 1 5.87 12c0-.91.16-1.8.33-2.64V6.68H2.76A10.33 10.33 0 0 0 1.67 12c0 1.66.4 3.24 1.09 4.64l3.44-2z"/>
    <path fill="#FBBC05" d="M12 6.09c1.52 0 2.88.52 3.96 1.55l2.97-2.97C17.12 2.99 14.79 2 12 2A10.33 10.33 0 0 0 2.76 6.68l3.44 2.68C7.01 7.91 9.3 6.09 12 6.09z"/>
  </svg>
`;

function getAuthHost() {
  return document.getElementById('auth-screen');
}

function getAppShell() {
  return document.querySelector('.app-shell');
}

function readPreLoginPrefs() {
  try {
    const rawSettings = window.localStorage.getItem('arupos_v1_settings');
    const parsed = rawSettings ? JSON.parse(rawSettings) : {};
    const themePref = window.localStorage.getItem('arupos_v1_theme_pref');
    const accentPref = window.localStorage.getItem('arupos_v1_accent_pref');
    const langPref = window.localStorage.getItem('arupos_v1_lang_pref');

    const theme =
      themePref === 'light' || themePref === 'dark' || themePref === 'system'
        ? themePref
        : parsed?.theme === 'dark' || parsed?.theme === 'system'
          ? parsed.theme
          : 'light';
    const rawAccent = parsed?.accent || accentPref;
    const accent = VALID_ACCENTS.includes(rawAccent) ? rawAccent : 'emerald';
    const rawLang = parsed?.language || langPref;
    const language = rawLang === 'en' || rawLang === 'id' ? rawLang : 'id';

    return { theme, accent, language };
  } catch {
    return { theme: 'light', accent: 'emerald', language: 'id' };
  }
}

function writePreLoginPref(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore preference storage errors
  }
}

function togglePreLoginTheme() {
  const currentResolved = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const nextTheme = currentResolved === 'dark' ? 'light' : 'dark';
  writePreLoginPref('arupos_v1_theme_pref', nextTheme);
  applyTheme(nextTheme);
  if (store.getCurrentUser() && store.getSettings().setupCompleted) {
    store.updateSettings({ theme: nextTheme });
  }
}

function togglePreLoginLanguage() {
  const nextLang = getLanguage() === 'id' ? 'en' : 'id';
  writePreLoginPref('arupos_v1_lang_pref', nextLang);
  setLanguage(nextLang);
  if (store.getCurrentUser() && store.getSettings().setupCompleted) {
    store.updateSettings({ language: nextLang });
  }
}

function mapFirebaseAuthError(err) {
  const code = err?.code || '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return t('auth.errPopupClosed');
  }
  if (code === 'auth/popup-blocked') {
    return t('auth.errPopupBlocked');
  }
  if (code === 'auth/unauthorized-domain') {
    return t('auth.errUnauthorizedDomain');
  }
  if (code === 'auth/network-request-failed') {
    return t('auth.errNetwork');
  }
  return t('auth.errGeneric');
}

function renderAuthScreen() {
  const host = getAuthHost();
  if (!host || host.hidden) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const lang = getLanguage();
  host.setAttribute('aria-label', t('auth.screenAria'));

  host.innerHTML = `
    <div class="auth-topbar">
      <button type="button" class="chip" data-auth-lang style="min-height:38px; padding:0 12px;">
        <span>${lang === 'id' ? 'ID' : 'EN'}</span>
      </button>
      <button
        type="button"
        class="icon-btn"
        data-auth-theme
        aria-label="${escapeHtml(isDark ? t('app.themeToggleLightAria') : t('app.themeToggleDarkAria'))}"
        title="${escapeHtml(isDark ? t('app.themeToggleLightTitle') : t('app.themeToggleDarkTitle'))}"
      >
        ${icon(isDark ? 'sun' : 'moon')}
      </button>
    </div>

    <div class="auth-card">
      <div class="auth-brand">
        <img src="./assets/icon.svg" alt="${escapeHtml(t('app.logoAlt'))}" class="brand-logo" width="52" height="52" />
        <div>
          <div class="auth-badge">${escapeHtml(t('auth.badge'))}</div>
        </div>
      </div>

      <h1 class="auth-title">${escapeHtml(t('auth.title'))}</h1>
      <p class="auth-subtitle">${escapeHtml(t('auth.subtitle'))}</p>

      <div class="auth-features">
        <span class="badge badge--primary">${icon('cloud')} <span>${escapeHtml(t('auth.featureCloud'))}</span></span>
        <span class="badge badge--muted">${icon('pos')} <span>${escapeHtml(t('auth.featureOffline'))}</span></span>
        <span class="badge badge--muted">${icon('printer')} <span>${escapeHtml(t('auth.featureReceipt'))}</span></span>
      </div>

      ${
        authUiState.errorMessage
          ? `<div class="auth-error-box" role="alert">${escapeHtml(authUiState.errorMessage)}</div>`
          : ''
      }

      <button
        type="button"
        id="google-signin-btn"
        class="btn-google"
        ${authUiState.busy ? 'disabled' : ''}
      >
        ${GOOGLE_G_SVG}
        <span>${escapeHtml(authUiState.busy ? t(authUiState.busyMessageKey || 'auth.signingIn') : t('auth.googleBtn'))}</span>
      </button>
    </div>
  `;

  applyAccent(document.documentElement.getAttribute('data-accent') || 'emerald');

  host.querySelector('[data-auth-theme]')?.addEventListener('click', () => {
    togglePreLoginTheme();
    renderAuthScreen();
  });

  host.querySelector('[data-auth-lang]')?.addEventListener('click', () => {
    togglePreLoginLanguage();
    renderAuthScreen();
  });

  host.querySelector('#google-signin-btn')?.addEventListener('click', async () => {
    if (authUiState.busy) return;
    authUiState.busy = true;
    authUiState.busyMessageKey = 'auth.signingIn';
    authUiState.errorMessage = '';
    renderAuthScreen();

    try {
      const res = await signInWithGoogle();
      if (res?.method === 'redirect') {
        authUiState.busyMessageKey = 'auth.signingIn';
        renderAuthScreen();
      }
      // Note: successful popup fires onAuthStateChanged handler
    } catch (err) {
      authUiState.busy = false;
      authUiState.errorMessage = mapFirebaseAuthError(err);
      renderAuthScreen();
    }
  });
}

function showAuthScreen({ busy = false, busyMessageKey = 'auth.checkingSession', errorMessage = '' } = {}) {
  const host = getAuthHost();
  const shell = getAppShell();
  hideSetupWizard();
  if (shell) shell.hidden = true;
  if (host) {
    authUiState.busy = busy;
    authUiState.busyMessageKey = busyMessageKey;
    authUiState.errorMessage = errorMessage;
    host.hidden = false;
    renderAuthScreen();
  }
}

function hideAuthScreen() {
  const host = getAuthHost();
  if (host) {
    host.hidden = true;
    host.innerHTML = '';
  }
}

function getViewPanel(name) {
  return document.getElementById(`view-${name}`);
}

function populateNavIcons() {
  document.querySelectorAll('[data-nav-icon]').forEach((el) => {
    const name = el.getAttribute('data-nav-icon');
    if (name) {
      el.innerHTML = icon(name);
    }
  });
}

function syncNavAndShell() {
  document.title = t('app.title');

  const logoEl = document.querySelector('.brand-logo');
  if (logoEl) {
    logoEl.alt = t('app.logoAlt');
  }

  const navRail = document.querySelector('.nav-rail');
  if (navRail) navRail.setAttribute('aria-label', t('app.navMainAria'));

  const bottomNav = document.querySelector('.bottom-nav');
  if (bottomNav) bottomNav.setAttribute('aria-label', t('app.navBottomAria'));

  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    const viewName = btn.getAttribute('data-view');
    const labelEl = btn.querySelector('.nav-label');
    if (labelEl && viewName) {
      labelEl.textContent = t(`nav.${viewName}`);
    }
  });

  document.querySelectorAll('.view[data-view-panel]').forEach((panel) => {
    const viewName = panel.getAttribute('data-view-panel');
    if (!viewName) return;
    panel.setAttribute(
      'aria-label',
      viewName === 'settings' ? t('nav.settingsPanelAria') : t(`nav.${viewName}`)
    );
  });
}

function syncTopBar() {
  const settings = store.getSettings();
  const storeNameEl = document.getElementById('topbar-store-name');
  const storeSubEl = document.getElementById('topbar-store-sub');
  const themeBtnEl = document.getElementById('topbar-theme-btn');

  if (storeNameEl) {
    storeNameEl.textContent = settings.storeName || 'AruPOS';
  }
  if (storeSubEl) {
    storeSubEl.textContent = t('app.storeSub');
  }

  if (themeBtnEl) {
    const resolvedTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    themeBtnEl.innerHTML = icon(resolvedTheme === 'dark' ? 'sun' : 'moon');
    themeBtnEl.setAttribute(
      'aria-label',
      resolvedTheme === 'dark' ? t('app.themeToggleLightAria') : t('app.themeToggleDarkAria')
    );
    themeBtnEl.title = resolvedTheme === 'dark'
      ? t('app.themeToggleLightTitle')
      : t('app.themeToggleDarkTitle');
  }
}

function updateNavActiveState(targetName) {
  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    const isTarget = btn.getAttribute('data-view') === targetName;
    btn.classList.toggle('is-active', isTarget);
    if (isTarget) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });
}

function switchView(targetName) {
  if (!VIEW_HANDLERS[targetName]) return;
  if (targetName === activeView) {
    VIEW_HANDLERS[targetName].render();
    return;
  }

  const prevEl = getViewPanel(activeView);
  const nextEl = getViewPanel(targetName);
  if (!nextEl) return;

  const prevIdx = VIEW_ORDER.indexOf(activeView);
  const nextIdx = VIEW_ORDER.indexOf(targetName);
  const direction = nextIdx >= prevIdx ? 1 : -1;

  closeAllSheets();
  activeView = targetName;
  updateNavActiveState(targetName);
  if (!prefersReducedMotion()) {
    document.querySelectorAll('.nav-item.is-active .nav-icon > svg').forEach((svgEl) => {
      if (svgEl.getBoundingClientRect().width > 0) {
        popElement(svgEl);
      }
    });
  }
  transitionView(prevEl, nextEl, direction);
  VIEW_HANDLERS[targetName].render();
}

function resetViewPanelsToPos() {
  activeView = 'pos';
  VIEW_ORDER.forEach((name) => {
    const panel = getViewPanel(name);
    if (!panel) return;
    panel.classList.toggle('is-active', name === 'pos');
  });
  updateNavActiveState('pos');
}

function bindShellListenersOnce() {
  if (shellListenersBound) return;
  shellListenersBound = true;

  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-view');
      if (target) switchView(target);
    });
  });

  const themeBtn = document.getElementById('topbar-theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const currentResolved = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const nextTheme = currentResolved === 'dark' ? 'light' : 'dark';
      store.updateSettings({ theme: nextTheme });
      applyTheme(nextTheme);
      syncTopBar();
      const svgEl = themeBtn.querySelector('svg');
      if (svgEl && !prefersReducedMotion()) {
        svgEl.classList.add('theme-icon-spin');
        svgEl.addEventListener('animationend', () => svgEl.classList.remove('theme-icon-spin'), { once: true });
        setTimeout(() => svgEl.classList.remove('theme-icon-spin'), 280);
      }
    });
  }

  bus.on('settings:changed', (updatedSettings) => {
    const s = updatedSettings || store.getSettings();
    setLanguage(s.language);
    applyTheme(s.theme);
    applyAccent(s.accent);
    cart.syncFromSettings(s);
    syncNavAndShell();
    syncTopBar();
  });

  bus.on('store:reset', () => {
    const s = store.getSettings();
    setLanguage(s.language);
    applyTheme(s.theme);
    applyAccent(s.accent);
    cart.clear(true);
    cart.syncFromSettings(s);
    syncNavAndShell();
    syncTopBar();
    if (viewsInitialized) {
      VIEW_HANDLERS[activeView]?.render();
    }
  });

  bus.on('nav:goto', (viewName) => {
    if (typeof viewName === 'string') {
      switchView(viewName);
    }
  });

  bus.on('auth:signout-requested', async () => {
    if (isFirebaseAuthSession) {
      try {
        await signOutUser();
      } catch (err) {
        console.error('[AruPOS signOut]', err);
        unmountAuthenticatedSession();
      }
    } else {
      unmountAuthenticatedSession();
    }
    toast(t('auth.signOutToast'), 'info');
  });

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemThemeChange = () => {
      if (store.getSettings().theme === 'system') {
        setTimeout(() => {
          syncTopBar();
          renderAuthScreen();
          renderSetupWizard();
        }, 0);
      }
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onSystemThemeChange);
    }
  }
}

function enterAppShell() {
  const shell = getAppShell();
  const s = store.getSettings();
  setLanguage(s.language);
  applyTheme(s.theme);
  applyAccent(s.accent);
  cart.syncFromSettings(s);

  populateNavIcons();
  syncNavAndShell();
  syncTopBar();
  bindShellListenersOnce();
  resetViewPanelsToPos();

  hideAuthScreen();
  hideSetupWizard();
  if (shell) shell.hidden = false;

  if (!viewsInitialized) {
    viewsInitialized = true;
    for (const name of VIEW_ORDER) {
      const panel = getViewPanel(name);
      if (panel) {
        VIEW_HANDLERS[name].init(panel);
      }
    }
  } else {
    for (const name of VIEW_ORDER) {
      VIEW_HANDLERS[name].render();
    }
  }
  updateNavActiveState(activeView);
}

export async function mountAuthenticatedSession(user, adapter) {
  const token = ++sessionGeneration;
  if (!user || !user.uid) {
    unmountAuthenticatedSession();
    return { ok: false };
  }

  const targetAdapter = adapter || createFirestoreAdapter(user.uid);
  showAuthScreen({ busy: true, busyMessageKey: 'auth.loadingStore' });

  const connectRes = await store.connectCloud(user, targetAdapter);
  if (token !== sessionGeneration) return { ok: false, stale: true };

  if (connectRes.ok && connectRes.needsSetup) {
    hideAuthScreen();
    const shell = getAppShell();
    if (shell) shell.hidden = true;

    showSetupWizard({
      user,
      localMigrationCandidate: connectRes.localMigrationCandidate,
      profileSuggestion: connectRes.profileSuggestion,
      onToggleTheme: () => togglePreLoginTheme(),
      onToggleLang: () => togglePreLoginLanguage(),
      onSignOut: async () => {
        if (isFirebaseAuthSession) {
          try {
            await signOutUser();
          } catch {
            unmountAuthenticatedSession();
          }
        } else {
          unmountAuthenticatedSession();
        }
      },
      onComplete: async (setupPayload) => {
        if (token !== sessionGeneration) return;
        await store.completeSetup(setupPayload);
        if (token !== sessionGeneration) return;
        enterAppShell();
      },
    });
    return { ok: true, needsSetup: true };
  }

  enterAppShell();

  if (connectRes.errorCode === 'permission-denied') {
    toast(t('auth.rulesDeniedToast'), 'warning', 5200);
  }

  return connectRes;
}

export function unmountAuthenticatedSession() {
  sessionGeneration += 1;
  isFirebaseAuthSession = false;
  closeAllSheets();
  store.disconnectCloud();
  cart.clear(false);
  resetViewPanelsToPos();
  const prefs = readPreLoginPrefs();
  setLanguage(prefs.language);
  applyTheme(prefs.theme);
  applyAccent(prefs.accent);
  showAuthScreen({ busy: false });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const doRegister = () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  };
  if (document.readyState === 'complete') {
    doRegister();
  } else {
    window.addEventListener('load', doRegister, { once: true });
  }
}

async function bootstrap() {
  const prefs = readPreLoginPrefs();
  setLanguage(prefs.language);
  applyTheme(prefs.theme);
  applyAccent(prefs.accent);
  initMotion();
  populateNavIcons();
  registerServiceWorker();

  showAuthScreen({ busy: true, busyMessageKey: 'auth.checkingSession' });

  const redirectRes = await resolveRedirectLogin();
  let pendingRedirectErrMsg = redirectRes?.error ? mapFirebaseAuthError(redirectRes.error) : '';

  subscribeAuth(async (firebaseUser) => {
    const err = pendingRedirectErrMsg;
    pendingRedirectErrMsg = '';
    if (firebaseUser) {
      isFirebaseAuthSession = true;
      await mountAuthenticatedSession(firebaseUser, createFirestoreAdapter(firebaseUser.uid));
    } else {
      isFirebaseAuthSession = false;
      closeAllSheets();
      store.disconnectCloud();
      cart.clear(false);
      resetViewPanelsToPos();
      const latestPrefs = readPreLoginPrefs();
      setLanguage(latestPrefs.language);
      applyTheme(latestPrefs.theme);
      applyAccent(latestPrefs.accent);
      showAuthScreen({ busy: false, errorMessage: err });
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
