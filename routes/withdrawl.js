const express = require('express');
const connection = require('../config/db'); // Ensure database connection is configured
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken'); 
const { canWithdraw } = require("../utils/gameplay"); 

// currency
// : 
// "btc"
// cryptoname
// : 
// "usdt"
// network
// : 
// "erc20"

// Create a new withdrawal request
// router.post('/withdrawl', async (req, res) => {
//   const { userId, currency, amount, walletAddress, network, bankname } = req.body;

//   // First check userId
//   if (!userId) {
//     return res.status(400).json({
//       success: false,
//       message: 'userId is required'
//     });
//   }

//   // Validate based on currency
//   if (currency === 'usdt') {
//     if (!amount || !walletAddress || !network) {
//       return res.status(400).json({
//         success: false,
//         message: 'For USDT withdrawals, amount, walletAddress and network are required'
//       });
//     }
//   } else if (currency === 'inr') {
//     if (!amount || !bankname) {
//       return res.status(400).json({
//         success: false,
//         message: 'For INR withdrawals, amount and bankname are required'
//       });
//     }
//   } else {
//     return res.status(400).json({
//       success: false,
//       message: 'Invalid currency. Must be either "usdt" or "inr"'
//     });
//   }

//   try {

    

//     // Start a transaction
//     connection.beginTransaction(err => {
//       if (err) {
//         return res.status(500).json({
//           success: false,
//           message: 'Transaction initialization failed'
//         });
//       }

//       // Check wallet balance
//       const checkBalanceQuery = `
//         SELECT balance 
//         FROM wallet 
//         WHERE userId = ? AND cryptoname = 'inr'
//       `;

//       connection.query(checkBalanceQuery, [userId], (err, results) => {
//         if (err) {
//           return connection.rollback(() => {
//             res.status(500).json({
//               success: false,
//               message: 'Error checking wallet balance'
//             });
//           });
//         }

//         console.log('Wallet balance results:', results);
        
//         if (results.length === 0 || parseFloat(results[0].balance) < parseFloat(amount)) {
//           return connection.rollback(() => {
//             res.status(400).json({
//               success: false,
//               message: 'Insufficient balance'
//             });
//           });
//         }

//         // Deduct from wallet
//         const deductBalanceQuery = `
//           UPDATE wallet 
//           SET balance = balance - ? 
//           WHERE userId = ? AND cryptoname = 'inr'
//         `;

//         connection.query(deductBalanceQuery, [amount, userId], (err) => {
//           if (err) {
//             return connection.rollback(() => {
//               res.status(500).json({
//                 success: false,
//                 message: 'Error deducting balance from wallet'
//               });
//             });
//           }

//           // Insert into withdrawl table based on currency
//           let insertQuery;
//           let insertParams;

//           if (currency === 'inr') {
//             insertQuery = `
//               INSERT INTO withdrawl (
//                 userId, balance, cryptoname, bankName,
//                 status, createdOn
//               ) VALUES (?, ?, ?, ?, ?, NOW())
//             `;
//             insertParams = [userId, amount, currency, bankname, 0];
//           } else {
//             insertQuery = `
//               INSERT INTO withdrawl (
//                 userId, balance, cryptoname, walletAddress,
//                 networkType, status, createdOn
//               ) VALUES (?, ?, ?, ?, ?, ?, NOW())
//             `;
//             insertParams = [userId, amount, currency, walletAddress, network, 0];
//           }

//           connection.query(insertQuery, insertParams, (err, result) => {
//             if (err) {
//               return connection.rollback(() => {
//                 res.status(500).json({
//                   success: false,
//                   message: 'Error creating withdrawal entry'
//                 });
//               });
//             }

//             // Commit the transaction
//             connection.commit(err => {
//               if (err) {
//                 return connection.rollback(() => {
//                   res.status(500).json({
//                     success: false,
//                     message: 'Error committing transaction'
//                   });
//                 });
//               }

//               res.json({
//                 success: true,
//                 message: 'Withdrawal request created successfully',
//                 data: {
//                   withdrawalId: result.insertId,
//                   currency,
//                   amount,
//                  status: 'pending',
//                   ...(currency === 'inr' 
//                     ? { bankname } 
//                     : { walletAddress, network })
//                 }
//               });
//             });
//           });
//         });
//       });
//     });
//   } catch (error) {
//     console.error('Error processing withdrawal request:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });




