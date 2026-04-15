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
  extractFunction('getRegistrationStateLabel'),
].join('\n');

const api = new Function(`
${bundle}
return { getRegistrationStateLabel };
`)();

assert.equal(api.getRegistrationStateLabel({ state: 'email_page' }), '注册邮箱页', '注册邮箱态标签应明确');
assert.equal(api.getRegistrationStateLabel({ state: 'password_page' }), '注册密码页', '注册密码态标签应明确');
assert.equal(api.getRegistrationStateLabel({ state: 'verification_page' }), '注册验证码页', '注册验证码态标签应明确');
assert.equal(api.getRegistrationStateLabel({ state: 'unknown' }), '未知页面', '未知状态应回退到未知页面');

console.log('signup registration state tests passed');
