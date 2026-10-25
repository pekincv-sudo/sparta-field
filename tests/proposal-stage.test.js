"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

module.exports = function runProposalStageTests() {
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const names = ["renderProjectStageContent", "renderTabById", "workflowFileCategories", "renderTab", "renderProjectFiles", "renderProjectFileCard", "projectFileCategoryLabel", "projectFileIcon", "formatFileSize", "formatProjectFileDate", "renderCommercialOfferStage", "offerLineTotals", "emptyProjectFinance", "normalizeProjectFinance", "warehouseUnitCost"];
  const context = { selectedTab: "new", warehouseItems: [], money: (amount) => `${amount} грн`, escapeAttribute: (value) => String(value ?? "") };
  vm.createContext(context);
  names.forEach((name) => {
    const match = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, `Production function ${name} exists`);
    vm.runInContext(match[0], context);
  });
  const project = {
    id: "proposal-test", status: "service",
    files: [
      { category: "receipt", fileName: "receipt-excluded.svg", note: "Receipt sentinel", fileKey: "receipt", size: 100 },
      { category: "other", fileName: "site-photo-excluded.jpg", note: "Photo sentinel", fileKey: "photo", size: 100 },
      { category: "contract", fileName: "contract-excluded.pdf", fileKey: "contract", size: 100 },
      { category: "commercial_offer", fileName: "proposal-included.pdf", note: "Quote version 1", fileKey: "proposal", size: 100 },
      { category: "passport", fileName: "passport-excluded.pdf", fileKey: "passport", size: 100 },
      { category: "estimate_update", fileName: "estimate-in-archive.pdf", fileKey: "estimate", size: 100 },
    ],
    photos: [{ src: "data:image/png;base64,test", caption: "Work photo sentinel" }],
    finance: { installationPrice: 400, crewPayroll: 200, expenses: [{ name: "Paid expense sentinel", amount: 50 }], offerLines: [{ id: "line", name: "Quoted equipment", category: "Панелі", unit: "шт", qty: 2, purchasePrice: 100, salePrice: 150 }] },
  };
  const before = JSON.stringify(project);
  const checks = [];
  const check = (name, callback) => { callback(); checks.push(name); };
  const quoteHtml = context.renderTabById("files", project, true, 0, 0, "proposal");
  check("Proposal files show only commercial offers", () => {
    assert.match(quoteHtml, /proposal-included\.pdf/);
    assert.doesNotMatch(quoteHtml, /receipt-excluded|site-photo-excluded|contract-excluded|passport-excluded|estimate-in-archive/);
  });
  check("Filtered offer retains original open and delete index", () => {
    assert.match(quoteHtml, /data-open-file-index="3"/);
    assert.match(quoteHtml, /data-delete-file-index="3"/);
    assert.doesNotMatch(quoteHtml, /data-(?:open|delete)-file-index="0"/);
  });
  check("Proposal uploads cannot be categorized as unrelated documents", () => {
    const options = [...quoteHtml.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(options, ["commercial_offer"]);
    assert.match(quoteHtml, /Додати файл КП/);
  });
  check("Unscoped archive retains access to all original documents", () => {
    const archive = context.renderTabById("files", project, true, 0, 0);
    project.files.forEach((file) => assert.ok(archive.includes(file.fileName)));
    assert.match(archive, /<option value="receipt">/);
  });
  check("Proposal empty state depends on filtered results", () => {
    const withoutQuote = { ...project, files: project.files.filter((file) => file.category !== "commercial_offer") };
    const html = context.renderTabById("files", withoutQuote, true, 0, 0, "proposal");
    assert.match(html, /Файли КП ще не додано/);
    assert.doesNotMatch(html, /receipt-excluded|contract-excluded|site-photo-excluded/);
  });
  check("Complete proposal stage has quote totals but no paid-expense journal or work photos", () => {
    const html = context.renderProjectStageContent("proposal", project, true, 0, 0);
    assert.match(html, /Quoted equipment/);
    assert.match(html, /Разом КП/);
    assert.match(html, /700 грн/);
    assert.doesNotMatch(html, /Paid expense sentinel|Receipt sentinel|Photo sentinel|Work photo sentinel|projectExpenseForm/);
  });
  check("Proposal browsing preserves all stored files, expenses, project status and selected section", () => {
    context.renderProjectStageContent("proposal", project, true, 0, 0);
    assert.equal(JSON.stringify(project), before);
    assert.equal(context.selectedTab, "new");
    assert.equal(project.status, "service");
  });
  return { passed: checks.length, checks };
};
