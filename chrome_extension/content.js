// content.js - Takachiho Gorge Boat Slot-Locking Specialist (高千穂峡ボート 極速佔位助手)
// 輕量、純淨、零卡頓架構：使用 Shadow DOM 隔離，杜絕 DOM 重繪迴圈與崩潰
(function () {
  'use strict';

  const STORAGE_KEY = 'takachiho_booking_profile';
  const SERVICE_CD = '6892dd9d-5b54-4202-bd1d-4aa6c0a8018d';

  let config = null;
  let resolvedSessionCd = '';
  let isBursting = false;
  let slotLocked = false;
  let isStopped = false;

  let countdownTimer = null;
  let burstInterval = null;
  let btnObserver = null;
  let audioCtx = null;
  let burstAttempts = 0;
  const SAFE_MAX_ATTEMPTS = 12; // 最多連發 12 次 (約 3 秒，安全不被封鎖)

  let hudHost = null;
  let hudShadow = null;

  // ==========================================
  // 1. 資源釋放與生命週期控制 (Stop & Resume)
  // ==========================================

  function stopAllResources(logMessage = true) {
    isStopped = true;
    isBursting = false;

    // 清除所有計時器
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (burstInterval) {
      clearInterval(burstInterval);
      burstInterval = null;
    }

    // 斷開 DOM 監控
    if (btnObserver) {
      btnObserver.disconnect();
      btnObserver = null;
    }

    // 關閉並釋放音訊資源
    if (audioCtx) {
      try {
        audioCtx.close().catch(() => {});
      } catch (e) {}
      audioCtx = null;
    }

    updateStatus('stopped', '⏹️ 已停止所有排程，所有資源均已釋放');
    updateStopButtonUI(true);

    if (logMessage) {
      console.log('[TakachihoHelper] 🛑 已手動停止搶位，所有 Timer、Observer、Audio 資源均已成功釋放！');
    }
  }

  function resumeAllResources() {
    isStopped = false;
    updateStopButtonUI(false);
    updateStatus('waiting', '🟢 重新啟動監控中...');

    startClock();
    startButtonObserver();
    resolveSessionCd();

    console.log('[TakachihoHelper] ▶️ 已重新啟動搶位監控！');
  }

  function updateStopButtonUI(isCurrentlyStopped) {
    if (!hudShadow) return;
    const btn = hudShadow.getElementById('btnToggleStop');
    if (!btn) return;

    if (isCurrentlyStopped) {
      btn.textContent = '▶️ 重新啟動監控';
      btn.className = 'th-btn th-btn-resume';
    } else {
      btn.textContent = '🛑 停止搶位並釋放資源';
      btn.className = 'th-btn th-btn-stop';
    }
  }

  // ==========================================
  // 2. 音訊控制 (合規 Web Audio API，點擊後解鎖)
  // ==========================================

  function getAudioContext() {
    if (!audioCtx) {
      try {
        const AudioClass = window.AudioContext || window.webkitAudioContext;
        if (AudioClass) audioCtx = new AudioClass();
      } catch (e) {
        return null;
      }
    }
    return audioCtx;
  }

  function playSuccessChime() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => doChime(ctx)).catch(() => {});
        return;
      }
      doChime(ctx);
    } catch (e) {}
  }

  function doChime(ctx) {
    try {
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
    } catch (e) {}
  }

  // ==========================================
  // 3. 浮動面板 (Shadow DOM 封裝，0 污染 0 迴圈)
  // ==========================================

  function createHUD() {
    if (document.getElementById('takachiho-hud-host')) return;

    hudHost = document.createElement('div');
    hudHost.id = 'takachiho-hud-host';
    hudShadow = hudHost.attachShadow({ mode: 'open' });

    hudShadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }
        .th-container {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          color: #0f172a;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.15);
        }
        .th-panel {
          width: 320px;
          background: rgba(255, 255, 255, 0.98);
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
        }
        .th-status-badge.stopped {
          background: #f1f5f9;
          color: #475569;
          border-color: #cbd5e1;
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
          transition: background 0.15s, opacity 0.15s;
        }
        .th-btn-primary {
          background: #0284c7;
          color: #fff;
        }
        .th-btn-primary:hover {
          background: #0369a1;
        }
        .th-btn-stop {
          background: #ef4444;
          color: #fff;
        }
        .th-btn-stop:hover {
          background: #dc2626;
        }
        .th-btn-resume {
          background: #10b981;
          color: #fff;
        }
        .th-btn-resume:hover {
          background: #059669;
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
      <div class="th-container">
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
              <button type="button" class="th-btn th-btn-primary" id="btnManualHold">⚡ 一鍵立即搶位 (安全連發)</button>
              <button type="button" class="th-btn th-btn-stop" id="btnToggleStop">🛑 停止搶位並釋放資源</button>
              <button type="button" class="th-btn th-btn-secondary" id="btnTestChime">🔊 測試音效</button>
            </div>

            <div class="th-memo-box">
              💡 <strong>唯一目標</strong>：全力鎖定席位 (15 分鐘獨占保留期)！預約資料請在畫面上從容手動填寫。
            </div>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(hudHost);

    // 面板事件綁定
    const thPanel = hudShadow.getElementById('thPanel');
    const thHeader = hudShadow.getElementById('thHeader');
    const thToggleBtn = hudShadow.getElementById('thToggleBtn');

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

    hudShadow.getElementById('btnManualHold').addEventListener('click', () => {
      if (isStopped) {
        resumeAllResources();
      }
      startBurstHold(true);
    });

    hudShadow.getElementById('btnToggleStop').addEventListener('click', () => {
      if (isStopped) {
        resumeAllResources();
      } else {
        stopAllResources(true);
      }
    });

    hudShadow.getElementById('btnTestChime').addEventListener('click', () => {
      playSuccessChime();
    });

    updateHUDDisplay();
  }

  function updateHUDDisplay() {
    if (!config || !hudShadow) return;
    const targetTextEl = hudShadow.getElementById('hudTargetText');
    const launchTextEl = hudShadow.getElementById('hudLaunchTimeText');
    const sessionCdEl = hudShadow.getElementById('hudSessionCd');

    if (targetTextEl) {
      targetTextEl.textContent = `${config.targetDate} ${config.targetTime.slice(0, 5)}`;
    }
    if (launchTextEl) {
      launchTextEl.textContent = `${config.launchTime || '07:59:59.985'} (提前 ${config.earlyBufferMs || 15}ms)`;
    }
    if (sessionCdEl) {
      sessionCdEl.textContent = resolvedSessionCd ? `${resolvedSessionCd.slice(0, 13)}...` : '解析中...';
      sessionCdEl.title = resolvedSessionCd;
    }
  }

  function updateStatus(type, message) {
    if (!hudShadow) return;
    const badge = hudShadow.getElementById('hudStatusBadge');
    const text = hudShadow.getElementById('hudStatusText');
    const icon = hudShadow.getElementById('hudStatusIcon');
    if (!badge || !text || !icon) return;

    badge.className = `th-status-badge ${type}`;
    text.textContent = message;

    if (type === 'waiting') icon.textContent = '⏳';
    else if (type === 'burst') icon.textContent = '🔥';
    else if (type === 'stopped') icon.textContent = '⏹️';
    else if (type === 'success') icon.textContent = '🎉';
    else icon.textContent = '🟢';
  }

  // ==========================================
  // 4. 時鐘與觸發器 (50ms 溫和定時，低負載)
  // ==========================================

  function startClock() {
    if (countdownTimer) clearInterval(countdownTimer);

    countdownTimer = setInterval(() => {
      if (isStopped) return;

      const now = new Date();
      const pad = (n, len = 2) => String(n).padStart(len, '0');
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${ms}`;

      if (hudShadow) {
        const clockEl = hudShadow.getElementById('hudClock');
        if (clockEl) {
          clockEl.textContent = timeStr;
        }
      }

      // 開賣觸發 (僅在 07:59:59.985 ~ 08:00:10.000 之間發動)
      if (config && config.autoHold && !isBursting && !slotLocked && !window.location.pathname.includes('/orders/add')) {
        const targetLaunchStr = config.launchTime || '07:59:59.985';
        if (timeStr >= targetLaunchStr && timeStr <= '08:00:10.000') {
          console.log('[TakachihoHelper] 達到開賣預定發動時間！立即啟動精準鎖位 (Burst Hold)...');
          startBurstHold(false);
        }
      }
    }, 50);
  }

  // ==========================================
  // 5. Session CD 解析與網址直達
  // ==========================================

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

  async function resolveSessionCd() {
    if (!config || isStopped) return;

    // 0. 優先直接從當前網址參數解析
    try {
      const currentUrlParams = new URLSearchParams(window.location.search);
      const urlSessionCd = currentUrlParams.get('service_session_cd');
      if (urlSessionCd) {
        resolvedSessionCd = urlSessionCd;
        console.log('[TakachihoHelper] 從當前網址參數直接解析 Session CD:', resolvedSessionCd);
        updateHUDDisplay();
        return resolvedSessionCd;
      }
    } catch (e) {}

    // 0.5 從設定的目標網址中解析
    if (config.targetUrl && config.targetUrl.includes('service_session_cd=')) {
      try {
        const u = new URL(config.targetUrl);
        const tSessionCd = u.searchParams.get('service_session_cd');
        if (tSessionCd) {
          resolvedSessionCd = tSessionCd;
          console.log('[TakachihoHelper] 從目標網址設定直接解析 Session CD:', resolvedSessionCd);
          updateHUDDisplay();
          return resolvedSessionCd;
        }
      } catch (e) {}
    }

    // 1. 從頁面上的按鈕尋找
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

    // 2. 從日曆 DOM 尋找
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

    // 3. 透過 search API 解析
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
          updateHUDDisplay();
        }
      }
    } catch (e) {
      console.warn('[TakachihoHelper] 解析 Session CD 失敗:', e);
    }

    return resolvedSessionCd;
  }

  // ==========================================
  // 6. 精準鎖位引擎 (hold_slot 首發 + 250ms 重試)
  // ==========================================

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

      return await resp.json();
    } catch (e) {
      return { error: e.message };
    }
  }

  async function startBurstHold(isManual = false) {
    if (isBursting || slotLocked || isStopped) return;
    isBursting = true;
    burstAttempts = 0;

    if (!resolvedSessionCd) {
      await resolveSessionCd();
    }

    const sessionCd = resolvedSessionCd || '68a916a6-59c8-459d-9643-a231c0a8018d';
    const startDt = `${config.targetDate} ${config.targetTime}`;
    const endDt = getEndDatetime(startDt);

    updateStatus('burst', '🎯 精準鎖位中 (首發送出，250ms 安全重送)...');

    const checkAndClickBtn = () => {
      const btn = document.querySelector('button.order_with_statement');
      if (btn && btn.offsetParent !== null) {
        console.log('[TakachihoHelper] 發現「予約手続き」按鈕！立即點擊！');
        btn.click();
      }
    };

    const doHoldTick = async () => {
      if (slotLocked || isStopped) return;

      burstAttempts++;
      checkAndClickBtn();

      updateStatus('burst', `🎯 鎖位請求中 (第 ${burstAttempts} 次)...`);

      const json = await sendHoldSlotRequest(sessionCd, startDt, endDt);
      console.log(`[TakachihoHelper][第 ${burstAttempts} 次] 回應:`, json);

      if (json && json.data && String(json.data.result) === '1') {
        // 🎉 席位鎖定成功！
        slotLocked = true;
        isBursting = false;
        if (burstInterval) clearInterval(burstInterval);

        playSuccessChime();
        updateStatus('success', '🎉 席位鎖定成功！獲得 15 分鐘保留期！');

        // 立即以同 Session 跳轉到預約輸入頁面
        setTimeout(() => {
          const orderUrl = `/takachiho1/orders/add?service_cd=${encodeURIComponent(SERVICE_CD)}&service_session_cd=${encodeURIComponent(sessionCd)}&service_start_datetime=${encodeURIComponent(startDt)}&service_end_datetime=${encodeURIComponent(endDt)}`;
          window.location.href = orderUrl;
        }, 300);
        return;
      }

      // 超過次數或已滿
      if (burstAttempts >= SAFE_MAX_ATTEMPTS) {
        isBursting = false;
        if (burstInterval) clearInterval(burstInterval);
        const msg = (json && json.message && json.message[0]) || '已完成嘗試或目前尚未開放';
        updateStatus('waiting', `⚠️ ${msg}`);
      }
    };

    // 首發立刻送出
    doHoldTick();

    // 後續以 250ms 溫和安全重送
    burstInterval = setInterval(doHoldTick, 250);
  }

  // ==========================================
  // 7. 輕量按鈕監控
  // ==========================================

  function startButtonObserver() {
    if (btnObserver) btnObserver.disconnect();

    const targetContainer = document.getElementById('main') || document.getElementById('content') || document.body;
    if (!targetContainer) return;

    btnObserver = new MutationObserver(() => {
      if (isStopped || slotLocked) return;
      if (config && config.autoClickStatement) {
        const btn = document.querySelector('button.order_with_statement');
        if (btn && btn.offsetParent !== null) {
          console.log('[TakachihoHelper] 監控偵測到「予約手続き」按鈕出現！立即毫秒自動點擊！');
          btn.click();
          if (btnObserver) {
            btnObserver.disconnect();
            btnObserver = null;
          }
        }
      }
    });

    btnObserver.observe(targetContainer, { childList: true, subtree: true });
  }

  // ==========================================
  // 8. 初始化入口
  // ==========================================

  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        config = res[STORAGE_KEY] || {
          targetUrl: 'https://eipro.jp/takachiho1/events/view/EV00000007?closable=1&service_cd=6892dd9d-5b54-4202-bd1d-4aa6c0a8018d&service_session_cd=68a916a6-59c8-459d-9643-a231c0a8018d&service_start_datetime=2026/11/07%2008:30:00&service_end_datetime=2026/11/07%2009:00:00',
          targetDate: '2026/11/07',
          targetTime: '08:30:00',
          launchBaseTime: '08:00:00',
          earlyBufferMs: '15',
          launchTime: '07:59:59.985',
          adultCount: '2',
          childCount: '0',
          autoHold: true,
          autoClickStatement: true
        };
        resolve(config);
      });
    });
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'SETTINGS_UPDATED') {
      config = request.profile;
      updateHUDDisplay();
      sendResponse({ success: true });
    }
    return true;
  });

  async function init() {
    await loadConfig();
    createHUD();
    startClock();

    if (window.location.pathname.includes('/eventCalendars') || window.location.pathname.includes('/events/view')) {
      resolveSessionCd();
      startButtonObserver();
    }

    if (window.location.pathname.includes('/orders/add')) {
      updateStatus('success', '🎯 席位已鎖定！擁有 15 分鐘保留期');
      playSuccessChime();

      const topBanner = document.createElement('div');
      topBanner.style.cssText = `
        background: #dcfce7; border-bottom: 2px solid #86efac; color: #166534;
        padding: 10px 16px; font-weight: 700; font-size: 14px; text-align: center;
      `;
      topBanner.innerHTML = `🎉 恭喜！席位已為您鎖定保留 15 分鐘（剩餘時間見下方計時）！請在下方從容填妥代表者與信用卡資料即可。`;
      document.body.prepend(topBanner);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
