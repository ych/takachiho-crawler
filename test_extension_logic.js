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

console.log('\n🎉 ALL 5 TEST SUITES PASSED CLEANLY!');
