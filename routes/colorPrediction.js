const express = require("express");
const mysql = require("mysql2/promise");
const bodyParser = require("body-parser");
const cors = require("cors");

const axios = require("axios");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Database pool
const pool = mysql.createPool({
  host: "localhost",
  user: "lucifer", // Replace with your MySQL username
  password: "Welcome@noida2024", // Replace with your MySQL password
  database: "stake",
});

function getColor(number) {
  if ([1, 3, 7, 9].includes(number)) return "red";
  if ([2, 4, 6, 8].includes(number)) return "green";
  return "voilet";
}

// Helper function to get size based on number
function getSize(number) {
  return number < 5 ? "small" : "big";
}
// Place a bet
// app.post("/place-bet", async (req, res) => {
//   const { userId, betType, betValue, amount, periodNumber } = req.body;
//   console.log(amount);

//   try {
//     // Validate input
//     if (!["number", "color", "size"].includes(betType)) {
//       return res.status(400).json({ error: "Invalid bet type." });
//     }
//     if (isNaN(amount) || amount <= 0) {
//       return res.status(400).json({ error: "Invalid bet amount." });
//     }
//     if (isNaN(periodNumber) || periodNumber < 1) {
//       return res.status(400).json({ error: "Invalid period number." });
//     }

//     // Check user balance
//     const [user] = await pool.query(
//       `SELECT u.*, w.balance 
//          FROM users u
//          LEFT JOIN wallet w ON u.id = w.userId AND w.cryptoname = 'INR'
//          WHERE u.id = ?`,
//       [userId]
//     );

//     if (user.length === 0) {
//       return res.status(404).json({ error: "User not found." });
//     }
//     if (Number(user[0].balance) < Number(amount)) {
//       console.log(user[0].balance);
//       console.log(amount);

//       console.log(user[0].balance < amount);

//       return res.status(400).json({ error: "Insufficient balance." });
//     }
//     console.log(amount);
//     // Deduct amount from user balance
//     await pool.query(
//       `UPDATE wallet w
//          JOIN users u ON u.id = w.userId
//          SET w.balance = w.balance - ?
//          WHERE w.userId = ? AND w.cryptoname = 'INR'`,
//       [amount, userId]
//     );

//     console.log("after", amount);

//     // Insert bet into database with period number
//     await pool.query(
//       "INSERT INTO bets (user_id, bet_type, bet_value, amount, period_number) VALUES (?, ?, ?, ?, ?)",
//       [userId, betType, betValue, amount, periodNumber]
//     );

//     res.json({ message: "Bet placed successfully." });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: "Internal server error." });
//   }
// });

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

// Generate result and distribute winnings
// app.post("/generate-result", async (req, res) => {
//   try {
//     // Validate input
//     const { periodNumber } = req.body;
//     console.log(periodNumber)
//     if (isNaN(periodNumber) || periodNumber < 1) {
//       return res.status(400).json({ error: "Invalid period number." });
//     }

//     // Aggregate total bets by type and value for the specified period
//     const [numberBets] = await pool.query(
//       "SELECT bet_value, SUM(amount) AS total_amount FROM bets WHERE bet_type = 'number' AND period_number = ? GROUP BY bet_value",
//       [periodNumber]
//     );
//     const [colorBets] = await pool.query(
//       "SELECT bet_value, SUM(amount) AS total_amount FROM bets WHERE bet_type = 'color' AND period_number = ? GROUP BY bet_value",
//       [periodNumber]
//     );
//     const [sizeBets] = await pool.query(
//       "SELECT bet_value, SUM(amount) AS total_amount FROM bets WHERE bet_type = 'size' AND period_number = ? GROUP BY bet_value",
//       [periodNumber]
//     );

//     // Helper function to find the value with the least total bet
//     function findLeastBetValue(bets) {
//       if (bets.length === 0) return null; // Return null if no bets are placed
//       return bets.reduce(
//         (min, bet) => (bet.total_amount < min.total_amount ? bet : min),
//         { total_amount: Infinity }
//       ).bet_value;
//     }

//     // Determine winning color
//     let winningColor;
//     const redBet = colorBets.find((bet) => bet.bet_value === "red");
//     const greenBet = colorBets.find((bet) => bet.bet_value === "green");

//     if (redBet && greenBet) {
//       // Both red and green have bets in the current period
//       if (redBet.total_amount === greenBet.total_amount) {
//         // If total amounts are equal, the result is 'voilet'
//         winningColor = "voilet";
//       } else {
//         // Otherwise, the color with the least total bet amount wins
//         winningColor = redBet.total_amount < greenBet.total_amount ? "red" : "green";
//       }
//     } else {
//       winningColor = ["red", "green", "voilet"][Math.floor(Math.random() * 3)];
//     }


