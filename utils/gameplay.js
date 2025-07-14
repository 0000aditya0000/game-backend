const connection = require('../config/db');


// For deposit API
const insertGameplayTracking = async (userId, depositId, amount) => {
  return new Promise((resolve, reject) => {
    const query = `
      INSERT INTO gameplay_tracking (userId, deposit_id, required_gameplay)
      VALUES (?, ?, ?)
    `;
    connection.query(query, [userId, depositId, amount], (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
};

//  Update gameplay tracking when user plays a game-> for place bet api
const updateGameplayTracking = async (userId, amountPlayed) => {
  return new Promise((resolve, reject) => {
    // Step 1: Update played_amount
    const updateAmountQuery = `
      UPDATE gameplay_tracking
      SET played_amount = played_amount + ?
      WHERE userId = ? AND is_completed = 0
    `;

    connection.query(updateAmountQuery, [amountPlayed, userId], (err) => {
      if (err) return reject(err);

      // Step 2: Mark as completed where played_amount >= required_gameplay
      const markCompletedQuery = `
        UPDATE gameplay_tracking
        SET is_completed = 1
        WHERE userId = ? AND played_amount >= required_gameplay AND is_completed = 0
      `;

      connection.query(markCompletedQuery, [userId], (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  });
};

//  Check if all gameplay requirements are fulfilled for withdrawal
// const canWithdraw = async (userId) => {
//   return new Promise((resolve, reject) => {
//     const query = `
//       SELECT is_completed 
//       FROM gameplay_tracking 
//       WHERE userId = ? 
//       ORDER BY id DESC 
//       LIMIT 1
//     `;

//     connection.query(query, [userId], (err, results) => {
//       if (err) {
//         console.error("Error checking gameplay status:", err);
//         return reject(err);
//       }

//       if (results.length === 0) {
//         // No gameplay data found, block withdrawal
//         return resolve(false);
//       }

//       const { is_completed } = results[0];
//       resolve(is_completed === 1); // Only allow if marked completed
//     });
//   });
// };



const canWithdraw = (userId) => {
  return new Promise((resolve, reject) => {
    const gameplayQuery = `
      SELECT id, required_gameplay, played_amount, created_at
      FROM gameplay_tracking
      WHERE userId = ? AND is_completed = 0
      ORDER BY created_at ASC
    `;

    connection.query(gameplayQuery, [userId], (err, gameplayRows) => {
      if (err) return reject(err);
      if (!gameplayRows.length) return resolve(true);

      let allCompleted = true;
      const updatePromises = [];

      const processRow = (index) => {
        if (index >= gameplayRows.length) {
          return Promise.all(updatePromises)
            .then(() => resolve(allCompleted))
            .catch(reject);
        }

        const { id, required_gameplay, played_amount, created_at } = gameplayRows[index];

        const turnoverQuery = `
          SELECT IFNULL(SUM(bet), 0) AS total
          FROM api_turnover
          WHERE login = ? AND created_at >= ?
        `;

        connection.query(turnoverQuery, [userId, created_at], (err, result) => {
          if (err) return reject(err);

          const turnover = parseFloat(result[0].total || 0);
          const totalPlayed = parseFloat(played_amount) + turnover;

          if (totalPlayed >= required_gameplay) {
            // 🛠 Update played_amount and mark as completed
            const updateQuery = `
              UPDATE gameplay_tracking
              SET played_amount = ?, is_completed = 1
              WHERE id = ?
            `;
            updatePromises.push(new Promise((res, rej) => {
              connection.query(updateQuery, [totalPlayed, id], (err) => {
                if (err) return rej(err);
                res();
              });
            }));
          } else {
            // Not enough, no update
            allCompleted = false;
          }

          // Proceed to next row
          processRow(index + 1);
        });
      };

      processRow(0);
    });
  });
};




module.exports = {
  updateGameplayTracking,
  canWithdraw,
 insertGameplayTracking
};
