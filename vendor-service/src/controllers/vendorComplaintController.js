const vendorComplaintService = require('../services/vendorComplaintService');
const logger = require('../utils/logger');
const { formatErrorResponse, formatSuccessResponse } = require('../utils/helpers');

const getErrorCode = (statusCode) => {
  if (statusCode === 400) return 'VALIDATION_ERROR';
  if (statusCode === 401) return 'UNAUTHORIZED';
  if (statusCode === 403) return 'FORBIDDEN';
  if (statusCode === 404) return 'NOT_FOUND';
  return 'INTERNAL_ERROR';
};

const raiseComplaint = async (req, res) => {
  try {
    const complaint = await vendorComplaintService.createComplaint({
      authId: req.user?.authId,
      subject: req.body?.subject,
      content: req.body?.content,
      files: req.files || [],
    });

    return res.status(201).json(
      formatSuccessResponse(complaint, 'Complaint raised successfully')
    );
  } catch (error) {
    logger.error('Error in raiseComplaint:', error);
    const status = error.statusCode || 500;
    return res.status(status).json(formatErrorResponse(getErrorCode(status), error.message));
  }
};

const getMyComplaints = async (req, res) => {
  try {
    const result = await vendorComplaintService.getMyComplaints(req.user?.authId, req.query);
    return res.status(200).json(formatSuccessResponse(result));
  } catch (error) {
    logger.error('Error in getMyComplaints:', error);
    const status = error.statusCode || 500;
    return res.status(status).json(formatErrorResponse(getErrorCode(status), error.message));
  }
};

const getAllComplaints = async (req, res) => {
  try {
    const result = await vendorComplaintService.getAllComplaints(req.query);
    return res.status(200).json(formatSuccessResponse(result));
  } catch (error) {
    logger.error('Error in getAllComplaints:', error);
    const status = error.statusCode || 500;
    return res.status(status).json(formatErrorResponse(getErrorCode(status), error.message));
  }
};

const closeComplaint = async (req, res) => {
  try {
    const complaint = await vendorComplaintService.closeComplaint({
      complaintId: req.params?.complaintId,
      closedBy: req.user?.email || req.user?.authId || 'ADMIN',
    });

    return res.status(200).json(
      formatSuccessResponse(complaint, 'Complaint closed successfully')
    );
  } catch (error) {
    logger.error('Error in closeComplaint:', error);
    const status = error.statusCode || 500;
    return res.status(status).json(formatErrorResponse(getErrorCode(status), error.message));
  }
};

module.exports = {
  raiseComplaint,
  getMyComplaints,
  getAllComplaints,
  closeComplaint,
};
