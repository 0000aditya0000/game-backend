const express = require('express');
const multer = require('multer');
const path = require('path');
const connection = require('../config/db');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary.config'); 
const { processDailyBettingCommissions } = require('../utils/commission');

const router = express.Router();

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "sliders_images",
    allowed_formats: ["jpg", "png", "jpeg", "gif"],
    public_id: (req, file) => `${Date.now()}-${file.originalname.split('.')[0]}`,
  },
});

const slidersUpload = multer({ storage });


//  CREATE Slider
router.post('/slider', slidersUpload.single('image'), (req, res) => {
  const { title, description } = req.body;
 
  console.log("req.file.path", req.file.path);

  if (!req.file || !title || !description) {
    return res.status(400).json({ error: 'Title, description, and image are required' });
  }

  const imageUrl = req.file.path; // Cloudinary gives image URL here

  const query = `INSERT INTO sliders (image, title, description) VALUES (?, ?, ?)`;
  connection.query(query, [imageUrl, title, description], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });

    res.status(201).json({
      message: 'Slider created successfully',
      sliderId: result.insertId,
      image: imageUrl,
    });
  });
});

// =====  READ Sliders =========
router.get('/slider', (req, res) => {
  const {page =1 , limit = 10} = req.query;
  const offset = (page - 1) * limit;
  const query = 'SELECT * FROM sliders ORDER BY created_at DESC LIMIT ? OFFSET ?';
  connection.query(query, [parseInt(limit), parseInt(offset)], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    const totalQuery = 'SELECT COUNT(*) as total FROM sliders';
    connection.query(totalQuery, (err, totalResults) => {
      if (err) return res.status(500).json({ error: err.message });
      const total = totalResults[0].total;
      const totalPages = Math.ceil(total / limit);
      res.json({
           currentPage: parseInt(page),
          totalPages: totalPages,
          totalItems: total,
          itemsPerPage: parseInt(limit),
        sliders: results,
       });
    });
   
  });
});

// =========  UPDATE Slider By Slider_Id ========
router.patch('/slider/:id', slidersUpload.single('image'), (req, res) => {
  const { title, description } = req.body;
  const { id } = req.params;
  const imagePath = req.file ? req.file.path : null;

  const query = `
    UPDATE sliders 
    SET title = ?, description = ?, image = COALESCE(?, image) 
    WHERE id = ?
  `;

  connection.query(query, [title, description, imagePath, id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Slider not found' });

    res.json({
      message: 'Slider updated successfully',
      image: imagePath || 'unchanged',
    });
  });
});

// ======= DELETE Slider By Slider_Id ===========
router.delete('/slider/:id', (req, res) => {
  const { id } = req.params;

  connection.query('DELETE FROM sliders WHERE id = ?', [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Slider not found' });

    res.json({ message: 'Slider deleted successfully' });
  });
});


// ==============test cron job to credit commissions================
router.get('/collect-cron', async (req, res) => {


  try {
    await  processDailyBettingCommissions();
    res.send('Commission cron job executed successfully.');
  } catch (err) {
    console.error(" Cron Execution Failed:", err.message || err);
    res.status(500).send(' Error in cron job');
  }
});



module.exports = router;
