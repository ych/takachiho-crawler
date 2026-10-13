// popup.js - Takachiho Helper Settings Controller v1.0.3

const STORAGE_KEY = 'takachiho_booking_profile';
const LOGS_STORAGE_KEY = 'takachiho_recent_logs';

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

// Presets for 10/26 simulation and 11/07 official
const URL_1026 = 'https://eipro.jp/takachiho1/events/view/EV00000007?closable=1&service_cd=6892dd9d-5b54-4202-bd1d-4aa6c0a8018d&service_session_cd=68a914cc-b08c-4413-94a1-9dd8c0a8018d&service_start_datetime=2026/10/26%2008:30:00&service_end_datetime=2026/10/26%2009:00:00';
const URL_1107 = 'https://eipro.jp/takachiho1/events/view/EV00000007?closable=1&service_cd=6892dd9d-5b54-4202-bd1d-4aa6c0a8018d&service_session_cd=68a916a6-59c8-459d-9643-a231c0a8018d&service_start_datetime=2026/11/07%2008:30:00&service_end_datetime=2026/11/07%2009:00:00';

// UI Elements
const els = {
  targetUrl: document.getElementById('targetUrl'),
  btnUseCurrentUrl: document.getElementById('btnUseCurrentUrl'),
  btnGoTargetUrl: document.getElementById('btnGoTargetUrl'),
  btnPreset1026: document.getElementById('btnPreset1026'),
  btnPreset1107: document.getElementById('btnPreset1107'),
  urlMismatchWarning: document.getElementById('urlMismatchWarning'),

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
  statusMsg: document.getElementById('statusMsg'),

  // Logs
  btnDownloadLogs: document.getElementById('btnDownloadLogs'),
  btnCopyLogs: document.getElementById('btnCopyLogs'),
  btnRefreshLogs: document.getElementById('btnRefreshLogs'),
  btnClearLogs: document.getElementById('btnClearLogs'),
  logContainer: document.getElementById('logContainer')
};

// ==========================================
// 1. 日誌管理 (儲存、下載 .log 檔案、複製)
// ==========================================

function getTimestamp() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;
}

async function appendLog(msg, level = 'info') {
  const time = getTimestamp();
  const entry = { time, msg, level };

  chrome.storage.local.get([LOGS_STORAGE_KEY], (res) => {
    let logs = res[LOGS_STORAGE_KEY] || [];
    logs.push(entry);
    if (logs.length > 80) logs = logs.slice(-80);
    chrome.storage.local.set({ [LOGS_STORAGE_KEY]: logs }, () => {
      renderLogs(logs);
    });
  });
}

function renderLogs(logs) {
  if (!els.logContainer) return;
  if (!logs || logs.length === 0) {
    els.logContainer.textContent = '尚無日誌記錄';
    return;
  }
  const lines = logs.map((l) => `[${l.time}][${l.level.toUpperCase()}] ${l.msg}`);
  els.logContainer.textContent = lines.join('\n');
  els.logContainer.scrollTop = els.logContainer.scrollHeight;
}

function loadLogs() {
  chrome.storage.local.get([LOGS_STORAGE_KEY], (res) => {
    renderLogs(res[LOGS_STORAGE_KEY] || []);
  });
}

// 支援一鍵下載 .log 檔案到電腦
function downloadLogFile() {
  chrome.storage.local.get([LOGS_STORAGE_KEY], (res) => {
    const logs = res[LOGS_STORAGE_KEY] || [];
    const lines = logs.map((l) => `[${l.time}][${l.level.toUpperCase()}] ${l.msg}`);
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `takachiho_helper_${dateStr}.log`;

    const content = `==========================================================\nTakachiho Gorge Boat Helper v1.0.3 - Debug Log Export\nExport Time: ${new Date().toLocaleString()}\n==========================================================\n\n` + lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatus(`📥 已成功下載 Log 檔案: ${filename}`);
  });
}

