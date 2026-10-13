// ================================================================
// SMART TRAFFIC V2X DASHBOARD — app.js
// Connects to local server.py proxy at http://localhost:8000
// which in turn proxies to the AWS Cloud APIs.
// ================================================================

const API = '';


// Global Fetch Interceptor to attach X-User-Email header for authorization
(function() {
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
        const urlStr = String(url);
        if (urlStr.includes('/api/')) {
            options.headers = options.headers || {};
            const storedUser = localStorage.getItem('currentUser');
            if (storedUser) {
                try {
                    const user = JSON.parse(storedUser);
                    if (user && user.email) {
                        if (options.headers instanceof Headers) {
                            options.headers.set('X-User-Email', user.email);
                        } else {
                            options.headers['X-User-Email'] = user.email;
                        }
                    }
                } catch (e) {}
            }
        }
        return originalFetch.call(this, url, options);
    };
})();

// ────────────────────────────────────────────────────────────────
// GLOBAL STATE
// ────────────────────────────────────────────────────────────────
let currentUser   = null;
let isActivated   = false;

let accidentsMapInstance = null;
let dangerMapInstance    = null;
let accidentMarkers      = [];
let dangerMarkers        = [];

let ownerMicroMapInstance = null;
let ownerMetricsInterval  = null;
let ownerImuCanvasInterval = null;
let ownerDashboardDangerMapInstance = null;
let ownerDashboardDangerMarkers = [];
let myvehicleLiveMapInstance = null;
let myvehicleLiveMapMarkers = [];

let reportsPieChartInstance = null;
let reportsBarChartInstance = null;

// ────────────────────────────────────────────────────────────────
// UTILITIES
// ────────────────────────────────────────────────────────────────
function initHeaderClock() {
    const el = document.getElementById('live-header-clock');
    const tick = () => { el.innerText = new Date().toLocaleTimeString('en-US', { hour12: false }); };
    tick();
    setInterval(tick, 1000);
}

function dismissGlobalAlert() {
    document.getElementById('global-alert-banner').style.display = 'none';
}

function showGlobalAlert(msg, isError = false) {
    const banner = document.getElementById('global-alert-banner');
    const text   = document.getElementById('global-alert-text');
    banner.style.borderColor = isError ? 'rgba(239,68,68,0.4)' : '';
    text.innerText = msg;
    banner.style.display = 'flex';
}

/** Map severity string → hex color */
function sevColor(sev) {
    if (!sev) return '#64748b';
    const s = sev.toUpperCase();
    if (s === 'CRITICAL') return '#ff2a5f';
    if (s === 'SEVERE'  || s === 'MAJOR')    return '#ffb300';
    if (s === 'MODERATE')                    return '#00e676';
    if (s === 'MINOR')                       return '#00e5ff';
    return '#64748b';
}

/** Map risk_level → hex color */
function riskColor(level) {
    if (!level) return '#64748b';
    const r = level.toUpperCase();
    if (r === 'HIGH')   return '#f43f5e';
    if (r === 'MEDIUM') return '#fbbf24';
    if (r === 'LOW')    return '#10b981';
    return '#64748b';
}

/** Map vehicle status → CSS color variable string */
function statusColor(st) {
    switch ((st || '').toUpperCase()) {
        case 'ACTIVE':      return 'var(--minor)';    // green
        case 'ACCIDENT':    return 'var(--critical)'; // red
        case 'EMERGENCY':   return 'var(--critical)'; // red
        case 'DISPATCHED':  return '#f97316';         // orange
        case 'REGISTERED':  return 'var(--primary)';  // blue
        case 'INACTIVE':    return 'var(--text-muted)';
        default:            return 'var(--text-muted)';
    }
}

/** Inline pill badge for vehicle status */
function statusPill(st) {
    const label = (st || 'UNKNOWN').toUpperCase();
    let cls = 'inactive';
    let dotHtml = '';
    if (label === 'ACTIVE') {
        cls = 'active';
        dotHtml = '<span class="dot-pulse"></span>';
    } else if (label === 'ACCIDENT' || label === 'EMERGENCY') {
        cls = 'accident';
        dotHtml = '<span class="dot-pulse" style="background:var(--critical); box-shadow:0 0 8px var(--critical-glow);"></span>';
    } else if (label === 'DISPATCHED') {
        return `<span class="status-pill-glowing accident" style="background:rgba(249,115,22,0.12); color:#f97316; border:1px solid rgba(249,115,22,0.28); box-shadow:0 0 10px rgba(249,115,22,0.15);"><span class="dot-pulse" style="background:#f97316; box-shadow:0 0 8px rgba(249,115,22,0.45); animation:dotPulseAnim 1.5s infinite alternate;"></span>DISPATCHED</span>`;
    } else if (label === 'REGISTERED') {
        return `<span class="status-pill-glowing active" style="background:var(--primary-dim); color:var(--primary); border:1px solid rgba(0,229,255,0.28); box-shadow:0 0 10px rgba(0,229,255,0.15);"><span class="dot-pulse" style="background:var(--primary); box-shadow:0 0 8px var(--primary-glow); animation:dotPulseAnim 1.5s infinite alternate;"></span>REGISTERED</span>`;
    }
    return `<span class="status-pill-glowing ${cls}">${dotHtml}${label}</span>`;
}

/** Friendly date string */
function fmtDate(str) {
    if (!str) return '—';
    try { return new Date(str).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return str; }
}

/** Severity pill HTML */
function sevPill(sev) {
    const c = sevColor(sev);
    const label = sev ? sev.toUpperCase() : 'UNKNOWN';
    return `<span style="background:${c}20;color:${c};border:1px solid ${c}40;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">${label}</span>`;
}

/** Generic loading row */
function loadingRow(cols, msg = 'Loading...') {
    return `<tr><td colspan="${cols}" style="text-align:center;color:var(--text-muted);padding:30px;"><i class="fa-solid fa-spinner fa-spin"></i> ${msg}</td></tr>`;
}

/** Generic empty row */
function emptyRow(cols, msg = 'No data found.') {
    return `<tr><td colspan="${cols}" style="text-align:center;color:var(--text-muted);padding:30px;">${msg}</td></tr>`;
}

/** Error row */
function errorRow(cols, msg) {
    return `<tr><td colspan="${cols}" style="text-align:center;color:var(--critical);padding:30px;">⚠️ ${msg}</td></tr>`;
}

// ────────────────────────────────────────────────────────────────
// AUTHENTICATION
// ────────────────────────────────────────────────────────────────
async function handleLoginSubmit(event) {
    event.preventDefault();
    const email  = document.getElementById('login-email').value.trim();
    const pass   = document.getElementById('login-password').value;
    const errEl  = document.getElementById('login-error');
    const btn    = document.getElementById('btn-login-submit');

    errEl.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in...';

    try {
        const res  = await fetch(`${API}/api/auth/login`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email, password: pass })
        });
        const data = await res.json();

        if (!res.ok || data.error) {
            errEl.innerText      = data.error || 'Invalid credentials.';
            errEl.style.display  = 'block';
        } else {
            loginUser(data);
        }
    } catch (e) {
        errEl.innerText     = '⚠️ Cannot reach server. Please start server.py first.';
        errEl.style.display = 'block';
    }

    btn.disabled  = false;
    btn.innerHTML = '<span>Sign In</span><i class="fa-solid fa-arrow-right-to-bracket"></i>';
}

function loginUser(user) {
    currentUser  = user;
    isActivated  = !!(user.device_serial);   // Owner is activated when device_serial is set

    // Save to localStorage to persist session
    localStorage.setItem('currentUser', JSON.stringify(user));
    localStorage.setItem('_lastActivity', Date.now());
    // Push state so browser Back button won't go back to protected app
    window.history.pushState({ loggedIn: true }, '', window.location.href);

    // Show app, hide auth
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-layout').style.display     = 'flex';

    // Profile badge
    document.getElementById('display-user-name').innerText = user.name;
    const roleMap = { admin: 'System Administrator', owner: 'Vehicle Owner', user: 'Vehicle Owner' };
    const normRole = (user.role || '').toLowerCase();
    document.getElementById('display-user-role').innerText = roleMap[normRole] || user.role;
    const letters = user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    document.getElementById('avatar-letters').innerText = letters;

    initHeaderClock();
    adjustNavForRole(user.role, isActivated);

    // Route to first page
    const loginRole = (user.role || '').toLowerCase();
    if (loginRole === 'owner' || loginRole === 'user') {
        if (!isActivated) {
            lockToActivatePage();
        } else {
            // Pre-fill user_id in activate form (useful even after activation)
            const actField = document.getElementById('act-user-id');
            if (actField && user.user_id) actField.value = user.user_id;
            switchPage('dashboard');
        }
    } else {
        // Admin → Dashboard
        switchPage('dashboard');
    }
}

function handleLogout() {
    currentUser        = null;
    isActivated        = false;
    accidentsMapInstance = null;
    dangerMapInstance    = null;
    accidentMarkers      = [];
    dangerMarkers        = [];

    if (ownerMetricsInterval) {
        clearInterval(ownerMetricsInterval);
        ownerMetricsInterval = null;
    }
    if (ownerImuCanvasInterval) {
        clearInterval(ownerImuCanvasInterval);
        ownerImuCanvasInterval = null;
    }
    if (ownerMicroMapInstance) {
        ownerMicroMapInstance.remove();
        ownerMicroMapInstance = null;
    }
    if (ownerDashboardDangerMapInstance) {
        ownerDashboardDangerMapInstance.remove();
        ownerDashboardDangerMapInstance = null;
    }
    ownerDashboardDangerMarkers = [];

    if (myvehicleLiveMapInstance) {
        myvehicleLiveMapInstance.remove();
        myvehicleLiveMapInstance = null;
    }
    myvehicleLiveMapMarkers = [];

    localStorage.removeItem('currentUser');
    localStorage.removeItem('_lastActivity');

    document.getElementById('auth-container').style.display = 'flex';
    document.getElementById('app-layout').style.display     = 'none';
    document.getElementById('login-form').reset();
    document.getElementById('login-error').style.display    = 'none';
    document.getElementById('global-alert-banner').style.display = 'none';

    // Prevent Back button from accessing the protected app after logout
    window.history.replaceState(null, '', window.location.href);
}

// ────────────────────────────────────────────────────────────────
// INITIALIZATION
// ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const stored = localStorage.getItem('currentUser');
    if (stored) {
        try {
            const user = JSON.parse(stored);

            // Session timeout: 30 minutes of inactivity
            const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
            const lastActivity = parseInt(localStorage.getItem('_lastActivity') || '0', 10);
            if (lastActivity && Date.now() - lastActivity > SESSION_TIMEOUT_MS) {
                localStorage.removeItem('currentUser');
                localStorage.removeItem('_lastActivity');
                // Show expired message
                const errEl = document.getElementById('login-error');
                if (errEl) {
                    errEl.innerText = '⏰ Your session has expired. Please sign in again.';
                    errEl.style.display = 'block';
                }
            } else {
                loginUser(user);
            }
        } catch (e) {
            localStorage.removeItem('currentUser');
        }
    }

    // Update last activity timestamp on user interactions
    ['click', 'keydown', 'mousemove', 'touchstart'].forEach(evt =>
        document.addEventListener(evt, () => localStorage.setItem('_lastActivity', Date.now()), { passive: true })
    );
    updatePhonePlaceholder();
});


// ────────────────────────────────────────────────────────────────
// NAVIGATION & ROLE ACCESS
// ────────────────────────────────────────────────────────────────
const PAGE_TITLES = {
    dashboard:  'System Overview Dashboard',
    vehicles:   'Registered Vehicles Registry',
    accidents:  'Accident History Log',
    analytics:  'Dangerous Roads Map',
    reports:    'Accident Analysis Report',
    dispatch:   'Emergency Dispatch Log',
    activate:   'Activate OBU Device',
    myvehicle:  'My Vehicle Status',
    usermgmt:   'User Management',
    adminmgmt:  'Administrator Configuration',
    auditlogs:  'Audit Logs',
    emergency:  'Emergency Contact Setup'
};

const ROLE_NAV = {
    admin:    ['dashboard', 'vehicles', 'accidents', 'analytics', 'reports', 'dispatch', 'usermgmt', 'adminmgmt', 'auditlogs'],
    owner:    { activated: ['dashboard', 'analytics', 'reports', 'myvehicle', 'emergency'], locked: ['activate'] },
    user:     { activated: ['dashboard', 'analytics', 'reports', 'myvehicle', 'emergency'], locked: ['activate'] }
};

function adjustNavForRole(role, activated) {
    const r = (role || '').toLowerCase();
    const adminMenu = document.getElementById('admin-nav-menu');
    const ownerMenu = document.getElementById('owner-nav-menu');

    if (r === 'admin') {
        if (adminMenu) adminMenu.style.display = 'flex';
        if (ownerMenu) ownerMenu.style.display = 'none';
    } else {
        if (adminMenu) adminMenu.style.display = 'none';
        if (ownerMenu) ownerMenu.style.display = 'flex';

        // Show/hide owner items depending on activation status
        const allowed = (activated) ? ROLE_NAV.owner.activated : ROLE_NAV.owner.locked;
        ['dashboard', 'analytics', 'reports', 'myvehicle', 'activate', 'emergency'].forEach(id => {
            const el = document.getElementById(`owner-nav-${id}`);
            if (el) el.style.display = allowed.includes(id) ? 'flex' : 'none';
        });
    }

    // Show/hide admin section divider
    const divider = document.getElementById('admin-section-divider');
    if (divider) divider.style.display = r === 'admin' ? 'block' : 'none';
}

function lockToActivatePage() {
    const banner = document.getElementById('activation-required-banner');
    if (banner) banner.style.display = 'flex';
    // Let the user enter their user ID manually
    const actField = document.getElementById('act-user-id');
    if (actField) {
        actField.value    = '';
        actField.readOnly = false;
        actField.style.cssText = '';
    }
    switchPage('activate');
}

function switchPage(pageId) {
    // Security gate for locked Owners
    const curRole = (currentUser && currentUser.role || '').toLowerCase();
    if (currentUser && (curRole === 'owner' || curRole === 'user') && !isActivated && pageId !== 'activate') return;

    // Security gate for role-allowed pages
    if (currentUser) {
        const r = (curRole === 'owner' || curRole === 'user') ? 'owner' : curRole;
        const allowed = r === 'owner'
            ? (isActivated ? ROLE_NAV.owner.activated : ROLE_NAV.owner.locked)
            : (ROLE_NAV[r] || []);
        if (!allowed.includes(pageId)) return;
    }

    // Clean up owner-specific diagnostics components if switching away
    if (pageId !== 'myvehicle') {
        if (ownerMetricsInterval) {
            clearInterval(ownerMetricsInterval);
            ownerMetricsInterval = null;
        }
        if (ownerImuCanvasInterval) {
            clearInterval(ownerImuCanvasInterval);
            ownerImuCanvasInterval = null;
        }
        if (ownerMicroMapInstance) {
            ownerMicroMapInstance.remove();
            ownerMicroMapInstance = null;
        }
        if (myvehicleLiveMapInstance) {
            myvehicleLiveMapInstance.remove();
            myvehicleLiveMapInstance = null;
        }
        myvehicleLiveMapMarkers = [];
    }

    // Update nav highlight
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (curRole === 'admin') {
        let highlightId = pageId;
        if (['accidents', 'analytics', 'reports', 'dispatch'].includes(pageId)) {
            highlightId = 'logs';
        } else if (['usermgmt', 'adminmgmt', 'auditlogs'].includes(pageId)) {
            highlightId = 'settings';
        }
        const navEl = document.getElementById(`nav-${highlightId}`);
        if (navEl) navEl.classList.add('active');
    } else {
        const navEl = document.getElementById(`owner-nav-${pageId}`);
        if (navEl) navEl.classList.add('active');
    }

    // Show/hide pages
    document.querySelectorAll('.page-container').forEach(el => el.classList.remove('active'));
    let targetPageId = pageId;
    if (pageId === 'dashboard' && curRole !== 'admin') {
        targetPageId = 'owner-dashboard';
    }
    const pageEl = document.getElementById(`${targetPageId}-page`);
    if (pageEl) pageEl.classList.add('active');

    // Update header title
    document.getElementById('page-header-title').innerText = PAGE_TITLES[pageId] || pageId;

    // Lazy-load page data
    if      (pageId === 'dashboard')  {
        if (curRole === 'admin') {
            loadDashboard();
        } else {
            loadOwnerDashboard();
        }
    }
    else if (pageId === 'vehicles')   loadVehicles();
    else if (pageId === 'accidents')  loadAccidents();
    else if (pageId === 'analytics')  loadAnalytics();
    else if (pageId === 'reports')    loadReportsPage();
    else if (pageId === 'dispatch')   loadDispatchCases();
    else if (pageId === 'myvehicle')  loadOwnerVehicleData();
    else if (pageId === 'usermgmt')   loadUserManagement();
    else if (pageId === 'adminmgmt')  loadAdminManagement();
    else if (pageId === 'auditlogs')  loadAuditLogs();
    else if (pageId === 'emergency')  loadEmergencyContactPage();
}

