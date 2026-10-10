import { Link, useSearchParams } from 'react-router-dom';
import { CreateTicketForm } from '../components/forms/CreateTicketForm';

export function CreateTicketPage() {
  const [searchParams] = useSearchParams();
  const defaultPlate = searchParams.get('plate') ?? '';

  return (
    <div className="max-w-md">
      <Link to="/" className="text-sm text-slate-500 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-2 mb-4 text-xl font-semibold text-slate-900">Create ticket manually</h1>
      <p className="mb-4 text-sm text-slate-500">
        Use this when the automatic flow failed (misread plate, camera event with no matching
        ticket) and the entry needs to be recorded by hand.
      </p>
      <CreateTicketForm defaultPlate={defaultPlate} />
    </div>
  );
}