//     // Determine winning number based on winning color
//     const validNumbers = {
//       red: [1, 3, 7, 9],
//       green: [2, 4, 6, 8],
//       voilet: [0, 5, 0, 5],
//     };
//     // const candidates = validNumbers[winningColor];

//     let winningNumber;
//     if (winningColor) {
//       const numbers = validNumbers[winningColor];
//       winningNumber = numbers[Math.floor(Math.random() * numbers.length)];
//     } else {
//       return res.status(400).json({ error: "Invalid winning color" });
//     }



//     // if (!winningNumber || !candidates.includes(parseInt(winningNumber))) {
//     //     winningNumber = candidates[Math.floor(Math.random() * candidates.length)];
//     // }

//     // Determine winning size based on winning number
//     const winningSize = getSize(winningNumber);
//     console.log(winningNumber)

//     // Store result in database with period number
//     await pool.query(
//       "INSERT INTO result (result_number, result_color, result_size, period_number) VALUES (?, ?, ?, ?)",
//       [winningNumber, winningColor, winningSize, periodNumber]
//     );

//     // Distribute winnings for the specified period
//     const [bets] = await pool.query("SELECT * FROM bets WHERE period_number = ?", [periodNumber]);
//     for (const bet of bets) {
//       if (
//         (bet.bet_type === "number" && parseInt(bet.bet_value) === winningNumber) ||
//         (bet.bet_type === "color" && bet.bet_value === winningColor) ||
//         (bet.bet_type === "size" && bet.bet_value === winningSize)
//       ) {
//         const winnings = bet.amount * 1.9; // 90% return
//         await pool.query(
//           `UPDATE wallet w
//                    JOIN users u ON u.id = w.UserId
//                    SET w.balance = w.balance + ?
//                    WHERE w.UserId = ? AND w.cryptoname = 'INR'`,
//           [winnings, bet.user_id]
//         );
//       }
//     }

//     // Mark all bets for the specified period as processed
//     await pool.query("UPDATE bets SET status = 'processed' WHERE period_number = ?", [periodNumber]);

//     // Fetch and return the detailed result including color bets summary
//     const resultDetails = await pool.query(
//       `
//       SELECT 
//           r.period_number,
//           r.result_color,
//           r.result_number,
//           SUM(CASE WHEN b.bet_type = 'color' THEN b.amount ELSE 0 END) AS total_color_bets,
//           COUNT(DISTINCT CASE WHEN b.bet_type = 'color' THEN b.user_id END) AS unique_color_bettors
//       FROM result r
//       LEFT JOIN bets b ON r.period_number = b.period_number AND b.status = 'processed'
//       WHERE r.period_number = ?
//       GROUP BY r.period_number, r.result_color, r.result_number
//       `,
//       [periodNumber]
//     );

//     const colorBetsSummary = {
//       red: {
//         total_bets: 0,
//         total_amount: 0,
//         unique_users: 0,
//       },
//       green: {
//         total_bets: 0,
//         total_amount: 0,
//         unique_users: 0,
//       },
//       voilet: {
//         total_bets: 0,
//         total_amount: 0,
//         unique_users: 0,
//       },
//     };

//     if (resultDetails.length > 0) {
//       const details = resultDetails[0];
//       colorBetsSummary.red.total_bets = details.total_color_bets || 0;
//       colorBetsSummary.red.total_amount = details.total_color_bets || 0;
//       colorBetsSummary.red.unique_users = details.unique_color_bettors || 0;
//       colorBetsSummary.green.total_bets = details.total_color_bets || 0;
//       colorBetsSummary.green.total_amount = details.total_color_bets || 0;
//       colorBetsSummary.green.unique_users = details.unique_color_bettors || 0;
//       colorBetsSummary.voilet.total_bets = details.total_color_bets || 0;
//       colorBetsSummary.voilet.total_amount = details.total_color_bets || 0;
//       colorBetsSummary.voilet.unique_users = details.unique_color_bettors || 0;
//     }

//     // Prepare the final response object
//     const response = {
//       success: true,
//       period_number: periodNumber,
//       result: {
//         winning_color: winningColor,
//         winning_number: winningNumber,
//       },
//       color_bets: colorBetsSummary,
//       summary: {
//         total_bets: Object.values(colorBetsSummary).reduce((sum, color) => sum + color.total_bets, 0),
//         total_amount: Object.values(colorBetsSummary).reduce((sum, color) => sum + color.total_amount, 0),
//         total_unique_users: Object.values(colorBetsSummary).reduce((sum, color) => sum + color.unique_users, 0),
//       },
//     };

