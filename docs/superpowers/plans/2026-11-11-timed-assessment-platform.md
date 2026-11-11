# Timed Assessment Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free web page, served from a Google Sheet, where each student gets a server-enforced countdown that starts when they click Start and auto-submits when time runs out.

**Architecture:** Google Apps Script web app bound to the "EA Assessments" Sheet. All rules (timing, marking, attempt handling) live in plain JavaScript files that run unchanged both in Apps Script and in Node, so they are unit-tested locally with `node --test`. A thin Sheet adapter (`Store.js`) and entry points (`Main.js`) are verified against the real Sheet with a smoke test; the student page (`Index.html`) is verified by hand in the browser.

**Tech Stack:** Google Apps Script (V8), clasp 3.2.0, Node 24 (`node:test`, `node:assert/strict`), plain HTML/CSS/JS (no frameworks).

**Spec:** `docs/superpowers/specs/2026-11-11-timed-assessment-design.md`

## Global Constraints

- Cost: zero. No paid add-ons, no paid hosting.
- Apps Script manifest: `"timeZone": "Africa/Lagos"`, `"runtimeVersion": "V8"`, webapp `"executeAs": "USER_DEPLOYING"`, `"access": "ANYONE_ANONYMOUS"`.
- The server decides time. The browser only displays `remainingMs` that the server sent; it never uses its own clock to decide a deadline.
- Grace period: `GRACE_MS = 30000` (30 seconds).
- Autosave interval: 60 seconds.
- Deadline = `min(startedAt + DurationMinutes, ClosesAt)`; blank `ClosesAt` means no cap.
- One attempt per (AssessmentId, email); email compared after trim + lowercase.
- Attempt statuses, exact strings: `IN_PROGRESS`, `SUBMITTED`, `AUTO_SUBMITTED`.
- Question types, exact strings: `MCQ`, `SHORT`, `PARAGRAPH`. MCQ `Answer` cell holds a letter `A` to `D`.
- Brand: teal `#154B54`, green `#5EB229`, font Montserrat (Google Fonts).
- All student-facing text in plain English, no em dashes.
- Every `src/*.js` file ends with `if (typeof module !== 'undefined') module.exports = { ... };` so Node can `require` it while Apps Script ignores it.
- Git commits carry no Co-Authored-By line.

## Review Focus

1. **Student refreshes, closes the tab or switches device mid-test**: the timer continues from the original start and saved answers come back. Pinned in Task 3 (`resume keeps the original deadline and restores answers`).
2. **Submit arrives after the deadline** (slow network or a tampered page): within 30 s it counts; after that the last autosave before the deadline counts. Pinned in Task 3 (`submit within grace`, `submit after grace keeps last autosave`).
3. **Student types their email differently the second time** (`" ANA@Mail.com "` vs `ana@mail.com`): same attempt, not a fresh timer. Pinned in Task 3 (resume test uses the messy email).
4. **Assessment closes while a student is still writing, or a student starts late**: their deadline is capped at ClosesAt. Pinned in Task 1 (`computeDeadline is capped by closing time`).
5. **Student comes back after their time has already expired without submitting**: they are not given a new attempt; saved answers are submitted. Pinned in Task 3 (`start after deadline auto-submits saved answers`).

---

## File Structure

```
ea_assessment_platform/
  package.json            npm test -> node --test tests/
  .gitignore              node_modules/ (.clasp.json is committed; it only holds the script id)
  src/                    everything clasp pushes to Google
    appsscript.json       manifest (time zone, web app access)
    Logic.js              pure rules: time, email, marking, formatting
    Api.js                createApi(): info / start / save / submit, uses a store
    Store.js              sheetStore(): reads/writes the three Sheet tabs
    Main.js               doGet, apiInfo/apiStart/apiSave/apiSubmit, setup, smokeTest
    Index.html            student page (start, exam with timer, done)
  tests/
    logic.test.js
    api.test.js
    fakeStore.js          in-memory store with the same interface as sheetStore()
  README.md               how a teacher creates and runs an assessment
```

