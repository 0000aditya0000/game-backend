const express = require('express');
const connection = require('../config/db');

const router = express.Router();

// Create a new bank account
router.post('/addnew', async (req, res) => {
  const { userId, type, accountname, accountnumber, ifsccode, branch, usdt, network } = req.body;

  try {
    // If type is USDT, check for duplicate USDT address
    if (type !== 'bank') {
      const checkDuplicateQuery = `
        SELECT id FROM bankaccount 
        WHERE userId = ? AND usdt = ? AND usdt IS NOT NULL
      `;
      
      connection.query(checkDuplicateQuery, [userId, usdt], (err, results) => {
        if (err) {
          console.log(err);
          return res.status(500).json({ error: 'Database error while checking USDT address' });
        }
        
        if (results.length > 0) {
          return res.status(400).json({ error: 'USDT address already exists for this user' });
        }
        
        // Insert USDT account
        insertAccount();
      });
    } else {
      // Directly insert bank account
      insertAccount();
    }

    function insertAccount() {
      let query;
      let values;

      if (type === 'bank') {
        // For bank accounts
        query = `
          INSERT INTO bankaccount (userId, accountname, accountnumber, ifsccode, branch, status) 
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        values = [userId, accountname, accountnumber, ifsccode, branch, 0];
      } else {
        // For USDT accounts
        query = `
          INSERT INTO bankaccount (userId, usdt, network, status) 
          VALUES (?, ?, ?, ?)
        `;
        values = [userId, usdt, network, 0];
      }

      connection.query(query, values, (err, results) => {
        if (err) {
          console.log(err);
          return res.status(500).json({ error: 'Database error while creating account' });
        }
        res.status(201).json({ 
          message: `${type === 'bank' ? 'Bank account' : 'USDT address'} created successfully`, 
          id: results.insertId 
        });
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error creating account' });
  }
});

// Retrieve all bank accounts with pagination and status filter
// router.get('/getall', async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 10;
//     const offset = (page - 1) * limit;
//     const status = req.query.status; // Optional status filter

//     // Base queries with proper table aliases
//     let query = `
//       SELECT 
//         ba.id,
//         ba.userId,
//         ba.status,
//         ba.accountname,
//         ba.accountnumber,
//         ba.ifsccode,
//         ba.branch,
//         ba.usdt,
//         ba.network,
//         u.name,
//         u.username,
//         u.email,
//         u.phone,
//         u.kycstatus
//       FROM bankaccount ba
//       LEFT JOIN users u ON ba.userId = u.id
//     `;
    
//     let countQuery = `
//       SELECT COUNT(*) as total 
//       FROM bankaccount ba
//     `;

//     let queryParams = [];
//     let whereClause = '';

//     // Add status filter if provided
//     if (status !== undefined) {
//       whereClause = ' WHERE ba.status = ?';
//       queryParams.push(parseInt(status));
//     }

//     countQuery += whereClause;
//     query += whereClause;

//     // Add pagination
//     query += " ORDER BY ba.id DESC LIMIT ? OFFSET ?";
//     queryParams.push(limit, offset);

//     // Get total count
//     connection.query(countQuery, queryParams.slice(0, -2), (countErr, countResults) => {
//       if (countErr) {
//         console.error('Count Query Error:', countErr);
//         return res.status(500).json({ 
//           error: 'Database query error', 
//           details: countErr.message 
//         });
//       }

//       const totalRecords = countResults[0].total;
//       const totalPages = Math.ceil(totalRecords / limit);

//       // Get paginated results
//       connection.query(query, queryParams, (err, results) => {
//         if (err) {
//           console.error('Data Query Error:', err);
//           return res.status(500).json({ 
//             error: 'Database query error', 
//             details: err.message 
//           });
//         }
        
//         // Format the response data
//         const formattedData = results.map(record => {
//           const baseData = {
//             id: record.id,
//             userId: record.userId,
//             status: record.status,
//             user: {
//               name: record.name || null,
//               username: record.username || null,
//               email: record.email || null,
//               mobile: record.mobile || null,
//               kyc_status: record.kyc_status || null
//             }
//           };

//           // Add either bank account details or USDT details
//           if (record.accountnumber) {
//             baseData.accountType = 'bank';
//             baseData.bankDetails = {
//               accountName: record.accountname || null,
//               accountNumber: record.accountnumber || null,
//               ifscCode: record.ifsccode || null,
//               branch: record.branch || null
//             };
//           } else if (record.usdt) {
//             baseData.accountType = 'crypto';
//             baseData.cryptoDetails = {
//               usdtAddress: record.usdt || null,
//               network: record.network || null
//             };
//           }

//           return baseData;
//         });

//         res.json({
//           success: true,
//           data: formattedData,
//           pagination: {
//             currentPage: page,
//             totalPages: totalPages,
//             totalRecords: totalRecords,
//             limit: limit
//           }
//         });
//       });
//     });
//   } catch (error) {
//     console.error('Server Error:', error);
//     res.status(500).json({ 
//       error: 'Error fetching bank accounts',
//       details: error.message 
//     });
//   }
// });
router.get('/getall', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status; // Optional status filter

    let query = `
      SELECT 
        ba.id,
        ba.userId,
        ba.status,
        ba.accountname,
        ba.accountnumber,
        ba.ifsccode,
        ba.branch,
        ba.usdt,
        ba.network,
        u.name,
        u.username,
        u.email,
        u.phone
      FROM bankaccount ba
      LEFT JOIN users u ON ba.userId = u.id
    `;

    let countQuery = `
      SELECT COUNT(*) as total 
      FROM bankaccount ba
      LEFT JOIN users u ON ba.userId = u.id
    `;

    let queryParams = [];
    let whereClause = '';

    if (status !== undefined) {
      whereClause = ' WHERE ba.status = ?';
      queryParams.push(parseInt(status));
    }

    countQuery += whereClause;
    query += whereClause;
    query += " ORDER BY ba.id DESC LIMIT ? OFFSET ?";
    queryParams.push(limit, offset);

    // Get total count
    connection.query(countQuery, queryParams.slice(0, -2), (countErr, countResults) => {
      if (countErr) {
        return res.status(500).json({ error: 'Database query error', details: countErr.message });
      }

      const totalRecords = countResults[0].total;
      const totalPages = Math.ceil(totalRecords / limit);

      connection.query(query, queryParams, async (err, results) => {
        if (err) {
          return res.status(500).json({ error: 'Database query error', details: err.message });
        }

        const userIds = results.map(r => r.userId);
        let kycDataMap = {};

        if (userIds.length > 0) {
          const kycQuery = `SELECT * FROM user_kyc_requests WHERE user_id IN (?)`;
          const [kycResults] = await new Promise((resolve, reject) => {
            connection.query(kycQuery, [userIds], (err, res) => {
              if (err) reject(err);
              else resolve([res]);
            });
          });

          kycResults.forEach(k => {
            kycDataMap[k.user_id] = k;
          });
        }

        const formattedData = results.map(record => {
          const kyc = kycDataMap[record.userId] || {};

          const baseData = {
            id: record.id,
            userId: record.userId,
            status: record.status,
            user: {
              name: record.name || null,
              username: record.username || null,
              email: record.email || null,
              mobile: record.phone || null,
              kyc: {
                status: kyc.status || 'not_submitted',
                note: kyc.kyc_note || null,
                aadhar_front: kyc.aadhar_front || null,
                aadhar_back: kyc.aadhar_back || null,
                pan: kyc.pan || null,
                created_at: kyc.created_at || null,
                updated_at: kyc.updated_at || null
              }
            }
          };

          if (record.accountnumber) {
            baseData.accountType = 'bank';
            baseData.bankDetails = {
              accountName: record.accountname || null,
              accountNumber: record.accountnumber || null,
              ifscCode: record.ifsccode || null,
              branch: record.branch || null
            };
          } else if (record.usdt) {
            baseData.accountType = 'crypto';
            baseData.cryptoDetails = {
              usdtAddress: record.usdt || null,
              network: record.network || null
            };
          }

          return baseData;
        });

        res.json({
          success: true,
          data: formattedData,
          pagination: {
            currentPage: page,
            totalPages: totalPages,
            totalRecords: totalRecords,
            limit: limit
          }
        });
      });
    });
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ 
      error: 'Error fetching bank accounts',
      details: error.message 
    });
  }
});

//Retrive one bank accounts by user id
router.get('/getone/user/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const query = "SELECT * FROM bankaccount WHERE userId = ?";
    connection.query(query, [userId], (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      if (results.length === 0) return res.status(404).json({ error: 'Bank account not found' });
      res.json(results);
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching bank account' });
  }
});

// Retrieve a single bank account by ID
router.get('/getonebyid/:id', async (req, res) => {
  const bankAccountId = req.params.id;

  try {
    const query = "SELECT * FROM bankaccount WHERE id = ?";
    connection.query(query, [bankAccountId], (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      if (results.length === 0) return res.status(404).json({ error: 'Bank account not found' });
      res.json(results[0]);
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching bank account' });
  }
});

// Update a bank account by ID
router.put('/update/:id', async (req, res) => {
  const bankAccountId = req.params.id;
  const { type, accountname, accountnumber, ifsccode, branch, usdt, network, status } = req.body;

  try {
    // First get the existing record to check its type
    const getQuery = "SELECT * FROM bankaccount WHERE id = ?";
    connection.query(getQuery, [bankAccountId], async (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      if (results.length === 0) return res.status(404).json({ error: 'Account not found' });

      const existingAccount = results[0];

      // If updating to USDT, check for duplicates (excluding current record)
      if (type !== 'bank' && usdt) {
        const checkDuplicateQuery = `
          SELECT id FROM bankaccount 
          WHERE userId = ? AND usdt = ? AND usdt IS NOT NULL AND id != ?
        `;
        
        connection.query(checkDuplicateQuery, [existingAccount.userId, usdt, bankAccountId], (err, results) => {
          if (err) {
            console.log(err);
            return res.status(500).json({ error: 'Database error while checking USDT address' });
          }
          
          if (results.length > 0) {
            return res.status(400).json({ error: 'USDT address already exists for this user' });
          }
          
          // Proceed with update
          updateAccount();
        });
      } else {
        // Directly update if it's a bank account
        updateAccount();
      }
    });

    function updateAccount() {
      let query;
      let values;

      if (type === 'bank') {
        // For bank accounts
        query = `
          UPDATE bankaccount 
          SET accountname = ?, accountnumber = ?, ifsccode = ?, branch = ?, status = ?,
              usdt = NULL, network = NULL
          WHERE id = ?
        `;
        values = [accountname, accountnumber, ifsccode, branch, status || 0, bankAccountId];
      } else {
        // For USDT accounts
        query = `
          UPDATE bankaccount 
          SET usdt = ?, network = ?, status = ?,
              accountname = NULL, accountnumber = NULL, ifsccode = NULL, branch = NULL
          WHERE id = ?
        `;
        values = [usdt, network, status || 0, bankAccountId];
      }

      connection.query(query, values, (err, results) => {
        if (err) {
          console.log(err);
          return res.status(500).json({ error: 'Database error while updating account' });
        }
        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Account not found' });
        }
        res.json({ 
          message: `${type === 'bank' ? 'Bank account' : 'USDT address'} updated successfully` 
        });
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error updating account' });
  }
});

// Delete a bank account by ID
router.delete('/delete/:id', async (req, res) => {
  const bankAccountId = req.params.id;

  try {
    const query = "DELETE FROM bankaccount WHERE id = ?";
    connection.query(query, [bankAccountId], (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      if (results.affectedRows === 0)
        return res.status(404).json({ error: 'Bank account not found' });

      res.json({ message: 'Bank account deleted successfully' });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting bank account' });
  }
});


// // Simple status update for bank account
// router.put('/update-status/:id', async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;

//     if (status === undefined) {
//       return res.status(400).json({
//         success: false,
//         message: 'Status is required'
//       });
//     }

//     const updateQuery = "UPDATE bankaccount SET status = ? WHERE id = ?";
    
//     connection.query(updateQuery, [status, id], (err, results) => {
//       if (err) {
//         return res.status(500).json({
//           success: false,
//           message: 'Error updating status'
//         });
//       }

//       if (results.affectedRows === 0) {
//         return res.status(404).json({
//           success: false,
//           message: 'Bank account not found'
//         });
//       }

//       res.json({
//         success: true,
//         message: Status updated successfully
//       });
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Server error'
//     });
//   }
// });  



//============= modify Simple status update for bank account with note
router.put('/update-status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    // Validate status
    if (status === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    // Require note for rejection (status 2)
    if (status === 2 && !note) {
      return res.status(400).json({
        success: false,
        message: 'Note is required when rejecting'
      });
    }

    const updateQuery = `
      UPDATE bankaccount 
      SET status = ?, 
          status_note = ?
      
      WHERE id = ?`;
    
    connection.query(updateQuery, [status, note || null, id], (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({
          success: false,
          message: 'Error updating status',
          error: err.message
        });
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Bank account not found'
        });
      }

      // Fetch updated record to return in response
      const getUpdatedRecord = "SELECT id, status, status_note FROM bankaccount WHERE id = ?";
      connection.query(getUpdatedRecord, [id], (err, record) => {
        if (err) {
          return res.status(500).json({
            success: false,
            message: 'Error fetching updated record'
          });
        }

        res.json({
          success: true,
          message: `Status updated successfully`,
          data: {
            id: record[0].id,
            status: record[0].status,
            status_text: status === 1 ? 'Approved' : status === 2 ? 'Rejected' : 'Pending',
            note: record[0].status_note,
          }
        });
      });
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;
