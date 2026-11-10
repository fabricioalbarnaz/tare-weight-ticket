import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../api/client';
import { MIN_PASSWORD_LENGTH } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { userErrorMessage } from '../lib/userErrors';

function createChangePasswordSchema(t: TFunction) {
  return z
    .object({
      currentPassword: z.string().min(1, t('changePassword.validation.currentRequired')),
      newPassword: z
        .string()
        .min(MIN_PASSWORD_LENGTH, t('users.passwordHint', { min: MIN_PASSWORD_LENGTH })),
      confirmPassword: z.string(),
    })
    .refine((values) => values.newPassword === values.confirmPassword, {
      message: t('changePassword.validation.mismatch'),
      path: ['confirmPassword'],
    });
}

type FormValues = z.infer<ReturnType<typeof createChangePasswordSchema>>;

/**
 * `forced`: shown right after login while the user still has an
 * admin-set password — standalone (no app nav), only logout is available.
 * Otherwise it's the voluntary "change my password" screen inside the app.
 */
export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(createChangePasswordSchema(t)),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      api.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }),
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(['auth', 'me'], updatedUser);
      reset();
      if (forced) navigate('/', { replace: true });
    },
  });

  if (forced && user && !user.mustChangePassword && !mutation.isSuccess) {
    return <Navigate to="/" replace />;
  }

  const form = (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      aria-label={t('changePassword.title')}
    >
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{t('changePassword.title')}</h1>
        <p className="text-sm text-slate-500">
          {forced ? t('changePassword.forcedDescription') : t('changePassword.description')}
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="current-password">
          {t('changePassword.currentPassword')}
        </label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          {...register('currentPassword')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.currentPassword && (
          <p className="mt-1 text-xs text-red-600">{errors.currentPassword.message}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="new-password">
          {t('changePassword.newPassword')}
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          aria-describedby="new-password-hint"
          {...register('newPassword')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.newPassword ? (
          <p className="mt-1 text-xs text-red-600">{errors.newPassword.message}</p>
        ) : (
          <p id="new-password-hint" className="mt-1 text-xs text-slate-500">
            {t('users.passwordHint', { min: MIN_PASSWORD_LENGTH })}
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="confirm-password">
          {t('changePassword.confirmPassword')}
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          {...register('confirmPassword')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.confirmPassword && (
          <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>
        )}
      </div>

      {mutation.isError && (
        <p className="text-sm text-red-600">
          {userErrorMessage(t, mutation.error, 'changePassword.error')}
        </p>
      )}
      {mutation.isSuccess && !forced && (
        <p className="text-sm text-green-700">{t('changePassword.success')}</p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {mutation.isPending ? t('changePassword.submitting') : t('changePassword.submit')}
      </button>

      {forced && (
        <button
          type="button"
          onClick={logout}
          className="w-full rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          {t('nav.logout')}
        </button>
      )}
    </form>
  );

  if (!forced) return form;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      {form}
    </div>
  );
}
