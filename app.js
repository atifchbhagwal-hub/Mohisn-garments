// Mohsin Garments POS — v1.2.0
// Sale (cash), items with size/color variants, categories, sales history, receipt print/share.
import { firebaseConfig, OWNER_EMAILS, SHOP_ID } from './config.js?v=1.2.0';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signInAnonymously, signOut } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, setDoc, deleteDoc, onSnapshot, runTransaction, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
let db;
try { db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch { db = initializeFirestore(fb, {}); }
const shop = () => doc(db, 'shops', SHOP_ID);
const col = name => collection(shop(), name);

const $ = id => document.getElementById(id);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = n => r2(n).toLocaleString('en-PK');
const today = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const uid = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
let toastT = null;
const toast = m => { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); };
const modal = (title, html) => { $('dtitle').textContent = title; $('dbody').innerHTML = html; if (!$('dialog').open) $('dialog').showModal(); };
$('dclose').onclick = () => $('dialog').close();

// ---------- state ----------
let user = null, role = '', view = 'sale';
let items = [], cats = [], sales = [], cfg = { staffPin: '', shopName: 'Mohsin Garments', tagline: 'Premium Menswear & Fabrics', address: '', phone: '', phone2: '', notes: '', footer: 'Shukriya — dobara tashreef layein', showLogo: true, paper: '80' };
let cart = [], paid = null, discAll = 0, custName = '';
const stops = [];
const isOwner = () => role === 'owner';

