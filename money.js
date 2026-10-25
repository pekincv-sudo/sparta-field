(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpartaMoney = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const currencies = Object.freeze(["USD", "UAH"]);
  function normalize(value, fallback = "UAH") {
    const currency = String(value || fallback).toUpperCase();
    if (!currencies.includes(currency)) throw new Error("Підтримуються валюти USD та UAH.");
    return currency;
  }
  function format(value, currency = "USD") {
    if (!Number.isFinite(Number(value))) return "—";
    return Number(value).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (normalize(currency) === "USD" ? "USD" : "грн");
  }
  function sameCurrency(a, b) {
    if (normalize(a) !== normalize(b)) throw new Error("Валюти не збігаються. Оберіть обладнання або операцію у валюті об’єкта. USD та гривня обліковуються окремо.");
  }
  return Object.freeze({ defaultCurrency: "USD", currencies, normalize, format, sameCurrency });
});
