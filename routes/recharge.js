const express = require("express");
const router = express.Router();
const moment = require('moment');
const db = require("../config/db");
const authenticateToken = require('../middleware/authenticateToken');



 // ====== today's total recharge summary ==========
router.get('/report/today-recharge-summary', async (req, res) => {
  try {
    // Get today's start and end time
    const start = moment().startOf('day').format('YYYY-MM-DD HH:mm:ss'); // 00:00:00
    const end = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');     // 23:59:59

    const query = `
      SELECT recharge_amount as amount
      FROM recharge
      WHERE recharge_status = 'success'
        AND recharge_type = 'INR'
        AND date BETWEEN ? AND ?
    `;

    db.query(query, [start, end], (err, results) => {
      if (err) {
        console.error('Error querying recharge table:', err);
        return res.status(500).json({
          success: false,
          message: 'Database error',
          error: err.message
        });
      }

      // Calculate total amount
      const totalAmount = results.reduce((sum, r) => sum + parseFloat(r.amount), 0);

      res.json({
        success: true,
        date: moment().format('YYYY-MM-DD'),
        day: moment().format('dddd'),
        total_transactions: results.length,
        total_amount: totalAmount.toFixed(2), // 2 decimal places
      });
    });

  } catch (error) {
    console.error('Error generating recharge summary:', error);
    res.status(500).json({
      success: false,
      message: 'Unexpected error',
      error: error.message
    });
  }
});


//========================= get all recharge with pagination & status filter ==============
router.get("/get-all-recharges", async (req, res) => {
  try {
    let { page, limit, status } = req.query;

    page = parseInt(page) || 1;
    limit = parseInt(limit) || 50;
    const offset = (page - 1) * limit;

    // Base query
    let whereClause = "WHERE 1=1";
    const params = [];

    // Status filter (success/pending) - optional
    if (status && status !== "all") {
      whereClause += " AND recharge_status = ?";
      params.push(status);
    }

    // Main query
    const rows = await query(
      `
      SELECT 
        recharge_id,
        order_id,
        userId,
        recharge_amount AS amount,
        recharge_type AS type,
        payment_mode AS mode,
        recharge_status AS status,
        date,
        time
      FROM recharge
      ${whereClause}
      ORDER BY recharge_id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    // Count query
    const countResult = await query(
      `SELECT COUNT(*) AS count FROM recharge ${whereClause}`,
      params
    );
    const totalCount = countResult[0].count;

    res.status(200).json({
      totalRecharges: totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching recharges:", error);
    res.status(500).json({ message: "Server error" });
  }
});



// Helper to wrap callback-based query in a Promise
const query = (sql, params) => {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};


router.get("/recharge-detail/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    const rechargeRows = await query(
      "SELECT * FROM recharge WHERE order_id = ?",
      [orderId]
    );

    if (rechargeRows.length === 0) {
      return res.status(404).json({ message: "Order ID not found" });
    }

    const recharge = rechargeRows[0];

    const userRows = await query(
      "SELECT username, id, email, phone FROM users WHERE id = ?",
      [recharge.userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: "User not found for this order ID" });
    }

    const user = userRows[0];

    const response = {
      order_id: recharge.order_id,
      username: user.username,
      id: user.id,
      email: user.email,
      phone: user.phone,
      recharge_amount: recharge.recharge_amount,
      recharge_type: recharge.recharge_type,
      recharge_status: recharge.recharge_status,
      payment_mode: recharge.payment_mode,
      date: recharge.date.toLocaleDateString('en-CA'),

      time: recharge.time,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error fetching recharge detail:", error);
    res.status(500).json({ message: "Server error" });
  }
});


//========================= filter recharges by Type and Mode ==============
router.get("/get-all-recharges/sort", async (req, res) => {
  try {
    let { type, mode, page, limit } = req.query;

    page = parseInt(page) || 1;
    limit = parseInt(limit) || 20;
    const offset = (page - 1) * limit;

    // Base query
    let whereClause = "WHERE 1=1";
    const params = [];

    // Apply filters if provided
    if (type) {
  if (type.toLowerCase() === "usdt") {
    whereClause += " AND LOWER(recharge_type) LIKE ?";
    params.push("%usdt%");
  } else {
    whereClause += " AND LOWER(recharge_type) = ?";
    params.push(type.toLowerCase());
  }
}

    if (mode) {
      whereClause += " AND payment_mode = ?";
      params.push(mode);
    }

    // Main query
    const rows = await query(
      `
      SELECT 
        recharge_id,
        order_id,
        userId,
        recharge_amount AS amount,
        recharge_type AS type,
        payment_mode AS mode,
        recharge_status AS status,
        date,
        time
      FROM recharge
      ${whereClause}
      ORDER BY recharge_id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    // Count query
    const countResult = await query(
      `SELECT COUNT(*) AS count FROM recharge ${whereClause}`,
      params
    );
    const totalCount = countResult[0].count;

    res.status(200).json({
      totalRecharges: totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching recharges:", error);
    res.status(500).json({ message: "Server error" });
  }
});









module.exports = router;