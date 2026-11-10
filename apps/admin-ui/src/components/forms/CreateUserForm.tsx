import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '../../api/client';
import { MIN_PASSWORD_LENGTH, USER_ROLES } from '../../api/types';
import { userErrorMessage } from '../../lib/userErrors';

/** Same rule as the backend's `createUserBodySchema`. */
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;

function createUserSchema(t: TFunction) {
  return z.object({
    name: z.string().trim().min(1, t('forms.user.validation.name')),
    username: z.string().regex(USERNAME_PATTERN, t('forms.user.validation.username')),
    role: z.enum(USER_ROLES),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, t('users.passwordHint', { min: MIN_PASSWORD_LENGTH })),
  });
}

type FormValues = z.infer<ReturnType<typeof createUserSchema>>;

export function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(createUserSchema(t)),
    defaultValues: { name: '', username: '', role: 'operator', password: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.createUser(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onCreated();
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="space-y-3 rounded-md border border-slate-200 bg-white p-4"
      aria-label={t('users.createHeading')}
    >
      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="create-user-name">
          {t('forms.user.name')}
        </label>
        <input
          id="create-user-name"
          {...register('name')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="create-user-username">
          {t('forms.user.username')}
        </label>
        <input
          id="create-user-username"
          autoComplete="off"
          {...register('username')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.username ? (
          <p className="mt-1 text-xs text-red-600">{errors.username.message}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">{t('forms.user.usernameHint')}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="create-user-role">
          {t('forms.user.role')}
        </label>
        <select
          id="create-user-role"
          {...register('role')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          {USER_ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`users.roles.${role}`)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="create-user-password">
          {t('forms.user.initialPassword')}
        </label>
        <input
          id="create-user-password"
          type="password"
          autoComplete="new-password"
          {...register('password')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.password ? (
          <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            {t('users.passwordHint', { min: MIN_PASSWORD_LENGTH })}{' '}
            {t('forms.user.initialPasswordHint')}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {mutation.isPending ? t('forms.user.creating') : t('forms.user.create')}
      </button>
      {mutation.isError && (
        <p className="text-xs text-red-600">
          {userErrorMessage(t, mutation.error, 'forms.user.createError')}
        </p>
      )}
    </form>
  );
}
