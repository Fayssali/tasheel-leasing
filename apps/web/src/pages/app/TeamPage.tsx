import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  SelectInput,
  Spinner,
  Table,
  Td,
  TextInput,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, useErrorMessage, useLocalizedName } from '../../lib/format';
import type { AssignableRole, Invitation, Member, OrganizationProfile } from '../../lib/types';

export function TeamPage() {
  const { t } = useTranslation();
  const { me, activeOrg } = useAuth();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const localized = useLocalizedName();
  const orgKey = activeOrg?.organizationId;

  const org = useQuery({
    queryKey: ['org', orgKey],
    queryFn: () => api<OrganizationProfile>('/organizations/current', { org: true }),
  });
  const members = useQuery({
    queryKey: ['members', orgKey],
    queryFn: () => api<Member[]>('/organizations/current/members', { org: true }),
  });
  const roles = useQuery({
    queryKey: ['roles', orgKey],
    queryFn: () => api<AssignableRole[]>('/organizations/current/roles', { org: true }),
  });
  const invitations = useQuery({
    queryKey: ['invitations', orgKey],
    queryFn: () => api<Invitation[]>('/organizations/current/invitations', { org: true }),
  });

  const perms = new Set(org.data?.permissions ?? []);
  const canInvite = perms.has('member.invite');
  const canManage = perms.has('member.manage');
  const grantable = (roles.data ?? []).filter((r) => r.assignableByYou);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all(
      ['members', 'invitations'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    );

  const invite = useMutation({
    mutationFn: () =>
      api('/organizations/current/invitations', {
        method: 'POST',
        org: true,
        body: { email: inviteEmail, roleCode: inviteRole || grantable[grantable.length - 1]?.code },
      }),
    onSuccess: async () => {
      setInviteOpen(false);
      setInviteEmail('');
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/organizations/current/invitations/${id}`, { method: 'DELETE', org: true }),
    onSuccess: refresh,
    onError: (err) => setActionError(errorMessage(err)),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { roleCode?: string; status?: string } }) =>
      api(`/organizations/current/members/${id}`, { method: 'PATCH', org: true, body }),
    onSuccess: refresh,
    onError: (err) => setActionError(errorMessage(err)),
  });

  function submitInvite(e: FormEvent) {
    e.preventDefault();
    invite.mutate();
  }

  if (members.isLoading || org.isLoading) return <Spinner />;
  if (members.isError) return <Alert tone="danger">{errorMessage(members.error)}</Alert>;

  return (
    <>
      <PageHeader
        title={t('team.title')}
        subtitle={t('team.subtitle')}
        actions={
          canInvite && (
            <Button variant="accent" onClick={() => setInviteOpen(true)}>
              {t('team.invite')}
            </Button>
          )
        }
      />
      {actionError && (
        <div className="mb-4">
          <Alert
            tone="danger"
            action={
              <Button variant="ghost" onClick={() => setActionError(null)}>
                {t('common.close')}
              </Button>
            }
          >
            {actionError}
          </Alert>
        </div>
      )}

      <Card title={t('team.members')} className="mb-6">
        <Table
          head={[
            t('fields.name'),
            t('fields.email'),
            t('fields.role'),
            t('fields.status'),
            t('team.mfa'),
            '',
          ]}
        >
          {(members.data ?? []).map((m) => {
            const isSelf = m.user.id === me?.user.id;
            const roleCode = m.roles[0]?.role.code ?? '';
            return (
              <tr key={m.id}>
                <Td>
                  {m.user.firstName} {m.user.lastName}
                  {isSelf && <span className="ms-2 text-xs text-gray-500">({t('team.you')})</span>}
                </Td>
                <Td>
                  <span dir="ltr">{m.user.email}</span>
                </Td>
                <Td>
                  {canManage && !isSelf ? (
                    <select
                      aria-label={t('fields.role')}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                      value={roleCode}
                      onChange={(e) =>
                        update.mutate({ id: m.id, body: { roleCode: e.target.value } })
                      }
                    >
                      {(roles.data ?? []).map((r) => (
                        <option key={r.code} value={r.code} disabled={!r.assignableByYou}>
                          {localized(r.name)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    m.roles.map((r) => localized(r.role.name)).join(', ')
                  )}
                </Td>
                <Td>
                  <Badge tone={m.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {t(`memberStatus.${m.status}`)}
                  </Badge>
                </Td>
                <Td>
                  {m.user.mfaEnabled ? (
                    <Badge tone="success">{t('common.yes')}</Badge>
                  ) : (
                    <Badge tone="neutral">{t('common.no')}</Badge>
                  )}
                </Td>
                <Td className="text-end">
                  {canManage && !isSelf && (
                    <Button
                      variant={m.status === 'ACTIVE' ? 'secondary' : 'ghost'}
                      onClick={() =>
                        update.mutate({
                          id: m.id,
                          body: { status: m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' },
                        })
                      }
                    >
                      {m.status === 'ACTIVE' ? t('team.disable') : t('team.enable')}
                    </Button>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title={t('team.pendingInvitations')}>
        {(invitations.data ?? []).length === 0 ? (
          <EmptyState>{t('team.noInvitations')}</EmptyState>
        ) : (
          <Table head={[t('fields.email'), t('fields.role'), t('team.expires'), '']}>
            {(invitations.data ?? []).map((inv) => (
              <tr key={inv.id}>
                <Td>
                  <span dir="ltr">{inv.email}</span>
                </Td>
                <Td>{localized(inv.role.name)}</Td>
                <Td>{formatDate(inv.expiresAt)}</Td>
                <Td className="text-end">
                  {canInvite && (
                    <Button variant="ghost" onClick={() => revoke.mutate(inv.id)}>
                      {t('team.revoke')}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal
        open={inviteOpen}
        title={t('team.inviteTitle')}
        onClose={() => setInviteOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="invite-form" loading={invite.isPending}>
              {t('team.sendInvitation')}
            </Button>
          </>
        }
      >
        <form id="invite-form" onSubmit={submitInvite} className="space-y-4">
          {invite.isError && <Alert tone="danger">{errorMessage(invite.error)}</Alert>}
          <TextInput
            label={t('fields.email')}
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            dir="ltr"
          />
          <SelectInput
            label={t('fields.role')}
            value={inviteRole || grantable[grantable.length - 1]?.code || ''}
            onChange={(e) => setInviteRole(e.target.value)}
            options={grantable.map((r) => ({ value: r.code, label: localized(r.name) }))}
          />
          <p className="text-xs text-gray-500">{t('team.inviteHint')}</p>
        </form>
      </Modal>
    </>
  );
}