function copyLogsToClipboard() {
  chrome.storage.local.get([LOGS_STORAGE_KEY], (res) => {
    const logs = res[LOGS_STORAGE_KEY] || [];
    const lines = logs.map((l) => `[${l.time}][${l.level.toUpperCase()}] ${l.msg}`);
    const text = lines.join('\n') || '尚無日誌記錄';
    navigator.clipboard.writeText(text).then(() => {
      showStatus('📋 已成功複製日誌至剪貼簿！');
    }).catch(() => {
      showStatus('❌ 複製失敗，請手動複製', true);
    });
  });
}

function clearLogs() {
  chrome.storage.local.set({ [LOGS_STORAGE_KEY]: [] }, () => {
    renderLogs([]);
    showStatus('🗑️ 已清除所有本機日誌');
  });
}

// ==========================================
// 2. 時段防呆校驗 (Consistency Check)
// ==========================================

function checkDateConsistency() {
  const urlStr = els.targetUrl.value.trim();
  const targetDate = els.targetDate.value.trim();
  let warningMsg = '';

  if (urlStr) {
    try {
      const u = new URL(urlStr);
      const urlStartDt = u.searchParams.get('service_start_datetime');
      if (urlStartDt) {
        const decodedStart = decodeURIComponent(urlStartDt);
        const urlDate = decodedStart.split(' ')[0];
        if (urlDate && targetDate && urlDate !== targetDate) {
          warningMsg = `⚠️ 【防呆攔截】目標網址內含日期 (${urlDate}) 與所選目標日期 (${targetDate}) 不一致！開賣時會引發「予約枠が存在しません」。請點擊上方按鈕重新帶入時段！`;
        }
      }
    } catch (e) {}
  }

  if (els.urlMismatchWarning) {
    if (warningMsg) {
      els.urlMismatchWarning.textContent = warningMsg;
      els.urlMismatchWarning.style.display = 'block';
    } else {
      els.urlMismatchWarning.style.display = 'none';
    }
  }

  updatePresetButtonActiveState();
  return !warningMsg;
}

function updatePresetButtonActiveState() {
  const targetDate = els.targetDate.value.trim();
  const urlStr = els.targetUrl.value.trim();

  if (els.btnPreset1026) {
    if (targetDate === '2026/10/26' && urlStr.includes('2026/10/26')) {
      els.btnPreset1026.classList.add('active');
    } else {
      els.btnPreset1026.classList.remove('active');
    }
  }

  if (els.btnPreset1107) {
    if (targetDate === '2026/11/07' && urlStr.includes('2026/11/07')) {
      els.btnPreset1107.classList.add('active');
    } else {
      els.btnPreset1107.classList.remove('active');
    }
  }
}

// ==========================================
// 3. 計算與觸發時間
// ==========================================

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

function updateTriggerPreview() {
  const baseTime = els.launchBaseTime.value.trim() || '08:00:00';
  const bufferMs = els.earlyBufferMs.value;
  const triggerStr = calculateTriggerTime(baseTime, bufferMs);
  els.triggerPreview.textContent = `🎯 首發發動時間：${triggerStr}（提前 ${bufferMs}ms 命中開賣瞬間，未開則 250ms 安全重試）`;
}

els.launchBaseTime.addEventListener('input', updateTriggerPreview);
els.earlyBufferMs.addEventListener('change', updateTriggerPreview);

// ==========================================
// 4. 設定讀取與儲存
// ==========================================

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
    checkDateConsistency();
    loadLogs();
  });
}

function showStatus(text, isError = false) {
  els.statusMsg.textContent = text;
  els.statusMsg.className = `status-msg show ${isError ? 'error' : 'success'}`;
  setTimeout(() => {
    els.statusMsg.className = 'status-msg';
  }, 3000);
}

