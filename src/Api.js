/**
 * The attempt engine: info / start / save / submit.
 * Depends only on a store (see tests/fakeStore.js for the interface), a clock and an id maker,
 * so the same code runs against the real Sheet (Main.js) and in Node tests.
 * Uses the rule functions from Logic.js, which are globals in Apps Script.
 */

var MESSAGES = {
  invalidLink: 'This assessment link is not valid.',
  notOpen: 'This assessment is not open right now.',
  badDetails: 'Please enter your full name and a valid email address.',
  alreadySubmitted: 'You have already submitted this assessment.',
  timeRanOut: 'Your time ran out. Your saved answers were submitted.',
  attemptNotFound: 'Attempt not found. Please reopen the assessment link.',
  lateSubmit: 'Time was up. Your answers saved before the deadline were submitted.',
};

// Keep only a flat { "qNo": "text" } object, whatever the browser sent.
function cleanAnswers(raw) {
  var out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw).forEach(function (k) {
    var v = raw[k];
    if (v !== null && v !== undefined && typeof v !== 'object') out[String(k)] = String(v);
  });
  return out;
}

function createApi(deps) {
  var store = deps.store;
  var now = deps.now;
  var newId = deps.newId;

  function finalise(attempt, questions, status, t) {
    var g = gradeAnswers(questions, attempt.answers);
    attempt.status = status;
    attempt.submittedAt = t;
    attempt.autoScore = g.autoScore;
    attempt.autoMax = g.autoMax;
    attempt.needsManual = g.needsManual;
    attempt.answersText = formatAnswersForSheet(questions, attempt.answers);
    store.saveAttempt(attempt);
  }

  function examPayload(assessment, questions, attempt, t) {
    return {
      ok: true,
      attemptId: attempt.attemptId,
      title: assessment.title,
      questions: publicQuestions(questions),
      answers: attempt.answers,
      remainingMs: attempt.deadlineAt.getTime() - t.getTime(),
    };
  }

  function info(assessmentId) {
    var a = store.getAssessment(String(assessmentId || '').trim());
    if (!a) return { ok: false, message: MESSAGES.invalidLink };
    return { ok: true, title: a.title, durationMinutes: a.durationMinutes };
  }

  function start(payload) {
    var p = payload || {};
    var t = now();
    var a = store.getAssessment(String(p.assessmentId || '').trim());
    if (!a) return { ok: false, message: MESSAGES.invalidLink };

    var name = String(p.name || '').trim();
    var email = normaliseEmail(p.email);
    if (!name || !isValidEmail(email)) return { ok: false, message: MESSAGES.badDetails };

    var questions = store.getQuestions(a.id);
    var existing = store.findAttempt(a.id, email);
    if (existing) {
      if (existing.status !== 'IN_PROGRESS') return { ok: false, message: MESSAGES.alreadySubmitted };
      if (t.getTime() >= existing.deadlineAt.getTime()) {
        finalise(existing, questions, 'AUTO_SUBMITTED', t);
        return { ok: false, message: MESSAGES.timeRanOut };
      }
      return examPayload(a, questions, existing, t);
    }

    if (!isOpen(a, t)) return { ok: false, message: MESSAGES.notOpen };

    var attempt = {
      attemptId: newId(),
      assessmentId: a.id,
      name: name,
      email: email,
      startedAt: t,
      deadlineAt: computeDeadline(t, a.durationMinutes, a.closesAt),
      submittedAt: null,
      status: 'IN_PROGRESS',
      autoScore: null,
      autoMax: null,
      needsManual: null,
      answers: {},
      answersText: formatAnswersForSheet(questions, {}),
      lastSavedAt: null,
    };
    store.saveAttempt(attempt);
    return examPayload(a, questions, attempt, t);
  }

  function save(payload) {
    var p = payload || {};
    var t = now();
    var attempt = store.getAttempt(String(p.attemptId || ''));
    if (!attempt) return { ok: false, message: MESSAGES.attemptNotFound };
    if (!acceptsWrites(attempt, t)) return { ok: false, timeUp: true };

    attempt.answers = cleanAnswers(p.answers);
    attempt.lastSavedAt = t;
    attempt.answersText = formatAnswersForSheet(store.getQuestions(attempt.assessmentId), attempt.answers);
    store.saveAttempt(attempt);
    return { ok: true, remainingMs: attempt.deadlineAt.getTime() - t.getTime() };
  }

  function submit(payload) {
    var p = payload || {};
    var t = now();
    var attempt = store.getAttempt(String(p.attemptId || ''));
    if (!attempt) return { ok: false, message: MESSAGES.attemptNotFound };
    if (attempt.status !== 'IN_PROGRESS') return { ok: true, status: attempt.status };

    var questions = store.getQuestions(attempt.assessmentId);
    if (acceptsWrites(attempt, t)) {
      attempt.answers = cleanAnswers(p.answers);
      finalise(attempt, questions, 'SUBMITTED', t);
      return { ok: true, status: 'SUBMITTED' };
    }
    finalise(attempt, questions, 'AUTO_SUBMITTED', t);
    return { ok: true, status: 'AUTO_SUBMITTED', message: MESSAGES.lateSubmit };
  }

  return { info: info, start: start, save: save, submit: submit };
}

if (typeof module !== 'undefined') {
  module.exports = { createApi: createApi, cleanAnswers: cleanAnswers, MESSAGES: MESSAGES };
}
