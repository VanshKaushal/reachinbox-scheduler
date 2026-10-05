import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  Mail,
  ExternalLink,
  Clock3,
  Send,
  Check,
  Copy,
  AlertTriangle,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api';
import type { Email } from '../types';
import { dateLabel, timeLabel, initials } from '../lib/leads';
import { Button, Modal, StatusBadge } from './ui';

export function EmailDetails({ email: initial, onClose }: { email: Email; onClose: () => void }) {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const live = useQuery({
    queryKey: ['email-detail', initial.id],
    queryFn: () => api<Email>(`/emails/${initial.id}`),
    initialData: initial,
    refetchInterval: ['scheduled', 'deferred', 'sending'].includes(initial.status) ? 3000 : false,
  });
  const email = live.data;
  const update = useMutation({
    mutationFn: (action: 'cancel' | 'retry') =>
      api(`/emails/${email.id}${action === 'retry' ? '/retry' : ''}`, {
        method: action === 'retry' ? 'POST' : 'DELETE',
      }),
    onSuccess: (_, action) => {
      toast.success(action === 'cancel' ? 'Email cancelled' : 'Email queued for retry');
      void client.invalidateQueries({ queryKey: ['emails'] });
      void client.invalidateQueries({ queryKey: ['overview'] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const canCancel = ['scheduled', 'deferred'].includes(email.status);
  return (
    <Modal
      title="A closer look"
      onClose={onClose}
      busy={update.isPending}
      className="details-backdrop"
    >
      <div className="email-detail-content">
        <div className="detail-status-row">
          <StatusBadge status={email.status} />
          <span className="detail-id">{email.id.slice(0, 8)}</span>
        </div>
        <h3 className="detail-subject">{email.subject}</h3>
        <div className="detail-contact">
          <span className="recipient-avatar tone-0">{initials(email.senderName)}</span>
          <div>
            <strong>{email.senderName}</strong>
            <span>{email.senderEmail}</span>
          </div>
        </div>
        <div className="detail-to">
          <span>To</span>
          <strong>{email.recipient}</strong>
          <button
            className="icon-button"
            aria-label="Copy recipient address"
            onClick={() => {
              void navigator.clipboard
                .writeText(email.recipient)
                .then(() => toast.success('Email address copied'))
                .catch(() => toast.error('Couldn’t access the clipboard.'));
            }}
          >
            <Copy size={14} />
          </button>
        </div>
        <div className="detail-body">{email.body}</div>
        {email.error && (
          <div className="detail-warning">
            <AlertTriangle size={17} />
            <div>
              <strong>
                {email.status === 'delivery_unknown'
                  ? 'Delivery needs a human check'
                  : 'Delivery update'}
              </strong>
              <p>{email.error}</p>
            </div>
          </div>
        )}
        <div className="detail-timeline">
          <h4>The journey so far</h4>
          <div>
            <span>
              <Check size={13} />
            </span>
            <p>
              <strong>Added to your workspace</strong>
              <small>
                {dateLabel(email.createdAt)}, {timeLabel(email.createdAt)}
              </small>
            </p>
          </div>
          <div>
            <span>
              <Clock3 size={13} />
            </span>
            <p>
              <strong>
                {email.status === 'deferred'
                  ? 'Waiting for the next allowance'
                  : 'Scheduled for delivery'}
              </strong>
              <small>
                {dateLabel(email.scheduledAt)}, {timeLabel(email.scheduledAt)} · your local time
              </small>
            </p>
          </div>
          {email.sentAt && (
            <div>
              <span className="timeline-sent">
                <Send size={13} />
              </span>
              <p>
                <strong>Accepted by Ethereal SMTP</strong>
                <small>
                  {dateLabel(email.sentAt)}, {timeLabel(email.sentAt)}
                </small>
              </p>
            </div>
          )}
          <div className="timeline-attempts">
            <Mail size={13} />
            {email.attempts} delivery attempt{email.attempts === 1 ? '' : 's'}
          </div>
        </div>
        {confirm && canCancel && (
          <div className="cancel-confirm">
            <p>Cancel this scheduled email? It will be removed from pending deliveries.</p>
            <div>
              <Button
                variant="danger"
                busy={update.isPending}
                onClick={() => update.mutate('cancel')}
              >
                Yes, cancel email
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Keep scheduled
              </Button>
            </div>
          </div>
        )}
      </div>
      <footer className="modal-footer details-footer">
        {canCancel && !confirm && (
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            <XCircle size={15} />
            Cancel email
          </Button>
        )}
        {email.status === 'failed' && (
          <Button
            variant="secondary"
            onClick={() => update.mutate('retry')}
            busy={update.isPending}
          >
            <RotateCcw size={15} />
            Retry delivery
          </Button>
        )}
        {email.previewUrl ? (
          <a
            className="button button-primary"
            href={email.previewUrl}
            target="_blank"
            rel="noreferrer"
          >
            View in Ethereal <ExternalLink size={15} />
          </a>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        )}
      </footer>
    </Modal>
  );
}
