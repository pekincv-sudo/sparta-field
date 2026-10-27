"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Run the real auth/router functions and provider against an isolated DOM/RPC
// boundary. No network, Supabase project, browser storage, or email is used.
module.exports = async function runBuyerAuthTests(directory = path.resolve(__dirname, "..")) {
  const app = fs.readFileSync(path.join(directory, "app.js"), "utf8");
  const auth = fs.readFileSync(path.join(directory, "auth-flow.js"), "utf8");
  const buyer = fs.readFileSync(path.join(directory, "buyer-cloud.js"), "utf8");
  const functions = new Map([...app.matchAll(/^(?:async )?function\s+([\w$]+)\([^]*?^\}/gm)].map(match => [match[1], match[0]]));
  const company = "11111111-1111-4111-8111-111111111111";
  const buyerId = "22222222-2222-4222-8222-222222222222";
  const user = id => ({ id, email: `${id}@example.invalid`, email_confirmed_at: "2026-10-26T00:00:00Z" });
  const staffIds = ["homeView", "profileView", "projectList", "projectDetail", "passportPreview", "crmView", "warehouseView", "cashView", "teamView", "mapView", "serviceView", "monitoringView", "statsGrid"];
  const flush = async () => { for (let index = 0; index < 15; index++) await Promise.resolve(); };
  function harness(options = {}) {
    const calls = [], storage = new Map(), nodes = new Map(), listeners = {};
    const classes = () => { const values = new Set(); return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value), toggle(value, enabled) { const set = enabled === undefined ? !values.has(value) : enabled; if (set) values.add(value); else values.delete(value); return set; } }; };
    const node = selector => {
      if (nodes.has(selector)) return nodes.get(selector);
      const value = { id: selector.replace(/^#/, ""), innerHTML: "", textContent: "", dataset: {}, classList: classes(), style: {}, open: false,
        setAttribute(name, data) { this[name] = data; }, removeAttribute(name) { delete this[name]; },
        querySelector(child) { return node(`${selector} ${child}`); }, querySelectorAll() { return []; },
        reset() { this.value = ""; calls.push({ name: "resetForm", selector }); },
        close() { this.open = false; }, showModal() { this.open = true; }, addEventListener() {},
      };
      nodes.set(selector, value); return value;
    };
    const sections = ["home", "projects", "objectDetail", "warehouse", "crm", "cash", "team", "profile", "passport", "map", "service", "monitoring", "dashboard", "schema", "buyer", "sales"].map(id => node(`#${id}`));
    const nav = ["home", "projects", "warehouse", "crm", "cash", "team", "profile", "buyer", "sales"].map(id => { const value = node(`nav-${id}`); value.dataset.section = id; return value; });
    const portalButtons = ["client", "installer"].map(mode => { const value = node(`portal-${mode}`); value.dataset.portalMode = mode; return value; });
    const gate = node("#gateAuthForm");
    gate.elements = Object.fromEntries(["authMode", "password", "passwordConfirm", "email", "fullName"].map(name => [name, { value: "", reportValidity: () => true }]));
    gate.querySelectorAll = () => [];
    const body = { classList: classes(), dataset: {}, setAttribute(name, value) { this[name] = value; } };
    const state = { enabled: true, ready: false, sessionLoading: false, companyId: company, memberRole: null, user: null, members: [], invitations: [], supportsWarehouse: true, message: "" };
    const account = { id: buyerId, companyId: company, companyName: "Company", name: "Buyer", email: "buyer@example.invalid", phone: "", isActive: true };
    const response = (name, payload) => {
      if (options.rpcError?.[name]) return { data: null, error: { code: "42501", message: "Denied" } };
      if (name === "accept_company_invitation") return { data: [], error: null };
      if (name === "sparta_buyer_accept_invitation") return { data: options.buyerAccess !== false, error: null };
      if (name === "sparta_buyer_context") return { data: { accounts: options.buyerAccess === false ? [] : [account] }, error: null };
      if (/record_session_event/.test(name)) return { data: null, error: null };
      if (name === "sparta_buyer_catalog") return { data: { buyer: account, items: [] }, error: null };
      if (name === "sparta_buyer_orders") return { data: { orders: [] }, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    };
    const client = {
      async rpc(name, payload) {
        calls.push({ name, payload });
        if (options.rpcThrow === name) throw new Error("Connection lost");
        if (name === "sparta_buyer_context" && options.contextGate) return options.contextGate;
        return response(name, payload);
      },
      from(table) {
        calls.push({ name: "from", table }); const filters = {};
        const query = { select() { return query; }, eq(key, value) { filters[key] = value; return query; }, limit() { return query; },
          result(single = false) { const row = options.staff && filters.user_id !== "external-buyer" ? { company_id: company, role: "owner", is_active: true, companies: { name: "Company" } } : null; return { data: single ? row : row ? [row] : [], error: null }; },
          async maybeSingle() { return query.result(true); },
          then(resolve, reject) { return Promise.resolve(query.result()).then(resolve, reject); },
        }; return query;
      },
      auth: { async getUser() { return { data: { user: state.user }, error: null }; }, async getSession() { return { data: { session: { user: state.user, access_token: "test-session" } }, error: null }; }, async signOut() { calls.push({ name: "signOut" }); return {}; } },
    };
    state.client = client;
    const document = { body,
      querySelector: selector => node(selector),
      getElementById: id => node(`#${id}`),
      querySelectorAll(selector) {
        if (selector === ".section") return sections;
        if (selector === ".nav-item") return nav;
        if (selector === "[data-portal-mode]") return portalButtons;
        if (selector === "dialog[open]") return [...nodes.values()].filter(value => value.open);
        if (selector.includes(",")) return selector.split(",").map(value => node(value.trim()));
        return [];
      }, addEventListener(name, callback) { (listeners[name] ||= []).push(callback); },
    };
    const window = { location: { search: options.intent ? `?auth=${options.intent}` : "", hash: "", href: `https://sparta-field-u2pe.vercel.app/${options.intent ? `?auth=${options.intent}` : ""}` }, history: { replaceState() {} },
      addEventListener() {}, setInterval() {}, setTimeout() { return 1; }, clearTimeout() {},
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      SpartaWarehouseCloud: { reset() { calls.push({ name: "warehouseReset" }); } }, SpartaTeamAccess: { reset() { calls.push({ name: "teamReset" }); }, canManage: () => false },
      SpartaCashBook: { refreshAccess() { calls.push({ name: "cashRefreshAccess" }); }, async sync() { calls.push({ name: "cashSync" }); }, renderView() { calls.push({ name: "cashRender" }); } },
      SpartaBuyerUI: { reset() { calls.push({ name: "buyerUIReset" }); }, renderBuyer(target) { calls.push({ name: "buyerRender" }); if (target) target.innerHTML = "BUYER CONTENT"; }, renderSales() { calls.push({ name: "salesRender" }); } },
    };
    const context = vm.createContext({ cloudState: state, document, window, URL, URLSearchParams, Date, Intl, console, crypto: { randomUUID: () => "33333333-3333-4333-8333-333333333333" },
      cloudContextRevision: 0, cloudStorageScope: "", cloudSessionTask: null, cloudSessionUserId: "", cloudSyncTimer: null, crmSyncTimer: null, warehouseSyncTimer: null, cloudLoading: false,
      projects: [], crmTasks: [], projectFilesByProjectId: {}, warehouseItems: [], warehouseMovements: [], pendingCloudDeletes: [], pendingCrmDeletes: [], pendingWarehouseDeletes: [], selectedProjectId: "", selectedTab: "", portalMode: "installer",
      PUBLIC_APP_URL: "https://sparta-field-u2pe.vercel.app/", gateAuthMessage: node("#gateAuthMessage"), homeView: node("#homeView"), projectList: node("#projectList"), projectDetail: node("#projectDetail"), passportPreview: node("#passportPreview"), crmView: node("#crmView"), warehouseView: node("#warehouseView"), cashView: node("#cashView"), teamView: node("#teamView"), mapView: node("#mapView"), serviceView: node("#serviceView"), monitoringView: node("#monitoringView"), profileView: node("#profileView"), statsGrid: node("#statsGrid"),
      buyerView: node("#buyerView"), salesView: node("#salesView"),
      supabaseConfig: () => ({ companyId: company }), clearCloudMediaUrls() { calls.push({ name: "clearMedia" }); },
      writeLocalStorage: (key, value) => storage.set(key, value), applyProjectRoleControls() {},
      async loadCompanyPeople() { calls.push({ name: "loadCompanyPeople" }); },
      async verifyPublicSchema() { calls.push({ name: "verifyPublicSchema" }); }, async loadProjectsFromCloud() { calls.push({ name: "loadProjectsFromCloud" }); }, async loadCrmTasksFromCloud() { calls.push({ name: "loadCrmTasksFromCloud" }); }, async loadWarehouseItemsFromCloud() { calls.push({ name: "loadWarehouseItemsFromCloud" }); },
      renderRoleLabel: role => role || "", FormData: class {}, authenticateUser() {}, updateAccessMode() {}, render() {},
    });
    for (const name of ["renderHome", "renderProjectList", "renderDetail", "renderPassport", "renderCrmView", "renderWarehouseView", "renderMapView", "renderServiceView", "renderMonitoringView", "renderProfileView", "renderCrmNotification", "renderStats"]) context[name] = () => calls.push({ name });
    const selected = new Set(["clearCompanyContext", "updateAccessMode", "handleCloudAuthChange", "applyCloudSession", "loadCompanyContext", "acceptPendingInvitation", "logoutCloudUser", "render", "showSection", "applyPortalMode", "refreshTeamNavigation"]);
    for (const name of functions.keys()) if (/buyer|audience|staff.*dom|clear.*view/i.test(name)) selected.add(name);
    for (const name of selected) if (functions.has(name)) vm.runInContext(functions.get(name), context);
    vm.runInContext(buyer, context); vm.runInContext(auth, context);
    function seedStaffData() {
      for (const id of staffIds) node(`#${id}`).innerHTML = `PRIVATE STAFF ${id}`;
      context.projects = [{ id: "private-project" }]; context.crmTasks = [{ id: "private-task" }]; context.warehouseItems = [{ id: "private-item", purchasePrice: 123 }]; context.warehouseMovements = [{ id: "private-movement" }];
      context.projectFilesByProjectId = { private: [{ src: "private-document-url" }] };
      context.cloudStorageScope = "previous-staff-scope.";
      node("#objectDetail").classList.add("active");
    }
    return { context, state, window, calls, nodes, node, body, options, account, seedStaffData,
      apply: id => context.applyCloudSession({ user: user(id), access_token: "test-session" }),
    };
  }
  const staffLoaders = ["loadCompanyPeople", "verifyPublicSchema", "loadProjectsFromCloud", "loadCrmTasksFromCloud", "loadWarehouseItemsFromCloud", "cashSync"];
  let passed = 0;
  {
    const h = harness(); assert.equal(await h.apply("external-buyer"), true);
    assert.equal(h.window.SpartaBuyerCloud.isBuyerReady(), true); assert.equal(h.state.ready, false); assert.equal(h.state.memberRole, null);
    assert.equal(h.calls.filter(call => staffLoaders.includes(call.name)).length, 0); assert.equal(h.body.classList.contains("auth-locked"), false); passed++;
  }
  {
    const h = harness(); h.seedStaffData(); await h.apply("external-buyer");
    for (const name of ["projects", "crmTasks", "warehouseItems", "warehouseMovements"]) assert.equal(h.context[name].length, 0, name);
    assert.equal(Object.keys(h.context.projectFilesByProjectId).length, 0); assert.equal(h.context.cloudStorageScope, "");
    for (const id of staffIds) assert(!h.node(`#${id}`).innerHTML.includes("PRIVATE STAFF"), `Old staff DOM cleared: ${id}`);
    assert.equal(h.body.classList.contains("buyer-audience"), true); passed++;
  }
  {
    const h = harness(); await h.apply("external-buyer"); const before = h.calls.length;
    await h.window.SpartaAuthFlow.refreshAccess(); const accessCalls = h.calls.slice(before);
    assert(!accessCalls.some(call => call.name === "from" && call.table === "company_members"));
    assert(accessCalls.some(call => call.name === "sparta_buyer_context")); assert.equal(h.window.SpartaBuyerCloud.isBuyerReady(), true); passed++;
  }
  {
    const h = harness(); await h.apply("external-buyer"); const before = h.calls.length;
    await h.window.SpartaAuthFlow.recordSession("logout"); const sessionCalls = h.calls.slice(before);
    assert(!sessionCalls.some(call => call.name === "sparta_record_session_event"));
    assert(sessionCalls.some(call => call.name === "sparta_buyer_record_session_event")); passed++;
  }
  {
    const h = harness({ buyerAccess: false }); assert.equal(await h.apply("unaffiliated"), false);
    assert.equal(h.window.SpartaBuyerCloud.isBuyerReady(), false); assert.equal(h.state.ready, false); assert.equal(h.body.classList.contains("auth-locked"), true);
    assert.equal(h.calls.filter(call => staffLoaders.includes(call.name)).length, 0); passed++;
  }
  {
    const h = harness({ staff: true }); assert.equal(await h.apply("staff-owner"), true);
    assert.equal(h.state.ready, true); assert.equal(h.state.memberRole, "owner"); assert.equal(h.window.SpartaBuyerCloud.isBuyerReady(), false);
    for (const name of staffLoaders) assert(h.calls.some(call => call.name === name), name);
    assert(!h.calls.some(call => call.name === "sparta_buyer_catalog")); passed++;
  }
  {
    const h = harness({ intent: "recovery" }); await h.apply("external-buyer");
    assert.equal(h.node("#passwordDialog").open, true); assert.equal(h.state.ready, false); passed++;
  }
  {
    const h = harness(); await h.apply("external-buyer"); const resets = h.calls.filter(call => call.name === "buyerUIReset").length;
    assert.equal(await h.apply("external-buyer"), true);
    assert.equal(h.calls.filter(call => call.name === "buyerUIReset").length, resets, "Same-identity token refresh must preserve the cart"); passed++;
  }
  {
    const h = harness(); await h.apply("external-buyer"); await h.context.logoutCloudUser();
    assert.equal(h.window.SpartaBuyerCloud.isBuyerReady(), false); assert.equal(h.state.user, null); assert.equal(h.body.classList.contains("auth-locked"), true);
    assert(h.calls.some(call => call.name === "signOut")); passed++;
  }
  {
    const h = harness(); await h.apply("external-buyer"); const before = h.calls.length;
    for (const section of ["objectDetail", "cash", "team", "passport"]) {
      h.context.showSection(section); assert.equal(h.node(`#${section}`).classList.contains("active"), false, `Buyer cannot navigate to ${section}`);
    }
    assert(!h.calls.slice(before).some(call => ["cashRender", "renderDetail", "renderPassport"].includes(call.name))); passed++;
  }
  {
    const h = harness(); await h.apply("external-buyer"); h.options.buyerAccess = false;
    await h.window.SpartaAuthFlow.refreshAccess();
    assert.equal(h.window.SpartaBuyerCloud.isBuyerReady(), false); assert.equal(h.body.classList.contains("auth-locked"), true);
    assert(h.calls.filter(call => call.name === "buyerUIReset").length > 1); passed++;
  }
  {
    const h = harness(); await h.apply("external-buyer"); const before = h.calls.length;
    h.options.rpcError = { sparta_buyer_context: true };
    try { await h.window.SpartaAuthFlow.refreshAccess(); } catch (error) { assert.equal(error.code, "42501"); }
    assert.equal(h.window.SpartaBuyerCloud.isBuyerReady(), false, "Definitive access denial must discard the cached buyer context");
    assert.equal(h.body.classList.contains("auth-locked"), true);
    assert(!h.calls.slice(before).some(call => staffLoaders.includes(call.name))); passed++;
  }
  {
    let resolveContext; const contextGate = new Promise(resolve => { resolveContext = resolve; });
    const h = harness({ contextGate }); h.state.user = user("external-buyer");
    const pending = h.window.SpartaBuyerCloud.restore(); await flush();
    assert(h.calls.some(call => call.name === "sparta_buyer_context"));
    h.window.SpartaBuyerCloud.reset(); h.state.user = user("different-user");
    resolveContext({ data: { accounts: [h.account] }, error: null }); assert.equal(await pending, false);
    h.state.user = user("external-buyer"); h.state.audience = "buyer";
    assert.equal(h.window.SpartaBuyerCloud.isBuyerReady(), false, "A late response cannot repopulate a reset provider"); passed++;
  }
  {
    const h = harness({ rpcThrow: "sparta_buyer_context" }); h.seedStaffData();
    await assert.rejects(h.apply("external-buyer"), /Connection lost/);
    assert.equal(h.window.SpartaBuyerCloud.isBuyerReady(), false); assert.equal(h.body.classList.contains("auth-locked"), true);
    assert.equal(h.context.projects.length, 0);
    for (const id of staffIds) assert(!h.node(`#${id}`).innerHTML.includes("PRIVATE STAFF")); passed++;
  }
  {
    const h = harness({ staff: true }); await h.apply("staff-owner"); const before = h.calls.length;
    await h.window.SpartaAuthFlow.refreshAccess(); const accessCalls = h.calls.slice(before);
    assert(accessCalls.some(call => call.name === "from" && call.table === "company_members"));
    assert(!accessCalls.some(call => call.name === "sparta_buyer_context")); assert.equal(h.state.ready, true); passed++;
  }
  {
    const h = harness(); await h.apply("external-buyer"); const before = h.calls.length;
    h.context.applyPortalMode("client"); h.context.render();
    assert.equal(h.window.SpartaBuyerCloud.isBuyerReady(), true); assert.equal(h.state.ready, false);
    assert.equal(h.body.classList.contains("buyer-audience"), true);
    assert(!h.calls.slice(before).some(call => ["renderHome", "renderProjectList", "renderWarehouseView"].includes(call.name))); passed++;
  }
  return { passed };
};

if (require.main === module) {
  module.exports(process.argv[2]).then(console.log).catch(error => { console.error(error); process.exitCode = 1; });
}
