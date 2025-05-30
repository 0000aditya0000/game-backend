const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const connection = require('../config/db');
const { createSession } = require("../utils/session");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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

// User registration
router.post('/register', async (req, res) => {
  const { name, username, email, phoneNumber, referalCode, password, myReferralCode } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    // Step 1: Get referred user's ID (if referral code is provided)
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

    // Step 2: Insert the user
    const query = `
      INSERT INTO users (username, name, email, password, phone, my_referral_code, referred_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    connection.query(query, [username, name, email, hashedPassword, phoneNumber, myReferralCode, referredById], async (err, results) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ error: 'Database error' });
      }

      const userId = results.insertId;
      if (referredById) {
        await propagateReferral(userId, referredById);
      }
      // Step 3: Create wallet entries
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
    res.status(500).json({ error: 'Error registering user' });
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
router.get("/referrals/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // Get all referrals for this user up to level 5
    const referrals = await new Promise((resolve, reject) => {
      connection.query(
        "SELECT u.id, u.name, u.username, u.email, r.level FROM referrals r JOIN users u ON r.referred_id = u.id WHERE r.referrer_id = ? ORDER BY r.level",
        [userId],
        (err, results) => {
          if (err) return reject(err);
          resolve(results);
        }
      );
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
// User login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Query to find the user by email
    const query = "SELECT * FROM users WHERE email = ?";
    connection.query(query, [email], async (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      if (results.length === 0) return res.status(404).json({ error: 'User not found' });

      const user = results[0];

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

      // Create session (deletes old one and inserts new one)
      const token = await createSession(user.id);

      // Fetch wallet details for the logged-in user
      const walletQuery = "SELECT * FROM wallet WHERE userId = ?";
      connection.query(walletQuery, [user.id], (err, walletResults) => {
        if (err) return res.status(500).json({ error: 'Error fetching wallet data' });

        // Send the user profile and wallet data in the response
        res.json({
          token,
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
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error logging in user' });
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

//Get one user by id
router.get('/user/:id', async (req, res) => {
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


// kyc request from user end
router.put(
  "/user/:id/kyc",
  upload.fields([
    { name: "aadharImage", maxCount: 1 },
    { name: "panImage", maxCount: 1 },
  ]),
  async (req, res) => {
    const userId = req.params.id;
    const { kycstatus = 0 } = req.body;

    console.log("Files received in request:", req.files);
    console.log("Body:", req.body);

    const aadhar = req.files?.aadharImage?.[0]?.filename || null;
    const pan = req.files?.panImage?.[0]?.filename || null;

    console.log("Processed Inputs:", { aadhar, pan, kycstatus, userId });

    if (!aadhar && !pan) {
      return res
        .status(400)
        .json({ error: "At least one image is required for KYC update" });
    }

    try {
      const fieldsToUpdate = [];
      const values = [];

      if (aadhar) {
        fieldsToUpdate.push("aadhar = ?");
        values.push(aadhar);
      }
      if (pan) {
        fieldsToUpdate.push("pan = ?");
        values.push(pan);
      }

      fieldsToUpdate.push("kycstatus = ?");
      values.push(kycstatus);
      values.push(userId);

      const query = `
        UPDATE users 
        SET ${fieldsToUpdate.join(", ")} 
        WHERE id = ?
      `;

      console.log("Generated Query:", query);
      console.log("Query Values:", values);

      connection.query(query, [aadhar, pan, kycstatus, userId], (err, results) => {
        if (err) {
          console.error("Database query error:", err);
          return res.status(500).json({ error: "Database query error" });
        }

        if (results.affectedRows === 0) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json({
          message: "KYC details updated successfully",
          aadhar: aadhar || "No change",
          pan: pan || "No change",
          kycstatus,
        });
      });
    } catch (error) {
      console.error("Error updating KYC details:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);


// upload aadhar front and back and pan image for kyc

router.put(
  "/:id/kyc",
  upload.fields([
    { name: "aadharFront", maxCount: 1 },
    { name: "aadharBack", maxCount: 1 },
    { name: "panImage", maxCount: 1 },
  ]),
  async (req, res) => {
    const userId = req.params.id;
    const { kycstatus = 0 } = req.body;

    console.log("Files received in request:", req.files);

    const aadharFront = req.files?.aadharFront?.[0]?.filename || null;
    const aadharBack = req.files?.aadharBack?.[0]?.filename || null;
    const pan = req.files?.panImage?.[0]?.filename || null;

    if (!aadharFront && !aadharBack && !pan) {
      return res.status(400).json({
        error: "At least one image (Aadhar Front, Back, or PAN) is required",
      });
    }

    try {
      const fieldsToUpdate = [];
      const values = [];

      if (aadharFront) {
        fieldsToUpdate.push("aadhar_front = ?");
        values.push(aadharFront);
      }
      if (aadharBack) {
        fieldsToUpdate.push("aadhar_back = ?");
        values.push(aadharBack);
      }
      if (pan) {
        fieldsToUpdate.push("pan = ?");
        values.push(pan);
      }

      fieldsToUpdate.push("kycstatus = ?");
      values.push(kycstatus);
      values.push(userId);

      const query = `
        UPDATE users 
        SET ${fieldsToUpdate.join(", ")} 
        WHERE id = ?
      `;

      console.log("Generated Query:", query);
      console.log("Query Values:", values);

      connection.query(query, values, (err, results) => {
        if (err) {
          console.error("Database query error:", err);
          return res.status(500).json({ error: "Database query error" });
        }

        if (results.affectedRows === 0) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json({
          message: "KYC details updated successfully",
          aadharFront: aadharFront || "No change",
          aadharBack: aadharBack || "No change",
          pan: pan || "No change",
          kycstatus,
        });
      });
    } catch (error) {
      console.error("Error updating KYC details:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);




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

router.post('/deposit', async (req, res) => {
  const { userId, amount, cryptoname } = req.body;
  const { calculateCommissions } = require('../utils/commission');

  const validCryptos = ['BTC', 'ETH', 'LTC', 'USDT', 'SOL', 'DOGE', 'BCH', 'XRP', 'TRX', 'EOS', 'INR', 'CP'];

  if (!userId || !amount || amount <= 0 || !cryptoname) {
    return res.status(400).json({ error: 'userId, amount (positive), and cryptoname are required fields.' });
  }

  if (!validCryptos.includes(cryptoname)) {
    return res.status(400).json({ error: 'Invalid cryptoname.' });
  }

  try {
    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) return reject(err);
        resolve();
      });
    });

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

    const depositCheckQuery = "SELECT id FROM deposits WHERE userId = ? AND cryptoname = ? LIMIT 1";
    const [depositResult] = await new Promise((resolve, reject) => {
      connection.query(depositCheckQuery, [userId, cryptoname], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    const isFirstDeposit = !depositResult;

    const updateWalletQuery = `
            UPDATE wallet
            SET balance = balance + ?
            WHERE userId = ? AND cryptoname = ?
        `;
    const walletResult = await new Promise((resolve, reject) => {
      connection.query(updateWalletQuery, [amount, userId, cryptoname], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    if (walletResult.affectedRows === 0) {
      throw new Error(`Wallet entry for ${cryptoname} not found for the specified userId.`);
    }

    const insertDepositQuery = `
            INSERT INTO deposits (userId, amount, cryptoname, is_first)
            VALUES (?, ?, ?, ?)
        `;
    await new Promise((resolve, reject) => {
      connection.query(insertDepositQuery, [userId, amount, cryptoname, isFirstDeposit], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    let commissionsDistributed = false;
    if (isFirstDeposit) {
      const referrerId = userResult.referred_by || null;
      if (referrerId) {
        const commissions = await calculateCommissions(amount, referrerId, cryptoname, connection);
        for (const commission of commissions) {
          const logQuery = `
                        INSERT INTO referralcommissionhistory (user_id, referred_user_id, level, rebate_level, amount, deposit_amount, cryptoname, credited)
                        VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)
                    `;
          await new Promise((resolve, reject) => {
            connection.query(logQuery, [
              commission.userId,
              userId,
              commission.level,
              commission.rebateLevel,
              commission.commission,
              amount,
              cryptoname
            ], (err, results) => {
              if (err) return reject(err);
              resolve(results);
            });
          });
        }
        commissionsDistributed = true;
      }
    }

    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) return reject(err);
        resolve();
      });
    });

    res.json({
      message: `Deposit in ${cryptoname} processed successfully`,
      userId,
      cryptoname,
      amount,
      isFirstDeposit,
      commissionsDistributed,
      note: commissionsDistributed ? 'Commissions will be credited to wallets at 12:00 AM IST' : undefined
    });
  } catch (error) {
    console.error(`Error processing deposit in ${cryptoname}:`, error);
    await new Promise((resolve) => {
      connection.rollback(() => resolve());
    });
    res.status(error.message === 'User not found' || error.message.includes('Wallet entry') ? 404 : 500).json({ error: error.message || 'Internal server error' });
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


//============== Get  user related all data by userId =================

router.get('/user-all-data/:userId', async (req, res) => {
  const userId = req.params.userId;

  try {
    // Get user basic information
    const userQuery = "SELECT * FROM users WHERE id = ?";
    const [userDetails] = await new Promise((resolve, reject) => {
      connection.query(userQuery, [userId], (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });

    if (!userDetails) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get wallet information
    const walletQuery = "SELECT * FROM wallet WHERE userId = ?";
    const walletDetails = await new Promise((resolve, reject) => {
      connection.query(walletQuery, [userId], (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });

    // Get bank account information
    const bankQuery = "SELECT * FROM bankaccount WHERE userId = ?";
    const bankDetails = await new Promise((resolve, reject) => {
      connection.query(bankQuery, [userId], (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });

    // Get referral information
    const referralQuery = `
            SELECT r.*, u.username as referred_username 
            FROM referrals r 
            JOIN users u ON r.referred_id = u.id 
            WHERE r.referrer_id = ?`;
    const referralDetails = await new Promise((resolve, reject) => {
      connection.query(referralQuery, [userId], (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });


    // Get withdrawal information
    const withdrawalQuery = "SELECT * FROM withdrawl WHERE userId = ?";
    const withdrawalDetails = await new Promise((resolve, reject) => {
      connection.query(withdrawalQuery, [userId], (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });



    // Combine all data
    const userData = {
      user: {
        ...userDetails,
        password: undefined // Remove sensitive data
      },
      wallet: walletDetails,
      bankAccounts: bankDetails,
      referrals: referralDetails,
      withdrawals: withdrawalDetails,
      kyc: {
        status: userDetails.kycstatus,
        aadhar: userDetails.aadhar,
        pan: userDetails.pan
      }
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

// ===================== Get all users with related data =====================
router.get('/all-users-data', async (req, res) => {
  try {
    // Get all users basic information
    const userQuery = "SELECT * FROM users";
    const allUsers = await new Promise((resolve, reject) => {
      connection.query(userQuery, (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });

    if (!allUsers.length) {
      return res.status(404).json({ error: 'No users found' });
    }

    // Get all related data for each user
    const allUsersData = await Promise.all(allUsers.map(async (user) => {
      // Get wallet information
      const walletQuery = "SELECT * FROM wallet WHERE userId = ?";
      const walletDetails = await new Promise((resolve, reject) => {
        connection.query(walletQuery, [user.id], (err, results) => {
          if (err) reject(err);
          resolve(results);
        });
      });

      // Get bank account information
      const bankQuery = "SELECT * FROM bankaccount WHERE userId = ?";
      const bankDetails = await new Promise((resolve, reject) => {
        connection.query(bankQuery, [user.id], (err, results) => {
          if (err) reject(err);
          resolve(results);
        });
      });

      // Get referral information
      const referralQuery = `
        SELECT r.*, u.username as referred_username 
        FROM referrals r 
        JOIN users u ON r.referred_id = u.id 
        WHERE r.referrer_id = ?`;
      const referralDetails = await new Promise((resolve, reject) => {
        connection.query(referralQuery, [user.id], (err, results) => {
          if (err) reject(err);
          resolve(results);
        });
      });

      // Get withdrawal information
      const withdrawalQuery = "SELECT * FROM withdrawl WHERE userId = ?";
      const withdrawalDetails = await new Promise((resolve, reject) => {
        connection.query(withdrawalQuery, [user.id], (err, results) => {
          if (err) reject(err);
          resolve(results);
        });
      });

      // Return combined user data
      return {
        user: {
          ...user,
          password: undefined // Remove sensitive data
        },
        wallet: walletDetails,
        bankAccounts: bankDetails,
        referrals: referralDetails,
        withdrawals: withdrawalDetails,
        kyc: {
          status: user.kycstatus,
          aadhar: user.aadhar,
          pan: user.pan
        }
      };
    }));

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

//================= Get user betting statistics ==========
router.get('/user-bet-stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate input
    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    // Query to get user's betting statistics
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
                SUM(CASE 
                    WHEN bet_type = 'color' THEN amount
                    ELSE 0 
                END) as color_bets_amount,
                SUM(CASE 
                    WHEN bet_type = 'number' THEN amount
                    ELSE 0 
                END) as number_bets_amount,
                SUM(CASE 
                    WHEN bet_type = 'size' THEN amount
                    ELSE 0 
                END) as size_bets_amount
            FROM bets b
            LEFT JOIN result r ON b.period_number = r.period_number
            WHERE b.user_id = ? AND b.status = 'processed'
            GROUP BY b.user_id`;

    // Get recent bets
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
            LIMIT 10`;

    // Execute both queries using connection instead of pool
    const [stats, recentBets] = await Promise.all([
      new Promise((resolve, reject) => {
        connection.query(statsQuery, [userId], (err, results) => {
          if (err) reject(err);
          resolve(results[0]);
        });
      }),
      new Promise((resolve, reject) => {
        connection.query(recentBetsQuery, [userId], (err, results) => {
          if (err) reject(err);
          resolve(results);
        });
      })
    ]);

    if (!stats) {
      return res.status(404).json({
        success: false,
        message: "No betting history found for this user"
      });
    }

    const profitLoss = parseFloat(stats.total_winnings || 0) - parseFloat(stats.total_bet_amount || 0);

    res.json({
      success: true,
      statistics: {
        total_bets: parseInt(stats.total_bets || 0),
        total_bet_amount: parseFloat(stats.total_bet_amount || 0),
        total_winnings: parseFloat(stats.total_winnings || 0),
        total_wins: parseInt(stats.total_wins || 0),
        win_rate: stats.total_bets ? ((stats.total_wins / stats.total_bets) * 100).toFixed(2) : "0.00",
        profit_loss: profitLoss,
        bet_distribution: {
          color: parseFloat(stats.color_bets_amount || 0),
          number: parseFloat(stats.number_bets_amount || 0),
          size: parseFloat(stats.size_bets_amount || 0)
        }
      },
      recent_bets: recentBets.map(bet => ({
        period_number: bet.period_number,
        bet_type: bet.bet_type,
        bet_value: bet.bet_value,
        amount: parseFloat(bet.amount),
        winnings: parseFloat(bet.winnings),
        result: bet.result,
        placed_at: bet.placed_at
      }))
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

//================ Get KYC Details by ID =================
router.get('/kyc-details/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    const kycQuery = `
            SELECT 
                id as user_id,
                username,
                name,
                email,
                phone,
                aadhar,
                pan,
                kycstatus,
                CASE 
                    WHEN kycstatus = 0 THEN 'Pending'
                    WHEN kycstatus = 1 THEN 'Approved'
                    WHEN kycstatus = 2 THEN 'Rejected'
                    ELSE 'Not Submitted'
                END as status_text
            FROM users
            WHERE id = ?
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
            code: kycDetails.kycstatus,
            text: kycDetails.status_text
          },
          documents: {
            aadhar: {
              submitted: !!kycDetails.aadhar,
              file_name: kycDetails.aadhar || null
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

//================ KYC Approval by Admin =================
router.put('/kyc/approve/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const { status } = req.body; // status should be 0 (pending), 1 (approved), or 2 (rejected)

    console.log('Received request:', { userId, status }); // Debug log

    if (![0, 1, 2].includes(Number(status))) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value. Use 0 for pending, 1 for approved, 2 for rejected"
      });
    }

    // First check if user has uploaded KYC documents
    const checkQuery = `
      SELECT aadhar_front,aadhar_back, pan, kycstatus 
      FROM users 
      WHERE id = ?
    `;

    // Convert to Promise-based query for better error handling
    const checkUser = () => {
      return new Promise((resolve, reject) => {
        connection.query(checkQuery, [userId], (err, results) => {
          if (err) {
            console.error('Database error in checkQuery:', err); // Debug log
            reject(err);
            return;
          }
          resolve(results);
        });
      });
    };

    const results = await checkUser();

    if (!results || results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const user = results[0];

    // Check if documents are uploaded
    if (!user.aadhar && !user.pan) {
      return res.status(400).json({
        success: false,
        message: "Cannot process KYC. No documents uploaded",
        missing_documents: {
          aadhar: !user.aadhar,
          pan: !user.pan
        }
      });
    }

    // Update KYC status
    const updateQuery = `
      UPDATE users 
      SET kycstatus = ?
      WHERE id = ?
    `;

    // Convert update query to Promise
    const updateStatus = () => {
      return new Promise((resolve, reject) => {
        connection.query(updateQuery, [status, userId], (err, result) => {
          if (err) {
            console.error('Database error in updateQuery:', err); // Debug log
            reject(err);
            return;
          }
          resolve(result);
        });
      });
    };

    const updateResult = await updateStatus();

    res.json({
      success: true,
      message: `KYC ${status === 1 ? 'approved' : status === 2 ? 'rejected' : 'set to pending'} successfully`,
      data: {
        user_id: userId,
        new_status: status,
        status_text: status === 1 ? 'Approved' : status === 2 ? 'Rejected' : 'Pending',
        documents: {
          aadhar: user.aadhar ? "Submitted" : "Not submitted",
          pan: user.pan ? "Submitted" : "Not submitted"
        }
      }
    });

  } catch (error) {
    console.error('Error processing KYC:', error); // Debug log
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

//================ Get All Users with Pending KYC =================

router.get('/pending-kyc', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const status = parseInt(req.query.status); // Get status from query params
    const limit = 20;
    const offset = (page - 1) * limit;

    // Get server URL from request object
    const serverUrl = `${req.protocol}://${req.get('host')}`;

    // Validate status parameter
    if (![0, 1, 2, 3].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value. Use 0 for pending, 1 for approved, 2 for rejected, 3 for all"
      });
    }

    // Build WHERE clause based on status
    const whereClause = status === 3 ? '' : 'WHERE kycstatus = ?';

    // Query to get total users based on status
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM users 
      ${whereClause}
    `;

    const countParams = status === 3 ? [] : [status];

    connection.query(countQuery, countParams, (countErr, countResult) => {
      if (countErr) {
        console.error('Count query error:', countErr);
        return res.status(500).json({
          success: false,
          message: "Error counting KYC users",
          error: countErr.message
        });
      }

      const totalUsers = countResult[0].total;
      const totalPages = Math.ceil(totalUsers / limit);

      // Now fetch paginated data with updated fields
      const dataQuery = `
        SELECT 
          id,
          username,
          name,
          email,
          phone,
          aadhar_front,
          aadhar_back,
          pan,
          kycstatus,
          my_referral_code
        FROM users 
        ${whereClause}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `;

      const queryParams = status === 3 
        ? [limit, offset] 
        : [status, limit, offset];

      connection.query(dataQuery, queryParams, (err, results) => {
        if (err) {
          console.error('Data fetch error:', err);
          return res.status(500).json({
            success: false,
            message: "Error fetching KYC users",
            error: err.message
          });
        }

        const statusText = {
          0: 'Pending',
          1: 'Approved',
          2: 'Rejected',
          3: 'All'
        };

        res.json({
          success: true,
          message: `${statusText[status]} KYC users retrieved successfully`,
          total_items: totalUsers,
          total_pages: totalPages,
          current_page: page,
          items_per_page: limit,
          status: status,
          status_text: statusText[status],
          data: results.map(user => ({
            user_id: user.id,
            username: user.username,
            name: user.name,
            email: user.email,
            phone: user.phone,
            referral_code: user.my_referral_code,
            kyc_status: {
              code: user.kycstatus,
              text: statusText[user.kycstatus]
            },
            documents: {
              aadharfront: user.aadhar_front ? `${serverUrl}/uploads/${user.aadhar_front}` : null,
              aadharback: user.aadhar_back ? `${serverUrl}/uploads/${user.aadhar_back}` : null,
              pan: user.pan ? `${serverUrl}/uploads/${user.pan}` : null
            }
          }))
        });
      });
    });

  } catch (error) {
    console.error('Error fetching KYC users:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
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


module.exports = router;