// ---------- auth ----------
$('login').querySelectorAll('[data-role]').forEach(b => b.onclick = () => {
  $('login').querySelectorAll('[data-role]').forEach(x => x.classList.toggle('selected', x === b));
  $('ownerForm').hidden = b.dataset.role !== 'owner'; $('staffForm').hidden = b.dataset.role !== 'staff';
});
$('ownerForm').onsubmit = async e => {
  e.preventDefault(); $('loginMsg').textContent = '';
  const f = e.target;
  try { await signInWithEmailAndPassword(auth, f.elements.email.value.trim(), f.elements.password.value); }
  catch (err) { $('loginMsg').textContent = 'Login nahi hua: ' + (err.code || err.message); }
};
// Mulazim: PIN ka hash = key id. Rules: session doc tabhi banta hai jab keys/<hash> active ho.
async function pinKey(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mg-v1:' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
let pendingKey = '';
$('staffForm').onsubmit = async e => {
  e.preventDefault(); $('loginMsg').textContent = '';
  const pin = e.target.elements.pin.value.trim();
  if (!/^\d{4,6}$/.test(pin)) { $('loginMsg').textContent = 'PIN 4-6 hindse ka hai'; return; }
  try {
    pendingKey = await pinKey(pin);
    await signInAnonymously(auth);
  } catch (err) { $('loginMsg').textContent = err.message || 'Nahi hua'; }
};
$('logout').onclick = async () => { if (confirm('Logout karein?')) { localStorage.removeItem('mg-staff-pin'); await signOut(auth); } };

onAuthStateChanged(auth, async u => {
  stops.splice(0).forEach(s => s());
  user = u;
  if (!u) { role = ''; $('app').hidden = true; $('login').hidden = false; return; }
  if (u.isAnonymous) {
    try {
      const sRef = doc(col('sessions'), u.uid);
      const have = await getDoc(sRef).catch(() => null);
      if (!have || !have.exists()) {
        if (!pendingKey) throw Error('Dobara PIN se login karein');
        await setDoc(sRef, { key: pendingKey, createdAt: Date.now() });
      }
      pendingKey = '';
      role = 'staff';
    } catch (err) {
      pendingKey = '';
      $('loginMsg').textContent = /permission/i.test(err.message) ? 'PIN ghalat hai (ya malik ne band kar diya)' : err.message;
      await signOut(auth); return;
    }
  } else if (OWNER_EMAILS.includes((u.email || '').toLowerCase())) role = 'owner';
  else { $('loginMsg').textContent = 'Yeh email malik ki list mein nahi'; await signOut(auth); return; }
  $('login').hidden = true; $('app').hidden = false;
  $('who').textContent = role === 'owner' ? 'Malik · ' + u.email : 'Mulazim';
  document.querySelectorAll('.nav .owner').forEach(b => b.hidden = !isOwner());
  listen();
  route('sale');
});

function listen() {
  stops.push(onSnapshot(col('items'), s => { items = s.docs.map(d => ({ ...d.data(), id: d.id })); render(); }, e => $('status').textContent = 'Items: ' + e.message));
  stops.push(onSnapshot(col('categories'), s => { cats = s.docs.map(d => ({ ...d.data(), id: d.id })).sort((a, b) => a.name.localeCompare(b.name)); render(); }));
  stops.push(onSnapshot(query(col('sales'), where('date', '==', today())), s => { sales = s.docs.map(d => ({ ...d.data(), id: d.id })).sort((a, b) => b.at - a.at); if (view === 'history') render(); }));
  stops.push(onSnapshot(doc(col('config'), 'shop'), d => { if (d.exists()) cfg = { ...cfg, ...d.data() }; paintBrand(); $('status').textContent = ''; }));
}

// ---------- routing ----------
document.querySelector('.nav').onclick = e => { const b = e.target.closest('[data-view]'); if (b) route(b.dataset.view); };
function route(v) {
  if (!isOwner() && ['items', 'cats', 'settings'].includes(v)) v = 'sale';
  view = v;
  document.querySelectorAll('.nav [data-view]').forEach(b => b.classList.toggle('selected', b.dataset.view === v));
  $('title').textContent = { sale: 'Sale', history: 'Aaj ki Sales', items: 'Items', cats: 'Categories', settings: 'Settings' }[v];
  render();
}
function render() {
  const m = $('main');
  if (view === 'sale') renderSale(m);
  else if (view === 'history') renderHistory(m);
  else if (view === 'items') renderItems(m);
  else if (view === 'cats') renderCats(m);
  else if (view === 'settings') renderSettings(m);
}

// ---------- variants ----------
const vkey = (size, color) => `${size || '-'}|${color || '-'}`;
const vLabel = v => [v.size, v.color].filter(x => x && x !== '-').join(' · ');
function allVariants() {
  const out = [];
  for (const it of items) {
    if (it.active === false) continue;
    const vs = Array.isArray(it.variants) && it.variants.length ? it.variants : [{ key: '-|-', size: '', color: '', stock: Number(it.stock) || 0, barcode: it.barcode || '' }];
    for (const v of vs) out.push({ item: it, v, name: it.name, code: it.code || '', label: vLabel(v), rate: Number(v.rate ?? it.rate) || 0, stock: Number(v.stock) || 0, barcode: v.barcode || '' });
  }
  return out;
}
function findHits(q) {
  q = norm(q); if (!q) return [];
  const all = allVariants();
  const exact = all.filter(x => x.barcode && norm(x.barcode) === q);
  if (exact.length) return exact;
  const words = q.split(' ');
  return all.filter(x => { const hay = norm(`${x.name} ${x.code} ${x.label} ${x.item.category || ''}`); return words.every(w => hay.includes(w)); }).slice(0, 40);
}

// ---------- SALE ----------
const lineTotal = l => r2(l.qty * l.rate - (Number(l.disc) || 0));
const cartTotal = () => r2(cart.reduce((n, l) => n + lineTotal(l), 0) - (Number(discAll) || 0));
function renderSale(m) {
  const total = cartTotal(), pay = paid == null ? total : paid, change = r2(pay - total);
  m.innerHTML = `
  <div class="box search">
    <input id="q" placeholder="Item ka naam / code / barcode likhein (scanner bhi chalega)" autocomplete="off">
    <div id="hits" class="results" hidden></div>
  </div>
  <div id="cart">${cart.length ? cart.map((l, i) => `<div class="line">
      <div class="nm"><b>${esc(l.name)}</b><small>${esc(l.label || '')}${l.code ? ' · ' + esc(l.code) : ''} · stock ${num(l.stock)}</small></div>
      <button class="danger x" data-del="${i}">✕</button>
      <div class="inputs">
        <label>Qty<input type="number" min="0" step="1" inputmode="numeric" data-qty="${i}" value="${l.qty}"></label>
        <label>Rate<input type="number" min="0" step="any" inputmode="decimal" data-rate="${i}" value="${l.rate}"${isOwner() ? '' : ' readonly'}></label>
        <label>Disc Rs<input type="number" min="0" step="any" inputmode="decimal" data-disc="${i}" value="${l.disc || ''}"></label>
        <div class="amt"><small>${num(l.qty)} × ${num(l.rate)}</small><br><b id="amt${i}">${num(lineTotal(l))}</b></div>
      </div></div>`).join('') : '<div class="empty">Upar item likh kar ya scan karke bill shuru karein</div>'}</div>
  ${cart.length ? `<div class="box totals">
    <label>Customer naam (ikhtiyari)<input id="cust" value="${esc(custName)}"></label>
    <label>Bill discount Rs<input id="discAll" type="number" min="0" step="any" inputmode="decimal" value="${discAll || ''}"></label>
    <div class="big"><span>${cart.reduce((n, l) => n + l.qty, 0)} pcs · ${cart.length} items</span><strong id="tot">Rs ${num(total)}</strong></div>
    <label>Paid (cash mila)<input id="paid" type="number" min="0" step="any" inputmode="decimal" value="${pay}"></label>
    <label>Change (wapas)<input id="chg" readonly value="${num(change)}"></label>
  </div>
  <div class="actions"><button class="danger" id="clear">✕ Naya bill</button><button class="green" id="save">💾 Save + Print · Rs ${num(total)}</button></div>` : ''}`;
  const q = $('q');
  q.focus();
  q.oninput = () => showHits(q.value);
  q.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); const h = findHits(q.value); if (h.length === 1 || (h.length && h[0].barcode && norm(h[0].barcode) === norm(q.value))) { addLine(h[0]); q.value = ''; $('hits').hidden = true; } else if (!h.length) toast('Item nahi mila'); }
    if (e.key === 'Escape') { $('hits').hidden = true; }
  };
  m.oninput = e => {
    const t = e.target, i = t.dataset.qty ?? t.dataset.rate ?? t.dataset.disc;
    if (i != null) {
      const l = cart[i];
      if (t.dataset.qty != null) l.qty = Math.max(0, Number(t.value) || 0);
      if (t.dataset.rate != null) l.rate = Math.max(0, Number(t.value) || 0);
      if (t.dataset.disc != null) l.disc = Math.max(0, Number(t.value) || 0);
      $('amt' + i).textContent = num(lineTotal(l)); refreshTotals();
    } else if (t.id === 'discAll') { discAll = Math.max(0, Number(t.value) || 0); refreshTotals(); }
    else if (t.id === 'paid') { paid = t.value === '' ? null : Math.max(0, Number(t.value) || 0); refreshTotals(); }
    else if (t.id === 'cust') custName = t.value;
  };
  m.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.del != null) { cart.splice(Number(b.dataset.del), 1); if (!cart.length) { paid = null; discAll = 0; } render(); }
    else if (b.id === 'clear') { if (confirm('Bill saaf karein?')) { cart = []; paid = null; discAll = 0; custName = ''; render(); } }
    else if (b.id === 'save') saveSale(b);
    else if (b.dataset.hit != null) { const h = findHits(q.value)[Number(b.dataset.hit)]; if (h) { addLine(h); q.value = ''; $('hits').hidden = true; } }
  };
}
function refreshTotals() {
  const total = cartTotal(), pay = paid == null ? total : paid;
  if ($('tot')) $('tot').textContent = 'Rs ' + num(total);
  if ($('paid') && paid == null) $('paid').value = total;
  if ($('chg')) $('chg').value = num(pay - total);
  if ($('save')) $('save').textContent = '💾 Save + Print · Rs ' + num(total);
}
function showHits(v) {
  const box = $('hits'); const h = findHits(v);
  if (!v.trim()) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = h.length ? h.map((x, i) => `<button class="hit${x.stock <= 0 ? ' zero' : ''}" data-hit="${i}">
    <span><b>${esc(x.name)}</b><small>${esc(x.label || '')}${x.code ? ' · ' + esc(x.code) : ''}${x.item.category ? ' · ' + esc(x.item.category) : ''}</small></span>
    <span class="rate"><b>Rs ${num(x.rate)}</b><br><small>stock ${num(x.stock)}</small></span></button>`).join('') : '<div class="empty">Koi item nahi mila</div>';
}
function addLine(h) {
  const old = cart.find(l => l.itemId === h.item.id && l.key === h.v.key);
  if (old) old.qty += 1;
  else cart.push({ itemId: h.item.id, key: h.v.key || '-|-', name: h.name, code: h.code, label: h.label, size: h.v.size || '', color: h.v.color || '', qty: 1, rate: h.rate, disc: 0, stock: h.stock });
  paid = null;
  render();
  toast('✓ ' + h.name + (h.label ? ' · ' + h.label : ''));
}
// USB / Bluetooth scanner: tez typing + Enter
let scanBuf = '', scanAt = 0;
document.addEventListener('keydown', e => {
  if (view !== 'sale' || $('dialog').open || e.ctrlKey || e.altKey || e.metaKey) return;
  const inField = e.target.matches?.('input,textarea,select');
  const now = Date.now();
  if (e.key === 'Enter') {
    if (scanBuf.length >= 4 && now - scanAt < 120 && !inField) { const h = findHits(scanBuf); if (h.length) addLine(h[0]); else toast(`"${scanBuf}" nahi mila`); e.preventDefault(); }
    scanBuf = ''; return;
  }
  if (e.key.length === 1) { if (now - scanAt > 120) scanBuf = ''; scanBuf += e.key; scanAt = now; }
});

