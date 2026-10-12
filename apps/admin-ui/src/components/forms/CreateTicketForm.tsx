import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../../api/client';
import { fromDateTimeInputValue } from '../../lib/datetime';

function createTicketSchema(t: TFunction) {
  return z.object({
    plate: z.string().min(3, t('forms.create.validation.plate')).max(10),
    entryAt: z.string().min(1, t('forms.create.validation.dateTimeRequired')),
    entryWeightKg: z.coerce.number().positive(t('forms.create.validation.weightPositive')),
    reason: z.string().min(5, t('forms.create.validation.reason')),
  });
}

type FormInput = z.input<ReturnType<typeof createTicketSchema>>;
type FormOutput = z.output<ReturnType<typeof createTicketSchema>>;

export function CreateTicketForm({ defaultPlate = '' }: { defaultPlate?: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const schema = createTicketSchema(t);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { plate: defaultPlate, entryAt: '', entryWeightKg: undefined, reason: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormOutput) =>
      api.createTicket({
        plate: values.plate,
        entryAt: fromDateTimeInputValue(values.entryAt),
        entryWeightKg: values.entryWeightKg,
        reason: values.reason,
      }),
    onSuccess: ({ ticket }) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/tickets/${ticket.id}`);
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="space-y-3 rounded-md border border-slate-200 bg-white p-4"
      aria-label={t('createTicket.heading')}
    >
      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="create-plate">
          {t('forms.create.plate')}
        </label>
        <input
          id="create-plate"
          {...register('plate')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm uppercase"
        />
        {errors.plate && <p className="mt-1 text-xs text-red-600">{errors.plate.message}</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="create-entryAt">
          {t('forms.create.entryDateTime')}
        </label>
        <input
          id="create-entryAt"
          type="datetime-local"
          {...register('entryAt')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.entryAt && <p className="mt-1 text-xs text-red-600">{errors.entryAt.message}</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="create-entryWeightKg">
          {t('forms.create.entryWeight')}
        </label>
        <input
          id="create-entryWeightKg"
          type="number"
          step="0.1"
          {...register('entryWeightKg')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.entryWeightKg && (
          <p className="mt-1 text-xs text-red-600">{errors.entryWeightKg.message}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="create-reason">
          {t('forms.create.reason')}
        </label>
        <textarea
          id="create-reason"
          {...register('reason')}
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder={t('forms.create.reasonPlaceholder')}
        />
        {errors.reason && <p className="mt-1 text-xs text-red-600">{errors.reason.message}</p>}
      </div>

      <button
        type="submit"
        disabled={isSubmitting || mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {mutation.isPending ? t('forms.create.submitting') : t('forms.create.submit')}
      </button>
      {mutation.isError && <p className="text-xs text-red-600">{t('forms.create.error')}</p>}
    </form>
  );
}
