// apps/web/src/features/tasks/types.ts — owner: Dev 6 (MOD-08 Tasks)
export type TaskType =
  | 'FOLLOW_UP'
  | 'CALL'
  | 'MEETING'
  | 'DOCUMENT_COLLECTION'
  | 'LENDER_QUERY'
  | 'REVIEW'
  | 'GENERAL';

export type TaskPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'SNOOZED' | 'COMPLETED' | 'CANCELLED';

export type TaskLinkedType = 'LEAD' | 'LOAN_APPLICATION' | 'LENDER_CASE';

export type TaskOutcomeCode =
  | 'CONNECTED'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'SWITCHED_OFF'
  | 'WRONG_NUMBER'
  | 'CALLBACK_REQUESTED'
  | 'NOT_INTERESTED'
  | 'DONE'
  | 'NOT_REQUIRED'
  | 'OTHER';

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
  slaClass: string | null;
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

export interface CreateTaskPayload {
  type: TaskType;
  title: string;
  ownerUserId?: string;
  ownerQueueId?: string;
  linkedType: TaskLinkedType;
  linkedId: string;
  branchId: string;
  priority?: TaskPriority;
  dueAt?: string;
  slaClass?: string;
  tags?: string[];
}

export interface UpdateTaskPayload {
  ownerUserId?: string | null;
  ownerQueueId?: string | null;
  priority?: TaskPriority;
  dueAt?: string;
  status?: 'OPEN' | 'IN_PROGRESS' | 'CANCELLED';
}

export interface CompleteTaskPayload {
  outcomeCode?: TaskOutcomeCode;
  completionNote?: string;
  nextAction?: {
    createFollowUp: boolean;
    followUpType: TaskType;
    followUpDueAt: string;
    followUpTitle?: string;
  };
}
