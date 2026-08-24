import React, { useState, useMemo, useEffect } from 'react';
import { Landmark, RefreshCw, Wallet, Flame, X, Check, Trash2 } from 'lucide-react';
import { usePlaidLink } from 'react-plaid-link';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { COLORS } from '../lib/constants';
import { formatCurrency } from '../lib/helpers';
import { Card, PrimaryButton, GhostButton, EmptyState } from '../components/ui';
import { AccountNicknameContext, applyAccountNicknames } from '../lib/accountNicknames';

/* ---------------------------------- Accounts ---------------------------------- */

function ConnectBankButton({ onConnected }) {
  const [linkToken, setLinkToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function startConnect() {
    setBusy(true);
    setError('');
    try {
      const createLinkToken = httpsCallable(functions, 'createLinkToken');
      const resp = await createLinkToken();
      setLinkToken(resp.data.linkToken);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken, metadata) => {
      const startedAt = Date.now();
      try {
        const exchangePublicToken = httpsCallable(functions, 'exchangePublicToken');
        const resp = await exchangePublicToken({ publicToken, institutionName: metadata?.institution?.name });
        onConnected(resp.data, startedAt);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
        setLinkToken(null);
      }
    },
    onExit: () => {
      setBusy(false);
      setLinkToken(null);
    },
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready]);

  return (
    <div>
      <PrimaryButton onClick={startConnect} disabled={busy}>
        <Landmark size={15} /> Connect a bank
      </PrimaryButton>
      {error && <p className="font-body text-xs mt-2" style={{ color: COLORS.coral }}>{error}</p>}
    </div>
  );
}

