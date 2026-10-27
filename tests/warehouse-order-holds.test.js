"use strict";
const assert = require("node:assert/strict");
const core = require("../warehouse-core.js");
module.exports = function () {
  const checks = [], check = (name, fn) => { fn(); checks.push(name); };
  const item = {id:"pv", name:"Панель", sku:"PV", category:"Панелі", unit:"шт", currency:"USD", qty:10, retailPrice:120, installerPrice:100, wholesalePrice:90};
  const projects = [{id:"p1",itemId:"pv",projectId:"site-a",qty:2}, {id:"p2",itemId:"pv",projectId:"site-b",qty:1}];
  const holds = [{id:"h",itemId:"pv",orderId:"o",orderNumber:"B-1",qty:4}];
  check("Buyer holds reduce free quantity alongside project reservations", () => {
    assert.equal(core.reservedQty(projects,"pv",undefined,holds),7);
    assert.equal(core.availableQty(item,projects,undefined,holds),3);
    assert.equal(core.availableQty(item,projects,"site-a",holds),5);
    assert.equal(core.reservedQty(projects,"pv","site-a",holds),2);
  });
  check("Availability filters include buyer holds without changing physical stock", () => {
    const allHeld = [{...holds[0],qty:7}];
    assert.equal(core.filterItems([item],{availability:"available"},projects,allHeld).length,0);
    assert.equal(core.filterItems([item],{availability:"reserved"},[],holds).length,1);
    assert.equal(core.filterItems([item],{availability:"in_stock"},projects,allHeld).length,1);
    assert.equal(item.qty,10);
  });
  check("New project reservation cannot take stock already promised to a buyer", () => {
    const state = {items:[item],reservations:projects,orderReservations:holds,movements:[],documents:[]};
    const before = JSON.stringify(state);
    assert.throws(() => core.reserve(state,{id:"r",number:"R",date:"2026-10-27",projectId:"site-c",lines:[{itemId:"pv",qty:4}]}));
    assert.equal(JSON.stringify(state),before);
  });
  check("Stocktake cannot count below combined buyer and project commitments", () => {
    const state = {items:[item],reservations:projects,orderReservations:holds,movements:[],documents:[]};
    const before = JSON.stringify(state);
    assert.throws(() => core.postStocktake(state,{id:"s",number:"S",date:"2026-10-27",reason:"Перерахунок",lines:[{itemId:"pv",countedQty:6}]}));
    assert.equal(JSON.stringify(state),before);
  });
  check("Independent retail, installer and wholesale prices survive catalog edits", () => {
    const saved = core.saveCatalog([item],{...item,retailPrice:130,installerPrice:110,wholesalePrice:95})[0];
    assert.equal(saved.retailPrice,130); assert.equal(saved.salePrice,130);
    assert.equal(saved.installerPrice,110); assert.equal(saved.wholesalePrice,95);
    assert.equal(saved.qty,10);
    const missing = core.saveCatalog([saved],{id:"pv",name:"Оновлена панель",wholesalePrice:0})[0];
    assert.equal(missing.wholesalePrice,0); assert.equal(missing.installerPrice,110); assert.equal(missing.retailPrice,130);
    for (const value of [-1,"bad",Infinity]) assert.throws(() => core.saveCatalog([item],{id:"pv",name:"Панель",wholesalePrice:value}));
  });
  return {passed:checks.length,checks};
};
if (require.main === module) console.log(JSON.stringify(module.exports(),null,2));
