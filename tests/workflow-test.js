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
    ...["normalizeProjectId", "normalizeLookupValue", "emptyProjectFinance", "normalizeProjectFinance", "emptyInstallerChecklist", "isClosedProjectStatus", "materialQuantity", "warehouseUnitCost", "warehouseItemById", "warehouseItemForMaterial", "projectMaterialsWithWarehousePrices", "addWarehouseItemToProjectMaterials", "installerChecklistStats", "projectInstallationCompletion", "statusProgress", "copyCommercialOfferToMaterials", "addWarehouseMovement"].map(functionSource),
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
  const quoteCopyFixture = (quote, materials = []) => {
    const target = { id: "quote-copy", currency: "USD", materials, finance: { contractPrice: 1234, installationPrice: 500, offerInstallationPrice: 100, offerLines: quote } };
    const beforeStock = JSON.stringify(context.warehouseItems), beforeMovements = JSON.stringify(context.warehouseMovements), beforeFinance = JSON.stringify(target.finance);
    const original = context.projects[0]; context.projects[0] = target;
    try { context.copyCommercialOfferToMaterials(); context.copyCommercialOfferToMaterials(); }
    finally { context.projects[0] = original; }
    assert.equal(JSON.stringify(context.warehouseItems), beforeStock); assert.equal(JSON.stringify(context.warehouseMovements), beforeMovements); assert.equal(JSON.stringify(target.finance), beforeFinance);
    return target;
  };
  context.warehouseItems.push({ id:"catalog-uah", name:"Catalog inverter", currency:"UAH", unit:"шт", qty:0, purchasePrice:1000 }, { id:"catalog-usd", name:"Catalog panel", currency:"USD", unit:"шт", qty:0, purchasePrice:50 });
  check("Explicit cross-currency quote transfer creates only an unbound plan and retains the catalog source", () => {
    const target=quoteCopyFixture([{id:"q1",warehouseItemId:"catalog-uah",catalogItemId:"catalog-uah",sourceCurrency:"UAH",currency:"USD",name:"Catalog inverter",unit:"шт",qty:10,purchasePrice:0,salePrice:40}]);
    assert.equal(target.materials.length,1);const line=target.materials[0];assert.equal(line.warehouseItemId,"");assert.equal(line.catalogItemId,"catalog-uah");assert.equal(line.sourceCurrency,"UAH");assert.equal(line.plannedQty,10);assert.equal(line.issuedQty,0);assert.equal(line.actualQty,0);assert.equal(line.salePriceSnapshot,40);
  });
  check("An edited quote unit is not bound to or merged into previously issued stock", () => {
    const issued={name:"Catalog panel",warehouseItemId:"catalog-usd",currency:"USD",unit:"шт",plannedQty:4,issuedQty:4,actualQty:3,purchasePriceSnapshot:45,salePriceSnapshot:80,note:"Keep installation history"};
    const before=JSON.stringify(issued);const target=quoteCopyFixture([{id:"q2",warehouseItemId:"catalog-usd",currency:"USD",name:"Catalog panel",unit:"компл",qty:5,salePrice:99}], [issued]);
    assert.equal(JSON.stringify(target.materials[0]),before);assert.equal(target.materials.length,2);assert.equal(target.materials[1].warehouseItemId,"");assert.equal(target.materials[1].catalogItemId,"catalog-usd");assert.equal(target.materials[1].unit,"компл");assert.equal(target.materials[1].plannedQty,5);assert.equal(target.materials[1].catalogUnit,"шт");
  });
  check("Quote lines in different units remain separate when copied repeatedly", () => {
    const target=quoteCopyFixture([{warehouseItemId:"catalog-usd",currency:"USD",name:"Catalog panel",unit:"шт",qty:2,salePrice:70},{warehouseItemId:"catalog-usd",currency:"USD",name:"Catalog panel",unit:"компл",qty:3,salePrice:100}]);
    assert.equal(target.materials.length,2);assert.equal(target.materials[0].warehouseItemId,"catalog-usd");assert.equal(target.materials[0].plannedQty,2);assert.equal(target.materials[1].warehouseItemId,"");assert.equal(target.materials[1].plannedQty,3);
  });
  check("Updating an existing issued plan preserves actual quantities and never supplies a quote price as historical cost", () => {
    const issued={name:"Catalog panel",warehouseItemId:"catalog-usd",currency:"USD",unit:"шт",plannedQty:4,issuedQty:4,actualQty:2,note:"Keep receipt"};
    const target=quoteCopyFixture([{warehouseItemId:"catalog-usd",currency:"USD",name:"Catalog panel",unit:"шт",qty:1,purchasePrice:999,salePrice:1999}], [issued]);
    assert.equal(target.materials.length,1);assert.equal(issued.plannedQty,4);assert.equal(issued.issuedQty,4);assert.equal(issued.actualQty,2);assert.equal(issued.purchasePriceSnapshot,undefined);assert.equal(issued.salePriceSnapshot,undefined);assert.equal(issued.note,"Keep receipt");
  });
  check("A deleted catalog source remains traceable but cannot create a stale warehouse binding", () => {
    const target=quoteCopyFixture([{warehouseItemId:"deleted-source",currency:"USD",name:"Historical equipment",unit:"шт",qty:2,salePrice:50}]);
    assert.equal(target.materials[0].warehouseItemId,"");assert.equal(target.materials[0].catalogItemId,"deleted-source");assert.equal(target.materials[0].plannedQty,2);
  });
  return { passed: checks.length, checks };
}

if (require.main === module) console.log(JSON.stringify(runWorkflowTests(process.argv[2]), null, 2));
module.exports = runWorkflowTests;
