/**
 * How long an unused account is kept. These numbers are published on the
 * Privacy page and enforced by src/lib/server/retention.ts, so they live in
 * one place and are not settings: changing them is changing a promise.
 *
 * Face and voice data may not be kept indefinitely. Illinois' biometric law,
 * the strictest widely applicable one, sets the limit at three years after a
 * person's last interaction; this schedule stays well inside it.
 */
export const RETENTION = {
  /** An account with no paid plan that nobody has signed in to for this long is deleted. */
  inactiveMonths: 24,
  /** How long before deleting the person is told by email. */
  warningDays: 30,
};
