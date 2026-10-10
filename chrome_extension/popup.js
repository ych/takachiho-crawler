// popup.js - Takachiho Helper Settings Controller

const STORAGE_KEY = 'takachiho_booking_profile';

const DEFAULT_SETTINGS = {
  targetDate: '2026/11/07',
  targetTime: '08:30:00',
  adultCount: '2',
  childCount: '0',
  launchTime: '07:59:59.500',
  autoHold: true,
  autoFill: true,
  autoSubmit: true,

  // Customer
  lName: '',
  fName: '',
  lNameKana: '',
  fNameKana: '',
  email: '',
  tel: '',
  birthday: '1990/01/01',
  zip: '882-1101',
  address: '宮崎県西臼杵郡高千穂町大字三田井御塩井',

  // Credit Card
  cardNumber: '',
  expMonth: '12',
  expYear: '28',
  cvc: '',
  cardHolder: ''
};

// UI Elements
const els = {
  targetDate: document.getElementById('targetDate'),
  targetTime: document.getElementById('targetTime'),
  adultCount: document.getElementById('adultCount'),
  childCount: document.getElementById('childCount'),
  launchTime: document.getElementById('launchTime'),
  autoHold: document.getElementById('autoHold'),
  autoFill: document.getElementById('autoFill'),
  autoSubmit: document.getElementById('autoSubmit'),

  lName: document.getElementById('lName'),
  fName: document.getElementById('fName'),
  lNameKana: document.getElementById('lNameKana'),
  fNameKana: document.getElementById('fNameKana'),
  email: document.getElementById('email'),
  tel: document.getElementById('tel'),
  birthday: document.getElementById('birthday'),
  zip: document.getElementById('zip'),
  address: document.getElementById('address'),

  cardNumber: document.getElementById('cardNumber'),
  expMonth: document.getElementById('expMonth'),
  expYear: document.getElementById('expYear'),
  cvc: document.getElementById('cvc'),
  cardHolder: document.getElementById('cardHolder'),

  btnSave: document.getElementById('btnSave'),
  btnOpenCalendar: document.getElementById('btnOpenCalendar'),
  btnTestAutofill: document.getElementById('btnTestAutofill'),
  statusMsg: document.getElementById('statusMsg')
};

// Format Card Number input (remove non-digits)
els.cardNumber.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 16);
});

// Load settings from storage
function loadSettings() {
  chrome.storage.local.get([STORAGE_KEY], (res) => {
    const data = Object.assign({}, DEFAULT_SETTINGS, res[STORAGE_KEY] || {});

    els.targetDate.value = data.targetDate;
    els.targetTime.value = data.targetTime;
    els.adultCount.value = data.adultCount;
    els.childCount.value = data.childCount;
    els.launchTime.value = data.launchTime;
    els.autoHold.checked = Boolean(data.autoHold);
    els.autoFill.checked = Boolean(data.autoFill);
    els.autoSubmit.checked = Boolean(data.autoSubmit);

    els.lName.value = data.lName || '';
    els.fName.value = data.fName || '';
    els.lNameKana.value = data.lNameKana || '';
    els.fNameKana.value = data.fNameKana || '';
    els.email.value = data.email || '';
    els.tel.value = data.tel || '';
    els.birthday.value = data.birthday || '';
    els.zip.value = data.zip || '882-1101';
    els.address.value = data.address || '';

    els.cardNumber.value = data.cardNumber || '';
    els.expMonth.value = data.expMonth || '12';
    els.expYear.value = data.expYear || '28';
    els.cvc.value = data.cvc || '';
    els.cardHolder.value = data.cardHolder || '';
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
  const profile = {
    targetDate: els.targetDate.value.trim(),
    targetTime: els.targetTime.value,
    adultCount: els.adultCount.value,
    childCount: els.childCount.value,
    launchTime: els.launchTime.value.trim(),
    autoHold: els.autoHold.checked,
    autoFill: els.autoFill.checked,
    autoSubmit: els.autoSubmit.checked,

    lName: els.lName.value.trim(),
    fName: els.fName.value.trim(),
    lNameKana: els.lNameKana.value.trim(),
    fNameKana: els.fNameKana.value.trim(),
    email: els.email.value.trim(),
    tel: els.tel.value.trim(),
    birthday: els.birthday.value.trim(),
    zip: els.zip.value.trim(),
    address: els.address.value.trim(),

    cardNumber: els.cardNumber.value.replace(/\s+/g, ''),
    expMonth: els.expMonth.value,
    expYear: els.expYear.value,
    cvc: els.cvc.value.trim(),
    cardHolder: els.cardHolder.value.trim().toUpperCase()
  };

  chrome.storage.local.set({ [STORAGE_KEY]: profile }, () => {
    showStatus('✅ 預約設定已成功儲存！');

    // Notify any active eipro tab to reload settings immediately
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'SETTINGS_UPDATED', profile }).catch(() => {});
      }
    });
  });
}

// Open eipro reservation calendar
els.btnOpenCalendar.addEventListener('click', () => {
  const targetUrl = 'https://eipro.jp/takachiho1/eventCalendars/index';
  chrome.tabs.query({ url: '*://eipro.jp/takachiho1/*' }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true, url: targetUrl });
    } else {
      chrome.tabs.create({ url: targetUrl });
    }
  });
});

// Trigger test autofill on current tab
els.btnTestAutofill.addEventListener('click', () => {
  saveSettings();
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0] || !tabs[0].id) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'TRIGGER_AUTOFILL' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        showStatus('⚠️ 請先開啟 eipro.jp 預約頁面再測試', true);
      } else if (response.success) {
        showStatus('🎉 已成功自動填入當前頁面表單！');
      } else {
        showStatus(`⚠️ 填表提示: ${response.message || '未找到對應欄位'}`, true);
      }
    });
  });
});

els.btnSave.addEventListener('click', saveSettings);

document.addEventListener('DOMContentLoaded', loadSettings);
