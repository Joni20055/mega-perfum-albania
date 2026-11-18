const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const frontendDir = path.join(__dirname, "..", "frontend");
const dataDir = path.join(__dirname, "data");
const stockFile = path.join(dataDir, "stock.json");
const ordersFile = path.join(dataDir, "orders.json");
const messagesFile = path.join(dataDir, "messages.json");

const PRODUCTS = [
  {
    id: "myslf",
    brand: "Yves Saint Laurent",
    name: "MYSLF",
    concentration: "Eau de Parfum",
    size: "100 ml",
    audience: "Për burra",
    accords: ["Portokall", "Bergamotë", "Lule portokalli", "Ambroksan", "Patshuli", "Drurë"],
    nuance:
      "Hapja është e ndritshme, me portokall dhe bergamotë. Pastaj del lulja e portokallit, e butë dhe pak e ëmbël, mbi një bazë të pastër me ambroksan, patshuli dhe drurë. Ndihet modern, i pastër dhe i afërt me lëkurën, i përshtatshëm për ditën.",
    popularityLabel: "Shumë i popullarizuar",
    popularity:
      "Doli më 2023 dhe u bë shpejt një nga lancimet më të shitura të YSL. E kërkojnë sidomos meshkujt e rinj, si parfum i përditshëm që merr komplimente. Nuk është aq i përhapur sa Sauvage, por është një nga aromat më në modë të viteve të fundit.",
    price: 8000,
    oldPrice: 12000,
    stock: 3,
    image: "/images/myslf.jpg",
  },
  {
    id: "valentino-bir-intense",
    brand: "Valentino",
    name: "Uomo Born in Roma Intense",
    concentration: "Eau de Parfum",
    size: "100 ml",
    audience: "Për burra",
    accords: ["Vanilje", "Livando", "Drurë të ngrohtë"],
    nuance:
      "Vanilja priret, livandoja e mban aromatike dhe drurët e ngrohin. Është më e ëmbël dhe më e dendur se Born in Roma i zakonshëm, me një ndjenjë kremoze. Del më shumë në mbrëmje dhe në mot të freskët.",
    popularityLabel: "Shumë i kërkuar",
    popularity:
      "Linja Born in Roma është ndër më të shiturat e Valentino në Evropë. Versioni Intense ka një ndjekje të fortë te blerësit e rinj, sepse aroma e ëmbël me livando njihet lehtë dhe mbahet shpesh si nënshkrim.",
    price: 7500,
    oldPrice: 11500,
    stock: 3,
    image: "/images/valentino.jpg",
  },
  {
    id: "ysl-y-edp",
    brand: "Yves Saint Laurent",
    name: "Y",
    concentration: "Eau de Parfum",
    size: "100 ml",
    audience: "Për burra",
    accords: ["Mollë", "Xhenxhefil", "Bergamotë", "Sherbelë", "Dëllinjë", "Tonka", "Cedër"],
    nuance:
      "E freskët dhe aromatike, me një ëmbëlsi të butë. Molla dhe xhenxhefili e bëjnë të ndritshme, sherbelë dhe dëllinja japin anën barishtore, ndërsa tonka dhe cedra e lënë të ngrohtë. Është klasik i llojit blu: i qartë, mashkullor dhe i lehtë për t’u pëlqyer.",
    popularityLabel: "Ndër më të shiturit në botë",
    popularity:
      "Që nga viti 2018 është një nga parfumet më të shitura për burra, krah Sauvage. E njohin pothuajse kudo dhe mbetet zgjedhje e sigurt kur doni një aromë që u pëlqen shumë njerëzve.",
    price: 8000,
    oldPrice: 12000,
    stock: 3,
    image: "/images/ysl-y.jpg?v=3",
  },
  {
    id: "dior-sauvage-elixir",
    brand: "Dior",
    name: "Sauvage Elixir",
    concentration: "Elixir",
    size: "100 ml",
    audience: "Për burra",
    accords: ["Grejpfrut", "Kanellë", "Arrëmyshk", "Kardamom", "Livando", "Jamball", "Sandale"],
    nuance:
      "Agrumi është i thatë, erëzat e mbushin dhe livandoja është e thellë. Baza me jamball, qelibar, sandale dhe vetiver zgjat shumë dhe projekton fort. Ndihet më e rëndë dhe më luksoze se Sauvage i zakonshëm.",
    popularityLabel: "Jashtëzakonisht i popullarizuar",
    popularity:
      "Doli më 2021 dhe u bë një nga parfumet më të kërkuara të dekadës. Shpesh mbaron në dyqane. Brenda familjes Sauvage, Elixir është versioni më i lavdëruar për forcën dhe qëndrueshmërinë.",
    price: 10000,
    oldPrice: 20000,
    stock: 3,
    image: "/images/sauvage.jpg",
  },
];

