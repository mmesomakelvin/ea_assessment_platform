/**
 * The attempt engine: info / start / save / submit / finaliseExpired.
 * Depends only on a store (see tests/fakeStore.js for the interface), a clock, an id maker and an
 * optional lock, so the same code runs against the real Sheet (Main.js) and in Node tests.
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
  anotherDevice: 'This email has already started this assessment on another device or browser. Please continue there, or ask your instructor to allow a new device.',
  generic: 'Something went wrong. Please try again.',
  notOnRoster: 'This email is not on the list for this assessment. Please use the email address you registered with, or ask your instructor.',
};

// Keep only answers to real questions: a valid letter for MCQ, capped text for written answers.
function cleanAnswers(raw, questions) {
  var out = {};
  if (!raw || typeof raw !== 'object') return out;
  var limits = answerLimits(questions);
  questions.forEach(function (q) {
    var key = String(q.qNo);
    if (!Object.prototype.hasOwnProperty.call(raw, key)) return;
    var v = raw[key];
    if (v === null || v === undefined || typeof v === 'object') return;
    if (q.type === 'MCQ') {
      var letter = String(v).trim().toUpperCase();
      var valid = (q.options || []).some(function (text, i) { return text !== '' && String.fromCharCode(65 + i) === letter; });
      if (valid) out[key] = letter;
    } else {
      out[key] = String(v).slice(0, limits[key]);
    }
  });
  return out;
}

// Any crash becomes a polite message the page knows it can retry.
function runGuarded(fn, onError) {
  try {
    return fn();
  } catch (err) {
    onError(err);
    return { ok: false, retry: true, message: MESSAGES.generic };
  }
}

function createApi(deps) {
  var store = deps.store;
  var now = deps.now;
  var newId = deps.newId;
  var withLock = deps.withLock || function (fn) { return fn(); };

  function finalise(attempt, questions, status, t) {
    var g = gradeAnswers(questions, attempt.answers);
    attempt.status = status;
    attempt.submittedAt = t;
    attempt.autoScore = g.autoScore;
    attempt.autoMax = g.autoMax;
    attempt.needsManual = g.needsManual;
    attempt.answersText = formatAnswersForSheet(questions, attempt.answers);
    // Writes only if the row still says IN_PROGRESS right now, so two closers can never clash.
    if (!store.finaliseAttempt(attempt)) return false;
    var assessment = store.getAssessment(attempt.assessmentId);
    store.saveResult(attempt, assessment ? assessment.title : attempt.assessmentId);
    return true;
  }

  function examPayload(assessment, questions, attempt, t) {
    return {
      ok: true,
      attemptId: attempt.attemptId,
      title: assessment.title,
      questions: publicQuestions(questions, assessment.shuffle ? attempt.attemptId : null),
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
    var a = store.getAssessment(String(p.assessmentId || '').trim());
    if (!a) return { ok: false, message: MESSAGES.invalidLink };

    var name = String(p.name || '').trim();
    var email = normaliseEmail(p.email);
    if (!name || !isValidEmail(email)) return { ok: false, message: MESSAGES.badDetails };

    // If the teacher listed students for this assessment in the Roster tab, only they can start,
    // so nobody gets a second try by typing a different email.
    var roster = store.rosterFor(a.id);
    if (roster.length && roster.indexOf(email) === -1) return { ok: false, message: MESSAGES.notOnRoster };

    var questions = store.getQuestions(a.id);

    // Only the duplicate check and the insert run inside the lock, so a class starting
    // together queues for as short a time as possible.
    return withLock(function () {
      var t = now();
      var existing = store.findAttempt(a.id, email);
      if (existing) {
        if (existing.status !== 'IN_PROGRESS') return { ok: false, message: MESSAGES.alreadySubmitted };
        if (t.getTime() >= existing.deadlineAt.getTime()) {
          finalise(existing, questions, 'AUTO_SUBMITTED', t);
          return { ok: false, message: MESSAGES.timeRanOut };
        }
        // Only the browser that started the attempt holds its id. Anyone else typing the same
        // email is refused unless the teacher set AllowNewDevice to Yes (used once, then cleared).
        if (String(p.resumeToken || '') !== existing.attemptId) {
          if (!existing.allowNewDevice) return { ok: false, message: MESSAGES.anotherDevice };
          existing.allowNewDevice = false;
          store.saveAttempt(existing);
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
        allowNewDevice: false,
      };
      store.saveAttempt(attempt);
      return examPayload(a, questions, attempt, t);
    });
  }

  function save(payload) {
    var p = payload || {};
    var t = now();
    var attempt = store.getAttempt(String(p.attemptId || ''));
    if (!attempt) return { ok: false, message: MESSAGES.attemptNotFound };
    if (!acceptsWrites(attempt, t)) return { ok: false, timeUp: true };

    var questions = store.getQuestions(attempt.assessmentId);
    attempt.answers = cleanAnswers(p.answers, questions);
    attempt.lastSavedAt = t;
    attempt.answersText = formatAnswersForSheet(questions, attempt.answers);
    // Writes only the answer columns, and only if the row is still IN_PROGRESS right now.
    if (!store.saveAnswers(attempt)) return { ok: false, timeUp: true };
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
      attempt.answers = cleanAnswers(p.answers, questions);
      finalise(attempt, questions, 'SUBMITTED', t);
      return { ok: true, status: 'SUBMITTED' };
    }
    finalise(attempt, questions, 'AUTO_SUBMITTED', t);
    return { ok: true, status: 'AUTO_SUBMITTED', message: MESSAGES.lateSubmit };
  }

  // Closes attempts whose time (plus grace) ran out without a submit, using their last autosave.
  function finaliseExpired() {
    var t = now();
    var questionsFor = {};
    var count = 0;
    store.inProgressAttempts().forEach(function (attempt) {
      if (acceptsWrites(attempt, t)) return;
      if (!questionsFor[attempt.assessmentId]) questionsFor[attempt.assessmentId] = store.getQuestions(attempt.assessmentId);
      if (finalise(attempt, questionsFor[attempt.assessmentId], 'AUTO_SUBMITTED', t)) count++;
    });
    return count;
  }

  // Counts each time a student leaves an unfinished test page (switches tab, minimises, closes).
  function recordLeave(payload) {
    var p = payload || {};
    var attempt = store.getAttempt(String(p.attemptId || ''));
    if (!attempt) return { ok: false, message: MESSAGES.attemptNotFound };
    if (attempt.status !== 'IN_PROGRESS') return { ok: true, counted: false };
    return { ok: true, counted: store.incrementLeaves(attempt.attemptId) };
  }

  return { info: info, start: start, save: save, submit: submit, finaliseExpired: finaliseExpired, recordLeave: recordLeave };
}

if (typeof module !== 'undefined') {
  module.exports = { createApi: createApi, cleanAnswers: cleanAnswers, runGuarded: runGuarded, MESSAGES: MESSAGES };
}
