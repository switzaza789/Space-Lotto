// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title SpaceLotto (USDT + VRF + Automation)
 * @author Full Stack Expert
 * @notice ระบบลอตเตอรี่ธีมอวกาศ รองรับ USDT และ Chainlink VRF
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/AutomationCompatible.sol";

contract SpaceLotto is VRFConsumerBaseV2, AutomationCompatibleInterface, Ownable, ReentrancyGuard {
    
    // --- Config & State ---
    IERC20 public usdtToken; // สัญญาเหรียญ USDT (BEP-20)
    
    // Chainlink VRF Variables (สำหรับสุ่มเลข)
    VRFCoordinatorV2Interface COORDINATOR;
    uint64 s_subscriptionId;
    bytes32 keyHash;
    uint32 callbackGasLimit = 100000;
    uint16 requestConfirmations = 3;
    uint32 numWords = 1;

    // Lottery Variables
    uint256 public constant TICKET_PRICE = 5 * 10**18; // ราคาตั๋ว 5 USDT (สมมติ 18 decimals)
    uint256 public constant INTERVAL = 15 days; // รอบเวลา 15 วัน
    uint256 public constant MAX_NUMBER = 9999; // เลขสูงสุด (0000-9999) 4 หลัก
    
    // Wallets
    address public devWallet;     // กระเป๋าพัฒนา (10%)
    address public reserveWallet; // กระเป๋าสำรอง (10%)

    struct Round {
        uint256 id;
        uint256 endTime;
        uint256 prizePool;    // เงินรางวัลรวมในรอบนี้ (80% + Rollover)
        uint256 rolloverPot;  // เงินทบมาจากรอบที่แล้ว
        uint256 winningNumber; // เลขที่ออก
        bool isDrawn;
        bool hasWinner;
    }

    uint256 public currentRoundId;
    mapping(uint256 => Round) public rounds;
    
    // Mapping: Round ID -> (Chosen Number -> List of Owners)
    // เก็บว่าในรอบนั้นๆ เลขนี้ใครซื้อบ้าง
    mapping(uint256 => mapping(uint256 => address[])) public tickets;

    // 🌟 Implemented for Feature: My Hangar
    // Mapping: Round ID -> (User Address -> List of Purchased Numbers)
    // เก็บว่า User คนนี้ ซื้อเลขอะไรไปบ้างในรอบนั้นๆ
    mapping(uint256 => mapping(address => uint256[])) public userTickets;

    // Mapping: เก็บยอดเงินรางวัลที่รอรับของแต่ละ User (Token Balance ใน Contract)
    mapping(address => uint256) public pendingWinnings;
    
    // Mapping Check ว่าUser Claim รอบนั้นๆ ไปหรือยัง (ป้องกัน Claim ซ้ำ)
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event TicketBought(address indexed player, uint256 roundId, uint256 chosenNumber);
    event WinnerDrawn(uint256 roundId, uint256 winningNumber, uint256 winnerCount, uint256 prizePerWinner);
    event PotRollover(uint256 roundId, uint256 amount);
    event PrizeClaimed(address indexed winner, uint256 amount);

    constructor(
        address _usdtAddress, 
        address _vrfCoordinator, 
        uint64 _subscriptionId,
        bytes32 _keyHash,
        address _devWallet,
        address _reserveWallet
    ) VRFConsumerBaseV2(_vrfCoordinator) {
        usdtToken = IERC20(_usdtAddress);
        COORDINATOR = VRFCoordinatorV2Interface(_vrfCoordinator);
        s_subscriptionId = _subscriptionId;
        keyHash = _keyHash;
        devWallet = _devWallet;
        reserveWallet = _reserveWallet;

        // เริ่มรอบแรก
        currentRoundId = 1;
        rounds[currentRoundId].endTime = block.timestamp + INTERVAL;
    }

    // --- Core Logic: Buy Ticket ---
    function buyTicket(uint256 _chosenNumber) external nonReentrant {
        require(_chosenNumber <= MAX_NUMBER, "Number out of range (0000-9999)");
        require(block.timestamp < rounds[currentRoundId].endTime, "Round is closing");
        
        // 1. รับเงิน USDT จากผู้เล่น
        require(usdtToken.transferFrom(msg.sender, address(this), TICKET_PRICE), "USDT Transfer failed");

        // 2. คำนวณส่วนแบ่ง (Tax 20%, Prize 80%)
        uint256 totalTax = (TICKET_PRICE * 20) / 100;
        uint256 prizePart = TICKET_PRICE - totalTax;
        
        uint256 devShare = totalTax / 2; // 10%
        uint256 reserveShare = totalTax - devShare; // 10%

        // 3. ส่งค่าธรรมเนียมทันที
        usdtToken.transfer(devWallet, devShare);
        usdtToken.transfer(reserveWallet, reserveShare);

        // 4. เพิ่มเงินรางวัลเข้า Pot
        rounds[currentRoundId].prizePool += prizePart;

        // 5. บันทึกตั๋ว (ทั้งระบบรวม และของส่วนตัว)
        tickets[currentRoundId][_chosenNumber].push(msg.sender);
        userTickets[currentRoundId][msg.sender].push(_chosenNumber);

        emit TicketBought(msg.sender, currentRoundId, _chosenNumber);
    }

    // --- Chainlink Automation: ตรวจสอบว่าถึงเวลาสุ่มหรือยัง ---
    function checkUpkeep(bytes calldata /* checkData */) external view override returns (bool upkeepNeeded, bytes memory /* performData */) {
        bool timePassed = block.timestamp >= rounds[currentRoundId].endTime;
        bool notDrawn = !rounds[currentRoundId].isDrawn;
        upkeepNeeded = timePassed && notDrawn;
    }

    // --- Chainlink Automation: สั่งให้สุ่ม ---
    function performUpkeep(bytes calldata /* performData */) external override {
        require(block.timestamp >= rounds[currentRoundId].endTime, "Not yet time");
        require(!rounds[currentRoundId].isDrawn, "Already drawn");

        // ขอเลขสุ่มจาก Chainlink VRF
        COORDINATOR.requestRandomWords(
            keyHash,
            s_subscriptionId,
            requestConfirmations,
            callbackGasLimit,
            numWords
        );
    }

    // --- Chainlink VRF: รับเลขสุ่มกลับมา ---
    function fulfillRandomWords(uint256 /* requestId */, uint256[] memory randomWords) internal override {
        Round storage round = rounds[currentRoundId];
        
        // แปลงเลขสุ่มมหาศาล ให้เหลือแค่ 0-9999
        uint256 winningNum = randomWords[0] % (MAX_NUMBER + 1);
        round.winningNumber = winningNum;
        round.isDrawn = true;

        // คำนวณรางวัล
        address[] memory winners = tickets[currentRoundId][winningNum];
        uint256 winnerCount = winners.length;

        if (winnerCount > 0) {
            // ✅ UPDATED: ไม่โอน Auto แล้ว แต่คำนวณไว้ให้มา Claim 
            // (ประหยัด Gas ตรงนี้มหาศาล และไม่มีทาง Error)
            uint256 prizePerWinner = round.prizePool / winnerCount;
            
            // บันทึกไว้เฉยๆ ว่ารอบนี้ ถ้าใครถูกจะได้เท่าไหร่ (User ต้องมา Check เองใน claimPrize)
            // เราไม่วน Loop update balance คนชนะทุกคน เพราะเปลือง Gas
            // แต่เราจะใช้ Logic On-Demand ในฟังก์ชัน claim ได้
            
            round.hasWinner = true;
            // เก็บ Prize Per Winner ลงใน Round struct หรือ Event เพื่อใช้ verify ทีหลัง
            // แต่เนื่องจาก Solidity จำกัด Stack, เราจะใช้วิธีคำนวณ On-the-fly ตอน Claim ง่ายกว่า
            
            emit WinnerDrawn(currentRoundId, winningNum, winnerCount, prizePerWinner);
            startNextRound(0);
        } else {
            // ไม่มีคนถูก -> Rollover
            emit PotRollover(currentRoundId, round.prizePool);
            startNextRound(round.prizePool);
        }
    }

    function startNextRound(uint256 _rolloverAmount) internal {
        currentRoundId++;
        rounds[currentRoundId].id = currentRoundId;
        rounds[currentRoundId].endTime = block.timestamp + INTERVAL;
        rounds[currentRoundId].rolloverPot = _rolloverAmount;
        rounds[currentRoundId].prizePool = _rolloverAmount;
    }

    // --- 🌟 NEW FEATURE: Claim Prize (ปลอดภัย ไม่ติด Gas Limit) ---
    function claimPrize(uint256 _roundId) external nonReentrant {
        Round storage round = rounds[_roundId];
        require(round.isDrawn, "Round not drawn yet");
        require(!hasClaimed[_roundId][msg.sender], "Already claimed for this round");

        // ดึงเลขที่ User ซื้อในรอบนั้น
        uint256[] memory myNumbers = userTickets[_roundId][msg.sender];
        require(myNumbers.length > 0, "No tickets bought");

        uint256 winningNum = round.winningNumber;
        uint256 totalWinningCount = tickets[_roundId][winningNum].length;
       
        require(totalWinningCount > 0, "No winners in this round"); // กันเหนียว

        uint256 myWinningTickets = 0;
        for(uint256 i=0; i<myNumbers.length; i++) {
            if(myNumbers[i] == winningNum) {
                myWinningTickets++;
            }
        }

        require(myWinningTickets > 0, "You did not win");

        // คำนวณรางวัล
        uint256 prizePerTicket = round.prizePool / totalWinningCount; // *ต้องระวัง round.prizePool คือค่าของรอบนั้นๆ* 
        // ข้อควรระวัง: ถ้า startNextRound ไปแล้ว ค่า prizePool ของรอบเก่าต้องไม่เปลี่ยน
        // ซึ่งโครงสร้าง Round เก็บ value แยกกันอยู่แล้ว ปลอดภัยครับ

        uint256 totalPayout = prizePerTicket * myWinningTickets;

        hasClaimed[_roundId][msg.sender] = true;
        require(usdtToken.transfer(msg.sender, totalPayout), "Transfer failed");

        emit PrizeClaimed(msg.sender, totalPayout);
    }

    // --- 🛡️ SAFETY: Emergency Withdraw (เผื่อเงินติด) ---
    function emergencyWithdraw(address _token, uint256 _amount) external onlyOwner {
        IERC20(_token).transfer(msg.sender, _amount);
    }
    
    // View Functions
    function getCurrentPot() external view returns (uint256) {
        return rounds[currentRoundId].prizePool;
    }
}