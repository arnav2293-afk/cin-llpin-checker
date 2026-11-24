/*
 * CIN and LLPIN validator.
 *
 * Pure functions, no DOM. Works in the browser (window.CinValidator)
 * and in Node (module.exports) so it can be unit tested.
 *
 * CIN  (21 chars): L 17110 MH 1973 PLC 019786
 *                  | |     |  |    |   └ registration number (6 digits)
 *                  | |     |  |    └ company type (3 letters)
 *                  | |     |  └ year of incorporation (4 digits)
 *                  | |     └ state code (2 letters)
 *                  | └ industry code (5 digits)
 *                  └ L = listed, U = unlisted
 *
 * LLPIN (8 chars): AAA-1234  (3 letters, hyphen, 4 digits; no state or year)
 */
(function (root) {
  'use strict';

  var EARLIEST_YEAR = 1850;

  // State codes as they appear in CINs (MCA / ROC codes).
  var STATES = {
    AN: 'Andaman and Nicobar Islands', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh',
    AS: 'Assam', BR: 'Bihar', CH: 'Chandigarh', CT: 'Chhattisgarh',
    DN: 'Dadra and Nagar Haveli', DD: 'Daman and Diu', DL: 'Delhi', GA: 'Goa',
    GJ: 'Gujarat', HR: 'Haryana', HP: 'Himachal Pradesh', JK: 'Jammu and Kashmir',
    JH: 'Jharkhand', KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', LD: 'Lakshadweep',
    MP: 'Madhya Pradesh', MH: 'Maharashtra', MN: 'Manipur', ML: 'Meghalaya',
    MZ: 'Mizoram', NL: 'Nagaland', OR: 'Odisha', PY: 'Puducherry', PB: 'Punjab',
    RJ: 'Rajasthan', SK: 'Sikkim', TN: 'Tamil Nadu', TG: 'Telangana', TR: 'Tripura',
    UP: 'Uttar Pradesh', UR: 'Uttarakhand', WB: 'West Bengal'
  };

  // Common codes people type that CINs spell differently.
  var STATE_HINTS = { OD: 'OR', CG: 'CT', UK: 'UR', TS: 'TG' };

  var TYPES = {
    PLC: { name: 'Public limited company', short: 'Public' },
    PTC: { name: 'Private limited company', short: 'Private' },
    OPC: { name: 'One person company', short: 'One person' },
    GOI: { name: 'Government of India company', short: 'Central govt.' },
    SGC: { name: 'State government company', short: 'State govt.' },
    FLC: { name: 'Financial lease company', short: 'Financial lease' },
    FTC: { name: 'Subsidiary of a foreign company', short: 'Foreign subsidiary' },
    GAP: { name: 'Private company limited by guarantee', short: 'Guarantee (private)' },
    GAT: { name: 'Public company limited by guarantee', short: 'Guarantee (public)' },
    NPL: { name: 'Not-for-profit (Section 8) company', short: 'Not-for-profit' },
    ULL: { name: 'Public unlimited company', short: 'Unlimited (public)' },
    ULT: { name: 'Private unlimited company', short: 'Unlimited (private)' }
  };

  // Private company types cannot be listed on a stock exchange.
  var PRIVATE_TYPES = { PTC: 1, OPC: 1, GAP: 1, ULT: 1 };

  var OPC_FROM_YEAR = 2014; // One person companies were allowed from 1 April 2014.

  var CIN_SEGMENTS = [
    { key: 'listing', label: 'Listing', from: 0, to: 1 },
    { key: 'industry', label: 'Industry', from: 1, to: 6 },
    { key: 'state', label: 'State', from: 6, to: 8 },
    { key: 'year', label: 'Year', from: 8, to: 12 },
    { key: 'type', label: 'Type', from: 12, to: 15 },
    { key: 'reg', label: 'Reg. no.', from: 15, to: 21 }
  ];

  function range(seg) {
    var a = seg.from + 1, b = seg.to;
    return a === b ? 'Character ' + a : 'Characters ' + a + '–' + b;
  }

  function q(s) { return '“' + s + '”'; }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // Suggest a fix when letters were typed where digits belong (O for 0, I for 1).
  function digitHint(s) {
    if (/^[0-9OIL]+$/.test(s) && /[OIL]/.test(s)) {
      return ' Did you type the letter O or I instead of a zero or one?';
    }
    return '';
  }

  /** Clean one pasted line. Returns { id, notes }. */
  function clean(raw) {
    var notes = [];
    var s = String(raw).trim().replace(/^["'`]+|["'`]+$/g, '');
    var noSpace = s.replace(/\s+/g, '');
    if (noSpace !== s) notes.push('Spaces removed');
    var dashed = noSpace.replace(/[‐-―−]/g, '-');
    var upper = dashed.toUpperCase();
    if (upper !== dashed) notes.push('Changed to capitals');
    return { id: upper, notes: notes };
  }

  function guessKind(id) {
    if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(id)) return 'PAN';
    if (/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(id)) return 'GSTIN';
    if (/^F[0-9]{5}$/.test(id)) return 'FCRN';
    if (id.indexOf('-') !== -1) return 'LLPIN';
    if (/^[A-Z]{3}[0-9]{4}$/.test(id)) return 'LLPIN';
    if (id.length <= 10 && /^[A-Z]{1,5}[0-9]{1,6}$/.test(id)) return 'LLPIN';
    if (/^[LU]/.test(id) || id.length >= 15) return 'CIN';
    return 'UNKNOWN';
  }

  function blankResult(line, input, cleaned) {
    return {
      line: line, input: input, id: cleaned.id, notes: cleaned.notes.slice(),
      kind: 'Unknown', valid: false, errors: [], segments: [],
      fields: { kind: '—', listed: '—', state: '—', year: '—', type: '—', typeName: '—', industry: '—', reg: '—' },
      summary: ''
    };
  }

  function validateLlpin(r) {
    var id = r.id;
    r.kind = 'LLPIN';
    if (/^[A-Z]{3}[0-9]{4}$/.test(id)) {
      id = id.slice(0, 3) + '-' + id.slice(3);
      r.id = id;
      r.notes.push('Hyphen added');
    }
    var parts = id.split('-');
    if (parts.length > 2) {
      r.errors.push({ msg: 'Has ' + (parts.length - 1) + ' hyphens. An LLPIN has exactly one, like AAA-1234.', segs: [] });
      r.segments = [{ key: 'raw', label: plural(id.length, 'character'), chars: id, meaning: '', bad: true }];
      return r;
    }
    var a = parts[0], b = parts.length === 2 ? parts[1] : '';
    var badA = !/^[A-Z]{3}$/.test(a);
    var badB = !/^[0-9]{4}$/.test(b);
    if (badA) {
      var letters = (a.match(/[A-Z]/g) || []).length;
      r.errors.push({
        msg: 'Before the hyphen: ' + q(a || '(nothing)') + ' must be exactly 3 letters' +
          (letters !== a.length ? ', with no digits.' : ' (this has ' + letters + ').'),
        segs: ['letters']
      });
    }
    if (badB) {
      var digits = (b.match(/[0-9]/g) || []).length;
      r.errors.push({
        msg: 'After the hyphen: ' + q(b || '(nothing)') + ' must be exactly 4 digits' +
          (digits !== b.length ? ', with no letters.' : ' (this has ' + digits + ').') + digitHint(b),
        segs: ['number']
      });
    }
    r.segments = [
      { key: 'letters', label: 'Letters', chars: a || '·', meaning: badA ? 'Needs 3 letters' : 'Series', bad: badA, from: 0, to: a.length },
      { key: 'hyphen', label: '', chars: '-', meaning: '', bad: false },
      { key: 'number', label: 'Number', chars: b || '·', meaning: badB ? 'Needs 4 digits' : 'Serial no.', bad: badB, from: a.length + 1, to: id.length }
    ];
    r.valid = r.errors.length === 0;
    if (r.valid) {
      r.fields = { kind: 'LLP', listed: '—', state: '—', year: '—', type: 'LLP', typeName: 'Limited liability partnership', industry: '—', reg: b };
      r.summary = 'A limited liability partnership (LLP). LLPINs don’t include a state or year.';
    } else {
      r.fields.kind = 'LLP';
    }
    return r;
  }

  function validateCin(r, currentYear) {
    var id = r.id;
    r.kind = 'CIN';
    var bad = /[^A-Z0-9]/.exec(id);
    if (bad) {
      r.errors.push({
        msg: 'Character ' + (bad.index + 1) + ': ' + q(bad[0]) + ' isn’t allowed. A CIN has only letters and digits.',
        segs: []
      });
    }
    if (id.length !== 21) {
      var diff = 21 - id.length;
      r.errors.push({
        msg: 'Has ' + plural(id.length, 'character') + '. A CIN must be exactly 21, like L17110MH1973PLC019786' +
          (diff > 0 ? ' (' + plural(diff, 'character') + ' missing).' : ' (' + plural(-diff, 'character') + ' too many).'),
        segs: ['length']
      });
      r.segments = [{ key: 'raw', label: id.length + ' of 21', chars: id, meaning: '', bad: false }];
      if (diff > 0) r.segments.push({ key: 'missing', label: 'Missing', chars: '+' + diff, meaning: '', bad: true, missing: true });
      else r.segments[0].bad = true;
      return r;
    }
    if (bad) {
      r.segments = [{ key: 'raw', label: '21 characters', chars: id, meaning: '', bad: true }];
      r.badRanges = [[bad.index, bad.index + 1]];
      return r;
    }

    var p = {};
    CIN_SEGMENTS.forEach(function (s) { p[s.key] = id.slice(s.from, s.to); });
    var badSegs = {};
    function fail(key, msg) { badSegs[key] = true; r.errors.push({ msg: msg, segs: [key] }); }
    var S = {};
    CIN_SEGMENTS.forEach(function (s) { S[s.key] = s; });

    if (p.listing !== 'L' && p.listing !== 'U') {
      fail('listing', range(S.listing) + ': ' + q(p.listing) + ' must be L (listed) or U (unlisted).');
    }
    if (!/^[0-9]{5}$/.test(p.industry)) {
      fail('industry', range(S.industry) + ': ' + q(p.industry) + ' must be 5 digits (the industry code).' + digitHint(p.industry));
    }
    if (!STATES[p.state]) {
      var hint = STATE_HINTS[p.state];
      fail('state', range(S.state) + ': ' + q(p.state) + ' is not a valid Indian state code.' +
        (hint ? ' CINs use ' + q(hint) + ' for ' + STATES[hint] + '.' : ''));
    }
    var year = NaN;
    if (!/^[0-9]{4}$/.test(p.year)) {
      fail('year', range(S.year) + ': ' + q(p.year) + ' must be a 4-digit year.' + digitHint(p.year));
    } else {
      year = parseInt(p.year, 10);
      if (year > currentYear) {
        fail('year', range(S.year) + ': ' + q(p.year) + ' is in the future. The year must be between ' + EARLIEST_YEAR + ' and ' + currentYear + '.');
      } else if (year < EARLIEST_YEAR) {
        fail('year', range(S.year) + ': ' + q(p.year) + ' is too early. The year must be between ' + EARLIEST_YEAR + ' and ' + currentYear + '.');
      }
    }
    var type = TYPES[p.type];
    if (!type) {
      fail('type', range(S.type) + ': ' + q(p.type) + ' is not a known company type. Expected PLC, PTC, OPC, GOI and similar.');
    }
    if (!/^[0-9]{6}$/.test(p.reg)) {
      fail('reg', range(S.reg) + ': ' + q(p.reg) + ' must be 6 digits (the registration number).' + digitHint(p.reg));
    }
    // Cross-checks between segments (only when both parts are individually fine).
    if (!badSegs.listing && type && p.listing === 'L' && PRIVATE_TYPES[p.type]) {
      badSegs.listing = badSegs.type = true;
      r.errors.push({
        msg: 'Character 1 says listed (L), but ' + q(p.type) + ' is a private company type. Private companies can’t be listed.',
        segs: ['listing', 'type']
      });
    }
    if (p.type === 'OPC' && !badSegs.year && year < OPC_FROM_YEAR) {
      badSegs.year = badSegs.type = true;
      r.errors.push({
        msg: 'One person companies (OPC) only exist from ' + OPC_FROM_YEAR + ', but characters 9–12 say ' + p.year + '.',
        segs: ['year', 'type']
      });
    }

    var listed = p.listing === 'L' ? 'Listed' : p.listing === 'U' ? 'Unlisted' : '—';
    var meanings = {
      listing: badSegs.listing ? (listed === '—' ? 'Not L or U' : listed) : listed,
      industry: badSegs.industry ? 'Not 5 digits' : 'Industry code',
      state: STATES[p.state] || 'Unknown',
      year: badSegs.year && !(year <= currentYear && year >= EARLIEST_YEAR) ? (year > currentYear ? 'In the future' : 'Not a year') : p.year,
      type: type ? type.short : 'Unknown',
      reg: badSegs.reg ? 'Not 6 digits' : 'Registration no.'
    };
    r.segments = CIN_SEGMENTS.map(function (s) {
      return { key: s.key, label: s.label, chars: p[s.key], meaning: meanings[s.key], bad: !!badSegs[s.key], from: s.from, to: s.to };
    });
    r.fields = {
      kind: 'Company',
      listed: badSegs.listing ? (listed === '—' ? p.listing : listed) : listed,
      state: STATES[p.state] || p.state,
      year: p.year,
      type: type ? type.short : p.type,
      typeName: type ? type.name : p.type,
      industry: p.industry,
      reg: p.reg
    };
    r.badFields = {
      listed: !!badSegs.listing, state: !!badSegs.state, year: !!badSegs.year, type: !!badSegs.type
    };
    r.valid = r.errors.length === 0;
    if (r.valid) {
      var art = listed === 'Listed' ? 'A listed ' : 'An unlisted ';
      r.summary = art + type.name.charAt(0).toLowerCase() + type.name.slice(1) +
        ', registered in ' + STATES[p.state] + ' in ' + p.year + '.';
    }
    return r;
  }

  // Character ranges [from, to) of the parts that are wrong, for highlighting.
  function badRanges(r) {
    if (r.badRanges) return r.badRanges;
    return r.segments.filter(function (s) { return s.bad && s.from !== undefined && s.to > s.from; })
      .map(function (s) { return [s.from, s.to]; });
  }

  // Offer a corrected ID when the mistake is an obvious typo
  // (letter O / I typed in a digit part, or a common wrong state code).
  function suggest(r, opts) {
    var id = r.id, cands = [];
    var digits = function (s) { return s.replace(/O/g, '0').replace(/[IL]/g, '1'); };
    if (r.kind === 'CIN' && id.length === 21) {
      var fixed = id.slice(0, 1) + digits(id.slice(1, 6)) + id.slice(6, 8) + digits(id.slice(8, 12)) + id.slice(12, 15) + digits(id.slice(15));
      var hint = STATE_HINTS[id.slice(6, 8)];
      cands.push(fixed);
      if (hint) cands.push(id.slice(0, 6) + hint + id.slice(8), fixed.slice(0, 6) + hint + fixed.slice(8));
    } else if (r.kind === 'LLPIN') {
      var p = id.split('-');
      if (p.length === 2) cands.push(p[0] + '-' + digits(p[1]));
    }
    var o = { currentYear: opts && opts.currentYear, noSuggest: true };
    for (var i = 0; i < cands.length; i++) {
      if (cands[i] !== id && validate(cands[i], r.line, o).valid) {
        r.suggestion = cands[i];
        // The fix button says it better than the generic hint.
        r.errors.forEach(function (e) { e.msg = e.msg.replace(/ Did you type the letter O or I[^?]*\?/, ''); });
        return;
      }
    }
  }

  /**
   * Validate one line.
   * @param {string} input   raw line as pasted
   * @param {number} line    1-based line number
   * @param {object} [opts]  { currentYear }
   */
  function validate(input, line, opts) {
    var r = validateOnly(input, line, opts);
    r.badRanges = badRanges(r);
    if (!r.valid && !(opts && opts.noSuggest)) suggest(r, opts);
    return r;
  }

  function validateOnly(input, line, opts) {
    var currentYear = (opts && opts.currentYear) || new Date().getFullYear();
    var cleaned = clean(input);
    var r = blankResult(line || 1, input, cleaned);
    var kind = guessKind(r.id);
    if (kind === 'LLPIN') return validateLlpin(r);
    if (kind === 'CIN') return validateCin(r, currentYear);
    var names = { PAN: 'a PAN', GSTIN: 'a GSTIN', FCRN: 'an FCRN (foreign company number)' };
    r.errors.push({
      msg: names[kind]
        ? 'This looks like ' + names[kind] + ', not a CIN or LLPIN.'
        : 'Doesn’t look like a CIN (21 characters, like L17110MH1973PLC019786) or an LLPIN (like AAA-1234).',
      segs: []
    });
    r.segments = [{ key: 'raw', label: plural(r.id.length, 'character'), chars: r.id, meaning: '', bad: true }];
    return r;
  }

  /**
   * Validate a whole pasted block. One ID per line; commas, semicolons and
   * tabs also separate IDs (handy when pasting a row from Excel).
   * Blank lines are skipped but line numbers still match the input.
   */
  function validateText(text, opts) {
    var max = (opts && opts.max) || 5000;
    var lines = String(text).split(/\r\n|\r|\n/);
    var results = [];
    var seen = {};
    var truncated = false;
    for (var i = 0; i < lines.length; i++) {
      var pieces = lines[i].split(/[,;\t]/);
      for (var j = 0; j < pieces.length; j++) {
        if (!pieces[j].trim()) continue;
        if (results.length >= max) { truncated = true; break; }
        var r = validate(pieces[j], i + 1, opts);
        if (seen[r.id]) r.duplicateOf = seen[r.id];
        else seen[r.id] = r.line;
        results.push(r);
      }
      if (truncated) break;
    }
    return { results: results, truncated: truncated, max: max };
  }

  var api = {
    validate: validate, validateText: validateText, clean: clean,
    STATES: STATES, TYPES: TYPES, EARLIEST_YEAR: EARLIEST_YEAR
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CinValidator = api;
})(this);
