"use strict";

const TOKEN_KEY = "mega-admin-token";
const gate = document.getElementById("gate");
const desk = document.getElementById("desk");
const logout = document.getElementById("logout");
const loginForm = document.getElementById("login-form");
const loginNote = document.getElementById("login-note");
const messagesEl = document.getElementById("messages");
const ordersEl = document.getElementById("orders");
const summaryEl = document.getElementById("summary");

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function asList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function money(value) {
  return `${Math.round(Number(value) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} lek`;
}

function formatEur(value) {
  const [whole, frac] = (Math.round((Number(value) + Number.EPSILON) * 100) / 100).toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

function dueText(order) {
  const subtotal = order.subtotal != null ? order.subtotal : order.total;
  const ship = order.shipping;
  if (ship && ship.currency === "EUR" && order.totalEur != null) return `${formatEur(order.totalEur)} euro`;
  if (!ship) return money(order.total);
  if (ship.currency === "EUR") return `${money(subtotal)} + ${ship.amount} euro`;
  return money(Number(subtotal) + Number(ship.amount));
}

function shippingDetail(order) {
  const ship = order.shipping;
  if (!ship) return "";
  if (ship.currency === "EUR" && order.totalEur != null) {
    return `<br>Parfumet ${formatEur(order.subtotalEur)} euro + transporti ${esc(ship.amount)} euro<br>Kursi: 1 euro = ${formatEur(order.lekPerEur)} lek`;
  }
  return `<br>Transporti ${esc(ship.currency === "EUR" ? `${ship.amount} euro` : money(ship.amount))}`;
}

function when(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function showDesk(open) {
  gate.hidden = open;
  desk.hidden = !open;
  logout.hidden = !open;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token()) headers["X-Admin-Token"] = token();
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    showDesk(false);
  }
  if (!res.ok) throw new Error(data.error || "Kërkesa dështoi.");
  return data;
}

function renderMessages(items) {
  if (!items.length) {
    messagesEl.innerHTML = `<p class="empty">Nuk ka ende mesazhe ose kërkesa.</p>`;
    return;
  }
  messagesEl.innerHTML = `<div class="list">${items.map((item) => `
    <article class="record">
      <div class="record-top">
        <h3>${esc(item.name || "Pa emër")}</h3>
        <span class="when">${esc(when(item.createdAt))}</span>
      </div>
      <p class="quiet">${esc(item.email || "")}${item.phone ? ` · ${esc(item.phone)}` : ""}</p>
      <p class="message">${esc(item.message || "")}</p>
    </article>`).join("")}</div>`;
}

function renderOrders(items) {
  if (!items.length) {
    ordersEl.innerHTML = `<p class="empty">Nuk ka ende porosi.</p>`;
    return;
  }
  ordersEl.innerHTML = `<div class="list">${items.map((order) => {
    const lines = asList(order.items).map((item) => `${esc(item.name)} × ${esc(item.qty)}`).join("<br>");
    const customer = order.customer
      ? `${esc(order.customer.name)}<br>${esc(order.customer.phone)}<br>${esc(order.customer.email)}${
        order.customer.country ? `<br>${esc(order.customer.city || "")}, ${esc(order.customer.country)}` : ""
      }${shippingDetail(order)}`
      : "PayPal, pa të dhëna kontakti";
    const pay = order.paymentMethod === "cash" ? "Cash · Aktive" : "PayPal";
    return `
      <article class="record">
        <div class="record-top">
          <h3>${esc(order.id || "Porosi")}</h3>
          <span class="when">${esc(when(order.createdAt))}</span>
        </div>
        <p class="meta">
          <span class="tag">${esc(pay)}</span>
          <strong>${esc(dueText(order))}</strong>
        </p>
        <p>${lines}</p>
        <p class="quiet">${customer}</p>
      </article>`;
  }).join("")}</div>`;
}

async function loadInbox() {
  const data = await api("/api/admin/inbox");
  const messages = asList(data.messages);
  const orders = asList(data.orders);
  summaryEl.textContent = `${messages.length} mesazhe · ${orders.length} porosi`;
  renderMessages(messages);
  renderOrders(orders);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = new FormData(loginForm).get("code");
  loginNote.textContent = "";
  const button = loginForm.querySelector("button");
  button.disabled = true;
  try {
    const data = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Kodi nuk është i saktë.");
      return body;
    });
    sessionStorage.setItem(TOKEN_KEY, data.token);
    showDesk(true);
    await loadInbox();
  } catch (err) {
    loginNote.textContent = err.message || "Kodi nuk është i saktë.";
  } finally {
    button.disabled = false;
  }
});

logout.addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST" });
  } catch (err) {
    sessionStorage.removeItem(TOKEN_KEY);
  }
  sessionStorage.removeItem(TOKEN_KEY);
  showDesk(false);
});

document.getElementById("refresh").addEventListener("click", () => {
  loadInbox().catch((err) => {
    summaryEl.textContent = err.message || "Nuk u rifreskua.";
  });
});

async function init() {
  if (!token()) {
    showDesk(false);
    return;
  }
  try {
    await loadInbox();
    showDesk(true);
  } catch (err) {
    showDesk(false);
  }
}

init();
