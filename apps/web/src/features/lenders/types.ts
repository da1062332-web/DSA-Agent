export type LenderType = 'BANK' | 'NBFC' | 'HFC';
export type LenderStatus = 'ACTIVE' | 'PAUSED' | 'TERMINATED';
export type EmpanelmentStatus = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';

export interface LenderContact {
  id: string;
  tenantId: string;
  lenderId: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  channel: string;
  escalationLevel: number;
  createdAt: string;
  updatedAt: string;
}

export interface Empanelment {
  id: string;
  tenantId: string;
  lenderId: string;
  dsaCode: string;
  validFrom: string;
  validTo: string | null;
  permittedCategories: string[];
  permittedGeos?: Record<string, unknown> | null;
  agreementDocumentId?: string | null;
  status: EmpanelmentStatus;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface Lender {
  id: string;
  tenantId: string;
  name: string;
  lenderType: LenderType;
  regulatorRef: string | null;
  status: LenderStatus;
  globalLenderRef: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  empanelments?: Empanelment[];
  contacts?: LenderContact[];
}

export interface CreateLenderInput {
  name: string;
  lenderType: LenderType;
  regulatorRef?: string;
}

export interface UpdateLenderInput {
  name?: string;
  lenderType?: LenderType;
  regulatorRef?: string;
  status?: LenderStatus;
}

export interface CreateEmpanelmentInput {
  dsaCode: string;
  validFrom?: string;
  validTo?: string;
  permittedCategories?: string[];
  permittedGeos?: Record<string, unknown>;
  agreementDocumentId?: string;
}

export interface UpdateEmpanelmentInput {
  validTo?: string;
  permittedCategories?: string[];
  status?: EmpanelmentStatus;
}

export interface SetLenderContactsInput {
  contacts: Array<{
    name: string;
    role: string;
    email: string;
    phone: string;
    channel: string;
    escalationLevel?: number;
  }>;
}
