"use strict";

async function runTests() {
  const solarDash = require("./solar-dash.test.js")();
  const sunGame = require("./sun-game.test.js")();
  const productPhotos = require("./product-photos.test.js")();
  const inventoryImport = require("./inventory-import.test.js")();
  const inventoryImportUI = await require("./inventory-import-ui.test.js")();
  const buyerAuth = await require("./buyer-auth.test.js")();
  const buyerCloud = await require("./buyer-cloud.test.js")();
  const buyerUi = await require("./buyer-ui.test.js")();
  const buyerStock = require("./warehouse-order-holds.test.js")();
  const taskAccess = await require("./task-access.test.js")();
  const authFlow = await require("./auth-flow.test.js")();
  const invitationApi = await require("./send-invitation.test.js")();
  const invitationDelivery = await require("./invitation-delivery.test.js")();
  const team = await require("./team-access.test.js")();
  const currency = require("./currency.test.js")();
  const domain = require("./cash-ledger.test.js")();
  const integration = await require("./cash-book.integration.test.js")();
  const isolation = require("./local-workspace.test.js")();
  const workflow = require("./workflow-test.js")();
  const proposal = require("./proposal-stage.test.js")();
  const stages = require("./stage-scope.test.js")();
  const warehouse = { passed: require("./warehouse-core.test.js")() };
  const warehouseIntegration = await require("./warehouse-ui.integration.test.js")();
  const cleanUi = require("./clean-ui.test.js")();
  const cleanReset = require("./workspace-reset-core.test.js")();
  const auth = await require("./auth-session.test.js")();
  const renderSafety = require("./render-safety.test.js")();
  const warehouseCloud = await require("./warehouse-cloud.test.js")();
  const privateStorage = await require("./private-storage.test.js")();
  const publicBuild = await require("./public-build.test.js")();
  const field = await require("./field-project-sync.test.js")();
  return { passed: solarDash.passed + sunGame.passed + productPhotos.passed + inventoryImport.passed + inventoryImportUI.passed + buyerAuth.passed + buyerCloud.passed + buyerUi.passed + buyerStock.passed + taskAccess.passed + authFlow.passed + invitationApi.passed + invitationDelivery.passed + team.passed + currency.passed + domain.passed + integration.passed + isolation.passed + workflow.passed + proposal.passed + stages.passed + warehouse.passed + warehouseIntegration.passed + cleanUi.passed + cleanReset.passed + auth.passed + renderSafety.passed + warehouseCloud.passed + privateStorage.passed + publicBuild.passed + field.passed, inventoryImport, inventoryImportUI, buyerAuth, buyerCloud, buyerUi, buyerStock, taskAccess, authFlow, invitationApi, invitationDelivery, team, currency, domain, integration, isolation, workflow, proposal, stages, warehouse, warehouseIntegration, cleanUi, cleanReset, auth, renderSafety, warehouseCloud, privateStorage, publicBuild, field, productPhotos, solarDash, sunGame };
}

if (require.main === module) {
  runTests().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = runTests;