// ============================withdrawal apporove or reject==================================
router.put('/withdrawal/approve/:id', async (req, res) => {
  try {
    const withdrawalId = req.params.id;
    const { status, note } = req.body; // Add note to destructuring
    const numericStatus = parseInt(status);

    // Validate status
    if (![1, 2].includes(numericStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Use 1 for approve, 2 for reject"
      });
    }

    // Require note when rejecting
    if (numericStatus === 2 && !note) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason (note) is required when rejecting a withdrawal"
      });
    }

    // First get withdrawal details
    const getWithdrawalQuery = "SELECT * FROM withdrawl WHERE id = ? AND status = 0";

    connection.beginTransaction(err => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Transaction initialization failed"
        });
      }

      connection.query(getWithdrawalQuery, [withdrawalId], (err, withdrawals) => {
        if (err) {
          return connection.rollback(() => {
            res.status(500).json({
              success: false,
              message: "Error fetching withdrawal details"
            });
          });
        }

        if (!withdrawals.length) {
          return connection.rollback(() => {
            res.status(404).json({
              success: false,
              message: "Withdrawal request not found or already processed"
            });
          });
        }

        const withdrawal = withdrawals[0];

        // If rejecting, refund the amount
        if (numericStatus === 2) {
          const refundQuery = `
            UPDATE wallet 
            SET balance = balance + ? 
            WHERE userId = ? AND cryptoname = 'inr'
          `;

          connection.query(refundQuery,
            [withdrawal.balance, withdrawal.userId],
            (err) => {
              if (err) {
                return connection.rollback(() => {
                  res.status(500).json({
                    success: false,
                    message: "Failed to refund amount"
                  });
                });
              }

              updateWithdrawalStatus();
            }
          );
        } else {
          updateWithdrawalStatus();
        }

        function updateWithdrawalStatus() {
          // Modified query to include reject_note
          const updateQuery = "UPDATE withdrawl SET status = ?, reject_note = ? WHERE id = ?";

          connection.query(updateQuery, [numericStatus, note || null, withdrawalId], (err) => {
            if (err) {
              console.log('error in updateWithdrawalStatus', err);
              return connection.rollback(() => {
                res.status(500).json({
                  success: false,
                  message: "Failed to update withdrawal status",
                  error: err
                });
              });
            }

            connection.commit(err => {
              if (err) {
                return connection.rollback(() => {
                  res.status(500).json({
                    success: false,
                    message: "Transaction commit failed"
                  });
                });
              }

              res.json({
                success: true,
                message: numericStatus === 1 ?
                  'Withdrawal approved successfully' :
                  'Withdrawal rejected and amount refunded',
                data: {
                  withdrawalId,
                  status: numericStatus === 1 ? 'approved' : 'rejected',
                  status_code: numericStatus,
                  amount: withdrawal.balance,
                  cryptoname: withdrawal.cryptoname,
                  reject_note: note || null,
                  updated_at: new Date()
                }
              });
            });
          });
        }
      });
    });
  } catch (error) {
    console.error('Error processing withdrawal:', error);
    res.status(500).json({
      success: false,
      message: "Unable to process withdrawal",
      error: error.message
    });
  }
});



// ================ Get all withdrawal entries with user and bank details with wallet balance =================
router.get('/withdrawl-requests/:status', async (req, res) => { 
  try {
    const withdrawalStatus = Number(req.params.status);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    //  Validate status
    if (![0, 1, 2, 3].includes(withdrawalStatus)) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid status parameter. Status must be 0 (pending), 1 (approved), 2 (rejected), or 3 (all)'
      });
    }

    // ================= Get total count =================
    const countQuery = `
      SELECT COUNT(*) as total
      FROM withdrawl w
      WHERE ${withdrawalStatus === 3 ? '1=1' : 'w.status = ?'}
    `;

    connection.query(
      countQuery,
      withdrawalStatus === 3 ? [] : [withdrawalStatus],
      (countErr, countResults) => {
        if (countErr) {
          console.error('Error getting total count:', countErr);
          return res.status(500).json({
            success: false,
            message: 'Failed to fetch total records count'
          });
        }

        const totalRecords = countResults[0].total;
        const totalPages = Math.ceil(totalRecords / limit);

        // ================= Fetch withdrawal data =================
        const query = `
          SELECT 
            w.id,
            w.createdOn,
            w.balance AS withdrawalAmount,
            w.cryptoname,
            w.walletAddress,
            w.networkType,
            w.bankName,
            w.status as withdrawalStatus,
            w.beforeBalance,   
            w.afterBalance,      
            u.id as userId,
            u.username,
            u.email,
            u.name,
            u.phone,
            ba.accountName,
            ba.accountNumber,
            ba.ifscCode,
            ba.branch,
            ba.status as bankAccountStatus
          FROM withdrawl w
          LEFT JOIN users u ON w.userId = u.id
          LEFT JOIN bankaccount ba ON w.bankName = ba.id
          WHERE ${withdrawalStatus === 3 ? '1=1' : 'w.status = ?'}
          ORDER BY w.createdOn DESC
          LIMIT ? OFFSET ?
        `;

        const queryParams =
          withdrawalStatus === 3
            ? [limit + 1, offset]
            : [withdrawalStatus, limit + 1, offset];

        connection.query(query, queryParams, (err, results) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({
              success: false,
              message: 'Failed to fetch withdrawal records'
            });
          }

          const hasNextPage = results.length > limit;
          const paginatedResults = results.slice(0, limit);

          const statusText = {
            0: 'Pending',
            1: 'Approved',
            2: 'Rejected',
            3: 'All'
          }[withdrawalStatus];

          // ================= Format response =================
          const formattedResults = paginatedResults.map(item => {
            return {
              withdrawalId: item.id,
              amountRequested: item.withdrawalAmount,
              cryptoname: item.cryptoname,
              requestDate: item.createdOn,
              walletBalance: {
                before: item.beforeBalance || 0,
                after: item.afterBalance || 0
              },
              withdrawalStatus: {
                code: item.withdrawalStatus,
                status: {
                  0: 'Pending',
                  1: 'Approved',
                  2: 'Rejected'
                }[item.withdrawalStatus]
              },
              user: {
                userId: item.userId,
                username: item.username,
                name: item.name,
                email: item.email,
                phone: item.phone
              },
              withdrawalDetails: item.walletAddress
                ? {
                    walletAddress: item.walletAddress,
                    networkType: item.networkType
                  }
                : {
                    accountName: item.accountName,
                    accountNumber: item.accountNumber,
                    ifscCode: item.ifscCode,
                    branch: item.branch,
                    bankAccountStatus: item.bankAccountStatus
                  }
            };
          });

          // ================= Send Response =================
          res.json({
            success: true,
            message: `${statusText} withdrawal records fetched successfully`,
            pagination: {
              currentPage: page,
              totalPages: totalPages,
              totalRecords: totalRecords,
              hasNextPage: hasNextPage,
              nextPage: hasNextPage ? page + 1 : null
            },
            data: formattedResults
          });
        });
      }
    );
  } catch (error) {
    console.error('Error fetching withdrawal entries:', error);
    res.status(500).json({
      success: false,
      message: 'Something went wrong while fetching withdrawal records'
    });
  }
});



