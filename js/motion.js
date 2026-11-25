import { escapeHtml, formatRupiah } from './utils.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

const RIPPLE_SELECTOR =
  '.btn, .chip, .product-card, .nav-item, .method-card, .seg-btn, .icon-btn, .quick-cash-btn, .qty-btn, .mode-card, .theme-card, .accent-card, .lang-card, .tx-card';
const EASE_SMOOTH = 'cubic-bezier(0.22, 1, 0.36, 1)';
const MAX_TOASTS = 3;
const SHEET_CLOSE_MS = 210;

let motionInitialized = false;
let themeMediaQuery = null;
let themeMediaListener = null;
let themeSwitchTimer = null;
let sheetAutoCounter = 0;

const activeNumberAnimations = new WeakMap();
const activePopAnimations = new WeakMap();
const activeViewAnimations = new WeakMap();
const sheetStack = [];

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function animatedSuccessCheckSvg(size = 20) {
  const s = Math.max(16, Number(size) || 20);
  return `
    <svg
      class="aru-icon success-check-svg"
      width="${s}"
      height="${s}"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path class="success-check-mark" d="m8.5 12.2 2.4 2.4 4.8-4.9" />
    </svg>
  `.trim();
}

function getOrCreateContainer(id) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
}

function syncBodySheetLock() {
  document.body.classList.toggle('has-open-sheet', sheetStack.length > 0);
}

function spawnRipple(target, event) {
  if (prefersReducedMotion()) return;
  if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;
  if (target.classList.contains('is-out')) return;

  const rect = target.getBoundingClientRect();
  if (!rect.width && !rect.height) return;

  const clientX = typeof event.clientX === 'number' && event.clientX !== 0
    ? event.clientX
    : rect.left + rect.width / 2;
  const clientY = typeof event.clientY === 'number' && event.clientY !== 0
    ? event.clientY
    : rect.top + rect.height / 2;

  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const maxDistX = Math.max(localX, rect.width - localX);
  const maxDistY = Math.max(localY, rect.height - localY);
  const radius = Math.hypot(maxDistX, maxDistY);
  const diameter = Math.ceil(radius * 2);

  const ripple = document.createElement('span');
  ripple.className = 'aru-ripple';
  ripple.style.width = `${diameter}px`;
  ripple.style.height = `${diameter}px`;
  ripple.style.transform = `translate3d(${localX - radius}px, ${localY - radius}px, 0) scale(0)`;
  ripple.style.left = '0';
  ripple.style.top = '0';

  target.appendChild(ripple);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    ripple.remove();
  };

  if (typeof ripple.animate === 'function') {
    const offset = `translate3d(${localX - radius}px, ${localY - radius}px, 0)`;
    const anim = ripple.animate(
      [
        { transform: `${offset} scale(0)`, opacity: 0.32 },
        { transform: `${offset} scale(1)`, opacity: 0 },
      ],
      {
        duration: 420,
        easing: EASE_SMOOTH,
        fill: 'forwards',
      }
    );
    anim.onfinish = cleanup;
    anim.oncancel = cleanup;
    setTimeout(cleanup, 480);
    return;
  }

  ripple.style.left = `${localX - radius}px`;
  ripple.style.top = `${localY - radius}px`;
  ripple.addEventListener('animationend', cleanup, { once: true });
  setTimeout(cleanup, 480);
}

export function initMotion() {
  if (motionInitialized) return;
  motionInitialized = true;

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const target = event.target instanceof Element ? event.target.closest(RIPPLE_SELECTOR) : null;
    if (!target) return;
    spawnRipple(target, event);
  }, { passive: true });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (sheetStack.length === 0) return;
    const topSheet = sheetStack[sheetStack.length - 1];
    if (topSheet) {
      event.preventDefault();
      closeSheet(topSheet.id);
    }
  });
}

export const ACCENT_THEMES = [
  {
    id: 'emerald',
    nameKey: 'accent.emerald.name',
    descKey: 'accent.emerald.desc',
    swatchLight: '#145A46',
    swatchDark: '#6CC4A7',
    iconColors: ['#1F7D63', '#0E4535', '#145A46', '#3CA082'],
  },
  {
    id: 'amber',
    nameKey: 'accent.amber.name',
    descKey: 'accent.amber.desc',
    swatchLight: '#9A6012',
    swatchDark: '#E8B866',
    iconColors: ['#B3731C', '#744509', '#8C5610', '#D49B42'],
  },
  {
    id: 'burgundy',
    nameKey: 'accent.burgundy.name',
    descKey: 'accent.burgundy.desc',
    swatchLight: '#7A2238',
    swatchDark: '#E598AA',
    iconColors: ['#942E48', '#561526', '#7A2238', '#C05A74'],
  },
  {
    id: 'sapphire',
    nameKey: 'accent.sapphire.name',
    descKey: 'accent.sapphire.desc',
    swatchLight: '#2D4696',
    swatchDark: '#93AEFF',
    iconColors: ['#3954AC', '#223678', '#2D4696', '#657AC2'],
  },
];

