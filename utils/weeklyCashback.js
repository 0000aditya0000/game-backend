const cron = require('node-cron');
const connection = require('../config/db');

// =======================
// Weekly Cashback Function
// =======================
async function processWeeklyLossCashback() {
  try {
    // Get only those users who lost bets this week
    const users = await new Promise((resolve, reject) => {
      connection.query(
        `
        SELECT DISTINCT b.user_id AS id
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
        WHERE b.status = 'processed'
          AND (
            (b.bet_type = 'number' AND b.bet_value != r.result_number) OR
            (b.bet_type = 'color' AND b.bet_value != r.result_color) OR
            (b.bet_type = 'size' AND b.bet_value != r.result_size)
          )
          AND WEEK(b.placed_at, 1) = WEEK(CURRENT_DATE(), 1)
          AND YEAR(b.placed_at) = YEAR(CURRENT_DATE())
        `,
        (err, results) => {
          if (err) return reject(err);
          resolve(results);
        }
      );
    });

    for (const user of users) {
      const userId = user.id;

      // Calculate total lost this week
      const lostBets = await new Promise((resolve, reject) => {
        connection.query(
          `
          SELECT SUM(b.amount) AS totalLost
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
            AND b.status = 'processed'
            AND (
              (b.bet_type = 'number' AND b.bet_value != r.result_number) OR
              (b.bet_type = 'color' AND b.bet_value != r.result_color) OR
              (b.bet_type = 'size' AND b.bet_value != r.result_size)
            )
            AND WEEK(b.placed_at, 1) = WEEK(CURRENT_DATE(), 1)
            AND YEAR(b.placed_at) = YEAR(CURRENT_DATE())
          `,
          [userId],
          (err, results) => {
            if (err) return reject(err);
            resolve(results);
          }
        );
      });

      const totalLost = parseFloat(lostBets[0]?.totalLost || 0);
      const cashbackAmount = parseFloat((totalLost * 0.10).toFixed(2));

      console.log(` User ${userId} lost ₹${totalLost} this week. Cashback = ₹${cashbackAmount}`);

      if (cashbackAmount > 0) {
        // Credit cashback to INR wallet
        await new Promise((resolve, reject) => {
          connection.query(
            `UPDATE wallet SET balance = balance + ? WHERE userId = ? AND cryptoname = 'INR'`,
            [cashbackAmount, userId],
            (err, results) => {
              if (err) return reject(err);
              resolve(results);
            }
          );
        });

       

        console.log(` Cashback ₹${cashbackAmount} added to userId: ${userId}`);
      }
    }
  } catch (error) {
    console.error(" Error processing weekly cashback:", error);
  }
}

// =======================
// Cron Schedule — Every Sunday 11:59 PM
// =======================
cron.schedule("59 23 * * 0", async () => {
  console.log("Running weekly cashback job...");
  await processWeeklyLossCashback();
});

module.exports = { processWeeklyLossCashback };
