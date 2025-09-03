const cron = require('node-cron');
const connection = require('../config/db');

// FUNCTION WRAPPED FOR MANUAL CALL
async function creditCommissions() {
   // console.log('Starting commission crediting job manually or via cron...');

    try {
        await new Promise((resolve, reject) => {
            connection.beginTransaction(err => {
                if (err) return reject(err);
                resolve();
            });
        });

        const uncreditedCommissionsQuery = `
            SELECT user_id, cryptoname, SUM(amount) as total_amount
            FROM referralcommissionhistory
            WHERE credited = FALSE
            GROUP BY user_id, cryptoname
        `;
        const uncreditedCommissions = await new Promise((resolve, reject) => {
            connection.query(uncreditedCommissionsQuery, (err, results) => {
                if (err) return reject(err);
                resolve(results);
            });
        });

        if (uncreditedCommissions.length === 0) {
            console.log('No uncredited commissions to process.');
            await new Promise((resolve, reject) => {
                connection.commit(err => {
                    if (err) return reject(err);
                    resolve();
                });
            });
            return;
        }

        for (const commission of uncreditedCommissions) {
            const { user_id, cryptoname, total_amount } = commission;

            const updateWalletQuery = `
                UPDATE wallet
                SET balance = balance + ?
                WHERE userId = ? AND cryptoname = ?
            `;
            const walletResult = await new Promise((resolve, reject) => {
                connection.query(updateWalletQuery, [total_amount, user_id, cryptoname], (err, results) => {
                    if (err) return reject(err);
                    resolve(results);
                });
            });

            if (walletResult.affectedRows === 0) {
                throw new Error(`Wallet entry for user ${user_id} and ${cryptoname} not found.`);
            }

            const updateCommissionsQuery = `
                INSERT INTO usercommissions (userId, cryptoname, total_commissions)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE total_commissions = total_commissions + ?
            `;
            await new Promise((resolve, reject) => {
                connection.query(updateCommissionsQuery, [user_id, cryptoname, total_amount, total_amount], (err, results) => {
                    if (err) return reject(err);
                    resolve(results);
                });
            });
        }

        const markCreditedQuery = `
            UPDATE referralcommissionhistory
            SET credited = TRUE
            WHERE credited = FALSE
        `;
        await new Promise((resolve, reject) => {
            connection.query(markCreditedQuery, (err, results) => {
                if (err) return reject(err);
                resolve(results);
            });
        });

        await new Promise((resolve, reject) => {
            connection.commit(err => {
                if (err) return reject(err);
                resolve();
            });
        });

        console.log('Commissions credited successfully.');
    } catch (error) {
        console.error('Error during commission crediting job:', error);
        await new Promise(resolve => {
            connection.rollback(() => resolve());
        });
        throw error;
    }
}

//  CRON JOB (Auto runs daily at 12:00 AM IST)
// cron.schedule('30 18 * * *', creditCommissions, {
//     scheduled: true,
//     timezone: 'UTC'
// });
cron.schedule('30 19 * * *', creditCommissions, {
  scheduled: true,
  timezone: 'UTC'
});

console.log('Commission scheduler loaded. Cron job scheduled for 12:00 AM IST.');

//  EXPORT the function to call manually
module.exports = { creditCommissions };










// const cron = require('node-cron');
// const connection = require('../config/db');

// /**
//  * Credit commissions from referralcommissionhistory to user wallets and usercommissions
//  */
// async function creditCommissions() {
//     console.log('Starting commission crediting job...');

//     try {
//         await new Promise((resolve, reject) => {
//             connection.beginTransaction(err => {
//                 if (err) return reject(err);
//                 resolve();
//             });
//         });

//         // Get uncredited commissions (where credited = 0)
//         const uncreditedCommissionsQuery = `
//             SELECT user_id, cryptoname, SUM(amount) as total_amount, SUM(totalBet) as total_bet_amount
//             FROM referralcommissionhistory
//             WHERE credited = 0
//             GROUP BY user_id, cryptoname
//         `;
        
