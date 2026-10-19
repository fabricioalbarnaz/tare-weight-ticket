export const loginBodySchema = {
  type: 'object',
  properties: {
    username: { type: 'string', minLength: 1 },
    password: { type: 'string', minLength: 1 },
  },
  required: ['username', 'password'],
  additionalProperties: false,
} as const;

export const ticketIdParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^[0-9]+$' },
  },
  required: ['id'],
} as const;

export const listTicketsQuerySchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['OPEN', 'CLOSED', 'ANOMALY'] },
    search: { type: 'string' },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
} as const;

export const listUnresolvedEventsQuerySchema = {
  type: 'object',
  properties: {
    source: { type: 'string', enum: ['camera_entrance', 'camera_exit', 'scale'] },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
} as const;

export const createTicketBodySchema = {
  type: 'object',
  properties: {
    plate: { type: 'string', minLength: 1 },
    entryAt: { type: 'string', format: 'date-time' },
    entryWeightKg: { type: 'number' },
    reason: { type: 'string', minLength: 1 },
  },
  required: ['plate', 'entryAt', 'entryWeightKg', 'reason'],
  additionalProperties: false,
} as const;

export const editEntryBodySchema = {
  type: 'object',
  properties: {
    entryAt: { type: 'string', format: 'date-time' },
    entryWeightKg: { type: 'number' },
    cameraId: { type: 'string' },
    reason: { type: 'string', minLength: 1 },
  },
  required: ['entryAt', 'entryWeightKg', 'reason'],
  additionalProperties: false,
} as const;

export const editExitBodySchema = {
  type: 'object',
  properties: {
    exitAt: { type: 'string', format: 'date-time' },
    exitWeightKg: { type: 'number' },
    cameraId: { type: 'string' },
    reason: { type: 'string', minLength: 1 },
  },
  required: ['exitAt', 'exitWeightKg', 'reason'],
  additionalProperties: false,
} as const;

export const reprintBodySchema = {
  type: 'object',
  properties: {
    reason: { type: 'string' },
  },
  additionalProperties: false,
} as const;

export interface LoginBody {
  username: string;
  password: string;
}

export interface TicketIdParams {
  id: string;
}

export interface ListTicketsQuery {
  status?: 'OPEN' | 'CLOSED' | 'ANOMALY';
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface ListUnresolvedEventsQuery {
  source?: 'camera_entrance' | 'camera_exit' | 'scale';
  page?: number;
  pageSize?: number;
}

export interface CreateTicketBody {
  plate: string;
  entryAt: string;
  entryWeightKg: number;
  reason: string;
}

export interface EditEntryBody {
  entryAt: string;
  entryWeightKg: number;
  cameraId?: string;
  reason: string;
}

export interface EditExitBody {
  exitAt: string;
  exitWeightKg: number;
  cameraId?: string;
  reason: string;
}

export interface ReprintBody {
  reason?: string;
}
