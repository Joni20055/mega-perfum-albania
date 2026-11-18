"use strict";

const state = {
  products: [],
  cart: loadCart(),
  quantities: {},
};

let checkout = null;
let submitting = false;
let toastTimer = 0;

const els = {
  products: document.getElementById("products"),
  cartCount: document.getElementById("cart-count"),
  cartItems: document.getElementById("cart-items"),
  cartTotal: document.getElementById("cart-total"),
  cartBuy: document.getElementById("cart-buy"),
  drawer: document.getElementById("drawer"),
  modal: document.getElementById("checkout"),
  checkoutTitle: document.getElementById("checkout-title"),
  checkoutBody: document.getElementById("checkout-body"),
  toast: document.getElementById("toast"),
  contactForm: document.getElementById("contact-form"),
  contactNote: document.getElementById("contact-note"),
};

function loadCart() {
  try {
    const data = JSON.parse(localStorage.getItem("parfume-cart") || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter((line) => line && typeof line.id === "string" && Number.isInteger(line.qty) && line.qty > 0);
  } catch (err) {
    return [];
  }
}

function saveCart() {
  localStorage.setItem("parfume-cart", JSON.stringify(state.cart));
}

const SHIPPING = {
  "Kosovë": { amount: 5, currency: "EUR" },
  "Shqipëri": { amount: 300, currency: "ALL" },
};

function money(value) {
  return `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} lek`;
}

let eurQuote = null;
let shipToken = 0;

function roundEur(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatEur(value) {
  const [whole, frac] = roundEur(value).toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

function shippingText(ship) {
  if (!ship) return "";
  if (ship.currency === "EUR") return `${ship.amount} euro`;
  return money(ship.amount);
}

function dueText(subtotal, ship) {
  const goods = Math.round(Number(subtotal) || 0);
  if (!ship) return money(goods);
  if (ship.currency === "ALL") return money(goods + Number(ship.amount));
  return `${money(goods)} + ${ship.amount} euro`;
}

function orderDue(order) {
  if (order && order.shipping && order.shipping.currency === "EUR" && order.totalEur != null) {
    return `${formatEur(order.totalEur)} euro`;
  }
  const subtotal = order && order.subtotal != null ? order.subtotal : order && order.total;
  return dueText(subtotal, order && order.shipping);
}

async function loadEurRate() {
  if (eurQuote) return eurQuote;
  const res = await fetch("/api/rate");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Number(data.lekPerEur)) throw new Error(data.error || "Çmimi në euro nuk u përgatit.");
  eurQuote = data;
  return eurQuote;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const CITIES = {
  "Kosovë": [
    "Prishtinë", "Prizren", "Pejë", "Gjakovë", "Gjilan", "Ferizaj", "Mitrovicë",
    "Podujevë", "Vushtrri", "Suharekë", "Rahovec", "Lipjan", "Malishevë",
    "Kamenicë", "Viti", "Deçan", "Istog", "Klinë", "Skenderaj", "Drenas",
    "Kaçanik", "Shtime", "Fushë Kosovë", "Obiliq", "Dragash",
  ],
  "Shqipëri": [
    "Tiranë", "Durrës", "Vlorë", "Shkodër", "Elbasan", "Korçë", "Fier", "Berat",
    "Lushnjë", "Kavajë", "Pogradec", "Gjirokastër", "Sarandë", "Lezhë", "Kukës",
    "Peshkopi", "Laç", "Krujë", "Patos", "Burrel", "Himarë", "Gramsh",
    "Librazhd", "Përmet", "Tepelenë", "Shijak", "Rrogozhinë",
  ],
};

function validateCustomer(data, options = {}) {
  const phoneRequired = options.phoneRequired !== false;
  const name = clean(data.name, 80);
  const email = clean(data.email, 120);
  const phone = clean(data.phone, 30);
  if (name.length < 2 || !/\p{L}/u.test(name)) return "Shkruani emrin.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Shkruani një email të vlefshëm.";
  const digits = phone.replace(/\D/g, "");
  if (phoneRequired || phone) {
    if (digits.length < 8 || digits.length > 15) return "Shkruani një numër telefoni të vlefshëm.";
  }
  if (options.message && clean(data.message, 1000).length < 5) return "Shkruani një mesazh.";
  return "";
}

function cashCity(data) {
  const picked = clean(data.city, 60);
  if (picked === "__other") return clean(data.cityOther, 60);
  return picked;
}

function validateCash(data) {
  const first = clean(data.firstName, 40);
  const last = clean(data.lastName, 40);
  if (first.length < 2 || !/\p{L}/u.test(first)) return "Shkruani emrin.";
  if (last.length < 2 || !/\p{L}/u.test(last)) return "Shkruani mbiemrin.";
  const base = validateCustomer({ ...data, name: `${first} ${last}` });
  if (base) return base;
  const country = clean(data.country, 20);
  if (!CITIES[country]) return "Zgjidhni Kosovën ose Shqipërinë.";
  const city = cashCity(data);
  if (city.length < 2 || !/\p{L}/u.test(city)) return "Zgjidhni qytetin ku ndodheni.";
  if (clean(data.city, 60) !== "__other" && !CITIES[country].includes(city)) {
    return "Zgjidhni një qytet të atij vendi.";
  }
  return "";
}

function pulse(el, name) {
  if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.classList.remove(name);
  void el.offsetWidth;
  el.classList.add(name);
  const onEnd = (event) => {
    if (event.target !== el) return;
    el.classList.remove(name);
    el.removeEventListener("animationend", onEnd);
  };
  el.addEventListener("animationend", onEnd);
}

function flash(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function syncLock() {
  const locked = els.modal.classList.contains("open") || els.drawer.classList.contains("open");
  document.body.classList.toggle("locked", locked);
}

function clampCart() {
  state.cart = state.cart.flatMap((line) => {
    const product = state.products.find((item) => item.id === line.id);
    if (!product || product.stock < 1) return [];
    return [{ id: line.id, qty: Math.min(line.qty, product.stock) }];
  });
  saveCart();
}

async function loadProducts() {
  const res = await fetch("/api/products");
  if (!res.ok) throw new Error("Parfumet nuk u ngarkuan.");
  state.products = await res.json();
  for (const product of state.products) {
    const current = state.quantities[product.id] || 1;
    const max = Math.max(product.stock, 1);
    state.quantities[product.id] = Math.min(Math.max(current, 1), max);
  }
  clampCart();
  renderProducts();
  renderCart();
}

function stockLabel(stock) {
  if (stock < 1) return "Jashtë stokut";
  if (stock === 1) return "Mbetet 1 copë";
  return "Në stok";
}

function leadSentence(text) {
  const clean = String(text || "").trim();
  const sentence = clean.split(/(?<=\.)\s+/)[0];
  return sentence || clean;
}

function renderProducts() {
  if (!state.products.length) {
    els.products.innerHTML = `<p class="empty">Nuk ka produkte.</p>`;
    return;
  }

  els.products.innerHTML = state.products.map((product) => {
    const out = product.stock < 1;
    const qty = out ? 0 : state.quantities[product.id] || 1;
    const chips = product.accords.map((accord) => `<li>${esc(accord)}</li>`).join("");
    return `
      <article class="card${out ? " is-out" : ""}" data-id="${esc(product.id)}">
        <div class="photo">
          <img src="${esc(product.image)}" alt="${esc(product.brand)} ${esc(product.name)}">
          <span class="stock">${stockLabel(product.stock)}</span>
        </div>
        <div class="info">
          <div>
            <p class="brand">${esc(product.brand)}</p>
            <h3>${esc(product.name)}</h3>
            <p class="meta">${esc(product.concentration)} · ${esc(product.size)} · ${esc(product.audience)}</p>
          </div>
          <ul class="accords">${chips}</ul>
          <p class="prose tease">${esc(leadSentence(product.nuance))}</p>
          <button type="button" class="text-btn" data-more aria-expanded="false">Lexo më shumë</button>
          <div class="more" hidden>
            <p class="prose">${esc(product.nuance)}</p>
            <p class="pop-label">${esc(product.popularityLabel)}</p>
            <p class="prose">${esc(product.popularity)}</p>
          </div>
          <div class="buy">
            <p class="price">
              <strong>${money(product.price)}</strong>
              <s><span class="sr-only">Çmimi i mëparshëm </span>${money(product.oldPrice)}</s>
            </p>
            <div class="qty">
              <button type="button" data-dec aria-label="Zvogëlo sasinë" ${out ? "disabled" : ""}>−</button>
              <span class="qty-val">${qty}</span>
              <button type="button" data-inc aria-label="Rrit sasinë" ${out ? "disabled" : ""}>+</button>
            </div>
            <div class="actions">
              <button type="button" class="btn" data-add ${out ? "disabled" : ""}>Shto në shportë</button>
              <button type="button" class="btn primary" data-buy ${out ? "disabled" : ""}>Bli tani</button>
            </div>
          </div>
        </div>
      </article>`;
  }).join("");
}

function changeQty(id, delta) {
  const product = state.products.find((item) => item.id === id);
  if (!product || product.stock < 1) return;
  const next = Math.min(product.stock, Math.max(1, (state.quantities[id] || 1) + delta));
  state.quantities[id] = next;
  const label = document.querySelector(`.card[data-id="${CSS.escape(id)}"] .qty-val`);
  if (label) {
    label.textContent = String(next);
    pulse(label, "is-pop");
  }
}

function addToCart(id, button) {
  const product = state.products.find((item) => item.id === id);
  if (!product || product.stock < 1) return;
  const qty = state.quantities[id] || 1;
  const line = state.cart.find((item) => item.id === id);
  const desired = (line ? line.qty : 0) + qty;
  if (desired > product.stock) {
    flash(`Ka vetëm ${product.stock} copë në stok.`);
    return;
  }
  if (line) line.qty = desired;
  else state.cart.push({ id, qty });
  saveCart();
  renderCart();
  flash("U shtua në shportë.");
  if (!button) return;
  const previous = button.textContent;
  button.textContent = "U shtua";
  button.classList.add("is-added");
  setTimeout(() => {
    if (!button.isConnected) return;
    button.textContent = previous;
    button.classList.remove("is-added");
  }, 900);
}

let lastCartCount = 0;

function renderCart() {
  const count = state.cart.reduce((sum, line) => sum + line.qty, 0);
  const cartButton = document.getElementById("open-cart");
  els.cartCount.textContent = count > 0 ? String(count) : "";
  els.cartCount.classList.toggle("is-live", count > 0);
  cartButton.setAttribute("aria-label", count > 0 ? `Shporta, ${count}` : "Shporta");
  if (count > lastCartCount) pulse(cartButton, "is-bump");
  lastCartCount = count;
  if (!state.products.length) return;
  els.cartBuy.disabled = count === 0;
  if (!state.cart.length) {
    els.cartItems.innerHTML = `<p class="empty">Shporta është bosh.</p>`;
    els.cartTotal.textContent = money(0);
    return;
  }

  let total = 0;
  els.cartItems.innerHTML = state.cart.map((line) => {
    const product = state.products.find((item) => item.id === line.id);
    if (!product) return "";
    total += product.price * line.qty;
    return `
      <div class="line" data-id="${esc(product.id)}">
        <div>
          <strong>${esc(product.brand)} ${esc(product.name)}</strong>
          <p class="meta">${esc(product.concentration)} · ${esc(product.size)}</p>
          <div class="line-qty">
            <button type="button" data-action="dec" aria-label="Zvogëlo sasinë">−</button>
            <span>${line.qty}</span>
            <button type="button" data-action="inc" aria-label="Rrit sasinë">+</button>
            <button type="button" class="text-btn" data-action="remove">Hiq</button>
          </div>
        </div>
        <div class="line-price">${money(product.price * line.qty)}</div>
      </div>`;
  }).join("");
  els.cartTotal.textContent = money(total);
}

function updateCartQty(id, delta) {
  const product = state.products.find((item) => item.id === id);
  const line = state.cart.find((item) => item.id === id);
  if (!line || !product) return;
  const next = line.qty + delta;
  if (next <= 0) state.cart = state.cart.filter((item) => item.id !== id);
  else if (next > product.stock) {
    flash(`Ka vetëm ${product.stock} copë në stok.`);
    return;
  } else line.qty = next;
  saveCart();
  renderCart();
}

function resolveItems(items) {
  const merged = [];
  for (const item of items) {
    const qty = Number(item.qty);
    if (!item.id || !Number.isInteger(qty) || qty < 1) return { error: "Sasia nuk është e vlefshme." };
    const found = merged.find((entry) => entry.id === item.id);
    if (found) found.qty += qty;
    else merged.push({ id: item.id, qty });
  }
  if (!merged.length) return { error: "Nuk ka produkte për të blerë." };

  const resolved = [];
  for (const item of merged) {
    const product = state.products.find((entry) => entry.id === item.id);
    if (!product) return { error: "Një produkt nuk gjendet më." };
    if (item.qty > product.stock) {
      return {
        error: product.stock < 1
          ? `${product.brand} ${product.name} ka mbaruar.`
          : `Ka vetëm ${product.stock} copë për ${product.brand} ${product.name}.`,
      };
    }
    resolved.push({
      id: product.id,
      qty: item.qty,
      name: `${product.brand} ${product.name}`,
      price: product.price,
      oldPrice: product.oldPrice,
    });
  }
  return { items: resolved };
}

function renderPayPanel() {
  const panel = document.getElementById("pay-panel");
  if (!panel || !checkout) return;
  if (checkout.method === "cash") {
    panel.innerHTML = `
      <form class="cash-form" id="cash-form" novalidate>
        <div class="cash-card">
          <span class="cash-mark">Cash</span>
          <span>
            <b>Pagesë në dorëzim</b>
            <span>Paratë jepen kur vjen porosia.</span>
          </span>
        </div>
        <p class="pay-label">Të dhënat</p>
        <div class="name-row">
          <label>Emri
            <input name="firstName" autocomplete="given-name" maxlength="40" required>
          </label>
          <label>Mbiemri
            <input name="lastName" autocomplete="family-name" maxlength="40" required>
          </label>
        </div>
        <label>Numri i telefonit
          <input name="phone" type="tel" autocomplete="tel" maxlength="30" required>
        </label>
        <label>Email
          <input name="email" type="email" autocomplete="email" maxlength="120" required>
        </label>
        <label>Vendbanimi
          <select name="country" required>
            <option value="">Zgjidhni vendin</option>
            <option value="Kosovë">Kosovë</option>
            <option value="Shqipëri">Shqipëri</option>
          </select>
        </label>
        <label id="city-field" hidden>Në cilin qytet ndodheni?
          <select name="city">
            <option value="">Zgjidhni qytetin</option>
          </select>
        </label>
        <label id="city-other" hidden>Shkruani qytetin
          <input name="cityOther" maxlength="60" autocomplete="address-level2">
        </label>
        <button class="btn primary" type="submit">Aktivizo porosinë</button>
      </form>`;
    const form = panel.querySelector("#cash-form");
    const country = form.querySelector("[name=country]");
    const cityField = form.querySelector("#city-field");
    const citySelect = form.querySelector("[name=city]");
    const otherField = form.querySelector("#city-other");
    country.addEventListener("change", () => {
      const list = CITIES[country.value] || [];
      citySelect.innerHTML = `
        <option value="">Zgjidhni qytetin</option>
        ${list.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}
        <option value="__other">Qytet tjetër</option>`;
      citySelect.value = "";
      cityField.hidden = list.length === 0;
      otherField.hidden = true;
      form.querySelector("[name=cityOther]").value = "";
      setPayError("");
      applyShipping(country.value);
      if (!cityField.hidden) cityField.scrollIntoView({ block: "nearest" });
    });
    citySelect.addEventListener("change", () => {
      const other = citySelect.value === "__other";
      otherField.hidden = !other;
      if (!other) form.querySelector("[name=cityOther]").value = "";
      else otherField.scrollIntoView({ block: "nearest" });
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget).entries());
      const error = validateCash(data);
      if (error) {
        setPayError(error);
        return;
      }
      if (clean(data.country, 20) === "Kosovë" && !checkout.kosovoReady) {
        setPayError("Çmimi në euro nuk u përgatit. Provo përsëri.");
        return;
      }
      const firstName = clean(data.firstName, 40);
      const lastName = clean(data.lastName, 40);
      placeOrder("cash", {
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        phone: data.phone,
        email: data.email,
        country: clean(data.country, 20),
        city: cashCity(data),
      });
    });
    const first = panel.querySelector("input");
    if (first) first.focus();
  }
}

function renderCheckout() {
  if (!checkout) return;
  els.checkoutTitle.textContent = "Bli tani";
  const resolved = resolveItems(checkout.items);
  if (resolved.error) {
    els.checkoutBody.innerHTML = `<p class="form-note err">${esc(resolved.error)}</p>`;
    return;
  }

  const items = resolved.items;
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  checkout.subtotal = total;
  const oldTotal = items.reduce((sum, item) => sum + item.oldPrice * item.qty, 0);
  checkout.oldSubtotal = oldTotal;
  const rows = items.map((item) => `
    <li>
      <span>${esc(item.name)} × ${item.qty}</span>
      <span data-lek="${item.price * item.qty}">${money(item.price * item.qty)}</span>
    </li>`).join("");

  els.checkoutBody.innerHTML = `
    <ul class="summary" id="order-summary">
      ${rows}
      <li id="ship-row" hidden>
        <span>Transporti</span>
        <span id="ship-price"></span>
      </li>
      <li class="total">
        <span>Totali</span>
        <span><s id="old-price" data-lek="${oldTotal}">${money(oldTotal)}</s> <strong id="due-price">${money(total)}</strong></span>
      </li>
    </ul>
    <div id="pay-panel"></div>
    <p class="form-note err" id="pay-error"></p>`;

  checkout.method = "cash";
  renderPayPanel();
}

function moneyLines() {
  return [...document.querySelectorAll("#order-summary [data-lek]")].filter((el) => el.id !== "old-price");
}

function showLekSummary(ship) {
  const summary = document.getElementById("order-summary");
  const oldPrice = document.getElementById("old-price");
  if (summary) summary.classList.remove("is-eur");
  moneyLines().forEach((el) => {
    el.textContent = money(Number(el.dataset.lek));
  });
  if (oldPrice) {
    oldPrice.hidden = false;
    oldPrice.textContent = money(Number(oldPrice.dataset.lek));
  }
  const price = document.getElementById("ship-price");
  const due = document.getElementById("due-price");
  if (price) price.textContent = ship ? shippingText(ship) : "";
  if (due) due.textContent = dueText(checkout.subtotal, ship);
}

async function applyShipping(country) {
  const token = ++shipToken;
  const ship = SHIPPING[country] || null;
  const row = document.getElementById("ship-row");
  const price = document.getElementById("ship-price");
  const due = document.getElementById("due-price");
  const oldPrice = document.getElementById("old-price");
  if (!row || !price || !due || !checkout) return;
  checkout.kosovoReady = false;
  row.hidden = !ship;
  if (country !== "Kosovë") {
    showLekSummary(ship);
    return;
  }
  price.textContent = "5 euro";
  due.textContent = "…";
  try {
    const quote = await loadEurRate();
    if (token !== shipToken || !checkout) return;
    const rate = Number(quote.lekPerEur);
    const goods = roundEur(checkout.subtotal / rate);
    const lines = moneyLines();
    let used = 0;
    lines.forEach((el, index) => {
      let eur = roundEur(Number(el.dataset.lek) / rate);
      if (index === lines.length - 1) eur = roundEur(goods - used);
      else used = roundEur(used + eur);
      el.textContent = `${formatEur(eur)} euro`;
    });
    const oldGoods = roundEur(Number(oldPrice && oldPrice.dataset.lek) / rate);
    if (oldPrice) {
      const showOld = oldGoods > goods;
      oldPrice.hidden = !showOld;
      if (showOld) oldPrice.textContent = `${formatEur(roundEur(oldGoods + 5))} euro`;
    }
    due.textContent = `${formatEur(roundEur(goods + 5))} euro`;
    const summary = document.getElementById("order-summary");
    if (summary) summary.classList.add("is-eur");
    pulse(due, "is-price-pop");
    checkout.kosovoReady = true;
  } catch (err) {
    if (token !== shipToken || !checkout) return;
    showLekSummary(null);
    row.hidden = false;
    price.textContent = "5 euro";
    setPayError(err.message || "Çmimi në euro nuk u përgatit. Provo përsëri.");
  }
}

function setPayError(message) {
  const note = document.getElementById("pay-error");
  if (note) note.textContent = message || "";
}

function showSuccess(order) {
  els.checkoutTitle.textContent = "Faleminderit";
  const place = order.customer
    ? ` Dërgesa: ${esc(order.customer.city || "")}, ${esc(order.customer.country || "")}.`
    : "";
  const extra = `Porosia u aktivizua me cash. Do t'ju kontaktojmë te numri dhe email-i që latë.${place}`;
  els.checkoutBody.innerHTML = `
    <p class="prose">${extra}</p>
    <p>Numri i porosisë<br><strong>${esc(order.id)}</strong></p>
    <p>Totali<br><strong>${esc(orderDue(order))}</strong></p>
    <button type="button" class="btn primary" id="done">Mbyll</button>`;
  els.checkoutBody.querySelector("#done").addEventListener("click", closeCheckout);
}

async function placeOrder(method, customer) {
  if (submitting || !checkout) return;
  const resolved = resolveItems(checkout.items);
  if (resolved.error) {
    setPayError(resolved.error);
    return;
  }
  submitting = true;
  document.querySelectorAll("#checkout-body button").forEach((btn) => {
    btn.disabled = true;
  });
  try {
    const payload = {
      items: resolved.items.map((item) => ({ id: item.id, qty: item.qty })),
      paymentMethod: method,
    };
    if (method === "cash") payload.customer = customer;
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Porosia dështoi.");
    if (checkout.source === "cart") {
      state.cart = [];
      saveCart();
    }
    try {
      await loadProducts();
    } catch (err) {
      renderCart();
    }
    showSuccess(data.order);
  } catch (err) {
    try {
      await loadProducts();
    } catch (loadErr) {
      renderCart();
    }
    if (!checkout) return;
    renderCheckout();
    setPayError(err.message || "Porosia dështoi.");
  } finally {
    submitting = false;
  }
}

function openCheckout(items, source) {
  const resolved = resolveItems(items);
  if (resolved.error) {
    flash(resolved.error);
    return;
  }
  checkout = { items, source, method: "cash" };
  closeCart();
  renderCheckout();
  els.modal.classList.add("open");
  syncLock();
  document.getElementById("close-checkout").focus();
}

function openCart() {
  renderCart();
  els.drawer.classList.add("open");
  syncLock();
}

function closeCart() {
  els.drawer.classList.remove("open");
  syncLock();
}

function closeCheckout() {
  if (submitting) return;
  els.modal.classList.remove("open");
  checkout = null;
  syncLock();
}

function setContactNote(text, ok) {
  els.contactNote.textContent = text;
  els.contactNote.classList.toggle("ok", Boolean(text) && ok);
  els.contactNote.classList.toggle("err", Boolean(text) && !ok);
}

document.addEventListener("pointerdown", (event) => {
  const target = event.target.closest("button, a.btn, .pay-btn");
  if (!target || target.disabled) return;
  pulse(target, "is-tap");
  const card = target.closest(".card");
  if (card) pulse(card, "is-press");
});

els.products.addEventListener("click", (event) => {
  const card = event.target.closest(".card");
  if (!card) return;
  const id = card.dataset.id;
  const moreBtn = event.target.closest("[data-more]");
  if (moreBtn) {
    const more = card.querySelector(".more");
    const tease = card.querySelector(".tease");
    const willOpen = more.hidden;
    more.hidden = !willOpen;
    if (tease) tease.hidden = willOpen;
    moreBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
    moreBtn.textContent = willOpen ? "Mbyll" : "Lexo më shumë";
    return;
  }
  if (event.target.closest("[data-dec]")) changeQty(id, -1);
  else if (event.target.closest("[data-inc]")) changeQty(id, 1);
  else if (event.target.closest("[data-add]")) addToCart(id, event.target.closest("[data-add]"));
  else if (event.target.closest("[data-buy]")) openCheckout([{ id, qty: state.quantities[id] || 1 }], "product");
});

els.cartItems.addEventListener("click", (event) => {
  const row = event.target.closest(".line");
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!row || !action) return;
  const id = row.dataset.id;
  if (action === "remove") {
    state.cart = state.cart.filter((line) => line.id !== id);
    saveCart();
    renderCart();
  } else if (action === "inc") updateCartQty(id, 1);
  else if (action === "dec") updateCartQty(id, -1);
});

document.getElementById("open-cart").addEventListener("click", openCart);
document.getElementById("close-cart").addEventListener("click", closeCart);
document.getElementById("close-checkout").addEventListener("click", closeCheckout);
document.getElementById("cart-buy").addEventListener("click", () => {
  openCheckout(state.cart.map((line) => ({ id: line.id, qty: line.qty })), "cart");
});

els.drawer.addEventListener("click", (event) => {
  if (event.target === els.drawer) closeCart();
});

els.modal.addEventListener("click", (event) => {
  if (event.target === els.modal) closeCheckout();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (els.modal.classList.contains("open")) closeCheckout();
  else closeCart();
});

els.contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(els.contactForm).entries());
  const error = validateCustomer(data, { phoneRequired: false, message: true });
  if (error) {
    setContactNote(error, false);
    return;
  }
  const button = els.contactForm.querySelector("button");
  button.disabled = true;
  setContactNote("", true);
  try {
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.name,
        email: data.email,
        phone: data.phone,
        message: data.message,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Mesazhi nuk u dërgua.");
    els.contactForm.reset();
    setContactNote("Mesazhi u dërgua. Faleminderit.", true);
  } catch (err) {
    setContactNote(err.message || "Mesazhi nuk u dërgua.", false);
  } finally {
    button.disabled = false;
  }
});

