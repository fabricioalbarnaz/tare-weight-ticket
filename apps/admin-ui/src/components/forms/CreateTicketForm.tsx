import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../../api/client';
import { fromDateTimeInputValue } from '../../lib/datetime';

const schema = z.object({
  plate: z.string().min(3, 'Enter the plate').max(10),
  entryAt: z.string().min(1, 'Date and time are required'),
  entryWeightKg: z.coerce.number().positive('Weight must be greater than 0'),
  reason: z.string().min(5, 'Explain why this ticket is being created manually (at least 5 characters)'),
});

type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function CreateTicketForm({ defaultPlate = '' }: { defaultPlate?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
      aria-label="Create ticket manually"
    >
      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="create-plate">
          Plate
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
          Entry date & time
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
          Entry weight (kg)
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
          Reason
        </label>
        <textarea
          id="create-reason"
          {...register('reason')}
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="e.g. entrance camera failed to read the plate, created from the unresolved event"
        />
        {errors.reason && <p className="mt-1 text-xs text-red-600">{errors.reason.message}</p>}
      </div>

      <button
        type="submit"
        disabled={isSubmitting || mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {mutation.isPending ? 'Creating…' : 'Create ticket'}
      </button>
      {mutation.isError && (
        <p className="text-xs text-red-600">Could not create the ticket. Please try again.</p>
      )}
    </form>
  );
}
