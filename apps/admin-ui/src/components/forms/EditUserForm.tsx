import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '../../api/client';
import { USER_ROLES, type User } from '../../api/types';
import { userErrorMessage } from '../../lib/userErrors';

function editUserSchema(t: TFunction) {
  return z.object({
    name: z.string().trim().min(1, t('forms.user.validation.name')),
    role: z.enum(USER_ROLES),
  });
}

type FormValues = z.infer<ReturnType<typeof editUserSchema>>;

/** `isSelf`: an admin can rename themselves but never change their own profile (backend rejects it too). */
export function EditUserForm({ user, isSelf }: { user: User; isSelf: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(editUserSchema(t)),
    defaultValues: { name: user.name, role: user.role },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.updateUser(user.id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      // Renaming yourself changes the name shown in the header.
      if (isSelf) queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="space-y-3 rounded-md border border-slate-200 bg-white p-4"
      aria-label={t('userDetail.editHeading')}
    >
      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="edit-user-name">
          {t('forms.user.name')}
        </label>
        <input
          id="edit-user-name"
          {...register('name')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="edit-user-role">
          {t('forms.user.role')}
        </label>
        <select
          id="edit-user-role"
          disabled={isSelf}
          {...register('role')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-100"
        >
          {USER_ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`users.roles.${role}`)}
            </option>
          ))}
        </select>
        {isSelf && <p className="mt-1 text-xs text-slate-500">{t('userDetail.ownRoleNote')}</p>}
      </div>

      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {mutation.isPending ? t('forms.user.saving') : t('forms.user.save')}
      </button>
      {mutation.isSuccess && <p className="text-xs text-green-700">{t('forms.user.saved')}</p>}
      {mutation.isError && (
        <p className="text-xs text-red-600">
          {userErrorMessage(t, mutation.error, 'forms.user.saveError')}
        </p>
      )}
    </form>
  );
}
