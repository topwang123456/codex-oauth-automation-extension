# HeroSMS Watch Auto Run Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a HeroSMS polling mode that waits for a purchasable number under the current price/tier settings, pre-buys it, runs registration in fixed 3-use batches, and avoids wasting numbers.

**Architecture:** Add a background watcher state machine that uses existing HeroSMS acquisition code to buy one number, stores it in `currentPhoneActivation`, then starts `startAutoRunLoop()` for a 3-round batch. The watcher pauses during the batch, discards the number on any failed round, and continues until the rounded effective target run count is reached.

**Tech Stack:** Chrome extension Manifest V3 background script, sidepanel HTML/CSS/JS, existing Node `node:test` tests via `npm test`, HeroSMS handler API through existing `background/phone-verification-flow.js` helpers.

---

## Current code anchors

- HeroSMS purchase and price-tier logic: `background/phone-verification-flow.js:2602-2895`
- Current activation persistence: `background/phone-verification-flow.js:4205-4217`
- Step 9 existing activation reuse path: `background/phone-verification-flow.js:5815-5840`
- Success reuse counter: `background/phone-verification-flow.js:4610-4647`
- Auto-run state and entry: `background.js:9413-9418`, `background.js:9376-9414`
- Auto-run timer/status helpers: `background.js:7900-8213`
- Sidepanel auto-run button flow: `sidepanel/sidepanel.js:9545-9604`
- Sidepanel header run controls: `sidepanel/sidepanel.html:35-45`

## Behavior rules

1. Watch mode effective total runs: `Math.max(3, Math.ceil(userRunCount / 3) * 3)`.
2. Each purchased HeroSMS number starts exactly one batch of 3 registration rounds.
3. If any round in the batch fails, stop using that number immediately and return to polling for a new one.
4. If a number is purchased but the batch fails before useful Step 9 consumption, call the existing cancel path (`setStatus(8)` through `cancelPhoneActivation`).
5. Normal auto-run behavior remains unchanged unless watch mode is explicitly started.
6. Watch mode only supports HeroSMS as the active SMS provider; if another provider is selected, fail before starting.

---

### Task 1: Extract testable watch-mode math helpers

**Files:**
- Modify: `background.js` near existing auto-run normalizers (`background.js:736-760` area is a good location)
- Test: `tests/herosms-watch-mode.test.js`

**Step 1: Write the failing test**

Create `tests/herosms-watch-mode.test.js` with extraction helpers like existing tests:

```js
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }
  return source.slice(start, end);
}

const bundle = [
  'const HERO_SMS_WATCH_BATCH_SIZE = 3;',
  'const HERO_SMS_WATCH_MIN_INTERVAL_SECONDS = 5;',
  'const HERO_SMS_WATCH_MAX_INTERVAL_SECONDS = 3600;',
  'const DEFAULT_HERO_SMS_WATCH_INTERVAL_SECONDS = 30;',
  extractFunction('normalizeHeroSmsWatchIntervalSeconds'),
  extractFunction('resolveHeroSmsWatchEffectiveTotalRuns'),
  extractFunction('resolveHeroSmsWatchNextBatchSize'),
].join('\n');

const api = new Function(`${bundle}; return { normalizeHeroSmsWatchIntervalSeconds, resolveHeroSmsWatchEffectiveTotalRuns, resolveHeroSmsWatchNextBatchSize };`)();

assert.strictEqual(api.resolveHeroSmsWatchEffectiveTotalRuns(1), 3);
assert.strictEqual(api.resolveHeroSmsWatchEffectiveTotalRuns(2), 3);
assert.strictEqual(api.resolveHeroSmsWatchEffectiveTotalRuns(3), 3);
assert.strictEqual(api.resolveHeroSmsWatchEffectiveTotalRuns(4), 6);
assert.strictEqual(api.resolveHeroSmsWatchEffectiveTotalRuns(7), 9);
assert.strictEqual(api.resolveHeroSmsWatchNextBatchSize(0, 3), 3);
assert.strictEqual(api.resolveHeroSmsWatchNextBatchSize(3, 6), 3);
assert.strictEqual(api.resolveHeroSmsWatchNextBatchSize(6, 6), 0);
assert.strictEqual(api.normalizeHeroSmsWatchIntervalSeconds(''), 30);
assert.strictEqual(api.normalizeHeroSmsWatchIntervalSeconds(1), 5);
assert.strictEqual(api.normalizeHeroSmsWatchIntervalSeconds(99999), 3600);

console.log('herosms watch mode tests passed');
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/herosms-watch-mode.test.js`

