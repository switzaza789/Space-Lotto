/* global BigInt */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';

// ⚙️ CONFIGURATION
const USE_MOCK = true;
const CONTRACT_ADDRESS = "0xYourSpaceLottoAddress";
const USDT_ADDRESS = "0xYourUsdtAddress";

// 📜 ABI
const LOTTO_ABI = [
  "function buyTicket(uint256 _chosenNumber) external",
  "function currentRoundId() external view returns (uint256)",
  "function getUserTickets(uint256 _roundId, address _user) external view returns (uint256[])",
  "function claimPrize(uint256 _roundId) external",
  "function rounds(uint256) external view returns (uint256 id, uint256 endTime, uint256 prizePool, uint256 winningNumber, bool isDrawn, bool hasWinner)"
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
  const [currentPot, setCurrentPot] = useState(15420);
  const [currentRoundDisplay, setCurrentRoundDisplay] = useState(5); // UI Display
  const [ticketNumber, setTicketNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [myTickets, setMyTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [sharedViewMode, setSharedViewMode] = useState(false); // 🆕 Is viewing someone else's ticket?
  const [sharedRound, setSharedRound] = useState(null); // 🆕 Round from shared link
  const [mockHasClaimed, setMockHasClaimed] = useState(false);
  const [showWinModal, setShowWinModal] = useState(false);

  const [winnerInfo, setWinnerInfo] = useState({ total: 0, count: 1, share: 0 });

  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);

  const [timeLeft, setTimeLeft] = useState({ days: 14, hours: 2, mins: 45, secs: 12 });
  const [notification, setNotification] = useState({ show: false, title: "", message: "", type: "info" });

  // 🆕 History State (Mutable)
  const [history, setHistory] = useState([
    { round: 4, number: '4589', winner: '0x12...89A', prize: '12,000 USDT' },
    { round: 3, number: '1102', winner: 'Rollover', prize: '8,500 USDT' },
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev.secs > 0) return { ...prev, secs: prev.secs - 1 };
        if (prev.mins > 0) return { ...prev, mins: prev.mins - 1, secs: 59 };
        if (prev.hours > 0) return { ...prev, hours: prev.hours - 1, mins: 59, secs: 59 };
        if (prev.days > 0) return { ...prev, days: prev.days - 1, hours: 23, mins: 59, secs: 59 };
        return prev;
      });
    }, 1000);
    return () => clearInterval(timer);
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

  // ✅ Approve Handler (Stable)
  const handleApprove = useCallback(async () => {
    playClick();
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
      showNotification("Claim Error", err.message || "No prize to claim or already claimed.", "error");
      setIsLoading(false);
    }
  }, [playClick, mockHasClaimed, myTickets, currentRoundDisplay, winnerInfo, signer, showNotification]);

  // 🎫 Buy Ticket Handler (Stable)
  const handleBuy = useCallback(async () => {
    playClick();
    if (!walletAddress) return showNotification("Access Denied", "Connect wallet first.", "error");
    if (ticketNumber.length !== 4) return showNotification("Invalid Input", "Enter 4 digits.", "error");

    setIsLoading(true);
    try {
      if (USE_MOCK) {
        await mockBlockchain.buyTicket(ticketNumber);
        await fetchMyTickets();
        setCurrentPot(prev => prev + 4);
        showNotification("Success", "Ticket bought via Mock.", "success");
      } else {
        const lotto = new ethers.Contract(CONTRACT_ADDRESS, LOTTO_ABI, signer);
        const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, signer);
        const allow = await usdt.allowance(walletAddress, CONTRACT_ADDRESS);
        if (allow < ethers.parseUnits("5", 18)) {
          throw new Error("Allowance not enough. Please Approve again.");
        }
        const tx = await lotto.buyTicket(ticketNumber);
        showNotification("Transaction Sent", "Waiting for confirmation...", "info");
        await tx.wait();
        await fetchMyTickets(walletAddress, signer);
        showNotification("Mission Accomplished!", `Ticket #${ticketNumber} secured on Chain!`, "success");
      }
      setTicketNumber("");
    } catch (error) {
      console.error(error);
      showNotification("Transaction Failed", error.message || error.reason, "error");
    } finally {
      setIsLoading(false);
    }
  }, [playClick, walletAddress, ticketNumber, signer, fetchMyTickets, showNotification]);

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
              ⏳ Next Round
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
                  <h3 className="text-2xl md:text-3xl font-bold text-white mb-1 md:mb-2 text-shadow-glow">Buy Ticket</h3>
                  <p className="text-gray-400 font-light text-sm md:text-base">Input your lucky coordinates</p>
                </div>
                <div className="h-10 w-10 md:h-12 md:w-12 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-[0_0_20px_#06b6d4] animate-pulse-slow text-lg md:text-xl">⚡</div>
              </div>

              <div className="space-y-6 md:space-y-8">
                <input
                  type="text" maxLength="4" placeholder="0000" value={ticketNumber} disabled={isLoading}
                  aria-label="Enter 4-digit ticket number"
                  autoComplete="off"
                  onChange={(e) => { playHover(); setTicketNumber(e.target.value.replace(/\D/, '')); }}
                  className="w-full bg-black/40 border border-white/10 rounded-[1.5rem] md:rounded-[2rem] py-4 md:py-8 text-center text-4xl md:text-6xl font-mono tracking-[0.3em] md:tracking-[0.5em] focus:border-cyan-400 focus:bg-black/60 focus:shadow-[0_0_30px_rgba(6,182,212,0.2)] transition-colors outline-none text-white placeholder-white/5 focus-visible:ring-2 focus-visible:ring-cyan-400"
                />
                {!isApproved ? (
                  <button onClick={handleApprove} disabled={isLoading || !walletAddress} aria-label="Approve USDT spending" className="w-full py-4 md:py-5 rounded-xl md:rounded-2xl font-bold text-base md:text-lg bg-gradient-to-r from-amber-400 to-orange-500 text-white hover:brightness-110 shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none">
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

          {/* Right Column: Golden Ticket Gallery (Interactive) */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-gradient-to-br from-white/5 to-white/0 backdrop-blur-3xl p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] border border-white/10 shadow-lg min-h-[400px] flex flex-col relative overflow-hidden">
              <div className="absolute top-0 right-0 w-[100px] h-[100px] bg-purple-500/10 blur-[50px]"></div>

              <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/5 relative z-10">
                <h3 className="text-lg md:text-xl font-bold text-white flex gap-2">🛸 My Tickets</h3>
                <span className="bg-amber-500/20 border border-amber-500/30 px-3 py-1 rounded-full text-[10px] md:text-xs text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.2)]">{myTickets.length} Tickets</span>
              </div>

              {myTickets.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-white/20">
                  <div className="text-4xl mb-4 opacity-50 grayscale">🎟️</div><p>No tickets yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar relative z-10">
                  {myTickets.map((tik, idx) => (
                    // 🎫 GOLDEN TICKET CARD (Compact)
                    <div
                      key={idx}
                      onClick={() => { playClick(); setSelectedTicket(tik); }} // 👈 Click Handler
                      className="relative group transition-transform hover:scale-[1.02] duration-300 cursor-pointer"
                    >
                      {/* Aura Glow */}
                      <div className="absolute -inset-0.5 bg-gradient-to-r from-yellow-400 to-amber-600 rounded-lg blur opacity-20 group-hover:opacity-60 transition duration-500"></div>

                      {/* Ticket Body */}
                      <div className="relative bg-gradient-to-br from-gray-900 to-black border border-amber-500/30 p-3 rounded-lg flex items-center justify-between overflow-hidden shadow-lg h-[90px]">

                        {/* Metallic Texture */}
                        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>

                        {/* Left Side: Logo & Info */}
                        <div className="flex flex-col z-10 pl-2">
                          <span className="text-[9px] text-amber-400/80 uppercase tracking-widest font-bold">Golden Pass</span>
                          <span className="text-2xl font-mono font-bold text-transparent bg-clip-text bg-gradient-to-b from-yellow-100 via-amber-400 to-yellow-600 drop-shadow-sm tracking-[0.1em] mt-0.5">
                            {tik}
                          </span>
                        </div>

                        {/* Divider Line */}
                        <div className="w-[1px] h-8 border-l border-dashed border-white/10 mx-2"></div>

                        {/* Right Side: Barcode */}
                        <div className="flex flex-col items-center justify-center pr-2 opacity-70 scale-90">
                          <div className="w-12 h-6 flex gap-[2px] justify-center items-end opacity-60">
                            {[...Array(10)].map((_, i) => (
                              <div key={i} className={`w-[2px] ${i % 2 === 0 ? 'h-full bg-amber-500' : 'h-2/3 bg-amber-500/50'}`}></div>
                            ))}
                          </div>
                          <span className="text-[7px] text-amber-500/60 mt-1 uppercase tracking-wider">Inspect</span>
                        </div>

                        {/* Side Notches */}
                        <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-[#0E0E14] rounded-full shadow-inner border-r border-amber-500/30"></div>
                        <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-[#0E0E14] rounded-full shadow-inner border-l border-amber-500/30"></div>

                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Winners */}
            <div className="bg-gradient-to-br from-white/5 to-white/0 backdrop-blur-3xl p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] border border-white/10 shadow-lg">
              <h3 className="text-base md:text-lg font-bold text-white mb-4">🏆 Recent Victories</h3>
              <div className="space-y-3">
                {history.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center p-3 bg-black/20 rounded-xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-yellow-500/20 text-yellow-500 flex items-center justify-center font-bold text-xs shadow-lg">#{item.round}</div>
                      <div className="font-mono text-white text-base tracking-wider">{item.number}</div>
                    </div>
                    <div className="font-bold text-sm text-emerald-400">{item.prize}</div>
                  </div>
                ))}
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

      {/* --- 🏆 WINNER MODAL (Auto-Triggered) --- */}
      {showWinModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 animate-fade-in bg-black/90 backdrop-blur-xl">
          <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
            {/* Confetti Explosion - Static positions to avoid hydration mismatch */}
            {[[5, 12], [15, 8], [25, 45], [35, 22], [45, 67], [55, 33], [65, 78], [75, 15], [85, 55], [95, 42], [10, 88], [20, 72], [30, 95], [40, 5], [50, 38], [60, 82], [70, 28], [80, 62], [90, 18], [2, 50]].map(([top, left], i) => (
              <div key={i} className="absolute w-2 h-2 bg-yellow-500 rounded-full animate-twinkle" style={{ top: `${top}%`, left: `${left}%`, animationDelay: `${i * 0.05}s` }}></div>
            ))}
          </div>

          <div className="relative z-10 bg-gradient-to-b from-gray-900 via-gray-900 to-black border border-yellow-500/50 p-8 md:p-12 rounded-[3rem] shadow-[0_0_100px_rgba(234,179,8,0.3)] text-center max-w-lg w-full flex flex-col items-center">

            <div className="text-6xl md:text-8xl mb-4 animate-bounce-slow">🎉</div>

            <h2 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-white to-yellow-300 drop-shadow-lg tracking-tight mb-2 uppercase">You Won!</h2>
            <p className="text-yellow-100/60 font-light text-lg mb-8 tracking-widest uppercase">Big Winner Detected</p>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 w-full mb-8 backdrop-blur-sm">

              {/* 1. Total Prize Pool */}
              <div className="flex justify-between items-end mb-2">
                <span className="text-sm text-gray-400">Total Prize Pool</span>
                <span className="text-xl font-mono text-yellow-400/80 tracking-widest">{winnerInfo.total.toLocaleString()} USDT</span>
              </div>

              <div className="w-full h-px bg-white/10 my-3"></div>

              {winnerInfo.count > 1 ? (
                // 2. Multiple Winners Case
                <>
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-sm text-gray-400">Total Winners</span>
                    <span className="text-lg text-white font-bold">{winnerInfo.count} @ {winnerInfo.share.toLocaleString()} USDT</span>
                  </div>
                  <div className="flex justify-between items-end mt-4 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                    <span className="text-sm text-yellow-200 font-bold uppercase">Your Share</span>
                    <span className="text-3xl font-black text-yellow-400">{winnerInfo.share.toLocaleString()} <span className="text-sm font-normal text-yellow-500/60">USDT</span></span>
                  </div>
                </>
              ) : (
                // 3. Single Winner Case
                <div className="flex justify-between items-end">
                  <span className="text-sm text-gray-400">Your Prize</span>
                  <span className="text-3xl font-bold text-white">{winnerInfo.total.toLocaleString()} <span className="text-sm text-gray-400">USDT</span></span>
                </div>
              )}
            </div>

            <button
              onClick={handleClaim}
              aria-label="Claim your prize"
              className="w-full py-4 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-600 hover:scale-105 transition-transform shadow-[0_0_40px_rgba(234,179,8,0.5)] text-black font-black text-xl tracking-widest uppercase focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              CLAIM PRIZE 💰
            </button>

            <button onClick={() => setShowWinModal(false)} aria-label="Close winner modal" className="mt-6 text-xs text-white/30 hover:text-white uppercase tracking-widest focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:outline-none rounded-lg px-2 py-1">Close</button>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {notification.show && (
        <div className="fixed bottom-10 right-10 z-[9999] animate-fade-in-up" role="alert" aria-live="polite">
          <div className={`p-6 rounded-2xl shadow-2xl backdrop-blur-xl border border-white/10 flex items-center gap-4 max-w-sm
             ${notification.type === 'success' ? 'bg-emerald-900/80 text-emerald-100' : 'bg-red-900/80 text-red-100'}`}>
            <div className="text-2xl" aria-hidden="true">{notification.type === 'success' ? '🎉' : '⚠️'}</div>
            <div>
              <h4 className="font-bold">{notification.title}</h4>
              <p className="text-sm opacity-80">{notification.message}</p>
            </div>
            <button onClick={() => setNotification({ ...notification, show: false })} aria-label="Dismiss notification" className="ml-auto text-xs opacity-50 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">✕</button>
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