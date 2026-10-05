import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Mail,
  ShieldCheck,
  ArrowUpRight,
  Clock3,
  WandSparkles,
  KeyRound,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Sender } from '../types';
import { api } from '../api';
import { initials, timeLabel } from '../lib/leads';
import { Button, Modal, EmptyState } from './ui';

export function SendersPage({ senders, onAdd }: { senders: Sender[]; onAdd: () => void }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE PEOPLE BEHIND YOUR EMAILS</div>
          <h1>
            Sender accounts<span className="title-dot">.</span>
          </h1>
          <p>A familiar name in every inbox. A safe pace for every sender.</p>
        </div>
        <Button onClick={onAdd}>
          <Plus size={17} />
          Add sender
        </Button>
      </div>
      <div className="info-banner">
        <ShieldCheck size={19} />
        <span>
          All accounts use Ethereal Email, a real SMTP sandbox. Messages are captured for review and
          never delivered to actual recipients.
        </span>
        <a href="https://ethereal.email" target="_blank" rel="noreferrer">
          About Ethereal <ArrowUpRight size={14} />
        </a>
      </div>
      {senders.length ? (
        <div className="sender-grid">
          {senders.map((s, index) => (
            <article key={s.id} className="sender-card">
              <div className="sender-card-top">
                <span className={`sender-avatar tone-${index % 4}`}>{initials(s.name)}</span>
                <span className="small-pill sandbox-pill">
                  <span className="tiny-dot" />
                  Ethereal sandbox
                </span>
              </div>
              <h3>{s.name}</h3>
              <p className="sender-address">
                <Mail size={14} />
                {s.email}
              </p>
              <div className="sender-usage-title">
                <span>This hour’s send slots</span>
                <strong>
                  {s.used} <span>/ {s.hourlyLimit}</span>
                </strong>
              </div>
              <div className={`usage-track ${s.used >= s.hourlyLimit ? 'at-limit' : ''}`}>
                <span style={{ width: `${Math.min(100, (s.used / s.hourlyLimit) * 100)}%` }} />
              </div>
              <div className="sender-card-bottom">
                <span>
                  <Clock3 size={13} />
                  Resets {timeLabel(s.resetAt)}
                </span>
                <span className={s.used >= s.hourlyLimit ? 'text-amber' : 'text-green'}>
                  {s.used >= s.hourlyLimit ? 'Limit reached' : 'Ready to send'}
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            title="Give your emails a sender."
            description="Create an Ethereal test account in a click, or connect one you already have."
            action={
              <Button onClick={onAdd}>
                <Plus size={16} />
                Add your first sender
              </Button>
            }
          />
        </div>
      )}
      <div className="sender-explainer">
        <Info size={17} />
        <div>
          <strong>A separate allowance for every sender.</strong>
          <p>
            Hourly usage is shared across campaigns and workers. Your campaign can choose a lower
            limit; the sender and server caps always apply. Send slots count attempted deliveries,
            including retries.
          </p>
        </div>
      </div>
    </>
  );
}
export function AddSender({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'auto' | 'existing'>('auto');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const client = useQueryClient();
  const add = useMutation({
    mutationFn: () =>
      api(mode === 'auto' ? '/senders/ethereal' : '/senders', {
        method: 'POST',
        body: JSON.stringify(mode === 'auto' ? { name } : { name, email, password }),
      }),
    onSuccess: () => {
      toast.success('Sender is ready', {
        description: 'You can now schedule emails from this account.',
      });
      void client.invalidateQueries({ queryKey: ['senders'] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Modal title="Add a sender" onClose={onClose} busy={add.isPending}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="modal-content">
          <div className="segmented">
            <button
              type="button"
              className={mode === 'auto' ? 'active' : ''}
              onClick={() => setMode('auto')}
            >
              <WandSparkles size={16} />
              Create test account
            </button>
            <button
              type="button"
              className={mode === 'existing' ? 'active' : ''}
              onClick={() => setMode('existing')}
            >
              <KeyRound size={16} />
              Use existing
            </button>
          </div>
          <div className="field">
            <label htmlFor="sender-name">Sender name</label>
            <input
              id="sender-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Vansh from ReachInbox"
              maxLength={100}
              required
            />
          </div>
          {mode === 'existing' ? (
            <>
              <div className="field">
                <label htmlFor="sender-email">Ethereal email address</label>
                <input
                  id="sender-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.account@ethereal.email"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="sender-password">Ethereal SMTP password</label>
                <input
                  id="sender-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            </>
          ) : (
            <div className="gentle-note">
              <ShieldCheck size={18} />
              <span>
                We’ll create a real Ethereal account for you. Credentials are encrypted on the
                server. No SMTP setup needed.
              </span>
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button type="submit" busy={add.isPending} disabled={!name.trim()}>
            {mode === 'auto' ? <WandSparkles size={16} /> : <Plus size={16} />}
            {mode === 'auto' ? 'Create sender' : 'Verify & add sender'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
