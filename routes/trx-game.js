
const express = require("express");
const mysql = require("mysql2/promise");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const { getIO } = require("../utils/socket");
const {  updateGameplayTracking } = require("../utils/gameplay");
const pool = require("../config/pool"); // database connection


const app = express();



// ================== TRX Centralized Scheduler =================
const io = getIO();
const timersTrx = {
  "1min": 60 * 1000,
  "3min": 3 * 60 * 1000,
  "5min": 5 * 60 * 1000,
  "10min": 10 * 60 * 1000,
};

// Start Trx Game Timers
Object.entries(timersTrx).forEach(([timer, interval]) => {
  setInterval(() => {
    const now = Date.now();
    const elapsedInCycle = now % interval;
    const remainingTimeMs = interval - elapsedInCycle;

    // Emit timer updates for Trx game
    io.emit(`Trx-timerUpdate:${timer}`, {
      timer,
      remainingTimeMs,
    });

    if (remainingTimeMs <= 1000) {
      // Generate result when timer ends
      (async () => {
        try {
          console.log(`Trx ${timer} timer ending!`);

          const [rows] = await pool.query(
            "SELECT period_number FROM result_trx WHERE timer = ? ORDER BY period_number DESC LIMIT 1",
            [timer]
          );

          const lastPeriod = rows.length ? rows[0].period_number : 0;
          const nextPeriod = lastPeriod + 1;

          await axios.post(`${process.env.BASE_URL}/api/trx/generate-result-trx`, {
            periodNumber: nextPeriod,
            timer: timer,
          });

          console.log(`++ TRX Result generated [${timer}] Period: ${nextPeriod}`);
        } catch (err) {
          console.error(`Error in TRX scheduler for ${timer}:`, err.message);
        }
      })();
    }

  }, 1000); // Tick every 1s
});


// ==================   HELPER FUNCTIONS =================

const validateTRXBet = (betType, betValue) => {
  const validBetTypes = ['color', 'number', 'size'];
  
  if (!validBetTypes.includes(betType)) {
    return { valid: false, error: "Invalid bet type. Must be color, number, or size" };
  }

  switch (betType) {
    case 'color':
      if (!['green', 'red', 'violet'].includes(betValue)) {
        return { valid: false, error: "Invalid color. Must be green, red, or violet" };
      }
      break;
      
    case 'number':
      const num = parseInt(betValue);
      if (isNaN(num) || num < 0 || num > 9) {
        return { valid: false, error: "Invalid number. Must be 0-9" };
      }
      break;
      
    case 'size':
      if (!['big', 'small'].includes(betValue)) {
        return { valid: false, error: "Invalid size. Must be big or small" };
      }
      break;
  }

  return { valid: true };
};

const validateTRXTimer = (timer) => {
  return ["1min", "3min", "5min", "10min"].includes(timer);
};

const getTRXResultFromHash = (hashValue) => {
  const lastChar = hashValue.slice(-1).toLowerCase();
  const hexToNum = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    'a': 0, 'b': 1, 'c': 2, 'd': 3, 'e': 4, 'f': 5
  };
  
  return hexToNum[lastChar] !== undefined ? hexToNum[lastChar] : Math.floor(Math.random() * 10);
};

const getTRXColor = (number) => {
  if (number === 0) return 'red';
  if (number === 5) return 'green';
  if ([1, 3, 7, 9].includes(number)) return 'green';
  if ([2, 4, 6, 8].includes(number)) return 'red';
  return 'green';
};

const getTRXSize = (number) => {
  return [0, 1, 2, 3, 4].includes(number) ? 'small' : 'big';
};

const trxTimers = {
  "1min": 60 * 1000,
  "3min": 3 * 60 * 1000,
  "5min": 5 * 60 * 1000,
  "10min": 10 * 60 * 1000,
};



// ==================   WIN/LOSS LOGIC =================

const checkTRXWinner = (bet, result) => {
  const { bet_type, bet_value } = bet;
  const { number, color, size } = result;

  switch (bet_type) {
    case 'color':
      if (bet_value === 'violet') {
        return number === 0 || number === 5; // Violet wins on 0 or 5
      }
      return color === bet_value; // Green or Red
      
    case 'number':
      return parseInt(bet_value) === number;
      
    case 'size':
      return size === bet_value;
      
    default:
      return false;
  }
};

