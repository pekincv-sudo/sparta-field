(function () {
  "use strict";
  const MAX_SCORE = 1000000000;
  const memory = new Map();
  const volatileScopes = new Set();
  let active = null;
  const validScore = value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SCORE;

  function identity() {
    if (window.SPARTA_LOCAL_WORKSPACE?.enabled) return { key: "sparta.sunGame.v1.local-owner", stamp: "local-owner" };
    const state = typeof cloudState === "undefined" ? null : cloudState;
    if (!state?.enabled || !state.client || !state.user?.id || !state.companyId || state.sessionLoading || document.body.classList.contains("auth-locked")) return null;
    const buyer = window.SpartaBuyerCloud?.isBuyerReady();
    if (state.audience === "buyer" ? !buyer : state.audience !== "staff" || !state.ready) return null;
    const context = buyer ? window.SpartaBuyerCloud.getContext() : null;
    if (buyer && (!context?.ready || context.userId !== state.user.id || context.companyId !== state.companyId)) return null;
    const scope = JSON.stringify([state.user.id, state.companyId]);
    return {
      key: `sparta.sunGame.v1.${encodeURIComponent(state.companyId)}.${encodeURIComponent(state.user.id)}`,
      stamp: JSON.stringify([scope, buyer ? context.buyerId : "staff", typeof cloudContextRevision === "number" ? cloudContextRevision : 0]),
    };
  }
  function record(key) {
    let best = memory.get(key) || 0;
    try { const stored = Number(window.localStorage.getItem(key)); if (validScore(stored)) best = Math.max(best, stored); } catch (_) { volatileScopes.add(key); }
    memory.set(key, best);
    return best;
  }
  function current() {
    const next = identity();
    return Boolean(active && next && next.key === active.identity.key && next.stamp === active.identity.stamp);
  }
  function status() {
    if (!active) return;
    const best = record(active.identity.key);
    const saved = !volatileScopes.has(active.identity.key);
    active.status.textContent = `Особистий рекорд: ${best} · ${saved ? "на цьому пристрої" : "лише до закриття застосунку"}`;
  }
  function close(restoreFocus = false) {
    if (!active) return;
    const previous = active;
    active = null;
    // Removing the browsing context stops its animation, timers and key handlers.
    previous.frame.remove();
    if (previous.dialog.open) previous.dialog.close();
    previous.dialog.remove();
    document.body.classList.remove("sparta-game-open");
    if (restoreFocus && previous.trigger?.isConnected && identity()?.stamp === previous.identity.stamp) previous.trigger.focus();
  }
  function sendInit() {
    if (!current()) { close(); return; }
    active.frame.contentWindow?.postMessage({ source: "sparta-sun-game", type: "init", session: active.session, best: record(active.identity.key) }, "*");
  }
  function open(trigger = document.activeElement) {
    const account = identity();
    if (!account) { close(); return false; }
    if (active && current()) { active.frame.focus(); return true; }
    close();
    const dialog = document.createElement("dialog");
    dialog.className = "sparta-game-dialog";
    dialog.setAttribute("aria-labelledby", "spartaSunGameTitle");
    dialog.innerHTML = '<header class="sparta-game-header"><div><img src="./assets/sparta-logo.jpeg" alt="SPARTA Power" width="36" height="36"><div><strong id="spartaSunGameTitle">Solar Dash</strong><small>Лови сонце разом зі SPARTA Power</small></div></div><button type="button" class="sparta-game-close" aria-label="Закрити гру">×</button></header><div class="sparta-game-frame"></div><p class="sparta-game-status" aria-live="off"></p>';
    const frame = document.createElement("iframe");
    frame.title = "Solar Dash — ловіння сонячної енергії";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.referrerPolicy = "no-referrer";
    frame.src = "./solar-dash.html?v=20261027-41";
    active = { identity: account, session: window.crypto.randomUUID(), dialog, frame, trigger, status: dialog.querySelector(".sparta-game-status") };
    frame.addEventListener("load", () => { if (active?.frame === frame) { sendInit(); if (active?.frame === frame) frame.focus(); } });
    dialog.querySelector(".sparta-game-close").addEventListener("click", () => close(true));
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(true); });
    dialog.addEventListener("close", () => { if (active?.dialog === dialog) close(true); });
    document.body.append(dialog);
    dialog.querySelector(".sparta-game-frame").append(frame);
    document.body.classList.add("sparta-game-open");
    status();
    dialog.showModal();
    return true;
  }
  window.addEventListener("message", event => {
    if (!active || event.source !== active.frame.contentWindow || event.data?.source !== "sparta-sun-game") return;
    if (!current()) { close(); return; }
    const data = event.data;
    if (data.type === "ready") { sendInit(); return; }
    if (data.type !== "record" || data.session !== active.session || !validScore(data.best)) return;
    const key = active.identity.key;
    if (data.best <= record(key)) return;
    memory.set(key, data.best);
    try { window.localStorage.setItem(key, String(data.best)); volatileScopes.delete(key); } catch (_) { volatileScopes.add(key); }
    status();
  });
  document.addEventListener("click", event => {
    const trigger = event.target.closest?.("[data-open-sun-game]");
    if (!trigger || trigger.disabled) return;
    event.preventDefault();
    open(trigger);
  });
  window.SpartaSunGame = Object.freeze({ open, reset: () => close() });
})();
