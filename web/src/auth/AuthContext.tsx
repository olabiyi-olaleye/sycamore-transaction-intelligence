import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { login as loginRequest } from '../api/endpoints.js';
import type { AuthUser } from '../api/types.js';

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem('sycamore_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(readStoredUser);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleUnauthorized() {
      setUser(null);
    }
    window.addEventListener('sycamore:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('sycamore:unauthorized', handleUnauthorized);
  }, []);

  async function login(email: string, password: string): Promise<void> {
    setIsAuthenticating(true);
    setError(null);
    try {
      const result = await loginRequest(email, password);
      localStorage.setItem('sycamore_token', result.token);
      localStorage.setItem('sycamore_user', JSON.stringify(result.user));
      setUser(result.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  }

  function logout(): void {
    localStorage.removeItem('sycamore_token');
    localStorage.removeItem('sycamore_user');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: user !== null, isAuthenticating, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
