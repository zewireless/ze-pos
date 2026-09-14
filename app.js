// ============================================
// Payroll Management System - JavaScript
// ============================================

// ------------------------------------------------
// Supabase client
// employees & dtr_entries live in Supabase (see supabase/migrations)
// so an employee's own phone (kiosk scan) and the admin dashboard
// both read/write the same data, live. Settings & company info also
// sync through Supabase (app_config table, see loadSettings() /
// syncFullConfigToSupabase()) so every device an admin signs into
// shows the same Settings page - localStorage is kept only as an
// offline cache. Payroll run history still lives in localStorage only.
// ------------------------------------------------
const supabaseClient = (window.supabase && typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL && !SUPABASE_URL.includes('YOUR-PROJECT'))
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

function requireSupabase() {
    if (!supabaseClient) {
        showToast('Not connected to Supabase - copy supabase-config.example.js to supabase-config.js and fill in your project details.', 'error');
        return false;
    }
    return true;
}

// Check authentication on load
async function checkAuth() {
    if (!requireSupabase()) {
        document.getElementById('loginModal').classList.remove('hidden');
        return;
    }
    const { data: { session } } = await supabaseClient.auth.getSession();
    const savedUser = localStorage.getItem('payroll_username');

    if (session) {
        document.getElementById('loginModal').classList.add('hidden');
        if (savedUser) document.getElementById('loginUsername').value = savedUser;
        await checkBillingThenEnter();
    } else {
        document.getElementById('loginModal').classList.remove('hidden');
    }

    // Keep the app in sync if the session expires or the admin logs
    // out in another tab.
    supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            document.getElementById('loginModal').classList.remove('hidden');
        }
    });
}

// Gate the dashboard behind the client's subscription (see
// supabase/migrations/009_saas_billing.sql). Fails OPEN (lets the admin
// in) if that migration hasn't been run yet or the RPC call itself
// errors out - a billing check that can't reach the server should
// never be what locks a paying admin out of their own payroll.
async function checkBillingThenEnter() {
    document.getElementById('billingBlockedModal').classList.add('hidden');

    const { data, error } = await supabaseClient.rpc('get_my_billing');
    if (error || !data || Object.keys(data).length === 0) {
        // 009_saas_billing.sql not run yet, or this account predates it -
        // behave exactly like before (no billing gate at all).
        initializeApp();
        return;
    }

    const periodEnd = data.period_end ? new Date(data.period_end) : null;
    const expired = periodEnd ? periodEnd.getTime() < Date.now() : false;
    const blocked = data.status === 'cancelled' || data.status === 'overdue' || expired;

    if (!blocked) {
        initializeApp();
        return;
    }

    renderBillingBlocked(data, expired);
}

function renderBillingBlocked(data, expired) {
    const title = document.getElementById('billingBlockedTitle');
    const sub = document.getElementById('billingBlockedSub');
    const body = document.getElementById('billingBlockedBody');

    if (data.status === 'cancelled') {
        title.textContent = 'Your subscription is cancelled';
        sub.textContent = 'Choose a plan to reactivate your account.';
    } else if (expired && data.status === 'trial') {
        title.textContent = 'Your free trial has ended';
        sub.textContent = `Pick a plan to keep using ${data.business_name || 'ZE Payroll'}.`;
    } else {
        title.textContent = 'Payment pending';
        sub.textContent = 'Your plan will activate as soon as we confirm your payment.';
    }

    body.innerHTML = `
        <p><b>Plan:</b> ${data.plan_name || '—'}${data.price ? ` (₱${Number(data.price).toLocaleString()})` : ''}</p>
        ${data.period_end ? `<p><b>Period end:</b> ${new Date(data.period_end).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}</p>` : ''}
        <p style="margin-top:10px; color:var(--gray-500);">Already paid? Send your proof of payment to
        <b>ev.lounel4195@gmail.com</b> and we'll activate your plan within one business day.</p>
    `;

    document.getElementById('billingBlockedModal').classList.remove('hidden');
}

async function handleLogin() {
    if (!requireSupabase()) return;

    const email = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('rememberMe').checked;

    const loginBtn = document.getElementById('loginSubmitBtn');
    if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = 'Signing in...'; }

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Login'; }

    if (error) {
        showToast(error.message || 'Invalid email or password!', 'error');
        return;
    }

    if (rememberMe) {
        localStorage.setItem('payroll_remember_me', 'true');
        localStorage.setItem('payroll_username', email);
    } else {
        localStorage.removeItem('payroll_remember_me');
        localStorage.removeItem('payroll_username');
    }
    document.getElementById('loginModal').classList.add('hidden');
    await checkBillingThenEnter();
}

async function logout() {
    if (supabaseClient) await supabaseClient.auth.signOut();
    teardownRealtimeSync();
    document.getElementById('billingBlockedModal').classList.add('hidden');
    document.getElementById('loginModal').classList.remove('hidden');
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay?.classList.toggle('active');
}

// ------------------------------------------------
// Dark / light theme
// The <head> inline script already applies the saved (or OS-preferred)
// theme before first paint, so this just keeps the toggle icon in sync
// and handles switching + persisting the choice.
// ------------------------------------------------
function updateThemeToggleIcon() {
    const icon = document.getElementById('themeToggleIcon');
    if (!icon) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ze_payroll_theme', next);
    updateThemeToggleIcon();
}

document.addEventListener('DOMContentLoaded', updateThemeToggleIcon);

// Initialize App
async function initializeApp() {
    await loadSettings();
    await loadEmployees();
    await loadDTR();
    loadPayroll();
    updateDashboard();
    document.getElementById('payrollMonthFilter').value = getTodayYearMonthStr();
    document.getElementById('reportMonth').value = getTodayYearMonthStr();
    setDtrRangePreset('full-month');
    initializeQRScanner();
    setupRealtimeSync();
    refreshAppClockDisplay();
    setInterval(refreshAppClockDisplay, 1000);
}

document.addEventListener('DOMContentLoaded', checkAuth);

// ------------------------------------------------
// Realtime sync - lets a kiosk scan (or another admin device) show up
// on this dashboard immediately, without a manual refresh.
// ------------------------------------------------
let realtimeChannels = [];

function setupRealtimeSync() {
    if (!supabaseClient || realtimeChannels.length > 0) return;

    const dtrChannel = supabaseClient
        .channel('dtr-entries-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dtr_entries' }, () => {
            loadDTR();
            updateDashboard();
        })
        .subscribe();

    const employeeChannel = supabaseClient
        .channel('employees-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
            loadEmployees();
        })
        .subscribe();

    realtimeChannels = [dtrChannel, employeeChannel];
}

function teardownRealtimeSync() {
    realtimeChannels.forEach(ch => supabaseClient?.removeChannel(ch));
    realtimeChannels = [];
}

// ============================================
// Data Storage
// ============================================

const STORAGE_KEYS = {
    SETTINGS: 'payroll_settings',
    EMPLOYEES: 'payroll_employees',
    DTR: 'payroll_dtr',
    PAYROLL: 'payroll_processed',
    COMPANY: 'payroll_company',
    PAYROLL_ADJUSTMENTS: 'payroll_adjustments'
};

// Default company settings
const defaultCompany = {
    name: 'Company Name',
    address: 'Company Address',
    tin: '000-000-000-000',
    sssNumber: '00-0000000-0',
    philhealthNumber: '000000000000',
    pagibigNumber: '0000-0000-0000'
};

// Default Settings
const defaultSettings = {
    // Philippine Time by default. Editable under Settings > Date & Time Settings.
    timezone: 'Asia/Manila',
    dateTimeOverrideEnabled: false,
    dateTimeOverrideOffsetMs: 0,
    // Attendance geofencing - off by default until an admin captures a location
    geofenceEnabled: false,
    officeLat: null,
    officeLng: null,
    geofenceRadiusM: 50,
    lateType: 'per_minute',
    latePerMinute: 1.00,
    lateRanges: [
        { min: 1, max: 15, amount: 5.00 },
        { min: 16, max: 30, amount: 10.00 },
        { min: 31, max: 60, amount: 20.00 }
    ],
    otRate: 100.00,
    standardTimeIn: '08:00',
    standardTimeOut: '17:00',
    breakMinutes: 60,
    // Split AM/PM schedule used by the Paste DTR Data grid & attendance rules
    scheduleAmIn: '08:00',
    scheduleAmOut: '12:00',
    schedulePmIn: '13:00',
    schedulePmOut: '17:00',
    // Attendance tiers: minutes-late thresholds (inclusive upper bound) for each tier.
    // 0..lateGraceEnd = Grace (no penalty), then per-minute, then flat 1hr/2hr, then half day, then absent.
    lateGraceEnd: 10,
    latePerMinuteEnd: 29,
    lateFlat1hrEnd: 59,
    lateFlat2hrEnd: 89,
    lateHalfDayEnd: 149,
    // If true, any hours worked on Sunday are paid entirely at the OT rate
    sundayAllOT: true,
    baseDailyPay: 500.00,
    payrollCutoff: '15',
    payrollFrequency: 'monthly',
    // Customizable semi-monthly pay periods, used by the Payroll page's
    // "Pay Period" selector. Each period cuts off attendance on
    // (startDay..endDay) of the selected month and is paid out on
    // payoutDay of the month `payoutMonthOffset` months later (0 = same
    // month, 1 = the following month). endDay: 'last' means "last day of
    // the month" (so it always works regardless of month length).
    // Editable under Settings > Payroll Settings > Pay Periods.
    payPeriods: [
        { id: 'p1', label: '1st - 15th', startDay: 1, endDay: 15, payoutDay: 20, payoutMonthOffset: 0 },
        { id: 'p2', label: '16th - End of Month', startDay: 16, endDay: 'last', payoutDay: 5, payoutMonthOffset: 1 }
    ],
    defaultDailyRate: 400.00,
    defaultHourlyRate: 50.00,
    defaultPosition: 'Employee',
        enableStatutoryDeductions: true,
    // Hides the SSS/PhilHealth/Pag-IBIG line items (and the employer-share
    // reference block) on the printed payslip. The deductions still happen
    // in payroll totals/net pay - this only affects what's shown on the slip.
    hideStatutoryOnPayslip: false,
    // Global statutory deduction overrides - apply to ALL employees unless
    // a specific employee/period has its own override set in the payroll
    // "Edit Deductions" modal (which always wins over these).
    // mode: 'auto' (computed from salary) | 'fixed' (use *FixedAmount) | 'waived' (0)
    sssMode: 'auto',
    sssFixedAmount: 0,
    philhealthMode: 'auto',
    philhealthFixedAmount: 0,
    pagibigMode: 'auto',
    pagibigFixedAmount: 0,
    // Recurring deductions applied automatically to every employee, every
    // payroll run (e.g. a company loan program, uniform fee). Per-employee
    // one-off deductions (cash advance, etc.) are still added per period
    // via the payroll "Edit Deductions" modal.
    globalOtherDeductions: []
};

// Current settings
let settings = {};

// ============================================
// Date / Time Configuration
// ------------------------------------------------
// "Today" and "now" are computed from a configured IANA timezone
// (default Asia/Manila) instead of trusting the device's own clock/
// timezone. This also lets an admin preview/override the app's
// "current" date & time (e.g. to test a future payroll cutoff) from
// Settings > Date & Time Settings.
//
// NOTE: previously several places built a date with `.toISOString()`
// (e.g. `new Date().toISOString().split('T')[0]`). That method always
// converts to UTC first, so anywhere ahead of UTC (like the
// Philippines, UTC+8) it silently rolls back to "yesterday" for the
// first 8 hours of each local day. All of those call sites now go
// through the helpers below instead.
// ============================================

const DEFAULT_APP_TIMEZONE = 'Asia/Manila';

function getAppTimeZone() {
    return (settings && settings.timezone) || DEFAULT_APP_TIMEZONE;
}

// Real "now", shifted by the admin's override offset (if enabled). The
// offset is captured once as a fixed number of milliseconds so the
// clock keeps advancing normally instead of freezing at one instant.
function getAppNow() {
    const offsetMs = (settings && settings.dateTimeOverrideEnabled) ? (settings.dateTimeOverrideOffsetMs || 0) : 0;
    return new Date(Date.now() + offsetMs);
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

// Formats a Date instant as YYYY-MM-DD in the given IANA timezone.
function formatDateInTZ(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

// Formats a Date instant as HH:MM (24hr) in the given IANA timezone.
function formatTimeInTZ(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return `${parts.hour}:${parts.minute}`;
}

// "Today" as YYYY-MM-DD in the configured app timezone.
function getTodayDateStr() {
    return formatDateInTZ(getAppNow(), getAppTimeZone());
}

// Current clock time as HH:MM in the configured app timezone.
function getNowTimeStr() {
    return formatTimeInTZ(getAppNow(), getAppTimeZone());
}

// "Today" as YYYY-MM in the configured app timezone (for month pickers).
function getTodayYearMonthStr() {
    return getTodayDateStr().slice(0, 7);
}

// Human-readable "now" in the configured timezone, for display only.
function getNowDisplayStr() {
    return getAppNow().toLocaleString('en-PH', {
        timeZone: getAppTimeZone(), dateStyle: 'medium', timeStyle: 'short'
    });
}

// Formats a *local calendar* Date object (one built with `new Date(y, m, d)`,
// where only the Y/M/D components matter) as YYYY-MM-DD using its local
// getters. Using `.toISOString()` for this would bounce the value through
// UTC and can shift it a day backward in any timezone ahead of UTC.
function formatLocalDate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// Adds `deltaDays` (may be negative) to a YYYY-MM-DD string, returning a
// YYYY-MM-DD string, via local calendar math (safe regardless of the
// browser's own timezone).
function addDaysToDateStr(dateStr, deltaDays) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + deltaDays);
    return formatLocalDate(d);
}

// First/last day of a given year-month (month is 1-indexed) as YYYY-MM-DD,
// built directly from the numbers - no Date/timezone conversion involved.
function getMonthStartStr(year, month) {
    return `${year}-${pad2(month)}-01`;
}
function getMonthEndStr(year, month) {
    return `${year}-${pad2(month)}-${pad2(getDaysInMonth(year, month))}`;
}

// Formats a Date instant as a "YYYY-MM-DDTHH:mm" string suitable for
// prefilling a <input type="datetime-local">, expressed in the given
// timezone.
function toDateTimeLocalInputValue(date, timeZone) {
    return `${formatDateInTZ(date, timeZone)}T${formatTimeInTZ(date, timeZone)}`;
}

// Returns how far `timeZone` is ahead/behind UTC (in ms) at the given
// instant.
function getTZOffsetMs(timeZone, date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return asUTC - date.getTime();
}

// Interprets a "YYYY-MM-DDTHH:mm" wall-clock string (from a datetime-local
// input) as being in `timeZone`, and returns the corresponding real Date
// instant.
function wallTimeInTZToInstant(dateTimeLocalStr, timeZone) {
    const asIfUTC = new Date(dateTimeLocalStr + ':00Z');
    const offsetMs = getTZOffsetMs(timeZone, asIfUTC);
    return new Date(asIfUTC.getTime() - offsetMs);
}

function refreshAppClockDisplay() {
    const el = document.getElementById('appCurrentDateTimeDisplay');
    if (!el) return;
    el.textContent = `${getNowDisplayStr()} (${getAppTimeZone()})`;
}

function onDtOverrideToggle() {
    const enabled = document.getElementById('dtOverrideEnabled').checked;
    const group = document.getElementById('dtOverrideValueGroup');
    if (group) group.classList.toggle('hidden', !enabled);
    if (enabled && !document.getElementById('dtOverrideValue').value) {
        document.getElementById('dtOverrideValue').value = toDateTimeLocalInputValue(getAppNow(), getAppTimeZone());
    }
}

function saveDateTimeSettings() {
    settings.timezone = document.getElementById('appTimezone').value || DEFAULT_APP_TIMEZONE;
    const enabled = document.getElementById('dtOverrideEnabled').checked;
    settings.dateTimeOverrideEnabled = enabled;

    if (enabled) {
        const val = document.getElementById('dtOverrideValue').value;
        if (!val) {
            showToast('Pick a date & time for the override first.', 'error');
            return;
        }
        const targetInstant = wallTimeInTZToInstant(val, settings.timezone);
        settings.dateTimeOverrideOffsetMs = targetInstant.getTime() - Date.now();
    } else {
        settings.dateTimeOverrideOffsetMs = 0;
    }

    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    showToast('Date & time settings saved!', 'success');
    refreshAppClockDisplay();
    updateDashboard();
    if (document.getElementById('payrollMonthFilter')?.value) loadPayroll();
}

function clearDateTimeOverride() {
    document.getElementById('dtOverrideEnabled').checked = false;
    document.getElementById('dtOverrideValue').value = '';
    document.getElementById('dtOverrideValueGroup')?.classList.add('hidden');
    saveDateTimeSettings();
}

// Company info
let company = {};

// Employees data
let employees = [];

// DTR entries
let dtrEntries = [];

// Processed payroll records
let processedPayroll = [];

// ============================================
// Settings Functions
// ============================================

