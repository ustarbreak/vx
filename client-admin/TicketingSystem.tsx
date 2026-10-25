import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Ticket, Plus, Filter, Search, AlertTriangle, CheckCircle, 
  Clock, User, Users, ChevronDown, MessageSquare, Paperclip,
  ArrowUp, ArrowRight, X, Server
} from 'lucide-react';

interface Ticket {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  assignedTo?: string;
  assignedGrade?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  dueDate?: string;
  escalationLevel: number;
  tags: string[];
  comments: number;
  attachments: number;
  source: 'manual' | 'automated' | 'alert';
  relatedAlert?: string;
  relatedDevice?: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  grade: 'L1' | 'L2' | 'L3' | 'Admin';
  role: string;
  avatar?: string;
}

export default function TicketingSystem() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  useEffect(() => {
    // Simulate API call
    const fetchData = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Mock users
        const mockUsers: User[] = [
          { id: '1', name: 'Sarah Chen', email: 'sarah.chen@infracentracorp.io', grade: 'Admin', role: 'Client Admin' },
          { id: '2', name: 'Marcus Johnson', email: 'marcus.j@infracentracorp.io', grade: 'L1', role: 'Technician' },
          { id: '3', name: 'Alex Rivera', email: 'alex.r@infracentracorp.io', grade: 'L2', role: 'Senior Technician' },
          { id: '4', name: 'Jordan Kim', email: 'jordan@techstart.io', grade: 'L1', role: 'Technician' },
          { id: '5', name: 'Sam Ortiz', email: 'sam@techstart.io', grade: 'L3', role: 'Expert Technician' },
        ];

        // Mock tickets
        const mockTickets: Ticket[] = [
          {
            id: 'TKT-001',
            title: 'High CPU usage on server-db-01',
            description: 'Database server experiencing high CPU usage (>90%) for the past 2 hours. Performance degradation affecting applications.',
            status: 'in_progress',
            priority: 'high',
            category: 'Performance',
            assignedTo: 'Alex Rivera',
            assignedGrade: 'L2',
            createdBy: 'System Alert',
            createdAt: '2027-01-15T08:30:00Z',
            updatedAt: '2027-01-15T09:15:00Z',
            dueDate: '2027-01-15T12:00:00Z',
            escalationLevel: 1,
            tags: ['cpu', 'performance', 'database'],
            comments: 5,
            attachments: 2,
            source: 'alert',
            relatedAlert: 'ALT-123',
            relatedDevice: 'server-db-01',
          },
          {
            id: 'TKT-002',
            title: 'Network switch offline in Building B',
            description: 'Core switch in Building B floor 2 is offline. Multiple users affected.',
            status: 'open',
            priority: 'critical',
            category: 'Network',
            assignedTo: 'Sam Ortiz',
            assignedGrade: 'L3',
            createdBy: 'Zabbix Alert',
            createdAt: '2027-01-15T09:00:00Z',
            updatedAt: '2027-01-15T09:00:00Z',
            dueDate: '2027-01-15T10:00:00Z',
            escalationLevel: 0,
            tags: ['network', 'switch', 'offline'],
            comments: 2,
            attachments: 1,
            source: 'alert',
            relatedAlert: 'ALT-124',
            relatedDevice: 'switch-b-floor2',
          },
          {
            id: 'TKT-003',
            title: 'Request for new user account',
            description: 'Need to create a new user account for John Doe in the marketing department.',
            status: 'pending',
            priority: 'medium',
            category: 'User Management',
            assignedTo: 'Marcus Johnson',
            assignedGrade: 'L1',
            createdBy: 'Sarah Chen',
            createdAt: '2027-01-14T14:00:00Z',
            updatedAt: '2027-01-14T16:30:00Z',
            escalationLevel: 0,
            tags: ['user', 'account', 'marketing'],
            comments: 3,
            attachments: 0,
            source: 'manual',
          },
          {
            id: 'TKT-004',
            title: 'Backup failure on storage-server-01',
            description: 'Nightly backup job failed with error code 0x80070005. Access denied.',
            status: 'resolved',
            priority: 'high',
            category: 'Backup',
            assignedTo: 'Alex Rivera',
            assignedGrade: 'L2',
            createdBy: 'System Alert',
            createdAt: '2027-01-14T06:00:00Z',
            updatedAt: '2027-01-14T10:30:00Z',
            escalationLevel: 0,
            tags: ['backup', 'storage', 'error'],
            comments: 8,
            attachments: 3,
            source: 'alert',
            relatedAlert: 'ALT-120',
            relatedDevice: 'storage-server-01',
          },
          {
            id: 'TKT-005',
            title: 'SSL certificate expiring soon',
            description: 'SSL certificate for api.infracentra.io expires in 7 days. Needs renewal.',
            status: 'open',
            priority: 'medium',
            category: 'Security',
            createdBy: 'System Alert',
            createdAt: '2027-01-15T00:00:00Z',
            updatedAt: '2027-01-15T00:00:00Z',
            dueDate: '2027-01-22T00:00:00Z',
            escalationLevel: 0,
            tags: ['ssl', 'certificate', 'security'],
            comments: 0,
            attachments: 0,
            source: 'automated',
          },
        ];

        setUsers(mockUsers);
        setTickets(mockTickets);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch data:', error);
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const filteredTickets = tickets.filter(ticket => {
    const matchesFilter = filter === 'all' || ticket.status === filter;
    const matchesSearch = ticket.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         ticket.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         ticket.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const stats = {
    total: tickets.length,
    open: tickets.filter(t => t.status === 'open').length,
    inProgress: tickets.filter(t => t.status === 'in_progress').length,
    pending: tickets.filter(t => t.status === 'pending').length,
    resolved: tickets.filter(t => t.status === 'resolved').length,
    critical: tickets.filter(t => t.priority === 'critical').length,
    high: tickets.filter(t => t.priority === 'high').length,
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'in_progress': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'pending': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'resolved': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'closed': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'low': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'Admin': return 'bg-purple-500/20 text-purple-400';
      case 'L3': return 'bg-red-500/20 text-red-400';
      case 'L2': return 'bg-orange-500/20 text-orange-400';
      case 'L1': return 'bg-blue-500/20 text-blue-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading tickets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Ticket Management</h1>
          <p className="text-gray-400 mt-1">
            Manage support tickets, incidents, and service requests
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Create Ticket
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Ticket className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-white">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Tickets</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-6 h-6 text-yellow-400" />
            <span className="text-2xl font-bold text-white">{stats.open + stats.inProgress}</span>
          </div>
          <p className="text-gray-400 text-sm">Active Tickets</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-white">{stats.critical + stats.high}</span>
          </div>
          <p className="text-gray-400 text-sm">High Priority</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-white">{stats.resolved}</span>
          </div>
          <p className="text-gray-400 text-sm">Resolved</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search tickets..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-800 text-white rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {/* Tickets List */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Ticket ID</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Title</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Priority</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Assigned To</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Created</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Source</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.map((ticket) => (
                <tr 
                  key={ticket.id} 
                  className="border-b border-slate-800 hover:bg-slate-800 cursor-pointer transition-colors"
                  onClick={() => setSelectedTicket(ticket)}
                >
                  <td className="py-3 px-4">
                    <span className="text-blue-400 font-mono font-semibold">{ticket.id}</span>
                  </td>
                  <td className="py-3 px-4">
                    <div>
                      <p className="text-white font-medium">{ticket.title}</p>
                      <p className="text-gray-400 text-sm line-clamp-1">{ticket.description}</p>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(ticket.status)}`}>
                      {ticket.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getPriorityColor(ticket.priority)}`}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {ticket.assignedTo ? (
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-xs font-bold text-white">
                          {ticket.assignedTo.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <p className="text-white text-sm">{ticket.assignedTo}</p>
                          <span className={`px-1.5 py-0.5 rounded text-xs ${getGradeColor(ticket.assignedGrade || '')}`}>
                            {ticket.assignedGrade}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-500">Unassigned</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-sm">
                    {new Date(ticket.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded text-xs ${
                      ticket.source === 'alert' ? 'bg-red-500/20 text-red-400' :
                      ticket.source === 'automated' ? 'bg-purple-500/20 text-purple-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {ticket.source}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <button className="p-1 hover:bg-slate-700 rounded text-gray-400 hover:text-white">
                        <MessageSquare className="w-4 h-4" />
                      </button>
                      <button className="p-1 hover:bg-slate-700 rounded text-gray-400 hover:text-white">
                        <Paperclip className="w-4 h-4" />
                      </button>
                      {ticket.escalationLevel > 0 && (
                        <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">
                          L{ticket.escalationLevel}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ticket Detail Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-slate-700">
            <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-6 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-white">{selectedTicket.id}</h2>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(selectedTicket.status)}`}>
                    {selectedTicket.status.replace('_', ' ')}
                  </span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getPriorityColor(selectedTicket.priority)}`}>
                    {selectedTicket.priority}
                  </span>
                </div>
                <p className="text-gray-400 mt-1">{selectedTicket.title}</p>
              </div>
              <button
                onClick={() => setSelectedTicket(null)}
                className="p-2 hover:bg-slate-800 rounded-lg text-gray-400 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Description */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">Description</h3>
                <p className="text-gray-300">{selectedTicket.description}</p>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-800 rounded-lg p-4">
                  <p className="text-gray-400 text-sm mb-1">Category</p>
                  <p className="text-white">{selectedTicket.category}</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-4">
                  <p className="text-gray-400 text-sm mb-1">Created By</p>
                  <p className="text-white">{selectedTicket.createdBy}</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-4">
                  <p className="text-gray-400 text-sm mb-1">Created At</p>
                  <p className="text-white">{new Date(selectedTicket.createdAt).toLocaleString()}</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-4">
                  <p className="text-gray-400 text-sm mb-1">Last Updated</p>
                  <p className="text-white">{new Date(selectedTicket.updatedAt).toLocaleString()}</p>
                </div>
                {selectedTicket.dueDate && (
                  <div className="bg-slate-800 rounded-lg p-4">
                    <p className="text-gray-400 text-sm mb-1">Due Date</p>
                    <p className="text-white">{new Date(selectedTicket.dueDate).toLocaleString()}</p>
                  </div>
                )}
                <div className="bg-slate-800 rounded-lg p-4">
                  <p className="text-gray-400 text-sm mb-1">Escalation Level</p>
                  <p className="text-white">Level {selectedTicket.escalationLevel}</p>
                </div>
              </div>

              {/* Assignment */}
              <div className="bg-slate-800 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-white mb-3">Assignment</h3>
                {selectedTicket.assignedTo ? (
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-sm font-bold text-white">
                      {selectedTicket.assignedTo.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <p className="text-white font-medium">{selectedTicket.assignedTo}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`px-2 py-0.5 rounded text-xs ${getGradeColor(selectedTicket.assignedGrade || '')}`}>
                          {selectedTicket.assignedGrade}
                        </span>
                        <span className="text-gray-400 text-sm">
                          {users.find(u => u.name === selectedTicket.assignedTo)?.role}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-400">Not assigned</p>
                )}
              </div>

              {/* Related Items */}
              {(selectedTicket.relatedAlert || selectedTicket.relatedDevice) && (
                <div className="bg-slate-800 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-3">Related Items</h3>
                  <div className="space-y-2">
                    {selectedTicket.relatedAlert && (
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-yellow-400" />
                        <span className="text-gray-400">Alert:</span>
                        <button 
                          onClick={() => navigate(`/client-admin/alerts/${selectedTicket.relatedAlert}`)}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          {selectedTicket.relatedAlert}
                        </button>
                      </div>
                    )}
                    {selectedTicket.relatedDevice && (
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-blue-400" />
                        <span className="text-gray-400">Device:</span>
                        <button 
                          onClick={() => navigate(`/client-admin/infrastructure/device/${selectedTicket.relatedDevice}`)}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          {selectedTicket.relatedDevice}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tags */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-3">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedTicket.tags.map((tag, idx) => (
                    <span key={idx} className="px-3 py-1 bg-slate-800 text-gray-300 rounded-full text-sm">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-4 border-t border-slate-700">
                <button className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                  Edit Ticket
                </button>
                <button className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg">
                  Resolve
                </button>
                <button className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg flex items-center justify-center gap-2">
                  <ArrowUp className="w-4 h-4" />
                  Escalate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Ticket Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-700">
            <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">Create New Ticket</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-2 hover:bg-slate-800 rounded-lg text-gray-400 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">Title</label>
                <input
                  type="text"
                  className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter ticket title"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">Description</label>
                <textarea
                  rows={4}
                  className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Describe the issue..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Priority</label>
                  <select className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Category</label>
                  <select className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="Performance">Performance</option>
                    <option value="Network">Network</option>
                    <option value="Security">Security</option>
                    <option value="Backup">Backup</option>
                    <option value="User Management">User Management</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">Assign To</label>
                <select className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Unassigned</option>
                  {users.map(user => (
                    <option key={user.id} value={user.name}>
                      {user.name} ({user.grade}) - {user.role}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">Due Date</label>
                <input
                  type="datetime-local"
                  className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">Tags</label>
                <input
                  type="text"
                  className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter tags separated by commas"
                />
              </div>

              <div className="flex items-center gap-3 pt-4">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
                >
                  Cancel
                </button>
                <button className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                  Create Ticket
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
