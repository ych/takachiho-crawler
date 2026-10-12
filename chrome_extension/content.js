// content.js - Takachiho Gorge Boat Slot-Locking Specialist v1.0.2 (高千穂峡ボート 極速佔位助手)
// 輕量、純淨、零卡頓架構：使用 Shadow DOM 隔離，杜絕 DOM 重繪迴圈與崩潰
(function () {
  'use strict';

  const STORAGE_KEY = 'takachiho_booking_profile';
  const LOGS_STORAGE_KEY = 'takachiho_recent_logs';
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

  // 日誌隊列 (上限 80 條)
  const MAX_LOGS = 80;
  let debugLogs = [];

  // ==========================================
  // 0. 日誌系統 (Console 染色、HUD 顯示、儲存、下載檔案)
  // ==========================================

  function getTimestamp() {
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;
  }

  function addLog(msg, level = 'info') {
    const time = getTimestamp();
    const entry = { time, msg, level };
    debugLogs.push(entry);
    if (debugLogs.length > MAX_LOGS) debugLogs.shift();

    const styles = {
      info: 'color: #0284c7; font-weight: bold;',
      success: 'color: #16a34a; font-weight: bold;',
      warn: 'color: #d97706; font-weight: bold;',
      error: 'color: #dc2626; font-weight: bold;'
    };
    console.log(`%c[TakachihoHelper][${level.toUpperCase()}][${time}]`, styles[level] || styles.info, msg);

    updateHUDLogs();

    try {
      chrome.storage.local.get([LOGS_STORAGE_KEY], (res) => {
        let savedLogs = res[LOGS_STORAGE_KEY] || [];
        savedLogs.push(entry);
        if (savedLogs.length > MAX_LOGS) savedLogs = savedLogs.slice(-MAX_LOGS);
        chrome.storage.local.set({ [LOGS_STORAGE_KEY]: savedLogs });
      });
    } catch (e) {}
  }

  function updateHUDLogs() {
    if (!hudShadow) return;
    const logBox = hudShadow.getElementById('hudLogBox');
    if (!logBox) return;
    const lines = debugLogs.map((l) => `[${l.time}][${l.level.toUpperCase()}] ${l.msg}`);
    logBox.textContent = lines.length ? lines.join('\n') : '尚無日誌';
    logBox.scrollTop = logBox.scrollHeight;
  }

  function downloadHUDLogs() {
    const lines = debugLogs.map((l) => `[${l.time}][${l.level.toUpperCase()}] ${l.msg}`);
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `takachiho_hud_${dateStr}.log`;

    const content = `==========================================================\nTakachiho Gorge Boat Helper v1.0.2 - HUD Log Export\nURL: ${window.location.href}\nExport Time: ${new Date().toLocaleString()}\n==========================================================\n\n` + lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addLog(`📥 已成功匯出 Log 檔案至下載項目: ${filename}`, 'success');
  }

  // ==========================================
  // 1. 資源釋放與生命週期控制 (Stop & Resume)
  // ==========================================

  function stopAllResources(logMessage = true) {
    isStopped = true;
    isBursting = false;

    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (burstInterval) {
      clearInterval(burstInterval);
      burstInterval = null;
    }

    if (btnObserver) {
      btnObserver.disconnect();
      btnObserver = null;
    }

    if (audioCtx) {
      try {
        audioCtx.close().catch(() => {});
      } catch (e) {}
      audioCtx = null;
    }

    updateStatus('stopped', '⏹️ 已停止所有排程，所有資源均已釋放');
    updateStopButtonUI(true);

    if (logMessage) {
      addLog('🛑 已手動停止搶位，所有 Timer、Observer、Audio 資源均已成功釋放！', 'warn');
    }
  }

  function resumeAllResources() {
    isStopped = false;
    updateStopButtonUI(false);
    updateStatus('waiting', '🟢 重新啟動監控中...');

    startClock();
    startButtonObserver();
    resolveSessionCd();

    addLog('▶️ 已重新啟動搶位監控！', 'info');
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
        .th-version-badge {
          font-size: 10px;
          background: rgba(255, 255, 255, 0.2);
          padding: 1px 4px;
          border-radius: 3px;
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
        .th-status-badge.success {
          background: #dcfce7;
          color: #15803d;
          border-color: #86efac;
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
        .th-log-details {
          border: 1px solid #e2e8f0;
          border-radius: 4px;
          background: #f8fafc;
          padding: 4px 6px;
          font-size: 11px;
        }
        .th-log-details summary {
          cursor: pointer;
          color: #0369a1;
          font-weight: 600;
          outline: none;
        }
        .th-log-body {
          margin-top: 4px;
        }
        .th-log-box {
          background: #0f172a;
          color: #f8fafc;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 10px;
          padding: 6px;
          border-radius: 4px;
          max-height: 100px;
          overflow-y: auto;
          white-space: pre-wrap;
          word-break: break-all;
        }
      </style>
      <div class="th-container">
        <div class="th-panel" id="thPanel">
          <div class="th-header" id="thHeader">
            <div class="th-header-title">
              <span>🛶 高千穂峡ボート 搶位助手</span>
              <span class="th-version-badge">v1.0.2</span>
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

            <details class="th-log-details" id="hudLogDetails">
              <summary>📋 即時除錯日誌 (支援匯出 .log)</summary>
              <div class="th-log-body">
                <button type="button" class="th-btn th-btn-secondary" id="btnHudDownloadLogs" style="height: 22px; font-size: 11px; margin-bottom: 4px;">📥 匯出 .log 檔案</button>
                <div class="th-log-box" id="hudLogBox">尚無日誌</div>
              </div>
            </details>
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

    const btnHudDownload = hudShadow.getElementById('btnHudDownloadLogs');
    if (btnHudDownload) {
      btnHudDownload.addEventListener('click', downloadHUDLogs);
    }

    updateHUDDisplay();
    updateHUDLogs();
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
      sessionCdEl.title = resolvedSessionCd || '未解析';
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
          addLog(`達到開賣預定發動時間 (${timeStr})！立即啟動精準鎖位 (Burst Hold)...`, 'info');
          startBurstHold(false);
        }
      }
    }, 50);
  }

  // ==========================================
  // 5. Session CD 防呆解析與網址直達
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

    // 0. 優先直接從當前網址參數解析 (檢查日期防呆)
    try {
      const currentUrlParams = new URLSearchParams(window.location.search);
      const urlSessionCd = currentUrlParams.get('service_session_cd');
      const urlStartDt = currentUrlParams.get('service_start_datetime');
      if (urlSessionCd) {
        if (!urlStartDt || decodeURIComponent(urlStartDt).startsWith(config.targetDate)) {
          resolvedSessionCd = urlSessionCd;
          addLog(`[防呆通過] 從當前網址參數直接解析 Session CD: ${resolvedSessionCd.slice(0, 10)}...`, 'success');
          updateHUDDisplay();
          return resolvedSessionCd;
        } else {
          addLog(`[防呆攔截] 當前網址的時段 (${urlStartDt}) 與目標設定日期 (${config.targetDate}) 不符，跳過網址參數。`, 'warn');
        }
      }
    } catch (e) {}

    // 0.5 從設定的目標網址中解析 (關鍵防呆：嚴格檢查日期是否與 config.targetDate 一致)
    if (config.targetUrl && config.targetUrl.includes('service_session_cd=')) {
      try {
        const u = new URL(config.targetUrl);
        const rawStartDt = u.searchParams.get('service_start_datetime');
        const urlStartDt = rawStartDt ? decodeURIComponent(rawStartDt) : '';
        const tSessionCd = u.searchParams.get('service_session_cd');

        if (tSessionCd) {
          if (!urlStartDt || urlStartDt.startsWith(config.targetDate)) {
            resolvedSessionCd = tSessionCd;
            addLog(`[防呆通過] 從目標網址解析出相符日期的 Session CD: ${resolvedSessionCd.slice(0, 10)}...`, 'success');
            updateHUDDisplay();
            return resolvedSessionCd;
          } else {
            addLog(`[防呆攔截] 目標網址內日期 (${urlStartDt}) 與目標設定日期 (${config.targetDate}) 不一致！拒絕沿用該 Session CD。`, 'warn');
          }
        }
      } catch (e) {
        addLog(`解析目標網址失敗: ${e.message}`, 'error');
      }
    }

    // 1. 從頁面上的按鈕尋找
    const statementBtn = document.querySelector('button.order_with_statement, button[data-service_session_cd]');
    if (statementBtn) {
      const btnStartDt = statementBtn.getAttribute('data-service_start_datetime');
      const sCd = statementBtn.getAttribute('data-service_session_cd');
      if (sCd && (!btnStartDt || btnStartDt.startsWith(config.targetDate))) {
        resolvedSessionCd = sCd;
        addLog(`[防呆通過] 從「予約手続き」按鈕取得 Session CD: ${resolvedSessionCd.slice(0, 10)}...`, 'success');
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
            addLog(`[防呆通過] 從日曆 DOM 找到對應時段 Session CD: ${resolvedSessionCd.slice(0, 10)}...`, 'success');
            updateHUDDisplay();
            return resolvedSessionCd;
          }
        }
      }
    }

    // 3. 透過 search API 解析
    try {
      addLog(`嘗試透過 eventCalendars/search API 查詢 ${config.targetDate} 時段...`, 'info');
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
            addLog(`[防呆通過] 從 Search API 成功解析 Session CD: ${resolvedSessionCd.slice(0, 10)}...`, 'success');
            updateHUDDisplay();
            return resolvedSessionCd;
          }
        }
      }
    } catch (e) {
      addLog(`Search API 解析失敗: ${e.message}`, 'warn');
    }

    // 4. 若仍未解析，依日期進行預備代碼回退防呆
    if (!resolvedSessionCd) {
      if (config.targetDate === '2026/10/26') {
        resolvedSessionCd = '68a914cc-b08c-4413-94a1-9dd8c0a8018d';
        addLog(`[預備代碼] 自動帶入 10/26 專屬預備 Session CD: ${resolvedSessionCd.slice(0, 10)}...`, 'info');
      } else if (config.targetDate === '2026/11/07') {
        resolvedSessionCd = '68a916a6-59c8-459d-9643-a231c0a8018d';
        addLog(`[預備代碼] 自動帶入 11/07 專屬預備 Session CD: ${resolvedSessionCd.slice(0, 10)}...`, 'info');
      } else {
        addLog(`[警告] 尚未解析出 ${config.targetDate} 的 Session 代碼，請確認網址或重整日曆。`, 'warn');
      }
      updateHUDDisplay();
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

    if (!resolvedSessionCd) {
      addLog(`[防呆中斷] 無法確認 ${config.targetDate} 的 Session 代碼，為防止向伺服器發送無效請求已安全中止。`, 'error');
      updateStatus('stopped', '⚠️ 無效 Session 代碼');
      isBursting = false;
      return;
    }

    const sessionCd = resolvedSessionCd;
    const startDt = `${config.targetDate} ${config.targetTime}`;
    const endDt = getEndDatetime(startDt);

    addLog(`🎯 啟動鎖位！時段: ${startDt}, Session: ${sessionCd.slice(0, 10)}...`, 'info');
    updateStatus('burst', '🎯 精準鎖位中 (首發送出，250ms 安全重送)...');

    const checkAndClickBtn = () => {
      const btn = document.querySelector('button.order_with_statement');
      if (btn && btn.offsetParent !== null) {
        addLog('發現「予約手続き」按鈕！立即觸發點擊！', 'success');
        btn.click();
      }
    };

    const doHoldTick = async () => {
      if (slotLocked || isStopped) return;

      burstAttempts++;
      checkAndClickBtn();

      updateStatus('burst', `🎯 鎖位請求中 (第 ${burstAttempts} 次)...`);

      const json = await sendHoldSlotRequest(sessionCd, startDt, endDt);
      const isOk = json && json.data && String(json.data.result) === '1';
      const msg = (json && json.message && json.message[0]) || (json.error ? `連線錯誤: ${json.error}` : '無訊息');

      addLog(`[第 ${burstAttempts} 次連發] 回應: result=${json?.data?.result ?? 0}, msg=${msg}`, isOk ? 'success' : 'warn');

      if (isOk) {
        slotLocked = true;
        isBursting = false;
        if (burstInterval) clearInterval(burstInterval);

        playSuccessChime();
        addLog('🎉🎉🎉 席位鎖定成功！取得 15 分鐘保留期！正在跳轉預約頁面...', 'success');
        updateStatus('success', '🎉 席位鎖定成功！獲得 15 分鐘保留期！');

        setTimeout(() => {
          const orderUrl = `/takachiho1/orders/add?service_cd=${encodeURIComponent(SERVICE_CD)}&service_session_cd=${encodeURIComponent(sessionCd)}&service_start_datetime=${encodeURIComponent(startDt)}&service_end_datetime=${encodeURIComponent(endDt)}`;
          window.location.href = orderUrl;
        }, 300);
        return;
      }

      if (burstAttempts >= SAFE_MAX_ATTEMPTS) {
        isBursting = false;
        if (burstInterval) clearInterval(burstInterval);
        addLog(`已完成 ${SAFE_MAX_ATTEMPTS} 次嘗試，終止連發。最後訊息: ${msg}`, 'warn');
        updateStatus('waiting', `⚠️ ${msg}`);
      }
    };

    doHoldTick();
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
          addLog('DOM 監控偵測到「予約手続き」按鈕出現！立即毫秒自動點擊！', 'success');
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
  // 8. 初始化入口與訊息監聽
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
      resolvedSessionCd = ''; // 關鍵：重置舊的 Session 代碼，杜絕跨時段錯配！
      addLog(`[設定更新] 收到新設定: ${config.targetDate} ${config.targetTime}，重置並重新解析 Session...`, 'info');
      resolveSessionCd().then((newSession) => {
        updateHUDDisplay();
        sendResponse({ success: true, resolvedSessionCd: newSession });
      });
      return true; // 保持非同步 sendResponse
    }
    return true;
  });

  async function init() {
    await loadConfig();
    addLog(`小幫手 v1.0.2 初始化完成。目標時段: ${config.targetDate} ${config.targetTime}`, 'info');
    createHUD();
    startClock();

    if (window.location.pathname.includes('/eventCalendars') || window.location.pathname.includes('/events/view')) {
      await resolveSessionCd();
      startButtonObserver();
    }

    if (window.location.pathname.includes('/orders/add')) {
      updateStatus('success', '🎯 席位已鎖定！擁有 15 分鐘保留期');
      playSuccessChime();
      addLog('🎉 抵達預約輸入頁面 (orders/add)！請從容填寫資料。', 'success');

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
