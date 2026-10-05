import { Request } from 'express';
import { ActorContext } from '../services/invoiceService';

// Only Member 1's verified session middleware may supply req.user. Request
// headers, query parameters and body fields are never proof of identity.
export function member3Actor(req: Request): ActorContext {
  const user = (req as Request & { user?: ActorContext }).user;
  return { userId: typeof user?.userId === 'string' ? user.userId : '' };
}
