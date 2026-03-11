const express = require('express');
const router = express.Router();
const { extractUser } = require('../middleware/extractUser');
const { isAdmin } = require('../middleware/authorization');
const managerController = require('../controllers/managerController');

// All routes require authentication
router.use(extractUser);

// POST /managers - Create a new manager (Admin only)
router.post('/managers', isAdmin, managerController.createManager);

module.exports = router;
