"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function runProductPhotoTests() {
  const root = path.resolve(__dirname, "..");
  const data = require("../product-photos-data.js");
  const photos = require("../product-photos.js");
  let passed = 0;
  assert.equal(data.items.length, 280);
  assert.equal(new Set(data.items.map(item => item.nameKey)).size, 280);
  for (const item of data.items) {
    assert.deepEqual(Object.keys(item).sort(), ["assetKey", "match", "nameKey"], "Public aliases exclude customer/project names");
    const photo = data.assets[item.assetKey];
    assert.ok(photo, item.nameKey);
    assert.ok(fs.statSync(path.join(root, photo.src)).isFile(), `${item.name}: bundled asset exists`);
    const bytes = fs.readFileSync(path.join(root, photo.src));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    assert.ok(bytes.length > 200 && bytes.length < 250000, "Real optimized photograph, not an empty placeholder");
    assert.match(photo.sourceUrl, /^https:\/\//);
  }
  passed += 1;
  assert.equal(photos.resolve({ name: "Longi 615W, інша модель" }), null, "Similar names must not inherit a photograph");
  assert.equal(photos.resolve({ name: "  LONGI   615W  " }).src, photos.resolve({ name: "Longi 615W" }).src);
  passed += 1;
  const item = Object.freeze({ name: "Longi 615W", qty: 100, purchasePrice: 93, currency: "UAH" });
  const before = JSON.stringify(item);
  const thumbnail = photos.thumbnailHtml(item);
  assert.match(thumbnail, /loading="lazy"/);
  assert.match(thumbnail, /decoding="async"/);
  assert.doesNotMatch(thumbnail, /onerror=|onclick=/);
  photos.detailsHtml(item);
  assert.equal(JSON.stringify(item), before, "Resolving and rendering never change stock or prices");
  passed += 1;
  assert.match(photos.detailsHtml({ name: 'Longi 615W' }), /Джерело фото/);
  assert.match(photos.detailsHtml({name:"Болт А2 М8*16"}), /Ілюстративне фото/);
  const noImage = photos.thumbnailHtml({ name: '<script>alert(1)</script>' });
  assert.match(noImage, /Фото ще немає/);
  assert.doesNotMatch(noImage, /<script>/);
  passed += 1;
  const handlers = {};
  const context = vm.createContext({ window: { SpartaProductPhotosData: data }, URL, document: { addEventListener(type, callback, capture) { handlers[type] = { callback, capture }; } } });
  vm.runInContext(fs.readFileSync(path.join(root, "product-photos.js"), "utf8"), context);
  assert.equal(handlers.error.capture, true);
  let failed = false;
  handlers.error.callback({ target: { matches: selector => selector === "img.sp-product-photo-image", closest: () => ({ classList: { add: name => { failed = name === "is-unavailable"; } } }) } });
  assert.ok(failed, "Failed media gets an explicit unavailable state without retry loops");
  passed += 1;
  for (const asset of Object.values(data.assets)) {
    assert.deepEqual(Object.keys(asset).sort(), ["label", "sourceUrl", "src"], "Public media data contains no confidential pricing or source spreadsheet data");
  }
  passed += 1;
  return { passed };
}
module.exports = runProductPhotoTests;
if (require.main === module) console.log(runProductPhotoTests());
