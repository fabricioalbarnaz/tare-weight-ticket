import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '../../api/client';
import type { Ticket } from '../../api/types';
import { fromDateTimeInputValue, toDateTimeInputValue } from '../../lib/datetime';

function createEditLegSchema(t: TFunction) {
  return z.object({
    occurredAt: z.string().min(1, t('forms.editLeg.validation.dateTimeRequired')),
    weightKg: z.coerce.number().positive(t('forms.editLeg.validation.weightPositive')),
    reason: z.string().min(5, t('forms.editLeg.validation.reason')),
  });
}

type FormInput = z.input<ReturnType<typeof createEditLegSchema>>;
type FormOutput = z.output<ReturnType<typeof createEditLegSchema>>;

export function EditLegForm({ ticket, leg }: { ticket: Ticket; leg: 'entry' | 'exit' }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isEntry = leg === 'entry';
  const legName = t(`forms.editLeg.legName.${leg}`);
  const schema = createEditLegSchema(t);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: {
      occurredAt: toDateTimeInputValue(isEntry ? ticket.entryAt : ticket.exitAt),
      weightKg: (isEntry ? ticket.entryWeightKg : ticket.exitWeightKg) ?? undefined,
      reason: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: FormOutput) =>
      isEntry
        ? api.editEntry(ticket.id, {
            entryAt: fromDateTimeInputValue(values.occurredAt),
            entryWeightKg: values.weightKg,
            reason: values.reason,
          })
        : api.editExit(ticket.id, {
            exitAt: fromDateTimeInputValue(values.occurredAt),
            exitWeightKg: values.weightKg,
            reason: values.reason,
          }),
    onSuccess: ({ ticket: updated }) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', ticket.id] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      reset({
        occurredAt: toDateTimeInputValue(isEntry ? updated.entryAt : updated.exitAt),
        weightKg: (isEntry ? updated.entryWeightKg : updated.exitWeightKg) ?? undefined,
        reason: '',
      });
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="space-y-3 rounded-md border border-slate-200 bg-white p-4"
      aria-label={t('forms.editLeg.ariaLabel', { leg: legName })}
    >
      <h3 className="text-sm font-semibold text-slate-900">
        {t('forms.editLeg.heading', { leg: legName })}
      </h3>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor={`${leg}-occurredAt`}>
          {t('forms.editLeg.dateTime')}
        </label>
        <input
          id={`${leg}-occurredAt`}
          type="datetime-local"
          {...register('occurredAt')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.occurredAt && (
          <p className="mt-1 text-xs text-red-600">{errors.occurredAt.message}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor={`${leg}-weightKg`}>
          {t('forms.editLeg.weight')}
        </label>
        <input
          id={`${leg}-weightKg`}
          type="number"
          step="0.1"
          {...register('weightKg')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.weightKg && <p className="mt-1 text-xs text-red-600">{errors.weightKg.message}</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor={`${leg}-reason`}>
          {t('forms.editLeg.reason')}
        </label>
        <textarea
          id={`${leg}-reason`}
          {...register('reason')}
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder={t('forms.editLeg.reasonPlaceholder')}
        />
        {errors.reason && <p className="mt-1 text-xs text-red-600">{errors.reason.message}</p>}
      </div>

      <button
        type="submit"
        disabled={isSubmitting || mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {mutation.isPending ? t('forms.editLeg.submitting') : t('forms.editLeg.submit')}
      </button>
      {mutation.isSuccess && (
        <p className="text-xs text-green-700">{t('forms.editLeg.success')}</p>
      )}
      {mutation.isError && <p className="text-xs text-red-600">{t('forms.editLeg.error')}</p>}
    </form>
  );
}
