import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Focus the modal, contain Tab/focus, close on Escape and return to the opener. */
export function useModalFocus(open: boolean, dialogRef: RefObject<HTMLElement | null>, onClose: () => void, openerRef?: RefObject<HTMLElement | null>) {
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    if (!open || !dialogRef.current) return
    const dialog = dialogRef.current
    const restore = openerRef?.current ?? document.activeElement
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(node => node.getClientRects().length > 0 && !node.closest('[inert], [hidden]'))
    const initial = dialog.querySelector<HTMLElement>('[autofocus]') ?? focusables()[0] ?? dialog
    initial.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const nodes = focusables()
      if (!nodes.length) { event.preventDefault(); dialog.focus(); return }
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    const onFocus = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) (focusables()[0] ?? dialog).focus({ preventScroll: true }) }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocus, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocus, true)
      if (restore instanceof HTMLElement && restore.isConnected) restore.focus({ preventScroll: true })
    }
  }, [open, dialogRef, openerRef])
}
