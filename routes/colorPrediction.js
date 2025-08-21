const express = require("express");
const mysql = require("mysql2/promise");
const bodyParser = require("body-parser");
const cors = require("cors");
const authenticateToken = require('../middleware/authenticateToken');
const axios = require("axios");
const { processWeeklyLossCashback } = require("../utils/weeklyCashback");
const { updateGameplayTracking } = require("../utils/gameplay");
const { getIO } = require("../utils/socket");
const pool = require("../config/pool"); 


const app = express();
app.use(bodyParser.json());
app.use(cors());
// Database pool


function getColor(number) {
  if ([1, 3, 7, 9].includes(number)) return "red";
  if ([2, 4, 6, 8].includes(number)) return "green";
  return "voilet";
}

// Helper function to get size based on number
function getSize(number) {
  return number < 5 ? "small" : "big";
}

app.post("/latest-result", async (req, res) => {
  try {
    const { duration, periodNumber } = req.body;

    // 1. Validate duration
    if (!duration || !["1min", "3min", "5min", "10min"].includes(duration)) {
      return res.status(400).json({
        error: "Invalid duration. Must be one of: 1min, 3min, 5min, 10min"
      });
    }

    let query = "SELECT * FROM result WHERE duration = ?";
    let queryParams = [duration];

    // 2. Optional: Filter by periodNumber
    if (periodNumber) {
      query += " AND period_number = ?";
      queryParams.push(periodNumber);
    }

    query += " ORDER BY period_number DESC LIMIT 1"; // Only one recent result

    
    // 3. Query the DB
    const [results] = await pool.query(query, queryParams);

    // 4. Return result (could be empty)
    res.json({
      success: true,
      duration,
      periodNumber: periodNumber || null,
      result: results[0] || null
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Internal server error.",
      message: error.message
    });
  }
});


