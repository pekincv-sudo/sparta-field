const statusLabels = {
  new: "Новий",
  planned: "Заплановано",
  in_progress: "В роботі",
  waiting_review: "Очікує перевірки",
  completed: "Завершено",
  passport_issued: "Паспорт видано",
};

const companyContacts = {
  name: "SPARTA power",
  phone: "+380 50 863 88 87",
  email: "sparta.power22@gmail.com",
  location: "Чернівці, вул. Миру 19, офіс 137",
};

const PHOTO_BUCKET = "project-photos";

const defaultProjects = [
  {
    id: 1,
    title: "СЕС Петренко",
    clientName: "Іван Петренко",
    clientPhone: "+380 67 123 45 67",
    address: "Київська область, м. Буча",
    objectType: "Приватний будинок",
    status: "in_progress",
    installationDate: "2026-05-31",
    teamName: "Бригада 1",
    comment: "Монтаж на металочерепиці, два скати даху.",
    technical: {
      panelManufacturer: "Longi",
      panelModel: "LR5-72HTH-580M",
      panelPowerW: 580,
      panelCount: 24,
      inverterManufacturer: "Deye",
      inverterModel: "SUN-12K-SG04LP3",
      inverterPowerKw: 12,
      inverterSerialNumber: "2309A-DEMO",
      mpptCount: 2,
      pvInputsPerMppt: 2,
      hasBattery: false,
      batteryManufacturer: "",
      batteryModel: "",
      batteryCapacityKwh: 0,
      batteryModulesCount: 0,
      batterySerialNumbers: "",
      mountType: "Дах",
      roofType: "Металочерепиця",
      panelOrientation: "Південь",
      tiltAngle: 30,
    },
    strings: [
      { mpptNumber: 1, pvInputNumber: 1, stringNumber: 1, panelCount: 12, orientation: "Південь", tiltAngle: 30, note: "Лівий скат" },
      { mpptNumber: 2, pvInputNumber: 1, stringNumber: 2, panelCount: 12, orientation: "Південь", tiltAngle: 30, note: "Правий скат" },
    ],
    materials: [
      { name: "Фотомодуль, 450W", category: "Панелі", plannedQty: 32, issuedQty: 32, actualQty: 32, unit: "шт" },
      { name: "Блок безпрофільної системи 250 мм", category: "Кріплення", plannedQty: 82, issuedQty: 82, actualQty: 82, unit: "шт" },
      { name: "Заклепка пелюсткова", category: "Кріплення", plannedQty: 328, issuedQty: 328, actualQty: 328, unit: "шт" },
      { name: "Притиск торцевий", category: "Кріплення", plannedQty: 36, issuedQty: 36, actualQty: 36, unit: "шт" },
      { name: "Притиск міжпанельний", category: "Кріплення", plannedQty: 46, issuedQty: 46, actualQty: 46, unit: "шт" },
      { name: "Конектор JA Solar, 1500 B", category: "Конектори", plannedQty: 4, issuedQty: 4, actualQty: 4, unit: "шт" },
      { name: "Сонячний кабель KBE DB, 6 мм2", category: "Кабель", plannedQty: 200, issuedQty: 200, actualQty: 200, unit: "м" },
      { name: "Монтаж фотомодулів", category: "Витратні матеріали", plannedQty: 14.4, issuedQty: 14.4, actualQty: 14.4, unit: "кВт" },
      { name: "Електрозахист DC", category: "Захист DC", plannedQty: 1, issuedQty: 1, actualQty: 1, unit: "шт" },
      { name: "Заземлення", category: "Заземлення", plannedQty: 1, issuedQty: 1, actualQty: 1, unit: "компл" },
    ],
    photos: ["Дах до монтажу", "Панелі", "Інвертор", "Готовий об'єкт"],
  },
  {
    id: 2,
    title: "СТО Київ 30 кВт",
    clientName: "ТОВ Авто-Сервіс",
    clientPhone: "+380 50 888 10 20",
    address: "м. Київ, вул. Промислова",
    objectType: "Комерційний об'єкт",
    status: "planned",
    installationDate: "2026-06-08",
    teamName: "Бригада 2",
    comment: "Потрібна перевірка доступу до даху.",
    technical: {
      panelManufacturer: "Jinko",
      panelModel: "Tiger Neo 575W",
      panelPowerW: 575,
      panelCount: 52,
      inverterManufacturer: "Huawei",
      inverterModel: "SUN2000-30KTL",
      inverterPowerKw: 30,
      inverterSerialNumber: "",
      mpptCount: 4,
      pvInputsPerMppt: 2,
      hasBattery: false,
      batteryManufacturer: "",
      batteryModel: "",
      batteryCapacityKwh: 0,
      batteryModulesCount: 0,
      batterySerialNumbers: "",
      mountType: "Дах",
      roofType: "Профнастил",
      panelOrientation: "Схід-Захід",
      tiltAngle: 15,
    },
    strings: [
      { mpptNumber: 1, pvInputNumber: 1, stringNumber: 1, panelCount: 13, orientation: "Схід", tiltAngle: 15, note: "" },
      { mpptNumber: 2, pvInputNumber: 1, stringNumber: 2, panelCount: 13, orientation: "Захід", tiltAngle: 15, note: "" },
    ],
    materials: [
      { name: "Панель Jinko 575W", category: "Обладнання", plannedQty: 52, issuedQty: 0, actualQty: 0, unit: "шт" },
      { name: "Інвертор Huawei 30K", category: "Обладнання", plannedQty: 1, issuedQty: 0, actualQty: 0, unit: "шт" },
    ],
    photos: [],
  },
];

const hasCloudConfig = Boolean(
  window.SPARTA_SUPABASE_CONFIG?.url &&
    window.SPARTA_SUPABASE_CONFIG?.anonKey &&
    !window.SPARTA_SUPABASE_CONFIG.url.includes("YOUR_PROJECT_URL") &&
    !window.SPARTA_SUPABASE_CONFIG.anonKey.includes("YOUR_SUPABASE_ANON_KEY")
);
const savedProjects = hasCloudConfig ? null : localStorage.getItem("solarObjectManager.projects");
let projects = savedProjects ? JSON.parse(savedProjects) : hasCloudConfig ? [] : defaultProjects;

