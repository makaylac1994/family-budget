import React, { useState } from 'react';
import { Plus, Check } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { COLORS } from '../lib/constants';
import { TextInput, PrimaryButton, GhostButton } from '../components/ui';
import { AuthShell } from './AuthShell';

export function HouseholdSetup({ onCreate, onJoin }) {
  const [mode, setMode] = useState('choose');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setBusy(true);
    setError('');
    try {
      await onCreate();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onJoin(code.trim());
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      {mode === 'choose' && (
        <>
          <p className="font-body text-sm mb-4" style={{ color: COLORS.inkSoft }}>
            Set up a new household, or join one a family member already created.
          </p>
          <div className="space-y-2">
            <PrimaryButton onClick={handleCreate} disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
              <Plus size={15} /> Create a new household
            </PrimaryButton>
            <GhostButton onClick={() => setMode('join')} style={{ width: '100%', justifyContent: 'center' }}>
              I have an invite code
            </GhostButton>
          </div>
        </>
      )}
      {mode === 'join' && (
        <>
          <p className="font-body text-sm mb-4" style={{ color: COLORS.inkSoft }}>
            Enter the invite code a family member shared with you.
          </p>
          <TextInput
            placeholder="e.g. 7K9QRT"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
          />
          <div className="mt-3 flex gap-2">
            <GhostButton onClick={() => setMode('choose')}>Back</GhostButton>
            <PrimaryButton onClick={handleJoin} disabled={busy} style={{ flex: 1, justifyContent: 'center' }}>
              <Check size={15} /> Join
            </PrimaryButton>
          </div>
        </>
      )}
      {error && <p className="font-body text-xs mt-3" style={{ color: COLORS.coral }}>{error}</p>}
      <button
        onClick={() => signOut(auth)}
        className="font-body text-xs font-semibold mt-4"
        style={{ color: COLORS.inkSoft }}
      >
        Sign out
      </button>
    </AuthShell>
  );
}
