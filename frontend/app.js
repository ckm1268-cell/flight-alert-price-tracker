/* Flight Alert Tracker — frontend. Static, no build step. */
(function () {
  'use strict';
  const S = window.FlightShared;
  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY && window.supabase);
  const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY) : null;

  let user = null;
  let alerts = [];
  let latest = {}; // alert id -> latest price row
  let editingId = null;
  const seenTriggered = new Set();

  // escapeHtml alone does NOT escape quotes; attributes need escapeAttr.
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  function banner(msg, kind) {
    const b = $('banner');
    if (!msg) { b.hidden = true; return; }
    b.hidden = false; b.className = 'banner ' + (kind || ''); b.textContent = msg;
  }

  // Default LOCKED before async auth resolves (no flash of an interactive form).
  function setLocked(locked) {
    $('form-fields').disabled = locked;
    $('lock-note').hidden = !locked;
    if (locked) { editingId = null; $('alert-form').reset(); $('save-btn').textContent = 'Start monitoring'; }
  }

  function renderAuth() {
    const box = $('auth-box');
    if (!configured) { box.innerHTML = '<span class="pill SIMULATED">NOT CONFIGURED</span>'; return; }
    if (user) {
      box.innerHTML = '<span class="meta">' + esc(user.email) + '</span> <button class="small" id="signout">Sign out</button>';
      $('signout').onclick = async () => { await sb.auth.signOut(); };
    } else {
      box.innerHTML = '<input id="email" type="email" placeholder="you@email.com" style="width:160px"> <button class="small" id="signin">Email me a link</button>';
      $('signin').onclick = async () => {
        const email = $('email').value.trim();
        if (!email) return banner('Enter your email first.');
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
        banner(error ? 'Sign-in failed: ' + error.message : 'Check your email for the sign-in link.');
      };
    }
  }

  function statusFor(a) {
    const p = latest[a.id];
    if (a.status === 'TRIGGERED') return 'TARGET_REACHED';
    if (!p) return 'SOURCE_UNAVAILABLE';
    return p.status;
  }

  function renderAlerts() {
    const wrap = $('alerts');
    if (!user) { wrap.innerHTML = ''; return; }
    if (!alerts.length) { wrap.innerHTML = '<p class="note">No alerts yet. Create one above.</p>'; return; }
    wrap.innerHTML = alerts.map((a) => {
      const p = latest[a.id];
      const st = statusFor(a);
      const diff = p && p.price != null ? Number(p.price) - Number(a.target_price) : null;
      const diffTxt = diff == null ? '' : (diff <= 0 ? '<span class="diff ok">' + S.formatPrice(Math.abs(diff), a.currency) + ' under target</span>' : '<span class="diff bad">' + S.formatPrice(diff, a.currency) + ' over target</span>');
      const showPrice = p && p.price != null && (p.status === 'LIVE' || p.status === 'STALE' || p.status === 'SIMULATED');
      const errTip = p && p.error_message ? ' title="' + escAttr(p.error_message) + '"' : '';
      return '<article class="card" data-id="' + escAttr(a.id) + '">' +
        '<div class="alert-head"><div><div class="route">' + esc(a.origin) + ' → ' + esc(a.destination) + '</div>' +
        '<div class="meta">' + esc(a.depart_date) + (a.return_date ? ' – ' + esc(a.return_date) : ' · one-way') + ' · target ' + esc(a.condition) + ' ' + S.formatPrice(a.target_price, a.currency) + '</div></div>' +
        '<span class="pill ' + escAttr(st) + '"' + errTip + '>' + esc(st.replace('_', ' ')) + '</span></div>' +
        '<div class="price">' + (showPrice ? S.formatPrice(p.price, a.currency) : '—') + '</div>' +
        '<div>' + diffTxt + '</div>' +
        '<div class="meta">' + (p ? (esc(p.data_kind) === 'CACHED' ? '<span class="badge cached">CACHED FARE</span> ' : '<span class="badge">LIVE PAGE</span> ') +
          'Last checked ' + esc(S.timeAgo(p.retrieved_at)) + (p.status !== 'LIVE' && !showPrice ? ' · SOURCE UNAVAILABLE' : '') : 'Not checked yet — next scheduled run will fetch it') + '</div>' +
        (a.status === 'TRIGGERED' ? '<div class="meta">Triggered at ' + S.formatPrice(a.last_notified_price, a.currency) + '. Edit the target or re-arm to keep watching.</div>' : '') +
        '<div class="actions">' +
          '<button class="small" data-act="chart">History</button>' +
          '<button class="small" data-act="edit">Edit</button>' +
          (a.status === 'TRIGGERED' ? '<button class="small" data-act="rearm">Re-arm</button>' : '') +
          '<button class="small" data-act="toggle">' + (a.status === 'DISABLED' ? 'Resume' : 'Pause') + '</button>' +
          '<button class="small" data-act="delete">Delete</button></div></article>';
    }).join('');
  }

  async function load() {
    if (!sb || !user) { alerts = []; latest = {}; renderAlerts(); return; }
    const { data, error } = await sb.from('alerts').select('*').order('created_at', { ascending: false });
    if (error) return banner('Could not load alerts: ' + error.message);
    alerts = data || [];
    latest = {};
    await Promise.all(alerts.map(async (a) => {
      const { data: rows } = await sb.from('prices').select('*')
        .eq('origin', a.origin).eq('destination', a.destination).eq('depart_date', a.depart_date)
        .eq('currency', a.currency).in('source', a.sources || ['travelpayouts'])
        .order('retrieved_at', { ascending: false }).limit(10);
      const valid = (rows || []).filter((r) => r.validation_status === 'PASSED' && r.price != null);
      latest[a.id] = valid.length ? valid.reduce((x, y) => (Number(y.price) < Number(x.price) ? y : x)) : ((rows || [])[0] || null);
    }));
    renderAlerts();
    notifyNewlyTriggered();
  }

  function notifyNewlyTriggered() {
    alerts.filter((a) => a.status === 'TRIGGERED' && a.notify_browser).forEach((a) => {
      if (seenTriggered.has(a.id)) return;
      seenTriggered.add(a.id);
      const msg = a.origin + '→' + a.destination + ' reached ' + S.formatPrice(a.last_notified_price, a.currency) + ' (cached fare — verify before booking)';
      banner('🎯 ' + msg, 'alert');
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Flight alert', { body: msg });
    });
  }

  async function saveAlert(e) {
    e.preventDefault();
    if (!user) return;
    const origin = S.normIata($('origin').value), destination = S.normIata($('destination').value);
    if (!S.isIata(origin) || !S.isIata(destination)) return banner('IATA codes must be exactly 3 letters (e.g. KUL).');
    if (origin === destination) return banner('Origin and destination must differ.');
    const depart = $('depart').value, ret = $('return').value || null;
    if (ret && ret < depart) return banner('Return date is before departure.');
    const sources = []; if ($('src-travelpayouts').checked) sources.push('travelpayouts');
    if (!sources.length) return banner('Pick at least one source.');
    const row = {
      user_id: user.id, origin, destination, depart_date: depart, return_date: ret, currency: $('currency').value,
      condition: $('condition').value, target_price: Number($('target').value), sources,
      notify_browser: $('n-browser').checked, notify_email: $('n-email').checked,
    };
    if ($('n-browser').checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    const q = editingId ? sb.from('alerts').update(row).eq('id', editingId) : sb.from('alerts').insert(row);
    const { error } = await q;
    if (error) return banner('Save failed: ' + error.message);
    banner('Saved. The next scheduled check will fetch a price.');
    editingId = null; $('alert-form').reset(); $('save-btn').textContent = 'Start monitoring';
    load();
  }

  async function onAction(ev) {
    const btn = ev.target.closest('button[data-act]'); if (!btn) return;
    const id = btn.closest('article').dataset.id; const a = alerts.find((x) => x.id === id); if (!a) return;
    const act = btn.dataset.act;
    if (act === 'delete') { if (confirm('Delete this alert?')) { await sb.from('alerts').delete().eq('id', id); seenTriggered.delete(id); load(); } }
    else if (act === 'toggle') { await sb.from('alerts').update({ status: a.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' }).eq('id', id); load(); }
    else if (act === 'rearm') { await sb.from('alerts').update({ status: 'ACTIVE' }).eq('id', id); seenTriggered.delete(id); load(); }
    else if (act === 'edit') {
      editingId = id; $('origin').value = a.origin; $('destination').value = a.destination; $('depart').value = a.depart_date;
      $('return').value = a.return_date || ''; $('currency').value = a.currency; $('condition').value = a.condition;
      $('target').value = a.target_price; $('n-browser').checked = a.notify_browser; $('n-email').checked = a.notify_email;
      $('save-btn').textContent = 'Save changes'; window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (act === 'chart') showChart(a);
  }

  async function showChart(a) {
    const { data } = await sb.from('prices').select('price,retrieved_at').eq('origin', a.origin).eq('destination', a.destination)
      .eq('depart_date', a.depart_date).eq('currency', a.currency).eq('validation_status', 'PASSED')
      .gte('retrieved_at', new Date(Date.now() - 7 * 864e5).toISOString()).order('retrieved_at');
    const pts = (data || []).map((r) => ({ t: new Date(r.retrieved_at).getTime(), p: Number(r.price) }));
    const body = $('chart-body');
    if (pts.length < 2) body.innerHTML = '<p>Not enough validated readings yet (need 2+). History appears after a few scheduled checks.</p>';
    else {
      const W = 560, H = 220, m = 30;
      const minT = pts[0].t, maxT = pts[pts.length - 1].t || minT + 1;
      let minP = Math.min(...pts.map((x) => x.p), Number(a.target_price)), maxP = Math.max(...pts.map((x) => x.p), Number(a.target_price));
      if (minP === maxP) { minP -= 1; maxP += 1; }
      const X = (t) => m + ((t - minT) / (maxT - minT || 1)) * (W - 2 * m);
      const Y = (p) => H - m - ((p - minP) / (maxP - minP)) * (H - 2 * m);
      const path = pts.map((x, i) => (i ? 'L' : 'M') + X(x.t).toFixed(1) + ',' + Y(x.p).toFixed(1)).join(' ');
      body.innerHTML = '<h3>' + esc(a.origin) + ' → ' + esc(a.destination) + ' · last 7 days</h3>' +
        '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '"><line x1="' + m + '" x2="' + (W - m) + '" y1="' + Y(Number(a.target_price)) + '" y2="' + Y(Number(a.target_price)) + '" stroke="#c62828" stroke-dasharray="5 4"/>' +
        '<path d="' + path + '" fill="none" stroke="#0b5fff" stroke-width="2"/>' +
        '<text x="' + m + '" y="14" font-size="11" fill="currentColor">max ' + Math.round(maxP) + '</text><text x="' + m + '" y="' + (H - 8) + '" font-size="11" fill="currentColor">min ' + Math.round(minP) + ' · red = target</text></svg>' +
        '<p class="meta">Validated readings only. ' + (pts.length) + ' points. Cached fares.</p>';
    }
    $('chart-dialog').showModal();
  }

  function init() {
    setLocked(true);
    renderAuth();
    $('alert-form').addEventListener('submit', saveAlert);
    $('alerts').addEventListener('click', onAction);
    $('chart-close').onclick = () => $('chart-dialog').close();
    if (!configured) {
      banner('SIMULATED / NOT CONFIGURED: set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in config.js. No prices are shown until then.', 'sim');
      return;
    }
    sb.auth.onAuthStateChange((_evt, session) => {
      user = session ? session.user : null;
      setLocked(!user); renderAuth(); load();
    });
    sb.auth.getSession().then(({ data }) => { user = data.session ? data.session.user : null; setLocked(!user); renderAuth(); load(); });
    setInterval(() => { if (user && !document.hidden) load(); }, 60000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
