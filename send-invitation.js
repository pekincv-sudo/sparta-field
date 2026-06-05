const SUPABASE_URL = process.env.SUPABASE_URL || "https://klltykfmbsobqumpolyd.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_8HG6jI0L1h9RKjOzq-mV4g_rNkiQy4s";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_COMPANY_ID = process.env.SPARTA_COMPANY_ID || "e5301014-4985-44a8-8c36-842e6da25947";

module.exports = async function handler(request, response) {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    response.status(500).json({ error: "У Vercel не задано SUPABASE_SERVICE_ROLE_KEY." });
    return;
  }

  const token = getBearerToken(request);
  if (!token) {
    response.status(401).json({ error: "Потрібно увійти в додаток." });
    return;
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const companyId = String(body.companyId || DEFAULT_COMPANY_ID);
  const redirectTo = sanitizeRedirectUrl(body.redirectTo);
  const fullName = String(body.fullName || "").trim();

  if (!email) {
    response.status(400).json({ error: "Email користувача не вказано." });
    return;
  }

  const currentUser = await getCurrentUser(token);
  if (!currentUser.ok) {
    response.status(401).json({ error: "Сесію власника не підтверджено." });
    return;
  }

  const canInvite = await assertOwnerAccess(companyId, currentUser.user.id);
  if (!canInvite.ok) {
    response.status(canInvite.status).json({ error: canInvite.error });
    return;
  }

  const invitationResult = await sendAdminInvite(email, fullName, companyId, redirectTo);
  if (invitationResult.ok) {
    response.status(200).json({ message: "Лист-запрошення відправлено на пошту.", mode: invitationResult.mode });
    return;
  }

  const recoveryResult = await sendPasswordRecovery(email, redirectTo);
  if (recoveryResult.ok) {
    response.status(200).json({ message: "Користувач вже існує. Відправлено лист для входу або відновлення пароля.", mode: "recovery" });
    return;
  }

  response.status(502).json({
    error: `Supabase не відправив лист. Invite: ${invitationResult.error}. Recovery: ${recoveryResult.error}`,
  });
};

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function getBearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function getCurrentUser(token) {
  const result = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!result.ok) return { ok: false };
  return { ok: true, user: await result.json() };
}

async function assertOwnerAccess(companyId, userId) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/company_members`);
  url.searchParams.set("select", "role");
  url.searchParams.set("company_id", `eq.${companyId}`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("is_active", "eq.true");
  url.searchParams.set("role", "eq.owner");

  const result = await fetch(url, {
    headers: serviceHeaders(),
  });
  if (!result.ok) {
    return { ok: false, status: 500, error: "Не вдалося перевірити права власника." };
  }

  const rows = await result.json();
  if (!rows.length) {
    return { ok: false, status: 403, error: "Надсилати запрошення може тільки власник компанії." };
  }
  return { ok: true };
}

async function sendAdminInvite(email, fullName, companyId, redirectTo) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/invite`);
  url.searchParams.set("redirect_to", redirectTo);

  const result = await fetch(url, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      email,
      data: {
        full_name: fullName,
        company_id: companyId,
      },
    }),
  });

  if (result.ok) return { ok: true, mode: "invite" };
  return { ok: false, error: await safeErrorText(result) };
}

async function sendPasswordRecovery(email, redirectTo) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/recover`);
  url.searchParams.set("redirect_to", redirectTo);

  const result = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  if (result.ok) return { ok: true };
  return { ok: false, error: await safeErrorText(result) };
}

function serviceHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

function sanitizeRedirectUrl(value) {
  const fallback = "https://sparta-field.vercel.app/";
  try {
    const url = new URL(String(value || fallback));
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return fallback;
    return url.origin + "/";
  } catch {
    return fallback;
  }
}

async function safeErrorText(result) {
  const text = await result.text().catch(() => "");
  if (!text) return `${result.status} ${result.statusText}`;
  try {
    const json = JSON.parse(text);
    return json.msg || json.message || json.error_description || json.error || text;
  } catch {
    return text;
  }
}
