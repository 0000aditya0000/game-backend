const express = require("express");
const mysql = require("mysql2/promise");
const bodyParser = require("body-parser");
const cors = require("cors");
const { getIO } = require("../utils/socket");


const app = express();
app.use(bodyParser.json());
app.use(cors());

// Database pool
const pool = mysql.createPool({
  host: "localhost",
  user: "root", // Replace with your MySQL username
  password: "", // Replace with your MySQL password
  database: "stake",
});


// ================== Helper Functions =================
const validate5DBet = (position, betType, betValue) => {
  // Valid positions: A, B, C, D, E, SUM
  if (!['A', 'B', 'C', 'D', 'E', 'SUM'].includes(position)) {
    return { valid: false, error: "Invalid position. Must be A, B, C, D, E, or SUM" };
  }

  if (position === 'SUM') {
    // Sum bet validation
    const validSumTypes = ['low', 'high', 'odd', 'even'];
    if (!validSumTypes.includes(betType)) {
      return { valid: false, error: "Invalid sum bet type. Must be low, high, odd, or even" };
    }
    return { valid: true };
  } else {
    // Position bet validation (A, B, C, D, E)
    if (betType === 'number') {
      const num = parseInt(betValue);
      if (isNaN(num) || num < 0 || num > 9) {
        return { valid: false, error: "Invalid number. Must be 0-9" };
      }
    } else if (betType === 'low') {
      // Low (0,1,2,3,4) - no specific value needed
    } else if (betType === 'high') {
      // High (5,6,7,8,9) - no specific value needed
    } else if (betType === 'odd') {
      // Odd (1,3,5,7,9) - no specific value needed
    } else if (betType === 'even') {
      // Even (0,2,4,6,8) - no specific value needed
    } else {
      return { valid: false, error: "Invalid bet type. Must be number, low, high, odd, or even" };
    }
    return { valid: true };
  }
};

const validateTimer = (timer) => {
  return ["1min", "3min", "5min", "10min"].includes(timer);
};

const calculate5DResult = (drawNumber) => {
  const digits = drawNumber.toString().padStart(5, '0').split('').map(Number);
  const [A, B, C, D, E] = digits;
  const SUM = A + B + C + D + E;

  return {
    A, B, C, D, E, SUM,
    drawNumber: drawNumber.toString().padStart(5, '0')
  };
};