let selectedProjectId = String(projects[0]?.id ?? "");
let selectedTab = "summary";
let stringsEditing = false;
let materialsEditing = false;
let authMode = "signin";
let cloudSyncTimer = null;
let cloudLoading = false;
let pendingCloudDeletes = JSON.parse(localStorage.getItem("solarObjectManager.pendingDeletes") || "[]");

const cloudState = {
  client: null,
  user: null,
  companyId: null,
  memberRole: null,
  enabled: false,
  ready: false,
  message: "Локальний режим",
  members: [],
  invitations: [],
};

function clearCompanyContext() {
  cloudState.companyId = supabaseConfig()?.companyId || null;
  cloudState.memberRole = null;
  cloudState.ready = false;
  cloudState.members = [];
  cloudState.invitations = [];
}

const projectList = document.querySelector("#projectList");
const projectDetail = document.querySelector("#projectDetail");
const passportPreview = document.querySelector("#passportPreview");
const statsGrid = document.querySelector("#statsGrid");
const homeView = document.querySelector("#homeView");
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

function saveProjects() {
  localStorage.setItem("solarObjectManager.projects", JSON.stringify(projects));
  queueCloudSync();
}

function savePendingCloudDeletes() {
  localStorage.setItem("solarObjectManager.pendingDeletes", JSON.stringify(pendingCloudDeletes));
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

function updateAccessMode() {
  const locked = cloudState.enabled && !cloudState.user;
  document.body.classList.toggle("auth-locked", locked);
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

function projectToDb(project) {
  return {
    client_id: normalizeProjectId(project.id),
    company_id: cloudState.companyId,
    title: project.title || "",
    client_name: project.clientName || "",
    client_phone: project.clientPhone || "",
    address: project.address || "",
    object_type: project.objectType || "",
    status: project.status || "new",
    installation_date: project.installationDate || null,
    team_name: project.teamName || "",
    comment: project.comment || "",
    created_by: cloudState.user?.id || null,
  };
}

function technicalToDb(project) {
  const technical = project.technical || {};
  return {
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
}

function publicPhotoUrl(storagePath) {
  if (!storagePath) return "";
  if (storagePath.startsWith("http") || storagePath.startsWith("data:")) return storagePath;
  const config = supabaseConfig();
  if (!config?.url) return storagePath;
  return `${config.url}/storage/v1/object/public/${PHOTO_BUCKET}/${storagePath}`;
}

function dbProjectToApp(row) {
  return {
    id: row.client_id || row.id,
    title: row.title || "",
    clientName: row.client_name || "",
    clientPhone: row.client_phone || "",
    address: row.address || "",
    objectType: row.object_type || "",
    status: row.status || "new",
    installationDate: row.installation_date || "",
    teamName: row.team_name || "",
    comment: row.comment || "",
    technical: {
      panelManufacturer: row.project_technical?.panel_manufacturer || "",
      panelModel: row.project_technical?.panel_model || "",
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
      name: item.name || "",
      category: item.category || "Інше",
      plannedQty: Number(item.quantity || 0),
      issuedQty: Number(item.quantity || 0),
      actualQty: Number(item.quantity || 0),
      unit: item.unit || "шт",
    })),
    photos: (row.project_photos || []).map((item) => ({
      category: item.category || "Інше",
      caption: item.caption || "",
      fileName: item.file_name || "",
      storagePath: item.storage_path || "",
      src: publicPhotoUrl(item.storage_path || ""),
      createdAt: item.created_at || "",
    })),
  };
}

async function initCloud() {
  const config = supabaseConfig();
  if (!config || !window.supabase?.createClient) {
    cloudState.message = "Локальний режим: Supabase не налаштовано";
    return;
  }

  cloudState.enabled = true;
  cloudState.companyId = config.companyId || null;
  cloudState.client = window.supabase.createClient(config.url, config.anonKey);
  const { data } = await cloudState.client.auth.getSession();
  cloudState.user = data.session?.user || null;

  if (!cloudState.user) {
    cloudState.message = "Supabase підключено. Потрібен вхід користувача.";
    return;
  }

  await loadCompanyContext();
  await loadProjectsFromCloud();
}

async function loadCompanyContext() {
  if (!cloudState.client || !cloudState.user) return;
  let query = cloudState.client
    .from("company_members")
    .select("company_id, role, companies(name)")
    .eq("user_id", cloudState.user.id)
    .eq("is_active", true)
    .limit(1);

  if (cloudState.companyId) query = query.eq("company_id", cloudState.companyId);
  const { data, error } = await query;
  if (error) throw error;

  const member = data?.[0];
  if (!member) {
    const accepted = await acceptPendingInvitation();
    if (accepted) return loadCompanyContext();

    clearCompanyContext();
    cloudState.message = `Користувач не доданий до компанії. Запрошення для ${cloudState.user.email || "цього email"} не знайдено або ще не активне.`;
    return;
  }

  cloudState.companyId = member.company_id;
  cloudState.memberRole = member.role;
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

  await loadCompanyContext();
  await loadProjectsFromCloud();
  render();
}

async function loadCompanyPeople() {
  if (!cloudState.ready) return;

  const { data: members, error: membersError } = await cloudState.client
    .from("company_members")
    .select("role, is_active, profiles(email, full_name, phone)")
    .eq("company_id", cloudState.companyId)
    .order("created_at", { ascending: true });
  if (!membersError) cloudState.members = members || [];

  if (["owner", "admin"].includes(cloudState.memberRole)) {
    const { data: invitations, error: invitationsError } = await cloudState.client
      .from("company_invitations")
      .select("email, role, accepted_at, created_at")
      .eq("company_id", cloudState.companyId)
      .order("created_at", { ascending: false });
    if (!invitationsError) cloudState.invitations = invitations || [];
  } else {
    cloudState.invitations = [];
  }
}

async function loadProjectsFromCloud() {
  if (!cloudState.ready) return;
  cloudLoading = true;
  const { data, error } = await cloudState.client
    .from("projects")
    .select(`
      *,
      project_technical(*),
      project_strings(*),
      project_materials(*),
      project_photos(*)
    `)
    .eq("company_id", cloudState.companyId)
    .order("created_at", { ascending: false });
  cloudLoading = false;
  if (error) throw error;

  projects = (data || []).map(dbProjectToApp);
  selectedProjectId = projects[0] ? normalizeProjectId(projects[0].id) : "";
  localStorage.setItem("solarObjectManager.projects", JSON.stringify(projects));
}

async function syncProjectsToCloud() {
  if (!cloudState.ready) return;

  if (pendingCloudDeletes.length) {
    const idsToDelete = [...new Set(pendingCloudDeletes.map(normalizeProjectId))];
    const { error } = await cloudState.client
      .from("projects")
      .delete()
      .eq("company_id", cloudState.companyId)
      .in("client_id", idsToDelete);
    if (error) throw error;

    pendingCloudDeletes = pendingCloudDeletes.filter((id) => !idsToDelete.includes(normalizeProjectId(id)));
    savePendingCloudDeletes();
  }

  for (const project of projects) {
    const { data: savedProject, error: projectError } = await cloudState.client
      .from("projects")
      .upsert(projectToDb(project), { onConflict: "company_id,client_id" })
      .select("id")
      .single();
    if (projectError) throw projectError;

    const projectId = savedProject.id;
    const { error: technicalError } = await cloudState.client
      .from("project_technical")
      .upsert({ project_id: projectId, ...technicalToDb(project) }, { onConflict: "project_id" });
    if (technicalError) throw technicalError;

    await cloudState.client.from("project_strings").delete().eq("project_id", projectId);
    if (project.strings?.length) {
      const { error } = await cloudState.client.from("project_strings").insert(project.strings.map((item) => ({
        project_id: projectId,
        mppt_number: Number(item.mpptNumber || 0),
        pv_input_number: Number(item.pvInputNumber || 1),
        string_number: Number(item.stringNumber || 0),
        string_type: item.stringType || "normal",
        panel_count: Number(item.panelCount || 0),
        orientation: item.orientation || "",
        tilt_angle: Number(item.tiltAngle || 0),
        note: item.note || "",
      })));
      if (error) throw error;
    }

    await cloudState.client.from("project_materials").delete().eq("project_id", projectId);
    if (project.materials?.length) {
      const { error } = await cloudState.client.from("project_materials").insert(project.materials.map((item) => ({
        project_id: projectId,
        category: item.category || "Інше",
        name: item.name || "",
        quantity: Number(item.actualQty || item.plannedQty || 0),
        unit: item.unit || "шт",
      })));
      if (error) throw error;
    }

    await cloudState.client.from("project_photos").delete().eq("project_id", projectId);
    const cloudPhotos = (project.photos || []).filter((item) => typeof item !== "string" && item.storagePath);
    if (cloudPhotos.length) {
      const { error } = await cloudState.client.from("project_photos").insert(cloudPhotos.map((item) => ({
        project_id: projectId,
        category: item.category || "Інше",
        caption: item.caption || "",
        file_name: item.fileName || "",
        storage_path: item.storagePath,
        created_by: cloudState.user?.id || null,
      })));
      if (error) throw error;
    }
  }

  cloudState.message = `Синхронізовано ${new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`;
  renderProfileView();
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
    ["Фото", project.photos.length > 0],
  ];
}

