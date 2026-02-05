const hre = require("hardhat");

async function main() {
    console.log("🎬 STARTING LIVE SIMULATION...");

    // 1. Setup Data
    const PROVIDER = new hre.ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const [deployer, player1, player2] = await hre.ethers.getSigners();

    // Addresses from your deployment
    const LOTTO_ADDR = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
    const USDT_ADDR = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";

    const lotto = await hre.ethers.getContractAt("SpaceLottoSimple", LOTTO_ADDR);
    const usdt = await hre.ethers.getContractAt("MockUSDT", USDT_ADDR);

    console.log("-----------------------------------------");
    console.log("👻 Simulation by Ghost Tester");
    console.log("-----------------------------------------");

    // 2. Fund Players (แจกเงินให้ Player 1 และ 2 คนละ 100 USDT)
    console.log("💸 Funding players...");
    await usdt.connect(deployer).transfer(player1.address, hre.ethers.parseUnits("100", 18));
    await usdt.connect(deployer).transfer(player2.address, hre.ethers.parseUnits("100", 18));

    // 3. Players Approve
    console.log("✅ Approving USDT...");
    await usdt.connect(player1).approve(LOTTO_ADDR, hre.ethers.MaxUint256);
    await usdt.connect(player2).approve(LOTTO_ADDR, hre.ethers.MaxUint256);
    await usdt.connect(deployer).approve(LOTTO_ADDR, hre.ethers.MaxUint256);

    // 4. BUYING TICKETS (ซื้อรัวๆ)
    console.log("🎟️ Players are buying tickets...");

    // Player 1 ซื้อ 7777
    console.log("   ➤ Player 1 buys '7777'");
    await lotto.connect(player1).buyTicket(7777);
    await sleep(2000); // Wait to let UI update

    // Player 2 ซื้อ 3333
    console.log("   ➤ Player 2 buys '3333'");
    await lotto.connect(player2).buyTicket(3333);
    await sleep(2000);

    // Deployer ซื้อ 7777 (ซื้อตาม)
    console.log("   ➤ Deployer (You) buys '7777' (Follow bet)");
    await lotto.connect(deployer).buyTicket(7777);

    // 🔥 STOP HERE! Let the user enjoy the pot
    console.log("\n💰 TICKETS BOUGHT! GO CHECK THE WEBSITE!");
    console.log("   Current Pot should be visible now.");
    console.log("   (You can define the winner manually on UI)");

    /* 
    // SKIP AUTO-DRAW
    // 5. DRAW WINNER
    console.log("\n🎰 DRAWING WINNER...");
    console.log("   ➤ Winning Number is: 7777");
    const tx = await lotto.connect(deployer).drawWinner(7777);
    await tx.wait();
    console.log("🎉 WINNER ANNOUNCED! (Refresh your browser to see next round)");

    // 6. Claim
    console.log("\n💰 Player 1 is claiming prize...");
    const roundId = (await lotto.currentRoundId()) - 1n; // Previous round
    await lotto.connect(player1).claimPrize(roundId);
    console.log("✅ Player 1 Claimed Successfully!");
    */

    console.log("\n✨ SIMULATION COMPLETE! Pot is ready for you.");
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
