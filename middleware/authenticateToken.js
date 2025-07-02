const { verifyAccessToken } = require('../utils/jwt');
const connection = require('../config/db'); // 

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });

    try {
        const decoded = verifyAccessToken(token); //  Valid token
        const userId = decoded.id;

        // 🔍 Fetch user from DB to check if login is disabled
        const query = 'SELECT * FROM users WHERE id = ?';
        connection.query(query, [userId], (err, results) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (results.length === 0) return res.status(404).json({ error: 'User not found' });

            const user = results[0];

            //  Check if login is disabled
            if (user.is_login_disabled) {
                return res.status(403).json({ error: 'Access blocked by admin' });
            }

            //  Attach user to request
            req.user = user;
            next();
        });
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired access token' });
    }
}

module.exports = authenticateToken;