const calculateTRXWinnings = (bet, result) => {
  const { bet_type, bet_value, amount } = bet;
  const { number } = result;
  const netAmount = amount * 0.98; // 2% fee deduction

  switch (bet_type) {
    case 'color':
      if (bet_value === 'green') {
        return number === 5 ? netAmount * 1.5 : netAmount * 2; // Special case for 5
      } else if (bet_value === 'red') {
        return number === 0 ? netAmount * 1.5 : netAmount * 2; // Special case for 0
      } else if (bet_value === 'violet') {
        return netAmount * 4.5; // For 0 or 5
      }
      break;
      
    case 'number':
      return netAmount * 9; // Exact number match
      
    case 'size':
      return netAmount * 2; // Size bets
      
    default:
      return 0;
  }
  
  return 0;
};

// ==================  STRATEGIC RESULT GENERATION =================

const generateStrategicTRXResult = async (periodNumber, timer, pool) => {
  try {
    // Fetch all bets for analysis with new schema
    const [bets] = await pool.query(
      `SELECT bet_type, bet_value, SUM(amount) as total_amount 
       FROM bets_trx 
       WHERE period_number = ? AND timer = ? AND status = 'pending'
       GROUP BY bet_type, bet_value
       ORDER BY total_amount DESC`,
      [periodNumber, timer]
    );

    if (bets.length === 0) {
      const randomNumber = Math.floor(Math.random() * 10);
      return {
        number: randomNumber,
        color: getTRXColor(randomNumber),
        size: getTRXSize(randomNumber),
        hash: `fake${Math.random().toString(16).slice(2, 6)}${randomNumber.toString(16)}`
      };
    }

    // Analyze bet distribution with new schema
    const betAnalysis = {
      colors: { green: 0, red: 0, violet: 0 },
      numbers: Array(10).fill(0),
      sizes: { big: 0, small: 0 },
      total: 0
    };

    bets.forEach(bet => {
      const amount = parseFloat(bet.total_amount);
      betAnalysis.total += amount;
      
      switch (bet.bet_type) {
        case 'color':
          betAnalysis.colors[bet.bet_value] += amount;
          break;
        case 'number':
          betAnalysis.numbers[parseInt(bet.bet_value)] += amount;
          break;
        case 'size':
          betAnalysis.sizes[bet.bet_value] += amount;
          break;
      }
    });

    console.log(`\n=== Bet Analysis for Period ${periodNumber} (${timer}) ===`);
    console.log(`Colors: Green ₹${betAnalysis.colors.green}, Red ₹${betAnalysis.colors.red}, Violet ₹${betAnalysis.colors.violet}`);
    console.log(`Sizes: Big ₹${betAnalysis.sizes.big}, Small ₹${betAnalysis.sizes.small}`);
    console.log(`Numbers:`, betAnalysis.numbers.map((amt, num) => amt > 0 ? `${num}:₹${amt}` : null).filter(Boolean));

    // Calculate house profit for each possible number (0-9)
    const profitAnalysis = [];
    
    for (let number = 0; number <= 9; number++) {
      const testResult = {
        number: number,
        color: getTRXColor(number),
        size: getTRXSize(number)
      };

      let totalPayouts = 0;

      // Calculate total payouts if this number wins
      bets.forEach(bet => {
        const mockBet = {
          bet_type: bet.bet_type,
          bet_value: bet.bet_value,
          amount: parseFloat(bet.total_amount)
        };

        if (checkTRXWinner(mockBet, testResult)) {
          totalPayouts += calculateTRXWinnings(mockBet, testResult);
        }
      });

      const profit = betAnalysis.total - totalPayouts;
      const profitPercentage = (profit / betAnalysis.total) * 100;

      profitAnalysis.push({
        number: number,
        profit: profit,
        profitPercentage: profitPercentage,
        payouts: totalPayouts,
        color: testResult.color,
        size: testResult.size
      });
    }

    // Sort by highest house profit
    profitAnalysis.sort((a, b) => b.profit - a.profit);

    console.log(`\n=== House Profit Analysis ===`);
    profitAnalysis.forEach(analysis => {
      console.log(`Number ${analysis.number} (${analysis.color}/${analysis.size}): Profit ₹${analysis.profit.toFixed(2)} (${analysis.profitPercentage.toFixed(1)}%)`);
    });

    // Select from top 3 most profitable numbers
    const topProfitable = profitAnalysis.slice(0, 2);
    const selectedResult = topProfitable[Math.floor(Math.random() * topProfitable.length)];

    console.log(`\n Selected Result: Number ${selectedResult.number} with profit ₹${selectedResult.profit.toFixed(2)}`);

    return {
      number: selectedResult.number,
      color: selectedResult.color,
      size: selectedResult.size,
      hash: `strategic${Math.random().toString(16).slice(2, 6)}${selectedResult.number.toString(16)}`,
      expectedProfit: selectedResult.profit,
      totalBets: betAnalysis.total,
      expectedPayouts: selectedResult.payouts
    };

  } catch (error) {
    console.error('Error in strategic TRX generation:', error);
    const randomNumber = Math.floor(Math.random() * 10);
    return {
      number: randomNumber,
      color: getTRXColor(randomNumber),
      size: getTRXSize(randomNumber),
      hash: `fallback${Math.random().toString(16).slice(2, 6)}${randomNumber.toString(16)}`
    };
  }
};

