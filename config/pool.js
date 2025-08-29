// config/pool.js
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: "localhost",
    user: "lucifer",
    password: "Welcome@noida2024",
    database: "stake",
});

module.exports = pool;

