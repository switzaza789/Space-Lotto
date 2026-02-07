/* global BigInt */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';

// ⚙️ CONFIGURATION
// ⚙️ CONFIGURATION
// Default 'true' for GitHub Pages / Demo unless .env says 'false' explicitly
const USE_MOCK = process.env.REACT_APP_USE_MOCK !== 'false';
const CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS;
const USDT_ADDRESS = process.env.REACT_APP_USDT_ADDRESS;

// 📜 ABI
const LOTTO_ABI = [
  "function buyTickets(uint256[] _chosenNumbers, address _referrer) external",
  "function currentRoundId() external view returns (uint256)",
  "function getUserTickets(uint256 _roundId, address _user) external view returns (uint256[])",
  "function claimPrize(uint256 _roundId) external",
  "function rounds(uint256) external view returns (uint256 id, uint256 prizePool, uint256 winningNumber, bool isDrawn)",
  "function hasClaimed(uint256, address) external view returns (bool)",
  "function owner() view returns (address)",
  "function drawWinner(uint256 _winningNumber) external",
  "function referralEarnings(address) external view returns (uint256)",
  "function referralEarningsByRound(uint256, address) external view returns (uint256)",
  "function referralCount(address) external view returns (uint256)",
  "event WinnerDrawn(uint256 roundId, uint256 winningNumber, uint256 winnerCount, uint256 prizePerWinner)",
  "event TicketBought(address indexed player, uint256 roundId, uint256 chosenNumber)",
  "event PrizeClaimed(address indexed winner, uint256 amount)",
  "event ReferralReward(address indexed referrer, address indexed buyer, uint256 amount)"
];



const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

// --- 🔊 SOUND ENGINE ---
const useSound = () => {
  const audioCtxRef = useRef(null);

  const initAudio = () => {
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => { });
    }
  };

  const playTone = (freq, type, duration, vol = 0.1, forceInit = false) => {
    if (!audioCtxRef.current && !forceInit) return;
    if (!audioCtxRef.current || forceInit) initAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) { }
  };

  const playHover = () => playTone(800, 'sine', 0.05, 0.02, false);
  const playClick = () => playTone(1200, 'square', 0.1, 0.05, true);
  const playSuccess = () => {
    playTone(400, 'sine', 0.1, 0.1, true);
    setTimeout(() => playTone(800, 'sine', 0.2, 0.1, true), 100);
    setTimeout(() => playTone(1200, 'triangle', 0.4, 0.1, true), 300);
  };
  const playError = () => {
    playTone(150, 'sawtooth', 0.3, 0.1, true);
    setTimeout(() => playTone(100, 'sawtooth', 0.3, 0.1, true), 150);
  };
  return { playHover, playClick, playSuccess, playError };
};

// --- 🕸️ MOCK WEB3 ---
const mockBlockchain = {
  allowance: 0,
  balance: 5000,
  currentRoundId: 5, // 🆕 Track Round ID
  roundsData: {      // Store tickets per round
    5: [],
    6: []
  },
  approve: async () => {
    return new Promise(resolve => setTimeout(() => {
      mockBlockchain.allowance = 999999;
      resolve(true);
    }, 1500));
  },
  buyTicket: async (number) => {
    return new Promise((resolve, reject) => {
      if (mockBlockchain.allowance < 5) return reject(new Error("⚠️ Approval Required: Please approve USDT first."));
      setTimeout(() => {
        // Push to CURRENT ROUND ONLY
        if (!mockBlockchain.roundsData[mockBlockchain.currentRoundId]) {
          mockBlockchain.roundsData[mockBlockchain.currentRoundId] = [];
        }
        mockBlockchain.roundsData[mockBlockchain.currentRoundId].push(number);
        resolve({ hash: "0xMockHash123..." });
      }, 2000);
    });
  },
  getUserTickets: async () => {
    // Return ONLY tickets for the current round
    return mockBlockchain.roundsData[mockBlockchain.currentRoundId] || [];
  },
  // 🆕 Helper to start next round
  nextRound: () => {
    mockBlockchain.currentRoundId++;
    mockBlockchain.roundsData[mockBlockchain.currentRoundId] = []; // Reset for new round
  }
};

