(function () {
  "use strict";
  const intent = new URLSearchParams(window.location.search).get("auth") || new URLSearchParams(window.location.hash.replace(/^#/, "")).get("type");
  let pendingPassword = ["invite", "recovery"].includes(intent);
  let gateMode = "signin";
  let busy = false;
  let refreshing = false;
  const gate = () => document.querySelector("#gateAuthForm");
  const message = () => document.querySelector("#gateAuthMessage");
  const isLocal = () => Boolean(window.SPARTA_LOCAL_WORKSPACE?.enabled);
  const redirect = (mode) => PUBLIC_APP_URL.replace(/\/$/, "") + "/?auth=" + mode;

  function setGateMode(mode) {
    gateMode = ["signup", "recover"].includes(mode) ? mode : "signin";
    const form = gate();
    form.elements.authMode.value = gateMode;
    form.querySelectorAll("[data-gate-mode]").forEach((button) => button.classList.toggle("active", button.dataset.gateMode === gateMode));
    form.querySelectorAll("[data-signup-only]").forEach((field) => { field.hidden = gateMode !== "signup"; });
    form.querySelectorAll("[data-password-field]").forEach((field) => { field.hidden = gateMode === "recover"; });
    form.elements.password.required = gateMode !== "recover";
    form.elements.password.minLength = gateMode === "signup" ? 8 : 1;
    form.elements.password.autocomplete = gateMode === "signup" ? "new-password" : "current-password";
    form.elements.fullName.required = gateMode === "signup";
    form.elements.passwordConfirm.required = gateMode === "signup";
    form.querySelector('[type="submit"]').textContent = gateMode === "signup" ? "Створити акаунт" : gateMode === "recover" ? "Надіслати посилання" : "Увійти";
    message().textContent = gateMode === "signup" ? "Зареєструйте email із запрошення, підтвердьте його в листі й увійдіть. Роль призначає власник компанії." : gateMode === "recover" ? "Введіть email свого акаунта — надішлемо посилання для нового пароля." : "Увійдіть зі своїм email і паролем.";
  }

  async function submitGate(form) {
    if (busy) return;
    busy = true;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      if (!cloudState.client) throw new Error("Підключення ще не готове. Зачекайте й повторіть спробу.");
      const data = new FormData(form);
      const email = String(data.get("email") || "").trim().toLowerCase();
      if (gateMode === "recover") {
        const { error } = await cloudState.client.auth.resetPasswordForEmail(email, { redirectTo: redirect("recovery") });
        if (error) throw error;
        message().textContent = "Якщо акаунт із цим email існує, на пошту надійде посилання. Перевірте також папку «Спам».";
        return;
      }
      if (gateMode === "signup" && String(data.get("password")) !== String(data.get("passwordConfirm"))) throw new Error("Паролі не збігаються.");
      await authenticateUser(email, data.get("password"), gateMode, message(), data.get("fullName"));
    } catch (error) {
      message().textContent = authError(error);
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  function authError(error) {
    const code = String(error?.code || "");
    if (/invalid_credentials/.test(code)) return "Неправильний email або пароль. Перевірте дані або відновіть пароль.";
    if (/email_not_confirmed/.test(code)) return "Підтвердьте email у листі. За потреби надішліть підтвердження повторно.";
    if (/over_.*rate_limit|rate_limit/.test(code)) return "Забагато спроб. Зачекайте перед повторним запитом.";
    if (/email_address_not_authorized|unexpected_failure/.test(code)) return "Сервіс не надіслав лист. Зверніться до власника для перевірки налаштувань пошти.";
    return error?.message || "Не вдалося виконати запит. Спробуйте ще раз.";
  }

  function onAuthEvent(event) {
    if (event === "PASSWORD_RECOVERY") pendingPassword = true;
    if (event === "SIGNED_OUT") pendingPassword = false;
  }
  function afterSession() {
    if (!cloudState.user || !pendingPassword || isLocal()) return;
    const dialog = document.querySelector("#passwordDialog");
    if (!dialog || dialog.open) return;
    document.querySelector("#passwordForm").reset();
    document.querySelector("#passwordMessage").textContent = "Задайте власний пароль: щонайменше 8 символів. Повторіть його для підтвердження.";
    dialog.showModal();
  }
  function passwordCompleted() {
    pendingPassword = false;
    const url = new URL(window.location.href);
    if (url.searchParams.has("auth")) { url.searchParams.delete("auth"); window.history.replaceState({}, "", url.pathname + url.search); }
  }
  async function recordSession(event) {
    if (isLocal() || !cloudState.ready || !cloudState.client || !cloudState.user) return;
    const { error } = await cloudState.client.rpc("sparta_record_session_event", { p_company_id: cloudState.companyId, p_event: event });
    if (error) throw new Error("Не вдалося записати подію сеансу. Перевірте зв’язок із базою.");
  }

  async function refreshAccess() {
    if (refreshing || isLocal() || !cloudState.ready || !cloudState.client || !cloudState.user) return;
    refreshing = true;
    const client = cloudState.client, company = cloudState.companyId, user = cloudState.user.id;
    try {
      const { data, error } = await client.from("company_members").select("role,is_active").eq("company_id", company).eq("user_id", user).maybeSingle();
      if (error || cloudState.user?.id !== user || cloudState.companyId !== company) return;
      if (!data || !data.is_active) {
        clearCompanyContext();
        cloudState.message = "Доступ до компанії призупинено. Зверніться до власника.";
        updateAccessMode(); render(); return;
      }
      if (data.role !== cloudState.memberRole) {
        const { data: session } = await client.auth.getSession();
        clearCompanyContext();
        await applyCloudSession(session.session);
      }
    } finally { refreshing = false; }
  }

  document.addEventListener("click", (event) => {
    const mode = event.target.closest("[data-gate-mode]");
    if (mode) setGateMode(mode.dataset.gateMode);
    if (event.target.closest("[data-auth-resend]")) {
      const email = gate().elements.email.value.trim();
      if (!email || !gate().elements.email.reportValidity()) { message().textContent = "Вкажіть email, для якого потрібен лист підтвердження."; return; }
      cloudState.client?.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirect("signup") } }).then(({error}) => { message().textContent = error ? authError(error) : "Якщо потрібне підтвердження, лист буде надіслано. Перевірте пошту й «Спам»."; }).catch((error) => { message().textContent = authError(error); });
    }
    if (event.target.closest("[data-auth-retry]")) {
      cloudState.client?.auth.getSession().then(({data}) => applyCloudSession(data.session)).catch((error) => { message().textContent = authError(error); });
    }
    if (event.target.closest("[data-auth-signout]")) void logoutCloudUser();
  });
  window.addEventListener("online", () => { void refreshAccess().catch(() => {}); });
  window.addEventListener("focus", () => { void refreshAccess().catch(() => {}); });
  window.setInterval(() => { void refreshAccess().catch(() => {}); }, 60000);
  window.SpartaAuthFlow = { setGateMode, submitGate, onAuthEvent, afterSession, passwordCompleted, recordSession, refreshAccess, authError };
})();
