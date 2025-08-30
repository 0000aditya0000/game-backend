const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();
const connection = require('../config/db'); // Ensure your DB connection is set up

// Admin login
router.post('/admin-login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const query = "SELECT * FROM admins WHERE username = ?";
    connection.query(query, [username], async (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      if (results.length === 0) return res.status(404).json({ error: 'Admin not found' });

      const admin = results[0];
      if (admin.password !== password) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign({ id: admin.id, isAdmin: true }, process.env.JWT_SECRET, { expiresIn: '1h' });
      res.json({ token });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error logging in admin' });
  }
});

// Create a new user
router.post('/user', async (req, res) => {
  const { username, email, password, phone, dob } = req.body;
  const referalCode = "admin"
  console.log(req.body,"req.body");

  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the user into the 'users' table
    const query = "INSERT INTO users (username, email, password, phone, dob, code) VALUES (?, ?, ?, ?, ?, ?)";
    connection.query(query, [username, email, hashedPassword, phone, dob, referalCode], (err, results) => {
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


//================================= add/delete games in gamedata table =========================

// Add a new game (admin only)
router.post('/addgames', (req, res) => {
  const { game_name,  game_type, image  } = req.body;

  if (!game_name || !game_type || !image ) {
    return res.status(400).json({ error: 'Please provide all required fields' });
  }

  const query = "INSERT INTO games (name,type,image) VALUES (?, ?, ?)";
  connection.query(query, [game_name, game_type,image], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error while adding game' });
    }
    res.status(201).json({ message: 'Game added successfully', gameId: results.insertId });
  });
});

// Delete a game by ID (admin only)
router.delete('/games/:id', (req, res) => {
  const gameId = req.params.id;

  const query = "DELETE FROM games WHERE id = ?";
  connection.query(query, [gameId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error while deleting game' });
    }
    if (results.affectedRows === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    res.json({ message: 'Game deleted successfully' });
  });
});

//======== Disable/Enable user login by Admin ==========

router.post('/disable-login', async (req, res) => {
  const { userId, disable } = req.body;

  if (!userId || typeof disable === 'undefined') {
    return res.status(400).json({ error: 'userId and disable (true/false) required' });
  }

  try {
    const query = "UPDATE users SET is_login_disabled = ? WHERE id = ?";
    connection.query(query, [disable ? 1 : 0, userId], (err, result) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      res.json({ message: `User login has been ${disable ? 'disabled' : 'enabled'}` });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

//==================== GET /admin/user-logins-logs
router.get('/user-logins', async (req, res) => {
  const page = parseInt(req.query.page) || 1;       // default page = 1
  const limit = parseInt(req.query.limit) || 30;    // default limit = 30
  const offset = (page - 1) * limit;

  try {
    const countQuery = "SELECT COUNT(*) as total FROM user_login_logs";
    connection.query(countQuery, (err, countResult) => {
      if (err) {
        console.error("Count error:", err);
        return res.status(500).json({ success: false, message: "Error counting records" });
      }

      const totalRecords = countResult[0].total;
      const totalPages = Math.ceil(totalRecords / limit);

      const query = "SELECT * FROM user_login_logs ORDER BY login_datetime DESC LIMIT ? OFFSET ?";
      connection.query(query, [limit, offset], (err, results) => {
        if (err) {
          console.error("Query error:", err);
          return res.status(500).json({ success: false, message: "Database error" });
        }

        res.json({
          success: true,
          pagination: {
            currentPage: page,
            totalPages,
            totalRecords,
            limit
          },
         data: results
        });
      });
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, message: "Error fetching logs" });
  }
});

//==================== Block/Unblock user withdrawal by Admin
router.post('/block-withdrawal', (req, res) => {
  const { userId, block } = req.body;
  if (!userId || typeof block === 'undefined') {
    return res.status(400).json({ error: 'userId and block (true/false) required' });
  }

  const query = "UPDATE users SET is_withdrawal_blocked = ? WHERE id = ?";
  connection.query(query, [block ? 1 : 0, userId], (err) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    res.json({ message: `User withdrawal has been ${block ? 'blocked' : 'unblocked'} successfully.` });
  });
});

// =================== Admin: Block or Unblock IP ===================
router.post('/block-ip', async (req, res) => {
  const { ip, block } = req.body; // true=block IP,false=unblock IP

  if (!ip || typeof block === 'undefined') {
    return res.status(400).json({ error: 'ip and block (true/false) required' });
  }

  try {
    if (block) {
      // Block IP
      const query = "INSERT IGNORE INTO blocked_ips (ip_address) VALUES (?)";
      connection.query(query, [ip], (err) => {
        if (err) return res.status(500).json({ error: 'Database error while blocking IP' });
        res.json({ message: `IP ${ip} has been blocked` });
      });
    } else {
      // Unblock IP
      const query = "DELETE FROM blocked_ips WHERE ip_address = ?";
      connection.query(query, [ip], (err) => {
        if (err) return res.status(500).json({ error: 'Database error while unblocking IP' });
        res.json({ message: `IP ${ip} has been unblocked` });
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});


// =================== Admin: Get Blocked IPs ===================
router.get('/blocked-ips', (req, res) => {
  const query = "SELECT * FROM blocked_ips ORDER BY blocked_at DESC";
  connection.query(query, (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ blockedIps: results });
  });
});


//================== Admin: Edit User Bonus Balance ===================
router.put("/edit-bonus", (req, res) => {
  const { userId, bonus } = req.body;
  const newBonusNum = parseFloat(bonus);

  if (!userId || isNaN(newBonusNum) || newBonusNum < 0) {
    return res.status(400).json({ success: false, message: "Invalid input" });
  }

  connection.beginTransaction(err => {
    if (err) {
      console.error("Begin transaction error:", err);
      return res.status(500).json({ success: false, message: "DB transaction error" });
    }

    //  INR wallet row
    const getWalletQuery = `
      SELECT bonus_balance 
      FROM wallet 
      WHERE userId = ? AND cryptoname = 'INR' 
      FOR UPDATE
    `;
    connection.query(getWalletQuery, [userId], (walletErr, walletRows) => {
      if (walletErr) {
        console.error("Wallet query error:", walletErr);
        return connection.rollback(() => res.status(500).json({ success: false, message: "Error fetching wallet", error: walletErr.message }));
      }

      if (!walletRows || walletRows.length === 0) {
        return connection.rollback(() => res.status(404).json({ success: false, message: "INR Wallet not found" }));
      }

      const wallet = walletRows[0];
      const bonusBefore = parseFloat(wallet.bonus_balance || 0);

      const updateWalletQuery = `
        UPDATE wallet 
        SET bonus_balance = ? 
        WHERE userId = ? AND cryptoname = 'INR'
      `;
      connection.query(updateWalletQuery, [newBonusNum, userId], (updErr) => {
        if (updErr) {
          console.error("Update wallet error:", updErr);
          return connection.rollback(() => res.status(500).json({ success: false, message: "Error updating wallet", error: updErr.message }));
        }

        //  Insert into history
        // const insertHistoryQuery = `
        //   INSERT INTO bonus_transfer_history 
        //     (userId, amount, bonus_balance_before, bonus_balance_after, wallet_balance_before, wallet_balance_after)
        //   VALUES (?, ?, ?, ?, 0, 0)
        // `;
        // connection.query(insertHistoryQuery, [userId, newBonusNum - bonusBefore, bonusBefore, newBonusNum, 0, 0], (histErr) => {
        //   if (histErr) {
        //     console.error("Insert history error:", histErr);
        //     return connection.rollback(() => res.status(500).json({ success: false, message: "Error saving history", error: histErr.message }));
        //   }

          connection.commit(commitErr => {
            if (commitErr) {
              console.error("Commit error:", commitErr);
              return connection.rollback(() => res.status(500).json({ success: false, message: "Commit failed", error: commitErr.message }));
            }

            return res.json({
              success: true,
              message: "Bonus balance updated successfully",
              data: {
                userId,
                bonus_before: bonusBefore,
                bonus_after: newBonusNum
              }
            });
          });
       // });
      });
    });
  });
});




module.exports = router;
