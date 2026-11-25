import { getLanguage, getMonthsShort, t } from './i18n.js';

function toValidDate(input) {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (input === null || input === undefined || input === '') return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatRupiah(n) {
  const rounded = Math.round(Number(n) || 0);
  const absStr = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (rounded < 0 ? '-Rp ' : 'Rp ') + absStr;
}

export function formatCompactRupiah(n) {
  const num = Math.round(Number(n) || 0);
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  const isEn = getLanguage() === 'en';

  if (abs >= 1_000_000) {
    const rawVal = (abs / 1_000_000).toFixed(1).replace(/\.0$/, '');
    const val = isEn ? rawVal : rawVal.replace('.', ',');
    return `${sign}Rp ${val}${t('utils.compactJt')}`;
  }
  if (abs >= 1_000) {
    const val = Math.round(abs / 1_000);
    return `${sign}Rp ${val}${t('utils.compactRb')}`;
  }
  return `${sign}Rp ${abs}`;
}

export function parseRupiahInput(str) {
  const digits = String(str ?? '').replace(/[^\d]/g, '');
  if (!digits) return 0;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatTime(iso) {
  const d = toValidDate(iso);
  if (!d) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatDateShort(iso) {
  const d = toValidDate(iso);
  if (!d) return '-';
  const day = d.getDate();
  const months = getMonthsShort();
  const month = months[d.getMonth()];
  if (getLanguage() === 'en') {
    return `${month} ${day}`;
  }
  return `${day} ${month}`;
}

export function formatDateTime(iso) {
  const d = toValidDate(iso);
  if (!d) return '-';
  const months = getMonthsShort();
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  if (getLanguage() === 'en') {
    return `${month} ${d.getDate()}, ${year}, ${formatTime(d)}`;
  }
  const day = String(d.getDate()).padStart(2, '0');
  return `${day} ${month} ${year}, ${formatTime(d)}`;
}

export function getLocalDateKey(date = new Date()) {
  const d = toValidDate(date);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isSameLocalDay(isoA, dateB = new Date()) {
  const keyA = getLocalDateKey(isoA);
  const keyB = getLocalDateKey(dateB);
  return Boolean(keyA && keyB && keyA === keyB);
}

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

export function formatTransactionCode(txOrReceiptNo) {
  const raw =
    typeof txOrReceiptNo === 'string'
      ? txOrReceiptNo
      : String(txOrReceiptNo?.receiptNo || txOrReceiptNo?.id || '');
  const clean = raw.trim();
  if (!clean) return '-';

  const hashMatch = clean.match(/^#(\d{1,6})$/);
  if (hashMatch) {
    return `#${hashMatch[1].padStart(3, '0')}`;
  }

  const tailMatch = clean.match(/(?:^|[-_])(\d{1,6})$/);
  if (tailMatch) {
    return `#${tailMatch[1].padStart(3, '0')}`;
  }

  return clean;
}

export function uid(prefix = 'id') {
  const safePrefix = String(prefix || 'id').replace(/[^a-zA-Z0-9_-]/g, '');
  const timePart = Date.now().toString(36);
  const randPart = Math.random().toString(36).slice(2, 7);
  return `${safePrefix}_${timePart}_${randPart}`;
}

export function clamp(n, min, max) {
  const val = Number(n);
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
}

export function debounce(fn, ms = 180) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}

export function compressImageFile(file, maxSize = 320, quality = 0.78) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      reject(new Error(t('utils.imgInvalidType')));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error(t('utils.imgTooLarge')));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('utils.imgReadError')));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(t('utils.imgUnsupported')));
      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          if (!width || !height) {
            reject(new Error(t('utils.imgInvalidDim')));
            return;
          }
          const scale = Math.min(1, maxSize / Math.max(width, height));
          const targetW = Math.max(1, Math.round(width * scale));
          const targetH = Math.max(1, Math.round(height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error(t('utils.imgNoCanvas')));
            return;
          }
          ctx.drawImage(img, 0, 0, targetW, targetH);

          let dataUrl = canvas.toDataURL('image/webp', quality);
          if (!dataUrl.startsWith('data:image/webp')) {
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, fn) {
    if (typeof fn !== 'function') return () => {};
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this._listeners.get(event);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) {
      this._listeners.delete(event);
    }
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus:${event}] listener error:`, err);
      }
    }
  }
}

export const bus = new EventBus();
