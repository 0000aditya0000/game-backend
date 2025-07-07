const express = require('express');
const router = express.Router();
const connection = require('../config/db');
const authenticateToken = require('../middleware/authenticateToken');









//========= Admin: Get all queries with pagination and filters ============
router.get('/admin/all', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status;
        const type = req.query.type;
        const offset = (page - 1) * limit;

        let whereClause = '1=1';
        const queryParams = [];

        if (status) {
            whereClause += ' AND status = ?';
            queryParams.push(status);
        }

        if (type) {
            whereClause += ' AND query_type = ?';
            queryParams.push(type);
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM user_queries WHERE ${whereClause}`;

        connection.query(countQuery, queryParams, (countErr, countResult) => {
            if (countErr) {
                return res.status(500).json({
                    success: false,
                    message: "Error counting queries"
                });
            }

            const totalQueries = countResult[0].total;
            const totalPages = Math.ceil(totalQueries / limit);

            // Get queries with comment count
            const query = `
                SELECT q.*, COUNT(c.id) as comment_count
                FROM user_queries q
                LEFT JOIN query_comments c ON q.id = c.query_id
                WHERE ${whereClause}
                GROUP BY q.id
                ORDER BY q.created_at DESC
                LIMIT ? OFFSET ?
            `;

            connection.query(query, [...queryParams, limit, offset], (err, queries) => {
                if (err) {
                    return res.status(500).json({
                        success: false,
                        message: "Error fetching queries"
                    });
                }

                // Step 1: Extract all query IDs
                const queryIds = queries.map(q => q.id);
                if (queryIds.length === 0) {
                    return res.json({
                        success: true,
                        message: "Queries retrieved successfully",
                        pagination: {
                            current_page: page,
                            total_pages: totalPages,
                            total_items: totalQueries,
                            items_per_page: limit
                        },
                        data: []
                    });
                }

                // Step 2: Get all comments for these query IDs
                const commentQuery = `
                    SELECT * FROM query_comments 
                    WHERE query_id IN (${queryIds.map(() => '?').join(',')})
                    ORDER BY created_at ASC
                `;

                connection.query(commentQuery, queryIds, (commentErr, comments) => {
                    if (commentErr) {
                        return res.status(500).json({
                            success: false,
                            message: "Error fetching comments"
                        });
                    }

                    // Step 3: Group comments by query_id
                    const commentMap = {};
                    comments.forEach(c => {
                        if (!commentMap[c.query_id]) commentMap[c.query_id] = [];
                        commentMap[c.query_id].push(c);
                    });

                    // Step 4: Attach comments to queries
                    const finalData = queries.map(q => ({
                        ...q,
                        comments: commentMap[q.id] || []
                    }));

                    res.json({
                        success: true,
                        message: "Queries retrieved successfully",
                        pagination: {
                            current_page: page,
                            total_pages: totalPages,
                            total_items: totalQueries,
                            items_per_page: limit
                        },
                        data: finalData
                    });
                });
            });
        });
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});


// ================= Add comment to query : by admin ===============
router.post('/:queryId/comment', async (req, res) => {
    try {
        const { queryId } = req.params;
          console.log("Body received:", req.body); // Debug line
        const { comment, is_admin } = req.body;
   
    if (!comment || comment.trim() === "") {
    return res.status(400).json({
        success: false,
        message: "Comment is required"
    });
}

        // First check if query exists
        const checkQuery = "SELECT id FROM user_queries WHERE id = ?";
        connection.query(checkQuery, [queryId], (checkErr, checkResults) => {
            if (checkErr || checkResults.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Query not found"
                });
            }

            // Add comment
            const insertQuery = `
                INSERT INTO query_comments 
                (query_id, comment, admin_comment) 
                VALUES (?, ?, ?)
            `;

            connection.query(insertQuery, [queryId, comment, !!is_admin], (err, results) => {
                if (err) {
                    return res.status(500).json({
                        success: false,
                        message: "Error adding comment"
                    });
                }

                res.json({
                    success: true,
                    message: "Comment added successfully",
                    data: {
                        id: results.insertId,
                        query_id: queryId,
                        comment,
                        admin_comment: !!is_admin,
                        created_at: new Date()
                    }
                });
            });
        });
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});

//===============  Update query status : by admin ===============
router.put('/:queryId/status', async (req, res) => {
    try {
        const { queryId } = req.params;
        const { status } = req.body;

        // Validate status
        const validStatuses = ['pending', 'in_progress', 'resolved', 'closed'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status"
            });
        }

        const updateQuery = `
            UPDATE user_queries 
            SET status = ? 
            WHERE id = ?
        `;

        connection.query(updateQuery, [status, queryId], (err, results) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Error updating query status"
                });
            }

            if (results.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Query not found"
                });
            }

            res.json({
                success: true,
                message: "Query status updated successfully",
                data: {
                    query_id: queryId,
                    new_status: status
                }
            });
        });
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});



//============================================================================
// This will ensure that all below routes in this file require authentication
              router.use(authenticateToken);
//=============================================================================


// Helper function to generate unique query ID
function generateQueryId() {
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `Q${timestamp.slice(-6)}${random}`;
}

// ======================= Submit a new query ==========
router.post('/submit', async (req, res) => {
    try {
   const { user_id, name, email, phone, telegram_id, query_type, message } = req.body;


        // Validate required fields
        if (!user_id||!name || !email || !phone || !query_type || !message) {
            return res.status(400).json({
                success: false,
                message: "All fields except Telegram ID are required"
            });
        }

        // Validate query type
        const validQueryTypes = ['general', 'account', 'payment', 'technical', 'other'];
        if (!validQueryTypes.includes(query_type)) {
            return res.status(400).json({
                success: false,
                message: "Invalid query type"
            });
        }

        // Generate unique query ID
        const queryId = generateQueryId();

      const query = `
    INSERT INTO user_queries 
    (id, user_id, name, email, phone, telegram_id, query_type, message) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

        connection.query(
            query,
            [queryId, user_id, name, email, phone, telegram_id, query_type, message],
            (err, results) => {
                if (err) {
                    console.error('Error submitting query:', err);
                    return res.status(500).json({
                        success: false,
                        message: "Error submitting query"
                    });
                }

                res.json({
                    success: true,
                    message: "Query submitted successfully",
                    data: {
                        query_id: queryId,
                        status: 'pending',
                        submitted_at: new Date()
                    }
                });
            }
        );
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});