// Settings/company used to be pure localStorage - which meant an admin
// signing in from a PC and then a phone saw two unrelated copies (each
// browser's own local storage), which is exactly the "different
// settings on different devices" symptom this fixes. app_config (see
// supabase/migrations/008_app_config_sync.sql) is now the shared
// source of truth; localStorage is kept only as an offline cache and
// as the seed the very first time this runs against a fresh table.
async function loadSettings() {
    let remoteSettings = null;
    let remoteCompany = null;

    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('app_config')
                .select('settings, company')
                .eq('id', 1)
                .maybeSingle();
            if (error) {
                console.error('Failed to load settings from Supabase, using this device\'s local copy for now:', error);
            } else if (data) {
                if (data.settings && Object.keys(data.settings).length) remoteSettings = data.settings;
                if (data.company && Object.keys(data.company).length) remoteCompany = data.company;
            }
        } catch (err) {
            console.error('Failed to load settings from Supabase, using this device\'s local copy for now:', err);
        }
    }

    const localSettingsStored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (remoteSettings) {
        // Supabase is shared across every device - it wins. Refresh this
        // device's local cache to match so Settings still opens offline.
        settings = { ...defaultSettings, ...remoteSettings };
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } else {
        settings = localSettingsStored ? { ...defaultSettings, ...JSON.parse(localSettingsStored) } : { ...defaultSettings };
        // Nothing shared yet (first load since this device's Supabase
        // project ran the app_config migration, or currently offline) -
        // if this device already has real settings saved, seed the
        // shared row so every other device picks them up from here on.
        if (supabaseClient && localSettingsStored) syncFullConfigToSupabase();
    }

    const localCompanyStored = localStorage.getItem(STORAGE_KEYS.COMPANY);
    if (remoteCompany) {
        company = { ...defaultCompany, ...remoteCompany };
        localStorage.setItem(STORAGE_KEYS.COMPANY, JSON.stringify(company));
    } else {
        company = localCompanyStored ? { ...defaultCompany, ...JSON.parse(localCompanyStored) } : { ...defaultCompany };
    }
    populateCompanyForm();

    // Populate settings form
    document.getElementById('appTimezone').value = settings.timezone || DEFAULT_APP_TIMEZONE;
    document.getElementById('dtOverrideEnabled').checked = !!settings.dateTimeOverrideEnabled;
    document.getElementById('dtOverrideValueGroup').classList.toggle('hidden', !settings.dateTimeOverrideEnabled);
    document.getElementById('dtOverrideValue').value = settings.dateTimeOverrideEnabled
        ? toDateTimeLocalInputValue(getAppNow(), settings.timezone || DEFAULT_APP_TIMEZONE)
        : '';
    refreshAppClockDisplay();
    document.getElementById('latePerMinute').value = settings.latePerMinute || 1.00;
    document.getElementById('otRate').value = settings.otRate || 100.00;
    document.getElementById('breakMinutes').value = settings.breakMinutes || 60;
    document.getElementById('scheduleAmIn').value = settings.scheduleAmIn || '08:00';
    document.getElementById('scheduleAmOut').value = settings.scheduleAmOut || '12:00';
    document.getElementById('schedulePmIn').value = settings.schedulePmIn || '13:00';
    document.getElementById('schedulePmOut').value = settings.schedulePmOut || '17:00';
    document.getElementById('lateGraceEnd').value = settings.lateGraceEnd ?? 10;
    document.getElementById('latePerMinuteEnd').value = settings.latePerMinuteEnd ?? 29;
    document.getElementById('lateFlat1hrEnd').value = settings.lateFlat1hrEnd ?? 59;
    document.getElementById('lateFlat2hrEnd').value = settings.lateFlat2hrEnd ?? 89;
    document.getElementById('lateHalfDayEnd').value = settings.lateHalfDayEnd ?? 149;
    document.getElementById('sundayAllOT').checked = settings.sundayAllOT !== false;
    document.getElementById('geofenceEnabled').checked = !!settings.geofenceEnabled;
    document.getElementById('officeLat').value = settings.officeLat ?? '';
    document.getElementById('officeLng').value = settings.officeLng ?? '';
    document.getElementById('geofenceRadiusM').value = settings.geofenceRadiusM || 50;
    refreshGeofenceStatus();
    document.getElementById('baseDailyPay').value = settings.baseDailyPay || 500.00;
    document.getElementById('payrollCutoff').value = settings.payrollCutoff || '15';
    document.getElementById('payrollFrequency').value = settings.payrollFrequency || 'monthly';
    document.getElementById('defaultDailyRate').value = settings.defaultDailyRate || 400.00;
    document.getElementById('defaultHourlyRate').value = settings.defaultHourlyRate || 50.00;
    document.getElementById('defaultPosition').value = settings.defaultPosition || 'Employee';
    
    document.getElementById('enableStatutoryDeductions').checked = settings.enableStatutoryDeductions !== false;
    document.getElementById('hideStatutoryOnPayslip').checked = !!settings.hideStatutoryOnPayslip;
    // Statutory deduction override modes
    document.getElementById('sssMode').value = settings.sssMode || 'auto';
    document.getElementById('sssFixedAmount').value = settings.sssFixedAmount || 0;
    document.getElementById('philhealthMode').value = settings.philhealthMode || 'auto';
    document.getElementById('philhealthFixedAmount').value = settings.philhealthFixedAmount || 0;
    document.getElementById('pagibigMode').value = settings.pagibigMode || 'auto';
    document.getElementById('pagibigFixedAmount').value = settings.pagibigFixedAmount || 0;
    updateStatutoryModeVisibility();
    renderGlobalOtherDeductions();

    // Late type radio buttons
    document.querySelectorAll('input[name="lateType"]').forEach(radio => {
        radio.checked = radio.value === settings.lateType;
    });

    // Late deduction ranges
    updateLateRangeGroupVisibility();
    renderLateRanges();

    // Customizable pay periods (cutoffs + payout dates)
    renderPayPeriods();
    populatePayrollPeriodOptions();

    // Update default values in employee form
    document.getElementById('baseDailyPayInput').value = settings.baseDailyPay || 500.00;
}

// Pushes the full settings + company objects to the shared Supabase
// `app_config` row, so every device/browser signed into this account
// loads the same Settings page. Separate from syncAttendanceSettingsToSupabase(),
// which pushes only the narrow slice payroll_settings needs for the
// kiosk RPC - this covers everything else (OT rate, late-deduction
// peso amounts, statutory options, pay periods, company info, etc.).
async function syncFullConfigToSupabase() {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.from('app_config').upsert({
        id: 1,
        settings,
        company
    }, { onConflict: 'id' });
    if (error) {
        console.error('Failed to sync settings to Supabase:', error);
        showToast('Saved on this device, but failed to sync to your other devices: ' + error.message, 'error');
    }
}

function saveSettings() {
    settings.lateType = document.querySelector('input[name="lateType"]:checked')?.value || 'per_minute';
    settings.latePerMinute = parseFloat(document.getElementById('latePerMinute').value) || 0;
    settings.otRate = parseFloat(document.getElementById('otRate').value) || 0;
    settings.breakMinutes = parseInt(document.getElementById('breakMinutes').value) || 0;
    settings.scheduleAmIn = document.getElementById('scheduleAmIn').value || '08:00';
    settings.scheduleAmOut = document.getElementById('scheduleAmOut').value || '12:00';
    settings.schedulePmIn = document.getElementById('schedulePmIn').value || '13:00';
    settings.schedulePmOut = document.getElementById('schedulePmOut').value || '17:00';
    settings.lateGraceEnd = parseInt(document.getElementById('lateGraceEnd').value) || 0;
    settings.latePerMinuteEnd = parseInt(document.getElementById('latePerMinuteEnd').value) || 0;
    settings.lateFlat1hrEnd = parseInt(document.getElementById('lateFlat1hrEnd').value) || 0;
    settings.lateFlat2hrEnd = parseInt(document.getElementById('lateFlat2hrEnd').value) || 0;
    settings.lateHalfDayEnd = parseInt(document.getElementById('lateHalfDayEnd').value) || 0;
    settings.sundayAllOT = document.getElementById('sundayAllOT').checked;

    // Attendance geofencing. Store exactly what the admin selected here -
    // do NOT silently revert it. "Enable" and "Capture Office Location"
    // each independently trigger a full saveSettings() call, and this used
    // to force-uncheck the box whenever it ran before a location existed -
    // which meant the *other* action's later save would read the
    // now-unchecked box and silently re-disable geofencing, with no
    // lasting error. That is how this shipped disabled with no visible
    // failure. Missing-location is instead surfaced as a persistent status
    // banner (refreshGeofenceStatus) and enforced by refusing to sync
    // geofence_enabled:true to Supabase without valid coordinates (see
    // syncAttendanceSettingsToSupabase) - never by mutating the admin's
    // on-screen choice.
    settings.geofenceEnabled = document.getElementById('geofenceEnabled').checked;
    const latVal = document.getElementById('officeLat').value;
    const lngVal = document.getElementById('officeLng').value;
    settings.officeLat = latVal !== '' ? parseFloat(latVal) : null;
    settings.officeLng = lngVal !== '' ? parseFloat(lngVal) : null;
    settings.geofenceRadiusM = parseInt(document.getElementById('geofenceRadiusM').value) || 50;

    // Keep legacy single time-in/out fields in sync with the AM start / PM end
    // so older calculation paths (manual DTR entry) stay consistent.
    settings.standardTimeIn = settings.scheduleAmIn;
    settings.standardTimeOut = settings.schedulePmOut;
    settings.baseDailyPay = parseFloat(document.getElementById('baseDailyPay').value) || 0;
    settings.payrollCutoff = document.getElementById('payrollCutoff').value;
    settings.payrollFrequency = document.getElementById('payrollFrequency').value;
    settings.defaultDailyRate = parseFloat(document.getElementById('defaultDailyRate').value) || 0;
    settings.defaultHourlyRate = parseFloat(document.getElementById('defaultHourlyRate').value) || 0;
    settings.defaultPosition = document.getElementById('defaultPosition').value;

    settings.enableStatutoryDeductions = document.getElementById('enableStatutoryDeductions').checked;
    settings.hideStatutoryOnPayslip = document.getElementById('hideStatutoryOnPayslip').checked;
    // Statutory deduction override modes (global defaults for all employees)
    settings.sssMode = document.getElementById('sssMode').value;
    settings.sssFixedAmount = parseFloat(document.getElementById('sssFixedAmount').value) || 0;
    settings.philhealthMode = document.getElementById('philhealthMode').value;
    settings.philhealthFixedAmount = parseFloat(document.getElementById('philhealthFixedAmount').value) || 0;
    settings.pagibigMode = document.getElementById('pagibigMode').value;
    settings.pagibigFixedAmount = parseFloat(document.getElementById('pagibigFixedAmount').value) || 0;

    // Global recurring "other" deductions applied to every employee
    const globalDeductions = [];
    document.querySelectorAll('.global-deduction-item').forEach(item => {
        const label = item.querySelector('.global-deduction-label').value.trim();
        const amount = parseFloat(item.querySelector('.global-deduction-amount').value) || 0;
        if (label && amount !== 0) {
            globalDeductions.push({ label, amount });
        }
    });
    settings.globalOtherDeductions = globalDeductions;

    // Save late ranges
    const ranges = [];
    document.querySelectorAll('.late-range-item').forEach(item => {
        const min = parseInt(item.querySelector('.range-min').value);
        const max = parseInt(item.querySelector('.range-max').value);
        const amount = parseFloat(item.querySelector('.range-amount').value);
        if (min > 0 && max > 0 && amount >= 0) {
            ranges.push({ min, max, amount });
        }
    });
    settings.lateRanges = ranges;

    // Save customizable pay periods
    const payPeriods = [];
    document.querySelectorAll('.pay-period-item').forEach(item => {
        const label = item.querySelector('.pay-period-label').value.trim();
        const startDay = parseInt(item.querySelector('.pay-period-start-day').value) || 1;
        const endDayRaw = item.querySelector('.pay-period-end-day').value;
        const endDay = endDayRaw === 'last' ? 'last' : (parseInt(endDayRaw) || startDay);
        const payoutDay = parseInt(item.querySelector('.pay-period-payout-day').value) || 1;
        const payoutMonthOffset = parseInt(item.querySelector('.pay-period-payout-offset').value) || 0;
        if (label) {
            payPeriods.push({
                id: item.dataset.periodId,
                label, startDay, endDay, payoutDay, payoutMonthOffset
            });
        }
    });
    settings.payPeriods = payPeriods;

    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    showToast('Settings saved successfully!', 'success');
    updateDashboard();
    populatePayrollPeriodOptions();
    loadPayroll();
    syncAttendanceSettingsToSupabase();
    syncFullConfigToSupabase();
}

// Pushes the schedule/late-rule/timezone/geofence settings to the shared
// Supabase `payroll_settings` row. This matters because the self-service
// kiosk (scan.html) runs the `record_attendance_punch` RPC entirely on the
// server with no access to this browser's localStorage - without this
// sync, changes made here would only ever affect the admin dashboard's own
// calculations, not actual kiosk punches.
async function syncAttendanceSettingsToSupabase() {
    if (!supabaseClient) {
        renderGeofenceStatus({ unreachable: true, reason: 'Not connected to Supabase.' });
        return;
    }

    // Hard requirement, enforced here (not just trusted from the checkbox):
    // geofence_enabled is only ever sent as true when we have two real,
    // finite coordinates. This is the actual enforcement boundary - the
    // kiosk RPC treats missing coordinates as "not enforced" too, but we
    // don't rely on that alone; we simply never claim to be enabled
    // without them.
    const lat = settings.officeLat;
    const lng = settings.officeLng;
    const hasValidCoords = typeof lat === 'number' && Number.isFinite(lat) &&
                            typeof lng === 'number' && Number.isFinite(lng);
    const effectiveGeofenceEnabled = !!settings.geofenceEnabled && hasValidCoords;

    const { error } = await supabaseClient.from('payroll_settings').upsert({
        id: 1,
        schedule_am_in: settings.scheduleAmIn,
        schedule_am_out: settings.scheduleAmOut,
        schedule_pm_in: settings.schedulePmIn,
        schedule_pm_out: settings.schedulePmOut,
        late_grace_end: settings.lateGraceEnd,
        late_per_minute_end: settings.latePerMinuteEnd,
        late_flat_1hr_end: settings.lateFlat1hrEnd,
        late_flat_2hr_end: settings.lateFlat2hrEnd,
        late_half_day_end: settings.lateHalfDayEnd,
        sunday_all_ot: settings.sundayAllOT,
        timezone: settings.timezone || DEFAULT_APP_TIMEZONE,
        geofence_enabled: effectiveGeofenceEnabled,
        // Persist the last-known coordinates regardless of the enabled
        // flag (not just while enabled) so toggling off and back on later
        // doesn't silently lose them and require a re-capture.
        office_lat: hasValidCoords ? lat : null,
        office_lng: hasValidCoords ? lng : null,
        geofence_radius_m: settings.geofenceRadiusM || 50
    }, { onConflict: 'id' });

    if (error) {
        console.error('Failed to sync attendance settings to Supabase:', error);
        showToast('Saved locally, but failed to sync to the kiosk: ' + error.message, 'error');
        renderGeofenceStatus({ unreachable: true, reason: error.message });
        return;
    }

    if (settings.geofenceEnabled && !hasValidCoords) {
        showToast('Geofencing is checked ON but no office location is on file yet - it will NOT be enforced until you capture one.', 'error');
    }

    // Always re-read back from the database after saving, rather than
    // trusting our own local state, so the admin sees exactly what the
    // kiosk will actually enforce on the very next punch.
    await refreshGeofenceStatus();
}

// Reads the live payroll_settings row straight from Supabase and renders
// the real, current kiosk-enforcement state - deliberately independent of
// whatever this browser's local `settings` object believes, since that's
// exactly the gap that let geofencing silently do nothing while the admin
// believed it was configured.
async function refreshGeofenceStatus() {
    if (!supabaseClient) {
        renderGeofenceStatus({ unreachable: true, reason: 'Not connected to Supabase.' });
        return;
    }

    const { data, error } = await supabaseClient
        .from('payroll_settings')
        .select('geofence_enabled, office_lat, office_lng, geofence_radius_m')
        .eq('id', 1)
        .maybeSingle();

    if (error || !data) {
        renderGeofenceStatus({ unreachable: true, reason: error?.message || 'No response.' });
        return;
    }

    renderGeofenceStatus({
        unreachable: false,
        enabled: !!data.geofence_enabled,
        hasCoords: data.office_lat !== null && data.office_lng !== null,
        lat: data.office_lat,
        lng: data.office_lng,
        radius: data.geofence_radius_m
    });
}

function renderGeofenceStatus(state) {
    const el = document.getElementById('geofenceLiveStatus');
    if (!el) return;

    if (state.unreachable) {
        el.className = 'geofence-status-banner geofence-status-off';
        el.innerHTML = `<i class="fas fa-triangle-exclamation"></i> Could not verify the kiosk's live status${state.reason ? ' (' + state.reason + ')' : ''}. Treat geofencing as NOT confirmed until this succeeds.`;
        return;
    }

    const enforced = state.enabled && state.hasCoords;
    if (enforced) {
        el.className = 'geofence-status-banner geofence-status-on';
        el.innerHTML = `<i class="fas fa-shield-halved"></i> <strong>Enforced right now</strong> on the kiosk - office at ${state.lat.toFixed(6)}, ${state.lng.toFixed(6)}, ${state.radius}m radius.`;
    } else if (state.enabled && !state.hasCoords) {
        // Shouldn't happen anymore given the sync guard above, but if the
        // database somehow ends up in this state, say so plainly rather
        // than implying it's protected.
        el.className = 'geofence-status-banner geofence-status-off';
        el.innerHTML = `<i class="fas fa-triangle-exclamation"></i> Marked enabled but has NO office location on file - it is NOT being enforced. Capture the office location and save.`;
    } else {
        el.className = 'geofence-status-banner geofence-status-off';
        el.innerHTML = `<i class="fas fa-circle-info"></i> Not enforced - employees can time in/out from anywhere.`;
    }
}

