import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  persistentSingleTabManager,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  onSnapshotsInSync,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyABvg_vwmneljD_QtUaowubmp42gK1HTHg',
  authDomain: 'arupos.firebaseapp.com',
  projectId: 'arupos',
  storageBucket: 'arupos.firebasestorage.app',
  messagingSenderId: '562921486021',
  appId: '1:562921486021:web:54bef0d9fda5ab9183a2ac',
};

const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[AruPOS Firebase] Auth persistence setup warning:', err);
});

function createFirestoreInstance() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (err) {
    try {
      return initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentSingleTabManager({}),
        }),
      });
    } catch {
      return getFirestore(app);
    }
  }
}

export const db = createFirestoreInstance();

function sanitizeForFirestore(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => sanitizeForFirestore(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = sanitizeForFirestore(v);
    }
    return out;
  }
  return value;
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const cred = await signInWithPopup(auth, provider);
    return { ok: true, method: 'popup', user: cred.user };
  } catch (err) {
    const code = err?.code || '';
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, provider);
      return { ok: true, method: 'redirect', user: null };
    }
    throw err;
  }
}

export async function resolveRedirectLogin() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { user: null, error: null };
  }
  try {
    const cred = await getRedirectResult(auth);
    return { user: cred?.user || null, error: null };
  } catch (err) {
    return { user: null, error: err };
  }
}

export async function signOutUser() {
  await signOut(auth);
}

