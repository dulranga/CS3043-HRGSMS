import { Request, Response } from 'express';

export const getRooms = (req: Request, res: Response) => {
  res.json({ message: 'Rooms endpoint' });
};
