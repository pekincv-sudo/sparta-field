"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

async function runBuyerUITests(projectDirectory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(projectDirectory, "buyer-ui.js"), "utf8");
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const checks = [];
  const account = (id = "buyer-a", companyId = "company-a") => ({ id, companyId, companyName: "SPARTA", name: `Покупець ${id}`, email: `${id}@example.invalid`, phone: "+380500000000", isActive: true });
  const item = (id = "panel", extra = {}) => ({ id, name: "Панель <script>alert(1)</script>", sku: "PV-1", category: "Фотомодулі", brand: "Brand", model: "Model", unit: "шт", currency: "USD", price: 12.5, availableQty: 5, ...extra });
  const order = (extra = {}) => ({ id: "order-a", number: "ЗМ-001", buyerId: "buyer-a", buyerName: "Покупець A", companyId: "company-a", status: "submitted", currency: "USD", total: 16, createdAt: "2026-10-26T10:00:00Z", updatedAt: "2026-10-26T10:00:00Z", deliveryMethod: "pickup", phone: "+380500000000", address: "", comment: "<img src=x onerror=alert(2)>", lines: [{ itemId: "panel", sku: "OLD", name: "Історична панель", unit: "шт", qty: 2, unitPrice: 8, currency: "USD", lineTotal: 16 }], ...extra });
  class Surface {
    constructor() { this.innerHTML = ""; this.listeners = new Map(); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    removeEventListener(type, callback) { if (this.listeners.get(type) === callback) this.listeners.delete(type); }
    querySelector() { return null; }
    dispatch(type, dataset = {}, values = {}) {
      const element = { dataset, value: "", checked: false, disabled: false, type: "text", ...values };
      element.closest = (selector) => {
        const match = selector.match(/^\[data-bp-([\w-]+)\]$/);
        if (!match) return null;
        const key = "bp" + match[1].split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
        return Object.hasOwn(dataset, key) ? element : null;
      };
      this.listeners.get(type)?.({ target: element, preventDefault() {} });
    }
  }
  async function settle() { for (let index = 0; index < 10; index += 1) await new Promise((resolve) => setImmediate(resolve)); }
  function setup(options = {}) {
    const calls = { catalog: [], orders: [], submit: [], cancel: [], action: [], save: [], send: [], unlinked: 0, link: [], buyers: 0, salesOrders: 0, signOut: 0, password: 0, select: [] };
    const context = { audience: "buyer", role: "", companyId: "company-a", buyerId: "buyer-a", accounts: [account()], userId: "user-a", companyName: "SPARTA", ...options.context };
    const data = { items: [item()], orders: [], buyers: [account()], documents: [], ...options.data };
    const hooks = {};
    const cloud = {
      getContext() { return hooks.context ? hooks.context() : clone(context); },
      async catalog(id) { calls.catalog.push(id); if (hooks.catalog) return hooks.catalog(id); return clone({ buyer: context.accounts.find((entry) => entry.id === id) || account(id), items: data.items }); },
      async orders(id) { calls.orders.push(id); if (hooks.orders) return hooks.orders(id); return clone({ orders: data.orders }); },
      async submitOrder(input) { calls.submit.push(clone(input)); if (hooks.submit) return hooks.submit(input); return { order: order({ total: input.expectedTotal, lines: [{ ...order().lines[0], qty: input.lines[0].qty, unitPrice: 12.5, lineTotal: input.expectedTotal }] }) }; },
      async cancelOrder(input) { calls.cancel.push(clone(input)); if (hooks.cancel) return hooks.cancel(input); return { order: order({ status: "cancelled" }) }; },
      async buyers() { calls.buyers += 1; if (hooks.buyers) return hooks.buyers(); return clone({ buyers: data.buyers }); },
      async salesOrders() { calls.salesOrders += 1; return clone({ orders: data.orders }); },
      async saveBuyer(input) { calls.save.push(clone(input)); if (hooks.save) return hooks.save(input); return { buyer: account(input.id || "buyer-new"), invitation: { id: "invite-new", status: "pending" } }; },
      async orderAction(input) { calls.action.push(clone(input)); if (hooks.action) return hooks.action(input); return { order: order({ id: input.orderId, status: { confirm: "confirmed", ready: "ready", fulfil: "completed", cancel: "cancelled" }[input.action] }) }; },
      async sendAccess(invitation, email) { calls.send.push({ invitation: clone(invitation), email }); if (hooks.send) return hooks.send(); return { success: true }; },
      async unlinkedSales() { calls.unlinked += 1; if (hooks.unlinked) return hooks.unlinked(); return clone({ documents: data.documents }); },
      async linkPurchase(payload) { calls.link.push(clone(payload)); if (hooks.link) return hooks.link(payload); return { order: order({ id: "linked-order", buyerId: payload.buyerId, status: "completed" }) }; },
      selectAccount(id) { calls.select.push(id); context.buyerId = id; context.companyId = context.accounts.find((entry) => entry.id === id).companyId; },
      async signOut() { calls.signOut += 1; },
      changePassword() { calls.password += 1; },
    };
    const scope = { window: { SpartaBuyerCloud: cloud, crypto }, Intl, Date, console };
    vm.createContext(scope);
    vm.runInContext(source, scope, { filename: "buyer-ui.js" });
    const surface = new Surface();
    return { ui: scope.window.SpartaBuyerUI, surface, context, data, calls, hooks, cloud, scope };
  }
  const click = async (fixture, action, id = "", extras = {}) => { fixture.surface.dispatch("click", { bpAction: action, bpId: id, ...extras }); await settle(); };
  const tab = async (fixture, name) => { fixture.surface.dispatch("click", { bpTab: name }); await settle(); };
  const input = (fixture, dataset, value, extra = {}) => fixture.surface.dispatch("input", dataset, { value, ...extra });
  const submit = async (fixture, name = "checkout") => { fixture.surface.dispatch("submit", { bpForm: name }); await settle(); };
  const actionButton = (html, action, id) => [...html.matchAll(/<button\b[^>]*>[^]*?<\/button>/g)].map((match) => match[0]).find((tag) => tag.includes(`data-bp-action="${action}"`) && (!id || tag.includes(`data-bp-id="${id}"`)));
  const check = async (name, callback) => { await callback(); checks.push(name); };

  await check("Actual module renders escaped safe catalog with installer prices only and no seeded or private fields", async () => {
    const f = setup({ data: { items: [item("panel", { purchasePrice: 93201, supplier: "PRIVATE-SUPPLIER", retailPrice: 88888 }), item("unpriced", { name: "Без ціни", price: null, retailPrice: 77777 }), item("zero", { price: 0 })] } });
    await f.ui.renderBuyer(f.surface);
    assert.match(f.surface.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(f.surface.innerHTML, /<script>|PRIVATE-SUPPLIER|93201|88888|77777|purchasePrice|retailPrice|supplier/);
    assert.match(actionButton(f.surface.innerHTML, "add", "unpriced"), /disabled/);
    assert.match(actionButton(f.surface.innerHTML, "add", "zero"), /disabled/);
    await click(f, "add", "unpriced");
    await tab(f, "cart");
    assert.match(f.surface.innerHTML, /Кошик порожній/);
    assert.equal(f.calls.submit.length, 0);
    assert.deepEqual(Object.keys(f.ui).sort(), ["refreshBuyer", "renderBuyer", "renderSales", "reset"]);
    assert.equal(f.scope.window.localStorage, undefined);
  });

  await check("Cart enforces stock, integer units, three decimals, one currency and positive price before provider submit", async () => {
    const f = setup({ data: { items: [item(), item("uah", { currency: "UAH" }), item("cable", { unit: "м", price: 4, availableQty: 10 })] } });
    await f.ui.renderBuyer(f.surface);
    await click(f, "add", "panel");
    await click(f, "add", "uah");
    assert.match(f.surface.innerHTML, /лише одна валюта/);
    await tab(f, "cart");
    for (const bad of ["0", "-1", "6", "1.2", "NaN"]) { input(f, { bpQty: "panel" }, bad); await submit(f); }
    assert.equal(f.calls.submit.length, 0);
    input(f, { bpQty: "panel" }, "2");
    await submit(f);
    assert.equal(f.calls.submit.length, 1);
    assert.deepEqual(f.calls.submit[0].lines, [{ itemId: "panel", qty: 2 }]);
    assert.equal(f.calls.submit[0].expectedTotal, 25);
    assert.ok(f.calls.submit[0].requestId.match(/^[\da-f-]{36}$/));
    assert.equal(f.calls.submit[0].buyerId, "buyer-a");
    assert.deepEqual(Object.keys(f.calls.submit[0].lines[0]).sort(), ["itemId", "qty"]);
    await click(f, "add", "cable");
    await tab(f, "cart");
    input(f, { bpQty: "cable" }, "1.0001"); await submit(f);
    assert.equal(f.calls.submit.length, 1);
    input(f, { bpQty: "cable" }, "1.125"); await submit(f);
    assert.equal(f.calls.submit.length, 2);
    assert.equal(f.calls.submit[1].expectedTotal, 4.5);
  });

  await check("Expected total uses decimal cent rounding for fractional quantities", async () => {
    const f = setup({ data: { items: [item("panel", { unit: "м", price: 0.01 })] } });
    await f.ui.renderBuyer(f.surface); await click(f, "add", "panel"); await tab(f, "cart");
    input(f, { bpQty: "panel" }, "0.5"); await submit(f);
    assert.equal(f.calls.submit[0].expectedTotal, 0.01);
  });

  await check("Unknown submit response freezes payload and request ID; retry acknowledges same order and then clears cart", async () => {
    const f = setup();
    let lost = true;
    f.hooks.submit = (payload) => { if (lost) { lost = false; throw new Error("З’єднання перервано"); } return { order: order({ total: payload.expectedTotal }) }; };
    await f.ui.renderBuyer(f.surface); await click(f, "add", "panel"); await tab(f, "cart");
    await submit(f);
    assert.match(f.surface.innerHTML, /Повторити надсилання/);
    assert.match(f.surface.innerHTML, /data-bp-qty="panel"[^>]*disabled/);
    input(f, { bpQty: "panel" }, "3");
    input(f, { bpDelivery: "phone" }, "+380999999999");
    await click(f, "clear-cart");
    await submit(f);
    assert.equal(f.calls.submit.length, 2);
    assert.deepEqual(f.calls.submit[1], f.calls.submit[0]);
    assert.match(f.surface.innerHTML, /Замовлення надіслано/);
    await tab(f, "cart"); assert.match(f.surface.innerHTML, /Кошик порожній/);
  });

  await check("Definitive price rejection keeps cart, refreshes catalog and allows a reviewed new request", async () => {
    const f = setup();
    let reject = true;
    f.hooks.submit = (payload) => { if (reject) { reject = false; f.data.items[0].price = 20; throw Object.assign(new Error("Ціни змінилися"), { code: "P0001", definitive: true }); } return { order: order({ total: payload.expectedTotal }) }; };
    await f.ui.renderBuyer(f.surface); await click(f, "add", "panel"); await tab(f, "cart"); await submit(f);
    assert.match(f.surface.innerHTML, /Ціни змінилися/);
    assert.doesNotMatch(f.surface.innerHTML, /Повторити надсилання/);
    await submit(f); assert.equal(f.calls.submit.length, 1);
    await click(f, "review-prices");
    await submit(f);
    assert.notEqual(f.calls.submit[0].requestId, f.calls.submit[1].requestId);
    assert.equal(f.calls.submit[1].expectedTotal, 20);
  });

  await check("Historical snapshots retain old names and prices; repeat refreshes current catalog and checks current stock", async () => {
    const f = setup({ data: { orders: [order({ status: "completed" })] } });
    await f.ui.renderBuyer(f.surface); await tab(f, "history");
    assert.match(f.surface.innerHTML, /Історична панель/);
    assert.match(f.surface.innerHTML, /8,00 USD/);
    assert.doesNotMatch(f.surface.innerHTML, /12,50 USD|<img/);
    f.data.items[0].price = 20; f.data.items[0].availableQty = 1;
    await click(f, "repeat", "order-a");
    assert.equal(f.calls.catalog.length, 2);
    assert.match(f.surface.innerHTML, /20,00 USD/);
    assert.match(f.surface.innerHTML, /data-bp-qty="panel"[^>]*value="1"/);
    assert.match(f.surface.innerHTML, /обмежено залишком/);
    await tab(f, "history");
    assert.match(f.surface.innerHTML, /8,00 USD/);
    assert.doesNotMatch(f.surface.innerHTML, /20,00 USD/);
  });

  await check("Crossbuyer and crosscompany results are excluded and failed identity changes remove old private content and cart", async () => {
    const f = setup({ data: { orders: [order(), order({ id: "other", buyerId: "buyer-b", number: "SECRET-ORDER" })] } });
    await f.ui.renderBuyer(f.surface); await click(f, "add", "panel"); await tab(f, "orders");
    assert.doesNotMatch(f.surface.innerHTML, /SECRET-ORDER/);
    f.context.userId = "user-b"; f.context.buyerId = "buyer-b"; f.context.accounts = [account("buyer-b")];
    f.hooks.catalog = () => { throw new Error("Немає мережі"); };
    await f.ui.renderBuyer(f.surface);
    assert.doesNotMatch(f.surface.innerHTML, /Історична панель|ЗМ-001|Панель|Кошик · 1/);
    f.hooks.catalog = null;
    await f.ui.renderBuyer(f.surface); await tab(f, "cart");
    assert.match(f.surface.innerHTML, /Кошик порожній/);
  });

  await check("Stale async reads cannot paint data after reset or a different authenticated buyer", async () => {
    const f = setup();
    let finish;
    f.hooks.catalog = () => new Promise((resolve) => { finish = resolve; });
    const stale = f.ui.renderBuyer(f.surface); await settle();
    f.ui.reset();
    assert.equal(f.surface.innerHTML, "");
    f.context.userId = "user-b"; f.context.buyerId = "buyer-b"; f.context.accounts = [account("buyer-b")];
    f.data.items = [item("new", { name: "Новий покупець" })];
    f.hooks.catalog = null;
    await f.ui.renderBuyer(f.surface);
    finish({ buyer: account(), items: [item("old", { name: "SECRET-OLD" })] }); await stale;
    assert.match(f.surface.innerHTML, /Новий покупець/);
    assert.doesNotMatch(f.surface.innerHTML, /SECRET-OLD/);
  });

  await check("Context recheck blocks mutations after auth changes, access denial clears private UI", async () => {
    const f = setup();
    await f.ui.renderBuyer(f.surface); await click(f, "add", "panel"); await tab(f, "cart");
    f.context.userId = "replacement";
    await submit(f);
    assert.equal(f.calls.submit.length, 0);
    assert.doesNotMatch(f.surface.innerHTML, /data-bp-qty|PV-1/);
    await f.ui.renderBuyer(f.surface); await click(f, "add", "panel"); await tab(f, "cart");
    f.hooks.submit = () => { throw Object.assign(new Error("Доступ призупинено"), { code: "42501", definitive: true }); };
    await submit(f);
    assert.doesNotMatch(f.surface.innerHTML, /data-bp-qty|PV-1/);
  });

  await check("Transient context lookup hides sensitive UI and preserves ambiguous request for the same reverified identity", async () => {
    const f = setup();
    let attempt = 0;
    f.hooks.submit = () => { attempt += 1; if (attempt === 1) throw new Error("Таймаут"); return { order: order() }; };
    await f.ui.renderBuyer(f.surface); await click(f, "add", "panel"); await tab(f, "cart"); await submit(f);
    f.hooks.context = () => { throw new Error("Немає зв’язку"); };
    await submit(f);
    assert.doesNotMatch(f.surface.innerHTML, /PV-1|data-bp-qty/);
    f.hooks.context = null;
    await click(f, "reload"); await tab(f, "cart"); await submit(f);
    assert.equal(f.calls.submit.length, 2);
    assert.deepEqual(f.calls.submit[0], f.calls.submit[1]);
  });

  await check("Account selection clears crossaccount cart and invokes provider selection; password and signout stay available", async () => {
    const f = setup({ context: { accounts: [account(), account("buyer-b", "company-b")] } });
    await f.ui.renderBuyer(f.surface); await click(f, "add", "panel");
    f.surface.dispatch("change", { bpField: "account" }, { value: "buyer-b" }); await settle();
    assert.deepEqual(f.calls.select, ["buyer-b"]);
    assert.equal(f.calls.catalog.at(-1), "buyer-b");
    await tab(f, "cart"); assert.match(f.surface.innerHTML, /Кошик порожній/);
    await click(f, "password"); assert.equal(f.calls.password, 1);
    await click(f, "sign-out"); assert.equal(f.calls.signOut, 1); assert.equal(f.surface.innerHTML, "");
  });

  await check("Staff manager and warehouse actions are gated by role and status even for forged DOM events", async () => {
    for (const role of ["owner", "admin", "engineer", "warehouse", "installer", "viewer"]) {
      const f = setup({ context: { audience: "staff", role, buyerId: "", accounts: [] }, data: { orders: [order({ id: "submitted" }), order({ id: "confirmed", status: "confirmed" }), order({ id: "ready", status: "ready" }), order({ id: "foreign", companyId: "company-b", number: "SECRET-COMPANY" })] } });
      await f.ui.renderSales(f.surface);
      assert.doesNotMatch(f.surface.innerHTML, /SECRET-COMPANY/);
      const allowed = ["owner", "admin", "engineer", "warehouse"].includes(role);
      assert.equal(f.calls.salesOrders, allowed ? 1 : 0);
      assert.equal(f.surface.innerHTML.includes('data-bp-order-action="confirm"'), ["owner", "admin", "engineer"].includes(role));
      assert.equal(f.surface.innerHTML.includes('data-bp-order-action="fulfil"'), ["owner", "admin", "warehouse"].includes(role));
      await tab(f, "buyers");
      assert.equal(f.surface.innerHTML.includes('data-bp-action="new-buyer"'), ["owner", "admin"].includes(role));
      await click(f, "new-buyer");
      assert.equal(f.surface.innerHTML.includes('data-bp-form="buyer"'), ["owner", "admin"].includes(role));
      if (role === "warehouse") {
        await click(f, "order-action", "submitted", { bpOrderAction: "confirm" });
        assert.equal(f.calls.action.length, 0);
        await click(f, "order-action", "ready", { bpOrderAction: "fulfil" });
        assert.equal(f.calls.action.length, 1);
      }
      if (role === "engineer") {
        await click(f, "order-action", "ready", { bpOrderAction: "fulfil" });
        assert.equal(f.calls.action.length, 0);
      }
    }
  });

  await check("Failed staff action and buyer cancellation retry with stable operation IDs", async () => {
    const f = setup({ context: { audience: "staff", role: "engineer", buyerId: "", accounts: [] }, data: { orders: [order()] } });
    let first = true;
    f.hooks.action = () => { if (first) { first = false; throw new Error("Таймаут"); } return { order: order({ status: "confirmed" }) }; };
    await f.ui.renderSales(f.surface);
    await click(f, "order-action", "order-a", { bpOrderAction: "confirm" });
    await click(f, "order-action", "order-a", { bpOrderAction: "confirm" });
    assert.deepEqual(f.calls.action[0], f.calls.action[1]);
    const b = setup({ data: { orders: [order(), order({ id: "done", status: "completed" })] } });
    let cancelFirst = true;
    b.hooks.cancel = () => { if (cancelFirst) { cancelFirst = false; throw new Error("Таймаут"); } return { order: order({ status: "cancelled" }) }; };
    await b.ui.renderBuyer(b.surface); await tab(b, "orders");
    await click(b, "buyer-cancel", "done"); assert.equal(b.calls.cancel.length, 0);
    await click(b, "buyer-cancel", "order-a"); await click(b, "buyer-cancel", "order-a");
    assert.deepEqual(b.calls.cancel[0], b.calls.cancel[1]);
    assert.match(b.surface.innerHTML, /Скасовано/);
  });

  await check("Buyer access mail remains an explicit owner/admin action and failures are visible", async () => {
    const f = setup({ context: { audience: "staff", role: "owner", buyerId: "", accounts: [] } });
    await f.ui.renderSales(f.surface); await tab(f, "buyers");
    await click(f, "new-buyer");
    input(f, { bpEditor: "name" }, "Постійний покупець");
    input(f, { bpEditor: "email" }, "buyer@example.invalid");
    input(f, { bpEditor: "phone" }, "+380500000001");
    await submit(f, "buyer");
    assert.equal(f.calls.save.length, 1);
    assert.equal(f.calls.send.length, 0);
    f.hooks.send = () => { throw new Error("Лист не надіслано"); };
    await click(f, "send-access", "buyer-a");
    assert.equal(f.calls.send.length, 1);
    assert.equal(f.calls.send[0].invitation.id, "invite-new");
    assert.match(f.surface.innerHTML, /Лист не надіслано/);
    assert.match(f.surface.innerHTML, /data-bp-action="send-access"/);
    const low = setup({ context: { audience: "staff", role: "warehouse", buyerId: "", accounts: [] } });
    await low.ui.renderSales(low.surface); await click(low, "send-access", "buyer-a");
    assert.equal(low.calls.send.length, 0); assert.equal(low.calls.save.length, 0);
  });

  await check("Busy mutations reject duplicate clicks before promise completion", async () => {
    const f = setup();
    let finish;
    f.hooks.submit = () => new Promise((resolve) => { finish = resolve; });
    await f.ui.renderBuyer(f.surface); await click(f, "add", "panel"); await tab(f, "cart");
    f.surface.dispatch("submit", { bpForm: "checkout" }); await settle();
    f.surface.dispatch("submit", { bpForm: "checkout" }); await settle();
    assert.equal(f.calls.submit.length, 1);
    assert.match(f.surface.innerHTML, /aria-busy="true"/);
    finish({ order: order() }); await settle();
    assert.match(f.surface.innerHTML, /Замовлення надіслано/);
  });

  await check("Accepted buyer access hides invite mail, retains contact editing and directs password recovery to public login", async () => {
    const f = setup({ context: { audience: "staff", role: "owner", buyerId: "", accounts: [] }, data: { buyers: [{ ...account(), invitation: { id: "accepted-invite", status: "accepted" } }, { ...account("pending"), invitation: { id: "pending-invite", status: "pending" } }, { ...account("expired"), invitation: { id: "expired-invite", status: "expired" } }] } });
    await f.ui.renderSales(f.surface); await tab(f, "buyers");
    assert.equal(actionButton(f.surface.innerHTML, "send-access", "buyer-a"), undefined);
    assert.ok(actionButton(f.surface.innerHTML, "edit-buyer", "buyer-a"));
    assert.ok(actionButton(f.surface.innerHTML, "send-access", "pending"));
    assert.ok(actionButton(f.surface.innerHTML, "send-access", "expired"));
    assert.match(f.surface.innerHTML, /Доступ активний/);
    assert.match(f.surface.innerHTML, /Забули пароль/);
    await click(f, "send-access", "buyer-a");
    assert.equal(f.calls.save.length, 0);
    assert.equal(f.calls.send.length, 0);
  });

  await check("Buyer availability refresh preserves cart, requires changed-price review and skips staff/reset/ambiguous request", async () => {
    const f = setup();
    await f.ui.renderBuyer(f.surface); await click(f, "add", "panel"); await tab(f, "cart");
    input(f, { bpQty: "panel" }, "2");
    f.data.items[0].price = 20; f.data.items[0].availableQty = 4;
    assert.equal(await f.ui.refreshBuyer(), true);
    assert.match(f.surface.innerHTML, /Наявність оновлено/);
    assert.match(f.surface.innerHTML, /data-bp-qty="panel"[^>]*value="2"/);
    assert.match(f.surface.innerHTML, /40,00 USD/);
    assert.match(f.surface.innerHTML, /Підтверджую актуальні ціни/);
    await submit(f); assert.equal(f.calls.submit.length, 0);
    await click(f, "review-prices");
    f.hooks.submit = () => { throw new Error("Немає відповіді"); };
    await submit(f);
    const reads = f.calls.catalog.length;
    f.data.items[0].price = 25;
    assert.equal(await f.ui.refreshBuyer(), false);
    assert.equal(f.calls.catalog.length, reads);
    assert.match(f.surface.innerHTML, /40,00 USD/);
    assert.doesNotMatch(f.surface.innerHTML, /50,00 USD/);
    f.ui.reset(); assert.equal(await f.ui.refreshBuyer(), false);
    const staff = setup({ context: { audience: "staff", role: "owner", buyerId: "", accounts: [] } });
    await staff.ui.renderSales(staff.surface);
    assert.equal(await staff.ui.refreshBuyer(), false);
    assert.equal(staff.calls.catalog.length, 0);
  });

  await check("Availability refresh does not interrupt focused form input or overwrite a mutation started in flight", async () => {
    const f = setup();
    await f.ui.renderBuyer(f.surface); await click(f, "add", "panel"); await tab(f, "cart");
    f.scope.document = { activeElement: { tagName: "INPUT" } };
    f.surface.contains = () => true;
    assert.equal(await f.ui.refreshBuyer(), false);
    assert.equal(f.calls.catalog.length, 1);
    f.scope.document.activeElement = null;
    let finish;
    f.hooks.catalog = () => new Promise((resolve) => { finish = resolve; });
    const refreshing = f.ui.refreshBuyer(); await settle();
    f.hooks.submit = () => { throw new Error("Немає відповіді"); };
    await submit(f);
    finish({ buyer: account(), items: [item("panel", { price: 100 })] });
    assert.equal(await refreshing, false);
    assert.match(f.surface.innerHTML, /12,50 USD/);
    assert.doesNotMatch(f.surface.innerHTML, /100,00 USD/);
  });

  await check("Historical sale linking is explicit, lazy and restricted to owner/admin/warehouse", async () => {
    for (const role of ["owner", "admin", "warehouse", "engineer"]) {
      const f = setup({ context: { audience: "staff", role, buyerId: "", accounts: [] }, data: { documents: [{ id: "sale-one", number: "ПР-1", date: "2026-10-20", customer: "<script>unsafe</script>", currency: "USD", total: 16, purchasePrice: 998877, supplier: "PRIVATE-SUPPLIER" }] } });
      await f.ui.renderSales(f.surface); await tab(f, "buyers");
      assert.equal(f.calls.unlinked, 0);
      assert.equal(Boolean(actionButton(f.surface.innerHTML, "link-purchase", "buyer-a")), role !== "engineer");
      await click(f, "link-purchase", "buyer-a");
      if (role === "engineer") { assert.equal(f.calls.unlinked, 0); await submit(f, "link-purchase"); assert.equal(f.calls.link.length, 0); continue; }
      assert.equal(f.calls.unlinked, 1);
      assert.match(f.surface.innerHTML, /Прив’язка додає покупку в історію; товар повторно не списується/);
      assert.match(f.surface.innerHTML, /&lt;script&gt;unsafe&lt;\/script&gt;/);
      assert.doesNotMatch(f.surface.innerHTML, /<script>|998877|PRIVATE-SUPPLIER/);
      await submit(f, "link-purchase"); assert.equal(f.calls.link.length, 0, "No automatic matching or default sale selection");
      f.surface.dispatch("change", { bpLink: "documentId" }, { value: "sale-one" }); await settle();
      await submit(f, "link-purchase");
      assert.equal(f.calls.link.length, 1);
      assert.deepEqual(Object.keys(f.calls.link[0]).sort(), ["buyerId", "documentId", "requestId"]);
      assert.equal(f.calls.link[0].buyerId, "buyer-a");
      assert.equal(f.calls.link[0].documentId, "sale-one");
      assert.match(f.surface.innerHTML, /Товар повторно не списувався/);
      await tab(f, "orders");
      f.surface.dispatch("change", { bpField: "orderFilter" }, { value: "completed" }); await settle();
      assert.match(f.surface.innerHTML, /Історична панель/);
      assert.match(f.surface.innerHTML, /8,00 USD/);
    }
  });

  await check("Ambiguous historical link retry freezes explicit buyer/document and preserves UUID without replay fields", async () => {
    const f = setup({ context: { audience: "staff", role: "warehouse", buyerId: "", accounts: [] }, data: { buyers: [account(), account("buyer-b")], documents: [{ id: "sale-one", number: "ПР-1", currency: "USD", total: 16 }, { id: "sale-two", number: "ПР-2", currency: "USD", total: 20 }] } });
    let lost = true;
    f.hooks.link = (payload) => { if (lost) { lost = false; throw new Error("Відповідь втрачено"); } return { order: order({ id: "linked-order", buyerId: payload.buyerId, status: "completed" }) }; };
    await f.ui.renderSales(f.surface); await tab(f, "buyers"); await click(f, "link-purchase", "buyer-a");
    f.surface.dispatch("change", { bpLink: "documentId" }, { value: "sale-one" }); await settle();
    await submit(f, "link-purchase");
    assert.match(f.surface.innerHTML, /Повторити прив’язку/);
    assert.match(f.surface.innerHTML, /data-bp-link="buyerId"[^>]*disabled/);
    f.surface.dispatch("change", { bpLink: "buyerId" }, { value: "buyer-b" });
    f.surface.dispatch("change", { bpLink: "documentId" }, { value: "sale-two" });
    await click(f, "close-link");
    await submit(f, "link-purchase");
    assert.equal(f.calls.link.length, 2);
    assert.deepEqual(f.calls.link[0], f.calls.link[1]);
    assert.match(f.surface.innerHTML, /Продаж додано до історії/);
    assert.equal(f.calls.action.length, 0, "Linking never invokes stock fulfilment");
    assert.equal(f.calls.submit.length, 0, "Linking never resubmits a buyer order");
  });

  await check("Historical link list failures are retryable and forged selections or changed identities cannot link", async () => {
    const f = setup({ context: { audience: "staff", role: "owner", buyerId: "", accounts: [] }, data: { documents: [{ id: "sale-one", number: "ПР-1", currency: "USD", total: 16 }] } });
    f.hooks.unlinked = () => { throw new Error("Не вдалося завантажити продажі"); };
    await f.ui.renderSales(f.surface); await tab(f, "buyers"); await click(f, "link-purchase", "buyer-a");
    assert.match(f.surface.innerHTML, /Не вдалося завантажити продажі/);
    f.hooks.unlinked = null;
    await click(f, "refresh-link-sales");
    assert.equal(f.calls.unlinked, 2);
    f.surface.dispatch("change", { bpLink: "documentId" }, { value: "foreign-sale" }); await settle();
    await submit(f, "link-purchase"); assert.equal(f.calls.link.length, 0);
    f.surface.dispatch("change", { bpLink: "documentId" }, { value: "sale-one" });
    f.surface.dispatch("change", { bpLink: "buyerId" }, { value: "foreign-buyer" }); await settle();
    await submit(f, "link-purchase"); assert.equal(f.calls.link.length, 0);
    f.surface.dispatch("change", { bpLink: "buyerId" }, { value: "buyer-a" }); await settle();
    f.context.userId = "new-user";
    await submit(f, "link-purchase");
    assert.equal(f.calls.link.length, 0);
    assert.doesNotMatch(f.surface.innerHTML, /ПР-1|data-bp-link/);
  });

  await check("Owner assigns retail/installer/wholesale; new repeat buyers default to installer without automatic mail", async () => {
    const f=setup({context:{audience:"staff",role:"owner",buyerId:"",accounts:[]}});
    await f.ui.renderSales(f.surface); await tab(f,"buyers"); await click(f,"new-buyer");
    assert.match(f.surface.innerHTML, /value="installer" selected/);
    for (const tier of ["retail","installer","wholesale"]) assert(f.surface.innerHTML.includes(`value="${tier}"`));
    input(f,{bpEditor:"name"},"Оптовий покупець"); input(f,{bpEditor:"email"},"wholesale@example.invalid");
    input(f,{bpEditor:"priceType"},"wholesale"); await submit(f,"buyer");
    assert.equal(f.calls.save[0].priceType,"wholesale"); assert.equal(f.calls.send.length,0);
  });
  await check("Buyer sees assigned tier label and a single price, with no account tier selector", async () => {
    const a={...account(),priceType:"wholesale"};
    const f=setup({context:{accounts:[a]},data:{items:[item("panel",{price:9,retailPrice:8888,installerPrice:7777,wholesalePrice:9})]}});
    await f.ui.renderBuyer(f.surface);
    assert.match(f.surface.innerHTML,/ваш тип ціни: Оптова/);
    assert.match(f.surface.innerHTML,/9,00 USD/);
    assert.doesNotMatch(f.surface.innerHTML,/8888|7777|data-bp-editor="priceType"/);
  });
  await check("A forged price tier cannot save and successful order actions retain refresh warnings", async () => {
    const f=setup({context:{audience:"staff",role:"owner",buyerId:"",accounts:[]},data:{orders:[order()]}});
    await f.ui.renderSales(f.surface);
    f.hooks.action=() => ({order:order({status:"confirmed"}),warning:"Оновіть склад для актуальних залишків."});
    await click(f,"order-action","order-a",{bpOrderAction:"confirm"});
    assert.match(f.surface.innerHTML,/Статус замовлення оновлено.*Оновіть склад/);
    assert.equal(f.calls.action.length,1);
    await tab(f,"buyers"); await click(f,"new-buyer");
    input(f,{bpEditor:"name"},"Buyer"); input(f,{bpEditor:"email"},"buyer@example.invalid"); input(f,{bpEditor:"priceType"},"cost");
    await submit(f,"buyer"); assert.equal(f.calls.save.length,0); assert.match(f.surface.innerHTML,/Оберіть відомий тип ціни/);
  });

  return { passed: checks.length, checks };
}

if (require.main === module) runBuyerUITests(process.argv[2]).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = runBuyerUITests;