// Captures the admin's current GPS location (call this while physically
// standing where employees will scan) to use as the office's geofence
// center.
function captureOfficeLocation() {
    if (!navigator.geolocation) {
        showToast('Geolocation is not supported by this browser.', 'error');
        return;
    }

    const btn = document.getElementById('captureLocationBtn');
    const hint = document.getElementById('officeLocationAccuracy');
    if (btn) { btn.disabled = true; }
    if (hint) { hint.textContent = 'Getting your current location...'; }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            document.getElementById('officeLat').value = pos.coords.latitude.toFixed(6);
            document.getElementById('officeLng').value = pos.coords.longitude.toFixed(6);
            if (hint) {
                hint.textContent = `Captured with ~${Math.round(pos.coords.accuracy)}m GPS accuracy. ` +
                    (pos.coords.accuracy > 30 ? 'That\'s a bit imprecise - try again outdoors or near a window for a tighter fix.' : 'Looks good.');
            }
            if (btn) { btn.disabled = false; }
            saveSettings();
        },
        (err) => {
            showToast('Could not get your location: ' + err.message, 'error');
            if (hint) { hint.textContent = 'Stand at the office (where employees will scan from), then tap this on your own phone/laptop.'; }
            if (btn) { btn.disabled = false; }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

function saveCompanySettings() {
    company.name = document.getElementById('companyName').value.trim();
    company.address = document.getElementById('companyAddress').value.trim();
    company.tin = document.getElementById('companyTIN').value.trim();
    company.sssNumber = document.getElementById('companySSS').value.trim();
    company.philhealthNumber = document.getElementById('companyPhilhealth').value.trim();
    company.pagibigNumber = document.getElementById('companyPagibig').value.trim();

    localStorage.setItem(STORAGE_KEYS.COMPANY, JSON.stringify(company));
    showToast('Company settings saved successfully!', 'success');
    syncFullConfigToSupabase();
}

function populateCompanyForm() {
    document.getElementById('companyName').value = company.name || '';
    document.getElementById('companyAddress').value = company.address || '';
    document.getElementById('companyTIN').value = company.tin || '';
    document.getElementById('companySSS').value = company.sssNumber || '';
    document.getElementById('companyPhilhealth').value = company.philhealthNumber || '';
    document.getElementById('companyPagibig').value = company.pagibigNumber || '';
}

function updateLateRangeGroupVisibility() {
    const isPerMinute = settings.lateType === 'per_minute';
    document.getElementById('latePerMinuteGroup').classList.toggle('hidden', !isPerMinute);
    document.getElementById('latePerRangeGroup').classList.toggle('hidden', isPerMinute);
}

function renderLateRanges() {
    const container = document.getElementById('lateRangeList');
    container.innerHTML = '';

    settings.lateRanges.forEach((range, index) => {
        const item = document.createElement('div');
        item.className = 'late-range-item';
        item.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 8px;';
        item.innerHTML = `
            <input type="number" class="range-min form-control" placeholder="Min" value="${range.min}" min="0" style="width: 80px;" onchange="saveSettings()">
            <span style="color: var(--gray-500);">-</span>
            <input type="number" class="range-max form-control" placeholder="Max" value="${range.max}" min="0" style="width: 80px;" onchange="saveSettings()">
            <span style="color: var(--gray-500); margin-right: 8px;">min</span>
            <div class="input-with-icon" style="flex: 1;">
                <span class="currency-symbol">₱</span>
                <input type="number" class="range-amount form-control" placeholder="Amount" value="${range.amount}" min="0" step="0.01" onchange="saveSettings()">
            </div>
            <button class="btn btn-sm btn-outline text-danger" onclick="removeLateRange(${index})">
                <i class="fas fa-trash"></i>
            </button>
        `;
        container.appendChild(item);
    });
}

function addLateRange() {
    if (!settings.lateRanges) settings.lateRanges = [];
    const lastRange = settings.lateRanges[settings.lateRanges.length - 1];
    const newMin = lastRange ? lastRange.max + 1 : 1;
    settings.lateRanges.push({ min: newMin, max: newMin + 14, amount: 0 });
    renderLateRanges();
}

function removeLateRange(index) {
    settings.lateRanges.splice(index, 1);
    renderLateRanges();
}

// Shows/hides the "Fixed Amount" input next to each statutory deduction
// depending on whether that deduction's mode is set to Auto/Fixed/Waived.
function updateStatutoryModeVisibility() {
    ['sss', 'philhealth', 'pagibig'].forEach(type => {
        const mode = document.getElementById(`${type}Mode`).value;
        document.getElementById(`${type}FixedAmountGroup`).classList.toggle('hidden', mode !== 'fixed');
    });
}

function renderGlobalOtherDeductions() {
    const container = document.getElementById('globalDeductionsList');
    if (!container) return;
    const list = settings.globalOtherDeductions || [];

    if (list.length === 0) {
        container.innerHTML = '<p class="text-muted" style="font-size: 13px;">No standard deductions - every employee is deducted only for late minutes and any statutory contributions above.</p>';
        return;
    }

    container.innerHTML = list.map((d, index) => `
        <div class="global-deduction-item" style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
            <input type="text" class="global-deduction-label form-control" placeholder="e.g. Uniform Fee" value="${(d.label || '').replace(/"/g, '&quot;')}" style="flex: 2;" onchange="saveSettings()">
            <div class="input-with-icon" style="flex: 1;">
                <span class="currency-symbol">₱</span>
                <input type="number" class="global-deduction-amount form-control" placeholder="0.00" min="0" step="0.01" value="${d.amount || 0}" onchange="saveSettings()">
            </div>
            <button class="btn btn-sm btn-outline text-danger" onclick="removeGlobalDeduction(${index})">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
}

function addGlobalDeduction() {
    if (!settings.globalOtherDeductions) settings.globalOtherDeductions = [];
    settings.globalOtherDeductions.push({ label: '', amount: 0 });
    renderGlobalOtherDeductions();
}

function removeGlobalDeduction(index) {
    settings.globalOtherDeductions.splice(index, 1);
    renderGlobalOtherDeductions();
    saveSettings();
}

// ============================================
// Customizable Pay Periods (cutoffs + payout dates)
// e.g. "1st-15th, paid on the 20th" and "16th-end of month, paid on the
// 5th of the following month". Used by the Payroll page's Pay Period
// selector (see getPayPeriods/getPayPeriodRange below).
// ============================================
function renderPayPeriods() {
    const container = document.getElementById('payPeriodsList');
    if (!container) return;
    const periods = getPayPeriods();

    const monthOffsetOptions = (selected) => [0, 1, 2].map(n =>
        `<option value="${n}" ${selected === n ? 'selected' : ''}>${n === 0 ? 'Same month' : n === 1 ? 'Next month' : `+${n} months`}</option>`
    ).join('');

    container.innerHTML = periods.map((p) => `
        <div class="pay-period-item" data-period-id="${p.id}" style="border: 1px solid var(--border-color, #ddd); border-radius: 6px; padding: 10px; margin-bottom: 10px;">
            <div class="form-row">
                <div class="form-group" style="flex: 2;">
                    <label>Label</label>
                    <input type="text" class="pay-period-label form-control" value="${(p.label || '').replace(/"/g, '&quot;')}" placeholder="e.g. 1st - 15th" onchange="saveSettings()">
                </div>
                <button class="btn btn-sm btn-outline text-danger" style="align-self: flex-end; margin-bottom: 8px;" onclick="removePayPeriod('${p.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Cutoff Start Day</label>
                    <input type="number" class="pay-period-start-day form-control" min="1" max="31" value="${p.startDay}" onchange="saveSettings()">
                </div>
                <div class="form-group">
                    <label>Cutoff End Day</label>
                    <select class="pay-period-end-day form-control" onchange="saveSettings()">
                        <option value="last" ${p.endDay === 'last' ? 'selected' : ''}>Last day of month</option>
                        ${Array.from({ length: 31 }, (_, i) => i + 1).map(d =>
                            `<option value="${d}" ${p.endDay === d ? 'selected' : ''}>${d}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Payout Day</label>
                    <input type="number" class="pay-period-payout-day form-control" min="1" max="31" value="${p.payoutDay}" onchange="saveSettings()">
                </div>
                <div class="form-group">
                    <label>Payout Month</label>
                    <select class="pay-period-payout-offset form-control" onchange="saveSettings()">
                        ${monthOffsetOptions(p.payoutMonthOffset || 0)}
                    </select>
                </div>
            </div>
        </div>
    `).join('');
}

function addPayPeriod() {
    settings.payPeriods = getPayPeriods();
    settings.payPeriods.push({
        id: 'p' + Date.now(),
        label: 'New Period',
        startDay: 1,
        endDay: 'last',
        payoutDay: 1,
        payoutMonthOffset: 0
    });
    renderPayPeriods();
    saveSettings();
}

function removePayPeriod(id) {
    settings.payPeriods = getPayPeriods().filter(p => p.id !== id);
    renderPayPeriods();
    saveSettings();
}

// ============================================
// Employee Functions
// ============================================

// --- DB <-> app object mapping (DB uses snake_case; the rest of the
// app was built around these camelCase field names, so we translate
// here and leave every render/payroll function untouched) ---
function mapEmployeeFromDb(row) {
    return {
        id: row.id,
        firstName: row.first_name || '',
        middleName: row.middle_name || '',
        lastName: row.last_name || '',
        position: row.position || '',
        department: row.department || '',
        email: row.email || '',
        phone: row.phone || '',
        address: row.address || '',
        dailyRate: row.daily_rate || 0,
        hourlyRate: row.hourly_rate || 0,
        baseDailyPay: row.base_daily_pay || 0,
        hireDate: row.hire_date || '',
        sssNumber: row.sss_number || '',
        philhealthNumber: row.philhealth_number || '',
        pagibigNumber: row.pagibig_number || '',
        tin: row.tin || '',
        status: row.status || 'active',
        hasPin: !!row.pin_hash,
        createdAt: row.created_at
    };
}

function mapEmployeeToDb(emp) {
    return {
        id: emp.id,
        first_name: emp.firstName,
        middle_name: emp.middleName,
        last_name: emp.lastName,
        position: emp.position,
        department: emp.department,
        email: emp.email,
        phone: emp.phone,
        address: emp.address,
        daily_rate: emp.dailyRate,
        hourly_rate: emp.hourlyRate,
        base_daily_pay: emp.baseDailyPay,
        hire_date: emp.hireDate || null,
        sss_number: emp.sssNumber,
        philhealth_number: emp.philhealthNumber,
        pagibig_number: emp.pagibigNumber,
        tin: emp.tin,
        status: emp.status
    };
}

async function loadEmployees() {
    if (!requireSupabase()) return;

    const { data, error } = await supabaseClient
        .from('employees')
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        showToast('Failed to load employees: ' + error.message, 'error');
        return;
    }

    employees = (data || []).map(mapEmployeeFromDb);
    renderEmployeeTable();
    updateEmployeeFilters();
}

async function generateEmployeeId() {
    if (!requireSupabase()) return null;
    const { data, error } = await supabaseClient.rpc('generate_employee_id');
    if (error) {
        showToast('Failed to generate employee ID: ' + error.message, 'error');
        return null;
    }
    return data;
}