function renderPassportChecklist(project) {
  return passportChecklist(project)
    .map(([label, ready]) => `<span class="passport-check ${ready ? "ready" : "missing"}">${ready ? "✓" : "!"} ${label}</span>`)
    .join("");
}

function renderPassportPhotos(project) {
  const photoItems = project.photos.filter((photo) => typeof photo !== "string" && photo.src).slice(0, 4);
  if (!photoItems.length) {
    return `<p class="muted-text">Фото для паспорта ще не додано.</p>`;
  }

  return `
    <div class="passport-photo-grid">
      ${photoItems
        .map(
          (photo) => `
            <figure>
              <img src="${photo.src}" alt="${escapeAttribute(photo.caption || photo.category || "Фото об'єкта")}" />
              <figcaption>${photo.category || "Фото"}${photo.caption ? ` · ${photo.caption}` : ""}</figcaption>
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

function selectedProject() {
  return projects.find((project) => String(project.id) === String(selectedProjectId)) || projects[0];
}

function showSection(sectionId) {
  document.querySelectorAll(".section").forEach((section) => section.classList.remove("active"));
  document.querySelector(`#${sectionId}`).classList.add("active");
  document.querySelector("#newProjectButton")?.classList.toggle("is-hidden", sectionId !== "projects");
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.section === sectionId || (sectionId === "objectDetail" && item.dataset.section === "projects"));
  });
}

function statusClass(status) {
  if (status === "passport_issued" || status === "completed") return "green";
  if (status === "waiting_review" || status === "planned") return "amber";
  return "";
}

function statusProgress(project) {
  const statusProgressMap = {
    new: 10,
    planned: 25,
    in_progress: 65,
    waiting_review: 85,
    completed: 100,
    passport_issued: 100,
  };

  const passportScore = passportChecklist(project).filter(([, ready]) => ready).length * 10;
  return Math.min(100, Math.max(statusProgressMap[project.status] || 15, passportScore));
}

function statusTone(status) {
  if (status === "completed" || status === "passport_issued") return "success";
  if (status === "in_progress") return "work";
  if (status === "waiting_review") return "blue";
  if (status === "planned") return "warning";
  return "muted";
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
    specs.push(`<span><b>Фотомодулі</b><em>${panelName}${panelCount}${panelPower}</em></span>`);
  }

  if (inverter) {
    const inverterPower = Number(technical.inverterPowerKw || 0) ? ` · ${technical.inverterPowerKw} кВт` : "";
    specs.push(`<span><b>Інвертор</b><em>${inverter}${inverterPower}</em></span>`);
  }

  if (hasBattery) {
    const batteryName = formatFilledCombined(technical.batteryManufacturer, technical.batteryModel) || "Дані АКБ внесені";
    const batteryCapacity = Number(technical.batteryCapacityKwh || 0) || Number(technical.batteryModulesCount || 0)
      ? ` · ${technical.batteryModulesCount || 0} шт × ${technical.batteryCapacityKwh || 0} кВт·год`
      : "";
    specs.push(`<span><b>АКБ</b><em>${batteryName}${batteryCapacity}</em></span>`);
  }

  if (!specs.length) return "";
  return wrap ? `<div class="object-specs">${specs.join("")}</div>` : specs.join("");
}

