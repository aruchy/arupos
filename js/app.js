import { bus } from './utils.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { cart } from './cart.js';
import { setLanguage, t } from './i18n.js';
import {
  initMotion,
  applyTheme,
  applyAccent,
  transitionView,
  popElement,
  prefersReducedMotion,
  closeAllSheets,
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

let activeView = 'pos';

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
    storeSubEl.textContent = settings.mode === 'fnb'
      ? t('app.storeSubFnb')
      : t('app.storeSubRetail');
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

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

function bootstrap() {
  store.init();
  const initialSettings = store.getSettings();
  setLanguage(initialSettings.language);
  applyTheme(initialSettings.theme);
  applyAccent(initialSettings.accent);
  initMotion();
  cart.syncFromSettings(initialSettings);

  populateNavIcons();
  syncNavAndShell();
  syncTopBar();

  for (const name of VIEW_ORDER) {
    const panel = getViewPanel(name);
    if (panel) {
      VIEW_HANDLERS[name].init(panel);
    }
  }
  updateNavActiveState(activeView);

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
    VIEW_HANDLERS[activeView]?.render();
  });

  bus.on('nav:goto', (viewName) => {
    if (typeof viewName === 'string') {
      switchView(viewName);
    }
  });

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemThemeChange = () => {
      if (store.getSettings().theme === 'system') {
        setTimeout(syncTopBar, 0);
      }
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onSystemThemeChange);
    }
  }

  registerServiceWorker();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
