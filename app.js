const app = document.getElementById('app');
const cartbar = document.getElementById('cartbar');
const overlay = document.getElementById('overlay');
const modal = document.getElementById('modal');

let sale = null;      // vente affichée
let cart = {};        // pizzaId -> quantité
let chosenSlot = null;
let screen = null;    // écran affiché : 'none' | 'paused' | 'open'

document.getElementById('logoMark').innerHTML = pizzaSVG('Daddy Pizz', 'pepperoni basilic');
document.getElementById('loaderPizza').innerHTML = pizzaSVG('loader', 'pepperoni');

const cartTotal = () => Object.values(cart).reduce((a, b) => a + b, 0);
const plural = (n, w) => `${n} ${w}${n > 1 ? (w.endsWith('eau') ? 'x' : 's') : ''}`;

// ---------- Rendu ----------
function renderClosed() {
  app.innerHTML = `
    <section class="wrap oven-off">
      <div>
        <div class="art">${pizzaSVG('Endormie', 'fromage')}</div>
        <h1>Le four<br>est <em>éteint.</em></h1>
        <p>Pas de vente en ce moment. Reste dans le coin, la prochaine fournée arrive vite.</p>
      </div>
    </section>`;
  cartbar.classList.remove('show');
}

function renderPaused() {
  app.innerHTML = `
    <section class="wrap oven-off">
      <div>
        <div class="art paused">${pizzaSVG(sale.items[0]?.name || 'pause', sale.items[0]?.recipe || '')}</div>
        <span class="eyebrow">${esc(sale.title)}</span>
        <h1>Petite<br><em>pause.</em></h1>
        <p>Les commandes sont suspendues quelques instants. Garde la page ouverte : elle se relance toute seule.</p>
      </div>
    </section>`;
  cartbar.classList.remove('show');
}

function renderSale() {
  const left = sale.items.reduce((s, i) => s + i.remaining, 0);
  const slotsLeft = sale.slots.filter(s => s.remaining > 0).length;
  const hero = sale.items[0] ? sale.items[0] : { name: 'Daddy Pizz', recipe: '' };
  const words = ['Pâte maison', 'Four brûlant', 'Tomates gorgées de soleil', 'Mozza qui file', 'Zéro compte, zéro prise de tête', 'Commande en 30 secondes'];

  app.innerHTML = `
    <section class="wrap hero">
      <div>
        <span class="eyebrow">${esc(sale.date ? formatDate(sale.date) : 'Vente ouverte')} · ${esc(sale.startTime)} – ${esc(sale.endTime)}</span>
        <h1>${esc(sale.title)}<em>.</em></h1>
        <p class="hero-sub">Choisis tes pizzas, valide, prends ton créneau. C’est tout. Elles t’attendent toutes chaudes.</p>
        <div class="hero-stats">
          <div><b id="statLeft">${left}</b><span>pizzas restantes</span></div>
          <div><b>${sale.items.length}</b><span>recettes au menu</span></div>
          <div><b id="statSlots">${slotsLeft}</b><span>créneaux libres</span></div>
        </div>
      </div>
      <div class="hero-art">
        <div class="big-pizza">${pizzaSVG(hero.name, hero.recipe)}</div>
        <div class="sticker">Tout<br>chaud<br>🔥</div>
      </div>
    </section>

    <div class="marquee"><div class="marquee-track">${[...words, ...words].map(w => `<span>${w}</span>`).join('')}</div></div>

    <section class="wrap menu" id="menu">
      <div class="section-head">
        <h2>Au menu<br>ce soir</h2>
        <span class="muted">Ajoute autant de pizzas que tu veux.</span>
      </div>
      <div class="grid">
        ${sale.items.map((it, i) => `
          <article class="pizza-card" data-id="${it.pizzaId}" style="animation-delay:${i * 70}ms">
            <span class="stock"></span>
            <div class="art">${pizzaSVG(it.name, it.recipe)}</div>
            <h3>${esc(it.name)}</h3>
            <p>${esc(it.recipe) || '&nbsp;'}</p>
            <div class="stepper">
              <button class="round-btn minus" aria-label="Retirer une ${esc(it.name)}">−</button>
              <span class="qty">0</span>
              <button class="round-btn plus" aria-label="Ajouter une ${esc(it.name)}">+</button>
            </div>
          </article>`).join('')}
      </div>
    </section>
    <footer class="foot">Daddy Pizz'IMT</footer>`;

  app.querySelectorAll('.pizza-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('.plus').onclick = () => change(id, +1);
    card.querySelector('.minus').onclick = () => change(id, -1);
  });
  refresh();
}

