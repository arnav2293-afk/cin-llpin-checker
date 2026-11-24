// Run with: node --test test/validator.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../validator.js');

const opts = { currentYear: 2026 };
const check = (id) => V.validate(id, 1, opts);
const msgs = (r) => r.errors.map((e) => e.msg).join(' | ');

test('valid listed public company', () => {
  const r = check('L17110MH1973PLC019786');
  assert.equal(r.valid, true, msgs(r));
  assert.equal(r.kind, 'CIN');
  assert.deepEqual(
    [r.fields.kind, r.fields.listed, r.fields.state, r.fields.year, r.fields.typeName],
    ['Company', 'Listed', 'Maharashtra', '1973', 'Public limited company']
  );
  assert.equal(r.summary, 'A listed public limited company, registered in Maharashtra in 1973.');
  assert.equal(r.segments.length, 6);
});

test('valid unlisted private, OPC and government companies', () => {
  for (const id of ['U72200KA2008PTC045678', 'U74999DL2019OPC351234', 'U40100TN1957GOI002345', 'U72200TG2007PTC053444']) {
    assert.equal(check(id).valid, true, id + ': ' + msgs(check(id)));
  }
});

test('valid LLPIN, with and without hyphen', () => {
  const r = check('AAB-1234');
  assert.equal(r.valid, true);
  assert.equal(r.kind, 'LLPIN');
  assert.equal(r.fields.kind, 'LLP');
  const r2 = check('aab1234');
  assert.equal(r2.valid, true);
  assert.equal(r2.id, 'AAB-1234');
  assert.ok(r2.notes.includes('Hyphen added'));
});

test('bad state code names characters 7-8', () => {
  const r = check('U72200XX2015PTC123456');
  assert.equal(r.valid, false);
  assert.equal(r.errors[0].msg, 'Characters 7–8: “XX” is not a valid Indian state code.');
  assert.equal(r.segments.find((s) => s.key === 'state').bad, true);
});

test('state code hint for common mistakes', () => {
  assert.match(msgs(check('U72200OD2015PTC123456')), /CINs use “OR” for Odisha/);
});

test('future year', () => {
  assert.match(msgs(check('L17110MH2031PLC019786')), /^Characters 9–12: “2031” is in the future\. The year must be between 1850 and 2026\.$/);
});

test('unknown company type', () => {
  assert.match(msgs(check('U72200KA2008ABC045678')), /Characters 13–15: “ABC” is not a known company type/);
});

test('wrong length says how many characters', () => {
  const r = check('U7220KA2008PTC04567');
  assert.match(msgs(r), /^Has 19 characters\. A CIN must be exactly 21.*\(2 characters missing\)\.$/);
});

test('bad LLPIN explains both halves', () => {
  const m = msgs(check('AB-12345'));
  assert.match(m, /Before the hyphen: “AB” must be exactly 3 letters \(this has 2\)\./);
  assert.match(m, /After the hyphen: “12345” must be exactly 4 digits \(this has 5\)\./);
});

test('first character must be L or U', () => {
  assert.match(msgs(check('X17110MH1973PLC019786')), /^Character 1: “X” must be L \(listed\) or U \(unlisted\)\.$/);
});

test('letter O instead of zero gets a hint when no one-click fix exists', () => {
  assert.match(msgs(check('U72200XX2015PTCO23456')), /letter O or I instead of a zero/);
  // With a fix available, the fix replaces the hint.
  assert.doesNotMatch(msgs(check('L17110MH1973PLCO19786')), /letter O or I/);
});

test('private company cannot be listed', () => {
  const r = check('L72200KA2008PTC045678');
  assert.equal(r.valid, false);
  assert.match(msgs(r), /Private companies can’t be listed/);
});

test('OPC before 2014 is flagged', () => {
  assert.match(msgs(check('U74999DL2010OPC351234')), /only exist from 2014/);
});

test('recognises PAN and GSTIN', () => {
  assert.match(msgs(check('ABCDE1234F')), /looks like a PAN/);
  assert.match(msgs(check('27ABCDE1234F1Z5')), /looks like a GSTIN/);
});

test('cleans spaces and lowercase', () => {
  const r = check('  l17110 mh1973plc019786 ');
  assert.equal(r.valid, true);
  assert.equal(r.id, 'L17110MH1973PLC019786');
  assert.ok(r.notes.includes('Spaces removed'));
  assert.ok(r.notes.includes('Changed to capitals'));
});

test('validateText skips blanks, keeps line numbers, flags duplicates', () => {
  const { results } = V.validateText('L17110MH1973PLC019786\n\n  \nAAB-1234\nl17110mh1973plc019786', opts);
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.line), [1, 4, 5]);
  assert.equal(results[2].duplicateOf, 1);
});

test('validateText splits commas and tabs, and caps very long input', () => {
  assert.equal(V.validateText('AAB-1234, AAC-1234\tAAD-1234', opts).results.length, 3);
  const big = Array.from({ length: 6000 }, () => 'AAB-1234').join('\n');
  const out = V.validateText(big, { ...opts, max: 5000 });
  assert.equal(out.results.length, 5000);
  assert.equal(out.truncated, true);
});

test('bad character ranges point at the wrong part', () => {
  assert.deepEqual(check('U72200XX2015PTC123456').badRanges, [[6, 8]]);
  assert.deepEqual(check('L17110MH2031PLC019786').badRanges, [[8, 12]]);
  assert.deepEqual(check('AB-12345').badRanges, [[0, 2], [3, 8]]);
  assert.deepEqual(check('L17110MH1973PLC019786').badRanges, []);
});

test('suggests a fix for obvious typos only', () => {
  assert.equal(check('L17110MH1973PLCO19786').suggestion, 'L17110MH1973PLC019786');
  assert.equal(check('U72200OD2015PTC123456').suggestion, 'U72200OR2015PTC123456');
  assert.equal(check('AAB-12O4').suggestion, 'AAB-1204');
  assert.equal(check('U72200XX2015PTC123456').suggestion, undefined);
  assert.equal(check('L17110MH2031PLC019786').suggestion, undefined);
});

test('strips a pasted label, but never eats a real LLPIN', () => {
  for (const id of ['CIN: L17110MH1973PLC019786', 'cin no. L17110MH1973PLC019786', 'CIN L17110MH1973PLC019786']) {
    const r = check(id);
    assert.equal(r.valid, true, id);
    assert.equal(r.id, 'L17110MH1973PLC019786');
  }
  assert.equal(check('LLPIN: AAB-1234').id, 'AAB-1234');
  assert.equal(check('CIN-1234').id, 'CIN-1234');
  assert.equal(check('CIN-1234').valid, true);
});

test('empty halves of an LLPIN get a clear message', () => {
  assert.equal(msgs(check('AAB-')), 'Nothing after the hyphen. An LLPIN ends with 4 digits, like AAA-1234.');
  assert.equal(msgs(check('-1234')), 'Nothing before the hyphen. An LLPIN starts with 3 letters, like AAA-1234.');
});

test('garbage input gets a plain explanation', () => {
  assert.match(msgs(check('hello world')), /Doesn’t look like a CIN/);
});