const accentIconCache = new Map();

function buildAccentIconDataUri(colors) {
  const key = Array.isArray(colors) ? colors.join('|') : '';
  const cached = accentIconCache.get(key);
  if (cached) return cached;

  const [startColor, endColor, darkAccent, lightAccent] = colors;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="aruBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${startColor}"/>
      <stop offset="100%" stop-color="${endColor}"/>
    </linearGradient>
    <linearGradient id="aruGlass" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.98"/>
      <stop offset="100%" stop-color="#F5F4F0" stop-opacity="0.94"/>
    </linearGradient>
  </defs>
  <rect x="24" y="24" width="464" height="464" rx="112" fill="url(#aruBg)"/>
  <rect x="116" y="108" width="280" height="296" rx="36" fill="url(#aruGlass)"/>
  <rect x="152" y="152" width="208" height="72" rx="16" fill="${darkAccent}" fill-opacity="0.14"/>
  <rect x="172" y="176" width="108" height="24" rx="12" fill="${darkAccent}"/>
  <circle cx="324" cy="188" r="14" fill="${lightAccent}"/>
  <rect x="152" y="252" width="56" height="44" rx="12" fill="${darkAccent}" fill-opacity="0.18"/>
  <rect x="228" y="252" width="56" height="44" rx="12" fill="${darkAccent}" fill-opacity="0.18"/>
  <rect x="304" y="252" width="56" height="44" rx="12" fill="${darkAccent}" fill-opacity="0.18"/>
  <rect x="152" y="314" width="132" height="48" rx="14" fill="${darkAccent}"/>
  <rect x="304" y="314" width="56" height="48" rx="14" fill="${lightAccent}"/>
</svg>`;
  const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  accentIconCache.set(key, dataUri);
  return dataUri;
}

function triggerThemeSmoothTransition() {
  if (prefersReducedMotion()) return;
  document.documentElement.classList.add('is-theme-switching');
  if (themeSwitchTimer) clearTimeout(themeSwitchTimer);
  themeSwitchTimer = setTimeout(() => {
    document.documentElement.classList.remove('is-theme-switching');
    themeSwitchTimer = null;
  }, 320);
}

export function animateLanguageSwitch(elements = []) {
  if (prefersReducedMotion()) return;
  for (const el of elements) {
    if (!el || typeof el.animate !== 'function') continue;
    el.animate(
      [{ opacity: 0.72 }, { opacity: 1 }],
      { duration: 220, easing: EASE_SMOOTH }
    );
  }
}

function setResolvedTheme(resolved) {
  const safeTheme = resolved === 'dark' ? 'dark' : 'light';
  const prevTheme = document.documentElement.getAttribute('data-theme');

  if (prevTheme && prevTheme !== safeTheme) {
    triggerThemeSmoothTransition();
  }

  document.documentElement.setAttribute('data-theme', safeTheme);
  document.documentElement.style.colorScheme = safeTheme;

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', safeTheme === 'dark' ? '#191B22' : '#ECEAE6');
  }
  return safeTheme;
}

export function applyAccent(accent = 'emerald') {
  const preset = ACCENT_THEMES.find((item) => item.id === accent) || ACCENT_THEMES[0];
  const safeAccent = preset.id;
  const prevAccent = document.documentElement.getAttribute('data-accent');

  if (prevAccent && prevAccent !== safeAccent) {
    triggerThemeSmoothTransition();
  }

  document.documentElement.setAttribute('data-accent', safeAccent);

  const logoEl = document.querySelector('.brand-logo');
  if (logoEl) {
    logoEl.setAttribute(
      'src',
      preset.iconColors ? buildAccentIconDataUri(preset.iconColors) : './assets/icon.svg'
    );
  }

  return safeAccent;
}

export function applyTheme(mode = 'system') {
  if (themeMediaQuery && themeMediaListener) {
    if (typeof themeMediaQuery.removeEventListener === 'function') {
      themeMediaQuery.removeEventListener('change', themeMediaListener);
    } else if (typeof themeMediaQuery.removeListener === 'function') {
      themeMediaQuery.removeListener(themeMediaListener);
    }
    themeMediaListener = null;
  }

  if (mode === 'light' || mode === 'dark') {
    return setResolvedTheme(mode);
  }

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    themeMediaListener = (e) => {
      setResolvedTheme(e.matches ? 'dark' : 'light');
    };
    if (typeof themeMediaQuery.addEventListener === 'function') {
      themeMediaQuery.addEventListener('change', themeMediaListener);
    } else if (typeof themeMediaQuery.addListener === 'function') {
      themeMediaQuery.addListener(themeMediaListener);
    }
    return setResolvedTheme(themeMediaQuery.matches ? 'dark' : 'light');
  }

  return setResolvedTheme('light');
}

export function animateNumber(
  el,
  toValue,
  { duration = 260, formatter = (v) => String(Math.round(v)), pulse = false } = {}
) {
  if (!el) return;

  const prev = activeNumberAnimations.get(el);
  if (prev) {
    if (prev.frameId) cancelAnimationFrame(prev.frameId);
    if (prev.timerId) clearTimeout(prev.timerId);
    activeNumberAnimations.delete(el);
  }

  const target = Number.isFinite(Number(toValue)) ? Number(toValue) : 0;
  const fromRaw = el.dataset.animCurrent ?? el.dataset.animVal;
  const from = Number.isFinite(Number(fromRaw)) ? Number(fromRaw) : 0;

  if (prefersReducedMotion() || duration <= 0 || from === target) {
    el.dataset.animVal = String(target);
    el.dataset.animCurrent = String(target);
    el.textContent = formatter(target);
    return;
  }

  if (pulse && typeof el.animate === 'function') {
    el.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.03)', offset: 0.45 },
        { transform: 'scale(1)' },
      ],
      {
        duration: 200,
        easing: EASE_SMOOTH,
      }
    );
  }

  const startTime = performance.now();
  const delta = target - from;
  let finished = false;

  const finalize = () => {
    if (finished) return;
    finished = true;
    const state = activeNumberAnimations.get(el);
    if (state) {
      if (state.frameId) cancelAnimationFrame(state.frameId);
      if (state.timerId) clearTimeout(state.timerId);
      activeNumberAnimations.delete(el);
    }
    el.dataset.animVal = String(target);
    el.dataset.animCurrent = String(target);
    el.textContent = formatter(target);
  };

  const tick = (now) => {
    if (finished) return;
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 4);
    const current = from + delta * eased;
    el.dataset.animCurrent = String(current);
    el.textContent = formatter(current);

    if (progress < 1) {
      const state = activeNumberAnimations.get(el);
      if (state) {
        state.frameId = requestAnimationFrame(tick);
      }
    } else {
      finalize();
    }
  };

  el.dataset.animVal = String(target);
  const timerId = setTimeout(finalize, duration + 35);
  const frameId = requestAnimationFrame(tick);
  activeNumberAnimations.set(el, { frameId, timerId });
}

export function animateRupiah(el, toValue, opts = {}) {
  animateNumber(el, toValue, { ...opts, formatter: formatRupiah });
}

export function popElement(el) {
  if (!el || prefersReducedMotion()) return;

  if (typeof el.animate === 'function') {
    const prevAnim = activePopAnimations.get(el);
    if (prevAnim) {
      try {
        prevAnim.cancel();
      } catch {
        // Ignore already finished animation
      }
    }
    const anim = el.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.08)', offset: 0.45 },
        { transform: 'scale(1)' },
      ],
      {
        duration: 220,
        easing: EASE_SMOOTH,
      }
    );
    activePopAnimations.set(el, anim);
    return;
  }

  el.classList.remove('is-popping');
  requestAnimationFrame(() => {
    el.classList.add('is-popping');
  });
  setTimeout(() => {
    el.classList.remove('is-popping');
  }, 240);
}

export function flyToCart(sourceEl, targetEl, label = '') {
  if (!sourceEl || !targetEl) return;

  if (prefersReducedMotion()) {
    return;
  }

  const srcRect = sourceEl.getBoundingClientRect();
  const dstRect = targetEl.getBoundingClientRect();

  if ((!srcRect.width && !srcRect.height) || (!dstRect.width && !dstRect.height)) {
    popElement(targetEl);
    return;
  }

  const startX = srcRect.left + srcRect.width / 2;
  const startY = srcRect.top + srcRect.height / 2;
  const endX = dstRect.left + dstRect.width / 2;
  const endY = dstRect.top + dstRect.height / 2;

  const ghost = document.createElement('div');
  ghost.className = 'fly-ghost';
  ghost.innerHTML = escapeHtml(label || '+1');
  ghost.style.transform = `translate3d(${startX}px, ${startY}px, 0) translate(-50%, -50%) scale(1)`;
  document.body.appendChild(ghost);

  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    ghost.remove();
    popElement(targetEl);
  };

  if (typeof ghost.animate === 'function') {
    const anim = ghost.animate(
      [
        {
          transform: `translate3d(${startX}px, ${startY}px, 0) translate(-50%, -50%) scale(1)`,
          opacity: 0.95,
        },
        {
          transform: `translate3d(${endX}px, ${endY}px, 0) translate(-50%, -50%) scale(0.55)`,
          opacity: 0,
        },
      ],
      {
        duration: 280,
        easing: EASE_SMOOTH,
        fill: 'forwards',
      }
    );
    anim.onfinish = done;
    anim.oncancel = done;
    setTimeout(done, 340);
  } else {
    ghost.style.transition = `transform 280ms ${EASE_SMOOTH}, opacity 280ms ${EASE_SMOOTH}`;
    requestAnimationFrame(() => {
      ghost.style.transform = `translate3d(${endX}px, ${endY}px, 0) translate(-50%, -50%) scale(0.55)`;
      ghost.style.opacity = '0';
    });
    setTimeout(done, 300);
  }
}

export function toast(message, type = 'info', duration = 2800) {
  const root = getOrCreateContainer('toast-root');
  const safeType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';

  const iconMap = {
    success: 'checkCircle',
    error: 'warning',
    warning: 'warning',
    info: 'info',
  };

  // Cap stack at MAX_TOASTS by removing oldest non-leaving toast
  const activeToasts = [...root.querySelectorAll('.toast:not(.is-leaving)')];
  while (activeToasts.length >= MAX_TOASTS) {
    const oldest = activeToasts.shift();
    if (oldest) oldest.remove();
  }

  const iconHtml = safeType === 'success'
    ? animatedSuccessCheckSvg(20)
    : icon(iconMap[safeType]);

  const progressHtml = duration > 0 && !prefersReducedMotion()
    ? `<span class="toast-progress" aria-hidden="true" style="animation: toastProgress ${Number(duration)}ms linear forwards;"></span>`
    : '';

  const toastEl = document.createElement('div');
  toastEl.className = `toast toast--${safeType}`;
  toastEl.setAttribute('role', safeType === 'error' ? 'alert' : 'status');
  toastEl.setAttribute('aria-live', safeType === 'error' ? 'assertive' : 'polite');
  toastEl.innerHTML = `
    <span class="toast-icon">${iconHtml}</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
    <button type="button" class="icon-btn toast-close" aria-label="${escapeHtml(t('motion.closeToast'))}">${icon('close')}</button>
    ${progressHtml}
  `;

  let dismissed = false;
  let timer = null;

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (prefersReducedMotion()) {
      toastEl.remove();
      return;
    }
    toastEl.classList.add('is-leaving');
    setTimeout(() => toastEl.remove(), 190);
  };

  const closeBtn = toastEl.querySelector('.toast-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', dismiss);
  }

  root.appendChild(toastEl);

  if (duration > 0) {
    timer = setTimeout(dismiss, duration);
  }

  return { dismiss };
}

function attachMobileSheetDrag(backdrop, panelEl, sheetId) {
  if (!panelEl) return;
  const headerEl = panelEl.querySelector('.sheet-header');
  const handleEl = panelEl.querySelector('.sheet-handle');
  const dragTargets = [handleEl, headerEl].filter(Boolean);
  if (dragTargets.length === 0) return;

  let startY = 0;
  let deltaY = 0;
  let dragging = false;

  const resetPanel = () => {
    dragging = false;
    panelEl.classList.remove('is-dragging');
    panelEl.style.transition = `transform 220ms ${EASE_SMOOTH}`;
    panelEl.style.transform = 'translate3d(0, 0, 0)';
    setTimeout(() => {
      panelEl.style.transition = '';
      panelEl.style.transform = '';
    }, 230);
  };

  const onPointerDown = (event) => {
    if (window.innerWidth >= 900 || prefersReducedMotion()) return;
    if (event.target instanceof Element && event.target.closest('.sheet-close-btn')) return;
    startY = event.clientY;
    deltaY = 0;
    dragging = true;
    panelEl.classList.add('is-dragging');
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    const rawDy = event.clientY - startY;
    deltaY = Math.max(0, rawDy);
    panelEl.style.transform = `translate3d(0, ${deltaY}px, 0)`;
  };

  const onPointerEnd = () => {
    if (!dragging) return;
    if (deltaY > 85) {
      dragging = false;
      panelEl.classList.remove('is-dragging');
      panelEl.style.transform = '';
      closeSheet(sheetId);
    } else {
      resetPanel();
    }
  };

  dragTargets.forEach((target) => {
    target.addEventListener('pointerdown', onPointerDown, { passive: true });
  });
  backdrop.addEventListener('pointermove', onPointerMove, { passive: true });
  backdrop.addEventListener('pointerup', onPointerEnd, { passive: true });
  backdrop.addEventListener('pointercancel', onPointerEnd, { passive: true });
}

export function openSheet({
  id,
  title = '',
  contentHtml = '',
  footerHtml = '',
  size = 'md',
  onMount,
  onClose,
} = {}) {
  const root = getOrCreateContainer('sheet-root');
  const sheetId = id || `sheet_${++sheetAutoCounter}`;
  const safeSize = ['sm', 'md', 'lg'].includes(size) ? size : 'md';

  // If sheet with same id is already open, update its content in place cleanly
  const existing = sheetStack.find((item) => item.id === sheetId);
  if (existing) {
    existing.onClose = onClose;
    const titleEl = existing.panelEl.querySelector('.sheet-title');
    const bodyEl = existing.panelEl.querySelector('.sheet-body');
    const footerEl = existing.panelEl.querySelector('.sheet-footer');

    existing.panelEl.classList.remove('sheet-panel--sm', 'sheet-panel--md', 'sheet-panel--lg');
    existing.panelEl.classList.add(`sheet-panel--${safeSize}`);

    if (titleEl) titleEl.innerHTML = escapeHtml(title);
    if (bodyEl) bodyEl.innerHTML = contentHtml;
    if (footerEl) footerEl.innerHTML = footerHtml || '';

    const controller = {
      id: sheetId,
      panelEl: existing.panelEl,
      close: () => closeSheet(sheetId),
    };
    if (typeof onMount === 'function') {
      onMount(existing.panelEl, controller);
    }
    return controller;
  }

  const titleId = `sheet_title_${sheetId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const backdrop = document.createElement('div');
  backdrop.className = prefersReducedMotion() ? 'sheet-backdrop' : 'sheet-backdrop is-opening';
  backdrop.dataset.sheetId = sheetId;

  backdrop.innerHTML = `
    <div class="sheet-panel sheet-panel--${safeSize}" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(titleId)}">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-header">
        <h2 class="sheet-title" id="${escapeHtml(titleId)}">${escapeHtml(title)}</h2>
        <button type="button" class="icon-btn sheet-close-btn" aria-label="${escapeHtml(t('motion.closeDialog'))}">${icon('close')}</button>
      </div>
      <div class="sheet-body">${contentHtml}</div>
      <div class="sheet-footer">${footerHtml || ''}</div>
    </div>
  `;

  const panelEl = backdrop.querySelector('.sheet-panel');
  const closeBtn = backdrop.querySelector('.sheet-close-btn');

  const clearOpening = () => {
    backdrop.classList.remove('is-opening');
  };
  if (panelEl && !prefersReducedMotion()) {
    panelEl.addEventListener('animationend', clearOpening, { once: true });
    setTimeout(clearOpening, 320);
  } else {
    clearOpening();
  }

  const entry = {
    id: sheetId,
    backdropEl: backdrop,
    panelEl,
    onClose,
    closed: false,
  };

  sheetStack.push(entry);
  root.appendChild(backdrop);
  syncBodySheetLock();

  const controller = {
    id: sheetId,
    panelEl,
    close: () => closeSheet(sheetId),
  };

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      closeSheet(sheetId);
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeSheet(sheetId));
  }

  attachMobileSheetDrag(backdrop, panelEl, sheetId);

  if (typeof onMount === 'function') {
    onMount(panelEl, controller);
  }

  return controller;
}