// Met à jour stocks / quantités sans reconstruire la page
function refresh() {
  for (const it of sale.items) {
    const card = app.querySelector(`.pizza-card[data-id="${it.pizzaId}"]`);
    if (!card) continue;
    const q = cart[it.pizzaId] || 0;
    const stock = card.querySelector('.stock');
    stock.className = 'stock' + (it.remaining === 0 ? ' out' : it.remaining <= 5 ? ' low' : '');
    stock.textContent = it.remaining === 0 ? 'Épuisée' : it.remaining <= 5 ? `Plus que ${it.remaining} !` : `${it.remaining} dispo`;
    card.querySelector('.qty').textContent = q;
    card.querySelector('.minus').disabled = q === 0;
    card.querySelector('.plus').disabled = q >= it.remaining;
    card.classList.toggle('selected', q > 0);
    card.classList.toggle('soldout', it.remaining === 0 && q === 0);
  }
  const sl = document.getElementById('statLeft');
  if (sl) sl.textContent = sale.items.reduce((s, i) => s + i.remaining, 0);
  const ss = document.getElementById('statSlots');
  if (ss) ss.textContent = sale.slots.filter(s => s.remaining > 0).length;

  const n = cartTotal();
  cartbar.classList.toggle('show', n > 0);
  document.getElementById('cartCount').textContent = plural(n, 'pizza');
  document.getElementById('cartDetail').textContent = sale.items
    .filter(i => cart[i.pizzaId]).map(i => `${cart[i.pizzaId]}× ${i.name}`).join(' · ');
}

function change(id, d) {
  const it = sale.items.find(i => i.pizzaId === id);
  const q = Math.max(0, Math.min(it.remaining, (cart[id] || 0) + d));
  if (q) cart[id] = q; else delete cart[id];
  refresh();
  const el = app.querySelector(`.pizza-card[data-id="${id}"] .qty`);
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}

// ---------- Modale ----------
function openModal() {
  chosenSlot = null;
  renderForm();
  overlay.classList.add('show');
  setTimeout(() => modal.querySelector('input')?.focus(), 250);
}
function closeModal() { overlay.classList.remove('show'); }

function renderForm(values = {}) {
  modal.innerHTML = `
    <div class="modal-head">
      <h2 id="modalTitle">Presque<br>à table.</h2>
      <button class="close" aria-label="Fermer" data-close>✕</button>
    </div>
    <div class="recap">${sale.items.filter(i => cart[i.pizzaId]).map(i => `<span>${cart[i.pizzaId]}× ${esc(i.name)}</span>`).join('')}</div>
    <form id="orderForm" novalidate>
      <div class="row">
        <div class="field"><label for="fn">Prénom</label><input class="input" id="fn" autocomplete="given-name" required value="${esc(values.firstName || '')}"></div>
        <div class="field"><label for="ln">Nom</label><input class="input" id="ln" autocomplete="family-name" required value="${esc(values.lastName || '')}"></div>
      </div>
      <span class="label">Ton créneau de retrait</span>
      <div class="slots">
        ${sale.slots.map(s => `
          <button type="button" class="slot ${chosenSlot === s.index ? 'active' : ''}" data-slot="${s.index}" ${s.remaining === 0 ? 'disabled' : ''}>
            <b>${s.label}</b><small>${s.remaining === 0 ? 'Complet' : plural(s.remaining, 'place')}</small>
          </button>`).join('')}
      </div>
      <div class="error" id="formError"></div>
      <button class="btn block" id="submitBtn" type="submit">Je commande ${plural(cartTotal(), 'pizza')} 🍕</button>
    </form>`;

  modal.querySelectorAll('.slot').forEach(b => b.onclick = () => {
    chosenSlot = Number(b.dataset.slot);
    modal.querySelectorAll('.slot').forEach(x => x.classList.toggle('active', x === b));
  });
  modal.querySelector('#orderForm').onsubmit = submit;
}

