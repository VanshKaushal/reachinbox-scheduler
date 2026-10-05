import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Clock3,
  ShieldCheck,
  Sparkles,
  ArrowUpRight,
  Check,
  LockKeyhole,
  Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, setCsrf } from '../api';
import type { AuthConfig, Session } from '../types';
import { Button, Logo, ErrorBox } from './ui';
import { useState } from 'react';

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285f4"
        d="M43.6 20.5H24v8h11.2c-1.1 5.1-5.5 8-11.2 8-7 0-12.6-5.6-12.6-12.5S17 11.5 24 11.5c3.1 0 5.9 1.1 8.1 3.2l6-5.9C34.4 5.2 29.4 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c12.1 0 20-8.5 20-20.6 0-1.5-.1-2.7-.4-3.9z"
      />
      <path
        fill="#34a853"
        d="M24 45c5.4 0 10.3-1.8 13.8-5l-6.6-5.1c-2 1.1-4.4 1.6-7.2 1.6-5.5 0-10.3-3.6-12-8.6l-7 5.4C8.5 40.2 15.6 45 24 45z"
      />
      <path fill="#fbbc05" d="M12 27.9a12.5 12.5 0 0 1 0-7.8l-7-5.4a21 21 0 0 0 0 18.6z" />
      <path
        fill="#ea4335"
        d="M24 11.5c3.1 0 5.9 1.1 8.1 3.2l6-5.9C34.4 5.2 29.4 3 24 3 15.6 3 8.5 7.8 5 14.7l7 5.4c1.7-5 6.5-8.6 12-8.6z"
      />
    </svg>
  );
}
export function Login() {
  const config = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api<AuthConfig>('/auth/config'),
    retry: 1,
  });
  const client = useQueryClient();
  const [setup, setSetup] = useState(false);
  const demo = useMutation({
    mutationFn: () => api<Session>('/auth/demo', { method: 'POST' }),
    onSuccess: (session) => {
      setCsrf(session.csrfToken);
      client.setQueryData(['session'], session);
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <main className="login-page">
      <section className="login-story">
        <Logo inverse />
        <div className="story-content">
          <div className="story-tag">
            <span className="tiny-dot" /> OUTREACH, WITH INTENTION
          </div>
          <h1>
            The right message.
            <br />
            <span>At the right moment.</span>
          </h1>
          <p>
            Make room for meaningful conversations.
            <br />
            We’ll take care of the timing.
          </p>
          <div className="story-illustration" aria-hidden="true">
            <div className="illustration-grid" />
            <div className="floating-email">
              <div className="floating-icon">
                <Sparkles size={24} />
              </div>
              <div className="floating-lines">
                <span>Let’s start a conversation</span>
                <i />
                <i />
              </div>
              <span className="floating-check">
                <Check size={18} />
              </span>
            </div>
            <div className="floating-schedule">
              <span className="floating-clock">
                <Clock3 size={20} />
              </span>
              <div>
                <b>A little patience. A lot of possibility.</b>
                <span>Your next email is right on time.</span>
              </div>
              <div className="mini-wave">
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className="illustration-note">
              <ShieldCheck size={15} /> Thoughtfully queued. Reliably delivered.
            </div>
          </div>
          <div className="story-features">
            <div>
              <ShieldCheck size={18} />
              <span>Persistent by design</span>
            </div>
            <div>
              <Clock3 size={18} />
              <span>Sending at your pace</span>
            </div>
            <div>
              <Sparkles size={18} />
              <span>Clarity at every step</span>
            </div>
          </div>
        </div>
        <div className="story-footer">
          BUILT FOR CONVERSATIONS THAT COUNT <span>↗</span>
        </div>
      </section>
      <section className="login-form-side">
        <div className="login-top">
          <span>Email Scheduler</span>
          <span className="small-pill">by ReachInbox</span>
        </div>
        <div className="login-card">
          <div className="login-symbol">
            <ArrowUpRight size={28} />
          </div>
          <span className="eyebrow">A BETTER WAY TO REACH OUT</span>
          <h2>
            Your next conversation
            <br />
            starts here.
          </h2>
          <p>
            Sign in to schedule, send, and keep an eye
            <br className="desktop-only" /> on every email. All in one calm workspace.
          </p>
          {config.isError && (
            <ErrorBox message="Couldn’t reach the server." onRetry={() => void config.refetch()} />
          )}
          <Button
            variant="secondary"
            className="google-button"
            disabled={!config.data?.googleConfigured}
            busy={config.isLoading}
            onClick={() => {
              window.location.href = '/api/auth/google';
            }}
          >
            <GoogleIcon />
            Continue with Google
            <ArrowRight size={17} />
          </Button>
          <div className="login-security">
            <LockKeyhole size={13} />
            Secure sign-in. Your workspace stays yours.
          </div>
          {config.data && !config.data.googleConfigured && (
            <div className="setup-note">
              <Settings2 size={17} />
              <div>
                <strong>Google sign-in needs setup</strong>
                <p>Add your OAuth app credentials to enable real Google login.</p>
                <button onClick={() => setSetup((v) => !v)}>
                  {setup ? 'Hide setup steps' : 'View setup steps'} <ArrowUpRight size={13} />
                </button>
                {setup && (
                  <ol>
                    <li>Create a Web application OAuth client in Google Cloud.</li>
                    <li>
                      Add <code>http://localhost:4000/api/auth/google/callback</code> as an
                      authorized redirect URI.
                    </li>
                    <li>
                      Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in the
                      local <code>.env</code>, then restart the API.
                    </li>
                  </ol>
                )}
              </div>
            </div>
          )}
          {config.data?.demoMode && (
            <>
              <div className="login-divider">
                <span />
                LOCAL PREVIEW
                <span />
              </div>
              <Button
                variant="ghost"
                className="demo-button"
                busy={demo.isPending}
                onClick={() => demo.mutate()}
              >
                Explore the local demo <ArrowRight size={16} />
              </Button>
              <p className="demo-disclaimer">
                Explicit demo access · real queue & SMTP
                <br />
                Available only in development.
              </p>
            </>
          )}
        </div>
        <footer className="login-bottom">
          <span>Less busywork. More connection.</span>
          <span>© {new Date().getFullYear()} ReachInbox</span>
        </footer>
      </section>
    </main>
  );
}