// ────────────────────────────────────────────────────────────────
// PAGE 1 — DASHBOARD
// ────────────────────────────────────────────────────────────────
async function loadDashboard() {
    try {
        // Load stats
        const statsRes = await fetch(`${API}/api/dashboard`);
        const stats    = await statsRes.json();
        renderDashboardStats(stats);

        // Update cloud status indicator
        const cloudEl = document.getElementById('cloud-api-status');
        if (cloudEl) {
            cloudEl.innerHTML = '<i class="fa-solid fa-circle" style="font-size:6px;margin-right:4px;"></i>Online';
            cloudEl.style.color = 'var(--minor)';
            cloudEl.style.background = 'rgba(0,230,118,0.1)';
            cloudEl.style.borderColor = 'rgba(0,230,118,0.25)';
        }

        // Load recent accidents for the feed
        const accRes = await fetch(`${API}/api/accidents`);
        const accs   = await accRes.json();
        renderDashboardFeed(Array.isArray(accs) ? accs : []);

    } catch (e) {
        const feedEl = document.getElementById('dashboard-feed-container');
        feedEl.innerHTML = `<div style="text-align:center;padding:30px;color:var(--critical);">⚠️ Cannot reach server.py. Please start it first.<br><small style="color:var(--text-muted);">Run: <code>python3 server.py</code></small></div>`;
        const cloudEl = document.getElementById('cloud-api-status');
        if (cloudEl) { cloudEl.innerHTML = '<i class="fa-solid fa-circle" style="font-size:6px;margin-right:4px;"></i>Offline'; cloudEl.style.color = 'var(--critical)'; cloudEl.style.background = 'rgba(255,42,95,0.1)'; cloudEl.style.borderColor = 'rgba(255,42,95,0.25)'; }
    }
}

// ────────────────────────────────────────────────────────────────
// USER/OWNER DASHBOARD LOGIC
// ────────────────────────────────────────────────────────────────
function timeAgo(dateString) {
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '—';
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 0) return 'Just now';
    const intervals = [
        { label: 'y', seconds: 31536000 },
        { label: 'mo', seconds: 2592000 },
        { label: 'd', seconds: 86400 },
        { label: 'h', seconds: 3600 },
        { label: 'm', seconds: 60 }
    ];
    for (const interval of intervals) {
        const count = Math.floor(seconds / interval.seconds);
        if (count >= 1) {
            return `${count}${interval.label} ago`;
        }
    }
    return 'Just now';
}

window.zoomOwnerDashboardToRoad = function(lat, lng) {
    if (ownerDashboardDangerMapInstance && lat && lng) {
        ownerDashboardDangerMapInstance.flyTo([lat, lng], 15, {
            animate: true,
            duration: 1.5
        });
        document.getElementById('owner-dashboard-danger-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

async function loadOwnerDashboard() {
    if (!currentUser || !currentUser.device_serial) return;
    const serial = currentUser.device_serial;

    const feedEl = document.getElementById('owner-dashboard-accidents-feed');
    feedEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';

    try {
        // 1. Load vehicle info
        const vRes = await fetch(`${API}/api/vehicles`);
        const vehicles = await vRes.json();
        const myV = (Array.isArray(vehicles) ? vehicles : []).find(v => v.obu_serial === serial);

        let vehicleLat = 30.0444;
        let vehicleLng = 31.2357;
        let vehicleStatus = 'ACTIVE';

        if (myV) {
            vehicleStatus = (myV.last_status || 'ACTIVE').toUpperCase();
            vehicleLat = parseFloat(myV.last_latitude) || 30.0444;
            vehicleLng = parseFloat(myV.last_longitude) || 31.2357;

            document.getElementById('owner-stat-vehicle-id').innerText = myV.vehicle_id || '—';

            const badgeEl = document.getElementById('owner-stat-vehicle-badge');
            if (badgeEl) {
                badgeEl.innerHTML = statusPill(vehicleStatus);
            }
        } else {
            document.getElementById('owner-stat-vehicle-id').innerText = serial;
            const badgeEl = document.getElementById('owner-stat-vehicle-badge');
            if (badgeEl) {
                badgeEl.innerHTML = '<span class="status-pill-glowing offline">PENDING</span>';
            }
        }

        // 2. Load accidents
        const aRes = await fetch(`${API}/api/accidents`);
        const allAcc = await aRes.json();
        const myAcc = (Array.isArray(allAcc) ? allAcc : [])
            .filter(a => a.obu_serial === serial)
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        // Update My Accidents Card
        document.getElementById('owner-stat-accidents-count').innerText = myAcc.length;

        // Update Last Event Card
        if (myAcc.length > 0) {
            const lastEventTime = myAcc[0].created_at || myAcc[0].event_timestamp;
            document.getElementById('owner-stat-lastevent-time').innerText = timeAgo(lastEventTime);
        } else {
            document.getElementById('owner-stat-lastevent-time').innerText = 'No events';
        }

        // Update Confidence Avg Card
        const confValues = myAcc.map(a => {
            let score = a.confidence_score;
            if (typeof score !== 'number') score = parseFloat(score);
            if (isNaN(score)) return null;
            return score <= 1.0 ? score * 100 : score;
        }).filter(v => v !== null);

        const avgConf = confValues.length
            ? Math.round(confValues.reduce((s, v) => s + v, 0) / confValues.length) + '%'
            : '—';
        document.getElementById('owner-stat-confidence-avg').innerText = avgConf;

        // Render Accidents Feed
        if (!myAcc.length) {
            feedEl.innerHTML = `
                <div style="text-align:center; padding:40px; color:var(--minor);">
                    <i class="fa-solid fa-circle-check" style="font-size: 28px; margin-bottom:12px; display:block; text-shadow:0 0 8px rgba(0,230,118,0.3);"></i>
                    No accidents recorded for your vehicle. Drive safe!
                </div>
            `;
        } else {
            feedEl.innerHTML = myAcc.map(acc => {
                const sev = (acc.severity || 'UNKNOWN').toUpperCase();
                let sevClass = 'minor';
                if (sev === 'CRITICAL') sevClass = 'critical';
                else if (sev === 'SEVERE' || sev === 'MAJOR') sevClass = 'warning';
                else if (sev === 'MODERATE') sevClass = 'moderate';

                const sevIcon = sevClass === 'critical'
                    ? 'fa-solid fa-triangle-exclamation'
                    : (sevClass === 'warning' ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-info');

                const time = timeAgo(acc.created_at || acc.event_timestamp);
                const hasStreet = acc.street_name && !acc.street_name.includes('GPS') && acc.street_name !== 'Unnamed Road';
                const idSafe = (acc.event_id || '').replace(/[^a-zA-Z0-9]/g, '_');

                return `
                    <div class="owner-accident-item ${sevClass}"
                         style="cursor: pointer;"
                         onclick="zoomOwnerDashboardToRoad(${acc.latitude}, ${acc.longitude})"
                         title="Click to zoom on map">
                        <div class="owner-accident-col-left">
                            <span class="owner-accident-id">${acc.event_id || '—'}</span>
                            <span class="owner-accident-badge ${sevClass}"><i class="${sevIcon}"></i> ${sev}</span>
                            <span class="owner-accident-type" id="owner-road-${idSafe}" style="color: var(--primary); font-weight: 700; text-shadow: 0 0 8px var(--primary-glow);">
                                ${hasStreet ? acc.street_name : 'Loading location...'}
                            </span>
                        </div>
                        <div class="owner-accident-col-right">
                            <span class="owner-accident-time">${time}</span>
                        </div>
                    </div>
                `;
            }).join('');

            // Reverse geocode in the browser (staggered)
            let delay = 0;
            myAcc.forEach(acc => {
                const idSafe = (acc.event_id || '').replace(/[^a-zA-Z0-9]/g, '_');
                const cell = document.getElementById(`owner-road-${idSafe}`);
                if (!cell) return;

                if (acc.street_name && !acc.street_name.includes('GPS') && acc.street_name !== 'Unnamed Road') {
                    cell.innerText = acc.street_name;
                    return;
                }

                const lat = parseFloat(acc.latitude);
                const lng = parseFloat(acc.longitude);
                if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
                    cell.innerText = "Unknown Location";
                    return;
                }

                setTimeout(() => {
                    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`)
                        .then(res => res.json())
                        .then(json => {
                            const addr = json.address || {};
                            const road = addr.road || addr.suburb || addr.city || addr.town || addr.county || `Road Segment (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
                            cell.innerText = road;
                            acc.street_name = road;
                        })
                        .catch(err => {
                            // Fallback to hotspot name
                            cell.innerText = getCairoLocationName(lat, lng);
                        });
                }, delay);
                delay += 500;
            });
        }

        // 3. Load Dangerous Roads Map
        const dangerRes = await fetch(`${API}/api/analytics`);
        const dangerData = await dangerRes.json();
        initOwnerDashboardDangerMap(Array.isArray(dangerData) ? dangerData : [], vehicleLat, vehicleLng);

    } catch (e) {
        console.error("loadOwnerDashboard error:", e);
        feedEl.innerHTML = `<div style="text-align:center;padding:30px;color:var(--critical);">⚠️ Failed to load dashboard data.</div>`;
    }
}

function initOwnerDashboardDangerMap(data, vehicleLat, vehicleLng) {
    setTimeout(() => {
        if (!ownerDashboardDangerMapInstance) {
            ownerDashboardDangerMapInstance = L.map('owner-dashboard-danger-map', { zoomControl: true, attributionControl: false })
                .setView([vehicleLat || 30.0444, vehicleLng || 31.2357], 11);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 })
                .addTo(ownerDashboardDangerMapInstance);
        } else {
            ownerDashboardDangerMapInstance.invalidateSize();
            if (vehicleLat && vehicleLng) {
                ownerDashboardDangerMapInstance.setView([vehicleLat, vehicleLng], 11);
            }
        }

        // Clear old markers
        ownerDashboardDangerMarkers.forEach(m => ownerDashboardDangerMapInstance.removeLayer(m));
        ownerDashboardDangerMarkers = [];

        data.forEach(row => {
            const lat   = parseFloat(row.latitude);
            const lng   = parseFloat(row.longitude);
            if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return;

            const risk   = (row.risk_level || '').toUpperCase();
            const col    = riskColor(risk);

            const score = typeof row.danger_score === 'number' ? row.danger_score : parseFloat(row.danger_score) || 0;
            const pct = Math.min(score, 100);

            const radius = Math.max(15, Math.min((pct / 100) * 80, 80)); // scale 15–80px

            const circle = L.circleMarker([lat, lng], {
                radius,
                fillColor:   col,
                color:       col,
                weight:      2,
                opacity:     0.9,
                fillOpacity: 0.3
            }).addTo(ownerDashboardDangerMapInstance);

            const streetNameLabel = (row.street_name && row.street_name !== 'Unnamed Road' && row.street_name !== 'Unknown Road') ? row.street_name : getCairoLocationName(lat, lng);

            const popupContent = `
                <div style="font-family:'Outfit',sans-serif;min-width:210px;">
                    <div style="font-weight:700;color:${col};margin-bottom:4px;font-size:13px;">${risk} RISK ZONE</div>
                    <div style="font-weight:800;color:#fff;margin-bottom:8px;font-size:15px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:6px;">${streetNameLabel}</div>
                    <div style="font-size:12px;color:#94a3b8;line-height:1.7;">
                        <strong>Metric ID:</strong> ${row.metric_id || '—'}<br>
                        <strong>Total Accidents:</strong> ${row.accident_count ?? '—'}<br>
                        <strong>Danger Score:</strong> ${pct.toFixed(0)}%<br>
                        <strong>GPS:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}
                    </div>
                </div>
            `;

            circle.bindPopup(popupContent);

            circle.on('mouseover', function (e) {
                this.openPopup();
            });
            circle.on('mouseout', function (e) {
                this.closePopup();
            });
            ownerDashboardDangerMarkers.push(circle);
        });

        // Pulse marker for owner's vehicle position if available
        if (vehicleLat && vehicleLng && (vehicleLat !== 30.0444 || vehicleLng !== 31.2357)) {
            const vehicleIcon = L.divIcon({
                className: 'custom-pulsing-marker',
                html: `
                    <div style="position:relative;">
                        <div style="width:12px;height:12px;border-radius:50%;background:var(--primary);border:2px solid #fff;box-shadow:0 0 10px var(--primary-glow);"></div>
                        <div class="marker-pulse active" style="background:var(--primary-glow);position:absolute;top:-8px;left:-8px;width:28px;height:28px;border-radius:50%;"></div>
                    </div>
                `,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });
            const vehicleMarker = L.marker([vehicleLat, vehicleLng], { icon: vehicleIcon })
                .addTo(ownerDashboardDangerMapInstance)
                .bindPopup('<div style="font-family:\'Outfit\',sans-serif;font-weight:700;color:#fff;font-size:12px;">YOUR VEHICLE POSITION</div>');

            ownerDashboardDangerMarkers.push(vehicleMarker);
        }
    }, 200);
}

function renderDashboardStats(d) {
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) {
            if (typeof val === 'number') {
                el.innerText = val.toLocaleString();
            } else if (val !== null && val !== undefined && !isNaN(Number(val)) && val !== '') {
                el.innerText = Number(val).toLocaleString();
            } else {
                el.innerText = (val ?? '—');
            }
        }
    };
    set('stat-critical',   d.critical_accidents);
    set('stat-severe',     d.severe_accidents);
    set('stat-moderate',   d.moderate_accidents);
    set('stat-minor',      d.minor_accidents);
    set('stat-total',      d.total_accidents);
    set('stat-vehicles',   d.registered_vehicles);
    set('stat-dispatches', d.active_dispatches);
    set('stat-high-risk',  d.high_risk_roads);
    set('stat-medium-risk',d.medium_risk_roads);
}

