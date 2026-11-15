import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui';
import { formatDate } from '../../lib/format';
import type {
  ApplicationStatus,
  OfferStatus,
  SubmissionStatus,
  TimelineEvent,
} from '../../lib/types';

type Tone = 'neutral' | 'action' | 'success' | 'danger' | 'info';

const APP_TONE: Record<ApplicationStatus, Tone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  OFFER_ACCEPTED: 'success',
  WITHDRAWN: 'neutral',
  CLOSED: 'neutral',
};
const SUB_TONE: Record<SubmissionStatus, Tone> = {
  SENT: 'info',
  UNDER_REVIEW: 'info',
  INFO_REQUESTED: 'action',
  OFFER_MADE: 'success',
  DECLINED: 'danger',
  WITHDRAWN: 'neutral',
  CLOSED: 'neutral',
};
const OFFER_TONE: Record<OfferStatus, Tone> = {
  ISSUED: 'info',
  ACCEPTED: 'success',
  DECLINED: 'neutral',
  EXPIRED: 'neutral',
  WITHDRAWN: 'neutral',
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const { t } = useTranslation();
  return <Badge tone={APP_TONE[status]}>{t(`applicationStatus.${status}`)}</Badge>;
}

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const { t } = useTranslation();
  return <Badge tone={SUB_TONE[status]}>{t(`submissionStatus.${status}`)}</Badge>;
}

export function OfferStatusBadge({ status }: { status: OfferStatus }) {
  const { t } = useTranslation();
  return <Badge tone={OFFER_TONE[status]}>{t(`offerStatus.${status}`)}</Badge>;
}

/** Shared timeline: entries written by the viewer's organization are marked as such. */
export function Timeline({ events, ownOrg }: { events: TimelineEvent[]; ownOrg?: string }) {
  const { t } = useTranslation();
  if (!events.length) return null;
  return (
    <ol className="space-y-2 border-s-2 border-gray-200 ps-4 text-sm">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary-600" />
          <p>
            <span className="font-semibold">{t(`timeline.${e.kind}`)}</span>{' '}
            <span className="text-xs text-gray-500">
              {formatDate(e.createdAt, true)} ·{' '}
              {e.organizationId === ownOrg ? t('timeline.you') : t('timeline.them')}
            </span>
          </p>
          {e.note && (
            <p className="whitespace-pre-line text-gray-600" dir="auto">
              {e.note}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
