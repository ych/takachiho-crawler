// content.js - Takachiho Gorge Boat Reservation Assistant (高千穂峡ボート 預約助手)
(function () {
  'use strict';

  const STORAGE_KEY = 'takachiho_booking_profile';
  const SERVICE_CD = '6892dd9d-5b54-4202-bd1d-4aa6c0a8018d';

  let config = null;
  let resolvedSessionCd = '';
  let isHolding = false;
  let retryCount = 0;
  const MAX_RETRIES = 50;
  let countdownTimer = null;
  let audioCtx = null;
  let alarmInterval = null;

  // Initialize Web Audio API
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Play Triumphant Success Chime
  function playSuccessChime() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.12);
        gain.gain.setValueAtTime(0.25, ctx.currentTime + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.12 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.12);
        osc.stop(ctx.currentTime + idx * 0.12 + 0.36);
      });
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  // Play Loud Alarm for 3D Secure OTP Verification
  function playOtpAlertSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const beeps = [880, 880, 1174.66]; // A5, A5, D6
      beeps.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.15);
        gain.gain.setValueAtTime(0.3, ctx.currentTime + idx * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.15 + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.15);
        osc.stop(ctx.currentTime + idx * 0.15 + 0.13);
      });
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  // Calculate End Datetime (add 30 minutes)
  function getEndDatetime(startDatetimeStr) {
    // e.g. 2026/11/07 08:30:00 -> 2026/11/07 09:00:00
    try {
      const parts = startDatetimeStr.split(' ');
      const dateParts = parts[0].split('/');
      const timeParts = parts[1].split(':');
      const d = new Date(
        parseInt(dateParts[0], 10),
        parseInt(dateParts[1], 10) - 1,
        parseInt(dateParts[2], 10),
        parseInt(timeParts[0], 10),
        parseInt(timeParts[1], 10),
        parseInt(timeParts[2], 10)
      );
      d.setMinutes(d.getMinutes() + 30);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch (e) {
      return startDatetimeStr;
    }
  }

  // Load Config from Chrome Storage
  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        config = res[STORAGE_KEY] || {
          targetDate: '2026/11/07',
          targetTime: '08:30:00',
          adultCount: '2',
          childCount: '0',
          launchTime: '07:59:59.500',
          autoHold: true,
          autoFill: true,
          autoSubmit: true
        };
        resolve(config);
      });
    });
  }

  // Build Floating HUD Widget
  function createHUD() {
    if (document.getElementById('takachiho-hud-root')) return;

    const hud = document.createElement('div');
    hud.id = 'takachiho-hud-root';
    hud.innerHTML = `
      <style>
        #takachiho-hud-root {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 9999999;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          color: #0f172a;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        }
        .th-panel {
          width: 320px;
          background: rgba(255, 255, 255, 0.98);
          backdrop-filter: blur(8px);
          border: 1px solid #0284c7;
          border-radius: 10px;
          overflow: hidden;
          transition: all 0.2s ease;
        }
        .th-panel.minimized .th-body {
          display: none;
        }
        .th-header {
          background: linear-gradient(135deg, #0284c7, #0369a1);
          color: #fff;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-weight: 700;
          cursor: pointer;
        }
        .th-header-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
        }
        .th-toggle-btn {
          background: transparent;
          border: none;
          color: #fff;
          font-size: 14px;
          cursor: pointer;
          padding: 0 4px;
        }
        .th-body {
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .th-info-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          padding-bottom: 4px;
          border-bottom: 1px dashed #e2e8f0;
        }
        .th-info-label {
          color: #64748b;
          font-weight: 600;
        }
        .th-info-val {
          font-weight: 700;
          color: #0369a1;
        }
        .th-status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          background: #f0fdf4;
          color: #166534;
          border: 1px solid #bbf7d0;
        }
        .th-status-badge.waiting {
          background: #fefce8;
          color: #854d0e;
          border-color: #fef08a;
        }
        .th-status-badge.working {
          background: #e0f2fe;
          color: #0369a1;
          border-color: #bae6fd;
        }
        .th-status-badge.alert {
          background: #fee2e2;
          color: #991b1b;
          border-color: #fecaca;
          animation: th-pulse 1s infinite alternate;
        }
        @keyframes th-pulse {
          from { opacity: 0.8; }
          to { opacity: 1; transform: scale(1.02); }
        }
        .th-clock {
          text-align: center;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          background: #f8fafc;
          padding: 4px;
          border-radius: 4px;
          border: 1px solid #e2e8f0;
        }
        .th-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
          margin-top: 2px;
        }
        .th-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          height: 32px;
          border: none;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
        }
        .th-btn-primary {
          background: #0284c7;
          color: #fff;
          grid-column: span 2;
        }
        .th-btn-primary:hover {
          background: #0369a1;
        }
        .th-btn-secondary {
          background: #f1f5f9;
          color: #334155;
          border: 1px solid #cbd5e1;
        }
        .th-btn-secondary:hover {
          background: #e2e8f0;
        }
        .th-btn-fastcopy {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          color: #475569;
          font-size: 10px;
          padding: 3px 6px;
          border-radius: 4px;
          cursor: pointer;
          margin-top: 2px;
        }
        .th-btn-fastcopy:hover {
          background: #e2e8f0;
        }
        .th-copy-bar {
          display: flex;
          gap: 4px;
          justify-content: space-between;
        }
      </style>
      <div class="th-panel" id="thPanel">
        <div class="th-header" id="thHeader">
          <div class="th-header-title">
            <span>🛶 高千穂峡ボート助手</span>
          </div>
          <button type="button" class="th-toggle-btn" id="thToggleBtn">−</button>
        </div>
        <div class="th-body">
          <div class="th-info-row">
            <span class="th-info-label">目標時段</span>
            <span class="th-info-val" id="hudTargetText">讀取中...</span>
          </div>
          <div class="th-info-row">
            <span class="th-info-label">人數設定</span>
            <span class="th-info-val" id="hudPassengerText">-</span>
          </div>
          <div class="th-info-row">
            <span class="th-info-label">時段代碼 (Session CD)</span>
            <span class="th-info-val" id="hudSessionCd" style="font-size: 10px; font-family: monospace;">-</span>
          </div>

          <div class="th-clock" id="hudClock">00:00:00.000</div>

          <div class="th-status-badge waiting" id="hudStatusBadge">
            <span id="hudStatusIcon">🟢</span>
            <span id="hudStatusText">待命中</span>
          </div>

          <div class="th-actions">
            <button type="button" class="th-btn th-btn-primary" id="btnManualHold">⚡ 一鍵立即搶位 (Hold Slot)</button>
            <button type="button" class="th-btn th-btn-secondary" id="btnManualFill">✍️ 一鍵填表</button>
            <button type="button" class="th-btn th-btn-secondary" id="btnTestChime">🔊 測試音效</button>
          </div>

          <div class="th-copy-bar">
            <button type="button" class="th-btn-fastcopy" id="btnCopyCard">📋 複製卡號</button>
            <button type="button" class="th-btn-fastcopy" id="btnCopyExp">📋 複製到期日</button>
            <button type="button" class="th-btn-fastcopy" id="btnCopyCvc">📋 複製 CVC</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(hud);

    // Event handlers for HUD
    const thPanel = document.getElementById('thPanel');
    const thHeader = document.getElementById('thHeader');
    const thToggleBtn = document.getElementById('thToggleBtn');

    thHeader.addEventListener('click', (e) => {
      if (e.target.tagName.toLowerCase() !== 'button') {
        thPanel.classList.toggle('minimized');
        thToggleBtn.textContent = thPanel.classList.contains('minimized') ? '+' : '−';
      }
    });

    thToggleBtn.addEventListener('click', () => {
      thPanel.classList.toggle('minimized');
      thToggleBtn.textContent = thPanel.classList.contains('minimized') ? '+' : '−';
    });

    document.getElementById('btnManualHold').addEventListener('click', () => {
      triggerHoldSlot(true);
    });

    document.getElementById('btnManualFill').addEventListener('click', () => {
      fillReservationForm();
    });

    document.getElementById('btnTestChime').addEventListener('click', () => {
      playSuccessChime();
    });

    // Fast copy buttons for PayJP iframe bypass
    document.getElementById('btnCopyCard').addEventListener('click', () => {
      if (config && config.cardNumber) {
        navigator.clipboard.writeText(config.cardNumber);
        updateStatus('working', '📋 卡號已複製至剪貼簿！');
      }
    });

    document.getElementById('btnCopyExp').addEventListener('click', () => {
      if (config && config.expMonth && config.expYear) {
        navigator.clipboard.writeText(`${config.expMonth}/${config.expYear}`);
        updateStatus('working', '📋 到期日已複製 (MM/YY)！');
      }
    });

    document.getElementById('btnCopyCvc').addEventListener('click', () => {
      if (config && config.cvc) {
        navigator.clipboard.writeText(config.cvc);
        updateStatus('working', '📋 CVC 安全碼已複製！');
      }
    });

    updateHUDDisplay();
  }

  // Update HUD Display with Current Config
  function updateHUDDisplay() {
    if (!config) return;
    const targetTextEl = document.getElementById('hudTargetText');
    const passTextEl = document.getElementById('hudPassengerText');
    const sessionCdEl = document.getElementById('hudSessionCd');

    if (targetTextEl) {
      targetTextEl.textContent = `${config.targetDate} ${config.targetTime.slice(0, 5)}`;
    }
    if (passTextEl) {
      passTextEl.textContent = `${config.adultCount} 大人, ${config.childCount} 幼兒`;
    }
    if (sessionCdEl) {
      sessionCdEl.textContent = resolvedSessionCd ? `${resolvedSessionCd.slice(0, 13)}...` : '尋找中...';
      sessionCdEl.title = resolvedSessionCd;
    }
  }

  // Update Status Badge
  function updateStatus(type, message) {
    const badge = document.getElementById('hudStatusBadge');
    const text = document.getElementById('hudStatusText');
    const icon = document.getElementById('hudStatusIcon');
    if (!badge || !text || !icon) return;

    badge.className = `th-status-badge ${type}`;
    text.textContent = message;

    if (type === 'waiting') icon.textContent = '⏳';
    else if (type === 'working') icon.textContent = '🚀';
    else if (type === 'alert') icon.textContent = '🚨';
    else icon.textContent = '🎉';
  }

  // Realtime Clock & Countdown Updater
  function startClock() {
    if (countdownTimer) clearInterval(countdownTimer);

    countdownTimer = setInterval(() => {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${ms}`;

      const clockEl = document.getElementById('hudClock');
      if (clockEl) {
        clockEl.textContent = timeStr;
      }

      // Check Launch Trigger (Taiwan time / Local time: e.g. 07:59:59.500)
      if (config && config.autoHold && !isHolding && !window.location.pathname.includes('/orders/add')) {
        const targetLaunchStr = config.launchTime || '07:59:59.500';
        if (timeStr >= targetLaunchStr && timeStr <= '08:00:15.000') {
          console.log('[TakachihoHelper] 達到預約開賣啟動時間！立即執行自動搶位 (hold_slot)...');
          triggerHoldSlot(false);
        }
      }
    }, 20);
  }

  // Resolve Session CD for Target Date & Time
  async function resolveSessionCd() {
    if (!config) return;

    // 1. Try scanning DOM calendar items
    const startTarget = `${config.targetDate} ${config.targetTime}`;
    const domInputs = document.querySelectorAll('.service_unit_service_start_datetime');
    for (const inp of domInputs) {
      if (inp.value && inp.value.trim() === startTarget) {
        const container = inp.closest('.service_unit_calendar_view');
        if (container) {
          const sInp = container.querySelector('.service_unit_service_session_cd');
          if (sInp && sInp.value) {
            resolvedSessionCd = sInp.value;
            console.log('[TakachihoHelper] 從 DOM 找到時段 Session CD:', resolvedSessionCd);
            updateHUDDisplay();
            return resolvedSessionCd;
          }
        }
      }
    }

    // 2. Query eventCalendars/search API directly with browser cookies
    try {
      // Calculate target date and next day
      const parts = config.targetDate.split('/');
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      const nextD = new Date(d);
      nextD.setDate(d.getDate() + 1);
      const pad = (n) => String(n).padStart(2, '0');
      const nextDateStr = `${nextD.getFullYear()}/${pad(nextD.getMonth() + 1)}/${pad(nextD.getDate())}`;

      const formData = new URLSearchParams();
      formData.append('data[conds][ServiceView][max_session_dateOver]', config.targetDate);
      formData.append('data[conds][ServiceView][min_session_dateUnder]', nextDateStr);
      formData.append('calendar_view_name', 'agendaWeek');
      formData.append('calendar_type', 'week');

      const tokenEl = document.querySelector('input[name="action_token"]');
      if (tokenEl && tokenEl.value) {
        formData.append('action_token', tokenEl.value);
      }

      const resp = await fetch('/takachiho1/eventCalendars/search', {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: formData
      });

      if (resp.ok) {
        const data = await resp.json();
        const results = data.results || [];
        for (const item of results) {
          if (item.service_start_datetime && item.service_start_datetime.trim() === startTarget) {
            resolvedSessionCd = item.service_session_cd || item.session_cd;
            console.log('[TakachihoHelper] 從 Search API 成功解析 Session CD:', resolvedSessionCd);
            updateHUDDisplay();
            return resolvedSessionCd;
          }
        }
        // If exact target time not matched, fallback to first available session_cd
        if (results.length > 0 && !resolvedSessionCd) {
          resolvedSessionCd = results[0].service_session_cd || results[0].session_cd;
          console.log('[TakachihoHelper] 採用日曆相近時段 Session CD:', resolvedSessionCd);
          updateHUDDisplay();
        }
      }
    } catch (e) {
      console.warn('[TakachihoHelper] 解析 Session CD 失敗:', e);
    }

    return resolvedSessionCd;
  }

  // Execute hold_slot
  async function triggerHoldSlot(isManual = false) {
    if (isHolding) return;
    isHolding = true;

    if (!resolvedSessionCd) {
      updateStatus('working', '🔍 正在解析時段代碼...');
      await resolveSessionCd();
    }

    const sessionCd = resolvedSessionCd || '68a914a3-4d0c-4b20-88e0-9dd8c0a8018d';
    const startDt = `${config.targetDate} ${config.targetTime}`;
    const endDt = getEndDatetime(startDt);

    updateStatus('working', `🚀 正在鎖定席位 (第 ${retryCount + 1} 次)...`);

    try {
      const formData = new URLSearchParams();
      formData.append('data[service_cd]', SERVICE_CD);
      formData.append('data[service_session_cd]', sessionCd);
      formData.append('data[service_start_datetime]', startDt);
      formData.append('data[service_end_datetime]', endDt);

      const resp = await fetch('/takachiho1/apiServices/api/hold_slot', {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: formData
      });

      const json = await resp.json();
      console.log('[TakachihoHelper] hold_slot 回應:', json);

      if (json && json.data && String(json.data.result) === '1') {
        // SUCCESS!
        playSuccessChime();
        updateStatus('success', '🎉 席位鎖定成功！保留 15 分鐘！');
        showModalSuccessNotification();

        // Redirect directly to orders/add with held session cookies
        setTimeout(() => {
          const orderUrl = `/takachiho1/orders/add?service_cd=${encodeURIComponent(SERVICE_CD)}&service_session_cd=${encodeURIComponent(sessionCd)}&service_start_datetime=${encodeURIComponent(startDt)}&service_end_datetime=${encodeURIComponent(endDt)}`;
          window.location.href = orderUrl;
        }, 800);
        return;
      }

      // If result == 0 (not open yet or full)
      const msg = (json && json.message && json.message[0]) || '尚未開放或席位已滿';
      retryCount++;

      if (retryCount < MAX_RETRIES && (!isManual || retryCount < 5)) {
        updateStatus('working', `⏳ ${msg} (重試中 ${retryCount}/${MAX_RETRIES})...`);
        setTimeout(() => {
          isHolding = false;
          triggerHoldSlot(isManual);
        }, 250);
      } else {
        updateStatus('waiting', `⚠️ ${msg} (已停止重試)`);
        isHolding = false;
        retryCount = 0;
      }
    } catch (e) {
      console.error('[TakachihoHelper] hold_slot 請求異常:', e);
      updateStatus('waiting', `連線異常: ${e.message}`);
      isHolding = false;
    }
  }

  // Giant Celebration Modal on Slot Hold Success
  function showModalSuccessNotification() {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      z-index: 10000000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: sans-serif;
    `;
    modal.innerHTML = `
      <div style="background: #fff; padding: 30px; border-radius: 12px; text-align: center; max-width: 450px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
        <h2 style="font-size: 26px; color: #16a34a; margin-bottom: 12px;">🎉 席位鎖定成功！</h2>
        <p style="font-size: 16px; color: #334155; margin-bottom: 16px;">
          已為您成功暫時保留 <strong>15 分鐘</strong>！<br>正在立即進入預約填表頁面 (orders/add)...
        </p>
        <div style="font-size: 13px; color: #64748b;">
          系統將自動填入代表者與信用卡付款資訊，請準備隨後輸入銀行 3D 簡訊驗證碼！
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // Helper: Trigger input events on form controls
  function setVal(elem, value) {
    if (!elem) return;
    elem.value = value;
    elem.dispatchEvent(new Event('input', { bubbles: true }));
    elem.dispatchEvent(new Event('change', { bubbles: true }));
    elem.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Helper: Select option by value or text
  function setSelect(elem, value) {
    if (!elem) return;
    let found = false;
    for (let i = 0; i < elem.options.length; i++) {
      if (elem.options[i].value === String(value) || elem.options[i].text.includes(String(value))) {
        elem.selectedIndex = i;
        found = true;
        break;
      }
    }
    if (!found) elem.value = value;
    elem.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Autofill Reservation Form on /orders/add
  function fillReservationForm() {
    if (!config) return { success: false, message: '尚未載入設定' };

    console.log('[TakachihoHelper] 開始執行預約表單自動填寫...');
    updateStatus('working', '✍️ 正在自動填入表單與信用卡...');

    // 1. If guest order dialog is visible, click "会員登録せずに予約"
    const guestBtn = document.querySelector('.no_auth_order_btn_cls');
    if (guestBtn && guestBtn.offsetParent !== null) {
      console.log('[TakachihoHelper] 點擊非會員預約按鈕 (会員登録せずに予約)...');
      guestBtn.click();
    }

    let filledCount = 0;

    // 2. Customer fields
    // Last Name (漢字 / 護照英文)
    const lNameInp = document.querySelector('input[name="data[Customer][l_name]"], input[data-field_name="Customer.l_name"]');
    if (lNameInp && config.lName) { setVal(lNameInp, config.lName); filledCount++; }

    // First Name (漢字 / 護照英文)
    const fNameInp = document.querySelector('input[name="data[Customer][f_name]"], input[data-field_name="Customer.f_name"]');
    if (fNameInp && config.fName) { setVal(fNameInp, config.fName); filledCount++; }

    // Last Name Kana (片假名)
    const lKanaInp = document.querySelector('input[name="data[Customer][l_name_kana]"], input[data-field_name="Customer.l_name_kana"]');
    if (lKanaInp && config.lNameKana) { setVal(lKanaInp, config.lNameKana); filledCount++; }

    // First Name Kana (片假名)
    const fKanaInp = document.querySelector('input[name="data[Customer][f_name_kana]"], input[data-field_name="Customer.f_name_kana"]');
    if (fKanaInp && config.fNameKana) { setVal(fKanaInp, config.fNameKana); filledCount++; }

    // Mail & Mail Confirm
    const mailInp = document.querySelector('input[name="data[Customer][mail]"], input[data-field_name="Customer.mail"]');
    if (mailInp && config.email) { setVal(mailInp, config.email); filledCount++; }

    const mailConfirmInp = document.querySelector('input[name="data[Customer][mail_confirm]"], input[data-field_name="Customer.mail_confirm"]');
    if (mailConfirmInp && config.email) { setVal(mailConfirmInp, config.email); filledCount++; }

    // Phone / Tel
    const telInp = document.querySelector('input[name="data[Customer][tel]"], input[data-field_name="Customer.tel"]');
    if (telInp && config.tel) { setVal(telInp, config.tel); filledCount++; }

    // Postal Code / Zip
    const zipInp = document.querySelector('input[name="data[Customer][zip]"], input[data-field_name="Customer.zip"]');
    if (zipInp && config.zip) { setVal(zipInp, config.zip); filledCount++; }

    // Address
    const addrInp = document.querySelector('input[name="data[Customer][address]"], input[data-field_name="Customer.address"]');
    if (addrInp && config.address) { setVal(addrInp, config.address); filledCount++; }

    // Birthday
    const bdayInp = document.querySelector('input[name="data[Customer][birthday]"], input[data-field_name="Customer.birthday"]');
    if (bdayInp && config.birthday) { setVal(bdayInp, config.birthday); filledCount++; }

    // If birthday has separate year/month/day selects
    if (config.birthday && config.birthday.includes('/')) {
      const bParts = config.birthday.split('/');
      const bYear = document.querySelector('select[name*="birthday"][name*="year"]');
      const bMonth = document.querySelector('select[name*="birthday"][name*="month"]');
      const bDay = document.querySelector('select[name*="birthday"][name*="day"]');
      if (bYear) setSelect(bYear, bParts[0]);
      if (bMonth) setSelect(bMonth, bParts[1]);
      if (bDay) setSelect(bDay, bParts[2]);
    }

    // 3. Passenger Counts
    const adultSel = document.querySelector('select[name="data[OrderDetail][adult_count]"], select[data-field_name="OrderDetail.adult_count"], select[name*="adult"]');
    if (adultSel && config.adultCount) { setSelect(adultSel, config.adultCount); filledCount++; }

    const childSel = document.querySelector('select[name="data[OrderDetail][child_count]"], select[data-field_name="OrderDetail.child_count"], select[name*="child"]');
    if (childSel && config.childCount !== undefined) { setSelect(childSel, config.childCount); filledCount++; }

    // 4. Terms and Agreement Checkboxes
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb) => {
      const name = (cb.name || cb.id || cb.className || '').toLowerCase();
      const parentText = (cb.closest('label, div') ? cb.closest('label, div').innerText : '').toLowerCase();
      if (name.includes('agree') || name.includes('kiyaku') || name.includes('term') ||
          parentText.includes('同意') || parentText.includes('規約') || parentText.includes('承諾')) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        filledCount++;
      }
    });

    // 5. Credit Card Fields (PayJP / Card Inputs)
    const cardNumInp = document.querySelector('#payjp_number, input[name*="card_number"], input[name*="card_no"], input[data-field_name*="card_number"]');
    if (cardNumInp && config.cardNumber) { setVal(cardNumInp, config.cardNumber); filledCount++; }

    const expMonthInp = document.querySelector('#payjp_exp_month, select[name*="exp_month"], input[name*="exp_month"]');
    if (expMonthInp && config.expMonth) {
      if (expMonthInp.tagName.toLowerCase() === 'select') setSelect(expMonthInp, config.expMonth);
      else setVal(expMonthInp, config.expMonth);
      filledCount++;
    }

    const expYearInp = document.querySelector('#payjp_exp_year, select[name*="exp_year"], input[name*="exp_year"]');
    if (expYearInp && config.expYear) {
      if (expYearInp.tagName.toLowerCase() === 'select') setSelect(expYearInp, config.expYear);
      else setVal(expYearInp, config.expYear);
      filledCount++;
    }

    const cvcInp = document.querySelector('#payjp_cvc, input[name*="cvc"], input[name*="security_code"]');
    if (cvcInp && config.cvc) { setVal(cvcInp, config.cvc); filledCount++; }

    const holderInp = document.querySelector('#payjp_name, input[name*="holder"], input[name*="card_name"]');
    if (holderInp && config.cardHolder) { setVal(holderInp, config.cardHolder); filledCount++; }

    console.log(`[TakachihoHelper] 表單填寫完畢，共填入/勾選 ${filledCount} 個欄位！`);
    updateStatus('success', `🎉 已填入 ${filledCount} 個欄位！`);

    // 6. Auto-Submit if enabled
    if (config.autoSubmit) {
      handleAutoSubmit();
    }

    return { success: filledCount > 0, message: `已成功填入 ${filledCount} 個欄位` };
  }

  // Handle Automatic Form Submission
  function handleAutoSubmit() {
    // Look for submit or next step buttons
    const submitBtn = document.querySelector(
      '#mainForm button[type="submit"], input[type="submit"], .front_btn.color_config, button.order_confirm_btn'
    );

    if (!submitBtn) {
      console.log('[TakachihoHelper] 未找到明確的送出按鈕，保留畫面讓使用者手動點擊');
      return;
    }

    // Countdown 1.2s before clicking so user can cancel if desired
    let countdownSec = 1;
    updateStatus('working', `🚀 即將自動前往確認頁面 (${countdownSec}s)...`);

    setTimeout(() => {
      console.log('[TakachihoHelper] 自動點擊送出確認按鈕:', submitBtn);
      submitBtn.click();
    }, 1200);
  }

  // 3D Secure / OTP Verification Detector
  function checkOtpVerificationPage() {
    const url = window.location.href.toLowerCase();
    const title = document.title.toLowerCase();
    const bodyText = document.body ? document.body.innerText : '';

    const isOtp =
      url.includes('3dsecure') ||
      url.includes('3d_secure') ||
      url.includes('acs') ||
      url.includes('otp') ||
      url.includes('card_auth') ||
      url.includes('payjp.com/v2/secure') ||
      bodyText.includes('本人認証') ||
      bodyText.includes('ワンタイムパスワード') ||
      bodyText.includes('SMS認証') ||
      bodyText.includes('認証コード') ||
      bodyText.includes('One-Time Password');

    if (isOtp) {
      console.log('[TakachihoHelper] 🚨 偵測到 3D 驗證頁面已啟動！');
      updateStatus('alert', '🚨 請輸入銀行簡訊驗證碼 (OTP)！');

      // Trigger continuous audio alert
      playOtpAlertSound();
      if (!alarmInterval) {
        alarmInterval = setInterval(playOtpAlertSound, 3500);
      }

      // Add high-visibility top notification bar if not present
      if (!document.getElementById('takachiho-otp-banner')) {
        const banner = document.createElement('div');
        banner.id = 'takachiho-otp-banner';
        banner.style.cssText = `
          position: fixed; top: 0; left: 0; right: 0;
          background: #dc2626; color: #fff;
          padding: 14px 20px; font-size: 16px; font-weight: 800;
          text-align: center; z-index: 10000001;
          box-shadow: 0 4px 15px rgba(220, 38, 38, 0.4);
          animation: th-pulse 0.8s infinite alternate;
        `;
        banner.innerHTML = `🔔 請立即在畫面上輸入銀行簡訊驗證碼 (OTP) 完成預約！`;
        document.body.prepend(banner);
      }
    } else {
      if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
      }
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'SETTINGS_UPDATED') {
      config = request.profile;
      updateHUDDisplay();
      sendResponse({ success: true });
    } else if (request.action === 'TRIGGER_AUTOFILL') {
      const res = fillReservationForm();
      sendResponse(res);
    }
    return true;
  });

  // Main Entry Point
  async function init() {
    await loadConfig();
    createHUD();
    startClock();

    // Check if on calendar page
    if (window.location.pathname.includes('/eventCalendars')) {
      resolveSessionCd();
    }

    // Check if on orders/add page
    if (window.location.pathname.includes('/orders/add')) {
      updateStatus('working', '📋 進入預約表單頁面...');
      if (config.autoFill) {
        setTimeout(fillReservationForm, 500);
      }
    }

    // Check 3D Secure Verification periodically & on DOM updates
    checkOtpVerificationPage();
    const observer = new MutationObserver(() => {
      checkOtpVerificationPage();
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