Expected: FAIL with `missing function normalizeHeroSmsWatchIntervalSeconds`.

**Step 3: Implement minimal helpers**

Add to `background.js` near auto-run constants/normalizers:

```js
const HERO_SMS_WATCH_BATCH_SIZE = 3;
const HERO_SMS_WATCH_MIN_INTERVAL_SECONDS = 5;
const HERO_SMS_WATCH_MAX_INTERVAL_SECONDS = 3600;
const DEFAULT_HERO_SMS_WATCH_INTERVAL_SECONDS = 30;

function normalizeHeroSmsWatchIntervalSeconds(value) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_HERO_SMS_WATCH_INTERVAL_SECONDS;
  }
  return Math.min(HERO_SMS_WATCH_MAX_INTERVAL_SECONDS, Math.max(HERO_SMS_WATCH_MIN_INTERVAL_SECONDS, numeric));
}

function resolveHeroSmsWatchEffectiveTotalRuns(totalRuns) {
  const normalized = Math.max(1, Math.floor(Number(totalRuns) || 1));
  return Math.max(HERO_SMS_WATCH_BATCH_SIZE, Math.ceil(normalized / HERO_SMS_WATCH_BATCH_SIZE) * HERO_SMS_WATCH_BATCH_SIZE);
}

function resolveHeroSmsWatchNextBatchSize(completedRuns, effectiveTotalRuns) {
  const completed = Math.max(0, Math.floor(Number(completedRuns) || 0));
  const total = resolveHeroSmsWatchEffectiveTotalRuns(effectiveTotalRuns);
  return completed >= total ? 0 : Math.min(HERO_SMS_WATCH_BATCH_SIZE, total - completed);
}
```

**Step 4: Run test**

Run: `node --test tests/herosms-watch-mode.test.js`

Expected: PASS.

**Step 5: Checkpoint**

Do not commit unless the user explicitly asks. Record changed files in the final summary.

---

### Task 2: Expose prebuy/cancel helpers from phone verification module

**Files:**
- Modify: `background/phone-verification-flow.js:6241-6256`
- Modify: `background.js` around phone helper wrapper exports (`background.js:9360-9414` area and any wrapper block below helper creation)
- Test: `tests/herosms-watch-mode.test.js`

**Step 1: Extend failing test**

Append assertions that source exports the needed helper names:

```js
assert.match(source, /prebuyHeroSmsActivationForWatch/);
assert.match(source, /cancelPhoneActivation/);
assert.match(source, /persistCurrentActivation/);
```

Expected now: FAIL until these names are added.

**Step 2: Add helper inside `createPhoneVerificationHelpers`**

Add a small helper near `requestPhoneActivation` / `persistCurrentActivation`:

```js
async function prebuyHeroSmsActivationForWatch(state = {}) {
  const scopedState = {
    ...state,
    phoneSmsProvider: PHONE_SMS_PROVIDER_HERO,
    heroSmsReuseEnabled: true,
  };
  const activation = await requestPhoneActivation(scopedState, {
    skipPreferredActivation: true,
  });
  const normalizedActivation = normalizeActivation({
    ...activation,
    provider: PHONE_SMS_PROVIDER_HERO,
    source: 'hero-sms-watch-prebuy',
    successfulUses: 0,
    maxUses: HERO_SMS_WATCH_BATCH_SIZE,
  });
  if (!normalizedActivation) {
    throw new Error('HeroSMS 轮询模式买号失败：接码平台返回的手机号订单无效。');
  }
  await persistCurrentActivation(normalizedActivation);
  return normalizedActivation;
}
```

