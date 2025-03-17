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
  const { name, email, password, phoneNumber, dob, referalCode } = req.body;

  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the user into the 'users' table
    const query = "INSERT INTO users (username, email, password, phone, dob, code) VALUES (?, ?, ?, ?, ?, ?)";
    connection.query(query, [name, email, hashedPassword, phoneNumber, dob, referalCode], (err, results) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ error: 'Database error' });
      }

      // Get the newly created user's ID
      const userId = results.insertId;

      // List of cryptocurrencies
      const cryptocurrencies = ['BTC', 'ETH', 'LTC', 'USDT', 'SOL', 'DOGE', 'BCH', 'XRP', 'TRX', 'EOS', 'INR','CP'];

      // Generate wallet entries for the new user
      const walletQuery = "INSERT INTO wallet (userId, balance, cryptoname) VALUES ?";
      const walletValues = cryptocurrencies.map(crypto => [userId, 0, crypto]);

      // Insert wallet entries into the 'wallet' table
      connection.query(walletQuery, [walletValues], (err, walletResults) => {
        if (err) {
          console.log(err);
          return res.status(500).json({ error: 'Error creating wallet entries' });
        }

        // Respond with a success message
        res.status(201).json({ message: 'User registered and wallet initialized successfully' });
      });
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Error registering user' });
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

      // Fetch wallet details for the logged-in user
      const walletQuery = "SELECT * FROM wallet WHERE userId = ?";
      connection.query(walletQuery, [user.id], (err, walletResults) => {
        if (err) return res.status(500).json({ error: 'Error fetching wallet data' });

        // Generate JWT token
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // Send the user profile and wallet data in the response
        res.json({
          token,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            phone: user.phone,
            dob: user.dob,
            referalCode: user.code
            
          },
          wallet: walletResults, // Include wallet data
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
router.put('/user/:id', async (req, res) => {
  const userId = req.params.id;
  const { username, email, phone, dob } = req.body;

  try {
    const query = "UPDATE users SET username = ?, email = ?, phone = ?, dob = ? WHERE id = ?";
    connection.query(query, [username, email, phone, dob, userId], (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      if (results.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
      console.log("User details updated successfully");
      res.json({ message: 'User details updated successfully' });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error updating user details' });
  }
});

// Update user password by ID
router.put('/user/:id/password', async (req, res) => {
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
