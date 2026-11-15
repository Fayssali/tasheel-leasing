import type { OrganizationStatus } from '@tasheel/shared';
import { useTranslation } from 'react-i18next';
import { Badge } from './ui';

const TONE: Record<OrganizationStatus, 'info' | 'action' | 'success' | 'danger' | 'neutral'> = {
  PENDING_VERIFICATION: 'action',
  VERIFIED: 'success',
  SUSPENDED: 'danger',
  REJECTED: 'danger',
};

export function OrgStatusBadge({ status }: { status: OrganizationStatus }) {
  const { t } = useTranslation();
  return <Badge tone={TONE[status]}>{t(`status.${status}`)}</Badge>;
}
