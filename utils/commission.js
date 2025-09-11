const cron = require('node-cron');
const connection = require('../config/db');
  
// Rebate levels based on total first deposits (in INR equivalent)
const REBATE_LEVELS = [
    { min: 0, max: 5000, level: 1 },
    { min: 5000, max: 10000, level: 2 },
    { min: 10000, max: 20000, level: 3 },
    { min: 20000, max: 50000, level: 4 },
    { min: 50000, max: 100000, level: 5 },
    { min: 100000, max: Infinity, level: 6 }
];

// Commission rates by rebate level and referral level
const COMMISSION_RATES = {
    1: [0.006, 0.0018, 0.00054, 0.00016, 0.000048, 0.000014],
    2: [0.007, 0.0024, 0.00085, 0.0003, 0.0001, 0.000036],
    3: [0.0075, 0.0028, 0.001, 0.00039, 0.00014, 0.000055],
    4: [0.008, 0.0032, 0.0012, 0.00051, 0.0002, 0.000081],
    5: [0.0085, 0.0036, 0.0015, 0.00065, 0.00027, 0.00011]
};

// Crypto to INR conversion rates
const CRYPTO_TO_INR_RATES = {
    'BTC': 5000000,
    'ETH': 200000,
    'LTC': 10000,
    'USDT': 85,
    'SOL': 15000,
    'DOGE': 50,
    'BCH': 40000,
    'XRP': 100,
    'TRX': 10,
    'EOS': 500,
    'INR': 1,
    'CP': 1
};

/**
 * Determine rebate level based on total betting amount in INR
 */
function determineRebateLevel(totalBettingInINR) {
    for (const range of REBATE_LEVELS) {
        if (totalBettingInINR >= range.min && totalBettingInINR < range.max) {
            return range.level;
        }
    }
    return 1;
}

/**
 * Get today's date range for querying
 */
function getTodayDateRange() {
    const today = new Date();

    const startDate = new Date(today);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(today);
    endDate.setHours(23, 59, 59, 999);

    return { startDate, endDate };
}

/**
 * Fetch daily betting amounts per user from all betting tables for today
 */
async function getDailyBettingAmounts(startDate, endDate) {
    const userBettingAmounts = {};

    // Query all betting tables
    const queries = [
        // INR bets
        {
            query: `
                SELECT user_id, SUM(amount) as total_amount, 'INR' as cryptoname
                FROM bets 
                WHERE placed_at >= ? AND placed_at <= ? AND status = 'processed'
                GROUP BY user_id
            `,
            params: [startDate, endDate]
        },
        // TRX bets
        {
            query: `
                SELECT user_id, SUM(amount) as total_amount, 'INR' as cryptoname
                FROM bets_trx 
                WHERE created_at >= ? AND created_at <= ? AND status != 'pending'
                GROUP BY user_id
            `,
            params: [startDate, endDate]
        },
        // 5D bets
        {
            query: `
                SELECT user_id, SUM(amount) as total_amount, 'INR' as cryptoname
                FROM bets_5d 
                WHERE created_at >= ? AND created_at <= ? AND status != 'pending'
                GROUP BY user_id
            `,
            params: [startDate, endDate]
        },
        // API turnover (third-party bets)
        {
            query: `
                SELECT login as user_id, SUM(bet) as total_amount, 'INR' as cryptoname
                FROM api_turnover 
                WHERE created_at >= ? AND created_at <= ? 
                GROUP BY login
            `,
            params: [startDate, endDate]
        },
           //huidu_txn
          {
    query: `
        SELECT userid as user_id, 
               SUM(ABS(CAST(bet_amount AS DECIMAL(20,8)))) as total_amount, 
               currency_code as cryptoname
        FROM huidu_txn 
        WHERE created_at >= ? AND created_at <= ? AND status = 'success'
        GROUP BY userid, currency_code
    `,
    params: [startDate, endDate]
}

    ];

    // Execute all queries
    for (const queryObj of queries) {
        try {
            const results = await new Promise((resolve, reject) => {
                connection.query(queryObj.query, queryObj.params, (err, results) => {
                    if (err) return reject(err);
                    resolve(results);
                });
            });

            // Aggregate results by user and crypto
            for (const row of results) {
                const { user_id, total_amount, cryptoname } = row;
                if (!user_id) continue; // Skip if user_id is null/undefined

                if (!userBettingAmounts[user_id]) {
                    userBettingAmounts[user_id] = {};
                }
                if (!userBettingAmounts[user_id][cryptoname]) {
                    userBettingAmounts[user_id][cryptoname] = 0;
                }
                userBettingAmounts[user_id][cryptoname] += parseFloat(total_amount || 0);
            }
        } catch (error) {
            console.error(`Error executing query: ${queryObj.query}`, error);
            throw error;
        }
    }

    return userBettingAmounts;
}

