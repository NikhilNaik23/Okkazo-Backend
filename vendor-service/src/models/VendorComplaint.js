const mongoose = require('mongoose');

const complaintImageSchema = new mongoose.Schema(
  {
    fileUrl: {
      type: String,
      required: true,
      trim: true,
    },
    publicId: {
      type: String,
      required: true,
      trim: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const vendorComplaintSchema = new mongoose.Schema(
  {
    complaintId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    vendorAuthId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    vendorApplicationId: {
      type: String,
      default: null,
      trim: true,
    },
    vendorName: {
      type: String,
      required: true,
      trim: true,
    },
    vendorEmail: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 180,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 5000,
    },
    images: {
      type: [complaintImageSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['open', 'closed'],
      default: 'open',
      index: true,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    closedBy: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

vendorComplaintSchema.index({ createdAt: -1 });
vendorComplaintSchema.index({ vendorAuthId: 1, createdAt: -1 });
vendorComplaintSchema.index({ status: 1, createdAt: -1 });

const VendorComplaint = mongoose.model('VendorComplaint', vendorComplaintSchema);

module.exports = VendorComplaint;
