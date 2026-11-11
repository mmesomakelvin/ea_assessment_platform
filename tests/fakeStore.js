// In-memory stand-in for sheetStore() (src/Store.js). Same ten methods.
// Stores and returns copies so tests can only change state through the API.
function makeFakeStore({ assessments = [], questions = [], roster = [] }) {
  const attempts = [];
  const leaves = {};
  const copy = (x) => (x == null ? null : structuredClone(x));
  return {
    attempts,
    leaves,
    rosterFor: (assessmentId) => roster.filter((r) => r.assessmentId === assessmentId).map((r) => r.email.trim().toLowerCase()),
    incrementLeaves: (attemptId) => {
      const stored = attempts.find((a) => a.attemptId === attemptId);
      if (!stored || stored.status !== 'IN_PROGRESS') return false;
      leaves[attemptId] = (leaves[attemptId] || 0) + 1;
      return true;
    },
    getAssessment: (id) => copy(assessments.find((a) => a.id === id)),
    getQuestions: (assessmentId) =>
      copy(questions.filter((q) => q.assessmentId === assessmentId).sort((a, b) => a.qNo - b.qNo)),
    findAttempt: (assessmentId, email) =>
      copy(attempts.find((a) => a.assessmentId === assessmentId && a.email === email)),
    getAttempt: (attemptId) => copy(attempts.find((a) => a.attemptId === attemptId)),
    saveAnswers: (attempt) => {
      const stored = attempts.find((a) => a.attemptId === attempt.attemptId);
      if (!stored || stored.status !== 'IN_PROGRESS') return false;
      stored.answers = copy(attempt.answers);
      stored.answersText = attempt.answersText;
      stored.lastSavedAt = copy(attempt.lastSavedAt);
      return true;
    },
    finaliseAttempt: (attempt) => {
      const i = attempts.findIndex((a) => a.attemptId === attempt.attemptId);
      if (i === -1 || attempts[i].status !== 'IN_PROGRESS') return false;
      attempts[i] = copy(attempt);
      return true;
    },
    inProgressAttempts: () => copy(attempts.filter((a) => a.status === 'IN_PROGRESS')),
    saveAttempt: (attempt) => {
      const i = attempts.findIndex((a) => a.attemptId === attempt.attemptId);
      if (i === -1) attempts.push(copy(attempt));
      else attempts[i] = copy(attempt);
    },
  };
}

module.exports = { makeFakeStore };