// ── Static GPS → Road Name lookup (matches server-side mapping) ──────────
const GPS_ROAD_MAP = [
    // Exact coordinates stored in DB
    { name: "6th of October Corridor",        lat: 30.1,    lng: 31.1  },
    { name: "Mohandiseen Road",                lat: 30.25,   lng: 31.25 },
    { name: "Heliopolis Ring Road",            lat: 30.4,    lng: 31.4  },
    // Additional Cairo hotspots
    { name: "El-Nasr Road",                    lat: 30.1,    lng: 31.3  },
    { name: "Ring Road",                       lat: 30.1,    lng: 31.25 },
    { name: "Ring Road",                       lat: 30.25,   lng: 31.45 },
    { name: "Cairo - Ismailia Desert Road",    lat: 30.4,    lng: 31.6  },
    { name: "El-Qasr El-Aini Street",          lat: 30.04,   lng: 31.24 },
    { name: "Cairo - Ismailia Desert Road",    lat: 30.3,    lng: 31.6  },
    { name: "Helwan Road",                     lat: 29.98,   lng: 31.22 },
    { name: "6th of October Bridge",           lat: 30.0524, lng: 31.2462 },
    { name: "Maadi Ring Road",                 lat: 29.9821, lng: 31.2854 },
    { name: "26th of July Corridor",           lat: 30.0765, lng: 31.155  },
    { name: "90th Street, New Cairo",          lat: 30.0242, lng: 31.4658 },
    { name: "El-Nasr Road, Heliopolis",        lat: 30.0894, lng: 31.3321 },
    { name: "Cairo-Alex Desert Road",          lat: 30.0782, lng: 31.021  },
    { name: "Autostrad Road",                  lat: 29.9712, lng: 31.2785 },
];

function getCairoLocationName(lat, lng) {
    if (!lat || !lng || isNaN(Number(lat)) || isNaN(Number(lng))) return 'Cairo Sector';
    let minD = Infinity;
    let closestName = null;
    for (const spot of GPS_ROAD_MAP) {
        const d = Math.pow(spot.lat - lat, 2) + Math.pow(spot.lng - lng, 2);
        if (d < minD) { minD = d; closestName = spot.name; }
    }
    // Within ~7 km radius (0.005 degrees² ≈ 0.5 km, use 0.1 for ~10 km)
    return (minD <= 0.1 && closestName) ? closestName : 'Cairo Sector';
}

function renderDashboardFeed(accidents) {
    const container = document.getElementById('dashboard-feed-container');
    if (!accidents.length) {
        container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">No accident records in the cloud database yet.</div>';
        return;
    }

    const sorted = [...accidents].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    container.innerHTML = sorted.slice(0, 20).map(acc => {
        const sev  = (acc.severity || 'UNKNOWN').toUpperCase();
        const col  = sevColor(sev);
        const time = fmtDate(acc.created_at);
        const peak = typeof acc.peakAccelMag_g === 'number' ? acc.peakAccelMag_g.toFixed(2) : (acc.peakAccelMag_g || '—');

        const sevLabel = sev.charAt(0) + sev.slice(1).toLowerCase();
        const loc = getCairoLocationName(acc.latitude, acc.longitude);

        return `
        <div class="feed-item">
            <div class="feed-info">
                <span class="feed-dot" style="background:${col};box-shadow:0 0 7px ${col};"></span>
                <div class="feed-meta">
                    <span class="feed-location">${sevLabel} Accident in ${loc}</span>
                    <span class="feed-time">ID: ${acc.event_id || '—'} &nbsp;|&nbsp; Vehicle: ${acc.vehicle_id || '—'} &nbsp;|&nbsp; ${time} &nbsp;|&nbsp; Peak: ${peak}g</span>
                </div>
            </div>
            <span style="background:${col}20;color:${col};border:1px solid ${col}40;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;">${sev}</span>
        </div>`;
    }).join('');
}

// ────────────────────────────────────────────────────────────────
// PAGE 2 — VEHICLES
// ────────────────────────────────────────────────────────────────
async function loadVehicles() {
    const tbody = document.getElementById('vehicles-table-body');
    tbody.innerHTML = loadingRow(6);
    try {
        const res  = await fetch(`${API}/api/vehicles`);
        const data = await res.json();
        renderVehiclesTable(Array.isArray(data) ? data : []);
    } catch (e) {
        tbody.innerHTML = errorRow(6, 'Failed to load vehicles.');
    }
}

function renderVehiclesTable(vehicles) {
    const tbody = document.getElementById('vehicles-table-body');
    if (!vehicles.length) { tbody.innerHTML = emptyRow(6, 'No vehicles registered yet.'); return; }

    tbody.innerHTML = vehicles.map(v => {
        const st  = (v.last_status || '').toUpperCase();
        const isActive = st === 'ACTIVE';
        const gps = (!isActive && v.last_latitude && v.last_longitude)
            ? `${parseFloat(v.last_latitude).toFixed(5)}, ${parseFloat(v.last_longitude).toFixed(5)}`
            : '—';
        const lastSeenVal = isActive ? '—' : fmtDate(v.last_seen);
        return `
        <tr>
            <td style="font-weight:700;color:var(--primary);">${v.vehicle_id || '—'}</td>
            <td style="font-size:12px;">${v.obu_serial || '—'}</td>
            <td>${v.owner_username || v.owner_user_id || '—'}</td>
            <td>${statusPill(st || '—')}</td>
            <td style="font-size:12px;">${lastSeenVal}</td>
            <td style="font-size:12px;color:var(--text-secondary);">${gps}</td>
        </tr>`;
    }).join('');
}

// ────────────────────────────────────────────────────────────────
// PAGE 3 — ACCIDENT HISTORY + MAP
// ────────────────────────────────────────────────────────────────
async function loadAccidents() {
    const tbody = document.getElementById('accidents-table-body');
    tbody.innerHTML = loadingRow(9);
    try {
        const res  = await fetch(`${API}/api/accidents`);
        const data = await res.json();
        const accs = Array.isArray(data) ? data : [];
        renderAccidentsTable(accs);
        initAccidentsMap(accs);
    } catch (e) {
        tbody.innerHTML = errorRow(9, 'Failed to load accident records.');
    }
}

function fmtGPSCardinal(lat, lng) {
    if (!lat || !lng || isNaN(Number(lat)) || isNaN(Number(lng))) return '—';
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const latH = latNum >= 0 ? 'N' : 'S';
    const lngH = lngNum >= 0 ? 'E' : 'W';
    return `${Math.abs(latNum).toFixed(2)}°${latH} ${Math.abs(lngNum).toFixed(2)}°${lngH}`;
}

function renderAccidentsTable(accidents) {
    const tbody = document.getElementById('accidents-table-body');
    if (!accidents.length) { tbody.innerHTML = emptyRow(9, 'No accident records found.'); return; }

    tbody.innerHTML = accidents.map(acc => {
        const sev   = (acc.severity || 'UNKNOWN').toUpperCase();
        const col   = sevColor(sev);
        const gps   = fmtGPSCardinal(acc.latitude, acc.longitude);
        const peakVal = parseFloat(acc.peak_accel_mag_g || acc.peakAccelMag_g || 0);
        const peak  = peakVal > 0 ? peakVal.toFixed(2) + 'g' : '—';
        const jerkVal = parseFloat(acc.peak_jerk || acc.peakJerk || 0);
        const jerk  = jerkVal > 0 ? jerkVal.toFixed(2) + '<span style="font-size:9px;vertical-align:super;letter-spacing:0px">g/s³</span>' : '—';

        let confVal = acc.confidence_score || acc.confidenceScore;
        if (!confVal && acc.confidenceLevel) {
            confVal = acc.confidenceLevel.toUpperCase() === 'HIGH' ? 95 : acc.confidenceLevel.toUpperCase() === 'MEDIUM' ? 75 : 45;
        }
        const conf = confVal ? Math.round(parseFloat(confVal)) + '%' : '—';
        const eventLabel = acc.event_id ? `[${acc.event_id.substring(0, 10)}]` : '—';
        const dateStr = fmtDateTime(acc.created_at || acc.event_timestamp);

        let badgeClass = 'minor';
        if (sev === 'CRITICAL') badgeClass = 'critical';
        else if (sev === 'SEVERE' || sev === 'MAJOR') badgeClass = 'severe';
        else if (sev === 'MODERATE') badgeClass = 'moderate';

        const sevBadge = `<span class="cyber-severity-badge ${badgeClass}">${sev}</span>`;

        return `
        <tr>
            <td style="font-weight:700; color:#00e5ff; text-shadow:0 0 6px rgba(0,229,255,0.5); font-family:var(--font-mono);">${eventLabel}</td>
            <td style="color:#e2e8f0; font-weight:600;">${acc.vehicle_id || '—'}</td>
            <td style="color:#94a3b8; font-family:var(--font-mono);">${acc.obu_serial ? 'SN: ' + acc.obu_serial : '—'}</td>
            <td>${sevBadge}</td>
            <td style="color:#e2e8f0; font-weight:700;">${conf}</td>
            <td style="color:${col}; font-weight:700; font-family:var(--font-mono);">${peak}</td>
            <td style="color:#94a3b8; font-family:var(--font-mono);">${jerk}</td>
            <td style="color:#94a3b8; font-family:var(--font-mono);">${gps}</td>
            <td style="color:#94a3b8; font-family:var(--font-mono);">${dateStr}</td>
        </tr>`;
    }).join('');
}

function initAccidentsMap(accidents) {
    setTimeout(() => {
        if (!accidentsMapInstance) {
            accidentsMapInstance = L.map('accidents-map', { zoomControl: true, attributionControl: false })
                .setView([30.0444, 31.2357], 10);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 })
                .addTo(accidentsMapInstance);
        } else {
            accidentsMapInstance.invalidateSize();
        }

        // Clear old markers
        accidentMarkers.forEach(m => accidentsMapInstance.removeLayer(m));
        accidentMarkers = [];

        accidents.forEach(acc => {
            const lat = parseFloat(acc.latitude);
            const lng = parseFloat(acc.longitude);
            if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return;

            const sev  = (acc.severity || '').toUpperCase();
            const col  = sevColor(sev);
            const peak = typeof acc.peakAccelMag_g === 'number' ? acc.peakAccelMag_g.toFixed(2) : (acc.peakAccelMag_g || '—');

            const icon = L.divIcon({
                className: '',
                html: `<div style="width:12px;height:12px;border-radius:50%;background:${col};box-shadow:0 0 10px ${col}, 0 0 20px ${col};border:1.5px solid rgba(255,255,255,0.85);opacity:0.95;"></div>`,
                iconSize: [12, 12], iconAnchor: [6, 6]
            });

            const marker = L.marker([lat, lng], { icon }).addTo(accidentsMapInstance);
            marker.bindPopup(`
                <div style="font-family:'Inter',sans-serif;min-width:190px;">
                    <div style="font-weight:700;color:${col};margin-bottom:6px;font-size:13px;">${sev} — ${acc.event_id || '—'}</div>
                    <div style="font-size:12px;color:#94a3b8;line-height:1.7;">
                        <strong>Vehicle:</strong> ${acc.vehicle_id || '—'}<br>
                        <strong>OBU Serial:</strong> ${acc.obu_serial || '—'}<br>
                        <strong>Peak Accel:</strong> ${peak}g<br>
                        <strong>Confidence:</strong> ${acc.confidenceLevel || '—'}<br>
                        <strong>GPS:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}<br>
                        <strong>Time:</strong> ${fmtDate(acc.created_at)}
                    </div>
                </div>
            `);
            accidentMarkers.push(marker);
        });

        // Fit map to markers if any
        if (accidentMarkers.length > 0) {
            const group = L.featureGroup(accidentMarkers);
            accidentsMapInstance.fitBounds(group.getBounds().pad(0.2));
        }
    }, 200);
}

// ────────────────────────────────────────────────────────────────
// PAGE 4 — ANALYTICS (DANGEROUS ROADS)
// ────────────────────────────────────────────────────────────────
let currentAnalyticsData = [];

async function loadAnalytics() {
    const tbody = document.getElementById('analytics-table-body');
    tbody.innerHTML = loadingRow(7);
    try {
        const res  = await fetch(`${API}/api/analytics`);
        const data = await res.json();
        currentAnalyticsData = Array.isArray(data) ? data : [];
        renderAnalyticsTable(currentAnalyticsData);
        initDangerMap(currentAnalyticsData);
    } catch (e) {
        tbody.innerHTML = errorRow(7, 'Failed to load analytics data: ' + e.message);
        console.error("loadAnalytics Error:", e);
    }
}