If `HERO_SMS_WATCH_BATCH_SIZE` is not visible inside this module, use `DEFAULT_PHONE_NUMBER_MAX_USES` only if it is already `3`; otherwise pass `watchBatchSize` through deps from `background.js`.

**Step 3: Export helper functions**

Add these to the returned helper object in `background/phone-verification-flow.js:6241-6256`:

```js
cancelPhoneActivation,
persistCurrentActivation,
prebuyHeroSmsActivationForWatch,
```

Then add `background.js` wrapper functions if helper methods are wrapped individually:

```js
async function prebuyHeroSmsActivationForWatch(state = {}) {
  return phoneVerificationHelpers.prebuyHeroSmsActivationForWatch(state);
}

async function cancelHeroSmsWatchActivation(state = {}, activation = null) {
  return phoneVerificationHelpers.cancelPhoneActivation(state, activation);
}
```

**Step 4: Run tests**

Run: `node --test tests/herosms-watch-mode.test.js`

Expected: PASS.

**Step 5: Checkpoint**

Do not commit unless explicitly requested.

---

### Task 3: Add persistent watcher state and status broadcast

**Files:**
- Modify: `background.js` default state around `DEFAULT_STATE` (`background.js:696-707`)
- Modify: persisted settings defaults (`background.js:526-530` area)
- Modify: `sidepanel/sidepanel.js` state sync areas (`sidepanel/sidepanel.js:845-866`, `sidepanel/sidepanel.js:1850-1871`, `sidepanel/sidepanel.js:11471-11729`)
- Test: `tests/herosms-watch-mode.test.js`

**Step 1: Add failing test for state keys**

Append:

```js
assert.match(source, /heroSmsWatchEnabled/);
assert.match(source, /heroSmsWatchPhase/);
assert.match(source, /heroSmsWatchCompletedRuns/);
assert.match(source, /HERO_SMS_WATCH_STATUS/);
```

Expected: FAIL.

**Step 2: Add defaults**

Add persisted/runtime state fields:

```js
heroSmsWatchEnabled: false,
heroSmsWatchIntervalSeconds: DEFAULT_HERO_SMS_WATCH_INTERVAL_SECONDS,
heroSmsWatchPhase: 'idle',
heroSmsWatchTargetRuns: 0,
heroSmsWatchEffectiveTotalRuns: 0,
heroSmsWatchCompletedRuns: 0,
heroSmsWatchCurrentBatchRun: 0,
heroSmsWatchActivation: null,
heroSmsWatchLastError: '',
heroSmsWatchNextPollAt: null,
```

Add normalizing in `normalizeSettingValue` for `heroSmsWatchEnabled` and `heroSmsWatchIntervalSeconds`.

**Step 3: Add broadcast helper**

Implement in `background.js` near `broadcastAutoRunStatus`:

```js
async function broadcastHeroSmsWatchStatus(phase, payload = {}, extraState = {}) {
  const statusPayload = {
    phase,
    targetRuns: payload.targetRuns ?? 0,
    effectiveTotalRuns: payload.effectiveTotalRuns ?? 0,
    completedRuns: payload.completedRuns ?? 0,
    currentBatchRun: payload.currentBatchRun ?? 0,
    nextPollAt: payload.nextPollAt ?? null,
    activation: payload.activation ?? null,
    lastError: payload.lastError === undefined ? '' : String(payload.lastError || ''),
  };
  await setState({
    ...extraState,
    heroSmsWatchPhase: phase,
    heroSmsWatchTargetRuns: statusPayload.targetRuns,
    heroSmsWatchEffectiveTotalRuns: statusPayload.effectiveTotalRuns,
    heroSmsWatchCompletedRuns: statusPayload.completedRuns,
    heroSmsWatchCurrentBatchRun: statusPayload.currentBatchRun,
    heroSmsWatchNextPollAt: statusPayload.nextPollAt,
    heroSmsWatchActivation: statusPayload.activation,
    heroSmsWatchLastError: statusPayload.lastError,
  });
  chrome.runtime.sendMessage({
    type: 'HERO_SMS_WATCH_STATUS',
    payload: statusPayload,
  }).catch(() => {});
}
```

