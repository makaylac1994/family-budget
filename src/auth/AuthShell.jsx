import React from 'react';
import { COLORS } from '../lib/constants';

export function AuthShell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ background: COLORS.bg }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .font-display { font-family: 'Fredoka', sans-serif; }
        .font-body { font-family: 'Inter', sans-serif; }
      `}</style>
      <div className="rounded-2xl p-6 w-full" style={{ maxWidth: 380, background: COLORS.surface, border: `1px solid ${COLORS.border}`, boxShadow: '0 2px 10px rgba(124,92,252,0.06)' }}>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ fontSize: 26 }}>🫙</span>
          <h1 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Family Budget</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
