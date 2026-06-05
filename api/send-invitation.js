export const config = {
  runtime: "edge",
};

const SUPABASE_URL = process.env.SUPABASE_URL || "https://klltykfmbsobqumpolyd.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_8HG6jI0L1h9RKjOzq-mV4g_rNkiQy4s";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_COMPANY_ID = process.env.SPARTA_COMPANY_ID || "e5301014-4985-44a8-8c36-842e6da25947";

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return json(null, 204);
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "–£ Vercel –љ–µ –Ј–∞–і–∞–љ–Њ SUPABASE_SERVICE_ROLE_KEY." }, 500);
  }

  const token = getBearerToken(request.headers.get("authorization") || "");
  if (!token) {
    return json({ error: "–Я–Њ—В—А—Ц–±–љ–Њ —Г–≤—Ц–є—В–Є –≤ –і–Њ–і–∞—В–Њ–Ї." }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const email = String(body.email || "").trim().toLowerCase();
  const companyId = String(body.companyId || DEFAULT_COMPANY_ID);
  const redirectTo = sanitizeRedirectUrl(body.redirectTo);
  const fullName = String(body.fullName || "").trim();

  if (!email) {
    return json({ error: "Email –Ї–Њ—А–Є—Б—В—Г–≤–∞—З–∞ –љ–µ –≤–Ї–∞–Ј–∞–љ–Њ." }, 400);
  }

  const currentUser = await getCurrentUser(token);
  if (!currentUser.ok) {
    return json({ error: "–°–µ—Б—Ц—О –≤–ї–∞—Б–љ–Є–Ї–∞ –љ–µ –њ—Ц–і—В–≤–µ—А–і–ґ–µ–љ–Њ." }, 401);
  }

  const canInvite = await assertOwnerAccess(companyId, currentUser.user.id);
  if (!canInvite.ok) {
    return json({ error: canInvite.error }, canInvite.status);
  }

  const invitationResult = await sendAdminInvite(email, fullName, companyId, redirectTo);
  if (invitationResult.ok) {
    return json({ message: "–Ы–Є—Б—В-–Ј–∞–њ—А–Њ—И–µ–љ–љ—П –≤—Ц–і–њ—А–∞–≤–ї–µ–љ–Њ –љ–∞ –њ–Њ—И—В—Г.", mode: invitationResult.mode });
  }

  const recoveryResult = await sendPasswordRecovery(email, redirectTo);
  if (recoveryResult.ok) {
    return json({
      message: "–Ъ–Њ—А–Є—Б—В—Г–≤–∞—З –≤–ґ–µ —Ц—Б–љ—Г—Ф. –Т—Ц–і–њ—А–∞–≤–ї–µ–љ–Њ –ї–Є—Б—В –і–ї—П –≤—Е–Њ–і—Г –∞–±–Њ –≤—Ц–і–љ–Њ–≤–ї–µ–љ–љ—П –њ–∞—А–Њ–ї—П.",
      mode: "recovery",
    });
  }

  return json({
    error: `Supabase –љ–µ –≤—Ц–і–њ—А–∞–≤–Є–≤ –ї–Є—Б—В. Invite: ${invitationResult.error}. Recovery: ${recoveryResult.error}`,
  }, 502);
}

function json(payload, status = 200) {
  return new Response(payload === null ? null : JSON.stringify(payload), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function getBearerToken(header) {
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
    const details = await safeErrorText(result);
    return {
      ok: false,
      status: 500,
      error: `–Э–µ –≤–і–∞–ї–Њ—Б—П –њ–µ—А–µ–≤—Ц—А–Є—В–Є –њ—А–∞–≤–∞ –≤–ї–∞—Б–љ–Є–Ї–∞. Supabase: ${result.status} ${details}`,
    };
  }

  const rows = await result.json();
  if (!rows.length) {
    return { ok: false, status: 403, error: "–Э–∞–і—Б–Є–ї–∞—В–Є –Ј–∞–њ—А–Њ—И–µ–љ–љ—П –Љ–Њ–ґ–µ —В—Ц–ї—М–Ї–Є –≤–ї–∞—Б–љ–Є–Ї –Ї–Њ–Љ–њ–∞–љ—Ц—Ч." };
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
    const parsed = JSON.parse(text);
    return parsed.msg || parsed.message || parsed.error_description || parsed.error || text;
  } catch {
    return text;
  }
}
