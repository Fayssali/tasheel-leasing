import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, NavLink } from 'react-router';
import { Alert, Button, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate, useErrorMessage } from '../../lib/format';

export interface AppNotification {
  id: string;
  key: string;
  vars: Record<string, string | number>;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationList {
  items: AppNotification[];
  unread: number;
}

const useNotifications = () =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationList>('/notifications'),
    refetchInterval: 60_000,
  });

/** Notification text from the email strings: the subject without the brand suffix, and the body. */
export function useNotificationText() {
  const { t } = useTranslation();
  return (n: AppNotification) => ({
    title: t(`${n.key}.subject`, n.vars).replace(/\s+—\s+[^—]+$/, ''),
    body: t(`${n.key}.body`, { ...n.vars, name: '' }),
  });
}

/** Sidebar entry with the unread count. */
export function NotificationsNavItem({ to, onNavigate }: { to: string; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const list = useNotifications();
  const unread = list.data?.unread ?? 0;
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center justify-between rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-white/15 font-semibold' : 'text-white/80 hover:bg-white/10'}`
      }
    >
      <span>{t('notifications.title')}</span>
      {unread > 0 && (
        <span
          className="rounded-full bg-accent-500 px-2 text-xs font-semibold text-primary-900"
          aria-label={t('notifications.unread', { count: unread })}
        >
          {unread}
        </span>
      )}
    </NavLink>
  );
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const list = useNotifications();
  const text = useNotificationText();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const readOne = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const readAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: refresh,
  });

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        actions={
          (list.data?.unread ?? 0) > 0 ? (
            <Button
              variant="secondary"
              loading={readAll.isPending}
              onClick={() => readAll.mutate()}
            >
              {t('notifications.markAllRead')}
            </Button>
          ) : undefined
        }
      />
      {list.isLoading ? (
        <Spinner />
      ) : list.isError ? (
        <Alert tone="danger">{errorMessage(list.error)}</Alert>
      ) : !list.data?.items.length ? (
        <EmptyState>{t('notifications.empty')}</EmptyState>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {list.data.items.map((n) => {
            const { title, body } = text(n);
            return (
              <li
                key={n.id}
                className={`flex flex-wrap items-start justify-between gap-3 p-4 ${n.readAt ? '' : 'bg-primary-50/60'}`}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm ${n.readAt ? 'text-gray-700' : 'font-semibold text-gray-900'}`}
                  >
                    {!n.readAt && (
                      <span
                        className="me-2 inline-block h-2 w-2 rounded-full bg-primary-600"
                        aria-label={t('notifications.new')}
                      />
                    )}
                    {title}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">{body}</p>
                  <p className="mt-1 text-xs text-gray-500">{formatDate(n.createdAt, true)}</p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {n.link && (
                    <Link
                      to={n.link}
                      className="font-semibold text-primary-600 hover:underline"
                      onClick={() => !n.readAt && readOne.mutate(n.id)}
                    >
                      {t('common.open')}
                    </Link>
                  )}
                  {!n.readAt && (
                    <button
                      className="text-gray-500 hover:underline"
                      onClick={() => readOne.mutate(n.id)}
                    >
                      {t('notifications.markRead')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
