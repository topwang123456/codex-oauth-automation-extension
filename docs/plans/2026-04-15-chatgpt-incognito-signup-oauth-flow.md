# ChatGPT Incognito Signup OAuth Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current "fetch CPA OAuth link first" flow with an incognito-first flow that signs up on chatgpt.com, completes onboarding, then opens CPA and performs authorization in the same incognito session.

**Architecture:** Keep the existing 1~9 step orchestrator in `background.js`, but redefine step meanings and add a run-scoped incognito window context. Reuse the existing mailbox polling and verification-code infrastructure where possible, while extending `content/signup-page.js` from an auth-page helper into a broader registration/onboarding state machine for `chatgpt.com` and related auth surfaces. Failures during registration, onboarding, or OAuth handoff should reset the whole run by closing the incognito window and restarting from step 1.

**Tech Stack:** Chrome Extension Manifest V3, background service worker, content scripts, `chrome.tabs`/`chrome.windows`/`chrome.storage`, Node built-in test runner (`node --test`)

---

### Task 1: Update manifest coverage for ChatGPT surfaces and incognito assumptions

**Files:**
- Modify: `manifest.json`
- Modify: `README.md`
- Test: `tests/` (manual verification notes only for manifest behavior)

**Step 1: Write the failing test**

There is no reliable automated test for manifest host coverage in the current suite, so capture the expected behavior in the plan before editing:

```text
Expected after change:
- content script coverage includes chatgpt.com registration/onboarding surfaces
- README mentions that the extension must be enabled in Chrome incognito mode
```

**Step 2: Inspect current coverage and verify the gap**

Run: `node --test tests/*.test.js`
Expected: current tests still pass, but no test protects `chatgpt.com` host coverage or incognito prerequisites.

**Step 3: Write minimal implementation**

Update `manifest.json` so the auth/signup content script can run on the ChatGPT pages required by the new flow, while preserving the existing OpenAI auth hosts. Update `README.md` to state that users must enable the extension in incognito mode before using the new flow.

Example target shape:

```json
{
  "content_scripts": [
    {
      "matches": [
        "https://chatgpt.com/*",
        "https://auth0.openai.com/*",
        "https://auth.openai.com/*",
        "https://accounts.openai.com/*"
      ]
    }
  ]
}
```

**Step 4: Run verification**

Run: `node --test tests/*.test.js`
Expected: PASS (manifest change should not break existing logic tests).

**Step 5: Commit**

```bash
git add manifest.json README.md
git commit -m "feat: support incognito chatgpt signup entry"
```

### Task 2: Add run-scoped incognito window context to the orchestrator

**Files:**
- Modify: `background.js`
- Test: `tests/background-incognito-run-context.test.js`

**Step 1: Write the failing test**

Create a focused test that extracts the new helper functions from `background.js` and asserts the run context resets correctly.

```js
assert.deepStrictEqual(createEmptyRunContext(), {
  incognitoWindowId: null,
  chatgptTabId: null,
  cpaTabId: null,
  oauthTabId: null,
});

assert.deepStrictEqual(resetRunContext({ incognitoWindowId: 12 }).incognitoWindowId, null);
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/background-incognito-run-context.test.js`
Expected: FAIL with missing helper functions or missing run-context state.

**Step 3: Write minimal implementation**

Add a `runContext` object to `DEFAULT_STATE` in `background.js` and implement helpers to:
- create/reset the run context
- persist current incognito window/tab IDs in session state
- clear the run context when a run is aborted or finished

Target shape:

```js
runContext: {
  incognitoWindowId: null,
  chatgptTabId: null,
  cpaTabId: null,
  oauthTabId: null,
}
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/background-incognito-run-context.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add background.js tests/background-incognito-run-context.test.js
git commit -m "feat: track incognito run context"
```

### Task 3: Create and validate the incognito window bootstrap flow

**Files:**
- Modify: `background.js`
- Test: `tests/background-incognito-bootstrap.test.js`

**Step 1: Write the failing test**

Add a test for helpers that:
- check whether the extension is allowed in incognito mode
- normalize a newly created incognito window/tab result into `runContext`
- throw a clear error if incognito is unavailable

```js
assert.throws(() => ensureIncognitoAllowed(false), /incognito/i);
assert.equal(normalizeIncognitoBootstrapResult({ id: 99 }, { id: 201 }).incognitoWindowId, 99);
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/background-incognito-bootstrap.test.js`
Expected: FAIL because the helpers do not exist yet.

**Step 3: Write minimal implementation**

Implement a Step 1 bootstrap path in `background.js` that:
- checks incognito availability before starting a run
- creates a fresh incognito window for each run
- opens `https://chatgpt.com/` inside that window
- stores the window/tab IDs in `runContext`

Do not yet rewrite the whole auto flow here; just make the bootstrap path deterministic and reusable.

**Step 4: Run test to verify it passes**

