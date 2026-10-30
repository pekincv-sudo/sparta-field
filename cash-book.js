(function () {
  "use strict";

  const core = window.SpartaCash;
  const categories = {
    client_payment: "Оплата клієнта", client_refund: "Повернення клієнту",
    sale_payment: "Оплата покупця", sale_refund: "Повернення покупцю",
    labor: "Виплата бригаді", materials: "Оплата матеріалів",
    other_income: "Інше надходження", other_expense: "Інші витрати",
    opening_balance: "Початковий залишок",
  };
  const methods = { cash: "Готівка", bank: "Банківський рахунок", card: "Картка" };
  let company = "";
  let entries = [];
  let pendingIds = [];
  let storageError = "";
  let syncMessage = "";
  let busy = false;
  let syncTask = null;
  let filters = { currency: "USD", sourceType: "all" };
  let salesOrders = [], salesFinance = null, salesMessage = "", salesLoaded = false, salesTask = null;
  const sourceTabs = { all: "Загальна каса", project: "Об’єкти", sale: "Продажі", general: "Інші операції" };
  const orderStatuses = { submitted: "Очікує підтвердження", confirmed: "Підтверджено", ready: "Готове до видачі", completed: "Видано", cancelled: "Скасовано" };

  const safe = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const amount = (minor, currency = "USD") => core.formatAmount(minor, currency);
  const currencyOf = (item) => item?.currency || "UAH";
  const currencyOptions = (selected = "USD") => ["USD", "UAH"].map((code) => `<option value="${code}" ${code === selected ? "selected" : ""}>${code === "USD" ? "USD — Долар США" : "UAH — Гривня"}</option>`).join("");
  const allowed = () => Boolean((window.SPARTA_LOCAL_WORKSPACE?.enabled || cloudState.ready) && ["owner", "admin"].includes(cloudState.memberRole));
  const visible = () => allowed() && portalMode !== "client";
  const storageKey = (id) => `solarObjectManager.cash.v1.${id}`;
  const dateLabel = (value) => new Date(value).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });
  const localInputDate = () => {
    const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    return parts.replace(" ", "T");
  };

  function refreshAccess() {
    const next = allowed() ? String(cloudState.companyId || "") : "";
    if (next !== company) {
      company = next;
      entries = [];
      pendingIds = [];
      storageError = "";
      syncMessage = "";
      filters = { currency: "USD", sourceType: "all" };
      salesOrders = []; salesFinance = null; salesMessage = ""; salesLoaded = false; salesTask = null;
      if (company) {
        try {
          const saved = readJsonStorage(storageKey(company), { entries: [], pendingIds: [] });
          entries = core.validateLedger(saved.entries || []).filter((entry) => entry.companyId === company);
          pendingIds = (saved.pendingIds || []).filter((id) => entries.some((entry) => entry.id === id));
        } catch (error) {
          storageError = `Локальний журнал потребує перевірки: ${error.message}. Початкові дані залишені у браузері.`;
        }
      }
    }
    document.querySelector('[data-section="cash"]')?.classList.toggle("is-hidden", !visible());
    if (!visible()) {
      document.querySelector("#cashEntryDialog")?.close();
      if (document.querySelector("#cash")?.classList.contains("active")) showSection("home");
    }
  }

  function persist(nextEntries = entries, nextPending = pendingIds) {
    if (storageError) throw new Error(storageError);
    const ledger = core.validateLedger(nextEntries);
    if (!writeLocalStorage(storageKey(company), JSON.stringify({ entries: ledger, pendingIds: nextPending }))) {
      throw new Error("Не вдалося зберегти операцію у браузері. Запис не проведено.");
    }
    entries = ledger;
    pendingIds = nextPending;
  }

  async function appendEntry(entry) {
    const append = () => {
      const saved = readJsonStorage(storageKey(company), { entries: [], pendingIds: [] });
      const merged = new Map(core.validateLedger(saved.entries || []).map((item) => [item.id, item]));
      entries.forEach((item) => { if (!merged.has(item.id)) merged.set(item.id, item); });
      merged.set(entry.id, entry);
      const nextPending = window.SPARTA_LOCAL_WORKSPACE?.enabled ? [] : [...new Set([...(saved.pendingIds || []), ...pendingIds, entry.id])];
      persist([...merged.values()], nextPending);
    };
    if (window.navigator?.locks) await window.navigator.locks.request(`sparta-cash-${company}`, append);
    else append();
  }

  async function postLocalEntry(input) {
    if (!window.SPARTA_LOCAL_WORKSPACE?.enabled) throw new Error("Тестові проводки доступні лише локально.");
    refreshAccess();
    const project = projects.find((item) => String(item.id) === String(input.projectId));
    input = { ...input, currency: input.currency || (project ? currencyOf(project) : "USD") };
    if (project && input.currency !== currencyOf(project)) throw new Error("Валюта операції має збігатися з валютою об’єкта.");
    const entry = core.createEntry({ ...input, companyId: company, createdBy: input.createdBy || cloudState.user.id }, { id: input.id || crypto.randomUUID(), now: input.createdAt || new Date().toISOString() });
    await appendEntry(entry);
    return entry;
  }

  function reloadLocal() {
    if (!window.SPARTA_LOCAL_WORKSPACE?.enabled) return;
    company = "";
    refreshAccess();
  }

  function fromRow(row) {
    return core.validateEntry({
      id: row.id, companyId: row.company_id, projectId: row.project_client_id || "",
      projectTitle: row.project_title || "", sourceType: row.source_type || "", saleOrderId: row.sale_order_id || "",
      saleOrderNumber: row.sale_order_number || "", buyerId: row.buyer_id || "", buyerName: row.buyer_name || "", direction: row.direction, category: row.category,
      amountMinor: Number(row.amount_minor), currency: row.currency || "UAH", counterparty: row.counterparty, purpose: row.purpose,
      occurredAt: new Date(row.occurred_at).toISOString(), method: row.payment_method, createdAt: new Date(row.created_at).toISOString(),
      createdBy: row.created_by, reversesId: row.reverses_id || "",
    });
  }

  function toRow(entry) {
    return {
      id: entry.id, company_id: entry.companyId, project_client_id: entry.projectId || null,
      project_title: entry.projectTitle || "", source_type: entry.sourceType, sale_order_id: entry.saleOrderId || null,
      sale_order_number: entry.saleOrderNumber || "", buyer_id: entry.buyerId || null, buyer_name: entry.buyerName || "", direction: entry.direction, category: entry.category,
      amount_minor: entry.amountMinor, currency: entry.currency, counterparty: entry.counterparty, purpose: entry.purpose,
      occurred_at: entry.occurredAt, payment_method: entry.method, reverses_id: entry.reversesId || null,
    };
  }

  async function loadSalesData(force = false) {
    refreshAccess();
    if (!visible() || window.SPARTA_LOCAL_WORKSPACE?.enabled) return;
    if (salesTask) return salesTask;
    if (salesLoaded && !force) return;
    const provider = window.SpartaBuyerCloud;
    if (!provider?.salesOrders || !provider?.salesFinance) { salesLoaded = true; return; }
    const companyId = company, userId = cloudState.user?.id;
    salesTask = (async () => {
      const results = await Promise.allSettled([provider.salesOrders(), provider.salesFinance()]);
      if (company !== companyId || cloudState.user?.id !== userId || !visible()) return;
      const messages = [];
      if (results[0].status === "fulfilled") salesOrders = (results[0].value?.orders || []).filter((order) => order.companyId === companyId);
      else messages.push("Замовлення для прив’язки не оновлено.");
      if (results[1].status === "fulfilled") salesFinance = results[1].value;
      else { salesFinance = null; messages.push("Звіт прибутку продажів не оновлено. Натисніть «Оновити»."); }
      salesMessage = messages.join(" ");
      salesLoaded = true;
    })().catch(() => { if (company === companyId) { salesLoaded = true; salesMessage = "Не вдалося оновити продажі. Повторіть оновлення."; } })
      .finally(() => { if (company === companyId) { salesTask = null; renderView(); } });
    return salesTask;
  }

  function cashChanged() {
    if (typeof window.CustomEvent === "function" && typeof window.dispatchEvent === "function") window.dispatchEvent(new window.CustomEvent("sparta:cash-changed", { detail: { companyId: company } }));
  }

  async function fetchRows(client, companyId) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from("cash_transactions").select("*").eq("company_id", companyId)
        .order("occurred_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    return rows.map(fromRow);
  }

  async function sync() {
    refreshAccess();
    if (!allowed() || !company || storageError) return;
    if (window.SPARTA_LOCAL_WORKSPACE?.enabled) {
      syncMessage = "Локальна каса. Дані збережені на цьому комп’ютері.";
      updateViews();
      cashChanged();
      return;
    }
    if (syncTask) return syncTask;
    const companyId = company;
    const client = cloudState.client;
    syncTask = (async () => {
      try {
        syncMessage = "Синхронізація журналу…";
        const remote = await fetchRows(client, companyId);
        if (company !== companyId || !allowed()) return;
        const byId = new Map(remote.map((entry) => [entry.id, entry]));
        const remoteReversals = new Map(remote.filter((entry) => entry.reversesId).map((entry) => [entry.reversesId, entry]));
        const resolvedIds = [];
        entries.forEach((entry) => {
          if (!pendingIds.includes(entry.id) || byId.has(entry.id)) return;
          if (entry.reversesId && remoteReversals.has(entry.reversesId)) {
            resolvedIds.push(entry.id);
          } else {
            byId.set(entry.id, entry);
          }
        });
        persist([...byId.values()], pendingIds.filter((id) => !resolvedIds.includes(id) && !remote.some((entry) => entry.id === id)));
        // Originals must reach the database before their linked reversals.
        while (pendingIds.length) {
          const entry = entries.filter((item) => pendingIds.includes(item.id)).sort((a, b) => Number(Boolean(a.reversesId)) - Number(Boolean(b.reversesId)))[0];
          if (!entry) break;
          if (company !== companyId || !allowed()) return;
          const { error } = await client.from("cash_transactions").upsert(toRow(entry), { onConflict: "id", ignoreDuplicates: true });
          if (error) throw error;
          const { data: saved, error: readError } = await client.from("cash_transactions").select("*").eq("company_id", companyId).eq("id", entry.id).single();
          if (readError) throw readError;
          if (company !== companyId || !allowed()) return;
          const posted = fromRow(saved);
          persist(entries.map((item) => item.id === posted.id ? posted : item), pendingIds.filter((id) => id !== posted.id));
        }
        await loadSalesData(true);
        if (company !== companyId || !allowed()) return;
        cashChanged();
        syncMessage = `Журнал синхронізовано о ${new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" })}${resolvedIds.length ? ". Сторнування вже виконано на іншому пристрої — використано підтверджений запис." : ""}`;
      } catch (error) {
        if (company !== companyId) return;
        const missingTable = ["PGRST205", "PGRST204", "42P01", "42703"].includes(error.code);
        const rejectedEntry = ["23505", "23514", "42501", "P0001"].includes(error.code);
        syncMessage = missingTable
          ? "Хмарну касу ще не налаштовано. Записи збережені на цьому пристрої; для спільного журналу потрібна міграція каси в Supabase."
          : rejectedEntry
            ? `База не прийняла операцію: ${error.message || "перевірте доступ і дані"}. Запис збережено на цьому пристрої для перевірки.`
            : "Немає зв’язку з хмарною касою. Нові записи збережені на цьому пристрої й очікують синхронізації.";
      } finally {
        syncTask = null;
        if (company === companyId) updateViews();
      }
    })();
    return syncTask;
  }

  function projectTotals(projectId, currency) {
    refreshAccess();
    if (!allowed()) return { clientPaidMinor: 0, recordedPayrollMinor: 0, recordedExpensesMinor: 0, materialsMinor: 0 };
    return core.projectTotals(entries, String(projectId), currency || currencyOf(projects.find((item) => String(item.id) === String(projectId))));
  }

  function tableMarkup(list, compact = false) {
    const reversed = new Set(entries.map((entry) => entry.reversesId).filter(Boolean));
    return `<div class="table-wrap cash-table-wrap"><table class="cash-table"><thead><tr><th>Дата оплати</th><th>Сума</th><th>Від кого / кому</th><th>За що / об’єкт</th><th>Спосіб</th><th>Внесено</th>${compact ? "" : "<th></th>"}</tr></thead><tbody>${list.length ? list.map((entry) => `<tr class="${entry.reversesId || reversed.has(entry.id) ? "cash-reversed" : ""}"><td>${safe(dateLabel(entry.occurredAt))}</td><td class="cash-amount ${entry.direction}">${entry.direction === "income" ? "+" : "−"}${amount(entry.amountMinor, entry.currency)}${entry.reversesId ? '<small>Сторнування</small>' : reversed.has(entry.id) ? '<small>Сторновано</small>' : ""}</td><td>${safe(entry.counterparty)}</td><td><strong>${safe(categories[entry.category])}</strong><span>${safe(entry.purpose)}</span><small>${safe(entry.sourceType === "sale" ? `${entry.saleOrderNumber} · ${entry.buyerName}` : entry.projectTitle || "Інші операції")}</small></td><td>${safe(methods[entry.method])}${pendingIds.includes(entry.id) ? '<small class="cash-pending">На пристрої</small>' : ""}</td><td>${safe(dateLabel(entry.createdAt))}</td>${compact ? "" : `<td>${!entry.reversesId && !reversed.has(entry.id) ? `<button class="table-button" type="button" data-cash-reverse="${safe(entry.id)}">Сторнувати</button>` : ""}</td>`}</tr>`).join("") : `<tr><td colspan="${compact ? 6 : 7}">Операцій за обраними умовами ще немає.</td></tr>`}</tbody></table></div>`;
  }

  function financeMarkup(currency) {
    const row = salesFinance?.totals?.find((item) => item.currency === currency);
    if (!row) return `<section class="cash-sale-report"><h3>Результат реалізації</h3><p class="calculation-note">${safe(salesMessage || (salesTask ? "Оновлюємо звіт продажів…" : salesLoaded ? "Виданих продажів у цій валюті ще немає." : "Звіт прибутку доступний після підключення продажів."))}</p></section>`;
    const exact = Number.isSafeInteger(row.grossProfitMinor);
    return `<section class="cash-sale-report"><h3>Результат реалізації · ${safe(currency)} · за весь час</h3><div class="cash-sale-totals"><span>Видано товару<strong>${amount(Number(row.revenueMinor || 0), currency)}</strong></span><span>Собівартість виданого<strong>${Number.isSafeInteger(row.costMinor) ? amount(row.costMinor, currency) : "Не повністю відома"}</strong></span><span>Валовий прибуток<strong>${exact ? amount(row.grossProfitMinor, currency) : "Не повністю відомий"}</strong></span><span>Борг за замовленнями<strong>${amount(Number(row.outstandingMinor || 0), currency)}</strong></span></div><p class="calculation-note">Валовий прибуток — вартість виданого товару мінус зафіксована собівартість. Це не залишок грошей у касі. Видача товару не створює оплату. ${Number(row.unknownCostCount || 0) ? `Для ${safe(row.unknownCostCount)} продажів собівартість невідома; повний прибуток не розраховується.` : ""}</p></section>`;
  }

  function renderView() {
    refreshAccess();
    const target = document.querySelector("#cashView");
    if (!target) return;
    if (!visible()) { target.innerHTML = ""; return; }
    if (!salesLoaded && !salesTask) void loadSalesData();
    const sourceType = Object.hasOwn(sourceTabs, filters.sourceType) ? filters.sourceType : "all";
    const list = core.filterEntries(entries, { ...filters, sourceType });
    const currency = filters.currency || "USD";
    const grouped = core.sourceTotals(entries, currency);
    const total = grouped[sourceType];
    const sourceEntries = core.filterEntries(entries, { currency, sourceType });
    const filtered = core.totals(list, currency);
    const projectOptions = new Map(projects.map((project) => [String(project.id), project.title]));
    entries.forEach((entry) => { if (entry.projectId && !projectOptions.has(entry.projectId)) projectOptions.set(entry.projectId, entry.projectTitle); });
    target.innerHTML = `<section class="cash-panel">
      <div class="section-title-row"><div><span>Рух грошей · ${currency}</span><h2>Каса</h2></div><label class="cash-currency">Валюта<select data-cash-currency>${currencyOptions(currency)}</select></label><button type="button" class="primary-button" data-cash-add>+ Додати операцію</button></div>
      <nav class="cash-source-tabs" aria-label="Напрям каси">${Object.entries(sourceTabs).map(([key,label]) => `<button type="button" class="${key === sourceType ? "active" : ""}" data-cash-source="${key}" aria-pressed="${key === sourceType}">${label}</button>`).join("")}</nav>
      <div class="cash-source-summaries">${Object.entries(sourceTabs).map(([key,label]) => `<article><span>${label}</span><strong>${amount(grouped[key].balanceMinor, currency)}</strong></article>`).join("")}</div>
      <div class="cash-summary"><article><span>Надійшло за весь час · ${safe(sourceTabs[sourceType])}</span><strong>${amount(total.incomeMinor, currency)}</strong></article><article><span>Витрачено за весь час · ${safe(sourceTabs[sourceType])}</span><strong>${amount(total.expenseMinor, currency)}</strong></article><article><span>Залишок за записами</span><strong>${amount(total.balanceMinor, currency)}</strong></article></div>
      <div class="cash-account-balances">${Object.entries(methods).map(([method, label]) => `<span>${label}<strong>${amount(core.totals(sourceEntries.filter((entry) => entry.method === method), currency).balanceMinor, currency)}</strong></span>`).join("")}</div>
      <p class="calculation-note">Залишок розрахований від нуля за фактичними операціями журналу. Для грошей, що були раніше, внесіть «Початковий залишок». Оплату за товар вносьте з напрямом «Продаж» і прив’язкою до замовлення; оплати об’єктів — з напрямом «Об’єкт». USD та гривня обліковуються окремо.</p>
      ${sourceType === "all" || sourceType === "sale" ? financeMarkup(currency) : ""}
      <div class="cash-sync-status" role="status">${safe(storageError || syncMessage || "Журнал збережений на цьому пристрої.")}${pendingIds.length ? ` · Очікують синхронізації: ${pendingIds.length}` : ""}${salesMessage ? ` · ${safe(salesMessage)}` : ""}<button class="text-action" type="button" data-cash-sync>Оновити</button></div>
      <form id="cashFilterForm" class="cash-filters"><input type="hidden" name="currency" value="${safe(currency)}" /><label>Від дати<input type="date" name="from" value="${safe(filters.from || "")}" /></label><label>До дати<input type="date" name="to" value="${safe(filters.to || "")}" /></label><label>Об’єкт<select name="projectId"><option value="">Усі об’єкти</option><option value="__none" ${filters.projectId === "__none" ? "selected" : ""}>Без об’єкта</option>${[...projectOptions].map(([id, title]) => `<option value="${safe(id)}" ${filters.projectId === id ? "selected" : ""}>${safe(title)}</option>`).join("")}</select></label><label>Операції<select name="direction"><option value="">Усі</option><option value="income" ${filters.direction === "income" ? "selected" : ""}>Надходження</option><option value="expense" ${filters.direction === "expense" ? "selected" : ""}>Витрати</option></select></label><label>Спосіб<select name="method"><option value="">Усі способи</option>${Object.entries(methods).map(([id, label]) => `<option value="${id}" ${filters.method === id ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Пошук<input name="query" value="${safe(filters.query || "")}" placeholder="Ім’я, замовлення, призначення, об’єкт" /></label><button class="secondary-button" type="submit">Застосувати</button><button class="ghost-button" type="button" data-cash-reset>Скинути</button></form>
      <div class="panel-heading"><div><h3>Журнал операцій</h3><span class="cash-filter-summary">${list.length} записів · Надійшло ${amount(filtered.incomeMinor, currency)} · Витрачено ${amount(filtered.expenseMinor, currency)}</span></div><button class="secondary-button" type="button" data-cash-export>Завантажити CSV</button></div>
      ${tableMarkup(list)}
    </section>`;
  }

  function projectMarkup(project, options = {}) {
    if (!allowed()) return "";
    const projectEntries = core.filterEntries(entries, { projectId: String(project.id) });
    if (options.clientOnly) {
      const list = projectEntries.filter((entry) => ["client_payment", "client_refund"].includes(entry.category));
      return `<section class="finance-panel cash-project-panel"><div class="panel-heading"><h3>Оплати клієнта</h3><button class="primary-button" type="button" data-cash-add data-cash-project="${safe(project.id)}" data-cash-client-only>Додати оплату</button></div><details class="cash-client-history"><summary>Історія оплат · ${list.length}</summary>${tableMarkup(list, true)}</details><button type="button" class="text-action" data-cash-open-project="${safe(project.id)}">Усі операції об’єкта в касі →</button></section>`;
    }
    const list = projectEntries;
    const paid = core.projectTotals(entries, String(project.id), currencyOf(project));
    const baseline = Number(project.finance?.advancePaid || 0);
    return `<section class="finance-panel cash-project-panel"><div class="panel-heading"><div><p class="eyebrow">Каса об’єкта</p><h3>Історія оплат</h3></div><button class="primary-button" type="button" data-cash-add data-cash-project="${safe(project.id)}">+ Оплата / витрата</button></div><p class="calculation-note">Платежі клієнта в журналі: <strong>${amount(paid.clientPaidMinor, currencyOf(project))}</strong>${baseline ? ` · Аванс до запуску журналу: <strong>${money(baseline, currencyOf(project))}</strong>` : ""}. У залишку до оплати враховано обидві суми. Витрати каси показують рух грошей; собівартість у кошторисі обліковується окремо.</p>${tableMarkup(list, true)}<button type="button" class="text-action" data-cash-open-project="${safe(project.id)}">Усі операції об’єкта в касі →</button></section>`;
  }

  function selectableOrders() {
    return salesOrders.filter((order) => ["confirmed", "ready", "completed"].includes(order.status) || order.status === "cancelled" && core.saleTotals(entries, order.id, currencyOf(order)).paidMinor > 0);
  }

  async function openForSale(orderOrId) {
    refreshAccess();
    if (!visible()) return false;
    const id = String(typeof orderOrId === "string" ? orderOrId : orderOrId?.id || orderOrId?.orderId || "");
    const companyId = company, userId = cloudState.user?.id;
    await sync();
    await loadSalesData(true);
    if (company !== companyId || cloudState.user?.id !== userId || !visible()) return false;
    if (!selectableOrders().some((order) => order.id === id)) throw new Error("Замовлення ще не підтверджене, не оновлене або недоступне для внесення оплати.");
    return openEntry("", "", id, "sale");
  }

  async function openEntry(projectId = "", reverseId = "", saleOrderId = "", preferredSource = "") {
    refreshAccess();
    if (!visible() || storageError) return false;
    const sourceType = reverseId ? "" : projectId ? "project" : saleOrderId ? "sale" : preferredSource || (["sale", "project"].includes(filters.sourceType) ? filters.sourceType : "general");
    const companyId = company, userId = cloudState.user?.id;
    if (sourceType === "sale") await loadSalesData();
    if (company !== companyId || cloudState.user?.id !== userId || !visible()) return false;
    const project = projects.find((item) => String(item.id) === String(projectId));
    const order = salesOrders.find((item) => item.id === saleOrderId);
    const original = reverseId ? entries.find((entry) => entry.id === reverseId) : null;
    if (original && (original.reversesId || entries.some((entry) => entry.reversesId === original.id))) return false;
    const salePaid = order ? core.saleTotals(entries, order.id, currencyOf(order)).paidMinor : 0;
    const remaining = order ? Math.max(0, Math.round(Number(order.total) * 100) - salePaid) : 0;
    const defaultMinor = order?.status === "cancelled" ? salePaid : remaining;
    const defaultAmount = order && Number.isSafeInteger(defaultMinor) && defaultMinor > 0 ? (defaultMinor / 100).toFixed(2) : "";
    document.querySelector("#cashEntryDialog")?.remove();
    const dialogElement = document.createElement("dialog");
    dialogElement.id = "cashEntryDialog";
    dialogElement.innerHTML = `<form id="cashEntryForm" class="modal-form"><div class="modal-head"><h2>${original ? "Сторнування операції" : "Нова операція каси"}</h2><button type="button" class="ghost-button" data-cash-close aria-label="Закрити">×</button></div><input type="hidden" name="reversesId" value="${safe(reverseId)}" />${original ? `<p class="calculation-note">${safe(original.counterparty)} · ${amount(original.amountMinor, original.currency)} · ${safe(original.purpose)}. Буде додано зворотний запис; початкова операція залишиться в журналі.</p>` : `<div class="form-grid"><label>Напрям каси<select name="sourceType">${Object.entries(core.sourceLabels).map(([key,label]) => `<option value="${key}" ${sourceType === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Тип операції<select name="direction"><option value="income" ${order?.status === "cancelled" ? "" : "selected"}>Надходження</option><option value="expense" ${order?.status === "cancelled" ? "selected" : ""}>Витрата</option></select></label><label>Категорія<select name="category"></select></label><label>Валюта<select name="currency">${currencyOptions(order ? currencyOf(order) : project ? currencyOf(project) : "USD")}</select></label><label>Сума<input name="amount" type="text" inputmode="decimal" placeholder="0,00" value="${safe(defaultAmount)}" required /></label><label>Дата та час оплати<input name="occurredAt" type="datetime-local" value="${localInputDate()}" required /></label><label class="full">Від кого / кому<input name="counterparty" value="${safe(order?.buyerName || project?.clientName || "")}" maxlength="250" placeholder="Клієнт, постачальник або бригада" required /></label><label data-cash-project-field ${sourceType !== "project" ? "hidden" : ""}>Об’єкт<select name="projectId" ${sourceType === "project" ? "required" : ""}><option value="">Оберіть об’єкт</option>${projects.map((item) => `<option value="${safe(item.id)}" ${String(item.id) === String(projectId) ? "selected" : ""}>${safe(item.title)}</option>`).join("")}</select></label><label class="cash-order-field" data-cash-sale-field ${sourceType !== "sale" ? "hidden" : ""}>Замовлення покупця<select name="saleOrderId" ${sourceType === "sale" ? "required" : ""}><option value="">Оберіть замовлення</option>${selectableOrders().map((item) => `<option value="${safe(item.id)}" ${item.id === saleOrderId ? "selected" : ""}>${safe(item.number)} · ${safe(item.buyerName)} · ${safe(orderStatuses[item.status] || item.status)} · ${amount(Math.round(Number(item.total || 0) * 100), currencyOf(item))}</option>`).join("")}</select></label><label>Спосіб оплати<select name="method">${Object.entries(methods).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></label><label class="full">За що сплачено<textarea name="purpose" maxlength="1500" rows="2" placeholder="Оплата замовлення, аванс за станцію, доставка…" required>${safe(order ? `${order.status === "cancelled" ? "Повернення" : "Оплата"} за замовленням ${order.number}` : "")}</textarea></label></div><p class="calculation-note">Зберігайте лише фактично отриману або виплачену суму. Видача зі складу не підтверджує оплату. Валюта має збігатися з об’єктом або замовленням.</p>`}${original ? '<label>Причина сторнування<textarea name="reason" maxlength="1500" rows="2" required></textarea></label>' : ""}<p id="cashEntryMessage" class="cash-entry-message" role="status"></p><div class="modal-actions"><button class="secondary-button" type="button" data-cash-close>Скасувати</button><button class="primary-button" type="submit">${original ? "Провести сторнування" : "Зберегти операцію"}</button></div></form>`;
    document.body.append(dialogElement);
    if (!original) fillCategories(dialogElement.querySelector("form"));
    dialogElement.showModal();
    return true;
  }

  function fillCategories(formElement) {
    const direction = formElement.elements.direction.value;
    const sourceType = formElement.elements.sourceType?.value || "general";
    const keys = sourceType === "sale" ? direction === "income" ? ["sale_payment", "other_income"] : ["sale_refund", "other_expense"]
      : sourceType === "project" ? direction === "income" ? ["client_payment", "other_income", "opening_balance"] : ["client_refund", "labor", "materials", "other_expense"]
      : direction === "income" ? ["other_income", "opening_balance"] : ["other_expense", "labor", "materials"];
    formElement.elements.category.innerHTML = keys.map((key) => `<option value="${key}">${categories[key]}</option>`).join("");
  }

  function changeReference(formElement, changed) {
    const sourceType = formElement.elements.sourceType.value;
    if (changed === "sourceType") {
      formElement.elements.projectId.value = ""; formElement.elements.saleOrderId.value = "";
      formElement.elements.counterparty.value = ""; formElement.elements.amount.value = "";
      formElement.elements.currency.value = "USD";
      fillCategories(formElement);
    }
    const projectField = formElement.querySelector("[data-cash-project-field]");
    const saleField = formElement.querySelector("[data-cash-sale-field]");
    if (projectField) projectField.hidden = sourceType !== "project";
    if (saleField) saleField.hidden = sourceType !== "sale";
    formElement.elements.projectId.required = sourceType === "project";
    formElement.elements.saleOrderId.required = sourceType === "sale";
    const project = sourceType === "project" && projects.find((item) => String(item.id) === formElement.elements.projectId.value);
    const order = sourceType === "sale" && salesOrders.find((item) => item.id === formElement.elements.saleOrderId.value);
    if (project) { formElement.elements.currency.value = currencyOf(project); formElement.elements.counterparty.value = project.clientName || ""; }
    if (order) {
      formElement.elements.currency.value = currencyOf(order); formElement.elements.counterparty.value = order.buyerName || "";
      formElement.elements.purpose.value = `${order.status === "cancelled" ? "Повернення" : "Оплата"} за замовленням ${order.number}`;
      const paid = core.saleTotals(entries, order.id, currencyOf(order)).paidMinor;
      const due = order.status === "cancelled" ? paid : Math.max(0, Math.round(Number(order.total) * 100) - paid);
      formElement.elements.amount.value = Number.isSafeInteger(due) && due > 0 ? (due / 100).toFixed(2) : "";
      if (order.status === "cancelled") { formElement.elements.direction.value = "expense"; fillCategories(formElement); }
    }
  }

  async function saveEntry(formElement) {
    if (busy) return;
    busy = true;
    const submit = formElement.querySelector('[type="submit"]');
    submit.disabled = true;
    formElement.querySelector("#cashEntryMessage").textContent = "";
    try {
      if (!visible()) throw new Error("Внесення операцій доступне власнику або адміністратору.");
      const data = new FormData(formElement);
      const reverseId = String(data.get("reversesId") || "");
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      let entry;
      if (reverseId) {
        const original = entries.find((item) => item.id === reverseId);
        if (!original) throw new Error("Початкову операцію не знайдено.");
        const reason = String(data.get("reason") || "").trim();
        if (!reason) throw new Error("Вкажіть причину сторнування.");
        entry = core.reversal(entries, original, { id, now, createdBy: cloudState.user.id, purpose: `Сторнування: ${reason}` });
      } else {
        const projectId = String(data.get("projectId") || "");
        const saleOrderId = String(data.get("saleOrderId") || "");
        const sourceType = String(data.get("sourceType") || (saleOrderId ? "sale" : projectId ? "project" : "general"));
        const project = projects.find((item) => String(item.id) === projectId);
        const currency = String(data.get("currency") || "USD");
        if (sourceType === "project" && !project) throw new Error("Оберіть чинний об’єкт.");
        if (project && currency !== currencyOf(project)) throw new Error("Оберіть валюту договору: " + currencyOf(project) + ". Валюти обліковуються окремо, без автоматичного перерахунку.");
        const order = sourceType === "sale" ? salesOrders.find((item) => item.id === saleOrderId && item.companyId === company) : null;
        const category = String(data.get("category") || "");
        const amountMinor = core.parseAmount(data.get("amount"));
        if (sourceType === "sale") {
          if (!order) throw new Error("Оберіть замовлення своєї компанії та оновіть дані продажів.");
          if (!["confirmed", "ready", "completed"].includes(order.status) && !(order.status === "cancelled" && category === "sale_refund")) throw new Error("Оплату можна внести після підтвердження замовлення.");
          if (currency !== currencyOf(order)) throw new Error("Валюта платежу має збігатися з валютою замовлення.");
          if (category === "sale_refund" && amountMinor > core.saleTotals(entries, order.id, currency).paidMinor) throw new Error("Повернення перевищує отриману оплату за замовленням.");
        }
        entry = core.createEntry({ companyId: company, currency, sourceType, projectId, projectTitle: project?.title || "", saleOrderId,
          saleOrderNumber: order?.number || "", buyerId: order?.buyerId || "", buyerName: order?.buyerName || "", direction: data.get("direction"), category,
          amountMinor, counterparty: data.get("counterparty"), purpose: data.get("purpose"), occurredAt: core.parseKyivDateTime(String(data.get("occurredAt"))), method: data.get("method"), createdBy: cloudState.user.id }, { id, now });
      }
      await appendEntry(entry);
      document.querySelector("#cashEntryDialog")?.close();
      syncMessage = "Операцію збережено на цьому пристрої. Синхронізація…";
      updateViews();
      void sync();
    } catch (error) {
      formElement.querySelector("#cashEntryMessage").textContent = error.message;
    } finally {
      busy = false;
      submit.disabled = false;
    }
  }

  function updateViews() {
    if (window.spartaDemoRunning) return;
    refreshAccess();
    renderView();
    if (typeof renderHome === "function") renderHome();
    if (typeof renderDetail === "function") renderDetail();
  }

  function downloadCsv() {
    if (!visible()) return;
    const csv = core.exportCsv(core.filterEntries(entries, filters));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sparta-cash-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  document.addEventListener("click", (event) => {
    const add = event.target.closest("[data-cash-add]");
    if (add) void openEntry(add.dataset.cashProject || "");
    const reverse = event.target.closest("[data-cash-reverse]");
    if (reverse) void openEntry("", reverse.dataset.cashReverse);
    if (event.target.closest("[data-cash-close]")) document.querySelector("#cashEntryDialog")?.close();
    if (event.target.closest("[data-cash-sync]")) { void loadSalesData(true); void sync(); }
    if (event.target.closest("[data-cash-export]")) downloadCsv();
    if (event.target.closest("[data-cash-reset]")) { filters = { currency: "USD", sourceType: filters.sourceType || "all" }; renderView(); }
    const source = event.target.closest("[data-cash-source]");
    if (source && Object.hasOwn(sourceTabs, source.dataset.cashSource) && visible()) { filters = { currency: filters.currency || "USD", sourceType: source.dataset.cashSource }; renderView(); }
    const project = event.target.closest("[data-cash-open-project]");
    if (project && visible()) { filters = { sourceType: "project", projectId: project.dataset.cashOpenProject, currency: currencyOf(projects.find((item) => String(item.id) === String(project.dataset.cashOpenProject))) }; renderView(); showSection("cash"); }
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches("#cashView [data-cash-currency]") && visible() && ["USD", "UAH"].includes(event.target.value)) {
      filters = { ...filters, currency: event.target.value };
      renderView();
      return;
    }
    if (event.target.matches('#cashEntryForm [name="sourceType"], #cashEntryForm [name="projectId"], #cashEntryForm [name="saleOrderId"]')) changeReference(event.target.form, event.target.name);
    if (event.target.matches('#cashEntryForm [name="direction"]')) fillCategories(event.target.form);
  });
  document.addEventListener("input", (event) => {
    if (event.target.matches('#cashFilterForm input[type="date"]')) {
      event.target.form.querySelector('[name="to"]').setCustomValidity("");
    }
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id === "cashEntryForm") { event.preventDefault(); void saveEntry(event.target); }
    if (event.target.id === "cashFilterForm") {
      event.preventDefault();
      const nextFilters = { ...Object.fromEntries(new FormData(event.target)), sourceType: filters.sourceType || "all" };
      try {
        core.filterEntries(entries, nextFilters);
        filters = nextFilters;
        renderView();
      } catch (error) {
        event.target.querySelector('[name="to"]').setCustomValidity(error.message);
        event.target.querySelector('[name="to"]').reportValidity();
      }
    }
  });
  window.addEventListener("online", () => { void sync(); });
  window.addEventListener("storage", (event) => {
    const key = window.SPARTA_LOCAL_WORKSPACE?.storageKey(storageKey(company)) || storageKey(company);
    if (company && event.key === key) {
      company = "";
      refreshAccess();
      updateViews();
    }
  });
  window.SpartaCashBook = { refreshAccess, renderView, projectMarkup, projectTotals, sync, openEntry, openForSale, postLocalEntry, reloadLocal };
})();