/**
 * Calculate commissions for a user's betting amount through referral chain
 */
async function calculateBettingCommissions(userId, bettingAmount, cryptoname, connection) {
    const commissions = [];

    try {
        // Get user's referrer
        const userQuery = "SELECT referred_by FROM users WHERE id = ?";
        const userResults = await new Promise((resolve, reject) => {
            connection.query(userQuery, [userId], (err, results) => {
                if (err) return reject(err);
                resolve(results);
            });
        });

        if (!userResults || userResults.length === 0 || !userResults[0].referred_by) {
            return commissions; // No referrer found
        }

        let currentReferrerId = userResults[0].referred_by;
        let level = 1;

        // Traverse up to 6 levels of referral chain
        while (currentReferrerId && level <= 6) {
            try {
                // Get today's betting amount for the referrer
              // Normal range for most tables
const { startDate, endDate } = getTodayDateRange(); // this can stay UTC-based

// Special IST range for huidu_txn
const moment = require("moment-timezone");
const startDateIST = moment.tz("Asia/Kolkata").startOf("day").format("YYYY-MM-DD HH:mm:ss");
const endDateIST = moment.tz("Asia/Kolkata").endOf("day").format("YYYY-MM-DD HH:mm:ss");

const todayBettingQuery = `
    SELECT COALESCE(
        (SELECT SUM(amount) FROM bets WHERE user_id = ? AND status = 'processed' AND placed_at BETWEEN ? AND ?) +
        (SELECT SUM(amount) FROM bets_trx WHERE user_id = ? AND status != 'pending' AND created_at BETWEEN ? AND ?) +
        (SELECT SUM(amount) FROM bets_5d WHERE user_id = ? AND status != 'pending' AND created_at BETWEEN ? AND ?) +
        (SELECT SUM(bet) FROM api_turnover WHERE login = ? AND created_at BETWEEN ? AND ?) +
        (SELECT SUM(ABS(bet_amount)) FROM huidu_txn WHERE userid = ? AND status = 'success' AND created_at BETWEEN ? AND ?),
        0
    ) as total_betting
`;

                const [bettingResult] = await new Promise((resolve, reject) => {
                    connection.query(
                        todayBettingQuery,
                        [
                                currentReferrerId, startDate, endDate,
                                currentReferrerId, startDate, endDate,
                                currentReferrerId, startDate, endDate,
                                currentReferrerId.toString(), startDate, endDate,
                                currentReferrerId.toString(), startDateIST, endDateIST // special case
                        ],
                        (err, results) => {
                            if (err) return reject(err);
                            resolve(results);
                        }
                    );
                });

                const todayBettingAmount = parseFloat(bettingResult.total_betting) || 0;
                const rebateLevel = determineRebateLevel(todayBettingAmount);
                const rate = COMMISSION_RATES[rebateLevel][level - 1] || 0;
                const commission = bettingAmount * rate;

                if (commission > 0) {
                    commissions.push({
                        userId: currentReferrerId,
                        level: level,
                        rebateLevel: rebateLevel,
                        commission: commission,
                        cryptoname: cryptoname,
                        originalBettorId: userId,
                        referrerTodayBetting: todayBettingAmount
                    });
                }

                // Get next level referrer
                const nextReferrerQuery = "SELECT referred_by FROM users WHERE id = ?";
                const nextReferrerResults = await new Promise((resolve, reject) => {
                    connection.query(nextReferrerQuery, [currentReferrerId], (err, results) => {
                        if (err) return reject(err);
                        resolve(results);
                    });
                });

                currentReferrerId = (nextReferrerResults && nextReferrerResults.length > 0) ?
                    nextReferrerResults[0].referred_by : null;
                level++;
            } catch (error) {
                console.error(`Error calculating commission for referrer ${currentReferrerId}, level ${level}:`, error);
                break;
            }
        }
    } catch (error) {
        console.error(`Error in calculateBettingCommissions for user ${userId}:`, error);
    }

    return commissions;
}

