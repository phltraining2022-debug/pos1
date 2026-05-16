#!/usr/bin/env node
/**
 * build.js — Zero-dependency JS bundler for kara2
 * Usage: node build.js
 *
 * Reads APP_VERSION from app/app.js, concatenates all app JS files
 * into dist/app.bundle.js, then updates index.html with a single
 * cache-busting script tag.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// JS files in load order (must match original index.html order)
const JS_FILES = [
    'app/app.js',
    'app/config/routes.js',
    // Services
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
    // Filters
    'app/moment.filter.js',
    // Controllers
    'app/controllers/login.controller.js',
    'app/controllers/cashier.controller.js',
    'app/controllers/customer.controller.js',
    'app/controllers/waiter.controller.js',
    'app/controllers/kitchen.controller.js',
];

// Read APP_VERSION from app/app.js
function getAppVersion() {
    try {
        const src = fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8');
        const match = src.match(/var\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
        if (match) return match[1];
    } catch (e) { /* fall through */ }
    return new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
}

// Concatenate all JS files into one bundle
function buildBundle(version) {
    const distDir = path.join(ROOT, 'dist');
    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }

    const parts = [];
    for (const relPath of JS_FILES) {
        const absPath = path.join(ROOT, relPath);
        if (!fs.existsSync(absPath)) {
            console.warn('  [WARN] Missing file (skipped):', relPath);
            continue;
        }
        parts.push(`/* === ${relPath} === */`);
        parts.push(fs.readFileSync(absPath, 'utf8'));
        parts.push('');
    }

    const bundleContent = parts.join('\n');
    const outPath = path.join(distDir, 'app.bundle.js');
    fs.writeFileSync(outPath, bundleContent, 'utf8');

    const kb = (Buffer.byteLength(bundleContent, 'utf8') / 1024).toFixed(1);
    console.log(`  [OK]  dist/app.bundle.js (${kb} KB)`);
    return outPath;
}

// Replace all individual app <script> tags in index.html with a single bundle tag
function updateIndexHtml(version) {
    const indexPath = path.join(ROOT, 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');

    // Match either first-run marker or already-bundled marker
    const startMarker = html.includes('<!-- App Scripts (bundled) -->')
        ? '<!-- App Scripts (bundled) -->'
        : '<!-- App Scripts -->';
    const endMarker = '<!-- Service Worker Registration -->';

    const startIdx = html.indexOf(startMarker);
    const endIdx = html.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) {
        console.error('  [ERR] Could not find script block markers in index.html');
        console.error('        Expected: "<!-- App Scripts -->" or "<!-- App Scripts (bundled) -->"');
        console.error('        and: "<!-- Service Worker Registration -->"');
        process.exit(1);
    }

    const replacement =
        `<!-- App Scripts (bundled) -->\n` +
        `    <script src="dist/app.bundle.js?v=${version}"></script>\n\n    `;

    html = html.slice(0, startIdx) + replacement + html.slice(endIdx);

    fs.writeFileSync(indexPath, html, 'utf8');
    console.log(`  [OK]  index.html → dist/app.bundle.js?v=${version}`);
}

// Update CACHE_NAME in service-worker.js to match APP_VERSION
// This forces the SW activate handler to delete the old cache bucket on next load.
function updateServiceWorker(version) {
    const swPath = path.join(ROOT, 'service-worker.js');
    let sw = fs.readFileSync(swPath, 'utf8');

    const updated = sw.replace(
        /const CACHE_NAME\s*=\s*['"]kara-pos-v[^'"]*['"]/,
        `const CACHE_NAME = 'kara-pos-v${version}'`
    );

    if (updated === sw) {
        console.warn('  [WARN] CACHE_NAME not replaced — check service-worker.js pattern');
    } else {
        fs.writeFileSync(swPath, updated, 'utf8');
        console.log(`  [OK]  service-worker.js CACHE_NAME = 'kara-pos-v${version}'`);
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const version = getAppVersion();
console.log(`\nBuilding kara2 bundle (APP_VERSION = ${version})\n`);

buildBundle(version);
updateIndexHtml(version);
updateServiceWorker(version);

console.log('\nDone. Deploy the dist/ folder and index.html and service-worker.js.\n');