app.post("/generate-result", async (req, res) => {
  try {
    const { periodNumber, duration } = req.body;
    const io = getIO();

    // Validate input
    if (isNaN(periodNumber) || periodNumber < 1) {
      return res.status(400).json({ error: "Invalid period number." });
    }
    if (!["1min", "3min", "5min", "10min"].includes(duration)) {
      return res.status(400).json({ error: "Invalid duration." });
    }

    // Fetch all types of bets (number, color, size)
    const [numberBets] = await pool.query(
      `SELECT bet_value, SUM(amount) AS total_amount 
       FROM bets 
       WHERE bet_type = 'number' AND period_number = ? AND duration = ?
       GROUP BY bet_value`,
      [periodNumber, duration]
    );

    const [colorBets] = await pool.query(
      `SELECT bet_value, SUM(amount) AS total_amount 
       FROM bets 
       WHERE bet_type = 'color' AND period_number = ? AND duration = ?
       GROUP BY bet_value`,
      [periodNumber, duration]
    );

    const [sizeBets] = await pool.query(
      `SELECT bet_value, SUM(amount) AS total_amount 
       FROM bets 
       WHERE bet_type = 'size' AND period_number = ? AND duration = ?
       GROUP BY bet_value`,
      [periodNumber, duration]
    );

    // Winning color logic
    let winningColor;
    const redBet = colorBets.find(b => b.bet_value === "red");
    const greenBet = colorBets.find(b => b.bet_value === "green");
    const violetBet = colorBets.find(b => b.bet_value === "voilet");

    const redAmt = parseFloat(redBet?.total_amount || 0);
    const greenAmt = parseFloat(greenBet?.total_amount || 0);
    const violetAmt = parseFloat(violetBet?.total_amount || 0);

    console.log({ redAmt, greenAmt, violetAmt }); // For debugging

    // Exclude violet if it's the highest
    let allowedColors = ["red", "green", "voilet"];
    const maxAmt = Math.max(redAmt, greenAmt, violetAmt);

    if (violetAmt === maxAmt && violetAmt > 0) {
      allowedColors = allowedColors.filter(c => c !== "voilet");
    }

    // Apply custom rule logic
    if (greenAmt === redAmt && greenAmt > 0) {
      winningColor = allowedColors.includes("voilet")
        ? "voilet"
        : allowedColors[Math.floor(Math.random() * allowedColors.length)];
    } else if (greenAmt > redAmt) {
      const choices = allowedColors.filter(c => c !== "green");
      winningColor = choices[Math.floor(Math.random() * choices.length)];
    } else if (redAmt > greenAmt) {
      const choices = allowedColors.filter(c => c !== "red");
      winningColor = choices[Math.floor(Math.random() * choices.length)];
    } else {
      winningColor = allowedColors[Math.floor(Math.random() * allowedColors.length)];
    }

    // Winning number and size
    const validNumbers = {
      red: [1, 3, 7, 9],
      green: [2, 4, 6, 8],
      voilet: [0, 5, 0, 5],
    };

    const numbers = validNumbers[winningColor];
    const winningNumber = numbers[Math.floor(Math.random() * numbers.length)];
    const winningSize = getSize(winningNumber); // Use your existing getSize function

    // Save result to DB
    await pool.query(
      `INSERT INTO result (result_number, result_color, result_size, period_number, duration) 
       VALUES (?, ?, ?, ?, ?)`,
      [winningNumber, winningColor, winningSize, periodNumber, duration]
    );

    // Fetch all bets for payout distribution
    const [bets] = await pool.query(
      `SELECT * FROM bets WHERE period_number = ? AND duration = ?`,
      [periodNumber, duration]
    );

    // Payout calculation and distribution
    for (const bet of bets) {
      const isWinner =
        (bet.bet_type === "number" && parseInt(bet.bet_value) === winningNumber) ||
        (bet.bet_type === "color" && bet.bet_value === winningColor) ||
        (bet.bet_type === "size" && bet.bet_value === winningSize);

      if (isWinner) {
        const winnings = bet.amount * 1.9;
        await pool.query(
          `UPDATE wallet w
           JOIN users u ON u.id = w.UserId
           SET w.balance = w.balance + ?
           WHERE w.UserId = ? AND w.cryptoname = 'INR'`,
          [winnings, bet.user_id]
        );
      }
    }

    // Mark bets as processed
    await pool.query(
      `UPDATE bets SET status = 'processed' WHERE period_number = ? AND duration = ?`,
      [periodNumber, duration]
    );

    console.log(winningColor);

    // Emit socket event
    const finalResult = {
      success: true,
      period_number: periodNumber,
      duration: duration,
      result: {
        winning_color: winningColor,
        winning_number: winningNumber,
        winning_size: winningSize,
      },
    };

    io.emit(`resultUpdate:${duration}`, finalResult); // Emit to all users

    // Final response
    res.json(finalResult);
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false, 
      message: "Error in generate-result", 
      error: error.message 
    });
  }
});


// Endpoint to get the current remaining time for a specific timer duration
app.post("/timer", (req, res) => {
  const { duration } = req.body; // duration should be like "1min", "3min", etc.

  if (!duration) {
    return res.status(400).json({ success: false, message: "Duration is required." });
  }

  // Define durations in milliseconds
  const durations = {
    "1min": 60 * 1000,
    "3min": 3 * 60 * 1000,
    "5min": 5 * 60 * 1000,
    "10min": 10 * 60 * 1000,
  };

  const totalDurationMs = durations[duration];

  if (!totalDurationMs) {
    return res.status(400).json({ success: false, message: "Invalid duration specified." });
  }

  // Calculate elapsed time within the current cycle
  const now = Date.now();
  const elapsedInCycle = now % totalDurationMs;

  // Calculate remaining time in milliseconds
  const remainingTimeMs = totalDurationMs - elapsedInCycle;

  // Convert remaining time to seconds
  const remainingTimeSeconds = Math.floor(remainingTimeMs / 1000);

  // Format response based on duration
  let remainingTimeResponse;
  if (duration === "1min") {
    remainingTimeResponse = {
      remainingTimeSeconds: remainingTimeSeconds,
      currentTime: now, // Optional: include server time
    };
  } else {
    const remainingTimeMinutes = Math.floor(remainingTimeSeconds / 60);
    const remainingTimeRemainingSeconds = remainingTimeSeconds % 60;
    remainingTimeResponse = {
      remainingTimeMinutes: remainingTimeMinutes,
      remainingTimeSeconds: remainingTimeRemainingSeconds,
      currentTime: now, // Optional: include server time
    };
  }

  res.json(remainingTimeResponse);
});

