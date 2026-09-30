// Illustration de pizza générée à partir de son nom (toujours la même pour un même nom)
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function pizzaSVG(name, recipe = '') {
  const text = (name + ' ' + recipe).toLowerCase();
  const r = rng(hashStr(name));
  const has = (...w) => w.some(x => text.includes(x));
  const white = has('crème', 'creme', 'blanche', 'bianca');
  const base = white ? '#f6e7c1' : '#d6401f';

  // Garnitures devinées depuis la recette, sinon au hasard
  let tops = [];
  if (has('pepperoni', 'chorizo', 'salami', 'saucisson')) tops.push('pep');
  if (has('champignon', 'funghi')) tops.push('mush');
  if (has('olive')) tops.push('olive');
  if (has('basilic', 'basil', 'roquette', 'pesto')) tops.push('basil');
  if (has('jambon', 'lardon', 'bacon', 'speck')) tops.push('ham');
  if (has('poivron', 'tomate cerise', 'piment')) tops.push('pepper');
  if (has('oignon')) tops.push('onion');
  if (!tops.length) {
    const pool = ['pep', 'mush', 'olive', 'basil', 'ham', 'pepper', 'onion'];
    while (tops.length < 2) { const t = pool[Math.floor(r() * pool.length)]; if (!tops.includes(t)) tops.push(t); }
  }

  const placed = [];
  const spot = (minD) => {
    for (let k = 0; k < 40; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 34;
      const x = 50 + Math.cos(a) * d, y = 50 + Math.sin(a) * d;
      if (placed.every(p => Math.hypot(p[0] - x, p[1] - y) > minD)) { placed.push([x, y]); return [x, y]; }
    }
    return null;
  };

  let cheese = '';
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 32;
    cheese += `<ellipse cx="${50 + Math.cos(a) * d}" cy="${50 + Math.sin(a) * d}" rx="${5 + r() * 6}" ry="${4 + r() * 4}" transform="rotate(${r() * 180} ${50 + Math.cos(a) * d} ${50 + Math.sin(a) * d})" fill="#ffd978" opacity=".85"/>`;
  }

  let g = '';
  const per = Math.max(4, Math.round(12 / tops.length));
  for (const t of tops) {
    for (let i = 0; i < per; i++) {
      const p = spot(t === 'pep' ? 10 : 7); if (!p) continue;
      const [x, y] = p, rot = r() * 360;
      if (t === 'pep') g += `<circle cx="${x}" cy="${y}" r="5.2" fill="#a92a17"/><circle cx="${x - 1.2}" cy="${y - 1.2}" r="1" fill="#7c1c0e"/><circle cx="${x + 1.6}" cy="${y + .8}" r=".8" fill="#7c1c0e"/>`;
      if (t === 'mush') g += `<g transform="rotate(${rot} ${x} ${y})"><path d="M${x - 4} ${y} a4 3.4 0 0 1 8 0 z" fill="#efe0c8" stroke="#b69b78" stroke-width=".6"/><rect x="${x - 1.3}" y="${y}" width="2.6" height="3" rx=".8" fill="#e3cfaf"/></g>`;
      if (t === 'olive') g += `<circle cx="${x}" cy="${y}" r="2.5" fill="none" stroke="#2a2420" stroke-width="1.6"/>`;
      if (t === 'basil') g += `<ellipse cx="${x}" cy="${y}" rx="4.6" ry="2.3" fill="#2f8f4e" transform="rotate(${rot} ${x} ${y})"/><line x1="${x - 3.6}" y1="${y}" x2="${x + 3.6}" y2="${y}" stroke="#236e3b" stroke-width=".5" transform="rotate(${rot} ${x} ${y})"/>`;
      if (t === 'ham') g += `<rect x="${x - 3.5}" y="${y - 2.5}" width="7" height="5" rx="1.4" fill="#f0908a" transform="rotate(${rot} ${x} ${y})"/>`;
      if (t === 'pepper') g += `<path d="M${x - 4} ${y} q4 -4 8 0" fill="none" stroke="${r() > .5 ? '#3aa04a' : '#f2b21b'}" stroke-width="1.8" stroke-linecap="round" transform="rotate(${rot} ${x} ${y})"/>`;
      if (t === 'onion') g += `<path d="M${x - 4} ${y + 1} q4 -6 8 0" fill="none" stroke="#c98bc4" stroke-width="1.1" stroke-linecap="round" transform="rotate(${rot} ${x} ${y})"/>`;
    }
  }

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="50" cy="52" r="48" fill="rgba(0,0,0,.18)"/>
    <circle cx="50" cy="50" r="48" fill="#dc9448"/>
    <circle cx="50" cy="50" r="48" fill="none" stroke="#b86f2c" stroke-width="1.2" stroke-dasharray="2 5"/>
    <circle cx="50" cy="50" r="41" fill="${base}"/>
    ${cheese}${g}
    <path d="M50 50 L50 2 M50 50 L91.6 74 M50 50 L8.4 74" stroke="rgba(120,60,20,.25)" stroke-width=".7"/>
  </svg>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function toast(msg, kind = '') {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

// Appel d'une fonction Supabase (supabase/schema.sql). Les erreurs renvoient
// le message écrit côté serveur, déjà en français.
async function rpc(fn, args = {}) {
  const { supabaseUrl, supabaseKey } = window.PIZZA_CONFIG;
  const headers = { 'Content-Type': 'application/json', apikey: supabaseKey };
  if (supabaseKey.startsWith('eyJ')) headers.Authorization = `Bearer ${supabaseKey}`;
  let res;
  try {
    res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  } catch {
    throw new Error('Connexion impossible, vérifie ton réseau.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.message) || 'Oups, une erreur est survenue.');
  return data;
}
