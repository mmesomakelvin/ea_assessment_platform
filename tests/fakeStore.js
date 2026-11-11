// In-memory stand-in for sheetStore() (src/Store.js). Same seven methods.
// Stores and returns copies so tests can only change state through the API.
function makeFakeStore({ assessments = [], questions = [] }) {
  const attempts = [];
  const copy = (x) => (x == null ? null : structuredClone(x));
  return {
    attempts,
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
    inProgressAttempts: () => copy(attempts.filter((a) => a.status === 'IN_PROGRESS')),
    saveAttempt: (attempt) => {
      const i = attempts.findIndex((a) => a.attemptId === attempt.attemptId);
      if (i === -1) attempts.push(copy(attempt));
      else attempts[i] = copy(attempt);
    },
  };
}

module.exports = { makeFakeStore };