app.post("/launchGame", async (req, res) => {
  const { userId, id } = req.body;
  const payload = {
    hall: "941094",
    key: "rollix777",
    login: userId,
    gameId: id,
    cmd: "openGame",
    demo: "0",
    domain: "https://rollix777.com/",
    cdnUrl: "",
    exitUrl: "https://rollix777.com/",
    language: "en"
  };
  try {
    const response = await axios.post("http://asiaapi.net/API/openGame/", payload);
    const gameUrl = response.data?.content?.game?.url;

    if (gameUrl) {
      res.json({ success: true, gameUrl });
    } else {
      res.status(500).json({ success: false, message: "Game URL not found in response." });
    }
  } catch (error) {
    console.error("Error launching game:", error.message);
    res.status(500).json({ success: false, message: "Failed to launch game.", error: error.message });
  }
})
app.post("/results", async (req, res) => {
  try {
    const { duration } = req.body;

    // Validate duration
    if (!duration || !["1min", "3min", "5min", "10min"].includes(duration)) {
      return res.status(400).json({
        error: "Invalid duration. Must be one of: 1min, 3min, 5min, 10min"
      });
    }

    // Query the results table with duration filter
    const [results] = await pool.query(
      "SELECT * FROM result WHERE duration = ? ORDER BY period_number DESC",
      [duration]
    );

    // Send the results as a JSON response
    res.json({
      success: true,
      duration,
      results
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Internal server error.",
      message: error.message
    });
  }
});

