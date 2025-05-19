const express = require('express');
const connection = require('../config/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs')

const router = express.Router();

// Set up storage for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// Get all games
router.get('/allgames', async (req, res) => {
  try {
    const query = "SELECT * FROM games";
    connection.query(query, (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      res.json(results);
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching games' });
  }
});

// Get a game by ID
router.get('/game/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const query = "SELECT * FROM games WHERE id = ?";
    connection.query(query, [id], (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      if (results.length === 0) return res.status(404).json({ error: 'Game not found' });
      res.json(results[0]);
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching game' });
  }
});

// Create a new game
router.post('/addgame', upload.single('image'), async (req, res) => {
  const { name, popularity, description, type } = req.body;
  const image = req.file ? req.file.filename : null;
  try {
    const query = "INSERT INTO games (name, image, popularity, description,type) VALUES (?, ?, ?, ?, ?)";
    connection.query(query, [name, image, popularity, description, type], (err, results) => {
      if (err) return res.status(500).json({ error: 'Database insertion error' });
      res.status(201).json({ message: 'Game added successfully', id: results.insertId });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error adding game' });
  }
});

// Update a game by ID
router.put('/updategame/:id', upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { name, popularity, description, type } = req.body;
  const image = req.file ? req.file.filename : null;

  try {
    // Check if the game exists
    const checkQuery = "SELECT * FROM games WHERE id = ?";
    connection.query(checkQuery, [id], (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      if (results.length === 0) return res.status(404).json({ error: 'Game not found' });

      // Prepare update query dynamically
      let updateQuery = "UPDATE games SET ";
      const updates = [];
      const values = [];

      if (name) {
        updates.push("name = ?");
        values.push(name);
      }
      if (popularity) {
        updates.push("popularity = ?");
        values.push(popularity);
      }
      if (description) {
        updates.push("description = ?");
        values.push(description);
      }
      if (type) {
        updates.push("type = ?");
        values.push(type);
      }
      if (image) {
        updates.push("image = ?");
        values.push(image);

        // Delete the old image if a new one is uploaded
        const oldImage = results[0].image;
        if (oldImage) {
          const oldImagePath = path.join(__dirname, '../uploads', oldImage);
          if (fs.existsSync(oldImagePath)) {
            fs.unlinkSync(oldImagePath);
          }
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields provided for update' });
      }

      updateQuery += updates.join(", ") + " WHERE id = ?";
      values.push(id);

      // Execute the update query
      connection.query(updateQuery, values, (err, updateResults) => {
        if (err) return res.status(500).json({ error: 'Database update error' });
        res.json({ message: 'Game updated successfully' });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error updating game' });
  }
});

// Delete a game by ID
router.delete('/deletegame/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const query = "DELETE FROM games WHERE id = ?";
    connection.query(query, [id], (err, results) => {
      if (err) return res.status(500).json({ error: 'Database deletion error' });
      if (results.affectedRows === 0) return res.status(404).json({ error: 'Game not found' });
      res.json({ message: 'Game deleted successfully' });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting game' });
  }
});

// Delete games by filter
router.delete('/deletegames', async (req, res) => {
  const { name, image, popularity, description } = req.body;
  try {
    let query = "DELETE FROM games WHERE ";
    const filters = [];
    const values = [];

    if (name) { filters.push("name = ?"); values.push(name); }
    if (image) { filters.push("image = ?"); values.push(image); }
    if (popularity) { filters.push("popularity = ?"); values.push(popularity); }
    if (description) { filters.push("description = ?"); values.push(description); }

    if (filters.length === 0) return res.status(400).json({ error: 'No filters provided' });

    query += filters.join(" AND ");
    connection.query(query, values, (err, results) => {
      if (err) return res.status(500).json({ error: 'Database deletion error' });
      res.json({ message: 'Games deleted successfully', affectedRows: results.affectedRows });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting games' });
  }
});

//========================= gamesData Table ========================= 

// Bulk import from JSON folder
router.post('/bulkimport', async (req, res) => {
  try {
    const gamesDir = path.join(__dirname, '../gamesData');
    if (!fs.existsSync(gamesDir)) {
      return res.status(404).json({ error: 'Games directory not found' });
    }
    const files = fs.readdirSync(gamesDir);
    const allGames = [];

    files.forEach(file => {
      if (path.extname(file) === '.json') {
        const filePath = path.join(gamesDir, file);
        const games = require(filePath);
        allGames.push(...games);
      }
    });



    const query = "INSERT INTO games (name,type,image) VALUES ? ";
    const values = allGames.map(game => [game.game_name, game.game_type, game.icon]);

    connection.query(query, [values], (err, results) => {
      if (err) return res.status(500).json({ error: 'Bulk import error' });
      res.status(201).json({ message: 'Games imported successfully', inserted: results.affectedRows });
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: 'Error importing games' });
  }
});

// Fetch all games data from gamesData table
router.get('/all-games', async (req, res) => {
  try {
    const query = "SELECT * FROM games";
    connection.query(query, (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      const totalCount = results.length;
      res.status(200).json({ totalCount, data: results });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching games data' });
  }
});


module.exports = router;
