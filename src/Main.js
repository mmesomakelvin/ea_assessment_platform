/**
 * Apps Script entry points. Only runs inside Google (uses SpreadsheetApp, HtmlService, etc.).
 * Functions ending in "_" are private: the student page cannot call them.
 */

var GENERIC_ERROR = 'Something went wrong. Please try again.';

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Index');
  var params = (e && e.parameter) || {};
  t.boot = safeJsonForScript({
    assessmentId: String(params.a || '').trim(),
    resumeToken: String(params.t || '').trim(),
  });
  t.clientHelpers = formatRemaining.toString();
  return t.evaluate()
    .setTitle('EduBridge Assessment')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function buildApi_() {
  return createApi({
    store: sheetStore(),
    now: function () { return new Date(); },
    newId: function () { return Utilities.getUuid(); },
  });
}

function safely_(fn) {
  try {
    return fn();
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return { ok: false, message: GENERIC_ERROR };
  }
}

function apiInfo(assessmentId) {
  return safely_(function () { return buildApi_().info(assessmentId); });
}

// Locked so a double click cannot create two rows for the same student.
// Save and submit only touch the student's own existing row, so they stay unlocked.
function apiStart(payload) {
  return safely_(function () {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      return buildApi_().start(payload);
    } finally {
      lock.releaseLock();
    }
  });
}

function apiSave(payload) {
  return safely_(function () { return buildApi_().save(payload); });
}

function apiSubmit(payload) {
  return safely_(function () { return buildApi_().submit(payload); });
}

// ---------- Teacher tools (run from the Apps Script editor) ----------

// The student page can technically call any public function, so teacher tools refuse to run
// unless the person running them is the script owner (anonymous visitors have no email here).
function requireOwner_() {
  var active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('Only the script owner can run this from the Apps Script editor.');
  }
}

var DEMO_ASSESSMENT_ = ['DEMO', 'Demo Quiz', 5, '', '', 'Open'];
var DEMO_QUESTIONS_ = [
  ['DEMO', 1, 'MCQ', 'What is 15% of 200?', '20', '30', '35', '40', 'B', 1, 'Section A: Numbers'],
  ['DEMO', 2, 'MCQ', 'A secured loan carries no credit risk because the lender holds collateral.', 'True', 'False', '', '', 'B', 1, 'Section A: Numbers'],
  ['DEMO', 3, 'SHORT', 'In one sentence, what is working capital?', '', '', '', '', '', 2, 'Section B: Short answer'],
];

/** Creates the three tabs, the demo assessment and any SEED_ASSESSMENTS. Safe to run again. */
function setup() {
  requireOwner_();
  var ss = SpreadsheetApp.getActive();
  if (!ss) {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('SHEET_ID');
    ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('EA Assessments');
    props.setProperty('SHEET_ID', ss.getId());
  }
  console.log('Using spreadsheet: ' + ss.getUrl());
  Object.keys(HEADERS).forEach(function (name) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = HEADERS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold')
      .setBackground('#154B54').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  ss.getSheetByName('Assessments').getRange('D:E').setNumberFormat('yyyy-mm-dd hh:mm');
  ss.getSheetByName('Attempts').getRange('E:G').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  ss.getSheetByName('Attempts').getRange('N:N').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  var seeds = [{ assessment: DEMO_ASSESSMENT_, questions: DEMO_QUESTIONS_ }]
    .concat(typeof SEED_ASSESSMENTS !== 'undefined' ? SEED_ASSESSMENTS : []);
  var added = [];
  seeds.forEach(function (seed) {
    if (addAssessmentIfMissing_(ss, seed)) added.push(seed.assessment[0]);
  });
  console.log('Setup done. Added: ' + (added.length ? added.join(', ') : 'nothing new'));
}

function addAssessmentIfMissing_(ss, seed) {
  var id = seed.assessment[0];
  var aSheet = ss.getSheetByName('Assessments');
  var existing = aSheet.getLastRow() < 2 ? [] : aSheet.getRange(2, 1, aSheet.getLastRow() - 1, 1).getValues();
  if (existing.some(function (r) { return sameId_(r[0], id); })) return false;

  aSheet.getRange(aSheet.getLastRow() + 1, 1, 1, HEADERS.Assessments.length)
    .setValues([[id, asText(seed.assessment[1])].concat(seed.assessment.slice(2))]);
  var qSheet = ss.getSheetByName('Questions');
  var rows = seed.questions.map(questionRowForSheet);
  qSheet.getRange(qSheet.getLastRow() + 1, 1, rows.length, HEADERS.Questions.length).setValues(rows);
  return true;
}

/** End-to-end check against the real Sheet using the DEMO assessment. Leaves one SUBMITTED row. */
function smokeTest() {
  requireOwner_();
  var api = buildApi_();
  var email = 'smoke+' + Date.now() + '@example.com';
  var info = api.info('DEMO');
  console.log('info', JSON.stringify(info));
  if (!info.ok) throw new Error('Smoke test failed: info');
  var started = api.start({ assessmentId: 'DEMO', name: 'Smoke Test', email: email });
  console.log('start', JSON.stringify({ ok: started.ok, remainingMs: started.remainingMs, questions: started.questions && started.questions.length }));
  if (!started.ok) throw new Error('Smoke test failed: start');
  var saved = api.save({ attemptId: started.attemptId, answers: { '1': 'B' } });
  console.log('save', JSON.stringify(saved));
  if (!saved.ok) throw new Error('Smoke test failed: save');
  var submitted = api.submit({ attemptId: started.attemptId, answers: { '1': 'B', '2': 'B', '3': 'Current assets minus current liabilities' } });
  console.log('submit', JSON.stringify(submitted));
  if (!submitted.ok || submitted.status !== 'SUBMITTED') throw new Error('Smoke test failed: submit');
  console.log('Smoke test passed. Check the last row of the Attempts tab (AutoScore should be 2 of 2).');
}
