const $ = (s, el = document) => el.querySelector(s);
const plural = (n, w) => `${n} ${w}${n > 1 ? (w.endsWith('eau') ? 'x' : 's') : ''}`;
const hhmm = ts => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const TOKEN_KEY = 'daddyAdminToken';
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { } },
  del: k => { try { localStorage.removeItem(k); } catch { } },
};
let token = store.get(TOKEN_KEY);
// Le code secret de l'adresse admin (daddypizza.sudoo.fr/<code>) : il n'est écrit
// nulle part dans le code, le serveur le compare à son empreinte.
const doorCode = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ''));
let pizzas = [], sales = [], ordersData = null;
let selectedSaleId = null;  // vente affichée dans l'onglet Commandes
let historyId = null;       // vente terminée consultée depuis l'historique (sinon : vente en cours)
const isActive = s => s.status === 'open' || s.status === 'paused';
const STATUS = { open: ['is-open', 'En ligne'], paused: ['is-paused', 'En pause'], closed: ['is-closed', 'Terminée'] };
const pill = s => `<span class="pill ${STATUS[s.status][0]}">${STATUS[s.status][1]}</span>`;
let seenOrders = null;     // ids déjà vus, pour signaler les nouvelles commandes
let pizzasKey = '';        // pour ne reconstruire les listes de pizzas que si elles changent
let editingPizza = null;
let pollTimer = null;
let stateKey = '';         // dernier état reçu, pour ne redessiner que si quelque chose a changé

$('#loginArt').innerHTML = pizzaSVG('Cuisine', 'pepperoni olive basilic');
$('#logoMark').innerHTML = pizzaSVG('Daddy Pizz', 'pepperoni basilic');

// ---------- API ----------
// Fonction admin Supabase : le jeton de session est ajouté automatiquement.
async function api(fn, args = {}) {
  try {
    return await rpc(fn, { p_token: token, ...args });
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') { logout(); throw new Error('Session expirée, reconnecte-toi.'); }
    throw e;
  }
}
const safe = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 'err'); } };

// ---------- Connexion ----------
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const data = await rpc('pizza_login', { p_code: doorCode, p_password: $('#pw').value });
    if (data.error) { $('#loginError').textContent = data.error; $('#pw').select(); return; }
    token = data.token; store.set(TOKEN_KEY, token);
    $('#pw').value = '';
    start();
  } catch (ex) {
    $('#loginError').textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
};
function logout() {
  if (token) rpc('pizza_admin_logout', { p_token: token }).catch(() => {});
  store.del(TOKEN_KEY); token = null;
  clearInterval(pollTimer);
  stateKey = ''; pizzasKey = '';
  $('#dash').hidden = true; $('#login').hidden = false;
}
$('#logout').onclick = logout;

async function start() {
  $('#login').hidden = true; $('#dash').hidden = false;
  try { await loadAll(); } catch (e) { toast(e.message, 'err'); return; }
  // Commandes en direct : on relit l'état toutes les 4 secondes quand l'onglet est visible.
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (!document.hidden) loadAll().catch(() => {}); }, 4000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && token) loadAll().catch(() => {}); });

// ---------- Onglets ----------
let tab = store.get('adminTab') || 'orders';
function showTab(t) {
  tab = t; store.set('adminTab', t);
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== t);
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
showTab(tab);

// ---------- Chargement ----------
async function loadAll() {
  const state = await api('pizza_admin_state', { p_sale_id: historyId });
  const key = JSON.stringify(state);
  if (key === stateKey) return;
  stateKey = key;

  ({ pizzas, sales } = state);
  ordersData = state.detail;
  if (historyId && ordersData?.sale.id !== historyId) historyId = null;
  const target = ordersData?.sale.id || null;
  if (target !== selectedSaleId) { selectedSaleId = target; seenOrders = null; }

  const pKey = JSON.stringify(pizzas);
  const pizzasChanged = pKey !== pizzasKey;
  pizzasKey = pKey;

  renderOrders();
  renderSalesList();
  if (pizzasChanged) { renderSaleForm(); renderPizzas(); }
}

// ---------- Commandes en direct ----------
function ding() {
  try {
    const ctx = new AudioContext(), o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime); o.frequency.setValueAtTime(1320, ctx.currentTime + .12);
    g.gain.setValueAtTime(.2, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .5);
    o.start(); o.stop(ctx.currentTime + .5);
  } catch { }
}