// Strategic result generation based on bet analysis
const generateStrategic5DResult = async (periodNumber, timer, pool) => {
  try {
    // Fetch all bets for analysis
    const [positionBets] = await pool.query(
      `SELECT position, bet_type, bet_value, SUM(amount) as total_amount 
       FROM bets_5d 
       WHERE period_number = ? AND timer = ? AND status = 'pending' AND position IN ('A', 'B', 'C', 'D', 'E')
       GROUP BY position, bet_type, bet_value
       ORDER BY position, total_amount DESC`,
      [periodNumber, timer]
    );

    const [sumBets] = await pool.query(
      `SELECT bet_type, SUM(amount) as total_amount 
       FROM bets_5d 
       WHERE period_number = ? AND timer = ? AND status = 'pending' AND position = 'SUM'
       GROUP BY bet_type
       ORDER BY total_amount DESC`,
      [periodNumber, timer]
    );

    const positions = ['A', 'B', 'C', 'D', 'E'];
    const resultDigits = [];

    // Generate strategic digit for each position
    for (const position of positions) {
      const positionBetsData = positionBets.filter(bet => bet.position === position);
      
      if (positionBetsData.length === 0) {
        // No bets for this position, generate random digit
        resultDigits.push(Math.floor(Math.random() * 10));
        continue;
      }

      // Group bets by type and find highest bet type
      const betTypeAmounts = {};
      positionBetsData.forEach(bet => {
        if (!betTypeAmounts[bet.bet_type]) {
          betTypeAmounts[bet.bet_type] = 0;
        }
        betTypeAmounts[bet.bet_type] += parseFloat(bet.total_amount);
      });

      // Find the bet type with highest amount
      let highestBetType = null;
      let highestAmount = 0;
      let specificNumber = null;

      for (const [betType, amount] of Object.entries(betTypeAmounts)) {
        if (amount > highestAmount) {
          highestAmount = amount;
          highestBetType = betType;
          
          // If it's a number bet, get the specific number
          if (betType === 'number') {
            const numberBet = positionBetsData.find(bet => bet.bet_type === 'number' && parseFloat(bet.total_amount) === amount);
            specificNumber = parseInt(numberBet.bet_value);
          }
        }
      }

      // Generate digit that defeats the highest bet type
      let strategicDigit;
      switch (highestBetType) {
        case 'even':
          // Generate odd number (1,3,5,7,9)
          strategicDigit = [1, 3, 5, 7, 9][Math.floor(Math.random() * 5)];
          break;
        case 'odd':
          // Generate even number (0,2,4,6,8)
          strategicDigit = [0, 2, 4, 6, 8][Math.floor(Math.random() * 5)];
          break;
        case 'low':
          // Generate high number (5,6,7,8,9)
          strategicDigit = [5, 6, 7, 8, 9][Math.floor(Math.random() * 5)];
          break;
        case 'high':
          // Generate low number (0,1,2,3,4)
          strategicDigit = [0, 1, 2, 3, 4][Math.floor(Math.random() * 5)];
          break;
        case 'number':
          // Generate any number except the bet number
          const availableNumbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter(n => n !== specificNumber);
          strategicDigit = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
          break;
        default:
          // Fallback to random
          strategicDigit = Math.floor(Math.random() * 10);
      }

      resultDigits.push(strategicDigit);
    }

    const [A, B, C, D, E] = resultDigits;
    let calculatedSum = A + B + C + D + E;

    // Handle SUM bets strategically
    if (sumBets.length > 0) {
      const highestSumBetType = sumBets[0].bet_type;
      const highestSumAmount = parseFloat(sumBets[0].total_amount);

      // Check if we need to adjust the sum
      let targetSumRange = null;
      switch (highestSumBetType) {
        case 'low':
          // Generate high sum (23-45)
          targetSumRange = { min: 23, max: 45 };
          break;
        case 'high':
          // Generate low sum (0-22)
          targetSumRange = { min: 0, max: 22 };
          break;
        case 'odd':
          // Generate even sum
          targetSumRange = calculatedSum % 2 === 1 ? 'makeEven' : 'keepEven';
          break;
        case 'even':
          // Generate odd sum
          targetSumRange = calculatedSum % 2 === 0 ? 'makeOdd' : 'keepOdd';
          break;
      }

      // Adjust sum if needed
      if (targetSumRange && typeof targetSumRange === 'object') {
        // For low/high adjustments
        if (calculatedSum < targetSumRange.min || calculatedSum > targetSumRange.max) {
          // Adjust the last digit to get sum in desired range
          const targetSum = Math.floor(Math.random() * (targetSumRange.max - targetSumRange.min + 1)) + targetSumRange.min;
          const currentSumWithoutE = A + B + C + D;
          const newE = Math.max(0, Math.min(9, targetSum - currentSumWithoutE));
          
          if (newE >= 0 && newE <= 9) {
            resultDigits[4] = newE;
            calculatedSum = currentSumWithoutE + newE;
          }
        }
      } else if (targetSumRange === 'makeEven') {
        // Make sum even by adjusting last digit if possible
        if (calculatedSum % 2 === 1 && resultDigits[4] > 0) {
          resultDigits[4]--;
          calculatedSum--;
        } else if (calculatedSum % 2 === 1 && resultDigits[4] < 9) {
          resultDigits[4]++;
          calculatedSum++;
        }
      } else if (targetSumRange === 'makeOdd') {
        // Make sum odd by adjusting last digit if possible
        if (calculatedSum % 2 === 0 && resultDigits[4] > 0) {
          resultDigits[4]--;
          calculatedSum--;
        } else if (calculatedSum % 2 === 0 && resultDigits[4] < 9) {
          resultDigits[4]++;
          calculatedSum++;
        }
      }
    }

    const finalSum = resultDigits.reduce((sum, digit) => sum + digit, 0);
    const drawNumber = resultDigits.join('');

    console.log(`Strategic Result Generated: ${drawNumber}, Sum: ${finalSum}`);
    console.log(`Position strategies applied for Period ${periodNumber} (${timer})`);

    return {
      A: resultDigits[0],
      B: resultDigits[1],
      C: resultDigits[2],
      D: resultDigits[3],
      E: resultDigits[4],
      SUM: finalSum,
      drawNumber: drawNumber
    };

  } catch (error) {
    console.error('Error in strategic generation, falling back to random:', error);
    // Fallback to random generation
    const drawNumber = Math.floor(Math.random() * 100000);
    return calculate5DResult(drawNumber);
  }
};

const check5DWinner = (bet, result) => {
  const { position, bet_type, bet_value } = bet;
  
  if (position === 'SUM') {
    const sum = result.SUM;
    switch (bet_type) {
      case 'low': return sum >= 0 && sum <= 22;
      case 'high': return sum >= 23 && sum <= 45;
      case 'odd': return sum % 2 === 1;
      case 'even': return sum % 2 === 0;
      default: return false;
    }
  } else {
    // Position bets (A, B, C, D, E)
    const positionValue = result[position];
    
    switch (bet_type) {
      case 'number': return parseInt(bet_value) === positionValue;
      case 'low': return positionValue >= 0 && positionValue <= 4;
      case 'high': return positionValue >= 5 && positionValue <= 9;
      case 'odd': return positionValue % 2 === 1;
      case 'even': return positionValue % 2 === 0;
      default: return false;
    }
  }
};

