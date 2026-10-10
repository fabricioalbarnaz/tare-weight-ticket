import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '../../api/client';
import type { Ticket } from '../../api/types';
import { fromDateTimeInputValue, toDateTimeInputValue } from '../../lib/datetime';

const schema = z.object({
  occurredAt: z.string().min(1, 'Date and time are required'),
  weightKg: z.coerce.number().positive('Weight must be greater than 0'),
  reason: z.string().min(5, 'Explain the correction (at least 5 characters)'),
});

type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function EditLegForm({ ticket, leg }: { ticket: Ticket; leg: 'entry' | 'exit' }) {
  const queryClient = useQueryClient();
  const isEntry = leg === 'entry';

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
      aria-label={`Edit ${leg} weight`}
    >
      <h3 className="text-sm font-semibold text-slate-900">
        {isEntry ? 'Edit entry' : 'Edit exit'}
      </h3>

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor={`${leg}-occurredAt`}>
          Date & time
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
          Weight (kg)
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
          Reason for this correction
        </label>
        <textarea
          id={`${leg}-reason`}
          {...register('reason')}
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="e.g. camera misread plate, weight manually re-entered from printed receipt"
        />
        {errors.reason && <p className="mt-1 text-xs text-red-600">{errors.reason.message}</p>}
      </div>

      <button
        type="submit"
        disabled={isSubmitting || mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {mutation.isPending ? 'Saving…' : 'Save correction'}
      </button>
      {mutation.isSuccess && (
        <p className="text-xs text-green-700">Saved. See the audit trail below.</p>
      )}
      {mutation.isError && (
        <p className="text-xs text-red-600">Could not save. Please try again.</p>
      )}
    </form>
  );
}
