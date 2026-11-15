import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  getActiveOrg,
  refreshSession,
  setAccessToken,
  setActiveOrg,
  setSessionLostHandler,
} from './api';
import type { Me, Membership, MfaChallenge, TokenResponse } from './types';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthState {
  status: Status;
  me: Me | null;
  activeOrg: Membership | null;
  /** Returns an MFA challenge when a second step is needed. */
  login(email: string, password: string): Promise<MfaChallenge | null>;
  verifyMfa(mfaToken: string, code: string): Promise<void>;
  /** Stores tokens obtained elsewhere (registration, invitation acceptance). */
  adoptTokens(tokens: TokenResponse): Promise<void>;
  logout(): Promise<void>;
  reloadMe(): Promise<Me | null>;
  switchOrg(organizationId: string): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(getActiveOrg());

  const reloadMe = useCallback(async () => {
    try {
      const next = await api<Me>('/auth/me');
      setMe(next);
      setStatus('authenticated');
      // Keep the stored organization if still a member, else pick the first one.
      const stored = getActiveOrg();
      const valid =
        next.memberships.find((m) => m.organizationId === stored) ?? next.memberships[0] ?? null;
      setActiveOrg(valid?.organizationId ?? null);
      setActiveOrgId(valid?.organizationId ?? null);
      return next;
    } catch {
      setMe(null);
      setStatus('anonymous');
      return null;
    }
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    setMe(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    setSessionLostHandler(clear);
    void refreshSession().then(async (ok) => {
      if (ok) await reloadMe();
      else setStatus('anonymous');
    });
  }, [clear, reloadMe]);

  const adoptTokens = useCallback(
    async (tokens: TokenResponse) => {
      setAccessToken(tokens.accessToken);
      await reloadMe();
    },
    [reloadMe],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<TokenResponse | MfaChallenge>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      if ('mfaRequired' in res) return res;
      await adoptTokens(res);
      return null;
    },
    [adoptTokens],
  );

  const verifyMfa = useCallback(
    async (mfaToken: string, code: string) => {
      await adoptTokens(
        await api<TokenResponse>('/auth/mfa/verify', { method: 'POST', body: { mfaToken, code } }),
      );
    },
    [adoptTokens],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      clear();
    }
  }, [clear]);

  const switchOrg = useCallback(
    (organizationId: string) => {
      setActiveOrg(organizationId);
      setActiveOrgId(organizationId);
      // Everything cached belongs to the previous organization.
      queryClient.clear();
    },
    [queryClient],
  );

  const activeOrg = useMemo(
    () => me?.memberships.find((m) => m.organizationId === activeOrgId) ?? null,
    [me, activeOrgId],
  );

  const value = useMemo<AuthState>(
    () => ({ status, me, activeOrg, login, verifyMfa, adoptTokens, logout, reloadMe, switchOrg }),
    [status, me, activeOrg, login, verifyMfa, adoptTokens, logout, reloadMe, switchOrg],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
