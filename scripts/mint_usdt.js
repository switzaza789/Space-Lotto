const hre = require("hardhat");
require("dotenv").config();

async function main() {
    const [owner] = await hre.ethers.getSigners();
    const usdtAddress = process.env.REACT_APP_USDT_ADDRESS;

    const MockUSDT = await hre.ethers.getContractFactory("MockUSDT");
    const usdt = MockUSDT.attach(usdtAddress);

    const amount = hre.ethers.parseUnits("1000", 18); // 1,000 USDT
    console.log(`Minting 1,000 USDT to ${owner.address}...`);

    await (await usdt.mint(owner.address, amount)).wait();

    const balance = await usdt.balanceOf(owner.address);
    console.log(`✅ Success! New Balance: ${hre.ethers.formatUnits(balance, 18)} USDT`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
