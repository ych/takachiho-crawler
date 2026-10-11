// popup.js - Takachiho Helper Settings Controller

const STORAGE_KEY = 'takachiho_booking_profile';

const DEFAULT_SETTINGS = {
  targetUrl: 'https://eipro.jp/takachiho1/events/view/EV00000007?closable=1&service_cd=6892dd9d-5b54-4202-bd1d-4aa6c0a8018d&service_session_cd=68a916a6-59c8-459d-9643-a231c0a8018d&service_start_datetime=2026/11/07%2008:30:00&service_end_datetime=2026/11/07%2009:00:00',
  targetDate: '2026/11/07',
  targetTime: '08:30:00',
  launchBaseTime: '08:00:00',
  earlyBufferMs: '15', // 提前 15ms (07:59:59.985 - 預計於 08:00:00.005 抵達伺服器)
  adultCount: '2',
  childCount: '0',
  autoHold: true,
  autoClickStatement: true,

  // Memo (選填備忘)
  lName: '',
  fName: '',
  tel: '',
  email: '',
  cardNumber: ''
};

// UI Elements
const els = {
  targetUrl: document.getElementById('targetUrl'),
  btnUseCurrentUrl: document.getElementById('btnUseCurrentUrl'),
  btnGoTargetUrl: document.getElementById('btnGoTargetUrl'),
  btnPreset1026: document.getElementById('btnPreset1026'),
  btnPreset1107: document.getElementById('btnPreset1107'),

  targetDate: document.getElementById('targetDate'),
  targetTime: document.getElementById('targetTime'),
  adultCount: document.getElementById('adultCount'),
  childCount: document.getElementById('childCount'),

  launchBaseTime: document.getElementById('launchBaseTime'),
  earlyBufferMs: document.getElementById('earlyBufferMs'),
  triggerPreview: document.getElementById('triggerPreview'),

  autoHold: document.getElementById('autoHold'),
  autoClickStatement: document.getElementById('autoClickStatement'),

  lName: document.getElementById('lName'),
  fName: document.getElementById('fName'),
  tel: document.getElementById('tel'),
  email: document.getElementById('email'),
  cardNumber: document.getElementById('cardNumber'),

  btnSave: document.getElementById('btnSave'),
  statusMsg: document.getElementById('statusMsg')
};

