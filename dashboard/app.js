// Token Launch Radar: the dashboard. It renders window.RADAR, the board main.ts writes beside this
// page as data.js, with no network and no framework: a ranked, sortable, filterable board of the
// protocols that record no token yet, a curated start-here strip, a detail drawer per protocol
// with the model's arithmetic, its launch signal, its farmer economics and its farm plan, a
// live-token comparison view built from the same snapshot, and the method stated in full. The
// page recomputes every figure it shows from the factors data.js carries, so what the screen
// shows and what board.json holds are the same numbers, checked in the drawer.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', wl: false, tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model, restated: implied = tvl x peer multiple x growth multiplier x maturity multiplier
  // x scale multiplier x evidence multiplier, at the median peer multiple for the base and at the
  // 25th and 75th peer percentiles for the range. main.ts computes board.json from these same
  // rounded factors, so this must reproduce all three of its numbers.
  function rangeOf(row) {
    var rest = row.model.growth_multiplier * row.model.maturity_multiplier * row.model.scale_multiplier * row.model.evidence_multiplier;
    var base = Math.max(1, Math.round(row.tvl_usd * row.model.peer_multiple * rest));
    var low = Math.min(base, Math.max(1, Math.round(row.tvl_usd * row.model.peer_multiple_low * rest)));
    var high = Math.max(base, Math.max(1, Math.round(row.tvl_usd * row.model.peer_multiple_high * rest)));
    return { low: low, base: base, high: high };
  }
  function impliedOf(row) { return rangeOf(row).base; }
  // The launch index, restated: 0.45 x category tokenisation + 0.30 x age band + 0.25 x momentum,
  // from the row's recorded components, with the model's grade bands.
  function launchOf(row) {
    var l = row.launch;
    var score = Math.round((0.45 * l.tokenisation_rate + 0.30 * l.age_score + 0.25 * l.momentum_score) * 1e4) / 1e4;
    var grade = score >= 0.62 ? 'Strong' : score >= 0.50 ? 'Plausible' : score >= 0.38 ? 'Possible' : 'Faint';
    return { score: score, grade: grade };
  }
  // The farmer economics, restated from the assumptions data.js carries: the capture is the
  // plan capital's share of the farming capital, times the assumed community pool at base value;
  // the expected value weights it by the launch index.
  function econOf(row) {
    var e = row.economics;
    var farming = Math.max(e.plan_capital_usd, DATA.assumptions.farm_tvl_share * row.tvl_usd);
    var capture = Math.round(DATA.assumptions.pool_share * row.implied_value_usd * (e.plan_capital_usd / farming));
    var expected = Math.round(row.launch.score * capture);
    return { capture: capture, expected: expected, perCost: Math.round((expected / e.plan_cost_usd) * 1e4) / 1e4 };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (key === 'mult') { av = a.model.peer_multiple; bv = b.model.peer_multiple; }
      else if (key === 'evidence') { av = a.model.evidence_peers; bv = b.model.evidence_peers; }
      else if (key === 'launch') { av = a.launch.score; bv = b.launch.score; }
      else if (key === 'ev') { av = a.economics.ev_per_cost; bv = b.economics.ev_per_cost; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('div', null,
          el('div', { class: 'brand-name', text: 'TOKEN LAUNCH RADAR' }),
          el('div', { class: 'brand-sub', text: 'pre-token protocols, ranked by implied launch value' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('h1', { text: 'Which protocol with no token yet is worth farming next?' }),
      el('p', null,
        'Every protocol here that ', el('b', { text: 'records no token' }), ' is valued the way its own category\u2019s traded peers are valued, adjusted for momentum, age and standing, then discounted for how many peers stand behind the price; each row states a ', el('b', { text: 'range' }), ', a graded ', el('b', { text: 'launch signal' }), ', an ', el('b', { text: 'evidence grade' }), ' and the ', el('b', { text: 'economics of farming it' }), '.'
      ),
      el('div', { class: 'formula', text: 'implied value (base) = TVL \u00d7 peer multiple (median market cap / TVL of the category\u2019s traded peers, shrunk to the global median) \u00d7 growth factor \u00d7 maturity factor \u00d7 category scale factor \u00d7 evidence factor (0.80\u00d7 with no traded peers, rising toward 1.00\u00d7 as they grow) \u00b7 the range swaps the median for the category\u2019s 25th and 75th peer percentiles' })
    );
  }

  function firstSentence(text) {
    var at = text.indexOf('. ');
    return at >= 0 ? text.slice(0, at + 1) : text;
  }

  function startHere() {
    var bySlug = {};
    DATA.rows.forEach(function (r) { bySlug[r.slug] = r; });
    return el('section', { class: 'start' },
      el('div', { class: 'start-head' },
        el('h2', { text: 'Start here' }),
        el('span', { text: 'the five farms a farmer would open first' })
      ),
      el('div', { class: 'start-grid' }, DATA.start_here.map(function (pick, i) {
        var r = bySlug[pick.slug];
        if (!r) return null;
        return el('button', { type: 'button', class: 'pick', title: pick.reason, onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'pick-top' }, el('b', { text: String(i + 1) + '. ' + r.name }), el('span', { class: 'pick-rank', text: 'board #' + r.rank })),
          el('span', { class: 'pick-figs', text: fmtUsd(r.implied_value_usd) + ' base  \u00b7  ' + r.launch.grade + ' signal  \u00b7  est. $' + r.economics.ev_per_cost.toFixed(2) + ' per $1' }),
          el('span', { class: 'pick-reason', text: firstSentence(pick.reason) })
        );
      }))
    );
  }

  function stats() {
    function stat(label, value) { return el('div', { class: 'stat' }, el('span', { text: label }), el('b', null, value)); }
    return el('section', { class: 'stats' },
      stat('Protocols scanned', String(DATA.total_protocols)),
      stat('Record no token', String(DATA.pre_token_protocols)),
      stat('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
      stat('Protocols ranked', String(DATA.board_size)),
      stat('Combined implied value', fmtUsd(DATA.board_implied_total))
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wlBox = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null });
    wlBox.addEventListener('change', function () { state.wl = wlBox.checked; writeHash(); render(); });
    function tabButton(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    var shown = state.tab === 'board' ? filteredRows().length + ' of ' + DATA.board_size + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : 'how the board is built';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Coverage' }), el('label', { class: 'check' }, wlBox, 'Watchlist only')),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }), el('div', { class: 'tabs' }, tabButton('board', 'Radar board'), tabButton('live', 'Live tokens'), tabButton('method', 'Method'))),
      el('span', { class: 'count', text: shown })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function chips(r) {
    if (!r.signals || r.signals.length === 0) return null;
    return el('div', { class: 'chips' }, r.signals.map(function (s) {
      var cls = 'chip' + (s === 'Watchlist' ? ' wl' : s === 'Fast growth' || s === 'Category leader' ? ' hot' : '');
      return el('span', { class: cls, text: s });
    }));
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or widen the category, chain and coverage filters to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render(); } })
      ));
    }
    var maxHigh = Math.max.apply(null, list.map(function (r) { return r.implied_high_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var dots = [0, 1, 2, 3].map(function (i) {
        var on = r.launch.grade === 'Strong' ? i < 4 : r.launch.grade === 'Plausible' ? i < 3 : r.launch.grade === 'Possible' ? i < 2 : i < 1;
        return el('i', { class: on ? 'on' : '' });
      });
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        'data-top': r.rank <= 3 ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank', text: '#' + r.rank }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('div', { class: 'subrow' },
            el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + ((r.chains || []).length === 0 ? 'chain unlisted' : (r.chains || []).slice(0, 2).join(', ') + ((r.chains || []).length > 2 ? ' +' + ((r.chains || []).length - 2) : '')) }),
            chips(r)
          )
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.model.peer_count > 0 ? r.model.peer_multiple.toFixed(3) + '\u00d7' : r.model.peer_multiple.toFixed(3) + '\u00d7 *' }),
        el('td', null, el('span', { class: 'evidence ev-' + r.model.evidence_grade.toLowerCase(), title: r.model.evidence_peers + (r.model.evidence_peers === 1 ? ' traded peer' : ' traded peers') + ' in its category; its value is discounted to ' + r.model.evidence_multiplier.toFixed(2) + '\u00d7 for that evidence' },
          el('b', { text: r.model.evidence_grade }),
          el('span', { class: 'ev-n', text: String(r.model.evidence_peers) })
        )),
        el('td', null, el('span', { class: 'signal', title: 'Launch index ' + r.launch.score.toFixed(2) + ' of 1, from its category\u2019s tokenisation, its age band and its momentum' },
          el('span', { class: 'dots', 'aria-hidden': 'true' }, dots),
          el('span', { text: r.launch.grade })
        )),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'rangebar', 'aria-hidden': 'true' },
            el('i', { class: 'span', style: 'left:' + Math.round((r.implied_low_usd / maxHigh) * 100) + '%;width:' + Math.max(2, Math.round(((r.implied_high_usd - r.implied_low_usd) / maxHigh) * 100)) + '%' }),
            el('i', { class: 'base', style: 'left:' + Math.round((r.implied_value_usd / maxHigh) * 100) + '%' })
          ),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'range', text: fmtUsd(r.implied_low_usd) + ' \u2013 ' + fmtUsd(r.implied_high_usd) })
        )),
        el('td', { class: 'num ev', text: '$' + r.economics.ev_per_cost.toFixed(2) }),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', { class: 'board-table' },
          el('caption', { text: 'The peer multiple is the median market cap per TVL dollar of the category\u2019s traded protocols; * marks the global median, used where a category has too few traded peers. The evidence column grades how many traded peers stand behind a row\u2019s price, and its value is discounted for a thin count. The bar spans each row\u2019s 25th to 75th percentile range, ticked at the base. Select any row for its full model, economics and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('mult', 'Peer \u00d7'),
            sortHeader('evidence', 'Evidence'),
            sortHeader('launch', 'Launch signal'),
            sortHeader('implied', 'Implied value (range)'),
            sortHeader('ev', 'Value / $1'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: r.symbol || '\u2014' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + ((r.chains || []).slice(0, 2).join(', ') || 'chain unlisted') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.value_per_tvl === null ? 'n/a' : r.value_per_tvl.toFixed(3) + '\u00d7' }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Already trading: these protocols are set aside from the ranking, and their market caps are facts, not model output. They are also the evidence the radar is built from: the right-hand column is what the market pays per TVL dollar, and the board\u2019s peer multiples are the medians of this column per category.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Symbol' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Value / TVL' }), el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function methodPanel() {
    var tbody = el('tbody');
    DATA.categories.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.peers) }),
        el('td', { class: 'num', text: c.multiple_low.toFixed(3) + '\u00d7' }),
        el('td', { class: 'num', text: c.multiple.toFixed(3) + '\u00d7' }),
        el('td', { class: 'num', text: c.multiple_high.toFixed(3) + '\u00d7' })
      ));
    });
    return el('section', { class: 'panel method' },
      el('h2', { text: 'How this board is built' }),
      el('p', null, el('b', { text: 'One function scores every protocol. ' }), 'No name is special-cased and no row is hand-picked: the same arithmetic that ranks the first row ranks the last, and the detail drawer of every row shows its own inputs.'),
      el('ul', null,
        el('li', null, el('b', { text: 'Peer multiple. ' }), 'For each category, take every protocol in the snapshot whose token already trades with a market cap, divide market cap by TVL, and take the median. A category with few traded peers is shrunk toward the global median of ', el('b', { text: DATA.global_multiple.toFixed(3) + '\u00d7' }), ', so four peers move the number less than forty would.'),
        el('li', null, el('b', { text: 'Growth factor. ' }), 'The seven-day TVL change, clamped between \u221250% and +100%, moves the value by up to \u00b130%: 1 + change \u00d7 0.6. A protocol whose TVL is leaving is worth less than its size suggests; one gathering TVL is worth more.'),
        el('li', null, el('b', { text: 'Maturity factor. ' }), 'A protocol that has run for years with no token has a record a launch can be priced on; a three-week-old one has mostly hope. The factor runs from 0.75 for a brand-new listing to 1.10 at four years, with 0.90 where the listing date is unrecorded.'),
        el('li', null, el('b', { text: 'Category scale factor. ' }), 'Where a category has too few traded peers to price it, every protocol in it would otherwise be valued at the one global median and ranked on raw size alone. The scale factor prices standing instead: each protocol\u2019s TVL percentile among the pre-token protocols of its own category, mapped from 0.90 for the smallest of its field to 1.10 for the largest, with 1.00 for a category of one. The leader of a thin category is a more credible launch than its tenth protocol, and the board says so.'),
        el('li', null, el('b', { text: 'Evidence factor. ' }), 'A price is only as good as the evidence under it, and the board discounts for the count rather than hiding it in the range. The factor is 0.80 + 0.20 \u00d7 n/(n + 6), where n is the number of traded peers in the protocol\u2019s own category: a category with none keeps 0.80 of its priced value, one peer earns 0.83, four earn 0.88, fifteen earn 0.94, and the discount fades toward 1.00 as the count grows, on the same curve the multiples shrink on. It multiplies the base and both ends of the range alike, so a thin-evidence row is worth less, not merely stated more widely. The count also grades each row\u2019s evidence on the board itself: Strong at ten or more traded peers, Fair at four to nine, Thin below four. A value priced on two peers is a guess with a number attached; the same value priced on forty is a market reading, and the board prices them differently because they are different.'),
        el('li', null, el('b', { text: 'The range. ' }), 'A single number pretends to a precision the evidence does not carry, so each row also states a low and a high: the same product, evidence discount included, with the category\u2019s 25th and 75th peer percentiles in place of the median, each shrunk toward the global percentiles by the same peer count. The spread is the real dispersion of what that category\u2019s tokens trade for per TVL dollar. Rows priced on the global median carry the whole market\u2019s spread, which is why their high ends are the board\u2019s least reliable figures, and their plans say so. The board ranks by the base, so the order is one claim, stated once.'),
        el('li', null, el('b', { text: 'Launch signal. ' }), 'Value answers what a token would be worth; the signal grades the separate evidence that one comes at all. It is an index from 0 to 1, never a probability: 45% the category\u2019s tokenisation rate, the share of its protocols in the snapshot that already record a token, shrunk toward the global share by category size; 30% an age band, because the launch window is hump-shaped (under six months scores 0.35, six months to two years 0.75, two to four years 0.65, four to six years 0.50, past six tokenless years 0.35 again, since a protocol that has run that long with no token increasingly reads as a deliberate no-token model, and the maturity factor already rewards the record in the value); and 25% momentum, the seven-day TVL change clamped to \u00b130% and mapped onto 0 to 1. The grades are Strong at 0.62 and above, Plausible at 0.50, Possible at 0.38, Faint below.'),
        el('li', null, el('b', { text: 'Farmer economics. ' }), 'Each plan commits a core capital and an estimated fee total over its hold; the drawer adds them into one committed cost. Against it stands a capture estimate built on two assumptions, stated here because everything downstream depends on them: that a launch reserves ', el('b', { text: (DATA.assumptions.pool_share * 100).toFixed(0) + '%' }), ' of its implied value for the community that farmed it, and that farming wallets hold about ', el('b', { text: (DATA.assumptions.farm_tvl_share * 100).toFixed(0) + '%' }), ' of a protocol\u2019s TVL, so one wallet\u2019s slice of the pool follows its capital\u2019s share of that farming capital. The expected value is that capture weighted by the launch index, and value per $1 divides it by the committed cost. Every one of these figures is an estimate and is labelled one wherever it appears; change the two assumptions and the order changes, which is exactly why they are printed.'),
        el('li', null, el('b', { text: 'Start here. ' }), 'The strip weighs the three standings a farmer weighs together: a row\u2019s base value standing on the board (on a log scale, so the giants do not swallow the measure), its launch index, and its value-for-money standing, averaged. Its reasons quote the row\u2019s own figures, including its stated risk where it has one.'),
        el('li', null, el('b', { text: 'Coverage. ' }), 'The watchlist, every protocol at or above ' + fmtUsd(DATA.floor_usd) + ' of TVL that records no token and is not a wrapped, staked or bridged product of a traded token, is ranked in full. Below the floor the radar adds the strongest clean candidates by the same rule, because the launches worth farming early rarely start large. Centralised exchanges are never ranked: their TVL is customer balances, not a protocol a token would capitalise.'),
        el('li', null, el('b', { text: 'Honest limits. ' }), 'DefiLlama\u2019s record is not proof: the board says a protocol records no token, never that it has none. An implied value is what a launch would be worth if the protocol\u2019s record stayed as it is; it is not a forecast that a token will be issued, or when.')
      ),
      el('h3', { text: 'Peer multiples by category' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'mini' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Traded peers' }), el('th', { scope: 'col', text: '25th pct' }), el('th', { scope: 'col', text: 'Median (base)' }), el('th', { scope: 'col', text: '75th pct' }))),
          tbody
        )
      )
    );
  }

  function boardFoot() {
    return el('p', { class: 'foot', text: 'Source: ' + DATA.source + '. Implied values, ranges, launch signals and economics are this board\u2019s own model output, computed only from the snapshot\u2019s figures and the two assumptions stated in the Method view; the economics are estimates, and none of it is prices, advice, or a claim by anyone that a token will be issued.' });
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'RANK #' + row.rank + ' OF ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' \u00b7 ' + ((row.chains || []).join(', ') || 'chain unlisted') }),
        chips(row)
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var rng = rangeOf(row);
    var lch = launchOf(row);
    var eco = econOf(row);
    var rangeAgrees = rng.low === row.implied_low_usd && rng.base === row.implied_value_usd && rng.high === row.implied_high_usd;
    var launchAgrees = lch.score === row.launch.score && lch.grade === row.launch.grade;
    var econAgrees = eco.capture === row.economics.capture_estimate_usd && eco.expected === row.economics.expected_value_usd && eco.perCost === row.economics.ev_per_cost;
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied launch value' }),
      el('div', { class: 'big-implied', text: fmtUsd(row.implied_value_usd) }),
      el('div', { class: 'bigrange', text: 'est. range ' + fmtUsd(row.implied_low_usd) + ' \u2013 ' + fmtUsd(row.implied_high_usd) + ' (peer 25th\u201375th percentile)' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple (median)' }), el('b', { text: row.model.peer_multiple.toFixed(3) + '\u00d7' })),
        el('div', null, el('span', { text: 'Peer range (25th\u201375th)' }), el('b', { text: row.model.peer_multiple_low.toFixed(3) + '\u00d7 \u2013 ' + row.model.peer_multiple_high.toFixed(3) + '\u00d7' })),
        el('div', null, el('span', { text: 'Peer basis' }), el('b', { text: row.model.peer_count > 0 ? row.model.peer_count + ' traded peers in its category' : 'global percentiles (its category has ' + row.model.evidence_peers + (row.model.evidence_peers === 1 ? ' traded peer' : ' traded peers') + ', too few to price it)' })),
        el('div', null, el('span', { text: '7d TVL change' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth factor' }), el('b', { text: row.model.growth_multiplier.toFixed(3) + '\u00d7' })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) + (row.listed_at ? ' (since ' + row.listed_at + ')' : '') })),
        el('div', null, el('span', { text: 'Maturity factor' }), el('b', { text: row.model.maturity_multiplier.toFixed(3) + '\u00d7' })),
        el('div', null, el('span', { text: 'Standing in category' }), el('b', { text: 'TVL percentile ' + Math.round(row.model.category_percentile * 100) + '% of ' + row.model.category_field_size + ' pre-token ' + (row.category || 'Uncategorised') })),
        el('div', null, el('span', { text: 'Scale factor' }), el('b', { text: row.model.scale_multiplier.toFixed(3) + '\u00d7' })),
        el('div', null, el('span', { text: 'Evidence grade' }), el('b', { text: row.model.evidence_grade + ' \u00b7 ' + row.model.evidence_peers + (row.model.evidence_peers === 1 ? ' traded peer' : ' traded peers') + ' in its category' })),
        el('div', null, el('span', { text: 'Evidence factor' }), el('b', { text: row.model.evidence_multiplier.toFixed(3) + '\u00d7' })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value: low / base / high' }), el('b', { text: fmtUsd(row.implied_low_usd) + ' / ' + fmtUsd(row.implied_value_usd) + ' / ' + fmtUsd(row.implied_high_usd) }))
      ),
      el('p', { class: 'checkline', text: 'This page recomputes all three figures from the same factors as ' + fmtUsd(rng.low) + ' / ' + fmtUsd(rng.base) + ' / ' + fmtUsd(rng.high) + (rangeAgrees ? ', the numbers board.json carries. The screen and the data agree.' : ', which differ from the board: the data would be stale.') })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Launch signal' }),
      el('div', { class: 'big-launch', text: row.launch.grade + '  \u00b7  index ' + row.launch.score.toFixed(2) + ' of 1' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Category tokenisation (45%)' }), el('b', { text: row.launch.category_size > 0 ? row.launch.category_traded + ' of ' + row.launch.category_size + ' in its category already trade a token' : 'global share (category unrecorded)' })),
        el('div', null, el('span', { text: 'Age band (30%)' }), el('b', { text: 'scores ' + row.launch.age_score.toFixed(2) + ' at ' + fmtAge(row.age_days) + ' with no token' })),
        el('div', null, el('span', { text: 'Momentum (25%)' }), el('b', { text: 'scores ' + row.launch.momentum_score.toFixed(2) + ' on ' + fmtPct(row.change_7d) + ' TVL in 7d' })),
        el('div', { class: 'total' }, el('span', { text: 'Launch index' }), el('b', { text: row.launch.score.toFixed(2) + ' \u2192 ' + row.launch.grade }))
      ),
      el('p', { class: 'checkline', text: 'An index from the snapshot\u2019s evidence, not a probability: it grades how much of the pattern of past launches this protocol shows. This page recomputes it as ' + lch.score.toFixed(2) + ' \u2192 ' + lch.grade + (launchAgrees ? ', as recorded.' : ', which differs from the record.') })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farmer economics (estimates)' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Plan capital committed' }), el('b', { text: fmtUsd(row.economics.plan_capital_usd) })),
        el('div', null, el('span', { text: 'Plan fees over the hold (est.)' }), el('b', { text: fmtUsd(row.economics.plan_fees_usd) })),
        el('div', null, el('span', { text: 'Hold' }), el('b', { text: row.economics.plan_weeks + ' weeks, about ' + row.economics.plan_hours + ' active hours' })),
        el('div', null, el('span', { text: 'Total committed' }), el('b', { text: fmtUsd(row.economics.plan_cost_usd) })),
        el('div', null, el('span', { text: 'Capture if it launches at base (est.)' }), el('b', { text: fmtUsd(row.economics.capture_estimate_usd) })),
        el('div', null, el('span', { text: 'Expected value, launch-weighted (est.)' }), el('b', { text: fmtUsd(row.economics.expected_value_usd) })),
        el('div', { class: 'total' }, el('span', { text: 'Value per $1 committed (est.)' }), el('b', { text: '$' + row.economics.ev_per_cost.toFixed(2) }))
      ),
      el('p', { class: 'checkline', text: 'Estimates, built on the two assumptions the Method view states: a ' + (DATA.assumptions.pool_share * 100).toFixed(0) + '% community pool at launch and farming wallets at ' + (DATA.assumptions.farm_tvl_share * 100).toFixed(0) + '% of TVL. This page recomputes the capture as ' + fmtUsd(eco.capture) + ' and the expected value as ' + fmtUsd(eco.expected) + (econAgrees ? ', as recorded.' : ', which differ from the record.') })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('div', null, el('b', { text: action }), tail ? el('span', { class: 'cost', text: tail }) : null));
      })),
      el('p', { class: 'checkline', text: 'The plan is generated from this protocol\u2019s category, its chains in cost order, its TVL, its trend, its age and its standing, the same derivation that wrote it into board.json; no step in it could be moved to another protocol unchanged. Costs are estimates in dollars at typical network fees.' })
    ));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(stats());
    if (state.tab === 'board') shell.appendChild(startHere());
    shell.appendChild(controls());
    if (state.tab === 'board') { shell.appendChild(boardTable()); shell.appendChild(boardFoot()); }
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else shell.appendChild(methodPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