function serviceTickets() {
  return [
    { title: "Перевірка інвертора", object: selectedProject()?.title || "Об'єкт СЕС", status: "В роботі", tone: "warning" },
    { title: "Фотофіксація щитової", object: "Після завершення монтажу", status: "Нова", tone: "blue" },
    { title: "Передача матеріалів", object: "Звірити залишки по складу", status: "Очікує", tone: "muted" },
  ];
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
  const items = filteredProjects();
  projectList.innerHTML = items.length
    ? items
    .map(
      (project) => `
        <button class="object-card status-${project.status} ${String(project.id) === String(selectedProjectId) ? "active" : ""}" data-project-id="${project.id}">
          <span class="object-thumb" aria-hidden="true"></span>
          <div class="object-content">
            <div class="object-line">
              <h3>${project.title}</h3>
              <span class="chevron">›</span>
            </div>
            <p>${projectSubtitle(project)}</p>
            <p>${project.address}</p>
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
        <p class="eyebrow">${project.objectType}</p>
        <h2>${project.title}</h2>
        <p>${project.clientName} · ${project.clientPhone}</p>
      </div>
      <div class="detail-actions">
        <button class="icon-button" id="backToProjectsButton" aria-label="Назад до списку" title="Назад до списку">←</button>
        <button class="secondary-button compact-button" id="editProjectInfoButton">Редагувати</button>
        <button class="icon-button danger-icon" id="deleteProjectButton" aria-label="Видалити об'єкт" title="Видалити об'єкт">🗑</button>
        <div class="status-row">
          <label class="status-control">Статус
            <select id="projectStatusSelect">
              <option value="planned" ${selectedAttr(project.status, "planned")}>Заплановано</option>
              <option value="in_progress" ${selectedAttr(project.status, "in_progress")}>В роботі</option>
              <option value="completed" ${selectedAttr(project.status, "completed")}>Завершено</option>
            </select>
          </label>
          <span class="chip">${project.installationDate || "Без дати"}</span>
        </div>
      </div>
    </div>

    <div class="tabs">
      ${[
        ["summary", "Інформація"],
        ["technical", "Техдані"],
        ["strings", "MPPT"],
        ["materials", "Матеріали"],
        ["photos", "Фото"],
        ["passport", "Паспорт об'єкта"],
      ]
        .map((tab) => `<button class="tab ${selectedTab === tab[0] ? "active" : ""}" data-tab="${tab[0]}">${tab[1]}</button>`)
        .join("")}
    </div>

    <div>${renderTab(project, isValid, stringsTotal, expected)}</div>
  `;
}

function renderTab(project, isValid, stringsTotal, expected) {
  if (selectedTab === "technical") {
    return `
      <div class="section-actions">
        <button class="primary-button" id="editTechnicalButton">Редагувати техдані</button>
      </div>
      <div class="data-grid">
        <div class="data-item"><span>Панелі</span><strong>${formatCombined(project.technical.panelManufacturer, project.technical.panelModel)}</strong></div>
        <div class="data-item"><span>Кількість</span><strong>${project.technical.panelCount} шт × ${project.technical.panelPowerW} Вт</strong></div>
        <div class="data-item"><span>Загальна потужність</span><strong>${totalPower(project)} кВт</strong></div>
        <div class="data-item"><span>Інвертор</span><strong>${formatCombined(project.technical.inverterManufacturer, project.technical.inverterModel)}</strong></div>
        <div class="data-item"><span>Потужність інвертора</span><strong>${project.technical.inverterPowerKw || 0} кВт</strong></div>
        <div class="data-item"><span>Серійний номер</span><strong>${project.technical.inverterSerialNumber || "Не вказано"}</strong></div>
        <div class="data-item"><span>MPPT</span><strong>${project.technical.mpptCount}</strong></div>
        <div class="data-item"><span>PV входів на один MPPT</span><strong>${project.technical.pvInputsPerMppt || 0}</strong></div>
        <div class="data-item"><span>Акумулятор</span><strong>${formatCombined(project.technical.batteryManufacturer, project.technical.batteryModel)}</strong></div>
        <div class="data-item"><span>Ємність акумулятора</span><strong>${project.technical.batteryCapacityKwh || 0} кВт·год × ${project.technical.batteryModulesCount || 0} мод.</strong></div>
        <div class="data-item"><span>Загальна ємність АКБ</span><strong>${batteryTotalCapacity(project)} кВт·год</strong></div>
        <div class="data-item"><span>Серійні номери АКБ</span><strong>${project.technical.batterySerialNumbers || "Не вказано"}</strong></div>
      </div>
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

  if (selectedTab === "checklist") {
    const checklistGroups = [
      ["1. Конструкція", ["Розмітка", "Монтаж кріплення", "Перевірка площини"]],
      ["2. Панелі", ["Монтаж панелей", "Момент затяжки", "Маркування стрінгів"]],
      ["3. Електрика", ["Прокладка кабелю", "Підключення DC", "Підключення AC", "Заземлення"]],
      ["4. Пусконалагодження", ["Налаштування інвертора", "Перевірка параметрів", "Інструктаж клієнта"]],
    ];

    return `
      <div class="checklist-head">
        <div>
          <span class="muted-text">Загальний прогрес</span>
          <strong>${statusProgress(project)}%</strong>
        </div>
        <div class="progress-line"><span style="width: ${statusProgress(project)}%"></span></div>
      </div>
      <div class="checklist-board">
        ${checklistGroups.map((group, groupIndex) => `
          <section class="checklist-group">
            <h3>${group[0]}</h3>
            ${group[1].map((item, itemIndex) => {
              const checked = groupIndex < 2 || (groupIndex === 2 && itemIndex < Math.min(2, project.strings.length));
              return `<label class="task-row"><input type="checkbox" ${checked ? "checked" : ""} /> <span>${item}</span><i></i></label>`;
            }).join("")}
          </section>
        `).join("")}
      </div>
    `;
  }

  if (selectedTab === "materials") {
    return `
      <div class="section-actions">
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
              <label>Кількість<input name="actualQty" type="number" min="0" step="0.01" /></label>
              <label>Од.<input name="unit" placeholder="шт, м, пар" required /></label>
              <button class="primary-button">Додати матеріал</button>
            </form>
          `
          : ""
      }
      <div class="table-wrap">
        <table>
          <thead><tr><th>Обладнання та матеріали</th><th>Категорія</th><th>Кількість</th><th>Од.</th>${materialsEditing ? "<th></th>" : ""}</tr></thead>
          <tbody>
            ${project.materials.length
              ? project.materials.map((item, index) => {
                return `
                  <tr>
                    <td>${
                      materialsEditing
                        ? `<input class="table-input material-edit-field" data-material-index="${index}" data-material-field="name" value="${escapeAttribute(item.name)}" />`
                        : item.name
                    }</td>
                    <td>${
                      materialsEditing
                        ? `<select class="table-input material-edit-field" data-material-index="${index}" data-material-field="category">${materialCategoryOptions(item.category)}</select>`
                        : item.category
                    }</td>
                    <td>${
                      materialsEditing
                        ? `<input class="table-input material-edit-field" data-material-index="${index}" data-material-field="actualQty" type="number" min="0" step="0.01" value="${escapeAttribute(item.actualQty)}" />`
                        : item.actualQty
                    }</td>
                    <td>${
                      materialsEditing
                        ? `<input class="table-input material-edit-field" data-material-index="${index}" data-material-field="unit" value="${escapeAttribute(item.unit)}" />`
                        : item.unit
                    }</td>
                    ${materialsEditing ? `<td><button class="table-button danger-text" data-delete-material-index="${index}">Видалити</button></td>` : ""}
                  </tr>
                `;
              })
              .join("")
              : `<tr><td colspan="${materialsEditing ? 5 : 4}">Матеріали ще не додано.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  if (selectedTab === "photos") {
    return `
      <form class="inline-form photo-form" id="photoForm">
        <label>Категорія
          <select name="category">
            <option value="Дах / ділянка">Дах / ділянка</option>
            <option value="Панелі">Панелі</option>
            <option value="Інвертор">Інвертор</option>
            <option value="Щит">Щит</option>
            <option value="Готовий об'єкт">Готовий об'єкт</option>
            <option value="Інше">Інше</option>
          </select>
        </label>
        <label>Підпис
          <input name="caption" placeholder="Наприклад: інвертор після монтажу" />
        </label>
        <label class="file-field">Фото
          <input name="file" type="file" accept="image/*" required />
        </label>
        <div class="form-submit-cell">
          <button class="primary-button">Додати фото</button>
        </div>
      </form>
      <div class="photo-grid">
        ${(project.photos.length ? project.photos : ["Фото ще не додано"])
          .map((photo, index) => renderPhotoTile(photo, index))
          .join("")}
      </div>
    `;
  }

  if (selectedTab === "passport") {
    return `
      <div class="passport-actions">
        <button class="secondary-button" id="objectPassportPreviewButton">Попередній перегляд</button>
        <button class="primary-button" id="objectPassportPrintButton">Друк / PDF</button>
      </div>
      <article class="passport-preview object-passport-preview" id="objectPassportPreview">
        ${passportDocumentMarkup(project)}
      </article>
    `;
  }

  return `
    <div class="object-specs">
      <span><b>Адреса</b><em>${project.address}</em></span>
      <span><b>Бригада</b><em>${project.teamName || "Не призначено"}</em></span>
      <span><b>Потужність</b><em>${totalPower(project)} кВт</em></span>
      ${objectTechnicalSpecs(project, false)}
    </div>
    <p style="margin-top: 16px">${project.comment || ""}</p>
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
                      <td>${item.mpptNumber}</td>
                      <td>${pvInputLabel(item)}</td>
                      <td>${item.stringNumber}</td>
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
    return `<div class="photo-tile"><span>${photo}</span></div>`;
  }

  return `
    <figure class="photo-card">
      <img src="${photo.src}" alt="${escapeAttribute(photo.caption || photo.category || "Фото об'єкта")}" />
      <figcaption>
        <strong>${photo.category || "Фото"}</strong>
        <span>${photo.caption || "Без підпису"}</span>
      </figcaption>
      <button class="table-button danger-text photo-delete" data-delete-photo-index="${index}">Видалити</button>
    </figure>
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
                              <select class="table-input string-edit-field" data-string-index="${item.originalIndex}" data-string-field="pvInputNumber">
                                ${pvInputOptions(project, item.pvInputNumber || 1)}
                              </select>
                            `
                            : pvInputLabel(item)
                        }</td>
                        <td>${
                          editing
                            ? `<input class="table-input string-edit-field" data-string-index="${item.originalIndex}" data-string-field="stringNumber" type="number" min="1" step="1" value="${escapeAttribute(item.stringNumber)}" />`
                            : item.stringNumber
                        }</td>
                        <td>${
                          editing
                            ? `
                              <select class="table-input string-edit-field" data-string-index="${item.originalIndex}" data-string-field="stringType">
                                <option value="normal" ${selectedAttr(item.stringType || "normal", "normal")}>Звичайний</option>
                                <option value="parallel" ${selectedAttr(item.stringType, "parallel")}>Паралельний</option>
                              </select>
                            `
                            : stringTypeLabel(item.stringType)
                        }</td>
                        <td>${
                          editing
                            ? `<input class="table-input string-edit-field" data-string-index="${item.originalIndex}" data-string-field="panelCount" type="number" min="0" step="1" value="${escapeAttribute(item.panelCount)}" />`
                            : item.panelCount
                        }</td>
                        <td>${effectiveStringPanels(item)}</td>
                        <td>${stringPowerKw(project, item)} кВт</td>
                        <td>${
                          editing
                            ? `<input class="table-input string-edit-field" data-string-index="${item.originalIndex}" data-string-field="orientation" value="${escapeAttribute(item.orientation)}" />`
                            : item.orientation || "-"
                        }</td>
                        <td>${
                          editing
                            ? `<input class="table-input string-edit-field" data-string-index="${item.originalIndex}" data-string-field="tiltAngle" type="number" min="0" step="1" value="${escapeAttribute(item.tiltAngle || 0)}" />`
                            : `${item.tiltAngle || "-"}°`
                        }</td>
                        <td>${
                          editing
                            ? `<input class="table-input string-edit-field" data-string-index="${item.originalIndex}" data-string-field="note" value="${escapeAttribute(item.note)}" />`
                            : item.note || "-"
                        }</td>
                        ${editing ? `<td><button class="table-button danger-text" data-delete-string-index="${item.originalIndex}">Видалити</button></td>` : ""}
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
                        <td>${item.mpptNumber}</td>
                        <td>${pvInputLabel(item)}</td>
                        <td>${item.stringNumber}</td>
                        <td>${stringTypeLabel(item.stringType)}</td>
                        <td>${item.panelCount}</td>
                        <td>${effectiveStringPanels(item)}</td>
                        <td>${stringPowerKw(project, item)} кВт</td>
                        <td>${item.orientation || "-"}</td>
                        <td>${item.tiltAngle || "-"}°</td>
                        <td>${item.note || "-"}</td>
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
        <strong>Стрінг ${item.stringNumber || "-"}</strong>
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
        <span>${item.orientation || "Орієнтація не вказана"}</span>
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
        <strong>${formatFilledCombined(project.technical.inverterManufacturer, project.technical.inverterModel) || "Інвертор"}</strong>
        <em>${project.technical.inverterPowerKw || 0} кВт</em>
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
                      <div class="pv-node">${pvInputLabel(item)}</div>
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
  const project = selectedProject();
  if (!project) return;

  projectInfoForm.reset();
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
          <h2>${project.title}</h2>
          <p>${project.address}</p>
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
          <div class="data-item"><span>Клієнт</span><strong>${project.clientName}</strong></div>
          <div class="data-item"><span>Телефон</span><strong>${project.clientPhone || "-"}</strong></div>
          <div class="data-item"><span>Дата монтажу</span><strong>${project.installationDate || "-"}</strong></div>
          <div class="data-item"><span>Відповідальна бригада</span><strong>${project.teamName || "-"}</strong></div>
          <div class="data-item"><span>Статус</span><strong>${statusLabels[project.status] || "-"}</strong></div>
          <div class="data-item"><span>Встановлена потужність</span><strong>${totalPower(project)} кВт</strong></div>
        </div>
      </section>

      <section class="passport-section">
        <h3>Обладнання</h3>
        <div class="data-grid">
          <div class="data-item"><span>Сонячні панелі</span><strong>${project.technical.panelManufacturer || "-"} ${project.technical.panelModel || "-"}, ${project.technical.panelCount || 0} шт × ${project.technical.panelPowerW || 0} Вт.</strong></div>
          <div class="data-item"><span>Інвертор</span><strong>${project.technical.inverterManufacturer || "-"} ${project.technical.inverterModel || "-"}, ${project.technical.inverterPowerKw || 0} кВт, MPPT: ${project.technical.mpptCount || 0}, PV входів на MPPT: ${project.technical.pvInputsPerMppt || 0}.</strong></div>
          <div class="data-item"><span>Система збереження</span><strong>${formatBatteryPassport(project)}</strong></div>
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
                ? project.materials.map((item) => `<tr><td>${item.name}</td><td>${item.category}</td><td>${item.actualQty} ${item.unit}</td></tr>`).join("")
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

function renderHome() {
  if (!homeView) return;
  const inWork = projects.filter((project) => project.status === "in_progress").length;
  const planned = projects.filter((project) => project.status === "planned").length;
  const completed = projects.filter((project) => project.status === "completed" || project.status === "passport_issued").length;
  const activeProjects = projects
    .filter((project) => ["in_progress", "planned", "waiting_review", "new"].includes(project.status))
    .slice(0, 4);

  homeView.innerHTML = `
    <section class="hero-card">
      <div class="hero-brand">
        <img class="brand-logo big" src="./assets/sparta-logo.jpeg" alt="SPARTA power" />
        <div>
          <p class="eyebrow">Панель керування</p>
          <h2>Об'єкти SPARTA power</h2>
          <span>Загальний огляд монтажів, матеріалів і паспортів СЕС.</span>
        </div>
      </div>
      <div class="hero-progress">
        <span>Активних об'єктів</span>
        <strong>${inWork + planned}</strong>
        <div class="progress-line"><span style="width: ${projects.length ? Math.min(100, ((inWork + planned) / projects.length) * 100) : 0}%"></span></div>
      </div>
    </section>

    <div class="metric-grid">
      <div class="metric-card"><span>Об'єктів</span><strong>${projects.length}</strong></div>
      <div class="metric-card"><span>В роботі</span><strong>${inWork}</strong></div>
      <div class="metric-card"><span>Заплановано</span><strong>${planned}</strong></div>
      <div class="metric-card"><span>Завершено</span><strong>${completed}</strong></div>
      <div class="metric-card"><span>кВт у базі</span><strong>${projects.reduce((sum, project) => sum + Number(totalPower(project)), 0).toFixed(1)}</strong></div>
    </div>

    <section class="quick-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Робочий список</p>
          <h2>Актуальні об'єкти</h2>
        </div>
        <button class="secondary-button compact-button quick-action" data-section="projects">Усі об'єкти</button>
      </div>
      <div class="home-object-list">
        ${activeProjects.length
          ? activeProjects.map((project) => `
            <button class="home-object-card status-${project.status}" data-project-id="${project.id}">
              <div>
                <strong>${project.title}</strong>
                <span>${project.address}</span>
              </div>
              <div>
                <em>${statusLabels[project.status]}</em>
                <span>${totalPower(project)} кВт</span>
              </div>
            </button>
          `).join("")
          : `<div class="empty-state"><strong>Немає активних об'єктів</strong><span>Створи новий об'єкт або зміни статус існуючого.</span></div>`}
      </div>
    </section>

    <section class="quick-panel">
      <h2>Швидкі дії</h2>
      <div class="quick-grid">
        <button class="quick-action" data-section="projects"><span>▤</span>Об'єкти</button>
        <button class="quick-action" id="newProjectQuickButton"><span>＋</span>Новий об'єкт</button>
        <button class="quick-action" data-section="projects"><span>▣</span>Матеріали</button>
        <button class="quick-action" data-section="map"><span>⌖</span>Навігація</button>
      </div>
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
          <button class="map-pin ${statusTone(project.status)}" style="left: ${18 + index * 16}%; top: ${24 + (index % 3) * 20}%;" data-project-id="${project.id}">${index + 1}</button>
        `).join("")}
        <span class="map-city">Чернівці</span>
        <span class="map-road one"></span>
        <span class="map-road two"></span>
      </div>
      <div class="legend-list">
        <span><i class="dot success"></i>Завершено</span>
        <span><i class="dot warning"></i>В роботі / заплановано</span>
        <span><i class="dot blue"></i>Перевірка</span>
        <span><i class="dot muted"></i>Новий</span>
      </div>
    </section>
  `;
}

function renderServiceView() {
  if (!serviceView) return;
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
      <div class="metric-grid compact">
        <div class="metric-card success"><span>Онлайн</span><strong>${projects.length * 2}</strong></div>
        <div class="metric-card warning"><span>Попередження</span><strong>${projects.filter((project) => project.status === "waiting_review").length + 1}</strong></div>
        <div class="metric-card danger"><span>Аварії</span><strong>0</strong></div>
      </div>
      <div class="ticket-list">
        ${projects.map((project) => `
          <article class="monitor-card" data-project-id="${project.id}">
            <span class="object-thumb small" aria-hidden="true"></span>
            <div>
              <strong>${project.title}</strong>
              <span>${formatCombined(project.technical.inverterManufacturer, project.technical.inverterModel)}</span>
              <small>PV ${totalPower(project)} кВт · SOC ${project.technical.hasBattery ? "67%" : "-"}</small>
            </div>
            <em class="${statusTone(project.status)}">${statusLabels[project.status]}</em>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderProfileView() {
  if (!profileView) return;
  const email = cloudState.user?.email || "Користувач не увійшов";
  const mode = cloudState.enabled ? cloudState.message : "Локальне збереження в браузері";
  const canManageUsers = ["owner", "admin"].includes(cloudState.memberRole);
  const canAcceptInvitation = Boolean(cloudState.user && cloudState.enabled && !cloudState.ready);
  profileView.innerHTML = `
    <section class="profile-panel">
      <div class="profile-card">
        <img class="profile-avatar" src="./assets/sparta-logo.jpeg" alt="SPARTA power" />
        <div>
          <h2>SPARTA power</h2>
          <span>${email}</span>
          <small>${mode}</small>
        </div>
      </div>
      <div class="profile-menu">
        ${
          cloudState.user
            ? `<button id="logoutButton">Вийти з акаунта <span>›</span></button>`
            : `<button id="loginButton">Увійти в акаунт <span>›</span></button>`
        }
        <button id="syncNowButton">Синхронізувати зараз <span>›</span></button>
        ${canAcceptInvitation ? `<button id="acceptInvitationButton">Прийняти запрошення <span>›</span></button>` : ""}
        ${canManageUsers ? `<button id="inviteUserButton">Додати користувача <span>›</span></button>` : ""}
        <button>Моя бригада <span>›</span></button>
        <button>Налаштування <span>›</span></button>
        <button>Про додаток <span>›</span></button>
      </div>
      ${renderCompanyUsers()}
    </section>
  `;
}

function renderRoleLabel(role) {
  const labels = {
    owner: "Власник",
    admin: "Адмін",
    engineer: "Інженер",
    brigadier: "Бригадир",
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
      : "Supabase ще не налаштовано. Додай supabase-config.js.";
  }
}

function renderCompanyUsers() {
  if (!cloudState.ready) return "";
  const members = cloudState.members || [];
  const invitations = cloudState.invitations || [];

  return `
    <div class="profile-menu">
      <button type="button">Користувачі компанії <span>${members.length}</span></button>
      ${members.length
        ? members.map((member) => `
          <button type="button">
            ${member.profiles?.full_name || member.profiles?.email || "Користувач"}
            <span>${renderRoleLabel(member.role)}</span>
          </button>
        `).join("")
        : `<button type="button">Користувачів ще не додано <span>0</span></button>`}
      ${invitations.length
        ? `<button type="button">Запрошення <span>${invitations.filter((item) => !item.accepted_at).length}</span></button>
          ${invitations.map((invitation) => `
            <button type="button">
              ${invitation.email}
              <span>${invitation.accepted_at ? "Прийнято" : renderRoleLabel(invitation.role)}</span>
            </button>
          `).join("")}`
        : ""}
    </div>
  `;
}

function renderStats() {
  const stats = [
    ["Усі об'єкти", projects.length],
    ["В роботі", projects.filter((project) => project.status === "in_progress").length],
    ["Заплановано", projects.filter((project) => project.status === "planned").length],
    ["Завершено", projects.filter((project) => project.status === "completed").length],
    ["Паспорти", projects.filter((project) => project.status === "passport_issued").length],
  ];

  statsGrid.innerHTML = stats.map((item) => `<div class="stat"><strong>${item[1]}</strong><span>${item[0]}</span></div>`).join("");
}

function render() {
  renderHome();
  renderProjectList();
  renderDetail();
  renderPassport();
  renderMapView();
  renderServiceView();
  renderMonitoringView();
  renderProfileView();
  renderStats();
}

document.addEventListener("click", (event) => {
  const navItem = event.target.closest(".nav-item");
  if (navItem) {
    showSection(navItem.dataset.section);
  }

  const quickAction = event.target.closest(".quick-action");
  if (quickAction?.dataset.section) {
    showSection(quickAction.dataset.section);
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
    selectedTab = "summary";
    render();
    showSection("objectDetail");
  }

  if (event.target.closest("#loginButton")) {
    authForm.reset();
    setAuthMode("signin");
    authDialog.showModal();
  }

  const authModeButton = event.target.closest("[data-auth-mode]");
  if (authModeButton) {
    setAuthMode(authModeButton.dataset.authMode);
  }

  if (event.target.closest("#logoutButton")) {
    cloudState.client?.auth.signOut().then(() => {
      cloudState.user = null;
      clearCompanyContext();
      cloudState.message = "Користувач вийшов з акаунта.";
      updateAccessMode();
      render();
    });
  }

  if (event.target.closest("#syncNowButton")) {
    syncProjectsToCloud().then(render).catch((error) => {
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

  if (event.target.closest("#inviteUserButton")) {
    if (!cloudState.ready) {
      alert("Спочатку налаштуй Supabase і увійди в акаунт власника або адміністратора.");
      return;
    }
    if (!["owner", "admin"].includes(cloudState.memberRole)) {
      alert("Додавати користувачів може тільки власник або адміністратор.");
      return;
    }
    inviteForm.reset();
    inviteMessage.textContent = "Додай email і роль. Користувач зможе створити акаунт із цим email та автоматично приєднається до компанії.";
    inviteDialog.showModal();
  }

  const tab = event.target.closest("[data-tab]");
  if (tab) {
    if (selectedTab === "strings" && tab.dataset.tab !== "strings") {
      stringsEditing = false;
    }
    if (selectedTab === "materials" && tab.dataset.tab !== "materials") {
      materialsEditing = false;
    }
    selectedTab = tab.dataset.tab;
    renderDetail();
  }

  if (event.target.closest("#editTechnicalButton")) {
    openTechnicalDialog();
  }

  if (event.target.closest("#editProjectInfoButton")) {
    openProjectInfoDialog();
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
    preview?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (event.target.closest("#objectPassportPrintButton")) {
    renderPassport();
    showSection("passport");
    window.print();
    showSection("objectDetail");
  }

  if (event.target.closest("#backToProjectsButton")) {
    selectedTab = "summary";
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
    project.materials.splice(index, 1);
    saveProjects();
    render();
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
});

document.addEventListener("change", (event) => {
  if (event.target.id === "projectStatusSelect") {
    const project = selectedProject();
    if (!project) return;

    project.status = event.target.value;
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
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "photoForm") {
    event.preventDefault();
    addPhoto(event.target);
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

function addMaterial(formElement) {
  const project = selectedProject();
  if (!project) return;

  const data = new FormData(formElement);
  const materialName = data.get("name").trim() || data.get("catalogMaterial");
  project.materials.push({
    name: materialName,
    category: data.get("category"),
    actualQty: Number(data.get("actualQty") || 0),
    plannedQty: Number(data.get("actualQty") || 0),
    issuedQty: Number(data.get("actualQty") || 0),
    unit: data.get("unit").trim(),
  });

  saveProjects();
  formElement.reset();
  render();
}

async function uploadPhotoToCloud(project, file) {
  if (!cloudState.ready || !cloudState.client) return null;

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

  return {
    storagePath: path,
    src: publicPhotoUrl(path),
  };
}

function addPhoto(formElement) {
  const project = selectedProject();
  if (!project) return;

  const data = new FormData(formElement);
  const file = data.get("file");
  if (!file || !file.type?.startsWith("image/")) return;

  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    const photo = {
      category: data.get("category"),
      caption: data.get("caption").trim(),
      fileName: file.name,
      src: reader.result,
      createdAt: new Date().toISOString(),
    };

    project.photos.push(photo);
    saveProjects();
    formElement.reset();
    render();

    if (cloudState.ready) {
      try {
        cloudState.message = "Фото завантажується...";
        renderProfileView();
        const uploaded = await uploadPhotoToCloud(project, file);
        if (uploaded) {
          Object.assign(photo, uploaded);
          saveProjects();
          render();
        }
      } catch (error) {
        cloudState.message = `Фото лишилось локально: ${error.message}`;
        renderProfileView();
      }
    }

    saveProjects();
    render();
  });
  reader.readAsDataURL(file);
}

async function inviteUser(email, role) {
  if (!cloudState.ready) {
    alert("Спочатку налаштуй Supabase і увійди в акаунт власника або адміністратора.");
    return;
  }
  if (!["owner", "admin"].includes(cloudState.memberRole)) {
    alert("Додавати користувачів може тільки власник або адміністратор.");
    return;
  }

  if (!email?.trim()) return;
  role = (role || "installer").trim();
  const allowedRoles = ["engineer", "brigadier", "installer", "viewer", "admin"];
  if (!allowedRoles.includes(role)) {
    alert("Невідома роль. Доступні ролі: admin, engineer, brigadier, installer, viewer.");
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const { error } = await cloudState.client.from("company_invitations").upsert({
    company_id: cloudState.companyId,
    email: normalizedEmail,
    role,
    invited_by: cloudState.user.id,
  }, { onConflict: "company_id,email" });

  if (!error) await loadCompanyPeople();
  cloudState.message = error
    ? `Помилка запрошення: ${error.message}`
    : `Запрошення для ${normalizedEmail} збережено. Створи цього користувача в Supabase Auth або дай йому увійти після реєстрації.`;
  renderProfileView();
}

async function authenticateUser(email, password, mode, messageTarget) {
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
          data: {
            full_name: normalizedEmail.split("@")[0],
          },
        },
      })
    : cloudState.client.auth.signInWithPassword({
        email: normalizedEmail,
        password: passwordValue,
      });

  const { data: authData, error } = await authRequest;

  if (error) {
    messageTarget.textContent = error.message;
    return false;
  }

  if (authModeValue === "signup" && !authData.session) {
    messageTarget.textContent = "Акаунт створено. Перевір email, підтверди реєстрацію і увійди.";
    return false;
  }

  cloudState.user = authData.user;
  await loadCompanyContext();
  await loadProjectsFromCloud();
  updateAccessMode();
  render();
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
  await authenticateUser(data.get("email"), data.get("password"), "signin", gateAuthMessage);
});

inviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(inviteForm);
  inviteMessage.textContent = "Зберігаю запрошення...";
  await inviteUser(data.get("email"), data.get("role"));
  if (!cloudState.message.startsWith("Помилка")) {
    inviteDialog.close();
  } else {
    inviteMessage.textContent = cloudState.message;
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const nextProject = {
    id: normalizeProjectId(Date.now()),
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
  };

  projects.unshift(nextProject);
  saveProjects();
  selectedProjectId = normalizeProjectId(nextProject.id);
  selectedTab = "summary";
  dialog.close();
  render();
  showSection("objectDetail");
});

projectInfoForm.addEventListener("submit", (event) => {
  event.preventDefault();
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

  selectedProjectId = projects[0]?.id ?? null;
  selectedTab = "summary";
  saveProjects();
  render();
  showSection("projects");
}

function saveStringEdits() {
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
  const project = selectedProject();
  if (!project) return;

  document.querySelectorAll(".material-edit-field").forEach((field) => {
    const index = Number(field.dataset.materialIndex);
    const key = field.dataset.materialField;
    if (!project.materials[index]) return;

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
  const project = selectedProject();
  const data = new FormData(technicalForm);

  project.technical = {
    ...project.technical,
    panelManufacturer: data.get("panelManufacturer").trim(),
    panelModel: data.get("panelModel").trim(),
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

  saveProjects();
  technicalDialog.close();
  render();
});

async function initApp() {
  try {
    await initCloud();
  } catch (error) {
    cloudState.message = `Supabase помилка: ${error.message}`;
  }
  updateAccessMode();
  render();
}

initApp();