// ================== Place Bet API =================
app.post("/place-bet-5d", async (req, res) => {
  try {
    const { userId, position, betType, betValue, amount, periodNumber, timer } = req.body;

    // Validate required fields
    if (!userId || !position || !betType || !amount || !periodNumber || !timer) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: userId, position, betType, amount, periodNumber, timer" 
      });
    }

    // Validate timer
    if (!validateTimer(timer)) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid timer. Must be 1min, 3min, 5min, or 10min" 
      });
    }

    // Validate bet
    const validation = validate5DBet(position, betType, betValue);
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

    // Check if period is still open for betting
    const [periodCheck] = await pool.query(
      `SELECT * FROM result_5d WHERE period_number = ? AND timer = ?`,
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

    // Insert bet into database
    await pool.query(
      `INSERT INTO bets_5d (user_id, position, bet_type, bet_value, amount, period_number, timer, status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [userId, position, betType, betValue || null, amount, periodNumber, timer]
    );

    res.json({
      success: true,
      message: "Bet placed successfully",
      bet: {
        userId,
        position,
        betType,
        betValue,
        amount,
        periodNumber,
        timer
      }
    });

  } catch (error) {
    console.error("Error in place-bet-5dgame:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error placing bet", 
      error: error.message 
    });
  }
});

// ================== Generate Result API =================
app.post("/generate-result-5d", async (req, res) => {
  try {
    const { periodNumber, timer } = req.body;
    const io = getIO();

    // Validate input
    if (isNaN(periodNumber) || periodNumber < 1) {
      return res.status(400).json({ error: "Invalid period number." });
    }

    // Validate timer
    if (!validateTimer(timer)) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid timer. Must be 1min, 3min, 5min, or 10min" 
      });
    }

    // Check if result already exists for this period and timer
    const [existingResult] = await pool.query(
      `SELECT * FROM result_5d WHERE period_number = ? AND timer = ?`,
      [periodNumber, timer]
    );

    if (existingResult.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Result already generated for this period and timer" 
      });
    }

    // Generate strategic result based on bet analysis
    const result = await generateStrategic5DResult(periodNumber, timer, pool);

    // Save result to database
    await pool.query(
      `INSERT INTO result_5d (period_number, timer, draw_number, digit_a, digit_b, digit_c, digit_d, digit_e, sum_total, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [periodNumber, timer, result.drawNumber, result.A, result.B, result.C, result.D, result.E, result.SUM]
    );

    // Fetch all bets for this period and timer
    const [bets] = await pool.query(
      `SELECT * FROM bets_5d WHERE period_number = ? AND timer = ? AND status = 'pending'`,
      [periodNumber, timer]
    );

    // Calculate payouts
    let totalPayouts = 0;
    let winnersCount = 0;
    let losersCount = 0;
    const payoutMultiplier = 1.9; // 90% payout ratio

    for (const bet of bets) {
      const isWinner = check5DWinner(bet, result);

      if (isWinner) {
        const winnings = bet.amount * payoutMultiplier;
        totalPayouts += winnings;
        winnersCount++;

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
          `UPDATE bets_5d SET status = 'won', winnings = ? WHERE id = ?`,
          [winnings, bet.id]
        );
      } else {
        losersCount++;
        // Update bet status to lost
        await pool.query(
          `UPDATE bets_5d SET status = 'lost' WHERE id = ?`,
          [bet.id]
        );
      }
    }

    console.log(`Period ${periodNumber} (${timer}): Draw ${result.drawNumber}, Winners: ${winnersCount}, Losers: ${losersCount}, Total Payouts: ${totalPayouts}`);

    // Prepare final result
    const finalResult = {
      success: true,
      period_number: periodNumber,
      timer: timer,
      result: {
        draw_number: result.drawNumber,
        digits: {
          A: result.A,
          B: result.B,
          C: result.C,
          D: result.D,
          E: result.E
        },
        sum: result.SUM,
        total_payouts: totalPayouts,
        winners_count: winnersCount,
        losers_count: losersCount,
        processed_bets: bets.length
      }
    };

    // Emit socket event for real-time updates (specific to timer)
    io.emit(`5d-result:${timer}:${periodNumber}`, finalResult);
    io.emit(`5d-resultUpdate:${timer}`, finalResult); // General timer updates

    res.json(finalResult);

  } catch (error) {
    console.error("Error in generate-result-5d-game:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error generating 5D game result", 
      error: error.message 
    });
  }
});

app.post("/period-5d", async (req, res) => {
  const { mins } = req.body; // 'mins' means duration like '1min', '3min', etc.
  console.log("API hit for duration:", mins);

  try {
    const [rows] = await pool.query(
      "SELECT period_number FROM result_5d WHERE timer = ? ORDER BY period_number DESC LIMIT 1",
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
app.get("/bet-history-5d", async (req, res) => {
  const { userId, timer } = req.body;

  try {
    const [bets] = await pool.query(
      `SELECT * FROM bets_5d 
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

//===================result history API===================
app.get("/result-history-5d", async (req, res) => {
  const { timer } = req.body;

  try {
    const [results] = await pool.query(
      `SELECT * FROM result_5d 
       WHERE timer = ? 
       ORDER BY period_number DESC`,
      [timer]
    );

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: "No results found for this timer" });
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error("Error fetching result history:", error);
    res.status(500).json({ success: false, message: "Error fetching result history", error: error.message });
  }
});

//========= get latest result API =========
app.get("/latest-result-5d", async (req, res) => {
  const { timer, periodNumber } = req.body;
  try {
    const [results] = await pool.query(
      `SELECT * FROM result_5d 
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
  } });

 









module.exports = app;