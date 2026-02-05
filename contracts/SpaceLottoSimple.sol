// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract SpaceLottoSimple is Ownable, ReentrancyGuard {
    
    IERC20 public usdtToken;
    // ตั้งราคาตั๋ว 5 USDT (18 decimals)
    uint256 public constant TICKET_PRICE = 5 * 10**18; 
    
    // Wallets สำหรับรับค่าธรรมเนียม
    address public devWallet;
    address public reserveWallet;

    struct Round {
        uint256 id;
        uint256 prizePool; 
        uint256 winningNumber;
        bool isDrawn;
    }

    uint256 public currentRoundId;
    mapping(uint256 => Round) public rounds;
    // เก็บว่าเลขนี้ ใครซื้อบ้าง: roundId => number => addresses
    mapping(uint256 => mapping(uint256 => address[])) public tickets;
    // เก็บว่าคนนี้ ซื้อเลขอะไรบ้าง: roundId => user => numbers
    mapping(uint256 => mapping(address => uint256[])) public userTickets;
    // เช็คว่ารับรางวัลไปหรือยัง
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event TicketBought(address indexed player, uint256 roundId, uint256 chosenNumber);
    event WinnerDrawn(uint256 roundId, uint256 winningNumber, uint256 winnerCount, uint256 prizePerWinner);
    event PrizeClaimed(address indexed winner, uint256 amount);

    constructor(address _usdtAddress, address _devWallet, address _reserveWallet) {
        usdtToken = IERC20(_usdtAddress);
        devWallet = _devWallet;
        reserveWallet = _reserveWallet;
        currentRoundId = 1;
        rounds[currentRoundId].id = 1;
    }

    // ฟังก์ชันซื้อหวย
    function buyTicket(uint256 _chosenNumber) external nonReentrant {
        require(!rounds[currentRoundId].isDrawn, "Round ended");
        // รับเงิน 5 USDT
        require(usdtToken.transferFrom(msg.sender, address(this), TICKET_PRICE), "Transfer failed");

        // แบ่ง 20% เข้าเจ้ามือ
        uint256 totalTax = (TICKET_PRICE * 20) / 100;
        // แบ่ง 80% เข้ากองกลาง
        uint256 prizePart = TICKET_PRICE - totalTax;
        
        // โอนค่าธรรมเนียมทันที
        usdtToken.transfer(devWallet, totalTax / 2);
        usdtToken.transfer(reserveWallet, totalTax - (totalTax/2));

        // เพิ่มเงินรางวัลเข้ากองกลาง
        rounds[currentRoundId].prizePool += prizePart;
        
        // บันทึกข้อมูลตั๋ว
        tickets[currentRoundId][_chosenNumber].push(msg.sender);
        userTickets[currentRoundId][msg.sender].push(_chosenNumber);

        emit TicketBought(msg.sender, currentRoundId, _chosenNumber);
    }

    // ฟังก์ชันออกรางวัล (เจ้าของกดเองได้เลย)
    function drawWinner(uint256 _winningNumber) external onlyOwner {
        require(!rounds[currentRoundId].isDrawn, "Already drawn");
        
        rounds[currentRoundId].winningNumber = _winningNumber;
        rounds[currentRoundId].isDrawn = true;

        uint256 winnerCount = tickets[currentRoundId][_winningNumber].length;
        uint256 prizePerWinner = 0;
        
        if(winnerCount > 0) {
            // หารรางวัลเท่าๆ กัน
            prizePerWinner = rounds[currentRoundId].prizePool / winnerCount;
        }

        emit WinnerDrawn(currentRoundId, _winningNumber, winnerCount, prizePerWinner);
        
        // เริ่มรอบใหม่ทันที
        uint256 nextRoundId = currentRoundId + 1;
        rounds[nextRoundId].id = nextRoundId;
        
        // ถ้าไม่มีคนถูกรางวัล ให้ทบเงินไปรอบหน้า (Rollover)
        if (winnerCount == 0) {
             rounds[nextRoundId].prizePool = rounds[currentRoundId].prizePool;
        }
        
        currentRoundId = nextRoundId;
    }

    // ฟังก์ชันมารับรางวัล (User กดเอง)
    function claimPrize(uint256 _roundId) external nonReentrant {
        require(rounds[_roundId].isDrawn, "Not drawn");
        require(!hasClaimed[_roundId][msg.sender], "Claimed");

        uint256 winningNum = rounds[_roundId].winningNumber;
        uint256 totalWinners = tickets[_roundId][winningNum].length;
        require(totalWinners > 0, "No winners");

        // นับจำนวนใบที่ถูกรางวัลของคนนี้
        uint256 myWinningTickets = 0;
        uint256[] memory myNumbers = userTickets[_roundId][msg.sender];
        for(uint256 i=0; i<myNumbers.length; i++) {
            if(myNumbers[i] == winningNum) myWinningTickets++;
        }
        require(myWinningTickets > 0, "Not winner");

        // จ่ายรางวัล
        uint256 payout = (rounds[_roundId].prizePool / totalWinners) * myWinningTickets;
        hasClaimed[_roundId][msg.sender] = true;
        usdtToken.transfer(msg.sender, payout);
        
        emit PrizeClaimed(msg.sender, payout);
    }

    function getUserTickets(uint256 _roundId, address _user) external view returns (uint256[] memory) {
        return userTickets[_roundId][_user];
    }
}