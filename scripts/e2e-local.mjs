#!/usr/bin/env node

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 8000);
const API_PORT = Number(process.env.E2E_API_PORT || 3001);
const BASE_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const API_BASE_URL = `http://127.0.0.1:${API_PORT}/api/`;
const APP_QUERY = `?apiBaseUrl=${encodeURIComponent(API_BASE_URL)}&disableSocket=1`;
const HEADLESS = !process.argv.includes('--headed');

const LOCAL_ASSET_MAP = [
  {
    url: 'https://ajax.googleapis.com/ajax/libs/angularjs/1.8.2/angular.min.js',
    file: 'node_modules/angular/angular.min.js',
  },
  {
    url: 'https://ajax.googleapis.com/ajax/libs/angularjs/1.8.2/angular-route.min.js',
    file: 'node_modules/angular-route/angular-route.min.js',
  },
  {
    url: 'https://ajax.googleapis.com/ajax/libs/angularjs/1.8.2/angular-animate.min.js',
    file: 'node_modules/angular-animate/angular-animate.min.js',
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js',
    file: 'node_modules/moment/min/moment.min.js',
  },
  {
    url: 'https://cdn.socket.io/4.7.2/socket.io.min.js',
    file: 'node_modules/socket.io-client/dist/socket.io.min.js',
  },
];

const LOCAL_STUB_ASSET_MAP = new Map([
  [
    'https://cdn.tailwindcss.com',
    {
      contentType: 'application/javascript; charset=utf-8',
      body: 'window.tailwind = window.tailwind || {}; window.tailwind.config = window.tailwind.config || {};',
    },
  ],
  [
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    {
      contentType: 'text/css; charset=utf-8',
      body: '/* font awesome disabled for local e2e */',
    },
  ],
]);

