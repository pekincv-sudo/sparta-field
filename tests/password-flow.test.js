"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function runPasswordFlowTests(projectDirectory = path.resolve(__dirname, "..")) {
  const source = fs.readFileSync(path.join(projectDirectory, "app.js"), "utf8");
  const authSource = fs.readFileSync(path.join(projectDirectory, "auth-flow.js"), "utf8");
  const functions = new Map(
    [...source.matchAll(/^(?:async )?function\s+([\w$]+)\([^]*?^\}/gm)]
      .map((match) => [match[1], match[0]]),
  );
  const authError = authSource.match(/^  function authError\([^]*?^  \}/m);
  assert.ok(authError, "Production auth error formatter exists");
  const checks = [];
  const check = async (name, callback) => { await callback(); checks.push(name); };
  const chosenPassword = "Chosen-test-password-1";

  function harness({ signedIn = true, connected = true, valid = true, updateUser = async () => ({ error: null }) } = {}) {
    const calls = { updates: [], completed: 0, renders: 0, resets: 0, closes: 0 };
    const button = { disabled: false, textContent: "Зберегти пароль" };
    const form = {
      elements: { password: { value: chosenPassword }, passwordConfirm: { value: chosenPassword } },
      reportValidity: () => valid,
      querySelector: () => button,
      reset() {
        calls.resets += 1;
        for (const element of Object.values(this.elements)) element.value = "";
      },
    };
    const dialog = { open: true, close() { calls.closes += 1; this.open = false; } };
    const message = { textContent: "Initial password guidance sentinel" };
    const state = {
      user: signedIn ? { id: "password-test-user" } : null,
      client: connected ? { auth: { async updateUser(attributes) {
        calls.updates.push({ ...attributes });
        return updateUser(attributes);
      } } } : null,
      message: "Existing session sentinel",
    };
    const flow = { passwordCompleted() { calls.completed += 1; } };
    const context = vm.createContext({
      cloudState: state,
      passwordForm: form,
      passwordDialog: dialog,
      passwordMessage: message,
      passwordFormBusy: false,
      window: { SpartaAuthFlow: flow },
      FormData: class {
        constructor(target) { this.form = target; }
        get(name) { return this.form.elements[name]?.value ?? null; }
      },
      renderProfileView() { calls.renders += 1; },
    });
    vm.runInContext(authError[0], context);
    flow.authError = context.authError;
    for (const name of ["changeCurrentUserPassword", "submitPasswordForm"]) {
      assert.ok(functions.has(name), `Production function ${name} exists`);
      vm.runInContext(functions.get(name), context);
    }
    return {
      calls, button, form, dialog, message, state, flow,
      change: (password = chosenPassword, confirmation = password) => context.changeCurrentUserPassword(password, confirmation),
      submit: () => context.submitPasswordForm({ target: form, currentTarget: form, preventDefault() {} }),
    };
  }

  await check("Password changes require an authenticated user and a connected client", async () => {
    for (const options of [{ signedIn: false }, { connected: false }]) {
      const h = harness(options);
      assert.equal(await h.change(), false);
      assert.equal(h.calls.updates.length, 0);
      assert.equal(h.calls.completed, 0);
      assert.match(h.message.textContent, /увій/iu);
    }
  });
  await check("Short passwords fail locally without an Auth request", async () => {
    const h = harness();
    assert.equal(await h.change("short"), false);
    assert.equal(h.calls.updates.length, 0);
    assert.equal(h.calls.completed, 0);
    assert.match(h.message.textContent, /8/);
  });
  await check("Mismatching password confirmation fails without an Auth request", async () => {
    const h = harness();
    assert.equal(await h.change(chosenPassword, "Different-test-password-2"), false);
    assert.equal(h.calls.updates.length, 0);
    assert.equal(h.calls.completed, 0);
    assert.match(h.message.textContent, /не (?:співпадають|збігаються)/iu);
  });
  await check("Same-password errors use Ukrainian guidance and never mark recovery complete", async () => {
    for (const error of [
      { code: "same_password", message: "New password should be different from the old password." },
      { message: "New password should be different from the old password." },
    ]) {
      const h = harness({ updateUser: async () => ({ error }) });
      assert.equal(await h.change(), false);
      assert.equal(h.calls.updates.length, 1);
      assert.equal(h.calls.completed, 0);
      assert.equal(h.calls.renders, 0);
      assert.equal(h.state.message, "Existing session sentinel");
      assert.match(h.message.textContent, /інш/iu);
      assert.doesNotMatch(h.message.textContent, /New password should/i);
    }
  });
  await check("A rejected password submission keeps the dialog and fields available", async () => {
    const h = harness({ updateUser: async () => ({ error: { code: "same_password" } }) });
    await h.submit();
    assert.equal(h.dialog.open, true);
    assert.equal(h.calls.closes, 0);
    assert.equal(h.calls.resets, 0);
    assert.equal(h.calls.completed, 0);
    assert.equal(h.form.elements.password.value, chosenPassword);
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.textContent, "Зберегти пароль");
    assert.match(h.message.textContent, /інш/iu);
  });
  await check("Confirmed password update completes recovery and resets and closes the dialog once", async () => {
    const h = harness();
    await h.submit();
    assert.deepEqual(h.calls.updates, [{ password: chosenPassword }]);
    assert.equal(h.calls.completed, 1);
    assert.equal(h.calls.renders, 1);
    assert.equal(h.calls.resets, 1);
    assert.equal(h.calls.closes, 1);
    assert.equal(h.dialog.open, false);
    assert.equal(h.form.elements.password.value, "");
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.textContent, "Зберегти пароль");
  });
  await check("Repeated submits during a pending password update produce one Auth request", async () => {
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    const h = harness({ updateUser: () => pending });
    const first = h.submit();
    const second = h.submit();
    assert.equal(h.calls.updates.length, 1);
    assert.equal(h.button.disabled, true);
    assert.equal(h.button.textContent, "Зберігаю…");
    assert.equal(h.dialog.open, true);
    await second;
    resolve({ error: null });
    await first;
    assert.equal(h.calls.updates.length, 1);
    assert.equal(h.calls.completed, 1);
    assert.equal(h.calls.closes, 1);
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.textContent, "Зберегти пароль");
  });
  await check("Thrown Auth requests restore the submit button and allow a successful retry", async () => {
    let attempt = 0;
    const error = new Error("Network request unavailable sentinel");
    const h = harness({ async updateUser() {
      if (attempt++ === 0) throw error;
      return { error: null };
    } });
    await h.submit();
    assert.equal(h.calls.updates.length, 1);
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.textContent, "Зберегти пароль");
    assert.equal(h.dialog.open, true);
    assert.equal(h.calls.completed, 0);
    assert.equal(h.calls.resets, 0);
    assert.ok(h.message.textContent.includes(h.flow.authError(error)));
    await h.submit();
    assert.equal(h.calls.updates.length, 2);
    assert.equal(h.calls.completed, 1);
    assert.equal(h.calls.closes, 1);
    assert.equal(h.calls.resets, 1);
  });
  await check("Invalid password forms do not send an Auth request or enter the busy state", async () => {
    const h = harness({ valid: false });
    await h.submit();
    assert.equal(h.calls.updates.length, 0);
    assert.equal(h.calls.completed, 0);
    assert.equal(h.calls.resets, 0);
    assert.equal(h.calls.closes, 0);
    assert.equal(h.dialog.open, true);
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.textContent, "Зберегти пароль");
  });

  return { passed: checks.length, checks };
}

module.exports = runPasswordFlowTests;
if (require.main === module) runPasswordFlowTests(process.argv[2]).then((result) => {
  console.log(JSON.stringify(result, null, 2));
}).catch((error) => { console.error(error); process.exitCode = 1; });
