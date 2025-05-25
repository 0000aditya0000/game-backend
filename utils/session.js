const db = require("../config/db");
const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "83dc7f5f8a8471b82d4c3a6795a1ef2a382fe89c5891be7e0fca3781c5679d29";

// Create or replace session
const createSession = (userId) => {
  return new Promise((resolve, reject) => {
    const token = jwt.sign({ id: userId }, SECRET, { expiresIn: "1h" });

    db.query("DELETE FROM sessions WHERE user_id = ?", [userId], (delErr) => {
      if (delErr) return reject(delErr);

      db.query(
        "INSERT INTO sessions (user_id, token) VALUES (?, ?)",
        [userId, token],
        (insErr) => {
          if (insErr) return reject(insErr);
          resolve(token);
        }
      );
    });
  });
};

module.exports = {
  createSession,
};
