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

if (typeof module !== 'undefined') {
  module.exports = {
    GRACE_MS: GRACE_MS,
    normaliseEmail: normaliseEmail,
    isValidEmail: isValidEmail,
    computeDeadline: computeDeadline,
    isOpen: isOpen,
    acceptsWrites: acceptsWrites,
    formatRemaining: formatRemaining,
  };
}
