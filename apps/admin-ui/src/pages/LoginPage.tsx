import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, type Location } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../auth/AuthContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

function createLoginSchema(t: TFunction) {
  return z.object({
    username: z.string().min(1, t('login.validation.usernameRequired')),
    password: z.string().min(1, t('login.validation.passwordRequired')),
  });
}

type FormValues = z.infer<ReturnType<typeof createLoginSchema>>;

export function LoginPage() {
  const { t } = useTranslation();
  const { user, login, loginError, isLoggingIn } = useAuth();
  const location = useLocation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(createLoginSchema(t)) });

  if (user) {
    const from = (location.state as { from?: Location } | null)?.from;
    const redirectTo = from ? `${from.pathname}${from.search}` : '/';
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <form
        onSubmit={handleSubmit((values) => login(values))}
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{t('login.title')}</h1>
          <p className="text-sm text-slate-500">{t('login.subtitle')}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600" htmlFor="username">
            {t('login.username')}
          </label>
          <input
            id="username"
            autoComplete="username"
            {...register('username')}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          {errors.username && (
            <p className="mt-1 text-xs text-red-600">{errors.username.message}</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600" htmlFor="password">
            {t('login.password')}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          {errors.password && (
            <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
          )}
        </div>

        {loginError && <p className="text-sm text-red-600">{loginError}</p>}

        <button
          type="submit"
          disabled={isLoggingIn}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isLoggingIn ? t('login.signingIn') : t('login.signIn')}
        </button>
      </form>
    </div>
  );
}
