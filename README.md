<div align="center">

# AruPOS

**A fast, offline-first point of sale for small shops.**
Cashier, products, history, and reports — in one installable web app that keeps working without internet and syncs to the cloud when you're back online.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-aruchy.github.io%2Farupos-0D9488?style=for-the-badge)](https://aruchy.github.io/arupos/)
[![PWA](https://img.shields.io/badge/PWA-Installable-5A0FC8?style=for-the-badge)](https://aruchy.github.io/arupos/)
[![Firebase](https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com/)
[![No Build Step](https://img.shields.io/badge/Build-None%20Needed-333333?style=for-the-badge)](#getting-started)

</div>

---

## Features

- **Cashier** — product grid with search & category chips, cart with item/order discounts (percent or fixed), service charge & tax toggles, and four payment methods (cash, QRIS, transfer, e-wallet).
- **Receipts** — clean monospace receipts with daily sequence numbers (`#001`, `#002`, …), in Indonesian or English.
- **Products & categories** — full CRUD, stock tracking, monochrome SVG icons with soft per-category color tints, and three view modes (grid, compact grid, list).
- **History** — grouped filters by date, status, and payment method; void transactions with automatic stock rollback.
- **Reports** — daily revenue, transaction count, average ticket, and items sold, computed live from your data.
- **Offline-first** — everything works without a connection. Data lives in a persistent local cache and syncs to Firestore automatically when you're back online, with a live sync status indicator.
- **Google sign-in** — each shop signs in with its own Google account; data is isolated per user with Firestore security rules.
- **First-run wizard** — new accounts start empty and set up their store name in seconds; existing local data can be imported on first sign-in.
- **Export** — full JSON archive, transactions CSV, and products & stock CSV (UTF-8 BOM, ready for spreadsheets and bookkeeping).
- **Make it yours** — four accent colors (Emerald, Amber, Burgundy, Sapphire), light & dark themes with smooth transitions, Indonesian/English UI, Plus Jakarta Sans bundled locally.

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — no framework, no build step |
| Fonts | Plus Jakarta Sans (bundled locally, works offline) |
| Backend | Firebase Authentication (Google) + Cloud Firestore |
| Offline | Service Worker app shell + Firestore persistent local cache |
| Hosting | GitHub Pages (static) |

## Getting Started

AruPOS is a static site. Serve the folder with any static server:

```bash
git clone https://github.com/aruchy/arupos.git
cd arupos
python3 -m http.server 8765
# open http://localhost:8765
```

### Connect your own Firebase project

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Authentication → Google** sign-in provider.
3. Create a **Cloud Firestore** database (production mode).
4. Register a **Web app** and copy its config into `js/firebase.js`.
5. Publish the security rules from [`firestore.rules`](firestore.rules) — each user can only read and write their own data under `users/{uid}/…`.
6. Add your hosting domain under **Authentication → Settings → Authorized domains**.

> Tip: restrict your Firebase API key to your own domains in Google Cloud Console (**APIs & Services → Credentials → Browser key → Application restrictions → Websites**) so the key can't be used from other sites.

## Project Structure

```
├── index.html              # App shell + auth screen
├── manifest.webmanifest    # PWA manifest
├── sw.js                   # Service worker (offline app shell)
├── firestore.rules         # Firestore security rules
├── css/                    # Design tokens + styles
├── js/
│   ├── app.js              # App bootstrap & routing
│   ├── firebase.js         # Firebase init, auth, cloud session
│   ├── store.js            # Data layer (Firestore + local cache)
│   ├── cart.js             # Cart math (discounts, totals)
│   ├── receipt.js          # Receipt rendering
│   ├── wizard.js           # First-run setup wizard
│   ├── migration.js        # Local → cloud import
│   ├── i18n.js             # Indonesian / English strings
│   └── views/              # Cashier, products, history, reports, settings
└── assets/                 # Icons & fonts
```

## Data Model

```
users/{uid}/
├── products/{id}       # name, price, stock, categoryId, sku
├── categories/{id}     # name, icon, color
├── transactions/{id}   # items, totals, payment method, status
└── settings/store      # store name, receipt info, preferences
```

---

<div align="center">

Made with care for small shops, warungs, and anyone who just needs a cashier that works.

**[Try AruPOS →](https://aruchy.github.io/arupos/)**

</div>