const JS_FILES = [
  'app/app.js',
  'app/config/routes.js',
  'app/services/auth.service.js',
  'app/services/api.service.js',
  'app/services/room.service.js',
  'app/services/order.service.js',
  'app/services/menu.service.js',
  'app/services/payment.service.js',
  'app/services/staff.service.js',
  'app/services/storage.service.js',
  'app/services/sync.service.js',
  'app/services/socket.service.js',
  'app/services/audit.service.js',
  'app/services/attendance.service.js',
  'app/services/leave.service.js',
  'app/services/staff-panel.service.js',
  'app/services/inventory.service.js',
  'app/services/qrcode.service.js',
  'app/services/timebased.service.js',
  'app/services/notification.service.js',
  'app/moment.filter.js',
  'app/controllers/login.controller.js',
  'app/controllers/cashier.controller.js',
  'app/controllers/customer.controller.js',
  'app/controllers/waiter.controller.js',
  'app/controllers/kitchen.controller.js',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function minutesAgoIso(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function text(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return null;
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    return raw;
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function readLocalAsset(filePath) {
  return fs.readFile(path.join(ROOT, filePath), 'utf8');
}

function getLocalAssetResponse(url) {
  for (const [prefix, asset] of LOCAL_STUB_ASSET_MAP.entries()) {
    if (url.startsWith(prefix)) {
      return asset;
    }
  }

  const mapped = LOCAL_ASSET_MAP.find((entry) => url.startsWith(entry.url));
  if (!mapped) {
    return null;
  }

  return {
    contentType: 'application/javascript; charset=utf-8',
    file: mapped.file,
  };
}

async function validateLocalAssets() {
  const filePaths = LOCAL_ASSET_MAP.map((entry) => entry.file);
  for (const filePath of filePaths) {
    await fs.access(path.join(ROOT, filePath));
  }
}

function createState() {
  const openedAt = minutesAgoIso(95);
  const currentTime = nowIso();

  return {
    loginToken: 'local-e2e-token',
    user: {
      id: 'user-admin',
      username: 'admin',
      role: 'admin',
    },
    profile: {
      data: {
        user: {
          id: 'user-admin',
          username: 'admin',
          role: 'admin',
        },
        roles: [{ name: 'admin' }],
      },
    },
    products: [
      {
        id: 'prod-water',
        name: 'Nước suối',
        category: 'Nước uống',
        price: 10000,
        sellingPrice: 10000,
        unit: 'chai',
        code: 'WATER',
        isActive: true,
      },
    ],
    rooms: [
      {
        id: '1',
        name: 'Phòng A',
        code: 'A01',
        type: 'small',
        status: 'occupied',
        saleOrderId: 'so-1',
        startTime: openedAt,
        customerInfo: {
          name: 'Khách A',
          phone: '0900000001',
          numberOfGuests: 4,
        },
        updatedAt: currentTime,
      },
      {
        id: '2',
        name: 'Phòng B',
        code: 'B01',
        type: 'small',
        status: 'available',
        saleOrderId: null,
        startTime: null,
        customerInfo: null,
        updatedAt: currentTime,
      },
    ],
    saleorders: [
      {
        id: 'so-1',
        roomId: '1',
        orderDate: openedAt,
        deliveryDate: openedAt,
        type: 'W',
        status: 'pending',
        customerId: 'cust-1',
        deposit: 0,
        paidAmount: 0,
        discount: 0,
        total: 10000,
        note: 'E2E seed order',
        allowEditAfterPrint: false,
        printedAt: null,
        printedBillSnapshot: null,
        paymentMethod: null,
        updatedAt: currentTime,
      },
    ],
    saleorderitems: [
      {
        id: 'sopi-1',
        saleOrderId: 'so-1',
        productId: 'prod-water',
        name: 'Nước suối',
        quantity: 1,
        unit: 'chai',
        unitPrice: 10000,
        price: 10000,
        total: 10000,
        note: '',
        isTimeBased: false,
        createdAt: openedAt,
        updatedAt: openedAt,
      },
    ],
    cfgs: [],
    models: [],
    logs: [],
    invoices: [],
    leaveRequests: [],
    attendances: [],
    finalizeCalls: [],
    requests: [],
  };
}

const state = createState();

function parseFilterParam(value) {
  if (!value) {
    return null;
  }

  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (err) {
    return null;
  }
}

function applyWhereFilter(items, where) {
  if (!where || typeof where !== 'object') {
    return items;
  }

  return items.filter((item) => {
    return Object.keys(where).every((key) => {
      const expected = where[key];
      const actual = item ? item[key] : undefined;

      if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        if (Object.prototype.hasOwnProperty.call(expected, 'inq') && Array.isArray(expected.inq)) {
          return expected.inq.some((value) => String(value) === String(actual));
        }
        if (Object.prototype.hasOwnProperty.call(expected, 'neq')) {
          return String(actual) !== String(expected.neq);
        }
        if (Object.prototype.hasOwnProperty.call(expected, 'gt')) {
          return Number(actual) > Number(expected.gt);
        }
        if (Object.prototype.hasOwnProperty.call(expected, 'gte')) {
          return Number(actual) >= Number(expected.gte);
        }
        if (Object.prototype.hasOwnProperty.call(expected, 'lt')) {
          return Number(actual) < Number(expected.lt);
        }
        if (Object.prototype.hasOwnProperty.call(expected, 'lte')) {
          return Number(actual) <= Number(expected.lte);
        }
      }

      return String(actual) === String(expected);
    });
  });
}

function getCollection(modelName) {
  const normalized = modelName.toLowerCase();

  if (normalized === 'users') return null;
  if (normalized === 'products') return state.products;
  if (normalized === 'rooms') return state.rooms;
  if (normalized === 'saleorders') return state.saleorders;
  if (normalized === 'saleorderitems') return state.saleorderitems;
  if (normalized === 'cfgs') return state.cfgs;
  if (normalized === 'models') return state.models;
  if (normalized === 'logs' || normalized === 'log') return state.logs;
  if (normalized === 'invoices') return state.invoices;
  if (normalized === 'leaverequests' || normalized === 'leaveRequests'.toLowerCase()) return state.leaveRequests;
  if (normalized === 'attendances' || normalized === 'attendance') return state.attendances;

  return null;
}

function upsertById(collection, id, patch) {
  const idx = collection.findIndex((item) => String(item.id) === String(id));
  if (idx === -1) {
    const created = Object.assign({ id: String(id) }, clone(patch));
    collection.push(created);
    return created;
  }

  collection[idx] = Object.assign({}, collection[idx], clone(patch));
  return collection[idx];
}

async function handleApiRequest(req, res) {
  const requestUrl = new URL(req.url, 'http://127.0.0.1');
  const pathname = requestUrl.pathname;
  const method = req.method.toUpperCase();

  state.requests.push({
    method,
    url: req.url,
    pathname,
    at: nowIso(),
  });

  if (method === 'OPTIONS') {
    return text(res, 204, '');
  }

  if (pathname === '/api/users/login' && method === 'POST') {
    const body = await readBody(req);
    if (body && body.username === 'admin' && body.password === 'admin') {
      return json(res, 200, {
        id: state.loginToken,
        user: clone(state.user),
      });
    }

    return json(res, 401, {
      error: {
        statusCode: 401,
        message: 'Invalid credentials',
      },
    });
  }

  if (pathname === '/api/users/profile' && method === 'GET') {
    return json(res, 200, clone(state.profile));
  }

  if (pathname === '/api/_models' && method === 'GET') {
    return json(res, 200, clone(state.models));
  }

  if (pathname === '/api/Cfgs' && method === 'GET') {
    return json(res, 200, clone(state.cfgs));
  }

  if (pathname === '/api/products' && method === 'GET') {
    return json(res, 200, clone(state.products));
  }

  if (pathname === '/api/rooms' && method === 'GET') {
    const filter = parseFilterParam(requestUrl.searchParams.get('filter'));
    let items = clone(state.rooms);
    if (filter && filter.where) {
      items = applyWhereFilter(items, filter.where);
    }
    return json(res, 200, items);
  }

  if (pathname === '/api/rooms/count' && method === 'GET') {
    return json(res, 200, { count: state.rooms.length });
  }

  if (pathname === '/api/saleorders' && method === 'GET') {
    const filter = parseFilterParam(requestUrl.searchParams.get('filter'));
    let items = clone(state.saleorders);
    if (filter && filter.where) {
      items = applyWhereFilter(items, filter.where);
    }
    return json(res, 200, items);
  }

  if (pathname === '/api/saleorders/count' && method === 'GET') {
    return json(res, 200, { count: state.saleorders.length });
  }

  if (pathname === '/api/saleorderitems' && method === 'GET') {
    const filter = parseFilterParam(requestUrl.searchParams.get('filter'));
    let items = clone(state.saleorderitems);
    if (filter && filter.where) {
      items = applyWhereFilter(items, filter.where);
    }
    return json(res, 200, items);
  }

  if (pathname === '/api/saleorderitems/count' && method === 'GET') {
    return json(res, 200, { count: state.saleorderitems.length });
  }

  if (pathname === '/api/log' && method === 'POST') {
    const body = await readBody(req);
    const created = Object.assign({ id: `log-${state.logs.length + 1}` }, clone(body));
    state.logs.push(created);
    return json(res, 200, created);
  }

  if (pathname === '/api/rooms' && method === 'POST') {
    const body = await readBody(req);
    const created = Object.assign({ id: String(Date.now()) }, clone(body));
    state.rooms.push(created);
    return json(res, 200, created);
  }

  const simpleCollectionMatch = pathname.match(/^\/api\/([^/]+)\/?$/i);
  if (simpleCollectionMatch) {
    const modelName = simpleCollectionMatch[1];
    const normalizedModel = modelName.toLowerCase();
    const collection = getCollection(normalizedModel);

    if (method === 'GET' && collection) {
      return json(res, 200, clone(collection));
    }

    if (method === 'POST' && collection) {
      const body = await readBody(req);
      const created = Object.assign({
        id: body && body.id ? String(body.id) : `${normalizedModel}-${collection.length + 1}`,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }, clone(body));
      collection.push(created);
      return json(res, 200, created);
    }
  }

  const countMatch = pathname.match(/^\/api\/([^/]+)\/count\/?$/i);
  if (countMatch && method === 'GET') {
    const collection = getCollection(countMatch[1]);
    return json(res, 200, { count: collection ? collection.length : 0 });
  }

  const collectionMatch = pathname.match(/^\/api\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/i);
  if (collectionMatch) {
    const modelName = collectionMatch[1];
    const recordId = collectionMatch[2];
    const remoteMethod = collectionMatch[3] || '';
    const normalizedModel = modelName.toLowerCase();

    if (remoteMethod.toLowerCase() === 'finalize-payment' && normalizedModel === 'rooms' && method === 'POST') {
      const room = state.rooms.find((item) => String(item.id) === String(recordId));
      if (!room) {
        return json(res, 404, {
          error: {
            statusCode: 404,
            message: 'Room not found',
          },
        });
      }

      const body = await readBody(req);
      const saleOrderId = body && body.saleOrderId ? String(body.saleOrderId) : String(room.saleOrderId || '');
      const saleOrder = state.saleorders.find((item) => String(item.id) === saleOrderId);

      if (!saleOrder) {
        return json(res, 404, {
          error: {
            statusCode: 404,
            message: 'SaleOrder not found',
          },
        });
      }

      const updatedAt = nowIso();
      saleOrder.roomId = String(room.id);
      saleOrder.status = 'completed';
      saleOrder.total = Number(body && body.totalAmount != null ? body.totalAmount : saleOrder.total || 0);
      saleOrder.paidAmount = Number(body && body.paymentReceived != null ? body.paymentReceived : saleOrder.total || 0);
      saleOrder.discount = Number(body && body.discount != null ? body.discount : saleOrder.discount || 0);
      saleOrder.paymentMethod = body && body.paymentMethod ? body.paymentMethod : saleOrder.paymentMethod || 'cash';
      saleOrder.updatedAt = updatedAt;

      room.status = 'cleaning';
      room.saleOrderId = null;
      room.startTime = null;
      room.customerInfo = null;
      room.updatedAt = updatedAt;

      const invoice = {
        id: `inv-${state.invoices.length + 1}`,
        invoiceNumber: `HD${String(state.invoices.length + 1).padStart(3, '0')}`,
        saleOrderId,
        roomId: String(room.id),
        totalAmount: Number(body && body.totalAmount != null ? body.totalAmount : 0),
        status: 'paid',
        printedAt: body && body.printedAt ? body.printedAt : null,
        createdAt: updatedAt,
        updatedAt,
      };
      state.invoices.push(invoice);
      state.finalizeCalls.push({
        roomId: String(room.id),
        saleOrderId,
        payload: clone(body),
        at: updatedAt,
      });

      return json(res, 200, {
        success: true,
        idempotent: false,
        invoice,
        room: clone(room),
        roomId: String(room.id),
        saleOrderId,
      });
    }

    if (method === 'GET') {
      const collection = getCollection(normalizedModel);
      if (!collection) {
        return json(res, 404, {
          error: {
            statusCode: 404,
            message: `Unknown model: ${modelName}`,
          },
        });
      }

      const found = collection.find((item) => String(item.id) === String(recordId));
      if (!found) {
        return json(res, 404, {
          error: {
            statusCode: 404,
            message: `${modelName} not found`,
          },
        });
      }

      return json(res, 200, clone(found));
    }

    if (method === 'PUT' || method === 'PATCH') {
      const collection = getCollection(normalizedModel);
      if (!collection) {
        return json(res, 404, {
          error: {
            statusCode: 404,
            message: `Unknown model: ${modelName}`,
          },
        });
      }

      const body = await readBody(req);
      const updated = upsertById(collection, recordId, body || {});
      updated.id = String(recordId);
      updated.updatedAt = body && body.updatedAt ? body.updatedAt : nowIso();

      if (normalizedModel === 'rooms') {
        const room = updated;
        const saleOrder = room.saleOrderId
          ? state.saleorders.find((item) => String(item.id) === String(room.saleOrderId))
          : null;

        if (saleOrder && body && Object.prototype.hasOwnProperty.call(body, 'saleOrderId')) {
          saleOrder.roomId = room.saleOrderId ? String(room.id) : saleOrder.roomId;
          saleOrder.updatedAt = updated.updatedAt;
        }
      }

      return json(res, 200, clone(updated));
    }

    if (method === 'DELETE') {
      const collection = getCollection(normalizedModel);
      if (!collection) {
        return json(res, 404, {
          error: {
            statusCode: 404,
            message: `Unknown model: ${modelName}`,
          },
        });
      }

      const idx = collection.findIndex((item) => String(item.id) === String(recordId));
      if (idx >= 0) {
        const removed = collection.splice(idx, 1)[0];
        return json(res, 200, clone(removed));
      }

      return json(res, 404, {
        error: {
          statusCode: 404,
          message: `${modelName} not found`,
        },
      });
    }
  }

  return json(res, 404, {
    error: {
      statusCode: 404,
      message: `Unhandled mock API route: ${method} ${pathname}`,
    },
  });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.ico': return 'image/x-icon';
    case '.map': return 'application/json; charset=utf-8';
    default: return 'text/plain; charset=utf-8';
  }
}

async function handleFrontendRequest(req, res) {
  const requestUrl = new URL(req.url, BASE_URL);
  let pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === '/' || pathname === '' || pathname === '/index.html') {
    const indexPath = path.join(ROOT, 'index.html');
    try {
      const html = await fs.readFile(indexPath, 'utf8');
      const scriptTags = JS_FILES.map((relPath) => `    <script src="${relPath}"></script>`).join('\n');
      const devHtml = html.replace(
        /<!-- App Scripts \(bundled\) -->[\s\S]*?<!-- Service Worker Registration -->/,
        `<!-- App Scripts (local e2e) -->\n${scriptTags}\n\n    <!-- Service Worker Registration -->`
      );
      return text(res, 200, devHtml, 'text/html; charset=utf-8');
    } catch (err) {
      return text(res, 404, 'Not found');
    }
  }

  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    return text(res, 403, 'Forbidden');
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      const contents = await fs.readFile(indexPath);
      return text(res, 200, contents.toString('utf8'), contentTypeFor(indexPath));
    }

    const contents = await fs.readFile(filePath);
    return text(res, 200, contents.toString('utf8'), contentTypeFor(filePath));
  } catch (err) {
    if (pathname !== '/index.html') {
      const indexPath = path.join(ROOT, 'index.html');
      try {
        const contents = await fs.readFile(indexPath);
        return text(res, 200, contents.toString('utf8'), 'text/html; charset=utf-8');
      } catch (indexErr) {
        return text(res, 404, 'Not found');
      }
    }

    return text(res, 404, 'Not found');
  }
}