function renderOrders() {
  const el = $('#panelOrders');
  if (!ordersData) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="art">${pizzaSVG('vide', 'fromage')}</div>
        <h2>Aucune vente en cours</h2>
        <p>Ouvre une vente pour commencer à recevoir des commandes.</p>
        <button class="btn" data-go="sales">Ouvrir une vente →</button>
      </div>`;
    el.querySelector('[data-go]').onclick = () => { showTab('sales'); $('#sTitle')?.focus(); };
    return;
  }
  const { sale, orders } = ordersData;
  const fresh = new Set();
  if (seenOrders) orders.forEach(o => { if (!seenOrders.has(o.id)) fresh.add(o.id); });
  if (fresh.size) { ding(); toast(fresh.size > 1 ? `${fresh.size} nouvelles commandes !` : '🍕 Nouvelle commande !'); }
  seenOrders = new Set(orders.map(o => o.id));

  const totalOrdered = sale.items.reduce((s, i) => s + i.ordered, 0);
  const totalStock = sale.items.reduce((s, i) => s + i.quantity, 0);
  const places = sale.slotCount * sale.slotCapacity;
  const name = id => sale.items.find(i => i.pizzaId === id)?.name || 'Pizza supprimée';
  const itemsText = items => Object.entries(items).map(([id, q]) => `${q}× ${esc(name(id))}`).join(', ');

  el.innerHTML = `
    <div class="panel-head">
      <div>
        ${pill(sale)}
        <h1 style="margin-top:12px">${esc(sale.title)}</h1>
        <div class="muted" style="margin-top:8px">${esc(sale.date ? formatDate(sale.date) + ' · ' : '')}${sale.startTime} – ${sale.endTime}</div>
      </div>
      <div class="actions">
        <button class="btn small dark" id="exportPdf" ${orders.length ? '' : 'disabled title="Aucune commande à exporter"'}>Exporter en PDF</button>
        ${isActive(sale) ? `
          <label class="switch" title="Mettre la vente en pause ou la rouvrir">
            <input type="checkbox" id="saleSwitch" ${sale.status === 'open' ? 'checked' : ''}>
            <span class="track"></span>
            <span>${sale.status === 'open' ? 'Vente ouverte' : 'Vente en pause'}</span>
          </label>
          <button class="btn small ghost danger" id="endSale">Terminer la vente</button>`
        : `<button class="btn small ghost" id="backLive">← Retour</button>`}
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><span class="label">Total général</span><b>${totalOrdered}</b><small>pizzas sur ${totalStock}</small></div>
      <div class="kpi"><span class="label">Commandes</span><b>${orders.length}</b><small>sur ${places} places</small></div>
      <div class="kpi"><span class="label">Stock restant</span><b>${totalStock - totalOrdered}</b><small>pizzas</small></div>
      <div class="kpi"><span class="label">Créneaux libres</span><b>${sale.slots.filter(s => s.remaining > 0).length}</b><small>sur ${sale.slotCount}</small></div>
    </div>

    <div class="totals">
      <h2 class="h2">Total par pizza</h2>
      ${sale.items.map(i => `
        <div class="total-row">
          <div class="mini">${pizzaSVG(i.name, i.recipe)}</div>
          <div class="name">${esc(i.name)}<small>${i.remaining} restante${i.remaining > 1 ? 's' : ''}</small></div>
          <div class="bar"><i style="width:${i.quantity ? (i.ordered / i.quantity) * 100 : 0}%"></i></div>
          <div class="num">${i.ordered}<small>/${i.quantity}</small></div>
        </div>`).join('')}
    </div>

    <h2 class="h2">Par créneau</h2>
    <div class="slot-board">
      ${sale.slots.map(s => {
        const list = orders.filter(o => o.slot === s.index).sort((a, b) => a.createdAt - b.createdAt);
        const sums = {};
        list.forEach(o => Object.entries(o.items).forEach(([id, q]) => sums[id] = (sums[id] || 0) + q));
        const n = Object.values(sums).reduce((a, b) => a + b, 0);
        return `
          <div class="slot-col ${list.length ? '' : 'empty'}">
            <header><b>${s.label}</b><span>${s.taken}/${s.capacity} pers.</span></header>
            <div class="slot-sum">${n ? `<b>${plural(n, 'pizza')}</b> · ${itemsText(sums)}` : 'Aucune commande'}</div>
            ${list.map(o => `
              <div class="order ${fresh.has(o.id) ? 'fresh' : ''}">
                <div class="who"><b>${esc(o.firstName)} ${esc(o.lastName)}</b><div class="items">${itemsText(o.items)}</div></div>
                <time>${hhmm(o.createdAt)}</time>
                <button class="del" data-del="${o.id}" title="Supprimer la commande">✕</button>
              </div>`).join('')}
          </div>`;
      }).join('')}
    </div>`;

  const sw = $('#saleSwitch', el);
  if (sw) sw.onchange = safe(async () => {
    sw.disabled = true;
    try {
      await api('pizza_admin_set_status', { p_id: sale.id, p_status: sw.checked ? 'open' : 'paused' });
      await loadAll();
      toast(sw.checked ? 'Vente rouverte 🔥' : 'Vente en pause ⏸');
    } catch (e) { sw.checked = !sw.checked; sw.disabled = false; throw e; }
  });
  const end = $('#endSale', el);
  if (end) end.onclick = safe(async () => {
    if (!confirm(`Terminer définitivement « ${sale.title} » ?\n\nLes clients ne pourront plus commander et la vente ne pourra pas être rouverte. Ses commandes restent consultables dans l’onglet Ventes.`)) return;
    await api('pizza_admin_set_status', { p_id: sale.id, p_status: 'closed' });
    historyId = null;
    toast('Vente terminée');
    await loadAll();
  });
  const pdf = $('#exportPdf', el);
  if (pdf) pdf.onclick = safe(async () => {
    pdf.disabled = true; pdf.textContent = 'Préparation…';
    try { await SlotsPdf.download(sale, orders); }
    finally { pdf.disabled = false; pdf.textContent = 'Exporter en PDF'; }
  });
  const back = $('#backLive', el);
  if (back) back.onclick = () => { historyId = null; loadAll(); };
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = safe(async () => {
    if (!confirm('Supprimer cette commande ?')) return;
    await api('pizza_admin_delete_order', { p_id: b.dataset.del });
    await loadAll();
    toast('Commande supprimée');
  }));
}

// ---------- Ventes ----------
function renderSaleForm() {
  const el = $('#panelSales');
  if (!el.querySelector('#saleForm')) {
    const today = new Date().toISOString().slice(0, 10);
    el.innerHTML = `
      <div class="panel-head"><h1>Ventes</h1></div>
      <div class="split">
        <form class="form-card" id="saleForm" novalidate>
          <h2>Nouvelle vente</h2>
          <div class="field"><label for="sTitle">Nom de la vente</label><input class="input" id="sTitle" placeholder="La fournée du vendredi"></div>
          <div class="field"><label for="sDate">Date</label><input class="input" id="sDate" type="date" value="${today}"></div>
          <div class="row3">
            <div class="field"><label for="sStart">Début</label><input class="input" id="sStart" type="time" value="18:00"></div>
            <div class="field"><label for="sEnd">Fin</label><input class="input" id="sEnd" type="time" value="21:00"></div>
            <div class="field"><label for="sCount">Créneaux</label><input class="input" id="sCount" type="number" min="1" max="96" value="6"></div>
            <div class="field"><label for="sCap">Pers. / créneau</label><input class="input" id="sCap" type="number" min="1" value="4"></div>
          </div>
          <span class="label">Pizzas disponibles</span>
          <div class="pick-list" id="pickList"></div>
          <div class="preview" id="salePreview"></div>
          <div class="error" id="saleError"></div>
          <button class="btn block" type="submit">Lancer la vente 🔥</button>
        </form>
        <div id="salesList"></div>
      </div>`;
    const form = $('#saleForm');
    form.addEventListener('input', updatePreview);
    form.onsubmit = safe(createSale);
  }

  // Liste des pizzas à cocher (en conservant la saisie en cours)
  const prev = {};
  el.querySelectorAll('.pick').forEach(p => prev[p.dataset.id] = { on: p.querySelector('[type=checkbox]').checked, q: p.querySelector('[type=number]').value });
  $('#pickList').innerHTML = pizzas.length ? pizzas.map(p => {
    const v = prev[p.id] || { on: false, q: 10 };
    return `
      <label class="pick" data-id="${p.id}">
        <input type="checkbox" ${v.on ? 'checked' : ''}>
        <span class="mini">${pizzaSVG(p.name, p.recipe)}</span>
        <b>${esc(p.name)}</b>
        <input class="input" type="number" min="1" value="${esc(v.q)}" ${v.on ? '' : 'disabled'} aria-label="Quantité ${esc(p.name)}">
      </label>`;
  }).join('') : `<p class="muted">Aucune pizza. <button type="button" class="link-btn" data-go="pizzas">Crée d’abord tes pizzas →</button></p>`;
  el.querySelector('[data-go]')?.addEventListener('click', () => showTab('pizzas'));
  el.querySelectorAll('.pick [type=checkbox]').forEach(c => c.onchange = () => {
    const q = c.closest('.pick').querySelector('[type=number]');
    q.disabled = !c.checked; if (c.checked) q.focus();
    updatePreview();
  });
  updatePreview();
  renderSalesList();
}

function readSaleForm() {
  return {
    title: $('#sTitle').value, date: $('#sDate').value,
    startTime: $('#sStart').value, endTime: $('#sEnd').value,
    slotCount: Number($('#sCount').value), slotCapacity: Number($('#sCap').value),
    items: [...document.querySelectorAll('.pick')].filter(p => p.querySelector('[type=checkbox]').checked)
      .map(p => ({ pizzaId: p.dataset.id, quantity: Number(p.querySelector('[type=number]').value) })),
  };
}

function updatePreview() {
  const f = readSaleForm();
  const box = $('#salePreview');
  const [h1, m1] = f.startTime.split(':').map(Number), [h2, m2] = f.endTime.split(':').map(Number);
  const dur = (h2 * 60 + m2) - (h1 * 60 + m1);
  const pz = f.items.reduce((s, i) => s + (i.quantity || 0), 0);
  if (!(dur > 0) || !(f.slotCount > 0)) { box.innerHTML = 'Vérifie la plage horaire et le nombre de créneaux.'; return; }
  const step = dur / f.slotCount;
  box.innerHTML = `<b>${plural(f.slotCount, 'créneau')}</b> de ${Math.round(step)} min · <b>${f.slotCount * (f.slotCapacity || 0)}</b> commandes max · <b>${plural(pz, 'pizza')}</b> en stock`
    ;
}

async function createSale() {
  const err = $('#saleError');
  err.textContent = '';
  const current = sales.find(isActive);
  if (current && !confirm(`La vente « ${current.title} » est en cours. Lancer une nouvelle vente la terminera définitivement. Continuer ?`)) return;
  try {
    const f = readSaleForm();
    await api('pizza_admin_create_sale', {
      p_title: f.title, p_date: f.date || null, p_start: f.startTime || null, p_end: f.endTime || null,
      p_slot_count: f.slotCount, p_slot_capacity: f.slotCapacity, p_items: f.items,
    });
    historyId = null;
    $('#sTitle').value = '';
    toast('Vente lancée 🔥 Elle est en ligne !');
    await loadAll();
    showTab('orders');
  } catch (e) { err.textContent = e.message; }
}

function renderSalesList() {
  const el = $('#salesList');
  if (!el) return;
  if (!sales.length) { el.innerHTML = `<div class="empty-state"><div class="art">${pizzaSVG('vide2', 'fromage')}</div><h2>Pas encore de vente</h2><p>Remplis le formulaire pour lancer la première.</p></div>`; return; }
  el.innerHTML = sales.map(s => {
    const ordered = s.items.reduce((a, i) => a + i.ordered, 0), stock = s.items.reduce((a, i) => a + i.quantity, 0);
    return `
      <div class="sale-row">
        <div>
          <h3>${esc(s.title)} ${pill(s)}</h3>
          <div class="meta">${esc(s.date ? formatDate(s.date) + ' · ' : '')}${s.startTime} – ${s.endTime} · ${plural(s.slotCount, 'créneau')} × ${s.slotCapacity} pers. · <b>${ordered}/${stock}</b> pizzas · ${plural(s.orderCount, 'commande')}</div>
          <div class="chips">${s.items.map(i => `<span class="chip">${esc(i.name)} · ${i.ordered}/${i.quantity}</span>`).join('')}</div>
        </div>
        <div class="acts">
          <button class="btn small ${isActive(s) ? 'dark' : 'ghost'}" data-view="${s.id}">${isActive(s) ? 'Voir en direct' : 'Commandes'}</button>
          <button class="link-btn danger" data-delsale="${s.id}">Supprimer</button>
        </div>
      </div>`;
  }).join('');
  el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    const s = sales.find(x => x.id === b.dataset.view);
    historyId = isActive(s) ? null : s.id;
    loadAll(); showTab('orders');
  });
  el.querySelectorAll('[data-delsale]').forEach(b => b.onclick = safe(async () => {
    const s = sales.find(x => x.id === b.dataset.delsale);
    if (!confirm(`Supprimer « ${s.title} » et ses ${plural(s.orderCount, 'commande')} ? C’est définitif.`)) return;
    await api('pizza_admin_delete_sale', { p_id: s.id });
    await loadAll();
    toast('Vente supprimée');
  }));
}

// ---------- Pizzas ----------
function renderPizzas() {
  const el = $('#panelPizzas');
  if (!el.querySelector('#pizzaForm')) {
    el.innerHTML = `
      <div class="panel-head"><h1>Pizzas</h1></div>
      <div class="split">
        <form class="form-card" id="pizzaForm" novalidate>
          <h2>Nouvelle pizza</h2>
          <div class="field"><label for="pName">Nom</label><input class="input" id="pName" placeholder="Margherita"></div>
          <div class="field"><label for="pRecipe">Recette</label><textarea class="input" id="pRecipe" placeholder="Sauce tomate, mozzarella, basilic frais, huile d’olive"></textarea></div>
          <div class="error" id="pizzaError"></div>
          <button class="btn block" type="submit">Ajouter au menu</button>
        </form>
        <div class="pizza-list" id="pizzaList"></div>
      </div>`;
    $('#pizzaForm').onsubmit = async e => {
      e.preventDefault();
      try {
        await api('pizza_admin_save_pizza', { p_id: null, p_name: $('#pName').value, p_recipe: $('#pRecipe').value });
        await loadAll();
        $('#pName').value = ''; $('#pRecipe').value = ''; $('#pizzaError').textContent = '';
        toast('Pizza ajoutée 🍕');
        $('#pName').focus();
      } catch (ex) { $('#pizzaError').textContent = ex.message; }
    };
  }

  const list = $('#pizzaList');
  if (!pizzas.length) {
    list.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="art">${pizzaSVG('vide3', 'fromage')}</div><h2>Le menu est vide</h2><p>Ajoute ta première recette à gauche.</p></div>`;
    return;
  }
  list.innerHTML = pizzas.map(p => editingPizza === p.id ? `
    <form class="pz" data-edit="${p.id}">
      <div class="art">${pizzaSVG(p.name, p.recipe)}</div>
      <div class="field"><input class="input" name="name" value="${esc(p.name)}"></div>
      <div class="field"><textarea class="input" name="recipe">${esc(p.recipe)}</textarea></div>
      <div class="acts"><button class="btn small" type="submit">Enregistrer</button><button class="btn small ghost" type="button" data-cancel>Annuler</button></div>
    </form>` : `
    <div class="pz">
      <div class="art">${pizzaSVG(p.name, p.recipe)}</div>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.recipe) || '<i>Pas de recette</i>'}</p>
      <div class="acts"><button class="link-btn" data-editp="${p.id}">Modifier</button><button class="link-btn danger" data-delp="${p.id}">Supprimer</button></div>
    </div>`).join('');

  list.querySelectorAll('[data-editp]').forEach(b => b.onclick = () => { editingPizza = b.dataset.editp; renderPizzas(); list.querySelector('[name=name]')?.focus(); });
  list.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => { editingPizza = null; renderPizzas(); });
  list.querySelectorAll('[data-edit]').forEach(f => f.onsubmit = safe(async e => {
    e.preventDefault();
    await api('pizza_admin_save_pizza', { p_id: f.dataset.edit, p_name: f.elements.namedItem('name').value, p_recipe: f.elements.namedItem('recipe').value });
    editingPizza = null; toast('Pizza mise à jour');
    pizzasKey = ''; stateKey = '';
    await loadAll();
  }));
  list.querySelectorAll('[data-delp]').forEach(b => b.onclick = safe(async () => {
    const p = pizzas.find(x => x.id === b.dataset.delp);
    if (!confirm(`Supprimer « ${p.name} » ?`)) return;
    await api('pizza_admin_delete_pizza', { p_id: p.id });
    await loadAll();
    toast('Pizza supprimée');
  }));
}

(async () => {
  let ok = false;
  try { ok = doorCode !== '' && await rpc('pizza_door', { p_code: doorCode }); } catch { }
  if (!ok) { $('#notfound').hidden = false; document.title = 'Page introuvable'; return; }
  document.title = "Daddy Pizz'IMT — Cuisine";
  if (token) start(); else { $('#login').hidden = false; $('#pw').focus(); }
})();
