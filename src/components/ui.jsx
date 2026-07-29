import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Flame, Palette } from 'lucide-react';
import { COLORS, PRESET_SWATCHES } from '../lib/constants';
import { useCategoryColor } from '../lib/categoryColor';
import { shiftMonth, monthLabel, currentMonthStr } from '../lib/helpers';

/* ---------------------------------- small UI ---------------------------------- */

export function JarBar({ pct, height = 14 }) {
  const width = Math.min(Math.max(pct, 0), 100);
  let color = COLORS.teal;
  if (pct >= 100) color = COLORS.coral;
  else if (pct >= 75) color = COLORS.gold;
  return (
    <div style={{ background: '#EEEBFA', borderRadius: 999, height, position: 'relative', overflow: 'hidden' }}>
      <div style={{
        width: `${width}%`, height: '100%', borderRadius: 999,
        background: `linear-gradient(90deg, ${color}AA, ${color})`,
        transition: 'width 0.5s ease',
      }} />
      {pct >= 100 && (
        <Flame size={12} style={{ position: 'absolute', right: 4, top: height / 2 - 6, color: '#fff' }} />
      )}
    </div>
  );
}

export function Card({ children, style, className = '', onClick }) {
  return (
    <div
      className={`rounded-2xl p-5 ${className} ${onClick ? 'cursor-pointer transition-transform hover:-translate-y-0.5' : ''}`}
      style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, boxShadow: '0 2px 10px rgba(124,92,252,0.06)', ...style }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function CategoryBadge({ cat }) {
  const c = useCategoryColor(cat);
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold font-body"
      style={{ background: `${c}22`, color: c }}
    >
      {cat}
    </span>
  );
}

export function CategoryEditCell({ value, options, bucketGroups, onChange }) {
  const color = useCategoryColor(value);
  return (
    <div className="relative inline-block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-full pl-2.5 pr-6 py-1 text-xs font-semibold font-body outline-none cursor-pointer"
        style={{ background: `${color}22`, color, border: 'none' }}
      >
        {bucketGroups && bucketGroups.length > 0 ? (
          <>
            <optgroup label="Categories">
              {options.map((c) => <option key={c} value={c} style={{ color: COLORS.ink, background: '#fff' }}>{c}</option>)}
            </optgroup>
            {bucketGroups.map((grp) => (
              <optgroup key={grp.id} label={grp.label}>
                {grp.buckets.map((g) => (
                  <option key={g.id} value={g.name} style={{ color: COLORS.ink, background: '#fff' }}>{g.name}</option>
                ))}
              </optgroup>
            ))}
          </>
        ) : (
          options.map((c) => <option key={c} value={c} style={{ color: COLORS.ink, background: '#fff' }}>{c}</option>)
        )}
      </select>
      <ChevronDown size={11} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2" style={{ color }} />
    </div>
  );
}

export function CategoryColorPicker({ current, onChange }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PRESET_SWATCHES.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          title={c}
          className="rounded-full flex-shrink-0"
          style={{
            width: 18, height: 18, background: c,
            boxShadow: current.toLowerCase() === c.toLowerCase() ? `0 0 0 2px #fff, 0 0 0 3.5px ${COLORS.ink}` : 'none',
          }}
        />
      ))}
      <label
        className="relative rounded-full flex-shrink-0 flex items-center justify-center cursor-pointer overflow-hidden"
        style={{ width: 18, height: 18, border: `1.5px dashed ${COLORS.inkSoft}` }}
        title="Custom color"
      >
        <Palette size={10} style={{ color: COLORS.inkSoft, pointerEvents: 'none' }} />
        <input
          type="color"
          value={current}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>
    </div>
  );
}

export function AmountEditCell({ value, type, onCommit, onToggleType }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const color = type === 'income' ? COLORS.teal : COLORS.coral;

  function commit() {
    const num = Math.abs(parseFloat(text)) || 0;
    setText(String(num));
    if (num !== value) onCommit(num);
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={onToggleType}
        className="font-semibold text-sm rounded px-0.5"
        style={{ color }}
        title={type === 'income' ? 'Income — click to mark as expense' : 'Expense — click to mark as income'}
      >
        {type === 'income' ? '+' : '-'}$
      </button>
      <input
        type="number"
        min="0"
        step="0.01"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        className="w-20 text-right font-semibold text-sm rounded-lg px-1.5 py-1 outline-none"
        style={{ border: `1.5px solid ${COLORS.border}`, color, background: '#fff' }}
        onFocus={(e) => { e.target.style.borderColor = color; }}
      />
    </div>
  );
}

export function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="rounded-full p-4 mb-3" style={{ background: COLORS.violetSoft }}>
        <Icon size={28} style={{ color: COLORS.violet }} />
      </div>
      <p className="font-display font-semibold text-lg" style={{ color: COLORS.ink }}>{title}</p>
      <p className="font-body text-sm mt-1 max-w-xs" style={{ color: COLORS.inkSoft }}>{subtitle}</p>
    </div>
  );
}

export function TextInput(props) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl px-3 py-2 text-sm font-body outline-none focus:ring-2 ${props.className || ''}`}
      style={{ border: `1.5px solid ${COLORS.border}`, color: COLORS.ink, ...props.style }}
      onFocus={(e) => { e.target.style.borderColor = COLORS.violet; props.onFocus && props.onFocus(e); }}
      onBlur={(e) => { e.target.style.borderColor = COLORS.border; props.onBlur && props.onBlur(e); }}
    />
  );
}

export function Select(props) {
  return (
    <select
      {...props}
      className={`w-full rounded-xl px-3 py-2 text-sm font-body outline-none ${props.className || ''}`}
      style={{ border: `1.5px solid ${COLORS.border}`, color: COLORS.ink, background: '#fff', ...props.style }}
    >
      {props.children}
    </select>
  );
}

export function PrimaryButton({ children, onClick, style, type = 'button', disabled }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold font-body text-white transition-transform active:scale-95 disabled:opacity-50"
      style={{ background: `linear-gradient(135deg, ${COLORS.violet}, #6446E0)`, boxShadow: '0 3px 10px rgba(124,92,252,0.35)', ...style }}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, onClick, style, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold font-body transition-colors disabled:opacity-50"
      style={{ color: COLORS.violet, background: COLORS.violetSoft, ...style }}
    >
      {children}
    </button>
  );
}

/* ---------------------------------- month nav ---------------------------------- */

export function MonthNav({ month, setMonth }) {
  const isCurrentMonth = month === currentMonthStr();
  return (
    <div className="flex items-center gap-2">
      {!isCurrentMonth && (
        <button
          onClick={() => setMonth(currentMonthStr())}
          className="font-body text-xs font-semibold rounded-full px-2.5 py-1"
          style={{ color: COLORS.violet, background: COLORS.violetSoft }}
        >
          Today
        </button>
      )}
      <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-full p-1.5 hover:bg-white/60" style={{ color: COLORS.inkSoft }}>
        <ChevronLeft size={18} />
      </button>
      <span className="font-display font-semibold text-sm sm:text-base" style={{ color: COLORS.ink, minWidth: 130, textAlign: 'center' }}>
        {monthLabel(month)}
      </span>
      <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-full p-1.5 hover:bg-white/60" style={{ color: COLORS.inkSoft }}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
