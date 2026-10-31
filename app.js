const statusLabels = {
  new: "Лід",
  planned: "Замір",
  proposal: "КП",
  contract: "Договір",
  in_progress: "Монтаж",
  waiting_review: "Перевірка",
  completed: "Завершено",
  passport_issued: "Паспорт",
  service: "Сервіс",
};

const projectFunnelSteps = [
  ["new", "Лід"],
  ["planned", "Замір"],
  ["proposal", "КП"],
  ["contract", "Договір"],
  ["in_progress", "Монтаж"],
  ["waiting_review", "Перевірка"],
  ["passport_issued", "Паспорт"],
  ["service", "Сервіс"],
];

const companyContacts = {
  name: "SPARTA power",
  phone: "+380 50 863 88 87",
  email: "sparta.power22@gmail.com",
  location: "Чернівці, вул. Миру 19, офіс 137",
};

const PHOTO_BUCKET = "project-photos";
const PROJECT_FILE_BUCKET = "project-files";
const PROJECT_FILE_DB = window.SPARTA_LOCAL_WORKSPACE?.fileDatabase || "sparta-project-files";
const PROJECT_FILE_STORE = "files";
const PUBLIC_APP_URL = "https://sparta-field-u2pe.vercel.app/";

const crmTypeLabels = {
  task: "Задача",
  call: "Дзвінок",
  note: "Запис",
  service: "Сервіс",
  materials: "Матеріали",
  documents: "Документи",
};

const crmStatusLabels = {
  planned: "Заплановано",
  in_progress: "В роботі",
  done: "Виконано",
};

const crmPriorityLabels = {
  normal: "Звичайний",
  high: "Важливий",
  urgent: "Терміново",
};

const installerChecklistGroups = [
  {
    title: "1. Конструкція",
    items: [
      { id: "marking", title: "Розмітка" },
      { id: "mounting_system", title: "Монтаж кріплення" },
      { id: "plane_check", title: "Перевірка площини" },
    ],
  },
  {
    title: "2. Панелі",
    items: [
      { id: "panels_install", title: "Монтаж панелей" },
      { id: "torque_check", title: "Момент затяжки" },
      { id: "string_labels", title: "Маркування стрінгів" },
    ],
  },
  {
    title: "3. Електрика",
    items: [
      { id: "cable_routing", title: "Прокладка кабелю" },
      { id: "dc_connection", title: "Підключення DC" },
      { id: "ac_connection", title: "Підключення AC" },
      { id: "grounding", title: "Заземлення" },
    ],
  },
  {
    title: "4. Пусконалагодження",
    items: [
      { id: "inverter_setup", title: "Налаштування інвертора" },
      { id: "parameter_check", title: "Перевірка параметрів" },
      { id: "client_briefing", title: "Інструктаж клієнта" },
    ],
  },
];

const installerChecklistItemIds = installerChecklistGroups.flatMap((group) => group.items.map((item) => item.id));
const installerChecklistWeights = {
  marking: 5, mounting_system: 15, plane_check: 5, panels_install: 20,
  torque_check: 5, string_labels: 5, cable_routing: 10, dc_connection: 10,
  ac_connection: 10, grounding: 5, inverter_setup: 5, parameter_check: 3, client_briefing: 2,
};

function emptyInstallerChecklist() {
  return installerChecklistItemIds.reduce((result, id) => {
    result[id] = false;
    return result;
  }, {});
}

function emptyProjectFinance() {
  return {
    contractPrice: 0,
    installationPrice: 0,
    advancePaid: 0,
    crewPayroll: 0,
    equipment: [],
    expenses: [],
  };
}

function defaultWarehouseItems() {
  return [];
}

// Public business caches belong to a verified identity and company. Old,
// unscoped browser records remain untouched and are never imported on sign-in.
let cloudStorageScope = "";
let cloudContextRevision = 0;
let cloudSessionTask = null;
let cloudSessionUserId = "";

function scopedStorageKey(key) {
  if (window.SPARTA_LOCAL_WORKSPACE?.enabled) return window.SPARTA_LOCAL_WORKSPACE.storageKey(key);
  const isBusinessData = ["projects", "crmTasks", "projectFiles", "warehouse", "pending", "cash."].some((prefix) => key.startsWith(`solarObjectManager.${prefix}`));
  if (isBusinessData) return cloudStorageScope ? `${cloudStorageScope}${key}` : null;
  return key;
}

function readLocalStorage(key) {
  try {
    const storageKey = scopedStorageKey(key);
    if (!storageKey) return null;
    return window.localStorage?.getItem(storageKey) ?? null;
  } catch (error) {
    console.warn(`Local storage read failed for ${key}`, error);
    return null;
  }
}

function writeLocalStorage(key, value) {
  try {
    const storageKey = scopedStorageKey(key);
    if (!storageKey) return false;
    window.localStorage?.setItem(storageKey, value);
    return true;
  } catch (error) {
    console.warn(`Local storage write failed for ${key}`, error);
    window.spartaStorageWarning = "Пам’ять браузера переповнена або недоступна. Не закривайте сторінку, поки дані не збережені.";
    return false;
  }
}

function readJsonStorage(key, fallback) {
  const savedValue = readLocalStorage(key);
  if (!savedValue) return fallback;

  try {
    return JSON.parse(savedValue);
  } catch (error) {
    console.warn(`Local storage JSON is invalid for ${key}`, error);
    return fallback;
  }
}

const defaultProjects = [];

// The publishable key is intentionally safe to ship in the browser.  Keeping this
// fallback here lets the local build recover if the separate config script is
// blocked by an old service-worker cache.
const bundledSupabaseConfig = {
  url: "https://klltykfmbsobqumpolyd.supabase.co",
  anonKey: "sb_publishable_8HG6jI0L1h9RKjOzq-mV4g_rNkiQy4s",
  companyId: "e5301014-4985-44a8-8c36-842e6da25947",
};
if (!window.SPARTA_SUPABASE_CONFIG?.url || !window.SPARTA_SUPABASE_CONFIG?.anonKey) {
  window.SPARTA_SUPABASE_CONFIG = bundledSupabaseConfig;
}

const hasCloudConfig = Boolean(
  !window.SPARTA_LOCAL_WORKSPACE?.enabled && window.SPARTA_SUPABASE_CONFIG?.url &&
    window.SPARTA_SUPABASE_CONFIG?.anonKey &&
    !window.SPARTA_SUPABASE_CONFIG.url.includes("YOUR_PROJECT_URL") &&
    !window.SPARTA_SUPABASE_CONFIG.anonKey.includes("YOUR_SUPABASE_ANON_KEY")
);
const savedProjects = hasCloudConfig ? null : readJsonStorage("solarObjectManager.projects", null);
let projects = savedProjects || [];
let crmTasks = readJsonStorage("solarObjectManager.crmTasks", []);
let projectFilesByProjectId = readJsonStorage("solarObjectManager.projectFiles", {});
const savedWarehouseItems = readJsonStorage("solarObjectManager.warehouseItems", null);
let warehouseItems = (savedWarehouseItems || []).map(normalizeWarehouseItem);
let warehouseMovements = readJsonStorage("solarObjectManager.warehouseMovements", []);
window.SpartaWarehouseUI?.bootstrap();

let selectedProjectId = String(projects[0]?.id ?? "");
let selectedTab = "";
let portalMode = readLocalStorage("solarObjectManager.portalMode") === "client" ? "client" : "installer";
const solarCalculatorDefaults = {
  location: "Чернівці",
  locationSource: "city",
  latitude: 48.2921,
  longitude: 25.9358,
  capacityKw: 5,
  tilt: 30,
  azimuth: 0,
  systemLoss: 18,
  monthlyConsumption: 400,
  tariff: 4.32,
};
let solarCalculator = {
  ...solarCalculatorDefaults,
  ...(readJsonStorage("solarObjectManager.solarCalculator", {}) || {}),
};
let solarEstimate = readJsonStorage("solarObjectManager.solarEstimate", null);
let solarEstimateMessage = "";
let stringsEditing = false;
let materialsEditing = false;
let selectedWarehouseSection = "inverters";
let warehousePickerFilters = {};
let authMode = "signin";
let crmFilter = "today";
let cloudSyncTimer = null;
let crmSyncTimer = null;
let warehouseSyncTimer = null;
let warehouseSearchTimer = null;
let editingWarehouseIndex = null;
let cloudLoading = false;
let pendingCloudDeletes = readJsonStorage("solarObjectManager.pendingDeletes", []);
let pendingCrmDeletes = readJsonStorage("solarObjectManager.pendingCrmDeletes", []);
let pendingWarehouseDeletes = readJsonStorage("solarObjectManager.pendingWarehouseDeletes", []);

const cloudState = {
  client: null,
  user: null,
  companyId: null,
  memberRole: null,
  audience: "staff",
  buyerAccountId: null,
  supportsProjectChecklist: true,
  supportsProjectFinance: true,
  supportsPanelSerialNumbers: true,
  supportsEquipmentDetails: true,
  supportsPhotoEquipmentLinks: true,
  supportsWarehouse: true,
  enabled: false,
  ready: false,
  sessionLoading: false,
  message: "Локальний режим",
  members: [],
  invitations: [],
};

if (window.spartaStorageWarning) {
  cloudState.message = window.spartaStorageWarning;
}

function clearCompanyContext() {
  window.SpartaProjectStockPicker?.reset();
  window.SpartaProjectStockActions?.reset();
  window.SpartaSunGame?.reset();
  window.SpartaOrderNotifications?.stop();
  cloudContextRevision += 1;
  clearCloudMediaUrls();
  cloudStorageScope = "";
  cloudSessionTask = null;
  cloudSessionUserId = "";
  window.clearTimeout(cloudSyncTimer);
  window.clearTimeout(crmSyncTimer);
  window.clearTimeout(warehouseSyncTimer);
  cloudSyncTimer = crmSyncTimer = warehouseSyncTimer = null;
  cloudState.companyId = supabaseConfig()?.companyId || null;
  cloudState.memberRole = null;
  cloudState.audience = "staff";
  cloudState.buyerAccountId = null;
  cloudState.ready = false;
  cloudState.members = [];
  cloudState.invitations = [];
  cloudState.sessionLoading = false;
  cloudState.supportsWarehouse = true;
  projects = [];
  crmTasks = [];
  projectFilesByProjectId = {};
  warehouseItems = [];
  warehouseMovements = [];
  pendingCloudDeletes = [];
  pendingCrmDeletes = [];
  pendingWarehouseDeletes = [];
  selectedProjectId = "";
  selectedTab = "";
  cloudLoading = false;
  window.SpartaWarehouseCloud?.reset();
  window.SpartaWarehouseUI?.reset?.();
  window.SpartaInventoryImportUI?.reset();
  window.SpartaTeamAccess?.reset();
  window.SpartaBuyerCloud?.reset();
  // A different identity must not inherit rendered staff data.
  for (const id of ["homeView", "projectList", "projectDetail", "passportPreview", "crmView", "warehouseView", "mapView", "serviceView", "monitoringView", "profileView", "teamView", "statsGrid", "cashView", "salesView", "buyerPortalView"]) {
    const target = document.getElementById(id); if (target) target.innerHTML = "";
  }
  document.querySelectorAll(".user-card strong, .user-card small").forEach((node) => { node.textContent = ""; });
  document.body.classList.remove("buyer-audience");
  document.querySelectorAll("dialog form").forEach((form) => form.reset?.());
  document.querySelectorAll("dialog[open]").forEach((item) => item.close());
  window.SpartaCashBook?.refreshAccess();
}

const projectList = document.querySelector("#projectList");
const projectDetail = document.querySelector("#projectDetail");
const passportPreview = document.querySelector("#passportPreview");
const statsGrid = document.querySelector("#statsGrid");
const crmNotificationButton = document.querySelector("#crmNotificationButton");
const homeView = document.querySelector("#homeView");
const crmView = document.querySelector("#crmView");
const warehouseView = document.querySelector("#warehouseView");
const mapView = document.querySelector("#mapView");
const serviceView = document.querySelector("#serviceView");
const monitoringView = document.querySelector("#monitoringView");
const profileView = document.querySelector("#profileView");
const searchInput = document.querySelector("#searchInput");
const statusFilter = document.querySelector("#statusFilter");
const dialog = document.querySelector("#projectDialog");
const form = document.querySelector("#projectForm");
const projectInfoDialog = document.querySelector("#projectInfoDialog");
const projectInfoForm = document.querySelector("#projectInfoForm");
const technicalDialog = document.querySelector("#technicalDialog");
const technicalForm = document.querySelector("#technicalForm");
const technicalPowerPreview = document.querySelector("#technicalPowerPreview");
const panelManufacturerSelect = document.querySelector("#panelManufacturerSelect");
const authDialog = document.querySelector("#authDialog");
const authForm = document.querySelector("#authForm");
const authTitle = document.querySelector("#authTitle");
const authSubmitButton = document.querySelector("#authSubmitButton");
const authMessage = document.querySelector("#authMessage");
const gateAuthForm = document.querySelector("#gateAuthForm");
const gateAuthMessage = document.querySelector("#gateAuthMessage");
const inviteDialog = document.querySelector("#inviteDialog");
const inviteForm = document.querySelector("#inviteForm");
const inviteMessage = document.querySelector("#inviteMessage");
const invitationEmailTasks = new Map();
let invitationFormBusy = false;
let passwordFormBusy = false;
const passwordDialog = document.querySelector("#passwordDialog");
const passwordForm = document.querySelector("#passwordForm");
const passwordMessage = document.querySelector("#passwordMessage");
const companyUsersDialog = document.querySelector("#companyUsersDialog");
const companyUsersDialogBody = document.querySelector("#companyUsersDialogBody");
const crmTaskDialog = document.querySelector("#crmTaskDialog");
const crmTaskForm = document.querySelector("#crmTaskForm");
const crmProjectSelect = document.querySelector("#crmProjectSelect");
const crmAssigneeSelect = document.querySelector("#crmAssigneeSelect");
const overdueTasksDialog = document.querySelector("#overdueTasksDialog");
const overdueTasksView = document.querySelector("#overdueTasksView");

function saveProjects() {
  writeLocalStorage("solarObjectManager.projects", JSON.stringify(projects));
  queueCloudSync();
}

function savePendingCloudDeletes() {
  writeLocalStorage("solarObjectManager.pendingDeletes", JSON.stringify(pendingCloudDeletes));
}

function savePendingCrmDeletes() {
  writeLocalStorage("solarObjectManager.pendingCrmDeletes", JSON.stringify(pendingCrmDeletes));
}

function savePendingWarehouseDeletes() {
  writeLocalStorage("solarObjectManager.pendingWarehouseDeletes", JSON.stringify(pendingWarehouseDeletes));
}

function saveCrmTasks() {
  writeLocalStorage("solarObjectManager.crmTasks", JSON.stringify(crmTasks));
  renderCrmNotification();
  queueCrmSync();
}

function saveWarehouseItems() {
  writeLocalStorage("solarObjectManager.warehouseItems", JSON.stringify(warehouseItems));
  window.SpartaWarehouseUI?.capture();
  queueWarehouseSync();
}

function saveWarehouseMovements() {
  writeLocalStorage("solarObjectManager.warehouseMovements", JSON.stringify(warehouseMovements));
  window.SpartaWarehouseUI?.capture();
}

function projectFilesFor(projectId) {
  return projectFilesByProjectId[String(projectId || "")] || [];
}

function saveProjectFilesByProjectId() {
  writeLocalStorage("solarObjectManager.projectFiles", JSON.stringify(projectFilesByProjectId));
}

function saveProjectFileMetadata(project) {
  if (!project) return;
  const projectId = normalizeProjectId(project.id);
  projectFilesByProjectId[projectId] = (project.files || []).map((file) => ({
    category: file.category || "other",
    note: file.note || "",
    fileName: file.fileName || "",
    type: file.type || "application/octet-stream",
    size: Number(file.size || 0),
    fileKey: file.fileKey || "",
    storagePath: file.storagePath || "",
    // Signed URLs expire and must never become the durable file reference.
    src: file.storagePath ? "" : file.src || "",
    createdAt: file.createdAt || "",
    crmTaskId: file.crmTaskId || "",
    cashEntryId: file.cashEntryId || "",
    documentNumber: file.documentNumber || "",
    stage: file.stage || "",
  }));
  saveProjectFilesByProjectId();
}

function clearProjectFileMetadata(projectId) {
  delete projectFilesByProjectId[normalizeProjectId(projectId)];
  saveProjectFilesByProjectId();
}

function openProjectFileDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROJECT_FILE_DB, 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(PROJECT_FILE_STORE);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

async function putProjectFileBlob(key, file) {
  const db = await openProjectFileDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PROJECT_FILE_STORE, "readwrite");
    transaction.objectStore(PROJECT_FILE_STORE).put(file, key);
    transaction.addEventListener("complete", () => {
      db.close();
      resolve();
    });
    transaction.addEventListener("error", () => {
      db.close();
      reject(transaction.error);
    });
  });
}

async function getProjectFileBlob(key) {
  const db = await openProjectFileDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PROJECT_FILE_STORE, "readonly");
    const request = transaction.objectStore(PROJECT_FILE_STORE).get(key);
    request.addEventListener("success", () => resolve(request.result || null));
    request.addEventListener("error", () => reject(request.error));
    transaction.addEventListener("complete", () => db.close());
  });
}

async function deleteProjectFileBlob(key) {
  const db = await openProjectFileDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PROJECT_FILE_STORE, "readwrite");
    transaction.objectStore(PROJECT_FILE_STORE).delete(key);
    transaction.addEventListener("complete", () => {
      db.close();
      resolve();
    });
    transaction.addEventListener("error", () => {
      db.close();
      reject(transaction.error);
    });
  });
}

function normalizeProjectId(value) {
  return String(value || Date.now());
}

function queueCloudSync() {
  if (!cloudState.ready || cloudLoading) return;
  window.clearTimeout(cloudSyncTimer);
  cloudState.message = "Є зміни. Синхронізація...";
  renderProfileView();
  cloudSyncTimer = window.setTimeout(() => {
    syncProjectsToCloud().catch((error) => {
      cloudState.message = `Помилка синхронізації: ${error.message}`;
      renderProfileView();
    });
  }, 800);
}

function queueCrmSync() {
  window.clearTimeout(crmSyncTimer);
  crmSyncTimer = window.setTimeout(() => {
    if (!cloudState.ready) {
      renderProfileView();
      return;
    }

    syncCrmTasksToCloud().catch((error) => {
      cloudState.message = `Помилка синхронізації CRM: ${error.message}`;
      renderProfileView();
    });
  }, 300);
}

function queueWarehouseSync() {
  window.clearTimeout(warehouseSyncTimer);
  warehouseSyncTimer = window.setTimeout(() => {
    if (!cloudState.ready || !cloudState.supportsWarehouse) {
      renderProfileView();
      return;
    }

    syncWarehouseItemsToCloud().catch((error) => {
      cloudState.message = `Помилка синхронізації складу: ${error.message}`;
      renderProfileView();
    });
  }, 400);
}

function updateAccessMode() {
  const locked = !window.SPARTA_LOCAL_WORKSPACE?.enabled &&
    !(cloudState.enabled && cloudState.user && (cloudState.ready || window.SpartaBuyerCloud?.isBuyerReady()) && !cloudState.sessionLoading);
  document.body.classList.toggle("auth-locked", locked);
  if (locked) { window.SpartaSunGame?.reset(); window.SpartaWarehouseExcelUI?.reset(); }
  document.body.classList.toggle("buyer-audience", Boolean(window.SpartaBuyerCloud?.isBuyerReady()));
  if (locked && gateAuthMessage) gateAuthMessage.textContent = cloudState.message;
  window.SpartaOrderNotifications?.refreshAccess();
}

function supabaseConfig() {
  const config = window.SPARTA_SUPABASE_CONFIG;
  if (!config?.url || !config?.anonKey || config.url.includes("YOUR_PROJECT_ID")) return null;
  return {
    url: config.url,
    anonKey: config.anonKey,
    companyId: config.companyId && !config.companyId.includes("YOUR_") ? config.companyId : null,
  };
}

function projectToDb(project, includeChecklist = true) {
  const row = {
    client_id: normalizeProjectId(project.id),
    company_id: cloudState.companyId,
    title: project.title || "",
    currency: project.currency || "UAH",
    client_name: project.clientName || "",
    client_phone: project.clientPhone || "",
    address: project.address || "",
    object_type: project.objectType || "",
    status: project.status || "new",
    installation_date: project.installationDate || null,
    team_name: project.teamName || "",
    comment: project.comment || "",
    app_data: {
      clientEmail: project.clientEmail || "",
      statusHistory: project.statusHistory || [],
    },
    created_by: cloudState.user?.id || null,
  };

  if (includeChecklist) row.work_checklist = project.workChecklist || emptyInstallerChecklist();
  if (cloudState.supportsProjectFinance) row.finance = {
    ...(project.finance || emptyProjectFinance()),
    contractNumber: project.finance?.contractNumber ?? project.contractNumber ?? "",
    contractDate: project.finance?.contractDate ?? project.contractDate ?? "",
  };
  return row;
}

function technicalToDb(project, includePanelSerialNumbers = true, includeEquipmentDetails = true) {
  const technical = project.technical || {};
  const row = {
    panel_manufacturer: technical.panelManufacturer || "",
    panel_model: technical.panelModel || "",
    panel_power_w: Number(technical.panelPowerW || 0),
    panel_count: Number(technical.panelCount || 0),
    inverter_manufacturer: technical.inverterManufacturer || "",
    inverter_model: technical.inverterModel || "",
    inverter_power_kw: Number(technical.inverterPowerKw || 0),
    inverter_serial_number: technical.inverterSerialNumber || "",
    mppt_count: Number(technical.mpptCount || 0),
    pv_inputs_per_mppt: Number(technical.pvInputsPerMppt || 0),
    battery_manufacturer: technical.batteryManufacturer || "",
    battery_model: technical.batteryModel || "",
    battery_capacity_kwh: Number(technical.batteryCapacityKwh || 0),
    battery_modules_count: Number(technical.batteryModulesCount || 0),
    battery_serial_numbers: technical.batterySerialNumbers || "",
  };
  if (includePanelSerialNumbers) row.panel_serial_numbers = technical.panelSerialNumbers || "";
  if (includeEquipmentDetails) {
    row.equipment_details = {
      inverters: technical.inverters || [],
      batteries: technical.batteries || [],
      panelGroups: technical.panelGroups || [],
    };
  }
  return row;
}

const cloudMediaUrls = new Map();
let cloudMediaRefreshTimer = null;

function cloudMediaContext() {
  return cloudState.ready && cloudState.user?.id && cloudState.companyId
    ? `${cloudState.user.id}/${cloudState.companyId}` : "";
}

function clearCloudMediaUrls() {
  cloudMediaUrls.clear();
  window.clearTimeout(cloudMediaRefreshTimer);
  cloudMediaRefreshTimer = null;
}

function cachedCloudMediaUrl(bucket, storagePath) {
  const scope = cloudMediaContext();
  if (!scope || !storagePath) return "";
  const entry = cloudMediaUrls.get(`${scope}/${bucket}/${storagePath}`);
  return entry && entry.expiresAt > Date.now() ? entry.url : "";
}

async function signedCloudStorageUrl(bucket, storagePath, forceRefresh = false) {
  if (!storagePath) return "";
  if (![PHOTO_BUCKET, PROJECT_FILE_BUCKET, "warehouse-files"].includes(bucket)) throw new Error("Невідоме сховище файлів.");
  if (/^(?:https?:|data:|blob:|\/)/i.test(storagePath) || /[\u0000-\u001f]/.test(storagePath) || storagePath.split("/").includes("..")) {
    throw new Error("Некоректний шлях файлу у сховищі.");
  }
  const scope = cloudMediaContext();
  const client = cloudState.client;
  if (!scope || !client) throw new Error("Для доступу до файлу увійдіть в акаунт компанії.");
  const cached = cachedCloudMediaUrl(bucket, storagePath);
  if (cached && !forceRefresh) return cached;
  const { data, error } = await client.storage.from(bucket).createSignedUrl(storagePath, 3600);
  if (scope !== cloudMediaContext() || client !== cloudState.client) throw new Error("Обліковий запис змінився. Відкрийте файл повторно.");
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Не вдалося отримати захищене посилання на файл.");
  cloudMediaUrls.set(`${scope}/${bucket}/${storagePath}`, { url: data.signedUrl, expiresAt: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

function publicPhotoUrl(storagePath) {
  return cachedCloudMediaUrl(PHOTO_BUCKET, storagePath);
}

function publicProjectFileUrl(storagePath) {
  return cachedCloudMediaUrl(PROJECT_FILE_BUCKET, storagePath);
}

async function preloadCloudPhotoUrls(rows) {
  const scope = cloudMediaContext();
  if (!scope) return;
  const paths = [...new Set(rows.flatMap((row) => (row.project_photos || []).map((photo) => photo.storage_path).filter(Boolean)))];
  await Promise.all(paths.map((path) => signedCloudStorageUrl(PHOTO_BUCKET, path)));
  if (scope !== cloudMediaContext()) return;
  window.clearTimeout(cloudMediaRefreshTimer);
  cloudMediaRefreshTimer = window.setTimeout(refreshCloudPhotoUrls, 45 * 60 * 1000);
}

async function refreshCloudPhotoUrls() {
  const scope = cloudMediaContext();
  if (!scope) { clearCloudMediaUrls(); return; }
  try {
    const photoList = projects.flatMap((project) => project.photos || []).filter((photo) => photo.storagePath);
    const refreshed = await Promise.all(photoList.map(async (photo) => ({ photo, previous: photo.src, url: await signedCloudStorageUrl(PHOTO_BUCKET, photo.storagePath, true) })));
    if (scope !== cloudMediaContext()) return;
    refreshed.forEach(({ photo, previous, url }) => {
      photo.src = url;
      // Refresh only images, without resetting an open form or a document editor.
      document.querySelectorAll("img").forEach((image) => { if (image.getAttribute("src") === previous) image.setAttribute("src", url); });
    });
  } catch (error) {
    if (scope === cloudMediaContext()) { cloudState.message = `Не вдалося оновити доступ до фото: ${error.message}`; renderProfileView(); }
  } finally {
    if (scope === cloudMediaContext()) cloudMediaRefreshTimer = window.setTimeout(refreshCloudPhotoUrls, 45 * 60 * 1000);
  }
}

function dbProjectToApp(row) {
  return {
    id: row.client_id || row.id,
    cloudProjectId: row.id,
    dataRevision: Number(row.data_revision || 0),
    mediaRevision: Number(row.media_revision || 0),
    title: row.title || "",
    currency: row.currency || "UAH",
    clientName: row.client_name || "",
    clientPhone: row.client_phone || "",
    address: row.address || "",
    objectType: row.object_type || "",
    status: row.status || "new",
    installationDate: row.installation_date || "",
    teamName: row.team_name || "",
    comment: row.comment || "",
    clientEmail: row.app_data?.clientEmail || "",
    statusHistory: row.app_data?.statusHistory || [],
    contractNumber: row.finance?.contractNumber || "",
    contractDate: row.finance?.contractDate || "",
    workChecklist: row.work_checklist || emptyInstallerChecklist(),
    fieldChecklistBase: { ...(row.work_checklist || {}) },
    finance: row.finance || emptyProjectFinance(),
    technical: {
      panelManufacturer: row.project_technical?.panel_manufacturer || "",
      panelModel: row.project_technical?.panel_model || "",
      panelSerialNumbers: row.project_technical?.panel_serial_numbers || "",
      inverters: row.project_technical?.equipment_details?.inverters || [],
      batteries: row.project_technical?.equipment_details?.batteries || [],
      panelGroups: row.project_technical?.equipment_details?.panelGroups || [],
      panelPowerW: Number(row.project_technical?.panel_power_w || 0),
      panelCount: Number(row.project_technical?.panel_count || 0),
      inverterManufacturer: row.project_technical?.inverter_manufacturer || "",
      inverterModel: row.project_technical?.inverter_model || "",
      inverterPowerKw: Number(row.project_technical?.inverter_power_kw || 0),
      inverterSerialNumber: row.project_technical?.inverter_serial_number || "",
      mpptCount: Number(row.project_technical?.mppt_count || 0),
      pvInputsPerMppt: Number(row.project_technical?.pv_inputs_per_mppt || 0),
      hasBattery: Boolean(row.project_technical?.battery_manufacturer || row.project_technical?.battery_model || Number(row.project_technical?.battery_modules_count || 0)),
      batteryManufacturer: row.project_technical?.battery_manufacturer || "",
      batteryModel: row.project_technical?.battery_model || "",
      batteryCapacityKwh: Number(row.project_technical?.battery_capacity_kwh || 0),
      batteryModulesCount: Number(row.project_technical?.battery_modules_count || 0),
      batterySerialNumbers: row.project_technical?.battery_serial_numbers || "",
    },
    strings: (row.project_strings || []).map((item) => ({
      mpptNumber: Number(item.mppt_number || 0),
      pvInputNumber: Number(item.pv_input_number || 1),
      stringNumber: Number(item.string_number || 0),
      stringType: item.string_type || "normal",
      panelCount: Number(item.panel_count || 0),
      orientation: item.orientation || "",
      tiltAngle: Number(item.tilt_angle || 0),
      note: item.note || "",
    })),
    materials: (row.project_materials || []).map((item) => ({
      ...(item.app_data || {}),
      name: item.name || "",
      category: item.category || "Інше",
      plannedQty: Number(item.app_data?.plannedQty ?? item.quantity ?? 0),
      issuedQty: Number(item.app_data?.issuedQty ?? item.quantity ?? 0),
      actualQty: Number(item.app_data?.actualQty ?? item.quantity ?? 0),
      unit: item.unit || "шт",
    })),
    photos: (row.project_photos || []).map((item) => ({
      stage: item.app_data?.stage || "",
      crmTaskId: item.app_data?.crmTaskId || "",
      cashEntryId: item.app_data?.cashEntryId || "",
      category: item.category || "Інше",
      caption: item.caption || "",
      fileName: item.file_name || "",
      storagePath: item.storage_path || "",
      src: publicPhotoUrl(item.storage_path || ""),
      createdAt: item.created_at || "",
      equipmentType: item.equipment_type || "",
      equipmentId: item.equipment_id || "",
    })),
    files: projectFilesFor(row.client_id || row.id),
  };
}

function dbCrmTaskToApp(row) {
  return {
    id: row.client_task_id || row.id,
    cloudTaskId: row.id,
    cloudUpdatedAt: row.updated_at || "",
    projectId: row.project_client_id || "",
    title: row.title || "",
    note: row.note || "",
    type: row.task_type || "task",
    status: row.status || "planned",
    priority: row.priority || "normal",
    dueAt: row.due_at ? row.due_at.slice(0, 16) : "",
    assignedTo: row.assigned_to || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
  };
}

function crmTaskToDb(task) {
  return {
    client_task_id: normalizeProjectId(task.id),
    company_id: cloudState.companyId,
    project_client_id: task.projectId || null,
    title: task.title || "",
    note: task.note || "",
    task_type: task.type || "task",
    status: task.status || "planned",
    priority: task.priority || "normal",
    due_at: task.dueAt || null,
    assigned_to: task.assignedTo || cloudState.user?.id || null,
    created_by: task.createdBy || cloudState.user?.id || null,
  };
}

function normalizeWarehouseItem(item) {
  const salePrice = Number(item?.retailPrice ?? item?.salePrice ?? 0);
  return {
    ...item,
    currency: item?.currency || "UAH",
    id: item?.id || `wh-${Date.now()}`,
    name: item?.name || "",
    category: item?.category || "Інше",
    sku: item?.sku || "",
    unit: item?.unit || "шт",
    qty: Number(item?.qty || 0),
    purchasePrice: Number(item?.purchasePrice || 0),
    salePrice,
    installerPrice: Number(item?.installerPrice ?? 0),
    wholesalePrice: Number(item?.wholesalePrice ?? 0),
    retailPrice: Number(item?.retailPrice ?? salePrice ?? 0),
    deliveryCost: Number(item?.deliveryCost || 0),
    extraCost: Number(item?.extraCost || 0),
    minQty: Number(item?.minQty || 0),
    location: item?.location || "",
    serialNumber: item?.serialNumber || "",
    supplier: item?.supplier || "",
    characteristics: item?.characteristics || "",
  };
}

function dbWarehouseItemToApp(row) {
  return normalizeWarehouseItem({
    ...(row.app_data || {}),
    id: row.client_item_id || row.id,
    name: row.name || "",
    category: row.category || "Інше",
    sku: row.sku || "",
    unit: row.unit || "шт",
    qty: Number(row.quantity || 0),
    purchasePrice: Number(row.purchase_price || 0),
    salePrice: Number(row.sale_price || 0),
    installerPrice: Number(row.app_data?.installerPrice ?? 0),
    wholesalePrice: Number(row.app_data?.wholesalePrice ?? 0),
    retailPrice: Number(row.app_data?.retailPrice ?? row.sale_price ?? 0),
    deliveryCost: Number(row.app_data?.deliveryCost ?? 0),
    extraCost: Number(row.app_data?.extraCost ?? 0),
    minQty: Number(row.min_quantity || 0),
    location: row.location || "",
    serialNumber: row.app_data?.serialNumber || "",
    supplier: row.app_data?.supplier || "",
    characteristics: row.app_data?.characteristics || "",
  });
}

function warehouseItemToDb(item) {
  return {
    client_item_id: normalizeProjectId(item.id),
    company_id: cloudState.companyId,
    category: item.category || "Інше",
    name: item.name || "",
    sku: item.sku || "",
    unit: item.unit || "шт",
    quantity: Number(item.qty || 0),
    purchase_price: Number(item.purchasePrice || 0),
    sale_price: Number(item.retailPrice ?? item.salePrice ?? 0),
    min_quantity: Number(item.minQty || 0),
    location: item.location || "",
    app_data: { ...item },
    created_by: cloudState.user?.id || null,
  };
}

async function ensureSupabaseLibrary() {
  if (window.supabase?.createClient) return true;

  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "./supabase-js.umd.js?v=20261023";
      script.onload = resolve;
      script.onerror = () => reject(new Error("не вдалося завантажити локальну бібліотеку"));
      document.head.append(script);
    });
  } catch (error) {
    cloudState.message = `Supabase не запущено: ${error.message}`;
  }

  return Boolean(window.supabase?.createClient);
}

async function initCloud() {
  if (window.SPARTA_LOCAL_WORKSPACE?.enabled) {
    cloudState.client = null;
    cloudState.enabled = false;
    cloudState.ready = false;
    cloudState.companyId = window.SPARTA_LOCAL_WORKSPACE.companyId;
    cloudState.memberRole = "owner";
    cloudState.user = { id: "local-owner", email: "Локальна версія" };
    const storedMembers = readJsonStorage("solarObjectManager.localMembers", []);
    cloudState.members = Array.isArray(storedMembers) ? storedMembers : [];
    if (!cloudState.members.some((member) => member.user_id === "local-owner")) {
      cloudState.members.unshift({ user_id: "local-owner", role: "owner", is_active: true, profiles: { full_name: "Власник компанії", email: "Локальна версія" } });
    }
    cloudState.message = "Локальна база на цьому комп’ютері";
    if (window.SPARTA_LOCAL_WORKSPACE.initError) cloudState.message = window.SPARTA_LOCAL_WORKSPACE.initError;
    try {
      await window.SPARTA_LOCAL_WORKSPACE.prepareFiles();
    } catch (error) {
      cloudState.message = `Локальні картки збережені. Прикріплені файли потребують перевірки: ${error.message}`;
    }
    await window.SpartaCashBook?.sync();
    return;
  }
  cloudState.enabled = true;
  clearCompanyContext();
  cloudState.user = null;
  cloudState.message = "Перевіряю підключення до Supabase...";
  updateAccessMode();
  const config = supabaseConfig();
  if (!config) {
    cloudState.message = "Конфігурацію Supabase не знайдено. Онови сторінку.";
    return;
  }
  if (!(await ensureSupabaseLibrary())) return;

  cloudState.companyId = config.companyId || null;
  cloudState.client = window.supabase.createClient(config.url, config.anonKey);
  cloudState.authSubscription = cloudState.client.auth.onAuthStateChange(handleCloudAuthChange).data?.subscription;
  const { data, error } = await cloudState.client.auth.getSession();
  if (error) throw error;
  await applyCloudSession(data.session || null);
}

function handleCloudAuthChange(event, session) {
  window.SpartaAuthFlow?.onAuthEvent(event);
  if (window.SPARTA_LOCAL_WORKSPACE?.enabled) return;
  if (!session?.user) {
    clearCompanyContext();
    cloudState.user = null;
    cloudState.message = "Supabase підключено. Потрібен вхід користувача.";
    updateAccessMode();
    render();
    return;
  }
  if (session.user.id !== cloudState.user?.id) {
    clearCompanyContext();
    cloudState.user = null;
    cloudState.message = "Перевіряю доступ до компанії...";
    updateAccessMode();
    render();
  }
  // Supabase auth callbacks must return before another auth/database request.
  const revision = cloudContextRevision;
  window.setTimeout(() => {
    if (revision === cloudContextRevision) applyCloudSession(session).catch(() => {});
  }, 0);
}

async function applyCloudSession(session) {
  const user = session?.user || null;
  if (window.SPARTA_LOCAL_WORKSPACE?.enabled) return true;
  if (user?.id && cloudSessionTask && cloudSessionUserId === user.id) return cloudSessionTask;
  if (user?.id && cloudState.user?.id === user.id && (cloudState.ready || window.SpartaBuyerCloud?.isBuyerReady()) && !cloudState.sessionLoading) { window.SpartaAuthFlow?.afterSession(); return true; }
  clearCompanyContext();
  cloudState.user = user;
  cloudState.sessionLoading = Boolean(user);
  cloudState.message = user ? "Перевіряю доступ до компанії..." : "Supabase підключено. Потрібен вхід користувача.";
  updateAccessMode();
  if (!user) { render(); return false; }
  const revision = cloudContextRevision;
  cloudSessionUserId = user.id;
  const task = (async () => {
    try {
      await loadCompanyContext();
      if (revision !== cloudContextRevision) return false;
      if (window.SpartaBuyerCloud?.isBuyerReady()) {
        cloudState.sessionLoading = false;
        await window.SpartaAuthFlow?.recordSession("login").catch(() => {});
        window.SpartaAuthFlow?.afterSession(); updateAccessMode(); render();
        return true;
      }
      if (!cloudState.ready) return false;
      await verifyPublicSchema();
      if (revision !== cloudContextRevision) return false;
      await loadProjectsFromCloud();
      if (revision !== cloudContextRevision) return false;
      await loadCrmTasksFromCloud();
      if (revision !== cloudContextRevision) return false;
      await loadWarehouseItemsFromCloud();
      if (revision !== cloudContextRevision) return false;
      await window.SpartaCashBook?.sync();
      if (revision !== cloudContextRevision) return false;
      cloudState.sessionLoading = false;
      await window.SpartaAuthFlow?.recordSession("login").catch((error) => { cloudState.message = error.message; });
      window.SpartaAuthFlow?.afterSession();
      updateAccessMode();
      render();
      return true;
    } catch (error) {
      if (revision === cloudContextRevision) {
        clearCompanyContext();
        cloudState.message = `Не вдалося завантажити базу компанії: ${error.message}`;
        updateAccessMode();
        render();
      }
      throw error;
    } finally {
      if (cloudState.user?.id === user.id) window.SpartaAuthFlow?.afterSession();
      if (cloudSessionTask === task) { cloudSessionTask = null; cloudSessionUserId = ""; }
      if (revision === cloudContextRevision && !cloudState.ready && !window.SpartaBuyerCloud?.isBuyerReady()) {
        cloudState.sessionLoading = false;
        updateAccessMode();
        render();
      }
    }
  })();
  cloudSessionTask = task;
  return task;
}

async function loadCompanyContext() {
  if (!cloudState.client || !cloudState.user) return;
  const revision = cloudContextRevision;
  let query = cloudState.client
    .from("company_members")
    .select("company_id, role, companies(name)")
    .eq("user_id", cloudState.user.id)
    .eq("is_active", true)
    .limit(1);

  if (cloudState.companyId) query = query.eq("company_id", cloudState.companyId);
  const { data, error } = await query;
  if (revision !== cloudContextRevision) return;
  if (error) throw error;

  const member = data?.[0];
  if (!member) {
    const accepted = await acceptPendingInvitation();
    if (revision !== cloudContextRevision) return;
    if (accepted) return loadCompanyContext();

    const buyer = await window.SpartaBuyerCloud?.restore();
    if (revision !== cloudContextRevision) return;
    if (buyer) {
      cloudState.audience = "buyer";
      cloudState.buyerAccountId = buyer.id;
      cloudState.companyId = buyer.companyId;
      cloudState.memberRole = null;
      // ready is deliberately staff-only; buyer access has its own verified context.
      cloudState.ready = false;
      cloudState.message = "Кабінет покупця підключено.";
      return;
    }
    clearCompanyContext();
    cloudState.message = "Для цього email немає активного доступу. Попросіть компанію надіслати запрошення працівника або покупця.";
    updateAccessMode();
    render();
    return;
  }

  cloudState.companyId = member.company_id;
  cloudState.memberRole = member.role;
  cloudState.audience = "staff";
  cloudStorageScope = `sparta.cloud.v1.${encodeURIComponent(cloudState.user.id)}.${encodeURIComponent(member.company_id)}.`;
  cloudState.ready = true;
  cloudState.message = `Онлайн: ${member.companies?.name || "компанія"} / ${member.role}`;
  await loadCompanyPeople();
}

async function acceptPendingInvitation() {
  if (!cloudState.client || !cloudState.user) return false;
  const { data, error } = await cloudState.client.rpc("accept_company_invitation");
  if (error) {
    cloudState.message = `Помилка прийняття запрошення: ${error.message}`;
    return false;
  }
  return Boolean(data?.length);
}

async function retryAcceptInvitation() {
  if (!cloudState.user) {
    cloudState.message = "Спочатку увійди в акаунт.";
    renderProfileView();
    return;
  }

  cloudState.message = "Перевіряю запрошення...";
  renderProfileView();
  const accepted = await acceptPendingInvitation();
  if (!accepted) {
    cloudState.message = `Запрошення для ${cloudState.user.email || "цього email"} не знайдено. Перевір email у запрошенні.`;
    renderProfileView();
    return;
  }

  await applyCloudSession({ user: cloudState.user });
}

async function loadCompanyPeople() {
  if (!cloudState.ready) return;
  const revision = cloudContextRevision;
  if (["owner", "admin"].includes(cloudState.memberRole)) {
    const { data, error } = await cloudState.client.rpc("sparta_team_list", { p_company_id: cloudState.companyId });
    if (revision !== cloudContextRevision) return;
    if (error) throw error;
    cloudState.members = (data.members || []).map((member) => ({ user_id: member.userId, role: member.role, is_active: member.isActive, profiles: { email: member.email, full_name: member.fullName, phone: member.phone } }));
    cloudState.invitations = (data.invitations || []).map((item) => ({ id: item.id, email: item.email, full_name: item.fullName, role: item.role, status: item.status, expires_at: item.expiresAt, accepted_at: item.status === "accepted" ? item.createdAt : null, revoked_at: item.status === "revoked" ? item.createdAt : null }));
  } else {
    const { data, error } = await cloudState.client.from("company_members").select("user_id,role,is_active,profiles(email,full_name,phone)").eq("company_id", cloudState.companyId).eq("is_active", true);
    if (revision !== cloudContextRevision) return;
    if (error) throw error;
    cloudState.members = data || []; cloudState.invitations = [];
  }
}

async function loadProjectsFromCloud() {
  if (!cloudState.ready) return;
  const revision = cloudContextRevision;
  cloudLoading = true;
  const { data, error } = await cloudState.client
    .rpc("sparta_project_list", { p_company_id: cloudState.companyId });
  if (revision !== cloudContextRevision) return;
  cloudLoading = false;
  if (error) throw error;

  await preloadCloudPhotoUrls(data || []);
  if (revision !== cloudContextRevision) return;
  projects = (data || []).map(dbProjectToApp);
  projects.forEach((project) => { project.dataCloudSnapshot = projectDataFingerprint(projectDataPayload(project)); });
  await loadProjectFilesFromCloud();
  if (revision !== cloudContextRevision) return;
  projects.forEach((project) => { project.mediaCloudSnapshot = JSON.stringify(projectMediaPayload(project)); });
  selectedProjectId = projects[0] ? normalizeProjectId(projects[0].id) : "";
  writeLocalStorage("solarObjectManager.projects", JSON.stringify(projects));
}

async function loadProjectFilesFromCloud() {
  if (!cloudState.ready || !projects.length) return;
  const scope = cloudMediaContext();
  const contextRevision = typeof cloudContextRevision === "number" ? cloudContextRevision : 0;

  const projectIds = projects.map((project) => normalizeProjectId(project.id));
  const { data, error } = await cloudState.client
    .from("project_files")
    .select("category, note, file_name, mime_type, file_size, storage_path, created_at, app_data, projects!inner(client_id)")
    .in("projects.client_id", projectIds)
    .eq("projects.company_id", cloudState.companyId)
    .order("created_at", { ascending: false });

  if (scope !== cloudMediaContext() || (typeof cloudContextRevision === "number" && contextRevision !== cloudContextRevision)) return;

  if (error) {
    throw new Error(`Не вдалося завантажити файли з Supabase: ${error.message}`);
  }

  const nextFilesByProjectId = {};
  (data || []).forEach((item) => {
    const clientId = normalizeProjectId(item.projects?.client_id || "");
    if (!clientId) return;
    nextFilesByProjectId[clientId] ||= [];
    nextFilesByProjectId[clientId].push({
      stage: item.app_data?.stage || "",
      crmTaskId: item.app_data?.crmTaskId || "",
      cashEntryId: item.app_data?.cashEntryId || "",
      documentNumber: item.app_data?.documentNumber || "",
      category: item.category || "other",
      note: item.note || "",
      fileName: item.file_name || "",
      type: item.mime_type || "application/octet-stream",
      size: Number(item.file_size || 0),
      storagePath: item.storage_path || "",
      src: "",
      createdAt: item.created_at || "",
    });
  });

  projectFilesByProjectId = nextFilesByProjectId;
  saveProjectFilesByProjectId();
  projects.forEach((project) => {
    project.files = projectFilesFor(project.id);
  });
}

async function loadCrmTasksFromCloud() {
  if (!cloudState.ready) return;
  const revision = cloudContextRevision;

  const { data, error } = await cloudState.client
    .from("project_tasks")
    .select("*")
    .eq("company_id", cloudState.companyId)
    .order("created_at", { ascending: false });
  if (revision !== cloudContextRevision) return;

  if (error) {
    throw new Error(`CRM-задачі ще не підключені в Supabase: ${error.message}`);
  }

  crmTasks = (data || []).map(dbCrmTaskToApp);
  crmTasks.forEach((task) => { task.cloudSnapshot = JSON.stringify(crmTaskToDb(task)); });
  writeLocalStorage("solarObjectManager.crmTasks", JSON.stringify(crmTasks));
  renderCrmNotification();
}

async function loadWarehouseItemsFromCloud() {
  if (!cloudState.ready || !cloudState.supportsWarehouse) return;
  const revision = cloudContextRevision;

  const { data, error } = await cloudState.client
    .from("warehouse_items")
    .select("*")
    .eq("company_id", cloudState.companyId)
    .order("created_at", { ascending: false });
  if (revision !== cloudContextRevision) return;

  if (error) {
    throw new Error(`Склад ще не підключений у Supabase: ${error.message}`);
  }

  warehouseItems = (data || []).map(dbWarehouseItemToApp);
  writeLocalStorage("solarObjectManager.warehouseItems", JSON.stringify(warehouseItems));
  if (window.SpartaWarehouseCloud && !window.SPARTA_LOCAL_WORKSPACE?.enabled) await window.SpartaWarehouseCloud.load();
}

// A request that started in one account must never continue after sign-out or a company switch.
function guardedCloudWriteClient() {
  const revision = cloudContextRevision;
  const client = cloudState.client;
  const userId = cloudState.user?.id;
  const companyId = cloudState.companyId;
  const assertContext = () => {
    if (revision !== cloudContextRevision || client !== cloudState.client || userId !== cloudState.user?.id || companyId !== cloudState.companyId || !cloudState.ready) {
      throw new Error("Обліковий запис змінився. Збереження перервано; відкрийте об’єкт повторно.");
    }
  };
  const wrap = (query) => new Proxy(query, {
    get(target, key) {
      if (key === "then") return (resolve, reject) => {
        try { assertContext(); } catch (error) { return Promise.reject(error).then(resolve, reject); }
        return Promise.resolve(target).then((result) => { assertContext(); return result; }).then(resolve, reject);
      };
      const value = target[key];
      return typeof value === "function" ? (...args) => { assertContext(); return wrap(value.apply(target, args)); } : value;
    },
  });
  return {
    from(table) { assertContext(); return wrap(client.from(table)); },
    rpc(name, params) { assertContext(); return wrap(client.rpc(name, params)); },
  };
}

async function verifyPublicSchema() {
  if (window.SPARTA_LOCAL_WORKSPACE?.enabled) return;
  const client = guardedCloudWriteClient();
  const requirements = [
    ["projects", "id,currency,app_data,work_checklist,data_revision,media_revision"],
    ["project_technical", "project_id,panel_serial_numbers,equipment_details"],
    ["project_materials", "id,app_data"],
    ["project_photos", "id,app_data,equipment_type,equipment_id"],
    ["project_files", "id,app_data"],
    ["project_tasks", "id,assigned_to"],
    ["warehouse_items", "id,app_data"],
    ["cash_transactions", "id,currency"],
  ];
  for (const [table, columns] of requirements) {
    const { error } = await client.from(table).select(columns).limit(0);
    if (error) throw new Error(`База потребує оновлення (${table}). Застосуйте міграцію build 36 перед початком роботи.`);
  }
}

async function syncWarehouseItemsToCloud() {
  const writeClient = guardedCloudWriteClient();
  if (!cloudState.ready || !cloudState.supportsWarehouse) return;
  if (!window.SPARTA_LOCAL_WORKSPACE?.enabled && window.SpartaWarehouseCloud) {
    await window.SpartaWarehouseCloud.load();
    return;
  }

  if (pendingWarehouseDeletes.length) {
    const idsToDelete = [...new Set(pendingWarehouseDeletes.map(normalizeProjectId))];
    const { error } = await writeClient
      .from("warehouse_items")
      .delete()
      .eq("company_id", cloudState.companyId)
      .in("client_item_id", idsToDelete);
    if (error) throw error;

    pendingWarehouseDeletes = pendingWarehouseDeletes.filter((id) => !idsToDelete.includes(normalizeProjectId(id)));
    savePendingWarehouseDeletes();
  }

  if (warehouseItems.length) {
    const { error } = await writeClient
      .from("warehouse_items")
      .upsert(warehouseItems.map(warehouseItemToDb), { onConflict: "company_id,client_item_id" });
    if (error) throw error;
  }

  cloudState.message = `Склад синхронізовано ${new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`;
  renderProfileView();
}

async function syncCrmTasksToCloud() {
  const writeClient = guardedCloudWriteClient();
  if (!cloudState.ready) return;

  if (pendingCrmDeletes.length) {
    if (!canCreateCrmTasks()) throw new Error("Видаляти задачі може менеджер, власник або адміністратор.");
    const idsToDelete = [...new Set(pendingCrmDeletes.map(normalizeProjectId))];
    const { error } = await writeClient
      .from("project_tasks")
      .delete()
      .eq("company_id", cloudState.companyId)
      .in("client_task_id", idsToDelete);
    if (error) throw error;

    pendingCrmDeletes = pendingCrmDeletes.filter((id) => !idsToDelete.includes(normalizeProjectId(id)));
    savePendingCrmDeletes();
  }

  for (const task of crmTasks) {
    if (!canManageCrmTask(task)) continue;
    const payload = crmTaskToDb(task);
    const fingerprint = JSON.stringify(payload);
    if (task.cloudTaskId && task.cloudSnapshot === fingerprint) continue;
    let query;
    if (task.cloudTaskId) {
      const changes = canCreateCrmTasks() ? { ...payload } : { status: payload.status, note: payload.note };
      delete changes.created_by;
      query = writeClient.from("project_tasks").update(changes).eq("company_id", cloudState.companyId).eq("id", task.cloudTaskId).eq("updated_at", task.cloudUpdatedAt);
    } else {
      if (!canCreateCrmTasks()) throw new Error("Задача ще не завантажена з бази. Оновіть список задач.");
      query = writeClient.from("project_tasks").insert(payload);
    }
    const { data, error } = await query.select("id,updated_at").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Задача змінилася на іншому пристрої. Оновіть список перед збереженням.");
    task.cloudTaskId = data.id;
    task.cloudUpdatedAt = data.updated_at;
    task.cloudSnapshot = fingerprint;
  }
  writeLocalStorage("solarObjectManager.crmTasks", JSON.stringify(crmTasks));

  cloudState.message = `CRM синхронізовано ${new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`;
  renderProfileView();
}

function projectDataPayload(project) {
  const row = projectToDb(project);
  delete row.created_by; // PostgreSQL assigns the actor; it is not editable data.
  if (!["owner", "admin"].includes(cloudState.memberRole)) delete row.finance;
  return {
    project: row,
    technical: technicalToDb(project),
    strings: (project.strings || []).map((item) => ({
      mppt_number: Number(item.mpptNumber || 0), pv_input_number: Number(item.pvInputNumber || 1),
      string_number: Number(item.stringNumber || 0), string_type: item.stringType || "normal",
      panel_count: Number(item.panelCount || 0), orientation: item.orientation || "",
      tilt_angle: Number(item.tiltAngle || 0), note: item.note || "",
    })),
  };
}

function projectDataFingerprint(payload) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  const value = canonical(payload);
  value.strings.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(value);
}

async function saveProjectDataToCloud(project, writeClient) {
  const payload = projectDataPayload(project);
  const fingerprint = projectDataFingerprint(payload);
  if (project.cloudProjectId && fingerprint === project.dataCloudSnapshot) return project.cloudProjectId;
  const revision = Number(project.dataRevision || 0);
  const { data, error } = await writeClient.rpc("sparta_project_save", {
    p_company_id: cloudState.companyId, p_payload: payload, p_expected_revision: revision,
  });
  if (error) {
    if (error.code === "40001") throw new Error("Картку або технічні дані об’єкта вже змінено на іншому пристрої. Ваші зміни залишилися в цьому браузері. Оновіть об’єкт перед повторним збереженням.");
    throw new Error(`Картку об’єкта не збережено: ${error.message}`);
  }
  if (!data?.id || !Number.isSafeInteger(Number(data.dataRevision)) || Number(data.dataRevision) !== revision + 1) throw new Error("Сервер не підтвердив збереження картки об’єкта.");
  project.cloudProjectId = data.id;
  project.dataRevision = Number(data.dataRevision);
  project.dataCloudSnapshot = fingerprint;
  return data.id;
}

async function syncProjectsToCloud() {
  if (!cloudState.ready) return;
  if (syncProjectsToCloud.task) {
    syncProjectsToCloud.repeat = true;
    return syncProjectsToCloud.task;
  }
  const revision = cloudContextRevision;
  const task = (async () => {
    do {
      syncProjectsToCloud.repeat = false;
      await syncProjectsCloudBatch();
    } while (syncProjectsToCloud.repeat && revision === cloudContextRevision && cloudState.ready);
  })();
  syncProjectsToCloud.task = task;
  try { return await task; }
  finally { if (syncProjectsToCloud.task === task) syncProjectsToCloud.task = null; }
}

async function syncProjectsCloudBatch() {
  const writeClient = guardedCloudWriteClient();
  if (!cloudState.ready) return;
  if (!window.SPARTA_LOCAL_WORKSPACE?.enabled && !canEditProjectData()) {
    if (["installer", "brigadier"].includes(cloudState.memberRole)) await syncFieldProjectsToCloud(writeClient);
    return;
  }

  if (pendingCloudDeletes.length) {
    const idsToDelete = [...new Set(pendingCloudDeletes.map(normalizeProjectId))];
    const { error } = await writeClient
      .from("projects")
      .delete()
      .eq("company_id", cloudState.companyId)
      .in("client_id", idsToDelete);
    if (error) throw error;

    pendingCloudDeletes = pendingCloudDeletes.filter((id) => !idsToDelete.includes(normalizeProjectId(id)));
    savePendingCloudDeletes();
  }

  for (const project of projects) {
    const projectId = await saveProjectDataToCloud(project, writeClient);

    if (!window.SPARTA_LOCAL_WORKSPACE?.enabled && window.SpartaWarehouseCloud) {
      await window.SpartaWarehouseCloud.saveProjectMaterials(project.id, project.materials || [], window.SpartaWarehouseCloud.baseMaterials(project.id) ?? []);
    } else {
      const { error: deleteMaterialsError } = await writeClient.from("project_materials").delete().eq("project_id", projectId);
      if (deleteMaterialsError) throw deleteMaterialsError;
      if (project.materials?.length) {
        const { error } = await writeClient.from("project_materials").insert(project.materials.map((item) => ({
          project_id: projectId,
          category: item.category || "Інше",
          name: item.name || "",
          quantity: Number(item.actualQty ?? item.plannedQty ?? 0),
          unit: item.unit || "шт",
          app_data: { ...item },
        })));
        if (error) throw error;
      }
    }

    await syncProjectFilesToCloud(project, projectId, writeClient);
  }

  cloudState.message = `Синхронізовано ${new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`;
  renderProfileView();
}

function normalizeFieldChecklist(value = {}) {
  return installerChecklistItemIds.reduce((result, id) => { result[id] = value[id] === true; return result; }, {});
}

async function syncFieldProjectsToCloud(writeClient = guardedCloudWriteClient()) {
  if (!cloudState.ready || !["installer", "brigadier"].includes(cloudState.memberRole)) return;
  for (const project of projects) {
    const desired = normalizeFieldChecklist(project.workChecklist);
    const { data: remote, error: readError } = await writeClient.from("projects")
      .select("id,work_checklist,data_revision").eq("company_id", cloudState.companyId).eq("client_id", normalizeProjectId(project.id)).maybeSingle();
    if (readError) throw readError;
    if (!remote) throw new Error("Монтажник працює з наявними об’єктами. Новий об’єкт має додати менеджер.");
    const before = normalizeFieldChecklist(project.fieldChecklistBase || remote.work_checklist);
    const changes = {}, expected = {};
    installerChecklistItemIds.forEach((id) => { if (desired[id] !== before[id]) { changes[id] = desired[id]; expected[id] = before[id]; } });
    let savedChecklist = normalizeFieldChecklist(remote.work_checklist);
    let savedRevision = Number(remote.data_revision || 0);
    if (Object.keys(changes).length) {
      const { data, error } = await writeClient.rpc("update_project_field_checklist", { p_project_id: remote.id, p_changes: changes, p_expected: expected });
      if (error) {
        if (error.code === "40001") throw new Error("Цю позначку монтажу вже змінено на іншому пристрої. Оновіть дані перед повторною зміною.");
        throw new Error(`Чекліст не збережено в Supabase: ${error.message}`);
      }
      if (!data?.checklist || !Number.isSafeInteger(Number(data.dataRevision))) throw new Error("Сервер не підтвердив збереження чекліста.");
      savedChecklist = normalizeFieldChecklist(data.checklist);
      savedRevision = Number(data.dataRevision);
    }
    project.fieldChecklistBase = { ...savedChecklist };
    project.dataRevision = savedRevision;
    project.workChecklist ||= {};
    installerChecklistItemIds.forEach((id) => {
      if ((project.workChecklist[id] === true) === desired[id]) project.workChecklist[id] = savedChecklist[id];
    });
    await syncProjectFilesToCloud(project, remote.id, writeClient);
  }
  cloudState.message = `Монтаж синхронізовано ${new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`;
  renderProfileView();
}

function canEditProjectData() {
  return Boolean(window.SPARTA_LOCAL_WORKSPACE?.enabled || (cloudState.ready && ["owner", "admin", "engineer"].includes(cloudState.memberRole)));
}

function canEditProjectField() {
  return canEditProjectData() || Boolean(cloudState.ready && ["installer", "brigadier"].includes(cloudState.memberRole));
}

function canManageProjectFinance() {
  return Boolean(window.SPARTA_LOCAL_WORKSPACE?.enabled || (cloudState.ready && ["owner", "admin"].includes(cloudState.memberRole)));
}

function requireProjectRole(kind = "data") {
  if (kind === "finance") { if (canManageProjectFinance()) return true; alert("Кошторис, договір і фінанси змінює власник або адміністратор."); return false; }
  if (kind === "field" ? canEditProjectField() : canEditProjectData()) return true;
  alert(kind === "field" ? "Для цієї ролі об’єкт доступний для перегляду." : "Дані об’єкта, обладнання та кошторис змінює менеджер. Монтажнику доступні чекліст, фото, документи й CRM-задачі.");
  return false;
}

const officeProjectControls = "#newProjectButton,#newProjectQuickButton,#editProjectInfoButton,#editTechnicalButton,#editStringsButton,#saveStringsEditButton,#editMaterialsButton,#saveMaterialsEditButton,#deleteProjectButton,#copyOfferToMaterialsButton,#projectStatusSelect,#projectForm,#projectInfoForm,#technicalForm,#materialForm,#projectFinanceForm,#projectExpenseForm,#commercialOfferLineForm,#commercialOfferTotalsForm,.equipment-form,[data-delete-string-index],[data-delete-material-index],[data-delete-equipment-type],[data-delete-offer-line],[data-delete-expense-index],[data-project-stock-picker]";
const financeProjectControls = "#projectFinanceForm,#projectExpenseForm,#commercialOfferLineForm,#commercialOfferTotalsForm,#copyOfferToMaterialsButton,[data-delete-offer-line],[data-delete-expense-index],[data-project-stock-picker='offer']";
const fieldProjectControls = "[data-work-checklist-item],[data-checklist-action],#photoForm,#projectFileForm,[data-equipment-photo-id],[data-crm-task-photo],[data-delete-photo-index],[data-delete-file-index]";

function applyProjectRoleControls() {
  [[officeProjectControls, canEditProjectData()], [fieldProjectControls, canEditProjectField()], [financeProjectControls, canManageProjectFinance()]].forEach(([selector, allowed]) => {
    document.querySelectorAll(selector).forEach((element) => {
      if (element.matches("input,select,textarea")) element.disabled = !allowed;
      else element.style.display = allowed ? "" : "none";
    });
  });
  refreshTeamNavigation();
  const existing = projectDetail.querySelector("[data-project-role-note]");
  if (canEditProjectData()) existing?.remove();
  else if (selectedProject() && !existing) {
    const note = document.createElement("p"); note.className = "calculation-note"; note.dataset.projectRoleNote = "true";
    note.textContent = canEditProjectField() ? "Режим монтажника: чекліст, фото, документи та CRM-задачі. Обладнання, кошторис і статус об’єкта змінює менеджер." : "Об’єкт доступний для перегляду. Зміни вносить менеджер або призначений монтажник.";
    projectDetail.prepend(note);
  }
}

function guardProjectRoleAction(event) {
  if (!event.target?.closest) return;
  const financeBlocked = !canManageProjectFinance() && event.target.closest(financeProjectControls);
  const officeBlocked = !canEditProjectData() && event.target.closest(officeProjectControls);
  const fieldBlocked = !canEditProjectField() && event.target.closest(fieldProjectControls);
  if (!officeBlocked && !fieldBlocked && !financeBlocked) return;
  event.preventDefault(); event.stopImmediatePropagation();
  requireProjectRole(financeBlocked ? "finance" : officeBlocked ? "data" : "field");
}

function projectMediaPayload(project) {
  const photos = (project.photos || []).filter((item) => typeof item !== "string" && item.storagePath).map((item) => ({
    category: item.category || "Інше", caption: item.caption || "", file_name: item.fileName || "",
    storage_path: item.storagePath, created_at: item.createdAt || "", equipment_type: item.equipmentType || "", equipment_id: item.equipmentId || "",
    app_data: { stage: item.stage || "", crmTaskId: item.crmTaskId || "", cashEntryId: item.cashEntryId || "" },
  }));
  const files = (project.files || []).filter((item) => item.storagePath).map((item) => ({
    category: item.category || "other", note: item.note || "", file_name: item.fileName || "", mime_type: item.type || "application/octet-stream",
    file_size: Number(item.size || 0), storage_path: item.storagePath, created_at: item.createdAt || "",
    app_data: { stage: item.stage || "", crmTaskId: item.crmTaskId || "", cashEntryId: item.cashEntryId || "", documentNumber: item.documentNumber || "" },
  }));
  const compare = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b));
  photos.sort(compare); files.sort(compare);
  return { photos, files };
}

async function syncProjectFilesToCloud(project, projectId, writeClient = guardedCloudWriteClient()) {
  const payload = projectMediaPayload(project);
  const snapshot = JSON.stringify(payload);
  if (snapshot === project.mediaCloudSnapshot) return;
  const { data, error } = await writeClient.rpc("replace_project_media", {
    p_project_id: projectId, p_expected_revision: Number(project.mediaRevision || 0), p_photos: payload.photos, p_files: payload.files,
  });
  if (error) {
    if (error.code === "40001") throw new Error("Фото або файли вже змінено на іншому пристрої. Збережіть нові файли й оновіть дані перед повторною зміною.");
    throw new Error(`Фото й файли не збережено в Supabase: ${error.message}`);
  }
  if (!Number.isSafeInteger(Number(data)) || Number(data) <= Number(project.mediaRevision || 0)) throw new Error("Сервер не підтвердив збереження фото й файлів.");
  project.mediaRevision = Number(data);
  project.mediaCloudSnapshot = snapshot;
}

function totalPower(project) {
  return ((project.technical.panelCount * project.technical.panelPowerW) / 1000).toFixed(2);
}

function batteryTotalCapacity(project) {
  return (Number(project.technical.batteryCapacityKwh || 0) * Number(project.technical.batteryModulesCount || 0)).toFixed(2);
}

function stringPanelCount(project) {
  return project.strings.reduce((sum, item) => sum + effectiveStringPanels(item), 0);
}

function materialDifference(material) {
  return Number(material.issuedQty || material.plannedQty || 0) - Number(material.actualQty || 0);
}

function materialCategoryOptions(selectedValue = "Інше") {
  return Object.keys(materialCatalog()).map((category) => `<option value="${category}" ${selectedAttr(selectedValue, category)}>${category}</option>`).join("");
}

function materialCatalog() {
  return {
    "Обладнання": [
      "Сонячна панель",
      "Інвертор",
      "АКБ",
      "BMS / контролер АКБ",
      "Лічильник / smart meter",
    ],
    "Кріплення": [
      "Профіль оцинкований 41/41 3м",
      "Блок безпрофільної системи 200 мм",
      "Блок безпрофільної системи 250 мм",
      "Блок безпрофільної системи 300 мм",
      "Притиск міжпанельний",
      "Притиск торцевий",
      "Болт",
      "Гайка",
      "Шайба",
      "Заклепка пелюсткова",
    ],
    "Кабель": [
      "Сонячний кабель 4 мм2",
      "Сонячний кабель 6 мм2",
      "Кабель AC 3x2.5",
      "Кабель AC 3x4",
      "Кабель AC 5x6",
      "Кабель заземлення",
      "Гофра / труба для кабелю",
      "Кабель-канал",
    ],
    "Захист AC": [
      "Автомат AC 1P",
      "Автомат AC 2P",
      "Автомат AC 3P",
      "Автомат AC 4P",
      "ПЗІП AC",
      "УЗО / дифавтомат",
      "Реле напруги",
      "Щит AC",
      "Шина N/PE",
    ],
    "Захист DC": [
      "Автомат DC",
      "Запобіжник DC",
      "Тримач запобіжника DC",
      "ПЗІП DC",
      "Роз'єднувач DC",
      "Щит DC",
      "Конектор MC4",
      "Y-конектор MC4",
    ],
    "Заземлення": [
      "Комплект заземлення",
      "Шина заземлення",
      "Затискач заземлення",
      "Провід заземлення",
    ],
    "Витратні матеріали": [
      "Стяжки",
      "Ізолента",
      "Маркування кабелю",
      "Герметик",
      "Саморіз",
      "Дюбель",
    ],
    "Інше": [
      "Інший матеріал",
    ],
  };
}

function materialCatalogOptions(category, selectedValue = "") {
  const options = materialCatalog()[category] || materialCatalog()["Інше"];
  return [
    `<option value="">Оберіть матеріал</option>`,
    ...options.map((item) => `<option value="${item}" ${selectedAttr(selectedValue, item)}>${item}</option>`),
    `<option value="custom" ${selectedAttr(selectedValue, "custom")}>Інший матеріал</option>`,
  ].join("");
}

function defaultMaterialUnit(name) {
  const lowerName = String(name || "").toLowerCase();
  if (lowerName.includes("блок безпрофільної системи")) {
    return "шт";
  }
  if (lowerName.includes("кабель") || lowerName.includes("профіль") || lowerName.includes("гофра") || lowerName.includes("труба") || lowerName.includes("канал") || lowerName.includes("провід")) {
    return "м";
  }
  if (lowerName.includes("комплект")) {
    return "компл";
  }
  return "шт";
}

function effectiveStringPanels(item) {
  const multiplier = item.stringType === "parallel" ? 2 : 1;
  return Number(item.panelCount || 0) * multiplier;
}

function stringPowerKw(project, item) {
  return ((effectiveStringPanels(item) * Number(project.technical.panelPowerW || 0)) / 1000).toFixed(2);
}

function stringTypeLabel(type) {
  return type === "parallel" ? "Паралельний" : "Звичайний";
}

function formatBatteryPassport(project) {
  const technical = project.technical;
  if (!technical.batteryManufacturer && !technical.batteryModel && !Number(technical.batteryModulesCount || 0)) {
    return "Система збереження не встановлена або дані не вказані.";
  }

  const serials = technical.batterySerialNumbers ? ` Серійні номери: ${technical.batterySerialNumbers}.` : "";
  return `${formatCombined(technical.batteryManufacturer, technical.batteryModel)}, ${technical.batteryModulesCount || 0} мод. × ${technical.batteryCapacityKwh || 0} кВт·год, загальна ємність ${batteryTotalCapacity(project)} кВт·год.${serials}`;
}

function passportChecklist(project) {
  return [
    ["Клієнт", Boolean(project.clientName)],
    ["Адреса об'єкта", Boolean(project.address)],
    ["Дата монтажу", Boolean(project.installationDate)],
    ["Фотомодулі", Boolean(project.technical.panelModel && Number(project.technical.panelCount || 0))],
    ["Інвертор", Boolean(project.technical.inverterModel)],
    ["MPPT / стрінги", project.strings.length > 0],
    ["Матеріали", project.materials.length > 0],
    ["Фото", projectPhotoEntries(project, "passport").length > 0],
  ];
}

function renderPassportChecklist(project) {
  return passportChecklist(project)
    .map(([label, ready]) => `<span class="passport-check ${ready ? "ready" : "missing"}">${ready ? "✓" : "!"} ${label}</span>`)
    .join("");
}

function renderPassportPhotos(project) {
  const photoItems = projectPhotoEntries(project, "passport").map(({ photo }) => photo).slice(0, 4);
  if (!photoItems.length) {
    return `<p class="muted-text">Фото для паспорта ще не додано.</p>`;
  }

  return `
    <div class="passport-photo-grid">
      ${photoItems
        .map(
          (photo) => `
            <figure>
              <img loading="lazy" src="${escapeAttribute(photo.src)}" alt="${escapeAttribute(photo.caption || photo.category || "Фото об'єкта")}" />
              <figcaption>${escapeAttribute(photo.category || "Фото")}${photo.caption ? ` · ${escapeAttribute(photo.caption)}` : ""}</figcaption>
            </figure>
          `,
        )
        .join("")}
    </div>
  `;
}

function nextStringNumber(project, mpptNumber) {
  const numbers = project.strings
    .filter((item) => Number(item.mpptNumber) === Number(mpptNumber))
    .map((item) => Number(item.stringNumber || 0));
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function pvInputLabel(item) {
  return `PV${item.pvInputNumber || 1}`;
}

function pvInputOptions(project, selectedValue = 1) {
  const count = Math.max(1, Number(project.technical.pvInputsPerMppt || 1));
  return Array.from({ length: count }, (_, index) => {
    const value = index + 1;
    return `<option value="${value}" ${Number(selectedValue || 1) === value ? "selected" : ""}>PV${value}</option>`;
  }).join("");
}

function selectedAttr(value, expected) {
  return value === expected ? "selected" : "";
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function ensureProjectCollections(project) {
  if (!project) return project;
  project.technical ||= {};
  project.technical.panelSerialNumbers ||= "";
  normalizeTechnicalEquipment(project.technical);
  project.strings ||= [];
  project.materials ||= [];
  project.photos ||= [];
  project.workChecklist = {
    ...emptyInstallerChecklist(),
    ...(project.workChecklist || project.checklist || {}),
  };
  project.finance = normalizeProjectFinance(project.finance);
  const storedFiles = projectFilesFor(project.id);
  if (!Array.isArray(project.files) || (!project.files.length && storedFiles.length)) {
    project.files = storedFiles;
  }
  return project;
}

function normalizeEquipmentItem(item = {}, type = "equipment") {
  return {
    id: item.id || `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    manufacturer: item.manufacturer || "",
    model: item.model || "",
    power: item.power || item.powerKw || item.powerW || item.capacityKwh || "",
    count: Number(item.count || 1),
    serialNumbers: item.serialNumbers || item.serialNumber || "",
    note: item.note || "",
  };
}

function normalizeEquipmentList(items, fallback, type) {
  const normalized = Array.isArray(items) ? items.map((item) => normalizeEquipmentItem(item, type)) : [];
  if (normalized.length) return normalized;
  return fallback ? [normalizeEquipmentItem(fallback, type)] : [];
}

function normalizeTechnicalEquipment(technical) {
  technical.inverters = normalizeEquipmentList(
    technical.inverters,
    technical.inverterManufacturer || technical.inverterModel || technical.inverterSerialNumber || Number(technical.inverterPowerKw || 0)
      ? {
        manufacturer: technical.inverterManufacturer,
        model: technical.inverterModel,
        power: technical.inverterPowerKw,
        serialNumbers: technical.inverterSerialNumber,
      }
      : null,
    "inverter",
  );
  technical.batteries = normalizeEquipmentList(
    technical.batteries,
    technical.batteryManufacturer || technical.batteryModel || technical.batterySerialNumbers || Number(technical.batteryModulesCount || 0)
      ? {
        manufacturer: technical.batteryManufacturer,
        model: technical.batteryModel,
        power: technical.batteryCapacityKwh,
        count: technical.batteryModulesCount || 1,
        serialNumbers: technical.batterySerialNumbers,
      }
      : null,
    "battery",
  );
  technical.panelGroups = normalizeEquipmentList(
    technical.panelGroups,
    technical.panelManufacturer || technical.panelModel || technical.panelSerialNumbers || Number(technical.panelCount || 0)
      ? {
        manufacturer: technical.panelManufacturer,
        model: technical.panelModel,
        power: technical.panelPowerW,
        count: technical.panelCount || 1,
        serialNumbers: technical.panelSerialNumbers,
      }
      : null,
    "panel",
  );
}

function normalizeProjectFinance(finance = {}) {
  return {
    ...emptyProjectFinance(),
    ...finance,
    contractPrice: Number(finance.contractPrice || finance.contract_price || 0),
    installationPrice: Number(finance.installationPrice || finance.installation_price || 0),
    advancePaid: Number(finance.advancePaid || finance.advance_paid || 0),
    crewPayroll: Number(finance.crewPayroll || finance.crew_payroll || 0),
    equipment: Array.isArray(finance.equipment) ? finance.equipment.map((item) => ({
      name: item.name || "",
      qty: Number(item.qty || 0),
      unit: item.unit || "шт",
      purchasePrice: Number(item.purchasePrice || item.purchase_price || 0),
      salePrice: Number(item.salePrice || item.sale_price || 0),
    })) : [],
    offerLines: Array.isArray(finance.offerLines || finance.offer_lines) ? (finance.offerLines || finance.offer_lines).map((item) => ({
      id: item.id || `offer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      warehouseItemId: item.warehouseItemId || item.warehouse_item_id || "",
      currency: item.currency || null,
      category: item.category || "Інше",
      name: item.name || "",
      qty: Number(item.qty || 0),
      unit: item.unit || "шт",
      purchasePrice: Number(item.purchasePrice || item.purchase_price || 0),
      salePrice: Number(item.salePrice || item.sale_price || 0),
      note: item.note || "",
    })) : [],
    expenses: Array.isArray(finance.expenses) ? finance.expenses.map((item) => ({
      name: item.name || "",
      amount: Number(item.amount || 0),
    })) : [],
  };
}

function money(value, currency = "USD") {
  if (window.SpartaMoney) return window.SpartaMoney.format(value, currency);
  if (!Number.isFinite(Number(value))) return "—";
  return `${Number(value || 0).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === "USD" ? "USD" : "грн"}`;
}

function normalizeLookupValue(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function materialQuantity(material) {
  return Math.max(0, Number(material.actualQty ?? material.issuedQty ?? 0));
}

function warehouseItemForMaterial(material) {
  const linkedItem = material?.warehouseItemId ? warehouseItemById(material.warehouseItemId) : null;
  if (linkedItem) return linkedItem;
  const sku = normalizeLookupValue(material?.sku);
  if (sku) {
    const bySku = warehouseItems.find((item) => normalizeLookupValue(item.sku) === sku);
    if (bySku) return bySku;
  }
  const materialName = normalizeLookupValue(material?.name);
  if (!materialName) return null;
  return warehouseItems.find((item) => {
    const itemName = normalizeLookupValue(item.name);
    const itemSku = normalizeLookupValue(item.sku);
    return itemName === materialName || itemSku === materialName;
  }) || warehouseItems.find((item) => {
    const itemName = normalizeLookupValue(item.name);
    return itemName.length > 4 && (itemName.includes(materialName) || materialName.includes(itemName));
  }) || null;
}

function projectMaterialsWithWarehousePrices(project) {
  return (project?.materials || []).map((material) => {
    const foundItem = warehouseItemForMaterial(material);
    const warehouseItem = foundItem && (foundItem.currency || "UAH") === (material.currency || project?.currency || "UAH") ? foundItem : null;
    const qty = Math.max(0, Number(material.issuedQty ?? material.actualQty ?? 0));
    return {
      currency: material.currency || project?.currency || "UAH",
      name: material.name || "",
      category: material.category || warehouseItem?.category || "Інше",
      qty,
      unit: material.unit || warehouseItem?.unit || "шт",
      warehouseName: warehouseItem?.name || "",
      purchasePrice: Number(material.purchasePriceSnapshot ?? (warehouseItem ? warehouseUnitCost(warehouseItem) : 0)),
      salePrice: Number(material.salePriceSnapshot ?? warehouseItem?.installerPrice ?? warehouseItem?.salePrice ?? 0),
      hasWarehousePrice: material.purchasePriceSnapshot != null || Boolean(warehouseItem),
    };
  });
}

function projectFinanceTotals(project) {
  const finance = normalizeProjectFinance(project?.finance || {});
  const materialLines = projectMaterialsWithWarehousePrices(project);
  const currencyMismatch = materialLines.some((item) => item.currency !== (project?.currency || "UAH"));
  const equipmentPurchase = currencyMismatch ? NaN : materialLines.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.purchasePrice || 0), 0);
  const equipmentSale = currencyMismatch ? NaN : materialLines.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.salePrice || 0), 0);
  const otherExpenses = finance.expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const revenue = Number(finance.contractPrice || 0) || equipmentSale + Number(finance.installationPrice || 0);
  const cashPayments = window.SpartaCashBook?.projectTotals(project?.id, project?.currency || "UAH") || { clientPaidMinor: 0, recordedPayrollMinor: 0, recordedExpensesMinor: 0, materialsMinor: 0 };
  const receivedPayments = Math.round(Number(finance.advancePaid || 0) * 100 + cashPayments.clientPaidMinor) / 100;
  const balanceDue = Math.round((Math.round(revenue * 100) - Math.round(receivedPayments * 100))) / 100;
  const cost = currencyMismatch ? NaN : equipmentPurchase + Number(finance.crewPayroll || 0) + otherExpenses;
  const profit = revenue - cost;
  const margin = revenue ? Math.round((profit / revenue) * 100) : 0;
  return {
    ...finance,
    currency: project?.currency || "UAH",
    currencyMismatch,
    equipment: materialLines,
    equipmentPurchase,
    equipmentSale,
    otherExpenses,
    revenue,
    balanceDue,
    receivedPayments,
    journalPayments: cashPayments.clientPaidMinor / 100,
    cashPayments,
    cost,
    profit,
    margin,
  };
}

function warehouseTotals(currency = "USD") {
  const items = warehouseItems.filter((item) => (item.currency || "UAH") === currency);
  const purchaseValue = items.reduce((sum, item) => sum + Number(item.qty || 0) * warehouseUnitCost(item), 0);
  const saleValue = items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.retailPrice || item.salePrice || 0), 0);
  const lowStock = warehouseItems.filter((item) => Number(item.qty || 0) <= Number(item.minQty || 0)).length;
  const movedToday = warehouseMovements.filter((movement) => (movement.createdAt || "").slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  return {
    purchaseValue,
    saleValue,
    potentialProfit: saleValue - purchaseValue,
    lowStock,
    movedToday,
  };
}

function warehouseItemFormState() {
  const item = Number.isInteger(editingWarehouseIndex) ? warehouseItems[editingWarehouseIndex] : null;
  return {
    item,
    isEditing: Boolean(item),
  };
}

function warehouseBaseCategories() {
  return ["Інвертори", "Фотомодулі", "Панелі", "АКБ", "Кабелі", "Кабель", "Комплектуючі", "Кріплення", "Конектори", "Захист", "Щити", "Роботи", "Інструмент", "Витрати", "Інше"];
}

function warehouseCategories() {
  return [...new Set([...warehouseBaseCategories(), ...warehouseItems.map((item) => item.category || "Інше")])];
}

function warehouseProductsForCategory(category) {
  return warehouseItems.filter((item) => !category || category === "__new" || item.category === category);
}

function warehouseSections() {
  return [
    { id: "inverters", title: "Інвертори", categories: ["Інвертори"], defaultCategory: "Інвертори" },
    { id: "panels", title: "Фотомодулі", categories: ["Фотомодулі", "Панелі"], defaultCategory: "Фотомодулі" },
    { id: "batteries", title: "АКБ", categories: ["АКБ", "Акумулятори"], defaultCategory: "АКБ" },
    { id: "cables", title: "Кабелі", categories: ["Кабель", "Кабелі", "Кабелі й з’єднання"], defaultCategory: "Кабель" },
    { id: "components", title: "Комплектуючі", categories: ["Кріплення", "Конектори", "Захист", "Щити", "Електрозахист і щити", "Моніторинг та аксесуари", "Роботи", "Інструмент", "Витрати", "Комплектуючі", "Інше", "Інше обладнання"], defaultCategory: "Комплектуючі" },
  ];
}

function warehouseSectionForCategory(category) {
  const normalizedCategory = normalizeLookupValue(category);
  return warehouseSections().find((section) =>
    section.categories.some((sectionCategory) => normalizeLookupValue(sectionCategory) === normalizedCategory),
  )?.id || "components";
}

function warehouseItemsForSection(section) {
  const categories = section.categories.map(normalizeLookupValue);
  return warehouseItems.filter((item) => categories.includes(normalizeLookupValue(item.category)));
}

function warehouseSectionFilter(sectionId) {
  return warehousePickerFilters[sectionId] || {};
}

function warehouseItemBrand(item) {
  const name = normalizeLookupValue(item?.name || "");
  const brands = [
    ["deye", "Deye"],
    ["longi", "Longi"],
    ["ja solar", "JA Solar"],
    ["tongwei", "Tongwei"],
    ["astronergy", "Astronergy"],
    ["tomzn", "Tomzn"],
    ["etimat", "ETI"],
    ["etitec", "ETI"],
    ["eti", "ETI"],
    ["techfine", "Techfine"],
    ["tmg power", "TMG Power"],
    ["boss", "Boss"],
    ["bos-g", "BOS-G"],
    ["bosg", "BOS-G"],
    ["bos-b", "BOS-B"],
  ];
  return brands.find(([token]) => name.includes(token))?.[1] || "";
}

function warehouseItemPowerTags(item, sectionId = "") {
  const name = normalizeLookupValue(item?.name || "");
  const tags = [];
  const patterns = [
    { regex: /(\d+(?:[,.]\d+)?)\s*(квт\s*год|квтгод|kwh|кwh)/gi, unit: "кВт год" },
    { regex: /(\d+(?:[,.]\d+)?)\s*(квт|kw)/gi, unit: "кВт" },
    { regex: /(\d+(?:[,.]\d+)?)\s*(wp|вт|w)/gi, unit: "Вт" },
    { regex: /(\d+(?:[,.]\d+)?)\s*(mm2|мм2|мм²)/gi, unit: "мм2" },
  ];
  patterns.forEach(({ regex, unit }) => {
    for (const match of name.matchAll(regex)) {
      const value = Number(String(match[1]).replace(",", "."));
      if (!value) continue;
      tags.push(`${Number.isInteger(value) ? value : value.toString().replace(".", ",")} ${unit}`);
    }
  });

  if (!tags.length && sectionId === "cables") {
    const cableSize = name.match(/(\d+)\s*[xх*]\s*(\d+(?:[,.]\d+)?)/i);
    if (cableSize) tags.push(`${cableSize[1]}x${cableSize[2].replace(".", ",")}`);
  }

  return [...new Set(tags)];
}

function warehouseFilterOptions(items, mapper) {
  return [...new Set(items.map(mapper).flat().filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "uk", { numeric: true }),
  );
}

function warehouseFilteredItems(section, items) {
  const filter = warehouseSectionFilter(section.id);
  const query = normalizeLookupValue(filter.query || "");
  return items.filter((item) => {
    if (filter.category && item.category !== filter.category) return false;
    if (filter.brand && warehouseItemBrand(item) !== filter.brand) return false;
    if (filter.power && !warehouseItemPowerTags(item, section.id).includes(filter.power)) return false;
    if (query) {
      const searchText = normalizeLookupValue(`${item.name} ${item.sku} ${item.characteristics}`);
      if (!searchText.includes(query)) return false;
    }
    return true;
  });
}

function warehouseUnitCost(item) {
  return Number(item.purchasePrice || 0) + Number(item.deliveryCost || 0) + Number(item.extraCost || 0);
}

function warehouseItemById(itemId) {
  return warehouseItems.find((item) => normalizeProjectId(item.id) === normalizeProjectId(itemId));
}

function warehouseMovementTypeLabel(type) {
  return {
    purchase: "Прихід",
    project: "На об'єкт",
    return: "Повернення з об'єкта",
    sale: "Прямий продаж",
  }[type] || "Рух";
}

function warehouseMovementTarget(movement) {
  if (movement.type === "project" || movement.type === "return") return projects.find((project) => normalizeProjectId(project.id) === normalizeProjectId(movement.projectId))?.title || "Об'єкт";
  if (movement.type === "sale") return movement.customer || "Клієнт";
  return movement.supplier || "Склад";
}

function activeWarehouseProjects() {
  return projects.filter((project) => !isClosedProjectStatus(project.status));
}

function addWarehouseItemToProjectMaterials(project, item, qty) {
  if (!project || !item || !qty) return;
  if ((project.currency || "UAH") !== (item.currency || "UAH")) throw new Error("Валюта обладнання не збігається з валютою об’єкта.");
  ensureProjectCollections(project);
  const itemSku = normalizeLookupValue(item.sku);
  const itemName = normalizeLookupValue(item.name);
  const existingMaterial = project.materials.find((material) => String(material.warehouseItemId || "") === String(item.id)) || project.materials.find((material) => {
    if (material.warehouseItemId) return false;
    const materialSku = normalizeLookupValue(material.sku);
    const materialName = normalizeLookupValue(material.name);
    return (itemSku && materialSku === itemSku) || (itemName && materialName === itemName);
  });

  if (existingMaterial) {
    if ((existingMaterial.currency || "UAH") !== (project.currency || "UAH")) throw new Error("Матеріал має іншу валюту. Створіть окрему позицію.");
    existingMaterial.currency = project.currency || "UAH";
    const priorIssued = Number(existingMaterial.issuedQty ?? existingMaterial.actualQty ?? 0);
    const priorActual = Number(existingMaterial.actualQty ?? priorIssued);
    const priorCost = Number(existingMaterial.purchasePriceSnapshot ?? warehouseUnitCost(item));
    const priorSale = Number(existingMaterial.salePriceSnapshot ?? item.installerPrice ?? item.salePrice ?? 0);
    existingMaterial.issuedQty = priorIssued + qty;
    existingMaterial.plannedQty = Math.max(Number(existingMaterial.plannedQty || 0), existingMaterial.issuedQty);
    existingMaterial.actualQty = priorActual + qty;
    existingMaterial.warehouseItemId = item.id;
    existingMaterial.purchasePriceSnapshot = (priorIssued * priorCost + qty * warehouseUnitCost(item)) / existingMaterial.issuedQty;
    existingMaterial.salePriceSnapshot = (priorIssued * priorSale + qty * Number(item.installerPrice ?? item.salePrice ?? 0)) / existingMaterial.issuedQty;
    existingMaterial.unit = existingMaterial.unit || item.unit || "шт";
    existingMaterial.category = existingMaterial.category || item.category || "Інше";
    existingMaterial.sku = existingMaterial.sku || item.sku || "";
    return;
  }

  project.materials.push({
    currency: project.currency || "UAH",
    name: item.name,
    category: item.category || "Інше",
    sku: item.sku || "",
    warehouseItemId: item.id,
    purchasePriceSnapshot: warehouseUnitCost(item),
    salePriceSnapshot: Number(item.installerPrice ?? item.salePrice ?? 0),
    actualQty: qty,
    plannedQty: qty,
    issuedQty: qty,
    unit: item.unit || "шт",
  });
}

function installerChecklistStats(project) {
  const checklist = ensureProjectCollections(project)?.workChecklist || emptyInstallerChecklist();
  const total = installerChecklistItemIds.length;
  const done = installerChecklistItemIds.filter((id) => Boolean(checklist[id])).length;
  return {
    total,
    done,
    percent: installerChecklistItemIds.reduce((sum, id) => sum + (checklist[id] ? installerChecklistWeights[id] || 0 : 0), 0),
  };
}

function selectedProject() {
  return ensureProjectCollections(projects.find((project) => String(project.id) === String(selectedProjectId)) || projects[0]);
}

function refreshTeamNavigation() {
  const allowed = !window.SPARTA_LOCAL_WORKSPACE?.enabled && cloudState.ready && ["owner", "admin"].includes(cloudState.memberRole) && portalMode !== "client";
  document.querySelector('[data-section="team"]')?.classList.toggle("is-hidden", !allowed);
  const salesAllowed = !window.SPARTA_LOCAL_WORKSPACE?.enabled && cloudState.ready && ["owner", "admin", "engineer", "warehouse"].includes(cloudState.memberRole) && portalMode !== "client";
  document.querySelector('[data-section="sales"]')?.classList.toggle("is-hidden", !salesAllowed);
  const card = document.querySelector(".user-card");
  if (card) { card.querySelector("strong").textContent = renderRoleLabel(cloudState.memberRole); card.querySelector("small").textContent = cloudState.user?.email || "Потрібен вхід"; }
  window.SpartaOrderNotifications?.refreshAccess();
}

function revealActiveNavigation() {
  const nav = document.querySelector(".nav");
  if (!nav || !(nav.scrollWidth > nav.clientWidth)) return;
  const active = nav.querySelector(".nav-item.active:not(.is-hidden)");
  if (!active) return;
  const rail = nav.getBoundingClientRect();
  const item = active.getBoundingClientRect();
  const delta = item.left < rail.left ? item.left - rail.left : item.right > rail.right ? item.right - rail.right : 0;
  if (delta) nav.scrollBy({ left: delta, behavior: "auto" });
}

function showSection(sectionId, options = {}) {
  if (window.SpartaBuyerCloud?.isBuyerReady()) { window.SpartaBuyerUI?.renderBuyer(document.querySelector("#buyerPortalView")); return; }
  if (sectionId === "sales") {
    if (!cloudState.ready || !["owner", "admin", "engineer", "warehouse"].includes(cloudState.memberRole) || window.SPARTA_LOCAL_WORKSPACE?.enabled) sectionId = "home";
    else {
      const noticeState = window.SpartaOrderNotifications?.getState?.();
      const salesOptions = noticeState && (!noticeState.initialized || noticeState.count > 0) ? { ...options, orderFilter: "submitted" } : options;
      window.SpartaBuyerUI?.renderSales(document.querySelector("#salesView"), salesOptions);
    }
  }
  if (sectionId === "team" && !window.SpartaTeamAccess?.canManage()) sectionId = "profile";
  if (sectionId === "team") window.SpartaTeamAccess?.render(document.querySelector("#teamView"));
  if (window.SPARTA_LOCAL_WORKSPACE?.enabled && window.spartaDemoRunning) return;
  if (sectionId === "cash" && (portalMode === "client" || !["owner", "admin"].includes(cloudState.memberRole))) sectionId = "home";
  if (sectionId === "cash") window.SpartaCashBook?.renderView();
  document.querySelectorAll(".section").forEach((section) => section.classList.remove("active"));
  document.querySelector(`#${sectionId}`).classList.add("active");
  document.querySelector("#newProjectButton")?.classList.toggle("is-hidden", portalMode === "client" || sectionId !== "projects");
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.section === sectionId || (sectionId === "objectDetail" && item.dataset.section === "projects"));
  });
  revealActiveNavigation();
  applyProjectRoleControls();
}

function applyPortalMode(mode) {
  portalMode = mode === "client" ? "client" : "installer";
  writeLocalStorage("solarObjectManager.portalMode", portalMode);
  document.body.classList.toggle("client-mode", portalMode === "client");
  document.querySelector("#localWorkspaceBanner")?.classList.toggle("is-hidden", !window.SPARTA_LOCAL_WORKSPACE?.enabled);
  document.querySelectorAll("[data-portal-mode]").forEach((button) => {
    const isActive = button.dataset.portalMode === portalMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  const label = document.querySelector("#portalModeLabel");
  const title = document.querySelector("#portalTitle");
  if (label) label.textContent = portalMode === "client" ? "Кабінет клієнта" : "Робочий простір";
  if (title) title.textContent = portalMode === "client" ? "Моя сонячна станція" : "SPARTA field";
  const navigation = portalMode === "client"
    ? {
      home: ["⌂", "Головна"],
      projects: ["▥", "Статистика"],
      warehouse: ["▦", "Магазин"],
      crm: ["⌕", "Сервіс"],
      profile: ["☰", "Меню"],
    }
    : {
      home: ["⌂", "Головна"],
      projects: ["▤", "Об'єкти"],
      warehouse: ["▦", "Склад"],
      crm: ["☑", "CRM"],
      cash: ["$", "Каса"],
      team: ["♙", "Команда і події"],
      sales: ["▣", "Продажі"],
      profile: ["○", "Профіль"],
    };
  document.querySelectorAll(".nav-item").forEach((item) => {
    const view = navigation[item.dataset.section];
    if (view) item.innerHTML = `<span>${view[0]}</span>${view[1]}`;
    item.classList.toggle("is-hidden", portalMode === "client" && item.dataset.section === "projects");
  });
  document.querySelector("#newProjectButton")?.classList.toggle("is-hidden", portalMode === "client");
  window.SpartaCashBook?.refreshAccess();
  refreshTeamNavigation();
  applyProjectRoleControls();
}

function statusClass(status) {
  if (status === "passport_issued" || status === "completed" || status === "service") return "green";
  if (status === "waiting_review" || status === "planned" || status === "proposal" || status === "contract") return "amber";
  return "";
}

function statusProgress(project) {
  if (isClosedProjectStatus(project.status)) return 100;
  if (["in_progress", "waiting_review"].includes(project.status)) return installerChecklistStats(project).percent;
  const statusProgressMap = {
    new: 10,
    planned: 22,
    proposal: 35,
    contract: 50,
    in_progress: 65,
    waiting_review: 78,
    completed: 88,
    passport_issued: 92,
    service: 100,
  };

  return statusProgressMap[project.status] || 10;
}

function statusTone(status) {
  if (status === "completed" || status === "passport_issued" || status === "service") return "success";
  if (status === "in_progress") return "work";
  if (status === "waiting_review") return "blue";
  if (status === "planned" || status === "proposal" || status === "contract") return "warning";
  return "muted";
}

function projectStatusOptions(selectedStatus = "new") {
  const options = projectFunnelSteps
    .map(([value, label]) => `<option value="${value}" ${selectedAttr(selectedStatus, value)}>${label}</option>`)
    .join("");
  const legacyCompleted = selectedStatus === "completed"
    ? `<option value="completed" selected>Завершено</option>`
    : "";
  return `${options}${legacyCompleted}`;
}

function projectFunnelIndex(status) {
  if (status === "completed") {
    return projectFunnelSteps.findIndex(([value]) => value === "passport_issued");
  }
  const index = projectFunnelSteps.findIndex(([value]) => value === status);
  return index >= 0 ? index : projectFunnelSteps.length - 1;
}

function isClosedProjectStatus(status) {
  return ["completed", "passport_issued", "service"].includes(status);
}

function projectSubtitle(project) {
  return project.objectType || "Об'єкт СЕС";
}

function formatFilledCombined(...values) {
  const value = values
    .filter((item) => item && item !== "Не заповнено")
    .join(" ");
  return value || "";
}

function objectTechnicalSpecs(project, wrap = true) {
  const technical = project.technical || {};
  const specs = [];
  const panel = formatFilledCombined(technical.panelManufacturer, technical.panelModel);
  const inverter = formatFilledCombined(technical.inverterManufacturer, technical.inverterModel);
  const hasBattery = Boolean(
    technical.hasBattery ||
      technical.batteryManufacturer ||
      technical.batteryModel ||
      Number(technical.batteryModulesCount || 0) ||
      Number(technical.batteryCapacityKwh || 0),
    );

  if (panel || Number(technical.panelCount || 0) || Number(technical.panelPowerW || 0)) {
    const panelName = panel || "Фотомодулі";
    const panelCount = Number(technical.panelCount || 0) ? ` · ${technical.panelCount} шт` : "";
    const panelPower = Number(technical.panelPowerW || 0) ? ` × ${technical.panelPowerW} Вт` : "";
    specs.push(`<span><b>Фотомодулі</b><em>${escapeAttribute(panelName + panelCount + panelPower)}</em></span>`);
  }

  if (inverter) {
    const inverterPower = Number(technical.inverterPowerKw || 0) ? ` · ${technical.inverterPowerKw} кВт` : "";
    specs.push(`<span><b>Інвертор</b><em>${escapeAttribute(inverter + inverterPower)}</em></span>`);
  }

  if (hasBattery) {
    const batteryName = formatFilledCombined(technical.batteryManufacturer, technical.batteryModel) || "Дані АКБ внесені";
    const batteryCapacity = Number(technical.batteryCapacityKwh || 0) || Number(technical.batteryModulesCount || 0)
      ? ` · ${technical.batteryModulesCount || 0} шт × ${technical.batteryCapacityKwh || 0} кВт·год`
      : "";
    specs.push(`<span><b>АКБ</b><em>${escapeAttribute(batteryName + batteryCapacity)}</em></span>`);
  }

  if (!specs.length) return "";
  return wrap ? `<div class="object-specs">${specs.join("")}</div>` : specs.join("");
}

function serviceTickets() {
  return crmTasks.filter((task) => task.type === "service").map((task) => ({
    title: escapeAttribute(task.title || "Сервісне звернення"),
    object: escapeAttribute(projects.find((project) => String(project.id) === String(task.projectId))?.title || "Без прив’язки до об’єкта"),
    status: { planned: "Нова", in_progress: "В роботі", done: "Виконано" }[task.status] || "Нова",
    tone: task.status === "done" ? "success" : task.status === "in_progress" ? "warning" : "blue",
  }));
}

function filteredProjects() {
  const query = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;

  return projects.filter((project) => {
    const searchable = `${project.title} ${project.clientName} ${project.address} ${project.teamName} ${project.technical?.inverterManufacturer || ""} ${project.technical?.inverterModel || ""} ${project.technical?.batteryManufacturer || ""} ${project.technical?.batteryModel || ""}`.toLowerCase();
    const matchesSearch = !query || searchable.includes(query);
    const matchesStatus = status === "all" || project.status === status;
    return matchesSearch && matchesStatus;
  });
}

function renderProjectList() {
  if (portalMode === "client") {
    renderClientStatistics();
    return;
  }
  const items = filteredProjects();
  projectList.innerHTML = items.length
    ? items
    .map(
      (project) => `
        <button class="object-card status-${escapeAttribute(project.status)} ${String(project.id) === String(selectedProjectId) ? "active" : ""}" data-project-id="${escapeAttribute(project.id)}">
          <span class="object-thumb" aria-hidden="true"></span>
          <div class="object-content">
            <div class="object-line">
              <h3>${escapeAttribute(project.title)}</h3>
              <span class="chevron">›</span>
            </div>
            <p>${escapeAttribute(projectSubtitle(project))}</p>
            <p>${escapeAttribute(project.address)}</p>
            <div class="object-meta">
              <span class="chip ${statusClass(project.status)}">${statusLabels[project.status]}</span>
              <span class="chip">${totalPower(project)} кВт</span>
            </div>
            <div class="progress-line"><span style="width: ${statusProgress(project)}%"></span></div>
            <small>${statusProgress(project)}%</small>
          </div>
        </button>
      `,
    )
    .join("")
    : `<div class="wide-panel"><h2>Об'єктів не знайдено</h2><p>Створи новий об'єкт або зміни фільтр.</p></div>`;
}

function renderDetail() {
  const project = selectedProject();
  if (!project) {
    projectDetail.innerHTML = `
      <div class="detail-head">
        <div>
          <p class="eyebrow">Об'єкт</p>
          <h2>Об'єкт не вибрано</h2>
        </div>
        <button class="secondary-button" id="backToProjectsButton">Назад до списку</button>
      </div>
    `;
    return;
  }

  const stringsTotal = stringPanelCount(project);
  const expected = project.technical.panelCount;
  const isValid = stringsTotal === expected;

  projectDetail.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="eyebrow">${escapeAttribute(project.objectType)}</p>
        <h2>${escapeAttribute(project.title)}</h2>
        <p>${escapeAttribute(project.clientName)} · ${escapeAttribute(project.clientPhone)}</p>
      </div>
      <div class="detail-actions">
        <button class="icon-button" id="backToProjectsButton" aria-label="Назад до списку" title="Назад до списку">←</button>
        <button class="secondary-button compact-button" id="editProjectInfoButton">Редагувати</button>
        <button class="icon-button danger-icon" id="deleteProjectButton" aria-label="Видалити об'єкт" title="Видалити об'єкт">🗑</button>
        <div class="status-row">
          <label class="status-control">Статус
            <select id="projectStatusSelect">
              ${projectStatusOptions(project.status)}
            </select>
          </label>
          ${project.installationDate ? `<span class="chip">Монтаж: ${escapeAttribute(project.installationDate)}</span>` : ""}
        </div>
      </div>
    </div>

    ${renderProjectSectionStack(project, isValid, stringsTotal, expected)}
  `;
  applyProjectRoleControls();
}

function renderProjectSectionStack(project, isValid, stringsTotal, expected) {
  const previousTab = selectedTab;
  const activeIndex = projectFunnelIndex(project.status);
  const html = `
    <div class="section-stack">
      ${projectFunnelSteps.map(([status, label], index) => {
        const isOpen = status === previousTab;
        const state = index < activeIndex ? "done" : index === activeIndex ? "current" : "";
        return `
          <section class="project-section-card ${isOpen ? "active" : ""} ${state}" id="project-section-${status}">
            <button class="project-section-toggle ${isOpen ? "active" : ""}" type="button" data-workflow-stage="${status}">
              <span><b>${index + 1}</b>${label}</span>
              <small>${isOpen ? "Згорнути" : "Відкрити"}</small>
            </button>
            ${isOpen ? `
              <div class="project-section-body">
                ${renderProjectStageContent(status, project, isValid, stringsTotal, expected)}
              </div>
            ` : ""}
          </section>
        `;
      }).join("")}
    </div>
  `;
  selectedTab = previousTab;
  return html;
}

function renderProjectStageContent(status, project, isValid, stringsTotal, expected) {
  const stageTabs = {
    new: [["Клієнт і заявка", "lead"]],
    planned: [["Виїзд на замір", "measurement"], ["Фото заміру", "surveyPhotos"], ["Схеми та заміри", "files"]],
    proposal: [["Комерційна пропозиція", "commercialOffer"], ["Файли КП", "files"]],
    contract: [["Договір і оплати", "contract"], ["Договір та підтвердження оплат", "files"], ["Фото чеків", "receiptPhotos"]],
    in_progress: [["Чекліст монтажу", "checklist"], ["Технічні дані та серійні номери", "technical"], ["Матеріали для монтажу", "materials"], ["MPPT / стрінги", "strings"], ["Фото монтажу", "installationPhotos"]],
    waiting_review: [["Результат монтажу", "reviewChecklist"], ["Фото для перевірки", "installationPhotos"]],
    passport_issued: [["Паспорт і передача станції", "passport"], ["Паспорт та акт", "files"]],
    service: [["Сервісні звернення", "objectService"], ["Документи сервісу", "files"], ["Фото сервісу", "servicePhotos"], ["", "archive"]],
  };
  return (stageTabs[status] || stageTabs.new)
    .map(([title, tabId]) => {
      if (tabId === "receiptPhotos" && !projectPhotoEntries(project, "receipts").length) return "";
      const html = renderTabById(tabId, project, isValid, stringsTotal, expected, status);
      if (status === "in_progress" && ["technical", "strings"].includes(tabId)) {
        return `<details class="workflow-details"><summary>${title}</summary>${html}</details>`;
      }
      return `<section class="stage-panel-section">${title ? `<h3>${title}</h3>` : ""}${html}</section>`;
    })
    .join("");
}

function workflowFileCategories(stage) {
  return {
    planned: ["sketchup_model"], proposal: ["commercial_offer"],
    contract: ["contract", "receipt"], passport_issued: ["passport", "handover"],
    service: ["service_report"],
  }[stage] || null;
}

function renderTabById(tabId, project, isValid, stringsTotal, expected, workflowStage = "") {
  if (tabId === "lead") return renderLeadStage(project);
  if (tabId === "contract") return renderContractStage(project);
  if (tabId === "reviewChecklist") return renderWorkflowChecklist(project, true);
  if (tabId === "objectService") return renderObjectServiceStage(project);
  if (tabId === "archive") return renderProjectArchive(project);
  const photoScopes = { surveyPhotos: "survey", receiptPhotos: "receipts", installationPhotos: "installation", servicePhotos: "service" };
  if (photoScopes[tabId]) return renderProjectPhotos(project, { scope: photoScopes[tabId] });
  if (tabId === "measurement") {
    return renderMeasurementStage(project);
  }
  if (tabId === "commercialOffer") {
    return renderCommercialOfferStage(project);
  }

  const previousTab = selectedTab;
  selectedTab = tabId;
  const html = renderTab(project, isValid, stringsTotal, expected, {
    fileCategories: workflowFileCategories(workflowStage),
    financeReportOnly: workflowStage === "financial_report",
  });
  selectedTab = previousTab;
  return html;
}

function renderLeadStage(project) {
  return `<div class="data-grid">
    <div class="data-item"><span>Клієнт</span><strong>${escapeAttribute(project.clientName || "Не вказано")}</strong></div>
    <div class="data-item"><span>Телефон</span><strong>${escapeAttribute(project.clientPhone || "Не вказано")}</strong></div>
    <div class="data-item"><span>Email</span><strong>${escapeAttribute(project.clientEmail || "Не вказано")}</strong></div>
    <div class="data-item"><span>Адреса</span><strong>${escapeAttribute(project.address || "Не вказано")}</strong></div>
    <div class="data-item"><span>Тип об’єкта</span><strong>${escapeAttribute(project.objectType || "Не вказано")}</strong></div>
  </div><p class="workflow-note">${escapeAttribute(project.comment || "Потреби клієнта та побажання ще не внесено.")}</p>`;
}

function renderWorkflowChecklist(project, readOnly = false) {
  readOnly = readOnly || !canEditProjectField();
  const stats = installerChecklistStats(project);
  return `<div class="panel-heading"><strong>Виконано ${stats.percent}%</strong><span class="chip">${stats.done} із ${stats.total} пунктів</span></div>
    <div class="progress-line"><span style="width:${stats.percent}%"></span></div>
    ${readOnly ? `<p class="muted-text">Підсумок для перевірки. Позначки змінюються лише на етапі «Монтаж».</p>` : ""}
    <div class="workflow-checklist">${installerChecklistGroups.map((group) => {
      const complete = group.items.every((item) => project.workChecklist?.[item.id]);
      return `<details class="workflow-details" ${!complete ? "open" : ""}><summary>${group.title} · ${group.items.filter((item) => project.workChecklist?.[item.id]).length}/${group.items.length}</summary>
        ${group.items.map((item) => readOnly
          ? `<p class="workflow-check-result">${project.workChecklist?.[item.id] ? "✓" : "○"} ${escapeAttribute(item.title)}</p>`
          : `<label class="workflow-check-item"><input type="checkbox" data-work-checklist-item="${escapeAttribute(item.id)}" ${project.workChecklist?.[item.id] ? "checked" : ""} />${escapeAttribute(item.title)}<small>${installerChecklistWeights[item.id]}%</small></label>`).join("")}
      </details>`;
    }).join("")}</div>`;
}

function crmTaskPhotoCategory(task) {
  if (task?.type === "service") return "Сервіс";
  if (task?.type === "documents" && /чек/i.test(task.title || "")) return "Касовий чек";
  if (task?.type === "documents" && /договір/i.test(task.title || "")) return "Договір";
  if (/замір|обстеж|огляд/i.test(task?.title || "")) return "Замір";
  return "Виконання CRM";
}

function projectPhotoEntries(project, scope = "archive") {
  return (project.photos || []).map((photo, index) => ({ photo, index })).filter(({ photo }) => {
    if (scope === "archive") return true;
    if (!photo || typeof photo === "string") return scope === "installation";
    const task = photo.crmTaskId ? crmTasks.find((entry) => String(entry.id) === String(photo.crmTaskId) && String(entry.projectId) === String(project.id)) : null;
    const category = String(photo.category === "Виконання CRM" ? crmTaskPhotoCategory(task) : photo.category || "").toLowerCase();
    const receipt = /касовий чек|receipt/.test(category);
    const contract = /договір|contract/.test(category);
    const service = /сервіс|service/.test(category) || photo.stage === "service" || task?.type === "service";
    const survey = /дах \/ ділянка|замір|^before$/.test(category) || photo.stage === "planned" || Boolean(task && /замір|обстеж|огляд/i.test(task.title));
    const serial = Boolean(photo.equipmentId) || /серійн|serial/.test(category);
    if (scope === "receipts") return receipt && !(project.files || []).some((file) => file.category === "receipt" && photo.cashEntryId && photo.fileName && file.cashEntryId === photo.cashEntryId && file.fileName === photo.fileName);
    if (scope === "survey") return survey && !receipt && !contract && !service;
    if (scope === "service") return service && !receipt && !contract;
    if (scope === "passport") return !receipt && !contract && !survey && !service && !serial && Boolean(photo.src);
    return !receipt && !contract && !survey && !service;
  });
}

function renderProjectPhotos(project, options = {}) {
  const scope = options.scope || "installation";
  const entries = projectPhotoEntries(project, scope);
  const categories = {
    survey: ["Дах / ділянка", "Замір"], receipts: ["Касовий чек"], service: ["Сервіс"],
    installation: ["Панелі", "Інвертор", "Щит", "Готовий об'єкт", "Інше"],
  }[scope] || ["Інше"];
  return `<details class="workflow-details"><summary>Додати фото</summary>
    <form class="inline-form photo-form" id="photoForm">
      <label>Категорія<select name="category">${categories.map((category) => `<option value="${category}">${category}</option>`).join("")}</select></label>
      <label>Підпис<input name="caption" placeholder="Що зафіксовано на фото" /></label>
      <label class="file-field">Фото<input name="file" type="file" accept="image/*" required /></label>
      <div class="form-submit-cell"><button class="primary-button">Зберегти фото</button></div>
    </form></details>
    <div class="photo-grid">${entries.map(({ photo, index }) => renderPhotoTile(photo, index)).join("") || `<p class="muted-text">Фото цього етапу ще не додано.</p>`}</div>`;
}

function renderContractStage(project) {
  if ((!window.SPARTA_LOCAL_WORKSPACE?.enabled && !cloudState.ready) || !["owner", "admin"].includes(cloudState.memberRole)) {
    return `<p class="calculation-note">Фінанси та оплати доступні власнику й адміністратору компанії.</p>`;
  }
  const totals = projectFinanceTotals(project);
  const contractNumber = totals.contractNumber ?? project.contractNumber ?? "";
  const contractDate = totals.contractDate ?? project.contractDate ?? "";
  return `<p class="workflow-contract-meta"><strong>${escapeAttribute(contractNumber || "Номер договору ще не внесено")}</strong><span>${contractDate ? `від ${escapeAttribute(contractDate)}` : "Дата не вказана"}</span></p>
    <div class="metric-grid compact finance-metrics">
      <div class="metric-card"><span>Сума договору</span><strong>${money(totals.revenue, project.currency || "UAH")}</strong></div>
      <div class="metric-card"><span>Отримано від клієнта</span><strong>${money(totals.receivedPayments, project.currency || "UAH")}</strong></div>
      <div class="metric-card warning"><span>${totals.balanceDue < 0 ? "Переплата клієнта" : "Залишок до оплати"}</span><strong>${money(Math.abs(totals.balanceDue), project.currency || "UAH")}</strong></div>
    </div>
    <details class="workflow-details"><summary>Умови договору</summary>
      <form class="inline-form finance-form" id="projectFinanceForm">
        <label>Номер договору<input name="contractNumber" value="${escapeAttribute(contractNumber)}" /></label>
        <label>Дата договору<input name="contractDate" type="date" value="${escapeAttribute(contractDate)}" /></label>
        <label>Сума договору, ${project.currency || "UAH"}<input name="contractPrice" type="number" min="0" step="0.01" value="${escapeAttribute(totals.contractPrice)}" /></label>
        <label>Вартість монтажу, ${project.currency || "UAH"}<input name="installationPrice" type="number" min="0" step="0.01" value="${escapeAttribute(totals.installationPrice)}" /></label>
        <label>Бюджет ЗП бригади<input name="crewPayroll" type="number" min="0" step="0.01" value="${escapeAttribute(totals.crewPayroll)}" /></label>
        <div class="form-submit-cell"><button class="primary-button">Зберегти умови</button></div>
      </form>
    </details>
    ${window.SpartaCashBook?.projectMarkup(project, { clientOnly: true }) || ""}
    <details class="workflow-details"><summary>Внутрішній кошторис і витрати</summary>
      ${renderTabById("finance", project, false, 0, 0, "financial_report")}
    </details>`;
}

function renderObjectServiceStage(project) {
  const tasks = crmVisibleTasks().filter((task) => String(task.projectId) === String(project.id) && task.type === "service");
  return `<div class="section-actions">${canCreateCrmTasks() ? `<button type="button" class="primary-button" id="createObjectServiceTaskButton">Створити сервісну задачу</button>` : ""}</div>
    ${tasks.length ? `<div class="table-wrap"><table><thead><tr><th>Звернення</th><th>Виїзд</th><th>Виконавець</th><th>Статус</th><th></th></tr></thead><tbody>${tasks.map((task) => `<tr><td>${escapeAttribute(task.title)}</td><td>${crmDueLabel(task.dueAt)}</td><td>${escapeAttribute(memberDisplayName(task.assignedTo))}</td><td>${crmStatusLabels[task.status] || task.status}</td><td>${canManageCrmTask(task) ? `<button type="button" class="table-button" data-crm-edit="${escapeAttribute(task.id)}">Відкрити</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted-text">Сервісних звернень для цього об’єкта поки немає.</p>`}`;
}

function renderProjectArchive(project) {
  return `<details class="workflow-details" data-project-archive="${escapeAttribute(project.id)}"><summary>Архів об’єкта · ${project.files?.length || 0} файлів · ${project.photos?.length || 0} фото</summary><div class="workflow-archive-body"></div></details>`;
}

function renderProjectArchiveContents(project) {
  return `<p class="muted-text">Усі вкладення, зокрема старі та без категорії. Фінансові операції — у «Касі», внутрішній кошторис — у «Договорі».</p>
    <h4>Документи</h4><div class="file-list">${(project.files || []).map((file, index) => renderProjectFileCard(file, index)).join("") || "Документів ще немає."}</div>
    <h4>Фото</h4><div class="photo-grid">${projectPhotoEntries(project, "archive").map(({ photo, index }) => renderPhotoTile(photo, index)).join("") || "Фото ще немає."}</div>
    ${(project.statusHistory || []).length ? `<h4>Історія етапів</h4><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Етап</th><th>Примітка</th></tr></thead><tbody>${project.statusHistory.map((entry) => `<tr><td>${escapeAttribute(entry.at || entry.date || entry.createdAt || "")}</td><td>${escapeAttribute(statusLabels[entry.status] || entry.status || "")}</td><td>${escapeAttribute(entry.note || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
}

function renderMeasurementStage(project) {
  const projectTasks = crmTasks.filter((task) => normalizeProjectId(task.projectId) === normalizeProjectId(project.id));
  const measurementTasks = projectTasks.filter((task) => task.type !== "service" && /замір|обстеж|огляд/i.test(`${task.title} ${task.note}`));
  const nextVisit = [...measurementTasks].filter((task) => task.status !== "done" && task.dueAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return `
    <div class="section-actions">
      ${canCreateCrmTasks() ? `<button class="primary-button" type="button" id="createMeasurementTaskButton">Запланувати замір</button>` : ""}
    </div>
    <div class="data-grid">
      <div class="data-item"><span>Телефон</span><strong>${escapeAttribute(project.clientPhone || "Не вказано")}</strong></div>
      <div class="data-item"><span>Адреса виїзду</span><strong>${escapeAttribute(project.address || "Не вказано")}</strong></div>
      <div class="data-item"><span>Наступний замір</span><strong>${nextVisit ? crmDueLabel(nextVisit.dueAt) : "Новий виїзд не заплановано"}</strong></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Задача та результат</th><th>Дата</th><th>Виконавець</th><th>Статус</th><th></th></tr></thead>
        <tbody>
          ${measurementTasks.length
            ? measurementTasks.map((task) => `
              <tr>
                <td>${escapeAttribute(task.title)}${task.note ? `<p class="muted-text">${escapeAttribute(task.note)}</p>` : ""}</td>
                <td>${crmDueLabel(task.dueAt)}</td>
                <td>${escapeAttribute(memberDisplayName(task.assignedTo))}</td>
                <td>${escapeAttribute(crmStatusLabels[task.status] || task.status || "-")}</td>
                <td>${canManageCrmTask(task) ? `<button class="table-button" type="button" data-crm-edit="${escapeAttribute(task.id)}">Відкрити</button>` : ""}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="5">Задачу на замір ще не створено.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function offerLineTotals(project) {
  const finance = normalizeProjectFinance(project.finance);
  const mismatched = finance.offerLines.some((item) => item.currency && item.currency !== (project.currency || "UAH"));
  const equipmentPurchase = finance.offerLines.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.purchasePrice || 0), 0);
  const equipmentSale = finance.offerLines.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.salePrice || 0), 0);
  const otherExpenses = finance.expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const installationPrice = Number(finance.installationPrice || 0);
  const totalSale = mismatched ? NaN : equipmentSale + installationPrice;
  const totalCost = equipmentPurchase + otherExpenses + Number(finance.crewPayroll || 0);
  return {
    finance,
    equipmentPurchase,
    equipmentSale,
    otherExpenses,
    installationPrice,
    totalSale,
    totalCost,
    profit: totalSale - totalCost,
  };
}

function renderCommercialOfferStage(project) {
  if (!canManageProjectFinance()) return `<p class="calculation-note">Комерційну пропозицію та фінансові суми готує власник або адміністратор. Файли, які вам відкрито, доступні в документах об’єкта.</p>`;
  const totals = offerLineTotals(project);
  const offerItems = warehouseItems.filter((item) => (item.currency || "UAH") === (project.currency || "UAH"));
  const firstWarehouseItem = offerItems[0] || {};
  const firstSalePrice = Number(firstWarehouseItem.retailPrice || firstWarehouseItem.installerPrice || firstWarehouseItem.salePrice || 0);
  return `
    <p class="calculation-note">Валюта комерційної пропозиції: ${project.currency || "UAH"}. Договір, матеріали та роботи в цій самій валюті.</p>
    <div class="proposal-actions">
      <button class="secondary-button" type="button" id="shareCommercialOfferButton">Надіслати</button>
      <button class="primary-button" type="button" id="printCommercialOfferButton">Друк / PDF</button>
    </div>

    <div class="metric-grid compact finance-metrics">
      <div class="metric-card"><span>Закупка обладнання</span><strong>${money(totals.equipmentPurchase, project.currency || "UAH")}</strong></div>
      <div class="metric-card"><span>Продаж обладнання</span><strong>${money(totals.equipmentSale, project.currency || "UAH")}</strong></div>
      <div class="metric-card"><span>Монтаж</span><strong>${money(totals.installationPrice, project.currency || "UAH")}</strong></div>
      <div class="metric-card"><span>Разом КП</span><strong>${money(totals.totalSale, project.currency || "UAH")}</strong></div>
    </div>

    <div class="project-stock-entry">
      <div><h3>Обладнання для пропозиції</h3><p>Пошук за назвою, моделлю й артикулом, вільні залишки та кількість біля кожного товару.</p></div>
      <button class="primary-button" type="button" data-project-stock-picker="offer" data-project-stock-id="${escapeAttribute(project.id)}">Обрати зі складу</button>
    </div>
    <p class="calculation-note">Додавання до КП формує пропозицію. Резерв і видача оформлюються окремо в матеріалах цього об’єкта.</p>
    <details class="workflow-details"><summary>Додати одну позицію зі своїми цінами</summary>
    <form class="inline-form commercial-offer-form" id="commercialOfferLineForm">
      <label>Позиція зі складу
        <select name="warehouseItemId" id="commercialOfferItemSelect" aria-describedby="commercialOfferSelectedName">
          ${offerItems.length
            ? offerItems.map((item) => `<option value="${escapeAttribute(item.id)}">${escapeAttribute(item.name)} / ${escapeAttribute(item.category)} / ${escapeAttribute(item.qty)} ${escapeAttribute(item.unit)}</option>`).join("")
            : `<option value="">Немає обладнання у валюті об’єкта</option>`}
        </select>
        <span class="commercial-offer-selected-name" id="commercialOfferSelectedName">${escapeAttribute(firstWarehouseItem.name || "")}</span>
      </label>
      <label>Кількість<input name="qty" type="number" min="0.01" step="0.01" value="1" required /></label>
      <label>Ціна закупки, ${project.currency || "UAH"}<input name="purchasePrice" type="number" min="0" step="0.01" value="${escapeAttribute(warehouseUnitCost(firstWarehouseItem))}" /></label>
      <label>Ціна продажу, ${project.currency || "UAH"}<input name="salePrice" type="number" min="0" step="0.01" value="${escapeAttribute(firstSalePrice)}" /></label>
      <label class="wide-field">Коментар<input name="note" placeholder="Комплектація, уточнення для клієнта..." /></label>
      <div class="form-submit-cell"><button class="primary-button">Додати в КП</button></div>
    </form>
    </details>
    <details class="workflow-details"><summary>Змінити вартість монтажу та ЗП</summary>
    <form class="inline-form commercial-offer-totals-form" id="commercialOfferTotalsForm">
      <label>Вартість монтажу, ${project.currency || "UAH"}<input name="installationPrice" type="number" min="0" step="0.01" value="${escapeAttribute(totals.finance.installationPrice)}" /></label>
      <label>ЗП бригади / собівартість робіт, ${project.currency || "UAH"}<input name="crewPayroll" type="number" min="0" step="0.01" value="${escapeAttribute(totals.finance.crewPayroll)}" /></label>
      <div class="form-submit-cell"><button class="secondary-button">Зберегти суми</button></div>
    </form>
    </details>

    <div class="table-wrap commercial-offer-table">
      <table>
        <thead><tr><th>Позиція</th><th>К-сть</th><th>Закупка</th><th>Продаж</th><th>Сума</th><th></th></tr></thead>
        <tbody>
          ${totals.finance.offerLines.length
            ? totals.finance.offerLines.map((item, index) => `
              <tr>
                <td><strong>${escapeAttribute(item.name)}</strong><span>${escapeAttribute(item.category)}${item.note ? ` · ${escapeAttribute(item.note)}` : ""}</span></td>
                <td>${escapeAttribute(item.qty)} ${escapeAttribute(item.unit)}</td>
                <td>${money(item.purchasePrice, project.currency || "UAH")}</td>
                <td>${money(item.salePrice, project.currency || "UAH")}</td>
                <td>${money(Number(item.qty || 0) * Number(item.salePrice || 0), project.currency || "UAH")}</td>
                <td><button class="table-button danger-text" type="button" data-delete-offer-line="${index}">Видалити</button></td>
              </tr>
            `).join("")
            : `<tr><td colspan="6">Позиції КП ще не додано. Вибери обладнання або матеріали зі складу.</td></tr>`}
        </tbody>
      </table>
    </div>

  `;
}

function commercialOfferDocumentMarkup(project) {
  const totals = offerLineTotals(project);
  return `
    <div class="passport-document commercial-offer-document">
      <header class="passport-title">
        <div>
          <p class="eyebrow">Комерційна пропозиція</p>
          <h2>${escapeAttribute(project.title)}</h2>
          <p>${escapeAttribute(project.address)}</p>
        </div>
        <img class="passport-logo" src="./assets/sparta-logo.jpeg" alt="SPARTA power" />
      </header>
      <section class="passport-company">
        <div>
          <strong>${companyContacts.name}</strong>
          <span>${companyContacts.location}</span>
        </div>
        <div>
          <span>${companyContacts.phone}</span>
          <span>${companyContacts.email}</span>
        </div>
      </section>
      <section class="passport-section">
        <h3>Клієнт</h3>
        <div class="data-grid">
          <div class="data-item"><span>Ім'я / компанія</span><strong>${escapeAttribute(project.clientName || "-")}</strong></div>
          <div class="data-item"><span>Телефон</span><strong>${escapeAttribute(project.clientPhone || "-")}</strong></div>
          <div class="data-item"><span>Об'єкт</span><strong>${escapeAttribute(project.objectType || "-")}</strong></div>
          <div class="data-item"><span>Дата</span><strong>${new Date().toLocaleDateString("uk-UA")}</strong></div>
        </div>
      </section>
      <section class="passport-section">
        <h3>Обладнання та матеріали</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Назва</th><th>Категорія</th><th>К-сть</th><th>Ціна</th><th>Сума</th></tr></thead>
            <tbody>
              ${totals.finance.offerLines.length
                ? totals.finance.offerLines.map((item) => `
                  <tr>
                    <td>${escapeAttribute(item.name)}${item.note ? `<br><span class="muted-text">${escapeAttribute(item.note)}</span>` : ""}</td>
                    <td>${escapeAttribute(item.category)}</td>
                    <td>${escapeAttribute(item.qty)} ${escapeAttribute(item.unit)}</td>
                    <td>${money(item.salePrice, project.currency || "UAH")}</td>
                    <td>${money(Number(item.qty || 0) * Number(item.salePrice || 0), project.currency || "UAH")}</td>
                  </tr>
                `).join("")
                : `<tr><td colspan="5">Позиції КП ще не додано.</td></tr>`}
              <tr><td colspan="4"><strong>Монтажні роботи</strong></td><td>${money(totals.installationPrice, project.currency || "UAH")}</td></tr>
              <tr><td colspan="4"><strong>Разом до оплати</strong></td><td><strong>${money(totals.totalSale, project.currency || "UAH")}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <footer class="passport-footer">
        <div>
          <span>Представник компанії</span>
          <strong>${companyContacts.name}</strong>
        </div>
        <div>
          <span>Дійсна на дату</span>
          <strong>${new Date().toLocaleDateString("uk-UA")}</strong>
        </div>
      </footer>
    </div>
  `;
}

function printCommercialOffer() {
  const project = selectedProject();
  if (!project) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Браузер заблокував вікно друку. Дозволь спливаючі вікна для цього сайту.");
    return;
  }
  printWindow.document.write(`
    <!doctype html>
    <html lang="uk">
      <head>
        <meta charset="utf-8" />
        <title>КП ${escapeAttribute(project.title)}</title>
        <link rel="stylesheet" href="${location.origin}/styles.css" />
      </head>
      <body class="print-page">${commercialOfferDocumentMarkup(project)}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 500);
}

async function shareCommercialOffer() {
  const project = selectedProject();
  if (!project) return;
  const totals = offerLineTotals(project);
  const text = [
    `Комерційна пропозиція: ${project.title}`,
    `Клієнт: ${project.clientName || "-"}`,
    `Адреса: ${project.address || "-"}`,
    `Сума: ${money(totals.totalSale, project.currency || "UAH")}`,
    "Для PDF натисни 'Друк / PDF' у додатку.",
  ].join("\n");
  if (navigator.share) {
    await navigator.share({ title: `КП ${project.title}`, text });
    return;
  }
  await navigator.clipboard?.writeText(text);
  alert("Текст КП скопійовано. PDF можна створити через кнопку Друк / PDF.");
}

function copyCommercialOfferToMaterials() {
  if (!requireProjectRole("finance")) return;
  const project = selectedProject();
  if (!project) return;
  const finance = normalizeProjectFinance(project.finance);
  if (!finance.offerLines.length) {
    alert("Спочатку додай позиції в КП.");
    return;
  }
  if (finance.offerLines.some((item) => item.currency && item.currency !== (project.currency || "UAH")) ||
      (project.materials || []).some((item) => item.currency && item.currency !== (project.currency || "UAH"))) {
    alert("Валюта КП та матеріалів має збігатися з валютою об’єкта.");
    return;
  }
  project.materials ||= [];
  const plannedByItem = new Map();
  finance.offerLines.forEach((item) => {
    const key = item.warehouseItemId || normalizeLookupValue(item.name);
    const planned = plannedByItem.get(key) || { ...item, qty: 0 };
    planned.qty += Number(item.qty || 0);
    plannedByItem.set(key, planned);
  });
  plannedByItem.forEach((item) => {
    const existing = (item.warehouseItemId && project.materials.find((material) => String(material.warehouseItemId || "") === String(item.warehouseItemId))) || project.materials.find((material) =>
      !material.warehouseItemId && normalizeLookupValue(material.name) === normalizeLookupValue(item.name));
    if (existing) {
      existing.plannedQty = Math.max(item.qty, Number(existing.issuedQty || 0));
      existing.warehouseItemId ||= item.warehouseItemId || "";
      if (existing.purchasePriceSnapshot == null) existing.purchasePriceSnapshot = Number(item.purchasePrice || 0);
      if (existing.salePriceSnapshot == null) existing.salePriceSnapshot = Number(item.salePrice || 0);
    } else {
      project.materials.push({ currency: project.currency || "UAH", name: item.name, category: item.category, warehouseItemId: item.warehouseItemId || "", plannedQty: item.qty, issuedQty: 0, actualQty: 0, purchasePriceSnapshot: Number(item.purchasePrice || 0), salePriceSnapshot: Number(item.salePrice || 0), unit: item.unit || "шт" });
    }
  });
  saveProjects();
  render();
  showSection("objectDetail");
}

function equipmentTypeConfig(type) {
  const configs = {
    inverters: {
      title: "Інвертори",
      addLabel: "Додати інвертор",
      photoLabel: "Фото серійника інвертора",
      powerLabel: "Потужність, кВт",
      modelPlaceholder: "SUN-12K-SG04LP3",
      serialLabel: "Серійний номер інвертора",
    },
    batteries: {
      title: "АКБ",
      addLabel: "Додати АКБ",
      photoLabel: "Фото серійника АКБ",
      powerLabel: "Ємність, кВт·год",
      modelPlaceholder: "Tower T10, US5000",
      serialLabel: "Серійний номер АКБ",
    },
    panelGroups: {
      title: "Фотомодулі",
      addLabel: "Додати фотомодулі",
      photoLabel: "Фото серійників фотомодулів",
      powerLabel: "Потужність, Вт",
      modelPlaceholder: "LR5-72HTH-580M",
      serialLabel: "Серійні номери фотомодулів",
    },
  };
  return configs[type];
}

function renderEquipmentDetails(project) {
  normalizeTechnicalEquipment(project.technical);
  return `
    <div class="equipment-detail-grid">
      ${renderEquipmentCollection(project, "inverters")}
      ${renderEquipmentCollection(project, "batteries")}
      ${renderEquipmentCollection(project, "panelGroups")}
    </div>
  `;
}

function renderEquipmentCollection(project, type) {
  const config = equipmentTypeConfig(type);
  const items = project.technical[type] || [];
  return `
    <section class="equipment-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Обладнання</p>
          <h3>${config.title}</h3>
        </div>
        <span class="chip">${items.length} поз.</span>
      </div>
      <div class="equipment-list">
        ${items.length
          ? items.map((item, index) => renderEquipmentCard(project, type, item, index)).join("")
          : `<div class="empty-state"><strong>Позиції ще не додано</strong><span>Додай модель, потужність, серійник і фото.</span></div>`}
      </div>
      <details class="workflow-details"><summary>${config.addLabel}</summary>${renderEquipmentForm(type)}</details>
    </section>
  `;
}

function renderEquipmentCard(project, type, item, index) {
  const config = equipmentTypeConfig(type);
  const photos = equipmentPhotosForProject(project, item.id);
  return `
    <article class="equipment-card">
      <div class="object-line">
        <div>
          <h3>${escapeAttribute(formatCombined(item.manufacturer, item.model))}</h3>
          <p>${config.powerLabel}: ${escapeAttribute(item.power || "-")}${item.count > 1 ? ` · К-сть: ${escapeAttribute(item.count)}` : ""}</p>
        </div>
        <button class="table-button danger-text" type="button" data-delete-equipment-type="${type}" data-delete-equipment-index="${index}">Видалити</button>
      </div>
      <div class="serial-row">
        <span>${config.serialLabel}</span>
        <strong>${escapeAttribute(item.serialNumbers || "Не вказано")}</strong>
        <label class="serial-photo-button inline" title="Сфотографувати серійник">
          📷
          <input type="file" accept="image/*" capture="environment" data-equipment-photo-type="${type}" data-equipment-photo-id="${escapeAttribute(item.id)}" />
        </label>
      </div>
      ${photos.length ? `<div class="serial-photo-preview">${photos.map((photo) => `<img loading="lazy" src="${escapeAttribute(photo.src)}" alt="${escapeAttribute(photo.caption || config.photoLabel)}" />`).join("")}</div>` : ""}
    </article>
  `;
}

function renderEquipmentForm(type) {
  const config = equipmentTypeConfig(type);
  return `
    <form class="inline-form equipment-form" data-equipment-type="${type}">
      <label>Виробник<input name="manufacturer" placeholder="Deye, Huawei, Longi..." /></label>
      <label>Модель<input name="model" placeholder="${config.modelPlaceholder}" /></label>
      <label>${config.powerLabel}<input name="power" type="number" min="0" step="0.01" /></label>
      <label>Кількість<input name="count" type="number" min="1" step="1" value="1" /></label>
      <label class="full">${config.serialLabel}<textarea name="serialNumbers" rows="2" placeholder="Один або кілька серійних номерів"></textarea></label>
      <div class="form-submit-cell"><button class="primary-button">${config.addLabel}</button></div>
    </form>
  `;
}

function equipmentPhotosForProject(project, equipmentId) {
  return (project.photos || [])
    .filter((photo) => typeof photo !== "string" && photo.equipmentId === equipmentId)
    .slice(-6)
    .reverse();
}

function renderTab(project, isValid, stringsTotal, expected, options = {}) {
  if (selectedTab === "checklist") {
    return renderWorkflowChecklist(project);
  }

  if (selectedTab === "technical") {
    return `
      <div class="section-actions">
        <button class="primary-button" id="editTechnicalButton">Редагувати техдані</button>
      </div>
      <div class="data-grid">
        <div class="data-item"><span>Панелі</span><strong>${escapeAttribute(formatCombined(project.technical.panelManufacturer, project.technical.panelModel))}</strong></div>
        <div class="data-item"><span>Кількість</span><strong>${escapeAttribute(project.technical.panelCount)} шт × ${escapeAttribute(project.technical.panelPowerW)} Вт</strong></div>
        <div class="data-item"><span>Загальна потужність</span><strong>${totalPower(project)} кВт</strong></div>
        <div class="data-item"><span>Інвертор</span><strong>${escapeAttribute(formatCombined(project.technical.inverterManufacturer, project.technical.inverterModel))}</strong></div>
        <div class="data-item"><span>Потужність інвертора</span><strong>${escapeAttribute(project.technical.inverterPowerKw || 0)} кВт</strong></div>
        <div class="data-item"><span>MPPT</span><strong>${escapeAttribute(project.technical.mpptCount)}</strong></div>
        <div class="data-item"><span>PV входів на один MPPT</span><strong>${escapeAttribute(project.technical.pvInputsPerMppt || 0)}</strong></div>
        <div class="data-item"><span>Акумулятор</span><strong>${escapeAttribute(formatCombined(project.technical.batteryManufacturer, project.technical.batteryModel))}</strong></div>
        <div class="data-item"><span>Ємність акумулятора</span><strong>${escapeAttribute(project.technical.batteryCapacityKwh || 0)} кВт·год × ${escapeAttribute(project.technical.batteryModulesCount || 0)} мод.</strong></div>
        <div class="data-item"><span>Загальна ємність АКБ</span><strong>${batteryTotalCapacity(project)} кВт·год</strong></div>
      </div>
      ${renderEquipmentDetails(project)}
    `;
  }

  if (selectedTab === "strings") {
    return `
      <div class="section-actions">
        ${
          stringsEditing
            ? `
              <button class="secondary-button" id="cancelStringsEditButton">Скасувати</button>
              <button class="primary-button" id="saveStringsEditButton">Зберегти MPPT/стрінги</button>
            `
            : `<button class="primary-button" id="editStringsButton">Редагувати MPPT/стрінги</button>`
        }
      </div>
      <p class="checkline ${isValid ? "" : "bad"}">
        ${isValid ? "Схема збігається з технічними даними." : `У схемі ${stringsTotal} панелей із ${expected}. Різниця: ${expected - stringsTotal}.`}
      </p>
      ${renderMpptBlocks(project, stringsEditing)}
    `;
  }

  if (selectedTab === "materials") {
    return `
      <p class="calculation-note">Обирайте обладнання, формуйте план, резервуйте й видавайте його зі складу прямо в об’єкті. Резерв і видача підтверджуються окремим складським документом.</p>
      <div class="section-actions">
        <button class="primary-button" type="button" data-project-stock-picker="materials" data-project-stock-id="${escapeAttribute(project.id)}">Обрати обладнання зі складу</button>
        <button class="secondary-button" type="button" id="copyOfferToMaterialsButton">Взяти план із КП</button>
        ${
          materialsEditing
            ? `
              <button class="secondary-button" id="cancelMaterialsEditButton">Скасувати</button>
              <button class="primary-button" id="saveMaterialsEditButton">Зберегти матеріали</button>
            `
            : `<button class="primary-button" id="editMaterialsButton">Редагувати матеріали</button>`
        }
      </div>
      ${
        materialsEditing
          ? `
            <form class="inline-form material-form" id="materialForm">
              <label>Категорія<select name="category" id="materialCategorySelect">${materialCategoryOptions("Обладнання")}</select></label>
              <label>Типовий матеріал<select name="catalogMaterial" id="materialCatalogSelect">${materialCatalogOptions("Обладнання")}</select></label>
              <label>Назва / уточнення<input name="name" required placeholder="Наприклад: болт М8х25" /></label>
              <label>${window.SPARTA_LOCAL_WORKSPACE?.enabled ? "Кількість" : "Планова кількість"}<input name="actualQty" type="number" min="0" step="0.001" /></label>
              <label>Од.<input name="unit" placeholder="шт, м, пар" required /></label>
              <button class="primary-button">Додати матеріал</button>
            </form>
          `
          : ""
      }
      <div class="table-wrap">
        <table>
          <thead><tr><th>Обладнання та матеріали</th><th>Категорія</th><th>План</th><th>Видано</th><th>Використано</th><th>Од.</th>${materialsEditing ? "<th></th>" : ""}</tr></thead>
          <tbody>
            ${project.materials.length
              ? project.materials.map((item, index) => {
                return `
                  <tr>
                    <td>${
                      materialsEditing
                        ? `<input class="table-input material-edit-field" data-material-index="${index}" data-material-field="name" value="${escapeAttribute(item.name)}" />`
                        : escapeAttribute(item.name)
                    }</td>
                    <td>${
                      materialsEditing
                        ? `<select class="table-input material-edit-field" data-material-index="${index}" data-material-field="category">${materialCategoryOptions(item.category)}</select>`
                        : escapeAttribute(item.category)
                    }</td>
                    <td>${materialsEditing ? `<input class="table-input material-edit-field" data-material-index="${index}" data-material-field="plannedQty" type="number" min="0" step="0.001" value="${Number(item.plannedQty || 0)}" />` : Number(item.plannedQty || 0)}</td>
                    <td>${Number(item.issuedQty || 0)}</td>
                    <td>${
                      materialsEditing && window.SPARTA_LOCAL_WORKSPACE?.enabled
                        ? `<input class="table-input material-edit-field" data-material-index="${index}" data-material-field="actualQty" type="number" min="0" step="0.01" value="${escapeAttribute(item.actualQty)}" />`
                        : Number(item.actualQty || 0)
                    }</td>
                    <td>${
                      materialsEditing
                        ? `<input class="table-input material-edit-field" data-material-index="${index}" data-material-field="unit" value="${escapeAttribute(item.unit)}" />`
                        : escapeAttribute(item.unit)
                    }</td>
                    ${materialsEditing ? `<td><button class="table-button danger-text" data-delete-material-index="${index}">Видалити</button></td>` : ""}
                  </tr>
                `;
              })
              .join("")
              : `<tr><td colspan="${materialsEditing ? 7 : 6}">Матеріали ще не додано.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  if (selectedTab === "finance") {
    if ((!window.SPARTA_LOCAL_WORKSPACE?.enabled && !cloudState.ready) || !["owner", "admin"].includes(cloudState.memberRole)) {
      return `<p class="calculation-note">Фінанси та оплати доступні власнику й адміністратору компанії.</p>`;
    }
    const totals = projectFinanceTotals(project);
    return `
      ${options.financeReportOnly ? "" : `
      <div class="metric-grid compact finance-metrics">
        <div class="metric-card"><span>Сума об'єкта</span><strong>${money(totals.revenue, project.currency || "UAH")}</strong></div>
        <div class="metric-card warning"><span>${totals.balanceDue < 0 ? "Переплата клієнта" : "До оплати клієнтом"}</span><strong>${window.SpartaCash.formatAmount(Math.round(Math.abs(totals.balanceDue) * 100))}</strong></div>
        <div class="metric-card ${totals.profit >= 0 ? "success" : "danger"}"><span>${isClosedProjectStatus(project.status) ? "Прибуток за кошторисом" : "Прогноз прибутку"}</span><strong>${money(totals.profit, project.currency || "UAH")}</strong></div>
        <div class="metric-card"><span>Маржа</span><strong>${totals.margin}%</strong></div>
      </div>

      <form class="inline-form finance-form" id="projectFinanceForm">
        <label>Сума договору, ${project.currency || "UAH"}<input name="contractPrice" type="number" min="0" step="0.01" value="${escapeAttribute(totals.contractPrice)}" /></label>
        <label>Вартість монтажу, ${project.currency || "UAH"}<input name="installationPrice" type="number" min="0" step="0.01" value="${escapeAttribute(totals.installationPrice)}" /></label>
        <label>Аванс до запуску журналу<input name="advancePaid" type="number" min="0" step="0.01" value="${escapeAttribute(totals.advancePaid)}" readonly /></label>
        <label>ЗП бригади<input name="crewPayroll" type="number" min="0" step="0.01" value="${escapeAttribute(totals.crewPayroll)}" /></label>
        <div class="form-submit-cell"><button class="primary-button">Зберегти фінанси</button></div>
      </form>

      ${window.SpartaCashBook?.projectMarkup(project) || ""}
      `}

      <section class="finance-panel finance-summary-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Розрахунок</p>
            <h3>Заробіток по об'єкту</h3>
          </div>
          <span class="chip">${money(totals.revenue, project.currency || "UAH")} − ${money(totals.cost, project.currency || "UAH")}</span>
        </div>
        <div class="data-grid">
          <div class="data-item"><span>Сума об'єкта</span><strong>${money(totals.revenue, project.currency || "UAH")}</strong></div>
          <div class="data-item"><span>Вартість обладнання</span><strong>${money(totals.equipmentPurchase, project.currency || "UAH")}</strong></div>
          <div class="data-item"><span>Додаткові витрати</span><strong>${money(totals.otherExpenses, project.currency || "UAH")}</strong></div>
          <div class="data-item"><span>ЗП монтажників</span><strong>${money(totals.crewPayroll, project.currency || "UAH")}</strong></div>
          <div class="data-item"><span>Всі витрати</span><strong>${money(totals.cost, project.currency || "UAH")}</strong></div>
          <div class="data-item"><span>Всього отримано від клієнта</span><strong>${window.SpartaCash.formatAmount(Math.round(totals.receivedPayments * 100))}</strong></div>
          <div class="data-item"><span>${totals.balanceDue < 0 ? "Переплата клієнта" : "До оплати клієнтом"}</span><strong>${window.SpartaCash.formatAmount(Math.round(Math.abs(totals.balanceDue) * 100))}</strong></div>
          <div class="data-item"><span>${isClosedProjectStatus(project.status) ? "Прибуток за кошторисом" : "Прогноз прибутку"}</span><strong>${money(totals.profit, project.currency || "UAH")}</strong></div>
        </div>
        <p class="calculation-note">Заробіток = сума об'єкта − вартість обладнання − додаткові витрати − ЗП монтажників. До оплати = сума об'єкта − попередній аванс − оплати клієнта в касі + повернення.</p>
        <p class="calculation-note">Виплачено бригаді через касу: ${window.SpartaCash.formatAmount(totals.cashPayments.recordedPayrollMinor)}. Залишилось виплатити бригаді: ${window.SpartaCash.formatAmount(Math.max(0, Math.round(totals.crewPayroll * 100) - totals.cashPayments.recordedPayrollMinor))}. Оплати матеріалів у касі: ${window.SpartaCash.formatAmount(totals.cashPayments.materialsMinor)}. Ці платежі показують рух грошей і не додаються вдруге до собівартості кошторису.</p>
      </section>

      <div class="two-column">
        <section class="finance-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Матеріали</p>
              <h3>Матеріали з фіксованою собівартістю</h3>
            </div>
            <span class="chip">Продаж: ${money(totals.equipmentSale, project.currency || "UAH")}</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Матеріал</th><th>К-сть</th><th>Склад</th><th>Закупка</th><th>Продаж</th><th>Разом</th></tr></thead>
              <tbody>
                ${totals.equipment.length
                  ? totals.equipment.map((item, index) => `
                    <tr>
                      <td>${escapeAttribute(item.name)}</td>
                      <td>${escapeAttribute(item.qty)} ${escapeAttribute(item.unit)}</td>
                      <td>${item.hasWarehousePrice ? escapeAttribute(item.warehouseName) : `<span class="chip amber">Немає на складі</span>`}</td>
                      <td>${item.hasWarehousePrice ? money(item.purchasePrice, project.currency || "UAH") : "-"}</td>
                      <td>${item.hasWarehousePrice ? money(item.salePrice, project.currency || "UAH") : "-"}</td>
                      <td>${money(Number(item.qty || 0) * Number(item.salePrice || 0), project.currency || "UAH")}</td>
                    </tr>
                  `).join("")
                  : `<tr><td colspan="6">Матеріали ще не додано у вкладці “Матеріали”.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>

        <section class="finance-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Витрати</p>
              <h3>Додаткові витрати</h3>
            </div>
            <span class="chip">Разом: ${money(totals.otherExpenses, project.currency || "UAH")}</span>
          </div>
          <form class="inline-form finance-line-form" id="projectExpenseForm">
            <label>Назва<input name="name" required placeholder="Доставка, проживання, пальне..." /></label>
            <label>Сума<input name="amount" type="number" min="0" step="0.01" required /></label>
            <button class="primary-button">Додати</button>
          </form>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Витрата</th><th>Сума</th><th></th></tr></thead>
              <tbody>
                ${totals.expenses.length
                  ? totals.expenses.map((item, index) => `
                    <tr>
                      <td>${escapeAttribute(item.name)}</td>
                      <td>${money(item.amount, project.currency || "UAH")}</td>
                      <td><button class="table-button danger-text" data-delete-expense-index="${index}">Видалити</button></td>
                    </tr>
                  `).join("")
                  : `<tr><td colspan="3">Додаткові витрати ще не додано.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  if (selectedTab === "photos") {
    return renderProjectPhotos(project);
  }

  if (selectedTab === "files") {
    return renderProjectFiles(project, options.fileCategories);
  }

  if (selectedTab === "passport") {
    return `
      <div class="passport-actions">
        <button class="secondary-button" id="objectPassportPreviewButton">Попередній перегляд</button>
        <button class="primary-button" id="objectPassportPrintButton">Друк / PDF</button>
      </div>
      <details class="workflow-details"><summary>Переглянути паспорт станції</summary>
      <article class="passport-preview object-passport-preview" id="objectPassportPreview">
        ${passportDocumentMarkup(project)}
      </article>
      </details>
    `;
  }

  return `
    <div class="object-specs">
      <span><b>Адреса</b><em>${escapeAttribute(project.address)}</em></span>
      ${project.clientEmail ? `<span><b>Email клієнта</b><em>${escapeAttribute(project.clientEmail)}</em></span>` : ""}
      ${project.contractNumber ? `<span><b>Договір</b><em>${escapeAttribute(project.contractNumber)} · ${escapeAttribute(project.contractDate || "")}</em></span>` : ""}
      <span><b>Бригада</b><em>${escapeAttribute(project.teamName || "Не призначено")}</em></span>
      <span><b>Потужність</b><em>${totalPower(project)} кВт</em></span>
      ${objectTechnicalSpecs(project, false)}
    </div>
    <p style="margin-top: 16px">${escapeAttribute(project.comment || "")}</p>
    ${(project.statusHistory || []).length ? `<h3>Історія етапів</h3><div class="table-wrap"><table><thead><tr><th>Дата</th><th>Етап</th><th>Примітка</th></tr></thead><tbody>${project.statusHistory.map((entry) => `<tr><td>${escapeAttribute(entry.at || entry.date || entry.createdAt || "")}</td><td>${escapeAttribute(statusLabels[entry.status] || entry.status || "")}</td><td>${escapeAttribute(entry.note || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <h3>Потужність стрінгів</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>MPPT</th><th>PV</th><th>Стрінг</th><th>Тип</th><th>Панелей у розрахунку</th><th>Потужність стрінга</th></tr></thead>
        <tbody>
          ${project.strings.length
            ? project.strings
                .map(
                  (item) => `
                    <tr>
                      <td>${escapeAttribute(item.mpptNumber)}</td>
                      <td>${pvInputLabel(item)}</td>
                      <td>${escapeAttribute(item.stringNumber)}</td>
                      <td>${stringTypeLabel(item.stringType)}</td>
                      <td>${effectiveStringPanels(item)}</td>
                      <td>${stringPowerKw(project, item)} кВт</td>
                    </tr>
                  `,
                )
                .join("")
            : `<tr><td colspan="6">Стрінги ще не додано.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderPhotoTile(photo, index) {
  if (typeof photo === "string") {
    return `<div class="photo-tile"><span>${escapeAttribute(photo)}</span></div>`;
  }

  return `
    <figure class="photo-card">
      <img loading="lazy" src="${escapeAttribute(photo.src)}" alt="${escapeAttribute(photo.caption || photo.category || "Фото об'єкта")}" />
      <figcaption>
        <strong>${escapeAttribute(photo.category || "Фото")}</strong>
        <span>${escapeAttribute(photo.caption || "Без підпису")}</span>
      </figcaption>
      <button class="table-button danger-text photo-delete" data-delete-photo-index="${index}">Видалити</button>
    </figure>
  `;
}

function renderProjectFiles(project, categories = null) {
  const allCategories = ["commercial_offer", "estimate_update", "sketchup_model", "contract", "receipt", "passport", "handover", "service_report", "other"];
  const visibleCategories = categories || allCategories;
  const proposalOnly = categories?.length === 1 && categories[0] === "commercial_offer";
  // Preserve source indices: open/delete handlers address the original files array.
  const entries = (project.files || []).map((file, index) => ({ file, index }))
    .filter(({ file }) => !categories || categories.includes(file.category));
  return `
    <details class="workflow-details"><summary>${proposalOnly ? "Додати документ КП" : "Додати документ"}</summary>
    <form class="inline-form file-upload-form" id="projectFileForm">
      <label>Тип файлу
        <select name="category">
          ${visibleCategories.map((category) => `<option value="${category}">${projectFileCategoryLabel(category)}</option>`).join("")}
        </select>
      </label>
      <label>Опис
        <input name="note" placeholder="${proposalOnly ? "Версія КП, дата або уточнення для клієнта" : "Опис документа об’єкта"}" />
      </label>
      <label class="file-field">Файл
        <input name="file" type="file" accept="${proposalOnly ? ".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp" : ".pdf,.doc,.docx,.xls,.xlsx,.skp,.skb,.dae,.dwg,.dxf,.jpg,.jpeg,.png,.webp,.txt,.zip"}" required />
      </label>
      <div class="form-submit-cell"><button class="primary-button">${proposalOnly ? "Додати файл КП" : "Додати файл"}</button></div>
    </form>
    </details>
    <div class="file-list">
      ${entries.map(({ file, index }) => renderProjectFileCard(file, index)).join("") || `<div class="empty-state"><strong>${proposalOnly ? "Файли КП ще не додано" : "Файли ще не додано"}</strong><span>${proposalOnly ? "Завантаж комерційну пропозицію для клієнта. Чеки, договори та фото зберігаються в інших етапах об’єкта." : "Додай потрібний документ об’єкта."}</span></div>`}
    </div>
  `;
}

function projectFileCategoryLabel(category) {
  const labels = {
    commercial_offer: "Комерційна пропозиція",
    estimate_update: "Оновлений кошторис",
    sketchup_model: "SketchUp / 3D модель",
    contract: "Договір",
    receipt: "Касовий чек",
    passport: "Паспорт станції",
    handover: "Акт виконаних робіт",
    service_report: "Сервісний звіт",
    other: "Інший файл",
  };
  return labels[category] || "Файл";
}

function projectFileIcon(category) {
  if (category === "commercial_offer") return "КП";
  if (category === "estimate_update") return "₴";
  if (category === "sketchup_model") return "3D";
  if (category === "contract") return "DOC";
  if (category === "receipt") return "₴";
  return "FILE";
}

function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (!bytes) return "Розмір не вказано";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function formatProjectFileDate(value) {
  if (!value) return "Без дати";
  return new Date(value).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderProjectFileCard(file, index) {
  const canOpen = Boolean(file.src || file.storagePath || file.fileKey);
  return `
    <article class="project-file-card">
      <div class="project-file-icon">${projectFileIcon(file.category)}</div>
      <div class="project-file-main">
        <div class="object-line">
          <div>
            <h3>${escapeAttribute(file.fileName || "Файл без назви")}</h3>
            <p>${escapeAttribute(file.note || "Опис не додано.")}</p>
          </div>
          <span class="chip">${projectFileCategoryLabel(file.category)}</span>
        </div>
        <div class="file-meta">
          <span>${formatFileSize(file.size)}</span>
          <span>${formatProjectFileDate(file.createdAt)}</span>
        </div>
        <div class="crm-actions">
          ${canOpen ? `<button class="secondary-button compact-button" data-open-file-index="${index}">Відкрити</button>` : ""}
          <button class="danger-button compact-button" data-delete-file-index="${index}">Видалити</button>
        </div>
      </div>
    </article>
  `;
}

function renderMpptBlocks(project, editing = false) {
  const mpptCount = Number(project.technical.mpptCount || 0);
  if (!mpptCount) {
    return `
      <div class="wide-panel">
        <h2>MPPT ще не налаштовано</h2>
        <p>Спочатку відкрий вкладку “Техдані” і вкажи кількість MPPT інвертора.</p>
      </div>
    `;
  }

  return `
    <div class="mppt-grid">
      ${Array.from({ length: mpptCount }, (_, index) => renderMpptBlock(project, index + 1, editing)).join("")}
    </div>
    ${renderAllStringsTable(project)}
  `;
}

function renderMpptBlock(project, mpptNumber, editing = false) {
  const items = project.strings
    .map((item, index) => ({ ...item, originalIndex: index }))
        .filter((item) => Number(item.mpptNumber) === Number(mpptNumber))
    .sort((a, b) => Number(a.pvInputNumber || 1) - Number(b.pvInputNumber || 1) || a.stringNumber - b.stringNumber);
  const totalPanels = items.reduce((sum, item) => sum + effectiveStringPanels(item), 0);
  const totalPower = ((totalPanels * Number(project.technical.panelPowerW || 0)) / 1000).toFixed(2);

  return `
    <section class="mppt-card">
      <div class="mppt-head">
        <div>
          <p class="eyebrow">Вхід інвертора</p>
          <h3>MPPT ${mpptNumber}</h3>
        </div>
        <div class="status-row">
          <span class="chip">${totalPanels} панелей</span>
          <span class="chip green">${totalPower} кВт</span>
        </div>
      </div>

      ${
        editing
          ? `
            <form class="inline-form connection-string-form" data-mppt-number="${mpptNumber}">
              <label>Стрінг
                <input name="stringNumber" type="number" min="1" step="1" value="${nextStringNumber(project, mpptNumber)}" required />
              </label>
              <label>PV вхід
                <select name="pvInputNumber">
                  ${pvInputOptions(project)}
                </select>
              </label>
              <label>Тип стрінга
                <select name="stringType">
                  <option value="normal">Звичайний</option>
                  <option value="parallel">Паралельний</option>
                </select>
              </label>
              <label>Кількість панелей
                <input name="panelCount" type="number" min="0" step="1" required />
              </label>
              <label>Орієнтація
                <input name="orientation" placeholder="Південь, схід, захід" />
              </label>
              <label>Кут
                <input name="tiltAngle" type="number" min="0" step="1" />
              </label>
              <label>Примітка
                <input name="note" placeholder="Лівий скат, правий скат" />
              </label>
              <button class="primary-button">Додати до MPPT ${mpptNumber}</button>
            </form>
          `
          : ""
      }

      <div class="table-wrap">
        <table>
          <thead><tr><th>PV</th><th>Стрінг</th><th>Тип</th><th>Панелей</th><th>В розрахунку</th><th>Потужність</th><th>Орієнтація</th><th>Кут</th><th>Примітка</th>${editing ? "<th></th>" : ""}</tr></thead>
          <tbody>
            ${items.length
              ? items
                  .map(
                    (item) => `
                      <tr>
                        <td>${
                          editing
                            ? `
                              <select class="table-input string-edit-field" data-string-index="${escapeAttribute(item.originalIndex)}" data-string-field="pvInputNumber">
                                ${pvInputOptions(project, item.pvInputNumber || 1)}
                              </select>
                            `
                            : escapeAttribute(pvInputLabel(item))
                        }</td>
                        <td>${
                          editing
                            ? `<input class="table-input string-edit-field" data-string-index="${escapeAttribute(item.originalIndex)}" data-string-field="stringNumber" type="number" min="1" step="1" value="${escapeAttribute(item.stringNumber)}" />`
                            : escapeAttribute(item.stringNumber)
                        }</td>
                        <td>${
                          editing
                            ? `
                              <select class="table-input string-edit-field" data-string-index="${escapeAttribute(item.originalIndex)}" data-string-field="stringType">
                                <option value="normal" ${selectedAttr(item.stringType || "normal", "normal")}>Звичайний</option>
                                <option value="parallel" ${selectedAttr(item.stringType, "parallel")}>Паралельний</option>
                              </select>
                            `
                            : stringTypeLabel(item.stringType)
                        }</td>
                        <td>${
                          editing
                            ? `<input class="table-input string-edit-field" data-string-index="${escapeAttribute(item.originalIndex)}" data-string-field="panelCount" type="number" min="0" step="1" value="${escapeAttribute(item.panelCount)}" />`
                            : escapeAttribute(item.panelCount)
                        }</td>
                        <td>${effectiveStringPanels(item)}</td>
                        <td>${stringPowerKw(project, item)} кВт</td>
                        <td>${
                          editing
                            ? `<input class="table-input string-edit-field" data-string-index="${escapeAttribute(item.originalIndex)}" data-string-field="orientation" value="${escapeAttribute(item.orientation)}" />`
                            : escapeAttribute(item.orientation || "-")
                        }</td>
                        <td>${
                          editing
                            ? `<input class="table-input string-edit-field" data-string-index="${escapeAttribute(item.originalIndex)}" data-string-field="tiltAngle" type="number" min="0" step="1" value="${escapeAttribute(item.tiltAngle || 0)}" />`
                            : `${escapeAttribute(item.tiltAngle || "-")}°`
                        }</td>
                        <td>${
                          editing
                            ? `<input class="table-input string-edit-field" data-string-index="${escapeAttribute(item.originalIndex)}" data-string-field="note" value="${escapeAttribute(item.note)}" />`
                            : escapeAttribute(item.note || "-")
                        }</td>
                        ${editing ? `<td><button class="table-button danger-text" data-delete-string-index="${escapeAttribute(item.originalIndex)}">Видалити</button></td>` : ""}
                      </tr>
                    `,
                  )
                  .join("")
              : `<tr><td colspan="${editing ? 10 : 9}">Для MPPT ${mpptNumber} стрінги ще не додано.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAllStringsTable(project) {
  const items = [...project.strings].sort(
    (a, b) => a.mpptNumber - b.mpptNumber || Number(a.pvInputNumber || 1) - Number(b.pvInputNumber || 1) || a.stringNumber - b.stringNumber,
  );
  const totalPanels = items.reduce((sum, item) => sum + effectiveStringPanels(item), 0);
  const totalPower = ((totalPanels * Number(project.technical.panelPowerW || 0)) / 1000).toFixed(2);

  return `
    <section class="summary-table">
      <div class="mppt-head">
        <div>
          <p class="eyebrow">Зведена інформація</p>
          <h3>Усі стрінги об'єкта</h3>
        </div>
        <div class="status-row">
          <span class="chip">${totalPanels} панелей</span>
          <span class="chip green">${totalPower} кВт</span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>MPPT</th><th>PV</th><th>Стрінг</th><th>Тип</th><th>Панелей</th><th>В розрахунку</th><th>Потужність</th><th>Орієнтація</th><th>Кут</th><th>Примітка</th></tr></thead>
          <tbody>
            ${items.length
              ? items
                  .map(
                    (item) => `
                      <tr>
                        <td>${escapeAttribute(item.mpptNumber)}</td>
                        <td>${escapeAttribute(pvInputLabel(item))}</td>
                        <td>${escapeAttribute(item.stringNumber)}</td>
                        <td>${stringTypeLabel(item.stringType)}</td>
                        <td>${escapeAttribute(item.panelCount)}</td>
                        <td>${effectiveStringPanels(item)}</td>
                        <td>${stringPowerKw(project, item)} кВт</td>
                        <td>${escapeAttribute(item.orientation || "-")}</td>
                        <td>${escapeAttribute(item.tiltAngle || "-")}°</td>
                        <td>${escapeAttribute(item.note || "-")}</td>
                      </tr>
                    `,
                  )
                  .join("")
              : `<tr><td colspan="10">Стрінги ще не додано.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPanelCells(count, limit = 18) {
  const panelCount = Math.max(0, Number(count || 0));
  const visibleCount = Math.min(panelCount, limit);
  const rest = panelCount - visibleCount;
  const cells = Array.from({ length: visibleCount }, () => `<span class="panel-cell"></span>`).join("");
  return `${cells}${rest > 0 ? `<span class="panel-more">+${rest}</span>` : ""}`;
}

function renderStringVisual(project, item) {
  const isParallel = item.stringType === "parallel";
  const panels = Number(item.panelCount || 0);
  const effectivePanels = effectiveStringPanels(item);
  const branchCount = isParallel ? 2 : 1;

  return `
    <article class="string-visual">
      <div class="string-visual-head">
        <strong>Стрінг ${escapeAttribute(item.stringNumber || "-")}</strong>
        <span>${stringTypeLabel(item.stringType)}</span>
      </div>
      <div class="panel-branches ${isParallel ? "parallel" : ""}">
        ${Array.from({ length: branchCount }, (_, index) => `
          <div class="panel-branch">
            <span class="branch-label">${isParallel ? `Гілка ${index + 1}` : "Послідовно"}</span>
            <div class="panel-row">${renderPanelCells(panels)}</div>
          </div>
        `).join("")}
      </div>
      <div class="string-visual-foot">
        <span>${isParallel ? `${panels} × 2 = ${effectivePanels}` : `${effectivePanels}`} панелей</span>
        <span>${stringPowerKw(project, item)} кВт</span>
        <span>${escapeAttribute(item.orientation || "Орієнтація не вказана")}</span>
      </div>
    </article>
  `;
}

function renderConnectionDiagram(project) {
  const mpptCount = Math.max(Number(project.technical.mpptCount || 0), ...project.strings.map((item) => Number(item.mpptNumber || 0)), 0);
  if (!mpptCount || !project.strings.length) {
    return `<p class="muted-text">Схему підключення ще не додано.</p>`;
  }

  return `
    <div class="connection-diagram">
      <aside class="inverter-node">
        <span>Інвертор</span>
        <strong>${escapeAttribute(formatFilledCombined(project.technical.inverterManufacturer, project.technical.inverterModel) || "Інвертор")}</strong>
        <em>${escapeAttribute(project.technical.inverterPowerKw || 0)} кВт</em>
      </aside>
      <div class="mppt-visual-list">
        ${Array.from({ length: mpptCount }, (_, index) => {
          const mpptNumber = index + 1;
          const items = project.strings
            .filter((item) => Number(item.mpptNumber) === mpptNumber)
            .sort((a, b) => Number(a.pvInputNumber || 1) - Number(b.pvInputNumber || 1) || Number(a.stringNumber || 0) - Number(b.stringNumber || 0));
          const totalPanels = items.reduce((sum, item) => sum + effectiveStringPanels(item), 0);
          const totalPower = ((totalPanels * Number(project.technical.panelPowerW || 0)) / 1000).toFixed(2);

          return `
            <section class="mppt-visual">
              <div class="mppt-visual-title">
                <div>
                  <span>MPPT ${mpptNumber}</span>
                  <strong>${totalPanels} панелей · ${totalPower} кВт</strong>
                </div>
              </div>
              <div class="pv-visual-list">
                ${items.length
                  ? items.map((item) => `
                    <div class="pv-visual">
                      <div class="pv-node">${escapeAttribute(pvInputLabel(item))}</div>
                      ${renderStringVisual(project, item)}
                    </div>
                  `).join("")
                  : `<p class="muted-text">Стрінги для MPPT ${mpptNumber} ще не додано.</p>`}
              </div>
            </section>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function formatCombined(first, second) {
  const value = [first, second].filter(Boolean).join(" ");
  return value || "Не заповнено";
}

function openTechnicalDialog() {
  if (!requireProjectRole()) return;
  const project = selectedProject();
  technicalForm.reset();
  Object.entries(project.technical).forEach(([key, value]) => {
    if (technicalForm.elements[key]) {
      technicalForm.elements[key].value = value ?? "";
    }
  });
  syncPanelManufacturerSelect(project.technical.panelManufacturer);
  updateTechnicalPowerPreview();
  technicalDialog.showModal();
}

function openProjectInfoDialog() {
  if (!requireProjectRole()) return;
  const project = selectedProject();
  if (!project) return;

  projectInfoForm.reset();
  projectInfoForm.elements.currency.value = project.currency || "UAH";
  projectInfoForm.elements.currency.disabled = true;
  projectInfoForm.elements.currency.title = "Валюта фіксується під час створення об’єкта.";
  ["title", "clientName", "clientPhone", "address", "objectType", "installationDate", "teamName", "comment"].forEach((key) => {
    if (projectInfoForm.elements[key]) {
      projectInfoForm.elements[key].value = project[key] ?? "";
    }
  });
  projectInfoDialog.showModal();
}

function syncPanelManufacturerSelect(value) {
  const knownValues = Array.from(panelManufacturerSelect.options).map((option) => option.value);
  if (value && !knownValues.includes(value)) {
    const option = new Option(value, value);
    panelManufacturerSelect.add(option, panelManufacturerSelect.options[panelManufacturerSelect.options.length - 1]);
  }
  panelManufacturerSelect.value = knownValues.includes(value) ? value : value ? "custom" : "";
  if (value && !knownValues.includes(value)) {
    panelManufacturerSelect.value = value;
  }
}

function updateTechnicalPowerPreview() {
  const panelCount = Number(technicalForm.elements.panelCount.value || 0);
  const panelPowerW = Number(technicalForm.elements.panelPowerW.value || 0);
  technicalPowerPreview.textContent = `Загальна потужність: ${((panelCount * panelPowerW) / 1000).toFixed(2)} кВт`;
}

function passportDocumentMarkup(project) {
  return `
    <div class="passport-document">
      <header class="passport-title">
        <div>
          <p class="eyebrow">Паспорт об'єкта СЕС</p>
          <h2>${escapeAttribute(project.title)}</h2>
          <p>${escapeAttribute(project.address)}</p>
        </div>
        <img class="passport-logo" src="./assets/sparta-logo.jpeg" alt="SPARTA power" />
      </header>

      <section class="passport-company">
        <div>
          <strong>${companyContacts.name}</strong>
          <span>${companyContacts.location}</span>
        </div>
        <div>
          <span>${companyContacts.phone}</span>
          <span>${companyContacts.email}</span>
        </div>
      </section>

      <section class="passport-section">
        <h3>Основна інформація</h3>
        <div class="data-grid">
          <div class="data-item"><span>Клієнт</span><strong>${escapeAttribute(project.clientName)}</strong></div>
          <div class="data-item"><span>Телефон</span><strong>${escapeAttribute(project.clientPhone || "-")}</strong></div>
          <div class="data-item"><span>Дата монтажу</span><strong>${escapeAttribute(project.installationDate || "-")}</strong></div>
          <div class="data-item"><span>Відповідальна бригада</span><strong>${escapeAttribute(project.teamName || "-")}</strong></div>
          <div class="data-item"><span>Статус</span><strong>${statusLabels[project.status] || "-"}</strong></div>
          <div class="data-item"><span>Встановлена потужність</span><strong>${totalPower(project)} кВт</strong></div>
        </div>
      </section>

      <section class="passport-section">
        <h3>Обладнання</h3>
        <div class="data-grid">
          <div class="data-item"><span>Сонячні панелі</span><strong>${escapeAttribute(project.technical.panelManufacturer || "-")} ${escapeAttribute(project.technical.panelModel || "-")}, ${escapeAttribute(project.technical.panelCount || 0)} шт × ${escapeAttribute(project.technical.panelPowerW || 0)} Вт.</strong></div>
          <div class="data-item"><span>Інвертор</span><strong>${escapeAttribute(project.technical.inverterManufacturer || "-")} ${escapeAttribute(project.technical.inverterModel || "-")}, ${escapeAttribute(project.technical.inverterPowerKw || 0)} кВт, MPPT: ${escapeAttribute(project.technical.mpptCount || 0)}, PV входів на MPPT: ${escapeAttribute(project.technical.pvInputsPerMppt || 0)}.</strong></div>
          <div class="data-item"><span>Система збереження</span><strong>${escapeAttribute(formatBatteryPassport(project))}</strong></div>
        </div>
      </section>

      <section class="passport-section">
        <h3>Схема підключення</h3>
        ${renderConnectionDiagram(project)}
      </section>

      <section class="passport-section">
        <h3>Матеріали</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Назва</th><th>Категорія</th><th>Кількість</th></tr></thead>
            <tbody>
              ${project.materials.length
                ? project.materials.map((item) => `<tr><td>${escapeAttribute(item.name)}</td><td>${escapeAttribute(item.category)}</td><td>${escapeAttribute(item.actualQty)} ${escapeAttribute(item.unit)}</td></tr>`).join("")
                : `<tr><td colspan="3">Матеріали ще не додано.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>

      <section class="passport-section">
        <h3>Фото об'єкта</h3>
        ${renderPassportPhotos(project)}
      </section>

      <footer class="passport-footer">
        <div>
          <span>Представник компанії</span>
          <strong>${companyContacts.name}</strong>
        </div>
        <div>
          <span>Дата формування</span>
          <strong>${new Date().toLocaleDateString("uk-UA")}</strong>
        </div>
      </footer>
    </div>
  `;
}

function renderPassport() {
  const project = selectedProject();
  if (!project) {
    passportPreview.innerHTML = `<h2>Паспорт недоступний</h2><p>Спочатку створи або вибери об'єкт.</p>`;
    return;
  }

  passportPreview.innerHTML = passportDocumentMarkup(project);
}

function clientProject() {
  return projects.find((project) => !isClosedProjectStatus(project.status)) || projects[0] || null;
}

const solarMonthLabels = ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"];
// Typical horizontal irradiation for western/central Ukraine, kWh/m² per month.
// Used only if the weather archive cannot be reached.
const fallbackMonthlyIrradiation = [29, 47, 85, 113, 139, 148, 151, 130, 90, 56, 30, 22];

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeSolarCalculator(values = {}) {
  return {
    location: String(values.location || solarCalculatorDefaults.location).trim() || solarCalculatorDefaults.location,
    locationSource: values.locationSource === "device" ? "device" : "city",
    latitude: boundedNumber(values.latitude, solarCalculatorDefaults.latitude, -90, 90),
    longitude: boundedNumber(values.longitude, solarCalculatorDefaults.longitude, -180, 180),
    capacityKw: boundedNumber(values.capacityKw, solarCalculatorDefaults.capacityKw, 0.2, 500),
    tilt: boundedNumber(values.tilt, solarCalculatorDefaults.tilt, 0, 90),
    azimuth: boundedNumber(values.azimuth, solarCalculatorDefaults.azimuth, -180, 180),
    systemLoss: boundedNumber(values.systemLoss, solarCalculatorDefaults.systemLoss, 0, 45),
    monthlyConsumption: boundedNumber(values.monthlyConsumption, solarCalculatorDefaults.monthlyConsumption, 0, 100000),
    tariff: boundedNumber(values.tariff, solarCalculatorDefaults.tariff, 0, 100),
  };
}

function solarOrientationFactor(tilt, azimuth) {
  // Open-Meteo archive supplies horizontal irradiation. This correction turns it
  // into a cautious estimate for the selected roof orientation.
  const slopePenalty = Math.abs(Number(tilt) - 32) * 0.003;
  const azimuthPenalty = Math.abs(Number(azimuth)) * 0.0018;
  return Math.min(1.12, Math.max(0.72, 1.04 - slopePenalty - azimuthPenalty));
}

function buildSolarEstimate(config, monthlyIrradiation, source = "Орієнтовний профіль для України", dailyGeneration = []) {
  const normalized = normalizeSolarCalculator(config);
  const orientationFactor = solarOrientationFactor(normalized.tilt, normalized.azimuth);
  const performanceRatio = 1 - normalized.systemLoss / 100;
  const monthly = solarMonthLabels.map((month, index) => {
    const irradiation = Math.max(0, Number(monthlyIrradiation[index] || 0));
    const generation = irradiation * normalized.capacityKw * orientationFactor * performanceRatio;
    const selfConsumption = Math.min(generation, normalized.monthlyConsumption);
    const surplus = Math.max(0, generation - selfConsumption);
    const savings = selfConsumption * normalized.tariff;
    return {
      month,
      irradiation: Number(irradiation.toFixed(1)),
      generation: Number(generation.toFixed(1)),
      selfConsumption: Number(selfConsumption.toFixed(1)),
      surplus: Number(surplus.toFixed(1)),
      savings: Math.round(savings),
    };
  });
  const total = (field) => monthly.reduce((sum, item) => sum + Number(item[field] || 0), 0);
  return {
    config: normalized,
    source,
    calculatedAt: new Date().toISOString(),
    dailyGeneration,
    monthly,
    annualGeneration: Number(total("generation").toFixed(1)),
    annualSelfConsumption: Number(total("selfConsumption").toFixed(1)),
    annualSurplus: Number(total("surplus").toFixed(1)),
    annualSavings: Math.round(total("savings")),
  };
}

function fallbackSolarEstimate(config = solarCalculator) {
  const estimate = buildSolarEstimate(config, fallbackMonthlyIrradiation);
  const monthIndex = new Date().getMonth();
  const year = new Date().getFullYear() - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const dailyAverage = estimate.monthly[monthIndex].generation / daysInMonth;
  estimate.dailyGeneration = Array.from({ length: daysInMonth }, (_, index) => {
    const weatherFactor = 0.76 + ((index * 17) % 29) / 100;
    return {
      date: `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
      generation: Number((dailyAverage * weatherFactor).toFixed(1)),
    };
  });
  return estimate;
}

function monthlyIrradiationFromArchive(daily = {}) {
  const totals = Array.from({ length: 12 }, () => ({ value: 0, count: 0 }));
  const dates = Array.isArray(daily.time) ? daily.time : [];
  const radiation = Array.isArray(daily.shortwave_radiation_sum) ? daily.shortwave_radiation_sum : [];
  dates.forEach((date, index) => {
    const month = Number(String(date).slice(5, 7)) - 1;
    const value = Number(radiation[index]);
    if (month < 0 || month > 11 || !Number.isFinite(value)) return;
    // The Open-Meteo daily archive exposes shortwave radiation in MJ/m².
    totals[month].value += value / 3.6;
    totals[month].count += 1;
  });
  if (totals.some((month) => !month.count)) throw new Error("неповні дані про сонячне випромінювання");
  return totals.map((month) => Number(month.value.toFixed(1)));
}

function dailyGenerationFromArchive(daily = {}, config) {
  const normalized = normalizeSolarCalculator(config);
  const orientationFactor = solarOrientationFactor(normalized.tilt, normalized.azimuth);
  const performanceRatio = 1 - normalized.systemLoss / 100;
  const dates = Array.isArray(daily.time) ? daily.time : [];
  const radiation = Array.isArray(daily.shortwave_radiation_sum) ? daily.shortwave_radiation_sum : [];
  return dates.map((date, index) => {
    const irradiation = Number(radiation[index]);
    if (!Number.isFinite(irradiation)) return null;
    return {
      date,
      generation: Number(((irradiation / 3.6) * normalized.capacityKw * orientationFactor * performanceRatio).toFixed(1)),
    };
  }).filter(Boolean);
}

async function geocodeSolarLocation(location) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: location, count: "1", language: "uk", format: "json" }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error("не вдалося знайти локацію");
  const payload = await response.json();
  const place = payload?.results?.[0];
  if (!place || !Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) {
    throw new Error("локацію не знайдено");
  }
  return {
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    location: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
  };
}

async function fetchSolarArchive(config) {
  const endYear = new Date().getFullYear() - 1;
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.search = new URLSearchParams({
    latitude: String(config.latitude),
    longitude: String(config.longitude),
    start_date: `${endYear}-01-01`,
    end_date: `${endYear}-12-31`,
    daily: "shortwave_radiation_sum",
    timezone: "auto",
  }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error("архів погоди тимчасово недоступний");
  const payload = await response.json();
  return {
    irradiation: monthlyIrradiationFromArchive(payload.daily),
    dailyGeneration: dailyGenerationFromArchive(payload.daily, config),
    source: `Історичні дані Open‑Meteo за ${endYear} рік`,
  };
}

async function calculateSolarEstimate(formElement) {
  const data = new FormData(formElement);
  const project = clientProject();
  const projectPower = project ? Number(totalPower(project) || solarCalculatorDefaults.capacityKw) : solarCalculatorDefaults.capacityKw;
  solarCalculator = normalizeSolarCalculator({
    ...solarCalculator,
    location: data.get("location"),
    locationSource: data.get("locationSource"),
    latitude: data.get("latitude") || solarCalculator.latitude,
    longitude: data.get("longitude") || solarCalculator.longitude,
    capacityKw: data.get("capacityKw") || projectPower,
    tilt: data.get("tilt"),
    azimuth: data.get("azimuth"),
    systemLoss: data.get("systemLoss"),
    monthlyConsumption: data.get("monthlyConsumption"),
    tariff: data.get("tariff"),
  });
  writeLocalStorage("solarObjectManager.solarCalculator", JSON.stringify(solarCalculator));
  solarEstimateMessage = "Шукаємо локацію та завантажуємо дані про сонце…";
  renderClientStatistics();

  try {
    if (solarCalculator.locationSource !== "device") {
      const place = await geocodeSolarLocation(solarCalculator.location);
      solarCalculator = normalizeSolarCalculator({ ...solarCalculator, ...place, locationSource: "city" });
    }
    const archive = await fetchSolarArchive(solarCalculator);
    solarEstimate = buildSolarEstimate(solarCalculator, archive.irradiation, archive.source, archive.dailyGeneration);
    solarEstimateMessage = `Розрахунок оновлено для: ${solarCalculator.location}.`;
  } catch (error) {
    solarEstimate = fallbackSolarEstimate(solarCalculator);
    solarEstimateMessage = `Не вдалося отримати архів погоди: ${error.message}. Показано орієнтовний профіль для України.`;
  }

  writeLocalStorage("solarObjectManager.solarCalculator", JSON.stringify(solarCalculator));
  writeLocalStorage("solarObjectManager.solarEstimate", JSON.stringify(solarEstimate));
  renderHome();
  renderClientStatistics();
}

function useDeviceSolarLocation() {
  if (!navigator.geolocation) {
    solarEstimateMessage = "Цей браузер не підтримує геолокацію. Вкажіть місто вручну.";
    renderHome();
    return;
  }

  solarEstimateMessage = "Запитуємо доступ до геолокації телефону…";
  renderHome();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const form = document.querySelector("#solarCalculatorForm");
      if (!form) return;
      const latitude = Number(position.coords.latitude.toFixed(5));
      const longitude = Number(position.coords.longitude.toFixed(5));
      form.elements.latitude.value = latitude;
      form.elements.longitude.value = longitude;
      form.elements.locationSource.value = "device";
      form.elements.location.value = `Геолокація телефону (${latitude}, ${longitude})`;
      calculateSolarEstimate(form);
    },
    () => {
      solarEstimateMessage = "Не вдалося отримати геолокацію. Дозвольте доступ у браузері або вкажіть місто вручну.";
      renderHome();
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 },
  );
}

function clientGeneration(project = clientProject()) {
  if (!solarEstimate?.calculatedAt || !Array.isArray(solarEstimate.monthly)) return null;
  const now = new Date();
  const currentMonth = solarEstimate.monthly[now.getMonth()];
  if (!currentMonth || !Number.isFinite(Number(currentMonth.generation))) return null;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dailyAverage = Math.max(0, Number(currentMonth.generation)) / days;
  const dailySavings = Math.max(0, Number(currentMonth.savings || 0)) / days;
  return {
    power: Number(Number(solarEstimate.config?.capacityKw ?? (project ? totalPower(project) : 0)).toFixed(1)),
    forecast: Number(dailyAverage.toFixed(1)),
    today: Number(dailyAverage.toFixed(1)),
    savings: Number(dailySavings.toFixed(2)),
    co2: null,
  };
}

function renderDailyGenerationChart(estimate) {
  const monthIndex = new Date().getMonth();
  const daily = (estimate.dailyGeneration || []).filter((item) => Number(String(item.date).slice(5, 7)) - 1 === monthIndex);
  const values = daily.length ? daily : fallbackSolarEstimate(estimate.config).dailyGeneration;
  const maxValue = Math.max(...values.map((item) => Number(item.generation || 0)), 1);
  const width = 680;
  const height = 180;
  const left = 18;
  const baseline = 140;
  const usableWidth = width - left * 2;
  const usableHeight = 112;
  const path = values.map((item, index) => {
    const x = left + (values.length > 1 ? (index / (values.length - 1)) * usableWidth : usableWidth / 2);
    const y = baseline - (Number(item.generation || 0) / maxValue) * usableHeight;
    return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const areaPath = `${path} L ${left + usableWidth} ${baseline} L ${left} ${baseline} Z`;
  const labels = [0, Math.floor((values.length - 1) / 3), Math.floor((values.length - 1) * 2 / 3), values.length - 1]
    .filter((value, index, array) => array.indexOf(value) === index)
    .map((index) => `<span style="left:${left + (values.length > 1 ? (index / (values.length - 1)) * usableWidth : usableWidth / 2)}px">${Number(String(values[index].date).slice(-2))}</span>`)
    .join("");
  const monthName = new Date(2025, monthIndex, 1).toLocaleDateString("uk-UA", { month: "long" });
  return `
    <article class="daily-generation-card">
      <div class="panel-heading"><div><span class="eyebrow">Щоденний графік</span><h3>Генерація за ${monthName}</h3></div><span class="chip">кВт·год</span></div>
      <div class="daily-generation-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Щоденна генерація за ${monthName}"><defs><linearGradient id="dailyGenerationGlow" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#ffd21a" stop-opacity=".32"/><stop offset="1" stop-color="#ffd21a" stop-opacity="0"/></linearGradient></defs><path d="M${left} ${baseline} H${width - left}" class="chart-baseline"/><path d="${areaPath}" class="daily-generation-area"/><path d="${path}" class="daily-generation-line"/></svg><div class="daily-chart-labels">${labels}</div></div>
      <p>Показано орієнтовну генерацію за кожен день аналогічного місяця з історичних даних про сонячне випромінювання.</p>
    </article>
  `;
}

function renderSolarCalculatorPanel(project) {
  const projectPower = project ? Number(totalPower(project) || solarCalculatorDefaults.capacityKw) : solarCalculatorDefaults.capacityKw;
  const calculator = normalizeSolarCalculator({ ...solarCalculator, capacityKw: solarCalculator.capacityKw || projectPower });
  const estimate = solarEstimate?.calculatedAt && Array.isArray(solarEstimate.monthly) && Number.isFinite(Number(solarEstimate.annualGeneration)) ? solarEstimate : null;
  return `
    <section class="client-section solar-home-section">
      <div class="section-title-row"><div><span>Розрахунок станції</span><h2>Генерація та економія</h2></div><span class="client-status-chip">12 місяців</span></div>
      <article class="solar-calculator-card">
        <p class="solar-calculator-intro">Прив’яжіть майбутню станцію до місця або введіть місто, потужність і споживання. Натисніть «Розрахувати на рік», щоб отримати орієнтовну генерацію та економію.</p>
        <form id="solarCalculatorForm" class="solar-calculator-form">
          <input type="hidden" name="latitude" value="${calculator.latitude}" />
          <input type="hidden" name="longitude" value="${calculator.longitude}" />
          <input type="hidden" name="locationSource" value="${calculator.locationSource}" />
          <div class="solar-location-row"><label class="solar-location-field">Локація / місто<input name="location" value="${escapeAttribute(calculator.location)}" placeholder="Наприклад, Чернівці" required /></label><button class="secondary-button solar-location-button" id="solarUseLocationButton" type="button">⌖ Моя геолокація</button></div>
          <div class="solar-input-grid">
            <label>Потужність, кВт<input name="capacityKw" type="number" value="${calculator.capacityKw}" min="0.2" max="500" step="0.1" required /></label>
            <label>Нахил даху, °<input name="tilt" type="number" value="${calculator.tilt}" min="0" max="90" step="1" required /></label>
            <label>Орієнтація<select name="azimuth"><option value="0" ${calculator.azimuth === 0 ? "selected" : ""}>Південь</option><option value="-45" ${calculator.azimuth === -45 ? "selected" : ""}>Південний схід</option><option value="45" ${calculator.azimuth === 45 ? "selected" : ""}>Південний захід</option><option value="-90" ${calculator.azimuth === -90 ? "selected" : ""}>Схід</option><option value="90" ${calculator.azimuth === 90 ? "selected" : ""}>Захід</option></select></label>
            <label>Втрати системи, %<input name="systemLoss" type="number" value="${calculator.systemLoss}" min="0" max="45" step="1" required /></label>
            <label>Споживання, кВт·год/міс<input name="monthlyConsumption" type="number" value="${calculator.monthlyConsumption}" min="0" max="100000" step="1" required /></label>
            <label>Тариф, грн/кВт·год<input name="tariff" type="number" value="${calculator.tariff}" min="0" max="100" step="0.01" required /></label>
          </div>
          <button class="primary-button solar-calculate-button" type="submit">Розрахувати на рік</button>
        </form>
        ${solarEstimateMessage ? `<p class="solar-calculator-message">${escapeAttribute(solarEstimateMessage)}</p>` : ""}
        ${estimate ? `
        <div class="solar-estimate-summary"><div><span>За рік виробить</span><strong>${Math.round(estimate.annualGeneration).toLocaleString("uk-UA")} кВт·год</strong></div><div><span>Економія за рік</span><strong>${money(estimate.annualSavings, "UAH")}</strong></div><div><span>Надлишок</span><strong>${Math.round(estimate.annualSurplus).toLocaleString("uk-UA")} кВт·год</strong></div></div>
        ${Array.isArray(estimate.dailyGeneration) && estimate.dailyGeneration.some((day) => Number(String(day.date).slice(5, 7)) - 1 === new Date().getMonth()) && !/^Орієнтовний профіль/i.test(estimate.source || "") ? renderDailyGenerationChart(estimate) : `<p class="solar-data-source">Щоденних даних про випромінювання немає. Нижче наведено лише помісячний прогноз.</p>`}
        <p class="solar-data-source">${escapeAttribute(estimate.source)} · Результат орієнтовний: він не замінює проєктування, замір даху та розрахунок затінення.</p>
        <div class="solar-table-wrap"><table class="solar-estimate-table"><thead><tr><th>Місяць</th><th>Генерація</th><th>Власне споживання</th><th>Економія</th></tr></thead><tbody>${estimate.monthly.map((item) => `<tr><td>${escapeAttribute(item.month)}</td><td>${Math.round(item.generation).toLocaleString("uk-UA")} кВт·год</td><td>${Math.round(item.selfConsumption).toLocaleString("uk-UA")} кВт·год</td><td>${money(item.savings, "UAH")}</td></tr>`).join("")}</tbody><tfoot><tr><th>Разом</th><th>${Math.round(estimate.annualGeneration).toLocaleString("uk-UA")} кВт·год</th><th>${Math.round(estimate.annualSelfConsumption).toLocaleString("uk-UA")} кВт·год</th><th>${money(estimate.annualSavings, "UAH")}</th></tr></tfoot></table></div>
        ` : `<div class="empty-state"><strong>Розрахунок ще не виконано</strong><span>Після внесення параметрів тут з’являться прогноз генерації, економія та таблиця за місяцями.</span></div>`}
      </article>
    </section>
  `;
}

function renderClientHome() {
  if (!homeView) return;
  const project = clientProject();
  const generation = clientGeneration(project);
  const progress = project ? statusProgress(project) : 0;
  const status = project ? statusLabels[project.status] || "Не вказано" : "";
  const month = new Date().toLocaleDateString("uk-UA", { month: "long" });
  homeView.innerHTML = `
    <section class="client-generation-hero">
      <div class="client-live-label">${generation ? "Збережений розрахунок станції" : "Ваша сонячна станція"}</div>
      ${generation ? `
        <p>Середній день · ${escapeAttribute(month)}</p>
        <div class="client-generation-value">${generation.forecast}<span>кВт·год</span></div>
        <span class="client-savings">Орієнтовна економія: ${money(generation.savings, "UAH")} / день</span>
        <small>${escapeAttribute(solarEstimate.config?.location || "Обрана локація")} · ${generation.power} кВт</small>
        <p class="calculation-note">Прогноз за збереженим розрахунком, а не фактичні показники інвертора.</p>
      ` : `
        <h2>Розрахуйте майбутню станцію</h2>
        <p>Вкажіть локацію, потужність і споживання в калькуляторі нижче. Генерація та економія з’являться після розрахунку.</p>
      `}
    </section>
    ${renderSolarCalculatorPanel(project)}
    ${project ? `
      <section class="client-section">
        <div class="section-title-row"><div><span>Моя станція</span><h2>${escapeAttribute(project.title)}</h2></div><span class="client-status-chip">${escapeAttribute(status)}</span></div>
        <article class="client-progress-card">
          <div><span>Хід реалізації</span><strong>${progress}%</strong></div>
          <div class="progress-line"><span style="width:${progress}%"></span></div>
          <p>${project.installationDate ? `Запланований виїзд: ${escapeAttribute(project.installationDate)}` : "Дата наступного виїзду ще не призначена."}</p>
        </article>
      </section>
      <section class="client-section">
        <div class="section-title-row"><div><span>Виконання</span><h2>Хід монтажу</h2></div><span class="text-action">${progress}%</span></div>
        <article class="client-installation-card">
          ${[["Замір і проєкт", 20], ["Обладнання підготовлено", 48], ["Монтаж на об’єкті", 72], ["Запуск і паспорт", 100]].map(([label, point]) => `<div class="client-installation-step ${progress >= point ? "done" : progress >= point - 20 ? "current" : ""}"><i>${progress >= point ? "✓" : ""}</i><span>${label}</span>${progress >= point - 20 && progress < point ? "<small>У роботі</small>" : ""}</div>`).join("")}
        </article>
      </section>
    ` : `
      <section class="client-section"><article class="client-info-card"><h2>Об’єкт ще не додано</h2><p>Інформація про станцію, дату виїзду, монтаж і документи з’явиться після створення об’єкта.</p></article></section>
    `}
    <section class="client-section client-action-grid">
      <button class="client-action-card quick-action" data-section="warehouse"><span>▦</span><strong>Магазин</strong><small>обладнання та рішення</small></button>
      <button class="client-action-card quick-action" data-section="crm"><span>⌕</span><strong>Сервіс</strong><small>заявки й підтримка</small></button>
    </section>
    <section class="client-section"><article class="client-info-card"><h3>Фактичний моніторинг</h3><p>Показники генерації, заряду АКБ та події обладнання з’являться після підключення моніторингу станції.</p></article></section>
  `;
}

function renderClientStatistics() {
  // The customer mode keeps generation, the calculator and its charts on the
  // home screen. The installer object list remains available in installer mode.
  projectList.innerHTML = "";
  return;

  const project = clientProject();
  const generation = clientGeneration(project);
  const projectPower = project ? Number(totalPower(project) || solarCalculatorDefaults.capacityKw) : solarCalculatorDefaults.capacityKw;
  const calculator = normalizeSolarCalculator({ ...solarCalculator, capacityKw: solarCalculator.capacityKw || projectPower });
  const estimate = solarEstimate || fallbackSolarEstimate(calculator);
  const week = [42, 58, 34, 76, 84, 63, 49];
  const technical = project?.technical || {};
  const inverter = formatFilledCombined(technical.inverterManufacturer, technical.inverterModel) || "Дані інвертора будуть додані";
  const panels = technical.panelCount ? `${escapeAttribute(technical.panelCount)} шт × ${escapeAttribute(technical.panelPowerW || "—")} Вт` : "Дані панелей будуть додані";
  projectList.innerHTML = `
    <section class="client-stats-panel">
      <div class="section-title-row"><div><span>Статистика</span><h2>Енергія станції</h2></div><span class="client-status-chip">демо</span></div>
      <div class="client-stat-cards">
        <article><span>Сьогодні</span><strong>${generation.today} кВт·год</strong><small>≈ ${generation.savings} грн</small></article>
        <article><span>За місяць</span><strong>${Math.round(generation.forecast * 22)} кВт·год</strong><small>прогноз за погодою</small></article>
        <article><span>Зекономлено CO₂</span><strong>${Math.round(generation.co2 * 30)} кг</strong><small>цього місяця</small></article>
      </div>
      <article class="solar-calculator-card">
        <div class="panel-heading"><div><span class="eyebrow">Майбутня станція</span><h3>Прогноз генерації та економії</h3></div><span class="chip">12 місяців</span></div>
        <p class="solar-calculator-intro">Вкажіть адресу та потужність — отримаєте орієнтовний помісячний розрахунок для клієнта.</p>
        <form id="solarCalculatorForm" class="solar-calculator-form">
          <label class="solar-location-field">Локація / місто<input name="location" value="${escapeAttribute(calculator.location)}" placeholder="Наприклад, Чернівці" required /></label>
          <div class="solar-input-grid">
            <label>Потужність, кВт<input name="capacityKw" type="number" value="${calculator.capacityKw}" min="0.2" max="500" step="0.1" required /></label>
            <label>Нахил даху, °<input name="tilt" type="number" value="${calculator.tilt}" min="0" max="90" step="1" required /></label>
            <label>Орієнтація<select name="azimuth"><option value="0" ${calculator.azimuth === 0 ? "selected" : ""}>Південь</option><option value="-45" ${calculator.azimuth === -45 ? "selected" : ""}>Південний схід</option><option value="45" ${calculator.azimuth === 45 ? "selected" : ""}>Південний захід</option><option value="-90" ${calculator.azimuth === -90 ? "selected" : ""}>Схід</option><option value="90" ${calculator.azimuth === 90 ? "selected" : ""}>Захід</option></select></label>
            <label>Втрати системи, %<input name="systemLoss" type="number" value="${calculator.systemLoss}" min="0" max="45" step="1" required /></label>
            <label>Споживання, кВт·год/міс<input name="monthlyConsumption" type="number" value="${calculator.monthlyConsumption}" min="0" max="100000" step="1" required /></label>
            <label>Тариф, грн/кВт·год<input name="tariff" type="number" value="${calculator.tariff}" min="0" max="100" step="0.01" required /></label>
          </div>
          <button class="primary-button solar-calculate-button" type="submit">Розрахувати на рік</button>
        </form>
        ${solarEstimateMessage ? `<p class="solar-calculator-message">${escapeAttribute(solarEstimateMessage)}</p>` : ""}
        <div class="solar-estimate-summary">
          <div><span>За рік виробить</span><strong>${Math.round(estimate.annualGeneration).toLocaleString("uk-UA")} кВт·год</strong></div>
          <div><span>Економія за рік</span><strong>${money(estimate.annualSavings, "UAH")}</strong></div>
          <div><span>Надлишок</span><strong>${Math.round(estimate.annualSurplus).toLocaleString("uk-UA")} кВт·год</strong></div>
        </div>
        <p class="solar-data-source">${escapeAttribute(estimate.source)} · Результат орієнтовний: він не замінює проєктування, замір даху та розрахунок затінення.</p>
        <div class="solar-table-wrap"><table class="solar-estimate-table"><thead><tr><th>Місяць</th><th>Генерація</th><th>Власне споживання</th><th>Економія</th></tr></thead><tbody>${estimate.monthly.map((item) => `<tr><td>${escapeAttribute(item.month)}</td><td>${Math.round(item.generation).toLocaleString("uk-UA")} кВт·год</td><td>${Math.round(item.selfConsumption).toLocaleString("uk-UA")} кВт·год</td><td>${money(item.savings, "UAH")}</td></tr>`).join("")}</tbody><tfoot><tr><th>Разом</th><th>${Math.round(estimate.annualGeneration).toLocaleString("uk-UA")} кВт·год</th><th>${Math.round(estimate.annualSelfConsumption).toLocaleString("uk-UA")} кВт·год</th><th>${money(estimate.annualSavings, "UAH")}</th></tr></tfoot></table></div>
      </article>
      <article class="client-chart-card">
        <div class="panel-heading"><div><span class="eyebrow">Генерація за тиждень</span><h3>Виробіток, кВт·год</h3></div><span class="chip">Прогноз</span></div>
        <div class="week-bars">${week.map((value, index) => `<div><i style="height:${value}%"></i><span>${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"][index]}</span></div>`).join("")}</div>
      </article>
      <article class="client-info-card">
        <h3>Обладнання станції</h3>
        <div class="client-info-rows">
          <div><span>Потужність</span><strong>${generation.power} кВт</strong></div>
          <div><span>Інвертор</span><strong>${escapeAttribute(inverter)}</strong></div>
          <div><span>Фотомодулі</span><strong>${panels}</strong></div>
          <div><span>Статус</span><strong>${project ? statusLabels[project.status] : "Підготовка"}</strong></div>
        </div>
      </article>
    </section>
  `;
}

function renderClientShop() {
  if (!warehouseView) return;
  const core = window.SpartaWarehouseCore;
  const items = warehouseItems.filter((item) => core ? core.isStockItem(item) : !["Роботи", "Витрати", "Послуги"].includes(item.category));
  const reservations = window.SPARTA_LOCAL_WORKSPACE?.enabled ? readJsonStorage("solarObjectManager.warehouseWorkspace.v31", {})?.reservations || [] : [];
  const categories = [...new Set(items.map((item) => item.category || "Інше"))];
  warehouseView.innerHTML = `
    <section class="client-shop-panel">
      <div class="client-shop-hero"><span>Каталог обладнання</span><h2>Для вашої сонячної системи</h2><p>Тут відображається обладнання з каталогу компанії. Комплектацію та умови придбання погоджуйте з менеджером.</p></div>
      ${items.length ? `
        <div class="section-title-row"><div><span>Магазин</span><h2>Категорії</h2></div></div>
        <div class="client-category-grid">${categories.map((category) => `<article><span>▦</span><strong>${escapeAttribute(category)}</strong><small>${items.filter((item) => (item.category || "Інше") === category).length} поз.</small></article>`).join("")}</div>
        <div class="section-title-row"><div><span>Обладнання</span><h2>Каталог компанії</h2></div></div>
        <div class="client-category-grid">${items.map((item) => {
          const available = core ? core.availableQty(item, reservations) : Number(item.qty || 0);
          const price = Number(item.retailPrice ?? item.salePrice ?? 0);
          return `<article><span>▦</span><strong>${escapeAttribute(item.name)}</strong><small>${escapeAttribute([item.sku, item.brand, item.model].filter(Boolean).join(" · "))}</small><small>${available > 0 ? "Є в наявності" : "Наявність уточнюється"}</small><strong>${price > 0 ? money(price, item.currency || "UAH") : "Ціна не вказана"}</strong></article>`;
        }).join("")}</div>
      ` : `
        <article class="client-info-card"><h2>Каталог ще не заповнений</h2><p>Обладнання та ціни з’являться після внесення номенклатури компанії.</p></article>
      `}
    </section>
  `;
}

function renderClientMenu() {
  const project = clientProject();
  profileView.innerHTML = `
    <section class="client-menu-panel">
      <article class="client-account-card"><span class="client-avatar">☀</span><div><strong>${escapeAttribute(cloudState.user?.email || "Гість")}</strong><small>${cloudState.user ? "Особистий кабінет" : "Увійдіть, щоб зберігати об'єкти та звернення"}</small></div></article>
      <div class="client-menu-list">
        <button class="quick-action" data-section="home"><span>⌂</span><div><strong>Головна</strong><small>Стан і прогноз генерації</small></div><em>›</em></button>
        <button class="quick-action" data-section="warehouse"><span>▦</span><div><strong>Магазин</strong><small>Комплекти й обладнання</small></div><em>›</em></button>
        <button class="quick-action" data-section="crm"><span>⌕</span><div><strong>Сервіс</strong><small>Підтримка та історія заявок</small></div><em>›</em></button>
      </div>
      <article class="client-object-mini"><span>Моя станція</span><strong>${escapeAttribute(project?.title || "Об'єкт ще не додано")}</strong><small>${escapeAttribute(project?.address || "Після оформлення заявки він з’явиться тут.")}</small></article>
    </section>
  `;
}

function renderHome() {
  if (!homeView) return;
  if (portalMode === "client") {
    renderClientHome();
    return;
  }
  const preparation = projects.filter((project) => ["new", "planned", "proposal", "contract"].includes(project.status)).length;
  const mounting = projects.filter((project) => ["in_progress", "waiting_review"].includes(project.status)).length;
  const activeCount = projects.filter((project) => !isClosedProjectStatus(project.status)).length;
  const financeByCurrency = ["USD", "UAH"].map((currency) => {
    const financeTotals = projects.filter((project) => (project.currency || "UAH") === currency).reduce((result, project) => {
    const totals = projectFinanceTotals(project);
    result.revenue += totals.revenue;
    result.profit += totals.profit;
    result.balanceDue += totals.balanceDue;
    return result;
  }, { revenue: 0, profit: 0, balanceDue: 0 });
    return { currency, ...financeTotals };
  });
  const activeProjects = projects
    .filter((project) => !isClosedProjectStatus(project.status))
    .slice(0, 4);

  homeView.innerHTML = `
    <section class="overview-hero">
      <div class="overview-hero-top">
        <img class="brand-logo big" src="./assets/sparta-logo.jpeg" alt="SPARTA power" />
        <div>
          <span class="live-chip"><i></i> Робочий день</span>
          <h2>Монтажі під контролем</h2>
          <p>Об’єкти, матеріали й фото — в одній стрічці.</p>
        </div>
      </div>
      <div class="overview-hero-bottom">
        <span>В активній роботі</span>
        <strong>${activeCount} <small>об'єкт${activeCount === 1 ? "" : "и"}</small></strong>
        <div class="progress-line"><span style="width: ${projects.length ? Math.min(100, (activeCount / projects.length) * 100) : 0}%"></span></div>
      </div>
    </section>

    <section class="overview-section overview-stats">
      <div class="section-title-row">
        <div><span>Сьогодні</span><h2>Коротко про роботу</h2></div>
      </div>
      <div class="metric-rail" aria-label="Статистика об'єктів">
        <article class="metric-card"><span>У підготовці</span><strong>${preparation}</strong><small>виїзди та КП</small></article>
        <article class="metric-card warning"><span>На монтажі</span><strong>${mounting}</strong><small>об'єкти бригад</small></article>
        <article class="metric-card"><span>Потужність</span><strong>${projects.reduce((sum, project) => sum + Number(totalPower(project)), 0).toFixed(1)}</strong><small>кВт у базі</small></article>
        ${canManageProjectFinance() ? `<article class="metric-card success"><span>Прибуток / прогноз</span><strong>${financeByCurrency.filter((entry) => entry.currency === "USD" || projects.some((p) => (p.currency || "UAH") === entry.currency)).map((entry) => money(entry.profit, entry.currency)).join("<br>")}</strong><small>за кошторисами проєктів, не залишок каси</small></article>` : ""}
      </div>
    </section>

    <section class="overview-section overview-projects">
      <div class="section-title-row">
        <div><span>Робочий список</span><h2>Об'єкти у роботі</h2></div>
        <button class="text-action quick-action" data-section="projects">Усі</button>
      </div>
      <div class="home-object-list scroll-list">
        ${activeProjects.length
          ? activeProjects.map((project) => `
            <button class="home-object-card timeline-card status-${escapeAttribute(project.status)}" data-project-id="${escapeAttribute(project.id)}">
              <div class="timeline-card-main">
                <span class="timeline-dot ${statusTone(project.status)}"></span>
                <div>
                  <strong>${escapeAttribute(project.title)}</strong>
                  <span>${escapeAttribute(project.address || "Адресу ще не вказано")}</span>
                </div>
              </div>
              <div class="timeline-card-meta">
                <em>${statusLabels[project.status]}</em>
                <span>${totalPower(project)} кВт · ${statusProgress(project)}%</span>
              </div>
            </button>
          `).join("")
          : `<div class="empty-state"><strong>Немає активних об'єктів</strong><span>Новий об'єкт можна додати кнопкою зверху.</span></div>`}
      </div>
    </section>

    <section class="overview-section">
      <article class="work-summary-card">
        <span class="work-summary-icon">▦</span>
        <div><strong>Склад і рух матеріалів</strong><p>Усі переміщення та залишки доступні у вкладці «Склад».</p></div>
        <button class="text-action quick-action" data-section="warehouse">Відкрити</button>
      </article>
    </section>
  `;
}

function renderMapView() {
  if (!mapView) return;
  mapView.innerHTML = `
    <section class="map-panel">
      <div class="map-head">
        <h2>Карта об'єктів</h2>
        <span class="chip">Чернівці та область</span>
      </div>
      <div class="map-canvas">
        ${projects.slice(0, 5).map((project, index) => `
          <button class="map-pin ${statusTone(project.status)}" style="left: ${18 + index * 16}%; top: ${24 + (index % 3) * 20}%;" data-project-id="${escapeAttribute(project.id)}">${index + 1}</button>
        `).join("")}
        <span class="map-city">Чернівці</span>
        <span class="map-road one"></span>
        <span class="map-road two"></span>
      </div>
      <div class="legend-list">
        <span><i class="dot success"></i>Паспорт / сервіс</span>
        <span><i class="dot warning"></i>Підготовка</span>
        <span><i class="dot work"></i>Монтаж</span>
        <span><i class="dot blue"></i>Перевірка</span>
      </div>
    </section>
  `;
}

function renderWarehouseView() {
  if (!warehouseView) return;
  if (portalMode === "client") {
    renderClientShop();
    return;
  }
  if (window.SpartaWarehouseUI) {
    window.SpartaWarehouseUI.render(warehouseView);
    return;
  }
  const totals = warehouseTotals();
  const formState = warehouseItemFormState();
  const movementDefaultItem = warehouseItems[0] || {};
  const movementDefaultPrice = Number(movementDefaultItem.installerPrice || movementDefaultItem.salePrice || 0);
  const activeProjects = projects;
  warehouseView.innerHTML = `
    <section class="warehouse-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Склад</p>
          <h2>Матеріали, обладнання та інструменти</h2>
          ${window.SPARTA_LOCAL_WORKSPACE?.enabled ? `<button type="button" class="secondary-button" data-warehouse-layout="new">Спробувати новий склад</button>` : ""}
        </div>
        <span class="chip">${warehouseItems.length} позицій</span>
      </div>

      <div class="metric-grid compact">
        <div class="metric-card"><span>Собівартість складу</span><strong>${money(totals.purchaseValue, "USD")}</strong></div>
        <div class="metric-card"><span>Потенційний продаж</span><strong>${money(totals.saleValue, "USD")}</strong></div>
        <div class="metric-card success"><span>Потенційна маржа</span><strong>${money(totals.potentialProfit, "USD")}</strong></div>
        <div class="metric-card warning"><span>Рухів сьогодні</span><strong>${totals.movedToday}</strong></div>
      </div>

      ${renderWarehouseSectionStack(formState)}

      <form class="inline-form warehouse-movement-form" id="warehouseMovementForm">
        <label>Товар
          <select name="itemId" id="warehouseMovementItemSelect">
            ${warehouseItems.map((item) => `<option value="${escapeAttribute(item.id)}">${escapeAttribute(item.name)} / ${escapeAttribute(item.qty)} ${escapeAttribute(item.unit)}</option>`).join("")}
          </select>
        </label>
        <label>Тип руху
          <select name="movementType" id="warehouseMovementTypeSelect">
            <option value="project">Переміщення на об'єкт</option>
            <option value="sale">Прямий продаж клієнту</option>
            <option value="return">Повернення з об'єкта</option>
          </select>
        </label>
        <label class="warehouse-project-target">Об'єкт
          <select name="projectId">
            ${activeProjects.length
              ? activeProjects.map((project) => `<option value="${escapeAttribute(project.id)}">${escapeAttribute(project.title)} / ${statusLabels[project.status] || "Активний"}</option>`).join("")
              : `<option value="">Немає активних об'єктів</option>`}
          </select>
        </label>
        <label class="warehouse-sale-target" hidden>Клієнт<input name="customer" placeholder="Ім'я або телефон клієнта" /></label>
        <label>К-сть<input name="qty" type="number" min="0.01" step="0.01" required /></label>
        <label>Ціна продажу, ${movementDefaultItem.currency || "UAH"}<input name="salePrice" type="number" min="0" step="0.01" value="${escapeAttribute(movementDefaultPrice)}" /></label>
        <label class="wide-field">Коментар<input name="note" placeholder="Накладна, хто забрав, умови..." /></label>
        <div class="form-submit-cell"><button class="primary-button">Провести рух</button></div>
      </form>

      <section class="finance-panel warehouse-history-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Рух товарів</p>
            <h3>Прихід, об'єкти і прямі продажі</h3>
          </div>
          <span class="chip">${warehouseMovements.length} записів</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Дата</th><th>Тип</th><th>Товар</th><th>К-сть</th><th>Куди / від кого</th><th>Собівартість</th><th>Продаж (тільки прямий)</th><th>Примітка</th></tr></thead>
            <tbody>
              ${warehouseMovements.length
                ? warehouseMovements.map((movement) => `
                  <tr>
                    <td>${new Date(movement.createdAt).toLocaleDateString("uk-UA")}</td>
                    <td>${warehouseMovementTypeLabel(movement.type)}</td>
                    <td>${escapeAttribute(movement.itemName)}</td>
                    <td>${escapeAttribute(movement.qty)} ${escapeAttribute(movement.unit)}</td>
                    <td>${escapeAttribute(warehouseMovementTarget(movement))}</td>
                    <td>${money(Number(movement.qty || 0) * Number(movement.unitCost || 0), movement.currency || "UAH")}</td>
                    <td>${movement.type === "sale" ? money(Number(movement.qty || 0) * Number(movement.salePrice || 0), movement.currency || "UAH") : "—"}</td>
                    <td>${escapeAttribute(movement.note || "")}</td>
                  </tr>
                `).join("")
                : `<tr><td colspan="8">Рухів складу ще немає.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function renderWarehouseSectionStack(formState) {
  const editingItem = formState.item || null;
  const activeSection = editingItem ? warehouseSectionForCategory(editingItem.category) : selectedWarehouseSection;
  return `
    <div class="section-stack warehouse-section-stack">
      ${warehouseSections().map((section) => {
        const items = warehouseItemsForSection(section);
        const isOpen = section.id === activeSection;
        return `
          <section class="project-section-card warehouse-section-card ${isOpen ? "active" : ""}" id="warehouse-section-${section.id}">
            <button class="project-section-toggle ${isOpen ? "active" : ""}" type="button" data-warehouse-section="${section.id}">
              <span>${section.title}</span>
              <small>${items.length} поз. · ${isOpen ? "Згорнути" : "Відкрити"}</small>
            </button>
            ${isOpen ? `<div class="project-section-body">${renderWarehouseSectionBody(section, items, formState)}</div>` : ""}
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function renderWarehouseSectionBody(section, items, formState) {
  const filteredItems = warehouseFilteredItems(section, items);
  const filter = warehouseSectionFilter(section.id);
  return `
    ${renderWarehousePickerFilters(section, items, filter)}
    ${renderWarehouseItemForm(section, formState, filteredItems)}
    <div class="warehouse-list-summary">
      <span>${filteredItems.length} з ${items.length} позицій</span>
      <span>Вибери назву зі списку, введи кількість і додай прихід</span>
    </div>
    <div class="table-wrap warehouse-list-wrap">
      <table class="warehouse-picker-table">
        <thead>
          <tr><th>Назва</th><th>Категорія</th><th>Параметр</th><th>Залишок</th><th>Закупка</th><th>Продаж</th><th></th></tr>
        </thead>
        <tbody>
          ${filteredItems.length
            ? filteredItems.map((item) => renderWarehousePickerRow(item, warehouseItems.indexOf(item), section.id)).join("")
            : `<tr><td colspan="7">За цими фільтрами позицій немає.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderWarehousePickerFilters(section, items, filter) {
  const brands = warehouseFilterOptions(items, warehouseItemBrand);
  const powers = warehouseFilterOptions(items, (item) => warehouseItemPowerTags(item, section.id));
  return `
    <div class="warehouse-picker-filters">
      <label>Пошук
        <input data-warehouse-filter="query" data-section-id="${section.id}" value="${escapeAttribute(filter.query || "")}" placeholder="Назва, модель, артикул" />
      </label>
      <label>Підкатегорія
        <select data-warehouse-filter="category" data-section-id="${section.id}">
          <option value="">Усі</option>
          ${section.categories.map((category) => `<option value="${escapeAttribute(category)}" ${filter.category === category ? "selected" : ""}>${category}</option>`).join("")}
        </select>
      </label>
      <label>Марка
        <select data-warehouse-filter="brand" data-section-id="${section.id}" ${brands.length ? "" : "disabled"}>
          <option value="">Усі</option>
          ${brands.map((brand) => `<option value="${escapeAttribute(brand)}" ${filter.brand === brand ? "selected" : ""}>${brand}</option>`).join("")}
        </select>
      </label>
      <label>${section.id === "cables" ? "Переріз / тип" : "Потужність"}
        <select data-warehouse-filter="power" data-section-id="${section.id}" ${powers.length ? "" : "disabled"}>
          <option value="">Усі</option>
          ${powers.map((power) => `<option value="${escapeAttribute(power)}" ${filter.power === power ? "selected" : ""}>${power}</option>`).join("")}
        </select>
      </label>
    </div>
  `;
}

function renderWarehouseItemForm(section, formState, filteredItems = []) {
  const formItem = formState.item || {};
  const filter = warehouseSectionFilter(section.id);
  const visibleCategories = filter.category ? [filter.category] : section.categories;
  const selectedCategory = formItem.category || filter.category || section.defaultCategory;
  const productOptions = formState.isEditing ? warehouseProductsForCategory(selectedCategory) : filteredItems;
  const selectedCatalogItem = formItem.id || productOptions[0]?.id || "__new";
  const selectedItem = warehouseItemById(selectedCatalogItem) || formItem;
  return `
    <form class="warehouse-picker-form" id="warehouseItemForm">
      <label>Напрямок
        <select name="category" id="warehouseCategorySelect">
          ${visibleCategories.map((category) => `<option value="${escapeAttribute(category)}" ${selectedCategory === category ? "selected" : ""}>${category}</option>`).join("")}
          <option value="__new">+ Нова категорія</option>
        </select>
      </label>
      <label class="warehouse-custom-category" hidden>Нова категорія<input name="customCategory" placeholder="Наприклад: Оптимізатори" /></label>
      <label class="warehouse-product-field">Назва зі списку
        <select name="catalogItem" id="warehouseProductSelect">
          ${productOptions.map((item) => `<option value="${escapeAttribute(item.id)}" ${selectedCatalogItem === item.id ? "selected" : ""}>${escapeAttribute(item.name)}</option>`).join("")}
          <option value="__new" ${formState.isEditing || !productOptions.length ? "selected" : ""}>+ Нова позиція</option>
        </select>
      </label>
      <label class="warehouse-custom-product" ${formState.isEditing || !productOptions.length ? "" : "hidden"}>Нова назва<input name="name" placeholder="Назва позиції" value="${escapeAttribute(formItem.name || "")}" /></label>
      <label>К-сть<input name="qty" type="number" min="0" step="0.01" required value="${escapeAttribute(formState.isEditing ? formItem.qty ?? "" : "")}" placeholder="0" /></label>
      <label>Од.<input name="unit" value="${escapeAttribute(selectedItem.unit || formItem.unit || "шт")}" required /></label>
      <label>Закупка<input name="purchasePrice" type="number" min="0" step="0.01" value="${escapeAttribute(selectedItem.purchasePrice ?? formItem.purchasePrice ?? "")}" /></label>
      <label>Роздріб<input name="retailPrice" type="number" min="0" step="1" value="${escapeAttribute(selectedItem.retailPrice ?? selectedItem.salePrice ?? formItem.retailPrice ?? "")}" /></label>
      <details class="warehouse-extra-fields">
        <summary>Додатково</summary>
        <div class="warehouse-extra-grid">
          <label>Артикул<input name="sku" placeholder="SKU" value="${escapeAttribute(selectedItem.sku || formItem.sku || "")}" /></label>
          <label>Доставка / од.<input name="deliveryCost" type="number" min="0" step="1" value="${escapeAttribute(selectedItem.deliveryCost ?? formItem.deliveryCost ?? "")}" /></label>
          <label>Дод. витрати / од.<input name="extraCost" type="number" min="0" step="1" value="${escapeAttribute(selectedItem.extraCost ?? formItem.extraCost ?? "")}" /></label>
          <label>Монтажникам<input name="installerPrice" type="number" min="0" step="0.01" value="${escapeAttribute(selectedItem.installerPrice ?? formItem.installerPrice ?? "")}" /></label>
          <label>Опт<input name="wholesalePrice" type="number" min="0" step="0.01" value="${escapeAttribute(selectedItem.wholesalePrice ?? formItem.wholesalePrice ?? "")}" /></label>
          <label>Мін. залишок<input name="minQty" type="number" min="0" step="0.01" value="${escapeAttribute(selectedItem.minQty ?? formItem.minQty ?? "")}" /></label>
          <label>Місце<input name="location" placeholder="Стелаж, склад, авто" value="${escapeAttribute(selectedItem.location || formItem.location || "")}" /></label>
          <label>Серійний номер<input name="serialNumber" placeholder="SN / партія" value="${escapeAttribute(selectedItem.serialNumber || formItem.serialNumber || "")}" /></label>
          <label>Постачальник<input name="supplier" placeholder="Назва постачальника" value="${escapeAttribute(selectedItem.supplier || formItem.supplier || "")}" /></label>
          <label class="wide-field">Характеристики<input name="characteristics" placeholder="Потужність, тип, колір, розмір..." value="${escapeAttribute(selectedItem.characteristics || formItem.characteristics || "")}" /></label>
        </div>
      </details>
      <div class="form-submit-cell">
        ${formState.isEditing ? `<button class="secondary-button" type="button" data-cancel-warehouse-edit>Скасувати</button>` : ""}
        <button class="primary-button">${formState.isEditing ? "Зберегти" : "Додати кількість"}</button>
      </div>
    </form>
  `;
}

function renderWarehousePickerRow(item, index, sectionId) {
  const tags = warehouseItemPowerTags(item, sectionId);
  const brand = warehouseItemBrand(item);
  const isLow = Number(item.qty || 0) <= Number(item.minQty || 0);
  return `
    <tr class="${isLow ? "warning-row" : ""}">
      <td><b>${escapeAttribute(item.name)}</b>${item.sku ? `<span class="muted-text">${escapeAttribute(item.sku)}</span>` : ""}</td>
      <td>${escapeAttribute(item.category)}</td>
      <td>${escapeAttribute([brand, ...tags].filter(Boolean).join(" / ") || "-")}</td>
      <td>${escapeAttribute(item.qty)} ${escapeAttribute(item.unit)}</td>
      <td>${Number(item.purchasePrice || 0) ? money(item.purchasePrice, item.currency || "UAH") : "-"}</td>
      <td>${Number(item.retailPrice || item.salePrice || 0) ? money(item.retailPrice || item.salePrice, item.currency || "UAH") : "-"}</td>
      <td class="warehouse-actions">
        <button class="table-button" data-pick-warehouse-id="${escapeAttribute(item.id)}">Вибрати</button>
        <button class="table-button" data-edit-warehouse-index="${index}">Ред.</button>
      </td>
    </tr>
  `;
}

function renderWarehouseItemCard(item, index) {
  const isLow = Number(item.qty || 0) <= Number(item.minQty || 0);
  const unitCost = warehouseUnitCost(item);
  return `
    <article class="warehouse-item-card ${isLow ? "warning-row" : ""}">
      <div class="warehouse-card-head">
        <div>
          <p class="eyebrow">${escapeAttribute(item.category)}</p>
          <h3>${escapeAttribute(item.name)}</h3>
          <span class="muted-text">${escapeAttribute(item.sku || "Без артикулу")}</span>
        </div>
        <span class="chip ${isLow ? "amber" : ""}">${escapeAttribute(item.qty)} ${escapeAttribute(item.unit)}</span>
      </div>
      <div class="warehouse-card-specs">
        <span><b>Собівартість</b>${money(unitCost, item.currency || "UAH")}</span>
        <span><b>Закупка</b>${money(item.purchasePrice, item.currency || "UAH")}</span>
        <span><b>Доставка</b>${money(item.deliveryCost, item.currency || "UAH")}</span>
        <span><b>Дод. витрати</b>${money(item.extraCost, item.currency || "UAH")}</span>
        <span><b>Монтажникам</b>${Number(item.installerPrice || 0) ? money(item.installerPrice, item.currency || "UAH") : "-"}</span>
        <span><b>Розниця</b>${Number(item.retailPrice || item.salePrice || 0) ? money(item.retailPrice || item.salePrice, item.currency || "UAH") : "-"}</span>
        <span><b>Серійний</b>${escapeAttribute(item.serialNumber || "-")}</span>
        <span><b>Постачальник</b>${escapeAttribute(item.supplier || "-")}</span>
        <span><b>Місце</b>${escapeAttribute(item.location || "-")}</span>
        <span><b>Мін. залишок</b>${escapeAttribute(item.minQty || 0)} ${escapeAttribute(item.unit)}</span>
      </div>
      ${item.characteristics ? `<p class="warehouse-characteristics">${escapeAttribute(item.characteristics)}</p>` : ""}
      <div class="warehouse-actions">
        <button class="table-button" data-edit-warehouse-index="${index}">Редагувати</button>
        <button class="table-button danger-text" data-delete-warehouse-index="${index}">Видалити</button>
      </div>
    </article>
  `;
}

function crmProjectName(projectId) {
  if (!projectId) return "Без об'єкта";
  return projects.find((project) => normalizeProjectId(project.id) === normalizeProjectId(projectId))?.title || "Об'єкт не знайдено";
}

function canViewAllCrmTasks() {
  return ["owner", "admin", "engineer"].includes(cloudState.memberRole);
}

function canCreateCrmTasks() {
  return ["owner", "admin", "engineer"].includes(cloudState.memberRole);
}

function canManageCrmTask(task) {
  if (canViewAllCrmTasks()) return true;
  const userId = cloudState.user?.id || "";
  return Boolean(userId && ["brigadier", "installer"].includes(cloudState.memberRole) && task.assignedTo === userId);
}

function crmVisibleTasks() {
  if (!cloudState.ready || canViewAllCrmTasks()) return crmTasks;
  const userId = cloudState.user?.id || "";
  if (!userId) return [];
  return crmTasks.filter((task) => task.assignedTo === userId || task.createdBy === userId);
}

function memberDisplayName(userId) {
  if (!userId) return "Не призначено";
  const member = (cloudState.members || []).find((item) => item.user_id === userId);
  const profile = member?.profiles || {};
  return profile.full_name || profile.email || (userId === cloudState.user?.id ? "Я" : "Користувач");
}

function crmDueLabel(dueAt) {
  if (!dueAt) return "Без терміну";
  return new Date(dueAt).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function crmDueDateLabel(dueAt) {
  if (!dueAt) return "Без дати";
  return new Date(dueAt).toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function crmDueTimeLabel(dueAt) {
  if (!dueAt) return "Без часу";
  return new Date(dueAt).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function splitCrmDueAt(dueAt) {
  if (!dueAt) return { date: "", time: "" };
  const [date = "", rawTime = ""] = String(dueAt).split("T");
  const [year = "", month = "", day = ""] = date.split("-");
  return {
    date: year && month && day ? `${day}.${month}.${year}` : "",
    time: rawTime.slice(0, 5),
  };
}

function parseCrmDueDateInput(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(year) ||
    date.getMonth() + 1 !== Number(month) ||
    date.getDate() !== Number(day)
  ) {
    return "";
  }
  return `${year}-${month}-${day}`;
}

function formatCrmDateInput(value) {
  const parsed = parseCrmDueDateInput(value);
  if (!parsed) return "";
  const [year, month, day] = parsed.split("-");
  return `${day}.${month}.${year}`;
}

function combineCrmDueAt(date, time) {
  const dueDate = parseCrmDueDateInput(date);
  const dueTime = String(time || "").trim();
  if (!dueDate || !/^\d{2}:\d{2}$/.test(dueTime)) return "";
  return `${dueDate}T${dueTime}`;
}

function activateCrmDatePicker(input) {
  const current = parseCrmDueDateInput(input.value);
  input.type = "date";
  input.value = current;
  try {
    input.showPicker?.();
  } catch {
  }
}

function activateCrmTimePicker(input) {
  const current = String(input.value || "").trim();
  input.type = "time";
  input.value = /^\d{2}:\d{2}$/.test(current) ? current : "";
  try {
    input.showPicker?.();
  } catch {
  }
}

function restoreCrmPickerInput(input) {
  if (input.dataset.picker === "date") {
    const displayValue = formatCrmDateInput(input.value);
    input.type = "text";
    input.value = displayValue;
  }
  if (input.dataset.picker === "time") {
    const displayValue = /^\d{2}:\d{2}$/.test(input.value) ? input.value : "";
    input.type = "text";
    input.value = displayValue;
  }
}

function setupCrmDuePickerInputs() {
  crmTaskForm?.querySelectorAll("[data-picker]").forEach((input) => {
    input.addEventListener("focus", () => {
      if (input.dataset.picker === "date") activateCrmDatePicker(input);
      if (input.dataset.picker === "time") activateCrmTimePicker(input);
    });
    input.addEventListener("blur", () => restoreCrmPickerInput(input));
  });
}

function isTodayDate(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  return date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
}

function crmDueTone(task) {
  if (task.status === "done") return "done";
  if (!task.dueAt) return "muted";
  const due = new Date(task.dueAt).getTime();
  const now = Date.now();
  if (due < now) return "overdue";
  if (isTodayDate(task.dueAt)) return "today";
  return "planned";
}

function dueCrmTasksCount() {
  const now = Date.now();
  return crmVisibleTasks().filter((task) => {
    if (task.status === "done" || !task.dueAt) return false;
    return new Date(task.dueAt).getTime() <= now;
  }).length;
}

function renderCrmNotification() {
  if (!crmNotificationButton) return;
  const count = dueCrmTasksCount();
  crmNotificationButton.textContent = count > 99 ? "99+" : String(count);
  crmNotificationButton.classList.toggle("is-hidden", count === 0);
  crmNotificationButton.setAttribute("aria-label", `CRM нагадування: ${count}`);
}

function crmFilteredTasks(filter = crmFilter) {
  const tasks = crmVisibleTasks();
  if (filter === "active") return tasks.filter((task) => task.status !== "done");
  if (filter === "today") return tasks.filter((task) => task.status !== "done" && isTodayDate(task.dueAt));
  if (filter === "overdue") return tasks.filter((task) => crmDueTone(task) === "overdue");
  if (filter === "done") return tasks.filter((task) => task.status === "done");
  return tasks;
}

function sortedCrmTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.status === "done" && b.status !== "done") return 1;
    if (a.status !== "done" && b.status === "done") return -1;
    return new Date(a.dueAt || "2999-01-01").getTime() - new Date(b.dueAt || "2999-01-01").getTime();
  });
}

function renderCrmTaskCard(task) {
  const project = projects.find((item) => String(item.id) === String(task.projectId));
  const evidence = (project?.photos || []).filter((photo) => typeof photo !== "string" && photo.crmTaskId === task.id && photo.src);
  return `
    <article class="crm-card crm-${crmDueTone(task)}">
      <div class="crm-visual">
        <span>${task.status === "done" ? "✓" : task.type === "call" ? "☎" : task.type === "note" ? "✎" : task.type === "materials" ? "▣" : "☑"}</span>
        <small>${crmTypeLabels[task.type] || "Задача"}</small>
      </div>
      <div class="crm-card-main">
        <div class="object-line">
          <div>
            <h3>${escapeAttribute(task.title)}</h3>
            <p>${escapeAttribute(task.note || "Нотатку ще не додано.")}</p>
          </div>
          <span class="chip ${task.status === "done" ? "green" : task.status === "in_progress" ? "amber" : ""}">${crmStatusLabels[task.status] || "Заплановано"}</span>
        </div>
        <div class="crm-meta">
          <div><span>Об'єкт</span><strong>${escapeAttribute(crmProjectName(task.projectId))}</strong></div>
          <div><span>Дата</span><strong>${crmDueDateLabel(task.dueAt)}</strong></div>
          <div><span>Час</span><strong>${crmDueTimeLabel(task.dueAt)}</strong></div>
          <div><span>Виконавець</span><strong>${escapeAttribute(memberDisplayName(task.assignedTo))}</strong></div>
          <div><span>Пріоритет</span><strong>${crmPriorityLabels[task.priority] || "Звичайний"}</strong></div>
        </div>
        <div class="crm-actions">
          ${task.status !== "done" && canManageCrmTask(task) ? `<button class="secondary-button compact-button" data-crm-done="${escapeAttribute(task.id)}">Готово</button>` : ""}
          ${canManageCrmTask(task) ? `<button class="secondary-button compact-button" data-crm-edit="${escapeAttribute(task.id)}">Редагувати</button>` : ""}
          ${canCreateCrmTasks() ? `<button class="danger-button compact-button" data-crm-delete="${escapeAttribute(task.id)}">Видалити</button>` : ""}
          ${project && canManageCrmTask(task) ? `<label class="secondary-button compact-button">Фото виконання<input type="file" accept="image/*" capture="environment" data-crm-task-photo="${escapeAttribute(task.id)}" style="display:none" /></label>` : ""}
        </div>
        ${evidence.length ? `<div class="serial-photo-preview">${evidence.map((photo) => `<figure><img src="${escapeAttribute(photo.src)}" alt="${escapeAttribute(photo.caption || "Фото виконання")}" /><figcaption>${escapeAttribute(photo.caption || photo.category || "Фото виконання")}</figcaption></figure>`).join("")}</div>` : ""}
      </div>
    </article>
  `;
}

function renderCrmView() {
  if (!crmView) return;
  if (portalMode === "client") {
    renderClientService(crmView);
    return;
  }
  const tasks = crmVisibleTasks();
  const activeTasks = tasks.filter((task) => task.status !== "done");
  const overdueTasks = tasks.filter((task) => crmDueTone(task) === "overdue");
  const todayTasks = tasks.filter((task) => task.status !== "done" && isTodayDate(task.dueAt));
  const visibleTasks = sortedCrmTasks(crmFilteredTasks());
  const filterLabels = {
    all: "Усі задачі",
    active: "Активні задачі",
    today: "Задачі на сьогодні",
    overdue: "Прострочені задачі",
    done: "Виконані задачі",
  };

  crmView.innerHTML = `
    <section class="crm-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">CRM</p>
          <h2>Задачі, записи і нагадування</h2>
        </div>
        ${canCreateCrmTasks() ? `<button class="primary-button" id="newCrmTaskButton">+ Задача</button>` : ""}
      </div>
      <div class="metric-grid compact">
        <button class="metric-card crm-filter-card ${crmFilter === "active" ? "active" : ""}" data-crm-filter="active"><span>Активні</span><strong>${activeTasks.length}</strong></button>
        <button class="metric-card crm-filter-card warning ${crmFilter === "today" ? "active" : ""}" data-crm-filter="today"><span>Сьогодні</span><strong>${todayTasks.length}</strong></button>
        <button class="metric-card crm-filter-card danger ${crmFilter === "overdue" ? "active" : ""}" data-crm-filter="overdue"><span>Прострочені</span><strong>${overdueTasks.length}</strong></button>
        <button class="metric-card crm-filter-card success ${crmFilter === "done" ? "active" : ""}" data-crm-filter="done"><span>Виконано</span><strong>${tasks.filter((task) => task.status === "done").length}</strong></button>
      </div>
      <div class="crm-filter-row">
        <strong>${filterLabels[crmFilter] || "Усі задачі"}</strong>
        ${crmFilter !== "all" ? `<button class="secondary-button compact-button" data-crm-filter="all">Показати всі</button>` : ""}
      </div>
      <div class="crm-list">
        ${visibleTasks.length
          ? visibleTasks.map(renderCrmTaskCard).join("")
          : `<div class="empty-state"><strong>Немає задач у цьому фільтрі</strong><span>Зміни фільтр або додай нову задачу.</span></div>`}
      </div>
    </section>
  `;
}

function renderOverdueTasksDialog() {
  if (!overdueTasksView) return;
  const overdueTasks = sortedCrmTasks(crmFilteredTasks("overdue"));
  overdueTasksView.innerHTML = overdueTasks.length
    ? overdueTasks.map(renderCrmTaskCard).join("")
    : `<div class="empty-state"><strong>Прострочених задач немає</strong><span>Усі задачі виконані або ще не настали за часом.</span></div>`;
}

function fillCrmProjectOptions(selectedProject = "") {
  crmProjectSelect.innerHTML = `
    <option value="">Без прив'язки до об'єкта</option>
    ${projects.map((project) => `
      <option value="${escapeAttribute(project.id)}" ${normalizeProjectId(project.id) === normalizeProjectId(selectedProject) ? "selected" : ""}>${escapeAttribute(project.title)}</option>
    `).join("")}
  `;
}

function fillCrmAssigneeOptions(selectedUserId = "") {
  const members = (cloudState.members || []).filter((member) => member.is_active !== false);
  const fallbackUserId = cloudState.user?.id || "";
  const options = members.length
    ? members.map((member) => `
      <option value="${escapeAttribute(member.user_id)}" ${member.user_id === selectedUserId ? "selected" : ""}>${escapeAttribute(memberDisplayName(member.user_id))} · ${renderRoleLabel(member.role)}</option>
    `).join("")
    : `<option value="${escapeAttribute(fallbackUserId)}">${escapeAttribute(cloudState.user?.email || "Я")}</option>`;

  crmAssigneeSelect.innerHTML = options;
  if (selectedUserId && [...crmAssigneeSelect.options].some((option) => option.value === selectedUserId)) {
    crmAssigneeSelect.value = selectedUserId;
  } else if (fallbackUserId && [...crmAssigneeSelect.options].some((option) => option.value === fallbackUserId)) {
    crmAssigneeSelect.value = fallbackUserId;
  }
}

function openCrmTaskDialog(task = null, defaults = {}) {
  const source = task || defaults;
  const due = splitCrmDueAt(source?.dueAt || "");
  crmTaskForm.reset();
  crmTaskForm.dueDate.type = "text";
  crmTaskForm.dueTime.type = "text";
  crmTaskForm.id.value = task?.id || "";
  crmTaskForm.title.value = source?.title || "";
  crmTaskForm.type.value = source?.type || "task";
  crmTaskForm.dueDate.defaultValue = "";
  crmTaskForm.dueTime.defaultValue = "";
  crmTaskForm.dueDate.value = due.date;
  crmTaskForm.dueTime.value = due.time;
  crmTaskForm.priority.value = source?.priority || "normal";
  crmTaskForm.status.value = source?.status || "planned";
  crmTaskForm.note.value = source?.note || "";
  if (!task && !source?.dueAt) {
    crmTaskForm.dueDate.value = "";
    crmTaskForm.dueTime.value = "";
  }
  fillCrmProjectOptions(source?.projectId || "");
  fillCrmAssigneeOptions(source?.assignedTo || cloudState.user?.id || "");
  crmTaskDialog.querySelector("h2").textContent = task ? "Редагувати задачу" : "Нова задача";
  const office = canCreateCrmTasks();
  crmTaskForm.querySelectorAll("input,select,textarea").forEach((field) => { field.disabled = !office && !["id", "status", "note"].includes(field.name); });
  crmTaskDialog.showModal();
}

function openMeasurementTaskDialog(project) {
  if (!project) return;
  openCrmTaskDialog(null, {
    projectId: normalizeProjectId(project.id),
    title: `Виїзд на замір: ${project.title}`,
    type: "task",
    priority: "normal",
    status: "planned",
    note: `Адреса: ${project.address || "не вказано"}. Клієнт: ${project.clientName || "не вказано"}, ${project.clientPhone || "телефон не вказано"}.`,
  });
}

function saveCrmTaskFromForm() {
  const data = new FormData(crmTaskForm);
  const id = data.get("id") || `crm-${Date.now()}`;
  const existingTask = crmTasks.find((item) => normalizeProjectId(item.id) === normalizeProjectId(id));
  const task = {
    id,
    projectId: data.get("projectId") || "",
    title: String(data.get("title") || "").trim(),
    note: String(data.get("note") || "").trim(),
    type: data.get("type") || "task",
    assignedTo: data.get("assignedTo") || cloudState.user?.id || "",
    dueAt: combineCrmDueAt(data.get("dueDate"), data.get("dueTime")),
    priority: data.get("priority") || "normal",
    status: data.get("status") || "planned",
    createdBy: existingTask?.createdBy || cloudState.user?.id || "",
    createdAt: existingTask?.createdAt || new Date().toISOString(),
  };

  if (!canCreateCrmTasks()) {
    if (!existingTask || !canManageCrmTask(existingTask)) return;
    const status = task.status, note = task.note;
    Object.assign(task, existingTask, { status, note });
  }
  const index = crmTasks.findIndex((item) => normalizeProjectId(item.id) === normalizeProjectId(id));
  if (index >= 0) {
    crmTasks[index] = { ...crmTasks[index], ...task };
  } else {
    crmTasks.unshift(task);
  }

  saveCrmTasks();
  renderCrmView();
  if (!window.spartaDemoRunning && document.querySelector("#objectDetail")?.classList.contains("active")) renderDetail();
}

function renderClientService(target = serviceView) {
  if (!target) return;
  const project = clientProject();
  target.innerHTML = `
    <section class="client-service-panel">
      <div class="client-service-hero"><div><span>Сервісний центр</span><h2>Ми завжди готові допомогти</h2><p>Оберіть потрібний сервіс, а менеджер зв’яжеться з вами.</p></div><span class="service-hero-icon">⌕</span></div>
      <div class="client-service-list">
        <article><span class="service-icon amber">⌘</span><div><strong>Викликати майстра</strong><small>Виїзд спеціаліста для ремонту або налаштування</small></div><em>›</em></article>
        <article><span class="service-icon blue">⌁</span><div><strong>Заявка на діагностику</strong><small>Планова перевірка стану вашої системи</small></div><em>›</em></article>
        <article><span class="service-icon green">◉</span><div><strong>Технічна підтримка</strong><small>Телефон, email та месенджери</small></div><em>›</em></article>
        <article><span class="service-icon violet">◌</span><div><strong>Чат з менеджером</strong><small>Швидка відповідь у робочий час</small></div><em>›</em></article>
        <article><span class="service-icon muted">?</span><div><strong>Історія заявок</strong><small>${escapeAttribute(project?.title || "Ваша станція")} · звернень поки немає</small></div><em>›</em></article>
      </div>
    </section>
  `;
}

function renderServiceView() {
  if (!serviceView) return;
  if (portalMode === "client") {
    renderClientService(serviceView);
    return;
  }
  const tickets = serviceTickets();
  serviceView.innerHTML = `
    <section class="service-panel">
      <div class="segmented">
        <button class="active">Мої заявки</button>
        <button>Всі заявки</button>
      </div>
      <div class="metric-grid compact">
        <div class="metric-card"><span>В роботі</span><strong>${tickets.filter((item) => item.status === "В роботі").length}</strong></div>
        <div class="metric-card"><span>Нові</span><strong>${tickets.filter((item) => item.status === "Нова").length}</strong></div>
        <div class="metric-card"><span>Очікує</span><strong>${tickets.filter((item) => item.status === "Очікує").length}</strong></div>
      </div>
      <button class="primary-button full-width">+ Нова заявка</button>
      <h2>Останні заявки</h2>
      <div class="ticket-list">
        ${tickets.map((ticket) => `
          <article class="ticket-card">
            <span class="ticket-icon ${ticket.tone}">!</span>
            <div>
              <strong>${ticket.title}</strong>
              <span>${ticket.object}</span>
            </div>
            <em>${ticket.status}</em>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderMonitoringView() {
  if (!monitoringView) return;
  monitoringView.innerHTML = `
    <section class="monitoring-panel">
      <article class="client-info-card"><h2>Моніторинг ще не підключено</h2><p>Онлайн-стан обладнання, генерація, заряд АКБ, попередження й аварії з’являться після підключення джерела даних. Статуси монтажу не є показниками роботи обладнання.</p></article>
      ${projects.length ? `
        <h3>Об’єкти в базі</h3>
        <div class="ticket-list">${projects.map((project) => `
          <article class="monitor-card" data-project-id="${escapeAttribute(project.id)}">
            <span class="object-thumb small" aria-hidden="true"></span>
            <div><strong>${escapeAttribute(project.title)}</strong><span>${escapeAttribute(formatCombined(project.technical?.inverterManufacturer, project.technical?.inverterModel))}</span><small>PV ${totalPower(project)} кВт · телеметрію не підключено</small></div>
            <em class="${statusTone(project.status)}">${escapeAttribute(statusLabels[project.status] || "Не вказано")}</em>
          </article>
        `).join("")}</div>
      ` : `<div class="empty-state"><strong>Об’єктів ще немає</strong><span>Додайте перший об’єкт, щоб зберегти дані обладнання.</span></div>`}
    </section>
  `;
}

function profileWorkspaceLinks() {
  if (portalMode === "client") return "";
  const local = Boolean(window.SPARTA_LOCAL_WORKSPACE?.enabled);
  const role = cloudState.memberRole;
  const managesCompany = ["owner", "admin"].includes(role);
  const links = [];
  if ((local || cloudState.ready) && managesCompany) links.push(["cash", "Каса"]);
  if (!local && cloudState.ready && ["owner", "admin", "engineer", "warehouse"].includes(role)) links.push(["sales", "Продажі"]);
  if (!local && cloudState.ready && managesCompany) links.push(["team", "Команда і події"]);
  if (!links.length) return "";
  return `<div class="profile-menu profile-workspace-links" aria-label="Розділи компанії">${links.map(([section, label]) => `<button type="button" data-section="${section}">${label} <span>›</span></button>`).join("")}</div>`;
}

function renderProfileView() {
  if (!profileView) return;
  if (portalMode === "client") {
    renderClientMenu();
    return;
  }
  if (window.SPARTA_LOCAL_WORKSPACE?.enabled) {
    profileView.innerHTML = `<section class="profile-panel"><div class="profile-card"><img class="profile-avatar" src="./assets/sparta-logo.jpeg" alt="SPARTA power" /><div><h2>SPARTA power</h2><span>Локальна версія</span><small>Власник · цей комп’ютер</small></div></div><article class="client-info-card"><h3>Локальна база</h3><p>${escapeAttribute(cloudState.message)}</p><p class="calculation-note">Об’єкти, склад, каса та вкладення зберігаються в цьому браузері. Можна вносити власних клієнтів, товари, початкові залишки й операції. Спільна онлайн-база налаштовується окремо.</p></article>${profileWorkspaceLinks()}${window.SpartaWorkspaceMaintenance?.panelMarkup() || ""}</section>`;
    return;
  }
  const email = cloudState.user?.email || "Користувач не увійшов";
  const mode = cloudState.enabled ? cloudState.message : "Локальне збереження в браузері";
  const canManageUsers = ["owner", "admin"].includes(cloudState.memberRole);
  const canAcceptInvitation = Boolean(cloudState.user && cloudState.enabled && !cloudState.ready);
  const roleLabel = renderRoleLabel(cloudState.memberRole);
  profileView.innerHTML = `
    <section class="profile-panel">
      <div class="profile-card">
        <img class="profile-avatar" src="./assets/sparta-logo.jpeg" alt="SPARTA power" />
        <div>
          <h2>SPARTA power</h2>
          <span>${escapeAttribute(email)}</span>
          <small>${escapeAttribute(cloudState.ready ? `Роль: ${roleLabel}` : mode)}</small>
        </div>
      </div>
      <div class="profile-menu">
        ${
          cloudState.user
            ? `<button id="changePasswordButton">Змінити пароль <span>›</span></button>`
            : `<button id="loginButton">Увійти в акаунт <span>›</span></button>`
        }
        <button id="syncNowButton">Синхронізувати зараз <span>›</span></button>
        ${canAcceptInvitation ? `<button id="acceptInvitationButton">Прийняти запрошення <span>›</span></button>` : ""}
        ${canManageUsers ? `<button id="inviteUserButton">Додати користувача <span>›</span></button>` : ""}
        ${cloudState.user ? `<button id="logoutButton">Вийти з акаунта <span>›</span></button>` : ""}
      </div>
      ${profileWorkspaceLinks()}
      ${window.SpartaTeamAccess?.profileMarkup() || renderCompanyUsers()}
    </section>
  `;
}

function renderRoleLabel(role) {
  const labels = {
    owner: "Власник",
    admin: "Адмін",
    engineer: "Менеджер",
    warehouse: "Комірник",
    brigadier: "Майстер",
    installer: "Монтажник",
    viewer: "Перегляд",
  };
  return labels[role] || role || "-";
}

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "signin";
  authForm.querySelector("[name='authMode']").value = authMode;
  authForm.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === authMode);
  });

  if (authMode === "signup") {
    authTitle.textContent = "Створити акаунт";
    authSubmitButton.textContent = "Створити акаунт";
    authMessage.textContent = "Введи email, який власник додав у запрошення, і придумай пароль.";
  } else {
    authTitle.textContent = "Вхід користувача";
    authSubmitButton.textContent = "Увійти";
    authMessage.textContent = cloudState.enabled
      ? "Введи email і пароль користувача."
      : (cloudState.message || "Supabase не вдалося запустити.");
  }
}

function renderCompanyUsers() {
  if (!cloudState.ready || cloudState.memberRole !== "owner") return "";
  const members = activeCompanyMembers();
  const invitations = (cloudState.invitations || []).filter((item) => !item.accepted_at);

  return `
    <div class="profile-menu">
      <button type="button" id="companyUsersButton">Користувачі компанії <span>${members.length}</span></button>
      ${invitations.length
        ? `<button type="button">Активні запрошення <span>${invitations.length}</span></button>
          ${invitations.map((invitation) => `
            <div class="profile-row invitation-row">
              <span>${escapeAttribute(invitation.full_name || invitation.email)}</span>
              <strong>Очікує: ${escapeAttribute(renderRoleLabel(invitation.role))}</strong>
              <div class="row-actions">
                <button class="secondary-button compact-button" data-resend-invitation="${escapeAttribute(invitation.email)}" type="button">Надіслати повторно</button>
                <button class="danger-button compact-button" data-cancel-invitation="${escapeAttribute(invitation.email)}" type="button">Відмінити</button>
              </div>
            </div>
          `).join("")}`
        : ""}
    </div>
  `;
}

function activeCompanyMembers() {
  return (cloudState.members || []).filter((member) => member.is_active !== false);
}

function companyMemberName(member) {
  return member?.profiles?.full_name || member?.profiles?.email || "Працівник";
}

function companyMemberEmail(member) {
  return member?.profiles?.email || "Email не вказано";
}

function openCompanyUsersDialog(selectedUserId = "") {
  if (!cloudState.ready || cloudState.memberRole !== "owner") {
    alert("Переглядати список користувачів може тільки власник компанії.");
    return;
  }

  const members = activeCompanyMembers();
  const selectedMember = members.find((member) => member.user_id === selectedUserId) || null;
  companyUsersDialogBody.innerHTML = `
    <div class="company-users-layout">
      <div class="company-users-list">
        ${members.length
          ? members.map((member) => `
            <button class="company-user-item ${selectedMember?.user_id === member.user_id ? "active" : ""}" type="button" data-view-member="${escapeAttribute(member.user_id)}">
              <span>${escapeAttribute(companyMemberName(member))}</span>
              <small>${escapeAttribute(renderRoleLabel(member.role))}</small>
            </button>
          `).join("")
          : `<div class="empty-state"><strong>Користувачів ще немає</strong><span>Додай працівника через запрошення.</span></div>`}
      </div>
      <div class="company-user-profile">
        ${selectedMember ? renderCompanyMemberProfile(selectedMember) : `
          <div class="empty-state">
            <strong>Вибери користувача</strong>
            <span>Натисни на працівника у списку, щоб переглянути його профіль.</span>
          </div>
        `}
      </div>
    </div>
  `;
  if (!companyUsersDialog.open) companyUsersDialog.showModal();
}

function renderCompanyMemberProfile(member) {
  const profile = member.profiles || {};
  const canRemove = member.role !== "owner" && member.user_id !== cloudState.user?.id;
  return `
    <article class="member-profile-card">
      <div class="profile-card compact-profile">
        <img class="profile-avatar" src="./assets/sparta-logo.jpeg" alt="SPARTA power" />
        <div>
          <h3>${escapeAttribute(companyMemberName(member))}</h3>
          <span>${escapeAttribute(companyMemberEmail(member))}</span>
          <small>Роль: ${escapeAttribute(renderRoleLabel(member.role))}</small>
        </div>
      </div>
      <div class="object-specs">
        <div><span>Ім'я</span><strong>${escapeAttribute(profile.full_name || "Не вказано")}</strong></div>
        <div><span>Email</span><strong>${escapeAttribute(profile.email || "Не вказано")}</strong></div>
        <div><span>Телефон</span><strong>${escapeAttribute(profile.phone || "Не вказано")}</strong></div>
        <div><span>Роль</span><strong>${escapeAttribute(renderRoleLabel(member.role))}</strong></div>
        <div><span>Доступ</span><strong>${member.is_active === false ? "Вимкнено" : "Активний"}</strong></div>
      </div>
      ${canRemove ? `<button class="danger-button" data-remove-member="${escapeAttribute(member.user_id)}" type="button">Видалити користувача з компанії</button>` : ""}
    </article>
  `;
}

function renderStats() {
  const stats = [
    ["Усі об'єкти", projects.length],
    ["Підготовка", projects.filter((project) => ["new", "planned", "proposal", "contract"].includes(project.status)).length],
    ["Монтаж", projects.filter((project) => ["in_progress", "waiting_review"].includes(project.status)).length],
    ["Завершено", projects.filter((project) => isClosedProjectStatus(project.status)).length],
    ["Паспорти", projects.filter((project) => project.status === "passport_issued").length],
  ];

  statsGrid.innerHTML = stats.map((item) => `<div class="stat"><strong>${item[1]}</strong><span>${item[0]}</span></div>`).join("");
}

function render() {
  window.SpartaProjectStockPicker?.refreshAccess?.();
  window.SpartaOrderNotifications?.refreshAccess();
  if (window.SpartaBuyerCloud?.isBuyerReady()) {
    document.body.classList.add("buyer-audience");
    window.SpartaBuyerUI?.renderBuyer(document.querySelector("#buyerPortalView"));
    return;
  }
  document.body.classList.remove("buyer-audience");
  if (window.SPARTA_LOCAL_WORKSPACE?.enabled && window.spartaDemoRunning) return;
  renderHome();
  renderProjectList();
  renderDetail();
  renderPassport();
  renderCrmView();
  renderWarehouseView();
  renderMapView();
  renderServiceView();
  renderMonitoringView();
  renderProfileView();
  renderCrmNotification();
  renderStats();
  window.SpartaCashBook?.renderView();
  if (document.querySelector("#sales")?.classList.contains("active")) window.SpartaBuyerUI?.renderSales(document.querySelector("#salesView"));
  applyProjectRoleControls();
}

["click", "submit", "change"].forEach((type) => document.addEventListener(type, guardProjectRoleAction, true));

document.addEventListener("toggle", (event) => {
  const details = event.target;
  if (!details.matches?.("[data-project-archive]") || !details.open || details.dataset.loaded) return;
  const project = projects.find((item) => String(item.id) === details.dataset.projectArchive);
  if (!project) return;
  details.querySelector(".workflow-archive-body").innerHTML = renderProjectArchiveContents(project);
  details.dataset.loaded = "true";
  applyProjectRoleControls();
}, true);

document.addEventListener("click", (event) => {
  const stockPickerButton = event.target.closest("[data-project-stock-picker]");
  if (stockPickerButton) {
    window.SpartaProjectStockPicker?.open({ projectId: stockPickerButton.dataset.projectStockId, target: stockPickerButton.dataset.projectStockPicker });
    return;
  }
  if (event.target.closest("#solarUseLocationButton")) {
    useDeviceSolarLocation();
    return;
  }

  const portalModeButton = event.target.closest("[data-portal-mode]");
  if (portalModeButton) {
    applyPortalMode(portalModeButton.dataset.portalMode);
    render();
    showSection("home");
    return;
  }

  const navItem = event.target.closest(".nav-item, .profile-workspace-links [data-section]");
  if (navItem) {
    showSection(navItem.dataset.section);
  }

  const quickAction = event.target.closest(".quick-action");
  if (quickAction?.dataset.section) {
    showSection(quickAction.dataset.section);
  }

  if (event.target.closest("#crmNotificationButton")) {
    renderOverdueTasksDialog();
    overdueTasksDialog.showModal();
  }

  const crmFilterButton = event.target.closest("[data-crm-filter]");
  if (crmFilterButton) {
    crmFilter = crmFilterButton.dataset.crmFilter || "all";
    renderCrmView();
  }

  if (event.target.closest("#newProjectQuickButton")) {
    form.reset();
    dialog.showModal();
  }

  const closeDialogButton = event.target.closest("[data-close-dialog]");
  if (closeDialogButton) {
    closeDialogButton.closest("dialog")?.close();
  }

  const projectCard = event.target.closest("[data-project-id]");
  if (projectCard) {
    selectedProjectId = normalizeProjectId(projectCard.dataset.projectId);
    selectedTab = "";
    render();
    showSection("objectDetail");
  }

  if (event.target.closest("#loginButton")) {
    authForm.reset();
    setAuthMode("signin");
    authDialog.showModal();
  }

  if (event.target.closest("#changePasswordButton")) {
    if (!cloudState.user || !cloudState.client) {
      alert("Спочатку увійди в акаунт.");
      return;
    }
    passwordForm.reset();
    passwordMessage.textContent = "Новий пароль має містити щонайменше 8 символів і відрізнятися від чинного.";
    passwordDialog.showModal();
  }

  const authModeButton = event.target.closest("[data-auth-mode]");
  if (authModeButton) {
    setAuthMode(authModeButton.dataset.authMode);
  }

  if (event.target.closest("#logoutButton")) {
    void logoutCloudUser();
  }

  if (event.target.closest("#syncNowButton")) {
    Promise.all([syncProjectsToCloud(), syncWarehouseItemsToCloud(), window.SpartaCashBook?.sync()]).then(render).catch((error) => {
      cloudState.message = `Помилка синхронізації: ${error.message}`;
      renderProfileView();
    });
  }

  if (event.target.closest("#acceptInvitationButton")) {
    retryAcceptInvitation().catch((error) => {
      cloudState.message = `Помилка запрошення: ${error.message}`;
      renderProfileView();
    });
  }

  if (event.target.closest("#inviteUserButton") || event.target.closest("[data-team-invite]")) {
    if (invitationFormBusy) return;
    if (!cloudState.ready) {
      alert("Спочатку налаштуй Supabase і увійди в акаунт власника або адміністратора.");
      return;
    }
    if (!["owner", "admin"].includes(cloudState.memberRole)) {
      alert("Додавати користувачів може власник або адміністратор компанії.");
      return;
    }
    inviteForm.reset();
    inviteForm.elements.role.querySelector('option[value="admin"]').disabled = cloudState.memberRole !== "owner";
    inviteMessage.textContent = "Додай email і роль. Користувач зможе створити акаунт із цим email та автоматично приєднається до компанії.";
    inviteDialog.showModal();
  }

  if (event.target.closest("[data-team-open]")) { showSection("team"); }
  const teamResend = event.target.closest("[data-team-resend]");
  if (teamResend) resendInvitation(teamResend.dataset.teamResend).catch((error) => { alert(error.message); });
  if (event.target.closest("#companyUsersButton")) {
    openCompanyUsersDialog();
  }

  const viewMemberButton = event.target.closest("[data-view-member]");
  if (viewMemberButton) {
    openCompanyUsersDialog(viewMemberButton.dataset.viewMember);
  }

  const resendInvitationButton = event.target.closest("[data-resend-invitation]");
  if (resendInvitationButton) {
    resendInvitation(resendInvitationButton.dataset.resendInvitation).catch((error) => {
      cloudState.message = `Помилка повторного запрошення: ${error.message}`;
      renderProfileView();
    });
  }

  const cancelInvitationButton = event.target.closest("[data-cancel-invitation]");
  if (cancelInvitationButton) {
    cancelInvitation(cancelInvitationButton.dataset.cancelInvitation).catch((error) => {
      cloudState.message = `Помилка відміни запрошення: ${error.message}`;
      renderProfileView();
    });
  }

  const removeMemberButton = event.target.closest("[data-remove-member]");
  if (removeMemberButton) {
    removeCompanyMember(removeMemberButton.dataset.removeMember).catch((error) => {
      cloudState.message = `Помилка видалення користувача: ${error.message}`;
      renderProfileView();
    });
  }

  if (event.target.closest("#newCrmTaskButton")) {
    if (!canCreateCrmTasks()) {
      alert("Створювати задачі можуть власник, адміністратор, інженер, бригадир або монтажник.");
      return;
    }
    openCrmTaskDialog();
  }

  const crmEditButton = event.target.closest("[data-crm-edit]");
  if (crmEditButton) {
    const task = crmTasks.find((item) => normalizeProjectId(item.id) === normalizeProjectId(crmEditButton.dataset.crmEdit));
    if (task) openCrmTaskDialog(task);
  }

  const crmDoneButton = event.target.closest("[data-crm-done]");
  if (crmDoneButton) {
    const task = crmTasks.find((item) => normalizeProjectId(item.id) === normalizeProjectId(crmDoneButton.dataset.crmDone));
    if (task) {
      task.status = "done";
      saveCrmTasks();
      renderCrmView();
      renderOverdueTasksDialog();
    }
  }

  const crmDeleteButton = event.target.closest("[data-crm-delete]");
  if (crmDeleteButton && canCreateCrmTasks()) {
    const taskId = normalizeProjectId(crmDeleteButton.dataset.crmDelete);
    const task = crmTasks.find((item) => normalizeProjectId(item.id) === taskId);
    if (task && confirm(`Видалити задачу "${task.title}"?`)) {
      pendingCrmDeletes.push(taskId);
      savePendingCrmDeletes();
      crmTasks = crmTasks.filter((item) => normalizeProjectId(item.id) !== taskId);
      saveCrmTasks();
      renderCrmView();
      renderOverdueTasksDialog();
    }
  }

  const tab = event.target.closest("[data-tab]");
  if (tab) {
    const nextTab = selectedTab === tab.dataset.tab ? "" : tab.dataset.tab;
    if (selectedTab === "strings" && nextTab !== "strings") {
      stringsEditing = false;
    }
    if (selectedTab === "materials" && nextTab !== "materials") {
      materialsEditing = false;
    }
    selectedTab = nextTab;
    renderDetail();
    if (selectedTab) {
      document.querySelector(`#project-section-${selectedTab}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const workflowStageButton = event.target.closest("[data-workflow-stage]");
  if (workflowStageButton) {
    const project = selectedProject();
    if (!project) return;
    const nextStage = selectedTab === workflowStageButton.dataset.workflowStage ? "" : workflowStageButton.dataset.workflowStage;
    if (nextStage !== "in_progress" && nextStage !== "waiting_review") {
      stringsEditing = false;
    }
    if (nextStage !== "in_progress") {
      materialsEditing = false;
    }
    selectedTab = nextStage;
    render();
    showSection("objectDetail");
    if (selectedTab) {
      document.querySelector(`#project-section-${selectedTab}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  if (event.target.closest("#editTechnicalButton")) {
    openTechnicalDialog();
  }

  if (event.target.closest("#editProjectInfoButton")) {
    openProjectInfoDialog();
  }

  if (event.target.closest("#createMeasurementTaskButton")) {
    openMeasurementTaskDialog(selectedProject());
  }

  if (event.target.closest("#createObjectServiceTaskButton") && canCreateCrmTasks()) {
    const project = selectedProject();
    if (project) openCrmTaskDialog(null, { projectId: project.id, title: `Сервіс: ${project.title}`, type: "service", status: "planned", note: `Адреса: ${project.address || "не вказано"}. Опишіть причину звернення та погодьте виїзд.` });
  }

  const warehouseSectionButton = event.target.closest("[data-warehouse-section]");
  if (event.target.closest('[data-warehouse-layout="new"]')) {
    writeLocalStorage("solarObjectManager.warehouseLayout", "new");
    renderWarehouseView();
  }
  if (warehouseSectionButton) {
    selectedWarehouseSection = selectedWarehouseSection === warehouseSectionButton.dataset.warehouseSection ? "" : warehouseSectionButton.dataset.warehouseSection;
    editingWarehouseIndex = null;
    renderWarehouseView();
    if (selectedWarehouseSection) {
      document.querySelector(`#warehouse-section-${selectedWarehouseSection}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const pickWarehouseButton = event.target.closest("[data-pick-warehouse-id]");
  if (pickWarehouseButton) {
    const formElement = document.querySelector("#warehouseItemForm");
    const item = warehouseItemById(pickWarehouseButton.dataset.pickWarehouseId);
    if (formElement && item) {
      formElement.elements.catalogItem.value = item.id;
      fillWarehouseFormFromItem(formElement, item);
      formElement.elements.qty.value = "";
      formElement.elements.qty.focus();
    }
  }

  if (event.target.closest("#editStringsButton")) {
    stringsEditing = true;
    renderDetail();
  }

  if (event.target.closest("#cancelStringsEditButton")) {
    stringsEditing = false;
    renderDetail();
  }

  if (event.target.closest("#saveStringsEditButton")) {
    saveStringEdits();
  }

  if (event.target.closest("#editMaterialsButton")) {
    materialsEditing = true;
    renderDetail();
  }

  if (event.target.closest("#cancelMaterialsEditButton")) {
    materialsEditing = false;
    renderDetail();
  }

  if (event.target.closest("#saveMaterialsEditButton")) {
    saveMaterialEdits();
  }

  const checklistAction = event.target.closest("[data-checklist-action]");
  if (checklistAction) {
    const project = selectedProject();
    if (!project) return;
    const checked = checklistAction.dataset.checklistAction === "complete";
    project.workChecklist = installerChecklistItemIds.reduce((result, id) => {
      result[id] = checked;
      return result;
    }, {});
    saveProjects();
    render();
    showSection("objectDetail");
  }

  if (event.target.closest("#passportPreviewButton")) {
    renderPassport();
    passportPreview.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (event.target.closest("#passportPrintButton")) {
    renderPassport();
    window.print();
  }

  if (event.target.closest("#objectPassportPreviewButton")) {
    const preview = document.querySelector("#objectPassportPreview");
    if (preview?.closest("details")) preview.closest("details").open = true;
    preview?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (event.target.closest("#objectPassportPrintButton")) {
    renderPassport();
    showSection("passport");
    window.print();
    showSection("objectDetail");
  }

  if (event.target.closest("#backToProjectsButton")) {
    selectedTab = "";
    render();
    showSection("projects");
  }

  if (event.target.closest("#deleteProjectButton")) {
    deleteSelectedProject();
  }

  const deleteStringButton = event.target.closest("[data-delete-string-index]");
  if (deleteStringButton) {
    const project = selectedProject();
    const index = Number(deleteStringButton.dataset.deleteStringIndex);
    project.strings.splice(index, 1);
    saveProjects();
    render();
  }

  const deleteMaterialButton = event.target.closest("[data-delete-material-index]");
  if (deleteMaterialButton) {
    const project = selectedProject();
    const index = Number(deleteMaterialButton.dataset.deleteMaterialIndex);
    if (!window.SPARTA_LOCAL_WORKSPACE?.enabled && (Number(project.materials[index]?.issuedQty || 0) || Number(project.materials[index]?.actualQty || 0))) {
      alert("Матеріал має складські операції. Проведіть повернення у складі; історію використання видаляти не можна.");
      return;
    }
    project.materials.splice(index, 1);
    saveProjects();
    render();
  }

  const deleteEquipmentButton = event.target.closest("[data-delete-equipment-type]");
  if (deleteEquipmentButton) {
    const project = selectedProject();
    if (!project) return;
    const type = deleteEquipmentButton.dataset.deleteEquipmentType;
    const index = Number(deleteEquipmentButton.dataset.deleteEquipmentIndex);
    normalizeTechnicalEquipment(project.technical);
    if (!Array.isArray(project.technical[type])) return;
    project.technical[type].splice(index, 1);
    syncLegacyTechnicalFields(project.technical);
    saveProjects();
    render();
    showSection("objectDetail");
  }

  const deleteOfferLineButton = event.target.closest("[data-delete-offer-line]");
  if (deleteOfferLineButton) {
    const project = selectedProject();
    if (!project) return;
    project.finance = normalizeProjectFinance(project.finance);
    project.finance.offerLines.splice(Number(deleteOfferLineButton.dataset.deleteOfferLine), 1);
    syncCommercialOfferContractPrice(project);
    saveProjects();
    render();
    showSection("objectDetail");
  }

  if (event.target.closest("#printCommercialOfferButton")) {
    printCommercialOffer();
  }

  if (event.target.closest("#shareCommercialOfferButton")) {
    shareCommercialOffer().catch((error) => {
      if (error?.name !== "AbortError") alert(`Не вдалося поділитися КП: ${error.message}`);
    });
  }

  if (event.target.closest("#copyOfferToMaterialsButton")) {
    copyCommercialOfferToMaterials();
  }

  const deleteExpenseButton = event.target.closest("[data-delete-expense-index]");
  if (deleteExpenseButton) {
    const project = selectedProject();
    if (!project) return;
    project.finance = normalizeProjectFinance(project.finance);
    project.finance.expenses.splice(Number(deleteExpenseButton.dataset.deleteExpenseIndex), 1);
    saveProjects();
    render();
    showSection("objectDetail");
  }

  const deleteWarehouseButton = event.target.closest("[data-delete-warehouse-index]");
  if (deleteWarehouseButton) {
    const deleteIndex = Number(deleteWarehouseButton.dataset.deleteWarehouseIndex);
    const [removedItem] = warehouseItems.splice(deleteIndex, 1);
    if (removedItem?.id) {
      pendingWarehouseDeletes.push(normalizeProjectId(removedItem.id));
      savePendingWarehouseDeletes();
    }
    if (editingWarehouseIndex === deleteIndex) editingWarehouseIndex = null;
    if (Number.isInteger(editingWarehouseIndex) && editingWarehouseIndex > deleteIndex) editingWarehouseIndex -= 1;
    saveWarehouseItems();
    render();
    showSection("warehouse");
  }

  const editWarehouseButton = event.target.closest("[data-edit-warehouse-index]");
  if (editWarehouseButton) {
    editingWarehouseIndex = Number(editWarehouseButton.dataset.editWarehouseIndex);
    selectedWarehouseSection = warehouseSectionForCategory(warehouseItems[editingWarehouseIndex]?.category);
    render();
    showSection("warehouse");
  }

  if (event.target.closest("[data-cancel-warehouse-edit]")) {
    editingWarehouseIndex = null;
    render();
    showSection("warehouse");
  }

  const deletePhotoButton = event.target.closest("[data-delete-photo-index]");
  if (deletePhotoButton) {
    const project = selectedProject();
    const index = Number(deletePhotoButton.dataset.deletePhotoIndex);
    const [removedPhoto] = project.photos.splice(index, 1);
    saveProjects();
    render();

    if (cloudState.ready && removedPhoto?.storagePath) {
      cloudState.client.storage.from(PHOTO_BUCKET).remove([removedPhoto.storagePath]).catch((error) => {
        cloudState.message = `Фото видалено з об'єкта, але файл у Storage не видалився: ${error.message}`;
        renderProfileView();
      });
    }
  }

  const deleteFileButton = event.target.closest("[data-delete-file-index]");
  if (deleteFileButton) {
    const project = selectedProject();
    if (!project) return;
    const index = Number(deleteFileButton.dataset.deleteFileIndex);
    const [removedFile] = project.files.splice(index, 1);
    saveProjectFileMetadata(project);
    saveProjects();
    render();
    if (removedFile?.fileKey) {
      deleteProjectFileBlob(removedFile.fileKey).catch(() => {});
    }
    if (cloudState.ready && removedFile?.storagePath) {
      cloudState.client.storage.from(PROJECT_FILE_BUCKET).remove([removedFile.storagePath]).catch((error) => {
        cloudState.message = `Файл видалено зі списку, але у Storage він лишився: ${error.message}`;
        renderProfileView();
      });
    }
  }

  const openFileButton = event.target.closest("[data-open-file-index]");
  if (openFileButton) {
    const project = selectedProject();
    if (!project) return;
    const file = project.files[Number(openFileButton.dataset.openFileIndex)];
    openProjectFile(file).catch((error) => alert(`Не вдалося відкрити файл: ${error.message}`));
  }
});

document.addEventListener("input", (event) => {
  if (!event.target.matches("[data-warehouse-filter='query']")) return;

  const sectionId = event.target.dataset.sectionId || selectedWarehouseSection;
  warehousePickerFilters[sectionId] = {
    ...warehouseSectionFilter(sectionId),
    query: event.target.value,
  };
  editingWarehouseIndex = null;
  window.clearTimeout(warehouseSearchTimer);
  warehouseSearchTimer = window.setTimeout(() => {
    renderWarehouseView();
    document.querySelector(`#warehouse-section-${sectionId} [data-warehouse-filter='query']`)?.focus();
  }, 180);
});

document.addEventListener("input", (event) => {
  if (event.target.matches("#solarCalculatorForm [name=location]")) {
    event.target.form.elements.locationSource.value = "city";
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-crm-task-photo]")) {
    const task = crmTasks.find((item) => String(item.id) === event.target.dataset.crmTaskPhoto);
    const file = event.target.files?.[0];
    if (!task || !file || !canManageCrmTask(task)) return;
    const project = projects.find((item) => String(item.id) === String(task.projectId));
    if (!project) return;
    const previousProjectId = selectedProjectId;
    selectedProjectId = project.id;
    const upload = addProjectPhotoFromFile(file, crmTaskPhotoCategory(task), task.title, null, { crmTaskId: task.id, createdBy: cloudState.user?.id || "" });
    selectedProjectId = previousProjectId;
    upload.finally(() => { event.target.value = ""; renderCrmView(); });
    return;
  }
  if (event.target.matches("[data-warehouse-filter]")) {
    const sectionId = event.target.dataset.sectionId || selectedWarehouseSection;
    warehousePickerFilters[sectionId] = {
      ...warehouseSectionFilter(sectionId),
      [event.target.dataset.warehouseFilter]: event.target.value,
    };
    editingWarehouseIndex = null;
    renderWarehouseView();
    return;
  }

  if (event.target.matches("[data-equipment-photo-id]")) {
    const file = event.target.files?.[0];
    const type = event.target.dataset.equipmentPhotoType;
    const equipmentId = event.target.dataset.equipmentPhotoId;
    addEquipmentPhoto(file, type, equipmentId).finally(() => {
      event.target.value = "";
    });
    return;
  }

  if (event.target.matches("[data-work-checklist-item]")) {
    const project = selectedProject();
    if (!project) return;
    project.workChecklist ||= emptyInstallerChecklist();
    project.workChecklist[event.target.dataset.workChecklistItem] = event.target.checked;
    saveProjects();
    render();
    showSection("objectDetail");
    return;
  }

  if (event.target.id === "projectStatusSelect") {
    const project = selectedProject();
    if (!project) return;

    project.status = event.target.value;
    selectedTab = event.target.value;
    saveProjects();
    render();
    showSection("objectDetail");
    return;
  }

  if (event.target.id === "materialCategorySelect") {
    const formElement = event.target.closest("#materialForm");
    const catalogSelect = formElement.querySelector("#materialCatalogSelect");
    catalogSelect.innerHTML = materialCatalogOptions(event.target.value);
    formElement.elements.name.value = "";
    formElement.elements.unit.value = "";
  }

  if (event.target.id === "materialCatalogSelect") {
    const formElement = event.target.closest("#materialForm");
    if (event.target.value && event.target.value !== "custom") {
      formElement.elements.name.value = event.target.value;
      formElement.elements.unit.value = defaultMaterialUnit(event.target.value);
    }
    if (event.target.value === "custom") {
      formElement.elements.name.value = "";
      formElement.elements.name.focus();
    }
  }

  if (event.target.id === "commercialOfferItemSelect") {
    fillCommercialOfferPrices(event.target.closest("#commercialOfferLineForm"));
  }

  if (event.target.id === "warehouseCategorySelect") {
    const formElement = event.target.closest("#warehouseItemForm");
    const customCategory = formElement.querySelector(".warehouse-custom-category");
    const productField = formElement.querySelector(".warehouse-custom-product");
    const productSelect = formElement.elements.catalogItem;
    const isNewCategory = event.target.value === "__new";
    customCategory.hidden = !isNewCategory;
    productSelect.innerHTML = isNewCategory
      ? `<option value="__new" selected>+ Додати товар</option>`
      : `${warehouseProductsForCategory(event.target.value).map((item) => `<option value="${escapeAttribute(item.id)}">${item.name}</option>`).join("")}<option value="__new">+ Додати товар</option>`;
    productField.hidden = !isNewCategory && productSelect.value && productSelect.value !== "__new";
    formElement.elements.name.value = "";
    if (!isNewCategory && productSelect.value && productSelect.value !== "__new") {
      fillWarehouseFormFromItem(formElement, warehouseItemById(productSelect.value));
      if (!Number.isInteger(editingWarehouseIndex)) formElement.elements.qty.value = "";
    }
  }

  if (event.target.id === "warehouseProductSelect") {
    const formElement = event.target.closest("#warehouseItemForm");
    const productField = formElement.querySelector(".warehouse-custom-product");
    const selectedItem = warehouseItemById(event.target.value);
    productField.hidden = Boolean(selectedItem);
    if (selectedItem) fillWarehouseFormFromItem(formElement, selectedItem);
    if (selectedItem && !Number.isInteger(editingWarehouseIndex)) formElement.elements.qty.value = "";
    if (event.target.value === "__new") {
      formElement.elements.name.value = "";
      formElement.elements.name.focus();
    }
  }

  if (event.target.id === "warehouseMovementTypeSelect") {
    const formElement = event.target.closest("#warehouseMovementForm");
    formElement.querySelector(".warehouse-project-target").hidden = !["project", "return"].includes(event.target.value);
    formElement.querySelector(".warehouse-sale-target").hidden = event.target.value !== "sale";
    fillWarehouseMovementPrice(formElement);
  }

  if (event.target.id === "warehouseMovementItemSelect") {
    fillWarehouseMovementPrice(event.target.closest("#warehouseMovementForm"));
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "solarCalculatorForm") {
    event.preventDefault();
    calculateSolarEstimate(event.target).catch((error) => {
      solarEstimateMessage = `Не вдалося виконати розрахунок: ${error.message}`;
      renderClientStatistics();
    });
    return;
  }

  if (event.target.id === "warehouseItemForm") {
    event.preventDefault();
    addWarehouseItem(event.target);
    return;
  }

  if (event.target.id === "warehouseMovementForm") {
    event.preventDefault();
    addWarehouseMovement(event.target);
    return;
  }

  if (event.target.id === "projectFinanceForm") {
    event.preventDefault();
    saveProjectFinance(event.target);
    return;
  }

  if (event.target.id === "commercialOfferLineForm") {
    event.preventDefault();
    addCommercialOfferLine(event.target);
    return;
  }

  if (event.target.id === "commercialOfferTotalsForm") {
    event.preventDefault();
    saveCommercialOfferTotals(event.target);
    return;
  }

  if (event.target.id === "projectExpenseForm") {
    event.preventDefault();
    addProjectExpense(event.target);
    return;
  }

  if (event.target.id === "photoForm") {
    event.preventDefault();
    addPhoto(event.target);
    return;
  }

  if (event.target.id === "projectFileForm") {
    event.preventDefault();
    addProjectFile(event.target).catch((error) => alert(`Не вдалося додати файл: ${error.message}`));
    return;
  }

  if (event.target.matches(".equipment-form")) {
    event.preventDefault();
    addEquipmentItem(event.target);
    return;
  }

  if (event.target.id === "materialForm") {
    event.preventDefault();
    addMaterial(event.target);
    return;
  }

  if (!event.target.classList.contains("connection-string-form")) return;
  event.preventDefault();

  const project = selectedProject();
  if (!project) return;

  const data = new FormData(event.target);
  project.strings.push({
    mpptNumber: Number(event.target.dataset.mpptNumber || 0),
    pvInputNumber: Number(data.get("pvInputNumber") || 1),
    stringNumber: Number(data.get("stringNumber") || 0),
    stringType: data.get("stringType") || "normal",
    panelCount: Number(data.get("panelCount") || 0),
    orientation: data.get("orientation").trim(),
    tiltAngle: Number(data.get("tiltAngle") || 0),
    note: data.get("note").trim(),
  });

  project.strings.sort((a, b) => a.mpptNumber - b.mpptNumber || Number(a.pvInputNumber || 1) - Number(b.pvInputNumber || 1) || a.stringNumber - b.stringNumber);
  saveProjects();
  event.target.reset();
  render();
});

function fillWarehouseFormFromItem(formElement, item) {
  if (!formElement || !item) return;
  formElement.elements.name.value = item.name || "";
  formElement.elements.sku.value = item.sku || "";
  formElement.elements.unit.value = item.unit || "шт";
  formElement.elements.purchasePrice.value = Number(item.purchasePrice || 0);
  formElement.elements.deliveryCost.value = Number(item.deliveryCost || 0);
  formElement.elements.extraCost.value = Number(item.extraCost || 0);
  formElement.elements.installerPrice.value = Number(item.installerPrice ?? 0);
  if (formElement.elements.wholesalePrice) formElement.elements.wholesalePrice.value = Number(item.wholesalePrice ?? 0);
  formElement.elements.retailPrice.value = Number(item.retailPrice || item.salePrice || 0);
  formElement.elements.minQty.value = Number(item.minQty || 0);
  formElement.elements.location.value = item.location || "";
  formElement.elements.serialNumber.value = item.serialNumber || "";
  formElement.elements.supplier.value = item.supplier || "";
  formElement.elements.characteristics.value = item.characteristics || "";
}

function fillWarehouseMovementPrice(formElement) {
  if (!formElement) return;
  const item = warehouseItemById(formElement.elements.itemId?.value);
  if (!item) return;
  const type = formElement.elements.movementType?.value || "project";
  formElement.elements.salePrice.value = Number(type === "sale" ? item.retailPrice || item.salePrice || 0 : item.installerPrice || item.salePrice || 0);
}

function warehouseItemFromForm(formElement, currentItem = null) {
  const data = new FormData(formElement);
  const selectedCategory = data.get("category");
  const selectedCatalogItem = data.get("catalogItem");
  const catalogItem = selectedCatalogItem && selectedCatalogItem !== "__new" ? warehouseItemById(selectedCatalogItem) : null;
  const category = selectedCategory === "__new" ? String(data.get("customCategory") || "").trim() : selectedCategory;
  const retailPrice = Number(data.get("retailPrice") || data.get("salePrice") || catalogItem?.retailPrice || catalogItem?.salePrice || 0);
  return {
    id: currentItem?.id || catalogItem?.id || `wh-${Date.now()}`,
    name: String(data.get("name") || catalogItem?.name || "").trim(),
    category: category || catalogItem?.category || "Інше",
    sku: String(data.get("sku") || catalogItem?.sku || "").trim(),
    qty: Number(data.get("qty") || 0),
    unit: String(data.get("unit") || catalogItem?.unit || "шт").trim(),
    purchasePrice: Number(data.get("purchasePrice") || catalogItem?.purchasePrice || 0),
    deliveryCost: Number(data.get("deliveryCost") || catalogItem?.deliveryCost || 0),
    extraCost: Number(data.get("extraCost") || catalogItem?.extraCost || 0),
    installerPrice: Number(data.get("installerPrice") ?? catalogItem?.installerPrice ?? currentItem?.installerPrice ?? 0),
    wholesalePrice: Number(data.get("wholesalePrice") ?? catalogItem?.wholesalePrice ?? currentItem?.wholesalePrice ?? 0),
    retailPrice,
    salePrice: retailPrice,
    minQty: Number(data.get("minQty") || catalogItem?.minQty || 0),
    location: String(data.get("location") || catalogItem?.location || "").trim(),
    serialNumber: String(data.get("serialNumber") || catalogItem?.serialNumber || "").trim(),
    supplier: String(data.get("supplier") || catalogItem?.supplier || "").trim(),
    characteristics: String(data.get("characteristics") || catalogItem?.characteristics || "").trim(),
  };
}

function addWarehouseItem(formElement) {
  const data = new FormData(formElement);
  const currentItem = Number.isInteger(editingWarehouseIndex) ? warehouseItems[editingWarehouseIndex] : null;
  const catalogItem = data.get("catalogItem") && data.get("catalogItem") !== "__new" ? warehouseItemById(data.get("catalogItem")) : null;
  const nextItem = warehouseItemFromForm(formElement, currentItem);
  if (!nextItem.name) return;
  if (currentItem) {
    warehouseItems[editingWarehouseIndex] = nextItem;
    editingWarehouseIndex = null;
  } else if (catalogItem) {
    Object.assign(catalogItem, {
      ...nextItem,
      id: catalogItem.id,
      qty: Number(catalogItem.qty || 0) + Number(nextItem.qty || 0),
    });
  } else {
    warehouseItems.unshift(nextItem);
  }
  selectedWarehouseSection = warehouseSectionForCategory(nextItem.category);
  if (!currentItem) {
    warehouseMovements.unshift({
      id: `wm-${Date.now()}`,
      type: "purchase",
      itemId: nextItem.id,
      itemName: nextItem.name,
      qty: Number(nextItem.qty || 0),
      unit: nextItem.unit || "шт",
      unitCost: warehouseUnitCost(nextItem),
      supplier: nextItem.supplier || "",
      note: "Прихід на склад",
      createdAt: new Date().toISOString(),
    });
    saveWarehouseMovements();
  }
  saveWarehouseItems();
  formElement.reset();
  render();
  showSection("warehouse");
}

function addWarehouseMovement(formElement) {
  if (!window.SPARTA_LOCAL_WORKSPACE?.enabled) {
    const data = new FormData(formElement);
    showSection("warehouse");
    window.SpartaWarehouseUI?.openForProject(data.get("movementType") || "project", { projectId: data.get("projectId") || "", itemId: data.get("itemId") || "" });
    return;
  }
  const data = new FormData(formElement);
  const item = warehouseItemById(data.get("itemId"));
  if (!item) return;
  const qty = Number(data.get("qty") || 0);
  if (!Number.isFinite(qty) || qty <= 0) return;
  const type = data.get("movementType") || "project";
  if (!["project", "sale", "return"].includes(type)) {
    alert("Непідтримуваний тип складського руху.");
    return;
  }
  if (type !== "return" && qty > Number(item.qty || 0)) {
    alert(`На складі доступно тільки ${item.qty} ${item.unit}.`);
    return;
  }
  if (type !== "return" && window.SPARTA_LOCAL_WORKSPACE?.enabled && window.SpartaWarehouseCore) {
    const reservations = readJsonStorage("solarObjectManager.warehouseWorkspace.v31", {})?.reservations || [];
    const available = window.SpartaWarehouseCore.availableQty(item, reservations, type === "project" ? data.get("projectId") : undefined, window.SpartaWarehouseCloud?.snapshot()?.orderReservations);
    if (qty > available) {
      alert(`Вільного залишку тільки ${available} ${item.unit}. Решта зарезервована під інші об’єкти.`);
      return;
    }
  }
  const projectId = data.get("projectId") || "";
  let targetProject = null;
  let unitCost = warehouseUnitCost(item);
  if (type === "project" || type === "return") {
    targetProject = projects.find((itemProject) => normalizeProjectId(itemProject.id) === normalizeProjectId(projectId));
    if (!targetProject || (type === "project" && isClosedProjectStatus(targetProject.status))) {
      alert("Для переміщення вибери активний об'єкт. Завершені об'єкти у списку не показуються.");
      return;
    }
  }
  if (type === "return") {
    const material = (targetProject.materials || []).find((entry) => warehouseItemForMaterial(entry)?.id === item.id);
    const issued = Number(material?.issuedQty ?? material?.actualQty ?? 0);
    if (!material || qty > issued) {
      alert(`На об'єкті доступно для повернення тільки ${issued} ${item.unit}.`);
      return;
    }
    unitCost = Number(material.purchasePriceSnapshot ?? unitCost);
    material.issuedQty = Math.max(0, issued - qty);
    material.actualQty = Math.min(material.issuedQty, Math.max(0, Number(material.actualQty ?? issued)));
    item.qty = Number(item.qty || 0) + qty;
  } else {
    item.qty = Number(item.qty || 0) - qty;
    if (targetProject) addWarehouseItemToProjectMaterials(targetProject, item, qty);
  }
  warehouseMovements.unshift({
    id: `wm-${crypto.randomUUID()}`,
    type,
    itemId: item.id,
    itemName: item.name,
    projectId: targetProject ? projectId : "",
    customer: type === "sale" ? String(data.get("customer") || "").trim() : "",
    qty,
    unit: item.unit || "шт",
    unitCost,
    salePrice: Number(data.get("salePrice") || 0),
    supplier: item.supplier || "",
    note: String(data.get("note") || "").trim(),
    createdAt: new Date().toISOString(),
  });
  if (type === "project" && window.SPARTA_LOCAL_WORKSPACE?.enabled && window.SpartaWarehouseCore) {
    const workspace = readJsonStorage("solarObjectManager.warehouseWorkspace.v31", {}) || {};
    workspace.reservations = window.SpartaWarehouseCore.consumeReservation(workspace.reservations || [], item.id, projectId, qty);
    writeLocalStorage("solarObjectManager.warehouseWorkspace.v31", JSON.stringify(workspace));
  }
  saveWarehouseMovements();
  if (targetProject) saveProjects();
  saveWarehouseItems();
  formElement.reset();
  render();
  showSection("warehouse");
}

function saveProjectFinance(formElement) {
  if (!requireProjectRole("finance")) return;
  const project = selectedProject();
  if (!project) return;
  const data = new FormData(formElement);
  if (data.get("contractNumber") !== null) project.contractNumber = String(data.get("contractNumber") || "").trim();
  if (data.get("contractDate") !== null) project.contractDate = String(data.get("contractDate") || "");
  project.finance = normalizeProjectFinance({
    ...project.finance,
    contractNumber: data.get("contractNumber") !== null ? project.contractNumber : project.finance?.contractNumber ?? project.contractNumber ?? "",
    contractDate: data.get("contractDate") !== null ? project.contractDate : project.finance?.contractDate ?? project.contractDate ?? "",
    contractPrice: Number(data.get("contractPrice") || 0),
    installationPrice: Number(data.get("installationPrice") || 0),
    advancePaid: Number(project.finance?.advancePaid || 0),
    crewPayroll: Number(data.get("crewPayroll") || 0),
  });
  saveProjects();
  render();
  showSection("objectDetail");
}

function fillCommercialOfferPrices(formElement) {
  if (!formElement) return;
  const item = warehouseItemById(formElement.elements.warehouseItemId?.value);
  if (!item) return;
  const selectedName = formElement.querySelector("#commercialOfferSelectedName");
  if (selectedName) selectedName.textContent = item.name || "";
  formElement.elements.purchasePrice.value = Number(warehouseUnitCost(item) || 0);
  formElement.elements.salePrice.value = Number(item.retailPrice || item.installerPrice || item.salePrice || 0);
}

function addCommercialOfferLine(formElement) {
  if (!requireProjectRole("finance")) return;
  const project = selectedProject();
  if (!project) return;
  const data = new FormData(formElement);
  const item = warehouseItemById(data.get("warehouseItemId"));
  if (!item) return;

  project.finance = normalizeProjectFinance(project.finance);
  if ((project.currency || "UAH") !== (item.currency || "UAH")) { window.alert("Оберіть обладнання у валюті об’єкта: " + (project.currency || "UAH")); return; }
  project.finance.offerLines.push({
    currency: project.currency || "UAH",
    id: `offer-${Date.now()}`,
    warehouseItemId: item.id,
    category: item.category || "Інше",
    name: item.name || "",
    qty: Number(data.get("qty") || 0),
    unit: item.unit || "шт",
    purchasePrice: Number(data.get("purchasePrice") || warehouseUnitCost(item) || 0),
    salePrice: Number(data.get("salePrice") || item.retailPrice || item.installerPrice || item.salePrice || 0),
    note: String(data.get("note") || item.characteristics || "").trim(),
  });
  syncCommercialOfferContractPrice(project);
  saveProjects();
  formElement.reset();
  fillCommercialOfferPrices(formElement);
  render();
  showSection("objectDetail");
}

function saveCommercialOfferTotals(formElement) {
  if (!requireProjectRole("finance")) return;
  const project = selectedProject();
  if (!project) return;
  const data = new FormData(formElement);
  project.finance = normalizeProjectFinance({
    ...project.finance,
    installationPrice: Number(data.get("installationPrice") || 0),
    crewPayroll: Number(data.get("crewPayroll") || 0),
  });
  syncCommercialOfferContractPrice(project);
  saveProjects();
  render();
  showSection("objectDetail");
}

function syncCommercialOfferContractPrice(project) {
  const totals = offerLineTotals(project);
  project.finance = normalizeProjectFinance({
    ...project.finance,
    contractPrice: totals.totalSale,
  });
}

function addProjectExpense(formElement) {
  if (!requireProjectRole("finance")) return;
  const project = selectedProject();
  if (!project) return;
  const data = new FormData(formElement);
  project.finance = normalizeProjectFinance(project.finance);
  project.finance.expenses.push({
    name: String(data.get("name") || "").trim(),
    amount: Number(data.get("amount") || 0),
  });
  saveProjects();
  formElement.reset();
  render();
  showSection("objectDetail");
}

function addMaterial(formElement) {
  if (!requireProjectRole()) return;
  const project = selectedProject();
  if (!project) return;

  const data = new FormData(formElement);
  const materialName = data.get("name").trim() || data.get("catalogMaterial");
  project.materials.push({
    currency: project.currency || "UAH",
    name: materialName,
    category: data.get("category"),
    actualQty: window.SPARTA_LOCAL_WORKSPACE?.enabled ? Number(data.get("actualQty") || 0) : 0,
    plannedQty: Number(data.get("actualQty") || 0),
    issuedQty: window.SPARTA_LOCAL_WORKSPACE?.enabled ? Number(data.get("actualQty") || 0) : 0,
    unit: data.get("unit").trim(),
  });

  saveProjects();
  formElement.reset();
  render();
}

async function uploadPhotoToCloud(project, file) {
  if (!canEditProjectField()) throw new Error("Для цієї ролі завантаження файлів об’єкта недоступне.");
  if (!cloudMediaContext() || !cloudState.client) throw new Error("Для завантаження фото увійдіть в акаунт компанії.");
  const scope = cloudMediaContext();

  const extension = file.name.split(".").pop() || "jpg";
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
  const path = `${cloudState.companyId}/${normalizeProjectId(project.id)}/${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExtension}`;
  const { error } = await cloudState.client.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/jpeg",
    });

  if (error) throw error;
  if (scope !== cloudMediaContext()) throw new Error("Обліковий запис змінився. Завантажте фото повторно.");

  return {
    storagePath: path,
    src: await signedCloudStorageUrl(PHOTO_BUCKET, path),
  };
}

async function uploadProjectFileToCloud(project, file) {
  if (!canEditProjectField()) throw new Error("Для цієї ролі завантаження файлів об’єкта недоступне.");
  if (!cloudMediaContext() || !cloudState.client) throw new Error("Для завантаження файлу увійдіть в акаунт компанії.");
  const scope = cloudMediaContext();

  const extension = file.name.split(".").pop() || "bin";
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const path = `${cloudState.companyId}/${normalizeProjectId(project.id)}/${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExtension}`;
  const { error } = await cloudState.client.storage
    .from(PROJECT_FILE_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });

  if (error) throw error;
  if (scope !== cloudMediaContext()) throw new Error("Обліковий запис змінився. Завантажте файл повторно.");

  return {
    storagePath: path,
    src: "",
  };
}

function addPhoto(formElement) {
  const data = new FormData(formElement);
  const file = data.get("file");
  addProjectPhotoFromFile(file, data.get("category"), data.get("caption").trim(), () => formElement.reset());
}

function addEquipmentPhoto(file, type, equipmentId) {
  const project = selectedProject();
  if (!project) return Promise.resolve(false);
  normalizeTechnicalEquipment(project.technical);
  const config = equipmentTypeConfig(type);
  const item = (project.technical[type] || []).find((equipment) => equipment.id === equipmentId);
  const caption = item ? `${config.photoLabel}: ${formatCombined(item.manufacturer, item.model)}` : config.photoLabel;
  return addProjectPhotoFromFile(file, config.photoLabel, caption, null, {
    equipmentType: type,
    equipmentId,
  });
}

function addProjectPhotoFromFile(file, category, caption, afterAdd = null, extra = {}) {
  if (!requireProjectRole("field")) return Promise.resolve(false);
  const project = selectedProject();
  if (!project || !file || !file.type?.startsWith("image/")) return Promise.resolve(false);

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", async () => {
      const scope = cloudMediaContext();
      const photo = {
        category,
        caption,
        fileName: file.name,
        src: reader.result,
        createdAt: new Date().toISOString(),
        ...extra,
      };

      if (!window.SPARTA_LOCAL_WORKSPACE?.enabled) {
        try {
          cloudState.message = "Фото завантажується...";
          renderProfileView();
          const uploaded = await uploadPhotoToCloud(project, file);
          if (scope !== cloudMediaContext()) { resolve(false); return; }
          Object.assign(photo, uploaded);
        } catch (error) {
          cloudState.message = `Фото не завантажено: ${error.message}`;
          renderProfileView();
          alert(cloudState.message);
          resolve(false);
          return;
        }
      }

      project.photos.push(photo);
      saveProjects();
      afterAdd?.();
      render();
      resolve(true);
    });
    reader.addEventListener("error", () => resolve(false));
    reader.readAsDataURL(file);
  });
}

function addEquipmentItem(formElement) {
  if (!requireProjectRole()) return;
  const project = selectedProject();
  if (!project) return;
  const type = formElement.dataset.equipmentType;
  const data = new FormData(formElement);
  normalizeTechnicalEquipment(project.technical);
  if (!Array.isArray(project.technical[type])) return;

  project.technical[type].push(normalizeEquipmentItem({
    manufacturer: String(data.get("manufacturer") || "").trim(),
    model: String(data.get("model") || "").trim(),
    power: String(data.get("power") || "").trim(),
    count: Number(data.get("count") || 1),
    serialNumbers: String(data.get("serialNumbers") || "").trim(),
  }, type));
  syncLegacyTechnicalFields(project.technical);
  saveProjects();
  formElement.reset();
  render();
  showSection("objectDetail");
}

function syncLegacyTechnicalFields(technical) {
  const [panel] = technical.panelGroups || [];
  const [inverter] = technical.inverters || [];
  const [battery] = technical.batteries || [];

  if (panel) {
    technical.panelManufacturer = panel.manufacturer || "";
    technical.panelModel = panel.model || "";
    technical.panelPowerW = Number(panel.power || 0);
    technical.panelCount = Number(panel.count || 0);
    technical.panelSerialNumbers = panel.serialNumbers || "";
  } else {
    technical.panelManufacturer = "";
    technical.panelModel = "";
    technical.panelPowerW = 0;
    technical.panelCount = 0;
    technical.panelSerialNumbers = "";
  }
  if (inverter) {
    technical.inverterManufacturer = inverter.manufacturer || "";
    technical.inverterModel = inverter.model || "";
    technical.inverterPowerKw = Number(inverter.power || 0);
    technical.inverterSerialNumber = inverter.serialNumbers || "";
  } else {
    technical.inverterManufacturer = "";
    technical.inverterModel = "";
    technical.inverterPowerKw = 0;
    technical.inverterSerialNumber = "";
  }
  if (battery) {
    technical.batteryManufacturer = battery.manufacturer || "";
    technical.batteryModel = battery.model || "";
    technical.batteryCapacityKwh = Number(battery.power || 0);
    technical.batteryModulesCount = Number(battery.count || 0);
    technical.batterySerialNumbers = battery.serialNumbers || "";
    technical.hasBattery = Boolean(battery.manufacturer || battery.model || battery.serialNumbers || Number(battery.count || 0));
  } else {
    technical.batteryManufacturer = "";
    technical.batteryModel = "";
    technical.batteryCapacityKwh = 0;
    technical.batteryModulesCount = 0;
    technical.batterySerialNumbers = "";
    technical.hasBattery = false;
  }
}

function syncEquipmentListsFromLegacyFields(technical) {
  const existingPanel = (technical.panelGroups || [])[0];
  const existingInverter = (technical.inverters || [])[0];
  const existingBattery = (technical.batteries || [])[0];
  const panelFallback = technical.panelManufacturer || technical.panelModel || technical.panelSerialNumbers || Number(technical.panelCount || 0)
    ? {
      id: existingPanel?.id,
      manufacturer: technical.panelManufacturer,
      model: technical.panelModel,
      power: technical.panelPowerW,
      count: technical.panelCount || 1,
      serialNumbers: technical.panelSerialNumbers,
    }
    : null;
  const inverterFallback = technical.inverterManufacturer || technical.inverterModel || technical.inverterSerialNumber || Number(technical.inverterPowerKw || 0)
    ? {
      id: existingInverter?.id,
      manufacturer: technical.inverterManufacturer,
      model: technical.inverterModel,
      power: technical.inverterPowerKw,
      serialNumbers: technical.inverterSerialNumber,
    }
    : null;
  const batteryFallback = technical.batteryManufacturer || technical.batteryModel || technical.batterySerialNumbers || Number(technical.batteryModulesCount || 0)
    ? {
      id: existingBattery?.id,
      manufacturer: technical.batteryManufacturer,
      model: technical.batteryModel,
      power: technical.batteryCapacityKwh,
      count: technical.batteryModulesCount || 1,
      serialNumbers: technical.batterySerialNumbers,
    }
    : null;

  if ((technical.panelGroups || []).length <= 1) technical.panelGroups = panelFallback ? [normalizeEquipmentItem(panelFallback, "panel")] : [];
  if ((technical.inverters || []).length <= 1) technical.inverters = inverterFallback ? [normalizeEquipmentItem(inverterFallback, "inverter")] : [];
  if ((technical.batteries || []).length <= 1) technical.batteries = batteryFallback ? [normalizeEquipmentItem(batteryFallback, "battery")] : [];
}

async function openProjectFile(file) {
  if (!file) return;
  const cloudUrl = file.storagePath
    ? await signedCloudStorageUrl(PROJECT_FILE_BUCKET, file.storagePath, true)
    : window.SPARTA_LOCAL_WORKSPACE?.enabled ? file.src || "" : "";
  if (cloudUrl) {
    const link = document.createElement("a");
    link.href = cloudUrl;
    link.download = file.fileName || "file";
    link.target = "_blank";
    link.click();
    return;
  }

  const blob = await getProjectFileBlob(file.fileKey);
  if (!blob) throw new Error("файл не знайдено у локальному сховищі");
  const url = URL.createObjectURL(blob);
  if (window.SPARTA_LOCAL_WORKSPACE?.enabled && (blob.type === "application/pdf" || blob.type.startsWith("image/"))) {
    const preview = document.createElement("dialog");
    preview.className = "local-file-preview";
    preview.setAttribute("aria-label", `Перегляд: ${file.fileName}`);
    const header = document.createElement("header");
    const title = document.createElement("h2"); title.textContent = file.fileName;
    const close = document.createElement("button"); close.type = "button"; close.className = "secondary-button"; close.textContent = "Закрити";
    close.addEventListener("click", () => preview.close());
    header.append(title, close); preview.append(header);
    const viewer = document.createElement(blob.type.startsWith("image/") ? "img" : "p");
    if (viewer.tagName === "IMG") {
      viewer.src = url;
      viewer.alt = file.note || file.fileName;
    } else viewer.textContent = "PDF збережено. Цей браузер не підтримує вбудований перегляд — завантажте файл, щоб відкрити його у PDF-переглядачі.";
    preview.append(viewer);
    const save = document.createElement("a"); save.href = url; save.download = file.fileName; save.textContent = "Завантажити файл"; save.className = "secondary-button";
    preview.append(save);
    preview.addEventListener("close", () => { URL.revokeObjectURL(url); preview.remove(); }, { once: true });
    document.body.append(preview); preview.showModal();
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName || "file";
  link.target = "_blank";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function addProjectFile(formElement) {
  if (!requireProjectRole("field")) return;
  const project = selectedProject();
  if (!project) return;

  const data = new FormData(formElement);
  const file = data.get("file");
  if (!file || !file.name) return;

  const fileKey = `${normalizeProjectId(project.id)}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const scope = cloudMediaContext();
  let uploaded = null;
  if (!window.SPARTA_LOCAL_WORKSPACE?.enabled) {
    try {
      cloudState.message = "Файл завантажується...";
      renderProfileView();
      uploaded = await uploadProjectFileToCloud(project, file);
      if (scope !== cloudMediaContext()) return;
    } catch (error) {
      cloudState.message = `Файл не завантажено: ${error.message}`;
      renderProfileView();
      alert(cloudState.message);
      return;
    }
  }

  if (!uploaded) {
    try {
      await putProjectFileBlob(fileKey, file);
    } catch (error) {
      alert(`Файл не вдалося зберегти локально: ${error.message}`);
      return;
    }
  }

  project.files.push({
    category: data.get("category") || "other",
    note: String(data.get("note") || "").trim(),
    fileName: file.name,
    type: file.type || "application/octet-stream",
    size: file.size || 0,
    fileKey: uploaded ? "" : fileKey,
    storagePath: uploaded?.storagePath || "",
    src: uploaded?.src || "",
    createdAt: new Date().toISOString(),
  });

  saveProjectFileMetadata(project);
  saveProjects();
  formElement.reset();
  render();
}

async function inviteUser(email, role, fullName = "") {
  return runInvitationEmailAction(email, async () => {
    if (!cloudState.ready || !["owner", "admin"].includes(cloudState.memberRole)) throw new Error("Запрошення створює власник або адміністратор.");
    const { data, error } = await cloudState.client.rpc("sparta_team_invite", { p_company_id: cloudState.companyId, p_email: String(email || "").trim().toLowerCase(), p_full_name: String(fullName || "").trim(), p_role: role || "installer" });
    if (error) throw error;
    const invitation = data.invitation || data;
    cloudState.message = "Запрошення збережено.";
    const delivery = await sendInvitationEmail(invitation.email || email, invitation.id);
    let message = `Запрошення збережено. ${delivery.message}`;
    try { await loadCompanyPeople(); await window.SpartaTeamAccess?.refresh(); }
    catch (_) { message += " Оновіть список запрошень, щоб перевірити його стан."; }
    cloudState.message = message;
    renderProfileView();
    return { ...invitation, delivery, message };
  });
}

function runInvitationEmailAction(email, action) {
  const userId = cloudState.user?.id, companyId = cloudState.companyId;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const key = `${userId || ""}:${companyId}:${normalizedEmail}`;
  if (invitationEmailTasks.has(key)) return invitationEmailTasks.get(key);
  const report = (state) => {
    if (cloudState.user?.id === userId && cloudState.companyId === companyId) {
      window.SpartaTeamAccess?.setInvitationDelivery?.(normalizedEmail, state);
    }
  };
  const task = Promise.resolve().then(async () => {
    report({ pending: true });
    try {
      const result = await action();
      report({ pending: false, ok: result.delivery.ok, message: result.message });
      return result;
    } catch (error) {
      report({ pending: false, ok: false, message: error?.message || "Не вдалося обробити запрошення. Спробуйте ще раз." });
      throw error;
    }
  }).finally(() => invitationEmailTasks.delete(key));
  invitationEmailTasks.set(key, task);
  return task;
}

async function sendInvitationEmail(email, invitationId) {
  return sendInvitationEmailByServer(email, getInvitationRedirectUrl(), invitationId);
}

async function sendInvitationEmailByServer(email, redirectTo, invitationId) {
  if (window.SPARTA_LOCAL_WORKSPACE?.enabled) return { handled: true, ok: false, message: "Запрошення доступні у публічній версії." };
  try {
    const { data } = await cloudState.client.auth.getSession();
    if (!data?.session?.access_token) return { handled: true, ok: false, message: "Увійдіть повторно перед надсиланням листа." };
    const response = await fetch("/api/send-invitation", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ companyId: cloudState.companyId, invitationId, email }) });
    const payload = await response.json().catch(() => ({}));
    const message = payload?.message || payload?.error || (response.ok ? "Сервер прийняв запит на надсилання листа." : "Лист не надіслано. Запрошення збережене; перевірте поштові налаштування.");
    return { handled: true, ok: response.ok, message: payload?.warning ? `${message} ${payload.warning}` : message };
  } catch (_) { return { handled: true, ok: false, message: "Не вдалося зв’язатися із сервером. Запрошення збережене, лист можна надіслати повторно." }; }
}

function getInvitationRedirectUrl() {
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return PUBLIC_APP_URL;
  }
  return window.location.origin;
}

async function resendSignupConfirmation(email, redirectTo) {
  if (!cloudState.client?.auth?.resend) return false;
  const { error } = await cloudState.client.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: redirectTo,
    },
  });
  return !error;
}

async function resendInvitation(email) {
  return runInvitationEmailAction(email, async () => {
    const listedInvitation = (cloudState.invitations || []).find((item) => item.email === email);
    if (!listedInvitation) { await loadCompanyPeople(); }
    const current = (cloudState.invitations || []).find((item) => item.email === email);
    if (!current) throw new Error("Запрошення не знайдено.");
    const { data, error } = await cloudState.client.rpc("sparta_team_invite", { p_company_id: cloudState.companyId, p_email: email, p_full_name: current.full_name || "", p_role: current.role });
    if (error) throw error;
    const invitation = data.invitation || data;
    cloudState.message = "Запрошення поновлено.";
    const delivery = await sendInvitationEmail(email, invitation.id);
    let message = `Запрошення поновлено. ${delivery.message}`;
    try { await loadCompanyPeople(); await window.SpartaTeamAccess?.refresh(); }
    catch (_) { message += " Оновіть список запрошень, щоб перевірити його стан."; }
    cloudState.message = message;
    renderProfileView();
    return { ...invitation, delivery, message };
  });
}

async function cancelInvitation(email) {
  const invitation = (cloudState.invitations || []).find((item) => item.email === email);
  if (!invitation) return;
  const { error } = await cloudState.client.rpc("sparta_team_revoke_invitation", { p_company_id: cloudState.companyId, p_invitation_id: invitation.id });
  if (error) throw error;
  await loadCompanyPeople(); await window.SpartaTeamAccess?.refresh(); renderProfileView();
}

async function removeCompanyMember(userId) {
  const member = (cloudState.members || []).find((item) => item.user_id === userId);
  if (!member) return;
  const { error } = await cloudState.client.rpc("sparta_team_update_member", { p_company_id: cloudState.companyId, p_user_id: userId, p_role: member.role, p_is_active: false });
  if (error) throw error;
  await loadCompanyPeople(); await window.SpartaTeamAccess?.refresh(); renderProfileView();
}

async function logoutCloudUser() {
  const client = cloudState.client;
  try { await window.SpartaAuthFlow?.recordSession("logout"); } catch (_) { /* Offline logout must still be allowed. */ }
  clearCompanyContext(); cloudState.user = null; cloudState.message = "Вихід з акаунта..."; updateAccessMode(); render();
  const { error } = await (client?.auth.signOut() || Promise.resolve({}));
  cloudState.message = error ? "Не вдалося завершити вихід. Оновіть сторінку й повторіть спробу." : "Користувач вийшов з акаунта.";
  updateAccessMode(); render();
}

async function authenticateUser(email, password, mode, messageTarget, fullName = "") {
  if (!cloudState.client) {
    messageTarget.textContent = "Supabase не налаштовано.";
    return false;
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const passwordValue = String(password || "");
  const authModeValue = mode === "signup" ? "signup" : "signin";
  messageTarget.textContent = authModeValue === "signup" ? "Створюю акаунт..." : "Вхід...";

  const authRequest = authModeValue === "signup"
    ? cloudState.client.auth.signUp({
        email: normalizedEmail,
        password: passwordValue,
        options: {
          emailRedirectTo: PUBLIC_APP_URL + "?auth=signup",
          data: {
            full_name: String(fullName || normalizedEmail.split("@")[0]).trim(),
          },
        },
      })
    : cloudState.client.auth.signInWithPassword({
        email: normalizedEmail,
        password: passwordValue,
      });

  const { data: authData, error } = await authRequest;

  if (error) {
    messageTarget.textContent = window.SpartaAuthFlow?.authError(error) || error.message;
    return false;
  }

  if (authModeValue === "signup" && !authData.session) {
    messageTarget.textContent = "Акаунт створено. Перевір email, підтверди реєстрацію і увійди.";
    return false;
  }

  const ready = await applyCloudSession(authData.session || { user: authData.user });
  if (!ready) messageTarget.textContent = cloudState.message;
  return ready;
}

async function changeCurrentUserPassword(password, passwordConfirm) {
  if (!cloudState.client || !cloudState.user) {
    passwordMessage.textContent = "Спочатку увійди в акаунт.";
    return false;
  }

  const nextPassword = String(password || "");
  const repeatedPassword = String(passwordConfirm || "");
  if (nextPassword.length < 8) {
    passwordMessage.textContent = "Пароль має містити щонайменше 8 символів.";
    return false;
  }
  if (nextPassword !== repeatedPassword) {
    passwordMessage.textContent = "Паролі не співпадають.";
    return false;
  }

  passwordMessage.textContent = "Оновлюю пароль...";
  const { error } = await cloudState.client.auth.updateUser({ password: nextPassword });
  if (error) {
    passwordMessage.textContent = window.SpartaAuthFlow?.authError(error) || "Не вдалося змінити пароль. Спробуйте ще раз.";
    return false;
  }

  window.SpartaAuthFlow?.passwordCompleted();
  cloudState.message = "Пароль оновлено.";
  renderProfileView();
  return true;
}

searchInput.addEventListener("input", renderProjectList);
statusFilter.addEventListener("change", renderProjectList);

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.closest("dialog")?.close();
  });
});

document.querySelector("#newProjectButton").addEventListener("click", () => {
  if (!requireProjectRole()) return;
  form.reset();
  dialog.showModal();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(authForm);
  const success = await authenticateUser(data.get("email"), data.get("password"), data.get("authMode") || authMode, authMessage);
  if (success) {
    authDialog.close();
  } else if ((data.get("authMode") || authMode) === "signup") {
    setAuthMode("signin");
  }
});

gateAuthForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(gateAuthForm);
  await window.SpartaAuthFlow.submitGate(gateAuthForm);
});

async function submitInvitationForm(event) {
  event.preventDefault();
  if (invitationFormBusy) return;
  if (!inviteForm.reportValidity()) return;
  const data = new FormData(inviteForm);
  const submit = inviteForm.querySelector("button[type='submit']");
  const label = submit?.textContent;
  invitationFormBusy = true;
  if (submit) { submit.disabled = true; submit.textContent = "Зберігаю…"; }
  try {
    inviteMessage.textContent = "Зберігаю запрошення...";
    const result = await inviteUser(data.get("email"), data.get("role"), data.get("fullName"));
    if (result.delivery.ok) inviteDialog.close();
    else inviteMessage.textContent = result.message;
  } catch (error) { inviteMessage.textContent = error?.message || "Не вдалося обробити запрошення. Спробуйте ще раз."; }
  finally {
    invitationFormBusy = false;
    if (submit) { submit.disabled = false; submit.textContent = label; }
  }
}
inviteForm.addEventListener("submit", submitInvitationForm);

async function submitPasswordForm(event) {
  event.preventDefault();
  if (passwordFormBusy || !passwordForm.reportValidity()) return;
  const data = new FormData(passwordForm);
  const submit = passwordForm.querySelector("button[type='submit']");
  const label = submit?.textContent;
  passwordFormBusy = true;
  if (submit) { submit.disabled = true; submit.textContent = "Зберігаю…"; }
  try {
    const success = await changeCurrentUserPassword(data.get("password"), data.get("passwordConfirm"));
    if (success) { passwordForm.reset(); passwordDialog.close(); }
  } catch (error) {
    passwordMessage.textContent = window.SpartaAuthFlow?.authError(error) || "Не вдалося зберегти пароль. Перевірте з’єднання та повторіть спробу.";
  } finally {
    passwordFormBusy = false;
    if (submit) { submit.disabled = false; submit.textContent = label; }
  }
}
passwordForm.addEventListener("submit", submitPasswordForm);

crmTaskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!crmTaskForm.reportValidity()) return;
  saveCrmTaskFromForm();
  crmTaskDialog.close();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireProjectRole()) return;
  const data = new FormData(form);
  const nextProject = {
    id: normalizeProjectId(Date.now()),
    currency: String(data.get("currency") || "USD"),
    title: data.get("title"),
    clientName: data.get("clientName"),
    clientPhone: data.get("clientPhone"),
    address: data.get("address"),
    objectType: data.get("objectType"),
    status: data.get("status"),
    installationDate: data.get("installationDate"),
    teamName: data.get("teamName"),
    comment: data.get("comment"),
    technical: {
      panelManufacturer: "",
      panelModel: "Не заповнено",
      panelSerialNumbers: "",
      panelPowerW: 0,
      panelCount: 0,
      inverterManufacturer: "",
      inverterModel: "Не заповнено",
      inverterPowerKw: Number(data.get("estimatedPower") || 0),
      inverterSerialNumber: "",
      mpptCount: 0,
      pvInputsPerMppt: 0,
      hasBattery: false,
      batteryManufacturer: "",
      batteryModel: "",
      batteryCapacityKwh: 0,
      batteryModulesCount: 0,
      batterySerialNumbers: "",
      mountType: "",
      roofType: "",
      panelOrientation: "",
      tiltAngle: 0,
    },
    strings: [],
    materials: [],
    photos: [],
    files: [],
    finance: emptyProjectFinance(),
    workChecklist: emptyInstallerChecklist(),
  };

  projects.unshift(nextProject);
  saveProjects();
  selectedProjectId = normalizeProjectId(nextProject.id);
  selectedTab = nextProject.status || "new";
  dialog.close();
  render();
  showSection("objectDetail");
});

projectInfoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireProjectRole()) return;
  const project = selectedProject();
  if (!project) return;

  const data = new FormData(projectInfoForm);
  project.title = data.get("title").trim();
  project.clientName = data.get("clientName").trim();
  project.clientPhone = data.get("clientPhone").trim();
  project.address = data.get("address").trim();
  project.objectType = data.get("objectType");
  project.installationDate = data.get("installationDate");
  project.teamName = data.get("teamName").trim();
  project.comment = data.get("comment").trim();

  saveProjects();
  projectInfoDialog.close();
  render();
  showSection("objectDetail");
});

function deleteSelectedProject() {
  if (!requireProjectRole()) return;
  const project = selectedProject();
  if (!project) return;

  const shouldDelete = confirm(`Ви точно хочете видалити об'єкт "${project.title}"? Цю дію не можна скасувати.`);
  if (!shouldDelete) return;

  const index = projects.findIndex((item) => item.id === project.id);
  if (index >= 0) {
    pendingCloudDeletes.push(normalizeProjectId(project.id));
    savePendingCloudDeletes();
    projects.splice(index, 1);
  }
  clearProjectFileMetadata(project.id);
  (project.files || []).forEach((file) => {
    if (file.fileKey) deleteProjectFileBlob(file.fileKey).catch(() => {});
  });

  selectedProjectId = projects[0]?.id ?? null;
  selectedTab = "";
  saveProjects();
  render();
  showSection("projects");
}

function saveStringEdits() {
  if (!requireProjectRole()) return;
  const project = selectedProject();
  if (!project) return;

  document.querySelectorAll(".string-edit-field").forEach((field) => {
    const index = Number(field.dataset.stringIndex);
    const key = field.dataset.stringField;
    if (!project.strings[index]) return;

    if (["pvInputNumber", "stringNumber", "panelCount", "tiltAngle"].includes(key)) {
      project.strings[index][key] = Number(field.value || 0);
    } else {
      project.strings[index][key] = field.value.trim();
    }
  });

  project.strings.sort((a, b) => a.mpptNumber - b.mpptNumber || Number(a.pvInputNumber || 1) - Number(b.pvInputNumber || 1) || a.stringNumber - b.stringNumber);
  stringsEditing = false;
  saveProjects();
  render();
}

function saveMaterialEdits() {
  if (!requireProjectRole()) return;
  const project = selectedProject();
  if (!project) return;

  document.querySelectorAll(".material-edit-field").forEach((field) => {
    const index = Number(field.dataset.materialIndex);
    const key = field.dataset.materialField;
    if (!project.materials[index]) return;
    if (!window.SPARTA_LOCAL_WORKSPACE?.enabled && ["issuedQty", "actualQty"].includes(key)) return;

    if (["plannedQty", "issuedQty", "actualQty"].includes(key)) {
      project.materials[index][key] = Number(field.value || 0);
    } else {
      project.materials[index][key] = field.value.trim();
    }
  });

  materialsEditing = false;
  saveProjects();
  render();
}

technicalForm.addEventListener("input", updateTechnicalPowerPreview);

panelManufacturerSelect.addEventListener("change", () => {
  if (panelManufacturerSelect.value === "custom") {
    const customValue = prompt("Введіть виробника фотомодулів");
    if (customValue && customValue.trim()) {
      const value = customValue.trim();
      const option = new Option(value, value);
      panelManufacturerSelect.add(option, panelManufacturerSelect.options[panelManufacturerSelect.options.length - 1]);
      panelManufacturerSelect.value = value;
    } else {
      panelManufacturerSelect.value = "";
    }
  }
});

technicalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireProjectRole()) return;
  const project = selectedProject();
  const data = new FormData(technicalForm);

  project.technical = {
    ...project.technical,
    panelManufacturer: data.get("panelManufacturer").trim(),
    panelModel: data.get("panelModel").trim(),
    panelSerialNumbers: data.get("panelSerialNumbers").trim(),
    panelPowerW: Number(data.get("panelPowerW") || 0),
    panelCount: Number(data.get("panelCount") || 0),
    inverterManufacturer: data.get("inverterManufacturer").trim(),
    inverterModel: data.get("inverterModel").trim(),
    inverterPowerKw: Number(data.get("inverterPowerKw") || 0),
    inverterSerialNumber: data.get("inverterSerialNumber").trim(),
    mpptCount: Number(data.get("mpptCount") || 0),
    pvInputsPerMppt: Number(data.get("pvInputsPerMppt") || 0),
    hasBattery: Boolean(data.get("batteryManufacturer") || data.get("batteryModel") || Number(data.get("batteryModulesCount") || 0)),
    batteryManufacturer: data.get("batteryManufacturer").trim(),
    batteryModel: data.get("batteryModel").trim(),
    batteryCapacityKwh: Number(data.get("batteryCapacityKwh") || 0),
    batteryModulesCount: Number(data.get("batteryModulesCount") || 0),
    batterySerialNumbers: data.get("batterySerialNumbers").trim(),
  };
  syncEquipmentListsFromLegacyFields(project.technical);

  saveProjects();
  technicalDialog.close();
  render();
});

async function initApp() {
  try {
    await window.SpartaWorkspaceMaintenance?.recover();
    await initCloud();
  } catch (error) {
    cloudState.message = `Supabase помилка: ${error.message}`;
  }
  if (window.spartaStorageWarning) {
    cloudState.message = window.spartaStorageWarning;
  }
  applyPortalMode(portalMode);
  updateAccessMode();
  render();
}

setupCrmDuePickerInputs();
initApp();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
window.setInterval(() => {
  renderCrmNotification();
  if (document.querySelector("#crm")?.classList.contains("active")) {
    renderCrmView();
  }
}, 60 * 1000);

// Availability refresh never submits orders and does not disturb an edited cart.
window.setInterval(() => {
  if (window.SpartaBuyerCloud?.isBuyerReady() && document.visibilityState !== "hidden") void window.SpartaBuyerUI?.refreshBuyer?.().catch(() => {});
}, 60000);
window.addEventListener("focus", () => {
  if (window.SpartaBuyerCloud?.isBuyerReady()) void window.SpartaBuyerUI?.refreshBuyer?.().catch(() => {});
});