function renderEmployeeTable() {
    const tbody = document.getElementById('employeeTableBody');
    tbody.innerHTML = '';

    const searchTerm = document.getElementById('employeeSearch')?.value?.toLowerCase() || '';

    const filtered = employees.filter(emp => {
        if (!searchTerm) return true;
        return `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(searchTerm) ||
               emp.position.toLowerCase().includes(searchTerm) ||
               emp.id.toLowerCase().includes(searchTerm);
    });

    filtered.forEach(emp => {
        const initials = `${emp.firstName[0]}${emp.lastName[0]}`.toUpperCase();
        const statusClass = emp.status === 'active' ? 'badge-success' :
                           emp.status === 'inactive' ? 'badge-neutral' : 'badge-warning';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code class="text-muted">${emp.id}</code></td>
            <td><div class="employee-photo">${initials}</div></td>
            <td>
                <strong>${emp.firstName} ${emp.lastName}</strong>
                <br><small class="text-muted">${emp.position}</small>
            </td>
            <td>${emp.position}</td>
            <td>₱${formatNumber(emp.dailyRate || 0)}</td>
            <td>₱${formatNumber(emp.hourlyRate || 0)}</td>
            <td>
                <span class="badge ${statusClass}">${capitalize(emp.status)}</span>
                ${!emp.hasPin ? '<br><small style="color: var(--danger);" title="Set a PIN so this employee can use the attendance kiosk"><i class="fas fa-exclamation-triangle"></i> No PIN</small>' : ''}
            </td>
            <td class="actions">
                <button class="btn-icon" onclick="editEmployee('${emp.id}')" title="Edit">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="btn-icon" onclick="viewQREmployee('${emp.id}')" title="QR Code">
                    <i class="fas fa-qrcode"></i>
                </button>
                <button class="btn-icon" onclick="deleteEmployee('${emp.id}')" title="Delete" style="color: var(--danger);">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateEmployeeFilters() {
    const employeeFilter = document.getElementById('dtrEmployeeFilter');
    const payrollFilter = document.getElementById('payrollEmployeeFilter');

    const currentDtrValue = employeeFilter.value;
    const currentPayrollValue = payrollFilter.value;

    employeeFilter.innerHTML = '<option value="">All Employees</option>' +
        employees.filter(e => e.status === 'active').map(e =>
            `<option value="${e.id}">${e.firstName} ${e.lastName} (${e.id})</option>`
        ).join('');

    payrollFilter.innerHTML = '<option value="">All Employees</option>' +
        employees.filter(e => e.status === 'active').map(e =>
            `<option value="${e.id}">${e.firstName} ${e.lastName} (${e.id})</option>`
        ).join('');

    if (currentDtrValue && [...employeeFilter.options].some(o => o.value === currentDtrValue)) {
        employeeFilter.value = currentDtrValue;
    }

    if (currentPayrollValue && [...payrollFilter.options].some(o => o.value === currentPayrollValue)) {
        payrollFilter.value = currentPayrollValue;
    }

    // Update DTR select
    const dtrSelect = document.getElementById('dtrEmployee');
    if (dtrSelect) {
        dtrSelect.innerHTML = employees.filter(e => e.status === 'active').map(e =>
            `<option value="${e.id}">${e.firstName} ${e.lastName} (${e.id})</option>`
        ).join('');
    }
}

async function addEmployee() {
    document.getElementById('editEmployeeId').value = '';
    const idInput = document.getElementById('employeeId');
    idInput.readOnly = false;
    idInput.value = 'Generating...';
    document.getElementById('employeeIdHint').textContent = 'Auto-generated - you can edit it before saving.';
    document.getElementById('firstName').value = '';
    document.getElementById('middleName').value = '';
    document.getElementById('lastName').value = '';
    document.getElementById('position').value = settings.defaultPosition || '';
    document.getElementById('department').value = '';
    document.getElementById('email').value = '';
    document.getElementById('phone').value = '';
    document.getElementById('address').value = '';
    document.getElementById('dailyRate').value = settings.defaultDailyRate || 400;
    document.getElementById('hourlyRate').value = settings.defaultHourlyRate || 50;
    document.getElementById('baseDailyPayInput').value = settings.baseDailyPay || 500;
    document.getElementById('hireDate').value = getTodayDateStr();
    document.getElementById('sssNumber').value = '';
    document.getElementById('philhealthNumber').value = '';
    document.getElementById('pagibigNumber').value = '';
    document.getElementById('tin').value = '';
    document.getElementById('employeeStatus').value = 'active';
    document.getElementById('employeePin').value = '';
    document.getElementById('employeePinHint').textContent = 'Used when this employee scans their attendance QR code on their own phone.';
    showModal('employeeModal');

    const newId = await generateEmployeeId();
    document.getElementById('employeeId').value = newId || '';
}

function editEmployee(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;

    document.getElementById('editEmployeeId').value = emp.id;
    const idInput = document.getElementById('employeeId');
    idInput.value = emp.id;
    idInput.readOnly = true;
    document.getElementById('employeeIdHint').textContent = "Can't be changed after creation - it's referenced by this employee's existing DTR records.";
    document.getElementById('firstName').value = emp.firstName || '';
    document.getElementById('middleName').value = emp.middleName || '';
    document.getElementById('lastName').value = emp.lastName || '';
    document.getElementById('position').value = emp.position || '';
    document.getElementById('department').value = emp.department || '';
    document.getElementById('email').value = emp.email || '';
    document.getElementById('phone').value = emp.phone || '';
    document.getElementById('address').value = emp.address || '';
    document.getElementById('dailyRate').value = emp.dailyRate || 0;
    document.getElementById('hourlyRate').value = emp.hourlyRate || 0;
    document.getElementById('baseDailyPayInput').value = emp.baseDailyPay || settings.baseDailyPay || 500;
    document.getElementById('hireDate').value = emp.hireDate || '';
    document.getElementById('sssNumber').value = emp.sssNumber || '';
    document.getElementById('philhealthNumber').value = emp.philhealthNumber || '';
    document.getElementById('pagibigNumber').value = emp.pagibigNumber || '';
    document.getElementById('tin').value = emp.tin || '';
    document.getElementById('employeeStatus').value = emp.status || 'active';
    document.getElementById('employeePin').value = '';
    document.getElementById('employeePinHint').textContent = emp.hasPin
        ? 'A PIN is already set. Leave blank to keep it, or enter 4 digits to change it.'
        : 'No PIN set yet - this employee cannot use the attendance kiosk until one is set.';
    showModal('employeeModal');
}

async function saveEmployee() {
    if (!requireSupabase()) return;

    const editId = document.getElementById('editEmployeeId').value;
    const firstName = document.getElementById('firstName').value.trim();
    const middleName = document.getElementById('middleName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const position = document.getElementById('position').value.trim();
    const department = document.getElementById('department').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const address = document.getElementById('address').value.trim();
    const dailyRate = parseFloat(document.getElementById('dailyRate').value) || 0;
    const hourlyRate = parseFloat(document.getElementById('hourlyRate').value) || 0;
    const baseDailyPay = parseFloat(document.getElementById('baseDailyPayInput').value) || 0;
    const hireDate = document.getElementById('hireDate').value;
    const sssNumber = document.getElementById('sssNumber').value.trim();
    const philhealthNumber = document.getElementById('philhealthNumber').value.trim();
    const pagibigNumber = document.getElementById('pagibigNumber').value.trim();
    const tin = document.getElementById('tin').value.trim();
    const status = document.getElementById('employeeStatus').value;
    const pin = document.getElementById('employeePin').value.trim();

    if (!firstName || !lastName) {
        showToast('First name and last name are required!', 'error');
        return;
    }
    if (!position) {
        showToast('Position is required!', 'error');
        return;
    }
    if (pin && !/^\d{4}$/.test(pin)) {
        showToast('PIN must be exactly 4 digits.', 'error');
        return;
    }

    const employeeId = (editId || document.getElementById('employeeId').value).trim();
    if (!employeeId) {
        showToast('Employee ID is required!', 'error');
        return;
    }
    if (!editId && employees.some(e => e.id === employeeId)) {
        showToast(`Employee ID "${employeeId}" is already in use - pick a different one.`, 'error');
        return;
    }

    const employeeObj = {
        id: employeeId, firstName, middleName, lastName, position, department,
        email, phone, address, dailyRate, hourlyRate, baseDailyPay, hireDate,
        sssNumber, philhealthNumber, pagibigNumber, tin, status
    };

    const { error } = await supabaseClient
        .from('employees')
        .upsert(mapEmployeeToDb(employeeObj), { onConflict: 'id' });

    if (error) {
        showToast('Failed to save employee: ' + error.message, 'error');
        return;
    }

    if (pin) {
        const { error: pinError } = await supabaseClient.rpc('set_employee_pin', {
            p_employee_id: employeeId,
            p_pin: pin
        });
        if (pinError) {
            showToast('Employee saved, but the PIN could not be set: ' + pinError.message, 'error');
        }
    }

    showToast(editId ? 'Employee updated successfully!' : 'Employee added successfully!', 'success');
    closeModal('employeeModal');
    await loadEmployees();
    updateDashboard();
}

async function deleteEmployee(id) {
    if (!confirm('Are you sure you want to delete this employee? All their DTR records will also be deleted.')) {
        return;
    }
    if (!requireSupabase()) return;

    const { error } = await supabaseClient.from('employees').delete().eq('id', id);
    if (error) {
        showToast('Failed to delete employee: ' + error.message, 'error');
        return;
    }

    await loadEmployees();
    await loadDTR();
    updateDashboard();
    showToast('Employee deleted successfully!', 'info');
}

function viewQREmployee(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;

    document.getElementById('qrEmployeeDisplayName').textContent = `${emp.firstName} ${emp.lastName} - ${emp.id}`;
    const qrDisplay = document.getElementById('qrCodeDisplay');
    qrDisplay.innerHTML = '';
    generateRealQRCode(`payroll://${emp.id}`, 'qrCodeDisplay');
    showModal('qrModal');
}

// ============================================
// DTR Functions
// ============================================

function mapDtrFromDb(row) {
    return {
        id: row.id,
        employeeId: row.employee_id,
        date: row.date,
        timeIn: row.time_in ? row.time_in.slice(0, 5) : '',
        timeOut: row.time_out ? row.time_out.slice(0, 5) : '',
        totalHours: row.total_hours || 0,
        otHours: row.ot_hours || 0,
        lateMinutes: row.late_minutes || 0,
        status: row.status || 'present',
        source: row.source || 'manual',
        // Manually set via Edit DTR Entry: pay this day by actual hours
        // worked (totalHours - otHours, at hourlyRate) instead of the
        // flat daily/half-day rate. Late deduction and OT are unaffected
        // either way - see computeEmployeePayroll.
        hourlyOverride: row.hourly_override || false,
        createdAt: row.created_at
    };
}


async function loadDTR() {
    if (!requireSupabase()) return;

    const { data, error } = await supabaseClient
        .from('dtr_entries')
        .select('*')
        .order('date', { ascending: false });

    if (error) {
        showToast('Failed to load DTR entries: ' + error.message, 'error');
        return;
    }

    dtrEntries = (data || []).map(mapDtrFromDb);

    const employeeFilter = document.getElementById('dtrEmployeeFilter')?.value;
    const dateFrom = document.getElementById('dtrDateFrom')?.value;
    const dateTo = document.getElementById('dtrDateTo')?.value;

    let filtered = dtrEntries;

    if (employeeFilter) {
        filtered = filtered.filter(d => d.employeeId === employeeFilter);
    }

    if (dateFrom) {
        filtered = filtered.filter(d => d.date >= dateFrom);
    }
    if (dateTo) {
        filtered = filtered.filter(d => d.date <= dateTo);
    }

    // Sort by date descending
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    const tbody = document.getElementById('dtrTableBody');
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center text-muted" style="padding: 40px;">
                    <i class="fas fa-inbox" style="font-size: 32px; display: block; margin-bottom: 12px; opacity: 0.5;"></i>
                    No DTR entries found
                </td>
            </tr>
        `;
        return;
    }

    filtered.forEach(dtr => {
        const emp = employees.find(e => e.id === dtr.employeeId);
        if (!emp) return;

        const statusClass = dtr.status === 'present' ? 'badge-success' :
                          dtr.status === 'late' ? 'badge-warning' :
                          dtr.status === 'absent' ? 'badge-danger' : 'badge-info';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatDate(dtr.date)}</td>
            <td>
                <strong>${emp.firstName} ${emp.lastName}</strong>
            </td>
            <td>${dtr.timeIn || '-'}</td>
            <td>${dtr.timeOut || '-'}</td>
            <td>${dtr.totalHours ? dtr.totalHours.toFixed(2) + ' hrs' : '-'}</td>
            <td>${dtr.otHours ? dtr.otHours.toFixed(2) + ' hrs' : '0.00 hrs'}</td>
            <td>${dtr.lateMinutes || 0} min</td>
            <td><span class="badge ${statusClass}">${capitalize(dtr.status)}</span></td>
            <td class="actions">
                <button class="btn-icon" onclick="editDTR('${dtr.id}')" title="Edit">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="btn-icon" onclick="deleteDTR('${dtr.id}')" title="Delete" style="color: var(--danger);">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ------------------------------------------------
// DTR date-range presets & CSV export
// ------------------------------------------------
function setDtrRangePreset(preset) {
    const fromInput = document.getElementById('dtrDateFrom');
    const toInput = document.getElementById('dtrDateTo');
    if (!fromInput || !toInput) return;

    const todayStr = getTodayDateStr();

    if (preset === 'today') {
        fromInput.value = todayStr;
        toInput.value = todayStr;
        loadDTR();
        return;
    }

    // Base the month off whatever's currently in "From" (or "To"), so
    // switching between 1st Half / 2nd Half / Full Month stays on the
    // same month you're already looking at, instead of jumping to today.
    const anchor = new Date((fromInput.value || todayStr) + 'T00:00:00');
    const year = anchor.getFullYear();
    const month = anchor.getMonth(); // 0-indexed
    const lastDay = new Date(year, month + 1, 0).getDate();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

    if (preset === 'first-half') {
        fromInput.value = iso(year, month, 1);
        toInput.value = iso(year, month, 15);
    } else if (preset === 'second-half') {
        fromInput.value = iso(year, month, 16);
        toInput.value = iso(year, month, lastDay);
    } else if (preset === 'full-month') {
        fromInput.value = iso(year, month, 1);
        toInput.value = iso(year, month, lastDay);
    }

    loadDTR();
}

function csvEscape(value) {
    const str = String(value ?? '');
    if (/[",\n]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function exportDtrRange() {
    const employeeFilter = document.getElementById('dtrEmployeeFilter')?.value;
    const dateFrom = document.getElementById('dtrDateFrom')?.value;
    const dateTo = document.getElementById('dtrDateTo')?.value;

    let filtered = dtrEntries;
    if (employeeFilter) filtered = filtered.filter(d => d.employeeId === employeeFilter);
    if (dateFrom) filtered = filtered.filter(d => d.date >= dateFrom);
    if (dateTo) filtered = filtered.filter(d => d.date <= dateTo);

    if (filtered.length === 0) {
        showToast('No DTR entries in this date range to export.', 'error');
        return;
    }

    // Sort by employee, then date, so each employee's days read top to bottom
    filtered = [...filtered].sort((a, b) => {
        const empA = employees.find(e => e.id === a.employeeId);
        const empB = employees.find(e => e.id === b.employeeId);
        const nameA = empA ? `${empA.lastName} ${empA.firstName}` : a.employeeId;
        const nameB = empB ? `${empB.lastName} ${empB.firstName}` : b.employeeId;
        return nameA.localeCompare(nameB) || a.date.localeCompare(b.date);
    });

    const headers = ['Employee ID', 'Employee Name', 'Date', 'Time In', 'Time Out', 'Total Hours', 'OT Hours', 'Late (min)', 'Status'];
    const lines = [headers.map(csvEscape).join(',')];

    filtered.forEach(dtr => {
        const emp = employees.find(e => e.id === dtr.employeeId);
        lines.push([
            dtr.employeeId,
            emp ? `${emp.firstName} ${emp.lastName}` : '',
            dtr.date,
            dtr.timeIn || '',
            dtr.timeOut || '',
            (dtr.totalHours || 0).toFixed(2),
            (dtr.otHours || 0).toFixed(2),
            dtr.lateMinutes || 0,
            capitalize(dtr.status)
        ].map(csvEscape).join(','));
    });

    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const rangeLabel = dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : 'all';
    a.href = url;
    a.download = `dtr-export-${rangeLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(`Exported ${filtered.length} DTR entr${filtered.length === 1 ? 'y' : 'ies'} to CSV.`, 'success');
}

function showDTRAddModal() {
    document.getElementById('dtrEmployee').innerHTML = employees.filter(e => e.status === 'active').map(e =>
        `<option value="${e.id}">${e.firstName} ${e.lastName} (${e.id})</option>`
    ).join('');
    document.getElementById('dtrDate').value = getTodayDateStr();
    document.getElementById('dtrTimeIn').value = '';
    document.getElementById('dtrTimeOut').value = '';
    document.getElementById('dtrOTHours').value = '';
    document.getElementById('dtrLateMinutes').value = '';
    document.getElementById('dtrStatus').value = 'present';
    document.getElementById('dtrHourlyOverride').checked = false;
    showModal('dtrModal');
}

async function saveDTR() {
    if (!requireSupabase()) return;

    const employeeId = document.getElementById('dtrEmployee').value;
    const date = document.getElementById('dtrDate').value;
    const timeIn = document.getElementById('dtrTimeIn').value;
    const timeOut = document.getElementById('dtrTimeOut').value;
    const otHours = parseFloat(document.getElementById('dtrOTHours').value) || 0;
    const lateMinutes = parseInt(document.getElementById('dtrLateMinutes').value) || 0;
    const status = document.getElementById('dtrStatus').value;
    const hourlyOverride = document.getElementById('dtrHourlyOverride').checked;
    const editId = document.getElementById('dtrEmployee').dataset.editId;

    if (!employeeId || !date) {
        showToast('Please select employee and date!', 'error');
        return;
    }

    // Calculate total hours (auto-deducts the AM/PM lunch break if the
    // shift spans it - no separate lunch time in/out needed)
    let totalHours = 0;
    if (timeIn && timeOut) {
        totalHours = calculateWorkHours(timeIn, timeOut);
    }

    // Auto-calculate OT hours (anything past PM Time Out; entire shift if
    // this is a Sunday and Settings has "Sunday = all hours OT" on) if
    // not manually set
    const calculatedOT = (timeIn && timeOut) ? calculateOTHours(timeIn, timeOut, date) : 0;
    const finalOtHours = otHours || calculatedOT;

    // Auto-calculate late minutes if not manually set
    const calculatedLate = calculateLateMinutes(timeIn);
    const finalLateMinutes = lateMinutes || calculatedLate;

    const row = {
        employee_id: employeeId,
        date,
        time_in: timeIn || null,
        time_out: timeOut || null,
        total_hours: totalHours,
        ot_hours: finalOtHours,
        late_minutes: finalLateMinutes,
        status,
        hourly_override: hourlyOverride,
        source: 'manual'
    };

    // A DTR entry's real identity is (employee, date) - upsert on that
    // so re-saving the same day (whether editing or adding) never
    // collides with an entry that came from a kiosk scan or paste import.
    const { error } = await supabaseClient
        .from('dtr_entries')
        .upsert(row, { onConflict: 'employee_id,date' });

    if (error) {
        showToast('Failed to save DTR entry: ' + error.message, 'error');
        return;
    }

    showToast(editId ? 'DTR entry updated!' : 'DTR entry saved!', 'success');
    delete document.getElementById('dtrEmployee').dataset.editId;
    closeModal('dtrModal');
    await loadDTR();
    updateDashboard();
}

function editDTR(id) {
    const dtr = dtrEntries.find(d => d.id === id);
    if (!dtr) return;

    document.getElementById('dtrEmployee').innerHTML = employees.filter(e => e.status === 'active').map(e =>
        `<option value="${e.id}" ${e.id === dtr.employeeId ? 'selected' : ''}>${e.firstName} ${e.lastName} (${e.id})</option>`
    ).join('');
    document.getElementById('dtrDate').value = dtr.date;
    document.getElementById('dtrTimeIn').value = dtr.timeIn || '';
    document.getElementById('dtrTimeOut').value = dtr.timeOut || '';
    document.getElementById('dtrOTHours').value = dtr.otHours || '';
    document.getElementById('dtrLateMinutes').value = dtr.lateMinutes || '';
    document.getElementById('dtrStatus').value = dtr.status;
    document.getElementById('dtrHourlyOverride').checked = !!dtr.hourlyOverride;

    // Store ID for update
    document.getElementById('dtrEmployee').dataset.editId = id;
    showModal('dtrModal');
}

async function deleteDTR(id) {
    if (!confirm('Are you sure you want to delete this DTR entry?')) {
        return;
    }
    if (!requireSupabase()) return;

    const { error } = await supabaseClient.from('dtr_entries').delete().eq('id', id);
    if (error) {
        showToast('Failed to delete DTR entry: ' + error.message, 'error');
        return;
    }

    await loadDTR();
    updateDashboard();
    showToast('DTR entry deleted!', 'info');
}

// ============================================
// Paste DTR Data — multi-employee monthly grid
// (Replaces the old single-employee bulk paste UI.)
// ============================================

let pasteDtrDaysInMonth = 30;
let pasteDtrActiveTab = 1;
const PASTE_DTR_DAY1_END = 15;
const WEEKDAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function getActiveEmployees() {
    return employees.filter(e => e.status === 'active');
}

function getDaysInMonth(year, month) {
    // month is 1-indexed
    return new Date(year, month, 0).getDate();
}

function getPasteDtrMonthValue() {
    return document.getElementById('pasteDtrMonth')?.value || '';
}

function populatePasteDtrMonthOptions(selectedValue) {
    const select = document.getElementById('pasteDtrMonth');
    if (!select) return;
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];
    const [todayY, todayM] = getTodayYearMonthStr().split('-').map(Number);
    const now = new Date(todayY, todayM - 1, 1);
    const options = [];
    for (let offset = -6; offset <= 2; offset++) {
        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const value = `${y}-${String(m).padStart(2, '0')}`;
        options.push(`<option value="${value}">${monthNames[m - 1]} ${y}</option>`);
    }
    select.innerHTML = options.join('');
    select.value = selectedValue || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function showPasteDTRModal() {
    populatePasteDtrMonthOptions();
    populatePasteDtrEmployeeDatalist();
    pasteDtrActiveTab = 1;
    buildPasteDtrGrid();
    setupPasteDtrPasteHandler();
    showModal('bulkDtrModal');
}

// Backward-compatible alias in case older markup still references this name.
function showBulkDTRModal() {
    showPasteDTRModal();
}

function populatePasteDtrEmployeeDatalist() {
    const list = document.getElementById('pasteDtrEmployeeList');
    if (!list) return;
    list.innerHTML = getActiveEmployees()
        .map(e => `<option value="${escapeHtml(e.firstName + ' ' + e.lastName)}">`)
        .join('');
}

function onPasteDtrMonthChange() {
    // Keep whatever employee names were already typed; reset day cells
    // since the number/labels of days can change between months.
    const names = [...document.querySelectorAll('#pasteDtrTableBody .paste-dtr-name-input')].map(i => i.value);
    pasteDtrActiveTab = 1;
    buildPasteDtrGrid(names);
}

function buildPasteDtrGrid(preserveNames) {
    const monthValue = getPasteDtrMonthValue();
    if (!monthValue) return;
    const [yearStr, monthStr] = monthValue.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    pasteDtrDaysInMonth = getDaysInMonth(year, month);

    renderPasteDtrRulesHint();
    renderPasteDtrTabs();
    renderPasteDtrTableHead(year, month);
    renderPasteDtrTableBody(preserveNames);
    applyPasteDtrTabVisibility();
}

function renderPasteDtrRulesHint() {
    const hintEl = document.getElementById('pasteDtrRulesHint');
    if (!hintEl) return;

    const toClock = (m) => {
        const wrapped = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
        const h = Math.floor(wrapped / 60);
        const mm = wrapped % 60;
        return `${h}:${String(mm).padStart(2, '0')}`;
    };
    const amIn = timeStrToMinutes(settings.scheduleAmIn || '08:00') || 0;
    const grace = settings.lateGraceEnd ?? 10;
    const perMinEnd = settings.latePerMinuteEnd ?? 29;
    const flat1hrEnd = settings.lateFlat1hrEnd ?? 59;
    const flat2hrEnd = settings.lateFlat2hrEnd ?? 89;
    const halfDayEnd = settings.lateHalfDayEnd ?? 149;
    const tierRange = (start, end) => `${toClock(amIn + start)}-${toClock(amIn + end)}`;

    const perMinuteLabel = settings.lateType === 'per_minute'
        ? `₱${formatNumber(settings.latePerMinute || 0)}/min late`
        : 'minutes late';

    const rulesParts = [
        `Grace ${tierRange(0, grace)}`,
        `${tierRange(grace + 1, perMinEnd)}: ${perMinuteLabel}`,
        `${tierRange(perMinEnd + 1, flat1hrEnd)}: 1hr`,
        `${tierRange(flat1hrEnd + 1, flat2hrEnd)}: 2hr`,
        `${tierRange(flat2hrEnd + 1, halfDayEnd)}: Half day`
    ];

    const scheduleText = `${settings.scheduleAmIn}-${settings.scheduleAmOut} & ${settings.schedulePmIn}-${settings.schedulePmOut} | OT: Beyond ${settings.schedulePmOut}`;

    hintEl.innerHTML = `
        <div>Enter employee names and time in/out for each day. Format: HH:MM (e.g., 08:00, 17:00)</div>
        <div><strong>Late Rules:</strong> ${rulesParts.join(' | ')}</div>
        <div><strong>Schedule:</strong> ${scheduleText}${settings.sundayAllOT ? ' | <span class="badge badge-warning">SUN</span> = All hours at OT rate' : ''}</div>
    `;
}

function renderPasteDtrTabs() {
    const wrap = document.getElementById('pasteDtrTabs');
    if (!wrap) return;
    wrap.innerHTML = `
        <button type="button" class="paste-dtr-tab ${pasteDtrActiveTab === 1 ? 'active' : ''}" onclick="switchPasteDtrTab(1)">Days 1-${PASTE_DTR_DAY1_END}</button>
        <button type="button" class="paste-dtr-tab ${pasteDtrActiveTab === 2 ? 'active' : ''}" onclick="switchPasteDtrTab(2)">Days ${PASTE_DTR_DAY1_END + 1}-${pasteDtrDaysInMonth}</button>
    `;
}

function switchPasteDtrTab(tab) {
    pasteDtrActiveTab = tab;
    renderPasteDtrTabs();
    applyPasteDtrTabVisibility();
}

function applyPasteDtrTabVisibility() {
    document.querySelectorAll('#pasteDtrTable .day-group-1').forEach(el => {
        el.classList.toggle('paste-dtr-hidden', pasteDtrActiveTab !== 1);
    });
    document.querySelectorAll('#pasteDtrTable .day-group-2').forEach(el => {
        el.classList.toggle('paste-dtr-hidden', pasteDtrActiveTab !== 2);
    });
}

function renderPasteDtrTableHead(year, month) {
    const thead = document.getElementById('pasteDtrTableHead');
    if (!thead) return;

    let headerCells = `<th class="paste-dtr-emp-col">Employee</th>`;
    for (let day = 1; day <= pasteDtrDaysInMonth; day++) {
        const dateObj = new Date(year, month - 1, day);
        const weekday = WEEKDAY_ABBR[dateObj.getDay()];
        const isSunday = dateObj.getDay() === 0;
        const groupClass = day <= PASTE_DTR_DAY1_END ? 'day-group-1' : 'day-group-2';
        headerCells += `
            <th class="paste-dtr-day-col ${groupClass} ${isSunday ? 'paste-dtr-sunday' : ''}">
                <div>Day ${day} ${isSunday ? '<span class="badge badge-warning">SUN</span>' : `<small class="paste-dtr-weekday">${weekday}</small>`}</div>
                <small>In / Out</small>
            </th>`;
    }
    headerCells += `<th class="paste-dtr-del-col"></th>`;
    thead.innerHTML = `<tr>${headerCells}</tr>`;
}

function renderPasteDtrTableBody(preserveNames) {
    const tbody = document.getElementById('pasteDtrTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const names = (preserveNames && preserveNames.length > 0) ? preserveNames : [''];
    names.forEach(name => addPasteDtrEmployeeRow(name));
}

function addPasteDtrEmployeeRow(name) {
    const tbody = document.getElementById('pasteDtrTableBody');
    if (!tbody) return null;
    const row = document.createElement('tr');

    let cells = `
        <td class="paste-dtr-emp-col">
            <input type="text" class="form-control paste-dtr-name-input" list="pasteDtrEmployeeList" placeholder="Name" value="${escapeHtml(name || '')}">
        </td>`;

    for (let day = 1; day <= pasteDtrDaysInMonth; day++) {
        const groupClass = day <= PASTE_DTR_DAY1_END ? 'day-group-1' : 'day-group-2';
        const hiddenClass = (groupClass === 'day-group-1') === (pasteDtrActiveTab === 1) ? '' : 'paste-dtr-hidden';
        cells += `
            <td class="paste-dtr-day-cell ${groupClass} ${hiddenClass}" data-day="${day}">
                <input type="time" class="form-control paste-dtr-time-in" title="Time In">
                <input type="time" class="form-control paste-dtr-time-out" title="Time Out">
            </td>`;
    }

    cells += `
        <td class="paste-dtr-del-col">
            <button class="btn-icon" type="button" onclick="removePasteDtrRow(this)" title="Remove row" style="color: var(--danger);">
                <i class="fas fa-trash"></i>
            </button>
        </td>`;

    row.innerHTML = cells;
    tbody.appendChild(row);
    return row;
}

function removePasteDtrRow(btn) {
    const tbody = document.getElementById('pasteDtrTableBody');
    btn.closest('tr').remove();
    if (tbody && tbody.rows.length === 0) addPasteDtrEmployeeRow('');
}

function clearPasteDtrGrid() {
    if (!confirm('Clear all rows in this grid? This does not affect entries already saved.')) return;
    buildPasteDtrGrid();
}

// --- Spreadsheet-style paste across the whole grid ---

function setupPasteDtrPasteHandler() {
    const table = document.getElementById('pasteDtrTable');
    if (!table || table.dataset.pasteBound) return;
    table.dataset.pasteBound = '1';
    table.addEventListener('paste', handlePasteDtrGridPaste);
}

function getPasteDtrRowInputs(row) {
    // Ordered: [nameInput, day1In, day1Out, day2In, day2Out, ...]
    const inputs = [row.querySelector('.paste-dtr-name-input')];
    row.querySelectorAll('.paste-dtr-day-cell').forEach(cell => {
        inputs.push(cell.querySelector('.paste-dtr-time-in'));
        inputs.push(cell.querySelector('.paste-dtr-time-out'));
    });
    return inputs;
}

function handlePasteDtrGridPaste(e) {
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    // A single value (no tabs/newlines) - let the browser paste normally into the one field.
    if (!text.includes('\t') && !text.includes('\n')) return;

    const target = e.target.closest('input');
    if (!target) return;
    e.preventDefault();

    const tbody = document.getElementById('pasteDtrTableBody');
    const startRow = target.closest('tr');
    let rows = [...tbody.querySelectorAll('tr')];
    const startRowIndex = rows.indexOf(startRow);
    const startInputs = getPasteDtrRowInputs(startRow);
    let startColIndex = startInputs.indexOf(target);
    if (startColIndex === -1) startColIndex = 0;

    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
        .filter((l, i, arr) => !(i === arr.length - 1 && l === ''));

    lines.forEach((line, r) => {
        const cols = line.split('\t');
        const rowIndex = startRowIndex + r;
        while (rowIndex >= rows.length) {
            addPasteDtrEmployeeRow('');
            rows = [...tbody.querySelectorAll('tr')];
        }
        const targetRow = rows[rowIndex];
        const inputs = getPasteDtrRowInputs(targetRow);

        cols.forEach((val, c) => {
            const input = inputs[startColIndex + c];
            if (!input) return; // beyond the last day column in the month, ignore
            const trimmed = val.trim();
            if (!trimmed) return;
            if (input.classList.contains('paste-dtr-name-input')) {
                input.value = trimmed;
            } else if (input.type === 'time') {
                const t = normalizeTime(trimmed);
                if (t) input.value = t;
            }
        });
    });

    applyPasteDtrTabVisibility();
    showToast(`Pasted ${lines.length} row(s) into the grid.`, 'success');
}

// --- Import into DTR records ---

async function createEmployeeFromPasteName(rawName) {
    const parts = rawName.trim().replace(/\s+/g, ' ').split(' ');
    const firstName = parts.shift() || rawName;
    const lastName = parts.join(' ') || '-';
    const id = await generateEmployeeId();
    if (!id) return null;

    const newEmployee = {
        id, firstName, middleName: '', lastName,
        position: settings.defaultPosition || 'Employee',
        department: '', email: '', phone: '', address: '',
        dailyRate: settings.defaultDailyRate || 400.00,
        hourlyRate: settings.defaultHourlyRate || 50.00,
        baseDailyPay: settings.baseDailyPay || 500.00,
        hireDate: getTodayDateStr(),
        sssNumber: '', philhealthNumber: '', pagibigNumber: '', tin: '',
        status: 'active'
    };

    const { error } = await supabaseClient.from('employees').insert(mapEmployeeToDb(newEmployee));
    if (error) {
        showToast(`Could not create employee "${rawName}": ${error.message}`, 'error');
        return null;
    }
    employees.push(newEmployee);
    return newEmployee;
}

async function importPasteDtrAttendance() {
    if (!requireSupabase()) return;

    const monthValue = getPasteDtrMonthValue();
    if (!monthValue) {
        showToast('Select a month first.', 'error');
        return;
    }
    const [yearStr, monthStr] = monthValue.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const rows = [...document.querySelectorAll('#pasteDtrTableBody tr')];
    let newEmployees = 0;
    let skippedIncomplete = 0;
    const rowsToUpsert = [];

    for (const row of rows) {
        const nameInput = row.querySelector('.paste-dtr-name-input');
        const rawName = (nameInput?.value || '').trim();
        if (!rawName) continue; // skip blank rows entirely

        let employee = matchEmployeeByName(rawName);
        if (!employee) {
            employee = await createEmployeeFromPasteName(rawName);
            if (!employee) continue; // creation failed, already toasted
            newEmployees++;
        }

        row.querySelectorAll('.paste-dtr-day-cell').forEach(cell => {
            const day = parseInt(cell.dataset.day, 10);
            const timeIn = cell.querySelector('.paste-dtr-time-in')?.value || '';
            const timeOut = cell.querySelector('.paste-dtr-time-out')?.value || '';
            if (!timeIn && !timeOut) return; // nothing entered for this day

            if (!timeIn || !timeOut) {
                skippedIncomplete++;
                return; // need both Time In and Time Out to compute a day
            }

            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const result = computeDtrForDay(timeIn, timeOut, dateStr);
            if (!result) return;

            rowsToUpsert.push({
                employee_id: employee.id,
                date: dateStr,
                time_in: timeIn,
                time_out: timeOut,
                total_hours: result.totalHours,
                ot_hours: result.otHours,
                late_minutes: result.lateMinutes,
                status: result.status,
                source: 'paste_import'
            });
        });
    }

    if (rowsToUpsert.length === 0) {
        showToast('No complete Time In / Time Out pairs found to import.', 'error');
        return;
    }

    const { error } = await supabaseClient
        .from('dtr_entries')
        .upsert(rowsToUpsert, { onConflict: 'employee_id,date' });

    if (error) {
        showToast('Import failed: ' + error.message, 'error');
        return;
    }

    const importedEntries = rowsToUpsert.length;
    closeModal('bulkDtrModal');
    await loadDTR();
    await loadEmployees();
    updateDashboard();

    const summary = [`${importedEntries} day${importedEntries === 1 ? '' : 's'} imported`];
    if (newEmployees) summary.push(`${newEmployees} new employee${newEmployees === 1 ? '' : 's'} added`);
    if (skippedIncomplete) summary.push(`${skippedIncomplete} incomplete row${skippedIncomplete === 1 ? '' : 's'} skipped (need both Time In and Time Out)`);
    showToast(summary.join(', ') + '.', 'success');
}

// ============================================
// Shared parsing / matching helpers
// ============================================

function splitDtrColumns(line) {
    if (line.includes('\t')) return line.split('\t').map(c => c.trim());
    // CSV: handle quoted commas
    if (line.includes(',')) {
        const cols = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                cols.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        cols.push(current.trim());
        return cols;
    }
    // Multiple spaces
    return line.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
}

function matchEmployeeByName(raw) {
    if (!raw) return null;
    const cleaned = raw.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!cleaned) return null;

    const list = getActiveEmployees();

    // Exact id match
    const byId = list.find(e => e.id.toLowerCase() === cleaned);
    if (byId) return byId;

    // "Last, First" or "First Last"
    const noComma = cleaned.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

    const exactFull = list.find(e => {
        const full = `${e.firstName} ${e.lastName}`.toLowerCase();
        const fullMid = `${e.firstName} ${e.middleName || ''} ${e.lastName}`.replace(/\s+/g, ' ').trim().toLowerCase();
        const lastFirst = `${e.lastName} ${e.firstName}`.toLowerCase();
        return noComma === full || noComma === fullMid || noComma === lastFirst;
    });
    if (exactFull) return exactFull;

    // Contains both first and last
    const partial = list.find(e => {
        const first = e.firstName.toLowerCase();
        const last = e.lastName.toLowerCase();
        return noComma.includes(first) && noComma.includes(last);
    });
    if (partial) return partial;

    // Unique last-name match
    const lastMatches = list.filter(e => e.lastName.toLowerCase() === noComma || noComma.endsWith(' ' + e.lastName.toLowerCase()));
    if (lastMatches.length === 1) return lastMatches[0];

    return null;
}

function normalizeDate(value) {
    if (!value) return '';
    const v = value.trim();

    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

    // MM/DD/YYYY or M/D/YYYY
    let m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
        let month = parseInt(m[1], 10);
        let day = parseInt(m[2], 10);
        let year = parseInt(m[3], 10);
        if (year < 100) year += 2000;
        // If first part > 12, treat as DD/MM/YYYY
        if (month > 12 && day <= 12) {
            const tmp = month;
            month = day;
            day = tmp;
        }
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    // Excel serial date (e.g. 45901)
    if (/^\d{5}$/.test(v)) {
        const serial = parseInt(v, 10);
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const date = new Date(excelEpoch.getTime() + serial * 86400000);
        return date.toISOString().split('T')[0];
    }

    const parsed = new Date(v);
    if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const mo = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${mo}-${d}`;
    }
    return '';
}

function normalizeTime(value) {
    if (!value) return '';
    let v = value.trim().toLowerCase();

    // Already HH:MM or HH:MM:SS
    let m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
    if (m) {
        let h = parseInt(m[1], 10);
        const min = m[2];
        const ampm = (m[3] || '').toLowerCase();
        if (ampm === 'pm' && h < 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${min}`;
    }

    // Excel fraction of day (0.333 = 8:00)
    if (/^0?\.\d+$/.test(v)) {
        const fraction = parseFloat(v);
        const totalMin = Math.round(fraction * 24 * 60);
        const h = Math.floor(totalMin / 60) % 24;
        const min = totalMin % 60;
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }

    return '';
}

function normalizeStatus(value) {
    const v = (value || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (v === 'late') return 'late';
    if (v === 'absent') return 'absent';
    if (v === 'half_day' || v === 'halfday' || v === 'half-day' || v === 'half day') return 'half_day';
    return 'present';
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function timeStrToMinutes(t) {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}

// ============================================
// Shared shift-hours engine
// ------------------------------------------------
// Employees only punch a single Time In (e.g. 8:00 AM) and a single Time
// Out (e.g. 5:00 PM) - the lunch break (AM Time Out -> PM Time In,
// e.g. 12:00-1:00) is deducted automatically whenever the shift spans it,
// with no separate lunch time in/out needed. Anything worked past PM
// Time Out is counted as overtime. This one function backs manual DTR
// entry, QR scans, and the Paste DTR grid so all three agree.
// ============================================
function computeShiftMinutes(timeIn, timeOut) {
    const amOut = timeStrToMinutes(settings.scheduleAmOut || '12:00');
    const pmIn = timeStrToMinutes(settings.schedulePmIn || '13:00');
    const pmOut = timeStrToMinutes(settings.schedulePmOut || '17:00');
    let inMin = timeStrToMinutes(timeIn);
    let outMin = timeStrToMinutes(timeOut);
    if (inMin === null || outMin === null) return { workedMinutes: 0, otMinutes: 0 };
    if (outMin <= inMin) outMin += 24 * 60; // guard against overnight/typo entries

    // Worked minutes, minus the AM-out -> PM-in lunch gap if the shift spans it.
    let workedMinutes = outMin - inMin;
    const lunchGap = (amOut !== null && pmIn !== null) ? Math.max(0, pmIn - amOut) : 0;
    const spansLunch = lunchGap > 0 && amOut !== null && pmIn !== null && inMin <= amOut && outMin >= pmIn;
    if (spansLunch) {
        workedMinutes -= lunchGap;
    } else if (!lunchGap) {
        // No AM/PM lunch window configured (or it's zero-length) - fall back
        // to the flat break-minutes setting instead.
        workedMinutes -= settings.breakMinutes || 0;
    }
    workedMinutes = Math.max(0, workedMinutes);

    const otMinutes = (pmOut !== null && outMin > pmOut) ? outMin - pmOut : 0;

    return { workedMinutes, otMinutes };
}

function calculateWorkHours(timeIn, timeOut) {
    if (!timeIn || !timeOut) return 0;
    return computeShiftMinutes(timeIn, timeOut).workedMinutes / 60;
}

function calculateOTHours(timeIn, timeOut, dateStr) {
    if (!timeIn || !timeOut) return 0;
    if (dateStr && isSundayDate(dateStr) && settings.sundayAllOT) {
        // Sunday-all-OT: every hour worked that day is OT (there is no
        // base/day pay for Sundays), not just the overflow past PM Time
        // Out that a normal weekday would count as OT.
        return calculateWorkHours(timeIn, timeOut);
    }
    return computeShiftMinutes(timeIn, timeOut).otMinutes / 60;
}

function calculateLateMinutes(timeIn) {
    if (!timeIn || !settings.standardTimeIn) return 0;

    const [inH, inM] = timeIn.split(':').map(Number);
    const [stdH, stdM] = settings.standardTimeIn.split(':').map(Number);

    const inTotal = inH * 60 + inM;
    const stdTotal = stdH * 60 + stdM;

    if (inTotal <= stdTotal) return 0;
    return inTotal - stdTotal;
}

// ============================================
// Attendance rule engine (used by the Paste DTR Data grid)
// Applies the split AM/PM schedule, tiered late rules, OT-beyond-PM-out,
// and the Sunday-all-OT rule configured in Settings.
//
// Half-day recognition: a shift confined entirely to one side of the
// lunch gap (arrived at/after PM Time In, or left at/before PM Time In)
// is a genuine AM-only or PM-only half day - it's marked 'half_day'
// regardless of how minor the lateness within that half was, because
// the half-day *is* the day type, not a lateness severity tier.
// Lateness is still measured against the correct half's own start time
// (PM Time In for a PM half, AM Time In otherwise) and still reduces
// pay via lateDeduction in computeEmployeePayroll - it just no longer
// wrongly zeroes out the half-day credit itself, and no longer measures
// a PM-only arrival's lateness against the AM start (which used to read
// a normal 1pm arrival as hours "late" and could push it to 'absent').
// A shift that spans both halves (arrived in the AM, left after PM Time
// In) is unaffected - it still uses the original full-day thresholds.
// ============================================
function computeDtrForDay(timeIn, timeOut, dateStr) {
    if (!timeIn && !timeOut) return null;
    if (!timeIn || !timeOut) {
        return { status: 'absent', lateMinutes: 0, totalHours: 0, otHours: 0, isSunday: isSundayDate(dateStr), incomplete: true };
    }

    const isSunday = isSundayDate(dateStr);
    const amIn = timeStrToMinutes(settings.scheduleAmIn || '08:00');
    const pmIn = timeStrToMinutes(settings.schedulePmIn || '13:00');
    let inMin = timeStrToMinutes(timeIn);
    let outMin = timeStrToMinutes(timeOut);
    if (inMin === null || outMin === null) return null;
    if (outMin <= inMin) outMin += 24 * 60; // guard against overnight/typo entries

    const { workedMinutes, otMinutes: shiftOtMinutes } = computeShiftMinutes(timeIn, timeOut);
    let otMinutes = shiftOtMinutes;
    let status = 'present';
    let lateMinutes = 0;

    if (isSunday && settings.sundayAllOT) {
        // Entire shift is paid at OT rate; late rules don't apply
        lateMinutes = 0;
        otMinutes = workedMinutes;
        status = 'present';
    } else {
        const arrivedForPM = (pmIn !== null && inMin >= pmIn);
        const leftBeforePM = (pmIn !== null && outMin <= pmIn);
        const isHalfDay = arrivedForPM || leftBeforePM;

        lateMinutes = arrivedForPM
            ? ((pmIn !== null && inMin > pmIn) ? inMin - pmIn : 0)
            : ((amIn !== null && inMin > amIn) ? inMin - amIn : 0);

        const grace = settings.lateGraceEnd ?? 10;
        const flat2hrEnd = settings.lateFlat2hrEnd ?? 89;
        const halfDayEnd = settings.lateHalfDayEnd ?? 149;

        if (lateMinutes > halfDayEnd) {
            // Too late to count even as a half day (or, for a full-day
            // shift, the original "extremely late" cutoff).
            status = 'absent';
        } else if (isHalfDay) {
            // Confined to one half of the day - that's the day type,
            // regardless of exactly how late within it they were.
            status = 'half_day';
        } else if (lateMinutes <= grace) {
            status = 'present';
        } else if (lateMinutes <= flat2hrEnd) {
            status = 'late';
        } else {
            // Full-day shift, very late but under the absence cutoff.
            status = 'half_day';
        }
    }

    return {
        status,
        lateMinutes,
        totalHours: parseFloat((workedMinutes / 60).toFixed(2)),
        otHours: parseFloat((otMinutes / 60).toFixed(2)),
        isSunday
    };
}

function isSundayDate(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr + 'T00:00:00');
    return d.getDay() === 0;
}

// ============================================
// Payroll Functions
// ============================================

// Returns the configured pay periods (falls back to the built-in
// semi-monthly default if none have been customized yet).
function getPayPeriods() {
    if (Array.isArray(settings.payPeriods) && settings.payPeriods.length > 0) {
        return settings.payPeriods;
    }
    return [
        { id: 'p1', label: '1st - 15th', startDay: 1, endDay: 15, payoutDay: 20, payoutMonthOffset: 0 },
        { id: 'p2', label: '16th - End of Month', startDay: 16, endDay: 'last', payoutDay: 5, payoutMonthOffset: 1 }
    ];
}

// Resolves a configured pay period against a specific year/month into
// concrete YYYY-MM-DD start/end/payout dates. `endDay: 'last'` always
// resolves to that month's actual last day. payoutMonthOffset shifts the
// payout date forward by that many months (0 = same month as the
// period, 1 = the following month, etc.), clamped to a valid day in
// whichever month it lands on.
function getPayPeriodRange(year, month, period) {
    const lastDay = getDaysInMonth(year, month);
    const startDay = Math.min(Math.max(parseInt(period.startDay, 10) || 1, 1), lastDay);
    const endDay = period.endDay === 'last' ? lastDay : Math.min(parseInt(period.endDay, 10) || lastDay, lastDay);
    const startDate = `${year}-${pad2(month)}-${pad2(startDay)}`;
    const endDate = `${year}-${pad2(month)}-${pad2(endDay)}`;

    let payoutYear = year;
    let payoutMonth = month + (parseInt(period.payoutMonthOffset, 10) || 0);
    while (payoutMonth > 12) { payoutMonth -= 12; payoutYear += 1; }
    while (payoutMonth < 1) { payoutMonth += 12; payoutYear -= 1; }
    const payoutLastDay = getDaysInMonth(payoutYear, payoutMonth);
    const payoutDay = Math.min(parseInt(period.payoutDay, 10) || payoutLastDay, payoutLastDay);
    const payoutDate = `${payoutYear}-${pad2(payoutMonth)}-${pad2(payoutDay)}`;

    return { startDate, endDate, payoutDate };
}

// (Re)populates the Payroll page's Pay Period dropdown from the
// currently configured periods, preserving the current selection where
// it still exists.
function populatePayrollPeriodOptions() {
    const sel = document.getElementById('payrollPeriodFilter');
    if (!sel) return;
    const periods = getPayPeriods();
    const prevValue = sel.value;

    sel.innerHTML = periods.map(p => `<option value="${p.id}">${p.label}</option>`).join('')
        + `<option value="full">Full Month</option>`;

    if (prevValue === 'full' || periods.some(p => p.id === prevValue)) {
        sel.value = prevValue;
    } else if (periods.length > 0) {
        sel.value = periods[0].id;
    }
}

function loadPayroll() {
    const employeeFilter = document.getElementById('payrollEmployeeFilter')?.value;
    const monthFilter = document.getElementById('payrollMonthFilter')?.value;
    const periodFilter = document.getElementById('payrollPeriodFilter')?.value || 'full';

    if (!monthFilter) return;

    const [year, month] = monthFilter.split('-').map(Number);
    let startDate, endDate, payoutDate = null;

    if (periodFilter !== 'full') {
        const period = getPayPeriods().find(p => p.id === periodFilter);
        if (period) {
            const range = getPayPeriodRange(year, month, period);
            startDate = range.startDate;
            endDate = range.endDate;
            payoutDate = range.payoutDate;
        }
    }
    if (!startDate) {
        startDate = getMonthStartStr(year, month);
        endDate = getMonthEndStr(year, month);
    }

    // Set globals for payslip generation
    startDateGlobal = startDate;
    endDateGlobal = endDate;
    payoutDateGlobal = payoutDate;

    const infoEl = document.getElementById('payrollPeriodInfo');
    if (infoEl) {
        infoEl.textContent = payoutDate
            ? `Cutoff: ${formatDate(startDate)} - ${formatDate(endDate)}  •  Payout date: ${formatDate(payoutDate)}`
            : `Cutoff: ${formatDate(startDate)} - ${formatDate(endDate)}`;
    }

    let filteredDTR = dtrEntries.filter(d => d.date >= startDate && d.date <= endDate);

    if (employeeFilter) {
        filteredDTR = filteredDTR.filter(d => d.employeeId === employeeFilter);
    }

    const tbody = document.getElementById('payrollTableBody');
    tbody.innerHTML = '';

    const activeEmployees = employees.filter(e => e.status === 'active');

    if (employeeFilter) {
        const emp = employees.find(e => e.id === employeeFilter);
        if (emp) {
            const empDTRs = filteredDTR.filter(d => d.employeeId === employeeFilter);
            const payrollData = computeEmployeePayroll(emp, empDTRs, startDate, endDate);
            renderPayrollRow(tbody, emp, payrollData);

        }
    } else {
        activeEmployees.forEach(emp => {
            const empDTRs = filteredDTR.filter(d => d.employeeId === emp.id);
            const payrollData = computeEmployeePayroll(emp, empDTRs, startDate, endDate);
            renderPayrollRow(tbody, emp, payrollData);
        });
    }
}

// PH SSS Contribution Table (2024 rates)
const SSS_TABLE = [
    { range: [0, 4250], ee: 180, er: 420 },
    { range: [4250, 4750], ee: 202.50, er: 472.50 },
    { range: [4750, 5250], ee: 225, er: 525 },
    { range: [5250, 5750], ee: 247.50, er: 577.50 },
    { range: [5750, 6250], ee: 270, er: 630 },
    { range: [6250, 6750], ee: 292.50, er: 682.50 },
    { range: [6750, 7250], ee: 315, er: 735 },
    { range: [7250, 7750], ee: 337.50, er: 787.50 },
    { range: [7750, 8250], ee: 360, er: 840 },
    { range: [8250, 8750], ee: 382.50, er: 892.50 },
    { range: [8750, 9250], ee: 405, er: 945 },
    { range: [9250, 9750], ee: 427.50, er: 997.50 },
    { range: [9750, 10250], ee: 450, er: 1050 },
    { range: [10250, 10750], ee: 472.50, er: 1102.50 },
    { range: [10750, 11250], ee: 495, er: 1155 },
    { range: [11250, 11750], ee: 517.50, er: 1207.50 },
    { range: [11750, 12250], ee: 540, er: 1260 },
    { range: [12250, 12750], ee: 562.50, er: 1312.50 },
    { range: [12750, 13250], ee: 585, er: 1365 },
    { range: [13250, 13750], ee: 607.50, er: 1417.50 },
    { range: [13750, 14250], ee: 630, er: 1470 },
    { range: [14250, 14750], ee: 652.50, er: 1522.50 },
    { range: [14750, 15250], ee: 675, er: 1575 },
    { range: [15250, 15750], ee: 697.50, er: 1627.50 },
    { range: [15750, 16250], ee: 720, er: 1680 },
    { range: [16250, 16750], ee: 742.50, er: 1732.50 },
    { range: [16750, 17250], ee: 765, er: 1785 },
    { range: [17250, 17750], ee: 787.50, er: 1837.50 },
    { range: [17750, 18250], ee: 810, er: 1890 },
    { range: [18250, 18750], ee: 832.50, er: 1942.50 },
    { range: [18750, 19250], ee: 855, er: 1995 },
    { range: [19250, 19750], ee: 877.50, er: 2047.50 },
    { range: [19750, 20250], ee: 900, er: 2100 },
    { range: [20250, 20750], ee: 922.50, er: 2152.50 },
    { range: [20750, 21250], ee: 945, er: 2205 },
    { range: [21250, 21750], ee: 967.50, er: 2257.50 },
    { range: [21750, 22250], ee: 990, er: 2310 },
    { range: [22250, 22750], ee: 1012.50, er: 2362.50 },
    { range: [22750, 23250], ee: 1035, er: 2415 },
    { range: [23250, 23750], ee: 1057.50, er: 2467.50 },
    { range: [23750, 24250], ee: 1080, er: 2520 },
    { range: [24250, 24750], ee: 1102.50, er: 2572.50 },
    { range: [24750, 25250], ee: 1125, er: 2625 },
    { range: [25250, 25750], ee: 1147.50, er: 2677.50 },
    { range: [25750, 26250], ee: 1170, er: 2730 },
    { range: [26250, 26750], ee: 1192.50, er: 2782.50 },
    { range: [26750, 27250], ee: 1215, er: 2835 },
    { range: [27250, 27750], ee: 1237.50, er: 2887.50 },
    { range: [27750, 28250], ee: 1260, er: 2940 },
    { range: [28250, 28750], ee: 1282.50, er: 2992.50 },
    { range: [28750, 29250], ee: 1305, er: 3045 },
    { range: [29250, 29750], ee: 1327.50, er: 3097.50 },
    { range: [29750, 30250], ee: 1350, er: 3150 },
];

// PH PhilHealth Contribution (2024: 5% of monthly salary, split 50/50, max ₱5,000/mo salary base)
function computePhilHealth(monthlySalary) {
    const base = Math.min(monthlySalary, 100000) * 0.05; // 5% of salary, max base 100k
    const total = Math.min(base, 5000); // Max ₱5,000 per month
    return { ee: total / 2, er: total / 2 }; // Split equally
}

// PH Pag-IBIG Contribution (2024: 2% of monthly salary, max ₱100 each for EE/ER)
function computePagibig(monthlySalary) {
    const contribution = Math.min(monthlySalary * 0.02, 100);
    return { ee: contribution, er: contribution };
}

// Get SSS contribution based on monthly salary credit
function computeSSS(monthlySalary) {
    const row = SSS_TABLE.find(r => monthlySalary >= r.range[0] && monthlySalary < r.range[1]);
    if (row) return { ee: row.ee, er: row.er };
    // Max contribution
    return { ee: 1350, er: 3150 };
}

// ============================================
// Payroll Deduction Adjustments
// (per employee, per pay period - lets you waive/override statutory
// deductions and add ad-hoc deductions like cash advances or loans)
// ============================================

function getAdjustmentKey(employeeId, startDate, endDate) {
    return `${employeeId}|${startDate}|${endDate}`;
}

function loadAllPayrollAdjustments() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.PAYROLL_ADJUSTMENTS) || '{}');
    } catch {
        return {};
    }
}

