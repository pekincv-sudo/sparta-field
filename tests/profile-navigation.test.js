"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function runProfileNavigationTests(projectDirectory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(projectDirectory, "app.js"), "utf8");
  const productionFunctions = new Map(
    [...source.matchAll(/^function\s+([\w$]+)\([^]*?^\}/gm)]
      .map((match) => [match[1], match[0]]),
  );
  const checks = [];
  const check = (name, callback) => { callback(); checks.push(name); };
  const sections = (markup) => [...markup.matchAll(/<button\b[^>]*\bdata-section=(['"])(.*?)\1[^>]*>/g)]
    .map((match) => match[2]).sort();

  function harness({ role = "owner", ready = true, local = false, mode = "installer", signedIn = true } = {}) {
    const profileView = { innerHTML: "" };
    const context = vm.createContext({
      profileView,
      portalMode: mode,
      cloudState: {
        enabled: !local,
        ready,
        memberRole: role,
        user: signedIn ? { id: "current-user", email: "owner@example.test" } : null,
        message: "Connection message sentinel",
      },
      window: {
        SPARTA_LOCAL_WORKSPACE: { enabled: local },
        SpartaWorkspaceMaintenance: { panelMarkup: () => "<p>Local maintenance sentinel</p>" },
      },
      renderCompanyUsers: () => "<p>Company membership sentinel</p>",
      renderClientMenu() { profileView.innerHTML = "<p>Client menu sentinel</p>"; },
    });
    for (const name of ["escapeAttribute", "renderRoleLabel", "profileWorkspaceLinks", "renderProfileView"]) {
      assert.ok(productionFunctions.has(name), `Production function ${name} exists`);
      vm.runInContext(productionFunctions.get(name), context);
    }
    return {
      links: () => context.profileWorkspaceLinks(),
      profile() { context.renderProfileView(); return profileView.innerHTML; },
    };
  }

  const accessCases = [
    ["Public owner reaches cash, sales and team", { role: "owner" }, ["cash", "sales", "team"]],
    ["Public admin reaches cash, sales and team", { role: "admin" }, ["cash", "sales", "team"]],
    ["Manager reaches sales without cash or team", { role: "engineer" }, ["sales"]],
    ["Warehouse staff reach sales without cash or team", { role: "warehouse" }, ["sales"]],
    ["Brigadier gains no privileged workspace links", { role: "brigadier" }, []],
    ["Installer gains no privileged workspace links", { role: "installer" }, []],
    ["Viewer gains no privileged workspace links", { role: "viewer" }, []],
    ["Unknown roles gain no privileged workspace links", { role: "unexpected-role" }, []],
    ["Missing membership gains no privileged workspace links", { role: "" }, []],
    ["Pending public access does not expose privileged destinations", { role: "owner", ready: false }, []],
    ["Local owner retains cash without online sales or team", { role: "owner", local: true, ready: false }, ["cash"]],
    ["Local admin retains cash without online sales or team", { role: "admin", local: true, ready: false }, ["cash"]],
    ["Local manager cannot enter online sales", { role: "engineer", local: true }, []],
    ["Local workspace cannot expose team even with stale ready state", { role: "owner", local: true }, ["cash"]],
    ["Client portal cannot expose staff destinations", { role: "owner", mode: "client" }, []],
    ["Local client portal cannot expose cash", { role: "owner", local: true, mode: "client" }, []],
  ];
  for (const [name, options, expected] of accessCases) {
    check(name, () => {
      const markup = harness(options).links();
      assert.equal(typeof markup, "string");
      assert.deepEqual(sections(markup), expected);
    });
  }

  for (const role of ["owner", "admin"]) {
    check(`Public ${role} profile keeps invitation and alternate workspace navigation`, () => {
      const markup = harness({ role }).profile();
      assert.match(markup, /id=["']inviteUserButton["']/);
      assert.match(markup, /Додати користувача/);
      assert.match(markup, /owner@example\.test/);
      assert.deepEqual(sections(markup), ["cash", "sales", "team"]);
    });
  }
  for (const [role, expected] of [["engineer", ["sales"]], ["warehouse", ["sales"]], ["installer", []], ["viewer", []]]) {
    check(`Public ${role} profile preserves invitation restrictions`, () => {
      const markup = harness({ role }).profile();
      assert.doesNotMatch(markup, /id=["']inviteUserButton["']/);
      assert.deepEqual(sections(markup), expected);
    });
  }
  check("Local profile keeps cash and maintenance without cloud invitations", () => {
    const markup = harness({ local: true, ready: false }).profile();
    assert.deepEqual(sections(markup), ["cash"]);
    assert.match(markup, /Local maintenance sentinel/);
    assert.doesNotMatch(markup, /id=["']inviteUserButton["']/);
  });
  check("Signed-out profile keeps sign-in without an invitation action", () => {
    const markup = harness({ role: "", ready: false, signedIn: false }).profile();
    assert.match(markup, /id=["']loginButton["']/);
    assert.doesNotMatch(markup, /id=["']inviteUserButton["']/);
    assert.deepEqual(sections(markup), []);
  });
  check("Client mode renders its own menu without staff controls", () => {
    const markup = harness({ mode: "client" }).profile();
    assert.match(markup, /Client menu sentinel/);
    assert.doesNotMatch(markup, /id=["']inviteUserButton["']/);
    assert.deepEqual(sections(markup), []);
  });
  check("Profile workspace buttons and their child icons dispatch navigation through the production click handler", () => {
    const clickRegistration = source.match(/^document\.addEventListener\("click", \(event\) => \{[^]*?^\}\);/m);
    assert.ok(clickRegistration, "Production delegated click handler exists");
    const listeners = [];
    const destinations = [];
    const context = vm.createContext({
      document: { addEventListener(type, callback) { if (type === "click") listeners.push(callback); } },
      showSection(section) { destinations.push(section); },
    });
    vm.runInContext(clickRegistration[0], context);
    assert.equal(listeners.length, 1);

    const attributes = (markup) => Object.fromEntries(
      [...markup.matchAll(/([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g)]
        .map((match) => [match[1], match[2] ?? match[3] ?? ""]),
    );
    const element = (attrs) => ({
      attrs,
      dataset: Object.fromEntries(Object.entries(attrs)
        .filter(([name]) => name.startsWith("data-"))
        .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
    });
    const matches = (node, selector) => {
      if (selector.startsWith(".")) return (node.attrs.class || "").split(/\s+/).includes(selector.slice(1));
      if (selector.startsWith("#")) return node.attrs.id === selector.slice(1);
      const attribute = selector.match(/^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]$/);
      return Boolean(attribute && Object.hasOwn(node.attrs, attribute[1])
        && (attribute[2] == null && attribute[3] == null || node.attrs[attribute[1]] === (attribute[2] ?? attribute[3])));
    };
    function dispatch(ancestry) {
      // The first element is the event target. Remaining elements are its parents.
      const target = Object.assign({}, ancestry[0], { closest(selector) {
        for (let index = 0; index < ancestry.length; index += 1) {
          for (const candidate of selector.split(",")) {
            const parts = candidate.trim().split(/\s+/).reverse();
            if (!matches(ancestry[index], parts[0])) continue;
            let ancestor = index + 1;
            if (parts.slice(1).every((part) => {
              while (ancestor < ancestry.length && !matches(ancestry[ancestor], part)) ancestor += 1;
              return ancestor++ < ancestry.length;
            })) return ancestry[index];
          }
        }
        return null;
      } });
      listeners[0]({ target });
    }

    const markup = harness().links();
    const container = element(attributes(markup.match(/^<[\w-]+\b([^>]*)>/)[1]));
    for (const button of markup.matchAll(/<button\b([^>]*)>([^]*?)<\/button>/g)) {
      const node = element(attributes(button[1]));
      dispatch([node, container]);
      dispatch([element({}), node, container]);
    }
    assert.deepEqual(destinations, ["cash", "cash", "sales", "sales", "team", "team"]);

    destinations.length = 0;
    dispatch([element({ "data-section": "cash" }), element({})]);
    assert.deepEqual(destinations, [], "An unrelated data-section attribute is not a navigation action");
    dispatch([element({ class: "nav-item", "data-section": "profile" })]);
    assert.deepEqual(destinations, ["profile"], "Existing primary navigation still dispatches");
  });

  function revealHarness({ noNav = false, overflow = true, hidden = false, itemLeft = 330, itemRight = 400 } = {}) {
    const calls = [];
    const rejectPageScroll = () => { throw new Error("Revealing navigation must not scroll the page vertically"); };
    const activeClasses = new Set(["nav-item", "active", ...(hidden ? ["is-hidden"] : [])]);
    const active = { getBoundingClientRect: () => ({ left: itemLeft, right: itemRight }), scrollIntoView: rejectPageScroll };
    const nav = {
      scrollWidth: overflow ? 574 : 300,
      clientWidth: 300,
      getBoundingClientRect: () => ({ left: 10, right: 310 }),
      scrollBy(options) { calls.push({ ...options }); },
      querySelector(selector) {
        const excluded = [...selector.matchAll(/:not\(\.([\w-]+)\)/g)].map((match) => match[1]);
        const required = [...selector.replace(/:not\([^)]*\)/g, "").matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
        return required.every((name) => activeClasses.has(name)) && !excluded.some((name) => activeClasses.has(name)) ? active : null;
      },
    };
    const context = vm.createContext({
      document: { querySelector: () => noNav ? null : nav, scrollBy: rejectPageScroll, scrollTo: rejectPageScroll },
      window: { scrollBy: rejectPageScroll, scrollTo: rejectPageScroll },
    });
    assert.ok(productionFunctions.has("revealActiveNavigation"), "Production navigation reveal helper exists");
    vm.runInContext(productionFunctions.get("revealActiveNavigation"), context);
    context.revealActiveNavigation();
    return calls;
  }
  check("Active tabs outside either rail edge scroll by only the required horizontal distance", () => {
    for (const [options, delta] of [[{ itemLeft: 330, itemRight: 400 }, 90], [{ itemLeft: -50, itemRight: 20 }, -60]]) {
      const calls = revealHarness(options);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].left, delta);
      assert.equal(Object.hasOwn(calls[0], "top"), false, "Horizontal reveal preserves the vertical scroll position");
    }
  });
  check("Already visible active tabs do not move the navigation rail", () => {
    for (const [itemLeft, itemRight] of [[10, 80], [100, 170], [240, 310]]) {
      assert.deepEqual(revealHarness({ itemLeft, itemRight }), []);
    }
  });
  check("A navigation rail without overflow does not scroll", () => {
    assert.deepEqual(revealHarness({ overflow: false }), []);
  });
  check("A hidden active tab does not move the navigation rail", () => {
    assert.deepEqual(revealHarness({ hidden: true }), []);
  });
  check("Missing navigation is safe when revealing the active tab", () => {
    assert.deepEqual(revealHarness({ noNav: true }), []);
  });

  return { passed: checks.length, checks };
}

module.exports = runProfileNavigationTests;
if (require.main === module) console.log(JSON.stringify(runProfileNavigationTests(process.argv[2]), null, 2));