// ================== 1.  PLACE BET API =================

app.post("/place-bet-trx", async (req, res) => {
  try {
    const { userId, betType, betValue, amount, periodNumber, timer } = req.body;

    // Validate required fields
    if (!userId || !betType || !betValue || !amount || !periodNumber || !timer) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: userId, betType, betValue, amount, periodNumber, timer" 
      });
    }

    // Validate timer
    if (!validateTRXTimer(timer)) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid timer. Must be 1min, 3min, 5min, or 10min" 
      });
    }

    // Validate bet 
    const validation = validateTRXBet(betType, betValue);
    if (!validation.valid) {
      return res.status(400).json({ 
        success: false, 
        error: validation.error 
      });
    }

    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid bet amount" 
      });
    }
    
        //  Check if user has ANY pending bet
        const [existingBet] = await pool.query(
  `SELECT id FROM bets_trx 
   WHERE user_id = ? AND status = 'pending'`,
  [userId]
          );

        if (existingBet.length > 0) {
  return res.status(400).json({
    success: false,
    error: "You already have a pending bet. Please wait until it is settled."
  });
        }


    // Check user wallet balance
    const [walletResult] = await pool.query(
      `SELECT balance FROM wallet w 
       JOIN users u ON u.id = w.UserId 
       WHERE w.UserId = ? AND w.cryptoname = 'INR'`,
      [userId]
    );

    if (walletResult.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "User wallet not found" 
      });
    }

    const userBalance = parseFloat(walletResult[0].balance);
    if (userBalance < amount) {
      return res.status(400).json({ 
        success: false, 
        error: "Insufficient balance" 
      });
    }

    // Check if period result already exists
    const [periodCheck] = await pool.query(
      `SELECT * FROM result_trx WHERE period_number = ? AND timer = ?`,
      [periodNumber, timer]
    );

    if (periodCheck.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Betting period has ended for this timer" 
      });
    }

    // Deduct amount from wallet
    await pool.query(
      `UPDATE wallet w
       JOIN users u ON u.id = w.UserId
       SET w.balance = w.balance - ?
       WHERE w.UserId = ? AND w.cryptoname = 'INR'`,
      [amount, userId]
    );

    // Insert bet with new schema
    await pool.query(
      `INSERT INTO bets_trx (user_id, bet_type, bet_value, amount, period_number, timer, status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [userId, betType, betValue, amount, periodNumber, timer]
    );

    // Update gameplay tracking
    await updateGameplayTracking(userId, amount);
    
    res.json({
      success: true,
      message: "TRXwingo bet placed successfully",
      bet: {
        userId,
        betType,
        betValue,
        amount,
        netAmount: amount * 0.98,
        periodNumber,
        timer
      }
    });

  } catch (error) {
    console.error("Error in place-bet-trxwingo:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error placing TRXwingo bet", 
      error: error.message 
    });
  }
});

// ================== 2. GENERATE RESULT API =================

app.post("/generate-result-trx", async (req, res) => {
  try {
    const { periodNumber, timer } = req.body;
    const io = getIO();

    // Validate input
    if (isNaN(periodNumber) || periodNumber < 1) {
      return res.status(400).json({ error: "Invalid period number." });
    }

    if (!validateTRXTimer(timer)) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid timer. Must be 1min, 3min, 5min, or 10min" 
      });
    }

    // Check if result already exists
    const [existingResult] = await pool.query(
      `SELECT * FROM result_trx WHERE period_number = ? AND timer = ?`,
      [periodNumber, timer]
    );

    if (existingResult.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Result already generated for this period and timer" 
      });
    }

    // Log all pending bets with new schema
    const [allBets] = await pool.query(
      `SELECT user_id, bet_type, bet_value, amount FROM bets_trx 
       WHERE period_number = ? AND timer = ? AND status = 'pending'`,
      [periodNumber, timer]
    );

    console.log(`\n=== TRX Period ${periodNumber} (${timer}) - Bet Summary ===`);
    allBets.forEach((bet, index) => {
      const betDisplay = bet.bet_type === 'color' ? bet.bet_value : 
                        bet.bet_type === 'number' ? `number ${bet.bet_value}` : 
                        `${bet.bet_value} size`;
      console.log(`Bet ${index + 1}: User ${bet.user_id} - ${betDisplay} - ₹${bet.amount}`);
    });

    // Generate strategic result
    const result = await generateStrategicTRXResult(periodNumber, timer, pool);

    console.log(`\n=== RESULT GENERATED ===`);
    console.log(`Number: ${result.number}, Color: ${result.color}, Size: ${result.size}`);
    if (result.expectedProfit !== undefined) {
      console.log(`Expected House Profit: ₹${result.expectedProfit.toFixed(2)}`);
    }

    // Save result to database
    await pool.query(
      `INSERT INTO result_trx (period_number, timer, result_number, result_color, result_size, hash_value, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [periodNumber, timer, result.number, result.color, result.size, result.hash]
    );

    // Fetch all bets for payout distribution
    const [bets] = await pool.query(
      `SELECT * FROM bets_trx WHERE period_number = ? AND timer = ? AND status = 'pending'`,
      [periodNumber, timer]
    );

    // Calculate payouts with detailed logging
    let totalPayouts = 0;
    let winnersCount = 0;
    let losersCount = 0;

    console.log(`\n=== PAYOUT CALCULATION ===`);

    for (const bet of bets) {
      const isWinner = checkTRXWinner(bet, result);
      const betDisplay = bet.bet_type === 'color' ? bet.bet_value : 
                        bet.bet_type === 'number' ? `number ${bet.bet_value}` : 
                        `${bet.bet_value} size`;

      if (isWinner) {
        const winnings = calculateTRXWinnings(bet, result);
        totalPayouts += winnings;
        winnersCount++;

        console.log(` WINNER: User ${bet.user_id} - ${betDisplay} - Bet: ₹${bet.amount} → Win: ₹${winnings.toFixed(2)}`);

        // Update user wallet
        await pool.query(
          `UPDATE wallet w
           JOIN users u ON u.id = w.UserId
           SET w.balance = w.balance + ?
           WHERE w.UserId = ? AND w.cryptoname = 'INR'`,
          [winnings, bet.user_id]
        );

        // Update bet status to won
        await pool.query(
          `UPDATE bets_trx SET status = 'won', winnings = ? WHERE id = ?`,
          [winnings, bet.id]
        );
      } else {
        losersCount++;
        console.log(` LOSER: User ${bet.user_id} - ${betDisplay} - Lost: ₹${bet.amount}`);
        
        // Update bet status to lost
        await pool.query(
          `UPDATE bets_trx SET status = 'lost' WHERE id = ?`,
          [bet.id]
        );
      }
    }

    const totalBetAmount = bets.reduce((sum, bet) => sum + parseFloat(bet.amount), 0);
    const houseProfit = totalBetAmount - totalPayouts;

    console.log(`\n=== FINAL SUMMARY ===`);
    console.log(`Total Bets: ₹${totalBetAmount.toFixed(2)}`);
    console.log(`Total Payouts: ₹${totalPayouts.toFixed(2)}`);
    console.log(`House Profit: ₹${houseProfit.toFixed(2)}`);
    console.log(`Winners: ${winnersCount}, Losers: ${losersCount}`);
    console.log(`==========================================\n`);

    // Prepare final result
    const finalResult = {
      success: true,
      period_number: periodNumber,
      timer: timer,
      result: {
        number: result.number,
        color: result.color,
        size: result.size,
        hash: result.hash,
        total_payouts: totalPayouts,
        winners_count: winnersCount,
        losers_count: losersCount,
        processed_bets: bets.length,
        house_profit: houseProfit,
        total_bet_amount: totalBetAmount
      }
    };

    // Emit socket events
    io.emit(`trx-result:${timer}:${periodNumber}`, finalResult);
    io.emit(`trx-resultUpdate:${timer}`, finalResult);

    res.json(finalResult);

  } catch (error) {
    console.error("Error in generate-result-trxwingo:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error generating TRXwingo result", 
      error: error.message 
    });
  }
});

