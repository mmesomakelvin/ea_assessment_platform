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
  assert.deepEqual(pq[0], { qNo: 1, type: 'MCQ', text: '2+2?', marks: 2, section: '', maxLength: 1,
    options: [{ letter: 'A', text: '3' }, { letter: 'B', text: '4' }, { letter: 'C', text: '5' }, { letter: 'D', text: '6' }] });
  assert.deepEqual(pq[2].options, []);
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

test('safeJsonForScript cannot close the script tag', () => {
  const out = L.safeJsonForScript({ assessmentId: '</script><script>alert(1)</script>', resumeToken: 'abc' });
  assert.equal(out.includes('<'), false);
  assert.deepEqual(JSON.parse(out), { assessmentId: '</script><script>alert(1)</script>', resumeToken: 'abc' });
});

test('a blank middle option is dropped but the other letters stay the same', () => {
  const pq = L.publicQuestions([{ qNo: 1, type: 'MCQ', text: 'Pick', options: ['x', '', 'z'], answer: 'C', marks: 1, section: '' }]);
  assert.deepEqual(pq[0].options, [{ letter: 'A', text: 'x' }, { letter: 'C', text: 'z' }]);
});

const MANY = Array.from({ length: 10 }, (_, i) => ({
  qNo: i + 1, type: 'MCQ', text: 'Q' + (i + 1), options: ['w', 'x', 'y', 'z'], answer: 'A', marks: 1, section: i < 5 ? 'S1' : 'S2',
}));

test('shuffled question order is fixed per student, differs between students, keeps sections together', () => {
  const a1 = L.publicQuestions(MANY, 'att-1').map((q) => q.qNo);
  const a2 = L.publicQuestions(MANY, 'att-2').map((q) => q.qNo);
  assert.deepEqual(L.publicQuestions(MANY, 'att-1').map((q) => q.qNo), a1);
  assert.notDeepEqual(a1, a2);
  assert.notDeepEqual(a1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(a1.slice(0, 5).sort((x, y) => x - y), [1, 2, 3, 4, 5]);
  assert.deepEqual(a1.slice(5).sort((x, y) => x - y), [6, 7, 8, 9, 10]);
});

test('shuffled options keep their original letters, True/False stays in order', () => {
  const pq = L.publicQuestions(MANY, 'att-1');
  pq.forEach((q) => assert.deepEqual(q.options.map((o) => o.letter).sort(), ['A', 'B', 'C', 'D']));
  pq.forEach((q) => q.options.forEach((o) => assert.equal(o.text, { A: 'w', B: 'x', C: 'y', D: 'z' }[o.letter])));
  assert.ok(pq.some((q) => q.options.map((o) => o.letter).join('') !== 'ABCD'));
  const tf = L.publicQuestions([{ qNo: 1, type: 'MCQ', text: 't', options: ['True', 'False'], answer: 'A', marks: 1, section: '' }], 'att-1');
  assert.deepEqual(tf[0].options, [{ letter: 'A', text: 'True' }, { letter: 'B', text: 'False' }]);
});

test('answerLimits caps written answers so all answers fit in one Sheet cell', () => {
  assert.deepEqual(L.answerLimits(QS), { '1': 1, '2': 1, '3': 500 });
  const paras = [1, 2, 3, 4].map((n) => ({ qNo: n, type: 'PARAGRAPH', text: 'p', options: [], answer: '', marks: 5 }));
  assert.deepEqual(L.answerLimits(paras), { '1': 5000, '2': 5000, '3': 5000, '4': 5000 });
  assert.deepEqual(L.answerLimits([paras[0]]), { '1': 10000 });
});
