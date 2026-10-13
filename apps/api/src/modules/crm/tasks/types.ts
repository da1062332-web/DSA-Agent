// apps/api/src/modules/crm/tasks/types.ts — owner: Dev 6 (MOD-08 Tasks)
import type { SlaClass } from '@dsa/contracts';
import { z } from 'zod';

export const TaskTypeEnum = z.enum([
  'FOLLOW_UP',
  'CALL',
  'MEETING',
  'DOCUMENT_COLLECTION',
  'LENDER_QUERY',
  'REVIEW',
  'GENERAL',
]);
export type TaskType = z.infer<typeof TaskTypeEnum>;

export const TaskPriorityEnum = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type TaskPriority = z.infer<typeof TaskPriorityEnum>;

export const TaskStatusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'SNOOZED', 'COMPLETED', 'CANCELLED']);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

export const TaskLinkedTypeEnum = z.enum(['LEAD', 'LOAN_APPLICATION', 'LENDER_CASE']);
export type TaskLinkedType = z.infer<typeof TaskLinkedTypeEnum>;

export const TaskOutcomeCodeEnum = z.enum([
  'CONNECTED',
  'NO_ANSWER',
  'BUSY',
  'SWITCHED_OFF',
  'WRONG_NUMBER',
  'CALLBACK_REQUESTED',
  'NOT_INTERESTED',
  'DONE',
  'NOT_REQUIRED',
  'OTHER',
]);
export type TaskOutcomeCode = z.infer<typeof TaskOutcomeCodeEnum>;

export const SlaClassEnum = z.enum([
  'CUSTOMER_FIRST_CONTACT',
  'CUSTOMER_FOLLOW_UP',
  'LENDER_QUERY',
  'LENDER_PROCESSING',
  'INTERNAL_REVIEW',
  'DOCUMENT_REVIEW',
]);

/** ENT-030 Row */
export interface TaskRow {
  id: string;
  tenant_id: string;
  type: TaskType;
  title: string;
  owner_user_id: string | null;
  owner_queue_id: string | null;
  linked_type: TaskLinkedType;
  linked_id: string;
  branch_id: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_at: Date;
  sla_class: SlaClass | null;
  sla_decision_record_id: string | null;
  sla_rule_version_id: string | null;
  outcome_code: TaskOutcomeCode | null;
  completion_note: string | null;
  completed_at: Date | null;
  completed_by: string | null;
  follow_up_task_id: string | null;
  idempotency_key: string;
  created_by_source: 'USER' | 'SYSTEM';
  tags: string[];
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

/** API-TASK-001 Create Task Input */
export const CreateTaskInputSchema = z
  .object({
    type: TaskTypeEnum,
    title: z.string().min(3, 'Title must be at least 3 characters').max(200, 'Title cannot exceed 200 characters'),
    ownerUserId: z.string().min(1).optional(),
    ownerQueueId: z.string().min(1).optional(),
    linkedType: TaskLinkedTypeEnum,
    linkedId: z.string().min(1, 'Linked ID is required'),
    branchId: z.string().min(1, 'Branch ID is required'),
    priority: TaskPriorityEnum.default('MEDIUM'),
    dueAt: z.string().datetime({ offset: true }).optional(),
    slaClass: SlaClassEnum.optional(),
    tags: z.array(z.string()).default([]),
  })
  .refine(
    (data) => (data.ownerUserId !== undefined) !== (data.ownerQueueId !== undefined),
    {
      message: 'Exactly one of ownerUserId or ownerQueueId must be provided',
      path: ['ownerUserId'],
    },
  )
  .refine(
    (data) => data.slaClass !== undefined || data.dueAt !== undefined,
    {
      message: 'Either slaClass or dueAt must be provided',
      path: ['dueAt'],
    },
  );

export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

/** API-TASK-003 Update Task Input */
export const UpdateTaskInputSchema = z
  .object({
    ownerUserId: z.string().min(1).optional().nullable(),
    ownerQueueId: z.string().min(1).optional().nullable(),
    priority: TaskPriorityEnum.optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'CANCELLED']).optional(),
  })
  .refine(
    (data) => {
      if (data.ownerUserId !== undefined && data.ownerQueueId !== undefined) {
        if (data.ownerUserId !== null && data.ownerQueueId !== null) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Cannot assign both ownerUserId and ownerQueueId simultaneously',
      path: ['ownerUserId'],
    },
  );

export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;

/** API-TASK-004 Complete Task Input */
export const CompleteTaskInputSchema = z.object({
  outcomeCode: TaskOutcomeCodeEnum.optional(),
  completionNote: z.string().max(2000).optional(),
  nextAction: z
    .object({
      createFollowUp: z.boolean(),
      followUpType: TaskTypeEnum.default('FOLLOW_UP'),
      followUpDueAt: z.string().datetime({ offset: true }),
      followUpTitle: z.string().min(3).max(200).optional(),
    })
    .optional(),
});

export type CompleteTaskInput = z.infer<typeof CompleteTaskInputSchema>;

/** API-TASK-002 List Query */
export const TaskListQuerySchema = z.object({
  view: z.enum(['MINE', 'QUEUES', 'ALL']).default('MINE'),
  status: TaskStatusEnum.optional(),
  priority: TaskPriorityEnum.optional(),
  linkedType: TaskLinkedTypeEnum.optional(),
  linkedId: z.string().optional(),
  branchId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

/** Masked/Public Task Resource */
export interface TaskResource {
  id: string;
  tenantId: string;
  type: TaskType;
  title: string;
  ownerUserId: string | null;
  ownerQueueId: string | null;
  linkedType: TaskLinkedType;
  linkedId: string;
  branchId: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string;
  slaClass: SlaClass | null;
  slaDecisionRecordId: string | null;
  outcomeCode: TaskOutcomeCode | null;
  completionNote: string | null;
  completedAt: string | null;
  completedBy: string | null;
  followUpTaskId: string | null;
  tags: string[];
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
