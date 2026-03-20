const express = require('express');
const staffController = require('../controllers/staffController');
const { isAdminOrManager } = require('../middleware/authorization');

const router = express.Router();

// GET /staff/core/available - list available core operation staff (Manager/Admin)
router.get('/staff/core/available', isAdminOrManager, staffController.getAvailableCoreStaff);

module.exports = router;
