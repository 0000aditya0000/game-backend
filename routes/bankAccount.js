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

// Retrieve all bank accounts
router.get('/getall', async (req, res) => {
  try {
    const query = "SELECT * FROM bankaccount";
    connection.query(query, (err, results) => {
      if (err) return res.status(500).json({ error: 'Database query error' });
      res.json(results);
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching bank accounts' });
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

module.exports = router;
