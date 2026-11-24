/* CIN & LLPIN Checker: UI. Depends on validator.js (window.CinValidator). */
(function () {
  'use strict';
  var V = window.CinValidator;
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    ids: $('ids'), editor: $('editor'), gutter: $('gutter'), backdrop: $('backdrop'),
    lineCount: $('line-count'), error: $('ids-error'),
    check: $('check-btn'), sample: $('sample-btn'), clear: $('clear-btn'),
    empty: $('empty-state'), results: $('results'), sub: $('results-sub'),
    tiles: $('tiles'), notice: $('notice'), fixNotice: $('fix-notice'),
    chips: $('chips'), search: $('search'), sort: $('sort'),
    tbody: $('tbody'), tableEmpty: $('table-empty'), table: $('table'), pager: $('pager'),
    copyInvalid: $('copy-invalid-btn'), exportBtn: $('export-btn'), exportLabel: $('export-label'),
    help: $('help'), toast: $('toast')
  };

  var SAMPLE = [
    'L17110MH1973PLC019786', 'U72200KA2008PTC045678', 'U74999DL2019OPC351234',
    'U40100TN1957GOI002345', 'AAB-1234', 'U72200XX2015PTC123456',
    'L17110MH2031PLC019786', 'U72200KA2008ABC045678', 'U7220KA2008PTC04567',
    'AB-12345', 'u72200ka2008ptc045678', 'ABCDE1234F', 'L65920MH1994PLCO80618', 'L74999DL2010OPC351234'
  ].join('\n');

  var PAGE = 100;
  var state = { data: [], truncated: false, max: 5000, filter: 'all', q: '', sort: 'problems', limit: PAGE, open: {}, checked: false, lines: {} };

  /* ---------- icons ---------- */
  function svg(size, body, sw) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }
  var ICON = {
    check: svg(13, '<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.8),
    bang: svg(13, '<path d="M12 6v8"/><path d="M12 18.5h.01"/>', 2.8),
    validTile: svg(18, '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 10"/>'),
    invalidTile: svg(18, '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><path d="M12 16.5h.01"/>'),
    building: svg(18, '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 9h4a1 1 0 0 1 1 1v11"/><path d="M8 8h3M8 12h3M8 16h3M3 21h18"/>'),
    people: svg(18, '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
    wand: svg(16, '<path d="m3 21 10-10"/><path d="M15 3v3M15 10v3M11 7h-1M20 7h-2M18.2 4.2 17 5.4M18.2 9.8 17 8.6"/>'),
    chevron: svg(18, '<path d="m6 9 6 6 6-6"/>'),
    toast: svg(16, '<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.6),
    warn: svg(16, '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
    warnSm: svg(13, '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>', 2.4)
  };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return n.toLocaleString('en-IN'); }
  function plural(n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : (many || one + 's')); }
  var toastTimer;
  function toast(msg) {
    el.toast.innerHTML = ICON.toast + '<span>' + esc(msg) + '</span>'; el.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2400);
  }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } finally { document.body.removeChild(t); }
    return Promise.resolve();
  }

  /* ---------- segments ---------- */
  function segsHtml(segments) {
    return segments.map(function (s) {
      var cls = 'seg seg--' + s.key + (s.bad ? ' is-bad' : '') + (s.warn ? ' is-warn' : '') + (s.missing ? ' is-missing' : '');
      return '<div class="' + cls + '">' +
        '<span class="seg__chars">' + esc(s.chars) + '</span>' +
        '<span class="seg__label">' + (s.label ? esc(s.label) : '&nbsp;') + '</span>' +
        (s.meaning ? '<span class="seg__meaning">' + esc(s.meaning) + '</span>' : '') +
        '</div>';
    }).join('');
  }

  // The ID with its wrong characters in <mark> (red) and warned-about characters in <mark class="warn"> (amber).
  function idHtml(r) {
    var id = r.id || r.input.trim(), out = '', pos = 0;
    var marks = (r.badRanges || []).map(function (g) { return [g[0], g[1], '']; })
      .concat((r.warnRanges || []).map(function (g) { return [g[0], g[1], ' class="warn"']; }));
    marks.sort(function (a, b) { return a[0] - b[0]; }).forEach(function (g) {
      if (g[0] < pos) return;
      out += esc(id.slice(pos, g[0])) + '<mark' + g[2] + '>' + esc(id.slice(g[0], g[1])) + '</mark>';
      pos = g[1];
    });
    return out + esc(id.slice(pos));
  }
  function hasWarn(r) { return r.warnings && r.warnings.length > 0; }
  function warnList(r, tag) {
    return r.warnings.map(function (w) {
      return '<' + tag + ' class="warn-msg">' + ICON.warnSm + '<span><span class="sr-only">Warning: </span>' + esc(w.msg) + '</span></' + tag + '>';
    }).join('');
  }

  /* ---------- editor: line numbers + problem markers ---------- */
  function lineCount() { return el.ids.value ? el.ids.value.split('\n').length : 1; }
  function renderEditor() {
    var n = Math.min(lineCount(), 20000), g = '', b = '';
    for (var i = 1; i <= n; i++) {
      var s = state.checked ? state.lines[i] : '';
      g += '<div class="gl' + (s ? ' is-' + s : '') + '">' + i + '</div>';
      b += '<div class="bl' + (s && s !== 'ok' ? ' is-' + s : '') + '" data-l="' + i + '"></div>';
    }
    el.gutter.innerHTML = '<div class="gi">' + g + '</div>';
    el.backdrop.innerHTML = '<div class="bi">' + b + '</div>';
    autoSize(n);
    syncScroll();
  }
  // Grow the box with the list (about 8 to 16 lines), then scroll inside it.
  var userResized = false;
  function autoSize(n) {
    if (userResized) return;
    var lh = parseFloat(getComputedStyle(el.ids).lineHeight) || 24;
    var lines = Math.max(window.innerWidth <= 760 ? 7 : 8, Math.min(n, window.innerWidth <= 760 ? 12 : 16));
    el.ids.style.height = (lines * lh + 24) + 'px';
  }
  function syncScroll() {
    var y = 'translateY(' + (-el.ids.scrollTop) + 'px)';
    if (el.gutter.firstChild) el.gutter.firstChild.style.transform = y;
    if (el.backdrop.firstChild) el.backdrop.firstChild.style.transform = y;
  }
  var editorFrame;
  function scheduleEditor() { cancelAnimationFrame(editorFrame); editorFrame = requestAnimationFrame(renderEditor); }
  function computeLines() {
    var L = {};
    state.data.forEach(function (r) {
      var s = !r.valid ? 'bad' : hasWarn(r) ? 'warn' : r.duplicateOf ? 'dup' : 'ok';
      var rank = { ok: 0, dup: 1, warn: 2, bad: 3 };
      if (L[r.line] && rank[L[r.line]] >= rank[s]) return;
      L[r.line] = s;
    });
    state.lines = L;
  }
  function selectLine(n) {
    var lines = el.ids.value.split('\n');
    if (n < 1 || n > lines.length) return;
    var start = 0;
    for (var i = 0; i < n - 1; i++) start += lines[i].length + 1;
    el.ids.focus({ preventScroll: true });
    el.ids.setSelectionRange(start, start + lines[n - 1].length);
    var lh = parseFloat(getComputedStyle(el.ids).lineHeight) || 24;
    el.ids.scrollTop = Math.max(0, (n - 3) * lh);
    syncScroll();
    el.editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var bar = el.backdrop.querySelector('[data-l="' + n + '"]');
    if (bar) { bar.classList.add('is-flash'); setTimeout(function () { bar.classList.remove('is-flash'); }, 1400); }
  }

  /* ---------- input ---------- */
  function countIds(text) {
    var n = 0;
    String(text).split('\n').forEach(function (l) {
      l.split(/[,;\t]/).forEach(function (p) { if (p.trim()) n++; });
    });
    return n;
  }
  function updateCount() {
    var n = countIds(el.ids.value);
    el.clear.hidden = !el.ids.value.length;
    var bad = state.checked ? state.data.filter(function (r) { return !r.valid; }).length : 0;
    var warned = state.checked ? state.data.filter(function (r) { return r.valid && hasWarn(r); }).length : 0;
    if (!n) { el.lineCount.textContent = 'No IDs yet'; el.lineCount.style.color = ''; return; }
    if (n > state.max) {
      el.lineCount.textContent = fmt(n) + ' IDs · only the first ' + fmt(state.max) + ' will be checked';
      el.lineCount.style.color = 'var(--warning-ink)';
    } else {
      el.lineCount.textContent = plural(n, 'ID') + (bad ? ' · ' + plural(bad, 'problem') + ' marked in red' : '') +
        (warned ? ' · ' + plural(warned, 'warning') + ' in amber' : '');
      el.lineCount.style.color = bad ? 'var(--error)' : warned ? 'var(--warning-ink)' : '';
    }
  }
  function showError(msg) {
    el.error.innerHTML = msg ? ICON.warn + '<span>' + esc(msg) + '</span>' : '';
    el.error.hidden = !msg;
    el.editor.classList.toggle('is-invalid', !!msg);
    if (msg) el.ids.setAttribute('aria-invalid', 'true'); else el.ids.removeAttribute('aria-invalid');
  }

  /* ---------- run ---------- */
  function reset() {
    state.checked = false; state.data = []; state.lines = {};
    el.results.hidden = true; el.empty.hidden = false;
    el.check.textContent = 'Check IDs';
    updateCount(); renderEditor();
  }
  function run(opts) {
    opts = opts || {};
    var out = V.validateText(el.ids.value, { max: state.max });
    if (!out.results.length) {
      if (opts.fromButton) {
        showError(el.ids.value.trim() ? 'We couldn’t find any IDs. Put one CIN or LLPIN on each line.' : 'Paste at least one CIN or LLPIN first.');
        el.ids.focus();
      }
      reset();
      return;
    }
    showError('');
    state.data = out.results; state.truncated = out.truncated; state.checked = true;
    state.limit = PAGE; state.open = {};
    if (opts.resetFilters) { state.filter = 'all'; state.q = ''; el.search.value = ''; }
    computeLines();
    el.empty.hidden = true; el.results.hidden = false;
    el.check.textContent = 'Check again';
    updateCount(); renderEditor(); render();
    if (opts.scroll) el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- fixes ---------- */
  function applyFix(lines, r) {
    var L = lines[r.line - 1], target = r.input.trim();
    if (L === undefined || !r.suggestion) return false;
    var i = L.indexOf(target);
    if (i === -1) return false;
    lines[r.line - 1] = L.slice(0, i) + r.suggestion + L.slice(i + target.length);
    return true;
  }
  function fix(rs) {
    var lines = el.ids.value.split('\n'), n = 0;
    rs.forEach(function (r) { if (applyFix(lines, r)) n++; });
    if (!n) return;
    var keep = el.ids.scrollTop;
    el.ids.value = lines.join('\n');
    el.ids.scrollTop = keep;
    run();
    toast(n === 1 ? 'Fixed line ' + rs[0].line + ' in your list' : 'Fixed ' + n + ' IDs in your list');
  }

  /* ---------- derived counts ---------- */
  var FILTERS = [
    { key: 'all', label: 'All', test: function () { return true; } },
    { key: 'invalid', label: 'Invalid', test: function (r) { return !r.valid; } },
    { key: 'valid', label: 'Valid', test: function (r) { return r.valid; } },
    { key: 'warnings', label: 'Warnings', test: function (r) { return hasWarn(r); } },
    { key: 'companies', label: 'Companies', test: function (r) { return r.valid && r.kind === 'CIN'; } },
    { key: 'llps', label: 'LLPs', test: function (r) { return r.valid && r.kind === 'LLPIN'; } },
    { key: 'listed', label: 'Listed', test: function (r) { return r.valid && r.fields.listed === 'Listed'; } },
    { key: 'unlisted', label: 'Unlisted', test: function (r) { return r.valid && r.fields.listed === 'Unlisted'; } },
    { key: 'dups', label: 'Duplicates', test: function (r) { return !!r.duplicateOf; } }
  ];
  function filterOf(key) { return FILTERS.filter(function (x) { return x.key === key; })[0]; }
  function count(key) { return state.data.filter(filterOf(key).test).length; }

  function visibleRows() {
    var f = filterOf(state.filter);
    var q = state.q.trim().toLowerCase();
    var rows = state.data.filter(function (r) {
      if (!f.test(r)) return false;
      if (!q) return true;
      var hay = [r.id, r.input, r.fields.state, r.fields.typeName, r.fields.listed, r.kind, r.fields.year]
        .concat(r.errors.map(function (e) { return e.msg; }), r.warnings.map(function (w) { return w.msg; })).join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    // Problems first: invalid, then valid with warnings, then the rest.
    if (state.sort === 'problems') rows.sort(function (a, b) { return (a.valid - b.valid) || (hasWarn(b) - hasWarn(a)) || (a.line - b.line); });
    else if (state.sort === 'az') rows.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : a.line - b.line; });
    else rows.sort(function (a, b) { return a.line - b.line; });
    return rows;
  }

  /* ---------- render ---------- */
  function render() { renderSummary(); renderTiles(); renderChips(); renderTable(); }

  function renderSummary() {
    var total = state.data.length, inv = count('invalid'), dups = count('dups');
    var parts = [plural(total, 'ID') + ' checked', fmt(total - inv) + ' valid', fmt(inv) + ' invalid'];
    var nWarn = state.data.reduce(function (n, r) { return n + r.warnings.length; }, 0), wIds = count('warnings');
    if (nWarn) parts.push(plural(nWarn, 'warning') + (wIds !== nWarn ? ' on ' + plural(wIds, 'ID') : ''));
    if (dups) parts.push(plural(dups, 'duplicate'));
    el.sub.textContent = parts.join(' · ');
    el.copyInvalid.disabled = !inv;
    el.copyInvalid.textContent = inv ? 'Copy ' + plural(inv, 'invalid ID') : 'No invalid IDs';

    var fixable = state.data.filter(function (r) { return r.suggestion; });
    if (fixable.length) {
      el.fixNotice.hidden = false;
      el.fixNotice.innerHTML = '<span class="notice__icon">' + ICON.wand + '</span><span class="notice__text"><strong>' +
        plural(fixable.length, 'ID looks', 'IDs look') + ' like a simple typo</strong>, such as the letter O typed instead of a zero. ' +
        'We can correct ' + (fixable.length === 1 ? 'it' : 'them') + ' in your list.</span>' +
        '<button type="button" class="btn btn--primary btn--sm" data-fix-all>Fix ' + (fixable.length === 1 ? 'it' : 'all ' + fixable.length) + '</button>';
    } else el.fixNotice.hidden = true;

    if (state.truncated) {
      el.notice.hidden = false;
      el.notice.innerHTML = '<span class="notice__icon">' + ICON.warn + '</span><span class="notice__text">Your list has more than ' + fmt(state.max) +
        ' IDs, so only the first ' + fmt(state.max) + ' were checked. Split longer lists into batches.</span>';
    } else el.notice.hidden = true;
  }

  function renderTiles() {
    var total = state.data.length, valid = count('valid'), inv = total - valid;
    // Companies and LLPs count each ID once; repeated lines are flagged as duplicates instead.
    var uniq = state.data.filter(function (r) { return r.valid && !r.duplicateOf; });
    var cos = uniq.filter(function (r) { return r.kind === 'CIN'; }).length;
    var llps = uniq.filter(function (r) { return r.kind === 'LLPIN'; }).length;
    var listed = uniq.filter(function (r) { return r.kind === 'CIN' && r.fields.listed === 'Listed'; }).length;
    var dups = count('dups'), note = $('tiles-note');
    note.hidden = !dups;
    if (dups) note.textContent = 'Companies and LLPs count each ID once. ' +
      (dups === 1 ? '1 repeated line is marked as a duplicate.' : fmt(dups) + ' repeated lines are marked as duplicates.');
    var pct = function (n) { return total ? Math.round(n / total * 100) : 0; };
    var tiles = [
      { f: 'valid', label: 'Valid', icon: ICON.validTile, value: valid,
        sub: pct(valid) + '% of ' + fmt(total) + ' checked' + (count('warnings') ? ' · ' + fmt(state.data.filter(function (r) { return r.valid && hasWarn(r); }).length) + ' with warnings' : ''), dot: 'var(--success)', track: 'var(--success-tint)', meter: valid / total },
      { f: 'invalid', label: 'Invalid', icon: ICON.invalidTile, value: inv, sub: inv ? 'Fix these before filing' : 'Nothing to fix', dot: 'var(--error)', track: 'var(--error-tint)', meter: inv / total },
      { f: 'companies', label: 'Companies', icon: ICON.building, value: cos, sub: cos ? fmt(listed) + ' listed · ' + fmt(cos - listed) + ' unlisted' : 'No valid CINs', dot: 'var(--seg-industry)', track: 'var(--seg-industry-tint)' },
      { f: 'llps', label: 'LLPs', icon: ICON.people, value: llps, sub: llps ? 'No listing, state or year in LLPINs' : 'No valid LLPINs', dot: 'var(--brand)', track: 'var(--brand-soft)' }
    ];
    el.tiles.innerHTML = tiles.map(function (t) {
      var on = state.filter === t.f;
      return '<button type="button" class="tile" data-filter="' + t.f + '" aria-pressed="' + on + '"' +
        ' style="--dot:' + t.dot + ';--track:' + t.track + '"' +
        ' aria-label="' + esc(t.label + ': ' + t.value + '. ' + t.sub + (on ? '. Showing only these, press to show all' : '. Show only these')) + '">' +
        '<span class="tile__top"><span class="tile__label">' + t.label + '</span><span class="tile__icon">' + t.icon + '</span></span>' +
        '<span class="tile__value">' + fmt(t.value) + '</span>' +
        '<span class="tile__sub">' + esc(t.sub) + '</span>' +
        (t.meter !== undefined ? '<span class="meter" aria-hidden="true"><span style="width:' + (t.meter * 100).toFixed(1) + '%"></span></span>' : '') +
        '<span class="tile__hint" aria-hidden="true">' + (on ? 'Showing · clear' : 'Show only') + '</span>' +
        '</button>';
    }).join('');
  }

  function renderChips() {
    el.chips.innerHTML = FILTERS.map(function (f) {
      var n = count(f.key);
      if (!n && ['all', 'invalid', 'valid'].indexOf(f.key) === -1 && state.filter !== f.key) return '';
      return '<button type="button" class="chip" data-filter="' + f.key + '" aria-pressed="' + (state.filter === f.key) + '">' +
        f.label + '<span class="count">' + fmt(n) + '</span></button>';
    }).join('');
  }

  function cell(value, label, bad, extraClass, warned) {
    var faint = value === '—';
    var cls = ((faint ? 'cell-faint is-empty-sm ' : '') + (extraClass || '')).trim();
    var inner = bad ? '<span class="bad-field">' + esc(value) + '</span>'
      : warned ? '<span class="warn-field">' + esc(value) + '</span>' : esc(value);
    return '<td data-label="' + label + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + inner + '</td>';
  }

  function fixHtml(r, idx) {
    if (!r.suggestion) return '';
    return '<div class="fix"><span>Did you mean <code>' + esc(r.suggestion) + '</code><span class="q">?</span></span>' +
      '<button type="button" class="btn btn--secondary btn--sm" data-fix="' + idx + '">Fix in list</button></div>';
  }

  function detailsCell(r, idx) {
    var warnings = hasWarn(r) ? warnList(r, 'span') : '';
    if (!r.valid) {
      return '<td class="cell-details is-error">' +
        r.errors.map(function (e) { return '<span class="err">' + esc(e.msg) + '</span>'; }).join('') +
        warnings + fixHtml(r, idx) + '</td>';
    }
    var bits = [];
    if (r.duplicateOf) bits.push('Same ID as line ' + r.duplicateOf);
    if (r.notes.length) bits.push(r.notes.join(', '));
    if (!bits.length && !warnings) return '<td class="cell-details cell-faint">—</td>';
    return '<td class="cell-details keep-sm' + (warnings ? ' has-warn' : '') + '">' + warnings +
      (bits.length ? '<span class="note">' + esc(bits.join(' · ')) + '</span>' : '') + '</td>';
  }

  // One-line summary used on phones instead of five labelled columns.
  function factsHtml(r) {
    var b = r.badFields || {}, w = r.warnFields || {}, bits;
    if (r.kind === 'LLPIN') bits = [['LLP · listing, state and year aren’t part of an LLPIN']];
    else if (r.kind === 'CIN' && r.segments.length === 6) {
      bits = [[r.fields.listed, b.listed, w.listed], [r.fields.type, b.type, w.type], [r.fields.state, b.state], [r.fields.year, b.year, w.year]];
    } else return '<td class="cell-facts is-empty-sm"></td>';
    return '<td class="cell-facts">' + bits.map(function (x) {
      return x[1] ? '<span class="bad-field">' + esc(x[0]) + '</span>'
        : x[2] ? '<span class="warn-field">' + esc(x[0]) + '</span>' : esc(x[0]);
    }).join(' · ') + '</td>';
  }

  function rowHtml(r, idx) {
    var open = !!state.open[idx];
    var b = r.badFields || {}, w = r.warnFields || {};
    var badges = (r.valid
      ? '<span class="badge badge--valid">' + ICON.check + 'Valid</span>'
      : '<span class="badge badge--invalid">' + ICON.bang + 'Invalid</span>') +
      (hasWarn(r) ? '<span class="badge badge--warn">' + ICON.warnSm + (r.warnings.length > 1 ? r.warnings.length + ' warnings' : 'Warning') + '</span>' : '') +
      (r.duplicateOf ? '<span class="badge badge--dup">Duplicate</span>' : '');
    var html = '<tr class="row ' + (r.valid ? 'is-valid' : 'is-invalid') + (r.valid && hasWarn(r) ? ' is-warn' : '') + (open ? ' is-open' : '') + '" data-idx="' + idx + '">' +
      '<td class="cell-line"><span class="sm-only">Line </span>' + r.line + '</td>' +
      '<td class="cell-id">' + idHtml(r) + '</td>' +
      '<td class="cell-status"><div class="badges">' + badges + '</div></td>' +
      factsHtml(r) +
      cell(r.kind === 'CIN' ? 'Company' : r.kind === 'LLPIN' ? 'LLP' : '—', 'Kind') +
      (r.kind === 'LLPIN'
        ? '<td colspan="3" data-label="Listed, state, year" class="cell-na">Not part of an LLPIN</td>'
        : cell(r.fields.listed, 'Listed', b.listed, '', w.listed) + cell(r.fields.state, 'State', b.state) + cell(r.fields.year, 'Year', b.year, '', w.year)) +
      cell(r.fields.type, 'Type', b.type, 'cell-type', w.type) +
      detailsCell(r, idx) +
      '<td class="cell-toggle"><button type="button" class="toggle" aria-expanded="' + open + '" aria-controls="detail-' + idx + '">' +
      ICON.chevron + '<span class="toggle__text">' + (open ? 'Hide breakdown' : 'Show breakdown') + '</span>' +
      '<span class="sr-only"> for ' + esc(r.id) + '</span></button></td>' +
      '</tr>';
    if (open) html += detailHtml(r, idx);
    return html;
  }

  function detailHtml(r, idx) {
    var meta = [];
    if (r.kind === 'CIN' && r.segments.length === 6) {
      meta.push('Industry code (NIC) <strong class="mono">' + esc(r.fields.industry) + '</strong>');
      meta.push('Registration no. <strong class="mono">' + esc(r.fields.reg) + '</strong>');
    }
    if (r.input.trim() !== r.id) meta.push('You typed <span class="mono">' + esc(r.input.trim()) + '</span>');
    if (r.duplicateOf) meta.push('Same ID as line ' + r.duplicateOf);
    var body = (r.valid
      ? '<p class="detail__summary">' + esc(r.summary) + '</p>'
      : '<ul class="detail__errors">' + r.errors.map(function (e) { return '<li>' + esc(e.msg) + '</li>'; }).join('') + '</ul>') +
      (hasWarn(r) ? '<ul class="detail__warnings">' + warnList(r, 'li') + '</ul>' : '');
    return '<tr class="detail" id="detail-' + idx + '"><td colspan="10"><div class="detail__inner">' +
      '<div class="segs">' + segsHtml(r.segments) + '</div>' + body +
      '<div class="detail__meta">' + meta.map(function (m) { return '<span>' + m + '</span>'; }).join('') +
      '<span class="detail__buttons">' +
      (r.suggestion ? '<button type="button" class="btn btn--primary btn--sm" data-fix="' + idx + '">Fix to ' + esc(r.suggestion) + '</button>' : '') +
      '<button type="button" class="btn btn--secondary btn--sm" data-goto="' + r.line + '">Show in my list</button>' +
      '<button type="button" class="btn btn--secondary btn--sm" data-copy="' + esc(r.id) + '">Copy ID</button></span></div>' +
      '</div></td></tr>';
  }

  function renderTable() {
    var rows = visibleRows();
    state.visible = rows;
    var shown = rows.slice(0, state.limit);
    el.tbody.innerHTML = shown.map(function (r) { return rowHtml(r, state.data.indexOf(r)); }).join('');
    el.table.hidden = !rows.length;
    el.tableEmpty.hidden = !!rows.length;
    if (!rows.length) {
      el.tableEmpty.innerHTML = '<h3>No results match</h3><p class="muted">' +
        (state.q ? 'Nothing matches “' + esc(state.q) + '”.' : 'Nothing in this filter.') +
        '</p><button type="button" class="btn btn--secondary btn--sm" data-reset>Show all results</button>';
    }
    el.exportLabel.textContent = 'Export CSV' + (state.filter === 'all' && !state.q ? '' : ' (' + fmt(rows.length) + ')');
    if (rows.length > shown.length) {
      var next = Math.min(PAGE, rows.length - shown.length);
      el.pager.innerHTML = '<span>Showing ' + fmt(shown.length) + ' of ' + fmt(rows.length) + '</span>' +
        '<button type="button" class="btn btn--secondary btn--sm" data-more>Show ' + fmt(next) + ' more</button>' +
        (rows.length <= 2000 ? '<button type="button" class="link-btn" data-all>Show all</button>' : '');
    } else {
      el.pager.innerHTML = rows.length > 12 ? '<span>Showing all ' + fmt(rows.length) + '</span>' : '';
    }
  }

  function toggleRow(idx) {
    if (state.open[idx]) delete state.open[idx]; else state.open[idx] = true;
    var tr = el.tbody.querySelector('tr.row[data-idx="' + idx + '"]');
    if (!tr) return;
    var next = tr.nextElementSibling;
    if (next && next.classList.contains('detail')) next.remove();
    var tmp = document.createElement('tbody');
    tmp.innerHTML = rowHtml(state.data[idx], idx);
    var newRow = tmp.firstElementChild;
    tr.replaceWith(newRow);
    if (tmp.firstElementChild) newRow.after(tmp.firstElementChild);
    newRow.querySelector('.toggle').focus({ preventScroll: true });
  }

  /* ---------- CSV ---------- */
  function exportCsv() {
    // Always export in the order pasted (the current filter and search still apply).
    var rows = (state.visible || state.data).slice().sort(function (a, b) { return a.line - b.line; });
    var head = ['Line', 'You typed', 'ID', 'Status', 'Kind', 'Listed', 'State', 'Year', 'Company type', 'Problems', 'Warnings', 'Suggested fix', 'Notes'];
    var q = function (v) {
      v = v == null ? '' : String(v);
      // Excel runs cells starting with = + - @ as formulas, and drops leading zeros from
      // numbers. A leading apostrophe makes it keep the text exactly as typed.
      if (/^[=+\-@\t\r]/.test(v) || /^0[0-9]+$/.test(v)) v = "'" + v;
      return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var lines = [head.join(',')].concat(rows.map(function (r) {
      var notes = r.notes.slice(); if (r.duplicateOf) notes.push('Duplicate of line ' + r.duplicateOf);
      return [r.line, r.input.trim(), r.id, r.valid ? 'Valid' : 'Invalid',
        r.kind === 'CIN' ? 'Company' : r.kind === 'LLPIN' ? 'LLP' : '',
        r.fields.listed, r.fields.state, r.fields.year, r.fields.typeName,
        r.errors.map(function (e) { return e.msg; }).join(' '), r.warnings.map(function (w) { return w.msg; }).join(' '),
        r.suggestion || '', notes.join('; ')
      ].map(function (v) { return q(v === '—' ? '' : v); }).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cin-check-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('Downloaded ' + plural(rows.length, 'row'));
  }

  /* ---------- 500-line test data ---------- */
  function make500() {
    var seed = 7;
    var rnd = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    var pad = function (n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; };
    var states = Object.keys(V.STATES), types = ['PLC', 'PTC', 'PTC', 'PTC', 'OPC', 'GOI', 'NPL'];
    var nic = ['17110', '72200', '74999', '40100', '65910', '51909', '45201', '85110', '62099', '70100'];
    var out = [];
    for (var i = 0; i < 500; i++) {
      var r = rnd();
      if (r < 0.12) {
        out.push(String.fromCharCode(65 + Math.floor(rnd() * 26), 65 + Math.floor(rnd() * 26), 65 + Math.floor(rnd() * 26)) + '-' + pad(Math.floor(rnd() * 9999), 4));
        continue;
      }
      var type = pick(types);
      var year = type === 'OPC' ? 2014 + Math.floor(rnd() * 12) : 1950 + Math.floor(rnd() * 76);
      var listing = (type === 'PLC' && rnd() < 0.4) ? 'L' : 'U';
      var cin = listing + pick(nic) + pick(states) + year + type + pad(Math.floor(rnd() * 999999), 6);
      if (r > 0.82) { // break it in a realistic way
        var how = Math.floor(rnd() * 5);
        if (how === 0) cin = cin.slice(0, 6) + pick(['XX', 'OD', 'ZZ', 'TS']) + cin.slice(8);
        else if (how === 1) cin = cin.slice(0, 8) + (2027 + Math.floor(rnd() * 10)) + cin.slice(12);
        else if (how === 2) cin = cin.slice(0, 12) + pick(['ABC', 'PVT', 'LTD']) + cin.slice(15);
        else if (how === 3) cin = cin.slice(0, 20);
        else cin = cin.slice(0, 16) + 'O' + cin.slice(17);
      }
      if (rnd() < 0.05) cin = cin.toLowerCase();
      out.push(cin);
    }
    return out.join('\n');
  }

  /* ---------- help dialog ---------- */
  function fillHelp() {
    var example = V.validate('L17110MH1973PLC019786', 1).segments;
    $('anatomy-cin').innerHTML = segsHtml(example);
    $('help-cin').innerHTML = segsHtml(example);
    $('anatomy-llp').innerHTML = segsHtml(V.validate('AAB-1234', 1).segments);
    $('help-types').innerHTML = Object.keys(V.TYPES).map(function (k) {
      return '<div><dt>' + k + '</dt><dd>' + esc(V.TYPES[k].name) + '</dd></div>';
    }).join('');
    $('help-states').innerHTML = Object.keys(V.STATES).sort(function (a, b) { return V.STATES[a] < V.STATES[b] ? -1 : 1; }).map(function (k) {
      return '<div><dt>' + k + '</dt><dd>' + esc(V.STATES[k]) + '</dd></div>';
    }).join('');
  }

  /* ---------- events ---------- */
  var debounce;
  el.ids.addEventListener('input', function () {
    updateCount(); scheduleEditor();
    if (!el.error.hidden) showError('');
    if (state.checked) {
      clearTimeout(debounce);
      debounce = setTimeout(function () { run(); }, 300);
    }
  });
  el.ids.addEventListener('scroll', syncScroll);
  // Respect a manual resize from the corner handle.
  el.ids.addEventListener('mousedown', function (e) {
    var r = el.ids.getBoundingClientRect();
    if (e.clientX > r.right - 18 && e.clientY > r.bottom - 18) userResized = true;
  });
  el.ids.addEventListener('paste', function () {
    setTimeout(function () { run({ resetFilters: !state.checked }); }, 0);
  });
  el.ids.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run({ fromButton: true, scroll: true }); }
  });
  el.check.addEventListener('click', function () { run({ fromButton: true, scroll: true }); });
  el.sample.addEventListener('click', function () { el.ids.value = SAMPLE; el.ids.scrollTop = 0; run({ resetFilters: true, scroll: true }); });
  el.clear.addEventListener('click', function () {
    el.ids.value = ''; showError('');
    state.filter = 'all'; state.q = ''; el.search.value = '';
    reset(); el.ids.focus();
  });
  document.addEventListener('click', function (e) {
    var t = e.target;
    var f = t.closest('[data-filter]');
    if (f) {
      var key = f.getAttribute('data-filter');
      state.filter = (f.classList.contains('tile') && state.filter === key) ? 'all' : key;
      state.limit = PAGE; renderTiles(); renderChips(); renderTable(); return;
    }
    var fx = t.closest('[data-fix]');
    if (fx) { fix([state.data[Number(fx.getAttribute('data-fix'))]]); return; }
    if (t.closest('[data-fix-all]')) { fix(state.data.filter(function (r) { return r.suggestion; })); return; }
    var go = t.closest('[data-goto]');
    if (go) { selectLine(Number(go.getAttribute('data-goto'))); return; }
    var c = t.closest('[data-copy]');
    if (c) { copy(c.getAttribute('data-copy')).then(function () { toast('Copied ' + c.getAttribute('data-copy')); }); return; }
    if (t.closest('[data-more]')) { state.limit += PAGE; renderTable(); return; }
    if (t.closest('[data-all]')) { state.limit = Infinity; renderTable(); return; }
    if (t.closest('[data-reset]')) { state.filter = 'all'; state.q = ''; el.search.value = ''; render(); return; }
    if (t.closest('[data-open-help]')) { el.help.showModal(); return; }
    if (t.closest('[data-close-help]')) { el.help.close(); return; }
    if (t === el.help) {
      var b = el.help.getBoundingClientRect();
      if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) el.help.close();
      return;
    }
    if (t.closest('[data-load-500]')) { el.ids.value = make500(); el.ids.scrollTop = 0; run({ resetFilters: true, scroll: true }); return; }
    var row = t.closest('tr.row');
    if (row && !window.getSelection().toString()) toggleRow(Number(row.getAttribute('data-idx')));
  });
  el.search.addEventListener('input', function () { state.q = el.search.value; state.limit = PAGE; renderTable(); });
  el.sort.addEventListener('change', function () { state.sort = el.sort.value; renderTable(); });
  el.exportBtn.addEventListener('click', exportCsv);
  el.copyInvalid.addEventListener('click', function () {
    var ids = state.data.filter(function (r) { return !r.valid; }).map(function (r) { return r.input.trim(); });
    if (!ids.length) return;
    copy(ids.join('\n')).then(function () { toast('Copied ' + plural(ids.length, 'invalid ID')); });
  });

  fillHelp();
  updateCount();
  renderEditor();
})();
