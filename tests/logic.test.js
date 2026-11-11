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

const QS = [
  { qNo: 1, type: 'MCQ', text: '2+2?', options: ['3', '4', '5', '6'], answer: 'B', marks: 2 },
  { qNo: 2, type: 'MCQ', text: 'Capital of Nigeria?', options: ['Lagos', 'Abuja', 'Kano', 'Enugu'], answer: 'B', marks: 1 },
  { qNo: 3, type: 'SHORT', text: 'Define NPV', options: [], answer: '', marks: 5 },
];

test('publicQuestions hides the answer key', () => {
  const pq = L.publicQuestions(QS);
  assert.equal(pq.length, 3);
  pq.forEach((q) => assert.equal('answer' in q, false));
  assert.deepEqual(pq[0], { qNo: 1, type: 'MCQ', text: '2+2?', options: ['3', '4', '5', '6'], marks: 2, section: '' });
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