function downloadAnalyticsReport() {
    if (!currentAnalyticsData || currentAnalyticsData.length === 0) {
        alert("No data available to download.");
        return;
    }

    // CSV Header
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Metric ID,Street Name,Total Accidents,Critical,Severe,Moderate,Minor,Danger Score,Risk Level,Latitude,Longitude\n";

    // Rows
    currentAnalyticsData.forEach(row => {
        const id = row.metric_id || '';
        const street = row.street_name || 'Unnamed Road';
        const total = row.accident_count || 0;
        const c = row.critical_count || 0;
        const s = row.severe_count || 0;
        const m = row.moderate_count || 0;
        const mn = row.minor_count || 0;
        const ds = row.danger_score || 0;
        const risk = row.risk_level || 'UNKNOWN';
        const lat = row.latitude || '';
        const lng = row.longitude || '';

        csvContent += `${id},"${street}",${total},${c},${s},${m},${mn},${ds},${risk},${lat},${lng}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Traffic_Analytics_Report_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

window.zoomToRoad = function(lat, lng) {
    if (dangerMapInstance && lat && lng) {
        dangerMapInstance.flyTo([lat, lng], 15, {
            animate: true,
            duration: 1.5
        });
        document.getElementById('danger-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

function renderAnalyticsTable(data) {
    const tbody = document.getElementById('analytics-table-body');
    if (!data.length) { tbody.innerHTML = emptyRow(7, 'No analytics data available.'); return; }

    tbody.innerHTML = data.map(row => {
        const risk  = (row.risk_level || 'UNKNOWN').toUpperCase();
        const col   = riskColor(risk);

        const score = typeof row.danger_score === 'number' ? row.danger_score : parseFloat(row.danger_score) || 0;
        const pct = Math.min(score, 100);

        const gps   = (row.latitude && row.longitude)
            ? `${parseFloat(row.latitude).toFixed(5)}, ${parseFloat(row.longitude).toFixed(5)}`
            : '—';

        const idSafe = (row.metric_id || '').replace(/[^a-zA-Z0-9]/g, '_');
        const hasStreet = row.street_name && row.street_name !== 'Unnamed Road';

        return `
        <tr>
            <td style="font-weight:700;color:var(--primary);font-size:12px;cursor:pointer;transition:opacity 0.2s;"
                onmouseover="this.style.opacity='0.8'"
                onmouseout="this.style.opacity='1'"
                onclick="zoomToRoad(${row.latitude || 0}, ${row.longitude || 0})"
                title="Click to zoom on map"
            >${row.metric_id || '—'}</td>
            <td id="street-${idSafe}"
                style="font-weight:600;font-size:13px;color:var(--text-secondary);cursor:pointer;transition:color 0.2s;"
                onmouseover="this.style.color='var(--primary)'"
                onmouseout="this.style.color='var(--text-secondary)'"
                onclick="zoomToRoad(${row.latitude || 0}, ${row.longitude || 0})"
                title="Click to zoom on map"
            >${hasStreet ? row.street_name : 'Loading...'}</td>
            <td style="font-weight:700;font-size:18px;">${row.accident_count ?? '—'}</td>
            <td>
                <span style="color:var(--critical);font-weight:700;">${row.critical_count ?? 0}</span>
                <span style="color:var(--text-muted);"> / </span>
                <span style="color:var(--major);font-weight:700;">${row.severe_count ?? 0}</span>
                <span style="color:var(--text-muted);"> / </span>
                <span style="color:var(--minor);font-weight:700;">${row.moderate_count ?? 0}</span>
                <span style="color:var(--text-muted);"> / </span>
                <span style="color:var(--info);font-weight:700;">${row.minor_count ?? 0}</span>
            </td>
            <td>
                <div class="danger-bar-wrap">
                    <div class="danger-bar-track">
                        <div class="danger-bar-fill" style="width:${pct}%;background:${col};"></div>
                    </div>
                    <span style="font-weight:700;color:${col};font-size:13px;min-width:32px;">${pct.toFixed(0)}%</span>
                </div>
            </td>
            <td><span style="font-weight:700;color:${col};">${risk}</span></td>
            <td style="font-size:12px;color:var(--text-secondary);">${gps}</td>
        </tr>`;
    }).join('');

    // Resolve road names using local GPS lookup (instant, no network needed)
    data.forEach(row => {
        const idSafe = (row.metric_id || '').replace(/[^a-zA-Z0-9]/g, '_');
        const cell = document.getElementById(`street-${idSafe}`);
        if (!cell) return;

        // 1. Use server-provided street_name if valid
        if (row.street_name && row.street_name !== 'Unnamed Road' && row.street_name !== 'Unknown Road' && !row.street_name.startsWith('Road Segment')) {
            cell.innerText = row.street_name;
            return;
        }

        const lat = parseFloat(row.latitude);
        const lng = parseFloat(row.longitude);
        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
            cell.innerText = 'Unknown Location';
            return;
        }

        // 2. Use local GPS→RoadName lookup (covers all 3 active coordinate pairs)
        const localName = getCairoLocationName(lat, lng);
        cell.innerText = localName;
        row.street_name = localName;
    });
}

function initDangerMap(data) {
    setTimeout(() => {
        if (!dangerMapInstance) {
            dangerMapInstance = L.map('danger-map', { zoomControl: true, attributionControl: false })
                .setView([30.0444, 31.2357], 10);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 })
                .addTo(dangerMapInstance);
        } else {
            dangerMapInstance.invalidateSize();
        }

        // Clear old markers
        dangerMarkers.forEach(m => dangerMapInstance.removeLayer(m));
        dangerMarkers = [];

        data.forEach(row => {
            const lat   = parseFloat(row.latitude);
            const lng   = parseFloat(row.longitude);
            if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return;

            const risk   = (row.risk_level || '').toUpperCase();
            const col    = riskColor(risk);

            const score = typeof row.danger_score === 'number' ? row.danger_score : parseFloat(row.danger_score) || 0;
            const pct = Math.min(score, 100);

            const radius = Math.max(15, Math.min((pct / 100) * 80, 80)); // scale 15–80px

            const circle = L.circleMarker([lat, lng], {
                radius,
                fillColor:   col,
                color:       col,
                weight:      2,
                opacity:     0.9,
                fillOpacity: 0.3
            }).addTo(dangerMapInstance);

            const streetNameLabel = (row.street_name && row.street_name !== 'Unnamed Road' && row.street_name !== 'Unknown Road') ? row.street_name : getCairoLocationName(lat, lng);

            const popupContent = `
                <div style="font-family:'Outfit',sans-serif;min-width:210px;">
                    <div style="font-weight:700;color:${col};margin-bottom:4px;font-size:13px;">${risk} RISK ZONE</div>
                    <div style="font-weight:800;color:#fff;margin-bottom:8px;font-size:15px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:6px;">${streetNameLabel}</div>
                    <div style="font-size:12px;color:#94a3b8;line-height:1.7;">
                        <strong>Metric ID:</strong> ${row.metric_id || '—'}<br>
                        <strong>Total Accidents:</strong> ${row.accident_count ?? '—'}<br>
                        <strong>Critical:</strong> ${row.critical_count ?? 0} &nbsp;|&nbsp;
                        <strong>Severe:</strong> ${row.severe_count ?? 0} &nbsp;|&nbsp;
                        <strong>Moderate:</strong> ${row.moderate_count ?? 0} &nbsp;|&nbsp;
                        <strong>Minor:</strong> ${row.minor_count ?? 0}<br>
                        <strong>Danger Score:</strong> ${pct.toFixed(0)}%<br>
                        <strong>GPS:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}
                    </div>
                </div>
            `;

            circle.bindPopup(popupContent);

            circle.on('mouseover', function (e) {
                this.openPopup();
            });
            circle.on('mouseout', function (e) {
                this.closePopup();
            });
            dangerMarkers.push(circle);
        });

        // Fit map
        if (dangerMarkers.length > 0) {
            const group = L.featureGroup(dangerMarkers);
            dangerMapInstance.fitBounds(group.getBounds().pad(0.25));
        }
    }, 200);
}

// ────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────
// PAGE — REPORTS & ANALYTICS (ENRICHED)
// ────────────────────────────────────────────────────────────────
let rptSeverityChartInst = null;

let rptConfChartInst     = null;
let rptDispatchChartInst = null;
let rptAccidentsData     = [];
let rptAnalyticsData     = [];
let rptDispatchData      = [];

async function loadReportsPage() {
    const tbody = document.getElementById('reports-accidents-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;color:var(--text-muted);padding:30px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading data...</td></tr>`;

    try {
        const [accRes, anlRes, dspRes] = await Promise.all([
            fetch(`${API}/api/accidents`),
            fetch(`${API}/api/analytics`),
            fetch(`${API}/api/dispatch-cases`)
        ]);
        rptAccidentsData = await accRes.json();
        rptAnalyticsData = await anlRes.json();
        rptDispatchData  = await dspRes.json();

        if (!Array.isArray(rptAccidentsData)) rptAccidentsData = [];
        if (!Array.isArray(rptAnalyticsData)) rptAnalyticsData = [];
        if (!Array.isArray(rptDispatchData))  rptDispatchData  = [];

        // Owner: only show their vehicle's data
        const curRole = (currentUser && currentUser.role || '').toLowerCase();
        if (currentUser && (curRole === 'owner' || curRole === 'user') && currentUser.vehicle_id) {
            rptAccidentsData = rptAccidentsData.filter(a => a.vehicle_id === currentUser.vehicle_id);
            rptDispatchData  = rptDispatchData.filter(d => d.vehicle_id === currentUser.vehicle_id);
        }

        renderReportStats(rptAccidentsData, rptDispatchData);
        renderReportCharts(rptAccidentsData, rptAnalyticsData, rptDispatchData);
        renderReportTable(rptAccidentsData, rptDispatchData);

    } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;color:var(--critical);padding:30px;">⚠️ Failed to load report data: ${e.message}</td></tr>`;
        console.error("loadReportsPage Error:", e);
    }
}

function renderReportStats(accidents, dispatches) {
    let critical = 0, severe = 0, moderate = 0, minor = 0, confSum = 0;
    accidents.forEach(a => {
        const sev = (a.severity || '').toUpperCase();
        if      (sev === 'CRITICAL')                 critical++;
        else if (sev === 'SEVERE' || sev === 'MAJOR') severe++;
        else if (sev === 'MODERATE')                 moderate++;
        else if (sev === 'MINOR')                    minor++;
        if (a.confidence_score) confSum += parseFloat(a.confidence_score);
    });
    const dispatched = dispatches.filter(d => {
        const amb = (d.ambulance_status || '').toUpperCase();
        const pol = (d.police_status || '').toUpperCase();
        const s = (d.dispatch_status || '').toUpperCase();
        return amb === 'DISPATCHED' || pol === 'DISPATCHED' || s === 'DISPATCHED' || s === 'ARRIVED' || s === 'COMPLETED';
    }).length;
    const avgConf = accidents.length ? (confSum / accidents.length).toFixed(1) : '—';

    const el = id => document.getElementById(id);
    const set = (id, val) => {
        const target = el(id);
        if (target) {
            if (typeof val === 'number') target.innerText = val.toLocaleString();
            else target.innerText = val ?? '—';
        }
    };
    set('rpt-total',      accidents.length);
    set('rpt-critical',   critical);
    set('rpt-severe',     severe);
    set('rpt-moderate',   moderate);
    set('rpt-minor',      minor);
    set('rpt-dispatched', dispatched);
    if (el('rpt-avg-conf'))   el('rpt-avg-conf').innerText   = avgConf + (accidents.length ? '%' : '');
    if (el('rpt-record-count')) el('rpt-record-count').innerText = `${accidents.length.toLocaleString()} records`;
}

function renderReportCharts(accidents, analyticsData, dispatches) {
    // ── 1. Severity Doughnut ──
    let critical = 0, severe = 0, moderate = 0, minor = 0;
    accidents.forEach(a => {
        const sev = (a.severity || '').toUpperCase();
        if      (sev === 'CRITICAL')                  critical++;
        else if (sev === 'SEVERE' || sev === 'MAJOR')  severe++;
        else if (sev === 'MODERATE')                  moderate++;
        else if (sev === 'MINOR')                     minor++;
    });

    const total = critical + severe + moderate + minor;
    const formatLabel = (name, count) => {
        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0';
        return `${name}: ${count.toLocaleString()} (${pct}%)`;
    };

    const pieCtx = document.getElementById('rptSeverityChart');
    if (pieCtx) {
        if (rptSeverityChartInst) rptSeverityChartInst.destroy();
        rptSeverityChartInst = new Chart(pieCtx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: [
                    formatLabel('Critical', critical),
                    formatLabel('Severe', severe),
                    formatLabel('Moderate', moderate),
                    formatLabel('Minor', minor)
                ],
                datasets: [{
                    data: [critical, severe, moderate, minor],
                    backgroundColor: ['#ff2a5f','#ffb300','#00e676','#00e5ff'],
                    borderWidth: 2,
                    borderColor: '#0a1126'
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                cutout: '70%',
                plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 12, font: { size: 10 } } } }
            }
        });
    }




    // ── 3. Confidence Score Line ──
    const confLabels = accidents.slice(-10).map((a, i) => {
        try {
            const d = new Date(a.created_at || a.event_timestamp);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch {
            return `Acc ${i+1}`;
        }
    });
    const confData = accidents.slice(-10).map(a => parseFloat(a.confidence_score) || 0);
    const confCtx = document.getElementById('rptConfChart');
    if (confCtx) {
        if (rptConfChartInst) rptConfChartInst.destroy();
        rptConfChartInst = new Chart(confCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: confLabels,
                datasets: [{
                    label: 'Confidence %',
                    data: confData,
                    borderColor: 'rgba(0, 229, 255, 1)',
                    backgroundColor: 'rgba(0, 229, 255, 0.08)',
                    pointBackgroundColor: 'rgba(0, 229, 255, 1)',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 1.5,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.35,
                    fill: true
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { min: 0, max: 100, ticks: { color: '#94a3b8', callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
                }
            }
        });
    }

    // ── 4. Dispatch Status Doughnut ──
    let dispatchedCount = 0, completedCount = 0;
    dispatches.forEach(d => {
        const amb = (d.ambulance_status || '').toUpperCase();
        const pol = (d.police_status || '').toUpperCase();
        if (amb === 'DISPATCHED' || pol === 'DISPATCHED') {
            completedCount++;
        } else {
            dispatchedCount++;
        }
    });

    const totalDisp = dispatchedCount + completedCount;
    const compPct = totalDisp > 0 ? Math.round((completedCount / totalDisp) * 100) : 0;
    const dispPct = totalDisp > 0 ? (100 - compPct) : 0;

    const dspCtx = document.getElementById('rptDispatchChart');
    if (dspCtx) {
        if (rptDispatchChartInst) rptDispatchChartInst.destroy();
        rptDispatchChartInst = new Chart(dspCtx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: [`Completed ${compPct}%`, `Dispatched ${dispPct}%`],
                datasets: [{
                    data: [completedCount, dispatchedCount],
                    backgroundColor: ['#00e676', '#00e5ff'],
                    borderWidth: 2,
                    borderColor: '#0a1126'
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                cutout: '70%',
                plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 10, font: { size: 10 } } } }
            }
        });
    }
}

