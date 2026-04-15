const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('content/signup-page.js', 'utf8');

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
  extractFunction('isChatGptHomeUrl'),
  extractFunction('isRegistrationEntryActionText'),
].join('\n');

const api = new Function(`
${bundle}
return { isChatGptHomeUrl, isRegistrationEntryActionText };
`)();

assert.equal(api.isChatGptHomeUrl('https://chatgpt.com/'), true, '应识别 chatgpt.com 首页');
assert.equal(api.isChatGptHomeUrl('https://chatgpt.com/?model=gpt-4o'), true, '应识别 chatgpt.com 首页带参数');
assert.equal(api.isChatGptHomeUrl('https://auth.openai.com/log-in'), false, '旧 auth 域名不应被当成 ChatGPT 首页');

assert.equal(api.isRegistrationEntryActionText('Sign up'), true, 'Sign up 应被视为注册入口');
assert.equal(api.isRegistrationEntryActionText('Create account'), true, 'Create account 应被视为注册入口');
assert.equal(api.isRegistrationEntryActionText('Log in'), false, 'Log in 不应被视为注册入口');

console.log('signup chatgpt entry state tests passed');
