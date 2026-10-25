"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function runRenderSafetyTests(sourceFile = path.join(__dirname, "..", "app.js")) {
  const source = fs.readFileSync(sourceFile, "utf8");
  const functions = new Map([...source.matchAll(/^(?:async )?function\s+([\w$]+)\([^]*?^\}/gm)].map((match) => [match[1], match[0]]));
  const payload = '\"><img src=x onerror="alert(1)"> & sentinel';
  const item = { id: payload, name: payload, category: payload, note: payload, unit: payload, qty: 1, actualQty: 1, purchasePrice: 1, salePrice: 2, manufacturer: payload, model: payload, serialNumbers: payload, power: 5, count: 1 };
  const project = { id: payload, title: payload, address: payload, clientName: payload, clientPhone: payload, objectType: payload, comment: payload, installationDate: payload, teamName: payload, status: "new", strings: [], photos: [], materials: [item], files: [], technical: { panelManufacturer: payload, panelModel: payload, panelCount: 10, panelPowerW: 500, inverterManufacturer: payload, inverterModel: payload, inverterPowerKw: 5, batteryManufacturer: payload, batteryModel: payload, batteryModulesCount: 1, batteryCapacityKwh: 5, batterySerialNumbers: payload, hasBattery: true } };
  const projectList = { innerHTML: "" }, projectDetail = { innerHTML: "" }, homeView = { innerHTML: "" };
  const photo = { src: payload, caption: payload, category: payload };
  const context = vm.createContext({ canManageProjectFinance: () => true, canCreateCrmTasks: () => true,
    applyProjectRoleControls() {}, canEditProjectField() { return true; },
    canManageProjectFinance: () => true, canCreateCrmTasks: () => true,
    window: {}, portalMode: "installer", selectedProjectId: payload, selectedTab: "technical", projectList, projectDetail, homeView,
    projects: [project], warehouseItems: [item], cloudState: { ready: true, memberRole: "owner", user: { id: "owner" }, members: [] },
    companyContacts: { name: "SPARTA power", location: "Office", email: "office@example.test", phone: "+380000000000" },
    statusLabels: { new: "Лід" }, crmStatusLabels: { planned: "Заплановано" }, crmTypeLabels: { task: "Задача" }, crmPriorityLabels: { normal: "Звичайний" },
    filteredProjects() { return [project]; }, selectedProject() { return project; }, projectStatusOptions() { return ""; },
    renderProjectSectionStack() { return ""; }, statusProgress() { return 0; }, statusClass() { return ""; }, statusTone() { return ""; }, totalPower() { return "5.00"; },
    stringPanelCount() { return 0; }, isClosedProjectStatus() { return false; }, money(value) { return Number(value) + " грн"; },
    offerLineTotals() { return { totalSale: 2, finance: { offerLines: [item] } }; }, projectFinanceTotals() { return { revenue: 2, profit: 1, balanceDue: 2 }; },
    equipmentPhotosForProject() { return [photo]; }, equipmentTypeConfig() { return { title: "Інвертор", powerLabel: "кВт", serialLabel: "Серійний номер", photoLabel: "Фото" }; },
    projectPhotoEntries() { return [{ photo }]; }, batteryTotalCapacity() { return 5; },
    crmDueTone() { return "planned"; }, crmProjectName() { return payload; }, crmDueDateLabel() { return "25.10.2026"; }, crmDueTimeLabel() { return "10:00"; }, memberDisplayName() { return payload; },
    canManageCrmTask() { return true; }, canViewAllCrmTasks() { return true; },
    projectFileIcon() { return "DOC"; }, projectFileCategoryLabel() { return "Договір"; }, formatFileSize() { return "1 КБ"; }, formatProjectFileDate() { return "25.10.2026"; },
  });
  for (const name of ["escapeAttribute", "projectSubtitle", "formatFilledCombined", "formatCombined", "formatBatteryPassport", "renderPassportPhotos", "objectTechnicalSpecs", "renderProjectList", "renderDetail", "commercialOfferDocumentMarkup", "renderEquipmentCard", "renderAllStringsTable", "renderStringVisual", "renderConnectionDiagram", "passportDocumentMarkup", "renderHome", "renderPhotoTile", "renderProjectFileCard", "renderCrmTaskCard", "companyMemberName", "companyMemberEmail", "renderRoleLabel", "renderCompanyMemberProfile"]) {
    assert.ok(functions.has(name), `${name} exists`); vm.runInContext(functions.get(name), context);
  }
  let passed = 0;
  const check = (html, name) => {
    assert.ok(html.includes("&lt;img"), `${name}: input is displayed as text`);
    assert.ok(!html.includes("<img src=x"), `${name}: input does not become an element`);
    assert.ok(!html.includes('src=""><img'), `${name}: input cannot break an attribute`);
    assert.ok(!html.includes("&amp;lt;img"), `${name}: values are escaped once`);
    passed++;
  };
  context.renderProjectList(); check(projectList.innerHTML, "Project list");
  context.renderDetail(); check(projectDetail.innerHTML, "Object header");
  context.renderHome(); check(homeView.innerHTML, "Home object cards");
  check(context.objectTechnicalSpecs(project), "Technical object summary");
  check(context.commercialOfferDocumentMarkup(project), "Printable commercial offer");
  check(context.passportDocumentMarkup(project), "Printable passport and materials");
  check(context.renderEquipmentCard(project, "inverters", item, 0), "Equipment and serial photos");
  check(context.renderPhotoTile(photo, 0), "Photo caption and source attribute");
  check(context.renderPhotoTile(payload, 0), "Legacy text-only photo");
  check(context.renderProjectFileCard({ fileName: payload, note: payload }, 0), "File card");
  check(context.renderCrmTaskCard({ id: payload, projectId: payload, title: payload, note: payload, status: "planned", type: "task", priority: "normal", assignedTo: "owner" }), "CRM task and assignee");
  check(context.renderCompanyMemberProfile({ user_id: payload, role: "installer", profiles: { full_name: payload, email: payload, phone: payload } }), "Company member profile");
  return { passed };
}
module.exports = runRenderSafetyTests;