function fmtDateTime(str) {
    if (!str) return '—';
    try {
        const d = new Date(str);
        if (isNaN(d.getTime())) return str;
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch {
        return str;
    }
}

function renderReportTable(accidents, dispatches) {
    const tbody = document.getElementById('reports-accidents-tbody');
    if (!tbody) return;
    if (!accidents.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px;">No accident records found.</td></tr>`;
        return;
    }

    // Build dispatch lookup by event_id
    const dispatchMap = {};
    dispatches.forEach(d => { if (d.event_id) dispatchMap[d.event_id] = d; });

    tbody.innerHTML = accidents.map((a, idx) => {
        const sev  = (a.severity || 'UNKNOWN').toUpperCase();
        const loc = getCairoLocationName(a.latitude, a.longitude);
        const conf = a.confidence_score ? parseFloat(a.confidence_score).toFixed(1) + '%' : '—';
        const d    = dispatchMap[a.event_id];

        let dispStatus = 'PENDING';
        if (d) {
            const amb = (d.ambulance_status || '').toUpperCase();
            const pol = (d.police_status || '').toUpperCase();
            if (amb === 'DISPATCHED' || pol === 'DISPATCHED') {
                dispStatus = 'COMPLETED';
            } else {
                dispStatus = (d.dispatch_status || 'PENDING').toUpperCase();
            }
        }
        let dispBadge = '';
        if (dispStatus === 'COMPLETED') {
            dispBadge = `<span style="background:rgba(0,230,118,0.08);color:#00e676;border:1px solid rgba(0,230,118,0.3);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;"><i class="fa-solid fa-circle-check" style="font-size:10px;margin-right:4px;"></i>Completed</span>`;
        } else if (dispStatus === 'DISPATCHED' || dispStatus === 'ARRIVED') {
            dispBadge = `<span style="background:rgba(0,229,255,0.08);color:var(--primary);border:1px solid rgba(0,229,255,0.3);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;"><i class="fa-solid fa-truck-medical" style="font-size:10px;margin-right:4px;"></i>Dispatched</span>`;
        } else {
            dispBadge = `<span style="background:rgba(168,85,247,0.08);color:#a855f7;border:1px solid rgba(168,85,247,0.3);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;"><i class="fa-solid fa-clock" style="font-size:10px;margin-right:4px;"></i>Pending</span>`;
        }

        const dateStr = fmtDateTime(a.created_at || a.event_timestamp);

        return `<tr>
            <td style="font-family:var(--font-mono);font-size:11px;font-weight:700;color:var(--text-muted);">${a.event_id ? a.event_id.substring(0, 10) : '—'}</td>
            <td style="font-size:12px;">${dateStr}</td>
            <td style="font-weight:600;color:var(--text-primary);">${loc}</td>
            <td>${sevPill(sev)}</td>
            <td>
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="flex:1;background:var(--bg-tertiary);border-radius:4px;height:6px;overflow:hidden;min-width:60px;">
                        <div style="width:${Math.min(parseFloat(a.confidence_score)||0,100)}%;height:100%;background:#00e5ff;border-radius:4px;"></div>
                    </div>
                    <span style="font-size:11px;color:var(--primary);min-width:34px;font-weight:700;">${conf}</span>
                </div>
            </td>
            <td>${dispBadge}</td>
        </tr>`;
    }).join('');
}

function downloadReport() {
    const element = document.getElementById('reports-page');
    if (!element) return;

    const actionButtons = document.getElementById('reports-action-buttons');
    if (actionButtons) {
        actionButtons.style.display = 'none';
    }

    // Apply the high-contrast styling class for PDF export
    element.classList.add('pdf-export');

    // Configure PDF settings
    const opt = {
        margin:       [10, 10, 10, 10],
        filename:     `SmartTraffic_Report_${new Date().toISOString().slice(0, 10)}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  {
            scale: 2,
            useCORS: true,
            backgroundColor: '#020610',
            logging: false
        },
        jsPDF:        { unit: 'mm', format: 'a3', orientation: 'landscape' }
    };

    // Use html2pdf to download the live page element styled via CSS
    html2pdf().set(opt).from(element).save().then(() => {
        // Restore styling and buttons
        element.classList.remove('pdf-export');
        if (actionButtons) {
            actionButtons.style.display = 'flex';
        }
    }).catch(err => {
        console.error("PDF generation error: ", err);
        element.classList.remove('pdf-export');
        if (actionButtons) {
            actionButtons.style.display = 'flex';
        }
        alert("Failed to generate PDF report.");
    });
}

// ────────────────────────────────────────────────────────────────
// PAGE 5 — DISPATCH CASES
// ────────────────────────────────────────────────────────────────
let availableUnits = [];

let currentDispatchCases = [];

async function loadDispatchCases() {
    const tbody = document.getElementById('dispatch-table-body');
    tbody.innerHTML = loadingRow(10);
    try {
        if (!availableUnits.length) {
            const uRes = await fetch(`${API}/api/units`);
            availableUnits = await uRes.json();
        }
        const res  = await fetch(`${API}/api/dispatch-cases`);
        const data = await res.json();
        currentDispatchCases = Array.isArray(data) ? data : [];
        renderDispatchTable(currentDispatchCases);
    } catch (e) {
        tbody.innerHTML = errorRow(10, 'Failed to load dispatch cases.');
    }
}

function renderDispatchTable(cases) {
    const tbody = document.getElementById('dispatch-table-body');
    if (!cases.length) { tbody.innerHTML = emptyRow(10, 'No dispatch cases found.'); return; }

    tbody.innerHTML = cases.map(c => {
        const sev    = (c.severity        || 'UNKNOWN').toUpperCase();
        let status = (c.dispatch_status || 'UNKNOWN').toUpperCase();
        const amb    = (c.ambulance_status|| '—').toUpperCase();
        const pol    = (c.police_status   || '—').toUpperCase();

        if (amb === 'DISPATCHED' || pol === 'DISPATCHED') {
            status = 'COMPLETED';
        }

        const sevCol = sevColor(sev);
        const stCol  = (status === 'COMPLETED' || status === 'DISPATCHED') ? 'var(--minor)'
                     : (status === 'PENDING' || status === 'NEW') ? 'var(--critical)'
                     : 'var(--text-muted)';

        let actions = '';

        actions = `<div style="display:flex; flex-direction:column; gap:4px;">`;
        if (amb !== 'DISPATCHED') {
            actions += `<button class="btn-primary" style="font-size:10px; padding:4px 8px;" onclick="awsDispatchResponse('${c.case_id}', 'ambulance')">Dispatch Ambulance</button>`;
        }
        if (pol !== 'DISPATCHED') {
            actions += `<button class="btn-secondary" style="font-size:10px; padding:4px 8px;" onclick="awsDispatchResponse('${c.case_id}', 'police')">Dispatch Police</button>`;
        }
        actions += `</div>`;

        if (amb === 'DISPATCHED' && pol === 'DISPATCHED') {
            actions = '<span style="color:var(--minor);font-weight:bold;font-size:11px;">Fully Dispatched</span>';
        }

        const ambText = amb === 'DISPATCHED' ? `<span style="color:var(--minor);font-weight:bold;">DISPATCHED</span>` : amb;
        const polText = pol === 'DISPATCHED' ? `<span style="color:var(--minor);font-weight:bold;">DISPATCHED</span>` : pol;

        return `
        <tr>
            <td style="font-weight:700;color:var(--primary);font-size:12px;">${c.case_id  || '—'}</td>
            <td style="font-size:12px;">${c.event_id  || '—'}</td>
            <td>${c.vehicle_id || '—'}</td>
            <td>${c.obu_serial || '—'}</td>
            <td>${sevPill(sev)}</td>
            <td><span style="font-weight:700;color:${stCol};">${status}</span></td>
            <td style="font-size:12px;color:var(--text-secondary);">${ambText}</td>
            <td style="font-size:12px;color:var(--text-secondary);">${polText}</td>
            <td style="font-size:12px;">${fmtDate(c.created_at)}</td>
            <td>
              <div style="display:flex;flex-direction:column;gap:4px;">
                ${actions.replace('<div style="display:flex; flex-direction:column; gap:4px;">', '').replace('</div>', '')}
                <button class="btn-secondary" style="font-size:10px;padding:4px 8px;background:rgba(99,102,241,0.15);border-color:rgba(99,102,241,0.4);color:#a5b4fc;" onclick="openGpsOverlay('${c.case_id}')">📍 Location</button>
              </div>
            </td>
        </tr>`;
    }).join('');
}

async function openGpsOverlay(caseId) {
    const c = currentDispatchCases.find(x => x.case_id === caseId);
    if (!c) return;

    const overlay = document.getElementById('gps-location-overlay');

    // Populate static fields
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val || '—'; };
    const setHtml = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val || '—'; };

    set('gps-lat',            c.latitude  ? parseFloat(c.latitude).toFixed(6)  : '—');
    set('gps-lng',            c.longitude ? parseFloat(c.longitude).toFixed(6) : '—');
    set('gps-acc-event-id',   c.event_id  || '—');
    set('gps-acc-vehicle-id', c.vehicle_id || '—');
    setHtml('gps-acc-severity-container', sevPill((c.severity || '').toUpperCase()));
    set('gps-district',       '');
    set('gps-data-source',    'Local DB');
    set('gps-last-seen',      fmtDate(c.created_at));

    // Accident Timestamp
    let accTs = '—';
    if (c.acc_created_at) {
        accTs = fmtDate(c.acc_created_at);
    } else if (c.created_at) {
        accTs = fmtDate(c.created_at);
    } else if (c.event_timestamp) {
        const ts = parseInt(c.event_timestamp, 10);
        accTs = isNaN(ts) ? fmtDate(c.event_timestamp) : fmtDate(new Date(ts * 1000).toISOString());
    }
    set('gps-acc-timestamp', accTs);

    // Google Maps link
    const mapsLink = document.getElementById('gps-maps-link');
    if (mapsLink && c.latitude && c.longitude) {
        mapsLink.href = `https://www.google.com/maps?q=${c.latitude},${c.longitude}`;
    }

    // Road name via reverse geocode
    const rdName = document.getElementById('gps-road-name');
    const rdAcc  = document.getElementById('gps-acc-road-name');
    if (rdName) rdName.innerText = 'Fetching road name…';
    if (rdAcc)  rdAcc.innerText  = 'Fetching road name…';

    overlay.style.display = 'flex';

    if (c.latitude && c.longitude) {
        // 1. Instant local lookup
        const localRoad = getCairoLocationName(parseFloat(c.latitude), parseFloat(c.longitude));
        if (localRoad && localRoad !== 'Cairo Sector') {
            if (rdName) rdName.innerText = localRoad;
            if (rdAcc)  rdAcc.innerText  = localRoad;
        } else {
            // 2. Fallback: Nominatim reverse geocode
            try {
                const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${c.latitude}&lon=${c.longitude}&format=json`, { headers: { 'Accept-Language': 'en' } });
                const geo = await r.json();
                const addr = geo.address || {};
                const road = addr.road || addr.pedestrian || addr.footway || addr.street
                           || addr.suburb || addr.neighbourhood || addr.city_district
                           || addr.city || getCairoLocationName(parseFloat(c.latitude), parseFloat(c.longitude));
                if (rdName) rdName.innerText = road;
                if (rdAcc)  rdAcc.innerText  = road;
                const district = [addr.suburb, addr.city_district, addr.city].filter(Boolean).join(', ');
                set('gps-district', district);
            } catch (_) {
                const fallback = getCairoLocationName(parseFloat(c.latitude), parseFloat(c.longitude));
                if (rdName) rdName.innerText = fallback;
                if (rdAcc)  rdAcc.innerText  = fallback;
            }
        }
    }
}

async function dispatchResponse(caseId, type, unitId) {
    if (!confirm(`Are you sure you want to dispatch ${unitId} (${type}) for case ${caseId}?`)) return;

    const payload = { case_id: caseId };
    if (type === 'ambulance') payload.ambulance_status = 'DISPATCHED';
    if (type === 'police') payload.police_status = 'DISPATCHED';

    try {
        const res = await fetch(`${API}/api/dispatch-response`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            loadDispatchCases();
        } else {
            alert('Error dispatching: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        alert('Network error while dispatching.');
    }
}

async function awsDispatchResponse(caseId, type) {
    if (!confirm(`Are you sure you want to dispatch ${type} for case ${caseId}?`)) return;

    const payload = { case_id: caseId };
    if (type === 'ambulance') payload.ambulance_status = 'DISPATCHED';
    if (type === 'police') payload.police_status = 'DISPATCHED';

    try {
        const res = await fetch(`https://2ps2t9na2m.execute-api.eu-central-1.amazonaws.com/dispatch-response`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        let data;
        try {
            data = await res.json();
        } catch (err) {
            data = {};
        }

        if (res.ok) {
            // Show Success Modal
            const caseData = currentDispatchCases.find(c => c.case_id === caseId);
            const typeCapitalized = type.charAt(0).toUpperCase() + type.slice(1);

            document.getElementById('dispatch-success-text').innerHTML = `Accident information and location have been successfully dispatched to the nearest <strong>${typeCapitalized}</strong> center.`;

            if (caseData) {
                document.getElementById('ds-event-id').innerText = caseData.event_id || '—';
                document.getElementById('ds-vehicle').innerText = caseData.vehicle_id || '—';
                document.getElementById('ds-severity').innerHTML = sevPill((caseData.severity || '').toUpperCase());
                document.getElementById('ds-gps').innerText = (caseData.latitude && caseData.longitude) ? `${parseFloat(caseData.latitude).toFixed(5)}, ${parseFloat(caseData.longitude).toFixed(5)}` : '—';
                document.getElementById('ds-time').innerText = fmtDate(caseData.created_at);

                // ── Accident Timestamp ──
                let accTs = '—';
                if (caseData.acc_created_at) {
                    accTs = fmtDate(caseData.acc_created_at);
                } else if (caseData.created_at) {
                    accTs = fmtDate(caseData.created_at);
                } else if (caseData.event_timestamp) {
                    const ts = parseInt(caseData.event_timestamp, 10);
                    accTs = isNaN(ts) ? fmtDate(caseData.event_timestamp) : fmtDate(new Date(ts * 1000).toISOString());
                }
                const dsAccTs = document.getElementById('ds-acc-timestamp');
                if (dsAccTs) dsAccTs.innerText = accTs;

                // ── Road Name (reverse geocode via Nominatim) ──
                const dsRoadName  = document.getElementById('ds-road-name');
                const dsAccRoad   = document.getElementById('ds-acc-road-name');
                const roadLoading = 'Fetching road name…';
                if (dsRoadName)  dsRoadName.innerText  = roadLoading;
                if (dsAccRoad)   dsAccRoad.innerText   = roadLoading;

                if (caseData.latitude && caseData.longitude) {
                    // 1. Try local GPS lookup first (instant, no network)
                    const localRoad = getCairoLocationName(
                        parseFloat(caseData.latitude),
                        parseFloat(caseData.longitude)
                    );
                    if (localRoad && localRoad !== 'Cairo Sector') {
                        if (dsRoadName) dsRoadName.innerText = localRoad;
                        if (dsAccRoad)  dsAccRoad.innerText  = localRoad;
                    } else {
                        // 2. Fallback: try Nominatim reverse geocode
                        if (dsRoadName) dsRoadName.innerText = 'Resolving…';
                        if (dsAccRoad)  dsAccRoad.innerText  = 'Resolving…';
                        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${caseData.latitude}&lon=${caseData.longitude}&format=json`, {
                            headers: { 'Accept-Language': 'en' }
                        }).then(r => r.json()).then(geo => {
                            const addr = geo.address || {};
                            const road = addr.road || addr.pedestrian || addr.footway
                                       || addr.street || addr.suburb || addr.neighbourhood
                                       || addr.city_district || addr.city
                                       || getCairoLocationName(parseFloat(caseData.latitude), parseFloat(caseData.longitude));
                            if (dsRoadName) dsRoadName.innerText = road;
                            if (dsAccRoad)  dsAccRoad.innerText  = road;
                        }).catch(() => {
                            const fallback = getCairoLocationName(parseFloat(caseData.latitude), parseFloat(caseData.longitude));
                            if (dsRoadName) dsRoadName.innerText = fallback;
                            if (dsAccRoad)  dsAccRoad.innerText  = fallback;
                        });
                    }
                } else {
                    if (dsRoadName)  dsRoadName.innerText  = '—';
                    if (dsAccRoad)   dsAccRoad.innerText   = '—';
                }
            }

            document.getElementById('dispatch-success-modal').style.display = 'flex';

            loadDispatchCases();
        } else {
            alert('Error dispatching: ' + (data.message || data.error || 'Unknown error'));
        }
    } catch (e) {
        alert('Network error while dispatching.');
    }
}

// ────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────
// PUBLIC USER REGISTRATION (Auth Screen)
// ────────────────────────────────────────────────────────────────
function updatePhonePlaceholder() {
    const select = document.getElementById('register-country-code');
    if (!select) return;
    const option = select.options[select.selectedIndex];
    const digits = option.getAttribute('data-digits');
    const countryCode = option.value;
    const phoneInput = document.getElementById('register-phone');
    if (!phoneInput) return;

    let placeholder = "";
    if (countryCode === "+20") {
        placeholder = "1012345678";
    } else {
        placeholder = "5" + Array.from({length: parseInt(digits) - 1}, (_, i) => (i + 1) % 10).join('');
    }

    phoneInput.placeholder = placeholder;
    phoneInput.pattern = `[0-9]{${digits}}`;
    phoneInput.title = `Must be exactly ${digits} digits`;

    const hintEl = document.getElementById('phone-hint');
    if (hintEl) {
        hintEl.textContent = `${option.text.split(' ')[0]} requires exactly ${digits} digits (e.g. ${placeholder})`;
    }
}

function updateUserMgmtPhonePlaceholder() {
    const select = document.getElementById('um-country-code');
    if (!select) return;
    const option = select.options[select.selectedIndex];
    const digits = option.getAttribute('data-digits');
    const countryCode = option.value;
    const phoneInput = document.getElementById('um-phone');
    if (!phoneInput) return;

    let placeholder = "";
    if (countryCode === "+20") {
        placeholder = "1012345678";
    } else {
        placeholder = "5" + Array.from({length: parseInt(digits) - 1}, (_, i) => (i + 1) % 10).join('');
    }

    phoneInput.placeholder = placeholder;
    phoneInput.pattern = `[0-9]{${digits}}`;
    phoneInput.title = `Must be exactly ${digits} digits`;

    const hintEl = document.getElementById('um-phone-hint');
    if (hintEl) {
        hintEl.textContent = `${option.text.split(' ')[0]} requires exactly ${digits} digits (e.g. ${placeholder})`;
    }
}

function updateAdminMgmtPhonePlaceholder() {
    const select = document.getElementById('am-country-code');
    if (!select) return;
    const option = select.options[select.selectedIndex];
    const digits = option.getAttribute('data-digits');
    const countryCode = option.value;
    const phoneInput = document.getElementById('am-phone');
    if (!phoneInput) return;

    let placeholder = "";
    if (countryCode === "+20") {
        placeholder = "1012345678";
    } else {
        placeholder = "5" + Array.from({length: parseInt(digits) - 1}, (_, i) => (i + 1) % 10).join('');
    }

    phoneInput.placeholder = placeholder;
    phoneInput.pattern = `[0-9]{${digits}}`;
    phoneInput.title = `Must be exactly ${digits} digits`;

    const hintEl = document.getElementById('am-phone-hint');
    if (hintEl) {
        hintEl.textContent = `${option.text.split(' ')[0]} requires exactly ${digits} digits (e.g. ${placeholder})`;
    }
}

function parseStoredPhone(fullPhone) {
    const countryCodes = ["+966", "+971", "+974", "+965", "+968", "+973", "+962", "+964", "+212", "+216", "+218", "+249", "+20", "+1", "+44", "+49", "+33"];
    fullPhone = (fullPhone || '').trim();
    for (let code of countryCodes) {
        if (fullPhone.startsWith(code)) {
            return {
                countryCode: code,
                rawPhone: fullPhone.substring(code.length)
            };
        }
    }
    return {
        countryCode: "+20",
        rawPhone: fullPhone
    };
}

function toggleAuthTab(tab) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');

    if (tab === 'login') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        tabLogin.classList.remove('active');
        tabRegister.classList.add('active');
        updatePhonePlaceholder();
    }
}

async function handleRegisterSubmit(event) {
    event.preventDefault();
    const errEl  = document.getElementById('register-error');
    const succEl = document.getElementById('register-success');
    const btn    = document.getElementById('btn-register-submit');

    const userId   = document.getElementById('register-userid').value.trim();
    const name     = document.getElementById('register-name').value.trim();
    const email    = document.getElementById('register-email').value.trim();
    const countryCode = document.getElementById('register-country-code').value;
    const rawPhone    = document.getElementById('register-phone').value.trim();
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;
    const role     = 'owner'; // Default normal user role

    errEl.style.display  = 'none';
    succEl.style.display = 'none';

    if (password !== confirmPassword) {
        errEl.innerText = "Passwords do not match.";
        errEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registering...';

    // Verify phone digit count matching data-digits
    const select = document.getElementById('register-country-code');
    const option = select.options[select.selectedIndex];
    const digits = parseInt(option.getAttribute('data-digits'));
    if (!/^\d+$/.test(rawPhone) || rawPhone.length !== digits) {
        errEl.innerText = `Phone number must be exactly ${digits} digits.`;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = '<span>Sign Up &amp; Save to Cloud</span><i class="fa-solid fa-user-plus"></i>';
        return;
    }
    const phone = countryCode + rawPhone;

    try {
        const res  = await fetch(`${API}/api/register-user`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ user_id: userId, name, email, phone, password, role })
        });
        const data = await res.json();

        if (!res.ok || data.error) {
            errEl.innerText     = data.error || 'Failed to register.';
            errEl.style.display = 'block';
        } else {
            // Show success with the user_id prominently
            succEl.innerHTML = `
                <div style="text-align:center;">
                    <div style="font-size:13px;margin-bottom:10px;">✅ Registration successful!</div>
                    <div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.4);border-radius:10px;padding:12px 16px;margin-bottom:10px;">
                        <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em;">Your User ID — احفظه كويس</div>
                        <div style="font-size:20px;font-weight:800;font-family:monospace;letter-spacing:2px;color:var(--minor);" id="reg-userid-display">${userId}</div>
                    </div>
                    <button onclick="navigator.clipboard.writeText('${userId}').then(()=>{this.innerHTML='<i class=\'fa-solid fa-check\'></i> Copied!';setTimeout(()=>{this.innerHTML='<i class=\'fa-solid fa-copy\'></i> Copy User ID';},1500)})"
                        style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.4);color:var(--minor);padding:6px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">
                        <i class="fa-solid fa-copy"></i> Copy User ID
                    </button>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:10px;">ستحتاج هذا الـ ID عند تفعيل الجهاز — Signing in...</div>
                </div>`;
            succEl.style.display = 'block';
            document.getElementById('register-form').reset();
            setTimeout(() => {
                toggleAuthTab('login');
                document.getElementById('login-email').value = email;
                succEl.style.display = 'none';
            }, 5000);
        }
    } catch (e) {
        errEl.innerText     = '❌ Cannot reach server. Please start server.py first.';
        errEl.style.display = 'block';
    }
    btn.disabled  = false;
    btn.innerHTML = '<span>Sign Up &amp; Save to Cloud</span><i class="fa-solid fa-user-plus"></i>';
}

// ────────────────────────────────────────────────────────────────
// PAGE 7 — ACTIVATE DEVICE (Owner)
// ────────────────────────────────────────────────────────────────
async function handleActivateSubmit(event) {
    event.preventDefault();
    const feedback  = document.getElementById('activate-feedback');
    const btn       = document.getElementById('btn-activate-submit');

    const userId    = document.getElementById('act-user-id').value.trim();
    const vehicleId = document.getElementById('act-vehicle-id').value.trim();
    const obuSerial = document.getElementById('act-obu-serial').value.trim();

    if (!userId) {
        feedback.style.cssText = 'display:block;background:rgba(239,68,68,0.1);color:var(--critical);padding:12px;border-radius:8px;';
        feedback.innerText = '❌ Please enter your User ID.';
        return;
    }
    if (currentUser && currentUser.user_id && userId !== currentUser.user_id) {
        feedback.style.cssText = 'display:block;background:rgba(239,68,68,0.1);color:var(--critical);padding:12px;border-radius:8px;';
        feedback.innerText = '❌ The User ID you entered does not match your registered User ID.';
        return;
    }

    btn.disabled  = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Activating...';
    feedback.style.display = 'none';

    try {
        const res  = await fetch(`${API}/api/activate`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                user_id: userId,
                vehicle_id: vehicleId,
                obu_serial: obuSerial,
                email: currentUser.email
            })
        });
        const data = await res.json();

        if (data.error) {
            feedback.style.cssText = 'display:block;background:rgba(239,68,68,0.1);color:var(--critical);padding:12px;border-radius:8px;';
            feedback.innerText = '❌ ' + data.error;
        } else {
            feedback.style.cssText = 'display:block;background:rgba(16,185,129,0.1);color:var(--minor);padding:12px;border-radius:8px;';
            feedback.innerText = '✅ Device activated! Linking to your account...';

            // Update currentUser with full server response (includes device_serial)
            if (data.email) {
                // Server returned full updated user object
                currentUser = data;
            } else {
                // Fallback: update fields manually
                currentUser.device_serial = obuSerial;
                currentUser.vehicle_id = vehicleId;
            }
            isActivated = true;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));

            // Hide lock banner
            const lockBanner = document.getElementById('activation-required-banner');
            if (lockBanner) lockBanner.style.display = 'none';

            // Unlock nav for Owner
            adjustNavForRole(currentUser.role, true);

            // Redirect to Emergency Contact page after short delay
            setTimeout(() => {
                switchPage('emergency');
            }, 1500);
        }
    } catch (e) {
        feedback.style.cssText = 'display:block;background:rgba(239,68,68,0.1);color:var(--critical);padding:12px;border-radius:8px;';
        feedback.innerText = '❌ Server connection failed. Is server.py running?';
    }

    btn.disabled  = false;
    btn.innerHTML = '<i class="fa-solid fa-satellite-dish"></i><span>Activate &amp; Connect Device</span>';
}

// ────────────────────────────────────────────────────────────────
// PAGE 7.5 — EMERGENCY CONTACT SETUP
// ────────────────────────────────────────────────────────────────

// Helper: refresh the "current contact" display card
function refreshEmergencyContactDisplay() {
    const card  = document.getElementById('emg-current-contact-card');
    const title = document.getElementById('emg-form-title');
    const badge = document.getElementById('emg-form-badge');
    const steps = document.getElementById('emg-progress-steps');
    const skip  = document.getElementById('btn-emergency-skip');
    if (!card) return;

    const name  = currentUser && currentUser.contact_name;
    const phone = currentUser && currentUser.contact_phone;
    const email = currentUser && currentUser.contact_email;

    if (name && phone) {
        // Show the contact card
        card.style.display = 'block';
        document.getElementById('emg-display-name').innerText  = name;
        document.getElementById('emg-display-phone').innerText = phone;
        document.getElementById('emg-display-email').innerText = email || '—';

        // Switch to "Edit" mode labels
        if (title) title.innerText = 'Update Emergency Contact';
        if (badge) { badge.innerText = 'EDIT MODE'; badge.style.background = 'rgba(0,229,255,0.1)'; badge.style.color = 'var(--primary)'; badge.style.borderColor = 'rgba(0,229,255,0.3)'; }
        if (steps) steps.style.display = 'none';
        if (skip)  skip.style.display  = 'none';
    } else {
        card.style.display = 'none';
        if (title) title.innerText = 'Set Emergency Contact';
        if (badge) { badge.innerText = 'REQUIRED AFTER ACTIVATION'; badge.style.background = ''; badge.style.color = ''; badge.style.borderColor = ''; }
        if (steps) steps.style.display = 'flex';
        if (skip)  skip.style.display  = '';
    }
}

async function handleEmergencyContactSubmit(event) {
    event.preventDefault();
    if (!currentUser) return;

    const contactName  = document.getElementById('emg-contact-name').value.trim();
    const contactPhone = document.getElementById('emg-contact-phone').value.trim();
    const contactEmail = document.getElementById('emg-contact-email').value.trim();
    const feedback     = document.getElementById('emergency-feedback');
    const btn          = document.getElementById('btn-emergency-submit');
    const isEdit       = !!(currentUser.contact_name && currentUser.contact_phone);

    btn.disabled  = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    feedback.style.display = 'none';

    try {
        const res = await fetch(`${API}/api/device/settings`, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'X-User-Email':  currentUser.email
            },
            body: JSON.stringify({
                email:        currentUser.email,
                contactName:  contactName,
                contactPhone: contactPhone,
                contactEmail: contactEmail
            })
        });
        const data = await res.json();

        if (data.error) {
            feedback.style.cssText = 'display:block;background:rgba(239,68,68,0.1);color:var(--critical);padding:12px;border-radius:8px;';
            feedback.innerText = '\u274C ' + data.error;
        } else {
            // Update local user object
            currentUser.contact_name  = contactName;
            currentUser.contact_phone = contactPhone;
            currentUser.contact_email = contactEmail;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));

            if (isEdit) {
                // Already in edit mode → refresh display in-place, no redirect
                refreshEmergencyContactDisplay();
                feedback.style.cssText = 'display:block;background:rgba(16,185,129,0.1);color:var(--minor);padding:12px;border-radius:8px;';
                feedback.innerText = '\u2705 Emergency contact updated successfully!';
            } else {
                // First-time setup → redirect to My Vehicle
                feedback.style.cssText = 'display:block;background:rgba(16,185,129,0.1);color:var(--minor);padding:12px;border-radius:8px;';
                feedback.innerText = '\u2705 Emergency contact saved! Redirecting to My Vehicle...';
                setTimeout(() => { switchPage('myvehicle'); }, 1400);
            }
        }
    } catch (e) {
        feedback.style.cssText = 'display:block;background:rgba(239,68,68,0.1);color:var(--critical);padding:12px;border-radius:8px;';
        feedback.innerText = '\u274C Server connection failed. Please try again.';
    }

    btn.disabled  = false;
    btn.innerHTML = '<i class="fa-solid fa-shield-heart"></i><span>Save Emergency Contact</span>';
}

function skipEmergencyContact() {
    switchPage('myvehicle');
}

function loadEmergencyContactPage() {
    if (!currentUser) return;
    // Pre-fill form with saved values
    document.getElementById('emg-contact-name').value  = currentUser.contact_name  || '';
    document.getElementById('emg-contact-phone').value = currentUser.contact_phone || '';
    document.getElementById('emg-contact-email').value = currentUser.contact_email || '';

    // Reset feedback & button
    const feedback = document.getElementById('emergency-feedback');
    if (feedback) feedback.style.display = 'none';
    const btn = document.getElementById('btn-emergency-submit');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-shield-heart"></i><span>Save Emergency Contact</span>'; }

    // Show/hide contact card and toggle labels
    refreshEmergencyContactDisplay();
}


function drawSchematicLines() {
    const wrapper = document.querySelector('.schematic-wrapper');
    if (!wrapper) return;
    const imu = document.querySelector('.imu-side-block');
    const gps = document.querySelector('.gps-side-block');
    const mcu = document.querySelector('.mcu-center-block');
    const pathImu = document.getElementById('line-imu-mcu');
    const pathGps = document.getElementById('line-gps-mcu');
    if (!imu || !gps || !mcu || !pathImu || !pathGps) return;

    const wrapRect = wrapper.getBoundingClientRect();
    const imuRect = imu.getBoundingClientRect();
    const gpsRect = gps.getBoundingClientRect();
    const mcuRect = mcu.getBoundingClientRect();

    // relative coordinates
    const imuX = (imuRect.left + imuRect.width) - wrapRect.left;
    const imuY = (imuRect.top + imuRect.height / 2) - wrapRect.top;

    const mcuX1 = mcuRect.left - wrapRect.left;
    const mcuY1 = (mcuRect.top + mcuRect.height / 2) - wrapRect.top;

    const mcuX2 = (mcuRect.left + mcuRect.width) - wrapRect.left;
    const mcuY2 = (mcuRect.top + mcuRect.height / 2) - wrapRect.top;

    const gpsX = gpsRect.left - wrapRect.left;
    const gpsY = (gpsRect.top + gpsRect.height / 2) - wrapRect.top;

    // Draw paths with cyber bends
    const midX1 = imuX + 35;
    pathImu.setAttribute('d', `M ${imuX} ${imuY} L ${midX1} ${imuY} L ${midX1} ${mcuY1} L ${mcuX1} ${mcuY1}`);

    const midX2 = gpsX - 35;
    pathGps.setAttribute('d', `M ${gpsX} ${gpsY} L ${midX2} ${gpsY} L ${midX2} ${mcuY2} L ${mcuX2} ${mcuY2}`);
}

window.zoomMyVehicleMapToEvent = function(lat, lng) {
    if (myvehicleLiveMapInstance && lat && lng) {
        myvehicleLiveMapInstance.flyTo([lat, lng], 15, {
            animate: true,
            duration: 1.5
        });
    }
};

async function loadOwnerVehicleData() {
    if (!currentUser || !currentUser.device_serial) return;
    const serial = currentUser.device_serial;

    // Clear previous Leaflet maps if exist
    if (myvehicleLiveMapInstance) {
        myvehicleLiveMapInstance.remove();
        myvehicleLiveMapInstance = null;
    }
    myvehicleLiveMapMarkers = [];

    try {
        // 1. Fetch vehicle data
        const vRes = await fetch(`${API}/api/vehicles`);
        const vehicles = await vRes.json();
        const myV = (Array.isArray(vehicles) ? vehicles : []).find(v => v.obu_serial === serial);

        let vehicleLat = 30.0444;
        let vehicleLng = 31.2357;
        let vehicleStatus = 'ACTIVE';

        if (myV) {
            vehicleStatus = (myV.last_status || 'ACTIVE').toUpperCase();

            // Set serial, vehicle ID, and status badge
            document.getElementById('myvehicle-device-serial').innerText = `Serial: ${myV.obu_serial || serial}`;
            const vidEl = document.getElementById('myvehicle-device-vid');
            if (vidEl) vidEl.innerText = `ID: ${myV.vehicle_id || '—'}`;
            const badgeEl = document.getElementById('myvehicle-device-status-badge');
            if (badgeEl) {
                badgeEl.innerHTML = statusPill(vehicleStatus);
            }
        } else {
            document.getElementById('myvehicle-device-serial').innerText = `Serial: ${serial}`;
            const vidEl = document.getElementById('myvehicle-device-vid');
            if (vidEl) vidEl.innerText = 'ID: —';
            const badgeEl = document.getElementById('myvehicle-device-status-badge');
            if (badgeEl) {
                badgeEl.innerHTML = '<span class="status-pill-glowing offline">PENDING</span>';
            }
        }

        // 2. Fetch user's accidents for analytics
        const aRes = await fetch(`${API}/api/accidents`);
        const allAcc = await aRes.json();
        const myAcc = (Array.isArray(allAcc) ? allAcc : [])
            .filter(a => a.obu_serial === serial)
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        // Total Events
        document.getElementById('myvehicle-total-events').innerText = myAcc.length;

        // Peak Impact G-force calculation
        let maxImpact = 0;
        let latestImpact = 0.0;
        let latestImpactType = 'No events recorded';

        myAcc.forEach(acc => {
            const peak = typeof acc.peak_accel_mag_g === 'number'
                ? acc.peak_accel_mag_g
                : (typeof acc.peakAccelMag_g === 'number' ? acc.peakAccelMag_g : 0);
            if (peak > maxImpact) maxImpact = peak;
        });

        document.getElementById('myvehicle-peak-impact').innerText = maxImpact > 0 ? maxImpact.toFixed(2) + ' G' : '0.00 G';

        // Latest Event info for gauge
        if (myAcc.length > 0) {
            const latestAcc = myAcc[0];
            latestImpact = typeof latestAcc.peak_accel_mag_g === 'number'
                ? latestAcc.peak_accel_mag_g
                : (typeof latestAcc.peakAccelMag_g === 'number' ? latestAcc.peakAccelMag_g : 0.0);

            const sev = (latestAcc.severity || 'UNKNOWN').toUpperCase();
            let eventType = 'V2X LOG: System Ping';
            if (sev === 'CRITICAL') eventType = 'Collision Detect';
            else if (sev === 'SEVERE' || sev === 'MAJOR') eventType = 'Sudden Braking';
            else if (sev === 'MODERATE') eventType = 'Lane Departure';

            latestImpactType = `${eventType} (${timeAgo(latestAcc.created_at || latestAcc.event_timestamp)})`;
        }

        document.getElementById('gforce-latest-alert-title').innerText = latestImpactType;

        // Update G-Force gauge ring & text
        document.getElementById('gforce-gauge-val').innerText = latestImpact.toFixed(1);
        const dashArray = 440; // SVG circle stroke-dasharray
        // scale 0.0 to 5.0 Gs
        const scale = Math.min(Math.max(latestImpact, 0), 5) / 5;
        const dashOffset = dashArray - (dashArray * scale);
        document.getElementById('gforce-gauge-indicator').style.strokeDashoffset = dashOffset;

        // ─── Set Last Accident Location card using accident data ───
        let accidentLat = null;
        let accidentLng = null;
        if (myAcc.length > 0) {
            const latestAcc = myAcc[0];
            const rawLat = parseFloat(latestAcc.latitude);
            const rawLng = parseFloat(latestAcc.longitude);
            if (!isNaN(rawLat) && !isNaN(rawLng)) {
                accidentLat = rawLat;
                accidentLng = rawLng;
            }
        }

        if (accidentLat !== null && accidentLng !== null) {
            document.getElementById('myvehicle-gps-lat').innerText = accidentLat.toFixed(5);
            document.getElementById('myvehicle-gps-lon').innerText = accidentLng.toFixed(5);
            document.getElementById('myvehicle-loc-sector').innerText = `Last Accident — ${fmtDate(myAcc[0].created_at || myAcc[0].event_timestamp)}`;
        } else {
            document.getElementById('myvehicle-gps-lat').innerText = '—';
            document.getElementById('myvehicle-gps-lon').innerText = '—';
            document.getElementById('myvehicle-loc-sector').innerText = 'No accident data yet';
        }

        // 3. Render map on the left — show last accident location only
        const emptyStateEl = document.getElementById('myvehicle-map-empty-state');
        setTimeout(() => {
            const mapContainer = document.getElementById('myvehicle-live-map');
            if (mapContainer) {
                // Use accident location if available, otherwise generic Cairo center (no marker)
                const mapCenter = (accidentLat !== null) ? [accidentLat, accidentLng] : [30.0444, 31.2357];
                const mapZoom = (accidentLat !== null) ? 14 : 11;

                myvehicleLiveMapInstance = L.map('myvehicle-live-map', {
                    zoomControl: true,
                    attributionControl: false
                }).setView(mapCenter, mapZoom);

                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                    maxZoom: 19
                }).addTo(myvehicleLiveMapInstance);

                if (accidentLat !== null && accidentLng !== null) {
                    // Show accident marker in danger color
                    const markerIcon = L.divIcon({
                        className: 'custom-pulsing-marker',
                        html: `
                            <div style="position:relative;">
                                <div style="width:12px;height:12px;border-radius:50%;background:var(--danger);border:2px solid #fff;box-shadow:0 0 8px var(--danger);"></div>
                                <div class="marker-pulse active" style="background:rgba(239,68,68,0.3);position:absolute;top:-8px;left:-8px;width:28px;height:28px;border-radius:50%;"></div>
                            </div>
                        `,
                        iconSize: [28, 28],
                        iconAnchor: [14, 14]
                    });

                    const marker = L.marker([accidentLat, accidentLng], { icon: markerIcon })
                        .addTo(myvehicleLiveMapInstance)
                        .bindPopup(`<div style="font-family:'Outfit',sans-serif;font-weight:700;color:#fff;">LAST ACCIDENT LOCATION</div>`);

                    myvehicleLiveMapMarkers.push(marker);

                    // Hide empty state
                    if (emptyStateEl) emptyStateEl.style.display = 'none';
                } else {
                    // Show empty state overlay
                    if (emptyStateEl) emptyStateEl.style.display = 'flex';
                }
            }
        }, 150);

        // 4. Render 4 recent events
        const eventsListEl = document.getElementById('myvehicle-events-list');
        const recentEvents = myAcc.slice(0, 4);

        if (recentEvents.length === 0) {
            eventsListEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 11px; padding: 10px 0;">No events to display</div>';
        } else {
            eventsListEl.innerHTML = recentEvents.map(acc => {
                const sev = (acc.severity || 'UNKNOWN').toUpperCase();
                let sevClass = 'minor';
                if (sev === 'CRITICAL') sevClass = 'critical';
                else if (sev === 'SEVERE' || sev === 'MAJOR') sevClass = 'warning';
                else if (sev === 'MODERATE') sevClass = 'moderate';

                const sevIcon = sevClass === 'critical'
                    ? 'fa-solid fa-triangle-exclamation'
                    : (sevClass === 'warning' ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-info');

                const time = timeAgo(acc.created_at || acc.event_timestamp);
                const idSafe = (acc.event_id || '').replace(/[^a-zA-Z0-9]/g, '_');
                const hasStreet = acc.street_name && !acc.street_name.includes('GPS') && acc.street_name !== 'Unnamed Road';
                const roadLabel = hasStreet ? acc.street_name : 'Loading location...';

                return `
                    <div class="owner-accident-item ${sevClass}"
                         style="cursor: pointer;"
                         onclick="zoomMyVehicleMapToEvent(${acc.latitude}, ${acc.longitude})"
                         title="Locate event on map">
                        <div class="owner-accident-col-left">
                            <span class="owner-accident-id">${acc.event_id || '—'}</span>
                            <span class="owner-accident-badge ${sevClass}"><i class="${sevIcon}"></i> ${sev}</span>
                            <span class="owner-accident-type" id="mv-road-${idSafe}" style="color: var(--primary); font-weight: 700; text-shadow: 0 0 8px var(--primary-glow);">
                                ${roadLabel}
                            </span>
                        </div>
                        <div class="owner-accident-col-right">
                            <span class="owner-accident-time">${time}</span>
                        </div>
                    </div>
                `;
            }).join('');

            // Resolve road names using local GPS lookup (instant, no network)
            recentEvents.forEach(acc => {
                const idSafe = (acc.event_id || '').replace(/[^a-zA-Z0-9]/g, '_');
                const cell = document.getElementById(`mv-road-${idSafe}`);
                if (!cell) return;

                // Use server-provided name if valid
                if (acc.street_name && acc.street_name !== 'Unnamed Road' && acc.street_name !== 'Unknown Road' && !acc.street_name.includes('GPS')) {
                    cell.innerText = acc.street_name;
                    return;
                }

                const lat = parseFloat(acc.latitude);
                const lng = parseFloat(acc.longitude);
                if (isNaN(lat) || isNaN(lng)) {
                    cell.innerText = getCairoLocationName(null, null);
                    return;
                }

                // Local GPS lookup — instant, covers all 3 active coordinate pairs
                cell.innerText = getCairoLocationName(lat, lng);
            });
        }

    } catch (e) {
        console.error("loadOwnerVehicleData error:", e);
    }
}

// ════════════════════════════════════════════════════════════════
// PAGE 9 — USER MANAGEMENT
// ════════════════════════════════════════════════════════════════
let allUsersCache = [];

async function loadUserManagement() {
    const tbody = document.getElementById('usermgmt-table-body');
    tbody.innerHTML = loadingRow(7);
    try {
        const res  = await fetch(`${API}/api/users`);
        const data = await res.json();
        allUsersCache = Array.isArray(data) ? data : [];
        renderUsersTable(allUsersCache);
    } catch (e) {
        tbody.innerHTML = errorRow(7, 'Failed to load users. Make sure server.py is running.');
    }
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usermgmt-table-body');
    if (!users.length) {
        tbody.innerHTML = emptyRow(7, 'No users found.');
        return;
    }

    const roleColors = { admin: '#a855f7', owner: '#3b82f6', user: '#3b82f6' };

    tbody.innerHTML = users.map(u => {
        const uRole = (u.role || '').toLowerCase();
        const roleColor = roleColors[uRole] || '#64748b';
        const isDisabled = u.disabled === 1 || u.disabled === true;
        const userStatusBadge = isDisabled
            ? `<span style="background:rgba(244,63,94,0.15);color:#f43f5e;border:1px solid rgba(244,63,94,0.3);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">DISABLED</span>`
            : `<span style="background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">ACTIVE</span>`;
        const rolePill = `<span style="background:${roleColor}20;color:${roleColor};border:1px solid ${roleColor}40;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">${u.role || '—'}</span>`;
        const deviceBadge = u.device_serial
            ? `<code style="font-size:11px;color:var(--primary);background:rgba(59,130,246,0.1);padding:2px 7px;border-radius:4px;">${u.device_serial}</code>`
            : `<span style="color:var(--text-muted);font-size:12px;">—</span>`;

        return `<tr data-email="${u.email}" data-name="${u.name}" data-role="${u.role}" data-phone="${u.phone || ''}" data-national="${u.national_id || ''}" data-disabled="${isDisabled ? 1 : 0}">
            <td>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,${roleColor},${roleColor}88);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;">
                        ${(u.name || 'U').split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase()}
                    </div>
                    <div>
                        <div style="font-weight:600;font-size:13px;">${u.name || '—'}</div>
                        <div style="font-size:11px;color:var(--text-muted);">${u.user_id || '—'}</div>
                    </div>
                </div>
            </td>
            <td style="font-size:13px;color:var(--text-secondary);">${u.email || '—'}</td>
            <td>${rolePill}</td>
            <td style="font-size:13px;">${u.phone || '—'}</td>
            <td>${deviceBadge}</td>
            <td>${userStatusBadge}</td>
            <td>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="btn-secondary" style="padding:5px 10px;font-size:11px;" onclick="openEditUserModal('${u.email}')" title="Edit">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-secondary" style="padding:5px 10px;font-size:11px;" onclick="changeUserRole('${u.email}','${u.role}')" title="Change Role">
                        <i class="fa-solid fa-user-tag"></i>
                    </button>
                    <button class="btn-secondary" style="padding:5px 10px;font-size:11px;${isDisabled ? 'border-color:#10b981;color:#10b981;' : 'border-color:#f59e0b;color:#f59e0b;'}" onclick="toggleUserStatus('${u.email}',${isDisabled ? 0 : 1})" title="${isDisabled ? 'Enable Account' : 'Disable Account'}">
                        <i class="fa-solid ${isDisabled ? 'fa-user-check' : 'fa-user-slash'}"></i>
                    </button>
                    <button class="btn-secondary" style="padding:5px 10px;font-size:11px;border-color:var(--critical);color:var(--critical);" onclick="deleteUser('${u.email}','${(u.name||'').replace(/'/g,'')}')" title="Delete">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function filterUsersTable() {
    const q = (document.getElementById('usermgmt-search').value || '').toLowerCase();
    if (!q) { renderUsersTable(allUsersCache); return; }
    const filtered = allUsersCache.filter(u =>
        (u.name||'').toLowerCase().includes(q) ||
        (u.email||'').toLowerCase().includes(q) ||
        (u.role||'').toLowerCase().includes(q) ||
        (u.phone||'').toLowerCase().includes(q)
    );
    renderUsersTable(filtered);
}

// ── Add User Modal ─────────────────────────────────────────────
function openAddUserModal() {
    document.getElementById('um-mode').value = 'add';
    document.getElementById('um-target-email').value = '';
    document.getElementById('user-modal-title').innerHTML = '<i class="fa-solid fa-user-plus" style="color:var(--primary);margin-right:8px;"></i>Add New User';
    document.getElementById('um-submit-text').innerText = 'Add User';
    document.getElementById('um-password-group').style.display = '';
    document.getElementById('user-modal-form').reset();
    document.getElementById('user-modal-error').style.display = 'none';
    updateUserMgmtPhonePlaceholder(); // Refresh placeholder & validation hints
    const overlay = document.getElementById('user-modal-overlay');
    overlay.style.display = 'flex';
}

function openEditUserModal(email) {
    const user = allUsersCache.find(u => u.email === email);
    if (!user) return;

    document.getElementById('um-mode').value = 'edit';
    document.getElementById('um-target-email').value = email;
    document.getElementById('user-modal-title').innerHTML = '<i class="fa-solid fa-user-pen" style="color:var(--primary);margin-right:8px;"></i>Edit User';
    document.getElementById('um-submit-text').innerText = 'Save Changes';
    document.getElementById('um-password-group').style.display = 'none'; // Hide password for edit
    document.getElementById('um-name').value = user.name || '';
    document.getElementById('um-email').value = user.email || '';
    document.getElementById('um-email').disabled = true;

    const parsed = parseStoredPhone(user.phone || '');
    document.getElementById('um-country-code').value = parsed.countryCode;
    document.getElementById('um-phone').value = parsed.rawPhone;
    updateUserMgmtPhonePlaceholder(); // Refresh placeholder/pattern

    document.getElementById('um-national-id').value = user.national_id || '';
    document.getElementById('um-role').value = (user.role || 'owner').toLowerCase();
    document.getElementById('user-modal-error').style.display = 'none';
    document.getElementById('user-modal-overlay').style.display = 'flex';
}

function closeUserModal() {
    document.getElementById('user-modal-overlay').style.display = 'none';
    document.getElementById('um-email').disabled = false;
}

async function handleUserModalSubmit(event) {
    event.preventDefault();
    const mode        = document.getElementById('um-mode').value;
    const targetEmail = document.getElementById('um-target-email').value;
    const name        = document.getElementById('um-name').value.trim();
    const email       = document.getElementById('um-email').value.trim();
    const countryCode = document.getElementById('um-country-code').value;
    const rawPhone    = document.getElementById('um-phone').value.trim();
    const nationalId  = document.getElementById('um-national-id').value.trim();
    const role        = document.getElementById('um-role').value;
    const password    = document.getElementById('um-password').value.trim();

    const errEl  = document.getElementById('user-modal-error');
    const btn    = document.getElementById('um-submit-btn');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';

    // Verify phone digit count matching data-digits
    const select = document.getElementById('um-country-code');
    const option = select.options[select.selectedIndex];
    const digits = parseInt(option.getAttribute('data-digits'));
    if (!/^\d+$/.test(rawPhone) || rawPhone.length !== digits) {
        errEl.innerText = `Phone number must be exactly ${digits} digits.`;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-check"></i> <span id="um-submit-text">${mode === 'add' ? 'Add User' : 'Save Changes'}</span>`;
        return;
    }
    const phone = countryCode + rawPhone;

    try {
        let res, data;
        if (mode === 'add') {
            res  = await fetch(`${API}/api/users/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, name, phone, national_id: nationalId, role, password })
            });
            data = await res.json();
        } else {
            res  = await fetch(`${API}/api/users/edit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_email: targetEmail, name, phone, national_id: nationalId, role })
            });
            data = await res.json();
        }

        if (data.error) {
            errEl.innerText      = data.error;
            errEl.style.display  = 'block';
        } else {
            closeUserModal();
            showGlobalAlert(`✅ User ${mode === 'add' ? 'added' : 'updated'} successfully!`);
            loadUserManagement();
        }
    } catch (e) {
        errEl.innerText     = '⚠️ Network error. Cannot reach server.';
        errEl.style.display = 'block';
    }

    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> <span id="um-submit-text">${mode === 'add' ? 'Add User' : 'Save Changes'}</span>`;
}

// ── Role Change ────────────────────────────────────────────────
async function changeUserRole(email, currentRole) {
    const roles = ['owner', 'admin'];
    const normRole = (currentRole || '').toLowerCase() === 'admin' ? 'admin' : 'owner';
    const next  = roles[(roles.indexOf(normRole) + 1) % roles.length];
    if (!confirm(`Change role for "${email}" from ${currentRole} → ${next}?`)) return;

    try {
        const res  = await fetch(`${API}/api/users/change-role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, role: next })
        });
        const data = await res.json();
        if (data.success) {
            showGlobalAlert(`✅ Role changed to ${next} for ${email}`);
            loadUserManagement();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (e) {
        alert('Network error. Cannot reach server.');
    }
}

