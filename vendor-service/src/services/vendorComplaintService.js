const { v4: uuidv4 } = require('uuid');
const VendorApplication = require('../models/VendorApplication');
const VendorComplaint = require('../models/VendorComplaint');
const ApiError = require('../utils/ApiError');
const fileUploadService = require('./fileUploadService');
const { publishVendorEvent } = require('../kafka/vendorEventProducer');
const logger = require('../utils/logger');

const MAX_COMPLAINT_IMAGES = 5;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/jpg'];

const sanitizeText = (value) => String(value || '').trim();

const toComplaintResponse = (complaint) => {
  if (!complaint) return null;
  const obj = typeof complaint.toObject === 'function' ? complaint.toObject() : complaint;
  return {
    complaintId: obj.complaintId,
    vendorAuthId: obj.vendorAuthId,
    vendorApplicationId: obj.vendorApplicationId,
    vendorName: obj.vendorName,
    vendorEmail: obj.vendorEmail,
    subject: obj.subject,
    content: obj.content,
    images: Array.isArray(obj.images) ? obj.images : [],
    status: obj.status,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    closedAt: obj.closedAt,
    closedBy: obj.closedBy,
  };
};

const validateComplaintInput = ({ subject, content }) => {
  const safeSubject = sanitizeText(subject);
  const safeContent = sanitizeText(content);

  if (safeSubject.length < 3) {
    throw new ApiError(400, 'Subject must be at least 3 characters');
  }

  if (safeSubject.length > 180) {
    throw new ApiError(400, 'Subject cannot exceed 180 characters');
  }

  if (safeContent.length < 10) {
    throw new ApiError(400, 'Content must be at least 10 characters');
  }

  if (safeContent.length > 5000) {
    throw new ApiError(400, 'Content cannot exceed 5000 characters');
  }

  return { subject: safeSubject, content: safeContent };
};

const validateImages = (files = []) => {
  if (!Array.isArray(files)) return [];
  if (files.length > MAX_COMPLAINT_IMAGES) {
    throw new ApiError(400, `Maximum ${MAX_COMPLAINT_IMAGES} images are allowed`);
  }

  const invalid = files.find((file) => !ALLOWED_IMAGE_TYPES.includes(file.mimetype));
  if (invalid) {
    throw new ApiError(400, 'Only JPEG and PNG images are allowed');
  }

  return files;
};

const createComplaint = async ({ authId, subject, content, files = [] }) => {
  const safeAuthId = sanitizeText(authId);
  if (!safeAuthId) {
    throw new ApiError(401, 'User not authenticated');
  }

  const validated = validateComplaintInput({ subject, content });
  const imageFiles = validateImages(files);
  const application = await VendorApplication.findOne({ authId: safeAuthId });

  if (!application) {
    throw new ApiError(404, 'No vendor application found for your account');
  }

  const complaintId = `cmp-${uuidv4()}`;
  const uploadedImages = [];

  for (const file of imageFiles) {
    const uploadResult = await fileUploadService.uploadFile(
      file,
      `${application.applicationId}/complaints/${complaintId}`
    );
    uploadedImages.push({
      fileUrl: uploadResult.url,
      publicId: uploadResult.publicId,
      uploadedAt: new Date(),
    });
  }

  const complaint = await VendorComplaint.create({
    complaintId,
    vendorAuthId: safeAuthId,
    vendorApplicationId: application.applicationId,
    vendorName: application.businessName,
    vendorEmail: application.email,
    subject: validated.subject,
    content: validated.content,
    images: uploadedImages,
    status: 'open',
  });

  await publishVendorEvent(
    'VENDOR_COMPLAINT_RAISED',
    {
      complaintId,
      vendorAuthId: safeAuthId,
      vendorName: application.businessName,
      vendorEmail: application.email,
      subject: validated.subject,
      status: 'open',
      createdAt: complaint.createdAt,
    },
    complaintId
  );

  logger.info('Vendor complaint created', {
    complaintId,
    vendorAuthId: safeAuthId,
  });

  return toComplaintResponse(complaint);
};

const getMyComplaints = async (authId, filters = {}) => {
  const safeAuthId = sanitizeText(authId);
  if (!safeAuthId) {
    throw new ApiError(401, 'User not authenticated');
  }

  const limit = Math.min(Math.max(parseInt(filters.limit || 50, 10), 1), 100);
  const skip = Math.max(parseInt(filters.skip || 0, 10), 0);
  const query = { vendorAuthId: safeAuthId };

  if (filters.status && ['open', 'closed'].includes(String(filters.status).toLowerCase())) {
    query.status = String(filters.status).toLowerCase();
  }

  const [complaints, total] = await Promise.all([
    VendorComplaint.find(query).sort({ createdAt: -1 }).limit(limit).skip(skip),
    VendorComplaint.countDocuments(query),
  ]);

  return {
    complaints: complaints.map(toComplaintResponse),
    total,
    limit,
    skip,
  };
};

const getAllComplaints = async (filters = {}) => {
  const limit = Math.min(Math.max(parseInt(filters.limit || 100, 10), 1), 200);
  const skip = Math.max(parseInt(filters.skip || 0, 10), 0);
  const query = {};

  if (filters.status && ['open', 'closed'].includes(String(filters.status).toLowerCase())) {
    query.status = String(filters.status).toLowerCase();
  }

  const search = sanitizeText(filters.search);
  if (search) {
    query.$or = [
      { subject: { $regex: search, $options: 'i' } },
      { content: { $regex: search, $options: 'i' } },
      { vendorName: { $regex: search, $options: 'i' } },
      { vendorEmail: { $regex: search, $options: 'i' } },
    ];
  }

  const [complaints, total] = await Promise.all([
    VendorComplaint.find(query).sort({ status: -1, createdAt: -1 }).limit(limit).skip(skip),
    VendorComplaint.countDocuments(query),
  ]);

  return {
    complaints: complaints.map(toComplaintResponse),
    total,
    limit,
    skip,
  };
};

const closeComplaint = async ({ complaintId, closedBy }) => {
  const safeComplaintId = sanitizeText(complaintId);
  if (!safeComplaintId) {
    throw new ApiError(400, 'Complaint ID is required');
  }

  const complaint = await VendorComplaint.findOne({ complaintId: safeComplaintId });
  if (!complaint) {
    throw new ApiError(404, 'Complaint not found');
  }

  if (complaint.status === 'closed') {
    return toComplaintResponse(complaint);
  }

  complaint.status = 'closed';
  complaint.closedAt = new Date();
  complaint.closedBy = sanitizeText(closedBy) || 'ADMIN';
  await complaint.save();

  await publishVendorEvent(
    'VENDOR_COMPLAINT_CLOSED',
    {
      complaintId: complaint.complaintId,
      vendorAuthId: complaint.vendorAuthId,
      vendorName: complaint.vendorName,
      subject: complaint.subject,
      status: 'closed',
      closedAt: complaint.closedAt,
      closedBy: complaint.closedBy,
    },
    complaint.complaintId
  );

  logger.info('Vendor complaint closed', {
    complaintId: complaint.complaintId,
    closedBy: complaint.closedBy,
  });

  return toComplaintResponse(complaint);
};

module.exports = {
  createComplaint,
  getMyComplaints,
  getAllComplaints,
  closeComplaint,
};
