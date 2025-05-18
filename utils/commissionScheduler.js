const cron = require('node-cron');
const connection = require('../config/db');

cron.schedule('30 18 * * *', async () => {
    console.log('Starting commission crediting job at 12:00 AM IST...');

    try {
        // Start a transaction
        await new Promise((resolve, reject) => {
            connection.beginTransaction(err => {
                if (err) return reject(err);
                resolve();
            });
        });

        // Find all uncredited commissions
        const uncreditedCommissionsQuery = `
            SELECT user_id, cryptoname, SUM(amount) as total_amount
            FROM ReferralCommissionHistory
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

        // Credit commissions to wallets and update UserCommissions
        for (const commission of uncreditedCommissions) {
            const { user_id, cryptoname, total_amount } = commission;

            // Update wallet balance
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

            // Update UserCommissions
            const updateCommissionsQuery = `
                INSERT INTO UserCommissions (userId, cryptoname, total_commissions)
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

        // Mark commissions as credited
        const markCreditedQuery = `
            UPDATE ReferralCommissionHistory
            SET credited = TRUE
            WHERE credited = FALSE
        `;
        await new Promise((resolve, reject) => {
            connection.query(markCreditedQuery, (err, results) => {
                if (err) return reject(err);
                resolve(results);
            });
        });

        // Commit the transaction
        await new Promise((resolve, reject) => {
            connection.commit(err => {
                if (err) return reject(err);
                resolve();
            });
        });

        console.log('Commissions credited successfully at 12:00 AM IST.');
    } catch (error) {
        console.error('Error during commission crediting job:', error);
        // Rollback the transaction on error
        await new Promise((resolve) => {
            connection.rollback(() => resolve());
        });
    }
}, {
    scheduled: true,
    timezone: "UTC"
});

console.log('Commission crediting scheduler started. Job will run at 12:00 AM IST daily.');