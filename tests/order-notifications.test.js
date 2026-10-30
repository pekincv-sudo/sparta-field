"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

module.exports = async function runOrderNotificationTests(directory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(directory, "order-notifications.js"), "utf8");
  const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
  const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
  const order = (id, status = "submitted", companyId = "company-a") => ({ id, status, companyId, number: `SP-${id}`, createdAt: "2026-10-30T20:00:00Z" });
  function harness(options = {}) {
    class Element {
      constructor(tag) { this.tagName = tag; this.children = []; this.parentNode = null; this.attributes = {}; this.listeners = {}; this.hidden = false; this.textContent = ""; this.className = ""; this.id = "";
        this.classList = { add: (name) => { if (!this.className.split(" ").includes(name)) this.className += (this.className ? " " : "") + name; } }; }
      append(...children) { children.forEach((child) => { child.parentNode = this; this.children.push(child); }); }
      setAttribute(key, value) { this.attributes[key] = String(value); }
      addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
      click() { (this.listeners.click || []).forEach((handler) => handler({ target: this })); }
      querySelector(selector) { return all(this).find((element) => matches(element, selector)) || null; }
    }
    function all(element) { return element.children.flatMap((child) => [child, ...all(child)]); }
    function matches(element, selector) { return selector.startsWith("#") ? element.id === selector.slice(1) : selector.startsWith(".") ? element.className.split(" ").includes(selector.slice(1)) : false; }
    const body = new Element("body"), actions = new Element("div"), navigation = new Element("button");
    actions.className = "topbar-actions"; navigation.className = "nav-item"; body.append(actions, navigation);
    const listeners = { window: {}, document: {} }, intervals = new Map(), timeouts = new Map(), store = options.store || new Map();
    let timerId = 0, calls = 0, snapshot = options.orders || [], handler = null;
    const routes = [], events = [];
    const state = { audience: "staff", role: options.role || "owner", companyId: "company-a", userId: "user-a", ready: true, local: false, ...options.context };
    const document = {
      body, hidden: Boolean(options.hidden), createElement: (tag) => new Element(tag),
      querySelector(selector) { if (selector === '.nav-item[data-section="sales"]') return navigation; return all(body).find((element) => matches(element, selector)) || null; },
      addEventListener(name, callback) { (listeners.document[name] ||= []).push(callback); },
    };
    const window = {
      SpartaBuyerCloud: { getContext: () => ({ ...state }), salesOrders() { calls++; return handler ? handler() : Promise.resolve({ orders: snapshot }); } },
      localStorage: { getItem(key) { if (options.storageBlocked) throw new Error("Storage blocked"); return store.get(key) || null; }, setItem(key, value) { if (options.storageBlocked) throw new Error("Storage blocked"); store.set(key, value); } },
      addEventListener(name, callback) { (listeners.window[name] ||= []).push(callback); },
      dispatchEvent(event) { events.push(event); },
      setInterval(callback, ms) { const id = ++timerId; intervals.set(id, { callback, ms }); return id; }, clearInterval: (id) => intervals.delete(id),
      setTimeout(callback, ms) { const id = ++timerId; timeouts.set(id, { callback, ms }); return id; }, clearTimeout: (id) => timeouts.delete(id),
    };
    const sandbox = { window, document, console, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, portalMode: options.mode || "installer" };
    if (!options.noRoute) sandbox.showSection = (section, options) => routes.push({ section, options: JSON.parse(JSON.stringify(options)) });
    const context = vm.createContext(sandbox); vm.runInContext(source, context);
    const api = window.SpartaOrderNotifications;
    return { api, state, document, window, context, body, actions, navigation, store, intervals, timeouts, routes, events,
      calls: () => calls, setOrders: (orders) => { snapshot = orders; }, setHandler: (callback) => { handler = callback; },
      find: (selector) => document.querySelector(selector),
      fire: (surface, name) => (listeners[surface][name] || []).forEach((callback) => callback()),
      async start() { api.start(); await api.refresh(); await flush(); },
    };
  }
  let passed = 0;
  {
    const h = harness({ orders: [order("old"), order("confirmed", "confirmed"), order("foreign", "submitted", "company-b")] });
    await h.start(); const value = h.api.getState();
    assert.equal(value.count, 1); assert.equal(value.pendingCount, 1); assert.deepEqual([...value.orderIds], ["old"]);
    assert.equal(h.find(".sp-order-notice").hidden, false); assert.equal(h.find(".sp-order-toast").hidden, true);
    assert.equal(h.find(".sp-order-nav-badge").textContent, "1"); assert.equal(h.calls(), 1);
    assert.equal([...h.intervals.values()][0].ms, 30000); passed++;
  }
  {
    const h = harness({ orders: [order("old")] }); await h.start();
    h.setOrders([order("old"), order("new")]); await h.api.refresh();
    assert.equal(h.api.getState().count, 2); assert.equal(h.find(".sp-order-toast").hidden, false);
    assert.match(h.find(".sp-order-toast-text").textContent, /SP-new/);
    const timer = [...h.timeouts.keys()]; await h.api.refresh();
    assert.deepEqual([...h.timeouts.keys()], timer, "Repeated polls must not replay or extend the toast"); passed++;
  }
  {
    const h = harness(); await h.start(); h.setOrders([order("new")]); await h.api.refresh();
    h.find(".sp-order-toast-close").click();
    assert.equal(h.find(".sp-order-toast").hidden, true); assert.equal(h.api.getState().count, 1);
    await h.api.refresh(); assert.equal(h.find(".sp-order-toast").hidden, true); assert.equal(h.api.getState().count, 1); passed++;
  }
  {
    const store = new Map(), h = harness({ store, orders: [order("seen")] }); await h.start(); h.api.acknowledge();
    assert.equal(h.api.getState().count, 0); assert.equal(h.find(".sp-order-notice").hidden, true); assert.equal(h.find(".sp-order-nav-badge").hidden, true);
    const reopened = harness({ store, orders: [order("seen"), order("unseen")] }); await reopened.start();
    assert.deepEqual([...reopened.api.getState().orderIds], ["unseen"]); assert.equal(reopened.find(".sp-order-toast").hidden, true); passed++;
  }
  {
    const h = harness({ orders: [order("same"), order("same"), order("cancelled", "cancelled"), order("ready", "ready"), order("done", "completed"), { ...order("bad"), companyId: null }] });
    await h.start(); assert.equal(h.api.getState().count, 1);
    h.setOrders([order("same", "confirmed")]); await h.api.refresh(); assert.equal(h.api.getState().count, 0);
    h.setOrders([order("same")]); await h.api.refresh(); assert.equal(h.api.getState().count, 1); assert.equal(h.find(".sp-order-toast").hidden, true, "A known ID returning to submitted is not a new order"); passed++;
  }
  {
    const h = harness({ orders: [order("retained")] }); await h.start();
    h.setHandler(async () => { throw new Error("Network unavailable"); }); assert.equal(await h.api.refresh(), false);
    assert.equal(h.api.getState().count, 1); assert.match(h.api.getState().error, /Network/);
    assert.match(h.find(".sp-order-notice").title, /останні отримані дані/);
    h.setHandler(null); h.setOrders([order("retained"), order("after-failure")]); await h.api.refresh();
    assert.equal(h.api.getState().count, 2); assert.equal(h.api.getState().error, ""); assert.equal(h.find(".sp-order-toast").hidden, false); passed++;
  }
  {
    const h = harness({ orders: [order("retained")] }); await h.start(); h.setHandler(async () => ({})); await h.api.refresh();
    assert.equal(h.api.getState().count, 1); assert.match(h.api.getState().error, /Некоректна/); passed++;
  }
  {
    const h = harness(), wait = deferred(); h.setHandler(() => wait.promise);
    h.api.start(); const first = h.api.refresh(), second = h.api.refresh(); await flush(); assert.equal(h.calls(), 1);
    wait.resolve({ orders: [order("only")] }); await Promise.all([first, second]); assert.equal(h.api.getState().count, 1); assert.equal(h.calls(), 1); passed++;
  }
  {
    const h = harness(); await h.start(); h.setOrders([order("old-private")]); await h.api.refresh(); assert.equal(h.find(".sp-order-toast").hidden, false);
    const wait = deferred(); h.setHandler(() => wait.promise); const request = h.api.refresh(); await flush();
    h.state.ready = false; h.state.userId = ""; assert.equal(h.api.getState().count, 0, "Snapshot accessor cannot expose stale identity data before the root hook");
    h.api.refreshAccess(); assert.equal(h.intervals.size, 0); assert.equal(h.find(".sp-order-toast").hidden, true); assert.equal(h.find(".sp-order-toast-text").textContent, "");
    wait.resolve({ orders: [order("late-private")] }); await request; assert.equal(h.api.getState().count, 0); assert.equal(h.find(".sp-order-notice").hidden, true); passed++;
  }
  {
    const h = harness(), old = deferred(); h.setHandler(() => old.promise); h.api.start(); await flush(); assert.equal(h.calls(), 1);
    h.state.companyId = "company-b"; h.api.refreshAccess(); assert.equal(h.api.getState().count, 0); assert.equal(h.calls(), 1, "Context switch must not overlap the old in-flight read");
    h.setHandler(async () => ({ orders: [order("company-b-order", "submitted", "company-b")] })); old.resolve({ orders: [order("company-a-secret")] }); await flush();
    assert.equal(h.calls(), 2); assert.deepEqual([...h.api.getState().orderIds], ["company-b-order"]); assert.equal(h.find(".sp-order-toast").hidden, true); passed++;
  }
  {
    for (const role of ["owner", "admin", "engineer", "warehouse"]) { const h = harness({ role }); await h.start(); assert.equal(h.calls(), 1); }
    for (const role of ["viewer", "installer", "buyer", ""]) { const h = harness({ context: { role } }); h.api.start(); await h.api.refresh(); assert.equal(h.calls(), 0); assert.equal(h.api.getState().active, false); }
    passed++;
  }
  {
    for (const options of [{ context: { local: true } }, { context: { audience: "buyer" } }, { context: { ready: false } }, { context: { userId: "" } }, { mode: "client" }]) {
      const h = harness({ ...options, orders: [order("private")] }); h.api.refreshAccess(); await h.api.refresh();
      assert.equal(h.calls(), 0); assert.equal(h.intervals.size, 0); assert.equal(h.find(".sp-order-notice").hidden, true);
    } passed++;
  }
  {
    const h = harness(), wait = deferred(); h.setHandler(() => wait.promise); h.api.start(); h.api.acknowledge();
    wait.resolve({ orders: [order("opened-while-loading")] }); await flush();
    assert.equal(h.api.getState().count, 0); assert.equal(h.api.getState().pendingCount, 1); passed++;
  }
  {
    const h = harness({ orders: [order("open")] }); await h.start(); const reads = h.calls(); h.find(".sp-order-notice").click();
    assert.deepEqual(h.routes, [{ section: "sales", options: { orderFilter: "submitted" } }]); assert.equal(h.api.getState().count, 1, "Opening a route cannot acknowledge a list that has not loaded");
    assert.equal(h.calls(), reads, "Opening a notice does not confirm, issue, pay or mutate an order"); h.api.acknowledge(["open"]); assert.equal(h.api.getState().count, 0); passed++;
  }
  {
    const h = harness({ orders: [order("old")] }); await h.start(); const poll = [...h.intervals.values()][0].callback;
    h.document.hidden = true; poll(); h.fire("window", "focus"); await flush(); assert.equal(h.calls(), 1);
    h.document.hidden = false; h.setOrders([order("old"), order("visible-again")]); h.fire("document", "visibilitychange"); await flush();
    assert.equal(h.calls(), 2); assert.equal(h.api.getState().count, 2); assert.equal(h.find(".sp-order-toast").hidden, false); passed++;
  }
  {
    const store = new Map(), h = harness({ store, orders: [order("same-id")] }); await h.start(); h.api.acknowledge();
    h.state.userId = "user-b"; h.api.refreshAccess(); await h.api.refresh(); assert.equal(h.api.getState().count, 1);
    h.api.acknowledge(); h.state.companyId = "company-b"; h.setOrders([order("same-id", "submitted", "company-b")]); h.api.refreshAccess(); await h.api.refresh();
    assert.equal(h.api.getState().count, 1); assert.equal(store.size, 2); passed++;
  }
  {
    const h = harness({ storageBlocked: true, orders: [order("pending")] }); await h.start(); assert.match(h.api.getState().storageError, /лише в цьому сеансі/);
    h.api.acknowledge(); assert.equal(h.api.getState().count, 0); assert.match(h.api.getState().storageError, /лише в цьому сеансі/); passed++;
  }
  {
    const h = harness(); await h.start(); h.setOrders([order("no-longer-allowed")]); await h.api.refresh();
    h.setHandler(async () => { throw Object.assign(new Error("Access denied"), { code: "42501" }); }); await h.api.refresh();
    assert.equal(h.api.getState().active, false); assert.equal(h.find(".sp-order-notice").hidden, true); assert.equal(h.find(".sp-order-toast-text").textContent, ""); assert.equal(h.intervals.size, 0); passed++;
  }
  {
    const h = harness(); await h.start(); h.setOrders([order("timer")]); await h.api.refresh();
    assert.equal([...h.timeouts.values()][0].ms, 12000); [...h.timeouts.values()][0].callback();
    assert.equal(h.find(".sp-order-toast").hidden, true); assert.equal(h.api.getState().count, 1); passed++;
  }
  {
    const h = harness(); await h.start(); h.setOrders([{ ...order("unsafe"), number: '<img src=x onerror="bad()">' }]); await h.api.refresh();
    assert.equal(h.find(".sp-order-toast-text").children.length, 0); assert.match(h.find(".sp-order-toast-text").textContent, /<img/); passed++;
  }
  {
    const h = harness({ noRoute: true, orders: [order("fallback")] }); await h.start(); h.find(".sp-order-notice").click();
    assert.equal(h.events[0].type, "sparta:open-sales"); assert.equal(h.events[0].detail.orderFilter, "submitted"); assert.equal(h.api.getState().count, 1); passed++;
  }
  {
    const h = harness({ orders: [order("old")] }); await h.start(); h.context.portalMode = "client"; h.api.refreshAccess();
    assert.equal(h.api.getState().active, false); assert.equal(h.intervals.size, 0); h.context.portalMode = "installer"; h.api.refreshAccess(); await h.api.refresh();
    assert.equal(h.api.getState().count, 1); assert.equal(h.find(".sp-order-toast").hidden, true); passed++;
  }
  {
    const h = harness({ orders: [order("observed"), order("not-on-screen")] }); await h.start(); h.api.acknowledge(["observed"]);
    assert.deepEqual([...h.api.getState().orderIds], ["not-on-screen"]); assert.equal(h.api.acknowledge(null), false); assert.equal(h.api.getState().count, 1); passed++;
  }
  {
    const h = harness(), wait = deferred(); h.setHandler(() => wait.promise); h.api.start();
    h.api.acknowledge(["observed-by-sales-view"]); wait.resolve({ orders: [order("observed-by-sales-view"), order("arrived-after-list")] }); await flush();
    assert.deepEqual([...h.api.getState().orderIds], ["arrived-after-list"], "Explicit acknowledgement never marks future unseen IDs as read"); passed++;
  }
  {
    const h = harness(); h.setHandler(async () => { throw new Error("Offline before the first snapshot"); }); await h.start();
    assert.equal(h.api.getState().initialized, false); assert.equal(h.find(".sp-order-notice").hidden, false);
    assert.equal(h.find(".sp-order-notice-count").textContent, "!"); assert.match(h.find(".sp-order-notice").attributes["aria-label"], /Не вдалося перевірити/);
    h.setHandler(null); await h.api.refresh(); assert.equal(h.find(".sp-order-notice").hidden, true); passed++;
  }
  return { passed };
};

if (require.main === module) module.exports().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error); process.exitCode = 1; });
