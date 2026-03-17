const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  documentId: {
    type: String,
    required: true,
  },
  documentType: {
    type: String,
    required: true,
    enum: ['businessLicense', 'ownerIdentity', 'otherProof'],
  },
  fileName: {
    type: String,
    required: true,
  },
  fileUrl: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['PENDING_VERIFICATION', 'VERIFIED', 'REJECTED'],
    default: 'PENDING_VERIFICATION',
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
  verifiedAt: {
    type: Date,
    default: null,
  },
  rejectionReason: {
    type: String,
    default: null,
  },
  description: {
    type: String,
    default: null,
  },
});

const imageSchema = new mongoose.Schema(
  {
    fileUrl: {
      type: String,
      trim: true,
      default: null,
    },
    publicId: {
      type: String,
      trim: true,
      default: null,
    },
    uploadedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const vendorApplicationSchema = new mongoose.Schema(
  {
    authId: {
      type: String,
      required: [true, 'Auth ID is required'],
      unique: true,
      index: true,
    },
    applicationId: {
      type: String,
      required: [true, 'Application ID is required'],
      unique: true,
      index: true,
    },
    businessName: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true,
      minlength: [2, 'Business name must be at least 2 characters'],
      maxlength: [100, 'Business name cannot exceed 100 characters'],
    },
    serviceCategory: {
      type: String,
      required: [true, 'Service category is required'],
      enum: [
        'Venue',
        'Catering & Drinks',
        'Photography',
        'Videography',
        'Decor & Styling',
        'Entertainment & Artists',
        'Makeup & Grooming',
        'Invitations & Printing',
        'Sound & Lighting',
        'Equipment Rental',
        'Security & Safety',
        'Transportation',
        'Live Streaming & Media',
        'Cake & Desserts',
        'Other',
      ],
    },
    images: {
      profile: {
        type: imageSchema,
        default: null,
      },
      banner: {
        type: imageSchema,
        default: null,
      },
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      index: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email address',
      ],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    location: {
      type: String,
      required: [true, 'Location is required'],
      trim: true,
      maxlength: [500, 'Location cannot exceed 500 characters'],
    },
    place: {
      type: String,
      trim: true,
      maxlength: [200, 'Place cannot exceed 200 characters'],
      default: null,
    },
    country: {
      type: String,
      trim: true,
      maxlength: [200, 'Country cannot exceed 200 characters'],
      default: null,
    },
    latitude: {
      type: Number,
      default: null,
    },
    longitude: {
      type: Number,
      default: null,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
      default: null,
    },
    documents: {
      businessLicense: {
        type: documentSchema,
        default: null,
      },
      ownerIdentity: {
        type: documentSchema,
        default: null,
      },
      otherProofs: {
        type: [documentSchema],
        default: [],
      },
    },
    status: {
      type: String,
      enum: [
        'PENDING_REVIEW',
        'DOCUMENTS_REQUESTED',
        'UNDER_VERIFICATION',
        'APPROVED',
        'REJECTED',
        'SUSPENDED',
      ],
      default: 'PENDING_REVIEW',
    },
    agreedToTerms: {
      type: Boolean,
      required: true,
      default: false,
    },
    reviewNotes: {
      type: String,
      default: null,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes for performance
vendorApplicationSchema.index({ email: 1 });
vendorApplicationSchema.index({ businessName: 1 });
vendorApplicationSchema.index({ status: 1 });
vendorApplicationSchema.index({ submittedAt: -1 });

// Update lastUpdatedAt before save
vendorApplicationSchema.pre('save', function (next) {
  this.lastUpdatedAt = new Date();
  next();
});

const VendorApplication = mongoose.model('VendorApplication', vendorApplicationSchema);

module.exports = VendorApplication;