const App = () => {
  const { playHover, playClick, playSuccess, playError } = useSound();

  const [walletAddress, setWalletAddress] = useState("");
  const [currentPot, setCurrentPot] = useState(0);
  const [currentRoundDisplay, setCurrentRoundDisplay] = useState("-"); // UI Display
  const [ticketNumber, setTicketNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [isOwner, setIsOwner] = useState(false); // 👑 Admin State
  const [myTickets, setMyTickets] = useState([]);
  const [pastTickets, setPastTickets] = useState([]); // 📜 History State
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [activeTab, setActiveTab] = useState("active"); // 🆕 Tab State ("active", "history", "referral")
  const [sharedViewMode, setSharedViewMode] = useState(false); // 🆕 Is viewing someone else's ticket?
  const [sharedRound, setSharedRound] = useState(null); // 🆕 Round from shared link
  const [mockHasClaimed, setMockHasClaimed] = useState(false);
  const [showWinModal, setShowWinModal] = useState(false);

  const [winnerInfo, setWinnerInfo] = useState({ total: 0, count: 1, share: 0 });

  // 🏆 Unclaimed Prize State
  const [unclaimedPrize, setUnclaimedPrize] = useState(null); // { roundId, amount, winningNumber }

  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);

  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, mins: 0, secs: 0 });
  const [notification, setNotification] = useState({ show: false, title: "", message: "", type: "info" });

  // 🆕 History State
  const [history, setHistory] = useState([]);

  // 👥 Referral State
  const [refEarnings, setRefEarnings] = useState("0");
  const [refEarningsCurrentRound, setRefEarningsCurrentRound] = useState("0");
  const [refCount, setRefCount] = useState(0);

  // ⏰ Persistent Countdown Timer
  useEffect(() => {
    const ROUND_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds
    const STORAGE_KEY = "spacelotto_round_end";

    // Get or create target end time
    let targetTime = localStorage.getItem(STORAGE_KEY);
    if (!targetTime) {
      targetTime = Date.now() + ROUND_DURATION_MS;
      localStorage.setItem(STORAGE_KEY, targetTime.toString());
    } else {
      targetTime = parseInt(targetTime);
    }

    const calculateTimeLeft = () => {
      const diff = targetTime - Date.now();
      if (diff <= 0) {
        // Round ended - reset for new round
        const newTarget = Date.now() + ROUND_DURATION_MS;
        localStorage.setItem(STORAGE_KEY, newTarget.toString());
        return { days: 14, hours: 0, mins: 0, secs: 0 };
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);
      return { days, hours, mins, secs };
    };

    // Set initial value
    setTimeLeft(calculateTimeLeft());

    // Update every second
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // 🌐 Fetch Round & Pot on Page Load (No Wallet Required)
  useEffect(() => {
    const fetchPublicData = async () => {
      if (USE_MOCK) {
        setCurrentRoundDisplay(mockBlockchain.currentRoundId);
        return;
      }
      try {
        const readProvider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
        const lotto = new ethers.Contract(CONTRACT_ADDRESS, LOTTO_ABI, readProvider);
        const roundId = await lotto.currentRoundId();
        setCurrentRoundDisplay(roundId.toString());

        const roundData = await lotto.rounds(roundId);
        const poolEth = parseFloat(ethers.formatUnits(roundData.prizePool, 18));
        setCurrentPot(poolEth);

        // 🏆 Also Fetch Global Winners (Public Data)
        try {
          const filter = lotto.filters.WinnerDrawn();
          const events = await lotto.queryFilter(filter, 0, "latest");

          const globalHistory = events.map(e => {
            try {
              // Try to access args as array first (more reliable)
              const args = e.args;
              if (!args || args.length < 4) return null;

              return {
                round: args[0]?.toString() || "?",
                number: args[1]?.toString() || "????",
                winnerCount: Number(args[2] || 0),
                prize: args[3] ? parseFloat(ethers.formatUnits(args[3], 18)).toLocaleString() + " USDT" : "0 USDT"
              };
            } catch {
              return null; // Skip invalid events
            }
          }).filter(Boolean).reverse().slice(0, 10);

          if (globalHistory.length > 0) {
            setHistory(globalHistory);
          }
        } catch (evtErr) {
          // Silently ignore event errors to prevent spam
        }

      } catch (err) {
        // Only log once, not every interval
        if (!window._publicDataErrorLogged) {
          console.error("Public data fetch failed:", err.message);
          window._publicDataErrorLogged = true;
        }
      }
    };
    fetchPublicData();

    // Refresh every 10 seconds (reduced from 5 to prevent flicker)
    const publicInterval = setInterval(fetchPublicData, 10000);
    return () => clearInterval(publicInterval);
  }, []);

  // 🔗 READ SHARED TICKET FROM URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const sharedTicketNum = urlParams.get('ticket');
    const sharedRoundNum = urlParams.get('round');

    if (sharedTicketNum && sharedRoundNum) {
      setSelectedTicket(sharedTicketNum);
      setSharedRound(parseInt(sharedRoundNum));
      setSharedViewMode(true);
    }
  }, []);

  // 🕵️ AUTO-DETECT WINNER
  useEffect(() => {
    if (USE_MOCK && myTickets.includes('9999') && !mockHasClaimed) {
      const timer = setTimeout(() => {
        playSuccess();
        // Simulate 3 winners
        const simulatedTotalWinners = 3;
        const myShare = Math.floor(currentPot / simulatedTotalWinners);
        setWinnerInfo({ total: currentPot, count: simulatedTotalWinners, share: myShare });
        setShowWinModal(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [myTickets, mockHasClaimed, currentPot]);

  // 🔔 Stable Notification Function
  const showNotification = useCallback((title, message, type = 'info') => {
    if (type === 'success') playSuccess(); else if (type === 'error') playError(); else playClick();
    setNotification({ show: true, title, message, type });
  }, [playSuccess, playError, playClick]);

  // 🔗 Check Allowance (Stable) - MUST be before connectWallet
  const checkAllowance = useCallback(async (userAddr, currentSigner = null) => {
    if (USE_MOCK) {
      setIsApproved(mockBlockchain.allowance > 0);
    } else {
      if (!currentSigner) return;
      try {
        const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, currentSigner);
        const allow = await usdt.allowance(userAddr, CONTRACT_ADDRESS);
        setIsApproved(allow > ethers.parseUnits("5", 18));
      } catch (err) { console.error("Check allowance error:", err); }
    }
  }, []);

  // 🎫 Fetch Tickets (Stable) - MUST be before connectWallet
  const fetchMyTickets = useCallback(async (userAddr, currentSigner = null) => {
    if (USE_MOCK) {
      setCurrentRoundDisplay(mockBlockchain.currentRoundId);
      const tickets = await mockBlockchain.getUserTickets();
      setMyTickets([...tickets]);
    } else {
      if (!currentSigner) return;
      try {
        const lotto = new ethers.Contract(CONTRACT_ADDRESS, LOTTO_ABI, currentSigner);
        const currentRound = await lotto.currentRoundId();
        setCurrentRoundDisplay(currentRound.toString());
        const tickets = await lotto.getUserTickets(currentRound, userAddr);
        setMyTickets(tickets.map(t => t.toString()));

        // 👑 Check Owner
        const contractOwner = await lotto.owner();
        if (contractOwner.toLowerCase() === userAddr.toLowerCase()) {
          setIsOwner(true);
        } else {
          setIsOwner(false);
        }

        // 💰 Fetch Real Prize Pool
        const roundData = await lotto.rounds(currentRound);
        const poolWei = roundData.prizePool;
        const poolEth = parseFloat(ethers.formatUnits(poolWei, 18));
        setCurrentPot(poolEth);

        // 👥 Fetch Referral Stats
        try {
          const earned = await lotto.referralEarnings(userAddr);
          const earnedRound = await lotto.referralEarningsByRound(currentRound, userAddr);
          const count = await lotto.referralCount(userAddr);

          setRefEarnings(parseFloat(ethers.formatUnits(earned, 18)).toFixed(2));
          setRefEarningsCurrentRound(parseFloat(ethers.formatUnits(earnedRound, 18)).toFixed(2));
          setRefCount(Number(count));
        } catch (e) {
          console.warn("Referral stats fetch failed:", e);
        }

        // 📜 Fetch History (Last 20 Rounds)
        const historyData = [];
        for (let i = 1; i <= 20; i++) {
          if (currentRound - BigInt(i) < 1n) break;
          const rId = currentRound - BigInt(i);
          const rTickets = await lotto.getUserTickets(rId, userAddr);
          if (rTickets.length > 0) {
            const rInfo = await lotto.rounds(rId);
            historyData.push({
              round: rId.toString(),
              tickets: rTickets.map(t => t.toString()),
              winner: rInfo.winningNumber.toString(),
              isWinner: rTickets.some(t => t.toString() === rInfo.winningNumber.toString())
            });
          }
        }
        setPastTickets(historyData);

        // 🏆 CHECK FOR UNCLAIMED PRIZES
        for (let i = 1; i <= 5; i++) {
          const pastRoundId = currentRound - BigInt(i);
          if (pastRoundId < 1n) break;

          const pastRound = await lotto.rounds(pastRoundId);
          if (!pastRound.isDrawn) continue;

          const hasClaimed = await lotto.hasClaimed(pastRoundId, userAddr);
          if (hasClaimed) continue;

          const userTix = await lotto.getUserTickets(pastRoundId, userAddr);
          const winNum = pastRound.winningNumber.toString();
          const hasWinningTicket = userTix.some(t => t.toString() === winNum);

          if (hasWinningTicket) {
            // Found unclaimed prize!
            const filter = lotto.filters.WinnerDrawn();
            const events = await lotto.queryFilter(filter, 0, "latest");
            const matchEvent = events.find(e => e.args[0].toString() === pastRoundId.toString());

            let prizeAmount = 0;
            if (matchEvent && matchEvent.args[3]) {
              prizeAmount = parseFloat(ethers.formatUnits(matchEvent.args[3], 18));
            }

            setUnclaimedPrize({
              roundId: pastRoundId.toString(),
              amount: prizeAmount,
              winningNumber: winNum
            });
            setShowWinModal(true);
            break; // Show only first unclaimed
          }
        }

        // 🏆 Fetch Global History (Events from Genesis)
        try {
          const filter = lotto.filters.WinnerDrawn();
          const events = await lotto.queryFilter(filter, 0, "latest"); // From block 0 to latest

          const globalHistory = events.map(e => {
            const { roundId, winningNumber, winnerCount, prizePerWinner } = e.args;
            // Count can be BigInt, prize too
            const wCount = Number(winnerCount);
            // If winnerCount > 0, prize is prizePerWinner. Else pot rolls over (we show 0 or "Rollover")
            const prizeAmt = wCount > 0 ? parseFloat(ethers.formatUnits(prizePerWinner, 18)) : 0;

            return {
              round: roundId.toString(),
              number: winningNumber.toString(),
              winnerCount: wCount,
              prize: wCount > 0 ? prizeAmt.toLocaleString() + " USDT" : "No Winners"
            };
          }).reverse().slice(0, 10); // Take last 10

          setHistory(globalHistory);
        } catch (evtErr) {
          console.error("Event Query Failed:", evtErr);
          setHistory([]); // Fallback
        }

      } catch (err) { console.error("Fetch tickets error:", err); }
    }
  }, []);

  // 🔗 Connect Wallet (Stable) - Uses checkAllowance & fetchMyTickets
  const connectWallet = useCallback(async () => {
    playClick();
    if (USE_MOCK) {
      setTimeout(() => {
        setWalletAddress("0x71C...92F");
        showNotification("Connected (Mock)", "Wallet linked: 0x71C...92F", "success");
        checkAllowance("0x71C...92F");
        fetchMyTickets("0x71C...92F");
      }, 800);
    } else {
      if (!window.ethereum) return showNotification("Error", "MetaMask not found!", "error");
      try {
        // 🔄 FORCE NETWORK SWITCH LOCALHOST (Chain ID 31337)
        const chainId = "0x7A69"; // 31337 in hex
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainId }],
          });
        } catch (switchError) {
          // This error code indicates that the chain has not been added to MetaMask.
          if (switchError.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: chainId,
                  chainName: 'Localhost 8545',
                  rpcUrls: ['http://127.0.0.1:8545'],
                  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                },
              ],
            });
          }
        }

        const _provider = new ethers.BrowserProvider(window.ethereum);
        const _signer = await _provider.getSigner();
        const _address = await _signer.getAddress();
        setProvider(_provider);
        setSigner(_signer);
        setWalletAddress(_address);
        showNotification("Connected", `Wallet: ${_address.substring(0, 6)}...`, "success");
        checkAllowance(_address, _signer);
        fetchMyTickets(_address, _signer);
      } catch (err) {
        console.error(err);
        showNotification("Connection Failed", err.message, "error");
      }
    }
  }, [playClick, showNotification, checkAllowance, fetchMyTickets]);

  // 🛠️ DEV TOOL: Start New Round (Stable)
  const forceNextRound = useCallback(async () => {
    playClick();
    if (USE_MOCK) {
      mockBlockchain.nextRound();
      await fetchMyTickets();
      setMockHasClaimed(false);
      setShowWinModal(false);
      setCurrentPot(0);
      showNotification("⏳ New Round Started", `Welcome to Round #${mockBlockchain.currentRoundId}`, "info");
    }
  }, [playClick, fetchMyTickets, showNotification]);

  // 🎰 ADMIN: Draw Winner (Real Chain)
  const handleDrawWinner = useCallback(async () => {
    if (!ticketNumber || ticketNumber.length !== 4) return showNotification("System Error", "Enter 4 digit winning number first!", "error");
    setIsLoading(true);
    try {
      const lotto = new ethers.Contract(CONTRACT_ADDRESS, LOTTO_ABI, signer);
      const tx = await lotto.drawWinner(ticketNumber);
      showNotification("🎲 Drawing...", "Rolling the lucky number... Wait for confirm.", "info");
      await tx.wait();
      showNotification("🎉 WINNER DRAWN!", `Winning Number: ${ticketNumber} confirmed!`, "success");

      // Refresh Data (No Reload! Keep Wallet Connected) 🔄
      if (walletAddress) {
        // Wait a bit for indexing
        setTimeout(() => fetchMyTickets(walletAddress, signer), 2000);
      }
      setTicketNumber(""); // Clear Input

    } catch (err) {
      console.error(err);
      showNotification("Draw Failed", err.reason || err.message, "error");
    } finally {
      setIsLoading(false);
    }
  }, [ticketNumber, signer, showNotification, walletAddress, fetchMyTickets]);

  // ✅ Approve Handler (Stable)
  const handleApprove = useCallback(async () => {
    playClick();
    if (!walletAddress) {
      showNotification("Connect Wallet", "Connecting to your wallet...", "info");
      return connectWallet();
    }
    setIsLoading(true);
    try {
      if (USE_MOCK) {
        await mockBlockchain.approve();
        setIsApproved(true);
        showNotification("USDT Approved", "Mock USDT approved successfully.", "success");
      } else {
        const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, signer);
        const tx = await usdt.approve(CONTRACT_ADDRESS, ethers.MaxUint256);
        await tx.wait();
        setIsApproved(true);
        showNotification("Transaction Confirmed", "USDT Approved on Blockchain!", "success");
      }
    } catch (err) {
      showNotification("Approval Failed", err.message, "error");
    } finally {
      setIsLoading(false);
    }
  }, [playClick, signer, showNotification]);

  // 🏆 Claim Prize Handler (Stable)
  const handleClaim = useCallback(async () => {
    playClick();
    setIsLoading(true);
    try {
      if (USE_MOCK) {
        if (mockHasClaimed) throw new Error("Already claimed for this round!");

        const winningNumber = '9999';
        setTimeout(() => {
          if (myTickets.includes(winningNumber)) {
            setMockHasClaimed(true);
            setShowWinModal(false);

            // 🏆 UPDATE VICTORY BOARD
            const newWin = {
              round: currentRoundDisplay,
              number: winningNumber,
              winner: 'You (0x71C)',
              prize: `${winnerInfo.total.toLocaleString()} USDT`
            };
            setHistory(prev => [newWin, ...prev]);

            showNotification("🎉 JACKPOT!", `You received ${winnerInfo.share.toLocaleString()} USDT!`, "success");
          } else {
            showNotification("💔 No Luck", `No winning ticket found. (Winning Number: ${winningNumber})`, "error");
          }
          setIsLoading(false);
        }, 1000);
      } else {
        const lotto = new ethers.Contract(CONTRACT_ADDRESS, LOTTO_ABI, signer);
        const currentRound = await lotto.currentRoundId();
        const tx = await lotto.claimPrize(currentRound - BigInt(1));
        await tx.wait();
        showNotification("💰 Rich Alert!", "Prize claimed successfully!", "success");
        setIsLoading(false);
      }
    } catch (err) {
      // Extract clean error message (remove hex data)
      let cleanMsg = "No prize to claim or already claimed.";
      if (err.reason) {
        cleanMsg = err.reason;
      } else if (err.message) {
        // Try to extract text inside quotes like "No winners"
        const match = err.message.match(/"([^"]+)"/);
        cleanMsg = match ? match[1] : err.message.substring(0, 50);
      }
      showNotification("Claim Error", cleanMsg, "error");
      setIsLoading(false);
    }
  }, [playClick, mockHasClaimed, myTickets, currentRoundDisplay, winnerInfo, signer, showNotification]);

  // 🎫 Buy Tickets Handler (Bulk Support)
  const handleBuy = useCallback(async () => {
    playClick();
    if (!walletAddress) return showNotification("Access Denied", "Connect wallet first.", "error");

    // 🔄 Parse and Clean Input (Support "1111, 2222, 3333")
    const rawTickets = ticketNumber.split(/[, ]+/).filter(Boolean); // Split by comma or space
    const validTickets = rawTickets.filter(t => /^\d{4}$/.test(t));

    if (validTickets.length === 0) return showNotification("Invalid Input", "Enter 4-digit numbers (e.g. 1234, 5678)", "error");
    if (validTickets.length > 20) return showNotification("Limit Exceeded", "Max 20 tickets per transaction.", "error");



    // 🛡️ Auto-Remove Duplicates (1. ตัดซ้ำในชุดเดียวกัน)
    const uniqueInput = [...new Set(validTickets)];
    let hasRemovedSelf = uniqueInput.length < validTickets.length;

    // 🛡️ Filter Owned Tickets (2. ตัดซ้ำกับที่มีอยู่แล้ว)
    const finalTicketsToBuy = uniqueInput.filter(t => !myTickets.includes(t));
    let hasRemovedOwned = finalTicketsToBuy.length < uniqueInput.length;

    // ⚙️ Auto-Update Input & Notify if changes made
    if (hasRemovedSelf || hasRemovedOwned) {
      setTicketNumber(finalTicketsToBuy.join(", ")); // อัปเดตช่อง Input ทันที
      const removedCount = validTickets.length - finalTicketsToBuy.length;
      showNotification("Auto-Cleanup 🧹", `Removed ${removedCount} duplicate/owned tickets.`, "warning");

      // ถ้าตัดจนหมดเกลี้ยง ให้หยุดเลย
      if (finalTicketsToBuy.length === 0) {
        return showNotification("Nothing New", "All numbers are duplicates or already owned.", "info");
      }

      // หยุดเพื่อให้ user เห็นว่าตัดออกแล้ว (กดซื้ออีกรอบเพื่อยืนยัน) 
      // หรือจะให้ลุยต่อเลยก็ได้? ปกติ UX ที่ดีควรให้เห็นก่อน
      // แต่ถ้าเอาเร็ว "ตัดแล้วลุยต่อเลย" ก็ได้ครับ
      // ในที่นี้ผมขอเลือก "ลุยต่อเลย" เพื่อความสะดวกรวดเร็วตามโจทย์
    } else {
      // ถ้าไม่มีอะไรต้องตัด ก็เช็คว่าว่างเปล่าไหม
      if (finalTicketsToBuy.length === 0) return;
    }

    setIsLoading(true);
    const amountToPay = finalTicketsToBuy.length * 5; // 5 USDT per ticket

    try {
      if (USE_MOCK) {
        // Mock loop
        for (const t of finalTicketsToBuy) {
          await mockBlockchain.buyTicket(t);
        }
        await fetchMyTickets();
        setCurrentPot(prev => prev + (finalTicketsToBuy.length * 4));
        showNotification("Success", `Bought ${finalTicketsToBuy.length} tickets via Mock.`, "success");
      } else {
        const lotto = new ethers.Contract(CONTRACT_ADDRESS, LOTTO_ABI, signer);
        const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, signer);

        // Check Allowance for TOTAL Amount
        const allow = await usdt.allowance(walletAddress, CONTRACT_ADDRESS);
        const requiredAllowance = ethers.parseUnits(amountToPay.toString(), 18);

        if (allow < requiredAllowance) {
          throw new Error(`Allowance low. Need approval for ${amountToPay} USDT.`);
        }

        // 🔗 GET REFERRER
        const urlParams = new URLSearchParams(window.location.search);
        let referrer = urlParams.get('ref');
        if (!referrer || !ethers.isAddress(referrer) || referrer.toLowerCase() === walletAddress.toLowerCase()) {
          referrer = ethers.ZeroAddress;
        }

        // 🚀 BULK BUY TRANSACTION (ใช้ finalTicketsToBuy)
        const tx = await lotto.buyTickets(finalTicketsToBuy, referrer);
        showNotification("Transaction Sent", `Buying ${finalTicketsToBuy.length} tickets...`, "info");
        await tx.wait();

        await fetchMyTickets(walletAddress, signer);

        // ⚡ Optimistic Pot Update
        setCurrentPot(prev => prev + (finalTicketsToBuy.length * 4));

        showNotification("Mission Accomplished!", `${finalTicketsToBuy.length} Tickets Secured!`, "success");
      }
      setTicketNumber("");
    } catch (error) {
      console.error(error);
      const msg = error.message.includes("allowance") ? error.message : (error.reason || error.message);
      showNotification("Transaction Failed", msg, "error");
    } finally {
      setIsLoading(false);
    }
  }, [playClick, walletAddress, ticketNumber, myTickets, signer, fetchMyTickets, showNotification]);

  // 🔄 Auto-Refresh (Placed here to avoid ReferenceError)
  useEffect(() => {
    if (!walletAddress || USE_MOCK) return;
    const interval = setInterval(() => {
      fetchMyTickets(walletAddress, signer);
    }, 5000);
    return () => clearInterval(interval);
  }, [walletAddress, signer, fetchMyTickets]);

  return (
    <div className="min-h-screen bg-black text-white font-sans relative overflow-x-hidden selection:bg-pink-500 selection:text-white">

      {/* 🌌 Vibrant Background (Flying Objects) */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[#020205]"></div>
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
        <div className="absolute top-[-20%] left-[-10%] w-[70vw] h-[70vw] bg-purple-600/30 rounded-full blur-[120px] animate-nebula mix-blend-screen"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-cyan-600/30 rounded-full blur-[100px] animate-nebula delay-2000 mix-blend-screen"></div>

        {/* Flying Objects */}
        {(timeLeft.secs % 2 === 0) && ( // Optimization: Render less often or logic
          <div className="absolute top-0 left-0 animate-fly z-0 opacity-80 filter drop-shadow-[0_0_10px_rgba(255,100,0,0.5)]" aria-hidden="true">
            <div className="text-6xl md:text-8xl">🚀</div>
            <div className="absolute top-[50%] right-[100%] w-[150px] h-[4px] bg-gradient-to-l from-orange-500 to-transparent blur-sm rotate-45 origin-right"></div>
          </div>
        )}
        <div className="absolute top-[15%] left-[8%] md:left-[15%] animate-hover z-0" aria-hidden="true">
          <div className="text-4xl md:text-6xl drop-shadow-[0_0_20px_rgba(0,255,255,0.4)] opacity-90 -rotate-12">🛸</div>
        </div>

        {/* Stars */}
        <div className="absolute top-[10%] left-[15%] text-white/60 text-xs animate-twinkle delay-100" aria-hidden="true">✨</div>
        <div className="absolute bottom-[30%] left-[10%] text-white/70 text-sm animate-twinkle delay-2000" aria-hidden="true">✦</div>
      </div>

      {/* Navbar */}
      <nav className="relative z-50 flex justify-between items-center px-4 py-4 md:px-8 md:py-6">
        <div className="flex items-center gap-3 md:gap-4 group cursor-pointer">
          <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-gradient-to-br from-cyan-400/20 to-purple-500/20 border border-white/20 backdrop-blur-md flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.3)] group-hover:shadow-[0_0_25px_rgba(168,85,247,0.5)] transition-all">
            <span className="text-xl md:text-2xl group-hover:rotate-12 transition-transform">🪐</span>
          </div>
          <h1 className="text-lg md:text-2xl font-bold tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-white to-purple-300 drop-shadow-sm">Space Lotto</h1>
        </div>
        <div className="flex items-center gap-4">
          {/* 🛠️ DEV BUTTON: Start New Round */}
          {USE_MOCK && (
            <button onClick={forceNextRound} aria-label="Start next round" className="text-[10px] md:text-xs text-white/30 hover:text-white border border-white/10 px-2 py-1 rounded-lg uppercase tracking-widest transition-all focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none">
              ⏳ Next Round (Mock)
            </button>
          )}
          {/* 👑 ADMIN BUTTON */}
          {!USE_MOCK && isOwner && (
            <button onClick={handleDrawWinner} className="bg-purple-600 hover:bg-purple-500 text-white text-[10px] md:text-xs px-3 py-1 rounded-lg font-bold uppercase tracking-widest shadow-[0_0_15px_rgba(147,51,234,0.5)] animate-pulse">
              🎰 Draw {ticketNumber || "???"}
            </button>
          )}
          <button
            onMouseEnter={playHover} onClick={connectWallet}
            className={`px-4 py-2 md:px-6 md:py-3 rounded-xl md:rounded-2xl text-sm md:text-base font-bold transition-all duration-300 border backdrop-blur-md shadow-lg truncate max-w-[150px] md:max-w-none relative overflow-hidden group
                ${walletAddress ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20' : 'bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-cyan-400/50 hover:text-cyan-200'}`}
          >
            {walletAddress ? `Active: ${walletAddress.substring(0, 4)}...` : "Connect Wallet"}
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 container mx-auto px-4 py-6 md:py-12 max-w-7xl flex flex-col items-center">

        {/* Jackpot Header */}
        <div className="text-center mb-8 md:mb-16 relative group cursor-default w-full max-w-4xl" onMouseEnter={playHover}>
          <div className="relative bg-gradient-to-b from-white/10 to-purple-900/10 backdrop-blur-[50px] border border-white/20 p-6 md:p-12 rounded-[2rem] md:rounded-[3.5rem] shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] overflow-hidden transition-all hover:border-cyan-400/30 hover:shadow-[0_20px_70px_-10px_rgba(6,182,212,0.15)]">
            <div className="absolute top-[-50%] left-[20%] w-[60%] h-[100%] bg-cyan-500/10 blur-[80px] pointer-events-none"></div>

            {/* Round Badge */}
            <div className="inline-block bg-white/5 border border-white/10 px-4 py-1 rounded-full text-xs font-mono text-cyan-300 mb-4 shadow-inner">
              🔴 LIVE • Round #{currentRoundDisplay}
            </div>

            <h2 className="text-cyan-200 text-xs md:text-sm uppercase tracking-[0.2em] md:tracking-[0.4em] font-bold mb-2 md:mb-6 drop-shadow-lg">Current Prize Pool</h2>
            <div className="flex flex-col md:flex-row items-center justify-center md:gap-4 relative z-10">
              <span className="text-5xl md:text-8xl lg:text-9xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white via-cyan-100 to-blue-500 drop-shadow-[0_0_25px_rgba(6,182,212,0.3)] font-mono tracking-tighter">{currentPot.toLocaleString()}</span>
              <span className="text-2xl md:text-4xl text-purple-200 font-bold mt-2 md:mt-4 drop-shadow-md">USDT</span>
            </div>

            {/* Timer Pills */}
            <div className="flex justify-center gap-2 md:gap-3 mt-6 md:mt-10 overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
              {Object.entries(timeLeft).map(([k, v]) => (
                <div key={k} className="bg-black/30 border border-white/10 rounded-xl md:rounded-2xl p-2 md:p-4 min-w-[60px] md:min-w-[80px] backdrop-blur-md flex-shrink-0 relative overflow-hidden group-timer">
                  <div className="text-lg md:text-2xl font-mono font-bold text-white relative z-10">{String(v).padStart(2, '0')}</div>
                  <div className="text-[9px] md:text-[10px] text-cyan-300/60 uppercase tracking-widest mt-1 relative z-10">{k}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8 w-full">
          {/* Left Column */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-gradient-to-br from-white/5 to-white/0 backdrop-blur-3xl p-6 md:p-10 rounded-[2rem] md:rounded-[3rem] border border-white/10 shadow-2xl relative overflow-hidden group">
              <div className="flex justify-between items-center mb-6 md:mb-10">
                <div>
                  <h3 className="text-2xl md:text-3xl font-bold text-white mb-1 md:mb-2 text-shadow-glow">Buy Tickets</h3>
                  <p className="text-gray-400 font-light text-sm md:text-base">Input single number (1234) or multiple (1111, 2222)</p>
                </div>
                <div className="h-10 w-10 md:h-12 md:w-12 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-[0_0_20px_#06b6d4] animate-pulse-slow text-lg md:text-xl">⚡</div>
              </div>

              <div className="space-y-6 md:space-y-8">
                <input
                  type="text" placeholder="0000, 1111, 2222" value={ticketNumber} disabled={isLoading}
                  aria-label="Enter 4-digit ticket numbers separated by comma"
                  autoComplete="off"
                  onChange={(e) => {
                    playHover();
                    // 🪄 Auto-Format: เติม , ให้เองทุก 4 ตัวอักษร
                    const raw = e.target.value.replace(/\D/g, ''); // เอาเฉพาะตัวเลข
                    const formatted = raw.replace(/(\d{4})(?=\d)/g, '$1, '); // แทรก , ทุก 4 ตัว
                    setTicketNumber(formatted);
                  }}
                  className="w-full bg-black/40 border border-white/10 rounded-[1.5rem] md:rounded-[2rem] py-4 md:py-8 text-center text-2xl md:text-4xl font-mono tracking-widest focus:border-cyan-400 focus:bg-black/60 focus:shadow-[0_0_30px_rgba(6,182,212,0.2)] transition-colors outline-none text-white placeholder-white/5 focus-visible:ring-2 focus-visible:ring-cyan-400"
                />
                {!isApproved ? (
                  <button onClick={handleApprove} disabled={isLoading} aria-label="Approve USDT spending" className="w-full py-4 md:py-5 rounded-xl md:rounded-2xl font-bold text-base md:text-lg bg-gradient-to-r from-amber-400 to-orange-500 text-white hover:brightness-110 shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none">
                    {isLoading ? "Verifying…" : "🔐 Approve USDT"}
                  </button>
                ) : (
                  <div className="flex flex-col gap-3 md:gap-4">
                    <button onClick={handleBuy} disabled={isLoading} aria-label="Buy lottery ticket" className="w-full py-4 md:py-5 rounded-xl md:rounded-2xl font-bold text-base md:text-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:scale-[1.02] shadow-[0_0_30px_#06b6d4] text-white transition-transform focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none">
                      {isLoading ? "Processing…" : "🚀 LAUNCH TICKET"}
                    </button>
                    {walletAddress && <button onClick={handleClaim} aria-label="Check and claim rewards" className="w-full py-3 md:py-4 rounded-xl md:rounded-2xl font-semibold text-xs md:text-sm text-yellow-300/80 hover:text-yellow-300 hover:bg-yellow-500/10 border border-transparent hover:border-yellow-500/20 transition-colors focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:outline-none">💰 Check & Claim Rewards</button>}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Unified Ticket Manager */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-gradient-to-br from-white/5 to-white/0 backdrop-blur-3xl p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] border border-white/10 shadow-lg min-h-[500px] flex flex-col relative overflow-hidden">
              <div className="absolute top-0 right-0 w-[100px] h-[100px] bg-purple-500/10 blur-[50px]"></div>

              {/* TABS HEADER */}
              <div className="flex items-center gap-4 mb-6 pb-4 border-b border-white/5 relative z-10 overflow-x-auto scrollbar-hide">
                <button
                  onClick={() => { playClick(); setActiveTab("active"); }}
                  className={`text-lg md:text-xl font-bold transition-colors whitespace-nowrap ${activeTab === "active" ? 'text-white' : 'text-white/40 hover:text-white/70'}`}
                >
                  🛸 Active <span className="text-xs align-top opacity-50">{myTickets.length}</span>
                </button>
                <div className="w-[1px] h-6 bg-white/10 shrink-0"></div>
                <button
                  onClick={() => { playClick(); setActiveTab("history"); }}
                  className={`text-lg md:text-xl font-bold transition-colors whitespace-nowrap ${activeTab === "history" ? 'text-purple-300' : 'text-white/40 hover:text-purple-200'}`}
                >
                  📜 History
                </button>
                <div className="w-[1px] h-6 bg-white/10 shrink-0"></div>
                <button
                  onClick={() => { playClick(); setActiveTab("referral"); }}
                  className={`text-lg md:text-xl font-bold transition-colors whitespace-nowrap ${activeTab === "referral" ? 'text-emerald-300' : 'text-white/40 hover:text-emerald-200'}`}
                >
                  🤝 Referrals
                </button>
              </div>

              {/* TAB CONTENT: ACTIVE TICKETS */}
              {activeTab === "active" && (
                <>
                  {myTickets.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-white/20 animate-fade-in py-10">
                      <div className="text-4xl mb-4 opacity-50 grayscale">🎟️</div><p>No active tickets.</p>
                      <p className="text-xs mt-2 opacity-50">Buy tickets for Round #{currentRoundDisplay}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar relative z-10 animate-fade-in">
                      {myTickets.map((tik, idx) => (
                        <div
                          key={idx}
                          onClick={() => { playClick(); setSelectedTicket(tik); }}
                          className="relative group transition-transform hover:scale-[1.02] duration-300 cursor-pointer"
                        >
                          {/* Aura Glow */}
                          <div className="absolute -inset-0.5 bg-gradient-to-r from-yellow-400 to-amber-600 rounded-lg blur opacity-20 group-hover:opacity-60 transition duration-500"></div>

                          {/* Ticket Body */}
                          <div className="relative bg-gradient-to-br from-gray-900 to-black border border-amber-500/30 p-3 rounded-lg flex items-center justify-between overflow-hidden shadow-lg h-[90px]">
                            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
                            <div className="flex flex-col z-10 pl-2">
                              <span className="text-[9px] text-amber-400/80 uppercase tracking-widest font-bold">Golden Pass</span>
                              <span className="text-2xl font-mono font-bold text-transparent bg-clip-text bg-gradient-to-b from-yellow-100 via-amber-400 to-yellow-600 drop-shadow-sm tracking-[0.1em] mt-0.5">{tik}</span>
                            </div>
                            <div className="w-[1px] h-8 border-l border-dashed border-white/10 mx-2"></div>
                            <div className="flex flex-col items-center justify-center pr-2 opacity-70 scale-90">
                              <div className="w-12 h-6 flex gap-[2px] justify-center items-end opacity-60">
                                {[...Array(10)].map((_, i) => (<div key={i} className={`w-[2px] ${i % 2 === 0 ? 'h-full bg-amber-500' : 'h-2/3 bg-amber-500/50'}`}></div>))}
                              </div>
                              <span className="text-[7px] text-amber-500/60 mt-1 uppercase tracking-wider">Inspect</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* TAB CONTENT: HISTORY */}
              {activeTab === "history" && (
                <div className="animate-fade-in space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar pr-2">
                  {pastTickets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center pt-20 text-white/20">
                      <div className="text-4xl mb-4 opacity-50">📜</div><p>No history found.</p>
                    </div>
                  ) : (
                    pastTickets.map((round, idx) => (
                      <div key={idx} className="bg-black/40 rounded-xl p-4 border border-white/5 relative overflow-hidden group hover:border-purple-500/30 transition-colors">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-xs text-purple-300 font-bold uppercase tracking-wider bg-purple-500/10 px-2 py-1 rounded">Round #{round.round}</span>
                          {round.isWinner ?
                            <span className="text-[10px] bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full border border-green-500/30 flex items-center gap-1">WON 🎉</span> :
                            <span className="text-[10px] bg-white/5 text-gray-400 px-2 py-0.5 rounded-full border border-white/5">Missed</span>
                          }
                        </div>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {round.tickets.map((t, tIdx) => (
                            <span key={tIdx} className={`font-mono text-lg px-3 py-1 rounded-lg border ${t === round.winner ? 'bg-yellow-500/20 border-yellow-500 text-yellow-300 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'bg-white/5 border-white/10 text-white/70'}`}>
                              {t}
                            </span>
                          ))}
                        </div>
                        <div className="pt-2 border-t border-white/5 text-[10px] text-gray-500 flex items-center gap-2 justify-end">
                          <span className="uppercase tracking-widest opacity-70">Winning Number</span>
                          <span className="text-yellow-500 font-mono text-sm bg-yellow-500/10 px-2 rounded border border-yellow-500/20">{round.winner}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB CONTENT: REFERRALS */}
              {activeTab === "referral" && (
                <div className="animate-fade-in space-y-6 pt-4">
                  <div className="bg-gradient-to-br from-emerald-900/20 to-black/40 p-6 md:p-8 rounded-[2rem] border border-emerald-500/20 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-[150px] h-[150px] bg-emerald-500/20 blur-[80px] pointer-events-none"></div>

                    <div className="relative z-10 text-center mb-6">
                      <h3 className="text-2xl font-bold text-white mb-2">Invite Friends & Earn</h3>
                      <p className="text-emerald-200/60 text-sm">Create passive income by sharing your link. Earn 10% from every ticket bought using your link!</p>
                    </div>

                    <div className="bg-black/40 p-4 rounded-xl border border-white/10 flex flex-col md:flex-row items-center gap-3 mb-8 relative group">
                      <code className="text-xs md:text-sm text-emerald-300 font-mono truncate w-full text-center md:text-left bg-transparent outline-none">
                        {window.location.origin}?ref={walletAddress || "Connect Wallet"}
                      </code>
                      <button onClick={() => {
                        if (!walletAddress) return showNotification("Error", "Connect Wallet First", "error");
                        navigator.clipboard.writeText(`${window.location.origin}?ref=${walletAddress}`);
                        showNotification("Copied!", "Referral link copied!", "success");
                      }} className="w-full md:w-auto text-emerald-900 bg-emerald-400 hover:bg-emerald-300 font-bold text-xs uppercase px-4 py-2 rounded-lg transition-colors shadow-lg shadow-emerald-500/20">
                        Copy Link
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-black/30 p-4 rounded-2xl border border-white/5 flex flex-col items-center justify-center transform hover:scale-105 transition-transform duration-300">
                        <div className="text-3xl md:text-4xl font-black text-white mb-1 drop-shadow-lg">{refCount}</div>
                        <div className="text-[10px] md:text-xs text-gray-400 uppercase tracking-widest font-bold">Total Invites</div>
                      </div>
                      <div className="bg-gradient-to-b from-emerald-900/20 to-emerald-900/10 p-4 rounded-2xl border border-emerald-500/20 flex flex-col items-center justify-center transform hover:scale-105 transition-transform duration-300">
                        <div className="flex flex-col items-center">
                          <span className="text-3xl md:text-4xl font-black text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]">{refEarnings}</span>
                          <span className="text-[10px] md:text-[10px] text-emerald-200/60 uppercase tracking-widest font-bold">Total Earned</span>
                        </div>
                        <div className="w-full h-[1px] bg-emerald-500/20 my-2"></div>
                        <div className="flex flex-col items-center">
                          <span className="text-xl md:text-2xl font-bold text-emerald-300">{refEarningsCurrentRound}</span>
                          <span className="text-[9px] md:text-[10px] text-emerald-200/40 uppercase tracking-widest font-bold">This Round</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Recent Winners (Global) - KEEP AS IS */}
            <div className="bg-gradient-to-br from-white/5 to-white/0 backdrop-blur-3xl p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] border border-white/10 shadow-lg">
              <h3 className="text-base md:text-lg font-bold text-white mb-4">🏆 Global Winners</h3>
              <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                {history.length === 0 ? (
                  <p className="text-white/30 text-center py-4 text-sm">Waiting for first draw...</p>
                ) : (
                  history.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center p-3 bg-black/20 rounded-xl border border-white/5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-yellow-500/20 text-yellow-500 flex items-center justify-center font-bold text-xs shadow-lg">#{item.round}</div>
                        <div className="flex flex-col">
                          <span className="font-mono text-white text-base tracking-wider leading-none">{item.number}</span>
                          {item.winnerCount > 0 && <span className="text-[9px] text-green-400 mt-1 uppercase tracking-wide">{item.winnerCount} Winners</span>}
                          {item.winnerCount === 0 && <span className="text-[9px] text-red-400 mt-1 uppercase tracking-wide">No Winners 💀</span>}
                        </div>
                      </div>
                      <div className={`font-bold text-sm ${item.winnerCount === 0 ? 'text-gray-500 italic' : 'text-emerald-400'}`}>
                        {item.prize}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* --- 🎫 Ticket Inspection Modal (Giant Ticket) --- */}
      {selectedTicket && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in backdrop-blur-md bg-black/80" onClick={() => setSelectedTicket(null)}>

          <div className="relative transform transition-all scale-100 hover:scale-[1.02] duration-500" onClick={(e) => e.stopPropagation()}>

            {/* Glow Aura */}
            <div className="absolute -inset-4 bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-600 rounded-[2rem] blur-xl opacity-40 animate-pulse-slow"></div>

            {/* Giant Ticket Container */}
            <div className="relative w-[320px] md:w-[600px] h-[160px] md:h-[280px] bg-gradient-to-br from-[#1a1a1a] to-black border-2 border-amber-500/50 rounded-[2rem] flex overflow-hidden shadow-2xl">

              {/* Metallic Noise Texture */}
              <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-30 mix-blend-overlay"></div>

              {/* Shiny Reflection */}
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent pointer-events-none"></div>

              {/* Left Section: Main Info */}
              <div className="flex-1 p-6 md:p-10 flex flex-col justify-center relative z-10 border-r-2 border-dashed border-amber-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl md:text-3xl">🪐</span>
                  <span className="text-xs md:text-sm text-amber-400 uppercase tracking-[0.3em] font-bold">Space Lotto</span>
                  {sharedViewMode && (
                    <span className="ml-2 bg-purple-500/30 border border-purple-400/50 text-purple-200 text-[8px] md:text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider animate-pulse">👀 Shared</span>
                  )}
                </div>
                <h2 className="text-6xl md:text-8xl font-mono font-bold text-transparent bg-clip-text bg-gradient-to-b from-yellow-100 via-amber-400 to-yellow-700 drop-shadow-md tracking-wider">
                  {selectedTicket}
                </h2>
                <p className="text-amber-500/50 text-[10px] md:text-xs mt-4 uppercase tracking-wider">Round #{sharedViewMode ? sharedRound : currentRoundDisplay} • Verified on Chain</p>
              </div>

              {/* Right Section: Share Button */}
              <div className="w-[100px] md:w-[180px] flex flex-col items-center justify-center bg-black/20 p-4 relative z-10">
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const displayRound = sharedViewMode ? sharedRound : currentRoundDisplay;
                    const shareUrl = `${window.location.origin}${window.location.pathname}?ticket=${selectedTicket}&round=${displayRound}`;

                    // Robust Copy Logic
                    if (navigator.clipboard && window.isSecureContext) {
                      navigator.clipboard.writeText(shareUrl).then(() => {
                        showNotification("📋 Link Copied!", "Share this ticket with your friends!", "success");
                      }).catch((err) => {
                        console.error("Copy failed:", err);
                        showNotification("❌ Copy Failed", "Browser blocked copy. Try manually.", "error");
                      });
                    } else {
                      // Fallback for older browsers
                      const textArea = document.createElement("textarea");
                      textArea.value = shareUrl;
                      textArea.style.position = "fixed";
                      textArea.style.left = "-9999px";
                      document.body.appendChild(textArea);
                      textArea.focus();
                      textArea.select();
                      try {
                        document.execCommand('copy');
                        showNotification("📋 Link Copied!", "Share this ticket with your friends!", "success");
                      } catch (err) {
                        showNotification("❌ Copy Failed", "Please copy the URL manually.", "error");
                      }
                      document.body.removeChild(textArea);
                    }
                  }}
                  aria-label="Copy ticket link to clipboard"
                  className="relative z-20 w-16 h-16 md:w-24 md:h-24 bg-amber-500/10 hover:bg-amber-500/30 rounded-xl border border-amber-500/30 hover:border-amber-400 flex items-center justify-center mb-2 transition-all duration-300 group cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
                >
                  {/* Share Icon */}
                  <svg className="w-8 h-8 md:w-12 md:h-12 text-amber-400 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                </button>
                <span className="text-[8px] md:text-[10px] text-amber-400 uppercase font-bold tracking-wider">Copy Link</span>
              </div>

              {/* Giant Notches */}
              <div className="absolute -left-6 top-1/2 -translate-y-1/2 w-12 h-12 bg-black rounded-full shadow-inner ring-1 ring-amber-500/50"></div>
              <div className="absolute -right-6 top-1/2 -translate-y-1/2 w-12 h-12 bg-black rounded-full shadow-inner ring-1 ring-amber-500/50"></div>
            </div>

            {/* Close Button */}
            <button
              onClick={() => {
                setSelectedTicket(null);
                // Clear URL params if viewing shared ticket
                if (sharedViewMode) {
                  setSharedViewMode(false);
                  setSharedRound(null);
                  window.history.replaceState({}, '', window.location.pathname);
                }
              }}
              aria-label="Close ticket inspection"
              className="absolute -top-12 right-0 text-white/50 hover:text-white px-4 py-2 uppercase text-sm tracking-widest hover:bg-white/10 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              Close [ESC]
            </button>

          </div>
        </div>
      )}

      {/* --- 🏆 WINNER CELEBRATION MODAL --- */}
      {showWinModal && unclaimedPrize && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 animate-fade-in bg-black/90 backdrop-blur-xl">
          <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
            {/* Confetti Explosion */}
            {[[5, 12], [15, 8], [25, 45], [35, 22], [45, 67], [55, 33], [65, 78], [75, 15], [85, 55], [95, 42], [10, 88], [20, 72], [30, 95], [40, 5], [50, 38], [60, 82], [70, 28], [80, 62], [90, 18], [2, 50]].map(([top, left], i) => (
              <div key={i} className="absolute w-3 h-3 rounded-full animate-twinkle"
                style={{
                  top: `${top}%`, left: `${left}%`, animationDelay: `${i * 0.05}s`,
                  backgroundColor: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4'][i % 5]
                }}></div>
            ))}
          </div>

          <div className="relative z-10 bg-gradient-to-b from-gray-900 via-gray-900 to-black border-2 border-yellow-500/50 p-8 md:p-12 rounded-[3rem] shadow-[0_0_100px_rgba(234,179,8,0.4)] text-center max-w-lg w-full flex flex-col items-center">

            {/* Trophy */}
            <div className="text-7xl md:text-9xl mb-4 animate-bounce-slow drop-shadow-[0_0_30px_rgba(234,179,8,0.5)]">🏆</div>

            <h2 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-white to-yellow-300 drop-shadow-lg tracking-tight mb-2 uppercase">
              Congratulations!
            </h2>
            <p className="text-yellow-100/60 font-light text-lg mb-6 tracking-widest uppercase">You Hit The Jackpot!</p>

            {/* Prize Info Card */}
            <div className="bg-gradient-to-br from-yellow-500/10 to-amber-500/5 border border-yellow-500/30 rounded-2xl p-6 w-full mb-6 backdrop-blur-sm">

              {/* Round Info */}
              <div className="flex justify-between items-center mb-4 pb-4 border-b border-yellow-500/20">
                <span className="text-sm text-gray-400 uppercase tracking-wider">Round</span>
                <span className="text-xl font-bold text-yellow-400">#{unclaimedPrize.roundId}</span>
              </div>

              {/* Winning Number */}
              <div className="flex justify-between items-center mb-4 pb-4 border-b border-yellow-500/20">
                <span className="text-sm text-gray-400 uppercase tracking-wider">Winning Number</span>
                <span className="text-2xl font-mono font-black text-white tracking-[0.2em]">{unclaimedPrize.winningNumber}</span>
              </div>

              {/* Your Prize */}
              <div className="flex justify-between items-end pt-2">
                <span className="text-sm text-yellow-200 font-bold uppercase">Your Prize</span>
                <div className="text-right">
                  <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-amber-400">
                    {unclaimedPrize.amount.toLocaleString()}
                  </span>
                  <span className="text-lg text-yellow-500/60 ml-2">USDT</span>
                </div>
              </div>
            </div>

            {/* CLAIM BUTTON */}
            <button
              onClick={async () => {
                setIsLoading(true);
                try {
                  const lotto = new ethers.Contract(CONTRACT_ADDRESS, LOTTO_ABI, signer);
                  const tx = await lotto.claimPrize(BigInt(unclaimedPrize.roundId));
                  await tx.wait();
                  showNotification("💰 Prize Claimed!", `You received ${unclaimedPrize.amount.toLocaleString()} USDT!`, "success");
                  setShowWinModal(false);
                  setUnclaimedPrize(null);
                  // Refresh data
                  if (walletAddress) fetchMyTickets(walletAddress, signer);
                } catch (err) {
                  const match = err.message?.match(/"([^"]+)"/);
                  showNotification("Claim Failed", match ? match[1] : err.reason || "Transaction failed", "error");
                } finally {
                  setIsLoading(false);
                }
              }}
              disabled={isLoading}
              aria-label="Claim your prize"
              className="w-full py-5 rounded-2xl bg-gradient-to-r from-yellow-400 via-yellow-500 to-amber-500 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_50px_rgba(234,179,8,0.5)] text-black font-black text-2xl tracking-wider uppercase focus-visible:ring-4 focus-visible:ring-yellow-300 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Processing..." : "🎁 CLAIM NOW"}
            </button>

            <button
              onClick={() => { setShowWinModal(false); setUnclaimedPrize(null); }}
              aria-label="Close winner modal"
              className="mt-6 text-sm text-white/40 hover:text-white uppercase tracking-widest focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:outline-none rounded-lg px-4 py-2 hover:bg-white/5 transition-colors"
            >
              Claim Later
            </button>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {notification.show && (
        <div className="fixed bottom-10 right-10 z-[9999] animate-fade-in-up" role="alert" aria-live="polite">
          <div className={`p-4 md:p-6 rounded-2xl shadow-2xl backdrop-blur-xl border border-white/10 flex items-start gap-3 md:gap-4 max-w-[300px] md:max-w-sm
             ${notification.type === 'success' ? 'bg-emerald-900/90 text-emerald-100' :
              notification.type === 'info' ? 'bg-blue-900/90 text-blue-100 border-blue-500/30' :
                'bg-rose-900/90 text-rose-100 border-rose-500/30'}`}>
            <div className="text-2xl mt-1 shrink-0" aria-hidden="true">
              {notification.type === 'success' ? '🎉' : notification.type === 'info' ? 'ℹ️' : '⚠️'}
            </div>
            <div className="flex-1 overflow-hidden">
              <h4 className="font-bold text-sm md:text-base mb-1">{notification.title}</h4>
              <p className="text-xs md:text-sm opacity-90 break-words leading-relaxed max-h-[100px] overflow-y-auto custom-scrollbar">
                {notification.message.includes("user rejected") || notification.message.includes("User denied")
                  ? "Transaction cancelled by user."
                  : notification.message.length > 150 ? notification.message.substring(0, 150) + "..." : notification.message}
              </p>
            </div>
            <button
              onClick={() => setNotification({ ...notification, show: false })}
              aria-label="Dismiss notification"
              className="absolute top-2 right-2 text-white/40 hover:text-white hover:bg-white/10 rounded-full w-6 h-6 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 🛡️ SYSTEM STATUS INDICATOR */}
      <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
        {USE_MOCK ? (
          <div className="bg-yellow-500/20 border border-yellow-500/50 text-yellow-200 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-[0_0_10px_rgba(234,179,8,0.2)] backdrop-blur-sm">
            🛠️ MOCK MODE
          </div>
        ) : (
          <div className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-200 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-[0_0_10px_rgba(16,185,129,0.2)] backdrop-blur-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            LIVE CHAIN
          </div>
        )}
      </div>
    </div>
  );
};

export default App;