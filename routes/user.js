const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const connection = require('../config/db');
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

          // **Invalidate previous session** (Delete any existing session for the user)
          const deleteSessionQuery = "DELETE FROM sessions WHERE user_id = ?";
          connection.query(deleteSessionQuery, [user.id], (err) => {
              if (err) console.error('Error deleting previous session:', err);
          });

          // Generate new JWT token
          const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

          // **Store new session in DB**
          const insertSessionQuery = "INSERT INTO sessions (user_id, token) VALUES (?, ?)";
          connection.query(insertSessionQuery, [user.id, token], (err) => {
              if (err) console.error('Error saving session:', err);
          });

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
  const { username,name, email, phone,image } = req.body;
  console.log(req.body, "body");
  try {
    const query = "UPDATE users SET username = ?,name = ?, email = ?, phone = ?, image = ? WHERE id = ?";
    connection.query(query, [username,name, email, phone,image, userId], (err, results) => {
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

      connection.query(query, [aadhar,pan,kycstatus,userId], (err, results) => {
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


module.exports = router;
