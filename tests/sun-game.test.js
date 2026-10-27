"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function runSunGameTests(directory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(directory, "sun-game.js"), "utf8");
  function setup(options = {}) {
    const nodes = [], documentEvents = {}, windowEvents = {}, values = new Map([["business.cash", "unchanged"], ["business.warehouse", "unchanged"]]);
    const storage = { failRead: false, failWrite: false, writes: [] };
    let sequence = 0, buyerReady = Boolean(options.buyer);
    const buyerContext = { ready: true, userId: "user-a", companyId: "company-a", buyerId: "buyer-a" };
    const cloud = { enabled: true, client: { privateMarker: "PRIVATE-CLIENT" }, user: { id: "user-a", email: "PRIVATE-EMAIL" }, companyId: "company-a", memberRole: options.role || "owner", audience: options.buyer ? "buyer" : "staff", ready: !options.buyer, sessionLoading: false, ...options.cloud };
    class Node {
      constructor(tag) {
        this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.attributes = {}; this.parent = null; this.removed = false; this.open = false; this.focusCount = 0; this.textContent = ""; this._html = "";
        const classes = new Set();
        this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
        if (tag === "iframe") this.contentWindow = { messages: [], postMessage(data, target) { this.messages.push({ data: JSON.parse(JSON.stringify(data)), target }); } };
        nodes.push(this);
      }
      get isConnected() { return !this.removed && (this === body || Boolean(this.parent?.isConnected)); }
      set innerHTML(value) {
        this._html = value;
        if (this.tagName === "DIALOG") {
          this.parts = { ".sparta-game-status": new Node("p"), ".sparta-game-frame": new Node("div"), ".sparta-game-close": new Node("button") };
          Object.values(this.parts).forEach(node => this.append(node));
        }
      }
      get innerHTML() { return this._html; }
      setAttribute(name, value) { this.attributes[name] = value; }
      addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
      append(node) { this.children.push(node); node.parent = this; }
      querySelector(selector) { return this.parts?.[selector] || null; }
      focus() { this.focusCount += 1; }
      showModal() { this.open = true; }
      close() { this.open = false; this.dispatch("close"); }
      remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
      dispatch(type, event = {}) { (this.listeners[type] || []).forEach(callback => callback(event)); }
    }
    const body = new Node("body"), trigger = new Node("button"); body.append(trigger);
    if (options.locked) body.classList.add("auth-locked");
    const document = { body, activeElement: trigger, createElement: tag => new Node(tag), addEventListener(type, callback) { (documentEvents[type] ||= []).push(callback); } };
    const window = {
      SPARTA_LOCAL_WORKSPACE: { enabled: Boolean(options.local) },
      SpartaBuyerCloud: { isBuyerReady: () => buyerReady, getContext: () => ({ ...buyerContext }) },
      crypto: { randomUUID: () => `nonce-${++sequence}` },
      localStorage: {
        getItem(key) { if (storage.failRead) throw new Error("Storage read blocked"); return values.get(key) ?? null; },
        setItem(key, value) { if (storage.failWrite) throw new Error("Storage write blocked"); storage.writes.push([key, value]); values.set(key, value); },
      },
      addEventListener(type, callback) { (windowEvents[type] ||= []).push(callback); },
    };
    const context = vm.createContext({ window, document, cloudState: cloud, cloudContextRevision: 1, console });
    vm.runInContext(source, context);
    const frames = () => nodes.filter(node => node.tagName === "IFRAME" && node.isConnected);
    const dialog = () => nodes.findLast(node => node.tagName === "DIALOG" && node.isConnected);
    const message = (data, frame = frames()[0], sender = frame?.contentWindow) => { (windowEvents.message || []).forEach(callback => callback({ source: sender, origin: "null", data })); };
    const open = () => { const result = window.SpartaSunGame.open(trigger); const frame = frames()[0]; if (frame) frame.dispatch("load"); return result; };
    const init = frame => (frame || frames()[0]).contentWindow.messages.findLast(item => item.data.type === "init")?.data;
    const record = (best, frame = frames()[0], session = init(frame)?.session) => message({ source: "sparta-sun-game", type: "record", session, best }, frame);
    return { window, cloud, context, document, body, trigger, nodes, storage, values, buyerContext, frames, dialog, open, message, init, record, setBuyerReady(value) { buyerReady = value; }, click(target) { let prevented = false; (documentEvents.click || []).forEach(callback => callback({ target, preventDefault() { prevented = true; } })); return prevented; } };
  }
  const checks = [];
  const check = (name, callback) => { callback(); checks.push(name); };

  check("Every verified staff role and verified buyer can play; local owner remains available", () => {
    for (const role of ["owner", "admin", "engineer", "warehouse", "installer", "manager"]) {
      const f = setup({ role }); assert.equal(f.open(), true, role); assert.equal(f.frames().length, 1);
    }
    const buyer = setup({ buyer: true }); assert.equal(buyer.cloud.ready, false); assert.equal(buyer.open(), true); assert.equal(buyer.frames().length, 1);
    const local = setup({ local: true, locked: true, cloud: { enabled: false, ready: false, user: null, client: null } }); assert.equal(local.open(), true);
  });
  check("Guests, nonmembers, loading sessions and contradictory or stale buyer contexts fail closed", () => {
    const denied = [
      { cloud: { enabled: false } }, { cloud: { client: null } }, { cloud: { user: null } }, { cloud: { companyId: null } },
      { cloud: { ready: false } }, { cloud: { sessionLoading: true } }, { locked: true },
      { cloud: { audience: "buyer", ready: true } },
    ];
    for (const options of denied) { const f = setup(options); assert.equal(f.open(), false, JSON.stringify(options)); assert.equal(f.frames().length, 0); }
    for (const field of ["ready", "userId", "companyId"]) { const f = setup({ buyer: true }); f.buyerContext[field] = field === "ready" ? false : "different"; assert.equal(f.open(), false); }
    const buyer = setup({ buyer: true }); buyer.setBuyerReady(false); assert.equal(buyer.open(), false);
  });
  check("One sandboxed frame is opened lazily and receives only the public game protocol", () => {
    const f = setup(); assert.equal(f.frames().length, 0); f.open(); const frame = f.frames()[0];
    assert.equal(frame.attributes.sandbox, "allow-scripts"); assert.equal(frame.referrerPolicy, "no-referrer"); assert.match(frame.src, /^\.\/solar-dash\.html\?/);
    const first = f.init(); assert.deepEqual(Object.keys(first).sort(), ["best", "session", "source", "type"]); assert.equal(first.best, 0);
    assert.doesNotMatch(JSON.stringify(frame.contentWindow.messages), /PRIVATE|user-a|company-a|owner|email|token/);
    const nonce = first.session; f.open(); assert.equal(f.frames()[0], frame); assert.equal(f.init().session, nonce); assert.equal(f.frames().length, 1);
    const before = frame.contentWindow.messages.length; f.message({ source: "sparta-sun-game", type: "ready" }); assert.equal(frame.contentWindow.messages.length, before + 1);
    assert.equal(frame.contentWindow.messages.at(-1).target, "*", "Opaque sandbox origin uses only a nonsensitive game payload");
  });
  check("Foreign frames, wrong nonces, invalid protocol and invalid scores cannot change records", () => {
    const f = setup(); f.open(); const frame = f.frames()[0], session = f.init().session;
    f.message({ source: "sparta-sun-game", type: "record", session, best: 999 }, frame, {});
    f.record(999, frame, "stale-nonce");
    f.message({ source: "other", type: "record", session, best: 999 });
    f.message({ source: "sparta-sun-game", type: "init", session, best: 999 });
    for (const best of [-1, 0.5, "100", null, NaN, Infinity, 1000000001]) f.record(best);
    f.message(null); f.message("unexpected"); assert.equal(f.storage.writes.length, 0); assert.equal(f.frames().length, 1);
    f.record(300); assert.equal(f.storage.writes.length, 1); assert.equal(f.storage.writes[0][1], "300");
    f.record(100); f.record(300); assert.equal(f.storage.writes.length, 1, "A lower or duplicate result does not overwrite the best record");
  });
  check("Personal best survives reopening and is isolated by user and company without touching business data", () => {
    const f = setup(); f.open(); f.record(450); f.window.SpartaSunGame.reset(); f.open(); assert.equal(f.init().best, 450);
    f.window.SpartaSunGame.reset(); f.cloud.user = { id: "user-b" }; f.open(); assert.equal(f.init().best, 0); f.record(100);
    f.window.SpartaSunGame.reset(); f.cloud.user = { id: "user-a" }; f.cloud.companyId = "company-b"; f.open(); assert.equal(f.init().best, 0); f.record(200);
    f.window.SpartaSunGame.reset(); f.cloud.companyId = "company-a"; f.open(); assert.equal(f.init().best, 450);
    assert.equal(f.values.get("business.cash"), "unchanged"); assert.equal(f.values.get("business.warehouse"), "unchanged");
    assert.ok(f.storage.writes.every(([key]) => key.startsWith("sparta.sunGame.v1.")));
    assert.equal(new Set(f.storage.writes.map(([key]) => key)).size, 3);
  });
  check("A stale user, company, access state or revision closes the frame before accepting a record", () => {
    const changes = [
      f => { f.cloud.user = { id: "user-b" }; }, f => { f.cloud.companyId = "company-b"; },
      f => { f.context.cloudContextRevision += 1; }, f => { f.cloud.sessionLoading = true; },
      f => { f.body.classList.add("auth-locked"); }, f => { f.cloud.ready = false; },
    ];
    for (const mutate of changes) { const f = setup(); f.open(); const old = f.frames()[0]; mutate(f); f.record(999, old); assert.equal(f.frames().length, 0); assert.ok(old.removed); assert.equal(f.storage.writes.length, 0); }
    for (const mutate of [f => { f.buyerContext.buyerId = "buyer-b"; }, f => { f.setBuyerReady(false); }, f => { f.cloud.companyId = f.buyerContext.companyId = "company-b"; }]) {
      const f = setup({ buyer: true }); f.open(); const old = f.frames()[0]; mutate(f); f.record(999, old); assert.equal(f.frames().length, 0); assert.equal(f.storage.writes.length, 0);
    }
  });
  check("Close, cancel and reset remove the browsing context and reject queued old-frame messages", () => {
    const f = setup(); f.open(); const old = f.frames()[0], session = f.init().session;
    f.dialog().querySelector(".sparta-game-close").dispatch("click"); assert.equal(f.frames().length, 0); assert.ok(old.removed); assert.equal(f.trigger.focusCount, 1); assert.equal(f.body.classList.contains("sparta-game-open"), false);
    f.message({ source: "sparta-sun-game", type: "record", session, best: 999 }, old); assert.equal(f.storage.writes.length, 0);
    f.open(); let prevented = false; f.dialog().dispatch("cancel", { preventDefault() { prevented = true; } }); assert.ok(prevented); assert.equal(f.frames().length, 0);
    f.open(); const current = f.frames()[0]; f.window.SpartaSunGame.reset(); assert.equal(f.frames().length, 0); current.dispatch("load"); assert.equal(current.contentWindow.messages.length, 1); assert.equal(f.dialog(), undefined);
  });
  check("Blocked storage keeps the game playable and labels memory-only records truthfully across reopening", () => {
    for (const mode of ["failRead", "failWrite"]) {
      const f = setup(); f.storage[mode] = true; assert.equal(f.open(), true); f.record(250);
      assert.match(f.dialog().querySelector(".sparta-game-status").textContent, /250.*лише до закриття застосунку/);
      f.window.SpartaSunGame.reset(); f.open(); assert.equal(f.init().best, 250);
      assert.match(f.dialog().querySelector(".sparta-game-status").textContent, /лише до закриття застосунку/);
    }
  });
  check("Delegated launch controls respect disabled state and reuse the current game", () => {
    const f = setup(); const disabled = { disabled: true, closest: () => disabled };
    assert.equal(f.click(disabled), false); assert.equal(f.frames().length, 0);
    const launch = { disabled: false, isConnected: true, focus() {}, closest: () => launch };
    assert.equal(f.click(launch), true); assert.equal(f.frames().length, 1); const frame = f.frames()[0];
    assert.equal(f.click(launch), true); assert.equal(f.frames()[0], frame);
  });
  return { passed: checks.length, checks };
}

module.exports = runSunGameTests;
if (require.main === module) console.log(JSON.stringify(runSunGameTests(), null, 2));