**Step 4: Run tests**

Run: `node --test tests/herosms-watch-mode.test.js`

Expected: PASS.

---

### Task 4: Implement watcher state machine in background

**Files:**
- Modify: `background.js` near auto-run flow (`background.js:9410+`)
- Modify: `background/auto-run-controller.js:520-623` only if a hook is needed for batch failure cleanup
- Test: `tests/herosms-watch-mode.test.js`

**Step 1: Add failing source assertions**

Append:

```js
assert.match(source, /startHeroSmsWatchAutoRun/);
assert.match(source, /stopHeroSmsWatchAutoRun/);
assert.match(source, /runHeroSmsWatchPollOnce/);
assert.match(source, /startAutoRunLoop\(batchSize/);
```

Expected: FAIL.

**Step 2: Add in-memory guard fields**

Near auto-run globals:

```js
let heroSmsWatchActive = false;
let heroSmsWatchTimer = null;
let heroSmsWatchPollRunning = false;
let heroSmsWatchSessionId = 0;
```

**Step 3: Add start function**

Implement:

```js
async function startHeroSmsWatchAutoRun(totalRuns, options = {}) {
  const state = await getState();
  if (heroSmsWatchActive || isAutoRunLockedState(state) || isAutoRunPausedState(state) || autoRunActive) {
    throw new Error('HeroSMS 轮询或自动运行已在进行中，请先停止后再启动。');
  }
  if (normalizePhoneSmsProvider(state.phoneSmsProvider) !== PHONE_SMS_PROVIDER_HERO) {
    throw new Error('HeroSMS 轮询模式要求当前接码平台选择 HeroSMS。');
  }
  const effectiveTotalRuns = resolveHeroSmsWatchEffectiveTotalRuns(totalRuns);
  const intervalSeconds = normalizeHeroSmsWatchIntervalSeconds(options.intervalSeconds ?? state.heroSmsWatchIntervalSeconds);
  heroSmsWatchActive = true;
  heroSmsWatchSessionId = createAutoRunSessionId();
  await setPersistentSettings({
    heroSmsWatchEnabled: true,
    heroSmsWatchIntervalSeconds: intervalSeconds,
  });
  await broadcastHeroSmsWatchStatus('polling', {
    targetRuns: Math.max(1, Math.floor(Number(totalRuns) || 1)),
    effectiveTotalRuns,
    completedRuns: 0,
    currentBatchRun: 0,
    nextPollAt: Date.now(),
  }, {
    heroSmsWatchEnabled: true,
    heroSmsWatchIntervalSeconds: intervalSeconds,
  });
  await addLog(`HeroSMS 轮询模式已启动：目标 ${totalRuns} 轮，按 3 次复用向上取整后实际执行 ${effectiveTotalRuns} 轮。`, 'info');
  runHeroSmsWatchPollOnce({ immediate: true }).catch(() => {});
  return { ok: true, effectiveTotalRuns };
}
```

**Step 4: Add poll function**

Implement:

