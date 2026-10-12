import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import type { Ticket } from '../../api/types';

export function ReprintButton({ ticket }: { ticket: Ticket }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.reprint(ticket.id, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets', ticket.id] });
      setConfirming(false);
    },
  });

  if (ticket.status !== 'CLOSED') return null;

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
      >
        {t('forms.reprint.button')}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-slate-600">
        {t('forms.reprint.confirm', { number: ticket.ticketNumber })}
      </span>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {mutation.isPending ? t('forms.reprint.printing') : t('forms.reprint.confirmButton')}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
      >
        {t('forms.reprint.cancel')}
      </button>
      {mutation.isError && <span className="text-xs text-red-600">{t('forms.reprint.error')}</span>}
    </div>
  );
}
