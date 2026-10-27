"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

module.exports = async function runBuyerCloudTests(directory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(directory, "buyer-cloud.js"), "utf8");
  const accountA = { id: "buyer-a", companyId: "company-a", companyName: "Company A", name: "Buyer A", email: "buyer@example.invalid", isActive: true };
  const accountB = { id: "buyer-b", companyId: "company-b", companyName: "Company B", name: "Buyer B", email: "buyer@example.invalid", isActive: true };
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
  function harness(options = {}) {
    const calls = [], handlers = {}, resets = [];
    const state = { user: { id: "user-a", email: "buyer@example.invalid" }, ready: true, audience: "staff", memberRole: options.role || "owner", companyId: "company-a" };
    const accounts = options.accounts || [accountA];
    const client = {
      async rpc(name, payload) {
        calls.push({ name, payload });
        if (handlers[name]) return handlers[name](payload);
        if (name === "sparta_buyer_accept_invitation") return { data: true, error: null };
        if (name === "sparta_buyer_context") return { data: { accounts }, error: null };
        if (name === "sparta_buyer_catalog") return { data: { buyer: accountA, items: [{ id: "item", name: "Item", price: 15, currency: "USD", availableQty: 3 }] }, error: null };
        if (name === "sparta_buyer_orders" || name === "sparta_sales_orders") return { data: { orders: [] }, error: null };
        if (name === "sparta_sales_buyers") return { data: { buyers: [] }, error: null };
        if (name === "sparta_sales_unlinked_sales") return { data: { sales: [] }, error: null };
        if (name === "sparta_sales_link_purchase") return { data: { order: { id: "historical-order", status: "completed" } }, error: null };
        if (name === "sparta_sales_save_buyer") return { data: { buyer: accountA, invitation: { id: "invite", email: accountA.email, lastSendStatus: "unsent" } }, error: null };
        if (name === "sparta_buyer_submit_order" || name === "sparta_buyer_cancel_order" || name === "sparta_sales_order_action") return { data: { order: { id: "order", number: "SO-1", buyerId: accountA.id, status: name === "sparta_sales_order_action" ? "confirmed" : "submitted" } }, error: null };
        if (name === "sparta_buyer_record_session_event") return { data: null, error: null };
        throw new Error(`Unexpected RPC ${name}`);
      },
      auth: { async getSession() { calls.push({ name: "getSession" }); return { data: { session: { access_token: "test-user-jwt" } }, error: null }; } },
    };
    state.client = client;
    const window = {
      SPARTA_LOCAL_WORKSPACE: { enabled: Boolean(options.local) },
      SpartaBuyerUI: { reset() { resets.push("buyerUI"); } },
      SpartaWarehouseCloud: { invalidate() { resets.push("warehouse"); }, reset() { resets.push("warehouse"); }, async load() { calls.push({ name: "warehouseLoad" }); if (options.stockError) throw new Error("Stock refresh unavailable"); return {}; } },
    };
    const context = vm.createContext({ cloudState: state, window, document: { querySelector() { return { reset() {}, showModal() {}, textContent: "" }; } },
      clearCompanyContext() { window.SpartaBuyerCloud.reset(); state.ready = false; state.audience = "staff"; state.memberRole = null; },
      updateAccessMode() { calls.push({ name: "updateAccessMode" }); }, render() { calls.push({ name: "render" }); }, logoutCloudUser() { calls.push({ name: "logout" }); },
      async fetch(url, init) { calls.push({ name: "fetch", url, init }); return new Response(JSON.stringify({ message: "Лист надіслано." }), { status: 200 }); },
    });
    vm.runInContext(source, context);
    const api = window.SpartaBuyerCloud;
    async function activate() {
      state.ready = false; state.memberRole = null; state.audience = "staff";
      const selected = await api.restore();
      if (selected) { state.audience = "buyer"; state.companyId = selected.companyId; state.buyerAccountId = selected.id; }
      return selected;
    }
    return { api, state, calls, handlers, resets, window, options, activate };
  }
  const rejectsCode = (callback, code) => assert.rejects(async () => callback(), error => error.code === code);
  let passed = 0;
  {
    const h = harness(); await h.activate(); const before = h.calls.length;
    for (const invoke of [() => h.api.buyers(), () => h.api.salesOrders(), () => h.api.unlinkedSales(), () => h.api.linkPurchase({ buyerId: accountA.id, documentId: "sale", requestId: "request" }), () => h.api.saveBuyer({ name: "Other" }), () => h.api.orderAction({ orderId: "order", action: "confirm", requestId: "request" }), () => h.api.sendAccess("invite", accountA.email)]) await rejectsCode(invoke, "42501");
    assert.equal(h.calls.length, before, "Buyer cannot invoke staff RPCs or email"); assert.equal(h.state.ready, false); passed++;
  }
  {
    const h = harness();
    for (const invoke of [() => h.api.catalog(accountA.id), () => h.api.orders(accountA.id), () => h.api.submitOrder({ buyerId: accountA.id }), () => h.api.cancelOrder({ orderId: "order", requestId: "request" })]) await rejectsCode(invoke, "42501");
    assert.equal(h.calls.length, 0, "Staff audience does not become an external buyer implicitly"); passed++;
  }
  {
    const h = harness({ role: "viewer" }); await rejectsCode(() => h.api.buyers(), "42501"); assert.equal(h.calls.length, 0);
    const local = harness({ local: true }); await rejectsCode(() => local.api.buyers(), "LOCAL_ONLY"); assert.equal(local.calls.length, 0);
    const signedOut = harness(); signedOut.state.user = null; await rejectsCode(() => signedOut.api.buyers(), "AUTH_REQUIRED"); assert.equal(signedOut.calls.length, 0); passed++;
  }
  {
    const h = harness({ accounts: [accountA, accountB] }); await h.activate(); const before = h.calls.length;
    for (const invoke of [() => h.api.catalog(accountB.id), () => h.api.orders(accountB.id), () => h.api.submitOrder({ buyerId: accountB.id, requestId: "request", lines: [] })]) await rejectsCode(invoke, "42501");
    assert.equal(h.calls.length, before, "A different buyer ID is rejected before any RPC"); passed++;
  }
  {
    const h = harness(); await h.activate();
    const order = { buyerId: accountA.id, requestId: "stable-order-request", lines: [{ itemId: "item", qty: 2 }], delivery: { method: "pickup", phone: "123" }, expectedTotal: 30 };
    await h.api.submitOrder(order);
    const sent = h.calls.find(call => call.name === "sparta_buyer_submit_order").payload;
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), { p_buyer_id: accountA.id, p_request_id: order.requestId, p_lines: order.lines, p_delivery: order.delivery, p_expected_total: 30 });
    assert(!h.calls.some(call => call.name === "fetch" || /cash/.test(call.name))); passed++;
  }
  {
    const h = harness(); await h.activate();
    h.handlers.sparta_buyer_submit_order = async () => { throw new Error("Connection lost after possible commit"); };
    const input = { buyerId: accountA.id, requestId: "same-request", lines: [{ itemId: "item", qty: 1 }], delivery: { method: "pickup" }, expectedTotal: 15 };
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(h.api.submitOrder(input), error => error.definitive === false && error.code === "");
    const sent = h.calls.filter(call => call.name === "sparta_buyer_submit_order"); assert.equal(sent.length, 2); assert(sent.every(call => call.payload.p_request_id === "same-request"));
    assert.equal(h.api.isBuyerReady(), true); passed++;
  }
  {
    const h = harness(); await h.activate();
    h.handlers.sparta_buyer_submit_order = async () => ({ data: null, error: { code: "40001", message: "stock revision changed" } });
    await assert.rejects(h.api.submitOrder({ buyerId: accountA.id, requestId: "request", lines: [] }), error => error.definitive === true && error.code === "40001" && /Залишок уже змінився/.test(error.message));
    assert.equal(h.calls.filter(call => call.name === "sparta_buyer_submit_order").length, 1); passed++;
  }
  {
    const h = harness(); await h.activate(); const gate = deferred(); h.handlers.sparta_buyer_catalog = () => gate.promise;
    const pending = h.api.catalog(accountA.id); h.api.reset();
    gate.resolve({ data: { buyer: accountA, items: [{ name: "OLD ACCOUNT ITEM" }] }, error: null });
    await rejectsCode(() => pending, "CONTEXT_CHANGED"); assert.equal(h.api.isBuyerReady(), false); assert.equal(h.api.getContext().accounts.length, 0); passed++;
  }
  {
    const h = harness({ accounts: [accountA, accountB] }); await h.activate(); const before = h.calls.length, resetBefore = h.resets.length;
    const selected = h.api.selectAccount(accountB.id);
    assert.equal(selected.buyerId, accountB.id); assert.equal(selected.companyId, accountB.companyId); assert.equal(h.state.companyId, accountB.companyId);
    assert.equal(h.resets.length, resetBefore + 1); assert(h.calls.slice(before).some(call => call.name === "render"));
    assert(!h.calls.slice(before).some(call => call.name.startsWith("sparta_") || call.name === "fetch"));
    assert.throws(() => h.api.selectAccount("unrelated-buyer"), error => error.code === "42501"); assert.equal(h.api.getContext().buyerId, accountB.id); passed++;
  }
  {
    const h = harness({ accounts: [accountA, accountB] }); await h.activate(); const gate = deferred(); h.handlers.sparta_buyer_catalog = () => gate.promise;
    const pending = h.api.catalog(accountA.id); h.api.selectAccount(accountB.id);
    gate.resolve({ data: { buyer: accountA, items: [{ name: "OLD BUYER ITEM" }] }, error: null });
    await rejectsCode(() => pending, "CONTEXT_CHANGED"); assert.equal(h.api.getContext().buyerId, accountB.id); passed++;
  }
  {
    const h = harness({ accounts: [accountA, { ...accountB, isActive: false }] }); await h.activate();
    const snapshot = h.api.getContext(); snapshot.accounts[0].id = "tampered";
    assert.equal(h.api.getContext().buyerId, accountA.id); assert.equal(h.api.getContext().accounts.length, 1);
    assert.throws(() => h.api.selectAccount(accountB.id), error => error.code === "42501"); passed++;
  }
  {
    const h = harness(); const saved = await h.api.saveBuyer({ name: "Buyer A", email: accountA.email });
    assert.equal(saved.invitation.lastSendStatus, "unsent"); assert.equal(h.calls.filter(call => call.name === "sparta_sales_save_buyer").length, 1);
    assert(!h.calls.some(call => call.name === "fetch" || call.name === "getSession"));
    const buyer = harness(); await buyer.activate(); await buyer.api.catalog(accountA.id); await buyer.api.orders(accountA.id);
    assert(!buyer.calls.some(call => call.name === "fetch" || call.name === "getSession")); passed++;
  }
  {
    const staff = harness({ role: "engineer" }); await rejectsCode(() => staff.api.sendAccess("invite", accountA.email), "42501"); assert.equal(staff.calls.length, 0);
    const owner = harness(); await owner.api.sendAccess({ id: "invite", email: accountA.email });
    const sent = owner.calls.find(call => call.name === "fetch"); assert.equal(sent.url, "/api/send-invitation");
    assert.deepEqual(JSON.parse(sent.init.body), { kind: "buyer", companyId: "company-a", invitationId: "invite", email: accountA.email });
    assert.equal(sent.init.headers.Authorization, "Bearer test-user-jwt"); assert.equal(owner.calls.filter(call => call.name === "fetch").length, 1); passed++;
  }
  {
    const h = harness(); const result = await h.api.orderAction({ orderId: "order", action: "confirm", requestId: "staff-request" });
    assert.equal(result.order.status, "confirmed"); assert(h.resets.includes("warehouse")); assert(h.calls.some(call => call.name === "warehouseLoad"));
    assert.equal(h.calls.filter(call => call.name === "sparta_sales_order_action").length, 1); assert(!h.calls.some(call => call.name === "fetch" || /cash/.test(call.name))); passed++;
  }
  {
    const h = harness({ stockError: true }); const result = await h.api.orderAction({ orderId: "order", action: "confirm", requestId: "staff-request" });
    assert.equal(result.order.status, "confirmed"); assert.equal(typeof result.warning, "string"); assert(result.warning.length > 0);
    assert.equal(h.calls.filter(call => call.name === "sparta_sales_order_action").length, 1, "A committed order must not be retried because stock refresh failed"); passed++;
  }
  {
    const h = harness(); await h.api.unlinkedSales();
    const result = await h.api.linkPurchase({ buyerId: accountA.id, documentId: "existing-sale", requestId: "historical-link-request" });
    assert.equal(result.order.status, "completed");
    const sent = h.calls.find(call => call.name === "sparta_sales_link_purchase").payload;
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), { p_buyer_id: accountA.id, p_document_id: "existing-sale", p_request_id: "historical-link-request" });
    assert(!h.calls.some(call => call.name === "fetch" || call.name === "warehouseLoad" || call.name === "sparta_sales_order_action" || /cash/.test(call.name)));
    assert(!h.resets.includes("warehouse")); passed++;
  }
  return { passed };
};

if (require.main === module) {
  module.exports(process.argv[2]).then(console.log).catch(error => { console.error(error); process.exitCode = 1; });
}
