import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ApiError, api } from '../../api/client';
import type { Truck } from '../../api/types';

function createEditTruckPlateSchema(t: TFunction) {
  return z.object({
    plate: z.string().trim().min(3, t('forms.editTruckPlate.validation.plate')).max(10),
    reason: z.string().min(5, t('forms.editTruckPlate.validation.reason')),
  });
}

type FormInput = z.input<ReturnType<typeof createEditTruckPlateSchema>>;
type FormOutput = z.output<ReturnType<typeof createEditTruckPlateSchema>>;

export function EditTruckPlateForm({ truck }: { truck: Truck }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const schema = createEditTruckPlateSchema(t);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { plate: truck.plate, reason: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormOutput) => api.editTruckPlate(truck.id, values),
    onSuccess: ({ truck: updated }) => {
      queryClient.invalidateQueries({ queryKey: ['truck', truck.id] });
      queryClient.invalidateQueries({ queryKey: ['trucks'] });
      reset({ plate: updated.plate, reason: '' });
    },
  });

  const isDuplicate = mutation.error instanceof ApiError && mutation.error.status === 409;

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="space-y-3 rounded-md border border-slate-200 bg-white p-4"
      aria-label={t('forms.editTruckPlate.ariaLabel')}
    >
      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="edit-truck-plate">
          {t('forms.editTruckPlate.plate')}
        </label>
        <input
          id="edit-truck-plate"
          {...register('plate')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm uppercase"
        />
        {errors.plate && <p className="mt-1 text-xs text-red-600">{errors.plate.message}</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="edit-truck-plate-reason">
          {t('forms.editTruckPlate.reason')}
        </label>
        <textarea
          id="edit-truck-plate-reason"
          {...register('reason')}
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder={t('forms.editTruckPlate.reasonPlaceholder')}
        />
        {errors.reason && <p className="mt-1 text-xs text-red-600">{errors.reason.message}</p>}
      </div>

      <button
        type="submit"
        disabled={isSubmitting || mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {mutation.isPending ? t('forms.editTruckPlate.submitting') : t('forms.editTruckPlate.submit')}
      </button>
      {mutation.isSuccess && <p className="text-xs text-green-700">{t('forms.editTruckPlate.success')}</p>}
      {mutation.isError && (
        <p className="text-xs text-red-600">
          {isDuplicate ? t('forms.editTruckPlate.duplicate') : t('forms.editTruckPlate.error')}
        </p>
      )}
    </form>
  );
}
