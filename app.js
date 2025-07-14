const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const connection = require('./config/db');
const cors = require('cors');
const http = require('http');
const { Server } = require("socket.io");
dotenv.config();
const app = express();
const server = http.createServer(app);
const { setIO } = require('./utils/socket');
const io = new Server(server);
setIO(io); //  Set global io

const PORT = process.env.PORT || 5000;
require('./utils/commissionScheduler');
require('./utils/resultScheduler');

const corsOptions = {
    origin: '*', // Or '*' for public (if no cookies)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
app.use(express.json());
// const timerIntervals = {
//     "1min": 60 * 1000,
//     "3min": 3 * 60 * 1000,
//     "5min": 5 * 60 * 1000,
//     "10min": 10 * 60 * 1000,
// };

// // Start timers and broadcast updates
// Object.keys(timerIntervals).forEach(durationKey => {
//     const totalDurationMs = timerIntervals[durationKey];
//     setInterval(() => {
//         const now = Date.now();
//         const elapsedInCycle = now % totalDurationMs;
//         const remainingTimeMs = totalDurationMs - elapsedInCycle;

//         // Broadcast remaining time for this specific timer
//         io.emit(`timerUpdate:${durationKey}`, {
//             duration: durationKey,
//             remainingTimeMs: remainingTimeMs,
//         });

//         // You might also want logic here to trigger actions when the timer hits zero
//         if (remainingTimeMs <= 1000) { // Near the end of the cycle
//            // Trigger result generation for this timer, etc.
//            console.log(`${durationKey} timer ending!`);
//         }

//     }, 1000); // Update every second
// });

// // Socket.IO connection handling (optional, for basic connection events)
// io.on('connection', (socket) => {
//   console.log('a user connected');
//   socket.on('disconnect', () => {
//     console.log('user disconnected');
//   });
// });

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use("/api/user", require("./routes/user"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/games", require("./routes/games"));
app.use("/api/bankaccount", require("./routes/bankAccount"));
app.use("/api/wallet", require("./routes/withdrawl"));
app.use("/api/slider", require("./routes/slider"));
app.use("/api/color", require("./routes/colorPrediction"));
app.use("/api/coupons",require("./routes/coupons"));
app.use("/api/recharge", require("./routes/recharge"));

app.use('/api/queries',require('./routes/queries' ));

app.use("/api/rates", require("./routes/rates"))


server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
