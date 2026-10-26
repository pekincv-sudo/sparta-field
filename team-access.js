(function () {
  "use strict";
  const roles = Object.freeze({ owner: "Власник", admin: "Адміністратор", engineer: "Менеджер", brigadier: "Майстер", installer: "Монтажник", warehouse: "Комірник", viewer: "Перегляд" });
  const descriptions = Object.freeze({ owner: "Керування компанією, фінансами, працівниками та журналом подій.", admin: "Керування роботою компанії, фінансами, журналом і доступом працівників. Власників та адміністраторів призначає власник.", engineer: "Клієнти, CRM, картки об’єктів, технічні дані та плани матеріалів. Доступ до каси й приватних фінансів має власник або адміністратор.", brigadier: "Монтажні чеклісти, фотографії, файли об’єктів і призначені задачі бригади.", installer: "Монтажні чеклісти, фотографії, файли об’єктів і призначені задачі.", warehouse: "Каталог, прихід, залишки, резерв і видача матеріалів на об’єкти.", viewer: "Перегляд даних компанії без внесення змін." });
  const actions = Object.freeze({ create: "Додано", update: "Змінено", delete: "Видалено", login: "Вхід", logout: "Вихід", invite_accept: "Прийнято запрошення", invitation_sent: "Надіслано запрошення", invitation_delivery_failed: "Помилка надсилання листа" });
  const entities = Object.freeze({ companies: "Компанія", projects: "Об’єкт", project_technical: "Технічні дані", project_strings: "Стрінги", project_materials: "Матеріали об’єкта", project_tasks: "Задача CRM", project_photos: "Фотографія", project_files: "Файл / документ", warehouse_items: "Товар складу", warehouse_workspaces: "Складський документ", cash_transactions: "Операція каси", company_members: "Доступ працівника", company_invitations: "Запрошення", profiles: "Профіль", session: "Вхід / вихід" });
  const fields = Object.freeze({ title: "Назва", name: "Назва", full_name: "Ім’я", fullName: "Ім’я", email: "Email", role: "Роль", is_active: "Доступ активний", isActive: "Доступ активний", status: "Статус", address: "Адреса", client_name: "Клієнт", client_phone: "Телефон клієнта", phone: "Телефон", team_name: "Бригада", installation_date: "Дата монтажу", comment: "Коментар", note: "Нотатка", quantity: "Кількість", qty: "Кількість", actualQty: "Використано", issuedQty: "Видано", plannedQty: "Заплановано", currency: "Валюта", purchase_price: "Ціна закупівлі", sale_price: "Ціна продажу", amount_minor: "Сума в центах / копійках", counterparty: "Від кого / кому", purpose: "Призначення", due_at: "Термін задачі", assigned_to: "Виконавець", accepted_at: "Прийнято", expires_at: "Чинне до", revoked_at: "Відкликано", contractPrice: "Сума договору", installationPrice: "Вартість монтажу", crewPayroll: "Оплата бригади", advancePaid: "Початковий аванс", finance: "Фінанси", financeDetailsFingerprint: "Комплектація кошторису", equipmentFingerprint: "Комплектація обладнання", stateFingerprint: "Складські дані", rows: "Позиції", documents: "Документи", movements: "Переміщення", reservations: "Резерви", items: "Товари", work_checklist: "Хід монтажу" });
  const safe = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const roleLabel = (role) => roles[role] || "Доступ не визначено";
  const dateLabel = (value) => !value || !Number.isFinite(new Date(value).getTime()) ? "Ще не зафіксовано" : new Date(value).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "medium", timeStyle: "short" });
  const emptyFilters = () => ({ actor: "", entity: "", action: "", from: "", to: "" });
  let target = null, identity = "", epoch = 0, tab = "members", team = null, audit = null;
  let loading = false, auditLoading = false, loadTask = null, error = "", notice = "";
  let cursor = null, priorCursors = [], filters = emptyFilters(), memberQuery = "", memberStatus = "active";
  let pendingMember = "", pendingInvitation = "", auditSerial = 0;
  const pendingInvitationEmails = new Set();
  const invitationEmail = (email) => String(email || "").trim().toLowerCase();

  function context() {
    const cloud = typeof cloudState !== "undefined" ? cloudState : null;
    const local = Boolean(window.SPARTA_LOCAL_WORKSPACE?.enabled);
    return { local, ready: Boolean(!local && cloud?.ready && cloud?.user?.id && cloud?.companyId && cloud?.client), client: cloud?.client, userId: cloud?.user?.id || "", companyId: cloud?.companyId || "", role: cloud?.memberRole || "", key: `${local}:${cloud?.user?.id || ""}:${cloud?.companyId || ""}:${cloud?.memberRole || ""}` };
  }
  function canManage() { const ctx = context(); return ctx.ready && ["owner", "admin"].includes(ctx.role); }
  function reset() {
    epoch++; auditSerial++; identity = ""; team = null; audit = null; loading = false; auditLoading = false; loadTask = null;
    error = ""; notice = ""; cursor = null; priorCursors = []; filters = emptyFilters();
    memberQuery = ""; memberStatus = "active"; pendingMember = ""; pendingInvitation = ""; tab = "members";
    pendingInvitationEmails.clear();
    if (target) target.innerHTML = "";
  }
  function ensureContext() { const ctx = context(); if (ctx.key !== identity) { reset(); identity = ctx.key; } return ctx; }
  function current(ctx, version) { return context().key === ctx.key && epoch === version && canManage(); }
  function apiError(caught) {
    if (["PGRST202", "42883", "42P01", "PGRST205"].includes(caught?.code)) return "Керування командою ще не налаштовано в базі. Потрібне оновлення доступів і журналу подій.";
    if (caught?.code === "42501") return "Доступ до керування командою змінився. Оновіть сторінку та перевірте свою роль.";
    return caught?.message || "Не вдалося отримати дані. Перевірте підключення та повторіть спробу.";
  }
  async function rpc(ctx, name, params) { const result = await ctx.client.rpc(name, params); if (result.error) throw result.error; return result.data; }
  function setInvitationDelivery(email, { pending = false, ok = false, message = "" } = {}) {
    ensureContext();
    if (!canManage()) { render(); return; }
    const recipient = invitationEmail(email);
    if (!recipient) return;
    error = ""; notice = "";
    if (pending) pendingInvitationEmails.add(recipient);
    else {
      pendingInvitationEmails.delete(recipient);
      if (ok) notice = String(message || "Лист надіслано.");
      else error = String(message || "Не вдалося надіслати лист. Спробуйте повторно.");
    }
    render();
  }
  function profileMarkup() {
    const ctx = context(); if (!ctx.ready) return "";
    return `<article class="team-profile-access"><h3>Ваш доступ: ${safe(roleLabel(ctx.role))}</h3><p>${safe(descriptions[ctx.role] || "Зверніться до власника компанії.")}</p>${canManage() ? `<button type="button" class="secondary-button" data-team-open>Команда та журнал дій</button>` : ""}</article>`;
  }
  function render(node = target) {
    if (!node) return; target = node; const ctx = ensureContext();
    if (!ctx.ready) { target.innerHTML = `<section class="team-app"><header class="team-heading"><h2>Команда</h2></header><p class="team-empty">${ctx.local ? "Спільні облікові записи й журнал компанії доступні у публічній версії після входу. Локальна база залишається окремою." : "Увійдіть у свій обліковий запис компанії, щоб переглянути доступ."}</p></section>`; return; }
    if (!canManage()) { target.innerHTML = `<section class="team-app">${profileMarkup()}<p class="team-empty">Доступами та журналом компанії керують власник і адміністратор.</p></section>`; return; }
    target.innerHTML = `<section class="team-app"><header class="team-heading"><div><p class="eyebrow">Команда та відповідальність</p><h2>Учасники й історія</h2><p>Особисті облікові записи, права та збережені дії працівників.</p></div><div class="team-actions"><button type="button" class="secondary-button" data-team-refresh ${loading || auditLoading ? "disabled" : ""}>Оновити</button><button type="button" class="primary-button" data-team-invite>+ Запросити працівника</button></div></header><nav class="team-tabs" role="tablist" aria-label="Керування командою">${[["members", "Учасники"], ["invitations", "Запрошення"], ["activity", "Журнал дій"]].map(([key, label]) => `<button type="button" role="tab" aria-selected="${tab === key}" data-team-tab="${key}" ${tab === key ? 'class="active"' : ""}>${label}</button>`).join("")}</nav>${error ? `<p class="team-message error" role="alert">${safe(error)}</p>` : ""}${notice ? `<p class="team-message" role="status">${safe(notice)}</p>` : ""}${loading && !team ? `<p class="team-empty" role="status">Завантажую учасників компанії…</p>` : tab === "members" ? membersMarkup(ctx) : tab === "invitations" ? invitationsMarkup(ctx) : auditMarkup()}<details class="team-permissions"><summary>Що дозволяє кожна роль</summary><div class="team-role-grid">${Object.entries(roles).map(([key, label]) => `<article><strong>${safe(label)}</strong><p>${safe(descriptions[key])}</p></article>`).join("")}</div></details></section>`;
    if (!team && !loading && !error) void refresh();
    else if (tab === "activity" && !audit && !auditLoading && !error) void loadAudit();
  }
  function membersMarkup(ctx) {
    const members = team?.members || [], query = memberQuery.trim().toLocaleLowerCase("uk-UA");
    const visible = members.filter((member) => (!query || `${member.fullName || ""} ${member.email || ""}`.toLocaleLowerCase("uk-UA").includes(query)) && (memberStatus === "all" || (memberStatus === "active") === Boolean(member.isActive)));
    return `<form class="team-member-filter" data-team-member-filter><label>Пошук працівника<input name="query" type="search" value="${safe(memberQuery)}" placeholder="Ім’я або email" /></label><label>Доступ<select name="status"><option value="active" ${memberStatus === "active" ? "selected" : ""}>Активні</option><option value="inactive" ${memberStatus === "inactive" ? "selected" : ""}>Призупинені</option><option value="all" ${memberStatus === "all" ? "selected" : ""}>Усі учасники</option></select></label><button type="submit" class="secondary-button">Знайти</button></form><p class="team-muted">Показано ${visible.length} із ${members.length} учасників. Час входу — за Києвом.</p><div class="team-member-list">${visible.map((member) => {
      const self = member.userId === ctx.userId, protectedRole = ctx.role !== "owner" && ["owner", "admin"].includes(member.role);
      const lastOwner = member.role === "owner" && member.isActive && members.filter((item) => item.role === "owner" && item.isActive).length <= 1;
      const locked = self || protectedRole || lastOwner;
      const options = Object.entries(roles).filter(([key]) => ctx.role === "owner" || !["owner", "admin"].includes(key));
      if (!options.some(([key]) => key === member.role)) options.unshift([member.role, roleLabel(member.role)]);
      return `<article class="team-member-card ${member.isActive ? "" : "is-inactive"}"><div class="team-member-info"><h3>${safe(member.fullName || member.email || "Працівник")}${self ? `<span class="team-badge">Ви</span>` : ""}</h3><p>${safe(member.email || "Email не вказано")}</p>${member.phone ? `<p>${safe(member.phone)}</p>` : ""}<small>Останній вхід: ${safe(dateLabel(member.lastLoginAt))}</small></div><form class="team-member-edit" data-team-member="${safe(member.userId)}"><label>Роль<select name="role" ${locked || pendingMember === member.userId ? "disabled" : ""}>${options.map(([key, label]) => `<option value="${safe(key)}" ${member.role === key ? "selected" : ""}>${safe(label)}</option>`).join("")}</select></label><label>Доступ<select name="isActive" ${locked || pendingMember === member.userId ? "disabled" : ""}><option value="true" ${member.isActive ? "selected" : ""}>Активний</option><option value="false" ${!member.isActive ? "selected" : ""}>Призупинений</option></select></label>${locked ? `<p class="team-muted">${self ? "Власний доступ тут не змінюється." : protectedRole ? "Цей доступ змінює власник." : "Потрібен щонайменше один активний власник."}</p>` : `<button type="submit" class="secondary-button" ${pendingMember ? "disabled" : ""}>${pendingMember === member.userId ? "Зберігаю…" : "Зберегти доступ"}</button>`}</form></article>`;
    }).join("") || `<p class="team-empty">Учасників за цими умовами не знайдено.</p>`}</div>`;
  }
  function invitationStatus(invitation) {
    if (invitation.status === "accepted") return "Прийнято";
    if (invitation.status === "revoked") return "Відкликано";
    if (invitation.status === "expired" || invitation.expiresAt && new Date(invitation.expiresAt).getTime() < Date.now()) return "Строк минув";
    return "Очікує прийняття";
  }
  function invitationsMarkup(ctx) {
    return `<p class="team-muted">Працівник отримує власний обліковий запис за email із запрошення. Роль призначається компанією після підтвердження адреси.</p><div class="team-invitation-list">${(team?.invitations || []).map((invitation) => {
      const pending = !["accepted", "revoked", "expired"].includes(invitation.status) && (!invitation.expiresAt || new Date(invitation.expiresAt).getTime() >= Date.now());
      const manageable = ctx.role === "owner" || !["owner", "admin"].includes(invitation.role);
      const sending = pendingInvitationEmails.has(invitationEmail(invitation.email));
      const delivery = { unsent: "Лист ще не надіслано", sending: "Лист надсилається…", sent: "Лист надіслано", failed: "Не вдалося надіслати лист" }[invitation.lastSendStatus] || "";
      return `<article class="team-invitation-card"><div><h3>${safe(invitation.fullName || invitation.email)}</h3><p>${safe(invitation.email)}</p><span class="team-badge">${safe(roleLabel(invitation.role))}</span><small>Створено: ${safe(dateLabel(invitation.createdAt))}${invitation.expiresAt ? `<br>Чинне до: ${safe(dateLabel(invitation.expiresAt))}` : ""}${delivery ? `<br>${safe(delivery)}${invitation.lastSentAt ? ` · ${safe(dateLabel(invitation.lastSentAt))}` : ""}` : ""}</small></div><div class="team-invitation-actions"><strong>${safe(invitationStatus(invitation))}</strong>${manageable && invitation.status !== "accepted" ? `<button type="button" class="secondary-button" data-team-resend="${safe(invitation.email)}" ${sending ? "disabled" : ""}>${sending ? "Надсилаю…" : pending ? invitation.lastSendStatus === "unsent" ? "Надіслати лист" : "Повторити лист" : "Запросити повторно"}</button>` : ""}${pending && manageable ? `<button type="button" class="secondary-button" data-team-revoke="${safe(invitation.id)}" ${pendingInvitation ? "disabled" : ""}>${pendingInvitation === invitation.id ? "Відкликаю…" : "Відкликати"}</button>` : ""}</div></article>`;
    }).join("") || `<p class="team-empty">Запрошень ще немає. Додайте працівника кнопкою «Запросити працівника».</p>`}</div>`;
  }
  function changedValue(value, field) {
    if (value == null || value === "") return "Не вказано";
    if (typeof value === "boolean") return value ? "Так" : "Ні";
    if (field === "role") return roleLabel(value);
    return (typeof value === "object" ? JSON.stringify(value) : String(value)).slice(0, 500);
  }
  function changesMarkup(changes) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) return "";
    const values = Object.entries(changes).filter(([, value]) => value && typeof value === "object" && ("before" in value || "after" in value));
    return values.length ? `<details class="team-change-details"><summary>Що змінилося · ${values.length}</summary><dl>${values.slice(0,60).map(([field, value]) => `<div><dt>${safe(fields[field] || field)}</dt><dd><span>${field.endsWith("Fingerprint") ? "Попередня версія" : safe(changedValue(value.before, field))}</span><span aria-hidden="true"> → </span><strong>${field.endsWith("Fingerprint") ? "Оновлено" : safe(changedValue(value.after, field))}</strong></dd></div>`).join("")}</dl></details>` : "";
  }
  function auditMarkup() {
    const entries = audit?.entries || [];
    return `<form class="team-audit-filters" data-team-audit-filter><label>Користувач<select name="actor"><option value="">Усі користувачі</option>${(team?.members || []).map((member) => `<option value="${safe(member.userId)}" ${filters.actor === member.userId ? "selected" : ""}>${safe(member.fullName || member.email)}</option>`).join("")}</select></label><label>Подія<select name="action"><option value="">Усі події</option>${Object.entries(actions).map(([key,label]) => `<option value="${key}" ${filters.action === key ? "selected" : ""}>${safe(label)}</option>`).join("")}</select></label><label>Розділ<select name="entity"><option value="">Усі розділи</option>${Object.entries(entities).map(([key,label]) => `<option value="${key}" ${filters.entity === key ? "selected" : ""}>${safe(label)}</option>`).join("")}</select></label><label>Від дати<input type="date" name="from" value="${safe(filters.from)}" /></label><label>До дати<input type="date" name="to" value="${safe(filters.to)}" /></label><button type="submit" class="secondary-button" ${auditLoading ? "disabled" : ""}>Застосувати</button><button type="button" class="text-action" data-team-audit-reset>Скинути</button></form><p class="team-muted">Події фіксуються з моменту увімкнення журналу. Час — за Києвом. ${audit?.total != null ? `Знайдено: ${safe(audit.total)}.` : ""}</p>${auditLoading ? `<p class="team-message" role="status">Завантажую події…</p>` : ""}<div class="team-audit-list" aria-live="polite">${entries.map((entry) => `<article class="team-audit-card"><div class="team-event-time"><time datetime="${safe(entry.occurredAt)}">${safe(dateLabel(entry.occurredAt))}</time><span class="team-badge">${safe(actions[entry.action] || entry.action || "Подія")}</span></div><div class="team-event-main"><h3>${safe(entry.entityTitle || entities[entry.entityType] || entry.entityType || "Подія компанії")}</h3><p>${safe(entry.summary || entities[entry.entityType] || "Збережено зміну")}</p>${changesMarkup(entry.changes)}</div><div class="team-event-actor"><strong>${safe(entry.actorName || entry.actorEmail || (entry.actorId ? "Користувач" : "Системна дія"))}</strong>${entry.actorEmail ? `<span>${safe(entry.actorEmail)}</span>` : ""}<small>${safe(entry.actorRole ? roleLabel(entry.actorRole) : "Система")}</small></div></article>`).join("") || (!auditLoading ? `<p class="team-empty">За обраними умовами подій ще немає.</p>` : "")}</div><div class="team-pagination"><button type="button" class="secondary-button" data-team-audit-prev ${priorCursors.length && !auditLoading ? "" : "disabled"}>← Новіші</button><span>Сторінка ${priorCursors.length + 1} · ${entries.length} подій</span><button type="button" class="secondary-button" data-team-audit-next ${audit?.hasMore && !auditLoading ? "" : "disabled"}>Старіші →</button></div>`;
  }
  async function refresh() {
    const ctx = ensureContext(); if (!canManage()) { render(); return; } if (loadTask) return loadTask;
    const version = epoch; loading = true; error = ""; render();
    const task = (async () => {
      try { const data = await rpc(ctx,"sparta_team_list",{p_company_id:ctx.companyId}); if (!current(ctx,version)) return; if (!data || !Array.isArray(data.members) || !Array.isArray(data.invitations)) throw new Error("База повернула некоректний список команди."); team = data; }
      catch (caught) { if (current(ctx,version)) { error = apiError(caught); team = null; audit = null; } }
      finally { if (current(ctx,version)) { loading = false; loadTask = null; render(); } }
    })(); loadTask = task; return task;
  }
  function auditDates() {
    if (filters.from && filters.to && filters.from > filters.to) throw new Error("Початок періоду має бути не пізніше закінчення.");
    const boundary = (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Перевірте дату журналу.");
      if (!window.SpartaCash?.parseKyivDateTime) throw new Error("Не вдалося визначити київський час. Оновіть сторінку.");
      return window.SpartaCash.parseKyivDateTime(`${value}T00:00`);
    };
    let end = null;
    if (filters.to) { boundary(filters.to); const date = new Date(`${filters.to}T12:00:00Z`); date.setUTCDate(date.getUTCDate()+1); end = boundary(date.toISOString().slice(0,10)); }
    return {p_from:filters.from ? boundary(filters.from) : null,p_to:end};
  }
  async function loadAudit() {
    const ctx=ensureContext(); if (!canManage()) return; const version=epoch, serial=++auditSerial;
    let dates; try { dates=auditDates(); } catch(caught) { error=caught.message; render(); return; }
    auditLoading=true; error=""; render();
    try { const data=await rpc(ctx,"sparta_audit_list",{p_company_id:ctx.companyId,p_limit:30,p_before_id:cursor,p_entity:filters.entity||null,p_actor:filters.actor||null,p_action:filters.action||null,...dates}); if(!current(ctx,version)||serial!==auditSerial)return; if(!data||!Array.isArray(data.entries))throw new Error("База повернула некоректний журнал подій."); audit=data; }
    catch(caught) { if(current(ctx,version)&&serial===auditSerial){error=apiError(caught);audit=null;} }
    finally { if(current(ctx,version)&&serial===auditSerial){auditLoading=false;render();} }
  }
  async function updateMember(userId,role,isActive) {
    const ctx=ensureContext(); if(!canManage()||pendingMember)return;
    const member=team?.members?.find(item=>item.userId===userId);
    if(!member||!roles[role])throw new Error("Оберіть працівника й відому роль.");
    if(userId===ctx.userId)throw new Error("Власний доступ тут не змінюється.");
    if(ctx.role!=="owner"&&(["owner","admin"].includes(member.role)||["owner","admin"].includes(role)))throw new Error("Цей доступ змінює тільки власник.");
    if(member.role==="owner"&&member.isActive&&(role!=="owner"||!isActive)&&team.members.filter(item=>item.role==="owner"&&item.isActive).length<=1)throw new Error("Потрібен щонайменше один активний власник.");
    if(member.role===role&&Boolean(member.isActive)===Boolean(isActive)){notice="Доступ уже має ці налаштування.";render();return;}
    const version=epoch;pendingMember=userId;error="";notice="";render();
    try { await rpc(ctx,"sparta_team_update_member",{p_company_id:ctx.companyId,p_user_id:userId,p_role:role,p_is_active:Boolean(isActive)});if(!current(ctx,version))return;notice="Доступ працівника оновлено. Зміну збережено в журналі.";audit=null;cursor=null;priorCursors=[];await refresh(); }
    catch(caught){if(current(ctx,version)){error=apiError(caught);render();}}
    finally{if(current(ctx,version)){pendingMember="";render();}}
  }
  async function revokeInvitation(invitationId) {
    const ctx=ensureContext();if(!canManage()||pendingInvitation)return;
    const invitation=team?.invitations?.find(item=>item.id===invitationId);
    if(!invitation)throw new Error("Запрошення не знайдено.");
    if(ctx.role!=="owner"&&["owner","admin"].includes(invitation.role))throw new Error("Це запрошення відкликає власник.");
    const version=epoch;pendingInvitation=invitationId;error="";notice="";render();
    try{await rpc(ctx,"sparta_team_revoke_invitation",{p_company_id:ctx.companyId,p_invitation_id:invitationId});if(!current(ctx,version))return;notice="Запрошення відкликано. Історію збережено.";audit=null;cursor=null;priorCursors=[];await refresh();}
    catch(caught){if(current(ctx,version)){error=apiError(caught);render();}}
    finally{if(current(ctx,version)){pendingInvitation="";render();}}
  }
  document.addEventListener("click",event=>{
    const button=event.target.closest?.("[data-team-tab],[data-team-refresh],[data-team-revoke],[data-team-audit-next],[data-team-audit-prev],[data-team-audit-reset]");
    if(!button||!target?.contains(button))return;
    if(button.dataset.teamTab){tab=["members","invitations","activity"].includes(button.dataset.teamTab)?button.dataset.teamTab:"members";error="";notice="";render();}
    if(button.hasAttribute("data-team-refresh")){audit=null;cursor=null;priorCursors=[];notice="";void refresh();}
    if(button.dataset.teamRevoke)void revokeInvitation(button.dataset.teamRevoke).catch(caught=>{error=caught.message;render();});
    if(button.hasAttribute("data-team-audit-next")&&audit?.hasMore&&audit.nextCursor&&!auditLoading){priorCursors.push(cursor);cursor=audit.nextCursor;void loadAudit();}
    if(button.hasAttribute("data-team-audit-prev")&&priorCursors.length&&!auditLoading){cursor=priorCursors.pop();void loadAudit();}
    if(button.hasAttribute("data-team-audit-reset")){filters=emptyFilters();cursor=null;priorCursors=[];void loadAudit();}
  });
  document.addEventListener("submit",event=>{
    const form=event.target;if(!target?.contains(form))return;
    if(form.hasAttribute("data-team-member")){event.preventDefault();const data=new FormData(form);void updateMember(form.dataset.teamMember,String(data.get("role")||""),data.get("isActive")==="true").catch(caught=>{error=caught.message;render();});}
    if(form.hasAttribute("data-team-member-filter")){event.preventDefault();const data=new FormData(form);memberQuery=String(data.get("query")||"");memberStatus=["active","inactive","all"].includes(data.get("status"))?data.get("status"):"active";render();}
    if(form.hasAttribute("data-team-audit-filter")){event.preventDefault();const data=new FormData(form);filters=Object.fromEntries(["actor","entity","action","from","to"].map(key=>[key,String(data.get(key)||"")]));cursor=null;priorCursors=[];audit=null;void loadAudit();}
  });
  window.SpartaTeamAccess=Object.freeze({render,refresh,reset,profileMarkup,roleLabel,canManage,updateMember,revokeInvitation,setInvitationDelivery,loadAudit,roles,descriptions});
})();
