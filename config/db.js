const mysql = require("mysql2");
const connection = mysql.createConnection({
  host: "localhost",
  user: "lucifer",
  password: "Welcome@noida2024", // Vikram@1996# for workbench
  database: "stake"
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
