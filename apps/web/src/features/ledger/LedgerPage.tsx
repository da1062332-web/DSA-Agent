// apps/web/src/features/ledger/LedgerPage.tsx — MOD-LED Ledger Management UI
import React, { useEffect, useState } from 'react';
import type {
  AccountBalanceResponse,
  ConnectorStatementResponse,
  LedgerAccount,
  LedgerJournal,
} from '@dsa/contracts';
import {
  closeLedgerPeriod,
  createLedgerAccount,
  createLedgerExport,
  fetchAccountBalance,
  fetchConnectorStatements,
  fetchLedgerAccounts,
  fetchLedgerJournals,
  fetchTrialBalance,
} from './api';

export function LedgerPage() {
  const [activeTab, setActiveTab] = useState<
    'accounts' | 'journals' | 'statements' | 'period_close' | 'exports'
  >('accounts');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // --- Accounts State ---
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>('ALL');
  const [selectedBalance, setSelectedBalance] = useState<AccountBalanceResponse | null>(null);
  const [isNewAccountModalOpen, setIsNewAccountModalOpen] = useState(false);
  const [newAccountCode, setNewAccountCode] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountType, setNewAccountType] = useState('ASSET');

  // --- Journals State ---
  const [journals, setJournals] = useState<LedgerJournal[]>([]);
  const [journalPeriodFilter, setJournalPeriodFilter] = useState('');

  // --- Statements State ---
  const [connectorIdInput, setConnectorIdInput] = useState('');
  const [connectorStatement, setConnectorStatement] = useState<ConnectorStatementResponse | null>(null);

  // --- Trial Balance & Period Close State ---
  const [trialPeriod, setTrialPeriod] = useState(new Date().toISOString().substring(0, 7));
  const [trialBalance, setTrialBalance] = useState<{
    totalDebit: string;
    totalCredit: string;
    variance: string;
    isBalanced: boolean;
  } | null>(null);
  const [closePeriodNote, setClosePeriodNote] = useState('');
  const [isClosingPeriod, setIsClosingPeriod] = useState(false);

  // --- Export State ---
  const [exportPeriod, setExportPeriod] = useState(new Date().toISOString().substring(0, 7));
  const [exportFormat, setExportFormat] = useState<'CSV' | 'JSON' | 'EXCEL'>('CSV');
  const [exportHistory, setExportHistory] = useState<
    Array<{ id: string; format: string; period: string; status: string; date: string }>
  >([]);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchLedgerAccounts(
        accountTypeFilter !== 'ALL' ? { type: accountTypeFilter as any } : undefined,
      );
      setAccounts(res.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load ledger accounts');
    } finally {
      setLoading(false);
    }
  };

  const loadJournals = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchLedgerJournals(
        journalPeriodFilter ? { period: journalPeriodFilter } : undefined,
      );
      setJournals(res.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load journals');
    } finally {
      setLoading(false);
    }
  };

  const loadTrialBalance = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchTrialBalance(trialPeriod || undefined);
      setTrialBalance(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load trial balance');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'accounts') loadAccounts();
    if (activeTab === 'journals') loadJournals();
    if (activeTab === 'period_close') loadTrialBalance();
  }, [activeTab, accountTypeFilter, journalPeriodFilter, trialPeriod]);

  const handleInspectBalance = async (accId: string) => {
    try {
      setLoading(true);
      const res = await fetchAccountBalance(accId);
      setSelectedBalance(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch balance');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);
      await createLedgerAccount({
        code: newAccountCode,
        name: newAccountName,
        type: newAccountType as any,
        isActive: newAccountType !== 'TAX_PAYABLE' && newAccountType !== 'TAX_RECEIVABLE',
      });
      setSuccessMsg(`Account ${newAccountCode} created successfully.`);
      setIsNewAccountModalOpen(false);
      setNewAccountCode('');
      setNewAccountName('');
      loadAccounts();
    } catch (err: any) {
      setError(err?.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchStatements = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectorIdInput.trim()) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetchConnectorStatements(connectorIdInput.trim());
      setConnectorStatement(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch connector statement');
    } finally {
      setLoading(false);
    }
  };

  const handleClosePeriodSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !window.confirm(
        `Are you sure you want to CLOSE accounting period ${trialPeriod}? Once closed, no further journals can be posted to this period.`,
      )
    ) {
      return;
    }
    try {
      setIsClosingPeriod(true);
      setError(null);
      const res = await closeLedgerPeriod(trialPeriod, { note: closePeriodNote });
      setSuccessMsg(`Period ${res.period} closed successfully with zero-sum trial balance verification.`);
      setClosePeriodNote('');
      loadTrialBalance();
    } catch (err: any) {
      setError(err?.message || 'Period close failed');
    } finally {
      setIsClosingPeriod(false);
    }
  };

  const handleExportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);
      const res = await createLedgerExport({
        period: exportPeriod,
        format: exportFormat,
      });
      setExportHistory((prev) => [
        {
          id: res.exportId,
          format: exportFormat,
          period: exportPeriod,
          status: 'QUEUED',
          date: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
      setSuccessMsg(`Export job ${res.exportId} dispatched to queue.`);
    } catch (err: any) {
      setError(err?.message || 'Export request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
            <span>Ledger Management</span>
            <span className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium px-2.5 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800">
              MOD-LED • DOM-K
            </span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            General and sub-ledger chart of accounts, immutable double-entry journal postings, and
            period-close governance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="btn-new-account"
            onClick={() => setIsNewAccountModalOpen(true)}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition"
          >
            + New Account
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200 text-sm flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="font-bold ml-2">
            ×
          </button>
        </div>
      )}
      {successMsg && (
        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200 text-sm flex justify-between items-center">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="font-bold ml-2">
            ×
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <nav className="flex space-x-6">
          {[
            { id: 'accounts', label: 'Chart of Accounts (SUB-LED.01)' },
            { id: 'journals', label: 'Journal Postings (SUB-LED.02)' },
            { id: 'statements', label: 'Connector Statements (SUB-LED.03)' },
            { id: 'period_close', label: 'Trial Balance & Period Close' },
            { id: 'exports', label: 'Exports' },
          ].map((tab) => (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-3 px-1 font-medium text-sm border-b-2 transition ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* TAB 1: Chart of Accounts */}
      {activeTab === 'accounts' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-gray-50 dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <label
                htmlFor="select-account-type"
                className="text-xs font-semibold uppercase tracking-wider text-gray-500"
              >
                Filter by Type:
              </label>
              <select
                id="select-account-type"
                value={accountTypeFilter}
                onChange={(e) => setAccountTypeFilter(e.target.value)}
                className="text-sm border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-md p-1.5"
              >
                <option value="ALL">All Types</option>
                <option value="ASSET">ASSET</option>
                <option value="LIABILITY">LIABILITY</option>
                <option value="INCOME">INCOME</option>
                <option value="EXPENSE">EXPENSE</option>
                <option value="SUSPENSE">SUSPENSE</option>
                <option value="TAX_PAYABLE">TAX_PAYABLE (OD-021 Dormant)</option>
                <option value="TAX_RECEIVABLE">TAX_RECEIVABLE (OD-021 Dormant)</option>
              </select>
            </div>
            <div className="text-xs text-gray-500">Showing {accounts.length} accounts</div>
          </div>

          <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">Code</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">Type</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">
                    Counterparty
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-300">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-gray-400">
                      {loading ? 'Loading accounts...' : 'No ledger accounts registered.'}
                    </td>
                  </tr>
                ) : (
                  accounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition">
                      <td className="px-4 py-3 font-mono font-medium text-indigo-600 dark:text-indigo-400">
                        {acc.code}
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{acc.name}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                            acc.type === 'ASSET'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200'
                              : acc.type === 'LIABILITY'
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200'
                                : acc.type === 'INCOME'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                                  : acc.type === 'EXPENSE'
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
                                    : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                          }`}
                        >
                          {acc.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {acc.counterpartyType
                          ? `${acc.counterpartyType} (${acc.counterpartyId ?? 'any'})`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {acc.isActive ? (
                          <span className="text-emerald-600 text-xs font-semibold flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span> Active
                          </span>
                        ) : (
                          <span className="text-amber-600 text-xs font-semibold flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span> Inactive
                            (OD-021)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleInspectBalance(acc.id)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 px-3 py-1 rounded transition"
                        >
                          View Balance
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Journal Postings */}
      {activeTab === 'journals' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-gray-50 dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <label
                htmlFor="filter-journal-period"
                className="text-xs font-semibold uppercase tracking-wider text-gray-500"
              >
                Period (YYYY-MM):
              </label>
              <input
                id="filter-journal-period"
                type="text"
                placeholder="e.g. 2026-10"
                value={journalPeriodFilter}
                onChange={(e) => setJournalPeriodFilter(e.target.value)}
                className="text-sm border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-md p-1.5 font-mono"
              />
            </div>
            <div className="text-xs text-gray-500">
              Append-only double-entry journals enforced by PostgreSQL deferred balancing trigger.
            </div>
          </div>

          <div className="space-y-4">
            {journals.length === 0 ? (
              <div className="text-center py-12 border border-dashed rounded-xl text-gray-400">
                {loading ? 'Loading journals...' : 'No journals found for this filter.'}
              </div>
            ) : (
              journals.map((j) => (
                <div
                  key={j.id}
                  className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 shadow-sm space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between border-b pb-2">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-gray-900 dark:text-white">
                        {j.journalNumber}
                      </span>
                      <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded font-medium">
                        {j.referenceType}
                      </span>
                      <span className="text-xs text-gray-400">Ref: {j.referenceId}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>
                        Period: <b className="text-gray-700 dark:text-gray-300">{j.period}</b>
                      </span>
                      <span>Posted by: {j.postedBy}</span>
                      <span>{new Date(j.postedAt).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Lines Table */}
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b">
                        <th className="text-left py-1">#</th>
                        <th className="text-left py-1">Account</th>
                        <th className="text-left py-1">Type</th>
                        <th className="text-left py-1">Narration</th>
                        <th className="text-right py-1">Debit (₹)</th>
                        <th className="text-right py-1">Credit (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {j.lines?.map((line) => (
                        <tr key={line.id}>
                          <td className="py-1 text-gray-400">{line.lineNumber}</td>
                          <td className="py-1 font-mono">{line.accountCode ?? line.accountId}</td>
                          <td className="py-1">
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                line.entryType === 'DEBIT'
                                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
                              }`}
                            >
                              {line.entryType}
                            </span>
                          </td>
                          <td className="py-1 text-gray-500">{line.narration ?? '—'}</td>
                          <td className="py-1 text-right font-mono font-medium text-blue-600 dark:text-blue-400">
                            {line.entryType === 'DEBIT'
                              ? `₹${parseFloat(line.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                              : '—'}
                          </td>
                          <td className="py-1 text-right font-mono font-medium text-emerald-600 dark:text-emerald-400">
                            {line.entryType === 'CREDIT'
                              ? `₹${parseFloat(line.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Connector Statements */}
      {activeTab === 'statements' && (
        <div className="space-y-6">
          <form
            onSubmit={handleFetchStatements}
            className="p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl flex flex-wrap items-center gap-4"
          >
            <div className="flex-1 min-w-[240px]">
              <label
                htmlFor="input-connector-id"
                className="block text-xs font-semibold uppercase text-gray-500 mb-1"
              >
                Connector ID:
              </label>
              <input
                id="input-connector-id"
                type="text"
                placeholder="e.g. con_01J..."
                value={connectorIdInput}
                onChange={(e) => setConnectorIdInput(e.target.value)}
                className="w-full text-sm border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-lg p-2 font-mono"
              />
            </div>
            <button
              id="btn-fetch-statement"
              type="submit"
              disabled={loading}
              className="mt-5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition"
            >
              Generate Statement
            </button>
          </form>

          {connectorStatement && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-white dark:bg-gray-900 border rounded-xl shadow-sm">
                  <div className="text-xs text-gray-500">Opening Balance</div>
                  <div className="text-lg font-bold font-mono text-gray-900 dark:text-white mt-1">
                    ₹{connectorStatement.openingBalance}
                  </div>
                </div>
                <div className="p-4 bg-white dark:bg-gray-900 border rounded-xl shadow-sm">
                  <div className="text-xs text-gray-500">Total Credits (Earned)</div>
                  <div className="text-lg font-bold font-mono text-emerald-600 mt-1">
                    ₹{connectorStatement.totalCredits}
                  </div>
                </div>
                <div className="p-4 bg-white dark:bg-gray-900 border rounded-xl shadow-sm">
                  <div className="text-xs text-gray-500">Total Debits (Paid)</div>
                  <div className="text-lg font-bold font-mono text-blue-600 mt-1">
                    ₹{connectorStatement.totalDebits}
                  </div>
                </div>
                <div className="p-4 bg-white dark:bg-gray-900 border rounded-xl shadow-sm">
                  <div className="text-xs text-gray-500">Closing Balance (Payable)</div>
                  <div className="text-lg font-bold font-mono text-indigo-600 mt-1">
                    ₹{connectorStatement.closingBalance}
                  </div>
                </div>
              </div>

              <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
                <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-800">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-500">Journal #</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-500">Reference</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-500">Debit (₹)</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-500">Credit (₹)</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-500">Running Balance (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {connectorStatement.lines.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-6 text-gray-400">
                          No activity recorded for this connector.
                        </td>
                      </tr>
                    ) : (
                      connectorStatement.lines.map((line, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-4 py-2 font-mono text-xs">{line.date}</td>
                          <td className="px-4 py-2 font-mono text-xs text-indigo-600">
                            {line.journalNumber}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-500">
                            {line.referenceType}: {line.referenceId}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-blue-600">
                            {line.debit !== '0.00' ? `₹${line.debit}` : '—'}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-emerald-600">
                            {line.credit !== '0.00' ? `₹${line.credit}` : '—'}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs font-bold text-gray-900 dark:text-white">
                            ₹{line.runningBalance}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Trial Balance & Period Close */}
      {activeTab === 'period_close' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 bg-white dark:bg-gray-900 border rounded-2xl shadow-sm space-y-3">
              <div className="text-xs uppercase font-bold text-gray-500 tracking-wider">Total Debits</div>
              <div className="text-3xl font-bold font-mono text-blue-600">
                ₹{trialBalance?.totalDebit ?? '0.00'}
              </div>
              <p className="text-xs text-gray-400">Aggregated debits across all sub-ledgers</p>
            </div>

            <div className="p-6 bg-white dark:bg-gray-900 border rounded-2xl shadow-sm space-y-3">
              <div className="text-xs uppercase font-bold text-gray-500 tracking-wider">Total Credits</div>
              <div className="text-3xl font-bold font-mono text-emerald-600">
                ₹{trialBalance?.totalCredit ?? '0.00'}
              </div>
              <p className="text-xs text-gray-400">Aggregated credits across all sub-ledgers</p>
            </div>

            <div
              className={`p-6 border rounded-2xl shadow-sm space-y-3 ${
                trialBalance?.isBalanced
                  ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200'
                  : 'bg-red-50/50 dark:bg-red-950/20 border-red-200'
              }`}
            >
              <div className="text-xs uppercase font-bold text-gray-500 tracking-wider">
                Trial Balance Variance
              </div>
              <div
                className={`text-3xl font-bold font-mono ${trialBalance?.isBalanced ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}
              >
                ₹{trialBalance?.variance ?? '0.00'}
              </div>
              <div className="text-xs font-semibold">
                {trialBalance?.isBalanced
                  ? '✓ Zero-sum verified (Debit = Credit)'
                  : '⚠ UNBALANCED: Period close blocked'}
              </div>
            </div>
          </div>

          {/* Period Close Card */}
          <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-2xl bg-white dark:bg-gray-900 shadow-sm space-y-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <span>Execute Accounting Period Close</span>
              <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">
                Step-Up MFA Required
              </span>
            </h2>
            <p className="text-sm text-gray-500">
              Closing a period finalizes all journal postings for that calendar month. It locks the period
              against retroactive adjustments and ensures financial statements remain tamper-evident.
            </p>

            <form onSubmit={handleClosePeriodSubmit} className="space-y-4 max-w-xl">
              <div>
                <label
                  htmlFor="input-close-period"
                  className="block text-xs font-semibold text-gray-600 mb-1"
                >
                  Period to Close:
                </label>
                <input
                  id="input-close-period"
                  type="text"
                  value={trialPeriod}
                  onChange={(e) => setTrialPeriod(e.target.value)}
                  className="w-full text-sm font-mono border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-lg p-2"
                />
              </div>

              <div>
                <label htmlFor="input-close-note" className="block text-xs font-semibold text-gray-600 mb-1">
                  Closing Note / Audit Memo:
                </label>
                <textarea
                  id="input-close-note"
                  rows={3}
                  value={closePeriodNote}
                  onChange={(e) => setClosePeriodNote(e.target.value)}
                  placeholder="e.g. Month-end commission settlement closed after reconciliation."
                  className="w-full text-sm border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-lg p-2"
                />
              </div>

              <button
                id="btn-close-period"
                type="submit"
                disabled={isClosingPeriod || !trialBalance?.isBalanced}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg text-sm font-semibold transition"
              >
                {isClosingPeriod ? 'Closing Period...' : `Close Period ${trialPeriod}`}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 5: Exports */}
      {activeTab === 'exports' && (
        <div className="space-y-6">
          <form
            onSubmit={handleExportSubmit}
            className="p-6 bg-white dark:bg-gray-900 border rounded-2xl shadow-sm space-y-4 max-w-xl"
          >
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Generate Accounting Ledger Export
            </h2>
            <p className="text-xs text-gray-500">
              Export general ledger journals, account balances, and sub-ledger movements for external ERP
              accounting suites.
            </p>

            <div>
              <label
                htmlFor="select-export-format"
                className="block text-xs font-semibold text-gray-600 mb-1"
              >
                Format:
              </label>
              <select
                id="select-export-format"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as any)}
                className="w-full text-sm border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-lg p-2"
              >
                <option value="CSV">CSV (Tally / QuickBooks Compatible)</option>
                <option value="JSON">JSON (Standard Schema)</option>
                <option value="EXCEL">Excel (.xlsx)</option>
              </select>
            </div>

            <div>
              <label htmlFor="input-export-period" className="block text-xs font-semibold text-gray-600 mb-1">
                Period (Optional):
              </label>
              <input
                id="input-export-period"
                type="text"
                value={exportPeriod}
                onChange={(e) => setExportPeriod(e.target.value)}
                className="w-full text-sm font-mono border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-lg p-2"
              />
            </div>

            <button
              id="btn-trigger-export"
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-indigo-600 text-white font-medium text-sm rounded-lg hover:bg-indigo-700 transition"
            >
              Dispatch Export Job
            </button>
          </form>

          {exportHistory.length > 0 && (
            <div className="border rounded-2xl overflow-hidden bg-white dark:bg-gray-900">
              <div className="p-4 bg-gray-50 dark:bg-gray-800 font-bold text-sm border-b">
                Recent Export Dispatches
              </div>
              <table className="min-w-full text-sm divide-y">
                <thead>
                  <tr className="text-gray-500 text-xs">
                    <th className="px-4 py-2 text-left">Export ID</th>
                    <th className="px-4 py-2 text-left">Period</th>
                    <th className="px-4 py-2 text-left">Format</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-right">Dispatched At</th>
                  </tr>
                </thead>
                <tbody>
                  {exportHistory.map((h) => (
                    <tr key={h.id} className="text-xs">
                      <td className="px-4 py-2 font-mono text-indigo-600">{h.id}</td>
                      <td className="px-4 py-2">{h.period}</td>
                      <td className="px-4 py-2">{h.format}</td>
                      <td className="px-4 py-2 text-emerald-600 font-bold">{h.status}</td>
                      <td className="px-4 py-2 text-right text-gray-400">{h.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Balance Inspection Modal */}
      {selectedBalance && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">Account Balance Summary</h3>
              <button
                onClick={() => setSelectedBalance(null)}
                className="text-gray-400 hover:text-gray-600 font-bold text-xl"
              >
                ×
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Account:</span>{' '}
                <span className="font-mono font-bold">{selectedBalance.accountCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Name:</span> <span>{selectedBalance.accountName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Type:</span>{' '}
                <span className="font-semibold">{selectedBalance.type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total Debits:</span>{' '}
                <span className="font-mono text-blue-600">₹{selectedBalance.debitTotal}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total Credits:</span>{' '}
                <span className="font-mono text-emerald-600">₹{selectedBalance.creditTotal}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-bold">
                <span>Net Balance:</span>
                <span className="font-mono text-indigo-600">₹{selectedBalance.balance}</span>
              </div>
              <div className="text-xs text-gray-400 mt-2 text-right">
                Computed from {selectedBalance.lineCount} ledger entries
              </div>
            </div>
            <button
              onClick={() => setSelectedBalance(null)}
              className="w-full py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 text-gray-800 dark:text-gray-200 rounded-lg text-sm font-medium transition"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* New Account Modal */}
      {isNewAccountModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                Register New Ledger Account
              </h3>
              <button
                onClick={() => setIsNewAccountModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 font-bold text-xl"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreateAccount} className="space-y-4 text-sm">
              <div>
                <label htmlFor="input-new-code" className="block text-xs font-semibold text-gray-500 mb-1">
                  Account Code:
                </label>
                <input
                  id="input-new-code"
                  type="text"
                  required
                  placeholder="e.g. 1020-OPERATING-BANK"
                  value={newAccountCode}
                  onChange={(e) => setNewAccountCode(e.target.value)}
                  className="w-full border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-lg p-2 font-mono text-sm"
                />
              </div>
              <div>
                <label htmlFor="input-new-name" className="block text-xs font-semibold text-gray-500 mb-1">
                  Account Name:
                </label>
                <input
                  id="input-new-name"
                  type="text"
                  required
                  placeholder="e.g. Operating Bank Account"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  className="w-full border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-lg p-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="select-new-type" className="block text-xs font-semibold text-gray-500 mb-1">
                  Type:
                </label>
                <select
                  id="select-new-type"
                  value={newAccountType}
                  onChange={(e) => setNewAccountType(e.target.value)}
                  className="w-full border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded-lg p-2 text-sm"
                >
                  <option value="ASSET">ASSET</option>
                  <option value="LIABILITY">LIABILITY</option>
                  <option value="INCOME">INCOME</option>
                  <option value="EXPENSE">EXPENSE</option>
                  <option value="SUSPENSE">SUSPENSE</option>
                  <option value="TAX_PAYABLE">TAX_PAYABLE (OD-021 Dormant)</option>
                  <option value="TAX_RECEIVABLE">TAX_RECEIVABLE (OD-021 Dormant)</option>
                </select>
              </div>

              {(newAccountType === 'TAX_PAYABLE' || newAccountType === 'TAX_RECEIVABLE') && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg text-xs text-amber-800 dark:text-amber-300">
                  ⚠ Under Open Decision OD-021, tax accounts will be created in INACTIVE state until tax
                  withholding rules are finalized.
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewAccountModalOpen(false)}
                  className="px-4 py-2 border rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  id="btn-save-account"
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
                >
                  Save Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
