import { useCallback, useEffect, useState } from 'react';
import {
  assignChurchMembershipAsSuperAdmin,
  createChurchAsSuperAdmin,
  createChurchStripeConnectAccountAsSuperAdmin,
  fetchChurchPaymentSettings,
  fetchPaymentOperationsReadiness,
  fetchSuperAdminStats,
  fetchTaxReceiptAuditEvents,
  promoteUserToSuperAdmin,
  setChurchActiveState,
  updateChurchAsSuperAdmin,
  updateChurchPaymentSettingsAsSuperAdmin,
} from '../../lib/api/mission-control';
import { getChurchById } from '../../lib/db/churches';
import {
  ChurchSummary,
  Role,
  SuperAdminPaymentOperationsReadiness,
  SuperAdminChurchStats,
  SuperAdminTaxReceiptAuditEvent,
} from '../../domain/church';
import {
  buildChurchInput,
  buildChurchPaymentSettingsInput,
  buildEditChurchForm,
  ChurchFormData,
  mergeChurchPaymentSettingsForm,
} from './missionControlForm';

interface MissionControlState {
  stats: SuperAdminChurchStats[];
  paymentOperationsReadiness: SuperAdminPaymentOperationsReadiness | null;
  taxReceiptAuditEvents: SuperAdminTaxReceiptAuditEvent[];
  filteredStats: SuperAdminChurchStats[];
  statsLoading: boolean;
  statsError: string;
  showAddChurch: boolean;
  editingChurch: ChurchSummary | null;
  editingChurchForm: ChurchFormData | null;
  formLoading: boolean;
  formError: string;
  confirmDeactivateId: string | null;
  deactivateLoading: boolean;
  searchQuery: string;
  promoteUid: string;
  promoteLoading: boolean;
  promoteResult: string;
  assignChurchId: string | null;
  assignEmail: string;
  assignRole: Role;
  assignLoading: boolean;
  assignResult: string;
  activeChurchCount: number;
  totalMembers: number;
  totalDonations: number;
  totalEvents: number;
  loadStats: () => Promise<void>;
  setSearchQuery: (value: string) => void;
  setPromoteUid: (value: string) => void;
  setAssignEmail: (value: string) => void;
  setAssignRole: (value: Role) => void;
  openAddChurch: () => void;
  closeAddChurch: () => void;
  openEditChurch: (churchId: string) => Promise<void>;
  closeEditChurch: () => void;
  startAssignMembership: (churchId: string) => void;
  cancelAssignMembership: () => void;
  requestDeactivate: (churchId: string) => void;
  cancelDeactivate: () => void;
  handleAddChurch: (form: ChurchFormData) => Promise<void>;
  handleEditChurch: (form: ChurchFormData) => Promise<void>;
  handleCreateStripeConnectAccount: (form: ChurchFormData) => Promise<string>;
  handleSetActive: (churchId: string, isActive: boolean) => Promise<void>;
  handlePromote: () => Promise<void>;
  handleAssignMembership: (churchId: string) => Promise<void>;
}

