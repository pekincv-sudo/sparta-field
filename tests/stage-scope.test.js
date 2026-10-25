"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function runStageScopeTests(projectDirectory = path.join(__dirname, "..")) {
  const source = fs.readFileSync(path.join(projectDirectory, "app.js"), "utf8");
  const productionFunctions = new Map(
    [...source.matchAll(/^(?:async )?function\s+([\w$]+)\([^]*?^\}/gm)]
      .map((match) => [match[1], match[0]]),
  );
  const context = {
    canEditProjectField() { return true; },
    crmTasks: [],
    projectFilesByProjectId: {},
    selectedTab: "new",
    cloudState: {
      supportsProjectFinance: true,
      user: { id: "surveyor" },
      members: [{ user_id: "surveyor", profiles: { full_name: "Measurement assignee sentinel" } }],
    },
    // Storage normalization is outside these read-only rendering tests.
    ensureProjectCollections(project) { return project; },
  };
  vm.createContext(context);
  const declarationSource = (pattern, name) => {
    const match = source.match(pattern);
    assert.ok(match, `Production declaration ${name} exists`);
    return match[0];
  };
  vm.runInContext([
    declarationSource(/const installerChecklistGroups = \[[^]*?\n\];/, "installerChecklistGroups"),
    declarationSource(/const installerChecklistItemIds = [^\n]+;/, "installerChecklistItemIds"),
    declarationSource(/const installerChecklistWeights = \{[^]*?\n\};/, "installerChecklistWeights"),
    declarationSource(/const crmStatusLabels = \{[^]*?\n\};/, "crmStatusLabels"),
  ].join("\n"), context);
  const loaded = new Set();
  const loadProductionFunction = (name) => {
    if (loaded.has(name) || Object.hasOwn(context, name)) return;
    const implementation = productionFunctions.get(name);
    assert.ok(implementation, `Production function ${name} exists`);
    loaded.add(name);
    // Load actual production helpers too; no scope/filter logic is reproduced here.
    for (const call of implementation.matchAll(/\b([\w$]+)\s*\(/g)) {
      if (productionFunctions.has(call[1])) loadProductionFunction(call[1]);
    }
    vm.runInContext(implementation, context);
  };
  ["workflowFileCategories", "projectPhotoEntries", "renderProjectPhotos", "renderPassportPhotos", "passportChecklist", "renderWorkflowChecklist", "renderLeadStage", "renderMeasurementStage", "installerChecklistStats", "crmDueLabel", "projectToDb", "dbProjectToApp", "crmTaskPhotoCategory"].forEach(loadProductionFunction);

  const checks = [];
  const check = (name, callback) => { callback(); checks.push(name); };
  const photo = (category, index, extra = {}) => ({ src: `photo-${index}.png`, category, caption: `Photo ${index}`, ...extra });
  const project = {
    id: "stage-scope-test",
    title: "Lead title sentinel",
    clientName: "Lead client sentinel",
    clientPhone: "+380501234567",
    clientEmail: "lead-contact@example.test",
    address: "Lead address sentinel",
    objectType: "Приватний будинок",
    comment: "Lead comment sentinel",
    status: "service",
    contractNumber: "CONTRACT-EXCLUDED-SENTINEL",
    contractDate: "CONTRACT-DATE-EXCLUDED-SENTINEL",
    installationDate: "INSTALLATION-DATE-EXCLUDED-SENTINEL",
    teamName: "INSTALLATION-TEAM-EXCLUDED-SENTINEL",
    technical: { panelManufacturer: "TECHNICAL-EXCLUDED-SENTINEL", panelModel: "TECHNICAL-MODEL-EXCLUDED-SENTINEL", panelCount: 20, panelPowerW: 550, inverterModel: "INVERTER-EXCLUDED-SENTINEL" },
    strings: [{ note: "STRING-EXCLUDED-SENTINEL", mpptNumber: 1, stringNumber: 1, panelCount: 20 }],
    history: [{ note: "HISTORY-EXCLUDED-SENTINEL", title: "HISTORY-TITLE-EXCLUDED-SENTINEL" }],
    materials: [],
    files: [],
    workChecklist: { marking: true, mounting_system: true, plane_check: true, panels_install: true, torque_check: true },
    photos: [
      photo("Касовий чек", 0),
      photo("Дах / ділянка", 1),
      photo("Legacy category", 2),
      photo("Договір", 3),
      photo("Панелі", 4),
      photo("Інвертор", 5, { equipmentId: "inverter-serial-proof" }),
      photo("Замір", 6),
      photo("Сервіс", 7),
      photo("receipt", 8),
      photo("contract", 9),
      photo("before", 10),
      photo("Інше", 11, { stage: "planned" }),
      photo("Інше", 12, { crmTaskId: "survey-task" }),
      photo("Інше", 13, { stage: "service" }),
      photo("Серійний номер", 14),
      photo("Інвертор", 15),
      photo("Щит", 16),
      photo("Готовий об'єкт", 17),
      photo("Інше", 18, { caption: "Після заміру: готовий об'єкт, чек та договір передані" }),
    ],
  };
  context.crmTasks = [
    { id: "survey-task", projectId: project.id, title: "Замір об'єкта sentinel", note: "", dueAt: "2026-11-02T09:30", assignedTo: "surveyor", status: "planned" },
    { id: "other-project-survey", projectId: "different-project", title: "UNRELATED-SURVEY-EXCLUDED-SENTINEL", note: "Замір", dueAt: "2026-11-04T09:30", assignedTo: "surveyor", status: "planned" },
    { id: "not-a-survey", projectId: project.id, title: "PAYMENT-TASK-EXCLUDED-SENTINEL", note: "Оплата клієнта", dueAt: "2026-11-05T10:00", assignedTo: "surveyor", status: "planned" },
  ];
  const before = JSON.stringify(project);
  const tasksBefore = JSON.stringify(context.crmTasks);
  const indicesFor = (scope) => Array.from(context.projectPhotoEntries(project, scope), (entry) => entry.index);

  check("Each workflow stage accepts only its own document categories", () => {
    const expected = {
      proposal: ["commercial_offer"],
      planned: ["sketchup_model"],
      contract: ["contract", "receipt"],
      passport_issued: ["passport", "handover"],
      service: ["service_report"],
    };
    for (const [stage, categories] of Object.entries(expected)) {
      assert.deepEqual(Array.from(context.workflowFileCategories(stage)), categories, stage);
    }
  });
  check("Survey photos match explicit categories, stage metadata, and linked survey tasks", () => {
    assert.deepEqual(indicesFor("survey"), [1, 6, 10, 11, 12]);
  });
  check("Receipt scope contains receipt photos only", () => {
    assert.deepEqual(indicesFor("receipts"), [0, 8]);
  });
  check("Service scope contains category and stage service photos only", () => {
    assert.deepEqual(indicesFor("service"), [7, 13]);
  });
  check("CRM service task photos belong to service, not installation or passport", () => {
    const serviceProject = { ...project, id: "crm-service-project", photos: [photo("Виконання CRM", 99, { crmTaskId: "crm-service-proof" })] };
    context.crmTasks.push({ id: "crm-service-proof", projectId: serviceProject.id, type: "service", title: "Планове обслуговування" });
    try {
      assert.deepEqual(Array.from(context.projectPhotoEntries(serviceProject, "service"), (entry) => entry.index), [0]);
      assert.equal(context.projectPhotoEntries(serviceProject, "installation").length, 0);
      assert.equal(context.projectPhotoEntries(serviceProject, "passport").length, 0);
      assert.equal(context.projectPhotoEntries(serviceProject, "archive")[0].photo, serviceProject.photos[0]);
    } finally {
      context.crmTasks.pop();
    }
  });
  check("Receipts view hides a photo only when a receipt file has the same cash entry and filename", () => {
    const receiptsProject = {
      ...project,
      photos: [
        photo("Касовий чек", 90, { cashEntryId: "cash-linked", fileName: "receipt.svg" }),
        photo("Касовий чек", 91, { cashEntryId: "different-cash-entry", fileName: "receipt.svg" }),
        photo("Касовий чек", 92, { cashEntryId: "", fileName: "receipt.svg" }),
        photo("Касовий чек", 93, { cashEntryId: "cash-linked", fileName: "different-receipt.svg" }),
      ],
      files: [{ category: "receipt", cashEntryId: "cash-linked", fileName: "receipt.svg" }],
    };
    const original = JSON.stringify(receiptsProject);
    assert.deepEqual(Array.from(context.projectPhotoEntries(receiptsProject, "receipts"), (entry) => entry.index), [1, 2, 3]);
    const html = context.renderProjectPhotos(receiptsProject, { scope: "receipts" });
    assert.doesNotMatch(html, /src="photo-90\.png"/);
    [91, 92, 93].forEach((index) => assert.ok(html.includes(`src="photo-${index}.png"`)));
    assert.deepEqual(Array.from(context.projectPhotoEntries(receiptsProject, "archive"), (entry) => entry.index), [0, 1, 2, 3]);
    assert.equal(JSON.stringify(receiptsProject), original);
  });
  check("Installation scope keeps work and legacy photos while excluding other stages and documents", () => {
    assert.deepEqual(indicesFor("installation"), [2, 4, 5, 14, 15, 16, 17, 18]);
  });
  check("Passport scope excludes document scans, serial proof, survey, and service photos", () => {
    assert.deepEqual(indicesFor("passport"), [2, 4, 15, 16, 17, 18]);
  });
  check("Archive and default scope retain the complete original collection", () => {
    const expected = project.photos.map((item, index) => index);
    assert.deepEqual(indicesFor("archive"), expected);
    assert.deepEqual(indicesFor(undefined), expected);
  });
  check("Filtered photo entries keep their original indices and photo references", () => {
    for (const scope of ["survey", "installation", "receipts", "service", "passport", "archive"]) {
      for (const entry of context.projectPhotoEntries(project, scope)) {
        assert.equal(entry.photo, project.photos[entry.index], `${scope} keeps source photo ${entry.index}`);
      }
    }
  });
  check("A normal photo caption does not change its stage classification", () => {
    for (const scope of ["installation", "passport", "archive"]) assert.ok(indicesFor(scope).includes(18), scope);
    for (const scope of ["survey", "receipts", "service"]) assert.ok(!indicesFor(scope).includes(18), scope);
  });
  check("Only passport rendering limits photos to the first four eligible images", () => {
    const html = context.renderPassportPhotos(project);
    assert.equal((html.match(/<img\b/g) || []).length, 4);
    [2, 4, 15, 16].forEach((index) => assert.ok(html.includes(`src="photo-${index}.png"`)));
    [0, 1, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 18].forEach((index) => assert.ok(!html.includes(`src="photo-${index}.png"`), `Photo ${index} excluded from passport preview`));
    assert.equal(indicesFor("passport").length, 6);
  });
  check("Passport with only unrelated photos has an empty state", () => {
    const html = context.renderPassportPhotos({ ...project, photos: [project.photos[0], project.photos[1], project.photos[5], project.photos[7]] });
    assert.doesNotMatch(html, /<img\b/);
    assert.match(html, /Фото для паспорта ще не додано/);
  });
  check("Passport photo readiness requires eligible station photos, not receipts or serial proof", () => {
    const entries = context.passportChecklist({ ...project, photos: [project.photos[0], project.photos[1], project.photos[5], project.photos[7]] });
    assert.equal(entries.find((entry) => entry[0] === "Фото")[1], false);
  });
  check("New CRM evidence retains a durable stage-specific photo category", () => {
    assert.equal(context.crmTaskPhotoCategory({ type: "service", title: "Огляд станції" }), "Сервіс");
    assert.equal(context.crmTaskPhotoCategory({ type: "documents", title: "Зберегти чеки доставки" }), "Касовий чек");
    assert.equal(context.crmTaskPhotoCategory({ type: "documents", title: "Договір із клієнтом" }), "Договір");
    assert.equal(context.crmTaskPhotoCategory({ type: "task", title: "Виїзд на замір" }), "Замір");
    assert.equal(context.crmTaskPhotoCategory({ type: "task", title: "Монтаж панелей" }), "Виконання CRM");
  });
  check("Review checklist displays progress and completed items without editable controls", () => {
    const html = context.renderWorkflowChecklist(project, true);
    assert.match(html, /50%/);
    assert.match(html, /5 із 13/);
    assert.match(html, /Розмітка/);
    assert.match(html, /Інструктаж клієнта/);
    assert.doesNotMatch(html, /<input\b|data-work-checklist-item/);
  });
  check("Installation checklist remains editable with original weighted progress", () => {
    const html = context.renderWorkflowChecklist(project);
    assert.match(html, /<input\b/);
    assert.match(html, /data-work-checklist-item="marking"/);
    assert.equal((html.match(/<input\b[^>]*\bchecked\b[^>]*>/g) || []).length, 5);
    const stats = context.installerChecklistStats(project);
    assert.equal(stats.done, 5);
    assert.equal(stats.total, 13);
    assert.equal(stats.percent, 50);
  });
  check("Every installation item retains its existing percentage weight", () => {
    const expectedWeights = {
      marking: 5, mounting_system: 15, plane_check: 5, panels_install: 20,
      torque_check: 5, string_labels: 5, cable_routing: 10, dc_connection: 10,
      ac_connection: 10, grounding: 5, inverter_setup: 5, parameter_check: 3, client_briefing: 2,
    };
    for (const [id, weight] of Object.entries(expectedWeights)) {
      const stats = context.installerChecklistStats({ ...project, workChecklist: { [id]: true } });
      assert.equal(stats.percent, weight, id);
    }
    const complete = Object.fromEntries(Object.keys(expectedWeights).map((id) => [id, true]));
    assert.equal(context.installerChecklistStats({ ...project, workChecklist: complete }).percent, 100);
  });
  check("Lead stage displays client contacts and address without later-stage data", () => {
    const html = context.renderLeadStage(project);
    [project.clientName, project.clientPhone, project.clientEmail, project.address].forEach((value) => assert.ok(html.includes(value), value));
    assert.doesNotMatch(html, /EXCLUDED-SENTINEL|MPPT|Серійні номери|Історія фото|Технічні дані|Договір/);
  });
  check("Measurement schedule and assignee come from the linked CRM task", () => {
    const html = context.renderMeasurementStage(project);
    assert.match(html, /Замір об'єкта sentinel/);
    assert.ok(html.includes(context.crmDueLabel(context.crmTasks[0].dueAt)));
    assert.match(html, /Measurement assignee sentinel/);
    assert.doesNotMatch(html, /INSTALLATION-DATE-EXCLUDED-SENTINEL|Запланована дата монтажу|UNRELATED-SURVEY-EXCLUDED-SENTINEL|PAYMENT-TASK-EXCLUDED-SENTINEL/);
  });
  check("Contract number and date survive the finance JSON cloud round trip", () => {
    const contractProject = {
      ...project,
      contractNumber: "SPARTA-2026-42",
      contractDate: "2026-10-24",
      finance: { contractPrice: 275000, expenses: [{ name: "Delivery", amount: 500 }] },
    };
    const original = JSON.stringify(contractProject);
    const row = context.projectToDb(contractProject);
    assert.equal(row.finance.contractNumber, contractProject.contractNumber);
    assert.equal(row.finance.contractDate, contractProject.contractDate);
    const restored = context.dbProjectToApp(JSON.parse(JSON.stringify(row)));
    assert.equal(restored.contractNumber, contractProject.contractNumber);
    assert.equal(restored.contractDate, contractProject.contractDate);
    assert.equal(restored.finance.contractNumber, contractProject.contractNumber);
    assert.equal(restored.finance.contractDate, contractProject.contractDate);
    assert.equal(restored.finance.contractPrice, 275000);
    assert.equal(restored.finance.expenses[0].amount, 500);
    assert.equal(JSON.stringify(contractProject), original);
  });
  check("Saving a CRM task refreshes the open object detail", () => {
    assert.match(productionFunctions.get("saveCrmTaskFromForm"), /renderDetail\(\)/);
  });
  check("Browsing scoped stages preserves stored photos, tasks, status, checklist, and selected section", () => {
    assert.equal(JSON.stringify(project), before);
    assert.equal(JSON.stringify(context.crmTasks), tasksBefore);
    assert.equal(context.selectedTab, "new");
    assert.equal(project.status, "service");
  });

  return { passed: checks.length, checks };
}

if (require.main === module) console.log(JSON.stringify(runStageScopeTests(process.argv[2]), null, 2));
module.exports = runStageScopeTests;
