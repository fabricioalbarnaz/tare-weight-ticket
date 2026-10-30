import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { AssignConjuntoForm } from '../components/forms/AssignConjuntoForm';
import { formatDateTime } from '../lib/datetime';

export function TruckDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const truckId = Number(id);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['truck', truckId],
    queryFn: () => api.getTruck(truckId),
  });

  const activateMutation = useMutation({
    mutationFn: (truckConjuntoId: number) => api.activateTruckConjunto(truckConjuntoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['truck', truckId] });
      queryClient.invalidateQueries({ queryKey: ['trucks'] });
    },
  });

  if (isLoading) return <p className="text-sm text-slate-500">{t('truckDetail.loading')}</p>;
  if (isError || !data) return <p className="text-sm text-red-600">{t('truckDetail.notFound')}</p>;

  const { truck, auditLog } = data;

  return (
    <div className="max-w-2xl">
      <Link to="/internal-trucks" className="text-sm text-slate-500 hover:underline">
        {t('truckDetail.backToList')}
      </Link>
      <h1 className="mt-2 mb-1 text-xl font-semibold text-slate-900">
        {t('truckDetail.heading', { plate: truck.plate })}
      </h1>
      {truck.label && <p className="mb-6 text-sm text-slate-500">{truck.label}</p>}

      <div className="space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{t('truckDetail.conjuntosHeading')}</h2>
            {truck.conjuntos.length > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {truck.conjuntos.length}
              </span>
            )}
          </div>
          <p className="mb-3 text-xs text-slate-500">{t('truckDetail.conjuntosDescription')}</p>

          {truck.conjuntos.length === 0 && (
            <p className="text-sm text-slate-500">{t('truckDetail.noConjuntos')}</p>
          )}
          {truck.conjuntos.length > 0 && (
            <ul className="space-y-2" data-testid="truck-conjunto-list">
              {truck.conjuntos.map((assignment) => (
                <li
                  key={assignment.id}
                  className={`flex items-center justify-between rounded-md border p-3 text-sm ${
                    assignment.isActive
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${assignment.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}
                      aria-hidden="true"
                    />
                    <div>
                      <span className="font-medium text-slate-900">{assignment.conjuntoName}</span>
                      <span className="ml-2 text-slate-500">
                        {t('truckDetail.tareWeight', { tareWeightKg: assignment.tareWeightKg })}
                      </span>
                    </div>
                  </div>
                  {assignment.isActive ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {t('truckDetail.active')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => activateMutation.mutate(assignment.id)}
                      disabled={activateMutation.isPending}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                    >
                      {t('truckDetail.activate')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">{t('truckDetail.assignConjuntoHeading')}</h2>
          <p className="mb-3 text-xs text-slate-500">{t('truckDetail.assignConjuntoDescription')}</p>
          <AssignConjuntoForm truckId={truckId} />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">{t('truckDetail.auditTrail')}</h2>
          {auditLog.length === 0 ? (
            <p className="text-sm text-slate-500">{t('auditLog.empty')}</p>
          ) : (
            <ul className="space-y-3" data-testid="truck-audit-log">
              {auditLog.map((entry) => (
                <li key={entry.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">
                      {t(`truckAuditLog.actions.${entry.action}`, { defaultValue: entry.action })}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatDateTime(entry.createdAt, i18n.language)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{t('auditLog.by', { actor: entry.actor })}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
