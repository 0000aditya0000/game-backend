const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const connection = require('../config/db');
const { createSession } = require("../utils/session");
const { creditCommissions } = require('../utils/commissionScheduler');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const momentTz = require('moment-timezone');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const authenticateToken = require('../middleware/authenticateToken');
const { insertGameplayTracking } = require('../utils/gameplay');
const { processDailyBettingCommissions } = require('../utils/commission');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

//========== User registration modified ==========
// router.post('/register', async (req, res) => {
//   const { name, username, email, phoneNumber, referalCode, password, myReferralCode, kyc_note } = req.body;

//   // Validate mandatory fields
//   if (!phoneNumber || !myReferralCode || !password) {
//     return res.status(400).json({ 
//       error: 'Phone number, referral code, and password are required fields' 
//     });
//   }

//   try {
//     // Check if phone number already exists
//     const phoneCheckQuery = "SELECT id FROM users WHERE phone = ?";
//     const [existingUser] = await new Promise((resolve, reject) => {
//       connection.query(phoneCheckQuery, [phoneNumber], (err, results) => {
//         if (err) return reject(err);
//         resolve(results);
//       });
//     });

//     if (existingUser) {
//       return res.status(400).json({ 
//         error: 'Phone number is already registered' 
//       });
//     }

//     const hashedPassword = await bcrypt.hash(password, 10);

//     // Step 1: Get referred user's ID (if referral code is provided)
//     let referredById = null;

//     if (referalCode) {
//       const refQuery = "SELECT id FROM users WHERE my_referral_code = ?";
//       const [refResults] = await new Promise((resolve, reject) => {
//         connection.query(refQuery, [referalCode], (err, results) => {
//           if (err) return reject(err);
//           resolve(results);
//         });
//       });

//       if (refResults && refResults.id) {
//         referredById = refResults.id;
//       } else {
//         return res.status(400).json({ error: 'Invalid referral code' });
//       }
//     }

//     // Step 2: Insert the user with optional fields
//     const query = `
//       INSERT INTO users (username, name, email, password, phone, my_referral_code, referred_by, kyc_note)
//       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
//     `;
//     connection.query(query, [
//       username || null, 
//       name || null, 
//       email || null, 
//       hashedPassword, 
//       phoneNumber, 
//       myReferralCode, 
//       referredById, 
//       kyc_note || null
//     ], async (err, results) => {
//       if (err) {
//         console.log(err);
//         return res.status(500).json({ error: 'Database error' });
//       }

//       const userId = results.insertId;
//       if (referredById) {
//         await propagateReferral(userId, referredById);
//       }
//       // Step 3: Create wallet entries
//       const cryptocurrencies = ['BTC', 'ETH', 'LTC', 'USDT', 'SOL', 'DOGE', 'BCH', 'XRP', 'TRX', 'EOS', 'INR', 'CP'];
//       const walletValues = cryptocurrencies.map(crypto => [userId, 0, crypto]);

//       const walletQuery = "INSERT INTO wallet (userId, balance, cryptoname) VALUES ?";
//       connection.query(walletQuery, [walletValues], (err, walletResults) => {
//         if (err) {
//           console.log(err);
//           return res.status(500).json({ error: 'Error creating wallet entries' });
//         }