Shared data shapes (used from Task 2 onward):

```js
// Assessment (from Assessments tab)
{ id: 'AP-WK3', title: 'Week 3 Quiz', durationMinutes: 45, opensAt: Date|null, closesAt: Date|null, status: 'Open' }
// Question (from Questions tab), options has blanks removed
{ qNo: 1, type: 'MCQ', text: '...', options: ['3','4','5','6'], answer: 'B', marks: 2 }
// Answers: plain object keyed by qNo as string. MCQ value is a letter.
{ '1': 'B', '3': 'Net present value' }
// Attempt (one row of Attempts tab)
{ attemptId, assessmentId, name, email, startedAt: Date, deadlineAt: Date, submittedAt: Date|null,
  status: 'IN_PROGRESS'|'SUBMITTED'|'AUTO_SUBMITTED', autoScore: number|null, autoMax: number|null,
  needsManual: boolean|null, answers: Answers, answersText: string, lastSavedAt: Date|null }
```

---

### Task 1: Project setup and timing rules

**Files:**
- Create: `package.json`, `.gitignore`, `src/appsscript.json`, `src/Logic.js`
- Test: `tests/logic.test.js`

**Interfaces:**
- Produces (all in `src/Logic.js`, global in Apps Script, exported for Node):
  - `GRACE_MS: number` = 30000
  - `normaliseEmail(raw: string): string`
  - `isValidEmail(email: string): boolean` (regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`)
  - `computeDeadline(startedAt: Date, durationMinutes: number, closesAt: Date|null): Date`
  - `isOpen(assessment: Assessment, now: Date): boolean`
  - `acceptsWrites(attempt: Attempt, now: Date): boolean`
  - `formatRemaining(ms: number): string`

- [ ] **Step 1: Initialise the project**

```bash
git init          # why: start version history so every task can be saved and undone
npm init -y       # why: creates package.json so "npm test" has somewhere to live
```

Set `"scripts": { "test": "node --test tests/" }` in `package.json`. `.gitignore`: `node_modules/`. `src/appsscript.json` holds exactly the manifest values in Global Constraints plus `"exceptionLogging": "STACKDRIVER"`.

- [ ] **Step 2: Write the failing tests** in `tests/logic.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/Logic.js');
const at = (iso) => new Date(iso);

test('normaliseEmail trims and lowercases', () => {
  assert.equal(L.normaliseEmail('  John.Doe@Mail.COM '), 'john.doe@mail.com');
});

test('isValidEmail', () => {
  assert.equal(L.isValidEmail('a@b.co'), true);
  assert.equal(L.isValidEmail('a@b'), false);
  assert.equal(L.isValidEmail(''), false);
});

test('computeDeadline uses start + duration when close is later or blank', () => {
  const s = at('2026-11-12T10:00:00Z');
  assert.equal(L.computeDeadline(s, 45, null).toISOString(), '2026-11-12T10:45:00.000Z');
  assert.equal(L.computeDeadline(s, 45, at('2026-11-12T12:00:00Z')).toISOString(), '2026-11-12T10:45:00.000Z');
});

test('computeDeadline is capped by closing time', () => {
  const s = at('2026-11-12T11:40:00Z');
  assert.equal(L.computeDeadline(s, 45, at('2026-11-12T12:00:00Z')).toISOString(), '2026-11-12T12:00:00.000Z');
});

test('isOpen respects status and window', () => {
  const a = { status: 'Open', opensAt: at('2026-11-12T09:00:00Z'), closesAt: at('2026-11-12T12:00:00Z') };
  assert.equal(L.isOpen(a, at('2026-11-12T10:00:00Z')), true);
  assert.equal(L.isOpen({ ...a, status: 'open' }, at('2026-11-12T10:00:00Z')), true);
  assert.equal(L.isOpen({ ...a, status: 'Closed' }, at('2026-11-12T10:00:00Z')), false);
  assert.equal(L.isOpen(a, at('2026-11-12T08:59:59Z')), false);
  assert.equal(L.isOpen(a, at('2026-11-12T12:00:00Z')), false);
  assert.equal(L.isOpen({ status: 'Open', opensAt: null, closesAt: null }, at('2030-01-01T00:00:00Z')), true);
});

test('acceptsWrites allows 30s grace then refuses', () => {
  const d = at('2026-11-12T10:45:00Z');
  const att = { status: 'IN_PROGRESS', deadlineAt: d };
  assert.equal(L.acceptsWrites(att, new Date(d.getTime() + 30000)), true);
  assert.equal(L.acceptsWrites(att, new Date(d.getTime() + 30001)), false);
  assert.equal(L.acceptsWrites({ ...att, status: 'SUBMITTED' }, d), false);
});

test('formatRemaining rounds up to whole seconds and never goes negative', () => {
  assert.equal(L.formatRemaining(300000), '05:00');
  assert.equal(L.formatRemaining(59001), '01:00');
  assert.equal(L.formatRemaining(1), '00:01');
  assert.equal(L.formatRemaining(3725000), '1:02:05');
  assert.equal(L.formatRemaining(0), '00:00');
  assert.equal(L.formatRemaining(-5000), '00:00');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/Logic.js'`.

- [ ] **Step 4: Implement the Task 1 functions in `src/Logic.js`**

`formatRemaining` must be self-contained (no references to other functions or constants) because Task 4 injects its source text into the browser page with `formatRemaining.toString()`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: 7 tests pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: project setup and timing rules"
```

---

### Task 2: Marking rules

**Files:**
- Modify: `src/Logic.js`
- Test: `tests/logic.test.js`

**Interfaces:**
- Consumes: Question and Answers shapes from File Structure.
- Produces (in `src/Logic.js`):
  - `publicQuestions(questions: Question[]): Array<{qNo, type, text, options, marks}>` (no `answer` key)
  - `gradeAnswers(questions: Question[], answers: Answers): { autoScore: number, autoMax: number, needsManual: boolean }`; MCQ compared after trim + uppercase; SHORT/PARAGRAPH add nothing to score or max but set `needsManual: true`
  - `formatAnswersForSheet(questions: Question[], answers: Answers): string`; one line per question in qNo order, `"<qNo>: <answer>"`, missing or empty answers shown as `(blank)`, lines joined with `\n`

- [ ] **Step 1: Write the failing tests** (append to `tests/logic.test.js`)

```js
const QS = [
  { qNo: 1, type: 'MCQ', text: '2+2?', options: ['3', '4', '5', '6'], answer: 'B', marks: 2 },
  { qNo: 2, type: 'MCQ', text: 'Capital of Nigeria?', options: ['Lagos', 'Abuja', 'Kano', 'Enugu'], answer: 'B', marks: 1 },
  { qNo: 3, type: 'SHORT', text: 'Define NPV', options: [], answer: '', marks: 5 },
];

test('publicQuestions hides the answer key', () => {
  const pq = L.publicQuestions(QS);
  assert.equal(pq.length, 3);
  pq.forEach((q) => assert.equal('answer' in q, false));
  assert.deepEqual(pq[0], { qNo: 1, type: 'MCQ', text: '2+2?', options: ['3', '4', '5', '6'], marks: 2 });
});

test('gradeAnswers marks MCQs ignoring case/space and flags free text', () => {
  assert.deepEqual(L.gradeAnswers(QS, { '1': ' b ', '2': 'A', '3': 'net present value' }),
    { autoScore: 2, autoMax: 3, needsManual: true });
  assert.deepEqual(L.gradeAnswers(QS.slice(0, 2), {}), { autoScore: 0, autoMax: 3, needsManual: false });
});

test('formatAnswersForSheet lists every question in order', () => {
  assert.equal(L.formatAnswersForSheet(QS, { '3': 'Net present value', '1': 'B' }),
    '1: B\n2: (blank)\n3: Net present value');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the 3 new tests FAIL with `L.publicQuestions is not a function`.

- [ ] **Step 3: Implement the three functions in `src/Logic.js`** and add them to `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 10 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/Logic.js tests/logic.test.js
git commit -m "feat: marking rules"
```

---

### Task 3: Attempt engine (start, resume, autosave, submit)

**Files:**
- Create: `src/Api.js`, `tests/fakeStore.js`
- Test: `tests/api.test.js`

**Interfaces:**
- Consumes: everything from `src/Logic.js` as globals (in Node the test does `Object.assign(globalThis, require('../src/Logic.js'))` before requiring `Api.js`, mirroring Apps Script's shared global scope).
- Store interface (implemented by `tests/fakeStore.js` here and by `sheetStore()` in Task 4):
  - `getAssessment(id: string): Assessment|null`
  - `getQuestions(assessmentId: string): Question[]` (sorted by qNo)
  - `findAttempt(assessmentId: string, email: string): Attempt|null` (email already normalised)
  - `getAttempt(attemptId: string): Attempt|null`
  - `saveAttempt(attempt: Attempt): void` (insert or replace by attemptId)
- `tests/fakeStore.js` exports `makeFakeStore({ assessments: Assessment[], questions: Question[] & {assessmentId} })` returning the store plus `attempts: Attempt[]` for inspection. It stores copies (structuredClone) so tests can't mutate state by accident.
- Produces: `createApi({ store, now: () => Date, newId: () => string })` returning:
  - `info(assessmentId) -> { ok: true, title, durationMinutes } | { ok: false, message }`
  - `start({ assessmentId, name, email }) -> { ok: true, attemptId, title, questions, answers, remainingMs } | { ok: false, message }`
  - `save({ attemptId, answers }) -> { ok: true, remainingMs } | { ok: false, timeUp: true } | { ok: false, message }`
  - `submit({ attemptId, answers }) -> { ok: true, status, message? } | { ok: false, message }`

Exact messages (copy verbatim):

| Situation | message |
|---|---|
| Unknown assessment id | `This assessment link is not valid.` |
| Assessment not open (new attempt only) | `This assessment is not open right now.` |
| Blank name or invalid email | `Please enter your full name and a valid email address.` |
| Attempt already SUBMITTED / AUTO_SUBMITTED | `You have already submitted this assessment.` |
| Returning after deadline, never submitted | `Your time ran out. Your saved answers were submitted.` |
| Unknown attemptId on save/submit | `Attempt not found. Please reopen the assessment link.` |
| Late submit (status AUTO_SUBMITTED) | `Time was up. Your answers saved before the deadline were submitted.` |

Rules: every write sets `answersText` via `formatAnswersForSheet`; marking (`gradeAnswers`) runs on submit and on any auto-submit; `save` updates `answers` and `lastSavedAt` only when `acceptsWrites`; a resume returns the stored answers and `remainingMs = deadlineAt - now`; `submit` on an already finished attempt returns `{ ok: true, status: <existing> }` without changing anything.

- [ ] **Step 1: Write the failing tests** in `tests/api.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
Object.assign(globalThis, require('../src/Logic.js'));
const { createApi } = require('../src/Api.js');
const { makeFakeStore } = require('./fakeStore.js');

const T0 = new Date('2026-11-12T10:00:00Z');
const plus = (ms) => new Date(T0.getTime() + ms);
const MIN = 60000;

function setup(overrides = {}) {
  const store = makeFakeStore({
    assessments: [{ id: 'AP-WK3', title: 'Week 3 Quiz', durationMinutes: 45, opensAt: null, closesAt: null, status: 'Open', ...overrides }],
    questions: [
      { assessmentId: 'AP-WK3', qNo: 1, type: 'MCQ', text: '2+2?', options: ['3', '4', '5', '6'], answer: 'B', marks: 2 },
      { assessmentId: 'AP-WK3', qNo: 2, type: 'SHORT', text: 'Define NPV', options: [], answer: '', marks: 5 },
    ],
  });
  let clock = T0; let n = 0;
  const api = createApi({ store, now: () => clock, newId: () => 'att-' + (++n) });
  return { api, store, setClock: (d) => { clock = d; } };
}
const who = { assessmentId: 'AP-WK3', name: 'Ana Obi', email: 'ana@mail.com' };

test('info returns title and duration', () => {
  assert.deepEqual(setup().api.info('AP-WK3'), { ok: true, title: 'Week 3 Quiz', durationMinutes: 45 });
  assert.deepEqual(setup().api.info('NOPE'), { ok: false, message: 'This assessment link is not valid.' });
});

test('start refuses closed assessment and bad details', () => {
  assert.equal(setup({ status: 'Closed' }).api.start(who).message, 'This assessment is not open right now.');
  assert.equal(setup().api.start({ ...who, name: '  ' }).message, 'Please enter your full name and a valid email address.');
  assert.equal(setup().api.start({ ...who, email: 'ana@' }).message, 'Please enter your full name and a valid email address.');
});

test('start creates an attempt with full time and no answer key', () => {
  const { api, store } = setup();
  const r = api.start(who);
  assert.equal(r.ok, true);
  assert.equal(r.remainingMs, 45 * MIN);
  assert.deepEqual(r.answers, {});
  r.questions.forEach((q) => assert.equal('answer' in q, false));
  assert.equal(store.attempts[0].status, 'IN_PROGRESS');
  assert.equal(store.attempts[0].deadlineAt.toISOString(), '2026-11-12T10:45:00.000Z');
});

test('resume keeps the original deadline and restores answers', () => {
  const { api, store, setClock } = setup();
  const first = api.start(who);
  setClock(plus(5 * MIN));
  api.save({ attemptId: first.attemptId, answers: { '1': 'B' } });
  setClock(plus(10 * MIN));
  const again = api.start({ ...who, email: ' ANA@Mail.com ' });
  assert.equal(again.attemptId, first.attemptId);
  assert.equal(again.remainingMs, 35 * MIN);
  assert.deepEqual(again.answers, { '1': 'B' });
  assert.equal(store.attempts.length, 1);
});

test('start after deadline auto-submits saved answers', () => {
  const { api, store, setClock } = setup();
  const first = api.start(who);
  setClock(plus(5 * MIN));
  api.save({ attemptId: first.attemptId, answers: { '1': 'B' } });
  setClock(plus(50 * MIN));
  assert.deepEqual(api.start(who), { ok: false, message: 'Your time ran out. Your saved answers were submitted.' });
  assert.equal(store.attempts[0].status, 'AUTO_SUBMITTED');
  assert.equal(store.attempts[0].autoScore, 2);
});

test('start after submitting is refused', () => {
  const { api } = setup();
  const r = api.start(who);
  api.submit({ attemptId: r.attemptId, answers: {} });
  assert.equal(api.start(who).message, 'You have already submitted this assessment.');
});

test('save after grace is refused and changes nothing', () => {
  const { api, store, setClock } = setup();
  const r = api.start(who);
  setClock(plus(45 * MIN + 30001));
  assert.deepEqual(api.save({ attemptId: r.attemptId, answers: { '1': 'A' } }), { ok: false, timeUp: true });
  assert.deepEqual(store.attempts[0].answers, {});
});

test('submit on time marks and records', () => {
  const { api, store, setClock } = setup();
  const r = api.start(who);
  setClock(plus(20 * MIN));
  assert.deepEqual(api.submit({ attemptId: r.attemptId, answers: { '1': 'b', '2': 'Net present value' } }), { ok: true, status: 'SUBMITTED' });
  const a = store.attempts[0];
  assert.equal(a.autoScore, 2); assert.equal(a.autoMax, 2); assert.equal(a.needsManual, true);
  assert.equal(a.submittedAt.toISOString(), plus(20 * MIN).toISOString());
  assert.equal(a.answersText, '1: b\n2: Net present value');
});

test('submit within grace counts the new answers', () => {
  const { api, store, setClock } = setup();
  const r = api.start(who);
  setClock(plus(45 * MIN + 20000));
  assert.equal(api.submit({ attemptId: r.attemptId, answers: { '1': 'B' } }).status, 'SUBMITTED');
  assert.equal(store.attempts[0].autoScore, 2);
});

test('submit after grace keeps last autosave', () => {
  const { api, store, setClock } = setup();
  const r = api.start(who);
  setClock(plus(10 * MIN));
  api.save({ attemptId: r.attemptId, answers: { '1': 'A' } });
  setClock(plus(47 * MIN));
  assert.deepEqual(api.submit({ attemptId: r.attemptId, answers: { '1': 'B' } }),
    { ok: true, status: 'AUTO_SUBMITTED', message: 'Time was up. Your answers saved before the deadline were submitted.' });
  assert.deepEqual(store.attempts[0].answers, { '1': 'A' });
  assert.equal(store.attempts[0].autoScore, 0);
});

test('second submit changes nothing', () => {
  const { api, store, setClock } = setup();
  const r = api.start(who);
  api.submit({ attemptId: r.attemptId, answers: { '1': 'B' } });
  const firstAt = store.attempts[0].submittedAt.toISOString();
  setClock(plus(MIN));
  assert.deepEqual(api.submit({ attemptId: r.attemptId, answers: { '1': 'A' } }), { ok: true, status: 'SUBMITTED' });
  assert.equal(store.attempts[0].submittedAt.toISOString(), firstAt);
  assert.deepEqual(store.attempts[0].answers, { '1': 'B' });
});

test('unknown attempt id', () => {
  const msg = 'Attempt not found. Please reopen the assessment link.';
  assert.equal(setup().api.save({ attemptId: 'x', answers: {} }).message, msg);
  assert.equal(setup().api.submit({ attemptId: 'x', answers: {} }).message, msg);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '../src/Api.js'` (write `tests/fakeStore.js` first so this is the only missing module).

- [ ] **Step 3: Implement `createApi` in `src/Api.js`** following the rules and message table above. A new attempt's deadline comes from `computeDeadline(now, durationMinutes, closesAt)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 22 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/Api.js tests/api.test.js tests/fakeStore.js
git commit -m "feat: attempt engine with resume, autosave and grace rules"
```

---

### Task 4: Connect to the Google Sheet

**Files:**
- Create: `src/Store.js`, `src/Main.js`, `src/Index.html` (placeholder: `<p>Assessment <?= assessmentId ?></p>`; Task 5 replaces it)
- Create (by clasp): `.clasp.json`

**Interfaces:**
- Consumes: `createApi` (Task 3), Store interface (Task 3), `formatRemaining` (Task 1).
- Produces:
  - `sheetStore(): Store` in `src/Store.js`, using `SpreadsheetApp.getActive()` and the tab/column layout in the spec, header row 1. Blank OpensAt/ClosesAt become `null`; blank Marks becomes 1; options with blank cells removed; `Answer` trimmed and uppercased; `AnswersJSON` column holds `JSON.stringify(answers)`, `Answers` column holds `answersText`; `NeedsManualMarking` written as `Yes`/`No`. `saveAttempt` overwrites the row whose AttemptId matches, else appends.
  - In `src/Main.js` (globals the page calls with `google.script.run`):
    - `doGet(e)` renders `Index.html` as a template with `assessmentId = (e.parameter.a || '').trim()` and `clientHelpers = formatRemaining.toString()`; title `EduBridge Assessment`; viewport meta `width=device-width, initial-scale=1`.
    - `apiInfo(assessmentId)`, `apiStart(payload)`, `apiSave(payload)`, `apiSubmit(payload)`: each builds `createApi({ store: sheetStore(), now: () => new Date(), newId: () => Utilities.getUuid() })` and calls the matching method. Only `apiStart` takes `LockService.getScriptLock().waitLock(20000)` (prevents duplicate rows from a double click; save/submit touch one existing row and stay unlocked so a full class is not queued). Any thrown error is logged with `console.error` and returned as `{ ok: false, message: 'Something went wrong. Please try again.' }`.
    - `setup()`: creates the three tabs if missing, writes bold frozen headers, and adds a demo assessment `DEMO` ("Demo Quiz", 5 minutes, Status `Open`, blank dates) with 2 MCQs and 1 SHORT question. Running it twice must not duplicate anything.
    - `smokeTest()`: runs info, start, save, submit against `DEMO` with email `smoke+<Date.now()>@example.com`, logs each result, and throws `Error('Smoke test failed: <step>')` if any result is not `ok` or the final status is not `SUBMITTED`.

- [ ] **Step 1: Write `src/Store.js` and `src/Main.js`** per the interfaces above.

- [ ] **Step 2: Confirm local tests still pass**

Run: `npm test`
Expected: 22 pass (the new files are not required by tests, this only checks nothing broke).

- [ ] **Step 3: Create the Google Sheet and script**

```bash
clasp create --type sheets --title "EA Assessments" --rootDir src
# why: makes a new Google Sheet called "EA Assessments" with an attached script,
#      and writes .clasp.json so this folder knows which script to update
git diff src/appsscript.json
# why: clasp can overwrite the manifest; if the time zone/webapp lines changed,
#      restore them with: git checkout src/appsscript.json
clasp push --force
# why: uploads Logic.js, Api.js, Store.js, Main.js, Index.html and the manifest to Google
```

Expected: `clasp push` lists 6 pushed files.

- [ ] **Step 4: Run `setup` then `smokeTest` against the real Sheet**

Run `clasp open-container` (opens the Sheet), then Extensions > Apps Script, choose `setup` and press Run. Approve the permission prompt (first time only; this is Google asking the account owner to let the script edit its own Sheet). Then run `smokeTest`.
Expected: the Sheet has tabs `Assessments`, `Questions`, `Attempts` with the demo rows; `smokeTest` log ends without an error and the `Attempts` tab has one row with Status `SUBMITTED`, a filled `Answers` column and a filled `AutoScore`.

- [ ] **Step 5: Commit**

```bash
git add src/Store.js src/Main.js src/Index.html .clasp.json src/appsscript.json
git commit -m "feat: connect attempt engine to Google Sheet"
```

---

### Task 5: Student page with live countdown

**Files:**
- Modify: `src/Index.html` (replace placeholder)

**Interfaces:**
- Consumes: template vars `assessmentId`, `clientHelpers`; server functions `apiInfo`, `apiStart`, `apiSave`, `apiSubmit` (Task 4) with the return shapes from Task 3.
- Produces: nothing other code depends on.

Behaviour the page must have (each is checked in Step 3):

1. **Three screens in one page:** Start (title, "You will have N minutes once you click Start. The timer cannot be paused.", name, email, Start button), Exam, Done. If `apiInfo` fails or `assessmentId` is blank, show the message instead of the form.
2. **Timer:** on start/resume, `endLocal = Date.now() + remainingMs` (server's remaining time, so a wrong computer clock does not matter). Tick every 1 s with `formatRemaining(endLocal - Date.now())` in a sticky bar at the top. Bar turns red below 5 minutes; show a one-line banner "5 minutes left" and "1 minute left" once each.
3. **Questions:** MCQ as radio buttons labelled `A. <option>` with value = letter; SHORT as a single-line input; PARAGRAPH as a textarea. Saved answers from a resume are pre-filled. Show marks per question.
4. **Autosave every 60 s** via `apiSave`; show "Saved at HH:MM" quietly. If it returns `timeUp`, submit immediately.
5. **Submit:** button asks "Submit now? You cannot change your answers after this." When the countdown reaches 0, submit without asking and disable all inputs. Retry a failed submit up to 3 times, 3 s apart; if all fail, show "We could not reach the server. Your last autosaved answers will be used." Done screen shows the server's `message` if any, else "Your answers have been submitted. You can close this page."
6. **Leaving the page** during the exam triggers the browser's "Leave site?" prompt (`beforeunload`).
7. **Style:** Montserrat, teal `#154B54` header/timer bar, green `#5EB229` buttons, readable on a phone (max-width 760px column, 16px side padding).
8. `<script><?!= clientHelpers ?></script>` makes `formatRemaining` available on the page.

- [ ] **Step 1: Build `src/Index.html`** to the behaviour list above.

- [ ] **Step 2: Push and open a test deployment**

```bash
clasp push --force
# why: sends the new page to Google
```

In the Apps Script editor: Deploy > Test deployments > copy the Web app URL, add `?a=DEMO` to the end.

- [ ] **Step 3: Check each behaviour by hand**

Expected, in order:
- Start screen shows "Demo Quiz" and "5 minutes". Bad email shows the "Please enter your full name..." message.
- Start: timer shows `05:00` and counts down. Answer Q1, wait for "Saved at".
- Refresh the page, enter the same email in CAPITALS: timer continues (not back to 05:00), Q1 answer is still selected. (Review Focus 1 and 3.)
- Change the computer clock forward 10 minutes, refresh, resume: remaining time is unchanged. Set the clock back. (Constraint: server decides time.)
- Let the timer reach 0: page submits by itself, Done screen appears, `Attempts` row shows `SUBMITTED` or `AUTO_SUBMITTED`.
- Open the link again with the same email: "You have already submitted this assessment."
- Open on a phone (or narrow the window to 375px): no sideways scrolling.

- [ ] **Step 4: Commit**

```bash
git add src/Index.html
git commit -m "feat: student page with server-timed countdown and autosave"
```

---

### Task 6: Go live and teacher guide

**Files:**
- Create: `README.md`
- Modify: `.clasp.json` untouched; record the deployment id in `README.md`

**Interfaces:**
- Consumes: the whole app.
- Produces: a public link teachers can share, and a guide.

- [ ] **Step 1: Create the live deployment**

```bash
clasp push --force
clasp deploy --description "v1"
# why: freezes the current code as version 1 and gives it a permanent link.
#      The link is https://script.google.com/macros/s/<deploymentId>/exec
```

For later updates use `clasp redeploy <deploymentId> --description "v2"` so the link students have stays the same.

- [ ] **Step 2: Check the link works for someone who is not signed in**

Open `https://script.google.com/macros/s/<deploymentId>/exec?a=DEMO` in a private/incognito window.
Expected: the Start screen appears without any Google sign-in. If Google asks to sign in, the EduBridge Workspace admin is blocking "Anyone" access to web apps; in the Google Admin console allow it (Apps > Google Workspace > Drive and Docs > Sharing settings, allow sharing outside the organisation) or redeploy under a personal Gmail account.

- [ ] **Step 3: Write `README.md`** in plain layman language covering: how to add an assessment (one row in `Assessments`, rows in `Questions`, with one filled example of each question type), how to build the student link (`<live URL>?a=<AssessmentId>`), how to open and close an assessment (Status cell, or OpensAt/ClosesAt), where results appear and what each `Attempts` column means, how to mark SHORT/PARAGRAPH answers by hand, the 60 to 80 students at once limit, and how to publish code changes (`clasp push`, then `clasp redeploy`).

- [ ] **Step 4: Full rehearsal with a real assessment**

Add assessment `TEST-1` (3 minutes, 2 MCQ + 1 PARAGRAPH), take it on two devices with two emails at the same time, let one time out and submit the other early.
Expected: two `Attempts` rows, one `SUBMITTED`, one `SUBMITTED` or `AUTO_SUBMITTED`, both with AutoScore filled and `NeedsManualMarking` = `Yes`.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: teacher guide and live deployment"
```
