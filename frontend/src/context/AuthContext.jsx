import { createContext, useContext, useState, useEffect } from 'react';
import { getAuthMe, loginUser, logoutUser, registerUser } from '../services/api';

const AuthContext = createContext(null);

// Wipe any legacy persistent localStorage session to guarantee mandatory login entry
try {
  localStorage.removeItem('cm_user');
  localStorage.removeItem('cm_token');
} catch (e) {
  // Ignore in non-browser env
}

export function AuthProvider({ children }) {
  // Session is strictly scoped to the active browser tab/session
  const [user, setUser] = useState(() => {
    try {
      const stored = sessionStorage.getItem('cm_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem('cm_token') || null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  // When token exists in current session, verify it
  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }

    async function verifySession() {
      try {
        const res = await getAuthMe();
        if (res?.authenticated && res?.user) {
          setUser(res.user);
          sessionStorage.setItem('cm_user', JSON.stringify(res.user));
        } else {
          // Token expired or invalid
          setUser(null);
          setToken(null);
          sessionStorage.removeItem('cm_token');
          sessionStorage.removeItem('cm_user');
        }
      } catch (err) {
        console.warn('Session verification fallback:', err);
      }
    }
    verifySession();
  }, [token]);

  const login = async (email, password, roleRequested = 'analyst') => {
    const res = await loginUser({ email, password, role_requested: roleRequested });
    if (res?.token && res?.user) {
      setToken(res.token);
      setUser(res.user);
      sessionStorage.setItem('cm_token', res.token);
      sessionStorage.setItem('cm_user', JSON.stringify(res.user));
      return res.user;
    }
    throw new Error('Login failed: Token missing.');
  };

  const register = async (name, email, password, role = 'analyst') => {
    const res = await registerUser({ name, email, password, role });
    if (res?.token && res?.user) {
      setToken(res.token);
      setUser(res.user);
      sessionStorage.setItem('cm_token', res.token);
      sessionStorage.setItem('cm_user', JSON.stringify(res.user));
      return res.user;
    }
    throw new Error('Registration failed.');
  };

  const logout = async () => {
    try {
      await logoutUser();
    } catch (e) {
      // Ignore network errors on logout
    } finally {
      setUser(null);
      setToken(null);
      sessionStorage.removeItem('cm_token');
      sessionStorage.removeItem('cm_user');
      try {
        localStorage.removeItem('cm_token');
        localStorage.removeItem('cm_user');
      } catch {}
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