function getPayrollAdjustment(employeeId, startDate, endDate) {
    const all = loadAllPayrollAdjustments();
    const key = getAdjustmentKey(employeeId, startDate, endDate);
    return all[key] || { sssOverride: null, philhealthOverride: null, pagibigOverride: null, otherDeductions: [] };
}

function savePayrollAdjustment(employeeId, startDate, endDate, adjustment) {
    const all = loadAllPayrollAdjustments();
    const key = getAdjustmentKey(employeeId, startDate, endDate);

    const isEmpty = (adjustment.sssOverride === null || adjustment.sssOverride === undefined) &&
        (adjustment.philhealthOverride === null || adjustment.philhealthOverride === undefined) &&
        (adjustment.pagibigOverride === null || adjustment.pagibigOverride === undefined) &&
        (!adjustment.otherDeductions || adjustment.otherDeductions.length === 0);

    if (isEmpty) {
        delete all[key];
    } else {
        all[key] = adjustment;
    }
    localStorage.setItem(STORAGE_KEYS.PAYROLL_ADJUSTMENTS, JSON.stringify(all));
}

function computeEmployeePayroll(emp, dtrs, startDate, endDate) {
    const adjustment = getPayrollAdjustment(emp.id, startDate, endDate);

    // Entries manually flagged (via Edit DTR Entry) to be paid by actual
    // hours worked instead of the flat daily/half-day rate - e.g. an
    // undertime day (came in late, also left early) where flat day/half
    // day pay would overpay for the hours actually worked. Late
    // deduction and OT still apply to these exactly as normal below;
    // only the base "days worked" pay is computed differently for them.
    //
    // Sundays under the "Sunday = all hours OT" rule get no base/day pay
    // at all - every hour worked that day is paid entirely through
    // otPay below instead (otHours/otPay are summed across ALL dtrs, so
    // this exclusion only affects the flat day-rate/hourly-override
    // side). Derived from the entry's own date rather than a stored
    // isSunday flag, since that flag is only set on entries that went
    // through the Paste DTR grid's attendance engine - manual and
    // kiosk/QR entries need the same rule applied just as reliably.
    const isSundayNoBasePay = d => isSundayDate(d.date) && settings.sundayAllOT;
    const overrideDtrs = dtrs.filter(d => d.hourlyOverride && !isSundayNoBasePay(d));
    const standardDtrs = dtrs.filter(d => !d.hourlyOverride && !isSundayNoBasePay(d));

    // Full days worked. 'late' still counts as a full day worked - the
    // lateness itself is penalized separately below via lateDeduction.
    // 'half_day' is counted separately below since it's paid at half rate.
    const fullDaysWorked = standardDtrs.filter(d =>
        d.status === 'present' || d.status === 'late'
    ).length;

    // Half days worked. The attendance engine (server-side for kiosk
    // punches, computeDtrForDay() below for manual/paste entries) only
    // assigns 'half_day' when the shift was genuinely confined to one
    // AM/PM window - so the status alone is trustworthy. Lateness within
    // that half is penalized separately via lateDeduction, not by
    // requiring a minimum hour count here (a late-but-real half day, e.g.
    // 3.98 hrs because the employee was 1 minute late, would otherwise be
    // silently zeroed out).
    const halfDaysWorked = standardDtrs.filter(d => d.status === 'half_day').length;

    // Kept for anything downstream (OT cap, rendering, etc.) that expects
    // a single "days worked" figure. Half days count as 0.5 for that
    // purpose. Hourly-override days aren't "days" in the flat-rate sense
    // (see hourlyOverrideHours/hourlyOverridePay below), so they're
    // tracked separately.
    const daysWorked = fullDaysWorked + (halfDaysWorked * 0.5);

    // Calculate total hours (all entries, for display/reporting)
    const totalHours = dtrs.reduce((sum, d) => sum + (d.totalHours || 0), 0);

    // Regular hours (capped at 8 hrs/day * daysWorked)
    const maxRegularHours = daysWorked * 8;
    const regularHours = Math.min(totalHours, maxRegularHours);
    const otHours = dtrs.reduce((sum, d) => sum + (d.otHours || 0), 0);

    // Daily rate based calculation
    const dailyRate = emp.dailyRate || settings.defaultDailyRate || 500;
    const hourlyRate = emp.hourlyRate || settings.defaultHourlyRate || (dailyRate / 8);
    const baseDailyPay = emp.baseDailyPay || settings.baseDailyPay || dailyRate;

    // Hourly-override pay: actual hours worked (excluding OT, which is
    // already paid separately via otPay below) times the hourly rate,
    // instead of a flat daily/half-day rate. E.g. in at 8:01, out at
    // 12:00 (undertime, 3.98 hrs) pays for 3.98 hrs instead of a flat
    // half day; in at 2:00 PM, out at 6:00 PM pays 3 regular hours
    // (2-5 PM) plus 1 OT hour (5-6 PM) via the normal OT calculation.
    const hourlyOverrideHours = overrideDtrs.reduce(
        (sum, d) => sum + Math.max(0, (d.totalHours || 0) - (d.otHours || 0)), 0
    );
    const hourlyOverridePay = hourlyOverrideHours * hourlyRate;

    // Regular pay = daily rate * full days + half daily rate * half days
    //             + actual-hours pay for any hourly-override entries
    const regularPay = (dailyRate * fullDaysWorked) + (dailyRate * 0.5 * halfDaysWorked) + hourlyOverridePay;

    // OT pay = hourly rate * 1.25 * OT hours (PH law: 125% for OT on regular days)
    const otRate = settings.otRate || (hourlyRate * 1.25);
    const otPay = otRate * otHours;

    // Late deductions
    let lateDeduction = 0;
    dtrs.forEach(dtr => {
        if (dtr.lateMinutes > 0) {
            if (settings.lateType === 'per_minute') {
                lateDeduction += dtr.lateMinutes * (settings.latePerMinute || 1);
            } else {
                // Per range
                const range = settings.lateRanges?.find(r => dtr.lateMinutes >= r.min && dtr.lateMinutes <= r.max);
                if (range) {
                    lateDeduction += range.amount;
                }
            }
        }
    });

    // Gross pay
    const grossPay = regularPay + otPay;

    // Check if statutory deductions are enabled
    const enableStatutory = settings.enableStatutoryDeductions !== false;

    let sssDeduction = 0, philhealthDeduction = 0, pagibigDeduction = 0;
    let sssAuto = 0, philhealthAuto = 0, pagibigAuto = 0;
    let sssGlobalDefault = 0, philhealthGlobalDefault = 0, pagibigGlobalDefault = 0;
    let sssER = 0, philhealthER = 0, pagibigER = 0;
    let statutoryDeductions = 0;

    if (enableStatutory) {
        // Monthly salary estimate for statutory deductions
        const monthlySalaryEstimate = grossPay * (30 / Math.max(daysWorked, 1));

        // Statutory deductions (Employee share) - auto-computed baseline
        const sss = computeSSS(monthlySalaryEstimate);
        const philhealth = computePhilHealth(monthlySalaryEstimate);
        const pagibig = computePagibig(monthlySalaryEstimate);

        sssAuto = sss.ee;
        philhealthAuto = philhealth.ee;
        pagibigAuto = pagibig.ee;
        sssER = sss.er;
        philhealthER = philhealth.er;
        pagibigER = pagibig.er;

        // Global default per type, set in Settings > Pay Settings, applies
        // to every employee: 'auto' uses the computed baseline above,
        // 'fixed' uses a flat amount for everyone, 'waived' means nobody
        // gets this deduction unless overridden per-employee below.
        sssGlobalDefault = settings.sssMode === 'fixed' ? (settings.sssFixedAmount || 0)
            : settings.sssMode === 'waived' ? 0
            : sssAuto;
        philhealthGlobalDefault = settings.philhealthMode === 'fixed' ? (settings.philhealthFixedAmount || 0)
            : settings.philhealthMode === 'waived' ? 0
            : philhealthAuto;
        pagibigGlobalDefault = settings.pagibigMode === 'fixed' ? (settings.pagibigFixedAmount || 0)
            : settings.pagibigMode === 'waived' ? 0
            : pagibigAuto;

        // A per-employee, per-period override (set via the payroll "Edit
        // Deductions" modal) always wins over the global default above.
        // null/undefined means "use the global default".
        sssDeduction = (adjustment.sssOverride !== null && adjustment.sssOverride !== undefined) ? adjustment.sssOverride : sssGlobalDefault;
        philhealthDeduction = (adjustment.philhealthOverride !== null && adjustment.philhealthOverride !== undefined) ? adjustment.philhealthOverride : philhealthGlobalDefault;
        pagibigDeduction = (adjustment.pagibigOverride !== null && adjustment.pagibigOverride !== undefined) ? adjustment.pagibigOverride : pagibigGlobalDefault;

        statutoryDeductions = sssDeduction + philhealthDeduction + pagibigDeduction;
    }

    // Other deductions: global recurring ones (Settings > Pay Settings,
    // apply automatically to every employee every period) plus any
    // one-off deductions added for this specific employee/period via the
    // payroll "Edit Deductions" modal.
    const globalOtherDeductions = (settings.globalOtherDeductions || []).map(d => ({ ...d, source: 'global' }));
    const periodOtherDeductions = (adjustment.otherDeductions || []).map(d => ({ ...d, source: 'period' }));
    const otherDeductions = [...globalOtherDeductions, ...periodOtherDeductions];
    const otherDeductionsTotal = otherDeductions.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);

    const isAdjusted = (adjustment.sssOverride !== null && adjustment.sssOverride !== undefined) ||
        (adjustment.philhealthOverride !== null && adjustment.philhealthOverride !== undefined) ||
        (adjustment.pagibigOverride !== null && adjustment.pagibigOverride !== undefined) ||
        periodOtherDeductions.length > 0;

    const totalDeductions = lateDeduction + statutoryDeductions + otherDeductionsTotal;

    // Net pay
    const netPay = grossPay - totalDeductions;

    return {
        daysWorked,
        fullDaysWorked,
        halfDaysWorked,
        hourlyOverrideHours,
        hourlyOverridePay,
        totalHours,
        regularHours,
        otHours,
        dailyRate,
        hourlyRate,
        baseDailyPay,
        regularPay,
        otRate,
        otPay,
        lateDeduction,
        lateMinutes: dtrs.reduce((sum, d) => sum + (d.lateMinutes || 0), 0),
        sssDeduction,
        philhealthDeduction,
        pagibigDeduction,
        sssAuto,
        philhealthAuto,
        pagibigAuto,
        sssGlobalDefault,
        philhealthGlobalDefault,
        pagibigGlobalDefault,
        otherDeductions,
        otherDeductionsTotal,
        isAdjusted,
        statutoryDeductions,
        totalDeductions,
        grossPay,
        netPay,
        // For payslip display
        sssER,
        philhealthER,
        pagibigER
    };
}

