const { body, param, query, validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation failed', { errors: errors.array() });
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((err) => ({
        field: err.path,
        message: err.msg,
      })),
    });
  }
  next();
};

/**
 * Validation rules for user creation
 */
const validateUser = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Must be a valid email address')
    .normalizeEmail(),

  body('fullName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Full name cannot exceed 100 characters'),

  body('phone')
    .optional()
    .trim()
    .matches(/^[\d\s\+\-\(\)]+$/)
    .withMessage('Invalid phone number format'),

  body('location')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Location cannot exceed 100 characters'),

  body('avatar')
    .optional()
    .trim()
    .isURL()
    .withMessage('Avatar must be a valid URL'),

  body('bio')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Bio cannot exceed 500 characters'),

  body('interests')
    .optional()
    .isArray({ max: 20 })
    .withMessage('Interests must be an array with maximum 20 items'),

  handleValidationErrors,
];

/**
 * Validation rules for user update
 */
const validateUserUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),

  body('fullName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Full name cannot exceed 100 characters'),

  body('phone')
    .optional()
    .trim()
    .matches(/^[\d\s\+\-\(\)]+$/)
    .withMessage('Invalid phone number format'),

  body('location')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Location cannot exceed 100 characters'),

  body('avatar')
    .optional()
    .trim()
    .isURL()
    .withMessage('Avatar must be a valid URL'),

  body('bio')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Bio cannot exceed 500 characters'),

  body('interests')
    .optional()
    .isArray({ max: 20 })
    .withMessage('Interests must be an array with maximum 20 items'),

  body('department')
    .optional()
    .trim()
    .isIn(['Public Event', 'Private Event', 'Core Operation'])
    .withMessage('Department must be one of: Public Event, Private Event, Core Operation'),

  body('assignedRole')
    .optional()
    .trim()
    .isIn(['Senior Event Manager', 'Junior Manager', 'Event Coordinator'])
    .withMessage('Assigned role must be one of: Senior Event Manager, Junior Manager, Event Coordinator'),

  // Prevent updating protected fields
  body('authId').not().exists().withMessage('Cannot update authId'),
  body('role').not().exists().withMessage('Cannot update role'),
  body('memberSince').not().exists().withMessage('Cannot update memberSince'),

  handleValidationErrors,
];

/**
 * Validation rules for pagination
 */
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  handleValidationErrors,
];

/**
 * Validation rules for MongoDB ID
 */
const validateMongoId = [
  param('id')
    .isMongoId()
    .withMessage('Invalid user ID format'),

  handleValidationErrors,
];

module.exports = {
  validateUser,
  validateUserUpdate,
  validatePagination,
  validateMongoId,
  handleValidationErrors,
};
