const express = require('express');
const router = express.Router();
const { extractUser } = require('../middleware/extractUser');
const { isAdmin } = require('../middleware/authorization');
const managerController = require('../controllers/managerController');
const ledgerController = require('../controllers/ledgerController');
const reportController = require('../controllers/reportController');
const dashboardController = require('../controllers/dashboardController');

// All routes require authentication
router.use(extractUser);

// POST /managers - Create a new manager (Admin only)
router.post('/managers', isAdmin, managerController.createManager);
router.get('/managers/options', isAdmin, managerController.getManagerRoleOptions);
router.get('/dashboard', isAdmin, dashboardController.getAdminDashboard);
router.get('/reports', isAdmin, reportController.getAdminReports);
router.get('/ledger', isAdmin, ledgerController.getAdminLedger);
router.get('/ledger/export/csv', isAdmin, ledgerController.exportAdminLedgerCsv);
router.get('/ledger/:transactionId', isAdmin, ledgerController.getAdminLedgerTransactionById);

module.exports = router;