export function subscribeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function createFirestoreAdapter(uid) {
  if (!uid) {
    throw new Error('User UID is required for Firestore adapter.');
  }

  const settingsRef = doc(db, 'users', uid, 'settings', 'store');
  const categoriesCol = collection(db, 'users', uid, 'categories');
  const productsCol = collection(db, 'users', uid, 'products');
  const transactionsCol = collection(db, 'users', uid, 'transactions');

  return {
    uid,

    async fetchInitialCloudData() {
      const [settingsSnap, categoriesSnap, productsSnap, transactionsSnap] = await Promise.all([
        getDoc(settingsRef),
        getDocs(categoriesCol),
        getDocs(productsCol),
        getDocs(transactionsCol),
      ]);

      return {
        settings: settingsSnap.exists() ? settingsSnap.data() : null,
        categories: categoriesSnap.docs.map((d) => ({ ...d.data(), id: d.id })),
        products: productsSnap.docs.map((d) => ({ ...d.data(), id: d.id })),
        transactions: transactionsSnap.docs.map((d) => ({ ...d.data(), id: d.id })),
      };
    },

    openSession({
      onSettings,
      onCategories,
      onProducts,
      onTransactions,
      onSyncChange,
      onError,
    } = {}) {
      return new Promise((resolve, reject) => {
        const initial = {
          settings: null,
          categories: [],
          products: [],
          transactions: [],
        };
        const seen = {
          settings: false,
          categories: false,
          products: false,
          transactions: false,
        };
        const serverSeen = {
          settings: false,
          categories: false,
          products: false,
          transactions: false,
        };
        const pendingBySource = {
          settings: false,
          categories: false,
          products: false,
          transactions: false,
        };
        const fromCacheBySource = {
          settings: false,
          categories: false,
          products: false,
          transactions: false,
        };

        let settled = false;
        let unsubscribed = false;
        let timeoutId = null;

        let unsubSettings = () => {};
        let unsubCategories = () => {};
        let unsubProducts = () => {};
        let unsubTransactions = () => {};
        let unsubInSync = () => {};

        const emitSync = (forceSyncedTime = false) => {
          if (!settled || typeof onSyncChange !== 'function') return;
          const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
          const pendingWrites = Object.values(pendingBySource).some(Boolean);
          const fromCache = Object.values(fromCacheBySource).every(Boolean);
          onSyncChange({
            offline,
            pendingWrites,
            fromCache,
            syncedAt: !offline && !pendingWrites && forceSyncedTime ? new Date().toISOString() : null,
          });
        };

        const onNetworkChange = () => emitSync(navigator.onLine !== false);

        const unsubscribe = () => {
          if (unsubscribed) return;
          unsubscribed = true;
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          unsubSettings();
          unsubCategories();
          unsubProducts();
          unsubTransactions();
          unsubInSync();
          if (typeof window !== 'undefined') {
            window.removeEventListener('online', onNetworkChange);
            window.removeEventListener('offline', onNetworkChange);
          }
        };

        const tryResolveInitial = () => {
          if (settled) return;
          const allSeen = Object.values(seen).every(Boolean);
          if (!allSeen) return;

          const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
          const allServerSeen = Object.values(serverSeen).every(Boolean);
          const hasCompletedSettings = Boolean(
            initial.settings &&
              (initial.settings.setupCompleted === true || String(initial.settings.storeName || '').trim() !== '')
          );

          if (offline || hasCompletedSettings || allServerSeen) {
            settled = true;
            if (timeoutId !== null) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            resolve({ initialData: initial, unsubscribe });
            emitSync(!offline && !Object.values(pendingBySource).some(Boolean));
          }
        };

        const handleErr = (source) => (err) => {
          console.error(`[AruPOS Firestore:${source}]`, err);
          if (!settled) {
            settled = true;
            unsubscribe();
            reject(err);
            return;
          }
          if (typeof onError === 'function') {
            onError(err, source);
          }
        };

        unsubSettings = onSnapshot(
          settingsRef,
          { includeMetadataChanges: true },
          (snap) => {
            pendingBySource.settings = Boolean(snap.metadata?.hasPendingWrites);
            fromCacheBySource.settings = Boolean(snap.metadata?.fromCache);
            const data = snap.exists() ? snap.data() : null;
            if (!settled) {
              seen.settings = true;
              if (!snap.metadata?.fromCache) serverSeen.settings = true;
              initial.settings = data;
              tryResolveInitial();
            } else {
              if (snap.exists() && typeof onSettings === 'function') {
                onSettings(data, snap.metadata);
              }
              emitSync(false);
            }
          },
          handleErr('settings')
        );

        unsubCategories = onSnapshot(
          categoriesCol,
          { includeMetadataChanges: true },
          (snap) => {
            pendingBySource.categories = Boolean(snap.metadata?.hasPendingWrites);
            fromCacheBySource.categories = Boolean(snap.metadata?.fromCache);
            const docs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
            if (!settled) {
              seen.categories = true;
              if (!snap.metadata?.fromCache) serverSeen.categories = true;
              initial.categories = docs;
              tryResolveInitial();
            } else {
              if (typeof onCategories === 'function') {
                onCategories(docs, snap.metadata);
              }
              emitSync(false);
            }
          },
          handleErr('categories')
        );

        unsubProducts = onSnapshot(
          productsCol,
          { includeMetadataChanges: true },
          (snap) => {
            pendingBySource.products = Boolean(snap.metadata?.hasPendingWrites);
            fromCacheBySource.products = Boolean(snap.metadata?.fromCache);
            const docs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
            if (!settled) {
              seen.products = true;
              if (!snap.metadata?.fromCache) serverSeen.products = true;
              initial.products = docs;
              tryResolveInitial();
            } else {
              if (typeof onProducts === 'function') {
                onProducts(docs, snap.metadata);
              }
              emitSync(false);
            }
          },
          handleErr('products')
        );

        unsubTransactions = onSnapshot(
          transactionsCol,
          { includeMetadataChanges: true },
          (snap) => {
            pendingBySource.transactions = Boolean(snap.metadata?.hasPendingWrites);
            fromCacheBySource.transactions = Boolean(snap.metadata?.fromCache);
            const docs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
            if (!settled) {
              seen.transactions = true;
              if (!snap.metadata?.fromCache) serverSeen.transactions = true;
              initial.transactions = docs;
              tryResolveInitial();
            } else {
              if (typeof onTransactions === 'function') {
                onTransactions(docs, snap.metadata);
              }
              emitSync(false);
            }
          },
          handleErr('transactions')
        );

        unsubInSync = onSnapshotsInSync(db, () => {
          const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
          const pendingWrites = Object.values(pendingBySource).some(Boolean);
          emitSync(!offline && !pendingWrites);
        });

        if (typeof window !== 'undefined') {
          window.addEventListener('online', onNetworkChange);
          window.addEventListener('offline', onNetworkChange);
        }

        timeoutId = setTimeout(() => {
          timeoutId = null;
          if (settled) return;
          if (Object.values(seen).every(Boolean)) {
            settled = true;
            resolve({ initialData: initial, unsubscribe });
            emitSync(false);
          } else {
            settled = true;
            unsubscribe();
            const timeoutErr = new Error('Network timeout');
            timeoutErr.code = 'unavailable';
            reject(timeoutErr);
          }
        }, 12000);
      });
    },

    subscribeAll({
      onSettings,
      onCategories,
      onProducts,
      onTransactions,
      onSyncChange,
      onError,
    } = {}) {
      const pendingBySource = {
        settings: false,
        categories: false,
        products: false,
        transactions: false,
      };
      const fromCacheBySource = {
        settings: false,
        categories: false,
        products: false,
        transactions: false,
      };

      const emitSync = (forceSyncedTime = false) => {
        if (typeof onSyncChange !== 'function') return;
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        const pendingWrites = Object.values(pendingBySource).some(Boolean);
        const fromCache = Object.values(fromCacheBySource).every(Boolean);
        onSyncChange({
          offline,
          pendingWrites,
          fromCache,
          syncedAt: !offline && !pendingWrites && forceSyncedTime ? new Date().toISOString() : null,
        });
      };

      const handleErr = (source) => (err) => {
        console.error(`[AruPOS Firestore:${source}]`, err);
        if (typeof onError === 'function') {
          onError(err, source);
        }
      };

      const unsubSettings = onSnapshot(
        settingsRef,
        { includeMetadataChanges: true },
        (snap) => {
          pendingBySource.settings = Boolean(snap.metadata?.hasPendingWrites);
          fromCacheBySource.settings = Boolean(snap.metadata?.fromCache);
          if (snap.exists() && typeof onSettings === 'function') {
            onSettings(snap.data(), snap.metadata);
          }
          emitSync(false);
        },
        handleErr('settings')
      );

      const unsubCategories = onSnapshot(
        categoriesCol,
        { includeMetadataChanges: true },
        (snap) => {
          pendingBySource.categories = Boolean(snap.metadata?.hasPendingWrites);
          fromCacheBySource.categories = Boolean(snap.metadata?.fromCache);
          if (typeof onCategories === 'function') {
            onCategories(
              snap.docs.map((d) => ({ ...d.data(), id: d.id })),
              snap.metadata
            );
          }
          emitSync(false);
        },
        handleErr('categories')
      );

      const unsubProducts = onSnapshot(
        productsCol,
        { includeMetadataChanges: true },
        (snap) => {
          pendingBySource.products = Boolean(snap.metadata?.hasPendingWrites);
          fromCacheBySource.products = Boolean(snap.metadata?.fromCache);
          if (typeof onProducts === 'function') {
            onProducts(
              snap.docs.map((d) => ({ ...d.data(), id: d.id })),
              snap.metadata
            );
          }
          emitSync(false);
        },
        handleErr('products')
      );

      const unsubTransactions = onSnapshot(
        transactionsCol,
        { includeMetadataChanges: true },
        (snap) => {
          pendingBySource.transactions = Boolean(snap.metadata?.hasPendingWrites);
          fromCacheBySource.transactions = Boolean(snap.metadata?.fromCache);
          if (typeof onTransactions === 'function') {
            onTransactions(
              snap.docs.map((d) => ({ ...d.data(), id: d.id })),
              snap.metadata
            );
          }
          emitSync(false);
        },
        handleErr('transactions')
      );

      const unsubInSync = onSnapshotsInSync(db, () => {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        const pendingWrites = Object.values(pendingBySource).some(Boolean);
        emitSync(!offline && !pendingWrites);
      });

      const onNetworkChange = () => emitSync(navigator.onLine !== false);
      if (typeof window !== 'undefined') {
        window.addEventListener('online', onNetworkChange);
        window.addEventListener('offline', onNetworkChange);
      }

      emitSync(typeof navigator === 'undefined' || navigator.onLine !== false);

      return () => {
        unsubSettings();
        unsubCategories();
        unsubProducts();
        unsubTransactions();
        unsubInSync();
        if (typeof window !== 'undefined') {
          window.removeEventListener('online', onNetworkChange);
          window.removeEventListener('offline', onNetworkChange);
        }
      };
    },

    async saveSettings(settingsObj) {
      await setDoc(settingsRef, sanitizeForFirestore(settingsObj), { merge: true });
    },

    async saveProduct(product) {
      await setDoc(doc(productsCol, product.id), sanitizeForFirestore(product));
    },

    async deleteProduct(id) {
      await deleteDoc(doc(productsCol, id));
    },

    async saveCategory(category) {
      await setDoc(doc(categoriesCol, category.id), sanitizeForFirestore(category));
    },

    async deleteCategoryWithReassign(catId, updatedProducts = []) {
      const batch = writeBatch(db);
      batch.delete(doc(categoriesCol, catId));
      for (const prod of updatedProducts) {
        batch.set(doc(productsCol, prod.id), sanitizeForFirestore(prod));
      }
      await batch.commit();
    },

    async saveTransactionAndProducts(tx, updatedProducts = []) {
      const batch = writeBatch(db);
      batch.set(doc(transactionsCol, tx.id), sanitizeForFirestore(tx));
      for (const prod of updatedProducts) {
        batch.set(doc(productsCol, prod.id), sanitizeForFirestore(prod));
      }
      await batch.commit();
    },

    async writeFullDataset({ settings, categories, products, transactions }, existingIds = null) {
      const ops = [];

      if (settings) {
        ops.push({ type: 'set', ref: settingsRef, data: sanitizeForFirestore(settings) });
      }

      const nextCatIds = new Set();
      for (const cat of categories || []) {
        nextCatIds.add(cat.id);
        ops.push({ type: 'set', ref: doc(categoriesCol, cat.id), data: sanitizeForFirestore(cat) });
      }
      for (const oldId of existingIds?.categoryIds || []) {
        if (!nextCatIds.has(oldId)) {
          ops.push({ type: 'delete', ref: doc(categoriesCol, oldId) });
        }
      }

      const nextProdIds = new Set();
      for (const prod of products || []) {
        nextProdIds.add(prod.id);
        ops.push({ type: 'set', ref: doc(productsCol, prod.id), data: sanitizeForFirestore(prod) });
      }
      for (const oldId of existingIds?.productIds || []) {
        if (!nextProdIds.has(oldId)) {
          ops.push({ type: 'delete', ref: doc(productsCol, oldId) });
        }
      }

      const nextTxIds = new Set();
      for (const tx of transactions || []) {
        nextTxIds.add(tx.id);
        ops.push({ type: 'set', ref: doc(transactionsCol, tx.id), data: sanitizeForFirestore(tx) });
      }
      for (const oldId of existingIds?.transactionIds || []) {
        if (!nextTxIds.has(oldId)) {
          ops.push({ type: 'delete', ref: doc(transactionsCol, oldId) });
        }
      }

      const BATCH_LIMIT = 450;
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const chunk = ops.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);
        for (const op of chunk) {
          if (op.type === 'delete') {
            batch.delete(op.ref);
          } else {
            batch.set(op.ref, op.data);
          }
        }
        await batch.commit();
      }
    },

    async deleteSampleDocs({
      productIds = [],
      transactionIds = [],
      categoryIds = [],
      upsertCategories = [],
    } = {}) {
      const ops = [];
      for (const pid of productIds) {
        ops.push({ type: 'delete', ref: doc(productsCol, pid) });
      }
      for (const txId of transactionIds) {
        ops.push({ type: 'delete', ref: doc(transactionsCol, txId) });
      }
      for (const cid of categoryIds) {
        ops.push({ type: 'delete', ref: doc(categoriesCol, cid) });
      }
      for (const cat of upsertCategories) {
        ops.push({ type: 'set', ref: doc(categoriesCol, cat.id), data: sanitizeForFirestore(cat) });
      }

      const BATCH_LIMIT = 450;
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const chunk = ops.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);
        for (const op of chunk) {
          if (op.type === 'delete') {
            batch.delete(op.ref);
          } else {
            batch.set(op.ref, op.data);
          }
        }
        await batch.commit();
      }
    },
  };
}
