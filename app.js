const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const connection = require('./config/db');
const cors = require('cors');
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
require('./utils/commissionScheduler');
app.use(cors());

app.use(express.json());

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use("/api/user", require("./routes/user"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/games", require("./routes/games"));
app.use("/api/bankaccount", require("./routes/bankAccount"));
app.use("/api/wallet", require("./routes/withdrawl"));
app.use("/api/slider", require("./routes/slider"));
app.use("/api/color", require("./routes/colorPrediction"));
app.use("/api/coupons",require("./routes/coupons"))

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
