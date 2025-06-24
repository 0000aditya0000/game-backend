const jwt = require('jsonwebtoken');

const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;

function generateAccessToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email },
        accessSecret,
        { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
    );
}

function generateRefreshToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email },
        refreshSecret,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );
}

function verifyAccessToken(token) {
    return jwt.verify(token, accessSecret);
}

function verifyRefreshToken(token) {
    return jwt.verify(token, refreshSecret);
}

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken
};