async function saveSale(btn) {
  const lines = cart.filter(l => l.qty > 0);
  if (!lines.length) { toast('Qty likhein'); return; }
  const total = cartTotal(), pay = paid == null ? total : paid;
  if (pay < total && !confirm(`Paid (${num(pay)}) bill (${num(total)}) se kam hai. Phir bhi save karein?`)) return;
  btn.disabled = true;
  try {
    const no = await runTransaction(db, async tx => {
      const cRef = doc(col('config'), 'counter');
      const c = await tx.get(cRef);
      const next = (c.exists() ? Number(c.data().sale) || 0 : 0) + 1;
      // stock kam karo (har item doc ek dafa)
      const byItem = new Map();
      lines.forEach(l => { if (!byItem.has(l.itemId)) byItem.set(l.itemId, []); byItem.get(l.itemId).push(l); });
      const updates = [];
      for (const [itemId, ls] of byItem) {
        const ref = doc(col('items'), itemId);
        const snap = await tx.get(ref);
        if (!snap.exists()) continue;
        const it = snap.data();
        if (Array.isArray(it.variants) && it.variants.length) {
          const vs = it.variants.map(v => ({ ...v }));
          for (const l of ls) { const v = vs.find(x => x.key === l.key); if (v) v.stock = r2((Number(v.stock) || 0) - l.qty); }
          updates.push([ref, { variants: vs, updatedAt: Date.now() }]);
        } else {
          updates.push([ref, { stock: r2((Number(it.stock) || 0) - ls.reduce((n, l) => n + l.qty, 0)), updatedAt: Date.now() }]);
        }
      }
      updates.forEach(([ref, d]) => tx.set(ref, d, { merge: true }));
      tx.set(cRef, { sale: next }, { merge: true });
      const id = uid();
      tx.set(doc(col('sales'), id), {
        id, no: next, date: today(), at: Date.now(), customer: custName.trim(),
        lines: lines.map(l => ({ itemId: l.itemId, key: l.key, name: l.name, code: l.code, size: l.size, color: l.color, qty: l.qty, rate: l.rate, disc: Number(l.disc) || 0 })),
        sub: r2(lines.reduce((n, l) => n + lineTotal(l), 0)), disc: Number(discAll) || 0, total, paid: pay, change: r2(pay - total),
        by: user.uid, role
      });
      return next;
    });
    const saved = { no, date: today(), at: Date.now(), customer: custName.trim(), lines, disc: discAll, total, paid: pay, change: r2(pay - total) };
    cart = []; paid = null; discAll = 0; custName = '';
    render();
    toast(`Sale #${saved.no} save ho gayi`);
    printReceipt(saved, true);
  } catch (e) { toast('Save nahi hui: ' + (e.message || e)); }
  finally { btn.disabled = false; }
}

