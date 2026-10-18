import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getAuthMe, loginUser, logoutUser, registerUser, clearStoredAuth, getStoredToken } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = sessionStorage.getItem('cm_user') || localStorage.getItem('cm_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(() => getStoredToken());
  const [loading, setLoading] = useState(false);

  // Global listener for 401 Unauthorized events from api.js
  const handleUnauthorized = useCallback(() => {
    setUser(null);
    setToken(null);
    clearStoredAuth();
  }, []);

  useEffect(() => {
    window.addEventListener('cm_auth_unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('cm_auth_unauthorized', handleUnauthorized);
    };
  }, [handleUnauthorized]);

  // Session verification on mount/token change
  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }

    let isMounted = true;
    async function verifySession() {
      try {
        const res = await getAuthMe();
        if (isMounted) {
          if (res?.authenticated && res?.user) {
            setUser(res.user);
            sessionStorage.setItem('cm_user', JSON.stringify(res.user));
          } else {
            handleUnauthorized();
          }
        }
      } catch {
        // If server is unreachable, retain cached session for offline resilience
      }
    }
    verifySession();

    return () => {
      isMounted = false;
    };
  }, [token, handleUnauthorized]);

  const login = async (email, password, roleRequested = 'analyst') => {
    setLoading(true);
    try {
      const res = await loginUser({ email, password, role_requested: roleRequested });
      const authToken = res?.access_token || res?.token;
      if (authToken && res?.user) {
        setToken(authToken);
        setUser(res.user);
        sessionStorage.setItem('cm_token', authToken);
        sessionStorage.setItem('cm_user', JSON.stringify(res.user));
        if (res.refresh_token) {
          sessionStorage.setItem('cm_refresh_token', res.refresh_token);
        }
        return res.user;
      }
      throw new Error('Authentication failed: Missing access token in handshake.');
    } finally {
      setLoading(false);
    }
  };

  const register = async (name, email, password, role = 'analyst') => {
    setLoading(true);
    try {
      const res = await registerUser({ name, email, password, role });
      const authToken = res?.access_token || res?.token;
      if (authToken && res?.user) {
        setToken(authToken);
        setUser(res.user);
        sessionStorage.setItem('cm_token', authToken);
        sessionStorage.setItem('cm_user', JSON.stringify(res.user));
        if (res.refresh_token) {
          sessionStorage.setItem('cm_refresh_token', res.refresh_token);
        }
        return res.user;
      }
      throw new Error('Registration failed: Verification payload incomplete.');
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await logoutUser();
    } catch {
      // Ignore network errors on logout
    } finally {
      setUser(null);
      setToken(null);
      clearStoredAuth();
    }
  };

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, token, isAdmin, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