/**
 * Main function to process daily betting commissions for today
 */
async function processDailyBettingCommissions() {
    console.log('Starting daily betting commission calculation for today...');

    try {
        // Start transaction
        await new Promise((resolve, reject) => {
            connection.beginTransaction(err => {
                if (err) return reject(err);
                resolve();
            });
        });

        const { startDate, endDate } = getTodayDateRange();
        console.log(`Processing bets from ${startDate.toISOString()} to ${endDate.toISOString()}`);

        // Get all user betting amounts for today
        const userBettingAmounts = await getDailyBettingAmounts(startDate, endDate);

        if (Object.keys(userBettingAmounts).length === 0) {
            console.log('No betting activity found for today.');
            await new Promise((resolve, reject) => {
                connection.commit(err => {
                    if (err) return reject(err);
                    resolve();
                });
            });
            return;
        }

        console.log(`Found betting activity for ${Object.keys(userBettingAmounts).length} users`);

        let totalCommissionsProcessed = 0;
        let totalUsersProcessed = 0;

        // Process each user's betting amounts
        for (const [userId, cryptoAmounts] of Object.entries(userBettingAmounts)) {
            try {
                // Validate userId
                const userIdInt = parseInt(userId);
                if (isNaN(userIdInt)) {
                    console.error(`Invalid userId: ${userId}, skipping...`);
                    continue;
                }

                for (const [cryptoname, bettingAmount] of Object.entries(cryptoAmounts)) {
                    if (bettingAmount <= 0) continue;

                    console.log(`Processing ${cryptoname} ${bettingAmount} betting amount for user ${userIdInt}`);

                    // Calculate commissions for this user's betting amount
                    const commissions = await calculateBettingCommissions(
                        userIdInt,
                        bettingAmount,
                        cryptoname,
                        connection
                    );

                    // Insert commission records
                    for (const commission of commissions) {
                        const logQuery = `
                            INSERT INTO referralcommissionhistory 
                            (user_id, referred_user_id, level, rebate_level, amount, deposit_amount, cryptoname, credited, totalBet, created_at)
                            VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, NOW())
                        `;

                        await new Promise((resolve, reject) => {
                            connection.query(logQuery, [
                                commission.userId,
                                commission.originalBettorId,
                                commission.level,
                                commission.rebateLevel,
                                commission.commission,

                                commission.cryptoname,
                                bettingAmount // totalBet column
                            ], (err, results) => {
                                if (err) return reject(err);
                                resolve(results);
                            });
                        });

                        totalCommissionsProcessed++;
                        console.log(`Commission ${commission.commission} ${cryptoname} recorded for user ${commission.userId} (level ${commission.level})`);
                    }
                }
                totalUsersProcessed++;
            } catch (error) {
                console.error(`Error processing user ${userId}:`, error);
                // Continue with next user instead of failing entire job
            }
        }

        // Commit transaction
        await new Promise((resolve, reject) => {
            connection.commit(err => {
                if (err) return reject(err);
                resolve();
            });
        });

        console.log(`Daily betting commission calculation completed successfully!`);
        console.log(`Processed: ${totalUsersProcessed} users, ${totalCommissionsProcessed} commission entries created`);

    } catch (error) {
        console.error('Error during daily betting commission calculation:', error);
        await new Promise(resolve => {
            connection.rollback(() => resolve());
        });
        throw error;
    }
}

// Schedule cron job to run daily at 00:00 (11:59 PM)
// cron.schedule('29 18 * * *', processDailyBettingCommissions, {
//   scheduled: true,
//   timezone: 'UTC'
// });