const adminSessions = new Map();
const ADMIN_CODE = process.env.ADMIN_CODE || "";

function getProducts() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, "products.json"), "utf8"));
    if (Array.isArray(list) && list.length) return list;
  } catch (err) {
    console.error(err);
  }
  return PRODUCTS;
}

const letter = /\p{L}/u;
const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function makeId(prefix) {
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${time}-${random}`;
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureData() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(stockFile)) {
    writeJson(
      stockFile,
      Object.fromEntries(getProducts().map((product) => [product.id, product.stock]))
    );
  } else {
    const stock = readJson(stockFile);
    let changed = false;
    for (const product of getProducts()) {
      if (!Number.isInteger(stock[product.id]) || stock[product.id] < 0) {
        stock[product.id] = product.stock;
        changed = true;
      }
    }
    if (changed) writeJson(stockFile, stock);
  }
  if (!fs.existsSync(ordersFile)) writeJson(ordersFile, []);
  if (!fs.existsSync(messagesFile)) writeJson(messagesFile, []);
}

function catalog() {
  const stock = readJson(stockFile);
  return getProducts().map((product) => ({
    ...product,
    stock: Number.isInteger(stock[product.id]) ? stock[product.id] : 0,
  }));
}

function validPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

const app = express();
app.use(express.json({ limit: "100kb" }));

function roundEur(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function getEurQuote() {
  return Promise.resolve({ lekPerEur: 85, updated: "1 euro = 85 lek" });
}

app.get("/api/rate", async (req, res) => {
  try {
    const quote = await getEurQuote();
    res.json({ lekPerEur: quote.lekPerEur, updated: quote.updated });
  } catch (err) {
    res.status(503).json({ error: "Çmimi në euro nuk u përgatit. Provo përsëri." });
  }
});

app.get("/api/products", (req, res) => {
  try {
    res.json(catalog());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Produktet nuk u lexuan." });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const body = req.body || {};
    const paymentMethod = body.paymentMethod === "cash" ? "cash" : "";
    if (!paymentMethod) {
      return res.status(400).json({ error: "Pagesa bëhet cash, në dorëzim." });
    }

    const incoming = Array.isArray(body.items) ? body.items : [];
    if (!incoming.length || incoming.length > 20) {
      return res.status(400).json({ error: "Porosia nuk është e vlefshme." });
    }

    const merged = new Map();
    for (const item of incoming) {
      const qty = Number(item && item.qty);
      const id = item && String(item.id || "");
      if (!id || !Number.isInteger(qty) || qty < 1 || qty > 10) {
        return res.status(400).json({ error: "Sasia nuk është e vlefshme." });
      }
      const next = (merged.get(id) || 0) + qty;
      if (next > 10) return res.status(400).json({ error: "Sasia nuk është e vlefshme." });
      merged.set(id, next);
    }

    let customer = null;
    if (paymentMethod === "cash") {
      const person = body.customer || {};
      const firstName = cleanText(person.firstName, 40);
      const lastName = cleanText(person.lastName, 40);
      const phone = cleanText(person.phone, 30);
      const email = cleanText(person.email, 120);
      if (firstName.length < 2 || !letter.test(firstName)) {
        return res.status(400).json({ error: "Shkruani emrin." });
      }
      if (lastName.length < 2 || !letter.test(lastName)) {
        return res.status(400).json({ error: "Shkruani mbiemrin." });
      }
      const name = cleanText(`${firstName} ${lastName}`, 80);
      if (!emailOk.test(email)) {
        return res.status(400).json({ error: "Shkruani një email të vlefshëm." });
      }
      if (!validPhone(phone)) {
        return res.status(400).json({ error: "Shkruani një numër telefoni të vlefshëm." });
      }
      const country = cleanText(person.country, 20);
      const city = cleanText(person.city, 60);
      if (country !== "Kosovë" && country !== "Shqipëri") {
        return res.status(400).json({ error: "Zgjidhni Kosovën ose Shqipërinë." });
      }
      if (city.length < 2 || !letter.test(city)) {
        return res.status(400).json({ error: "Zgjidhni qytetin ku ndodheni." });
      }
      customer = { name, phone, email, country, city };
    }

    const stock = readJson(stockFile);
    const items = [];
    for (const [id, qty] of merged) {
      const product = getProducts().find((entry) => entry.id === id);
      if (!product) return res.status(400).json({ error: "Produkti nuk është i vlefshëm." });
      const left = stock[id] || 0;
      if (left < qty) {
        const message = left < 1
          ? `${product.brand} ${product.name} ka mbaruar.`
          : `Ka vetëm ${left} copë për ${product.brand} ${product.name}.`;
        return res.status(409).json({ error: message });
      }
      items.push({
        id: product.id,
        name: `${product.brand} ${product.name}`,
        concentration: product.concentration,
        size: product.size,
        qty,
        price: product.price,
      });
    }

    const orders = readJson(ordersFile);
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    let shipping = null;
    let total = subtotal;
    let lekPerEur = null;
    let rateUpdated = null;
    let subtotalEur = null;
    let totalEur = null;
    if (paymentMethod === "cash" && customer) {
      if (customer.country === "Kosovë") {
        const quote = await getEurQuote();
        lekPerEur = quote.lekPerEur;
        rateUpdated = quote.updated;
        subtotalEur = roundEur(subtotal / lekPerEur);
        shipping = { amount: 5, currency: "EUR" };
        totalEur = roundEur(subtotalEur + shipping.amount);
      } else {
        shipping = { amount: 300, currency: "ALL" };
        total = subtotal + 300;
      }
    }
    for (const item of items) stock[item.id] -= item.qty;
    const order = {
      id: makeId("PF"),
      items,
      subtotal,
      shipping,
      lekPerEur,
      rateUpdated,
      subtotalEur,
      totalEur,
      total,
      paymentMethod,
      customer,
      status: "aktive",
      createdAt: new Date().toISOString(),
    };
    orders.push(order);
    writeJson(stockFile, stock);
    writeJson(ordersFile, orders);

    res.json({
      ok: true,
      order: {
        ...order,
      },
    });
  } catch (err) {
    console.error(err);
    const message = err && String(err.message || "").includes("euro")
      ? "Çmimi në euro nuk u përgatit. Provo përsëri."
      : "Porosia nuk u ruajt.";
    res.status(message.startsWith("Çmimi") ? 503 : 500).json({ error: message });
  }
});

app.post("/api/contact", (req, res) => {
  try {
    const body = req.body || {};
    const name = cleanText(body.name, 80);
    const email = cleanText(body.email, 120);
    const phone = cleanText(body.phone, 30);
    const message = cleanText(body.message, 1000);
    if (name.length < 2 || !letter.test(name)) {
      return res.status(400).json({ error: "Shkruani emrin." });
    }
    if (!emailOk.test(email)) {
      return res.status(400).json({ error: "Shkruani një email të vlefshëm." });
    }
    if (phone && !validPhone(phone)) {
      return res.status(400).json({ error: "Shkruani një numër telefoni të vlefshëm." });
    }
    if (message.length < 5) {
      return res.status(400).json({ error: "Shkruani një mesazh." });
    }

    const messages = readJson(messagesFile);
    messages.push({
      id: makeId("MS"),
      name,
      email,
      phone,
      message,
      createdAt: new Date().toISOString(),
    });
    writeJson(messagesFile, messages);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Mesazhi nuk u ruajt." });
  }
});

app.get("/health", (req, res) => {
  res.status(200).type("text/plain").send("ok");
});

app.post("/api/admin/login", (req, res) => {
  const code = cleanText(req.body && req.body.code, 40);
  if (!ADMIN_CODE || code !== ADMIN_CODE) {
    return res.status(401).json({ error: "Kodi nuk është i saktë." });
  }
  const token = crypto.randomBytes(24).toString("hex");
  adminSessions.set(token, Date.now());
  res.json({ ok: true, token });
});

app.post("/api/admin/logout", (req, res) => {
  const token = String(req.get("X-Admin-Token") || "").trim();
  adminSessions.delete(token);
  res.json({ ok: true });
});

app.get("/api/admin/inbox", (req, res) => {
  const token = String(req.get("X-Admin-Token") || "").trim();
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: "Hyrja nuk është e vlefshme." });
  }
  const byNewest = (list) => list.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  try {
    res.json({
      orders: byNewest(readJson(ordersFile)),
      messages: byNewest(readJson(messagesFile)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Të dhënat nuk u lexuan." });
  }
});

app.get(["/admin", "/admin/"], (req, res) => {
  res.sendFile(path.join(frontendDir, "admin.html"));
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Nuk u gjet." });
});

app.use(express.static(frontendDir));

app.use((req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(404).send("Nuk u gjet.");
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: "Kërkesa nuk u lexua." });
});

ensureData();

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Parfume është hapur te http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Porti ${PORT} është i zënë. Mbylleni programin tjetër ose nisni me një PORT tjetër.`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