```js
async function runHeroSmsWatchPollOnce() {
  if (!heroSmsWatchActive || heroSmsWatchPollRunning) return false;
  heroSmsWatchPollRunning = true;
  try {
    const state = await getState();
    if (!state.heroSmsWatchEnabled) return false;
    const completedRuns = Math.max(0, Number(state.heroSmsWatchCompletedRuns) || 0);
    const effectiveTotalRuns = resolveHeroSmsWatchEffectiveTotalRuns(state.heroSmsWatchEffectiveTotalRuns || state.heroSmsWatchTargetRuns);
    const batchSize = resolveHeroSmsWatchNextBatchSize(completedRuns, effectiveTotalRuns);
    if (batchSize <= 0) {
      await stopHeroSmsWatchAutoRun({ logMessage: 'HeroSMS 轮询模式已达到实际执行轮数。' });
      return true;
    }
    await broadcastHeroSmsWatchStatus('buying', { ...state, completedRuns, effectiveTotalRuns });
    const activation = await prebuyHeroSmsActivationForWatch(state);
    await addLog(`HeroSMS 轮询模式已购买号码 ${activation.phoneNumber}，开始 3 轮复用批次。`, 'ok');
    await broadcastHeroSmsWatchStatus('running_batch', {
      targetRuns: state.heroSmsWatchTargetRuns,
      effectiveTotalRuns,
      completedRuns,
      currentBatchRun: 0,
      activation,
    });
    startAutoRunLoop(batchSize, {
      autoRunSessionId: heroSmsWatchSessionId,
      autoRunSkipFailures: false,
      mode: 'restart',
      heroSmsWatchBatch: true,
    });
    return true;
  } catch (error) {
    const intervalSeconds = normalizeHeroSmsWatchIntervalSeconds((await getState()).heroSmsWatchIntervalSeconds);
    const nextPollAt = Date.now() + intervalSeconds * 1000;
    await broadcastHeroSmsWatchStatus('polling', { lastError: error.message, nextPollAt });
    heroSmsWatchTimer = setTimeout(() => runHeroSmsWatchPollOnce().catch(() => {}), intervalSeconds * 1000);
    await addLog(`HeroSMS 轮询暂未买到可用号码：${error.message}，${intervalSeconds} 秒后重试。`, 'warn');
    return false;
  } finally {
    heroSmsWatchPollRunning = false;
  }
}
```

**Step 5: Add stop function**

Implement:

```js
async function stopHeroSmsWatchAutoRun(options = {}) {
  heroSmsWatchActive = false;
  if (heroSmsWatchTimer) {
    clearTimeout(heroSmsWatchTimer);
    heroSmsWatchTimer = null;
  }
  const state = await getState();
  const activation = normalizePhoneActivation(state.heroSmsWatchActivation || state.currentPhoneActivation);
  if (activation && options.cancelActivation) {
    await cancelHeroSmsWatchActivation(state, activation).catch((error) => addLog(`HeroSMS 轮询模式释放号码失败：${error.message}`, 'warn'));
  }
  await broadcastHeroSmsWatchStatus('idle', {
    targetRuns: state.heroSmsWatchTargetRuns,
    effectiveTotalRuns: state.heroSmsWatchEffectiveTotalRuns,
    completedRuns: state.heroSmsWatchCompletedRuns,
  }, {
    heroSmsWatchEnabled: false,
    heroSmsWatchActivation: null,
  });
  if (options.logMessage !== false) {
    await addLog(options.logMessage || 'HeroSMS 轮询模式已停止。', 'warn');
  }
  return { ok: true };
}
```

Use the existing `normalizeActivation` helper if `normalizePhoneActivation` does not exist globally.

**Step 6: Run tests**

Run: `node --test tests/herosms-watch-mode.test.js`

Expected: PASS.

---

### Task 5: Connect watcher to auto-run batch completion/failure

**Files:**
- Modify: `background/auto-run-controller.js:380-700` around round success/failure handling
- Modify: auto-run controller dependency wiring in `background.js` where `createAutoRunController` is called
- Test: Add/extend `tests/herosms-watch-mode.test.js`

**Step 1: Add callbacks to controller deps**

In `createAutoRunController(deps)`, destructure optional callbacks:

```js
onHeroSmsWatchBatchRoundSuccess,
onHeroSmsWatchBatchFailed,
onHeroSmsWatchBatchComplete,
```

**Step 2: Call success callback after each successful round**

Where a round is marked `success`, add:

```js
if (options?.heroSmsWatchBatch && typeof onHeroSmsWatchBatchRoundSuccess === 'function') {
  await onHeroSmsWatchBatchRoundSuccess({ currentRun: targetRun, totalRuns });
}
```

**Step 3: Call failure callback before abandoning the batch**

In each final-failure branch, add one shared call:

```js
if (options?.heroSmsWatchBatch && typeof onHeroSmsWatchBatchFailed === 'function') {
  await onHeroSmsWatchBatchFailed(err, { currentRun: targetRun, totalRuns });
}
```

