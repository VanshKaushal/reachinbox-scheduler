import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  Users,
  Clock3,
  Gauge,
  Send,
  CalendarDays,
  ChevronDown,
  Check,
  FileText,
  Info,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api';
import { localDateTime, parseLeads, dateLabel, timeLabel } from '../lib/leads';
import type { Sender, Overview } from '../types';
import { Button, Modal } from './ui';

interface Props {
  senders: Sender[];
  overview?: Overview;
  onClose: () => void;
  onAddSender: () => void;
}
export function Compose({ senders, overview, onClose, onAddSender }: Props) {
  const [senderId, setSender] = useState(senders[0]?.id || '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [leadsText, setLeadsText] = useState('');
  const [filename, setFilename] = useState('');
  const [start, setStart] = useState(localDateTime(new Date(Date.now() + 120000)));
  const minDelay = (overview?.minDelayMs ?? 2000) / 1000;
  const [delay, setDelay] = useState(minDelay);
  const [limit, setLimit] = useState(senders[0]?.hourlyLimit ?? overview?.hourlyLimit ?? 200);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastRequest = useRef<{ hash: string; key: string } | null>(null);
  const client = useQueryClient();
  const leads = useMemo(() => parseLeads(leadsText), [leadsText]);
  const sender = senders.find((s) => s.id === senderId);
  const cap = Math.min(sender?.hourlyLimit ?? 200, overview?.hourlyLimit ?? 200);
  const schedule = useMutation({
    mutationFn: async () => {
      if (!sender) throw new Error('Add or select a sender first.');
      if (!leads.emails.length) throw new Error('Add at least one valid recipient.');
      if (leads.emails.length > 10000)
        throw new Error('Schedule at most 10,000 recipients per campaign.');
      if (!Number.isFinite(delay) || delay < minDelay || delay > 3600)
        throw new Error(`Choose a delay between ${minDelay} and 3600 seconds.`);
      if (!Number.isInteger(limit) || limit < 1 || limit > cap)
        throw new Error(`Choose an hourly limit between 1 and ${cap}.`);
      const startAt = new Date(start);
      if (!Number.isFinite(startAt.getTime()) || startAt.getTime() < Date.now())
        throw new Error('Choose a start time in the future.');
      const payload = {
        senderId,
        subject,
        body,
        recipients: leads.emails,
        startAt: startAt.toISOString(),
        delaySeconds: delay,
        hourlyLimit: limit,
      };
      const hash = JSON.stringify(payload);
      if (lastRequest.current?.hash !== hash)
        lastRequest.current = { hash, key: crypto.randomUUID() };
      return api<{
        id: string;
        recipientCount: number;
        effectiveDelayMs?: number;
        effectiveHourlyLimit?: number;
      }>('/campaigns', {
        method: 'POST',
        headers: { 'Idempotency-Key': lastRequest.current!.key },
        body: hash,
      });
    },
    onSuccess: (result) => {
      toast.success(
        `${result.recipientCount.toLocaleString()} email${result.recipientCount === 1 ? '' : 's'} scheduled`,
        { description: 'We’ll take it from here. Your queue is saved.' },
      );
      void client.invalidateQueries({ queryKey: ['emails'] });
      void client.invalidateQueries({ queryKey: ['overview'] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  async function readFile(file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Choose a CSV or text file smaller than 2 MB.');
      return;
    }
    if (!/\.(csv|txt)$/i.test(file.name)) {
      toast.error('Choose a .csv or .txt file.');
      return;
    }
    try {
      const text = await file.text();
      setLeadsText(text);
      setFilename(file.name);
    } catch {
      toast.error('This file could not be read. Please try another file.');
    }
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Modal title="Compose a new email" onClose={onClose} wide busy={schedule.isPending}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          schedule.mutate();
        }}
      >
        <div className="compose-layout">
          <div className="compose-editor">
            <div className="field">
              <label htmlFor="compose-sender">
                From <span className="required">*</span>
              </label>
              {senders.length ? (
                <div className="select-wrap">
                  <select
                    id="compose-sender"
                    value={senderId}
                    onChange={(e) => {
                      setSender(e.target.value);
                      const next = senders.find((s) => s.id === e.target.value);
                      if (next) setLimit(Math.min(limit, next.hourlyLimit));
                    }}
                  >
                    <option value="" disabled>
                      Select a sender
                    </option>
                    {senders.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.email}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={15} />
                </div>
              ) : (
                <button type="button" className="add-sender-inline" onClick={onAddSender}>
                  <Plus size={17} />
                  Add your first Ethereal sender
                  <ArrowRight size={15} />
                </button>
              )}
              <span className="field-hint">Sent through Ethereal’s safe testing inbox.</span>
            </div>
            <div className="field">
              <label htmlFor="compose-subject">
                Subject <span className="required">*</span>
              </label>
              <input
                id="compose-subject"
                placeholder="Give your conversation a good beginning"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={300}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="compose-body">
                Email body <span className="required">*</span>
              </label>
              <div className="body-editor">
                <textarea
                  id="compose-body"
                  placeholder={
                    'Hi there,\n\nI’d love to connect and explore how we can work together.\n\nLooking forward to hearing from you!'
                  }
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={100000}
                  required
                />
                <div className="body-editor-footer">
                  <span>
                    <FileText size={13} />
                    Plain text
                  </span>
                  <span>{body.length.toLocaleString()} characters</span>
                </div>
              </div>
            </div>
            <div className="field recipients-field">
              <div className="field-heading">
                <label htmlFor="compose-leads">
                  Recipients <span className="required">*</span>
                </label>
                {leads.emails.length > 0 && (
                  <span className="recipient-count">
                    <Users size={13} />
                    {leads.emails.length.toLocaleString()} detected
                  </span>
                )}
              </div>
              <input
                ref={fileInput}
                aria-label="Upload CSV or text leads"
                type="file"
                accept=".csv,.txt"
                className="sr-only"
                onChange={(e) => {
                  void readFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className={`upload-zone ${dragging ? 'dragging' : ''}`}
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void readFile(e.dataTransfer.files[0]);
                }}
              >
                <span className="upload-icon">
                  {filename ? <FileText size={20} /> : <Upload size={20} />}
                </span>
                <span>
                  <strong>{filename || 'Drop a lead list here, or click to upload'}</strong>
                  <small>CSV or TXT · up to 2 MB · up to 10,000 recipients</small>
                </span>
              </button>
              <textarea
                id="compose-leads"
                className="leads-textarea"
                placeholder={'Or paste email addresses, one per line\nhello@example.com'}
                value={leadsText}
                onChange={(e) => {
                  setLeadsText(e.target.value);
                  setFilename('');
                }}
              />
              <div className="lead-feedback" aria-live="polite">
                {leads.emails.length > 0 ? (
                  <span className="valid">
                    <Check size={13} />
                    {leads.emails.length} unique email{leads.emails.length === 1 ? '' : 's'}
                  </span>
                ) : (
                  <span>CSV headers and extra name columns are handled automatically.</span>
                )}
                {leads.duplicates > 0 && (
                  <span>
                    {leads.duplicates} duplicate{leads.duplicates === 1 ? '' : 's'} removed
                  </span>
                )}
                {leads.invalid.length > 0 && (
                  <span className="invalid" title={leads.invalid.join(', ')}>
                    {leads.invalid.length} invalid address{leads.invalid.length === 1 ? '' : 'es'}{' '}
                    excluded
                  </span>
                )}
              </div>
            </div>
          </div>
          <aside className="compose-settings">
            <div className="schedule-card">
              <div className="section-title">
                <span className="section-icon">
                  <Clock3 size={18} />
                </span>
                <div>
                  <h3>A little timing goes a long way.</h3>
                  <p>Set a steady pace for your outreach.</p>
                </div>
              </div>
              <div className="field">
                <label htmlFor="compose-start">
                  <CalendarDays size={14} />
                  Start sending
                </label>
                <input
                  id="compose-start"
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  min={localDateTime(new Date())}
                  required
                />
                <span className="field-hint">Your timezone: {timezone}</span>
              </div>
              <div className="schedule-input-row">
                <div className="field">
                  <label htmlFor="compose-delay">
                    <Clock3 size={14} />
                    Delay
                  </label>
                  <div className="input-suffix">
                    <input
                      id="compose-delay"
                      type="number"
                      min={minDelay}
                      max={3600}
                      step="0.5"
                      value={Number.isFinite(delay) ? delay : ''}
                      onChange={(e) =>
                        setDelay(e.target.value === '' ? NaN : Number(e.target.value))
                      }
                      required
                    />
                    <span>sec</span>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="compose-limit">
                    <Gauge size={14} />
                    Hourly limit
                  </label>
                  <div className="input-suffix">
                    <input
                      id="compose-limit"
                      type="number"
                      min={1}
                      max={cap}
                      value={Number.isFinite(limit) ? limit : ''}
                      onChange={(e) =>
                        setLimit(e.target.value === '' ? NaN : Number(e.target.value))
                      }
                      required
                    />
                    <span>/ hr</span>
                  </div>
                </div>
              </div>
              <div className="gentle-note">
                <Info size={15} />
                <span>
                  At least {minDelay} seconds between sends. When a limit is reached, emails wait
                  safely for the next UTC hour.
                </span>
              </div>
            </div>
            <div className="email-preview">
              <div className="preview-label">
                <span className="tiny-dot" />A QUICK PREVIEW
              </div>
              <div className="preview-message">
                <div className="preview-avatar">{sender?.name[0] || 'R'}</div>
                <div>
                  <strong>{sender?.name || 'Your sender'}</strong>
                  <span>to {leads.emails[0] || 'your future connection'}</span>
                </div>
              </div>
              <h4>{subject || 'A subject worth opening'}</h4>
              <p>
                {body ||
                  'Your message will appear here as you write. Keep it thoughtful, keep it human.'}
              </p>
              <div className="preview-footer">
                <Clock3 size={13} />
                {start && Number.isFinite(new Date(start).getTime())
                  ? `First send ${dateLabel(new Date(start).toISOString())}, ${timeLabel(new Date(start).toISOString())}`
                  : 'Choose your moment'}
              </div>
            </div>
          </aside>
        </div>
        <footer className="compose-footer">
          <div>
            <ShieldNote />
            <span>
              {leads.emails.length
                ? `${leads.emails.length.toLocaleString()} recipients · ${Number.isFinite(delay) ? delay : '—'}s delay · ${Number.isFinite(limit) ? limit : '—'}/hour`
                : 'Your emails are saved before they’re queued.'}
            </span>
          </div>
          <div>
            <Button
              variant="secondary"
              type="button"
              onClick={onClose}
              disabled={schedule.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              busy={schedule.isPending}
              disabled={!senderId || !subject.trim() || !body.trim() || !leads.emails.length}
            >
              <Send size={16} />
              Schedule emails
            </Button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
function ShieldNote() {
  return (
    <span className="footer-check">
      <Check size={12} />
    </span>
  );
}
