const express = require('express');
const router = express.Router();
const pool = require('../config/db');

router.get('/conversion-rate/:pair', (req, res) => {
    const { pair } = req.params;
    
    pool.query(
        'SELECT rate FROM conversion_rates WHERE currency_pair = ?',
        [pair],
        (err, results) => {
            if (err) {
                console.error('Error fetching conversion rate:', err);
                return res.status(500).json({ 
                    message: 'Internal server error', 
                    error: err.message 
                });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: 'Rate not found' });
            }

            res.json({ rate: results[0].rate });
        }
    );
});

router.put('/conversion-rate/:pair', (req, res) => {
  const { pair } = req.params;
  const { rate } = req.body;

  if (!rate || isNaN(rate)) {
    return res.status(400).json({ message: 'Invalid rate value' });
  }

  const query = `
    INSERT INTO conversion_rates (currency_pair, rate)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE rate = VALUES(rate)
  `;

  pool.query(query, [pair, rate], (err) => {
    if (err) return res.status(500).json({ message: 'Database error', error: err });

    res.json({ message: 'Rate updated successfully', rate });
  });
});

module.exports = router;