const stageSlides = [
  { brand: "Valentino", name: "Born in Roma Intense", line: "Vanilja që mbetet në mbrëmje." },
  { brand: "Yves Saint Laurent", name: "Y", line: "E freskëta që e njohin kudo." },
  { brand: "Dior", name: "Sauvage Elixir", line: "Më e thella. Më e gjata." },
  { brand: "Yves Saint Laurent", name: "MYSLF", line: "E pastër, pa zhurmë." },
];

function startStage() {
  const root = document.getElementById("stage");
  if (!root) return;
  const images = [...root.querySelectorAll(".stage-frame img")];
  const marks = [...root.querySelectorAll(".stage-nav button")];
  const copy = root.querySelector(".stage-copy");
  const kicker = document.getElementById("stage-kicker");
  const title = document.getElementById("stage-name");
  const line = document.getElementById("stage-line");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let index = 0;
  let timer = 0;

  function show(next) {
    index = next;
    images.forEach((img, i) => img.classList.toggle("is-on", i === index));
    marks.forEach((mark, i) => {
      mark.setAttribute("aria-selected", i === index ? "true" : "false");
      mark.classList.remove("run");
    });
    const slide = stageSlides[index];
    kicker.textContent = slide.brand;
    title.textContent = slide.name;
    line.textContent = slide.line;
    copy.classList.remove("is-swap");
    void copy.offsetWidth;
    copy.classList.add("is-swap");
    if (!motion) {
      void marks[index].offsetWidth;
      marks[index].classList.add("run");
    }
  }

  function queue() {
    clearInterval(timer);
    if (motion) return;
    timer = setInterval(() => show((index + 1) % stageSlides.length), 5200);
  }

  marks.forEach((mark, i) => {
    mark.addEventListener("click", () => {
      show(i);
      queue();
    });
  });
  root.addEventListener("mouseenter", () => clearInterval(timer));
  root.addEventListener("mouseleave", queue);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearInterval(timer);
    else queue();
  });
  show(0);
  queue();
}

