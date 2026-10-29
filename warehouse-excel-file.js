(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpartaWarehouseExcelFile = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const format = "sparta-warehouse-excel";
  const sheetName = "Залишки";
  const metadataName = "_Sparta";
  const limits = Object.freeze({ bytes: 5 * 1024 * 1024, rows: 10000, columns: 25, expandedBytes: 40 * 1024 * 1024, entries: 512, metadataChars: 16000000 });
  const chunkSize = 30000;
  const columns = Object.freeze([
    { field: "id", header: "ID (не змінювати)", width: 34 },
    { field: "sku", header: "Артикул", width: 22 },
    { field: "name", header: "Назва", width: 48 },
    { field: "category", header: "Категорія", width: 25 },
    { field: "brand", header: "Бренд", width: 20 },
    { field: "model", header: "Модель", width: 24 },
    { field: "unit", header: "Одиниця (не змінювати)", width: 25 },
    { field: "currency", header: "Валюта (не змінювати)", width: 25 },
    { field: "qty", header: "Залишок (кінцева кількість)", width: 29, number: "0.000" },
    { field: "retailPrice", header: "Роздрібна ціна", width: 20, number: "0.00" },
    { field: "installerPrice", header: "Ціна для монтажника", width: 23, number: "0.00" },
    { field: "wholesalePrice", header: "Оптова ціна", width: 20, number: "0.00" },
    { field: "minQty", header: "Мінімальний залишок", width: 23, number: "0.000" },
    { field: "location", header: "Місце зберігання", width: 30 },
    { field: "reserved", header: "Зарезервовано (довідково)", width: 29, number: "0.000", readonly: true },
    { field: "available", header: "Доступно (довідково)", width: 26, number: "0.000", readonly: true },
    { field: "purchasePrice", header: "Закупівельна ціна (довідково)", width: 33, number: "0.00", readonly: true },
    { field: "unitCost", header: "Собівартість (довідково)", width: 29, number: "0.00", readonly: true },
  ].map(function (column) { return Object.freeze(column); }));
  const fields = Object.freeze(columns.filter(function (column) { return !column.readonly; }).map(function (column) { return column.field; }));
  const headers = Object.freeze(columns.map(function (column) { return column.header; }));

  function fail(message) { throw new Error(message); }
  function plain(value) { return value && typeof value === "object" && !Array.isArray(value); }
  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function validateManifest(manifest) {
    if (!plain(manifest) || manifest.format !== format || manifest.version !== 1 ||
        typeof manifest.exportId !== "string" || !manifest.exportId.trim() || manifest.exportId.length > 200 ||
        typeof manifest.exportedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(manifest.exportedAt) || !Number.isFinite(Date.parse(manifest.exportedAt)) ||
        !(manifest.scope === "local" || (typeof manifest.scope === "string" && /^company:[A-Za-z0-9-]{1,100}$/.test(manifest.scope))) ||
        !Array.isArray(manifest.rows) || manifest.rows.length > limits.rows) {
      fail("Файл не містить коректних метаданих експорту SPARTA. Завантажте новий Excel зі складу.");
    }
    const ids = new Set();
    manifest.rows.forEach(function (row) {
      if (!plain(row) || typeof row.id !== "string" || !row.id.trim() || row.id.length > 240 || ids.has(row.id) || fields.some(function (field) { return !own(row, field); })) fail("Некоректні або повторні ID у метаданих експорту.");
      ids.add(row.id);
    });
    return manifest;
  }

  function bytesOf(input) {
    let bytes;
    if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
    else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    else fail("Для імпорту потрібен файл .xlsx.");
    if (bytes.byteLength > limits.bytes) fail("Excel-файл перевищує 5 МБ. Розділіть його на менші файли.");
    if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) fail("Підтримується лише формат .xlsx. Збережіть файл як книгу Excel .xlsx.");
    return bytes;
  }

  // Check ZIP directory sizes before SheetJS expands the archive. This also rules out
  // legacy XLS, XLSB and macro containers renamed to .xlsx.
  function checkContainer(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
      if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { end = at; break; }
    }
    if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail("Некоректний або багатотомний Excel-файл.");
    const count = view.getUint16(end + 10, true);
    const directorySize = view.getUint32(end + 12, true);
    const directoryAt = view.getUint32(end + 16, true);
    if (!count || count > limits.entries || count !== view.getUint16(end + 8, true) || directoryAt + directorySize !== end) fail("Некоректна структура Excel-файлу.");
    const names = new Set();
    let at = directoryAt, expanded = 0;
    for (let index = 0; index < count; index++) {
      if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) fail("Некоректна структура Excel-файлу.");
      const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true);
      const compressed = view.getUint32(at + 20, true), unpacked = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
      const offset = view.getUint32(at + 42, true), next = at + 46 + nameLength + extraLength + commentLength;
      if (next > end || !nameLength || flags & 1 || (method !== 0 && method !== 8) || offset + 30 > directoryAt || compressed > bytes.length || unpacked === 0xffffffff) fail("Зашифровані або некоректні Excel-файли не підтримуються.");
      let name = "";
      for (let pos = at + 46; pos < at + 46 + nameLength; pos++) name += String.fromCharCode(bytes[pos]);
      if (names.has(name) || /(?:^|\/)\.\.?(?:\/|$)|\\/.test(name)) fail("Некоректна структура Excel-файлу.");
      names.add(name);
      expanded += unpacked;
      if (expanded > limits.expandedBytes) fail("Розпакований Excel-файл завеликий. Розділіть його на менші файли.");
      if (/(?:^|\/)(?:vbaProject\.bin|macrosheets|dialogsheets|externalLinks)(?:\/|$)/i.test(name) || /(?:^|\/)workbook\.bin$/i.test(name)) fail("Файли з макросами або зовнішніми зв’язками не підтримуються. Збережіть звичайний .xlsx без них.");
      at = next;
    }
    if (at !== end || !names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) fail("Підтримується лише формат .xlsx.");
  }

  function create(XLSX) {
    if (!XLSX || typeof XLSX.read !== "function" || typeof XLSX.write !== "function" || !XLSX.utils) fail("Модуль Excel недоступний. Оновіть сторінку.");
    const address = XLSX.utils.encode_cell;

    function valueAt(sheet, row, column) {
      const cell = sheet[address({ r: row, c: column })];
      if (!cell) return "";
      if (cell.f != null || cell.F != null) fail("Формули не підтримуються (" + address({ r: row, c: column }) + "). Замініть формули на значення та імпортуйте файл знову.");
      if (cell.t === "e") fail("Excel містить помилку в клітинці " + address({ r: row, c: column }) + ". Виправте її перед імпортом.");
      if (cell.t === "z" || cell.v == null) return "";
      if (cell.t !== "s" && cell.t !== "n" && cell.t !== "b" && cell.t !== "str") fail("Непідтримуваний тип клітинки " + address({ r: row, c: column }) + ". Вставте звичайне значення.");
      if (typeof cell.v === "number" && !Number.isFinite(cell.v)) fail("Некоректне число в Excel.");
      return cell.v;
    }

    function bounds(sheet, label) {
      if (!sheet || typeof sheet["!ref"] !== "string") fail("Немає аркуша «" + label + "» або він порожній.");
      let range;
      try { range = XLSX.utils.decode_range(sheet["!ref"]); } catch (error) { fail("Некоректний діапазон аркуша «" + label + "»."); }
      if (!range || !Number.isSafeInteger(range.e.r) || !Number.isSafeInteger(range.e.c) || range.s.r < 0 || range.s.c < 0 || range.e.r > 1048575 || range.e.c > 16383) fail("Некоректний діапазон Excel.");
      return range;
    }

    function validateCells(sheet, maxColumns, maxRow) {
      Object.keys(sheet).forEach(function (key) {
        if (key[0] === "!") return;
        if (!/^[A-Z]+[1-9]\d*$/.test(key)) fail("Некоректна адреса клітинки Excel.");
        const cell = sheet[key], position = XLSX.utils.decode_cell(key);
        // Formulas with no cached value must also be rejected.
        if (cell && (cell.f != null || cell.F != null || cell.t === "e")) valueAt(sheet, position.r, position.c);
        if (cell && cell.v != null && cell.v !== "" && (position.c >= maxColumns || position.r > maxRow)) fail("Excel містить забагато рядків або стовпців чи дані поза таблицею.");
      });
    }

    function readMetadata(sheet) {
      const range = bounds(sheet, metadataName);
      if (range.e.c > 0 || range.e.r > Math.ceil(limits.metadataChars / chunkSize) + 2) fail("Некоректні метадані Excel.");
      validateCells(sheet, 1, range.e.r);
      if (valueAt(sheet, 0, 0) !== format || valueAt(sheet, 1, 0) !== 1) fail("Це не файл складського експорту SPARTA. Завантажте новий Excel зі складу.");
      const count = valueAt(sheet, 2, 0);
      if (!Number.isSafeInteger(count) || count < 1 || count > Math.ceil(limits.metadataChars / chunkSize) || range.e.r !== count + 2) fail("Пошкоджені метадані Excel. Завантажте новий файл зі складу.");
      let json = "";
      for (let index = 0; index < count; index++) {
        const chunk = valueAt(sheet, index + 3, 0);
        if (typeof chunk !== "string" || !chunk.length || chunk.length > chunkSize) fail("Пошкоджені метадані Excel.");
        json += chunk;
      }
      if (json.length > limits.metadataChars) fail("Метадані Excel завеликі.");
      let manifest;
      try { manifest = JSON.parse(json); } catch (error) { fail("Пошкоджені метадані Excel. Завантажте новий файл зі складу."); }
      return validateManifest(manifest);
    }

    function read(input) {
      const bytes = bytesOf(input);
      checkContainer(bytes);
      let workbook;
      try {
        workbook = XLSX.read(bytes, { type: "array", cellFormula: true, cellHTML: false, cellText: false, cellDates: true, bookVBA: true, WTF: true });
      } catch (error) { fail("Не вдалося прочитати Excel. Збережіть звичайний файл .xlsx без пароля та спробуйте знову."); }
      if (workbook.vbaraw || Object.values(workbook.Sheets || {}).some(function (sheet) { return sheet && sheet["!type"] === "macro"; })) fail("Excel з макросами не підтримується.");
      const manifest = readMetadata(workbook.Sheets && workbook.Sheets[metadataName]);
      const sheet = workbook.Sheets && workbook.Sheets[sheetName];
      const range = bounds(sheet, sheetName);
      if (range.e.c >= limits.columns) fail("Excel містить понад 25 стовпців.");
      validateCells(sheet, columns.length, limits.rows);
      if (sheet["!merges"] && sheet["!merges"].length) fail("Об’єднані клітинки на аркуші «Залишки» не підтримуються.");
      for (let column = 0; column < Math.max(columns.length, range.e.c + 1); column++) {
        if (valueAt(sheet, 0, column) !== headers[column]) fail("Заголовки аркуша «Залишки» змінено. Завантажте новий Excel і не додавайте та не перейменовуйте стовпці.");
      }
      const rows = [], ids = new Set();
      // Inspect actual cells rather than trusting inflated worksheet dimensions;
      // trailing blank/formatted Excel rows do not represent deleted products.
      const lastRow = Math.min(range.e.r, limits.rows);
      for (let index = 1; index <= lastRow; index++) {
        const values = columns.map(function (column, position) { return valueAt(sheet, index, position); });
        if (values.every(function (value) { return value === ""; })) continue;
        const row = {};
        fields.forEach(function (field, position) { row[field] = values[position]; });
        if (typeof row.id !== "string") fail("Некоректний ID товару в рядку " + (index + 1) + ". Не змінюйте ID наявних товарів.");
        if (row.id.trim()) {
          if (ids.has(row.id)) fail("Повторний ID товару в Excel: " + row.id);
          ids.add(row.id);
        }
        rows.push(row);
        if (rows.length > limits.rows) fail("Excel містить понад 10000 товарів.");
      }
      return { manifest: manifest, rows: rows };
    }

    function write(inputManifest, state) {
      validateManifest(inputManifest);
      // Never serialize arbitrary state, caller properties, user data or serials.
      const manifest = clone({ format: inputManifest.format, version: inputManifest.version, exportId: inputManifest.exportId,
        scope: inputManifest.scope, exportedAt: inputManifest.exportedAt,
        rows: inputManifest.rows.map(function (row) { return Object.fromEntries(fields.map(function (field) { return [field, row[field]]; })); }) });
      const json = JSON.stringify(manifest);
      if (json.length > limits.metadataChars) fail("Метадані експорту завеликі. Розділіть склад на менші файли.");
      const items = new Map(((state && state.items) || []).map(function (item) { return [String(item.id), item]; }));
      const reserved = new Map();
      ((state && state.reservations) || []).concat((state && state.orderReservations) || []).forEach(function (entry) {
        if (entry && Number.isFinite(Number(entry.qty))) reserved.set(String(entry.itemId), (reserved.get(String(entry.itemId)) || 0) + Number(entry.qty));
      });
      const data = [headers.slice()];
      manifest.rows.forEach(function (row) {
        const item = items.get(row.id) || row;
        const held = reserved.get(row.id) || 0;
        const extras = { reserved: Math.round((held + Number.EPSILON) * 1000) / 1000, available: Math.max(0, Math.round((Number(row.qty || 0) - held + Number.EPSILON) * 1000) / 1000),
          purchasePrice: item.purchasePriceKnown === false ? "" : Number(item.purchasePrice || 0),
          unitCost: item.purchasePriceKnown === false ? "" : Number(item.purchasePrice || 0) + Number(item.deliveryCost || 0) + Number(item.extraCost || 0) };
        data.push(columns.map(function (column) {
          const value = column.readonly ? extras[column.field] : own(row, column.field) ? row[column.field] : "";
          if (value !== "" && value != null && typeof value !== "number" && typeof value !== "string") fail("Некоректне значення експорту: " + column.header);
          if (typeof value === "number" && !Number.isFinite(value)) fail("Некоректне число експорту: " + column.header);
          return value == null ? "" : value;
        }));
      });
      const sheet = XLSX.utils.aoa_to_sheet(data);
      sheet["!cols"] = columns.map(function (column) { return { wch: column.width }; });
      sheet["!rows"] = [{ hpt: 30 }];
      sheet["!autofilter"] = { ref: "A1:" + address({ r: data.length - 1, c: columns.length - 1 }) };
      for (let row = 1; row < data.length; row++) {
        columns.forEach(function (column, position) {
          const cell = sheet[address({ r: row, c: position })];
          if (cell && column.number && cell.t === "n") cell.z = column.number;
        });
      }
      const instructions = [
        ["SPARTA — редагування залишків через Excel"],
        ["1. Редагуйте аркуш «Залишки». Один рядок відповідає одній картці товару."],
        ["2. «Залишок (кінцева кількість)» — кінцева абсолютна кількість після перерахунку, а не кількість для додавання. Наприклад: було 10, потрібно 12 — введіть 12."],
        ["3. Не змінюйте та не видаляйте ID, одиницю виміру й валюту наявного товару. Не додавайте й не перейменовуйте стовпці. Рядки можна сортувати."],
        ["4. Можна редагувати артикул, назву, категорію, бренд, модель, кінцевий залишок, три ціни продажу, мінімальний залишок і місце зберігання."],
        ["5. Зарезервовано, доступно, закупівельна ціна й собівартість наведені лише довідково. Їх редагування не змінює склад або закупівельні витрати."],
        ["6. Відсутній у файлі рядок не видаляє товар зі складу. Для нульового залишку явно введіть 0. Порожнє числове поле наявного товару зберігає попереднє значення."],
        ["7. Формули не імпортуються. Перед завантаженням скопіюйте результат формули та вставте лише значення. Збережіть файл як .xlsx."],
        ["8. Поверніть файл у той самий склад SPARTA: файл компанії — у склад тієї самої компанії; локальний файл — у той самий локальний простір."],
        ["9. У публічному робочому просторі компанії зміни застосовуються до спільного складу після перегляду та підтвердження. У локальному просторі — лише до локального складу."],
        ["10. Перед застосуванням перевірте попередній перегляд змін. Якщо склад змінився після експорту, завантажте свіжий Excel."],
        ["11. Серійні номери не редагуються через цей файл. Не видаляйте прихований службовий аркуш _Sparta."],
        ["12. Щоб створити новий товар, додайте рядок із порожнім ID. Заповніть назву, одиницю, валюту та кінцевий залишок. Новий товар не повинен дублювати наявний артикул або назву."],
      ];
      const instructionSheet = XLSX.utils.aoa_to_sheet(instructions);
      instructionSheet["!cols"] = [{ wch: 145 }];
      instructionSheet["!rows"] = instructions.map(function (_, index) { return { hpt: index === 0 ? 28 : 44 }; });
      const chunks = [];
      for (let at = 0; at < json.length;) {
        let end = Math.min(json.length, at + chunkSize);
        if (end < json.length && json.charCodeAt(end - 1) >= 0xd800 && json.charCodeAt(end - 1) <= 0xdbff) end--;
        chunks.push(json.slice(at, end));
        at = end;
      }
      const metadata = XLSX.utils.aoa_to_sheet([[format], [1], [chunks.length]].concat(chunks.map(function (chunk) { return [chunk]; })));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
      XLSX.utils.book_append_sheet(workbook, instructionSheet, "Інструкція");
      XLSX.utils.book_append_sheet(workbook, metadata, metadataName);
      workbook.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }] };
      workbook.Props = { Title: "SPARTA — залишки складу", Subject: "Редагування складських залишків", Author: "SPARTA" };
      const result = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true, cellStyles: true }));
      if (result.byteLength > limits.bytes) fail("Excel-файл перевищує 5 МБ. Розділіть склад на менші файли.");
      checkContainer(result);
      return result;
    }

    return Object.freeze({ write: write, read: read });
  }

  return Object.freeze({ create: create, format: format, fields: fields, headers: headers, columns: columns, limits: limits });
});