//     res.json(response);
//   } catch (error) {
//     console.error(error);
//     return res.status(404).json({ success: false, message: "Error in generate-result ", error: error.message })
//   }
// });

// const WinPrediction = async function (period, number) {
//   try {
//     const biddingQuery = `
//       SELECT userid, amount
//       FROM biddings
//       WHERE period = ? AND JSON_CONTAINS(number, JSON_ARRAY(?))
//     `;
//     return new Promise((resolve, reject) => {
//       pool.query(biddingQuery, [period, number], (err, results) => {
//         if (err) {
//           console.error(err);
//           return reject(new Error("Database query error in biddings table"));
//         }

//         if (results.length === 0) {
//           return resolve("No winners for this period and number");
//         }

//         // Process each winner
//         results.forEach((row) => {
//           const { userid, amount } = row;

//           // Ensure amount is treated as a number
//           const numericAmount = parseFloat(amount);

//           // Correct 90% calculation
//           const totalAmount = numericAmount + numericAmount * 0.9;

//           // Update the user's wallet balance
//           const walletQuery = `
//             UPDATE wallet
//             SET balance = balance + ?
//             WHERE userid = ? AND cryptoname = 'cp'
//           `;
//           pool.query(walletQuery, [totalAmount, userid], (walletErr) => {
//             if (walletErr) {
//               console.error(walletErr);
//               return reject(new Error("Database query error in wallet table"));
//             }
//           });
//         });

//         resolve("Winners processed successfully");
//       });
//     });
//   } catch (error) {
//     console.error("Error in WinPrediction function:", error);
//     throw error;
//   }
// };

