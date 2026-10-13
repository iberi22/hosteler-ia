import { describe, it, expect, beforeEach } from 'vitest';
import { focusFirst, focusableWithin, trapTabKey } from './focusTrap';

// QA pre-entrega 2026-10-13 #14: el dialogo modal no atrapaba el foco.
describe('focusTrap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function buildDialog() {
    document.body.innerHTML = `
      <button id="outside">Tarjeta de atras</button>
      <div class="dialog-panel" id="panel">
        <button id="close">Cerrar</button>
        <input id="name" />
        <input id="price" />
        <button id="save">Guardar</button>
        <button id="disabled" disabled>Deshabilitado</button>
        <input id="hidden" type="hidden" />
        <div hidden><input id="oculto" /></div>
      </div>`;
    return document.getElementById('panel') as HTMLElement;
  }

  it('enumera los enfocables y deja fuera deshabilitados, ocultos y hidden', () => {
    const panel = buildDialog();
    expect(focusableWithin(panel).map((el) => el.id)).toEqual(['close', 'name', 'price', 'save']);
  });

  it('focusFirst prioriza el primer campo de formulario', () => {
    const panel = buildDialog();
    expect(focusFirst(panel)).toBe(true);
    expect(document.activeElement?.id).toBe('name');
  });

  it('Tab en el ultimo elemento vuelve al primero', () => {
    const panel = buildDialog();
    const save = document.getElementById('save') as HTMLElement;
    save.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    save.dispatchEvent(event);
    trapTabKey(panel, event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('close');
  });

  it('Shift+Tab en el primer elemento salta al ultimo', () => {
    const panel = buildDialog();
    const close = document.getElementById('close') as HTMLElement;
    close.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    close.dispatchEvent(event);
    trapTabKey(panel, event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('save');
  });

  it('si el foco se escapo del dialogo, vuelve al primero', () => {
    const panel = buildDialog();
    const outside = document.getElementById('outside') as HTMLElement;
    outside.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    trapTabKey(panel, event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('close');
  });

  it('en medio del dialogo no interviene (el navegador sigue su orden)', () => {
    const panel = buildDialog();
    const name = document.getElementById('name') as HTMLElement;
    name.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    name.dispatchEvent(event);
    trapTabKey(panel, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignora teclas que no son Tab', () => {
    const panel = buildDialog();
    const save = document.getElementById('save') as HTMLElement;
    save.focus();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    trapTabKey(panel, event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement?.id).toBe('save');
  });
});
