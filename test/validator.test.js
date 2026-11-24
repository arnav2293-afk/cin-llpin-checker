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

// ---------- Domain warnings (format valid, but breaks company law) ----------
const warns = (r) => r.warnings.map((w) => w.msg).join(' | ');

test('rule 1: listed OPC is valid but gets a warning', () => {
  const r = check('L74999DL2019OPC351234');
  assert.equal(r.valid, true, msgs(r));
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].code, 'listed-private');
  assert.equal(r.warnings[0].msg, 'One-person companies can’t be listed. Check the first letter.');
  assert.deepEqual(r.warnings[0].segs, ['listing', 'type']);
  assert.deepEqual(r.warnRanges, [[0, 1], [12, 15]]);
});

test('rule 1: unlisted OPC gets no warning', () => {
  assert.deepEqual(check('U74999DL2019OPC351234').warnings, []);
});

test('rule 1: other listed private types warn too (PTC, GAP, ULT); PLC does not', () => {
  for (const t of ['PTC', 'GAP', 'ULT']) {
    const r = check('L72200KA2008' + t + '045678');
    assert.equal(r.valid, true, t);
    assert.equal(warns(r), 'Private companies (' + t + ') can’t be listed. Check the first letter.');
  }
  assert.deepEqual(check('L17110MH1973PLC019786').warnings, []);
});

test('rule 2: OPC dated before 2014 is valid but gets a warning', () => {
  for (const y of ['2013', '2010', '1990']) {
    const r = check('U74999DL' + y + 'OPC351234');
    assert.equal(r.valid, true, y);
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 1, y);
    assert.equal(r.warnings[0].code, 'opc-before-2014');
    assert.equal(r.warnings[0].msg, 'One-person companies could only be formed from 1 April 2014, but characters 9–12 say ' + y + '. Check the year.');
  }
});

test('rule 2: 2014 is the first allowed OPC year (boundary)', () => {
  assert.deepEqual(check('U74999DL2014OPC351234').warnings, []);
  assert.deepEqual(check('U74999DL2015OPC351234').warnings, []);
  // The year rule only applies to OPCs.
  assert.deepEqual(check('U72200KA2010PTC045678').warnings, []);
});

test('both rules can fire on the same ID', () => {
  const r = check('L74999DL2010OPC351234');
  assert.equal(r.valid, true);
  assert.deepEqual(r.warnings.map((w) => w.code), ['listed-private', 'opc-before-2014']);
});

test('warnings stay separate from errors on an invalid ID', () => {
  const r = check('L74999XX2010OPC351234');
  assert.equal(r.valid, false);
  assert.match(msgs(r), /“XX” is not a valid Indian state code/);
  assert.doesNotMatch(msgs(r), /One-person/);
  assert.equal(r.warnings.length, 2);
});

test('warning rules are skipped when the part itself is broken', () => {
  // Year is not a number: that is an error, so no OPC-year warning on top.
  const r = check('U74999DL20X0OPC351234');
  assert.equal(r.valid, false);
  assert.deepEqual(r.warnings, []);
});

test('every result has a warnings array, even LLPINs and junk', () => {
  for (const id of ['AAA-1234', 'AB-12345', 'hello world', 'U7220KA2008PTC04567']) {
    assert.ok(Array.isArray(check(id).warnings), id);
  }
});

