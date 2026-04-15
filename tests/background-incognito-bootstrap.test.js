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

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }

  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

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
  extractFunction('ensureIncognitoAllowed'),
  extractFunction('normalizeIncognitoBootstrapResult'),
].join('\n');

const api = new Function(`
${bundle}
return { ensureIncognitoAllowed, normalizeIncognitoBootstrapResult };
`)();

assert.throws(
  () => api.ensureIncognitoAllowed(false),
  /无痕|incognito/i,
  '未启用无痕时应抛出明确错误'
);

assert.doesNotThrow(
  () => api.ensureIncognitoAllowed(true),
  '已启用无痕时不应抛错'
);

assert.deepStrictEqual(
  api.normalizeIncognitoBootstrapResult({ id: 99 }, { id: 201 }),
  {
    incognitoWindowId: 99,
    chatgptTabId: 201,
    cpaTabId: null,
    oauthTabId: null,
  },
  '应把无痕窗口和初始 chatgpt 标签页归一为 runContext'
);

console.log('background incognito bootstrap tests passed');
