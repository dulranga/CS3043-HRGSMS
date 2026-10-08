import { useMemo } from 'react';
import { useAuth } from './AuthProvider';
import { guestFeatureSession, roomFeatureSession, staffFeatureSession, verifiedStaffRole } from '@/lib/featureSessions';

export function useFeatureSessions() {
  const { status, user } = useAuth();
  return useMemo(() => {
    const verifiedUser = status === 'authenticated' ? user : null;
    return {
      staff: staffFeatureSession(verifiedUser),
      roomAdmin: roomFeatureSession(verifiedUser),
      guest: guestFeatureSession(verifiedUser),
      role: verifiedStaffRole(verifiedUser),
    };
  }, [status, user]);
}
