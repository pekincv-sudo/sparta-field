(function (root, factory) {
  "use strict";
  const api = factory(typeof module === "object" && module.exports ? require("./product-photos-data.js") : root.SpartaProductPhotosData);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SpartaProductPhotos = api;
  if (typeof document !== "undefined") {
    document.addEventListener("error", function (event) {
      const image = event.target;
      if (image?.matches?.("img.sp-product-photo-image")) image.closest(".sp-product-photo")?.classList.add("is-unavailable");
    }, true);
  }
})(typeof window !== "undefined" ? window : globalThis, function (catalog) {
  "use strict";
  const safe = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
  const normalize = value => String(value || "").normalize("NFKC").toLocaleLowerCase("uk-UA").replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();
  const byName = new Map((catalog?.items || []).map(item => [item.nameKey, item]));
  const nameKeys = new Map();
  function keyFor(value) {
    const text = normalize(value);
    if (nameKeys.has(text)) return nameKeys.get(text);
    // Opaque catalogue aliases keep customer/project notes in product names out
    // of the public asset registry. This is an identifier, not authorization.
    let hash = 0xcbf29ce484222325n;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      hash = BigInt.asUintN(64, (hash ^ BigInt(code & 255)) * 0x100000001b3n);
      hash = BigInt.asUintN(64, (hash ^ BigInt(code >>> 8)) * 0x100000001b3n);
    }
    const key = hash.toString(16).padStart(16, "0");
    nameKeys.set(text, key);
    return key;
  }
  const matchLabels = {
    model: "Фото моделі",
    series: "Фото серії. Комплектація та виконання можуть відрізнятися.",
    illustrative: "Ілюстративне фото типу обладнання. Точну модель уточнюйте за назвою та характеристиками.",
  };
  function resolve(item) {
    const entry = byName.get(keyFor(item?.name));
    const asset = entry && catalog?.assets?.[entry.assetKey];
    // Only reviewed, locally bundled photographs are used. A new similar name
    // must not silently inherit a different model's photograph.
    if (!asset || !/^\.\/assets\/product-photos\/[a-z0-9][a-z0-9-]*\.webp$/.test(asset.src || "")) return null;
    if (!Object.hasOwn(matchLabels, entry.match)) return null;
    let sourceUrl;
    try { const url = new URL(asset.sourceUrl); if (url.protocol !== "https:") return null; sourceUrl = url.href; } catch (_) { return null; }
    return Object.freeze({ src: asset.src, alt: asset.label || String(item?.name || "Товар"), match: entry.match, sourceUrl, label: matchLabels[entry.match] });
  }
  function picture(photo, options = {}) {
    const classes = `sp-product-photo${options.large ? " sp-product-photo--large" : ""}${photo ? "" : " is-unavailable"}`;
    return `<span class="${classes}"${options.detail ? "" : ' aria-hidden="true"'}>${photo ? `<img class="sp-product-photo-image" src="${safe(photo.src)}" alt="${options.detail ? safe(photo.alt) : ""}" width="${options.detail ? "140" : "56"}" height="${options.detail ? "140" : "56"}" loading="${options.detail ? "eager" : "lazy"}" decoding="async" title="${safe(photo.label)}" />` : ""}<span class="sp-product-photo-fallback">${photo ? "Фото недоступне" : "Фото ще немає"}</span></span>`;
  }
  function thumbnailHtml(item, options) { return picture(resolve(item), options); }
  function detailsHtml(item) {
    const photo = resolve(item);
    if (!photo) return `<div class="sp-product-photo-detail">${picture(null)}<div class="sp-product-photo-caption">Фото для цього товару ще не додано.</div></div>`;
    return `<div class="sp-product-photo-detail"><a href="${safe(photo.src)}" target="_blank" rel="noopener noreferrer" aria-label="Збільшити фото ${safe(item.name)}">${picture(photo, { detail: true })}</a><div class="sp-product-photo-caption"><strong>${safe(photo.label)}</strong><span>${safe(photo.alt)}</span><a href="${safe(photo.sourceUrl)}" target="_blank" rel="noopener noreferrer">Джерело фото</a></div></div>`;
  }
  return Object.freeze({ resolve, thumbnailHtml, detailsHtml });
});
