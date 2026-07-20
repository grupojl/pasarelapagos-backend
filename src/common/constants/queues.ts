// src/common/constants/queues.ts
//
// IMPORTANTE: BullMQ 5.x reserva ":" para prefijos internos de Redis.
// Los nombres de queues NO pueden contener ":".
// Usar guiones como separador de namespace.

export const QUEUE_WEBHOOKS  = 'webhooks-process';
export const QUEUE_RECONCILE = 'payments-reconcile';
export const QUEUE_DLQ       = 'payments-dlq';

export const JOB_PROCESS_WEBHOOK   = 'process-webhook';
export const JOB_RECONCILE_PAYMENT = 'reconcile-payment';