export function useMissionControl(): MissionControlState {
  const [stats, setStats] = useState<SuperAdminChurchStats[]>([]);
  const [paymentOperationsReadiness, setPaymentOperationsReadiness] =
    useState<SuperAdminPaymentOperationsReadiness | null>(null);
  const [taxReceiptAuditEvents, setTaxReceiptAuditEvents] = useState<SuperAdminTaxReceiptAuditEvent[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState('');
  const [showAddChurch, setShowAddChurch] = useState(false);
  const [editingChurch, setEditingChurch] = useState<ChurchSummary | null>(null);
  const [editingChurchForm, setEditingChurchForm] = useState<ChurchFormData | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [deactivateLoading, setDeactivateLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [promoteUid, setPromoteUid] = useState('');
  const [promoteLoading, setPromoteLoading] = useState(false);
  const [promoteResult, setPromoteResult] = useState('');
  const [assignChurchId, setAssignChurchId] = useState<string | null>(null);
  const [assignEmail, setAssignEmail] = useState('');
  const [assignRole, setAssignRole] = useState<Role>('priest');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignResult, setAssignResult] = useState('');

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError('');
    try {
      const [nextStats, nextReceiptAuditEvents, nextPaymentOperationsReadiness] = await Promise.all([
        fetchSuperAdminStats(),
        fetchTaxReceiptAuditEvents(),
        fetchPaymentOperationsReadiness(),
      ]);
      setStats(nextStats);
      setTaxReceiptAuditEvents(nextReceiptAuditEvents);
      setPaymentOperationsReadiness(nextPaymentOperationsReadiness);
    } catch (error) {
      setStatsError('Failed to load platform stats. Try refreshing.');
      console.error(error);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const filteredStats = stats.filter((church) => {
    const query = searchQuery.toLowerCase();
    return (
      church.name.toLowerCase().includes(query) || church.city.toLowerCase().includes(query)
    );
  });

  const totalMembers = stats.reduce((sum, church) => sum + church.memberCount, 0);
  const totalDonations = stats.reduce((sum, church) => sum + church.donationTotal, 0);
  const totalEvents = stats.reduce((sum, church) => sum + church.eventCount, 0);
  const activeChurchCount = stats.filter((church) => church.isActive).length;

  const openAddChurch = () => {
    setFormError('');
    setShowAddChurch(true);
  };

  const closeAddChurch = () => {
    setFormError('');
    setShowAddChurch(false);
  };

  const openEditChurch = async (churchId: string) => {
    setFormError('');
    setFormLoading(true);
    try {
      const church = await getChurchById(churchId);
      if (!church) {
        setFormError('Church details could not be loaded.');
        return;
      }
      const paymentSettings = await fetchChurchPaymentSettings(churchId);
      setEditingChurch(church);
      setEditingChurchForm(mergeChurchPaymentSettingsForm(buildEditChurchForm(church), paymentSettings));
    } catch (error) {
      setFormError('Church details could not be loaded.');
      console.error(error);
    } finally {
      setFormLoading(false);
    }
  };

  const closeEditChurch = () => {
    setFormError('');
    setEditingChurch(null);
    setEditingChurchForm(null);
  };

  const requestDeactivate = (churchId: string) => {
    setConfirmDeactivateId(churchId);
  };

  const cancelDeactivate = () => {
    setConfirmDeactivateId(null);
  };

  const startAssignMembership = (churchId: string) => {
    setAssignChurchId(churchId);
    setAssignEmail('');
    setAssignRole('priest');
    setAssignResult('');
  };

  const cancelAssignMembership = () => {
    setAssignChurchId(null);
    setAssignEmail('');
    setAssignResult('');
  };

  const handleAddChurch = async (form: ChurchFormData) => {
    setFormLoading(true);
    setFormError('');
    try {
      const created = await createChurchAsSuperAdmin(buildChurchInput(form));
      const paymentSettings = buildChurchPaymentSettingsInput(form);
      if (paymentSettings.stripeConnectEnabled || paymentSettings.stripeConnectAccountId) {
        await updateChurchPaymentSettingsAsSuperAdmin(created.churchId, paymentSettings);
      }
      setShowAddChurch(false);
      await loadStats();
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleEditChurch = async (form: ChurchFormData) => {
    if (!editingChurch) return;

    setFormLoading(true);
    setFormError('');
    try {
      await updateChurchAsSuperAdmin(editingChurch.id, buildChurchInput(form));
      await updateChurchPaymentSettingsAsSuperAdmin(editingChurch.id, buildChurchPaymentSettingsInput(form));
      setEditingChurch(null);
      setEditingChurchForm(null);
      await loadStats();
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleCreateStripeConnectAccount = async (form: ChurchFormData): Promise<string> => {
    if (!editingChurch) {
      throw new Error('Open an existing church before creating a Stripe account.');
    }
    if (form.stripeConnectAccountId.trim()) {
      throw new Error('This church already has a Stripe connected account configured.');
    }

    const result = await createChurchStripeConnectAccountAsSuperAdmin(editingChurch.id);
    setEditingChurchForm((current) =>
      current
        ? {
            ...current,
            stripeConnectEnabled: result.stripeConnectEnabled ? 'true' : 'false',
            stripeConnectAccountId: result.stripeConnectAccountId,
            stripeConnectAccountApi: result.stripeConnectAccountApi,
          }
        : current
    );
    return result.stripeConnectAccountId;
  };

  const handleSetActive = async (churchId: string, isActive: boolean) => {
    setDeactivateLoading(true);
    try {
      await setChurchActiveState(churchId, isActive);
      setConfirmDeactivateId(null);
      setStats((current) =>
        current.map((church) =>
          church.churchId === churchId ? { ...church, isActive } : church
        )
      );
    } catch (error) {
      console.error(error);
    } finally {
      setDeactivateLoading(false);
    }
  };

  const handlePromote = async () => {
    if (!promoteUid.trim()) return;

    setPromoteLoading(true);
    setPromoteResult('');
    try {
      await promoteUserToSuperAdmin(promoteUid.trim());
      setPromoteResult('✓ User has been promoted to Super Admin. They must sign out and back in.');
      setPromoteUid('');
    } catch (error) {
      setPromoteResult(`Error: ${(error as Error).message}`);
    } finally {
      setPromoteLoading(false);
    }
  };

  const handleAssignMembership = async (churchId: string) => {
    const email = assignEmail.trim();
    if (!email) return;

    setAssignLoading(true);
    setAssignResult('');
    try {
      const result = await assignChurchMembershipAsSuperAdmin({
        churchId,
        email,
        role: assignRole,
      });
      setAssignResult(
        `${result.email} assigned as ${result.role}.${result.emailVerified ? '' : ' They must verify their email before signing in.'}`
      );
      setAssignEmail('');
      await loadStats();
    } catch (error) {
      setAssignResult(`Error: ${(error as Error).message}`);
    } finally {
      setAssignLoading(false);
    }
  };

  return {
    stats,
    paymentOperationsReadiness,
    taxReceiptAuditEvents,
    filteredStats,
    statsLoading,
    statsError,
    showAddChurch,
    editingChurch,
    editingChurchForm,
    formLoading,
    formError,
    confirmDeactivateId,
    deactivateLoading,
    searchQuery,
    promoteUid,
    promoteLoading,
    promoteResult,
    assignChurchId,
    assignEmail,
    assignRole,
    assignLoading,
    assignResult,
    activeChurchCount,
    totalMembers,
    totalDonations,
    totalEvents,
    loadStats,
    setSearchQuery,
    setPromoteUid,
    setAssignEmail,
    setAssignRole,
    openAddChurch,
    closeAddChurch,
    openEditChurch,
    closeEditChurch,
    startAssignMembership,
    cancelAssignMembership,
    requestDeactivate,
    cancelDeactivate,
    handleAddChurch,
    handleEditChurch,
    handleCreateStripeConnectAccount,
    handleSetActive,
    handlePromote,
    handleAssignMembership,
  };
}