// A short, human-readable "how long ago" for the persisted lastSyncAt
// timestamp -- distinct from the ephemeral per-session sync result summary
// below, which only exists right after this tab triggers a sync itself.
function formatLastSyncedAt(ms) {
  if (!ms) return null;
  const diffMs = Date.now() - ms;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function AccountsView({ accounts, transactions, updateTransactions, lastSyncAt }) {
  const accountNicknames = React.useContext(AccountNicknameContext);
  const [syncing, setSyncing] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState(null);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState(null);
  const [syncPopup, setSyncPopup] = useState(null); // { summary, startedAt }
  const [showReviewModal, setShowReviewModal] = useState(false);

  const pendingReview = useMemo(() => transactions.filter((t) => t.pendingRemoval), [transactions]);

  async function handleSync() {
    setSyncing(true);
    setError('');
    const startedAt = Date.now();
    try {
      const syncHousehold = httpsCallable(functions, 'syncHousehold');
      const resp = await syncHousehold();
      setLastSync(resp.data);
      setSyncPopup({ summary: resp.data, startedAt });
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  function handleConnected(summary, startedAt) {
    setLastSync(summary);
    setSyncPopup({ summary, startedAt });
  }

  function summaryText(s) {
    if (!s) return null;
    const parts = [];
    if (s.added) parts.push(`${s.added} new`);
    if (s.modified) parts.push(`${s.modified} updated`);
    if (s.removed) parts.push(`${s.removed} flagged by bank`);
    if (s.deduped) parts.push(`${s.deduped} possible duplicate${s.deduped > 1 ? 's' : ''}`);
    return parts.length ? parts.join(', ') : 'No changes';
  }

  function keepTransaction(id) {
    updateTransactions(transactions.map((t) => (
      t.id === id ? { ...t, pendingRemoval: false, pendingRemovalReason: undefined, duplicateOfId: undefined, likelyReplacementId: undefined } : t
    )));
  }

  function deleteTransaction(id) {
    updateTransactions(transactions.filter((t) => t.id !== id));
  }

  function keepAllPending() {
    const ids = new Set(pendingReview.map((t) => t.id));
    updateTransactions(transactions.map((t) => (
      ids.has(t.id) ? { ...t, pendingRemoval: false, pendingRemovalReason: undefined, duplicateOfId: undefined, likelyReplacementId: undefined } : t
    )));
  }

  function deleteAllPending() {
    if (!window.confirm(`Delete all ${pendingReview.length} flagged transaction(s)? This can't be undone.`)) return;
    const ids = new Set(pendingReview.map((t) => t.id));
    updateTransactions(transactions.filter((t) => !ids.has(t.id)));
  }

  async function handleDisconnect(itemId, institutionName) {
    if (!window.confirm(`Disconnect ${institutionName}? Its accounts will be removed, and it will stop pulling new transactions. Past imported transactions stay in your Ledger.`)) return;
    setDisconnectingId(itemId);
    setError('');
    try {
      const disconnectBank = httpsCallable(functions, 'disconnectBank');
      await disconnectBank({ itemId });
    } catch (e) {
      setError(e.message);
    } finally {
      setDisconnectingId(null);
    }
  }

  const total = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const byItem = {};
  accounts.forEach((a) => {
    const key = a.itemId || a.institutionName || 'bank';
    if (!byItem[key]) byItem[key] = { institutionName: a.institutionName || 'Bank', accounts: [] };
    byItem[key].accounts.push(a);
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Accounts</h2>
          <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>Connected banks and their latest balances.</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingReview.length > 0 && (
            <button
              onClick={() => setShowReviewModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold font-body"
              style={{ color: COLORS.coral, background: '#FFE9E9' }}
            >
              <Flame size={14} /> {pendingReview.length} need{pendingReview.length === 1 ? 's' : ''} review
            </button>
          )}
          {accounts.length > 0 && (
            <>
              {!syncing && formatLastSyncedAt(lastSyncAt) && (
                <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>
                  Last synced {formatLastSyncedAt(lastSyncAt)}
                </span>
              )}
              <GhostButton onClick={handleSync}>
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing...' : 'Sync now'}
              </GhostButton>
            </>
          )}
          <ConnectBankButton onConnected={handleConnected} />
        </div>
      </div>

      {error && <p className="font-body text-xs" style={{ color: COLORS.coral }}>{error}</p>}
      {!error && lastSync && (
        <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Last sync: {summaryText(lastSync)}</p>
      )}

      {accounts.length === 0 ? (
        <Card><EmptyState icon={Landmark} title="No banks connected yet" subtitle="Click Connect a bank above to securely link a checking, savings, or credit account via Plaid." /></Card>
      ) : (
        <>
          <Card>
            <div className="flex items-center gap-2 mb-1" style={{ color: COLORS.violet }}>
              <Wallet size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Total across accounts</span>
            </div>
            <p className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>{formatCurrency(total)}</p>
          </Card>

          {Object.entries(byItem).map(([itemId, { institutionName, accounts: accts }]) => (
            <Card key={itemId}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>{institutionName}</h3>
                <button
                  onClick={() => handleDisconnect(itemId, institutionName)}
                  disabled={disconnectingId === itemId}
                  className="font-body text-xs font-semibold rounded-full px-2.5 py-1 disabled:opacity-50"
                  style={{ color: COLORS.coral, background: '#FFE9E9' }}
                >
                  {disconnectingId === itemId ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
              <div className="space-y-2">
                {accts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: COLORS.bg }}>
                    <div>
                      <p className="font-body font-semibold text-sm" style={{ color: COLORS.ink }}>{a.name}{a.mask ? ` ••${a.mask}` : ''}</p>
                      <p className="font-body text-xs capitalize" style={{ color: COLORS.inkSoft }}>{a.subtype || a.type}</p>
                    </div>
                    <span className="font-display font-semibold text-sm" style={{ color: COLORS.ink }}>{formatCurrency(a.balance)}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </>
      )}

      {syncPopup && (() => {
        const syncTs = syncPopup.summary?.syncTimestamp;
        const newTx = transactions
          .filter((t) => t.addedAt && syncTs && t.addedAt === syncTs && !t.pendingRemoval)
          .sort((a, b) => b.date.localeCompare(a.date));
        const flagged = transactions.filter((t) => t.pendingRemoval);
        return (
          <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: 'rgba(33,31,61,0.45)' }}>
            <Card style={{ maxWidth: 520, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display font-semibold text-lg" style={{ color: COLORS.ink }}>Sync results</h3>
                <button onClick={() => setSyncPopup(null)} style={{ color: COLORS.inkSoft }}><X size={18} /></button>
              </div>

              {newTx.length === 0 && flagged.length === 0 ? (
                <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>No new activity this time.</p>
              ) : (
                <>
                  {newTx.length > 0 && (
                    <div className="mb-4">
                      <p className="font-body text-xs font-semibold mb-2" style={{ color: COLORS.inkSoft }}>
                        {newTx.length} new transaction{newTx.length > 1 ? 's' : ''}
                      </p>
                      <div className="space-y-1.5 max-h-56 overflow-y-auto">
                        {newTx.map((t) => (
                          <div key={t.id} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: COLORS.bg }}>
                            <div className="min-w-0">
                              <p className="font-body font-semibold text-sm truncate" style={{ color: COLORS.ink }}>{applyAccountNicknames(t.description, accountNicknames)}</p>
                              <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>{t.date} &middot; {t.category}</p>
                            </div>
                            <span className="font-display font-semibold text-sm flex-shrink-0 ml-2" style={{ color: t.type === 'income' ? COLORS.teal : COLORS.coral }}>
                              {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {flagged.length > 0 && (
                    <div className="rounded-xl px-3 py-2.5" style={{ background: '#FFFBF0', border: `1px solid ${COLORS.gold}` }}>
                      <p className="font-body text-sm font-semibold mb-1" style={{ color: COLORS.ink }}>
                        {flagged.length} transaction{flagged.length > 1 ? 's' : ''} need{flagged.length === 1 ? 's' : ''} your review
                      </p>
                      <p className="font-body text-xs mb-2" style={{ color: COLORS.inkSoft }}>
                        Either your bank says these are gone, or they look like duplicates from reconnecting an account.
                      </p>
                      <button
                        onClick={() => { setSyncPopup(null); setShowReviewModal(true); }}
                        className="font-body text-xs font-semibold"
                        style={{ color: COLORS.violet }}
                      >
                        Review now &rarr;
                      </button>
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
        );
      })()}

      {showReviewModal && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: 'rgba(33,31,61,0.45)' }}>
          <Card style={{ maxWidth: 560, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-lg" style={{ color: COLORS.ink }}>Review flagged transactions</h3>
              <button onClick={() => setShowReviewModal(false)} style={{ color: COLORS.inkSoft }}><X size={18} /></button>
            </div>
            {pendingReview.length === 0 ? (
              <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>Nothing to review right now.</p>
            ) : (
              <>
                <div className="space-y-2 mb-4 max-h-96 overflow-y-auto">
                  {pendingReview.map((t) => {
                    const linkedId = t.pendingRemovalReason === 'duplicate' ? t.duplicateOfId : t.likelyReplacementId;
                    const linked = linkedId ? transactions.find((x) => x.id === linkedId) : null;
                    return (
                    <div key={t.id} className="rounded-xl px-3 py-2.5" style={{ background: COLORS.bg }}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="min-w-0">
                          <p className="font-body font-semibold text-sm truncate" style={{ color: COLORS.ink }}>{applyAccountNicknames(t.description, accountNicknames)}</p>
                          <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>
                            {t.date} &middot; {t.pendingRemovalReason === 'duplicate' ? 'Possible duplicate' : "Bank says this is gone"}
                          </p>
                        </div>
                        <span className="font-display font-semibold text-sm flex-shrink-0" style={{ color: t.type === 'income' ? COLORS.teal : COLORS.coral }}>
                          {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                        </span>
                      </div>
                      {linked ? (
                        <p className="font-body text-xs mb-2 rounded-lg px-2 py-1.5" style={{ background: '#fff', color: COLORS.inkSoft }}>
                          {t.pendingRemovalReason === 'duplicate' ? 'Kept instead: ' : 'May have already posted as: '}
                          <span style={{ color: COLORS.ink, fontWeight: 600 }}>{applyAccountNicknames(linked.description, accountNicknames)}</span> on {linked.date} for {formatCurrency(linked.amount)}
                        </p>
                      ) : t.pendingRemovalReason === 'removed_by_bank' ? (
                        <p className="font-body text-xs mb-2" style={{ color: COLORS.inkSoft }}>
                          Often means a pending charge never fully posted. If nothing similar shows up elsewhere, it's usually safe to delete.
                        </p>
                      ) : null}
                      <div className="flex gap-2">
                        <button
                          onClick={() => keepTransaction(t.id)}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold font-body"
                          style={{ background: `${COLORS.teal}22`, color: COLORS.teal }}
                        >
                          <Check size={12} /> Keep
                        </button>
                        <button
                          onClick={() => deleteTransaction(t.id)}
                          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold font-body"
                          style={{ background: '#FFE9E9', color: COLORS.coral }}
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
                <div className="flex justify-between items-center">
                  <button onClick={deleteAllPending} className="font-body text-xs font-semibold" style={{ color: COLORS.coral }}>
                    Delete all
                  </button>
                  <GhostButton onClick={keepAllPending}>
                    <Check size={14} /> Keep all
                  </GhostButton>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
