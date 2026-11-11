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

// Written answers are capped so that all of a student's answers fit in one Sheet cell
// (Sheets allows 50,000 characters; we keep free text to 20,000 in total).
var SHORT_MAX = 500;
var PARAGRAPH_MAX = 10000;
var FREE_TEXT_BUDGET = 20000;

function answerLimits(questions) {
  var free = questions.filter(function (q) { return q.type !== 'MCQ'; }).length;
  var share = free ? Math.floor(FREE_TEXT_BUDGET / free) : 0;
  var limits = {};
  questions.forEach(function (q) {
    var cap = q.type === 'MCQ' ? 1 : (q.type === 'SHORT' ? SHORT_MAX : PARAGRAPH_MAX);
    limits[String(q.qNo)] = q.type === 'MCQ' ? 1 : Math.min(cap, share);
  });
  return limits;
}

// Repeatable random numbers from a text seed (the attempt id), so a student's shuffle
// is the same every time they reload, and different from their classmates'.
function seededRandom_(seed) {
  var h = 1779033703 ^ seed.length;
  for (var i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  var a = h >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled_(items, rand) {
  var out = items.slice();
  for (var i = out.length - 1; i > 0; i--) {
    var j = Math.floor(rand() * (i + 1));
    var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

function isTrueFalse_(options) {
  var texts = options.map(function (o) { return o.text.toLowerCase(); });
  return texts.length === 2 && texts[0] === 'true' && texts[1] === 'false';
}

// What the student's browser is allowed to see: everything except the answer key.
// Options carry their original letter, so marking works whatever order they are shown in.
// With a shuffleSeed, questions are shuffled inside each section and MCQ options are shuffled
// (True/False stays in order).
function publicQuestions(questions, shuffleSeed) {
  var limits = answerLimits(questions);
  var rand = shuffleSeed ? seededRandom_(String(shuffleSeed)) : null;
  var list = byQNo(questions).map(function (q) {
    var options = (q.options || []).map(function (text, i) {
      return { letter: String.fromCharCode(65 + i), text: text };
    }).filter(function (o) { return o.text !== ''; });
    if (rand && !isTrueFalse_(options)) options = shuffled_(options, rand);
    return {
      qNo: q.qNo, type: q.type, text: q.text, marks: q.marks, section: q.section || '',
      maxLength: limits[String(q.qNo)], options: options,
    };
  });
  if (!rand) return list;

  var sections = [];
  var bySection = {};
  list.forEach(function (q) {
    if (!bySection.hasOwnProperty(q.section)) { bySection[q.section] = []; sections.push(q.section); }
    bySection[q.section].push(q);
  });
  return sections.reduce(function (out, s) { return out.concat(shuffled_(bySection[s], rand)); }, []);
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
    answerLimits: answerLimits,
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