Run: `node --test tests/background-incognito-bootstrap.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add background.js tests/background-incognito-bootstrap.test.js
git commit -m "feat: bootstrap runs in incognito window"
```

### Task 4: Redefine steps 1 and 2 for ChatGPT registration entry

**Files:**
- Modify: `background.js`
- Modify: `content/signup-page.js`
- Test: `tests/signup-chatgpt-entry-state.test.js`

**Step 1: Write the failing test**

Add a content-script-oriented test for small pure helpers that identify a registration entry surface and determine whether a visible signup/register CTA exists.

```js
assert.equal(isChatGptHomeUrl('https://chatgpt.com/'), true);
assert.equal(isRegistrationEntryActionText('Sign up'), true);
assert.equal(isRegistrationEntryActionText('Log in'), false);
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/signup-chatgpt-entry-state.test.js`
Expected: FAIL with missing helper functions.

**Step 3: Write minimal implementation**

Refactor Step 1/2 orchestration so:
- Step 1 ensures the incognito window exists and focuses the ChatGPT start tab
- Step 2 finds and clicks the registration entry CTA from `chatgpt.com`
- the old CPA link-fetch behavior is removed from Step 1

In `content/signup-page.js`, add lightweight helpers for identifying ChatGPT registration entry pages before implementing the full onboarding state machine.

**Step 4: Run test to verify it passes**

Run: `node --test tests/signup-chatgpt-entry-state.test.js && node --test tests/*.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add background.js content/signup-page.js tests/signup-chatgpt-entry-state.test.js
git commit -m "feat: start flow from chatgpt signup entry"
```

### Task 5: Reuse the existing signup email/password path for the new registration flow

**Files:**
- Modify: `background.js`
- Modify: `content/signup-page.js`
- Test: `tests/signup-registration-state.test.js`

**Step 1: Write the failing test**

Add tests for helpers that classify registration pages more precisely:

```js
assert.equal(getRegistrationStateLabel({ state: 'email_page' }), '邮箱输入页');
assert.equal(getRegistrationStateLabel({ state: 'password_page' }), '密码页');
assert.equal(getRegistrationStateLabel({ state: 'verification_page' }), '注册验证码页');
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/signup-registration-state.test.js`
Expected: FAIL because the registration-specific helpers do not exist.

**Step 3: Write minimal implementation**

Adjust the existing Step 3/4 path so it works when Step 2 starts from `chatgpt.com`, while preserving current email/password filling and verification-code filling behavior. The key change is to make state detection registration-oriented instead of assuming the old CPA-first path.

**Step 4: Run test to verify it passes**

Run: `node --test tests/signup-registration-state.test.js && node --test tests/*.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add background.js content/signup-page.js tests/signup-registration-state.test.js
git commit -m "feat: support chatgpt registration state handling"
```

### Task 6: Extend Step 5 to cover registration completion prerequisites

**Files:**
- Modify: `content/signup-page.js`
- Modify: `background.js`
- Test: `tests/signup-profile-completion-state.test.js`

**Step 1: Write the failing test**

Add helper-level tests for the page-state checks that distinguish:
- profile completion page
- add-phone page
- onboarding page

```js
assert.equal(isAddPhonePath('/add-phone'), true);
assert.equal(isOnboardingActionText('Get started'), true);
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/signup-profile-completion-state.test.js`
Expected: FAIL

**Step 3: Write minimal implementation**

Keep the existing `step5_fillNameBirthday(...)` logic, but update the post-submit outcome handling so Step 5 can hand off explicitly into onboarding rather than only Step 8 readiness. Treat add-phone or other unsupported blockers as hard failures for the run.

**Step 4: Run test to verify it passes**

Run: `node --test tests/signup-profile-completion-state.test.js && node --test tests/*.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add background.js content/signup-page.js tests/signup-profile-completion-state.test.js
git commit -m "feat: detect post-signup onboarding prerequisites"
```

### Task 7: Implement the onboarding state machine with fixed default answers

**Files:**
- Modify: `content/signup-page.js`
- Modify: `background.js`
- Test: `tests/signup-onboarding-state-machine.test.js`

**Step 1: Write the failing test**

Add tests for pure helpers that map visible onboarding cues to actions.

```js
assert.deepStrictEqual(resolveOnboardingAction({
  primaryButtonText: 'Continue',
  options: ['Personal', 'Work'],
}), {
  action: 'choose_option_then_continue',
  optionIndex: 0,
});

assert.equal(isChatGptHomeReady({ hasSidebar: true, hasComposer: true, blockingModal: false }), true);
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/signup-onboarding-state-machine.test.js`
Expected: FAIL with missing onboarding helpers.

**Step 3: Write minimal implementation**

Implement Step 6 as an onboarding loop that:
- inspects the current page for known onboarding states
- applies one hard-coded default-answer strategy
- advances until ChatGPT home is ready
- aborts on unsupported blockers

