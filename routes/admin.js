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



module.exports = router;
