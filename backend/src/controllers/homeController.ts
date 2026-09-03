import { Request, Response } from 'express';

export const getStatus = (req: Request, res: Response) => {
  res.json({ message: 'Hotel API running', status: 'ok' });
};