Avoid duplicating by creating a small local `notifyHeroSmsWatchBatchFailed(err)` helper inside `startAutoRunLoop`.

**Step 4: Call complete callback when batch finishes all 3 rounds**

At normal loop completion, add:

```js
if (options?.heroSmsWatchBatch && typeof onHeroSmsWatchBatchComplete === 'function') {
  await onHeroSmsWatchBatchComplete({ totalRuns });
}
```

**Step 5: Implement background callbacks**

In `background.js`:

```js
async function handleHeroSmsWatchBatchRoundSuccess() {
  const state = await getState();
  const completedRuns = Math.max(0, Number(state.heroSmsWatchCompletedRuns) || 0) + 1;
  const currentBatchRun = Math.max(0, Number(state.heroSmsWatchCurrentBatchRun) || 0) + 1;
  await broadcastHeroSmsWatchStatus('running_batch', {
    targetRuns: state.heroSmsWatchTargetRuns,
    effectiveTotalRuns: state.heroSmsWatchEffectiveTotalRuns,
    completedRuns,
    currentBatchRun,
    activation: state.heroSmsWatchActivation,
  });
}

async function handleHeroSmsWatchBatchFailed(error) {
  const state = await getState();
  const activation = normalizeActivation(state.heroSmsWatchActivation || state.currentPhoneActivation);
  if (activation) {
    await cancelHeroSmsWatchActivation(state, activation).catch((cancelError) => addLog(`HeroSMS 轮询模式放弃号码失败：${cancelError.message}`, 'warn'));
  }
  await setState({ currentPhoneActivation: null, heroSmsWatchActivation: null });
  const intervalSeconds = normalizeHeroSmsWatchIntervalSeconds(state.heroSmsWatchIntervalSeconds);
  const nextPollAt = Date.now() + intervalSeconds * 1000;
  await broadcastHeroSmsWatchStatus('polling', {
    targetRuns: state.heroSmsWatchTargetRuns,
    effectiveTotalRuns: state.heroSmsWatchEffectiveTotalRuns,
    completedRuns: state.heroSmsWatchCompletedRuns,
    currentBatchRun: 0,
    nextPollAt,
    lastError: error?.message || String(error || '批次失败'),
  });
  heroSmsWatchTimer = setTimeout(() => runHeroSmsWatchPollOnce().catch(() => {}), intervalSeconds * 1000);
}

async function handleHeroSmsWatchBatchComplete() {
  const state = await getState();
  if (state.heroSmsWatchCompletedRuns >= state.heroSmsWatchEffectiveTotalRuns) {
    await stopHeroSmsWatchAutoRun({ logMessage: 'HeroSMS 轮询模式已完成全部实际轮数。' });
    return;
  }
  const intervalSeconds = normalizeHeroSmsWatchIntervalSeconds(state.heroSmsWatchIntervalSeconds);
  const nextPollAt = Date.now() + intervalSeconds * 1000;
  await broadcastHeroSmsWatchStatus('polling', {
    targetRuns: state.heroSmsWatchTargetRuns,
    effectiveTotalRuns: state.heroSmsWatchEffectiveTotalRuns,
    completedRuns: state.heroSmsWatchCompletedRuns,
    currentBatchRun: 0,
    nextPollAt,
  });
  heroSmsWatchTimer = setTimeout(() => runHeroSmsWatchPollOnce().catch(() => {}), intervalSeconds * 1000);
}
```

**Step 6: Wire dependencies**

Pass callbacks into `createAutoRunController` in `background.js`.

**Step 7: Run targeted and full tests**

Run:

```bash
node --test tests/herosms-watch-mode.test.js
npm test
```

Expected: all PASS.

---

### Task 6: Add background message API

**Files:**
- Modify: `background.js:7584+` message router
- Modify: `sidepanel/sidepanel.js:9599-9604`
- Test: `tests/herosms-watch-mode.test.js`

**Step 1: Add failing source assertions**

Append:

