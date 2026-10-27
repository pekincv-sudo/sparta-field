(function () {
  "use strict";
  let accounts = [], buyerId = "", buyerUserId = "", epoch = 0;
  const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const staffRoles = ["owner", "admin", "engineer", "warehouse"];
  const local = () => Boolean(window.SPARTA_LOCAL_WORKSPACE?.enabled);
  const cloud = () => typeof cloudState === "undefined" ? {} : cloudState;
  function reset() { epoch++; accounts = []; buyerId = ""; buyerUserId = ""; window.SpartaBuyerUI?.reset(); }
  function isBuyerReady() {
    const state = cloud();
    return !local() && state.audience === "buyer" && state.user?.id === buyerUserId && Boolean(accounts.find((a) => a.id === buyerId && a.isActive !== false));
  }
  function getContext() {
    const state = cloud(), buyer = accounts.find((a) => a.id === buyerId);
    return { audience: isBuyerReady() ? "buyer" : "staff", role: state.memberRole || "", companyId: isBuyerReady() ? buyer.companyId : state.companyId,
      buyerId: isBuyerReady() ? buyerId : "", accounts: copy(isBuyerReady() ? accounts : []), userId: state.user?.id || "", companyName: isBuyerReady() ? buyer.companyName : "SPARTA Power", ready: isBuyerReady() || Boolean(state.ready), local: local() };
  }
  function requestContext(kind = "either") {
    const state = cloud(), context = getContext();
    if (local()) throw fail("Кабінет покупця працює з публічною базою. Відкрийте публічну версію застосунку.", "LOCAL_ONLY");
    if (!state.client || !state.user?.id) throw fail("Увійдіть у власний акаунт.", "AUTH_REQUIRED");
    if (kind === "staff" && (!state.ready || !staffRoles.includes(state.memberRole))) throw fail("Розділ продажів доступний працівникам компанії.", "42501");
    if (kind === "buyer" && !isBuyerReady()) throw fail("Доступ покупця не підтверджено.", "42501");
    if (kind === "either" && !isBuyerReady() && (!state.ready || !staffRoles.includes(state.memberRole))) throw fail("Доступ не підтверджено.", "42501");
    return { client: state.client, userId: state.user.id, companyId: context.companyId, buyerId: context.buyerId, identity: `${state.user.id}:${context.companyId}:${context.buyerId}`, epoch };
  }
  function current(ctx) { const state = cloud(), now = getContext(); return ctx.epoch === epoch && state.user?.id === ctx.userId && ctx.identity === `${state.user.id}:${now.companyId}:${now.buyerId}`; }
  function fail(message, code, status) { return Object.assign(new Error(message), { code, status, definitive: true }); }
  function errorOf(error) {
    let message = error?.message || "Не вдалося з’єднатися з базою. Повторіть запит після відновлення зв’язку.";
    if (error?.code === "PGRST202" || /function .*does not exist/i.test(message)) message = "Кабінет покупця ще не підключено до бази. Потрібне оновлення buyer-portal.sql.";
    else if (error?.code === "42501") message = "Доступ до цієї операції відсутній або призупинений. Оновіть сторінку чи зверніться до менеджера.";
    else if (/expected.*total|price.*changed|quote.*changed|price mismatch/i.test(message)) message = "Ціни змінилися. Оновіть каталог і перевірте суму перед оформленням.";
    else if (/insufficient|not enough|exceed.*stock|available stock|reservations exceed/i.test(message)) message = "Доступного залишку недостатньо. Оновіть каталог і перевірте кількість.";
    else if (/price.*(missing|unset|positive|not set)|installer.*price|unpriced/i.test(message)) message = "Для одного з товарів ще не задана ціна вашого типу. Уточніть її у менеджера.";
    else if (error?.code === "40001") message = "Залишок уже змінився. Оновіть дані та повторіть операцію.";
    return Object.assign(new Error(message), { code: error?.code || "", status: error?.status, definitive: Boolean(error?.code) });
  }
  async function rpc(ctx, name, params) {
    let result;
    try { result = await ctx.client.rpc(name, params); } catch (error) { throw errorOf(error); }
    if (!current(ctx)) throw fail("Акаунт або компанія змінилися. Відкрийте розділ заново.", "CONTEXT_CHANGED");
    if (result.error) throw errorOf(result.error);
    return copy(result.data);
  }
  async function restore() {
    const state = cloud();
    if (local() || !state.client || !state.user?.id) return false;
    const client = state.client, user = state.user.id, version = epoch;
    const accepted = await client.rpc("sparta_buyer_accept_invitation");
    if (version !== epoch || cloud().user?.id !== user) return false;
    if (accepted.error && accepted.error.code !== "PGRST202") throw errorOf(accepted.error);
    if (accepted.error) return false;
    const result = await client.rpc("sparta_buyer_context");
    if (version !== epoch || cloud().user?.id !== user) return false;
    if (result.error) { if (result.error.code === "PGRST202") return false; throw errorOf(result.error); }
    const values = Array.isArray(result.data) ? result.data : result.data?.accounts || [];
    accounts = values.filter((a) => a && a.id && a.companyId && a.isActive !== false);
    if (!accounts.length) { buyerId = ""; buyerUserId = ""; return false; }
    buyerUserId = user; buyerId = accounts[0].id;
    return copy(accounts[0]);
  }
  function selectAccount(id) {
    const next = accounts.find((a) => a.id === id && a.isActive !== false);
    if (!isBuyerReady() || !next) throw fail("Кабінет покупця недоступний.", "42501");
    epoch++; buyerId = next.id; cloud().companyId = next.companyId; cloud().buyerAccountId = next.id;
    window.SpartaBuyerUI?.reset(); render(); return getContext();
  }
  async function refreshAccess() {
    if (!isBuyerReady()) return false;
    const ctx = requestContext("buyer"), selected = buyerId;
    let data;
    try { data = await rpc(ctx, "sparta_buyer_context", {}); }
    catch (error) {
      if (["42501", "PGRST301"].includes(error.code)) {
        clearCompanyContext(); cloud().message = "Доступ до кабінету покупця призупинено. Зверніться до менеджера."; updateAccessMode(); render(); return false;
      }
      throw error;
    }
    const next = (Array.isArray(data) ? data : data?.accounts || []).filter((a) => a && a.id && a.companyId && a.isActive !== false);
    if (!next.some((a) => a.id === selected)) {
      clearCompanyContext(); cloud().message = "Доступ до кабінету покупця призупинено. Зверніться до менеджера."; updateAccessMode(); render(); return false;
    }
    accounts = next;
    return true;
  }
  async function recordSession(event) {
    if (!isBuyerReady()) return;
    const ctx = requestContext("buyer");
    await rpc(ctx, "sparta_buyer_record_session_event", { p_buyer_id: ctx.buyerId, p_event: event });
  }
  function buyerRequest(name, id, extra = {}) {
    const ctx = requestContext("buyer");
    if (id && id !== ctx.buyerId) throw fail("Замовлення іншого покупця недоступне.", "42501");
    return rpc(ctx, name, { p_buyer_id: ctx.buyerId, ...extra });
  }
  function staffRequest(name, extra = {}) { const ctx = requestContext("staff"); return rpc(ctx, name, { p_company_id: ctx.companyId, ...extra }); }
  async function stockAction(params) {
    const ctx = requestContext("staff");
    const result = await rpc(ctx, "sparta_sales_order_action", { p_order_id: params.orderId, p_action: params.action, p_request_id: params.requestId });
    // The order is already acknowledged. A failed follow-up read must never
    // turn that success into an apparent failed confirmation or issue.
    window.SpartaWarehouseCloud?.invalidate();
    try { await window.SpartaWarehouseCloud?.load(); }
    catch (_) { if (result && typeof result === "object") result.warning = "Замовлення збережено. Оновіть склад для актуальних залишків."; }
    if (!current(ctx)) throw fail("Акаунт або компанія змінилися. Відкрийте розділ заново.", "CONTEXT_CHANGED");
    return result;
  }
  async function sendAccess(invitation, email) {
    const ctx = requestContext("staff");
    if (!["owner", "admin"].includes(cloud().memberRole)) throw fail("Доступ покупцям надсилає власник або адміністратор.", "42501");
    const id = typeof invitation === "string" ? invitation : invitation?.id;
    const recipient = email || invitation?.email;
    if (!id || !recipient) throw fail("Спочатку збережіть покупця та запрошення.", "INVALID_INVITATION");
    const session = await ctx.client.auth.getSession();
    if (!current(ctx)) throw fail("Акаунт змінився.", "CONTEXT_CHANGED");
    if (session.error || !session.data?.session?.access_token) throw fail("Увійдіть повторно перед надсиланням листа.", "AUTH_REQUIRED");
    let response;
    try { response = await fetch("/api/send-invitation", { method: "POST", headers: { Authorization: `Bearer ${session.data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "buyer", companyId: ctx.companyId, invitationId: id, email: recipient }) }); }
    catch (error) { throw errorOf(error); }
    const payload = await response.json().catch(() => ({}));
    if (!current(ctx)) throw fail("Акаунт змінився.", "CONTEXT_CHANGED");
    if (!response.ok) throw fail(payload.error || "Лист не надіслано. Покупця збережено, спробуйте повторно.", `HTTP_${response.status}`, response.status);
    return payload;
  }
  window.SpartaBuyerCloud = Object.freeze({ reset, restore, isBuyerReady, getContext, selectAccount, refreshAccess, recordSession, sendAccess,
    catalog: (id) => buyerRequest("sparta_buyer_catalog", id), orders: (id) => buyerRequest("sparta_buyer_orders", id),
    submitOrder: (input) => buyerRequest("sparta_buyer_submit_order", input.buyerId, { p_request_id: input.requestId, p_lines: input.lines, p_delivery: input.delivery, p_expected_total: input.expectedTotal }),
    cancelOrder: (input) => { const ctx = requestContext("buyer"); return rpc(ctx, "sparta_buyer_cancel_order", { p_order_id: input.orderId, p_request_id: input.requestId }); },
    buyers: () => staffRequest("sparta_sales_buyers"), salesOrders: () => staffRequest("sparta_sales_orders"),
    unlinkedSales: () => staffRequest("sparta_sales_unlinked_sales"),
    linkPurchase: (input) => { const ctx = requestContext("staff"); return rpc(ctx, "sparta_sales_link_purchase", { p_buyer_id: input.buyerId, p_document_id: input.documentId, p_request_id: input.requestId }); },
    saveBuyer: (buyer) => staffRequest("sparta_sales_save_buyer", { p_buyer: buyer }), orderAction: stockAction,
    signOut: () => logoutCloudUser(),
    changePassword: () => { document.querySelector("#passwordForm").reset(); document.querySelector("#passwordMessage").textContent = "Задайте власний пароль."; document.querySelector("#passwordDialog").showModal(); },
  });
})();
