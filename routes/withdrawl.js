const express = require('express');
const connection = require('../config/db'); // Ensure database connection is configured
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken'); 
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
//                   status: 'pending',
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

// Get all withdrawal entries with user and bank details based on status
router.get('/withdrawl-requests/:status', async (req, res) => {
  try {
    const withdrawalStatus = Number(req.params.status);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    // Validate status parameter
    if (![0, 1, 2, 3].includes(Number(withdrawalStatus))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status parameter. Status must be 0 (pending), 1 (approved), 2 (rejected), or 3 (all)'
      });
    }

    // Get total count first
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

        // Fetch current page data plus one extra record to determine if next page exists
        const query = `
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
          WHERE ${withdrawalStatus === 3 ? '1=1' : 'w.status = ?'}
          ORDER BY w.createdOn DESC
          LIMIT ? OFFSET ?
        `;

        const queryParams = withdrawalStatus === 3 
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

          // Check if there's a next page
          const hasNextPage = results.length > limit;
          // Remove the extra record we fetched
          const paginatedResults = results.slice(0, limit);

          const statusText = {
            0: 'Pending',
            1: 'Approved',
            2: 'Rejected',
            3: 'All'
          }[withdrawalStatus];

          const formattedResults = paginatedResults.map(item => ({
            withdrawalId: item.id,
            amount: item.balance,
            cryptoname: item.cryptoname,
            requestDate: item.createdOn,
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
          }));

          res.json({
            success: true,
            message: `${statusText} withdrawal records fetched successfully`,
            data: formattedResults,
            pagination: {
              currentPage: page,
              totalPages: totalPages,
              totalRecords: totalRecords,
              hasNextPage: hasNextPage,
              nextPage: hasNextPage ? page + 1 : null
            }
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



//============================================================================
// make the authentication middleware available for all routes in this file
// This will ensure that all routes in this file require authentication
              router.use(authenticateToken);
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
          WHERE userId = ? AND cryptoname = 'inr'
        `;

        connection.query(checkBalanceQuery, [userId], (err, results) => {
          if (err) {
            return connection.rollback(() => {
              res.status(500).json({
                success: false,
                message: 'Error checking wallet balance'
              });
            });
          }

          if (results.length === 0 || parseFloat(results[0].balance) < parseFloat(amount)) {
            return connection.rollback(() => {
              res.status(400).json({
                success: false,
                message: 'Insufficient balance'
              });
            });
          }

          // 6. Deduct from wallet
          const deductBalanceQuery = `
            UPDATE wallet 
            SET balance = balance - ? 
            WHERE userId = ? AND cryptoname = 'inr'
          `;

          connection.query(deductBalanceQuery, [amount, userId], (err) => {
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
                  status, createdOn
                ) VALUES (?, ?, ?, ?, ?, NOW())
              `;
              insertParams = [userId, amount, currency, bankname, 0];
            } else {
              insertQuery = `
                INSERT INTO withdrawl (
                  userId, balance, cryptoname, walletAddress,
                  networkType, status, createdOn
                ) VALUES (?, ?, ?, ?, ?, ?, NOW())
              `;
              insertParams = [userId, amount, currency, walletAddress, network, 0];
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





module.exports = router;
