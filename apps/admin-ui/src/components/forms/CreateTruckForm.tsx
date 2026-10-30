import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../../api/client';

function createTruckSchema(t: TFunction) {
  return z.object({
    plate: z.string().min(3, t('forms.createTruck.validation.plate')).max(10),
    label: z.string().optional(),
  });
}

type FormInput = z.input<ReturnType<typeof createTruckSchema>>;
type FormOutput = z.output<ReturnType<typeof createTruckSchema>>;

export function CreateTruckForm() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const schema = createTruckSchema(t);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { plate: '', label: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormOutput) =>
      api.createTruck({ plate: values.plate, label: values.label || undefined }),
    onSuccess: ({ truck }) => {
      queryClient.invalidateQueries({ queryKey: ['trucks'] });
      navigate(`/internal-trucks/${truck.id}`);
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="space-y-3 rounded-md border border-slate-200 bg-white p-4"
      aria-label={t('internalTrucks.createHeading')}
    >
      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="create-truck-plate">
          {t('forms.createTruck.plate')}
        </label>
        <input
          id="create-truck-plate"
          {...register('plate')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm uppercase"
        />
        {errors.plate && <p className="mt-1 text-xs text-red-600">{errors.plate.message}</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="create-truck-label">
          {t('forms.createTruck.label')}
        </label>
        <input
          id="create-truck-label"
          {...register('label')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting || mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {mutation.isPending ? t('forms.createTruck.submitting') : t('forms.createTruck.submit')}
      </button>
      {mutation.isError && <p className="text-xs text-red-600">{t('forms.createTruck.error')}</p>}
    </form>
  );
}