app.post("/bet-history", async (req, res) => {
  const { userId } = req.body;

  try {
    // Validate input
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: "Invalid user ID." });
    }

    // Corrected SQL to avoid duplicate joins from result table
    const [bets] = await pool.query(
      `
      SELECT 
        b.id AS bet_id,
        b.period_number,
        b.amount AS bet_amount,
        b.bet_type,
        b.bet_value,
        b.status,
        b.placed_at AS bet_date,
        r.result_number,
        r.result_color,
        r.result_size
      FROM bets b
      LEFT JOIN (
        SELECT r1.*
        FROM result r1
        INNER JOIN (
          SELECT period_number, MAX(id) AS max_id
          FROM result
          GROUP BY period_number
        ) r2 ON r1.id = r2.max_id
      ) r ON b.period_number = r.period_number
      WHERE b.user_id = ?
      ORDER BY b.placed_at DESC
      `,
      [userId]
    );

    // Process the results to calculate status and winnings
    const betHistory = bets.map((bet) => {
      let status = "lost";
      let amountReceived = 0;

      if (bet.status === "processed") {
        const isNumberWon = bet.bet_type === "number" && parseInt(bet.bet_value) === bet.result_number;
        const isColorWon = bet.bet_type === "color" && bet.bet_value === bet.result_color;
        const isSizeWon = bet.bet_type === "size" && bet.bet_value === bet.result_size;

        if (isNumberWon || isColorWon || isSizeWon) {
          status = "won";
          amountReceived = bet.bet_amount * 1.9; // 90% return
        }
      } else {
        status = "pending";
      }

      return {
        betId: bet.bet_id,
        periodNumber: bet.period_number,
        amount: parseFloat(bet.bet_amount),
        betType: bet.bet_type,
        betValue: bet.bet_value,
        status,
        amountReceived,
        date: bet.bet_date,
      };
    });

    res.json({ betHistory });
  } catch (error) {
    console.error(" Error in /bet-history:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});






// // ================== Endpoint to generate result and distribute winnings modification =================
// app.post("/generate-result", async (req, res) => {
//   try {
//     const { periodNumber, duration } = req.body;

//     // Validate input
//     if (isNaN(periodNumber) || periodNumber < 1) {
//       return res.status(400).json({ error: "Invalid period number." });
//     }
//     if (!["1min", "3min", "5min", "10min"].includes(duration)) {
//       return res.status(400).json({ error: "Invalid duration." });
//     }

//     // Fetch bets
//     const [numberBets] = await pool.query(
//       `SELECT bet_value, SUM(amount) AS total_amount 
//        FROM bets 
//        WHERE bet_type = 'number' AND period_number = ? AND duration = ?
//        GROUP BY bet_value`,
//       [periodNumber, duration]
//     );

//     const [colorBets] = await pool.query(
//       `SELECT bet_value, SUM(amount) AS total_amount 
//        FROM bets 
//        WHERE bet_type = 'color' AND period_number = ? AND duration = ?
//        GROUP BY bet_value`,
//       [periodNumber, duration]
//     );

//     const [sizeBets] = await pool.query(
//       `SELECT bet_value, SUM(amount) AS total_amount 
//        FROM bets 
//        WHERE bet_type = 'size' AND period_number = ? AND duration = ?
//        GROUP BY bet_value`,
//       [periodNumber, duration]
//     );

//     // Winning color logic
//     let winningColor;
// const redBet = colorBets.find(b => b.bet_value === "red");
// const greenBet = colorBets.find(b => b.bet_value === "green");
// const violetBet = colorBets.find(b => b.bet_value === "voilet");

// const redAmt = parseFloat(redBet?.total_amount || 0);
// const greenAmt = parseFloat(greenBet?.total_amount || 0);
// const violetAmt = parseFloat(violetBet?.total_amount || 0);


//     console.log({ redAmt, greenAmt, violetAmt }); // For debugging

//     // Exclude violet if it's the highest
//     let allowedColors = ["red", "green", "voilet"];
//     const maxAmt = Math.max(redAmt, greenAmt, violetAmt);

//     if (violetAmt === maxAmt && violetAmt > 0) {
//       allowedColors = allowedColors.filter(c => c !== "voilet");
//     }

//     // Apply custom rule logic
//     if (greenAmt === redAmt && greenAmt > 0) {
//       winningColor = allowedColors.includes("voilet")
//         ? "voilet"
//         : allowedColors[Math.floor(Math.random() * allowedColors.length)];
//     } else if (greenAmt > redAmt) {
//       const choices = allowedColors.filter(c => c !== "green");
//       winningColor = choices[Math.floor(Math.random() * choices.length)];
//     } else if (redAmt > greenAmt) {
//       const choices = allowedColors.filter(c => c !== "red");
//       winningColor = choices[Math.floor(Math.random() * choices.length)];
//     } else {
//       winningColor = allowedColors[Math.floor(Math.random() * allowedColors.length)];
//     }

//     // Winning number and size
//     const validNumbers = {
//       red: [1, 3, 7, 9],
//       green: [2, 4, 6, 8],
//       voilet: [0, 5, 0, 5],
//     };

//     const numbers = validNumbers[winningColor];
//     const winningNumber = numbers[Math.floor(Math.random() * numbers.length)];

//     const winningSize = getSize(winningNumber); // Use your existing getSize function

//     // Save result to DB
//     await pool.query(
//       `INSERT INTO result (result_number, result_color, result_size, period_number, duration) 
//        VALUES (?, ?, ?, ?, ?)`,
//       [winningNumber, winningColor, winningSize, periodNumber, duration]
//     );

//     // Fetch bets for distribution
//     const [bets] = await pool.query(
//       `SELECT * FROM bets WHERE period_number = ? AND duration = ?`,
//       [periodNumber, duration]
//     );

//     // Payout calculation
//     for (const bet of bets) {
//       const isWinner =
//         (bet.bet_type === "number" && parseInt(bet.bet_value) === winningNumber) ||
//         (bet.bet_type === "color" && bet.bet_value === winningColor) ||
//         (bet.bet_type === "size" && bet.bet_value === winningSize);

//       if (isWinner) {
//         const winnings = bet.amount * 1.9;
//         await pool.query(
//           `UPDATE wallet w
//            JOIN users u ON u.id = w.UserId
//            SET w.balance = w.balance + ?
//            WHERE w.UserId = ? AND w.cryptoname = 'INR'`,
//           [winnings, bet.user_id]
//         );
//       }
//     }

//     // Mark bets as processed
//     await pool.query(
//       `UPDATE bets SET status = 'processed' WHERE period_number = ? AND duration = ?`,
//       [periodNumber, duration]
//     );
// console.log(winningColor)
//     // Final response
//     res.json({
//       success: true,
//       period_number: periodNumber,
//       duration: duration,
//       result: {
//         winning_color: winningColor,
//         winning_number: winningNumber,
//         winning_size: winningSize,
//       },
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ success: false, message: "Error in generate-result", error: error.message });
//   }
// });