export function closeSheet(id) {
  const idx = sheetStack.findIndex((item) => item.id === id);
  if (idx === -1) return;

  const entry = sheetStack[idx];
  if (entry.closed) return;
  entry.closed = true;

  sheetStack.splice(idx, 1);
  syncBodySheetLock();

  const finalize = () => {
    entry.backdropEl.remove();
    if (typeof entry.onClose === 'function') {
      try {
        entry.onClose();
      } catch (err) {
        console.error('[motion:closeSheet] onClose error:', err);
      }
    }
  };

  if (prefersReducedMotion()) {
    finalize();
    return;
  }

  entry.backdropEl.classList.remove('is-opening');
  entry.backdropEl.classList.add('is-closing');
  setTimeout(finalize, SHEET_CLOSE_MS);
}

export function closeAllSheets() {
  const ids = sheetStack.map((item) => item.id);
  for (const id of ids) {
    closeSheet(id);
  }
}

export function confirmDialog({
  title = t('motion.confirmTitle'),
  message = t('motion.confirmMessage'),
  confirmText = t('motion.confirmOk'),
  cancelText = t('common.cancel'),
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const confirmVariant = danger ? 'btn--danger' : 'btn--primary';
    const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');

    const sheet = openSheet({
      id: `confirm_${++sheetAutoCounter}`,
      title,
      size: 'sm',
      contentHtml: `<p style="margin:0;color:var(--text-secondary);line-height:1.55;">${safeMessage}</p>`,
      footerHtml: `
        <button type="button" class="btn btn--outlined" data-confirm-action="cancel">${escapeHtml(cancelText)}</button>
        <button type="button" class="btn ${confirmVariant}" data-confirm-action="ok">${escapeHtml(confirmText)}</button>
      `,
      onMount: (panelEl, ctrl) => {
        const cancelBtn = panelEl.querySelector('[data-confirm-action="cancel"]');
        const okBtn = panelEl.querySelector('[data-confirm-action="ok"]');

        if (cancelBtn) {
          cancelBtn.addEventListener('click', () => {
            finish(false);
            ctrl.close();
          });
        }
        if (okBtn) {
          okBtn.addEventListener('click', () => {
            finish(true);
            ctrl.close();
          });
          okBtn.focus();
        }
      },
      onClose: () => {
        finish(false);
      },
    });

    if (!sheet) {
      finish(false);
    }
  });
}

