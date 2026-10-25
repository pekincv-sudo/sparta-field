"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

function runWorkflowTests(projectDirectory = path.join(__dirname, "..")) {
  const source = fs.readFileSync(path.join(projectDirectory, "app.js"), "utf8");
  // Run production functions with in-memory storage/UI adapters. No browser or DB is used.
  const functionSource = (name) => {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, `Production function ${name} exists`);
    return match[0];
  };
  const declarationSource = (pattern, name) => {
    const match = source.match(pattern);
    assert.ok(match, `Production declaration ${name} exists`);
    return match[0];
  };
  const context = {
    projects: [], warehouseItems: [], warehouseMovements: [], alerts: [],
    window: { SPARTA_LOCAL_WORKSPACE: { enabled: true } }, crypto,
    FormData: class {
      constructor(values) { this.values = values; }
      get(key) { return this.values[key] ?? null; }
    },
    alert(message) { context.alerts.push(message); },
    ensureProjectCollections(project) { return project; },
    selectedProject() { return context.projects[0]; },
    requireProjectRole() { return true; }, saveProjects() {}, saveWarehouseItems() {}, saveWarehouseMovements() {},
    render() {}, showSection() {},
  };
  vm.createContext(context);
  vm.runInContext([
    declarationSource(/const installerChecklistGroups = \[[^]*?\n\];/, "installerChecklistGroups"),
    declarationSource(/const installerChecklistItemIds = [^\n]+;/, "installerChecklistItemIds"),
    declarationSource(/const installerChecklistWeights = \{[^]*?\n\};/, "installerChecklistWeights"),
    ...["normalizeProjectId", "normalizeLookupValue", "emptyProjectFinance", "normalizeProjectFinance", "emptyInstallerChecklist", "isClosedProjectStatus", "materialQuantity", "warehouseUnitCost", "warehouseItemById", "warehouseItemForMaterial", "projectMaterialsWithWarehousePrices", "addWarehouseItemToProjectMaterials", "installerChecklistStats", "statusProgress", "copyCommercialOfferToMaterials", "addWarehouseMovement"].map(functionSource),
  ].join("\n"), context);

  const checks = [];
  const check = (name, callback) => { callback(); checks.push(name); };
  const item = { id: "stock-panel", name: "Тестова панель", sku: "PV-TEST", category: "Фотомодулі", unit: "шт", qty: 100, purchasePrice: 100, deliveryCost: 0, extraCost: 0, installerPrice: 150 };
  const project = { id: "test-project", status: "in_progress", materials: [], workChecklist: {}, finance: { offerLines: [{ warehouseItemId: item.id, name: item.name, qty: 10, purchasePrice: 100, salePrice: 150 }] } };
  context.projects.push(project);
  context.warehouseItems.push(item);
  const movementForm = (qty, type = "project") => ({ itemId: item.id, movementType: type, projectId: project.id, qty: String(qty), reset() {} });

  context.copyCommercialOfferToMaterials();
  context.copyCommercialOfferToMaterials();
  check("Repeated offer transfer keeps one planned line", () => {
    assert.equal(project.materials.length, 1);
    assert.equal(project.materials[0].plannedQty, 10);
  });
  check("Planned equipment creates no issued cost", () => {
    assert.equal(project.materials[0].issuedQty, 0);
    assert.equal(project.materials[0].actualQty, 0);
    assert.equal(context.projectMaterialsWithWarehousePrices(project)[0].qty, 0);
    assert.equal(item.qty, 100);
  });
  context.addWarehouseMovement(movementForm(4));
  check("Issuing stock updates the existing plan without doubling it", () => {
    assert.equal(item.qty, 96);
    assert.equal(project.materials.length, 1);
    assert.equal(project.materials[0].plannedQty, 10);
    assert.equal(project.materials[0].issuedQty, 4);
    assert.equal(project.materials[0].actualQty, 4);
  });
  item.purchasePrice = 200;
  check("Changing a warehouse price preserves earlier project cost", () => {
    assert.equal(context.projectMaterialsWithWarehousePrices(project)[0].purchasePrice, 100);
  });
  context.addWarehouseMovement(movementForm(2));
  check("Additional issue uses weighted fixed unit cost", () => {
    assert.ok(Math.abs(project.materials[0].purchasePriceSnapshot - 800 / 6) < 1e-9);
    const line = context.projectMaterialsWithWarehousePrices(project)[0];
    assert.ok(Math.abs(line.qty * line.purchasePrice - 800) < 1e-9);
  });
  context.addWarehouseMovement(movementForm(1, "return"));
  check("Return restores stock and reduces project issue", () => {
    assert.equal(item.qty, 95);
    assert.equal(project.materials[0].issuedQty, 5);
    assert.equal(project.materials[0].actualQty, 5);
    assert.equal(context.warehouseMovements[0].type, "return");
  });
  const movementCount = context.warehouseMovements.length;
  context.addWarehouseMovement(movementForm(99, "return"));
  check("Over-return changes neither stock nor journal", () => {
    assert.equal(item.qty, 95);
    assert.equal(project.materials[0].issuedQty, 5);
    assert.equal(context.warehouseMovements.length, movementCount);
    assert.equal(context.alerts.length, 1);
  });
  context.addWarehouseMovement(movementForm(1, "purchase"));
  check("Unsupported movement cannot silently deplete inventory", () => {
    assert.equal(item.qty, 95);
    assert.equal(context.warehouseMovements.length, movementCount);
    assert.equal(context.alerts.length, 2);
  });
  check("Explicit zero actual use does not fall back to the plan", () => {
    assert.equal(context.materialQuantity({ actualQty: 0, issuedQty: 5, plannedQty: 10 }), 0);
  });
  project.workChecklist = { marking: true, mounting_system: true, plane_check: true, panels_install: true, torque_check: true };
  check("First five weighted installation checks equal 50 percent", () => {
    assert.equal(context.installerChecklistStats(project).percent, 50);
    assert.equal(context.statusProgress(project), 50);
  });
  project.status = "service";
  check("Completed project displays 100 percent", () => assert.equal(context.statusProgress(project), 100));
  context.addWarehouseMovement(movementForm(1, "return"));
  check("Unused stock may be returned after project completion", () => {
    assert.equal(item.qty, 96);
    assert.equal(project.materials[0].issuedQty, 4);
  });
  check("Opening an accordion cannot change the project status", () => {
    const start = source.indexOf("const workflowStageButton =");
    const end = source.indexOf('if (event.target.closest("#editTechnicalButton"))', start);
    assert.ok(start >= 0 && end > start);
    assert.doesNotMatch(source.slice(start, end), /project\.status\s*=/);
    assert.doesNotMatch(source.slice(start, end), /saveProjects\(/);
  });
  return { passed: checks.length, checks };
}

if (require.main === module) console.log(JSON.stringify(runWorkflowTests(process.argv[2]), null, 2));
module.exports = runWorkflowTests;
