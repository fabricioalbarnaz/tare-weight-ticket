import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '../../api/client';
import { MIN_PASSWORD_LENGTH, type User } from '../../api/types';
import { userErrorMessage } from '../../lib/userErrors';

function resetPasswordSchema(t: TFunction) {
  return z.object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, t('users.passwordHint', { min: MIN_PASSWORD_LENGTH })),
  });
}

type FormValues = z.infer<ReturnType<typeof resetPasswordSchema>>;

/** Sets a new password for another user, who then has to change it on their next login. */
export function ResetUserPasswordForm({ user }: { user: User }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(resetPasswordSchema(t)),
    defaultValues: { password: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.resetUserPassword(user.id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      reset();
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="space-y-3 rounded-md border border-slate-200 bg-white p-4"
      aria-label={t('userDetail.resetPasswordHeading')}
    >
      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="reset-user-password">
          {t('forms.user.newPassword')}
        </label>
        <input
          id="reset-user-password"
          type="password"
          autoComplete="new-password"
          {...register('password')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.password ? (
          <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            {t('users.passwordHint', { min: MIN_PASSWORD_LENGTH })}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {mutation.isPending ? t('forms.user.saving') : t('forms.user.resetPassword')}
      </button>
      {mutation.isSuccess && (
        <p className="text-xs text-green-700">{t('forms.user.passwordReset')}</p>
      )}
      {mutation.isError && (
        <p className="text-xs text-red-600">
          {userErrorMessage(t, mutation.error, 'forms.user.saveError')}
        </p>
      )}
    </form>
  );
}
