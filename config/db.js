const mysql = require("mysql2");
const connection = mysql.createConnection({
  host: "localhost",
  user: "lucifer", // Replace with your MySQL username
  password: "Welcome@noida2024", // Replace with your MySQL password
  database: "stake",
});

connection.connect(err => {
  if (err) {
    console.error("Database connection failed:", err.message);
    console.log(err.message, "errormessage");
  } else {
    console.log("Connected to MySQL database");
  }
});

module.exports = connection;