// ── Toggle Enable / Disable ────────────────────────────────────
async function toggleUserStatus(email, disabled) {
    const action = disabled ? 'disable' : 'enable';
    if (!confirm(`Are you sure you want to ${action} account "${email}"?`)) return;

    try {
        const res  = await fetch(`${API}/api/users/toggle-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, disabled: !!disabled })
        });
        const data = await res.json();
        if (data.success) {
            showGlobalAlert(`✅ Account ${disabled ? 'disabled' : 'enabled'}: ${email}`);
            loadUserManagement();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (e) {
        alert('Network error. Cannot reach server.');
    }
}

// ── Delete User ────────────────────────────────────────────────
async function deleteUser(email, name) {
    if (!confirm(`⚠️ Permanently delete user "${name}" (${email})?\n\nThis action cannot be undone.`)) return;
    // Safety: prevent deleting yourself
    if (currentUser && currentUser.email === email) {
        alert('❌ You cannot delete your own account while logged in.');
        return;
    }

    try {
        const res  = await fetch(`${API}/api/users/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
            showGlobalAlert(`✅ User "${name}" deleted successfully.`);
            loadUserManagement();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (e) {
        alert('Network error. Cannot reach server.');
    }
}


// ════════════════════════════════════════════════════════════════
// PAGE 10 — ADMIN MANAGEMENT
// ════════════════════════════════════════════════════════════════
async function loadAdminManagement() {
    const tbody = document.getElementById('adminmgmt-table-body');
    tbody.innerHTML = loadingRow(6);
    try {
        const res   = await fetch(`${API}/api/users`);
        const users = await res.json();
        const all   = Array.isArray(users) ? users : [];

        // Update stats
        const admins   = all.filter(u => (u.role || '').toLowerCase() === 'admin');
        const disabled = all.filter(u => u.disabled === 1 || u.disabled === true);
        const setEl    = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        setEl('stat-admin-count',   admins.length);
        setEl('stat-total-users',   all.length);
        setEl('stat-disabled-users', disabled.length);

        renderAdminTable(admins);
    } catch (e) {
        tbody.innerHTML = errorRow(6, 'Failed to load admin accounts.');
    }
}

function renderAdminTable(admins) {
    const tbody = document.getElementById('adminmgmt-table-body');
    if (!admins.length) {
        tbody.innerHTML = emptyRow(6, 'No admin accounts found.');
        return;
    }

    tbody.innerHTML = admins.map(u => {
        const isDisabled = u.disabled === 1 || u.disabled === true;
        const userStatusBadge = isDisabled
            ? `<span style="background:rgba(244,63,94,0.15);color:#f43f5e;border:1px solid rgba(244,63,94,0.3);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">DISABLED</span>`
            : `<span style="background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">ACTIVE</span>`;

        const isSelf = currentUser && currentUser.email === u.email;

        return `<tr>
            <td>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#a855f7,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;">
                        ${(u.name||'A').split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase()}
                    </div>
                    <div>
                        <div style="font-weight:600;font-size:13px;">${u.name || '—'}${isSelf ? ' <span style="font-size:10px;color:#a855f7;background:rgba(168,85,247,0.1);padding:1px 6px;border-radius:10px;border:1px solid rgba(168,85,247,0.3);">You</span>' : ''}</div>
                    </div>
                </div>
            </td>
            <td style="font-size:13px;color:var(--text-secondary);">${u.email || '—'}</td>
            <td style="font-size:13px;">${u.phone || '—'}</td>
            <td><code style="font-size:11px;color:#a855f7;background:rgba(168,85,247,0.1);padding:2px 7px;border-radius:4px;">${u.user_id || '—'}</code></td>
            <td>${userStatusBadge}</td>
            <td>
                <div style="display:flex;gap:6px;">
                    ${!isSelf ? `
                    <button class="btn-secondary" style="padding:5px 10px;font-size:11px;border-color:var(--critical);color:var(--critical);" onclick="removeAdmin('${u.email}','${(u.name||'').replace(/'/g,'')}')" title="Demote to Owner">
                        <i class="fa-solid fa-user-minus"></i> Remove Admin
                    </button>` : '<span style="font-size:11px;color:var(--text-muted);padding:5px;">—</span>'}
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ── Remove Admin (demote to Owner) ────────────────────────────
async function removeAdmin(email, name) {
    if (!confirm(`Demote "${name}" from Admin to Owner?\n\nThey will lose all admin privileges.`)) return;
    if (currentUser && currentUser.email === email) {
        alert('❌ You cannot demote your own account.');
        return;
    }

    try {
        const res  = await fetch(`${API}/api/users/change-role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, role: 'owner' })
        });
        const data = await res.json();
        if (data.success) {
            showGlobalAlert(`✅ ${name} has been demoted to Owner.`);
            loadAdminManagement();
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (e) {
        alert('Network error.');
    }
}

// ── Add Admin Modal ────────────────────────────────────────────
function openAddAdminModal() {
    document.getElementById('admin-modal-form').reset();
    document.getElementById('admin-modal-error').style.display = 'none';
    updateAdminMgmtPhonePlaceholder(); // Refresh placeholder & validation hints
    document.getElementById('admin-modal-overlay').style.display = 'flex';
}

function closeAdminModal() {
    document.getElementById('admin-modal-overlay').style.display = 'none';
}

async function handleAdminModalSubmit(event) {
    event.preventDefault();
    const name     = document.getElementById('am-name').value.trim();
    const email    = document.getElementById('am-email').value.trim();
    const countryCode = document.getElementById('am-country-code').value;
    const rawPhone    = document.getElementById('am-phone').value.trim();
    const password = document.getElementById('am-password').value.trim();

    const errEl = document.getElementById('admin-modal-error');
    const btn   = document.getElementById('am-submit-btn');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating Admin...';

    // Verify phone digit count matching data-digits
    const select = document.getElementById('am-country-code');
    const option = select.options[select.selectedIndex];
    const digits = parseInt(option.getAttribute('data-digits'));
    if (!/^\d+$/.test(rawPhone) || rawPhone.length !== digits) {
        errEl.innerText = `Phone number must be exactly ${digits} digits.`;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-shield"></i> Create Admin Account';
        return;
    }
    const phone = countryCode + rawPhone;

    try {
        const res  = await fetch(`${API}/api/users/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name, phone, role: 'admin', password })
        });
        const data = await res.json();

        if (data.error) {
            errEl.innerText     = data.error;
            errEl.style.display = 'block';
        } else {
            closeAdminModal();
            showGlobalAlert(`✅ Admin account created for ${name}!`);
            loadAdminManagement();
        }
    } catch (e) {
        errEl.innerText     = '⚠️ Network error. Cannot reach server.';
        errEl.style.display = 'block';
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-user-shield"></i> Create Admin Account';
}

// ────────────────────────────────────────────────────────────────
// PAGE 12 — AUDIT LOGS (Admin only)
// ────────────────────────────────────────────────────────────────
let _allAuditLogs = [];

async function loadAuditLogs() {
    const tbody = document.getElementById('auditlogs-table-body');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Loading audit logs…</td></tr>`;

    // Reset stats
    ['audit-stat-total','audit-stat-logins','audit-stat-adds','audit-stat-edits','audit-stat-deletes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
    });

    try {
        const res  = await fetch(`${API}/api/audit-logs`);
        const logs = await res.json();
        _allAuditLogs = Array.isArray(logs) ? logs : [];
        renderAuditLogs(_allAuditLogs);
        updateAuditStats(_allAuditLogs);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--critical);">⚠️ Could not load audit logs. Make sure the server is running.</td></tr>`;
    }
}

function updateAuditStats(logs) {
    const total   = logs.length;
    const logins  = logs.filter(l => l.action && l.action.toLowerCase().includes('logged in')).length;
    const adds    = logs.filter(l => l.action && l.action.toLowerCase().startsWith('added')).length;
    const edits   = logs.filter(l => l.action && (l.action.toLowerCase().startsWith('modified') || l.action.toLowerCase().startsWith('changed'))).length;
    const deletes = logs.filter(l => l.action && l.action.toLowerCase().startsWith('deleted')).length;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('audit-stat-total',   total);
    set('audit-stat-logins',  logins);
    set('audit-stat-adds',    adds);
    set('audit-stat-edits',   edits);
    set('audit-stat-deletes', deletes);
}

function renderAuditLogs(logs) {
    const tbody = document.getElementById('auditlogs-table-body');
    if (!tbody) return;

    if (!logs || logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--text-muted);"><i class="fa-solid fa-clipboard" style="font-size:2rem;display:block;margin-bottom:10px;opacity:0.4;"></i>No audit logs recorded yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = logs.map(log => {
        const roleLower  = (log.actor_role || 'system').toLowerCase();
        const roleColor  = roleLower === 'admin' ? 'var(--primary)' : roleLower === 'owner' ? 'var(--warning)' : 'var(--text-muted)';
        const roleLabel  = roleLower.charAt(0).toUpperCase() + roleLower.slice(1);

        // Determine action icon and color
        const act = (log.action || '').toLowerCase();
        let iconHtml = '';
        if (act.includes('logged in'))       iconHtml = `<i class="fa-solid fa-right-to-bracket" style="color:var(--minor);margin-right:7px;"></i>`;
        else if (act.startsWith('added'))    iconHtml = `<i class="fa-solid fa-circle-plus" style="color:var(--minor);margin-right:7px;"></i>`;
        else if (act.startsWith('deleted'))  iconHtml = `<i class="fa-solid fa-trash-can" style="color:var(--critical);margin-right:7px;"></i>`;
        else if (act.startsWith('modified') || act.startsWith('changed')) iconHtml = `<i class="fa-solid fa-pen-to-square" style="color:var(--warning);margin-right:7px;"></i>`;
        else if (act.includes('disabled'))   iconHtml = `<i class="fa-solid fa-ban" style="color:var(--critical);margin-right:7px;"></i>`;
        else if (act.includes('enabled'))    iconHtml = `<i class="fa-solid fa-circle-check" style="color:var(--minor);margin-right:7px;"></i>`;
        else                                 iconHtml = `<i class="fa-solid fa-circle-info" style="color:var(--text-muted);margin-right:7px;"></i>`;

        const actorDisplay = log.actor_name && log.actor_name !== log.actor_email
            ? `<span style="font-weight:600;">${escHtml(log.actor_name)}</span><br><small style="color:var(--text-muted);font-size:11px;">${escHtml(log.actor_email)}</small>`
            : `<span style="font-weight:600;">${escHtml(log.actor_email)}</span>`;

        return `<tr>
            <td style="font-family:monospace;font-size:12px;color:var(--text-muted);white-space:nowrap;">${escHtml(log.timestamp || '—')}</td>
            <td>${actorDisplay}</td>
            <td><span style="background:${roleColor}22;color:${roleColor};padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid ${roleColor}44;">${roleLabel}</span></td>
            <td style="font-size:13px;">${iconHtml}${escHtml(log.action || '—')}</td>
        </tr>`;
    }).join('');
}

