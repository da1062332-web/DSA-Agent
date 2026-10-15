// apps/web/src/features/import-export/ImportExportPage.tsx — owner: Platform Squad (MOD-IMP, TASK-413)
import React, { useState } from 'react';
import type { ImportBatch, TargetEntityType } from '@dsa/contracts';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useAuth } from '../../auth/AuthProvider';
import { apiDownload } from '../../api/client';
import {
  useCommitImport,
  useConfigureMapping,
  useCreateExportJob,
  useCreateImport,
  useExportJobs,
  useImportBatches,
  useRollbackImport,
} from './api';

export function ImportExportPage() {
  const [activeTab, setActiveTab] = useState<'import' | 'export'>('import');

  // Import State
  const [targetEntity, setTargetEntity] = useState<TargetEntityType>('LEAD');
  const [fileContentBase64, setFileContentBase64] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [selectedBatch, setSelectedBatch] = useState<ImportBatch | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  const [rollbackReason, setRollbackReason] = useState('Incorrect data ingested');

  // Export State
  const [exportType, setExportType] = useState('LEAD');
  const [fileFormat, setFileFormat] = useState<'CSV' | 'XLSX' | 'JSON'>('CSV');
  const [scopeType, setScopeType] = useState<'TENANT' | 'BRANCH'>('TENANT');

  // Queries and mutations
  const { data: importBatches, isLoading: loadingBatches } = useImportBatches();
  const { data: exportJobs, isLoading: loadingExports } = useExportJobs();
  const createImportMutation = useCreateImport();
  const configureMappingMutation = useConfigureMapping();
  const commitImportMutation = useCommitImport();
  const rollbackMutation = useRollbackImport();
  const createExportMutation = useCreateExportJob();

  // Notifications
  const [notification, setNotification] = useState<{ severity: 'success' | 'error' | 'info'; message: string } | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || result;
      setFileContentBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleCreateBatch = async () => {
    if (!fileContentBase64 || !fileName) return;

    try {
      const batch = await createImportMutation.mutateAsync({
        targetEntity,
        fileFormat: fileName.endsWith('.xlsx') ? 'XLSX' : 'CSV',
        filename: fileName,
        contentBase64: fileContentBase64,
      });

      setSelectedBatch(batch);
      // Auto-map matching columns
      const initialMapping: Record<string, string> = {};
      if (batch.previewData && batch.previewData.length > 0) {
        const headers = Object.keys(batch.previewData[0]!);
        for (const h of headers) {
          const lower = h.toLowerCase();
          if (lower.includes('name')) initialMapping[h] = 'fullName';
          else if (lower.includes('phone') || lower.includes('mobile')) initialMapping[h] = 'mobile';
          else if (lower.includes('email')) initialMapping[h] = 'email';
          else if (lower.includes('amount')) initialMapping[h] = 'indicativeAmount';
          else if (lower.includes('product') || lower.includes('category')) initialMapping[h] = 'productCategory';
        }
      }
      setColumnMapping(initialMapping);
      setNotification({ severity: 'success', message: `File "${fileName}" parsed successfully! Please configure column mappings.` });
    } catch (err: any) {
      setNotification({ severity: 'error', message: err?.message || 'Failed to upload and parse import file.' });
    }
  };

  const handleSaveMapping = async () => {
    if (!selectedBatch) return;
    try {
      const updated = await configureMappingMutation.mutateAsync({
        id: selectedBatch.id,
        dto: { columnMapping },
      });
      setSelectedBatch(updated);
      setNotification({ severity: 'success', message: 'Column mappings configured successfully.' });
    } catch (err: any) {
      setNotification({ severity: 'error', message: err?.message || 'Failed to save column mapping.' });
    }
  };

  const handleCommit = async () => {
    if (!selectedBatch) return;
    try {
      const updated = await commitImportMutation.mutateAsync({
        id: selectedBatch.id,
      });
      setSelectedBatch(updated);
      setNotification({
        severity: updated.importedRows > 0 ? 'success' : 'error',
        message: `Import finished: ${updated.importedRows} records ingested, ${updated.invalidRows} errors.`,
      });
    } catch (err: any) {
      setNotification({ severity: 'error', message: err?.message || 'Failed to commit import batch.' });
    }
  };

  const handleConfirmRollback = async () => {
    if (!selectedBatch) return;
    try {
      await rollbackMutation.mutateAsync({
        id: selectedBatch.id,
        dto: { reason: rollbackReason },
      });
      setRollbackDialogOpen(false);
      setSelectedBatch(null);
      setNotification({ severity: 'success', message: 'Import batch successfully rolled back. Records archived.' });
    } catch (err: any) {
      setNotification({ severity: 'error', message: err?.message || 'Failed to roll back batch.' });
    }
  };

  const handleRunExport = async () => {
    try {
      await createExportMutation.mutateAsync({
        exportType,
        fileFormat,
        scopeType,
        filters: {},
      });
      setNotification({ severity: 'success', message: `${exportType} export job queued. Download will be available shortly.` });
    } catch (err: any) {
      setNotification({ severity: 'error', message: err?.message || 'Failed to initiate data export.' });
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      {notification && (
        <Alert severity={notification.severity} onClose={() => setNotification(null)} sx={{ mb: 3 }}>
          {notification.message}
        </Alert>
      )}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          Import and Export Framework (MOD-IMP)
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Generic bulk data ingestion and scoped, masked, expiring record exports.
        </Typography>
      </Box>

      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 3 }}>
        <Tab label="Bulk Import Wizard (CMP-IMP.01.1)" value="import" />
        <Tab label="Data Exports (SUB-IMP.02)" value="export" />
      </Tabs>

      {/* ===================== TAB 1: BULK IMPORT ===================== */}
      {activeTab === 'import' && (
        <Grid container spacing={3}>
          {/* Left Column: Import Wizard */}
          <Grid item xs={12} md={7}>
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2, fontSize: 16 }}>
                  Step 1: Upload Source File
                </Typography>
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Target Entity</InputLabel>
                      <Select
                        value={targetEntity}
                        label="Target Entity"
                        onChange={(e) => setTargetEntity(e.target.value as TargetEntityType)}
                      >
                        <MenuItem value="LEAD">Leads (ENT-020)</MenuItem>
                        <MenuItem value="CUSTOMER">Customers (ENT-025)</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6}>
                    <Button variant="outlined" component="label" fullWidth sx={{ height: 40 }}>
                      {fileName || 'Choose CSV / Excel File'}
                      <input type="file" accept=".csv,.xlsx" hidden onChange={handleFileUpload} />
                    </Button>
                  </Grid>
                </Grid>

                <Alert severity="info" sx={{ mb: 2 }}>
                  Maximum file size: 50 MB. Source files are securely stored in private quarantine and retained for 7 days.
                </Alert>

                <Button
                  variant="contained"
                  disabled={!fileContentBase64 || createImportMutation.isPending}
                  onClick={handleCreateBatch}
                >
                  {createImportMutation.isPending ? <CircularProgress size={20} /> : 'Upload & Parse Headers'}
                </Button>
              </CardContent>
            </Card>

            {/* Step 2: Column Mapping */}
            {selectedBatch && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6" sx={{ fontSize: 16 }}>
                      Step 2: Configure Column Mapping
                    </Typography>
                    <Chip label={`Batch: ${selectedBatch.id}`} size="small" />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Map CSV header columns to target {selectedBatch.targetEntity} fields. Required fields: Full Name, Mobile.
                  </Typography>

                  {selectedBatch.previewData && selectedBatch.previewData.length > 0 && (
                    <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Source CSV Column</TableCell>
                            <TableCell>Target Entity Field</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {Object.keys(selectedBatch.previewData[0]!).map((col) => (
                            <TableRow key={col}>
                              <TableCell sx={{ fontWeight: 500 }}>{col}</TableCell>
                              <TableCell>
                                <Select
                                  size="small"
                                  value={columnMapping[col] || ''}
                                  onChange={(e) =>
                                    setColumnMapping({ ...columnMapping, [col]: e.target.value })
                                  }
                                  displayEmpty
                                  sx={{ minWidth: 200 }}
                                >
                                  <MenuItem value="">
                                    <em>-- Ignore Column --</em>
                                  </MenuItem>
                                  <MenuItem value="fullName">Full Name (Required)</MenuItem>
                                  <MenuItem value="mobile">Mobile Number (Required)</MenuItem>
                                  <MenuItem value="email">Email Address</MenuItem>
                                  <MenuItem value="productCategory">Product Category</MenuItem>
                                  <MenuItem value="indicativeAmount">Indicative Amount</MenuItem>
                                </Select>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}

                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                      variant="outlined"
                      onClick={handleSaveMapping}
                      disabled={configureMappingMutation.isPending}
                    >
                      Save Mapping
                    </Button>
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={handleCommit}
                      disabled={commitImportMutation.isPending || selectedBatch.status === 'COMPLETED'}
                    >
                      {commitImportMutation.isPending ? <CircularProgress size={20} /> : 'Commit Import Batch'}
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            )}

            {/* Step 3: Batch Results & Rollback */}
            {selectedBatch && selectedBatch.status === 'COMPLETED' && (
              <Card>
                <CardContent>
                  <Typography variant="h6" sx={{ fontSize: 16, mb: 1 }}>
                    Batch Execution Summary
                  </Typography>
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={3}>
                      <Typography variant="caption" color="text.secondary">Total Rows</Typography>
                      <Typography variant="h6">{selectedBatch.totalRows}</Typography>
                    </Grid>
                    <Grid item xs={3}>
                      <Typography variant="caption" color="text.secondary">Imported</Typography>
                      <Typography variant="h6" color="success.main">{selectedBatch.importedRows}</Typography>
                    </Grid>
                    <Grid item xs={3}>
                      <Typography variant="caption" color="text.secondary">Errors</Typography>
                      <Typography variant="h6" color="error.main">{selectedBatch.invalidRows}</Typography>
                    </Grid>
                    <Grid item xs={3}>
                      <Typography variant="caption" color="text.secondary">Status</Typography>
                      <Box sx={{ mt: 0.5 }}>
                        <Chip label={selectedBatch.status} color="success" size="small" />
                      </Box>
                    </Grid>
                  </Grid>

                  <Divider sx={{ my: 2 }} />

                  <Box sx={{ display: 'flex', gap: 2 }}>
                    {selectedBatch.reportFileKey && (
                      <Button
                        variant="outlined"
                        onClick={() => {
                          void apiDownload(`/v1/imports/${selectedBatch.id}/report`, `import_${selectedBatch.id}_validation_report.csv`);
                        }}
                      >
                        Download Error Report
                      </Button>
                    )}
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={() => setRollbackDialogOpen(true)}
                    >
                      Roll Back Batch (24h Window)
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            )}
          </Grid>

          {/* Right Column: Recent Import Batches */}
          <Grid item xs={12} md={5}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ fontSize: 16, mb: 2 }}>
                  Recent Import Batches
                </Typography>
                {loadingBatches ? (
                  <CircularProgress size={24} />
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Batch ID</TableCell>
                          <TableCell>Entity</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Rows</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {importBatches?.map((b) => (
                          <TableRow
                            key={b.id}
                            hover
                            sx={{ cursor: 'pointer' }}
                            onClick={() => setSelectedBatch(b)}
                          >
                            <TableCell sx={{ fontSize: 12 }}>{b.id}</TableCell>
                            <TableCell sx={{ fontSize: 12 }}>{b.targetEntity}</TableCell>
                            <TableCell>
                              <Chip
                                label={b.status}
                                size="small"
                                color={b.status === 'COMPLETED' ? 'success' : b.status === 'ROLLED_BACK' ? 'default' : 'primary'}
                                sx={{ height: 20, fontSize: 10 }}
                              />
                            </TableCell>
                            <TableCell align="right" sx={{ fontSize: 12 }}>
                              {b.importedRows}/{b.totalRows}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* ===================== TAB 2: DATA EXPORTS ===================== */}
      {activeTab === 'export' && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={5}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ fontSize: 16, mb: 2 }}>
                  Initiate Secure Data Export
                </Typography>

                <Alert severity="warning" sx={{ mb: 2 }}>
                  Record-level exports require elevated step-up authentication (AAL2 TOTP ≤ 900s). Sensitive attributes (Aadhaar, PAN, Phone, Email) are masked.
                </Alert>

                <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                  <InputLabel>Export Entity / Dataset</InputLabel>
                  <Select
                    value={exportType}
                    label="Export Entity / Dataset"
                    onChange={(e) => setExportType(e.target.value)}
                  >
                    <MenuItem value="LEAD">Leads (Masked PII)</MenuItem>
                    <MenuItem value="CUSTOMER">Customers (Masked PII)</MenuItem>
                    <MenuItem value="OPERATIONAL_SUMMARY">Operational Daily Summary</MenuItem>
                    <MenuItem value="METRICS">Executive Metrics</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                  <InputLabel>File Format</InputLabel>
                  <Select
                    value={fileFormat}
                    label="File Format"
                    onChange={(e) => setFileFormat(e.target.value as any)}
                  >
                    <MenuItem value="CSV">CSV (Comma-Separated Values)</MenuItem>
                    <MenuItem value="JSON">JSON</MenuItem>
                    <MenuItem value="XLSX">Excel Spreadsheet (XLSX)</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                  <InputLabel>Export Scope</InputLabel>
                  <Select
                    value={scopeType}
                    label="Export Scope"
                    onChange={(e) => setScopeType(e.target.value as any)}
                  >
                    <MenuItem value="TENANT">Tenant-Wide (Admin / Owner Only)</MenuItem>
                    <MenuItem value="BRANCH">Primary Branch Only</MenuItem>
                  </Select>
                </FormControl>

                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleRunExport}
                  disabled={createExportMutation.isPending}
                >
                  {createExportMutation.isPending ? <CircularProgress size={20} /> : 'Generate Export File'}
                </Button>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={7}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ fontSize: 16, mb: 2 }}>
                  Export Jobs & Expiring Downloads (24-Hour Expiry)
                </Typography>

                {loadingExports ? (
                  <CircularProgress size={24} />
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Job ID</TableCell>
                          <TableCell>Dataset</TableCell>
                          <TableCell>Scope</TableCell>
                          <TableCell align="right">Rows</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {exportJobs?.map((job) => (
                          <TableRow key={job.id}>
                            <TableCell sx={{ fontSize: 12 }}>{job.id}</TableCell>
                            <TableCell sx={{ fontSize: 12 }}>{job.exportType}</TableCell>
                            <TableCell sx={{ fontSize: 12 }}>{job.scopeType}</TableCell>
                            <TableCell align="right" sx={{ fontSize: 12 }}>{job.rowCount}</TableCell>
                            <TableCell>
                              <Chip
                                label={job.status}
                                size="small"
                                color={job.status === 'COMPLETED' ? 'success' : 'default'}
                                sx={{ height: 20, fontSize: 10 }}
                              />
                            </TableCell>
                            <TableCell align="right">
                              {job.status === 'COMPLETED' && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={() => {
                                    void apiDownload(`/v1/exports/${job.id}/download`, `export_${job.id}.${job.fileFormat.toLowerCase()}`);
                                  }}
                                  sx={{ fontSize: 11, py: 0.2 }}
                                >
                                  Download
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Rollback Confirmation Dialog */}
      <Dialog open={rollbackDialogOpen} onClose={() => setRollbackDialogOpen(false)}>
        <DialogTitle>Confirm 24-Hour Batch Rollback</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            This action will archive all records created by this batch. Records that have already converted or have attached applications will be preserved to prevent data loss.
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="Rollback Reason"
            value={rollbackReason}
            onChange={(e) => setRollbackReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollbackDialogOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleConfirmRollback}
            disabled={rollbackMutation.isPending}
          >
            {rollbackMutation.isPending ? <CircularProgress size={18} /> : 'Confirm Rollback'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