// ---------- logo ----------
// bw=true: rasid (thermal printer sirf kala chhapta hai). size px.
function logoMark(size = 40, bw = false) {
  const gold = bw ? '#000' : '#d9b65c', bg = bw ? '#fff' : '#7b1e3a', txt = bw ? '#000' : '#f4dc9a', sub = bw ? '#000' : '#f6e7c9';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}" style="display:block;flex:none">
  <rect width="512" height="512" rx="104" fill="${bg}"${bw ? ' stroke="#000" stroke-width="10"' : ''}/>
  <rect x="30" y="30" width="452" height="452" rx="84" fill="none" stroke="${gold}" stroke-width="6"/>
  <text x="256" y="300" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="232" font-weight="700" fill="${txt}" letter-spacing="-10">MG</text>
  <line x1="120" y1="352" x2="216" y2="352" stroke="${gold}" stroke-width="3"/><line x1="296" y1="352" x2="392" y2="352" stroke="${gold}" stroke-width="3"/><path d="M256 344l8 8-8 8-8-8z" fill="${gold}"/>
  <text x="256" y="404" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="27" fill="${sub}" letter-spacing="6">MOHSIN GARMENTS</text></svg>`;
}
function brandLockup(size = 36) {
  return `<span class="brand">${logoMark(size)}<span class="brand-t"><b>${esc(cfg.shopName || 'Mohsin Garments')}</b><small>${esc(cfg.tagline || '')}</small></span></span>`;
}
function paintBrand() { const h = $('brandHead'); if (h) h.innerHTML = brandLockup(34); const l = $('brandLogin'); if (l) l.innerHTML = logoMark(96); }

// ---------- receipt ----------
// Share / WhatsApp ke liye sada text
function receiptText(s) {
  const W = 32, line = (l, r) => { l = String(l); r = String(r); return (l + ' '.repeat(Math.max(1, W - l.length - r.length))).slice(0, W - r.length) + r; };
  const center = t => { t = String(t).slice(0, W); return ' '.repeat(Math.floor((W - t.length) / 2)) + t; };
  const hr = '-'.repeat(W);
  const out = [center(cfg.shopName || 'Mohsin Garments')];
  if (cfg.address) out.push(center(cfg.address));
  if (cfg.phone || cfg.phone2) out.push(center([cfg.phone, cfg.phone2].filter(Boolean).join(' | ')));
  out.push(hr, line('Bill #' + (s.no || ''), new Date(s.at || Date.now()).toLocaleString('en-GB', { hour12: true })));
  if (s.customer) out.push('Customer: ' + s.customer);
  out.push(hr);
  for (const l of s.lines) {
    out.push((l.name + (l.size || l.color ? ' ' + [l.size, l.color].filter(Boolean).join('/') : '')).slice(0, W));
    out.push(line(`  ${num(l.qty)} x ${num(l.rate)}${l.disc ? ' -' + num(l.disc) : ''}`, num(l.qty * l.rate - (l.disc || 0))));
  }
  out.push(hr);
  if (s.disc) out.push(line('Discount:', '-' + num(s.disc)));
  out.push(line('TOTAL:', 'Rs ' + num(s.total)), line('Paid:', num(s.paid)), line('Change:', num(s.change)), hr);
  if (cfg.notes) out.push(...String(cfg.notes).split('\n').map(x => x.trim()).filter(Boolean));
  out.push(center(cfg.footer || ''), '', '');
  return out.join('\n');
}
// Printer ke liye HTML rasid (logo + table)
function receiptHtml(s) {
  const pcs = s.lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const sub = s.lines.reduce((a, l) => a + l.qty * l.rate - (l.disc || 0), 0);
  const dt = new Date(s.at || Date.now());
  return `<div class="rc">
    ${cfg.showLogo !== false ? `<div class="rc-logo">${logoMark(150, true)}</div>` : ''}
    <div class="rc-name">${esc(cfg.shopName || 'Mohsin Garments')}</div>
    ${cfg.tagline ? `<div class="rc-tag">${esc(cfg.tagline)}</div>` : ''}
    ${cfg.address ? `<div class="rc-c">${esc(cfg.address)}</div>` : ''}
    ${cfg.phone || cfg.phone2 ? `<div class="rc-c">${esc([cfg.phone, cfg.phone2].filter(Boolean).join('  |  '))}</div>` : ''}
    <div class="rc-hr"></div>
    <div class="rc-meta"><span><b>Bill #${esc(s.no)}</b></span><span>${dt.toLocaleDateString('en-GB')} ${dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })}</span></div>
    ${s.customer ? `<div class="rc-meta"><span>Customer: <b>${esc(s.customer)}</b></span></div>` : ''}
    <table class="rc-t"><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>
    ${s.lines.map(l => `<tr><td>${esc(l.name)}${l.size || l.color ? `<br><small>${esc([l.size, l.color].filter(Boolean).join(' / '))}</small>` : ''}${l.disc ? `<br><small>Disc -${num(l.disc)}</small>` : ''}</td><td class="n">${num(l.qty)}</td><td class="n">${num(l.rate)}</td><td class="n">${num(l.qty * l.rate - (l.disc || 0))}</td></tr>`).join('')}
    </tbody></table>
    <div class="rc-hr"></div>
    <div class="rc-row"><span>Pieces: ${num(pcs)}</span><span>Subtotal: ${num(sub)}</span></div>
    ${s.disc ? `<div class="rc-row"><span>Discount</span><span>-${num(s.disc)}</span></div>` : ''}
    <div class="rc-row rc-total"><span>TOTAL</span><span>Rs ${num(s.total)}</span></div>
    <div class="rc-row"><span>Paid</span><span>${num(s.paid)}</span></div>
    <div class="rc-row"><span>Change</span><span>${num(s.change)}</span></div>
    <div class="rc-hr"></div>
    ${cfg.notes ? `<div class="rc-notes">${esc(cfg.notes).replace(/\n/g, '<br>')}</div>` : ''}
    ${cfg.footer ? `<div class="rc-foot">${esc(cfg.footer)}</div>` : ''}
    <div class="rc-tiny">Mohsin Garments POS</div>
  </div>`;
}
function doPrint(s) {
  const w = cfg.paper === '58' ? 58 : 80;
  let st = $('paperCss'); if (!st) { st = document.createElement('style'); st.id = 'paperCss'; document.head.appendChild(st); }
  st.textContent = `@media print{@page{size:${w}mm auto;margin:0}#printArea{width:${w - 8}mm}}`;
  $('printArea').innerHTML = receiptHtml(s);
  window.print();
}
// auto=true: sale save hote hi seedha printer par bhejo (popup ke saath)
function printReceipt(s, auto = false) {
  modal('Bill #' + s.no, `<div class="rc-preview">${receiptHtml(s)}</div>
    <div class="row"><button class="primary" id="pPrint">🖨 Print</button><button id="pShare">📤 Share / PDF</button></div>`);
  $('pPrint').onclick = () => doPrint(s);
  $('pShare').onclick = async () => {
    const text = receiptText(s);
    if (navigator.share) { try { await navigator.share({ title: 'Bill #' + s.no, text }); } catch {} }
    else doPrint(s);
  };
  if (auto) setTimeout(() => doPrint(s), 150);
}

