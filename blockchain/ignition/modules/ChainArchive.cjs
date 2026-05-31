const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ChainArchiveModule", (m) => {
  // Deploy the ChainArchive contract
  const chainArchive = m.contract("ChainArchive");

  return { chainArchive };
});