console.log('Daily betting commission scheduler loaded. Cron job scheduled for 12:00 AM IST daily.');

// Export the function for manual execution
module.exports = {
    processDailyBettingCommissions,
    getDailyBettingAmounts,
    calculateBettingCommissions
};



























// const REBATE_LEVELS = [
//     { min: 0, max: 5000, level: 1 },
//     { min: 5000, max: 10000, level: 2 },
//     { min: 10000, max: 20000, level: 3 },
//     { min: 20000, max: 50000, level: 4 },
//     { min: 50000, max: 100000, level: 5 },
//     { min: 100000, max: Infinity, level: 6 }
// ];

// const COMMISSION_RATES = {
//     1: [0.006, 0.0018, 0.00054, 0.00016, 0.000048, 0.000014],
//     2: [0.007, 0.0024, 0.00085, 0.0003, 0.0001, 0.000036],
//     3: [0.0075, 0.0028, 0.001, 0.00039, 0.00014, 0.000055],
//     4: [0.008, 0.0032, 0.0012, 0.00051, 0.0002, 0.000081],
//     5: [0.0085, 0.0036, 0.0015, 0.00065, 0.00027, 0.00011]    
// };

// // Simplified conversion rates to INR (for rebate level calculation only)
// const CRYPTO_TO_INR_RATES = {
//     'BTC': 5000000,
//     'ETH': 200000,
//     'LTC': 10000,
//     'USDT': 85,
//     'SOL': 15000,
//     'DOGE': 50,
//     'BCH': 40000,
//     'XRP': 100,
//     'TRX': 10,
//     'EOS': 500,
//     'INR': 1,
//     'CP': 1
// };

// function determineRebateLevel(totalFirstDepositsInINR) {
//     for (const range of REBATE_LEVELS) {
//         if (totalFirstDepositsInINR >= range.min && totalFirstDepositsInINR < range.max) {
//             return range.level;
//         }
//     }
//     return 1;
// }

// async function calculateCommissions(firstDeposit, referrerId, cryptoname, connection) {
//     const commissions = [];
//     let currentReferrerId = referrerId;
//     let level = 1;

//     while (currentReferrerId && level <= 6) {
//         // Sum first deposits of level 1 referrals from the deposits table, converted to INR
//         const totalDepositsQuery = `
//             SELECT d.amount, d.cryptoname
//             FROM deposits d
//             JOIN referrals r ON d.userId = r.referred_id
//             WHERE r.referrer_id = ? AND r.level = 1 AND d.is_first = 1
//         `;
//         const depositResults = await new Promise((resolve, reject) => {
//             connection.query(totalDepositsQuery, [currentReferrerId], (err, results) => {
//                 if (err) return reject(err);
//                 resolve(results);
//             });
//         });

//         // Convert all first deposits to INR for rebate level calculation
//         let totalFirstDepositsInINR = 0;
//         for (const deposit of depositResults) {
//             const amount = deposit.amount || 0;
//             const crypto = deposit.cryptoname;
//             const rate = CRYPTO_TO_INR_RATES[crypto] || 0;
//             totalFirstDepositsInINR += amount * rate;
//         }

//         const rebateLevel = determineRebateLevel(totalFirstDepositsInINR);
//         const rate = COMMISSION_RATES[rebateLevel][level - 1] || 0;
//         const commission = firstDeposit * rate;

//         commissions.push({
//             userId: currentReferrerId,
//             level: level,
//             rebateLevel: rebateLevel,
//             commission: commission,
//             cryptoname: cryptoname
//         });

//         const nextReferrerQuery = "SELECT referred_by FROM users WHERE id = ?";
//         const [nextReferrerResult] = await new Promise((resolve, reject) => {
//             connection.query(nextReferrerQuery, [currentReferrerId], (err, results) => {
//                 if (err) return reject(err);
//                 resolve(results);
//             });
//         });

//         currentReferrerId = nextReferrerResult?.referred_by || null;
//         level++;
//     }

//     return commissions;
// }

// module.exports = {
//     determineRebateLevel,
//     calculateCommissions
// };