function renderPayrollRow(tbody, emp, data) {
    // An employee with no standard days worked AND no hourly-override
    // pay AND no OT pay genuinely has nothing to pay for the period -
    // skip the row. (Before hourly-override existed, daysWorked alone
    // was enough to decide this; now an employee whose only entries are
    // hourly-override days, or Sunday-all-OT days with no base pay,
    // would have daysWorked === 0 but still be owed pay.)
    if (data.daysWorked === 0 && !data.hourlyOverridePay && !data.otPay) return;

    const enableStatutory = settings.enableStatutoryDeductions !== false;

    // Always emit exactly one <td> here, matching the "Deductions" <th> in
    // the table header 1:1 - this column is never hidden anymore, which is
    // what caused Total Deductions/Net Pay/Status to shift over by one.
    const statutoryLines = enableStatutory ? [
        `<small>SSS: ₱${formatNumber(data.sssDeduction)}</small>`,
        `<small>PHIC: ₱${formatNumber(data.philhealthDeduction)}</small>`,
        `<small>Pag-IBIG: ₱${formatNumber(data.pagibigDeduction)}</small>`
    ] : [];
    const otherLines = data.otherDeductions.map(d =>
        `<small>${(d.label || 'Other')}: ₱${formatNumber(parseFloat(d.amount) || 0)}</small>`
    );
    const deductionLines = [...statutoryLines, ...otherLines];
    const statutoryCell = `
        <td style="color: var(--danger);">
            ${deductionLines.length > 0 ? deductionLines.join('<br>') : '<small class="text-muted">—</small>'}
        </td>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>
            <strong>${emp.firstName} ${emp.lastName}</strong>
            <br><small class="text-muted">${emp.id}</small>
        </td>
        <td>${data.daysWorked} days</td>
        <td>${data.totalHours.toFixed(2)} hrs</td>
        <td>₱${formatNumber(data.regularPay)}</td>
        <td>₱${formatNumber(data.otPay)}</td>
        <td style="color: var(--danger);">-₱${formatNumber(data.lateDeduction)}</td>
        ${statutoryCell}
        <td>₱${formatNumber(data.totalDeductions)}</td>
        <td><strong>₱${formatNumber(data.netPay)}</strong></td>
        <td>
            <span class="badge badge-success">Computed</span>
            ${data.isAdjusted ? '<br><span class="badge badge-warning" style="margin-top:2px;" title="Deductions manually adjusted for this period">Adjusted</span>' : ''}
            <br>
            <button class="btn btn-sm btn-outline mt-1" onclick="generatePayslip('${emp.id}', '${startDateGlobal}', '${endDateGlobal}')" style="margin-top:4px;">
                <i class="fas fa-file-alt"></i> Payslip
            </button>
            <button class="btn btn-sm btn-outline mt-1" onclick="openDeductionsModal('${emp.id}')" style="margin-top:4px;">
                <i class="fas fa-pen"></i> Deductions
            </button>
        </td>
    `;
    tbody.appendChild(tr);
}