//================= 3. GET latest result API ================

app.get("/latest-result-trx", async (req, res) => {
  const { timer, periodNumber } = req.query;
  try {
    const [results] = await pool.query(
      `SELECT * FROM result_trx 
       WHERE timer = ? AND period_number = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [timer, periodNumber]
    );

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: "No results found for this duration and period" });
    }

    res.json({ success: true, result: results[0] });
  } catch (error) {
    console.error("Error fetching latest result:", error);
    res.status(500).json({ success: false, message: "Error fetching latest result", error: error.message });
  }
});

// ================== 4. GET RESULT HISTORY API =================

app.get("/result-history-trx", async (req, res) => {
  try {
    const { timer, limit = 20, offset = 0 } = req.query;

    if (timer && !validateTRXTimer(timer)) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid timer. Must be 1min, 3min, 5min, or 10min" 
      });
    }

    let query = `SELECT period_number, timer, result_number, result_color, result_size, hash_value, created_at 
                 FROM result_trx`;
    let params = [];

    if (timer) {
      query += ` WHERE timer = ?`;
      params.push(timer);
    }

    query += ` ORDER BY period_number DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const [results] = await pool.query(query, params);

    res.json({
      success: true,
      timer: timer || 'all',
      results: results.map(r => ({
        period: r.period_number,
        timer: r.timer,
        number: r.result_number,
        color: r.result_color,
        size: r.result_size,
        hash: r.hash_value,
        time: r.created_at
      }))
    });

  } catch (error) {
    console.error("Error fetching TRXwingo history:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error fetching game history", 
      error: error.message 
    });
  }
});



