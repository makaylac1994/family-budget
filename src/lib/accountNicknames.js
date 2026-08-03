import React from 'react';

export const AccountNicknameContext = React.createContext({});

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary match so a code never clobbers part of an unrelated word.
// Display-only -- never call this on a value that gets written back to
// storage or used for matching (category memory, dedup signatures, etc).
export function applyAccountNicknames(description, nicknames) {
  if (!description || !nicknames) return description;
  let result = description;
  for (const code of Object.keys(nicknames)) {
    const nickname = nicknames[code];
    if (!code.trim() || !nickname) continue;
    result = result.replace(new RegExp(`\\b${escapeRegExp(code)}\\b`, 'g'), nickname);
  }
  return result;
}
