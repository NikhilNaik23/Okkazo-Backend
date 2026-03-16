/**
 * Date rules for event planning
 *
 * planningMinimumDate   – Earliest allowed event date (today + 6 days)
 * isWithinUrgentWindow  – true when the event falls within 14 days
 * startOfTomorrow       – Midnight of the next calendar day (for ticket availability)
 */

const MINIMUM_DAYS_AHEAD = 6;
const URGENT_WINDOW_DAYS = 14;

/**
 * Returns the minimum allowed planning date (today + 6 days, start of day)
 */
const planningMinimumDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + MINIMUM_DAYS_AHEAD);
  date.setHours(0, 0, 0, 0);
  return date;
};

/**
 * Returns true when the given date is within the urgent window (14 days from now)
 */
const isWithinUrgentWindow = (eventDate) => {
  if (!eventDate) return false;
  const now = new Date();
  const deadline = new Date();
  deadline.setDate(now.getDate() + URGENT_WINDOW_DAYS);
  return new Date(eventDate) <= deadline;
};

/**
 * Returns tomorrow at 00:00:00.000
 */
const startOfTomorrow = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date;
};

module.exports = {
  planningMinimumDate,
  isWithinUrgentWindow,
  startOfTomorrow,
  MINIMUM_DAYS_AHEAD,
  URGENT_WINDOW_DAYS,
};
