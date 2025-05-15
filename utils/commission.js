const REBATE_LEVELS = [
    { min: 0, max: 5000, level: 1 },
    { min: 5000, max: 10000, level: 2 },
    { min: 10000, max: 20000, level: 3 },
    { min: 20000, max: 50000, level: 4 },
    { min: 50000, max: 100000, level: 5 },
    { min: 100000, max: Infinity, level: 6 }
];

const COMMISSION_RATES = {
    1: [0.006, 0.0018, 0.00054, 0.00016, 0.000048, 0.000014],
    2: [0.007, 0.0024, 0.00085, 0.0003, 0.0001, 0.000036],
    3: [0.0075, 0.0028, 0.001, 0.00039, 0.00014, 0.000055],
    4: [0.008, 0.0032, 0.0012, 0.00051, 0.0002, 0.000081],
    5: [0.0085, 0.0036, 0.0015, 0.00065, 0.00027, 0.00011],
    6: [0.0085, 0.0036, 0.0015, 0.00065, 0.00027, 0.00011]
};

// Simplified conversion rates to INR (for rebate level calculation only)
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

function determineRebateLevel(totalFirstDepositsInINR) {
    for (const range of REBATE_LEVELS) {
        if (totalFirstDepositsInINR >= range.min && totalFirstDepositsInINR < range.max) {
            return range.level;
        }
    }
    return 1;
}

async function calculateCommissions(firstDeposit, referrerId, cryptoname, connection) {
    const commissions = [];
    let currentReferrerId = referrerId;
    let level = 1;

    while (currentReferrerId && level <= 6) {
        // Sum first deposits of level 1 referrals from the deposits table, converted to INR
        const totalDepositsQuery = `
            SELECT d.amount, d.cryptoname
            FROM deposits d
            JOIN referrals r ON d.userId = r.referred_id
            WHERE r.referrer_id = ? AND r.level = 1 AND d.is_first = 1
        `;
        const depositResults = await new Promise((resolve, reject) => {
            connection.query(totalDepositsQuery, [currentReferrerId], (err, results) => {
                if (err) return reject(err);
                resolve(results);
            });
        });

        // Convert all first deposits to INR for rebate level calculation
        let totalFirstDepositsInINR = 0;
        for (const deposit of depositResults) {
            const amount = deposit.amount || 0;
            const crypto = deposit.cryptoname;
            const rate = CRYPTO_TO_INR_RATES[crypto] || 0;
            totalFirstDepositsInINR += amount * rate;
        }

        const rebateLevel = determineRebateLevel(totalFirstDepositsInINR);
        const rate = COMMISSION_RATES[rebateLevel][level - 1] || 0;
        const commission = firstDeposit * rate;

        commissions.push({
            userId: currentReferrerId,
            level: level,
            rebateLevel: rebateLevel,
            commission: commission,
            cryptoname: cryptoname
        });

        const nextReferrerQuery = "SELECT referred_by FROM users WHERE id = ?";
        const [nextReferrerResult] = await new Promise((resolve, reject) => {
            connection.query(nextReferrerQuery, [currentReferrerId], (err, results) => {
                if (err) return reject(err);
                resolve(results);
            });
        });

        currentReferrerId = nextReferrerResult?.referred_by || null;
        level++;
    }

    return commissions;
}

module.exports = {
    determineRebateLevel,
    calculateCommissions
};