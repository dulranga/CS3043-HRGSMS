import { Router } from 'express';
import { searchAvailabilityHandler } from '../controllers/availabilityController';

const availabilityRoutes = Router();

// Availability contains public hotel inventory and catalogue prices only.
// Authentication is required later when a guest or staff member confirms a booking.
availabilityRoutes.get('/availability', searchAvailabilityHandler);

export default availabilityRoutes;