//         res.status(201).json({
//           message: 'User registered and wallet initialized successfully',
//           referral_code: myReferralCode,
//           referred_by: referredById
//         });
//       });
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({ error: 'Error registering user' });
//   }
// });
router.post('/deposit', async (req, res) => {
  const { userId, amount, cryptoname, orderid } = req.body;


  const validCryptos = ['BTC', 'ETH', 'LTC', 'USDT', 'SOL', 'DOGE', 'BCH', 'XRP', 'TRX', 'EOS', 'INR', 'CP'];

  // Input validations
  if (!userId || !amount || amount <= 0 || !cryptoname || !orderid) {
    return res.status(400).json({ error: 'userId, amount, cryptoname, and orderid are required.' });
  }

  if (!validCryptos.includes(cryptoname)) {
    return res.status(400).json({ error: 'Invalid cryptoname.' });
  }

  try {
    // Start transaction
    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Get user info
    const userQuery = "SELECT id, referred_by FROM users WHERE id = ?";
    const [userResult] = await new Promise((resolve, reject) => {
      connection.query(userQuery, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    if (!userResult) {
      throw new Error('User not found');
    }

    // Check for first deposit
    const depositCheckQuery = "SELECT id FROM deposits WHERE userId = ? AND cryptoname = ? LIMIT 1";
    const [depositResult] = await new Promise((resolve, reject) => {
      connection.query(depositCheckQuery, [userId, cryptoname], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    const isFirstDeposit = !depositResult;
    let cashbackAmount = 0;
 

// Step: Give 200% cashback if INR and first deposit
// if (isFirstDeposit && cryptoname === 'INR') {
//    cashbackAmount = amount * 2;

//   const cashbackQuery = `
//     UPDATE wallet
//     SET balance = balance + ?
//     WHERE userId = ? AND cryptoname = 'INR'
//   `;

//   const cashbackResult = await new Promise((resolve, reject) => {
//     connection.query(cashbackQuery, [cashbackAmount, userId], (err, results) => {
//       if (err) return reject(err);
//       resolve(results);
//     });
//   });

//   if (cashbackResult.affectedRows === 0) {
//     throw new Error(`Failed to credit INR cashback to wallet.`);
//   }
// }


    // Update wallet
    // const updateWalletQuery = `
    //   UPDATE wallet
    //   SET balance = balance + ?
    //   WHERE userId = ? AND cryptoname = ?
    // `;
    // const walletResult = await new Promise((resolve, reject) => {
    //   connection.query(updateWalletQuery, [amount, userId, cryptoname], (err, results) => {
    //     if (err) return reject(err);
    //     resolve(results);
    //   });
    // });

    // if (walletResult.affectedRows === 0) {
    //   throw new Error(`Wallet entry for ${cryptoname} not found for the specified userId.`);
    // }

   // Check recharge status before inserting deposit
const rechargeQuery = `
  SELECT date, time, recharge_status 
  FROM recharge 
  WHERE order_id = ? 
  LIMIT 1
`;

const [rechargeResult] = await new Promise((resolve, reject) => {
  connection.query(rechargeQuery, [orderid], (err, results) => {
    if (err) return reject(err);
    resolve(results);
  });
});

if (!rechargeResult) {
  throw new Error('No matching recharge found for this orderId.');
}

if (rechargeResult.recharge_status.toLowerCase() !== 'success') {
  throw new Error('Recharge status is not success, cannot create deposit.');
}

const { date, time } = rechargeResult;

// Insert deposit with recharge date and time
const insertDepositQuery = `
  INSERT INTO deposits (userId, amount, orderid, cryptoname, is_first, date, time)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

const depositInsertResult = await new Promise((resolve, reject) => {
  connection.query(insertDepositQuery, [userId, amount, orderid, cryptoname, isFirstDeposit, date, time], (err, results) => {
    if (err) return reject(err);
    resolve(results);
  });
});

    
    const depositId = depositInsertResult.insertId;
      // Insert gameplay tracking if INR
    if (cryptoname === 'INR') {
      await insertGameplayTracking(userId, depositId, amount);
    }

    // // Handle referral commissions if first deposit
    // let commissionsDistributed = false;
    // if (isFirstDeposit) {
    //   const referrerId = userResult.referred_by || null;
    //   if (referrerId) {
    //     const commissions = await calculateCommissions(amount, referrerId, cryptoname, connection);
    //     for (const commission of commissions) {
    //       const logQuery = `
    //         INSERT INTO referralcommissionhistory 
    //         (user_id, referred_user_id, level, rebate_level, amount, deposit_amount, cryptoname, credited)
    //         VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)
    //       `;
    //       await new Promise((resolve, reject) => {
    //         connection.query(logQuery, [
    //           commission.userId,
    //           userId,
    //           commission.level,
    //           commission.rebateLevel,
    //           commission.commission,
    //           amount,
    //           cryptoname
    //         ], (err, results) => {
    //           if (err) return reject(err);
    //           resolve(results);
    //         });
    //       });
    //     }
    //     commissionsDistributed = true;
    //   }
    // }

    // Commit transaction
    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) return reject(err);
        resolve();
      });
    });

    const formattedDate = momentTz(date).tz("Asia/Kolkata").format("YYYY-MM-DD");
   const formattedTime = time; 

    res.json({
      message: `Deposit in ${cryptoname} processed successfully`,
      userId,
      cryptoname,
      amount,
      orderid,
      isFirstDeposit,
      cashbackAmount,
      date: formattedDate,
      time: formattedTime,
      note: 'Commissions will be credited to wallets at 12:00 AM IST' 
    });

  } catch (error) {
    console.error(`Error processing deposit in ${cryptoname}:`, error);
    await new Promise(resolve => connection.rollback(() => resolve()));
    res.status(error.message === 'User not found' || error.message.includes('Wallet entry') ? 404 : 500).json({ error: error.message || 'Internal server error' });
  }
});

router.post('/register', async (req, res) => {
  const { name, username, email, phoneNumber, referalCode, password, myReferralCode } = req.body;

  // Step 1: Validate mandatory fields
  if (!phoneNumber || !myReferralCode || !password) {
    return res.status(400).json({
      error: 'Phone number, referral code, and password are required fields'
    });
  }

  try {
    // Step 2: Check if phone already exists
    const phoneCheckQuery = "SELECT id FROM users WHERE phone = ?";
    const [existingUser] = await new Promise((resolve, reject) => {
      connection.query(phoneCheckQuery, [phoneNumber], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Phone number is already registered' });
    }

    // Step 3: Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Step 4: Get referred user's ID if referral code is provided
    let referredById = null;

    if (referalCode) {
      const refQuery = "SELECT id FROM users WHERE my_referral_code = ?";
      const [refResults] = await new Promise((resolve, reject) => {
        connection.query(refQuery, [referalCode], (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });

      if (refResults && refResults.id) {
        referredById = refResults.id;
      } else {
        return res.status(400).json({ error: 'Invalid referral code' });
      }
    }

    // Step 5: Insert new user
    const query = `
      INSERT INTO users (username, name, email, password, phone, my_referral_code, referred_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    connection.query(query, [
      username || null,
      name || null,
      email || null,
      hashedPassword,
      phoneNumber,
      myReferralCode,
      referredById
    ], async (err, results) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ error: 'Database error during user registration' });
      }

      const userId = results.insertId;

      // Step 6: If referral exists, propagate to commission/referral system
      if (referredById) {
        await propagateReferral(userId, referredById); // Assuming this function exists
      }

      // Step 7: Create wallet entries
      const cryptocurrencies = ['BTC', 'ETH', 'LTC', 'USDT', 'SOL', 'DOGE', 'BCH', 'XRP', 'TRX', 'EOS', 'INR', 'CP'];
      const walletValues = cryptocurrencies.map(crypto => [userId, 0, crypto]);

      const walletQuery = "INSERT INTO wallet (userId, balance, cryptoname) VALUES ?";
      connection.query(walletQuery, [walletValues], (err, walletResults) => {
        if (err) {
          console.log(err);
          return res.status(500).json({ error: 'Error creating wallet entries' });
        }

        res.status(201).json({
          message: 'User registered and wallet initialized successfully',
          referral_code: myReferralCode,
          referred_by: referredById
        });
      });
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});


const propagateReferral = async (newUserId, referrerId) => {
  let currentReferrer = referrerId;
  let level = 1;

  while (currentReferrer && level <= 5) {
    // Insert the referral record for this level
    await new Promise((resolve, reject) => {
      connection.query("INSERT INTO referrals (referrer_id, referred_id, level) VALUES (?, ?, ?)", [
        currentReferrer,
        newUserId,
        level,
      ], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    // Get the next referrer in the chain (the person who referred the current referrer)
    const nextReferrerResult = await new Promise((resolve, reject) => {
      connection.query("SELECT referred_by FROM users WHERE id = ?", [currentReferrer], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    // If no next referrer or we've reached level 5, break the chain
    if (!nextReferrerResult || nextReferrerResult.length === 0 || !nextReferrerResult[0].referred_by) {
      break;
    }

    // Move up the referral chain
    currentReferrer = nextReferrerResult[0].referred_by;
    level++;
  }
};




// User login
// router.post('/login', async (req, res) => {
//   // Destructure only email and password from the request body
//   const { email, password } = req.body;

//   // Log the received email/username/phone and password (for debugging)
//   console.log('Attempting login with:', { identifier: email, passwordProvided: !!password });

//   // Check if both email/username/phone value and password are provided
//   if (!email || !password) {
//     console.log('Login failed: Missing identifier or password'); // Log failure reason
//     return res.status(400).json({ error: 'Email/Username/phone and password are required' });
//   }

//   try {
//     // Query to find the user by matching the provided value against email, username, OR phone
//     const query = "SELECT * FROM users WHERE email = ? OR username = ? OR phone = ?";
//     connection.query(query, [email, email, email], async (err, results) => {
//       if (err) return res.status(500).json({ error: 'Database query error' });
//       if (results.length === 0) return res.status(404).json({ error: 'User not found' });

//       const user = results[0];


//      //check before comparing password
//       if (user.is_login_disabled) {
//         return res.status(403).json({ error: 'Your login has been disabled by admin' });
//          }

//     const isMatch = await bcrypt.compare(password, user.password);
//       if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

//       // Create session (deletes old one and inserts new one)
//       const token = await createSession(user.id);

//       // Fetch wallet details for the logged-in user
//       const walletQuery = "SELECT * FROM wallet WHERE userId = ?";
//       connection.query(walletQuery, [user.id], (err, walletResults) => {
//         if (err) return res.status(500).json({ error: 'Error fetching wallet data' });

//         // Send the user profile and wallet data in the response
//         res.json({
//           token,
//           user: {
//             id: user.id,
//             username: user.username,
//             email: user.email,
//             phone: user.phone,
//             dob: user.dob,
//             referalCode: user.my_referral_code
//           },
//           wallet: walletResults
//         });
//       });
//     });
//   } catch (error) {
//     console.error('Unexpected error during login:', error); // Log unexpected error
//     res.status(500).json({ error: 'Error logging in user' });
//   }
// });



//========== login with refresh token ==============
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('Attempting login with:', { identifier: email, passwordProvided: !!password });

  if (!email || !password) {
    console.log('Login failed: Missing identifier or password');
    return res.status(400).json({ error: 'Email/Username/Phone and password are required' });
  }

  try {
    // ----------------- Extract IP -----------------
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;

    // ----------------- Blocked IP check -----------------
    const blockQuery = "SELECT * FROM blocked_ips WHERE ip_address = ?";
    connection.query(blockQuery, [ip], (blockErr, blockResults) => {
      if (blockErr) return res.status(500).json({ error: 'Database error while checking IP' });
      if (blockResults.length > 0) {
        return res.status(403).json({ error: 'Access from this IP is blocked by admin' });
      }

      // ----------------- User check -----------------
      const query = "SELECT * FROM users WHERE email = ? OR username = ? OR phone = ?";
      connection.query(query, [email, email, email], async (err, results) => {
        if (err) return res.status(500).json({ error: 'Database query error' });
        if (results.length === 0) return res.status(404).json({ error: 'User not found' });

        const user = results[0];

        // Password match
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

        // Block login if user is disabled
        if (user.is_login_disabled) {
          return res.status(403).json({ error: 'Your login access has been disabled by admin' });
        }

        // ----------------- Track this login -----------------
        const logQuery = `
          INSERT INTO user_login_logs (user_id, phone, ip_address)
          VALUES (?, ?, ?)
        `;
        connection.query(logQuery, [user.id, user.phone, ip], (logErr) => {
          if (logErr) console.error('Login-log insert failed:', logErr);
        });

        // Generate tokens
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);

        // Store refresh token in DB
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        connection.query(
          'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
          [user.id, refreshToken, expiresAt],
          (err) => {
            if (err) return res.status(500).json({ error: 'Error saving refresh token' });

            // Fetch wallet details
            const walletQuery = "SELECT * FROM wallet WHERE userId = ?";
            connection.query(walletQuery, [user.id], (err, walletResults) => {
              if (err) return res.status(500).json({ error: 'Error fetching wallet data' });

              res.json({
                accessToken,
                refreshToken,
                user: {
                  id: user.id,
                  username: user.username,
                  email: user.email,
                  phone: user.phone,
                  dob: user.dob,
                  referalCode: user.my_referral_code
                },
                wallet: walletResults
              });
            });
          }
        );
      });
    });
  } catch (error) {
    console.error('Unexpected error during login:', error);
    res.status(500).json({ error: 'Error logging in user' });
  }
});


// ======= Generate access token using REFRESH TOKEN =======
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  //  1. Clean up expired refresh tokens
  connection.query(
    'DELETE FROM refresh_tokens WHERE expires_at < NOW()',
    (err) => {
      if (err) console.error('Expired tokens cleanup error:', err);
    }
  );

  // 🔍 2. Check if refresh token exists and is valid in DB
  const query = 'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > NOW()';
  connection.query(query, [refreshToken], (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!results.length) return res.status(403).json({ error: 'Invalid or expired refresh token' });

    let decoded;
    try {
      //  3. Verify the refresh token
      decoded = verifyRefreshToken(refreshToken);
    } catch (err) {
      return res.status(403).json({ error: 'Invalid or expired refresh token' });
    }

    const userId = decoded.id;

    //  4. Fetch user from DB using ID from token
    const userQuery = 'SELECT * FROM users WHERE id = ?';
    connection.query(userQuery, [userId], (err, userResults) => {
      if (err) return res.status(500).json({ error: 'Database error fetching user' });
      if (!userResults.length) return res.status(404).json({ error: 'User not found' });

      const user = userResults[0];

      //  5. Check if user is disabled
      if (user.is_login_disabled) {
        return res.status(403).json({ error: 'Login disabled by admin' });
      }

      //  6. Generate new access token
      const accessToken = generateAccessToken(user);
      res.json({ accessToken });
    });
  });
});


// ============= LOGOUT ====================

router.post('/logout', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  //  Step 1: Check in DB
  connection.query(
    'SELECT * FROM refresh_tokens WHERE token = ?',
    [refreshToken],
    (err, results) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(403).json({ error: 'Invalid refresh token' });
      }

      //  Step 2: Check expiry manually OR using verify()
      try {
        verifyRefreshToken(refreshToken); // throws error if invalid/expired
      } catch (err) {
        return res.status(403).json({ error: 'Expired or invalid token' });
      }

      //  Step 3: Delete from DB if everything is valid
      connection.query(
        'DELETE FROM refresh_tokens WHERE token = ?',
        [refreshToken],
        (err) => {
          if (err) return res.status(500).json({ error: 'Database error during logout' });

          res.json({ message: 'Logged out successfully' });
        }
      );
    }
  );
});

// ======== Get all users' successful withdrawals and deposits in a date range=====
router.get('/report/transactions', async (req, res) => {
  try {
    let { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        message: "Start and end date are required (YYYY-MM-DD)"
      });
    }

    start = `${start} 00:00:00`;
    end = `${end} 23:59:59`;

    // --- DEPOSIT QUERY (with phone) ---
    const depositQuery = `
      SELECT 
        'deposit' AS type,
        d.id,
        d.userId,
        d.amount,
        d.cryptoname,
        d.created_at AS date,
        u.name,
        u.email,
        u.phone
      FROM deposits d
      LEFT JOIN users u ON d.userId = u.id
      WHERE d.cryptoname = 'INR'
        AND d.created_at >= ? AND d.created_at <= ?
      ORDER BY d.created_at DESC
    `;

    // --- WITHDRAWAL QUERY (with phone) ---
    const withdrawalQuery = `
      SELECT 
        'withdrawal' AS type,
        w.id,
        w.userId,
        w.balance AS amount,
        w.cryptoname,
        w.createdOn AS date,
        u.name,
        u.email,
        u.phone
      FROM withdrawl w
      LEFT JOIN users u ON w.userId = u.id
      WHERE w.cryptoname = 'INR'
        AND (w.status = 1 OR w.status = '1')
        AND w.createdOn >= ? AND w.createdOn <= ?
      ORDER BY w.createdOn DESC
    `;

    const [deposits, withdrawals] = await Promise.all([
      new Promise((resolve, reject) => {
        connection.query(depositQuery, [start, end], (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      }),
      new Promise((resolve, reject) => {
        connection.query(withdrawalQuery, [start, end], (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      })
    ]);

    const allTransactions = [...deposits, ...withdrawals].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );

    res.json({
      success: true,
      start_date: start,
      end_date: end,
      total_deposits: deposits.length,
      total_withdrawals: withdrawals.length,
      total_transactions: allTransactions.length,
      transactions: allTransactions.map(txn => ({
        ...txn,
        name: txn.name || 'Unknown User',
        email: txn.email || 'N/A',
        phone: txn.phone || 'N/A'
      }))
    });

  } catch (error) {
    console.error('Error generating transaction report:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating transaction report',
      error: error.message
    });
  }
});


router.get('/statistics', async (req, res) => {
  try {
    const dummyActivePlayers = 15000;
    const dummyPrizePool = 100000;
    const dummyAverageRating = 4.3;

    const activePlayersQuery = "SELECT COUNT(*) as activePlayers FROM users WHERE kycstatus = 1";
    const activePlayersResult = await new Promise((resolve, reject) => {
      connection.query(activePlayersQuery, (err, results) => {
        if (err) {
          console.error('Error fetching active players:', err);
          resolve(dummyActivePlayers);
        } else {
          resolve(results[0]?.activePlayers || dummyActivePlayers);
        }
      });
    });


    const prizePoolQuery = "SELECT SUM(balance) as prizePool FROM wallet WHERE cryptoname = 'INR'";
    const prizePoolResult = await new Promise((resolve, reject) => {
      connection.query(prizePoolQuery, (err, results) => {
        if (err) {
          console.error('Error fetching prize pool:', err);
          resolve(dummyPrizePool);
        } else {
          resolve(results[0]?.prizePool || dummyPrizePool);
        }
      });
    });

    const ratingsQuery = "SELECT AVG(rating) as averageRating FROM ratings";
    const ratingsResult = await new Promise((resolve, reject) => {
      connection.query(ratingsQuery, (err, results) => {
        if (err) {
          console.error('Error fetching ratings:', err);
          resolve(dummyAverageRating);
        } else {
          resolve(results[0]?.averageRating || dummyAverageRating);
        }
      });
    });

    res.status(200).json({
      activePlayers: activePlayersResult,
      prizePool: prizePoolResult,
      averageRating: ratingsResult,
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ error: 'Error fetching statistics' });
  }
});

// ===================== Get all users with related data =====================
router.get('/all-users-data', async (req, res) => {
  try {
    //  Get all users
    const userQuery = "SELECT * FROM users";
    const allUsers = await new Promise((resolve, reject) => {
      connection.query(userQuery, (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    if (!allUsers.length) {
      return res.status(404).json({ success: false, error: 'No users found' });
    }

    //  For each user, fetch related info
    const allUsersData = await Promise.all(allUsers.map(async (user) => {
      const userId = user.id;

      //  Wallet
      const walletDetails = await new Promise((resolve, reject) => {
        connection.query("SELECT * FROM wallet WHERE userId = ?", [userId], (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });

      //  Bank
      const bankDetails = await new Promise((resolve, reject) => {
        connection.query("SELECT * FROM bankaccount WHERE userId = ?", [userId], (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });

      //  Referrals
      const referralDetails = await new Promise((resolve, reject) => {
        const query = `
          SELECT r.*, u.username as referred_username 
          FROM referrals r 
          JOIN users u ON r.referred_id = u.id 
          WHERE r.referrer_id = ?
        `;
        connection.query(query, [userId], (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });

      //  Withdrawals
      const withdrawalDetails = await new Promise((resolve, reject) => {
        connection.query("SELECT * FROM withdrawl WHERE userId = ?", [userId], (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });

      //  KYC from user_kyc_requests
      const kycResults = await new Promise((resolve, reject) => {
        connection.query(
          "SELECT aadhar_front, aadhar_back, pan, status, kyc_note FROM user_kyc_requests WHERE user_id = ?",
          [userId],
          (err, results) => {
            if (err) return reject(err);
            resolve(results);
          }
        );
      });

      const kycDetails = kycResults.length > 0 ? kycResults[0] : {
        status: "not_requested",
        aadhar_front: null,
        aadhar_back: null,
        pan: null,
        kyc_note: null
      };

      //  Return full user block
      return {
        user: {
          ...user,
          password: undefined // hide password
        },
        wallet: walletDetails,
        bankAccounts: bankDetails,
        referrals: referralDetails,
        withdrawals: withdrawalDetails,
        kyc: kycDetails
      };
    }));

    //  Response
    res.json({
      success: true,
      message: 'All users data retrieved successfully',
      totalUsers: allUsersData.length,
      data: allUsersData
    });

  } catch (error) {
    console.error('Error fetching all users data:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users data',
      error: error.message
    });
  }
});

// ==============test cron job to credit commissions================
router.get('/test/run-cron', async (req, res) => {


  try {
    await creditCommissions();
    res.send('Commission cron job executed successfully.');
  } catch (err) {
    console.error(" Cron Execution Failed:", err.message || err);
    res.status(500).send(' Error in cron job');
  }
});


// ==============test cron job to collect total bet================
router.get('/bet-collect-cron', async (req, res) => {
  try {
    await  processDailyBettingCommissions();
    res.send('Commission cron job executed successfully.');
  } catch (err) {
    console.error(" Cron Execution Failed:", err.message || err);
    res.status(500).send(' Error in cron job');
  }
});


//===== Get user's successful withdrawals and deposits in a date range ===
router.get('/report/transactions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    let { start, end } = req.query;

    // Validate input
    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid userId is required"
      });
    }

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        message: "Start and end date are required (YYYY-MM-DD)"
      });
    }

    start = `${start} 00:00:00`;
    end = `${end} 23:59:59`;

    // --- DEPOSIT QUERY (with cryptoname = INR) ---
    const depositQuery = `
      SELECT 
        'deposit' AS type,
        d.id,
        d.userId,
        d.amount,
        d.cryptoname,
        d.created_at AS date,
        u.name,
        u.email
      FROM deposits d
      LEFT JOIN users u ON d.userId = u.id
      WHERE d.userId = ? AND d.cryptoname = 'INR'
        AND d.created_at >= ? AND d.created_at <= ?
      ORDER BY d.created_at DESC
    `;

    // --- WITHDRAWAL QUERY (with cryptoname = INR) ---
    const withdrawalQuery = `
      SELECT 
        'withdrawal' AS type,
        w.id,
        w.userId,
        w.balance AS amount,
        w.cryptoname,
        w.createdOn AS date,
        u.name,
        u.email
      FROM withdrawl w
      LEFT JOIN users u ON w.userId = u.id
      WHERE w.userId = ? AND w.cryptoname = 'INR'
        AND (w.status = 1 OR w.status = '1')
        AND w.createdOn >= ? AND w.createdOn <= ?
      ORDER BY w.createdOn DESC
    `;

    const [deposits, withdrawals] = await Promise.all([
      new Promise((resolve, reject) => {
        connection.query(depositQuery, [userId, start, end], (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      }),
      new Promise((resolve, reject) => {
        connection.query(withdrawalQuery, [userId, start, end], (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      })
    ]);

    const allTransactions = [...deposits, ...withdrawals].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );

    //  response formatting
    res.json({
      success: true,
      userId: parseInt(userId),
      start_date: start,
      end_date: end,
      total_deposits: deposits.length,
      total_withdrawals: withdrawals.length,
      total_transactions: allTransactions.length,
      transactions: allTransactions.map(txn => ({
        ...txn,
        name: txn.name || 'Unknown User',
        email: txn.email || 'N/A'
      }))
    });
  } catch (error) {
    console.error('Error generating transaction report:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating transaction report',
      error: error.message
    });
  }
});

// Get all users
router.get('/allusers', async (req, res) => {
  try {
    const query = `
      SELECT 
        u.*, 
        COALESCE(
          CONCAT('[', 
            GROUP_CONCAT(
              JSON_OBJECT('cryptoname', w.cryptoname, 'balance', w.balance)
            ), 
          ']'), 
          '[]'
        ) AS wallets
      FROM users u
      LEFT JOIN wallet w ON u.id = w.userId
      GROUP BY u.id
    `;

    connection.query(query, (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });

      results.forEach(user => {
        user.wallets = JSON.parse(user.wallets);
      });

      res.json(results);
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

//============== Get  user related all data by userId =================

// router.get('/user-all-data/:userId', async (req, res) => {
//   const userId = req.params.userId;

//   try {
//     // Get user basic information
//     const userQuery = "SELECT * FROM users WHERE id = ?";
//     const [userDetails] = await new Promise((resolve, reject) => {
//       connection.query(userQuery, [userId], (err, results) => {
//         if (err) reject(err);
//         resolve(results);
//       });
//     });

//     if (!userDetails) {
//       return res.status(404).json({ error: 'User not found' });
//     }

//     // Get wallet information
//     const walletQuery = "SELECT * FROM wallet WHERE userId = ?";
//     const walletDetails = await new Promise((resolve, reject) => {
//       connection.query(walletQuery, [userId], (err, results) => {
//         if (err) reject(err);
//         resolve(results);
//       });
//     });

//     // Get bank account information
//     const bankQuery = "SELECT * FROM bankaccount WHERE userId = ?";
//     const bankDetails = await new Promise((resolve, reject) => {
//       connection.query(bankQuery, [userId], (err, results) => {
//         if (err) reject(err);
//         resolve(results);
//       });
//     });

//     // Get referral information
//     const referralQuery = `
//             SELECT r.*, u.username as referred_username 
//             FROM referrals r 
//             JOIN users u ON r.referred_id = u.id 
//             WHERE r.referrer_id = ?`;
//     const referralDetails = await new Promise((resolve, reject) => {
//       connection.query(referralQuery, [userId], (err, results) => {
//         if (err) reject(err);
//         resolve(results);
//       });
//     });


//     // Get withdrawal information
//     const withdrawalQuery = "SELECT * FROM withdrawl WHERE userId = ?";
//     const withdrawalDetails = await new Promise((resolve, reject) => {
//       connection.query(withdrawalQuery, [userId], (err, results) => {
//         if (err) reject(err);
//         resolve(results);
//       });
//     });



//     // Combine all data
//     const userData = {
//       user: {
//         ...userDetails,
//         password: undefined // Remove sensitive data
//       },
//       wallet: walletDetails,
//       bankAccounts: bankDetails,
//       referrals: referralDetails,
//       withdrawals: withdrawalDetails,
//       kyc: {
//         status: userDetails.kycstatus,
//         aadhar: userDetails.aadhar,
//         pan: userDetails.pan
//       }
//     };

//     res.json({
//       success: true,
//       message: 'User data retrieved successfully',
//       data: userData
//     });

//   } catch (error) {
//     console.error('Error fetching user data:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching user data',
//       error: error.message
//     });
//   }
// });

router.get('/user-all-data/:userId', async (req, res) => {
  const userId = req.params.userId;

  try {
    //  Get user basic info
    const userResults = await new Promise((resolve, reject) => {
      connection.query("SELECT * FROM users WHERE id = ?", [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    if (!userResults || userResults.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const user = userResults[0];

    //  Get wallet info
    const walletDetails = await new Promise((resolve, reject) => {
      connection.query("SELECT * FROM wallet WHERE userId = ?", [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    //  Get bank accounts
    const bankDetails = await new Promise((resolve, reject) => {
      connection.query("SELECT * FROM bankaccount WHERE userId = ?", [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    //  Get referral info
    const referralDetails = await new Promise((resolve, reject) => {
      const query = `
        SELECT r.*, u.username as referred_username 
        FROM referrals r 
        JOIN users u ON r.referred_id = u.id 
        WHERE r.referrer_id = ?
      `;
      connection.query(query, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    //  Get withdrawals
    const withdrawalDetails = await new Promise((resolve, reject) => {
      connection.query("SELECT * FROM withdrawl WHERE userId = ?", [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    //  Get KYC details from user_kyc_requests table
    const kycResults = await new Promise((resolve, reject) => {
      connection.query(
        "SELECT aadhar_front, aadhar_back, pan, status, kyc_note FROM user_kyc_requests WHERE user_id = ?",
        [userId],
        (err, results) => {
          if (err) return reject(err);
          resolve(results);
        }
      );
    });

    const kycDetails = kycResults.length > 0 ? kycResults[0] : {
      status: "not_requested",
      aadhar_front: null,
      aadhar_back: null,
      pan: null,
      kyc_note: null
    };

    
    // -------------------- BET SUMMARY --------------------
    const betQueries = [
      { name: "Wingo-game", query: "SELECT SUM(amount) as total FROM bets WHERE user_id = ? AND status = 'processed'", params: [userId] },
      { name: "Wingo-TRX", query: "SELECT SUM(amount) as total FROM bets_trx WHERE user_id = ? AND status != 'pending'", params: [userId] },
      { name: "Wingo-5D", query: "SELECT SUM(amount) as total FROM bets_5d WHERE user_id = ? AND status != 'pending'", params: [userId] },
      { name: "Other-games", query: "SELECT SUM(bet) as total FROM api_turnover WHERE login = ?", params: [userId] }
    ];

    const betResults = {};
    let totalBetAmount = 0;

    for (const bq of betQueries) {
      const rows = await new Promise((resolve, reject) => {
        connection.query(bq.query, bq.params, (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });
      const amount = rows[0]?.total ? Number(rows[0].total) : 0;
      betResults[bq.name] = amount;
      totalBetAmount += amount;
    }


        // -------------------- RECHARGE SUMMARY --------------------
    const rechargeSummary = await new Promise((resolve, reject) => {
      const q = `
       SELECT 
      SUM(recharge_amount) AS total_recharge
      FROM recharge
      WHERE userId = ? 
       AND recharge_status = 'success';

      `;
      connection.query(q, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results[0]);
      });
    });

    const rechargeDetails = {
      total_recharge_amount: rechargeSummary.total_recharge ? Number(rechargeSummary.total_recharge) : 0
    };






    // -------------------- DEPOSIT SUMMARY --------------------
    const depositSummary = await new Promise((resolve, reject) => {
      const q = `
        SELECT 
          SUM(amount) as total_deposit,
          MIN(created_at) as first_deposit_date
        FROM deposits
        WHERE userId = ?
      `;
      connection.query(q, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results[0]);
      });
    });

    let firstDepositAmount = 0;
    if (depositSummary.first_deposit_date) {
      const firstDepositRow = await new Promise((resolve, reject) => {
        connection.query(
          "SELECT amount FROM deposits WHERE userId = ? ORDER BY created_at ASC LIMIT 1",
          [userId],
          (err, results) => {
            if (err) return reject(err);
            resolve(results[0]);
          }
        );
      });
      firstDepositAmount = firstDepositRow ? Number(firstDepositRow.amount) : 0;
    }

    const depositDetails = {
      total_deposit:rechargeDetails.total_recharge_amount,
      first_deposit_amount: firstDepositAmount,
      first_deposit_date: depositSummary.first_deposit_date || null
    };


    


    // -------------------- FINAL RESPONSE --------------------
    const userData = {
      user: { ...user, password: undefined },
      wallet: walletDetails,
      bankAccounts: bankDetails,
      referrals: referralDetails,
      withdrawals: withdrawalDetails,
      kyc: kycDetails,
      bets: {
        total_bet_amount: totalBetAmount,
        breakdown: betResults
      },
      deposits: depositDetails
    };

    res.json({
      success: true,
      message: 'User data retrieved successfully',
      data: userData
    });


    

  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user data',
      error: error.message
    });
  }
});


 
//================ Get User Game Transactions =================
router.get('/game-transactions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // Query to check if user exists
    const userQuery = "SELECT id, username FROM users WHERE id = ?";
    connection.query(userQuery, [userId], (userErr, userResult) => {
      if (userErr) {
        console.error('User query error:', userErr);
        return res.status(500).json({
          success: false,
          message: "Error checking user",
          error: userErr.message
        });
      }

      const user = userResult[0];
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Query to get total transactions
      const countQuery = `
        SELECT COUNT(*) as total 
        FROM api_turnover 
        WHERE login = ?
      `; 

      connection.query(countQuery, [userId], (countErr, countResult) => {
        if (countErr) {
          console.error('Count query error:', countErr);
          return res.status(500).json({
            success: false,
            message: "Error counting transactions",
            error: countErr.message
          });
        }

        const totalRecords = countResult[0].total;
        const totalPages = Math.ceil(totalRecords / limit);

        // Query to get paginated transactions
        const transactionQuery = `
          SELECT 
            id as transaction_id,
            cmd as transaction_type,
            sessionId,
            bet as bet_amount,
            date as bet_date,
            gameId,
            win as winning_amount,
            created_at,
            CASE
              WHEN win IS NULL THEN 'pending'
              WHEN win > 0 THEN 'won'
              ELSE 'lost'
            END as status
          FROM api_turnover 
          WHERE login = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `;

        connection.query(transactionQuery, [userId, limit, offset], (txErr, txResult) => {
          if (txErr) {
            console.error('Transaction query error:', txErr);
            return res.status(500).json({
              success: false,
              message: "Error fetching transactions",
              error: txErr.message
            });
          }
          // Format transaction amounts because they might be strings
          const transactions = txResult.map(tx => ({
            ...tx,
            bet_amount: parseFloat(tx.bet_amount || 0),
            winning_amount: parseFloat(tx.winning_amount || 0)
          }));

          res.json({
            success: true,
            message: "Game transactions retrieved successfully",
            pagination: {
              total_records: totalRecords,
              total_pages: totalPages,
              current_page: page,
              limit: limit
            },
            transactions
          });
        });
      });
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: error.message
    });
  }
});


//================ KYC Approval by Admin =================

// router.put('/kyc/approve/:userId', async (req, res) => {
//   try {
//     const userId = req.params.userId;
//     const { status, note } = req.body; // note is optional, but useful on rejection


//     if (![0, 1, 2].includes(Number(status))) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid status value. Use 0 for pending, 1 for approved, 2 for rejected"
//       });
//     }

//     // First check if user has uploaded KYC documents
//     const checkQuery = `
//       SELECT aadhar_front, aadhar_back, pan, kycstatus 
//       FROM users 
//       WHERE id = ?
//     `;

//     const checkUser = () => {
//       return new Promise((resolve, reject) => {
//         connection.query(checkQuery, [userId], (err, results) => {
//           if (err) {
//             console.error('Database error in checkQuery:', err);
//             reject(err);
//             return;
//           }
//           resolve(results);
//         });
//       });
//     };

//     const results = await checkUser();

//     if (!results || results.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "User not found"
//       });
//     }

//     const user = results[0];

//     if (!user.aadhar_front && !user.pan) {
//       return res.status(400).json({
//         success: false,
//         message: "Cannot process KYC. No documents uploaded",
//         missing_documents: {
//           aadhar_front: !user.aadhar_front,
//           aadhar_back: !user.aadhar_back,
//           pan: !user.pan
//         }
//       });
//     }

//     // Update status + note
//     const updateQuery = `
//       UPDATE users 
//       SET kycstatus = ?, kyc_note = ?
//       WHERE id = ?
//     `;

//     const updateStatus = () => {
//       return new Promise((resolve, reject) => {
//         connection.query(updateQuery, [status, note || null, userId], (err, result) => {
//           if (err) {
//             console.error('Database error in updateQuery:', err);
//             reject(err);
//             return;
//           }
//           resolve(result);
//         });
//       });
//     };

//     await updateStatus();

//     res.json({
//       success: true,
//       message: `KYC ${status === 1 ? 'approved' : status === 2 ? 'rejected' : 'set to pending'} successfully`,
//       data: {
//         user_id: userId,
//         new_status: status,
//         status_text: status === 1 ? 'Approved' : status === 2 ? 'Rejected' : 'Pending',
//         documents: {
//           aadhar: user.aadhar_front ? "Submitted" : "Not submitted",
//           pan: user.pan ? "Submitted" : "Not submitted"
//         },
//         note: note || null
//       }
//     });

//   } catch (error) {
//     console.error('Error processing KYC:', error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message
//     });
//   }
// });
router.put('/kyc/approve/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const { status, note } = req.body;

    // Allowed status values: pending, approved, rejected
    const validStatuses = ['pending', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Use 'pending', 'approved', or 'rejected'."
      });
    }

    // Step 1: Check if KYC request exists for this user
    const checkQuery = `
      SELECT * FROM user_kyc_requests
      WHERE user_id = ?
    `;

    const [kycRequests] = await new Promise((resolve, reject) => {
      connection.query(checkQuery, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    if (!kycRequests) {
      return res.status(404).json({
        success: false,
        message: "No KYC request found for this user."
      });
    }

    const user = kycRequests;

    if (!user.aadhar_front && !user.pan) {
      return res.status(400).json({
        success: false,
        message: "Cannot process KYC. No documents uploaded.",
        missing_documents: {
          aadhar_front: !user.aadhar_front,
          aadhar_back: !user.aadhar_back,
          pan: !user.pan
        }
      });
    }

    // Step 2: Update status and note
    const updateQuery = `
      UPDATE user_kyc_requests
      SET status = ?, kyc_note = ?
      WHERE user_id = ?
    `;

    await new Promise((resolve, reject) => {
      connection.query(updateQuery, [status, note || null, userId], (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });

    res.json({
      success: true,
      message: `KYC ${status} successfully`,
      data: {
        user_id: userId,
        new_status: status,
        documents: {
          aadhar_front: user.aadhar_front ? "Submitted" : "Not submitted",
          aadhar_back: user.aadhar_back ? "Submitted" : "Not submitted",
          pan: user.pan ? "Submitted" : "Not submitted"
        },
        note: note || null
      }
    });

  } catch (error) {
    console.error('Error processing KYC:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});


//================ Get All Users with Pending KYC =================

// router.get('/pending-kyc', async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const status = parseInt(req.query.status); // Get status from query params
//     const limit = 20;
//     const offset = (page - 1) * limit;

//     // Validate status parameter
//     if (![0, 1, 2, 3].includes(status)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid status value. Use 0 for pending, 1 for approved, 2 for rejected, 3 for all"
//       });
//     }

//     // Build WHERE clause based on status
//     const whereClause = status === 3 ? '' : 'WHERE kycstatus = ?';

//     // Query to get total users based on status
//     const countQuery = `
//       SELECT COUNT(*) as total 
//       FROM users 
//       ${whereClause}
//     `;

//     const countParams = status === 3 ? [] : [status];

//     connection.query(countQuery, countParams, (countErr, countResult) => {
//       if (countErr) {
//         console.error('Count query error:', countErr);
//         return res.status(500).json({
//           success: false,
//           message: "Error counting KYC users",
//           error: countErr.message
//         });
//       }

//       const totalUsers = countResult[0].total;
//       const totalPages = Math.ceil(totalUsers / limit);

//       // Now fetch paginated data with updated fields
//       const dataQuery = `
//         SELECT 
//           id,
//           username,
//           name,
//           email,
//           phone,
//           aadhar_front,
//           aadhar_back,
//           pan,
//           kycstatus,
//           my_referral_code
//         FROM users 
//         ${whereClause}
//         ORDER BY id DESC
//         LIMIT ? OFFSET ?
//       `;

//       const queryParams = status === 3
//         ? [limit, offset]
//         : [status, limit, offset];

//       connection.query(dataQuery, queryParams, (err, results) => {
//         if (err) {
//           console.error('Data fetch error:', err);
//           return res.status(500).json({
//             success: false,
//             message: "Error fetching KYC users",
//             error: err.message
//           });
//         }

//         const statusText = {
//           0: 'Pending',
//           1: 'Approved',
//           2: 'Rejected',
//           3: 'All'
//         };

//         res.json({
//           success: true,
//           message: `${statusText[status]} KYC users retrieved successfully`,
//           total_items: totalUsers,
//           total_pages: totalPages,
//           current_page: page,
//           items_per_page: limit,
//           status: status,
//           status_text: statusText[status],
//           data: results.map(user => ({
//             user_id: user.id,
//             username: user.username,
//             name: user.name,
//             email: user.email,
//             phone: user.phone,
//             referral_code: user.my_referral_code,
//             kyc_status: {
//               code: user.kycstatus,
//               text: statusText[user.kycstatus]
//             },
//             documents: {
//               aadharfront: user.aadhar_front ? `${user.aadhar_front}` : null,
//               aadharback: user.aadhar_back ? `${user.aadhar_back}` : null,
//               pan: user.pan ? `${user.pan}` : null
//             }
//           }))
//         });
//       });
//     });

//   } catch (error) {
//     console.error('Error fetching KYC users:', error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message
//     });
//   }
// });
router.get('/pending-kyc', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status || 'pending'; // Use ENUM value
    const limit = 20;
    const offset = (page - 1) * limit;

    const validStatuses = ['pending', 'approved', 'rejected', 'all'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Use 'pending', 'approved', 'rejected', or 'all'."
      });
    }

    const whereClause = status === 'all' ? '' : 'WHERE k.status = ?';
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM user_kyc_requests k
      ${whereClause}
    `;
    const countParams = status === 'all' ? [] : [status];

    connection.query(countQuery, countParams, (countErr, countResult) => {
      if (countErr) {
        console.error('Count query error:', countErr);
        return res.status(500).json({
          success: false,
          message: "Error counting KYC records",
          error: countErr.message
        });
      }

      const totalItems = countResult[0].total;
      const totalPages = Math.ceil(totalItems / limit);

      const dataQuery = `
        SELECT 
          k.id AS kyc_id,
          u.id AS user_id,
          u.username,
          u.name,
          u.email,
          u.phone,
          u.my_referral_code,
          k.aadhar_front,
          k.aadhar_back,
          k.pan,
          k.status AS kycstatus,
          k.kyc_note,
          k.created_at,
          k.updated_at
        FROM user_kyc_requests k
        JOIN users u ON u.id = k.user_id
        ${whereClause}
        ORDER BY k.id DESC
        LIMIT ? OFFSET ?
      `;

      const dataParams = status === 'all'
        ? [limit, offset]
        : [status, limit, offset];

      connection.query(dataQuery, dataParams, (err, results) => {
        if (err) {
          console.error('Data fetch error:', err);
          return res.status(500).json({
            success: false,
            message: "Error fetching KYC requests",
            error: err.message
          });
        }

        res.json({
          success: true,
          message: `KYC records for status '${status}' retrieved successfully`,
          total_items: totalItems,
          total_pages: totalPages,
          current_page: page,
          items_per_page: limit,
          status,
          data: results.map(user => ({
            kyc_id: user.kyc_id,
            user_id: user.user_id,
            username: user.username,
            name: user.name,
            email: user.email,
            phone: user.phone,
            referral_code: user.my_referral_code,
            kyc_status: {
              code: user.kycstatus,
              text: user.kycstatus.charAt(0).toUpperCase() + user.kycstatus.slice(1)
            },
            documents: {
              aadhar_front: user.aadhar_front || null,
              aadhar_back: user.aadhar_back || null,
              pan: user.pan || null
            },
            kyc_note: user.kyc_note || null,
            created_at: user.created_at,
            updated_at: user.updated_at
          }))
        });
      });
    });

  } catch (error) {
    console.error('Error fetching KYC records:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

//================= Get user betting statistics ==========
router.get('/user-bet-stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    let { page = 1, limit = 50 } = req.query;

    if (!userId || isNaN(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;

    // Main game stats query
    const statsQuery = `
      SELECT 
        COUNT(*) as total_bets,
        SUM(amount) as total_bet_amount,
        SUM(CASE 
            WHEN (bet_type = 'number' AND CAST(bet_value AS SIGNED) = r.result_number) OR
                 (bet_type = 'color' AND bet_value = r.result_color) OR
                 (bet_type = 'size' AND bet_value = r.result_size)
            THEN amount * 1.9
            ELSE 0  
        END) as total_winnings,
        COUNT(CASE 
            WHEN (bet_type = 'number' AND CAST(bet_value AS SIGNED) = r.result_number) OR
                 (bet_type = 'color' AND bet_value = r.result_color) OR
                 (bet_type = 'size' AND bet_value = r.result_size)
            THEN 1 
        END) as total_wins,
        SUM(CASE WHEN bet_type = 'color' THEN amount ELSE 0 END) as color_bets_amount,
        SUM(CASE WHEN bet_type = 'number' THEN amount ELSE 0 END) as number_bets_amount,
        SUM(CASE WHEN bet_type = 'size' THEN amount ELSE 0 END) as size_bets_amount
      FROM bets b
      LEFT JOIN result r ON b.period_number = r.period_number
      WHERE b.user_id = ? AND b.status = 'processed'
      GROUP BY b.user_id
    `;

    // Paginated recent bets query
    const recentBetsQuery = `
      SELECT 
        b.period_number,
        b.bet_type,
        b.bet_value,
        b.amount,
        b.placed_at,
        CASE 
            WHEN (bet_type = 'number' AND CAST(bet_value AS SIGNED) = r.result_number) OR
                 (bet_type = 'color' AND bet_value = r.result_color) OR
                 (bet_type = 'size' AND bet_value = r.result_size)
            THEN amount * 1.9
            ELSE 0 
        END as winnings,
        CASE 
            WHEN (bet_type = 'number' AND CAST(bet_value AS SIGNED) = r.result_number) OR
                 (bet_type = 'color' AND bet_value = r.result_color) OR
                 (bet_type = 'size' AND bet_value = r.result_size)
            THEN 'won'
            ELSE 'lost'
        END as result
      FROM bets b
      LEFT JOIN result r ON b.period_number = r.period_number
      WHERE b.user_id = ? AND b.status = 'processed'
      ORDER BY b.placed_at DESC
      LIMIT ? OFFSET ?
    `;

    // Count total for pagination
    const totalRecentBetsQuery = `
      SELECT COUNT(*) AS total FROM bets
      WHERE user_id = ? AND status = 'processed'
    `;

    // Turnover stats
    const turnoverStatsQuery = `
      SELECT 
        COUNT(*) AS total_turnover_bets,
        SUM(bet) AS total_turnover_amount,
        SUM(CASE WHEN win > 0 THEN 1 ELSE 0 END) AS total_turnover_wins,
        SUM(win) AS total_turnover_win_amount,
        SUM(win - bet) AS turnover_profit_loss
      FROM api_turnover
      WHERE login = ?
    `;

    // Game-wise breakdown
    const turnoverGameDistQuery = `
      SELECT 
        gameId,
        COUNT(*) AS total_bets,
        SUM(bet) AS total_bet_amount,
        SUM(win) AS total_win_amount
      FROM api_turnover
      WHERE login = ?
      GROUP BY gameId
    `;

    // Execute queries
    const [stats, recentBets, totalRecentCount, turnoverStats, gameDistribution] = await Promise.all([
      new Promise((resolve, reject) => {
        connection.query(statsQuery, [userId], (err, results) => {
          if (err) reject(err); else resolve(results[0]);
        });
      }),
      new Promise((resolve, reject) => {
        connection.query(recentBetsQuery, [userId, limit, offset], (err, results) => {
          if (err) reject(err); else resolve(results);
        });
      }),
      new Promise((resolve, reject) => {
        connection.query(totalRecentBetsQuery, [userId], (err, results) => {
          if (err) reject(err); else resolve(results[0]?.total || 0);
        });
      }),
      new Promise((resolve, reject) => {
        connection.query(turnoverStatsQuery, [userId], (err, results) => {
          if (err) reject(err); else resolve(results[0]);
        });
      }),
      new Promise((resolve, reject) => {
        connection.query(turnoverGameDistQuery, [userId], (err, results) => {
          if (err) reject(err); else resolve(results);
        });
      })
    ]);

    const profitLoss = parseFloat(stats?.total_winnings || 0) - parseFloat(stats?.total_bet_amount || 0);
    const totalPages = Math.ceil(totalRecentCount / limit);

    res.json({
      success: true,
      statistics: {
        total_bets: parseInt(stats?.total_bets || 0),
        total_bet_amount: parseFloat(stats?.total_bet_amount || 0),
        total_winnings: parseFloat(stats?.total_winnings || 0),
        total_wins: parseInt(stats?.total_wins || 0),
        win_rate: stats?.total_bets ? ((stats.total_wins / stats.total_bets) * 100).toFixed(2) : "0.00",
        profit_loss: profitLoss,
        bet_distribution: {
          color: parseFloat(stats?.color_bets_amount || 0),
          number: parseFloat(stats?.number_bets_amount || 0),
          size: parseFloat(stats?.size_bets_amount || 0)
        }
      },
      recent_bets: {
        page,
        limit,
        total: totalRecentCount,
        totalPages,
        data: recentBets.map(bet => ({
          period_number: bet.period_number,
          bet_type: bet.bet_type,
          bet_value: bet.bet_value,
          amount: parseFloat(bet.amount),
          winnings: parseFloat(bet.winnings),
          result: bet.result,
          placed_at: bet.placed_at
        }))
      },
      other_game_stats: {
        total_turnover_bets: parseInt(turnoverStats?.total_turnover_bets || 0),
        total_turnover_amount: parseFloat(turnoverStats?.total_turnover_amount || 0),
        total_turnover_wins: parseInt(turnoverStats?.total_turnover_wins || 0),
        total_turnover_win_amount: parseFloat(turnoverStats?.total_turnover_win_amount || 0),
        turnover_profit_loss: parseFloat(turnoverStats?.turnover_profit_loss || 0),
        game_distribution: gameDistribution.map(row => ({
          gameId: row.gameId,
          total_bets: parseInt(row.total_bets),
          total_bet_amount: parseFloat(row.total_bet_amount),
          total_win_amount: parseFloat(row.total_win_amount)
        }))
      }
    });

  } catch (error) {
    console.error('Error fetching user betting statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching betting statistics',
      error: error.message
    });
  }
});


//============== Get user's transaction history=============
router.get('/transactions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // First check if user exists
    const userQuery = "SELECT id, username FROM users WHERE id = ?";
    const [user] = await new Promise((resolve, reject) => {
      connection.query(userQuery, [userId], (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Get recharge history
    const rechargeQuery = `
            SELECT 
                'recharge' as transaction_type,
                recharge_id as id,
                order_id,
                recharge_amount as amount,
                recharge_type as type,
                payment_mode,
                recharge_status as status,
                CONCAT(date, ' ', time) as transaction_date
            FROM recharge 
            WHERE userId = ?`;

    // Get withdrawal history
    const withdrawalQuery = `
            SELECT 
                'withdrawal' as transaction_type,
                id,
                balance as amount,
                cryptoname as type,
                reject_note as   note,
                CASE 
                    WHEN status = 0 THEN 'pending'
                    WHEN status = 1 THEN 'approved'
                    WHEN status = 2 THEN 'rejected'
                END as status,
                NULL as order_id,
                NULL as payment_mode,
                DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') as transaction_date
            FROM withdrawl 
            WHERE userId = ?`;

    // Execute both queries
    const [recharges, withdrawals] = await Promise.all([
      new Promise((resolve, reject) => {
        connection.query(rechargeQuery, [userId], (err, results) => {
          if (err) reject(err);
          resolve(results);
        });
      }),
      new Promise((resolve, reject) => {
        connection.query(withdrawalQuery, [userId], (err, results) => {
          if (err) reject(err);
          resolve(results);
        });
      })
    ]);

    // Combine and sort all transactions by date
    const allTransactions = [...recharges, ...withdrawals]
      .sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username
      },
      transactions: allTransactions.map(transaction => ({
        ...transaction,
        transaction_date: new Date(transaction.transaction_date).toLocaleString()
      }))
    });

  } catch (error) {
    console.error('Error fetching transaction history:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching transaction history',
      error: error.message
    });
  }
});

//--------------------------------------- Protected Routes----------------------

router.use(authenticateToken);

//----------------------------------------------------------------------------------



router.get("/referrals/today-summary/:userId", async (req, res) => {
  const { userId } = req.params;
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    // 1. Check user existence
    const [userCheck] = await new Promise((resolve, reject) => {
      connection.query("SELECT id FROM users WHERE id = ?", [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    if (!userCheck) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 2. Get today's referral summary
    const summary = await new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          u.id,
          u.name,
          u.username,
          u.email,
          r.level,
          (SELECT d.amount FROM deposits d WHERE d.userId = u.id AND DATE(d.created_at) = ? ORDER BY d.date ASC LIMIT 1) AS first_deposit,
          (SELECT SUM(d.amount) FROM deposits d WHERE d.userId = u.id AND DATE(d.created_at) = ?) AS total_deposit,
          (SELECT SUM(b.amount) FROM bets b WHERE b.user_id = u.id) AS total_bets,            
          (SELECT IFNULL(SUM(c.amount), 0) FROM referralcommissionhistory c WHERE c.user_id = ? AND c.referred_user_id = u.id AND c.credited = 0) AS pending_commission
        FROM referrals r 
        JOIN users u ON r.referred_id = u.id
        WHERE r.referrer_id = ?
        AND DATE(u.created_at) = ?
        ORDER BY r.level
      `;

      connection.query(sql, [today, today, userId, userId, today], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    // 3. Group by level
    const referralsByLevel = {
      level1: [],
      level2: [],
      level3: [],
      level4: [],
      level5: []
    };

    for (const row of summary) {
      const levelKey = `level${row.level}`;
      referralsByLevel[levelKey].push({
        id: row.id,
        name: row.name,
        username: row.username,
        email: row.email,
        level: row.level,
        first_deposit: parseFloat(row.first_deposit || 0).toFixed(2),
        total_deposit: parseFloat(row.total_deposit || 0).toFixed(2),
        total_bets: row.total_bets ? parseFloat(row.total_bets).toFixed(2) : null,
        pending_commission: parseFloat(row.pending_commission || 0).toFixed(2)
      });
    }

    const totalReferrals = summary.length;

    res.json({
      userId,
      totalReferrals,
      referralsByLevel
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/referralsbydate/:userId", async (req, res) => {
  const { userId } = req.params;
  const { dateType } = req.query;

  // Optional date filter logic
const getDateRange = (type) => {
  let startDate, endDate;

  switch (type) {
    case "today":
      startDate = moment().startOf("day").format("YYYY-MM-DD");
      endDate = moment().endOf("day").format("YYYY-MM-DD");
      break;

    case "yesterday":
      startDate = moment().subtract(1, "days").startOf("day").format("YYYY-MM-DD");
      endDate = moment().subtract(1, "days").endOf("day").format("YYYY-MM-DD");
      break;

    case "lastMonth":
      startDate = moment().subtract(30, "days").format("YYYY-MM-DD");
      endDate = moment().format("YYYY-MM-DD");
      break;

    default:
      startDate = null;
      endDate = null;
  }

  return { startDate, endDate };
};

  const { startDate, endDate } = getDateRange(dateType);

  try {
    const referrals = await new Promise((resolve, reject) => {
      let sql = `
        SELECT 
          u.id,
          u.name,
          u.username,
          u.email,
          DATE(u.created_at) AS join_date,
          r.level,
          (SELECT d.amount FROM deposits d WHERE d.userId = u.id ORDER BY d.date ASC LIMIT 1) AS first_deposit,
          (SELECT SUM(d.amount) FROM deposits d WHERE d.userId = u.id) AS total_deposit,
          (SELECT SUM(b.amount) FROM bets b WHERE b.user_id = u.id) AS total_bets,
          (SELECT IFNULL(SUM(c.amount), 0) FROM referralcommissionhistory c 
            WHERE c.user_id = ? AND c.referred_user_id = u.id AND c.credited = 0) AS pending_commission
        FROM referrals r 
        JOIN users u ON r.referred_id = u.id 
        WHERE r.referrer_id = ?
      `;

      const params = [userId, userId];

      if (startDate && endDate) {
        sql += ` AND DATE(u.created_at) BETWEEN ? AND ?`;
        params.push(startDate, endDate);
      }

      sql += ` ORDER BY r.level`;

      connection.query(sql, params, (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    // Group referrals by level
    const referralsByLevel = {};
    for (let i = 1; i <= 5; i++) {
      referralsByLevel[`level${i}`] = referrals.filter(ref => ref.level === i);
    }

    res.json({
      userId,
      dateType: dateType || "all",
      dateRange: startDate ? { startDate, endDate } : "All Time",
      totalReferrals: referrals.length,
      referralsByLevel
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/referrals/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // Get all referrals for this user up to level 5
    const referrals = await new Promise((resolve, reject) => {
      const sql = `
          SELECT 
            u.id,
            u.name,
            u.username,
            u.email,
            DATE(u.created_at) AS join_date,
            r.level,
            (SELECT d.amount FROM deposits d WHERE d.userId = u.id ORDER BY d.date ASC LIMIT 1) AS first_deposit,
            (SELECT SUM(d.amount) FROM deposits d WHERE d.userId = u.id) AS total_deposit,
            (SELECT SUM(b.amount) FROM bets b WHERE b.user_id = u.id) AS total_bets,            
            (SELECT IFNULL(SUM(c.amount), 0) FROM referralcommissionhistory c WHERE c.user_id = ? AND c.referred_user_id = u.id AND c.credited = 0 ) AS pending_commission
            FROM referrals r JOIN users u ON r.referred_id = u.id WHERE r.referrer_id = ? ORDER BY r.level
        `;
      const [referrerId] = [req.params.userId];

      connection.query(sql, [referrerId, referrerId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    // Group referrals by level
    const referralsByLevel = {};
    for (let i = 1; i <= 5; i++) {
      referralsByLevel[`level${i}`] = referrals.filter(ref => ref.level === i);
    }

    res.json({
      userId,
      totalReferrals: referrals.length,
      referralsByLevel
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

 // ================= Get referral summary by user-id =================
router.get("/referrals-summary/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // 1. Total Referrals count
    const totalReferrals = await new Promise((resolve, reject) => {
      const sql = `
        SELECT COUNT(*) AS count 
        FROM referrals 
        WHERE referrer_id = ?
      `;
      connection.query(sql, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results[0].count || 0);
      });
    });

    // 2. Direct Subordinates (level 1)
    const directSubs = await new Promise((resolve, reject) => {
      const sql = `
        SELECT COUNT(*) AS count 
        FROM referrals 
        WHERE referrer_id = ? AND level = 1
      `;
      connection.query(sql, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results[0].count || 0);
      });
    });

    // 3. Team Subordinates (level > 1)
    const teamSubs = await new Promise((resolve, reject) => {
      const sql = `
        SELECT COUNT(*) AS count 
        FROM referrals 
        WHERE referrer_id = ? AND level > 1
      `;
      connection.query(sql, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results[0].count || 0);
      });
    });

   // 4. Total Commission (only credited)
 const totalCommission = await new Promise((resolve, reject) => {
  const sql = `
    SELECT IFNULL(SUM(amount), 0) AS total 
    FROM referralcommissionhistory 
    WHERE user_id = ? AND credited = 1
  `;
  connection.query(sql, [userId], (err, results) => {
    if (err) return reject(err);
    resolve(results[0].total || 0);
  });
});


    res.json({
      userId,
      totalReferrals,
      totalCommission,
      directSubordinates: directSubs,
      teamSubordinates: teamSubs,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


//Get one user by id
router.get('/user/:id',async (req, res) => {
  const userId = req.params.id;
  console.log(userId, "name");
  try {
    const query = "SELECT * FROM users WHERE id = ? ";
    connection.query(query, [userId], (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      if (results.length === 0) return res.status(404).json({ error: 'User not found' });

      res.json(results[0]);
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching user' });
  }
});


//Get one user's wallet by id
router.get('/wallet/:id', async (req, res) => {
  const userId = req.params.id;
  console.log(userId, "name");
  try {
    const query = "SELECT * FROM wallet WHERE userId = ? ";
    connection.query(query, [userId], (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      if (results.length === 0) return res.status(404).json({ error: 'User not found' });

      res.json(results);
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching user' });
  }
});



// Delete user by ID
router.delete('/user/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    // Start a transaction to delete wallets and the user atomically
    connection.beginTransaction((err) => {
      if (err) return res.status(500).json({ error: 'Error starting transaction' });

      // Delete wallets associated with the user
      const deleteWalletsQuery = "DELETE FROM wallet WHERE userId = ?";
      connection.query(deleteWalletsQuery, [userId], (err, walletResults) => {
        if (err) {
          return connection.rollback(() => {
            res.status(500).json({ error: 'Error deleting wallets' });
          });
        }

        // Delete the user
        const deleteUserQuery = "DELETE FROM users WHERE id = ?";
        connection.query(deleteUserQuery, [userId], (err, userResults) => {
          if (err) {
            return connection.rollback(() => {
              res.status(500).json({ error: 'Error deleting user' });
            });
          }

          if (userResults.affectedRows === 0) {
            return connection.rollback(() => {
              res.status(404).json({ error: 'User not found' });
            });
          }

          // Commit the transaction
          connection.commit((err) => {
            if (err) {
              return connection.rollback(() => {
                res.status(500).json({ error: 'Error committing transaction' });
              });
            }

            res.json({ message: 'User and associated wallets deleted successfully' });
          });
        });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting user and wallets' });
  }
});


// Update user details by ID
router.patch('/user/:id', async (req, res) => {
  const userId = req.params.id;
  const { username, name, email, phone, image } = req.body;
  console.log(req.body, "body");
  try {
    const query = "UPDATE users SET username = ?,name = ?, email = ?, phone = ?, image = ? WHERE id = ?";
    connection.query(query, [username, name, email, phone, image, userId], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
      console.log("User details updated successfully");
      res.json({ message: 'User details updated successfully' });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error updating user details' });
  }
});

// Update user password by ID
router.put('/user/password/:id', async (req, res) => {
  const userId = req.params.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords are required' });
  }

  try {
    // Fetch the current hashed password
    const querySelect = "SELECT password FROM users WHERE id = ?";
    connection.query(querySelect, [userId], async (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      if (results.length === 0) return res.status(404).json({ error: 'User not found' });

      const hashedPassword = results[0].password;

      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, hashedPassword);
      if (!isPasswordValid) return res.status(401).json({ error: 'Current password is incorrect' });

      // Hash the new password
      const newHashedPassword = await bcrypt.hash(newPassword, 10);

      // Update the password in the database
      const queryUpdate = "UPDATE users SET password = ? WHERE id = ?";
      connection.query(queryUpdate, [newHashedPassword, userId], (err, updateResults) => {
        if (err) return res.status(500).json({ error: 'Database query error' });
        console.log("password updated successfully");
        res.json({ message: 'Password updated successfully' });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error updating password' });
  }
});



//==== upload aadhar front and back and pan image for kyc modify ====
// router.put("/:id/kyc", async (req, res) => {
//   const userId = req.params.id;
//   const {
//     aadhar_front = null,
//     aadhar_back = null,
//     pan = null,
//     kycstatus = 0,
//   } = req.body;

//   if (!aadhar_front && !aadhar_back && !pan) {
//     return res.status(400).json({
//       success: false,
//       message: "At least one URL (Aadhar Front, Back, or PAN) is required",
//     });
//   }

//   try {
//     const fieldsToUpdate = [];
//     const values = [];

//     if (aadhar_front) {
//       fieldsToUpdate.push("aadhar_front = ?");
//       values.push(aadhar_front);
//     }
//     if (aadhar_back) {
//       fieldsToUpdate.push("aadhar_back = ?");
//       values.push(aadhar_back);
//     }
//     if (pan) {
//       fieldsToUpdate.push("pan = ?");
//       values.push(pan);
//     }

//     fieldsToUpdate.push("kycstatus = ?");
//     values.push(kycstatus);

//     values.push(userId); // for WHERE clause

//     const query = `
//       UPDATE users 
//       SET ${fieldsToUpdate.join(", ")} 
//       WHERE id = ?
//     `;

//     console.log("Generated Query:", query);
//     console.log("Values:", values);

//     connection.query(query, values, (err, results) => {
//       if (err) {
//         console.error("Database query error:", err);
//         return res.status(500).json({ success: false, message: "DB Error" });
//       }

//       if (results.affectedRows === 0) {
//         return res.status(404).json({ success: false, message: "User not found" });
//       }

//       res.json({
//         success: true,
//         message: "KYC details updated successfully",
//         aadhar_front: aadhar_front || "No change",
//         aadhar_back: aadhar_back || "No change",
//         pan: pan || "No change",
//         kycstatus,
//       });
//     });
//   } catch (error) {
//     console.error("Error updating KYC:", error);
//     res.status(500).json({ success: false, message: "Internal server error" });
//   }
// });
router.put("/:id/kyc", async (req, res) => {
  const userId = req.params.id;
  const {
    aadhar_front = null,
    aadhar_back = null,
    pan = null,
    kyc_note = null,
  } = req.body;

  if (!aadhar_front && !aadhar_back && !pan) {
    return res.status(400).json({
      success: false,
      message: "At least one URL (Aadhar Front, Back, or PAN) is required",
    });
  }

  try {
    const fieldsToUpdate = [];
    const values = [];

    if (aadhar_front) {
      fieldsToUpdate.push("aadhar_front = ?");
      values.push(aadhar_front);
    }

    if (aadhar_back) {
      fieldsToUpdate.push("aadhar_back = ?");
      values.push(aadhar_back);
    }

    if (pan) {
      fieldsToUpdate.push("pan = ?");
      values.push(pan);
    }

    if (kyc_note !== null) {
      fieldsToUpdate.push("kyc_note = ?");
      values.push(kyc_note);
    }

    // Always reset status to "pending" on update
    fieldsToUpdate.push("status = ?");
    values.push("pending");

    values.push(userId); // For WHERE clause

    const query = `
      UPDATE user_kyc_requests 
      SET ${fieldsToUpdate.join(", ")}, updated_at = NOW()
      WHERE user_id = ?
    `;

    console.log("Generated Query:", query);
    console.log("Values:", values);

    connection.query(query, values, (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res.status(500).json({ success: false, message: "DB Error" });
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "KYC record not found for this user" });
      }

      res.json({
        success: true,
        message: "KYC details updated successfully",
        aadhar_front: aadhar_front || "No change",
        aadhar_back: aadhar_back || "No change",
        pan: pan || "No change",
        status: "pending"
      });
    });
  } catch (error) {
    console.error("Error updating KYC:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});



// add balance for existing balance for a specific cryptoname and userId
router.put('/wallet/balance', async (req, res) => {
  const { userId, cryptoname, balance } = req.body;
  // List of cryptocurrencies
  //const cryptocurrencies = ['BTC', 'ETH', 'LTC', 'USDT', 'SOL', 'DOGE', 'BCH', 'XRP', 'TRX', 'EOS', 'INR','CP'];
  // Input validation
  if (!userId || !cryptoname || balance === undefined) {
    return res.status(400).json({ error: 'userId, cryptoname, and balance are required fields.' });
  }

  try {
    const query = `
      UPDATE wallet
      SET balance = balance + ?
      WHERE userId = ? AND cryptoname = ?
    `;

    connection.query(query, [balance, userId, cryptoname], (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database query error' });
      }

      // if (results.affectedRows === 0) {
      //   return res.status(404).json({ error: 'Wallet entry not found for the specified userId and cryptoname.' });
      // }

      res.json({
        message: 'Wallet balance updated successfully',
        userId,
        cryptoname,
        newBalance: `Added ${balance} to the existing balance`,
      });
    });
  } catch (error) {
    console.error('Error updating wallet balance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Update balance for a specific cryptoname and userId
router.put('/wallet/balance/set', async (req, res) => {
  const { userId, cryptoname, balance } = req.body;
  // Input validation
  if (!userId || !cryptoname || balance === undefined) {
    return res.status(400).json({ error: 'userId, cryptoname, and balance are required fields.' });
  }
  try {
    const query = `
      UPDATE wallet
      SET balance = ?
      WHERE userId = ? AND cryptoname = ?
    `;

    connection.query(query, [balance, userId, cryptoname], (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database query error' });
      }

      if (results.affectedRows === 0) {
        return res
          .status(404)
          .json({ error: 'Wallet entry not found for the specified userId and cryptoname.' });
      }

      res.json({
        message: 'Wallet balance updated successfully',
        userId,
        cryptoname,
        newBalance: `Set balance to ${balance}`,
      });
    });
  } catch (error) {
    console.error('Error updating wallet balance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});




router.get('/commissions/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ error: 'Valid userId is required.' });
  }

  try {
    const userQuery = "SELECT id FROM users WHERE id = ?";
    const [userResult] = await new Promise((resolve, reject) => {
      connection.query(userQuery, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    if (!userResult) {
      return res.status(404).json({ error: 'User not found' });
    }

    const commissionsQuery = `
            SELECT cryptoname, total_commissions, updated_at
            FROM usercommissions
            WHERE userId = ?
        `;
    const commissions = await new Promise((resolve, reject) => {
      connection.query(commissionsQuery, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    res.json({
      userId: parseInt(userId),
      commissions: commissions.length > 0 ? commissions : [],
      message: commissions.length > 0 ? 'Total commissions retrieved successfully' : 'No commissions found for this user'
    });
  } catch (error) {
    console.error(`Error retrieving commissions for user ${userId}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/commissions/:userId/:cryptoname', async (req, res) => {
  const { userId, cryptoname } = req.params;

  const validCryptos = ['BTC', 'ETH', 'LTC', 'USDT', 'SOL', 'DOGE', 'BCH', 'XRP', 'TRX', 'EOS', 'INR', 'CP'];

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ error: 'Valid userId is required.' });
  }

  if (!cryptoname || !validCryptos.includes(cryptoname)) {
    return res.status(400).json({ error: 'Valid cryptoname is required.' });
  }

  try {
    const userQuery = "SELECT id FROM users WHERE id = ?";
    const [userResult] = await new Promise((resolve, reject) => {
      connection.query(userQuery, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    if (!userResult) {
      return res.status(404).json({ error: 'User not found' });
    }

    const commissionQuery = `
            SELECT cryptoname, total_commissions, updated_at
            FROM usercommissions
            WHERE userId = ? AND cryptoname = ?
        `;
    const [commission] = await new Promise((resolve, reject) => {
      connection.query(commissionQuery, [userId, cryptoname], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    res.json({
      userId: parseInt(userId),
      cryptoname,
      total_commissions: commission ? commission.total_commissions : 0,
      updated_at: commission ? commission.updated_at : null,
      message: commission ? 'Total commissions retrieved successfully' : 'No commissions found for this user in the specified cryptocurrency'
    });
  } catch (error) {
    console.error(`Error retrieving commissions for user ${userId} in ${cryptoname}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/pending-commissions/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ error: 'Valid userId is required.' });
  }

  try {
    const userQuery = "SELECT id FROM users WHERE id = ?";
    const [userResult] = await new Promise((resolve, reject) => {
      connection.query(userQuery, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    if (!userResult) {
      return res.status(404).json({ error: 'User not found' });
    }

    const pendingCommissionsQuery = `
            SELECT cryptoname, SUM(amount) as pending_amount, COUNT(*) as commission_count
            FROM referralcommissionhistory
            WHERE user_id = ? AND credited = FALSE
            GROUP BY cryptoname
        `;
    const pendingCommissions = await new Promise((resolve, reject) => {
      connection.query(pendingCommissionsQuery, [userId], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    res.json({
      userId: parseInt(userId),
      pendingCommissions: pendingCommissions.length > 0 ? pendingCommissions : [],
      message: pendingCommissions.length > 0 ? 'Pending commissions retrieved successfully' : 'No pending commissions found for this user',
      note: 'Pending commissions will be credited to your wallet at 12:00 AM IST'
    });
  } catch (error) {
    console.error(`Error retrieving pending commissions for user ${userId}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


//==================== how many coupons a user have redeem ======== 
// Get user's coupon redemption history
router.get('/coupons/:userId/', async (req, res) => {
  try {
    const { userId } = req.params;

    // First check if user exists
    const userQuery = "SELECT id, username FROM users WHERE id = ?";
    const [user] = await new Promise((resolve, reject) => {
      connection.query(userQuery, [userId], (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Get coupon redemption history
    const couponQuery = `
      SELECT 
        c.code,
        c.amount,
        cu.used_at as redeemed_at,
        cu.amount_credited,
        CASE 
          WHEN c.expires_at < NOW() THEN 'expired'
          ELSE 'active'
        END as coupon_status
      FROM coupon_usage cu
      JOIN coupons c ON cu.coupon_id = c.id
      WHERE cu.user_id = ?
      ORDER BY cu.used_at DESC
    `;

    const couponHistory = await new Promise((resolve, reject) => {
      connection.query(couponQuery, [userId], (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });

    // Get summary statistics (without first/last redemption)
    const stats = {
      total_coupons_redeemed: couponHistory.length,
      total_amount_credited: couponHistory.reduce((sum, item) => {
        return sum + parseFloat(item.amount_credited || 0);
      }, 0)
    };

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username
      },
      statistics: stats,
      redemption_history: couponHistory
    });

  } catch (error) {
    console.error('Error fetching coupon history:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching coupon history',
      error: error.message
    });
  }
});



//================ Get KYC Details by ID =================
// router.get('/kyc-details/:userId', async (req, res) => {
//   try {
//     const userId = req.params.userId;

//     const kycQuery = `
//             SELECT 
//                 id as user_id,
//                 username,
//                 name,
//                 email,
//                 phone,
//                 aadhar_front as aadhar,
//                 pan,
//                 kycstatus,
//                 kyc_note,
//                 CASE 
//                     WHEN kycstatus = 0 THEN 'Pending'
//                     WHEN kycstatus = 1 THEN 'Approved'
//                     WHEN kycstatus = 2 THEN 'Rejected'
//                     ELSE 'Not Submitted'
//                 END as status_text
//             FROM users
//             WHERE id = ?
//         `;

//     connection.query(kycQuery, [userId], (err, results) => {
//       if (err) {
//         console.error('Database error:', err);
//         return res.status(500).json({
//           success: false,
//           message: "Error fetching KYC details"
//         });
//       }

//       if (results.length === 0) {
//         return res.status(404).json({
//           success: false,
//           message: "User not found"
//         });
//       }

//       const kycDetails = results[0];

//       res.json({
//         success: true,
//         message: "KYC details retrieved successfully",
//         data: {
//           user_id: kycDetails.user_id,
//           personal_details: {
//             username: kycDetails.username,
//             name: kycDetails.name,
//             email: kycDetails.email,
//             phone: kycDetails.phone
//           },
//           kyc_status: {
//             code: kycDetails.kycstatus,
//             text: kycDetails.status_text,
//             note:kycDetails.kyc_note || null

//           },
//           documents: {
//             aadhar: {
//               submitted: !!kycDetails.aadhar,
//               file_name: kycDetails.aadhar || null
//             },
//             pan: {
//               submitted: !!kycDetails.pan,
//               file_name: kycDetails.pan || null
//             }
//           }
//         }
//       });
//     });
//   } catch (error) {
//     console.error('Error fetching KYC details:', error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message
//     });
//   }
// });
router.get('/kyc-details/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    const kycQuery = `
      SELECT 
        u.id AS user_id,
        u.username,
        u.name,
        u.email,
        u.phone,
        k.aadhar_front,
        k.pan,
        k.status AS kycstatus,
        k.kyc_note,
        CASE 
          WHEN k.status = 'pending' THEN 'Pending'
          WHEN k.status = 'approved' THEN 'Approved'
          WHEN k.status = 'rejected' THEN 'Rejected'
          ELSE 'Not Submitted'
        END as status_text
      FROM users u
      LEFT JOIN user_kyc_requests k ON u.id = k.user_id
      WHERE u.id = ?
    `;

    connection.query(kycQuery, [userId], (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({
          success: false,
          message: "Error fetching KYC details"
        });
      }

      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      const kycDetails = results[0];

      res.json({
        success: true,
        message: "KYC details retrieved successfully",
        data: {
          user_id: kycDetails.user_id,
          personal_details: {
            username: kycDetails.username,
            name: kycDetails.name,
            email: kycDetails.email,
            phone: kycDetails.phone
          },
          kyc_status: {
            code: kycDetails.kycstatus || 'not_submitted',
            text: kycDetails.status_text,
            note: kycDetails.kyc_note || null
          },
          documents: {
            aadhar: {
              submitted: !!kycDetails.aadhar_front,
              file_name: kycDetails.aadhar_front || null
            },
            pan: {
              submitted: !!kycDetails.pan,
              file_name: kycDetails.pan || null
            }
          }
        }
      });
    });
  } catch (error) {
    console.error('Error fetching KYC details:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});
















module.exports = router;
