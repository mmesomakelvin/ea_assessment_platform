const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/Store.js');

test('rowToAssessment maps cells and blank dates to null', () => {
  const opens = new Date('2026-11-12T09:00:00Z');
  assert.deepEqual(S.rowToAssessment([' AP-WK3 ', 'Week 3 Quiz', 45, opens, '', 'Open']),
    { id: 'AP-WK3', title: 'Week 3 Quiz', durationMinutes: 45, opensAt: opens, closesAt: null, status: 'Open', shuffle: false });
  assert.equal(S.rowToAssessment(['X', 'T', 5, '', '', 'Open', ' yes ']).shuffle, true);
});

test('rowToQuestion keeps option letters stable and normalises type, answer, marks', () => {
  assert.deepEqual(S.rowToQuestion(['AP-WK3', 2, ' mcq ', 'Pick one', 'x', '', 'z', '', ' c ', '', ' Section A ']),
    { assessmentId: 'AP-WK3', qNo: 2, type: 'MCQ', text: 'Pick one', options: ['x', '', 'z'], answer: 'C', marks: 1, section: 'Section A' });
  assert.deepEqual(S.rowToQuestion(['AP-WK3', 3, 'Short', 'Define NPV', '', '', '', '', '', 5, '']).options, []);
});

test('asText forces user text to stay text in the Sheet', () => {
  assert.equal(S.asText('=IMPORTXML("x")'), '\'=IMPORTXML("x")');
  assert.equal(S.asText('Ana Obi'), "'Ana Obi");
  assert.equal(S.asText(''), '');
});

const ATT = {
  attemptId: 'att-1', assessmentId: 'AP-WK3', name: 'Ana Obi', email: 'ana@mail.com',
  startedAt: new Date('2026-11-12T10:00:00Z'), deadlineAt: new Date('2026-11-12T10:45:00Z'),
  submittedAt: new Date('2026-11-12T10:20:00Z'), status: 'SUBMITTED',
  autoScore: 2, autoMax: 2, needsManual: true,
  answers: { '1': 'B', '2': 'Net present value' }, answersText: '1: B\n2: Net present value',
  lastSavedAt: null, allowNewDevice: false,
};

test('attemptToRow writes the 15 Attempts columns in order', () => {
  assert.deepEqual(S.attemptToRow(ATT), [
    'att-1', 'AP-WK3', "'Ana Obi", "'ana@mail.com", ATT.startedAt, ATT.deadlineAt, ATT.submittedAt,
    'SUBMITTED', 2, 2, 'Yes', "'1: B\n2: Net present value", '\'{"1":"B","2":"Net present value"}', '', '',
  ]);
  const fresh = { ...ATT, submittedAt: null, status: 'IN_PROGRESS', autoScore: null, autoMax: null, needsManual: null };
  assert.deepEqual(S.attemptToRow(fresh).slice(6, 11), ['', 'IN_PROGRESS', '', '', '']);
});

test('rowToAttempt reads back what Sheets returns', () => {
  const sheetRow = [
    'att-1', 'AP-WK3', 'Ana Obi', 'ana@mail.com', ATT.startedAt, ATT.deadlineAt, ATT.submittedAt,
    'SUBMITTED', 2, 2, 'Yes', '1: B\n2: Net present value', '{"1":"B","2":"Net present value"}', '', '',
  ];
  assert.deepEqual(S.rowToAttempt(sheetRow), ATT);
  const fresh = S.rowToAttempt(['att-2', 'AP-WK3', 'B', 'b@x.co', ATT.startedAt, ATT.deadlineAt, '', 'IN_PROGRESS', '', '', '', '', '', '', 'yes']);
  assert.equal(fresh.submittedAt, null);
  assert.equal(fresh.autoScore, null);
  assert.equal(fresh.needsManual, null);
  assert.deepEqual(fresh.answers, {});
  assert.equal(fresh.allowNewDevice, true);
});

test('questionRowForSheet keeps formulas like =PMT(...) as visible text', () => {
  assert.deepEqual(
    S.questionRowForSheet(['BAS-INT', 43, 'MCQ', 'Which formula?', '=PMT(24%,3,-5000000)', 'b', '', '', 'D', 1, 'Section C']),
    ['BAS-INT', 43, 'MCQ', "'Which formula?", "'=PMT(24%,3,-5000000)", "'b", '', '', 'D', 1, "'Section C"]);
});

test('internalTestCopy makes an open [INTERNAL TEST] twin with an unguessable id and the same questions', () => {
  const seed = {
    assessment: ['BAS-INT', 'BAS Intermediate', 60, '', '', 'Closed', 'Yes'],
    questions: [['BAS-INT', 1, 'MCQ', 'Q?', 'a', 'b', '', '', 'A', 1, 'Section A']],
  };
  const copy = S.internalTestCopy(seed, '7f3a9c21e4');
  assert.deepEqual(copy.assessment, ['BAS-INT-TEST-7f3a9c21e4', '[INTERNAL TEST] BAS Intermediate', 60, '', '', 'Open', 'Yes']);
  assert.deepEqual(copy.questions, [['BAS-INT-TEST-7f3a9c21e4', 1, 'MCQ', 'Q?', 'a', 'b', '', '', 'A', 1, 'Section A']]);
  assert.equal(S.isInternalCopyOf('bas-int-test-7f3a9c21e4', 'BAS-INT'), true);
  assert.equal(S.isInternalCopyOf('BAS-INT', 'BAS-INT'), false);
  assert.equal(S.isInternalCopyOf('BAS-INT-2-TEST-abc', 'BAS-INT'), false);
  assert.equal(seed.assessment[0], 'BAS-INT');
  assert.equal(seed.questions[0][0], 'BAS-INT');
});

test('rosterEmails lists normalised emails for one assessment only', () => {
  const rows = [['BAS-INT', ' Ana@Mail.com ', 'Ana'], ['bas-int', 'b@x.co', ''], ['OTHER', 'c@x.co', ''], ['BAS-INT', '', 'blank']];
  assert.deepEqual(S.rosterEmails(rows, 'BAS-INT'), ['ana@mail.com', 'b@x.co']);
  assert.deepEqual(S.rosterEmails(rows, 'NONE'), []);
});

test('Attempts has a TimesLeftPage column after the 15 the system rewrites', () => {
  assert.equal(S.HEADERS.Attempts[15], 'TimesLeftPage');
  assert.equal(S.ATTEMPT_ROW_WIDTH, 15);
  assert.deepEqual(S.HEADERS.Roster, ['AssessmentId', 'Email', 'Name']);
});

test('resultRow gives a readable results line with the email as the student ID', () => {
  const done = { ...ATT, autoScore: 34, autoMax: 50, needsManual: false };
  assert.deepEqual(S.resultRow(done, 'BAS Intermediate', 3), [
    "'ana@mail.com", "'Ana Obi", "'BAS Intermediate", 'AP-WK3', 34, 50, 68, 'SUBMITTED', ATT.submittedAt, 3, 'No', 'att-1',
  ]);
  assert.equal(S.resultRow({ ...done, autoScore: 0, autoMax: 0 }, 'T', 0)[6], '');
  assert.equal(S.resultRow({ ...done, autoScore: 1, autoMax: 3 }, 'T', 0)[6], 33.3);
  assert.deepEqual(S.HEADERS.Results, ['StudentId', 'FullName', 'Assessment', 'AssessmentId', 'Score', 'OutOf', 'Percent',
    'Status', 'SubmittedAt', 'TimesLeftPage', 'NeedsManualMarking', 'AttemptId']);
});
