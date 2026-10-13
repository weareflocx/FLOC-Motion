import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { filterCommands } from '../commands.js';

// Native modal dialog with combobox + listbox semantics; Escape closes it.
// Commands run after the palette closes so dialogs they open (such as export
// confirmation) take focus normally.
export function CommandPalette({ commands, onClose }) {
  const dialog = useRef();
  const titleId = useId(), listId = useId();
  const [query, setQuery] = useState('');
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const [active, setActive] = useState(() => results.findIndex(command => command.enabled));
  useEffect(() => { const node = dialog.current; node.showModal(); return () => node.close(); }, []);
  // Live commands re-render with the editor; the highlight resets only when the query changes.
  useEffect(() => { setActive(results.findIndex(command => command.enabled)); }, [query]);
  useEffect(() => { document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' }); }, [active, listId]);
  function step(direction) {
    const enabled = results.flatMap((command, index) => command.enabled ? [index] : []);
    if (!enabled.length) return;
    const position = enabled.indexOf(active);
    setActive(enabled[position < 0 ? 0 : (position + direction + enabled.length) % enabled.length]);
  }
  function run(command) {
    if (!command?.enabled) return;
    onClose();
    setTimeout(command.run, 0);
  }
  function keys(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); step(event.key === 'ArrowDown' ? 1 : -1); }
    else if (event.key === 'Home' || event.key === 'End') {
      const enabled = results.flatMap((command, index) => command.enabled ? [index] : []);
      if (enabled.length) { event.preventDefault(); setActive(event.key === 'Home' ? enabled[0] : enabled.at(-1)); }
    } else if (event.key === 'Enter') { event.preventDefault(); run(results[active]); }
  }
  return <dialog ref={dialog} className="modal-backdrop command-palette-backdrop" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="command-palette">
      <h2 id={titleId} className="command-palette-title">Commands</h2>
      <div className="command-palette-search">
        <MagnifyingGlass size={16} aria-hidden="true"/>
        <input autoFocus type="text" role="combobox" aria-label="Search commands" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} placeholder="Search commands" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={keys}/>
      </div>
      <ul id={listId} className="command-palette-list" role="listbox" aria-label="Commands">
        {results.map((command, index) => <li key={command.id} id={`${listId}-${index}`} role="option" aria-selected={index === active} aria-disabled={!command.enabled || undefined} className={`command-palette-option${index === active ? ' active' : ''}`} onMouseMove={() => { if (command.enabled && index !== active) setActive(index); }} onClick={() => run(command)}>
          <span className="command-palette-label">{command.title}</span>
          <span className="command-palette-group">{command.group}</span>
          {command.shortcut && <kbd>{command.shortcut}</kbd>}
        </li>)}
      </ul>
      {!results.length && <p className="helper command-palette-empty" role="status">No commands match “{query}”.</p>}
    </section>
  </dialog>;
}
