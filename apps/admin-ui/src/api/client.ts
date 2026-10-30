import type {
  AssignConjuntoPayload,
  Conjunto,
  CreateConjuntoPayload,
  CreateTicketPayload,
  CreateTruckPayload,
  CurrentUser,
  EditEntryPayload,
  EditExitPayload,
  HardwareStatus,
  LoginPayload,
  Paginated,
  RawEvent,
  ReprintPayload,
  Ticket,
  TicketDetail,
  TicketListQuery,
  Truck,
  TruckDetail,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(body || response.statusText, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function toQueryString(query: TicketListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  login(payload: LoginPayload): Promise<CurrentUser> {
    return request('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
  },

  logout(): Promise<void> {
    return request('/auth/logout', { method: 'POST' });
  },

  me(): Promise<CurrentUser> {
    return request('/auth/me');
  },

  listTickets(query: TicketListQuery): Promise<Paginated<Ticket>> {
    return request(`/tickets${toQueryString(query)}`);
  },

  getTicket(id: number): Promise<TicketDetail> {
    return request(`/tickets/${id}`);
  },

  createTicket(payload: CreateTicketPayload): Promise<{ ticket: Ticket }> {
    return request('/tickets', { method: 'POST', body: JSON.stringify(payload) });
  },

  editEntry(id: number, payload: EditEntryPayload): Promise<{ ticket: Ticket }> {
    return request(`/tickets/${id}/entry`, { method: 'PATCH', body: JSON.stringify(payload) });
  },

  editExit(id: number, payload: EditExitPayload): Promise<{ ticket: Ticket }> {
    return request(`/tickets/${id}/exit`, { method: 'PATCH', body: JSON.stringify(payload) });
  },

  reprint(id: number, payload: ReprintPayload): Promise<{ ticket: Ticket }> {
    return request(`/tickets/${id}/reprint`, { method: 'POST', body: JSON.stringify(payload) });
  },

  listUnresolvedEvents(query: {
    source?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Paginated<RawEvent>> {
    return request(`/unresolved-events${toQueryString(query)}`);
  },

  status(): Promise<HardwareStatus> {
    return request('/status');
  },

  listTrucks(): Promise<Truck[]> {
    return request('/trucks');
  },

  getTruck(id: number): Promise<TruckDetail> {
    return request(`/trucks/${id}`);
  },

  createTruck(payload: CreateTruckPayload): Promise<{ truck: Truck }> {
    return request('/trucks', { method: 'POST', body: JSON.stringify(payload) });
  },

  listConjuntos(): Promise<Conjunto[]> {
    return request('/conjuntos');
  },

  createConjunto(payload: CreateConjuntoPayload): Promise<{ conjunto: Conjunto }> {
    return request('/conjuntos', { method: 'POST', body: JSON.stringify(payload) });
  },

  assignConjuntoToTruck(truckId: number, payload: AssignConjuntoPayload): Promise<{ truck: Truck }> {
    return request(`/trucks/${truckId}/conjuntos`, { method: 'POST', body: JSON.stringify(payload) });
  },

  activateTruckConjunto(truckConjuntoId: number): Promise<{ truck: Truck }> {
    return request(`/truck-conjuntos/${truckConjuntoId}/activate`, { method: 'POST' });
  },
};
