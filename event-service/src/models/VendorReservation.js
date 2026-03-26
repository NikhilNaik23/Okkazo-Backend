const mongoose = require('mongoose');

const VendorReservationSchema = new mongoose.Schema(
  {
    vendorAuthId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    // Original vendor owner (needed when reservation key is service-based).
    ownerVendorAuthId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    // For Venue reservations we lock a concrete service (location), not the whole vendor.
    serviceId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    // YYYY-MM-DD
    day: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'day must be in YYYY-MM-DD format'],
      index: true,
    },
    eventId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    authId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    // Optional: which service category reserved this vendor for this event
    service: {
      type: String,
      default: null,
      trim: true,
    },
    // Null means sticky reservation (paid/accepted/confirmed flow).
    // Non-null means temporary hold and will auto-expire.
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Reservation uniqueness key (vendor-level for most services, service-level for Venue).
VendorReservationSchema.index({ vendorAuthId: 1, day: 1 }, { unique: true });
// Expire temporary holds automatically. Null values are ignored by TTL.
VendorReservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const VendorReservation = mongoose.model('VendorReservation', VendorReservationSchema);

module.exports = VendorReservation;