```js
assert.match(source, /START_HERO_SMS_WATCH_AUTO_RUN/);
assert.match(source, /STOP_HERO_SMS_WATCH_AUTO_RUN/);
```

Expected: FAIL.

**Step 2: Add message cases**

In `chrome.runtime.onMessage.addListener`:

```js
if (message.type === 'START_HERO_SMS_WATCH_AUTO_RUN') {
  startHeroSmsWatchAutoRun(message.payload?.totalRuns, {
    intervalSeconds: message.payload?.intervalSeconds,
  }).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
  return true;
}

if (message.type === 'STOP_HERO_SMS_WATCH_AUTO_RUN') {
  stopHeroSmsWatchAutoRun({ cancelActivation: true }).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
  return true;
}
```

**Step 3: Run tests**

Run: `node --test tests/herosms-watch-mode.test.js`

Expected: PASS.

---

### Task 7: Add sidepanel controls and status text

**Files:**
- Modify: `sidepanel/sidepanel.html` near header run controls (`sidepanel/sidepanel.html:35-45`) or auto-run settings block if one exists lower in the file
- Modify: `sidepanel/sidepanel.js` selectors near existing DOM constants (`sidepanel/sidepanel.js:300-380`)
- Modify: `sidepanel/sidepanel.js` save payload (`sidepanel/sidepanel.js:2912-2938`)
- Modify: `sidepanel/sidepanel.js` auto-run button flow (`sidepanel/sidepanel.js:9545-9604`)
- Modify: `sidepanel/sidepanel.css` near run/status styles

**Step 1: Add HTML controls**

Add a checkbox and interval input in the auto-run settings area:

```html
<label class="data-checkbox-row" title="开启后会等待 HeroSMS 有可购买号码，买到后每个号码固定跑 3 轮">
  <input type="checkbox" id="input-hero-sms-watch-enabled" />
  <span>HeroSMS 有号再自动</span>
</label>
<div class="data-row" id="row-hero-sms-watch-interval">
  <span class="data-label">查号间隔</span>
  <input type="number" id="input-hero-sms-watch-interval" class="data-input mono" value="30" min="5" max="3600" step="1" />
</div>
<p id="hero-sms-watch-hint" class="field-hint">轮询模式会按手机号 3 次复用向上取整。</p>
```

**Step 2: Add JS selectors/state**

Add constants:

```js
const inputHeroSmsWatchEnabled = document.getElementById('input-hero-sms-watch-enabled');
const inputHeroSmsWatchInterval = document.getElementById('input-hero-sms-watch-interval');
const heroSmsWatchHint = document.getElementById('hero-sms-watch-hint');
```

Add current state fields mirroring background payload.

**Step 3: Save settings**

Add to save payload:

```js
heroSmsWatchEnabled: Boolean(inputHeroSmsWatchEnabled?.checked),
heroSmsWatchIntervalSeconds: normalizeHeroSmsWatchIntervalSeconds(inputHeroSmsWatchInterval?.value),
```

Add sidepanel copy of the interval/effective-total helpers or use simple local equivalents.

**Step 4: Change auto button flow**

Before sending `AUTO_RUN` / `SCHEDULE_AUTO_RUN`, if `inputHeroSmsWatchEnabled.checked` is true:

```js
const effectiveTotalRuns = resolveHeroSmsWatchEffectiveTotalRuns(totalRuns);
// update hint/toast with actual runs
const response = await chrome.runtime.sendMessage({
  type: 'START_HERO_SMS_WATCH_AUTO_RUN',
  source: 'sidepanel',
  payload: {
    totalRuns,
    intervalSeconds: inputHeroSmsWatchInterval.value,
  },
});
```

Disable scheduled auto-run delay when watch mode is selected; watch mode owns waiting.

**Step 5: Handle status messages**

In runtime message listener, add:

