/**
 * Each Wanderlog trip has a unique email address that, when emails
 * are forwarded to it, Wanderlog parses and attaches the reservation
 * (flight, hotel, rental car, etc.) to the trip itself:
 *
 * https://help.wanderlog.com/hc/en-us/articles/4625693334811
 *
 */

export function tripForwardingEmail(tripId: number): string {
  return `trip+${tripId}@wanderlog.com`;
}
