import type { RefObject } from 'react';
import { ChevronDownIcon, ChevronUpIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface SearchBarProps {
  query: string;
  onQuery: (q: string) => void;
  /** 0-based current match; -1 when there is none. */
  index: number;
  count: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** Find in file: Enter / Shift+Enter step through matches, Esc closes. */
export function SearchBar({ query, onQuery, index, count, onNext, onPrev, onClose, inputRef }: SearchBarProps) {
  return (
    <div className="flex items-center gap-1 border-b px-2 py-1" role="search">
      <Input
        ref={inputRef}
        aria-label="Find in file"
        className="h-7 max-w-64"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) onPrev(); else onNext(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        }}
      />
      <span className="min-w-12 text-xs text-muted-foreground" aria-live="polite" aria-label="Match">{query ? `${count ? index + 1 : 0}/${count}` : ''}</span>
      <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Previous match" disabled={!count} onClick={onPrev}><ChevronUpIcon /></Button>
      <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Next match" disabled={!count} onClick={onNext}><ChevronDownIcon /></Button>
      <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Close search" onClick={onClose}><XIcon /></Button>
    </div>
  );
}
