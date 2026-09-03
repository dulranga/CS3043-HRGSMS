import express from 'express';
import { getRooms } from '../controllers/roomController';

const router = express.Router();

router.get('/', getRooms);

export default router;
