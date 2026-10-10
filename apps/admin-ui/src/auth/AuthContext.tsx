import { createContext, useContext, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { CurrentUser, LoginPayload } from '../api/types';

interface AuthContextValue {
  user: CurrentUser | null;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  loginError: string | null;
  isLoggingIn: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [loginError, setLoginError] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
  });

  const loginMutation = useMutation({
    mutationFn: (payload: LoginPayload) => api.login(payload),
    onSuccess: (user) => {
      setLoginError(null);
      queryClient.setQueryData(['auth', 'me'], user);
    },
    onError: (error: unknown) => {
      setLoginError(
        error instanceof ApiError && error.status === 401
          ? 'Invalid username or password.'
          : 'Could not sign in. Please try again.',
      );
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'me'], null);
      queryClient.clear();
    },
  });

  const value: AuthContextValue = {
    user: meQuery.data ?? null,
    isLoading: meQuery.isLoading,
    login: async (payload) => {
      try {
        await loginMutation.mutateAsync(payload);
      } catch {
        // Already surfaced to the UI via `loginError`; callers don't need to handle it too.
      }
    },
    loginError,
    isLoggingIn: loginMutation.isPending,
    logout: () => logoutMutation.mutate(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
