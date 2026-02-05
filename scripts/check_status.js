const hre = require("hardhat");

async function main() {
    console.log("🔍 CHECKING BLOCKCHAIN STATUS...\n");

    const LOTTO_ADDR = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";

    const lotto = await hre.ethers.getContractAt("SpaceLottoSimple", LOTTO_ADDR);

    // 1. Current Round
    const currentRound = await lotto.currentRoundId();
    console.log("📍 Current Round:", currentRound.toString());

    // 2. Prize Pool
    const roundData = await lotto.rounds(currentRound);
    const prizePool = hre.ethers.formatUnits(roundData.prizePool, 18);
    console.log("💰 Prize Pool:", prizePool, "USDT");

    // 3. Query WinnerDrawn Events
    const filter = lotto.filters.WinnerDrawn();
    const events = await lotto.queryFilter(filter, 0, "latest");
    console.log("\n🏆 GLOBAL WINNERS (WinnerDrawn Events):");
    console.log("   Total Events Found:", events.length);

    if (events.length === 0) {
        console.log("   ⚠️ No winners drawn yet.");
    } else {
        events.slice(-5).reverse().forEach((e, idx) => {
            const { roundId, winningNumber, winnerCount, prizePerWinner } = e.args;
            const prize = hre.ethers.formatUnits(prizePerWinner, 18);
            console.log(`   #${roundId}: Number ${winningNumber} | ${winnerCount} Winners | ${prize} USDT each`);
        });
    }

    console.log("\n✅ STATUS CHECK COMPLETE!");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