export function transitionView(outEl, inEl, direction = 1) {
  if (!inEl) return;

  const animClasses = ['is-entering-right', 'is-entering-left', 'is-entering-fade'];

  if (outEl && outEl !== inEl) {
    const outAnim = activeViewAnimations.get(outEl);
    if (outAnim) {
      try {
        outAnim.cancel();
      } catch {
        // Ignore
      }
      activeViewAnimations.delete(outEl);
    }
    outEl.style.willChange = '';
    outEl.classList.remove('is-active', ...animClasses);
  }

  inEl.classList.remove(...animClasses);
  inEl.classList.add('is-active');

  if (!prefersReducedMotion()) {
    if (typeof inEl.animate === 'function') {
      const prevAnim = activeViewAnimations.get(inEl);
      if (prevAnim) {
        try {
          prevAnim.cancel();
        } catch {
          // Ignore
        }
      }
      const xOffset = direction > 0 ? 14 : direction < 0 ? -14 : 0;
      const yOffset = direction === 0 ? 8 : 0;

      inEl.style.willChange = 'transform, opacity';
      const anim = inEl.animate(
        [
          { opacity: 0, transform: `translate3d(${xOffset}px, ${yOffset}px, 0)` },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: direction === 0 ? 220 : 240,
          easing: EASE_SMOOTH,
          fill: 'none',
        }
      );
      activeViewAnimations.set(inEl, anim);
      const resetWillChange = () => {
        inEl.style.willChange = '';
        if (activeViewAnimations.get(inEl) === anim) {
          activeViewAnimations.delete(inEl);
        }
      };
      anim.onfinish = resetWillChange;
      anim.oncancel = resetWillChange;
    } else {
      const enterClass = direction > 0
        ? 'is-entering-right'
        : direction < 0
          ? 'is-entering-left'
          : 'is-entering-fade';

      requestAnimationFrame(() => {
        inEl.classList.add(enterClass);
      });
      const cleanup = () => {
        inEl.classList.remove(enterClass);
      };
      inEl.addEventListener('animationend', cleanup, { once: true });
      setTimeout(cleanup, 280);
    }
  }

  const mainEl = document.querySelector('.main-content');
  if (mainEl && typeof mainEl.scrollTo === 'function') {
    mainEl.scrollTo({ top: 0, behavior: 'auto' });
  }
  if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}