// Get a single withdrawal entry by ID with user and bank details

router.get('/withdrawl-request/:id/:status?', async (req, res) => {
  const withdrawlId = req.params.id;
  const withdrawalStatus = req.params.status;

  try {
    let query = `
      SELECT 
        w.id,
        w.createdOn,
        w.balance,
        w.cryptoname,
        w.walletAddress,
        w.networkType,
        w.bankName,
        w.status as withdrawalStatus,
        u.username,
        u.email,
        u.name,
        u.phone,
        ba.accountName,
        ba.accountNumber,
        ba.ifscCode,
        ba.branch,
        ba.status as bankAccountStatus
      FROM withdrawl w
      LEFT JOIN users u ON w.userId = u.id
      LEFT JOIN bankaccount ba ON w.bankName = ba.id
      WHERE w.id = ?
    `;

    const queryParams = [withdrawlId];

    // Add status condition if provided
    if (withdrawalStatus !== undefined) {
      if (![0, 1, 2, 3].includes(Number(withdrawalStatus))) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status parameter. Status must be 0 (pending), 1 (approved), or 2 (rejected)'
        });
      }
      query += ' AND w.status = ?';
      queryParams.push(withdrawalStatus);
    }

    connection.query(query, queryParams, (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ 
          success: false,
          message: 'Failed to fetch withdrawal record'
        });
      }

      if (results.length === 0) {
        return res.status(404).json({ 
          success: false,
          message: withdrawalStatus !== undefined 
            ? `Withdrawal record not found with status ${withdrawalStatus}` 
            : 'Withdrawal record not found'
        });
      }

      const item = results[0];
      const statusText = {
        0: 'Pending',
        1: 'Approved',
        2: 'Rejected'
      }[item.withdrawalStatus];

      const formattedResult = {
        withdrawalId: item.id,
        amount: item.balance,
        cryptoname: item.cryptoname,
        requestDate: item.createdOn,
        withdrawalStatus: {
          code: item.withdrawalStatus,
          status: statusText
        },
        user: {
          userId: item.userId,
          username: item.username,
          name: item.name,
          email: item.email,
          phone: item.phone
        },
        withdrawalDetails: item.walletAddress ? {
          walletAddress: item.walletAddress,
          networkType: item.networkType
        } : {
          accountName: item.accountName,
          accountNumber: item.accountNumber,
          ifscCode: item.ifscCode,
          branch: item.branch,
          bankAccountStatus: item.bankAccountStatus
        }
      };

      res.json({
        success: true,
        message: 'Withdrawal record fetched successfully',
        data: formattedResult
      });
    });
  } catch (error) {
    console.error('Error fetching withdrawal entry:', error);
    res.status(500).json({ 
      success: false,
      message: 'Something went wrong while fetching the withdrawal record'
    });
  }
});