//================== modifiction to genrate the period number ==================
app.post("/period", async (req, res) => {
  const { mins } = req.body; // 'mins' means duration like '1min', '3min', etc.
  console.log("API hit for duration:", mins);

  try {
    const [rows] = await pool.query(
      "SELECT period_number FROM result WHERE duration = ? ORDER BY period_number DESC LIMIT 1",
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




// ===================  Get color bet report for a specific period =================
app.get('/color-bet-report/:periodNumber', async (req, res) => {
  try {
    const { periodNumber } = req.params;
    const { duration } = req.query;

    if (!periodNumber || !duration) {
      return res.status(400).json({
        success: false,
        message: "Both periodNumber and duration are required"
      });
    }
  
        // --- Check if periodNumber exists ---
    const [isValidPeriod] = await pool.query(`
      SELECT 1 FROM result WHERE period_number = ? AND duration = ? LIMIT 1
    `, [periodNumber, duration]);

    if (isValidPeriod.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Invalid periodNumber or duration"
      });
    }

    // --- Query for Color Bets ---
    const [colorBets] = await pool.query(`
      SELECT bet_value AS color, COUNT(*) AS total_bets, SUM(amount) AS total_amount, COUNT(DISTINCT user_id) AS unique_users
      FROM bets
      WHERE period_number = ? AND duration = ? AND bet_type = 'color'
      GROUP BY bet_value
    `, [periodNumber, duration]);

    // --- Query for Number Bets ---
    const [numberBets] = await pool.query(`
      SELECT bet_value AS number, COUNT(*) AS total_bets, SUM(amount) AS total_amount, COUNT(DISTINCT user_id) AS unique_users
      FROM bets
      WHERE period_number = ? AND duration = ? AND bet_type = 'number'
      GROUP BY bet_value
    `, [periodNumber, duration]);

    // --- Query for Size Bets ---
    const [sizeBets] = await pool.query(`
      SELECT bet_value AS size, COUNT(*) AS total_bets, SUM(amount) AS total_amount, COUNT(DISTINCT user_id) AS unique_users
      FROM bets
      WHERE period_number = ? AND duration = ? AND bet_type = 'size'
      GROUP BY bet_value
    `, [periodNumber, duration]);

    // --- Query for Result ---
    const [periodResult] = await pool.query(`
      SELECT result_color, result_number, result_size
      FROM result 
      WHERE period_number = ? AND duration = ?
    `, [periodNumber, duration]);

    // --- Initialize Color Report ---
    const colorReport = {
      red: { total_bets: 0, total_amount: 0, unique_users: 0 },
      green: { total_bets: 0, total_amount: 0, unique_users: 0 },
      voilet: { total_bets: 0, total_amount: 0, unique_users: 0 }
    };

    colorBets.forEach(bet => {
      if (colorReport[bet.color]) {
        colorReport[bet.color] = {
          total_bets: bet.total_bets,
          total_amount: parseFloat(bet.total_amount),
          unique_users: bet.unique_users
        };
      }
    });

    // --- Initialize Size Report ---
    const sizeReport = {
      small: { total_bets: 0, total_amount: 0, unique_users: 0 },
      big: { total_bets: 0, total_amount: 0, unique_users: 0 }
    };

    sizeBets.forEach(bet => {
      if (sizeReport[bet.size]) {
        sizeReport[bet.size] = {
          total_bets: bet.total_bets,
          total_amount: parseFloat(bet.total_amount),
          unique_users: bet.unique_users
        };
      }
    });

    // --- Calculate Summary ---
    const allBets = [...colorBets, ...numberBets, ...sizeBets];
    const summary = {
      total_bets: allBets.reduce((sum, b) => sum + b.total_bets, 0),
      total_amount: allBets.reduce((sum, b) => sum + parseFloat(b.total_amount), 0),
      total_unique_users: new Set([
        ...colorBets.map(b => b.user_id),
        ...numberBets.map(b => b.user_id),
        ...sizeBets.map(b => b.user_id)
      ]).size
    };

    // --- Final Response ---
    res.json({
      success: true,
      period_number: periodNumber,
      duration,
      result: periodResult.length ? {
        winning_color: periodResult[0].result_color,
        winning_number: periodResult[0].result_number,
        winning_size: periodResult[0].result_size
      } : null,
      color_bets: colorReport,
      number_bets: numberBets.map(n => ({
        number: n.number,
        total_bets: n.total_bets,
        total_amount: parseFloat(n.total_amount),
        unique_users: n.unique_users
      })),
      size_bets: sizeReport,
      summary
    });

  } catch (error) {
    console.error('Error generating bet report:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating bet report',
      error: error.message
    });
  }
});



// Endpoint to fetch user prediction history
app.get("/prediction/:userid/history", async (req, res) => {
  try {
    const { userid } = req.params;

    const query = "SELECT * FROM biddings WHERE userid = ? ORDER BY id DESC";
    pool.query(query, [userid], (err, results) => {
      if (err) return res.status(500).json({ error: "Database query error" });
      if (results.length === 0)
        return res.status(404).json({ error: "User not found" });

      // Query to fetch the results for the periods
      const periodIds = results.map((bid) => bid.period);
      const resultsQuery = "SELECT * FROM results WHERE period IN (?)";
      pool.query(resultsQuery, [periodIds], (err, resultRecords) => {
        if (err) return res.status(500).json({ error: "Database query error" });

        // Iterate over the biddings and determine win or lose
        const historyWithOutcome = results.map((bid) => {
          // Parse the number array from the biddings table
          const numbersInBid = JSON.parse(bid.number); // Parse the stringified array
          const result = resultRecords.find((r) => r.period === bid.period);

          if (result) {
            // Check if the result.number exists in the array from biddings
            const isWin = numbersInBid.includes(Number(result.number));
            return { ...bid, win_or_lose: isWin ? "won" : "lose" };
          } else {
            return { ...bid, win_or_lose: "pending" }; // If no result is found, it's a lose
          }
        });

        res.json(historyWithOutcome);
      });
    });
  } catch (error) {
    res.status(500).json({ error: "Error fetching user history" });
  }
});

app.get("/test-weekly-cashback", async (req, res) => {
  await processWeeklyLossCashback();
  res.send("Manual cashback processed.");
});

//============================================================================
// This will ensure that all below routes in this file require authentication
              app.use(authenticateToken);
//=============================================================================



 //============ Place a bet with duration and period number modification ==============
app.post("/place-bet", async (req, res) => {
  const { userId, betType, betValue, amount, periodNumber, duration } = req.body;

  try {
    // Step 1: Validate betType
    if (!["number", "color", "size"].includes(betType)) {
      return res.status(400).json({ error: "Invalid bet type." });
    }

    // Step 2: Validate amount
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid bet amount." });
    }

    // Step 3: Validate period number
    if (isNaN(periodNumber) || periodNumber < 1) {
      return res.status(400).json({ error: "Invalid period number." });
    }

    // Step 4: Validate duration
    const allowedDurations = ["1min", "3min", "5min", "10min"];
    if (!allowedDurations.includes(duration)) {
      return res.status(400).json({ error: "Invalid duration. Allowed: 1min, 3min, 5min, 10min." });
    }

    // Step 5: Check user balance
    const [user] = await pool.query(
      `SELECT u.*, w.balance 
       FROM users u
       LEFT JOIN wallet w ON u.id = w.userId AND w.cryptoname = 'INR'
       WHERE u.id = ?`,
      [userId]
    );

    if (user.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    if (Number(user[0].balance) < Number(amount)) {
      return res.status(400).json({ error: "Insufficient balance." });
    }

    // Step 6: Deduct amount from wallet
    await pool.query(
      `UPDATE wallet w
       JOIN users u ON u.id = w.userId
       SET w.balance = w.balance - ?
       WHERE w.userId = ? AND w.cryptoname = 'INR'`,
      [amount, userId]
    );

    // Step 7: Insert bet into bets table with duration
   await pool.query(
      `INSERT INTO bets (user_id, bet_type, bet_value, amount, period_number, duration)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, betType, betValue, amount, periodNumber, duration]
    );
 
    // Step 8: Update gameplay tracking
    await updateGameplayTracking(userId, amount);

    res.json({ message: "Bet placed successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error." });
  }
});



app.post("/checkValidBet", async (req, res) => {
  const { userId, duration } = req.body;

  try {
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: "Invalid user ID." });
    }

    const [rows] = await pool.query(
      `SELECT COUNT(*) AS count FROM bets WHERE user_id = ? AND status = 'pending' AND duration = ?`,
      [userId, duration]
    );

    const count = rows[0]?.count || 0; // Extract count value safely

    res.json({ pendingBets: count }); // Send response with count
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Endpoint to fetch user prediction history
app.get("/prediction/:userid/history", async (req, res) => {
  try {
    const { userid } = req.params;

    const query = "SELECT * FROM biddings WHERE userid = ? ORDER BY id DESC";
    pool.query(query, [userid], (err, results) => {
      if (err) return res.status(500).json({ error: "Database query error" });
      if (results.length === 0)
        return res.status(404).json({ error: "User not found" });

      // Query to fetch the results for the periods
      const periodIds = results.map((bid) => bid.period);
      const resultsQuery = "SELECT * FROM results WHERE period IN (?)";
      pool.query(resultsQuery, [periodIds], (err, resultRecords) => {
        if (err) return res.status(500).json({ error: "Database query error" });

        // Iterate over the biddings and determine win or lose
        const historyWithOutcome = results.map((bid) => {
          // Parse the number array from the biddings table
          const numbersInBid = JSON.parse(bid.number); // Parse the stringified array
          const result = resultRecords.find((r) => r.period === bid.period);

          if (result) {
            // Check if the result.number exists in the array from biddings
            const isWin = numbersInBid.includes(Number(result.number));
            return { ...bid, win_or_lose: isWin ? "won" : "lose" };
          } else {
            return { ...bid, win_or_lose: "pending" }; // If no result is found, it's a lose
          }
        });

        res.json(historyWithOutcome);
      });
    });
  } catch (error) {
    res.status(500).json({ error: "Error fetching user history" });
  }
});


module.exports = app;

