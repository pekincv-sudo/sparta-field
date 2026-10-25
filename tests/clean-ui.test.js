"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function runCleanUiTests(projectDirectory = path.resolve(__dirname, ".."), patchPath = null) {
  let source = fs.readFileSync(path.join(projectDirectory, "app.js"), "utf8");
  if (patchPath) {
    const patch = fs.readFileSync(patchPath, "utf8");
    for (const hunk of patch.split("\n@@\n").slice(1)) {
      const lines = hunk.split("\n");
      const before = lines.filter((line) => line.startsWith("-")).map((line) => line.slice(1)).join("\n");
      const after = lines.filter((line) => line.startsWith("+")).map((line) => line.slice(1)).join("\n");
      assert.ok(source.includes(before), "Patch target exists in production source");
      source = source.replace(before, after);
    }
  }
  const defaults = { location: "Чернівці", capacityKw: 5, latitude: 48.29, longitude: 25.93, locationSource: "city", tilt: 30, azimuth: 0, systemLoss: 18, monthlyConsumption: 400, tariff: 4.32 };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ["2026-10-24T12:00:00Z"])); }
    static now() { return new Date("2026-10-24T12:00:00Z").getTime(); }
  }
  const context = {
    projects: [], warehouseItems: [], crmTasks: [], solarEstimate: null, solarEstimateMessage: "",
    solarCalculator: { ...defaults }, solarCalculatorDefaults: defaults,
    homeView: { innerHTML: "" }, warehouseView: { innerHTML: "" }, monitoringView: { innerHTML: "" },
    window: { SpartaWarehouseCore: require(path.join(projectDirectory, "warehouse-core.js")), SPARTA_LOCAL_WORKSPACE: { enabled: true } },
    Date: FixedDate, chartCalls: 0, reservations: [],
    statusLabels: { planned: "Замір", in_progress: "Монтаж", service: "Сервіс" },
    escapeAttribute(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); },
    money(value) { return String(value) + " грн"; },
    normalizeSolarCalculator(value) { return { ...defaults, ...value }; },
    clientProject() { return context.projects[0] || null; },
    totalPower(project) { return project.power || 0; },
    statusProgress(project) { return project.progress || 0; },
    statusTone() { return "work"; },
    formatCombined(...values) { return values.filter(Boolean).join(" ") || "Не вказано"; },
    readJsonStorage() { return { reservations: context.reservations }; },
    fallbackSolarEstimate() { throw new Error("Rendering must not silently invent an estimate"); },
    renderDailyGenerationChart() { context.chartCalls += 1; return '<div class="verified-daily-chart">Щоденні дані</div>'; },
  };
  vm.createContext(context);
  const names = ["serviceTickets", "clientGeneration", "renderSolarCalculatorPanel", "renderClientHome", "renderClientShop", "renderMonitoringView"];
  for (const name of names) {
    const match = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, `Production function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  const checks = [];
  const check = (name, callback) => { callback(); checks.push(name); };
  const estimate = (generation = 310, savings = 155, extras = {}) => ({
    calculatedAt: "2026-10-24T10:00:00Z", source: "Історичні дані Open-Meteo", config: { ...defaults },
    monthly: Array.from({ length: 12 }, (_, index) => ({ month: "Місяць " + (index + 1), generation, selfConsumption: generation / 2, savings, surplus: generation / 2 })),
    annualGeneration: generation * 12, annualSavings: savings * 12, annualSurplus: generation * 6, annualSelfConsumption: generation * 6,
    dailyGeneration: [{ date: "2025-10-01", generation: 10 }], ...extras,
  });

  check("No service requests are fabricated for an empty CRM", () => assert.equal(context.serviceTickets().length, 0));
  check("Service requests come only from real service CRM tasks and escape text", () => {
    context.projects = [{ id: "p1", title: "Об’єкт <A>" }];
    context.crmTasks = [{ type: "call", title: "Не сервіс" }, { type: "service", title: "Заявка <script>", projectId: "p1", status: "in_progress" }];
    const result = context.serviceTickets();
    assert.equal(result.length, 1);
    assert.equal(result[0].status, "В роботі");
    assert.equal(result[0].object, "Об’єкт &lt;A&gt;");
    assert.equal(result[0].title, "Заявка &lt;script&gt;");
    context.projects = []; context.crmTasks = [];
  });
  check("No generation exists before an explicit saved calculation", () => {
    assert.equal(context.clientGeneration(), null);
    context.solarEstimate = { monthly: [{ generation: 999 }] };
    assert.equal(context.clientGeneration(), null);
    context.solarEstimate = null;
  });
  check("Calculated generation uses month length and has no invented minimum or maximum", () => {
    context.solarEstimate = estimate(31000, 155);
    assert.equal(context.clientGeneration().forecast, 1000);
    assert.equal(context.clientGeneration().savings, 5);
    context.solarEstimate = estimate(0, 0);
    assert.equal(context.clientGeneration().forecast, 0);
    assert.equal(context.clientGeneration().savings, 0);
    context.solarEstimate = null;
  });
  check("Empty customer home has neither a fake station, progress nor fixed generation curve", () => {
    context.renderClientHome();
    assert.match(context.homeView.innerHTML, /Об’єкт ще не додано/);
    assert.doesNotMatch(context.homeView.innerHTML, /generation-line|C55 82|CO₂ заощаджено|<strong>0%<\/strong>/);
    assert.match(context.homeView.innerHTML, /Фактичний моніторинг/);
  });
  check("Customer home preserves actual object progress and planned visit", () => {
    context.projects = [{ id: "p1", title: "СЕС <A>", status: "in_progress", progress: 47, installationDate: "2026-11-02", power: 10 }];
    context.renderClientHome();
    assert.match(context.homeView.innerHTML, /СЕС &lt;A&gt;/);
    assert.match(context.homeView.innerHTML, /47%/);
    assert.match(context.homeView.innerHTML, /2026-11-02/);
    assert.doesNotMatch(context.homeView.innerHTML, /generation-line|67%/);
    context.projects = [];
  });
  check("Calculator form remains usable but hides results until calculated", () => {
    const html = context.renderSolarCalculatorPanel(null);
    assert.match(html, /id="solarCalculatorForm"/);
    assert.match(html, /id="solarUseLocationButton"/);
    assert.match(html, /Розрахунок ще не виконано/);
    assert.doesNotMatch(html, /solar-estimate-summary|solar-estimate-table|verified-daily-chart/);
    assert.equal(context.chartCalls, 0);
  });
  check("Explicit weather-backed estimates display real saved monthly results and their chart", () => {
    context.solarEstimate = estimate();
    const html = context.renderSolarCalculatorPanel(null);
    assert.match(html, /solar-estimate-summary|solar-estimate-table/);
    assert.match(html, /verified-daily-chart/);
    assert.equal(context.chartCalls, 1);
  });
  check("Missing daily weather and fallback profiles do not display a fabricated daily chart", () => {
    context.solarEstimate = estimate(310, 155, { dailyGeneration: [] });
    assert.doesNotMatch(context.renderSolarCalculatorPanel(null), /verified-daily-chart/);
    context.solarEstimate = estimate(310, 155, { source: "Орієнтовний профіль для України" });
    assert.doesNotMatch(context.renderSolarCalculatorPanel(null), /verified-daily-chart/);
    assert.equal(context.chartCalls, 1);
    context.solarEstimate = null;
  });
  check("Empty shop has no sample products, category counts or ready-kit prices", () => {
    context.renderClientShop();
    assert.match(context.warehouseView.innerHTML, /Каталог ще не заповнений/);
    assert.doesNotMatch(context.warehouseView.innerHTML, /128 товарів|64 товари|70 400|89 700|Старт 2 кВт|Дача 3 кВт/);
  });
  check("Shop shows actual catalog items and retail prices but excludes services and procurement cost", () => {
    context.warehouseItems = [{ id: "pv1", name: "Панель <A>", category: "Фотомодулі", qty: 2, unit: "шт", retailPrice: 500, purchasePrice: 321, sku: "PV1" }, { id: "work", name: "Монтаж", category: "Роботи", qty: 1 }];
    context.reservations = [{ id: "r1", itemId: "pv1", projectId: "p1", qty: 2 }];
    context.renderClientShop();
    assert.match(context.warehouseView.innerHTML, /Панель &lt;A&gt;/);
    assert.match(context.warehouseView.innerHTML, /500 грн/);
    assert.match(context.warehouseView.innerHTML, /Наявність уточнюється/);
    assert.doesNotMatch(context.warehouseView.innerHTML, /321|Монтаж<\/strong>/);
    context.warehouseItems = []; context.reservations = [];
  });
  check("Empty monitoring shows an unconnected state rather than fake online, warning or SOC metrics", () => {
    context.renderMonitoringView();
    assert.match(context.monitoringView.innerHTML, /Моніторинг ще не підключено/);
    assert.match(context.monitoringView.innerHTML, /Об’єктів ще немає/);
    assert.doesNotMatch(context.monitoringView.innerHTML, /metric-card|67%/);
  });
  check("Monitoring lists actual object metadata without inventing telemetry", () => {
    context.projects = [{ id: "p1", title: "Об’єкт <B>", status: "in_progress", power: 8.1, technical: { inverterManufacturer: "Deye", inverterModel: "HYB" } }];
    context.renderMonitoringView();
    assert.match(context.monitoringView.innerHTML, /Об’єкт &lt;B&gt;/);
    assert.match(context.monitoringView.innerHTML, /8.1 кВт/);
    assert.match(context.monitoringView.innerHTML, /телеметрію не підключено/);
    assert.doesNotMatch(context.monitoringView.innerHTML, /67%|metric-card/);
    context.projects = [];
  });
  check("Rendering clean customer screens does not seed or mutate business records", () => {
    const before = JSON.stringify({ projects: context.projects, items: context.warehouseItems, tasks: context.crmTasks, estimate: context.solarEstimate });
    context.renderClientHome(); context.renderClientShop(); context.renderMonitoringView(); context.serviceTickets();
    assert.equal(JSON.stringify({ projects: context.projects, items: context.warehouseItems, tasks: context.crmTasks, estimate: context.solarEstimate }), before);
  });
  return { passed: checks.length, checks };
}

module.exports = runCleanUiTests;
if (require.main === module) console.log(JSON.stringify(runCleanUiTests(process.argv[2], process.argv[3]), null, 2));
