const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('background.js', 'utf8');
const routerSource = fs.readFileSync('background/message-router.js', 'utf8');
const sidepanelSource = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');
const sidepanelHtml = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing function ${name}`);

  const paramsEnd = source.indexOf(')', start);
  const braceStart = source.indexOf('{', paramsEnd);
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
  extractFunction('resolveHeroSmsWatchCompletedRuns'),
].join('\n');

const api = new Function(`${bundle}; return { normalizeHeroSmsWatchIntervalSeconds, resolveHeroSmsWatchEffectiveTotalRuns, resolveHeroSmsWatchNextBatchSize, resolveHeroSmsWatchCompletedRuns };`)();

assert.strictEqual(api.resolveHeroSmsWatchEffectiveTotalRuns(1), 3);
assert.strictEqual(api.resolveHeroSmsWatchEffectiveTotalRuns(2), 3);
assert.strictEqual(api.resolveHeroSmsWatchEffectiveTotalRuns(3), 3);
assert.strictEqual(api.resolveHeroSmsWatchEffectiveTotalRuns(4), 6);
assert.strictEqual(api.resolveHeroSmsWatchEffectiveTotalRuns(7), 9);
assert.strictEqual(api.resolveHeroSmsWatchNextBatchSize(0, 3), 3);
assert.strictEqual(api.resolveHeroSmsWatchNextBatchSize(3, 6), 3);
assert.strictEqual(api.resolveHeroSmsWatchNextBatchSize(6, 6), 0);
assert.strictEqual(api.resolveHeroSmsWatchCompletedRuns(0, 0, 3, 3), 3);
assert.strictEqual(api.resolveHeroSmsWatchCompletedRuns(3, 3, 3, 6), 6);
assert.strictEqual(api.resolveHeroSmsWatchCompletedRuns(5, 3, 1, 9), 5);
assert.strictEqual(api.resolveHeroSmsWatchCompletedRuns(6, 6, 3, 7), 9);
assert.strictEqual(api.normalizeHeroSmsWatchIntervalSeconds(''), 30);
assert.strictEqual(api.normalizeHeroSmsWatchIntervalSeconds(1), 5);
assert.strictEqual(api.normalizeHeroSmsWatchIntervalSeconds(99999), 3600);

assert.match(source, /prebuyHeroSmsActivationForWatch/);
assert.match(source, /cancelPhoneActivation/);
assert.match(source, /persistCurrentActivation/);
assert.match(source, /heroSmsWatchEnabled/);
assert.match(source, /heroSmsWatchPhase/);
assert.match(source, /heroSmsWatchCompletedRuns/);
assert.match(source, /HERO_SMS_WATCH_STATUS/);
assert.match(source, /startHeroSmsWatchAutoRun/);
assert.match(source, /stopHeroSmsWatchAutoRun/);
assert.match(source, /runHeroSmsWatchPollOnce/);
assert.match(source, /startAutoRunLoop\(batchSize/);
assert.match(source, /handleHeroSmsWatchBatchRoundSuccess/);
assert.match(source, /handleHeroSmsWatchBatchFailed/);
assert.match(source, /handleHeroSmsWatchBatchComplete/);
assert.match(routerSource, /START_HERO_SMS_WATCH_AUTO_RUN/);
assert.match(routerSource, /STOP_HERO_SMS_WATCH_AUTO_RUN/);
assert.match(routerSource, /startHeroSmsWatchAutoRun/);
assert.match(routerSource, /stopHeroSmsWatchAutoRun/);
assert.match(sidepanelHtml, /input-hero-sms-watch-enabled/);
assert.match(sidepanelHtml, /input-hero-sms-watch-interval-seconds/);
assert.match(sidepanelHtml, /display-hero-sms-watch-effective-runs/);
assert.match(sidepanelSource, /inputHeroSmsWatchEnabled/);
assert.match(sidepanelSource, /inputHeroSmsWatchIntervalSeconds/);
assert.match(sidepanelSource, /renderHeroSmsWatchStatus/);
assert.match(sidepanelSource, /START_HERO_SMS_WATCH_AUTO_RUN/);
assert.match(sidepanelSource, /STOP_HERO_SMS_WATCH_AUTO_RUN/);
assert.match(source, /restoreHeroSmsWatchIfNeeded/);
assert.match(source, /heroSmsWatchEnabled[\s\S]*restoreHeroSmsWatchIfNeeded/);
assert.match(source, /heroSmsWatchBatchCompletedRuns/);
assert.match(extractFunction('handleHeroSmsWatchBatchComplete'), /heroSmsWatchBatchCompletedRuns[\s\S]*successfulRuns[\s\S]*completedRuns/);
assert.match(extractFunction('handleHeroSmsWatchBatchComplete'), /stopHeroSmsWatchAutoRun\(\{[\s\S]*completedRuns/);
assert.match(extractFunction('stopHeroSmsWatchAutoRun'), /completedRuns: options\.completedRuns \?\? state\.heroSmsWatchCompletedRuns/);
assert.match(source, /function isCurrentHeroSmsWatchBatchPayload/);
assert.match(extractFunction('handleHeroSmsWatchBatchFailed'), /isCurrentHeroSmsWatchBatchPayload\(payload\)/);
assert.match(extractFunction('handleHeroSmsWatchBatchComplete'), /isCurrentHeroSmsWatchBatchPayload\(payload\)/);
assert.match(extractFunction('handleHeroSmsWatchBatchRoundSuccess'), /isCurrentHeroSmsWatchBatchPayload\(payload\)/);
assert.match(extractFunction('stopHeroSmsWatchAutoRun'), /heroSmsWatchSessionId = createAutoRunSessionId\(\)/);
assert.match(extractFunction('stopHeroSmsWatchAutoRun'), /if \(!options\.preserveActivation\) \{[\s\S]*persistHeroSmsWatchCurrentActivation\(null\)/);
assert.match(extractFunction('stopHeroSmsWatchAutoRun'), /heroSmsWatchActivation: options\.preserveActivation \? activation : null/);
assert.match(routerSource, /case 'STOP_HERO_SMS_WATCH_AUTO_RUN':[\s\S]*requestStop[\s\S]*stopHeroSmsWatchAutoRun\(\{ preserveActivation: true \}\)/);
assert.doesNotMatch(routerSource, /STOP_HERO_SMS_WATCH_AUTO_RUN[\s\S]{0,400}cancelActivation: true/);

console.log('herosms watch mode tests passed');
