import React, { useState, useEffect } from 'react';
import { 
  UserCog, Plus, Search, Filter, Edit, Trash2, 
  Eye, Mail, Phone, Shield, CheckCircle, XCircle,
  AlertTriangle, Clock
} from 'lucide-react';
import { ticketsApi } from '../../services/api';
import { isDemoMode } from '../../services/demoMode';

interface Technician {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  grade: 'L1' | 'L2' | 'L3' | 'Admin';
  role: string;
  status: 'active' | 'inactive' | 'pending';
  permissions: string[];
  mfaEnabled: boolean;
  lastLogin?: string;
  createdAt: string;
  assignedServices: string[];
  /** Live workload — joined from the ticketing backend (GET /tickets), NOT a
   *  fixture. null = not loaded / unavailable (rendered as "unavailable"). */
  openTickets: number | null;
  p1Tickets: number | null;
}

export default function TechniciansManagementPage() {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterGrade, setFilterGrade] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedTechnician, setSelectedTechnician] = useState<Technician | null>(null);

  useEffect(() => {
    // Simulate API call
    const fetchTechnicians = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Same people as the ticketing engine assignees (demoWorld) => tickets
        // assigned to "Y. El Amrani" here match Technicians list and vice versa.
        const { demoTechnicians, demoTicketSeeds } = await import('../../data/demoWorld');
        const gradeFor = (role: string) => role === 'client_admin' ? 'Admin' : role === 'analyst' ? 'L3' : role === 'technician' ? 'L2' : 'L1';
        const roleLabel = (g: string) => g === 'Admin' ? 'Security Administrator' : g === 'L3' ? 'Expert Technician' : g === 'L2' ? 'Senior Technician' : 'Junior Technician';
        const mockTechnicians: Technician[] = demoTechnicians.filter(t => t.role !== 'client_admin').map((t, i) => {
          const g = gradeFor(t.role);
          const [firstName, ...rest] = t.name.replace(/^([A-Z]\w*)\.\s/, '$1 ').split(' ');
          const myTickets = demoTicketSeeds.filter(tk => tk.assignee === t.name);
          return {
            id: String(i + 1),
            firstName: firstName.trim(), lastName: rest.join(' ') || '—',
            email: t.email, phone: `+212 5 ${String(40 + i)} ${String(20 + i * 3)} ${String(11 + i * 7)} ${String(30 + i * 9)}`,
            grade: g, role: roleLabel(g), status: 'active',
            permissions: g === 'Admin' ? ['all'] : ['view-alerts', 'edit-alerts', 'view-tickets', 'edit-tickets', 'create-tickets'],
            mfaEnabled: true,
            lastLogin: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
            createdAt: '2026-06-15T00:00:00Z',
            assignedServices: myTickets.length ? ['threat-intel', 'endpoint-protection', 'ticketing'] : ['threat-intel'],
            openTickets: null, p1Tickets: null,
          };
        });
        
        setTechnicians(mockTechnicians);
        setLoading(false);

        // Workload columns via users+tickets join through the API layer:
        // GET /tickets hits the real backend query in production and the
        // demoStore tickets array in Demo Mode — never a second mock here.
        try {
          const rows: any[] = await ticketsApi.list();
          const byAssignee: Record<string, { open: number; p1: number }> = {};
          for (const t of rows) {
            if (['resolved', 'closed'].includes(t.status)) continue;
            const key = String(t.assignee ?? '').trim();
            if (!key) continue;
            const agg = (byAssignee[key] ??= { open: 0, p1: 0 });
            agg.open += 1;
            if (t.priority === 'p1') agg.p1 += 1;
          }
          setTechnicians(prev => prev.map(tc => {
            const full = `${tc.firstName} ${tc.lastName}`.replace(/\s+/g, ' ').trim();
            const hit = byAssignee[full];
            return { ...tc, openTickets: hit ? hit.open : 0, p1Tickets: hit ? hit.p1 : 0 };
          }));
        } catch {
          // Leave workload null → table shows "unavailable", never fake zeros.
        }
      } catch (error) {
        console.error('Failed to fetch technicians:', error);
        setLoading(false);
      }
    };

    fetchTechnicians();
  }, []);

  const filteredTechnicians = technicians.filter(tech => {
    const matchesSearch = 
      tech.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tech.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tech.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesGrade = filterGrade === 'all' || tech.grade === filterGrade;
    const matchesStatus = filterStatus === 'all' || tech.status === filterStatus;
    return matchesSearch && matchesGrade && matchesStatus;
  });

  const stats = {
    total: technicians.length,
    active: technicians.filter(t => t.status === 'active').length,
    inactive: technicians.filter(t => t.status === 'inactive').length,
    pending: technicians.filter(t => t.status === 'pending').length,
    l1: technicians.filter(t => t.grade === 'L1').length,
    l2: technicians.filter(t => t.grade === 'L2').length,
    l3: technicians.filter(t => t.grade === 'L3').length,
    admin: technicians.filter(t => t.grade === 'Admin').length,
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'Admin': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'L3': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'L2': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'L1': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'inactive': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
      case 'pending': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const handleEdit = (tech: Technician) => {
    setSelectedTechnician(tech);
    setShowEditModal(true);
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this technician?')) {
      setTechnicians(technicians.filter(t => t.id !== id));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading technicians...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Technicians Management</h1>
          <p className="text-gray-400 mt-1">
            Manage platform technicians and their permissions
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-[var(--ic-heading)] flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Technician
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <UserCog className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Technicians</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.active}</span>
          </div>
          <p className="text-gray-400 text-sm">Active</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-6 h-6 text-yellow-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.pending}</span>
          </div>
          <p className="text-gray-400 text-sm">Pending</p>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-2">
            <XCircle className="w-6 h-6 text-gray-400" />
            <span className="text-2xl font-bold text-[var(--ic-heading)]">{stats.inactive}</span>
          </div>
          <p className="text-gray-400 text-sm">Inactive</p>
        </div>
      </div>

      {/* Grade Distribution */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <h2 className="text-xl font-bold text-[var(--ic-heading)] mb-4">Grade Distribution</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <p className="text-blue-400 text-2xl font-bold">{stats.l1}</p>
            <p className="text-gray-400 text-sm">L1 Technicians</p>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-4">
            <p className="text-orange-400 text-2xl font-bold">{stats.l2}</p>
            <p className="text-gray-400 text-sm">L2 Technicians</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-red-400 text-2xl font-bold">{stats.l3}</p>
            <p className="text-gray-400 text-sm">L3 Technicians</p>
          </div>
          <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
            <p className="text-purple-400 text-2xl font-bold">{stats.admin}</p>
            <p className="text-gray-400 text-sm">Admins</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filterGrade}
            onChange={(e) => setFilterGrade(e.target.value)}
            className="bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Grades</option>
            <option value="L1">L1</option>
            <option value="L2">L2</option>
            <option value="L3">L3</option>
            <option value="Admin">Admin</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="pending">Pending</option>
          </select>
        </div>
      </div>

      {/* Technicians Table */}
      <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ic-border)] bg-[var(--ic-surface)]">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Technician</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Email</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Phone</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Grade</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Role</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">MFA</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Services</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold" title="Open / P1 tickets currently assigned — joined live from the ticketing API">Workload</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Last Login</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTechnicians.map((tech) => (
                <tr key={tech.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)]">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-sm font-bold text-[var(--ic-heading)]">
                        {tech.firstName[0]}{tech.lastName[0]}
                      </div>
                      <div>
                        <p className="text-[var(--ic-heading)] font-medium">{tech.firstName} {tech.lastName}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-300">{tech.email}</td>
                  <td className="py-3 px-4 text-gray-300">{tech.phone || '-'}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getGradeColor(tech.grade)}`}>
                      {tech.grade}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-300">{tech.role}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(tech.status)}`}>
                      {tech.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {tech.mfaEnabled ? (
                      <span className="text-green-400 flex items-center gap-1">
                        <Shield className="w-4 h-4" />
                        Enabled
                      </span>
                    ) : (
                      <span className="text-red-400 flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" />
                        Disabled
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-gray-300 text-sm">
                      {tech.assignedServices.includes('all') ? 'All Services' : `${tech.assignedServices.length} services`}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {tech.openTickets == null ? (
                      <span className="text-[var(--ic-muted)] text-xs italic" title="Ticket data could not be loaded — no value is invented">unavailable</span>
                    ) : (
                      <span className="text-sm text-gray-300" title={isDemoMode() ? 'Open/P1 tickets assigned (demo ticket store)' : 'Open/P1 tickets assigned (live from /api/tickets)'}>
                        {tech.openTickets} open{tech.p1Tickets ? <span className="ml-1 text-cyber-red font-semibold">· {tech.p1Tickets} P1</span> : null}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-sm">
                    {tech.lastLogin ? new Date(tech.lastLogin).toLocaleString() : 'Never'}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleEdit(tech)}
                        className="p-1 hover:bg-[var(--ic-surface-2)] rounded text-gray-400 hover:text-[var(--ic-heading)]"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(tech.id)}
                        className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Technician Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--ic-surface)] rounded-xl p-6 max-w-2xl w-full mx-4 border border-[var(--ic-border)] max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-[var(--ic-heading)] mb-6">Add New Technician</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">First Name</label>
                  <input
                    type="text"
                    className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., John"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Last Name</label>
                  <input
                    type="text"
                    className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Doe"
                  />
                </div>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Email</label>
                <input
                  type="email"
                  className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., john.doe@company.com"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Phone</label>
                <input
                  type="tel"
                  className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., +1 (555) 123-4567"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Grade</label>
                  <select className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="L1">L1 - Junior Technician</option>
                    <option value="L2">L2 - Senior Technician</option>
                    <option value="L3">L3 - Expert Technician</option>
                    <option value="Admin">Admin - Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Role</label>
                  <input
                    type="text"
                    className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Security Analyst"
                  />
                </div>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Permissions</label>
                <div className="grid grid-cols-2 gap-2">
                  {['view-alerts', 'edit-alerts', 'view-tickets', 'edit-tickets', 'create-tickets', 'escalate-tickets'].map(perm => (
                    <label key={perm} className="flex items-center gap-2">
                      <input type="checkbox" className="rounded" />
                      <span className="text-gray-300 text-sm">{perm}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Assigned Services</label>
                <div className="grid grid-cols-2 gap-2">
                  {['threat-intel', 'endpoint-protection', 'network-monitoring', 'compliance', 'incident-response'].map(service => (
                    <label key={service} className="flex items-center gap-2">
                      <input type="checkbox" className="rounded" />
                      <span className="text-gray-300 text-sm">{service}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="sendInvite" className="rounded" defaultChecked />
                <label htmlFor="sendInvite" className="text-gray-300">Send invitation email</label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="requireMfa" className="rounded" defaultChecked />
                <label htmlFor="requireMfa" className="text-gray-300">Require MFA</label>
              </div>
              <div className="flex items-center gap-3 pt-4">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-heading)] rounded-lg"
                >
                  Cancel
                </button>
                <button className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--ic-heading)] rounded-lg">
                  Add Technician
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Technician Modal */}
      {showEditModal && selectedTechnician && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--ic-surface)] rounded-xl p-6 max-w-2xl w-full mx-4 border border-[var(--ic-border)] max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-[var(--ic-heading)] mb-6">Edit Technician</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">First Name</label>
                  <input
                    type="text"
                    defaultValue={selectedTechnician.firstName}
                    className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Last Name</label>
                  <input
                    type="text"
                    defaultValue={selectedTechnician.lastName}
                    className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Email</label>
                <input
                  type="email"
                  defaultValue={selectedTechnician.email}
                  className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Phone</label>
                <input
                  type="tel"
                  defaultValue={selectedTechnician.phone || ''}
                  className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Grade</label>
                  <select 
                    defaultValue={selectedTechnician.grade}
                    className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="L1">L1 - Junior Technician</option>
                    <option value="L2">L2 - Senior Technician</option>
                    <option value="L3">L3 - Expert Technician</option>
                    <option value="Admin">Admin - Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Status</label>
                  <select 
                    defaultValue={selectedTechnician.status}
                    className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Role</label>
                <input
                  type="text"
                  defaultValue={selectedTechnician.role}
                  className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Permissions</label>
                <div className="grid grid-cols-2 gap-2">
                  {['view-alerts', 'edit-alerts', 'view-tickets', 'edit-tickets', 'create-tickets', 'escalate-tickets'].map(perm => (
                    <label key={perm} className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        className="rounded" 
                        defaultChecked={selectedTechnician.permissions.includes(perm) || selectedTechnician.permissions.includes('all')}
                      />
                      <span className="text-gray-300 text-sm">{perm}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="editMfa" 
                  className="rounded" 
                  defaultChecked={selectedTechnician.mfaEnabled}
                />
                <label htmlFor="editMfa" className="text-gray-300">Require MFA</label>
              </div>
              <div className="flex items-center gap-3 pt-4">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 px-4 py-2 bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-heading)] rounded-lg"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--ic-heading)] rounded-lg"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
