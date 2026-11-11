/**
 * Apps Script entry points. Only runs inside Google (uses SpreadsheetApp, HtmlService, etc.).
 * Functions ending in "_" are private: the student page cannot call them.
 */

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Index');
  var params = (e && e.parameter) || {};
  t.boot = safeJsonForScript({
    assessmentId: String(params.a || '').trim(),
    resumeToken: String(params.t || '').trim(),
  });
  t.clientHelpers = formatRemaining.toString();
  t.logo = HtmlService.createHtmlOutputFromFile('LogoImg').getContent();
  return t.evaluate()
    .setTitle('EduBridge Assessment')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// The start lock: stops a double click creating two rows. flush() makes sure the new row is
// really written before the next student is let in.
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function buildApi_() {
  return createApi({
    store: sheetStore(),
    now: function () { return new Date(); },
    newId: function () { return Utilities.getUuid(); },
    withLock: withLock_,
  });
}

function logError_(err) {
  console.error(err && err.stack ? err.stack : err);
}

function apiInfo(assessmentId) {
  return runGuarded(function () { return buildApi_().info(assessmentId); }, logError_);
}

function apiStart(payload) {
  return runGuarded(function () { return buildApi_().start(payload); }, logError_);
}

// Save and submit touch only the student's own row (save writes just the answer columns),
// so they stay unlocked and a whole class can submit at the same second.
function apiSave(payload) {
  return runGuarded(function () { return buildApi_().save(payload); }, logError_);
}

function apiSubmit(payload) {
  return runGuarded(function () { return buildApi_().submit(payload); }, logError_);
}

/**
 * Runs every 5 minutes (installed by setup): closes tests whose time ran out but were never
 * submitted (tab closed, lost connection), using the last autosave. Safe for anyone to trigger,
 * because it only does what the deadline already requires.
 */
function finaliseExpiredJob() {
  var count = buildApi_().finaliseExpired();
  if (count) console.log('Closed ' + count + ' expired attempt(s).');
  return count;
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

var DEMO_ASSESSMENT_ = ['DEMO', 'Demo Quiz', 5, '', '', 'Open', 'Yes'];
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
  // Times typed in the Sheet (OpensAt, ClosesAt) and shown in it are read in Lagos time.
  ss.setSpreadsheetTimeZone('Africa/Lagos');
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

  // Each real assessment gets an internal test twin (always Open, unguessable id) beside the
  // external one students use.
  var real = typeof SEED_ASSESSMENTS !== 'undefined' ? SEED_ASSESSMENTS : [];
  var added = [];
  [{ assessment: DEMO_ASSESSMENT_, questions: DEMO_QUESTIONS_ }].concat(real).forEach(function (seed) {
    if (addAssessmentIfMissing_(ss, seed)) added.push(seed.assessment[0]);
  });
  real.forEach(function (seed) {
    if (assessmentIds_(ss).some(function (id) { return isInternalCopyOf(id, seed.assessment[0]); })) return;
    var copy = internalTestCopy(seed, Utilities.getUuid().replace(/-/g, '').slice(0, 10));
    if (addAssessmentIfMissing_(ss, copy)) added.push(copy.assessment[0]);
  });
  installFinaliseTrigger_();
  console.log('Setup done. Added: ' + (added.length ? added.join(', ') : 'nothing new'));
  console.log('Internal test links use these ids: ' + assessmentIds_(ss).filter(function (id) {
    return /-TEST-/i.test(id);
  }).join(', '));
}

function assessmentIds_(ss) {
  var aSheet = ss.getSheetByName('Assessments');
  if (aSheet.getLastRow() < 2) return [];
  return aSheet.getRange(2, 1, aSheet.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); });
}

function installFinaliseTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'finaliseExpiredJob';
  });
  if (!exists) ScriptApp.newTrigger('finaliseExpiredJob').timeBased().everyMinutes(5).create();
}

function addAssessmentIfMissing_(ss, seed) {
  var id = seed.assessment[0];
  var aSheet = ss.getSheetByName('Assessments');
  var existing = assessmentIds_(ss);
  var at = -1;
  existing.forEach(function (x, i) { if (sameId_(x, id)) at = i; });
  if (at !== -1) {
    // Already there: only fill a blank Shuffle cell from the seed, never overwrite teacher edits.
    var shuffleCell = aSheet.getRange(at + 2, 7);
    if (seed.assessment[6] && cellText_(shuffleCell.getValue()) === '') shuffleCell.setValue(seed.assessment[6]);
    return false;
  }

  aSheet.getRange(aSheet.getLastRow() + 1, 1, 1, HEADERS.Assessments.length)
    .setValues([[id, asText(seed.assessment[1])].concat(seed.assessment.slice(2, 7))
      .concat(['', '', '', '', '', '', ''].slice(0, Math.max(0, 7 - seed.assessment.length)))]);
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
