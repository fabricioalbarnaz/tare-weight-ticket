import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { CreateTruckForm } from '../components/forms/CreateTruckForm';

export function InternalTrucksPage() {
  const { t } = useTranslation();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['trucks'],
    queryFn: () => api.listTrucks(),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('internalTrucks.title')}</h1>
          <p className="text-sm text-slate-500">{t('internalTrucks.description')}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm((shown) => !shown)}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          {t('internalTrucks.newTruck')}
        </button>
      </div>

      {showCreateForm && (
        <div className="mb-4 max-w-md">
          <CreateTruckForm />
        </div>
      )}

      {isLoading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {isError && <p className="text-sm text-red-600">{t('internalTrucks.loadError')}</p>}

      {data && data.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">{t('internalTrucks.empty')}</p>
      )}

      {data && data.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2">{t('internalTrucks.table.plate')}</th>
              <th className="py-2">{t('internalTrucks.table.label')}</th>
              <th className="py-2">{t('internalTrucks.table.activeTare')}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {data.map((truck) => {
              const activeAssignment = truck.conjuntos.find((c) => c.isActive);
              return (
                <tr key={truck.id} className="border-b border-slate-100">
                  <td className="py-2 font-medium text-slate-900">{truck.plate}</td>
                  <td className="py-2 text-slate-600">{truck.label ?? '—'}</td>
                  <td className="py-2 text-slate-600">
                    {activeAssignment
                      ? t('internalTrucks.table.tareWithLabel', {
                          label: activeAssignment.conjuntoName,
                          tareWeightKg: activeAssignment.tareWeightKg,
                        })
                      : t('internalTrucks.table.noActiveTare')}
                  </td>
                  <td className="py-2 text-right">
                    <Link
                      to={`/internal-trucks/${truck.id}`}
                      className="text-sm text-slate-600 hover:underline"
                    >
                      {t('internalTrucks.table.manage')}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
