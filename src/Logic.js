/**
 * Pure rules for the timed assessment platform.
 * No Google services here, so the same file runs in Apps Script and in Node tests.
 */

var GRACE_MS = 30000;

function normaliseEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

function computeDeadline(startedAt, durationMinutes, closesAt) {
  var byDuration = new Date(startedAt.getTime() + durationMinutes * 60000);
  if (closesAt && closesAt.getTime() < byDuration.getTime()) return new Date(closesAt.getTime());
  return byDuration;
}

function isOpen(assessment, now) {
  if (String(assessment.status || '').trim().toLowerCase() !== 'open') return false;
  if (assessment.opensAt && now.getTime() < assessment.opensAt.getTime()) return false;
  if (assessment.closesAt && now.getTime() >= assessment.closesAt.getTime()) return false;
  return true;
}

function acceptsWrites(attempt, now) {
  return attempt.status === 'IN_PROGRESS' &&
    now.getTime() <= attempt.deadlineAt.getTime() + GRACE_MS;
}

// Self-contained on purpose: its source is injected into the browser page.
function formatRemaining(ms) {
  var total = Math.max(0, Math.ceil(ms / 1000));
  var h = Math.floor(total / 3600);
  var m = Math.floor((total % 3600) / 60);
  var s = total % 60;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(s);
}

// JSON that is safe to drop inside a <script> tag (no "<" can end the tag early).
function safeJsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function byQNo(questions) {
  return questions.slice().sort(function (a, b) { return a.qNo - b.qNo; });
}

// What the student's browser is allowed to see: everything except the answer key.
function publicQuestions(questions) {
  return byQNo(questions).map(function (q) {
    return { qNo: q.qNo, type: q.type, text: q.text, options: q.options, marks: q.marks, section: q.section || '' };
  });
}

function gradeAnswers(questions, answers) {
  var result = { autoScore: 0, autoMax: 0, needsManual: false };
  questions.forEach(function (q) {
    if (q.type === 'MCQ') {
      result.autoMax += q.marks;
      var given = String(answers[String(q.qNo)] || '').trim().toUpperCase();
      if (given !== '' && given === String(q.answer || '').trim().toUpperCase()) result.autoScore += q.marks;
    } else {
      result.needsManual = true;
    }
  });
  return result;
}

function formatAnswersForSheet(questions, answers) {
  return byQNo(questions).map(function (q) {
    var a = answers[String(q.qNo)];
    return q.qNo + ': ' + (a === undefined || String(a).trim() === '' ? '(blank)' : a);
  }).join('\n');
}

if (typeof module !== 'undefined') {
  module.exports = {
    safeJsonForScript: safeJsonForScript,
    publicQuestions: publicQuestions,
    gradeAnswers: gradeAnswers,
    formatAnswersForSheet: formatAnswersForSheet,
    GRACE_MS: GRACE_MS,
    normaliseEmail: normaliseEmail,
    isValidEmail: isValidEmail,
    computeDeadline: computeDeadline,
    isOpen: isOpen,
    acceptsWrites: acceptsWrites,
    formatRemaining: formatRemaining,
  };
}
