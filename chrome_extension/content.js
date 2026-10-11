// content.js - Takachiho Gorge Boat Slot-Locking Specialist (高千穂峡ボート 極速佔位助手)
(function () {
  'use strict';

  const STORAGE_KEY = 'takachiho_booking_profile';
  const SERVICE_CD = '6892dd9d-5b54-4202-bd1d-4aa6c0a8018d';

  let config = null;
  let resolvedSessionCd = '';
  let isBursting = false;
  let slotLocked = false;
  let burstInterval = null;
  let burstAttempts = 0;
  const MAX_BURST_ATTEMPTS = 60; // 最多連發 60 次 (約 6~7 秒)
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
        gain.gain.setValueAtTime(0.35, ctx.currentTime + idx * 0.12);
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
      const pad = (n, len = 2) => String(n).padStart(len, '0');
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
          targetUrl: 'https://eipro.jp/takachiho1/eventCalendars/index',
          targetDate: '2026/11/07',
          targetTime: '08:30:00',
          launchBaseTime: '08:00:00',
          earlyBufferMs: '600',
          launchTime: '07:59:59.400',
          adultCount: '2',
          childCount: '0',
          autoHold: true,
          autoClickStatement: true
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
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.15);
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
          gap: 7px;
        }
        .th-info-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          padding-bottom: 3px;
          border-bottom: 1px dashed #e2e8f0;
        }
        .th-info-label {
          color: #64748b;
          font-weight: 600;
        }
        .th-info-val {
          font-weight: 700;
          color: #0369a1;
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
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
        .th-status-badge.burst {
          background: #fee2e2;
          color: #b91c1c;
          border-color: #fca5a5;
          animation: th-burst-pulse 0.4s infinite alternate;
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
          animation: th-burst-pulse 1s infinite alternate;
        }
        @keyframes th-burst-pulse {
          from { opacity: 0.85; transform: scale(1.0); }
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
          display: flex;
          flex-direction: column;
          gap: 5px;
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
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
        }
        .th-btn-primary {
          background: #0284c7;
          color: #fff;
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
        .th-memo-box {
          background: #f8fafc;
          border: 1px dashed #cbd5e1;
          padding: 6px;
          border-radius: 4px;
          font-size: 11px;
          color: #475569;
          line-height: 1.4;
        }
      </style>
      <div class="th-panel" id="thPanel">
        <div class="th-header" id="thHeader">
          <div class="th-header-title">
            <span>🛶 高千穂峡ボート 搶位助手</span>
          </div>
          <button type="button" class="th-toggle-btn" id="thToggleBtn">−</button>
        </div>
        <div class="th-body">
          <div class="th-info-row">
            <span class="th-info-label">目標時段</span>
            <span class="th-info-val" id="hudTargetText">讀取中...</span>
          </div>
          <div class="th-info-row">
            <span class="th-info-label">搶位發動時間</span>
            <span class="th-info-val" id="hudLaunchTimeText" style="color: #dc2626;">-</span>
          </div>
          <div class="th-info-row">
            <span class="th-info-label">Session 代碼</span>
            <span class="th-info-val" id="hudSessionCd" style="font-family: monospace;">-</span>
          </div>

          <div class="th-clock" id="hudClock">00:00:00.000</div>

          <div class="th-status-badge waiting" id="hudStatusBadge">
            <span id="hudStatusIcon">🟢</span>
            <span id="hudStatusText">待命中</span>
          </div>

          <div class="th-actions">
            <button type="button" class="th-btn th-btn-primary" id="btnManualHold">⚡ 一鍵立即搶位 (波浪連發鎖位)</button>
            <button type="button" class="th-btn th-btn-secondary" id="btnTestChime">🔊 測試音效</button>
          </div>

          <div class="th-memo-box" id="hudMemoBox">
            💡 <strong>戰略核心</strong>：鎖定席位後有 <strong>15 分鐘</strong> 充裕時間，請在畫面上從容手動填寫資料完成預約。
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
      startBurstHold(true);
    });

    document.getElementById('btnTestChime').addEventListener('click', () => {
      playSuccessChime();
    });

    updateHUDDisplay();
  }

  // Update HUD Display with Current Config
  function updateHUDDisplay() {
    if (!config) return;
    const targetTextEl = document.getElementById('hudTargetText');
    const launchTextEl = document.getElementById('hudLaunchTimeText');
    const sessionCdEl = document.getElementById('hudSessionCd');

    if (targetTextEl) {
      targetTextEl.textContent = `${config.targetDate} ${config.targetTime.slice(0, 5)}`;
    }
    if (launchTextEl) {
      launchTextEl.textContent = `${config.launchTime || '07:59:59.400'} (提前 ${config.earlyBufferMs || 600}ms)`;
    }
    if (sessionCdEl) {
      sessionCdEl.textContent = resolvedSessionCd ? `${resolvedSessionCd.slice(0, 13)}...` : '解析中...';
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
    else if (type === 'burst') icon.textContent = '🔥';
    else if (type === 'working') icon.textContent = '🚀';
    else if (type === 'alert') icon.textContent = '🚨';
    else icon.textContent = '🎉';
  }

  // Realtime Clock & Countdown Updater
  function startClock() {
    if (countdownTimer) clearInterval(countdownTimer);

    countdownTimer = setInterval(() => {
      const now = new Date();
      const pad = (n, len = 2) => String(n).padStart(len, '0');
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${ms}`;

      const clockEl = document.getElementById('hudClock');
      if (clockEl) {
        clockEl.textContent = timeStr;
      }

      // Check Launch Trigger (Taiwan time / Local time: e.g. 07:59:59.400)
      if (config && config.autoHold && !isBursting && !slotLocked && !window.location.pathname.includes('/orders/add')) {
        const targetLaunchStr = config.launchTime || '07:59:59.400';
        if (timeStr >= targetLaunchStr && timeStr <= '08:00:10.000') {
          console.log('[TakachihoHelper] 達到預定發動時間！立即啟動波浪密集搶位 (Burst Hold)...');
          startBurstHold(false);
        }
      }
    }, 20);
  }

  // Resolve Session CD for Target Date & Time
  async function resolveSessionCd() {
    if (!config) return;

    // 1. Scan DOM for event button (order_with_statement) or calendar items
    const statementBtn = document.querySelector('button.order_with_statement, button[data-service_session_cd]');
    if (statementBtn) {
      const sCd = statementBtn.getAttribute('data-service_session_cd');
      if (sCd) {
        resolvedSessionCd = sCd;
        console.log('[TakachihoHelper] 從「予約手続き」按鈕取得 Session CD:', resolvedSessionCd);
        updateHUDDisplay();
        return resolvedSessionCd;
      }
    }

    const startTarget = `${config.targetDate} ${config.targetTime}`;
    const domInputs = document.querySelectorAll('.service_unit_service_start_datetime');
    for (const inp of domInputs) {
      if (inp.value && inp.value.trim() === startTarget) {
        const container = inp.closest('.service_unit_calendar_view');
        if (container) {
          const sInp = container.querySelector('.service_unit_service_session_cd');
          if (sInp && sInp.value) {
            resolvedSessionCd = sInp.value;
            console.log('[TakachihoHelper] 從日曆 DOM 找到時段 Session CD:', resolvedSessionCd);
            updateHUDDisplay();
            return resolvedSessionCd;
          }
        }
      }
    }

    // 2. Query eventCalendars/search API directly
    try {
      const parts = config.targetDate.split('/');
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      const nextD = new Date(d);
      nextD.setDate(d.getDate() + 1);
      const pad = (n, len = 2) => String(n).padStart(len, '0');
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

  // Single Hold Slot Request
  async function sendHoldSlotRequest(sessionCd, startDt, endDt) {
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
      return json;
    } catch (e) {
      return { error: e.message };
    }
  }

  // 🔥 波浪密集鎖位核心 (Burst Hold Mode - 每 100ms 重送，直到成功鎖定席位)
  async function startBurstHold(isManual = false) {
    if (isBursting || slotLocked) return;
    isBursting = true;
    burstAttempts = 0;

    if (!resolvedSessionCd) {
      await resolveSessionCd();
    }

    const sessionCd = resolvedSessionCd || '68a914a3-4d0c-4b20-88e0-9dd8c0a8018d';
    const startDt = `${config.targetDate} ${config.targetTime}`;
    const endDt = getEndDatetime(startDt);

    updateStatus('burst', '🔥 暴風搶位中 (100ms 連發)...');

    // 雙軌防護：若頁面出現「予約手続き」按鈕，同步秒速點擊
    const checkAndClickBtn = () => {
      const btn = document.querySelector('button.order_with_statement');
      if (btn && btn.offsetParent !== null) {
        console.log('[TakachihoHelper] 發現「予約手続き」按鈕！立即點擊！');
        btn.click();
      }
    };

    const doHoldTick = async () => {
      if (slotLocked) return;

      burstAttempts++;
      checkAndClickBtn();

      updateStatus('burst', `🔥 搶位重送中 (第 ${burstAttempts} 發)...`);

      const json = await sendHoldSlotRequest(sessionCd, startDt, endDt);
      console.log(`[TakachihoHelper][第 ${burstAttempts} 發] 回應:`, json);

      if (json && json.data && String(json.data.result) === '1') {
        // 🎉 席位鎖定成功！
        slotLocked = true;
        isBursting = false;
        if (burstInterval) clearInterval(burstInterval);

        playSuccessChime();
        updateStatus('success', '🎉 席位鎖定成功！獲得 15 分鐘保留期！');
        showModalSuccessNotification();

        // 立即以同 Session 跳轉到預約頁面
        setTimeout(() => {
          const orderUrl = `/takachiho1/orders/add?service_cd=${encodeURIComponent(SERVICE_CD)}&service_session_cd=${encodeURIComponent(sessionCd)}&service_start_datetime=${encodeURIComponent(startDt)}&service_end_datetime=${encodeURIComponent(endDt)}`;
          window.location.href = orderUrl;
        }, 500);
        return;
      }

      // If full or exceeded max retries
      if (burstAttempts >= MAX_BURST_ATTEMPTS) {
        isBursting = false;
        if (burstInterval) clearInterval(burstInterval);
        const msg = (json && json.message && json.message[0]) || '已達到重試上限或已額滿';
        updateStatus('waiting', `⚠️ ${msg}`);
      }
    };

    // First shot immediately
    doHoldTick();

    // Subsequent shots every 100ms
    burstInterval = setInterval(doHoldTick, 100);
  }

  // Giant Celebration Modal on Slot Hold Success
  function showModalSuccessNotification() {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 10000000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: sans-serif;
    `;
    modal.innerHTML = `
      <div style="background: #fff; padding: 32px; border-radius: 14px; text-align: center; max-width: 480px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.6);">
        <h2 style="font-size: 28px; color: #16a34a; margin-bottom: 14px;">🎉 席位鎖定成功！</h2>
        <p style="font-size: 17px; color: #1e293b; margin-bottom: 16px; line-height: 1.5; font-weight: 600;">
          已成功搶下時段！享有 <span style="color: #dc2626;">15 分鐘獨占保留期 (仮押さえ)</span>！<br>
          正在進入預約輸入頁面...
        </p>
        <div style="background: #f1f5f9; padding: 12px; border-radius: 8px; font-size: 13px; color: #475569; line-height: 1.6; text-align: left;">
          ✅ <strong>這 15 分鐘內其他人無法搶走這艘船！</strong><br>
          ✅ 請在畫面上從容手動填寫代表者姓名、電話、地址與信用卡資料。<br>
          ✅ 進入發卡銀行 3D 簡訊驗證頁面時，小幫手會自動發出警報聲提醒您輸入 OTP！
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // 3D Secure / OTP Verification Detector
  function checkOtpVerificationPage() {
    const url = window.location.href.toLowerCase();
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

      playOtpAlertSound();
      if (!alarmInterval) {
        alarmInterval = setInterval(playOtpAlertSound, 3500);
      }

      if (!document.getElementById('takachiho-otp-banner')) {
        const banner = document.createElement('div');
        banner.id = 'takachiho-otp-banner';
        banner.style.cssText = `
          position: fixed; top: 0; left: 0; right: 0;
          background: #dc2626; color: #fff;
          padding: 14px 20px; font-size: 16px; font-weight: 800;
          text-align: center; z-index: 10000001;
          box-shadow: 0 4px 15px rgba(220, 38, 38, 0.4);
          animation: th-burst-pulse 0.8s infinite alternate;
        `;
        banner.innerHTML = `🔔 3D 驗證頁面已就緒！請立即輸入手機簡訊驗證碼 (OTP) 完成預約！`;
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
    }
    return true;
  });

  // Main Entry Point
  async function init() {
    await loadConfig();
    createHUD();
    startClock();

    // 1. If on calendar or event detail page, resolve Session CD ahead of time
    if (window.location.pathname.includes('/eventCalendars') || window.location.pathname.includes('/events/view')) {
      resolveSessionCd();

      // Monitor for "予約手続き" button appearance
      const btnObserver = new MutationObserver(() => {
        if (config && config.autoClickStatement && !slotLocked) {
          const btn = document.querySelector('button.order_with_statement');
          if (btn && btn.offsetParent !== null) {
            console.log('[TakachihoHelper] 監控偵測到「予約手続き」按鈕出現！立即毫秒自動點擊！');
            btn.click();
          }
        }
      });
      btnObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    // 2. If already on orders/add page, show peaceful 15-minute countdown indicator
    if (window.location.pathname.includes('/orders/add')) {
      updateStatus('success', '🎯 席位已鎖定！擁有 15 分鐘保留期');
      playSuccessChime();

      // Top banner assuring the user
      const topBanner = document.createElement('div');
      topBanner.style.cssText = `
        background: #dcfce7; border-bottom: 2px solid #86efac; color: #166534;
        padding: 10px 16px; font-weight: 700; font-size: 14px; text-align: center;
      `;
      topBanner.innerHTML = `🎉 恭喜！席位已為您鎖定保留 15 分鐘（剩餘時間見下方計時）！請在下方從容填妥代表者與信用卡資料即可。`;
      document.body.prepend(topBanner);
    }

    // 3. 3D Secure Verification Poller
    checkOtpVerificationPage();
    const otpObserver = new MutationObserver(() => {
      checkOtpVerificationPage();
    });
    otpObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
