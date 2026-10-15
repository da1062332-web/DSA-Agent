// Feature: approvals — owner: Dev 1 — tenant-side workflow for MODULE 40 SUB-ADM.06 (support access) and SUB-ADM.07 (data corrections).
import type { RouteObject } from 'react-router-dom';
import { ApprovalsPage } from './ApprovalsPage';

export const routes: RouteObject[] = [{ path: '/approvals', element: <ApprovalsPage /> }];