// ---------- HISTORY ----------
function renderHistory(m) {
  const tot = sales.reduce((n, s) => n + (Number(s.total) || 0), 0), pcs = sales.reduce((n, s) => n + s.lines.reduce((a, l) => a + l.qty, 0), 0);
  m.innerHTML = `<div class="stat"><div><small>Aaj ke bill</small><strong>${sales.length}</strong></div><div><small>Pieces</small><strong>${num(pcs)}</strong></div><div><small>Kul sale</small><strong>Rs ${num(tot)}</strong></div></div>
  <div class="box list">${sales.length ? sales.map(s => `<div class="it"><span><b>#${s.no}</b> · ${new Date(s.at).toLocaleTimeString('en-PK')}${s.customer ? ' · ' + esc(s.customer) : ''}<small>${s.lines.map(l => `${esc(l.name)}${l.size || l.color ? ' ' + esc([l.size, l.color].filter(Boolean).join('/')) : ''} ×${num(l.qty)}`).join(', ')}</small></span>
    <span style="text-align:right"><b>Rs ${num(s.total)}</b><br><button class="x" data-rp="${s.id}">🖨</button>${isOwner() ? ` <button class="x danger" data-void="${s.id}">Wapas</button>` : ''}</span></div>`).join('') : '<div class="empty">Aaj koi sale nahi</div>'}</div>`;
  m.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rp) { const s = sales.find(x => x.id === b.dataset.rp); if (s) printReceipt(s); }
    if (b.dataset.void) voidSale(b.dataset.void);
  };
}
async function voidSale(id) {
  const s = sales.find(x => x.id === id); if (!s) return;
  if (!confirm(`Bill #${s.no} (Rs ${num(s.total)}) wapas karein? Stock wapas jud jayega aur bill delete ho jayega.`)) return;
  try {
    await runTransaction(db, async tx => {
      const byItem = new Map();
      s.lines.forEach(l => { if (!byItem.has(l.itemId)) byItem.set(l.itemId, []); byItem.get(l.itemId).push(l); });
      const ups = [];
      for (const [itemId, ls] of byItem) {
        const ref = doc(col('items'), itemId); const snap = await tx.get(ref); if (!snap.exists()) continue; const it = snap.data();
        if (Array.isArray(it.variants) && it.variants.length) { const vs = it.variants.map(v => ({ ...v })); for (const l of ls) { const v = vs.find(x => x.key === l.key); if (v) v.stock = r2((Number(v.stock) || 0) + l.qty); } ups.push([ref, { variants: vs }]); }
        else ups.push([ref, { stock: r2((Number(it.stock) || 0) + ls.reduce((n, l) => n + l.qty, 0)) }]);
      }
      ups.forEach(([ref, d]) => tx.set(ref, d, { merge: true }));
      tx.delete(doc(col('sales'), id));
    });
    toast('Bill wapas ho gaya');
  } catch (e) { toast('Nahi hua: ' + e.message); }
}

