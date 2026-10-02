// Export PDF des créneaux d'une vente : un tableau des inscrits par créneau, à
// envoyer aux clients pour qu'ils retrouvent leur heure de retrait.
// jsPDF et les polices du site sont chargés à la demande, au premier export.
window.SlotsPdf = (() => {
  const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js';
  const FONTS = {
    Bricolage: { normal: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/bricolage-grotesque@0.4.1/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf' },
    DMSans: {
      normal: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/dm-sans@0.4.2/400Regular/DMSans_400Regular.ttf',
      bold: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/dm-sans@0.4.2/700Bold/DMSans_700Bold.ttf',
    },
  };
  const C = {
    ink: '#1c110b', ink2: '#5c4a3e', cream: '#fff4e3', paper: '#fffdf8',
    tomato: '#ff4a1c', border: '#eadcc8', rule: '#f1e6d6',
  };
  // A4 portrait, en mm
  const PW = 210, PH = 297, M = 14, W = PW - 2 * M, BOTTOM = PH - 20;
  const COL = { slot: M, slotW: 34, name: M + 40, nameW: 64, items: M + 110, itemsW: 68 };

  let ready = null;
  function load() {
    return ready ||= (async () => {
      await new Promise((ok, ko) => {
        const s = document.createElement('script');
        s.src = JSPDF; s.onload = ok; s.onerror = () => ko(new Error('Chargement de jsPDF impossible.'));
        document.head.appendChild(s);
      });
      const files = [];
      for (const [family, styles] of Object.entries(FONTS))
        for (const [style, url] of Object.entries(styles)) files.push({ family, style, url });
      await Promise.all(files.map(async f => {
        const res = await fetch(f.url);
        if (!res.ok) throw new Error('Chargement des polices impossible.');
        f.data = toBase64(await res.arrayBuffer());
      }));
      return files;
    })().catch(e => { ready = null; throw e; });
  }

  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // Les illustrations du site sont en SVG : on les passe en JPEG sur fond crème
  // (bien plus léger qu'un PNG transparent, pour un PDF facile à envoyer).
  function pizzaJpeg(name, recipe, px) {
    const svg = pizzaSVG(name, recipe).replace('<svg ', `<svg width="${px}" height="${px}" `);
    return new Promise((ok, ko) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = px;
        const ctx = c.getContext('2d');
        ctx.fillStyle = C.cream;
        ctx.fillRect(0, 0, px, px);
        ctx.drawImage(img, 0, 0, px, px);
        ok(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = ko;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  async function build(sale, orders) {
    const [fonts, bigPizza, logo] = await Promise.all([
      load(), pizzaJpeg(sale.title, 'pepperoni basilic olive', 900), pizzaJpeg('Daddy Pizz', 'pepperoni basilic', 160),
    ]);
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    for (const f of fonts) {
      const file = `${f.family}-${f.style}.ttf`;
      doc.addFileToVFS(file, f.data);
      doc.addFont(file, f.family, f.style);
    }
    doc.setProperties({ title: `${sale.title} — créneaux`, author: "Daddy Pizz'IMT" });

    const font = (family, style, size, color) => { doc.setFont(family, style); doc.setFontSize(size); doc.setTextColor(color); };
    const pizzaName = id => sale.items.find(i => i.pizzaId === id)?.name || 'Pizza supprimée';
    const background = () => { doc.setFillColor(C.cream); doc.rect(0, 0, PW, PH, 'F'); };

    // Créneaux qui ont au moins une commande, inscrits triés par nom
    const groups = sale.slots.map(s => {
      const [from, to] = s.label.split(' – ');
      const list = orders.filter(o => o.slot === s.index)
        .sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr'));
      return { from, to, list };
    }).filter(g => g.list.length);

    // ---------- En-tête de la première page ----------
    background();
    doc.addImage(bigPizza, 'JPEG', 124, -34, 112, 112);
    doc.addImage(logo, 'JPEG', M, 13, 10, 10);
    font('Bricolage', 'normal', 15, C.ink);
    doc.text("Daddy Pizz'", M + 13, 20.4);
    doc.setTextColor(C.tomato);
    doc.text('IMT', M + 13 + doc.getTextWidth("Daddy Pizz'"), 20.4);

    let y = 42;
    font('DMSans', 'bold', 8.5, C.tomato);
    doc.text((sale.date ? formatDate(sale.date) : 'Rappel de retrait').toUpperCase(), M, y, { charSpace: 0.6 });
    y += 11;
    font('Bricolage', 'normal', 32, C.ink);
    for (const line of doc.splitTextToSize(sale.title, 106)) { doc.text(line, M, y); y += 11.5; }
    font('DMSans', 'normal', 10.5, C.ink2);
    doc.text(`Retrait entre ${sale.startTime} et ${sale.endTime}. Retrouve ton nom et viens à ton créneau.`, M, y - 4);
    // Le tableau commence sous la grande pizza, même si le titre tient sur une ligne
    y = Math.max(y + 8, 84);

    // ---------- Tableau ----------
    const tableHead = () => {
      doc.setFillColor(C.ink);
      doc.roundedRect(M, y, W, 9, 2.5, 2.5, 'F');
      font('DMSans', 'bold', 7.5, C.cream);
      const o = { charSpace: 0.5 };
      doc.text('CRÉNEAU', COL.slot + 4, y + 5.8, o);
      doc.text('NOM', COL.name, y + 5.8, o);
      doc.text('COMMANDE', COL.items, y + 5.8, o);
      y += 12;
    };
    const newPage = () => {
      doc.addPage();
      background();
      y = 14;
      font('Bricolage', 'normal', 11, C.ink);
      doc.text(sale.title, M, y + 4);
      font('DMSans', 'normal', 9, C.ink2);
      doc.text('suite', M + W, y + 4, { align: 'right' });
      y += 10;
      tableHead();
    };

    // Hauteur de chaque ligne selon le texte une fois coupé
    const NAME_LH = 4.8, ITEMS_LH = 4.3, MIN_GROUP = 20, TOP = 24 + 12;
    const rows = g => g.list.map(o => {
      font('DMSans', 'bold', 10.5, C.ink);
      const name = doc.splitTextToSize(`${o.firstName} ${o.lastName}`, COL.nameW);
      font('DMSans', 'normal', 9.5, C.ink2);
      const items = doc.splitTextToSize(Object.entries(o.items).map(([id, q]) => `${q}× ${pizzaName(id)}`).join(', '), COL.itemsW);
      return { name, items, h: Math.max(14, 7 + Math.max(name.length * NAME_LH, items.length * ITEMS_LH)) };
    });
    // Un créneau d'une seule ligne doit laisser la place à l'heure et à « jusqu'à … »
    const fit = part => {
      const h = part.reduce((a, r) => a + r.h, 0);
      if (h < MIN_GROUP) part[part.length - 1] = { ...part[part.length - 1], h: part[part.length - 1].h + MIN_GROUP - h };
      return part;
    };
    // Lignes centrées verticalement ; 1,3 mm ≈ demi-hauteur des capitales
    const lines = (list, lh, x, mid) => list.forEach((l, k) => doc.text(l, x, mid - (list.length - 1) * lh / 2 + k * lh + 1.3));

    const drawGroup = (g, part, h, continued) => {
      doc.setFillColor(C.paper); doc.setDrawColor(C.border); doc.setLineWidth(0.25);
      doc.roundedRect(M, y, W, h, 3, 3, 'FD');
      // Bloc horaire
      doc.setFillColor(C.tomato);
      doc.roundedRect(M + 1.5, y + 1.5, COL.slotW, h - 3, 2.2, 2.2, 'F');
      const mid = y + h / 2;
      font('Bricolage', 'normal', 17, '#ffffff');
      doc.text(g.from, M + 1.5 + COL.slotW / 2, mid + 0.6, { align: 'center' });
      font('DMSans', 'bold', 7.5, '#ffffff');
      doc.text(continued ? `suite · jusqu’à ${g.to}` : `jusqu’à ${g.to}`, M + 1.5 + COL.slotW / 2, mid + 5.4, { align: 'center' });

      let ry = y;
      part.forEach((r, i) => {
        if (i) { doc.setDrawColor(C.rule); doc.setLineWidth(0.3); doc.line(COL.name, ry, M + W - 3, ry); }
        const mid = ry + r.h / 2;
        font('DMSans', 'bold', 10.5, C.ink);
        lines(r.name, NAME_LH, COL.name, mid);
        font('DMSans', 'normal', 9.5, C.ink2);
        lines(r.items, ITEMS_LH, COL.items, mid);
        ry += r.h;
      });
    };

    tableHead();
    for (const g of groups) {
      const all = rows(g);
      const total = fit([...all]).reduce((a, r) => a + r.h, 0);
      // Un créneau n'est coupé entre deux pages que s'il ne tient pas sur une page entière
      if (y + total > BOTTOM && total <= BOTTOM - TOP) newPage();
      let i = 0;
      while (i < all.length) {
        if (y + Math.max(all[i].h, MIN_GROUP) > BOTTOM) newPage();
        let j = i, h = 0;
        while (j < all.length && y + h + all[j].h <= BOTTOM) h += all[j++].h;
        const part = fit(all.slice(i, j));
        h = part.reduce((a, r) => a + r.h, 0);
        drawGroup(g, part, h, i > 0);
        y += h + 3;
        i = j;
      }
    }

    // ---------- Pied de page ----------
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setDrawColor(C.border); doc.setLineWidth(0.3);
      doc.line(M, PH - 12, M + W, PH - 12);
      font('DMSans', 'normal', 8, C.ink2);
      doc.text("Daddy Pizz'IMT · daddypizza.sudoo.fr", M, PH - 7.5);
      doc.text(`${p} / ${pages}`, M + W, PH - 7.5, { align: 'right' });
    }
    return doc;
  }

  async function download(sale, orders) {
    const doc = await build(sale, orders);
    const slug = sale.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    doc.save(`creneaux-${slug || 'vente'}${sale.date ? '-' + sale.date : ''}.pdf`);
  }

  return { download };
})();
