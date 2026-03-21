import { useEffect, useState } from 'react';
import client from '../api/client';

/**
 * useUserRole Hook
 * Provides current user info and role checking
 */
export function useUserRole() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await client.get('/auth/me');
        if (res.success && res.payload) {
          setCurrentUser(res.payload);
        }
      } catch (err) {
        console.error('Failed to fetch current user:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, []);

  const isAdmin = currentUser?.role === 'admin';
  const isUser = !!currentUser;

  return {
    currentUser,
    isAdmin,
    isUser,
    loading,
    canManageUsers: isAdmin,
    canManageSettings: isAdmin,
    canAccessAnalytics: isUser
  };
}

export default useUserRole;
