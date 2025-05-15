const cron = require('node-cron');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'your_username',
    password: 'your_password',
    database: 'your_database',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Schedule the job to run at 12:00 AM IST every day
// Cron syntax: 'second minute hour dayOfMonth month dayOfWeek'
cron.schedule('30 18 * * *', async () => {
    console.log('Starting commission crediting job at 12:00 AM IST...');
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const uncreditedCommissionsQuery = `
            SELECT user_id, cryptoname, SUM(amount) as total_amount
            FROM ReferralCommissionHistory
            WHERE credited = FALSE
            GROUP BY user_id, cryptoname
        `;
        const uncreditedCommissions = await connection.query(uncreditedCommissionsQuery);

        if (uncreditedCommissions[0].length === 0) {
            console.log('No uncredited commissions to process.');
            await connection.commit();
            return;
        }

        for (const commission of uncreditedCommissions[0]) {
            const { user_id, cryptoname, total_amount } = commission;

            const updateWalletQuery = `
                UPDATE wallet
                SET balance = balance + ?
                WHERE userId = ? AND cryptoname = ?
            `;
            const walletResult = await connection.query(updateWalletQuery, [total_amount, user_id, cryptoname]);

            if (walletResult[0].affectedRows === 0) {
                throw new Error(`Wallet entry for user ${user_id} and ${cryptoname} not found.`);
            }

           const updateCommissionsQuery = `
                INSERT INTO UserCommissions (userId, cryptoname, total_commissions)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE total_commissions = total_commissions + ?
            `;
            await connection.query(updateCommissionsQuery, [user_id, cryptoname, total_amount, total_amount]);
        }

       const markCreditedQuery = `
            UPDATE ReferralCommissionHistory
            SET credited = TRUE
            WHERE credited = FALSE
        `;
        await connection.query(markCreditedQuery);

        await connection.commit();
        console.log('Commissions credited successfully at 12:00 AM IST.');

    } catch (error) {
        console.error('Error during commission crediting job:', error);
        if (connection) {
            await connection.rollback();
        }
    } finally {
        if (connection) {
            connection.release();
        }
    }
}, {
    scheduled: true,
    timezone: "UTC"
});

console.log('Commission crediting scheduler started. Job will run at 12:00 AM IST daily.');