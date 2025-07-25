const express = require('express');
const router = express.Router();
const connection = require('../config/db');
const authenticateToken = require('../middleware/authenticateToken');




// Create new coupon (Admin)
router.post('/create', async (req, res) => {
    try {
        const { code, amount, usage_limit, expires_at } = req.body;

        if (!code || !amount || !usage_limit || !expires_at) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        const query = `
            INSERT INTO coupons (code, amount, usage_limit, expires_at) 
            VALUES (?, ?, ?, ?)
        `;

        connection.query(query, [code, amount, usage_limit, expires_at], (err, results) => {
            if (err) {
                console.error('Error creating coupon:', err);
                return res.status(500).json({ success: false, message: "Error creating coupon" });
            }

            res.status(201).json({
                success: true,
                message: "Coupon created successfully",
                couponId: results.insertId
            });
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});



// Get all coupons (Admin)
router.get('/all', async (req, res) => {
    try {
        const query = `
            SELECT 
                c.*, 
                COUNT(cu.id) as times_used,
                c.usage_limit - COUNT(cu.id) as remaining_uses,
                CASE 
                    WHEN c.expires_at < NOW() THEN 'expired'
                    WHEN COUNT(cu.id) >= c.usage_limit THEN 'depleted'
                    ELSE c.status
                END as current_status
            FROM coupons c
            LEFT JOIN coupon_usage cu ON c.id = cu.coupon_id
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `;

        connection.query(query, (err, results) => {
            if (err) return res.status(500).json({ success: false, message: "Error fetching coupons" });
            res.json({ success: true, coupons: results });
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

router.get('/history/:couponId',authenticateToken, async (req, res) => {
    try {
        const { couponId } = req.params;

        // First get coupon details
        const couponQuery = `
            SELECT 
                c.code,
                c.amount,
                c.usage_limit,
                c.expires_at,
                COUNT(cu.id) as total_redeems,
                c.usage_limit - COUNT(cu.id) as remaining_uses
            FROM coupons c
            LEFT JOIN coupon_usage cu ON c.id = cu.coupon_id
            WHERE c.id = ?
            GROUP BY c.id
        `;

        connection.query(couponQuery, [couponId], (err, couponResults) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({
                    success: false,
                    message: "Error fetching coupon details"
                });
            }

            if (!couponResults.length) {
                return res.status(404).json({
                    success: false,
                    message: "Coupon not found"
                });
            }

            // Get redemption details
            const redemptionsQuery = `
                SELECT 
                    u.id as user_id,
                    u.username,
                    cu.used_at as redeemed_at,
                    cu.amount_credited
                FROM coupon_usage cu
                JOIN users u ON cu.user_id = u.id
                WHERE cu.coupon_id = ?
                ORDER BY cu.used_at DESC
            `;

            connection.query(redemptionsQuery, [couponId], (err, redemptionResults) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({
                        success: false,
                        message: "Error fetching redemption details"
                    });
                }

                const coupon = couponResults[0];

                res.json({
                    success: true,
                    data: {
                        code: coupon.code,
                        amount: coupon.amount,
                        usage_limit: coupon.usage_limit,
                        expires_at: coupon.expires_at,
                        total_redeems: coupon.total_redeems,
                        remaining_uses: coupon.remaining_uses,
                        redemptions: redemptionResults
                    }
                });
            });
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});

// Redeem coupon
router.post('/redeem',authenticateToken, async (req, res) => {
    try {
        const { userId, code } = req.body;

        const getCouponQuery = `
            SELECT c.*, COUNT(cu.id) as current_uses
            FROM coupons c
            LEFT JOIN coupon_usage cu ON c.id = cu.coupon_id
            WHERE c.code = ? AND c.status = 'active'
            AND c.expires_at > NOW()
            GROUP BY c.id
            HAVING current_uses < c.usage_limit
        `;

        connection.query(getCouponQuery, [code], (err, coupons) => {
            if (err) return res.status(500).json({ success: false, message: "Error checking coupon" });
            if (!coupons.length) return res.status(400).json({
                success: false,
                message: "Coupon invalid, expired, or fully used"
            });

            const coupon = coupons[0];

            // Begin transaction
            connection.beginTransaction(err => {
                if (err) return res.status(500).json({ success: false, message: "Transaction error" });

                // Insert coupon usage
                const usageQuery = `
                    INSERT INTO coupon_usage (coupon_id, user_id, amount_credited) 
                    VALUES (?, ?, ?)
                `;

                connection.query(usageQuery, [coupon.id, userId, coupon.amount], (err) => {
                    if (err) {
                        connection.rollback();
                        return res.status(400).json({
                            success: false,
                            message: "You have already used this coupon"
                        });
                    }

                    // Update user's wallet
                    const walletQuery = `
                        UPDATE wallet 
                        SET balance = balance + ? 
                        WHERE userId = ? AND cryptoname = 'INR'
                    `;

                    connection.query(walletQuery, [coupon.amount, userId], (err) => {
                        if (err) {
                            connection.rollback();
                            return res.status(500).json({
                                success: false,
                                message: "Error updating wallet"
                            });
                        }

                        connection.commit(err => {
                            if (err) {
                                connection.rollback();
                                return res.status(500).json({
                                    success: false,
                                    message: "Error completing transaction"
                                });
                            }

                            res.json({
                                success: true,
                                message: "Coupon redeemed successfully",
                                amount: coupon.amount
                            });
                        });
                    });
                });
            });
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
});

module.exports = router;