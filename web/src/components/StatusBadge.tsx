interface StatusBadgeProps {
  status: string;
  label?: string;
}

const LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  classified: 'Classified',
  failed: 'Failed',
  none: 'None',
  open: 'Open',
  resolved: 'Resolved',
  credit: 'Credit',
  debit: 'Debit',
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return <span className={`badge badge--${status}`}>{label ?? LABELS[status] ?? status}</span>;
}
