// Apex Radar — the dashboard. Renders window.APEX_RADAR (written by main.ts
// from the sealed snapshot) with no network and no framework.
// SPDX-License-Identifier: MIT
(function () {
  'use strict';
  var DATA = window.APEX_RADAR;
  var rows = DATA.rows;
  var live = DATA.live;
  var excluded = DATA.excluded;

  // ------------------------------------------------------------- helpers
  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    var s = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    return s;
  }
  function pctClass(v) { return v === null ? '' : v >= 0 ? 'up' : 'down'; }
  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // ------------------------------------------------------------- starred set
  var STAR_KEY = 'apex-radar-stars';
  var stars = {};
  try { stars = JSON.parse(localStorage.getItem(STAR_KEY) || '{}'); } catch (e) { stars = {}; }
  function isStarred(slug) { return !!stars[slug]; }
  function toggleStar(slug) {
    if (stars[slug]) delete stars[slug]; else stars[slug] = 1;
    try { localStorage.setItem(STAR_KEY, JSON.stringify(stars)); } catch (e) { /* private mode */ }
  }

  // ------------------------------------------------------------- model sandbox
  // The sandbox re-ranks the board in the page from the same snapshot
  // figures, with the reader's own growth weight and peer cap. It never
  // touches board.json: the submitted ranking is main.ts's, the sandbox
  // is exploration only.
  var sandbox = { on: false, growthWeight: 0.6, peerCapX: 2 };
  function sandboxImplied(r) {
    var growthPct = r.change_7d === null ? 0 : clamp(r.change_7d, -50, 150);
    var growth = 1 + (growthPct / 100) * sandbox.growthWeight;
    var peer = Math.min(r.peer_multiple, sandbox.peerCapX * DATA.global_peer_multiple);
    return Math.max(1, Math.round(r.tvl_usd * peer * growth * r.maturity_factor * r.breadth_factor));
  }
  function displayValue(r) { return sandbox.on ? sandboxImplied(r) : r.implied_value_usd; }

  // ------------------------------------------------------------- header stats
  var top = rows[0];
  $('stats').innerHTML =
    stat(money(top ? top.implied_value_usd : 0), 'Top implied value') +
    stat(String(DATA.board_size), 'Launch candidates') +
    stat(String(DATA.watchlist_size), 'On the watchlist') +
    stat('×' + DATA.global_peer_multiple.toFixed(2), 'Global peer multiple') +
    stat(DATA.as_of, 'Snapshot date');
  function stat(value, label) {
    return '<div class="stat"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }
  $('source-line').textContent = 'Data: ' + DATA.source + '. Floor for the watchlist: ' + moneyFull(DATA.floor_usd) + '. ' +
    excluded.length + ' pre-token protocols are not a launch and are listed apart.';

  // ------------------------------------------------------------- filter options
  var categories = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) === -1) categories.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
  });
  categories.sort();
  chains.sort();
  categories.forEach(function (c) { addOption($('category'), c, c); });
  chains.forEach(function (c) { addOption($('chain'), c, c); });
  function addOption(select, value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    select.appendChild(o);
  }

  // ------------------------------------------------------------- filtering
  function currentRows() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('category').value;
    var chain = $('chain').value;
    var minTvl = Number($('min-tvl').value);
    var watchOnly = $('watch-only').checked;
    var starredOnly = $('starred-only').checked;
    var out = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (r.tvl_usd < minTvl) return false;
      if (watchOnly && !r.on_watchlist) return false;
      if (starredOnly && !isStarred(r.slug)) return false;
      return true;
    });
    var sort = $('sort').value;
    var by = {
      value: function (a, b) { return displayValue(b) - displayValue(a); },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
      name: function (a, b) { return a.name.localeCompare(b.name); },
    };
    out.sort(by[sort] || by.value);
    return out;
  }

  function renderBoard() {
    var list = currentRows();
    // In the sandbox the rank column follows the sandbox's own ordering.
    var rankOf = {};
    if (sandbox.on) {
      var ranked = rows.slice().sort(function (a, b) { return displayValue(b) - displayValue(a); });
      ranked.forEach(function (r, i) { rankOf[r.slug] = i + 1; });
    }
    var html = list.map(function (r) {
      var badge = r.on_watchlist ? '<span class="badge watch">WATCHLIST</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + (sandbox.on ? rankOf[r.slug] : r.rank) + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><small>' + esc(r.slug) + '</small>' + badge + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><b>' + money(displayValue(r)) + '</b></td>' +
        '<td class="num">×' + r.peer_multiple.toFixed(2) + '</td>' +
        '<td class="star-col"><button class="star-btn' + (isStarred(r.slug) ? ' on' : '') + '" data-star="' + esc(r.slug) + '" aria-label="Star ' + esc(r.name) + '">' + (isStarred(r.slug) ? '★' : '☆') + '</button></td>' +
        '</tr>';
    }).join('');
    $('rows').innerHTML = html;
    $('empty').hidden = list.length !== 0;
    $('count').textContent = list.length + ' of ' + rows.length + ' launch candidates shown — click any row for its detail and farm plan.' +
      (sandbox.on ? ' Sandbox on: values and ranks follow your growth weight ' + sandbox.growthWeight.toFixed(2) + ' and peer cap ' + sandbox.peerCapX.toFixed(1) + '× — board.json is unchanged.' : '');
  }

  // ------------------------------------------------------------- live view
  $('live-rows').innerHTML = live.map(function (p) {
    return '<tr>' +
      '<td class="name"><b>' + esc(p.name) + '</b><small>' + esc(p.slug) + '</small></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td>' + esc(p.chains.slice(0, 3).join(', ')) + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + (p.mcap_usd === null ? '—' : money(p.mcap_usd)) + '</td>' +
      '<td class="num">' + (p.multiple === null ? '—' : '×' + p.multiple.toFixed(2)) + '</td>' +
      '<td class="num ' + pctClass(p.change_7d) + '">' + pct(p.change_7d) + '</td>' +
      '</tr>';
  }).join('');

  // ------------------------------------------------------------- not-a-launch view
  $('notlaunch-rows').innerHTML = excluded.map(function (p) {
    return '<tr>' +
      '<td class="name"><b>' + esc(p.name) + '</b><small>' + esc(p.slug) + '</small></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td>' + esc(p.chains.slice(0, 3).join(', ')) + (p.chains.length > 3 ? ' +' + (p.chains.length - 3) : '') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td>' + esc(p.reason) + '</td>' +
      '</tr>';
  }).join('');

  // ------------------------------------------------------------- method view + sandbox
  $('method-body').innerHTML =
    '<h2>How Apex Radar prices a launch that has not happened</h2>' +
    '<p>Each protocol on the board records no token in the snapshot and passes the launch rule. ' +
    'Its implied value is what the token would be worth <i>if</i> the protocol launched one today ' +
    'and the market priced it like the tokens of its peers — nothing more. It is the board\u2019s own ' +
    'claim, never a prediction.</p>' +
    '<pre>peer multiple   median mcap / TVL of the token-bearing protocols\n' +
    '                in the same category, shrunk toward the global\n' +
    '                median (global ×' + DATA.global_peer_multiple.toFixed(2) + ') with eight peers\n' +
    '                needed before a category\u2019s own median dominates;\n' +
    '                each peer\u2019s ratio is winsorised at 3× first, and\n' +
    '                no category\u2019s multiple may exceed 2× the global\n' +
    '                median, so one thin peer cannot set a price\n' +
    'growth          1 + clamp(change_7d, -50, +150) / 100 × 0.6\n' +
    'maturity        0.80 + 0.20 × min(age_days, 1095) / 1095\n' +
    'breadth         1 + 0.02 × min(chains − 1, 5)\n\n' +
    'implied value = TVL × peer × growth × maturity × breadth</pre>' +
    '<p>Every factor comes from the snapshot itself. No protocol name is special-cased: ' +
    'the same function scores all ' + DATA.board_size + ' rows. Protocols whose token already ' +
    'trades are kept apart under \u201cAlready trading\u201d and shown at the market\u2019s own value; ' +
    'the ' + DATA.excluded_size + ' pre-token protocols that fail the launch rule are kept apart under ' +
    '\u201cNot a launch\u201d, each with its reason.</p>' +
    '<h2>What counts as a launch</h2>' +
    '<p>The watchlist (' + DATA.watchlist_size + ' protocols at or above ' + moneyFull(DATA.floor_usd) +
    ' TVL with no token and no wrapped/staked parent) is the floor, never the ceiling: the board ' +
    'carries every rankable pre-token protocol in the snapshot, including the early ones below the ' +
    'floor. A wrapped, staked or bridged product of a token that already trades is not a launch of ' +
    'its own — WBTC is Bitcoin on Ethereum, Binance staked ETH is ETH in Binance\u2019s staking ' +
    'product — and neither is a versioned pool or an exchange\u2019s own product.</p>' +
    '<h2>How to read a farm plan</h2>' +
    '<p>Each plan is concrete: what to do, what it costs in gas, and how long to hold the position. ' +
    'Farm with money you can leave untouched for 60 days, never more than 5% of a portfolio in one ' +
    'unlaunched protocol, and keep a log of every transaction hash — a plan is worthless if you ' +
    'cannot prove you did it.</p>' +
    '<h2>Model sandbox — re-rank the board yourself</h2>' +
    '<p>Two sliders change the model and re-rank the board live, from the same snapshot figures. ' +
    'The sandbox never changes board.json: the submitted ranking is the one main.ts wrote.</p>' +
    '<div class="sandbox">' +
    '<label class="sandbox-row">Growth weight <span id="sandbox-growth-val">0.60</span>' +
    '<input id="sandbox-growth" type="range" min="0" max="1" step="0.05" value="0.6"></label>' +
    '<label class="sandbox-row">Peer cap, × global median <span id="sandbox-cap-val">2.0×</span>' +
    '<input id="sandbox-cap" type="range" min="1" max="3" step="0.1" value="2"></label>' +
    '<p><button id="sandbox-reset" type="button">Reset the sandbox</button> ' +
    '<span id="sandbox-note">Sandbox off — tick “Model sandbox” above the board to try it.</span></p>' +
    '</div>';

  function syncSandboxLabels() {
    $('sandbox-growth-val').textContent = sandbox.growthWeight.toFixed(2);
    $('sandbox-cap-val').textContent = sandbox.peerCapX.toFixed(1) + '×';
    $('sandbox-note').textContent = sandbox.on
      ? 'Sandbox on: the board follows growth weight ' + sandbox.growthWeight.toFixed(2) +
        ' and peer cap ' + sandbox.peerCapX.toFixed(1) + '× the global median.'
      : 'Sandbox off — tick “Model sandbox” above the board to try it.';
  }
  $('sandbox-growth').addEventListener('input', function (ev) {
    sandbox.growthWeight = Number(ev.target.value);
    syncSandboxLabels();
    renderBoard();
  });
  $('sandbox-cap').addEventListener('input', function (ev) {
    sandbox.peerCapX = Number(ev.target.value);
    syncSandboxLabels();
    renderBoard();
  });
  $('sandbox-reset').addEventListener('click', function () {
    sandbox.growthWeight = 0.6;
    sandbox.peerCapX = 2;
    $('sandbox-growth').value = '0.6';
    $('sandbox-cap').value = '2';
    syncSandboxLabels();
    renderBoard();
  });
  syncSandboxLabels();

  // ------------------------------------------------------------- detail view
  var selectedSlug = null;
  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var panel = $('detail');
    if (!r) { panel.hidden = true; selectedSlug = null; return; }
    selectedSlug = slug;
    var maxBar = Math.max(r.peer_multiple, 1);
    function barRow(label, value, shown) {
      var width = Math.max(4, Math.min(100, (value / maxBar) * 100));
      return '<div class="bar-row"><span>' + label + '</span><div class="bar"><i style="width:' + width.toFixed(0) + '%"></i></div><span class="val">' + shown + '</span></div>';
    }
    function cmpBar(label, value, scale) {
      if (value === null || value === undefined) {
        return '<div class="bar-row"><span>' + label + '</span><div class="bar"></div><span class="val">n/a</span></div>';
      }
      var w = Math.min(100, (Math.abs(value) / scale) * 100);
      var cls = value >= 0 ? 'up' : 'down';
      return '<div class="bar-row"><span>' + label + '</span><div class="bar"><i class="' + (value >= 0 ? 'pos' : 'neg') + '" style="width:' + w.toFixed(1) + '%"></i></div><span class="val ' + cls + '">' + pct(value) + '</span></div>';
    }
    var peers = live.filter(function (p) { return p.category === r.category; }).slice(0, 4);
    var peerLine = peers.length
      ? '<p>Live peers in ' + esc(r.category || 'this category') + ': ' + peers.map(function (p) { return esc(p.name) + ' ×' + (p.multiple === null ? '—' : p.multiple.toFixed(2)); }).join(' · ') + '.</p>'
      : '<p>No live-token peer in this category in the snapshot — the global multiple ×' + DATA.global_peer_multiple.toFixed(2) + ' was used instead.</p>';
    var catMed = (r.category !== null && DATA.category_median_7d[r.category] !== undefined)
      ? DATA.category_median_7d[r.category] : DATA.global_median_7d;
    var scale = Math.max(Math.abs(r.change_7d || 0), Math.abs(catMed), Math.abs(DATA.global_median_7d), 10);
    var shownImplied = displayValue(r);
    panel.innerHTML =
      '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
      (r.on_watchlist ? ' · <span class="badge watch">WATCHLIST</span>' : '') +
      (sandbox.on ? ' · <span class="badge sandbox">SANDBOX</span>' : '') + '</p>' +
      '<div class="detail-grid">' +
      '<div class="kv"><b>' + moneyFull(shownImplied) + '</b><span>Implied value' + (sandbox.on ? ' (sandbox)' : '') + '</span></div>' +
      '<div class="kv"><b>' + moneyFull(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="kv"><b class="' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</b><span>TVL change, 7d</span></div>' +
      '<div class="kv"><b>' + ageText(r.age_days) + '</b><span>Tracked since ' + esc(r.listed_at || 'unknown') + '</span></div>' +
      '<div class="kv"><b>×' + r.peer_multiple.toFixed(2) + '</b><span>Peer multiple (' + r.category_peers + ' peer' + (r.category_peers === 1 ? '' : 's') + ')</span></div>' +
      '</div>' +
      '<h3>Why this value — the model, factor by factor</h3>' +
      '<div class="bars">' +
      barRow('Peer multiple', r.peer_multiple, '×' + r.peer_multiple.toFixed(2)) +
      barRow('Growth factor', r.growth_factor, '×' + r.growth_factor.toFixed(2)) +
      barRow('Maturity factor', r.maturity_factor, '×' + r.maturity_factor.toFixed(2)) +
      barRow('Breadth factor', r.breadth_factor, '×' + r.breadth_factor.toFixed(2)) +
      '</div>' + peerLine +
      '<h3>7-day growth vs its category and the field</h3>' +
      '<div class="bars">' +
      cmpBar(r.name, r.change_7d, scale) +
      cmpBar((r.category || 'Uncategorised') + ' median', catMed, scale) +
      cmpBar('Global median', DATA.global_median_7d, scale) +
      '</div>' +
      '<h3>Farm plan — what to do, what it costs, how long it takes</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p><button id="detail-close" type="button">Close detail</button></p>';
    panel.hidden = false;
    $('detail-close').addEventListener('click', function () { showDetail(null); });
    document.querySelectorAll('#rows tr').forEach(function (tr) {
      tr.classList.toggle('selected', tr.getAttribute('data-slug') === slug);
    });
    panel.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  // ------------------------------------------------------------- events
  $('rows').addEventListener('click', function (ev) {
    var star = ev.target.closest('[data-star]');
    if (star) { toggleStar(star.getAttribute('data-star')); renderBoard(); return; }
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  ['q', 'category', 'chain', 'min-tvl', 'sort', 'watch-only', 'starred-only']
    .forEach(function (id) {
      $(id).addEventListener(id === 'q' ? 'input' : 'change', renderBoard);
    });
  $('sandbox-on').addEventListener('change', function (ev) {
    sandbox.on = ev.target.checked;
    syncSandboxLabels();
    renderBoard();
    if (selectedSlug) showDetail(selectedSlug);
  });

  function setTab(which) {
    $('tab-board').classList.toggle('active', which === 'board');
    $('tab-live').classList.toggle('active', which === 'live');
    $('tab-notlaunch').classList.toggle('active', which === 'notlaunch');
    $('tab-method').classList.toggle('active', which === 'method');
    $('board-view').hidden = which !== 'board';
    $('live-view').hidden = which !== 'live';
    $('notlaunch-view').hidden = which !== 'notlaunch';
    $('method-view').hidden = which !== 'method';
    $('controls').style.display = which === 'board' ? '' : 'none';
    $('count').style.display = which === 'board' ? '' : 'none';
  }
  $('tab-board').addEventListener('click', function () { setTab('board'); });
  $('tab-live').addEventListener('click', function () { setTab('live'); });
  $('tab-notlaunch').addEventListener('click', function () { setTab('notlaunch'); });
  $('tab-method').addEventListener('click', function () { setTab('method'); });

  // Deep links, used by the screenshots and by sharing a view:
  // ?detail=<slug>, ?category=<name>, ?watch=1, ?q=<text>, ?tab=live|notlaunch|method
  var params = new URLSearchParams(window.location.search);
  if (params.get('category')) $('category').value = params.get('category');
  if (params.get('chain')) $('chain').value = params.get('chain');
  if (params.get('min-tvl')) $('min-tvl').value = params.get('min-tvl');
  if (params.get('sort')) $('sort').value = params.get('sort');
  if (params.get('q')) $('q').value = params.get('q');
  if (params.get('watch') === '1') $('watch-only').checked = true;
  if (params.get('tab')) setTab(params.get('tab'));

  renderBoard();
  if (params.get('detail')) showDetail(params.get('detail'));
})();