// ---------- The 14-line QA list ----------
test('QA list: all 14 lines give the expected results', () => {
  const QA = [
    'L17110MH1973PLC019786', 'u17110mh 1973plc019786', 'U72900KA2015PTC082988', 'U74999TG2014OPC093842',
    'L17110XX1973PLC019786', 'L17110MH2031PLC019786', 'L17110MH1973PXC019786', 'L17110MH1973PLC01978',
    'X17110MH1973PLC01978A', 'AAA-1234', 'AAA1234', 'L17110MH1973PLC019786', '', 'hello world'
  ].join('\n');
  const { results } = V.validateText(QA, opts);
  const at = (line) => results.find((r) => r.line === line);
  const f = (r) => [r.fields.listed, r.fields.state, r.fields.year, r.fields.typeName];

  // Blank line 13 is skipped; the line numbers still match the input.
  assert.equal(results.length, 13);
  assert.deepEqual(results.map((r) => r.line), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14]);

  // 1. Valid, listed, Maharashtra, 1973, public
  assert.equal(at(1).valid, true);
  assert.deepEqual(f(at(1)), ['Listed', 'Maharashtra', '1973', 'Public limited company']);
  // 2. Valid after cleaning, unlisted, public
  assert.equal(at(2).valid, true);
  assert.equal(at(2).id, 'U17110MH1973PLC019786');
  assert.deepEqual(f(at(2)), ['Unlisted', 'Maharashtra', '1973', 'Public limited company']);
  assert.ok(at(2).notes.includes('Spaces removed') && at(2).notes.includes('Changed to capitals'));
  // 3. Valid, private, Karnataka, 2015
  assert.equal(at(3).valid, true);
  assert.deepEqual(f(at(3)).slice(1), ['Karnataka', '2015', 'Private limited company']);
  // 4. Valid, one-person company, Telangana, 2014 (first allowed OPC year: no warning)
  assert.equal(at(4).valid, true);
  assert.deepEqual(f(at(4)).slice(1), ['Telangana', '2014', 'One person company']);
  assert.deepEqual(at(4).warnings, []);
  // 5. Invalid: XX is not a state code
  assert.equal(at(5).valid, false);
  assert.equal(msgs(at(5)), 'Characters 7–8: “XX” is not a valid Indian state code.');
  // 6. Invalid: 2031 is a future year
  assert.equal(at(6).valid, false);
  assert.match(msgs(at(6)), /^Characters 9–12: “2031” is in the future\./);
  // 7. Invalid: PXC is not a company type
  assert.equal(at(7).valid, false);
  assert.match(msgs(at(7)), /^Characters 13–15: “PXC” is not a known company type\./);
  // 8. Invalid: 20 characters instead of 21
  assert.equal(at(8).valid, false);
  assert.match(msgs(at(8)), /^Has 20 characters\. A CIN must be exactly 21/);
  // 9. Invalid with BOTH errors: X is not L/U, and the registration number has a letter
  assert.equal(at(9).valid, false);
  assert.equal(at(9).errors.length, 2);
  assert.match(at(9).errors[0].msg, /^Character 1: “X” must be L \(listed\) or U \(unlisted\)\.$/);
  assert.match(at(9).errors[1].msg, /^Characters 16–21: “01978A” must be 6 digits/);
  // 10. Valid LLP; listing, state and year are not part of an LLPIN
  assert.equal(at(10).valid, true);
  assert.equal(at(10).kind, 'LLPIN');
  assert.deepEqual([at(10).fields.listed, at(10).fields.state, at(10).fields.year], ['—', '—', '—']);
  assert.match(at(10).summary, /don’t include listing, state or year/);
  // 11. AAA1234: accepted with a note about the missing hyphen
  assert.equal(at(11).valid, true);
  assert.equal(at(11).id, 'AAA-1234');
  assert.ok(at(11).notes.includes('Hyphen added'));
  // 12. Duplicate of line 1
  assert.equal(at(12).valid, true);
  assert.equal(at(12).duplicateOf, 1);
  // 14. hello world: clear "not a CIN or LLPIN" message, shown as typed
  assert.equal(at(14).valid, false);
  assert.equal(at(14).id, 'hello world');
  assert.match(msgs(at(14)), /^Doesn’t look like a CIN .* or an LLPIN/);

  // No line in this list breaks a domain rule.
  assert.equal(results.filter((r) => r.warnings.length).length, 0);
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

test('junk input is shown exactly as typed, with no clean-up notes', () => {
  const r = check('hello world');
  assert.equal(r.id, 'hello world');
  assert.deepEqual(r.notes, []);
});

test('LLP summary says listing, state and year are not encoded', () => {
  assert.match(check('AAA-1234').summary, /don’t include listing, state or year/);
});

test("garbage input gets a plain explanation", () => {
  assert.match(msgs(check('hello world')), /Doesn’t look like a CIN/);
});