// Global variables for payslip generation
let startDateGlobal = '';
let endDateGlobal = '';
let payoutDateGlobal = null;

// ============================================
// Payroll Deductions Modal
// ============================================

let currentOtherDeductions = [];

function openDeductionsModal(employeeId) {
    const emp = employees.find(e => e.id === employeeId);
    if (!emp) return;

    const startDate = startDateGlobal;
    const endDate = endDateGlobal;
    if (!startDate || !endDate) {
        showToast('Select a payroll month first!', 'error');
        return;
    }

    const empDTRs = dtrEntries.filter(d => d.employeeId === employeeId && d.date >= startDate && d.date <= endDate);
    const data = computeEmployeePayroll(emp, empDTRs, startDate, endDate);
    const adjustment = getPayrollAdjustment(employeeId, startDate, endDate);

    document.getElementById('deductionsEmployeeId').value = employeeId;
    document.getElementById('deductionsPeriodStart').value = startDate;
    document.getElementById('deductionsPeriodEnd').value = endDate;
    document.getElementById('deductionsEmployeeLabel').textContent =
        `${emp.firstName} ${emp.lastName} - ${formatDate(startDate)} to ${formatDate(endDate)}`;

    const enableStatutory = settings.enableStatutoryDeductions !== false;
    document.querySelectorAll('.deductions-statutory-field').forEach(el => {
        el.classList.toggle('hidden', !enableStatutory);
    });

    document.getElementById('sssOverrideInput').value =
        (adjustment.sssOverride !== null && adjustment.sssOverride !== undefined) ? adjustment.sssOverride : '';
    document.getElementById('philhealthOverrideInput').value =
        (adjustment.philhealthOverride !== null && adjustment.philhealthOverride !== undefined) ? adjustment.philhealthOverride : '';
    document.getElementById('pagibigOverrideInput').value =
        (adjustment.pagibigOverride !== null && adjustment.pagibigOverride !== undefined) ? adjustment.pagibigOverride : '';

    document.getElementById('sssAutoHint').textContent = `If left blank, uses: ₱${formatNumber(data.sssGlobalDefault)} (current global setting)`;
    document.getElementById('philhealthAutoHint').textContent = `If left blank, uses: ₱${formatNumber(data.philhealthGlobalDefault)} (current global setting)`;
    document.getElementById('pagibigAutoHint').textContent = `If left blank, uses: ₱${formatNumber(data.pagibigGlobalDefault)} (current global setting)`;

    currentOtherDeductions = (adjustment.otherDeductions || []).map(d => ({ ...d }));
    renderOtherDeductionsList();

    const globalList = settings.globalOtherDeductions || [];
    const globalNoteEl = document.getElementById('globalDeductionsNote');
    if (globalList.length > 0) {
        globalNoteEl.innerHTML = `<i class="fas fa-info-circle"></i> Standard deductions from Settings already apply to everyone: ` +
            globalList.map(d => `${d.label} (₱${formatNumber(d.amount)})`).join(', ') +
            `. Add anything below only if it's specific to this employee for this period.`;
        globalNoteEl.classList.remove('hidden');
    } else {
        globalNoteEl.classList.add('hidden');
    }

    showModal('payrollDeductionsModal');
}

