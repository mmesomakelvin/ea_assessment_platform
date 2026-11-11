/**
 * The Google Sheet adapter. sheetStore() implements the store interface used by createApi
 * (same five methods as tests/fakeStore.js). The row mappers below are pure and unit-tested.
 */

var TABS = {
  assessments: 'Assessments',
  questions: 'Questions',
  attempts: 'Attempts',
};

var HEADERS = {
  Assessments: ['AssessmentId', 'Title', 'DurationMinutes', 'OpensAt', 'ClosesAt', 'Status', 'Shuffle'],
  Questions: ['AssessmentId', 'QNo', 'Type', 'Question', 'OptionA', 'OptionB', 'OptionC', 'OptionD', 'Answer', 'Marks', 'Section'],
  Attempts: ['AttemptId', 'AssessmentId', 'Name', 'Email', 'StartedAt', 'DeadlineAt', 'SubmittedAt', 'Status',
    'AutoScore', 'AutoMax', 'NeedsManualMarking', 'Answers', 'AnswersJSON', 'LastSavedAt', 'AllowNewDevice'],
};

function cellText_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function cellDate_(v) {
  if (v instanceof Date) return v;
  if (v === '' || v === null || v === undefined) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function cellNumberOrNull_(v) {
  return v === '' || v === null || v === undefined ? null : Number(v);
}

// A leading apostrophe makes Sheets store the value as plain text: no formulas, no auto-dates.
function asText(s) {
  var str = s === null || s === undefined ? '' : String(s);
  return str === '' ? '' : "'" + str;
}

function rowToAssessment(row) {
  return {
    id: cellText_(row[0]),
    title: cellText_(row[1]),
    durationMinutes: Number(row[2]),
    opensAt: cellDate_(row[3]),
    closesAt: cellDate_(row[4]),
    status: cellText_(row[5]),
    shuffle: cellText_(row[6]).toLowerCase() === 'yes',
  };
}

function rowToQuestion(row) {
  var options = [row[4], row[5], row[6], row[7]].map(cellText_);
  while (options.length && options[options.length - 1] === '') options.pop();
  return {
    assessmentId: cellText_(row[0]),
    qNo: Number(row[1]),
    type: cellText_(row[2]).toUpperCase(),
    text: cellText_(row[3]),
    options: options,
    answer: cellText_(row[8]).toUpperCase(),
    marks: row[9] === '' || row[9] === null || row[9] === undefined ? 1 : Number(row[9]),
    section: cellText_(row[10]),
  };
}

// Question, OptionA to OptionD and Section are free text: keep them as text when written by code.
function questionRowForSheet(row) {
  return row.map(function (v, i) { return (i === 3 || (i >= 4 && i <= 7) || i === 10) ? asText(v) : v; });
}

// Every assessment ships in two versions: the external one students get, and an always-open
// internal twin for staff. The twin's id ends in a random code (e.g. BAS-INT-TEST-7f3a9c21e4)
// so students cannot guess it and read the questions before the real one opens.
function internalTestCopy(seed, suffix) {
  var id = seed.assessment[0] + '-TEST-' + suffix;
  return {
    assessment: [id, '[INTERNAL TEST] ' + seed.assessment[1]]
      .concat(seed.assessment.slice(2, 5), ['Open'], seed.assessment.slice(6)),
    questions: seed.questions.map(function (row) { return [id].concat(row.slice(1)); }),
  };
}

function isInternalCopyOf(candidateId, baseId) {
  var prefix = cellText_(baseId).toUpperCase() + '-TEST-';
  var c = cellText_(candidateId).toUpperCase();
  return c.indexOf(prefix) === 0 && c.length > prefix.length && c.slice(prefix.length).indexOf('-') === -1;
}

function attemptToRow(a) {
  var blankIfNull = function (v) { return v === null || v === undefined ? '' : v; };
  return [
    a.attemptId,
    a.assessmentId,
    asText(a.name),
    asText(a.email),
    a.startedAt,
    a.deadlineAt,
    blankIfNull(a.submittedAt),
    a.status,
    blankIfNull(a.autoScore),
    blankIfNull(a.autoMax),
    a.needsManual === null || a.needsManual === undefined ? '' : (a.needsManual ? 'Yes' : 'No'),
    asText(a.answersText),
    asText(JSON.stringify(a.answers || {})),
    blankIfNull(a.lastSavedAt),
    a.allowNewDevice ? 'Yes' : '',
  ];
}

function rowToAttempt(row) {
  var manual = cellText_(row[10]).toLowerCase();
  var json = cellText_(row[12]);
  return {
    attemptId: cellText_(row[0]),
    assessmentId: cellText_(row[1]),
    name: cellText_(row[2]),
    email: cellText_(row[3]),
    startedAt: cellDate_(row[4]),
    deadlineAt: cellDate_(row[5]),
    submittedAt: cellDate_(row[6]),
    status: cellText_(row[7]),
    autoScore: cellNumberOrNull_(row[8]),
    autoMax: cellNumberOrNull_(row[9]),
    needsManual: manual === '' ? null : manual === 'yes',
    answers: json ? JSON.parse(json) : {},
    answersText: String(row[11] === null || row[11] === undefined ? '' : row[11]),
    lastSavedAt: cellDate_(row[13]),
    allowNewDevice: cellText_(row[14]).toLowerCase() === 'yes',
  };
}

function sameId_(a, b) {
  return cellText_(a).toUpperCase() === cellText_(b).toUpperCase();
}

// Works whether the script is attached to a Sheet or standalone (then setup() records SHEET_ID).
function getSpreadsheet_() {
  var active = SpreadsheetApp.getActive();
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('No spreadsheet linked yet. Run setup() once from the Apps Script editor.');
  return SpreadsheetApp.openById(id);
}

function sheetStore() {
  var ss = getSpreadsheet_();

  function rows(tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet || sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS[tabName].length).getValues();
  }

  function attemptRowIndex(attemptId) {
    var sheet = ss.getSheetByName(TABS.attempts);
    if (sheet.getLastRow() < 2) return -1;
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === attemptId) return i + 2;
    return -1;
  }

  return {
    getAssessment: function (id) {
      var found = rows(TABS.assessments).filter(function (r) { return sameId_(r[0], id); })[0];
      return found ? rowToAssessment(found) : null;
    },
    getQuestions: function (assessmentId) {
      return rows(TABS.questions)
        .filter(function (r) { return sameId_(r[0], assessmentId) && cellText_(r[3]) !== ''; })
        .map(rowToQuestion)
        .sort(function (a, b) { return a.qNo - b.qNo; });
    },
    findAttempt: function (assessmentId, email) {
      var found = rows(TABS.attempts).filter(function (r) {
        return sameId_(r[1], assessmentId) && cellText_(r[3]).toLowerCase() === email;
      })[0];
      return found ? rowToAttempt(found) : null;
    },
    getAttempt: function (attemptId) {
      var found = rows(TABS.attempts).filter(function (r) { return String(r[0]) === attemptId; })[0];
      return found ? rowToAttempt(found) : null;
    },
    // Autosave writes only Answers, AnswersJSON and LastSavedAt (columns L:N), and only while the
    // row still says IN_PROGRESS, so a slow autosave can never undo a submission.
    saveAnswers: function (attempt) {
      var sheet = ss.getSheetByName(TABS.attempts);
      var rowIndex = attemptRowIndex(attempt.attemptId);
      if (rowIndex === -1) return false;
      if (String(sheet.getRange(rowIndex, 8).getValue()) !== 'IN_PROGRESS') return false;
      var full = attemptToRow(attempt);
      sheet.getRange(rowIndex, 12, 1, 3).setValues([full.slice(11, 14)]);
      return true;
    },
    inProgressAttempts: function () {
      return rows(TABS.attempts)
        .filter(function (r) { return cellText_(r[7]) === 'IN_PROGRESS'; })
        .map(rowToAttempt);
    },
    saveAttempt: function (attempt) {
      var sheet = ss.getSheetByName(TABS.attempts);
      var rowIndex = attemptRowIndex(attempt.attemptId);
      if (rowIndex === -1) rowIndex = sheet.getLastRow() + 1;
      sheet.getRange(rowIndex, 1, 1, HEADERS.Attempts.length).setValues([attemptToRow(attempt)]);
    },
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    HEADERS: HEADERS,
    asText: asText,
    rowToAssessment: rowToAssessment,
    rowToQuestion: rowToQuestion,
    questionRowForSheet: questionRowForSheet,
    internalTestCopy: internalTestCopy,
    isInternalCopyOf: isInternalCopyOf,
    attemptToRow: attemptToRow,
    rowToAttempt: rowToAttempt,
  };
}