```js
if (message.type === 'HERO_SMS_WATCH_STATUS') {
  syncLatestState({
    heroSmsWatchPhase: message.payload.phase,
    heroSmsWatchTargetRuns: message.payload.targetRuns,
    heroSmsWatchEffectiveTotalRuns: message.payload.effectiveTotalRuns,
    heroSmsWatchCompletedRuns: message.payload.completedRuns,
    heroSmsWatchCurrentBatchRun: message.payload.currentBatchRun,
    heroSmsWatchNextPollAt: message.payload.nextPollAt,
    heroSmsWatchLastError: message.payload.lastError,
  });
  updateHeroSmsWatchHint();
}
```

The hint should show: `轮询模式：用户目标 X 轮，实际执行 Y 轮；当前完成 A/Y。`

**Step 6: Manual test in browser**

Load the extension in Chrome, open sidepanel, enable HeroSMS watch mode, set run count `1`, verify hint says actual `3`; set run count `4`, verify actual `6`.

---

### Task 8: Restore watcher on extension startup and alarms/timers

**Files:**
- Modify: `background.js` startup/init area where `restoreAutoRunTimerIfNeeded()` is called
- Test: `tests/herosms-watch-mode.test.js`

**Step 1: Add restore helper**

Implement:

```js
async function restoreHeroSmsWatchIfNeeded() {
  const state = await getState();
  if (!state.heroSmsWatchEnabled) {
    return false;
  }
  if (state.heroSmsWatchCompletedRuns >= state.heroSmsWatchEffectiveTotalRuns) {
    await stopHeroSmsWatchAutoRun({ logMessage: false });
    return false;
  }
  heroSmsWatchActive = true;
  const intervalSeconds = normalizeHeroSmsWatchIntervalSeconds(state.heroSmsWatchIntervalSeconds);
  const nextPollAt = Number(state.heroSmsWatchNextPollAt) || Date.now() + intervalSeconds * 1000;
  const delayMs = Math.max(0, nextPollAt - Date.now());
  heroSmsWatchTimer = setTimeout(() => runHeroSmsWatchPollOnce().catch(() => {}), delayMs);
  await broadcastHeroSmsWatchStatus('polling', {
    targetRuns: state.heroSmsWatchTargetRuns,
    effectiveTotalRuns: state.heroSmsWatchEffectiveTotalRuns,
    completedRuns: state.heroSmsWatchCompletedRuns,
    currentBatchRun: 0,
    nextPollAt,
  });
  return true;
}
```

**Step 2: Call restore at startup**

Where existing startup restore functions run, call:

```js
restoreHeroSmsWatchIfNeeded().catch((error) => addLog(`HeroSMS 轮询模式恢复失败：${error.message}`, 'warn'));
```

**Step 3: Run tests**

Run:

```bash
node --test tests/herosms-watch-mode.test.js
npm test
```

Expected: PASS.

---

### Task 9: Verification and manual QA

**Files:**
- No new files unless fixing defects.

**Step 1: Run automated tests**

Run:

```bash
npm test
```

Expected: all tests pass.

**Step 2: Browser smoke test**

Start/load extension manually in Chrome developer mode:

1. Open sidepanel.
2. Select HeroSMS as SMS provider.
3. Enable watch mode.
4. Set run count to `1`; verify UI says actual `3`.
5. Set run count to `4`; verify UI says actual `6`.
6. Start watch mode with a test HeroSMS API key if available.
7. Confirm logs show: polling → buying → purchased number → running 3-round batch.
8. Stop during polling and confirm state returns to idle.

**Step 3: Failure-path checks**

1. Use an invalid HeroSMS API key.
2. Start watch mode.
3. Confirm it logs the error and schedules the next poll instead of starting registration.
4. Stop watch mode.

**Step 4: Final review**

Use `superpowers:requesting-code-review` before claiming complete.

---

## Implementation notes

- Do not include `.idea/` in any staging or commit.
- Do not create a git commit unless the user explicitly asks for one.
- Prefer direct reuse of existing HeroSMS price plan and activation functions; do not duplicate HeroSMS API parsing.
- Keep normal `AUTO_RUN` and `SCHEDULE_AUTO_RUN` behavior unchanged.
- If implementation reveals `DEFAULT_PHONE_NUMBER_MAX_USES` is already the canonical 3-use limit, prefer using that constant instead of adding another hidden copy.
