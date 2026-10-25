export const config = { runtime: "edge" };

const SUPABASE_URL = process.env.SUPABASE_URL || "https://klltykfmbsobqumpolyd.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_8HG6jI0L1h9RKjOzq-mV4g_rNkiQy4s";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_ORIGIN = "https://sparta-field-u2pe.vercel.app";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["owner", "admin", "engineer", "brigadier", "installer", "warehouse", "viewer"];
const EXISTING_USER_CODES = new Set(["email_exists", "user_already_exists", "user_already_registered"]);

export default async function handler(request) {
  if (request.method === "OPTIONS") return json(null, 204);
  if (request.method !== "POST") return json({ error: "Метод не підтримується." }, 405);
  const token = bearer(request.headers.get("authorization"));
  if (!token) return json({ error: "Увійдіть у свій акаунт." }, 401);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 8192) return json({ error: "Запит завеликий." }, 413);
    body = JSON.parse(raw);
  } catch (_) { return json({ error: "Некоректний запит." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Некоректний запит." }, 400);
  const email = String(body.email || "").trim().toLowerCase();
  const companyId = String(body.companyId || "").trim().toLowerCase();
  const invitationId = String(body.invitationId || "").trim().toLowerCase();
  if (!UUID.test(companyId) || !UUID.test(invitationId) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Вкажіть чинне запрошення, компанію та email користувача." }, 400);
  }
  let user;
  try {
    const response = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) return json({ error: "Увійдіть у свій акаунт повторно." }, 401);
    if (!response.ok) return json({ error: "Не вдалося перевірити вхід. Спробуйте пізніше." }, 503);
    user = await readJson(response);
    if (!UUID.test(String(user.id || ""))) return json({ error: "Увійдіть у свій акаунт повторно." }, 401);
    if (!user.email_confirmed_at) return json({ error: "Підтвердіть email свого акаунта." }, 403);
  } catch (_) { return json({ error: "Не вдалося перевірити вхід. Спробуйте пізніше." }, 503); }
  // Configuration details are never disclosed to unauthenticated callers.
  if (!SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Надсилання запрошень ще не налаштовано." }, 503);
  let actorRole;
  let invitation;
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/company_members`);
    url.searchParams.set("select", "role,is_active");
    url.searchParams.set("company_id", `eq.${companyId}`);
    url.searchParams.set("user_id", `eq.${user.id}`);
    url.searchParams.set("is_active", "eq.true");
    const response = await fetchWithTimeout(url, { headers: serviceHeaders(), cache: "no-store" });
    if (!response.ok) return json({ error: "Не вдалося перевірити права доступу." }, 503);
    const members = await readJson(response);
    const member = Array.isArray(members) && members.length === 1 ? members[0] : null;
    if (!member?.is_active || !["owner", "admin"].includes(member.role)) return json({ error: "Запрошення надсилає власник або адміністратор компанії." }, 403);
    actorRole = member.role;
    // Recheck rights and pending state under a row lock; enforce one cooldown
    // across all devices before any email is sent.
    const prepared = await rpc("sparta_team_prepare_invitation_email", { p_invitation_id: invitationId, p_actor_id: user.id });
    if (!prepared.ok) return prepareError(prepared);
    invitation = prepared.data;
    if (!invitation || invitation.id !== invitationId || invitation.company_id !== companyId ||
        String(invitation.email || "").toLowerCase() !== email || !ROLES.includes(invitation.role) ||
        invitation.accepted_at !== null || invitation.revoked_at !== null ||
        !Number.isFinite(Date.parse(invitation.expires_at)) || Date.parse(invitation.expires_at) <= Date.now()) {
      return json({ error: "Запрошення вже не чинне. Оновіть список запрошень." }, 409);
    }
    if (actorRole === "admin" && ["owner", "admin"].includes(invitation.role)) return json({ error: "Лише власник може запрошувати адміністраторів або власників." }, 403);
  } catch (_) { return json({ error: "Не вдалося перевірити запрошення. Спробуйте пізніше." }, 503); }
  let mode = "invite";
  let sent = false;
  let limited = false;
  try {
    const inviteUrl = new URL(`${SUPABASE_URL}/auth/v1/invite`);
    inviteUrl.searchParams.set("redirect_to", `${APP_ORIGIN}/?auth=invite`);
    const result = await fetchWithTimeout(inviteUrl, {
      method: "POST", headers: serviceHeaders(), body: JSON.stringify({ email, data: {
        full_name: String(invitation.full_name || "").slice(0, 300), company_id: companyId, invitation_id: invitationId,
      } }),
    });
    sent = result.ok;
    limited = result.status === 429;
    if (!sent) {
      const detail = await readJson(result);
      const code = String(detail.error_code || detail.code || "").toLowerCase();
      if (EXISTING_USER_CODES.has(code)) {
        mode = "recovery";
        const recoveryUrl = new URL(`${SUPABASE_URL}/auth/v1/recover`);
        recoveryUrl.searchParams.set("redirect_to", `${APP_ORIGIN}/?auth=recovery`);
        const recovery = await fetchWithTimeout(recoveryUrl, {
          method: "POST", headers: apiKeyHeaders(SUPABASE_ANON_KEY),
          body: JSON.stringify({ email }),
        });
        sent = recovery.ok;
        limited = recovery.status === 429;
      }
    }
  } catch (_) { sent = false; }
  let recorded = false;
  try {
    recorded = (await rpc("sparta_team_record_invitation_delivery", {
      p_invitation_id: invitationId, p_actor_id: user.id, p_succeeded: sent, p_mode: mode,
    })).ok;
  } catch (_) { /* Email may already be sent; never claim that it was not. */ }
  if (!sent) return json({ error: limited ? "Забагато спроб надсилання. Зачекайте та повторіть." : "Не вдалося надіслати лист. Спробуйте пізніше або перевірте налаштування пошти." }, limited ? 429 : 502);
  return json({
    message: mode === "recovery" ? "Користувач уже має акаунт. Лист для встановлення пароля надіслано." : "Лист-запрошення надіслано. Користувач зможе встановити власний пароль.",
    mode, deliveryRecorded: recorded,
    ...(recorded ? {} : { warning: "Лист надіслано, але результат не вдалося записати в журналі. Оновіть список запрошень." }),
  });
}

function json(payload, status = 200) {
  return new Response(payload === null ? null : JSON.stringify(payload), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": APP_ORIGIN, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type",
    ...(status === 429 ? { "Retry-After": "60" } : {}),
  } });
}
function bearer(value) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(value || ""));
  return match && match[1].length <= 8192 ? match[1] : "";
}
function serviceHeaders() {
  return apiKeyHeaders(SUPABASE_SERVICE_ROLE_KEY);
}
function apiKeyHeaders(key) {
  const headers = { apikey: key, "Content-Type": "application/json" };
  // New API keys are not JWTs; the gateway resolves their role from apikey.
  if (!/^sb_(?:publishable|secret)_/.test(key)) headers.Authorization = `Bearer ${key}`;
  return headers;
}
async function readJson(response) {
  try { return await response.json(); } catch (_) { return {}; }
}
async function rpc(name, body) {
  const response = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: serviceHeaders(), body: JSON.stringify(body) });
  return { ok: response.ok, status: response.status, data: await readJson(response) };
}
function prepareError(result) {
  if (result.data?.code === "42501") return json({ error: "Немає прав для надсилання цього запрошення." }, 403);
  if (result.status === 429 || /cooldown|too soon|rate.limit|60.seconds/i.test(String(result.data?.message || ""))) {
    return json({ error: "Лист уже запитано. Повторне надсилання доступне через хвилину." }, 429);
  }
  if (result.status >= 500 || result.data?.code === "PGRST202") return json({ error: "Надсилання запрошень тимчасово недоступне." }, 503);
  return json({ error: "Запрошення вже не чинне. Оновіть список запрошень." }, 409);
}
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
