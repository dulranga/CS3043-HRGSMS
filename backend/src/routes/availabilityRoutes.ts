import { Router } from 'express';
import { availabilityOptionsHandler, searchAvailabilityHandler } from '../controllers/availabilityController';

const availabilityRoutes = Router();

// Availability contains public hotel inventory and catalogue prices only.
// Authentication is required later when a guest or staff member confirms a booking.
availabilityRoutes.get('/availability', searchAvailabilityHandler);
availabilityRoutes.get('/availability/options', availabilityOptionsHandler);

export default availabilityRoutes;
