import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Mail,
  CalendarClock,
  Send,
  Users,
  Search,
  Plus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  RefreshCw,
  LogOut,
  Activity,
  Layers3,
  Link2,
  Menu,
  X,
  Clock3,
  Check,
  SlidersHorizontal,
  ArrowRight,
  ShieldCheck,
  Inbox,
  Info,
  Gauge,
} from 'lucide-react';
import { api, ApiError, setCsrf } from './api';
import type { Session, SenderList, Overview, EmailList, Email, SlackConnection } from './types';
import { dateLabel, timeLabel, initials } from './lib/leads';
import {
  Button,
  Logo,
  StatusBadge,
  EmptyState,
  ErrorBox,
  SkeletonRows,
  SlackLogo,
  Modal,
} from './components/ui';
import { Login } from './components/Login';
import { Compose } from './components/Compose';
import { SendersPage, AddSender } from './components/Senders';
import { Integrations } from './components/Integrations';
import { EmailDetails } from './components/EmailDetails';

type Page = 'overview' | 'senders' | 'integrations';
const number = (value?: number) => new Intl.NumberFormat().format(value ?? 0);
export default function App() {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        const result = await api<Session>('/auth/me');
        setCsrf(result.csrfToken);
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setCsrf('');
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 60000,
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    const error = url.searchParams.get('error');
    if (error) {
      toast.error(
        error === 'google_failed'
          ? 'Google sign-in wasn’t completed. Please try again.'
          : 'Slack connection wasn’t completed. Please try again.',
      );
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url);
    }
    if (url.searchParams.get('slack') === 'connected') {
      toast.success('Slack connected', {
        description: 'Rate-limit notifications will arrive in your selected channel.',
      });
      url.searchParams.delete('slack');
      window.history.replaceState({}, '', url);
    }
  }, []);
  if (session.isLoading)
    return (
      <div className="app-loading">
        <Logo />
        <span className="loading-line" />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!session.data) return <Login />;
  return <Workspace session={session.data} />;
}
function Workspace({ session }: { session: Session }) {
  const [page, setPage] = useState<Page>(
    new URLSearchParams(window.location.search).get('view') === 'integrations'
      ? 'integrations'
      : 'overview',
  );
  const [tab, setTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [compose, setCompose] = useState(false);
  const [addSender, setAddSender] = useState(false);
  const [details, setDetails] = useState<Email | null>(null);
  const [guide, setGuide] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [live, setLive] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const client = useQueryClient();
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/overview'),
    refetchInterval: 5000,
  });
  const senders = useQuery({
    queryKey: ['senders'],
    queryFn: () => api<SenderList>('/senders'),
    refetchInterval: 10000,
  });
  const slack = useQuery({
    queryKey: ['slack'],
    queryFn: () => api<SlackConnection>('/integrations/slack'),
    staleTime: 30000,
  });
  const emails = useQuery({
    queryKey: ['emails', tab, debounced, status, currentPage],
    queryFn: () =>
      api<EmailList>(
        `/emails?${new URLSearchParams({ view: tab, q: debounced, status, page: String(currentPage), pageSize: '15' })}`,
      ),
    enabled: page === 'overview',
    refetchInterval: 5000,
  });
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: async () => {
      await client.cancelQueries();
      setCsrf('');
      client.setQueryData(['session'], null);
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
    },
    onError: (error) => toast.error(error.message),
  });
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const events = new EventSource('/api/events', { withCredentials: true });
    events.addEventListener('ready', () => setLive(true));
    events.addEventListener('change', () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        void client.invalidateQueries({ queryKey: ['emails'] });
        void client.invalidateQueries({ queryKey: ['overview'] });
        void client.invalidateQueries({ queryKey: ['senders'] });
        void client.invalidateQueries({ queryKey: ['notifications'] });
      }, 500);
    });
    events.onerror = () => setLive(false);
    return () => {
      events.close();
      clearTimeout(pending);
    };
  }, [client]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName) ||
        event.metaKey ||
        event.ctrlKey ||
        compose ||
        addSender ||
        details ||
        guide
      )
        return;
      if (event.key.toLowerCase() === 'c') setCompose(true);
      if (event.key === '/' && page === 'overview') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [page, compose, addSender, details, guide]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: MouseEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [menu]);
  useEffect(() => {
    if ([overview.error, emails.error].some((e) => e instanceof ApiError && e.status === 401)) {
      void client.invalidateQueries({ queryKey: ['session'] });
    }
  }, [overview.error, emails.error, client]);
  const stats = overview.data;
  const resolved = (stats?.sent ?? 0) + (stats?.failed ?? 0) + (stats?.uncertain ?? 0);
  const success = resolved ? Math.round(((stats?.sent ?? 0) / resolved) * 100) : null;
  function navigate(next: Page) {
    setPage(next);
    setMobileNav(false);
  }
  function switchTab(next: 'scheduled' | 'sent') {
    setTab(next);
    setCurrentPage(1);
    setStatus('all');
  }
  const terminalCount =
    (stats?.sent ?? 0) + (stats?.failed ?? 0) + (stats?.uncertain ?? 0) + (stats?.cancelled ?? 0);
  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <Logo />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-label">
          <span className="workspace-avatar">{initials(session.user.name)}</span>
          <div>
            <strong>My workspace</strong>
            <span>Outreach, made thoughtful</span>
          </div>
          <span className="workspace-dot" />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          <button
            className={`nav-item ${page === 'overview' ? 'active' : ''}`}
            onClick={() => navigate('overview')}
          >
            <Inbox size={19} />
            <span>Email overview</span>
            {(stats?.scheduled ?? 0) > 0 && <b>{number(stats?.scheduled)}</b>}
          </button>
          <button
            className={`nav-item ${page === 'senders' ? 'active' : ''}`}
            onClick={() => navigate('senders')}
          >
            <Users size={19} />
            <span>Sender accounts</span>
          </button>
          <button
            className={`nav-item ${page === 'integrations' ? 'active' : ''}`}
            onClick={() => navigate('integrations')}
          >
            <Link2 size={19} />
            <span>Integrations</span>
            {slack.data?.connected && <i className="nav-connected" />}
          </button>
        </nav>
        <span className="nav-label tools-label">TOOLS & VISIBILITY</span>
        <nav aria-label="Tools">
          {session.queueAdmin && (
            <a className="nav-item" href="/admin/queues" target="_blank" rel="noreferrer">
              <Activity size={19} />
              <span>Queue dashboard</span>
              <ArrowUpRight size={14} className="nav-external" />
            </a>
          )}
          <button className="nav-item" onClick={() => setGuide(true)}>
            <ShieldCheck size={19} />
            <span>Sending rules</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="sidebar-note-icon">
              <Mail size={21} />
            </span>
            <h4>
              A little less busywork.
              <br />A little more connection.
            </h4>
            <p>Your outreach, in good hands.</p>
            <button onClick={() => setCompose(true)}>
              Start a conversation <ArrowRight size={14} />
            </button>
          </div>
          <div className="sidebar-system">
            <span className={stats?.workerOnline ? 'tiny-dot' : 'tiny-dot amber-dot'} />
            {stats?.workerOnline ? 'Delivery engine online' : 'Waiting for delivery engine'}
            <span className="system-short">v1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <button
              className="icon-button mobile-only"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb-icon">
              <Layers3 size={17} />
            </span>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {page === 'overview'
                ? 'Email scheduler'
                : page === 'senders'
                  ? 'Sender accounts'
                  : 'Integrations'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className={`sync-status ${live ? '' : 'sync-polling'}`}>
              <span className="tiny-dot" />
              {live ? 'Live updates' : 'Auto-refreshing'}
            </span>
            <span className="topbar-divider" />
            <div className="profile" ref={profileRef}>
              <button
                className="profile-button"
                onClick={() => setMenu((v) => !v)}
                aria-label="Open account menu"
                aria-expanded={menu}
              >
                {session.user.avatar ? (
                  <img src={session.user.avatar} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="user-avatar">{initials(session.user.name)}</span>
                )}
                <span>
                  <strong>{session.user.name}</strong>
                  <small>{session.user.email}</small>
                </span>
                <ChevronDown size={14} />
              </button>
              {menu && (
                <div className="profile-menu">
                  <span>Signed in as</span>
                  <strong>{session.user.email}</strong>
                  <Button variant="ghost" onClick={() => logout.mutate()} busy={logout.isPending}>
                    <LogOut size={15} />
                    Log out
                  </Button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="main-content">
          {overview.isError && (
            <ErrorBox message={overview.error.message} onRetry={() => void overview.refetch()} />
          )}
          {stats && !stats.workerOnline && (
            <div className="warning-banner">
              <Info size={17} />
              <span>Your emails are saved. Start the worker to resume delivery.</span>
            </div>
          )}
          {page === 'overview' ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">GOOD TIMING. GREAT CONVERSATIONS.</div>
                  <h1>
                    Email overview<span className="title-dot">.</span>
                  </h1>
                  <p>Every conversation, right on time.</p>
                </div>
                <div className="heading-actions">
                  <span className="today-label">
                    <CalendarClock size={15} />
                    {new Date().toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                  <Button onClick={() => setCompose(true)}>
                    <Plus size={17} />
                    Compose new email<span className="keyboard-hint">C</span>
                  </Button>
                </div>
              </div>
              <section className="metrics" aria-label="Email statistics">
                <Metric
                  label="Scheduled emails"
                  value={overview.isLoading ? '—' : number(stats?.scheduled)}
                  icon={<CalendarClock size={20} />}
                  tone="purple"
                  detail="Waiting for their moment"
                />
                <Metric
                  label="Sent today"
                  value={overview.isLoading ? '—' : number(stats?.sentToday)}
                  icon={<Send size={20} />}
                  tone="green"
                  detail={`Accepted by SMTP · ${number(stats?.sent)} all time`}
                  tag="UTC"
                />
                <Metric
                  label="Delivery success"
                  value={success === null ? '—' : `${success}%`}
                  icon={<Check size={20} />}
                  tone="blue"
                  detail={
                    resolved
                      ? `${number(resolved)} resolved deliveries`
                      : 'Your first send starts the story'
                  }
                />
                <Metric
                  label="Active senders"
                  value={senders.isLoading ? '—' : number(senders.data?.data.length)}
                  icon={<Users size={20} />}
                  tone="orange"
                  detail="Each with a thoughtful sending pace"
                />
              </section>
              <section className="panel email-panel" aria-label="Emails">
                <div className="email-panel-top">
                  <div className="tabs" role="tablist" aria-label="Email views">
                    <button
                      role="tab"
                      aria-selected={tab === 'scheduled'}
                      className={tab === 'scheduled' ? 'active' : ''}
                      onClick={() => switchTab('scheduled')}
                    >
                      <CalendarClock size={17} />
                      Scheduled emails<span>{number(stats?.scheduled)}</span>
                    </button>
                    <button
                      role="tab"
                      aria-selected={tab === 'sent'}
                      className={tab === 'sent' ? 'active' : ''}
                      onClick={() => switchTab('sent')}
                    >
                      <Send size={17} />
                      Sent & history<span>{number(terminalCount)}</span>
                    </button>
                  </div>
                  <span className="table-timezone">
                    <Clock3 size={13} />
                    Times in your timezone
                  </span>
                </div>
                <div className="table-toolbar">
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      ref={searchRef}
                      aria-label="Search emails"
                      placeholder="Search recipients, subjects, or messages…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search ? (
                      <button aria-label="Clear search" onClick={() => setSearch('')}>
                        <X size={14} />
                      </button>
                    ) : (
                      <kbd>/</kbd>
                    )}
                  </div>
                  <div className="toolbar-right">
                    <label className="status-filter">
                      <SlidersHorizontal size={15} />
                      <span className="sr-only">Filter by status</span>
                      <select
                        value={status}
                        onChange={(e) => {
                          setStatus(e.target.value);
                          setCurrentPage(1);
                        }}
                      >
                        <option value="all">All statuses</option>
                        {(tab === 'scheduled'
                          ? [
                              ['scheduled', 'Scheduled'],
                              ['deferred', 'Rate limited'],
                              ['sending', 'Sending'],
                            ]
                          : [
                              ['sent', 'Sent'],
                              ['failed', 'Failed'],
                              ['delivery_unknown', 'Uncertain'],
                              ['cancelled', 'Cancelled'],
                            ]
                        ).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} />
                    </label>
                    <button
                      className="icon-button refresh-button"
                      aria-label="Refresh emails"
                      onClick={() => {
                        void emails.refetch();
                        void overview.refetch();
                      }}
                      disabled={emails.isFetching}
                    >
                      <RefreshCw size={16} className={emails.isFetching ? 'animate-spin' : ''} />
                    </button>
                  </div>
                </div>
                {debounced && (
                  <div className="search-engine-note">
                    <Search size={12} />
                    Search powered by Elasticsearch<span>Index updates may take a moment.</span>
                  </div>
                )}
                {emails.isError ? (
                  <div className="table-error">
                    <ErrorBox
                      message={emails.error.message}
                      onRetry={() => void emails.refetch()}
                    />
                  </div>
                ) : emails.isLoading ? (
                  <SkeletonRows />
                ) : emails.data?.data.length ? (
                  <div
                    className="table-scroll"
                    role="region"
                    tabIndex={0}
                    aria-label="Email results; scroll horizontally for all columns"
                  >
                    <table className="email-table">
                      <thead>
                        <tr>
                          <th>RECIPIENT</th>
                          <th>SUBJECT</th>
                          <th>SENDER</th>
                          <th>{tab === 'scheduled' ? 'SCHEDULED FOR' : 'SENT / UPDATED'}</th>
                          <th>STATUS</th>
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {emails.data.data.map((email, i) => (
                          <tr key={email.id}>
                            <td>
                              <button className="recipient-cell" onClick={() => setDetails(email)}>
                                <span className={`recipient-avatar tone-${i % 4}`}>
                                  {initials(email.recipient)}
                                </span>
                                <span>
                                  <strong>{email.recipient}</strong>
                                  <small>Individual email</small>
                                </span>
                              </button>
                            </td>
                            <td>
                              <button className="subject-cell" onClick={() => setDetails(email)}>
                                <strong>{email.subject}</strong>
                                <span>{email.body.replace(/\n/g, ' ')}</span>
                              </button>
                            </td>
                            <td>
                              <span className="table-sender" title={email.senderEmail}>
                                <span className="sender-small-dot" />
                                {email.senderName}
                              </span>
                            </td>
                            <td>
                              <span className="table-date">
                                {dateLabel(
                                  tab === 'scheduled'
                                    ? email.scheduledAt
                                    : email.sentAt || email.updatedAt,
                                )}
                              </span>
                              <span className="table-time">
                                {timeLabel(
                                  tab === 'scheduled'
                                    ? email.scheduledAt
                                    : email.sentAt || email.updatedAt,
                                )}
                              </span>
                            </td>
                            <td>
                              <StatusBadge status={email.status} />
                            </td>
                            <td>
                              <button
                                className="row-action"
                                aria-label={`View email to ${email.recipient}`}
                                onClick={() => setDetails(email)}
                              >
                                <ArrowUpRight size={17} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    title={
                      debounced || status !== 'all'
                        ? 'No conversations match just yet.'
                        : tab === 'scheduled'
                          ? 'Your next conversation starts here.'
                          : 'Good things are on their way.'
                    }
                    description={
                      debounced || status !== 'all'
                        ? 'Try another search or clear your filters to see more emails.'
                        : tab === 'scheduled'
                          ? 'Compose your first email, pick the right moment, and let us take care of the rest.'
                          : 'Sent emails and delivery updates will appear here as your queue gets to work.'
                    }
                    action={
                      debounced || status !== 'all' ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSearch('');
                            setStatus('all');
                          }}
                        >
                          Clear filters
                        </Button>
                      ) : tab === 'scheduled' ? (
                        <Button onClick={() => setCompose(true)}>
                          <Plus size={16} />
                          Compose your first email
                        </Button>
                      ) : (
                        <Button variant="secondary" onClick={() => switchTab('scheduled')}>
                          View scheduled emails <ArrowRight size={15} />
                        </Button>
                      )
                    }
                  />
                )}
                {!emails.isError && (
                  <div className="table-footer">
                    <span>
                      {emails.data?.total
                        ? `Showing ${(currentPage - 1) * 15 + 1}–${Math.min(currentPage * 15, emails.data.total)} of ${number(emails.data.total)} emails`
                        : 'A little quiet here. Plenty of possibility.'}
                    </span>
                    <div>
                      <Button
                        variant="ghost"
                        disabled={currentPage === 1 || emails.isFetching}
                        onClick={() => setCurrentPage((p) => p - 1)}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={16} />
                      </Button>
                      <span>
                        {currentPage}{' '}
                        <span>/ {Math.max(1, Math.ceil((emails.data?.total ?? 0) / 15))}</span>
                      </span>
                      <Button
                        variant="ghost"
                        disabled={
                          currentPage * 15 >= (emails.data?.total ?? 0) || emails.isFetching
                        }
                        onClick={() => setCurrentPage((p) => p + 1)}
                        aria-label="Next page"
                      >
                        <ChevronRight size={16} />
                      </Button>
                    </div>
                  </div>
                )}
              </section>
              <div className="bottom-grid">
                <section className="journey-card">
                  <div className="section-title">
                    <span className="section-icon">
                      <Layers3 size={19} />
                    </span>
                    <div>
                      <h3>From a thought to an inbox.</h3>
                      <p>A reliable little journey for every message.</p>
                    </div>
                  </div>
                  <div className="journey-steps">
                    <div>
                      <span>
                        <CalendarClock size={17} />
                      </span>
                      <strong>Pick your moment</strong>
                      <p>Set it once. Your schedule is saved.</p>
                    </div>
                    <i />
                    <div>
                      <span>
                        <Gauge size={17} />
                      </span>
                      <strong>Find your pace</strong>
                      <p>Thoughtful delays, shared limits.</p>
                    </div>
                    <i />
                    <div>
                      <span>
                        <Send size={17} />
                      </span>
                      <strong>Make a connection</strong>
                      <p>Delivered, with a clear paper trail.</p>
                    </div>
                  </div>
                </section>
                <section className="slack-nudge">
                  <span className="slack-nudge-logo">
                    <SlackLogo size={29} />
                  </span>
                  <div>
                    <h3>A timely heads-up.</h3>
                    <p>
                      {slack.data?.connected
                        ? `Connected to ${slack.data.connection?.teamName}. We’ll keep you in the loop.`
                        : 'Know when a sender hits its limit. Get notified right in Slack.'}
                    </p>
                    <button onClick={() => navigate('integrations')}>
                      {slack.data?.connected ? 'Manage connection' : 'Explore Slack integration'}
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                </section>
              </div>
            </>
          ) : page === 'senders' ? (
            <>
              {senders.isLoading ? (
                <div className="panel">
                  <SkeletonRows />
                </div>
              ) : senders.isError ? (
                <ErrorBox message={senders.error.message} onRetry={() => void senders.refetch()} />
              ) : (
                <SendersPage senders={senders.data?.data ?? []} onAdd={() => setAddSender(true)} />
              )}
            </>
          ) : (
            <Integrations session={session} />
          )}
          <footer className="workspace-footer">
            <span>Made for meaningful outreach.</span>
            <span>
              <ShieldCheck size={13} />
              Ethereal testing environment<span className="footer-dot">·</span>ReachInbox Scheduler
            </span>
          </footer>
        </main>
      </div>
      {compose && (
        <Compose
          senders={senders.data?.data ?? []}
          overview={stats}
          onClose={() => setCompose(false)}
          onAddSender={() => {
            setCompose(false);
            setAddSender(true);
          }}
        />
      )}
      {addSender && <AddSender onClose={() => setAddSender(false)} />}
      {details && <EmailDetails email={details} onClose={() => setDetails(null)} />}
      {guide && (
        <Modal title="Sending, thoughtfully" onClose={() => setGuide(false)}>
          <div className="modal-content sending-guide">
            <div>
              <Clock3 size={21} />
              <h3>A steady pace</h3>
              <p>
                At least {(stats?.minDelayMs ?? 2000) / 1000} seconds between deliveries from the
                same sender, across all workers. A sender has only one delivery in progress at a
                time.
              </p>
            </div>
            <div>
              <Gauge size={21} />
              <h3>An allowance for every sender</h3>
              <p>
                The server allows up to {stats?.hourlyLimit ?? 200} send attempts per sender per UTC
                hour. Campaigns can choose a lower cap. Throttled jobs wait for the next window.
              </p>
            </div>
            <div>
              <ShieldCheck size={21} />
              <h3>A record that survives restarts</h3>
              <p>
                Schedules are saved before queueing. Sent messages are never automatically resent.
                If SMTP’s outcome is uncertain, the message is flagged for review.
              </p>
            </div>
            <div>
              <Info size={21} />
              <h3>Local times, universal schedules</h3>
              <p>
                You choose times in {Intl.DateTimeFormat().resolvedOptions().timeZone}. We store
                them in UTC and show them in your timezone. “Sent today” uses the current UTC day.
              </p>
            </div>
          </div>
          <footer className="modal-footer">
            <Button onClick={() => setGuide(false)}>
              Got it <Check size={15} />
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  icon,
  tone,
  detail,
  tag,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: string;
  detail: string;
  tag?: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <span className={`metric-icon metric-${tone}`}>{icon}</span>
      </div>
      <div className="metric-value">
        {value}
        {tag && <span className="metric-tag">{tag}</span>}
      </div>
      <p>
        <span className={`metric-dot metric-${tone}`} />
        {detail}
      </p>
    </article>
  );
}