app.post("/period-trx", async (req, res) => {
  const { mins } = req.body; // 'mins' means duration like '1min', '3min', etc.


  try {
    const [rows] = await pool.query(
      "SELECT period_number FROM result_trx WHERE timer = ? ORDER BY period_number DESC LIMIT 1",
      [mins]
    );

    let newPeriodNumber;

    if (rows.length > 0) {
      // Get the last period_number and increment it
      const lastPeriod = parseInt(rows[0].period_number);
      newPeriodNumber = lastPeriod + 1;
    } else {
      // If no previous period exists for this duration
      newPeriodNumber = 1;
    }

    res.json({ period_number: newPeriodNumber });
  } catch (error) {
    console.error(" MySQL/Server error:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});


//=================== user bet history API===================
app.get("/bet-history-trx", async (req, res) => {
  const { userId, timer } = req.query;

  try {
    const [bets] = await pool.query(
      `SELECT * FROM bets_trx 
       WHERE user_id = ? AND timer = ? 
       ORDER BY created_at DESC`,
      [userId, timer]
    );

    if (bets.length === 0) {
      return res.status(404).json({ success: false, message: "No bets found for this user and timer" });
    }

    res.json({ success: true, bets });
  } catch (error) {
    console.error("Error fetching bet history:", error);
    res.status(500).json({ success: false, message: "Error fetching bet history", error: error.message });
  }
});


//============================= trx-Game all bets of a user [Total win/loss] API =========================
app.get("/user-stats-trx", async (req, res) => {
  const { userId, timer } = req.query;

  if (!userId) {
    return res.status(400).json({ error: "User ID is required." });
  }

  try {
    let query = `SELECT * FROM bets_trx WHERE user_id = ?`;
    const params = [userId];

    if (timer) {
      query += ` AND timer = ?`;
      params.push(timer);
    }

    const [bets] = await pool.query(query, params);

    let totalWinAmount = 0;
    let totalLossAmount = 0;

    bets.forEach(bet => {
      if (bet.status === "won") {
        totalWinAmount += parseFloat(bet.winnings || 0);
      } else if (bet.status === "lost") {
        totalLossAmount += parseFloat(bet.amount || 0);
      }
    });

    res.json({
      totalBets: bets.length,
      totalWinAmount,
      totalLossAmount,
      bets
    });
  } catch (error) {
    console.error("Error fetching user stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



// ======== Get TRX Game Report for a specific period and timer ========
app.get("/report-trx", async (req, res) => {
  try {
    const { periodNumber, timer } = req.query;

    // Validate input
    if (!periodNumber || !timer) {
      return res.status(400).json({
        success: false,
        message: "Period number and timer are required"
      });
    }

    // Get result for this period
    const [resultRows] = await pool.query(
      `SELECT * FROM result_trx WHERE period_number = ? AND timer = ?`,
      [periodNumber, timer]
    );

    if (resultRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No result found for this period"
      });
    }

    const result = resultRows[0];

    // Get all bets for this period
    const [bets] = await pool.query(
      `SELECT 
        bet_type,
        bet_value,
        amount,
        user_id,
        COUNT(*) AS bet_count,
        SUM(amount) AS total_amount,
        COUNT(DISTINCT user_id) AS unique_users
       FROM bets_trx 
       WHERE period_number = ? AND timer = ?
       GROUP BY bet_type, bet_value, user_id`,
      [periodNumber, timer]
    );

    // Initialize stats
    const colorStats = {
      red: { total_bets: 0, total_amount: 0, unique_users: new Set() },
      green: { total_bets: 0, total_amount: 0, unique_users: new Set() },
      violet: { total_bets: 0, total_amount: 0, unique_users: new Set() }
    };

    const sizeStats = {
      small: { total_bets: 0, total_amount: 0, unique_users: new Set() },
      big: { total_bets: 0, total_amount: 0, unique_users: new Set() }
    };

    let totalBets = 0;
    let totalAmount = 0;
    const allUniqueUsers = new Set();

    // Process bets
    bets.forEach(bet => {
      totalBets += bet.bet_count;
      totalAmount += parseFloat(bet.total_amount);
      allUniqueUsers.add(bet.user_id);

      if (bet.bet_type === "color" && colorStats[bet.bet_value]) {
        colorStats[bet.bet_value].total_bets += bet.bet_count;
        colorStats[bet.bet_value].total_amount += parseFloat(bet.total_amount);
        colorStats[bet.bet_value].unique_users.add(bet.user_id);
      }

      if (bet.bet_type === "size" && sizeStats[bet.bet_value]) {
        sizeStats[bet.bet_value].total_bets += bet.bet_count;
        sizeStats[bet.bet_value].total_amount += parseFloat(bet.total_amount);
        sizeStats[bet.bet_value].unique_users.add(bet.user_id);
      }
    });

    // Convert Sets to counts
    Object.keys(colorStats).forEach(color => {
      colorStats[color].unique_users = colorStats[color].unique_users.size;
    });
    Object.keys(sizeStats).forEach(size => {
      sizeStats[size].unique_users = sizeStats[size].unique_users.size;
    });

    // Response
    res.json({
      success: true,
      period_number: periodNumber,
      timer,
      result: {
        number: result.result_number,
        color: result.result_color,
        size: result.result_size,
        hash: result.hash_value
      },
      color_bets: colorStats,
      size_bets: sizeStats,
      summary: {
        total_bets: totalBets,
        total_amount: totalAmount,
        total_unique_users: allUniqueUsers.size
      }
    });

  } catch (error) {
    console.error("Error fetching TRX betting stats:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching TRX betting statistics",
      error: error.message
    });
  }
});




module.exports = app;




/*


POST /place-bet-trxwingo
{
  "userId": 101,
  "betType": "color",      // "color", "number", or "size"
  "betValue": "green",     // "green"/"red"/"violet", "0"-"9", or "big"/"small"
  "amount": 50,
  "periodNumber": 1,
  "timer": "1min"
}

Examples:
- Color bet: { "betType": "color", "betValue": "green" }
- Number bet: { "betType": "number", "betValue": "7" }
- Size bet: { "betType": "size", "betValue": "big" }
*/