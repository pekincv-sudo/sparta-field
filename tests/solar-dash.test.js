"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function runSolarDashTests(directory = path.resolve(__dirname, "..")) {
  const html = fs.readFileSync(path.join(directory, "solar-dash.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const checks = [];
  function check(name, callback) { callback(); checks.push(name); }
  const clone = value => JSON.parse(JSON.stringify(value));
  function environment({ embedded = true, loading = false } = {}) {
    const messages = [], domEvents = {}, windowEvents = {}, raf = [];
    const element = id => ({
      id, textContent: "", innerHTML: "", style: {}, hidden: false,
      events: {}, classes: new Set(),
      addEventListener(type, callback) { this.events[type] = callback; },
      setPointerCapture() {},
      classList: { add() {}, remove() {} },
    });
    const elements = Object.fromEntries(["game", "score", "best", "lives", "overlay", "headline", "description", "start", "pause"].map(id => [id, element(id)]));
    const overlayClasses = new Set();
    elements.overlay.classList = { add: name => overlayClasses.add(name), remove: name => overlayClasses.delete(name) };
    elements.game.getContext = () => ({ setTransform() {} });
    const logos = [element("hud-logo"), element("overlay-logo")];
    logos.forEach(image => {
      image.complete = false;
      image.naturalWidth = 62;
      image.parentElement = { classes: new Set(), classList: { add(name) { image.parentElement.classes.add(name); } } };
    });
    const parent = { postMessage(message, origin) { messages.push({ message: clone(message), origin }); } };
    const window = { innerWidth: 390, innerHeight: 780, devicePixelRatio: 2, addEventListener(type, callback) { windowEvents[type] = callback; } };
    window.parent = embedded ? parent : window;
    // Access must remain impossible in an opaque-origin sandbox.
    Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage is not available to the game"); } });
    const document = { readyState: loading ? "loading" : "complete", hidden: false, getElementById: id => elements[id], querySelectorAll: () => logos, addEventListener(type, callback) { domEvents[type] = callback; } };
    const context = vm.createContext({ window, document, requestAnimationFrame: callback => raf.push(callback), console });
    // Expose mechanics only in this isolated test harness, never in the shipped game.
    const testScript = script.replace(/\}\)\(\);\s*$/, "window.__test={reset,update,end,reportRecord,state:()=>({score,best,lives,mode,keys:{...keys}}),drop:type=>objects.push({type,x:player.x,y:player.y,r:20,speed:0,rot:0}),setBest:value=>{best=value}};})();");
    vm.runInContext(testScript, context);
    const game = window.__test;
    const init = (session, best, source = parent) => windowEvents.message({ source, data: { source: "sparta-sun-game", type: "init", session, best } });
    const keydown = key => domEvents.keydown({ key, preventDefault() {} });
    return { messages, domEvents, windowEvents, elements, logos, parent, window, document, game, init, keydown, overlayClasses, raf };
  }

  check("Standalone game bundles only its real SPARTA logos and has no storage or network clients", () => {
    assert.doesNotMatch(script, /localStorage|sessionStorage|fetch\s*\(|XMLHttpRequest|WebSocket|eval\s*\(/);
    assert.equal((html.match(/src="\.\/assets\/sparta-logo\.jpeg"/g) || []).length, 2);
    assert.match(html, /SPARTA Power/);
    assert.match(html, /Рекорд на цьому пристрої/);
    assert.doesNotMatch(html, /user-scalable=no/);
    environment({ embedded: false });
  });
  check("Embedded game announces readiness after DOM availability without sending account data", () => {
    const complete = environment();
    assert.deepEqual(complete.messages, [{ message: { source: "sparta-sun-game", type: "ready" }, origin: "*" }]);
    const deferred = environment({ loading: true });
    assert.equal(deferred.messages.length, 0);
    deferred.domEvents.DOMContentLoaded();
    assert.equal(deferred.messages.length, 1);
    assert.deepEqual(Object.keys(deferred.messages[0].message).sort(), ["source", "type"]);
  });
  check("Only the direct parent can initialize a bounded integer record and nonempty session", () => {
    const f = environment();
    f.init("scope", 40, {});
    assert.equal(f.elements.best.textContent, 0);
    for (const bad of [-1, 1.5, NaN, Infinity, 1000000001, "40", null]) f.init("scope", bad);
    for (const bad of ["", " ", null, 15, "x".repeat(161)]) f.init(bad, 40);
    assert.equal(f.elements.best.textContent, 0);
    f.init("scope", 40);
    assert.equal(f.elements.best.textContent, 40);
  });
  check("Same-session updates preserve the maximum while a different session cannot replace it", () => {
    const f = environment();
    f.init("first", 40);
    f.init("first", 80);
    f.init("second", 999);
    f.init("first", 10);
    assert.equal(f.elements.best.textContent, 80);
    const last = f.messages.at(-1).message;
    assert.deepEqual(last, { source: "sparta-sun-game", type: "record", session: "first", best: 80 });
  });
  check("Actual sun and boost collisions score correctly and report records plus game completion", () => {
    const f = environment();
    f.init("play-session", 0);
    f.elements.start.events.click();
    f.game.drop("sun"); f.game.update(0);
    assert.equal(f.game.state().score, 10);
    f.game.drop("boost"); f.game.update(0);
    assert.equal(f.game.state().score, 40);
    f.game.drop("cloud"); f.game.update(0);
    assert.equal(f.game.state().lives, 2);
    f.game.end();
    assert.equal(f.game.state().mode, "over");
    assert.deepEqual(f.messages.filter(entry => entry.message.type === "record").map(entry => entry.message.best), [10, 40, 40]);
    for (const { message } of f.messages.filter(entry => entry.message.type === "record")) {
      assert.deepEqual(Object.keys(message).sort(), ["best", "session", "source", "type"]);
      assert.equal(message.session, "play-session");
    }
    f.game.setBest(1000000005); f.game.reportRecord();
    assert.equal(f.messages.at(-1).message.best, 1000000000);
  });
  check("A directly opened game plays with an in-memory record and emits no parent messages", () => {
    const f = environment({ embedded: false });
    f.keydown("Enter");
    f.game.drop("sun"); f.game.update(0);
    f.game.end();
    assert.equal(f.game.state().best, 10);
    f.elements.start.events.click();
    assert.equal(f.game.state().score, 0);
    assert.equal(f.game.state().best, 10);
    assert.equal(f.messages.length, 0);
  });
  check("Keyboard pause and movement remain usable; losing focus clears keys and pauses", () => {
    const f = environment();
    f.keydown("Enter"); f.keydown("ArrowLeft");
    assert.equal(f.game.state().keys.left, true);
    f.keydown(" ");
    assert.equal(f.game.state().mode, "paused");
    f.keydown("Escape");
    assert.equal(f.game.state().mode, "playing");
    f.windowEvents.blur();
    assert.equal(f.game.state().mode, "paused");
    assert.equal(f.game.state().keys.left, false);
  });
  check("Logo failures retain the brand wordmark without broken image indicators", () => {
    const f = environment();
    for (const image of f.logos) {
      image.events.error();
      assert.equal(image.hidden, true);
      assert.ok(image.parentElement.classes.has("is-logo-unavailable"));
    }
    assert.equal((html.match(/class="brand-name">SPARTA<span>POWER/g) || []).length, 2);
  });
  return { passed: checks.length, checks };
}

module.exports = runSolarDashTests;
if (require.main === module) console.log(JSON.stringify(runSolarDashTests(), null, 2));