function filterAuditLogs() {
    const search  = (document.getElementById('audit-search')?.value  || '').toLowerCase();
    const roleF   = (document.getElementById('audit-role-filter')?.value || '').toLowerCase();
    const typeF   = (document.getElementById('audit-type-filter')?.value || '').toLowerCase();

    let filtered = _allAuditLogs;

    if (search) {
        filtered = filtered.filter(l =>
            (l.actor_name  || '').toLowerCase().includes(search) ||
            (l.actor_email || '').toLowerCase().includes(search) ||
            (l.action      || '').toLowerCase().includes(search)
        );
    }
    if (roleF) {
        filtered = filtered.filter(l => (l.actor_role || '').toLowerCase() === roleF);
    }
    if (typeF === 'login')   filtered = filtered.filter(l => (l.action||'').toLowerCase().includes('logged in'));
    else if (typeF === 'add')    filtered = filtered.filter(l => (l.action||'').toLowerCase().startsWith('added'));
    else if (typeF === 'edit')   filtered = filtered.filter(l => (l.action||'').toLowerCase().startsWith('modified') || (l.action||'').toLowerCase().startsWith('changed'));
    else if (typeF === 'delete') filtered = filtered.filter(l => (l.action||'').toLowerCase().startsWith('deleted'));
    else if (typeF === 'status') filtered = filtered.filter(l => (l.action||'').toLowerCase().includes('disabled') || (l.action||'').toLowerCase().includes('enabled'));

    renderAuditLogs(filtered);
}

function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Close modals when clicking overlay background
document.addEventListener('click', (e) => {
    const userOverlay  = document.getElementById('user-modal-overlay');
    const adminOverlay = document.getElementById('admin-modal-overlay');
    if (e.target === userOverlay)  { closeUserModal(); }
    if (e.target === adminOverlay) { closeAdminModal(); }
});