function renderOtherDeductionsList() {
    const container = document.getElementById('otherDeductionsList');
    if (!container) return;

    if (currentOtherDeductions.length === 0) {
        container.innerHTML = '<p class="text-muted" style="font-size:13px;">No additional deductions for this period.</p>';
        return;
    }

    container.innerHTML = currentOtherDeductions.map((d, i) => `
        <div class="form-row" style="align-items:flex-end;">
            <div class="form-group" style="flex:2;">
                <label>Label</label>
                <input type="text" class="form-control" value="${(d.label || '').replace(/"/g, '&quot;')}" placeholder="e.g. Cash Advance" oninput="updateOtherDeduction(${i}, 'label', this.value)">
            </div>
            <div class="form-group" style="flex:1;">
                <label>Amount (₱)</label>
                <input type="number" class="form-control" value="${d.amount || 0}" min="0" step="0.01" oninput="updateOtherDeduction(${i}, 'amount', this.value)">
            </div>
            <div class="form-group" style="flex:0 0 auto;">
                <button type="button" class="btn-icon" title="Remove" onclick="removeOtherDeductionRow(${i})" style="color: var(--danger);">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function addOtherDeductionRow() {
    currentOtherDeductions.push({ label: '', amount: 0 });
    renderOtherDeductionsList();
}

function updateOtherDeduction(index, field, value) {
    if (!currentOtherDeductions[index]) return;
    currentOtherDeductions[index][field] = field === 'amount' ? (parseFloat(value) || 0) : value;
}

function removeOtherDeductionRow(index) {
    currentOtherDeductions.splice(index, 1);
    renderOtherDeductionsList();
}

function saveDeductionsAdjustment() {
    const employeeId = document.getElementById('deductionsEmployeeId').value;
    const startDate = document.getElementById('deductionsPeriodStart').value;
    const endDate = document.getElementById('deductionsPeriodEnd').value;

    const parseOverride = (val) => {
        if (val === '' || val === null || val === undefined) return null;
        const num = parseFloat(val);
        return isNaN(num) ? null : num;
    };

    const adjustment = {
        sssOverride: parseOverride(document.getElementById('sssOverrideInput').value),
        philhealthOverride: parseOverride(document.getElementById('philhealthOverrideInput').value),
        pagibigOverride: parseOverride(document.getElementById('pagibigOverrideInput').value),
        otherDeductions: currentOtherDeductions
            .map(d => ({ label: (d.label || '').trim(), amount: parseFloat(d.amount) || 0 }))
            .filter(d => d.label !== '' && d.amount !== 0)
    };

    savePayrollAdjustment(employeeId, startDate, endDate, adjustment);
    closeModal('payrollDeductionsModal');
    loadPayroll();
    showToast('Deductions updated for this pay period.', 'success');
}

async function processPayroll() {
    const monthFilter = document.getElementById('payrollMonthFilter')?.value;
    if (!monthFilter) {
        showToast('Please select a month first!', 'error');
        return;
    }

    // Pull the latest DTR entries from Supabase before computing - without
    // this, kiosk (scan.html) and camera-scan punches that landed after
    // this tab's `dtrEntries` was last populated (page load, or the last
    // realtime event) would be silently excluded from the computed payroll
    // even though they're already saved in the database.
    await loadDTR();
    loadPayroll();

    // loadPayroll() (just called above) already resolved the selected Pay
    // Period into concrete dates and set these globals - reuse them
    // rather than recomputing, so Compute Payroll always matches
    // whatever period is currently selected on screen (a specific
    // cutoff, or the whole month).
    const startDate = startDateGlobal;
    const endDate = endDateGlobal;
    const payoutDate = payoutDateGlobal;

    const activeEmployees = employees.filter(e => e.status === 'active');
    const payrollRecords = [];

    activeEmployees.forEach(emp => {
        const empDTRs = dtrEntries.filter(d =>
            d.employeeId === emp.id &&
            d.date >= startDate &&
            d.date <= endDate
        );
        // Include every employee who has at least one DTR entry in this
        // period, even if it computed to 0 paid days (e.g. marked
        // Absent) - previously `daysWorked > 0` silently dropped these
        // from the saved/processed record and the "N employees" toast,
        // even though the on-screen Payroll table already showed them.
        if (empDTRs.length === 0) return;
        const payrollData = computeEmployeePayroll(emp, empDTRs, startDate, endDate);
        payrollRecords.push({
            id: 'PR-' + Date.now() + '-' + emp.id,
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            periodStart: startDate,
            periodEnd: endDate,
            payoutDate: payoutDate,
            ...payrollData,
            generatedAt: getAppNow().toISOString()
        });
    });

    // Save to localStorage
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEYS.PAYROLL) || '[]');
    // Remove existing records for same period
    const filtered = existing.filter(p => !(p.periodStart === startDate && p.periodEnd === endDate));
    const updated = [...filtered, ...payrollRecords];
    localStorage.setItem(STORAGE_KEYS.PAYROLL, JSON.stringify(updated));

    showToast(
        payoutDate
            ? `Payroll processed for ${payrollRecords.length} employees! Payout date: ${formatDate(payoutDate)}.`
            : `Payroll processed for ${payrollRecords.length} employees!`,
        'success'
    );
}

function generatePayslip(employeeId, startDate, endDate) {
    const emp = employees.find(e => e.id === employeeId);
    if (!emp) return;

    const empDTRs = dtrEntries.filter(d =>
        d.employeeId === employeeId &&
        d.date >= startDate &&
        d.date <= endDate
    );

    const payrollData = computeEmployeePayroll(emp, empDTRs, startDate, endDate);

    // Create payslip HTML
    const monthName = new Date(startDate).toLocaleString('default', { month: 'long', year: 'numeric' });
    const payslipHTML = `
        <div class="payslip" style="padding: 20px; max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
            <!-- Header -->
            <div style="text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 20px;">
                <h2 style="margin: 0; font-size: 24px;">${company.name || 'Company Name'}</h2>
                <p style="margin: 4px 0; font-size: 13px;">${company.address || 'Company Address'}</p>
                <p style="margin: 4px 0; font-size: 12px;">TIN: ${company.tin || '000-000-000-000'}</p>
                <hr style="margin: 16px 0; border-color: #ccc;">
                <h3 style="margin: 0; font-size: 18px;">PAYSLIP</h3>
                <p style="margin: 4px 0; font-size: 13px;">Pay Period: ${formatDate(startDate)} - ${formatDate(endDate)}</p>
                ${payoutDateGlobal ? `<p style="margin: 4px 0; font-size: 13px;">Payout Date: ${formatDate(payoutDateGlobal)}</p>` : ''}
            </div>

            <!-- Employee Info -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; font-size: 13px;">
                <div><strong>Employee:</strong> ${emp.firstName} ${emp.lastName}</div>
                <div><strong>Employee ID:</strong> ${emp.id}</div>
                <div><strong>Position:</strong> ${emp.position}</div>
                <div><strong>Pay Period:</strong> ${monthName}</div>
            </div>

            <!-- Earnings -->
            <div style="margin-bottom: 20px;">
                <h4 style="border-bottom: 1px solid #333; padding-bottom: 4px; margin-bottom: 12px;">EARNINGS</h4>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <tr style="background: #f0f0f0;">
                        <th style="text-align: left; padding: 6px; border: 1px solid #ddd;">Description</th>
                        <th style="text-align: right; padding: 6px; border: 1px solid #ddd;">Hours/Days</th>
                        <th style="text-align: right; padding: 6px; border: 1px solid #ddd;">Rate</th>
                        <th style="text-align: right; padding: 6px; border: 1px solid #ddd;">Amount</th>
                    </tr>
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">Basic Pay (${payrollData.fullDaysWorked} full ${payrollData.fullDaysWorked === 1 ? 'day' : 'days'})</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">${payrollData.fullDaysWorked}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.dailyRate)}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.dailyRate * payrollData.fullDaysWorked)}</td>
                    </tr>
                    ${payrollData.halfDaysWorked > 0 ? `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">Half-Day Pay (${payrollData.halfDaysWorked} half ${payrollData.halfDaysWorked === 1 ? 'day' : 'days'})</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">${payrollData.halfDaysWorked}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.dailyRate * 0.5)}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.dailyRate * 0.5 * payrollData.halfDaysWorked)}</td>
                    </tr>
                    ` : ''}
                    ${payrollData.hourlyOverrideHours > 0 ? `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">Hourly-Rate Pay (undertime override)</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">${payrollData.hourlyOverrideHours.toFixed(2)}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.hourlyRate)}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.hourlyOverridePay)}</td>
                    </tr>
                    ` : ''}
                    ${payrollData.otHours > 0 ? `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">Overtime Pay</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">${payrollData.otHours.toFixed(2)}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.otRate || (payrollData.hourlyRate * 1.25))}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.otPay)}</td>
                    </tr>
                    ` : ''}
                    <tr style="font-weight: bold; background: #f9f9f9;">
                        <td colspan="3" style="text-align: right; padding: 8px; border: 1px solid #ddd;">GROSS PAY</td>
                        <td style="text-align: right; padding: 8px; border: 1px solid #ddd;">₱${formatNumber(payrollData.grossPay)}</td>
                    </tr>
                </table>
            </div>

            <!-- Deductions -->
            <div style="margin-bottom: 20px;">
                <h4 style="border-bottom: 1px solid #333; padding-bottom: 4px; margin-bottom: 12px;">DEDUCTIONS</h4>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <tr style="background: #f0f0f0;">
                        <th style="text-align: left; padding: 6px; border: 1px solid #ddd;">Description</th>
                        <th style="text-align: right; padding: 6px; border: 1px solid #ddd;">Amount</th>
                    </tr>
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">Late Deduction (${payrollData.lateMinutes || 0} min)</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.lateDeduction)}</td>
                    </tr>
                
                    ${settings.enableStatutoryDeductions !== false && !settings.hideStatutoryOnPayslip ? `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">SSS Contribution</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.sssDeduction)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">PhilHealth Contribution</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.philhealthDeduction)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">Pag-IBIG Contribution</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(payrollData.pagibigDeduction)}</td>
                    </tr>
                    ` : ''}
                    ${payrollData.otherDeductions.map(d => `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd;">${d.label}</td>
                        <td style="text-align: right; padding: 6px; border: 1px solid #ddd;">₱${formatNumber(parseFloat(d.amount) || 0)}</td>
                    </tr>
                    `).join('')}
                    <tr style="font-weight: bold; background: #f9f9f9;">
                        <td style="padding: 8px; border: 1px solid #ddd;">TOTAL DEDUCTIONS</td>
                        <td style="text-align: right; padding: 8px; border: 1px solid #ddd;">₱${formatNumber(payrollData.totalDeductions)}</td>
                    </tr>
                </table>
            </div>

            <!-- Net Pay -->
            <div style="border: 2px solid #333; border-radius: 8px; padding: 20px; text-align: center; background: #f8f9fa;">
                <p style="margin: 0 0 8px; font-size: 14px; color: #666;">NET PAY</p>
                <p style="margin: 0; font-size: 28px; font-weight: bold; color: #2563eb;">₱${formatNumber(payrollData.netPay)}</p>
            </div>

            ${settings.enableStatutoryDeductions !== false && !settings.hideStatutoryOnPayslip ? `
            <!-- Employer Share (for reference) -->
            <div style="margin-top: 20px; padding: 12px; background: #f0f0f0; border-radius: 4px; font-size: 11px;">
                <strong>Employer Contributions (for reference):</strong><br>
                SSS: ₱${formatNumber(payrollData.sssER)} | PhilHealth: ₱${formatNumber(payrollData.philhealthER)} | Pag-IBIG: ₱${formatNumber(payrollData.pagibigER)}
            </div>
` : ''}

            <!-- Footer -->
            <div style="margin-top: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; font-size: 12px;">
                <div>
                    <p style="margin: 0 0 40px;">___________________________</p>
                    <p style="margin: 0;">Employee Signature</p>
                </div>
                <div>
                    <p style="margin: 0 0 40px;">___________________________</p>
                    <p style="margin: 0;">Authorized Signatory</p>
                </div>
            </div>

            <div style="margin-top: 20px; text-align: center; font-size: 10px; color: #999;">
                Generated on ${getNowDisplayStr()} | This is a computer-generated payslip
            </div>
        </div>
    `;

    // Open in new window for printing
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Payslip - ${emp.firstName} ${emp.lastName}</title>
            <style>
                @media print {
                    @page { margin: 15mm; }
                    body { margin: 0; }
                }
                body { margin: 20px; }
            </style>
        </head>
        <body>${payslipHTML}</body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
}

// ============================================
// QR Scanner Functions
// ============================================

let qrScannerActive = false;
let videoStream = null;
let scanInterval = null;

function initializeQRScanner() {
    // Check for camera access
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        setupCamera();
    } else {
        document.getElementById('qrScannerArea').innerHTML = `
            <i class="fas fa-camera-slash" style="font-size: 48px; color: var(--gray-500);"></i>
            <h3>Camera Not Available</h3>
            <p>Camera access is required for QR scanning. Please enable camera permissions.</p>
        `;
    }
}

async function setupCamera() {
    // Stop any existing stream
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
    }
    if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            // 720p instead of 480p: more pixels landing on each QR module
            // makes a real difference for jsQR once codes have any real
            // density to them, and every phone/webcam capable of running
            // this dashboard supports 1280x720. Still just a hint - the
            // browser falls back gracefully on older hardware.
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        videoStream = stream;

        const video = document.createElement('video');
        video.srcObject = stream;
        video.style.cssText = 'width: 100%; max-width: 300px; border-radius: 8px;';
        video.setAttribute('playsinline', '');
        video.muted = true;

        // Build the surrounding UI first, then attach the REAL video element
        // via appendChild (not innerHTML/outerHTML). Setting innerHTML to a
        // video's outerHTML string drops the live `srcObject` stream - the
        // browser parses a brand-new, streamless <video> tag from the markup.
        // That was the bug: the visible video had no feed, while decoding
        // kept reading frames from the orphaned original element, which
        // mobile browsers throttle/freeze once it's detached from the DOM -
        // so scans were silently never detected.
        document.getElementById('qrScannerArea').innerHTML = `
            <div class="qr-placeholder">
                <div class="qr-frame" id="qrVideoFrame" style="position: relative; overflow: hidden;"></div>
            </div>
            <p>Point the camera at the employee QR code</p>
            <div class="qr-status">
                <span class="badge badge-info"><i class="fas fa-spinner fa-spin"></i> Scanning...</span>
            </div>
            <button class="btn btn-sm btn-outline mt-2" onclick="stopQRScanner()">
                <i class="fas fa-stop"></i> Stop Scanner
            </button>
        `;
        document.getElementById('qrVideoFrame').appendChild(video);
        await video.play();

        // Start QR decoding loop
        qrScannerActive = true;
        startQRDecoding(video);

    } catch (err) {
        console.error('Camera error:', err);
        document.getElementById('qrScannerArea').innerHTML = `
            <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: var(--danger);"></i>
            <h3>Camera Access Denied</h3>
            <p>Please allow camera access in your browser settings to use QR scanning.</p>
            <button class="btn btn-primary" onclick="setupCamera()">
                <i class="fas fa-camera"></i> Try Again
            </button>
        `;
    }
}

function stopQRScanner() {
    qrScannerActive = false;
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
    }

    // Reset UI
    document.getElementById('qrScannerArea').innerHTML = `
        <i class="fas fa-camera"></i>
        <h3>QR Scanner</h3>
        <p>Point your camera at the employee QR code</p>
        <div class="qr-placeholder">
            <div class="qr-frame">
                <i class="fas fa-qrcode fa-3x"></i>
            </div>
        </div>
        <div class="qr-status">
            <span class="badge badge-info">Ready to Scan</span>
        </div>
        <button class="btn btn-primary mt-2" onclick="setupCamera()">
            <i class="fas fa-camera"></i> Start Scanner
        </button>
    `;
}

async function startQRDecoding(video) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    scanInterval = setInterval(async () => {
        if (!qrScannerActive || video.paused || video.ended) return;

        try {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            // Use jsQR library for real QR decoding
            if (typeof jsQR !== 'undefined') {
                // 'dontInvert' only looks for dark modules on a light
                // background. That misses codes held up under glare, at an
                // angle to a light source, or viewed on some phone/laminated
                // surfaces where contrast can look inverted to the camera.
                // 'attemptBoth' checks both polarities each frame - slightly
                // more work per scan, but we're already well under budget at
                // 300ms/scan, and this is the single biggest lever for
                // real-world scan reliability.
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: 'attemptBoth',
                });

                if (code) {
                    // QR code detected!
                    handleQRCode(code.data);
                    return; // Stop scanning after successful read
                }
            }
        } catch (e) {
            console.error('QR decode error:', e);
        }
    }, 300); // Scan ~3 times per second
}

function handleQRCode(data) {
    // Stop scanner after successful scan
    stopQRScanner();

    // Expected format: a scan.html?emp=EMP-ID URL (current QR codes), the
    // legacy "payroll://EMP-ID" scheme (older printed sheets), or a bare ID.
    let employeeId = data;
    if (data.includes('emp=')) {
        try {
            employeeId = new URL(data).searchParams.get('emp') || data;
        } catch {
            const match = data.match(/emp=([^&]+)/);
            employeeId = match ? decodeURIComponent(match[1]) : data;
        }
    } else if (data.startsWith('payroll://')) {
        employeeId = data.replace('payroll://', '');
    }

    const employee = employees.find(e => e.id === employeeId);
    if (!employee) {
        showToast('Employee not found: ' + employeeId, 'error');
        // Restart scanner after error
        setTimeout(() => {
            qrScannerActive = true;
            setupCamera();
        }, 2000);
        return;
    }

    processQRScan(employee);
}

async function processQRScan(employee) {
    if (!requireSupabase()) return;

    const dateStr = getTodayDateStr();
    const timeStr = getNowTimeStr();

    // Check if already scanned today for this employee
    const existingDTR = dtrEntries.find(d =>
        d.employeeId === employee.id &&
        d.date === dateStr &&
        d.status !== 'absent'
    );

    let row;
    if (existingDTR) {
        // Time out
        const totalHours = calculateWorkHours(existingDTR.timeIn, timeStr);
        const otHours = calculateOTHours(existingDTR.timeIn, timeStr, dateStr);
        const lateMinutes = existingDTR.lateMinutes || calculateLateMinutes(existingDTR.timeIn);
        row = {
            employee_id: employee.id,
            date: dateStr,
            time_in: existingDTR.timeIn,
            time_out: timeStr,
            total_hours: totalHours,
            ot_hours: otHours,
            late_minutes: lateMinutes,
            status: 'present',
            source: 'camera_scan'
        };
        showToast(`${employee.firstName} ${employee.lastName} - Time Out: ${timeStr}`, 'info');
    } else {
        // Time in
        const lateMinutes = calculateLateMinutes(timeStr);
        row = {
            employee_id: employee.id,
            date: dateStr,
            time_in: timeStr,
            time_out: null,
            total_hours: 0,
            ot_hours: 0,
            late_minutes: lateMinutes,
            status: lateMinutes > 0 ? 'late' : 'present',
            source: 'camera_scan'
        };
        showToast(`${employee.firstName} ${employee.lastName} - Time In: ${timeStr}`, 'success');
    }

    const { error } = await supabaseClient
        .from('dtr_entries')
        .upsert(row, { onConflict: 'employee_id,date' });

    if (error) {
        showToast('Failed to record scan: ' + error.message, 'error');
        return;
    }

    await loadDTR();
    updateDashboard();
    updateQRScannerUI(employee);
}

function updateQRScannerUI(employee) {
    const scannerArea = document.getElementById('qrScannerArea');
    const resultDiv = document.getElementById('qrResult');

    resultDiv.classList.remove('hidden');
    scannerArea.classList.add('hidden');

    document.getElementById('qrEmployeeName').textContent = `${employee.firstName} ${employee.lastName} (${employee.id})`;
    document.getElementById('qrTimestamp').textContent = `Time: ${getNowDisplayStr()}`;
}

function scanAnother() {
    document.getElementById('qrResult').classList.add('hidden');
    document.getElementById('qrScannerArea').classList.remove('hidden');
    qrScannerActive = true;
}

// Builds an absolute https URL to the wall-mounted kiosk scan page for one
// employee - this is what actually gets encoded into their printed QR code.
// A native phone camera app can't open custom schemes like "payroll://",
// so this has to be a real, reachable URL (works out of the box once
// ze-payroll and scan.html are deployed at the same origin).
function getKioskScanUrl(employeeId) {
    const url = new URL(`scan.html?emp=${encodeURIComponent(employeeId)}`, window.location.href).toString();

    // If this app is opened as a local file (file:///Users/.../ze-payroll/app.html)
    // instead of being served from a real host, the URL above inherits that
    // long, machine-specific path. That makes every QR code encode far more
    // characters than it needs to, which forces a denser module grid and
    // noticeably smaller, harder-to-scan squares at any given print size.
    // It also won't open correctly on an employee's own phone, since their
    // phone doesn't have that file on disk. Flag it once per session.
    if (window.location.protocol === 'file:' && !window.__qrFileProtocolWarned) {
        window.__qrFileProtocolWarned = true;
        console.warn(
            'ze-payroll is running from a local file:// path. QR codes will encode this ' +
            'long local path and be harder to scan. Serve the app from a real web server ' +
            '(or a static host) so the QR payload stays short.'
        );
        if (typeof showToast === 'function') {
            showToast('Tip: host this app on a real web server for shorter, easier-to-scan QR codes.', 'warning');
        }
    }

    return url;
}

function generateAllQRCodes() {
    const qrGrid = document.getElementById('qrCodeGrid');
    qrGrid.innerHTML = '';

    employees.filter(e => e.status === 'active').forEach(emp => {
        const card = document.createElement('div');
        card.className = 'qr-card';
        card.innerHTML = `
            <div style="display: flex; justify-content: center;">
                <div id="qr-${emp.id}"></div>
            </div>
            <div class="qr-name">${emp.firstName} ${emp.lastName}</div>
            <small class="text-muted">${emp.id}</small>
            ${!emp.hasPin ? '<small style="color: var(--danger); display:block;">No PIN set - won\'t work at the kiosk yet</small>' : ''}
        `;
        card.onclick = () => viewQREmployee(emp.id);
        qrGrid.appendChild(card);

        // Generate real QR code - points to the wall-mounted scan page
        generateRealQRCode(getKioskScanUrl(emp.id), `qr-${emp.id}`);
    });
}

function printQRCodes() {
    window.print();
}

function viewQREmployee(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;

    document.getElementById('qrEmployeeDisplayName').textContent = `${emp.firstName} ${emp.lastName} - ${emp.id}`;
    const qrDisplay = document.getElementById('qrCodeDisplay');
    qrDisplay.innerHTML = '';
    generateRealQRCode(getKioskScanUrl(emp.id), 'qrCodeDisplay');
    showModal('qrModal');
}

// Rendered size of the QR itself (not counting quiet zone). 220px gives a much
// denser pixel grid than the old 150px, so modules stay crisp instead of
// getting blurry when the canvas is scaled up for printing.
const QR_RENDER_SIZE = 220;
// Minimum white quiet zone around the QR modules. Scanners (including jsQR)
// rely on a clear blank border to find the code's edges - without one, a QR
// sitting directly on a card border, a colored background, or a dark-mode
// panel becomes noticeably harder to lock onto.
const QR_QUIET_ZONE = 20;

function generateRealQRCode(data, elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;

    // Force a plain white, padded box regardless of the app's theme (the
    // dashboard supports dark mode, and a QR floating on a dark panel with no
    // margin is much more likely to fail a scan).
    element.style.cssText = `
        display: inline-block;
        background: #ffffff;
        padding: ${QR_QUIET_ZONE}px;
        border-radius: 4px;
        line-height: 0;
    `;

    // Use QRCode library if available
    if (typeof QRCode !== 'undefined') {
        new QRCode(element, {
            text: data,
            width: QR_RENDER_SIZE,
            height: QR_RENDER_SIZE,
            colorDark: '#000000',
            colorLight: '#ffffff',
            // "Q" (~25% error correction) instead of "M" (~15%) - gives the
            // camera meaningfully more room for glare, print smudging, or a
            // slightly off angle without pushing the QR to a noticeably
            // denser module grid.
            correctLevel: QRCode.CorrectLevel.Q
        });
    } else {
        // Fallback - simple visual
        element.innerHTML = `
            <div style="width:${QR_RENDER_SIZE}px;height:${QR_RENDER_SIZE}px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;border:1px solid #ddd;border-radius:8px;">
                <span style="font-size:12px;color:#666;">QR: ${data}</span>
            </div>
        `;
    }
}

// ============================================
// Dashboard Functions
// ============================================

function updateDashboard() {
    // Total employees
    const activeEmployees = employees.filter(e => e.status === 'active').length;
    document.getElementById('totalEmployees').textContent = activeEmployees;

    // Present today
    const today = getTodayDateStr();
    const todayDTR = dtrEntries.filter(d => d.date === today && (d.status === 'present' || d.status === 'late'));
    document.getElementById('presentToday').textContent = todayDTR.length;

    // Late today
    const lateToday = todayDTR.filter(d => d.status === 'late');
    document.getElementById('lateToday').textContent = lateToday.length;

    // Total payroll for the current month, month-to-date. Reuses the same
    // computeEmployeePayroll() the Payroll and Reports tabs use, so this
    // number actually matches what those pages show instead of a rough
    // "days present x base pay" guess that ignored OT, deductions, and
    // half-days.
    const [curY, curM] = getTodayYearMonthStr().split('-').map(Number);
    const monthStart = getMonthStartStr(curY, curM);
    const monthEnd = getMonthEndStr(curY, curM);
    const monthDTR = dtrEntries.filter(d => d.date >= monthStart && d.date <= monthEnd);
    const totalPayroll = employees
        .filter(e => e.status === 'active')
        .reduce((sum, emp) => {
            const empDTRs = monthDTR.filter(d => d.employeeId === emp.id);
            if (empDTRs.length === 0) return sum;
            const payrollData = computeEmployeePayroll(emp, empDTRs, monthStart, monthEnd);
            return sum + payrollData.netPay;
        }, 0);
    document.getElementById('totalPayroll').textContent = '₱' + formatNumber(totalPayroll);

    // Recent DTR entries
    renderRecentDTR();

    // Attendance chart
    renderAttendanceChart();
}

function renderRecentDTR() {
    const container = document.getElementById('recentDTR');
    container.innerHTML = '';

    const recent = dtrEntries
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);

    if (recent.length === 0) {
        container.innerHTML = '<p class="text-muted text-center" style="padding: 20px;">No DTR entries yet</p>';
        return;
    }

    recent.forEach(dtr => {
        const emp = employees.find(e => e.id === dtr.employeeId);
        if (!emp) return;

        const statusClass = dtr.status === 'present' ? 'badge-success' :
                          dtr.status === 'late' ? 'badge-warning' :
                          dtr.status === 'absent' ? 'badge-danger' : 'badge-info';

        const item = document.createElement('div');
        item.className = 'dtr-mini-item';
        item.innerHTML = `
            <span class="dtr-date">${formatDate(dtr.date)}</span>
            <span class="dtr-name">${emp.firstName} ${emp.lastName}</span>
            <span class="dtr-time">${dtr.timeIn || '-'} - ${dtr.timeOut || '-'}</span>
            <span class="dtr-status"><span class="badge ${statusClass}">${capitalize(dtr.status)}</span></span>
        `;
        container.appendChild(item);
    });
}

function renderAttendanceChart() {
    const container = document.getElementById('attendanceChart');
    container.innerHTML = '';

    // Get last 7 days
    const days = [];
    const todayStr = getTodayDateStr();
    for (let i = 6; i >= 0; i--) {
        days.push(addDaysToDateStr(todayStr, -i));
    }

    const maxCount = Math.max(...days.map(date =>
        dtrEntries.filter(d => d.date === date && d.status === 'present').length
    ), 1);

    days.forEach(date => {
        const presents = dtrEntries.filter(d => d.date === date && d.status === 'present').length;
        const lates = dtrEntries.filter(d => d.date === date && d.status === 'late').length;
        const absents = dtrEntries.filter(d => d.date === date && d.status === 'absent').length;

        const height = Math.max((presents / maxCount) * 80, 10);

        const bar = document.createElement('div');
        bar.className = 'attendance-bar present';
        bar.style.height = height + 'px';
        bar.innerHTML = `<span>${formatDateShort(date)}</span>`;
        container.appendChild(bar);
    });
}

// ============================================
// Reports Functions
// ============================================

function generateReport() {
    const monthValue = document.getElementById('reportMonth').value;
    if (!monthValue) {
        showToast('Please select a month!', 'error');
        return;
    }

    const [year, month] = monthValue.split('-').map(Number);
    const startDate = getMonthStartStr(year, month);
    const endDate = getMonthEndStr(year, month);
    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

    const container = document.getElementById('reportContent');

    let reportHTML = `
        <div class="report-header">
            <h2>Payroll Summary Report</h2>
            <p>${monthName} ${year} | Generated: ${getNowDisplayStr()}</p>
        </div>
        <div class="report-summary">
    `;

    const activeEmployees = employees.filter(e => e.status === 'active');
    let totalGrossPay = 0;
    let totalDeductions = 0;
    let totalNetPay = 0;

    activeEmployees.forEach(emp => {
        const empDTRs = dtrEntries.filter(d =>
            d.employeeId === emp.id &&
            d.date >= startDate &&
            d.date <= endDate
        );

        const payrollData = computeEmployeePayroll(emp, empDTRs, startDate, endDate);

        if (payrollData.daysWorked > 0) {
            totalGrossPay += payrollData.grossPay;
            totalDeductions += payrollData.totalDeductions;
            totalNetPay += payrollData.netPay;

            reportHTML += `
                <div class="summary-row">
                    <span>${emp.firstName} ${emp.lastName} (${emp.id})</span>
                    <span>₱${formatNumber(payrollData.netPay)}</span>
                </div>
            `;
        }
    });

    reportHTML += `
        </div>
        <div class="report-summary" style="margin-top: 16px;">
            <div class="summary-row">
                <span>Total Gross Pay</span>
                <span>₱${formatNumber(totalGrossPay)}</span>
            </div>
            <div class="summary-row">
                <span>Total Deductions</span>
                <span style="color: var(--danger);">-₱${formatNumber(totalDeductions)}</span>
            </div>
            <div class="summary-row" style="font-size: 18px; border-top: 2px solid var(--gray-300); margin-top: 8px; padding-top: 12px;">
                <span>Total Net Pay</span>
                <strong>₱${formatNumber(totalNetPay)}</strong>
            </div>
        </div>
    `;

    container.innerHTML = reportHTML;
}

// ============================================
// Navigation Functions
// ============================================

function navigateTo(page) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Update pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === `page-${page}`);
    });

    // Update title
    const titles = {
        dashboard: ['Dashboard', 'Overview of your payroll system'],
        employees: ['Employees', 'Manage your employee records'],
        dtr: ['DTR Entries', 'Daily Time Records for employees'],
        qr: ['QR Scanner', 'Scan employee QR codes for time tracking'],
        payroll: ['Payroll', 'Process and compute employee payroll'],
        settings: ['Settings', 'Configure payroll system settings'],
        reports: ['Reports', 'Generate payroll reports']
    };

    const [title, subtitle] = titles[page] || ['Dashboard', ''];
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('pageSubtitle').textContent = subtitle;

    // Load data when navigating
    if (page === 'dtr') loadDTR();
    // Payroll is computed from the in-memory `dtrEntries` array, which is
    // only otherwise refreshed by realtime sync or by visiting the DTR
    // page. Refetch here so kiosk (scan.html) and camera-scan punches
    // that arrived while this tab was open elsewhere are never missed
    // just because the admin went straight to Payroll.
    if (page === 'payroll') { populatePayrollPeriodOptions(); loadDTR().then(loadPayroll); }
    if (page === 'reports') generateReport();
}

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(item.dataset.page);
    });
});

function showAddModal() {
    const activePage = document.querySelector('.page.active');
    if (activePage) {
        const pageId = activePage.id.replace('page-', '');
        if (pageId === 'employees') {
            addEmployee();
        } else if (pageId === 'dtr') {
            showDTRAddModal();
        } else {
            addEmployee();
        }
    }
}

// ============================================
// Modal Functions
// ============================================

function showModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        closeModal(e.target.closest('.modal').id);
    });
});

// Close modal on escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal:not(.hidden)').forEach(modal => {
            modal.classList.add('hidden');
        });
    }
});

// ============================================
// Toast Functions
// ============================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        info: 'fas fa-info-circle'
    };

    toast.innerHTML = `<i class="${icons[type]}"></i> ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// Export/Import Functions
// ============================================

function exportData() {
    const data = {
        settings: settings,
        employees: employees,
        dtr: dtrEntries,
        exportedAt: getAppNow().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-export-${getTodayDateStr()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Data exported successfully!', 'success');
}

function importData(input) {
    const file = input.files[0];
    if (!file) return;
    if (!requireSupabase()) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);

            if (!confirm('This will replace all existing employees and DTR entries in Supabase. Are you sure you want to continue?')) {
                return;
            }

            if (data.settings) {
                settings = { ...defaultSettings, ...data.settings };
                localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
                // Push the imported settings to the shared row too - otherwise
                // the loadSettings() call below would immediately overwrite
                // them again with whatever was already synced from another
                // device.
                await syncFullConfigToSupabase();
            }

            if (Array.isArray(data.employees) && data.employees.length > 0) {
                const { error } = await supabaseClient
                    .from('employees')
                    .upsert(data.employees.map(mapEmployeeToDb), { onConflict: 'id' });
                if (error) showToast('Some employees failed to import: ' + error.message, 'error');
            }

            if (Array.isArray(data.dtr) && data.dtr.length > 0) {
                const dtrRows = data.dtr.map(d => ({
                    employee_id: d.employeeId,
                    date: d.date,
                    time_in: d.timeIn || null,
                    time_out: d.timeOut || null,
                    total_hours: d.totalHours || 0,
                    ot_hours: d.otHours || 0,
                    late_minutes: d.lateMinutes || 0,
                    status: d.status || 'present',
                    source: 'manual'
                }));
                const { error } = await supabaseClient
                    .from('dtr_entries')
                    .upsert(dtrRows, { onConflict: 'employee_id,date' });
                if (error) showToast('Some DTR entries failed to import: ' + error.message, 'error');
            }

            await loadSettings();
            await loadEmployees();
            await loadDTR();
            updateDashboard();

            showToast('Data imported successfully!', 'success');
        } catch (err) {
            showToast('Invalid file format!', 'error');
        }
    };
    reader.readAsText(file);
    input.value = '';
}

// ============================================
// Utility Functions
// ============================================

function formatNumber(num) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================
// Search functionality
// ============================================

document.getElementById('employeeSearch')?.addEventListener('input', renderEmployeeTable);

// ============================================
// Handle page visibility for auto calculations
// ============================================

// Recalculate when settings change
document.querySelectorAll('#settings input, #settings select').forEach(el => {
    el.addEventListener('change', () => {
        if (document.getElementById('page-settings').classList.contains('active')) {
            loadPayroll();
        }
    });
});