// ---------- ITEMS ----------
let itemQ = '';
function renderItems(m) {
  const q = norm(itemQ);
  const list = items.filter(it => !q || norm(`${it.name} ${it.code} ${it.category}`).includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  m.innerHTML = `<div class="row" style="margin-bottom:8px"><input id="iq" class="grow" placeholder="Item dhoondein" value="${esc(itemQ)}"><button class="primary" id="add">+ Naya item</button></div>
  <div class="box list">${list.length ? list.map(it => { const vs = it.variants || []; const st = vs.length ? vs.reduce((n, v) => n + (Number(v.stock) || 0), 0) : Number(it.stock) || 0;
    return `<div class="it${it.active === false ? ' zero' : ''}" style="${it.active === false ? 'opacity:.5' : ''}"><span><b>${esc(it.name)}</b>${it.active === false ? ' <span class="chip">band</span>' : ''}<small>${esc(it.code || '')}${it.category ? ' · ' + esc(it.category) : ''} · Rs ${num(it.rate)}${it.prate ? ' · khareed ' + num(it.prate) : ''}</small>
      <small>${vs.length ? vs.map(v => `<span class="chip">${esc(vLabel(v) || '-')}: ${num(v.stock)}</span>`).join('') : 'stock ' + num(st)}</small></span>
      <span><b>${num(st)}</b><br><button class="x" data-edit="${it.id}">Edit</button></span></div>`; }).join('') : '<div class="empty">Koi item nahi</div>'}</div>`;
  $('iq').oninput = e => { itemQ = e.target.value; renderItems(m); $('iq').focus(); $('iq').setSelectionRange(itemQ.length, itemQ.length); };
  m.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.id === 'add') itemForm(null); if (b.dataset.edit) itemForm(items.find(x => x.id === b.dataset.edit)); };
}
function itemForm(it) {
  const sizes = it ? [...new Set((it.variants || []).map(v => v.size).filter(Boolean))].join(', ') : '';
  const colors = it ? [...new Set((it.variants || []).map(v => v.color).filter(Boolean))].join(', ') : '';
  modal(it ? 'Item edit' : 'Naya item', `<form id="itf">
    <label>Naam*<input name="name" required value="${esc(it?.name || '')}"></label>
    <div class="row"><label class="grow">Code<input name="code" value="${esc(it?.code || '')}"></label>
    <label class="grow">Category<select name="category"><option value="">—</option>${cats.map(c => `<option${it?.category === c.name ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label></div>
    <div class="row"><label class="grow">Sale rate*<input name="rate" type="number" step="any" required value="${it?.rate ?? ''}"></label>
    <label class="grow">Khareed rate<input name="prate" type="number" step="any" value="${it?.prate ?? ''}"></label></div>
    <label>Sizes (comma se, jaise: S, M, L, XL ya 32, 34)<input name="sizes" value="${esc(sizes)}"></label>
    <label>Colors (comma se, jaise: Black, Blue, White)<input name="colors" value="${esc(colors)}"></label>
    <p class="muted" style="font-size:13px">Sizes/colors likh kar <b>"Variants banao"</b> dabayein — har size×color ki line banegi. Kuch na likhein to ek hi stock hoga.</p>
    <button type="button" id="mkv">Variants banao</button>
    <div id="vbox" style="margin-top:8px"></div>
    ${it ? `<label><input type="checkbox" name="active" style="width:auto" ${it.active === false ? '' : 'checked'}> Item chalu hai</label>` : ''}
    <button type="submit" style="margin-top:10px;width:100%">Save item</button>
  </form>`);
  const f = $('itf');
  let vs = it?.variants ? it.variants.map(v => ({ ...v })) : [];
  const vboxDraw = () => {
    $('vbox').innerHTML = vs.length ? `<div class="vgrid"><b>Size</b><b>Color</b><b>Stock</b><b>Barcode / Rate</b>${vs.map((v, i) => `<span>${esc(v.size || '-')}</span><span>${esc(v.color || '-')}</span>
      <input type="number" step="any" data-vs="${i}" value="${v.stock ?? 0}"><span><input data-vb="${i}" placeholder="barcode" value="${esc(v.barcode || '')}"><input type="number" step="any" data-vr="${i}" placeholder="rate (khali = item)" value="${v.rate ?? ''}"></span>`).join('')}</div>`
      : `<label>Stock (single)<input name="stock" type="number" step="any" value="${it?.stock ?? 0}"></label><label>Barcode<input name="barcode" value="${esc(it?.barcode || '')}"></label>`;
  };
  vboxDraw();
  $('mkv').onclick = () => {
    const S = f.elements.sizes.value.split(',').map(s => s.trim()).filter(Boolean), C = f.elements.colors.value.split(',').map(s => s.trim()).filter(Boolean);
    if (!S.length && !C.length) { vs = []; vboxDraw(); return; }
    const nv = [];
    for (const s of (S.length ? S : [''])) for (const c of (C.length ? C : [''])) { const key = vkey(s, c); const old = vs.find(v => v.key === key); nv.push(old || { key, size: s, color: c, stock: 0, barcode: '' }); }
    vs = nv; vboxDraw();
  };
  f.oninput = e => { const t = e.target; if (t.dataset.vs != null) vs[t.dataset.vs].stock = Number(t.value) || 0; if (t.dataset.vb != null) vs[t.dataset.vb].barcode = t.value.trim(); if (t.dataset.vr != null) vs[t.dataset.vr].rate = t.value === '' ? null : Number(t.value); };
  f.onsubmit = async e => {
    e.preventDefault();
    const d = {
      id: it?.id || uid(), name: f.elements.name.value.trim(), code: f.elements.code.value.trim(), category: f.elements.category.value,
      rate: Number(f.elements.rate.value) || 0, prate: Number(f.elements.prate.value) || 0,
      active: it ? !!f.elements.active?.checked : true, updatedAt: Date.now(), createdAt: it?.createdAt || Date.now()
    };
    if (vs.length) { d.variants = vs.map(v => ({ key: v.key, size: v.size || '', color: v.color || '', stock: Number(v.stock) || 0, barcode: v.barcode || '', ...(v.rate != null && v.rate !== '' ? { rate: Number(v.rate) } : {}) })); d.stock = null; d.barcode = ''; }
    else { d.variants = []; d.stock = Number(f.elements.stock?.value) || 0; d.barcode = (f.elements.barcode?.value || '').trim(); }
    if (!d.name) return toast('Naam likhein');
    try { await setDoc(doc(col('items'), d.id), d); $('dialog').close(); toast('Item save ho gaya'); } catch (err) { toast('Nahi hua: ' + err.message); }
  };
}

// ---------- CATEGORIES ----------
function renderCats(m) {
  m.innerHTML = `<form id="cf" class="row" style="margin-bottom:8px"><input name="name" class="grow" placeholder="Nayi category (jaise Shirt, Pant, Kids)" required><button type="submit">+ Add</button></form>
  <div class="box list">${cats.length ? cats.map(c => `<div class="it"><span><b>${esc(c.name)}</b><small>${items.filter(i => i.category === c.name).length} items</small></span><button class="x danger" data-dc="${c.id}">Delete</button></div>`).join('') : '<div class="empty">Koi category nahi</div>'}</div>`;
  $('cf').onsubmit = async e => { e.preventDefault(); const name = e.target.elements.name.value.trim(); if (!name) return; if (cats.some(c => norm(c.name) === norm(name))) return toast('Pehle se hai'); await setDoc(doc(col('categories'), uid()), { name, createdAt: Date.now() }); e.target.reset(); };
  m.onclick = async e => { const b = e.target.closest('[data-dc]'); if (!b) return; const c = cats.find(x => x.id === b.dataset.dc); if (c && confirm(`"${c.name}" delete karein? Items rahenge, sirf category hategi.`)) await deleteDoc(doc(col('categories'), c.id)); };
}

// ---------- SETTINGS ----------
function renderSettings(m) {
  const chk = cfg.showLogo !== false ? ' checked' : '';
  m.innerHTML = `<form id="sf" class="box"><b>Dukaan ki details (rasid par chhapti hain)</b>
    <label>Dukaan ka naam<input name="shopName" value="${esc(cfg.shopName || '')}"></label>
    <label>Tagline (naam ke neeche, chhoti line)<input name="tagline" value="${esc(cfg.tagline || '')}" placeholder="e.g. Premium Menswear & Fabrics"></label>
    <label>Address<input name="address" value="${esc(cfg.address || '')}"></label>
    <div class="row"><label class="grow">Phone 1<input name="phone" value="${esc(cfg.phone || '')}"></label><label class="grow">Phone 2 / WhatsApp<input name="phone2" value="${esc(cfg.phone2 || '')}"></label></div>
    <label>Notes (rasid ke aakhir mein, e.g. wapsi/tabdeeli ki policy)<textarea name="notes" rows="3">${esc(cfg.notes || '')}</textarea></label>
    <label>Rasid ke neeche ki line<input name="footer" value="${esc(cfg.footer || '')}"></label>
    <div class="row"><label class="grow" style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="showLogo" style="width:auto"${chk}> Logo rasid par chhapo</label>
    <label class="grow">Printer paper<select name="paper"><option value="80"${cfg.paper !== '58' ? ' selected' : ''}>80mm (TH230)</option><option value="58"${cfg.paper === '58' ? ' selected' : ''}>58mm</option></select></label></div>
    <div class="row"><button type="submit">Save</button><button type="button" id="testPrint">🖨 Test print</button></div></form>
  <div class="box muted" style="font-size:13px"><b>TH230 printer (PC/Chrome):</b> Windows mein printer ka driver install ho aur print dialog mein Destination = TH230, Margins = None, Scale = 100%, "Headers and footers" off. Ek dafa set karne ke baad Chrome yaad rakhta hai.</div>
  <form id="pf" class="box"><label>Mulazim ka PIN (4-6 hindse)<input name="pin" inputmode="numeric" minlength="4" maxlength="6" placeholder="naya PIN"></label><button type="submit">PIN save</button>
  <p class="muted" style="font-size:13px">Mulazim is PIN se login karke sirf Sale aur aaj ki Sales dekh sakta hai. Items, category aur settings sirf malik.</p></form>
  <div class="box"><b>Backup</b><p class="muted" style="font-size:13px">Saare items aur aaj ki sales ki JSON file.</p><button id="bk">⬇ Backup download</button></div>`;
  const readForm = f => ({ shopName: f.elements.shopName.value.trim(), tagline: f.elements.tagline.value.trim(), address: f.elements.address.value.trim(), phone: f.elements.phone.value.trim(), phone2: f.elements.phone2.value.trim(), notes: f.elements.notes.value.trim(), footer: f.elements.footer.value.trim(), showLogo: f.elements.showLogo.checked, paper: f.elements.paper.value });
  $('sf').onsubmit = async e => { e.preventDefault(); const d = readForm(e.target); await setDoc(doc(col('config'), 'shop'), d, { merge: true }); cfg = { ...cfg, ...d }; paintBrand(); toast('Save ho gaya'); };
  $('testPrint').onclick = () => { cfg = { ...cfg, ...readForm($('sf')) }; printReceipt({ no: 'TEST', at: Date.now(), customer: 'Test', lines: [{ name: 'Kurta (sample)', size: 'L', color: 'White', qty: 1, rate: 2500, disc: 0 }, { name: 'Shalwar', qty: 2, rate: 900, disc: 100 }], disc: 0, total: 4200, paid: 5000, change: 800 }); };
  $('pf').onsubmit = async e => { e.preventDefault(); const pin = e.target.elements.pin.value.trim(); if (!/^\d{4,6}$/.test(pin)) return toast('4-6 hindse ka PIN likhein');
    const k = await pinKey(pin);
    // purani keys band, nayi chalu (mulazim ke purane login bhi band ho jate hain)
    const old = await getDoc(doc(col('config'), 'staffKey')).catch(() => null);
    const prev = old?.exists() ? old.data().key : '';
    if (prev && prev !== k) await setDoc(doc(col('keys'), prev), { active: false, endedAt: Date.now() }, { merge: true });
    await setDoc(doc(col('keys'), k), { active: true, createdAt: Date.now() });
    await setDoc(doc(col('config'), 'staffKey'), { key: k, updatedAt: Date.now() });
    e.target.reset(); toast('PIN save ho gaya'); };
  $('bk').onclick = () => { const blob = new Blob([JSON.stringify({ at: new Date().toISOString(), items, categories: cats, salesToday: sales, cfg }, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `mohsin-garments-${today()}.json`; a.click(); };
}


// ---------- Version + auto update ----------
const APP_VERSION = '1.2.0';
let newVersion = '', swWaiting = null, snoozeUntil = 0;
paintBrand();
const setVerText = () => { const v = $('verNow'); if (v) v.textContent = 'Mohsin Garments POS v' + APP_VERSION; };
setVerText();

function showUpdateBar(ver) {
  if (Date.now() < snoozeUntil) return;
  const bar = $('updateBar'); if (!bar) return;
  $('updateMsg').textContent = ver ? `Naya version ${ver} aa gaya hai` : 'Naya version tayyar hai';
  bar.hidden = false;
}
$('updateLater').onclick = () => { $('updateBar').hidden = true; snoozeUntil = Date.now() + 30 * 60000; };
$('updateNow').onclick = async () => {
  if (cart.length && !confirm('Bill abhi khula hai. Update karne par bill saaf ho jayega. Aage barhein?')) return;
  try { const regs = await navigator.serviceWorker?.getRegistrations?.() || []; for (const r of regs) { r.waiting?.postMessage('skip-waiting'); await r.update(); } } catch {}
  location.reload(true);
};
$('checkUpdate').onclick = async () => { toast('Dekh rahe hain…'); const v = await checkVersion(true); if (!v) toast('App pehle se nayi hai (v' + APP_VERSION + ')'); };

async function checkVersion(loud) {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return '';
    const d = await r.json();
    const v = String(d.version || '');
    if (v && v !== APP_VERSION) { newVersion = v; if (loud) snoozeUntil = 0; showUpdateBar(v); return v; }
    return '';
  } catch { return ''; }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { swWaiting = w; showUpdateBar(newVersion); } });
    });
    setInterval(() => reg.update().catch(() => {}), 15 * 60000);
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
checkVersion(false);
setInterval(() => checkVersion(false), 15 * 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(false); });
