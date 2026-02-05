const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // 1. Deploy เหรียญ USDT ปลอม
    const MockUSDT = await hre.ethers.getContractFactory("MockUSDT");
    const usdt = await MockUSDT.deploy();
    await usdt.waitForDeployment();
    const usdtAddress = await usdt.getAddress();
    console.log("✅ MockUSDT deployed to:", usdtAddress);

    // 2. Deploy ตู้หวย
    const SpaceLotto = await hre.ethers.getContractFactory("SpaceLottoSimple");
    const lotto = await SpaceLotto.deploy(usdtAddress, deployer.address, deployer.address);
    await lotto.waitForDeployment();
    console.log("✅ SpaceLottoSimple deployed to:", await lotto.getAddress());
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});