function startServer(port, handler, name) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      Promise.resolve(handler(req, res)).catch((error) => {
        console.error(`[${name}] request failed:`, error);
        if (!res.headersSent) {
          json(res, 500, {
            error: {
              statusCode: 500,
              message: error && error.message ? error.message : 'Internal server error',
            },
          });
        } else {
          res.end();
        }
      });
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      console.log(`[${name}] listening on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

async function waitForCondition(check, timeoutMs = 15000, intervalMs = 100) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check();
      if (value) {
        return value;
      }
    } catch (err) {
      // keep polling
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function main() {
  await validateLocalAssets();
  const frontendServer = await startServer(FRONTEND_PORT, handleFrontendRequest, 'frontend');
  const apiServer = await startServer(API_PORT, handleApiRequest, 'api-mock');

  let browser;

  try {
    browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 1440, height: 900 },
    });

    const page = await context.newPage();
    const forbiddenRequests = [];

    await context.addInitScript(() => {
      window.addEventListener('error', (event) => {
        const details = {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        };
        try {
          // eslint-disable-next-line no-console
          console.error('[window.error]', JSON.stringify(details));
        } catch (_) {
          // ignore
        }
      });

      window.addEventListener('unhandledrejection', (event) => {
        try {
          // eslint-disable-next-line no-console
          console.error('[window.unhandledrejection]', event.reason && event.reason.stack ? event.reason.stack : String(event.reason));
        } catch (_) {
          // ignore
        }
      });
    });

    await context.route('**/*', (route) => {
      const url = route.request().url();
      const localAsset = getLocalAssetResponse(url);
      if (localAsset) {
        if (localAsset.file) {
          return readLocalAsset(localAsset.file)
            .then((body) => route.fulfill({
              status: 200,
              contentType: localAsset.contentType,
              body,
            }))
            .catch((error) => {
              console.error('[e2e] failed to load local asset:', localAsset.file, error);
              return route.abort('failed');
            });
        }

        return route.fulfill({
          status: 200,
          contentType: localAsset.contentType,
          body: localAsset.body,
        });
      }

      if (url.includes('kara.test.live1.vn') || url.includes('kara.app.live1.vn') || url.includes('cdn.live1.vn')) {
        forbiddenRequests.push(url);
        return route.abort();
      }

      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost') && !url.startsWith('http://[::1]')) {
        forbiddenRequests.push(url);
        return route.abort();
      }

      return route.continue();
    });

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    page.on('pageerror', (error) => {
      console.error('[browser pageerror]', error.stack || error.message || String(error));
    });

    page.on('requestfailed', (request) => {
      const url = request.url();
      if (!url.includes('favicon.ico')) {
        console.warn('[browser requestfailed]', request.method(), url, request.failure() && request.failure().errorText);
      }
    });

    page.on('console', (message) => {
      if (message.type() === 'error') {
        console.error('[browser console error]', message.text());
      }
    });

    const targetUrl = `${BASE_URL}/${APP_QUERY}#/login`;
    console.log('[e2e] opening', targetUrl);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    await page.getByPlaceholder('Nhập tên đăng nhập').fill('admin');
    await page.getByPlaceholder('Nhập mật khẩu').fill('admin');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await page.waitForURL((url) => url.hash.includes('/cashier'), { timeout: 30000 });
    await page.getByText('Thu Ngân - POS').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByText('Phòng A').waitFor({ state: 'visible', timeout: 30000 });

    const roomCard = page
      .locator('[ng-click="!editBillMode && selectRoom(room)"]')
      .filter({ hasText: 'Phòng A' })
      .first();
    await roomCard.click();

    await page.getByText('Phòng A').waitFor({ state: 'visible', timeout: 30000 });

    await page.getByRole('button', { name: 'Đổi phòng' }).click();
    await page.getByText('Đổi phòng: Phòng A').waitFor({ state: 'visible', timeout: 30000 });

    const roomTransferCard = page
      .locator('#changeRoomModal [ng-click="changeRoom(room)"]')
      .filter({ hasText: 'Phòng B' })
      .first();
    await roomTransferCard.click();

    await waitForCondition(() => {
      const saleOrder = state.saleorders.find((item) => String(item.id) === 'so-1');
      return saleOrder && String(saleOrder.roomId) === '2';
    }, 20000);

    await waitForCondition(() => {
      const roomB = state.rooms.find((item) => String(item.id) === '2');
      const roomA = state.rooms.find((item) => String(item.id) === '1');
      return roomA && roomB && roomA.status === 'cleaning' && roomB.status === 'occupied';
    }, 20000);

    await page.getByRole('button', { name: 'Thanh toán', exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận thanh toán', exact: true }).click();

    await waitForCondition(() => state.finalizeCalls.length > 0, 20000);

    const saleOrder = state.saleorders.find((item) => String(item.id) === 'so-1');
    assert.ok(saleOrder, 'SaleOrder should exist after transfer');
    assert.equal(String(saleOrder.roomId), '2', 'SaleOrder.roomId should follow the transferred room');
    assert.equal(state.finalizeCalls.length, 1, 'finalize-payment should be called exactly once');
    assert.equal(String(state.finalizeCalls[0].roomId), '2', 'finalize-payment should use the current room');
    assert.equal(String(state.finalizeCalls[0].saleOrderId), 'so-1', 'finalize-payment should keep the same saleOrderId');

    assert.equal(forbiddenRequests.length, 0, `Unexpected external/prod requests: ${forbiddenRequests.join(', ')}`);

    console.log('[e2e] ok - transfer and payment stayed local');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }

    await Promise.all([
      new Promise((resolve) => frontendServer.close(resolve)),
      new Promise((resolve) => apiServer.close(resolve)),
    ]).catch(() => {});
  }
}

main().catch((error) => {
  console.error('[e2e] failed:', error);
  process.exitCode = 1;
});
