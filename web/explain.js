/**
 * Pocket Omaha — tap any figure to find out what it is.
 *
 * One delegated listener on the document, so a renderer only has to add
 * `data-explain="<key>"` to a label and it works. Nothing has to be wired per
 * screen, and markup rebuilt by innerHTML keeps working.
 *
 * A dotted underline marks anything that explains. That affordance turned out
 * to be the whole feature: once a label visibly offers something, tapping it
 * is what people do, so this handles a plain tap rather than a held press.
 * Keyboard gets the same treatment, since the labels are focusable.
 */

import { explain } from './glossary.js?v=__BUILD_VERSION__';

const sheet = () => document.getElementById('explainSheet');

function targetOf(node) {
  return node?.closest?.('[data-explain]') || null;
}

function open(key) {
  const entry = explain(key);
  const el = sheet();
  if (!entry || !el) return;

  el.querySelector('.explain-title').textContent = entry.title;
  el.querySelector('[data-part="means"]').textContent = entry.means;
  el.querySelector('[data-part="matters"]').textContent = entry.matters;
  el.querySelector('[data-part="computes"]').textContent = entry.computes;

  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  // Focus the card rather than the close button: a screen reader should hear
  // the title before it hears "close".
  el.querySelector('.explain-card')?.focus();
}

export function close() {
  const el = sheet();
  if (!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
}

function onClick(ev) {
  const target = targetOf(ev.target);
  if (!target) return;
  // Captured and stopped, so a label sitting inside a row that has its own
  // click handler -- a checklist entry, whose row toggles a drawer -- opens
  // the explainer without also triggering the row.
  ev.preventDefault();
  ev.stopPropagation();
  open(target.dataset.explain);
}

export function install() {
  if (!sheet()) return;

  document.addEventListener('click', onClick, true);

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { close(); return; }
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const target = targetOf(document.activeElement);
    if (!target) return;
    ev.preventDefault();
    open(target.dataset.explain);
  });

  const el = sheet();
  el.addEventListener('click', (ev) => {
    // The backdrop closes; the card does not.
    if (ev.target === el || ev.target.closest('[data-explain-close]')) close();
  });
}
