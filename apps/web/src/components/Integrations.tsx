import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Unplug,
  Check,
  Activity,
  Database,
  Layers3,
  Search,
  Link2,
  Info,
  Bell,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api';
import type { Health, SlackConnection, Notification, Session } from '../types';
import { dateLabel, timeLabel } from '../lib/leads';
import { Button, SlackLogo, ErrorBox } from './ui';

export function Integrations({ session }: { session: Session }) {
  const client = useQueryClient();
  const [setup, setSetup] = useState(false);
  const [confirmDisconnect, setConfirm] = useState(false);
  const slack = useQuery({
    queryKey: ['slack'],
    queryFn: () => api<SlackConnection>('/integrations/slack'),
    refetchInterval: 15000,
  });
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
    refetchInterval: 15000,
  });
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ data: Notification[] }>('/notifications'),
    refetchInterval: 5000,
  });
  const disconnect = useMutation({
    mutationFn: () => api('/integrations/slack', { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['slack'] });
      toast.success('Slack disconnected');
      setConfirm(false);
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A CONNECTED WORKSPACE</div>
          <h1>
            Better, together<span className="title-dot">.</span>
          </h1>
          <p>Timely heads-ups. A clear view under the hood.</p>
        </div>
      </div>
      <div className="integration-grid">
        <article className="integration-card slack-card">
          <div className="integration-card-top">
            <span className="integration-logo">
              <SlackLogo size={36} />
            </span>
            <span className={`small-pill ${slack.data?.connected ? 'connected-pill' : ''}`}>
              {slack.data?.connected ? (
                <>
                  <Check size={12} />
                  Connected
                </>
              ) : slack.data?.configured ? (
                'Not connected'
              ) : (
                'Setup needed'
              )}
            </span>
          </div>
          <h2>A heads-up, right where you work.</h2>
          <p>
            Connect Slack to get a live notification as soon as a sender reaches its hourly
            allowance. Your emails stay safely queued.
          </p>
          {slack.isError && (
            <ErrorBox message={slack.error.message} onRetry={() => void slack.refetch()} />
          )}
          {slack.data?.connected && (
            <div className="connected-workspace">
              <SlackLogo size={22} />
              <div>
                <strong>{slack.data.connection?.teamName}</strong>
                <span>{slack.data.connection?.channelName}</span>
              </div>
              <span className="tiny-dot" />
            </div>
          )}
          <div className="integration-actions">
            {slack.data?.connected ? (
              confirmDisconnect ? (
                <>
                  <span className="confirm-copy">Disconnect this workspace?</span>
                  <Button
                    variant="danger"
                    busy={disconnect.isPending}
                    onClick={() => disconnect.mutate()}
                  >
                    Disconnect
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirm(false)}>
                    Keep connected
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setConfirm(true)}>
                    <Unplug size={15} />
                    Disconnect
                  </Button>
                  <a className="text-link" href="/api/integrations/slack/connect">
                    Reconnect <ArrowUpRight size={14} />
                  </a>
                </>
              )
            ) : (
              <>
                <Button
                  disabled={!slack.data?.configured || slack.isLoading}
                  onClick={() => {
                    window.location.href = '/api/integrations/slack/connect';
                  }}
                >
                  <Link2 size={16} />
                  Connect Slack
                  <ArrowUpRight size={16} />
                </Button>
                {!slack.data?.configured && (
                  <button className="text-link" onClick={() => setSetup((v) => !v)}>
                    Setup guide <ChevronDown size={14} />
                  </button>
                )}
              </>
            )}
          </div>
          {setup && (
            <div className="oauth-guide">
              <strong>Enable a real Slack connection</strong>
              <ol>
                <li>
                  Create an app at{' '}
                  <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">
                    Slack Apps ↗
                  </a>
                  . Enable Incoming Webhooks.
                </li>
                <li>
                  Add the OAuth scope <code>incoming-webhook</code>.
                </li>
                <li>
                  Add this redirect URI:{' '}
                  <code>http://localhost:4000/api/integrations/slack/callback</code>.
                </li>
                <li>
                  Set <code>SLACK_CLIENT_ID</code> and <code>SLACK_CLIENT_SECRET</code> in{' '}
                  <code>.env</code>, then restart the API.
                </li>
                <li>Click Connect Slack and approve the workspace and notification channel.</li>
              </ol>
            </div>
          )}
          <div className="integration-card-foot">
            <Info size={14} />
            One notification per sender, per UTC hour. Reconnect anytime.
          </div>
        </article>
        <article className="integration-card queue-card">
          <div className="integration-card-top">
            <span className="integration-logo queue-logo">
              <Activity size={29} />
            </span>
            <span className="small-pill">Live diagnostics</span>
          </div>
          <h2>Meet your delivery engine.</h2>
          <p>
            See delayed jobs, active workers, completed deliveries, and failures in the live BullMQ
            dashboard.
          </p>
          <div className="queue-illustration" aria-hidden="true">
            <span className="queue-block">
              <Layers3 size={21} />
              Queued
            </span>
            <i />
            <span className="queue-block active">
              <Activity size={21} />
              Processing
            </span>
            <i />
            <span className="queue-block">
              <Check size={21} />
              Complete
            </span>
          </div>
          {session.queueAdmin ? (
            <a
              className="button button-secondary"
              href="/admin/queues"
              target="_blank"
              rel="noreferrer"
            >
              Open queue dashboard <ArrowUpRight size={16} />
            </a>
          ) : (
            <div className="gentle-note">
              <Info size={16} />
              <span>
                Queue diagnostics are limited to administrators to keep workspace data private.
              </span>
            </div>
          )}
          <div className="integration-card-foot">
            <Check size={14} />
            Read-only visibility. Your queue keeps running.
          </div>
        </article>
      </div>
      <div className="panel service-panel">
        <div className="panel-heading">
          <div>
            <h3>A healthy foundation</h3>
            <p>Live connection checks for the services behind your workspace.</p>
          </div>
          <span className="live-indicator">
            <span className="tiny-dot" />
            LIVE STATUS
          </span>
        </div>
        <div className="service-grid">
          {(
            [
              {
                key: 'database',
                name: 'MySQL',
                text: 'Your durable source of truth',
                icon: Database,
              },
              {
                key: 'redis',
                name: 'Redis + BullMQ',
                text: 'Persistent jobs & shared rate limits',
                icon: Layers3,
              },
              {
                key: 'elasticsearch',
                name: 'Elasticsearch',
                text: 'Search across every conversation',
                icon: Search,
              },
            ] as const
          ).map((service) => (
            <div className="service-item" key={service.key}>
              <service.icon size={20} />
              <div>
                <strong>{service.name}</strong>
                <span>{service.text}</span>
              </div>
              <span
                className={`service-state ${health.data?.dependencies[service.key] ? 'up' : health.isLoading ? 'checking' : 'down'}`}
              >
                <i />
                {health.isLoading
                  ? 'Checking'
                  : health.data?.dependencies[service.key]
                    ? 'Connected'
                    : 'Unavailable'}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel notification-panel">
        <div className="panel-heading">
          <div>
            <h3>Notification activity</h3>
            <p>Actual Slack notification delivery attempts for this workspace.</p>
          </div>
          <Bell size={19} />
        </div>
        {notifications.isError ? (
          <ErrorBox message={notifications.error.message} />
        ) : notifications.data?.data.length ? (
          <div className="notification-list">
            {notifications.data.data.map((event) => (
              <div key={event.id} className="notification-row">
                <span className="notification-icon">
                  <SlackLogo size={21} />
                </span>
                <div>
                  <strong>Hourly limit reached</strong>
                  <p>
                    {event.details.senderEmail} · {event.details.limit} slots allocated
                  </p>
                </div>
                <span>
                  {dateLabel(event.createdAt)}, {timeLabel(event.createdAt)}
                </span>
                <span className={`small-pill ${event.delivered ? 'connected-pill' : ''}`}>
                  {event.delivered ? 'Delivered' : 'Retry pending'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="notification-empty">
            <Bell size={21} />
            <span>No rate-limit notifications yet. You’ll see live delivery activity here.</span>
          </div>
        )}
      </div>
    </>
  );
}
