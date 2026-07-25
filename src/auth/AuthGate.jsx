import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { COLORS } from '../lib/constants';
import { TextInput, PrimaryButton } from '../components/ui';
import { AuthShell } from './AuthShell';

export function AuthGate() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (e) {
      setError(e.message.replace(/^Firebase:\s*/, ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <p className="font-body text-sm mb-4" style={{ color: COLORS.inkSoft }}>
        {mode === 'signup' ? 'Create your account to get started.' : 'Sign in to your account.'}
      </p>
      <div className="space-y-2">
        <TextInput type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextInput
          type="password"
          placeholder="Password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
      </div>
      {error && <p className="font-body text-xs mt-2" style={{ color: COLORS.coral }}>{error}</p>}
      <div className="mt-3">
        <PrimaryButton onClick={submit} disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
          <Check size={15} /> {mode === 'signup' ? 'Create account' : 'Sign in'}
        </PrimaryButton>
      </div>
      <button
        onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); }}
        className="font-body text-xs font-semibold mt-3"
        style={{ color: COLORS.violet }}
      >
        {mode === 'signup' ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
      </button>
    </AuthShell>
  );
}
