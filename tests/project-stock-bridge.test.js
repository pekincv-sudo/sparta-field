"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

module.exports = function () {
  const source = fs.readFileSync(path.join(__dirname, "..", "warehouse-ui.js"), "utf8");
  const core = require("../warehouse-core.js");
  const state = {
    items: [{ id: "panel", currency: "USD", name: "Панель", unit: "шт", qty: 10 }, { id: "cable", currency: "USD", name: "Кабель", unit: "м", qty: 20 }, { id: "uah", currency: "UAH", unit: "шт", qty: 5 }],
    reservations: [{ itemId: "panel", projectId: "a", qty: 1 }, { itemId: "panel", projectId: "other", qty: 2 }],
    orderReservations: [{ itemId: "panel", qty: 3 }], documents: [],
  };
  let loaded = true, manage = true, opens = 0, renders = 0;
  const context = {
    window: { SPARTA_LOCAL_WORKSPACE: { enabled: false }, SpartaWarehouseCloud: { snapshot: () => loaded ? state : null } },
    projects: [{ id: "a", currency: "USD", status: "proposal" }, { id: "closed", currency: "USD", status: "service" }],
    types: { project: "Видача", reserve: "Резерв", sale: "Продаж", return: "Повернення" }, core, ui: {},
    requireManage() { if (!manage) throw new Error("Немає доступу"); },
    currencyOf: (item) => item?.currency || "UAH",
    itemById: (id) => state.items.find((item) => item.id === id),
    isClosedProjectStatus: (status) => status === "service",
    openOperation(mode, itemId) { opens++; context.ui.editor = { mode, lines: [{ itemId, qty: "" }] }; },
    renderEditor() { renders++; }, snapshot: () => state,
  };
  vm.createContext(context);
  for (const name of ["openForProject", "movementAvailability"]) {
    const match = source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  const before = JSON.stringify(state), checks = [];
  const check = (name, fn) => { fn(); checks.push(name); };
  check("Opening an issue preselects the project, currency, item and quantity without posting", () => {
    context.openForProject("project", { projectId: "a", itemId: "panel", qty: 3 });
    assert.equal(context.ui.editor.projectId, "a");
    assert.equal(context.ui.editor.currency, "USD");
    assert.equal(context.ui.editor.lines[0].itemId, "panel");
    assert.equal(context.ui.editor.lines[0].qty, 3);
    assert.equal(JSON.stringify(state), before);
  });
  check("Piece quantities are validated before any document dialog is opened", () => {
    const count = opens;
    assert.throws(() => context.openForProject("reserve", { projectId: "a", itemId: "panel", qty: 1.5 }), /ціла кількість/);
    assert.equal(opens, count);
  });
  check("Fractional cable quantities retain their unit precision", () => {
    context.openForProject("project", { projectId: "a", itemId: "cable", qty: "1,125" });
    assert.equal(context.ui.editor.lines[0].qty, 1.125);
  });
  check("Missing items, wrong currency and missing projects fail before opening a document", () => {
    const count = opens;
    assert.throws(() => context.openForProject("project", { projectId: "a", itemId: "missing", qty: 1 }), /Товар/);
    assert.throws(() => context.openForProject("project", { projectId: "a", itemId: "uah", qty: 1 }), /Валюта/);
    assert.throws(() => context.openForProject("project", { projectId: "missing", itemId: "panel", qty: 1 }), /Об’єкт/);
    assert.equal(opens, count);
  });
  check("Closed projects cannot open a reserve or issue", () => {
    for (const mode of ["reserve", "project"]) assert.throws(() => context.openForProject(mode, { projectId: "closed", itemId: "panel", qty: 1 }), /активних/);
  });
  check("Cloud availability and the existing warehouse role guard remain mandatory", () => {
    loaded = false;
    assert.throws(() => context.openForProject("project", { projectId: "a", itemId: "panel", qty: 1 }), /завантажте/);
    loaded = true; manage = false;
    assert.throws(() => context.openForProject("project", { projectId: "a", itemId: "panel", qty: 1 }), /доступу/);
    manage = true;
  });
  check("Issue hint includes only this project's reserve while reserve hint excludes all holds", () => {
    assert.equal(context.movementAvailability(state.items[0], { mode: "project", projectId: "a" }, state), 5);
    assert.equal(context.movementAvailability(state.items[0], { mode: "reserve", projectId: "a" }, state), 4);
  });
  check("Legacy operation callers can still open an empty chooser without a quantity", () => {
    context.openForProject("sale", {});
    assert.equal(context.ui.editor.lines[0].qty, "");
    assert.equal(JSON.stringify(state), before);
    assert.ok(renders > 0);
  });
  return { passed: checks.length, checks };
};