// app.get("/result/:name",async(req,res)=>{
//   const Tablename = req.params.name
//   try {
//     const query = "SELECT * FROM results WHERE mins = ?  ORDER BY id DESC ";y
//     pool.query(query,[Tablename],(err,result)=>{
//       if (err) return res.status(500).json({ error: 'Database query error' });
//       res.json(result);
//     })
//   } catch (error) {
//     res.status(500).json({ error: 'Error fetching data' });
//   }
// })
// Route to fetch all results from the database
app.get("/results", async (req, res) => {
  try {
    // Query the results table
    const [results] = await pool.query(
      "SELECT * FROM result ORDER BY period_number DESC"
    );

    // Send the results as a JSON response
    res.json({ results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.post("/period", async (req, res) => {
  const { mins } = req.body;
  try {
    const query =
      "SELECT period FROM result WHERE mins = ? ORDER BY period DESC LIMIT 1";

    pool.query(query, [mins], (err, result) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }

      let newPeriod;
      if (result.length > 0 && result[0].period) {
        // Latest period ko 1 increment karna hai
        let lastPeriod = result[0].period;
        let numberPart = parseInt(lastPeriod.slice(-3)) + 1;
        newPeriod =
          lastPeriod.slice(0, -3) + numberPart.toString().padStart(3, "0");
      } else {
        // Naya period generate karna hai
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const date = String(now.getDate()).padStart(2, "0");
        newPeriod = `${year}${month}${date}0001`;
      }

      res.json({ period: newPeriod });
    });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/bet-history", async (req, res) => {
  const { userId } = req.body;

  try {
    // Validate input
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: "Invalid user ID." });
    }

    // Query to fetch all bets placed by the user
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
          LEFT JOIN result r ON b.period_number = r.period_number
          WHERE b.user_id = ?
          ORDER BY b.placed_at DESC
          `,
      [userId]
    );

    // Process the results to calculate status and winnings
    const betHistory = bets.map((bet) => {
      let status = "lost";
      let amountReceived = 0;

      // Determine if the bet was won
      if (bet.status === "processed") {
        if (
          (bet.bet_type === "number" &&
            parseInt(bet.bet_value) === bet.result_number) ||
          (bet.bet_type === "color" && bet.bet_value === bet.result_color) ||
          (bet.bet_type === "size" && bet.bet_value === bet.result_size)
        ) {
          status = "won";
          amountReceived = bet.bet_amount * 1.9; // 90% return
        }
      } else {
        status = "pending"; // Bet has not been processed yet
      }

      return {
        betId: bet.bet_id,
        periodNumber: bet.period_number,
        amount: bet.bet_amount,
        betType: bet.bet_type,
        betValue: bet.bet_value,
        status: status,
        amountReceived: amountReceived,
        date: bet.bet_date,
      };
    });

    res.json({ betHistory });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.post("/checkValidBet", async (req, res) => {
  const { userId } = req.body;

  try {
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: "Invalid user ID." });
    }

    const [rows] = await pool.query(
      `SELECT COUNT(*) AS count FROM bets WHERE user_id = ? AND status = 'pending'`,
      [userId]
    );

    const count = rows[0]?.count || 0; // Extract count value safely

    res.json({ pendingBets: count }); // Send response with count
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error." });
  }
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



// ===================  Get color bet report for a specific period =================
app.get('/color-bet-report/:periodNumber', async (req, res) => {
  try {
    const { periodNumber } = req.params;

    if (!periodNumber) {
      return res.status(400).json({
        success: false,
        message: "Period number is required"
      });
    }

    // Get total bets for each color in the specified period
    const colorQuery = `
            SELECT 
                bet_value as color,
                COUNT(*) as total_bets,
                SUM(amount) as total_amount,
                COUNT(DISTINCT user_id) as unique_users
            FROM bets 
            WHERE period_number = ? 
            AND bet_type = 'color'
            GROUP BY bet_value
        `;

    const [colorBets] = await pool.query(colorQuery, [periodNumber]);

    // Get result for this period
    const resultQuery = `
            SELECT result_color, result_number 
            FROM result 
            WHERE period_number = ?
        `;

    const [periodResult] = await pool.query(resultQuery, [periodNumber]);

    // Initialize report structure with all colors
    const report = {
      red: { total_bets: 0, total_amount: 0, unique_users: 0 },
      green: { total_bets: 0, total_amount: 0, unique_users: 0 },
      voilet: { total_bets: 0, total_amount: 0, unique_users: 0 }
    };

    // Fill in actual bet data
    colorBets.forEach(bet => {
      if (report[bet.color]) {
        report[bet.color] = {
          total_bets: bet.total_bets,
          total_amount: parseFloat(bet.total_amount),
          unique_users: bet.unique_users
        };
      }
    });

    res.json({
      success: true,
      period_number: periodNumber,
      result: periodResult.length ? {
        winning_color: periodResult[0].result_color,
        winning_number: periodResult[0].result_number
      } : null,
      color_bets: report,
      summary: {
        total_bets: Object.values(report).reduce((sum, color) => sum + color.total_bets, 0),
        total_amount: Object.values(report).reduce((sum, color) => sum + color.total_amount, 0),
        total_unique_users: Object.values(report).reduce((sum, color) => sum + color.unique_users, 0)
      }
    });

  } catch (error) {
    console.error('Error generating color bet report:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating color bet report',
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

    res.json({ message: "Bet placed successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error." });
  }
});


// ================== Endpoint to generate result and distribute winnings modification =================
app.post("/generate-result", async (req, res) => {
  try {
    const { periodNumber, duration } = req.body;

    // Validate input
    if (isNaN(periodNumber) || periodNumber < 1) {
      return res.status(400).json({ error: "Invalid period number." });
    }
    if (!["1min", "3min", "5min", "10min"].includes(duration)) {
      return res.status(400).json({ error: "Invalid duration." });
    }

    // Fetch bets for this period and duration
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

    // Decide winning color
    function findLeastBetValue(bets) {
      if (bets.length === 0) return null;
      return bets.reduce((min, bet) => (bet.total_amount < min.total_amount ? bet : min), { total_amount: Infinity }).bet_value;
    }

    let winningColor;
    const redBet = colorBets.find(b => b.bet_value === "red");
    const greenBet = colorBets.find(b => b.bet_value === "green");

    if (redBet && greenBet) {
      winningColor = redBet.total_amount === greenBet.total_amount
        ? "voilet"
        : redBet.total_amount < greenBet.total_amount
        ? "red"
        : "green";
    } else {
      winningColor = ["red", "green", "voilet"][Math.floor(Math.random() * 3)];
    }

    const validNumbers = {
      red: [1, 3, 7, 9],
      green: [2, 4, 6, 8],
      voilet: [0, 5, 0, 5],
    };

    const numbers = validNumbers[winningColor];
    const winningNumber = numbers[Math.floor(Math.random() * numbers.length)];
    const winningSize = getSize(winningNumber); // Your existing getSize function

    // Insert result with duration
    await pool.query(
      `INSERT INTO result (result_number, result_color, result_size, period_number, duration) 
       VALUES (?, ?, ?, ?, ?)`,
      [winningNumber, winningColor, winningSize, periodNumber, duration]
    );

    // Distribute winnings
    const [bets] = await pool.query(
      `SELECT * FROM bets WHERE period_number = ? AND duration = ?`,
      [periodNumber, duration]
    );

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

    await pool.query(
      `UPDATE bets SET status = 'processed' WHERE period_number = ? AND duration = ?`,
      [periodNumber, duration]
    );

    // Response
    res.json({
      success: true,
      period_number: periodNumber,
      duration: duration,
      result: {
        winning_color: winningColor,
        winning_number: winningNumber,
        winning_size: winningSize,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error in generate-result", error: error.message });
  }
});





module.exports = app;
