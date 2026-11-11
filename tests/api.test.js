const test = require('node:test');
const assert = require('node:assert/strict');
Object.assign(globalThis, require('../src/Logic.js'));
const { createApi, cleanAnswers, runGuarded } = require('../src/Api.js');
const { makeFakeStore } = require('./fakeStore.js');

const T0 = new Date('2026-11-12T10:00:00Z');
const plus = (ms) => new Date(T0.getTime() + ms);
const MIN = 60000;

function setup(overrides = {}, roster = []) {
  const store = makeFakeStore({
    roster,
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
  const again = api.start({ ...who, email: ' ANA@Mail.com ', resumeToken: first.attemptId });
  assert.equal(again.attemptId, first.attemptId);
  assert.equal(again.remainingMs, 35 * MIN);
  assert.deepEqual(again.answers, { '1': 'B' });
  assert.equal(store.attempts.length, 1);
});

const ANOTHER_DEVICE = 'This email has already started this assessment on another device or browser. Please continue there, or ask your instructor to allow a new device.';

test('someone else typing the same email cannot open the attempt', () => {
  const { api, setClock } = setup();
  const first = api.start(who);
  api.save({ attemptId: first.attemptId, answers: { '1': 'B' } });
  setClock(plus(MIN));
  assert.deepEqual(api.start(who), { ok: false, message: ANOTHER_DEVICE });
  assert.deepEqual(api.start({ ...who, resumeToken: 'guess' }), { ok: false, message: ANOTHER_DEVICE });
});

test('teacher can allow one new device, which keeps the original deadline', () => {
  const { api, store, setClock } = setup();
  const first = api.start(who);
  store.attempts[0].allowNewDevice = true;
  setClock(plus(10 * MIN));
  const r = api.start(who);
  assert.equal(r.attemptId, first.attemptId);
  assert.equal(r.remainingMs, 35 * MIN);
  assert.equal(store.attempts[0].allowNewDevice, false);
  assert.equal(api.start(who).message, ANOTHER_DEVICE);
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
  assert.equal(a.answersText, '1: B\n2: Net present value');
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

test('a slow autosave that read the attempt before submit cannot undo the submission', () => {
  const { api, store, setClock } = setup();
  const r = api.start(who);
  const staleCopy = store.getAttempt(r.attemptId);
  setClock(plus(10 * MIN));
  api.submit({ attemptId: r.attemptId, answers: { '1': 'B' } });
  const realGet = store.getAttempt;
  store.getAttempt = () => staleCopy; // the autosave read the row while it was still IN_PROGRESS
  api.save({ attemptId: r.attemptId, answers: { '1': 'A' } });
  store.getAttempt = realGet;
  assert.equal(store.attempts[0].status, 'SUBMITTED');
  assert.equal(store.attempts[0].autoScore, 2);
  assert.notEqual(store.attempts[0].submittedAt, null);
});

test('finaliseExpired closes abandoned attempts using their last autosave', () => {
  const { api, store, setClock } = setup();
  const gone = api.start(who);
  api.save({ attemptId: gone.attemptId, answers: { '1': 'B' } });
  const done = api.start({ ...who, email: 'done@mail.com' });
  api.submit({ attemptId: done.attemptId, answers: {} });
  setClock(plus(40 * MIN));
  const late = api.start({ ...who, email: 'late@mail.com' });
  setClock(plus(45 * MIN + 30001));
  assert.equal(api.finaliseExpired(), 1);
  const byEmail = (e) => store.attempts.find((a) => a.email === e);
  assert.equal(byEmail('ana@mail.com').status, 'AUTO_SUBMITTED');
  assert.equal(byEmail('ana@mail.com').autoScore, 2);
  assert.equal(byEmail('done@mail.com').status, 'SUBMITTED');
  assert.equal(byEmail('late@mail.com').status, 'IN_PROGRESS');
  assert.ok(late.ok);
});

test('cleanAnswers keeps only real questions, valid letters and safe lengths', () => {
  const qs = [
    { qNo: 1, type: 'MCQ', text: 'm', options: ['a', 'b'], answer: 'A', marks: 1 },
    { qNo: 2, type: 'SHORT', text: 's', options: [], answer: '', marks: 1 },
    { qNo: 3, type: 'PARAGRAPH', text: 'p', options: [], answer: '', marks: 1 },
  ];
  const out = cleanAnswers({ '1': ' b ', '2': 'x'.repeat(600), '3': 'y'.repeat(12000), '99': 'junk' }, qs);
  assert.deepEqual(Object.keys(out).sort(), ['1', '2', '3']);
  assert.equal(out['1'], 'B');
  assert.equal(out['2'].length, 500);
  assert.equal(out['3'].length, 10000);
  assert.deepEqual(cleanAnswers({ '1': 'E' }, qs), {});
  assert.deepEqual(cleanAnswers('nonsense', qs), {});
});

test('runGuarded turns a crash into a retryable message', () => {
  const logged = [];
  assert.deepEqual(runGuarded(() => { throw new Error('Sheets timed out'); }, (e) => logged.push(e.message)),
    { ok: false, retry: true, message: 'Something went wrong. Please try again.' });
  assert.deepEqual(logged, ['Sheets timed out']);
  assert.deepEqual(runGuarded(() => ({ ok: true }), () => {}), { ok: true });
});

test('start checks for duplicates and inserts inside the lock', () => {
  const { store } = setup();
  let inLock = false; let locks = 0; const savedInLock = [];
  const realSave = store.saveAttempt;
  store.saveAttempt = (a) => { savedInLock.push(inLock); realSave(a); };
  const api = createApi({ store, now: () => T0, newId: () => 'att-x',
    withLock: (fn) => { locks++; inLock = true; try { return fn(); } finally { inLock = false; } } });
  assert.equal(api.start(who).ok, true);
  assert.equal(locks, 1);
  assert.deepEqual(savedInLock, [true]);
});

test('shuffle setting gives each student a fixed shuffled order', () => {
  const { api } = setup({ shuffle: true });
  const r = api.start(who);
  const expected = publicQuestions([
    { qNo: 1, type: 'MCQ', text: '2+2?', options: ['3', '4', '5', '6'], answer: 'B', marks: 2 },
    { qNo: 2, type: 'SHORT', text: 'Define NPV', options: [], answer: '', marks: 5 },
  ], r.attemptId);
  assert.deepEqual(r.questions, expected);
  assert.deepEqual(api.start({ ...who, resumeToken: r.attemptId }).questions, r.questions);
  assert.deepEqual(setup().api.start(who).questions[0].options.map((o) => o.letter), ['A', 'B', 'C', 'D']);
});

test('finaliseExpired never overwrites a row that was submitted after the job read it', () => {
  const { api, store, setClock } = setup();
  api.start(who);
  setClock(plus(45 * MIN + 30001));
  const staleList = store.inProgressAttempts();
  store.attempts[0].status = 'SUBMITTED'; // a submit landed between the job's read and its write
  store.attempts[0].autoScore = 2;
  store.inProgressAttempts = () => staleList;
  assert.equal(api.finaliseExpired(), 0);
  assert.equal(store.attempts[0].status, 'SUBMITTED');
  assert.equal(store.attempts[0].autoScore, 2);
});

const NOT_ON_ROSTER = 'This email is not on the list for this assessment. Please use the email address you registered with, or ask your instructor.';

test('with a roster, only listed emails can start', () => {
  const roster = [{ assessmentId: 'AP-WK3', email: 'ana@mail.com' }];
  assert.deepEqual(setup({}, roster).api.start({ ...who, email: 'someone.else@mail.com' }), { ok: false, message: NOT_ON_ROSTER });
  assert.equal(setup({}, roster).api.start({ ...who, email: ' ANA@mail.com ' }).ok, true);
  assert.equal(setup({}, [{ assessmentId: 'OTHER', email: 'x@y.co' }]).api.start(who).ok, true);
});

test('recordLeave counts each time a student leaves an unfinished test', () => {
  const { api, store } = setup();
  const r = api.start(who);
  assert.deepEqual(api.recordLeave({ attemptId: r.attemptId }), { ok: true, counted: true });
  api.recordLeave({ attemptId: r.attemptId });
  assert.equal(store.leaves[r.attemptId], 2);
  api.submit({ attemptId: r.attemptId, answers: {} });
  assert.deepEqual(api.recordLeave({ attemptId: r.attemptId }), { ok: true, counted: false });
  assert.equal(store.leaves[r.attemptId], 2);
  assert.equal(api.recordLeave({ attemptId: 'nope' }).message, 'Attempt not found. Please reopen the assessment link.');
});

test('every finished test gets one line in Results with the assessment title and score', () => {
  const { api, store, setClock } = setup();
  const a = api.start(who);
  setClock(plus(5 * MIN));
  api.submit({ attemptId: a.attemptId, answers: { '1': 'B' } });
  api.submit({ attemptId: a.attemptId, answers: { '1': 'B' } }); // second submit adds nothing
  const b = api.start({ ...who, email: 'gone@mail.com' });
  setClock(plus(60 * MIN));
  api.finaliseExpired();
  assert.equal(store.results.length, 2);
  assert.deepEqual(store.results.map((r) => [r.attemptId, r.title, r.status, r.autoScore, r.autoMax]), [
    [a.attemptId, 'Week 3 Quiz', 'SUBMITTED', 2, 2],
    [b.attemptId, 'Week 3 Quiz', 'AUTO_SUBMITTED', 0, 2],
  ]);
});
