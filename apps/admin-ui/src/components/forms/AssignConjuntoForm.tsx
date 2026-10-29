import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '../../api/client';

const NEW_CONJUNTO_VALUE = '__new__';

function assignConjuntoSchema(t: TFunction) {
  return z
    .object({
      conjuntoSelection: z.string().min(1, t('forms.assignConjunto.validation.conjunto')),
      conjuntoName: z.string().optional(),
      tareWeightKg: z.coerce.number().positive(t('forms.assignConjunto.validation.weightPositive')),
    })
    .refine((values) => values.conjuntoSelection !== NEW_CONJUNTO_VALUE || Boolean(values.conjuntoName?.trim()), {
      message: t('forms.assignConjunto.validation.newConjuntoName'),
      path: ['conjuntoName'],
    });
}

type FormInput = z.input<ReturnType<typeof assignConjuntoSchema>>;
type FormOutput = z.output<ReturnType<typeof assignConjuntoSchema>>;

export function AssignConjuntoForm({ truckId }: { truckId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const schema = assignConjuntoSchema(t);

  const { data: conjuntos } = useQuery({
    queryKey: ['conjuntos'],
    queryFn: () => api.listConjuntos(),
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { conjuntoSelection: '', conjuntoName: '', tareWeightKg: undefined },
  });

  const selection = useWatch({ control, name: 'conjuntoSelection' });

  const mutation = useMutation({
    mutationFn: (values: FormOutput) =>
      api.assignConjuntoToTruck(
        truckId,
        values.conjuntoSelection === NEW_CONJUNTO_VALUE
          ? { conjuntoName: values.conjuntoName!.trim(), tareWeightKg: values.tareWeightKg }
          : { conjuntoId: Number(values.conjuntoSelection), tareWeightKg: values.tareWeightKg },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['truck', truckId] });
      queryClient.invalidateQueries({ queryKey: ['conjuntos'] });
      reset();
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="space-y-3 rounded-md border border-slate-200 bg-white p-4"
      aria-label={t('truckDetail.assignConjuntoHeading')}
    >
      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="assign-conjunto-select">
          {t('forms.assignConjunto.conjunto')}
        </label>
        <select
          id="assign-conjunto-select"
          {...register('conjuntoSelection')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">{t('forms.assignConjunto.selectPlaceholder')}</option>
          {conjuntos?.map((conjunto) => (
            <option key={conjunto.id} value={conjunto.id}>
              {conjunto.name}
            </option>
          ))}
          <option value={NEW_CONJUNTO_VALUE}>{t('forms.assignConjunto.newConjuntoOption')}</option>
        </select>
        {errors.conjuntoSelection && (
          <p className="mt-1 text-xs text-red-600">{errors.conjuntoSelection.message}</p>
        )}
      </div>

      {selection === NEW_CONJUNTO_VALUE && (
        <div>
          <label className="block text-xs font-medium text-slate-600" htmlFor="assign-conjunto-name">
            {t('forms.assignConjunto.newConjuntoName')}
          </label>
          <input
            id="assign-conjunto-name"
            {...register('conjuntoName')}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          {errors.conjuntoName && <p className="mt-1 text-xs text-red-600">{errors.conjuntoName.message}</p>}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-600" htmlFor="assign-conjunto-tare">
          {t('forms.assignConjunto.tareWeight')}
        </label>
        <input
          id="assign-conjunto-tare"
          type="number"
          step="0.1"
          {...register('tareWeightKg')}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        {errors.tareWeightKg && <p className="mt-1 text-xs text-red-600">{errors.tareWeightKg.message}</p>}
      </div>

      <button
        type="submit"
        disabled={isSubmitting || mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {mutation.isPending ? t('forms.assignConjunto.submitting') : t('forms.assignConjunto.submit')}
      </button>
      {mutation.isError && <p className="text-xs text-red-600">{t('forms.assignConjunto.error')}</p>}
    </form>
  );
}
