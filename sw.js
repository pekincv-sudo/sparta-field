const CACHE_NAME = "sparta-field-v41";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/local-workspace.js",
  "/money.js",
  "/auth-flow.js",
  "/team-access.js",
  "/team-access.css",
  "/buyer-cloud.js",
  "/buyer-ui.js",
  "/buyer-ui.css",
  "/sun-game.js",
  "/sun-game.css",
  "/cash-ledger.js",
  "/cash-book.js",
  "/workspace-reset-core.js",
  "/workspace-maintenance.js",
  "/product-photos-data.js",
  "/product-photos.js",
  "/warehouse-core.js",
  "/inventory-import.js",
  "/inventory-import-ui.js",
  "/warehouse-ui.js",
  "/warehouse-cloud.js",
  "/warehouse.css",
  "/supabase-config.js",
  "/supabase-js.umd.js",
  "/assets/solar-background.png",
  "/assets/sparta-logo.jpeg",
  "/assets/pwa/apple-touch-icon.png",
  "/assets/pwa/icon-192.png",
  "/assets/pwa/icon-512.png",
  "/manifest.webmanifest"
];
const PRODUCT_PHOTO_PATHS = [
  "/assets/product-photos/electrical-electrical-anchor-zub.webp",
  "/assets/product-photos/electrical-electrical-anticorrosion.webp",
  "/assets/product-photos/electrical-electrical-cable-gland.webp",
  "/assets/product-photos/electrical-electrical-conduit.webp",
  "/assets/product-photos/electrical-electrical-din-rail.webp",
  "/assets/product-photos/electrical-electrical-earth-coupling.webp",
  "/assets/product-photos/electrical-electrical-earth-rod.webp",
  "/assets/product-photos/electrical-electrical-earth-tip.webp",
  "/assets/product-photos/electrical-electrical-earthing-kit.webp",
  "/assets/product-photos/electrical-electrical-ech-12pt.webp",
  "/assets/product-photos/electrical-electrical-ech-18pt.webp",
  "/assets/product-photos/electrical-electrical-ech-24pt.webp",
  "/assets/product-photos/electrical-electrical-ech-36pt.webp",
  "/assets/product-photos/electrical-electrical-ech-48pt.webp",
  "/assets/product-photos/electrical-electrical-ech-4g.webp",
  "/assets/product-photos/electrical-electrical-ech-6g.webp",
  "/assets/product-photos/electrical-electrical-ech-8g.webp",
  "/assets/product-photos/electrical-electrical-enext-n36.webp",
  "/assets/product-photos/electrical-electrical-ferrule-bare.webp",
  "/assets/product-photos/electrical-electrical-ferrule-insulated.webp",
  "/assets/product-photos/electrical-electrical-ferrule-twin.webp",
  "/assets/product-photos/electrical-electrical-fuse-10.webp",
  "/assets/product-photos/electrical-electrical-fuse-14.webp",
  "/assets/product-photos/electrical-electrical-fuse-holder-10.webp",
  "/assets/product-photos/electrical-electrical-fuse-holder-14.webp",
  "/assets/product-photos/electrical-electrical-impact-box.webp",
  "/assets/product-photos/electrical-electrical-junction-box.webp",
  "/assets/product-photos/electrical-electrical-kbe.webp",
  "/assets/product-photos/electrical-electrical-ls-a2.webp",
  "/assets/product-photos/electrical-electrical-ls-a4.webp",
  "/assets/product-photos/electrical-electrical-lug-dt.webp",
  "/assets/product-photos/electrical-electrical-lug-flat.webp",
  "/assets/product-photos/electrical-electrical-mc4-flex.webp",
  "/assets/product-photos/electrical-electrical-mc4-t.webp",
  "/assets/product-photos/electrical-electrical-mc4.webp",
  "/assets/product-photos/electrical-electrical-mcb-1p.webp",
  "/assets/product-photos/electrical-electrical-mcb-3p.webp",
  "/assets/product-photos/electrical-electrical-mccb-ba77.webp",
  "/assets/product-photos/electrical-electrical-mccb-fmc.webp",
  "/assets/product-photos/electrical-electrical-metal-box.webp",
  "/assets/product-photos/electrical-electrical-metal-conduit.webp",
  "/assets/product-photos/electrical-electrical-neutral-bar.webp",
  "/assets/product-photos/electrical-electrical-rj45.webp",
  "/assets/product-photos/electrical-electrical-sleeve-gt.webp",
  "/assets/product-photos/electrical-electrical-spd-ac.webp",
  "/assets/product-photos/electrical-electrical-spd-dc.webp",
  "/assets/product-photos/electrical-electrical-splitter-9512.webp",
  "/assets/product-photos/electrical-electrical-ssq-140.webp",
  "/assets/product-photos/electrical-electrical-ssq-240.webp",
  "/assets/product-photos/electrical-electrical-ssq-363.webp",
  "/assets/product-photos/electrical-electrical-stabilizer.webp",
  "/assets/product-photos/electrical-electrical-tape-red.webp",
  "/assets/product-photos/electrical-electrical-terminal-25.webp",
  "/assets/product-photos/electrical-electrical-terminal-95.webp",
  "/assets/product-photos/electrical-electrical-tie-base.webp",
  "/assets/product-photos/electrical-electrical-ties.webp",
  "/assets/product-photos/electrical-electrical-tomzn-63.webp",
  "/assets/product-photos/electrical-electrical-transfer.webp",
  "/assets/product-photos/electrical-electrical-tray-cover.webp",
  "/assets/product-photos/electrical-electrical-tray-perforated.webp",
  "/assets/product-photos/electrical-electrical-tray-wire.webp",
  "/assets/product-photos/electrical-electrical-trunking-corner.webp",
  "/assets/product-photos/electrical-electrical-trunking-end.webp",
  "/assets/product-photos/electrical-electrical-trunking-tee.webp",
  "/assets/product-photos/electrical-electrical-trunking.webp",
  "/assets/product-photos/electrical-electrical-wire-4core.webp",
  "/assets/product-photos/electrical-electrical-wire-black.webp",
  "/assets/product-photos/electrical-electrical-wire-flat.webp",
  "/assets/product-photos/electrical-electrical-wire-network.webp",
  "/assets/product-photos/electrical-electrical-wire-pvs.webp",
  "/assets/product-photos/electrical-electrical-wire-red.webp",
  "/assets/product-photos/electrical-electrical-wire-yellowgreen.webp",
  "/assets/product-photos/equipment-astronergy-460.webp",
  "/assets/product-photos/equipment-chint-meter.webp",
  "/assets/product-photos/equipment-deye-bos-b-pdu.webp",
  "/assets/product-photos/equipment-deye-bos-b-single.webp",
  "/assets/product-photos/equipment-deye-bos-g-pro.webp",
  "/assets/product-photos/equipment-deye-hybrid-1p-10.webp",
  "/assets/product-photos/equipment-deye-hybrid-1p-12.webp",
  "/assets/product-photos/equipment-deye-hybrid-1p-6.webp",
  "/assets/product-photos/equipment-deye-hybrid-3p-12.webp",
  "/assets/product-photos/equipment-deye-hybrid-3p-20.webp",
  "/assets/product-photos/equipment-deye-hybrid-hv-50.webp",
  "/assets/product-photos/equipment-deye-pro-b.webp",
  "/assets/product-photos/equipment-deye-rw-f16.webp",
  "/assets/product-photos/equipment-deye-rw-m53.webp",
  "/assets/product-photos/equipment-deye-se-f12.webp",
  "/assets/product-photos/equipment-deye-se-f16.webp",
  "/assets/product-photos/equipment-deye-string-15.webp",
  "/assets/product-photos/equipment-deye-string-33.webp",
  "/assets/product-photos/equipment-deye-string-50.webp",
  "/assets/product-photos/equipment-ja-solar-54d40.webp",
  "/assets/product-photos/equipment-longi-hi-mo7.webp",
  "/assets/product-photos/equipment-techfine-hb.webp",
  "/assets/product-photos/equipment-tongwei-54hd.webp",
  "/assets/product-photos/equipment-tongwei-66hd.webp",
  "/assets/product-photos/mounting-mount-ballast.webp",
  "/assets/product-photos/mounting-mount-battery-rack.webp",
  "/assets/product-photos/mounting-mount-blind-rivet.webp",
  "/assets/product-photos/mounting-mount-block.webp",
  "/assets/product-photos/mounting-mount-bolt.webp",
  "/assets/product-photos/mounting-mount-butyl.webp",
  "/assets/product-photos/mounting-mount-channel.webp",
  "/assets/product-photos/mounting-mount-double-tape.webp",
  "/assets/product-photos/mounting-mount-dowel-nail.webp",
  "/assets/product-photos/mounting-mount-end-clamp-black.webp",
  "/assets/product-photos/mounting-mount-end-clamp-universal.webp",
  "/assets/product-photos/mounting-mount-end-clamp.webp",
  "/assets/product-photos/mounting-mount-expansion-dowel.webp",
  "/assets/product-photos/mounting-mount-flange-nut.webp",
  "/assets/product-photos/mounting-mount-frame-dowel.webp",
  "/assets/product-photos/mounting-mount-gasket.webp",
  "/assets/product-photos/mounting-mount-hanger.webp",
  "/assets/product-photos/mounting-mount-hook-dowel.webp",
  "/assets/product-photos/mounting-mount-l-bracket.webp",
  "/assets/product-photos/mounting-mount-mid-clamp-black.webp",
  "/assets/product-photos/mounting-mount-mid-clamp.webp",
  "/assets/product-photos/mounting-mount-nut.webp",
  "/assets/product-photos/mounting-mount-plastic-nut.webp",
  "/assets/product-photos/mounting-mount-pt30.webp",
  "/assets/product-photos/mounting-mount-rail-connector.webp",
  "/assets/product-photos/mounting-mount-selfdrill.webp",
  "/assets/product-photos/mounting-mount-socket-screw.webp",
  "/assets/product-photos/mounting-mount-spl1.webp",
  "/assets/product-photos/mounting-mount-t-bracket.webp",
  "/assets/product-photos/mounting-mount-tracker.webp",
  "/assets/product-photos/mounting-mount-trego-rivet.webp",
  "/assets/product-photos/mounting-mount-washer.webp",
  "/assets/product-photos/mounting-mount-wide-washer.webp"
];
const SHELL_PATHS = new Set([...APP_SHELL, ...PRODUCT_PHOTO_PATHS, "/solar-dash.html"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("sparta-field-") && key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Only known application assets belong in the offline cache. APIs, signed
  // downloads, documents and unknown routes always pass through to the network.
  if (request.method !== "GET" || url.origin !== self.location.origin || !SHELL_PATHS.has(url.pathname)) return;
  const key = url.pathname;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok && response.type !== "opaque") {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(key, copy)));
    }
    return response;
  }).catch(() => caches.match(key).then((cached) => cached || Response.error())));
});
