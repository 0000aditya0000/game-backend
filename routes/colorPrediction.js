const express = require("express");
const connection = require("../config/db"); // Ensure database connection is configured
const router = express.Router();

router.post("/prediction", async (req, res) => {
  try {
    console.log("================");
    let { userid, amount, color, number, period, mins, small_big } = req.body;

    // Check if all required fields are provided
    if (!userid || !amount || !color || !number || !period || !mins) {
      return res.status(400).json({ error: "Enter required fields" });
    }

    // Set default value for small_big if it is not provided
    small_big = small_big || "NA";

    // Convert the 'number' array to JSON string before inserting into the database
    const numberJson = JSON.stringify(number);

    // SQL query to insert into the 'biddings' table
    const query =
      "INSERT INTO biddings (userid, amount, color, number, period, mins, small_big) VALUES (?, ?, ?, ?, ?, ?, ?)";

    connection.query(
      query,
      [userid, amount, color, numberJson, period, mins, small_big],
      (err, result) => {
        if (err) {
          console.log(err);
          return res.status(500).json({ error: "Database insertion error" });
        }
        res.status(201).json({
          message: "Bidding placed successfully",
          id: result.insertId, // This returns the auto-incremented id
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: "Error placing bidding" });
  }
});

router.get("/prediction/:userid/history", async (req, res) => {
  try {
    const { userid } = req.params;

    const query = "SELECT * FROM biddings WHERE userid = ? ORDER BY id DESC";
    connection.query(query, [userid], (err, results) => {
      if (err) return res.status(500).json({ error: "Database query error" });
      if (results.length === 0)
        return res.status(404).json({ error: "User not found" });

      // Query to fetch the results for the periods
      const periodIds = results.map(bid => bid.period);
      const resultsQuery = "SELECT * FROM results WHERE period IN (?)";
      connection.query(resultsQuery, [periodIds], (err, resultRecords) => {
        if (err) return res.status(500).json({ error: "Database query error" });

        // Iterate over the biddings and determine win or lose
        const historyWithOutcome = results.map(bid => {
          // Parse the number array from the biddings table
          const numbersInBid = JSON.parse(bid.number); // Parse the stringified array
          const result = resultRecords.find(r => r.period === bid.period);

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



// Result route
router.post("/result", async (req, res) => {
  try {
    const { period, mins } = req.body;

    // Generate a random number between 0 and 9
    const number = Math.floor(Math.random() * 10);

    // Determine the small_big value based on the generated number
    const small_big = number <= 4 ? "small" : "big";

    // Determine the color based on the generated number
    let color = "";
    if (number === 0) {
      color = "linear-gradient(135deg, #ef4444 50%, #8b5cf6 50%)";
    } else if (number === 5) {
      color = "linear-gradient(135deg, #10B981 50%, #8b5cf6 50%)";
    } else if ([1, 3, 7, 9].includes(number)) {
      color = "red";
    } else if ([2, 4, 6, 8].includes(number)) {
      color = "green";
    }

    // Insert the result into the results table
    const query = `
      INSERT INTO results (number, color, small_big, mins, period) 
      VALUES (?, ?, ?, ?, ?)
    `;
    connection.query(query, [number, color, small_big, mins, period], async (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Database error" });
      }

      // Check if the period and number exist in the biddings table
      const checkBiddingQuery = `
        SELECT * 
        FROM biddings 
        WHERE period = ? AND JSON_CONTAINS(number, JSON_ARRAY(?))
      `;
      connection.query(checkBiddingQuery, [period, number], async (checkErr, checkResults) => {
        if (checkErr) {
          console.error(checkErr);
          return res.status(500).json({ error: "Error checking biddings table" });
        }


        if (checkResults.length > 0) {
          // Call the WinPrediction function if matching records are found
          try {
            const predictionResult = await WinPrediction(period, number);
            console.log(predictionResult,"==============0000000000000");

            // Respond with a success message
            return res
              .status(201)
              .json({ message: "Result added successfully", results, predictionResult });
          } catch (predictionError) {
            console.error(predictionError);
            return res.status(500).json({ error: "Error processing winners" });
          }
        } else {
          // No matching records found, no need to call WinPrediction
          return res.status(201).json({ message: "Result added successfully", results });
        }
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error adding result" });
  }
});


const WinPrediction = async function (period, number) {
  try {
    const biddingQuery = `
      SELECT userid, amount 
      FROM biddings 
      WHERE period = ? AND JSON_CONTAINS(number, JSON_ARRAY(?))
    `;
    return new Promise((resolve, reject) => {
      connection.query(biddingQuery, [period, number], (err, results) => {
        if (err) {
          console.error(err);
          return reject(new Error("Database query error in biddings table"));
        }

        if (results.length === 0) {
          return resolve("No winners for this period and number");
        }

        // Process each winner
        results.forEach((row) => {
          const { userid, amount } = row;

          // Ensure amount is treated as a number
          const numericAmount = parseFloat(amount);

          // Correct 90% calculation
          const totalAmount = numericAmount + numericAmount * 0.9;

          // Update the user's wallet balance
          const walletQuery = `
            UPDATE wallet 
            SET balance = balance + ? 
            WHERE userid = ? AND cryptoname = 'cp'
          `;
          connection.query(walletQuery, [totalAmount, userid], (walletErr) => {
            if (walletErr) {
              console.error(walletErr);
              return reject(new Error("Database query error in wallet table"));
            }
          });
        });

        resolve("Winners processed successfully");
      });
    });
  } catch (error) {
    console.error("Error in WinPrediction function:", error);
    throw error;
  }
};



router.get("/result/:name",async(req,res)=>{
  const Tablename = req.params.name
  try {
    const query = "SELECT * FROM results WHERE mins = ?  ORDER BY id DESC ";
    connection.query(query,[Tablename],(err,result)=>{
      if (err) return res.status(500).json({ error: 'Database query error' });
      res.json(result);
    })
  } catch (error) {
    res.status(500).json({ error: 'Error fetching data' });
  }
})

router.post("/period", async (req, res) => {
  const { mins } = req.body;
  try {
    const query = "SELECT period FROM results WHERE mins = ? ORDER BY period DESC LIMIT 1";
    
    connection.query(query, [mins], (err, result) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }

      let newPeriod;
      if (result.length > 0 && result[0].period) {
        // Latest period ko 1 increment karna hai
        let lastPeriod = result[0].period;
        let numberPart = parseInt(lastPeriod.slice(-3)) + 1;
        newPeriod = lastPeriod.slice(0, -3) + numberPart.toString().padStart(3, '0');
      } else {
        // Naya period generate karna hai
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const date = String(now.getDate()).padStart(2, '0');
        newPeriod = `${year}${month}${date}0001`;
      }

      res.json({ period: newPeriod });
    });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
