import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';
import { EyeIcon } from '../components/EyeIcon.js';

export function LoginPage() {
  const { isAuthenticated, isAuthenticating, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  if (isAuthenticated) {
    const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Login failed');
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card panel">
        <h1>Sycamore</h1>
        <p className="subtitle">Transaction Intelligence Platform</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="micro-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="micro-label" htmlFor="password">
              Password
            </label>
            <div className="input-with-action">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                className="input-action-button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>
          {formError && <p className="form-error">{formError}</p>}
          <button type="submit" className="primary" disabled={isAuthenticating} style={{ width: '100%' }}>
            {isAuthenticating ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