function startFest() {
  const root = document.getElementById("fest-stage");
  if (!root) return;
  const images = [...root.querySelectorAll("img")];
  const label = document.getElementById("fest-label");
  const nights = [...document.querySelectorAll(".nights li")];
  const slides = [
    { label: "Valentino · Born in Roma Intense", night: 0 },
    { label: "Yves Saint Laurent · Y", night: 2 },
    { label: "Dior · Sauvage Elixir", night: 1 },
    { label: "Yves Saint Laurent · MYSLF", night: 2 },
  ];
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let index = 0;
  let timer = 0;

  function show(next) {
    index = next;
    images.forEach((img, i) => img.classList.toggle("is-on", i === index));
    const slide = slides[index];
    if (label) label.textContent = slide.label;
    nights.forEach((item, i) => item.classList.toggle("is-now", i === slide.night));
  }

  function queue() {
    clearInterval(timer);
    if (motion) return;
    timer = setInterval(() => show((index + 1) % slides.length), 5200);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearInterval(timer);
    else queue();
  });
  show(0);
  queue();
}

function startEnvelopes() {
  const cards = [...document.querySelectorAll(".envelope")];
  cards.forEach((card) => {
    const seal = card.querySelector(".env-seal");
    if (!seal) return;
    seal.addEventListener("click", () => {
      const open = card.classList.contains("is-open");
      cards.forEach((other) => other.classList.remove("is-open"));
      if (!open) card.classList.add("is-open");
    });
  });
}

async function init() {
  startStage();
  startFest();
  startEnvelopes();
  const savedCount = state.cart.reduce((sum, line) => sum + line.qty, 0);
  els.cartCount.textContent = savedCount > 0 ? String(savedCount) : "";
  els.cartCount.classList.toggle("is-live", savedCount > 0);
  lastCartCount = savedCount;
  try {
    await loadProducts();
  } catch (err) {
    els.products.innerHTML = `<p class="form-note err">Parfumet nuk u ngarkuan. Rifreskoni faqen.</p>`;
  }
}

init();
