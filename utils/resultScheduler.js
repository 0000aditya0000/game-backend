const axios = require("axios");
const mysql = require('mysql2/promise');
const { getIO } = require("./socket");


const pool = mysql.createPool({
  host: "localhost",
  user: "root", // Replace with your MySQL username
  password: "", // Replace with your MySQL password
  database: "stake",
});




const io = getIO();
const durations = {
  "1min": 60 * 1000,
  "3min": 3 * 60 * 1000,
  "5min": 5 * 60 * 1000,
  "10min": 10 * 60 * 1000,
};

Object.entries(durations).forEach(([duration, interval]) => {
  setInterval(() => {
    const now = Date.now();
    const elapsedInCycle = now % interval;
    const remainingTimeMs = interval - elapsedInCycle;

    io.emit(`timerUpdate:${duration}`, {
      duration,
      remainingTimeMs,
    });

    if (remainingTimeMs <= 1000) {
      // Don't block the main event loop — run in separate async scope
      (async () => {
        try {
          console.log(`${duration} timer ending!`);

          const [rows] = await pool.query(
            "SELECT period_number FROM result WHERE duration = ? ORDER BY period_number DESC LIMIT 1",
            [duration]
          );

          const lastPeriod = rows.length ? rows[0].period_number : 0;
          const nextPeriod = lastPeriod + 1;

          await axios.post("http://localhost:5000/api/color/generate-result", {
            periodNumber: nextPeriod,
            duration: duration,
          });

          console.log(`++ Result generated [${duration}] Period: ${nextPeriod}`);
        } catch (err) {
          console.error(` Error in scheduler for ${duration}:`, err.message);
        }
      })(); // <-- Immediately invoked async function
    }

  }, 1000); // Still tick every 1s
});