//         const uncreditedCommissions = await new Promise((resolve, reject) => {
//             connection.query(uncreditedCommissionsQuery, (err, results) => {
//                 if (err) return reject(err);
//                 resolve(results);
//             });
//         });

//         if (uncreditedCommissions.length === 0) {
//             console.log('No uncredited commissions to process.');
//             await new Promise((resolve, reject) => {
//                 connection.commit(err => {
//                     if (err) return reject(err);
//                     resolve();
//                 });
//             });
//             return;
//         }

//         console.log(`Found ${uncreditedCommissions.length} commission groups to process`);

//         let totalUsersUpdated = 0;
//         let totalCommissionAmount = 0;

//         // Process each commission group
//         for (const commission of uncreditedCommissions) {
//             const { user_id, cryptoname, total_amount, total_bet_amount } = commission;

//             try {
//                 // Update user wallet balance
//                 const updateWalletQuery = `
//                     UPDATE wallet
//                     SET balance = balance + ?
//                     WHERE userId = ? AND cryptoname = ?
//                 `;
                
//                 const walletResult = await new Promise((resolve, reject) => {
//                     connection.query(updateWalletQuery, [total_amount, user_id, cryptoname], (err, results) => {
//                         if (err) return reject(err);
//                         resolve(results);
//                     });
//                 });

//                 if (walletResult.affectedRows === 0) {
//                     console.warn(`Warning: Wallet entry for user ${user_id} and ${cryptoname} not found. Skipping...`);
//                     continue;
//                 }

//                 // Update usercommissions table
//                 const updateCommissionsQuery = `
//                     INSERT INTO usercommissions (userId, cryptoname, total_commissions, updated_at)
//                     VALUES (?, ?, ?, NOW())
//                     ON DUPLICATE KEY UPDATE 
//                     total_commissions = total_commissions + ?,
//                     updated_at = NOW()
//                 `;
                
//                 await new Promise((resolve, reject) => {
//                     connection.query(updateCommissionsQuery, [
//                         user_id, 
//                         cryptoname, 
//                         total_amount, 
//                         total_amount
//                     ], (err, results) => {
//                         if (err) return reject(err);
//                         resolve(results);
//                     });
//                 });

//                 totalUsersUpdated++;
//                 totalCommissionAmount += parseFloat(total_amount);

//                 console.log(` Credited ${total_amount} ${cryptoname} to user ${user_id} (from ${total_bet_amount} total bets)`);

//             } catch (error) {
//                 console.error(`Error processing commission for user ${user_id}:`, error);
//                 // Continue with next user instead of failing entire job
//             }
//         }

//         // Mark all uncredited commissions as credited (set credited = 1)
//         const markCreditedQuery = `
//             UPDATE referralcommissionhistory
//             SET credited = 1
//             WHERE credited = 0
//         `;
        
//         const markedResult = await new Promise((resolve, reject) => {
//             connection.query(markCreditedQuery, (err, results) => {
//                 if (err) return reject(err);
//                 resolve(results);
//             });
//         });

//         // Commit transaction
//         await new Promise((resolve, reject) => {
//             connection.commit(err => {
//                 if (err) return reject(err);
//                 resolve();
//             });
//         });

//         console.log(' Commissions credited successfully!');
//         console.log(` Summary: ${totalUsersUpdated} users updated, ${markedResult.affectedRows} commission records marked as credited`);
//         console.log(` Total commission amount processed: ${totalCommissionAmount}`);

//     } catch (error) {
//         console.error(' Error during commission crediting job:', error);
//         await new Promise(resolve => {
//             connection.rollback(() => resolve());
//         });
//         throw error;
//     }
// }

// // Schedule cron job to run daily at 12:00 AM IST (same time as betting commission calculation)
// cron.schedule('1 0 * * *', creditCommissions, {
//     scheduled: true,
//     timezone: 'Asia/Kolkata'
// });

// console.log('Commission crediting scheduler loaded. Cron job scheduled for 12:01 AM IST daily.');

// // Export the function for manual execution
// module.exports = { creditCommissions };