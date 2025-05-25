const express = require('express');
const connection = require('../config/db'); // Ensure database connection is configured
const router = express.Router();

// Create a new withdrawal entry and deduct balance from the wallet
router.post('/withdrawl', async (req, res) => {
  console.log("api called");
  const { userId, balance, cryptoname, status } = req.body;
  console.log(userId, balance, cryptoname, status);

  if (!userId || !cryptoname || !balance || balance <= 0) {
    console.log("I am in");
    return res.status(400).json({ error: 'Invalid input. userId, cryptoname, and a positive balance are required.' });
  }
  console.log("I am here");

  try {
    // Start a transaction to ensure atomicity
    connection.beginTransaction((err, results) => {
      if (err) {
        console.error('Transaction error:', err);
        return res.status(500).json({ error: 'Transaction initialization failed' });
      } else {
        console.log(results);
      }


      // Deduct the balance from the wallet
      const deductBalanceQuery = `
        UPDATE wallet
        SET balance = balance - ?
        WHERE userId = ? AND cryptoname = ? 
      `;
      const response = connection.query(
        deductBalanceQuery,
        [balance, userId, cryptoname, balance],
        (err, results) => {
          if (err) {
            console.error('Database error during balance deduction:', err);
            return connection.rollback(() => {
              res.status(500).json({ error: 'Error updating wallet balance' });
            });
          }


          if (results.affectedRows === 0) {
            return connection.rollback(() => {
              res.status(400).json({ error: 'Insufficient balance or wallet entry not found' });
            });
          }

          // Insert the withdrawal entry
          const createWithdrawalQuery = `
            INSERT INTO withdrawl (userId, balance, cryptoname, status)
            VALUES (?, ?, ?, ?)
          `;
          connection.query(
            createWithdrawalQuery,
            [userId, balance, cryptoname, status || 0],
            (err, withdrawalResults) => {
              if (err) {
                console.error('Database error during withdrawal creation:', err);
                return connection.rollback(() => {
                  res.status(500).json({ error: 'Error creating withdrawal entry' });
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

                res.status(201).json({
                  message: 'Withdrawal entry created successfully and balance deducted',
                  id: withdrawalResults.insertId,
                });
              });
            }
          );
        }
      );
    });
  } catch (error) {
    console.error('Error creating withdrawal entry:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Get all withdrawal entries with username from the user table


router.get('/withdrawl', async (req, res) => {
  try {
    const query = 'SELECT * FROM withdrawl';
    connection.query(query, (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database query error' });
      }
      res.json(results);
    });
  } catch (error) {
    console.error('Error fetching withdrawal entries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a single withdrawal entry by ID
router.get('/withdrawl/:id', async (req, res) => {
  const withdrawlId = req.params.id;

  try {
    const query = 'SELECT * FROM withdrawl WHERE id = ?';
    connection.query(query, [withdrawlId], (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database query error' });
      }
      if (results.length === 0) {
        return res.status(404).json({ error: 'Withdrawal entry not found' });
      }
      res.json(results[0]);
    });
  } catch (error) {
    console.error('Error fetching withdrawal entry:', error);
    res.status(500).json({ error: 'Internal server error' });
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

// ============================withdrawal apporove or reject==================================
router.put('/withdrawal/approve/:id', async (req, res) => {
  try {
    const withdrawalId = req.params.id;
    const numericStatus = parseInt(req.body.status); // status: 1 for approve, 2 for reject

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
            WHERE userId = ? AND cryptoname = ?
          `;

          connection.query(refundQuery,
            [withdrawal.balance, withdrawal.userId, withdrawal.cryptoname],
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
          const updateQuery = "UPDATE withdrawl SET status = ? WHERE id = ?";

          connection.query(updateQuery, [numericStatus, withdrawalId], (err) => {
            if (err) {
              return connection.rollback(() => {
                res.status(500).json({
                  success: false,
                  message: "Failed to update withdrawal status"
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
                  amount: withdrawal.balance,
                  cryptoname: withdrawal.cryptoname
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

module.exports = router;