// Calculate effective trigger time string (e.g. 08:00:00 - 20ms = 07:59:59.980)
function calculateTriggerTime(baseTimeStr, bufferMs) {
  try {
    const parts = baseTimeStr.split(':');
    let h = parseInt(parts[0], 10) || 8;
    let m = parseInt(parts[1], 10) || 0;
    let s = parseInt(parts[2], 10) || 0;
    let totalMs = (h * 3600 + m * 60 + s) * 1000 - parseInt(bufferMs, 10);
    if (totalMs < 0) totalMs += 24 * 3600 * 1000;

    const resH = Math.floor(totalMs / 3600000) % 24;
    const resM = Math.floor((totalMs % 3600000) / 60000);
    const resS = Math.floor((totalMs % 60000) / 1000);
    const resMs = totalMs % 1000;

    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${pad(resH)}:${pad(resM)}:${pad(resS)}.${pad(resMs, 3)}`;
  } catch (e) {
    return '07:59:59.985';
  }
}

// Update trigger preview text
function updateTriggerPreview() {
  const baseTime = els.launchBaseTime.value.trim() || '08:00:00';
  const bufferMs = els.earlyBufferMs.value;
  const triggerStr = calculateTriggerTime(baseTime, bufferMs);
  els.triggerPreview.textContent = `🎯 首發發動時間：${triggerStr}（提前 ${bufferMs}ms 命中開賣瞬間，未開則 250ms 安全重試）`;
}

els.launchBaseTime.addEventListener('input', updateTriggerPreview);
els.earlyBufferMs.addEventListener('change', updateTriggerPreview);

// Load settings from storage
function loadSettings() {
  chrome.storage.local.get([STORAGE_KEY], (res) => {
    const data = Object.assign({}, DEFAULT_SETTINGS, res[STORAGE_KEY] || {});

    els.targetUrl.value = data.targetUrl || DEFAULT_SETTINGS.targetUrl;
    els.targetDate.value = data.targetDate || DEFAULT_SETTINGS.targetDate;
    els.targetTime.value = data.targetTime || DEFAULT_SETTINGS.targetTime;
    els.adultCount.value = data.adultCount || '2';
    els.childCount.value = data.childCount || '0';

    els.launchBaseTime.value = data.launchBaseTime || DEFAULT_SETTINGS.launchBaseTime;
    els.earlyBufferMs.value = data.earlyBufferMs || DEFAULT_SETTINGS.earlyBufferMs;

    els.autoHold.checked = data.autoHold !== false;
    els.autoClickStatement.checked = data.autoClickStatement !== false;

    if (els.lName) els.lName.value = data.lName || '';
    if (els.fName) els.fName.value = data.fName || '';
    if (els.tel) els.tel.value = data.tel || '';
    if (els.email) els.email.value = data.email || '';
    if (els.cardNumber) els.cardNumber.value = data.cardNumber || '';

    updateTriggerPreview();
  });
}

// Show temporary status badge
function showStatus(text, isError = false) {
  els.statusMsg.textContent = text;
  els.statusMsg.className = `status-msg show ${isError ? 'error' : 'success'}`;
  setTimeout(() => {
    els.statusMsg.className = 'status-msg';
  }, 2500);
}

// Save settings to storage
function saveSettings() {
  const baseTime = els.launchBaseTime.value.trim() || '08:00:00';
  const bufferMs = els.earlyBufferMs.value;
  const computedLaunchTime = calculateTriggerTime(baseTime, bufferMs);

  const profile = {
    targetUrl: els.targetUrl.value.trim() || DEFAULT_SETTINGS.targetUrl,
    targetDate: els.targetDate.value.trim(),
    targetTime: els.targetTime.value,
    launchBaseTime: baseTime,
    earlyBufferMs: bufferMs,
    launchTime: computedLaunchTime, // 實際發送時間

    adultCount: els.adultCount.value,
    childCount: els.childCount.value,
    autoHold: els.autoHold.checked,
    autoClickStatement: els.autoClickStatement.checked,

    lName: els.lName ? els.lName.value.trim() : '',
    fName: els.fName ? els.fName.value.trim() : '',
    tel: els.tel ? els.tel.value.trim() : '',
    email: els.email ? els.email.value.trim() : '',
    cardNumber: els.cardNumber ? els.cardNumber.value.replace(/\s+/g, '') : ''
  };

  chrome.storage.local.set({ [STORAGE_KEY]: profile }, () => {
    showStatus('✅ 搶位設定已成功儲存！');

    // Notify any active eipro tab to reload settings immediately
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'SETTINGS_UPDATED', profile }).catch(() => {});
      }
    });
  });
}

// Use current active tab URL
els.btnUseCurrentUrl.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url) {
      els.targetUrl.value = tabs[0].url;
      showStatus('📍 已抓取當前分頁網址！記得點擊「儲存搶位設定」');
    }
  });
});

// Navigate to Target URL
els.btnGoTargetUrl.addEventListener('click', () => {
  const url = els.targetUrl.value.trim() || DEFAULT_SETTINGS.targetUrl;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].id) {
      chrome.tabs.update(tabs[0].id, { url: url });
    } else {
      chrome.tabs.create({ url: url });
    }
  });
});

// Presets for 10/26 simulation and 11/07 official
const URL_1026 = 'https://eipro.jp/takachiho1/events/view/EV00000007?closable=1&service_cd=6892dd9d-5b54-4202-bd1d-4aa6c0a8018d&service_session_cd=68a914cc-b08c-4413-94a1-9dd8c0a8018d&service_start_datetime=2026/10/26%2008:30:00&service_end_datetime=2026/10/26%2009:00:00';
const URL_1107 = 'https://eipro.jp/takachiho1/events/view/EV00000007?closable=1&service_cd=6892dd9d-5b54-4202-bd1d-4aa6c0a8018d&service_session_cd=68a916a6-59c8-459d-9643-a231c0a8018d&service_start_datetime=2026/11/07%2008:30:00&service_end_datetime=2026/11/07%2009:00:00';

if (els.btnPreset1026) {
  els.btnPreset1026.addEventListener('click', () => {
    els.targetUrl.value = URL_1026;
    els.targetDate.value = '2026/10/26';
    els.targetTime.value = '08:30:00';
    showStatus('🧪 已帶入 10/26 實測時段！請點「儲存搶位設定」');
  });
}

if (els.btnPreset1107) {
  els.btnPreset1107.addEventListener('click', () => {
    els.targetUrl.value = URL_1107;
    els.targetDate.value = '2026/11/07';
    els.targetTime.value = '08:30:00';
    showStatus('🎯 已帶入 11/07 正式時段！請點「儲存搶位設定」');
  });
}

els.btnSave.addEventListener('click', saveSettings);

document.addEventListener('DOMContentLoaded', loadSettings);
