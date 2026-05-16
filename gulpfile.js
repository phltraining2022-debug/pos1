const gulp = require('gulp');
const concat = require('gulp-concat');
const replace = require('gulp-replace');
const fs = require('fs');
const path = require('path');

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
        const src = fs.readFileSync('app/app.js', 'utf8');
        const match = src.match(/var\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
        return match ? match[1] : Date.now().toString();
    } catch (e) {
        return Date.now().toString();
    }
}

function buildBundle() {
    const version = getAppVersion();
    console.log('Building bundle for APP_VERSION:', version);

    // Make sure dist/ exists
    if (!fs.existsSync('dist')) fs.mkdirSync('dist');

    return gulp.src(JS_FILES)
        .pipe(concat('app.bundle.js'))
        .pipe(gulp.dest('dist'));
}

function updateIndexHtml() {
    const version = getAppVersion();
    console.log('Updating index.html with ?v=' + version);

    return gulp.src('index.html')
        .pipe(replace(
            // Remove all individual app script tags (from "<!-- App Scripts -->" block)
            /<!-- App Scripts -->[\s\S]*?<!-- Service Worker Registration -->/,
            `<!-- App Scripts (bundled) -->\n    <script src="dist/app.bundle.js?v=${version}"></script>\n\n    <!-- Service Worker Registration -->`
        ))
        .pipe(gulp.dest('.'));
}

const build = gulp.series(buildBundle, updateIndexHtml);

function watch() {
    console.log('Watching app/ for changes...');
    gulp.watch('app/**/*.js', build);
}

exports.bundle = buildBundle;
exports.build = build;
exports.watch = watch;
exports.default = build;