function saveSettings(auto = false) {
  const baseTime = els.launchBaseTime.value.trim() || '08:00:00';
  const bufferMs = els.earlyBufferMs.value;
  const computedLaunchTime = calculateTriggerTime(baseTime, bufferMs);

  const isConsistent = checkDateConsistency();

  const profile = {
    targetUrl: els.targetUrl.value.trim() || DEFAULT_SETTINGS.targetUrl,
    targetDate: els.targetDate.value.trim(),
    targetTime: els.targetTime.value,
    launchBaseTime: baseTime,
    earlyBufferMs: bufferMs,
    launchTime: computedLaunchTime,

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
    const msg = auto ? '⚡ 已自動切換時段並儲存設定！' : '✅ 搶位設定已成功儲存！';
    showStatus(isConsistent ? msg : '⚠️ 設定已儲存，但請注意目標網址與日期不一致！', !isConsistent);

    appendLog(`[設定儲存] 目標: ${profile.targetDate} ${profile.targetTime}, 網址: ${profile.targetUrl.slice(0, 45)}...`, isConsistent ? 'info' : 'warn');

    // Notify any active eipro tab to reload settings and re-resolve session CD immediately
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'SETTINGS_UPDATED', profile }, (response) => {
          if (chrome.runtime.lastError) return;
          if (response && response.resolvedSessionCd) {
            appendLog(`[分頁回應] 分頁已套用新設定，解析 Session: ${response.resolvedSessionCd.slice(0, 10)}...`, 'success');
          }
        });
      }
    });
  });
}

// ==========================================
// 5. 事件監聽 (切換按鈕、網址聯動、日誌)
// ==========================================

// 日期切換按鈕：點擊立即聯動所有欄位 + 自動儲存 (防呆免手動二次按儲存)
if (els.btnPreset1026) {
  els.btnPreset1026.addEventListener('click', () => {
    els.targetUrl.value = URL_1026;
    els.targetDate.value = '2026/10/26';
    els.targetTime.value = '08:30:00';
    appendLog('[切換按鈕] 使用者點擊 10/26 實測時段，執行防呆聯動並自動儲存', 'info');
    saveSettings(true);
  });
}

if (els.btnPreset1107) {
  els.btnPreset1107.addEventListener('click', () => {
    els.targetUrl.value = URL_1107;
    els.targetDate.value = '2026/11/07';
    els.targetTime.value = '08:30:00';
    appendLog('[切換按鈕] 使用者點擊 11/07 正式搶票，執行防呆聯動並自動儲存', 'info');
    saveSettings(true);
  });
}

// 手動變更輸入時即時防呆校驗
els.targetDate.addEventListener('input', checkDateConsistency);
els.targetUrl.addEventListener('input', checkDateConsistency);
els.targetTime.addEventListener('change', checkDateConsistency);

// Use current active tab URL
els.btnUseCurrentUrl.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url) {
      els.targetUrl.value = tabs[0].url;
      appendLog(`[抓取網址] 抓取當前分頁: ${tabs[0].url.slice(0, 50)}...`, 'info');
      checkDateConsistency();
      showStatus('📍 已抓取當前分頁網址！請記得點擊「儲存搶位設定」');
    }
  });
});

// Navigate to Target URL
els.btnGoTargetUrl.addEventListener('click', () => {
  const url = els.targetUrl.value.trim() || DEFAULT_SETTINGS.targetUrl;
  appendLog(`[開啟網址] 前往目標預約網址: ${url.slice(0, 50)}...`, 'info');
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].id) {
      chrome.tabs.update(tabs[0].id, { url: url });
    } else {
      chrome.tabs.create({ url: url });
    }
  });
});

els.btnSave.addEventListener('click', () => saveSettings(false));

// 日誌操作按鈕
if (els.btnDownloadLogs) els.btnDownloadLogs.addEventListener('click', downloadLogFile);
if (els.btnCopyLogs) els.btnCopyLogs.addEventListener('click', copyLogsToClipboard);
if (els.btnRefreshLogs) els.btnRefreshLogs.addEventListener('click', loadLogs);
if (els.btnClearLogs) els.btnClearLogs.addEventListener('click', clearLogs);

document.addEventListener('DOMContentLoaded', loadSettings);
