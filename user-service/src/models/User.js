const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    authId: {
      type: String,
      required: [true, 'Auth ID is required'],
      unique: true,
      index: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long'],
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    fullName: {
      type: String,
      trim: true,
      maxlength: [100, 'Full name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email address',
      ],
    },
    phone: {
      type: String,
      trim: true,
      match: [/^[\d\s\+\-\(\)]+$/, 'Please provide a valid phone number'],
    },
    location: {
      type: String,
      trim: true,
      maxlength: [100, 'Location cannot exceed 100 characters'],
    },
    avatar: {
      type: String,
      trim: true,
      default: null,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return /^https?:\/\/.+/.test(v);
        },
        message: 'Avatar must be a valid URL',
      },
    },
    bio: {
      type: String,
      trim: true,
      maxlength: [500, 'Bio cannot exceed 500 characters'],
    },
    interests: {
      type: [String],
      default: [],
      validate: {
        validator: function (v) {
          return v.length <= 20;
        },
        message: 'Maximum 20 interests allowed',
      },
    },
    role: {
      type: String,
      enum: ['USER', 'VENDOR', 'ADMIN', 'MANAGER'],
      default: 'USER',
      uppercase: true,
    },
    profileIsComplete: {
      type: Boolean,
      default: false,
    },
    memberSince: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    department: {
      type: String,
      trim: true,
      default: null,
      enum: {
        values: [null, 'Public Event', 'Private Event', 'Core Operation'],
        message: 'Department must be one of: Public Event, Private Event, Core Operation',
      },
    },
    assignedRole: {
      type: String,
      trim: true,
      default: null,
      enum: {
        values: [null, 'Senior Event Manager', 'Junior Manager', 'Event Coordinator','Revenue Operations Specialist'],
        message: 'Assigned role must be one of: Senior Event Manager, Junior Manager, Event Coordinator, Revenue Operations Specialist',
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Clear manager-only fields if role is not MANAGER
userSchema.pre('save', function (next) {
  if (this.role !== 'MANAGER') {
    this.department = null;
    this.assignedRole = null;
  }
  next();
});

// Indexes for better query performance
userSchema.index({ email: 1, isActive: 1 });
userSchema.index({ role: 1 });
userSchema.index({ createdAt: -1 });

// Virtual for profile completion percentage
userSchema.virtual('profileCompletionPercentage').get(function () {
  const fields = ['name', 'fullName', 'phone', 'location', 'avatar', 'bio'];
  const completedFields = fields.filter((field) => this[field] && this[field].length > 0);
  const percentage = Math.round((completedFields.length / fields.length) * 100);
  return percentage;
});

// Method to check if profile is complete
userSchema.methods.updateProfileCompletion = function () {
  const requiredFields = ['name', 'fullName', 'phone', 'location'];
  const isComplete = requiredFields.every((field) => this[field] && this[field].length > 0);
  this.profileIsComplete = isComplete;
  return isComplete;
};

// Transform output
userSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);

module.exports = User;