Keep the helper logic as pure as possible so it remains testable without a browser DOM.

**Step 4: Run test to verify it passes**

Run: `node --test tests/signup-onboarding-state-machine.test.js && node --test tests/*.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add background.js content/signup-page.js tests/signup-onboarding-state-machine.test.js
git commit -m "feat: complete chatgpt onboarding with defaults"
```

### Task 8: Move CPA OAuth link retrieval to the post-onboarding phase

**Files:**
- Modify: `background.js`
- Modify: `content/vps-panel.js`
- Test: `tests/post-onboarding-cpa-step-order.test.js`

**Step 1: Write the failing test**

Add a test for small ordering helpers that assert CPA retrieval is no longer treated as step 1, but as the first step after onboarding completion.

```js
assert.equal(getPostOnboardingStepOrder()[0], 7);
assert.equal(isCpaFetchStep(7), true);
assert.equal(isCpaFetchStep(1), false);
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/post-onboarding-cpa-step-order.test.js`
Expected: FAIL

**Step 3: Write minimal implementation**

Update background orchestration so Step 7 opens CPA inside the existing incognito window, fetches the OAuth link, and records the CPA tab ID in `runContext`. Keep `content/vps-panel.js` focused on the CPA page interactions; only the step timing changes.

**Step 4: Run test to verify it passes**

Run: `node --test tests/post-onboarding-cpa-step-order.test.js && node --test tests/*.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add background.js content/vps-panel.js tests/post-onboarding-cpa-step-order.test.js
git commit -m "feat: move cpa oauth fetch after onboarding"
```

### Task 9: Open the OAuth link in a new incognito tab and preserve session continuity

**Files:**
- Modify: `background.js`
- Modify: `content/signup-page.js`
- Test: `tests/incognito-oauth-tab-flow.test.js`

**Step 1: Write the failing test**

Add a helper-level test for opening/storing the OAuth authorization tab in the same incognito run context.

```js
const next = attachOauthTabToRunContext({ oauthTabId: null }, 321);
assert.equal(next.oauthTabId, 321);
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/incognito-oauth-tab-flow.test.js`
Expected: FAIL

**Step 3: Write minimal implementation**

Update Step 8 so it opens the OAuth URL in a new tab inside the existing incognito window, then reuses the existing consent/callback capture logic with the new `runContext.oauthTabId` instead of the old signup-tab assumption.

**Step 4: Run test to verify it passes**

Run: `node --test tests/incognito-oauth-tab-flow.test.js && node --test tests/*.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add background.js content/signup-page.js tests/incognito-oauth-tab-flow.test.js
git commit -m "feat: authorize oauth in incognito tab"
```

### Task 10: Reset the full incognito run on registration, onboarding, or OAuth failure

**Files:**
- Modify: `background.js`
- Test: `tests/incognito-run-restart.test.js`

**Step 1: Write the failing test**

Add a test for a helper that decides whether a failure requires closing the incognito window and restarting from step 1.

```js
assert.equal(shouldRestartWholeIncognitoRun({ step: 6, recoverable: false }), true);
assert.equal(shouldRestartWholeIncognitoRun({ step: 4, recoverable: true }), false);
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/incognito-run-restart.test.js`
Expected: FAIL

**Step 3: Write minimal implementation**

Implement run-reset helpers in `background.js` that:
- close the current incognito window when a hard failure occurs
- clear `runContext` and volatile step state for the attempt
- restart the round from Step 1 when auto-run is active

Preserve the existing retry-limit behavior while changing the retry unit from “current step only” to “whole incognito run” for registration/onboarding/OAuth failures.

**Step 4: Run test to verify it passes**

Run: `node --test tests/incognito-run-restart.test.js && node --test tests/*.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add background.js tests/incognito-run-restart.test.js
git commit -m "feat: restart full incognito run on hard failures"
```

### Task 11: Update documentation and manual verification checklist

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-04-15-chatgpt-incognito-signup-oauth-flow.md`

**Step 1: Write the failing test**

Use a manual checklist because the behavior spans browser UI and incognito mode:

```text
Checklist:
- Extension enabled for incognito mode
- Step 1 launches a fresh incognito window
- Step 6 reaches logged-in ChatGPT home without visible onboarding blockers
- Step 7 opens CPA in the same incognito window
- Step 8 opens OAuth in a new tab in that window
- hard failure closes the incognito window and restarts from step 1
```

**Step 2: Run verification to confirm the current docs are outdated**

Read `README.md` and confirm it still describes the old CPA-first flow.

**Step 3: Write minimal implementation**

Update `README.md` to describe the new step meanings, the incognito prerequisite, and the whole-run restart behavior. Keep this plan file updated if implementation decisions shift.

**Step 4: Run verification**

Run: `node --test tests/*.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add README.md docs/plans/2026-04-15-chatgpt-incognito-signup-oauth-flow.md
git commit -m "docs: describe incognito signup oauth flow"
```