async function submit(e) {
  e.preventDefault();
  const firstName = modal.querySelector('#fn').value.trim();
  const lastName = modal.querySelector('#ln').value.trim();
  const err = modal.querySelector('#formError');
  if (!firstName || !lastName) return (err.textContent = 'On a besoin de ton prénom et de ton nom.');
  if (chosenSlot === null) return (err.textContent = 'Choisis un créneau de retrait.');

  const btn = modal.querySelector('#submitBtn');
  btn.disabled = true; btn.textContent = 'Envoi au four…';
  try {
    const data = await rpc('pizza_place_order', {
      p_sale_id: sale.id, p_first_name: firstName, p_last_name: lastName, p_slot: chosenSlot, p_items: cart,
    });
    showSuccess(data, firstName);
    poll();
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false; btn.textContent = `Je commande ${plural(cartTotal(), 'pizza')} 🍕`;
  }
}

function showSuccess(order, firstName) {
  const n = cartTotal();
  modal.innerHTML = `
    <div class="success">
      <div class="art">${pizzaSVG(firstName, 'pepperoni basilic champignon')}</div>
      <h2>C’est au four, ${esc(firstName)} !</h2>
      <p>${plural(n, 'pizza')} réservée${n > 1 ? 's' : ''}. Rendez-vous sur ton créneau :</p>
      <div class="ticket">${esc(order.slotLabel)}</div>
      <div style="margin-top:30px"><button class="btn dark" data-close>Parfait 👌</button></div>
    </div>`;
  cart = {};
  refresh();
  confetti();
}

function confetti() {
  const colors = ['#ff4a1c', '#ffc93c', '#1f8a4c', '#1c110b', '#fff'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.borderRadius = Math.random() > .5 ? '50%' : '3px';
    c.style.animationDuration = 1.8 + Math.random() * 1.8 + 's';
    c.style.animationDelay = Math.random() * .4 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4500);
  }
}

overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
document.getElementById('validateBtn').onclick = openModal;

// ---------- Données + temps réel ----------
function apply(next) {
  const newSale = !next || !sale || sale.id !== next.id || sale.items.length !== next.items.length;
  sale = next;
  if (newSale) cart = {};
  const mode = !sale ? 'none' : sale.status === 'paused' ? 'paused' : 'open';

  if (mode !== 'open') {
    closeModal();
    if (mode !== screen) (mode === 'none' ? renderClosed : renderPaused)();
    screen = mode;
    return;
  }
  // Ajuste le panier (gardé pendant une pause) si le stock a baissé entre-temps
  for (const it of sale.items) if (cart[it.pizzaId] > it.remaining) cart[it.pizzaId] = it.remaining;
  for (const id of Object.keys(cart)) if (!cart[id] || !sale.items.some(i => i.pizzaId === id)) delete cart[id];
  if (screen !== 'open' || newSale) renderSale(); else refresh();
  screen = 'open';

  // Si la modale est ouverte sur le formulaire, rafraîchit les places des créneaux
  // (mise à jour en place pour ne pas perdre la saisie en cours)
  if (overlay.classList.contains('show') && modal.querySelector('#orderForm')) {
    if (!cartTotal()) return closeModal();
    if (sale.slots[chosenSlot]?.remaining === 0) chosenSlot = null;
    modal.querySelectorAll('.slot').forEach(b => {
      const s = sale.slots[b.dataset.slot];
      b.disabled = s.remaining === 0;
      b.classList.toggle('active', chosenSlot === s.index);
      b.querySelector('small').textContent = s.remaining === 0 ? 'Complet' : plural(s.remaining, 'place');
    });
  }
}

// Rafraîchit la vente toutes les 4 secondes (stock et places en direct),
// en pause quand l'onglet n'est pas visible.
const badge = document.getElementById('liveBadge');
let lastData;
async function poll() {
  try {
    const next = await rpc('pizza_current_sale');
    badge.className = 'live'; badge.lastElementChild.textContent = 'En direct';
    const json = JSON.stringify(next);
    if (json !== lastData) { lastData = json; apply(next); }
  } catch {
    badge.className = 'live off'; badge.lastElementChild.textContent = 'Reconnexion…';
  }
}
poll();
setInterval(() => { if (!document.hidden) poll(); }, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
