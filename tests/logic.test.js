const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/Logic.js');
const at = (iso) => new Date(iso);

test('normaliseEmail trims and lowercases', () => {
  assert.equal(L.normaliseEmail('  John.Doe@Mail.COM '), 'john.doe@mail.com');
});

test('isValidEmail', () => {
  assert.equal(L.isValidEmail('a@b.co'), true);
  assert.equal(L.isValidEmail('a@b'), false);
  assert.equal(L.isValidEmail(''), false);
});

test('computeDeadline uses start + duration when close is later or blank', () => {
  const s = at('2026-11-12T10:00:00Z');
  assert.equal(L.computeDeadline(s, 45, null).toISOString(), '2026-11-12T10:45:00.000Z');
  assert.equal(L.computeDeadline(s, 45, at('2026-11-12T12:00:00Z')).toISOString(), '2026-11-12T10:45:00.000Z');
});

test('computeDeadline is capped by closing time', () => {
  const s = at('2026-11-12T11:40:00Z');
  assert.equal(L.computeDeadline(s, 45, at('2026-11-12T12:00:00Z')).toISOString(), '2026-11-12T12:00:00.000Z');
});

test('isOpen respects status and window', () => {
  const a = { status: 'Open', opensAt: at('2026-11-12T09:00:00Z'), closesAt: at('2026-11-12T12:00:00Z') };
  assert.equal(L.isOpen(a, at('2026-11-12T10:00:00Z')), true);
  assert.equal(L.isOpen({ ...a, status: 'open' }, at('2026-11-12T10:00:00Z')), true);
  assert.equal(L.isOpen({ ...a, status: 'Closed' }, at('2026-11-12T10:00:00Z')), false);
  assert.equal(L.isOpen(a, at('2026-11-12T08:59:59Z')), false);
  assert.equal(L.isOpen(a, at('2026-11-12T12:00:00Z')), false);
  assert.equal(L.isOpen({ status: 'Open', opensAt: null, closesAt: null }, at('2030-01-01T00:00:00Z')), true);
});

test('acceptsWrites allows 30s grace then refuses', () => {
  const d = at('2026-11-12T10:45:00Z');
  const att = { status: 'IN_PROGRESS', deadlineAt: d };
  assert.equal(L.acceptsWrites(att, new Date(d.getTime() + 30000)), true);
  assert.equal(L.acceptsWrites(att, new Date(d.getTime() + 30001)), false);
  assert.equal(L.acceptsWrites({ ...att, status: 'SUBMITTED' }, d), false);
});

test('formatRemaining rounds up to whole seconds and never goes negative', () => {
  assert.equal(L.formatRemaining(300000), '05:00');
  assert.equal(L.formatRemaining(59001), '01:00');
  assert.equal(L.formatRemaining(1), '00:01');
  assert.equal(L.formatRemaining(3725000), '1:02:05');
  assert.equal(L.formatRemaining(0), '00:00');
  assert.equal(L.formatRemaining(-5000), '00:00');
});