// ==================wallet Update balance by userId + cryptoname =============
router.put("/update", async (req, res) => {
  try {
    const { userId, cryptoname, balance } = req.body;

    if (!userId || !cryptoname || balance === undefined) {
      return res.status(400).json({ error: "userId, cryptoname and balance are required" });
    }

   // Check if wallet entry exists
    const checkQuery = `SELECT * FROM wallet WHERE userId = ? AND cryptoname = ?`;
    connection.query(checkQuery, [userId, cryptoname], (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: "Failed to check wallet entry" });
      }
      
      if (results.length === 0) {
        return res.status(404).json({ error: "Wallet entry not found for the given userId and cryptoname" });
      }
    }
    );

    // Update query
    const updateQuery = `UPDATE wallet 
       SET balance = ? 
       WHERE userId = ? AND cryptoname = ?`;
    connection.query(updateQuery, [balance, userId, cryptoname], (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: "Failed to update wallet balance" });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Wallet not Updating for the given userId and cryptoname" });
      }
    });



    res.json({
      success: true,
      message: "Wallet balance updated successfully",
      data: { userId, cryptoname, balance }
    });

  } catch (error) {
    console.error("Error updating wallet balance:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



//================ Transfer Bonus to Wallet =================

router.post('/transfer-bonus', (req, res) => {
  const { userId, amount } = req.body;
  const amountNum = parseFloat(amount);

  if (!userId || isNaN(amountNum) || amountNum <= 0) {
    return res.status(400).json({ success: false, message: "Invalid input" });
  }

  connection.beginTransaction(err => {
    if (err) {
      console.error('Begin transaction error:', err);
      return res.status(500).json({ success: false, message: 'DB transaction error' });
    }

    // Lock the wallet row
    const getWalletQuery = `
      SELECT balance, bonus_balance 
      FROM wallet 
      WHERE userId = ? AND cryptoname = 'INR' 
      FOR UPDATE
    `;
    connection.query(getWalletQuery, [userId], (walletErr, walletRows) => {
      if (walletErr) {
        console.error('Wallet query error:', walletErr);
        return connection.rollback(() => res.status(500).json({ success: false, message: 'Error fetching wallet', error: walletErr.message }));
      }

      if (!walletRows || walletRows.length === 0) {
        return connection.rollback(() => res.status(404).json({ success: false, message: 'Wallet not found' }));
      }

      const wallet = walletRows[0];
      const bonusBefore = parseFloat(wallet.bonus_balance || 0);
      const walletBefore = parseFloat(wallet.balance || 0);

      if (bonusBefore < amountNum) {
        return connection.rollback(() => res.status(400).json({ success: false, message: 'Insufficient bonus balance' }));
      }

      // safe arithmetic + rounding
      const bonusAfter = Number((bonusBefore - amountNum).toFixed(2));
      const walletAfter = Number((walletBefore + amountNum).toFixed(2));

      const updateWalletQuery = `
        UPDATE wallet 
        SET bonus_balance = ?, balance = ? 
        WHERE userId = ? AND cryptoname = 'INR'
      `;
      connection.query(updateWalletQuery, [bonusAfter, walletAfter, userId], (updErr) => {
        if (updErr) {
          console.error('Update wallet error:', updErr);
          return connection.rollback(() => res.status(500).json({ success: false, message: 'Error updating wallet', error: updErr.message }));
        }

        const insertHistoryQuery = `
          INSERT INTO bonus_transfer_history 
            (userId, amount, bonus_balance_before, bonus_balance_after, wallet_balance_before, wallet_balance_after)
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        connection.query(insertHistoryQuery, [userId, amountNum, bonusBefore, bonusAfter, walletBefore, walletAfter], (histErr) => {
          if (histErr) {
            console.error('Insert history error:', histErr);
            return connection.rollback(() => res.status(500).json({ success: false, message: 'Error saving history', error: histErr.message }));
          }

          connection.commit(commitErr => {
            if (commitErr) {
              console.error('Commit error:', commitErr);
              return connection.rollback(() => res.status(500).json({ success: false, message: 'Commit failed', error: commitErr.message }));
            }

            return res.json({
              success: true,
              message: 'Bonus transferred successfully',
              data: {
                amount: amountNum,
                bonus_balance_before: bonusBefore,
                bonus_balance_after: bonusAfter,
                wallet_balance_before: walletBefore,
                wallet_balance_after: walletAfter
              }
            });
          });
        });
      });
    });
  });
});



//================ Get Bonus Transfer History =================
router.get('/bonus-transfer-history/:userId', (req, res) => {
  const { userId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  // 1. Count total records
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM bonus_transfer_history 
    WHERE userId = ?
  `;
  connection.query(countQuery, [userId], (countErr, countResult) => {
    if (countErr) {
      console.error('Count history error:', countErr);
      return res.status(500).json({
        success: false,
        message: "Error counting history",
        error: countErr.message
      });
    }

    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    // 2. Fetch paginated records
    const historyQuery = `
      SELECT id, amount, 
             bonus_balance_before, bonus_balance_after, 
             wallet_balance_before, wallet_balance_after, 
             created_at
      FROM bonus_transfer_history 
      WHERE userId = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    connection.query(historyQuery, [userId, limit, offset], (historyErr, historyResult) => {
      if (historyErr) {
        console.error('Fetch history error:', historyErr);
        return res.status(500).json({
          success: false,
          message: "Error fetching history",
          error: historyErr.message
        });
      }

      res.json({
        success: true,
        message: "Bonus transfer history retrieved successfully",
        pagination: {
          total_records: totalRecords,
          total_pages: totalPages,
          current_page: page,
          limit: limit
        },
        history: historyResult
      });
    });
  });
});



//============================================================================
// make the authentication middleware available for all routes in this file
// This will ensure that all routes in this file require authentication
             // router.use(authenticateToken);
//=============================================================================


// Create a new withdrawal request
router.post('/withdrawl', async (req, res) => {
  const { userId, currency, amount, walletAddress, network, bankname } = req.body;

  // 1. Validate userId
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: 'userId is required'
    });
  }

  // 2. Validate currency-specific fields
  if (currency === 'usdt') {
    if (!amount || !walletAddress || !network) {
      return res.status(400).json({
        success: false,
        message: 'For USDT withdrawals, amount, walletAddress and network are required'
      });
    }
  } else if (currency === 'inr') {
    if (!amount || !bankname) {
      return res.status(400).json({
        success: false,
        message: 'For INR withdrawals, amount and bankname are required'
      });
    }
  } else {
    return res.status(400).json({
      success: false,
      message: 'Invalid currency. Must be either "usdt" or "inr"'
    });
  }

  try {
    //  Check if user has completed required gameplay
     const isAllowed = await canWithdraw(userId);
    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message: 'You must complete required gameplay before withdrawing.'
      });
    }

    // 3. Check if user is blocked from withdrawal
    const blockQuery = `SELECT is_withdrawal_blocked FROM users WHERE id = ?`;
    connection.query(blockQuery, [userId], (err, userResults) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: 'Error checking withdrawal block status'
        });
      }

      if (!userResults.length) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (userResults[0].is_withdrawal_blocked) {
        return res.status(403).json({
          success: false,
          message: 'Withdrawals are currently blocked for your account by admin'
        });
      }

      

      // 4. Begin Transaction
      connection.beginTransaction(err => {
        if (err) {
          return res.status(500).json({
            success: false,
            message: 'Transaction initialization failed'
          });
        }

   // 5. Check wallet balance
const checkBalanceQuery = `
  SELECT balance 
  FROM wallet 
  WHERE userId = ? AND cryptoname = ?
`;

connection.query(checkBalanceQuery, [userId, currency], (err, results) => {
  if (err) {
    return connection.rollback(() => {
      res.status(500).json({
        success: false,
        message: 'Error checking wallet balance'
      });
    });
  }

  const currentBalance = parseFloat(results[0]?.balance || 0);

  if (currentBalance < parseFloat(amount)) {
    return connection.rollback(() => {
      res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    });
  }

  const beforeBalance = currentBalance;
  const afterBalance = currentBalance - parseFloat(amount);

  // 6. Deduct from wallet
  const deductBalanceQuery = `
    UPDATE wallet 
    SET balance = balance - ? 
    WHERE userId = ? AND cryptoname = ?
  `;

  connection.query(deductBalanceQuery, [amount, userId, currency], (err) => {
    if (err) {
      return connection.rollback(() => {
        res.status(500).json({
          success: false,
          message: 'Error deducting balance from wallet'
        });
      });
    }

    // 7. Insert into withdrawl table
    let insertQuery;
    let insertParams;

    if (currency === 'inr') {
      insertQuery = `
        INSERT INTO withdrawl (
          userId, balance, cryptoname, bankName,
          status, createdOn, beforeBalance, afterBalance
        ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)
      `;
      insertParams = [userId, amount, currency, bankname, 0, beforeBalance, afterBalance];
    } else {
      insertQuery = `
        INSERT INTO withdrawl (
          userId, balance, cryptoname, walletAddress,
          networkType, status, createdOn, beforeBalance, afterBalance
        ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)
      `;
      insertParams = [userId, amount, currency, walletAddress, network, 0, beforeBalance, afterBalance];
    }

    connection.query(insertQuery, insertParams, (err, result) => {
      if (err) {
        return connection.rollback(() => {
          res.status(500).json({
            success: false,
            message: 'Error creating withdrawal entry'
          });
        });
      }

      // 8. Commit transaction
      connection.commit(err => {
        if (err) {
          return connection.rollback(() => {
            res.status(500).json({
              success: false,
              message: 'Error committing transaction'
            });
          });
        }

        res.json({
          success: true,
          message: 'Withdrawal request created successfully',
          data: {
            withdrawalId: result.insertId,
            currency,
            amount,
            status: 'pending',
            beforeBalance,
            afterBalance,
            ...(currency === 'inr'
              ? { bankname }
              : { walletAddress, network })
          }
           });
         });
         });
       });
      });
    });
  });
  } catch (error) {
    console.error('Error processing withdrawal request:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});





// Update a withdrawal entry by ID
router.put('/withdrawl/:id', async (req, res) => {
  const withdrawlId = req.params.id;
  const { balance, cryptoname, status } = req.body;

  if (!balance || !cryptoname || status === undefined) {
    return res.status(400).json({ error: 'Balance, cryptoname, and status are required fields.' });
  }

  try {
    // Start a transaction to ensure consistency
    connection.beginTransaction((err) => {
      if (err) {
        console.error('Transaction error:', err);
        return res.status(500).json({ error: 'Transaction initialization failed' });
      }

      // Fetch the current status of the withdrawal
      const fetchQuery = `SELECT status FROM withdrawl WHERE id = ?`;
      connection.query(fetchQuery, [withdrawlId], (err, results) => {
        if (err) {
          console.error('Database error:', err);
          return connection.rollback(() => {
            res.status(500).json({ error: 'Database query error' });
          });
        }

        if (results.length === 0) {
          return connection.rollback(() => {
            res.status(404).json({ error: 'Withdrawal entry not found' });
          });
        }

        const previousStatus = results[0].status;

        // If the previous status is not 2 (rejected) and the new status is 2, refund the balance
        if (previousStatus !== 2 && status === 2) {
          const refundBalanceQuery = `
            UPDATE wallet
            SET balance = balance + ?
            WHERE userId = (SELECT userId FROM withdrawl WHERE id = ?) AND cryptoname = ?
          `;
          connection.query(
            refundBalanceQuery,
            [balance, withdrawlId, cryptoname],
            (err, refundResults) => {
              if (err) {
                console.error('Error refunding balance:', err);
                return connection.rollback(() => {
                  res.status(500).json({ error: 'Error refunding wallet balance' });
                });
              }

              console.log('Balance refunded successfully:', refundResults);
            }
          );
        }

        // Update the withdrawal entry
        const updateQuery = `
          UPDATE withdrawl
          SET balance = ?, cryptoname = ?, status = ?
          WHERE id = ?
        `;
        connection.query(
          updateQuery,
          [balance, cryptoname, status, withdrawlId],
          (err, updateResults) => {
            if (err) {
              console.error('Error updating withdrawal entry:', err);
              return connection.rollback(() => {
                res.status(500).json({ error: 'Error updating withdrawal entry' });
              });
            }

            if (updateResults.affectedRows === 0) {
              return connection.rollback(() => {
                res.status(404).json({ error: 'Withdrawal entry not found' });
              });
            }

            // Commit the transaction
            connection.commit((err) => {
              if (err) {
                console.error('Transaction commit error:', err);
                return connection.rollback(() => {
                  res.status(500).json({ error: 'Transaction commit failed' });
                });
              }

              res.json({ message: 'Withdrawal entry updated successfully' });
            });
          }
        );
      });
    });
  } catch (error) {
    console.error('Error updating withdrawal entry:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Delete a withdrawal entry by ID
router.delete('/withdrawl/:id', async (req, res) => {
  const withdrawlId = req.params.id;

  try {
    const query = 'DELETE FROM withdrawl WHERE id = ?';
    connection.query(query, [withdrawlId], (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database query error' });
      }
      if (results.affectedRows === 0) {
        return res.status(404).json({ error: 'Withdrawal entry not found' });
      }
      res.json({ message: 'Withdrawal entry deleted successfully' });
    });
  } catch (error) {
    console.error('Error deleting withdrawal entry:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// // ================= allusers - Withdrawal - wallet Summary =================
// router.get("/summary", async (req, res) => {
//   try {
//     const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

//     // yesterday date
//     const yesterday = new Date();
//     yesterday.setDate(yesterday.getDate() - 1);
//     const yesterdayStr = yesterday.toISOString().slice(0, 10);

//     //----------------- total user/ today /yersday join user ------------------------------
//     const [usersResult] = await connection
//       .promise()
//       .query("SELECT COUNT(*) AS totalUsers FROM users");

//     const [todayUsersResult] = await connection
//       .promise()
//       .query("SELECT COUNT(*) AS totalUsersJoinToday FROM users WHERE DATE(created_at) = ?", [today]);

//     const [yesterdayUsersResult] = await connection
//       .promise()
//       .query("SELECT COUNT(*) AS totalUsersJoinYesterday FROM users WHERE DATE(created_at) = ?", [yesterdayStr]);

//     //----------------- total/yesterday/today withdrawal / total withdrawal----------------------      
//     const [withdrawalsResult] = await connection
//       .promise()
//       .query(
//         "SELECT IFNULL(SUM(balance), 0) AS todaysTotalWithdrawal FROM withdrawl WHERE status = 1 AND DATE(updated_at) = ?",
//         [today]
//       );

//     const [yesterdayWithdrawal] = await connection
//       .promise()
//       .query(
//         "SELECT IFNULL(SUM(balance), 0) AS yesterdayTotalWithdrawal FROM withdrawl WHERE status = 1 AND DATE(updated_at) = ?",
//         [yesterdayStr]
//       );

//     const [totalwithdrawal] = await connection
//       .promise()
//       .query("SELECT IFNULL(SUM(balance), 0) AS totalWithdrawal FROM withdrawl WHERE status = 1");

//     //----------------- wallet balance of users----------------------
//     const [wallet] = await connection
//       .promise()
//       .query("SELECT SUM(balance) AS totalWalletBalanceOfUsers FROM wallet WHERE cryptoname = 'INR'");

//     //----------------- recharge stats ----------------------
//     //  Today’s successful recharge total amount
//     const [todayRechargeAmount] = await connection
//       .promise()
//       .query(
//         "SELECT IFNULL(SUM(recharge_amount),0) AS todayTotalRechargeAmount FROM recharge WHERE recharge_status = 'success' AND DATE(date) = ?",
//         [today]
//       );

//     //  Yesterday’s successful recharge total amount
//     const [yesterdayRechargeAmount] = await connection
//       .promise()
//       .query(
//         "SELECT IFNULL(SUM(recharge_amount),0) AS yesterdayTotalRechargeAmount FROM recharge WHERE recharge_status = 'success' AND DATE(date) = ?",
//         [yesterdayStr]
//       );

//     //  All-time successful recharge total amount
//     const [alltimeRechargeAmount] = await connection
//       .promise()
//       .query(
//         "SELECT IFNULL(SUM(recharge_amount),0) AS alltimeTotalRechargeAmount FROM recharge WHERE recharge_status = 'success'"
//       );

//     //  Number of successful recharges today
//     const [todayRechargeCount] = await connection
//       .promise()
//       .query(
//         "SELECT COUNT(*) AS numberOfSuccessfulRechargeToday FROM recharge WHERE recharge_status = 'success' AND DATE(date) = ?",
//         [today]
//       );

//     //  Number of successful recharges all-time
//     const [alltimeRechargeCount] = await connection
//       .promise()
//       .query(
//         "SELECT COUNT(*) AS numberOfSuccessfulRechargeAlltime FROM recharge WHERE recharge_status = 'success'"
//       );

//     res.json({
//       totalUsers: usersResult[0].totalUsers,
//       totalUsersJoinToday: todayUsersResult[0].totalUsersJoinToday,
//       totalUsersJoinYesterday: yesterdayUsersResult[0].totalUsersJoinYesterday,

//       todaysTotalWithdrawalAmount: withdrawalsResult[0].todaysTotalWithdrawal,
//       yesterdayTotalWithdrawalAmount: yesterdayWithdrawal[0].yesterdayTotalWithdrawal,
//       totalWithdrawal: totalwithdrawal[0].totalWithdrawal,

//       totalWalletBalanceOfUsers: Number(parseFloat(wallet[0].totalWalletBalanceOfUsers).toFixed(2)) || 0,

//       // recharge stats
//       todayTotalRechargeAmount: Number(parseFloat(todayRechargeAmount[0].todayTotalRechargeAmount).toFixed(2)) || 0,
//       yesterdayTotalRechargeAmount: Number(parseFloat(yesterdayRechargeAmount[0].yesterdayTotalRechargeAmount).toFixed(2)) || 0,
//       alltimeTotalRechargeAmount: Number(parseFloat(alltimeRechargeAmount[0].alltimeTotalRechargeAmount).toFixed(2)) || 0,

//       numberOfSuccessfulRechargeToday: todayRechargeCount[0].numberOfSuccessfulRechargeToday,
//       numberOfSuccessfulRechargeAlltime: alltimeRechargeCount[0].numberOfSuccessfulRechargeAlltime
//     });
//   } catch (error) {
//     console.error("Error fetching summary:", error);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// });

// ================= allusers - Withdrawal - wallet Summary =================



// Function to get IST date (YYYY-MM-DD)
function getISTDate(offsetDays = 0) {
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  istTime.setDate(istTime.getDate() + offsetDays);
  return istTime.toISOString().split("T")[0];
}

// Function to get IST date range in UTC for database queries
function getISTDateRangeInUTC(offsetDays = 0) {
  // Get the IST date we want
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  istTime.setDate(istTime.getDate() + offsetDays);
  
  // Create start and end of day in IST
  const startOfDayIST = new Date(istTime);
  startOfDayIST.setHours(0, 0, 0, 0);
  
  const endOfDayIST = new Date(istTime);
  endOfDayIST.setHours(23, 59, 59, 999);
  
  // Convert back to UTC for database queries
  const startOfDayUTC = new Date(startOfDayIST.getTime() - (5.5 * 60 * 60 * 1000));
  const endOfDayUTC = new Date(endOfDayIST.getTime() - (5.5 * 60 * 60 * 1000));
  
  return {
    start: startOfDayUTC.toISOString().slice(0, 19).replace('T', ' '),
    end: endOfDayUTC.toISOString().slice(0, 19).replace('T', ' ')
  };
}

router.get("/summary", async (req, res) => {
  try {
    // Get IST date ranges converted to UTC
    const todayRange = getISTDateRangeInUTC(0);      // Today in IST
    const yesterdayRange = getISTDateRangeInUTC(-1); // Yesterday in IST

    console.log("todayRange (UTC):", todayRange);
    console.log("yesterdayRange (UTC):", yesterdayRange);
    console.log("Current IST Date:", getISTDate(0));
    console.log("Current UTC Date:", new Date().toISOString().slice(0, 10));

    //----------------- total user/ today / yesterday join user ------------------------------
    const [usersResult] = await connection
      .promise()
      .query("SELECT COUNT(*) AS totalUsers FROM users");

    const [todayUsersResult] = await connection
      .promise()
      .query(
        "SELECT COUNT(*) AS totalUsersJoinToday FROM users WHERE created_at >= ? AND created_at <= ?", 
        [todayRange.start, todayRange.end]
      );

    const [yesterdayUsersResult] = await connection
      .promise()
      .query(
        "SELECT COUNT(*) AS totalUsersJoinYesterday FROM users WHERE created_at >= ? AND created_at <= ?", 
        [yesterdayRange.start, yesterdayRange.end]
      );

    //----------------- total/yesterday/today withdrawal / total withdrawal----------------------      
    const [withdrawalsResult] = await connection
      .promise()
      .query(
        "SELECT IFNULL(SUM(balance), 0) AS todaysTotalWithdrawal FROM withdrawl WHERE status = 1 AND updated_at >= ? AND updated_at <= ?",
        [todayRange.start, todayRange.end]
      );

    const [yesterdayWithdrawal] = await connection
      .promise()
      .query(
        "SELECT IFNULL(SUM(balance), 0) AS yesterdayTotalWithdrawal FROM withdrawl WHERE status = 1 AND updated_at >= ? AND updated_at <= ?",
        [yesterdayRange.start, yesterdayRange.end]
      );

    const [totalwithdrawal] = await connection
      .promise()
      .query("SELECT IFNULL(SUM(balance), 0) AS totalWithdrawal FROM withdrawl WHERE status = 1");

    //----------------- wallet balance of users----------------------
    const [wallet] = await connection
      .promise()
      .query("SELECT SUM(balance) AS totalWalletBalanceOfUsers FROM wallet WHERE cryptoname = 'INR'");

    //----------------- recharge stats ----------------------
    const [todayRechargeAmount] = await connection
      .promise()
      .query(
        "SELECT IFNULL(SUM(recharge_amount),0) AS todayTotalRechargeAmount FROM recharge WHERE recharge_status = 'success' AND date >= ? AND date <= ?",
        [todayRange.start, todayRange.end]
      );

    const [yesterdayRechargeAmount] = await connection
      .promise()
      .query(
        "SELECT IFNULL(SUM(recharge_amount),0) AS yesterdayTotalRechargeAmount FROM recharge WHERE recharge_status = 'success' AND date >= ? AND date <= ?",
        [yesterdayRange.start, yesterdayRange.end]
      );

    const [alltimeRechargeAmount] = await connection
      .promise()
      .query(
        "SELECT IFNULL(SUM(recharge_amount),0) AS alltimeTotalRechargeAmount FROM recharge WHERE recharge_status = 'success'"
      );

    const [todayRechargeCount] = await connection
      .promise()
      .query(
        "SELECT COUNT(*) AS numberOfSuccessfulRechargeToday FROM recharge WHERE recharge_status = 'success' AND date >= ? AND date <= ?",
        [todayRange.start, todayRange.end]
      );

    const [alltimeRechargeCount] = await connection
      .promise()
      .query(
        "SELECT COUNT(*) AS numberOfSuccessfulRechargeAlltime FROM recharge WHERE recharge_status = 'success'"
      );

    res.json({
      totalUsers: usersResult[0].totalUsers,
      totalUsersJoinToday: todayUsersResult[0].totalUsersJoinToday,
      totalUsersJoinYesterday: yesterdayUsersResult[0].totalUsersJoinYesterday,

      todaysTotalWithdrawalAmount: withdrawalsResult[0].todaysTotalWithdrawal,
      yesterdayTotalWithdrawalAmount: yesterdayWithdrawal[0].yesterdayTotalWithdrawal,
      totalWithdrawal: totalwithdrawal[0].totalWithdrawal,

      totalWalletBalanceOfUsers: Number(parseFloat(wallet[0].totalWalletBalanceOfUsers).toFixed(2)) || 0,

      todayTotalRechargeAmount: Number(parseFloat(todayRechargeAmount[0].todayTotalRechargeAmount).toFixed(2)) || 0,
      yesterdayTotalRechargeAmount: Number(parseFloat(yesterdayRechargeAmount[0].yesterdayTotalRechargeAmount).toFixed(2)) || 0,
      alltimeTotalRechargeAmount: Number(parseFloat(alltimeRechargeAmount[0].alltimeTotalRechargeAmount).toFixed(2)) || 0,

      numberOfSuccessfulRechargeToday: todayRechargeCount[0].numberOfSuccessfulRechargeToday,
      numberOfSuccessfulRechargeAlltime: alltimeRechargeCount[0].numberOfSuccessfulRechargeAlltime,

      // Debug info (remove in production)
      debugInfo: {
        todayIST: getISTDate(0),
        todayUTCRange: `${todayRange.start} to ${todayRange.end}`,
        yesterdayUTCRange: `${yesterdayRange.start} to ${yesterdayRange.end}`
      }
    });
  } catch (error) {
    console.error("Error fetching summary:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


module.exports = router;
