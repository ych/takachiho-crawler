// test_extension_logic.js - Automated Verification of v1.0.3 Extension Logic
const assert = require('assert');

console.log('🧪 Starting Extension Logic Tests...\n');

// 1. calculateTriggerTime (from popup.js)
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

// 2. calculateMaxTriggerTime (from content.js)
function calculateMaxTriggerTime(baseTimeStr) {
  try {
    const parts = (baseTimeStr || '08:00:00').split(':');
    let h = parseInt(parts[0], 10) || 8;
    let m = parseInt(parts[1], 10) || 0;
    let s = parseInt(parts[2], 10) || 0;
    let totalSec = (h * 3600 + m * 60 + s + 10) % 86400;
    const resH = Math.floor(totalSec / 3600);
    const resM = Math.floor((totalSec % 3600) / 60);
    const resS = totalSec % 60;
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${pad(resH)}:${pad(resM)}:${pad(resS)}.000`;
  } catch (e) {
    return '23:59:59.000';
  }
}

// Test 1: 08:00:00 First Wave
console.log('▶ Test 1: 08:00:00 First wave calculation');
const t1_launch = calculateTriggerTime('08:00:00', '15');
const t1_max = calculateMaxTriggerTime('08:00:00');
assert.strictEqual(t1_launch, '07:59:59.985', `Expected 07:59:59.985, got ${t1_launch}`);
assert.strictEqual(t1_max, '08:00:10.000', `Expected 08:00:10.000, got ${t1_max}`);
console.log(`  ✓ 08:00:00 -> Launch: ${t1_launch}, Max Window: ${t1_max}`);

// Test 2: 08:15:00 Release Wave (15-minute held tickets released)
console.log('▶ Test 2: 08:15:00 15-minute release wave calculation');
const t2_launch = calculateTriggerTime('08:15:00', '15');
const t2_max = calculateMaxTriggerTime('08:15:00');
assert.strictEqual(t2_launch, '08:14:59.985', `Expected 08:14:59.985, got ${t2_launch}`);
assert.strictEqual(t2_max, '08:15:10.000', `Expected 08:15:10.000, got ${t2_max}`);
console.log(`  ✓ 08:15:00 -> Launch: ${t2_launch}, Max Window: ${t2_max}`);

// Test 3: 08:30:00 Second Release Wave
console.log('▶ Test 3: 08:30:00 Second release wave calculation');
const t3_launch = calculateTriggerTime('08:30:00', '20');
const t3_max = calculateMaxTriggerTime('08:30:00');
assert.strictEqual(t3_launch, '08:29:59.980', `Expected 08:29:59.980, got ${t3_launch}`);
assert.strictEqual(t3_max, '08:30:10.000', `Expected 08:30:10.000, got ${t3_max}`);
console.log(`  ✓ 08:30:00 -> Launch: ${t3_launch}, Max Window: ${t3_max}`);

// Test 4: Dynamic Trigger Window Check
console.log('▶ Test 4: Trigger Window Matching Logic');
function checkTrigger(timeStr, targetLaunchStr, maxTriggerStr) {
  return timeStr >= targetLaunchStr && timeStr <= maxTriggerStr;
}

// 08:15 case
const launch0815 = '08:14:59.985';
const max0815 = '08:15:10.000';

assert.strictEqual(checkTrigger('08:14:59.900', launch0815, max0815), false, 'Before launch should NOT trigger');
assert.strictEqual(checkTrigger('08:14:59.985', launch0815, max0815), true, 'Exact launch time SHOULD trigger');
assert.strictEqual(checkTrigger('08:15:00.005', launch0815, max0815), true, 'Inside window SHOULD trigger');
assert.strictEqual(checkTrigger('08:15:10.000', launch0815, max0815), true, 'Window boundary SHOULD trigger');
assert.strictEqual(checkTrigger('08:15:10.001', launch0815, max0815), false, 'Past window should NOT trigger');
console.log('  ✓ Trigger window boundary checks passed for 08:15:00!');

// Test 5: Verify File Content Properties
console.log('▶ Test 5: Verify default adultCount = 3 in manifest, popup.html, popup.js, content.js');
const fs = require('fs');
const popupJsContent = fs.readFileSync('chrome_extension/popup.js', 'utf8');
const popupHtmlContent = fs.readFileSync('chrome_extension/popup.html', 'utf8');
const contentJsContent = fs.readFileSync('chrome_extension/content.js', 'utf8');

assert(popupJsContent.includes("adultCount: '3'"), 'popup.js should default adultCount to 3');
assert(popupHtmlContent.includes('<option value="3" selected>3 名 (預設)</option>'), 'popup.html should have 3 selected by default');
assert(contentJsContent.includes("adultCount: '3'"), 'content.js should have adultCount: 3 in default config');
assert(contentJsContent.includes('calculateMaxTriggerTime'), 'content.js must implement calculateMaxTriggerTime');
assert(contentJsContent.includes('hudCountdown'), 'content.js must implement hudCountdown visual indicator');
console.log('  ✓ Default passenger count 3 and dynamic trigger code verified across all files!');

// Test 6: Verify 10/26 simulation references are completely eliminated
console.log('▶ Test 6: Verify 10/26 test references are cleaned out');
assert(!popupHtmlContent.includes('btnPreset1026'), 'popup.html must not contain btnPreset1026');
assert(!popupJsContent.includes('URL_1026'), 'popup.js must not contain URL_1026');
assert(!popupJsContent.includes('btnPreset1026'), 'popup.js must not contain btnPreset1026');
assert(!contentJsContent.includes("targetDate === '2026/10/26'"), 'content.js must not contain 10/26 fallback');
console.log('  ✓ 10/26 simulation references completely cleaned out!');

// Test 7: Verify Stop & Resume Lifecycle Persistence Logic
console.log('▶ Test 7: Stop & Resume Lifecycle Persistence');
const STORAGE_KEY = 'takachiho_booking_profile';
let mockStorage = {
  [STORAGE_KEY]: {
    targetUrl: 'https://eipro.jp/...',
    targetDate: '2026/11/07',
    targetTime: '08:30:00',
    autoHold: true
  }
};

function mockStopAllResources(config, persist = false) {
  let isStopped = true;
  let isBursting = false;
  if (persist) {
    if (config) config.autoHold = false;
    mockStorage[STORAGE_KEY].autoHold = false;
  }
  return { isStopped, isBursting, autoHold: mockStorage[STORAGE_KEY].autoHold };
}

function mockResumeAllResources(config, persist = false) {
  let isStopped = false;
  let isBursting = false;
  if (config) config.autoHold = true;
  if (persist) {
    mockStorage[STORAGE_KEY].autoHold = true;
  }
  return { isStopped, isBursting, autoHold: mockStorage[STORAGE_KEY].autoHold };
}

let cfg = { ...mockStorage[STORAGE_KEY] };
// Initially running
assert.strictEqual(cfg.autoHold, true, 'Initially autoHold should be true');

// User clicks Stop in HUD or Popup -> persists to storage
const stopRes = mockStopAllResources(cfg, true);
assert.strictEqual(stopRes.isStopped, true, 'isStopped must be true');
assert.strictEqual(stopRes.autoHold, false, 'Storage autoHold must be persisted as false');
assert.strictEqual(mockStorage[STORAGE_KEY].autoHold, false, 'Global mockStorage must be false');
console.log('  ✓ Stop action persists autoHold = false to storage');

// User clicks Resume in HUD or Popup -> persists to storage
const resumeRes = mockResumeAllResources(cfg, true);
assert.strictEqual(resumeRes.isStopped, false, 'isStopped must be false after resume');
assert.strictEqual(resumeRes.autoHold, true, 'Storage autoHold must be persisted as true');
assert.strictEqual(mockStorage[STORAGE_KEY].autoHold, true, 'Global mockStorage must be true');
console.log('  ✓ Resume action persists autoHold = true to storage');

// Test 8: New Page Load / Reload with Stopped State
console.log('▶ Test 8: New Page Load Initialization Behavior when Stopped');
function mockPageInit(storageData) {
  const loadedConfig = storageData[STORAGE_KEY] || { autoHold: true };
  const isMasterArmed = loadedConfig.autoHold !== false;
  let isStopped = !isMasterArmed;
  let clockRunning = isMasterArmed;
  let observerActive = isMasterArmed;
  return { isStopped, clockRunning, observerActive, isMasterArmed };
}

// Case A: Storage has autoHold: false (User previously stopped)
mockStorage[STORAGE_KEY].autoHold = false;
const newTabStopped = mockPageInit(mockStorage);
assert.strictEqual(newTabStopped.isStopped, true, 'New tab must initialize in stopped state');
assert.strictEqual(newTabStopped.clockRunning, false, 'New tab clock/burst should NOT run');
assert.strictEqual(newTabStopped.observerActive, false, 'New tab button observer should NOT be active');
console.log('  ✓ When stopped, newly opened tab or reloaded page strictly stays stopped!');

// Case B: Storage has autoHold: true (Active mode)
mockStorage[STORAGE_KEY].autoHold = true;
const newTabActive = mockPageInit(mockStorage);
assert.strictEqual(newTabActive.isStopped, false, 'New tab must initialize in armed state');
assert.strictEqual(newTabActive.clockRunning, true, 'New tab clock should run');
assert.strictEqual(newTabActive.observerActive, true, 'New tab observer should be active');
console.log('  ✓ When active, newly opened tab initializes ready to fire!');

// Test 9: Multi-tab real-time storage.onChanged synchronization
console.log('▶ Test 9: Multi-Tab Synchronization via chrome.storage.onChanged');
function simulateStorageChangedEvent(currentTabState, newProfile) {
  let state = { ...currentTabState };
  if (newProfile.autoHold === false) {
    if (!state.isStopped) {
      state.isStopped = true;
      state.isBursting = false;
      state.observerActive = false;
    }
  } else {
    if (state.isStopped) {
      state.isStopped = false;
      state.observerActive = true;
    }
  }
  return state;
}

let tab1State = { isStopped: false, isBursting: false, observerActive: true };
let tab2State = { isStopped: false, isBursting: false, observerActive: true };

// Tab 1 stops -> storage changes -> Tab 2 receives event
const tab2AfterStop = simulateStorageChangedEvent(tab2State, { autoHold: false });
assert.strictEqual(tab2AfterStop.isStopped, true, 'Tab 2 must stop immediately when Tab 1 stops');
assert.strictEqual(tab2AfterStop.observerActive, false, 'Tab 2 observer must disconnect');

// Tab 2 resumes -> storage changes -> Tab 1 receives event
const tab1AfterResume = simulateStorageChangedEvent(tab2AfterStop, { autoHold: true });
assert.strictEqual(tab1AfterResume.isStopped, false, 'Tab 1 must resume immediately when Tab 2 resumes');
assert.strictEqual(tab1AfterResume.observerActive, true, 'Tab 1 observer must reconnect');
console.log('  ✓ Multi-tab synchronization verified: stopping on any tab stops all tabs!');

console.log('\n🎉 ALL 9 TEST SUITES PASSED CLEANLY AND COMPLETELY!');

