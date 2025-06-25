const express = require("express");
const router = express.Router();
const db = require("../config/db");

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

router.get("/get-all-recharges", async (req, res) => {
  try {
    const rows = await query(`
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
      ORDER BY recharge_id DESC
    `);

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching recharges:", error);
    res.status(500).json({ message: "Server error" });
  }
});



module.exports = router;
