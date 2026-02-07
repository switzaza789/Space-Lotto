const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // Define devWallet and reserveWallet for the SpaceLotto deployment
    // Assuming they are the deployer for this script, as in the original code.
    const devWallet = deployer.address;
    const reserveWallet = deployer.address;

    // 1. Deploy MockUSDT
    const MockUSDT = await hre.ethers.getContractFactory("MockUSDT");
    const usdt = await MockUSDT.deploy();
    await usdt.waitForDeployment(); // Updated for newer ethers/hardhat
    const usdtAddr = await usdt.getAddress();
    console.log("✅ MockUSDT deployed to:", usdtAddr);

    // 2. Deploy SpaceLottoSimple
    const SpaceLotto = await hre.ethers.getContractFactory("SpaceLottoSimple");
    const lotto = await SpaceLotto.deploy(usdtAddr, devWallet, reserveWallet);
    await lotto.waitForDeployment();
    const lottoAddr = await lotto.getAddress();
    console.log("✅ SpaceLottoSimple deployed to:", lottoAddr);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});