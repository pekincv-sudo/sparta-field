"use strict";

async function runTests() {
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
  return { passed: currency.passed + domain.passed + integration.passed + isolation.passed + workflow.passed + proposal.passed + stages.passed + warehouse.passed + warehouseIntegration.passed + cleanUi.passed + cleanReset.passed + auth.passed + renderSafety.passed + warehouseCloud.passed + privateStorage.passed + publicBuild.passed + field.passed, currency, domain, integration, isolation, workflow, proposal, stages, warehouse, warehouseIntegration, cleanUi, cleanReset, auth, renderSafety, warehouseCloud, privateStorage, publicBuild, field };
}

if (require.main === module) {
  runTests().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = runTests;