//======================= Get query status and comments by ID =========
router.get('/:queryId', async (req, res) => {
    try {
        const { queryId } = req.params;

        const queryDetails = `
            SELECT q.*, 
                   GROUP_CONCAT(
                       JSON_OBJECT(
                           'id', c.id,
                           'comment', c.comment,
                           'admin_comment', c.admin_comment,
                           'created_at', c.created_at
                       )
                   ) as comments
            FROM user_queries q
            LEFT JOIN query_comments c ON q.id = c.query_id
            WHERE q.id = ?
            GROUP BY q.id
        `;

        connection.query(queryDetails, [queryId], (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({
                    success: false,
                    message: "Error fetching query details"
                });
            }

            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Query not found"
                });
            }

            const query = results[0];
            query.comments = query.comments ? JSON.parse(`[${query.comments}]`) : [];

            res.json({
                success: true,
                data: query
            });
        });
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});

// ============= Get all queries by user_id ==================
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Step 1: Fetch all user queries with comment count
        const query = `
            SELECT q.*, 
                   COUNT(c.id) as comment_count
            FROM user_queries q
            LEFT JOIN query_comments c ON q.id = c.query_id
            WHERE q.user_id = ?
            GROUP BY q.id
            ORDER BY q.created_at DESC
        `;

        connection.query(query, [userId], (err, queries) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({
                    success: false,
                    message: "Error fetching user queries"
                });
            }

            // Step 2: If no queries, return early
            const queryIds = queries.map(q => q.id);
            if (queryIds.length === 0) {
                return res.json({
                    success: true,
                    data: []
                });
            }

            // Step 3: Fetch all comments for those queries
            const commentQuery = `
                SELECT * FROM query_comments 
                WHERE query_id IN (${queryIds.map(() => '?').join(',')})
                ORDER BY created_at ASC
            `;

            connection.query(commentQuery, queryIds, (commentErr, comments) => {
                if (commentErr) {
                    console.error('Comment fetch error:', commentErr);
                    return res.status(500).json({
                        success: false,
                        message: "Error fetching comments"
                    });
                }

                // Step 4: Group comments by query_id
                const commentMap = {};
                comments.forEach(c => {
                    if (!commentMap[c.query_id]) commentMap[c.query_id] = [];
                    commentMap[c.query_id].push(c);
                });

                // Step 5: Attach comments to corresponding queries
                const finalData = queries.map(q => ({
                    ...q,
                    comments: commentMap[q.id] || []
                }));

                res.json({
                    success: true,
                    data: finalData
                });
            });
        });
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
});



module.exports = router;