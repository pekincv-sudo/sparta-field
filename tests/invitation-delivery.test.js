"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

module.exports = async function runInvitationDeliveryTests(directory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(directory, "app.js"), "utf8");
  const functions = new Map([...source.matchAll(/^(?:async )?function\s+([\w$]+)\([^]*?^\}/gm)].map(match => [match[1], match[0]]));
  const response = (status = 200, payload = { message: "Лист-запрошення надіслано." }) => new Response(JSON.stringify(payload), { status });
  function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
  async function flush() { for (let count = 0; count < 12; count++) await Promise.resolve(); }
  function harness(options = {}) {
    const calls = [], reports = [], message = { textContent: "" };
    const button = { textContent: "Зберегти запрошення", disabled: false };
    const form = { data: { email: "person@example.invalid", role: "installer", fullName: "Person" }, reportValidity: () => true, querySelector: () => button };
    const dialog = { closes: 0, close() { this.closes++; } };
    const invitation = { id: "22222222-2222-4222-8222-222222222222", email: form.data.email, full_name: "Person", role: "installer" };
    const state = { ready: true, companyId: "company", memberRole: "owner", user: { id: "owner" }, invitations: [invitation], message: "", client: {
      async rpc(name, payload) {
        calls.push({ name, payload });
        if (options.rpcError) throw options.rpcError;
        return { data: { ...invitation, email: payload.p_email }, error: null };
      },
      auth: { async getSession() {
        if (options.sessionError) throw options.sessionError;
        return { data: { session: { access_token: "test-only-user-session" } } };
      } },
    } };
    const context = vm.createContext({ cloudState: state, invitationEmailTasks: new Map(), invitationFormBusy: false,
      inviteForm: form, inviteMessage: message, inviteDialog: dialog,
      window: { SpartaTeamAccess: {
        setInvitationDelivery(email, status) { reports.push({ email, ...status }); },
        async refresh() { calls.push({ name: "refreshTeam" }); },
      } },
      FormData: class { constructor(value) { this.form = value; } get(name) { return this.form.data[name]; } },
      async loadCompanyPeople() { calls.push({ name: "loadCompanyPeople" }); if (options.peopleError) throw options.peopleError; },
      renderProfileView() {}, getInvitationRedirectUrl: () => "https://sparta-field-u2pe.vercel.app/",
      async fetch(url, init) {
        calls.push({ name: "fetch", url, init });
        if (options.fetchError) throw options.fetchError;
        if (options.fetchByEmail) return options.fetchByEmail(JSON.parse(init.body).email);
        if (options.fetchGate) return options.fetchGate;
        return response(options.status, options.payload);
      },
    });
    for (const name of ["inviteUser", "runInvitationEmailAction", "sendInvitationEmail", "sendInvitationEmailByServer", "resendInvitation", "submitInvitationForm"]) {
      assert(functions.has(name), `Production ${name} exists`);
      vm.runInContext(functions.get(name), context);
    }
    return { context, state, calls, reports, message, button, dialog, options,
      submit: () => context.submitInvitationForm({ preventDefault() {} }),
      invite: () => context.inviteUser(form.data.email, form.data.role, form.data.fullName),
      resend: () => context.resendInvitation(form.data.email),
    };
  }
  let passed = 0;
  for (const status of [503, 502]) {
    const h = harness({ status, payload: { error: `Помилка надсилання ${status}` } });
    await h.submit();
    assert.equal(h.dialog.closes, 0);
    assert.match(h.message.textContent, /Запрошення збережено/);
    assert.match(h.message.textContent, new RegExp(String(status)));
    assert.equal(h.calls.filter(call => call.name === "sparta_team_invite").length, 1);
    assert.equal(h.reports.at(-1).ok, false);
    assert.equal(h.reports.at(-1).pending, false);
    assert.equal(h.button.disabled, false);
    passed++;
  }
  {
    const h = harness(); await h.submit();
    assert.equal(h.dialog.closes, 1); assert.equal(h.reports.at(-1).ok, true);
    assert.match(h.reports.at(-1).message, /Лист-запрошення надіслано/);
    assert.equal(h.button.textContent, "Зберегти запрошення"); passed++;
  }
  {
    const h = harness({ payload: { message: "Лист надіслано.", warning: "Не вдалося записати журнал доставки." } });
    await h.submit(); assert.equal(h.dialog.closes, 1);
    assert.match(h.reports.at(-1).message, /Не вдалося записати журнал/); passed++;
  }
  {
    const h = harness({ fetchError: new Error("Network rejected") }); await h.submit();
    assert.equal(h.dialog.closes, 0); assert.match(h.message.textContent, /Не вдалося зв’язатися/);
    assert.equal(h.reports.at(-1).pending, false);
    delete h.options.fetchError; await h.submit(); assert.equal(h.dialog.closes, 1);
    assert.equal(h.calls.filter(call => call.name === "fetch").length, 2); passed++;
  }
  {
    const h = harness({ sessionError: new Error("Session rejected") }); await h.submit();
    assert.equal(h.dialog.closes, 0); assert.match(h.message.textContent, /Запрошення збережено/);
    assert.equal(h.calls.filter(call => call.name === "fetch").length, 0);
    assert.equal(h.reports.at(-1).ok, false); assert.equal(h.button.disabled, false); passed++;
  }
  {
    const h = harness({ rpcError: new Error("RPC denied") }); await h.submit();
    assert.equal(h.dialog.closes, 0); assert.equal(h.message.textContent, "RPC denied");
    assert.equal(h.calls.filter(call => call.name === "fetch").length, 0);
    assert.equal(h.reports.at(-1).message, "RPC denied"); assert.equal(h.button.disabled, false); passed++;
  }
  {
    const gate = deferred(), h = harness({ fetchGate: gate.promise });
    const first = h.submit(); await flush(); const second = h.submit(); await flush();
    assert.equal(h.button.disabled, true);
    assert.equal(h.calls.filter(call => call.name === "sparta_team_invite").length, 1);
    assert.equal(h.calls.filter(call => call.name === "fetch").length, 1);
    assert.equal(h.reports.at(-1).pending, true);
    gate.resolve(response()); await Promise.all([first, second]);
    assert.equal(h.dialog.closes, 1); assert.equal(h.button.disabled, false); passed++;
  }
  {
    const gate = deferred(), h = harness({ fetchGate: gate.promise });
    const first = h.invite(), second = h.resend(); await flush();
    assert.equal(h.calls.filter(call => call.name === "sparta_team_invite").length, 1);
    assert.equal(h.calls.filter(call => call.name === "fetch").length, 1);
    gate.resolve(response()); const results = await Promise.all([first, second]);
    assert(results.every(result => result.delivery.ok)); assert.equal(h.reports.filter(report => report.pending).length, 1); passed++;
  }
  {
    const h = harness({ status: 503, payload: { error: "Сервер недоступний." } });
    const result = await h.resend(); assert.equal(result.delivery.ok, false);
    assert.match(h.reports.at(-1).message, /Сервер недоступний/);
    assert.equal(h.reports.at(-1).pending, false);
    assert(h.calls.some(call => call.name === "refreshTeam")); passed++;
  }
  {
    const h = harness({ rpcError: new Error("Resend denied") }); await assert.rejects(h.resend(), /Resend denied/);
    assert.equal(h.reports.at(-1).pending, false); assert.equal(h.reports.at(-1).ok, false);
    delete h.options.rpcError; assert.equal((await h.resend()).delivery.ok, true);
    assert.equal(h.reports.at(-1).ok, true); passed++;
  }
  {
    const h = harness({ peopleError: new Error("List unavailable") }); await h.submit();
    assert.equal(h.dialog.closes, 1); assert.equal(h.reports.at(-1).ok, true);
    assert.match(h.reports.at(-1).message, /Оновіть список/);
    assert.equal(h.calls.filter(call => call.name === "fetch").length, 1); passed++;
  }
  {
    const h = harness({ status: 429, payload: { error: "Повторне надсилання доступне через хвилину." } });
    await h.submit(); assert.equal(h.dialog.closes, 0); assert.match(h.message.textContent, /через хвилину/);
    assert.equal(h.calls.filter(call => call.name === "fetch").length, 1); assert.equal(h.reports.at(-1).ok, false); passed++;
  }
  {
    const firstGate = deferred(), secondGate = deferred();
    const h = harness({ fetchByEmail: email => email === "person@example.invalid" ? firstGate.promise : secondGate.promise });
    const first = h.invite(), second = h.context.inviteUser("other@example.invalid", "installer", "Other"); await flush();
    secondGate.resolve(response(200, { message: "Другий лист надіслано." })); await second;
    firstGate.resolve(response(502, { error: "Перший лист не вдалося надіслати." })); const result = await first;
    const firstReport = h.reports.find(report => report.email === "person@example.invalid" && report.pending === false);
    const secondReport = h.reports.find(report => report.email === "other@example.invalid" && report.pending === false);
    assert.equal(firstReport.ok, false); assert.match(firstReport.message, /Перший лист/); assert.doesNotMatch(firstReport.message, /Другий лист/);
    assert.equal(secondReport.ok, true); assert.match(secondReport.message, /Другий лист/); assert.doesNotMatch(secondReport.message, /Перший лист/);
    assert.equal(result.message, firstReport.message); passed++;
  }
  return { passed };
};
