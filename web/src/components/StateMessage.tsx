import type { ReactNode } from 'react';

interface StateMessageProps {
  children: ReactNode;
  tone?: 'default' | 'error';
}

export function StateMessage({ children, tone = 'default' }: StateMessageProps) {
  return <div className={`state-message ${tone === 'error' ? 'error' : ''}`.trim()}>{children}</div>;
}
