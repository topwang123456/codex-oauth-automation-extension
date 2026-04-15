const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractFunction(name) {
  const markers = [`function ${name}(`, `async function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);

  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

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

const runContextMatch = source.match(/runContext:\s*\{[\s\S]*?\n\s*\}/);
if (!runContextMatch) {
  throw new Error('missing DEFAULT_STATE.runContext');
}

const createEmptyRunContextSource = extractFunction('createEmptyRunContext');
const resetRunContextSource = extractFunction('resetRunContext');

const api = new Function(`
const DEFAULT_RUN_CONTEXT = ${runContextMatch[0].replace(/^runContext:\s*/, '')};
${createEmptyRunContextSource}
${resetRunContextSource}
return { DEFAULT_RUN_CONTEXT, createEmptyRunContext, resetRunContext };
`)();

assert.deepStrictEqual(api.DEFAULT_RUN_CONTEXT, {
  incognitoWindowId: null,
  chatgptTabId: null,
  cpaTabId: null,
  oauthTabId: null,
}, 'DEFAULT_STATE 应包含空的 runContext');

assert.deepStrictEqual(api.createEmptyRunContext(), {
  incognitoWindowId: null,
  chatgptTabId: null,
  cpaTabId: null,
  oauthTabId: null,
}, 'createEmptyRunContext 应返回全空上下文');

const resetResult = api.resetRunContext({
  incognitoWindowId: 11,
  chatgptTabId: 22,
  cpaTabId: 33,
  oauthTabId: 44,
});
assert.deepStrictEqual(resetResult, {
  incognitoWindowId: null,
  chatgptTabId: null,
  cpaTabId: null,
  oauthTabId: null,
}, 'resetRunContext 应清空全部运行上下文');

assert.notStrictEqual(resetResult, api.DEFAULT_RUN_CONTEXT, 'resetRunContext 应返回新对象而不是复用常量引用');

console.log('background incognito run context tests passed');
