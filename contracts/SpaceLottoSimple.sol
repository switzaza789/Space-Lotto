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
    // เก็บคนที่แนะนำ (User => Referrer)
    mapping(address => address) public referrers;
    // เก็บยอดเงินสะสม
    mapping(address => uint256) public referralEarnings;
    // เก็บยอดเงินสะสมแยกตามรอบ (RoundId => User => Amount)
    mapping(uint256 => mapping(address => uint256)) public referralEarningsByRound;
    // เก็บจำนวนคนที่แนะนำ
    mapping(address => uint256) public referralCount;

    // เก็บว่าเลขนี้ ใครซื้อบ้าง: roundId => number => addresses
    mapping(uint256 => mapping(uint256 => address[])) public tickets;
    // เก็บว่าคนนี้ ซื้อเลขอะไรบ้าง: roundId => user => numbers
    mapping(uint256 => mapping(address => uint256[])) public userTickets;
    // เช็คว่ารับรางวัลไปหรือยัง
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event TicketBought(address indexed player, uint256 roundId, uint256 chosenNumber);
    event WinnerDrawn(uint256 roundId, uint256 winningNumber, uint256 winnerCount, uint256 prizePerWinner);
    event PrizeClaimed(address indexed winner, uint256 amount);
    event ReferralReward(address indexed referrer, address indexed buyer, uint256 amount);

    constructor(address _usdtAddress, address _devWallet, address _reserveWallet) {
        usdtToken = IERC20(_usdtAddress);
        devWallet = _devWallet;
        reserveWallet = _reserveWallet;
        currentRoundId = 1;
        rounds[currentRoundId].id = 1;
    }

    // ฟังก์ชันซื้อหวย (เพิ่ม parameter ผู้แนะนำ)
    function buyTicket(uint256 _chosenNumber, address _referrer) external nonReentrant {
        _processPurchase(msg.sender, _chosenNumber, _referrer);
    }

    // ฟังก์ชันซื้อหวยหลายใบ (Bulk Buy)
    function buyTickets(uint256[] calldata _chosenNumbers, address _referrer) external nonReentrant {
        require(_chosenNumbers.length > 0, "No tickets");
        require(_chosenNumbers.length <= 50, "Max 50 tickets"); // Limit to prevent gas limit issues

        uint256 totalCost = TICKET_PRICE * _chosenNumbers.length;
        require(usdtToken.transferFrom(msg.sender, address(this), totalCost), "Transfer failed");

        // Process referral and fee ONCE for the whole batch to save gas? 
        // No, need to iterate to keep logic simple consistent or refactor.
        // Let's refactor logic to internal function but handle transfer outside to save gas?
        // Actually, internal function is safer. But transferFrom needs approval for total amount.
        // We already transferred totalCost to contract above. Now we just allocate.
        
        for (uint256 i = 0; i < _chosenNumbers.length; i++) {
            _allocateTicket(msg.sender, _chosenNumbers[i], _referrer, true); // true = money already in contract
        }
    }

    // Internal function to process single purchase (with transfer)
    function _processPurchase(address _buyer, uint256 _chosenNumber, address _referrer) internal {
        require(!rounds[currentRoundId].isDrawn, "Round ended");
        require(usdtToken.transferFrom(_buyer, address(this), TICKET_PRICE), "Transfer failed");
        _allocateTicket(_buyer, _chosenNumber, _referrer, false); // false = money just arrived
    }

    // Internal function to allocate ticket and distribute fees
    // _prePaid: true if funds were already transferred in batch, false if using single transfer
    function _allocateTicket(address _buyer, uint256 _chosenNumber, address _referrer, bool _prePaid) internal {
        require(!rounds[currentRoundId].isDrawn, "Round ended");
        
        // บันทึกผู้แนะนำ
        if (referrers[_buyer] == address(0) && _referrer != _buyer && _referrer != address(0)) {
            referrers[_buyer] = _referrer;
            referralCount[_referrer]++;
        }

        uint256 totalTax = (TICKET_PRICE * 20) / 100;
        uint256 prizePart = TICKET_PRICE - totalTax;

        address referrer = referrers[_buyer];
        uint256 devShare = totalTax;

        if (referrer != address(0)) {
            uint256 referralBonus = totalTax / 2;
            devShare = totalTax - referralBonus;

            usdtToken.transfer(referrer, referralBonus);
            referralEarnings[referrer] += referralBonus;
            referralEarningsByRound[currentRoundId][referrer] += referralBonus;
            emit ReferralReward(referrer, _buyer, referralBonus);
        }
        
        usdtToken.transfer(devWallet, devShare / 2);
        usdtToken.transfer(reserveWallet, devShare - (devShare/2));

        rounds[currentRoundId].prizePool += prizePart;
        
        tickets[currentRoundId][_chosenNumber].push(_buyer);
        userTickets[currentRoundId][_buyer].push(_chosenNumber);

        emit TicketBought(_buyer, currentRoundId, _chosenNumber);
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