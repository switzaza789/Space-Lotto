const hre = require("hardhat");
require("dotenv").config();

async function main() {
    const contractAddress = process.env.REACT_APP_CONTRACT_ADDRESS;
    const SpaceLotto = await hre.ethers.getContractFactory("SpaceLottoSimple");
    const lotto = SpaceLotto.attach(contractAddress);

    // Get winning number from args
    const winningNumber = process.env.WIN_NUM || "1111"; // Default 1111

    const roundId = await lotto.currentRoundId();
    console.log(`🎲 Drawing Winner for Round #${roundId}...`);
    console.log(`   Winning Number: ${winningNumber}`);

    try {
        const tx = await lotto.drawWinner(winningNumber);
        await tx.wait();
        console.log("✅ Round Drawn Successfully!");
    } catch (e) {
        console.error("❌ Failed to draw winner:", e.message);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
